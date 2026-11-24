// Beyin günü (Görev 25 düzeltme 2–3): gece yarısından sonraki İLK iş yeni güne sayılır (sayaç önce sıfırlanır, sonra artar);
// çıkışta (will-quit) ertelenmiş yazım beklenmeden diske geçer; ertelenmiş yazım ile çıkıştaki yazım çakışmaz (tek, eşzamanlı yazım
// yolu). main/beyin.ts Electron'a bağlıdır: 'electron' ve olay yolu (olaylar.ts) bu dosyada sahtelenir (node:module registerHooks —
// Node ≥ 22.18, package.json engines: registerHooks + bayraksız .ts tür ayıklama; pencere/ağ yok). Saat node:test MockTimers (yalnız Date) ile yönetilir.
import { test, mock, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cikis = new Map<string, () => void>();
(globalThis as Record<string, unknown>).__beyinTestApp = { once: (ad: string, f: () => void) => { cikis.set(ad, f); } };
const veri = (kod: string) => `data:text/javascript,${encodeURIComponent(kod)}`;
const kanca = registerHooks({
  resolve(belirtec, baglam, sonraki) {
    if (belirtec === 'electron') return { url: veri('export const app = globalThis.__beyinTestApp; export const BrowserWindow = { getAllWindows: () => [] };'), shortCircuit: true };
    if (belirtec === './olaylar.js' && baglam.parentURL?.endsWith('/src/main/beyin.ts')) return { url: veri('export function yayinla() {}'), shortCircuit: true };
    // Ana süreç kaynakları derleyici için '.js' uzantısıyla içe aktarır; burada yanındaki '.ts' dosyasına gider.
    if (belirtec.startsWith('.') && belirtec.endsWith('.js') && baglam.parentURL?.startsWith('file:')) {
      const ts = new URL(belirtec.replace(/\.js$/, '.ts'), baglam.parentURL);
      if (fs.existsSync(fileURLToPath(ts))) return sonraki(ts.href, baglam);
    }
    return sonraki(belirtec, baglam);
  },
});

const klasor = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-beyin-gece-'));
const yol = path.join(klasor, 'beyin-gunu.json');
mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 25, 23, 59, 30).getTime() }); // yerel saat
after(() => {
  mock.timers.reset();
  kanca.deregister();
  delete (globalThis as Record<string, unknown>).__beyinTestApp;
  fs.rmSync(klasor, { recursive: true, force: true });
});
const b = await import('../src/main/beyin.ts');
b.beyinBagla({ gunlukYolu: yol, motorHazir: () => false, kapali: () => undefined, dinliyor: () => false });
const bugun = (id: string) => b.beyinDurumu().bolgeler.find((x) => x.id === id)!.bugun;
const motorBugun = (id: string) => b.beyinDurumu().motorlar.find((x) => x.id === id)!.bugun;
const oku = () => JSON.parse(fs.readFileSync(yol, 'utf8'));
const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('gece yarısından sonraki ilk iş (bölge) yeni güne sayılır: sayaç önce sıfırlanır, sonra artar', () => {
  b.beyinBasla('ajan')();
  b.beyinBasla('ajan')();
  assert.equal(bugun('ajan'), 2, '23:59: dünün iki işi');
  mock.timers.setTime(new Date(2026, 9, 26, 0, 0, 20).getTime());
  b.beyinBasla('ajan')();
  assert.equal(bugun('ajan'), 1, '00:00: yeni günün ilk işi sayılır (0 değil, 3 değil)');
});

test('gece yarısından sonraki ilk model çağrısı da yeni güne sayılır', () => {
  b.motorCagrisi('anthropic', 'model', 'sohbet')();
  assert.equal(motorBugun('anthropic'), 1);
  mock.timers.setTime(new Date(2026, 9, 27, 0, 0, 5).getTime());
  b.motorCagrisi('anthropic', 'model', 'sohbet')();
  assert.equal(motorBugun('anthropic'), 1, 'yeni günün ilk çağrısı sayılır');
});

test('çıkışta (will-quit) ertelenmiş yazım beklenmeden diske geçer', () => {
  mock.timers.setTime(new Date(2026, 9, 27, 9, 0, 0).getTime());
  if (fs.existsSync(yol)) fs.rmSync(yol);
  b.beyinBasla('saat')();
  assert.equal(fs.existsSync(yol), false, 'yazım 1,5 sn ertelenir');
  const f = cikis.get('will-quit');
  assert.ok(f, 'will-quit dinleyicisi kayıtlı');
  f();
  const g = oku();
  assert.equal(g.gun, '2026-10-27');
  assert.equal(g.bugun.saat, 1);
  assert.ok(g.olaylar.some((o: { tur: string; bolge: string }) => o.tur === 'basla' && o.bolge === 'saat'));
});

test('ertelenmiş yazım zamanında yazılır; ardından çıkıştaki yazımın üstüne eski içerik gelmez, geçici dosya kalmaz', async () => {
  b.beyinBasla('kokpit')();
  await bekle(1700);
  assert.equal(oku().bugun.kokpit, 1, '1,5 sn içinde yazıldı');
  b.beyinBasla('kokpit')();
  cikis.get('will-quit')!();
  assert.equal(oku().bugun.kokpit, 2, 'çıkışta hemen');
  await bekle(1700);
  assert.equal(oku().bugun.kokpit, 2, 'sonradan eski içerik yazılmadı');
  assert.deepEqual(fs.readdirSync(klasor), ['beyin-gunu.json']);
});
