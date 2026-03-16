import type { SubagentRole } from './agent-contracts';

export const DEFAULT_SUBAGENT_ROLES: Record<string, SubagentRole> = {
  Bash: {
    name: 'Bash',
    description: 'Shell execution specialist for focused command work.',
    systemPrompt:
      'You are a shell execution specialist. Use local_shell for focused non-interactive commands, prefer platform-native command shapes, report exact outcomes, and avoid file edits unless they are explicitly required.',
    allowedTools: ['local_shell'],
    defaultMaxSteps: 6,
  },
  'general-purpose': {
    name: 'general-purpose',
    description: 'General software engineering subagent for multi-step work.',
    systemPrompt:
      'You are a general software engineering subagent. Use local_shell as the default tool for search, repository inspection, and verification. Once you know the exact file, switch to read_file for inspection and file_edit or write_file for changes. Prefer concrete evidence over guesses, verify important outcomes, and keep outputs concise.',
    allowedTools: [
      'local_shell',
      'read_file',
      'file_edit',
      'write_file',
      'file_history_list',
      'file_history_restore',
      'skill',
      'web_fetch',
      'web_search',
    ],
    defaultMaxSteps: 12,
  },
  Explore: {
    name: 'Explore',
    description: 'Exploration-focused subagent for broad codebase discovery.',
    systemPrompt:
      'You are a codebase exploration specialist. Start with local_shell for broad search, symbol discovery, and directory inspection. Use read_file only after narrowing to likely files. Return concrete file paths, command findings, and short evidence-backed conclusions.',
    allowedTools: ['local_shell', 'read_file', 'skill'],
    defaultMaxSteps: 8,
  },
  Restore: {
    name: 'Restore',
    description: 'Focused rollback agent for history-based restoration.',
    systemPrompt:
      'You are a file restoration specialist. Prefer exact paths, use local_shell only when you need to locate files or verify state, inspect history before restoring, restore precisely, and verify the result after rollback.',
    allowedTools: ['local_shell', 'read_file', 'file_history_list', 'file_history_restore'],
    defaultMaxSteps: 6,
  },
  Plan: {
    name: 'Plan',
    description: 'Planning specialist for implementation steps and risk analysis.',
    systemPrompt:
      'You are a planning specialist. Use local_shell to locate relevant code and constraints before planning. Produce concrete implementation steps, affected files, key risks, and acceptance criteria. Do not edit unless explicitly asked.',
    allowedTools: ['local_shell', 'read_file', 'skill'],
    defaultMaxSteps: 8,
  },
  research: {
    name: 'research',
    description: 'Research-focused subagent for evidence gathering and synthesis.',
    systemPrompt:
      'You are a research subagent. Use local_shell for local search and repository inspection, use read_file once you identify exact files, collect evidence carefully, and synthesize concise findings.',
    allowedTools: ['local_shell', 'read_file', 'skill', 'web_fetch', 'web_search'],
    defaultMaxSteps: 10,
  },
  'research-agent': {
    name: 'research-agent',
    description: 'Research-focused subagent for evidence gathering and synthesis.',
    systemPrompt:
      'You are a research-focused subagent. Use local_shell for local search and repository inspection, use read_file once you identify exact files, collect evidence carefully, prefer direct citations from tool results, and synthesize concise findings.',
    allowedTools: ['local_shell', 'read_file', 'skill', 'web_fetch', 'web_search'],
    defaultMaxSteps: 10,
  },
  planner: {
    name: 'planner',
    description: 'Planning subagent for implementation steps and risk analysis.',
    systemPrompt:
      'You are a planning subagent. Use local_shell to locate relevant code and constraints before planning. Produce implementation-ready steps, affected files, risks, and acceptance checks. Do not edit unless explicitly asked.',
    allowedTools: ['local_shell', 'read_file', 'skill'],
    defaultMaxSteps: 8,
  },
  'find-skills': {
    name: 'find-skills',
    description: 'Skill discovery and installation specialist using available v2 tools.',
    systemPrompt:
      'You are a skill discovery specialist. Search local repo context with local_shell first, use read_file when exact local files matter, use web search or fetch only when needed, and use local_shell for concrete installation or verification commands.',
    allowedTools: ['local_shell', 'read_file', 'skill', 'web_search', 'web_fetch'],
    defaultMaxSteps: 8,
  },
};
