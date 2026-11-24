// 0.11 G11 — açılış animasyonu ve sesi: kare kare görüntüler + denetimler. Ağ YOK, anahtar YOK (FUBER_SIR_* silinir): her koşu için geçici
// FUBER_VERI, FUBER_DEMO=1 (ARKA PLAN KİPİ: pencereler görünmez, odak almaz; FUBER_GORUNUR KULLANILMAZ), FUBER_TEST_TAM_EKRAN='0'.
// Gerçek fare/klavye yok (tıklama ve tuşlar CDP ile sayfaya). Ses çalınmaz (FUBER_DEMO): çalacağı an "acilis-sesi" ana süreç
// günlüğüne (uygulama:test-acilis-olaylari) yazılır; denetimler onu okur.
// Denetimler (başarısızsa çıkış 1):
//   - Soğuk açılış: örtü belirir (tam kip), uygulama arkada hazır (kokpit örtü bitmeden DOM'da), ≤ 1,5 sn'de kalkar (işaret/yazı/erime
//     toplamı ≥ 1,3 sn; yani animasyon gerçekten tam oynar), olay sırası [acilis-basladi, acilis-sesi, acilis-bitti].
//   - İkinci show'da örtü YOK; arayüz yenilenince de yok (süreç başına bir kez); doğrudan soru false döner.
//   - `--gizli` başlangıç: tepsiye açılışta örtü oynamaz, ses/olay yok; pencere ilk gösterilince oynar.
//   - Azaltılmış hareket (prefers-reduced-motion): kısa kip (işaret durağan, ≤ 0,8 sn), ses kararı yine verilir.
//   - Tıklama ve herhangi bir tuş örtüyü atlatır (≤ 0,4 sn). Atlatan TIKLAMA tüketilir: alttaki (görünmeyen) denetim etkinleşmez, hiçbir
//     fare olayı alta ulaşmaz (kurulum sihirbazının "Devam"ı dahil); örtü kalkınca sonraki tıklama normal çalışır. Tuşlar uygulamaya geçer.
//     Pencere düğmeleri (Küçült/Büyüt/Kapat) örtünün üstünde görünür: ilk tıklamada çalışır (örtüyü atlatır, tüketilmez). Tüketilen hareketin
//     click'i hiç gelmezse kurulu yutma seti bir SONRAKİ pointerdown'da iptal olur (sonraki gerçek tıklama yenmez).
//     (Üretim davranışı; FUBER_DEMO'da otomasyonun ilk tıklaması kaybolmasın diye varsayılan geçirir — bu betik `<html data-acilis-tiklama="yut">`
//     ile üretim davranışını açar ve varsayılanın geçirdiğini de ayrıca denetler.)
//   - Ayarlar: açılış sesi kapalı / sessiz saat / rahatsız etme → "acilis-sesi" yazılmaz; açıkken yazılır. Ayarlar → Ses ve ada → "Açılış
//     sesi" anahtarı İş ve Geliştirici modunda görünür, varsayılan açık, kapatınca ses.acilisSesi=false yazılır.
//   - Kurulum sihirbazı (ilk açılış) üstünde de örtü oynar ve sihirbazı BEKLETMEZ (sihirbaz örtü bitmeden DOM'da ve tıklanabilir).
//   - Kareler (0, 150, 350, 560, 700, 900, 1250, 1350 ms) zaman çizelgesine uyar; üç tema × 1440×900 ve 1080×680 → konsol hatası yok.
// Çalıştır: npm run build && node scripts/dev/acilis-onizle.mjs [çıktı-klasörü]
import { KURULUM_SURUMU } from '../../src/shared/kurulum-adimlari.ts';
import { TANITIM_SURUMU } from '../../src/shared/tanitim.ts';
import { _electron as electron } from 'playwright-core';
import electronYolu from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

const kok = path.resolve(import.meta.dirname, '../..');
if (!fs.existsSync(path.join(kok, 'dist', 'main', 'main.js'))) { console.error('dist yok: önce npm run build'); process.exit(1); }
const cikti = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'fuber-acilis-onizle'));
fs.mkdirSync(cikti, { recursive: true });
const sonuclar = [];
const kontrol = (ad, tamam, ayrinti = '') => { sonuclar.push({ ad, tamam }); console.log(`${tamam ? '✅' : '❌'} ${ad}${ayrinti ? ` — ${String(ayrinti).slice(0, 600)}` : ''}`); };
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const hatalar = [];

const TEMEL = { kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: TANITIM_SURUMU, kullaniciAdi: 'Deniz', hitap: 'Deniz', baslangictaAc: false,
  // 0.11 G12b: saatten bağımsız — varsayılan sessiz saat (23:00–08:00) gece koşusunda açılış sesini DOĞRU olarak susturur ve "acilis-sesi" denetimleri
  // yalnız o saatlerde düşerdi. Sessiz saat aralığı boş (başlangıç = bitiş: hiç sessiz değil); sessiz saati sınayan senaryolar (aşağıda) kendi aralığını verir.
  proaktif: { etkin: false, sessizBaslangic: '00:00', sessizBitis: '00:00' }, gorunum: { tema: 'koyu' } };
const ortam = (veri) => {
  const o = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('FUBER_SIR_') && k !== 'FUBER_GORUNUR'));
  return Object.assign(o, { FUBER_DEMO: '1', FUBER_VERI: veri, FUBER_BELGELER: path.join(veri, 'belgeler'), FUBER_BILGISAYAR_ADI: 'DENIZ-PC', FUBER_TEST_TAM_EKRAN: '0' });
};
/** Yeni geçici veri klasörüyle uygulamayı açar (`gizli`: --gizli, tepsiye açılış). */
async function ac(ayar = TEMEL, { gizli = false } = {}) {
  const veri = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-acilis-'));
  fs.mkdirSync(path.join(veri, 'belgeler'), { recursive: true });
  fs.writeFileSync(path.join(veri, 'ayarlar.json'), JSON.stringify(ayar));
  const u = await electron.launch({ executablePath: electronYolu, args: gizli ? [kok, '--gizli'] : [kok], env: ortam(veri), timeout: 60000 });
  let w = null;
  for (let i = 0; i < 200 && !w; i++) { w = u.windows().find((x) => x.url().includes('index.html')) ?? null; if (!w) await bekle(100); }
  if (!w) throw new Error('index.html penceresi yok');
  w.on('pageerror', (e) => hatalar.push(`${path.basename(veri)}: ${e}`));
  w.on('console', (m) => { if (m.type() === 'error') hatalar.push(`${path.basename(veri)}: ${m.text()}`); });
  return { u, w, veri };
}
const kapat = async (u) => { try { await u.close(); } catch { /* kapanmış */ } };
const anaIslem = (u, islem) => u.evaluate(({ BrowserWindow }, i) => {
  const x = BrowserWindow.getAllWindows().find((p) => !p.isDestroyed() && p.webContents.getURL().includes('index.html'));
  if (!x) return { yok: true };
  if (i === 'goster') { x.show(); x.focus(); } else if (i === 'gizle') x.hide();
  else if (Array.isArray(i)) { x.setContentSize(i[0], i[1]); }
  return { gorunur: x.isVisible() };
}, islem);
const olaylar = async (w) => (await w.evaluate(() => window.fuber.cagir('uygulama:test-acilis-olaylari'))).map((o) => o.olay);
const isaret = (w) => w.evaluate(() => ({
  basladi: performance.getEntriesByName('acilis:basladi')[0]?.startTime ?? null,
  bitti: performance.getEntriesByName('acilis:bitti')[0]?.startTime ?? null,
  var: document.querySelectorAll('.acilis').length,
  kip: document.querySelector('.acilis')?.getAttribute('data-kip') ?? null,
}));
const orn = (w, ad) => w.screenshot({ path: path.join(cikti, ad) });
const kipBekle = (w, kip, ms = 30000) => w.waitForSelector(`.acilis[data-kip="${kip}"]`, { state: 'attached', timeout: ms });
const kalkanaKadar = async (w, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (!(await isaret(w)).var) return Date.now() - t; await bekle(25); } return -1; };

// ── 1) Soğuk açılış (koyu): örtü belirir, uygulama arkada hazır, ≤ 1,5 sn'de kalkar ─────────────────────────────────────────────────
{
  const { u, w } = await ac();
  await kipBekle(w, 'tam');
  const t0 = Date.now();
  // Örtü ilk 300 ms içinde: uygulama (kokpit) arkada çoktan çizilmiş olmalı (örtü hiçbir şeyi beklemez).
  await bekle(250);
  const arkada = await w.evaluate(() => ({ kokpit: Boolean(document.querySelector('.kokpit')), ray: Boolean(document.querySelector('.ray')), op: Number(getComputedStyle(document.querySelector('.acilis')).opacity) }));
  kontrol('soğuk açılış: örtü oynarken uygulama arkada hazır (kokpit + ray DOM\'da)', arkada.kokpit && arkada.ray, JSON.stringify(arkada));
  await orn(w, 'soguk-250ms.png');
  const gec = await kalkanaKadar(w);
  const m = await isaret(w);
  const sure = m.bitti !== null && m.basladi !== null ? m.bitti - m.basladi : -1;
  kontrol('soğuk açılış: örtü ≤ 1,5 sn\'de kalkar ve animasyon tam oynar (≥ 1,3 sn)', sure >= 1300 && sure <= 1500 && gec >= 0, `süre ${Math.round(sure)} ms (işaretlerle), ${t0 ? Date.now() - t0 : 0} ms duvar saati`);
  const o = await olaylar(w);
  kontrol('soğuk açılış: olay günlüğü [acilis-basladi, acilis-sesi, acilis-bitti] (demo\'da ses çalınmaz, kaydedilir)', JSON.stringify(o) === JSON.stringify(['acilis-basladi', 'acilis-sesi', 'acilis-bitti']), JSON.stringify(o));
  await bekle(250);
  await orn(w, 'soguk-sonra.png');
  // İkinci show: örtü yok.
  await anaIslem(u, 'gizle'); await bekle(150); await anaIslem(u, 'goster'); await bekle(500);
  const ikinci = await isaret(w);
  const o2 = await olaylar(w);
  kontrol('ikinci show\'da örtü YOK (süreç başına bir kez)', ikinci.var === 0 && o2.filter((x) => x === 'acilis-basladi').length === 1, JSON.stringify({ ikinci, o2 }));
  kontrol('doğrudan soru (uygulama:ilk-gosterim) false döner', (await w.evaluate(() => window.fuber.cagir('uygulama:ilk-gosterim'))) === false);
  // Arayüz yenilenince (süreç aynı) örtü yok: opak zemin bir iki kare görünüp kalkar.
  await w.reload();
  await w.waitForSelector('.kokpit', { timeout: 30000 });
  await bekle(400);
  const yeni = await isaret(w);
  const o3 = await olaylar(w);
  kontrol('arayüz yenilenince örtü yok ve yeni açılış olayı yok', yeni.var === 0 && o3.filter((x) => x === 'acilis-basladi').length === 1, JSON.stringify({ yeni, o3 }));
  await kapat(u);
}

// ── 2) --gizli: tepsiye açılışta örtü oynamaz; ilk gösterimde oynar ──────────────────────────────────────────────────────────────────────
{
  const { u, w } = await ac(TEMEL, { gizli: true });
  await w.waitForSelector('.kokpit', { state: 'attached', timeout: 30000 });
  await bekle(1800);
  const once = await isaret(w);
  const o = await olaylar(w);
  kontrol('--gizli: süreç başında örtü oynamaz, ses/olay yok (örtü opak zeminde bekler)', once.basladi === null && once.kip === 'bekliyor' && o.length === 0, JSON.stringify({ once, o }));
  await anaIslem(u, 'goster');
  await kipBekle(w, 'tam', 8000);
  const sonra = await kalkanaKadar(w);
  const o2 = await olaylar(w);
  kontrol('--gizli: pencere ilk gerçek gösterilince örtü oynar ve kalkar', sonra >= 0 && JSON.stringify(o2) === JSON.stringify(['acilis-basladi', 'acilis-sesi', 'acilis-bitti']), JSON.stringify(o2));
  await kapat(u);
}

// ── 3) Kare kare + üç tema × iki boyut (--gizli ile deterministik: boyut/medya ayarlanır, sonra gösterilir) ─────────────────────────────
const KARELER = [0, 150, 300, 350, 560, 600, 700, 900, 1250, 1350];
/** Örtünün bütün animasyonlarını durdurup t ms'ye sarar; ölçümleri döner. */
const sar = (w, t) => w.evaluate((ms) => {
  const k = document.querySelector('.acilis');
  const anims = document.getAnimations().filter((a) => a.effect?.target?.closest?.('.acilis'));
  for (const a of anims) { a.pause(); a.currentTime = ms; }
  const op = (e) => Number(getComputedStyle(e).opacity);
  const harfler = [...k.querySelectorAll('.acilis__yazi path')].map(op);
  const noktalar = [...k.querySelectorAll('.acilis__isaret path')].slice(1).map(op); // 0.12 mini logo: ikinci yol (alt gövde: ilmek ve kase)
  const ileri = parseFloat(getComputedStyle(k.querySelector('.acilis__isaret')).getPropertyValue('--acilis-ileri'));
  return { n: anims.length, kok: op(k), sahne: op(k.querySelector('.acilis__sahne')), isaret: op(k.querySelector('.acilis__isaret')), ileri, harfler, noktalar, tema: document.documentElement.dataset.tema };
}, t);
const devam = (w) => w.evaluate(() => { for (const a of document.getAnimations()) if (a.effect?.target?.closest?.('.acilis')) a.play(); });

async function kareler(tema, en, boy, kaydet) {
  const { u, w } = await ac({ ...TEMEL, gorunum: { tema } }, { gizli: true });
  await w.waitForSelector('.kokpit', { state: 'attached', timeout: 30000 });
  await anaIslem(u, [en, boy]);
  await bekle(300);
  await anaIslem(u, 'goster');
  await kipBekle(w, 'tam', 8000);
  const olc = {};
  for (const t of KARELER) {
    olc[t] = await sar(w, t);
    await w.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    if (kaydet) await orn(w, `kare-${tema}-${en}x${boy}-${String(t).padStart(4, '0')}ms.png`);
    else if (t === 900) await orn(w, `kare-${tema}-${en}x${boy}-0900ms.png`);
  }
  await devam(w);
  const sonra = await kalkanaKadar(w);
  await bekle(150);
  if (kaydet) await orn(w, `kare-${tema}-${en}x${boy}-sonra.png`);
  await kapat(u);
  return { olc, sonra };
}

{
  const r = await kareler('koyu', 1440, 900, true);
  const o = r.olc;
  kontrol('kareler (koyu): animasyonlar sarıldı (işaret + harfler + örtü)', Object.values(o).every((x) => x.n >= 8), `n=${o[0].n}`);
  kontrol('kare 0 ms: işaret ve yazı henüz yok', o[0].isaret < 0.05 && o[0].harfler.every((x) => x < 0.05), JSON.stringify(o[0]));
  kontrol('kare 350 ms: işaret açılıyor (tüy maskesi yarıda), yazı başlamış (F var, son harf yok)', o[350].isaret > 0.3 && o[350].ileri > 10 && o[350].ileri < 128 && o[350].harfler[0] > 0 && o[350].harfler[4] < 0.05, JSON.stringify(o[350]));
  // 0.12 cila (inceleme Minor-2): mini logonun alt gövdesi süpürmeyle ERKEN başlar — 300 ms'de işaret görünür, yalnız solma gibi gelmez.
  kontrol('kare 300 ms: işaret belirmiş (alt gövde görünür, tüy maskesi ilerliyor) — geç başlamıyor', o[300].isaret > 0.3 && o[300].noktalar[0] >= 0.3 && o[300].ileri > 10 && o[150].noktalar[0] < o[300].noktalar[0], JSON.stringify({ k150: o[150], k300: o[300] }));
  kontrol('kare 700 ms: işaret tam (maske bitti, mini logonun alt gövdesi dahil); yazı sürüyor', o[700].isaret >= 0.99 && o[700].ileri >= 127 && o[700].noktalar.length === 1 && o[700].noktalar.every((x) => x >= 0.99) && o[700].harfler.some((x) => x < 0.99), JSON.stringify(o[700]));
  kontrol('kare 900 ms: işaret + FUBER tam', o[900].isaret >= 0.99 && o[900].harfler.every((x) => x >= 0.99) && o[900].kok >= 0.99 && o[900].sahne >= 0.99, JSON.stringify(o[900]));
  kontrol('kareler 1250/1350 ms: örtü eriyor; işaret+yazı zeminden ÖNCE söner (hayalet yok), 1200\'e dek tam görünür', o[1250].kok < 1 && o[1250].kok > 0 && o[1350].kok < o[1250].kok && o[1250].kok <= o[900].kok && o[1250].sahne <= 0.01 && o[1250].kok > 0.5 && o[1350].sahne <= 0.01 && o[1350].kok > 0, `kök ${o[900].kok} → ${o[1250].kok} → ${o[1350].kok}; sahne ${o[900].sahne} → ${o[1250].sahne} → ${o[1350].sahne}`);
  kontrol('kareler sonrası örtü DOM\'dan kalkar', r.sonra >= 0, `${r.sonra} ms`);
}
for (const tema of ['koyu', 'acik']) { // 0.12 H3a: buzlu cam teması kalktı
  for (const [en, boy] of [[1440, 900], [1080, 680]]) {
    if (tema === 'koyu' && en === 1440) continue; // yukarıda tam seri
    const r = await kareler(tema, en, boy, tema !== 'koyu' && en === 1440);
    const o900 = r.olc[900];
    kontrol(`tema ${tema} ${en}×${boy}: örtü tam görünür (işaret + FUBER) ve kalkar`, o900.isaret >= 0.99 && o900.harfler.every((x) => x >= 0.99) && r.sonra >= 0, `etkin tema=${o900.tema}`);
  }
}

// ── 4) Azaltılmış hareket: kısa kip ──────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const { u, w } = await ac(TEMEL, { gizli: true });
  await w.waitForSelector('.kokpit', { state: 'attached', timeout: 30000 });
  await w.emulateMedia({ reducedMotion: 'reduce' });
  await bekle(150);
  await anaIslem(u, 'goster');
  await kipBekle(w, 'kisa', 8000);
  // Sınıf değişimi ilk boyamada oturur (bekliyor → kisa, 1-2 kare); yük altında sabit bekleme yanıltır. Sınanan: oturduktan sonra hareket yok.
  await w.waitForFunction(() => { const i = document.querySelector('.acilis__isaret'); return i && getComputedStyle(i).opacity === '1'; }, null, { timeout: 1000, polling: 16 }).catch(() => undefined);
  const durag = await w.evaluate(() => {
    const k = document.querySelector('.acilis');
    const op = (e) => Number(getComputedStyle(e).opacity);
    return { kok: op(k), isaret: op(k.querySelector('.acilis__isaret')), harfler: [...k.querySelectorAll('.acilis__yazi path')].map(op), donus: getComputedStyle(k.querySelector('.acilis__isaret')).transform, maske: getComputedStyle(k.querySelector('.acilis__isaret')).maskImage };
  });
  await orn(w, 'azaltilmis-120ms.png');
  kontrol('azaltılmış hareket: işaret ve yazı baştan durağan görünür (ölçek/maske hareketi yok)', durag.isaret === 1 && durag.harfler.every((x) => x === 1) && (durag.donus === 'none' || durag.donus === 'matrix(1, 0, 0, 1, 0, 0)') && durag.maske === 'none', JSON.stringify(durag));
  const gec = await kalkanaKadar(w, 3000);
  const m = await isaret(w);
  const sure = m.bitti - m.basladi;
  kontrol('azaltılmış hareket: kısa (≥ 0,6 ve ≤ 0,85 sn) ve ses kararı yine verilir', gec >= 0 && sure >= 600 && sure <= 850 && (await olaylar(w)).includes('acilis-sesi'), `${Math.round(sure)} ms, olaylar ${JSON.stringify(await olaylar(w))}`);
  await kapat(u);
}

// ── 5) Atlatma: tıklama TÜKETİLİR (alttaki görünmeyen denetim etkinleşmez), tuş geçer ─────────────────────────────────────────────────────
// Sonda: `document` üzerinde yakalama aşamasında dinleyen sonda (pencere yakalamasından SONRA çalışır): pencerede tüketilen olay buraya ulaşmaz.
const SONDA = () => {
  // FUBER_DEMO'da (testler) örtü varsayılan olarak tıklamayı yutmaz (öteki önizlemelerin ilk tıklaması kaybolmasın); üretim davranışını aç.
  document.documentElement.dataset.acilisTiklama = 'yut';
  window.__ulasan = [];
  for (const tur of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'keydown']) {
    document.addEventListener(tur, (e) => window.__ulasan.push(`${tur}:${e.target?.closest?.('[data-tur],[data-ileri]')?.getAttribute('data-tur') ?? e.target?.tagName}`), true);
  }
};
{
  const { u, w } = await ac(TEMEL, { gizli: true });
  await w.waitForSelector('.kokpit', { state: 'attached', timeout: 30000 });
  await w.evaluate(SONDA);
  await anaIslem(u, 'goster');
  await kipBekle(w, 'tam', 8000);
  await bekle(300);
  // Örtü oynarken sol raydaki "Sohbetler" düğmesine tıkla: örtüyü atlatır; tıklama alttaki düğmeye GEÇMEZ (hiçbir fare olayı alta ulaşmaz).
  const t0 = Date.now();
  await w.click('.ray__dgm[data-tur="sohbetler"]', { timeout: 3000 });
  const tikSure = Date.now() - t0;
  const kalktiMs = await kalkanaKadar(w, 1500);
  await bekle(150);
  const durum = await w.evaluate(() => ({ sayfa: document.querySelector('.ray__dgm[aria-current="page"]')?.dataset.tur, ulasan: window.__ulasan }));
  const o = await olaylar(w);
  kontrol('tıklama: atlatır (≤ 0,4 sn) ve TÜKETİLİR — alttaki "Sohbetler" etkinleşmez, hiçbir fare olayı alta ulaşmaz', tikSure < 1000 && durum.sayfa === 'kokpit' && durum.ulasan.length === 0 && kalktiMs >= 0 && kalktiMs <= 400 && o.includes('acilis-atlandi'), JSON.stringify({ tikSure, kalktiMs, durum, o }));
  // Örtü kalktıktan sonra ilk gerçek tıklama normal çalışır (yutan dinleyiciler kalıcı değil).
  await w.click('.ray__dgm[data-tur="sohbetler"]', { timeout: 3000 });
  await bekle(250);
  const sonra = await w.evaluate(() => ({ sayfa: document.querySelector('.ray__dgm[aria-current="page"]')?.dataset.tur, ulasan: window.__ulasan.filter((x) => x.startsWith('click')) }));
  kontrol('tıklama: örtü kalkınca yutma biter — sonraki tıklama normal etkinleşir', sonra.sayfa === 'sohbetler' && sonra.ulasan.length === 1, JSON.stringify(sonra));
  await kapat(u);
}
{
  const { u, w } = await ac(TEMEL, { gizli: true });
  await w.waitForSelector('.kokpit', { state: 'attached', timeout: 30000 });
  await w.evaluate(SONDA);
  await anaIslem(u, 'goster');
  await kipBekle(w, 'tam', 8000);
  await bekle(300);
  await w.keyboard.press('Shift');
  const kalktiMs = await kalkanaKadar(w, 1500);
  const o = await olaylar(w);
  const ulasan = await w.evaluate(() => window.__ulasan);
  kontrol('tuş: herhangi bir tuş örtüyü atlatır (≤ 0,4 sn), tuş uygulamaya GEÇER (önden yazma); acilis-atlandi', kalktiMs >= 0 && kalktiMs <= 400 && o.includes('acilis-atlandi') && o.includes('acilis-sesi') && ulasan.some((x) => x.startsWith('keydown')), JSON.stringify({ kalktiMs, o, ulasan }));
  await kapat(u);
}
// FUBER_DEMO varsayılanı (test otomasyonu için): tıklama örtüyü atlatır AMA yutulmaz — öteki önizlemelerin açılıştaki ilk tıklaması kaybolmaz.
{
  const { u, w } = await ac(TEMEL, { gizli: true });
  await w.waitForSelector('.kokpit', { state: 'attached', timeout: 30000 });
  await anaIslem(u, 'goster');
  await kipBekle(w, 'tam', 8000);
  await bekle(300);
  await w.click('.ray__dgm[data-tur="sohbetler"]', { timeout: 3000 });
  const kalktiMs = await kalkanaKadar(w, 1500);
  await bekle(150);
  const sayfa = await w.evaluate(() => document.querySelector('.ray__dgm[aria-current="page"]')?.dataset.tur);
  kontrol('FUBER_DEMO varsayılanı: tıklama örtüyü atlatır ve alttaki düğmeye de geçer (otomasyon ilk tıklamasını kaybetmez)', sayfa === 'sohbetler' && kalktiMs >= 0 && kalktiMs <= 400, JSON.stringify({ sayfa, kalktiMs }));
  await kapat(u);
}
// Kurulum (ilk açılış; 0.12 H3a: kurulum2): atlatan tıklama kurulumun birincil düğmesine geçmez (görünmeyen düğme tetiklenmez).
{
  const { u, w } = await ac({}, { gizli: true });
  await w.waitForSelector('.k2__alt [data-ileri]', { state: 'attached', timeout: 30000 });
  await w.evaluate(SONDA);
  const adimOnce = await w.evaluate(() => document.querySelector('.k2').dataset.adimId);
  await anaIslem(u, 'goster');
  await kipBekle(w, 'tam', 8000);
  await bekle(300);
  await w.click('.k2__alt [data-ileri]', { timeout: 3000 });
  const kalktiMs = await kalkanaKadar(w, 1500);
  await bekle(300);
  const adimSonra = await w.evaluate(() => ({ id: document.querySelector('.k2').dataset.adimId, ulasan: window.__ulasan }));
  kontrol('kurulum sihirbazı: atlatan tıklama "Devam"a geçmez (sayfa değişmez), örtü kalkar', adimSonra.id === adimOnce && adimSonra.ulasan.length === 0 && kalktiMs >= 0 && kalktiMs <= 400, JSON.stringify({ adimOnce, adimSonra, kalktiMs }));
  await w.click('.k2__alt [data-ileri]', { timeout: 3000 });
  await bekle(500);
  const ilerledi = await w.evaluate(() => document.querySelector('.k2').dataset.adimId);
  kontrol('kurulum sihirbazı: örtü kalkınca "Devam" normal çalışır (sayfa ilerler)', ilerledi !== adimOnce, `${adimOnce} → ${ilerledi}`);
  await kapat(u);
}

// Pencere düğmeleri (Küçült/Büyüt/Kapat; örtünün ÜSTÜNDE, görünür): örtü sırasında ilk tıklamada çalışır — tıklama örtüyü atlatır ama
// düğmenin onClick'ine ulaşır. Pencere gerçekten küçültülmez: ana sürecin 'pencere:eylem' işleyicisi eylemi yalnız sayan bir kancayla değişir.
{
  const { u, w } = await ac(TEMEL, { gizli: true });
  await w.waitForSelector('.kokpit', { state: 'attached', timeout: 30000 });
  await w.evaluate(SONDA);
  await u.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('pencere:eylem');
    globalThis.__pdEylemler = [];
    ipcMain.handle('pencere:eylem', (_e, eylem) => { globalThis.__pdEylemler.push(eylem); });
  });
  await anaIslem(u, 'goster');
  await kipBekle(w, 'tam', 8000);
  await bekle(300);
  await w.click('.pd-dgm[data-eylem="kucult"]', { timeout: 3000 });
  const kalktiMs = await kalkanaKadar(w, 1500);
  await bekle(150);
  const eylemler = await u.evaluate(() => globalThis.__pdEylemler);
  const ulasan = await w.evaluate(() => window.__ulasan);
  const o = await olaylar(w);
  kontrol('pencere düğmesi: örtü oynarken "Küçült" ilk tıklamada düğmenin onClick\'ine ulaşır (pencere eylemi 1 kez), örtü yine atlatılır', JSON.stringify(eylemler) === '["kucult"]' && ulasan.some((x) => x.startsWith('click')) && kalktiMs >= 0 && kalktiMs <= 400 && o.includes('acilis-atlandi'), JSON.stringify({ eylemler, ulasan, kalktiMs, o }));
  await w.click('.ray__dgm[data-tur="sohbetler"]', { timeout: 3000 });
  await bekle(250);
  kontrol('pencere düğmesi: sonrasında yutma seti kalmaz — sonraki tıklama normal etkinleşir', (await w.evaluate(() => document.querySelector('.ray__dgm[aria-current="page"]')?.dataset.tur)) === 'sohbetler');
  await kapat(u);
}
// Bayat yutma: tüketilen hareketin pointerup/click'i HİÇ gelmezse (burada yalnız pointerdown: sentetik) kurulu yutma seti sonraki GERÇEK
// tıklamayı yememeli — örtü bittikten sonra gelen ilk yeni pointerdown seti iptal eder.
{
  const { u, w } = await ac(TEMEL, { gizli: true });
  await w.waitForSelector('.kokpit', { state: 'attached', timeout: 30000 });
  await w.evaluate(SONDA);
  await anaIslem(u, 'goster');
  await kipBekle(w, 'tam', 8000);
  await bekle(300);
  await w.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 7, button: 0 })));
  const kalktiMs = await kalkanaKadar(w, 1500);
  await bekle(250);
  const ara = await w.evaluate(() => ({ ulasan: window.__ulasan, sayfa: document.querySelector('.ray__dgm[aria-current="page"]')?.dataset.tur }));
  await w.click('.ray__dgm[data-tur="sohbetler"]', { timeout: 3000 });
  await bekle(300);
  const sonra = await w.evaluate(() => ({ sayfa: document.querySelector('.ray__dgm[aria-current="page"]')?.dataset.tur, tiklar: window.__ulasan.filter((x) => x.startsWith('click')) }));
  kontrol('bayat yutma: click\'i hiç gelmeyen tüketilmiş hareketten sonra ilk gerçek tıklama yenmez (set yeni pointerdown\'da iptal olur)', kalktiMs >= 0 && kalktiMs <= 400 && ara.ulasan.length === 0 && ara.sayfa === 'kokpit' && sonra.sayfa === 'sohbetler' && sonra.tiklar.length === 1, JSON.stringify({ kalktiMs, ara, sonra }));
  await kapat(u);
}

// ── 6) Ses kararı: ayar kapalı, sessiz saat, rahatsız etme → kaydedilmez; açıkken kaydedilir ─────────────────────────────────────────────
const simdi = new Date();
const dk = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const SENARYOLAR = [
  ['açılış sesi kapalı', { ...TEMEL, ses: { acilisSesi: false } }, false],
  ['sessiz saat içinde', { ...TEMEL, proaktif: { etkin: false, sessizBaslangic: dk(new Date(simdi.getTime() - 3600_000)), sessizBitis: dk(new Date(simdi.getTime() + 3600_000)) } }, false],
  // Son inceleme (G12b artığı): nötr (boş) sessiz saat aralığı — sonuç gece de gündüz de YALNIZ "Rahatsız etme"den gelir (varsayılan 23:00–08:00 değil).
  ['rahatsız etme sürüyor', { ...TEMEL, proaktif: { etkin: false, sessizBaslangic: '00:00', sessizBitis: '00:00', rahatsizEtmeBitis: new Date(Date.now() + 3600_000).toISOString() } }, false],
  ['varsayılan (açık, sessiz saat dışında)', { ...TEMEL, proaktif: { etkin: false, sessizBaslangic: dk(new Date(simdi.getTime() + 2 * 3600_000)), sessizBitis: dk(new Date(simdi.getTime() + 3 * 3600_000)) } }, true],
];
for (const [ad, ayar, beklenen] of SENARYOLAR) {
  const { u, w } = await ac(ayar);
  await kipBekle(w, 'tam', 30000);
  await kalkanaKadar(w);
  const o = await olaylar(w);
  kontrol(`ses kararı — ${ad}: acilis-sesi ${beklenen ? 'yazılır' : 'yazılmaz'} (örtü yine oynar)`, o.includes('acilis-sesi') === beklenen && o.includes('acilis-basladi') && o.includes('acilis-bitti'), JSON.stringify(o));
  await kapat(u);
}

// ── 6b) Çanın kendisi (ses çıkışı yok): gerçek acilis-sesi.ts, tarayıcının OfflineAudioContext'inde tamponlanır ve ölçülür ─────────────────
{
  const kaynak = fs.readFileSync(path.join(kok, 'src/renderer/acilis/acilis-sesi.ts'), 'utf8');
  const kod = stripTypeScriptTypes(kaynak).replace(/^export /gm, '');
  const { u, w } = await ac();
  const o = await w.evaluate(async (js) => {
    const { acilisSesiCal, ACILIS_NOTALARI } = new Function(`${js}\n;return { acilisSesiCal, ACILIS_NOTALARI };`)();
    const hz = 48000;
    const ctx = new OfflineAudioContext(1, hz * 1.4, hz);
    // Çevrimdışı bağlam başlamadan "suspended" görünür; gerçek bağlam gibi davransın (çalan kod resume() beklemeden zamanlasın).
    Object.defineProperty(ctx, 'state', { value: 'running' });
    const bitti = acilisSesiCal(ctx);
    const tampon = await ctx.startRendering();
    await bitti;
    const d = tampon.getChannelData(0);
    let tepe = 0, ilk = -1, son = -1, kare = 0;
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > tepe) tepe = a; if (a > 0.0005) { if (ilk < 0) ilk = i; son = i; } kare += d[i] * d[i]; }
    let basTik = 0; for (let i = 0; i < 48; i++) basTik = Math.max(basTik, Math.abs(d[i]));
    return { tepe, ilkSn: ilk / hz, sonSn: son / hz, rms: Math.sqrt(kare / d.length), basTik, nota: ACILIS_NOTALARI.length, sonOrnek: Math.abs(d[d.length - 1]) };
  }, kod);
  kontrol('çan (OfflineAudioContext): tepe ≤ 0,15 ve duyulur, ses ≤ 0,9 sn, tık yok (başta ve sonda sıfır), 3 nota', o.tepe <= 0.15 && o.tepe > 0.02 && o.sonSn - o.ilkSn <= 0.9 && o.basTik < 0.001 && o.sonOrnek < 0.001 && o.rms > 0.005, JSON.stringify(o));
  await kapat(u);
}

// ── 7) Kurulum (ilk açılış; 0.12 H3a: kurulum2 `.k2`): örtü üstte oynar, kurulumu bekletmez ─────────────────────────────────────────────────────────────
{
  const { u, w } = await ac({});
  await kipBekle(w, 'tam', 30000);
  await bekle(250);
  const k = await w.evaluate(() => ({ sihirbaz: Boolean(document.querySelector('.k2')), dugme: document.querySelector('.k2 button') !== null }));
  await orn(w, 'kurulum-250ms.png');
  kontrol('kurulum sihirbazı: örtü bitmeden sihirbaz DOM\'da ve düğmeleri var (örtü beklemez)', k.sihirbaz && k.dugme, JSON.stringify(k));
  const gec = await kalkanaKadar(w);
  await bekle(200);
  await orn(w, 'kurulum-sonra.png');
  kontrol('kurulum sihirbazı: örtü kalkar ve sihirbaz kalır', gec >= 0 && (await w.evaluate(() => Boolean(document.querySelector('.k2')))), `${gec} ms`);
  await kapat(u);
}

// ── 8) Ayarlar → Ses ve ada → "Açılış sesi" (İş ve Geliştirici modunda görünür; anahtar kaydı ayara yazar) ──────────────────────────────
for (const mod of ['is', 'gelistirici']) {
  const { u, w } = await ac({ ...TEMEL, mod });
  await w.waitForSelector('.ray__dgm[data-tur="ayarlar"]', { timeout: 30000 });
  await w.locator('.ray__dgm[data-tur="ayarlar"]').click();
  await w.waitForSelector('.ayarlar__sayfa', { timeout: 10000 });
  await w.locator('.kategori[data-kategori="ses"]').click();
  await w.waitForSelector('.ayarlar__sayfa[data-kategori="ses"]', { timeout: 5000 });
  await bekle(350);
  for (let i = 0; i < 6; i++) { const kapali = w.locator('.ayarlar__sayfa .akordeon__bas[aria-expanded="false"]'); if (!(await kapali.count())) break; await kapali.first().click(); await bekle(120); }
  const satir = w.locator('[data-ayar="acilis-sesi"]');
  await satir.scrollIntoViewIfNeeded();
  const once = await satir.locator('[role="switch"]').getAttribute('aria-checked');
  // Anahtarın görünen kutusu 22 px; isabet alanı ::before ile 32 px'e genişler (tasarim.css): yalnız GERÇEK isabet alanı ölçülür (≥ 32 px).
  const kutu = await satir.locator('[role="switch"]').evaluate((el) => {
    const r = el.getBoundingClientRect();
    const o = getComputedStyle(el, '::before');
    const [ust, alt, sol, sag] = ['top', 'bottom', 'left', 'right'].map((k) => parseFloat(o[k]) || 0);
    return { gorunenYukseklik: r.height, isabetYukseklik: r.height - ust - alt, isabetGenislik: r.width - sol - sag };
  });
  if (mod === 'is') await orn(w, 'ayar-acilis-sesi.png');
  await satir.locator('[role="switch"]').click();
  await bekle(400);
  const sonra = await satir.locator('[role="switch"]').getAttribute('aria-checked');
  const kayit = await w.evaluate(() => window.fuber.cagir('ayarlar:al').then((a) => a.ses.acilisSesi));
  const ad = (await satir.textContent()) ?? '';
  kontrol(`ayar satırı (${mod} modu): "Açılış sesi" görünür, varsayılan açık, anahtar isabet alanı ≥ 32 px, kaydı ayara yazar`, once === 'true' && sonra === 'false' && kayit === false && /Açılış sesi/.test(ad) && kutu.isabetYukseklik >= 32, JSON.stringify({ once, sonra, kayit, ad: ad.slice(0, 90), kutu }));
  await kapat(u);
}

kontrol('konsol/sayfa hatası yok', hatalar.length === 0, hatalar.slice(0, 5).join(' | '));
const basarisiz = sonuclar.filter((s) => !s.tamam);
console.log(`\n${sonuclar.length} denetim · ${basarisiz.length} hata · kareler: ${cikti}`);
process.exit(basarisiz.length ? 1 : 0);
