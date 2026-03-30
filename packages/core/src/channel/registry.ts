import type {
  ChannelAdapter,
  ChannelAdapterContext,
} from './types';

export class ChannelRegistry {
  private readonly adapters = new Map<string, ChannelAdapter>();
  private contexts = new Map<string, ChannelAdapterContext>();

  register(adapter: ChannelAdapter): this {
    this.adapters.set(adapter.id, adapter);
    return this;
  }

  get(channelId: string): ChannelAdapter | undefined {
    return this.adapters.get(channelId);
  }

  list(): ChannelAdapter[] {
    return Array.from(this.adapters.values());
  }

  async startAll(baseContext: Omit<ChannelAdapterContext, 'config'>): Promise<void> {
    const startPromises = Array.from(this.adapters.entries()).map(
      async ([id, adapter]) => {
        // Each adapter gets its own context with a placeholder config
        // The real config is injected via the plugin system
        const context: ChannelAdapterContext = {
          onMessage: baseContext.onMessage,
          logger: baseContext.logger,
          config: {},
        };
        this.contexts.set(id, context);
        await adapter.start(context);
      }
    );
    await Promise.all(startPromises);
  }

  async stopAll(): Promise<void> {
    const stopPromises = Array.from(this.adapters.values()).map(
      (adapter) => adapter.stop().catch(() => {})
    );
    await Promise.all(stopPromises);
    this.contexts.clear();
  }
}
