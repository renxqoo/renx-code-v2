import { existsSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const SOURCE_REPO_ROOT = resolve(THIS_DIR, '../../../../../');

const REPO_MARKERS = [
  'pnpm-workspace.yaml',
  join('packages', 'core', 'src', 'index.ts'),
  join('packages', 'cli', 'package.json'),
];

const hasRepoMarkers = (dir: string) =>
  REPO_MARKERS.every((marker) => existsSync(join(dir, marker)));

const findRepoRoot = (startDir: string): string | null => {
  let current = resolve(startDir);
  const { root } = parse(current);
  let searching = true;

  while (searching) {
    if (hasRepoMarkers(current)) {
      return current;
    }
    if (current === root) {
      searching = false;
      continue;
    }
    current = dirname(current);
  }

  return null;
};

export const resolveRepoRoot = () => {
  const explicit = process.env.AGENT_REPO_ROOT?.trim();
  if (explicit) {
    return resolve(explicit);
  }
  return findRepoRoot(process.cwd()) || SOURCE_REPO_ROOT;
};

export const resolveWorkspaceRoot = () => {
  const explicit = process.env.AGENT_WORKDIR?.trim();
  if (explicit) {
    return resolve(explicit);
  }
  return resolve(process.cwd());
};
