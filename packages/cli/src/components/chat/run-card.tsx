import { TextAttributes } from '@opentui/core';
import { useEffect, useMemo, useState } from 'react';

import type { SubagentRunHighlight, SubagentRunViewModel } from '../../types/subagent-run';
import { uiTheme, MESSAGE_RAIL_BORDER_CHARS } from '../../ui/theme';

const ERROR_RAIL_COLOR = '#dc2626';
const WARNING_TEXT_COLOR = '#ff8d8d';

const statusIcon = (status: SubagentRunViewModel['status']): string => {
  switch (status) {
    case 'completed':
      return '●';
    case 'failed':
    case 'timed_out':
      return '×';
    case 'cancelled':
      return '⊘';
    case 'waiting':
      return '⏸';
    case 'blocked':
      return '⚠';
    case 'queued':
    case 'created':
    case 'starting':
      return '○';
    case 'running':
    default:
      return '◐';
  }
};

const railColor = (status: SubagentRunViewModel['status']): string => {
  return status === 'failed' || status === 'timed_out' ? ERROR_RAIL_COLOR : uiTheme.accent;
};

const highlightIcon = (kind: SubagentRunHighlight['kind']): string => {
  switch (kind) {
    case 'insight':
      return '→';
    case 'warning':
      return '!';
    case 'error':
      return '×';
    case 'status':
    default:
      return '·';
  }
};

type RunCardProps = {
  run: SubagentRunViewModel;
};

export const RunCard = ({ run }: RunCardProps) => {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExpanded(false);
  }, [run.runId]);

  const compactHighlights = useMemo(() => run.highlights.slice(-3), [run.highlights]);
  const recentTimeline = useMemo(() => run.timeline.slice(-5), [run.timeline]);
  const isCompleted = run.status === 'completed';

  return (
    <box flexDirection="column">
      <box>
        <box flexDirection="row">
          <box
            border={['left']}
            borderColor={railColor(run.status)}
            customBorderChars={MESSAGE_RAIL_BORDER_CHARS}
          />
          <box
            flexGrow={1}
            paddingLeft={2}
            paddingRight={1}
            paddingTop={1}
            paddingBottom={1}
            backgroundColor={uiTheme.surface}
          >
            <box flexDirection="row">
              <box flexGrow={1}>
                <text
                  fg={uiTheme.text}
                  attributes={uiTheme.typography.note}
                  wrapMode={'truncate-end' as any}
                  onMouseUp={() => setExpanded((value) => !value)}
                >
                  <span fg={uiTheme.accent}>{statusIcon(run.status)}</span> {run.title}
                  {run.role ? <span fg={uiTheme.muted}> · {run.role}</span> : null}
                  <span fg={uiTheme.muted}> · {run.statusText}</span>
                  {run.progress !== undefined ? <span fg={uiTheme.muted}> · {run.progress}%</span> : null}
                  {run.linkedTaskId ? <span fg={uiTheme.muted}> · {run.linkedTaskId}</span> : null}
                </text>
              </box>
              <text fg={uiTheme.accent} attributes={uiTheme.typography.note} onMouseUp={() => setExpanded((value) => !value)}>
                {expanded ? '⌄' : '›'}
              </text>
            </box>
          </box>
        </box>
      </box>

      <box flexDirection="row" marginTop={1}>
        <box
          border={['left']}
          borderColor={uiTheme.divider}
          customBorderChars={MESSAGE_RAIL_BORDER_CHARS}
        />
        <box
          flexGrow={1}
          backgroundColor={uiTheme.panel}
          paddingLeft={2}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
          flexDirection="column"
          gap={1}
        >
          {isCompleted && run.finalSummary ? (
            <box flexDirection="column">
              <text fg={uiTheme.muted} attributes={uiTheme.typography.note}>summary</text>
              <text fg={uiTheme.text} attributes={uiTheme.typography.body} wrapMode="word">
                {run.finalSummary}
              </text>
            </box>
          ) : null}

          {run.latestStatusLine ? (
            <box flexDirection="column">
              <text fg={uiTheme.muted} attributes={uiTheme.typography.note}>Status</text>
              <text fg={uiTheme.text} attributes={uiTheme.typography.body} wrapMode="word">
                {run.latestStatusLine}
              </text>
            </box>
          ) : null}

          {compactHighlights.length > 0 ? (
            <box flexDirection="column">
              <text fg={uiTheme.muted} attributes={uiTheme.typography.note}>{isCompleted ? 'key findings' : 'Recent'}</text>
              {compactHighlights.map((highlight) => (
                <text
                  key={highlight.id}
                  fg={highlight.kind === 'warning' || highlight.kind === 'error' ? WARNING_TEXT_COLOR : uiTheme.text}
                  attributes={uiTheme.typography.body}
                  wrapMode="word"
                >
                  <span fg={highlight.kind === 'warning' || highlight.kind === 'error' ? WARNING_TEXT_COLOR : uiTheme.accent}>
                    {highlightIcon(highlight.kind)}
                  </span>{' '}
                  {highlight.text}
                </text>
              ))}
            </box>
          ) : null}


          {run.artifacts.length > 0 ? (
            <box flexDirection="column">
              <text fg={uiTheme.muted} attributes={uiTheme.typography.note}>Artifacts</text>
              <text fg={uiTheme.text} attributes={TextAttributes.BOLD} wrapMode="word">
                Artifacts {run.artifacts.length} available
              </text>
            </box>
          ) : null}

          <text fg={uiTheme.muted} attributes={uiTheme.typography.note}>
            [{expanded ? 'Enter 收起' : 'Enter 展开'}]
          </text>

          {expanded ? (
            <box flexDirection="column" gap={1}>
              {recentTimeline.length > 0 ? (
                <box flexDirection="column">
                  <text fg={uiTheme.muted} attributes={uiTheme.typography.note}>Recent updates</text>
                  {recentTimeline.map((entry) => (
                    <text key={entry.id} fg={uiTheme.text} attributes={uiTheme.typography.body} wrapMode="word">
                      {entry.text}
                    </text>
                  ))}
                </box>
              ) : null}

              {run.outputPreview ? (
                <box flexDirection="column">
                  <text fg={uiTheme.muted} attributes={uiTheme.typography.note}>Outcome</text>
                  <text fg={uiTheme.text} attributes={uiTheme.typography.body} wrapMode="word">
                    {run.outputPreview}
                  </text>
                </box>
              ) : null}

              {run.artifacts.length > 0 ? (
                <box flexDirection="column">
                  {run.artifacts.map((artifact) => (
                    <text key={artifact.id} fg={uiTheme.text} attributes={TextAttributes.BOLD} wrapMode="word">
                      □ {artifact.label}
                    </text>
                  ))}
                </box>
              ) : null}
            </box>
          ) : null}
        </box>
      </box>
    </box>
  );
};
