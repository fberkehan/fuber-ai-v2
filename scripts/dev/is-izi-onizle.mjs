// ═══ İş izi önizlemesi ve videosu (11 Kas 2026; alt ajanlara giden işlerde ne yapıldığı belli olmuyordu) ═══
// GERÇEK uygulama (Electron, FUBER_DEMO, pencereler ekran dışı, ses yok) + SAHTE Claude Code (scripts/dev/sahte-claude.mjs #ucajan: üç PARALEL alt ajan).
// Akış: kokpitteki Fuber sohbetinden `claude_code_gorev` aracı GERÇEK yolundan çağrılır (model çağrılmaz; main.ts __fuberAracDene) → uygulama içi oturum
// başlar → sahte Claude Code üç Task alt ajanını iç içe adımlarla yürütür → ana süreç iş izini olayla yayar → aynı cümle üç yerde: çentik (yörünge + liste),
// sohbet (yardımcı şeritleri, her biri kendi tonunda), kokpit ("Şu an" kartı); rayda Claude Code simgesinde nokta. Biter: tik + uçuş, şeritler tek satıra kapanır.
// Denetimler (başarısızsa çıkış 1):
//   · üç yardımcı üç yüzeyde aynı anda görünür (çentik satırları, sohbet şeritleri, kokpit kartı), tonları ayrışır, ray noktası Claude Code'da;
//   · iç kimlik ve "general-purpose" hiçbir yüzeyde görünmez; telefona giden olay yalnız durum taşır;
//   · hareket yalnız transform/opacity (iş izi anahtar kareleri); iş bitince hiçbir iş izi öğesi kalmaz (boşta döngü yok).
// Çıktı: <çıktı>/kareler/*.png, <çıktı>/is-izi-3-yardimci.mp4 (çentik ana pencerenin üst ortasına bindirilir). ffmpeg gerekir.
// Çalıştır: npm run build && node scripts/dev/is-izi-onizle.mjs [çıktı-klasörü] [tema=koyu|acik] [sade]
import { KURULUM_SURUMU } from '../../src/shared/kurulum-adimlari.ts';
import { _electron as electron } from 'playwright-core';
import electronYolu from 'electron';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const kok = path.resolve(import.meta.dirname, '../..');
if (!fs.existsSync(path.join(kok, 'dist', 'main', 'main.js'))) { console.error('dist yok: önce npm run build'); process.exit(1); }
const cikti = path.resolve(process.argv[2] || path.join(kok, '.superpowers', 'is-izi'));
const TEMA = process.argv[3] === 'acik' ? 'acik' : 'koyu';
const SADE = process.argv.includes('sade');
const ad = `${TEMA}${SADE ? '-sade' : ''}`;
const kareDiz = path.join(cikti, `kareler-${ad}`);
fs.rmSync(kareDiz, { recursive: true, force: true });
fs.mkdirSync(kareDiz, { recursive: true });
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const sonuclar = [];
const kontrol = (a, tamam, ayrinti = '') => { sonuclar.push({ a, tamam: Boolean(tamam) }); console.log(`${tamam ? '✅' : '❌'} ${a}${ayrinti ? ` — ${String(ayrinti).slice(0, 600)}` : ''}`); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-is-izi-'));
const veri = path.join(tmp, 'veri');
const ev = path.join(tmp, 'ev');
const claudeDiz = path.join(tmp, '.claude');
const proje = path.join(tmp, 'kod', 'mavi-kus');
for (const d of [veri, ev, proje, claudeDiz, path.join(veri, 'belgeler')]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(veri, 'ayarlar.json'), JSON.stringify({
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: '0.9.0', kullaniciAdi: 'Deniz', hitap: 'Deniz', baslangictaAc: false, mod: 'gelistirici',
  ses: { uyandirma: false, seslendirme: false }, proaktif: { etkin: false }, gorunum: { tema: TEMA, adaSessiz: false, ...(SADE ? { karakterler: 'sade' } : {}) },
  claudeCode: { etkin: true, terminal: 'konsol', tamYetki: false },
}));
const ortam = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('FUBER_SIR_') && k !== 'FUBER_GORUNUR'));
Object.assign(ortam, {
  FUBER_DEMO: '1', FUBER_VERI: veri, FUBER_BELGELER: path.join(veri, 'belgeler'), FUBER_TEST_TAM_EKRAN: '0', FUBER_TEST_ANA_ONDE: '0', USERPROFILE: ev, HOME: ev,
  FUBER_CLAUDE_DIZIN: claudeDiz, FUBER_CLAUDE_GIZLI: '1', SAHTE_CC_PID_DOSYASI: path.join(tmp, 'pid.txt'),
  FUBER_CLAUDE_KOMUT: JSON.stringify([process.execPath, path.join(kok, 'scripts/dev/sahte-claude.mjs')]),
});

let u;
const hatalar = [];
try {
  u = await electron.launch({ executablePath: electronYolu, args: [kok], env: ortam, timeout: 60000 });
  const pencere = async (p) => { for (let i = 0; i < 160; i++) { const w = u.windows().find((x) => x.url().includes(p)); if (w) return w; await bekle(250); } throw new Error(`${p} yok`); };
  const ana = await pencere('index.html');
  ana.on('pageerror', (e) => hatalar.push(`ana: ${e}`));
  await ana.waitForSelector('.kokpit', { timeout: 30000 });
  const ada = await pencere('asistan.html');
  ada.on('pageerror', (e) => hatalar.push(`ada: ${e}`));
  await u.evaluate(({ BrowserWindow }) => { const x = BrowserWindow.getAllWindows().find((p) => p.webContents.getURL().includes('index.html')); x?.unmaximize(); x?.setContentSize(1600, 960); });
  // Çentik görünür (uygulama önde değil sayılır; FUBER_TEST_ANA_ONDE=0) ve ekran dışında kalır; içerik ekran görüntüsünden okunur.
  await u.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('asistan.html'))?.showInactive(); });
  const cagir = (k, ...a) => ana.evaluate(([kk, aa]) => window.fuber.cagir(kk, ...aa), [k, a]);
  await bekle(1500);

  // Boşta: hiçbir iş izi öğesi yok (döngü yok).
  const bosta = await ana.evaluate(() => document.querySelectorAll('.is-seridi, .is-isaret, .ray__is, .is-yorunge, .is-sohbet').length);
  const adaBosta = await ada.evaluate(() => document.querySelectorAll('.is-seridi, .is-yorunge, .ada__is-hap').length);
  kontrol('Boşta: ana pencerede ve çentikte hiçbir iş izi öğesi yok', bosta === 0 && adaBosta === 0, JSON.stringify({ bosta, adaBosta }));


  const anaId = await cagir('sohbet:ana');
  // ── Kareler: iki pencere aynı anda (çentik saydam zeminle) ──
  let kareNo = 0;
  let cekiyor = true;
  const zamanlar = [];
  const cek = (async () => {
    while (cekiyor) {
      const n = String(kareNo).padStart(4, '0');
      const t = Date.now();
      try {
        await Promise.all([
          ana.screenshot({ path: path.join(kareDiz, `ana_${n}.png`) }),
          ada.screenshot({ path: path.join(kareDiz, `ada_${n}.png`), omitBackground: true }),
        ]);
        zamanlar.push(t);
        kareNo++;
      } catch { /* kare atlanır */ }
      const gecen = Date.now() - t;
      if (gecen < 100) await bekle(100 - gecen);
    }
  })();
  await bekle(900);

  // ── Sohbetten Claude Code'a iş: claude_code_gorev GERÇEK yolundan (kayıtla: sohbette araç kartı ve "Oturumu aç") ──
  const arac = await u.evaluate((_e, [g, s]) => globalThis.__fuberAracDene('claude_code_gorev', g, s, true), [{ komut: 'Eski ekranlardaki sabit genişlikleri bul, etkilenen testleri çıkar #ucajan:16', klasor: proje }, anaId]);
  kontrol('claude_code_gorev: uygulama içi oturum sohbetten başladı', !arac.hata && /uygulama içinde başladı/.test(arac.icerik), arac.icerik);

  // Üç yardımcı aynı anda: üç yüzey.
  let uc = null;
  for (let i = 0; i < 120 && !uc; i++) {
    const r = await ana.evaluate(() => ({
      sohbet: [...document.querySelectorAll('.is-sohbet .is-seridi[data-kaynak="cc-ajan"]')].map((e) => ({ hal: e.dataset.hal, ton: e.style.getPropertyValue('--is-ton'), metin: e.textContent })),
      kokpit: [...document.querySelectorAll('[data-su-an] .is-seridi[data-kaynak="cc-ajan"]')].map((e) => e.dataset.hal),
      ray: document.querySelector('.ray__dgm[data-tur="claude"] .ray__is')?.dataset.isRay ?? null,
    }));
    if (r.sohbet.length === 3 && r.kokpit.length === 3 && r.sohbet.filter((x) => x.hal === 'calisiyor').length >= 2) uc = r;
    else await bekle(150);
  }
  kontrol('Üç yardımcı sohbette ayrı şeritte (Yardımcı 1/2/3), kokpitin "Şu an" kartında ve rayda Claude Code noktası', Boolean(uc) && uc.ray === 'canli', JSON.stringify(uc));
  kontrol('Paralel yardımcıların tonu ayrışır', uc && new Set(uc.sohbet.map((x) => x.ton)).size === 3, JSON.stringify(uc?.sohbet.map((x) => x.ton)));
  const adaHal = await ada.evaluate(() => ({ hal: document.querySelector('.ada')?.dataset.adaHal, nokta: document.querySelectorAll('.ada__katman:not(.ada__katman--cikan) .is-yorunge__halka > b').length, metin: document.querySelector('.ada__katman:not(.ada__katman--cikan) .ada__is-hap')?.textContent ?? '' }));
  kontrol('Çentik: iş hapı, yörüngede iş sayısı kadar nokta ("4 iş · …" ya da "3 iş · …")', adaHal.hal === 'gorev' && adaHal.nokta >= 3, JSON.stringify(adaHal));
  await bekle(2500);
  // Çentiğin üstüne gelinir: en çok 3 satır.
  await ada.hover('.ada__sekil', { force: true }).catch(() => undefined);
  let liste = null;
  for (let i = 0; i < 30 && !liste; i++) { const r = await ada.evaluate(() => ({ hal: document.querySelector('.ada')?.dataset.adaHal, satir: [...document.querySelectorAll('.ada__katman:not(.ada__katman--cikan) .ada__is-liste .is-seridi')].map((e) => e.textContent) })); if (r.hal === 'isler' && r.satir.length >= 3) liste = r; else await bekle(100); }
  kontrol('Çentik listesi: üstüne gelince en çok 3 satır (yardımcı, canlı fiil, yer)', Boolean(liste) && liste.satir.length === 3, JSON.stringify(liste));
  await bekle(3500);
  await ada.mouse.move(2, 400).catch(() => undefined);

  // İç kimlik ve "general-purpose" hiçbir yüzeyde görünmez.
  const metinler = [await ana.evaluate(() => document.body.innerText), await ada.evaluate(() => document.body.innerText)].join('\n');
  kontrol('İç kimlik yok (toolu_, cc:, sohbet:N, general-purpose, H-N)', !/toolu_|\bcc:[\w-]+|\bsohbet:\d|general-purpose|\bH-\d+\b/.test(metinler), (metinler.match(/toolu_\w+|\bcc:[\w-]+|\bsohbet:\d|general-purpose|\bH-\d+\b/g) ?? []).join(','));

  // Hareket kuralı: iş izi anahtar kareleri yalnız transform / opacity.
  const kural = await ana.evaluate(() => {
    const kotu = [];
    for (const s of document.styleSheets) {
      let kurallar; try { kurallar = s.cssRules; } catch { continue; }
      for (const r of kurallar) {
        if (!(r instanceof CSSKeyframesRule) || !/^is-|^ada-is-/.test(r.name)) continue;
        for (const k of r.cssRules) for (const p of k.style) if (p !== 'transform' && p !== 'opacity') kotu.push(`${r.name}:${p}`);
      }
    }
    return kotu;
  });
  kontrol('İş izi anahtar kareleri yalnız transform ve opacity', kural.length === 0, kural.join(','));

  // Bitiş: hepsi biter, şeritler tek satıra kapanır, sonra iş izi kaybolur.
  let ozet = '';
  for (let i = 0; i < 200 && !ozet; i++) { ozet = await ana.evaluate(() => document.querySelector('.is-sohbet .is-katli__metin')?.textContent ?? ''); if (!ozet) await bekle(100); }
  const katliSerit = await ana.evaluate(() => document.querySelectorAll('.is-sohbet .is-grubu__cocuklar .is-seridi').length);
  await ana.screenshot({ path: path.join(cikti, `${ad}-sohbet-katli.png`) });
  kontrol('11 Kas: yardımcılar bitince şeritleri tek katlı satıra iner: "3 yardımcı · N adım · S sn" (şeritler kapalı)', /^3 yardımcı · \d+ adım · \d+ sn$/.test(ozet) && katliSerit === 0, JSON.stringify({ ozet, katliSerit }));
  await ana.evaluate(() => document.querySelector('.is-sohbet .is-katli__bas')?.click());
  await bekle(400);
  const acilan = await ana.evaluate(() => ({ serit: document.querySelectorAll('.is-sohbet .is-katli__ic .is-seridi[data-kaynak="cc-ajan"]').length, acik: document.querySelector('.is-sohbet .is-katli__bas')?.getAttribute('aria-expanded') }));
  await ana.screenshot({ path: path.join(cikti, `${ad}-sohbet-katli-acik.png`) });
  kontrol('Katlı satıra tıklayınca üç yardımcının şeridi açılır', acilan.serit === 3 && acilan.acik === 'true', JSON.stringify(acilan));
  let bitti = false;
  for (let i = 0; i < 120 && !bitti; i++) { bitti = (await ana.evaluate(() => document.querySelectorAll('.is-seridi, .ray__is, .is-sohbet').length)) === 0; if (!bitti) await bekle(150); }
  await bekle(800);
  const adaSon = await ada.evaluate(() => document.querySelectorAll('.is-seridi, .is-yorunge, .ada__is-hap').length);
  kontrol('İş bitince hiçbir iş izi öğesi kalmaz (ana pencere ve çentik)', bitti && adaSon === 0, JSON.stringify({ bitti, adaSon }));
  cekiyor = false;
  await cek;
  // Sohbetin son hâli: Claude Code özeti yazıldı.
  await ana.screenshot({ path: path.join(cikti, `${ad}-son.png`) });
  // Claude Code sayfası (11 Kas): art arda biten üç yardımcı tek katlı satır ("✓ 3 yardımcı · N adım · S sn"); tıklayınca ortak şeritleri açılır
  // ("Yardımcı N", tik, süre; "general-purpose" çipi yok), her biri kendi şeridine kapalı.
  await cagir('ana:goster', arac.yol ?? 'claude');
  await ana.waitForSelector('[data-cc-katli="ajan"]', { timeout: 10000 }).catch(() => undefined);
  await bekle(800);
  await ana.evaluate(() => document.querySelector('[data-cc-katli="ajan"]')?.scrollIntoView({ block: 'center' }));
  await bekle(400);
  const ccKatli = await ana.evaluate(() => ({ metin: document.querySelector('[data-cc-katli="ajan"] .is-katli__metin')?.textContent ?? '', acikKart: document.querySelectorAll('.cc-ajan').length }));
  await ana.screenshot({ path: path.join(cikti, `${ad}-claude-code-katli.png`) });
  kontrol('Claude Code: biten üç yardımcı tek katlı satır ("3 yardımcı · N adım · S sn"), kartlar kapalı', /^3 yardımcı · \d+ adım · \d+ sn$/.test(ccKatli.metin) && ccKatli.acikKart === 0, JSON.stringify(ccKatli));
  await ana.evaluate(() => document.querySelector('[data-cc-katli="ajan"] .is-katli__bas')?.click());
  await ana.waitForSelector('.cc-ajan > .is-seridi', { timeout: 5000 }).catch(() => undefined);
  await bekle(500);
  const ccGovde = await ana.evaluate(() => document.querySelectorAll('.cc-ajan__govde').length);
  kontrol('Claude Code: açılan yardımcılar kendi şeridinde, gövdeleri kapalı (bitti)', ccGovde === 0, String(ccGovde));
  await ana.screenshot({ path: path.join(cikti, `${ad}-claude-code.png`) });
  const ccBas = await ana.evaluate(() => [...document.querySelectorAll('.cc-ajan > .is-seridi')].map((e) => ({ metin: e.textContent, hal: e.dataset.hal, ton: e.style.getPropertyValue('--is-ton') })));
  kontrol('Claude Code: alt ajan kartlarının başlığı ortak şerit (Yardımcı 1/2/3, ayrı ton, "general-purpose" yok)', ccBas.length === 3 && ccBas.every((t) => /Yardımcı \d/.test(t.metin) && !/general-purpose/.test(t.metin)) && new Set(ccBas.map((t) => t.ton)).size === 3, JSON.stringify(ccBas));

  // ── Video: kareler sabit hızla; çentik ana pencerenin üst ortasına bindirilir ──
  const sure = (zamanlar.at(-1) - zamanlar[0]) / 1000;
  const fps = Math.max(4, Math.round((kareNo - 1) / Math.max(1, sure)));
  const mp4 = path.join(cikti, `is-izi-3-yardimci-${ad}.mp4`);
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(kareDiz, 'ana_%04d.png'), '-framerate', String(fps), '-i', path.join(kareDiz, 'ada_%04d.png'),
    '-filter_complex', '[1]scale=iw*0.9:-1[c];[0][c]overlay=(W-w)/2:0,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', mp4], { encoding: 'utf8' });
  kontrol(`Video yazıldı (${kareNo} kare, ~${fps} kare/sn, ${sure.toFixed(1)} sn)`, r.status === 0 && fs.existsSync(mp4) && fs.statSync(mp4).size > 50_000, r.stderr);
  console.log(`VIDEO ${mp4}`);
  kontrol('Sayfa hatası yok', hatalar.length === 0, hatalar.join(' | '));
} catch (e) {
  kontrol('koşu', false, e?.stack ?? String(e));
} finally {
  try { await u?.evaluate(({ app }) => app.quit()); } catch { /* */ }
  await bekle(1500);
  try { await u?.close(); } catch { /* */ }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
const kalan = sonuclar.filter((s) => !s.tamam);
console.log(`\n${sonuclar.length - kalan.length}/${sonuclar.length} denetim geçti`);
process.exit(kalan.length ? 1 : 0);
