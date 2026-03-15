import { LLMError, LLMRetryableError } from '../../providers';
import {
  AgentAbortedError,
  AgentError,
  AgentUpstreamAuthError,
  AgentUpstreamBadRequestError,
  AgentUpstreamError,
  AgentUpstreamNetworkError,
  AgentUpstreamNotFoundError,
  AgentUpstreamRateLimitError,
  AgentUpstreamRetryableError,
  AgentUpstreamServerError,
  AgentUpstreamTimeoutError,
} from './error';

function normalizeProviderCode(code: string | undefined): string {
  if (typeof code !== 'string') {
    return '';
  }
  return code.trim().toUpperCase();
}

function isServerCode(code: string): boolean {
  return /^SERVER_\d{3}$/.test(code);
}

function inferRetryableKindFromMessage(
  message: string | undefined
): 'network' | 'timeout' | undefined {
  if (typeof message !== 'string') {
    return undefined;
  }
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (/\b(timeout|timed out|body timeout|request timeout|deadline exceeded)\b/.test(normalized)) {
    return 'timeout';
  }
  if (
    /\b(network|connection|socket|econnreset|econnrefused|enotfound|ehostunreach|etimedout|dns)\b/.test(
      normalized
    )
  ) {
    return 'network';
  }
  return undefined;
}

export function mapRetryableProviderError(error: LLMRetryableError): AgentError {
  const providerCode = normalizeProviderCode(error.code);
  if (providerCode === 'RATE_LIMIT') {
    return new AgentUpstreamRateLimitError(error.message);
  }
  if (providerCode === 'TIMEOUT' || providerCode === 'BODY_TIMEOUT') {
    return new AgentUpstreamTimeoutError(error.message);
  }
  if (providerCode === 'NETWORK_ERROR') {
    return new AgentUpstreamNetworkError(error.message);
  }
  if (isServerCode(providerCode)) {
    return new AgentUpstreamServerError(error.message);
  }

  const inferredKind = inferRetryableKindFromMessage(error.message);
  if (inferredKind === 'timeout') {
    return new AgentUpstreamTimeoutError(error.message);
  }
  if (inferredKind === 'network') {
    return new AgentUpstreamNetworkError(error.message);
  }

  return new AgentUpstreamRetryableError(error.message);
}

export function mapGeneralProviderError(error: LLMError, abortedMessage: string): AgentError {
  const providerCode = normalizeProviderCode(error.code);
  if (providerCode === 'ABORTED') {
    return new AgentAbortedError(error.message || abortedMessage);
  }
  if (providerCode === 'AUTH_FAILED') {
    return new AgentUpstreamAuthError(error.message);
  }
  if (providerCode === 'NOT_FOUND') {
    return new AgentUpstreamNotFoundError(error.message);
  }
  if (providerCode === 'BAD_REQUEST') {
    return new AgentUpstreamBadRequestError(error.message);
  }
  if (providerCode === 'RATE_LIMIT') {
    return new AgentUpstreamRateLimitError(error.message);
  }
  if (providerCode === 'TIMEOUT' || providerCode === 'BODY_TIMEOUT') {
    return new AgentUpstreamTimeoutError(error.message);
  }
  if (providerCode === 'NETWORK_ERROR') {
    return new AgentUpstreamNetworkError(error.message);
  }
  if (isServerCode(providerCode)) {
    return new AgentUpstreamServerError(error.message);
  }

  return new AgentUpstreamError(error.message || new AgentUpstreamError().message);
}

export function inferErrorKindFromMessage(
  message: string | undefined
): 'network' | 'timeout' | undefined {
  return inferRetryableKindFromMessage(message);
}
