import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Chunk, LLMProvider, Message } from '@renx-code/core';
import { createEnterpriseAgentAppService, SqliteAgentAppStore } from '@renx-code/core';

import { createGatewayServer } from './server';
import type { ServerConfig } from '../config/schema';

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

function createConfig(tempDir: string, overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    authMode: 'token',
    token: 'secret',
    stateDir: tempDir,
    workspaceDir: tempDir,
    enableOpenAiCompat: true,
    logLevel: 'info',
    modelId: 'glm-4.7',
    trustedProxyIps: ['127.0.0.1', '::1'],
    trustedProxyUserHeader: 'x-forwarded-user',
    ...overrides,
  };
}

async function listen(server: ReturnType<typeof createGatewayServer>): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function waitForRunStatus(
  appService: { getRun(executionId: string): Promise<{ status: string } | null> },
  executionId: string,
  status: string,
  timeoutMs = 1000
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const run = await appService.getRun(executionId);
    if (run?.status === status) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${executionId} to reach ${status}`);
}

describe('createGatewayServer', () => {
  let tempDir: string | null = null;
  let ownedStore: SqliteAgentAppStore | null = null;
  let server: ReturnType<typeof createGatewayServer> | null = null;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
      server = null;
    }
    if (ownedStore) {
      await ownedStore.close();
      ownedStore = null;
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('serves health and protects run endpoints with bearer auth', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-server-health-'));
    const provider = createProvider();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        { index: 0, choices: [{ index: 0, delta: { content: 'ok' } }] },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    const composition = createEnterpriseAgentAppService({
      llmProvider: provider,
      storePath: path.join(tempDir, 'agent.db'),
    });
    ownedStore = composition.store || null;
    server = createGatewayServer({
      appService: composition.appService,
      store: composition.store,
      config: createConfig(tempDir),
    });
    const baseUrl = await listen(server);

    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({ ok: true });

    const unauthorized = await fetch(`${baseUrl}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userInput: 'hi' }),
    });
    expect(unauthorized.status).toBe(401);

    const authorized = await fetch(`${baseUrl}/api/runs`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        conversationId: 'conv_runs',
        executionId: 'exec_runs',
        userInput: 'hi',
      }),
    });
    expect(authorized.status).toBe(200);
    await expect(authorized.json()).resolves.toMatchObject({
      executionId: 'exec_runs',
      conversationId: 'conv_runs',
      finishReason: 'stop',
      status: 'COMPLETED',
      responseText: 'ok',
    });
  });

  it('returns 429 when the request rate limit is exceeded', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-server-rate-limit-'));
    const provider = createProvider();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        { index: 0, choices: [{ index: 0, delta: { content: 'limited ok' } }] },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    const composition = createEnterpriseAgentAppService({
      llmProvider: provider,
      storePath: path.join(tempDir, 'agent.db'),
    });
    ownedStore = composition.store || null;
    server = createGatewayServer({
      appService: composition.appService,
      store: composition.store,
      config: createConfig(tempDir, {
        rateLimit: {
          maxRequests: 1,
          windowMs: 60_000,
        },
      }),
    });
    const baseUrl = await listen(server);

    const first = await fetch(`${baseUrl}/api/runs`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        conversationId: 'conv_limit',
        executionId: 'exec_limit',
        userInput: 'hi',
      }),
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${baseUrl}/api/sessions`, {
      headers: { authorization: 'Bearer secret' },
    });
    expect(second.status).toBe(429);
    expect(second.headers.get('retry-after')).toBeTruthy();
    await expect(second.json()).resolves.toMatchObject({
      error: {
        code: 'RATE_LIMITED',
      },
    });
  });

  it('exposes run, session and conversation event query endpoints', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-server-queries-'));
    const provider = createProvider();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        { index: 0, choices: [{ index: 0, delta: { content: 'hello query' } }] },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    const composition = createEnterpriseAgentAppService({
      llmProvider: provider,
      storePath: path.join(tempDir, 'agent.db'),
    });
    ownedStore = composition.store || null;
    server = createGatewayServer({
      appService: composition.appService,
      store: composition.store,
      config: createConfig(tempDir),
    });
    const baseUrl = await listen(server);

    await fetch(`${baseUrl}/api/runs`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        conversationId: 'conv_query',
        executionId: 'exec_query',
        userInput: 'hello',
      }),
    });

    const runRes = await fetch(`${baseUrl}/api/runs/exec_query`, {
      headers: { authorization: 'Bearer secret' },
    });
    expect(runRes.status).toBe(200);
    await expect(runRes.json()).resolves.toMatchObject({
      executionId: 'exec_query',
      status: 'COMPLETED',
    });

    const sessionsRes = await fetch(`${baseUrl}/api/sessions`, {
      headers: { authorization: 'Bearer secret' },
    });
    expect(sessionsRes.status).toBe(200);
    const sessionsJson = (await sessionsRes.json()) as {
      items: Array<{ conversationId: string; lastAssistantMessageText?: string }>;
    };
    expect(sessionsJson.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          conversationId: 'conv_query',
          lastAssistantMessageText: 'hello query',
        }),
      ])
    );

    const runsRes = await fetch(`${baseUrl}/api/runs?conversationId=conv_query`, {
      headers: { authorization: 'Bearer secret' },
    });
    expect(runsRes.status).toBe(200);
    await expect(runsRes.json()).resolves.toMatchObject({
      items: [expect.objectContaining({ executionId: 'exec_query', conversationId: 'conv_query' })],
    });

    const eventsRes = await fetch(`${baseUrl}/api/conversations/conv_query/events`, {
      headers: { authorization: 'Bearer secret' },
    });
    expect(eventsRes.status).toBe(200);
    const eventsJson = (await eventsRes.json()) as {
      items: Array<{ eventType: string }>;
    };
    expect(
      eventsJson.items.some(
        (event: { eventType: string }) => event.eventType === 'assistant_message'
      )
    ).toBe(true);
  });

  it('passes prior OpenAI request messages into the internal run context', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-server-openai-history-'));
    const provider = createProvider();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        { index: 0, choices: [{ index: 0, delta: { content: 'history aware answer' } }] },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    const composition = createEnterpriseAgentAppService({
      llmProvider: provider,
      storePath: path.join(tempDir, 'agent.db'),
    });
    ownedStore = composition.store || null;
    server = createGatewayServer({
      appService: composition.appService,
      store: composition.store,
      config: createConfig(tempDir),
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'glm-4.7',
        user: 'history-user',
        messages: [
          { role: 'system', content: 'Be concise.' },
          { role: 'user', content: 'First question' },
          { role: 'assistant', content: 'First answer' },
          { role: 'user', content: 'Second question' },
        ],
      }),
    });

    expect(response.status).toBe(200);
    const firstCallMessages = (provider.generateStream as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as Message[];
    expect(firstCallMessages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(firstCallMessages.map((message) => message.content)).toEqual([
      'Be concise.',
      'First question',
      'First answer',
      'Second question',
    ]);
  });

  it('supports OpenAI-compatible non-stream responses and reuses session history by user', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-server-openai-'));
    const provider = createProvider();
    provider.generateStream = vi
      .fn()
      .mockReturnValueOnce(
        toStream([
          { index: 0, choices: [{ index: 0, delta: { content: 'first answer' } }] },
          {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          },
        ])
      )
      .mockReturnValueOnce(
        toStream([
          { index: 0, choices: [{ index: 0, delta: { content: 'second answer' } }] },
          {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          },
        ])
      );

    const composition = createEnterpriseAgentAppService({
      llmProvider: provider,
      storePath: path.join(tempDir, 'agent.db'),
    });
    ownedStore = composition.store || null;
    server = createGatewayServer({
      appService: composition.appService,
      store: composition.store,
      config: createConfig(tempDir),
    });
    const baseUrl = await listen(server);

    const first = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'glm-4.7',
        user: 'alice',
        messages: [{ role: 'user', content: 'hello' }],
      }),
    });
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      object: 'chat.completion',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'first answer' },
          finish_reason: 'stop',
        },
      ],
    });

    const second = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'glm-4.7',
        user: 'alice',
        messages: [{ role: 'user', content: 'continue' }],
      }),
    });
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      object: 'chat.completion',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'second answer' },
          finish_reason: 'stop',
        },
      ],
    });

    const secondCallMessages = (provider.generateStream as ReturnType<typeof vi.fn>).mock
      .calls[1][0] as Message[];
    expect(secondCallMessages.length).toBeGreaterThan(1);
    expect(secondCallMessages.some((message) => message.role === 'assistant')).toBe(true);
  });

  it('streams OpenAI-compatible SSE responses', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-server-sse-'));
    const provider = createProvider();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        { index: 0, choices: [{ index: 0, delta: { content: 'streamed answer' } }] },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    const composition = createEnterpriseAgentAppService({
      llmProvider: provider,
      storePath: path.join(tempDir, 'agent.db'),
    });
    ownedStore = composition.store || null;
    server = createGatewayServer({
      appService: composition.appService,
      store: composition.store,
      config: createConfig(tempDir),
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'glm-4.7',
        user: 'alice',
        stream: true,
        messages: [{ role: 'user', content: 'hello stream' }],
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const body = await response.text();
    expect(body).toContain('chat.completion.chunk');
    expect(body).toContain('streamed answer');
    expect(body).toContain('[DONE]');
  });

  it('streams the first SSE chunk before the run completes', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-server-sse-realtime-'));
    const provider = createProvider();
    let releaseFinish!: () => void;
    const finishGate = new Promise<void>((resolve) => {
      releaseFinish = resolve;
    });
    provider.generateStream = vi.fn().mockImplementation(() =>
      (async function* () {
        yield {
          index: 0,
          choices: [{ index: 0, delta: { content: 'partial answer' } }],
        } as Chunk;
        await finishGate;
        yield {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        } as Chunk;
      })()
    );

    const composition = createEnterpriseAgentAppService({
      llmProvider: provider,
      storePath: path.join(tempDir, 'agent.db'),
    });
    ownedStore = composition.store || null;
    server = createGatewayServer({
      appService: composition.appService,
      store: composition.store,
      config: createConfig(tempDir),
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'glm-4.7',
        user: 'alice',
        stream: true,
        messages: [{ role: 'user', content: 'hello realtime stream' }],
      }),
    });

    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const firstChunkPromise = reader!.read();
    const firstChunk = await Promise.race([
      firstChunkPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timed out waiting for first chunk')), 200)
      ),
    ]);
    const firstText = Buffer.from(firstChunk.value || new Uint8Array()).toString('utf8');
    expect(firstText).toContain('partial answer');
    expect(firstText).not.toContain('[DONE]');

    releaseFinish();
    let rest = '';
    for (;;) {
      const next = await reader!.read();
      if (next.done) {
        break;
      }
      rest += Buffer.from(next.value).toString('utf8');
    }
    expect(rest).toContain('[DONE]');
  });

  it('supports appending input to an active run', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-server-append-input-'));
    const provider = createProvider();
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
            choices: [{ index: 0, delta: { content: 'waiting' } }],
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
          { index: 0, choices: [{ index: 0, delta: { content: 'follow-up response' } }] },
          {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          },
        ])
      );

    const composition = createEnterpriseAgentAppService({
      llmProvider: provider,
      storePath: path.join(tempDir, 'agent.db'),
    });
    ownedStore = composition.store || null;
    server = createGatewayServer({
      appService: composition.appService,
      store: composition.store,
      config: createConfig(tempDir),
    });
    const baseUrl = await listen(server);

    const runPromise = fetch(`${baseUrl}/api/runs`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        conversationId: 'conv_active',
        executionId: 'exec_active',
        userInput: 'start',
        maxSteps: 4,
      }),
    });

    await waitForRunStatus(composition.appService, 'exec_active', 'RUNNING');

    const appendResponse = await fetch(`${baseUrl}/api/runs/exec_active/input`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        conversationId: 'conv_active',
        userInput: 'continue with this',
      }),
    });
    expect(appendResponse.status).toBe(202);
    await expect(appendResponse.json()).resolves.toMatchObject({ accepted: true });

    releaseFirstTurn();
    const runResponse = await runPromise;
    expect(runResponse.status).toBe(200);
    await expect(runResponse.json()).resolves.toMatchObject({
      executionId: 'exec_active',
      responseText: 'follow-up response',
    });
  });
});
