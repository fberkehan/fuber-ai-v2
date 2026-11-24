// Uçtan uca sınama sunucusu: masaüstünün GERÇEK köprü sunucusunu (xr/server.ts + pairing.ts) bellek içi depoyla ayağa
// kaldırır. `tools/build-e2e-server.mjs` bunu `xr` takma adıyla masaüstü kaynağına bağlayıp tek dosyaya paketler.
// Çıktı (stdout, satır satır): READY {port,fp} | CONNECT <json> | MSG <json> | DISCONNECT <neden>
// Girdi (stdin): "drop" → oturumu kapatır; "ping" → PC ping yollar (cihaz pong yankılamalı); "quit" → çıkar.
import { PairingStore, PairingWindow } from 'xr/pairing';
import { XrServer } from 'xr/server';

const PIN = process.env.E2E_PIN ?? '123456';
const store = PairingStore.ephemeral();
const win = new PairingWindow(Date.now(), { code: 'e2e-kod', pin: PIN });
const server = new XrServer({
  pcName: 'Fuber PC (e2e)',
  store,
  pairingWindow: () => win,
  features: ['voice', 'dashboard', 'bio'],
  onConnect: (s) => console.log('CONNECT ' + JSON.stringify({ deviceId: s.deviceId })),
  onMessage: (_s, msg) => console.log('MSG ' + JSON.stringify(msg)),
  onDisconnect: (_s, reason) => console.log('DISCONNECT ' + reason),
});

const port = await server.listen(0, '127.0.0.1');
console.log('READY ' + JSON.stringify({ port, fp: store.fingerprint }));

process.stdin.setEncoding('utf8');
process.stdin.on('data', (d: string) => {
  for (const line of d.split('\n').map((l) => l.trim())) {
    if (line === 'drop') server.session?.bye('test_drop');
    if (line === 'ping') server.session?.send({ t: 'ping', ts: 1795018528569 });
    if (line === 'quit') {
      server.close();
      process.exit(0);
    }
  }
});
process.stdin.on('end', () => {
  server.close();
  process.exit(0);
});
