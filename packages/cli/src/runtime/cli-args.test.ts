import { describe, expect, it } from 'vitest';

import { applyCliArgsToEnv } from './cli-args';

describe('applyCliArgsToEnv', () => {
  it('maps --conversationId to AGENT_CONVERSATION_ID', () => {
    const env: NodeJS.ProcessEnv = {};

    const result = applyCliArgsToEnv(['--conversationId', 'conv-123'], env);

    expect(result).toEqual({ ok: true });
    expect(env.AGENT_CONVERSATION_ID).toBe('conv-123');
  });

  it('supports inline conversation id syntax', () => {
    const env: NodeJS.ProcessEnv = {};

    const result = applyCliArgsToEnv(['--conversationId=conv-123'], env);

    expect(result).toEqual({ ok: true });
    expect(env.AGENT_CONVERSATION_ID).toBe('conv-123');
  });

  it('maps --theme to RENX_THEME', () => {
    const env: NodeJS.ProcessEnv = {};

    const result = applyCliArgsToEnv(['--theme', 'konayuki'], env);

    expect(result).toEqual({ ok: true });
    expect(env.RENX_THEME).toBe('konayuki');
  });

  it('supports inline theme syntax', () => {
    const env: NodeJS.ProcessEnv = {};

    const result = applyCliArgsToEnv(['--theme=default'], env);

    expect(result).toEqual({ ok: true });
    expect(env.RENX_THEME).toBe('default');
  });

  it('returns an error when conversation id is missing', () => {
    const env: NodeJS.ProcessEnv = {};

    const result = applyCliArgsToEnv(['--conversationId'], env);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('--conversationId');
  });

  it('returns an error when theme is missing', () => {
    const env: NodeJS.ProcessEnv = {};

    const result = applyCliArgsToEnv(['--theme'], env);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('--theme');
  });

  it('returns the CLI version for -v', () => {
    const env: NodeJS.ProcessEnv = {};

    const result = applyCliArgsToEnv(['-v'], env, '0.0.15');

    expect(result).toEqual({
      ok: true,
      shouldExit: true,
      output: '0.0.15',
    });
  });
});
