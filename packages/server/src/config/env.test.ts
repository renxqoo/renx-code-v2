import { describe, expect, it } from 'vitest';

import { parseServerConfig } from './env';

describe('parseServerConfig', () => {
  it('applies defaults for a local server', () => {
    const config = parseServerConfig({
      RENX_STATE_DIR: '/tmp/state',
      RENX_WORKSPACE_DIR: '/tmp/workspace',
      RENX_SERVER_TOKEN: 'secret',
    });

    expect(config.host).toBe('0.0.0.0');
    expect(config.port).toBe(8080);
    expect(config.authMode).toBe('token');
    expect(config.enableOpenAiCompat).toBe(true);
    expect(config.logLevel).toBe('info');
    expect(config.modelId).toBeDefined();
  });

  it('requires a token in token mode', () => {
    expect(() =>
      parseServerConfig({
        RENX_STATE_DIR: '/tmp/state',
        RENX_WORKSPACE_DIR: '/tmp/workspace',
        RENX_GATEWAY_AUTH_MODE: 'token',
      })
    ).toThrow(/RENX_SERVER_TOKEN/);
  });

  it('parses trusted proxy settings', () => {
    const config = parseServerConfig({
      RENX_STATE_DIR: '/tmp/state',
      RENX_WORKSPACE_DIR: '/tmp/workspace',
      RENX_GATEWAY_AUTH_MODE: 'trusted-proxy',
      RENX_TRUSTED_PROXY_IPS: '127.0.0.1,::1',
      RENX_TRUSTED_PROXY_USER_HEADER: 'x-forwarded-user',
    });

    expect(config.authMode).toBe('trusted-proxy');
    expect(config.trustedProxyIps).toEqual(['127.0.0.1', '::1']);
    expect(config.trustedProxyUserHeader).toBe('x-forwarded-user');
  });

  it('parses request rate limit settings', () => {
    const config = parseServerConfig({
      RENX_STATE_DIR: '/tmp/state',
      RENX_WORKSPACE_DIR: '/tmp/workspace',
      RENX_SERVER_TOKEN: 'secret',
      RENX_RATE_LIMIT_MAX_REQUESTS: '5',
      RENX_RATE_LIMIT_WINDOW_MS: '60000',
    });

    expect(config.rateLimit).toEqual({
      maxRequests: 5,
      windowMs: 60000,
    });
  });

  it('requires both request rate limit settings when one is provided', () => {
    expect(() =>
      parseServerConfig({
        RENX_STATE_DIR: '/tmp/state',
        RENX_WORKSPACE_DIR: '/tmp/workspace',
        RENX_SERVER_TOKEN: 'secret',
        RENX_RATE_LIMIT_MAX_REQUESTS: '5',
      })
    ).toThrow(/RENX_RATE_LIMIT_MAX_REQUESTS and RENX_RATE_LIMIT_WINDOW_MS/);
  });
});
