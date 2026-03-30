import { describe, expect, it } from 'bun:test';

import { DEFAULT_OPEN_CODE_THEME_NAME } from './theme-name';
import { uiTheme, uiThemeName, applyUiTheme, applyUiThemeMode } from './theme';

describe('theme module', () => {
  it('should have required properties', () => {
    expect(uiTheme).toBeDefined();
    expect(typeof uiTheme).toBe('object');

    // 检查关键属性
    expect(uiTheme.bg).toBeString();
    expect(uiTheme.surface).toBeString();
    expect(uiTheme.text).toBeString();
    expect(uiTheme.accent).toBeString();
    expect(uiTheme.layout).toBeObject();
    expect(uiTheme.typography).toBeObject();
  });

  it('should switch to dark theme', () => {
    applyUiTheme('default', 'dark');

    expect(uiTheme.bg).toBe('#09090b');
    expect(uiTheme.surface).toBe('#18181b');
    expect(uiTheme.text).toBe('#fafafa');
    expect(uiTheme.accent).toBe('#8e51ff');
  });

  it('should switch to light theme', () => {
    applyUiTheme('default', 'light');

    expect(uiTheme.bg).toBe('#ffffff');
    expect(uiTheme.surface).toBe('#ffffff');
    expect(uiTheme.text).toBe('#09090b');
    expect(uiTheme.accent).toBe('#7f22fe');
  });

  it('should default to konayuki theme name', () => {
    expect(DEFAULT_OPEN_CODE_THEME_NAME).toBe('konayuki');

    applyUiTheme('konayuki', 'dark');
    expect(uiThemeName).toBe('konayuki');
    expect(uiTheme.bg).toBe('#1a1b26');
    expect(uiTheme.accent).toBe('#7aa2f7');
  });

  it('should switch to konayuki dark theme while preserving dark mode semantics', () => {
    applyUiTheme('konayuki', 'dark');

    expect(uiTheme.bg).toBe('#1a1b26');
    expect(uiTheme.surface).toBe('#24283b');
    expect(uiTheme.text).toBe('#e5e9f0');
    expect(uiTheme.accent).toBe('#7aa2f7');
    expect(uiTheme.codeBlock.bg).toBe('#24283b');
  });

  it('should switch to konayuki light theme', () => {
    applyUiTheme('konayuki', 'light');

    expect(uiTheme.bg).toBe('#fffdf8');
    expect(uiTheme.surface).toBe('#f7f4ef');
    expect(uiTheme.text).toBe('#2c3e50');
    expect(uiTheme.accent).toBe('#4a90e2');
    expect(uiTheme.codeBlock.bg).toBe('#f7f4ef');
  });

  it('should create independent theme objects', () => {
    // 应用暗色主题
    applyUiThemeMode('dark');
    const darkThemeBg = uiTheme.bg;
    const darkThemeText = uiTheme.text;

    // 应用亮色主题
    applyUiThemeMode('light');
    const lightThemeBg = uiTheme.bg;
    const lightThemeText = uiTheme.text;

    // 颜色值应该不同
    expect(darkThemeBg).not.toBe(lightThemeBg);
    expect(darkThemeText).not.toBe(lightThemeText);
  });
});
