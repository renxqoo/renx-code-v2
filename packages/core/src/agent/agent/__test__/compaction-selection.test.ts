import { describe, expect, it } from 'vitest';
import type { Message } from '../../types';
import { selectCompactionWindow } from '../compaction-selection';

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

describe('selectCompactionWindow', () => {
  it('keeps the latest user turn active and isolates older history', () => {
    const result = selectCompactionWindow(
      [
        createMessage({ messageId: 's1', type: 'system', role: 'system', content: 'sys' }),
        createMessage({
          messageId: 'a1',
          type: 'assistant-text',
          role: 'assistant',
          content: 'older assistant',
        }),
        createMessage({ messageId: 'u2', type: 'user', role: 'user', content: 'latest user' }),
        createMessage({
          messageId: 'a2',
          type: 'assistant-text',
          role: 'assistant',
          content: 'latest assistant',
        }),
      ],
      1
    );

    expect(result.systemMessage?.messageId).toBe('s1');
    expect(result.pendingMessages.map((message) => message.messageId)).toEqual(['a1']);
    expect(result.activeMessages.map((message) => message.messageId)).toEqual(['u2', 'a2']);
  });

  it('treats keepMessagesNum 0 as no extra tail retention, while still keeping the latest user turn active', () => {
    const result = selectCompactionWindow(
      [
        createMessage({ messageId: 's1', type: 'system', role: 'system', content: 'sys' }),
        createMessage({ messageId: 'u1', type: 'user', role: 'user', content: 'older user' }),
        createMessage({
          messageId: 'a1',
          type: 'assistant-text',
          role: 'assistant',
          content: 'older assistant',
        }),
        createMessage({ messageId: 'u2', type: 'user', role: 'user', content: 'latest user' }),
        createMessage({
          messageId: 'a2',
          type: 'assistant-text',
          role: 'assistant',
          content: 'latest assistant',
        }),
      ],
      0
    );

    expect(result.pendingMessages.map((message) => message.messageId)).toEqual(['u1', 'a1']);
    expect(result.activeMessages.map((message) => message.messageId)).toEqual(['u2', 'a2']);
  });

  it('extracts the latest summary content and keeps only non-summary pending messages', () => {
    const result = selectCompactionWindow(
      [
        createMessage({ messageId: 's1', type: 'system', role: 'system', content: 'sys' }),
        createMessage({
          messageId: 'sum_1',
          type: 'summary',
          role: 'user',
          content: 'old summary',
        }),
        createMessage({ messageId: 'u1', type: 'user', role: 'user', content: 'older question' }),
        createMessage({ messageId: 'u2', type: 'user', role: 'user', content: 'latest question' }),
      ],
      1
    );

    expect(result.previousSummary).toBe('old summary');
    expect(result.pendingMessages.map((message) => message.messageId)).toEqual(['u1']);
  });

  it('moves assistant/tool pairs into the active window together', () => {
    const result = selectCompactionWindow(
      [
        createMessage({ messageId: 's1', type: 'system', role: 'system', content: 'sys' }),
        createMessage({
          messageId: 'a1',
          type: 'tool-call',
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              index: 0,
              function: { name: 'bash', arguments: '{}' },
            },
          ],
        }),
        createMessage({ messageId: 'u1', type: 'user', role: 'user', content: 'latest user' }),
        createMessage({
          messageId: 't1',
          type: 'tool-result',
          role: 'tool',
          content: 'tool output',
          tool_call_id: 'call_1',
        }),
      ],
      1
    );

    expect(result.pendingMessages).toEqual([]);
    expect(result.activeMessages.map((message) => message.messageId)).toEqual(['a1', 't1', 'u1']);
  });

  it('treats summary type as summary even without a display prefix', () => {
    const result = selectCompactionWindow(
      [
        createMessage({ messageId: 's1', type: 'system', role: 'system', content: 'sys' }),
        createMessage({
          messageId: 'sum_plain',
          type: 'summary',
          role: 'user',
          content: 'plain summary content',
        }),
        createMessage({ messageId: 'u2', type: 'user', role: 'user', content: 'latest question' }),
      ],
      1
    );

    expect(result.previousSummary).toBe('plain summary content');
  });

  it('keeps unicode summary content unchanged', () => {
    const result = selectCompactionWindow(
      [
        createMessage({ messageId: 's1', type: 'system', role: 'system', content: 'sys' }),
        createMessage({
          messageId: 'sum_cn',
          type: 'summary',
          role: 'user',
          content: '中文摘要',
        }),
        createMessage({ messageId: 'u2', type: 'user', role: 'user', content: 'latest question' }),
      ],
      1
    );

    expect(result.previousSummary).toBe('中文摘要');
  });

  it('preserves fixed bootstrap user messages ahead of the summary window', () => {
    const result = selectCompactionWindow(
      [
        createMessage({ messageId: 's1', type: 'system', role: 'system', content: 'sys' }),
        createMessage({
          messageId: 'boot_1',
          type: 'user',
          role: 'user',
          content: 'Available skills for this conversation',
          metadata: {
            bootstrap: true,
            bootstrapKey: 'available-skills-v1',
            preserveInContext: true,
            fixedPosition: 'after-system',
          },
        }),
        createMessage({ messageId: 'u1', type: 'user', role: 'user', content: 'older question' }),
        createMessage({ messageId: 'u2', type: 'user', role: 'user', content: 'latest question' }),
      ],
      1
    );

    expect(result.preservedPrefixMessages.map((message) => message.messageId)).toEqual(['boot_1']);
    expect(result.pendingMessages.map((message) => message.messageId)).toEqual(['u1']);
    expect(result.activeMessages.map((message) => message.messageId)).toEqual(['u2']);
  });
});
