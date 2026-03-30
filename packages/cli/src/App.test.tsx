import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequestExit = vi.fn();
const mockCopyTextToClipboard = vi.fn();
const mockUseAgentChat = vi.fn();
const mockUseTaskPanel = vi.fn();
const mockUseModelPicker = vi.fn();
const mockUseFilePicker = vi.fn();
const mockUseRenderer = vi.fn();
const mockUseTerminalDimensions = vi.fn();
const keyboardHandlers: Array<(key: { ctrl?: boolean; name: string }) => void> = [];
const rendererListeners = new Map<string, Set<(payload: unknown) => void>>();

vi.mock('@opentui/react', () => ({
  useKeyboard: (handler: (key: { ctrl?: boolean; name: string }) => void) => {
    keyboardHandlers.push(handler);
  },
  useRenderer: () => mockUseRenderer(),
  useTerminalDimensions: () => mockUseTerminalDimensions(),
}));

vi.mock('./runtime/exit', () => ({
  requestExit: (...args: unknown[]) => mockRequestExit(...args),
}));

vi.mock('./runtime/clipboard', () => ({
  copyTextToClipboard: (...args: unknown[]) => mockCopyTextToClipboard(...args),
}));

vi.mock('./hooks/use-agent-chat', () => ({
  useAgentChat: (...args: unknown[]) => mockUseAgentChat(...args),
}));

vi.mock('./hooks/use-task-panel', () => ({
  useTaskPanel: (...args: unknown[]) => mockUseTaskPanel(...args),
}));

vi.mock('./hooks/use-model-picker', () => ({
  useModelPicker: (...args: unknown[]) => mockUseModelPicker(...args),
}));

vi.mock('./hooks/use-file-picker', () => ({
  useFilePicker: (...args: unknown[]) => mockUseFilePicker(...args),
}));

vi.mock('./components/conversation-panel', () => ({
  ConversationPanel: () => <box />,
}));
vi.mock('./components/task-panel', () => ({
  TaskPanel: () => <box />,
}));
vi.mock('./components/prompt', () => ({
  Prompt: () => <box />,
}));
vi.mock('./components/footer-hints', () => ({
  FooterHints: () => <box />,
}));
vi.mock('./components/tool-confirm-dialog', () => ({
  ToolConfirmDialog: () => <box />,
}));
vi.mock('./components/file-picker-dialog', () => ({
  FilePickerDialog: () => <box />,
}));
vi.mock('./components/model-picker-dialog', () => ({
  ModelPickerDialog: () => <box />,
}));

import { App } from './App';

const emitRendererEvent = (eventName: string, payload: unknown) => {
  const listeners = rendererListeners.get(eventName);
  if (!listeners) {
    return;
  }
  for (const listener of listeners) {
    listener(payload);
  }
};

const getLatestKeyboardHandler = () => {
  const handler = keyboardHandlers.at(-1);
  if (!handler) {
    throw new Error('Expected a keyboard handler to be registered.');
  }
  return handler;
};

describe('App clipboard shortcuts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    keyboardHandlers.length = 0;
    rendererListeners.clear();

    mockUseRenderer.mockReturnValue({
      on: vi.fn((eventName: string, listener: (payload: unknown) => void) => {
        const listeners = rendererListeners.get(eventName) ?? new Set<(payload: unknown) => void>();
        listeners.add(listener);
        rendererListeners.set(eventName, listeners);
      }),
      off: vi.fn((eventName: string, listener: (payload: unknown) => void) => {
        rendererListeners.get(eventName)?.delete(listener);
      }),
    });
    mockUseTerminalDimensions.mockReturnValue({ width: 120, height: 40 });
    mockUseTaskPanel.mockReturnValue({
      visible: false,
      loading: false,
      error: null,
      namespace: 'default',
      tasks: [],
      selectedIndex: 0,
      setSelectedIndex: vi.fn(),
      toggle: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
    });
    mockUseModelPicker.mockReturnValue({
      visible: false,
      loading: false,
      switching: false,
      error: null,
      search: '',
      options: [],
      selectedIndex: 0,
      open: vi.fn(),
      close: vi.fn(),
      setSearch: vi.fn(),
      setSelectedIndex: vi.fn(),
      handleListKeyDown: vi.fn(() => false),
      confirmSelected: vi.fn().mockResolvedValue(false),
    });
    mockUseFilePicker.mockReturnValue({
      visible: false,
      loading: false,
      error: null,
      search: '',
      options: [],
      selectedIndex: 0,
      selectedPaths: new Set(),
      open: vi.fn(),
      close: vi.fn(),
      setSearch: vi.fn(),
      toggleSelectedIndex: vi.fn(),
      setSelectedIndex: vi.fn(),
      handleListKeyDown: vi.fn(() => false),
      confirmSelected: vi.fn(() => []),
    });
    mockUseAgentChat.mockReturnValue({
      turns: [],
      inputValue: '',
      isThinking: false,
      modelLabel: 'glm-5',
      contextUsagePercent: null,
      pendingToolConfirm: null,
      setInputValue: vi.fn(),
      selectedFiles: [],
      setSelectedFiles: vi.fn(),
      appendSelectedFiles: vi.fn(),
      submitInput: vi.fn(),
      stopActiveReply: vi.fn(),
      clearInput: vi.fn(),
      resetConversation: vi.fn(),
      setModelLabelDisplay: vi.fn(),
      setToolConfirmSelection: vi.fn(),
      setToolConfirmScope: vi.fn(),
      submitToolConfirmSelection: vi.fn(),
      rejectPendingToolConfirm: vi.fn(),
    });
    mockCopyTextToClipboard.mockResolvedValue(true);
    mockRequestExit.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not auto copy just because the selection changed', async () => {
    render(<App />);

    act(() => {
      emitRendererEvent('selection', {
        getSelectedText: () => 'selected text',
      });
      vi.advanceTimersByTime(100);
    });

    expect(mockCopyTextToClipboard).not.toHaveBeenCalled();
    expect(mockRequestExit).not.toHaveBeenCalled();
  });

  it('copies the current selection on Ctrl+C instead of exiting', async () => {
    render(<App />);

    act(() => {
      emitRendererEvent('selection', {
        getSelectedText: () => 'selected text',
      });
    });

    await act(async () => {
      getLatestKeyboardHandler()({ ctrl: true, name: 'c' });
    });

    expect(mockCopyTextToClipboard).toHaveBeenCalledWith('selected text', expect.any(Object));
    expect(mockRequestExit).not.toHaveBeenCalled();
  });

  it('keeps treating the current selection as selectable text across repeated Ctrl+C presses until selection clears', async () => {
    render(<App />);

    act(() => {
      emitRendererEvent('selection', {
        getSelectedText: () => 'selected text',
      });
    });

    await act(async () => {
      getLatestKeyboardHandler()({ ctrl: true, name: 'c' });
    });
    expect(mockCopyTextToClipboard).toHaveBeenCalledTimes(1);
    expect(mockRequestExit).not.toHaveBeenCalled();

    await act(async () => {
      getLatestKeyboardHandler()({ ctrl: true, name: 'c' });
    });

    expect(mockCopyTextToClipboard).toHaveBeenCalledTimes(2);
    expect(mockRequestExit).not.toHaveBeenCalled();
  });

  it('does not exit on the first Ctrl+C when there is no current selection', async () => {
    render(<App />);

    act(() => {
      emitRendererEvent('selection', {
        getSelectedText: () => '',
      });
    });

    await act(async () => {
      getLatestKeyboardHandler()({ ctrl: true, name: 'c' });
    });

    expect(mockCopyTextToClipboard).not.toHaveBeenCalled();
    expect(mockRequestExit).not.toHaveBeenCalled();
  });

  it('exits when Ctrl+C is pressed twice within one second without a current selection', async () => {
    render(<App />);

    act(() => {
      emitRendererEvent('selection', {
        getSelectedText: () => '',
      });
    });

    await act(async () => {
      getLatestKeyboardHandler()({ ctrl: true, name: 'c' });
    });
    expect(mockRequestExit).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(900);
    });

    await act(async () => {
      getLatestKeyboardHandler()({ ctrl: true, name: 'c' });
    });

    expect(mockRequestExit).toHaveBeenCalledWith(0);
  });

  it('does not exit when the second Ctrl+C happens after the one second confirmation window', async () => {
    render(<App />);

    act(() => {
      emitRendererEvent('selection', {
        getSelectedText: () => '',
      });
    });

    await act(async () => {
      getLatestKeyboardHandler()({ ctrl: true, name: 'c' });
    });
    expect(mockRequestExit).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1001);
    });

    await act(async () => {
      getLatestKeyboardHandler()({ ctrl: true, name: 'c' });
    });

    expect(mockRequestExit).not.toHaveBeenCalled();
  });
});
