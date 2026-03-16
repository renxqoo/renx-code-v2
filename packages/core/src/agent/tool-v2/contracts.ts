export type ToolApprovalPolicy = 'never' | 'on-request' | 'on-failure' | 'unless-trusted';

export type ToolTrustLevel = 'trusted' | 'untrusted';

export type ToolApprovalScope = 'once' | 'turn' | 'session';

export type ToolPermissionScope = 'turn' | 'session';

export type ToolSandboxMode = 'restricted' | 'workspace-write' | 'full-access';

export type ToolConcurrencyMode = 'parallel-safe' | 'exclusive';

export interface ToolConcurrencyPolicy {
  readonly mode: ToolConcurrencyMode;
  readonly lockKey?: string;
}

export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
  readonly supportsParallel: boolean;
  readonly mutating: boolean;
  readonly tags?: string[];
}

export interface ToolCallRequest {
  readonly callId: string;
  readonly toolName: string;
  readonly arguments: string;
  readonly toolNamespace?: string;
}

export interface ToolApprovalRequest {
  readonly toolName: string;
  readonly callId: string;
  readonly reason: string;
  readonly key?: string;
  readonly commandPreview?: string;
  readonly writePaths?: string[];
  readonly readPaths?: string[];
}

export interface ToolApprovalDecision {
  readonly approved: boolean;
  readonly scope: ToolApprovalScope;
  readonly reason?: string;
}

export interface ToolPermissionRequest {
  readonly toolName: string;
  readonly callId: string;
  readonly reason?: string;
  readonly requestedScope?: ToolPermissionScope;
  readonly permissions: ToolPermissionProfile;
}

export interface ToolPermissionGrant {
  readonly granted: ToolPermissionProfile;
  readonly scope: ToolPermissionScope;
}

export interface ToolPolicyCheckInfo {
  readonly callId: string;
  readonly toolName: string;
  readonly arguments: string;
  readonly parsedArguments: Record<string, unknown>;
}

export interface ToolPolicyDecision {
  readonly allowed: boolean;
  readonly code?: string;
  readonly message?: string;
  readonly audit?: Record<string, unknown>;
}

export interface ToolExecutionPlan {
  readonly mutating: boolean;
  readonly readPaths?: string[];
  readonly writePaths?: string[];
  readonly networkTargets?: string[];
  readonly concurrency?: ToolConcurrencyPolicy;
  readonly preferredSandbox?: ToolSandboxMode;
  readonly approval?: {
    readonly required: boolean;
    readonly reason: string;
    readonly key?: string;
    readonly commandPreview?: string;
  };
}

export interface ToolHandlerResult {
  readonly output: string;
  readonly structured?: unknown;
  readonly metadata?: Record<string, unknown>;
}

export interface ToolCallSuccess {
  readonly callId: string;
  readonly toolName: string;
  readonly success: true;
  readonly output: string;
  readonly structured?: unknown;
  readonly metadata?: Record<string, unknown>;
}

export interface ToolCallFailure {
  readonly callId: string;
  readonly toolName: string;
  readonly success: false;
  readonly output: string;
  readonly error: import('../error-contract').ErrorContract;
  readonly metadata?: Record<string, unknown>;
}

export type ToolCallResult = ToolCallSuccess | ToolCallFailure;

export type ToolExecutionEventStage =
  | 'received'
  | 'parsed'
  | 'planned'
  | 'permission_requested'
  | 'permission_resolved'
  | 'approval_requested'
  | 'approval_resolved'
  | 'executing'
  | 'succeeded'
  | 'failed';

export interface ToolExecutionEvent {
  readonly stage: ToolExecutionEventStage;
  readonly toolName: string;
  readonly callId: string;
  readonly toolNamespace?: string;
  readonly timestamp: number;
  readonly metadata?: Record<string, unknown>;
}

export interface ToolExecutionStreamEvent {
  readonly type: 'stdout' | 'stderr' | 'info' | 'progress';
  readonly message: string;
}

export interface ToolFileSystemPolicy {
  readonly mode: 'restricted' | 'unrestricted';
  readonly readRoots: string[];
  readonly writeRoots: string[];
}

export interface ToolNetworkPolicy {
  readonly mode: 'restricted' | 'enabled';
  readonly allowedHosts?: string[];
  readonly deniedHosts?: string[];
}

export interface ToolPermissionProfile {
  readonly fileSystem?: {
    readonly read?: string[];
    readonly write?: string[];
  };
  readonly network?: {
    readonly enabled?: boolean;
    readonly allowedHosts?: string[];
    readonly deniedHosts?: string[];
  };
}
