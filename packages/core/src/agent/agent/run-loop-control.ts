import type { CompactionInfo, StreamEvent } from '../types';

import { AgentAbortedError } from './error';
import type { AgentRunOutcome } from './runtime-hooks';
import type { RunLoopRuntime, RunLoopState } from './run-loop';

export interface RunLoopProgressState {
  stepIndex: number;
  retryCount: number;
  runOutcome: AgentRunOutcome;
  runErrorCode?: string;
  terminalDoneEmitted: boolean;
  retryScheduled?: boolean;
}

/**
 * Handle terminal conditions that can be decided before starting the next step.
 * This keeps the main loop focused on orchestration while centralizing abort,
 * timeout, and retry-limit semantics in one place.
 */
export async function* resolvePreStepTerminalState(
  runtime: RunLoopRuntime,
  state: RunLoopState,
  progress: RunLoopProgressState
): AsyncGenerator<StreamEvent, RunLoopProgressState | undefined, unknown> {
  if (state.abortSignal?.aborted) {
    const timeoutError = runtime.resilience.timeoutBudgetErrorFromSignal(state.abortSignal);
    if (timeoutError) {
      yield* runtime.stream.error(timeoutError);
      return {
        ...progress,
        runOutcome: 'timeout',
        runErrorCode: timeoutError.errorCode,
        retryScheduled: false,
      };
    }

    yield* runtime.stream.error(new AgentAbortedError(runtime.limits.abortedMessage));
    return {
      ...progress,
      runOutcome: 'aborted',
      runErrorCode: 'AGENT_ABORTED',
      retryScheduled: false,
    };
  }

  if (progress.retryCount >= runtime.limits.maxRetryCount) {
    yield* runtime.stream.maxRetries();
    return {
      ...progress,
      runOutcome: 'max_retries',
      runErrorCode: 'AGENT_MAX_RETRIES_REACHED',
      retryScheduled: false,
    };
  }

  return undefined;
}

/**
 * Prepare the message set that will be sent to the provider on this step.
 * Compaction and context-usage callbacks live together so consumers always see
 * the actual post-compaction history.
 */
export async function* prepareMessagesForStep(
  runtime: RunLoopRuntime,
  state: RunLoopState,
  stepIndex: number
): AsyncGenerator<StreamEvent, void, unknown> {
  runtime.resilience.throwIfAborted(state.abortSignal);

  const pendingMessages = await state.input.pendingInput?.takePendingMessages();
  if (pendingMessages && pendingMessages.length > 0) {
    for (const message of pendingMessages) {
      state.messages.push(message);
      yield {
        type: 'user_message',
        data: {
          message,
          stepIndex,
        },
      };
    }
  }

  const preparedMessages = await runtime.messages.prepareForLlmStep(
    state.messages,
    state.effectiveTools,
    state.input.contextLimitTokens
  );
  const compactionResult = preparedMessages.compaction;
  if (compactionResult.status === 'applied' && compactionResult.removedMessageIds.length > 0) {
    const compactionInfo: CompactionInfo = {
      executionId: state.input.executionId,
      stepIndex,
      removedMessageIds: compactionResult.removedMessageIds,
      messageCountBefore: preparedMessages.messageCountBeforeCompaction,
      messageCountAfter: state.messages.length,
    };
    await runtime.callbacks.safe(state.callbacks?.onCompaction, compactionInfo);
    yield {
      type: 'compaction',
      data: compactionInfo,
    };
  }

  runtime.resilience.throwIfAborted(state.abortSignal);

  await runtime.callbacks.safe(state.callbacks?.onContextUsage, {
    stepIndex,
    messageCount: state.messages.length,
    ...preparedMessages.contextUsage,
  });
}

export async function hasPendingUserMessages(state: RunLoopState): Promise<boolean> {
  return (await state.input.pendingInput?.hasPendingMessages?.()) ?? false;
}

/**
 * Normalize one failed step into the next run-loop decision.
 * Lower layers report precise failures; this function is where the loop
 * translates them into retry, timeout, abort, or terminal-error outcomes.
 */
export async function* handleStepFailure(
  runtime: RunLoopRuntime,
  state: RunLoopState,
  progress: RunLoopProgressState,
  error: unknown
): AsyncGenerator<StreamEvent, RunLoopProgressState, unknown> {
  const timeoutError = runtime.resilience.normalizeTimeoutBudgetError(error, state.abortSignal);
  if (timeoutError) {
    yield* runtime.stream.error(timeoutError);
    return {
      ...progress,
      runOutcome: 'timeout',
      runErrorCode: timeoutError.errorCode,
      retryScheduled: false,
    };
  }

  if (runtime.resilience.isAbortError(error) || state.input.abortSignal?.aborted) {
    yield* runtime.stream.error(new AgentAbortedError(runtime.limits.abortedMessage));
    return {
      ...progress,
      runOutcome: 'aborted',
      runErrorCode: 'AGENT_ABORTED',
      retryScheduled: false,
    };
  }

  const normalizedError = runtime.resilience.normalizeError(error);
  await runtime.hooks.onRunError?.({
    executionId: state.input.executionId,
    traceId: state.traceId,
    stepIndex: progress.stepIndex,
    retryCount: progress.retryCount,
    errorCode: normalizedError.errorCode,
    category: normalizedError.category,
    error: normalizedError,
  });
  yield* runtime.stream.error(normalizedError);

  const nextProgress: RunLoopProgressState = {
    ...progress,
    runOutcome: 'error',
    runErrorCode: normalizedError.errorCode,
    retryScheduled: false,
  };
  const decision = await runtime.callbacks.safeError(state.callbacks?.onError, normalizedError);
  const shouldRetry = decision?.retry ?? normalizedError.retryable;
  if (!shouldRetry) {
    return nextProgress;
  }

  const nextRetryCount = progress.retryCount + 1;
  await runtime.hooks.onRetryScheduled?.({
    executionId: state.input.executionId,
    traceId: state.traceId,
    stepIndex: progress.stepIndex,
    retryCount: nextRetryCount,
    errorCode: normalizedError.errorCode,
  });

  if (nextRetryCount < runtime.limits.maxRetryCount) {
    const retryDelay = runtime.resilience.calculateRetryDelay(nextRetryCount, error as Error);
    try {
      await runtime.resilience.sleep(retryDelay, state.abortSignal);
    } catch (sleepError) {
      const sleepTimeoutError = runtime.resilience.normalizeTimeoutBudgetError(
        sleepError,
        state.abortSignal
      );
      if (sleepTimeoutError) {
        yield* runtime.stream.error(sleepTimeoutError);
        return {
          ...nextProgress,
          retryCount: nextRetryCount,
          runOutcome: 'timeout',
          runErrorCode: sleepTimeoutError.errorCode,
          retryScheduled: false,
        };
      }

      if (runtime.resilience.isAbortError(sleepError) || state.input.abortSignal?.aborted) {
        yield* runtime.stream.error(new AgentAbortedError(runtime.limits.abortedMessage));
        return {
          ...nextProgress,
          retryCount: nextRetryCount,
          runOutcome: 'aborted',
          runErrorCode: 'AGENT_ABORTED',
          retryScheduled: false,
        };
      }

      throw sleepError;
    }
  }

  return {
    ...nextProgress,
    retryCount: nextRetryCount,
    retryScheduled: true,
  };
}
