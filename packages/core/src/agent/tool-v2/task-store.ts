import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  createEmptyTaskNamespaceState,
  safeJsonClone,
  type TaskNamespaceState,
} from './task-contracts';
import { TaskToolV2Error } from './task-errors';

interface NamespaceLockState {
  locked: boolean;
  waiters: Array<() => void>;
}

export interface TaskStateStoreOptions {
  readonly baseDir?: string;
  readonly now?: () => number;
}

export class TaskStateStoreV2 {
  readonly baseDir: string;

  private readonly now: () => number;
  private readonly namespaceCache = new Map<string, TaskNamespaceState>();
  private readonly locks = new Map<string, NamespaceLockState>();
  private initialized = false;

  constructor(options: TaskStateStoreOptions = {}) {
    this.baseDir = path.resolve(options.baseDir || path.join(os.homedir(), '.renx', 'task'));
    this.now = options.now || Date.now;
  }

  normalizeNamespace(namespaceInput?: string): string {
    const raw = (namespaceInput || 'default').trim();
    if (!raw) {
      return 'default';
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(raw)) {
      throw new TaskToolV2Error('namespace allows only [a-zA-Z0-9._-]', {
        errorCode: 'TASK_INVALID_NAMESPACE',
        category: 'validation',
        details: {
          namespace: namespaceInput,
        },
      });
    }
    return raw;
  }

  async getState(namespaceInput?: string): Promise<TaskNamespaceState> {
    const namespace = this.normalizeNamespace(namespaceInput);
    await this.ensureInitialized();
    return safeJsonClone(await this.readNamespaceState(namespace));
  }

  async updateState<T>(
    namespaceInput: string | undefined,
    updater: (state: TaskNamespaceState) => Promise<T> | T
  ): Promise<{ state: TaskNamespaceState; result: T }> {
    const namespace = this.normalizeNamespace(namespaceInput);
    await this.ensureInitialized();
    await this.acquireLock(namespace);

    try {
      const current = await this.readNamespaceState(namespace);
      const working = safeJsonClone(current);
      const result = await updater(working);
      working.updatedAt = this.now();
      await this.writeNamespaceState(namespace, working);
      this.namespaceCache.set(namespace, safeJsonClone(working));
      return {
        state: safeJsonClone(working),
        result,
      };
    } finally {
      this.releaseLock(namespace);
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await fs.mkdir(this.baseDir, { recursive: true });
    this.initialized = true;
  }

  private async readNamespaceState(namespace: string): Promise<TaskNamespaceState> {
    const cached = this.namespaceCache.get(namespace);
    if (cached) {
      return safeJsonClone(cached);
    }

    const filePath = path.join(this.baseDir, `${namespace}.json`);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<TaskNamespaceState>;
      const hydrated = this.hydrateState(namespace, parsed);
      this.namespaceCache.set(namespace, safeJsonClone(hydrated));
      return hydrated;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError?.code !== 'ENOENT') {
        throw new TaskToolV2Error(`failed to load namespace ${namespace}: ${nodeError.message}`, {
          errorCode: 'TASK_STORE_IO_ERROR',
          category: 'internal',
          details: {
            namespace,
          },
        });
      }

      const empty = createEmptyTaskNamespaceState(namespace);
      this.namespaceCache.set(namespace, safeJsonClone(empty));
      await this.writeNamespaceState(namespace, empty);
      return empty;
    }
  }

  private hydrateState(
    namespace: string,
    partial: Partial<TaskNamespaceState>
  ): TaskNamespaceState {
    const base = createEmptyTaskNamespaceState(namespace);
    const merged: TaskNamespaceState = {
      ...base,
      ...partial,
      namespace,
      tasks: partial.tasks || {},
      graph: {
        adjacency: partial.graph?.adjacency || {},
        reverse: partial.graph?.reverse || {},
      },
      updatedAt: typeof partial.updatedAt === 'number' ? partial.updatedAt : base.updatedAt,
      schemaVersion: 1,
    };

    for (const taskId of Object.keys(merged.tasks)) {
      if (!merged.graph.adjacency[taskId]) {
        merged.graph.adjacency[taskId] = [];
      }
      if (!merged.graph.reverse[taskId]) {
        merged.graph.reverse[taskId] = [];
      }
    }

    return merged;
  }

  private async writeNamespaceState(namespace: string, state: TaskNamespaceState): Promise<void> {
    const filePath = path.join(this.baseDir, `${namespace}.json`);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp.${randomUUID().slice(0, 8)}`;
    await fs.writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

    try {
      await fs.rename(tmpPath, filePath);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'EPERM' && process.platform === 'win32') {
        await fs.copyFile(tmpPath, filePath);
        await fs.unlink(tmpPath).catch(() => undefined);
        return;
      }
      throw error;
    }
  }

  private async acquireLock(namespace: string): Promise<void> {
    let lock = this.locks.get(namespace);
    if (!lock) {
      lock = {
        locked: false,
        waiters: [],
      };
      this.locks.set(namespace, lock);
    }

    if (!lock.locked) {
      lock.locked = true;
      return;
    }

    await new Promise<void>((resolve) => {
      lock?.waiters.push(resolve);
    });
  }

  private releaseLock(namespace: string): void {
    const lock = this.locks.get(namespace);
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
}

let globalTaskStateStoreV2: TaskStateStoreV2 | null = null;
let globalTaskStateStoreKey = '';

export function getTaskStateStoreV2(options: TaskStateStoreOptions = {}): TaskStateStoreV2 {
  const baseDir = path.resolve(options.baseDir || path.join(os.homedir(), '.renx', 'task'));
  if (!globalTaskStateStoreV2 || globalTaskStateStoreKey !== baseDir) {
    globalTaskStateStoreV2 = new TaskStateStoreV2({
      ...options,
      baseDir,
    });
    globalTaskStateStoreKey = baseDir;
  }
  return globalTaskStateStoreV2;
}
