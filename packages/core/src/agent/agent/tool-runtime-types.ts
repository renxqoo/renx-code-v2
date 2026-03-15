import type { ToolCall } from '../../providers';
import type { ToolManager } from '../tool/tool-manager';
import type { ToolConcurrencyPolicy } from '../tool/types';
import type { AgentCallbacks, Message, StreamEvent } from '../types';

import type { AgentRuntimeLifecycleHooks } from './runtime-hooks';
import type { ToolExecutionLedger } from './tool-execution-ledger';
import type { WriteBufferRuntime } from './write-file-session';

export type ToolRuntime = {
  agentRef: unknown;
  execution: {
    manager: ToolManager;
    ledger: ToolExecutionLedger;
    maxConcurrentToolCalls: number;
    resolveConcurrencyPolicy?: (toolCall: ToolCall) => ToolConcurrencyPolicy;
  };
  callbacks: {
    safe: <T>(callback: ((arg: T) => void | Promise<void>) | undefined, arg: T) => Promise<void>;
  };
  diagnostics: {
    extractErrorCode: (error: unknown) => string | undefined;
    logError: (message: string, error: unknown, context?: Record<string, unknown>) => void;
  };
  resilience: {
    throwIfAborted: (signal?: AbortSignal) => void;
  };
  hooks: AgentRuntimeLifecycleHooks;
  events: {
    emit: (eventName: 'tool_chunk' | 'tool_confirm', payload: unknown) => void;
  };
};

export type ExecuteToolArgs = {
  toolCall: ToolCall;
  stepIndex: number;
  callbacks?: AgentCallbacks;
  abortSignal?: AbortSignal;
  executionId?: string;
  traceId?: string;
  parentSpanId?: string;
  writeBufferSessions?: Map<string, WriteBufferRuntime>;
};

export type ProcessToolCallsArgs = {
  toolCalls: ToolCall[];
  messages: Message[];
  stepIndex: number;
  callbacks?: AgentCallbacks;
  abortSignal?: AbortSignal;
  executionId?: string;
  traceId?: string;
  parentSpanId?: string;
  writeBufferSessions?: Map<string, WriteBufferRuntime>;
  emitProgress: (
    executionId: string | undefined,
    stepIndex: number,
    currentAction: 'llm' | 'tool',
    messageCount: number
  ) => Generator<StreamEvent>;
};

export type ToolTaskResult = { events: StreamEvent[]; message?: Message };
export type ToolExecutionPlan = { toolCall: ToolCall; policy: ToolConcurrencyPolicy };
