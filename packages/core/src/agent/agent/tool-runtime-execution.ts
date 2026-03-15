import type { ToolCall } from '../../providers';
import type { ToolDecision } from '../types';

import { UnknownError } from './error';
import { generateId } from './shared';
import { executeToolCallWithLedger, type ToolExecutionLedgerRecord } from './tool-execution-ledger';
import { createToolResultMessageFromLedger, resolveToolResultSummary } from './tool-result';
import {
  buildWriteFileSessionKey,
  cleanupWriteFileBufferIfNeeded,
  enrichWriteFileToolError,
  isWriteFileProtocolOutput,
  isWriteFileToolCall,
  parseWriteFileProtocolOutput,
  shouldEnrichWriteFileFailure,
} from './write-file-session';
import type { ToolResult } from '../tool/base-tool';
import type { ExecuteToolArgs, ToolRuntime } from './tool-runtime-types';

function buildToolConfirmPromise(
  runtime: ToolRuntime,
  abortSignal: AbortSignal | undefined
): (info: { toolCallId: string; toolName: string; arguments: string }) => Promise<ToolDecision> {
  return async (info) =>
    new Promise<ToolDecision>((resolve) => {
      let settled = false;
      const abortHandler = () => {
        if (!settled) {
          settled = true;
          resolve({ approved: false, message: 'Operation aborted' });
        }
      };

      const cleanup = () => {
        if (!settled) {
          settled = true;
        }
        abortSignal?.removeEventListener('abort', abortHandler);
      };

      if (abortSignal?.aborted) {
        abortHandler();
        return;
      }

      abortSignal?.addEventListener('abort', abortHandler, { once: true });
      runtime.events.emit('tool_confirm', {
        ...info,
        resolve: (decision: ToolDecision) => {
          cleanup();
          resolve(decision);
        },
      });
    });
}

async function maybeAutoFinalizeWriteFileResult(
  runtime: ToolRuntime,
  params: {
    toolCall: ToolCall;
    toolOutput: string;
    stepIndex: number;
    abortSignal?: AbortSignal;
  }
): Promise<ToolResult> {
  const { toolCall, toolOutput, stepIndex, abortSignal } = params;
  if (!isWriteFileToolCall(toolCall)) {
    return {
      success: false,
      output: toolOutput,
    };
  }

  const protocol = parseWriteFileProtocolOutput(toolOutput);
  if (
    !protocol ||
    protocol.code !== 'WRITE_FILE_PARTIAL_BUFFERED' ||
    protocol.nextAction !== 'finalize'
  ) {
    return {
      success: false,
      output: toolOutput,
    };
  }

  const bufferId = protocol.nextArgs?.bufferId || protocol.buffer?.bufferId;
  const finalizePath = protocol.nextArgs?.path || protocol.buffer?.path || undefined;
  if (!bufferId) {
    return {
      success: false,
      output: toolOutput,
    };
  }

  const finalizeToolCall: ToolCall = {
    id: `${toolCall.id}__finalize`,
    type: toolCall.type,
    index: toolCall.index,
    function: {
      name: toolCall.function.name,
      arguments: JSON.stringify({
        mode: 'finalize',
        bufferId,
        ...(finalizePath ? { path: finalizePath } : {}),
      }),
    },
  };

  // Buffered write_file protocols intentionally split "receive content" from
  // "commit to disk". When only finalize remains, we complete it here so the
  // outer loop still observes a single logical tool result.
  runtime.resilience.throwIfAborted(abortSignal);
  return runtime.execution.manager.execute(finalizeToolCall, {
    toolCallId: finalizeToolCall.id,
    loopIndex: stepIndex,
    agent: runtime.agentRef,
    toolAbortSignal: abortSignal,
  });
}

async function buildRecordedToolResult(
  runtime: ToolRuntime,
  {
    toolCall,
    stepIndex,
    callbacks,
    abortSignal,
    executionId,
    writeBufferSessions = new Map(),
  }: ExecuteToolArgs
): Promise<ToolExecutionLedgerRecord> {
  const writeFileSessionKey = buildWriteFileSessionKey({
    executionId,
    stepIndex,
    toolCallId: toolCall.id,
  });
  const confirm = buildToolConfirmPromise(runtime, abortSignal);

  const toolExecResult = await runtime.execution.manager.execute(toolCall, {
    onChunk: (chunk) => {
      runtime.events.emit('tool_chunk', {
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        arguments: toolCall.function.arguments,
        chunk: chunk.data,
        chunkType: chunk.type,
      });
    },
    onConfirm: confirm,
    onPolicyCheck: callbacks?.onToolPolicy
      ? async (info) => {
          const decision = await callbacks.onToolPolicy?.(info);
          return decision || { allowed: true };
        }
      : undefined,
    toolCallId: toolCall.id,
    loopIndex: stepIndex,
    agent: runtime.agentRef,
    toolAbortSignal: abortSignal,
  });

  let toolOutput = '';
  let errorCode: string | undefined;

  if (toolExecResult.success) {
    toolOutput = toolExecResult.output || '';
    await cleanupWriteFileBufferIfNeeded(toolCall, writeBufferSessions, writeFileSessionKey);
  } else if (isWriteFileToolCall(toolCall)) {
    // write_file failures are special because the model may stream a large
    // payload incrementally. Preserve or enrich protocol data so the model can
    // recover deterministically instead of seeing a lossy generic error string.
    if (isWriteFileProtocolOutput(toolExecResult.output)) {
      toolOutput = toolExecResult.output;
    } else if (shouldEnrichWriteFileFailure(toolExecResult.error, toolExecResult.output)) {
      const errorContent =
        toolExecResult.error?.message || toolExecResult.output || new UnknownError().message;
      toolOutput = await enrichWriteFileToolError(
        toolCall,
        errorContent,
        writeBufferSessions,
        writeFileSessionKey
      );
    } else {
      toolOutput =
        toolExecResult.error?.message || toolExecResult.output || new UnknownError().message;
    }

    if (isWriteFileProtocolOutput(toolOutput)) {
      const finalizeResult = await maybeAutoFinalizeWriteFileResult(runtime, {
        toolCall,
        toolOutput,
        stepIndex,
        abortSignal,
      });
      if (finalizeResult.success) {
        toolOutput = finalizeResult.output || '';
        await cleanupWriteFileBufferIfNeeded(toolCall, writeBufferSessions, writeFileSessionKey);
        return {
          success: true,
          output: toolOutput,
          summary: resolveToolResultSummary(toolCall, finalizeResult, toolOutput),
          payload: finalizeResult.payload,
          metadata: finalizeResult.metadata,
          errorName: undefined,
          errorMessage: undefined,
          errorCode: undefined,
          recordedAt: Date.now(),
        };
      }
    }

    errorCode =
      runtime.diagnostics.extractErrorCode(toolExecResult.error) || 'TOOL_EXECUTION_FAILED';
  } else {
    toolOutput =
      toolExecResult.error?.message || toolExecResult.output || new UnknownError().message;
    errorCode =
      runtime.diagnostics.extractErrorCode(toolExecResult.error) || 'TOOL_EXECUTION_FAILED';
  }

  return {
    success: toolExecResult.success,
    output: toolOutput,
    summary: resolveToolResultSummary(toolCall, toolExecResult, toolOutput),
    payload: toolExecResult.payload,
    metadata: toolExecResult.metadata,
    errorName: toolExecResult.error?.name,
    errorMessage: toolExecResult.error?.message,
    errorCode,
    recordedAt: Date.now(),
  };
}

export async function executeToolWithLedger(
  runtime: ToolRuntime,
  args: ExecuteToolArgs
): Promise<{
  replayResult: ReturnType<typeof createToolResultMessageFromLedger>;
  fromCache: boolean;
  errorCode?: string;
  success: boolean;
}> {
  const { executionId, stepIndex, toolCall, callbacks } = args;
  const ledgerResult = await executeToolCallWithLedger({
    ledger: runtime.execution.ledger,
    executionId,
    toolCallId: toolCall.id,
    execute: () => buildRecordedToolResult(runtime, args),
    onError: (error) => {
      runtime.diagnostics.logError('[Agent] Failed to execute tool with ledger:', error, {
        executionId,
        stepIndex,
        toolCallId: toolCall.id,
      });
    },
  });

  const replayResult = createToolResultMessageFromLedger(toolCall.id, ledgerResult.record, () =>
    generateId('msg_')
  );
  await runtime.callbacks.safe(callbacks?.onMessage, replayResult);

  return {
    replayResult,
    fromCache: ledgerResult.fromCache,
    errorCode: ledgerResult.record.errorCode,
    success: ledgerResult.record.success,
  };
}
