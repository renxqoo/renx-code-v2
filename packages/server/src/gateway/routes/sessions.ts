import type { SqliteAgentAppStore } from '@renx-code/core';

export async function listSessions(
  store: SqliteAgentAppStore,
  opts: { limit?: number } = {}
): Promise<{ items: Awaited<ReturnType<SqliteAgentAppStore['listSessionSummaries']>> }> {
  const items = await store.listSessionSummaries({ limit: opts.limit });
  return { items };
}
