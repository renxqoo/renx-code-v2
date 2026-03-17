import { describe, expect, it } from 'vitest';
import * as path from 'node:path';

import { createSystemPrincipal } from '../../auth/principal';
import type { AuthorizationExecutionRequest } from '../../auth/contracts';
import type { ToolApprovalPolicy, ToolTrustLevel } from '../contracts';
import {
  createReadOnlyFileSystemPolicy,
  createWorkspaceFileSystemPolicy,
  createRestrictedNetworkPolicy,
} from '../permissions';
import { resolveOrganizationPolicy } from '../organization-policy';

const WORKSPACE_DIR = path.resolve('/workspace');

function createRequest(
  input: Partial<Pick<AuthorizationExecutionRequest, 'approvalPolicy' | 'trustLevel'>> = {}
): AuthorizationExecutionRequest {
  return {
    runtime: {
      principal: createSystemPrincipal('org-policy-test'),
    },
    sessionState: {
      hasApproval: () => false,
      grantApproval: () => undefined,
      grantPermissions: () => undefined,
      effectivePermissions: () => undefined,
    },
    toolCallId: 'call_org_policy',
    toolName: 'local_shell',
    rawArguments: '{}',
    parsedArguments: {},
    plan: {
      mutating: true,
    },
    workingDirectory: WORKSPACE_DIR,
    fileSystemPolicy:
      input.trustLevel === 'unknown' || input.trustLevel === undefined
        ? createReadOnlyFileSystemPolicy(WORKSPACE_DIR)
        : createWorkspaceFileSystemPolicy(WORKSPACE_DIR),
    networkPolicy: createRestrictedNetworkPolicy(),
    approvalPolicy: (input.approvalPolicy || 'on-request') as ToolApprovalPolicy,
    trustLevel: (input.trustLevel || 'unknown') as ToolTrustLevel,
  };
}

describe('resolveOrganizationPolicy', () => {
  it('keeps the trusted Codex-like baseline when no policy override exists', () => {
    const resolved = resolveOrganizationPolicy(createRequest());

    expect(resolved.trustLevel).toBe('unknown');
    expect(resolved.approvalPolicy).toBe('on-request');
    expect(resolved.fileSystemPolicy.writeRoots).toEqual([]);
  });

  it('re-derives the default approval policy when organization policy changes trust level', () => {
    const resolved = resolveOrganizationPolicy(createRequest(), {
      defaults: {
        trustLevel: 'untrusted',
      },
    });

    expect(resolved.trustLevel).toBe('untrusted');
    expect(resolved.approvalPolicy).toBe('unless-trusted');
    expect(resolved.fileSystemPolicy.writeRoots).toEqual([WORKSPACE_DIR]);
  });

  it('re-derives the default filesystem baseline when organization policy changes trust level', () => {
    const resolved = resolveOrganizationPolicy(createRequest(), {
      defaults: {
        trustLevel: 'trusted',
      },
    });

    expect(resolved.trustLevel).toBe('trusted');
    expect(resolved.approvalPolicy).toBe('on-request');
    expect(resolved.fileSystemPolicy.writeRoots).toEqual([WORKSPACE_DIR]);
  });

  it('preserves explicit approval policy overrides when trust level changes', () => {
    const resolved = resolveOrganizationPolicy(
      createRequest({
        approvalPolicy: 'never',
      }),
      {
        defaults: {
          trustLevel: 'untrusted',
        },
      }
    );

    expect(resolved.trustLevel).toBe('untrusted');
    expect(resolved.approvalPolicy).toBe('never');
  });
});
