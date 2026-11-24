/**
 * Yetenek konağı girişi (KURGU §10.1): kullanıcı yeteneklerini ana süreçten ayrı bir süreçte koşturur ve
 * çekirdekle yalnız JSON iletileriyle konuşur. `dist/skill-host/index.js` olarak ayrı demetlenir;
 * ana süreç `runtime.skillHostPath` ile başlatır (`utilityProcess`). Ortamı boştur: anahtarlar buraya hiç gelmez.
 *
 * Bu bir kum havuzu değildir; neyi engellediği ve engellemediği `README.md` içindedir.
 */
import { createHostCore } from './core';
import type { HostToMain, HostTransport, MainToHost } from './protocol';

/** Electron `utilityProcess` çocuğunda `process.parentPort` bulunur. */
interface ParentPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
}

function connect(): HostTransport | null {
  const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;
  if (parentPort) {
    return {
      send: (message: HostToMain) => parentPort.postMessage(message),
      onMessage: (listener) => parentPort.on('message', (event) => listener(event.data as MainToHost)),
    };
  }
  // Birim sınamaları konağı düz Node ile (`child_process.fork`) başlatır.
  if (typeof process.send === 'function') {
    return {
      send: (message: HostToMain) => void process.send?.(message),
      onMessage: (listener) => void process.on('message', (message) => listener(message as MainToHost)),
    };
  }
  return null;
}

const transport = connect();
if (!transport) {
  console.error('yetenek konağı: üst süreç bağlantısı yok');
  process.exit(2);
}

// Yetenek kodunun ağa kendi başına çıkabileceği kolay yollar konak dünyasından da kaldırılır; ağ yalnız
// ana süreçteki `ctx.fetch` kapısından geçer. (Bağlamların içinde bu adlar zaten hiç yoktur.)
for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'] as const) {
  try {
    delete (globalThis as Record<string, unknown>)[name];
  } catch {
    // silinemeyen küresel: bağlamlar yine de görmez
  }
}

// Bir yeteneğin beklenmeyen hatası (yakalanmamış söz reddi dahil) konağı ve diğer yetenekleri düşürmemeli.
const report = (kind: string) => (reason: unknown) => {
  const text = reason instanceof Error ? reason.message : String(reason);
  transport.send({ kind: 'log', skillId: '', level: 'error', text: `${kind}: ${text}`.slice(0, 2000) });
};
process.on('unhandledRejection', report('yakalanmamış söz reddi'));
process.on('uncaughtException', report('yakalanmamış hata'));

createHostCore(transport);
