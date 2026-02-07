import { spawn } from 'child_process';
import { getPolicyValue } from '../supabase.mjs';

const DEFAULT_ALLOWED_SUBCOMMANDS = ['agent'];
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => typeof item === 'string')
    .map(item => item.trim())
    .filter(item => item.length > 0);
}

function validateArgs(args) {
  const sanitized = [];
  let total = 0;

  for (const arg of args) {
    if (arg.includes('\u0000')) {
      throw new Error('Invalid null byte in argument');
    }
    if (arg.length > 512) {
      throw new Error('Argument too long');
    }
    total += arg.length;
    if (total > 4096) {
      throw new Error('Arguments too large');
    }
    sanitized.push(arg);
  }

  return sanitized;
}

function ensureToolsAllowed(allowed, requested) {
  if (!allowed || allowed.length === 0) return;
  for (const tool of requested) {
    if (!allowed.includes(tool)) {
      throw new Error(`Unauthorized tool requested: ${tool}`);
    }
  }
}

function addArg(args, flag, value) {
  if (value === undefined || value === null || value === '') return;
  args.push(flag, String(value));
}

export async function runOpenClaw(step) {
  const params = step.params || {};
  const subcommand =
    typeof params.subcommand === 'string'
      ? params.subcommand
      : typeof params.command === 'string'
        ? params.command
        : 'agent';

  const policy = await getPolicyValue('worker_policy', {});
  const allowedSubcommands = normalizeStringArray(
    policy?.allowed_openclaw_subcommands ?? policy?.allowed_openclaw_commands
  );
  const effectiveAllowed =
    allowedSubcommands.length > 0 ? allowedSubcommands : DEFAULT_ALLOWED_SUBCOMMANDS;

  if (effectiveAllowed.length > 0 && !effectiveAllowed.includes(subcommand)) {
    throw new Error(`OpenClaw subcommand not allowed: ${subcommand}`);
  }

  const requestedTools = normalizeStringArray(params.tools);
  const allowedTools = normalizeStringArray(policy?.allowed_tools);
  ensureToolsAllowed(allowedTools, requestedTools);

  const argList = [];
  const message =
    typeof params.message === 'string'
      ? params.message
      : typeof params.prompt === 'string'
        ? params.prompt
        : null;

  if (subcommand === 'agent') {
    addArg(argList, '--message', message);
    addArg(argList, '--agent', params.agent);
    addArg(argList, '--to', params.to);
    addArg(argList, '--session-id', params.session_id ?? params.sessionId);
    addArg(argList, '--thinking', params.thinking);
    if (params.deliver) argList.push('--deliver');
    addArg(argList, '--reply-channel', params.reply_channel ?? params.replyChannel);
    addArg(argList, '--reply-to', params.reply_to ?? params.replyTo);
    if (params.local) argList.push('--local');
  }

  const extraArgs = normalizeStringArray(params.args);
  argList.push(...extraArgs);

  const safeArgs = validateArgs(argList);

  const bin = process.env.OPENCLAW_BIN || 'openclaw';
  const cwd = params.cwd ? String(params.cwd) : undefined;

  const timeoutMs = Number(
    params.timeout_ms
      || policy?.openclaw_timeout_ms
      || process.env.OPENCLAW_TIMEOUT_MS
      || DEFAULT_TIMEOUT_MS
  );

  return new Promise((resolve, reject) => {
    const child = spawn(bin, [subcommand, ...safeArgs], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timeout);

      if (timedOut) {
        const err = new Error('OpenClaw command timed out');
        err.stdout = stdout;
        err.stderr = stderr;
        err.code = 'TIMEOUT';
        reject(err);
        return;
      }

      if (code === 0) {
        resolve({ ok: true, stdout, stderr, subcommand, args: safeArgs });
      } else {
        const err = new Error(`OpenClaw exited with code ${code}`);
        err.stdout = stdout;
        err.stderr = stderr;
        err.code = code;
        reject(err);
      }
    });
  });
}
