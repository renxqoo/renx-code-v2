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
  it('uses the current working directory by default', () => {
    vi.spyOn(process, 'cwd').mockReturnValue('D:\\temp\\example-workspace');

    expect(resolveRepoRoot()).toBe('D:\\temp\\example-workspace');
  });

  it('respects AGENT_REPO_ROOT when provided', () => {
    process.env.AGENT_REPO_ROOT = 'D:\\work\\coding-agent-v2';
    vi.spyOn(process, 'cwd').mockReturnValue('D:\\temp\\example-workspace');

    expect(resolveRepoRoot()).toBe('D:\\work\\coding-agent-v2');
  });
});
