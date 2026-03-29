import {
  formatLoopEvent,
  formatStepEvent,
  formatStopEvent,
  formatToolConfirmEvent,
  formatToolResultEvent,
  formatToolResultEventCode,
  formatToolStreamEvent,
  formatToolUseEvent,
  formatToolUseEventCode,
} from '../agent/runtime/event-format';
import type {
  AgentEventHandlers,
  AgentToolResultEvent,
  AgentToolStreamEvent,
  AgentToolUseEvent,
} from '../agent/runtime/types';
import type { ReplySegmentType } from '../types/chat';
import {
  buildEventSourceKey,
  buildToolInstanceKey,
  formatSubagentSourceLabel,
  withReplySourceMeta,
} from '../utils/reply-source';

type BuildAgentEventHandlersParams = {
  getTurnId: () => number;
  isCurrentRequest: () => boolean;
  appendSegment: (
    turnId: number,
    segmentId: string,
    type: ReplySegmentType,
    chunk: string,
    data?: unknown
  ) => void;
  appendEventLine: (turnId: number, text: string) => void;
};

type RegisteredSubagentSource = {
  sourceLabel: string;
  spawnedByLabel?: string;
  spawnToolCallId?: string;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const readString = (value: unknown): string | undefined => {
  return typeof value === 'string' ? value : undefined;
};

const readBoolean = (value: unknown): boolean | undefined => {
  return typeof value === 'boolean' ? value : undefined;
};

const truncateText = (value: string, maxLength = 56): string => {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
};

const parseJsonObject = (raw: string | undefined): Record<string, unknown> | null => {
  if (!raw) {
    return null;
  }
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return null;
  }
};

const readToolFunction = (toolCall: unknown): Record<string, unknown> | null => {
  const toolCallRecord = asRecord(toolCall);
  return asRecord(toolCallRecord?.function);
};

const readToolName = (toolCall: unknown): string | undefined => {
  return readString(readToolFunction(toolCall)?.name);
};

const readToolArguments = (toolCall: unknown): Record<string, unknown> | null => {
  return parseJsonObject(readString(readToolFunction(toolCall)?.arguments));
};

const formatRegisteredSubagentLabel = (record: Record<string, unknown>): string | undefined => {
  const description = readString(record.description)?.trim();
  const role = readString(record.role)?.trim() ?? readString(record.subagentType)?.trim();
  const agentId = readString(record.agentId)?.trim();

  if (description && role) {
    return `subagent ${truncateText(description, 48)} (${role})`;
  }
  if (description) {
    return `subagent ${truncateText(description, 56)}`;
  }
  if (role) {
    return `subagent ${role}`;
  }
  if (agentId) {
    return `subagent ${truncateText(agentId, 24)}`;
  }

  return undefined;
};

const formatSpawnedByLabel = (args: Record<string, unknown> | null): string | undefined => {
  if (!args) {
    return undefined;
  }

  const description = readString(args.description)?.trim();
  const prompt = readString(args.prompt)?.trim();
  const role = readString(args.role)?.trim();
  const mode =
    readBoolean(args.runInBackground) === true
      ? 'background'
      : readBoolean(args.runInBackground) === false
        ? 'foreground'
        : undefined;
  const headline = description
    ? truncateText(description, 48)
    : prompt
      ? truncateText(prompt, 48)
      : undefined;
  const parts = [headline, role, mode].filter((value): value is string => Boolean(value));

  return parts.length > 0
    ? `spawned by Spawn Agent (${parts.join(' | ')})`
    : 'spawned by Spawn Agent';
};

const readSpawnedSubagentRecord = (event: AgentToolResultEvent): Record<string, unknown> | null => {
  if (readToolName(event.toolCall) !== 'spawn_agent') {
    return null;
  }

  const resultRecord = asRecord(event.result);
  const resultData = asRecord(resultRecord?.data);
  return asRecord(resultData?.structured) ?? asRecord(resultData?.payload);
};

const shouldShowEventLog = () => {
  const value = process.env.AGENT_SHOW_EVENTS?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
};

const shouldSuppressToolResultInChat = (event: AgentToolResultEvent): boolean => {
  if (!event.toolCall || typeof event.toolCall !== 'object') {
    return false;
  }
  const toolFunction =
    'function' in event.toolCall &&
    event.toolCall.function &&
    typeof event.toolCall.function === 'object'
      ? (event.toolCall.function as { name?: unknown })
      : null;
  return typeof toolFunction?.name === 'string' && toolFunction.name.startsWith('task_');
};

export const buildAgentEventHandlers = ({
  getTurnId,
  isCurrentRequest,
  appendSegment,
  appendEventLine,
}: BuildAgentEventHandlersParams): AgentEventHandlers => {
  const showEvents = shouldShowEventLog();
  const streamedToolCallIds = new Set<string>();
  const renderedToolUseIds = new Set<string>();
  let anonymousToolUseCounter = 0;
  let anonymousToolResultCounter = 0;
  let streamSegmentCursor = 0;
  let primarySourceKey: string | null = null;
  let lastRenderedSourceKey: string | null = null;
  const registeredSubagentSources = new Map<string, RegisteredSubagentSource>();
  let activeTextSegment: {
    id: string;
    type: 'thinking' | 'text';
    sourceKey?: string;
  } | null = null;

  const registerSpawnedSubagentSource = (event: AgentToolResultEvent) => {
    const record = readSpawnedSubagentRecord(event);
    if (!record) {
      return;
    }

    const executionId = readString(record.executionId);
    const conversationId = readString(record.conversationId);
    const sourceKey = buildEventSourceKey({ executionId, conversationId });
    if (!sourceKey) {
      return;
    }

    registeredSubagentSources.set(sourceKey, {
      sourceLabel:
        formatRegisteredSubagentLabel(record) ??
        formatSubagentSourceLabel({ executionId, conversationId }),
      spawnedByLabel: formatSpawnedByLabel(readToolArguments(event.toolCall)),
      spawnToolCallId: readToolCallIdFromResult(event),
    });

    if (lastRenderedSourceKey === sourceKey) {
      lastRenderedSourceKey = null;
    }
  };

  const readEventSource = (
    event: Partial<{
      executionId: unknown;
      conversationId: unknown;
    }>
  ) => {
    const executionId = typeof event.executionId === 'string' ? event.executionId : undefined;
    const conversationId =
      typeof event.conversationId === 'string' ? event.conversationId : undefined;
    const explicitSourceKey = buildEventSourceKey({ executionId, conversationId });
    const registeredSource = explicitSourceKey
      ? registeredSubagentSources.get(explicitSourceKey)
      : undefined;
    if (explicitSourceKey && !primarySourceKey) {
      primarySourceKey = explicitSourceKey;
    }
    const sourceKey = explicitSourceKey ?? primarySourceKey ?? undefined;
    const isSubagent = Boolean(
      explicitSourceKey && primarySourceKey && explicitSourceKey !== primarySourceKey
    );
    const showSourceHeader = Boolean(
      isSubagent && sourceKey && sourceKey !== lastRenderedSourceKey
    );
    if (sourceKey) {
      lastRenderedSourceKey = sourceKey;
    }
    return {
      executionId,
      conversationId,
      sourceKey,
      isSubagent,
      showSourceHeader,
      sourceLabel: isSubagent
        ? (registeredSource?.sourceLabel ??
          formatSubagentSourceLabel({ executionId, conversationId }))
        : undefined,
      spawnedByLabel: isSubagent ? registeredSource?.spawnedByLabel : undefined,
      spawnToolCallId: isSubagent ? registeredSource?.spawnToolCallId : undefined,
    };
  };

  const createStreamSegmentId = (type: 'thinking' | 'text', sourceKey?: string) => {
    streamSegmentCursor += 1;
    const turnId = getTurnId();
    return sourceKey
      ? `${turnId}:${type}:${streamSegmentCursor}:${sourceKey}`
      : `${turnId}:${type}:${streamSegmentCursor}`;
  };

  const appendTextDeltaInOrder = (
    text: string,
    isReasoning: boolean,
    source: ReturnType<typeof readEventSource>
  ) => {
    const type: 'thinking' | 'text' = isReasoning ? 'thinking' : 'text';
    if (
      !activeTextSegment ||
      activeTextSegment.type !== type ||
      activeTextSegment.sourceKey !== source.sourceKey
    ) {
      activeTextSegment = {
        id: createStreamSegmentId(type, source.isSubagent ? source.sourceKey : undefined),
        type,
        sourceKey: source.isSubagent ? source.sourceKey : undefined,
      };
    }
    appendSegment(
      getTurnId(),
      activeTextSegment.id,
      type,
      text,
      source.isSubagent ? withReplySourceMeta(undefined, source) : undefined
    );
  };

  const breakTextDeltaContinuation = () => {
    activeTextSegment = null;
  };

  const readToolCallIdFromResult = (event: AgentToolResultEvent): string | undefined => {
    if (!event.toolCall || typeof event.toolCall !== 'object') {
      return undefined;
    }
    const maybeId = (event.toolCall as { id?: unknown }).id;
    return typeof maybeId === 'string' ? maybeId : undefined;
  };

  const readToolCallIdFromUse = (event: AgentToolUseEvent): string | undefined => {
    if (!event || typeof event !== 'object') {
      return undefined;
    }
    const maybeId = (event as { id?: unknown }).id;
    return typeof maybeId === 'string' ? maybeId : undefined;
  };

  const buildToolSegmentKey = (
    source: ReturnType<typeof readEventSource>,
    toolCallId: string | undefined
  ): string | undefined => {
    if (!source.isSubagent) {
      return toolCallId;
    }
    return buildToolInstanceKey(
      {
        executionId: source.executionId,
        conversationId: source.conversationId,
      },
      toolCallId
    );
  };

  const toToolStreamSegmentData = (
    event: AgentToolStreamEvent,
    source: ReturnType<typeof readEventSource>
  ) => (source.isSubagent ? withReplySourceMeta(event, source) : { ...event });

  const logEvent = (text: string) => {
    if (!showEvents) {
      return;
    }
    appendEventLine(getTurnId(), text);
  };

  return {
    onTextDelta: (event) => {
      if (!isCurrentRequest() || !event.text) {
        return;
      }
      appendTextDeltaInOrder(event.text, Boolean(event.isReasoning), readEventSource(event));
    },
    onTextComplete: () => {
      if (!isCurrentRequest()) {
        return;
      }
      breakTextDeltaContinuation();
      logEvent('[text-complete]');
    },
    onToolStream: (event) => {
      if (!isCurrentRequest()) {
        return;
      }
      breakTextDeltaContinuation();
      const source = readEventSource(event);
      const toolSegmentKey = buildToolSegmentKey(source, event.toolCallId) ?? event.toolCallId;
      const mapped = formatToolStreamEvent(event);
      if (mapped.codeChunk && mapped.segmentKey) {
        const turnId = getTurnId();
        const [rawToolCallId, channel] = mapped.segmentKey.split(':');
        const streamSegmentKey =
          rawToolCallId && channel ? `${toolSegmentKey}:${channel}` : mapped.segmentKey;
        appendSegment(
          turnId,
          `${turnId}:tool:${streamSegmentKey}`,
          'code',
          mapped.codeChunk,
          toToolStreamSegmentData(event, source)
        );
      }
      if ((event.type === 'stdout' || event.type === 'stderr') && toolSegmentKey) {
        streamedToolCallIds.add(toolSegmentKey);
      }
      if (mapped.note) {
        logEvent(mapped.note);
      }
    },
    onToolConfirm: (event) => {
      if (!isCurrentRequest()) {
        return;
      }
      logEvent(formatToolConfirmEvent(event));
    },
    onToolUse: (event) => {
      if (!isCurrentRequest()) {
        return;
      }
      breakTextDeltaContinuation();
      const source = readEventSource(event);
      const toolCallId = readToolCallIdFromUse(event);
      const toolSegmentKey =
        buildToolSegmentKey(source, toolCallId) ??
        `${source.sourceKey ?? 'primary'}|anonymous_${++anonymousToolUseCounter}`;
      if (renderedToolUseIds.has(toolSegmentKey)) {
        return;
      }
      renderedToolUseIds.add(toolSegmentKey);
      const turnId = getTurnId();
      appendSegment(
        turnId,
        `${turnId}:tool-use:${toolSegmentKey}`,
        'code',
        `${formatToolUseEventCode(event)}\n`,
        source.isSubagent ? withReplySourceMeta(event, source) : event
      );
      logEvent(formatToolUseEvent(event));
    },
    onToolResult: (event) => {
      if (!isCurrentRequest()) {
        return;
      }
      breakTextDeltaContinuation();
      if (shouldSuppressToolResultInChat(event)) {
        return;
      }
      registerSpawnedSubagentSource(event);
      const source = readEventSource(event);
      const toolCallId = readToolCallIdFromResult(event);
      const toolSegmentKey =
        buildToolSegmentKey(source, toolCallId) ??
        `${source.sourceKey ?? 'primary'}|anonymous_${++anonymousToolResultCounter}`;
      const suppressOutput = streamedToolCallIds.has(toolSegmentKey);
      const turnId = getTurnId();
      appendSegment(
        turnId,
        `${turnId}:tool-result:${toolSegmentKey}`,
        'code',
        `${formatToolResultEventCode(event, { suppressOutput })}\n`,
        source.isSubagent ? withReplySourceMeta(event, source) : event
      );
      logEvent(formatToolResultEvent(event));
    },
    onStep: (event) => {
      if (!isCurrentRequest()) {
        return;
      }
      logEvent(formatStepEvent(event));
    },
    onLoop: (event) => {
      if (!isCurrentRequest()) {
        return;
      }
      logEvent(formatLoopEvent(event));
    },
    onStop: (event) => {
      if (!isCurrentRequest()) {
        return;
      }
      breakTextDeltaContinuation();
      logEvent(formatStopEvent(event));
    },
  };
};
