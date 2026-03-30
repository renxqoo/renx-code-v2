export type ToolDisplayConfig = {
  displayName?: string;
  icon?: string;
  hiddenArgumentKeys?: string[];
};

const TOOL_DISPLAY_CONFIG: Record<string, ToolDisplayConfig> = {
  spawn_agent: {
    displayName: 'Agent',
    icon: '◉',
    hiddenArgumentKeys: ['prompt', 'description', 'metadata'],
  },
  agent_status: {
    displayName: 'agent status',
    icon: '◉',
  },
  wait_agents: {
    displayName: 'wait agents',
    icon: '◉',
  },
  cancel_agent: {
    displayName: 'cancel agent',
    icon: '◉',
  },
  local_shell: {
    icon: '$',
    hiddenArgumentKeys: ['command', 'description'],
  },
  read_file: {
    icon: '→',
    hiddenArgumentKeys: ['path'],
  },
  file_edit: {
    icon: '←',
    hiddenArgumentKeys: ['path'],
  },
  write_file: {
    icon: '←',
    hiddenArgumentKeys: ['path'],
  },
  glob: {
    icon: '✱',
    hiddenArgumentKeys: ['pattern', 'path'],
  },
  grep: {
    icon: '✱',
    hiddenArgumentKeys: ['pattern', 'path'],
  },
  web_fetch: {
    icon: '%',
  },
  web_search: {
    icon: '%',
  },
};

const TOOL_NAME_PREFIX_DISPLAY: Array<{ prefix: string; displayPrefix: string; icon?: string }> = [
  {
    prefix: 'task_',
    displayPrefix: 'task ',
    icon: '◉',
  },
];

export function getToolDisplayConfig(toolName: string): ToolDisplayConfig {
  return TOOL_DISPLAY_CONFIG[toolName] ?? {};
}

export function getToolDisplayName(toolName: string): string {
  const direct = getToolDisplayConfig(toolName).displayName;
  if (direct) {
    return direct;
  }

  for (const entry of TOOL_NAME_PREFIX_DISPLAY) {
    if (toolName.startsWith(entry.prefix)) {
      return toolName.replace(entry.prefix, entry.displayPrefix).replace(/_/g, ' ');
    }
  }

  return toolName;
}

export function getToolDisplayIcon(toolName: string): string {
  const direct = getToolDisplayConfig(toolName).icon;
  if (direct) {
    return direct;
  }

  for (const entry of TOOL_NAME_PREFIX_DISPLAY) {
    if (toolName.startsWith(entry.prefix) && entry.icon) {
      return entry.icon;
    }
  }

  return '⚙';
}

export function getToolHiddenArgumentKeys(toolName: string): string[] {
  const direct = getToolDisplayConfig(toolName).hiddenArgumentKeys;
  if (direct) {
    return [...direct];
  }

  return [];
}
