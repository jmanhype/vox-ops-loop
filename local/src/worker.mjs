
import 'dotenv/config';
import { getSupabaseAdmin, getPolicyValue } from './supabase.mjs';
import { executeStep } from './executors/index.mjs';

const STEP_TIMEOUT_MS = Number(process.env.OPS_STEP_TIMEOUT_MS || 50 * 60 * 1000); // 50 min hard ceiling — must exceed longest executor timeout (minion: 45 min)

function buildEvent(type, data, missionId, stepId, status) {
  return {
    dedupe_key: `${stepId}:${status}`,
    type,
    data,
    mission_id: missionId,
  };
}

// Track what THIS worker is running — not a global DB lock
let currentStepId = null;

async function cleanupOrphanedSteps() {
  const supabase = getSupabaseAdmin();
  const { data: orphans, error } = await supabase
    .from('ops_mission_steps')
    .select('id, mission_id, kind, executor')
    .eq('status', 'running');

  if (error || !orphans?.length) return;

  console.log(`[Worker] Cleaning up ${orphans.length} orphaned running step(s) from previous crash...`);
  for (const step of orphans) {
    await supabase
      .from('ops_mission_steps')
      .update({
        status: 'failed',
        last_error: 'Orphaned: worker restarted while step was running',
        updated_at: new Date().toISOString(),
      })
      .eq('id', step.id);

    // Finalize the mission so heartbeat can re-evaluate it
    await supabase.rpc('ops_maybe_finalize_mission', { p_mission_id: step.mission_id }).catch(() => {});
    console.log(`[Worker] Orphaned step ${step.id.slice(0, 8)} (${step.executor}) → failed`);
  }
}

async function claimNextStep() {
  const supabase = getSupabaseAdmin();
  const leaseMinutes = Number(process.env.OPS_STEP_LEASE_MINUTES || 10);

  // Only skip if THIS worker is already running something
  if (currentStepId) {
    return null;
  }

  const { data, error } = await supabase.rpc('ops_claim_next_step', {
    p_lease_minutes: leaseMinutes,
  });

  if (error) {
    console.error("Claim Error:", error);
    return null;
  }
  return data?.[0] || null;
}

async function markActionRun(supabase, runId, status, errorMsg, meta = {}) {
  await supabase
    .from('ops_action_runs')
    .update({ status, completed_at: new Date().toISOString(), error: errorMsg, meta })
    .eq('run_id', runId);
}

async function processOneStep() {
  const supabase = getSupabaseAdmin();
  const step = await claimNextStep();

  if (!step) {
    return false; // Idle
  }

  currentStepId = step.id;
  const runId = `${step.id}-${Date.now()}`;

  await supabase
    .from('ops_action_runs')
    .insert({ run_id: runId, step_id: step.id, executor: step.executor, status: 'started', meta: { kind: step.kind } });

  console.log(`[Worker] Starting step ${step.id} (${step.kind}, executor: ${step.executor})...`);

  const keepAlive = setInterval(async () => {
    console.log(`[Worker] Still processing step ${step.id}...`);
    // Touch updated_at so stale recovery doesn't kill us
    try {
      await supabase
        .from('ops_mission_steps')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', step.id);
    } catch {}
  }, 30000);

  let result = null;
  let errorMsg = null;

  try {
    // Hard timeout wrapper — no executor can run longer than STEP_TIMEOUT_MS
    result = await Promise.race([
      executeStep(step),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Step timeout: exceeded ${Math.round(STEP_TIMEOUT_MS / 1000)}s ceiling`)), STEP_TIMEOUT_MS)
      ),
    ]);
  } catch (err) {
    errorMsg = err?.message || String(err);
    if (err?.stdout || err?.stderr) {
      result = { stdout: err.stdout, stderr: err.stderr, code: err.code };
    }
  }

  clearInterval(keepAlive);

  const policy = await getPolicyValue('worker_policy', {});
  const maxRetries = step.max_retries ?? policy?.max_retries ?? Number(process.env.OPS_WORKER_MAX_RETRIES || 2);

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

    // DO NOT call ops_maybe_finalize_mission on success — the heartbeat manages
    // mission lifecycle (creates next step or marks complete). The RPC doesn't
    // know about template steps and prematurely finalizes multi-step missions.
    await markActionRun(supabase, runId, 'succeeded', null, { result_summary: 'ok' });
    console.log(`Step ${step.id} succeeded`);
    currentStepId = null;
    return true;
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
        result
      })
      .eq('id', step.id);

    await markActionRun(supabase, runId, 'failed', errorMsg, { retrying: true });
    console.error(`Step ${step.id} failed, retrying (${nextFailureCount}/${maxRetries})`);
    currentStepId = null;
    return true;
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
  currentStepId = null;
  return true;
}

async function mainLoop() {
  console.log("👷 Worker v4.0 (No Global Lock + Orphan Cleanup + Step Timeout) Started");

  // On startup: fail any orphaned running steps from previous crash
  await cleanupOrphanedSteps();

  while (true) {
    try {
      const didWork = await processOneStep();
      if (!didWork) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    } catch (e) {
      console.error("Worker Loop Error:", e);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

mainLoop();
