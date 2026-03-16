import { z } from 'zod';
import type { ToolExecutionPlan, ToolHandlerResult } from '../contracts';
import type { SubagentExecutionRecord, SubagentExecutionStore } from '../agent-contracts';
import {
  arraySchema,
  objectSchema,
  oneOfSchema,
  shellBackgroundRecordSchema,
  stringSchema,
  subagentRecordSchema,
} from '../output-schema';
import { StructuredToolHandler } from '../registry';
import { SubagentPlatform } from '../agent-runner';
import { ShellBackgroundExecutionService } from '../shell-background';
import { syncLinkedTaskFromSubagentRecord } from '../task-orchestration';
import type { TaskStateStoreV2 } from '../task-store';
import { ToolV2ConflictError, ToolV2ExecutionError, ToolV2ResourceNotFoundError } from '../errors';
import { TASK_STOP_DESCRIPTION } from '../tool-prompts';

const schema = z
  .object({
    namespace: z.string().min(1).optional().describe('Optional task namespace'),
    agentId: z.string().min(1).optional().describe('Direct subagent run id to stop'),
    taskId: z
      .string()
      .min(1)
      .optional()
      .describe('Planning task id used to resolve the linked run'),
    reason: z.string().optional().describe('Optional cancellation reason'),
    cancelLinkedTask: z
      .boolean()
      .optional()
      .describe('When true, also cancel the linked planning task'),
  })
  .strict()
  .refine((value) => Boolean(value.agentId || value.taskId), {
    message: 'agentId or taskId is required',
  });

export class TaskStopToolV2 extends StructuredToolHandler<typeof schema> {
  constructor(
    private readonly platform: SubagentPlatform | undefined,
    private readonly store: SubagentExecutionStore | undefined,
    private readonly shellBackgrounds?: ShellBackgroundExecutionService,
    private readonly taskStore?: TaskStateStoreV2
  ) {
    super({
      name: 'task_stop',
      description: TASK_STOP_DESCRIPTION,
      schema,
      outputSchema: oneOfSchema([
        objectSchema(
          {
            namespace: stringSchema(),
            agentRun: subagentRecordSchema,
            cancelledTaskIds: arraySchema(stringSchema()),
          },
          {
            required: ['agentRun', 'cancelledTaskIds'],
          }
        ),
        objectSchema(
          {
            namespace: stringSchema(),
            taskId: stringSchema(),
            shellRun: shellBackgroundRecordSchema,
            cancelledTaskIds: arraySchema(stringSchema()),
          },
          {
            required: ['taskId', 'shellRun', 'cancelledTaskIds'],
          }
        ),
      ]),
      supportsParallel: false,
      mutating: true,
      tags: ['agent', 'orchestration', 'task'],
    });
  }

  plan(args: z.infer<typeof schema>): ToolExecutionPlan {
    const target = args.agentId || args.taskId || 'unknown';
    return {
      mutating: true,
      concurrency: {
        mode: 'exclusive',
        lockKey: `task_stop:${target}`,
      },
      approval: {
        required: true,
        reason: `Stop task or subagent ${target}`,
        key: `task-stop:${target}`,
      },
    };
  }

  async execute(args: z.infer<typeof schema>): Promise<ToolHandlerResult> {
    const record = await resolveAgentRecord(this.store, args.agentId, args.taskId);
    if (record) {
      if (!this.platform) {
        throw new ToolV2ExecutionError('Subagent platform is not configured for task_stop', {
          agentId: record.agentId,
        });
      }

      if (isTerminal(record.status)) {
        throw new ToolV2ConflictError(`Agent run is already terminal: ${record.status}`, {
          agentId: record.agentId,
          status: record.status,
        });
      }

      const cancelled = await this.platform.cancel(record.agentId, args.reason);
      if (this.taskStore) {
        await syncLinkedTaskFromSubagentRecord(this.taskStore, cancelled);
      }
      const linkedTaskId =
        typeof cancelled.metadata?.linkedTaskId === 'string'
          ? cancelled.metadata.linkedTaskId
          : typeof cancelled.metadata?.taskId === 'string'
            ? cancelled.metadata.taskId
            : undefined;

      const structured = {
        namespace: args.namespace,
        agentRun: cancelled,
        cancelledTaskIds: (args.cancelLinkedTask ?? true) && linkedTaskId ? [linkedTaskId] : [],
      };
      return {
        output: JSON.stringify(structured),
        structured,
        metadata: {
          agentId: cancelled.agentId,
          status: cancelled.status,
          cancelledTaskId: linkedTaskId,
        },
      };
    }

    if (!args.taskId) {
      throw new ToolV2ResourceNotFoundError('Task run not found', {
        agentId: args.agentId,
      });
    }
    if (!this.shellBackgrounds) {
      throw new ToolV2ResourceNotFoundError('Task run not found', {
        taskId: args.taskId,
      });
    }

    const cancelled = await this.shellBackgrounds.cancel(args.taskId, args.reason);
    const structured = {
      namespace: args.namespace,
      taskId: args.taskId,
      shellRun: cancelled,
      cancelledTaskIds: [args.taskId],
    };
    return {
      output: JSON.stringify(structured),
      structured,
      metadata: {
        taskId: cancelled.taskId,
        status: cancelled.status,
      },
    };
  }
}

async function resolveAgentRecord(
  store: SubagentExecutionStore | undefined,
  agentId?: string,
  taskId?: string
): Promise<SubagentExecutionRecord | null> {
  if (!store) {
    return null;
  }
  if (agentId) {
    return store.get(agentId);
  }
  if (!taskId) {
    return null;
  }

  const records = await store.list();
  const matched = records
    .filter(
      (record) => record.metadata?.linkedTaskId === taskId || record.metadata?.taskId === taskId
    )
    .sort((left, right) => right.updatedAt - left.updatedAt);
  return matched[0] || null;
}

function isTerminal(status: SubagentExecutionRecord['status']): boolean {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'timed_out'
  );
}
