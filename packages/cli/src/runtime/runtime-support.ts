export const isBunRuntime = (): boolean => {
  return typeof process !== 'undefined' && typeof process.versions?.bun === 'string';
};

export const getUnsupportedRuntimeMessage = (): string => {
  return 'Renx Code CLI currently requires Bun at runtime. Please run this package with Bun.';
};

export const ensureSupportedRuntime = (): boolean => {
  if (isBunRuntime()) {
    return true;
  }

  console.error(getUnsupportedRuntimeMessage());
  return false;
};
