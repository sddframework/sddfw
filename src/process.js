import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import path from 'node:path';

// Launch known npm shims through Node rather than introducing a shell/quoting boundary.
export function resolveInvocation(command, args, { platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32') return { command, args };
  const name = path.basename(command).replace(/\.(cmd|exe)$/i, '');
  const scripts = { npm: 'node_modules/npm/bin/npm-cli.js', codex: 'node_modules/@openai/codex/bin/codex.js', claude: 'node_modules/@anthropic-ai/claude-code/cli.js' };
  for (const dir of (env.PATH ?? env.Path ?? '').split(';')) {
    if (existsSync(path.join(dir, `${name}.exe`))) return { command: path.join(dir, `${name}.exe`), args };
    if (scripts[name] && existsSync(path.join(dir, scripts[name]))) return { command: process.execPath, args: [path.join(dir, scripts[name]), ...args] };
  }
  if (/\.cmd$/i.test(command)) throw new Error(`Cannot resolve the ${name} Windows shim. Install the native CLI or use manual mode.`);
  return { command, args };
}

export function execute(command, args, { cwd, env = {}, input, logFile, timeoutMs = 600_000, quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const invocation = resolveInvocation(command, args);
    const child = spawn(invocation.command, invocation.args, { cwd, env: { ...process.env, ...env }, shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const log = logFile ? createWriteStream(logFile, { mode: 0o600 }) : null;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 3000).unref(); }, timeoutMs);
    const interrupt = () => child.kill('SIGTERM');
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    for (const [stream, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) stream.on('data', data => { if (!quiet) target.write(data); log?.write(data); });
    child.once('error', error => { clearTimeout(timer); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); log?.end(); reject(new Error(`Cannot start ${command}: ${error.message}`)); });
    child.once('close', (code, signal) => {
      clearTimeout(timer); process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); log?.end();
      resolve({ code: code ?? 1, signal, timedOut });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input ?? '');
  });
}
