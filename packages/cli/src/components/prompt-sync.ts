type ShouldSyncPromptTextareaParams = {
  textareaValue: string;
  nextValue: string;
  lastUserValue: string | null;
};

export const shouldSyncPromptTextarea = ({
  textareaValue,
  nextValue,
  lastUserValue,
}: ShouldSyncPromptTextareaParams): boolean => {
  if (textareaValue === nextValue) {
    return false;
  }

  if (lastUserValue === nextValue) {
    return false;
  }

  if (
    lastUserValue === textareaValue &&
    nextValue.length < textareaValue.length &&
    textareaValue.startsWith(nextValue)
  ) {
    return false;
  }

  return true;
};
