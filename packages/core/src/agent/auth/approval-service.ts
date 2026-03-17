import type { ApprovalDecisionRecord, AuthorizationExecutionRequest } from './contracts';
import { AuthorizationApprovalStore, InMemoryAuthorizationApprovalStore } from './approval-store';
import { ToolV2ApprovalDeniedError } from '../tool-v2/errors';

export interface AuthorizationApprovalResolution {
  readonly approvalRecord?: ApprovalDecisionRecord;
  readonly cached: boolean;
  readonly rulesMatched: string[];
  readonly tags: string[];
}

export class AuthorizationApprovalService {
  constructor(
    private readonly approvalStore: AuthorizationApprovalStore = new InMemoryAuthorizationApprovalStore()
  ) {}

  async ensureApproval(
    request: AuthorizationExecutionRequest
  ): Promise<AuthorizationApprovalResolution> {
    await this.restoreSessionApprovals(request);

    const approval = request.plan.approval;
    if (!approval?.required) {
      return {
        cached: false,
        rulesMatched: ['approval-not-required'],
        tags: ['approval'],
      };
    }

    if (
      request.approvalPolicy === 'unless-trusted' &&
      (request.trustLevel || 'untrusted') === 'trusted'
    ) {
      return {
        cached: false,
        rulesMatched: ['approval-skipped-trusted'],
        tags: ['approval', 'trusted'],
      };
    }

    const cacheKey = approval.key || `${request.toolName}:${approval.reason}`;
    if (request.sessionState.hasApproval(cacheKey)) {
      await request.onStage?.('approval_resolved', {
        toolName: request.toolName,
        approved: true,
        cached: true,
        scope: 'cached',
        key: cacheKey,
        reason: approval.reason,
      });
      return {
        cached: true,
        rulesMatched: ['approval-cached'],
        tags: ['approval', 'cached'],
      };
    }

    if (request.approvalPolicy === 'never') {
      throw new ToolV2ApprovalDeniedError(request.toolName, 'approval policy is set to never');
    }

    if (request.approvalPolicy === 'on-failure') {
      throw new ToolV2ApprovalDeniedError(
        request.toolName,
        'on-failure policy requires a retry-capable runtime and is not supported by authorization service yet'
      );
    }

    if (!request.runtime.requestApproval) {
      throw new ToolV2ApprovalDeniedError(request.toolName, 'approval resolver is not configured');
    }

    await request.onStage?.('approval_requested', {
      toolName: request.toolName,
      key: cacheKey,
      reason: approval.reason,
    });

    const decision = await request.runtime.requestApproval({
      toolName: request.toolName,
      toolCallId: request.toolCallId,
      reason: approval.reason,
      key: cacheKey,
      commandPreview: approval.commandPreview,
      readPaths: request.plan.readPaths,
      writePaths: request.plan.writePaths,
    });

    await request.onStage?.('approval_resolved', {
      toolName: request.toolName,
      approved: decision.approved,
      scope: decision.scope,
      key: cacheKey,
      reason: decision.reason,
    });

    if (!decision.approved) {
      await this.approvalStore.record({
        approvalId: createRecordId('approval'),
        toolCallId: request.toolCallId,
        principalId: request.runtime.principal.principalId,
        sessionId: request.runtime.sessionId,
        tenantId: request.runtime.principal.tenantId,
        workspaceId: request.runtime.principal.workspaceId,
        toolName: request.toolName,
        approverId: decision.approverId || request.runtime.principal.principalId,
        decision: 'denied',
        scope: decision.scope,
        createdAt: Date.now(),
        reason: decision.reason,
        key: cacheKey,
      });
      throw new ToolV2ApprovalDeniedError(request.toolName, decision.reason);
    }

    if (decision.scope === 'turn' || decision.scope === 'session') {
      request.sessionState.grantApproval(cacheKey, decision.scope);
    }

    const record: ApprovalDecisionRecord = {
      approvalId: createRecordId('approval'),
      toolCallId: request.toolCallId,
      principalId: request.runtime.principal.principalId,
      sessionId: request.runtime.sessionId,
      tenantId: request.runtime.principal.tenantId,
      workspaceId: request.runtime.principal.workspaceId,
      toolName: request.toolName,
      approverId: decision.approverId || request.runtime.principal.principalId,
      decision: 'approved',
      scope: decision.scope,
      createdAt: Date.now(),
      reason: decision.reason,
      key: cacheKey,
    };
    await this.approvalStore.record(record);

    return {
      approvalRecord: record,
      cached: false,
      rulesMatched: ['approval-granted'],
      tags: [
        'approval',
        decision.scope === 'session' ? 'scope-session' : `scope-${decision.scope}`,
      ],
    };
  }

  private async restoreSessionApprovals(request: AuthorizationExecutionRequest): Promise<void> {
    if (!request.runtime.sessionId) {
      return;
    }

    const records = await this.approvalStore.findActiveSessionApprovals({
      principalId: request.runtime.principal.principalId,
      sessionId: request.runtime.sessionId,
      activeAt: Date.now(),
    });

    for (const record of records) {
      if (!record.key) {
        continue;
      }
      request.sessionState.grantApproval(record.key, 'session');
    }
  }
}

function createRecordId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
