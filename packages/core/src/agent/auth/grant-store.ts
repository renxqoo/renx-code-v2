import type { PermissionGrantRecord } from './contracts';
import { JsonFileRecordStore } from './file-record-store';
import { getAuthorizationStorageConfig } from './storage-config';

export interface AuthorizationGrantQuery {
  readonly principalId?: string;
  readonly sessionId?: string;
  readonly toolName?: string;
  readonly activeAt?: number;
}

export interface AuthorizationGrantStore {
  record(record: PermissionGrantRecord): Promise<void>;
  list(query?: AuthorizationGrantQuery): Promise<PermissionGrantRecord[]>;
  findActiveSessionGrants(query: {
    principalId: string;
    sessionId: string;
    activeAt?: number;
  }): Promise<PermissionGrantRecord[]>;
}

export class InMemoryAuthorizationGrantStore implements AuthorizationGrantStore {
  private readonly records: PermissionGrantRecord[] = [];

  async record(record: PermissionGrantRecord): Promise<void> {
    this.records.push(record);
  }

  async list(query?: AuthorizationGrantQuery): Promise<PermissionGrantRecord[]> {
    return filterGrantRecords(this.records, query);
  }

  async findActiveSessionGrants(query: {
    principalId: string;
    sessionId: string;
    activeAt?: number;
  }): Promise<PermissionGrantRecord[]> {
    return filterGrantRecords(this.records, {
      principalId: query.principalId,
      sessionId: query.sessionId,
      activeAt: query.activeAt,
    }).filter((record) => record.scope === 'session');
  }
}

export interface FileAuthorizationGrantStoreOptions {
  readonly filePath?: string;
}

export class FileAuthorizationGrantStore implements AuthorizationGrantStore {
  private readonly store: JsonFileRecordStore<PermissionGrantRecord>;

  constructor(options: FileAuthorizationGrantStoreOptions = {}) {
    this.store = new JsonFileRecordStore(
      options.filePath || getAuthorizationStorageConfig().grantsFilePath
    );
  }

  async record(record: PermissionGrantRecord): Promise<void> {
    await this.store.update((records) => {
      records.push(record);
    });
  }

  async list(query?: AuthorizationGrantQuery): Promise<PermissionGrantRecord[]> {
    return filterGrantRecords(await this.store.list(), query);
  }

  async findActiveSessionGrants(query: {
    principalId: string;
    sessionId: string;
    activeAt?: number;
  }): Promise<PermissionGrantRecord[]> {
    return filterGrantRecords(await this.store.list(), {
      principalId: query.principalId,
      sessionId: query.sessionId,
      activeAt: query.activeAt,
    }).filter((record) => record.scope === 'session');
  }
}

function filterGrantRecords(
  records: PermissionGrantRecord[],
  query?: AuthorizationGrantQuery
): PermissionGrantRecord[] {
  const activeAt = query?.activeAt ?? Date.now();
  return records.filter((record) => {
    if (query?.principalId && record.principalId !== query.principalId) {
      return false;
    }
    if (query?.sessionId && record.sessionId !== query.sessionId) {
      return false;
    }
    if (query?.toolName && record.toolName !== query.toolName) {
      return false;
    }
    if (record.revokedAt && record.revokedAt <= activeAt) {
      return false;
    }
    if (record.expiresAt && record.expiresAt <= activeAt) {
      return false;
    }
    return true;
  });
}
