export const RELEASE_TARGETS = [
  {
    id: 'darwin-arm64',
    os: 'darwin',
    cpu: 'arm64',
    binaryName: 'renx',
    bunTarget: 'bun-darwin-arm64',
    packageName: '@renxqoo/renx-code-darwin-arm64',
  },
  {
    id: 'darwin-x64',
    os: 'darwin',
    cpu: 'x64',
    binaryName: 'renx',
    bunTarget: 'bun-darwin-x64',
    packageName: '@renxqoo/renx-code-darwin-x64',
  },
  {
    id: 'linux-arm64',
    os: 'linux',
    cpu: 'arm64',
    binaryName: 'renx',
    bunTarget: 'bun-linux-arm64',
    packageName: '@renxqoo/renx-code-linux-arm64',
  },
  {
    id: 'linux-x64',
    os: 'linux',
    cpu: 'x64',
    binaryName: 'renx',
    bunTarget: 'bun-linux-x64',
    packageName: '@renxqoo/renx-code-linux-x64',
  },
  {
    id: 'win32-x64',
    os: 'win32',
    cpu: 'x64',
    binaryName: 'renx.exe',
    bunTarget: 'bun-windows-x64',
    packageName: '@renxqoo/renx-code-win32-x64',
  },
];

export const RELEASE_TARGET_BY_ID = new Map(RELEASE_TARGETS.map((target) => [target.id, target]));

export const resolveReleaseTarget = (platform, arch) =>
  RELEASE_TARGETS.find((target) => target.os === platform && target.cpu === arch) ?? null;
