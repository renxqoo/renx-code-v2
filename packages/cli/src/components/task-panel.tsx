import { TextAttributes } from '@opentui/core';
import { useEffect, useMemo, useState } from 'react';

import type { AgentTaskSummary } from '../agent/runtime/runtime';
import { uiTheme } from '../ui/theme';

export type TaskPanelProps = {
  visible: boolean;
  loading: boolean;
  error: string | null;
  namespace: string;
  tasks: AgentTaskSummary[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
};

const MAX_VISIBLE_ROWS = 2;
const panelAlignPaddingX =
  uiTheme.layout.conversationPaddingX +
  uiTheme.layout.conversationContentPaddingX +
  uiTheme.layout.promptPaddingX;

const formatStatusIcon = (status: AgentTaskSummary['status'], isBlocked: boolean): string => {
  if (isBlocked && status === 'pending') {
    return '◌';
  }
  switch (status) {
    case 'completed':
      return '✓';
    case 'in_progress':
      return '◐';
    case 'failed':
      return '✕';
    case 'cancelled':
      return '⊘';
    case 'pending':
    default:
      return '○';
  }
};

const countBy = (
  tasks: AgentTaskSummary[],
  predicate: (task: AgentTaskSummary) => boolean
): number => tasks.filter(predicate).length;

const formatMeta = (task: AgentTaskSummary): string => {
  if (task.isBlocked) {
    return 'blocked';
  }
  if (task.status === 'in_progress') {
    return `${Math.max(0, Math.round(task.progress))}%`;
  }
  if (task.status === 'completed') {
    return 'done';
  }
  return task.canBeClaimed ? 'ready' : 'pending';
};

const formatNamespaceLabel = (namespace: string): string => {
  const normalized = namespace.trim();
  if (normalized.length <= 18) {
    return normalized;
  }
  return `${normalized.slice(0, 8)}…${normalized.slice(-6)}`;
};

const formatSummary = (tasks: AgentTaskSummary[]): string => {
  const active = countBy(tasks, (task) => task.status === 'in_progress');
  const blocked = countBy(tasks, (task) => task.isBlocked);
  const done = countBy(tasks, (task) => task.status === 'completed');
  if (tasks.length === 0) {
    return 'Tasks · empty';
  }
  return `Tasks · ${active} active · ${blocked} blocked · ${done} done`;
};

export const TaskPanel = ({
  visible,
  loading,
  error,
  namespace,
  tasks,
  selectedIndex,
  onSelectIndex,
}: TaskPanelProps) => {
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 180);
    return () => clearTimeout(timer);
  }, [loading, namespace, tasks.length, visible]);

  const visibleTasks = useMemo(() => tasks.slice(0, MAX_VISIBLE_ROWS), [tasks]);
  const summaryText = useMemo(() => formatSummary(tasks), [tasks]);
  const namespaceLabel = useMemo(() => formatNamespaceLabel(namespace), [namespace]);

  if (!visible || (!loading && !error && tasks.length === 0)) {
    return null;
  }

  return (
    <box
      width="100%"
      flexDirection="column"
      flexShrink={0}
      marginBottom={1}
      paddingX={panelAlignPaddingX}
    >
      <box width="100%" flexDirection="row" overflow="hidden">
        <box width={1} backgroundColor={flash ? uiTheme.accent : uiTheme.divider} />
        <box
          width="100%"
          flexDirection="column"
          backgroundColor={uiTheme.surface}
          paddingX={2}
          paddingY={0}
        >
          <box justifyContent="space-between">
            <text fg={uiTheme.text} attributes={TextAttributes.BOLD} wrapMode="none">
              {summaryText}
            </text>
            <text fg={uiTheme.subtle} wrapMode="none">
              {namespaceLabel}
            </text>
          </box>

          {loading ? (
            <box paddingBottom={0}>
              <text fg={uiTheme.muted}>Refreshing tasks...</text>
            </box>
          ) : error ? (
            <box paddingBottom={0}>
              <text fg="#ff8d8d" wrapMode="word">
                {error}
              </text>
            </box>
          ) : visibleTasks.length === 0 ? (
            <box paddingBottom={0}>
              <text fg={uiTheme.muted}>No session tasks.</text>
            </box>
          ) : (
            <box flexDirection="column" paddingBottom={0}>
              {visibleTasks.map((task, index) => {
                const isSelected = index === selectedIndex;
                return (
                  <box
                    key={task.id}
                    flexDirection="row"
                    justifyContent="space-between"
                    onMouseOver={() => onSelectIndex(index)}
                    onMouseUp={() => onSelectIndex(index)}
                  >
                    <box flexDirection="row" gap={1}>
                      <text fg={isSelected ? uiTheme.accent : uiTheme.muted}>
                        {isSelected ? '›' : ' '}
                      </text>
                      <text fg={isSelected ? uiTheme.accent : uiTheme.muted}>
                        {formatStatusIcon(task.status, task.isBlocked)}
                      </text>
                      <text
                        fg={isSelected ? uiTheme.text : uiTheme.text}
                        attributes={TextAttributes.BOLD}
                        wrapMode="none"
                      >
                        {task.subject}
                      </text>
                    </box>
                    <text fg={uiTheme.muted} wrapMode="none">
                      {formatMeta(task)}
                    </text>
                  </box>
                );
              })}
              {tasks.length > MAX_VISIBLE_ROWS ? (
                <box>
                  <text fg={uiTheme.subtle} wrapMode="none">
                    +{tasks.length - MAX_VISIBLE_ROWS} more
                  </text>
                </box>
              ) : null}
            </box>
          )}
        </box>
      </box>
    </box>
  );
};
