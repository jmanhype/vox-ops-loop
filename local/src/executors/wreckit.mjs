
import { spawn } from 'child_process';

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

export async function runWreckit(step) {
  const params = step.params || {};
  const command = params.command || 'status';
  const args = params.args || [];

  // Construct arguments for run-wreckit.mjs
  // Usage: node run-wreckit.mjs --command <cmd> [args...]

  const scriptPath = '/Users/speed/.openclaw/workspace/wreckit/scripts/run-wreckit.mjs';
  const finalArgs = ['run', scriptPath, '--command', command, ...args];

  if (params.cwd) finalArgs.push('--cwd', params.cwd);
  if (params.item) finalArgs.push('--id', params.item); // map item -> id

  const timeoutMs = Number(process.env.WRECKIT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  console.log(`[Wreckit Executor] Running: bun ${finalArgs.join(' ')} (timeout: ${Math.round(timeoutMs / 1000)}s)`);

  return new Promise((resolve, reject) => {
    const child = spawn('bun', finalArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
          ...process.env,
          ANTHROPIC_API_KEY: process.env.ZAI_API_KEY || process.env.OPENAI_API_KEY,
          ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/paas/v4',
          ZAI_API_KEY: process.env.ZAI_API_KEY
      }
    });

    // Watchdog: kill hung child after timeout
    const watchdog = setTimeout(() => {
      console.error(`[Wreckit Executor] Timeout after ${Math.round(timeoutMs / 1000)}s — killing child`);
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
        resolve({ ok: true, stdout, stderr });
      } else {
        const exitCode = typeof code === 'number' ? code : 1;
        const reason = signal ? `killed by ${signal}` : `code ${exitCode}`;
        const err = new Error(`Wreckit command failed (${reason})`);
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}
