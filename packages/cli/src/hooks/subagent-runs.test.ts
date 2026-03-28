import { describe, expect, it } from 'vitest';

import type { ChatTurn, ReplySegment } from '../types/chat';
import {
  buildConversationRunProjections,
  buildReplyRunProjection,
  type SubagentRunViewModel,
} from './subagent-runs';

const createToolUseSegment = (
  name: string,
  args: Record<string, unknown>,
  callId: string,
  extraData?: Record<string, unknown>
): ReplySegment => ({
  id: `1:tool-use:${callId}`,
  type: 'text',
  content: '',
  data: {
    id: callId,
    function: {
      name,
      arguments: JSON.stringify(args),
    },
    ...extraData,
  },
});

const createToolResultSegment = (
  name: string,
  data: Record<string, unknown>,
  callId: string,
  success = true,
  toolCallExtra?: Record<string, unknown>,
  resultExtra?: Record<string, unknown>
): ReplySegment => ({
  id: `1:tool-result:${callId}`,
  type: 'text',
  content: '',
  data: {
    toolCall: {
      id: callId,
      function: {
        name,
      },
      ...toolCallExtra,
    },
    result: {
      success,
      data,
      ...resultExtra,
    },
  },
});

const createReplyTurn = (segments: ReplySegment[]): ChatTurn => ({
  id: 1,
  prompt: 'analyze subagent ui',
  createdAtMs: 1,
  reply: {
    agentLabel: '',
    modelLabel: 'glm-5',
    durationSeconds: 1,
    segments,
    status: 'done',
  },
});

describe('subagent run projections', () => {
  it('builds one run from spawn, status, and wait results and hides raw tool groups', () => {
    const segments: ReplySegment[] = [
      createToolUseSegment(
        'spawn_agent',
        { role: 'Explore', description: 'Analyze UI Rendering' },
        'call_spawn_1'
      ),
      createToolResultSegment(
        'spawn_agent',
        {
          payload: {
            agentId: 'subexec_1',
            status: 'running',
            role: 'Explore',
            description: 'Analyze UI Rendering',
            linkedTaskId: 'task_101',
          },
        },
        'call_spawn_1'
      ),
      createToolUseSegment('agent_status', { agentId: 'subexec_1' }, 'call_status_1'),
      createToolResultSegment(
        'agent_status',
        {
          payload: {
            agentRun: {
              agentId: 'subexec_1',
              status: 'running',
              role: 'Explore',
              description: 'Analyze UI Rendering',
              linkedTaskId: 'task_101',
              progress: 52,
            },
          },
        },
        'call_status_1'
      ),
      createToolUseSegment('wait_agents', { agentIds: ['subexec_1'] }, 'call_wait_1'),
      createToolResultSegment(
        'wait_agents',
        {
          payload: {
            records: [
              {
                agentId: 'subexec_1',
                status: 'completed',
                role: 'Explore',
                description: 'Analyze UI Rendering',
                linkedTaskId: 'task_101',
                output: 'Final redesign summary',
              },
            ],
          },
        },
        'call_wait_1'
      ),
    ];

    const projection = buildReplyRunProjection(segments);
    const run = projection.runs[0] as SubagentRunViewModel;

    expect(projection.runs).toHaveLength(1);
    expect(run.runId).toBe('subexec_1');
    expect(run.title).toBe('Analyze UI Rendering');
    expect(run.role).toBe('Explore');
    expect(run.status).toBe('completed');
    expect(run.progress).toBe(52);
    expect(run.linkedTaskId).toBe('task_101');
    expect(run.outputPreview).toContain('Final redesign summary');
    expect(run.timeline.length).toBeGreaterThanOrEqual(3);
    expect(projection.hiddenToolCallIds).toEqual(['call_spawn_1', 'call_status_1', 'call_wait_1']);
  });

  it('parses runtime-shaped tool results for active parallel subagents', () => {
    const segments: ReplySegment[] = [
      createToolUseSegment(
        'spawn_agent',
        { role: 'Explore', description: 'Analyze Rendering' },
        'call_spawn_a'
      ),
      {
        id: '1:tool-result:call_spawn_a',
        type: 'text',
        content: '',
        data: {
          toolCall: {
            id: 'call_spawn_a',
            function: { name: 'spawn_agent' },
          },
          result: {
            success: true,
            data: {
              agentId: 'subexec_a',
              status: 'running',
              role: 'Explore',
              description: 'Analyze Rendering',
              linkedTaskId: 'task_a',
            },
          },
        },
      },
      createToolUseSegment(
        'spawn_agent',
        { role: 'Plan', description: 'Analyze State Flow' },
        'call_spawn_b'
      ),
      {
        id: '1:tool-result:call_spawn_b',
        type: 'text',
        content: '',
        data: {
          toolCall: {
            id: 'call_spawn_b',
            function: { name: 'spawn_agent' },
          },
          result: {
            success: true,
            data: {
              agentId: 'subexec_b',
              status: 'running',
              role: 'Plan',
              description: 'Analyze State Flow',
              linkedTaskId: 'task_b',
            },
          },
        },
      },
      createToolUseSegment('wait_agents', { agentIds: ['subexec_a', 'subexec_b'] }, 'call_wait_live'),
      {
        id: '1:tool-result:call_wait_live',
        type: 'text',
        content: '',
        data: {
          toolCall: {
            id: 'call_wait_live',
            function: { name: 'wait_agents' },
          },
          result: {
            success: true,
            data: {
              records: [
                {
                  agentId: 'subexec_a',
                  status: 'running',
                  role: 'Explore',
                  description: 'Analyze Rendering',
                  linkedTaskId: 'task_a',
                  output: 'Inspecting assistant-tool-group',
                },
                {
                  agentId: 'subexec_b',
                  status: 'running',
                  role: 'Plan',
                  description: 'Analyze State Flow',
                  linkedTaskId: 'task_b',
                  output: 'Comparing task refresh flow',
                },
              ],
            },
          },
        },
      },
    ];

    const projection = buildReplyRunProjection(segments);

    expect(projection.runs).toHaveLength(2);
    expect(projection.runs.map((run) => run.title)).toEqual(['Analyze Rendering', 'Analyze State Flow']);
    expect(projection.hiddenToolCallIds).toEqual(['call_spawn_a', 'call_spawn_b', 'call_wait_live']);
    expect(projection.runs[0]?.latestStatusLine ?? projection.runs[0]?.outputPreview).toContain('Inspecting assistant-tool-group');
    expect(projection.runs[1]?.latestStatusLine ?? projection.runs[1]?.outputPreview).toContain('Comparing task refresh flow');
  });

  it('hides tool calls that are attributed to a spawned subagent run while keeping parent tool calls visible', () => {
    const segments: ReplySegment[] = [
      createToolUseSegment(
        'spawn_agent',
        { role: 'Explore', description: 'Analyze Rendering' },
        'call_spawn_subagent'
      ),
      createToolResultSegment(
        'spawn_agent',
        {
          payload: {
            agentId: 'subexec_a',
            status: 'running',
            role: 'Explore',
            description: 'Analyze Rendering',
          },
        },
        'call_spawn_subagent'
      ),
      createToolUseSegment(
        'read_file',
        { path: 'src/components/chat/assistant-tool-group.tsx' },
        'call_child_read',
        { executionId: 'subexec_a' }
      ),
      createToolResultSegment(
        'read_file',
        {
          output: 'assistant-tool-group contents',
          summary: 'Read file',
        },
        'call_child_read',
        true,
        { executionId: 'subexec_a' }
      ),
      createToolUseSegment(
        'local_shell',
        { command: 'echo parent-visible', workdir: '/workspace' },
        'call_parent_shell',
        { executionId: 'exec_parent' }
      ),
      createToolResultSegment(
        'local_shell',
        {
          output: 'parent-visible',
          summary: 'Command completed successfully.',
        },
        'call_parent_shell',
        true,
        { executionId: 'exec_parent' }
      ),
    ];

    const projection = buildReplyRunProjection(segments);

    expect(projection.runs).toHaveLength(1);
    expect(projection.hiddenToolCallIds).toContain('call_spawn_subagent');
    expect(projection.hiddenToolCallIds).toContain('call_child_read');
    expect(projection.hiddenToolCallIds).not.toContain('call_parent_shell');
  });

  it('hides stream-only tool calls attributed to a spawned subagent run while keeping parent streams visible', () => {
    const segments: ReplySegment[] = [
      createToolUseSegment(
        'spawn_agent',
        { role: 'Explore', description: 'Analyze Rendering' },
        'call_spawn_stream_only'
      ),
      createToolResultSegment(
        'spawn_agent',
        {
          payload: {
            agentId: 'subexec_stream_only',
            executionId: 'exec_child_stream_only',
            runId: 'exec_child_stream_only',
            status: 'running',
            role: 'Explore',
            description: 'Analyze Rendering',
          },
        },
        'call_spawn_stream_only'
      ),
      {
        id: '1:tool:call_child_stream_only:stdout',
        type: 'code',
        content: 'reading child file\n',
        data: {
          executionId: 'exec_child_stream_only',
          conversationId: 'subconv_stream_only',
        },
      },
      {
        id: '1:tool:call_parent_stream_visible:stdout',
        type: 'code',
        content: 'parent stream\n',
        data: {
          executionId: 'exec_parent',
        },
      },
    ];

    const projection = buildReplyRunProjection(segments);

    expect(projection.runs).toHaveLength(1);
    expect(projection.hiddenToolCallIds).toContain('call_spawn_stream_only');
    expect(projection.hiddenToolCallIds).toContain('call_child_stream_only');
    expect(projection.hiddenToolCallIds).not.toContain('call_parent_stream_visible');
  });

  it('hides tool calls attributed by subagent executionId aliases while keeping parent tool calls visible', () => {
    const segments: ReplySegment[] = [
      createToolUseSegment(
        'spawn_agent',
        { role: 'Explore', description: 'Analyze Rendering' },
        'call_spawn_subagent_alias'
      ),
      createToolResultSegment(
        'spawn_agent',
        {
          payload: {
            agentId: 'subexec_a',
            executionId: 'exec_child_a',
            runId: 'exec_child_a',
            status: 'running',
            role: 'Explore',
            description: 'Analyze Rendering',
          },
        },
        'call_spawn_subagent_alias'
      ),
      createToolUseSegment(
        'read_file',
        { path: 'src/components/chat/assistant-tool-group.tsx' },
        'call_child_read_alias',
        { executionId: 'exec_child_a' }
      ),
      createToolResultSegment(
        'read_file',
        {
          output: 'assistant-tool-group contents',
          summary: 'Read file',
        },
        'call_child_read_alias',
        true,
        { executionId: 'exec_child_a' }
      ),
      createToolUseSegment(
        'local_shell',
        { command: 'echo parent-visible', workdir: '/workspace' },
        'call_parent_shell_alias',
        { executionId: 'exec_parent' }
      ),
      createToolResultSegment(
        'local_shell',
        {
          output: 'parent-visible',
          summary: 'Command completed successfully.',
        },
        'call_parent_shell_alias',
        true,
        { executionId: 'exec_parent' }
      ),
    ];

    const projection = buildReplyRunProjection(segments);

    expect(projection.runs).toHaveLength(1);
    expect(projection.runs[0]?.runId).toBe('subexec_a');
    expect(projection.hiddenToolCallIds).toContain('call_spawn_subagent_alias');
    expect(projection.hiddenToolCallIds).toContain('call_child_read_alias');
    expect(projection.hiddenToolCallIds).not.toContain('call_parent_shell_alias');
  });

  it('keeps recent completed runs in conversation projections', () => {
    const turns: ChatTurn[] = [
      createReplyTurn([
        createToolUseSegment(
          'spawn_agent',
          { role: 'Explore', description: 'Analyze UI Rendering' },
          'call_spawn_1'
        ),
        createToolResultSegment(
          'spawn_agent',
          {
            payload: {
              agentId: 'subexec_1',
              status: 'completed',
              role: 'Explore',
              description: 'Analyze UI Rendering',
              output: 'Final redesign summary',
            },
          },
          'call_spawn_1'
        ),
      ]),
    ];

    const runs = buildConversationRunProjections(turns);

    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('completed');
    expect(runs[0]?.artifacts[0]?.label).toContain('final output');
  });
});
