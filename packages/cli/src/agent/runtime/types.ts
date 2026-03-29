import type { MessageContent } from '../../types/message-content';

export type AgentTextDeltaEvent = {
  text: string;
  isReasoning?: boolean;
  executionId?: string;
  conversationId?: string;
};

export type AgentToolStreamEvent = {
  toolCallId: string;
  toolName: string;
  type: string;
  sequence: number;
  timestamp: number;
  content?: string;
  data?: unknown;
  executionId?: string;
  conversationId?: string;
};

export type AgentToolConfirmEvent = {
  kind: 'approval';
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  rawArgs: Record<string, unknown>;
  reason?: string;
  metadata?: Record<string, unknown>;
};

export type AgentToolConfirmDecision = {
  approved: boolean;
  message?: string;
};

export type AgentToolPermissionProfile = {
  fileSystem?: {
    read?: string[];
    write?: string[];
  };
  network?: {
    enabled?: boolean;
    allowedHosts?: string[];
    deniedHosts?: string[];
  };
};

export type AgentToolPermissionEvent = {
  kind: 'permission';
  toolCallId: string;
  toolName: string;
  reason?: string;
  requestedScope: 'turn' | 'session';
  permissions: AgentToolPermissionProfile;
};

export type AgentToolPermissionGrant = {
  granted: AgentToolPermissionProfile;
  scope: 'turn' | 'session';
};

export type AgentToolPromptEvent = AgentToolConfirmEvent | AgentToolPermissionEvent;

export type AgentStepEvent = {
  stepIndex: number;
  finishReason?: string;
  toolCallsCount: number;
};

export type AgentToolUseEvent = {
  [key: string]: unknown;
};

export type AgentToolResultEvent = {
  toolCall: unknown;
  result: unknown;
  content?: MessageContent;
  executionId?: string;
  conversationId?: string;
};

export type AgentLoopEvent = {
  loopIndex: number;
  steps: number;
};

export type AgentUserMessageEvent = {
  text: string;
  stepIndex: number;
};

export type AgentStopEvent = {
  reason: string;
  message?: string;
};

export type AgentUsageEvent = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cumulativePromptTokens?: number;
  cumulativeCompletionTokens?: number;
  cumulativeTotalTokens?: number;
  contextTokens?: number;
  contextLimit?: number;
  contextUsagePercent?: number;
};

export type AgentContextUsageEvent = {
  stepIndex: number;
  messageCount: number;
  contextTokens: number;
  contextLimit: number;
  contextUsagePercent: number;
};

export type AgentEventHandlers = {
  onTextDelta?: (event: AgentTextDeltaEvent) => void;
  onTextComplete?: (text: string) => void;
  onToolStream?: (event: AgentToolStreamEvent) => void;
  onToolConfirm?: (event: AgentToolConfirmEvent) => void;
  onToolPermission?: (event: AgentToolPermissionEvent) => void;
  onToolConfirmRequest?: (
    event: AgentToolConfirmEvent
  ) => AgentToolConfirmDecision | Promise<AgentToolConfirmDecision>;
  onToolPermissionRequest?: (
    event: AgentToolPermissionEvent
  ) => AgentToolPermissionGrant | Promise<AgentToolPermissionGrant>;
  onToolUse?: (event: AgentToolUseEvent) => void;
  onToolResult?: (event: AgentToolResultEvent) => void;
  onStep?: (event: AgentStepEvent) => void;
  onLoop?: (event: AgentLoopEvent) => void;
  onUserMessage?: (event: AgentUserMessageEvent) => void;
  onStop?: (event: AgentStopEvent) => void;
  onContextUsage?: (event: AgentContextUsageEvent) => void;
  onUsage?: (event: AgentUsageEvent) => void;
};

export type AgentRunResult = {
  executionId: string;
  conversationId: string;
  text: string;
  completionReason: string;
  completionMessage?: string;
  durationSeconds: number;
  modelLabel: string;
  usage?: AgentUsageEvent;
};
