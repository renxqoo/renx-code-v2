import * as path from 'node:path';
import { z } from 'zod';
import type { ToolExecutionContext } from '../context';
import type {
  ToolExecutionPlan,
  ToolHandlerResult,
  ToolPermissionProfile,
  ToolSandboxMode,
} from '../contracts';
import { ToolV2AbortError, ToolV2ExecutionError, ToolV2TimeoutError } from '../errors';
import {
  arraySchema,
  booleanSchema,
  enumSchema,
  integerSchema,
  objectSchema,
  oneOfSchema,
  shellBackgroundRecordSchema,
  stringSchema,
} from '../output-schema';
import { assertReadAccess, resolveToolPath } from '../permissions';
import { StructuredToolHandler } from '../registry';
import {
  LocalProcessShellRuntime,
  getShellRuntimeSandboxCapability,
  shellRuntimeSupportsBackground,
  shellRuntimeSupportsEscalation,
  syncShellRuntimeSandboxPolicy,
  type ShellOutputArtifact,
  type ShellRuntime,
} from '../runtimes/shell-runtime';
import {
  assessShellCommand,
  createDefaultShellCommandPolicy,
  type ShellExecutionMode,
  type ShellCommandPolicy,
} from '../shell-policy';
import {
  SHELL_POLICY_PROFILES,
  type ShellApprovalMode,
  type ShellPolicyProfile,
  type ShellSandboxProfile,
} from '../shell-profiles';
import { createShellSandboxPolicy } from '../shell-sandbox';
import { type ShellBackgroundExecutionService } from '../shell-background';
import { attachShellParentAbortCascade } from '../task-parent-abort';

const runInBackgroundSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return value;
}, z.boolean());

const schema = z
  .object({
    command: z.string().min(1).describe('Shell command to execute'),
    workdir: z
      .string()
      .optional()
      .describe('Working directory for the command; defaults to the current workspace'),
    timeoutMs: z
      .number()
      .int()
      .min(1)
      .max(600000)
      .optional()
      .describe('Command timeout in milliseconds'),
    runInBackground: runInBackgroundSchema
      .optional()
      .describe('Run the command asynchronously and return a background task id'),
  })
  .strict();

const LOCAL_SHELL_TOOL_DESCRIPTION = `Execute a shell command with explicit policy, sandbox, and approval controls.

Use local_shell for:
- repository search and inspection
- listing files and directories
- build, test, lint, and git commands
- focused environment checks

Prefer other tools when available:
- use read_file when you already know the file path
- use file_edit for precise edits to existing files
- use write_file for full-file writes

Platform guidance:
- Windows: prefer PowerShell command shapes such as Get-ChildItem, Get-Content, Select-String, and direct git/npm commands
- macOS/Linux: prefer rg, rg --files, ls, cat, find, and shell pipelines

Execution guidance:
- command is required
- workdir defaults to the current workspace
- timeoutMs defaults to the active profile timeout
- runInBackground starts the command asynchronously and returns a background task id
- use parallel calls for independent commands
- use && only when later commands depend on earlier ones
- do not append "&" manually when runInBackground=true
- commands run through explicit shell policy and sandbox profiles

Examples:
- Windows search: Get-ChildItem -Path src -Recurse | Select-String -Pattern 'TODO'
- Windows read: Get-Content -Raw package.json
- Unix search: rg "local_shell" src
- Unix file discovery: rg --files src
- Git status: git status && git diff --stat`;

export class LocalShellToolV2 extends StructuredToolHandler<typeof schema> {
  private readonly runtime: ShellRuntime;
  private readonly commandPolicy: ShellCommandPolicy;
  private readonly defaultTimeoutMs: number;
  private readonly approvalMode: ShellApprovalMode;
  private readonly sandboxProfile: ShellSandboxProfile;
  private readonly policyProfileName: string;
  private readonly requireSandboxEnforcement: boolean;
  private readonly backgroundService?: ShellBackgroundExecutionService;

  constructor(options: LocalShellToolV2Options = {}) {
    const profile = options.profile || SHELL_POLICY_PROFILES.workspaceGuarded;
    const sandboxProfile = options.sandboxProfile || profile.sandboxProfile;
    super({
      name: 'local_shell',
      description: LOCAL_SHELL_TOOL_DESCRIPTION,
      schema,
      outputSchema: oneOfSchema([
        objectSchema(
          {
            taskId: stringSchema(),
            shellRun: shellBackgroundRecordSchema,
          },
          {
            required: ['taskId', 'shellRun'],
          }
        ),
        objectSchema(
          {
            exitCode: integerSchema(),
            timedOut: booleanSchema(),
            workdir: stringSchema(),
            sandboxMode: enumSchema(['restricted', 'workspace-write', 'full-access']),
            sandboxProfile: stringSchema(),
            policyProfile: stringSchema(),
            sandboxEnforcement: stringSchema(),
            executionMode: enumSchema(['sandboxed', 'escalated']),
            networkAccess: booleanSchema(),
            outputTruncated: booleanSchema(),
            outputArtifact: objectSchema(
              {
                runId: stringSchema(),
                runDir: stringSchema(),
                stdoutPath: stringSchema(),
                stderrPath: stringSchema(),
                combinedPath: stringSchema(),
                metaPath: stringSchema(),
                bytesStdout: integerSchema(),
                bytesStderr: integerSchema(),
                bytesCombined: integerSchema(),
                truncated: booleanSchema(),
                previewChars: integerSchema(),
              },
              {
                required: [
                  'runId',
                  'runDir',
                  'stdoutPath',
                  'stderrPath',
                  'combinedPath',
                  'metaPath',
                  'bytesStdout',
                  'bytesStderr',
                  'bytesCombined',
                  'truncated',
                  'previewChars',
                ],
              }
            ),
            segments: arraySchema(
              objectSchema(
                {
                  segment: stringSchema(),
                  effect: stringSchema(),
                  executionMode: enumSchema(['sandboxed', 'escalated']),
                  matchedRule: stringSchema(),
                },
                {
                  required: ['segment', 'effect', 'executionMode'],
                }
              )
            ),
            grantedPermissions: {},
          },
          {
            required: [
              'exitCode',
              'timedOut',
              'workdir',
              'sandboxMode',
              'sandboxProfile',
              'policyProfile',
              'sandboxEnforcement',
              'executionMode',
              'networkAccess',
              'segments',
            ],
          }
        ),
      ]),
      supportsParallel: true,
      mutating: true,
      tags: ['process', 'shell'],
    });
    this.runtime = options.runtime || new LocalProcessShellRuntime();
    this.commandPolicy = options.policy || profile.policy || createDefaultShellCommandPolicy();
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? profile.defaultTimeoutMs ?? 60000;
    this.approvalMode = options.approvalMode ?? profile.approvalMode ?? 'always';
    this.sandboxProfile = {
      ...sandboxProfile,
      mode: options.preferredSandbox || sandboxProfile.mode,
    };
    this.policyProfileName = profile.name;
    this.requireSandboxEnforcement =
      options.requireSandboxEnforcement ?? this.sandboxProfile.requireRuntimeEnforcement ?? false;
    this.backgroundService = options.backgroundService;
  }

  plan(args: z.infer<typeof schema>, context: ToolExecutionContext): ToolExecutionPlan {
    const workdir = args.workdir || context.workingDirectory;
    const assessment = this.evaluateCommand(args.command, workdir);
    if (assessment.effect === 'deny') {
      throw new ToolV2ExecutionError(assessment.reason || 'Command denied by shell policy', {
        command: args.command,
        segments: assessment.segments.map((segment) => segment.segment),
      });
    }
    const approvalRequired = this.approvalMode === 'always' || assessment.requiresApproval;
    return {
      mutating: true,
      readPaths: [workdir],
      requestedPermissions: assessment.requestedPermissions,
      riskLevel: assessment.requiresApproval ? 'high' : 'medium',
      sensitivity: assessment.executionMode === 'escalated' ? 'restricted' : 'sensitive',
      approval: approvalRequired
        ? {
            required: true,
            reason: buildApprovalReason(assessment, workdir),
            key: `shell:${workdir}:${args.command}`,
            commandPreview: args.command,
          }
        : undefined,
      preferredSandbox: assessment.preferredSandbox || this.sandboxProfile.mode,
    };
  }

  async execute(
    args: z.infer<typeof schema>,
    context: ToolExecutionContext
  ): Promise<ToolHandlerResult> {
    const workdir = assertReadAccess(
      args.workdir || context.workingDirectory,
      context.workingDirectory,
      context.fileSystemPolicy
    );
    const assessment = this.evaluateCommand(args.command, workdir);
    if (assessment.effect === 'deny') {
      throw new ToolV2ExecutionError(assessment.reason || 'Command denied by shell policy', {
        command: args.command,
        segments: assessment.segments.map((segment) => segment.segment),
      });
    }

    const sandboxMode = assessment.preferredSandbox || this.sandboxProfile.mode;
    const capability = getShellRuntimeSandboxCapability(this.runtime, sandboxMode);
    const sandboxedExecution = assessment.executionMode === 'sandboxed';
    if (sandboxedExecution && !capability) {
      throw new ToolV2ExecutionError(
        `Shell runtime does not support sandbox mode "${sandboxMode}"`,
        {
          sandboxMode,
          sandboxProfile: this.sandboxProfile.name,
          policyProfile: this.policyProfileName,
        }
      );
    }
    if (
      sandboxedExecution &&
      this.requireSandboxEnforcement &&
      capability &&
      capability.enforcement !== 'enforced'
    ) {
      throw new ToolV2ExecutionError(
        `Shell runtime cannot enforce sandbox profile "${this.sandboxProfile.name}"`,
        {
          sandboxMode,
          sandboxProfile: this.sandboxProfile.name,
          policyProfile: this.policyProfileName,
          enforcement: capability.enforcement,
        }
      );
    }
    if (assessment.executionMode === 'escalated' && !shellRuntimeSupportsEscalation(this.runtime)) {
      throw new ToolV2ExecutionError(
        'Shell runtime does not support escalation outside the sandbox',
        {
          sandboxMode,
          sandboxProfile: this.sandboxProfile.name,
          policyProfile: this.policyProfileName,
        }
      );
    }
    const sandboxPolicy = createShellSandboxPolicy({
      type: sandboxMode,
      fileSystemPolicy: context.fileSystemPolicy,
      networkPolicy: context.networkPolicy,
      runtimeTag: sandboxedExecution ? sandboxMode : `${sandboxMode}-escalated`,
    });
    await syncShellRuntimeSandboxPolicy(this.runtime, sandboxPolicy);
    if (args.runInBackground === true) {
      if (context.signal?.aborted) {
        throw new ToolV2AbortError('Background shell command aborted before start');
      }
      if (!this.backgroundService || !shellRuntimeSupportsBackground(this.runtime)) {
        throw new ToolV2ExecutionError('Shell runtime is not configured for background execution', {
          policyProfile: this.policyProfileName,
          sandboxProfile: this.sandboxProfile.name,
        });
      }

      const started = await this.backgroundService.start({
        command: args.command,
        cwd: workdir,
        timeoutMs: args.timeoutMs ?? this.defaultTimeoutMs,
        sandbox: sandboxMode,
        sandboxProfile: this.sandboxProfile.name,
        policyProfile: this.policyProfileName,
        requireSandboxEnforcement: sandboxedExecution && this.requireSandboxEnforcement,
        executionMode: assessment.executionMode,
        sandboxPolicy,
        environment: sandboxPolicy.environment,
        signal: context.signal,
      });
      const structured = {
        taskId: started.taskId,
        shellRun: started,
        note: 'Use task_output with taskId to poll completion and task_stop to cancel.',
      };
      attachShellParentAbortCascade({
        context,
        shellBackgrounds: this.backgroundService,
        taskId: started.taskId,
      });
      return {
        output: JSON.stringify(structured),
        structured,
        metadata: {
          taskId: started.taskId,
          runInBackground: true,
          sandboxMode,
          sandboxProfile: this.sandboxProfile.name,
          policyProfile: this.policyProfileName,
        },
      };
    }

    const result = await executeShellCommand({
      runtime: this.runtime,
      command: args.command,
      cwd: workdir,
      timeoutMs: args.timeoutMs ?? this.defaultTimeoutMs,
      sandbox: sandboxMode,
      sandboxProfile: this.sandboxProfile.name,
      policyProfile: this.policyProfileName,
      requireSandboxEnforcement: sandboxedExecution && this.requireSandboxEnforcement,
      executionMode: assessment.executionMode,
      sandboxPolicy,
      environment: sandboxPolicy.environment,
      signal: context.signal,
      emit: context.emit,
    });
    const formattedOutput = formatForegroundShellOutput(result.output, result.artifact);
    if (result.aborted) {
      throw new ToolV2AbortError(
        formattedOutput ? `Shell command aborted\n${formattedOutput}` : 'Shell command aborted',
        {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          aborted: result.aborted,
          outputTruncated: result.artifact?.truncated || false,
          ...(result.artifact
            ? {
                outputArtifact: {
                  runId: result.artifact.runId,
                  runDir: result.artifact.runDir,
                  combinedPath: result.artifact.combinedPath,
                  stdoutPath: result.artifact.stdoutPath,
                  stderrPath: result.artifact.stderrPath,
                  metaPath: result.artifact.metaPath,
                },
              }
            : {}),
        }
      );
    }
    if (result.timedOut) {
      throw new ToolV2TimeoutError(
        formattedOutput ? `Shell command timed out\n${formattedOutput}` : 'Shell command timed out',
        {
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          aborted: result.aborted,
          timeoutMs: args.timeoutMs ?? this.defaultTimeoutMs,
          workdir,
          outputTruncated: result.artifact?.truncated || false,
          ...(result.artifact
            ? {
                outputArtifact: {
                  runId: result.artifact.runId,
                  runDir: result.artifact.runDir,
                  combinedPath: result.artifact.combinedPath,
                  stdoutPath: result.artifact.stdoutPath,
                  stderrPath: result.artifact.stderrPath,
                  metaPath: result.artifact.metaPath,
                },
              }
            : {}),
        }
      );
    }
    return {
      output: formattedOutput,
      structured: {
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        workdir,
        sandboxMode,
        sandboxProfile: this.sandboxProfile.name,
        policyProfile: this.policyProfileName,
        sandboxEnforcement: capability?.enforcement || 'none',
        executionMode: assessment.executionMode,
        networkAccess: sandboxPolicy.networkAccess,
        outputTruncated: result.artifact?.truncated || false,
        ...(result.artifact ? { outputArtifact: result.artifact } : {}),
        segments: assessment.segments.map((segment) => ({
          segment: segment.segment,
          effect: segment.decision.effect,
          executionMode: segment.decision.executionMode || 'sandboxed',
          matchedRule: segment.decision.matchedRule,
        })),
      },
      metadata: {
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        sandboxMode,
        sandboxProfile: this.sandboxProfile.name,
        policyProfile: this.policyProfileName,
        sandboxEnforcement: capability?.enforcement || 'none',
        executionMode: assessment.executionMode,
        networkAccess: sandboxPolicy.networkAccess,
        outputTruncated: result.artifact?.truncated || false,
        ...(result.artifact
          ? {
              outputArtifact: {
                runId: result.artifact.runId,
                runDir: result.artifact.runDir,
                combinedPath: result.artifact.combinedPath,
                stdoutPath: result.artifact.stdoutPath,
                stderrPath: result.artifact.stderrPath,
                metaPath: result.artifact.metaPath,
              },
            }
          : {}),
        matchedRule:
          assessment.matchedRules.length === 1
            ? assessment.matchedRules[0]
            : assessment.matchedRules,
        requestedPermissions: assessment.requestedPermissions,
      },
    };
  }

  private evaluateCommand(command: string, workdir: string) {
    const assessment = assessShellCommand(command, this.commandPolicy);
    return {
      ...assessment,
      requestedPermissions: resolvePermissionTemplatePaths(
        assessment.requestedPermissions,
        workdir
      ),
    };
  }
}

export interface LocalShellToolV2Options {
  readonly runtime?: ShellRuntime;
  readonly backgroundService?: ShellBackgroundExecutionService;
  readonly profile?: ShellPolicyProfile;
  readonly policy?: ShellCommandPolicy;
  readonly defaultTimeoutMs?: number;
  readonly approvalMode?: ShellApprovalMode;
  readonly sandboxProfile?: ShellSandboxProfile;
  readonly preferredSandbox?: ToolSandboxMode;
  readonly requireSandboxEnforcement?: boolean;
}

async function executeShellCommand(options: {
  runtime: ShellRuntime;
  command: string;
  cwd: string;
  timeoutMs: number;
  sandbox: ToolSandboxMode;
  sandboxProfile: string;
  policyProfile: string;
  requireSandboxEnforcement: boolean;
  executionMode?: ShellExecutionMode;
  sandboxPolicy: ReturnType<typeof createShellSandboxPolicy>;
  environment: Record<string, string>;
  signal?: AbortSignal;
  emit?: ToolExecutionContext['emit'];
}): Promise<{
  exitCode: number;
  timedOut: boolean;
  aborted: boolean;
  output: string;
  artifact?: ShellOutputArtifact;
}> {
  return options.runtime.execute({
    command: options.command,
    cwd: path.resolve(options.cwd),
    timeoutMs: options.timeoutMs,
    sandbox: options.sandbox,
    sandboxProfile: options.sandboxProfile,
    policyProfile: options.policyProfile,
    requireSandboxEnforcement: options.requireSandboxEnforcement,
    executionMode: options.executionMode,
    sandboxPolicy: options.sandboxPolicy,
    environment: options.environment,
    signal: options.signal,
    onStdout: async (chunk) => {
      await options.emit?.({ type: 'stdout', message: chunk });
    },
    onStderr: async (chunk) => {
      await options.emit?.({ type: 'stderr', message: chunk });
    },
  });
}

function formatForegroundShellOutput(output: string, artifact?: ShellOutputArtifact): string {
  if (!artifact?.truncated) {
    return output;
  }

  const lines = [output.trim()];
  lines.push(`Full output saved to: ${artifact.combinedPath}`);
  lines.push(`Metadata saved to: ${artifact.metaPath}`);
  return lines.filter((line) => line.length > 0).join('\n');
}

function buildApprovalReason(
  decision: ReturnType<LocalShellToolV2['evaluateCommand']>,
  workdir: string
): string {
  if (decision.reason) {
    return decision.reason;
  }

  if ((decision.executionMode || 'sandboxed') === 'escalated') {
    return `Execute shell command with sandbox escalation in ${workdir}`;
  }

  return `Execute shell command in ${workdir}`;
}

function resolvePermissionTemplatePaths(
  permissions: ToolPermissionProfile | undefined,
  workdir: string
): ToolPermissionProfile | undefined {
  if (!permissions) {
    return undefined;
  }

  return {
    fileSystem: permissions.fileSystem
      ? {
          read: (permissions.fileSystem.read || []).map((entry) =>
            resolvePermissionTemplatePath(entry, workdir)
          ),
          write: (permissions.fileSystem.write || []).map((entry) =>
            resolvePermissionTemplatePath(entry, workdir)
          ),
        }
      : undefined,
    network: permissions.network
      ? {
          enabled: permissions.network.enabled,
          allowedHosts: permissions.network.allowedHosts,
          deniedHosts: permissions.network.deniedHosts,
        }
      : undefined,
  };
}

function resolvePermissionTemplatePath(inputPath: string, workdir: string): string {
  if (inputPath === '$WORKDIR' || inputPath === '$CWD') {
    return workdir;
  }
  return resolveToolPath(inputPath, workdir);
}
