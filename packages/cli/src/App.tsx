import { TextAttributes, type Selection } from '@opentui/core';
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { resolveSlashCommand, type SlashCommandDefinition } from './commands/slash-commands';
import { ConversationPanel } from './components/conversation-panel';
import { FilePickerDialog } from './components/file-picker-dialog';
import { FooterHints } from './components/footer-hints';
import { ModelPickerDialog } from './components/model-picker-dialog';
import { Prompt } from './components/prompt';
import { TaskPanel } from './components/task-panel';
import { ToolConfirmDialog } from './components/tool-confirm-dialog';
import { isMediaSelection } from './files/attachment-capabilities';
import type { PromptFileSelection } from './files/types';
import { useAgentChat } from './hooks/use-agent-chat';
import { useFilePicker } from './hooks/use-file-picker';
import { useModelPicker } from './hooks/use-model-picker';
import { useTaskPanel } from './hooks/use-task-panel';
import { requestExit } from './runtime/exit';
import { copyTextToClipboard } from './runtime/clipboard';
import { uiTheme } from './ui/theme';

const EXIT_CONFIRM_WINDOW_MS = 1000;

const appendFileTokens = (currentValue: string, files: PromptFileSelection[]) => {
  if (files.length === 0) {
    return currentValue;
  }

  const existingTokens = new Set(currentValue.match(/@\/\S+/g) ?? []);
  const newTokens = files
    .filter((file) => !isMediaSelection(file))
    .map((file) => `@/${file.relativePath}`)
    .filter((token) => !existingTokens.has(token));

  if (newTokens.length === 0) {
    return currentValue;
  }

  const trimmed = currentValue.trimEnd();
  const separator = trimmed.length > 0 ? ' ' : '';
  return `${trimmed}${separator}${newTokens.join(' ')} `;
};

const isFullAccessModeEnabled = (): boolean => {
  const raw = process.env.AGENT_FULL_ACCESS?.trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
};

export const App = () => {
  const taskPanel = useTaskPanel();
  const {
    turns,
    inputValue,
    isThinking,
    modelLabel,
    contextUsagePercent,
    pendingToolConfirm,
    setInputValue,
    selectedFiles,
    setSelectedFiles,
    appendSelectedFiles,
    submitInput,
    stopActiveReply,
    clearInput,
    resetConversation,
    setModelLabelDisplay,
    setToolConfirmSelection,
    setToolConfirmScope,
    submitToolConfirmSelection,
    rejectPendingToolConfirm,
  } = useAgentChat({
    onTaskMutation: () => {
      void taskPanel.refresh({ silent: true });
    },
  });
  const [slashMenuVisible, setSlashMenuVisible] = useState(false);
  const modelPicker = useModelPicker({
    onModelChanged: setModelLabelDisplay,
  });
  const filePicker = useFilePicker();
  const dimensions = useTerminalDimensions();
  const renderer = useRenderer();
  const [copyToastVisible, setCopyToastVisible] = useState(false);
  const selectedTextRef = useRef('');
  const copyToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitConfirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitConfirmArmedRef = useRef(false);
  const fullAccessModeEnabled = isFullAccessModeEnabled();

  const clearExitConfirm = useCallback(() => {
    exitConfirmArmedRef.current = false;
    if (exitConfirmTimeoutRef.current) {
      clearTimeout(exitConfirmTimeoutRef.current);
      exitConfirmTimeoutRef.current = null;
    }
  }, []);

  const showCopyToast = useCallback(() => {
    setCopyToastVisible(true);
    if (copyToastTimeoutRef.current) {
      clearTimeout(copyToastTimeoutRef.current);
    }
    copyToastTimeoutRef.current = setTimeout(() => {
      setCopyToastVisible(false);
      copyToastTimeoutRef.current = null;
    }, 1500);
  }, []);

  useEffect(() => {
    const handleSelection = (selection: Selection) => {
      selectedTextRef.current = selection.getSelectedText();
    };

    renderer.on('selection', handleSelection);

    return () => {
      renderer.off('selection', handleSelection);
      clearExitConfirm();
      if (copyToastTimeoutRef.current) {
        clearTimeout(copyToastTimeoutRef.current);
        copyToastTimeoutRef.current = null;
      }
    };
  }, [clearExitConfirm, renderer]);

  useEffect(() => {
    if (!isThinking) {
      void taskPanel.refresh();
    }
  }, [isThinking, taskPanel.refresh]);

  const submitWithCommands = useCallback(() => {
    const command = resolveSlashCommand(inputValue);
    if (command?.action === 'models') {
      setInputValue('');
      modelPicker.open();
      return;
    }
    if (command?.action === 'files') {
      setInputValue('');
      filePicker.open(selectedFiles);
      return;
    }

    submitInput();
  }, [filePicker, inputValue, modelPicker, selectedFiles, setInputValue, submitInput]);

  const handleSlashCommandSelect = useCallback(
    (command: SlashCommandDefinition) => {
      if (command.action === 'models') {
        setInputValue('');
        modelPicker.open();
        return true;
      }
      if (command.action === 'files') {
        setInputValue('');
        filePicker.open(selectedFiles);
        return true;
      }
      return false;
    },
    [filePicker, modelPicker, selectedFiles, setInputValue]
  );

  useKeyboard((key) => {
    if (key.ctrl && key.name === 'c') {
      const selectedText = selectedTextRef.current;
      if (selectedText) {
        clearExitConfirm();
        void copyTextToClipboard(selectedText, renderer).then((success) => {
          if (success) {
            showCopyToast();
          }
        });
        return;
      }

      if (exitConfirmArmedRef.current) {
        clearExitConfirm();
        requestExit(0);
        return;
      }

      exitConfirmArmedRef.current = true;
      exitConfirmTimeoutRef.current = setTimeout(() => {
        exitConfirmArmedRef.current = false;
        exitConfirmTimeoutRef.current = null;
      }, EXIT_CONFIRM_WINDOW_MS);
      return;
    }

    if (modelPicker.visible) {
      if (key.name === 'escape') {
        modelPicker.close();
      }
      return;
    }

    if (filePicker.visible) {
      if (key.name === 'escape') {
        filePicker.close();
      }
      return;
    }

    if (pendingToolConfirm) {
      if (key.name === 'left' || key.name === 'h') {
        setToolConfirmSelection('approve');
        return;
      }

      if (key.name === 'right' || key.name === 'l') {
        setToolConfirmSelection('deny');
        return;
      }

      if (key.name === 'return' || key.name === 'enter') {
        submitToolConfirmSelection();
        return;
      }

      if (pendingToolConfirm.kind === 'permission') {
        if (key.name === 'up' || key.name === 'k') {
          setToolConfirmScope('session');
          return;
        }

        if (key.name === 'down' || key.name === 'j') {
          setToolConfirmScope('turn');
          return;
        }
      }

      if (key.name === 'escape') {
        rejectPendingToolConfirm();
      }
      return;
    }

    if (key.ctrl && key.name === 'l') {
      resetConversation();
      void taskPanel.refresh();
      return;
    }

    if (key.ctrl && key.name === 't') {
      taskPanel.toggle();
      return;
    }

    if (key.name === 'escape') {
      if (slashMenuVisible) {
        return;
      }
      if (isThinking) {
        stopActiveReply();
        return;
      }
      clearInput();
    }
  });

  return (
    <box
      width={dimensions.width}
      height={dimensions.height}
      flexDirection="column"
      backgroundColor={uiTheme.bg}
      paddingTop={uiTheme.layout.appPaddingTop}
      paddingBottom={uiTheme.layout.appPaddingBottom}
      paddingLeft={uiTheme.layout.appPaddingX}
      paddingRight={uiTheme.layout.appPaddingX}
    >
      <ConversationPanel turns={turns} isThinking={isThinking} />
      <TaskPanel
        visible={taskPanel.visible}
        loading={taskPanel.loading}
        error={taskPanel.error}
        namespace={taskPanel.namespace}
        tasks={taskPanel.tasks}
        selectedIndex={taskPanel.selectedIndex}
        onSelectIndex={taskPanel.setSelectedIndex}
      />
      <Prompt
        isThinking={isThinking}
        disabled={modelPicker.visible || filePicker.visible || Boolean(pendingToolConfirm)}
        modelLabel={modelLabel}
        value={inputValue}
        selectedFiles={selectedFiles}
        onAddSelectedFiles={appendSelectedFiles}
        onValueChange={setInputValue}
        onSlashCommandSelect={handleSlashCommandSelect}
        onSlashMenuVisibilityChange={setSlashMenuVisible}
        onSubmit={submitWithCommands}
      />
      <FooterHints
        isThinking={isThinking}
        contextUsagePercent={contextUsagePercent}
        isFullAccessMode={fullAccessModeEnabled}
        taskPanelVisible={taskPanel.visible}
      />
      <ToolConfirmDialog
        visible={Boolean(pendingToolConfirm)}
        viewportWidth={dimensions.width}
        viewportHeight={dimensions.height}
        request={pendingToolConfirm}
      />
      <FilePickerDialog
        visible={filePicker.visible}
        viewportWidth={dimensions.width}
        viewportHeight={dimensions.height}
        loading={filePicker.loading}
        error={filePicker.error}
        search={filePicker.search}
        options={filePicker.options}
        selectedIndex={filePicker.selectedIndex}
        selectedPaths={filePicker.selectedPaths}
        onSearchChange={filePicker.setSearch}
        onSelectIndex={filePicker.setSelectedIndex}
        onToggleSelected={filePicker.toggleSelectedIndex}
        onConfirm={() => {
          const confirmedFiles = filePicker.confirmSelected();
          setSelectedFiles(confirmedFiles);
          setInputValue(appendFileTokens(inputValue, confirmedFiles));
        }}
        onListKeyDown={filePicker.handleListKeyDown}
      />
      <ModelPickerDialog
        visible={modelPicker.visible}
        viewportWidth={dimensions.width}
        viewportHeight={dimensions.height}
        loading={modelPicker.loading}
        switching={modelPicker.switching}
        error={modelPicker.error}
        search={modelPicker.search}
        options={modelPicker.options}
        selectedIndex={modelPicker.selectedIndex}
        onSearchChange={modelPicker.setSearch}
        onSelectIndex={modelPicker.setSelectedIndex}
        onConfirm={() => {
          void modelPicker.confirmSelected();
        }}
        onListKeyDown={modelPicker.handleListKeyDown}
      />
      {copyToastVisible ? (
        <box
          position="absolute"
          right={2}
          top={1}
          zIndex={20}
          flexDirection="row"
          gap={1}
          borderColor={uiTheme.divider}
          borderStyle="rounded"
          paddingX={1}
          paddingY={0}
        >
          <text fg={uiTheme.accent} attributes={TextAttributes.BOLD}>
            OK
          </text>
          <text fg={uiTheme.text} attributes={TextAttributes.BOLD}>
            Copied
          </text>
        </box>
      ) : null}
    </box>
  );
};
