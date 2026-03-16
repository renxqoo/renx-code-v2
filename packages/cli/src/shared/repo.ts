import { existsSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';

const REPO_MARKERS = [
  'pnpm-workspace.yaml',
  join('packages', 'core', 'src', 'index.ts'),
  join('packages', 'cli', 'package.json'),
  join('packages', 'tui', 'package.json'),
];

function hasRepoMarkers(dir: string): boolean {
  return REPO_MARKERS.every((marker) => existsSync(join(dir, marker)));
}

function findRepoRoot(startDir: string): string | null {
  let current = resolve(startDir);
  const { root } = parse(current);

  while (true) {
    if (hasRepoMarkers(current)) {
      return current;
    }
    if (current === root) {
      break;
    }
    current = dirname(current);
  }

  return null;
}

export function resolveRepoRoot(): string {
  const explicit = process.env.AGENT_REPO_ROOT?.trim();
  if (explicit) {
    return resolve(explicit);
  }

  const discovered = findRepoRoot(process.cwd());
  if (discovered) {
    return discovered;
  }

  throw new Error(
    'Unable to resolve repository root. Set AGENT_REPO_ROOT to the renx repository path.'
  );
}

export function resolveWorkspaceRoot(): string {
  const explicit = process.env.AGENT_WORKDIR?.trim();
  if (explicit) {
    return resolve(explicit);
  }
  return resolve(process.cwd());
}
