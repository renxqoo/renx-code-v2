import { describe, it, expect } from 'vitest';
import { parseInboundMessage, isMediaItem, setContextToken, getContextToken, clearContextTokensForAccount } from './inbound.js';
import type { WeixinMessage } from '../api/types.js';
import { MessageItemType } from '../api/types.js';

describe('parseInboundMessage', () => {
  it('should extract text body from a text message', () => {
    const msg: WeixinMessage = {
      from_user_id: 'user123@im.wechat',
      to_user_id: 'bot456@im.bot',
      message_type: 1,
      item_list: [
        { type: MessageItemType.TEXT, text_item: { text: 'Hello bot' } },
      ],
      context_token: 'ctx_tok_123',
      create_time_ms: 1700000000000,
    };

    const result = parseInboundMessage(msg, 'test-account');
    expect(result.body).toBe('Hello bot');
    expect(result.fromUserId).toBe('user123@im.wechat');
    expect(result.accountId).toBe('test-account');
    expect(result.contextToken).toBe('ctx_tok_123');
    expect(result.timestamp).toBe(1700000000000);
  });

  it('should handle empty message', () => {
    const msg: WeixinMessage = {
      from_user_id: 'user@im.wechat',
    };
    const result = parseInboundMessage(msg, 'acc');
    expect(result.body).toBe('');
    expect(result.fromUserId).toBe('user@im.wechat');
  });
});

describe('isMediaItem', () => {
  it('should return true for image items', () => {
    expect(isMediaItem({ type: MessageItemType.IMAGE })).toBe(true);
  });

  it('should return true for voice items', () => {
    expect(isMediaItem({ type: MessageItemType.VOICE })).toBe(true);
  });

  it('should return false for text items', () => {
    expect(isMediaItem({ type: MessageItemType.TEXT })).toBe(false);
  });
});

describe('context tokens', () => {
  it('should set and get context tokens', () => {
    setContextToken('acc1', 'user1', 'token1');
    expect(getContextToken('acc1', 'user1')).toBe('token1');
    expect(getContextToken('acc1', 'user2')).toBeUndefined();
    expect(getContextToken('acc2', 'user1')).toBeUndefined();
  });

  it('should clear context tokens for an account', () => {
    setContextToken('acc-clear-test', 'user1', 'token1');
    setContextToken('acc-clear-test', 'user2', 'token2');
    clearContextTokensForAccount('acc-clear-test');
    expect(getContextToken('acc-clear-test', 'user1')).toBeUndefined();
    expect(getContextToken('acc-clear-test', 'user2')).toBeUndefined();
  });
});
