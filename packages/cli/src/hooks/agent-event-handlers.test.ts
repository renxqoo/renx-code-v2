import { describe, expect, it } from 'vitest';

import type {
  AgentToolResultEvent,
  AgentToolStreamEvent,
  AgentToolUseEvent,
} from '../agent/runtime/types';
import { buildAgentEventHandlers } from './agent-event-handlers';
import { appendToSegment } from './turn-updater';
import type { ReplySegment } from '../types/chat';

const buildHarness = () => {
  const turnId = 1;
  let segments: ReplySegment[] = [];
  const notes: string[] = [];

  const handlers = buildAgentEventHandlers({
    getTurnId: () => turnId,
    isCurrentRequest: () => true,
    appendSegment: (_turnId, segmentId, type, chunk, data) => {
      segments = appendToSegment(segments, segmentId, type, chunk, data);
    },
    appendEventLine: (_turnId, text) => {
      notes.push(text);
    },
  });

  return {
    turnId,
    handlers,
    readSegments: () => segments,
    notes,
  };
};

const createToolUseEvent = (): AgentToolUseEvent => ({
  id: 'call_1',
  function: {
    name: 'local_shell',
    arguments: JSON.stringify({ command: 'ls -la' }),
  },
});

const createStdoutStreamEvent = (): AgentToolStreamEvent => ({
  toolCallId: 'call_1',
  toolName: 'local_shell',
  type: 'stdout',
  sequence: 1,
  timestamp: Date.now(),
  content: 'total 80',
});

const createToolResultEvent = (): AgentToolResultEvent => ({
  toolCall: {
    id: 'call_1',
    function: {
      name: 'local_shell',
      arguments: JSON.stringify({ command: 'ls -la' }),
    },
  },
  result: {
    success: true,
    data: {
      output: 'total 80',
    },
  },
});

const createEmptyToolResultEvent = (): AgentToolResultEvent => ({
  toolCall: {
    id: 'call_2',
    function: {
      name: 'local_shell',
      arguments: JSON.stringify({ command: 'find /tmp -name missing' }),
    },
  },
  result: {
    success: true,
    data: {
      summary: 'Command completed successfully with no output.',
    },
  },
});

const createTaskToolUseEvent = (): AgentToolUseEvent => ({
  id: 'call_task_1',
  function: {
    name: 'task_update',
    arguments: JSON.stringify({
      taskId: 'task-1',
      status: 'in_progress',
    }),
  },
});

const createTaskToolResultEvent = (): AgentToolResultEvent => ({
  toolCall: {
    id: 'call_task_1',
    function: {
      name: 'task_update',
      arguments: JSON.stringify({
        taskId: 'task-1',
        status: 'in_progress',
      }),
    },
  },
  result: {
    success: true,
    data: {
      taskId: 'task-1',
      status: 'in_progress',
    },
  },
});

const createFlatToolUseEvent = (): AgentToolUseEvent => ({
  toolCallId: 'call_spawn_flat',
  toolName: 'spawn_agent',
  args: {
    role: 'Explore',
    description: 'Analyze UI Rendering',
  },
});

describe('buildAgentEventHandlers', () => {
  it('formats flat tool-use events with toolCallId and toolName', () => {
    const { handlers, readSegments, turnId } = buildHarness();

    handlers.onToolUse?.(createFlatToolUseEvent());

    const toolUse = readSegments().find(
      (segment) => segment.id === `${turnId}:tool-use:call_spawn_flat`
    );

    expect(toolUse?.content).toContain('# Tool: spawn_agent (call_spawn_flat)');
    expect(toolUse?.content).toContain('Analyze UI Rendering');
  });

  it('keeps ordered stream segments as thinking -> text -> thinking -> tool -> tool result', () => {
    const { handlers, readSegments, turnId } = buildHarness();

    handlers.onTextDelta?.({
      text: '先想一下要做什么。',
      isReasoning: true,
    });
    handlers.onTextDelta?.({
      text: '当前目录看起来是一个 TypeScript 项目。',
      isReasoning: false,
    });
    handlers.onTextDelta?.({
      text: '我会先执行 ls -la 看目录结构。',
      isReasoning: true,
    });
    handlers.onToolUse?.(createToolUseEvent());
    handlers.onToolStream?.(createStdoutStreamEvent());
    handlers.onToolResult?.(createToolResultEvent());
    handlers.onTextDelta?.({
      text: '当前目录包含以下内容。',
      isReasoning: false,
    });
    handlers.onTextComplete?.('');

    const segments = readSegments();
    expect(segments.map((segment) => segment.id)).toEqual([
      `${turnId}:thinking:1`,
      `${turnId}:text:2`,
      `${turnId}:thinking:3`,
      `${turnId}:tool-use:call_1`,
      `${turnId}:tool:call_1:stdout`,
      `${turnId}:tool-result:call_1`,
      `${turnId}:text:4`,
    ]);

    const firstThinkingIndex = segments.findIndex(
      (segment) => segment.id === `${turnId}:thinking:1`
    );
    const toolUseIndex = segments.findIndex(
      (segment) => segment.id === `${turnId}:tool-use:call_1`
    );
    const toolResultIndex = segments.findIndex(
      (segment) => segment.id === `${turnId}:tool-result:call_1`
    );
    expect(firstThinkingIndex).toBeGreaterThanOrEqual(0);
    expect(toolUseIndex).toBeGreaterThan(firstThinkingIndex);
    expect(toolResultIndex).toBeGreaterThan(toolUseIndex);
  });

  it('suppresses duplicated tool output in tool-result when stdout/stderr stream already exists', () => {
    const { handlers, readSegments, turnId } = buildHarness();

    handlers.onToolUse?.(createToolUseEvent());
    handlers.onToolStream?.(createStdoutStreamEvent());
    handlers.onToolResult?.(createToolResultEvent());

    const toolResult = readSegments().find(
      (segment) => segment.id === `${turnId}:tool-result:call_1`
    );
    expect(toolResult?.content).toContain('# Result: local_shell (call_1) success');
    expect(toolResult?.content).not.toContain('total 80');
  });

  it('keeps tool-result output when no stdout/stderr stream was emitted', () => {
    const { handlers, readSegments, turnId } = buildHarness();

    handlers.onToolUse?.(createToolUseEvent());
    handlers.onToolResult?.(createToolResultEvent());

    const toolResult = readSegments().find(
      (segment) => segment.id === `${turnId}:tool-result:call_1`
    );
    expect(toolResult?.content).toContain('# Result: local_shell (call_1) success');
    expect(toolResult?.content).toContain('total 80');
  });

  it('renders a summary instead of an output wrapper when tool succeeds without output', () => {
    const { handlers, readSegments, turnId } = buildHarness();

    handlers.onToolUse?.({
      id: 'call_2',
      function: {
        name: 'local_shell',
        arguments: JSON.stringify({ command: 'find /tmp -name missing' }),
      },
    });
    handlers.onToolResult?.(createEmptyToolResultEvent());

    const toolResult = readSegments().find(
      (segment) => segment.id === `${turnId}:tool-result:call_2`
    );
    expect(toolResult?.content).toContain('# Result: local_shell (call_2) success');
    expect(toolResult?.content).toContain('Command completed successfully with no output.');
    expect(toolResult?.content).not.toContain('{"output":""}');
  });

  it('stores structured tool event data on tool-use and tool-result segments', () => {
    const { handlers, readSegments, turnId } = buildHarness();

    const toolUseEvent = createToolUseEvent();
    const toolResultEvent = createToolResultEvent();
    handlers.onToolUse?.(toolUseEvent);
    handlers.onToolResult?.(toolResultEvent);

    const toolUse = readSegments().find((segment) => segment.id === `${turnId}:tool-use:call_1`);
    const toolResult = readSegments().find(
      (segment) => segment.id === `${turnId}:tool-result:call_1`
    );

    expect(toolUse?.data).toEqual(toolUseEvent);
    expect(toolResult?.data).toEqual(toolResultEvent);
  });

  it('stores execution attribution on tool-use and tool-result segments when present', () => {
    const { handlers, readSegments, turnId } = buildHarness();

    const toolUseEvent = {
      ...createToolUseEvent(),
      executionId: 'subexec_a',
    };
    const toolResultEvent = {
      ...createToolResultEvent(),
      toolCall: {
        ...(createToolResultEvent().toolCall as Record<string, unknown>),
        executionId: 'subexec_a',
      },
    };

    handlers.onToolUse?.(toolUseEvent);
    handlers.onToolResult?.(toolResultEvent);

    const toolUse = readSegments().find((segment) => segment.id === `${turnId}:tool-use:call_1`);
    const toolResult = readSegments().find(
      (segment) => segment.id === `${turnId}:tool-result:call_1`
    );

    expect(toolUse?.data).toEqual(toolUseEvent);
    expect(toolResult?.data).toEqual(toolResultEvent);
    expect((toolUse?.data as { executionId?: string } | undefined)?.executionId).toBe('subexec_a');
    expect(
      ((toolResult?.data as { toolCall?: { executionId?: string } } | undefined)?.toolCall
        ?.executionId)
    ).toBe('subexec_a');
  });

  it('stores structured tool-stream data on stream segments when present', () => {
    const { handlers, readSegments, turnId } = buildHarness();

    const streamEvent: AgentToolStreamEvent = {
      toolCallId: 'call_stream_attr_1',
      toolName: 'read_file',
      type: 'stdout',
      sequence: 1,
      timestamp: Date.now(),
      content: 'reading child file',
      data: {
        executionId: 'exec_child_stream_1',
        conversationId: 'subconv_stream_1',
      },
    };

    handlers.onToolStream?.(streamEvent);

    const streamSegment = readSegments().find(
      (segment) => segment.id === `${turnId}:tool:call_stream_attr_1:stdout`
    );

    expect(streamSegment?.data).toEqual(streamEvent.data);
    expect((streamSegment?.data as { executionId?: string } | undefined)?.executionId).toBe(
      'exec_child_stream_1'
    );
  });

  it('deduplicates repeated tool-use events for the same toolCallId', () => {
    const { handlers, readSegments, turnId } = buildHarness();

    handlers.onToolUse?.(createToolUseEvent());
    handlers.onToolUse?.(createToolUseEvent());
    handlers.onToolUse?.(createToolUseEvent());

    const toolUseSegments = readSegments().filter(
      (segment) => segment.id === `${turnId}:tool-use:call_1`
    );
    expect(toolUseSegments.length).toBe(1);
  });

  it('suppresses both task tool-use and task tool-result in chat segments', () => {
    const { handlers, readSegments, turnId } = buildHarness();

    handlers.onToolUse?.(createTaskToolUseEvent());
    handlers.onToolResult?.(createTaskToolResultEvent());

    const segments = readSegments();
    expect(segments.some((segment) => segment.id === `${turnId}:tool-use:call_task_1`)).toBe(false);
    expect(segments.some((segment) => segment.id === `${turnId}:tool-result:call_task_1`)).toBe(
      false
    );
  });
});
