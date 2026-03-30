import type { ChannelAdapter } from '@renx-code/core/channel';
import type { GatewayStore } from '../storage';

export interface RouteHandler {
  (req: unknown, res: { status: (code: number) => any; json: (body: unknown) => void; send: (body: string) => void; setHeader: (name: string, value: string) => void }): Promise<void>;
}

export interface CommandHandler {
  (args: unknown): Promise<unknown>;
}

export interface BackgroundService {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface GatewayPluginApi {
  registerChannel(adapter: ChannelAdapter): void;
  registerRoute(method: string, path: string, handler: RouteHandler): void;
  registerCommand(name: string, handler: CommandHandler): void;
  registerBackgroundService(service: BackgroundService): void;
  getStore(): GatewayStore;
}
