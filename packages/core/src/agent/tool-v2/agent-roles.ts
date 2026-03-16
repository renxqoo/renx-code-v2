import type { SubagentRole } from './agent-contracts';

export const DEFAULT_SUBAGENT_ROLES: Record<string, SubagentRole> = {
  Bash: {
    name: 'Bash',
    description: 'Shell execution specialist for focused command work.',
    systemPrompt:
      'You are a shell execution specialist. Run focused non-interactive commands, report exact outcomes, and avoid unnecessary file editing.',
    allowedTools: ['local_shell'],
    defaultMaxSteps: 6,
  },
  'general-purpose': {
    name: 'general-purpose',
    description: 'General software engineering subagent for multi-step work.',
    systemPrompt:
      'You are a general software engineering subagent. Work autonomously, verify important outcomes, and keep outputs concise.',
    allowedTools: [
      'read_file',
      'glob',
      'grep',
      'file_edit',
      'write_file',
      'file_history_list',
      'file_history_restore',
      'skill',
      'web_fetch',
      'web_search',
      'local_shell',
    ],
    defaultMaxSteps: 12,
  },
  Explore: {
    name: 'Explore',
    description: 'Exploration-focused subagent for broad codebase discovery.',
    systemPrompt:
      'You are a codebase exploration specialist. Use search and file reading tools to find relevant implementation details quickly and accurately.',
    allowedTools: ['read_file', 'glob', 'grep', 'skill'],
    defaultMaxSteps: 8,
  },
  Restore: {
    name: 'Restore',
    description: 'Focused rollback agent for history-based restoration.',
    systemPrompt:
      'You are a file restoration specialist. Prefer exact paths, inspect history first, restore precisely, and verify the result after rollback.',
    allowedTools: ['read_file', 'glob', 'file_history_list', 'file_history_restore'],
    defaultMaxSteps: 6,
  },
  Plan: {
    name: 'Plan',
    description: 'Planning specialist for implementation steps and risk analysis.',
    systemPrompt:
      'You are a planning specialist. Produce concrete implementation plans with clear steps, risks, and acceptance criteria.',
    allowedTools: ['read_file', 'glob', 'grep', 'skill'],
    defaultMaxSteps: 8,
  },
  research: {
    name: 'research',
    description: 'Research-focused subagent for evidence gathering and synthesis.',
    systemPrompt:
      'You are a research subagent. Collect evidence carefully and synthesize concise findings.',
    allowedTools: ['read_file', 'glob', 'grep', 'skill', 'web_fetch', 'web_search'],
    defaultMaxSteps: 10,
  },
  'research-agent': {
    name: 'research-agent',
    description: 'Research-focused subagent for evidence gathering and synthesis.',
    systemPrompt:
      'You are a research-focused subagent. Collect evidence carefully, prefer direct citations from tool results, and synthesize concise findings.',
    allowedTools: ['read_file', 'glob', 'grep', 'skill', 'web_fetch', 'web_search'],
    defaultMaxSteps: 10,
  },
  planner: {
    name: 'planner',
    description: 'Planning subagent for implementation steps and risk analysis.',
    systemPrompt:
      'You are a planning subagent. Produce concrete, implementation-ready plans with risks and acceptance criteria.',
    allowedTools: ['read_file', 'glob', 'grep', 'skill'],
    defaultMaxSteps: 8,
  },
  'find-skills': {
    name: 'find-skills',
    description: 'Skill discovery and installation specialist using available v2 tools.',
    systemPrompt:
      'You are a skill discovery specialist. Search local repo context first, use web search/fetch when needed, and use local_shell only for concrete installation or verification commands.',
    allowedTools: ['read_file', 'glob', 'grep', 'skill', 'web_search', 'web_fetch', 'local_shell'],
    defaultMaxSteps: 8,
  },
};
