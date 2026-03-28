import { useCallback, useMemo, useState } from 'react';

import type { SubagentRunViewModel } from '../types/subagent-run';

export type RunsSummaryItem = {
  key: string;
  title: string;
  status: string;
  progress?: number;
  role?: string;
  subtitle?: string;
  latest?: string;
  updatedAt: number;
  isRecent: boolean;
  runId: string;
};

type UseTaskPanelParams = {
  runs: SubagentRunViewModel[];
};

type UseTaskPanelResult = {
  visible: boolean;
  loading: boolean;
  error: string | null;
  namespace: string;
  tasks: RunsSummaryItem[];
  selectedIndex: number;
  selectedRun: SubagentRunViewModel | null;
  open: () => void;
  close: () => void;
  toggle: () => void;
  refresh: (options?: { silent?: boolean }) => Promise<void>;
  setSelectedIndex: (index: number) => void;
  moveSelection: (delta: number) => void;
};

const resolveCurrentNamespace = (): string => {
  const value = process.env.AGENT_CONVERSATION_ID?.trim() || process.env.AGENT_SESSION_ID?.trim();
  return value || 'default';
};

const toSummaryItem = (run: SubagentRunViewModel): RunsSummaryItem => ({
  key: run.runId,
  runId: run.runId,
  title: run.title,
  status: run.status,
  progress: run.progress,
  role: run.role,
  subtitle: run.linkedTaskId ? `task ${run.linkedTaskId}` : undefined,
  latest: run.latestStatusLine ?? run.outputPreview,
  updatedAt: run.updatedAt,
  isRecent: run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled' || run.status === 'timed_out',
});

export const useTaskPanel = ({ runs }: UseTaskPanelParams): UseTaskPanelResult => {
  const [visible, setVisible] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const namespace = resolveCurrentNamespace();

  const tasks = useMemo(() => {
    return runs.map(toSummaryItem).sort((left, right) => right.updatedAt - left.updatedAt);
  }, [runs]);

  const boundedSelectedIndex = tasks.length === 0 ? 0 : Math.max(0, Math.min(selectedIndex, tasks.length - 1));
  const selectedRun = useMemo(() => {
    const selected = tasks[boundedSelectedIndex];
    if (!selected) {
      return null;
    }
    return runs.find((run) => run.runId === selected.runId) ?? null;
  }, [boundedSelectedIndex, runs, tasks]);

  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);
  const toggle = useCallback(() => setVisible((current) => !current), []);
  const refresh = useCallback(async () => {
    return;
  }, []);
  const moveSelection = useCallback(
    (delta: number) => {
      setSelectedIndex((current) => {
        if (tasks.length === 0) {
          return 0;
        }
        return Math.max(0, Math.min(current + delta, tasks.length - 1));
      });
    },
    [tasks.length]
  );

  return {
    visible,
    loading: false,
    error: null,
    namespace,
    tasks,
    selectedIndex: boundedSelectedIndex,
    selectedRun,
    open,
    close,
    toggle,
    refresh,
    setSelectedIndex,
    moveSelection,
  };
};
