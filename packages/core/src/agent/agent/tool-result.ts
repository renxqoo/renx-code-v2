import type { Message } from '../types';
import type { ToolCall } from '../../providers';
import type { ToolCallResult } from '../tool-v2/contracts';

import { hasNonEmptyText } from './shared';
import { createToolResultMessage, type ToolExecutionLedgerRecord } from './tool-execution-ledger';

export function resolveToolResultSummary(toolCall: ToolCall, toolResult: ToolCallResult): string {
  const toolName = toolCall.function.name;
  const subject = toolName === 'bash' ? 'Command' : toolName;
  const toolOutput = toolResult.output;

  if (toolResult.success) {
    if (hasNonEmptyText(toolOutput)) {
      return `${subject} completed successfully.`;
    }
    return `${subject} completed successfully with no output.`;
  }

  const errorMessage =
    toolResult.error?.message || (hasNonEmptyText(toolOutput) ? toolOutput : undefined);
  if (errorMessage) {
    return `${subject} failed: ${errorMessage}`;
  }
  return `${subject} failed.`;
}

export function buildToolResultMetadata(
  record: ToolExecutionLedgerRecord
): Record<string, unknown> | undefined {
  const result = record.result;
  const error: Record<string, unknown> = {};
  if (!result.success) {
    if (result.error?.name) {
      error.name = result.error.name;
    }
    if (result.error?.message) {
      error.message = result.error.message;
    }
    if (result.error?.errorCode) {
      error.code = result.error.errorCode;
    }
  }

  const toolResult: Record<string, unknown> = {
    success: result.success,
    summary: record.summary,
  };
  if (hasNonEmptyText(result.output)) {
    toolResult.output = result.output;
  }
  if (result.success && result.structured !== undefined) {
    toolResult.structured = result.structured;
  }
  if (result.metadata && Object.keys(result.metadata).length > 0) {
    toolResult.metadata = result.metadata;
  }
  if (Object.keys(error).length > 0) {
    toolResult.error = error;
  }

  return {
    toolResult,
  };
}

export function createToolResultMessageFromLedger(
  toolCallId: string,
  record: ToolExecutionLedgerRecord,
  createMessageId: () => string
): Message {
  return createToolResultMessage({
    toolCallId,
    content: hasNonEmptyText(record.result.output) ? record.result.output : record.summary,
    metadata: buildToolResultMetadata(record),
    createMessageId,
  });
}
