import type { AgentCallbacks, AgentInput, ErrorDecision, Message, StreamEvent } from '../types';
import type { Tool, ToolCall } from '../../providers';
import type { ToolConcurrencyPolicy } from '../tool/types';
import type { ToolSessionState } from '../tool-v2/context';

import { processToolCalls as processToolCallsRuntime, type ToolRuntime } from './tool-runtime';
import {
  callLLMAndProcessStream as callLLMStreamRuntime,
  type LLMStreamRuntimeDeps,
} from './llm-stream-runtime';
import type { CompactionExecutionResult, RunLoopRuntime } from './run-loop';
import type { AbortScope, TimeoutBudgetState, TimeoutStage } from './timeout-budget';
import type { ToolExecutionLedger } from './tool-execution-ledger';
import type { AgentError, TimeoutBudgetExceededError } from './error';
import type { AgentRuntimeLifecycleHooks } from './runtime-hooks';
import type { AgentToolExecutor } from './tool-executor';

type SafeCallback = <T>(
  callback: ((arg: T) => void | Promise<void>) | undefined,
  arg: T
) => Promise<void>;

type SafeErrorCallback = (
  callback: ((error: Error) => ErrorDecision | void | Promise<ErrorDecision | void>) | undefined,
  error: Error
) => Promise<ErrorDecision | void>;

export interface RunLoopRuntimeFactoryDeps {
  config: {
    maxRetryCount: number;
  };
  callbacks: {
    safe: SafeCallback;
    safeError: SafeErrorCallback;
  };
  messages: {
    prepareForLlmStep: (
      messages: Message[],
      tools?: Tool[],
      contextLimitTokens?: number
    ) => Promise<{
      messageCountBeforeCompaction: number;
      compaction: CompactionExecutionResult;
      contextUsage: {
        contextTokens: number;
        contextLimitTokens: number;
        contextUsagePercent: number;
      };
    }>;
    mergeLLMConfig: (
      config: AgentInput['config'],
      tools?: AgentInput['tools'],
      abortSignal?: AbortSignal,
      conversationId?: string
    ) => AgentInput['config'];
  };
  createLLMStreamRuntimeDeps: () => LLMStreamRuntimeDeps;
  createToolRuntime: (
    sessionState: ToolSessionState,
    hooks?: AgentRuntimeLifecycleHooks
  ) => ToolRuntime;
  toolSessionState: ToolSessionState;
  stream: {
    progress: (
      executionId: string | undefined,
      stepIndex: number,
      currentAction: 'llm' | 'tool',
      messageCount: number
    ) => Generator<StreamEvent>;
    checkpoint: (
      executionId: string | undefined,
      stepIndex: number,
      lastMessage: Message | undefined,
      callbacks?: AgentCallbacks
    ) => AsyncGenerator<StreamEvent, void, unknown>;
    done: (stepIndex: number, finishReason?: 'stop' | 'max_steps') => Generator<StreamEvent>;
    error: (error: AgentError) => Generator<StreamEvent>;
    maxRetries: () => Generator<StreamEvent>;
  };
  resilience: {
    createStageAbortScope: (
      baseSignal: AbortSignal | undefined,
      timeoutBudget: TimeoutBudgetState | undefined,
      stage: TimeoutStage
    ) => AbortScope;
    throwIfAborted: (signal?: AbortSignal) => void;
    normalizeTimeoutBudgetError: (
      error: unknown,
      signal: AbortSignal | undefined
    ) => TimeoutBudgetExceededError | undefined;
    timeoutBudgetErrorFromSignal: (
      signal: AbortSignal | undefined
    ) => TimeoutBudgetExceededError | undefined;
    isAbortError: (error: unknown) => boolean;
    normalizeError: (error: unknown) => AgentError;
    calculateRetryDelay: (retryCount: number, error: Error) => number;
    sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  };
  diagnostics: {
    extractErrorCode: (error: unknown) => string | undefined;
  };
  abortedMessage: string;
}

/**
 * Assemble the grouped runtime contract consumed by `run-loop.ts`.
 *
 * The goal here is not to hide dependencies behind a container, but to keep
 * the composition root out of `StatelessAgent` so the agent facade remains
 * readable and the loop contract stays explicit.
 */
export function createRunLoopRuntime(
  deps: RunLoopRuntimeFactoryDeps,
  hooks: AgentRuntimeLifecycleHooks
): RunLoopRuntime {
  return {
    limits: {
      maxRetryCount: deps.config.maxRetryCount,
      abortedMessage: deps.abortedMessage,
    },
    callbacks: deps.callbacks,
    messages: deps.messages,
    stages: {
      llm: (messages, config, abortSignal, executionId, stepIndex, writeBufferSessions) =>
        callLLMStreamRuntime(deps.createLLMStreamRuntimeDeps(), {
          messages,
          config,
          abortSignal,
          executionId,
          stepIndex,
          writeBufferSessions,
        }),
      tools: (
        toolCalls,
        messages,
        stepIndex,
        callbacks,
        abortSignal,
        executionId,
        traceId,
        parentSpanId,
        writeBufferSessions
      ) =>
        (async function* () {
          try {
            return yield* processToolCallsRuntime(
              deps.createToolRuntime(deps.toolSessionState, hooks),
              {
                toolCalls,
                messages,
                stepIndex,
                callbacks,
                abortSignal,
                executionId,
                traceId,
                parentSpanId,
                writeBufferSessions,
                emitProgress: deps.stream.progress,
              }
            );
          } finally {
            deps.toolSessionState.clearTurn();
          }
        })(),
    },
    stream: deps.stream,
    resilience: deps.resilience,
    diagnostics: deps.diagnostics,
    hooks,
  };
}

export interface ToolRuntimeFactoryDeps {
  agentRef: unknown;
  execution: {
    executor: AgentToolExecutor;
    sessionState: ToolSessionState;
    ledger: ToolExecutionLedger;
    maxConcurrentToolCalls: number;
    resolveConcurrencyPolicy?: (toolCall: ToolCall) => ToolConcurrencyPolicy;
  };
  callbacks: {
    safe: SafeCallback;
  };
  diagnostics: {
    extractErrorCode: (error: unknown) => string | undefined;
    logError: (message: string, error: unknown, context?: Record<string, unknown>) => void;
  };
  resilience: {
    throwIfAborted: (signal?: AbortSignal) => void;
  };
  createLifecycleHooks: () => AgentRuntimeLifecycleHooks;
  emitEvent: (
    eventName: 'tool_chunk' | 'tool_confirm' | 'tool_permission',
    payload: unknown
  ) => void;
}

/**
 * Tool execution needs a smaller, tool-centric runtime than the full agent
 * loop. Keeping this assembly separate makes the concurrency, ledger and
 * tool-observation policy easy to test without coupling those details back
 * into the facade class.
 */
export function createToolRuntime(
  deps: ToolRuntimeFactoryDeps,
  hooks?: AgentRuntimeLifecycleHooks
): ToolRuntime {
  return {
    agentRef: deps.agentRef,
    execution: deps.execution,
    callbacks: deps.callbacks,
    diagnostics: deps.diagnostics,
    resilience: deps.resilience,
    hooks: hooks ?? deps.createLifecycleHooks(),
    events: {
      emit: deps.emitEvent,
    },
  };
}

/**
 * The LLM streaming runtime is intentionally narrow. Retry, timeout budgeting
 * and higher-level orchestration stay in the run loop; the stream runtime only
 * gets what it needs to talk to the provider and report failures.
 */
export function createLLMStreamRuntimeDeps(
  deps: Pick<LLMStreamRuntimeDeps, 'llmProvider' | 'enableServerSideContinuation'> & {
    throwIfAborted: (signal?: AbortSignal) => void;
    logError: (message: string, error: unknown, context?: Record<string, unknown>) => void;
  }
): LLMStreamRuntimeDeps {
  return {
    llmProvider: deps.llmProvider,
    enableServerSideContinuation: deps.enableServerSideContinuation,
    throwIfAborted: deps.throwIfAborted,
    logError: deps.logError,
  };
}

/**
 * Normalize executor-owned tool schemas at one boundary so the run loop never
 * needs to know whether tool definitions came from input overrides or the
 * shared tool registry.
 */
export function resolveLLMToolsFromExecutor(
  toolExecutor: Pick<AgentToolExecutor, 'getToolSchemas'>,
  inputTools?: Tool[]
): Tool[] | undefined {
  if (typeof inputTools !== 'undefined') {
    return inputTools;
  }

  const schemas = toolExecutor.getToolSchemas().map((schema) => ({
    type: schema.type,
    function: {
      name: schema.function.name,
      description: schema.function.description,
      parameters: (schema.function.parameters || {}) as Record<string, unknown>,
    },
  }));

  return schemas.length > 0 ? schemas : undefined;
}
