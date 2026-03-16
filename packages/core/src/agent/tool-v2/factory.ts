import type { Tool } from '../../providers';
import { RealSubagentRunnerV2, type RealSubagentRunnerV2Options } from './agent-real-runner';
import { DEFAULT_SUBAGENT_ROLES } from './agent-roles';
import type { SubagentRole, SubagentToolFactoryOptions } from './agent-contracts';
import { FileSubagentExecutionStore, type FileSubagentExecutionStoreOptions } from './agent-store';
import { createBuiltInToolHandlersV2, type CreateBuiltInToolHandlersV2Options } from './builtins';
import type { ToolHandler } from './registry';
import { EnterpriseToolSystem } from './tool-system';

export interface CreateToolSystemV2Options {
  readonly additionalHandlers?: ToolHandler[];
  readonly builtIns?: Omit<CreateBuiltInToolHandlersV2Options, keyof SubagentToolFactoryOptions>;
}

export interface CreateToolSystemV2WithSubagentsOptions extends CreateToolSystemV2Options {
  readonly appService: RealSubagentRunnerV2Options['appService'];
  readonly resolveTools?: (toolNames: string[]) => Tool[] | undefined;
  readonly resolveModelId?: (model?: string) => string | undefined;
  readonly roles?: Record<string, SubagentRole>;
  readonly store?: SubagentToolFactoryOptions['store'];
  readonly storeOptions?: FileSubagentExecutionStoreOptions;
  readonly now?: () => number;
}

export function createEnterpriseToolSystemV2(
  options: CreateToolSystemV2Options = {}
): EnterpriseToolSystem {
  const handlers = [
    ...createBuiltInToolHandlersV2(options.builtIns),
    ...(options.additionalHandlers || []),
  ];
  return new EnterpriseToolSystem(handlers);
}

export function createEnterpriseToolSystemV2WithSubagents(
  options: CreateToolSystemV2WithSubagentsOptions
): EnterpriseToolSystem {
  const store =
    options.store ||
    new FileSubagentExecutionStore({
      ...options.storeOptions,
    });
  const runner = new RealSubagentRunnerV2({
    appService: options.appService,
    resolveTools: options.resolveTools,
    resolveModelId: options.resolveModelId,
    now: options.now,
  });

  const handlers = [
    ...createBuiltInToolHandlersV2({
      ...(options.builtIns || {}),
      roles: options.roles || DEFAULT_SUBAGENT_ROLES,
      runner,
      store,
      now: options.now,
    }),
    ...(options.additionalHandlers || []),
  ];

  return new EnterpriseToolSystem(handlers);
}
