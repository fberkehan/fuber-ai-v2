/**
 * Belge işçisinin girişi (`dist/doc-worker/index.js`). Electron'da `utilityProcess` (process.parentPort), sınamada
 * `worker_threads` olarak açılır. İstekler sırayla işlenir; çağıran süre dolunca ya da bellek sınırı aşılınca süreci
 * öldürür (`../worker-client.ts`).
 */
import { generateDocument } from './generate';
import { parseDocument } from './parse';
import type { WorkerRequest, WorkerResponse } from './protocol';

async function handle(request: WorkerRequest): Promise<WorkerResponse> {
  const id = request.id;
  try {
    if (request.op === 'parse') return { id, ...(await parseDocument(request)) };
    return { id, ...(await generateDocument(request)) };
  } catch (error) {
    return { id, ok: false, code: 'corrupt', error: String((error as Error)?.message ?? error).slice(0, 200) };
  }
}

type Port = { on(event: 'message', listener: (message: unknown) => void): void; postMessage(message: unknown): void };

const utilityPort = (process as unknown as { parentPort?: Port }).parentPort;
let queue = Promise.resolve();

function serve(port: Port, unwrap: (message: unknown) => WorkerRequest) {
  port.on('message', (message) => {
    const request = unwrap(message);
    queue = queue.then(async () => port.postMessage(await handle(request)));
  });
}

if (utilityPort) {
  serve(utilityPort, (message) => (message as { data: WorkerRequest }).data);
} else {
  const threads = await import('node:worker_threads');
  if (!threads.isMainThread && threads.parentPort) serve(threads.parentPort as unknown as Port, (message) => message as WorkerRequest);
  else if (process.send) {
    // Node alt süreci (sınama): IPC kanalı.
    serve({ on: (event, listener) => void process.on(event, listener), postMessage: (message) => void process.send!(message) }, (message) => message as WorkerRequest);
  }
}
