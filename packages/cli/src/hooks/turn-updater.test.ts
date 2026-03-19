import { describe, expect, it } from 'vitest';

import {
  SHELL_STREAM_HEAD_CHARS,
  SHELL_STREAM_MAX_CHARS,
  SHELL_STREAM_TAIL_CHARS,
  SHELL_STREAM_TRUNCATION_MARKER,
  appendToSegment,
  createStreamingReply,
  orderReplySegments,
} from './turn-updater';
import type { ReplySegment } from '../types/chat';

describe('createStreamingReply', () => {
  it('initializes startedAtMs for realtime duration display', () => {
    const before = Date.now();
    const reply = createStreamingReply('glm-5');
    const after = Date.now();

    expect(typeof reply.startedAtMs).toBe('number');
    expect((reply.startedAtMs as number) >= before).toBe(true);
    expect((reply.startedAtMs as number) <= after).toBe(true);
    expect(reply.status).toBe('streaming');
    expect(reply.durationSeconds).toBe(0);
  });
});

describe('orderReplySegments', () => {
  it('keeps each tool-result adjacent to its tool-use for concurrent multi-tool calls', () => {
    const input: ReplySegment[] = [
      { id: '1:thinking:1', type: 'thinking', content: '先并发调用4个工具。' },
      { id: '1:tool-use:call_a', type: 'code', content: '# Tool A\n' },
      { id: '1:tool-use:call_b', type: 'code', content: '# Tool B\n' },
      { id: '1:tool-use:call_c', type: 'code', content: '# Tool C\n' },
      { id: '1:tool-use:call_d', type: 'code', content: '# Tool D\n' },
      { id: '1:tool-result:call_c', type: 'code', content: '# Result C\n' },
      { id: '1:tool-result:call_a', type: 'code', content: '# Result A\n' },
      { id: '1:tool-result:call_d', type: 'code', content: '# Result D\n' },
      { id: '1:tool-result:call_b', type: 'code', content: '# Result B\n' },
      { id: '1:text:2', type: 'text', content: '工具执行结束。' },
    ];

    const ordered = orderReplySegments(input);
    expect(ordered.map((segment) => segment.id)).toEqual([
      '1:thinking:1',
      '1:tool-use:call_a',
      '1:tool-result:call_a',
      '1:tool-use:call_b',
      '1:tool-result:call_b',
      '1:tool-use:call_c',
      '1:tool-result:call_c',
      '1:tool-use:call_d',
      '1:tool-result:call_d',
      '1:text:2',
    ]);
  });

  it('keeps stream output between its tool-use and tool-result', () => {
    const input: ReplySegment[] = [
      { id: '1:tool-use:call_1', type: 'code', content: '# Tool 1\n' },
      { id: '1:tool-use:call_2', type: 'code', content: '# Tool 2\n' },
      { id: '1:tool:call_2:stdout', type: 'code', content: 'line2\n' },
      { id: '1:tool:call_1:stdout', type: 'code', content: 'line1\n' },
      { id: '1:tool-result:call_2', type: 'code', content: '# Result 2\n' },
      { id: '1:tool-result:call_1', type: 'code', content: '# Result 1\n' },
    ];

    const ordered = orderReplySegments(input);
    expect(ordered.map((segment) => segment.id)).toEqual([
      '1:tool-use:call_1',
      '1:tool:call_1:stdout',
      '1:tool-result:call_1',
      '1:tool-use:call_2',
      '1:tool:call_2:stdout',
      '1:tool-result:call_2',
    ]);
  });
});

describe('appendToSegment', () => {
  it('bounds shell stream segments and keeps the latest tail when output keeps growing', () => {
    let segments: ReplySegment[] = [];
    const segmentId = '1:tool:call_1:stdout';

    segments = appendToSegment(segments, segmentId, 'code', 'a'.repeat(SHELL_STREAM_MAX_CHARS));
    segments = appendToSegment(segments, segmentId, 'code', 'b'.repeat(4000));
    segments = appendToSegment(segments, segmentId, 'code', 'c'.repeat(4000));

    const streamSegment = segments.find((segment) => segment.id === segmentId);
    expect(streamSegment).toBeDefined();
    expect(streamSegment?.content).toContain(SHELL_STREAM_TRUNCATION_MARKER);
    expect(streamSegment?.content.startsWith('a'.repeat(SHELL_STREAM_HEAD_CHARS))).toBe(true);
    expect(streamSegment?.content.endsWith('b'.repeat(4000) + 'c'.repeat(4000))).toBe(true);
    expect(streamSegment?.content.length).toBe(
      SHELL_STREAM_HEAD_CHARS +
        SHELL_STREAM_TRUNCATION_MARKER.length +
        SHELL_STREAM_TAIL_CHARS
    );
  });

  it('does not truncate non-stream code segments', () => {
    const segmentId = '1:tool-result:call_1';
    const content = 'x'.repeat(SHELL_STREAM_MAX_CHARS + 1000);
    const segments = appendToSegment([], segmentId, 'code', content);

    const resultSegment = segments.find((segment) => segment.id === segmentId);
    expect(resultSegment?.content).toBe(content);
    expect(resultSegment?.content).not.toContain(SHELL_STREAM_TRUNCATION_MARKER);
  });
});
