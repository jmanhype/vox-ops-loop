
import 'dotenv/config';
import { getSupabaseAdmin, getPolicyValue } from './supabase.mjs';

const supabase = getSupabaseAdmin();

async function processEvents() {
  const { data: events } = await supabase
    .from('ops_agent_events')
    .select('*')
    .is('processed_at', null)
    .order('created_at', { ascending: true })
    .limit(5);

  if (!events?.length) return;

  for (const event of events) {
    try {
        const matrix = await getPolicyValue('reaction_matrix');
        const patterns = matrix?.patterns || [];
        const pattern = patterns.find(p => {
          try { return new Function('event', `return ${p.condition}`)(event); } catch (e) { return false; }
        });

        if (pattern) {
          const { data: proposal } = await supabase
            .from('ops_mission_proposals')
            .insert({
              source: 'trigger',
              dedupe_key: `event:${event.id}`,
              template: pattern.template,
              status: 'approved'
            })
            .select()
            .single();

          let activeProposal = proposal;
          if (!activeProposal) {
             const { data: existing } = await supabase.from('ops_mission_proposals').select('*').eq('dedupe_key', `event:${event.id}`).single();
             activeProposal = existing;
          }

          if (activeProposal) {
              const { data: mission } = await supabase.from('ops_missions').insert({
                  proposal_id: activeProposal.id,
                  status: 'running',
                  policy_snapshot: { event_data: event.data }
                }).select().single();

              if (mission) {
                  await createStep(mission.id, pattern.template.steps[0], event.data);
                  console.log(`[Heartbeat] Started Mission ${mission.id}`);
              }
          }
        }
        await supabase.from('ops_agent_events').update({ processed_at: new Date().toISOString() }).eq('id', event.id);
    } catch (e) {
        console.error("Event Error:", e);
    }
  }
}

async function processMissions() {
  const { data: missions } = await supabase
    .from('ops_missions')
    .select('id, policy_snapshot, proposal_id')
    .eq('status', 'running');

  if (!missions?.length) return;

  for (const mission of missions) {
    try {
        const { data: proposal } = await supabase.from('ops_mission_proposals').select('template, dedupe_key').eq('id', mission.proposal_id).single();
        if (!proposal) {
          console.log(`[Heartbeat] Mission ${mission.id.slice(0,8)} has no proposal — marking failed`);
          await supabase.from('ops_missions').update({ status: 'failed' }).eq('id', mission.id);
          continue;
        }

        const allSteps = proposal.template.steps;
        const { data: steps } = await supabase.from('ops_mission_steps').select('id, status, kind').eq('mission_id', mission.id).order('created_at', { ascending: true });

        const stepCount = steps?.length || 0;
        const lastStep = stepCount > 0 ? steps[stepCount - 1] : null;

        let eventData = mission.policy_snapshot?.event_data;
        if (!eventData && proposal.dedupe_key?.startsWith('event:')) {
            const eventId = proposal.dedupe_key.split(':')[1];
            const { data: event } = await supabase.from('ops_agent_events').select('data').eq('id', eventId).single();
            eventData = event?.data || {};
        }

        if (!lastStep) {
            console.log(`[Heartbeat] Mission ${mission.id.slice(0,8)} has no steps. Creating Step 0.`);
            await createStep(mission.id, allSteps[0], eventData);
            continue;
        }

        if (lastStep.status === 'succeeded') {
            const nextIndex = stepCount;
            if (nextIndex < allSteps.length) {
                console.log(`[Heartbeat] Mission ${mission.id.slice(0,8)}: Step ${stepCount - 1} succeeded → creating Step ${nextIndex}`);
                await createStep(mission.id, allSteps[nextIndex], eventData);
            } else {
                console.log(`[Heartbeat] Mission ${mission.id.slice(0,8)} SUCCEEDED (all ${allSteps.length} steps done)`);
                await supabase.from('ops_missions').update({ status: 'succeeded' }).eq('id', mission.id);
            }
        } else if (lastStep.status === 'failed') {
            // CRITICAL FIX: Failed steps must cascade to mission failure
            console.log(`[Heartbeat] Mission ${mission.id.slice(0,8)} FAILED (step ${stepCount - 1} "${lastStep.kind}" failed)`);
            await supabase.from('ops_missions').update({ status: 'failed' }).eq('id', mission.id);
        }
        // If lastStep is 'queued' or 'running', do nothing — worker is handling it
    } catch (e) {
        console.error(`Error processing mission ${mission.id}:`, e);
    }
  }
}

async function recoverStaleSteps() {
    // Default 5 min (not 30) — fast recovery is critical for pipeline health
    const staleMinutes = Number(process.env.OPS_STALE_STEP_MINUTES || 5);
    const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000).toISOString();

    const { data: staleSteps, error } = await supabase
      .from('ops_mission_steps')
      .select('id, mission_id, kind, executor')
      .eq('status', 'running')
      .lt('updated_at', cutoff);

    if (error || !staleSteps?.length) return 0;

    let failed = 0;

    for (const step of staleSteps) {
      const { error: updateError } = await supabase
        .from('ops_mission_steps')
        .update({
          status: 'failed',
          last_error: `Stale: no heartbeat for ${staleMinutes}+ minutes`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', step.id);

      if (!updateError) {
        failed++;
        console.log(`[StaleRecovery] Failed step ${step.id.slice(0,8)} (${step.executor}) — stale ${staleMinutes}+ min`);
        // Finalize the mission so it doesn't stay as zombie
        await supabase.rpc('ops_maybe_finalize_mission', { p_mission_id: step.mission_id }).catch(() => {});
      }
    }

    return failed;
}

async function createStep(missionId, stepTemplate, eventData) {
  let paramsStr = JSON.stringify(stepTemplate.params);
  if (eventData?.prompt) paramsStr = paramsStr.replace(/{{event\.data\.prompt}}/g, eventData.prompt.replace(/"/g, '\\"'));
  if (eventData?.chat_id) paramsStr = paramsStr.replace(/{{event\.data\.chat_id}}/g, eventData.chat_id);

  let params;
  try {
      params = JSON.parse(paramsStr);
  } catch (e) {
      console.error("JSON Parse Error:", e);
      throw e;
  }

  const { error } = await supabase.from('ops_mission_steps').insert({
      mission_id: missionId,
      kind: stepTemplate.kind,
      executor: stepTemplate.executor,
      params: params,
      status: 'queued'
    });

  if (error) {
      console.error("Supabase Insert Error:", error);
  } else {
      console.log(`[CreateStep] Queued ${stepTemplate.kind} (${stepTemplate.executor}) for mission ${missionId.slice(0,8)}`);
  }
}

async function main() {
  console.log("❤️ Heartbeat v5.0 (Failed Step Cascade + Fast Stale Recovery) Started");
  setInterval(async () => {
    try {
      await processEvents().catch(e => console.error("Event Error:", e));
      await processMissions().catch(e => console.error("Mission Loop Error:", e));
      const staleCount = await recoverStaleSteps().catch(() => 0);
      if (staleCount > 0) console.log(`[Heartbeat] Recovered ${staleCount} stale step(s)`);
    } catch (e) {
      console.error("Heartbeat tick error:", e);
    }
  }, 2000);
}

main();
