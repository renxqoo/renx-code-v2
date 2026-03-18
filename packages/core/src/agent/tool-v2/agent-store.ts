import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SubagentExecutionRecord, SubagentExecutionStore } from './agent-contracts';

interface StoreFile {
  readonly schemaVersion: 1;
  readonly records: SubagentExecutionRecord[];
}

export interface FileSubagentExecutionStoreOptions {
  readonly baseDir?: string;
}

export class FileSubagentExecutionStore implements SubagentExecutionStore {
  private readonly baseDir: string;
  private readonly filePath: string;
  private operationChain: Promise<unknown> = Promise.resolve();

  constructor(options: FileSubagentExecutionStoreOptions = {}) {
    this.baseDir = path.resolve(
      options.baseDir || path.join(os.homedir(), '.renx', 'tool-v2', 'agents')
    );
    this.filePath = path.join(this.baseDir, 'executions.json');
  }

  async get(agentId: string): Promise<SubagentExecutionRecord | null> {
    return this.runExclusive(async () => {
      const state = await this.readState();
      return state.records.find((record) => record.agentId === agentId) || null;
    });
  }

  async list(): Promise<SubagentExecutionRecord[]> {
    return this.runExclusive(async () => {
      const state = await this.readState();
      return [...state.records].sort((left, right) => right.createdAt - left.createdAt);
    });
  }

  async save(record: SubagentExecutionRecord): Promise<SubagentExecutionRecord> {
    return this.runExclusive(async () => {
      const state = await this.readState();
      const index = state.records.findIndex((entry) => entry.agentId === record.agentId);
      if (index >= 0) {
        state.records[index] = record;
      } else {
        state.records.push(record);
      }
      await this.writeState(state);
      return record;
    });
  }

  private async readState(): Promise<StoreFile> {
    await fs.mkdir(this.baseDir, { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      try {
        const parsed = JSON.parse(raw) as Partial<StoreFile>;
        if (!Array.isArray(parsed.records)) {
          throw new Error('Invalid subagent execution store format');
        }
        return {
          schemaVersion: 1,
          records: parsed.records,
        };
      } catch {
        await this.quarantineCorruptedState(raw);
        return this.createEmptyState();
      }
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        return this.createEmptyState();
      }
      throw error;
    }
  }

  private async writeState(state: StoreFile): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    const tempPath = path.join(
      this.baseDir,
      `.${path.basename(this.filePath)}.${process.pid}.${randomUUID()}.tmp`
    );
    await fs.writeFile(tempPath, JSON.stringify(state, null, 2), 'utf8');
    try {
      await fs.rm(this.filePath, { force: true });
      await fs.rename(tempPath, this.filePath);
    } finally {
      await fs.rm(tempPath, { force: true });
    }
  }

  private createEmptyState(): StoreFile {
    return {
      schemaVersion: 1,
      records: [],
    };
  }

  private async quarantineCorruptedState(raw: string): Promise<void> {
    const corruptPath = path.join(
      this.baseDir,
      `executions.corrupt-${Date.now()}-${randomUUID()}.json`
    );
    try {
      await fs.rename(this.filePath, corruptPath);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== 'ENOENT') {
        await fs.writeFile(corruptPath, raw, 'utf8');
        await fs.rm(this.filePath, { force: true });
      }
    }
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationChain.then(operation, operation);
    this.operationChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}
