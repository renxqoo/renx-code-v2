export type ServerAuthMode = 'none' | 'token' | 'trusted-proxy';
export type ServerLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ServerRateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface ServerConfig {
  host: string;
  port: number;
  authMode: ServerAuthMode;
  token?: string;
  stateDir: string;
  workspaceDir: string;
  enableOpenAiCompat: boolean;
  logLevel: ServerLogLevel;
  modelId: string;
  trustedProxyIps: string[];
  trustedProxyUserHeader: string;
  rateLimit?: ServerRateLimitConfig;
}
