import { describe, expect, it, vi } from 'vitest';

import type { Chunk, LLMProvider } from '../../../providers';
import type { Message, StreamEvent } from '../../types';
import { callLLMAndProcessStream, type LLMStreamRuntimeDeps } from '../llm-stream-runtime';

type ChunkDelta = NonNullable<NonNullable<Chunk['choices']>[number]>['delta'];
type TestDelta = Partial<ChunkDelta> & { finish_reason?: string };
type TestChunk = Omit<Chunk, 'choices'> & {
  choices?: Array<{
    index: number;
    delta: TestDelta;
  }>;
};

function toStream(chunks: TestChunk[]): AsyncGenerator<Chunk> {
  return (async function* () {
    for (const chunk of chunks) {
      yield chunk as Chunk;
    }
  })();
}

function createProvider(stream: AsyncGenerator<Chunk>) {
  return {
    config: {},
    generate: vi.fn(),
    generateStream: vi.fn().mockReturnValue(stream),
    getTimeTimeout: vi.fn(() => 1),
    getLLMMaxTokens: vi.fn(() => 1),
    getMaxOutputTokens: vi.fn(() => 1),
  } as unknown as LLMProvider;
}

function createDeps(provider: LLMProvider): LLMStreamRuntimeDeps {
  return {
    llmProvider: provider,
    enableServerSideContinuation: false,
    throwIfAborted: (signal?: AbortSignal) => {
      if (signal?.aborted) {
        throw new Error('aborted');
      }
    },
    logDebug: vi.fn(),
    logError: vi.fn(),
  };
}

async function collectEvents<T>(
  generator: AsyncGenerator<StreamEvent, T, unknown>
): Promise<{ events: StreamEvent[]; result: T }> {
  const events: StreamEvent[] = [];
  for (;;) {
    const next = await generator.next();
    if (next.done) {
      return {
        events,
        result: next.value,
      };
    }
    events.push(next.value as StreamEvent);
  }
}

describe('llm-stream-runtime', () => {
  it('aggregates text, reasoning, tool calls, and continuation metadata', async () => {
    const provider = createProvider(
      toStream([
        {
          id: 'resp_1',
          index: 0,
          choices: [{ index: 0, delta: { content: 'Hello ' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { reasoning_content: 'Thinking' } }],
        },
        {
          index: 0,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    id: 'tool_1',
                    type: 'function',
                    index: 0,
                    function: { name: 'bash', arguments: '{"command":"' },
                  },
                ],
              },
            },
          ],
        },
        {
          index: 0,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    id: 'tool_1',
                    type: 'function',
                    index: 0,
                    function: { name: 'bash', arguments: 'echo hi"}' },
                  },
                ],
                finish_reason: 'tool_calls',
              } as unknown as ChunkDelta,
            },
          ],
        },
      ])
    );

    const { events, result } = await collectEvents(
      callLLMAndProcessStream(createDeps(provider), {
        messages: [
          {
            messageId: 'u1',
            role: 'user',
            type: 'user',
            content: 'hello',
            timestamp: 1,
          } as Message,
        ],
        config: undefined,
      })
    );

    expect(events.map((event) => event.type)).toEqual([
      'chunk',
      'reasoning_chunk',
      'tool_call',
      'tool_call',
    ]);
    expect(result.assistantMessage).toMatchObject({
      role: 'assistant',
      content: 'Hello ',
      reasoning_content: 'Thinking',
      type: 'tool-call',
      metadata: {
        responseId: 'resp_1',
        continuationMode: 'full',
      },
    });
    expect(result.toolCalls).toEqual([
      {
        id: 'tool_1',
        type: 'function',
        index: 0,
        function: {
          name: 'bash',
          arguments: '{"command":"echo hi"}',
        },
      },
    ]);
  });

  it('treats whitespace-only assistant output as empty and retries upstream', async () => {
    const provider = createProvider(
      toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: '   ' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    await expect(
      collectEvents(
        callLLMAndProcessStream(createDeps(provider), {
          messages: [
            {
              messageId: 'u1',
              role: 'user',
              type: 'user',
              content: 'hello',
              timestamp: 1,
            } as Message,
          ],
          config: undefined,
        })
      )
    ).rejects.toThrow('LLM returned an empty assistant response');
  });

  it('logs request planning and cache-aware usage details for debugging', async () => {
    const provider = createProvider(
      toStream([
        {
          id: 'resp_2',
          index: 0,
          choices: [{ index: 0, delta: { content: 'Hello again' } }],
        },
        {
          index: 0,
          usage: {
            input_tokens: 1200,
            output_tokens: 10,
            prompt_tokens: 1200,
            completion_tokens: 10,
            total_tokens: 1210,
            input_tokens_details: {
              cached_tokens: 768,
            },
          },
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );
    const deps = createDeps(provider);

    await collectEvents(
      callLLMAndProcessStream(deps, {
        messages: [
          {
            messageId: 'u1',
            role: 'user',
            type: 'user',
            content: 'hello',
            timestamp: 1,
          } as Message,
        ],
        config: undefined,
        executionId: 'exec_1',
        stepIndex: 2,
      })
    );

    expect(deps.logDebug).toHaveBeenCalledWith(
      '[Agent] llm.request.plan',
      expect.objectContaining({
        executionId: 'exec_1',
        stepIndex: 2,
        messageCount: 1,
      }),
      expect.objectContaining({
        continuationMode: 'full',
        requestInputMessageCount: 1,
        requestMessageCount: 1,
        hasPreviousResponseId: false,
      })
    );
    expect(deps.logDebug).toHaveBeenCalledWith(
      '[Agent] llm.stream.usage',
      expect.objectContaining({
        executionId: 'exec_1',
        stepIndex: 2,
        messageCount: 1,
      }),
      expect.objectContaining({
        promptTokens: 1200,
        completionTokens: 10,
        totalTokens: 1210,
        promptCacheHitTokens: 768,
      })
    );
  });
});
