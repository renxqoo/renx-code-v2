import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { resolveRenxHome } from '../../config/paths';
import type {
  OrganizationPolicyConfig,
  OrganizationPolicyScope,
  OrganizationWorkspacePolicy,
} from './organization-policy';

export const AGENT_ORGANIZATION_POLICY_FILE_ENV = 'AGENT_ORGANIZATION_POLICY_FILE';
export const AGENT_ORGANIZATION_POLICY_VERSION_ENV = 'AGENT_ORGANIZATION_POLICY_VERSION';

const PROJECT_DIR_NAME = '.renx';
const DEFAULT_POLICY_FILENAME = 'organization-policy.json';
const DEFAULT_POLICY_VERSION = 'org-policy-v1';

const organizationPolicyRuleMatchSchema = z
  .object({
    toolNames: z.array(z.string().min(1)).optional(),
    mutating: z.boolean().optional(),
    riskLevels: z.enum(['low', 'medium', 'high', 'critical']).array().optional(),
    sensitivities: z.enum(['normal', 'sensitive', 'restricted']).array().optional(),
    pathPrefixes: z.array(z.string().min(1)).optional(),
    hosts: z.array(z.string().min(1)).optional(),
    principalRoles: z.array(z.string().min(1)).optional(),
  })
  .strict();

const organizationPolicyRuleSchema = z
  .object({
    id: z.string().min(1),
    effect: z.enum(['deny', 'require_approval']),
    reason: z.string().min(1),
    priority: z.number().int().optional(),
    tags: z.array(z.string().min(1)).optional(),
    approvalKey: z.string().min(1).optional(),
    match: organizationPolicyRuleMatchSchema.optional(),
  })
  .strict();

const organizationPolicyFileSystemSchema = z
  .object({
    mode: z.enum(['restricted', 'unrestricted']).optional(),
    readRoots: z.array(z.string().min(1)).optional(),
    writeRoots: z.array(z.string().min(1)).optional(),
  })
  .strict();

const organizationPolicyNetworkSchema = z
  .object({
    mode: z.enum(['restricted', 'enabled']).optional(),
    allowedHosts: z.array(z.string().min(1)).optional(),
    deniedHosts: z.array(z.string().min(1)).optional(),
  })
  .strict();

const organizationPolicyScopeSchemaBase = {
  fileSystem: organizationPolicyFileSystemSchema.optional(),
  network: organizationPolicyNetworkSchema.optional(),
  approvalPolicy: z.enum(['never', 'on-request', 'on-failure', 'unless-trusted']).optional(),
  trustLevel: z.enum(['unknown', 'trusted', 'untrusted']).optional(),
  rules: z.array(organizationPolicyRuleSchema).optional(),
};

const organizationPolicyScopeSchema: z.ZodType<OrganizationPolicyScope> = z
  .object(organizationPolicyScopeSchemaBase)
  .strict();

const organizationWorkspacePolicySchema: z.ZodType<OrganizationWorkspacePolicy> = z.lazy(() =>
  z
    .object({
      ...organizationPolicyScopeSchemaBase,
      workspaceId: z.string().min(1).optional(),
      rootPath: z.string().min(1).optional(),
      environments: z.record(z.string(), organizationPolicyScopeSchema).optional(),
    })
    .strict()
);

const organizationPolicyConfigSchema: z.ZodType<OrganizationPolicyConfig> = z
  .object({
    version: z.string().min(1).optional(),
    defaults: organizationPolicyScopeSchema.optional(),
    environments: z.record(z.string(), organizationPolicyScopeSchema).optional(),
    workspaces: z.array(organizationWorkspacePolicySchema).optional(),
  })
  .strict();

export interface OrganizationPolicyLoadOptions {
  readonly filePath?: string;
  readonly projectRoot?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export interface LoadedOrganizationPolicy {
  readonly policy?: OrganizationPolicyConfig;
  readonly policyVersion?: string;
  readonly sources: {
    readonly explicit: string | null;
    readonly project: string | null;
    readonly global: string | null;
  };
}

export class OrganizationPolicyConfigError extends Error {
  readonly filePath: string;

  constructor(filePath: string, message: string) {
    super(`Invalid organization policy config at ${filePath}: ${message}`);
    this.name = 'OrganizationPolicyConfigError';
    this.filePath = filePath;
  }
}

export function loadOrganizationPolicy(
  options: OrganizationPolicyLoadOptions = {}
): LoadedOrganizationPolicy {
  const env = options.env || process.env;
  const explicitPath = readConfiguredFilePath(
    options.filePath || env[AGENT_ORGANIZATION_POLICY_FILE_ENV]
  );
  const projectPath = options.projectRoot
    ? path.join(path.resolve(options.projectRoot), PROJECT_DIR_NAME, DEFAULT_POLICY_FILENAME)
    : null;
  const globalPath = path.join(resolveRenxHome(env), DEFAULT_POLICY_FILENAME);

  if (explicitPath) {
    const explicitPolicy = readPolicyFile(explicitPath);
    return {
      policy: explicitPolicy || undefined,
      policyVersion: resolvePolicyVersion(explicitPolicy, env),
      sources: {
        explicit: explicitPolicy ? explicitPath : null,
        project: null,
        global: null,
      },
    };
  }

  const globalPolicy = readPolicyFile(globalPath);
  const projectPolicy = projectPath ? readPolicyFile(projectPath) : null;
  const merged = mergeOrganizationPolicyConfigs(globalPolicy, projectPolicy);

  return {
    policy: merged || undefined,
    policyVersion: resolvePolicyVersion(projectPolicy || globalPolicy, env),
    sources: {
      explicit: null,
      project: projectPolicy ? projectPath : null,
      global: globalPolicy ? globalPath : null,
    },
  };
}

export function mergeOrganizationPolicyConfigs(
  base?: OrganizationPolicyConfig | null,
  override?: OrganizationPolicyConfig | null
): OrganizationPolicyConfig | undefined {
  if (!base && !override) {
    return undefined;
  }
  if (!base) {
    return clonePolicy(override);
  }
  if (!override) {
    return clonePolicy(base);
  }

  return {
    version: override.version || base.version,
    defaults: mergePolicyScope(base.defaults, override.defaults),
    environments: mergePolicyScopeMap(base.environments, override.environments),
    workspaces: mergeWorkspacePolicies(base.workspaces, override.workspaces),
  };
}

export function resolveDefaultOrganizationPolicyPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveRenxHome(env), DEFAULT_POLICY_FILENAME);
}

function readConfiguredFilePath(value?: string): string | null {
  const normalized = value?.trim();
  return normalized ? path.resolve(normalized) : null;
}

function readPolicyFile(filePath: string): OrganizationPolicyConfig | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  } catch (error) {
    throw new OrganizationPolicyConfigError(
      filePath,
      error instanceof Error ? error.message : 'Invalid JSON'
    );
  }

  const result = organizationPolicyConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new OrganizationPolicyConfigError(filePath, formatZodIssues(result.error.issues));
  }

  return result.data;
}

function resolvePolicyVersion(
  policy: OrganizationPolicyConfig | null | undefined,
  env: NodeJS.ProcessEnv
): string {
  return (
    env[AGENT_ORGANIZATION_POLICY_VERSION_ENV]?.trim() || policy?.version || DEFAULT_POLICY_VERSION
  );
}

function clonePolicy(
  policy?: OrganizationPolicyConfig | null
): OrganizationPolicyConfig | undefined {
  if (!policy) {
    return undefined;
  }
  return {
    version: policy.version,
    defaults: clonePolicyScope(policy.defaults),
    environments: clonePolicyScopeMap(policy.environments),
    workspaces: policy.workspaces?.map(cloneWorkspacePolicy),
  };
}

function clonePolicyScope(scope?: OrganizationPolicyScope): OrganizationPolicyScope | undefined {
  if (!scope) {
    return undefined;
  }
  return {
    fileSystem: scope.fileSystem
      ? {
          mode: scope.fileSystem.mode,
          readRoots: scope.fileSystem.readRoots ? [...scope.fileSystem.readRoots] : undefined,
          writeRoots: scope.fileSystem.writeRoots ? [...scope.fileSystem.writeRoots] : undefined,
        }
      : undefined,
    network: scope.network
      ? {
          mode: scope.network.mode,
          allowedHosts: scope.network.allowedHosts ? [...scope.network.allowedHosts] : undefined,
          deniedHosts: scope.network.deniedHosts ? [...scope.network.deniedHosts] : undefined,
        }
      : undefined,
    approvalPolicy: scope.approvalPolicy,
    trustLevel: scope.trustLevel,
    rules: scope.rules
      ? scope.rules.map((rule) => ({
          ...rule,
          match: rule.match ? { ...rule.match } : undefined,
          tags: rule.tags ? [...rule.tags] : undefined,
        }))
      : undefined,
  };
}

function clonePolicyScopeMap(
  scopes?: Record<string, OrganizationPolicyScope>
): Record<string, OrganizationPolicyScope> | undefined {
  if (!scopes) {
    return undefined;
  }
  const result: Record<string, OrganizationPolicyScope> = {};
  for (const [key, scope] of Object.entries(scopes)) {
    const cloned = clonePolicyScope(scope);
    if (cloned) {
      result[key] = cloned;
    }
  }
  return result;
}

function cloneWorkspacePolicy(policy: OrganizationWorkspacePolicy): OrganizationWorkspacePolicy {
  return {
    ...clonePolicyScope(policy),
    workspaceId: policy.workspaceId,
    rootPath: policy.rootPath,
    environments: clonePolicyScopeMap(policy.environments),
  };
}

function mergePolicyScope(
  base?: OrganizationPolicyScope,
  override?: OrganizationPolicyScope
): OrganizationPolicyScope | undefined {
  if (!base && !override) {
    return undefined;
  }

  return {
    fileSystem:
      base?.fileSystem || override?.fileSystem
        ? {
            mode: override?.fileSystem?.mode || base?.fileSystem?.mode,
            readRoots: uniqueValues([
              ...(base?.fileSystem?.readRoots || []),
              ...(override?.fileSystem?.readRoots || []),
            ]),
            writeRoots: uniqueValues([
              ...(base?.fileSystem?.writeRoots || []),
              ...(override?.fileSystem?.writeRoots || []),
            ]),
          }
        : undefined,
    network:
      base?.network || override?.network
        ? {
            mode: override?.network?.mode || base?.network?.mode,
            allowedHosts: uniqueValues([
              ...(base?.network?.allowedHosts || []),
              ...(override?.network?.allowedHosts || []),
            ]),
            deniedHosts: uniqueValues([
              ...(base?.network?.deniedHosts || []),
              ...(override?.network?.deniedHosts || []),
            ]),
          }
        : undefined,
    approvalPolicy: override?.approvalPolicy || base?.approvalPolicy,
    trustLevel: override?.trustLevel || base?.trustLevel,
    rules: [...(base?.rules || []), ...(override?.rules || [])],
  };
}

function mergePolicyScopeMap(
  base?: Record<string, OrganizationPolicyScope>,
  override?: Record<string, OrganizationPolicyScope>
): Record<string, OrganizationPolicyScope> | undefined {
  if (!base && !override) {
    return undefined;
  }

  const result: Record<string, OrganizationPolicyScope> = {};
  for (const key of uniqueValues([...Object.keys(base || {}), ...Object.keys(override || {})])) {
    const merged = mergePolicyScope(base?.[key], override?.[key]);
    if (merged) {
      result[key] = merged;
    }
  }
  return result;
}

function mergeWorkspacePolicies(
  base?: OrganizationWorkspacePolicy[],
  override?: OrganizationWorkspacePolicy[]
): OrganizationWorkspacePolicy[] | undefined {
  if (!base && !override) {
    return undefined;
  }

  const ordered = [...(base || []), ...(override || [])];
  const result: OrganizationWorkspacePolicy[] = [];
  const indexByKey = new Map<string, number>();

  for (const item of ordered) {
    const key = buildWorkspacePolicyKey(item);
    const index = indexByKey.get(key);
    if (index === undefined) {
      indexByKey.set(key, result.length);
      result.push(cloneWorkspacePolicy(item));
      continue;
    }
    result[index] = {
      ...mergePolicyScope(result[index], item),
      workspaceId: item.workspaceId || result[index].workspaceId,
      rootPath: item.rootPath || result[index].rootPath,
      environments: mergePolicyScopeMap(result[index].environments, item.environments),
    };
  }

  return result;
}

function buildWorkspacePolicyKey(policy: OrganizationWorkspacePolicy): string {
  if (policy.workspaceId) {
    return `workspace:${policy.workspaceId}`;
  }
  if (policy.rootPath) {
    return `root:${policy.rootPath}`;
  }
  return `policy:${JSON.stringify({
    fileSystem: policy.fileSystem,
    network: policy.network,
    approvalPolicy: policy.approvalPolicy,
    trustLevel: policy.trustLevel,
    rules: policy.rules,
    environments: policy.environments,
  })}`;
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

function formatZodIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const target = issue.path.length > 0 ? issue.path.join('.') : 'root';
      return `${target}: ${issue.message}`;
    })
    .join('; ');
}
