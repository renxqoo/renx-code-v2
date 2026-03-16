import type { ToolExecutionContext } from './context';
import type { ToolCallRequest, ToolCallResult, ToolSpec } from './contracts';
import { ToolOrchestrator } from './orchestrator';
import { ToolRegistry, type ToolHandler } from './registry';
import { ToolRouter } from './router';

export class EnterpriseToolSystem {
  readonly registry: ToolRegistry;
  private readonly router: ToolRouter;
  private readonly orchestrator: ToolOrchestrator;

  constructor(handlers: Iterable<ToolHandler>) {
    this.registry = new ToolRegistry().registerAll(handlers);
    this.router = new ToolRouter(this.registry);
    this.orchestrator = new ToolOrchestrator(this.router);
  }

  specs(): ToolSpec[] {
    return this.registry.specs();
  }

  async execute(call: ToolCallRequest, context: ToolExecutionContext): Promise<ToolCallResult> {
    return this.orchestrator.execute(call, context);
  }
}
