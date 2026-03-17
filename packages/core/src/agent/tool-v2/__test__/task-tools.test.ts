import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthorizationService } from '../../auth/authorization-service';
import { createSystemPrincipal } from '../../auth/principal';
import { ToolSessionState, type ToolExecutionContext } from '../context';
import { createBuiltInToolHandlersV2 } from '../builtins';
import { createRestrictedNetworkPolicy, createWorkspaceFileSystemPolicy } from '../permissions';
import { TaskStateStoreV2 } from '../task-store';
import { EnterpriseToolSystem } from '../tool-system';

describe('tool-v2 task tools', () => {
  let workspaceDir: string;
  let taskStoreDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-tool-v2-task-workspace-'));
    taskStoreDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-tool-v2-task-store-'));
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { recursive: true, force: true });
    await fs.rm(taskStoreDir, { recursive: true, force: true });
  });

  it('registers and executes native task lifecycle tools', async () => {
    const store = new TaskStateStoreV2({ baseDir: taskStoreDir });
    const system = new EnterpriseToolSystem(
      createBuiltInToolHandlersV2({
        task: {
          store,
        },
      })
    );

    expect(system.specs().some((spec) => spec.name === 'task_create')).toBe(true);
    expect(system.specs().some((spec) => spec.name === 'task_get')).toBe(true);
    expect(system.specs().some((spec) => spec.name === 'task_graph')).toBe(true);
    expect(system.specs().some((spec) => spec.name === 'task_list')).toBe(true);
    expect(system.specs().some((spec) => spec.name === 'task_update')).toBe(true);

    const created = await system.execute(
      {
        toolCallId: 'task-create',
        toolName: 'task_create',
        arguments: JSON.stringify({
          namespace: 'alpha',
          subject: 'Implement task tool v2',
          description: 'Implement task tool v2 with native handlers and tests.',
          priority: 'high',
        }),
      },
      createContext(workspaceDir)
    );

    expect(created.success).toBe(true);
    if (!created.success) {
      return;
    }

    const createdTaskId = (created.structured as { task: { id: string } }).task.id;

    const updated = await system.execute(
      {
        toolCallId: 'task-update',
        toolName: 'task_update',
        arguments: JSON.stringify({
          namespace: 'alpha',
          taskId: createdTaskId,
          status: 'in_progress',
          owner: 'main-agent',
          updatedBy: 'test',
        }),
      },
      createContext(workspaceDir)
    );

    expect(updated.success).toBe(true);
    if (updated.success) {
      expect(updated.structured).toMatchObject({
        task: {
          id: createdTaskId,
          status: 'in_progress',
          owner: 'main-agent',
        },
      });
    }

    const detail = await system.execute(
      {
        toolCallId: 'task-get',
        toolName: 'task_get',
        arguments: JSON.stringify({
          namespace: 'alpha',
          taskId: createdTaskId,
          includeHistory: true,
        }),
      },
      createContext(workspaceDir)
    );

    expect(detail.success).toBe(true);
    if (detail.success) {
      expect(detail.structured).toMatchObject({
        task: {
          id: createdTaskId,
          status: 'in_progress',
          canStart: {
            canStart: false,
          },
        },
      });
    }

    const listed = await system.execute(
      {
        toolCallId: 'task-list',
        toolName: 'task_list',
        arguments: JSON.stringify({
          namespace: 'alpha',
        }),
      },
      createContext(workspaceDir)
    );

    expect(listed.success).toBe(true);
    if (listed.success) {
      expect(listed.structured).toMatchObject({
        namespace: 'alpha',
        total: 1,
        tasks: [
          {
            id: createdTaskId,
            status: 'in_progress',
          },
        ],
      });
    }
  });

  it('preserves duplicate-subject conflict semantics', async () => {
    const store = new TaskStateStoreV2({ baseDir: taskStoreDir });
    const system = new EnterpriseToolSystem(
      createBuiltInToolHandlersV2({
        task: {
          store,
        },
      })
    );

    await system.execute(
      {
        toolCallId: 'task-create-1',
        toolName: 'task_create',
        arguments: JSON.stringify({
          namespace: 'beta',
          subject: 'Same subject',
          description: 'First task for duplicate subject coverage in tool-v2.',
        }),
      },
      createContext(workspaceDir)
    );

    const duplicate = await system.execute(
      {
        toolCallId: 'task-create-2',
        toolName: 'task_create',
        arguments: JSON.stringify({
          namespace: 'beta',
          subject: 'Same subject',
          description: 'Second task for duplicate subject coverage in tool-v2.',
        }),
      },
      createContext(workspaceDir)
    );

    expect(duplicate.success).toBe(false);
    if (!duplicate.success) {
      expect(duplicate.error.errorCode).toBe('TASK_DUPLICATE_SUBJECT');
    }
  });

  it('detects dependency cycles and keeps list ranking semantics', async () => {
    const store = new TaskStateStoreV2({ baseDir: taskStoreDir });
    const system = new EnterpriseToolSystem(
      createBuiltInToolHandlersV2({
        task: {
          store,
        },
      })
    );

    const critical = await system.execute(
      {
        toolCallId: 'task-create-critical',
        toolName: 'task_create',
        arguments: JSON.stringify({
          namespace: 'gamma',
          subject: 'Emergency fix',
          description: 'Emergency fix with clear operational urgency and acceptance criteria.',
          priority: 'critical',
        }),
      },
      createContext(workspaceDir)
    );
    const taskA = await system.execute(
      {
        toolCallId: 'task-create-a',
        toolName: 'task_create',
        arguments: JSON.stringify({
          namespace: 'gamma',
          subject: 'Prepare design',
          description: 'Prepare design details for the dependent implementation task.',
        }),
      },
      createContext(workspaceDir)
    );
    const taskB = await system.execute(
      {
        toolCallId: 'task-create-b',
        toolName: 'task_create',
        arguments: JSON.stringify({
          namespace: 'gamma',
          subject: 'Implement design',
          description: 'Implement design details after the preparation task is completed.',
        }),
      },
      createContext(workspaceDir)
    );

    expect(critical.success).toBe(true);
    expect(taskA.success).toBe(true);
    expect(taskB.success).toBe(true);
    if (!critical.success || !taskA.success || !taskB.success) {
      return;
    }

    const criticalId = (critical.structured as { task: { id: string } }).task.id;
    const taskAId = (taskA.structured as { task: { id: string } }).task.id;
    const taskBId = (taskB.structured as { task: { id: string } }).task.id;

    const dependency = await system.execute(
      {
        toolCallId: 'task-dependency',
        toolName: 'task_update',
        arguments: JSON.stringify({
          namespace: 'gamma',
          taskId: taskBId,
          addBlockedBy: [taskAId],
        }),
      },
      createContext(workspaceDir)
    );

    expect(dependency.success).toBe(true);

    const cycle = await system.execute(
      {
        toolCallId: 'task-cycle',
        toolName: 'task_update',
        arguments: JSON.stringify({
          namespace: 'gamma',
          taskId: taskAId,
          addBlockedBy: [taskBId],
        }),
      },
      createContext(workspaceDir)
    );

    expect(cycle.success).toBe(false);
    if (!cycle.success) {
      expect(cycle.error.errorCode).toBe('TASK_CYCLE_DEPENDENCY');
    }

    const list = await system.execute(
      {
        toolCallId: 'task-list-gamma',
        toolName: 'task_list',
        arguments: JSON.stringify({
          namespace: 'gamma',
        }),
      },
      createContext(workspaceDir)
    );

    expect(list.success).toBe(true);
    if (list.success) {
      expect((list.structured as { tasks: Array<{ id: string }> }).tasks[0]?.id).toBe(criticalId);
    }
  });

  it('projects ready tasks and transitive graph relationships', async () => {
    const store = new TaskStateStoreV2({ baseDir: taskStoreDir });
    const system = new EnterpriseToolSystem(
      createBuiltInToolHandlersV2({
        task: {
          store,
        },
      })
    );

    const taskA = await system.execute(
      {
        toolCallId: 'task-graph-a',
        toolName: 'task_create',
        arguments: JSON.stringify({
          namespace: 'graph',
          subject: 'Prepare schema',
          description: 'Prepare schema and design contracts for implementation.',
        }),
      },
      createContext(workspaceDir)
    );
    const taskB = await system.execute(
      {
        toolCallId: 'task-graph-b',
        toolName: 'task_create',
        arguments: JSON.stringify({
          namespace: 'graph',
          subject: 'Implement service',
          description: 'Implement service after schema preparation is complete.',
        }),
      },
      createContext(workspaceDir)
    );
    const taskC = await system.execute(
      {
        toolCallId: 'task-graph-c',
        toolName: 'task_create',
        arguments: JSON.stringify({
          namespace: 'graph',
          subject: 'Write tests',
          description: 'Write tests after implementation is complete.',
        }),
      },
      createContext(workspaceDir)
    );

    expect(taskA.success).toBe(true);
    expect(taskB.success).toBe(true);
    expect(taskC.success).toBe(true);
    if (!taskA.success || !taskB.success || !taskC.success) {
      return;
    }

    const taskAId = (taskA.structured as { task: { id: string } }).task.id;
    const taskBId = (taskB.structured as { task: { id: string } }).task.id;
    const taskCId = (taskC.structured as { task: { id: string } }).task.id;

    await system.execute(
      {
        toolCallId: 'task-graph-link-b',
        toolName: 'task_update',
        arguments: JSON.stringify({
          namespace: 'graph',
          taskId: taskBId,
          addBlockedBy: [taskAId],
        }),
      },
      createContext(workspaceDir)
    );
    await system.execute(
      {
        toolCallId: 'task-graph-link-c',
        toolName: 'task_update',
        arguments: JSON.stringify({
          namespace: 'graph',
          taskId: taskCId,
          addBlockedBy: [taskBId],
        }),
      },
      createContext(workspaceDir)
    );

    const summary = await system.execute(
      {
        toolCallId: 'task-graph-summary',
        toolName: 'task_graph',
        arguments: JSON.stringify({
          namespace: 'graph',
        }),
      },
      createContext(workspaceDir)
    );

    expect(summary.success).toBe(true);
    if (summary.success) {
      expect(summary.structured).toMatchObject({
        summary: {
          taskCount: 3,
          edgeCount: 2,
          readyCount: 1,
        },
        readyTasks: [expect.objectContaining({ id: taskAId })],
      });
    }

    const focused = await system.execute(
      {
        toolCallId: 'task-graph-focused',
        toolName: 'task_graph',
        arguments: JSON.stringify({
          namespace: 'graph',
          taskId: taskBId,
          includeTransitive: true,
        }),
      },
      createContext(workspaceDir)
    );

    expect(focused.success).toBe(true);
    if (focused.success) {
      expect(focused.structured).toMatchObject({
        task: {
          id: taskBId,
        },
        blockers: [expect.objectContaining({ id: taskAId })],
        dependents: [expect.objectContaining({ id: taskCId })],
        upstream: [expect.objectContaining({ id: taskAId })],
        downstream: [expect.objectContaining({ id: taskCId })],
      });
    }
  });
});

function createContext(
  workspaceDir: string,
  overrides: Partial<Omit<ToolExecutionContext, 'authorization'>> & {
    approve?: ToolExecutionContext['authorization']['requestApproval'];
    requestPermissions?: ToolExecutionContext['authorization']['requestPermissions'];
    onPolicyCheck?: ToolExecutionContext['authorization']['evaluatePolicy'];
  } = {}
): ToolExecutionContext {
  const { approve, requestPermissions, onPolicyCheck, ...contextOverrides } = overrides;
  return {
    workingDirectory: workspaceDir,
    sessionState: new ToolSessionState(),
    authorization: {
      service: new AuthorizationService(),
      principal: createSystemPrincipal('tool-v2-task-tools-test'),
      requestApproval:
        approve ||
        (async () => ({
          approved: true,
          scope: 'turn',
        })),
      requestPermissions,
      evaluatePolicy: onPolicyCheck,
    },
    fileSystemPolicy: createWorkspaceFileSystemPolicy(workspaceDir),
    networkPolicy: createRestrictedNetworkPolicy(),
    approvalPolicy: 'on-request',
    ...contextOverrides,
  };
}
