import { TextAttributes } from '@opentui/core';
import type { ReactNode } from 'react';

import type { AgentToolConfirmEvent } from '../agent/runtime/types';
import { uiTheme } from '../ui/theme';
import { buildToolConfirmDialogContent } from './tool-confirm-dialog-content';
import { getToolDisplayIcon, getToolDisplayName } from './tool-display-config';

type ToolConfirmDialogProps = {
  visible: boolean;
  viewportWidth: number;
  viewportHeight: number;
  request: (AgentToolConfirmEvent & { selectedAction: 'approve' | 'deny' }) | null;
};

const selectedForeground = '#050608';
const denyBackground = '#ff8d8d';
const denyForeground = '#24090a';

const renderButton = (label: string, tone: 'approve' | 'deny', selected: boolean) => {
  const activeBackground = tone === 'approve' ? uiTheme.accent : denyBackground;
  const activeForeground = tone === 'approve' ? selectedForeground : denyForeground;

  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={selected ? activeBackground : uiTheme.surface}
      border={['top', 'bottom', 'left', 'right']}
      borderColor={selected ? activeBackground : uiTheme.divider}
    >
      <text fg={selected ? activeForeground : uiTheme.text} attributes={TextAttributes.BOLD}>
        {label}
      </text>
    </box>
  );
};

const renderSection = (label: string, children: ReactNode, backgroundColor = uiTheme.panel) => {
  return (
    <box flexDirection="column" gap={0}>
      <text fg={uiTheme.muted}>{label}</text>
      <box
        flexDirection="column"
        backgroundColor={backgroundColor}
        border={['top', 'bottom', 'left', 'right']}
        borderColor={uiTheme.divider}
        paddingX={1}
        paddingY={1}
      >
        {children}
      </box>
    </box>
  );
};

export const ToolConfirmDialog = ({
  visible,
  viewportWidth,
  viewportHeight,
  request,
}: ToolConfirmDialogProps) => {
  if (!visible || !request) {
    return null;
  }

  const content = buildToolConfirmDialogContent(request);
  const metadataSectionCount =
    Number(Boolean(content.reason)) +
    Number(Boolean(content.requestedPath)) +
    Number(content.allowedDirectories.length > 0) +
    Number(content.argumentItems.length > 0);
  const preferredHeight =
    12 +
    Number(Boolean(content.detail)) * 2 +
    metadataSectionCount * 3 +
    Math.min(content.argumentItems.length, 4);
  const panelWidth = Math.min(92, Math.max(52, viewportWidth - 8));
  const panelHeight = Math.min(Math.max(16, preferredHeight), Math.max(16, viewportHeight - 6));
  const left = Math.max(2, Math.floor((viewportWidth - panelWidth) / 2));
  const top = Math.max(1, Math.floor((viewportHeight - panelHeight) / 2));
  const selectedAction = request.selectedAction;
  const toolLabel = getToolDisplayName(request.toolName);
  const toolIcon = getToolDisplayIcon(request.toolName);

  return (
    <box
      position="absolute"
      top={top}
      left={left}
      width={panelWidth}
      height={panelHeight}
      zIndex={150}
    >
      <box
        width="100%"
        height="100%"
        flexDirection="column"
        backgroundColor={uiTheme.surface}
        border={['top', 'bottom', 'left', 'right']}
        borderColor={uiTheme.divider}
      >
        <box
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          justifyContent="space-between"
          backgroundColor={uiTheme.panel}
        >
          <box flexDirection="column">
            <box flexDirection="row" gap={1}>
              <text fg={uiTheme.accent} attributes={TextAttributes.BOLD}>
                {'△'}
              </text>
              <text fg={uiTheme.text} attributes={TextAttributes.BOLD}>
                Permission required
              </text>
            </box>
            <text fg={uiTheme.muted}>
              Review the requested tool action before allowing it to run.
            </text>
          </box>

          <box
            backgroundColor={uiTheme.surface}
            border={['top', 'bottom', 'left', 'right']}
            borderColor={uiTheme.divider}
            paddingLeft={1}
            paddingRight={1}
          >
            <text fg={uiTheme.accent} attributes={TextAttributes.BOLD}>
              {toolIcon} {toolLabel}
            </text>
          </box>
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
              {renderSection(
                'Action',
                <box flexDirection="column" gap={1}>
                  <text fg={uiTheme.text} attributes={TextAttributes.BOLD} wrapMode="word">
                    {content.summary}
                  </text>
                  {content.detail ? (
                    <box
                      backgroundColor={uiTheme.surface}
                      border={['top', 'bottom', 'left', 'right']}
                      borderColor={uiTheme.divider}
                      paddingLeft={1}
                      paddingRight={1}
                    >
                      <text fg={uiTheme.text} wrapMode="char" attributes={uiTheme.typography.code}>
                        {content.detail}
                      </text>
                    </box>
                  ) : null}
                </box>
              )}

              {content.reason
                ? renderSection(
                    'Why approval is needed',
                    <text fg={uiTheme.text} wrapMode="word">
                      {content.reason}
                    </text>
                  )
                : null}

              {content.requestedPath
                ? renderSection(
                    'Requested path',
                    <text fg={uiTheme.text} wrapMode="char" attributes={uiTheme.typography.code}>
                      {content.requestedPath}
                    </text>,
                    uiTheme.codeBlock.bg
                  )
                : null}

              {content.allowedDirectories.length > 0
                ? renderSection(
                    'Allowed directories',
                    <box flexDirection="column" gap={0}>
                      {content.allowedDirectories.map((directory) => (
                        <text
                          key={directory}
                          fg={uiTheme.text}
                          wrapMode="char"
                          attributes={uiTheme.typography.code}
                        >
                          {directory}
                        </text>
                      ))}
                    </box>,
                    uiTheme.codeBlock.bg
                  )
                : null}

              {content.argumentItems.length > 0
                ? renderSection(
                    'Arguments',
                    <box flexDirection="column" gap={1}>
                      {content.argumentItems.map((item, index) => (
                        <box key={`${item.label}:${index}`} flexDirection="column" gap={0}>
                          <text fg={uiTheme.muted}>{item.label}</text>
                          <box
                            backgroundColor={item.multiline ? uiTheme.surface : uiTheme.panel}
                            border={['top', 'bottom', 'left', 'right']}
                            borderColor={uiTheme.divider}
                            paddingLeft={1}
                            paddingRight={1}
                          >
                            <text
                              fg={uiTheme.text}
                              wrapMode={item.multiline ? 'char' : 'word'}
                              attributes={item.multiline ? uiTheme.typography.code : undefined}
                            >
                              {item.value}
                            </text>
                          </box>
                        </box>
                      ))}
                    </box>,
                    uiTheme.codeBlock.bg
                  )
                : null}
            </box>
          </scrollbox>
        </box>

        <box
          flexDirection="row"
          justifyContent="space-between"
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          backgroundColor={uiTheme.panel}
        >
          <box flexDirection="row" gap={1}>
            {renderButton('Allow once', 'approve', selectedAction === 'approve')}
            {renderButton('Reject', 'deny', selectedAction === 'deny')}
          </box>
          <box flexDirection="column">
            <text fg={uiTheme.muted}>left/right switch enter confirm</text>
            <text fg={uiTheme.muted}>esc rejects this request</text>
          </box>
        </box>
      </box>
    </box>
  );
};
