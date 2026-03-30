export interface ServerConfig {
  readonly port: number;
  readonly host: string;
  readonly stateDir: string;
  readonly workspaceDir: string;
  readonly authToken?: string;
  readonly trustedProxySecret?: string;
  readonly channels: ChannelConfigEntry[];
  readonly model?: {
    readonly provider: string;
    readonly modelId: string;
  };
}

export interface ChannelConfigEntry {
  readonly channelId: string;
  readonly enabled: boolean;
  readonly config: Record<string, unknown>;
}

export function resolveServerConfig(env: Record<string, string | undefined>): ServerConfig {
  return {
    port: parseInt(env.RENX_SERVER_PORT || '3100', 10),
    host: env.RENX_SERVER_HOST || '0.0.0.0',
    stateDir: env.RENX_STATE_DIR || '~/.renx/server',
    workspaceDir: env.RENX_WORKSPACE_DIR || process.cwd(),
    authToken: env.RENX_SERVER_TOKEN,
    trustedProxySecret: env.RENX_TRUSTED_PROXY_SECRET,
    channels: [],
    model: env.RENX_MODEL_ID
      ? { provider: env.RENX_MODEL_PROVIDER || 'openai', modelId: env.RENX_MODEL_ID }
      : undefined,
  };
}
