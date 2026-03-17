import type {
  ApprovalDecisionRecord,
  AuthorizationAuditRecord,
  AuthorizationDecision,
  PermissionGrantRecord,
  ResourceDescriptor,
} from './contracts';
import type { ToolExecutionPlan } from '../tool-v2/contracts';

export function mergeUniqueValues(...groups: Array<string[] | undefined>): string[] {
  return Array.from(new Set(groups.flatMap((group) => group || [])));
}

export function buildResourceDescriptors(plan: ToolExecutionPlan): ResourceDescriptor[] {
  const resources: ResourceDescriptor[] = [];

  for (const readPath of plan.readPaths || []) {
    resources.push({
      resourceType: 'filesystem',
      action: 'read',
      value: readPath,
    });
  }

  for (const writePath of plan.writePaths || []) {
    resources.push({
      resourceType: 'filesystem',
      action: 'write',
      value: writePath,
    });
  }

  for (const host of plan.networkTargets || []) {
    resources.push({
      resourceType: 'network',
      action: 'connect',
      value: host,
    });
  }

  return resources;
}

export function buildAllowedDecision(input: {
  reason: string;
  policyVersion: string;
  plan: ToolExecutionPlan;
  rulesMatched?: string[];
  tags?: string[];
  grantedPermissions?: PermissionGrantRecord;
  approvalDecision?: ApprovalDecisionRecord;
  approvalCached?: boolean;
}): AuthorizationDecision {
  return {
    outcome: 'allow',
    reason: input.reason,
    policyVersion: input.policyVersion,
    rulesMatched: mergeUniqueValues(input.rulesMatched),
    tags: mergeUniqueValues(input.tags),
    riskLevel: input.plan.riskLevel,
    sensitivity: input.plan.sensitivity,
    grantedPermissions: input.grantedPermissions?.granted,
    approval: input.plan.approval
      ? {
          required: true,
          resolved: true,
          cached: input.approvalCached,
          scope: input.approvalDecision?.scope,
          key: input.plan.approval.key,
        }
      : undefined,
  };
}

export function buildDeniedDecision(input: {
  reason: string;
  policyVersion: string;
  plan: ToolExecutionPlan;
  rulesMatched?: string[];
  tags?: string[];
}): AuthorizationDecision {
  return {
    outcome: 'deny',
    reason: input.reason,
    policyVersion: input.policyVersion,
    rulesMatched: mergeUniqueValues(input.rulesMatched),
    tags: mergeUniqueValues(input.tags),
    riskLevel: input.plan.riskLevel,
    sensitivity: input.plan.sensitivity,
    approval: input.plan.approval
      ? {
          required: true,
          resolved: false,
          key: input.plan.approval.key,
        }
      : undefined,
  };
}

export function buildAuditRecord(input: {
  auditId: string;
  toolCallId: string;
  principalId: string;
  toolName: string;
  decision: AuthorizationDecision;
  plan: ToolExecutionPlan;
  createdAt: number;
  metadata?: Record<string, unknown>;
}): AuthorizationAuditRecord {
  return {
    auditId: input.auditId,
    toolCallId: input.toolCallId,
    principalId: input.principalId,
    sessionId: input.metadata?.sessionId as string | undefined,
    tenantId: input.metadata?.tenantId as string | undefined,
    workspaceId: input.metadata?.workspaceId as string | undefined,
    toolName: input.toolName,
    decision: input.decision.outcome,
    reason: input.decision.reason,
    policyVersion: input.decision.policyVersion,
    resources: buildResourceDescriptors(input.plan),
    rulesMatched: input.decision.rulesMatched,
    tags: input.decision.tags,
    createdAt: input.createdAt,
    metadata: input.metadata,
  };
}
