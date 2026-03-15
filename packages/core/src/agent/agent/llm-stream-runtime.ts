import type { LLMProvider, ToolCall } from '../../providers';
import type { AgentInput, Message, StreamEvent } from '../types';

import { AgentUpstreamRetryableError } from './error';
import { buildLLMRequestPlan, applyContinuationMetadata } from './continuation';
import { generateId, hasNonEmptyText } from './shared';
import { mergeToolCalls as mergeToolCallsWithBuffer } from './tool-call-merge';
import {
  buildWriteFileSessionKey,
  bufferWriteFileToolCallChunk,
  type WriteBufferRuntime,
} from './write-file-session';

export type LLMStreamResult = {
  assistantMessage: Message;
  toolCalls: ToolCall[];
};

export type LLMStreamRuntimeDeps = {
  llmProvider: LLMProvider;
  enableServerSideContinuation: boolean;
  throwIfAborted: (signal?: AbortSignal) => void;
  logError: (message: string, error: unknown, context?: Record<string, unknown>) => void;
};

type CallLLMAndProcessStreamArgs = {
  messages: Message[];
  config: AgentInput['config'];
  abortSignal?: AbortSignal;
  executionId?: string;
  stepIndex?: number;
  writeBufferSessions?: Map<string, WriteBufferRuntime>;
};

function createAssistantMessage(): Message {
  // Create one mutable assistant message shell and progressively fill it as
  // streaming chunks arrive. Downstream code receives one normal finalized
  // Message object instead of needing to understand stream internals.
  return {
    messageId: generateId('msg_'),
    type: 'assistant-text',
    role: 'assistant',
    content: '',
    reasoning_content: '',
    timestamp: Date.now(),
  };
}

async function mergeStreamingToolCalls(
  deps: LLMStreamRuntimeDeps,
  params: {
    existing: ToolCall[];
    incoming: ToolCall[];
    messageId: string;
    executionId?: string;
    stepIndex: number;
    writeBufferSessions: Map<string, WriteBufferRuntime>;
  }
): Promise<ToolCall[]> {
  const { existing, incoming, messageId, executionId, stepIndex, writeBufferSessions } = params;
  // Tool calls can arrive fragmented across many deltas. We merge them into a
  // stable logical list and opportunistically buffer write_file argument
  // chunks so large file writes can be resumed/finalized safely later.
  return mergeToolCallsWithBuffer({
    existing,
    incoming,
    messageId,
    onArgumentsChunk: async (toolCall, argumentsChunk, chunkMessageId) => {
      const sessionKey = buildWriteFileSessionKey({
        executionId,
        stepIndex,
        toolCallId: toolCall.id,
      });
      await bufferWriteFileToolCallChunk({
        toolCall,
        argumentsChunk,
        messageId: chunkMessageId,
        sessionKey,
        sessions: writeBufferSessions,
        onError: (error) => deps.logError('[Agent] Failed to buffer write_file tool chunk:', error),
      });
    },
  });
}

export async function* callLLMAndProcessStream(
  deps: LLMStreamRuntimeDeps,
  {
    messages,
    config,
    abortSignal,
    executionId,
    stepIndex = 0,
    writeBufferSessions = new Map<string, WriteBufferRuntime>(),
  }: CallLLMAndProcessStreamArgs
): AsyncGenerator<StreamEvent, LLMStreamResult, unknown> {
  // Continuation planning is decided before opening the provider stream so the
  // rest of this function only deals with one normalized request shape.
  const requestPlan = buildLLMRequestPlan(messages, config, deps.enableServerSideContinuation);
  const stream = deps.llmProvider.generateStream(
    requestPlan.requestMessages,
    requestPlan.requestConfig
  );

  const assistantMessage = createAssistantMessage();
  let toolCalls: ToolCall[] = [];
  let finished = false;

  for await (const chunk of stream) {
    // Abort checks happen between chunks so long-lived streams stop promptly
    // without waiting for the provider to end naturally.
    deps.throwIfAborted(abortSignal);
    const choices = chunk.choices;
    const delta = choices?.[0]?.delta;

    if (typeof chunk.id === 'string' && chunk.id.trim().length > 0) {
      assistantMessage.metadata = {
        ...assistantMessage.metadata,
        responseId: chunk.id,
      };
    }

    if (chunk.usage) {
      assistantMessage.usage = chunk.usage;
    }

    if (finished) {
      continue;
    }

    if (typeof delta?.content === 'string') {
      assistantMessage.content = `${assistantMessage.content}${delta.content}`;
      yield {
        type: 'chunk',
        data: {
          messageId: assistantMessage.messageId,
          content: delta.content,
          delta: true,
        },
      };
    }

    if (typeof delta?.reasoning_content === 'string') {
      assistantMessage.reasoning_content = `${assistantMessage.reasoning_content || ''}${delta.reasoning_content}`;
      yield {
        type: 'reasoning_chunk',
        data: {
          messageId: assistantMessage.messageId,
          reasoningContent: delta.reasoning_content,
          delta: true,
        },
      };
    }

    if (delta?.tool_calls) {
      toolCalls = await mergeStreamingToolCalls(deps, {
        existing: toolCalls,
        incoming: delta.tool_calls,
        messageId: assistantMessage.messageId,
        executionId,
        stepIndex,
        writeBufferSessions,
      });
      yield {
        type: 'tool_call',
        data: {
          messageId: assistantMessage.messageId,
          toolCalls,
        },
      };
    }

    const finishReason =
      choices?.[0]?.finish_reason ||
      (delta as { finish_reason?: string } | undefined)?.finish_reason;
    if (finishReason) {
      // Some providers keep sending bookkeeping chunks after a finish reason.
      // Once the assistant turn is logically complete we ignore trailing
      // deltas and finalize from the data already accumulated.
      finished = true;
    }
  }

  assistantMessage.tool_calls = toolCalls.length > 0 ? toolCalls : undefined;
  assistantMessage.type = toolCalls.length > 0 ? 'tool-call' : 'assistant-text';
  applyContinuationMetadata(assistantMessage, requestPlan);

  if (
    toolCalls.length === 0 &&
    !hasNonEmptyText(assistantMessage.content) &&
    !hasNonEmptyText(assistantMessage.reasoning_content)
  ) {
    // An empty assistant turn is treated as an upstream retryable failure
    // instead of a valid "done" response. Otherwise the run loop would stop
    // silently and hide provider-side partial/empty stream problems.
    throw new AgentUpstreamRetryableError('LLM returned an empty assistant response');
  }

  return {
    assistantMessage,
    toolCalls,
  };
}
