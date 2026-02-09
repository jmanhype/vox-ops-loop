import { runWreckit } from './wreckit.mjs';
import { runOpenClaw } from './openclaw.mjs';
import { runRadar } from './radar.mjs';
import { runMinion } from './minion.mjs';
import { runVote } from './vote.mjs';
import { runNotify } from './notify.mjs';
import voxlogs from './voxlogs.mjs';

export async function executeStep(step, context) {
  const executor = step.executor || 'openclaw';

  if (executor === 'voxlogs') {
    return await voxlogs(step.params || {}, context);
  }

  if (step.kind === 'notify' || executor === 'notify') {
    return await runNotify(step);
  }

  if (step.kind === 'vote' || executor === 'vote') {
    return await runVote(step);
  }

  if (step.kind === 'minion' || step.kind === 'minion_request') {
    return await runMinion(step);
  }

  if (step.kind === 'radar') {
    return await runRadar(step);
  }

  if (executor === 'openclaw' || step.kind === 'openclaw') {
    return await runOpenClaw(step);
  }

  if (executor === 'wreckit' || step.kind === 'wreckit') {
    return await runWreckit(step);
  }

  if (executor === 'noop') {
    return { ok: true, note: 'noop executor' };
  }

  throw new Error(`No executor registered for ${executor}`);
}
