import {
  calculateBackoff,
  LLMAbortedError,
  LLMAuthError,
  LLMBadRequestError,
  LLMError,
  LLMNotFoundError,
  LLMPermanentError,
  LLMRateLimitError,
  LLMRetryableError,
} from '../../providers';
import type { BackoffConfig } from '../../providers';
import {
  AgentUpstreamAuthError,
  AgentUpstreamBadRequestError,
  AgentUpstreamNetworkError,
  AgentUpstreamNotFoundError,
  AgentUpstreamPermanentError,
  AgentUpstreamRateLimitError,
  AgentUpstreamTimeoutError,
  AgentAbortedError,
  AgentError,
  ConfirmationTimeoutError,
  UnknownError,
} from './error';
import {
  inferErrorKindFromMessage,
  mapGeneralProviderError,
  mapRetryableProviderError,
} from './error-normalizer-mapping';

export function isAbortError(error: unknown, abortedMessage: string): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const abortError = error as { name?: string; message?: string };
  return abortError.name === 'AbortError' || abortError.message === abortedMessage;
}

export function normalizeError(error: unknown, abortedMessage: string): AgentError {
  if (error instanceof AgentError) {
    return error;
  }

  if (isAbortError(error, abortedMessage)) {
    return new AgentAbortedError(abortedMessage);
  }

  if (error instanceof LLMAbortedError) {
    return new AgentAbortedError(error.message || abortedMessage);
  }

  if (error instanceof LLMRateLimitError) {
    return new AgentUpstreamRateLimitError(error.message);
  }

  if (error instanceof LLMAuthError) {
    return new AgentUpstreamAuthError(error.message);
  }

  if (error instanceof LLMNotFoundError) {
    return new AgentUpstreamNotFoundError(error.message);
  }

  if (error instanceof LLMBadRequestError) {
    return new AgentUpstreamBadRequestError(error.message);
  }

  if (error instanceof LLMRetryableError) {
    return mapRetryableProviderError(error);
  }

  if (error instanceof LLMPermanentError) {
    return new AgentUpstreamPermanentError(error.message);
  }

  if (error instanceof LLMError) {
    return mapGeneralProviderError(error, abortedMessage);
  }

  if (error instanceof Error) {
    if (error.name === 'ConfirmationTimeoutError' || error.message === 'Confirmation timeout') {
      return new ConfirmationTimeoutError(error.message);
    }
    const inferredKind = inferErrorKindFromMessage(error.message);
    if (inferredKind === 'timeout') {
      return new AgentUpstreamTimeoutError(error.message);
    }
    if (inferredKind === 'network') {
      return new AgentUpstreamNetworkError(error.message);
    }
    return new UnknownError(error.message || new UnknownError().message);
  }

  return new UnknownError();
}

export function calculateRetryDelay(
  retryCount: number,
  error: Error,
  backoffConfig: BackoffConfig
): number {
  const retryAfterMs = error instanceof LLMRetryableError ? error.retryAfter : undefined;
  return calculateBackoff(retryCount - 1, retryAfterMs, backoffConfig);
}
