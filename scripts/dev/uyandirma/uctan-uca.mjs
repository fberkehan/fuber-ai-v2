#!/usr/bin/env node
// ── Uyandırma uçtan uca (0.13 T8): gerçek gizli kulak penceresi, gerçek işçi + WASM ──────────────────────────────────────────────────
// Gerçek mikrofon AÇILMAZ: Chromium'un sahte aygıtı WAV'ı döngüyle "duyar". Veri geçici klasörde (FUBER_VERI), arka plan kipinde (FUBER_DEMO),
// kurulu uygulamaya ve %APPDATA%'ya dokunulmaz. Önce: npm run build:main && npx vite build --configLoader runner
//   node scripts/dev/uyandirma/uctan-uca.mjs
// Paketli (0.13 T16; dağıtılmayan test kopyası, asar bütünlüğü ve sigortalar açık; önce electron-builder --win dir + scripts/paket-test-kopyasi.mjs):
//   node scripts/dev/uyandirma/uctan-uca.mjs --paketli ["...\win-unpacked-test\Fuber AI.exe"]
// Sınar: (1) "Hey Fuber" uyandırır, (2) 3 sn konuşma yoksa 'bos', sohbet yazılmaz, (3) "Hey" ve "Hey Uber" uyandırmaz, (4) motor dosyaları
// açılmazsa: tek cümle kullanıcıya ve Ayarlar satırına gider, 30 sn sonra bir kez denenir, yine olmazsa gün kaydı kapalıysa kulak kapanır (mikrofon
// bırakılır), gün kaydı açıksa kalır; ayar kapatılıp açılınca motor düzelir, (5) bayat durum: pencere yeniden kurulup motor ilk denemede açılınca
// gün kaydı kapanması çalışan "Hey Fuber"i kapatmaz, (6) yavaş disk: dosya başına 12 sn gecikme çökme sayılmaz. Kulak penceresinin işlemci payı raporlanır.
import { KURULUM_SURUMU } from '../../../src/shared/kurulum-adimlari.ts';
import { UYANDIRMA_DUSTU_METNI } from '../../../src/shared/uyandirma-ayar.ts';
import { _electron as electron } from 'playwright-core';
import electronYolu from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { geciciEv, paketliTestExe } from '../../paket-dogrula.mjs';

const kok = path.resolve(import.meta.dirname, '../../..');
const paketli = process.argv.includes('--paketli');
const exe = paketli ? paketliTestExe(process.argv.slice(2).find((a) => /\.exe$/i.test(a)) ?? null, 'masaustu', { betik: 'uctan-uca' }) : electronYolu;
/** Paketli test kopyasına proje yolu verilmez; sahte ses bayrakları kurulu uygulamada yasak listesinde değildir (ortam kapısı). */
const acilisArgumanlari = (wav) => [...(paketli ? [] : [kok]), '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`];
/** Arka plan kipi, geçici veri; paketlide ev ve APPDATA da geçici (yalıtılmış profil kuralı). */
const ortamKur = (veri) => {
  const env = { ...process.env, FUBER_DEMO: '1', FUBER_VERI: veri, ...(paketli ? geciciEv(veri) : {}) };
  delete env.FUBER_GORUNUR;
  return env;
};
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const sonuclar = [];
const kaydet = (ad, tamam, ayrinti = '') => { sonuclar.push(tamam); console.log(`${tamam ? '✅' : '❌'} ${ad}${ayrinti ? ` — ${ayrinti}` : ''}`); };

/** 16 kHz WAV'ları, aralarına sessizlik koyarak tek WAV yapar. */
function kolaj(cikis, klipler, sessizlikSn) {
  const hz = 16000;
  const parca = klipler.flatMap((k) => [fs.readFileSync(k).subarray(44), Buffer.alloc(hz * 2 * sessizlikSn)]);
  const pcm = Buffer.concat(parca);
  const b = Buffer.alloc(44);
  b.write('RIFF', 0); b.writeUInt32LE(36 + pcm.length, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(hz, 24); b.writeUInt32LE(hz * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(cikis, Buffer.concat([b, pcm]));
}

async function kos(wav, sn) {
  const veri = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-uyandirma-'));
  fs.writeFileSync(path.join(veri, 'ayarlar.json'), JSON.stringify({
    kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: '0.9.0', kullaniciAdi: 'Deniz', hitap: 'Deniz', baslangictaAc: false,
    ses: { surum: 2, uyandirma: true, seslendirme: false }, proaktif: { etkin: false },
  }));
  const u = await electron.launch({ executablePath: exe, args: acilisArgumanlari(wav), env: ortamKur(veri), timeout: 60000 });
  try {
    let ada, kulak;
    for (let i = 0; i < 160 && !(ada && kulak); i++) {
      ada = u.windows().find((x) => x.url().includes('asistan.html'));
      kulak = u.windows().find((x) => x.url().includes('kulak.html'));
      if (!(ada && kulak)) await bekle(250);
    }
    if (!ada || !kulak) throw new Error(`pencereler yok: ${u.windows().map((x) => x.url()).join(' ')}`);
    const konsol = [];
    kulak.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') konsol.push(m.text().slice(0, 220)); });
    await ada.evaluate(() => {
      window.__olay = [];
      window.fuber.dinle('asistan:ses', (v) => { if (v.tur !== 'seviye') window.__olay.push({ ...v, t: Date.now() }); });
    });
    await u.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('asistan.html'));
      globalThis.__gizlendi = [];
      w.on('hide', () => globalThis.__gizlendi.push(Date.now()));
    });
    // percentCPUUsage iki çağrı arasını ölçer: ilk çağrı sıfırlar, ikincisi bu aralığın ortalamasını verir.
    const cpu = () => u.evaluate(({ app, BrowserWindow }) => {
      const k = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('kulak.html'));
      const pid = k?.webContents.getOSProcessId();
      return app.getAppMetrics().find((m) => m.pid === pid)?.cpu.percentCPUUsage ?? null;
    });
    await bekle(8000);
    await cpu();
    await bekle((sn - 8) * 1000);
    const metrik = await cpu();
    const olaylar = await ada.evaluate(() => window.__olay);
    const gizlendi = await u.evaluate(() => globalThis.__gizlendi);
    const paket = await u.evaluate(({ app }) => ({ paketli: app.isPackaged, surum: app.getVersion(), kaynak: process.resourcesPath }));
    const durum = await ada.evaluate(() => window.fuber.cagir('kulak:uyandirma-durum'));
    return { olaylar, konsol, metrik, gizlendi, paket, durum };
  } finally {
    await u.close().catch(() => undefined);
    fs.rmSync(veri, { recursive: true, force: true });
  }
}

/** Motor dosyaları açılamıyor: fuber:// işleyicisinin kullandığı net.fetch yamalanır (uygulama kodu değişmez). */
async function dusme(wav, gunKaydi) {
  const veri = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-uyandirma-'));
  fs.writeFileSync(path.join(veri, 'ayarlar.json'), JSON.stringify({
    kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: '0.9.0', kullaniciAdi: 'Deniz', hitap: 'Deniz', baslangictaAc: false,
    ses: { surum: 2, uyandirma: false, seslendirme: false }, proaktif: { etkin: false },
    ...(gunKaydi ? { gunKaydi: { etkin: true, rizaTarihi: new Date().toISOString(), calisma: { bas: '00:00', bit: '00:00', gunler: [0, 1, 2, 3, 4, 5, 6] }, kilitteDuraklat: false, motor: 'vosk', eslikci: 'kapali' } } : {}),
  }));
  const u = await electron.launch({ executablePath: exe, args: acilisArgumanlari(wav), env: ortamKur(veri), timeout: 60000 });
  const ek = gunKaydi ? ' (gün kaydı açık)' : '';
  try {
    let w, ada;
    for (let i = 0; i < 160 && !(w && ada); i++) {
      w = u.windows().find((x) => x.url().includes('index.html'));
      ada = u.windows().find((x) => x.url().includes('asistan.html'));
      if (!(w && ada)) await bekle(250);
    }
    await w.waitForSelector('.kokpit', { timeout: 30000 });
    await u.evaluate(({ net }) => {
      const asil = net.fetch.bind(net);
      globalThis.__bozuk = true;
      net.fetch = (a, ...b) => (globalThis.__bozuk && String(a).includes('/uyandirma/') ? Promise.resolve(new Response('yok', { status: 404 })) : asil(a, ...b));
    });
    await w.evaluate(() => { window.__tost = []; window.fuber.dinle('ana:ada-tost', (v) => window.__tost.push(v.veri)); });
    await ada.evaluate(() => {
      window.__bildir = []; window.__olay = [];
      window.fuber.dinle('asistan:bildir', (v) => window.__bildir.push(v));
      window.fuber.dinle('asistan:ses', (v) => { if (v.tur !== 'seviye') window.__olay.push(v); });
    });
    const durum = () => w.evaluate(() => window.fuber.cagir('kulak:uyandirma-durum'));
    const kulakVar = () => u.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((x) => !x.isDestroyed() && x.webContents.getURL().includes('kulak.html')));
    const ayarla = (v) => w.evaluate(async (d) => { const a = await window.fuber.cagir('ayarlar:al'); await window.fuber.cagir('ayarlar:kaydet', { ses: { ...a.ses, uyandirma: d } }); }, v);
    const gunKaydiAyarla = (v) => w.evaluate(async (d) => { const a = await window.fuber.cagir('ayarlar:al'); await window.fuber.cagir('ayarlar:kaydet', { gunKaydi: { ...a.gunKaydi, etkin: d } }); }, v);
    const uyanmaBekle = async (sn) => { for (let i = 0; i < sn * 4; i++) { if (await ada.evaluate(() => window.__olay.some((v) => v.tur === 'uyandi'))) return true; await bekle(250); } return false; };
    const durumBekle = async (hedef, sn) => { for (let i = 0; i < sn * 4; i++) { if ((await durum()) === hedef) return true; await bekle(250); } return false; };
    const t0 = Date.now();
    await ayarla(true);
    kaydet(`motor açılamadı: "dustu"${ek}`, await durumBekle('dustu', 15), await durum());
    const tD = Date.now();
    await bekle(600);
    const tost = await w.evaluate(() => window.__tost), bildir = await ada.evaluate(() => window.__bildir);
    const gorunen = [...tost, ...bildir].map((x) => x?.metin);
    kaydet(`tek cümle kullanıcıya gitti${ek}`, gorunen.length === 1 && gorunen[0] === UYANDIRMA_DUSTU_METNI, `${tost.length} tost, ${bildir.length} ada: ${gorunen.join(' | ')}`);
    await u.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes('index.html'))?.webContents.send('ana:git', 'ayarlar#hey-fuber'));
    const satir = await w.waitForSelector('[data-uyandirma="dustu"]', { timeout: 8000 }).then((e) => e.textContent()).catch(() => null);
    kaydet(`Ayarlar satırı aynı cümleyi yazıyor${ek}`, satir === UYANDIRMA_DUSTU_METNI, String(satir));
    kaydet(`30 sn dolmadan vazgeçmiyor${ek}`, (await durum()) === 'dustu', `${((Date.now() - tD) / 1000).toFixed(1)} sn`);
    const vazgecti = await durumBekle('vazgecti', 45);
    kaydet(`yeniden deneme de düşünce vazgeçti${ek}`, vazgecti && Date.now() - tD >= 29_000, `düşüşten ${((Date.now() - tD) / 1000).toFixed(1)} sn sonra`);
    await bekle(800);
    const varMi = await kulakVar();
    kaydet(gunKaydi ? 'gün kaydı açık: kulak ve mikrofon kaldı' : 'gün kaydı kapalı: kulak kapandı, mikrofon bırakıldı', varMi === Boolean(gunKaydi), `kulak penceresi ${varMi ? 'var' : 'yok'}`);
    const sonGorunen = [...await w.evaluate(() => window.__tost), ...await ada.evaluate(() => window.__bildir)];
    kaydet(`uyarı yinelenmedi${ek}`, sonGorunen.length === 1, `${sonGorunen.length} uyarı`);
    // Düzelince: ayar kapatılıp açılınca motor baştan dener.
    await u.evaluate(() => { globalThis.__bozuk = false; });
    await ayarla(false);
    await bekle(500);
    await ayarla(true);
    const donus = await durumBekle('calisiyor', 10);
    const uyandi = await uyanmaBekle(25);
    kaydet(`ayar kapatılıp açılınca motor geri geldi ve uyandı${ek}`, donus && uyandi, `durum ${await durum()}, toplam ${((Date.now() - t0) / 1000).toFixed(0)} sn`);
    // Bayat satır: Ayarlar sayfası hep açık kaldı; düzelince "çalışmıyor" cümlesi kendiliğinden kalkmalı (gün kaydında pencere hiç kapanmadı).
    await bekle(500);
    kaydet(`düzelince Ayarlar satırı temizlendi${ek}`, (await w.locator('[data-uyandirma="dustu"]').count()) === 0);
    if (gunKaydi) {
      // Bayat durum (2. tur): vazgeçti → pencere yeniden kuruldu → motor ilk denemede açıldı → gün kaydı kapandı: çalışan "Hey Fuber" kapanmamalı.
      await u.evaluate(() => { globalThis.__bozuk = true; });
      await ayarla(false);
      await bekle(500);
      await ayarla(true);
      kaydet('yeniden bozuldu: vazgeçti', await durumBekle('vazgecti', 50), await durum());
      await u.evaluate(() => { globalThis.__bozuk = false; });
      await gunKaydiAyarla(false);
      await bekle(1200);
      kaydet('vazgeçmişken gün kaydı kapandı: kulak kapandı', !(await kulakVar()));
      await gunKaydiAyarla(true);
      kaydet('pencere yeniden kuruldu, motor ilk denemede açıldı: durum düzeldi', await durumBekle('calisiyor', 25), await durum());
      await gunKaydiAyarla(false);
      await bekle(1500);
      kaydet('gün kaydı kapanınca çalışan "Hey Fuber" penceresi kaldı', await kulakVar());
      await ada.evaluate(() => { window.__olay = []; });
      kaydet('o pencere uyanmaya devam ediyor', await uyanmaBekle(25));
    }
  } finally {
    await u.close().catch(() => undefined);
    fs.rmSync(veri, { recursive: true, force: true });
  }
}

/** Yavaş disk: uyandırma dosyalarının her biri 12 sn gecikir. Toplam açılış eski 20 sn sınırını da yeni 45 sn sessizlik sınırını da aşar; ilerleme
 *  geldiği için çökme sayılmamalı. */
async function yavasDisk(wav) {
  const veri = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-uyandirma-'));
  fs.writeFileSync(path.join(veri, 'ayarlar.json'), JSON.stringify({
    kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: '0.9.0', kullaniciAdi: 'Deniz', hitap: 'Deniz', baslangictaAc: false,
    ses: { surum: 2, uyandirma: false, seslendirme: false }, proaktif: { etkin: false },
  }));
  const u = await electron.launch({ executablePath: exe, args: acilisArgumanlari(wav), env: ortamKur(veri), timeout: 60000 });
  try {
    let w;
    for (let i = 0; i < 160 && !w; i++) { w = u.windows().find((x) => x.url().includes('index.html')); if (!w) await bekle(250); }
    await w.waitForSelector('.kokpit', { timeout: 30000 });
    await u.evaluate(({ net }) => {
      const asil = net.fetch.bind(net);
      net.fetch = async (a, ...b) => {
        if (String(a).includes('/uyandirma/')) await new Promise((c) => setTimeout(c, 12_000));
        return asil(a, ...b);
      };
    });
    await w.evaluate(() => { window.__durumlar = []; window.fuber.dinle('kulak:durum', (v) => window.__durumlar.push(v.uyandirma)); });
    const t0 = Date.now();
    await w.evaluate(async () => { const a = await window.fuber.cagir('ayarlar:al'); await window.fuber.cagir('ayarlar:kaydet', { ses: { ...a.ses, uyandirma: true } }); });
    let durumlar = [];
    for (let i = 0; i < 200 && !durumlar.includes('calisiyor'); i++) { await bekle(500); durumlar = await w.evaluate(() => window.__durumlar); }
    const sn = (Date.now() - t0) / 1000;
    kaydet('yavaş disk: açılış 45 sn\'yi aştı, sonunda motor çalıştı', durumlar.includes('calisiyor') && sn > 45, `${sn.toFixed(0)} sn`);
    kaydet('yavaş disk: çökme sayılmadı (düşme yok, uyarı yok)', !durumlar.includes('dustu') && !durumlar.includes('vazgecti'), durumlar.join(' ') || 'durum yok');
  } finally {
    await u.close().catch(() => undefined);
    fs.rmSync(veri, { recursive: true, force: true });
  }
}

const gecici = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-uyandirma-ses-'));
try {
  const hf = path.join(gecici, 'hey-fuber.wav');
  const komsu = path.join(gecici, 'komsu.wav');
  const v = (a) => path.join(kok, 'tests/veri', a);
  kolaj(hf, [v('uyandirma-hey-fuber.wav')], 9);
  kolaj(komsu, [v('uyandirma-hey.wav'), v('uyandirma-hey-uber.wav')], 2);

  const a = await kos(hf, 45);
  if (paketli) {
    kaydet('uygulama paketli test kopyası (isPackaged); motor dosyaları kaynak/uyandirma altında', a.paket.paketli === true && fs.existsSync(path.join(a.paket.kaynak, 'kaynak', 'uyandirma', 'sherpa-onnx-wasm-kws-main.wasm')), JSON.stringify(a.paket));
    // ScriptProcessor uyarısı bilinçli (kulak.ts: Vosk AudioBuffer ister); başka uyarı ya da hata konsolda kalmamalı (CSP, importScripts, WASM).
    const konsolKalan = a.konsol.filter((k) => !/ScriptProcessorNode is deprecated/.test(k));
    kaydet('motor açıldı (kulak:uyandirma-durum) ve kulak konsolu temiz', a.durum === 'calisiyor' && konsolKalan.length === 0, `${a.durum} · ${konsolKalan.join(' | ') || 'temiz'}`);
  }
  const uyanma = a.olaylar.filter((x) => x.tur === 'uyandi');
  kaydet('"Hey Fuber" gizli pencerede uyandırdı', uyanma.length >= 1, `${uyanma.length} uyanma, olaylar: ${a.olaylar.map((x) => x.tur).join(' ')}`);
  const ilk = uyanma[0];
  const bos = ilk && a.olaylar.find((x) => x.tur === 'bos' && x.t > ilk.t);
  const sure = bos ? bos.t - ilk.t : null;
  kaydet('konuşma gelmeyince 3 sn sonra "bos"', Boolean(bos) && sure >= 2900 && sure <= 3600, `${sure} ms`);
  kaydet('sohbete bir şey yazılmadı (metin olayı yok)', !a.olaylar.some((x) => x.tur === 'metin'));
  // Spec: 3 sn konuşma yoksa çentik kapanır. Ölçülen: "bos"tan ≈270 ms sonra (geri çekilme dahil); 1,5 sn tavan gerilemeyi yakalar.
  const gizlenme = bos && a.gizlendi.find((t) => t >= bos.t);
  kaydet('"bos"tan sonra çentik beklemeden kapandı', Boolean(gizlenme) && gizlenme - bos.t <= 1500, gizlenme ? `${gizlenme - bos.t} ms` : 'gizlenmedi');
  kaydet('hata olayı yok', !a.olaylar.some((x) => x.tur === 'hata'), a.olaylar.filter((x) => x.tur === 'hata').map((x) => x.mesaj).join(' · '));
  console.log(`   kulak penceresi işlemci: %${a.metrik?.toFixed?.(1)} · konsol: ${a.konsol.join(' | ') || 'temiz'}`);

  const b = await kos(komsu, 40);
  const yanlis = b.olaylar.filter((x) => x.tur === 'uyandi').length;
  kaydet('"Hey" ve "Hey Uber" 40 sn döngüde uyandırmadı', yanlis === 0, `${yanlis} yanlış uyanma`);

  await dusme(hf, false);
  await dusme(hf, true);
  await yavasDisk(hf);
} catch (h) {
  kaydet('HATA', false, h.stack);
} finally {
  fs.rmSync(gecici, { recursive: true, force: true });
  const k = sonuclar.filter((x) => !x).length;
  console.log(`\n${sonuclar.length - k}/${sonuclar.length} geçti`);
  process.exitCode = k ? 1 : 0;
}
