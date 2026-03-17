/**
 * Conversation compaction entrypoint.
 *
 * This file is intentionally kept as the public facade for compaction:
 * callers import one stable module, while the actual responsibilities are
 * pushed into smaller helpers for selection, prompting, and summary parsing.
 */

import { getEncoding } from 'js-tiktoken';
import type { LLMGenerateOptions, LLMProvider, LLMResponse } from '../../providers';
import type { LLMRequestMessage } from '../../providers';
import type { Tool } from '../../providers';
import type { Message } from '../types';
import { contentToText } from '../utils/message';
import type { AgentLogger } from './logger';
import { resolveCompactionSystemPrompt, type CompactionPromptVersion } from './compaction-prompt';
import { selectCompactionWindow } from './compaction-selection';
import {
  buildCompactionRequestMessages,
  createSummaryMessage,
  extractSummaryContent,
} from './compaction-summary';

export interface CompactOptions {
  provider: LLMProvider;
  keepMessagesNum: number;
  promptVersion?: CompactionPromptVersion;
  logger?: AgentLogger;
}

export type CompactSuccessReason = 'no_pending_messages' | 'summary_created';
export type CompactionFailureReason =
  | 'request_oversized'
  | 'invalid_response'
  | 'empty_summary'
  | 'provider_error';

export interface CompactionDiagnostics {
  promptVersion: CompactionPromptVersion;
  pendingMessageCount: number;
  activeMessageCount: number;
  previousSummaryPresent: boolean;
  trimmedPendingMessageCount: number;
  estimatedInputTokens: number | null;
  inputTokenBudget: number | null;
  summaryMaxTokens: number;
}

export interface CompactResult {
  messages: Message[];
  removedMessageIds: string[];
  diagnostics: CompactionDiagnostics & {
    outcome: 'skipped' | 'applied';
    reason: CompactSuccessReason;
  };
}

export class CompactionError extends Error {
  readonly reason: CompactionFailureReason;
  readonly diagnostics: CompactionDiagnostics;

  constructor(
    message: string,
    reason: CompactionFailureReason,
    diagnostics: CompactionDiagnostics,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'CompactionError';
    this.reason = reason;
    this.diagnostics = diagnostics;
  }
}

const encoder = getEncoding('cl100k_base');
const SUMMARY_MAX_TOKENS = 4096;
const MESSAGE_OVERHEAD_TOKENS = 3;
const ASSISTANT_PRIMING_TOKENS = 3;
const LOW_DETAIL_IMAGE_TOKENS = 85;
const HIGH_DETAIL_IMAGE_TOKENS = 765;
const MIN_INPUT_BUDGET_TOKENS = 1;

type TokenCountableMessage = Pick<
  LLMRequestMessage,
  'role' | 'content' | 'tool_calls' | 'tool_call_id'
> & {
  name?: string;
};

/**
 * Estimate token usage with the same tokenizer family used by GPT-4 style
 * models. We keep a conservative heuristic fallback so context estimation
 * still works even if tokenizer initialization or encoding fails.
 */
export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }

  try {
    return encoder.encode(text).length;
  } catch (error) {
    console.warn('[TokenEstimation] Failed to encode text, using heuristic fallback', error);

    let chineseCount = 0;
    for (const char of text) {
      if (char >= '\u4e00' && char <= '\u9fa5') {
        chineseCount += 1;
      }
    }

    const otherCount = text.length - chineseCount;
    return Math.ceil(chineseCount * 2 + otherCount * 0.4);
  }
}

/**
 * Estimate chat payload cost using OpenAI-style message accounting.
 *
 * This is used only for compaction/context decisions, so the implementation
 * stays explicit and slightly conservative instead of chasing every provider's
 * private accounting rule.
 */
export function estimateMessagesTokens(messages: Message[], tools?: Tool[]): number {
  return estimateMessageCollectionTokens(messages, tools);
}

function estimateRequestMessagesTokens(messages: LLMRequestMessage[]): number {
  return estimateMessageCollectionTokens(messages);
}

function estimateMessageCollectionTokens(
  messages: TokenCountableMessage[],
  tools?: Tool[]
): number {
  let total = ASSISTANT_PRIMING_TOKENS;

  for (const message of messages) {
    total += MESSAGE_OVERHEAD_TOKENS;
    total += estimateTokens(message.role);

    const name = (message as Message & { name?: string }).name;
    if (name) {
      total += estimateTokens(name) + 1;
    }

    total += estimateMessageContentTokens(message);
    total += estimateToolCallTokens(message);
  }

  if (tools && tools.length > 0) {
    total += estimateTokens(JSON.stringify(tools));
  }

  return total;
}

export async function compact(
  messages: Message[],
  options: CompactOptions
): Promise<CompactResult> {
  const { provider, keepMessagesNum, logger, promptVersion = 'v1' } = options;
  const selection = selectCompactionWindow(messages, keepMessagesNum);
  const baseDiagnostics: CompactionDiagnostics = {
    promptVersion,
    pendingMessageCount: selection.pendingMessages.length,
    activeMessageCount: selection.activeMessages.length,
    previousSummaryPresent: selection.previousSummary.length > 0,
    trimmedPendingMessageCount: 0,
    estimatedInputTokens: null,
    inputTokenBudget: null,
    summaryMaxTokens: resolveSummaryMaxTokens(provider),
  };

  if (selection.pendingMessages.length === 0) {
    logger?.info?.('[Compaction] Skipped. no pending messages to summarize');
    return {
      messages,
      removedMessageIds: [],
      diagnostics: {
        ...baseDiagnostics,
        outcome: 'skipped',
        reason: 'no_pending_messages',
      },
    };
  }

  const summaryResult = await generateSummary({
    provider,
    pendingMessages: selection.pendingMessages,
    previousSummary: selection.previousSummary,
    promptVersion,
    activeMessageCount: selection.activeMessages.length,
    systemPrompt: resolveCompactionSystemPrompt(promptVersion),
    logger,
  });
  const summaryContent = summaryResult.summaryContent;
  const summaryMessage = createSummaryMessage(summaryContent);
  const compactedMessages = [
    ...(selection.systemMessage ? [selection.systemMessage] : []),
    summaryMessage,
    ...selection.activeMessages,
  ];
  const removedMessageIds = collectRemovedMessageIds(
    messages,
    new Set(selection.activeMessages),
    selection.systemMessage
  );

  logger?.info?.(
    `[Compaction] Completed. pending=${selection.pendingMessages.length} messages=${messages.length}->${compactedMessages.length}`
  );

  return {
    messages: compactedMessages,
    removedMessageIds,
    diagnostics: {
      ...summaryResult.diagnostics,
      outcome: 'applied',
      reason: 'summary_created',
    },
  };
}

function estimateMessageContentTokens(message: TokenCountableMessage): number {
  if (typeof message.content === 'string') {
    return estimateTokens(message.content);
  }

  if (!Array.isArray(message.content)) {
    return 0;
  }

  let total = 0;

  for (const part of message.content) {
    if (part.type === 'text' && part.text) {
      total += estimateTokens(part.text);
      continue;
    }

    if (part.type === 'image_url') {
      total += part.image_url.detail === 'low' ? LOW_DETAIL_IMAGE_TOKENS : HIGH_DETAIL_IMAGE_TOKENS;
    }
  }

  return total;
}

function estimateToolCallTokens(message: TokenCountableMessage): number {
  let total = 0;

  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    total += estimateTokens(JSON.stringify(message.tool_calls));
  }

  if (typeof message.tool_call_id === 'string' && message.tool_call_id.length > 0) {
    total += estimateTokens(message.tool_call_id);
  }

  return total;
}

function collectRemovedMessageIds(
  allMessages: Message[],
  keptActiveMessages: Set<Message>,
  systemMessage?: Message
): string[] {
  return allMessages.flatMap((message) => {
    if (message === systemMessage || keptActiveMessages.has(message) || !message.messageId) {
      return [];
    }

    return [message.messageId];
  });
}

async function generateSummary(input: {
  provider: LLMProvider;
  pendingMessages: Message[];
  previousSummary: string;
  promptVersion: CompactionPromptVersion;
  activeMessageCount: number;
  systemPrompt: string;
  logger?: AgentLogger;
}): Promise<{
  summaryContent: string;
  diagnostics: CompactionDiagnostics;
}> {
  const {
    provider,
    pendingMessages,
    previousSummary,
    promptVersion,
    activeMessageCount,
    systemPrompt,
    logger,
  } = input;
  const summaryMaxTokens = resolveSummaryMaxTokens(provider);
  const inputTokenBudget = resolveCompactionInputTokenBudget(provider, summaryMaxTokens);
  const preparedRequest = prepareCompactionRequest({
    pendingMessages,
    previousSummary,
    promptVersion,
    systemPrompt,
    inputTokenBudget,
  });
  const requestMessages = preparedRequest.requestMessages;
  const diagnostics: CompactionDiagnostics = {
    promptVersion,
    pendingMessageCount: pendingMessages.length,
    activeMessageCount,
    previousSummaryPresent: previousSummary.length > 0,
    trimmedPendingMessageCount: preparedRequest.trimmedPendingCount,
    estimatedInputTokens: preparedRequest.estimatedInputTokens,
    inputTokenBudget,
    summaryMaxTokens,
  };
  if (preparedRequest.trimmedPendingCount > 0) {
    logger?.warn?.('[Compaction] Trimmed oldest pending messages before summary generation', {
      ...diagnostics,
      pendingAfterTrim: preparedRequest.pendingMessages.length,
    });
  }
  if (inputTokenBudget !== null && preparedRequest.estimatedInputTokens > inputTokenBudget) {
    logger?.warn?.('[Compaction] Request exceeds estimated input budget after trimming', {
      ...diagnostics,
      pendingAfterTrim: preparedRequest.pendingMessages.length,
    });
    throw new CompactionError(
      'Compaction request exceeds estimated input budget after trimming',
      'request_oversized',
      diagnostics
    );
  }
  const requestOptions: Pick<LLMGenerateOptions, 'max_tokens' | 'model' | 'abortSignal'> = {
    max_tokens: summaryMaxTokens,
  };

  const configuredModel = provider.config?.model;
  if (typeof configuredModel === 'string') {
    const normalizedModel = configuredModel.trim();
    if (normalizedModel.length > 0) {
      requestOptions.model = normalizedModel;
    }
  }

  const timeoutMs = provider.getTimeTimeout();
  if (timeoutMs && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    try {
      requestOptions.abortSignal = AbortSignal.timeout(timeoutMs);
    } catch {
      // AbortSignal.timeout is not available in every runtime.
    }
  }

  try {
    const response = await provider.generate(requestMessages, requestOptions);
    if (!response || typeof response !== 'object' || !('choices' in response)) {
      logger?.warn?.('[Compaction] Summary generation returned invalid response');
      throw new CompactionError(
        'Compaction summary generation returned invalid response',
        'invalid_response',
        diagnostics
      );
    }

    const firstChoice = (response as LLMResponse).choices?.[0];
    const rawContent = contentToText(firstChoice?.message?.content || '');
    const normalizedSummary = extractSummaryContent(rawContent, promptVersion);

    if (!normalizedSummary) {
      logger?.warn?.('[Compaction] Summary generation returned empty summary content');
      throw new CompactionError(
        'Compaction summary generation returned empty summary content',
        'empty_summary',
        diagnostics
      );
    }

    return {
      summaryContent: normalizedSummary,
      diagnostics,
    };
  } catch (error) {
    logger?.warn?.('[Compaction] Summary generation failed:', { error: String(error) });
    if (error instanceof CompactionError) {
      throw error;
    }
    throw new CompactionError(
      'Compaction summary generation failed',
      'provider_error',
      diagnostics,
      {
        cause: error instanceof Error ? error : undefined,
      }
    );
  }
}

function resolveSummaryMaxTokens(provider: LLMProvider): number {
  const providerMaxOutputTokens = provider.getMaxOutputTokens();
  if (!Number.isFinite(providerMaxOutputTokens) || providerMaxOutputTokens <= 0) {
    return SUMMARY_MAX_TOKENS;
  }

  return Math.min(SUMMARY_MAX_TOKENS, providerMaxOutputTokens);
}

function resolveCompactionInputTokenBudget(
  provider: LLMProvider,
  summaryMaxTokens: number
): number | null {
  const maxTokens = provider.getLLMMaxTokens();
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) {
    return null;
  }

  return Math.max(MIN_INPUT_BUDGET_TOKENS, maxTokens - summaryMaxTokens);
}

function prepareCompactionRequest(input: {
  pendingMessages: Message[];
  previousSummary: string;
  promptVersion: CompactionPromptVersion;
  systemPrompt: string;
  inputTokenBudget: number | null;
}): {
  requestMessages: LLMRequestMessage[];
  pendingMessages: Message[];
  trimmedPendingCount: number;
  estimatedInputTokens: number;
} {
  const { previousSummary, promptVersion, systemPrompt, inputTokenBudget } = input;
  let pendingMessages = input.pendingMessages;
  let requestMessages = buildCompactionRequestMessages({
    pendingMessages,
    previousSummary,
    promptVersion,
    systemPrompt,
  });
  let estimatedInputTokens = estimateRequestMessagesTokens(requestMessages);
  let trimmedPendingCount = 0;

  if (inputTokenBudget === null) {
    return {
      requestMessages,
      pendingMessages,
      trimmedPendingCount,
      estimatedInputTokens,
    };
  }

  // Drop oldest pending messages first so the most recent raw context remains
  // available to the summarizer. This mirrors the runtime preference for
  // preserving the newest conversation suffix when the request must shrink.
  while (estimatedInputTokens > inputTokenBudget && pendingMessages.length > 1) {
    pendingMessages = pendingMessages.slice(1);
    trimmedPendingCount += 1;
    requestMessages = buildCompactionRequestMessages({
      pendingMessages,
      previousSummary,
      promptVersion,
      systemPrompt,
    });
    estimatedInputTokens = estimateRequestMessagesTokens(requestMessages);
  }

  return {
    requestMessages,
    pendingMessages,
    trimmedPendingCount,
    estimatedInputTokens,
  };
}
