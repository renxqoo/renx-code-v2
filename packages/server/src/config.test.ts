import { describe, it, expect } from 'vitest';
import { resolveServerConfig } from './config';

describe('resolveServerConfig', () => {
  it('should use defaults for empty env', () => {
    const config = resolveServerConfig({});
    expect(config.port).toBe(3100);
    expect(config.host).toBe('0.0.0.0');
    expect(config.channels).toEqual([]);
    expect(config.authToken).toBeUndefined();
    expect(config.model).toBeUndefined();
  });

  it('should resolve env variables', () => {
    const config = resolveServerConfig({
      RENX_SERVER_PORT: '4200',
      RENX_SERVER_HOST: '127.0.0.1',
      RENX_STATE_DIR: '/tmp/renx',
      RENX_WORKSPACE_DIR: '/workspace',
      RENX_SERVER_TOKEN: 'secret-token',
      RENX_MODEL_ID: 'gpt-4o',
      RENX_MODEL_PROVIDER: 'openai',
    });
    expect(config.port).toBe(4200);
    expect(config.host).toBe('127.0.0.1');
    expect(config.stateDir).toBe('/tmp/renx');
    expect(config.workspaceDir).toBe('/workspace');
    expect(config.authToken).toBe('secret-token');
    expect(config.model).toEqual({ provider: 'openai', modelId: 'gpt-4o' });
  });

  it('should default model provider to openai', () => {
    const config = resolveServerConfig({ RENX_MODEL_ID: 'claude-3' });
    expect(config.model?.provider).toBe('openai');
  });
});
