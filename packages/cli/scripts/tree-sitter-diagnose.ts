import { getTreeSitterClient } from '@opentui/core';

const client = getTreeSitterClient();

client.on('warning', (warning, bufferId) => {
  console.log('[warning]', JSON.stringify({ warning, bufferId }));
});

client.on('error', (error, bufferId) => {
  console.log('[error]', JSON.stringify({ error, bufferId }));
});

client.on('worker:log', (logType, message) => {
  console.log('[worker]', JSON.stringify({ logType, message }));
});

const main = async () => {
  console.log(
    '[env]',
    JSON.stringify({
      platform: process.platform,
      arch: process.arch,
      otuiWorkerPath: process.env.OTUI_TREE_SITTER_WORKER_PATH ?? null,
    })
  );

  try {
    const preload = await client.preloadParser('markdown');
    console.log('[preload]', JSON.stringify({ preload }));
  } catch (error) {
    console.log(
      '[preload-throw]',
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
    );
  }

  try {
    const highlight = await client.highlightOnce(
      '# Title\n\n**bold**\n\n```ts\nconst x = 1\n```',
      'markdown'
    );
    console.log('[highlight]', JSON.stringify(highlight));
  } catch (error) {
    console.log(
      '[highlight-throw]',
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
    );
  }

  try {
    await client.destroy();
  } catch {
    // ignore cleanup errors in diagnostics
  }
};

await main();
