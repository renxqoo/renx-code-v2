import * as path from 'node:path';
import type { AuthorizationExecutionRequest, ToolAuthorizationService } from '../auth/contracts';
import type {
  AuthorizationPolicyEngine,
  AuthorizationPolicyEvaluation,
} from '../auth/policy-engine';
import type {
  ToolApprovalPolicy,
  ToolExecutionPlan,
  ToolFileSystemPolicy,
  ToolNetworkPolicy,
  ToolTrustLevel,
} from './contracts';
import {
  isDerivedDefaultApprovalPolicy,
  isDerivedDefaultFileSystemPolicy,
  resolveDefaultFileSystemPolicyForTrust,
  resolveDefaultApprovalPolicyForTrust,
  resolveDefaultToolTrustLevel,
} from './default-permissions';
import { ToolV2PolicyDeniedError } from './errors';

export interface OrganizationPolicyRule {
  readonly id: string;
  readonly effect: 'deny' | 'require_approval';
  readonly reason: string;
  readonly priority?: number;
  readonly tags?: string[];
  readonly approvalKey?: string;
  readonly match?: {
    readonly toolNames?: string[];
    readonly mutating?: boolean;
    readonly riskLevels?: NonNullable<ToolExecutionPlan['riskLevel']>[];
    readonly sensitivities?: NonNullable<ToolExecutionPlan['sensitivity']>[];
    readonly pathPrefixes?: string[];
    readonly hosts?: string[];
    readonly principalRoles?: string[];
  };
}

export interface OrganizationPolicyScope {
  readonly fileSystem?: Partial<ToolFileSystemPolicy>;
  readonly network?: Partial<ToolNetworkPolicy>;
  readonly approvalPolicy?: ToolApprovalPolicy;
  readonly trustLevel?: ToolTrustLevel;
  readonly rules?: OrganizationPolicyRule[];
}

export interface OrganizationWorkspacePolicy extends OrganizationPolicyScope {
  readonly workspaceId?: string;
  readonly rootPath?: string;
  readonly environments?: Record<string, OrganizationPolicyScope>;
}

export interface OrganizationPolicyConfig {
  readonly version?: string;
  readonly defaults?: OrganizationPolicyScope;
  readonly environments?: Record<string, OrganizationPolicyScope>;
  readonly workspaces?: OrganizationWorkspacePolicy[];
}

export interface ResolvedOrganizationPolicy {
  readonly fileSystemPolicy: ToolFileSystemPolicy;
  readonly networkPolicy: ToolNetworkPolicy;
  readonly approvalPolicy: ToolApprovalPolicy;
  readonly trustLevel?: ToolTrustLevel;
  readonly matchedRuleIds: string[];
  readonly tags: string[];
  readonly denyRule?: OrganizationPolicyRule;
  readonly approvalRule?: OrganizationPolicyRule;
}

export function resolveOrganizationPolicy(
  request: AuthorizationExecutionRequest,
  config?: OrganizationPolicyConfig
): ResolvedOrganizationPolicy {
  const scopes = collectMatchedScopes(request, config);
  const trustLevel = scopes.reduce<ToolTrustLevel | undefined>(
    (current, scope) => scope.trustLevel || current,
    request.trustLevel
  );
  const baseTrustLevel = resolveDefaultToolTrustLevel(request.trustLevel);
  const resolvedTrustLevel = resolveDefaultToolTrustLevel(trustLevel);
  const fileSystemBase = isDerivedDefaultFileSystemPolicy(
    request.fileSystemPolicy,
    request.workingDirectory,
    baseTrustLevel
  )
    ? resolveDefaultFileSystemPolicyForTrust(request.workingDirectory, resolvedTrustLevel)
    : request.fileSystemPolicy;
  const fileSystemPolicy = scopes.reduce(
    (current, scope) => mergeFileSystemPolicy(current, scope.fileSystem),
    fileSystemBase
  );
  const networkPolicy = scopes.reduce(
    (current, scope) => mergeNetworkPolicy(current, scope.network),
    request.networkPolicy
  );
  const approvalBase = isDerivedDefaultApprovalPolicy(request.approvalPolicy, baseTrustLevel)
    ? resolveDefaultApprovalPolicyForTrust(resolvedTrustLevel)
    : request.approvalPolicy;
  const approvalPolicy = scopes.reduce<ToolApprovalPolicy>(
    (current, scope) => scope.approvalPolicy || current,
    approvalBase
  );

  const matchedRules = scopes
    .flatMap((scope) => scope.rules || [])
    .filter((rule) => matchesRule(rule, request))
    .sort((left, right) => (right.priority || 0) - (left.priority || 0));

  const denyRule = matchedRules.find((rule) => rule.effect === 'deny');
  const approvalRule = matchedRules.find((rule) => rule.effect === 'require_approval');

  return {
    fileSystemPolicy,
    networkPolicy,
    approvalPolicy,
    trustLevel: resolvedTrustLevel,
    matchedRuleIds: matchedRules.map((rule) => rule.id),
    tags: uniqueValues(matchedRules.flatMap((rule) => rule.tags || [])),
    denyRule,
    approvalRule,
  };
}

export function applyOrganizationPolicyToPlan(
  plan: ToolExecutionPlan,
  resolved: ResolvedOrganizationPolicy,
  toolName: string
): ToolExecutionPlan {
  if (!resolved.approvalRule) {
    return plan;
  }

  if (plan.approval?.required) {
    return {
      ...plan,
      approval: {
        ...plan.approval,
        key: plan.approval.key || buildApprovalKey(resolved.approvalRule, toolName),
      },
    };
  }

  return {
    ...plan,
    approval: {
      required: true,
      reason: resolved.approvalRule.reason,
      key: buildApprovalKey(resolved.approvalRule, toolName),
    },
  };
}

export class OrganizationPolicyAuthorizationService implements ToolAuthorizationService {
  constructor(
    private readonly delegate: ToolAuthorizationService,
    private readonly policy?: OrganizationPolicyConfig
  ) {}

  async authorizeExecution(request: AuthorizationExecutionRequest) {
    const resolved = resolveOrganizationPolicy(request, this.policy);
    const governedPlan = applyOrganizationPolicyToPlan(request.plan, resolved, request.toolName);
    const governedRequest: AuthorizationExecutionRequest = {
      ...request,
      plan: governedPlan,
      fileSystemPolicy: resolved.fileSystemPolicy,
      networkPolicy: resolved.networkPolicy,
      approvalPolicy: resolved.approvalPolicy,
      trustLevel: resolved.trustLevel,
      runtime: {
        ...request.runtime,
        evaluatePolicy: createGovernedPolicyCallback(request, resolved),
      },
    };

    const result = await this.delegate.authorizeExecution(governedRequest);
    if (resolved.matchedRuleIds.length === 0 && resolved.tags.length === 0) {
      return result;
    }

    return {
      ...result,
      decision: {
        ...result.decision,
        rulesMatched: uniqueValues([...result.decision.rulesMatched, ...resolved.matchedRuleIds]),
        tags: uniqueValues([...result.decision.tags, ...resolved.tags]),
        approval: governedPlan.approval
          ? {
              required: true,
              resolved: result.decision.approval?.resolved || false,
              cached: result.decision.approval?.cached,
              scope: result.decision.approval?.scope,
              key: governedPlan.approval.key,
            }
          : result.decision.approval,
      },
    };
  }

  requestPermissions(request: Parameters<ToolAuthorizationService['requestPermissions']>[0]) {
    return this.delegate.requestPermissions(request);
  }
}

export class OrganizationPolicyEngineAdapter implements AuthorizationPolicyEngine {
  constructor(private readonly config?: OrganizationPolicyConfig) {}

  async evaluate(request: AuthorizationExecutionRequest): Promise<AuthorizationPolicyEvaluation> {
    const resolved = resolveOrganizationPolicy(request, this.config);
    if (!resolved.denyRule) {
      return {
        denied: false,
        reason: 'Allowed by organization policy',
        rulesMatched: resolved.matchedRuleIds,
        tags: resolved.tags,
      };
    }

    return {
      denied: true,
      reason: resolved.denyRule.reason,
      rulesMatched: resolved.matchedRuleIds,
      tags: resolved.tags,
      metadata: {
        reasonCode: resolved.denyRule.id,
        policySource: 'organization',
      },
    };
  }
}

function createGovernedPolicyCallback(
  request: AuthorizationExecutionRequest,
  resolved: ResolvedOrganizationPolicy
) {
  return async (
    info: Parameters<NonNullable<AuthorizationExecutionRequest['runtime']['evaluatePolicy']>>[0]
  ) => {
    if (resolved.denyRule) {
      return {
        allowed: false,
        code: resolved.denyRule.id,
        message: resolved.denyRule.reason,
        audit: {
          policySource: 'organization',
          matchedRules: resolved.matchedRuleIds,
          tags: resolved.tags,
          workspaceId: request.runtime.principal.workspaceId,
          environment: readEnvironmentName(request),
        },
      };
    }

    return request.runtime.evaluatePolicy
      ? request.runtime.evaluatePolicy(info)
      : { allowed: true as const };
  };
}

function collectMatchedScopes(
  request: AuthorizationExecutionRequest,
  config?: OrganizationPolicyConfig
): OrganizationPolicyScope[] {
  if (!config) {
    return [];
  }

  const scopes: OrganizationPolicyScope[] = [];
  if (config.defaults) {
    scopes.push(config.defaults);
  }

  const environment = readEnvironmentName(request);
  if (environment && config.environments?.[environment]) {
    scopes.push(config.environments[environment]);
  }

  for (const workspacePolicy of config.workspaces || []) {
    if (!matchesWorkspacePolicy(workspacePolicy, request)) {
      continue;
    }
    scopes.push(workspacePolicy);
    if (environment && workspacePolicy.environments?.[environment]) {
      scopes.push(workspacePolicy.environments[environment]);
    }
  }

  return scopes;
}

function matchesWorkspacePolicy(
  policy: OrganizationWorkspacePolicy,
  request: AuthorizationExecutionRequest
): boolean {
  if (policy.workspaceId && policy.workspaceId !== request.runtime.principal.workspaceId) {
    return false;
  }
  if (policy.rootPath) {
    const normalizedRoot = normalizePath(policy.rootPath);
    const workingDirectory = normalizePath(request.workingDirectory);
    if (!workingDirectory.startsWith(normalizedRoot)) {
      return false;
    }
  }
  return policy.workspaceId !== undefined || policy.rootPath !== undefined;
}

function matchesRule(
  rule: OrganizationPolicyRule,
  request: AuthorizationExecutionRequest
): boolean {
  const match = rule.match;
  if (!match) {
    return true;
  }

  if (match.toolNames && !match.toolNames.includes(request.toolName)) {
    return false;
  }
  if (typeof match.mutating === 'boolean' && match.mutating !== request.plan.mutating) {
    return false;
  }
  if (
    match.riskLevels &&
    (!request.plan.riskLevel || !match.riskLevels.includes(request.plan.riskLevel))
  ) {
    return false;
  }
  if (
    match.sensitivities &&
    (!request.plan.sensitivity || !match.sensitivities.includes(request.plan.sensitivity))
  ) {
    return false;
  }
  if (match.principalRoles) {
    const roles = request.runtime.principal.roles;
    if (!match.principalRoles.some((role) => roles.includes(role))) {
      return false;
    }
  }
  if (match.pathPrefixes) {
    const requestPaths = [...(request.plan.readPaths || []), ...(request.plan.writePaths || [])];
    const normalizedPrefixes = match.pathPrefixes.map((entry) => normalizePath(entry));
    const matched = requestPaths.some((entry) =>
      normalizedPrefixes.some((prefix) => normalizePath(entry).startsWith(prefix))
    );
    if (!matched) {
      return false;
    }
  }
  if (match.hosts) {
    const requestHosts = request.plan.networkTargets || [];
    const matched = requestHosts.some((candidate) =>
      match.hosts?.some((host) => candidate === host || candidate.endsWith(`.${host}`))
    );
    if (!matched) {
      return false;
    }
  }

  return true;
}

function mergeFileSystemPolicy(
  base: ToolFileSystemPolicy,
  override?: Partial<ToolFileSystemPolicy>
): ToolFileSystemPolicy {
  if (!override) {
    return base;
  }

  return {
    mode: override.mode || base.mode,
    readRoots: uniqueValues([...(base.readRoots || []), ...(override.readRoots || [])]).map(
      normalizePath
    ),
    writeRoots: uniqueValues([...(base.writeRoots || []), ...(override.writeRoots || [])]).map(
      normalizePath
    ),
  };
}

function mergeNetworkPolicy(
  base: ToolNetworkPolicy,
  override?: Partial<ToolNetworkPolicy>
): ToolNetworkPolicy {
  if (!override) {
    return base;
  }

  return {
    mode: override.mode || base.mode,
    allowedHosts: uniqueValues([...(base.allowedHosts || []), ...(override.allowedHosts || [])]),
    deniedHosts: uniqueValues([...(base.deniedHosts || []), ...(override.deniedHosts || [])]),
  };
}

function buildApprovalKey(rule: OrganizationPolicyRule, toolName: string): string {
  return rule.approvalKey || `org-policy:${rule.id}:${toolName}`;
}

function readEnvironmentName(request: AuthorizationExecutionRequest): string | undefined {
  const environment = request.runtime.principal.attributes?.environment;
  return typeof environment === 'string' && environment.trim().length > 0
    ? environment.trim()
    : undefined;
}

function normalizePath(inputPath: string): string {
  return path.resolve(inputPath);
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

export function assertOrganizationPolicyAllowsExecution(
  request: AuthorizationExecutionRequest,
  config?: OrganizationPolicyConfig
): void {
  const resolved = resolveOrganizationPolicy(request, config);
  if (!resolved.denyRule) {
    return;
  }

  throw new ToolV2PolicyDeniedError(request.toolName, {
    code: resolved.denyRule.id,
    message: resolved.denyRule.reason,
    audit: {
      policySource: 'organization',
      matchedRules: resolved.matchedRuleIds,
      tags: resolved.tags,
    },
  });
}
