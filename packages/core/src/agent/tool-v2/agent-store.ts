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

  constructor(options: FileSubagentExecutionStoreOptions = {}) {
    this.baseDir = path.resolve(
      options.baseDir || path.join(os.homedir(), '.renx', 'tool-v2', 'agents')
    );
    this.filePath = path.join(this.baseDir, 'executions.json');
  }

  async get(agentId: string): Promise<SubagentExecutionRecord | null> {
    const state = await this.readState();
    return state.records.find((record) => record.agentId === agentId) || null;
  }

  async list(): Promise<SubagentExecutionRecord[]> {
    const state = await this.readState();
    return [...state.records].sort((left, right) => right.createdAt - left.createdAt);
  }

  async save(record: SubagentExecutionRecord): Promise<SubagentExecutionRecord> {
    const state = await this.readState();
    const index = state.records.findIndex((entry) => entry.agentId === record.agentId);
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
