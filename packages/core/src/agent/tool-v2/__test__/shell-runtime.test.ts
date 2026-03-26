import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthorizationService } from '../../auth/authorization-service';
import { createSystemPrincipal } from '../../auth/principal';
import { ToolSessionState, type ToolExecutionContext } from '../context';
import { LocalShellToolV2 } from '../handlers/shell';
import { createRestrictedNetworkPolicy, createWorkspaceFileSystemPolicy } from '../permissions';
import { BrokeredShellRuntime } from '../runtimes/brokered-shell-runtime';
import { resolveBundledRipgrepPathEntries } from '../runtimes/bundled-ripgrep';
import type {
  LocalProcessShellRuntime,
  ShellBackgroundExecutionRecord,
  ShellRuntime,
  ShellRuntimeCapabilities,
  ShellRuntimeRequest,
  ShellRuntimeResult,
} from '../runtimes/shell-runtime';
import {
  LocalProcessShellRuntime as LocalProcessShellRuntimeImpl,
  createForegroundProcessLifecycleController,
  resolvePreferredShell,
} from '../runtimes/shell-runtime';
import {
  createWindowsBackgroundShellInvocation,
  createWindowsForegroundShellInvocation,
} from '../runtimes/shell-runtime-windows';
import { truncateShellOutput } from '../runtimes/shell-output';
import { createRuleBasedShellCommandPolicy } from '../shell-policy';
import { SHELL_POLICY_PROFILES } from '../shell-profiles';
import { EnterpriseToolSystem } from '../tool-system';

describe('shell runtime adapters', () => {
  let workspaceDir: string;
  let homeDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-tool-v2-runtime-'));
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-tool-v2-home-'));
    await fs.writeFile(path.join(workspaceDir, 'sample.txt'), 'alpha\nbeta\n', 'utf8');
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
    await fs.rm(homeDir, { recursive: true, force: true });
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

  it('wraps Windows PowerShell invocations with non-interactive quiet preferences', () => {
    const shell = {
      shellPath: 'pwsh',
      flavor: 'powershell' as const,
    };

    const foreground = createWindowsForegroundShellInvocation(shell, 'Get-Content -Raw sample.txt');
    const background = createWindowsBackgroundShellInvocation(
      shell,
      'Get-Content -Raw sample.txt',
      'C:\\temp\\status.txt'
    );

    expect(foreground.shellPath).toBe('pwsh');
    expect(foreground.shellArgs[0]).toBe('-NoProfile');
    expect(foreground.shellArgs[1]).toBe('-NonInteractive');
    expect(foreground.shellArgs[2]).toBe('-EncodedCommand');

    expect(background.shellArgs[0]).toBe('-NoProfile');
    expect(background.shellArgs[1]).toBe('-NonInteractive');
    expect(background.shellArgs[2]).toBe('-EncodedCommand');

    const foregroundScript = Buffer.from(foreground.shellArgs[3]!, 'base64').toString('utf16le');
    expect(foregroundScript).toContain("$ProgressPreference='SilentlyContinue'");
    expect(foregroundScript).toContain("$InformationPreference='SilentlyContinue'");
    expect(foregroundScript).toContain("$ErrorActionPreference='Stop'");

    const backgroundScript = Buffer.from(background.shellArgs[3]!, 'base64').toString('utf16le');
    expect(backgroundScript).toContain("$ProgressPreference='SilentlyContinue'");
    expect(backgroundScript).toContain("$InformationPreference='SilentlyContinue'");
    expect(backgroundScript).toContain("$ErrorActionPreference='Stop'");
  });

  it('truncates shell previews with preserved head and tail context', () => {
    const value = `${'alpha'.repeat(80)}${'omega'.repeat(80)}`;
    const result = truncateShellOutput(value, 120);

    expect(result.truncated).toBe(true);
    expect(result.totalChars).toBe(value.length);
    expect(result.output).toContain('[');
    expect(result.output).toContain('chars truncated');
    expect(result.output).toContain('alpha');
    expect(result.output).toContain('omega');
  });

  it('strips ANSI mouse / control sequences from previews', () => {
    const mouseSeq = '\u001b[<65;72;22M';
    const value = `before\n${mouseSeq}${mouseSeq}\nafter`;
    const result = truncateShellOutput(value, 200);

    expect(result.truncated).toBe(false);
    expect(result.totalChars).toBe(value.length);
    expect(result.output).toContain('before');
    expect(result.output).toContain('after');
    expect(result.output).not.toContain('65;72;22M');
  });

  it('preserves UTF-8 characters when stdout bytes are split across chunks', async () => {
    const runtime = new LocalProcessShellRuntimeImpl();
    const stdoutChunks: string[] = [];
    const scriptPath = path.join(workspaceDir, 'split-utf8.js');
    await fs.writeFile(
      scriptPath,
      "const b = Buffer.from('中', 'utf8'); process.stdout.write(b.subarray(0, 1)); setTimeout(() => process.stdout.write(b.subarray(1)), 20);",
      'utf8'
    );

    const command =
      process.platform === 'win32'
        ? `& "${process.execPath}" "${scriptPath}"`
        : `"${process.execPath}" "${scriptPath}"`;

    const result = await runtime.execute({
      command,
      cwd: workspaceDir,
      timeoutMs: 5_000,
      sandbox: 'workspace-write',
      onStdout: async (chunk) => {
        stdoutChunks.push(chunk);
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('中');
    expect(result.output).not.toContain('�');
    expect(stdoutChunks.join('')).toContain('中');
    expect(stdoutChunks.join('')).not.toContain('�');
  });

  it('does not leak split ANSI control sequences into streamed stdout', async () => {
    const runtime = new LocalProcessShellRuntimeImpl();
    const stdoutChunks: string[] = [];
    const scriptPath = path.join(workspaceDir, 'split-ansi.js');
    await fs.writeFile(
      scriptPath,
      "process.stdout.write('\\u001b'); setTimeout(() => process.stdout.write('[31mRED'), 20); setTimeout(() => process.stdout.write('\\u001b[0m'), 40);",
      'utf8'
    );

    const command =
      process.platform === 'win32'
        ? `& "${process.execPath}" "${scriptPath}"`
        : `"${process.execPath}" "${scriptPath}"`;

    const result = await runtime.execute({
      command,
      cwd: workspaceDir,
      timeoutMs: 5_000,
      sandbox: 'workspace-write',
      onStdout: async (chunk) => {
        stdoutChunks.push(chunk);
      },
    });

    const streamed = stdoutChunks.join('');
    expect(result.exitCode).toBe(0);
    expect(streamed).toContain('RED');
    expect(streamed).not.toContain('[31m');
    expect(streamed).not.toContain('[0m');
    expect(result.output).toContain('RED');
    expect(result.output).not.toContain('[31m');
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
        toolCallId: 'sandboxed',
        toolName: 'local_shell',
        arguments: JSON.stringify({
          command: 'pwd',
        }),
      },
      createContext(workspaceDir)
    );
    const escalatedResult = await system.execute(
      {
        toolCallId: 'escalated',
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
        profile: SHELL_POLICY_PROFILES.fullAccess,
      }),
    ]);

    const result = await system.execute(
      {
        toolCallId: 'sandbox-state',
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
        toolCallId: 'local-process-compatible',
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

  it('does not persist a foreground artifact for short successful output', async () => {
    const runtime: LocalProcessShellRuntime = new LocalProcessShellRuntimeImpl({
      maxForegroundPreviewChars: 256,
      homeDir,
    });
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

    const cacheDir = path.join(homeDir, '.renx', 'tool-v2', 'shell', 'foreground');
    const result = await system.execute(
      {
        toolCallId: 'local-process-short-success',
        toolName: 'local_shell',
        arguments: JSON.stringify({
          command: `node -e "process.stdout.write('short output');"`,
        }),
      },
      createContext(workspaceDir)
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.output).toContain('short output');
    expect(result.output).not.toContain('Full output saved to:');
    const structured = result.structured as {
      outputTruncated: boolean;
      outputArtifact?: unknown;
    };
    expect(structured.outputTruncated).toBe(false);
    expect(structured.outputArtifact).toBeUndefined();
    await expect(fs.access(cacheDir)).rejects.toThrow();
  });

  it('writes full foreground output to a user-scoped cache directory and returns truncated preview paths', async () => {
    const runtime: LocalProcessShellRuntime = new LocalProcessShellRuntimeImpl({
      maxForegroundPreviewChars: 256,
      homeDir,
    });
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
        toolCallId: 'local-process-foreground-cache',
        toolName: 'local_shell',
        arguments: JSON.stringify({
          command:
            `node -e "process.stdout.write('A'.repeat(320));` +
            `process.stderr.write('B'.repeat(320));"`,
        }),
      },
      createContext(workspaceDir)
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.output).toContain('Full output saved to:');
    const structured = result.structured as {
      outputTruncated: boolean;
      outputArtifact: {
        combinedPath: string;
        metaPath: string;
        stdoutPath: string;
        stderrPath: string;
      };
    };
    expect(structured.outputTruncated).toBe(true);
    expect(structured.outputArtifact.combinedPath).toContain(
      path.join(homeDir, '.renx', 'tool-v2', 'shell', 'foreground')
    );

    const combined = await fs.readFile(structured.outputArtifact.combinedPath, 'utf8');
    const meta = JSON.parse(await fs.readFile(structured.outputArtifact.metaPath, 'utf8')) as {
      truncated: boolean;
      combinedPath: string;
    };

    expect(combined).toContain('A'.repeat(320));
    expect(combined).toContain('B'.repeat(320));
    expect(meta.truncated).toBe(true);
    expect(meta.combinedPath).toBe(structured.outputArtifact.combinedPath);
  });

  it('persists a foreground artifact for short failed output', async () => {
    const runtime: LocalProcessShellRuntime = new LocalProcessShellRuntimeImpl({
      maxForegroundPreviewChars: 256,
      homeDir,
    });
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
        toolCallId: 'local-process-short-failure',
        toolName: 'local_shell',
        arguments: JSON.stringify({
          command: `node -e "process.stderr.write('boom'); process.exit(7);"`,
        }),
      },
      createContext(workspaceDir)
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    const structured = result.structured as {
      exitCode: number;
      outputTruncated: boolean;
      outputArtifact?: {
        combinedPath: string;
        metaPath: string;
      };
    };
    expect(structured.exitCode).toBe(7);
    expect(structured.outputTruncated).toBe(false);
    expect(structured.outputArtifact).toBeDefined();
    expect(result.output).toContain('boom');
    expect(result.output).not.toContain('Full output saved to:');

    const combined = await fs.readFile(structured.outputArtifact!.combinedPath, 'utf8');
    const meta = JSON.parse(await fs.readFile(structured.outputArtifact!.metaPath, 'utf8')) as {
      truncated: boolean;
      exitCode: number;
    };

    expect(combined).toContain('boom');
    expect(meta.truncated).toBe(false);
    expect(meta.exitCode).toBe(7);
  });

  it('marks foreground abort results explicitly in the runtime result', async () => {
    const terminatedSignals: Array<NodeJS.Signals | undefined> = [];
    const terminatedPids: number[] = [];
    const runtime = new LocalProcessShellRuntimeImpl({
      terminateProcess: (pid, signal) => {
        terminatedPids.push(pid);
        terminatedSignals.push(signal);
        try {
          process.kill(pid, signal ?? 'SIGTERM');
        } catch {
          // ignore races while shutting down the spawned command
        }
      },
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    const result = await runtime.execute({
      command: `"${process.execPath}" -e "setInterval(function () {}, 1000)"`,
      cwd: workspaceDir,
      timeoutMs: 5_000,
      sandbox: 'workspace-write',
      signal: controller.signal,
    });

    expect(result.timedOut).toBe(false);
    expect(result.aborted).toBe(true);
    expect(result.exitCode).toBe(130);
    expect(terminatedPids).toHaveLength(1);
    expect(terminatedPids[0]).toEqual(expect.any(Number));
    expect(terminatedSignals).toEqual(['SIGTERM']);
  });

  it('freezes foreground lifecycle abort state after exit is observed', async () => {
    let terminateCalls = 0;
    const controller = new AbortController();
    const child = {
      pid: 4242,
      kill: () => undefined,
    } as {
      pid?: number;
      kill: () => void;
    } & import('node:events').EventEmitter;

    const lifecycle = createForegroundProcessLifecycleController({
      child: {
        ...child,
      } as never,
      timeoutMs: 5_000,
      signal: controller.signal,
      terminateProcess: () => {
        terminateCalls += 1;
      },
    });

    lifecycle.markExited();
    controller.abort();

    expect(lifecycle.aborted()).toBe(false);
    expect(lifecycle.timedOut()).toBe(false);
    expect(terminateCalls).toBe(0);
    lifecycle.cleanup();
  });

  it('returns an aborted result without spawning when the foreground signal is already aborted', async () => {
    const runtime = new LocalProcessShellRuntimeImpl();
    const controller = new AbortController();
    controller.abort();

    const result = await runtime.execute({
      command: `"${process.execPath}" -e "require('node:fs').writeFileSync('should-not-exist.txt', 'x')"`,
      cwd: workspaceDir,
      timeoutMs: 5_000,
      sandbox: 'workspace-write',
      signal: controller.signal,
    });

    expect(result.aborted).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(130);
    await expect(fs.access(path.join(workspaceDir, 'should-not-exist.txt'))).rejects.toThrow();
  });

  it('does not let lifecycle aborts override an already-exited foreground process result', async () => {
    let terminateCalls = 0;
    const controller = new AbortController();
    const lifecycle = createForegroundProcessLifecycleController({
      child: {
        pid: 4242,
        kill: () => undefined,
      } as never,
      timeoutMs: 5_000,
      signal: controller.signal,
      terminateProcess: () => {
        terminateCalls += 1;
      },
    });

    lifecycle.markExited();
    controller.abort();

    expect(lifecycle.aborted()).toBe(false);
    expect(lifecycle.timedOut()).toBe(false);
    expect(terminateCalls).toBe(0);
    lifecycle.cleanup();
  });

  it('marks timed out background runs as timed_out when they exceed timeoutMs', async () => {
    const terminatedPids: number[] = [];
    const record: ShellBackgroundExecutionRecord = {
      taskId: 'task_background_timeout',
      command: 'node -e "setInterval(function () {}, 1000)"',
      cwd: workspaceDir,
      pid: 4243,
      logPath: path.join(workspaceDir, 'background-timeout.log'),
      statusPath: path.join(workspaceDir, 'background-timeout.status'),
      status: 'running',
      sandbox: 'workspace-write',
      executionMode: 'sandboxed',
      timeoutMs: 10,
      createdAt: 1,
      updatedAt: 1,
      startedAt: 1,
    };
    await fs.writeFile(record.logPath, 'still running\n', 'utf8');

    const advancedRuntime = new LocalProcessShellRuntimeImpl({
      terminateProcess: (pid) => {
        terminatedPids.push(pid);
      },
      now: () => 50,
    });

    const result = await advancedRuntime.pollBackground(record);
    const statusContents = await fs.readFile(record.statusPath, 'utf8');

    expect(result.status).toBe('timed_out');
    expect(result.exitCode).toBe(124);
    expect(result.error).toContain('timed out');
    expect(statusContents).toBe('124');
    expect(terminatedPids).toEqual([4243]);
  });

  it('fails background polling with timed_out when the status file reports exit code 124', async () => {
    const runtime = new LocalProcessShellRuntimeImpl();
    const logPath = path.join(workspaceDir, 'background-existing-timeout.log');
    const statusPath = path.join(workspaceDir, 'background-existing-timeout.status');
    await fs.writeFile(logPath, 'timed out output\n', 'utf8');
    await fs.writeFile(statusPath, '124', 'utf8');

    const result = await runtime.pollBackground({
      taskId: 'task_background_existing_timeout',
      command: 'sleep 999',
      cwd: workspaceDir,
      pid: 4244,
      logPath,
      statusPath,
      status: 'running',
      sandbox: 'workspace-write',
      executionMode: 'sandboxed',
      timeoutMs: 100,
      createdAt: 1,
      updatedAt: 1,
      startedAt: 1,
    });

    expect(result.status).toBe('timed_out');
    expect(result.exitCode).toBe(124);
    expect(result.output).toContain('timed out output');
  });

  it('reads background output from a UTF-8 safe tail boundary', async () => {
    const runtime = new LocalProcessShellRuntimeImpl({
      maxBackgroundOutputBytes: 4,
    });
    const logPath = path.join(workspaceDir, 'background-utf8-tail.log');
    const statusPath = path.join(workspaceDir, 'background-utf8-tail.status');
    await fs.writeFile(logPath, '甲乙', 'utf8');

    const result = await runtime.pollBackground({
      taskId: 'task_background_utf8_tail',
      command: 'echo utf8',
      cwd: workspaceDir,
      pid: 4245,
      logPath,
      statusPath,
      status: 'completed',
      sandbox: 'workspace-write',
      executionMode: 'sandboxed',
      timeoutMs: 100,
      createdAt: 1,
      updatedAt: 1,
      startedAt: 1,
      endedAt: 1,
    });

    expect(result.output).toBe('乙');
    expect(result.output).not.toContain('�');
  });

  it('persists abort metadata when a foreground shell command is cancelled', async () => {
    const runtime = new LocalProcessShellRuntimeImpl({
      foregroundBaseDir: path.join(workspaceDir, 'foreground-artifacts'),
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    const result = await runtime.execute({
      command: `"${process.execPath}" -e "setInterval(function () {}, 1000)"`,
      cwd: workspaceDir,
      timeoutMs: 5_000,
      sandbox: 'workspace-write',
      signal: controller.signal,
    });

    expect(result.aborted).toBe(true);
    expect(result.artifact).toBeDefined();
    const meta = JSON.parse(await fs.readFile(result.artifact!.metaPath, 'utf8')) as {
      aborted: boolean;
      timedOut: boolean;
      exitCode: number;
    };
    expect(meta.aborted).toBe(true);
    expect(meta.timedOut).toBe(false);
    expect(meta.exitCode).toBe(130);
  });

  it('does not report foreground aborts as timeouts', async () => {
    const terminatedSignals: Array<NodeJS.Signals | undefined> = [];
    const terminatedPids: number[] = [];
    const runtime = new LocalProcessShellRuntimeImpl({
      terminateProcess: (pid, signal) => {
        terminatedPids.push(pid);
        terminatedSignals.push(signal);
        try {
          process.kill(pid, signal ?? 'SIGTERM');
        } catch {
          // ignore races while shutting down the spawned command
        }
      },
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);

    const result = await runtime.execute({
      command: `"${process.execPath}" -e "setInterval(function () {}, 1000)"`,
      cwd: workspaceDir,
      timeoutMs: 5_000,
      sandbox: 'workspace-write',
      signal: controller.signal,
    });

    expect(result.timedOut).toBe(false);
    expect(result.aborted).toBe(true);
    expect(result.exitCode).toBe(130);
    expect(terminatedPids).toHaveLength(1);
    expect(terminatedPids[0]).toEqual(expect.any(Number));
    expect(terminatedSignals).toEqual(['SIGTERM']);
  });

  it('uses staged termination signals for foreground timeout handling', async () => {
    const terminatedSignals: Array<NodeJS.Signals | undefined> = [];
    const terminatedPids: number[] = [];
    const runtime = new LocalProcessShellRuntimeImpl({
      terminateProcess: (pid, signal) => {
        terminatedPids.push(pid);
        terminatedSignals.push(signal);
        try {
          process.kill(pid, signal ?? 'SIGTERM');
        } catch {
          // ignore races while shutting down the spawned command
        }
      },
    });

    const result = await runtime.execute({
      command: `"${process.execPath}" -e "setInterval(function () {}, 1000)"`,
      cwd: workspaceDir,
      timeoutMs: 50,
      sandbox: 'workspace-write',
    });

    expect(result.timedOut).toBe(true);
    expect(result.aborted).toBe(false);
    expect(terminatedPids).toHaveLength(1);
    expect(terminatedPids[0]).toEqual(expect.any(Number));
    expect(terminatedSignals[0]).toBe('SIGTERM');
  });

  it('returns after foreground timeout when a POSIX shell command leaves a child running', async () => {
    if (process.platform === 'win32') {
      return;
    }

    const scriptPath = path.join(workspaceDir, 'foreground-child-hang.js');
    await fs.writeFile(
      scriptPath,
      [
        "const { spawn } = require('node:child_process');",
        "spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
        'setInterval(() => {}, 1000);',
      ].join('\n'),
      'utf8'
    );

    const startedAt = Date.now();
    const runtime = new LocalProcessShellRuntimeImpl();
    const result = await runtime.execute({
      command: `"${process.execPath}" "${scriptPath}"`,
      cwd: workspaceDir,
      timeoutMs: 100,
      sandbox: 'workspace-write',
    });
    const elapsedMs = Date.now() - startedAt;

    expect(result.timedOut).toBe(true);
    expect(result.aborted).toBe(false);
    expect(result.exitCode).toBe(124);
    expect(elapsedMs).toBeLessThan(5_000);
  });

  it('uses the configured process terminator for background cancellation', async () => {
    const terminatedPids: number[] = [];
    const runtime = new LocalProcessShellRuntimeImpl({
      terminateProcess: (pid) => {
        terminatedPids.push(pid);
      },
    });
    const logPath = path.join(workspaceDir, 'background.log');
    const statusPath = path.join(workspaceDir, 'background.status');
    await fs.writeFile(logPath, 'background output\n', 'utf8');

    const record: ShellBackgroundExecutionRecord = {
      taskId: 'task_background_cancel',
      command: 'node -e "setInterval(function () {}, 1000)"',
      cwd: workspaceDir,
      pid: 4242,
      logPath,
      statusPath,
      status: 'running',
      sandbox: 'workspace-write',
      executionMode: 'sandboxed',
      timeoutMs: 1000,
      createdAt: 1,
      updatedAt: 1,
      startedAt: 1,
    };

    const result = await runtime.cancelBackground(record, 'Cancelled by test');
    const statusContents = await fs.readFile(statusPath, 'utf8');

    expect(terminatedPids).toEqual([4242]);
    expect(statusContents).toBe('130');
    expect(result.status).toBe('cancelled');
    expect(result.exitCode).toBe(130);
    expect(result.error).toBe('Cancelled by test');
    expect(result.output).toContain('background output');
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
        toolCallId: 'local-process-powershell-native',
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

  it('preserves native child exit codes even when later PowerShell statements succeed on Windows', async () => {
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
        toolCallId: 'local-process-powershell-native-exitcode',
        toolName: 'local_shell',
        arguments: JSON.stringify({
          command: 'cmd /c exit 7; Write-Output ok',
        }),
      },
      createContext(workspaceDir)
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.structured as { exitCode: number; timedOut: boolean }).exitCode).toBe(7);
      expect((result.structured as { exitCode: number; timedOut: boolean }).timedOut).toBe(false);
      expect(result.output).toContain('ok');
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
        toolCallId: 'local-process-powershell-utf8',
        toolName: 'local_shell',
        arguments: JSON.stringify({
          command: "Write-Output '涓枃杈撳嚭'",
        }),
      },
      createContext(workspaceDir)
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.structured as { exitCode: number }).exitCode).toBe(0);
      expect(result.output).toContain('涓枃杈撳嚭');
    }
  });
  it('prepends configured path entries before launching shell commands', async () => {
    const injectedDir = path.join(workspaceDir, 'vendor-bin');
    await fs.mkdir(injectedDir, { recursive: true });

    const runtime: LocalProcessShellRuntime = new LocalProcessShellRuntimeImpl({
      extraPathEntries: [injectedDir],
    });
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

    const command =
      process.platform === 'win32'
        ? `[Environment]::GetEnvironmentVariable('PATH')`
        : 'printf %s "$PATH"';
    const result = await system.execute(
      {
        toolCallId: 'local-process-path-injection',
        toolName: 'local_shell',
        arguments: JSON.stringify({
          command,
        }),
      },
      createContext(workspaceDir)
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.output.split(path.delimiter)[0]).toBe(injectedDir);
    }
  });

  it('resolves the bundled ripgrep vendor path from CLI-provided env overrides', () => {
    const expectedDir = path.join(
      workspaceDir,
      'vendor',
      'ripgrep',
      'x86_64-pc-windows-msvc',
      'path'
    );
    const expectedBinary = path.join(expectedDir, 'rg.exe');

    const entries = resolveBundledRipgrepPathEntries({
      platform: 'win32',
      arch: 'x64',
      env: {
        RENX_BUNDLED_RG_DIR: expectedDir,
        RIPGREP_PATH: expectedBinary,
      },
      pathExists: (candidate) => candidate === expectedBinary,
    });

    expect(entries).toEqual([expectedDir]);
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
      aborted: false,
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
  overrides: Partial<Omit<ToolExecutionContext, 'authorization'>> & {
    approve?: ToolExecutionContext['authorization']['requestApproval'];
    requestPermissions?: ToolExecutionContext['authorization']['requestPermissions'];
    onPolicyCheck?: ToolExecutionContext['authorization']['evaluatePolicy'];
  } = {}
): ToolExecutionContext {
  const { approve, requestPermissions, onPolicyCheck, ...contextOverrides } = overrides;
  return {
    workingDirectory: workspaceDir,
    sessionState: new ToolSessionState(),
    authorization: {
      service: new AuthorizationService(),
      principal: createSystemPrincipal('tool-v2-shell-runtime-test'),
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
