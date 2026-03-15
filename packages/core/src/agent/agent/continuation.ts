import { createHash } from 'node:crypto';

import type { AgentInput, Message } from '../types';
import type { LLMRequestMessage } from '../../providers';
import { processToolCallPairs } from '../utils/message';

import { convertMessageToLLMMessage, shouldSendMessageToLLM } from './message-utils';

type ContinuationMetadata = {
  responseId?: string;
  llmRequestConfigHash?: string;
  llmRequestInputHash?: string;
  llmRequestInputMessageCount?: number;
  llmResponseMessageHash?: string;
};

export type LLMRequestPlan = {
  requestMessages: LLMRequestMessage[];
  requestConfig: AgentInput['config'];
  requestConfigHash: string;
  requestInputHash: string;
  requestInputMessageCount: number;
  continuationMode: 'full' | 'incremental';
  previousResponseIdUsed?: string;
  continuationBaselineMessageCount?: number;
  continuationDeltaMessageCount: number;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeValueForHash(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValueForHash(item));
  }
  if (typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        const normalized = normalizeValueForHash((value as Record<string, unknown>)[key]);
        if (normalized !== undefined) {
          acc[key] = normalized;
        }
        return acc;
      }, {});
  }
  return String(value);
}

function hashValueForContinuation(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(normalizeValueForHash(value)))
    .digest('hex');
}

function normalizeContinuationConfig(config: AgentInput['config']): Record<string, unknown> {
  if (!config) {
    return {};
  }

  const { abortSignal, previous_response_id, ...rest } = config as AgentInput['config'] & {
    abortSignal?: AbortSignal;
    previous_response_id?: string;
  };
  void abortSignal;
  void previous_response_id;

  return normalizeValueForHash(rest) as Record<string, unknown>;
}

function readContinuationMetadata(message: Message): ContinuationMetadata | undefined {
  if (!isPlainRecord(message.metadata)) {
    return undefined;
  }

  const metadata = message.metadata as Record<string, unknown>;
  const responseId =
    typeof metadata.responseId === 'string' && metadata.responseId.trim().length > 0
      ? metadata.responseId
      : undefined;
  const llmRequestConfigHash =
    typeof metadata.llmRequestConfigHash === 'string' ? metadata.llmRequestConfigHash : undefined;
  const llmRequestInputHash =
    typeof metadata.llmRequestInputHash === 'string' ? metadata.llmRequestInputHash : undefined;
  const llmRequestInputMessageCount =
    typeof metadata.llmRequestInputMessageCount === 'number'
      ? metadata.llmRequestInputMessageCount
      : undefined;
  const llmResponseMessageHash =
    typeof metadata.llmResponseMessageHash === 'string'
      ? metadata.llmResponseMessageHash
      : undefined;

  if (
    !responseId ||
    !llmRequestConfigHash ||
    !llmRequestInputHash ||
    typeof llmRequestInputMessageCount !== 'number' ||
    !Number.isInteger(llmRequestInputMessageCount) ||
    llmRequestInputMessageCount < 0 ||
    !llmResponseMessageHash
  ) {
    return undefined;
  }

  return {
    responseId,
    llmRequestConfigHash,
    llmRequestInputHash,
    llmRequestInputMessageCount,
    llmResponseMessageHash,
  };
}

export function buildLLMRequestPlan(
  messages: Message[],
  config: AgentInput['config'],
  enableServerSideContinuation: boolean
): LLMRequestPlan {
  const llmSourceMessages = messages.filter((msg) => shouldSendMessageToLLM(msg));
  const llmMessages = llmSourceMessages.map((msg) => convertMessageToLLMMessage(msg));
  const requestConfigHash = hashValueForContinuation(normalizeContinuationConfig(config));
  const requestInputHash = hashValueForContinuation(llmMessages);
  const requestInputMessageCount = llmMessages.length;

  const explicitPreviousResponseId =
    typeof config?.previous_response_id === 'string' &&
    config.previous_response_id.trim().length > 0
      ? config.previous_response_id
      : undefined;

  if (explicitPreviousResponseId || !enableServerSideContinuation) {
    return {
      requestMessages: llmMessages,
      requestConfig: config,
      requestConfigHash,
      requestInputHash,
      requestInputMessageCount,
      continuationMode: 'full',
      continuationDeltaMessageCount: llmMessages.length,
    };
  }

  for (let index = llmSourceMessages.length - 1; index >= 0; index -= 1) {
    const candidate = llmSourceMessages[index];
    if (candidate.role !== 'assistant') {
      continue;
    }

    const metadata = readContinuationMetadata(candidate);
    if (!metadata) {
      continue;
    }

    if (metadata.llmRequestConfigHash !== requestConfigHash) {
      break;
    }

    const prefixMessages = llmMessages.slice(0, index);
    const currentAssistantMessage = llmMessages[index];
    if (!currentAssistantMessage) {
      break;
    }

    if (prefixMessages.length !== metadata.llmRequestInputMessageCount) {
      break;
    }

    if (hashValueForContinuation(prefixMessages) !== metadata.llmRequestInputHash) {
      break;
    }

    if (hashValueForContinuation(currentAssistantMessage) !== metadata.llmResponseMessageHash) {
      break;
    }

    const continuationWindow = processToolCallPairs(
      llmSourceMessages.slice(0, index + 1),
      llmSourceMessages.slice(index + 1)
    );
    const deltaSourceMessages = continuationWindow.active;
    if (deltaSourceMessages.length === 0) {
      break;
    }

    return {
      requestMessages: deltaSourceMessages.map((msg) => convertMessageToLLMMessage(msg)),
      requestConfig: {
        ...(config || {}),
        previous_response_id: metadata.responseId,
      },
      requestConfigHash,
      requestInputHash,
      requestInputMessageCount,
      continuationMode: 'incremental',
      previousResponseIdUsed: metadata.responseId,
      continuationBaselineMessageCount: continuationWindow.pending.length,
      continuationDeltaMessageCount: deltaSourceMessages.length,
    };
  }

  return {
    requestMessages: llmMessages,
    requestConfig: config,
    requestConfigHash,
    requestInputHash,
    requestInputMessageCount,
    continuationMode: 'full',
    continuationDeltaMessageCount: llmMessages.length,
  };
}

export function applyContinuationMetadata(
  assistantMessage: Message,
  requestPlan: LLMRequestPlan
): void {
  assistantMessage.metadata = {
    ...assistantMessage.metadata,
    llmRequestConfigHash: requestPlan.requestConfigHash,
    llmRequestInputHash: requestPlan.requestInputHash,
    llmRequestInputMessageCount: requestPlan.requestInputMessageCount,
    continuationMode: requestPlan.continuationMode,
    continuationDeltaMessageCount: requestPlan.continuationDeltaMessageCount,
    ...(requestPlan.previousResponseIdUsed
      ? {
          previousResponseIdUsed: requestPlan.previousResponseIdUsed,
          continuationBaselineMessageCount: requestPlan.continuationBaselineMessageCount,
        }
      : {}),
  };
  assistantMessage.metadata = {
    ...assistantMessage.metadata,
    llmResponseMessageHash: hashValueForContinuation(convertMessageToLLMMessage(assistantMessage)),
  };
}
