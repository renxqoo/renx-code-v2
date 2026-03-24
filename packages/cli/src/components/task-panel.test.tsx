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

  it('renders a single compact task with subagent info', () => {
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
            subject: 'Search info',
            status: 'pending',
            priority: 'high',
            owner: 'agent:abcd1234efgh5678',
            blockedBy: [],
            blocks: [],
            progress: 0,
            isBlocked: false,
            canBeClaimed: false,
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: 'task-2',
            subject: 'Collect sources',
            status: 'pending',
            priority: 'normal',
            owner: null,
            blockedBy: [],
            blocks: [],
            progress: 0,
            isBlocked: false,
            canBeClaimed: true,
            createdAt: 2,
            updatedAt: 2,
          },
        ]}
      />
    );

    const text = container.textContent?.replace(/\s+/g, '').trim() ?? '';

    expect(text).toContain('>Searchinfo');
    expect(text).toContain('pending');
    expect(text).toContain('subagentabcd1234');
    expect(text).toContain('+1');
    expect(text).not.toContain('Collectsources');
  });

  it('renders progress for in-progress tasks', () => {
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
            subject: 'Implement UI',
            status: 'in_progress',
            priority: 'high',
            owner: 'agent:worker9999',
            blockedBy: [],
            blocks: [],
            progress: 62,
            isBlocked: false,
            canBeClaimed: false,
            createdAt: 1,
            updatedAt: 1,
          },
        ]}
      />
    );

    const text = container.textContent?.replace(/\s+/g, '').trim() ?? '';

    expect(text).toContain('ImplementUI');
    expect(text).toContain('62%');
    expect(text).toContain('subagentworker99');
  });
});
