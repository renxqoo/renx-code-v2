import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ShellRuntime } from './runtimes/shell-runtime';
import {
  shellRuntimeSupportsBackground,
  type ShellBackgroundExecutionRecord,
  type ShellBackgroundRuntime,
} from './runtimes/shell-runtime';
import { ToolV2ExecutionError, ToolV2ResourceNotFoundError } from './errors';

interface StoreFile {
  readonly schemaVersion: 1;
  readonly records: ShellBackgroundExecutionRecord[];
}

export interface ShellBackgroundExecutionStore {
  get(taskId: string): Promise<ShellBackgroundExecutionRecord | null>;
  list(): Promise<ShellBackgroundExecutionRecord[]>;
  save(record: ShellBackgroundExecutionRecord): Promise<ShellBackgroundExecutionRecord>;
}

export interface FileShellBackgroundExecutionStoreOptions {
  readonly baseDir?: string;
}

export class FileShellBackgroundExecutionStore implements ShellBackgroundExecutionStore {
  private readonly baseDir: string;
  private readonly filePath: string;

  constructor(options: FileShellBackgroundExecutionStoreOptions = {}) {
    this.baseDir = path.resolve(
      options.baseDir || path.join(os.homedir(), '.renx', 'tool-v2', 'shell')
    );
    this.filePath = path.join(this.baseDir, 'background-executions.json');
  }

  async get(taskId: string): Promise<ShellBackgroundExecutionRecord | null> {
    const state = await this.readState();
    return state.records.find((record) => record.taskId === taskId) || null;
  }

  async list(): Promise<ShellBackgroundExecutionRecord[]> {
    const state = await this.readState();
    return [...state.records].sort((left, right) => right.createdAt - left.createdAt);
  }

  async save(record: ShellBackgroundExecutionRecord): Promise<ShellBackgroundExecutionRecord> {
    const state = await this.readState();
    const index = state.records.findIndex((entry) => entry.taskId === record.taskId);
    if (index >= 0) {
      state.records[index] = record;
    } else {
      state.records.push(record);
    }
    await this.writeState(state);
    return record;
  }

  private async readState(): Promise<StoreFile> {
    await fs.mkdir(this.baseDir, { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoreFile>;
      return {
        schemaVersion: 1,
        records: parsed.records || [],
      };
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return {
          schemaVersion: 1,
          records: [],
        };
      }
      throw error;
    }
  }

  private async writeState(state: StoreFile): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(state, null, 2), 'utf8');
  }
}

export class ShellBackgroundExecutionService {
  constructor(
    private readonly runtime: ShellRuntime,
    private readonly store: ShellBackgroundExecutionStore
  ) {}

  async start(
    request: Parameters<ShellBackgroundRuntime['startBackground']>[0]
  ): Promise<ShellBackgroundExecutionRecord> {
    if (!shellRuntimeSupportsBackground(this.runtime)) {
      throw new ToolV2ExecutionError('Shell runtime does not support background execution');
    }
    const started = await (this.runtime as ShellBackgroundRuntime).startBackground(request);
    await this.store.save(started);
    return started;
  }

  async get(taskId: string): Promise<ShellBackgroundExecutionRecord> {
    const existing = await this.store.get(taskId);
    if (!existing) {
      throw new ToolV2ResourceNotFoundError('Shell background task not found', {
        taskId,
      });
    }
    if (!shellRuntimeSupportsBackground(this.runtime)) {
      return existing;
    }
    const refreshed = await (this.runtime as ShellBackgroundRuntime).pollBackground(existing);
    await this.store.save(refreshed);
    return refreshed;
  }

  async cancel(taskId: string, reason?: string): Promise<ShellBackgroundExecutionRecord> {
    const existing = await this.store.get(taskId);
    if (!existing) {
      throw new ToolV2ResourceNotFoundError('Shell background task not found', {
        taskId,
      });
    }
    if (!shellRuntimeSupportsBackground(this.runtime)) {
      throw new ToolV2ExecutionError('Shell runtime does not support background execution');
    }
    const cancelled = await (this.runtime as ShellBackgroundRuntime).cancelBackground(
      existing,
      reason
    );
    await this.store.save(cancelled);
    return cancelled;
  }
}

export function isTerminalShellBackgroundStatus(
  status: ShellBackgroundExecutionRecord['status']
): boolean {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'timed_out'
  );
}
