import { describe, expect, it } from 'vitest';

import {
  createDefaultShellCommandPolicy,
  createRuleBasedShellCommandPolicy,
  extractShellCommands,
  splitShellCommandSegments,
  tokenizeShellCommand,
} from '../shell-policy';

describe('shell-policy PowerShell parsing', () => {
  it('does not split script blocks on semicolons', () => {
    expect(
      splitShellCommandSegments(
        'Get-ChildItem -Path src | ForEach-Object { $_.Name; $_.FullName } && Get-Content -Raw package.json'
      )
    ).toEqual([
      'Get-ChildItem -Path src',
      'ForEach-Object { $_.Name; $_.FullName }',
      'Get-Content -Raw package.json',
    ]);
  });

  it('preserves PowerShell script blocks as a single token', () => {
    expect(tokenizeShellCommand(`Where-Object { $_.Name -like '*shell*' }`)).toEqual([
      'Where-Object',
      "{ $_.Name -like '*shell*' }",
    ]);
  });

  it('extracts command names from PowerShell pipelines without losing $_ references', () => {
    expect(
      extractShellCommands('Get-ChildItem -Path src | ForEach-Object { $_.Name; $_.FullName }')
    ).toEqual(['get-childitem', 'foreach-object']);
  });

  it('treats common PowerShell inspection pipelines as safe by default', () => {
    const decision = createDefaultShellCommandPolicy().evaluate(
      `Get-ChildItem -Path src | ForEach-Object { $_.Name; $_.FullName }`
    );

    expect(decision).toMatchObject({
      effect: 'allow',
      commands: ['get-childitem', 'foreach-object'],
    });
  });

  it('matches rule-based policies against PowerShell command wrappers', () => {
    const policy = createRuleBasedShellCommandPolicy({
      rules: [
        {
          name: 'powershell-wrapper',
          pattern: [{ token: 'powershell' }, { token: '-NoProfile' }, { token: '-Command' }],
          decision: 'allow',
        },
      ],
    });

    const decision = policy.evaluate(
      'powershell -NoProfile -Command "Get-Content -Raw sample.txt"'
    );

    expect(decision).toMatchObject({
      effect: 'allow',
      matchedRule: 'powershell-wrapper',
      commands: ['powershell'],
    });
  });
});
