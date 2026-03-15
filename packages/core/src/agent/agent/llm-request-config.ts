import type { AgentInput } from '../types';

function withPromptCacheKey(
  config: AgentInput['config'],
  conversationId?: string
): AgentInput['config'] {
  if (
    typeof conversationId !== 'string' ||
    conversationId.trim().length === 0 ||
    config?.prompt_cache_key
  ) {
    return config;
  }

  return {
    ...(config || {}),
    prompt_cache_key: conversationId,
  };
}

export function mergeBaseLLMConfig(
  config: AgentInput['config'],
  tools?: AgentInput['tools'],
  abortSignal?: AbortSignal
): AgentInput['config'] {
  if (!config && !tools && !abortSignal) {
    return undefined;
  }

  const merged: NonNullable<AgentInput['config']> = {
    ...(config || {}),
  };

  if (tools && tools.length > 0) {
    merged.tools = tools;
  }

  if (abortSignal) {
    merged.abortSignal = abortSignal;
  }

  return merged;
}

export function mergeLLMRequestConfig(
  config: AgentInput['config'],
  tools?: AgentInput['tools'],
  abortSignal?: AbortSignal,
  conversationId?: string
): AgentInput['config'] {
  return withPromptCacheKey(mergeBaseLLMConfig(config, tools, abortSignal), conversationId);
}
