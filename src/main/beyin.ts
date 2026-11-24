// ── Beyin: motorların canlı etkinliği → Beyin sayfası ───────────────────────────────────────────────────────
// Her bölge (src/shared/beyin.ts) bir iş yaparken "başla/bitti", bölgeler arası akışta "sinyal", her model çağrısında
// "motor istek/yanıt" olayı yayınlanır. Arayüz bunları beynin üstünde ışık akışı olarak çizer. Olaylar bellekte kalır
// (son 80). Görev 25 düzeltme 1: bugünün bölge/motor sayaçları ve son 50 olay veri klasöründe (beyin-gunu.json; beyin-gunu.ts)
// tutulur — yeniden başlatma sayfayı sıfırlamaz; yerel gece yarısı sayaçlar ve olaylar silinir. Bu modül ayar/motor modüllerine
// bağlı değildir (döngüsel içe aktarma olmasın): "kapalı mı, dinliyor mu, motor bağlı mı" bilgisini ve günlük dosyasının yolunu
// main.ts beyinBagla() ile verir.
import { app } from 'electron';
import { yayinla } from './olaylar.js';
import { BOLGELER, MOTORLAR, amactanBolge, type BolgeId, type MotorId, type BeyinOlayi, type BeyinDurumu, type GorevOlayiTuru } from '../shared/beyin.js';
import type { DurmaNedeni } from '../shared/isler.js';
import { GUNLUK_SURUM, gunuOku, gunuYazHemen, yerelGun, type BeyinGunu } from './beyin-gunu.js';

const aktif = new Map<BolgeId, number>();
const bugun = new Map<BolgeId, number>();
const sonZaman = new Map<BolgeId, string>();
const sonNot = new Map<BolgeId, string>();
/** Son notun teknik ayrıntısı (motor adı, ham hata): arayüz yalnız Geliştirici modunda gösterir (Ruling O). */
const sonAyrinti = new Map<BolgeId, string>();
/** Son not bir hatanın notu mu (İş'te içeriğe bakılmadan "bir sorun oldu"; shared/beyin.ts bolgeNotu). */
const notHatali = new Set<BolgeId>();
const sonHata = new Map<BolgeId, number>();
const motorAktif = new Map<MotorId, number>();
const motorBugun = new Map<MotorId, number>();
const halka: BeyinOlayi[] = [];
let sayac = 0;
let gun = yerelGun();

let kaynak: { motorHazir: (m: MotorId) => boolean; kapali: (b: BolgeId) => string | undefined; dinliyor: (b: BolgeId) => boolean } = {
  motorHazir: () => false, kapali: () => undefined, dinliyor: () => false,
};
let gunlukYolu: string | null = null;
let yazZamani: ReturnType<typeof setTimeout> | null = null;

/** `gunlukYolu`: bugünün kaydı (verilirse açılışta okunur, değişince 1,5 sn içinde yazılır, çıkışta hemen). */
export function beyinBagla(k: typeof kaynak & { gunlukYolu?: string }): void {
  const { gunlukYolu: yol, ...geri } = k;
  kaynak = geri;
  if (yol && yol !== gunlukYolu) {
    gunlukYolu = yol;
    gunuGeriYukle(yol);
    // Çıkışta bekleyen yazım beklenmez: will-quit (normal çıkış, tepsiden "Çık", kurulum programının --cikis'i) ve süreç sonu (yedek).
    app.once('will-quit', gunuHemenKaydet);
    process.once('exit', () => { if (yazZamani) gunuHemenKaydet(); });
  }
}
/** Bekleyen yazımı hemen (eşzamanlı) yapar. */
function gunuHemenKaydet(): void {
  if (yazZamani) { clearTimeout(yazZamani); yazZamani = null; }
  if (gunlukYolu) gunuYazHemen(gunlukYolu, gunuTopla());
}

const artir = <K>(m: Map<K, number>, k: K, d: number) => m.set(k, Math.max(0, (m.get(k) ?? 0) + d));

/** Diskteki bugünü belleğe ekler (bağlanmadan önce olmuş olaylar korunur: sayaçlar toplanır, olaylar önce eskiler). */
function gunuGeriYukle(yol: string): void {
  const g = gunuOku(yol, gun);
  if (!g) return;
  for (const [b, n] of Object.entries(g.bugun)) artir(bugun, b as BolgeId, n ?? 0);
  for (const [m, n] of Object.entries(g.motorBugun)) artir(motorBugun, m as MotorId, n ?? 0);
  for (const [b, z] of Object.entries(g.sonZaman)) if (z && !sonZaman.has(b as BolgeId)) sonZaman.set(b as BolgeId, z);
  const yeniler = halka.splice(0);
  halka.push(...g.olaylar, ...yeniler);
  if (halka.length > 80) halka.splice(0, halka.length - 80);
  sayac = Math.max(sayac, ...g.olaylar.map((o) => o.id));
  // Bağlanmadan önce verilmiş kimlikler diskteki kimliklerle çakışmasın.
  for (const o of yeniler) o.id = ++sayac;
}

function gunuTopla(): BeyinGunu {
  return {
    surum: GUNLUK_SURUM, gun,
    bugun: Object.fromEntries(bugun), motorBugun: Object.fromEntries(motorBugun), sonZaman: Object.fromEntries(sonZaman),
    olaylar: halka.slice(-50),
  };
}

/** Değişiklikten en geç 1,5 sn sonra yazar (tek, eşzamanlı yazım yolu: çıkıştaki yazımla çakışan uçuşta yazım olmaz). */
function gunuKaydet(): void {
  if (!gunlukYolu || yazZamani) return;
  yazZamani = setTimeout(() => {
    yazZamani = null;
    if (gunlukYolu) gunuYazHemen(gunlukYolu, gunuTopla());
  }, 1500);
  yazZamani.unref?.();
}

function gunDondu(): void {
  const g = yerelGun();
  if (g !== gun) { gun = g; bugun.clear(); motorBugun.clear(); halka.length = 0; gunuKaydet(); }
}

function yay(o: Omit<BeyinOlayi, 'id' | 'zaman'>): void {
  gunDondu();
  const tam: BeyinOlayi = { ...o, id: ++sayac, zaman: new Date().toISOString() };
  halka.push(tam);
  if (halka.length > 80) halka.shift();
  yayinla('beyin:olay', tam);
  gunuKaydet();
}

const notYaz = (bolge: BolgeId, metin: string | undefined, ayrinti: string | undefined, hata = false) => {
  if (!metin) return;
  sonNot.set(bolge, metin);
  if (ayrinti) sonAyrinti.set(bolge, ayrinti); else sonAyrinti.delete(bolge);
  if (hata) notHatali.add(bolge); else notHatali.delete(bolge);
};

/** Bir bölge işe başladı; dönen işlev işi bitirir (bir kez). `metin` kullanıcıya görünen sade yazı (iki modda); `ayrinti` teknik
 *  ayrıntı (yazıcı motoru, ses sağlayıcısı, ham hata) — yalnız Geliştirici modunda gösterilir. */
export function beyinBasla(bolge: BolgeId, metin?: string, ayrinti?: string): (hata?: boolean, sonMetin?: string, sonAyrintisi?: string) => void {
  gunDondu(); // gece yarısından sonraki ilk iş YENİ güne sayılır (sayaç önce sıfırlanır, sonra artar)
  artir(aktif, bolge, 1);
  artir(bugun, bolge, 1);
  notYaz(bolge, metin, ayrinti);
  yay({ tur: 'basla', bolge, metin, ...(ayrinti ? { ayrinti } : {}) });
  const t0 = Date.now();
  let bitti = false;
  return (hata = false, sonMetin?: string, sonAyrintisi?: string) => {
    if (bitti) return;
    bitti = true;
    artir(aktif, bolge, -1);
    sonZaman.set(bolge, new Date().toISOString());
    notYaz(bolge, sonMetin, sonAyrintisi, hata);
    if (hata) sonHata.set(bolge, Date.now());
    yay({ tur: 'bitti', bolge, sure: Date.now() - t0, hata, metin: sonMetin, ...(sonAyrintisi ? { ayrinti: sonAyrintisi } : {}) });
  };
}

export async function beyinde<T>(bolge: BolgeId, metin: string, f: () => Promise<T>, ayrinti?: string): Promise<T> {
  const bitir = beyinBasla(bolge, metin, ayrinti);
  try { const r = await f(); bitir(); return r; } catch (e) { bitir(true, 'bir sorun oldu', (e as Error)?.message?.slice(0, 120)); throw e; }
}

/** Bölgeden bölgeye akış (ör. Kulak → Yazıcı: "konuşma bölümü"). `ayrinti`: yalnız Geliştirici'de. */
export function sinyal(kaynakBolge: BolgeId, hedef: BolgeId, metin?: string, ayrinti?: string): void {
  yay({ tur: 'sinyal', bolge: kaynakBolge, hedef, metin, ...(ayrinti ? { ayrinti } : {}) });
}

/** Aynı görevin ardışık "kontrol etti (değişiklik yok)" satırları bu süreden sık yazılmaz; arada olanlar sayılır ("3 kez"). */
export const GOREV_KONTROL_ARASI_MS = 30_000;
const gorevKontrol = new Map<number, { son: number; bekleyen: number }>();

/**
 * Görev olayı (0.11 G10, Etkinlik akışı): başladı / kontrol etti (değişiklik yok) / adım attı / bitti / durdu / yeniden başladı. Bölgesi 'saat' (kendi
 * kendini uyandıran iş); sayaçlara girmez (beyinBasla değil) ve telefona gitmez (shared/kopru-protokol.ts). 10 sn aralıklı bir görev akışı boğmasın diye
 * ardışık "kontrol etti" satırları GOREV_KONTROL_ARASI_MS'de bir yazılır, arada olanlar `n` olarak toplanır. `simdi`: görev saatiyle (testte sahte).
 */
export function gorevOlayi(olay: GorevOlayiTuru, is: { id: number; baslik: string }, ek: { neden?: DurmaNedeni; ozet?: string } = {}, simdi = Date.now()): void {
  const g: NonNullable<BeyinOlayi['gorev']> = { olay, id: is.id, baslik: is.baslik };
  if (olay === 'kontrol') {
    const k = gorevKontrol.get(is.id) ?? { son: Number.NEGATIVE_INFINITY, bekleyen: 0 };
    k.bekleyen += 1;
    if (simdi - k.son < GOREV_KONTROL_ARASI_MS) { gorevKontrol.set(is.id, k); return; }
    gorevKontrol.set(is.id, { son: simdi, bekleyen: 0 });
    g.n = k.bekleyen;
  } else {
    gorevKontrol.delete(is.id); // başka bir olay oldu: sonraki ilk kontrol yeniden görünür
    if (ek.neden) g.neden = ek.neden;
    if (ek.ozet) g.ozet = ek.ozet.slice(0, 300);
  }
  yay({ tur: 'gorev', bolge: 'saat', gorev: g });
}

/** Model çağrısı: istek bölgeden motora, yanıt motordan bölgeye akar. Dönen işlev çağrıyı kapatır. Görev 21 (tek görünen kimlik):
 *  model kimliği Beyin olaylarına ve durumuna YAZILMAZ — kullanıcı yalnız "Fuber"i görür; model adı yalnız Ayarlar → Yapay zekâ'da
 *  (Geliştirici). `model` parametresi imza uyumu için kalır. */
export function motorCagrisi(motor: MotorId, _model: string, amac: string): (hata?: boolean) => void {
  const bolge = amactanBolge(amac);
  gunDondu();
  artir(motorAktif, motor, 1);
  artir(motorBugun, motor, 1);
  artir(aktif, bolge, 1);
  yay({ tur: 'motor', faz: 'istek', bolge, motor, metin: amac });
  const t0 = Date.now();
  let bitti = false;
  return (hata = false) => {
    if (bitti) return;
    bitti = true;
    artir(motorAktif, motor, -1);
    artir(aktif, bolge, -1);
    sonZaman.set(bolge, new Date().toISOString());
    yay({ tur: 'motor', faz: 'yanit', bolge, motor, sure: Date.now() - t0, hata, metin: amac });
  };
}

export function beyinDurumu(): BeyinDurumu {
  gunDondu();
  return {
    bolgeler: BOLGELER.map((t) => {
      const a = aktif.get(t.id) ?? 0;
      const neden = kaynak.kapali(t.id);
      const hata = Date.now() - (sonHata.get(t.id) ?? 0) < 60_000;
      const hal = a > 0 ? 'calisiyor' : neden ? 'kapali' : hata ? 'hata' : kaynak.dinliyor(t.id) ? 'dinliyor' : 'hazir';
      return { id: t.id, hal, aktif: a, bugun: bugun.get(t.id) ?? 0, son: sonZaman.get(t.id), not: sonNot.get(t.id), ayrinti: sonAyrinti.get(t.id), ...(notHatali.has(t.id) ? { notHata: true } : {}), neden };
    }),
    motorlar: MOTORLAR.map((m) => ({ id: m.id, bagli: kaynak.motorHazir(m.id), aktif: motorAktif.get(m.id) ?? 0, bugun: motorBugun.get(m.id) ?? 0 })),
    olaylar: [...halka],
  };
}
