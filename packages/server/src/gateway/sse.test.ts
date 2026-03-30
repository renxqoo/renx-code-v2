import { describe, it, expect } from 'vitest';
import { formatSSE, formatSSEDone, createOpenAIChunk, createOpenAIFinishChunk } from './sse';

describe('SSE formatting', () => {
  it('formatSSE should format data-only event', () => {
    const result = formatSSE({ data: 'hello' });
    expect(result).toBe('data: hello\n\n');
  });

  it('formatSSE should format event with type and id', () => {
    const result = formatSSE({ data: 'test', event: 'message', id: '1' });
    expect(result).toContain('event: message\n');
    expect(result).toContain('id: 1\n');
    expect(result).toContain('data: test\n\n');
  });

  it('formatSSEDone should return DONE signal', () => {
    expect(formatSSEDone()).toBe('data: [DONE]\n\n');
  });

  it('createOpenAIChunk should produce valid JSON', () => {
    const json = createOpenAIChunk('id-1', 'Hello', 'gpt-4');
    const parsed = JSON.parse(json);
    expect(parsed.object).toBe('chat.completion.chunk');
    expect(parsed.choices[0].delta.content).toBe('Hello');
    expect(parsed.choices[0].finish_reason).toBeNull();
  });

  it('createOpenAIFinishChunk should have stop reason', () => {
    const json = createOpenAIFinishChunk('id-1', 'gpt-4');
    const parsed = JSON.parse(json);
    expect(parsed.choices[0].finish_reason).toBe('stop');
    expect(parsed.choices[0].delta).toEqual({});
  });
});
