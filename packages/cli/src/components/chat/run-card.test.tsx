import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ConversationPanel } from '../conversation-panel';
import { RunCard } from './run-card';

const createRun = (overrides = {}) => ({
  runId: 'subexec_1',
  title: 'Analyze UI Rendering',
  role: 'Explore',
  status: 'running' as const,
  statusText: 'running',
  progress: 52,
  linkedTaskId: 'task_101',
  latestStatusLine: '正在分析 assistant-tool-group',
  highlights: [
    { id: 'h1', kind: 'insight' as const, text: '发现 special path 绕过默认流合并', timestamp: 1 },
    { id: 'h2', kind: 'warning' as const, text: 'tool payload shape still varies by provider', timestamp: 2 },
  ],
  artifacts: [
    { id: 'a1', label: 'final output', content: 'Final redesign summary' },
    { id: 'a2', label: 'timeline snapshot' },
  ],
  timeline: [
    { id: 't1', kind: 'status' as const, text: 'queued', timestamp: 1 },
    { id: 't2', kind: 'status' as const, text: 'querying assistant-tool-group', timestamp: 2 },
  ],
  outputPreview: 'Final redesign summary',
  finalSummary: undefined,
  firstSeenIndex: 1,
  updatedAt: 2,
  ...overrides,
});

describe('ConversationPanel', () => {
  it('renders global active runs in the conversation even when the current reply only has one local run', () => {
    const turns = [
      {
        id: 1,
        prompt: 'analyze repo',
        createdAtMs: 1,
        reply: {
          agentLabel: '',
          modelLabel: 'glm-5',
          durationSeconds: 1,
          status: 'streaming' as const,
          segments: [],
        },
      },
    ];

    const activeRuns = [
      createRun({ runId: 'subexec_a', title: 'Analyze Rendering', firstSeenIndex: 1, updatedAt: 1 }),
      createRun({ runId: 'subexec_b', title: 'Analyze State Flow', firstSeenIndex: 1, updatedAt: 2 }),
      createRun({ runId: 'subexec_c', title: 'Analyze Tool Routing', firstSeenIndex: 1, updatedAt: 3 }),
      createRun({ runId: 'subexec_d', title: 'Analyze Tests', firstSeenIndex: 1, updatedAt: 4 }),
    ];

    const { container } = render(
      <ConversationPanel turns={turns} isThinking={true} activeRuns={activeRuns} />
    );
    const text = container.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    expect(text).toContain('Analyze Rendering');
    expect(text).toContain('Analyze State Flow');
    expect(text).toContain('Analyze Tool Routing');
    expect(text).toContain('Analyze Tests');
  });
});

describe('RunCard', () => {
  it('shows a compact default summary without leaking the full timeline', () => {
    const { container } = render(<RunCard run={createRun()} />);
    const text = container.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    expect(text).toContain('Analyze UI Rendering');
    expect(text).toContain('Explore');
    expect(text).toContain('running');
    expect(text).toContain('52%');
    expect(text).toContain('task_101');
    expect(text).toContain('正在分析 assistant-tool-group');
    expect(text).toContain('发现 special path 绕过默认流合并');
    expect(text).toContain('tool payload shape still varies by provider');
    expect(text).toContain('Artifacts 2 available');
    expect(text).not.toContain('[I 详情]');
    expect(text).not.toContain('[A 产物]');
    expect(text).not.toContain('querying assistant-tool-group');
    expect(text).not.toContain('Final redesign summary');
    expect(text).not.toContain('□ final output');
  });

  it('shows summary and key findings for completed runs', () => {
    const { container } = render(
      <RunCard
        run={createRun({
          status: 'completed',
          statusText: 'completed',
          progress: 100,
          finalSummary: '当前子agent展示本质上是工具结果化，不是运行实体化。',
        })}
      />
    );
    const text = container.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    expect(text).toContain('summary');
    expect(text).toContain('当前子agent展示本质上是工具结果化，不是运行实体化。');
    expect(text).toContain('key findings');
    expect(text).toContain('发现 special path 绕过默认流合并');
  });
});
