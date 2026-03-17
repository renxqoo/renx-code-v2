import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

interface LockState {
  locked: boolean;
  waiters: Array<() => void>;
}

const fileLocks = new Map<string, LockState>();

async function acquireLock(filePath: string): Promise<void> {
  let lock = fileLocks.get(filePath);
  if (!lock) {
    lock = {
      locked: false,
      waiters: [],
    };
    fileLocks.set(filePath, lock);
  }

  if (!lock.locked) {
    lock.locked = true;
    return;
  }

  await new Promise<void>((resolve) => {
    lock?.waiters.push(resolve);
  });
}

function releaseLock(filePath: string): void {
  const lock = fileLocks.get(filePath);
  if (!lock) {
    return;
  }

  const next = lock.waiters.shift();
  if (next) {
    next();
    return;
  }

  lock.locked = false;
}

export class JsonFileRecordStore<T> {
  private cache?: T[];

  constructor(private readonly filePath: string) {}

  async list(): Promise<T[]> {
    return cloneValue(await this.readRecords());
  }

  async update<R>(updater: (records: T[]) => Promise<R> | R): Promise<R> {
    await acquireLock(this.filePath);
    try {
      const working = cloneValue(await this.readRecords());
      const result = await updater(working);
      await this.writeRecords(working);
      this.cache = cloneValue(working);
      return result;
    } finally {
      releaseLock(this.filePath);
    }
  }

  private async readRecords(): Promise<T[]> {
    if (this.cache) {
      return cloneValue(this.cache);
    }

    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as T[];
      this.cache = Array.isArray(parsed) ? cloneValue(parsed) : [];
      return cloneValue(this.cache);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError?.code !== 'ENOENT') {
        throw error;
      }

      await this.writeRecords([]);
      this.cache = [];
      return [];
    }
  }

  private async writeRecords(records: T[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp.${randomUUID().slice(0, 8)}`;
    await fs.writeFile(tmpPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');

    try {
      await fs.rename(tmpPath, this.filePath);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'EPERM' && process.platform === 'win32') {
        await fs.copyFile(tmpPath, this.filePath);
        await fs.unlink(tmpPath).catch(() => undefined);
        return;
      }
      throw error;
    }
  }
}
