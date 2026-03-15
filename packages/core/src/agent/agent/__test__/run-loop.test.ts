import { describe, expect, it, vi } from 'vitest';

import type { AgentCallbacks, Message, StreamEvent } from '../../types';
import { AgentAbortedError, AgentUpstreamRetryableError } from '../error';
import { runAgentLoop, type RunLoopRuntime, type RunLoopState } from '../run-loop';
import { createNoopObservation } from '../runtime-hooks';

async function collectEvents(generator: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

function createMessage(content: string): Message {
  return {
    messageId: `msg_${content}`,
    type: 'user',
    role: 'user',
    content,
    timestamp: Date.now(),
  };
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
        return {
          assistantMessage: {
            messageId: 'assistant_1',
            type: 'assistant-text',
            role: 'assistant',
            content: 'done',
            timestamp: Date.now(),
          } as Message,
          toolCalls: [],
        };
      },
      tools: async function* () {
        return {
          messageId: 'tool_1',
          type: 'tool-result',
          role: 'tool',
          content: 'tool-ok',
          timestamp: Date.now(),
        } as Message;
      },
    },
    stream: {
      progress: function* (executionId, stepIndex, currentAction, messageCount) {
        yield {
          type: 'progress',
          data: { executionId, stepIndex, currentAction, messageCount },
        };
      },
      checkpoint: async function* () {
        return;
      },
      done: function* (stepIndex, finishReason = 'stop') {
        yield {
          type: 'done',
          data: { stepIndex, finishReason },
        };
      },
      error: function* (error) {
        yield {
          type: 'error',
          data: { name: error.name, errorCode: error.errorCode, message: error.message },
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
      throwIfAborted: (signal?: AbortSignal) => {
        if (signal?.aborted) {
          throw new AgentAbortedError('Operation aborted');
        }
      },
      normalizeTimeoutBudgetError: () => undefined,
      timeoutBudgetErrorFromSignal: () => undefined,
      isAbortError: (error) => error instanceof AgentAbortedError,
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

function createState(callbacks?: AgentCallbacks, abortSignal?: AbortSignal): RunLoopState {
  return {
    input: {
      executionId: 'exec_1',
      conversationId: 'conv_1',
      messages: [createMessage('hello')],
      abortSignal,
      maxSteps: 3,
    },
    callbacks,
    maxSteps: 3,
    messages: [createMessage('hello')],
    effectiveTools: undefined,
    writeBufferSessions: new Map(),
    timeoutBudget: undefined,
    executionScope: {
      signal: abortSignal,
      release: () => undefined,
    },
    abortSignal,
    traceId: 'trace_1',
    runObservation: createNoopObservation(),
  };
}

describe('run-loop', () => {
  it('invokes retry hooks when a retryable llm error is scheduled', async () => {
    const onRunError = vi.fn();
    const onRetryScheduled = vi.fn();
    let attempts = 0;
    const runtime = createRuntime(
      {
        stages: {
          llm: async function* () {
            attempts += 1;
            if (attempts === 1) {
              throw new AgentUpstreamRetryableError('retry me');
            }
            return {
              assistantMessage: {
                messageId: 'assistant_retry_ok',
                type: 'assistant-text',
                role: 'assistant',
                content: 'ok',
                timestamp: Date.now(),
              } as Message,
              toolCalls: [],
            };
          },
          tools: async function* () {
            throw new Error('not-used');
          },
        },
      },
      {
        onRunError,
        onRetryScheduled,
      }
    );
    const callbacks: AgentCallbacks = {
      onMessage: vi.fn(),
      onCheckpoint: vi.fn(),
      onError: vi.fn().mockResolvedValue({ retry: true }),
    };

    const events = await collectEvents(runAgentLoop(runtime, createState(callbacks)));

    expect(events.map((event) => event.type)).toEqual(['progress', 'error', 'progress', 'done']);
    expect(onRunError).toHaveBeenCalledOnce();
    expect(onRetryScheduled).toHaveBeenCalledOnce();
    expect(callbacks.onError).toHaveBeenCalledOnce();
  });

  it('short-circuits with an abort error before entering llm stage', async () => {
    const controller = new AbortController();
    controller.abort();
    const llmStage = vi.fn();
    const runtime = createRuntime({
      stages: {
        llm: async function* () {
          llmStage();
          return {
            assistantMessage: {
              messageId: 'assistant_unused',
              type: 'assistant-text',
              role: 'assistant',
              content: 'unused',
              timestamp: Date.now(),
            } as Message,
            toolCalls: [],
          };
        },
        tools: async function* () {
          return {
            messageId: 'tool_unused',
            type: 'tool-result',
            role: 'tool',
            content: 'unused',
            timestamp: Date.now(),
          } as Message;
        },
      },
      resilience: {
        ...createRuntime().resilience,
        timeoutBudgetErrorFromSignal: () => undefined,
      },
    });

    const events = await collectEvents(
      runAgentLoop(runtime, createState(undefined, controller.signal))
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'error',
      data: { errorCode: 'AGENT_ABORTED' },
    });
    expect(llmStage).not.toHaveBeenCalled();
  });

  it('drains pending user messages before the llm step and emits user_message events', async () => {
    const lateUserMessage = createMessage('late-user');
    const llmStage = vi.fn(async function* () {
      return {
        assistantMessage: {
          messageId: 'assistant_after_late_user',
          type: 'assistant-text',
          role: 'assistant',
          content: 'done',
          timestamp: Date.now(),
        } as Message,
        toolCalls: [],
      };
    });
    const runtime = createRuntime({
      stages: {
        llm: llmStage,
        tools: async function* () {
          throw new Error('not-used');
        },
      },
    });
    const state = createState();
    state.input.pendingInput = {
      takePendingMessages: vi.fn().mockResolvedValue([lateUserMessage]),
      hasPendingMessages: vi.fn().mockResolvedValue(false),
    };

    const events = await collectEvents(runAgentLoop(runtime, state));

    expect(events.map((event) => event.type)).toEqual(['user_message', 'progress', 'done']);
    expect(events[0]).toMatchObject({
      type: 'user_message',
      data: {
        message: lateUserMessage,
        stepIndex: 1,
      },
    });
    expect(state.messages.map((message) => message.content)).toEqual([
      'hello',
      'late-user',
      'done',
    ]);
    expect(llmStage).toHaveBeenCalledOnce();
  });

  it('continues the loop instead of finishing when pending user input exists at stop time', async () => {
    const llmStage = vi
      .fn()
      .mockImplementationOnce(async function* () {
        return {
          assistantMessage: {
            messageId: 'assistant_1',
            type: 'assistant-text',
            role: 'assistant',
            content: 'first',
            timestamp: Date.now(),
          } as Message,
          toolCalls: [],
        };
      })
      .mockImplementationOnce(async function* () {
        return {
          assistantMessage: {
            messageId: 'assistant_2',
            type: 'assistant-text',
            role: 'assistant',
            content: 'second',
            timestamp: Date.now(),
          } as Message,
          toolCalls: [],
        };
      });

    const runtime = createRuntime({
      stages: {
        llm: llmStage,
        tools: async function* () {
          throw new Error('not-used');
        },
      },
    });
    const state = createState();
    state.input.pendingInput = {
      takePendingMessages: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([createMessage('follow-up-user')]),
      hasPendingMessages: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    };

    const events = await collectEvents(runAgentLoop(runtime, state));

    expect(events.map((event) => event.type)).toEqual([
      'progress',
      'user_message',
      'progress',
      'done',
    ]);
    expect(llmStage).toHaveBeenCalledTimes(2);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      data: {
        stepIndex: 2,
        finishReason: 'stop',
      },
    });
  });
});
