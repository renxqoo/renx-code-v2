import type {
  ToolApprovalDecision,
  ToolApprovalPolicy,
  ToolApprovalRequest,
  ToolExecutionPlan,
  ToolFileSystemPolicy,
  ToolNetworkPolicy,
  ToolPermissionGrant,
  ToolPermissionProfile,
  ToolPermissionRequest,
  ToolPolicyCheckInfo,
  ToolPolicyDecision,
  ToolTrustLevel,
} from '../tool-v2/contracts';

export type PrincipalType = 'user' | 'service' | 'automation' | 'system';

export type PrincipalSource = 'cli' | 'desktop' | 'api' | 'automation' | 'internal';

export interface PrincipalContext {
  readonly principalId: string;
  readonly principalType: PrincipalType;
  readonly tenantId?: string;
  readonly workspaceId?: string;
  readonly source: PrincipalSource;
  readonly roles: string[];
  readonly attributes?: Record<string, unknown>;
}

export interface AuthorizationSessionState {
  hasApproval(key: string): boolean;
  grantApproval(key: string, scope: 'turn' | 'session'): void;
  grantPermissions(grant: ToolPermissionGrant): void;
  effectivePermissions(): ToolPermissionProfile | undefined;
}

export interface ResourceDescriptor {
  readonly resourceType: 'filesystem' | 'network' | 'tool';
  readonly action: 'read' | 'write' | 'connect' | 'execute';
  readonly value: string;
  readonly attributes?: Record<string, unknown>;
}

export interface AuthorizationRuntimeContext {
  readonly principal: PrincipalContext;
  readonly sessionId?: string;
  readonly evaluatePolicy?: (
    info: ToolPolicyCheckInfo
  ) => ToolPolicyDecision | Promise<ToolPolicyDecision>;
  readonly requestPermissions?: (request: ToolPermissionRequest) => Promise<ToolPermissionGrant>;
  readonly requestApproval?: (request: ToolApprovalRequest) => Promise<ToolApprovalDecision>;
}

export interface AuthorizationDecision {
  readonly outcome: 'allow' | 'deny';
  readonly reason: string;
  readonly policyVersion: string;
  readonly rulesMatched: string[];
  readonly tags: string[];
  readonly riskLevel?: ToolExecutionPlan['riskLevel'];
  readonly sensitivity?: ToolExecutionPlan['sensitivity'];
  readonly grantedPermissions?: ToolPermissionProfile;
  readonly approval?: {
    readonly required: boolean;
    readonly resolved: boolean;
    readonly cached?: boolean;
    readonly scope?: 'once' | 'turn' | 'session';
    readonly key?: string;
  };
}

export interface AuthorizationAuditRecord {
  readonly auditId: string;
  readonly toolCallId: string;
  readonly principalId: string;
  readonly sessionId?: string;
  readonly tenantId?: string;
  readonly workspaceId?: string;
  readonly toolName: string;
  readonly decision: AuthorizationDecision['outcome'];
  readonly reason: string;
  readonly policyVersion: string;
  readonly resources: ResourceDescriptor[];
  readonly rulesMatched: string[];
  readonly tags: string[];
  readonly createdAt: number;
  readonly metadata?: Record<string, unknown>;
}

export interface PermissionGrantRecord {
  readonly grantId: string;
  readonly principalId: string;
  readonly sessionId?: string;
  readonly tenantId?: string;
  readonly workspaceId?: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly scope: 'turn' | 'session';
  readonly granted: ToolPermissionProfile;
  readonly grantedBy: string;
  readonly createdAt: number;
  readonly reason?: string;
  readonly expiresAt?: number;
  readonly revokedAt?: number;
  readonly revokedBy?: string;
}

export interface ApprovalDecisionRecord {
  readonly approvalId: string;
  readonly toolCallId: string;
  readonly principalId: string;
  readonly sessionId?: string;
  readonly tenantId?: string;
  readonly workspaceId?: string;
  readonly toolName: string;
  readonly approverId: string;
  readonly decision: 'approved' | 'denied';
  readonly scope: 'once' | 'turn' | 'session';
  readonly createdAt: number;
  readonly reason?: string;
  readonly key?: string;
  readonly expiresAt?: number;
}

export interface AuthorizationExecutionRequest {
  readonly runtime: AuthorizationRuntimeContext;
  readonly sessionState: AuthorizationSessionState;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly rawArguments: string;
  readonly parsedArguments: Record<string, unknown>;
  readonly plan: ToolExecutionPlan;
  readonly workingDirectory: string;
  readonly fileSystemPolicy: ToolFileSystemPolicy;
  readonly networkPolicy: ToolNetworkPolicy;
  readonly approvalPolicy: ToolApprovalPolicy;
  readonly trustLevel?: ToolTrustLevel;
  readonly onStage?: (
    stage:
      | 'permission_requested'
      | 'permission_resolved'
      | 'approval_requested'
      | 'approval_resolved',
    metadata?: Record<string, unknown>
  ) => Promise<void>;
}

export interface AuthorizationExecutionResult {
  readonly decision: AuthorizationDecision;
  readonly fileSystemPolicy: ToolFileSystemPolicy;
  readonly networkPolicy: ToolNetworkPolicy;
}

export interface ExplicitPermissionGrantRequest {
  readonly runtime: AuthorizationRuntimeContext;
  readonly sessionState: AuthorizationSessionState;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly workingDirectory: string;
  readonly requestedScope: 'turn' | 'session';
  readonly permissions: ToolPermissionProfile;
  readonly reason?: string;
}

export interface ToolAuthorizationService {
  authorizeExecution(request: AuthorizationExecutionRequest): Promise<AuthorizationExecutionResult>;
  requestPermissions(request: ExplicitPermissionGrantRequest): Promise<ToolPermissionGrant>;
}

export interface ToolAuthorizationContext extends AuthorizationRuntimeContext {
  readonly service: ToolAuthorizationService;
}
