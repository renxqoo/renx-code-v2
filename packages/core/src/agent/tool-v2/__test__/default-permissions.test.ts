import { describe, expect, it } from 'vitest';
import * as path from 'node:path';

import {
  createDefaultToolExecutionBaseline,
  isDerivedDefaultFileSystemPolicy,
  resolveDefaultFileSystemPolicyForTrust,
} from '../default-permissions';

describe('default-permissions', () => {
  it('uses unknown as the default trust baseline', () => {
    const workspaceDir = path.resolve('/workspace');
    const baseline = createDefaultToolExecutionBaseline({
      workingDirectory: workspaceDir,
    });

    expect(baseline.trustLevel).toBe('unknown');
    expect(baseline.approvalPolicy).toBe('on-request');
    expect(baseline.fileSystemPolicy).toEqual({
      mode: 'restricted',
      readRoots: [workspaceDir],
      writeRoots: [],
    });
  });

  it('maps trusted workspaces to workspace-write defaults', () => {
    const workspaceDir = path.resolve('/workspace');
    const fileSystemPolicy = resolveDefaultFileSystemPolicyForTrust(workspaceDir, 'trusted');

    expect(fileSystemPolicy).toEqual({
      mode: 'restricted',
      readRoots: [workspaceDir],
      writeRoots: [workspaceDir],
    });
    expect(isDerivedDefaultFileSystemPolicy(fileSystemPolicy, workspaceDir, 'trusted')).toBe(true);
  });
});
