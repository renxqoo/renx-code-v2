import { useCallback, useEffect, useRef, useState } from 'react';

import { resolveSlashCommand } from '../commands/slash-commands';
import {
  appendAgentPrompt,
  getAgentModelAttachmentCapabilities,
  getAgentModelLabel,
  runAgentPrompt,
} from '../agent/runtime/runtime';
import type {
  AgentContextUsageEvent,
  AgentToolConfirmDecision,
  AgentToolConfirmEvent,
  AgentToolPermissionEvent,
  AgentToolPermissionGrant,
  AgentUserMessageEvent,
  AgentUsageEvent,
} from '../agent/runtime/types';
import { requestExit } from '../runtime/exit';
import type { ChatTurn, ReplySegmentType } from '../types/chat';
import type { PromptFileSelection } from '../files/types';
import { buildAgentEventHandlers } from './agent-event-handlers';
import {
  buildHelpSegments,
  buildUnsupportedSegments,
  extractErrorMessage,
} from './chat-local-replies';
import {
  appendNoteLine,
  appendToSegment,
  createStreamingReply,
  orderReplySegments,
  patchTurn,
  setReplyStatus,
} from './turn-updater';
import {
  DEFAULT_ATTACHMENT_MODEL_CAPABILITIES,
  type AttachmentModelCapabilities,
} from '../files/attachment-capabilities';
import { buildPromptContent } from '../files/attachment-content';
import { buildPromptDisplay } from '../files/prompt-display';

type ToolConfirmSelection = 'approve' | 'deny';
type ToolPermissionScope = AgentToolPermissionGrant['scope'];

export type PendingToolConfirm =
  | (AgentToolConfirmEvent & { selectedAction: ToolConfirmSelection })
  | (AgentToolPermissionEvent & {
      selectedAction: ToolConfirmSelection;
      selectedScope: ToolPermissionScope;
    });

type PendingToolConfirmResolver =
  | {
      kind: 'approval';
      resolve: (decision: AgentToolConfirmDecision) => void;
    }
  | {
      kind: 'permission';
      resolve: (grant: AgentToolPermissionGrant) => void;
    };

type PendingToolConfirmQueueEntry = {
  prompt: PendingToolConfirm;
  resolver: PendingToolConfirmResolver;
};

export type UseAgentChatResult = {
  turns: ChatTurn[];
  inputValue: string;
  selectedFiles: PromptFileSelection[];
  isThinking: boolean;
  modelLabel: string;
  contextUsagePercent: number | null;
  pendingToolConfirm: PendingToolConfirm | null;
  setInputValue: (value: string) => void;
  setSelectedFiles: (files: PromptFileSelection[]) => void;
  appendSelectedFiles: (files: PromptFileSelection[]) => void;
  removeSelectedFile: (absolutePath: string) => void;
  submitInput: () => void;
  stopActiveReply: () => void;
  clearInput: () => void;
  resetConversation: () => void;
  setModelLabelDisplay: (label: string) => void;
  setToolConfirmSelection: (selection: ToolConfirmSelection) => void;
  setToolConfirmScope: (scope: ToolPermissionScope) => void;
  submitToolConfirmSelection: () => void;
  rejectPendingToolConfirm: () => void;
};

const INITIAL_MODEL_LABEL = process.env.AGENT_MODEL?.trim() || '';

const normalizeTokenCount = (value: number | undefined): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.round(value));
};

/** Normalizes context usage percent, ensuring it's a finite non-negative number. */
const normalizeContextUsagePercent = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  return null;
};

const toReplyUsage = (
  usage?: AgentUsageEvent
):
  | {
      usagePromptTokens?: number;
      usageCompletionTokens?: number;
      usageTotalTokens?: number;
    }
  | undefined => {
  if (!usage) {
    return undefined;
  }

  const usagePromptTokens = normalizeTokenCount(usage.cumulativePromptTokens ?? usage.promptTokens);
  const usageCompletionTokens = normalizeTokenCount(
    usage.cumulativeCompletionTokens ?? usage.completionTokens
  );
  const usageTotalTokens = normalizeTokenCount(usage.cumulativeTotalTokens ?? usage.totalTokens);

  if (
    typeof usagePromptTokens !== 'number' &&
    typeof usageCompletionTokens !== 'number' &&
    typeof usageTotalTokens !== 'number'
  ) {
    return undefined;
  }

  return {
    usagePromptTokens,
    usageCompletionTokens,
    usageTotalTokens,
  };
};

export const resolveReplyStatus = (completionReason: string): 'done' | 'error' => {
  return completionReason === 'error' ? 'error' : 'done';
};

export const useAgentChat = (): UseAgentChatResult => {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<PromptFileSelection[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [modelLabel, setModelLabel] = useState(INITIAL_MODEL_LABEL);
  const [contextUsagePercent, setContextUsagePercent] = useState<number | null>(null);
  const [attachmentCapabilities, setAttachmentCapabilities] = useState<AttachmentModelCapabilities>(
    DEFAULT_ATTACHMENT_MODEL_CAPABILITIES
  );
  const [pendingToolConfirm, setPendingToolConfirm] = useState<PendingToolConfirm | null>(null);

  const removeSelectedFile = useCallback((absolutePath: string) => {
    setSelectedFiles((current) => current.filter((file) => file.absolutePath !== absolutePath));
  }, []);

  const appendSelectedFiles = useCallback((files: PromptFileSelection[]) => {
    if (files.length === 0) {
      return;
    }
    setSelectedFiles((current) => {
      const seen = new Set(current.map((file) => file.absolutePath));
      const next = [...current];
      for (const file of files) {
        if (seen.has(file.absolutePath)) {
          continue;
        }
        next.push(file);
        seen.add(file.absolutePath);
      }
      return next;
    });
  }, []);

  const turnIdRef = useRef(1);
  const requestIdRef = useRef(0);
  const activeTurnIdRef = useRef<number | null>(null);
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const activeRunPromiseRef = useRef<Promise<void> | null>(null);
  const pendingFollowUpTurnIdsRef = useRef<number[]>([]);
  const pendingToolConfirmRef = useRef<PendingToolConfirm | null>(null);
  const pendingToolConfirmResolverRef = useRef<PendingToolConfirmResolver | null>(null);
  const pendingToolConfirmQueueRef = useRef<PendingToolConfirmQueueEntry[]>([]);

  useEffect(() => {
    pendingToolConfirmRef.current = pendingToolConfirm;
  }, [pendingToolConfirm]);

  const buildCancelledToolPromptResult = useCallback(
    (
      prompt: PendingToolConfirm | null,
      message: string
    ): AgentToolConfirmDecision | AgentToolPermissionGrant => {
      if (prompt?.kind === 'permission') {
        return {
          granted: {},
          scope: prompt.selectedScope,
        };
      }
      return {
        approved: false,
        message,
      };
    },
    []
  );

  const resolvePendingToolConfirm = useCallback(
    (decision: AgentToolConfirmDecision | AgentToolPermissionGrant) => {
      const resolver = pendingToolConfirmResolverRef.current;
      pendingToolConfirmResolverRef.current = null;
      if (resolver) {
        if (resolver.kind === 'permission' && 'granted' in decision) {
          resolver.resolve(decision);
        }
        if (resolver.kind === 'approval' && 'approved' in decision) {
          resolver.resolve(decision);
        }
      }

      const next = pendingToolConfirmQueueRef.current.shift() ?? null;
      if (!next) {
        setPendingToolConfirm(null);
        return;
      }

      pendingToolConfirmResolverRef.current = next.resolver;
      setPendingToolConfirm(next.prompt);
    },
    []
  );

  const enqueuePendingToolConfirm = useCallback((entry: PendingToolConfirmQueueEntry) => {
    if (!pendingToolConfirmResolverRef.current) {
      pendingToolConfirmResolverRef.current = entry.resolver;
      setPendingToolConfirm(entry.prompt);
      return;
    }

    pendingToolConfirmQueueRef.current.push(entry);
  }, []);

  const cancelAllPendingToolConfirms = useCallback(
    (message: string) => {
      const currentPrompt = pendingToolConfirmRef.current;
      const currentResolver = pendingToolConfirmResolverRef.current;
      const queued = pendingToolConfirmQueueRef.current.splice(0);

      pendingToolConfirmResolverRef.current = null;
      setPendingToolConfirm(null);

      if (currentResolver) {
        const cancelled = buildCancelledToolPromptResult(currentPrompt, message);
        if (currentResolver.kind === 'permission' && 'granted' in cancelled) {
          currentResolver.resolve(cancelled);
        }
        if (currentResolver.kind === 'approval' && 'approved' in cancelled) {
          currentResolver.resolve(cancelled);
        }
      }

      for (const entry of queued) {
        const cancelled = buildCancelledToolPromptResult(entry.prompt, message);
        if (entry.resolver.kind === 'permission' && 'granted' in cancelled) {
          entry.resolver.resolve(cancelled);
        }
        if (entry.resolver.kind === 'approval' && 'approved' in cancelled) {
          entry.resolver.resolve(cancelled);
        }
      }
    },
    [buildCancelledToolPromptResult]
  );

  useEffect(() => {
    let disposed = false;
    void getAgentModelLabel()
      .then((label) => {
        if (!disposed) {
          setModelLabel(label);
        }
      })
      .catch(() => {});
    void getAgentModelAttachmentCapabilities()
      .then((capabilities) => {
        if (!disposed) {
          setAttachmentCapabilities(capabilities);
        }
      })
      .catch(() => {});

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      // 清理活动的Promise以防止内存泄漏
      const currentPromise = activeRunPromiseRef.current;
      if (currentPromise) {
        currentPromise.catch(() => {}); // 防止未处理的rejection
      }
      activeAbortControllerRef.current?.abort();
      pendingFollowUpTurnIdsRef.current = [];
      cancelAllPendingToolConfirms('Tool confirmation cancelled because the UI was closed.');
    };
  }, [cancelAllPendingToolConfirms]);

  const appendSegment = useCallback(
    (turnId: number, segmentId: string, type: ReplySegmentType, chunk: string, data?: unknown) => {
      setTurns((prev) =>
        patchTurn(prev, turnId, (turn) => {
          if (!turn.reply) {
            return turn;
          }
          return {
            ...turn,
            reply: {
              ...turn.reply,
              segments: orderReplySegments(
                appendToSegment(turn.reply.segments, segmentId, type, chunk, data)
              ),
            },
          };
        })
      );
    },
    []
  );

  const appendEventLine = useCallback((turnId: number, text: string) => {
    setTurns((prev) =>
      patchTurn(prev, turnId, (turn) => {
        if (!turn.reply) {
          return turn;
        }
        return {
          ...turn,
          reply: {
            ...turn.reply,
            segments: orderReplySegments(
              appendNoteLine(turn.reply.segments, `${turnId}:events`, text)
            ),
          },
        };
      })
    );
  }, []);

  const stopActiveReply = useCallback(() => {
    if (!isThinking) {
      return;
    }

    cancelAllPendingToolConfirms('Tool confirmation cancelled because the request was stopped.');
    requestIdRef.current += 1;
    activeAbortControllerRef.current?.abort();
    activeAbortControllerRef.current = null;
    activeRunPromiseRef.current = null;
    setIsThinking(false);

    const activeTurnId = activeTurnIdRef.current;
    activeTurnIdRef.current = null;
    if (typeof activeTurnId !== 'number') {
      return;
    }

    appendEventLine(activeTurnId, '[stop] aborted by user');
    setTurns((prev) =>
      setReplyStatus(prev, activeTurnId, 'done', {
        completionReason: 'cancelled',
        completionMessage: 'Stopped by user.',
      })
    );
  }, [appendEventLine, cancelAllPendingToolConfirms, isThinking]);

  const resetConversation = useCallback(() => {
    cancelAllPendingToolConfirms('Tool confirmation cancelled because the conversation was reset.');
    requestIdRef.current += 1;
    activeAbortControllerRef.current?.abort();
    activeAbortControllerRef.current = null;
    activeRunPromiseRef.current = null;
    activeTurnIdRef.current = null;
    setIsThinking(false);
    setTurns([]);
    setSelectedFiles([]);
    setContextUsagePercent(() => null);
  }, [cancelAllPendingToolConfirms]);

  const addTurn = useCallback(
    (prompt: string, withStreamingReply = false, files: PromptFileSelection[] = []): number => {
      const turnId = turnIdRef.current++;
      const displayPrompt = buildPromptDisplay(prompt, files);
      setTurns((prev) => [
        ...prev,
        {
          id: turnId,
          prompt: displayPrompt,
          files: files.map((file) => file.relativePath),
          createdAtMs: Date.now(),
          reply: withStreamingReply ? createStreamingReply(modelLabel) : undefined,
        },
      ]);
      return turnId;
    },
    [modelLabel]
  );

  const startStreamingReplyForTurn = useCallback(
    (turnId: number) => {
      setTurns((prev) =>
        patchTurn(prev, turnId, (turn) => ({
          ...turn,
          reply: turn.reply ?? createStreamingReply(modelLabel),
        }))
      );
    },
    [modelLabel]
  );

  const setImmediateReply = useCallback(
    (
      turnId: number,
      segments: Array<{ id: string; type: 'thinking' | 'text'; content: string }>
    ) => {
      setTurns((prev) =>
        patchTurn(prev, turnId, (turn) => ({
          ...turn,
          reply: {
            ...createStreamingReply(modelLabel),
            status: 'done',
            durationSeconds: 0,
            segments,
          },
        }))
      );
    },
    [modelLabel]
  );

  const runCommand = useCallback(
    (commandText: string): boolean => {
      const command = resolveSlashCommand(commandText);
      if (!command) {
        return false;
      }

      if (command.action === 'clear') {
        resetConversation();
        return true;
      }

      if (command.action === 'exit') {
        requestExit(0);
        return true;
      }

      if (command.action === 'help') {
        const turnId = addTurn(commandText.trim(), true);
        setImmediateReply(turnId, buildHelpSegments(turnId));
        return true;
      }

      const turnId = addTurn(commandText.trim(), true);
      setImmediateReply(turnId, buildUnsupportedSegments(turnId, command.name));
      return true;
    },
    [addTurn, resetConversation, setImmediateReply]
  );

  const submitInput = useCallback(() => {
    const text = inputValue.trim();
    const attachedFiles = selectedFiles;
    if (text.length === 0 && attachedFiles.length === 0) {
      return;
    }

    setInputValue('');

    if (isThinking) {
      if (text.startsWith('/') && attachedFiles.length === 0) {
        return;
      }

      setSelectedFiles([]);
      const currentRequestId = requestIdRef.current;
      const isCurrentRequest = () => currentRequestId === requestIdRef.current;
      const activeTurnId = activeTurnIdRef.current;

      void buildPromptContent(text, attachedFiles, attachmentCapabilities)
        .then((promptContent) => appendAgentPrompt(promptContent))
        .then((result) => {
          if (!isCurrentRequest()) {
            return;
          }
          if (!result.accepted) {
            if (activeTurnId !== null) {
              appendEventLine(activeTurnId, `[input] follow-up rejected: ${result.reason}`);
            }
            return;
          }

          const queuedTurnId = addTurn(text, false, attachedFiles);
          pendingFollowUpTurnIdsRef.current.push(queuedTurnId);
          if (activeTurnId !== null) {
            appendEventLine(activeTurnId, `[input] queued follow-up`);
          }
        })
        .catch((error) => {
          if (!isCurrentRequest()) {
            return;
          }
          if (activeTurnId !== null) {
            appendEventLine(activeTurnId, `[error] ${extractErrorMessage(error)}`);
          }
        });
      return;
    }

    if (attachedFiles.length === 0 && text.startsWith('/') && runCommand(text)) {
      return;
    }

    setSelectedFiles([]);

    void (async () => {
      const previousRun = activeRunPromiseRef.current;
      if (previousRun) {
        await previousRun.catch((error) => {
          console.debug(
            'Previous run failed:',
            error instanceof Error ? error.message : String(error)
          );
        });
      }

      const turnId = addTurn(text, true, attachedFiles);
      let streamTurnId = turnId;
      activeTurnIdRef.current = turnId;
      const currentRequestId = ++requestIdRef.current;
      const isCurrentRequest = () => currentRequestId === requestIdRef.current;
      const getCurrentTurnId = () => streamTurnId;
      const abortController = new AbortController();
      activeAbortControllerRef.current = abortController;
      pendingFollowUpTurnIdsRef.current = [];

      setIsThinking(true);

      const baseHandlers = buildAgentEventHandlers({
        getTurnId: getCurrentTurnId,
        isCurrentRequest,
        appendSegment,
        appendEventLine,
      });
      const handlers = {
        ...baseHandlers,
        onToolConfirmRequest: (event: AgentToolConfirmEvent) => {
          if (!isCurrentRequest()) {
            return Promise.resolve({
              approved: false,
              message: 'Tool confirmation denied because the request is no longer active.',
            });
          }

          return new Promise<AgentToolConfirmDecision>((resolve) => {
            enqueuePendingToolConfirm({
              prompt: {
                ...event,
                selectedAction: 'approve',
              },
              resolver: {
                kind: 'approval',
                resolve,
              },
            });
          });
        },
        onToolPermissionRequest: (event: AgentToolPermissionEvent) => {
          if (!isCurrentRequest()) {
            return Promise.resolve({
              granted: {},
              scope: event.requestedScope,
            });
          }

          return new Promise<AgentToolPermissionGrant>((resolve) => {
            enqueuePendingToolConfirm({
              prompt: {
                ...event,
                selectedAction: 'approve',
                selectedScope: event.requestedScope,
              },
              resolver: {
                kind: 'permission',
                resolve,
              },
            });
          });
        },
        onUsage: (event: AgentUsageEvent) => {
          if (!isCurrentRequest()) {
            return;
          }
          const normalized = normalizeContextUsagePercent(event.contextUsagePercent);
          if (normalized !== null) {
            setContextUsagePercent(normalized);
          }
          const replyUsage = toReplyUsage(event);
          if (!replyUsage) {
            return;
          }
          setTurns((prev) =>
            patchTurn(prev, turnId, (turn) => {
              if (!turn.reply) {
                return turn;
              }
              return {
                ...turn,
                reply: {
                  ...turn.reply,
                  ...replyUsage,
                },
              };
            })
          );
        },
        onContextUsage: (event: AgentContextUsageEvent) => {
          if (!isCurrentRequest()) {
            return;
          }
          const normalized = normalizeContextUsagePercent(event.contextUsagePercent);
          if (normalized !== null) {
            setContextUsagePercent(normalized);
          }
        },
        onUserMessage: (event: AgentUserMessageEvent) => {
          if (!isCurrentRequest()) {
            return;
          }

          const nextTurnId =
            pendingFollowUpTurnIdsRef.current.shift() ?? addTurn(event.text, false);
          setTurns((prev) => setReplyStatus(prev, streamTurnId, 'done'));
          streamTurnId = nextTurnId;
          activeTurnIdRef.current = nextTurnId;
          startStreamingReplyForTurn(nextTurnId);
        },
      };

      const runPromise = buildPromptContent(text, attachedFiles, attachmentCapabilities)
        .then((promptContent) =>
          runAgentPrompt(promptContent, handlers, {
            abortSignal: abortController.signal,
          })
        )
        .then((result) => {
          if (!isCurrentRequest()) {
            return;
          }

          setModelLabel(result.modelLabel);
          if (result.usage) {
            const normalized = normalizeContextUsagePercent(result.usage.contextUsagePercent);
            if (normalized !== null) {
              setContextUsagePercent(normalized);
            }
          }
          const replyUsage = toReplyUsage(result.usage);
          setTurns((prev) => {
            const withFallbackText = patchTurn(prev, getCurrentTurnId(), (turn) => {
              if (!turn.reply || !result.text) {
                return turn;
              }

              const hasAssistantText = turn.reply.segments.some(
                (segment) =>
                  (segment.type === 'text' || segment.type === 'thinking') &&
                  segment.content.trim().length > 0
              );
              if (hasAssistantText) {
                return turn;
              }

              return {
                ...turn,
                reply: {
                  ...turn.reply,
                  segments: orderReplySegments(
                    appendToSegment(turn.reply.segments, `${turnId}:text`, 'text', result.text)
                  ),
                },
              };
            });

            return setReplyStatus(
              withFallbackText,
              getCurrentTurnId(),
              resolveReplyStatus(result.completionReason),
              {
                durationSeconds: result.durationSeconds,
                completionReason: result.completionReason,
                completionMessage: result.completionMessage,
                modelLabel: result.modelLabel,
                ...(replyUsage ?? {}),
              }
            );
          });
        })
        .catch((error) => {
          if (!isCurrentRequest()) {
            return;
          }
          appendEventLine(getCurrentTurnId(), `[error] ${extractErrorMessage(error)}`);
          setTurns((prev) => setReplyStatus(prev, getCurrentTurnId(), 'error'));
        })
        .finally(() => {
          if (activeAbortControllerRef.current === abortController) {
            activeAbortControllerRef.current = null;
          }
          if (activeTurnIdRef.current === getCurrentTurnId()) {
            activeTurnIdRef.current = null;
          }
          pendingFollowUpTurnIdsRef.current = [];
          if (!isCurrentRequest()) {
            return;
          }
          setIsThinking(false);
        });

      const trackedRunPromise = runPromise.finally(() => {
        if (activeRunPromiseRef.current === trackedRunPromise) {
          activeRunPromiseRef.current = null;
        }
      });
      activeRunPromiseRef.current = trackedRunPromise;
      await trackedRunPromise;
    })();
  }, [
    addTurn,
    appendEventLine,
    appendSegment,
    attachmentCapabilities,
    enqueuePendingToolConfirm,
    inputValue,
    addTurn,
    isThinking,
    runCommand,
    selectedFiles,
    startStreamingReplyForTurn,
  ]);

  const clearInput = useCallback(() => {
    setInputValue('');
    setSelectedFiles([]);
  }, []);

  const setModelLabelDisplay = useCallback((label: string) => {
    setModelLabel(label);
    void getAgentModelAttachmentCapabilities()
      .then((capabilities) => {
        setAttachmentCapabilities(capabilities);
      })
      .catch(() => {});
  }, []);

  const setToolConfirmSelection = useCallback((selection: ToolConfirmSelection) => {
    setPendingToolConfirm((current) =>
      current ? { ...current, selectedAction: selection } : current
    );
  }, []);

  const setToolConfirmScope = useCallback((scope: ToolPermissionScope) => {
    setPendingToolConfirm((current) => {
      if (!current || current.kind !== 'permission') {
        return current;
      }
      return {
        ...current,
        selectedScope: scope,
      };
    });
  }, []);

  const rejectPendingToolConfirm = useCallback(() => {
    if (!pendingToolConfirm) {
      return;
    }

    if (pendingToolConfirm.kind === 'permission') {
      resolvePendingToolConfirm({
        granted: {},
        scope: pendingToolConfirm.selectedScope,
      });
      return;
    }

    resolvePendingToolConfirm({
      approved: false,
      message: 'Tool call denied by user.',
    });
  }, [pendingToolConfirm, resolvePendingToolConfirm]);

  const submitToolConfirmSelection = useCallback(() => {
    if (!pendingToolConfirm) {
      return;
    }

    if (pendingToolConfirm.selectedAction === 'deny') {
      rejectPendingToolConfirm();
      return;
    }

    if (pendingToolConfirm.kind === 'permission') {
      resolvePendingToolConfirm({
        granted: pendingToolConfirm.permissions,
        scope: pendingToolConfirm.selectedScope,
      });
      return;
    }

    resolvePendingToolConfirm({ approved: true });
  }, [pendingToolConfirm, rejectPendingToolConfirm, resolvePendingToolConfirm]);

  return {
    turns,
    inputValue,
    selectedFiles,
    isThinking,
    modelLabel,
    contextUsagePercent,
    pendingToolConfirm,
    setInputValue,
    setSelectedFiles,
    appendSelectedFiles,
    removeSelectedFile,
    submitInput,
    stopActiveReply,
    clearInput,
    resetConversation,
    setModelLabelDisplay,
    setToolConfirmSelection,
    setToolConfirmScope,
    submitToolConfirmSelection,
    rejectPendingToolConfirm,
  };
};
