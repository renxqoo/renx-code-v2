import { describe, expect, it } from 'vitest';

import { buildHelpText, isVersionFlagOnly, parseCliCommand } from './cli-commands';

describe('cli-commands', () => {
  it('parses default tui mode', () => {
    expect(parseCliCommand([])).toMatchObject({ command: 'tui', errors: [] });
  });

  it('parses run command with prompt and options', () => {
    expect(parseCliCommand(['run', 'hello world', '--session-id', 's1', '--json'])).toMatchObject({
      command: 'run',
      prompt: 'hello world',
      sessionId: 's1',
      json: true,
      outputMode: 'json',
      errors: [],
    });
  });

  it('parses ask command with inline model flag', () => {
    expect(parseCliCommand(['ask', 'what', 'is', 'this', '--model=gpt-5'])).toMatchObject({
      command: 'ask',
      prompt: 'what is this',
      modelId: 'gpt-5',
      outputMode: 'text',
      errors: [],
    });
  });

  it('parses explicit output mode', () => {
    expect(parseCliCommand(['run', 'hello', '--output', 'json'])).toMatchObject({
      command: 'run',
      outputMode: 'json',
      json: true,
    });
    expect(parseCliCommand(['session', 'list', '--output=text'])).toMatchObject({
      command: 'session:list',
      outputMode: 'text',
      json: false,
    });
  });

  it('parses theme override', () => {
    expect(parseCliCommand(['--theme', 'konayuki'])).toMatchObject({
      command: 'tui',
      themeName: 'konayuki',
      errors: [],
    });
    expect(parseCliCommand(['run', 'hello', '--theme=default'])).toMatchObject({
      command: 'run',
      themeName: 'default',
      errors: [],
    });
  });

  it('reports invalid theme name', () => {
    const result = parseCliCommand(['--theme', 'unknown']);
    expect(result.errors[0]).toContain('Invalid value for --theme');
  });

  it('parses internal tree-sitter diagnose command', () => {
    expect(parseCliCommand(['__tree-sitter-diagnose', '--output', 'json'])).toMatchObject({
      command: 'internal:tree-sitter-diagnose',
      outputMode: 'json',
      json: true,
      errors: [],
    });
  });

  it('reports invalid output mode', () => {
    const result = parseCliCommand(['run', 'hello', '--output', 'yaml']);
    expect(result.errors[0]).toContain('Invalid value for --output');
  });

  it('parses session commands', () => {
    expect(parseCliCommand(['session', 'list'])).toMatchObject({ command: 'session:list' });
    expect(parseCliCommand(['session', 'open', '--id', 's01'])).toMatchObject({
      command: 'session:open',
      sessionId: 's01',
    });
    expect(parseCliCommand(['session', 'show', '--id=s02'])).toMatchObject({
      command: 'session:show',
      sessionId: 's02',
    });
  });

  it('reports missing run prompt', () => {
    const result = parseCliCommand(['run']);
    expect(result.errors[0]).toContain('Missing prompt');
  });

  it('reports unknown command', () => {
    const result = parseCliCommand(['wat']);
    expect(result.errors[0]).toContain('Unknown command');
  });

  it('detects version flags', () => {
    expect(isVersionFlagOnly(['--version'])).toBe(true);
    expect(isVersionFlagOnly(['run', 'x'])).toBe(false);
  });

  it('builds help text', () => {
    const help = buildHelpText();
    expect(help).toContain('renx run <prompt>');
    expect(help).toContain('session open');
    expect(help).toContain('--output <mode>');
    expect(help).toContain('--theme <name>');
    expect(help).toContain('--json                Alias for --output json');
  });
});
