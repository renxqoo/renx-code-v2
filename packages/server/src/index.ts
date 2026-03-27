import { pathToFileURL } from 'node:url';

import { parseServerConfig } from './config/env';
import type { ServerConfig } from './config/schema';
import { createGatewayServer } from './gateway/server';
import { createServerAppComposition } from './runtime/app-service';

type ShutdownSignal = 'SIGINT' | 'SIGTERM';
type ServerAppComposition = Awaited<ReturnType<typeof createServerAppComposition>>;

type WritableStreamLike = {
  write(chunk: string): boolean;
};

type SignalAwareProcess = {
  env: NodeJS.ProcessEnv;
  stdout: WritableStreamLike;
  stderr: WritableStreamLike;
  once(event: ShutdownSignal, listener: () => void): unknown;
  exitCode?: number | string;
};

type ClosableStore = {
  close(): Promise<void>;
};

type ServerLike = {
  listen(port: number, host: string, callback?: () => void): unknown;
  close(callback?: (error?: Error | null) => void): unknown;
  once?(event: 'error', listener: (error: Error) => void): unknown;
  off?(event: 'error', listener: (error: Error) => void): unknown;
};

interface StartServerDeps {
  process?: SignalAwareProcess;
  parseServerConfig?: (env: NodeJS.ProcessEnv) => ServerConfig;
  createServerAppComposition?: (config: ServerConfig) => Promise<ServerAppComposition>;
  createGatewayServer?: (input: {
    appService: ServerAppComposition['appService'];
    store?: ServerAppComposition['store'];
    config: ServerConfig;
  }) => ServerLike;
}

export interface RunningServer {
  config: ServerConfig;
  server: ServerLike;
  shutdown: (reason?: ShutdownSignal) => Promise<void>;
}

export async function startServer(deps: StartServerDeps = {}): Promise<RunningServer> {
  const processRef = deps.process ?? process;
  const parseConfig = deps.parseServerConfig ?? parseServerConfig;
  const createComposition = deps.createServerAppComposition ?? createServerAppComposition;
  const buildServer = deps.createGatewayServer ?? createGatewayServer;

  const config = parseConfig(processRef.env);
  const composition = await createComposition(config);

  let server: ServerLike | undefined;
  try {
    server = buildServer({
      appService: composition.appService,
      store: composition.store,
      config,
    });
    await listenServer(server, config.port, config.host);
  } catch (error) {
    await closeOwnedStore(composition);
    throw error;
  }

  processRef.stdout.write(
    `[renx-server] listening on http://${config.host}:${config.port} using model ${config.modelId}\n`
  );

  let shutdownPromise: Promise<void> | null = null;
  const shutdown = (reason?: ShutdownSignal): Promise<void> => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      if (reason) {
        processRef.stdout.write(`[renx-server] received ${reason}, shutting down\n`);
      }
      await closeServer(server);
      await closeOwnedStore(composition);
      processRef.stdout.write('[renx-server] shutdown complete\n');
    })();

    return shutdownPromise;
  };

  bindSignalHandlers(processRef, shutdown);

  return {
    config,
    server,
    shutdown,
  };
}

export async function runServerCli(deps: StartServerDeps = {}): Promise<RunningServer | undefined> {
  const processRef = deps.process ?? process;
  try {
    return await startServer(deps);
  } catch (error) {
    processRef.exitCode = 1;
    processRef.stderr.write(formatStartupError(error));
    return undefined;
  }
}

function bindSignalHandlers(
  processRef: SignalAwareProcess,
  shutdown: (reason?: ShutdownSignal) => Promise<void>
): void {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    processRef.once(signal, () => {
      void shutdown(signal).catch((error) => {
        processRef.exitCode = 1;
        processRef.stderr.write(formatShutdownError(signal, error));
      });
    });
  }
}

async function listenServer(server: ServerLike, port: number, host: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      detach();
      reject(error);
    };
    const onListening = () => {
      detach();
      resolve();
    };
    const detach = () => {
      server.off?.('error', onError);
    };

    server.once?.('error', onError);
    try {
      server.listen(port, host, onListening);
    } catch (error) {
      detach();
      reject(error);
    }
  });
}

async function closeServer(server: ServerLike): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    try {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function closeOwnedStore(composition: { store?: ClosableStore }): Promise<void> {
  if (!composition.store) {
    return;
  }
  await composition.store.close();
}

function formatStartupError(error: unknown): string {
  return `[renx-server] Failed to start server: ${formatError(error)}\n`;
}

function formatShutdownError(signal: ShutdownSignal, error: unknown): string {
  return `[renx-server] Failed during ${signal} shutdown: ${formatError(error)}\n`;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}

function isEntrypoint(moduleUrl: string, entryArg: string | undefined): boolean {
  if (!entryArg) {
    return false;
  }
  return moduleUrl === pathToFileURL(entryArg).href;
}

if (isEntrypoint(import.meta.url, process.argv[1])) {
  void runServerCli();
}
