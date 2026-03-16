import type { ToolSandboxMode } from './contracts';
import {
  createDefaultShellCommandPolicy,
  createRuleBasedShellCommandPolicy,
  type DefaultShellCommandPolicyOptions,
  type ShellCommandPolicy,
} from './shell-policy';

export type ShellApprovalMode = 'always' | 'policy';

export interface ShellSandboxProfile {
  readonly name: string;
  readonly description: string;
  readonly mode: ToolSandboxMode;
  readonly requireRuntimeEnforcement?: boolean;
}

export interface ShellPolicyProfile {
  readonly name: string;
  readonly description: string;
  readonly policy: ShellCommandPolicy;
  readonly approvalMode: ShellApprovalMode;
  readonly sandboxProfile: ShellSandboxProfile;
  readonly defaultTimeoutMs?: number;
}

export interface CreateShellPolicyProfileOptions {
  readonly name: string;
  readonly description: string;
  readonly approvalMode: ShellApprovalMode;
  readonly sandboxProfile: ShellSandboxProfile;
  readonly defaultTimeoutMs?: number;
  readonly policy?: ShellCommandPolicy;
  readonly policyOptions?: DefaultShellCommandPolicyOptions;
}

export function createShellSandboxProfile(profile: ShellSandboxProfile): ShellSandboxProfile {
  return {
    ...profile,
  };
}

export function createShellPolicyProfile(
  options: CreateShellPolicyProfileOptions
): ShellPolicyProfile {
  return {
    name: options.name,
    description: options.description,
    approvalMode: options.approvalMode,
    sandboxProfile: options.sandboxProfile,
    defaultTimeoutMs: options.defaultTimeoutMs,
    policy: options.policy || createDefaultShellCommandPolicy(options.policyOptions),
  };
}

export const SHELL_SANDBOX_PROFILES = {
  fullAccess: createShellSandboxProfile({
    name: 'full-access',
    description: 'No shell sandbox isolation expectations beyond the host runtime.',
    mode: 'full-access',
  }),
  workspaceWrite: createShellSandboxProfile({
    name: 'workspace-write',
    description: 'Prefer workspace-scoped execution with controlled writes.',
    mode: 'workspace-write',
  }),
  restricted: createShellSandboxProfile({
    name: 'restricted',
    description: 'Prefer read-heavy execution in the most constrained shell sandbox.',
    mode: 'restricted',
    requireRuntimeEnforcement: true,
  }),
} as const;

export const SHELL_POLICY_PROFILES = {
  standard: createShellPolicyProfile({
    name: 'standard',
    description: 'Balanced default shell profile with explicit approval for every command.',
    approvalMode: 'always',
    sandboxProfile: SHELL_SANDBOX_PROFILES.fullAccess,
  }),
  workspaceGuarded: createShellPolicyProfile({
    name: 'workspace-guarded',
    description:
      'Workspace-oriented shell profile that allows safe reads and asks for elevated commands.',
    approvalMode: 'policy',
    sandboxProfile: SHELL_SANDBOX_PROFILES.workspaceWrite,
    defaultTimeoutMs: 45000,
    policy: createRuleBasedShellCommandPolicy({
      rules: [
        {
          name: 'git-write-escalation',
          pattern: [
            { anyOf: ['git'] },
            { anyOf: ['commit', 'push', 'rebase', 'reset', 'clean', 'checkout'] },
          ],
          decision: 'prompt',
          justification: 'Git state-changing commands require explicit approval',
          preferredSandbox: 'full-access',
        },
        {
          name: 'package-manager-write-escalation',
          pattern: [
            { anyOf: ['pnpm', 'npm', 'yarn', 'bun'] },
            { anyOf: ['install', 'add', 'remove', 'update', 'upgrade', 'dlx', 'create'] },
          ],
          decision: 'prompt',
          justification:
            'Package manager mutations require temporary sandboxed network access and workspace writes',
          preferredSandbox: 'workspace-write',
          executionMode: 'sandboxed',
          additionalPermissions: {
            network: {
              enabled: true,
            },
          },
        },
        {
          name: 'package-manager-scripts',
          pattern: [
            { anyOf: ['pnpm', 'npm', 'yarn', 'bun'] },
            { anyOf: ['test', 'lint', 'typecheck', 'run', 'exec'] },
          ],
          decision: 'allow',
          justification: 'Workspace-local package scripts can stay sandboxed',
          preferredSandbox: 'workspace-write',
          executionMode: 'sandboxed',
        },
      ],
      fallback: createDefaultShellCommandPolicy({
        approvalRequiredCommands: [
          'git',
          'pnpm',
          'npm',
          'yarn',
          'bun',
          'node',
          'python',
          'python3',
        ],
        preferredSandbox: 'workspace-write',
      }),
    }),
  }),
  restrictedStrict: createShellPolicyProfile({
    name: 'restricted-strict',
    description: 'Restricted shell profile that only permits a tight investigative command set.',
    approvalMode: 'policy',
    sandboxProfile: SHELL_SANDBOX_PROFILES.restricted,
    defaultTimeoutMs: 30000,
    policyOptions: {
      safeCommands: [
        'ls',
        'dir',
        'pwd',
        'cat',
        'type',
        'head',
        'tail',
        'echo',
        'printf',
        'wc',
        'sort',
        'uniq',
        'cut',
        'awk',
        'sed',
        'grep',
        'rg',
        'find',
        'get-childitem',
        'get-content',
        'select-string',
        'get-process',
        'where-object',
        'select-object',
        'get-item',
        'test-path',
        'resolve-path',
        'gci',
        'gc',
        'sls',
        'foreach-object',
        'git',
        'date',
        'uname',
        'whoami',
        'id',
        'env',
        'printenv',
      ],
      approvalRequiredCommands: ['git'],
      defaultEffect: 'deny',
      preferredSandbox: 'restricted',
    },
  }),
} as const;
