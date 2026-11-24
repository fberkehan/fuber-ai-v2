#!/usr/bin/env node
// ═══ Göz önizlemesi (11 Kas, "Pamuk"; eski karakter-onizle / karakter-videolari yerine) ═══
// Uygulama ARKA PLAN KİPİNDE açılır (FUBER_DEMO; FUBER_GORUNUR ASLA; ses yok). Galerinin #galeri/karakter sayfası (yalnız test derlemesi):
//   1) her [data-blok] (ifadeler × iki mod, çentik şeridi 16 px; boylar 24–160 px) görüntüsü;
//   2) denetimler: durağan gözlerde hiçbir canlandırma yok (boşta çizim yok), her gözde iki göz, renk yalnız beyaz/siyah/kip vurgusu, kademeler (24 px xs);
//   3) canlı gözün yakın çekim videosu (CDP ekran yayını → 30 kare/sn → MP4): boşta sakkad ve kırpma, imleç takibi, dinliyor, düşünüyor, konuşuyor, onay,
//      hata, sevinç, selam, mod geçişi (parıltı çapraz solar), sonra 60 sn girdisizlik → uyku (yarıya düşme, iki yavaş kırpma, kapanma, 6 nefes) → durgunluk
//      (yayın kare vermez) → uyanış. Uykudan sonra 3 sn boyunca yayın karesi 0 olmalı.
// Çalıştır: npm run build && node scripts/dev/goz-onizle.mjs [çıktı-klasörü]   (varsayılan: <depo>/.superpowers/pamuk/goz)
import { KURULUM_SURUMU } from '../../src/shared/kurulum-adimlari.ts';
import { TANITIM_SURUMU } from '../../src/shared/tanitim.ts';
import { _electron as electron } from 'playwright-core';
import electronYolu from 'electron';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (process.env.FUBER_GORUNUR) { console.error('DUR: FUBER_GORUNUR ayarlı; bu betik yalnız arka plan kipinde koşar.'); process.exit(1); }
const kok = path.resolve(import.meta.dirname, '../..');
if (!fs.existsSync(path.join(kok, 'dist', 'main', 'main.js'))) { console.error('dist yok: önce npm run build'); process.exit(1); }
const cikti = path.resolve(process.argv[2] ?? path.join(kok, '.superpowers', 'pamuk', 'goz'));
fs.mkdirSync(cikti, { recursive: true });
const FPS = 30;
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const sonuclar = [];
const kontrol = (ad, tamam, ayrinti = '') => { sonuclar.push(Boolean(tamam)); console.log(`${tamam ? '✅' : '❌'} ${ad}${ayrinti && !tamam ? ` — ${String(ayrinti).slice(0, 600)}` : ''}`); };

const veri = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-goz-'));
fs.mkdirSync(path.join(veri, 'belgeler'), { recursive: true });
fs.writeFileSync(path.join(veri, 'ayarlar.json'), JSON.stringify({
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: TANITIM_SURUMU, kullaniciAdi: 'Deniz', hitap: 'Deniz', baslangictaAc: false,
  ses: { uyandirma: false, seslendirme: false }, proaktif: { etkin: false }, gorunum: { tema: 'koyu', adaSessiz: true },
}));
const ortam = Object.assign(Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('FUBER_SIR_') && k !== 'FUBER_GORUNUR')), {
  FUBER_DEMO: '1', FUBER_VERI: veri, FUBER_BELGELER: path.join(veri, 'belgeler'), FUBER_BILGISAYAR_ADI: 'DENIZ-PC', FUBER_TEST_TAM_EKRAN: '0', FUBER_TEST_ANA_ONDE: '0',
});

let u = null;
try {
  u = await electron.launch({ executablePath: electronYolu, args: [kok], env: ortam, timeout: 60000 });
  let w = null;
  for (let i = 0; i < 120 && !w; i++) { w = u.windows().find((x) => x.url().includes('index.html')) ?? null; if (!w) await bekle(250); }
  if (!w) throw new Error('ana pencere yok');
  const hatalar = [];
  w.on('pageerror', (e) => hatalar.push(String(e)));
  w.on('console', (m) => { if (m.type() === 'error') hatalar.push(m.text()); });
  await w.waitForSelector('#kok > *', { timeout: 30000 });
  await u.evaluate(({ BrowserWindow }) => { const x = BrowserWindow.getAllWindows().find((p) => p.webContents.getURL().includes('index.html')); x?.unmaximize(); x?.setContentSize(1500, 1000); });
  await w.evaluate(() => { location.hash = '#galeri/karakter'; location.reload(); });
  await w.waitForSelector('[data-karakter-sayfasi] [data-blok]', { timeout: 30000 });
  await bekle(1200);

  // ── 1) Bloklar ──
  const bloklar = await w.evaluate(() => [...document.querySelectorAll('[data-blok]')].map((b) => b.dataset.blok));
  for (const b of bloklar) await w.locator(`[data-blok="${b}"]`).screenshot({ path: path.join(cikti, `blok-${b}.png`) });
  kontrol(`göz galerisi: ${bloklar.length} blok (ifadeler ve boylar, iki mod)`, bloklar.length === 4, JSON.stringify(bloklar));

  // ── 2) Denetimler ──
  const d = await w.evaluate(() => {
    const durgun = [...document.querySelectorAll('[data-blok] svg.gozler')];
    const canliAnim = durgun.reduce((n, s) => n + s.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length, 0);
    const renkler = new Set();
    for (const s of durgun.slice(0, 20)) for (const e of s.querySelectorAll('path, circle')) {
      const c = getComputedStyle(e); if (Number(c.opacity) === 0 || c.display === 'none') continue;
      for (const v of [c.fill, c.stroke]) if (v && v !== 'none') renkler.add(v);
    }
    const kademe = (b) => document.querySelector(`[data-boy="${b}"] svg.gozler`)?.dataset.kademe;
    return {
      sayi: durgun.length, canliAnim, ikiGoz: durgun.every((s) => s.querySelectorAll('.goz').length === 2), canliIsaret: durgun.filter((s) => s.hasAttribute('data-canli')).length,
      renkler: [...renkler], k24: kademe(24), k160: kademe(160), centik: [...document.querySelectorAll('[data-sira="centik"] svg.gozler')].map((s) => `${Math.round(s.getBoundingClientRect().width)}x${Math.round(s.getBoundingClientRect().height)}`)[0],
    };
  });
  kontrol('durağan gözlerde canlandırma yok (boşta çizim yok), her svg iki göz, hiçbiri canlı değil', d.sayi > 50 && d.canliAnim === 0 && d.ikiGoz && d.canliIsaret === 0, JSON.stringify(d));
  const izinli = ['rgb(255, 255, 255)', 'rgb(0, 0, 0)', 'rgb(240, 149, 50)', 'rgb(103, 173, 88)'];
  kontrol('renk yalnız beyaz, siyah ve kipin vurgusu (#F09532 / #67AD58)', d.renkler.every((r) => izinli.includes(r)), JSON.stringify(d.renkler));
  kontrol('kademe: 24 px avatar xs (dolgun yay, ince parıltı gizli), 160 px m; çentik şeridi 16 px göz ≈ 62×25', d.k24 === 'xs' && d.k160 === 'm' && d.centik === '62x25', JSON.stringify({ k24: d.k24, k160: d.k160, centik: d.centik }));

  // ── 3) Canlı göz yakın çekim videosu ──
  const sahne = w.locator('[data-canli-sahne="gozler"]');
  await sahne.scrollIntoViewIfNeeded();
  await bekle(500);
  const kutu = await sahne.boundingBox();
  const cdp = await w.context().newCDPSession(w);
  const kareler = [];
  cdp.on('Page.screencastFrame', (f) => { kareler.push({ t: f.metadata.timestamp * 1000, data: f.data }); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined); });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 });
  const t0 = Date.now();
  const etiketler = [];
  const an = (ad) => etiketler.push({ ad, t: Date.now() - t0 });
  const hal = async (h, ms) => { an(h); await w.locator(`[data-hal-dugmesi="${h}"]`).click(); await bekle(ms); };
  const merkez = { x: kutu.x + kutu.width / 2, y: kutu.y + kutu.height / 2 };
  an('boşta: sakkad ve kırpma'); await w.mouse.move(merkez.x, kutu.y + kutu.height + 200); await bekle(6000);
  an('imleç takibi');
  for (const [dx, dy] of [[-150, -80], [150, -80], [150, 100], [-150, 100], [0, 0]]) { await w.mouse.move(merkez.x + dx, merkez.y + dy, { steps: 12 }); await bekle(500); }
  await w.mouse.move(merkez.x, kutu.y + kutu.height + 400, { steps: 6 }); await bekle(900);
  await hal('dinliyor', 2800); await hal('dusunuyor', 3600); await hal('konusuyor', 3200); await hal('onay', 2400); await hal('hata', 2600); await hal('sevinc', 2400);
  await hal('sakin', 1500);
  an('selam'); await w.locator('[data-tetik-dugmesi="selam"]').click(); await bekle(1600);
  an('mod: Developer'); await w.locator('[data-mod-dugmesi]').click(); await bekle(1800);
  // FUBER_GOZ_KIP=developer: Developer'da kalır (12 Kas: Odak gözlerinin uykusu ve durgunluğu ölçülür).
  if (process.env.FUBER_GOZ_KIP !== 'developer') { an('mod: Business'); await w.locator('[data-mod-dugmesi]').click(); await bekle(1800); }
  // Uyku: son girdiden 60 sn (gerçek saat); imleç sayfanın dışına (girdi yok).
  await w.mouse.move(2, 2);
  const girdiSon = Date.now();
  let uykuAni = 0;
  for (let i = 0; i < 400; i++) { if (await w.evaluate(() => Boolean(document.querySelector('[data-canli-sahne] svg.gozler[data-uyuyor]')))) { uykuAni = Date.now(); break; } await bekle(250); }
  kontrol('canlı göz 60 sn girdisizlikten sonra uyur', uykuAni > 0 && uykuAni - girdiSon >= 58_000 && uykuAni - girdiSon < 66_000, String(uykuAni - girdiSon));
  an('uyku: yarıya düşer, iki yavaş kırpma, kapanır, 6 nefes');
  await bekle(34_500);
  const sessizBas = kareler.length;
  an('durgun: hiçbir şey çizilmez');
  await bekle(3000);
  const sessizKare = kareler.length - sessizBas;
  kontrol('uyku dizisi ve 6 nefes bitince ekran yayını kare vermez (3 sn, boşta çizim yok)', sessizKare === 0, String(sessizKare));
  an('uyanış'); await w.mouse.move(merkez.x + 40, merkez.y + 20, { steps: 8 }); await bekle(3200);
  const uyandi = await w.evaluate(() => !document.querySelector('[data-canli-sahne] svg.gozler[data-uyuyor]'));
  kontrol('imleç gelince uyanır (1,6 sn uyanış)', uyandi);
  const t1 = Date.now();
  await cdp.send('Page.stopScreencast');
  // 30 kare/sn'lik eşit dizi (yayın yalnız değişimde kare verir: aradaki anlar son kareyle) → sahneye kırpılmış, 2× büyütülmüş MP4.
  const fark = kareler.length ? Date.now() - kareler.at(-1).t : 0;
  void fark;
  const bas = kareler[0].t;
  const gecici = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-goz-kare-'));
  let f = 0; let n = 0;
  for (let t = bas; t <= bas + (t1 - t0); t += 1000 / FPS) { while (f + 1 < kareler.length && kareler[f + 1].t <= t) f++; fs.writeFileSync(path.join(gecici, `${String(n++).padStart(5, '0')}.jpg`), Buffer.from(kareler[f].data, 'base64')); }
  const olcek = await w.evaluate(() => devicePixelRatio);
  const kirp = `crop=${Math.round(kutu.width * olcek)}:${Math.round(kutu.height * olcek)}:${Math.round(kutu.x * olcek)}:${Math.round(kutu.y * olcek)}`;
  const mp4 = path.join(cikti, 'gozler-canli-tum-haller.mp4');
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(gecici, '%05d.jpg'), '-vf', `${kirp},scale=trunc(iw*2/2)*2:-2`, '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], { encoding: 'utf8' });
  fs.rmSync(gecici, { recursive: true, force: true });
  fs.writeFileSync(path.join(cikti, 'gozler-canli-zaman-cizelgesi.json'), JSON.stringify(etiketler, null, 1));
  kontrol(`video: ${path.basename(mp4)} (${n} kare, ${((t1 - t0) / 1000).toFixed(0)} sn)`, r.status === 0 && fs.existsSync(mp4) && fs.statSync(mp4).size > 50_000, r.stderr);
  // Durum anlarından kareler (inceleme için).
  for (const e of etiketler) {
    const sn = (e.t + 900) / 1000;
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(sn), '-i', mp4, '-frames:v', '1', path.join(cikti, `kare-${String(Math.round(e.t / 100)).padStart(4, '0')}-${e.ad.split(':')[0].replace(/[^a-zçğıöşü]/gi, '')}.png`)]);
  }
  kontrol('sayfa hatası yok', hatalar.length === 0, hatalar.join(' | '));
} catch (e) {
  kontrol('betik sonuna dek koştu', false, e?.stack ?? String(e));
} finally {
  if (u) await Promise.race([u.close().catch(() => undefined), bekle(10000)]);
  try { fs.rmSync(veri, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* kilitli */ }
}
const hata = sonuclar.filter((x) => !x).length;
console.log(`\n${sonuclar.length} denetim · ${hata} hata · ${cikti}`);
process.exit(hata ? 1 : 0);
