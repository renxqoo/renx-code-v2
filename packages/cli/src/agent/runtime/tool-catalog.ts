import type { SourceModules, ToolManagerLike } from './source-modules';

type ToolSchema = {
  type: string;
  function: {
    name?: string;
    [key: string]: unknown;
  };
};

type TaskToolRegistrationOptions = {
  modules: SourceModules;
  manager: ToolManagerLike;
  taskStore: unknown;
  taskRunner: unknown;
  defaultNamespace: string;
};

export function registerWorkspaceTools(
  manager: ToolManagerLike,
  modules: SourceModules,
  workspaceRoot: string
): void {
  manager.registerTools([
    new modules.BashTool(),
    new modules.WriteFileTool({
      allowedDirectories: [workspaceRoot],
    }),
    new modules.FileReadTool({
      allowedDirectories: [workspaceRoot],
    }),
    new modules.FileEditTool({
      allowedDirectories: [workspaceRoot],
    }),
    new modules.FileHistoryListTool({
      allowedDirectories: [workspaceRoot],
    }),
    new modules.FileHistoryRestoreTool({
      allowedDirectories: [workspaceRoot],
    }),
    new modules.GlobTool({
      allowedDirectories: [workspaceRoot],
    }),
    new modules.GrepTool({
      allowedDirectories: [workspaceRoot],
    }),
    new modules.SkillTool({
      loaderOptions: {
        workingDir: workspaceRoot,
      },
    }),
  ]);
}

export function registerTaskTools({
  modules,
  manager,
  taskStore,
  taskRunner,
  defaultNamespace,
}: TaskToolRegistrationOptions): void {
  manager.registerTools([
    new modules.TaskCreateTool({
      store: taskStore,
      defaultNamespace,
    }),
    new modules.TaskGetTool({
      store: taskStore,
      defaultNamespace,
    }),
    new modules.TaskListTool({
      store: taskStore,
      defaultNamespace,
    }),
    new modules.TaskUpdateTool({
      store: taskStore,
      defaultNamespace,
    }),
    new modules.TaskTool({
      store: taskStore,
      runner: taskRunner,
      defaultNamespace,
    }),
    new modules.TaskStopTool({
      store: taskStore,
      runner: taskRunner,
      defaultNamespace,
    }),
    new modules.TaskOutputTool({
      store: taskStore,
      runner: taskRunner,
      defaultNamespace,
    }),
  ]);
}

export function resolveToolSchemas(
  manager: ToolManagerLike,
  options?: {
    allowedTools?: string[];
    hiddenToolNames?: Set<string>;
  }
): ToolSchema[] {
  const hiddenToolNames = options?.hiddenToolNames;
  const allowedTools = options?.allowedTools;

  const visibleSchemas = manager.getToolSchemas().filter((schema) => {
    const name = schema.function?.name;
    return typeof name === 'string' && !hiddenToolNames?.has(name);
  });

  if (!allowedTools || allowedTools.length === 0) {
    return visibleSchemas;
  }

  const allowed = new Set(allowedTools);
  return visibleSchemas.filter((schema) => {
    const name = schema.function?.name;
    return typeof name === 'string' && allowed.has(name);
  });
}
