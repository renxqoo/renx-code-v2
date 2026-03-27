import { describe, expect, it, beforeEach } from 'vitest';
import { MiniMaxAdapter } from '../minimax';
import type { Chunk } from '../../types';

async function collectChunks(stream: AsyncGenerator<Chunk>): Promise<Chunk[]> {
  const chunks: Chunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('MiniMaxAdapter', () => {
  let adapter: MiniMaxAdapter;

  beforeEach(() => {
    adapter = new MiniMaxAdapter({
      defaultModel: 'MiniMax-M2.5',
      endpointPath: '/chat/completions',
    });
  });

  it('should add top-level reasoning_split when thinking is true', () => {
    const request = adapter.transformRequest({
      model: 'MiniMax-M2.5',
      messages: [{ role: 'user', content: 'hello' }],
      thinking: true,
    });

    expect(request.reasoning_split).toBe(true);
    expect(request.extra_body).toBeUndefined();
  });

  it('should map reasoning_details text into message.reasoning_content in non-stream response', () => {
    const response = adapter.transformResponse({
      id: 'chatcmpl-minimax',
      object: 'chat.completion',
      created: 1234567890,
      model: 'MiniMax-M2.5',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'final answer',
            reasoning_details: [
              { type: 'text', text: 'step 1' },
              { type: 'text', text: ' step 2' },
            ],
          },
          finish_reason: 'stop',
        },
      ],
    });

    expect(response.choices[0]?.message.content).toBe('final answer');
    expect(response.choices[0]?.message.reasoning_content).toBe('step 1 step 2');
  });

  it('should map streaming reasoning_details deltas into reasoning_content chunks', async () => {
    const sse = [
      'data: {"id":"chunk-1","index":0,"choices":[{"index":0,"delta":{"reasoning_details":[{"type":"text","text":"step 1"}],"content":"a"}}]}\n\n',
      'data: {"id":"chunk-2","index":0,"choices":[{"index":0,"delta":{"reasoning_details":[{"type":"text","text":"step 1 step 2"}],"content":"answer"}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        controller.close();
      },
    });

    const chunks = await collectChunks(adapter.parseStreamAsync!(stream.getReader()));

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
});
