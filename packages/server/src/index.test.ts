import { describe, expect, it, vi } from 'vitest';

import type { ServerConfig } from './config/schema';
import { runServerCli, startServer } from './index';

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

type SignalName = 'SIGINT' | 'SIGTERM';

type MockProcess = {
  env: NodeJS.ProcessEnv;
  stdout: { write: (chunk: string) => boolean };
  stderr: { write: (chunk: string) => boolean };
  once: (event: SignalName, handler: () => void) => MockProcess;
  exitCode?: number;
};

function createProcessMock(env: NodeJS.ProcessEnv = {}) {
  const signalHandlers = new Map<SignalName, () => void>();
  const stdoutWrites: string[] = [];
  const stderrWrites: string[] = [];

  const processLike = {} as MockProcess;
  processLike.env = env;
  processLike.stdout = {
    write: ((chunk: string) => {
      stdoutWrites.push(chunk);
      return true;
    }) satisfies (chunk: string) => boolean,
  };
  processLike.stderr = {
    write: ((chunk: string) => {
      stderrWrites.push(chunk);
      return true;
    }) satisfies (chunk: string) => boolean,
  };
  processLike.once = ((event: SignalName, handler: () => void) => {
    signalHandlers.set(event, handler);
    return processLike;
  }) as MockProcess['once'];

  return {
    processLike,
    signalHandlers,
    stdoutWrites,
    stderrWrites,
  };
}

function createServerMock() {
  return {
    listen: vi.fn((_: number, __: string, callback?: () => void) => {
      callback?.();
      return undefined;
    }),
    close: vi.fn((callback?: (error?: Error | null) => void) => {
      callback?.(undefined);
      return undefined;
    }),
  };
}

describe('server lifecycle entrypoint', () => {
  it('sets exitCode and logs when startup fails', async () => {
    const config = createConfig();
    const { processLike, stderrWrites } = createProcessMock();

    await runServerCli({
      process: processLike,
      parseServerConfig: vi.fn(() => config),
      createServerAppComposition: vi.fn().mockRejectedValue(new Error('bootstrap failed')),
      createGatewayServer: vi.fn(),
    });

    expect(processLike.exitCode).toBe(1);
    expect(stderrWrites.join('')).toContain('Failed to start server');
    expect(stderrWrites.join('')).toContain('bootstrap failed');
  });

  it('binds signal handlers and gracefully shuts down server resources once', async () => {
    const config = createConfig();
    const { processLike, signalHandlers, stdoutWrites } = createProcessMock();
    const server = createServerMock();
    const store = {
      close: vi.fn().mockResolvedValue(undefined),
    };

    const running = await startServer({
      process: processLike,
      parseServerConfig: vi.fn(() => config),
      createServerAppComposition: vi.fn().mockResolvedValue({
        appService: {},
        store,
      }),
      createGatewayServer: vi.fn(() => server),
    });

    expect(server.listen).toHaveBeenCalledWith(8080, '127.0.0.1', expect.any(Function));
    expect(signalHandlers.has('SIGINT')).toBe(true);
    expect(signalHandlers.has('SIGTERM')).toBe(true);
    expect(stdoutWrites.join('')).toContain('listening on http://127.0.0.1:8080');

    signalHandlers.get('SIGINT')?.();
    signalHandlers.get('SIGTERM')?.();

    await vi.waitFor(() => {
      expect(server.close).toHaveBeenCalledTimes(1);
      expect(store.close).toHaveBeenCalledTimes(1);
    });

    expect(stdoutWrites.join('')).toContain('received SIGINT');

    await running.shutdown('SIGTERM');
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(store.close).toHaveBeenCalledTimes(1);
  });

  it('closes the composition store if startup fails after composition creation', async () => {
    const config = createConfig();
    const { processLike } = createProcessMock();
    const store = {
      close: vi.fn().mockResolvedValue(undefined),
    };
    const server = {
      listen: vi.fn(() => {
        throw new Error('listen failed');
      }),
      close: vi.fn(),
    };

    await expect(
      startServer({
        process: processLike,
        parseServerConfig: vi.fn(() => config),
        createServerAppComposition: vi.fn().mockResolvedValue({
          appService: {},
          store,
        }),
        createGatewayServer: vi.fn(() => server),
      })
    ).rejects.toThrow('listen failed');

    expect(store.close).toHaveBeenCalledTimes(1);
  });
});
