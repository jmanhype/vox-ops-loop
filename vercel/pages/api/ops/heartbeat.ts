import type { NextApiRequest, NextApiResponse } from 'next';
import { getSupabaseAdmin } from '../../../lib/ops/supabase';
import { requireBearer } from '../../../lib/ops/auth';

function normalizeArray(value: any) {
  if (!Array.isArray(value)) return [];
  return value;
}

function matchesPattern(event: any, pattern: any) {
  const eventType = event.type;
  const patternType = pattern.event_type ?? pattern.type ?? '*';
  const typeMatch = Array.isArray(patternType)
    ? patternType.includes(eventType)
    : patternType === '*' || patternType === eventType;

  if (!typeMatch) return false;

  const requiredTags = normalizeArray(pattern.tags);
  if (requiredTags.length > 0) {
    const eventTags = normalizeArray(event.data?.tags);
    const hasAll = requiredTags.every((tag: string) => eventTags.includes(tag));
    if (!hasAll) return false;
  }

  if (pattern.source) {
    if (event.data?.source !== pattern.source) return false;
  }

  return true;
}

function passProbability(pattern: any) {
  if (pattern.probability === undefined || pattern.probability === null) return true;
  const p = Number(pattern.probability);
  if (!Number.isFinite(p)) return true;
  if (p <= 0) return false;
  if (p >= 1) return true;
  return Math.random() < p;
}

async function cooldownActive(pattern: any) {
  if (!pattern?.id || !pattern?.cooldown_minutes) return false;
  const supabase = getSupabaseAdmin();
  const cutoff = new Date(Date.now() - Number(pattern.cooldown_minutes) * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('ops_agent_reactions')
    .select('id')
    .filter('payload->>pattern_id', 'eq', String(pattern.id))
    .gt('created_at', cutoff)
    .limit(1);

  if (error) throw error;
  return (data?.length || 0) > 0;
}

function renderTemplate(template: any, context: any): any {
  if (typeof template === 'string') {
    return template.replace(/\{\{(.*?)\}\}/g, (match, path) => {
      const parts = path.trim().split('.');
      let val = context;
      for (const part of parts) {
        val = val?.[part];
      }
      return val !== undefined ? val : match;
    });
  }
  if (Array.isArray(template)) {
    return template.map(item => renderTemplate(item, context));
  }
  if (typeof template === 'object' && template !== null) {
    const rendered: any = {};
    for (const key in template) {
      rendered[key] = renderTemplate(template[key], context);
    }
    return rendered;
  }
  return template;
}

async function evaluateTriggers() {
  const supabase = getSupabaseAdmin();
  const batchSize = Number(process.env.OPS_EVENT_BATCH_SIZE || 25);

  const { data: policy } = await supabase
    .from('ops_policy')
    .select('value')
    .eq('key', 'reaction_matrix')
    .single();

  const patterns = normalizeArray(policy?.value?.patterns);
  if (patterns.length === 0) {
    return { events: 0, queued: 0 };
  }

  const { data: events, error } = await supabase
    .from('ops_agent_events')
    .select('*')
    .is('processed_at', null)
    .order('created_at', { ascending: true })
    .limit(batchSize);

  if (error) throw error;
  if (!events || events.length === 0) return { events: 0, queued: 0 };

  let queued = 0;

  for (const event of events) {
    let eventMatched = false;

    for (const pattern of patterns) {
      if (!matchesPattern(event, pattern)) continue;
      if (!passProbability(pattern)) continue;
      if (await cooldownActive(pattern)) continue;

      const template = pattern.template ?? pattern.proposal;
      if (!template) continue;

      const renderedTemplate = renderTemplate(template, { event });

      const payload = {
        pattern_id: pattern.id ?? null,
        event_type: event.type,
        proposal_template: renderedTemplate,
        proposal_source: pattern.source ?? 'trigger',
        dedupe_key: pattern.dedupe_key ?? (pattern.id ? `${event.id}:${pattern.id}` : event.id),
      };

      const { error: insertError } = await supabase
        .from('ops_agent_reactions')
        .insert({ event_id: event.id, status: 'queued', payload });

      if (!insertError) {
        queued += 1;
        eventMatched = true;
      }
    }

    // Only mark event as processed if it matched at least one pattern
    if (eventMatched) {
      await supabase
        .from('ops_agent_events')
        .update({ processed_at: new Date().toISOString() })
        .eq('id', event.id);
    }
  }

  return { events: events.length, queued };
}

async function processReactionQueue() {
  const supabase = getSupabaseAdmin();
  const batchSize = Number(process.env.OPS_REACTION_BATCH_SIZE || 25);

  const { data: reactions, error } = await supabase
    .from('ops_agent_reactions')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(batchSize);

  if (error) throw error;
  if (!reactions || reactions.length === 0) return { processed: 0, created: 0 };

  let created = 0;

  for (const reaction of reactions) {
    const payload = reaction.payload || {};
    const template = payload.proposal_template;
    if (!template) {
      await supabase
        .from('ops_agent_reactions')
        .update({ status: 'failed', updated_at: new Date().toISOString() })
        .eq('id', reaction.id);
      continue;
    }

    const { data, error: createError } = await supabase.rpc(
      'ops_create_proposal_and_maybe_autoapprove',
      {
        p_dedupe_key: payload.dedupe_key ?? reaction.id,
        p_source: payload.proposal_source ?? 'reaction',
        p_template: template,
      }
    );

    if (createError) {
      await supabase
        .from('ops_agent_reactions')
        .update({ status: 'failed', payload: { ...payload, error: createError.message } })
        .eq('id', reaction.id);
      continue;
    }

    created += 1;
    await supabase
      .from('ops_agent_reactions')
      .update({ status: 'done', payload: { ...payload, result: data?.[0] || null } })
      .eq('id', reaction.id);
  }

  return { processed: reactions.length, created };
}

async function promoteInsights() {
  return { promoted: 0 };
}

async function recoverExpiredLeases() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('ops_recover_expired_leases');
  if (error) throw error;
  return data?.[0] || { requeued_steps: 0, failed_steps: 0 };
}

async function recoverStaleSteps() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc('ops_recover_stale_steps', {
    p_threshold_minutes: 30,
  });

  if (error) throw error;

  return { recovered: data?.[0]?.recovered_steps ?? 0 };
}

async function publishThought(agent: string, thought: string) {
  const supabase = getSupabaseAdmin();
  await supabase.from('ops_agent_events').insert({
    type: 'agent:thought',
    data: { agent },
    thought
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    requireBearer(req);

    await publishThought('Conductor', 'Initiating heartbeat sequence...');

    await publishThought('Conductor', 'Evaluating incoming events for triggers...');
    const triggerResult = await evaluateTriggers();
    
    await publishThought('Conductor', `Trigger check complete. Events: ${triggerResult.events}, Queued: ${triggerResult.queued}`);

    await publishThought('Conductor', 'Processing reaction queue...');
    const reactionResult = await processReactionQueue();

    const learningResult = await promoteInsights();

    await publishThought('Conductor', 'Checking for expired leases and stale steps...');
    const leaseResult = await recoverExpiredLeases();
    const staleResult = await recoverStaleSteps();

    await publishThought('Conductor', 'Heartbeat complete.');

    return res.status(200).json({
      ok: true,
      triggerResult,
      reactionResult,
      learningResult,
      leaseResult,
      staleResult,
    });
  } catch (err: any) {
    const status = err?.statusCode || 500;
    return res.status(status).json({ error: err?.message || 'Unknown error' });
  }
}
