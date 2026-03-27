import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';

import { authorizeGatewayRequest } from './auth';
import type { ServerConfig } from '../config/schema';

function createRequest(input: {
  headers?: Record<string, string | undefined>;
  remoteAddress?: string;
}): IncomingMessage {
  return {
    headers: input.headers ?? {},
    socket: {
      remoteAddress: input.remoteAddress ?? '127.0.0.1',
    },
  } as IncomingMessage;
}

function createConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 8080,
    authMode: 'token',
    token: 'secret',
    stateDir: '/tmp/state',
    workspaceDir: '/tmp/workspace',
    enableOpenAiCompat: true,
    logLevel: 'info',
    modelId: 'glm-4.7',
    trustedProxyIps: ['127.0.0.1'],
    trustedProxyUserHeader: 'x-forwarded-user',
    ...overrides,
  };
}

describe('authorizeGatewayRequest', () => {
  it('allows requests in none mode', () => {
    const result = authorizeGatewayRequest(createRequest({}), createConfig({ authMode: 'none' }));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('expected authorization to pass');
    }
    expect(result.principal.principalId).toBe('local-operator');
    expect(result.principal.source).toBe('api');
  });

  it('rejects missing bearer token in token mode', () => {
    const result = authorizeGatewayRequest(createRequest({}), createConfig());

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected authorization to fail');
    }
    expect(result.statusCode).toBe(401);
  });

  it('allows matching bearer token in token mode', () => {
    const result = authorizeGatewayRequest(
      createRequest({ headers: { authorization: 'Bearer secret' } }),
      createConfig()
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('expected authorization to pass');
    }
    expect(result.principal.principalId).toBe('operator');
  });

  it('extracts proxy user when trusted proxy auth succeeds', () => {
    const result = authorizeGatewayRequest(
      createRequest({
        headers: { 'x-forwarded-user': 'alice' },
        remoteAddress: '127.0.0.1',
      }),
      createConfig({ authMode: 'trusted-proxy', token: undefined })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error('expected authorization to pass');
    }
    expect(result.principal.principalId).toBe('alice');
  });
});
