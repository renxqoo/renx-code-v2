import { describe, expect, it } from 'vitest';

import { resolveOpenCodeTheme } from './open-code-theme';
import { getSyntaxRules } from './opencode-markdown';

describe('getSyntaxRules', () => {
  it('covers additional common semantic scopes with consistent theme styles', () => {
    const theme = resolveOpenCodeTheme('dark', 'win32');
    const rules = getSyntaxRules(theme, { platform: 'win32' });
    const findRule = (scope: string) => rules.find((rule) => rule.scope.includes(scope));

    expect(findRule('comment.line')?.style).toEqual({
      foreground: theme.syntaxComment,
      italic: true,
    });
    expect(findRule('comment.block')?.style).toEqual({
      foreground: theme.syntaxComment,
      italic: true,
    });
    expect(findRule('number.integer')?.style).toEqual({
      foreground: theme.syntaxNumber,
    });
    expect(findRule('constant.numeric')?.style).toEqual({
      foreground: theme.syntaxNumber,
    });
    expect(findRule('type.interface')?.style).toEqual({
      foreground: theme.syntaxType,
    });
    expect(findRule('variable.readonly')?.style).toEqual({
      foreground: theme.syntaxVariable,
    });
    expect(findRule('function.definition')?.style).toEqual({
      foreground: theme.syntaxFunction,
    });
    expect(findRule('function.macro')?.style).toEqual({
      foreground: theme.syntaxFunction,
    });
    expect(findRule('punctuation.separator')?.style).toEqual({
      foreground: theme.syntaxPunctuation,
    });
    expect(findRule('operator.assignment')?.style).toEqual({
      foreground: theme.syntaxOperator,
    });
    expect(findRule('keyword.async')?.style).toEqual({
      foreground: theme.syntaxKeyword,
      italic: true,
    });
    expect(findRule('markup.inserted')?.style).toEqual({
      foreground: theme.diffAdded,
      background: theme.diffAddedBg,
    });
    expect(findRule('markup.deleted')?.style).toEqual({
      foreground: theme.diffRemoved,
      background: theme.diffRemovedBg,
    });
    expect(findRule('markup.changed')?.style).toEqual({
      foreground: theme.diffContext,
      background: theme.diffContextBg,
    });
    expect(findRule('meta')?.style).toEqual({
      foreground: theme.textMuted,
    });
  });

  it('disables italic and underline embellishments on darwin while keeping color mappings', () => {
    const theme = resolveOpenCodeTheme('light', 'darwin');
    const rules = getSyntaxRules(theme, { platform: 'darwin' });
    const findRule = (scope: string) => rules.find((rule) => rule.scope.includes(scope));

    expect(findRule('comment.line')?.style).toEqual({
      foreground: theme.syntaxComment,
      italic: false,
    });
    expect(findRule('keyword.async')?.style).toEqual({
      foreground: theme.syntaxKeyword,
      italic: false,
    });
    expect(findRule('markup.link.text')?.style).toEqual({
      foreground: theme.markdownLinkText,
      underline: false,
    });
  });
});
