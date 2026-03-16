export type CommandContext = {
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  repoRoot: string;
};

export type CommandResult = {
  exitCode: number;
  stdout?: string;
  stderr?: string;
};
