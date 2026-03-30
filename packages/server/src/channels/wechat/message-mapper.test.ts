import { describe, it, expect } from 'vitest';
import { mapWechatToInbound, mapOutboundToWechat } from './message-mapper';

describe('mapWechatToInbound', () => {
  it('should map text message to InboundChannelMessage', () => {
    const result = mapWechatToInbound({
      fromUser: 'user1',
      toUser: 'bot1',
      content: 'Hello',
      msgType: 'text',
      createTime: 1700000000,
    }, 'acc1');
    expect(result.channelId).toBe('wechat');
    expect(result.accountId).toBe('acc1');
    expect(result.peerId).toBe('user1');
    expect(result.senderId).toBe('user1');
    expect(result.text).toBe('Hello');
    expect(result.media).toBeUndefined();
    expect(result.receivedAt).toBe(1700000000 * 1000);
  });

  it('should map image message with media', () => {
    const result = mapWechatToInbound({
      fromUser: 'user1',
      toUser: 'bot1',
      content: '',
      msgType: 'image',
      createTime: 1700000000,
    }, 'acc1');
    expect(result.text).toBeUndefined();
    expect(result.media).toBeDefined();
    expect(result.media?.type).toBe('image');
  });

  it('should use Date.now() for missing createTime', () => {
    const before = Date.now();
    const result = mapWechatToInbound({
      fromUser: 'u1',
      toUser: 'b1',
      content: 'test',
      msgType: 'text',
      createTime: 0,
    }, 'acc1');
    const after = Date.now();
    expect(result.receivedAt).toBeGreaterThanOrEqual(before);
    expect(result.receivedAt).toBeLessThanOrEqual(after);
  });
});

describe('mapOutboundToWechat', () => {
  it('should map OutboundChannelMessage to wechat format', () => {
    const result = mapOutboundToWechat({
      conversationId: 'dm:wechat:acc1:user1',
      channelId: 'wechat',
      peerId: 'user1',
      text: 'Reply',
    });
    expect(result.userId).toBe('user1');
    expect(result.text).toBe('Reply');
  });
});
