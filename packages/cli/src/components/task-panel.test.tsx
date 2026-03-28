import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TaskPanel } from './task-panel';

describe('TaskPanel', () => {
  it('hides the panel when runs are empty', () => {
    const { container } = render(
      <TaskPanel
        visible
        loading={false}
        error={null}
        namespace="session_01"
        selectedIndex={0}
        onSelectIndex={() => {}}
        tasks={[]}
      />
    );

    expect(container.textContent?.trim() ?? '').toBe('');
  });

  it('renders compact run rows', () => {
    const { container } = render(
      <TaskPanel
        visible
        loading={false}
        error={null}
        namespace="session_01"
        selectedIndex={0}
        onSelectIndex={() => {}}
        tasks={[
          {
            key: 'run_1',
            runId: 'run_1',
            title: 'Sort industry news',
            status: 'running',
            progress: 62,
            role: 'Explore',
            subtitle: 'task task_1',
            latest: 'collecting sources',
            updatedAt: 1,
            isRecent: false,
          },
          {
            key: 'run_2',
            runId: 'run_2',
            title: 'Sort competitor updates',
            status: 'completed',
            progress: 100,
            role: 'Plan',
            subtitle: undefined,
            latest: 'final summary generated',
            updatedAt: 2,
            isRecent: true,
          },
        ]}
      />
    );

    const text = container.textContent?.replace(/\s+/g, '').trim() ?? '';

    expect(text).toContain('Runs');
    expect(text).toContain('◐Sortindustrynews|running|62%|Explore');
    expect(text).toContain('●Sortcompetitorupdates|completed|100%|Plan');
  });
});
