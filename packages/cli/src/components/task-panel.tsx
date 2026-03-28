import { TextAttributes } from '@opentui/core';
import { useMemo } from 'react';

import type { RunsSummaryItem } from '../hooks/use-task-panel';
import { uiTheme } from '../ui/theme';

export type TaskPanelProps = {
  visible: boolean;
  loading: boolean;
  error: string | null;
  namespace: string;
  tasks: RunsSummaryItem[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
};

const panelAlignPaddingX =
  uiTheme.layout.conversationPaddingX +
  uiTheme.layout.conversationContentPaddingX +
  uiTheme.layout.promptPaddingX;

const getStatusIcon = (status: string): string => {
  switch (status) {
    case 'completed':
      return '●';
    case 'failed':
    case 'timed_out':
      return '×';
    case 'cancelled':
      return '⊘';
    case 'blocked':
      return '⚠';
    case 'waiting':
      return '⏸';
    case 'running':
      return '◐';
    default:
      return '○';
  }
};

const renderRunRow = (
  task: RunsSummaryItem,
  index: number,
  onSelectIndex: (index: number) => void
) => (
  <box
    key={task.key}
    flexDirection="column"
    gap={0}
    onMouseOver={() => onSelectIndex(index)}
    onMouseUp={() => onSelectIndex(index)}
  >
    <box flexDirection="row" gap={1}>
      <text fg={task.status === 'completed' ? uiTheme.accent : uiTheme.subtle}>
        {getStatusIcon(task.status)}
      </text>
      <text fg={uiTheme.text} wrapMode="none">
        {task.title}
      </text>
      <text fg={uiTheme.subtle}>|</text>
      <text fg={uiTheme.subtle}>{task.status}</text>
      {task.progress !== undefined ? (
        <>
          <text fg={uiTheme.subtle}>|</text>
          <text fg={uiTheme.subtle}>{task.progress}%</text>
        </>
      ) : null}
      {task.role ? (
        <>
          <text fg={uiTheme.subtle}>|</text>
          <text fg={uiTheme.subtle}>{task.role}</text>
        </>
      ) : null}
    </box>
    {task.latest ? (
      <text fg={uiTheme.muted} wrapMode="word">
        {task.latest}
      </text>
    ) : task.subtitle ? (
      <text fg={uiTheme.muted} wrapMode="word">
        {task.subtitle}
      </text>
    ) : null}
  </box>
);

export const TaskPanel = ({
  visible,
  loading,
  error,
  tasks,
  selectedIndex,
  onSelectIndex,
}: TaskPanelProps) => {
  const safeSelectedIndex = useMemo(() => {
    if (tasks.length === 0) {
      return 0;
    }
    return Math.max(0, Math.min(selectedIndex, tasks.length - 1));
  }, [selectedIndex, tasks.length]);

  if (!visible || (!loading && !error && tasks.length === 0)) {
    return null;
  }

  const activeTasks = tasks.filter((task) => task.status === 'running');
  const blockedTasks = tasks.filter((task) => task.status === 'blocked' || task.status === 'waiting');
  const recentTasks = tasks.filter((task) => task.isRecent);
  const selected = tasks[safeSelectedIndex];

  return (
    <box
      width="100%"
      flexDirection="column"
      flexShrink={0}
      marginBottom={0}
      paddingX={panelAlignPaddingX}
      alignItems="center"
    >
      <box width="96%" flexDirection="row" overflow="hidden">
        <box
          width="100%"
          flexDirection="column"
          backgroundColor={uiTheme.surface}
          border={['top', 'bottom', 'left', 'right']}
          borderColor={uiTheme.divider}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
          gap={1}
        >
          <box flexDirection="row" justifyContent="space-between">
            <text fg={uiTheme.text} attributes={TextAttributes.BOLD}>
              Runs
            </text>
            <text fg={uiTheme.muted}>
              Active {activeTasks.length} · Blocked {blockedTasks.length} · Recent Done {recentTasks.length}
            </text>
          </box>

          {loading ? (
            <text fg={uiTheme.muted}>Runs refreshing...</text>
          ) : error ? (
            <text fg="#ff8d8d" wrapMode="word">
              {error}
            </text>
          ) : (
            <box flexDirection="column" gap={1}>
              <box flexDirection="column" gap={0}>
                <text fg={uiTheme.muted} attributes={uiTheme.typography.note}>Active</text>
                {activeTasks.length > 0 ? activeTasks.map((task) => renderRunRow(task, tasks.indexOf(task), onSelectIndex)) : (
                  <text fg={uiTheme.muted}>No active runs</text>
                )}
              </box>

              <box flexDirection="column" gap={0}>
                <text fg={uiTheme.muted} attributes={uiTheme.typography.note}>Blocked</text>
                {blockedTasks.length > 0 ? blockedTasks.map((task) => renderRunRow(task, tasks.indexOf(task), onSelectIndex)) : (
                  <text fg={uiTheme.muted}>No blocked runs</text>
                )}
              </box>

              <box flexDirection="column" gap={0}>
                <text fg={uiTheme.muted} attributes={uiTheme.typography.note}>Recent Done</text>
                {recentTasks.length > 0 ? recentTasks.map((task) => renderRunRow(task, tasks.indexOf(task), onSelectIndex)) : (
                  <text fg={uiTheme.muted}>No recent runs</text>
                )}
              </box>
            </box>
          )}

          {selected ? (
            <box flexDirection="column" gap={0}>
              <text fg={uiTheme.muted} attributes={uiTheme.typography.note}>
                Details
              </text>
              <text fg={uiTheme.text} attributes={TextAttributes.BOLD} wrapMode="word">
                {selected.title}
              </text>
              {selected.subtitle ? (
                <text fg={uiTheme.muted} wrapMode="word">
                  {selected.subtitle}
                </text>
              ) : null}
              {selected.latest ? (
                <text fg={uiTheme.text} wrapMode="word">
                  {selected.latest}
                </text>
              ) : null}
            </box>
          ) : null}
        </box>
      </box>
    </box>
  );
};
