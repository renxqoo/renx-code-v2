import type { AgentContextUsage, Message } from '../types';
import type { Tool } from '../../providers';
import type { LLMTool } from '../tool/types';

import { estimateMessagesTokens } from './compaction';

export type CompactionPolicyReason = 'disabled' | 'below_threshold' | 'threshold_reached';

export type CompactionPolicyDecision = Pick<
  AgentContextUsage,
  'contextTokens' | 'contextLimitTokens' | 'contextUsagePercent'
> & {
  shouldCompact: boolean;
  thresholdTokens: number;
  reason: CompactionPolicyReason;
};

export function calculateContextUsage(
  messages: Message[],
  tools: Tool[] | undefined,
  contextLimitTokens: number
): Pick<AgentContextUsage, 'contextTokens' | 'contextLimitTokens' | 'contextUsagePercent'> {
  const llmTools = tools as unknown as LLMTool[] | undefined;
  const contextTokens = estimateMessagesTokens(messages, llmTools);

  return {
    contextTokens,
    contextLimitTokens,
    contextUsagePercent: (contextTokens / contextLimitTokens) * 100,
  };
}

export function evaluateCompactionPolicy(input: {
  enabled: boolean;
  triggerRatio: number;
  messages: Message[];
  tools?: Tool[];
  contextLimitTokens: number;
}): CompactionPolicyDecision {
  const { enabled, triggerRatio, messages, tools, contextLimitTokens } = input;
  const usage = calculateContextUsage(messages, tools, contextLimitTokens);
  const thresholdTokens = contextLimitTokens * triggerRatio;

  if (!enabled) {
    return {
      ...usage,
      shouldCompact: false,
      thresholdTokens,
      reason: 'disabled',
    };
  }

  if (usage.contextTokens >= thresholdTokens) {
    return {
      ...usage,
      shouldCompact: true,
      thresholdTokens,
      reason: 'threshold_reached',
    };
  }

  return {
    ...usage,
    shouldCompact: false,
    thresholdTokens,
    reason: 'below_threshold',
  };
}
