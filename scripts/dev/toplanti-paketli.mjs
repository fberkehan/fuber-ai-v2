// ═══ Toplantı modu: PAKETLİ uygulamada iki kaynağın gerçek hata adı/iletisi (13 Kas 2026; 0.17.3 onarımı) ═══
// Paketlenmiş (asar + fuber://) uygulamanın DAĞITILMAYAN test kopyasını (scripts/paket-test-kopyasi.mjs) görünmez pencereyle açar; Toplantı'yı
// başlatır, her adımın (AudioContext, worklet, getDisplayMedia, getUserMedia) GERÇEK hata adını/iletisini yazar ve arayüzün durumunu gösterir.
// HİÇBİR ses çalınmaz, pencere öne gelmez, kurulu Fuber AI'ya ve %APPDATA%\Fuber AI'ya dokunulmaz (FUBER_VERI geçici klasör). Yazıya çevirme/yapay zekâ sahtedir.
//   node scripts/dev/toplanti-paketli.mjs [test-kopyası-exe] [--mik-kapali]   (varsayılan: release/win-unpacked-test/Fuber AI.exe; scripts/paket-test-kopyasi.mjs üretir)
//   --mik-kapali: ayarlarda "mikrofonu tamamen kapat" açık (izin işleyicisi mikrofonu reddeder).
import { KURULUM_SURUMU } from '../../src/shared/kurulum-adimlari.ts';
import { TANITIM_SURUMU } from '../../src/shared/tanitim.ts';
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { geciciEv, paketliTestExe } from '../paket-dogrula.mjs';

if (process.env.FUBER_GORUNUR) { console.error('DUR: FUBER_GORUNUR ayarlı.'); process.exit(1); }
const args = process.argv.slice(2);
const exe = paketliTestExe(args.find((a) => !a.startsWith('--')), 'masaustu');
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-tp-paketli-'));
const veri = path.join(tmp, 'veri');
fs.mkdirSync(path.join(veri, 'belgeler'), { recursive: true });
fs.writeFileSync(path.join(veri, 'ayarlar.json'), JSON.stringify({ kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: TANITIM_SURUMU, kullaniciAdi: 'Deniz', hitap: 'Deniz', baslangictaAc: false, dil: 'tr', ses: { uyandirma: false, seslendirme: false, ...(args.includes('--mik-kapali') ? { mikrofonKapali: true } : {}) }, proaktif: { etkin: false }, gorunum: { tema: 'koyu', adaSessiz: false } }));
const ortam = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('FUBER_SIR_') && k !== 'FUBER_GORUNUR'));
Object.assign(ortam, geciciEv(veri), { FUBER_DEMO: '1', FUBER_VERI: veri, FUBER_BELGELER: path.join(veri, 'belgeler'), FUBER_TEST_TAM_EKRAN: '0', FUBER_TEST_ANA_ONDE: '0', FUBER_TOPLANTI_DENEME: '1' });
let u; let cikis = 0;
try {
  u = await electron.launch({ executablePath: exe, args: [], env: ortam, timeout: 90000 });
  let ana = null;
  for (let i = 0; i < 240 && !ana; i++) { ana = u.windows().find((x) => x.url().startsWith('fuber://app/index.html')) ?? null; if (!ana) await bekle(250); }
  if (!ana) throw new Error('ana pencere yok');
  const konsol = [];
  ana.on('console', (m) => { if (/toplantı|toplanti|worklet|AudioContext/i.test(m.text())) konsol.push(`${m.type()}: ${m.text()}`); });
  ana.on('pageerror', (e) => konsol.push(`pageerror: ${e.message}`));
  await ana.waitForSelector('.kokpit', { timeout: 30000 });
  await ana.click('.ray__dgm[data-tur="toplanti"]');
  await ana.waitForSelector('.toplanti');
  await ana.evaluate(() => window.fuber.cagir('toplanti:baslat', { hedefDil: 'tr', robot: false }));
  const ham = await ana.evaluate(async () => {
    const o = {};
    const dene = async (ad, f) => { try { const r = await f(); o[ad] = r ?? 'tamam'; } catch (e) { o[ad] = `HATA ${e?.name}: ${e?.message}`; } };
    await dene('izin-mikrofon', async () => (await navigator.permissions.query({ name: 'microphone' })).state);
    await dene('audioContext', async () => { const c = new AudioContext(); const d = c.state; await c.close(); return d; });
    await dene('displayMedia', async () => {
      const a = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width: 1, height: 1, frameRate: 1 } });
      const r = `video=${a.getVideoTracks().length} ses=${a.getAudioTracks().length}`; a.getTracks().forEach((t) => t.stop()); return r;
    });
    await dene('mikrofon', async () => {
      const a = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const r = `ses=${a.getAudioTracks().length} ${a.getAudioTracks()[0]?.label}`; a.getTracks().forEach((t) => t.stop()); return r;
    });
    await dene('aygitlar', async () => (await navigator.mediaDevices.enumerateDevices()).map((d) => d.kind).join(','));
    return o;
  });
  console.log('HAM', JSON.stringify(ham, null, 1));
  await ana.evaluate(() => window.fuber.cagir('toplanti:durdur'));
  await bekle(500);
  await ana.click('[data-toplanti-eylem="baslat"]');
  await bekle(5000);
  const ui = await ana.evaluate(() => ({ uyari: [...document.querySelectorAll('.tp-durumcip')].map((e) => e.innerText.replace(/s+/g, ' ').trim()).join(' || ') || null, kayit: document.querySelector('.tp-kayit__metin')?.textContent ?? null, govde: document.querySelector('.toplanti')?.innerText?.slice(0, 400) }));
  console.log('ARAYÜZ', JSON.stringify(ui));
  console.log('KONSOL', JSON.stringify(konsol, null, 1));
  if (ui.uyari && !args.includes('--mik-kapali')) cikis = 1;
  await ana.click('[data-toplanti-eylem="durdur"]').catch(() => undefined);
  await bekle(1000);
} catch (e) { console.log('HATA', e?.stack ?? e); cikis = 1; }
finally {
  try { await u?.evaluate(({ app }) => app.quit()); } catch { /* */ }
  await bekle(1200);
  try { await u?.close(); } catch { /* */ }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
process.exit(cikis);
