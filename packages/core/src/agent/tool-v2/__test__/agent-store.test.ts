import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSubagentExecutionStore } from '../agent-store';
import type { SubagentExecutionRecord } from '../agent-contracts';

describe('FileSubagentExecutionStore', () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-subagent-store-'));
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('recovers from a corrupted executions file by quarantining it', async () => {
    await fs.mkdir(baseDir, { recursive: true });
    await fs.writeFile(
      path.join(baseDir, 'executions.json'),
      '{"schemaVersion":1,"records":[{"agentId":"broken","started\u0000\u0000',
      'utf8'
    );

    const store = new FileSubagentExecutionStore({ baseDir });

    await expect(store.list()).resolves.toEqual([]);

    const files = await fs.readdir(baseDir);
    expect(files.some((file) => file.startsWith('executions.corrupt-'))).toBe(true);

    const record = createRecord('agent-1');
    await expect(store.save(record)).resolves.toEqual(record);
    await expect(store.get('agent-1')).resolves.toEqual(record);

    const persisted = JSON.parse(
      await fs.readFile(path.join(baseDir, 'executions.json'), 'utf8')
    ) as { records: SubagentExecutionRecord[] };
    expect(persisted.records).toHaveLength(1);
    expect(persisted.records[0]?.agentId).toBe('agent-1');
  });

  it('serializes concurrent saves without losing records', async () => {
    const store = new FileSubagentExecutionStore({ baseDir });
    const records = Array.from({ length: 24 }, (_, index) => createRecord(`agent-${index}`, index));

    await Promise.all(records.map((record) => store.save(record)));

    const listed = await store.list();
    expect(listed).toHaveLength(records.length);
    expect(new Set(listed.map((record) => record.agentId)).size).toBe(records.length);

    const persisted = JSON.parse(
      await fs.readFile(path.join(baseDir, 'executions.json'), 'utf8')
    ) as { records: SubagentExecutionRecord[] };
    expect(persisted.records).toHaveLength(records.length);
    expect(new Set(persisted.records.map((record) => record.agentId)).size).toBe(records.length);
  });
});

function createRecord(agentId: string, offset = 0): SubagentExecutionRecord {
  const now = 1_773_800_000_000 + offset;
  return {
    agentId,
    executionId: `exec-${agentId}`,
    conversationId: `conv-${agentId}`,
    role: 'Explore',
    prompt: `prompt for ${agentId}`,
    description: `description for ${agentId}`,
    status: 'running',
    maxSteps: 8,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    version: 1,
  };
}
