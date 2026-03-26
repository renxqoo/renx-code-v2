import type { AgentCallbacks, AgentInput, ErrorDecision, Message, StreamEvent } from '../types';
import type { Tool, ToolCall } from '../../providers';

import type { AgentError, TimeoutBudgetExceededError } from './error';
import type { LLMStreamResult } from './llm-stream-runtime';
import type { AbortScope, TimeoutBudgetState } from './timeout-budget';
import type { WriteBufferRuntime } from './write-file-session';
import {
  type AgentRunOutcome,
  type AgentRuntimeLifecycleHooks,
  type AgentRuntimeObservation,
  type RunLifecycleFinishContext,
} from './runtime-hooks';
import {
  handleStepFailure,
  hasPendingUserMessages,
  prepareMessagesForStep,
  resolvePreStepTerminalState,
  type RunLoopProgressState,
} from './run-loop-control';
import { runLLMStage, runToolStage } from './run-loop-stages';

export type CompactionExecutionResult = {
  status: 'skipped' | 'applied' | 'failed';
  removedMessageIds: string[];
  reason?: string;
  diagnostics?: unknown;
};

export type RunLoopState = {
  input: AgentInput;
  callbacks?: AgentCallbacks;
  maxSteps: number;
  messages: Message[];
  effectiveTools?: Tool[];
  writeBufferSessions: Map<string, WriteBufferRuntime>;
  timeoutBudget: TimeoutBudgetState | undefined;
  executionScope: AbortScope;
  abortSignal: AbortSignal | undefined;
  traceId: string;
  runObservation: AgentRuntimeObservation<RunLifecycleFinishContext>;
};

export type RunLoopRuntime = {
  limits: {
    maxRetryCount: number;
    abortedMessage: string;
  };
  callbacks: {
    safe: <T>(callback: ((arg: T) => void | Promise<void>) | undefined, arg: T) => Promise<void>;
    safeError: (
      callback:
        | ((error: Error) => ErrorDecision | void | Promise<ErrorDecision | void>)
        | undefined,
      error: Error
    ) => Promise<ErrorDecision | void>;
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
  stages: {
    llm: (
      messages: Message[],
      config: AgentInput['config'],
      abortSignal?: AbortSignal,
      executionId?: string,
      stepIndex?: number,
      writeBufferSessions?: Map<string, WriteBufferRuntime>
    ) => AsyncGenerator<StreamEvent, LLMStreamResult, unknown>;
    tools: (
      toolCalls: ToolCall[],
      messages: Message[],
      stepIndex: number,
      callbacks?: AgentCallbacks,
      abortSignal?: AbortSignal,
      executionId?: string,
      traceId?: string,
      parentSpanId?: string,
      writeBufferSessions?: Map<string, WriteBufferRuntime>
    ) => AsyncGenerator<StreamEvent, Message, unknown>;
  };
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
      stage: 'llm' | 'tool'
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
  hooks: AgentRuntimeLifecycleHooks;
};

export async function* runAgentLoop(
  runtime: RunLoopRuntime,
  state: RunLoopState
): AsyncGenerator<StreamEvent, { outcome: AgentRunOutcome; errorCode?: string }, unknown> {
  // The run loop is the only place that decides whether an error is terminal,
  // retryable, timeout-related or user-aborted. Lower layers report precise
  // failures; they do not choose control-flow policy.
  let stepIndex = 0;
  let retryCount = 0;
  let runOutcome: AgentRunOutcome = 'done';
  let runErrorCode: string | undefined;
  let terminalDoneEmitted = false;

  try {
    while (stepIndex < state.maxSteps) {
      const preStepTerminalState = yield* resolvePreStepTerminalState(runtime, state, {
        stepIndex,
        retryCount,
        runOutcome,
        runErrorCode,
        terminalDoneEmitted,
        retryScheduled: false,
      });
      if (preStepTerminalState) {
        runOutcome = preStepTerminalState.runOutcome;
        runErrorCode = preStepTerminalState.runErrorCode;
        retryCount = preStepTerminalState.retryCount;
        terminalDoneEmitted = preStepTerminalState.terminalDoneEmitted;
        break;
      }

      stepIndex += 1;

      try {
        yield* prepareMessagesForStep(runtime, state, stepIndex);

        yield* runtime.stream.progress(
          state.input.executionId,
          stepIndex,
          'llm',
          state.messages.length
        );
        const llmResult = yield* runLLMStage(runtime, state, stepIndex);
        state.messages.push(llmResult.assistantMessage);
        await runtime.callbacks.safe(state.callbacks?.onMessage, llmResult.assistantMessage);

        if (llmResult.toolCalls.length > 0) {
          // Tool results are appended to shared history so the next LLM turn
          // can deterministically reconstruct the full conversation.
          yield* runtime.stream.progress(
            state.input.executionId,
            stepIndex,
            'tool',
            state.messages.length
          );
          const toolResultMessage = yield* runToolStage(
            runtime,
            state,
            stepIndex,
            llmResult.toolCalls
          );
          yield* runtime.stream.checkpoint(
            state.input.executionId,
            stepIndex,
            toolResultMessage,
            state.callbacks
          );
          continue;
        }

        retryCount = 0;
        runOutcome = 'done';
        if (await hasPendingUserMessages(state)) {
          continue;
        }
        terminalDoneEmitted = true;
        yield* runtime.stream.done(stepIndex, 'stop');
        break;
      } catch (error) {
        const nextProgress: RunLoopProgressState = yield* handleStepFailure(
          runtime,
          state,
          {
            stepIndex,
            retryCount,
            runOutcome,
            runErrorCode,
            terminalDoneEmitted,
            retryScheduled: false,
          },
          error
        );
        runOutcome = nextProgress.runOutcome;
        runErrorCode = nextProgress.runErrorCode;
        retryCount = nextProgress.retryCount;
        terminalDoneEmitted = nextProgress.terminalDoneEmitted;
        if (!nextProgress.retryScheduled) {
          break;
        }
      }
    }

    if (!terminalDoneEmitted && runOutcome === 'done' && stepIndex >= state.maxSteps) {
      // Hitting max steps is a controlled stop condition rather than a thrown
      // error, so it emits a terminal done event with a distinct reason.
      runOutcome = 'max_steps';
      terminalDoneEmitted = true;
      yield* runtime.stream.done(stepIndex, 'max_steps');
    }
  } finally {
    const runLatencyMs = Date.now() - state.runObservation.startedAt;
    await state.runObservation.finish({
      callbacks: state.callbacks,
      traceId: state.traceId,
      executionId: state.input.executionId,
      stepIndex,
      latencyMs: runLatencyMs,
      outcome: runOutcome,
      errorCode: runErrorCode,
      retryCount,
    });
    state.executionScope.release();
  }
  return {
    outcome: runOutcome,
    errorCode: runErrorCode,
  };
}
