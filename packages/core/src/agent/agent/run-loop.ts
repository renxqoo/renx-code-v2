import type {
  AgentCallbacks,
  AgentInput,
  CompactionInfo,
  ErrorDecision,
  Message,
  StreamEvent,
} from '../types';
import type { Tool, ToolCall } from '../../providers';

import { AgentAbortedError, type AgentError, type TimeoutBudgetExceededError } from './error';
import type { LLMStreamResult } from './llm-stream-runtime';
import type { AbortScope, TimeoutBudgetState } from './timeout-budget';
import type { WriteBufferRuntime } from './write-file-session';
import {
  createNoopObservation,
  type AgentRunOutcome,
  type AgentRuntimeLifecycleHooks,
  type AgentRuntimeObservation,
  type RunLifecycleFinishContext,
} from './runtime-hooks';

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
    safe: <T>(
      callback: ((arg: T) => void | Promise<void>) | undefined,
      arg: T
    ) => Promise<void>;
    safeError: (
      callback:
        | ((error: Error) => ErrorDecision | void | Promise<ErrorDecision | void>)
        | undefined,
      error: Error
    ) => Promise<ErrorDecision | void>;
  };
  messages: {
    compactIfNeeded: (
      messages: Message[],
      tools?: Tool[],
      contextLimitTokens?: number
    ) => Promise<string[]>;
    estimateContextUsage: (
      messages: Message[],
      tools?: Tool[],
      contextLimitTokens?: number
    ) => {
      contextTokens: number;
      contextLimitTokens: number;
      contextUsagePercent: number;
    };
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
    done: (
      stepIndex: number,
      finishReason?: 'stop' | 'max_steps'
    ) => Generator<StreamEvent>;
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

async function* forwardEvents<T>(
  generator: AsyncGenerator<StreamEvent, T, unknown>
): AsyncGenerator<StreamEvent, T, unknown> {
  // Helper for stage generators that emit stream events before returning a
  // structured result. This lets the outer loop treat "streaming side effects"
  // and "final stage result" as one logical operation.
  for (;;) {
    const next = await generator.next();
    if (next.done) {
      return next.value;
    }
    yield next.value as StreamEvent;
  }
}

async function* runLLMStage(
  runtime: RunLoopRuntime,
  state: RunLoopState,
  stepIndex: number
): AsyncGenerator<StreamEvent, LLMStreamResult, unknown> {
  // Stage-level observations wrap the entire LLM interaction, including stream
  // consumption and post-stream validation, so latency/error metrics match the
  // business step the agent actually reasons about.
  const llmObservation =
    (await runtime.hooks.onLLMStageStart?.({
      callbacks: state.callbacks,
      traceId: state.traceId,
      parentSpanId: state.runObservation.spanId,
      executionId: state.input.executionId,
      stepIndex,
      messageCount: state.messages.length,
    })) ?? createNoopObservation();
  const llmScope = runtime.resilience.createStageAbortScope(
    state.abortSignal,
    state.timeoutBudget,
    'llm'
  );
  let llmErrorCode: string | undefined;
  let llmSucceeded = false;

  try {
    const result = yield* forwardEvents(
      runtime.stages.llm(
        state.messages,
        runtime.messages.mergeLLMConfig(
          state.input.config,
          state.effectiveTools,
          llmScope.signal,
          state.input.conversationId
        ),
        llmScope.signal,
        state.input.executionId,
        stepIndex,
        state.writeBufferSessions
      )
    );
    runtime.resilience.throwIfAborted(llmScope.signal);
    llmSucceeded = true;
    return result;
  } catch (error) {
    llmErrorCode = runtime.diagnostics.extractErrorCode(error) || 'AGENT_LLM_STAGE_FAILED';
    throw error;
  } finally {
    llmScope.release();
    const llmLatencyMs = Date.now() - llmObservation.startedAt;
    await llmObservation.finish({
      callbacks: state.callbacks,
      traceId: state.traceId,
      executionId: state.input.executionId,
      stepIndex,
      latencyMs: llmLatencyMs,
      success: llmSucceeded,
      errorCode: llmErrorCode,
      messageCount: state.messages.length,
    });
  }
}

async function* runToolStage(
  runtime: RunLoopRuntime,
  state: RunLoopState,
  stepIndex: number,
  toolCalls: ToolCall[]
): AsyncGenerator<StreamEvent, Message, unknown> {
  // This stage measures the orchestration cost of the full tool batch produced
  // by one assistant turn. Individual tool timings are recorded deeper in the
  // tool runtime.
  const toolStageObservation =
    (await runtime.hooks.onToolStageStart?.({
      callbacks: state.callbacks,
      traceId: state.traceId,
      parentSpanId: state.runObservation.spanId,
      executionId: state.input.executionId,
      stepIndex,
      toolCalls: toolCalls.length,
    })) ?? createNoopObservation();
  const toolScope = runtime.resilience.createStageAbortScope(
    state.abortSignal,
    state.timeoutBudget,
    'tool'
  );
  let toolStageErrorCode: string | undefined;
  let toolStageSucceeded = false;

  try {
    const result = yield* forwardEvents(
      runtime.stages.tools(
        toolCalls,
        state.messages,
        stepIndex,
        state.callbacks,
        toolScope.signal,
        state.input.executionId,
        state.traceId,
        toolStageObservation.spanId,
        state.writeBufferSessions
      )
    );
    toolStageSucceeded = true;
    return result;
  } catch (error) {
    toolStageErrorCode = runtime.diagnostics.extractErrorCode(error) || 'AGENT_TOOL_STAGE_FAILED';
    throw error;
  } finally {
    toolScope.release();
    const toolStageLatencyMs = Date.now() - toolStageObservation.startedAt;
    await toolStageObservation.finish({
      callbacks: state.callbacks,
      traceId: state.traceId,
      executionId: state.input.executionId,
      stepIndex,
      latencyMs: toolStageLatencyMs,
      success: toolStageSucceeded,
      errorCode: toolStageErrorCode,
      toolCalls: toolCalls.length,
    });
  }
}

export async function* runAgentLoop(
  runtime: RunLoopRuntime,
  state: RunLoopState
): AsyncGenerator<StreamEvent, void, unknown> {
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
      if (state.abortSignal?.aborted) {
        const timeoutError = runtime.resilience.timeoutBudgetErrorFromSignal(state.abortSignal);
        if (timeoutError) {
          runOutcome = 'timeout';
          runErrorCode = timeoutError.errorCode;
          yield* runtime.stream.error(timeoutError);
        } else {
          runOutcome = 'aborted';
          runErrorCode = 'AGENT_ABORTED';
          yield* runtime.stream.error(
            new AgentAbortedError(runtime.limits.abortedMessage)
          );
        }
        break;
      }

      if (retryCount >= runtime.limits.maxRetryCount) {
        runOutcome = 'max_retries';
        runErrorCode = 'AGENT_MAX_RETRIES_REACHED';
        yield* runtime.stream.maxRetries();
        break;
      }

      stepIndex += 1;

      try {
        runtime.resilience.throwIfAborted(state.abortSignal);
        // Compaction happens before context-usage reporting so callbacks see
        // the message set that will actually be sent to the provider.
        const messageCountBeforeCompaction = state.messages.length;
        const removedMessageIds = await runtime.messages.compactIfNeeded(
          state.messages,
          state.effectiveTools,
          state.input.contextLimitTokens
        );
        if (removedMessageIds.length > 0) {
          const compactionInfo: CompactionInfo = {
            executionId: state.input.executionId,
            stepIndex,
            removedMessageIds,
            messageCountBefore: messageCountBeforeCompaction,
            messageCountAfter: state.messages.length,
          };
          await runtime.callbacks.safe(state.callbacks?.onCompaction, compactionInfo);
          yield {
            type: 'compaction',
            data: compactionInfo,
          };
        }

        runtime.resilience.throwIfAborted(state.abortSignal);

        const contextUsage = runtime.messages.estimateContextUsage(
          state.messages,
          state.effectiveTools,
          state.input.contextLimitTokens
        );
        await runtime.callbacks.safe(state.callbacks?.onContextUsage, {
          stepIndex,
          messageCount: state.messages.length,
          ...contextUsage,
        });

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
        terminalDoneEmitted = true;
        yield* runtime.stream.done(stepIndex, 'stop');
        break;
      } catch (error) {
        // Timeout and abort are handled before generic normalization because
        // they are control-flow outcomes, not business failures. This avoids
        // misclassifying a cancelled run as a retryable agent error.
        const timeoutError = runtime.resilience.normalizeTimeoutBudgetError(
          error,
          state.abortSignal
        );
        if (timeoutError) {
          runOutcome = 'timeout';
          runErrorCode = timeoutError.errorCode;
          yield* runtime.stream.error(timeoutError);
          break;
        }

        if (runtime.resilience.isAbortError(error) || state.input.abortSignal?.aborted) {
          runOutcome = 'aborted';
          runErrorCode = 'AGENT_ABORTED';
          yield* runtime.stream.error(
            new AgentAbortedError(runtime.limits.abortedMessage)
          );
          break;
        }

        const normalizedError = runtime.resilience.normalizeError(error);
        await runtime.hooks.onRunError?.({
          executionId: state.input.executionId,
          traceId: state.traceId,
          stepIndex,
          retryCount,
          errorCode: normalizedError.errorCode,
          category: normalizedError.category,
          error: normalizedError,
        });
        runOutcome = 'error';
        runErrorCode = normalizedError.errorCode;
        const decision = await runtime.callbacks.safeError(
          state.callbacks?.onError,
          normalizedError
        );
        yield* runtime.stream.error(normalizedError);

        // An emitted error event only describes the current attempt. The run
        // may still continue if policy marks the failure as retryable.
        const shouldRetry = decision?.retry ?? normalizedError.retryable;
        if (!shouldRetry) {
          break;
        }

        retryCount += 1;
        await runtime.hooks.onRetryScheduled?.({
          executionId: state.input.executionId,
          traceId: state.traceId,
          stepIndex,
          retryCount,
          errorCode: normalizedError.errorCode,
        });
        if (retryCount < runtime.limits.maxRetryCount) {
          const retryDelay = runtime.resilience.calculateRetryDelay(
            retryCount,
            error as Error
          );
          try {
            await runtime.resilience.sleep(retryDelay, state.abortSignal);
          } catch (sleepError) {
            const sleepTimeoutError = runtime.resilience.normalizeTimeoutBudgetError(
              sleepError,
              state.abortSignal
            );
            if (sleepTimeoutError) {
              runOutcome = 'timeout';
              runErrorCode = sleepTimeoutError.errorCode;
              yield* runtime.stream.error(sleepTimeoutError);
              break;
            }
            if (
              runtime.resilience.isAbortError(sleepError) ||
              state.input.abortSignal?.aborted
            ) {
              runOutcome = 'aborted';
              runErrorCode = 'AGENT_ABORTED';
              yield* runtime.stream.error(
                new AgentAbortedError(runtime.limits.abortedMessage)
              );
              break;
            }
            throw sleepError;
          }
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
}
