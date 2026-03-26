import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getAgentTaskList, type AgentTaskSummary } from '../agent/runtime/runtime';

type UseTaskPanelResult = {
  visible: boolean;
  loading: boolean;
  error: string | null;
  namespace: string;
  tasks: AgentTaskSummary[];
  selectedIndex: number;
  open: () => void;
  close: () => void;
  toggle: () => void;
  refresh: (options?: { silent?: boolean }) => Promise<void>;
  setSelectedIndex: (index: number) => void;
};

const resolveCurrentNamespace = (): string => {
  const value = process.env.AGENT_CONVERSATION_ID?.trim() || process.env.AGENT_SESSION_ID?.trim();
  return value || 'default';
};

const isTerminalTask = (task: AgentTaskSummary): boolean =>
  task.status === 'completed' || task.status === 'cancelled' || task.status === 'failed';

export const useTaskPanel = (): UseTaskPanelResult => {
  const [visible, setVisible] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [namespace, setNamespace] = useState(resolveCurrentNamespace());
  const [tasks, setTasks] = useState<AgentTaskSummary[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    const nextNamespace = resolveCurrentNamespace();
    setNamespace(nextNamespace);
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const result = await getAgentTaskList({ namespace: nextNamespace });
      if (requestId !== requestIdRef.current) {
        return;
      }
      const visibleTasks = result.tasks.filter((task) => !isTerminalTask(task));
      setNamespace(result.namespace);
      setTasks(visibleTasks);
      setSelectedIndex((current) => {
        if (visibleTasks.length === 0) {
          return 0;
        }
        return Math.max(0, Math.min(current, visibleTasks.length - 1));
      });
    } catch (refreshError) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      if (!silent) {
        setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
        setTasks([]);
        setSelectedIndex(0);
      }
    } finally {
      if (requestId === requestIdRef.current && !silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const taskCount = tasks.length;
  useEffect(() => {
    if (selectedIndex < taskCount) {
      return;
    }
    setSelectedIndex(taskCount > 0 ? taskCount - 1 : 0);
  }, [selectedIndex, taskCount]);

  const open = useCallback(() => {
    setVisible(true);
    void refresh();
  }, [refresh]);

  const close = useCallback(() => {
    setVisible(false);
  }, []);

  const toggle = useCallback(() => {
    setVisible((current) => {
      const next = !current;
      if (next) {
        void refresh();
      }
      return next;
    });
  }, [refresh]);

  return useMemo(
    () => ({
      visible,
      loading,
      error,
      namespace,
      tasks,
      selectedIndex,
      open,
      close,
      toggle,
      refresh,
      setSelectedIndex,
    }),
    [close, error, loading, namespace, open, refresh, selectedIndex, tasks, toggle, visible]
  );
};
