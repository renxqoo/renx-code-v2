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

  it('renders multiple compact task rows', () => {
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
            subject: 'Sort industry news',
            status: 'pending',
            priority: 'high',
            owner: null,
            blockedBy: [],
            blocks: [],
            progress: 0,
            isBlocked: false,
            canBeClaimed: true,
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: 'task-2',
            subject: 'Sort competitor updates',
            status: 'pending',
            priority: 'normal',
            owner: 'agent:abcd1234efgh5678',
            blockedBy: [],
            blocks: [],
            progress: 0,
            isBlocked: false,
            canBeClaimed: false,
            createdAt: 2,
            updatedAt: 2,
          },
        ]}
      />
    );

    const text = container.textContent?.replace(/\s+/g, '').trim() ?? '';

    expect(text).toContain('○Sortindustrynews|ready');
    expect(text).toContain('○Sortcompetitorupdates|pending|(subagentabcd1234)');
  });

  it('renders progress and completion markers', () => {
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
          {
            id: 'task-2',
            subject: 'Ship release',
            status: 'completed',
            priority: 'high',
            owner: null,
            blockedBy: [],
            blocks: [],
            progress: 100,
            isBlocked: false,
            canBeClaimed: false,
            createdAt: 2,
            updatedAt: 2,
          },
        ]}
      />
    );

    const text = container.textContent?.replace(/\s+/g, '').trim() ?? '';

    expect(text).toContain('○ImplementUI|62%|(subagentworker99)');
    expect(text).toContain('●Shiprelease|done');
  });
});
