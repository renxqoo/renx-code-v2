import { randomUUID } from 'node:crypto';
import type {
  SubagentExecutionRecord,
  SubagentExecutionRequest,
  SubagentPlatformOptions,
  SubagentRole,
} from './agent-contracts';
import { ToolV2AbortError, ToolV2ResourceNotFoundError } from './errors';

export class SubagentPlatform {
  private readonly now: () => number;

  constructor(private readonly options: SubagentPlatformOptions) {
    this.now = options.now || Date.now;
  }

  roles(): SubagentRole[] {
    return Object.values(this.options.roles).sort((left, right) =>
      left.name.localeCompare(right.name)
    );
  }

  getRole(roleName: string): SubagentRole {
    const role = this.options.roles[roleName];
    if (!role) {
      throw new ToolV2ResourceNotFoundError('Subagent role not found', {
        roleName,
      });
    }
    return role;
  }

  async start(
    request: SubagentExecutionRequest,
    signal?: AbortSignal
  ): Promise<SubagentExecutionRecord> {
    const role = this.getRole(request.role);
    const executionId = `subexec_${randomUUID()}`;
    const conversationId = request.conversationId || `subconv_${randomUUID()}`;
    const record = await this.options.runner.start({
      role,
      prompt: request.prompt,
      description: request.description,
      conversationId,
      executionId,
      model: request.model,
      maxSteps: request.maxSteps || role.defaultMaxSteps,
      metadata: request.metadata,
      signal,
    });
    await this.options.store.save(record);
    return record;
  }

  async get(agentId: string): Promise<SubagentExecutionRecord> {
    const existing = await this.options.store.get(agentId);
    if (!existing) {
      throw new ToolV2ResourceNotFoundError('Subagent run not found', {
        agentId,
      });
    }
    const refreshed = await this.options.runner.poll(existing);
    await this.options.store.save(refreshed);
    return refreshed;
  }

  async wait(
    agentIds: string[],
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<SubagentExecutionRecord[]> {
    const deadline = this.now() + timeoutMs;
    const pending = new Set(agentIds);
    const results = new Map<string, SubagentExecutionRecord>();

    while (pending.size > 0 && this.now() < deadline) {
      if (signal?.aborted) {
        throw new ToolV2AbortError('Subagent wait aborted');
      }

      for (const agentId of [...pending]) {
        const record = await this.get(agentId);
        if (isTerminal(record.status)) {
          pending.delete(agentId);
          results.set(agentId, record);
        }
      }

      if (pending.size > 0) {
        await sleep(200, signal);
      }
    }

    for (const agentId of [...pending]) {
      const record = await this.get(agentId);
      results.set(agentId, record);
    }

    return agentIds
      .map((agentId) => results.get(agentId))
      .filter((record): record is SubagentExecutionRecord => Boolean(record));
  }

  async cancel(agentId: string, reason?: string): Promise<SubagentExecutionRecord> {
    const existing = await this.options.store.get(agentId);
    if (!existing) {
      throw new ToolV2ResourceNotFoundError('Subagent run not found', {
        agentId,
      });
    }
    const cancelled = await this.options.runner.cancel(existing, reason);
    await this.options.store.save(cancelled);
    return cancelled;
  }
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
    throw new ToolV2AbortError('Subagent wait aborted');
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ToolV2AbortError('Subagent wait aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
