import { z } from 'zod';
import type { ToolExecutionContext } from './context';
import type { ToolExecutionPlan, ToolHandlerResult, ToolSpec } from './contracts';
import { ToolV2ArgumentsError, ToolV2NotFoundError } from './errors';
import { zodToJsonSchema } from './schema';

export interface ToolHandler<TArgs = unknown> {
  readonly spec: ToolSpec;
  parseArguments(rawArguments: string): TArgs;
  plan(args: TArgs, context: ToolExecutionContext): ToolExecutionPlan;
  execute(args: TArgs, context: ToolExecutionContext): Promise<ToolHandlerResult>;
}

export abstract class StructuredToolHandler<TSchema extends z.ZodTypeAny> implements ToolHandler<
  z.infer<TSchema>
> {
  readonly spec: ToolSpec;
  protected readonly schema: TSchema;

  constructor(options: {
    name: string;
    description: string;
    schema: TSchema;
    supportsParallel?: boolean;
    mutating?: boolean;
    tags?: string[];
    outputSchema?: Record<string, unknown>;
  }) {
    this.schema = options.schema;
    this.spec = {
      name: options.name,
      description: options.description,
      inputSchema: zodToJsonSchema(options.schema),
      outputSchema: options.outputSchema,
      supportsParallel: options.supportsParallel ?? false,
      mutating: options.mutating ?? false,
      tags: options.tags,
    };
  }

  parseArguments(rawArguments: string): z.infer<TSchema> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawArguments);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ToolV2ArgumentsError(this.spec.name, message);
    }

    const result = this.schema.safeParse(parsed);
    if (!result.success) {
      const message = result.error.issues.map((issue) => issue.message).join(', ');
      throw new ToolV2ArgumentsError(this.spec.name, message);
    }

    return result.data;
  }

  abstract plan(args: z.infer<TSchema>, context: ToolExecutionContext): ToolExecutionPlan;

  abstract execute(
    args: z.infer<TSchema>,
    context: ToolExecutionContext
  ): Promise<ToolHandlerResult>;
}

export class ToolRegistry {
  private readonly handlers = new Map<string, ToolHandler>();

  register(handler: ToolHandler): this {
    this.handlers.set(handler.spec.name, handler);
    return this;
  }

  registerAll(handlers: Iterable<ToolHandler>): this {
    for (const handler of handlers) {
      this.register(handler);
    }
    return this;
  }

  get(toolName: string): ToolHandler {
    const handler = this.handlers.get(toolName);
    if (!handler) {
      throw new ToolV2NotFoundError(toolName);
    }
    return handler;
  }

  specs(): ToolSpec[] {
    return Array.from(this.handlers.values()).map((handler) => handler.spec);
  }
}
