import { describe, expect, it } from 'vitest';
import { ToolSessionState, type ToolExecutionContext } from '../context';
import { LocalShellToolV2 } from '../handlers/shell';
import { createRestrictedNetworkPolicy, createWorkspaceFileSystemPolicy } from '../permissions';
import { BrokeredShellRuntime } from '../runtimes/brokered-shell-runtime';
import type {
  ShellRuntime,
  ShellRuntimeCapabilities,
  ShellRuntimeRequest,
  ShellRuntimeResult,
} from '../runtimes/shell-runtime';
import { createRuleBasedShellCommandPolicy } from '../shell-policy';
import { EnterpriseToolSystem } from '../tool-system';

describe('shell runtime adapters', () => {
  it('routes sandboxed and escalated executions through the brokered runtime', async () => {
    const sandboxedRuntime = new RecordingRuntime({
      sandboxing: [
        { mode: 'workspace-write', enforcement: 'enforced' },
        { mode: 'full-access', enforcement: 'advisory' },
      ],
      escalation: {
        supported: false,
      },
    });
    const escalatedRuntime = new RecordingRuntime({
      sandboxing: [{ mode: 'full-access', enforcement: 'advisory' }],
      escalation: {
        supported: true,
      },
    });
    const runtime = new BrokeredShellRuntime({
      sandboxedRuntime,
      escalatedRuntime,
    });
    const system = new EnterpriseToolSystem([
      new LocalShellToolV2({
        runtime,
        approvalMode: 'policy',
        policy: createRuleBasedShellCommandPolicy({
          rules: [
            {
              name: 'git-commit',
              pattern: [{ token: 'git' }, { token: 'commit' }],
              decision: 'prompt',
              justification: 'git commit requires escalation',
              preferredSandbox: 'full-access',
            },
          ],
        }),
      }),
    ]);

    const sandboxedResult = await system.execute(
      {
        callId: 'sandboxed',
        toolName: 'local_shell',
        arguments: JSON.stringify({
          command: 'pwd',
        }),
      },
      createContext()
    );
    const escalatedResult = await system.execute(
      {
        callId: 'escalated',
        toolName: 'local_shell',
        arguments: JSON.stringify({
          command: 'git commit -m "x"',
        }),
      },
      createContext()
    );

    expect(sandboxedResult.success).toBe(true);
    expect(escalatedResult.success).toBe(true);
    expect(sandboxedRuntime.requests).toHaveLength(1);
    expect(sandboxedRuntime.requests[0]?.executionMode).toBe('sandboxed');
    expect(escalatedRuntime.requests).toHaveLength(1);
    expect(escalatedRuntime.requests[0]?.executionMode).toBe('escalated');
  });

  it('syncs sandbox-state updates into runtimes that support Codex-style state transport', async () => {
    const runtime = new SandboxStateRecordingRuntime({
      sandboxing: [{ mode: 'full-access', enforcement: 'advisory' }],
      escalation: {
        supported: false,
      },
    });
    const system = new EnterpriseToolSystem([
      new LocalShellToolV2({
        runtime,
        approvalMode: 'policy',
      }),
    ]);

    const result = await system.execute(
      {
        callId: 'sandbox-state',
        toolName: 'local_shell',
        arguments: JSON.stringify({
          command: 'ls',
        }),
      },
      createContext()
    );

    expect(result.success).toBe(true);
    expect(runtime.updatedPolicies).toHaveLength(1);
    expect(runtime.updatedPolicies[0]?.type).toBe('full-access');
    expect(runtime.updatedPolicies[0]?.environment.CODEX_SANDBOX_POLICY).toBe('full-access');
    expect(runtime.requests[0]?.sandboxPolicy?.environment.CODEX_SANDBOX_POLICY).toBe(
      'full-access'
    );
  });
});

class RecordingRuntime implements ShellRuntime {
  readonly requests: ShellRuntimeRequest[] = [];

  constructor(private readonly capabilities: ShellRuntimeCapabilities) {}

  getCapabilities(): ShellRuntimeCapabilities {
    return this.capabilities;
  }

  async execute(request: ShellRuntimeRequest): Promise<ShellRuntimeResult> {
    this.requests.push(request);
    return {
      exitCode: 0,
      timedOut: false,
      output: request.command,
    };
  }
}

class SandboxStateRecordingRuntime extends RecordingRuntime {
  readonly updatedPolicies: NonNullable<ShellRuntimeRequest['sandboxPolicy']>[] = [];

  async updateSandboxPolicy(
    policy: NonNullable<ShellRuntimeRequest['sandboxPolicy']>
  ): Promise<void> {
    this.updatedPolicies.push(policy);
  }
}

function createContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  const workspaceDir = '/tmp/renx-tool-v2-runtime';
  return {
    workingDirectory: workspaceDir,
    sessionState: new ToolSessionState(),
    fileSystemPolicy: createWorkspaceFileSystemPolicy(workspaceDir),
    networkPolicy: createRestrictedNetworkPolicy(),
    approvalPolicy: 'on-request',
    approve: async () => ({
      approved: true,
      scope: 'turn',
    }),
    ...overrides,
  };
}
