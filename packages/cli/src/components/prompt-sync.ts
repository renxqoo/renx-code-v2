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

  return true;
};
