import { existsSync } from 'node:fs';
import path from 'node:path';

import { CliUsageError } from '../shared/errors.js';
import { runInherited, resolveBunExecutable } from '../shared/process.js';
import { resolveCliVersion } from '../shared/version.js';
import type { CommandContext, CommandResult } from '../shared/types.js';

export async function runTuiCommand(ctx: CommandContext): Promise<CommandResult> {
  const bun = resolveBunExecutable(ctx.env);
  if (!bun) {
    throw new CliUsageError('Bun runtime is required to launch TUI. Set RENX_BUN_PATH or install Bun.');
  }

  const distEntry = path.join(ctx.repoRoot, 'packages', 'tui', 'dist', 'index.js');
  const sourceEntry = path.join(ctx.repoRoot, 'packages', 'tui', 'src', 'index.tsx');
  const entry = existsSync(distEntry) ? distEntry : sourceEntry;

  if (!existsSync(entry)) {
    throw new CliUsageError('Unable to locate TUI entrypoint. Build @renx-code/tui or ensure source exists.');
  }

  const child = runInherited(bun, ['run', entry, ...ctx.argv], {
    cwd: ctx.cwd,
    env: {
      ...ctx.env,
      RENX_VERSION: resolveCliVersion(ctx),
      AGENT_WORKDIR: ctx.cwd,
      AGENT_REPO_ROOT: ctx.repoRoot,
    },
  });

  if (child.error) {
    throw child.error;
  }

  return {
    exitCode: typeof child.status === 'number' ? child.status : 1,
  };
}
