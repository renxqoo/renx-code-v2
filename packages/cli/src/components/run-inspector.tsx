import { TextAttributes } from '@opentui/core';
import { useState } from 'react';

import type { SubagentRunViewModel } from '../types/subagent-run';
import { uiTheme } from '../ui/theme';
import { INSPECTOR_TABS, type InspectorTab } from '../utils/run-inspector-tabs';

const formatTimestamp = (timestamp: number): string => `t+${timestamp}`;

type RunInspectorProps = {
  visible: boolean;
  viewportWidth: number;
  viewportHeight: number;
  run: SubagentRunViewModel | null;
  initialTab?: InspectorTab;
  activeTab?: InspectorTab;
};

export const RunInspector = ({
  visible,
  viewportWidth,
  viewportHeight,
  run,
  initialTab = 'Meta',
  activeTab,
}: RunInspectorProps) => {
  if (!visible || !run) {
    return null;
  }

  const panelWidth = Math.min(92, Math.max(56, viewportWidth - 8));
  const panelHeight = Math.min(30, Math.max(18, viewportHeight - 6));
  const left = Math.max(2, Math.floor((viewportWidth - panelWidth) / 2));
  const top = Math.max(1, Math.floor((viewportHeight - panelHeight) / 2));
  const [internalTab] = useState<InspectorTab>(initialTab);
  const currentTab = activeTab ?? internalTab;
  const debugLines = [
    `runId ${run.runId}`,
    `updated ${formatTimestamp(run.updatedAt)}`,
    `timeline entries ${run.timeline.length}`,
    `highlights ${run.highlights.length}`,
    `artifacts ${run.artifacts.length}`,
  ];

  return (
    <box position="absolute" top={top} left={left} width={panelWidth} height={panelHeight} zIndex={160}>
      <box
        width="100%"
        height="100%"
        flexDirection="column"
        backgroundColor={uiTheme.surface}
        border={['top', 'bottom', 'left', 'right']}
        borderColor={uiTheme.divider}
      >
        <box justifyContent="space-between" paddingX={2} paddingTop={1} paddingBottom={1}>
          <box flexDirection="column">
            <text fg={uiTheme.text} attributes={TextAttributes.BOLD}>
              Run Inspector
            </text>
            <text fg={uiTheme.muted}>
              {run.title}
              {run.role ? ` · ${run.role}` : ''}
              {run.linkedTaskId ? ` · ${run.linkedTaskId}` : ''}
            </text>
            <text fg={uiTheme.muted}>Tabs: [Meta] [Timeline] [Artifacts] [Debug]</text>
          </box>
          <text fg={uiTheme.accent} attributes={TextAttributes.BOLD}>
            {run.statusText}
          </text>
        </box>

        <box flexGrow={1} paddingLeft={2} paddingRight={2} paddingBottom={1}>
          <scrollbox
            height="100%"
            scrollY
            stickyScroll
            scrollbarOptions={{ visible: false }}
            viewportOptions={{ backgroundColor: uiTheme.surface }}
            contentOptions={{ backgroundColor: uiTheme.surface }}
          >
            <box backgroundColor={uiTheme.surface} paddingTop={1} gap={1} flexDirection="column">
              {currentTab === 'Meta' ? (
                <box flexDirection="column" gap={0}>
                  <text fg={uiTheme.muted}>Meta</text>
                  <text fg={uiTheme.text} wrapMode="word">
                    Status {run.statusText}
                    {run.progress !== undefined ? ` · ${run.progress}%` : ''}
                    {run.role ? ` · ${run.role}` : ''}
                    {run.linkedTaskId ? ` · ${run.linkedTaskId}` : ''}
                  </text>
                  {run.latestStatusLine ? (
                    <text fg={uiTheme.text} wrapMode="word">
                      {run.latestStatusLine}
                    </text>
                  ) : null}
                  {run.finalSummary ? (
                    <text fg={uiTheme.text} wrapMode="word">
                      summary · {run.finalSummary}
                    </text>
                  ) : null}
                </box>
              ) : null}

              {currentTab === 'Timeline' ? (
                <box flexDirection="column" gap={0}>
                  <text fg={uiTheme.muted}>Timeline</text>
                  {run.timeline.length > 0 ? (
                    run.timeline.map((entry) => (
                      <text key={entry.id} fg={uiTheme.text} wrapMode="word">
                        {formatTimestamp(entry.timestamp)} · {entry.kind} · {entry.text}
                      </text>
                    ))
                  ) : (
                    <text fg={uiTheme.muted}>No timeline yet</text>
                  )}
                </box>
              ) : null}

              {currentTab === 'Artifacts' ? (
                <box flexDirection="column" gap={0}>
                  <text fg={uiTheme.muted}>Artifacts</text>
                  {run.artifacts.length > 0 ? (
                    run.artifacts.map((item) => (
                      <box key={item.id} flexDirection="column" gap={0}>
                        <text fg={uiTheme.accent} attributes={TextAttributes.BOLD}>
                          {item.label}
                        </text>
                        {item.content ? (
                          <text fg={uiTheme.text} wrapMode="word">
                            {item.content}
                          </text>
                        ) : null}
                      </box>
                    ))
                  ) : (
                    <text fg={uiTheme.muted}>No artifacts yet</text>
                  )}
                </box>
              ) : null}

              {currentTab === 'Debug' ? (
                <box flexDirection="column" gap={0}>
                  <text fg={uiTheme.muted}>Debug</text>
                  {debugLines.map((line) => (
                    <text key={line} fg={uiTheme.text} wrapMode="word">
                      {line}
                    </text>
                  ))}
                  {run.highlights.map((item) => (
                    <text key={item.id} fg={uiTheme.text} wrapMode="word">
                      {item.kind} · {item.text}
                    </text>
                  ))}
                  {run.outputPreview ? (
                    <text fg={uiTheme.text} wrapMode="word">
                      output preview · {run.outputPreview}
                    </text>
                  ) : null}
                </box>
              ) : null}

              <text fg={uiTheme.muted}>Footer: Esc 返回 · ←→ 切换 Tab</text>
            </box>
          </scrollbox>
        </box>
      </box>
    </box>
  );
};
