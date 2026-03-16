import type { SpawnSyncReturns } from 'node:child_process';
import { spawnSync } from 'node:child_process';

export function resolveBunExecutable(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.RENX_BUN_PATH) {
    return env.RENX_BUN_PATH;
  }

  const candidates = process.platform === 'win32' ? ['bun.exe', 'bun.cmd', 'bun'] : ['bun'];

  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], {
      stdio: 'ignore',
      env,
    });
    if (!probe.error && probe.status === 0) {
      return candidate;
    }
  }

  return null;
}

export function runInherited(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
  }
): SpawnSyncReturns<Buffer> {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: 'inherit',
  });
}
