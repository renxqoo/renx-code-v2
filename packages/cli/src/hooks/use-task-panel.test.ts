import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useTaskPanel } from './use-task-panel';

const runs = [
  {
    runId: 'subexec_1',
    title: 'Analyze UI Rendering',
    role: 'Explore',
    status: 'running' as const,
    statusText: 'running',
    progress: 52,
    linkedTaskId: 'task_101',
    latestStatusLine: '正在分析 assistant-tool-group',
    highlights: [],
    artifacts: [],
    timeline: [],
    outputPreview: undefined,
    finalSummary: undefined,
    firstSeenIndex: 2,
    updatedAt: 2,
  },
  {
    runId: 'subexec_2',
    title: 'Review Tool Presentation',
    role: 'Plan',
    status: 'completed' as const,
    statusText: 'completed',
    progress: 100,
    linkedTaskId: null,
    latestStatusLine: '已生成最终总结',
    highlights: [],
    artifacts: [],
    timeline: [],
    outputPreview: 'Final redesign summary',
    finalSummary: 'Final redesign summary',
    firstSeenIndex: 1,
    updatedAt: 3,
  },
  {
    runId: 'subexec_3',
    title: 'Collect Failure Diagnostics',
    role: 'Explore',
    status: 'timed_out' as const,
    statusText: 'timed out',
    progress: 87,
    linkedTaskId: null,
    latestStatusLine: '等待子步骤超时',
    highlights: [],
    artifacts: [],
    timeline: [],
    outputPreview: undefined,
    finalSummary: undefined,
    firstSeenIndex: 3,
    updatedAt: 1,
  },
];

describe('useTaskPanel', () => {
  it('builds sorted runs summary items from run projections', () => {
    const { result } = renderHook(() => useTaskPanel({ runs }));

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(null);
    expect(result.current.tasks).toHaveLength(3);
    expect(result.current.tasks[0]?.title).toBe('Review Tool Presentation');
    expect(result.current.tasks[1]?.title).toBe('Analyze UI Rendering');
    expect(result.current.tasks[2]?.title).toBe('Collect Failure Diagnostics');
    expect(result.current.selectedRun?.runId).toBe('subexec_2');
  });

  it('moves the selected run up and down within bounds', () => {
    const { result } = renderHook(() => useTaskPanel({ runs }));

    act(() => {
      result.current.moveSelection(1);
    });
    expect(result.current.selectedRun?.runId).toBe('subexec_1');

    act(() => {
      result.current.moveSelection(10);
    });
    expect(result.current.selectedRun?.runId).toBe('subexec_3');

    act(() => {
      result.current.moveSelection(-10);
    });
    expect(result.current.selectedRun?.runId).toBe('subexec_2');
  });

  it('treats timed out runs as recent finished items', () => {
    const { result } = renderHook(() => useTaskPanel({ runs }));

    const timedOutRun = result.current.tasks.find((task) => task.runId === 'subexec_3');
    expect(timedOutRun?.isRecent).toBe(true);
  });

});
