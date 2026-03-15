import type { AgentContextUsage, Message } from '../types';
import type { Tool, LLMProvider } from '../../providers';

import { compact, CompactionError } from './compaction';
import type { AgentLogger } from './logger';
import { logError as writeErrorLog, logInfo as writeInfoLog } from './telemetry';
import {
  calculateContextUsage,
  evaluateCompactionPolicy,
  type CompactionPolicyReason,
} from './compaction-policy';
import type { CompactionPromptVersion } from './compaction-prompt';
import type { CompactionExecutionResult } from './run-loop';

export interface StepCompactionDeps {
  provider: LLMProvider;
  logger: AgentLogger;
  resolveContextLimitTokens: (contextLimitTokens?: number) => number;
  config: {
    enableCompaction: boolean;
    compactionTriggerRatio: number;
    compactionKeepMessagesNum: number;
    compactionPromptVersion: CompactionPromptVersion;
  };
}

export interface StepMessagePreparationResult {
  messageCountBeforeCompaction: number;
  compaction: CompactionExecutionResult;
  contextUsage: Pick<
    AgentContextUsage,
    'contextTokens' | 'contextLimitTokens' | 'contextUsagePercent'
  >;
}

export async function prepareMessagesForLlmStep(
  messages: Message[],
  deps: StepCompactionDeps,
  input?: {
    tools?: Tool[];
    contextLimitTokens?: number;
  }
): Promise<StepMessagePreparationResult> {
  const tools = input?.tools;
  const resolvedContextLimitTokens = deps.resolveContextLimitTokens(input?.contextLimitTokens);
  const messageCountBeforeCompaction = messages.length;
  const decision = evaluateCompactionPolicy({
    enabled: deps.config.enableCompaction,
    triggerRatio: deps.config.compactionTriggerRatio,
    messages,
    tools,
    contextLimitTokens: resolvedContextLimitTokens,
  });
  const compaction = await maybeCompactMessages(
    messages,
    deps,
    messageCountBeforeCompaction,
    reasonedPolicyDecision(decision)
  );

  return {
    messageCountBeforeCompaction,
    compaction,
    contextUsage: calculateContextUsage(messages, tools, resolvedContextLimitTokens),
  };
}

function reasonedPolicyDecision(decision: ReturnType<typeof evaluateCompactionPolicy>) {
  return {
    shouldCompact: decision.shouldCompact,
    reason: decision.reason,
    contextTokens: decision.contextTokens,
    contextLimitTokens: decision.contextLimitTokens,
    contextUsagePercent: decision.contextUsagePercent,
    thresholdTokens: decision.thresholdTokens,
  };
}

async function maybeCompactMessages(
  messages: Message[],
  deps: StepCompactionDeps,
  messageCountBeforeCompaction: number,
  decision: {
    shouldCompact: boolean;
    reason: CompactionPolicyReason;
    contextTokens: number;
    contextLimitTokens: number;
    contextUsagePercent: number;
    thresholdTokens: number;
  }
): Promise<CompactionExecutionResult> {
  if (!decision.shouldCompact) {
    if (decision.reason !== 'disabled') {
      writeInfoLog(deps.logger, '[Agent] compaction.skipped', {
        reason: decision.reason,
        contextTokens: decision.contextTokens,
        contextLimitTokens: decision.contextLimitTokens,
        contextUsagePercent: decision.contextUsagePercent,
        thresholdTokens: decision.thresholdTokens,
      });
    }

    return {
      status: 'skipped',
      removedMessageIds: [],
      reason: decision.reason,
      diagnostics: {
        contextTokens: decision.contextTokens,
        contextLimitTokens: decision.contextLimitTokens,
        contextUsagePercent: decision.contextUsagePercent,
        thresholdTokens: decision.thresholdTokens,
      },
    };
  }

  try {
    const result = await compact(messages, {
      provider: deps.provider,
      keepMessagesNum: deps.config.compactionKeepMessagesNum,
      promptVersion: deps.config.compactionPromptVersion,
      logger: deps.logger,
    });
    messages.splice(0, messages.length, ...result.messages);
    writeInfoLog(deps.logger, '[Agent] compaction.applied', {
      reason: result.diagnostics.reason,
      promptVersion: result.diagnostics.promptVersion,
      removedMessageCount: result.removedMessageIds.length,
      trimmedPendingMessageCount: result.diagnostics.trimmedPendingMessageCount,
      pendingMessageCount: result.diagnostics.pendingMessageCount,
      activeMessageCount: result.diagnostics.activeMessageCount,
    });

    return {
      status:
        result.removedMessageIds.length > 0 ||
        result.messages.length !== messageCountBeforeCompaction
          ? 'applied'
          : 'skipped',
      removedMessageIds: result.removedMessageIds ?? [],
      reason: result.diagnostics.reason,
      diagnostics: result.diagnostics,
    };
  } catch (error) {
    if (error instanceof CompactionError) {
      writeErrorLog(deps.logger, '[Agent] compaction.failed', error, {
        reason: error.reason,
        promptVersion: error.diagnostics.promptVersion,
        trimmedPendingMessageCount: error.diagnostics.trimmedPendingMessageCount,
        pendingMessageCount: error.diagnostics.pendingMessageCount,
        activeMessageCount: error.diagnostics.activeMessageCount,
        estimatedInputTokens: error.diagnostics.estimatedInputTokens,
        inputTokenBudget: error.diagnostics.inputTokenBudget,
      });
      return {
        status: 'failed',
        removedMessageIds: [],
        reason: error.reason,
        diagnostics: error.diagnostics,
      };
    }

    writeErrorLog(deps.logger, '[Agent] compaction.failed', error);
    return {
      status: 'failed',
      removedMessageIds: [],
      reason: 'unknown',
    };
  }
}
