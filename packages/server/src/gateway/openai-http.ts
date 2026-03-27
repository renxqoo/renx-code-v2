import type {
  AgentAppService,
  LLMRequestMessage,
  Message,
  PrincipalContext,
  RunForegroundUsage,
  SqliteAgentAppStore,
} from '@renx-code/core';

import { HttpError } from './errors';
import { extractAssistantResponseText, extractUsageSummary } from '../runtime/response-text';
import { resolveConversationId } from '../runtime/session-key';

export interface OpenAiChatCompletionsRequest {
  model?: string;
  messages?: LLMRequestMessage[];
  user?: string;
  stream?: boolean;
}

export async function executeOpenAiChatCompletion(input: {
  appService: AgentAppService;
  store: SqliteAgentAppStore;
  request: OpenAiChatCompletionsRequest;
  principal: PrincipalContext;
}) {
  const resolved = await resolveOpenAiChatRequest(input);
  const result = await input.appService.runForeground({
    conversationId: resolved.conversationId,
    userInput: resolved.userInput,
    principal: input.principal,
    historyMessages: resolved.historyMessages,
    config: input.request.model ? { model: input.request.model } : undefined,
    modelLabel: input.request.model,
  });
  const responseText = extractAssistantResponseText(result.messages);
  const usage = extractUsageSummary(result.messages);

  return {
    executionId: result.executionId,
    conversationId: resolved.conversationId,
    responseText,
    usage,
    model: resolved.model,
    finishReason: result.finishReason,
  };
}

export async function streamOpenAiChatCompletion(input: {
  appService: AgentAppService;
  store: SqliteAgentAppStore;
  request: OpenAiChatCompletionsRequest;
  principal: PrincipalContext;
  onChunk: (payload: ReturnType<typeof toOpenAiStreamChunk>) => void | Promise<void>;
}) {
  const resolved = await resolveOpenAiChatRequest(input);
  let latestUsage: RunForegroundUsage['cumulativeUsage'] = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };
  let streamedText = '';
  let emittedContentChunk = false;

  const result = await input.appService.runForeground(
    {
      conversationId: resolved.conversationId,
      userInput: resolved.userInput,
      principal: input.principal,
      historyMessages: resolved.historyMessages,
      config: input.request.model ? { model: input.request.model } : undefined,
      modelLabel: input.request.model,
    },
    {
      onEvent: async (event) => {
        if (event.eventType !== 'chunk') {
          return;
        }
        const content = extractChunkContent(event.data);
        if (!content) {
          return;
        }
        streamedText += content;
        emittedContentChunk = true;
        await input.onChunk(
          toOpenAiStreamChunk({
            executionId: event.executionId,
            model: resolved.model,
            content,
          })
        );
      },
      onUsage: async (usage) => {
        latestUsage = usage.cumulativeUsage;
      },
    }
  );

  const responseText = extractAssistantResponseText(result.messages);
  if (!emittedContentChunk && responseText) {
    await input.onChunk(
      toOpenAiStreamChunk({
        executionId: result.executionId,
        model: resolved.model,
        content: responseText,
      })
    );
    streamedText = responseText;
  }

  await input.onChunk(
    toOpenAiStreamChunk({
      executionId: result.executionId,
      model: resolved.model,
      finishReason: result.finishReason,
    })
  );

  return {
    executionId: result.executionId,
    conversationId: resolved.conversationId,
    responseText: streamedText || responseText,
    usage: latestUsage,
    model: resolved.model,
    finishReason: result.finishReason,
  };
}

export function toOpenAiCompletionResponse(input: {
  executionId: string;
  responseText: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  model: string;
  finishReason?: string;
}) {
  return {
    id: `chatcmpl_${input.executionId}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: input.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: input.responseText,
        },
        finish_reason: normalizeFinishReason(input.finishReason),
      },
    ],
    usage: input.usage,
  };
}

export function toOpenAiStreamChunk(input: {
  executionId: string;
  model: string;
  content?: string;
  finishReason?: string;
}) {
  return {
    id: `chatcmpl_${input.executionId}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: input.model,
    choices: [
      {
        index: 0,
        delta: input.content ? { role: 'assistant', content: input.content } : {},
        finish_reason: normalizeFinishReason(input.finishReason),
      },
    ],
  };
}

function normalizeFinishReason(finishReason: string | undefined): 'stop' | 'length' | null {
  if (finishReason === 'max_steps') {
    return 'length';
  }
  if (finishReason === 'stop') {
    return 'stop';
  }
  return finishReason ? 'stop' : null;
}

async function resolveOpenAiChatRequest(input: {
  store: SqliteAgentAppStore;
  request: OpenAiChatCompletionsRequest;
}) {
  const messages = input.request.messages || [];
  const activeUserIndex = findActiveUserMessageIndex(messages);
  const activeUserMessage = activeUserIndex >= 0 ? messages[activeUserIndex] : undefined;
  const userInput = contentToText(activeUserMessage?.content);
  if (!userInput.trim()) {
    throw new HttpError(400, 'INVALID_REQUEST', 'OpenAI messages must include a user message');
  }

  const conversationId = resolveConversationId({ user: input.request.user });
  const requestHistoryMessages = toHistoryMessages(messages.slice(0, activeUserIndex));
  const historyMessages =
    requestHistoryMessages.length > 0
      ? requestHistoryMessages
      : await input.store.listContext(conversationId);

  return {
    userInput,
    conversationId,
    historyMessages,
    model: input.request.model || 'renx',
  };
}

function findActiveUserMessageIndex(messages: LLMRequestMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      return index;
    }
  }
  return -1;
}

function toHistoryMessages(messages: LLMRequestMessage[]): Message[] {
  return messages
    .map((message, index) => toInternalMessage(message, index))
    .filter((message): message is Message => message !== undefined);
}

function toInternalMessage(message: LLMRequestMessage, index: number): Message | undefined {
  const type = toInternalMessageType(message.role);
  if (!type) {
    return undefined;
  }

  return {
    messageId: `openai_hist_${index}`,
    type,
    role: message.role,
    content: message.content,
    reasoning_content: message.reasoning_content,
    tool_call_id: message.tool_call_id,
    tool_calls: message.tool_calls,
    timestamp: Date.now(),
  };
}

function toInternalMessageType(role: LLMRequestMessage['role']): Message['type'] | undefined {
  switch (role) {
    case 'system':
      return 'system';
    case 'user':
      return 'user';
    case 'assistant':
      return 'assistant-text';
    case 'tool':
      return 'tool-result';
    default:
      return undefined;
  }
}

function extractChunkContent(data: unknown): string {
  if (!isRecord(data)) {
    return '';
  }
  return typeof data.content === 'string' ? data.content : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function contentToText(content: LLMRequestMessage['content'] | undefined): string {
  if (!content) {
    return '';
  }
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (part.type === 'text') {
        return part.text || '';
      }
      return '';
    })
    .join('\n');
}
