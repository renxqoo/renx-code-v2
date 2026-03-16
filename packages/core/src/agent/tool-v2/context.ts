import { ToolApprovalStore } from './approval-store';
import type {
  ToolApprovalDecision,
  ToolApprovalPolicy,
  ToolApprovalRequest,
  ToolCallRequest,
  ToolExecutionEvent,
  ToolExecutionStreamEvent,
  ToolFileSystemPolicy,
  ToolNetworkPolicy,
  ToolPermissionGrant,
  ToolPermissionProfile,
  ToolPermissionRequest,
  ToolPolicyCheckInfo,
  ToolPolicyDecision,
  ToolTrustLevel,
} from './contracts';
import { mergePermissionProfiles } from './permissions';

export class ToolSessionState {
  private readonly approvals = new ToolApprovalStore();
  private turnPermissions?: ToolPermissionProfile;
  private sessionPermissions?: ToolPermissionProfile;

  hasApproval(key: string): boolean {
    return this.approvals.has(key);
  }

  grantApproval(key: string, scope: 'turn' | 'session'): void {
    this.approvals.grant(key, scope);
  }

  grantPermissions(grant: ToolPermissionGrant): void {
    if (grant.scope === 'session') {
      this.sessionPermissions = mergePermissionProfiles(this.sessionPermissions, grant.granted);
      return;
    }
    this.turnPermissions = mergePermissionProfiles(this.turnPermissions, grant.granted);
  }

  effectivePermissions(): ToolPermissionProfile | undefined {
    return mergePermissionProfiles(this.sessionPermissions, this.turnPermissions);
  }

  clearTurn(): void {
    this.approvals.clearTurn();
    this.turnPermissions = undefined;
  }
}

export interface ToolExecutionContext {
  readonly activeCall?: ToolCallRequest;
  readonly workingDirectory: string;
  readonly sessionState: ToolSessionState;
  readonly fileSystemPolicy: ToolFileSystemPolicy;
  readonly networkPolicy: ToolNetworkPolicy;
  readonly approvalPolicy: ToolApprovalPolicy;
  readonly trustLevel?: ToolTrustLevel;
  readonly signal?: AbortSignal;
  readonly emit?: (event: ToolExecutionStreamEvent) => void | Promise<void>;
  readonly onEvent?: (event: ToolExecutionEvent) => void | Promise<void>;
  readonly approve?: (request: ToolApprovalRequest) => Promise<ToolApprovalDecision>;
  readonly requestPermissions?: (request: ToolPermissionRequest) => Promise<ToolPermissionGrant>;
  readonly onPolicyCheck?: (
    info: ToolPolicyCheckInfo
  ) => ToolPolicyDecision | Promise<ToolPolicyDecision>;
  readonly now?: () => number;
}
