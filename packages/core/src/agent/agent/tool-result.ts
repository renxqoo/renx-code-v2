import type { Message } from '../types';
import type { ToolCall } from '../../providers';
import type { ToolResult } from '../tool/base-tool';

import { hasNonEmptyText } from './shared';
import { createToolResultMessage, type ToolExecutionLedgerRecord } from './tool-execution-ledger';

export function resolveToolResultSummary(
  toolCall: ToolCall,
  toolResult: ToolResult,
  toolOutput: string
): string {
  if (hasNonEmptyText(toolResult.summary)) {
    return toolResult.summary;
  }

  const toolName = toolCall.function.name;
  const subject = toolName === 'bash' ? 'Command' : toolName;

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
  const error: Record<string, unknown> = {};
  if (record.errorName) {
    error.name = record.errorName;
  }
  if (record.errorMessage) {
    error.message = record.errorMessage;
  }
  if (record.errorCode) {
    error.code = record.errorCode;
  }

  const toolResult: Record<string, unknown> = {
    success: record.success,
    summary: record.summary,
  };
  if (hasNonEmptyText(record.output)) {
    toolResult.output = record.output;
  }
  if (record.payload !== undefined) {
    toolResult.payload = record.payload;
  }
  if (record.metadata && Object.keys(record.metadata).length > 0) {
    toolResult.metadata = record.metadata;
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
    content: hasNonEmptyText(record.output) ? record.output : record.summary,
    metadata: buildToolResultMetadata(record),
    createMessageId,
  });
}
