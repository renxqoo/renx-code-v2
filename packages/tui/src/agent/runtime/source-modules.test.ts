import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveRepoRoot } from './source-modules';

beforeEach(() => {
  delete process.env.AGENT_REPO_ROOT;
  delete process.env.AGENT_WORKDIR;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveRepoRoot', () => {
  it('resolves the monorepo root from a nested cli cwd by default', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'renx-cli-repo-root-'));
    mkdirSync(join(repoRoot, 'packages', 'core', 'src'), { recursive: true });
    mkdirSync(join(repoRoot, 'packages', 'cli'), { recursive: true });
    writeFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    writeFileSync(join(repoRoot, 'packages', 'core', 'src', 'index.ts'), 'export {};\n');
    writeFileSync(join(repoRoot, 'packages', 'cli', 'package.json'), '{"name":"cli"}\n');
    vi.spyOn(process, 'cwd').mockReturnValue(join(repoRoot, 'packages', 'cli'));

    expect(resolveRepoRoot()).toBe(repoRoot);
  });

  it('respects AGENT_REPO_ROOT when provided', () => {
    process.env.AGENT_REPO_ROOT = '/tmp/coding-agent-v2';
    vi.spyOn(process, 'cwd').mockReturnValue('/tmp/example-workspace');

    expect(resolveRepoRoot()).toBe(resolve('/tmp/coding-agent-v2'));
  });
});
