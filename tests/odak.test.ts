// 0.14 T26 — Odak (odak zamanlayıcısı): saf adım işlevleri (shared/odak.ts), ana süreçteki tek zamanlayıcı ve kalıcılık (main/odak.ts), uyarı hapı + zil,
// uyku/uyanma, WAV zili (scripts/dev/zil-uret.mjs) ve sayfanın kaynak kuralları (Odak.tsx). Ağ bekçisi açık (tests/yardimci/ana-surec.ts): 127.0.0.1 dışına
// giden her istek testi düşürür — Odak hiçbir şey indirmez, bulut yoktur (P14'e dokunmaz). Zaman sahtedir (elle ilerletilen saat + sahte zamanlayıcı).
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { anaSurecSahnesi, ipcKurBos, ipcIsleyicileri } from './yardimci/ana-surec.ts';
import {
  ODAK_ILK, ODAK_SURELERI, kalanSn, odakAdimi, odakAdimGirdisi, odakDurumuDogrula, odakUyarisi, onerilenMola, sureMetni, type OdakDurumu,
} from '../src/shared/odak.ts';
import { CAGRI_KANALLARI, OLAY_KANALLARI } from '../src/shared/kanallar.ts';
import { uyariSuresi, uyariYolu, odakBittiYolu, type SistemUyarisi } from '../src/shared/sistem-uyarilari.ts';

const { agIstekleri } = anaSurecSahnesi('odak', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', mod: 'is', tanitimSurumu: '0.9.0', ses: { surum: 2, uyandirma: false }, proaktif: { etkin: false }, baslangictaAc: false,
});
process.env.FUBER_DEMO = '1';
await ipcKurBos();
const { odakYoneticisiKur, odakBittiBagi, ODAK_KAYIT_ANAHTARI } = await import('../src/main/odak.ts');
const { meta, metaYaz, metaSil } = await import('../src/main/vt.ts');
const ipc = <T>(kanal: string, ...a: unknown[]) => Promise.resolve(ipcIsleyicileri().get(kanal)!({}, ...a)) as Promise<T>;

const kaynakOku = (yol: string): string => fs.readFileSync(new URL(`../${yol}`, import.meta.url), 'utf8');
/** Satır ve blok yorumlarını atar (kaynak taramaları yorumdaki sözcüklere takılmasın). */
const yorumsuz = (k: string): string => k.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const T0 = new Date(2027, 2, 9, 10, 0, 0).getTime();
const DK = 60_000;

// ── Saf adım işlevleri ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('odak 25 dk; bitince tamamlanan artar, dördüncüden sonra öneri uzun', () => {
  assert.deepEqual(ODAK_SURELERI, { odak: 1500, kisa: 300, uzun: 900 });
  assert.deepEqual(ODAK_ILK, { tur: 'odak', bitis: null, duraklatildi: null, tamamlanan: 0 });
  assert.equal(kalanSn(ODAK_ILK, T0), 1500, 'boştaki odak 25 dk gösterir');
  let d = odakAdimi(ODAK_ILK, { tur: 'baslat' }, T0);
  assert.equal(d.bitis, T0 + 25 * DK, 'mutlak bitiş zamanı');
  assert.equal(kalanSn(d, T0), 1500);
  assert.equal(kalanSn(d, T0 + 60_000), 1440);
  assert.equal(kalanSn(d, T0 + 25 * DK + 5000), 0, 'bitişten sonra eksiye düşmez');
  assert.equal(kalanSn(d, T0 + 1), 1500, 'saniye yukarı yuvarlanır (00:00 yalnız bitişte)');
  const oneriler: string[] = [];
  for (let i = 1; i <= 4; i++) {
    d = odakAdimi(d, { tur: 'bitti' }, d.bitis!);
    assert.equal(d.tamamlanan, i, `${i}. odak bitti`);
    assert.equal(d.bitis, null);
    oneriler.push(d.tur);
    assert.equal(onerilenMola(d), i === 4 ? 'uzun' : 'kisa');
    if (i < 4) { // mola alınır, biter, odak döner
      d = odakAdimi(d, { tur: 'baslat', secim: d.tur }, T0);
      d = odakAdimi(d, { tur: 'bitti' }, d.bitis!);
      assert.equal(d.tamamlanan, i, 'mola bitince tamamlanan artmaz');
      assert.equal(d.tur, 'odak', 'mola bitince sıra odakta');
      d = odakAdimi(d, { tur: 'baslat' }, T0);
    }
  }
  assert.deepEqual(oneriler, ['kisa', 'kisa', 'kisa', 'uzun'], 'dördüncü odaktan sonra uzun mola önerilir');
  d = odakAdimi(d, { tur: 'baslat', secim: 'uzun' }, T0);
  assert.equal(d.bitis, T0 + 15 * DK);
  d = odakAdimi(d, { tur: 'bitti' }, d.bitis!);
  d = odakAdimi(d, { tur: 'baslat' }, T0);
  d = odakAdimi(d, { tur: 'bitti' }, d.bitis!);
  assert.equal(d.tamamlanan, 5);
  assert.equal(onerilenMola(d), 'kisa', 'beşinci odaktan sonra yine kısa');
});

test('duraklat/sürdür kalan süreyi korur', () => {
  let d = odakAdimi(ODAK_ILK, { tur: 'baslat' }, T0);
  d = odakAdimi(d, { tur: 'duraklat' }, T0 + 10 * DK);
  assert.equal(d.bitis, null);
  assert.equal(d.duraklatildi, 15 * DK, 'duraklayınca kalan süre (ms) saklanır');
  assert.equal(kalanSn(d, T0 + 10 * DK), 900);
  assert.equal(kalanSn(d, T0 + 300 * DK), 900, 'duraklamada süre akmaz');
  d = odakAdimi(d, { tur: 'surdur' }, T0 + 60 * DK);
  assert.equal(d.duraklatildi, null);
  assert.equal(d.bitis, T0 + 75 * DK, 'sürdürünce kalan süre şimdiye eklenir');
  assert.equal(kalanSn(d, T0 + 60 * DK), 900);
  // "Başlat" duraklamışken süreyi kaybettirmez (sürdürür); yeni sayım için tür seçilir.
  let e = odakAdimi(odakAdimi(odakAdimi(ODAK_ILK, { tur: 'baslat' }, T0), { tur: 'duraklat' }, T0 + 5 * DK), { tur: 'baslat' }, T0 + 6 * DK);
  assert.equal(e.bitis, T0 + 6 * DK + 20 * DK);
  // Akan sayımda yinelenen Başlat sayımı sıfırlamaz.
  const kosuyor = odakAdimi(ODAK_ILK, { tur: 'baslat' }, T0);
  assert.equal(odakAdimi(kosuyor, { tur: 'baslat' }, T0 + DK).bitis, kosuyor.bitis);
  // Süren sayımdayken mola seçmek yeni sayım başlatır.
  e = odakAdimi(kosuyor, { tur: 'baslat', secim: 'kisa' }, T0 + DK);
  assert.deepEqual([e.tur, e.bitis], ['kisa', T0 + DK + 5 * DK]);
  // Sıfırla: sayım biter, tür ve tamamlanan kalır.
  const sifir = odakAdimi({ ...kosuyor, tamamlanan: 2 }, { tur: 'sifirla' }, T0 + DK);
  assert.deepEqual(sifir, { tur: 'odak', bitis: null, duraklatildi: null, tamamlanan: 2 });
  // Boştayken duraklat/sürdür/bitti etkisiz; girdi nesnesi değişmez.
  const bos = Object.freeze({ ...ODAK_ILK });
  for (const tur of ['duraklat', 'surdur', 'bitti'] as const) assert.deepEqual(odakAdimi(bos, { tur }, T0), ODAK_ILK, `${tur} boştayken etkisiz`);
});

test('süre/doğrulama yardımcıları: mm:ss yazımı, kalıcı kaydın temizlenmesi, IPC girdisi', () => {
  assert.equal(sureMetni(1500), '25:00');
  assert.equal(sureMetni(59), '00:59');
  assert.equal(sureMetni(0), '00:00');
  assert.equal(sureMetni(-5), '00:00');
  assert.equal(sureMetni(Number.NaN), '00:00');
  assert.deepEqual(odakDurumuDogrula(null), ODAK_ILK);
  assert.deepEqual(odakDurumuDogrula({ tur: 'zehir', bitis: 'x', duraklatildi: -3, tamamlanan: -2 }), ODAK_ILK);
  assert.deepEqual(odakDurumuDogrula({ tur: 'kisa', bitis: T0, duraklatildi: 5, tamamlanan: 3.7 }), { tur: 'kisa', bitis: T0, duraklatildi: null, tamamlanan: 3 }, 'sayım sürerken duraklatildi tutarsızdır: düşer');
  assert.deepEqual(odakAdimGirdisi({ tur: 'baslat', secim: 'uzun' }), { tur: 'baslat', secim: 'uzun' });
  assert.deepEqual(odakAdimGirdisi({ tur: 'duraklat', secim: 'uzun' }), { tur: 'duraklat' }, 'seçim yalnız Başlat\'ta anlamlı');
  assert.equal(odakAdimGirdisi({ tur: 'bitti' }), null, 'arayüz sayımı "bitti" diyerek bitiremez');
  assert.equal(odakAdimGirdisi({ tur: 'baslat', secim: 'x' }), null);
  assert.equal(odakAdimGirdisi('baslat'), null);
});

// ── Ana süreçteki zamanlayıcı ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Sahte bağımlılıklar: elle ilerletilen saat, sahte tek atımlık zamanlayıcılar (kaç tane kuruldu/kaçı bekliyor sayılır), bellekte kayıt. */
function sahne(ilk?: { kayit?: string; simdi?: number; gun?: string }) {
  const s = {
    simdi: ilk?.simdi ?? T0, gun: ilk?.gun ?? '2027-03-09', kayit: ilk?.kayit as string | undefined,
    kurulan: 0, iptal: 0, bekleyen: new Map<number, { f: () => void; ms: number }>(), no: 0, yazim: 0,
    duyurular: [] as OdakDurumu[], hapler: [] as ReturnType<typeof odakUyarisi>[],
  };
  const y = odakYoneticisiKur({
    simdi: () => s.simdi, gun: () => s.gun, oku: () => s.kayit, yaz: (k) => { s.kayit = k; s.yazim++; },
    zamanla: (f, ms) => { const n = ++s.no; s.kurulan++; s.bekleyen.set(n, { f, ms }); return n; },
    iptal: (z) => { if (s.bekleyen.delete(z as number)) s.iptal++; },
    duyur: (d) => s.duyurular.push(d), bitti: (u) => s.hapler.push(u),
  });
  /** Saati ilerletir; süresi gelen (tek) zamanlayıcıyı çalıştırır. */
  const ilerle = (ms: number) => { s.simdi += ms; for (const [n, z] of [...s.bekleyen]) { if (z.ms <= ms) { s.bekleyen.delete(n); z.f(); } else z.ms -= ms; } };
  return { s, y, ilerle };
}

test('ana süreçte tek setTimeout; Odak.tsx\'te setInterval yok', () => {
  const k = yorumsuz(kaynakOku('src/main/odak.ts'));
  assert.equal((k.match(/setTimeout\(/g) ?? []).length, 1, 'ana süreçte tek setTimeout çağrısı (varsayılan bağlayıcıda)');
  assert.doesNotMatch(k, /setInterval/, 'ana süreçte setInterval yok');
  const o = yorumsuz(kaynakOku('src/renderer/ada/sayfalar/Odak.tsx')) + yorumsuz(kaynakOku('src/renderer/ada/sayfalar/Yapilacaklar.tsx'));
  assert.doesNotMatch(o, /setInterval/, 'sayfalarda setInterval yok');
  assert.doesNotMatch(o, /requestAnimationFrame/, 'sayfalarda çizim döngüsü yok');
  assert.match(kaynakOku('src/renderer/ada/sayfalar/Odak.tsx'), /setTimeout/, 'saniye göstergesi setTimeout zinciri');
  // Dinamik: bir anda en çok bir zamanlayıcı bekler; duraklatınca hiç.
  const { s, y, ilerle } = sahne();
  assert.equal(s.bekleyen.size, 0, 'boşta zamanlayıcı yok');
  y.adim({ tur: 'baslat' });
  assert.equal(s.bekleyen.size, 1);
  assert.equal([...s.bekleyen.values()][0].ms, 25 * DK, 'tek zamanlayıcı bitişe kurulur');
  ilerle(DK); y.adim({ tur: 'baslat', secim: 'kisa' });
  assert.equal(s.bekleyen.size, 1, 'yeniden kurmak eskisini iptal eder');
  y.adim({ tur: 'duraklat' });
  assert.equal(s.bekleyen.size, 0, 'duraklamada zamanlayıcı yok');
  y.adim({ tur: 'surdur' });
  assert.equal(s.bekleyen.size, 1);
  y.adim({ tur: 'sifirla' });
  assert.equal(s.bekleyen.size, 0);
});

test('bitişte zil ve "Odak bitti · Kısa mola" uyarı hapı (UyariTuru \'odak-bitti\', T22)', () => {
  const { s, y, ilerle } = sahne();
  y.adim({ tur: 'baslat' });
  ilerle(25 * DK - 1);
  assert.equal(s.hapler.length, 0, 'bitişten önce hap yok');
  ilerle(1);
  assert.equal(s.hapler.length, 1, 'bitişte tam bir hap (zil de aynı bağlayıcıdan çalar)');
  assert.deepEqual(s.hapler[0], { tur: 'odak-bitti', metin: 'Odak bitti · Kısa mola', simge: 'hedef' });
  assert.equal(uyariSuresi(s.hapler[0]), 2200, 'hap T22\'nin süresiyle kalkar');
  assert.deepEqual(y.durum(), { tur: 'kisa', bitis: null, duraklatildi: null, tamamlanan: 1 });
  assert.equal(s.bekleyen.size, 0);
  assert.equal(s.duyurular.at(-1)?.tamamlanan, 1, 'arayüze yeni durum duyurulur');
  // Mola biter: "Mola bitti · Odak".
  y.adim({ tur: 'baslat' });
  ilerle(5 * DK);
  assert.deepEqual(s.hapler[1], { tur: 'odak-bitti', metin: 'Mola bitti · Odak', simge: 'hedef' });
  assert.equal(y.durum().tur, 'odak');
  // Dördüncü odaktan sonra metin "Uzun mola".
  for (let i = 0; i < 2; i++) { y.adim({ tur: 'baslat' }); ilerle(25 * DK); y.adim({ tur: 'baslat' }); ilerle(5 * DK); }
  y.adim({ tur: 'baslat' }); ilerle(25 * DK);
  assert.equal(s.hapler.at(-1)?.metin, 'Odak bitti · Uzun mola');
  assert.equal(y.durum().tamamlanan, 4);
});

test('uyku ve uyanma: bitiş mutlak zamanla karşılaştırılır; erken tetik yeniden kurulur', () => {
  const { s, y } = sahne();
  y.adim({ tur: 'baslat' });
  // Bilgisayar 40 dk uyudu: zamanlayıcı çalışmadı, saat ilerledi. Uyanınca bitiş zamanı karşılaştırılır.
  s.simdi += 40 * DK;
  assert.equal(s.hapler.length, 0);
  y.uyandi();
  assert.equal(s.hapler.length, 1, 'uyanınca biten odak bir kez bildirilir');
  assert.equal(y.durum().tamamlanan, 1);
  y.uyandi();
  assert.equal(s.hapler.length, 1, 'ikinci uyanma yinelemez');
  // Uyanış bitişten önceyse zamanlayıcı kalan süreye yeniden kurulur (tek zamanlayıcı).
  y.adim({ tur: 'baslat', secim: 'odak' });
  s.simdi += 10 * DK;
  y.uyandi();
  assert.equal(s.bekleyen.size, 1);
  assert.equal([...s.bekleyen.values()][0].ms, 15 * DK, 'kalan süre saate göre yeniden hesaplanır');
  assert.equal(y.durum().bitis !== null, true);
  // Erken tetik (zamanlayıcı bitişten önce uyandı): sayım bitmez, kalan süre için yeniden kurulur.
  const { s: s2, y: y2 } = sahne();
  y2.adim({ tur: 'baslat' });
  const [[, z]] = [...s2.bekleyen];
  s2.bekleyen.clear();
  s2.simdi += 24 * DK;
  z.f();
  assert.equal(s2.hapler.length, 0, 'erken tetik bitirmez');
  assert.equal(s2.bekleyen.size, 1);
  assert.equal([...s2.bekleyen.values()][0].ms, DK);
  // 24,8 günü aşan bitiş (bozuk saat/kayıt) setTimeout sınırını aşmaz: tavanlanıp tekrar kurulur.
  const uzak = sahne({ kayit: JSON.stringify({ d: { tur: 'odak', bitis: T0 + 90 * 24 * 60 * DK, duraklatildi: null, tamamlanan: 0 }, gun: '2027-03-09' }) });
  assert.equal(uzak.s.bekleyen.size, 1);
  assert.ok([...uzak.s.bekleyen.values()][0].ms <= 2 ** 31 - 1, 'zamanlayıcı süresi 32 bit sınırının altında');
});

test('durum yerel veritabanında kalıcı: yeni süreç sayımı sürdürür; kapalıyken biten sayım sessizce sayılır', () => {
  const a = sahne();
  a.y.adim({ tur: 'baslat' });
  assert.ok(a.s.kayit, 'her adımda kayıt yazılır');
  const kayit = a.s.kayit;
  // Yeni süreç (yeniden başlatma): aynı kayıttan, 5 dk sonra.
  const b = sahne({ kayit, simdi: T0 + 5 * DK });
  assert.equal(kalanSn(b.y.durum(), b.s.simdi), 20 * 60, 'sayım kaldığı yerden sürer');
  assert.equal(b.s.bekleyen.size, 1, 'zamanlayıcı yeniden kurulur');
  // Uygulama kapalıyken bitti: açılışta sayılır, hap/zil yok (kullanıcı orada değildi).
  const c = sahne({ kayit, simdi: T0 + 90 * DK });
  assert.equal(c.y.durum().tamamlanan, 1);
  assert.equal(c.y.durum().bitis, null);
  assert.equal(c.s.hapler.length, 0, 'açılışta hap/zil yok');
  assert.equal(c.s.bekleyen.size, 0);
  // Bozuk kayıt: temiz başlangıç.
  assert.deepEqual(sahne({ kayit: '{bozuk' }).y.durum(), ODAK_ILK);
  // Yeni gün: tamamlanan sıfırlanır, sayım sürer.
  const d = sahne({ kayit: JSON.stringify({ d: { tur: 'kisa', bitis: null, duraklatildi: null, tamamlanan: 3 }, gun: '2027-03-08' }), gun: '2027-03-09' });
  assert.equal(d.y.durum().tamamlanan, 0, 'tamamlanan günlüktür');
  assert.equal(d.y.durum().tur, 'kisa');
});

// ── Zil (WAV) ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('node scripts/dev/zil-uret.mjs WAV üretir: kısa, yumuşak, deterministik; depodaki dosya betiğin çıktısıdır', () => {
  const geçici = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-zil-'));
  try {
    const hedef = path.join(geçici, 'zil.wav');
    const r = spawnSync(process.execPath, ['scripts/dev/zil-uret.mjs', hedef], { cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const w = fs.readFileSync(hedef);
    assert.equal(w.subarray(0, 4).toString(), 'RIFF');
    assert.equal(w.subarray(8, 12).toString(), 'WAVE');
    assert.equal(w.readUInt16LE(20), 1, 'PCM');
    assert.equal(w.readUInt16LE(22), 1, 'mono');
    assert.equal(w.readUInt16LE(34), 16, '16 bit');
    const hz = w.readUInt32LE(24);
    const veri = w.readUInt32LE(40);
    assert.equal(w.length, 44 + veri);
    const sure = veri / 2 / hz;
    assert.ok(sure >= 0.8 && sure <= 2.5, `süre 0,8–2,5 sn: ${sure}`);
    let tepe = 0;
    for (let i = 44; i + 1 < w.length; i += 2) tepe = Math.max(tepe, Math.abs(w.readInt16LE(i)));
    assert.ok(tepe / 32768 <= 0.6 && tepe / 32768 > 0.1, `tepe yumuşak (≤ 0,6): ${tepe / 32768}`);
    assert.ok(Math.abs(w.readInt16LE(w.length - 2)) <= 4, 'son örnek sessiz (tık yok)');
    assert.ok(Math.abs(w.readInt16LE(44)) <= 4, 'ilk örnek sessiz (tık yok)');
    const depo = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'resources', 'ses', 'odak-zil.wav'));
    assert.ok(depo.equals(w), 'resources/ses/odak-zil.wav betiğin çıktısıyla aynı');
  } finally {
    fs.rmSync(geçici, { recursive: true, force: true });
  }
});

// ── Sayfa kaynağı ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('Odak sayfası: Panel kaydı, klavye ile erişilen hap düğmeler, ağ ve kalıcılık yok, hareket yalnız transform/opacity', () => {
  const panel = kaynakOku('src/renderer/ada/Panel.tsx');
  assert.match(panel, /sayfaKaydet\('odak', Odak\)/);
  assert.match(panel, /sayfaKaydet\('yapilacaklar', Yapilacaklar\)/);
  const k = kaynakOku('src/renderer/ada/sayfalar/Odak.tsx');
  for (const ad of ['Başlat', 'Duraklat', 'Sürdür', 'Kısa mola', 'Uzun mola']) assert.ok(k.includes(ad), `düğme: ${ad}`);
  assert.doesNotMatch(k, /fetch\(|XMLHttpRequest|WebSocket|localStorage|dangerouslySetInnerHTML/);
  assert.doesNotMatch(k, /tabIndex=\{-1\}/, 'düğmeler klavyeden erişilir');
  assert.match(k, /role="timer"/);
  assert.doesNotMatch(k, /<Gozler|<GorunenGoz|CentikSekli|useKarakter/, 'Sade modda da göz yok');
  const css = kaynakOku('src/renderer/ada/panel.css');
  for (const m of css.matchAll(/\.(?:odak|yapilacak)-sayfa[^{]*\{([^}]*)\}/g)) {
    assert.doesNotMatch(m[1], /transition[^;]*\b(width|height|left|top|margin|background|color)\b/, 'yalnız transform/opacity geçişi');
  }
});

// ── Zil yalnız hap gerçekten gösterildiğinde (düzeltme turu 1) ──────────────────────────────────────────────────────────────────────────────

// ── 0.14 son inceleme I4: Odak kullanıcının kendi zamanlayıcısıdır (sistem uyarısı değil) — ana pencere öndeyse uygulama içi tost + zil, tam ekranda kuyruk ──
const HAP: SistemUyarisi = { tur: 'odak-bitti', metin: 'Odak bitti · Kısa mola', simge: 'hedef' };
const ACIK = { anaOnde: false, kapali: false, tamEkran: false, gorunur: true };
type Kosul = typeof ACIK;
/** Sahte ada: koşullar elle değişir; tam ekran bitiş olayı `tamEkranBitti()` ile tetiklenir (yoklama yok). */
function odakSahnesi(k: Kosul) {
  const s = { k: { ...k }, hap: [] as SistemUyarisi[], tost: [] as SistemUyarisi[], zil: 0, bekleyen: null as null | (() => void) };
  const bitti = odakBittiBagi({
    yol: () => odakBittiYolu(s.k),
    hap: (u) => { s.hap.push(u); return uyariYolu(s.k) !== 'yok'; },
    tost: (u) => { s.tost.push(u); },
    zil: () => { s.zil++; },
    beklet: (f) => { s.bekleyen = f; },
  });
  const tamEkranBitti = () => { s.k.tamEkran = false; const f = s.bekleyen; s.bekleyen = null; f?.(); };
  return { s, bitti, tamEkranBitti };
}

test('I4 (saf): odakBittiYolu — çentik kapalı/1 saat gizli: yok (bugünkü davranış); ana pencere önde: tost; tam ekran: bekle; değilse hap', () => {
  assert.equal(odakBittiYolu(ACIK), 'yaz');
  assert.equal(odakBittiYolu({ ...ACIK, gorunur: false }), 'in');
  assert.equal(odakBittiYolu({ ...ACIK, anaOnde: true }), 'tost');
  assert.equal(odakBittiYolu({ ...ACIK, tamEkran: true }), 'bekle');
  assert.equal(odakBittiYolu({ ...ACIK, kapali: true }), 'yok');
  assert.equal(odakBittiYolu({ ...ACIK, kapali: true, anaOnde: true }), 'yok', 'gizli çentik bugünkü gibi: hiçbir şey');
  assert.equal(odakBittiYolu({ ...ACIK, kapali: true, tamEkran: true }), 'yok');
  assert.equal(odakBittiYolu({ ...ACIK, anaOnde: true, tamEkran: true }), 'tost', 'Fuber öndeyse tost');
});

test('I4: çentik görünür ya da iner — hap ve zil', () => {
  for (const gorunur of [true, false]) {
    const { s, bitti } = odakSahnesi({ ...ACIK, gorunur });
    bitti(HAP);
    assert.deepEqual({ hap: s.hap.length, tost: s.tost.length, zil: s.zil }, { hap: 1, tost: 0, zil: 1 });
  }
});

test('I4: ana pencere önde — uygulama içi tost (zili arayüz çalar), hap düşmez sessizce', () => {
  const { s, bitti } = odakSahnesi({ ...ACIK, anaOnde: true });
  bitti(HAP);
  assert.deepEqual(s.tost, [HAP], 'tost gösterildi');
  assert.equal(s.hap.length, 0);
  assert.equal(s.zil, 0, 'çentiğin zili çalmaz (tostla birlikte ana pencere çalar)');
  // Ana pencere arayüzü tostu gösterir ve zili çalar.
  const t = yorumsuz(kaynakOku('src/renderer/bilesenler/AdaTost.tsx'));
  assert.match(t, /o\.kanal === 'ada:odak-bitti'[\s\S]{0,400}tostEkle\([\s\S]{0,300}odakZiliCal\(\)/);
});

test('I4: tam ekranda hap ve zil kuyrukta bekler; tam ekran bitince (olayla) gösterilir ve zil çalar', () => {
  const { s, bitti, tamEkranBitti } = odakSahnesi({ ...ACIK, tamEkran: true });
  bitti(HAP);
  assert.deepEqual({ hap: s.hap.length, tost: s.tost.length, zil: s.zil }, { hap: 0, tost: 0, zil: 0 }, 'tam ekranda hiçbir şey gösterilmez');
  assert.ok(s.bekleyen, 'kuyrukta bekliyor');
  tamEkranBitti();
  assert.deepEqual(s.hap, [HAP], 'tam ekran bitince hap');
  assert.equal(s.zil, 1, 've zil');
  // Tam ekran bitince Fuber öndeyse tost olur.
  const b = odakSahnesi({ ...ACIK, tamEkran: true });
  b.bitti(HAP);
  b.s.k.anaOnde = true;
  b.tamEkranBitti();
  assert.deepEqual(b.s.tost, [HAP]);
  // ada.ts: bekleyen yalnız tam ekran bitiş olayında çalışır (yoklama yok).
  const a = yorumsuz(kaynakOku('src/main/ada.ts'));
  assert.match(a, /function tamEkranOlayi\(\): void \{[\s\S]*?if \(tam\) return;[\s\S]*?odakBekleyeniCalistir\(\);/);
  assert.doesNotMatch(a, /setInterval\([^)]*odak/i);
});

test('I4: çentik 1 saat gizli ya da kapalı — bugünkü davranış: hap yok, zil yok, kuyruk yok', () => {
  const { s, bitti } = odakSahnesi({ ...ACIK, kapali: true });
  bitti(HAP);
  assert.deepEqual({ hap: s.hap.length, tost: s.tost.length, zil: s.zil, bekleyen: s.bekleyen }, { hap: 0, tost: 0, zil: 0, bekleyen: null });
});

test('I4: hap gösterilemediyse (pencere yok, başka iş) zil yok; gerçek bağlayıcı ada.ts yollarını kullanır', () => {
  let zil = 0;
  odakBittiBagi({ yol: () => 'yaz', hap: () => false, tost: () => undefined, zil: () => { zil++; }, beklet: () => undefined })(HAP);
  assert.equal(zil, 0);
  const a = yorumsuz(kaynakOku('src/main/ada.ts'));
  assert.match(a, /function uyariGoster\(u: SistemUyarisi\): boolean/);
  assert.match(a, /export function adaUyari\(u: SistemUyarisi\): boolean/);
  assert.match(a, /export function adaOdakYolu\(\)/);
  assert.match(a, /export function adaOdakTost\(/);
  assert.match(a, /export function adaOdakBeklet\(/);
  assert.match(yorumsuz(kaynakOku('src/main/odak.ts')), /bitti: odakBittiBagi\(\{ yol: adaOdakYolu, hap: adaUyari, tost: adaOdakTost,/);
});

test('Odak.tsx: bitişi geçmiş önbellek durumu eski kare olarak gösterilmez', () => {
  const k = yorumsuz(kaynakOku('src/renderer/ada/sayfalar/Odak.tsx'));
  assert.match(k, /son\.bitis !== null && son\.bitis <= Date\.now\(\)/);
});

// 0.14 çentik cilası (5 Kas): Odak sürerken çentiğin kenar ışığı TEK CSS animasyonuyla ilerler — süre toplam, başlangıç negatif gecikmeyle (geçen kadar ileride);
// zamanlayıcı yok. Duraklamada durağan oran; boştayken hiç.
test('odakIlerlemesi: süre toplam, geçen ms; duraklamada durağan, boşta null', async () => {
  const { odakIlerlemesi, ODAK_SURELERI } = await import('../src/shared/odak.ts');
  const toplam = ODAK_SURELERI.odak * 1000;
  const simdi = 1_000_000;
  assert.deepEqual(odakIlerlemesi({ tur: 'odak', bitis: simdi + toplam - 60_000, duraklatildi: null, tamamlanan: 0 }, simdi),
    { tur: 'odak', toplamMs: toplam, gecenMs: 60_000, oran: 60_000 / toplam, akiyor: true });
  const d = odakIlerlemesi({ tur: 'kisa', bitis: null, duraklatildi: 120_000, tamamlanan: 1 }, simdi);
  assert.equal(d?.akiyor, false);
  assert.equal(d?.oran, 1 - 120_000 / (ODAK_SURELERI.kisa * 1000));
  assert.equal(odakIlerlemesi({ tur: 'odak', bitis: null, duraklatildi: null, tamamlanan: 0 }, simdi), null);
  const b = odakIlerlemesi({ tur: 'odak', bitis: simdi - 5, duraklatildi: null, tamamlanan: 0 }, simdi);
  assert.equal(b?.akiyor, false);
  assert.equal(b?.oran, 1);
});
