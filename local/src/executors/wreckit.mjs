import { spawn } from 'child_process';
import path from 'path';

const ALLOWED_COMMANDS = new Set([
  'status',
  'list',
  'show',
  'run',
  'next',
  'ideas',
  'doctor',
  'rollback',
  'init',
  'research',
  'plan',
  'implement',
  'pr',
  'complete'
]);

function buildArgs(step) {
  const params = step.params || {};
  const command = params.command;

  if (!command || !ALLOWED_COMMANDS.has(command)) {
    throw new Error(`Invalid or missing Wreckit command: ${command || 'none'}`);
  }

  const wrapper = process.env.WRECKIT_WRAPPER
    || '/Users/speed/.openclaw/workspace/wreckit/scripts/run-wreckit.mjs';

  const args = [wrapper, '--command', command];

  // Always enable verbose for better observability in autonomous mode
  args.push('--verbose');

  if (params.id) args.push('--id', String(params.id));
  if (params.cwd) args.push('--cwd', String(params.cwd));
  if (params.parallel) args.push('--parallel', String(params.parallel));
  if (params.verbose) args.push('--verbose');
  if (params.dry_run) args.push('--dry-run');
  if (params.max_items) args.push('--max-items', String(params.max_items));
  if (params.force) args.push('--force');

  return { wrapper, args };
}

export function runWreckit(step) {
  const { wrapper, args } = buildArgs(step);
  const nodePath = process.env.NODE_BIN || 'node';
  const cwd = step.params?.cwd ? String(step.params.cwd) : undefined;

  return new Promise((resolve, reject) => {
    const child = spawn(nodePath, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const s = chunk.toString();
      stdout += s;
      process.stdout.write(s); // LIVE STREAM
    });

    child.stderr.on('data', (chunk) => {
      const s = chunk.toString();
      stderr += s;
      process.stderr.write(s); // LIVE STREAM
    });

    child.on('error', (err) => reject(err));

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true, stdout, stderr, wrapper });
      } else {
        const err = new Error(`Wreckit exited with code ${code}`);
        err.stdout = stdout;
        err.stderr = stderr;
        err.code = code;
        reject(err);
      }
    });
  });
}
