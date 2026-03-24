export type ReleaseScope = 'all' | 'main-only' | 'platform-only';

const hasFlag = (values: string[], flag: string): boolean => values.includes(flag);

const takeArgValues = (flag: string, values: string[]): string[] => {
  const selected: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] !== flag) {
      continue;
    }

    const value = values[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${flag}`);
    }
    selected.push(value);
    index += 1;
  }
  return selected;
};

export const resolveReleaseScope = (values: string[]): ReleaseScope => {
  const legacySingle = hasFlag(values, '--single');
  const legacyAll = hasFlag(values, '--all');
  const platformOnly = hasFlag(values, '--platform-only');
  const mainOnly = hasFlag(values, '--main-only');

  if (legacySingle && legacyAll) {
    throw new Error('Cannot use --single and --all together.');
  }

  if (platformOnly && mainOnly) {
    throw new Error('Cannot use --platform-only and --main-only together.');
  }

  if (legacyAll && (platformOnly || mainOnly)) {
    throw new Error('Cannot combine --all with --platform-only or --main-only.');
  }

  if (legacySingle && mainOnly) {
    throw new Error('Cannot combine --single with --main-only.');
  }

  if (platformOnly) {
    return 'platform-only';
  }

  if (mainOnly) {
    return 'main-only';
  }

  return 'all';
};

export const resolveExplicitTargets = (values: string[]): string[] => {
  return takeArgValues('--target', values);
};

export const resolvePrepareArgs = (values: string[]): string[] => {
  const scope = resolveReleaseScope(values);
  const args: string[] = [];

  if (hasFlag(values, '--single')) {
    args.push('--single');
  }
  if (hasFlag(values, '--all')) {
    args.push('--all');
  }

  if (scope === 'platform-only') {
    args.push('--platform-only');
  }
  if (scope === 'main-only') {
    args.push('--main-only');
  }

  for (const target of resolveExplicitTargets(values)) {
    args.push('--target', target);
  }

  if (hasFlag(values, '--skip-install')) {
    args.push('--skip-install');
  }

  return args;
};

export const resolvePackArgs = (values: string[]): string[] => {
  return hasFlag(values, '--dry-run') ? ['--dry-run'] : [];
};

export const resolvePublishArgs = (values: string[]): string[] => {
  const selected: string[] = [];
  for (const flag of ['--tag', '--otp']) {
    for (const value of takeArgValues(flag, values)) {
      selected.push(flag, value);
    }
  }
  return selected;
};

export const filterReleasePackageDirs = (packageDirs: string[], scope: ReleaseScope): string[] => {
  if (scope === 'main-only') {
    return packageDirs.filter((packageDir) => /[\\/]main$/i.test(packageDir));
  }

  if (scope === 'platform-only') {
    return packageDirs.filter((packageDir) => /[\\/]platforms[\\/]/i.test(packageDir));
  }

  return packageDirs;
};
