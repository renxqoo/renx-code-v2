import { Worker } from 'node:worker_threads';

const worker = new Worker(new URL('./worker-ping.ts', import.meta.url));
worker.on('message', (message) => {
  console.log('[message]', JSON.stringify(message));
  process.exit(0);
});
worker.on('error', (error) => {
  console.log('[error]', JSON.stringify({ message: error.message, stack: error.stack }));
  process.exit(1);
});
