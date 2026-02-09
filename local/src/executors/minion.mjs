import { runWreckit } from './wreckit.mjs';
import { spawn } from 'child_process';

const ALLOWED_SHELL_COMMANDS = ['git', 'vercel', 'npm', 'echo', 'mkdir', 'ls', 'cat', 'touch', 'rm', 'sh', 'node', 'bun'];
const DEFAULT_TIMEOUT_MS = 45 * 60 * 1000; // 45 minutes — must be longer than run-wreckit.mjs watchdog (15min) to allow multiple wreckit iterations + polish + GitHub

export async function runMinion(step) {
  const params = step.params || {};

  // If 'command' is one of the Wreckit commands, use runWreckit (which has its own timeout+signal handling)
  const WRECKIT_COMMANDS = ['status', 'list', 'show', 'run', 'next', 'ideas', 'doctor', 'rollback', 'init', 'research', 'plan', 'implement', 'pr', 'complete'];

  if (WRECKIT_COMMANDS.includes(params.command)) {
    console.log(`[Minion] Powering up Wreckit for: ${params.command}`);

    // Route ALL wreckit commands through runWreckit — including 'ideas' with content.
    // For 'ideas' with inline content, write to temp file and pass --file flag.
    if (params.command === 'ideas' && params.idea) {
       const fs = await import('fs/promises');
       const tempFile = `/tmp/wreckit-idea-${Date.now()}.md`;
       await fs.writeFile(tempFile, params.idea);
       step.params = { ...params, command: 'ideas', args: ['--file', tempFile] };
    }
    return await runWreckit(step);
  }

  // Otherwise, fall back to safe shell commands for "The Builder" tasks
  let { command, args, cwd } = params;

  if (!command) {
    throw new Error('Minion step requires a "command" parameter (or a Wreckit command)');
  }

  if (!ALLOWED_SHELL_COMMANDS.includes(command)) {
    throw new Error(`Minion shell fallback is not allowed to run: ${command}`);
  }

  const workingDir = cwd || process.cwd();
  const timeoutMs = Number(process.env.MINION_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

  return new Promise((resolve, reject) => {
    console.log(`[Minion] Executing shell command: ${command} ${args ? args.join(' ') : ''} (timeout: ${Math.round(timeoutMs / 1000)}s)`);

    const child = spawn(command, args || [], {
      cwd: workingDir,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: process.env.ZAI_API_KEY || process.env.OPENAI_API_KEY,
        ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/paas/v4',
        ZAI_API_KEY: process.env.ZAI_API_KEY,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY
      }
    });

    // Watchdog: kill hung child after timeout
    const watchdog = setTimeout(() => {
      console.error(`[Minion] Timeout after ${Math.round(timeoutMs / 1000)}s — killing child`);
      child.kill('SIGTERM');
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5000);
    }, timeoutMs);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => stdout += chunk.toString());
    child.stderr.on('data', (chunk) => stderr += chunk.toString());

    child.on('error', (err) => {
      clearTimeout(watchdog);
      reject(err);
    });

    child.on('close', (code, signal) => {
      clearTimeout(watchdog);
      if (code === 0 && !signal) {
        resolve({ ok: true, stdout, stderr, executed: `${command} ${args ? args.join(' ') : ''}` });
      } else {
        const exitCode = typeof code === 'number' ? code : 1;
        const reason = signal ? `killed by ${signal}` : `code ${exitCode}`;
        const err = new Error(`Minion command failed (${reason})`);
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}