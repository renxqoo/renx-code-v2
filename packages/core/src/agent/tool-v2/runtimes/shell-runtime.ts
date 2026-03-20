import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createPosixBackgroundShellInvocation,
  createPosixForegroundShellInvocation,
  resolvePreferredPosixShell,
} from './shell-runtime-posix';
import {
  createWindowsBackgroundShellInvocation,
  createWindowsForegroundShellInvocation,
  resolvePreferredWindowsShell,
} from './shell-runtime-windows';
import {
  ShellOutputCapture,
  type ShellOutputArtifact,
  sanitizeShellStreamChunk,
} from './shell-output';
import { resolveBundledRipgrepPathEntries } from './bundled-ripgrep';
import type { ToolSandboxMode } from '../contracts';
import type { ShellExecutionMode } from '../shell-policy';
import type { ShellSandboxPolicy } from '../shell-sandbox';

export type { ShellOutputArtifact } from './shell-output';

export type ShellSandboxEnforcement = 'advisory' | 'enforced';

export interface ShellRuntimeSandboxCapability {
  readonly mode: ToolSandboxMode;
  readonly enforcement: ShellSandboxEnforcement;
}

export interface ShellRuntimeCapabilities {
  readonly sandboxing: readonly ShellRuntimeSandboxCapability[];
  readonly escalation?: {
    readonly supported: boolean;
  };
  readonly background?: {
    readonly supported: boolean;
  };
}

export interface ShellRuntimeRequest {
  readonly command: string;
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly sandbox: ToolSandboxMode;
  readonly sandboxProfile?: string;
  readonly policyProfile?: string;
  readonly requireSandboxEnforcement?: boolean;
  readonly executionMode?: ShellExecutionMode;
  readonly sandboxPolicy?: ShellSandboxPolicy;
  readonly environment?: Record<string, string>;
  readonly signal?: AbortSignal;
  readonly onStdout?: (chunk: string) => void | Promise<void>;
  readonly onStderr?: (chunk: string) => void | Promise<void>;
}

export type ShellBackgroundExecutionStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export interface ShellBackgroundExecutionRecord {
  readonly taskId: string;
  readonly command: string;
  readonly cwd: string;
  readonly pid?: number;
  readonly logPath: string;
  readonly statusPath: string;
  readonly status: ShellBackgroundExecutionStatus;
  readonly sandbox: ToolSandboxMode;
  readonly sandboxProfile?: string;
  readonly policyProfile?: string;
  readonly executionMode: ShellExecutionMode;
  readonly exitCode?: number;
  readonly output?: string;
  readonly error?: string;
  readonly timeoutMs: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly startedAt?: number;
  readonly endedAt?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface ShellRuntimeResult {
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly output: string;
  readonly artifact?: ShellOutputArtifact;
}

export interface ShellRuntime {
  execute(request: ShellRuntimeRequest): Promise<ShellRuntimeResult>;
  getCapabilities?(): ShellRuntimeCapabilities;
}

export interface ShellBackgroundRuntime extends ShellRuntime {
  startBackground(request: ShellRuntimeRequest): Promise<ShellBackgroundExecutionRecord>;
  pollBackground(record: ShellBackgroundExecutionRecord): Promise<ShellBackgroundExecutionRecord>;
  cancelBackground(
    record: ShellBackgroundExecutionRecord,
    reason?: string
  ): Promise<ShellBackgroundExecutionRecord>;
}

export interface ShellSandboxStateAwareRuntime extends ShellRuntime {
  updateSandboxPolicy(policy: ShellSandboxPolicy): Promise<void>;
}

export type ShellFlavor = 'cmd' | 'powershell' | 'posix';

export interface ResolvedShell {
  readonly shellPath: string;
  readonly flavor: ShellFlavor;
}

export type ShellPathExists = (candidate: string) => boolean;
export type ShellCommandWorks = (candidate: string, args: string[]) => boolean;

export interface LocalProcessShellRuntimeOptions {
  readonly backgroundBaseDir?: string;
  readonly foregroundBaseDir?: string;
  readonly now?: () => number;
  readonly maxBackgroundOutputBytes?: number;
  readonly maxForegroundPreviewChars?: number;
  readonly extraPathEntries?: readonly string[];
}

export class LocalProcessShellRuntime implements ShellRuntime {
  private readonly backgroundBaseDir: string;
  private readonly foregroundBaseDir?: string;
  private readonly now: () => number;
  private readonly maxBackgroundOutputBytes: number;
  private readonly maxForegroundPreviewChars: number;
  private readonly preferredShell: ResolvedShell;
  private readonly extraPathEntries: readonly string[];

  constructor(options: LocalProcessShellRuntimeOptions = {}) {
    this.backgroundBaseDir = path.resolve(
      options.backgroundBaseDir || path.join(os.tmpdir(), 'renx-tool-v2-shell-bg')
    );
    this.foregroundBaseDir = options.foregroundBaseDir
      ? path.resolve(options.foregroundBaseDir)
      : undefined;
    this.now = options.now || Date.now;
    this.maxBackgroundOutputBytes = options.maxBackgroundOutputBytes ?? 30000;
    this.maxForegroundPreviewChars = options.maxForegroundPreviewChars ?? 16000;
    this.preferredShell = resolvePreferredShell();
    this.extraPathEntries = options.extraPathEntries || resolveBundledRipgrepPathEntries();
  }

  getCapabilities(): ShellRuntimeCapabilities {
    return {
      sandboxing: [
        {
          mode: 'restricted',
          enforcement: 'advisory',
        },
        {
          mode: 'workspace-write',
          enforcement: 'advisory',
        },
        {
          mode: 'full-access',
          enforcement: 'advisory',
        },
      ],
      escalation: {
        supported: true,
      },
      background: {
        supported: true,
      },
    };
  }

  async execute(request: ShellRuntimeRequest): Promise<ShellRuntimeResult> {
    const { shellPath, shellArgs } = createForegroundShellInvocation(
      this.preferredShell,
      request.command
    );
    const foregroundBaseDir =
      this.foregroundBaseDir || path.join(path.resolve(request.cwd), '.renx', 'cache', 'shell');
    await fsp.mkdir(foregroundBaseDir, { recursive: true });
    const capture = await ShellOutputCapture.create({
      baseDir: foregroundBaseDir,
      command: request.command,
      cwd: path.resolve(request.cwd),
      previewChars: this.maxForegroundPreviewChars,
      now: this.now,
    });

    return new Promise((resolve, reject) => {
      const child = spawn(shellPath, shellArgs, {
        cwd: path.resolve(request.cwd),
        env: buildShellEnvironment(request.environment, this.extraPathEntries),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let timedOut = false;
      let settled = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, request.timeoutMs);

      if (request.signal) {
        if (request.signal.aborted) {
          timedOut = true;
          child.kill();
        } else {
          request.signal.addEventListener(
            'abort',
            () => {
              timedOut = true;
              child.kill();
            },
            { once: true }
          );
        }
      }

      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        capture.appendStdout(text);
        const sanitized = sanitizeShellStreamChunk(text);
        if (sanitized) {
          void request.onStdout?.(sanitized);
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        capture.appendStderr(text);
        const sanitized = sanitizeShellStreamChunk(text);
        if (sanitized) {
          void request.onStderr?.(sanitized);
        }
      });

      child.once('error', async (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        try {
          await capture.finalize({
            exitCode: timedOut ? 124 : 1,
            timedOut,
          });
        } catch {
          // Ignore artifact cleanup errors and surface the spawn error.
        }
        reject(error);
      });

      child.once('close', async (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        try {
          const exitCode = code ?? (timedOut ? 124 : 1);
          const finalized = await capture.finalize({
            exitCode,
            timedOut,
          });
          resolve({
            exitCode,
            timedOut,
            output: finalized.output,
            artifact: finalized.artifact,
          });
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  async startBackground(request: ShellRuntimeRequest): Promise<ShellBackgroundExecutionRecord> {
    await fsp.mkdir(this.backgroundBaseDir, { recursive: true });
    const taskId = `task_${this.now()}_${randomUUID().slice(0, 8)}`;
    const runDir = path.join(this.backgroundBaseDir, taskId);
    await fsp.mkdir(runDir, { recursive: true });
    const logPath = path.join(runDir, 'output.log');
    const statusPath = path.join(runDir, 'status');
    fs.writeFileSync(logPath, '', 'utf8');
    const outputFd = fs.openSync(logPath, 'a');
    const { shellPath, shellArgs } = resolveBackgroundShell(
      this.preferredShell,
      request.command,
      statusPath
    );
    const child = spawn(shellPath, shellArgs, {
      cwd: path.resolve(request.cwd),
      env: buildShellEnvironment(request.environment, this.extraPathEntries),
      detached: true,
      stdio: ['ignore', outputFd, outputFd],
      windowsHide: true,
    });
    fs.closeSync(outputFd);
    child.unref();

    const now = this.now();
    return {
      taskId,
      command: request.command,
      cwd: path.resolve(request.cwd),
      pid: child.pid,
      logPath,
      statusPath,
      status: 'running',
      sandbox: request.sandbox,
      sandboxProfile: request.sandboxProfile,
      policyProfile: request.policyProfile,
      executionMode: request.executionMode || 'sandboxed',
      timeoutMs: request.timeoutMs,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      metadata: {
        networkAccess: request.sandboxPolicy?.networkAccess,
      },
    };
  }

  async pollBackground(
    record: ShellBackgroundExecutionRecord
  ): Promise<ShellBackgroundExecutionRecord> {
    const output = await readBackgroundOutput(record.logPath, this.maxBackgroundOutputBytes);
    if (record.status !== 'running') {
      return {
        ...record,
        output,
      };
    }

    const statusFile = await readStatusFile(record.statusPath);
    if (statusFile) {
      const endedAt = await readMtimeMs(record.statusPath);
      return {
        ...record,
        status: statusFile.exitCode === 0 ? 'completed' : 'failed',
        exitCode: statusFile.exitCode,
        output,
        updatedAt: this.now(),
        endedAt: endedAt || this.now(),
      };
    }

    if (typeof record.pid === 'number' && !isProcessAlive(record.pid)) {
      return {
        ...record,
        status: 'failed',
        error: 'Background process exited without status metadata',
        output,
        updatedAt: this.now(),
        endedAt: this.now(),
      };
    }

    return {
      ...record,
      output,
      updatedAt: this.now(),
    };
  }

  async cancelBackground(
    record: ShellBackgroundExecutionRecord,
    reason?: string
  ): Promise<ShellBackgroundExecutionRecord> {
    if (record.status !== 'running') {
      return record;
    }

    if (typeof record.pid === 'number') {
      terminateProcess(record.pid);
    }

    const now = this.now();
    await fsp.writeFile(record.statusPath, '130', 'utf8').catch(() => undefined);
    const output = await readBackgroundOutput(record.logPath, this.maxBackgroundOutputBytes);
    return {
      ...record,
      status: 'cancelled',
      exitCode: 130,
      error: reason || 'Cancelled by local_shell',
      output,
      updatedAt: now,
      endedAt: now,
    };
  }
}

export function getShellRuntimeCapabilities(runtime: ShellRuntime): ShellRuntimeCapabilities {
  return (
    runtime.getCapabilities?.() || {
      sandboxing: [
        {
          mode: 'full-access',
          enforcement: 'advisory',
        },
      ],
      escalation: {
        supported: false,
      },
      background: {
        supported: false,
      },
    }
  );
}

export function getShellRuntimeSandboxCapability(
  runtime: ShellRuntime,
  mode: ToolSandboxMode
): ShellRuntimeSandboxCapability | undefined {
  return getShellRuntimeCapabilities(runtime).sandboxing.find(
    (capability) => capability.mode === mode
  );
}

export function shellRuntimeSupportsEscalation(runtime: ShellRuntime): boolean {
  return getShellRuntimeCapabilities(runtime).escalation?.supported === true;
}

export function shellRuntimeSupportsBackground(runtime: ShellRuntime): boolean {
  return getShellRuntimeCapabilities(runtime).background?.supported === true;
}

export async function syncShellRuntimeSandboxPolicy(
  runtime: ShellRuntime,
  policy?: ShellSandboxPolicy
): Promise<void> {
  if (!policy) {
    return;
  }

  const candidate = runtime as Partial<ShellSandboxStateAwareRuntime>;
  if (typeof candidate.updateSandboxPolicy !== 'function') {
    return;
  }

  await candidate.updateSandboxPolicy(policy);
}

export function resolvePreferredShell(
  options: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    pathExists?: ShellPathExists;
    commandWorks?: ShellCommandWorks;
  } = {}
): ResolvedShell {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const pathExists = options.pathExists || fs.existsSync;
  const commandWorks =
    options.commandWorks ||
    ((candidate: string, args: string[]) => {
      const probe = spawnSync(candidate, args, {
        stdio: 'ignore',
        windowsHide: true,
      });
      return !probe.error && probe.status === 0;
    });

  if (platform === 'win32') {
    return resolvePreferredWindowsShell(env, pathExists, commandWorks);
  }

  return resolvePreferredPosixShell(env, pathExists);
}

function createForegroundShellInvocation(
  shell: ResolvedShell,
  command: string
): { shellPath: string; shellArgs: string[] } {
  if (shell.flavor === 'posix') {
    return createPosixForegroundShellInvocation(shell, command);
  }

  return createWindowsForegroundShellInvocation(shell, command);
}

function resolveBackgroundShell(
  shell: ResolvedShell,
  command: string,
  statusPath: string
): { shellPath: string; shellArgs: string[] } {
  if (shell.flavor === 'posix') {
    return createPosixBackgroundShellInvocation(shell, command, statusPath);
  }

  return createWindowsBackgroundShellInvocation(shell, command, statusPath);
}

function buildShellEnvironment(
  environment: Record<string, string> | undefined,
  extraPathEntries: readonly string[]
): NodeJS.ProcessEnv {
  const mergedEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    ...(environment || {}),
  };
  if (extraPathEntries.length === 0) {
    return mergedEnvironment;
  }

  const pathKey = getPathKey(mergedEnvironment);
  for (const candidate of Object.keys(mergedEnvironment)) {
    if (candidate !== pathKey && candidate.toLowerCase() === 'path') {
      delete mergedEnvironment[candidate];
    }
  }
  const pathSeparator = process.platform === 'win32' ? ';' : ':';
  const existingPath = mergedEnvironment[pathKey] || '';
  const entries = [
    ...extraPathEntries.filter((entry) => entry.length > 0),
    ...existingPath.split(pathSeparator).filter((entry) => entry.length > 0),
  ];
  mergedEnvironment[pathKey] = Array.from(new Set(entries)).join(pathSeparator);
  return mergedEnvironment;
}

function getPathKey(environment: NodeJS.ProcessEnv): string {
  return Object.keys(environment).find((candidate) => candidate.toLowerCase() === 'path') || 'PATH';
}

async function readBackgroundOutput(
  logPath: string,
  maxBytes: number
): Promise<string | undefined> {
  try {
    const buffer = await fsp.readFile(logPath);
    const slice = buffer.length > maxBytes ? buffer.subarray(buffer.length - maxBytes) : buffer;
    return slice.toString('utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}

async function readStatusFile(statusPath: string): Promise<{ exitCode: number } | null> {
  try {
    const raw = await fsp.readFile(statusPath, 'utf8');
    const exitCode = Number.parseInt(raw.trim(), 10);
    if (Number.isNaN(exitCode)) {
      return null;
    }
    return { exitCode };
  } catch {
    return null;
  }
}

async function readMtimeMs(filePath: string): Promise<number | undefined> {
  try {
    const stat = await fsp.stat(filePath);
    return Math.round(stat.mtimeMs);
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function terminateProcess(pid: number): void {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // ignore cancellation races
    }
  }
}
