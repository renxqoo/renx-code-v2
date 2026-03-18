import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentAppSqliteClient } from '../sqlite-client';

describe('AgentAppSqliteClient', () => {
  let tempDir: string | null = null;
  let client: AgentAppSqliteClient | null = null;

  afterEach(async () => {
    if (client) {
      await client.close();
      client = null;
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('preserves the original SQLite error when a statement auto-rolls back the transaction', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-app-sqlite-client-'));
    client = new AgentAppSqliteClient(path.join(tempDir, 'agent.db'));
    await client.prepare();

    await client.exec(`
      CREATE TABLE tx_repro (
        id INTEGER PRIMARY KEY,
        value TEXT UNIQUE
      );
    `);

    await expect(
      client.transaction(async () => {
        await client!.run(`INSERT INTO tx_repro(value) VALUES ('duplicate')`);

        // `OR ROLLBACK` makes SQLite end the whole transaction before our
        // wrapper's catch block gets a chance to issue an explicit rollback.
        await client!.run(`INSERT OR ROLLBACK INTO tx_repro(value) VALUES ('duplicate')`);
      })
    ).rejects.toThrow(/UNIQUE constraint failed/i);
  });
});
