import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { StatelessAgent } from '../index';
import type { AgentToolExecutor } from '../tool-executor';
import type {
  AgentMetric,
  AgentTraceEvent,
  CompactionInfo,
  Message,
  StreamEvent,
} from '../../types';
import { EnterpriseToolExecutor } from '../../tool-v2/agent-tool-executor';
import { EnterpriseToolSystem } from '../../tool-v2/tool-system';
import { LocalShellToolV2 } from '../../tool-v2/handlers/shell';
import { WriteFileToolV2 } from '../../tool-v2/handlers/write-file';
import type { Chunk, LLMProvider, ToolCall } from '../../../providers';
import { LLMAuthError, LLMBadRequestError, LLMRetryableError } from '../../../providers';
import { AgentError } from '../error';
import * as compactionModule from '../compaction';
import { InMemoryToolExecutionLedger } from '../tool-execution-ledger';

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

function toToolCallStream(
  responseId: string,
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>
): AsyncGenerator<Chunk> {
  const raw = JSON.stringify(args);
  const cut = Math.max(1, Math.floor(raw.length / 2));
  return toStream([
    {
      id: responseId,
      index: 0,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                id: toolCallId,
                type: 'function',
                index: 0,
                function: { name: toolName, arguments: raw.slice(0, cut) },
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
                id: toolCallId,
                type: 'function',
                index: 0,
                function: { name: toolName, arguments: raw.slice(cut) },
              },
            ],
            finish_reason: 'tool_calls',
          } as unknown as ChunkDelta,
        },
      ],
    },
  ]);
}

async function collectEvents(generator: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

function createProvider() {
  return {
    config: {} as Record<string, unknown>,
    generate: vi.fn(),
    generateStream: vi.fn(),
    getTimeTimeout: vi.fn(() => 1),
    getLLMMaxTokens: vi.fn(() => 1),
    getMaxOutputTokens: vi.fn(() => 1),
  } as unknown as LLMProvider;
}

function createToolManager() {
  return {
    execute: vi.fn(),
    registerTool: vi.fn(),
    registerTools: vi.fn(),
    getTools: vi.fn(() => []),
    getToolSchemas: vi.fn(() => []),
    getConcurrencyPolicy: vi.fn(() => ({ mode: 'exclusive' as const })),
  } as unknown as AgentToolExecutor;
}

function createEnterpriseToolExecutor(
  handlers: ConstructorParameters<typeof EnterpriseToolSystem>[0],
  options?: {
    workingDirectory?: string;
  }
): AgentToolExecutor {
  return new EnterpriseToolExecutor({
    system: new EnterpriseToolSystem(handlers),
    workingDirectory: options?.workingDirectory,
    approvalPolicy: 'unless-trusted',
    trustLevel: 'trusted',
  });
}

function createInput() {
  const message: Message = {
    messageId: 'u1',
    type: 'user',
    role: 'user',
    content: 'hello',
    timestamp: Date.now(),
  };

  return {
    executionId: 'exec_1',
    conversationId: 'conv_1',
    messages: [message],
    maxSteps: 4,
  };
}

describe('StatelessAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('runs stream and yields chunk/reasoning/done without tool calls', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          id: 'resp_hello',
          index: 0,
          choices: [{ index: 0, delta: { content: 'Hello' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { reasoning_content: 'think' } }],
        },
        {
          index: 0,
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    const agent = new StatelessAgent(provider, manager as unknown as AgentToolExecutor, {
      maxRetryCount: 3,
      toolExecutionLedger: new InMemoryToolExecutionLedger(),
    });
    const onMessage = vi.fn();
    const events = await collectEvents(
      agent.runStream(createInput(), { onMessage, onCheckpoint: vi.fn() })
    );

    expect(events.map((e) => e.type)).toEqual(['progress', 'chunk', 'reasoning_chunk', 'done']);
    expect(events[3]?.data).toMatchObject({ finishReason: 'stop', steps: 1 });
    expect(onMessage).toHaveBeenCalledOnce();
    expect(onMessage.mock.calls[0]?.[0]).toMatchObject({
      role: 'assistant',
      content: 'Hello',
      reasoning_content: 'think',
      metadata: {
        responseId: 'resp_hello',
      },
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    });
  });

  it('captures usage from a usage-only tail chunk after finish_reason', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: 'ok' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
        {
          index: 0,
          choices: [],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 8,
            total_tokens: 20,
          },
        },
      ])
    );

    const agent = new StatelessAgent(provider, manager as unknown as AgentToolExecutor, {
      maxRetryCount: 3,
      toolExecutionLedger: new InMemoryToolExecutionLedger(),
    });
    const onMessage = vi.fn();

    await collectEvents(agent.runStream(createInput(), { onMessage, onCheckpoint: vi.fn() }));

    expect(onMessage).toHaveBeenCalledOnce();
    expect(onMessage.mock.calls[0]?.[0]).toMatchObject({
      role: 'assistant',
      content: 'ok',
      usage: {
        prompt_tokens: 12,
        completion_tokens: 8,
        total_tokens: 20,
      },
    });
  });

  it('uses previous_response_id and keeps tool-call/tool-result pairs in the delta', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    manager.execute = vi.fn().mockResolvedValue({
      success: true,
      output: '{"temperature":26}',
    });
    provider.generateStream = vi
      .fn()
      .mockReturnValueOnce(
        toToolCallStream('resp_tool_1', 'call_1', 'lookup_weather', {
          city: 'Shanghai',
        })
      )
      .mockReturnValueOnce(
        toStream([
          {
            id: 'resp_tool_2',
            index: 0,
            choices: [{ index: 0, delta: { content: 'done' } }],
          },
          {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          },
        ])
      );

    const agent = new StatelessAgent(provider, manager as unknown as AgentToolExecutor, {
      maxRetryCount: 3,
      enableServerSideContinuation: true,
      toolExecutionLedger: new InMemoryToolExecutionLedger(),
    });
    const onMessage = vi.fn();

    await collectEvents(agent.runStream(createInput(), { onMessage, onCheckpoint: vi.fn() }));

    const generateStreamCalls = (
      provider.generateStream as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    expect(generateStreamCalls).toHaveLength(2);
    expect(generateStreamCalls[0]?.[0]).toMatchObject([{ role: 'user', content: 'hello' }]);
    expect(generateStreamCalls[0]?.[1]).toMatchObject({
      prompt_cache_key: 'conv_1',
    });
    expect(generateStreamCalls[0]?.[1] ?? {}).not.toHaveProperty('previous_response_id');
    expect(generateStreamCalls[1]?.[0]).toMatchObject([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'lookup_weather',
              arguments: '{"city":"Shanghai"}',
            },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_1',
        content: '{"temperature":26}',
      },
    ]);
    expect(generateStreamCalls[1]?.[1]).toMatchObject({
      previous_response_id: 'resp_tool_1',
      prompt_cache_key: 'conv_1',
    });

    const assistantMessages = onMessage.mock.calls
      .map((call) => call[0] as Message)
      .filter((message) => message.role === 'assistant');
    expect(assistantMessages[0]?.metadata).toMatchObject({
      responseId: 'resp_tool_1',
      continuationMode: 'full',
    });
    expect(assistantMessages[1]?.metadata).toMatchObject({
      responseId: 'resp_tool_2',
      continuationMode: 'incremental',
      previousResponseIdUsed: 'resp_tool_1',
      continuationBaselineMessageCount: 1,
      continuationDeltaMessageCount: 2,
    });
  });

  it('reuses previous_response_id across runs when history is append-only', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi
      .fn()
      .mockReturnValueOnce(
        toStream([
          {
            id: 'resp_prev_run',
            index: 0,
            choices: [{ index: 0, delta: { content: 'Hello there' } }],
          },
          {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          },
        ])
      )
      .mockReturnValueOnce(
        toStream([
          {
            id: 'resp_next_run',
            index: 0,
            choices: [{ index: 0, delta: { content: 'Welcome back' } }],
          },
          {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          },
        ])
      );

    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      enableServerSideContinuation: true,
      toolExecutionLedger: new InMemoryToolExecutionLedger(),
    });
    const firstRunMessages: Message[] = [];
    await collectEvents(
      agent.runStream(createInput(), {
        onMessage: async (message) => {
          firstRunMessages.push(message);
        },
        onCheckpoint: vi.fn(),
      })
    );

    const previousAssistant = firstRunMessages.find((message) => message.role === 'assistant');
    expect(previousAssistant?.metadata).toMatchObject({
      responseId: 'resp_prev_run',
      continuationMode: 'full',
    });

    const historyMessages = [...createInput().messages, previousAssistant as Message];
    await collectEvents(
      agent.runStream(
        {
          executionId: 'exec_2',
          conversationId: 'conv_1',
          messages: [
            ...historyMessages,
            {
              messageId: 'u2',
              type: 'user',
              role: 'user',
              content: 'What can you do now?',
              timestamp: Date.now(),
            },
          ],
          maxSteps: 4,
        },
        { onMessage: vi.fn(), onCheckpoint: vi.fn() }
      )
    );

    const generateStreamCalls = (
      provider.generateStream as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    expect(generateStreamCalls).toHaveLength(2);
    expect(generateStreamCalls[1]?.[0]).toMatchObject([
      {
        role: 'user',
        content: 'What can you do now?',
      },
    ]);
    expect(generateStreamCalls[1]?.[1]).toMatchObject({
      previous_response_id: 'resp_prev_run',
      prompt_cache_key: 'conv_1',
    });
  });

  it('falls back to full replay when non-input config changes', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi
      .fn()
      .mockReturnValueOnce(
        toStream([
          {
            id: 'resp_config_base',
            index: 0,
            choices: [{ index: 0, delta: { content: 'base' } }],
          },
          {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          },
        ])
      )
      .mockReturnValueOnce(
        toStream([
          {
            id: 'resp_config_new',
            index: 0,
            choices: [{ index: 0, delta: { content: 'new' } }],
          },
          {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          },
        ])
      );

    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      enableServerSideContinuation: true,
      toolExecutionLedger: new InMemoryToolExecutionLedger(),
    });
    const firstRunMessages: Message[] = [];
    await collectEvents(
      agent.runStream(createInput(), {
        onMessage: async (message) => {
          firstRunMessages.push(message);
        },
        onCheckpoint: vi.fn(),
      })
    );

    const previousAssistant = firstRunMessages.find((message) => message.role === 'assistant');
    await collectEvents(
      agent.runStream(
        {
          executionId: 'exec_3',
          conversationId: 'conv_1',
          messages: [
            ...createInput().messages,
            previousAssistant as Message,
            {
              messageId: 'u3',
              type: 'user',
              role: 'user',
              content: 'next question',
              timestamp: Date.now(),
            },
          ],
          config: { temperature: 0.2 },
          maxSteps: 4,
        },
        { onMessage: vi.fn(), onCheckpoint: vi.fn() }
      )
    );

    const generateStreamCalls = (
      provider.generateStream as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    expect(generateStreamCalls).toHaveLength(2);
    expect(generateStreamCalls[1]?.[0]).toMatchObject([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'base' },
      { role: 'user', content: 'next question' },
    ]);
    expect(generateStreamCalls[1]?.[1] ?? {}).not.toHaveProperty('previous_response_id');
  });

  it('falls back to full replay when prior context prefix no longer matches', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi
      .fn()
      .mockReturnValueOnce(
        toStream([
          {
            id: 'resp_prefix_base',
            index: 0,
            choices: [{ index: 0, delta: { content: 'base' } }],
          },
          {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          },
        ])
      )
      .mockReturnValueOnce(
        toStream([
          {
            id: 'resp_prefix_new',
            index: 0,
            choices: [{ index: 0, delta: { content: 'new' } }],
          },
          {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          },
        ])
      );

    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      enableServerSideContinuation: true,
      toolExecutionLedger: new InMemoryToolExecutionLedger(),
    });
    const firstRunMessages: Message[] = [];
    await collectEvents(
      agent.runStream(createInput(), {
        onMessage: async (message) => {
          firstRunMessages.push(message);
        },
        onCheckpoint: vi.fn(),
      })
    );

    const previousAssistant = firstRunMessages.find((message) => message.role === 'assistant');
    await collectEvents(
      agent.runStream(
        {
          executionId: 'exec_4',
          conversationId: 'conv_1',
          messages: [
            {
              messageId: 'u1_changed',
              type: 'user',
              role: 'user',
              content: 'hello changed',
              timestamp: Date.now(),
            },
            previousAssistant as Message,
            {
              messageId: 'u4',
              type: 'user',
              role: 'user',
              content: 'next question',
              timestamp: Date.now(),
            },
          ],
          maxSteps: 4,
        },
        { onMessage: vi.fn(), onCheckpoint: vi.fn() }
      )
    );

    const generateStreamCalls = (
      provider.generateStream as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    expect(generateStreamCalls).toHaveLength(2);
    expect(generateStreamCalls[1]?.[0]).toMatchObject([
      { role: 'user', content: 'hello changed' },
      { role: 'assistant', content: 'base' },
      { role: 'user', content: 'next question' },
    ]);
    expect(generateStreamCalls[1]?.[1] ?? {}).not.toHaveProperty('previous_response_id');
  });

  it('filters empty assistant-text messages before calling generateStream', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: 'ok' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    const agent = new StatelessAgent(provider, manager as unknown as AgentToolExecutor, {
      maxRetryCount: 3,
      toolExecutionLedger: new InMemoryToolExecutionLedger(),
    });
    await collectEvents(
      agent.runStream(
        {
          ...createInput(),
          messages: [
            createInput().messages[0]!,
            {
              messageId: 'empty_assistant',
              role: 'assistant',
              type: 'assistant-text',
              content: '',
              reasoning_content: '',
              timestamp: Date.now(),
            },
          ],
        },
        { onMessage: vi.fn(), onCheckpoint: vi.fn() }
      )
    );

    const generateStreamCalls = (
      provider.generateStream as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    expect(generateStreamCalls).toHaveLength(1);
    const llmMessages = generateStreamCalls[0]?.[0] as Array<{ role: string; content: unknown }>;
    expect(llmMessages).toHaveLength(1);
    expect(llmMessages[0]).toMatchObject({ role: 'user', content: 'hello' });
  });

  it('passes abortSignal to llm generateStream config', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: 'ok' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    const controller = new AbortController();
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      toolExecutionLedger: new InMemoryToolExecutionLedger(),
    });
    await collectEvents(
      agent.runStream(
        {
          ...createInput(),
          abortSignal: controller.signal,
          config: { temperature: 0.1 },
        },
        { onMessage: vi.fn(), onCheckpoint: vi.fn() }
      )
    );

    const generateStreamCalls = (
      provider.generateStream as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    expect(generateStreamCalls).toHaveLength(1);
    const callConfig = generateStreamCalls[0]?.[1] as {
      temperature?: number;
      abortSignal?: AbortSignal;
      prompt_cache_key?: string;
    };
    expect(callConfig.temperature).toBe(0.1);
    expect(callConfig.abortSignal).toBe(controller.signal);
    expect(callConfig.prompt_cache_key).toBe('conv_1');
  });

  it('preserves explicit prompt_cache_key when provided by caller', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: 'ok' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      toolExecutionLedger: new InMemoryToolExecutionLedger(),
    });
    await collectEvents(
      agent.runStream(
        {
          ...createInput(),
          config: {
            prompt_cache_key: 'explicit-cache-key',
          },
        },
        { onMessage: vi.fn(), onCheckpoint: vi.fn() }
      )
    );

    const generateStreamCalls = (
      provider.generateStream as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    expect(generateStreamCalls).toHaveLength(1);
    expect(generateStreamCalls[0]?.[1]).toMatchObject({
      prompt_cache_key: 'explicit-cache-key',
    });
  });

  it('passes top-level tools into llm generateStream config', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: 'ok' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    const tools = [
      {
        type: 'function',
        function: {
          name: 'bash',
          description: 'Execute shell command',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string' },
            },
            required: ['command'],
          },
        },
      },
    ];

    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      toolExecutionLedger: new InMemoryToolExecutionLedger(),
    });
    await collectEvents(
      agent.runStream(
        {
          ...createInput(),
          tools,
        },
        { onMessage: vi.fn(), onCheckpoint: vi.fn() }
      )
    );

    const generateStreamCalls = (
      provider.generateStream as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    expect(generateStreamCalls).toHaveLength(1);
    const callConfig = generateStreamCalls[0]?.[1] as { tools?: unknown[] };
    expect(callConfig.tools).toEqual(tools);
  });

  it('uses toolManager schemas when input.tools is omitted', async () => {
    const provider = createProvider();
    const manager = createEnterpriseToolExecutor([new LocalShellToolV2()]);
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: 'ok' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    const agent = new StatelessAgent(provider, manager as unknown as AgentToolExecutor, {
      maxRetryCount: 3,
      toolExecutionLedger: new InMemoryToolExecutionLedger(),
    });
    await collectEvents(
      agent.runStream(
        {
          ...createInput(),
        },
        { onMessage: vi.fn(), onCheckpoint: vi.fn() }
      )
    );

    const generateStreamCalls = (
      provider.generateStream as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    expect(generateStreamCalls).toHaveLength(1);
    const callConfig = generateStreamCalls[0]?.[1] as {
      tools?: Array<{ function?: { name?: string } }>;
    };
    expect(callConfig.tools?.some((tool) => tool.function?.name === 'local_shell')).toBe(true);
  });

  it('injects systemPrompt as system message when input has no system role message', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: 'ok' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      toolExecutionLedger: new InMemoryToolExecutionLedger(),
    });
    await collectEvents(
      agent.runStream(
        {
          ...createInput(),
          systemPrompt: 'You are a strict code assistant',
        },
        { onMessage: vi.fn(), onCheckpoint: vi.fn() }
      )
    );

    const generateStreamCalls = (
      provider.generateStream as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    const llmMessages = generateStreamCalls[0]?.[0] as Array<{ role: string; content: unknown }>;
    expect(llmMessages[0]).toMatchObject({
      role: 'system',
      content: 'You are a strict code assistant',
    });
  });

  it('emits max_steps done event when loop exits by step budget', async () => {
    const provider = createProvider();
    const manager = createToolManager();

    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    id: 'tool_max_steps_1',
                    type: 'function',
                    index: 0,
                    function: { name: 'bash', arguments: '{"command":"echo hi"}' },
                  },
                ],
                finish_reason: 'tool_calls',
              } as unknown as ChunkDelta,
            },
          ],
        },
      ])
    );
    manager.execute = vi.fn().mockResolvedValue({ success: true, output: 'ok' });

    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      toolExecutionLedger: new InMemoryToolExecutionLedger(),
    });
    const events = await collectEvents(
      agent.runStream(
        {
          ...createInput(),
          maxSteps: 1,
        },
        { onMessage: vi.fn(), onCheckpoint: vi.fn() }
      )
    );

    const doneEvent = events.find((event) => event.type === 'done');
    expect(doneEvent).toMatchObject({
      type: 'done',
      data: {
        finishReason: 'max_steps',
        steps: 1,
      },
    });
  });

  it('emits executionId on all progress events including per-tool progress', async () => {
    const provider = createProvider();
    const manager = createToolManager();

    provider.generateStream = vi
      .fn()
      .mockReturnValueOnce(
        toStream([
          {
            index: 0,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      id: 'tool_progress_1',
                      type: 'function',
                      index: 0,
                      function: { name: 'bash', arguments: '{"command":"echo 1"}' },
                    },
                    {
                      id: 'tool_progress_2',
                      type: 'function',
                      index: 1,
                      function: { name: 'bash', arguments: '{"command":"echo 2"}' },
                    },
                  ],
                  finish_reason: 'tool_calls',
                } as unknown as ChunkDelta,
              },
            ],
          },
        ])
      )
      .mockReturnValueOnce(
        toStream([
          {
            index: 0,
            choices: [{ index: 0, delta: { content: 'done' } }],
          },
          {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          },
        ])
      );
    manager.execute = vi.fn().mockResolvedValue({ success: true, output: 'ok' });

    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const events = await collectEvents(
      agent.runStream(
        {
          ...createInput(),
          executionId: 'exec_progress_1',
          maxSteps: 3,
        },
        { onMessage: vi.fn(), onCheckpoint: vi.fn() }
      )
    );
    const progressEvents = events.filter((event) => event.type === 'progress');
    expect(progressEvents.length).toBeGreaterThan(0);
    for (const progressEvent of progressEvents) {
      expect(progressEvent.data).toMatchObject({
        executionId: 'exec_progress_1',
      });
    }
  });

  it('merges tool call fragments by index when follow-up chunk omits id/name', async () => {
    const provider = createProvider();
    const manager = createToolManager();

    provider.generateStream = vi
      .fn()
      .mockReturnValueOnce(
        toStream([
          {
            index: 0,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      id: 'call_fragment_1',
                      type: 'function',
                      index: 0,
                      function: { name: 'bash', arguments: '{' },
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
                      index: 0,
                      function: { arguments: '"command":"ls -la"}' },
                    },
                  ],
                  finish_reason: 'tool_calls',
                } as unknown as ChunkDelta,
              },
            ],
          },
        ])
      )
      .mockReturnValueOnce(
        toStream([
          {
            index: 0,
            choices: [{ index: 0, delta: { content: 'done' } }],
          },
          {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          },
        ])
      );
    manager.execute = vi.fn().mockResolvedValue({ success: true, output: 'ok' });

    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const events = await collectEvents(
      agent.runStream(createInput(), { onMessage: vi.fn(), onCheckpoint: vi.fn() })
    );

    expect(manager.execute).toHaveBeenCalledTimes(1);
    expect(
      (manager.execute as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0]
    ).toMatchObject({
      id: 'call_fragment_1',
      function: {
        name: 'bash',
        arguments: '{"command":"ls -la"}',
      },
    });
    expect(events.filter((event) => event.type === 'tool_result')).toHaveLength(1);
  });

  it('returns invalid tool arguments back to llm without replaying broken arguments upstream', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    const toolCallId = 'call_invalid_args_1';
    const invalidToolOutput =
      'Invalid arguments format for tool glob: JSON Parse error: Unexpected EOF';

    provider.generateStream = vi
      .fn()
      .mockReturnValueOnce(
        toStream([
          {
            index: 0,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      id: toolCallId,
                      type: 'function',
                      index: 0,
                      function: { name: 'glob', arguments: '' },
                    },
                  ],
                  finish_reason: 'tool_calls',
                } as unknown as ChunkDelta,
              },
            ],
          },
        ])
      )
      .mockImplementationOnce(
        (
          messages: Array<{
            role: string;
            content?: unknown;
            tool_call_id?: string;
            tool_calls?: ToolCall[];
          }>
        ) => {
          const assistantToolCallMessage = messages.find(
            (message) => message.role === 'assistant' && Array.isArray(message.tool_calls)
          );
          const invalidToolCall = assistantToolCallMessage?.tool_calls?.find(
            (toolCall) => toolCall.id === toolCallId
          );
          const toolResultMessage = messages.find(
            (message) => message.role === 'tool' && message.tool_call_id === toolCallId
          );

          expect(toolResultMessage).toMatchObject({
            content: invalidToolOutput,
            tool_call_id: toolCallId,
          });

          if (invalidToolCall?.function.arguments === '') {
            throw new LLMBadRequestError(
              `400 Bad Request - invalid params, invalid function arguments json string, tool_call_id: ${toolCallId} (2013)`
            );
          }

          expect(invalidToolCall).toMatchObject({
            id: toolCallId,
            function: {
              name: 'glob',
              arguments: '{}',
            },
          });

          return toStream([
            {
              index: 0,
              choices: [{ index: 0, delta: { content: 'retry with valid args' } }],
            },
            {
              index: 0,
              choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
            },
          ]);
        }
      );
    manager.execute = vi.fn().mockResolvedValue({
      success: false,
      output: invalidToolOutput,
    });

    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      toolExecutionLedger: new InMemoryToolExecutionLedger(),
    });

    const events = await collectEvents(
      agent.runStream(createInput(), { onMessage: vi.fn(), onCheckpoint: vi.fn() })
    );

    expect(provider.generateStream).toHaveBeenCalledTimes(2);
    expect(events.some((event) => event.type === 'error')).toBe(false);
    expect(events.filter((event) => event.type === 'tool_result')).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      data: {
        finishReason: 'stop',
        steps: 2,
      },
    });
  });

  it('enforces llm timeout budget and emits timeout error event', async () => {
    vi.useFakeTimers();
    const provider = createProvider();
    const manager = createToolManager();

    provider.generateStream = vi
      .fn()
      .mockImplementation((_messages: unknown, _options?: { abortSignal?: AbortSignal }) =>
        (async function* () {
          await new Promise<void>((resolve) => setTimeout(resolve, 30));
          yield {
            index: 0,
            choices: [{ index: 0, delta: { content: 'late chunk' } }],
          } as Chunk;
          yield {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          } as Chunk;
        })()
      );

    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 1,
      timeoutBudgetMs: 20,
      llmTimeoutRatio: 1,
    });
    const eventsPromise = collectEvents(
      agent.runStream(
        {
          ...createInput(),
          maxSteps: 2,
        },
        { onMessage: vi.fn(), onCheckpoint: vi.fn() }
      )
    );

    await vi.advanceTimersByTimeAsync(40);
    const events = await eventsPromise;
    const errorEvent = events.find((event) => event.type === 'error');
    expect(errorEvent).toMatchObject({
      type: 'error',
      data: {
        errorCode: 'AGENT_TIMEOUT_BUDGET_EXCEEDED',
        category: 'timeout',
      },
    });

    const generateStreamCalls = (
      provider.generateStream as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    const callConfig = generateStreamCalls[0]?.[1] as { abortSignal?: AbortSignal };
    expect(callConfig.abortSignal).toBeDefined();
  });

  it('applies tool timeout budget through toolAbortSignal', async () => {
    vi.useFakeTimers();
    const provider = createProvider();
    const manager = createToolManager();

    provider.generateStream = vi
      .fn()
      .mockReturnValueOnce(
        toStream([
          {
            index: 0,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      id: 'tool_budget_1',
                      type: 'function',
                      index: 0,
                      function: { name: 'bash', arguments: '{"command":"sleep 1"}' },
                    },
                  ],
                  finish_reason: 'tool_calls',
                } as unknown as ChunkDelta,
              },
            ],
          },
        ])
      )
      .mockReturnValueOnce(
        toStream([
          {
            index: 0,
            choices: [{ index: 0, delta: { content: 'done' } }],
          },
          {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          },
        ])
      );

    manager.execute = vi.fn().mockImplementation(async (_toolCall, options) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      if (options.abortSignal?.aborted) {
        return {
          success: false,
          error: { message: 'tool stage budget exceeded' },
        };
      }
      return { success: true, output: 'ok' };
    });

    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 1,
      timeoutBudgetMs: 30,
      llmTimeoutRatio: 0.9,
    });

    const eventsPromise = collectEvents(
      agent.runStream(
        {
          ...createInput(),
          maxSteps: 4,
        },
        { onMessage: vi.fn(), onCheckpoint: vi.fn() }
      )
    );
    await vi.advanceTimersByTimeAsync(50);
    const events = await eventsPromise;

    const toolResult = events.find((event) => event.type === 'tool_result');
    expect(toolResult).toMatchObject({
      type: 'tool_result',
      data: {
        tool_call_id: 'tool_budget_1',
        content: 'Command failed: tool stage budget exceeded',
      },
    });
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      data: { finishReason: 'stop' },
    });
  });

  it('emits structured metrics, trace events, and log contexts for successful run', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: 'telemetry-ok' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const onMetric = vi.fn(async (_metric: AgentMetric) => undefined);
    const onTrace = vi.fn(async (_event: AgentTraceEvent) => undefined);
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3, logger });

    await collectEvents(
      agent.runStream(createInput(), {
        onMessage: vi.fn(),
        onCheckpoint: vi.fn(),
        onMetric,
        onTrace,
      })
    );

    expect(onMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'agent.llm.duration_ms',
        unit: 'ms',
        tags: expect.objectContaining({ executionId: 'exec_1', stepIndex: 1 }),
      })
    );
    expect(onMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'agent.run.duration_ms',
        unit: 'ms',
        tags: expect.objectContaining({ executionId: 'exec_1', outcome: 'done' }),
      })
    );

    const traceEvents = onTrace.mock.calls.map((call) => call[0] as AgentTraceEvent);
    expect(
      traceEvents.some(
        (event) =>
          event.name === 'agent.run' && event.phase === 'start' && event.traceId === 'exec_1'
      )
    ).toBe(true);
    expect(traceEvents.some((event) => event.name === 'agent.run' && event.phase === 'end')).toBe(
      true
    );

    const infoCalls = logger.info.mock.calls as Array<[string, Record<string, unknown>]>;
    expect(
      infoCalls.some(
        ([message, context]) => message === '[Agent] run.start' && context.executionId === 'exec_1'
      )
    ).toBe(true);
    expect(
      infoCalls.some(
        ([message, context]) =>
          message === '[Agent] run.finish' &&
          context.executionId === 'exec_1' &&
          typeof context.latencyMs === 'number'
      )
    ).toBe(true);
  });

  it('marks llm step metric success=false when llm stream throws unknown error', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockImplementation(() =>
      (async function* () {
        yield* [] as Chunk[];
        throw new Error('network interrupted');
      })()
    );

    const onMetric = vi.fn(async (_metric: AgentMetric) => undefined);
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const events = await collectEvents(
      agent.runStream(createInput(), {
        onMessage: vi.fn(),
        onCheckpoint: vi.fn(),
        onError: async () => ({ retry: false }),
        onMetric,
      })
    );

    expect(events.at(-1)).toMatchObject({
      type: 'error',
      data: { message: 'network interrupted' },
    });

    const llmMetric = onMetric.mock.calls
      .map((call) => call[0] as AgentMetric)
      .find((metric) => metric.name === 'agent.llm.duration_ms');
    expect(llmMetric).toBeDefined();
    expect(llmMetric?.tags?.success).toBe('false');
  });

  it('marks tool stage metric success=false when tool execution throws unknown error', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    id: 'tool_chaos_1',
                    type: 'function',
                    index: 0,
                    function: { name: 'bash', arguments: '{"command":"echo chaos"}' },
                  },
                ],
                finish_reason: 'tool_calls',
              } as unknown as ChunkDelta,
            },
          ],
        },
      ])
    );
    manager.execute = vi.fn().mockRejectedValue(new Error('tool crashed'));

    const onMetric = vi.fn(async (_metric: AgentMetric) => undefined);
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const events = await collectEvents(
      agent.runStream(createInput(), {
        onMessage: vi.fn(),
        onCheckpoint: vi.fn(),
        onError: async () => ({ retry: false }),
        onMetric,
      })
    );

    expect(events.at(-1)).toMatchObject({
      type: 'error',
      data: { message: 'tool crashed' },
    });

    const toolStageMetric = onMetric.mock.calls
      .map((call) => call[0] as AgentMetric)
      .find((metric) => metric.name === 'agent.tool.stage.duration_ms');
    expect(toolStageMetric).toBeDefined();
    expect(toolStageMetric?.tags?.success).toBe('false');
  });

  it('stops immediately when abortSignal is already aborted', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn();

    const controller = new AbortController();
    controller.abort();

    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const events = await collectEvents(
      agent.runStream(
        {
          ...createInput(),
          abortSignal: controller.signal,
        },
        { onMessage: vi.fn(), onCheckpoint: vi.fn() }
      )
    );

    expect(events.map((event) => event.type)).toEqual(['error']);
    expect(events[0]).toMatchObject({
      type: 'error',
      data: {
        name: 'AgentAbortedError',
        code: 1002,
        errorCode: 'AGENT_ABORTED',
        category: 'abort',
        retryable: false,
        httpStatus: 499,
        message: 'Operation aborted',
      },
    });
    expect(provider.generateStream).not.toHaveBeenCalled();
  });

  it('isolates message state across concurrent runs on the same instance', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockImplementation((messages: Array<{ content: string }>) => {
      const marker = messages[0]?.content || 'unknown';
      return toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: `reply:${marker}` } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ]);
    });

    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const onMessageA = vi.fn();
    const onMessageB = vi.fn();

    await Promise.all([
      collectEvents(
        agent.runStream(
          {
            ...createInput(),
            executionId: 'exec_A',
            messages: [
              {
                messageId: 'a1',
                type: 'user',
                role: 'user',
                content: 'A',
                timestamp: 1,
              },
            ],
          },
          { onMessage: onMessageA, onCheckpoint: vi.fn() }
        )
      ),
      collectEvents(
        agent.runStream(
          {
            ...createInput(),
            executionId: 'exec_B',
            messages: [
              {
                messageId: 'b1',
                type: 'user',
                role: 'user',
                content: 'B',
                timestamp: 2,
              },
            ],
          },
          { onMessage: onMessageB, onCheckpoint: vi.fn() }
        )
      ),
    ]);

    const calledUserContents = (
      provider.generateStream as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls
      .map((call) => (call[0] as Array<{ content: string }>)?.[0]?.content ?? '')
      .sort();
    expect(calledUserContents).toEqual(['A', 'B']);
    expect(onMessageA.mock.calls[0]?.[0]).toMatchObject({ content: 'reply:A' });
    expect(onMessageB.mock.calls[0]?.[0]).toMatchObject({ content: 'reply:B' });
  });

  it('calls compact when needsCompaction is true and uses compacted messages for llm', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: 'ok' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    const compactSpy = vi.spyOn(compactionModule, 'compact').mockResolvedValue({
      messages: [
        {
          messageId: 'cmp_1',
          type: 'user',
          role: 'user',
          content: 'compacted input',
          timestamp: 1,
        },
      ],
      removedMessageIds: ['u1'],
      diagnostics: {
        outcome: 'applied',
        reason: 'summary_created',
        promptVersion: 'v1',
        pendingMessageCount: 1,
        activeMessageCount: 0,
        previousSummaryPresent: false,
        trimmedPendingMessageCount: 0,
        estimatedInputTokens: 10,
        inputTokenBudget: 100,
        summaryMaxTokens: 100,
      },
    });

    const onCompaction = vi.fn();
    const agent = new StatelessAgent(provider, manager, {
      enableCompaction: true,
      compactionTriggerRatio: 0,
      logger,
    });
    const events = await collectEvents(
      agent.runStream(createInput(), { onMessage: vi.fn(), onCheckpoint: vi.fn(), onCompaction })
    );

    expect(compactSpy).toHaveBeenCalledOnce();
    expect(compactSpy.mock.calls[0]?.[1]).toMatchObject({
      keepMessagesNum: 0,
      promptVersion: 'v1',
    });
    const firstCallArgs = (provider.generateStream as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0];
    const llmMessages = firstCallArgs?.[0] as Array<{ content: string }>;
    expect(llmMessages[0]?.content).toBe('compacted input');
    expect(events.some((event) => event.type === 'compaction')).toBe(true);
    expect(onCompaction).toHaveBeenCalledOnce();
    expect(onCompaction.mock.calls[0]?.[0] as CompactionInfo).toMatchObject({
      executionId: 'exec_1',
      stepIndex: 1,
      removedMessageIds: ['u1'],
      messageCountBefore: 1,
      messageCountAfter: 1,
    });
    expect(logger.info).toHaveBeenCalledWith(
      '[Agent] compaction.applied',
      expect.objectContaining({
        reason: 'summary_created',
        promptVersion: 'v1',
        removedMessageCount: 1,
      }),
      undefined
    );
    compactSpy.mockRestore();
  });

  it('passes compaction prompt version through agent config', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: 'ok' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    const compactSpy = vi.spyOn(compactionModule, 'compact').mockResolvedValue({
      messages: [
        {
          messageId: 'cmp_1',
          type: 'summary',
          role: 'user',
          content: 'compacted input',
          timestamp: 1,
        },
      ],
      removedMessageIds: ['u1'],
      diagnostics: {
        outcome: 'applied',
        reason: 'summary_created',
        promptVersion: 'v2',
        pendingMessageCount: 1,
        activeMessageCount: 0,
        previousSummaryPresent: false,
        trimmedPendingMessageCount: 0,
        estimatedInputTokens: 10,
        inputTokenBudget: 100,
        summaryMaxTokens: 100,
      },
    });

    const agent = new StatelessAgent(provider, manager, {
      enableCompaction: true,
      compactionTriggerRatio: 0,
      compactionPromptVersion: 'v2',
    });

    await collectEvents(
      agent.runStream(createInput(), { onMessage: vi.fn(), onCheckpoint: vi.fn() })
    );

    expect(compactSpy).toHaveBeenCalledOnce();
    expect(compactSpy.mock.calls[0]?.[1]).toMatchObject({
      promptVersion: 'v2',
    });
    compactSpy.mockRestore();
  });

  it('continues execution when compaction throws error', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: 'still works' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    const compactSpy = vi.spyOn(compactionModule, 'compact').mockRejectedValue(
      new compactionModule.CompactionError(
        'Compaction summary generation returned invalid response',
        'invalid_response',
        {
          promptVersion: 'v1',
          pendingMessageCount: 2,
          activeMessageCount: 1,
          previousSummaryPresent: false,
          trimmedPendingMessageCount: 0,
          estimatedInputTokens: 100,
          inputTokenBudget: 200,
          summaryMaxTokens: 100,
        }
      )
    );
    const logger = { error: vi.fn() };

    const agent = new StatelessAgent(provider, manager, {
      enableCompaction: true,
      compactionTriggerRatio: 0,
      logger,
    });
    const events = await collectEvents(
      agent.runStream(createInput(), { onMessage: vi.fn(), onCheckpoint: vi.fn() })
    );

    expect(compactSpy).toHaveBeenCalledOnce();
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      data: { finishReason: 'stop', steps: 1 },
    });
    expect(logger.error).toHaveBeenCalledWith(
      '[Agent] compaction.failed',
      expect.objectContaining({
        name: 'CompactionError',
        reason: 'invalid_response',
      }),
      expect.objectContaining({
        reason: 'invalid_response',
        promptVersion: 'v1',
        pendingMessageCount: 2,
      })
    );
    compactSpy.mockRestore();
  });

  it('processes tool calls, emits checkpoint, and continues to next step', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi
      .fn()
      .mockReturnValueOnce(
        toStream([
          {
            index: 0,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      id: 'call_1',
                      type: 'function',
                      index: 0,
                      function: { name: 'bash', arguments: '{"a":' },
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
                      id: 'call_1',
                      type: 'function',
                      index: 0,
                      function: { name: 'bash', arguments: '1}' },
                    },
                  ],
                  finish_reason: 'tool_calls',
                } as unknown as ChunkDelta,
              },
            ],
          },
        ])
      )
      .mockReturnValueOnce(
        toStream([
          {
            index: 0,
            choices: [{ index: 0, delta: { content: 'final' } }],
          },
          {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          },
        ])
      );

    manager.execute = vi.fn().mockImplementation(async (_toolCall, options) => {
      await options.onStreamEvent?.({ type: 'stdout', message: 'streamed' });
      const decision = await options.onApproval?.({
        toolName: 'bash',
        toolCallId: 'call_1',
        reason: 'run bash',
      });
      expect(decision).toEqual({ approved: true, scope: 'once', reason: 'ok' });
      return { success: true, output: 'tool-output' };
    });

    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const onMessage = vi.fn();
    const onCheckpoint = vi.fn();
    const toolChunkSpy = vi.fn();
    agent.on('tool_chunk', toolChunkSpy);
    agent.on(
      'tool_confirm',
      (info: { resolve: (decision: { approved: boolean; message?: string }) => void }) => {
        info.resolve({ approved: true, message: 'ok' });
      }
    );

    const events = await collectEvents(agent.runStream(createInput(), { onMessage, onCheckpoint }));

    expect(events.some((event) => event.type === 'tool_call')).toBe(true);
    expect(events.some((event) => event.type === 'tool_result')).toBe(true);
    expect(events.some((event) => event.type === 'checkpoint')).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      data: { finishReason: 'stop', steps: 2 },
    });
    expect(onMessage).toHaveBeenCalledTimes(3);
    expect(onCheckpoint).toHaveBeenCalledTimes(1);
    expect(toolChunkSpy).toHaveBeenCalledTimes(1);
    expect(manager.execute).toHaveBeenCalledTimes(1);
  });

  it('adds write buffer info to tool result when write_file arguments are truncated', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    id: 'wf_call_1',
                    type: 'function',
                    index: 0,
                    function: {
                      name: 'write_file',
                      arguments: '{"path":"a.txt","content":"partial',
                    },
                  },
                ],
                finish_reason: 'tool_calls',
              } as unknown as ChunkDelta,
            },
          ],
        },
      ])
    );

    manager.execute = vi.fn().mockResolvedValue({
      success: false,
      error: {
        name: 'ToolV2ArgumentsError',
        message: 'Invalid arguments for write_file: JSON Parse error: Unterminated string',
      },
    });

    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const events = await collectEvents(
      agent.runStream(
        {
          ...createInput(),
          maxSteps: 1,
        },
        { onMessage: vi.fn(), onCheckpoint: vi.fn() }
      )
    );

    const toolResultEvent = events.find((event) => event.type === 'tool_result');
    expect(toolResultEvent).toBeDefined();
    const toolResultContent = (toolResultEvent?.data as Message).content as string;
    const payload = JSON.parse(toolResultContent) as {
      ok: boolean;
      code: string;
      message: string;
      buffer?: { bufferId: string };
      nextAction: string;
    };
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe('WRITE_FILE_PARTIAL_BUFFERED');
    expect(payload.message).toContain(
      'Invalid arguments for write_file: JSON Parse error: Unterminated string'
    );
    expect(payload.buffer?.bufferId).toBe('wf_call_1');
    expect(payload.nextAction).toBe('finalize');

    const writeBufferCacheDir = path.resolve(process.cwd(), '.renx', 'write-file');
    const cacheEntries = await fs.readdir(writeBufferCacheDir).catch(() => []);
    await Promise.all(
      cacheEntries
        .filter((entry) => entry.includes('_wf_call_1_'))
        .map((entry) => fs.rm(path.join(writeBufferCacheDir, entry), { force: true }))
    );
  });

  it('auto-finalizes an oversized streamed write_file direct call in one llm turn', async () => {
    const provider = createProvider();

    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-index-write-e2e-'));
    const bufferDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-index-write-buffer-'));
    const targetPath = path.join(allowedDir, 'streamed-write.txt');
    const fullContent = 'abcdefghijklmnop';

    try {
      const manager = createEnterpriseToolExecutor(
        [
          new WriteFileToolV2({
            bufferBaseDir: bufferDir,
            maxChunkBytes: 8,
          }),
        ],
        {
          workingDirectory: allowedDir,
        }
      );

      const buildToolCallStream = (toolCallId: string, args: Record<string, unknown>) => {
        const raw = JSON.stringify(args);
        const cut = Math.max(1, Math.floor(raw.length / 2));
        return toStream([
          {
            index: 0,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      id: toolCallId,
                      type: 'function',
                      index: 0,
                      function: { name: 'write_file', arguments: raw.slice(0, cut) },
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
                      id: toolCallId,
                      type: 'function',
                      index: 0,
                      function: { name: 'write_file', arguments: raw.slice(cut) },
                    },
                  ],
                  finish_reason: 'tool_calls',
                } as unknown as ChunkDelta,
              },
            ],
          },
        ]);
      };

      provider.generateStream = vi
        .fn()
        .mockReturnValueOnce(
          buildToolCallStream('wf_direct_1', {
            path: targetPath,
            mode: 'direct',
            content: fullContent,
          })
        )
        .mockReturnValueOnce(
          toStream([
            {
              index: 0,
              choices: [{ index: 0, delta: { content: 'done' } }],
            },
            {
              index: 0,
              choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
            },
          ])
        );

      const agent = new StatelessAgent(provider, manager as unknown as AgentToolExecutor, {
        maxRetryCount: 3,
      });
      const events = await collectEvents(
        agent.runStream(
          {
            ...createInput(),
            maxSteps: 6,
          },
          { onMessage: vi.fn(), onCheckpoint: vi.fn() }
        )
      );

      const toolResults = events.filter((event) => event.type === 'tool_result');
      expect(toolResults).toHaveLength(1);

      const payloads = toolResults.map(
        (event) =>
          JSON.parse((event.data as Message).content as string) as {
            code: string;
            nextAction: string;
          }
      );
      expect(payloads.map((payload) => payload.code)).toEqual(['WRITE_FILE_FINALIZE_OK']);
      expect(payloads.map((payload) => payload.nextAction)).toEqual(['none']);
      expect(events.at(-1)).toMatchObject({
        type: 'done',
        data: { finishReason: 'stop' },
      });

      expect(await fs.readFile(targetPath, 'utf8')).toBe(fullContent);
    } finally {
      await fs.rm(allowedDir, { recursive: true, force: true });
      await fs.rm(bufferDir, { recursive: true, force: true });
    }
  });

  it('keeps oversized streamed write_file direct calls self-contained without a second finalize turn', async () => {
    const provider = createProvider();

    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-index-finalize-id-'));
    const bufferDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-index-finalize-buffer-'));
    const targetPath = path.join(allowedDir, 'streamed-finalize-by-id.txt');
    const fullContent = 'abcdefghijklmnop';

    try {
      const manager = createEnterpriseToolExecutor(
        [
          new WriteFileToolV2({
            bufferBaseDir: bufferDir,
            maxChunkBytes: 8,
          }),
        ],
        {
          workingDirectory: allowedDir,
        }
      );

      const buildToolCallStream = (toolCallId: string, args: Record<string, unknown>) => {
        const raw = JSON.stringify(args);
        const cut = Math.max(1, Math.floor(raw.length / 2));
        return toStream([
          {
            index: 0,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      id: toolCallId,
                      type: 'function',
                      index: 0,
                      function: { name: 'write_file', arguments: raw.slice(0, cut) },
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
                      id: toolCallId,
                      type: 'function',
                      index: 0,
                      function: { name: 'write_file', arguments: raw.slice(cut) },
                    },
                  ],
                  finish_reason: 'tool_calls',
                } as unknown as ChunkDelta,
              },
            ],
          },
        ]);
      };

      provider.generateStream = vi
        .fn()
        .mockReturnValueOnce(
          buildToolCallStream('wf_direct_finalize_id_1', {
            path: targetPath,
            mode: 'direct',
            content: fullContent,
          })
        )
        .mockReturnValueOnce(
          toStream([
            {
              index: 0,
              choices: [{ index: 0, delta: { content: 'done' } }],
            },
            {
              index: 0,
              choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
            },
          ])
        );

      const agent = new StatelessAgent(provider, manager as unknown as AgentToolExecutor, {
        maxRetryCount: 3,
      });
      const events = await collectEvents(
        agent.runStream(
          {
            ...createInput(),
            maxSteps: 5,
          },
          { onMessage: vi.fn(), onCheckpoint: vi.fn() }
        )
      );

      const toolResults = events.filter((event) => event.type === 'tool_result');
      expect(toolResults).toHaveLength(1);

      const payloads = toolResults.map(
        (event) =>
          JSON.parse((event.data as Message).content as string) as {
            code: string;
            nextAction: string;
          }
      );
      expect(payloads.map((payload) => payload.code)).toEqual(['WRITE_FILE_FINALIZE_OK']);
      expect(payloads.map((payload) => payload.nextAction)).toEqual(['none']);
      expect(await fs.readFile(targetPath, 'utf8')).toBe(fullContent);
    } finally {
      await fs.rm(allowedDir, { recursive: true, force: true });
      await fs.rm(bufferDir, { recursive: true, force: true });
    }
  });

  it('yields error and stops when retry decision is false', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockImplementation(() =>
      (async function* () {
        for (const chunk of [] as Chunk[]) {
          yield chunk;
        }
        throw new Error('llm failed');
      })()
    );

    const onError = vi.fn().mockResolvedValue({ retry: false });
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const events = await collectEvents(
      agent.runStream(createInput(), { onMessage: vi.fn(), onCheckpoint: vi.fn(), onError })
    );

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(AgentError);
    expect(events.map((e) => e.type)).toEqual(['progress', 'error']);
    expect(events[1]).toMatchObject({
      type: 'error',
      data: {
        name: 'UnknownError',
        code: 1005,
        errorCode: 'AGENT_UNKNOWN_ERROR',
        category: 'internal',
        retryable: false,
        httpStatus: 500,
        message: 'llm failed',
      },
    });
  });

  it('retries after onError decision and succeeds on later attempt', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi
      .fn()
      .mockImplementationOnce(() =>
        (async function* () {
          for (const chunk of [] as Chunk[]) {
            yield chunk;
          }
          throw new Error('temporary');
        })()
      )
      .mockReturnValueOnce(
        toStream([
          {
            index: 0,
            choices: [{ index: 0, delta: { content: 'ok' } }],
          },
          {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          },
        ])
      );

    const onError = vi.fn().mockResolvedValue({ retry: true });
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      backoffConfig: { initialDelayMs: 1, maxDelayMs: 1, base: 2, jitter: false },
    });
    const events = await collectEvents(
      agent.runStream(createInput(), { onMessage: vi.fn(), onCheckpoint: vi.fn(), onError })
    );

    expect(onError).toHaveBeenCalledOnce();
    expect(events.map((e) => e.type)).toEqual(['progress', 'error', 'progress', 'chunk', 'done']);
  });

  it('retries retryable upstream errors by default when onError does not provide a decision', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi
      .fn()
      .mockImplementationOnce(() =>
        (async function* () {
          for (const chunk of [] as Chunk[]) {
            yield chunk;
          }
          throw new LLMRetryableError(
            '500 Internal Server Error - 操作失败',
            undefined,
            'SERVER_500'
          );
        })()
      )
      .mockReturnValueOnce(
        toStream([
          {
            index: 0,
            choices: [{ index: 0, delta: { content: 'ok-after-retry' } }],
          },
          {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          },
        ])
      );

    const onError = vi.fn().mockResolvedValue(undefined);
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      backoffConfig: { initialDelayMs: 1, maxDelayMs: 1, base: 2, jitter: false },
    });
    const events = await collectEvents(
      agent.runStream(createInput(), { onMessage: vi.fn(), onCheckpoint: vi.fn(), onError })
    );

    expect(onError).toHaveBeenCalledOnce();
    expect(events.map((e) => e.type)).toEqual(['progress', 'error', 'progress', 'chunk', 'done']);
    expect(events[1]).toMatchObject({
      type: 'error',
      data: {
        name: 'AgentUpstreamServerError',
        errorCode: 'AGENT_UPSTREAM_SERVER',
        retryable: true,
      },
    });
  });

  it('stops with max-retries when retryable upstream errors keep failing', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockImplementation(() =>
      (async function* () {
        for (const chunk of [] as Chunk[]) {
          yield chunk;
        }
        throw new LLMRetryableError('upstream 500', undefined, 'SERVER_500');
      })()
    );

    const onError = vi.fn().mockResolvedValue(undefined);
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 2,
      backoffConfig: { initialDelayMs: 1, maxDelayMs: 1, base: 2, jitter: false },
    });
    const events = await collectEvents(
      agent.runStream(createInput(), { onMessage: vi.fn(), onCheckpoint: vi.fn(), onError })
    );

    expect(onError).toHaveBeenCalledTimes(2);
    expect(provider.generateStream).toHaveBeenCalledTimes(2);
    expect(events.map((event) => event.type)).toEqual([
      'progress',
      'error',
      'progress',
      'error',
      'error',
    ]);
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      data: {
        name: 'MaxRetriesError',
        errorCode: 'AGENT_MAX_RETRIES_REACHED',
      },
    });
  });

  it('stops immediately for non-retryable upstream errors when onError has no decision', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockImplementation(() =>
      (async function* () {
        for (const chunk of [] as Chunk[]) {
          yield chunk;
        }
        throw new LLMAuthError('Invalid API key');
      })()
    );

    const onError = vi.fn().mockResolvedValue(undefined);
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const events = await collectEvents(
      agent.runStream(createInput(), { onMessage: vi.fn(), onCheckpoint: vi.fn(), onError })
    );

    expect(onError).toHaveBeenCalledOnce();
    expect(provider.generateStream).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.type)).toEqual(['progress', 'error']);
    expect(events[1]).toMatchObject({
      type: 'error',
      data: {
        name: 'AgentUpstreamAuthError',
        errorCode: 'AGENT_UPSTREAM_AUTH',
        retryable: false,
      },
    });
  });

  it('does not leak retry state across separate executions on the same instance', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi
      .fn()
      .mockImplementationOnce(() =>
        (async function* () {
          for (const chunk of [] as Chunk[]) {
            yield chunk;
          }
          throw new Error('first run fail');
        })()
      )
      .mockReturnValueOnce(
        toStream([
          {
            index: 0,
            choices: [{ index: 0, delta: { content: 'second run ok' } }],
          },
          {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          },
        ])
      );

    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 1,
      backoffConfig: { initialDelayMs: 1, maxDelayMs: 1, base: 2, jitter: false },
    });
    const run1Events = await collectEvents(
      agent.runStream(createInput(), {
        onMessage: vi.fn(),
        onCheckpoint: vi.fn(),
        onError: async () => ({ retry: true }),
      })
    );
    const run2Events = await collectEvents(
      agent.runStream(createInput(), {
        onMessage: vi.fn(),
        onCheckpoint: vi.fn(),
      })
    );

    expect(run1Events.map((event) => event.type)).toEqual(['progress', 'error', 'error']);
    expect(run2Events.at(-1)).toMatchObject({
      type: 'done',
      data: { finishReason: 'stop', steps: 1 },
    });
    expect(provider.generateStream).toHaveBeenCalledTimes(2);
  });

  it('stops when local retry attempts reach maxRetryCount', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockImplementation(() =>
      (async function* () {
        for (const chunk of [] as Chunk[]) {
          yield chunk;
        }
        throw new Error('always fail');
      })()
    );
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 1 });
    const events = await collectEvents(
      agent.runStream(createInput(), {
        onMessage: vi.fn(),
        onCheckpoint: vi.fn(),
        onError: async () => ({ retry: true }),
      })
    );

    expect(events.map((event) => event.type)).toEqual(['progress', 'error', 'error']);
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      data: { message: 'Max retries reached' },
    });
    expect(provider.generateStream).toHaveBeenCalledTimes(1);
  });

  it('waits for backoff delay before retrying llm call', async () => {
    vi.useFakeTimers();
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi
      .fn()
      .mockImplementationOnce(() =>
        (async function* () {
          for (const chunk of [] as Chunk[]) {
            yield chunk;
          }
          throw new Error('temporary');
        })()
      )
      .mockReturnValueOnce(
        toStream([
          {
            index: 0,
            choices: [{ index: 0, delta: { content: 'ok' } }],
          },
          {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          },
        ])
      );

    const onError = vi.fn().mockResolvedValue({ retry: true });
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      backoffConfig: { initialDelayMs: 20, maxDelayMs: 20, base: 2, jitter: false },
    });

    const eventsPromise = collectEvents(
      agent.runStream(createInput(), { onMessage: vi.fn(), onCheckpoint: vi.fn(), onError })
    );

    await vi.advanceTimersByTimeAsync(19);
    expect(provider.generateStream).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    const events = await eventsPromise;

    expect(provider.generateStream).toHaveBeenCalledTimes(2);
    expect(events.map((e) => e.type)).toEqual(['progress', 'error', 'progress', 'chunk', 'done']);
  });

  it('yields aborted error when llm stream throws AbortError', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockImplementation(() =>
      (async function* () {
        for (const chunk of [] as Chunk[]) {
          yield chunk;
        }
        throw Object.assign(new Error('Operation aborted'), { name: 'AbortError' });
      })()
    );

    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const events = await collectEvents(
      agent.runStream(createInput(), {
        onMessage: vi.fn(),
        onCheckpoint: vi.fn(),
        onError: vi.fn(),
      })
    );

    expect(events.map((event) => event.type)).toEqual(['progress', 'error']);
    expect(events[1]).toMatchObject({
      type: 'error',
      data: { name: 'AgentAbortedError', message: 'Operation aborted' },
    });
  });

  it('stops retry sleep with aborted error when signal aborts during backoff', async () => {
    vi.useFakeTimers();
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockImplementation(() =>
      (async function* () {
        for (const chunk of [] as Chunk[]) {
          yield chunk;
        }
        throw new Error('temporary');
      })()
    );

    const controller = new AbortController();
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      backoffConfig: { initialDelayMs: 100, maxDelayMs: 100, base: 2, jitter: false },
    });

    const eventsPromise = collectEvents(
      agent.runStream(
        { ...createInput(), abortSignal: controller.signal },
        { onMessage: vi.fn(), onCheckpoint: vi.fn(), onError: async () => ({ retry: true }) }
      )
    );

    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    const events = await eventsPromise;

    expect(events.at(-1)).toMatchObject({
      type: 'error',
      data: { name: 'AgentAbortedError', message: 'Operation aborted' },
    });
  });

  it('rethrows non-abort sleep errors during retry delay', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockImplementation(() =>
      (async function* () {
        for (const chunk of [] as Chunk[]) {
          yield chunk;
        }
        throw new Error('temporary');
      })()
    );

    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    (agent as unknown as { sleep: (ms: number, signal?: AbortSignal) => Promise<void> }).sleep = vi
      .fn()
      .mockRejectedValue(new Error('sleep crash'));

    await expect(
      collectEvents(
        agent.runStream(createInput(), {
          onMessage: vi.fn(),
          onCheckpoint: vi.fn(),
          onError: async () => ({ retry: true }),
        })
      )
    ).rejects.toThrow('sleep crash');
  });
});
