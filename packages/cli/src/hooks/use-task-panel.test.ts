import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../agent/runtime/runtime', () => ({
  getAgentTaskList: vi.fn(),
}));

import * as runtime from '../agent/runtime/runtime';
import { useTaskPanel } from './use-task-panel';

describe('useTaskPanel', () => {
  const mockGetAgentTaskList = runtime.getAgentTaskList as unknown as ReturnType<typeof vi.fn>;
  const originalConversationId = process.env.AGENT_CONVERSATION_ID;
  const originalSessionId = process.env.AGENT_SESSION_ID;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AGENT_CONVERSATION_ID = 'conv-task-panel';
    process.env.AGENT_SESSION_ID = 'conv-task-panel';
    mockGetAgentTaskList.mockResolvedValue({
      namespace: 'conv-task-panel',
      total: 2,
      tasks: [
        {
          id: 'task-1',
          subject: 'Build task panel',
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
          subject: 'Add tests',
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
      ],
    });
  });

  afterEach(() => {
    if (originalConversationId === undefined) {
      delete process.env.AGENT_CONVERSATION_ID;
    } else {
      process.env.AGENT_CONVERSATION_ID = originalConversationId;
    }
    if (originalSessionId === undefined) {
      delete process.env.AGENT_SESSION_ID;
    } else {
      process.env.AGENT_SESSION_ID = originalSessionId;
    }
    vi.restoreAllMocks();
  });

  it('loads session tasks on mount', async () => {
    const { result } = renderHook(() => useTaskPanel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.namespace).toBe('conv-task-panel');
      expect(result.current.tasks).toHaveLength(2);
    });

    expect(mockGetAgentTaskList).toHaveBeenCalledWith({ namespace: 'conv-task-panel' });
  });

  it('toggles visibility and refreshes when reopening', async () => {
    const { result } = renderHook(() => useTaskPanel());

    await waitFor(() => {
      expect(result.current.tasks).toHaveLength(2);
    });

    act(() => {
      result.current.toggle();
    });
    expect(result.current.visible).toBe(false);

    act(() => {
      result.current.toggle();
    });

    await waitFor(() => {
      expect(result.current.visible).toBe(true);
    });
    expect(mockGetAgentTaskList).toHaveBeenCalledTimes(2);
  });

  it('surfaces refresh errors', async () => {
    mockGetAgentTaskList.mockRejectedValueOnce(new Error('task store unavailable'));

    const { result } = renderHook(() => useTaskPanel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe('task store unavailable');
    });
    expect(result.current.tasks).toEqual([]);
  });

  it('drops terminal-only tasks so completed work does not keep the panel visible', async () => {
    mockGetAgentTaskList.mockResolvedValueOnce({
      namespace: 'conv-task-panel',
      total: 1,
      tasks: [
        {
          id: 'task-done',
          subject: 'Finished task',
          status: 'completed',
          priority: 'normal',
          owner: null,
          blockedBy: [],
          blocks: [],
          progress: 100,
          isBlocked: false,
          canBeClaimed: false,
          createdAt: 3,
          updatedAt: 3,
        },
      ],
    });

    const { result } = renderHook(() => useTaskPanel());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.tasks).toEqual([]);
  });
});
