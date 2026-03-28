import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RunInspector } from './run-inspector';

const run = {
  runId: 'subexec_1',
  title: 'Analyze UI Rendering',
  role: 'Explore',
  status: 'running' as const,
  statusText: 'running',
  progress: 52,
  linkedTaskId: 'task_101',
  latestStatusLine: '正在分析 assistant-tool-group',
  highlights: [{ id: 'h1', kind: 'insight' as const, text: '发现 special path 绕过默认流合并', timestamp: 1 }],
  artifacts: [{ id: 'a1', label: 'final output', content: 'Final redesign summary' }],
  timeline: [{ id: 't1', kind: 'status' as const, text: '正在分析 assistant-tool-group', timestamp: 1 }],
  outputPreview: 'Final redesign summary',
  finalSummary: '当前子agent展示本质上仍依赖工具卡片模型。',
  firstSeenIndex: 1,
  updatedAt: 1,
};

describe('RunInspector', () => {
  it('renders tabs, footer hints, and the meta view by default', () => {
    const { container } = render(
      <RunInspector visible viewportWidth={120} viewportHeight={40} run={run} />
    );

    const text = container.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    expect(text).toContain('Run Inspector');
    expect(text).toContain('Analyze UI Rendering');
    expect(text).toContain('Tabs: [Meta] [Timeline] [Artifacts] [Debug]');
    expect(text).toContain('Meta');
    expect(text).toContain('Explore');
    expect(text).toContain('task_101');
    expect(text).toContain('running');
    expect(text).toContain('52%');
    expect(text).toContain('Footer: Esc 返回 · ←→ 切换 Tab');
  });

  it('renders the requested timeline tab view', () => {
    const { container } = render(
      <RunInspector visible viewportWidth={120} viewportHeight={40} run={run} initialTab="Timeline" />
    );

    const text = container.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    expect(text).toContain('Timeline');
    expect(text).toContain('status');
    expect(text).toContain('正在分析 assistant-tool-group');
    expect(text).not.toContain('summary · 当前子agent展示本质上仍依赖工具卡片模型。');
  });

  it('switches tab view when activeTab changes', () => {
    const { container, rerender } = render(
      <RunInspector visible viewportWidth={120} viewportHeight={40} run={run} activeTab="Meta" />
    );

    rerender(
      <RunInspector visible viewportWidth={120} viewportHeight={40} run={run} activeTab="Artifacts" />
    );

    const text = container.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    expect(text).toContain('Artifacts');
    expect(text).toContain('final output');
    expect(text).toContain('Final redesign summary');
    expect(text).not.toContain('summary · 当前子agent展示本质上仍依赖工具卡片模型。');
  });
});
