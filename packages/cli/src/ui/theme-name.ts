export type OpenCodeThemeName = 'default' | 'konayuki';

export const DEFAULT_OPEN_CODE_THEME_NAME: OpenCodeThemeName = 'konayuki';
export const OPEN_CODE_THEME_NAMES: readonly OpenCodeThemeName[] = ['default', 'konayuki'];

export const isOpenCodeThemeName = (value: string): value is OpenCodeThemeName =>
  OPEN_CODE_THEME_NAMES.includes(value as OpenCodeThemeName);

export const normalizeOpenCodeThemeName = (
  value: string | null | undefined
): OpenCodeThemeName | null => {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return isOpenCodeThemeName(normalized) ? normalized : null;
};
