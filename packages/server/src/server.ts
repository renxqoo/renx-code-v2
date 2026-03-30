import { GatewayRuntime } from './runtime';
import { resolveServerConfig } from './config';

export async function startServer(
  env: Record<string, string | undefined> = process.env as any,
  options?: { onAgentRequest?: (conversationId: string, text: string) => Promise<string> }
): Promise<GatewayRuntime> {
  const config = resolveServerConfig(env);
  const runtime = new GatewayRuntime({
    config,
    onAgentRequest: options?.onAgentRequest,
  });
  await runtime.start();
  return runtime;
}
