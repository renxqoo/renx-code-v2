import { describe, expect, it } from 'vitest';
import type { Message } from '../../types';
import { contentToText, processToolCallPairs, repairToolProtocolMessages } from '../message';

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

  it('repairToolProtocolMessages inserts a synthetic tool result when a tool call has no matching result', () => {
    const assistant = createMessage({
      messageId: 'assistant_1',
      role: 'assistant',
      type: 'tool-call',
      content: '',
      timestamp: 100,
      tool_calls: [
        { id: 'call_1', type: 'function', index: 0, function: { name: 'bash', arguments: '{}' } },
      ],
    });
    const user = createMessage({
      messageId: 'user_1',
      role: 'user',
      type: 'user',
      content: 'continue',
      timestamp: 200,
    });

    const result = repairToolProtocolMessages([assistant, user], {
      createMessageId: () => 'msg_synthetic_1',
    });

    expect(result.stats).toEqual({
      syntheticToolResultCount: 1,
      droppedOrphanToolResultCount: 0,
    });
    expect(result.messages).toHaveLength(3);
    expect(result.messages[0]).toBe(assistant);
    expect(result.messages[1]).toMatchObject({
      messageId: 'msg_synthetic_1',
      role: 'tool',
      type: 'tool-result',
      tool_call_id: 'call_1',
      timestamp: 200,
      metadata: {
        syntheticToolResult: true,
        syntheticToolResultReason: 'missing_tool_result',
        syntheticToolResultSourceAssistantMessageId: 'assistant_1',
      },
    });
    expect(result.messages[2]).toBe(user);
    expect(result.messages[1]?.content).toContain('tool result missing');
  });

  it('repairToolProtocolMessages drops orphan tool results that have no matching tool call', () => {
    const orphanTool = createMessage({
      messageId: 'tool_orphan',
      role: 'tool',
      type: 'tool-result',
      content: 'orphan',
      tool_call_id: 'call_orphan',
    });
    const user = createMessage({
      messageId: 'user_1',
      role: 'user',
      type: 'user',
      content: 'hello',
    });

    const result = repairToolProtocolMessages([orphanTool, user]);

    expect(result.stats).toEqual({
      syntheticToolResultCount: 0,
      droppedOrphanToolResultCount: 1,
    });
    expect(result.messages).toEqual([user]);
  });

  it('repairToolProtocolMessages preserves matched tool results and only synthesizes missing ones', () => {
    const assistant = createMessage({
      messageId: 'assistant_1',
      role: 'assistant',
      type: 'tool-call',
      content: '',
      timestamp: 100,
      tool_calls: [
        { id: 'call_1', type: 'function', index: 0, function: { name: 'bash', arguments: '{}' } },
        { id: 'call_2', type: 'function', index: 1, function: { name: 'node', arguments: '{}' } },
      ],
    });
    const tool = createMessage({
      messageId: 'tool_call_1',
      role: 'tool',
      type: 'tool-result',
      content: 'ok',
      tool_call_id: 'call_1',
      timestamp: 150,
    });
    const user = createMessage({
      messageId: 'user_1',
      role: 'user',
      type: 'user',
      content: 'next',
      timestamp: 300,
    });

    const result = repairToolProtocolMessages([assistant, tool, user], {
      createMessageId: () => 'msg_synthetic_2',
    });

    expect(result.stats).toEqual({
      syntheticToolResultCount: 1,
      droppedOrphanToolResultCount: 0,
    });
    expect(result.messages.map((message) => message.messageId)).toEqual([
      'assistant_1',
      'tool_call_1',
      'msg_synthetic_2',
      'user_1',
    ]);
    expect(result.messages[2]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_2',
      timestamp: 300,
    });
  });
});
