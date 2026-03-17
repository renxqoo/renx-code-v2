import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ToolSessionState } from '../../tool-v2/context';
import {
  createRestrictedNetworkPolicy,
  createWorkspaceFileSystemPolicy,
} from '../../tool-v2/permissions';
import { createConfiguredAuthorizationService } from '../authorization-service';
import { FileAuthorizationAuditStore } from '../audit-service';
import { createDefaultUserPrincipal } from '../principal';

describe('AuthorizationService', () => {
  let workspaceDir: string;
  let storageDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-auth-workspace-'));
    storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-auth-storage-'));
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
    await fs.rm(storageDir, { recursive: true, force: true });
  });

  it('restores session permission grants from persistent storage across service instances', async () => {
    const principal = createDefaultUserPrincipal('user-auth-test');
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-auth-outside-'));
    const outsideFile = path.join(outsideDir, 'note.txt');
    await fs.writeFile(outsideFile, 'hello', 'utf8');

    try {
      const firstService = createConfiguredAuthorizationService({
        baseDir: storageDir,
        policyVersion: 'auth-test',
      });
      const firstState = new ToolSessionState();

      const explicitGrant = await firstService.requestPermissions({
        runtime: {
          principal,
          sessionId: 'session-permission-1',
          requestPermissions: async (request) => ({
            granted: request.permissions,
            scope: 'session',
            grantedBy: 'reviewer-a',
          }),
        },
        sessionState: firstState,
        toolCallId: 'call_perm_1',
        toolName: 'request_permissions',
        workingDirectory: workspaceDir,
        requestedScope: 'session',
        reason: `Read ${outsideFile}`,
        permissions: {
          fileSystem: {
            read: [outsideDir],
          },
        },
      });

      expect(explicitGrant.scope).toBe('session');
      expect(firstState.effectivePermissions()).toMatchObject({
        fileSystem: {
          read: [outsideDir],
        },
      });

      const secondService = createConfiguredAuthorizationService({
        baseDir: storageDir,
        policyVersion: 'auth-test',
      });
      const secondState = new ToolSessionState();
      const second = await secondService.authorizeExecution({
        runtime: {
          principal,
          sessionId: 'session-permission-1',
        },
        sessionState: secondState,
        toolCallId: 'call_perm_2',
        toolName: 'read_file',
        rawArguments: JSON.stringify({ path: outsideFile }),
        parsedArguments: { path: outsideFile },
        plan: {
          mutating: false,
          readPaths: [outsideFile],
        },
        workingDirectory: workspaceDir,
        fileSystemPolicy: createWorkspaceFileSystemPolicy(workspaceDir),
        networkPolicy: createRestrictedNetworkPolicy(),
        approvalPolicy: 'on-request',
      });

      expect(second.decision.outcome).toBe('allow');
      expect(secondState.effectivePermissions()).toMatchObject({
        fileSystem: {
          read: [outsideDir],
        },
      });
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('restores session approvals from persistent storage across service instances', async () => {
    const principal = createDefaultUserPrincipal('user-approval-test');
    const targetFile = path.join(workspaceDir, 'approved.txt');
    const firstService = createConfiguredAuthorizationService({
      baseDir: storageDir,
      policyVersion: 'auth-test',
    });
    const firstState = new ToolSessionState();

    const first = await firstService.authorizeExecution({
      runtime: {
        principal,
        sessionId: 'session-approval-1',
        requestApproval: async () => ({
          approved: true,
          scope: 'session',
          approverId: 'approver-1',
        }),
      },
      sessionState: firstState,
      toolCallId: 'call_approval_1',
      toolName: 'write_file',
      rawArguments: JSON.stringify({ path: targetFile }),
      parsedArguments: { path: targetFile },
      plan: {
        mutating: true,
        writePaths: [targetFile],
        approval: {
          required: true,
          reason: `Write file ${targetFile}`,
          key: `write:${targetFile}`,
        },
      },
      workingDirectory: workspaceDir,
      fileSystemPolicy: createWorkspaceFileSystemPolicy(workspaceDir),
      networkPolicy: createRestrictedNetworkPolicy(),
      approvalPolicy: 'on-request',
    });

    expect(first.decision.outcome).toBe('allow');

    const secondService = createConfiguredAuthorizationService({
      baseDir: storageDir,
      policyVersion: 'auth-test',
    });
    const secondState = new ToolSessionState();
    const second = await secondService.authorizeExecution({
      runtime: {
        principal,
        sessionId: 'session-approval-1',
      },
      sessionState: secondState,
      toolCallId: 'call_approval_2',
      toolName: 'write_file',
      rawArguments: JSON.stringify({ path: targetFile }),
      parsedArguments: { path: targetFile },
      plan: {
        mutating: true,
        writePaths: [targetFile],
        approval: {
          required: true,
          reason: `Write file ${targetFile}`,
          key: `write:${targetFile}`,
        },
      },
      workingDirectory: workspaceDir,
      fileSystemPolicy: createWorkspaceFileSystemPolicy(workspaceDir),
      networkPolicy: createRestrictedNetworkPolicy(),
      approvalPolicy: 'on-request',
    });

    expect(second.decision.outcome).toBe('allow');
    expect(second.decision.approval).toMatchObject({
      required: true,
      resolved: true,
      cached: true,
    });
  });

  it('writes authorization audit records with principal and session metadata', async () => {
    const principal = createDefaultUserPrincipal('user-audit-test');
    const service = createConfiguredAuthorizationService({
      baseDir: storageDir,
      policyVersion: 'auth-audit-v1',
    });

    await service.authorizeExecution({
      runtime: {
        principal,
        sessionId: 'session-audit-1',
      },
      sessionState: new ToolSessionState(),
      toolCallId: 'call_audit_1',
      toolName: 'read_file',
      rawArguments: JSON.stringify({ path: path.join(workspaceDir, 'a.txt') }),
      parsedArguments: { path: path.join(workspaceDir, 'a.txt') },
      plan: {
        mutating: false,
        readPaths: [path.join(workspaceDir, 'a.txt')],
      },
      workingDirectory: workspaceDir,
      fileSystemPolicy: createWorkspaceFileSystemPolicy(workspaceDir),
      networkPolicy: createRestrictedNetworkPolicy(),
      approvalPolicy: 'on-request',
    });

    const records = await new FileAuthorizationAuditStore({
      filePath: path.join(storageDir, 'authorization-audit.json'),
    }).list({
      principalId: principal.principalId,
      sessionId: 'session-audit-1',
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      toolCallId: 'call_audit_1',
      principalId: principal.principalId,
      sessionId: 'session-audit-1',
      policyVersion: 'auth-audit-v1',
    });
  });
});
