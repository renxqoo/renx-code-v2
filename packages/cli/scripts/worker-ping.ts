import { parentPort } from 'node:worker_threads';

parentPort?.postMessage({ ok: true, workerUrl: import.meta.url });
