import { describe, expect, it, vi } from 'vitest';

import type { AgentCallbacks, Message, StreamEvent } from '../../types';
import { AgentUpstreamRetryableError } from '../error';
import {
  handleStepFailure,
  prepareMessagesForStep,
  resolvePreStepTerminalState,
  type RunLoopProgressState,
} from '../run-loop-control';
import type { RunLoopRuntime, RunLoopState } from '../run-loop';
import { createNoopObservation } from '../runtime-hooks';

function createMessage(content: string): Message {
  return {
    messageId: `msg_${content}`,
    type: 'user',
    role: 'user',
    content,
    timestamp: Date.now(),
  };
}

async function collectEvents<T>(
  generator: AsyncGenerator<StreamEvent, T, unknown>
): Promise<{ events: StreamEvent[]; result: T }> {
  const events: StreamEvent[] = [];
  for (;;) {
    const next = await generator.next();
    if (next.done) {
      return { events, result: next.value };
    }
    events.push(next.value);
  }
}

function createRuntime(
  overrides: Partial<RunLoopRuntime> = {},
  hooksOverrides: Partial<RunLoopRuntime['hooks']> = {}
): RunLoopRuntime {
  const hooks = {
    onRunStart: async () => createNoopObservation(),
    onLLMStageStart: async () => createNoopObservation(),
    onToolStageStart: async () => createNoopObservation(),
    onToolExecutionStart: async () => createNoopObservation(),
    onRunError: async () => undefined,
    onRetryScheduled: async () => undefined,
    ...hooksOverrides,
  };

  return {
    limits: {
      maxRetryCount: 2,
      abortedMessage: 'Operation aborted',
    },
    callbacks: {
      safe: async (callback, arg) => {
        await callback?.(arg);
      },
      safeError: async (callback, error) => callback?.(error),
    },
    messages: {
      prepareForLlmStep: async () => ({
        messageCountBeforeCompaction: 1,
        compaction: {
          status: 'skipped',
          removedMessageIds: [],
        },
        contextUsage: {
          contextTokens: 1,
          contextLimitTokens: 10,
          contextUsagePercent: 10,
        },
      }),
      mergeLLMConfig: (config) => config,
    },
    stages: {
      llm: async function* () {
        throw new Error('unused');
      },
      tools: async function* () {
        throw new Error('unused');
      },
    },
    stream: {
      progress: function* () {
        return;
      },
      checkpoint: async function* () {
        return;
      },
      done: function* () {
        return;
      },
      error: function* (error) {
        yield {
          type: 'error',
          data: { errorCode: error.errorCode, message: error.message },
        };
      },
      maxRetries: function* () {
        yield {
          type: 'error',
          data: { errorCode: 'AGENT_MAX_RETRIES_REACHED' },
        };
      },
    },
    resilience: {
      createStageAbortScope: (signal) => ({
        signal,
        release: () => undefined,
      }),
      throwIfAborted: () => undefined,
      normalizeTimeoutBudgetError: () => undefined,
      timeoutBudgetErrorFromSignal: () => undefined,
      isAbortError: () => false,
      normalizeError: (error) =>
        error instanceof AgentUpstreamRetryableError
          ? error
          : new AgentUpstreamRetryableError(String((error as Error).message || error)),
      calculateRetryDelay: () => 0,
      sleep: async () => undefined,
    },
    diagnostics: {
      extractErrorCode: (error) =>
        typeof (error as { errorCode?: unknown })?.errorCode === 'string'
          ? ((error as { errorCode?: string }).errorCode as string)
          : undefined,
    },
    hooks,
    ...overrides,
  };
}

function createState(callbacks?: Partial<AgentCallbacks>): RunLoopState {
  return {
    input: {
      executionId: 'exec_1',
      conversationId: 'conv_1',
      messages: [createMessage('hello')],
      maxSteps: 3,
    },
    callbacks: callbacks as AgentCallbacks | undefined,
    maxSteps: 3,
    messages: [createMessage('hello')],
    effectiveTools: undefined,
    writeBufferSessions: new Map(),
    timeoutBudget: undefined,
    executionScope: {
      signal: undefined,
      release: () => undefined,
    },
    abortSignal: undefined,
    traceId: 'trace_1',
    runObservation: createNoopObservation(),
  };
}

function createProgress(overrides: Partial<RunLoopProgressState> = {}): RunLoopProgressState {
  return {
    stepIndex: 1,
    retryCount: 0,
    runOutcome: 'done',
    runErrorCode: undefined,
    terminalDoneEmitted: false,
    retryScheduled: false,
    ...overrides,
  };
}

describe('run-loop-control', () => {
  it('emits max-retries terminal state before the next step starts', async () => {
    const runtime = createRuntime();
    const state = createState();

    const { events, result } = await collectEvents(
      resolvePreStepTerminalState(runtime, state, createProgress({ retryCount: 2 }))
    );

    expect(events).toEqual([
      {
        type: 'error',
        data: { errorCode: 'AGENT_MAX_RETRIES_REACHED' },
      },
    ]);
    expect(result).toMatchObject({
      runOutcome: 'max_retries',
      runErrorCode: 'AGENT_MAX_RETRIES_REACHED',
    });
  });

  it('prepares compacted messages before reporting context usage', async () => {
    const onCompaction = vi.fn();
    const onContextUsage = vi.fn();
    const state = createState({ onCompaction, onContextUsage });
    const compactedMessage = {
      messageId: 'msg_compacted',
      type: 'summary',
      role: 'assistant',
      content: 'summary',
      timestamp: 2,
    } as Message;
    const runtime = createRuntime({
      messages: {
        prepareForLlmStep: async (messages) => {
          messages.splice(0, messages.length, compactedMessage);
          return {
            messageCountBeforeCompaction: 1,
            compaction: {
              status: 'applied',
              removedMessageIds: ['msg_hello'],
            },
            contextUsage: {
              contextTokens: 5,
              contextLimitTokens: 10,
              contextUsagePercent: 50,
            },
          };
        },
        mergeLLMConfig: (config) => config,
      },
    });

    const { events } = await collectEvents(prepareMessagesForStep(runtime, state, 1));

    expect(events).toEqual([
      {
        type: 'compaction',
        data: {
          executionId: 'exec_1',
          stepIndex: 1,
          removedMessageIds: ['msg_hello'],
          messageCountBefore: 1,
          messageCountAfter: 1,
        },
      },
    ]);
    expect(onCompaction).toHaveBeenCalledOnce();
    expect(onContextUsage).toHaveBeenCalledWith({
      stepIndex: 1,
      messageCount: 1,
      contextTokens: 5,
      contextLimitTokens: 10,
      contextUsagePercent: 50,
    });
    expect(state.messages[0]).toBe(compactedMessage);
  });

  it('continues with context usage reporting when compaction fails', async () => {
    const onCompaction = vi.fn();
    const onContextUsage = vi.fn();
    const state = createState({ onCompaction, onContextUsage });
    const runtime = createRuntime({
      messages: {
        prepareForLlmStep: async () => ({
          messageCountBeforeCompaction: 1,
          compaction: {
            status: 'failed',
            removedMessageIds: [],
          },
          contextUsage: {
            contextTokens: 4,
            contextLimitTokens: 10,
            contextUsagePercent: 40,
          },
        }),
        mergeLLMConfig: (config) => config,
      },
    });

    const { events } = await collectEvents(prepareMessagesForStep(runtime, state, 1));

    expect(events).toEqual([]);
    expect(onCompaction).not.toHaveBeenCalled();
    expect(onContextUsage).toHaveBeenCalledWith({
      stepIndex: 1,
      messageCount: 1,
      contextTokens: 4,
      contextLimitTokens: 10,
      contextUsagePercent: 40,
    });
  });

  it('does not schedule another retry when onError disables retry after a previous retry', async () => {
    const onRunError = vi.fn();
    const onRetryScheduled = vi.fn();
    const callbacks: Partial<AgentCallbacks> = {
      onError: vi.fn().mockResolvedValue({ retry: false }),
    };
    const runtime = createRuntime(
      {},
      {
        onRunError,
        onRetryScheduled,
      }
    );
    const state = createState(callbacks);

    const { events, result } = await collectEvents(
      handleStepFailure(
        runtime,
        state,
        createProgress({ retryCount: 1, runOutcome: 'error', runErrorCode: 'OLD_ERROR' }),
        new AgentUpstreamRetryableError('stop now')
      )
    );

    expect(events).toEqual([
      {
        type: 'error',
        data: {
          errorCode: 'AGENT_UPSTREAM_RETRYABLE',
          message: 'stop now',
        },
      },
    ]);
    expect(result.retryScheduled).toBe(false);
    expect(result.retryCount).toBe(1);
    expect(onRunError).toHaveBeenCalledOnce();
    expect(onRetryScheduled).not.toHaveBeenCalled();
  });
});
