import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../logger';
import type { LogRecord } from '../../logger';
import { OpenAICompatibleProvider } from '../openai-compatible';
import { GLMAdapter } from '../adapters/glm';
import { MiniMaxAdapter } from '../adapters/minimax';
import type { Chunk } from '../types';

function createDoneStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

async function drainStream(stream: AsyncGenerator<Chunk>): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _ of stream) {
    // no-op
  }
}

async function collectChunks(stream: AsyncGenerator<Chunk>): Promise<Chunk[]> {
  const chunks: Chunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('OpenAICompatibleProvider request options', () => {
  it('should include stream_options.include_usage by default in stream mode', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com',
      model: 'gpt-4',
      temperature: 0.7,
      max_tokens: 2000,
      LLMMAX_TOKENS: 8000,
    });

    const fetchSpy = vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: createDoneStream(),
    } as Response);

    const stream = provider.generateStream([{ role: 'user', content: 'hello' }]);
    await drainStream(stream);

    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(requestBody.stream).toBe(true);
    expect(requestBody.stream_options?.include_usage).toBe(true);
  });

  it('should respect explicit stream_options.include_usage=false', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com',
      model: 'gpt-4',
      temperature: 0.7,
      max_tokens: 2000,
      LLMMAX_TOKENS: 8000,
    });

    const fetchSpy = vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: createDoneStream(),
    } as Response);

    const stream = provider.generateStream([{ role: 'user', content: 'hello' }], {
      stream_options: {
        include_usage: false,
      },
    });
    await drainStream(stream);

    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(requestBody.stream_options?.include_usage).toBe(false);
  });

  it('should pass tool_stream through without enabling stream mode', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com',
      model: 'gpt-4',
      temperature: 0.7,
      max_tokens: 2000,
      LLMMAX_TOKENS: 8000,
    });

    const fetchSpy = vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'test-id',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
      }),
    } as Response);

    await provider.generate([{ role: 'user', content: 'hello' }], {
      tool_stream: true,
    });

    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(requestBody.stream).toBe(false);
    expect(requestBody.tool_stream).toBe(true);
    expect(requestBody.stream_options).toBeUndefined();
  });

  it('should use provider config tool_stream by default', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com',
      model: 'gpt-4',
      temperature: 0.7,
      max_tokens: 2000,
      LLMMAX_TOKENS: 8000,
      tool_stream: true,
    });

    const fetchSpy = vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'test-id',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
      }),
    } as Response);

    await provider.generate([{ role: 'user', content: 'hello' }]);

    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(requestBody.stream).toBe(false);
    expect(requestBody.tool_stream).toBe(true);
  });

  it('should use provider config model_reasoning_effort by default', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com',
      model: 'gpt-4',
      temperature: 0.7,
      max_tokens: 2000,
      LLMMAX_TOKENS: 8000,
      model_reasoning_effort: 'high',
    });

    const fetchSpy = vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'test-id',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
      }),
    } as Response);

    await provider.generate([{ role: 'user', content: 'hello' }]);

    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(requestBody.model_reasoning_effort).toBe('high');
  });

  it('should allow request model_reasoning_effort to override provider default', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com',
      model: 'gpt-4',
      temperature: 0.7,
      max_tokens: 2000,
      LLMMAX_TOKENS: 8000,
      model_reasoning_effort: 'medium',
    });

    const fetchSpy = vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'test-id',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
      }),
    } as Response);

    await provider.generate([{ role: 'user', content: 'hello' }], {
      model_reasoning_effort: 'high',
    });

    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(requestBody.model_reasoning_effort).toBe('high');
  });

  it('should not send thinking flag in standard adapter request body', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com',
      model: 'gpt-4',
      temperature: 0.7,
      max_tokens: 2000,
      LLMMAX_TOKENS: 8000,
      thinking: false,
    });

    const fetchSpy = vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: createDoneStream(),
    } as Response);

    const stream = provider.generateStream([{ role: 'user', content: 'hello' }]);
    await drainStream(stream);

    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(requestBody.thinking).toBeUndefined();
  });

  it('should send enabled thinking payload for glm-compatible requests when thinking is true', async () => {
    const provider = new OpenAICompatibleProvider(
      {
        apiKey: 'test-key',
        baseURL: 'https://open.bigmodel.cn/api/coding/paas/v4',
        model: 'GLM-5.1',
        temperature: 0.7,
        max_tokens: 2000,
        LLMMAX_TOKENS: 8000,
        thinking: true,
      },
      new GLMAdapter({
        defaultModel: 'GLM-5.1',
        endpointPath: '/chat/completions',
      })
    );

    const fetchSpy = vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: createDoneStream(),
    } as Response);

    const stream = provider.generateStream([{ role: 'user', content: 'hello' }]);
    await drainStream(stream);

    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(requestBody.thinking).toEqual({ type: 'enabled' });
  });

  it('should send MiniMax top-level reasoning_split when thinking is true', async () => {
    const provider = new OpenAICompatibleProvider(
      {
        apiKey: 'test-key',
        baseURL: 'https://api.minimaxi.com/v1',
        model: 'MiniMax-M2.5',
        temperature: 0.7,
        max_tokens: 2000,
        LLMMAX_TOKENS: 8000,
        thinking: true,
      },
      new MiniMaxAdapter({
        defaultModel: 'MiniMax-M2.5',
        endpointPath: '/chat/completions',
      })
    );

    const fetchSpy = vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: createDoneStream(),
    } as Response);

    const stream = provider.generateStream([{ role: 'user', content: 'hello' }]);
    await drainStream(stream);

    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(requestBody.reasoning_split).toBe(true);
    expect(requestBody.extra_body).toBeUndefined();
  });

  it('should not send MiniMax reasoning_split when thinking is false', async () => {
    const provider = new OpenAICompatibleProvider(
      {
        apiKey: 'test-key',
        baseURL: 'https://api.minimaxi.com/v1',
        model: 'MiniMax-M2.5',
        temperature: 0.7,
        max_tokens: 2000,
        LLMMAX_TOKENS: 8000,
        thinking: false,
      },
      new MiniMaxAdapter({
        defaultModel: 'MiniMax-M2.5',
        endpointPath: '/chat/completions',
      })
    );

    const fetchSpy = vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: createDoneStream(),
    } as Response);

    const stream = provider.generateStream([{ role: 'user', content: 'hello' }]);
    await drainStream(stream);

    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(requestBody.reasoning_split).toBeUndefined();
    expect(requestBody.extra_body).toBeUndefined();
  });

  it('should auto-select MiniMax adapter and send top-level reasoning_split when instantiated without explicit adapter', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key',
      baseURL: 'https://api.minimaxi.com/v1',
      model: 'MiniMax-M2.5',
      temperature: 0.7,
      max_tokens: 2000,
      LLMMAX_TOKENS: 8000,
      thinking: true,
    });

    const fetchSpy = vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: createDoneStream(),
    } as Response);

    const stream = provider.generateStream([{ role: 'user', content: 'hello' }]);
    await drainStream(stream);

    expect(provider.adapter.constructor.name).toBe('MiniMaxAdapter');
    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(requestBody.reasoning_split).toBe(true);
    expect(requestBody.extra_body).toBeUndefined();
  });

  it('should emit incremental MiniMax reasoning_content and content from cumulative stream chunks', async () => {
    const provider = new OpenAICompatibleProvider(
      {
        apiKey: 'test-key',
        baseURL: 'https://api.minimaxi.com/v1',
        model: 'MiniMax-M2.5',
        temperature: 0.7,
        max_tokens: 2000,
        LLMMAX_TOKENS: 8000,
        thinking: true,
      },
      new MiniMaxAdapter({
        defaultModel: 'MiniMax-M2.5',
        endpointPath: '/chat/completions',
      })
    );

    const sse = [
      'data: {"id":"chunk-1","index":0,"choices":[{"index":0,"delta":{"reasoning_details":[{"type":"text","text":"step 1"}],"content":"a"}}]}\n\n',
      'data: {"id":"chunk-2","index":0,"choices":[{"index":0,"delta":{"reasoning_details":[{"type":"text","text":"step 1 step 2"}],"content":"answer"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    const streamResponse = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        controller.close();
      },
    });

    vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: streamResponse,
    } as Response);

    const chunks = await collectChunks(
      provider.generateStream([{ role: 'user', content: 'hello' }])
    );

    expect(chunks).toEqual([
      {
        id: 'chunk-1',
        index: 0,
        choices: [{ index: 0, delta: { reasoning_content: 'step 1', content: 'a' } }],
      },
      {
        id: 'chunk-2',
        index: 0,
        choices: [{ index: 0, delta: { reasoning_content: ' step 2', content: 'nswer' } }],
      },
    ]);
  });

  it('should log final thinking payload from built request params', async () => {
    const records: LogRecord[] = [];
    const logger = createLogger({
      console: { enabled: false },
      file: { enabled: false, filepath: './logs/test.log' },
      onLog: (record) => {
        records.push(record);
      },
    });

    const provider = new OpenAICompatibleProvider(
      {
        apiKey: 'test-key',
        baseURL: 'https://open.bigmodel.cn/api/coding/paas/v4',
        model: 'GLM-5.1',
        temperature: 0.7,
        max_tokens: 2000,
        LLMMAX_TOKENS: 8000,
        logger,
      },
      new GLMAdapter({
        defaultModel: 'GLM-5.1',
        endpointPath: '/chat/completions',
      })
    );

    vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: createDoneStream(),
    } as Response);

    const stream = provider.generateStream([{ role: 'user', content: 'hello' }], {
      thinking: true,
    });
    await drainStream(stream);

    const llmRequestRecord = records.find((record) => record.message.includes('LLM request'));
    expect(llmRequestRecord).toBeDefined();
    expect(llmRequestRecord?.context.thinking).toEqual({ type: 'enabled' });
    expect(llmRequestRecord?.context.endpointPath).toBe('/chat/completions');
    expect(llmRequestRecord?.context.adapter).toBe('GLMAdapter');
  });

  it('should preserve multimodal content parts in request body', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com',
      model: 'gpt-4',
      temperature: 0.7,
      max_tokens: 2000,
      LLMMAX_TOKENS: 8000,
    });

    const fetchSpy = vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: createDoneStream(),
    } as Response);

    const userContent = [
      { type: 'text', text: 'describe this media' },
      { type: 'image_url', image_url: { url: 'https://example.com/demo.png' } },
      { type: 'file', file: { file_id: 'file-video-1', filename: 'demo.mp4' } },
      { type: 'input_video', input_video: { url: 'https://example.com/clip.mp4' } },
    ] as const;

    const stream = provider.generateStream([{ role: 'user', content: [...userContent] }]);
    await drainStream(stream);

    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(requestBody.messages[0].content).toEqual(userContent);
  });

  it('should use provider max_tokens as default when request max_tokens is not provided', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com',
      model: 'gpt-4',
      temperature: 0.7,
      max_tokens: 4321,
      LLMMAX_TOKENS: 8000,
    });

    const fetchSpy = vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'test-id',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
      }),
    } as Response);

    await provider.generate([{ role: 'user', content: 'hello' }]);

    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(requestBody.max_tokens).toBe(4321);
  });

  it('should allow request temperature to override provider default', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com',
      model: 'gpt-4',
      temperature: 0.7,
      max_tokens: 2000,
      LLMMAX_TOKENS: 8000,
    });

    const fetchSpy = vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'test-id',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
      }),
    } as Response);

    await provider.generate([{ role: 'user', content: 'hello' }], {
      temperature: 0.2,
    });

    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(requestBody.temperature).toBe(0.2);
  });
});
