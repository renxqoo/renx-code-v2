import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { RunsSummaryItem } from '../hooks/use-task-panel';
import { TaskPanel } from './task-panel';

const createItem = (overrides: Partial<RunsSummaryItem> = {}): RunsSummaryItem => ({
  key: 'run_1',
  runId: 'run_1',
  title: 'Analyze UI Rendering',
  status: 'running',
  progress: 52,
  role: 'Explore',
  subtitle: 'task task_101',
  latest: '正在分析 assistant-tool-group',
  updatedAt: 2,
  isRecent: false,
  ...overrides,
});

describe('TaskPanel as runs summary', () => {
  it('renders active, blocked and recent run groups', () => {
    const { container } = render(
      <TaskPanel
        visible
        loading={false}
        error={null}
        namespace="session_01"
        selectedIndex={0}
        onSelectIndex={() => {}}
        tasks={[
          createItem(),
          createItem({
            key: 'run_2',
            runId: 'run_2',
            title: 'Wait For Dependency Graph',
            status: 'blocked',
            progress: undefined,
            isRecent: false,
            latest: 'waiting on upstream planner',
          }),
          createItem({
            key: 'run_3',
            runId: 'run_3',
            title: 'Review Tool Presentation',
            status: 'completed',
            progress: 100,
            isRecent: true,
            latest: '已生成最终总结',
          }),
        ]}
      />
    );

    const text = container.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    expect(text).toContain('Runs');
    expect(text).toContain('Active');
    expect(text).toContain('Blocked');
    expect(text).toContain('Recent Done');
    expect(text).toContain('Analyze UI Rendering');
    expect(text).toContain('Wait For Dependency Graph');
    expect(text).toContain('Review Tool Presentation');
    expect(text).toContain('waiting on upstream planner');
  });

  it('renders selected run details', () => {
    const { container } = render(
      <TaskPanel
        visible
        loading={false}
        error={null}
        namespace="session_01"
        selectedIndex={1}
        onSelectIndex={() => {}}
        tasks={[
          createItem(),
          createItem({
            key: 'run_2',
            runId: 'run_2',
            title: 'Wait For Dependency Graph',
            status: 'blocked',
            progress: undefined,
            isRecent: false,
            latest: 'waiting on upstream planner',
          }),
        ]}
      />
    );

    const text = container.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    expect(text).toContain('Details');
    expect(text).toContain('Wait For Dependency Graph');
    expect(text).toContain('waiting on upstream planner');
  });
});
