import type { ToolCallRequest } from './contracts';
import { ToolRegistry } from './registry';

export interface RoutedToolCall {
  readonly callId: string;
  readonly toolName: string;
  readonly arguments: string;
  readonly handler: ReturnType<ToolRegistry['get']>;
}

export class ToolRouter {
  constructor(private readonly registry: ToolRegistry) {}

  route(call: ToolCallRequest): RoutedToolCall {
    return {
      callId: call.callId,
      toolName: call.toolName,
      arguments: call.arguments,
      handler: this.registry.get(call.toolName),
    };
  }
}
