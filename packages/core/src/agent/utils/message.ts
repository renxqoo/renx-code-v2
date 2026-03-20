/**
 * Message utility helpers for renx.
 */

import type { InputContentPart, MessageContent } from '../../providers';
import type { Message } from '../types';
import { generateId } from '../agent/shared';

type ToolCallLike = { id?: string };
type PendingToolCall = {
  toolCallId: string;
  assistantMessageId: string;
  timestamp: number;
};

export type ToolProtocolRepairStats = {
  syntheticToolResultCount: number;
  droppedOrphanToolResultCount: number;
};

const MISSING_TOOL_RESULT_CONTENT =
  'Command failed: tool result missing because the previous run was interrupted before the result was recorded. Treat this tool call as failed or unknown; do not assume side effects completed.';

export function contentToText(content: MessageContent | undefined): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((part) => stringifyContentPart(part))
    .filter(Boolean)
    .join('\n');
}

function stringifyContentPart(part: InputContentPart): string {
  switch (part.type) {
    case 'text':
      return part.text || '';
    case 'image_url':
      return `[image] ${part.image_url?.url || ''}`.trim();
    case 'file':
      return `[file] ${part.file?.filename || part.file?.file_id || ''}`.trim();
    case 'input_audio':
      return '[audio]';
    case 'input_video':
      return `[video] ${part.input_video?.url || part.input_video?.file_id || ''}`.trim();
    default:
      return '';
  }
}

function getAssistantToolCalls(message: Message): ToolCallLike[] {
  if (message.role !== 'assistant') return [];
  const rawToolCalls = message.tool_calls;
  if (!Array.isArray(rawToolCalls)) return [];
  return rawToolCalls.map((call) => ({ id: call.id }));
}

function getToolCallId(message: Message): string | undefined {
  if (message.role !== 'tool') return undefined;
  const toolCallId = message.tool_call_id;
  return typeof toolCallId === 'string' ? toolCallId : undefined;
}

export function processToolCallPairs(
  pending: Message[],
  active: Message[]
): { pending: Message[]; active: Message[] } {
  const toolCallToAssistant = new Map<string, Message>();

  for (const msg of [...pending, ...active]) {
    for (const call of getAssistantToolCalls(msg)) {
      if (call.id) {
        toolCallToAssistant.set(call.id, msg);
      }
    }
  }

  const toolsNeedingPair = active.filter((msg) => {
    if (msg.role !== 'tool') return false;
    const toolCallId = getToolCallId(msg);
    return typeof toolCallId === 'string' && toolCallToAssistant.has(toolCallId);
  });

  if (toolsNeedingPair.length === 0) {
    return { pending, active };
  }

  const assistantsToMove = new Set<Message>();
  const toolCallIdsToMove = new Set<string>();

  for (const toolMsg of toolsNeedingPair) {
    const toolCallId = getToolCallId(toolMsg);
    if (!toolCallId) continue;
    const assistantMsg = toolCallToAssistant.get(toolCallId);
    if (assistantMsg) {
      assistantsToMove.add(assistantMsg);
      toolCallIdsToMove.add(toolCallId);
    }
  }

  const newPending = pending.filter((msg) => {
    if (assistantsToMove.has(msg)) return false;
    if (msg.role === 'tool') {
      const toolCallId = getToolCallId(msg);
      if (toolCallId && toolCallIdsToMove.has(toolCallId)) return false;
    }
    return true;
  });

  const newActive: Message[] = [];
  const addedMessages = new Set<Message>();

  for (const assistantMsg of assistantsToMove) {
    newActive.push(assistantMsg);
    addedMessages.add(assistantMsg);

    for (const call of getAssistantToolCalls(assistantMsg)) {
      if (call.id) {
        const toolMsg = active.find((m) => m.role === 'tool' && getToolCallId(m) === call.id);
        if (toolMsg && !addedMessages.has(toolMsg)) {
          newActive.push(toolMsg);
          addedMessages.add(toolMsg);
        }
      }
    }
  }

  for (const msg of active) {
    if (!addedMessages.has(msg)) {
      newActive.push(msg);
    }
  }

  return { pending: newPending, active: newActive };
}

export function repairToolProtocolMessages(
  messages: Message[],
  options: {
    createMessageId?: () => string;
  } = {}
): { messages: Message[]; stats: ToolProtocolRepairStats } {
  if (messages.length === 0) {
    return {
      messages,
      stats: {
        syntheticToolResultCount: 0,
        droppedOrphanToolResultCount: 0,
      },
    };
  }

  const createMessageId = options.createMessageId ?? (() => generateId('msg_'));
  const repaired: Message[] = [];
  const pendingToolCalls = new Map<string, PendingToolCall>();
  let syntheticToolResultCount = 0;
  let droppedOrphanToolResultCount = 0;

  const flushPendingToolCalls = (referenceTimestamp?: number) => {
    for (const pending of pendingToolCalls.values()) {
      repaired.push({
        messageId: createMessageId(),
        type: 'tool-result',
        role: 'tool',
        content: MISSING_TOOL_RESULT_CONTENT,
        tool_call_id: pending.toolCallId,
        timestamp: referenceTimestamp ?? pending.timestamp,
        metadata: {
          syntheticToolResult: true,
          syntheticToolResultReason: 'missing_tool_result',
          syntheticToolResultSourceAssistantMessageId: pending.assistantMessageId,
        },
      });
      syntheticToolResultCount += 1;
    }
    pendingToolCalls.clear();
  };

  for (const message of messages) {
    if (message.role !== 'tool' && pendingToolCalls.size > 0) {
      flushPendingToolCalls(message.timestamp);
    }

    if (message.role === 'assistant') {
      repaired.push(message);
      for (const call of getAssistantToolCalls(message)) {
        if (!call.id) {
          continue;
        }
        pendingToolCalls.set(call.id, {
          toolCallId: call.id,
          assistantMessageId: message.messageId,
          timestamp: message.timestamp,
        });
      }
      continue;
    }

    if (message.role === 'tool') {
      const toolCallId = getToolCallId(message);
      if (!toolCallId || !pendingToolCalls.has(toolCallId)) {
        droppedOrphanToolResultCount += 1;
        continue;
      }

      repaired.push(message);
      pendingToolCalls.delete(toolCallId);
      continue;
    }

    repaired.push(message);
  }

  if (pendingToolCalls.size > 0) {
    flushPendingToolCalls();
  }

  return {
    messages: repaired,
    stats: {
      syntheticToolResultCount,
      droppedOrphanToolResultCount,
    },
  };
}
