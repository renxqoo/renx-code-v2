import { describe, expect, it, vi } from 'vitest';

import { registerTaskTools, registerWorkspaceTools, resolveToolSchemas } from './tool-catalog';
import type { SourceModules, ToolManagerLike } from './source-modules';

function createToolManager(): ToolManagerLike {
  const schemas: Array<{ type: string; function: { name?: string } }> = [];

  const registerTool: ToolManagerLike['registerTool'] = vi.fn((tool: unknown) => {
    const schema = (
      tool as { toToolSchema?: () => { type: string; function: { name?: string } } }
    ).toToolSchema?.();
    if (schema) {
      schemas.push(schema);
    }
  });

  const registerTools: ToolManagerLike['registerTools'] = vi.fn((tools: Iterable<unknown>) => {
    for (const tool of tools) {
      const schema = (
        tool as { toToolSchema?: () => { type: string; function: { name?: string } } }
      ).toToolSchema?.();
      if (schema) {
        schemas.push(schema);
      }
    }
  });

  return {
    registerTool,
    registerTools,
    getTools: vi.fn(() => []),
    getToolSchemas: vi.fn(() => [...schemas]),
  };
}

function createNamedToolCtor(name: string) {
  return class {
    constructor(_options?: Record<string, unknown>) {}

    toToolSchema() {
      return {
        type: 'function',
        function: {
          name,
        },
      };
    }
  };
}

function createModules(): SourceModules {
  const NamedBashTool = createNamedToolCtor('bash');
  const NamedWriteTool = createNamedToolCtor('write_file');
  const NamedReadTool = createNamedToolCtor('read_file');
  const NamedEditTool = createNamedToolCtor('edit_file');
  const NamedHistoryListTool = createNamedToolCtor('file_history_list');
  const NamedHistoryRestoreTool = createNamedToolCtor('file_history_restore');
  const NamedGlobTool = createNamedToolCtor('glob');
  const NamedGrepTool = createNamedToolCtor('grep');
  const NamedSkillTool = createNamedToolCtor('skill');
  const NamedTaskTool = createNamedToolCtor('task');
  const NamedTaskCreateTool = createNamedToolCtor('task_create');
  const NamedTaskGetTool = createNamedToolCtor('task_get');
  const NamedTaskListTool = createNamedToolCtor('task_list');
  const NamedTaskUpdateTool = createNamedToolCtor('task_update');
  const NamedTaskStopTool = createNamedToolCtor('task_stop');
  const NamedTaskOutputTool = createNamedToolCtor('task_output');

  return {
    repoRoot: 'D:/repo',
    ProviderRegistry: {} as SourceModules['ProviderRegistry'],
    loadEnvFiles: vi.fn() as SourceModules['loadEnvFiles'],
    loadConfigToEnv: vi.fn() as SourceModules['loadConfigToEnv'],
    createLoggerFromEnv: vi.fn() as SourceModules['createLoggerFromEnv'],
    createAgentLoggerAdapter: vi.fn() as SourceModules['createAgentLoggerAdapter'],
    StatelessAgent: vi.fn() as unknown as SourceModules['StatelessAgent'],
    AgentAppService: vi.fn() as unknown as SourceModules['AgentAppService'],
    createSqliteAgentAppStore: vi.fn() as SourceModules['createSqliteAgentAppStore'],
    DefaultToolManager: vi.fn() as unknown as SourceModules['DefaultToolManager'],
    BashTool: NamedBashTool as unknown as SourceModules['BashTool'],
    WriteFileTool: NamedWriteTool as unknown as SourceModules['WriteFileTool'],
    FileReadTool: NamedReadTool as unknown as SourceModules['FileReadTool'],
    FileEditTool: NamedEditTool as unknown as SourceModules['FileEditTool'],
    FileHistoryListTool: NamedHistoryListTool as unknown as SourceModules['FileHistoryListTool'],
    FileHistoryRestoreTool:
      NamedHistoryRestoreTool as unknown as SourceModules['FileHistoryRestoreTool'],
    GlobTool: NamedGlobTool as unknown as SourceModules['GlobTool'],
    GrepTool: NamedGrepTool as unknown as SourceModules['GrepTool'],
    SkillTool: NamedSkillTool as unknown as SourceModules['SkillTool'],
    TaskTool: NamedTaskTool as unknown as SourceModules['TaskTool'],
    TaskCreateTool: NamedTaskCreateTool as unknown as SourceModules['TaskCreateTool'],
    TaskGetTool: NamedTaskGetTool as unknown as SourceModules['TaskGetTool'],
    TaskListTool: NamedTaskListTool as unknown as SourceModules['TaskListTool'],
    TaskUpdateTool: NamedTaskUpdateTool as unknown as SourceModules['TaskUpdateTool'],
    TaskStopTool: NamedTaskStopTool as unknown as SourceModules['TaskStopTool'],
    TaskOutputTool: NamedTaskOutputTool as unknown as SourceModules['TaskOutputTool'],
    TaskStore: vi.fn() as unknown as SourceModules['TaskStore'],
    RealSubagentRunnerAdapter: vi.fn() as unknown as SourceModules['RealSubagentRunnerAdapter'],
  };
}

describe('tool-catalog', () => {
  it('registers workspace tools through one catalog entrypoint', () => {
    const manager = createToolManager();
    const modules = createModules();

    registerWorkspaceTools(manager, modules, 'D:/workspace');

    expect(manager.registerTools).toHaveBeenCalledOnce();
    expect(resolveToolSchemas(manager).map((schema) => schema.function.name)).toEqual([
      'bash',
      'write_file',
      'read_file',
      'edit_file',
      'file_history_list',
      'file_history_restore',
      'glob',
      'grep',
      'skill',
    ]);
  });

  it('filters resolved schemas by allow list and hidden names', () => {
    const manager = createToolManager();
    const modules = createModules();

    registerWorkspaceTools(manager, modules, 'D:/workspace');
    registerTaskTools({
      modules,
      manager,
      taskStore: {},
      taskRunner: {},
      defaultNamespace: 'conv_1',
    });

    const schemas = resolveToolSchemas(manager, {
      allowedTools: ['bash', 'task', 'task_output', 'missing'],
      hiddenToolNames: new Set(['task_output']),
    });

    expect(schemas.map((schema) => schema.function.name)).toEqual(['bash', 'task']);
  });
});
