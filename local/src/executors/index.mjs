import { runWreckit } from './wreckit.mjs';
import { runOpenClaw } from './openclaw.mjs';
import { runRadar } from './radar.mjs';
import { runMinion } from './minion.mjs';

export async function executeStep(step) {
  const executor = step.executor || 'openclaw';

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
