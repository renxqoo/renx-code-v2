import { describe, it, expect } from 'vitest';
import type { InboundChannelMessage, OutboundChannelMessage, ChannelMedia } from './types';

describe('Channel Types', () => {
  it('should construct a valid InboundChannelMessage', () => {
    const msg: InboundChannelMessage = {
      channelId: 'wechat',
      accountId: 'account-1',
      peerId: 'user-1',
      senderId: 'user-1',
      text: 'Hello',
      receivedAt: Date.now(),
    };
    expect(msg.channelId).toBe('wechat');
    expect(msg.text).toBe('Hello');
    expect(msg.threadId).toBeUndefined();
    expect(msg.media).toBeUndefined();
  });

  it('should construct an InboundChannelMessage with media', () => {
    const media: ChannelMedia = {
      type: 'image',
      url: 'https://example.com/image.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
    };
    const msg: InboundChannelMessage = {
      channelId: 'wechat',
      accountId: 'account-1',
      peerId: 'user-1',
      senderId: 'user-1',
      media,
      receivedAt: Date.now(),
    };
    expect(msg.media?.type).toBe('image');
    expect(msg.media?.url).toBe('https://example.com/image.jpg');
  });

  it('should construct a valid OutboundChannelMessage', () => {
    const msg: OutboundChannelMessage = {
      conversationId: 'dm:wechat:account-1:user-1',
      channelId: 'wechat',
      peerId: 'user-1',
      text: 'Reply',
    };
    expect(msg.conversationId).toContain('dm:');
    expect(msg.replyToMessageId).toBeUndefined();
  });

  it('should construct group InboundChannelMessage with threadId', () => {
    const msg: InboundChannelMessage = {
      channelId: 'wechat',
      accountId: 'account-1',
      peerId: 'user-1',
      threadId: 'thread-1',
      senderId: 'user-2',
      text: 'Group message',
      receivedAt: Date.now(),
    };
    expect(msg.threadId).toBe('thread-1');
    expect(msg.peerId).not.toBe(msg.senderId);
  });
});
