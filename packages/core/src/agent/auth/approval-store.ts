import type { ApprovalDecisionRecord } from './contracts';
import { JsonFileRecordStore } from './file-record-store';
import { getAuthorizationStorageConfig } from './storage-config';

export interface AuthorizationApprovalQuery {
  readonly principalId?: string;
  readonly sessionId?: string;
  readonly key?: string;
  readonly toolName?: string;
  readonly activeAt?: number;
}

export interface AuthorizationApprovalStore {
  record(record: ApprovalDecisionRecord): Promise<void>;
  list(query?: AuthorizationApprovalQuery): Promise<ApprovalDecisionRecord[]>;
  findActiveSessionApprovals(query: {
    principalId: string;
    sessionId: string;
    activeAt?: number;
  }): Promise<ApprovalDecisionRecord[]>;
}

export class InMemoryAuthorizationApprovalStore implements AuthorizationApprovalStore {
  private readonly records: ApprovalDecisionRecord[] = [];

  async record(record: ApprovalDecisionRecord): Promise<void> {
    this.records.push(record);
  }

  async list(query?: AuthorizationApprovalQuery): Promise<ApprovalDecisionRecord[]> {
    return filterApprovalRecords(this.records, query);
  }

  async findActiveSessionApprovals(query: {
    principalId: string;
    sessionId: string;
    activeAt?: number;
  }): Promise<ApprovalDecisionRecord[]> {
    return filterApprovalRecords(this.records, {
      principalId: query.principalId,
      sessionId: query.sessionId,
      activeAt: query.activeAt,
    }).filter((record) => record.scope === 'session' && record.decision === 'approved');
  }
}

export interface FileAuthorizationApprovalStoreOptions {
  readonly filePath?: string;
}

export class FileAuthorizationApprovalStore implements AuthorizationApprovalStore {
  private readonly store: JsonFileRecordStore<ApprovalDecisionRecord>;

  constructor(options: FileAuthorizationApprovalStoreOptions = {}) {
    this.store = new JsonFileRecordStore(
      options.filePath || getAuthorizationStorageConfig().approvalsFilePath
    );
  }

  async record(record: ApprovalDecisionRecord): Promise<void> {
    await this.store.update((records) => {
      records.push(record);
    });
  }

  async list(query?: AuthorizationApprovalQuery): Promise<ApprovalDecisionRecord[]> {
    return filterApprovalRecords(await this.store.list(), query);
  }

  async findActiveSessionApprovals(query: {
    principalId: string;
    sessionId: string;
    activeAt?: number;
  }): Promise<ApprovalDecisionRecord[]> {
    return filterApprovalRecords(await this.store.list(), {
      principalId: query.principalId,
      sessionId: query.sessionId,
      activeAt: query.activeAt,
    }).filter((record) => record.scope === 'session' && record.decision === 'approved');
  }
}

function filterApprovalRecords(
  records: ApprovalDecisionRecord[],
  query?: AuthorizationApprovalQuery
): ApprovalDecisionRecord[] {
  const activeAt = query?.activeAt ?? Date.now();
  return records.filter((record) => {
    if (query?.principalId && record.principalId !== query.principalId) {
      return false;
    }
    if (query?.sessionId && record.sessionId !== query.sessionId) {
      return false;
    }
    if (query?.key && record.key !== query.key) {
      return false;
    }
    if (query?.toolName && record.toolName !== query.toolName) {
      return false;
    }
    if (record.expiresAt && record.expiresAt <= activeAt) {
      return false;
    }
    return true;
  });
}
