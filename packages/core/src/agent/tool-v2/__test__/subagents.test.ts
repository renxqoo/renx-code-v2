import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  SubagentExecutionRecord,
  SubagentExecutionStore,
  SubagentRole,
  SubagentRunner,
  SubagentRunnerStartRequest,
} from '../agent-contracts';
import { ToolSessionState, type ToolExecutionContext } from '../context';
import { DEFAULT_SUBAGENT_ROLES } from '../agent-roles';
import { createBuiltInToolHandlersV2 } from '../builtins';
import { createRestrictedNetworkPolicy, createWorkspaceFileSystemPolicy } from '../permissions';
import { TaskStateStoreV2 } from '../task-store';
import { EnterpriseToolSystem } from '../tool-system';

describe('tool-v2 subagent tools', () => {
  let workspaceDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-tool-v2-subagents-'));
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it('registers and executes the clean-slate subagent lifecycle tools', async () => {
    const runner = new FakeSubagentRunner();
    const store = new MemorySubagentStore();
    const roles: Record<string, SubagentRole> = {
      worker: {
        name: 'worker',
        description: 'General worker',
        systemPrompt: 'You are a worker.',
        allowedTools: ['read_file'],
        defaultMaxSteps: 4,
      },
    };
    const system = new EnterpriseToolSystem(
      createBuiltInToolHandlersV2({
        roles,
        runner,
        store,
      })
    );

    expect(system.specs().some((spec) => spec.name === 'spawn_agent')).toBe(true);
    expect(system.specs().some((spec) => spec.name === 'wait_agents')).toBe(true);
    expect(system.specs().some((spec) => spec.name === 'task_output')).toBe(true);
    expect(system.specs().some((spec) => spec.name === 'task_stop')).toBe(true);

    const spawnResult = await system.execute(
      {
        callId: 'agent-spawn',
        toolName: 'spawn_agent',
        arguments: JSON.stringify({
          role: 'worker',
          prompt: 'Summarize the repository layout',
        }),
      },
      createContext(workspaceDir)
    );

    expect(spawnResult.success).toBe(true);
    if (!spawnResult.success) {
      return;
    }

    const agentId = (spawnResult.structured as SubagentExecutionRecord).agentId;

    const statusResult = await system.execute(
      {
        callId: 'agent-status',
        toolName: 'agent_status',
        arguments: JSON.stringify({
          agentId,
        }),
      },
      createContext(workspaceDir)
    );

    expect(statusResult.success).toBe(true);
    if (statusResult.success) {
      expect((statusResult.structured as SubagentExecutionRecord).status).toBe('completed');
    }

    const waitResult = await system.execute(
      {
        callId: 'agent-wait',
        toolName: 'wait_agents',
        arguments: JSON.stringify({
          agentIds: [agentId],
          timeoutMs: 500,
        }),
      },
      createContext(workspaceDir)
    );

    expect(waitResult.success).toBe(true);
    if (waitResult.success) {
      const records = waitResult.structured as SubagentExecutionRecord[];
      expect(records[0]?.status).toBe('completed');
    }

    const secondSpawn = await system.execute(
      {
        callId: 'agent-spawn-2',
        toolName: 'spawn_agent',
        arguments: JSON.stringify({
          role: 'worker',
          prompt: 'Draft a note',
        }),
      },
      createContext(workspaceDir)
    );

    expect(secondSpawn.success).toBe(true);
    if (!secondSpawn.success) {
      return;
    }

    const secondAgentId = (secondSpawn.structured as SubagentExecutionRecord).agentId;
    const cancelResult = await system.execute(
      {
        callId: 'agent-cancel',
        toolName: 'cancel_agent',
        arguments: JSON.stringify({
          agentId: secondAgentId,
          reason: 'No longer needed',
        }),
      },
      createContext(workspaceDir)
    );

    expect(cancelResult.success).toBe(true);
    if (cancelResult.success) {
      expect((cancelResult.structured as SubagentExecutionRecord).status).toBe('cancelled');
    }
  });

  it('supports legacy-style task_output and task_stop views over subagent executions', async () => {
    const runner = new FakeSubagentRunner();
    const store = new MemorySubagentStore();
    const roles: Record<string, SubagentRole> = {
      worker: {
        name: 'worker',
        description: 'General worker',
        systemPrompt: 'You are a worker.',
        allowedTools: ['read_file'],
        defaultMaxSteps: 4,
      },
    };
    const system = new EnterpriseToolSystem(
      createBuiltInToolHandlersV2({
        roles,
        runner,
        store,
      })
    );

    const spawnResult = await system.execute(
      {
        callId: 'agent-spawn-legacy',
        toolName: 'spawn_agent',
        arguments: JSON.stringify({
          role: 'worker',
          prompt: 'Summarize the repository layout',
          metadata: {
            linkedTaskId: 'task-123',
          },
        }),
      },
      createContext(workspaceDir)
    );

    expect(spawnResult.success).toBe(true);
    if (!spawnResult.success) {
      return;
    }

    const taskOutput = await system.execute(
      {
        callId: 'task-output',
        toolName: 'task_output',
        arguments: JSON.stringify({
          taskId: 'task-123',
          block: false,
        }),
      },
      createContext(workspaceDir)
    );

    expect(taskOutput.success).toBe(true);
    if (taskOutput.success) {
      expect(taskOutput.structured).toMatchObject({
        agentRun: {
          agentId: (spawnResult.structured as SubagentExecutionRecord).agentId,
        },
      });
    }

    const cancellableSpawn = await system.execute(
      {
        callId: 'agent-spawn-legacy-stop',
        toolName: 'spawn_agent',
        arguments: JSON.stringify({
          role: 'worker',
          prompt: 'Draft a follow-up note',
          metadata: {
            linkedTaskId: 'task-456',
          },
        }),
      },
      createContext(workspaceDir)
    );

    expect(cancellableSpawn.success).toBe(true);
    if (!cancellableSpawn.success) {
      return;
    }

    const taskStop = await system.execute(
      {
        callId: 'task-stop',
        toolName: 'task_stop',
        arguments: JSON.stringify({
          taskId: 'task-456',
          reason: 'No longer needed',
        }),
      },
      createContext(workspaceDir)
    );

    expect(taskStop.success).toBe(true);
    if (taskStop.success) {
      expect(taskStop.structured).toMatchObject({
        cancelledTaskIds: ['task-456'],
      });
    }
  });

  it('returns conflict errors when task_stop targets an already terminal subagent run', async () => {
    const runner = new FakeSubagentRunner();
    const store = new MemorySubagentStore();
    const roles: Record<string, SubagentRole> = {
      worker: {
        name: 'worker',
        description: 'General worker',
        systemPrompt: 'You are a worker.',
        allowedTools: ['read_file'],
        defaultMaxSteps: 4,
      },
    };
    const system = new EnterpriseToolSystem(
      createBuiltInToolHandlersV2({
        roles,
        runner,
        store,
      })
    );

    const spawnResult = await system.execute(
      {
        callId: 'agent-spawn-terminal-stop',
        toolName: 'spawn_agent',
        arguments: JSON.stringify({
          role: 'worker',
          prompt: 'Complete immediately',
        }),
      },
      createContext(workspaceDir)
    );

    expect(spawnResult.success).toBe(true);
    if (!spawnResult.success) {
      return;
    }

    const agentId = (spawnResult.structured as SubagentExecutionRecord).agentId;
    const statusResult = await system.execute(
      {
        callId: 'agent-status-terminal-stop',
        toolName: 'agent_status',
        arguments: JSON.stringify({
          agentId,
        }),
      },
      createContext(workspaceDir)
    );

    expect(statusResult.success).toBe(true);

    const taskStop = await system.execute(
      {
        callId: 'task-stop-terminal',
        toolName: 'task_stop',
        arguments: JSON.stringify({
          agentId,
          reason: 'Too late',
        }),
      },
      createContext(workspaceDir)
    );

    expect(taskStop.success).toBe(false);
    if (taskStop.success) {
      return;
    }
    expect(taskStop.error.errorCode).toBe('TOOL_V2_CONFLICT');
    expect(taskStop.error.category).toBe('conflict');
    expect(taskStop.output).toContain('already terminal');
  });

  it('returns abort errors when blocking task_output is cancelled by the parent signal', async () => {
    const runner = new HangingSubagentRunner();
    const store = new MemorySubagentStore();
    const roles: Record<string, SubagentRole> = {
      worker: {
        name: 'worker',
        description: 'General worker',
        systemPrompt: 'You are a worker.',
        allowedTools: ['read_file'],
        defaultMaxSteps: 4,
      },
    };
    const system = new EnterpriseToolSystem(
      createBuiltInToolHandlersV2({
        roles,
        runner,
        store,
      })
    );

    const spawnResult = await system.execute(
      {
        callId: 'agent-spawn-abort-output',
        toolName: 'spawn_agent',
        arguments: JSON.stringify({
          role: 'worker',
          prompt: 'Keep running',
          metadata: {
            linkedTaskId: 'task-abort-output',
          },
        }),
      },
      createContext(workspaceDir)
    );

    expect(spawnResult.success).toBe(true);
    if (!spawnResult.success) {
      return;
    }

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const result = await system.execute(
      {
        callId: 'task-output-aborted',
        toolName: 'task_output',
        arguments: JSON.stringify({
          agentId: (spawnResult.structured as SubagentExecutionRecord).agentId,
          block: true,
          timeoutMs: 1000,
          pollIntervalMs: 20,
        }),
      },
      createContext(workspaceDir, {
        signal: controller.signal,
      })
    );

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }
    expect(result.error.errorCode).toBe('TOOL_V2_ABORTED');
    expect(result.error.category).toBe('abort');
    expect(result.output).toContain('polling aborted');
  });

  it('ships a richer default role matrix aligned with legacy delegation semantics', () => {
    expect(Object.keys(DEFAULT_SUBAGENT_ROLES)).toEqual(
      expect.arrayContaining([
        'Bash',
        'general-purpose',
        'Explore',
        'Restore',
        'Plan',
        'research-agent',
        'find-skills',
      ])
    );
    expect(DEFAULT_SUBAGENT_ROLES['general-purpose']?.allowedTools).toEqual(
      expect.arrayContaining(['file_edit', 'write_file', 'local_shell', 'skill'])
    );
    expect(DEFAULT_SUBAGENT_ROLES['Restore']?.allowedTools).toEqual(
      expect.arrayContaining(['file_history_list', 'file_history_restore'])
    );
    expect(DEFAULT_SUBAGENT_ROLES['find-skills']?.allowedTools).toEqual(
      expect.arrayContaining(['skill', 'local_shell'])
    );
  });

  it('publishes native tool-v2 descriptions for search and shell tools', () => {
    const specs = new EnterpriseToolSystem(createBuiltInToolHandlersV2()).specs();
    const grep = specs.find((spec) => spec.name === 'grep');
    const glob = specs.find((spec) => spec.name === 'glob');
    const shell = specs.find((spec) => spec.name === 'local_shell');

    expect(grep?.description).toContain('ALWAYS use this tool for content search tasks');
    expect(glob?.description).toContain('Fast file pattern matching tool');
    expect(shell?.description).toContain('Execute a shell command with explicit policy');
    expect(shell?.description).toContain('Prefer specialized tools over local_shell');
  });

  it('syncs linked task state on subagent start, completion, and parent abort', async () => {
    const runner = new FakeSubagentRunner();
    const store = new MemorySubagentStore();
    const taskStoreDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'renx-tool-v2-subagent-task-store-')
    );
    const taskStore = new TaskStateStoreV2({ baseDir: taskStoreDir });
    const roles: Record<string, SubagentRole> = {
      worker: {
        name: 'worker',
        description: 'General worker',
        systemPrompt: 'You are a worker.',
        allowedTools: ['read_file'],
        defaultMaxSteps: 4,
      },
    };
    const system = new EnterpriseToolSystem(
      createBuiltInToolHandlersV2({
        roles,
        runner,
        store,
        task: {
          store: taskStore,
        },
      })
    );

    try {
      const created = await system.execute(
        {
          callId: 'task-create-linked',
          toolName: 'task_create',
          arguments: JSON.stringify({
            namespace: 'orchestration',
            subject: 'Investigate worker result',
            description: 'Investigate worker result and update task state via linked subagent.',
          }),
        },
        createContext(workspaceDir)
      );

      expect(created.success).toBe(true);
      if (!created.success) {
        return;
      }
      const taskId = (created.structured as { task: { id: string } }).task.id;

      const spawned = await system.execute(
        {
          callId: 'spawn-linked',
          toolName: 'spawn_agent',
          arguments: JSON.stringify({
            role: 'worker',
            prompt: 'Do linked orchestration work',
            linkedTaskId: taskId,
            taskNamespace: 'orchestration',
          }),
        },
        createContext(workspaceDir)
      );

      expect(spawned.success).toBe(true);
      if (!spawned.success) {
        return;
      }

      const linkedDetail = await system.execute(
        {
          callId: 'task-get-linked-start',
          toolName: 'task_get',
          arguments: JSON.stringify({
            namespace: 'orchestration',
            taskId,
          }),
        },
        createContext(workspaceDir)
      );

      expect(linkedDetail.success).toBe(true);
      if (linkedDetail.success) {
        expect(linkedDetail.structured).toMatchObject({
          task: {
            id: taskId,
            status: 'in_progress',
            owner: `agent:${(spawned.structured as SubagentExecutionRecord).agentId}`,
          },
        });
      }

      const completed = await system.execute(
        {
          callId: 'task-output-linked',
          toolName: 'task_output',
          arguments: JSON.stringify({
            taskId,
            block: true,
            timeoutMs: 500,
          }),
        },
        createContext(workspaceDir)
      );

      expect(completed.success).toBe(true);

      const linkedDone = await system.execute(
        {
          callId: 'task-get-linked-done',
          toolName: 'task_get',
          arguments: JSON.stringify({
            namespace: 'orchestration',
            taskId,
          }),
        },
        createContext(workspaceDir)
      );

      expect(linkedDone.success).toBe(true);
      if (linkedDone.success) {
        expect(linkedDone.structured).toMatchObject({
          task: {
            id: taskId,
            status: 'completed',
          },
        });
      }

      const abortCreated = await system.execute(
        {
          callId: 'task-create-abort',
          toolName: 'task_create',
          arguments: JSON.stringify({
            namespace: 'orchestration',
            subject: 'Abort worker run',
            description: 'Abort worker run and cascade cancellation into linked task.',
          }),
        },
        createContext(workspaceDir)
      );

      expect(abortCreated.success).toBe(true);
      if (!abortCreated.success) {
        return;
      }
      const abortTaskId = (abortCreated.structured as { task: { id: string } }).task.id;
      const controller = new AbortController();
      const events: string[] = [];
      const abortSpawn = await system.execute(
        {
          callId: 'spawn-linked-abort',
          toolName: 'spawn_agent',
          arguments: JSON.stringify({
            role: 'worker',
            prompt: 'Abort linked orchestration work',
            linkedTaskId: abortTaskId,
            taskNamespace: 'orchestration',
          }),
        },
        createContext(workspaceDir, {
          signal: controller.signal,
          emit: async (event) => {
            events.push(`${event.type}:${event.message}`);
          },
        })
      );

      expect(abortSpawn.success).toBe(true);
      controller.abort();
      await waitUntil(async () => {
        const detail = await system.execute(
          {
            callId: 'task-get-linked-abort',
            toolName: 'task_get',
            arguments: JSON.stringify({
              namespace: 'orchestration',
              taskId: abortTaskId,
            }),
          },
          createContext(workspaceDir)
        );
        return (
          detail.success &&
          (detail.structured as { task: { status: string } }).task.status === 'cancelled'
        );
      });

      expect(events.some((event) => event.includes('subagent cancelled by parent abort'))).toBe(
        true
      );
    } finally {
      await fs.rm(taskStoreDir, { recursive: true, force: true });
    }
  });
});

class MemorySubagentStore implements SubagentExecutionStore {
  private readonly records = new Map<string, SubagentExecutionRecord>();

  async get(agentId: string): Promise<SubagentExecutionRecord | null> {
    return this.records.get(agentId) || null;
  }

  async list(): Promise<SubagentExecutionRecord[]> {
    return Array.from(this.records.values());
  }

  async save(record: SubagentExecutionRecord): Promise<SubagentExecutionRecord> {
    this.records.set(record.agentId, record);
    return record;
  }
}

class FakeSubagentRunner implements SubagentRunner {
  private readonly records = new Map<string, SubagentExecutionRecord>();
  private clock = 1_000;

  async start(request: SubagentRunnerStartRequest): Promise<SubagentExecutionRecord> {
    const createdAt = this.nextTimestamp();
    const record: SubagentExecutionRecord = {
      agentId: request.executionId,
      executionId: request.executionId,
      conversationId: request.conversationId,
      role: request.role.name,
      prompt: request.prompt,
      description: request.description,
      status: 'running',
      model: request.model,
      maxSteps: request.maxSteps,
      metadata: request.metadata || {},
      createdAt,
      updatedAt: createdAt,
      startedAt: createdAt,
      version: 1,
    };
    this.records.set(record.agentId, record);
    return record;
  }

  async poll(execution: SubagentExecutionRecord): Promise<SubagentExecutionRecord> {
    const current = this.getCurrent(execution);
    if (current.status !== 'running') {
      return current;
    }
    const completed: SubagentExecutionRecord = {
      ...current,
      status: 'completed',
      output: `completed:${current.prompt}`,
      updatedAt: this.nextTimestamp(),
      endedAt: this.nextTimestamp(),
      version: current.version + 1,
    };
    this.records.set(completed.agentId, completed);
    return completed;
  }

  async cancel(
    execution: SubagentExecutionRecord,
    reason?: string
  ): Promise<SubagentExecutionRecord> {
    const current = this.getCurrent(execution);
    const cancelled: SubagentExecutionRecord = {
      ...current,
      status: 'cancelled',
      error: reason || 'cancelled',
      updatedAt: this.nextTimestamp(),
      endedAt: this.nextTimestamp(),
      version: current.version + 1,
    };
    this.records.set(cancelled.agentId, cancelled);
    return cancelled;
  }

  protected getCurrent(execution: SubagentExecutionRecord): SubagentExecutionRecord {
    return this.records.get(execution.agentId) || execution;
  }

  private nextTimestamp(): number {
    this.clock += 1;
    return this.clock;
  }
}

class HangingSubagentRunner extends FakeSubagentRunner {
  override async poll(execution: SubagentExecutionRecord): Promise<SubagentExecutionRecord> {
    return this.getCurrent(execution);
  }
}

function createContext(
  workspaceDir: string,
  overrides: Partial<ToolExecutionContext> = {}
): ToolExecutionContext {
  return {
    workingDirectory: workspaceDir,
    sessionState: new ToolSessionState(),
    fileSystemPolicy: createWorkspaceFileSystemPolicy(workspaceDir),
    networkPolicy: createRestrictedNetworkPolicy(),
    approvalPolicy: 'on-request',
    approve: async () => ({
      approved: true,
      scope: 'turn',
    }),
    ...overrides,
  };
}

async function waitUntil(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 1000,
  intervalMs = 20
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for condition');
}
