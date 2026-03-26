import path from 'node:path';

export const toBundledBunfsPath = (
  assetPath: string,
  platform: NodeJS.Platform = process.platform
): string => {
  const fileName = path.basename(assetPath).replaceAll('\\', '/');
  const root = platform === 'win32' ? 'B:/~BUN/root' : '/$bunfs/root';
  return `${root}/${fileName}`;
};
