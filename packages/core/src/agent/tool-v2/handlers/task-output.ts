import { z } from 'zod';
import type { ToolExecutionContext } from '../context';
import type { ToolExecutionPlan, ToolHandlerResult } from '../contracts';
import type { SubagentExecutionRecord, SubagentExecutionStore } from '../agent-contracts';
import {
  booleanSchema,
  integerSchema,
  objectSchema,
  oneOfSchema,
  shellBackgroundRecordSchema,
  stringSchema,
  subagentRecordSchema,
} from '../output-schema';
import { StructuredToolHandler } from '../registry';
import { SubagentPlatform } from '../agent-runner';
import {
  ShellBackgroundExecutionService,
  isTerminalShellBackgroundStatus,
} from '../shell-background';
import type { ShellBackgroundExecutionRecord } from '../runtimes/shell-runtime';
import { syncLinkedTaskFromSubagentRecord } from '../task-orchestration';
import type { TaskStateStoreV2 } from '../task-store';
import { ToolV2AbortError, ToolV2ExecutionError, ToolV2ResourceNotFoundError } from '../errors';
import { TASK_OUTPUT_DESCRIPTION } from '../tool-prompts';

const schema = z
  .object({
    namespace: z.string().min(1).optional().describe('Optional task namespace'),
    agentId: z.string().min(1).optional().describe('Direct subagent run id to query'),
    taskId: z
      .string()
      .min(1)
      .optional()
      .describe('Planning task id used to resolve the linked run'),
    block: z.boolean().optional().describe('Wait for completion before returning when true'),
    timeoutMs: z
      .number()
      .int()
      .min(1)
      .max(30 * 60 * 1000)
      .optional()
      .describe('Timeout in milliseconds when blocking'),
    pollIntervalMs: z
      .number()
      .int()
      .min(20)
      .max(5000)
      .optional()
      .describe('Polling interval in milliseconds while blocking'),
  })
  .strict()
  .refine((value) => Boolean(value.agentId || value.taskId), {
    message: 'agentId or taskId is required',
  });

export class TaskOutputToolV2 extends StructuredToolHandler<typeof schema> {
  constructor(
    private readonly platform: SubagentPlatform | undefined,
    private readonly store: SubagentExecutionStore | undefined,
    private readonly shellBackgrounds?: ShellBackgroundExecutionService,
    private readonly taskStore?: TaskStateStoreV2
  ) {
    super({
      name: 'task_output',
      description: TASK_OUTPUT_DESCRIPTION,
      schema,
      outputSchema: oneOfSchema([
        objectSchema(
          {
            namespace: stringSchema(),
            agentRun: subagentRecordSchema,
            waitedMs: integerSchema(),
            completed: booleanSchema(),
            timeoutHit: booleanSchema(),
          },
          {
            required: ['agentRun'],
            additionalProperties: false,
          }
        ),
        objectSchema(
          {
            namespace: stringSchema(),
            taskId: stringSchema(),
            shellRun: shellBackgroundRecordSchema,
            waitedMs: integerSchema(),
            completed: booleanSchema(),
            timeoutHit: booleanSchema(),
          },
          {
            required: ['taskId', 'shellRun'],
            additionalProperties: false,
          }
        ),
      ]),
      supportsParallel: true,
      mutating: false,
      tags: ['agent', 'orchestration', 'task'],
    });
  }

  plan(args: z.infer<typeof schema>): ToolExecutionPlan {
    return {
      mutating: false,
      concurrency: {
        mode: 'parallel-safe',
        lockKey: `task_output:${args.agentId || args.taskId || 'unknown'}`,
      },
    };
  }

  async execute(
    args: z.infer<typeof schema>,
    context: ToolExecutionContext
  ): Promise<ToolHandlerResult> {
    const resolved = await resolveAgentRecord(this.store, args.agentId, args.taskId);
    if (resolved) {
      const shouldBlock = args.block ?? true;
      const timeoutMs = args.timeoutMs ?? 30000;
      const pollIntervalMs = args.pollIntervalMs ?? 200;

      if (!this.platform) {
        throw new ToolV2ExecutionError('Subagent platform is not configured for task_output', {
          agentId: resolved.agentId,
        });
      }

      if (!shouldBlock) {
        const current = await this.platform.get(resolved.agentId);
        await this.syncTaskIfTerminal(current);
        return buildTaskOutputResult(current, args.namespace, false, undefined);
      }

      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const current = await this.platform.get(resolved.agentId);
        if (isTerminal(current.status)) {
          await this.syncTaskIfTerminal(current);
          return buildTaskOutputResult(current, args.namespace, true, Date.now() - startedAt);
        }
        await sleep(pollIntervalMs, context.signal);
      }

      const latest = await this.platform.get(resolved.agentId);
      await this.syncTaskIfTerminal(latest);
      return {
        output: JSON.stringify({
          namespace: args.namespace,
          agentRun: sanitizeTaskOutputRun(latest),
          waitedMs: Date.now() - startedAt,
          completed: false,
          timeoutHit: true,
        }),
        structured: {
          namespace: args.namespace,
          agentRun: sanitizeTaskOutputRun(latest),
          waitedMs: Date.now() - startedAt,
          completed: false,
          timeoutHit: true,
        },
        metadata: {
          agentId: latest.agentId,
          status: latest.status,
          timeoutHit: true,
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

    const shouldBlock = args.block ?? true;
    const timeoutMs = args.timeoutMs ?? 30000;
    const pollIntervalMs = args.pollIntervalMs ?? 200;

    if (!shouldBlock) {
      const current = await this.shellBackgrounds.get(args.taskId);
      return buildShellTaskOutputResult(current, args.namespace, false, undefined);
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const current = await this.shellBackgrounds.get(args.taskId);
      if (isTerminalShellBackgroundStatus(current.status)) {
        return buildShellTaskOutputResult(current, args.namespace, true, Date.now() - startedAt);
      }
      await sleep(pollIntervalMs, context.signal);
    }

    const latest = await this.shellBackgrounds.get(args.taskId);
    return {
      output: JSON.stringify({
        namespace: args.namespace,
        shellRun: latest,
        waitedMs: Date.now() - startedAt,
        completed: false,
        timeoutHit: true,
      }),
      structured: {
        namespace: args.namespace,
        shellRun: latest,
        waitedMs: Date.now() - startedAt,
        completed: false,
        timeoutHit: true,
      },
      metadata: {
        taskId: latest.taskId,
        status: latest.status,
        timeoutHit: true,
      },
    };
  }

  private async syncTaskIfTerminal(record: SubagentExecutionRecord): Promise<void> {
    if (!this.taskStore || !isTerminal(record.status)) {
      return;
    }
    await syncLinkedTaskFromSubagentRecord(this.taskStore, record);
  }
}

function buildTaskOutputResult(
  record: SubagentExecutionRecord,
  namespace?: string,
  completed?: boolean,
  waitedMs?: number
): ToolHandlerResult {
  const structured = {
    namespace,
    agentRun: sanitizeTaskOutputRun(record),
    ...(waitedMs !== undefined ? { waitedMs } : {}),
    ...(completed !== undefined ? { completed } : {}),
  };
  return {
    output: JSON.stringify(structured),
    structured,
    metadata: {
      agentId: record.agentId,
      status: record.status,
      ...(completed !== undefined ? { completed } : {}),
    },
  };
}

function sanitizeTaskOutputRun(run: SubagentExecutionRecord): SubagentExecutionRecord {
  const cloned = JSON.parse(JSON.stringify(run)) as SubagentExecutionRecord;
  if (cloned.status === 'completed') {
    return cloned;
  }

  delete (cloned as { output?: string }).output;
  if (
    (cloned.status === 'failed' ||
      cloned.status === 'timed_out' ||
      cloned.status === 'cancelled') &&
    (!cloned.error || cloned.error.trim().length === 0)
  ) {
    (cloned as { error?: string }).error = `Agent run ${cloned.status}`;
  }

  return cloned;
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

function buildShellTaskOutputResult(
  record: ShellBackgroundExecutionRecord,
  namespace?: string,
  completed?: boolean,
  waitedMs?: number
): ToolHandlerResult {
  const structured = {
    namespace,
    taskId: record.taskId,
    shellRun: record,
    ...(waitedMs !== undefined ? { waitedMs } : {}),
    ...(completed !== undefined ? { completed } : {}),
  };
  return {
    output: JSON.stringify(structured),
    structured,
    metadata: {
      taskId: record.taskId,
      status: record.status,
      ...(completed !== undefined ? { completed } : {}),
    },
  };
}

function isTerminal(status: SubagentExecutionRecord['status']): boolean {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'timed_out'
  );
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new ToolV2AbortError('Task output polling aborted');
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ToolV2AbortError('Task output polling aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
