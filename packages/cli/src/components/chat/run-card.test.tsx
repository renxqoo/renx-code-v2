import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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
