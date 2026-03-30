import { describe, it, expect } from 'vitest';
import { OpenClawWeixinTool } from './openclaw-weixin.js';

describe('OpenClawWeixinTool', () => {
  const tool = new OpenClawWeixinTool();

  it('should have correct name', () => {
    expect(tool.spec.name).toBe('openclaw_weixin');
  });

  it('should have valid schema', () => {
    const schema = tool.spec.schema;
    expect(schema).toBeDefined();
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

  it('should reject unknown action', async () => {
    await expect(
      tool.execute({ action: 'status' }, {} as any)
    ).rejects.toThrow();
  });
});
