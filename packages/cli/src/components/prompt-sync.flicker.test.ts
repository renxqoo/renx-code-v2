import { describe, expect, it } from 'vitest';

import { shouldSyncPromptTextarea } from './prompt-sync';

describe('prompt textarea flicker regression', () => {
  it('does not sync an older parent value back into a focused textarea after the user types one more character', () => {
    expect(
      shouldSyncPromptTextarea({
        textareaValue: 'hello',
        nextValue: 'hell',
        lastUserValue: 'hello',
      })
    ).toBe(false);
  });

  it('does not sync an older parent prefix back into a focused textarea after the user types multiple more characters', () => {
    expect(
      shouldSyncPromptTextarea({
        textareaValue: 'hello world',
        nextValue: 'hello',
        lastUserValue: 'hello world',
      })
    ).toBe(false);
  });

  it('does not sync an older parent value back into a focused textarea after the user inserts text in the middle', () => {
    expect(
      shouldSyncPromptTextarea({
        textareaValue: 'hello brave world',
        nextValue: 'hello world',
        lastUserValue: 'hello brave world',
      })
    ).toBe(false);
  });

  it('does not sync an older parent value back into a focused textarea after the user deletes text in the middle', () => {
    expect(
      shouldSyncPromptTextarea({
        textareaValue: 'hello world',
        nextValue: 'helloworld',
        lastUserValue: 'hello world',
      })
    ).toBe(false);
  });
});
