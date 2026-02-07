import 'dotenv/config';
import { getSupabaseAdmin, getPolicyValue } from './supabase.mjs';
import { executeStep } from './executors/index.mjs';

function buildEvent(type, data, missionId, stepId, status) {
  return {
    dedupe_key: `${stepId}:${status}`,
    type,
    data,
    mission_id: missionId,
  };
}

async function claimNextStep() {
  const supabase = getSupabaseAdmin();
  const leaseMinutes = Number(process.env.OPS_STEP_LEASE_MINUTES || 10);
  const { data, error } = await supabase.rpc('ops_claim_next_step', {
    p_lease_minutes: leaseMinutes,
  });

  if (error) throw error;
  return data?.[0] || null;
}

async function markActionRun(supabase, runId, status, errorMsg, meta = {}) {
  await supabase
    .from('ops_action_runs')
    .update({ status, completed_at: new Date().toISOString(), error: errorMsg, meta })
    .eq('run_id', runId);
}

let currentStep = null;
let currentRunId = null;

async function handleExit(signal) {
  if (currentStep && currentRunId) {
    console.log(`\n[Worker] Received ${signal}. Marking step ${currentStep.id} as failed...`);
    const supabase = getSupabaseAdmin();
    await supabase
      .from('ops_mission_steps')
      .update({
        status: 'failed',
        last_error: `Worker interrupted by ${signal}`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', currentStep.id);
    
    await markActionRun(supabase, currentRunId, 'failed', `Interrupted by ${signal}`);
  }
  process.exit(signal === 'SIGINT' ? 0 : 1);
}

process.on('SIGINT', () => handleExit('SIGINT'));
process.on('SIGTERM', () => handleExit('SIGTERM'));

async function main() {
  const supabase = getSupabaseAdmin();
  const step = await claimNextStep();

  if (!step) {
    console.log('No queued steps');
    return;
  }

  currentStep = step;
  currentRunId = `${step.id}-${Date.now()}`;
  
  await supabase
    .from('ops_action_runs')
    .insert({ run_id: currentRunId, step_id: step.id, executor: step.executor, status: 'started', meta: { kind: step.kind } });

  // Add a keep-alive log every 30 seconds to prevent tool timeouts
  const keepAlive = setInterval(() => {
    console.log(`[Worker] Still processing step ${step.id}...`);
  }, 30000);

  let result = null;
  let errorMsg = null;

  try {
    result = await executeStep(step);
  } catch (err) {
    errorMsg = err?.message || String(err);
    if (err?.stdout || err?.stderr) {
      result = { stdout: err.stdout, stderr: err.stderr, code: err.code };
    }
  }

  clearInterval(keepAlive);
  const runId = currentRunId; // Use closure-safe runId

  if (!errorMsg) {
    await supabase
      .from('ops_mission_steps')
      .update({
        status: 'succeeded',
        result,
        updated_at: new Date().toISOString(),
      })
      .eq('id', step.id);

    await supabase.from('ops_agent_events').insert(buildEvent(
      `step:${step.kind}:succeeded`,
      { step_id: step.id, kind: step.kind, result },
      step.mission_id,
      step.id,
      'succeeded'
    ));

    await supabase.rpc('ops_maybe_finalize_mission', { p_mission_id: step.mission_id });
    await markActionRun(supabase, runId, 'succeeded', null, { result_summary: 'ok' });
    console.log(`Step ${step.id} succeeded`);
    return;
  }

  const nextFailureCount = (step.failure_count || 0) + 1;
  const shouldRetry = nextFailureCount < maxRetries;

  if (shouldRetry) {
    await supabase
      .from('ops_mission_steps')
      .update({
        status: 'queued',
        failure_count: nextFailureCount,
        last_error: errorMsg,
        reserved_at: null,
        lease_expires_at: null,
        result // Save result on retry for debugging
      })
      .eq('id', step.id);

    await markActionRun(supabase, runId, 'failed', errorMsg, { retrying: true });
    console.error(`Step ${step.id} failed, retrying (${nextFailureCount}/${maxRetries})`);
    return;
  }

  await supabase
    .from('ops_mission_steps')
    .update({
      status: 'failed',
      failure_count: nextFailureCount,
      last_error: errorMsg,
      result,
    })
    .eq('id', step.id);

  await supabase
    .from('ops_step_dead_letters')
    .insert({
      step_id: step.id,
      mission_id: step.mission_id,
      kind: step.kind,
      params: step.params,
      executor: step.executor,
      failure_count: nextFailureCount,
      last_error: errorMsg,
      result,
    });

  await supabase.from('ops_agent_events').insert(buildEvent(
    `step:${step.kind}:failed`,
    { step_id: step.id, kind: step.kind, error: errorMsg, result },
    step.mission_id,
    step.id,
    'failed'
  ));

  await supabase.rpc('ops_maybe_finalize_mission', { p_mission_id: step.mission_id });
  await markActionRun(supabase, runId, 'failed', errorMsg, { retrying: false });
  console.error(`Step ${step.id} failed permanently`);
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
