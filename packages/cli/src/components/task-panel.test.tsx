import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TaskPanel } from './task-panel';

describe('TaskPanel', () => {
  it('hides the panel when tasks are empty', () => {
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

  it('renders summary and task rows without detail area', () => {
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
            id: 'task-1',
            subject: '实现 task panel',
            status: 'in_progress',
            priority: 'high',
            owner: 'cli',
            blockedBy: [],
            blocks: [],
            progress: 60,
            isBlocked: false,
            canBeClaimed: false,
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: 'task-2',
            subject: '补 task tests',
            status: 'pending',
            priority: 'normal',
            owner: null,
            blockedBy: ['task-1'],
            blocks: [],
            progress: 0,
            isBlocked: true,
            canBeClaimed: false,
            createdAt: 2,
            updatedAt: 2,
          },
          {
            id: 'task-3',
            subject: '写回归测试',
            status: 'completed',
            priority: 'low',
            owner: null,
            blockedBy: [],
            blocks: [],
            progress: 100,
            isBlocked: false,
            canBeClaimed: false,
            createdAt: 3,
            updatedAt: 3,
          },
        ]}
      />
    );

    const text = container.textContent?.replace(/\s+/g, ' ').trim() ?? '';

    expect(text).toContain('Tasks');
    expect(text).toContain('Tasks · 1 active · 1 blocked · 1 done');
    expect(text).toContain('session_01');
    expect(text).toContain('实现 task panel');
    expect(text).toContain('补 task tests');
    expect(text).toContain('+1 more');
    expect(text).not.toContain('Detail');
  });
});
