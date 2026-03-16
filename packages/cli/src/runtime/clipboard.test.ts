import { describe, expect, it } from 'bun:test';

import { buildClipboardInput, getClipboardCommandCandidates } from './clipboard';

describe('clipboard runtime', () => {
  it('returns pbcopy on macOS', () => {
    expect(getClipboardCommandCandidates('darwin', {} as NodeJS.ProcessEnv)).toEqual([
      { command: 'pbcopy', args: [] },
    ]);
  });

  it('returns Windows clipboard candidates with Unicode-safe defaults', () => {
    expect(getClipboardCommandCandidates('win32', {} as NodeJS.ProcessEnv)).toEqual([
      {
        command: 'powershell.exe',
        args: [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false); Set-Clipboard -Value ([Console]::In.ReadToEnd())',
        ],
        stdinEncoding: 'utf8',
      },
      {
        command: 'clip',
        args: [],
        stdinEncoding: 'utf16le',
        prependBom: true,
      },
    ]);
  });

  it('encodes clip input as UTF-16LE with BOM on Windows', () => {
    const payload = buildClipboardInput('中文 copy', {
      command: 'clip',
      args: [],
      stdinEncoding: 'utf16le',
      prependBom: true,
    });

    expect(Buffer.isBuffer(payload)).toBe(true);
    expect((payload as Buffer).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xfe]));
    expect((payload as Buffer).subarray(2).toString('utf16le')).toBe('中文 copy');
  });

  it('prefers Wayland tools when WAYLAND_DISPLAY is present', () => {
    expect(
      getClipboardCommandCandidates('linux', {
        WAYLAND_DISPLAY: 'wayland-0',
      } as NodeJS.ProcessEnv)
    ).toEqual([{ command: 'wl-copy', args: [] }]);
  });

  it('returns X11 candidates when DISPLAY is present', () => {
    expect(
      getClipboardCommandCandidates('linux', {
        DISPLAY: ':0',
      } as NodeJS.ProcessEnv)
    ).toEqual([
      { command: 'xclip', args: ['-selection', 'clipboard'] },
      { command: 'xsel', args: ['--clipboard', '--input'] },
      { command: 'wl-copy', args: [] },
    ]);
  });

  it('falls back to wl-copy on Linux without display hints', () => {
    expect(getClipboardCommandCandidates('linux', {} as NodeJS.ProcessEnv)).toEqual([
      { command: 'wl-copy', args: [] },
    ]);
  });
});
