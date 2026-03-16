import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ToolSessionState, type ToolExecutionContext } from '../context';
import { LocalShellToolV2 } from '../handlers/shell';
import { createRestrictedNetworkPolicy, createWorkspaceFileSystemPolicy } from '../permissions';
import { BrokeredShellRuntime } from '../runtimes/brokered-shell-runtime';
import type {
  LocalProcessShellRuntime,
  ShellRuntime,
  ShellRuntimeCapabilities,
  ShellRuntimeRequest,
  ShellRuntimeResult,
} from '../runtimes/shell-runtime';
import {
  LocalProcessShellRuntime as LocalProcessShellRuntimeImpl,
  resolvePreferredShell,
} from '../runtimes/shell-runtime';
import { createRuleBasedShellCommandPolicy } from '../shell-policy';
import { EnterpriseToolSystem } from '../tool-system';

describe('shell runtime adapters', () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-tool-v2-runtime-'));
    await fs.writeFile(path.join(workspaceDir, 'sample.txt'), 'alpha\nbeta\n', 'utf8');
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it('prefers pwsh on Windows when available', () => {
    const shell = resolvePreferredShell({
      platform: 'win32',
      env: {
        SystemRoot: 'C:\\Windows',
        COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
      },
      pathExists: () => true,
      commandWorks: (candidate) => candidate === 'pwsh',
    });

    expect(shell).toEqual({
      shellPath: 'pwsh',
      flavor: 'powershell',
    });
  });

  it('falls back to Windows PowerShell before cmd.exe', () => {
    const powershellPath = path.join(
      'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    );
    const shell = resolvePreferredShell({
      platform: 'win32',
      env: {
        SystemRoot: 'C:\\Windows',
        COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
      },
      pathExists: (candidate) => candidate === powershellPath,
      commandWorks: (candidate) => candidate === powershellPath,
    });

    expect(shell).toEqual({
      shellPath: powershellPath,
      flavor: 'powershell',
    });
  });

  it('prefers the user shell on Unix-like systems when available', () => {
    const shell = resolvePreferredShell({
      platform: 'linux',
      env: {
        SHELL: '/bin/zsh',
      },
      pathExists: (candidate) => candidate === '/bin/zsh',
      commandWorks: () => true,
    });

    expect(shell).toEqual({
      shellPath: '/bin/zsh',
      flavor: 'posix',
    });
  });

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
      createContext(workspaceDir)
    );
    const escalatedResult = await system.execute(
      {
        callId: 'escalated',
        toolName: 'local_shell',
        arguments: JSON.stringify({
          command: 'git commit -m "x"',
        }),
      },
      createContext(workspaceDir)
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
      createContext(workspaceDir)
    );

    expect(result.success).toBe(true);
    expect(runtime.updatedPolicies).toHaveLength(1);
    expect(runtime.updatedPolicies[0]?.type).toBe('full-access');
    expect(runtime.updatedPolicies[0]?.environment.CODEX_SANDBOX_POLICY).toBe('full-access');
    expect(runtime.requests[0]?.sandboxPolicy?.environment.CODEX_SANDBOX_POLICY).toBe(
      'full-access'
    );
  });

  it('executes default-shell compatible inspection commands with the local process runtime', async () => {
    const runtime: LocalProcessShellRuntime = new LocalProcessShellRuntimeImpl();
    const system = new EnterpriseToolSystem([
      new LocalShellToolV2({
        runtime,
        approvalMode: 'policy',
        policy: createRuleBasedShellCommandPolicy({
          rules: [],
          fallback: {
            evaluate(command) {
              return {
                effect: 'allow',
                commands: [command],
                preferredSandbox: 'workspace-write',
                executionMode: 'sandboxed',
              };
            },
          },
        }),
      }),
    ]);

    const command = process.platform === 'win32' ? 'type sample.txt' : 'cat sample.txt';
    const result = await system.execute(
      {
        callId: 'local-process-compatible',
        toolName: 'local_shell',
        arguments: JSON.stringify({
          command,
        }),
      },
      createContext(workspaceDir)
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.output).toContain('alpha');
      expect(result.output).toContain('beta');
    }
  });

  it('runs PowerShell-native commands directly on Windows by default', async () => {
    if (process.platform !== 'win32') {
      return;
    }

    const runtime: LocalProcessShellRuntime = new LocalProcessShellRuntimeImpl();
    const system = new EnterpriseToolSystem([
      new LocalShellToolV2({
        runtime,
        approvalMode: 'policy',
        policy: createRuleBasedShellCommandPolicy({
          rules: [],
          fallback: {
            evaluate(command) {
              return {
                effect: 'allow',
                commands: [command],
                preferredSandbox: 'workspace-write',
                executionMode: 'sandboxed',
              };
            },
          },
        }),
      }),
    ]);

    const result = await system.execute(
      {
        callId: 'local-process-powershell-native',
        toolName: 'local_shell',
        arguments: JSON.stringify({
          command: 'Get-Content -Raw sample.txt',
        }),
      },
      createContext(workspaceDir)
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.structured as { exitCode: number }).exitCode).toBe(0);
      expect(result.output).toContain('alpha');
      expect(result.output).toContain('beta');
    }
  });

  it('preserves UTF-8 PowerShell output on Windows', async () => {
    if (process.platform !== 'win32') {
      return;
    }

    const runtime: LocalProcessShellRuntime = new LocalProcessShellRuntimeImpl();
    const system = new EnterpriseToolSystem([
      new LocalShellToolV2({
        runtime,
        approvalMode: 'policy',
        policy: createRuleBasedShellCommandPolicy({
          rules: [],
          fallback: {
            evaluate(command) {
              return {
                effect: 'allow',
                commands: [command],
                preferredSandbox: 'workspace-write',
                executionMode: 'sandboxed',
              };
            },
          },
        }),
      }),
    ]);

    const result = await system.execute(
      {
        callId: 'local-process-powershell-utf8',
        toolName: 'local_shell',
        arguments: JSON.stringify({
          command: "Write-Output '中文输出'",
        }),
      },
      createContext(workspaceDir)
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.structured as { exitCode: number }).exitCode).toBe(0);
      expect(result.output).toContain('中文输出');
    }
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

function createContext(
  workspaceDir: string,
  overrides: Partial<ToolExecutionContext> = {}
): ToolExecutionContext {
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
