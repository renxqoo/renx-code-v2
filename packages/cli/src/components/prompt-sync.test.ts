import { describe, expect, it } from 'vitest';

import { shouldSyncPromptTextarea } from './prompt-sync';

describe('shouldSyncPromptTextarea', () => {
  it('skips imperative sync when parent echoes the latest user input', () => {
    expect(
      shouldSyncPromptTextarea({
        textareaValue: 'hel',
        nextValue: 'hell',
        lastUserValue: 'hell',
      })
    ).toBe(false);
  });

  it('skips sync when textarea already matches the next value', () => {
    expect(
      shouldSyncPromptTextarea({
        textareaValue: 'hello',
        nextValue: 'hello',
        lastUserValue: 'hello',
      })
    ).toBe(false);
  });

  it('syncs external value changes that did not originate from the textarea', () => {
    expect(
      shouldSyncPromptTextarea({
        textareaValue: 'hello',
        nextValue: 'clear',
        lastUserValue: 'hello',
      })
    ).toBe(true);
  });

  it('syncs an external rewrite that does not look like a stale echo of the current user input', () => {
    expect(
      shouldSyncPromptTextarea({
        textareaValue: 'hello',
        nextValue: 'HELLO',
        lastUserValue: 'hello',
      })
    ).toBe(true);
  });

  it('syncs a submit-triggered clear even when the focused textarea still contains the last user input', () => {
    expect(
      shouldSyncPromptTextarea({
        textareaValue: 'hello',
        nextValue: '',
        lastUserValue: 'hello',
      })
    ).toBe(true);
  });
});
