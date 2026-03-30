import type { GatewayPluginApi } from './plugin-api';
import type { GatewayStore } from '../storage';
import type { ChannelAdapter } from '@renx-code/core/channel';

export interface GatewayPlugin {
  readonly id: string;
  readonly name: string;
  register(api: GatewayPluginApi): Promise<void>;
}

export class PluginLoader {
  private plugins: GatewayPlugin[] = [];
  private channels: ChannelAdapter[] = [];

  register(plugin: GatewayPlugin): void {
    this.plugins.push(plugin);
  }

  async loadAll(store: GatewayStore): Promise<{ channels: ChannelAdapter[] }> {
    const channels: ChannelAdapter[] = [];
    const routes: Array<{ method: string; path: string; handler: any }> = [];
    const commands: Array<{ name: string; handler: any }> = [];
    const services: any[] = [];

    const api: GatewayPluginApi = {
      registerChannel(adapter: ChannelAdapter) { channels.push(adapter); },
      registerRoute(method: string, path: string, handler: any) { routes.push({ method, path, handler }); },
      registerCommand(name: string, handler: any) { commands.push({ name, handler }); },
      registerBackgroundService(service: any) { services.push(service); },
      getStore: () => store,
    };

    for (const plugin of this.plugins) {
      await plugin.register(api);
    }

    this.channels = channels;
    return { channels };
  }
}
