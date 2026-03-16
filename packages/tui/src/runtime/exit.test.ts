import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CliRenderer } from '@opentui/core';
import {
  bindExitGuards,
  hardResetTerminal,
  initExitRuntime,
  registerTerminalBackgroundRestore,
  requestExit,
} from './exit';

const originalProcess = global.process;
const mockProcess = {
  ...originalProcess,
  stdout: {
    ...originalProcess.stdout,
    isTTY: true,
    write: vi.fn(() => {}),
  },
  stdin: {
    ...originalProcess.stdin,
    isTTY: true,
    setRawMode: vi.fn(() => {}),
  },
  on: vi.fn(() => {}),
  once: vi.fn(() => {}),
  exit: vi.fn(() => {}),
};

const originalConsoleError = console.error;
const mockConsoleError = vi.fn(() => {});

describe('exit module', () => {
  beforeEach(() => {
    mockProcess.stdout.write.mockClear();
    mockProcess.stdin.setRawMode.mockClear();
    mockProcess.on.mockClear();
    mockProcess.once.mockClear();
    mockProcess.exit.mockClear();
    mockConsoleError.mockClear();
    mockProcess.stdout.isTTY = true;
    mockProcess.stdin.isTTY = true;

    global.process = mockProcess as unknown as typeof process;
    console.error = mockConsoleError as typeof console.error;
  });

  afterEach(() => {
    global.process = originalProcess;
    console.error = originalConsoleError;
  });

  describe('registerTerminalBackgroundRestore', () => {
    it('registers restore function', () => {
      const restoreFn = () => undefined;
      registerTerminalBackgroundRestore(restoreFn);
      expect(() => registerTerminalBackgroundRestore(restoreFn)).not.toThrow();
    });

    it('allows null restore function', () => {
      expect(() => registerTerminalBackgroundRestore(null)).not.toThrow();
    });
  });

  describe('hardResetTerminal', () => {
    it('resets terminal when stdout is TTY', () => {
      hardResetTerminal();

      expect(mockProcess.stdout.write).toHaveBeenCalled();
      expect(mockProcess.stdin.setRawMode).toHaveBeenCalledWith(false);
    });

    it('does not reset terminal when stdout is not TTY', () => {
      mockProcess.stdout.isTTY = false;
      mockProcess.stdin.isTTY = false;

      hardResetTerminal();

      expect(mockProcess.stdout.write).not.toHaveBeenCalled();
      expect(mockProcess.stdin.setRawMode).not.toHaveBeenCalled();
    });

    it('calls registered restore function', () => {
      const restoreFn = vi.fn(() => {});
      registerTerminalBackgroundRestore(restoreFn);

      hardResetTerminal();

      expect(restoreFn).toHaveBeenCalled();
    });

    it('handles write errors gracefully', () => {
      mockProcess.stdout.write.mockImplementation(() => {
        throw new Error('Write error');
      });

      expect(() => hardResetTerminal()).not.toThrow();
    });
  });

  describe('initExitRuntime', () => {
    it('stores renderer reference', () => {
      const mockRenderer = {} as unknown as CliRenderer;
      initExitRuntime(mockRenderer);

      expect(() => initExitRuntime(mockRenderer)).not.toThrow();
    });
  });

  describe('requestExit', () => {
    it('exits with default code 0', async () => {
      const mockRenderer = {
        useMouse: false,
        setTerminalTitle: vi.fn(() => {}),
        disableKittyKeyboard: vi.fn(() => {}),
        destroy: vi.fn(() => {}),
      } as unknown as CliRenderer;

      initExitRuntime(mockRenderer);
      await requestExit();

      expect(mockRenderer.destroy).toHaveBeenCalled();
      expect(mockProcess.exit).toHaveBeenCalledWith(0);
    });

    it('exits with specified code', async () => {
      initExitRuntime(null as unknown as CliRenderer);
      await requestExit(1);
      expect(mockProcess.exit).toHaveBeenCalledWith(1);
    });

    it('does not exit twice if already cleaned up', async () => {
      initExitRuntime(null as unknown as CliRenderer);
      await requestExit(0);
      expect(mockProcess.exit).toHaveBeenCalledTimes(1);

      mockProcess.exit.mockClear();

      await requestExit(0);
      expect(mockProcess.exit).not.toHaveBeenCalled();
    });

    it('handles missing renderer gracefully', async () => {
      initExitRuntime(null as unknown as CliRenderer);
      await expect(requestExit(0)).resolves.toBeUndefined();
    });

    it('handles renderer errors gracefully', async () => {
      const mockRenderer = {
        useMouse: false,
        setTerminalTitle: vi.fn(() => {
          throw new Error('Title error');
        }),
        disableKittyKeyboard: vi.fn(() => {
          throw new Error('Keyboard error');
        }),
        destroy: vi.fn(() => {
          throw new Error('Destroy error');
        }),
      } as unknown as CliRenderer;

      initExitRuntime(mockRenderer);

      await expect(requestExit(0)).resolves.toBeUndefined();
      expect(mockProcess.exit).toHaveBeenCalledWith(0);
    });
  });

  describe('bindExitGuards', () => {
    it('binds exit handlers', () => {
      bindExitGuards();

      expect(mockProcess.once).toHaveBeenCalledWith('SIGINT', expect.any(Function));
      expect(mockProcess.once).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
      expect(mockProcess.once).toHaveBeenCalledWith('exit', expect.any(Function));
    });
  });
});
