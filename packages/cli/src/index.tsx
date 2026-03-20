import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';

import { App } from './App';
import {
  getAgentSession,
  initializeAgentSession,
  listAgentSessions,
  runAgentPromptNonInteractive,
} from './agent/runtime/runtime';
import { buildHelpText, isVersionFlagOnly, parseCliCommand } from './commands/cli-commands';
import { renderSessionDetail, renderSessionList } from './commands/session-output';
import { applyCliArgsToEnv } from './runtime/cli-args';
import { configureBundledRipgrepEnv } from './runtime/bundled-ripgrep';
import {
  bindExitGuards,
  hardResetTerminal,
  initExitRuntime,
  registerTerminalBackgroundRestore,
} from './runtime/exit';
import {
  probeTerminalColors,
  setTerminalWindowBackground,
  setTerminalWindowForeground,
} from './runtime/terminal-theme';
import { applyMarkdownThemeMode } from './ui/opencode-markdown';
import { applyUiThemeMode, uiTheme } from './ui/theme';

declare const RENX_BUILD_VERSION: string | undefined;

const resolveCliVersion = (): string => {
  if (process.env.RENX_VERSION) {
    return process.env.RENX_VERSION;
  }

  if (typeof RENX_BUILD_VERSION !== 'undefined' && RENX_BUILD_VERSION) {
    return RENX_BUILD_VERSION;
  }

  const packageRoots = [
    path.resolve(path.dirname(process.execPath), '..'),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
  ];

  for (const packageRoot of packageRoots) {
    try {
      const packageJson = JSON.parse(
        readFileSync(path.join(packageRoot, 'package.json'), 'utf8')
      ) as { version?: string };
      if (packageJson.version) {
        return packageJson.version;
      }
    } catch {
      continue;
    }
  }

  return '0.0.0';
};

const startTui = async () => {
  bindExitGuards();
  process.env.OPENTUI_FORCE_WCWIDTH ??= '1';
  const terminalColors = await probeTerminalColors();
  applyUiThemeMode(terminalColors.mode);
  applyMarkdownThemeMode(terminalColors.mode, process.platform);

  if (
    terminalColors.rawBackgroundColor &&
    terminalColors.rawBackgroundColor.toLowerCase() !== uiTheme.bg.toLowerCase()
  ) {
    const originalBackground = terminalColors.rawBackgroundColor;
    setTerminalWindowBackground(uiTheme.bg);
    registerTerminalBackgroundRestore(() => {
      setTerminalWindowBackground(originalBackground);
    });
  }

  if (
    terminalColors.rawForegroundColor &&
    terminalColors.rawForegroundColor.toLowerCase() !== uiTheme.userPromptText.toLowerCase()
  ) {
    const originalForeground = terminalColors.rawForegroundColor;
    setTerminalWindowForeground(uiTheme.userPromptText);
    registerTerminalBackgroundRestore(() => {
      setTerminalWindowForeground(originalForeground);
    });
  }

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    onDestroy: hardResetTerminal,
    backgroundColor: uiTheme.bg,
  });
  initExitRuntime(renderer);
  createRoot(renderer).render(<App />);
};

const cliVersion = resolveCliVersion();
configureBundledRipgrepEnv();
const cliArgsResult = applyCliArgsToEnv(undefined, process.env, cliVersion);
if (!cliArgsResult.ok) {
  console.error(cliArgsResult.error);
  process.exit(2);
}
if (cliArgsResult.shouldExit) {
  if (cliArgsResult.output) {
    console.log(cliArgsResult.output);
  }
  process.exit(0);
}

const argv = process.argv.slice(2);
if (isVersionFlagOnly(argv)) {
  console.log(cliVersion);
  process.exit(0);
}

const parsed = parseCliCommand(argv);
if (parsed.cwd) {
  process.env.AGENT_WORKDIR = parsed.cwd;
  process.chdir(parsed.cwd);
}
if (parsed.sessionId) {
  process.env.AGENT_SESSION_ID = parsed.sessionId;
  process.env.AGENT_CONVERSATION_ID = parsed.sessionId;
}
if (parsed.modelId) {
  process.env.AGENT_MODEL = parsed.modelId;
}

if (parsed.helpRequested) {
  console.log(buildHelpText());
  process.exit(0);
}
if (parsed.errors.length > 0) {
  console.error(parsed.errors.join('\n'));
  console.error('');
  console.error(buildHelpText());
  process.exit(2);
}

if (parsed.command === 'run' || parsed.command === 'ask') {
  const outputMode = parsed.outputMode;
  const result = await runAgentPromptNonInteractive(parsed.prompt ?? '', parsed.command, {
    sessionId: parsed.sessionId,
    modelId: parsed.modelId,
    autoApprove: parsed.autoApprove,
    onStdout: outputMode === 'text' ? (chunk) => process.stdout.write(chunk) : undefined,
    onStderr: (chunk) => process.stderr.write(chunk),
  });

  if (outputMode === 'json') {
    console.log(
      JSON.stringify(
        {
          ok: result.completionReason !== 'error',
          mode: parsed.command,
          sessionId: result.conversationId,
          executionId: result.executionId,
          model: result.modelLabel,
          text: result.text,
          completionReason: result.completionReason,
          completionMessage: result.completionMessage,
          usage: result.usage,
        },
        null,
        2
      )
    );
  }

  process.exit(result.completionReason === 'error' ? 1 : 0);
}

if (parsed.command === 'session:list') {
  const sessions = await listAgentSessions(50);
  if (parsed.outputMode === 'json') {
    console.log(JSON.stringify(sessions, null, 2));
  } else {
    console.log(renderSessionList(sessions));
  }
  process.exit(0);
}

if (parsed.command === 'session:show') {
  const session = await getAgentSession(parsed.sessionId ?? '');
  if (parsed.outputMode === 'json') {
    console.log(JSON.stringify(session, null, 2));
  } else {
    console.log(renderSessionDetail(session));
  }
  process.exit(session ? 0 : 1);
}

if (parsed.command === 'session:open') {
  await initializeAgentSession({
    sessionId: parsed.sessionId,
    modelId: parsed.modelId,
  });
  await startTui();
  process.exit(0);
}

await initializeAgentSession({
  sessionId: parsed.sessionId,
  modelId: parsed.modelId,
});
await startTui();
process.exit(0);
