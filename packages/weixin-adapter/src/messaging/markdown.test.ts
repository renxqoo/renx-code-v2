import { describe, it, expect } from 'vitest';
import { stripMarkdown, markdownToPlainText } from './markdown.js';

describe('stripMarkdown', () => {
  it('should strip bold markers', () => {
    expect(stripMarkdown('hello **world**')).toBe('hello world');
  });

  it('should strip italic markers', () => {
    expect(stripMarkdown('hello _world_')).toBe('hello world');
  });

  it('should strip heading markers', () => {
    expect(stripMarkdown('## Title')).toBe('Title');
  });

  it('should strip inline code', () => {
    expect(stripMarkdown('use `console.log`')).toBe('use console.log');
  });

  it('should handle empty string', () => {
    expect(stripMarkdown('')).toBe('');
  });
});

describe('markdownToPlainText', () => {
  it('should strip code blocks but keep code content', () => {
    const input = 'Here is code:\n```js\nconst x = 1;\n```\nDone.';
    const result = markdownToPlainText(input);
    expect(result).toContain('const x = 1;');
    expect(result).not.toContain('```');
  });

  it('should convert links to display text', () => {
    const input = 'Check [this link](https://example.com) out.';
    expect(markdownToPlainText(input)).toBe('Check this link out.');
  });

  it('should remove images', () => {
    const input = 'Text ![alt](image.png) more';
    expect(markdownToPlainText(input)).toBe('Text  more');
  });

  it('should handle plain text', () => {
    expect(markdownToPlainText('Hello world')).toBe('Hello world');
  });
});
