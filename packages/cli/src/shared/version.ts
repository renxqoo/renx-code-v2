import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { CommandContext } from './types.js';

export function resolveCliVersion(ctx: CommandContext): string {
  if (ctx.env.RENX_VERSION?.trim()) {
    return ctx.env.RENX_VERSION.trim();
  }

  const packageJsonPath = path.join(ctx.repoRoot, 'packages', 'cli', 'package.json');
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: string };
    if (parsed.version) {
      return parsed.version;
    }
  } catch {
    // Ignore and fall through
  }

  return '0.0.0';
}
