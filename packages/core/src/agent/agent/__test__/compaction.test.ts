import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../../../providers';
import type { Message } from '../../types';
import { COMPACTION_SYSTEM_PROMPT_V1, COMPACTION_SYSTEM_PROMPT_V2 } from '../compaction-prompt';
import { buildCompactionRequestMessages, extractSummaryContent } from '../compaction-summary';

const encodeMock = vi.hoisted(() =>
  vi.fn((text: string) => Array.from(text).map((_ch, index) => index))
);

vi.mock('js-tiktoken', () => ({
  getEncoding: vi.fn(() => ({
    encode: encodeMock,
  })),
}));

import { compact, estimateMessagesTokens, estimateTokens } from '../compaction';

function createProvider(
  overrides?: Partial<{
    generate: LLMProvider['generate'];
    getTimeTimeout: LLMProvider['getTimeTimeout'];
    getLLMMaxTokens: LLMProvider['getLLMMaxTokens'];
    getMaxOutputTokens: LLMProvider['getMaxOutputTokens'];
    model: string;
  }>
): LLMProvider {
  return {
    config: { model: overrides?.model ?? 'mock-model' } as Record<string, unknown>,
    generate:
      overrides?.generate ||
      (vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'mock summary' } }],
      }) as unknown as LLMProvider['generate']),
    generateStream: vi.fn() as unknown as LLMProvider['generateStream'],
    getTimeTimeout: overrides?.getTimeTimeout || vi.fn(() => 50),
    getLLMMaxTokens: overrides?.getLLMMaxTokens || vi.fn(() => 20_000),
    getMaxOutputTokens: overrides?.getMaxOutputTokens || vi.fn(() => 100),
  } as unknown as LLMProvider;
}

function createMessage(partial: Partial<Message>): Message {
  return {
    messageId: partial.messageId || crypto.randomUUID(),
    type: partial.type || 'assistant-text',
    role: partial.role || 'assistant',
    content: partial.content || '',
    timestamp: partial.timestamp ?? Date.now(),
    ...partial,
  };
}

function findSummaryMessage(messages: Message[]): Message | undefined {
  return messages.find((message) => message.type === 'summary');
}

describe('renx compaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    encodeMock.mockImplementation((text: string) => Array.from(text).map((_ch, index) => index));
  });

  it('estimateTokens uses tiktoken encoder output length', () => {
    expect(estimateTokens('abc')).toBe(3);
    expect(estimateTokens('')).toBe(0);
    expect(encodeMock).toHaveBeenCalledWith('abc');
  });

  it('estimateTokens falls back to heuristic when encoder throws', () => {
    encodeMock.mockImplementationOnce(() => {
      throw new Error('encode failed');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(estimateTokens('中文ab')).toBe(5);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('estimateMessagesTokens applies different costs for low/high image detail', () => {
    const lowImageMessage = createMessage({
      role: 'user',
      type: 'user',
      content: [{ type: 'image_url', image_url: { url: 'u', detail: 'low' } }],
    });
    const highImageMessage = createMessage({
      role: 'user',
      type: 'user',
      content: [{ type: 'image_url', image_url: { url: 'u', detail: 'high' } }],
    });

    const low = estimateMessagesTokens([lowImageMessage]);
    const high = estimateMessagesTokens([highImageMessage]);

    expect(high - low).toBe(680);
  });

  it('estimateMessagesTokens includes tool_calls, tool_call_id and tools schema overhead', () => {
    const base = createMessage({
      role: 'assistant',
      type: 'assistant-text',
      content: 'hello',
    });
    const withToolMetadata = createMessage({
      role: 'assistant',
      type: 'tool-call',
      content: 'hello',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'bash', arguments: '{"cmd":"echo"}' },
        },
      ] as Message['tool_calls'],
      tool_call_id: 'call_1',
    });

    const withoutExtra = estimateMessagesTokens([base]);
    const withExtra = estimateMessagesTokens([withToolMetadata], [
      {
        type: 'function',
        function: { name: 'bash', description: 'run shell', parameters: { type: 'object' } },
      },
    ] as never);

    expect(withExtra).toBeGreaterThan(withoutExtra);
  });

  it('estimateMessagesTokens counts name field and array text parts', () => {
    const msg = createMessage({
      role: 'assistant',
      type: 'assistant-text',
      content: [{ type: 'text', text: 'chunk-text' }],
    }) as Message & { name?: string };
    msg.name = 'assistant_name';

    const baseline = createMessage({
      role: 'assistant',
      type: 'assistant-text',
      content: '',
    });

    const tokensWithNameAndParts = estimateMessagesTokens([msg]);
    const baselineTokens = estimateMessagesTokens([baseline]);
    expect(tokensWithNameAndParts).toBeGreaterThan(baselineTokens);
  });

  it('compact builds summary and returns removed message ids', async () => {
    const generateMock = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'Summary text' } }],
    });
    const provider = createProvider({
      generate: generateMock as unknown as LLMProvider['generate'],
    });
    const logger = { info: vi.fn(), warn: vi.fn() };
    const messages: Message[] = [
      createMessage({
        messageId: 's1',
        type: 'system',
        role: 'system',
        content: 'sys',
        timestamp: 1,
      }),
      createMessage({
        messageId: 'u1',
        type: 'user',
        role: 'user',
        content: 'old question',
        timestamp: 2,
      }),
      createMessage({
        messageId: 'a1',
        type: 'assistant-text',
        role: 'assistant',
        content: 'old answer',
        timestamp: 3,
      }),
      createMessage({
        messageId: 'u2',
        type: 'user',
        role: 'user',
        content: 'latest question',
        timestamp: 4,
      }),
    ];

    const result = await compact(messages, { provider, keepMessagesNum: 1, logger });
    const summaryMessage = findSummaryMessage(result.messages);

    expect(summaryMessage).toMatchObject({
      role: 'user',
      type: 'summary',
    });
    expect(String(summaryMessage?.content)).toContain('Summary text');
    expect(result.removedMessageIds.sort()).toEqual(['a1', 'u1']);
    expect(result.diagnostics).toMatchObject({
      outcome: 'applied',
      reason: 'summary_created',
      promptVersion: 'v1',
      pendingMessageCount: 2,
      activeMessageCount: 1,
    });
    expect(result.messages.map((message) => message.messageId)).toEqual([
      's1',
      summaryMessage!.messageId,
      'u2',
    ]);
    const secondArg = (generateMock as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]?.[1] as {
      model?: string;
      abortSignal?: AbortSignal;
    };
    expect(secondArg.model).toBe('mock-model');
    expect(secondArg.abortSignal).toBeDefined();
    const requestMessages = (generateMock as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(requestMessages[0]).toMatchObject({
      role: 'system',
      content: COMPACTION_SYSTEM_PROMPT_V1,
    });
    expect(requestMessages[1]?.content).toContain('old question');
    expect(requestMessages[1]?.content).not.toContain('latest question');
    expect(
      (logger.info as unknown as { mock: { calls: unknown[][] } }).mock.calls.length
    ).toBeGreaterThan(0);
  });

  it('trims oldest pending messages when the compaction request exceeds the input budget', async () => {
    const generateMock = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'Summary text' } }],
    });
    const pendingThatShouldBeTrimmed = createMessage({
      messageId: 'u1',
      type: 'user',
      role: 'user',
      content: 'older detail that should be trimmed',
      timestamp: 2,
    });
    const pendingThatShouldRemain = createMessage({
      messageId: 'a1',
      type: 'assistant-text',
      role: 'assistant',
      content: 'recent detail that should stay in the compaction request',
      timestamp: 3,
    });
    const singlePendingRequest = buildCompactionRequestMessages({
      pendingMessages: [pendingThatShouldRemain],
      previousSummary: '',
      systemPrompt: COMPACTION_SYSTEM_PROMPT_V1,
    });
    const singlePendingTokens = estimateMessagesTokens(
      singlePendingRequest as unknown as Message[]
    );
    const provider = createProvider({
      generate: generateMock as unknown as LLMProvider['generate'],
      getLLMMaxTokens: vi.fn(() => singlePendingTokens + 100),
      getMaxOutputTokens: vi.fn(() => 100),
    });
    const logger = { info: vi.fn(), warn: vi.fn() };
    const messages: Message[] = [
      createMessage({
        messageId: 's1',
        type: 'system',
        role: 'system',
        content: 'sys',
        timestamp: 1,
      }),
      pendingThatShouldBeTrimmed,
      pendingThatShouldRemain,
      createMessage({
        messageId: 'u2',
        type: 'user',
        role: 'user',
        content: 'latest question',
        timestamp: 4,
      }),
    ];

    const result = await compact(messages, { provider, keepMessagesNum: 1, logger });

    expect(findSummaryMessage(result.messages)).toBeDefined();
    const requestMessages = (generateMock as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(requestMessages[1]?.content).not.toContain('older detail that should be trimmed');
    expect(requestMessages[1]?.content).toContain(
      'recent detail that should stay in the compaction request'
    );
    expect(logger.warn).toHaveBeenCalled();
  });

  it('compact throws when summary response is invalid', async () => {
    const provider = createProvider({
      generate: vi.fn().mockResolvedValue(null) as unknown as LLMProvider['generate'],
      getTimeTimeout: vi.fn(() => 0),
    });
    const logger = { info: vi.fn(), warn: vi.fn() };
    const messages = [
      createMessage({ messageId: 's1', type: 'system', role: 'system', content: 'sys' }),
      createMessage({ messageId: 'u1', type: 'user', role: 'user', content: 'u1' }),
      createMessage({ messageId: 'u2', type: 'user', role: 'user', content: 'u2' }),
    ];

    await expect(
      compact(messages, {
        provider,
        keepMessagesNum: 1,
        logger,
      })
    ).rejects.toMatchObject({
      reason: 'invalid_response',
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('compact uses system prompt v2 when requested', async () => {
    const generateMock = vi.fn().mockResolvedValue({
      choices: [{ message: { content: '<summary>Summary text</summary>' } }],
    });
    const provider = createProvider({
      generate: generateMock as unknown as LLMProvider['generate'],
    });
    const messages: Message[] = [
      createMessage({ messageId: 's1', type: 'system', role: 'system', content: 'sys' }),
      createMessage({ messageId: 'u1', type: 'user', role: 'user', content: 'old question' }),
      createMessage({ messageId: 'u2', type: 'user', role: 'user', content: 'latest question' }),
    ];

    await compact(messages, { provider, keepMessagesNum: 1, promptVersion: 'v2' });

    const requestMessages = (generateMock as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]?.[0] as Array<{ role: string; content: string }>;
    expect(requestMessages[0]).toMatchObject({
      role: 'system',
      content: COMPACTION_SYSTEM_PROMPT_V2,
    });
    expect(requestMessages[1]?.content).toContain('<compaction_request version="v2">');
    expect(requestMessages[1]?.content).toContain(
      'Return exactly one <summary>...</summary> block.'
    );
  });

  it('compact skips llm summary generation when pending is empty', async () => {
    const generateMock = vi.fn();
    const provider = createProvider({
      generate: generateMock as unknown as LLMProvider['generate'],
    });
    const messages = [
      createMessage({ messageId: 's1', type: 'system', role: 'system', content: 'sys' }),
      createMessage({ messageId: 'u1', type: 'user', role: 'user', content: 'u1' }),
    ];

    const result = await compact(messages, { provider, keepMessagesNum: 10 });

    expect(result.messages).toEqual(messages);
    expect(result.removedMessageIds).toEqual([]);
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('compact throws when provider.generate rejects', async () => {
    const provider = createProvider({
      generate: vi
        .fn()
        .mockRejectedValue(new Error('network failed')) as unknown as LLMProvider['generate'],
    });
    const logger = { info: vi.fn(), warn: vi.fn() };
    const messages = [
      createMessage({ messageId: 's1', type: 'system', role: 'system', content: 'sys' }),
      createMessage({ messageId: 'a1', type: 'assistant-text', role: 'assistant', content: 'a1' }),
      createMessage({ messageId: 'u1', type: 'user', role: 'user', content: 'u1' }),
    ];

    await expect(
      compact(messages, {
        provider,
        keepMessagesNum: 1,
        logger,
      })
    ).rejects.toMatchObject({
      reason: 'provider_error',
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('compact passes previous summary block and throws on empty output', async () => {
    const generateMock = vi.fn().mockResolvedValue({ choices: [] });
    const provider = createProvider({
      generate: generateMock as unknown as LLMProvider['generate'],
      model: '   ',
      getTimeTimeout: vi.fn(() => 0),
    });

    const messages = [
      createMessage({ messageId: 's1', type: 'system', role: 'system', content: 'sys' }),
      createMessage({
        messageId: 'sum_1',
        type: 'summary',
        role: 'user',
        content: 'old summary',
      }),
      createMessage({ messageId: 'u1', type: 'user', role: 'user', content: 'older detail' }),
      createMessage({ messageId: 'u2', type: 'user', role: 'user', content: 'latest' }),
    ];

    await expect(compact(messages, { provider, keepMessagesNum: 1 })).rejects.toThrow(
      'Compaction summary generation returned empty summary content'
    );
    await expect(compact(messages, { provider, keepMessagesNum: 1 })).rejects.toMatchObject({
      reason: 'empty_summary',
    });

    const callArgs = (generateMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const requestMessages = callArgs?.[0] as Array<{ role: string; content: string }>;
    const options = callArgs?.[1] as { model?: string; abortSignal?: AbortSignal };
    expect(requestMessages[1]?.content).toContain('<previous_summary>');
    expect(requestMessages[1]?.content).toContain('old summary');
    expect(options.model).toBeUndefined();
    expect(options.abortSignal).toBeUndefined();
  });

  it('v2 request builder emits the stricter compaction request envelope', () => {
    const requestMessages = buildCompactionRequestMessages({
      pendingMessages: [
        createMessage({ messageId: 'u1', type: 'user', role: 'user', content: 'older detail' }),
      ],
      previousSummary: '<summary>old summary</summary>',
      systemPrompt: COMPACTION_SYSTEM_PROMPT_V2,
      promptVersion: 'v2',
    });

    expect(requestMessages[0]).toMatchObject({
      role: 'system',
      content: COMPACTION_SYSTEM_PROMPT_V2,
    });
    expect(String(requestMessages[1]?.content)).toContain('<compaction_request version="v2">');
    expect(String(requestMessages[1]?.content)).toContain('<output_contract>');
    expect(String(requestMessages[1]?.content)).toContain('<previous_summary>');
  });

  it('v2 extractor requires a summary block while v1 remains permissive', () => {
    expect(extractSummaryContent('plain text summary', 'v1')).toBe('plain text summary');
    expect(extractSummaryContent('plain text summary', 'v2')).toBe('');
    expect(extractSummaryContent('<summary>ok</summary>', 'v2')).toBe('<summary>ok</summary>');
  });

  it('throws when a previous summary exists but summary generation fails', async () => {
    const provider = createProvider({
      generate: vi
        .fn()
        .mockRejectedValue(new Error('upstream failed')) as unknown as LLMProvider['generate'],
      getTimeTimeout: vi.fn(() => 0),
    });
    const logger = { info: vi.fn(), warn: vi.fn() };
    const messages = [
      createMessage({ messageId: 's1', type: 'system', role: 'system', content: 'sys' }),
      createMessage({
        messageId: 'sum_1',
        type: 'summary',
        role: 'user',
        content: '<summary>old summary</summary>',
      }),
      createMessage({ messageId: 'u1', type: 'user', role: 'user', content: 'new detail' }),
      createMessage({ messageId: 'u2', type: 'user', role: 'user', content: 'latest' }),
    ];

    await expect(compact(messages, { provider, keepMessagesNum: 1, logger })).rejects.toThrow(
      'Compaction summary generation failed'
    );
    await expect(compact(messages, { provider, keepMessagesNum: 1, logger })).rejects.toMatchObject(
      {
        reason: 'provider_error',
      }
    );
    expect(logger.warn).toHaveBeenCalled();
  });

  it('throws before generate when the compaction request still exceeds the budget after trimming', async () => {
    const generateMock = vi.fn();
    const provider = createProvider({
      generate: generateMock as unknown as LLMProvider['generate'],
      getLLMMaxTokens: vi.fn(() => 50),
      getMaxOutputTokens: vi.fn(() => 10),
    });
    const logger = { info: vi.fn(), warn: vi.fn() };
    const messages = [
      createMessage({ messageId: 's1', type: 'system', role: 'system', content: 'sys' }),
      createMessage({ messageId: 'u1', type: 'user', role: 'user', content: 'older detail' }),
      createMessage({ messageId: 'u2', type: 'user', role: 'user', content: 'latest detail' }),
    ];

    await expect(compact(messages, { provider, keepMessagesNum: 1, logger })).rejects.toThrow(
      'Compaction request exceeds estimated input budget after trimming'
    );
    await expect(compact(messages, { provider, keepMessagesNum: 1, logger })).rejects.toMatchObject(
      {
        reason: 'request_oversized',
      }
    );
    expect(generateMock).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('compact ignores AbortSignal.timeout failure and still requests summary', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      throw new Error('timeout unsupported');
    });
    const generateMock = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'summary ok' } }],
    });

    const provider = createProvider({
      generate: generateMock as unknown as LLMProvider['generate'],
      getTimeTimeout: vi.fn(() => 10),
      getMaxOutputTokens: vi.fn(() => 10),
    });

    const messages = [
      createMessage({ messageId: 's1', type: 'system', role: 'system', content: 'sys' }),
      createMessage({ messageId: 'u1', type: 'user', role: 'user', content: 'old q' }),
      createMessage({ messageId: 'u2', type: 'user', role: 'user', content: 'latest q' }),
    ];

    const result = await compact(messages, { provider, keepMessagesNum: 1 });
    const summaryMessage = findSummaryMessage(result.messages);
    expect(summaryMessage?.content).toContain('summary ok');
    const options = (generateMock as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]?.[1] as {
      abortSignal?: AbortSignal;
      max_tokens?: number;
    };
    expect(options.abortSignal).toBeUndefined();
    expect(options.max_tokens).toBe(10);
    timeoutSpy.mockRestore();
  });

  it('extracts the <summary> block and stores only the summary content', async () => {
    const provider = createProvider({
      generate: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content:
                '<analysis>internal</analysis>\n<summary>\n1. Primary Request and Intent: test\n</summary>',
            },
          },
        ],
      }) as unknown as LLMProvider['generate'],
    });

    const result = await compact(
      [
        createMessage({ messageId: 's1', type: 'system', role: 'system', content: 'sys' }),
        createMessage({ messageId: 'u1', type: 'user', role: 'user', content: 'older context' }),
        createMessage({ messageId: 'u2', type: 'user', role: 'user', content: 'latest context' }),
      ],
      { provider, keepMessagesNum: 1 }
    );

    const summaryMessage = findSummaryMessage(result.messages);
    expect(String(summaryMessage?.content)).toContain('<summary>');
    expect(String(summaryMessage?.content)).not.toContain('<analysis>');
  });

  it('reuses the previous summary when only summary messages are pending', async () => {
    const generateMock = vi.fn();
    const provider = createProvider({
      generate: generateMock as unknown as LLMProvider['generate'],
    });

    const result = await compact(
      [
        createMessage({ messageId: 's1', type: 'system', role: 'system', content: 'sys' }),
        createMessage({
          messageId: 'sum_1',
          type: 'summary',
          role: 'user',
          content: '<summary>old summary</summary>',
        }),
        createMessage({ messageId: 'u2', type: 'user', role: 'user', content: 'latest' }),
      ],
      { provider, keepMessagesNum: 1 }
    );

    expect(generateMock).not.toHaveBeenCalled();
    expect(result.messages[1]?.messageId).toBe('sum_1');
    expect(String(result.messages[1]?.content)).toContain('<summary>old summary</summary>');
    expect(result.removedMessageIds).toEqual([]);
    expect(result.diagnostics).toMatchObject({
      outcome: 'skipped',
      reason: 'no_pending_messages',
    });
  });
});
