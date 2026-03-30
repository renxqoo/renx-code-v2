import { describe, it, expect } from 'vitest';
import { buildBaseInfo } from './api.js';

describe('buildBaseInfo', () => {
  it('should return an object with channel_version', () => {
    const info = buildBaseInfo();
    expect(info).toHaveProperty('channel_version');
    expect(typeof info.channel_version).toBe('string');
    expect(info.channel_version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
