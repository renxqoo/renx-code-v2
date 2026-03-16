import type { ToolExecutionContext } from './context';
import type { SubagentPlatform } from './agent-runner';
import type { TaskStateStoreV2 } from './task-store';
import type { ShellBackgroundExecutionService } from './shell-background';
import { cancelLinkedTaskFromParentAbort, type LinkedTaskBinding } from './task-orchestration';

export const PARENT_ABORT_REASON = 'Cancelled by parent agent abort';

interface ParentAbortBaseParams {
  readonly context?: ToolExecutionContext;
}

interface ParentAbortSubagentParams extends ParentAbortBaseParams {
  readonly platform: SubagentPlatform;
  readonly agentId: string;
  readonly linkedTask?: LinkedTaskBinding | null;
  readonly taskStore?: TaskStateStoreV2;
}

interface ParentAbortShellParams extends ParentAbortBaseParams {
  readonly shellBackgrounds: ShellBackgroundExecutionService;
  readonly taskId: string;
}

export function attachSubagentParentAbortCascade(params: ParentAbortSubagentParams): () => void {
  return attachParentAbortListener(params.context, async () => {
    try {
      const cancelled = await params.platform.cancel(params.agentId, PARENT_ABORT_REASON);
      if (params.taskStore && params.linkedTask) {
        await cancelLinkedTaskFromParentAbort(
          params.taskStore,
          params.linkedTask,
          params.agentId,
          cancelled.status,
          PARENT_ABORT_REASON,
          'task-parent-abort'
        );
      }
      await params.context?.emit?.({
        type: 'info',
        message: `subagent cancelled by parent abort: ${params.agentId}`,
      });
    } catch (error) {
      await emitAbortFailure(params.context, error);
    }
  });
}

export function attachShellParentAbortCascade(params: ParentAbortShellParams): () => void {
  return attachParentAbortListener(params.context, async () => {
    try {
      await params.shellBackgrounds.cancel(params.taskId, PARENT_ABORT_REASON);
      await params.context?.emit?.({
        type: 'info',
        message: `background shell cancelled by parent abort: ${params.taskId}`,
      });
    } catch (error) {
      await emitAbortFailure(params.context, error);
    }
  });
}

function attachParentAbortListener(
  context: ToolExecutionContext | undefined,
  onAbort: () => Promise<void>
): () => void {
  const signal = context?.signal;
  if (!signal) {
    return () => {};
  }

  let settled = false;
  const handler = () => {
    if (settled) {
      return;
    }
    settled = true;
    void onAbort();
  };

  signal.addEventListener('abort', handler, { once: true });
  if (signal.aborted) {
    handler();
  }

  return () => {
    signal.removeEventListener('abort', handler);
  };
}

async function emitAbortFailure(
  context: ToolExecutionContext | undefined,
  error: unknown
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await context?.emit?.({
    type: 'stderr',
    message: `failed to cascade parent abort: ${message}`,
  });
}
