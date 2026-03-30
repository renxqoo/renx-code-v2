import { describe, it, expect } from 'vitest';
import { normalizeAccountId } from './accounts.js';

describe('normalizeAccountId', () => {
  it('should normalize @im.bot to -im-bot', () => {
    expect(normalizeAccountId('b0f5860fdecb@im.bot')).toBe('b0f5860fdecb-im-bot');
  });

  it('should normalize @im.wechat to -im-wechat', () => {
    expect(normalizeAccountId('abc123@im.wechat')).toBe('abc123-im-wechat');
  });

  it('should trim whitespace', () => {
    expect(normalizeAccountId('  abc@im.bot  ')).toBe('abc-im-bot');
  });

  it('should handle already normalized IDs', () => {
    expect(normalizeAccountId('abc-im-bot')).toBe('abc-im-bot');
  });
});
