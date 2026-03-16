import type { Tool, ToolCall } from '../../providers';
import type { ToolConcurrencyPolicy, ToolPolicyCheckInfo, ToolPolicyDecision } from '../tool/types';
import type {
  ToolApprovalDecision,
  ToolApprovalRequest,
  ToolCallResult,
  ToolExecutionEvent,
  ToolExecutionStreamEvent,
  ToolFileSystemPolicy,
  ToolNetworkPolicy,
  ToolPermissionGrant,
  ToolPermissionRequest,
  ToolTrustLevel,
} from '../tool-v2/contracts';
import type { ToolApprovalPolicy } from '../tool-v2/contracts';
import type { ToolSessionState } from '../tool-v2/context';

export interface AgentToolExecutionContext {
  readonly executionId?: string;
  readonly stepIndex: number;
  readonly agent: unknown;
  readonly sessionState: ToolSessionState;
  readonly abortSignal?: AbortSignal;
  readonly workingDirectory?: string;
  readonly fileSystemPolicy?: ToolFileSystemPolicy;
  readonly networkPolicy?: ToolNetworkPolicy;
  readonly approvalPolicy?: ToolApprovalPolicy;
  readonly trustLevel?: ToolTrustLevel;
  readonly onStreamEvent?: (event: ToolExecutionStreamEvent) => void | Promise<void>;
  readonly onExecutionEvent?: (event: ToolExecutionEvent) => void | Promise<void>;
  readonly onApproval?: (request: ToolApprovalRequest) => Promise<ToolApprovalDecision>;
  readonly onPermissionRequest?: (request: ToolPermissionRequest) => Promise<ToolPermissionGrant>;
  readonly onPolicyCheck?: (
    info: ToolPolicyCheckInfo
  ) => ToolPolicyDecision | Promise<ToolPolicyDecision>;
}

export interface AgentToolExecutor {
  execute(toolCall: ToolCall, context: AgentToolExecutionContext): Promise<ToolCallResult>;
  getToolSchemas(): Tool[];
  getConcurrencyPolicy?(toolCall: ToolCall): ToolConcurrencyPolicy;
}
