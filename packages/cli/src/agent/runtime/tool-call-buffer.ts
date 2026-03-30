import type { AgentToolUseEvent } from './types';
import { buildToolInstanceKey } from '../../utils/reply-source';

const readToolCallKey = (event: AgentToolUseEvent): string | undefined => {
  const maybeId = (event as { id?: unknown }).id;
  const toolCallId = typeof maybeId === 'string' && maybeId.length > 0 ? maybeId : undefined;
  const executionId =
    typeof (event as { executionId?: unknown }).executionId === 'string'
      ? ((event as { executionId?: string }).executionId ?? undefined)
      : undefined;
  const conversationId =
    typeof (event as { conversationId?: unknown }).conversationId === 'string'
      ? ((event as { conversationId?: string }).conversationId ?? undefined)
      : undefined;
  return buildToolInstanceKey({ executionId, conversationId }, toolCallId);
};

export class ToolCallBuffer {
  private readonly plannedOrder: string[] = [];
  private readonly plannedIds = new Set<string>();
  private readonly toolCallsById = new Map<string, AgentToolUseEvent>();
  private readonly emittedIds = new Set<string>();

  register(
    toolCall: AgentToolUseEvent,
    emit: (event: AgentToolUseEvent) => void,
    executing = false
  ) {
    const toolCallKey = readToolCallKey(toolCall);
    if (!toolCallKey) {
      emit(toolCall);
      return;
    }

    this.toolCallsById.set(toolCallKey, toolCall);
    if (!this.plannedIds.has(toolCallKey)) {
      this.plannedIds.add(toolCallKey);
      this.plannedOrder.push(toolCallKey);
    }

    if (executing) {
      this.emit(toolCallKey, emit);
    }
  }

  flush(emit: (event: AgentToolUseEvent) => void) {
    for (const toolCallKey of this.plannedOrder) {
      this.emit(toolCallKey, emit);
    }
  }

  ensureEmitted(toolCallKey: string | undefined, emit: (event: AgentToolUseEvent) => void) {
    if (!toolCallKey) {
      return;
    }
    this.emit(toolCallKey, emit);
  }

  private emit(toolCallKey: string, emit: (event: AgentToolUseEvent) => void) {
    if (this.emittedIds.has(toolCallKey)) {
      return;
    }
    const toolCall = this.toolCallsById.get(toolCallKey);
    if (!toolCall) {
      return;
    }
    this.emittedIds.add(toolCallKey);
    emit(toolCall);
  }
}
