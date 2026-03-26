import { Worker } from 'node:worker_threads';

const workerPath = process.argv[2];
if (!workerPath) {
  console.error('missing worker path');
  process.exit(2);
}

console.log('[main]', JSON.stringify({ workerPath }));

const worker = new Worker(workerPath);
worker.on('message', (message) => {
  console.log('[message]', JSON.stringify(message));
  process.exit(0);
});
worker.on('error', (error) => {
  console.log('[error]', JSON.stringify({ message: error.message, stack: error.stack }));
  process.exit(1);
});
