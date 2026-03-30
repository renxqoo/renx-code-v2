import { describe, it, expect, vi } from 'vitest';
import { ChannelRegistry } from './registry';
import type { ChannelAdapter, ChannelAdapterContext, OutboundChannelMessage, SendResult, ChannelProbeResult } from './types';

function createMockAdapter(id: string, overrides?: Partial<ChannelAdapter>): ChannelAdapter {
  return {
    id,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    send: vi.fn().mockResolvedValue({ success: true, messageId: 'msg-1' } as SendResult),
    probe: vi.fn().mockResolvedValue({ connected: true } as ChannelProbeResult),
    ...overrides,
  };
}

function createMockContext(): Omit<ChannelAdapterContext, 'config'> {
  return {
    onMessage: vi.fn(),
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    },
  };
}

describe('ChannelRegistry', () => {
  it('should register and retrieve adapters', () => {
    const registry = new ChannelRegistry();
    const adapter = createMockAdapter('wechat');
    registry.register(adapter);
    expect(registry.get('wechat')).toBe(adapter);
  });

  it('should return undefined for unknown channel', () => {
    const registry = new ChannelRegistry();
    expect(registry.get('unknown')).toBeUndefined();
  });

  it('should list all registered adapters', () => {
    const registry = new ChannelRegistry();
    const wechat = createMockAdapter('wechat');
    const webchat = createMockAdapter('webchat');
    registry.register(wechat);
    registry.register(webchat);
    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map(a => a.id)).toContain('wechat');
    expect(list.map(a => a.id)).toContain('webchat');
  });

  it('should start all adapters', async () => {
    const registry = new ChannelRegistry();
    const adapter1 = createMockAdapter('a');
    const adapter2 = createMockAdapter('b');
    registry.register(adapter1);
    registry.register(adapter2);
    const context = createMockContext();
    await registry.startAll(context);
    expect(adapter1.start).toHaveBeenCalled();
    expect(adapter2.start).toHaveBeenCalled();
  });

  it('should stop all adapters', async () => {
    const registry = new ChannelRegistry();
    const adapter1 = createMockAdapter('a');
    const adapter2 = createMockAdapter('b');
    registry.register(adapter1);
    registry.register(adapter2);
    const context = createMockContext();
    await registry.startAll(context);
    await registry.stopAll();
    expect(adapter1.stop).toHaveBeenCalled();
    expect(adapter2.stop).toHaveBeenCalled();
  });

  it('should support fluent register API', () => {
    const registry = new ChannelRegistry();
    const result = registry.register(createMockAdapter('a'));
    expect(result).toBe(registry);
  });
});
