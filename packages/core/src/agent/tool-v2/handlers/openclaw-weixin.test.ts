import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenClawWeixinTool } from './openclaw-weixin.js';

describe('OpenClawWeixinTool', () => {
  const tool = new OpenClawWeixinTool();

  it('should have correct name', () => {
    expect(tool.spec.name).toBe('openclaw_weixin');
  });

  it('should have valid inputSchema', () => {
    const inputSchema = tool.spec.inputSchema;
    expect(inputSchema).toBeDefined();
    expect(typeof inputSchema).toBe('object');
  });

  it('should have correct tags', () => {
    expect(tool.spec.tags).toContain('wechat');
    expect(tool.spec.tags).toContain('channel');
  });

  it('plan should return correct risk level for send', () => {
    const plan = tool.plan(
      { action: 'send', peerId: 'test@im.wechat', text: 'hello' },
      {} as any
    );
    expect(plan.riskLevel).toBe('medium');
    expect(plan.mutating).toBe(true);
  });

  it('plan should return low risk for status', () => {
    const plan = tool.plan({ action: 'status' }, {} as any);
    expect(plan.riskLevel).toBe('low');
    expect(plan.mutating).toBe(false);
  });

  it('plan should include network targets for listen', () => {
    const plan = tool.plan({ action: 'listen' }, {} as any);
    expect(plan.networkTargets).toContain('https://ilinkai.weixin.qq.com');
  });

  it('plan should return empty network targets for stop-listen', () => {
    const plan = tool.plan({ action: 'stop-listen' }, {} as any);
    expect(plan.networkTargets).toEqual([]);
    expect(plan.riskLevel).toBe('low');
  });

  it('plan should return low risk for login-qr-start', () => {
    const plan = tool.plan({ action: 'login-qr-start' }, {} as any);
    expect(plan.riskLevel).toBe('low');
    expect(plan.mutating).toBe(false);
  });
});

describe('OpenClawWeixinTool listen lifecycle', () => {
  let tool: OpenClawWeixinTool;

  beforeEach(() => {
    tool = new OpenClawWeixinTool({ onInboundMessage: vi.fn() });
  });

  it('should accept onInboundMessage option', () => {
    const cb = vi.fn();
    const t = new OpenClawWeixinTool({ onInboundMessage: cb });
    expect(t).toBeDefined();
    expect(t.spec.name).toBe('openclaw_weixin');
  });

  it('should work without onInboundMessage option', () => {
    const t = new OpenClawWeixinTool();
    expect(t.spec.name).toBe('openclaw_weixin');
  });

  it('should describe listen and stop-listen in description', () => {
    expect(tool.spec.description).toContain('listen');
    expect(tool.spec.description).toContain('stop-listen');
    expect(tool.spec.description).toContain('MUST call "listen"');
  });

  it('inputSchema should include all actions including listen and stop-listen', () => {
    const schema = tool.spec.inputSchema as any;
    const actionDef = schema.properties?.action;
    expect(actionDef).toBeDefined();
    if (actionDef?.enum) {
      expect(actionDef.enum).toContain('listen');
      expect(actionDef.enum).toContain('stop-listen');
    }
  });
});
