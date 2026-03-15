import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../commands/slash-commands', () => ({
  resolveSlashCommand: vi.fn(),
}));

vi.mock('../agent/runtime/runtime', () => ({
  appendAgentPrompt: vi.fn(),
  getAgentModelAttachmentCapabilities: vi.fn(),
  getAgentModelLabel: vi.fn(),
  runAgentPrompt: vi.fn(),
}));

vi.mock('../runtime/exit', () => ({
  requestExit: vi.fn(),
}));

import * as runtime from '../agent/runtime/runtime';
import { useAgentChat } from './use-agent-chat';

describe('useAgentChat', () => {
  const mockGetAgentModelLabel = runtime.getAgentModelLabel as unknown as ReturnType<typeof vi.fn>;
  const mockGetAgentModelAttachmentCapabilities =
    runtime.getAgentModelAttachmentCapabilities as unknown as ReturnType<typeof vi.fn>;
  const mockAppendAgentPrompt = runtime.appendAgentPrompt as unknown as ReturnType<typeof vi.fn>;
  const mockRunAgentPrompt = runtime.runAgentPrompt as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentModelLabel.mockResolvedValue('glm-5');
    mockGetAgentModelAttachmentCapabilities.mockResolvedValue({
      image: false,
      audio: false,
      video: false,
    });
    mockAppendAgentPrompt.mockResolvedValue({ accepted: true });
    mockRunAgentPrompt.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes with default state and resolves the model label', async () => {
    const { result } = renderHook(() => useAgentChat());

    expect(result.current.turns).toEqual([]);
    expect(result.current.inputValue).toBe('');
    expect(result.current.isThinking).toBe(false);
    expect(result.current.contextUsagePercent).toBe(null);
    expect(result.current.pendingToolConfirm).toBe(null);

    await waitFor(() => {
      expect(result.current.modelLabel).toBe('glm-5');
    });
  });

  it('updates input value', async () => {
    const { result } = renderHook(() => useAgentChat());

    await waitFor(() => {
      expect(result.current.modelLabel).toBe('glm-5');
    });

    act(() => {
      result.current.setInputValue('test input');
    });

    expect(result.current.inputValue).toBe('test input');
  });

  it('clears input', async () => {
    const { result } = renderHook(() => useAgentChat());

    await waitFor(() => {
      expect(result.current.modelLabel).toBe('glm-5');
    });

    act(() => {
      result.current.setInputValue('test input');
    });
    expect(result.current.inputValue).toBe('test input');

    act(() => {
      result.current.clearInput();
    });

    expect(result.current.inputValue).toBe('');
  });

  it('queues follow-up input during an active run and switches subsequent stream output to the new turn', async () => {
    let capturedHandlers: Record<string, unknown> | undefined;
    let resolveRun!: (value: {
      text: string;
      completionReason: string;
      durationSeconds: number;
      modelLabel: string;
    }) => void;
    mockRunAgentPrompt.mockImplementation(
      async (_prompt: unknown, handlers: Record<string, unknown>) => {
        capturedHandlers = handlers;
        return new Promise((resolve) => {
          resolveRun = resolve;
        });
      }
    );

    const { result } = renderHook(() => useAgentChat());

    await waitFor(() => {
      expect(result.current.modelLabel).toBe('glm-5');
    });

    act(() => {
      result.current.setInputValue('first input');
    });
    act(() => {
      result.current.submitInput();
    });

    await waitFor(() => {
      expect(result.current.isThinking).toBe(true);
    });

    act(() => {
      result.current.setInputValue('follow up');
    });
    act(() => {
      result.current.submitInput();
    });

    await waitFor(() => {
      expect(mockAppendAgentPrompt).toHaveBeenCalledWith('follow up');
    });
    await waitFor(() => {
      expect(result.current.turns).toHaveLength(2);
    });

    act(() => {
      (
        capturedHandlers?.onUserMessage as
          | ((event: { text: string; stepIndex: number }) => void)
          | undefined
      )?.({
        text: 'follow up',
        stepIndex: 2,
      });
    });
    act(() => {
      (capturedHandlers?.onTextDelta as ((event: { text: string }) => void) | undefined)?.({
        text: 'stream after follow up',
      });
    });
    act(() => {
      (capturedHandlers?.onStop as ((event: { reason: string }) => void) | undefined)?.({
        reason: 'stop',
      });
    });

    act(() => {
      resolveRun({
        text: 'stream after follow up',
        completionReason: 'stop',
        durationSeconds: 1,
        modelLabel: 'glm-5',
      });
    });

    await waitFor(() => {
      expect(result.current.isThinking).toBe(false);
    });
    expect(result.current.turns).toHaveLength(2);
    expect(result.current.turns[1]?.prompt).toContain('follow up');
    expect(
      result.current.turns[1]?.reply?.segments.some((segment) =>
        segment.content.includes('stream after follow up')
      )
    ).toBe(true);
  });
});
