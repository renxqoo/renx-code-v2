import type { ToolDecision } from '../types';
import type { ToolCall } from '../../providers';

import { generateId } from './shared';
import { executeToolCallWithLedger, type ToolExecutionLedgerRecord } from './tool-execution-ledger';
import { createToolResultMessageFromLedger, resolveToolResultSummary } from './tool-result';
import type { ExecuteToolArgs, ToolRuntime } from './tool-runtime-types';
import { parseWriteFileProtocolOutput } from '../tool-v2/write-file-protocol';

function buildToolConfirmPromise(
  runtime: ToolRuntime,
  abortSignal: AbortSignal | undefined
): (info: {
  toolCallId: string;
  toolName: string;
  arguments: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}) => Promise<ToolDecision> {
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

async function buildRecordedToolResult(
  runtime: ToolRuntime,
  { toolCall, stepIndex, callbacks, abortSignal, executionId }: ExecuteToolArgs
): Promise<ToolExecutionLedgerRecord> {
  const confirm = buildToolConfirmPromise(runtime, abortSignal);
  const toolExecResult = await runtime.execution.executor.execute(toolCall, {
    executionId,
    stepIndex,
    agent: runtime.agentRef,
    sessionState: runtime.execution.sessionState,
    abortSignal,
    onStreamEvent: async (event) => {
      runtime.events.emit('tool_chunk', {
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        arguments: toolCall.function.arguments,
        chunk: event.message,
        chunkType: event.type,
      });
    },
    onExecutionEvent: undefined,
    onApproval: async (request) => {
      const decision = await confirm({
        toolCallId: request.callId,
        toolName: request.toolName,
        arguments: toolCall.function.arguments,
        reason: request.reason,
        metadata: {
          commandPreview: request.commandPreview,
          readPaths: request.readPaths,
          writePaths: request.writePaths,
        },
      });
      return {
        approved: decision.approved,
        scope: 'once',
        reason: decision.message,
      };
    },
    onPermissionRequest: undefined,
    onPolicyCheck: callbacks?.onToolPolicy
      ? async (info) => {
          const decision = await callbacks.onToolPolicy?.(info);
          return decision || { allowed: true };
        }
      : undefined,
  });
  const finalizedResult = await maybeAutoFinalizeWriteFileResult(runtime, {
    toolCall,
    toolExecResult,
    stepIndex,
    callbacks,
    abortSignal,
    executionId,
    confirm,
  });

  return {
    result: finalizedResult,
    summary: resolveToolResultSummary(toolCall, finalizedResult),
    recordedAt: Date.now(),
  };
}

async function maybeAutoFinalizeWriteFileResult(
  runtime: ToolRuntime,
  params: {
    toolCall: ToolCall;
    toolExecResult: Awaited<ReturnType<ToolRuntime['execution']['executor']['execute']>>;
    stepIndex: number;
    callbacks: ExecuteToolArgs['callbacks'];
    abortSignal: AbortSignal | undefined;
    executionId: string | undefined;
    confirm: ReturnType<typeof buildToolConfirmPromise>;
  }
) {
  const protocol = parseWriteFileProtocolOutput(params.toolExecResult.output);
  const onToolPolicy = params.callbacks?.onToolPolicy;
  if (
    params.toolCall.function.name !== 'write_file' ||
    !protocol ||
    protocol.nextAction !== 'finalize' ||
    !protocol.nextArgs
  ) {
    return params.toolExecResult;
  }

  const finalizeResult = await runtime.execution.executor.execute(
    {
      ...params.toolCall,
      id: `${params.toolCall.id}__finalize`,
      function: {
        ...params.toolCall.function,
        arguments: JSON.stringify(protocol.nextArgs),
      },
    },
    {
      executionId: params.executionId,
      stepIndex: params.stepIndex,
      agent: runtime.agentRef,
      sessionState: runtime.execution.sessionState,
      abortSignal: params.abortSignal,
      onStreamEvent: async (event) => {
        runtime.events.emit('tool_chunk', {
          toolCallId: params.toolCall.id,
          toolName: params.toolCall.function.name,
          arguments: params.toolCall.function.arguments,
          chunk: event.message,
          chunkType: event.type,
        });
      },
      onExecutionEvent: undefined,
      onApproval: async (request) => {
        const decision = await params.confirm({
          toolCallId: request.callId,
          toolName: request.toolName,
          arguments: JSON.stringify(protocol.nextArgs),
          reason: request.reason,
          metadata: {
            commandPreview: request.commandPreview,
            readPaths: request.readPaths,
            writePaths: request.writePaths,
          },
        });
        return {
          approved: decision.approved,
          scope: 'once',
          reason: decision.message,
        };
      },
      onPermissionRequest: undefined,
      onPolicyCheck: onToolPolicy
        ? async (info) => {
            const decision = await onToolPolicy(info);
            return decision || { allowed: true };
          }
        : undefined,
    }
  );

  return {
    ...finalizeResult,
    callId: params.toolCall.id,
    toolName: params.toolCall.function.name,
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
    errorCode: ledgerResult.record.result.success
      ? undefined
      : ledgerResult.record.result.error?.errorCode,
    success: ledgerResult.record.result.success,
  };
}
