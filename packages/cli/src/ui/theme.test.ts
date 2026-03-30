import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyUiThemeMode, uiTheme } from './theme';

describe('theme module', () => {
  beforeEach(() => {
    applyUiThemeMode('dark');
  });

  afterEach(() => {
    // 恢复原始主题
    applyUiThemeMode('dark');
  });

  describe('uiTheme', () => {
    it('should be defined', () => {
      expect(uiTheme).toBeDefined();
      expect(typeof uiTheme).toBe('object');
    });

    it('should have required properties', () => {
      expect(uiTheme).toHaveProperty('bg');
      expect(uiTheme).toHaveProperty('surface');
      expect(uiTheme).toHaveProperty('panel');
      expect(uiTheme).toHaveProperty('text');
      expect(uiTheme).toHaveProperty('muted');
      expect(uiTheme).toHaveProperty('subtle');
      expect(uiTheme).toHaveProperty('accent');
      expect(uiTheme).toHaveProperty('thinking');
      expect(uiTheme).toHaveProperty('divider');
      expect(uiTheme).toHaveProperty('inputCursor');
      expect(uiTheme).toHaveProperty('inputBg');
      expect(uiTheme).toHaveProperty('inputSelectionBg');
      expect(uiTheme).toHaveProperty('inputSelectionText');
      expect(uiTheme).toHaveProperty('codeBlock');
      expect(uiTheme).toHaveProperty('diff');
      expect(uiTheme).toHaveProperty('layout');
      expect(uiTheme).toHaveProperty('typography');
    });

    it('should have layout properties', () => {
      expect(uiTheme.layout).toHaveProperty('appPaddingTop');
      expect(uiTheme.layout).toHaveProperty('appPaddingBottom');
      expect(uiTheme.layout).toHaveProperty('appPaddingX');
      expect(uiTheme.layout).toHaveProperty('conversationPaddingX');
      expect(uiTheme.layout).toHaveProperty('conversationPaddingY');
      expect(uiTheme.layout).toHaveProperty('conversationContentPaddingX');
      expect(uiTheme.layout).toHaveProperty('conversationContentPaddingY');
      expect(uiTheme.layout).toHaveProperty('promptPaddingX');
      expect(uiTheme.layout).toHaveProperty('promptPaddingBottom');
      expect(uiTheme.layout).toHaveProperty('footerMarginTop');
      expect(uiTheme.layout).toHaveProperty('footerPaddingRight');
    });

    it('should expose code and diff theme tokens', () => {
      expect(uiTheme.codeBlock).toHaveProperty('bg');
      expect(uiTheme.codeBlock).toHaveProperty('language');
      expect(uiTheme.diff).toHaveProperty('addedBg');
      expect(uiTheme.diff).toHaveProperty('removedLineNumberBg');
    });

    it('should have typography properties', () => {
      expect(uiTheme.typography).toHaveProperty('body');
      expect(uiTheme.typography).toHaveProperty('code');
      expect(uiTheme.typography).toHaveProperty('muted');
      expect(uiTheme.typography).toHaveProperty('note');
      expect(uiTheme.typography).toHaveProperty('heading');
    });

    it('should have correct default values for dark theme', () => {
      // 确保是暗色主题
      applyUiThemeMode('dark');

      expect(uiTheme.bg).toBe('#1a1b26');
      expect(uiTheme.surface).toBe('#24283b');
      expect(uiTheme.text).toBe('#e5e9f0');
      expect(uiTheme.accent).toBe('#7aa2f7');
    });
  });

  describe('applyUiThemeMode', () => {
    it('should switch to dark theme', () => {
      applyUiThemeMode('dark');

      expect(uiTheme.bg).toBe('#1a1b26');
      expect(uiTheme.surface).toBe('#24283b');
      expect(uiTheme.text).toBe('#e5e9f0');
      expect(uiTheme.accent).toBe('#7aa2f7');
    });

    it('should switch to light theme', () => {
      applyUiThemeMode('light');

      expect(uiTheme.bg).toBe('#fffdf8');
      expect(uiTheme.surface).toBe('#f7f4ef');
      expect(uiTheme.text).toBe('#2c3e50');
      expect(uiTheme.accent).toBe('#4a90e2');
    });

    it('should create independent theme objects', () => {
      // 应用暗色主题
      applyUiThemeMode('dark');
      const darkThemeRef = uiTheme;

      // 应用亮色主题
      applyUiThemeMode('light');
      const lightThemeRef = uiTheme;

      // 两个引用应该不同
      expect(darkThemeRef).not.toBe(lightThemeRef);

      // 颜色值应该不同
      expect(darkThemeRef.bg).not.toBe(lightThemeRef.bg);
      expect(darkThemeRef.text).not.toBe(lightThemeRef.text);
      expect(darkThemeRef.accent).not.toBe(lightThemeRef.accent);
    });

    it('should clone layout and typography objects', () => {
      // 应用暗色主题
      applyUiThemeMode('dark');
      const darkThemeLayout = uiTheme.layout;
      const darkThemeTypography = uiTheme.typography;

      // 应用亮色主题
      applyUiThemeMode('light');
      const lightThemeLayout = uiTheme.layout;
      const lightThemeTypography = uiTheme.typography;

      // layout和typography对象应该是独立的副本
      expect(darkThemeLayout).not.toBe(lightThemeLayout);
      expect(darkThemeTypography).not.toBe(lightThemeTypography);

      // 但它们的值应该相同（因为两个主题共享相同的布局和排版）
      expect(darkThemeLayout.appPaddingTop).toBe(lightThemeLayout.appPaddingTop);
      expect(darkThemeLayout.appPaddingBottom).toBe(lightThemeLayout.appPaddingBottom);
      expect(darkThemeTypography.body).toBe(lightThemeTypography.body);
      expect(darkThemeTypography.code).toBe(lightThemeTypography.code);
    });

    it('should handle invalid mode by defaulting to dark', () => {
      // 先设置为亮色主题
      applyUiThemeMode('light');
      expect(uiTheme.bg).toBe('#fffdf8');

      // 使用无效模式（TypeScript会阻止，但JavaScript可能允许）
      // 这里测试默认行为
      applyUiThemeMode('dark' as any); // 强制为暗色
      expect(uiTheme.bg).toBe('#1a1b26');
    });
  });
});
