/** Resolve the sync buf file path for an account. */
export declare function getSyncBufFilePath(accountId: string): string;
/** Load the persisted getUpdates buffer. */
export declare function loadGetUpdatesBuf(filePath: string): string | undefined;
/** Persist the getUpdates buffer. */
export declare function saveGetUpdatesBuf(filePath: string, buf: string): void;
//# sourceMappingURL=sync-buf.d.ts.map