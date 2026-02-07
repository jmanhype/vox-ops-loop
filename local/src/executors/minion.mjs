import { runWreckit } from './wreckit.mjs';
import { spawn } from 'child_process';

const ALLOWED_SHELL_COMMANDS = ['git', 'vercel', 'npm', 'echo', 'mkdir', 'ls', 'cat', 'touch', 'rm', 'sh', 'node', 'bun'];

export async function runMinion(step) {
  const params = step.params || {};
  
  // If 'command' is one of the Wreckit commands, use runWreckit
  const WRECKIT_COMMANDS = ['status', 'list', 'show', 'run', 'next', 'ideas', 'doctor', 'rollback', 'init', 'research', 'plan', 'implement', 'pr', 'complete'];
  
  if (WRECKIT_COMMANDS.includes(params.command)) {
    console.log(`[Minion] Powering up Wreckit for: ${params.command}`);
    
    // Special handling for 'ideas' to pipe content
    if (params.command === 'ideas' && params.idea) {
       params.args = ['ideas'];
       // We will let the shell handle the pipe in the fallback below or use a different approach.
       // For simplicity, let's fall through to shell fallback if it's 'ideas' with a string.
    } else {
       return await runWreckit(step);
    }
  }

  // Otherwise, fall back to safe shell commands for "The Builder" tasks
  let { command, args, cwd } = params;

  if (command === 'ideas' && params.idea) {
     // Write idea to a temporary file first
     const tempFile = `/tmp/wreckit-idea-${Date.now()}.md`;
     const fs = await import('fs/promises');
     await fs.writeFile(tempFile, params.idea);
     
     command = 'bun';
     const wreckitPath = '/Users/speed/.openclaw/workspace/wreckit-repo/dist/index.js';
     args = ['run', wreckitPath, '--cwd', '/Users/speed/.openclaw/workspace', 'ideas', '--file', tempFile];
  }

  if (!command) {
    throw new Error('Minion step requires a "command" parameter (or a Wreckit command)');
  }

  if (!ALLOWED_SHELL_COMMANDS.includes(command)) {
    throw new Error(`Minion shell fallback is not allowed to run: ${command}`);
  }

  const workingDir = cwd || process.cwd();

  return new Promise((resolve, reject) => {
    console.log(`[Minion] Executing shell command: ${command} ${args ? args.join(' ') : ''}`);
    
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
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => stdout += chunk.toString());
    child.stderr.on('data', (chunk) => stderr += chunk.toString());

    child.on('error', (err) => reject(err));

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true, stdout, stderr, executed: `${command} ${args ? args.join(' ') : ''}` });
      } else {
        const err = new Error(`Minion command failed with code ${code}`);
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}