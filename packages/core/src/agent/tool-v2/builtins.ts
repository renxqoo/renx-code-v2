import type { ToolHandler } from './registry';
import { DEFAULT_SUBAGENT_ROLES } from './agent-roles';
import { SubagentPlatform } from './agent-runner';
import type { SubagentToolFactoryOptions } from './agent-contracts';
import {
  FileShellBackgroundExecutionStore,
  ShellBackgroundExecutionService,
  type ShellBackgroundExecutionStore,
} from './shell-background';
import { AgentStatusToolV2 } from './handlers/agent-status';
import { CancelAgentToolV2 } from './handlers/cancel-agent';
import { FileEditToolV2 } from './handlers/file-edit';
import { FileHistoryListToolV2 } from './handlers/file-history-list';
import { FileHistoryRestoreToolV2 } from './handlers/file-history-restore';
import { LspToolV2 } from './handlers/lsp';
import { LocalProcessShellRuntime } from './runtimes/shell-runtime';
import { LocalShellToolV2, type LocalShellToolV2Options } from './handlers/shell';
import { ReadFileToolV2 } from './handlers/read-file';
import { RequestPermissionsToolV2 } from './handlers/request-permissions';
import { SpawnAgentToolV2 } from './handlers/spawn-agent';
import { TaskCreateToolV2, type TaskToolV2Options } from './handlers/task-create';
import { TaskGraphToolV2 } from './handlers/task-graph';
import { TaskGetToolV2 } from './handlers/task-get';
import { TaskListToolV2 } from './handlers/task-list';
import { TaskOutputToolV2 } from './handlers/task-output';
import { TaskStopToolV2 } from './handlers/task-stop';
import { TaskUpdateToolV2 } from './handlers/task-update';
import { WaitAgentsToolV2 } from './handlers/wait-agents';
import { SkillToolV2, type SkillToolV2Options } from './handlers/skill';
import { WebFetchToolV2 } from './handlers/web-fetch';
import { WriteFileToolV2 } from './handlers/write-file';
import { getTaskStateStoreV2 } from './task-store';
import { OpenClawWeixinTool } from './handlers/openclaw-weixin';
export interface CreateBuiltInToolHandlersV2Options extends Partial<SubagentToolFactoryOptions> {
  readonly shell?: LocalShellToolV2Options;
  readonly skill?: SkillToolV2Options;
  readonly task?: TaskToolV2Options;
  readonly shellBackgroundStore?: ShellBackgroundExecutionStore;
}

export function createBuiltInToolHandlersV2(
  options?: CreateBuiltInToolHandlersV2Options
): ToolHandler[] {
  const taskStore = options?.task?.store || getTaskStateStoreV2();
  const shellRuntime = options?.shell?.runtime || new LocalProcessShellRuntime();
  const shellBackgrounds = new ShellBackgroundExecutionService(
    shellRuntime,
    options?.shellBackgroundStore || new FileShellBackgroundExecutionStore()
  );
  const handlers: ToolHandler[] = [
    new ReadFileToolV2(),
    new FileEditToolV2(),
    new OpenClawWeixinTool(),
    new FileHistoryListToolV2(),
    new FileHistoryRestoreToolV2(),
    new LspToolV2(),
    new WriteFileToolV2(),
    new WebFetchToolV2(),
    new SkillToolV2(options?.skill),
    new RequestPermissionsToolV2(),
    new LocalShellToolV2({
      ...(options?.shell || {}),
      runtime: shellRuntime,
      backgroundService: shellBackgrounds,
    }),
    new TaskOutputToolV2(undefined, undefined, shellBackgrounds, taskStore),
    new TaskStopToolV2(undefined, undefined, shellBackgrounds, taskStore),
    new TaskCreateToolV2({
      ...(options?.task || {}),
      store: taskStore,
    }),
    new TaskGetToolV2({
      ...(options?.task || {}),
      store: taskStore,
    }),
    new TaskGraphToolV2({
      ...(options?.task || {}),
      store: taskStore,
    }),
    new TaskListToolV2({
      ...(options?.task || {}),
      store: taskStore,
    }),
    new TaskUpdateToolV2({
      ...(options?.task || {}),
      store: taskStore,
    }),
  ];

  if (options?.runner && options?.store) {
    const platform = new SubagentPlatform({
      roles: options.roles || DEFAULT_SUBAGENT_ROLES,
      runner: options.runner,
      store: options.store,
      now: options.now,
    });
    handlers.push(
      new SpawnAgentToolV2(platform, taskStore),
      new AgentStatusToolV2(platform),
      new WaitAgentsToolV2(platform),
      new CancelAgentToolV2(platform),
      new TaskOutputToolV2(platform, options.store, shellBackgrounds, taskStore),
      new TaskStopToolV2(platform, options.store, shellBackgrounds, taskStore)
    );
  }

  return handlers;
}
