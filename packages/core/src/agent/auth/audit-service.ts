import type { AuthorizationAuditRecord } from './contracts';
import { JsonFileRecordStore } from './file-record-store';
import { getAuthorizationStorageConfig } from './storage-config';

export interface AuthorizationAuditQuery {
  readonly principalId?: string;
  readonly sessionId?: string;
  readonly toolName?: string;
}

export interface AuthorizationAuditStore {
  record(record: AuthorizationAuditRecord): Promise<void>;
  list(query?: AuthorizationAuditQuery): Promise<AuthorizationAuditRecord[]>;
}

export class InMemoryAuthorizationAuditStore implements AuthorizationAuditStore {
  private readonly records: AuthorizationAuditRecord[] = [];

  async record(record: AuthorizationAuditRecord): Promise<void> {
    this.records.push(record);
  }

  async list(query?: AuthorizationAuditQuery): Promise<AuthorizationAuditRecord[]> {
    return filterAuditRecords(this.records, query);
  }
}

export interface FileAuthorizationAuditStoreOptions {
  readonly filePath?: string;
}

export class FileAuthorizationAuditStore implements AuthorizationAuditStore {
  private readonly store: JsonFileRecordStore<AuthorizationAuditRecord>;

  constructor(options: FileAuthorizationAuditStoreOptions = {}) {
    this.store = new JsonFileRecordStore(
      options.filePath || getAuthorizationStorageConfig().auditsFilePath
    );
  }

  async record(record: AuthorizationAuditRecord): Promise<void> {
    await this.store.update((records) => {
      records.push(record);
    });
  }

  async list(query?: AuthorizationAuditQuery): Promise<AuthorizationAuditRecord[]> {
    return filterAuditRecords(await this.store.list(), query);
  }
}

export class AuthorizationAuditService {
  constructor(
    private readonly store: AuthorizationAuditStore = new InMemoryAuthorizationAuditStore()
  ) {}

  async record(record: AuthorizationAuditRecord): Promise<void> {
    await this.store.record(record);
  }

  async list(query?: AuthorizationAuditQuery): Promise<AuthorizationAuditRecord[]> {
    return this.store.list(query);
  }
}

function filterAuditRecords(
  records: AuthorizationAuditRecord[],
  query?: AuthorizationAuditQuery
): AuthorizationAuditRecord[] {
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
    return true;
  });
}
