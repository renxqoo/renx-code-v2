import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ReplySegment } from '../../types/chat';
import type { SubagentRunViewModel } from '../../hooks/subagent-runs';
import { AssistantReply } from './assistant-reply';

const createRun = (overrides: Partial<SubagentRunViewModel> = {}): SubagentRunViewModel => ({
  runId: 'subexec_1',
  title: 'Analyze UI Rendering',
  role: 'Explore',
  status: 'running',
  statusText: 'running',
  progress: 52,
  linkedTaskId: 'task_101',
  latestStatusLine: '正在分析 assistant-tool-group',
  highlights: [
    {
      id: 'h1',
      kind: 'insight',
      text: 'special presentation 绕开了默认 stream 合并',
      timestamp: 1,
    },
  ],
  artifacts: [],
  timeline: [
    { id: 't1', kind: 'status', text: '正在分析 assistant-tool-group', timestamp: 1 },
    { id: 't2', kind: 'insight', text: 'special presentation 绕开了默认 stream 合并', timestamp: 2 },
  ],
  outputPreview: undefined,
  finalSummary: undefined,
  firstSeenIndex: 1,
  updatedAt: 2,
  ...overrides,
});

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

describe('AssistantReply subagent runs', () => {
  it('renders run cards before generic tool groups', () => {
    const reply = {
      agentLabel: '',
      modelLabel: 'glm-5',
      durationSeconds: 1,
      status: 'done' as const,
      segments: [],
      runProjections: [createRun()],
    };

    const { container } = render(<AssistantReply reply={reply} />);
    const text = container.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    expect(text).toContain('Analyze UI Rendering');
    expect(text).toContain('Explore');
    expect(text).toContain('52%');
    expect(text).toContain('task_101');
    expect(text).toContain('special presentation 绕开了默认 stream 合并');
  });

  it('hides raw spawn_agent tool cards while streaming before the tool result arrives', () => {
    const reply = {
      agentLabel: '',
      modelLabel: 'glm-5',
      durationSeconds: 1,
      status: 'streaming' as const,
      segments: [
        createToolUseSegment(
          'spawn_agent',
          { role: 'Explore', description: 'Analyze UI Rendering' },
          'call_spawn_streaming'
        ),
      ],
    };

    const { container } = render(<AssistantReply reply={reply} />);
    const text = container.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    expect(text).not.toContain('spawn agent');
    expect(text).not.toContain('Analyze UI Rendering');
  });

  it('renders run cards near their first matching tool position instead of always at the top', () => {
    const reply = {
      agentLabel: '',
      modelLabel: 'glm-5',
      durationSeconds: 1,
      status: 'done' as const,
      segments: [
        { id: '1:text:intro', type: 'text' as const, content: '我先分两条线分析。' },
        createToolUseSegment(
          'spawn_agent',
          { role: 'Explore', description: 'Analyze UI Rendering' },
          'call_spawn_ready'
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
          'call_spawn_ready'
        ),
        { id: '1:text:summary', type: 'text' as const, content: '当前已发现两个结构性问题。' },
      ],
    };

    const { container } = render(<AssistantReply reply={reply} />);
    const root = container.querySelector('box');
    const children = root ? Array.from(root.children) : [];
    const runChildIndex = children.findIndex((child) =>
      (child.textContent?.replace(/\s+/g, ' ').trim() ?? '').includes('Analyze UI Rendering')
    );

    expect(runChildIndex).toBeGreaterThan(0);
  });

  it('shows completed run summaries and artifact actions', () => {
    const reply = {
      agentLabel: '',
      modelLabel: 'glm-5',
      durationSeconds: 1,
      status: 'done' as const,
      segments: [],
      runProjections: [
        createRun({
          status: 'completed',
          statusText: 'completed',
          progress: 100,
          finalSummary: '当前子agent展示本质上是工具结果化，不是运行实体化。',
          artifacts: [{ id: 'a1', label: 'summary report', content: 'available' }],
        }),
      ],
    };

    const { container } = render(<AssistantReply reply={reply} />);
    const text = container.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    expect(text).toContain('summary');
    expect(text).toContain('当前子agent展示本质上是工具结果化，不是运行实体化。');
    expect(text).not.toContain('[A 产物]');
  });

  it('merges live run projection hiding with stale reply caches while streaming', () => {
    const reply = {
      agentLabel: '',
      modelLabel: 'glm-5',
      durationSeconds: 1,
      status: 'streaming' as const,
      segments: [
        createToolUseSegment(
          'spawn_agent',
          { role: 'Explore', description: 'Analyze Rendering' },
          'call_spawn_live_merge'
        ),
        createToolResultSegment(
          'spawn_agent',
          {
            payload: {
              agentId: 'subexec_live_merge',
              executionId: 'exec_live_merge',
              runId: 'exec_live_merge',
              status: 'running',
              role: 'Explore',
              description: 'Analyze Rendering',
            },
          },
          'call_spawn_live_merge'
        ),
        createToolUseSegment(
          'read_file',
          { path: 'src/components/chat/assistant-tool-group.tsx' },
          'call_child_read_live_merge',
          { executionId: 'exec_live_merge' }
        ),
      ],
      runProjections: [],
      hiddenToolCallIds: [],
    };

    const { container } = render(<AssistantReply reply={reply} />);
    const text = container.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    expect(text).toContain('Analyze Rendering');
    expect(text).not.toContain('read file');
    expect(text).not.toContain('assistant-tool-group.tsx');
  });

  it('merges stale cached run projections with fresh reply projections from the same reply', () => {
    const reply = {
      agentLabel: '',
      modelLabel: 'glm-5',
      durationSeconds: 1,
      status: 'streaming' as const,
      segments: [
        { id: '1:text:intro', type: 'text' as const, content: '我先并行启动两条子线。' },
        createToolUseSegment(
          'spawn_agent',
          { role: 'Explore', description: 'Analyze Rendering' },
          'call_spawn_merge_a'
        ),
        createToolResultSegment(
          'spawn_agent',
          {
            payload: {
              agentId: 'subexec_merge_a',
              executionId: 'subexec_merge_a',
              runId: 'subexec_merge_a',
              status: 'running',
              role: 'Explore',
              description: 'Analyze Rendering',
              linkedTaskId: 'task_merge_a',
            },
          },
          'call_spawn_merge_a'
        ),
        createToolUseSegment(
          'spawn_agent',
          { role: 'Plan', description: 'Analyze State Flow' },
          'call_spawn_merge_b'
        ),
        createToolResultSegment(
          'spawn_agent',
          {
            payload: {
              agentId: 'subexec_merge_b',
              executionId: 'subexec_merge_b',
              runId: 'subexec_merge_b',
              status: 'running',
              role: 'Plan',
              description: 'Analyze State Flow',
              linkedTaskId: 'task_merge_b',
            },
          },
          'call_spawn_merge_b'
        ),
        createToolUseSegment(
          'local_shell',
          { command: 'echo parent-visible', workdir: '/workspace' },
          'call_parent_visible_merge'
        ),
        createToolResultSegment(
          'local_shell',
          { output: 'parent-visible', summary: 'Command completed successfully.' },
          'call_parent_visible_merge'
        ),
      ],
      runProjections: [
        createRun({
          runId: 'subexec_merge_a',
          title: 'Analyze Rendering',
          role: 'Explore',
          linkedTaskId: 'task_merge_a',
        }),
      ],
    };

    const { container } = render(<AssistantReply reply={reply} />);
    const text = container.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    expect(text).toContain('Analyze Rendering');
    expect(text).toContain('Analyze State Flow');
    expect(text).toContain('$ echo parent-visible');
    expect(text).toContain('parent-visible');
  });

  it('prefers run cards over wait_agents tool groups for active parallel subagents', () => {
    const reply = {
      agentLabel: '',
      modelLabel: 'glm-5',
      durationSeconds: 1,
      status: 'streaming' as const,
      segments: [
        createToolUseSegment('spawn_agent', { role: 'Explore', description: 'Analyze Rendering' }, 'call_spawn_a'),
        {
          id: '1:tool-result:call_spawn_a',
          type: 'text' as const,
          content: '',
          data: {
            toolCall: { id: 'call_spawn_a', function: { name: 'spawn_agent' } },
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
        createToolUseSegment('spawn_agent', { role: 'Plan', description: 'Analyze State Flow' }, 'call_spawn_b'),
        {
          id: '1:tool-result:call_spawn_b',
          type: 'text' as const,
          content: '',
          data: {
            toolCall: { id: 'call_spawn_b', function: { name: 'spawn_agent' } },
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
          type: 'text' as const,
          content: '',
          data: {
            toolCall: { id: 'call_wait_live', function: { name: 'wait_agents' } },
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
      ],
    };

    const { container } = render(<AssistantReply reply={reply} />);
    const text = container.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    expect(text).toContain('Analyze Rendering');
    expect(text).toContain('Analyze State Flow');
    expect(text).toContain('Inspecting assistant-tool-group');
    expect(text).toContain('Comparing task refresh flow');
    expect(text).not.toContain('wait agents');
  });

  it('hides child tool groups attributed to a subagent run while keeping parent tool groups visible', () => {
    const reply = {
      agentLabel: '',
      modelLabel: 'glm-5',
      durationSeconds: 1,
      status: 'streaming' as const,
      segments: [
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
          { output: 'child hidden output', summary: 'Read file' },
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
          { output: 'parent-visible', summary: 'Command completed successfully.' },
          'call_parent_shell',
          true,
          { executionId: 'exec_parent' }
        ),
      ],
    };

    const { container } = render(<AssistantReply reply={reply} />);
    const text = container.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    expect(text).toContain('Analyze Rendering');
    expect(text).not.toContain('child hidden output');
    expect(text).not.toContain('assistant-tool-group.tsx');
    expect(text).toContain('$ echo parent-visible');
    expect(text).toContain('parent-visible');
  });
});
