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

const panelAlignPaddingX =
  uiTheme.layout.conversationPaddingX +
  uiTheme.layout.conversationContentPaddingX +
  uiTheme.layout.promptPaddingX;

const clampProgress = (progress: number): number =>
  Math.max(0, Math.min(100, Math.round(progress)));

const getTaskMarker = (task: AgentTaskSummary): string => {
  return task.status === 'completed' ? '●' : '○';
};

const taskTextAttributes = TextAttributes.DIM;

const getTaskStateLabel = (task: AgentTaskSummary): string => {
  if (task.isBlocked) {
    return 'blocked';
  }

  switch (task.status) {
    case 'in_progress':
      return `${clampProgress(task.progress)}%`;
    case 'completed':
      return 'done';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'stopped';
    case 'pending':
    default:
      return task.canBeClaimed ? 'ready' : 'pending';
  }
};

const formatOwnerLabel = (owner: string | null): string | null => {
  if (!owner) {
    return null;
  }

  if (owner.startsWith('agent:')) {
    const agentId = owner.slice('agent:'.length);
    return agentId ? `subagent ${agentId.slice(0, 8)}` : 'subagent';
  }

  return owner;
};

export const TaskPanel = ({
  visible,
  loading,
  error,
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
  }, [loading, tasks.length, visible]);

  const safeSelectedIndex = useMemo(() => {
    if (tasks.length === 0) {
      return 0;
    }
    return Math.max(0, Math.min(selectedIndex, tasks.length - 1));
  }, [selectedIndex, tasks.length]);

  if (!visible || (!loading && !error && tasks.length === 0)) {
    return null;
  }

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
          borderColor={flash ? uiTheme.accent : uiTheme.divider}
          paddingLeft={1}
          paddingRight={1}
        >
          {loading ? (
            <text fg={uiTheme.muted}>Task refreshing...</text>
          ) : error ? (
            <text fg="#ff8d8d" wrapMode="word">
              {error}
            </text>
          ) : (
            <box flexDirection="column" gap={0}>
              {tasks.map((task, index) => {
                const ownerLabel = formatOwnerLabel(task.owner);
                const isSelected = index === safeSelectedIndex;

                return (
                  <box
                    key={task.id}
                    flexDirection="row"
                    gap={1}
                    onMouseOver={() => onSelectIndex(index)}
                    onMouseUp={() => onSelectIndex(index)}
                  >
                    <text
                      fg={task.status === 'completed' ? uiTheme.accent : uiTheme.subtle}
                      attributes={taskTextAttributes}
                    >
                      {getTaskMarker(task)}
                    </text>
                    <text
                      fg={isSelected ? uiTheme.text : uiTheme.text}
                      attributes={taskTextAttributes}
                      wrapMode="none"
                    >
                      {task.subject}
                    </text>
                    <text fg={uiTheme.subtle} attributes={taskTextAttributes} wrapMode="none">
                      |
                    </text>
                    <text fg={uiTheme.subtle} attributes={taskTextAttributes} wrapMode="none">
                      {getTaskStateLabel(task)}
                    </text>
                    {ownerLabel ? (
                      <>
                        <text fg={uiTheme.subtle} attributes={taskTextAttributes} wrapMode="none">
                          |
                        </text>
                        <text fg={uiTheme.subtle} attributes={taskTextAttributes} wrapMode="none">
                          ({ownerLabel})
                        </text>
                      </>
                    ) : null}
                  </box>
                );
              })}
            </box>
          )}
        </box>
      </box>
    </box>
  );
};
