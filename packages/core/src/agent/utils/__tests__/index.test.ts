import { describe, expect, it } from 'vitest';
import * as utils from '../index';
import * as messageUtils from '../message';

describe('utils index exports', () => {
  it('re-exports message helpers', () => {
    expect(utils.contentToText).toBe(messageUtils.contentToText);
    expect(utils.processToolCallPairs).toBe(messageUtils.processToolCallPairs);
  });
});
