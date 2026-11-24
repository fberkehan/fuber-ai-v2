// ═══ Toplantı modu: PAKETLİ uygulamada GERÇEK yerel Whisper ile yazıya çevirme kanıtı (14 Kas 2026; 0.18.2) ═══
// Paketli test kopyasını (scripts/paket-test-kopyasi.mjs) görünmez pencereyle açar; GERÇEK whisper.cpp + model (geçici klasöre, FUBER_WHISPER_DIZINI) indirir,
// Chromium'un sahte ses aygıtına verilen WAV dosyasıyla (hoparlör YOK, mikrofon açılmaz) toplantıyı başlatır ve satırların gerçekten yazıya dökülüp dökülmediğini
// ölçer. Yazıya çevirme SAHTE DEĞİL; yapay zekâ yerel (Gizli) olduğu için hiçbir bulut/claude çağrısı yok. Kurulu Fuber AI'ya ve %APPDATA%'ya dokunulmaz.
//   node scripts/dev/toplanti-whisper-paketli.mjs <test-kopyası-exe> <wav> [--dizin <whisper-klasörü>] [--model small-q5_1] [--sn 60] [--gpu cpu|cuda|otomatik]
// Çıkış 0: en az bir satır gerçekten metin oldu (kesin). 1: hiçbiri.
import { KURULUM_SURUMU } from '../../src/shared/kurulum-adimlari.ts';
import { TANITIM_SURUMU } from '../../src/shared/tanitim.ts';
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { geciciEv, paketliTestExe } from '../paket-dogrula.mjs';

if (process.env.FUBER_GORUNUR) { console.error('DUR: FUBER_GORUNUR ayarlı.'); process.exit(1); }
const args = process.argv.slice(2);
const secenek = (ad, varsayilan) => { const i = args.indexOf(`--${ad}`); return i >= 0 ? args[i + 1] : varsayilan; };
const pozisyonel = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--tani'));
const exe = paketliTestExe(pozisyonel[0], 'masaustu');
const wav = path.resolve(pozisyonel[1] ?? '');
if (!fs.existsSync(wav)) { console.error('WAV yok:', wav); process.exit(1); }
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-tw-'));
const veri = path.join(tmp, 'veri');
const whisperDizini = secenek('dizin', path.join(tmp, 'whisper'));
const sn = Number(secenek('sn', '60'));
fs.mkdirSync(path.join(veri, 'belgeler'), { recursive: true });
fs.writeFileSync(path.join(veri, 'ayarlar.json'), JSON.stringify({
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: TANITIM_SURUMU, kullaniciAdi: 'Deniz', hitap: 'Deniz', baslangictaAc: false, dil: 'tr', baslangictaAc2: false,
  yerel: { gizliMod: true }, ses: { uyandirma: false, seslendirme: false }, proaktif: { etkin: false }, gorunum: { tema: 'koyu', adaSessiz: false },
  gunKaydi: { whisperModel: secenek('model', 'small-q5_1'), ...(secenek('gpu') ? { whisperGpu: secenek('gpu') } : {}) },
}));
const ortam = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('FUBER_SIR_') && k !== 'FUBER_GORUNUR'));
Object.assign(ortam, geciciEv(veri), { FUBER_DEMO: '1', FUBER_VERI: veri, FUBER_BELGELER: path.join(veri, 'belgeler'), FUBER_TEST_TAM_EKRAN: '0', FUBER_TEST_ANA_ONDE: '0', FUBER_TOPLANTI_DENEME_SESI: wav, FUBER_WHISPER_DIZINI: whisperDizini });
let u; let cikis = 1;
const ozet = (d) => ({ hal: d?.hal, yol: d?.yol, yaziMotoru: d?.yaziMotoru, uyari: d?.uyari ?? null, eylem: d?.uyariEylemi ?? null, tani: d?.tani ?? null, satirlar: (d?.satirlar ?? []).map((s) => `${s.id}|${s.kesin ? 'K' : 'a'}|${s.hata ?? ''}|${JSON.stringify(s.metin)}`) });
try {
  u = await electron.launch({ executablePath: exe, args: [], env: ortam, timeout: 120000 });
  let ana = null;
  for (let i = 0; i < 240 && !ana; i++) { ana = u.windows().find((x) => x.url().startsWith('fuber://app/index.html')) ?? null; if (!ana) await bekle(250); }
  if (!ana) throw new Error('ana pencere yok');
  await ana.waitForSelector('.kokpit', { timeout: 30000 });
  await ana.click('.ray__dgm[data-tur="toplanti"]');
  await ana.waitForSelector('.toplanti');
  console.log('WHISPER_DIZINI', whisperDizini);
  const h0 = await ana.evaluate(() => window.fuber.cagir('toplanti:hazirlik'));
  console.log('HAZIRLIK_ONCE', JSON.stringify({ yol: h0.yol, kurulu: h0.whisper.kurulu, boyutMB: h0.whisper.boyutMB }));
  if (!h0.whisper.kurulu) {
    const t0 = Date.now();
    await ana.evaluate(() => window.fuber.cagir('toplanti:whisper-indir'));
    for (let i = 0; i < 1800; i++) {
      const h = await ana.evaluate(() => window.fuber.cagir('toplanti:hazirlik'));
      if (i % 10 === 0) console.log('INDIRME', JSON.stringify(h.whisper.indirme ?? null), h.whisper.kurulu);
      if (h.whisper.kurulu) break;
      if (h.whisper.indirme?.hata) throw new Error(`indirme hatası: ${h.whisper.indirme.hata}`);
      await bekle(1000);
    }
    console.log('INDIRME_SURE_SN', Math.round((Date.now() - t0) / 1000));
    // Arayüzün hazırlık durumu tazelensin (gerçek kullanıcı da indirme bitince sayfayı yeniden açar).
    await ana.reload();
    await ana.waitForSelector('.kokpit', { timeout: 30000 });
    await ana.click('.ray__dgm[data-tur="toplanti"]');
    await ana.waitForSelector('.toplanti');
  }
  const bas = Date.now();
  await ana.click('[data-toplanti-eylem="baslat"]'); // gerçek yakalama hattı arayüzden başlar
  await bekle(500);
  const d0 = await ana.evaluate(() => window.fuber.cagir('toplanti:durum'));
  console.log('BASLADI', JSON.stringify({ hal: d0?.hal, yol: d0?.yol }));
  let sonMetinli = 0;
  for (let i = 0; i < sn; i++) {
    await bekle(1000);
    const d = await ana.evaluate(() => window.fuber.cagir('toplanti:durum'));
    const o = ozet(d);
    if (i % 3 === 0 || i === sn - 1) console.log(`T+${Math.round((Date.now() - bas) / 1000)}s`, JSON.stringify(o));
    const metinli = (d?.satirlar ?? []).filter((s) => s.kesin && s.metin && !s.hata).length;
    if (metinli > sonMetinli) { sonMetinli = metinli; if (metinli >= 2 && !args.includes('--tam')) break; }
  }
  const son = await ana.evaluate(() => window.fuber.cagir('toplanti:durum'));
  console.log('SON', JSON.stringify(ozet(son), null, 1));
  const arayuz = await ana.evaluate(() => ({ cipler: [...document.querySelectorAll('.tp-durumcip')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()), tani: document.querySelector('.tp-tani')?.innerText?.replace(/\s+/g, ' ').slice(0, 600) ?? null }));
  console.log('ARAYUZ', JSON.stringify(arayuz));
  cikis = (son?.satirlar ?? []).some((s) => s.kesin && s.metin && !s.hata) ? 0 : 1;
  await ana.evaluate(() => window.fuber.cagir('toplanti:durdur')).catch(() => undefined);
} catch (e) { console.log('HATA', e?.stack ?? e); cikis = 1; }
finally {
  try { await u?.evaluate(({ app }) => app.quit()); } catch { /* */ }
  await bekle(1500);
  try { await u?.close(); } catch { /* */ }
  if (!args.includes('--dizin')) { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } } else { try { fs.rmSync(veri, { recursive: true, force: true }); } catch { /* */ } }
}
console.log('EXIT', cikis);
process.exit(cikis);
