import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Chunk, LLMProvider } from '../../../providers';
import { LLMRateLimitError } from '../../../providers';
import { LLMRetryableError } from '../../../providers';
import { StatelessAgent } from '../../agent';
import type { AgentToolExecutor } from '../../agent/tool-executor';
import { AgentAppService } from '../agent-app-service';
import { SqliteAgentAppStore } from '../sqlite-agent-app-store';
import { EnterpriseToolExecutor } from '../../tool-v2/agent-tool-executor';
import { EnterpriseToolSystem } from '../../tool-v2/tool-system';
import { WriteFileToolV2 } from '../../tool-v2/handlers/write-file';

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

function createProvider(): LLMProvider {
  return {
    config: {} as Record<string, unknown>,
    generate: vi.fn(),
    generateStream: vi.fn(),
    getTimeTimeout: vi.fn(() => 1000),
    getLLMMaxTokens: vi.fn(() => 32000),
    getMaxOutputTokens: vi.fn(() => 4096),
  } as unknown as LLMProvider;
}

function createToolManager(): AgentToolExecutor {
  return {
    execute: vi.fn(),
    registerTool: vi.fn(),
    registerTools: vi.fn(),
    getTools: vi.fn(() => []),
    getToolSchemas: vi.fn(() => []),
    getConcurrencyPolicy: vi.fn(() => ({ mode: 'exclusive' as const })),
  } as unknown as AgentToolExecutor;
}

function createEnterpriseToolExecutor(options: {
  workingDirectory: string;
  bufferBaseDir: string;
  maxChunkBytes: number;
}): AgentToolExecutor {
  return new EnterpriseToolExecutor({
    system: new EnterpriseToolSystem([
      new WriteFileToolV2({
        bufferBaseDir: options.bufferBaseDir,
        maxChunkBytes: options.maxChunkBytes,
      }),
    ]),
    workingDirectory: options.workingDirectory,
    approvalPolicy: 'unless-trusted',
    trustLevel: 'trusted',
  });
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRunStatus(
  app: AgentAppService,
  executionId: string,
  status: 'CREATED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED',
  timeoutMs = 1000
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const run = await app.getRun(executionId);
    if (run?.status === status) {
      return;
    }
    await delay(10);
  }
  throw new Error(`Timed out waiting for run ${executionId} to reach status ${status}`);
}

describe('AgentAppService', () => {
  let tempDir: string | null = null;
  let store: SqliteAgentAppStore | null = null;

  afterEach(async () => {
    if (store) {
      await store.close();
      store = null;
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('persists run/events and supports getRun/listRuns queries', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: 'Hello from app service' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-app-service-'));
    store = new SqliteAgentAppStore(path.join(tempDir, 'agent.db'));
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 2,
      backoffConfig: { initialDelayMs: 1, maxDelayMs: 1, base: 2, jitter: false },
    });
    const app = new AgentAppService({
      agent,
      executionStore: store,
      eventStore: store,
      messageStore: store,
    });

    const result = await app.runForeground({
      conversationId: 'conv_service',
      executionId: 'exec_service',
      userInput: 'Say hello',
      maxSteps: 3,
    });

    expect(result.executionId).toBe('exec_service');
    expect(result.finishReason).toBe('stop');
    expect(result.run.status).toBe('COMPLETED');
    expect(result.run.terminalReason).toBe('stop');
    expect(result.events.some((event) => event.eventType === 'user_message')).toBe(true);
    expect(result.events.some((event) => event.eventType === 'assistant_message')).toBe(true);
    expect(result.events.some((event) => event.eventType === 'done')).toBe(true);

    const run = await app.getRun('exec_service');
    expect(run?.status).toBe('COMPLETED');

    const list = await app.listRuns('conv_service', { limit: 10 });
    expect(list.items).toHaveLength(1);
    expect(list.items[0].executionId).toBe('exec_service');

    const messages = await store.list('conv_service');
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);

    const contextMessages = await app.listContextMessages('conv_service');
    expect(contextMessages.map((message) => message.role)).toEqual(['user', 'assistant']);

    const dropped = await app.listDroppedMessages('exec_service');
    expect(dropped).toHaveLength(0);

    const traces = result.events.filter((event) => event.eventType === 'trace');
    const metrics = result.events.filter((event) => event.eventType === 'metric');
    const runLogEvents = result.events.filter((event) => event.eventType === 'run_log');
    const runLogs = await app.listRunLogs('exec_service');
    expect(traces.length).toBeGreaterThan(0);
    expect(metrics.length).toBeGreaterThan(0);
    expect(runLogEvents.length).toBeGreaterThan(0);
    expect(runLogs.length).toBeGreaterThan(0);
    expect(runLogs.some((log) => log.message.includes('run.start'))).toBe(true);
  });

  it('inserts bootstrap user messages once before the real user input', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockImplementation(() =>
      toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: 'Hello from bootstrap run' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-app-service-bootstrap-'));
    store = new SqliteAgentAppStore(path.join(tempDir, 'agent.db'));
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 2,
      backoffConfig: { initialDelayMs: 1, maxDelayMs: 1, base: 2, jitter: false },
    });
    const app = new AgentAppService({
      agent,
      executionStore: store,
      eventStore: store,
      messageStore: store,
    });

    const bootstrapMessage = {
      messageId: 'msg_bootstrap_1',
      type: 'user' as const,
      role: 'user' as const,
      content: 'Available skills:\n- skill-creator: Create skills.',
      timestamp: 1,
      metadata: {
        bootstrap: true,
        bootstrapKey: 'available-skills-v1',
        preserveInContext: true,
        fixedPosition: 'after-system',
      },
    };

    await app.runForeground({
      conversationId: 'conv_bootstrap',
      executionId: 'exec_bootstrap_1',
      userInput: 'First prompt',
      bootstrapMessages: [bootstrapMessage],
      maxSteps: 3,
    });

    await app.runForeground({
      conversationId: 'conv_bootstrap',
      executionId: 'exec_bootstrap_2',
      userInput: 'Second prompt',
      historyMessages: await app.listContextMessages('conv_bootstrap'),
      bootstrapMessages: [bootstrapMessage],
      maxSteps: 3,
    });

    const historyMessages = await store.list('conv_bootstrap');
    expect(historyMessages.map((message) => message.role)).toEqual([
      'user',
      'user',
      'assistant',
      'user',
      'assistant',
    ]);
    expect(
      historyMessages.filter((message) => message.messageId === 'msg_bootstrap_1')
    ).toHaveLength(1);

    const firstRunEvents = await app.listRunEvents('exec_bootstrap_1');
    expect(
      firstRunEvents
        .filter((event) => event.eventType === 'user_message')
        .map((event) => (event.data as { message?: { messageId?: string } }).message?.messageId)
    ).toEqual(['msg_bootstrap_1', expect.stringMatching(/^msg_usr_/)]);
  });

  it('emits usage callback with cumulative totals and agent-calculated context usage', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: 'usage-demo' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
        {
          index: 0,
          choices: [],
          usage: {
            prompt_tokens: 120,
            completion_tokens: 30,
            total_tokens: 150,
            prompt_cache_hit_tokens: 80,
            prompt_cache_miss_tokens: 40,
            input_tokens_details: {
              cached_tokens: 80,
            },
          },
        },
      ])
    );

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-app-service-usage-'));
    store = new SqliteAgentAppStore(path.join(tempDir, 'agent.db'));
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 2,
      backoffConfig: { initialDelayMs: 1, maxDelayMs: 1, base: 2, jitter: false },
    });
    const app = new AgentAppService({
      agent,
      executionStore: store,
      eventStore: store,
      messageStore: store,
    });

    const usageEvents: Array<{
      sequence: number;
      stepIndex: number;
      usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        prompt_cache_hit_tokens?: number;
        prompt_cache_miss_tokens?: number;
        input_tokens_details?: {
          cached_tokens: number;
        };
      };
      cumulativeUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      contextTokens?: number;
      contextLimitTokens?: number;
      contextUsagePercent?: number;
    }> = [];

    const result = await app.runForeground(
      {
        conversationId: 'conv_usage',
        executionId: 'exec_usage',
        userInput: 'Show usage',
        maxSteps: 3,
      },
      {
        onUsage: (usage) => {
          usageEvents.push({
            sequence: usage.sequence,
            stepIndex: usage.stepIndex,
            usage: usage.usage,
            cumulativeUsage: usage.cumulativeUsage,
            contextTokens: usage.contextTokens,
            contextLimitTokens: usage.contextLimitTokens,
            contextUsagePercent: usage.contextUsagePercent,
          });
        },
      }
    );

    const expectedContextUsage = agent.estimateContextUsage([
      {
        messageId: 'msg_expected_user',
        type: 'user',
        role: 'user',
        content: 'Show usage',
        timestamp: Date.now(),
      },
    ]);

    expect(result.finishReason).toBe('stop');
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]?.sequence).toBe(1);
    expect(usageEvents[0]?.usage).toEqual({
      prompt_tokens: 120,
      completion_tokens: 30,
      total_tokens: 150,
      prompt_cache_hit_tokens: 80,
      prompt_cache_miss_tokens: 40,
      input_tokens_details: {
        cached_tokens: 80,
      },
    });
    expect(usageEvents[0]?.cumulativeUsage).toEqual({
      prompt_tokens: 120,
      completion_tokens: 30,
      total_tokens: 150,
    });
    expect(usageEvents[0]?.contextTokens).toBe(expectedContextUsage.contextTokens);
    expect(usageEvents[0]?.contextLimitTokens).toBe(expectedContextUsage.contextLimitTokens);
    expect(usageEvents[0]?.contextUsagePercent).toBeCloseTo(
      expectedContextUsage.contextUsagePercent,
      6
    );

    const storedMessages = await store.list('conv_usage');
    expect(storedMessages.at(-1)?.usage).toEqual({
      prompt_tokens: 120,
      completion_tokens: 30,
      total_tokens: 150,
      prompt_cache_hit_tokens: 80,
      prompt_cache_miss_tokens: 40,
      input_tokens_details: {
        cached_tokens: 80,
      },
    });
  });

  it('forwards onContextUsage immediately before usage events', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: 'context-demo' } }],
          usage: {
            prompt_tokens: 42,
            completion_tokens: 8,
            total_tokens: 50,
          },
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-app-service-context-'));
    store = new SqliteAgentAppStore(path.join(tempDir, 'agent.db'));
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 2,
      backoffConfig: { initialDelayMs: 1, maxDelayMs: 1, base: 2, jitter: false },
    });
    const app = new AgentAppService({
      agent,
      executionStore: store,
      eventStore: store,
      messageStore: store,
    });

    const callOrder: string[] = [];
    const contextEvents: Array<{
      stepIndex: number;
      messageCount: number;
      contextTokens: number;
      contextLimitTokens: number;
      contextUsagePercent: number;
    }> = [];
    const usageEvents: Array<{ stepIndex: number }> = [];

    await app.runForeground(
      {
        conversationId: 'conv_context_usage',
        executionId: 'exec_context_usage',
        userInput: 'Show context',
        maxSteps: 3,
      },
      {
        onContextUsage: ((usage: {
          stepIndex: number;
          messageCount: number;
          contextTokens: number;
          contextLimitTokens: number;
          contextUsagePercent: number;
        }) => {
          callOrder.push('context');
          contextEvents.push(usage);
        }) as (usage: {
          stepIndex: number;
          messageCount: number;
          contextTokens: number;
          contextLimitTokens: number;
          contextUsagePercent: number;
        }) => void,
        onUsage: (usage) => {
          callOrder.push('usage');
          usageEvents.push({ stepIndex: usage.stepIndex });
        },
      } as Parameters<AgentAppService['runForeground']>[1]
    );

    expect(contextEvents).toHaveLength(1);
    expect(usageEvents).toHaveLength(1);
    expect(callOrder).toEqual(['context', 'usage']);
    expect(contextEvents[0]?.stepIndex).toBe(1);
    expect(contextEvents[0]?.messageCount).toBeGreaterThan(0);
  });

  it('maps aborted execution to CANCELLED terminal state', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(toStream([]));

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-app-service-abort-'));
    store = new SqliteAgentAppStore(path.join(tempDir, 'agent.db'));
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 1,
      backoffConfig: { initialDelayMs: 1, maxDelayMs: 1, base: 2, jitter: false },
    });
    const app = new AgentAppService({
      agent,
      executionStore: store,
      eventStore: store,
      messageStore: store,
    });

    const controller = new AbortController();
    controller.abort();

    const result = await app.runForeground({
      conversationId: 'conv_abort',
      executionId: 'exec_abort',
      userInput: 'Abort me',
      abortSignal: controller.signal,
    });

    expect(result.finishReason).toBe('error');
    expect(result.run.status).toBe('CANCELLED');
    expect(result.run.terminalReason).toBe('aborted');
    expect(result.run.errorCode).toBe('AGENT_ABORTED');
  });

  it('bridges tool chunk as tool_stream and keeps run completed', async () => {
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
                      id: 'tool_call_1',
                      type: 'function',
                      index: 0,
                      function: {
                        name: 'bash',
                        arguments: '{"command":"echo hi"}',
                      },
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
      await options.onStreamEvent?.({ type: 'stdout', message: 'streamed-output' });
      return { success: true, output: 'ok' };
    });

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-app-service-tool-'));
    store = new SqliteAgentAppStore(path.join(tempDir, 'agent.db'));
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 2,
      backoffConfig: { initialDelayMs: 1, maxDelayMs: 1, base: 2, jitter: false },
    });
    const app = new AgentAppService({
      agent,
      executionStore: store,
      eventStore: store,
      messageStore: store,
    });

    const result = await app.runForeground({
      conversationId: 'conv_tool',
      executionId: 'exec_tool',
      userInput: 'run tool',
      maxSteps: 3,
    });

    expect(result.run.status).toBe('COMPLETED');
    expect(result.events.some((event) => event.eventType === 'tool_stream')).toBe(true);

    const persistedEvents = await app.listRunEvents('exec_tool');
    expect(persistedEvents.some((event) => event.eventType === 'tool_stream')).toBe(true);
  });

  it('auto-finalizes a buffered write_file direct call inside one foreground run', async () => {
    const provider = createProvider();
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-app-service-write-'));
    const bufferDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-app-service-buffer-'));
    const targetPath = path.join(allowedDir, 'nodejs-sandbox-implementation.md');
    const directToolCallId = 'wf_resume_direct_1';

    const manager = createEnterpriseToolExecutor({
      workingDirectory: allowedDir,
      bufferBaseDir: bufferDir,
      maxChunkBytes: 8,
    });

    const fullContent = '# Repro\n\n' + 'a'.repeat(64);
    const directArgs = JSON.stringify({
      mode: 'direct',
      path: targetPath,
      content: fullContent,
    });
    provider.generateStream = vi.fn().mockReturnValueOnce(
      toStream([
        {
          index: 0,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    id: directToolCallId,
                    type: 'function',
                    index: 0,
                    function: {
                      name: 'write_file',
                      arguments: directArgs,
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

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-app-service-resume-'));
    store = new SqliteAgentAppStore(path.join(tempDir, 'agent.db'));
    const agent = new StatelessAgent(provider, manager as unknown as AgentToolExecutor, {
      maxRetryCount: 2,
      backoffConfig: { initialDelayMs: 1, maxDelayMs: 1, base: 2, jitter: false },
    });
    const app = new AgentAppService({
      agent,
      executionStore: store,
      eventStore: store,
      messageStore: store,
    });
    try {
      const firstRun = await app.runForeground({
        conversationId: 'conv_resume_write_file',
        executionId: 'exec_resume_write_file_1',
        userInput: 'write the document',
        maxSteps: 1,
      });

      const firstToolResult = firstRun.events.find((event) => event.eventType === 'tool_result');
      expect(firstToolResult).toBeDefined();
      expect(
        JSON.parse((firstToolResult?.data as { content: string }).content) as {
          code: string;
          nextAction: string;
        }
      ).toMatchObject({
        code: 'WRITE_FILE_FINALIZE_OK',
        nextAction: 'none',
      });

      expect(await fs.readFile(targetPath, 'utf8')).toBe(fullContent);

      await expect(
        fs.access(path.join(bufferDir, `${directToolCallId}.pointer.json`))
      ).rejects.toThrow();
      expect(provider.generateStream).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(allowedDir, { recursive: true, force: true });
      await fs.rm(bufferDir, { recursive: true, force: true });
    }
  });

  it('filters stored empty assistant-text history before the next llm call', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi
      .fn()
      .mockReturnValueOnce(
        toStream([
          {
            index: 0,
            choices: [{ index: 0, delta: { content: 'first answer' } }],
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
            index: 0,
            choices: [{ index: 0, delta: { content: 'second answer' } }],
          },
          {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          },
        ])
      );

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-app-service-empty-history-'));
    store = new SqliteAgentAppStore(path.join(tempDir, 'agent.db'));
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      toolExecutionLedger: undefined,
    });
    const app = new AgentAppService({
      agent,
      executionStore: store,
      eventStore: store,
      messageStore: store,
    });

    const firstRun = await app.runForeground({
      conversationId: 'conv_empty_history_filter',
      executionId: 'exec_empty_history_filter_1',
      userInput: 'first turn',
    });

    const storedMessages = [...firstRun.messages];
    storedMessages.push({
      messageId: 'msg_empty_assistant',
      role: 'assistant',
      type: 'assistant-text',
      content: '',
      reasoning_content: '',
      timestamp: Date.now(),
    });

    await app.runForeground({
      conversationId: 'conv_empty_history_filter',
      executionId: 'exec_empty_history_filter_2',
      userInput: 'second turn',
      historyMessages: storedMessages,
    });

    const generateStreamCalls = (
      provider.generateStream as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    expect(generateStreamCalls).toHaveLength(2);
    const secondCallMessages = generateStreamCalls[1]?.[0] as Array<{
      role: string;
      content: unknown;
    }>;
    expect(
      secondCallMessages.some(
        (message) =>
          message.role === 'assistant' &&
          typeof message.content === 'string' &&
          message.content === ''
      )
    ).toBe(false);
    expect(
      secondCallMessages.some(
        (message) => message.role === 'assistant' && message.content === 'first answer'
      )
    ).toBe(true);
  });

  it('maps AGENT_UPSTREAM_TIMEOUT to FAILED timeout terminal state', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockImplementation(() =>
      (async function* () {
        for (const chunk of [] as Chunk[]) {
          yield chunk;
        }
        throw new LLMRetryableError('Request timeout', undefined, 'TIMEOUT');
      })()
    );

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-app-service-upstream-timeout-'));
    store = new SqliteAgentAppStore(path.join(tempDir, 'agent.db'));
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      backoffConfig: { initialDelayMs: 1, maxDelayMs: 1, base: 2, jitter: false },
    });
    const app = new AgentAppService({
      agent,
      executionStore: store,
      eventStore: store,
      messageStore: store,
    });

    const result = await app.runForeground(
      {
        conversationId: 'conv_upstream_timeout',
        executionId: 'exec_upstream_timeout',
        userInput: 'trigger timeout',
      },
      {
        onError: async () => ({ retry: false }),
      }
    );

    expect(result.finishReason).toBe('error');
    expect(result.run.status).toBe('FAILED');
    expect(result.run.terminalReason).toBe('timeout');
    expect(result.run.errorCode).toBe('AGENT_UPSTREAM_TIMEOUT');
  });

  it('maps AGENT_UPSTREAM_RATE_LIMIT to FAILED rate_limit terminal state', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockImplementation(() =>
      (async function* () {
        for (const chunk of [] as Chunk[]) {
          yield chunk;
        }
        throw new LLMRateLimitError('Too many requests');
      })()
    );

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-app-service-rate-limit-'));
    store = new SqliteAgentAppStore(path.join(tempDir, 'agent.db'));
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      backoffConfig: { initialDelayMs: 1, maxDelayMs: 1, base: 2, jitter: false },
    });
    const app = new AgentAppService({
      agent,
      executionStore: store,
      eventStore: store,
      messageStore: store,
    });

    const result = await app.runForeground(
      {
        conversationId: 'conv_rate_limit',
        executionId: 'exec_rate_limit',
        userInput: 'trigger rate limit',
      },
      {
        onError: async () => ({ retry: false }),
      }
    );

    expect(result.finishReason).toBe('error');
    expect(result.run.status).toBe('FAILED');
    expect(result.run.terminalReason).toBe('rate_limit');
    expect(result.run.errorCode).toBe('AGENT_UPSTREAM_RATE_LIMIT');
  });

  it('keeps upstream server/network/generic retryable terminal reason as error', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi
      .fn()
      .mockImplementationOnce(() =>
        (async function* () {
          for (const chunk of [] as Chunk[]) {
            yield chunk;
          }
          throw new LLMRetryableError('Server unavailable', undefined, 'SERVER_503');
        })()
      )
      .mockImplementationOnce(() =>
        (async function* () {
          for (const chunk of [] as Chunk[]) {
            yield chunk;
          }
          throw new LLMRetryableError('Network unstable', undefined, 'NETWORK_ERROR');
        })()
      )
      .mockImplementationOnce(() =>
        (async function* () {
          for (const chunk of [] as Chunk[]) {
            yield chunk;
          }
          throw new LLMRetryableError('Retry later', undefined, 'TRANSIENT_X');
        })()
      );

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-app-service-upstream-error-'));
    store = new SqliteAgentAppStore(path.join(tempDir, 'agent.db'));
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      backoffConfig: { initialDelayMs: 1, maxDelayMs: 1, base: 2, jitter: false },
    });
    const app = new AgentAppService({
      agent,
      executionStore: store,
      eventStore: store,
      messageStore: store,
    });

    const serverResult = await app.runForeground(
      {
        conversationId: 'conv_upstream_error',
        executionId: 'exec_upstream_server',
        userInput: 'trigger upstream server',
      },
      {
        onError: async () => ({ retry: false }),
      }
    );
    const networkResult = await app.runForeground(
      {
        conversationId: 'conv_upstream_error',
        executionId: 'exec_upstream_network',
        userInput: 'trigger upstream network',
      },
      {
        onError: async () => ({ retry: false }),
      }
    );
    const genericRetryableResult = await app.runForeground(
      {
        conversationId: 'conv_upstream_error',
        executionId: 'exec_upstream_retryable',
        userInput: 'trigger upstream retryable',
      },
      {
        onError: async () => ({ retry: false }),
      }
    );

    expect(serverResult.run.status).toBe('FAILED');
    expect(serverResult.run.terminalReason).toBe('error');
    expect(serverResult.run.errorCode).toBe('AGENT_UPSTREAM_SERVER');

    expect(networkResult.run.status).toBe('FAILED');
    expect(networkResult.run.terminalReason).toBe('error');
    expect(networkResult.run.errorCode).toBe('AGENT_UPSTREAM_NETWORK');

    expect(genericRetryableResult.run.status).toBe('FAILED');
    expect(genericRetryableResult.run.terminalReason).toBe('error');
    expect(genericRetryableResult.run.errorCode).toBe('AGENT_UPSTREAM_RETRYABLE');
  });

  it('isolates run logs across concurrent executions on the same service instance', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockImplementation((messages: Array<{ content: string }>) => {
      const marker = messages.at(-1)?.content ?? 'unknown';
      return (async function* () {
        await delay(marker === 'first' ? 10 : 1);
        yield {
          index: 0,
          choices: [{ index: 0, delta: { content: `reply:${marker}` } }],
        } as Chunk;
        await delay(marker === 'first' ? 1 : 10);
        yield {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        } as Chunk;
      })();
    });

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-app-service-concurrent-'));
    store = new SqliteAgentAppStore(path.join(tempDir, 'agent.db'));
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 2,
      backoffConfig: { initialDelayMs: 1, maxDelayMs: 1, base: 2, jitter: false },
    });
    const app = new AgentAppService({
      agent,
      executionStore: store,
      eventStore: store,
      messageStore: store,
    });

    const [first, second] = await Promise.all([
      app.runForeground({
        conversationId: 'conv_concurrent',
        executionId: 'exec_first',
        userInput: 'first',
        maxSteps: 3,
      }),
      app.runForeground({
        conversationId: 'conv_concurrent',
        executionId: 'exec_second',
        userInput: 'second',
        maxSteps: 3,
      }),
    ]);

    expect(first.run.status).toBe('COMPLETED');
    expect(second.run.status).toBe('COMPLETED');

    const firstLogs = await app.listRunLogs('exec_first');
    const secondLogs = await app.listRunLogs('exec_second');
    expect(firstLogs.length).toBeGreaterThan(0);
    expect(secondLogs.length).toBeGreaterThan(0);
    expect(firstLogs.every((log) => log.executionId === 'exec_first')).toBe(true);
    expect(secondLogs.every((log) => log.executionId === 'exec_second')).toBe(true);
    expect(
      firstLogs.every(
        (log) => log.context?.executionId === undefined || log.context.executionId === 'exec_first'
      )
    ).toBe(true);
    expect(
      secondLogs.every(
        (log) => log.context?.executionId === undefined || log.context.executionId === 'exec_second'
      )
    ).toBe(true);
  });

  it('persists error run logs with structured details when execution fails', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockImplementation(() =>
      (async function* () {
        for (const chunk of [] as Chunk[]) {
          yield chunk;
        }
        throw new Error('provider exploded');
      })()
    );

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-app-service-error-logs-'));
    store = new SqliteAgentAppStore(path.join(tempDir, 'agent.db'));
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 1,
      backoffConfig: { initialDelayMs: 1, maxDelayMs: 1, base: 2, jitter: false },
    });
    const app = new AgentAppService({
      agent,
      executionStore: store,
      eventStore: store,
      messageStore: store,
    });

    const result = await app.runForeground(
      {
        conversationId: 'conv_error_logs',
        executionId: 'exec_error_logs',
        userInput: 'explode',
      },
      {
        onError: async () => ({ retry: false }),
      }
    );

    expect(result.run.status).toBe('FAILED');
    const errorLogs = await app.listRunLogs('exec_error_logs', { level: 'error' });
    expect(errorLogs.length).toBeGreaterThan(0);
    expect(errorLogs.some((log) => log.message === '[Agent] run.error')).toBe(true);
    expect(errorLogs).toContainEqual(
      expect.objectContaining({
        executionId: 'exec_error_logs',
        level: 'error',
        message: '[Agent] run.error',
        error: expect.objectContaining({
          message: 'provider exploded',
        }),
      })
    );

    const runLogEvents = result.events.filter((event) => event.eventType === 'run_log');
    expect(
      runLogEvents.some(
        (event) => (event.data as { message?: string }).message === '[Agent] run.error'
      )
    ).toBe(true);
  });

  it('accepts runtime user input and consumes it on the next safe boundary', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    let releaseFirstTurn!: () => void;
    const firstTurnGate = new Promise<void>((resolve) => {
      releaseFirstTurn = resolve;
    });

    provider.generateStream = vi
      .fn()
      .mockImplementationOnce(() =>
        (async function* () {
          yield {
            index: 0,
            choices: [{ index: 0, delta: { content: 'first response' } }],
          } as Chunk;
          await firstTurnGate;
          yield {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          } as Chunk;
        })()
      )
      .mockReturnValueOnce(
        toStream([
          {
            index: 0,
            choices: [{ index: 0, delta: { content: 'follow-up response' } }],
          },
          {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          },
        ])
      );

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-app-service-runtime-input-'));
    store = new SqliteAgentAppStore(path.join(tempDir, 'agent.db'));
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 1,
      backoffConfig: { initialDelayMs: 1, maxDelayMs: 1, base: 2, jitter: false },
    });
    const app = new AgentAppService({
      agent,
      executionStore: store,
      eventStore: store,
      messageStore: store,
    });

    const runPromise = app.runForeground({
      conversationId: 'conv_runtime_input',
      executionId: 'exec_runtime_input',
      userInput: 'start',
      maxSteps: 4,
    });

    await waitForRunStatus(app, 'exec_runtime_input', 'RUNNING');

    const appended = await app.appendUserInputToRun({
      executionId: 'exec_runtime_input',
      conversationId: 'conv_runtime_input',
      userInput: 'continue with this',
    });
    expect(appended).toMatchObject({
      accepted: true,
      message: expect.objectContaining({
        role: 'user',
        type: 'user',
        content: 'continue with this',
      }),
    });

    releaseFirstTurn();
    const result = await runPromise;

    expect(provider.generateStream).toHaveBeenCalledTimes(2);
    expect(result.finishReason).toBe('stop');
    expect(
      result.messages.filter((message) => message.role === 'user').map((message) => message.content)
    ).toEqual(['start', 'continue with this']);
    expect(
      result.events
        .filter((event) => event.eventType === 'user_message')
        .map((event) => {
          const payload = event.data as { message?: { content?: string } };
          return payload.message?.content;
        })
    ).toEqual(['start', 'continue with this']);
  });

  it('rejects runtime user input when the run is not active', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(
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

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-app-service-runtime-inactive-'));
    store = new SqliteAgentAppStore(path.join(tempDir, 'agent.db'));
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 1,
      backoffConfig: { initialDelayMs: 1, maxDelayMs: 1, base: 2, jitter: false },
    });
    const app = new AgentAppService({
      agent,
      executionStore: store,
      eventStore: store,
      messageStore: store,
    });

    await app.runForeground({
      conversationId: 'conv_runtime_inactive',
      executionId: 'exec_runtime_inactive',
      userInput: 'start',
    });

    await expect(
      app.appendUserInputToRun({
        executionId: 'exec_runtime_inactive',
        conversationId: 'conv_runtime_inactive',
        userInput: 'late input',
      })
    ).resolves.toEqual({
      accepted: false,
      reason: 'run_not_active',
    });
  });

  it('rejects runtime user input when conversation id mismatches the active run', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    let releaseFirstTurn!: () => void;
    const firstTurnGate = new Promise<void>((resolve) => {
      releaseFirstTurn = resolve;
    });

    provider.generateStream = vi.fn().mockImplementationOnce(() =>
      (async function* () {
        yield {
          index: 0,
          choices: [{ index: 0, delta: { content: 'waiting' } }],
        } as Chunk;
        await firstTurnGate;
        yield {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        } as Chunk;
      })()
    );

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-app-service-runtime-mismatch-'));
    store = new SqliteAgentAppStore(path.join(tempDir, 'agent.db'));
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 1,
      backoffConfig: { initialDelayMs: 1, maxDelayMs: 1, base: 2, jitter: false },
    });
    const app = new AgentAppService({
      agent,
      executionStore: store,
      eventStore: store,
      messageStore: store,
    });

    const runPromise = app.runForeground({
      conversationId: 'conv_runtime_match',
      executionId: 'exec_runtime_match',
      userInput: 'start',
    });

    await waitForRunStatus(app, 'exec_runtime_match', 'RUNNING');

    await expect(
      app.appendUserInputToRun({
        executionId: 'exec_runtime_match',
        conversationId: 'conv_other',
        userInput: 'wrong conversation',
      })
    ).resolves.toEqual({
      accepted: false,
      reason: 'conversation_mismatch',
    });

    releaseFirstTurn();
    await runPromise;
  });
});
