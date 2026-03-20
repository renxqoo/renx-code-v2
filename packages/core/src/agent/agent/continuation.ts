import type { AgentInput, Message } from '../types';
import type { LLMRequestMessage } from '../../providers';
import { processToolCallPairs } from '../utils/message';

import { convertMessageToLLMMessage, shouldSendMessageToLLM } from './message-utils';
import { hashValueForContinuation, normalizeContinuationConfig } from './continuation-hash';
import { readContinuationMetadata } from './continuation-metadata';

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

type ContinuationRequestState = {
  llmSourceMessages: Message[];
  llmMessages: LLMRequestMessage[];
  requestConfigHash: string;
  requestInputHash: string;
  requestInputMessageCount: number;
};

type ContinuationCandidate = {
  metadata: NonNullable<ReturnType<typeof readContinuationMetadata>>;
  continuationWindow: ReturnType<typeof processToolCallPairs>;
};

function createContinuationRequestState(
  messages: Message[],
  config: AgentInput['config']
): ContinuationRequestState {
  const llmSourceMessages = messages.filter((msg) => shouldSendMessageToLLM(msg));
  const llmMessages = llmSourceMessages.map((msg) => convertMessageToLLMMessage(msg));

  return {
    llmSourceMessages,
    llmMessages,
    requestConfigHash: hashValueForContinuation(normalizeContinuationConfig(config)),
    requestInputHash: hashValueForContinuation(llmMessages),
    requestInputMessageCount: llmMessages.length,
  };
}

function buildFullRequestPlan(
  state: ContinuationRequestState,
  config: AgentInput['config']
): LLMRequestPlan {
  return {
    requestMessages: state.llmMessages,
    requestConfig: config,
    requestConfigHash: state.requestConfigHash,
    requestInputHash: state.requestInputHash,
    requestInputMessageCount: state.requestInputMessageCount,
    continuationMode: 'full',
    continuationDeltaMessageCount: state.llmMessages.length,
  };
}

function findReusableContinuationCandidate(
  state: ContinuationRequestState,
  explicitPreviousResponseId?: string
): ContinuationCandidate | undefined {
  for (let index = state.llmSourceMessages.length - 1; index >= 0; index -= 1) {
    const candidate = state.llmSourceMessages[index];
    if (candidate.role !== 'assistant') {
      continue;
    }

    const metadata = readContinuationMetadata(candidate);
    if (!metadata) {
      continue;
    }

    if (explicitPreviousResponseId && metadata.responseId !== explicitPreviousResponseId) {
      continue;
    }

    if (metadata.llmRequestConfigHash !== state.requestConfigHash) {
      continue;
    }

    const prefixMessages = state.llmMessages.slice(0, index);
    const currentAssistantMessage = state.llmMessages[index];
    if (!currentAssistantMessage) {
      continue;
    }

    if (prefixMessages.length !== metadata.llmRequestInputMessageCount) {
      continue;
    }

    if (hashValueForContinuation(prefixMessages) !== metadata.llmRequestInputHash) {
      continue;
    }

    if (hashValueForContinuation(currentAssistantMessage) !== metadata.llmResponseMessageHash) {
      continue;
    }

    const continuationWindow = processToolCallPairs(
      state.llmSourceMessages.slice(0, index + 1),
      state.llmSourceMessages.slice(index + 1)
    );
    if (continuationWindow.active.length === 0) {
      continue;
    }

    return {
      metadata,
      continuationWindow,
    };
  }

  return undefined;
}

export function buildLLMRequestPlan(
  messages: Message[],
  config: AgentInput['config'],
  enableServerSideContinuation: boolean
): LLMRequestPlan {
  const state = createContinuationRequestState(messages, config);

  const explicitPreviousResponseId =
    typeof config?.previous_response_id === 'string' &&
    config.previous_response_id.trim().length > 0
      ? config.previous_response_id
      : undefined;

  if (!enableServerSideContinuation) {
    return buildFullRequestPlan(state, config);
  }

  const reusableCandidate = findReusableContinuationCandidate(state, explicitPreviousResponseId);
  if (reusableCandidate) {
    const deltaSourceMessages = reusableCandidate.continuationWindow.active;
    return {
      requestMessages: deltaSourceMessages.map((msg) => convertMessageToLLMMessage(msg)),
      requestConfig: {
        ...(config || {}),
        previous_response_id: reusableCandidate.metadata.responseId,
      },
      requestConfigHash: state.requestConfigHash,
      requestInputHash: state.requestInputHash,
      requestInputMessageCount: state.requestInputMessageCount,
      continuationMode: 'incremental',
      previousResponseIdUsed: reusableCandidate.metadata.responseId,
      continuationBaselineMessageCount: reusableCandidate.continuationWindow.pending.length,
      continuationDeltaMessageCount: deltaSourceMessages.length,
    };
  }

  if (explicitPreviousResponseId) {
    return buildFullRequestPlan(state, config);
  }

  return buildFullRequestPlan(state, config);
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
