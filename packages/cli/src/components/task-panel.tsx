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
    if (!agentId) {
      return 'subagent';
    }
    return `subagent ${agentId.slice(0, 8)}`;
  }

  return owner;
};

const formatOverflowLabel = (tasks: AgentTaskSummary[]): string | null => {
  if (tasks.length <= 1) {
    return null;
  }
  return `+${tasks.length - 1}`;
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

  const activeTask = useMemo(() => {
    if (tasks.length === 0) {
      return null;
    }
    const safeIndex = Math.max(0, Math.min(selectedIndex, tasks.length - 1));
    return tasks[safeIndex] ?? tasks[0] ?? null;
  }, [selectedIndex, tasks]);

  const ownerLabel = useMemo(() => formatOwnerLabel(activeTask?.owner ?? null), [activeTask]);
  const overflowLabel = useMemo(() => formatOverflowLabel(tasks), [tasks]);

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
    >
      <box width="100%" flexDirection="row" overflow="hidden" marginLeft={1} marginRight={1}>
        <box width={1} backgroundColor={flash ? uiTheme.accent : uiTheme.divider} />
        <box
          width="100%"
          flexDirection="row"
          backgroundColor={uiTheme.surface}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
        >
          {loading ? (
            <text fg={uiTheme.muted}>Task refreshing...</text>
          ) : error ? (
            <text fg="#ff8d8d" wrapMode="word">
              {error}
            </text>
          ) : activeTask ? (
            <box
              flexDirection="row"
              gap={1}
              onMouseOver={() => onSelectIndex(Math.max(0, selectedIndex))}
              onMouseUp={() => onSelectIndex(Math.max(0, selectedIndex))}
            >
              <text fg={uiTheme.accent} attributes={TextAttributes.BOLD}>
                {'>'}
              </text>
              <text fg={uiTheme.text} attributes={TextAttributes.BOLD} wrapMode="none">
                {activeTask.subject}
              </text>
              <text fg={uiTheme.subtle} wrapMode="none">
                ·
              </text>
              <text fg={uiTheme.subtle} wrapMode="none">
                {getTaskStateLabel(activeTask)}
              </text>
              {ownerLabel ? (
                <>
                  <text fg={uiTheme.subtle} wrapMode="none">
                    ·
                  </text>
                  <text fg={uiTheme.muted} wrapMode="none">
                    {ownerLabel}
                  </text>
                </>
              ) : null}
              {overflowLabel ? (
                <>
                  <text fg={uiTheme.subtle} wrapMode="none">
                    ·
                  </text>
                  <text fg={uiTheme.subtle} wrapMode="none">
                    {overflowLabel}
                  </text>
                </>
              ) : null}
            </box>
          ) : (
            <text fg={uiTheme.muted}>No session tasks.</text>
          )}
        </box>
      </box>
    </box>
  );
};
