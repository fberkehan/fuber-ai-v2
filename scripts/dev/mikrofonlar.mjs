// Uygulamanın (Chromium) gördüğü mikrofonlar ve varsayılan aygıt; kayıt yapılmaz, akış hemen kapatılır.
// Çalıştır: node scripts/dev/mikrofonlar.mjs
import { KURULUM_SURUMU } from '../../src/shared/kurulum-adimlari.ts';
import { _electron as electron } from 'playwright-core';
import electronYolu from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const kok = path.resolve(import.meta.dirname, '../..');
const veri = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-mik-'));
fs.writeFileSync(path.join(veri, 'ayarlar.json'), JSON.stringify({ kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: '0.9.0', kullaniciAdi: 'Test', baslangictaAc: false, ses: { uyandirma: false, seslendirme: false } }));
const u = await electron.launch({ executablePath: electronYolu, args: [kok], env: { ...process.env, FUBER_VERI: veri }, timeout: 60000 });
try {
  let w;
  for (let i = 0; i < 120 && !w; i++) { w = u.windows().find((x) => x.url().includes('index.html')); if (!w) await new Promise((r) => setTimeout(r, 250)); }
  const l = await w.evaluate(async () => {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    const kullanilan = s.getAudioTracks()[0]?.label;
    s.getTracks().forEach((t) => t.stop());
    const a = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    return { kullanilan, aygitlar: a.map((d) => `${d.deviceId === 'default' ? '[varsayılan] ' : d.deviceId === 'communications' ? '[iletişim] ' : ''}${d.label}`) };
  });
  console.log('Varsayılan akışın aygıtı:', l.kullanilan);
  console.log(l.aygitlar.join('\n'));
} finally {
  await u.close().catch(() => undefined);
  fs.rmSync(veri, { recursive: true, force: true });
}
