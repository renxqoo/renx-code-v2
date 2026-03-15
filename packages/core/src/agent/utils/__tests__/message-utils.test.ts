import { describe, expect, it } from 'vitest';
import { contentToText, processToolCallPairs } from '../message';
import type { Message } from '../../types';

const createMessage = (overrides: Partial<Message> = {}): Message => ({
  messageId: 'msg_1',
  type: 'user',
  role: 'user',
  content: '',
  timestamp: Date.now(),
  ...overrides,
});

describe('contentToText', () => {
  it('returns empty string for undefined content', () => {
    expect(contentToText(undefined)).toBe('');
  });

  it('returns string content as-is', () => {
    expect(contentToText('Hello')).toBe('Hello');
  });

  it('returns empty string for empty string', () => {
    expect(contentToText('')).toBe('');
  });

  it('converts array of text parts', () => {
    expect(
      contentToText([
        { type: 'text', text: 'Hello' },
        { type: 'text', text: 'World' },
      ])
    ).toBe('Hello\nWorld');
  });

  it('filters empty text parts', () => {
    expect(
      contentToText([
        { type: 'text', text: 'Hello' },
        { type: 'text', text: '' },
        { type: 'text', text: 'World' },
      ])
    ).toBe('Hello\nWorld');
  });

  it('formats multimodal parts into readable text', () => {
    expect(
      contentToText([
        { type: 'text', text: 'Text' },
        { type: 'image_url', image_url: { url: 'http://example.com/image.png' } },
        { type: 'file', file: { filename: 'a.txt' } },
        { type: 'input_audio', input_audio: { data: 'audio', format: 'wav' } },
        { type: 'input_video', input_video: { file_id: 'video_1' } },
      ])
    ).toBe('Text\n[image] http://example.com/image.png\n[file] a.txt\n[audio]\n[video] video_1');
  });

  it('handles empty metadata for multimodal parts', () => {
    expect(
      contentToText([
        { type: 'image_url', image_url: { url: '' } },
        { type: 'file', file: {} as never },
        { type: 'input_video', input_video: {} as never },
      ])
    ).toBe('[image]\n[file]\n[video]');
  });

  it('returns empty string for non-string, non-array content', () => {
    expect(contentToText(123 as never)).toBe('');
    expect(contentToText({} as never)).toBe('');
    expect(contentToText(null as never)).toBe('');
  });

  it('handles empty array', () => {
    expect(contentToText([])).toBe('');
  });
});

describe('processToolCallPairs', () => {
  const createAssistantMessage = (toolCallIds: string[]): Message =>
    createMessage({
      role: 'assistant',
      type: 'tool-call',
      content: '',
      tool_calls: toolCallIds.map((callId, index) => ({
        id: callId,
        type: 'function',
        index,
        function: { name: `tool_${index}`, arguments: '{}' },
      })),
    });

  const createToolMessage = (toolCallId: string): Message =>
    createMessage({
      role: 'tool',
      type: 'tool-result',
      content: 'Result',
      tool_call_id: toolCallId,
    });

  it('returns unchanged when no tool calls need pairing', () => {
    const pending: Message[] = [];
    const active: Message[] = [
      createMessage({ role: 'user', content: 'Hello' }),
      createMessage({ role: 'assistant', type: 'assistant-text', content: 'Hi' }),
    ];

    const result = processToolCallPairs(pending, active);

    expect(result.pending).toEqual(pending);
    expect(result.active).toEqual(active);
  });

  it('moves assistant and active tool messages together', () => {
    const assistant = createAssistantMessage(['call_1']);
    const tool = createToolMessage('call_1');

    const result = processToolCallPairs(
      [assistant],
      [createMessage({ role: 'user', content: 'Hello' }), tool]
    );

    expect(result.pending).toHaveLength(0);
    expect(result.active).toContain(assistant);
    expect(result.active).toContain(tool);
  });

  it('handles multiple tool calls from one assistant message', () => {
    const assistant = createAssistantMessage(['call_1', 'call_2']);
    const tool1 = createToolMessage('call_1');
    const tool2 = createToolMessage('call_2');

    const result = processToolCallPairs([assistant], [tool1, tool2]);

    expect(result.pending).toHaveLength(0);
    expect(result.active).toContain(assistant);
    expect(result.active).toContain(tool1);
    expect(result.active).toContain(tool2);
  });

  it('drops pending tool messages that belong to the moved assistant call ids', () => {
    const assistant = createAssistantMessage(['call_1']);
    const pendingTool = createToolMessage('call_1');
    const activeTool = createToolMessage('call_1');

    const result = processToolCallPairs([assistant, pendingTool], [activeTool]);

    expect(result.pending).toEqual([]);
    expect(result.active).toEqual([assistant, activeTool]);
  });

  it('keeps unrelated tool results untouched', () => {
    const assistant = createAssistantMessage(['call_1']);
    const unrelatedPendingTool = createToolMessage('call_2');
    const activeTool = createToolMessage('call_1');

    const result = processToolCallPairs([assistant, unrelatedPendingTool], [activeTool]);

    expect(result.pending).toEqual([unrelatedPendingTool]);
    expect(result.active).toEqual([assistant, activeTool]);
  });

  it('handles tool message without matching assistant', () => {
    const active = [createToolMessage('call_1')];
    const result = processToolCallPairs([], active);

    expect(result.pending).toEqual([]);
    expect(result.active).toEqual(active);
  });

  it('handles empty arrays', () => {
    expect(processToolCallPairs([], [])).toEqual({ pending: [], active: [] });
  });
});
