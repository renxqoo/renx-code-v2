import { RGBA } from '@opentui/core';

import { DEFAULT_OPEN_CODE_THEME_NAME, type OpenCodeThemeName } from './theme-name';

export type OpenCodeThemeMode = 'dark' | 'light';
export type MarkdownThemePlatform = NodeJS.Platform;

export type OpenCodeTheme = {
  primary: RGBA;
  secondary: RGBA;
  accent: RGBA;
  error: RGBA;
  warning: RGBA;
  success: RGBA;
  info: RGBA;
  text: RGBA;
  textMuted: RGBA;
  background: RGBA;
  backgroundPanel: RGBA;
  backgroundElement: RGBA;
  border: RGBA;
  borderActive: RGBA;
  borderSubtle: RGBA;
  diffAdded: RGBA;
  diffRemoved: RGBA;
  diffContext: RGBA;
  diffHunkHeader: RGBA;
  diffHighlightAdded: RGBA;
  diffHighlightRemoved: RGBA;
  diffAddedBg: RGBA;
  diffRemovedBg: RGBA;
  diffContextBg: RGBA;
  diffLineNumber: RGBA;
  diffAddedLineNumberBg: RGBA;
  diffRemovedLineNumberBg: RGBA;
  markdownText: RGBA;
  markdownHeading: RGBA;
  markdownLink: RGBA;
  markdownLinkText: RGBA;
  markdownCode: RGBA;
  markdownBlockQuote: RGBA;
  markdownEmph: RGBA;
  markdownStrong: RGBA;
  markdownHorizontalRule: RGBA;
  markdownListItem: RGBA;
  markdownListEnumeration: RGBA;
  markdownImage: RGBA;
  markdownImageText: RGBA;
  markdownCodeBlock: RGBA;
  syntaxComment: RGBA;
  syntaxKeyword: RGBA;
  syntaxFunction: RGBA;
  syntaxVariable: RGBA;
  syntaxString: RGBA;
  syntaxNumber: RGBA;
  syntaxType: RGBA;
  syntaxOperator: RGBA;
  syntaxPunctuation: RGBA;
  thinkingOpacity: number;
};

const color = (hex: string) => RGBA.fromHex(hex);

const DEFAULT_DARK_THEME: OpenCodeTheme = {
  primary: color('#8e51ff'),
  secondary: color('#27272a'),
  accent: color('#8e51ff'),
  error: color('#ff6467'),
  warning: color('#c4b4ff'),
  success: color('#c4b4ff'),
  info: color('#a684ff'),
  text: color('#fafafa'),
  textMuted: color('#9f9fa9'),
  background: color('#09090b'),
  backgroundPanel: color('#18181b'),
  backgroundElement: color('#27272a'),
  border: color('#ffffff1a'),
  borderActive: color('#4d179a'),
  borderSubtle: color('#ffffff1a'),
  diffAdded: color('#8e51ff'),
  diffRemoved: color('#ff6467'),
  diffContext: color('#9f9fa9'),
  diffHunkHeader: color('#a684ff'),
  diffHighlightAdded: color('#c4b4ff'),
  diffHighlightRemoved: color('#ff8d8f'),
  diffAddedBg: color('#8e51ff1f'),
  diffRemovedBg: color('#ff646724'),
  diffContextBg: color('#27272a'),
  diffLineNumber: color('#9f9fa9'),
  diffAddedLineNumberBg: color('#4d179a66'),
  diffRemovedLineNumberBg: color('#ff646740'),
  markdownText: color('#fafafa'),
  markdownHeading: color('#c4b4ff'),
  markdownLink: color('#8e51ff'),
  markdownLinkText: color('#a684ff'),
  markdownCode: color('#c4b4ff'),
  markdownBlockQuote: color('#a684ff'),
  markdownEmph: color('#c4b4ff'),
  markdownStrong: color('#f5f3ff'),
  markdownHorizontalRule: color('#9f9fa9'),
  markdownListItem: color('#c4b4ff'),
  markdownListEnumeration: color('#a684ff'),
  markdownImage: color('#8e51ff'),
  markdownImageText: color('#a684ff'),
  markdownCodeBlock: color('#fafafa'),
  syntaxComment: color('#9f9fa9'),
  syntaxKeyword: color('#8e51ff'),
  syntaxFunction: color('#c4b4ff'),
  syntaxVariable: color('#f5f3ff'),
  syntaxString: color('#c4b4ff'),
  syntaxNumber: color('#a684ff'),
  syntaxType: color('#8e51ff'),
  syntaxOperator: color('#7008e7'),
  syntaxPunctuation: color('#fafafa'),
  thinkingOpacity: 0.74,
};

const DEFAULT_LIGHT_THEME: OpenCodeTheme = {
  primary: color('#7f22fe'),
  secondary: color('#f4f4f5'),
  accent: color('#7f22fe'),
  error: color('#e7000b'),
  warning: color('#8e51ff'),
  success: color('#8e51ff'),
  info: color('#a684ff'),
  text: color('#09090b'),
  textMuted: color('#71717b'),
  background: color('#ffffff'),
  backgroundPanel: color('#ffffff'),
  backgroundElement: color('#f4f4f5'),
  border: color('#e4e4e7'),
  borderActive: color('#a684ff'),
  borderSubtle: color('#e4e4e7'),
  diffAdded: color('#7f22fe'),
  diffRemoved: color('#e7000b'),
  diffContext: color('#71717b'),
  diffHunkHeader: color('#a684ff'),
  diffHighlightAdded: color('#5d0ec0'),
  diffHighlightRemoved: color('#e7000b'),
  diffAddedBg: color('#f5f3ff'),
  diffRemovedBg: color('#e7000b14'),
  diffContextBg: color('#f4f4f5'),
  diffLineNumber: color('#71717b'),
  diffAddedLineNumberBg: color('#c4b4ff80'),
  diffRemovedLineNumberBg: color('#e7000b26'),
  markdownText: color('#09090b'),
  markdownHeading: color('#7f22fe'),
  markdownLink: color('#7f22fe'),
  markdownLinkText: color('#8e51ff'),
  markdownCode: color('#5d0ec0'),
  markdownBlockQuote: color('#8e51ff'),
  markdownEmph: color('#7008e7'),
  markdownStrong: color('#18181b'),
  markdownHorizontalRule: color('#71717b'),
  markdownListItem: color('#7f22fe'),
  markdownListEnumeration: color('#8e51ff'),
  markdownImage: color('#7f22fe'),
  markdownImageText: color('#8e51ff'),
  markdownCodeBlock: color('#09090b'),
  syntaxComment: color('#71717b'),
  syntaxKeyword: color('#7f22fe'),
  syntaxFunction: color('#5d0ec0'),
  syntaxVariable: color('#18181b'),
  syntaxString: color('#8e51ff'),
  syntaxNumber: color('#7008e7'),
  syntaxType: color('#7f22fe'),
  syntaxOperator: color('#7008e7'),
  syntaxPunctuation: color('#09090b'),
  thinkingOpacity: 0.9,
};

const KONAYUKI_DARK_THEME: OpenCodeTheme = {
  primary: color('#7aa2f7'),
  secondary: color('#2a2f45'),
  accent: color('#7aa2f7'),
  error: color('#fb7185'),
  warning: color('#fbbf24'),
  success: color('#34d399'),
  info: color('#60a5fa'),
  text: color('#e5e9f0'),
  textMuted: color('#9aa5ce'),
  background: color('#1a1b26'),
  backgroundPanel: color('#24283b'),
  backgroundElement: color('#24283b'),
  border: color('#2a2f45'),
  borderActive: color('#7aa2f7'),
  borderSubtle: color('#2a2f45'),
  diffAdded: color('#7aa2f7'),
  diffRemoved: color('#f7768e'),
  diffContext: color('#9aa5ce'),
  diffHunkHeader: color('#93b4ff'),
  diffHighlightAdded: color('#7dcfff'),
  diffHighlightRemoved: color('#fb7185'),
  diffAddedBg: color('#7aa2f714'),
  diffRemovedBg: color('#fb718524'),
  diffContextBg: color('#24283b'),
  diffLineNumber: color('#9aa5ce'),
  diffAddedLineNumberBg: color('#7aa2f74d'),
  diffRemovedLineNumberBg: color('#fb71853d'),
  markdownText: color('#e5e9f0'),
  markdownHeading: color('#7aa2f7'),
  markdownLink: color('#7aa2f7'),
  markdownLinkText: color('#93b4ff'),
  markdownCode: color('#e5e9f0'),
  markdownBlockQuote: color('#9aa5ce'),
  markdownEmph: color('#a9b1d6'),
  markdownStrong: color('#e5e9f0'),
  markdownHorizontalRule: color('#2a2f45'),
  markdownListItem: color('#7aa2f7'),
  markdownListEnumeration: color('#93b4ff'),
  markdownImage: color('#7aa2f7'),
  markdownImageText: color('#93b4ff'),
  markdownCodeBlock: color('#e5e9f0'),
  syntaxComment: color('#526270'),
  syntaxKeyword: color('#bb9af7'),
  syntaxFunction: color('#7dcfff'),
  syntaxVariable: color('#c0f0f5'),
  syntaxString: color('#9ece6a'),
  syntaxNumber: color('#ff9e64'),
  syntaxType: color('#7aa2f7'),
  syntaxOperator: color('#c0f0f5'),
  syntaxPunctuation: color('#e5e9f0'),
  thinkingOpacity: 0.78,
};

const KONAYUKI_LIGHT_THEME: OpenCodeTheme = {
  primary: color('#4a90e2'),
  secondary: color('#f3efe8'),
  accent: color('#4a90e2'),
  error: color('#dc2626'),
  warning: color('#d97706'),
  success: color('#16a34a'),
  info: color('#2563eb'),
  text: color('#2c3e50'),
  textMuted: color('#7f8c8d'),
  background: color('#fffdf8'),
  backgroundPanel: color('#f7f4ef'),
  backgroundElement: color('#f7f4ef'),
  border: color('#e9e3d8'),
  borderActive: color('#4a90e2'),
  borderSubtle: color('#e9e3d8'),
  diffAdded: color('#4a90e2'),
  diffRemoved: color('#dc2626'),
  diffContext: color('#7f8c8d'),
  diffHunkHeader: color('#3a7bc8'),
  diffHighlightAdded: color('#2563eb'),
  diffHighlightRemoved: color('#b42318'),
  diffAddedBg: color('#4a90e214'),
  diffRemovedBg: color('#dc26261a'),
  diffContextBg: color('#f3efe8'),
  diffLineNumber: color('#7f8c8d'),
  diffAddedLineNumberBg: color('#4a90e24d'),
  diffRemovedLineNumberBg: color('#dc26263d'),
  markdownText: color('#2c3e50'),
  markdownHeading: color('#4a90e2'),
  markdownLink: color('#4a90e2'),
  markdownLinkText: color('#3a7bc8'),
  markdownCode: color('#3b2f2a'),
  markdownBlockQuote: color('#7f8c8d'),
  markdownEmph: color('#7f8c8d'),
  markdownStrong: color('#2c3e50'),
  markdownHorizontalRule: color('#e9e3d8'),
  markdownListItem: color('#4a90e2'),
  markdownListEnumeration: color('#3a7bc8'),
  markdownImage: color('#4a90e2'),
  markdownImageText: color('#3a7bc8'),
  markdownCodeBlock: color('#3b2f2a'),
  syntaxComment: color('#9a7b66'),
  syntaxKeyword: color('#8f3f2a'),
  syntaxFunction: color('#9a3412'),
  syntaxVariable: color('#3b2f2a'),
  syntaxString: color('#4d7c0f'),
  syntaxNumber: color('#b45309'),
  syntaxType: color('#4a90e2'),
  syntaxOperator: color('#3b2f2a'),
  syntaxPunctuation: color('#2c3e50'),
  thinkingOpacity: 0.88,
};

const THEME_MAP: Record<OpenCodeThemeName, Record<OpenCodeThemeMode, OpenCodeTheme>> = {
  default: {
    dark: DEFAULT_DARK_THEME,
    light: DEFAULT_LIGHT_THEME,
  },
  konayuki: {
    dark: KONAYUKI_DARK_THEME,
    light: KONAYUKI_LIGHT_THEME,
  },
};

export function resolveOpenCodeTheme(
  mode: OpenCodeThemeMode,
  platform: MarkdownThemePlatform
): OpenCodeTheme;
export function resolveOpenCodeTheme(
  mode: OpenCodeThemeMode,
  themeName: OpenCodeThemeName,
  platform: MarkdownThemePlatform
): OpenCodeTheme;
export function resolveOpenCodeTheme(
  mode: OpenCodeThemeMode,
  themeNameOrPlatform: OpenCodeThemeName | MarkdownThemePlatform,
  maybePlatform?: MarkdownThemePlatform
): OpenCodeTheme {
  const themeName =
    maybePlatform === undefined
      ? DEFAULT_OPEN_CODE_THEME_NAME
      : (themeNameOrPlatform as OpenCodeThemeName);
  const platform =
    maybePlatform === undefined ? (themeNameOrPlatform as MarkdownThemePlatform) : maybePlatform;

  void platform;
  return THEME_MAP[themeName]?.[mode] ?? THEME_MAP.default[mode];
}
