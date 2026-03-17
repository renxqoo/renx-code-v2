import * as path from 'node:path';
import type {
  AuthorizationDecision,
  AuthorizationExecutionRequest,
  AuthorizationExecutionResult,
  ExplicitPermissionGrantRequest,
  ToolAuthorizationService,
} from './contracts';
import { AuthorizationAuditService } from './audit-service';
import { AuthorizationApprovalService } from './approval-service';
import {
  buildAllowedDecision,
  buildAuditRecord,
  buildDeniedDecision,
  mergeUniqueValues,
} from './decision-merger';
import { AuthorizationPermissionService } from './permission-service';
import { AuthorizationPolicyEngine, DefaultAuthorizationPolicyEngine } from './policy-engine';
import { ToolV2PolicyDeniedError } from '../tool-v2/errors';
import { FileAuthorizationAuditStore } from './audit-service';
import { FileAuthorizationApprovalStore } from './approval-store';
import { FileAuthorizationGrantStore } from './grant-store';
import { getAuthorizationStorageConfig } from './storage-config';

export interface AuthorizationServiceOptions {
  readonly policyVersion?: string;
  readonly policyEngine?: AuthorizationPolicyEngine;
  readonly permissionService?: AuthorizationPermissionService;
  readonly approvalService?: AuthorizationApprovalService;
  readonly auditService?: AuthorizationAuditService;
}

export class AuthorizationService implements ToolAuthorizationService {
  private readonly policyVersion: string;
  private readonly policyEngine: AuthorizationPolicyEngine;
  private readonly permissionService: AuthorizationPermissionService;
  private readonly approvalService: AuthorizationApprovalService;
  private readonly auditService: AuthorizationAuditService;

  constructor(options: AuthorizationServiceOptions = {}) {
    this.policyVersion = options.policyVersion || 'auth-v1';
    this.policyEngine = options.policyEngine || new DefaultAuthorizationPolicyEngine();
    this.permissionService = options.permissionService || new AuthorizationPermissionService();
    this.approvalService = options.approvalService || new AuthorizationApprovalService();
    this.auditService = options.auditService || new AuthorizationAuditService();
  }

  async authorizeExecution(
    request: AuthorizationExecutionRequest
  ): Promise<AuthorizationExecutionResult> {
    const policyEvaluation = await this.policyEngine.evaluate(request);
    if (policyEvaluation.denied) {
      const decision = buildDeniedDecision({
        reason: policyEvaluation.reason,
        policyVersion: this.policyVersion,
        plan: request.plan,
        rulesMatched: policyEvaluation.rulesMatched,
        tags: policyEvaluation.tags,
      });
      await this.recordAudit(request, decision, policyEvaluation.metadata);
      throw new ToolV2PolicyDeniedError(request.toolName, {
        code:
          typeof policyEvaluation.metadata?.reasonCode === 'string'
            ? policyEvaluation.metadata.reasonCode
            : undefined,
        message: policyEvaluation.reason,
        audit: {
          ...(policyEvaluation.metadata || {}),
          policyVersion: this.policyVersion,
          sessionId: request.runtime.sessionId,
          tenantId: request.runtime.principal.tenantId,
          workspaceId: request.runtime.principal.workspaceId,
          rulesMatched: decision.rulesMatched,
          tags: decision.tags,
        },
      });
    }

    try {
      const permissionResolution = await this.permissionService.ensurePermissions(request);
      const approvalResolution = await this.approvalService.ensureApproval({
        ...request,
        fileSystemPolicy: permissionResolution.fileSystemPolicy,
        networkPolicy: permissionResolution.networkPolicy,
      });

      const decision = buildAllowedDecision({
        reason: 'Authorization approved',
        policyVersion: this.policyVersion,
        plan: request.plan,
        rulesMatched: mergeUniqueValues(
          policyEvaluation.rulesMatched,
          permissionResolution.rulesMatched,
          approvalResolution.rulesMatched
        ),
        tags: mergeUniqueValues(
          policyEvaluation.tags,
          permissionResolution.tags,
          approvalResolution.tags
        ),
        grantedPermissions: permissionResolution.grantRecord,
        approvalDecision: approvalResolution.approvalRecord,
        approvalCached: approvalResolution.cached,
      });

      await this.recordAudit(request, decision, {
        grantId: permissionResolution.grantRecord?.grantId,
        approvalId: approvalResolution.approvalRecord?.approvalId,
      });

      return {
        decision,
        fileSystemPolicy: permissionResolution.fileSystemPolicy,
        networkPolicy: permissionResolution.networkPolicy,
      };
    } catch (error) {
      const decision = buildDeniedDecision({
        reason: error instanceof Error ? error.message : String(error),
        policyVersion: this.policyVersion,
        plan: request.plan,
        rulesMatched: policyEvaluation.rulesMatched,
        tags: policyEvaluation.tags,
      });
      await this.recordAudit(request, decision);
      throw error;
    }
  }

  async requestPermissions(request: ExplicitPermissionGrantRequest) {
    return this.permissionService.requestExplicitGrant(request);
  }

  private async recordAudit(
    request: AuthorizationExecutionRequest,
    decision: AuthorizationDecision,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    await this.auditService.record(
      buildAuditRecord({
        auditId: createRecordId('audit'),
        toolCallId: request.toolCallId,
        principalId: request.runtime.principal.principalId,
        toolName: request.toolName,
        decision,
        plan: request.plan,
        createdAt: Date.now(),
        metadata: {
          ...(metadata || {}),
          sessionId: request.runtime.sessionId,
          tenantId: request.runtime.principal.tenantId,
          workspaceId: request.runtime.principal.workspaceId,
        },
      })
    );
  }
}

export interface CreateConfiguredAuthorizationServiceOptions {
  readonly baseDir?: string;
  readonly policyVersion?: string;
  readonly policyEngine?: AuthorizationPolicyEngine;
}

export function createConfiguredAuthorizationService(
  options: CreateConfiguredAuthorizationServiceOptions = {}
): AuthorizationService {
  const config = getAuthorizationStorageConfig();
  const rootDir = options.baseDir || config.rootDir;

  return new AuthorizationService({
    policyVersion: options.policyVersion || config.policyVersion,
    policyEngine: options.policyEngine || new DefaultAuthorizationPolicyEngine(),
    permissionService: new AuthorizationPermissionService(
      new FileAuthorizationGrantStore({
        filePath: path.join(rootDir, 'permission-grants.json'),
      })
    ),
    approvalService: new AuthorizationApprovalService(
      new FileAuthorizationApprovalStore({
        filePath: path.join(rootDir, 'approval-decisions.json'),
      })
    ),
    auditService: new AuthorizationAuditService(
      new FileAuthorizationAuditStore({
        filePath: path.join(rootDir, 'authorization-audit.json'),
      })
    ),
  });
}

function createRecordId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
