import { describe, expect, it } from 'vitest';
import type { Message } from '../../types';
import { contentToText, processToolCallPairs } from '../message';

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

describe('message utils', () => {
  it('contentToText handles empty, string and multimodal content', () => {
    expect(contentToText(undefined)).toBe('');
    expect(contentToText('hello')).toBe('hello');

    expect(
      contentToText([
        { type: 'text', text: 'line1' },
        { type: 'image_url', image_url: { url: 'http://img' } },
        { type: 'file', file: { filename: 'a.txt' } },
        { type: 'input_audio', input_audio: { data: 'x', format: 'mp3' } },
        { type: 'input_video', input_video: { file_id: 'v1' } },
      ])
    ).toBe('line1\n[image] http://img\n[file] a.txt\n[audio]\n[video] v1');
  });

  it('processToolCallPairs keeps assistant/tool pairs together', () => {
    const assistantPending = createMessage({
      messageId: 'a_pending',
      role: 'assistant',
      type: 'tool-call',
      tool_calls: [
        { id: 'c1', type: 'function', index: 0, function: { name: 'bash', arguments: '{}' } },
      ],
    });
    const pendingTool = createMessage({
      messageId: 't_pending',
      role: 'tool',
      type: 'tool-result',
      tool_call_id: 'c1',
      content: 'pending',
    });
    const pendingUser = createMessage({
      messageId: 'u_pending',
      role: 'user',
      type: 'user',
      content: 'u',
    });
    const activeTool = createMessage({
      messageId: 't_active',
      role: 'tool',
      type: 'tool-result',
      tool_call_id: 'c1',
      content: 'active',
    });
    const activeUser = createMessage({
      messageId: 'u_active',
      role: 'user',
      type: 'user',
      content: 'u2',
    });

    const result = processToolCallPairs(
      [assistantPending, pendingTool, pendingUser],
      [activeTool, activeUser]
    );

    expect(result.pending.map((message) => message.messageId)).toEqual(['u_pending']);
    expect(result.active.map((message) => message.messageId)).toEqual([
      'a_pending',
      't_active',
      'u_active',
    ]);
  });

  it('processToolCallPairs returns original arrays when no active tools need pairing', () => {
    const pending = [createMessage({ messageId: 'p1', role: 'user', type: 'user', content: 'p1' })];
    const active = [
      createMessage({ messageId: 'a1', role: 'assistant', type: 'assistant-text', content: 'a1' }),
    ];

    const result = processToolCallPairs(pending, active);

    expect(result.pending).toBe(pending);
    expect(result.active).toBe(active);
  });
});
