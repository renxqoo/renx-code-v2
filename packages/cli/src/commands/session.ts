import { runTuiCommand } from './tui.js';
import { parseArgv, readBooleanFlag, readStringFlag } from '../shared/argv.js';
import { CliUsageError } from '../shared/errors.js';
import { toJson } from '../shared/output.js';
import { createSharedRuntime } from '../shared/runtime.js';
import type { CommandContext, CommandResult } from '../shared/types.js';

type RunStatus = 'CREATED' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

const RUN_STATUSES: RunStatus[] = ['CREATED', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'];

function parseLimit(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new CliUsageError(`Invalid --limit value: ${raw}`);
  }
  return value;
}

function parseStatuses(raw: string | undefined): RunStatus[] | undefined {
  if (!raw) {
    return undefined;
  }
  const values = raw
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter((item) => item.length > 0);

  if (values.length === 0) {
    return undefined;
  }

  for (const value of values) {
    if (!RUN_STATUSES.includes(value as RunStatus)) {
      throw new CliUsageError(`Invalid status: ${value}. Allowed: ${RUN_STATUSES.join(', ')}`);
    }
  }

  return values as RunStatus[];
}

async function handleList(ctx: CommandContext, argv: string[]): Promise<CommandResult> {
  const parsed = parseArgv(argv, { allowPositionals: false });
  const json = readBooleanFlag(parsed, 'json');
  const conversationId = readStringFlag(parsed, 'conversation-id', 'conversationId');
  const cursor = readStringFlag(parsed, 'cursor');
  const statuses = parseStatuses(readStringFlag(parsed, 'status', 'statuses'));
  const limit = parseLimit(readStringFlag(parsed, 'limit'), 20);

  const runtime = await createSharedRuntime({
    repoRoot: ctx.repoRoot,
    cwd: ctx.cwd,
  });

  try {
    if (conversationId) {
      const runs = await runtime.appStore.listByConversation?.(conversationId, {
        limit,
        cursor,
        statuses,
      });

      if (!runs) {
        throw new CliUsageError('Session list is unavailable: store does not support listByConversation.');
      }

      const payload = {
        conversationId,
        limit,
        cursor,
        statuses,
        runs: runs.items,
        nextCursor: runs.nextCursor,
      };

      if (json) {
        return { exitCode: 0, stdout: toJson(payload) };
      }

      const lines = [
        `Conversation: ${conversationId}`,
        `Runs: ${runs.items.length}`,
        '',
        ...runs.items.map((item: Record<string, unknown>) => {
          const executionId = String(item.executionId || 'unknown');
          const status = String(item.status || 'UNKNOWN');
          const updatedAt = new Date(Number(item.updatedAt || 0)).toISOString();
          const terminalReason = item.terminalReason ? ` (${item.terminalReason})` : '';
          return `${executionId}  ${status}${terminalReason}  updated=${updatedAt}`;
        }),
      ];

      if (runs.nextCursor) {
        lines.push('', `Next cursor: ${runs.nextCursor}`);
      }

      return {
        exitCode: 0,
        stdout: `${lines.join('\n')}\n`,
      };
    }

    const client = runtime.appStore.client;

    if (!client) {
      throw new CliUsageError(
        'Session list without --conversation-id is unavailable in this runtime. Use --conversation-id instead.'
      );
    }

    const rows = await client.all<{
      conversation_id: string;
      run_count: number;
      running_count: number;
      updated_at_ms: number;
      created_at_ms: number;
    }>(
      `
        SELECT
          conversation_id,
          COUNT(*) AS run_count,
          SUM(CASE WHEN status = 'RUNNING' THEN 1 ELSE 0 END) AS running_count,
          MAX(updated_at_ms) AS updated_at_ms,
          MIN(created_at_ms) AS created_at_ms
        FROM runs
        GROUP BY conversation_id
        ORDER BY updated_at_ms DESC
        LIMIT ?
      `,
      [limit]
    );

    const sessions = rows.map((row) => ({
      conversationId: row.conversation_id,
      runCount: row.run_count,
      runningCount: row.running_count,
      createdAt: row.created_at_ms,
      updatedAt: row.updated_at_ms,
    }));

    if (json) {
      return {
        exitCode: 0,
        stdout: toJson({ sessions, limit }),
      };
    }

    const lines = ['Sessions', '', ...sessions.map((session) => {
      const updated = new Date(session.updatedAt).toISOString();
      return `${session.conversationId}  runs=${session.runCount} running=${session.runningCount} updated=${updated}`;
    })];

    if (sessions.length === 0) {
      lines.push('(empty)');
    }

    return {
      exitCode: 0,
      stdout: `${lines.join('\n')}\n`,
    };
  } finally {
    await runtime.dispose();
  }
}

async function handleShow(ctx: CommandContext, argv: string[]): Promise<CommandResult> {
  const parsed = parseArgv(argv, { allowPositionals: true });
  const json = readBooleanFlag(parsed, 'json');
  const id = readStringFlag(parsed, 'id') || parsed.positionals[0];
  const limit = parseLimit(readStringFlag(parsed, 'limit'), 50);

  if (!id) {
    throw new CliUsageError('Usage: renx session show --id <conversation-id|execution-id> [--json]');
  }

  const runtime = await createSharedRuntime({
    repoRoot: ctx.repoRoot,
    cwd: ctx.cwd,
  });

  try {
    const client = runtime.appStore.client;

    if (!client) {
      throw new CliUsageError('Session show is unavailable: database client is not accessible.');
    }

    const runByExecutionId = await client.get<Record<string, unknown>>(
      `
        SELECT
          execution_id AS executionId,
          run_id AS runId,
          conversation_id AS conversationId,
          status,
          step_index AS stepIndex,
          terminal_reason AS terminalReason,
          error_code AS errorCode,
          error_category AS errorCategory,
          error_message AS errorMessage,
          created_at_ms AS createdAt,
          updated_at_ms AS updatedAt,
          started_at_ms AS startedAt,
          completed_at_ms AS completedAt
        FROM runs
        WHERE execution_id = ?
      `,
      [id]
    );

    if (runByExecutionId) {
      const events = await client.all<Record<string, unknown>>(
        `
          SELECT
            seq,
            event_type AS eventType,
            payload_json AS payloadJson,
            created_at_ms AS createdAt
          FROM events
          WHERE execution_id = ?
          ORDER BY seq ASC
          LIMIT ?
        `,
        [id, limit]
      );

      const logs = await client.all<Record<string, unknown>>(
        `
          SELECT
            level,
            code,
            source,
            message,
            created_at_ms AS createdAt
          FROM run_logs
          WHERE execution_id = ?
          ORDER BY created_at_ms ASC, id ASC
          LIMIT ?
        `,
        [id, limit]
      );

      const payloadEvents = events.map((event) => {
        const payloadJson = event.payloadJson;
        const payload =
          typeof payloadJson === 'string'
            ? (() => {
                try {
                  return JSON.parse(payloadJson);
                } catch {
                  return payloadJson;
                }
              })()
            : payloadJson;

        return {
          ...event,
          payload,
        };
      });

      const payload = {
        type: 'run' as const,
        id,
        run: runByExecutionId,
        events: payloadEvents,
        logs,
      };

      if (json) {
        return { exitCode: 0, stdout: toJson(payload) };
      }

      const lines = [
        `Execution: ${id}`,
        `Conversation: ${String(runByExecutionId.conversationId || 'unknown')}`,
        `Status: ${String(runByExecutionId.status || 'UNKNOWN')}`,
        `Steps: ${String(runByExecutionId.stepIndex || 0)}`,
        '',
        `Events (${payload.events.length}):`,
        ...payload.events.map((event: Record<string, unknown>) => {
          const seq = String(event.seq ?? '?');
          const eventType = String(event.eventType ?? 'unknown');
          return `  #${seq} ${eventType}`;
        }),
        '',
        `Logs (${logs.length}):`,
        ...logs.map((log) => `  [${String(log.level).toUpperCase()}] ${String(log.message)}`),
      ];

      return { exitCode: 0, stdout: `${lines.join('\n')}\n` };
    }

    const runs = await runtime.appStore.listByConversation?.(id, {
      limit,
    });

    if (!runs || runs.items.length === 0) {
      throw new CliUsageError(`Session not found: ${id}`);
    }

    const payload = {
      type: 'conversation',
      id,
      runs: runs.items,
      nextCursor: runs.nextCursor,
    };

    if (json) {
      return { exitCode: 0, stdout: toJson(payload) };
    }

    const lines = [
      `Conversation: ${id}`,
      `Runs: ${runs.items.length}`,
      '',
      ...runs.items.map((run: Record<string, unknown>) => {
        const executionId = String(run.executionId || 'unknown');
        const status = String(run.status || 'UNKNOWN');
        const updatedAt = new Date(Number(run.updatedAt || 0)).toISOString();
        const terminalReason = run.terminalReason ? ` (${run.terminalReason})` : '';
        return `${executionId}  ${status}${terminalReason}  updated=${updatedAt}`;
      }),
    ];

    return { exitCode: 0, stdout: `${lines.join('\n')}\n` };
  } finally {
    await runtime.dispose();
  }
}

async function handleResume(ctx: CommandContext, argv: string[]): Promise<CommandResult> {
  const parsed = parseArgv(argv, { allowPositionals: true });
  const id = readStringFlag(parsed, 'id') || parsed.positionals[0];
  if (!id) {
    throw new CliUsageError('Usage: renx session resume --id <conversation-id>');
  }

  return runTuiCommand({
    ...ctx,
    argv: ['--session-id', id],
  });
}

export async function runSessionCommand(ctx: CommandContext): Promise<CommandResult> {
  const [subcommand, ...rest] = ctx.argv;
  if (!subcommand) {
    throw new CliUsageError('Usage: renx session <list|show|resume> [options]');
  }

  switch (subcommand) {
    case 'list':
      return handleList(ctx, rest);
    case 'show':
      return handleShow(ctx, rest);
    case 'resume':
      return handleResume(ctx, rest);
    default:
      throw new CliUsageError(`Unknown session subcommand: ${subcommand}`);
  }
}
