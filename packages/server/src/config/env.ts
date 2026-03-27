import { ProviderRegistry } from '@renx-code/core';

import type { ServerAuthMode, ServerConfig, ServerLogLevel, ServerRateLimitConfig } from './schema';

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = 8080;
const DEFAULT_AUTH_MODE: ServerAuthMode = 'token';
const DEFAULT_LOG_LEVEL: ServerLogLevel = 'info';
const DEFAULT_PROXY_USER_HEADER = 'x-forwarded-user';
const DEFAULT_MODEL_ID = 'glm-4.7';

export function parseServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const host = (env.RENX_SERVER_HOST || DEFAULT_HOST).trim();
  const port = parsePort(env.RENX_SERVER_PORT, DEFAULT_PORT);
  const authMode = parseAuthMode(env.RENX_GATEWAY_AUTH_MODE || DEFAULT_AUTH_MODE);
  const token = env.RENX_SERVER_TOKEN?.trim() || undefined;
  const stateDir = requiredPath(env.RENX_STATE_DIR, 'RENX_STATE_DIR');
  const workspaceDir = requiredPath(env.RENX_WORKSPACE_DIR, 'RENX_WORKSPACE_DIR');
  const enableOpenAiCompat = parseBoolean(env.RENX_ENABLE_OPENAI_COMPAT, true);
  const logLevel = parseLogLevel(env.RENX_LOG_LEVEL || DEFAULT_LOG_LEVEL);
  const modelId = resolveModelId(env.RENX_MODEL_ID || env.AGENT_MODEL);
  const trustedProxyIps = splitCsv(env.RENX_TRUSTED_PROXY_IPS);
  const trustedProxyUserHeader =
    env.RENX_TRUSTED_PROXY_USER_HEADER?.trim().toLowerCase() || DEFAULT_PROXY_USER_HEADER;
  const rateLimit = parseRateLimitConfig(env);

  if (authMode === 'token' && !token) {
    throw new Error('RENX_SERVER_TOKEN is required when RENX_GATEWAY_AUTH_MODE=token');
  }
  if (authMode === 'trusted-proxy' && trustedProxyIps.length === 0) {
    throw new Error('RENX_TRUSTED_PROXY_IPS is required when RENX_GATEWAY_AUTH_MODE=trusted-proxy');
  }

  return {
    host,
    port,
    authMode,
    token,
    stateDir,
    workspaceDir,
    enableOpenAiCompat,
    logLevel,
    modelId,
    trustedProxyIps,
    trustedProxyUserHeader,
    rateLimit,
  };
}

function parsePort(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid RENX_SERVER_PORT: ${raw}`);
  }
  return parsed;
}

function parseAuthMode(raw: string): ServerAuthMode {
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'none' || normalized === 'token' || normalized === 'trusted-proxy') {
    return normalized;
  }
  throw new Error(`Invalid RENX_GATEWAY_AUTH_MODE: ${raw}`);
}

function parseLogLevel(raw: string): ServerLogLevel {
  const normalized = raw.trim().toLowerCase();
  if (
    normalized === 'debug' ||
    normalized === 'info' ||
    normalized === 'warn' ||
    normalized === 'error'
  ) {
    return normalized;
  }
  throw new Error(`Invalid RENX_LOG_LEVEL: ${raw}`);
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw?.trim()) {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  throw new Error(`Invalid boolean value: ${raw}`);
}

function requiredPath(raw: string | undefined, envName: string): string {
  const normalized = raw?.trim();
  if (!normalized) {
    throw new Error(`${envName} is required`);
  }
  return normalized;
}

function splitCsv(raw: string | undefined): string[] {
  return (raw || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function resolveModelId(requested: string | undefined): string {
  const modelIds = ProviderRegistry.getModelIds();
  if (modelIds.length === 0) {
    throw new Error('No models are registered in ProviderRegistry.');
  }

  const normalized = requested?.trim();
  if (normalized) {
    if (!modelIds.includes(normalized)) {
      throw new Error(`Unknown model: ${normalized}`);
    }
    return normalized;
  }

  if (modelIds.includes(DEFAULT_MODEL_ID)) {
    return DEFAULT_MODEL_ID;
  }

  return modelIds[0];
}

function parseRateLimitConfig(env: NodeJS.ProcessEnv): ServerRateLimitConfig | undefined {
  const maxRequestsRaw = env.RENX_RATE_LIMIT_MAX_REQUESTS?.trim();
  const windowMsRaw = env.RENX_RATE_LIMIT_WINDOW_MS?.trim();

  if (!maxRequestsRaw && !windowMsRaw) {
    return undefined;
  }

  if (!maxRequestsRaw || !windowMsRaw) {
    throw new Error(
      'RENX_RATE_LIMIT_MAX_REQUESTS and RENX_RATE_LIMIT_WINDOW_MS must both be set to enable rate limiting'
    );
  }

  return {
    maxRequests: parsePositiveInteger(maxRequestsRaw, 'RENX_RATE_LIMIT_MAX_REQUESTS'),
    windowMs: parsePositiveInteger(windowMsRaw, 'RENX_RATE_LIMIT_WINDOW_MS'),
  };
}

function parsePositiveInteger(raw: string, envName: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${envName}: ${raw}`);
  }
  return parsed;
}
