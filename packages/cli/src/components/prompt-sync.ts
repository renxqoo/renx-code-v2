type ShouldSyncPromptTextareaParams = {
  textareaValue: string;
  nextValue: string;
  lastUserValue: string | null;
};

const differsBySingleContiguousInsertionOrDeletion = (left: string, right: string): boolean => {
  if (left === right) {
    return false;
  }

  const longer = left.length >= right.length ? left : right;
  const shorter = left.length >= right.length ? right : left;

  let prefixLength = 0;
  while (prefixLength < shorter.length && longer[prefixLength] === shorter[prefixLength]) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < shorter.length - prefixLength &&
    longer[longer.length - 1 - suffixLength] === shorter[shorter.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  return prefixLength + suffixLength >= shorter.length;
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
    nextValue.length > 0 &&
    lastUserValue === textareaValue &&
    differsBySingleContiguousInsertionOrDeletion(textareaValue, nextValue)
  ) {
    return false;
  }

  return true;
};
