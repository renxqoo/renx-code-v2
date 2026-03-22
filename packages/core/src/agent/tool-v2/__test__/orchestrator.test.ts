import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthorizationService } from '../../auth/authorization-service';
import { createSystemPrincipal } from '../../auth/principal';
import { ToolSessionState, type ToolExecutionContext } from '../context';
import type { ToolApprovalRequest, ToolExecutionEvent, ToolPermissionRequest } from '../contracts';
import { ReadFileToolV2 } from '../handlers/read-file';
import { RequestPermissionsToolV2 } from '../handlers/request-permissions';
import { LocalShellToolV2 } from '../handlers/shell';
import { createRestrictedNetworkPolicy, createWorkspaceFileSystemPolicy } from '../permissions';
import type {
  ShellRuntimeCapabilities,
  ShellRuntime,
  ShellRuntimeRequest,
  ShellRuntimeResult,
} from '../runtimes/shell-runtime';
import { EnterpriseToolSystem } from '../tool-system';

describe('tool-v2 orchestrator', () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-tool-v2-orchestrator-'));
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it('caches turn approvals and emits lifecycle events without breaking execution', async () => {
    const runtime = new RecordingShellRuntime();
    const approvalRequests: ToolApprovalRequest[] = [];
    const events: ToolExecutionEvent[] = [];
    const system = new EnterpriseToolSystem([
      new LocalShellToolV2({
        runtime,
        approvalMode: 'always',
      }),
    ]);
    const sessionState = new ToolSessionState();
    const context = createContext(workspaceDir, sessionState, {
      approve: async (request) => {
        approvalRequests.push(request);
        return {
          approved: true,
          scope: 'turn',
        };
      },
      onEvent: async (event) => {
        events.push(event);
        if (event.stage === 'planned') {
          throw new Error('observer failure should be swallowed');
        }
      },
    });

    const first = await system.execute(
      {
        toolCallId: 'shell-1',
        toolName: 'local_shell',
        arguments: JSON.stringify({
          command: 'ls',
        }),
      },
      context
    );
    const second = await system.execute(
      {
        toolCallId: 'shell-2',
        toolName: 'local_shell',
        arguments: JSON.stringify({
          command: 'ls',
        }),
      },
      context
    );

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(runtime.requests).toHaveLength(2);
    expect(approvalRequests).toHaveLength(1);
    expect(approvalRequests[0]?.commandPreview).toBe('ls');
    expect(events.map((event) => event.stage)).toContain('approval_requested');
    expect(events.map((event) => event.stage)).toContain('succeeded');
    expect(
      events.some((event) => event.stage === 'approval_resolved' && event.metadata?.cached === true)
    ).toBe(true);
  });

  it('passes the active tool call id to the permission resolver', async () => {
    const requests: ToolPermissionRequest[] = [];
    const system = new EnterpriseToolSystem([new RequestPermissionsToolV2()]);
    const sessionState = new ToolSessionState();

    const result = await system.execute(
      {
        toolCallId: 'perm-123',
        toolName: 'request_permissions',
        arguments: JSON.stringify({
          scope: 'turn',
          permissions: {
            network: {
              enabled: true,
              allowedHosts: ['example.com'],
            },
          },
        }),
      },
      createContext(workspaceDir, sessionState, {
        requestPermissions: async (request) => {
          requests.push(request);
          return {
            granted: request.permissions,
            scope: 'turn',
          };
        },
      })
    );

    expect(result.success).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.toolCallId).toBe('perm-123');
    expect(requests[0]?.requestedScope).toBe('turn');
  });

  it('requests missing filesystem permissions before executing read_file outside the workspace', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-tool-v2-outside-'));
    const targetFile = path.join(outsideDir, 'note.txt');
    await fs.writeFile(targetFile, 'outside content', 'utf8');
    const requests: ToolPermissionRequest[] = [];
    const sessionState = new ToolSessionState();
    const system = new EnterpriseToolSystem([new ReadFileToolV2()]);

    const result = await system.execute(
      {
        toolCallId: 'read-outside',
        toolName: 'read_file',
        arguments: JSON.stringify({
          path: targetFile,
        }),
      },
      createContext(workspaceDir, sessionState, {
        requestPermissions: async (request) => {
          requests.push(request);
          return {
            granted: request.permissions,
            scope: 'turn',
          };
        },
      })
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain('outside content');
    expect(requests).toHaveLength(1);
    expect(requests[0]?.permissions).toMatchObject({
      fileSystem: {
        read: [outsideDir],
      },
    });
    expect(sessionState.effectivePermissions()).toMatchObject({
      fileSystem: {
        read: [outsideDir],
      },
    });

    await fs.rm(outsideDir, { recursive: true, force: true });
  });

  it('reuses a granted directory permission for multiple files in the same folder', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-tool-v2-shared-dir-'));
    const firstFile = path.join(outsideDir, 'one.txt');
    const secondFile = path.join(outsideDir, 'two.txt');
    await fs.writeFile(firstFile, 'first', 'utf8');
    await fs.writeFile(secondFile, 'second', 'utf8');
    const requests: ToolPermissionRequest[] = [];
    const sessionState = new ToolSessionState();
    const system = new EnterpriseToolSystem([new ReadFileToolV2()]);

    const first = await system.execute(
      {
        toolCallId: 'read-first',
        toolName: 'read_file',
        arguments: JSON.stringify({ path: firstFile }),
      },
      createContext(workspaceDir, sessionState, {
        requestPermissions: async (request) => {
          requests.push(request);
          return {
            granted: request.permissions,
            scope: 'turn',
          };
        },
      })
    );
    const second = await system.execute(
      {
        toolCallId: 'read-second',
        toolName: 'read_file',
        arguments: JSON.stringify({ path: secondFile }),
      },
      createContext(workspaceDir, sessionState, {
        requestPermissions: async (request) => {
          requests.push(request);
          return {
            granted: request.permissions,
            scope: 'turn',
          };
        },
      })
    );

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.permissions).toMatchObject({
      fileSystem: {
        read: [outsideDir],
      },
    });

    await fs.rm(outsideDir, { recursive: true, force: true });
  });

  it('never promotes granted permission scope beyond what was requested', async () => {
    const system = new EnterpriseToolSystem([new RequestPermissionsToolV2()]);
    const sessionState = new ToolSessionState();

    const result = await system.execute(
      {
        toolCallId: 'perm-scope',
        toolName: 'request_permissions',
        arguments: JSON.stringify({
          scope: 'turn',
          permissions: {
            network: {
              enabled: true,
              allowedHosts: ['example.com'],
            },
          },
        }),
      },
      createContext(workspaceDir, sessionState, {
        requestPermissions: async (request) => ({
          granted: request.permissions,
          scope: 'session',
        }),
      })
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.structured).toMatchObject({
      scope: 'turn',
    });
    expect(sessionState.effectivePermissions()).toMatchObject({
      network: {
        enabled: true,
        allowedHosts: ['example.com'],
      },
    });
  });

  it('applies direct policy interception before execution when configured on the tool system context', async () => {
    const runtime = new RecordingShellRuntime();
    const system = new EnterpriseToolSystem([new LocalShellToolV2({ runtime })]);

    const result = await system.execute(
      {
        toolCallId: 'shell-policy',
        toolName: 'local_shell',
        arguments: JSON.stringify({
          command: 'ls',
        }),
      },
      createContext(workspaceDir, new ToolSessionState(), {
        onPolicyCheck: async () => ({
          allowed: false,
          code: 'DIRECT_POLICY',
          message: 'blocked by direct system policy',
        }),
      })
    );

    expect(result.success).toBe(false);
    expect(runtime.requests).toHaveLength(0);
    if (result.success) {
      return;
    }
    expect(result.error.errorCode).toBe('TOOL_V2_POLICY_DENIED');
    expect(result.output).toContain('DIRECT_POLICY');
  });
});

class RecordingShellRuntime implements ShellRuntime {
  readonly requests: ShellRuntimeRequest[] = [];
  private readonly capabilities: ShellRuntimeCapabilities = {
    sandboxing: [
      { mode: 'workspace-write', enforcement: 'advisory' },
      { mode: 'full-access', enforcement: 'advisory' },
    ],
    escalation: {
      supported: true,
    },
  };

  getCapabilities(): ShellRuntimeCapabilities {
    return this.capabilities;
  }

  async execute(request: ShellRuntimeRequest): Promise<ShellRuntimeResult> {
    this.requests.push(request);
    await request.onStdout?.('ok');
    return {
      exitCode: 0,
      timedOut: false,
      aborted: false,
      output: 'ok',
    };
  }
}

function createContext(
  workspaceDir: string,
  sessionState: ToolSessionState,
  overrides: Partial<Omit<ToolExecutionContext, 'authorization'>> & {
    approve?: ToolExecutionContext['authorization']['requestApproval'];
    requestPermissions?: ToolExecutionContext['authorization']['requestPermissions'];
    onPolicyCheck?: ToolExecutionContext['authorization']['evaluatePolicy'];
  } = {}
): ToolExecutionContext {
  const { approve, requestPermissions, onPolicyCheck, ...contextOverrides } = overrides;
  return {
    workingDirectory: workspaceDir,
    sessionState,
    authorization: {
      service: new AuthorizationService(),
      principal: createSystemPrincipal('tool-v2-orchestrator-test'),
      requestApproval:
        approve ||
        (async () => ({
          approved: true,
          scope: 'turn',
        })),
      requestPermissions,
      evaluatePolicy: onPolicyCheck,
    },
    fileSystemPolicy: createWorkspaceFileSystemPolicy(workspaceDir),
    networkPolicy: createRestrictedNetworkPolicy(),
    approvalPolicy: 'on-request',
    ...contextOverrides,
  };
}
