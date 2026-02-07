import 'dotenv/config';
import { getSupabaseAdmin, getPolicyValue } from './supabase.mjs';

function normalizeArray(value) {
  if (!Array.isArray(value)) return [];
  return value;
}

function matchesPattern(event, pattern) {
  const eventType = event.type;
  const patternType = pattern.event_type ?? pattern.type ?? '*';
  const typeMatch = Array.isArray(patternType)
    ? patternType.includes(eventType)
    : patternType === '*' || patternType === eventType;

  if (!typeMatch) return false;

  const requiredTags = normalizeArray(pattern.tags);
  if (requiredTags.length > 0) {
    const eventTags = normalizeArray(event.data?.tags);
    const hasAll = requiredTags.every(tag => eventTags.includes(tag));
    if (!hasAll) return false;
  }

  if (pattern.source) {
    if (event.data?.source !== pattern.source) return false;
  }

  return true;
}

async function cooldownActive(supabase, pattern) {
  if (!pattern?.id || !pattern?.cooldown_minutes) return false;
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

function passProbability(pattern) {
  if (pattern.probability === undefined || pattern.probability === null) return true;
  const p = Number(pattern.probability);
  if (!Number.isFinite(p)) return true;
  if (p <= 0) return false;
  if (p >= 1) return true;
  return Math.random() < p;
}

function renderTemplate(template, context) {
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
    const rendered = {};
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
  const reactionMatrix = await getPolicyValue('reaction_matrix', { patterns: [] });
  const patterns = normalizeArray(reactionMatrix?.patterns);

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
      if (await cooldownActive(supabase, pattern)) continue;

      const template = pattern.template ?? pattern.proposal;
      if (!template) continue;

      // Render the template with event context
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
      .update({ status: 'done', payload: Object.assign({}, payload, { result: data?.[0] || null }) })
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
  const threshold = Number(process.env.OPS_STALE_STEP_MINUTES || 30);
  const { data, error } = await supabase.rpc('ops_recover_stale_steps', {
    p_threshold_minutes: threshold,
  });

  if (error) throw error;
  return data?.[0]?.recovered_steps ?? 0;
}

async function main() {
  const triggerResult = await evaluateTriggers();
  const reactionResult = await processReactionQueue();
  const leaseResult = await recoverExpiredLeases();
  const staleResult = await recoverStaleSteps();

  console.log(JSON.stringify({
    ok: true,
    triggerResult,
    reactionResult,
    leaseResult,
    staleResult,
  }));
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
