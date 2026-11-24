// ── Görevler zamanlayıcısı (0.11 G9; spec §8; tests/isler-zamanlayici.test.ts) ─────────────────────────────────────────────────────────
// Token harcamamak için 10 ya da 30 saniyelik aralar bırakarak kendi kendini tetikler; aralıkları işe uygun üretir.
// Tek setTimeout zinciri: en yakın uyanış (süren görevlerin `sonraki`si ya da planlanan bitişi). Uyanınca her süren görev için:
//   bitmeli mi (süre/zaman/sigorta → bitti; adım sınırı → bitti + 'sinir') → gözcü (yapay zekâsız) → değişmedi: aralık ×1,5 uzar, yapay zekâ
//   ÇAĞRILMAZ | değişti: ekran gerekiyorsa ekranı alır (alamazsa en kısa aralıkta yeniden dener), bir adım çalıştırır (main/isler/adim.ts),
//   aralık en kısaya (ya da yapay zekânın önerisine, sınırlara kırpılarak) döner; "bildir" ana sohbete tek satır + (sessiz saat/rahatsız etme
//   değilse) bildirim; bitince sonuç (+ izinle yapılan gönderimler). Başarısız adım (hata/durdurma/yankı) sayılmaz, bildirilmez, aralık
//   "değişmedi" gibi uzar; art arda 3'te görev 'hata' olur ve görev sohbetine tek sakin cümle yazılır.
// Sınırlar: aynı anda en çok 3 süren görev; Gizli açıkken ya da yol yerelken (araç yok) görev çalışmaz — süren görev durur (durmaNedeni
// Gizli'de 'gizli', yalnız yerel yolda 'yerel'; son inceleme I1), yeni görev başlamaz. (karar) Görev onaydan SONRA kaydolur: 'onay' durumu motorca yazılmaz; tür G10 için kalır.
// Durdurma: kullanıcı, acil (Alt+Shift+Q → main.ts acilDurdur), kapanış (before-quit) → 'durdu'; açılışta süren kalmışsa 'kapanis' yapılır ve
// kendiliğinden SÜRMEZ (arayüz "Fuber kapandığı için durdu — Sürdür" der; G10).
// Düzeltme turu 1 (sağlamlık):
//  · Kuşak: her durdurma/sürdürme görevin kuşağını artırır; süren adımın geç sonucu (eski kuşak) hiçbir şey yazmaz.
//  · Acil durdurma veritabanına bağlı değil: önce zamanlayıcı temizlenir, görev bellekte "durdu" işaretlenir (zincire bir daha girmez), her
//    görevin kaydı ayrı ayrı denenir — bir yazım hatası ötekileri ve turların kesilmesini engellemez.
//  · Beklenmeyen istisna: görev 10 sn × 2^n geri çekilir (zincir 0 ms'de dönmez); art arda 3'te 'hata' + tek sakin cümle.
//  · Gözcü hatası izi değiştirmez (ilk kontrol hata verirse sonraki başarılı kontrol yalnız izi kaydeder). Ekran gözcüsü ekran kullanımdayken
//    (kullanıcının ya da başka bir görevin turu) bakmaz, "değişmedi" sayar.
//  · Ertelenen adım (kullanıcı görev sohbetinde yazışıyor; kullanıcı ekranı kullanmaya başladı ve ekranı tutan adım kesildi) başarısız sayılmaz.
// Saat, zamanlayıcı, gözcü, adım ve yol testte sahtelenir (islerBagimliliklari).
import { yayinla, sohbetOlayi } from '../olaylar.js';
import { ayarlar, ayarDinle } from '../ayarlar.js';
import { olayKaydet } from '../vt.js';
import { gorevOlayi } from '../beyin.js';
import { anaSohbet, sohbetOlustur, mesajEkle, gorunume } from '../sohbet.js';
import { durdur as turuDurdur, kullaniciEkranda as kullaniciEkrandaMi, kullaniciEkranaGecinceDinle } from '../ajan/dongu.js';
import { tekMotorYolu } from '../motor/yerel.js';
import { sessizMi, proaktifBildir } from '../zamanlayici.js';
import { gozcuKontrol, type GozcuSonucu } from './gozculer.js';
import { adimCalistir, ERTELE, type AdimSonucu } from './adim.js';
import { isEkle, isGetir, isGuncelle, isKayitlari, ozete, type IsKaydi, type IsGuncellemesi } from './depo.js';
import {
  AYNI_ANDA_EN_COK, EN_KISA_ARALIK, bitmeliMi, durmaMetni, gonderilenlerMetni, isPlaniMetni, planlananBitis, sonrakiAralik,
  type DurmaNedeni, type IsOzet, type IsPlani,
} from '../../shared/isler.js';
import type { MotorYolu } from '../../shared/tek-motor.js';
import { TERIM } from '../../shared/terimler.js';

interface Bagimliliklar {
  simdi: () => number;
  kur: (f: () => void, ms: number) => unknown;
  iptal: (h: unknown) => void;
  gozcu: (is: IsOzet, onceki: string | null) => Promise<GozcuSonucu>;
  /** `sinyal`: zamanlayıcı adımı keserse (kullanıcı ekranı kullanmaya başladı) adım ERTELE döner. */
  adim: (is: IsKaydi, bulgu: string | undefined, sinyal: AbortSignal) => Promise<AdimSonucu | null | typeof ERTELE>;
  yol: () => MotorYolu;
  kullaniciEkranda: () => boolean;
}
let d: Bagimliliklar = {
  simdi: () => Date.now(),
  kur: (f, ms) => setTimeout(f, ms),
  iptal: (h) => clearTimeout(h as NodeJS.Timeout),
  gozcu: gozcuKontrol,
  adim: (is, bulgu, sinyal) => adimCalistir(is, bulgu, new Date(d.simdi()), sinyal),
  yol: tekMotorYolu,
  kullaniciEkranda: kullaniciEkrandaMi,
};
/** Test kancası: saat, zamanlayıcı, gözcü, adım, yol (verilmeyenler aynen kalır). */
export function islerBagimliliklari(k: Partial<Bagimliliklar>): void { d = { ...d, ...k }; }

const BASARISIZ_SINIRI = 3;
const iso = (t: number) => new Date(t).toISOString();
let zaman: unknown = null;
const calisan = new Set<number>();
const sozler = new Set<Promise<void>>();
let ekranSahibi: number | null = null;
let dinleniyor = false;
/** Görevin kuşağı: durdurma/sürdürme artırır; süren adım başladığı kuşağı taşır, değiştiyse sonucu yazmaz. */
const kusak = new Map<number, number>();
const kusagi = (id: number) => kusak.get(id) ?? 0;
const kusakArtir = (id: number) => kusak.set(id, kusagi(id) + 1);
/** Bellekte durdurulmuş görevler: kaydı yazılamasa da (veritabanı hatası) zincire bir daha girmez; sürdürülünce kalkar. */
const bellekteDurdu = new Set<number>();
/** Beklenmeyen istisnanın geri çekilmesi: art arda kaç kez ve hangi ana dek beklenir. */
const istisna = new Map<number, { n: number; kadar: number }>();
/** Süren adımı kesmek için (kullanıcı ekranı kullanmaya başladı). */
const kesiciler = new Map<number, AbortController>();

// ── Görünürlük ──
/** Yapay zekâ adımı şu an süren görevler (0.11 G10): kart "Çalışıyor" der, ada "Görev: …" hapını gösterir. Gözcü kontrolü adım değildir. */
const adimdaki = new Set<number>();
const gorunum = (k: IsKaydi): IsOzet => ({ ...ozete(k), adimda: k.durum === 'suruyor' && adimdaki.has(k.id) });
export function isListesi(): IsOzet[] { return isKayitlari().map(gorunum); }
function yayin(): void { try { yayinla('isler:durum', isListesi()); } catch (e) { console.warn('[görev] durum yayınlanamadı:', (e as Error).message); } }

/** Görev sohbetine kısa bir not (iç talimat değil; kullanıcıya görünen durum cümlesi). */
function not(k: IsKaydi, metin: string): void {
  const m = mesajEkle(k.sohbetId, { rol: 'not', bloklar: [{ tur: 'metin', metin }], gizli: false });
  sohbetOlayi({ tur: 'yeni_mesaj', sohbetId: k.sohbetId, mesaj: gorunume([m])[0] });
}

/** Ana sohbete tek satır (+ istenirse ikinci satır: gönderilenler) ve (sessiz saat/rahatsız etme değilse) TEK ada/Windows bildirimi. */
function duyur(k: IsKaydi, metin: string, o: { bitti?: boolean; ek?: string } = {}): void {
  const tek = metin.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!tek) return;
  const baslik = `${TERIM.gorev} · ${k.baslik}`;
  const ana = anaSohbet();
  const govde = `${o.bitti ? `${TERIM.gorev} bitti · ${k.baslik}` : baslik}: ${tek}${o.ek ? `\n${o.ek}` : ''}`;
  const m = mesajEkle(ana, { rol: 'assistant', bloklar: [{ tur: 'metin', metin: govde }], kaynak: 'proaktif', okunmamis: true, gizli: false });
  // Sessiz saat/rahatsız etme: satır ana sohbette kalır; ada/Windows bildirimi ve telefon bildirimi yok (bildirimsiz → main/kopru.ts).
  const sessiz = sessizMi(new Date(d.simdi()));
  sohbetOlayi({ tur: 'yeni_mesaj', sohbetId: ana, mesaj: gorunume([m])[0], ...(sessiz ? { bildirimsiz: true } : {}) });
  if (!sessiz) proaktifBildir(baslik, tek);
}

// ── Gizli / yerel: görevler araç ister ──
/** Görev şu an çalışamıyorsa GERÇEK nedeni (son inceleme I1): Gizli mod açıksa 'gizli'; değilse yol yalnız bu bilgisayardaki yapay zekâysa
 *  (Geliştirici'nin "yalnız bu bilgisayar" anahtarı ya da bulut hesabı kullanılamazken kurulu yerel yapay zekâ) 'yerel'; çalışabiliyorsa null.
 *  Eskiden ikisi de 'gizli' yazılıyor, kart ve Etkinlik Gizli kapalıyken "Gizli mod açıldığı için durdu" diyordu. */
// H3c düzeltme turu 1 (P14 K1): "Yalnız bu bilgisayar" seçiliyken yerel hazır olmasa da (yol 'yok') görev buluta gitmez → 'yerel'.
const engelNedeni = (): 'gizli' | 'yerel' | null => (ayarlar().yerel.gizliMod === true ? 'gizli' : d.yol() === 'yerel' || ayarlar().yerel.yalnizYerel === true ? 'yerel' : null);
const engel = (): boolean => engelNedeni() !== null;
function engeldeDurdur(): void {
  const neden = engelNedeni();
  if (!neden) return;
  let suren: IsKaydi[] = [];
  try { suren = isKayitlari({ durum: 'suruyor' }).filter((x) => !bellekteDurdu.has(x.id)); } catch (e) { console.warn('[görev] okunamadı:', (e as Error).message); }
  for (const k of suren) {
    try { durdurKaydi(k, neden); } catch (e) { console.warn(`[görev] #${k.id} (${neden}) durdurma kaydı yazılamadı (bellekte durdu):`, (e as Error).message); }
  }
  planla();
}

// ── Zincir ──
/** Görevin bir sonraki uyanışı: `sonraki` (istisnadan sonra geri çekilmeyle), ama hiçbir zaman planlanan bitişten SONRA değil (düzeltme turu
 *  2, N1: geri çekilme görevin bitişini geciktirmez — bitişte `bitmeliMi` zamanında çalışır). */
function uyanis(k: IsKaydi): number {
  const s = k.sonraki ? Date.parse(k.sonraki) : d.simdi();
  const b = planlananBitis(k.plan, k.baslangic);
  const bitis = b ? Date.parse(b) : Number.POSITIVE_INFINITY;
  return Math.min(Math.max(s, istisna.get(k.id)?.kadar ?? 0), bitis);
}

/** Görev listesi okunamazsa (veritabanı hatası) zincir ölmez: bu kadar sonra yeniden kurulur (düzeltme turu 2, N2). */
const PLAN_YENIDEN_MS = 30_000;

/** Tek zamanlayıcı: en yakın uyanışa kurulur (süren adımı olan görev, adım bitince yeniden planlanır). */
function planla(): void {
  if (zaman !== null) { d.iptal(zaman); zaman = null; }
  let bekleyen: IsKaydi[];
  try { bekleyen = isKayitlari({ durum: 'suruyor' }).filter((k) => !calisan.has(k.id) && !bellekteDurdu.has(k.id)); } catch (e) {
    console.warn('[görev] planlanamadı; 30 sn sonra yeniden:', (e as Error).message);
    zaman = d.kur(() => { zaman = null; planla(); }, PLAN_YENIDEN_MS);
    return;
  }
  if (!bekleyen.length) return;
  const en = Math.min(...bekleyen.map(uyanis));
  zaman = d.kur(() => { zaman = null; tik(); }, Math.max(0, en - d.simdi()));
}

function tik(): void {
  if (engel()) { engeldeDurdur(); return; }
  const simdi = d.simdi();
  let suren: IsKaydi[] = [];
  try { suren = isKayitlari({ durum: 'suruyor' }); } catch (e) { console.warn('[görev] okunamadı:', (e as Error).message); }
  for (const k of suren) {
    if (calisan.has(k.id) || bellekteDurdu.has(k.id) || uyanis(k) > simdi) continue;
    calisan.add(k.id);
    const s: Promise<void> = isCalistir(k.id, kusagi(k.id))
      .then(() => { istisna.delete(k.id); })
      .catch((e) => beklenmeyen(k.id, e))
      .finally(() => { calisan.delete(k.id); sozler.delete(s); yayin(); planla(); });
    sozler.add(s);
  }
  planla();
}

/** Beklenmeyen istisna: geri çekil (min aralık × 2^n), art arda 3'te görev 'hata'. */
function beklenmeyen(id: number, e: unknown): void {
  console.warn(`[görev] #${id} çalışmadı:`, (e as Error)?.message ?? e);
  const n = (istisna.get(id)?.n ?? 0) + 1;
  const k = (() => { try { return isGetir(id); } catch { return null; } })();
  if (n >= BASARISIZ_SINIRI) {
    istisna.delete(id);
    bellekteDurdu.add(id);
    kusakArtir(id);
    if (k) {
      try { isGuncelle(id, { durum: 'hata', durmaNedeni: 'hata', sonraki: null, bitisZamani: iso(d.simdi()) }); } catch (h) { console.warn('[görev] hata kaydı yazılamadı:', (h as Error).message); }
      try { olayKaydet('gorev', { id, olay: 'hata' }); gorevOlayi('durdu', k, { neden: 'hata' }, d.simdi()); not(k, durmaMetni('hata')); } catch { /* en iyi çaba */ }
    }
    return;
  }
  istisna.set(id, { n, kadar: d.simdi() + (k?.plan.aralik.min ?? EN_KISA_ARALIK) * 1000 * 2 ** n });
}

/** Görev hâlâ bu kuşakta süren mi (adım sürerken durdurulduysa/sürdürüldüyse null: geç sonuç yazılmaz). */
const hala = (id: number, benim: number): IsKaydi | null => {
  if (kusagi(id) !== benim || bellekteDurdu.has(id)) return null;
  const k = isGetir(id);
  return k && k.durum === 'suruyor' ? k : null;
};

async function isCalistir(id: number, benim: number): Promise<void> {
  let k = hala(id, benim);
  if (!k) return;
  const simdi = d.simdi();
  const neden = bitmeliMi(k, new Date(simdi));
  if (neden) { bitir(k, neden); return; }
  if (k.sonraki && Date.parse(k.sonraki) > simdi) return;
  const sayac = (): IsGuncellemesi => ({ kontrol: k!.kontrol + 1, sonKontrol: iso(d.simdi()) });
  const ileri = (aralik: number, ek: IsGuncellemesi = {}) => isGuncelle(id, { ...sayac(), aralik, sonraki: iso(d.simdi() + aralik * 1000), ...ek });
  const yakinda = (ek: IsGuncellemesi = {}) => isGuncelle(id, { ...sayac(), sonraki: iso(d.simdi() + EN_KISA_ARALIK * 1000), ...ek });

  // Ekran gözcüsü ekran kullanımdayken bakmaz (kullanıcının turu ya da ekranı tutan başka görev): "değişmedi", iz aynen.
  if (k.plan.gozcu.tur === 'ekran' && (d.kullaniciEkranda() || (ekranSahibi !== null && ekranSahibi !== id))) {
    ileri(sonrakiAralik(k.aralik, false, k.plan));
    return;
  }
  let g: GozcuSonucu | null = null;
  try { g = await d.gozcu(ozete(k), k.iz); } catch (e) { console.warn(`[görev] #${id} gözcüsü bakamadı:`, (e as Error).message); }
  if (!(k = hala(id, benim))) return;
  // Gözcü hatası: "değişmedi", iz DEĞİŞMEZ (ilk kontrolde null kalır: sonraki başarılı kontrol yalnız izi kaydeder).
  if (!g) { ileri(sonrakiAralik(k.aralik, false, k.plan)); return; }
  if (!g.degisti) { gorevOlayi('kontrol', k, {}, d.simdi()); ileri(sonrakiAralik(k.aralik, false, k.plan), { iz: g.iz }); return; }

  // Değişti: yapay zekâ adımı. Ekran izni olan görev ekranı yalnız adım boyunca tutar; başkası tutuyorsa bekler (iz yazılmaz: değişiklik kaybolmaz).
  const ekranli = k.plan.izinler.some((i) => i.tur === 'ekran');
  if (ekranli && !ekranAl(id)) { yakinda(); return; }
  const kesici = new AbortController();
  kesiciler.set(id, kesici);
  // Adım başlıyor: durum hemen yayınlanır (ada "Görev: …" hapı o an inebilsin; kart "Çalışıyor" desin). Bitişte tik'in finally'si yayınlar.
  adimdaki.add(id);
  yayin();
  let r: AdimSonucu | null | typeof ERTELE = null;
  try { r = await d.adim(k, g.bulgu, kesici.signal); } catch (e) { console.warn(`[görev] #${id} adımı:`, (e as Error).message); r = null; } finally {
    kesiciler.delete(id);
    adimdaki.delete(id);
    if (ekranli) ekranBirak(id);
  }
  if (!(k = hala(id, benim))) return;
  // Ertelenen adım (kullanıcı görev sohbetinde yazışıyor ya da ekranı kullanmaya başladı): sayılmaz, iz ilerlemez, kısa süre sonra yeniden.
  if (r === ERTELE) { yakinda(); return; }
  if (!r) {
    // Başarısız adım: sayılmaz, bildirilmez; iz ilerlemez (değişiklik bir sonraki adımda yeniden ele alınır).
    const basarisiz = k.basarisiz + 1;
    if (basarisiz >= BASARISIZ_SINIRI) { hataylaDur(k, { ...sayac(), basarisiz }); return; }
    ileri(sonrakiAralik(k.aralik, false, k.plan), { basarisiz });
    return;
  }
  ileri(sonrakiAralik(k.aralik, true, k.plan, r.sonrakiSn), { iz: g.iz, adim: k.adim + 1, basarisiz: 0, sonOzet: r.ozet, ozetler: [...k.ozetler, r.ozet].slice(-3) });
  const guncel = isGetir(id)!;
  gorevOlayi('adim', guncel, { ozet: r.ozet }, d.simdi());
  // Bitiş ve bildirim aynı adımdaysa ana sohbete TEK satır, TEK bildirim.
  if (r.bitti) bitir(guncel, null, r.sonuc ?? r.bildir ?? r.ozet);
  else if (bitmeliMi(guncel, new Date(d.simdi())) === 'sinir') bitir(guncel, 'sinir', undefined, r.bildir);
  else if (r.bildir) duyur(guncel, r.bildir);
}

function bitir(k: IsKaydi, neden: 'sure' | 'sinir' | null, sonuc?: string, bildir?: string): void {
  const metin = sonuc
    ?? (neden === 'sinir' ? `${bildir ? `${bildir} ` : ''}Uzun bir işti; belirlenen adım sayısı doldu, burada durdu.${!bildir && k.sonOzet ? ` Son durum: ${k.sonOzet}` : ''}`
      : k.sonOzet ? `Süre doldu. Son durum: ${k.sonOzet}` : 'Süre doldu; dikkat isteyen bir değişiklik olmadı.');
  kusakArtir(k.id);
  isGuncelle(k.id, { durum: 'bitti', durmaNedeni: neden === 'sinir' ? 'sinir' : null, sonuc: metin, sonraki: null, bitisZamani: iso(d.simdi()) });
  olayKaydet('gorev', { id: k.id, olay: 'bitti', neden });
  gorevOlayi('bitti', k, {}, d.simdi());
  // İzinle yapılan gönderimler ana sohbetteki özette deterministik satırla (spec §8 İzinler; metin yok).
  duyur(k, metin, { bitti: true, ek: gonderilenlerMetni(isGetir(k.id)?.gonderilenler ?? k.gonderilenler) || undefined });
}

function hataylaDur(k: IsKaydi, sayac: IsGuncellemesi): void {
  kusakArtir(k.id);
  isGuncelle(k.id, { ...sayac, durum: 'hata', durmaNedeni: 'hata', sonraki: null, bitisZamani: iso(d.simdi()) });
  olayKaydet('gorev', { id: k.id, olay: 'hata' });
  gorevOlayi('durdu', k, { neden: 'hata' }, d.simdi());
  not(k, durmaMetni('hata'));
}

/** Görevi durdurur. Önce BELLEKTE (kuşak, zincir dışı, ekran, süren adımın turu) — sonra kayıt; kaydın hatası durdurmayı geri almaz. */
function durdurKaydi(k: IsKaydi, neden: DurmaNedeni): void {
  kusakArtir(k.id);
  bellekteDurdu.add(k.id);
  istisna.delete(k.id);
  if (k.id === ekranSahibi) ekranSahibi = null;
  kesiciler.get(k.id)?.abort();
  // O sırada süren adımın turu da kesilir (bekleyen onay kartları reddedilir); geç sonucu zaten yazılmaz.
  if (calisan.has(k.id)) { try { turuDurdur(k.sohbetId); } catch { /* en iyi çaba */ } }
  isGuncelle(k.id, { durum: 'durdu', durmaNedeni: neden, sonraki: null, bitisZamani: iso(d.simdi()) });
  try { olayKaydet('gorev', { id: k.id, olay: 'durdu', neden }); gorevOlayi('durdu', k, { neden }, d.simdi()); not(k, durmaMetni(neden)); } catch (e) { console.warn('[görev] durma notu yazılamadı:', (e as Error).message); }
}

/** Kullanıcının kendi turu ekranı/fareyi kullanmaya başladı (ajan/dongu.ts): ekranı tutan görev adımı kesilir — başarısız sayılmaz, görev sürer. */
export function kullaniciEkranaGecti(): void {
  if (ekranSahibi !== null) kesiciler.get(ekranSahibi)?.abort();
}

// ── Dışa açık işlemler ──
/** Açılış (main.ts): önceki oturumdan 'suruyor' kalmış görevler (uygulama düştü ya da kapanış yarım kaldı) 'durdu' + 'kapanis' olur ve
 *  KENDİLİĞİNDEN SÜRMEZ; Gizli/yerel geçişi ve kullanıcının ekrana geçişi dinlenir. Yeniden çağrılması zararsız. */
export function islerBaslat(): void {
  if (zaman !== null) { d.iptal(zaman); zaman = null; }
  ekranSahibi = null;
  for (const k of isKayitlari({ durum: 'suruyor' })) {
    try { durdurKaydi(k, 'kapanis'); } catch (e) { console.warn(`[görev] #${k.id} açılışta durdurulamadı:`, (e as Error).message); }
  }
  if (!dinleniyor) {
    dinleniyor = true;
    ayarDinle(() => engeldeDurdur());
    kullaniciEkranaGecinceDinle(kullaniciEkranaGecti);
  }
  yayin();
}

/** Başlatma/sürdürme reddi: GERÇEK neden (son inceleme I1) — "Gizli modda görevler çalışmaz." ya da "Yapay zekâ şu an yalnız bu bilgisayarda
 *  çalıştığı için görevler çalışmaz." */
const engelMetni = () => durmaMetni(engelNedeni() ?? 'yerel').replace('; görev durdu.', '.');

/** Onaylanmış planla görevi başlatır: görev sohbeti ("Görev · <başlık>", tür 'gorev') açılır, "başladım" yazılır (yapay zekâ çağrılmaz),
 *  ilk kontrol hemen kurulur. Gizli/yerel yolda ya da 3 görev sürerken reddedilir. */
export function isBaslat(o: { baslik: string; amac: string; plan: IsPlani }): { is: IsOzet } | { hata: string } {
  if (engel()) return { hata: engelMetni() };
  if (isKayitlari({ durum: 'suruyor' }).filter((k) => !bellekteDurdu.has(k.id)).length >= AYNI_ANDA_EN_COK) return { hata: `Aynı anda en çok ${AYNI_ANDA_EN_COK} görev sürebilir; önce birini durdur.` };
  const baslik = o.baslik.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!baslik) return { hata: 'Görevin başlığı boş olamaz.' };
  const amac = o.amac.trim().slice(0, 1000);
  const simdi = d.simdi();
  const sohbetId = sohbetOlustur(`${TERIM.gorev} · ${baslik}`, 'gorev');
  const k = isEkle({ baslik, amac, plan: o.plan, sohbetId, baslangic: iso(simdi), bitisZamani: planlananBitis(o.plan, iso(simdi)), aralik: o.plan.aralik.min });
  // Yeni satır: bu kimliğe ait bellekteki eski hâl (silinmiş bir satırın kimliği yeniden verilmiş olabilir) temizlenir.
  bellekteDurdu.delete(k.id);
  istisna.delete(k.id);
  kusakArtir(k.id);
  const m = isPlaniMetni(o.plan, ayarlar().mod);
  const ilk = mesajEkle(sohbetId, { rol: 'assistant', bloklar: [{ tur: 'metin', metin: `Başladım. ${m.nasil} ${m.bitis}` }], kaynak: 'proaktif', gizli: false });
  sohbetOlayi({ tur: 'yeni_mesaj', sohbetId, mesaj: gorunume([ilk])[0] });
  olayKaydet('gorev', { id: k.id, olay: 'basladi' });
  gorevOlayi('basladi', k, {}, simdi);
  yayin();
  planla();
  return { is: ozete(k) };
}

/** Kullanıcı (ya da is_durdur aracı) durdurur. Süren değilse olduğu gibi döner. */
export function isDurdur(id: number, neden: DurmaNedeni = 'kullanici'): IsOzet | null {
  const k = isGetir(id);
  if (!k) return null;
  if (k.durum === 'suruyor' && !bellekteDurdu.has(id)) { durdurKaydi(k, neden); yayin(); planla(); }
  return ozete(isGetir(id)!);
}

/** "Sürdür": durmuş (ya da hata vermiş) görev yeniden başlar — süre penceresi yeniden açılır, adım sayacı ve gözcü izi kalır (durduğu sırada
 *  gelen değişiklik ilk kontrolde görülür). Bitiş zamanı geçtiyse, adım sınırı dolduysa, Gizli/yerelde ya da 3 görev sürerken olmaz. */
export function isSurdur(id: number): { is: IsOzet } | { hata: string } {
  const k = isGetir(id);
  if (!k) return { hata: 'Görev bulunamadı.' };
  if (k.durum !== 'durdu' && k.durum !== 'hata') return { hata: k.durum === 'suruyor' ? 'Görev zaten sürüyor.' : 'Biten görev sürdürülemez; yeni bir görev başlat.' };
  if (engel()) return { hata: engelMetni() };
  if (isKayitlari({ durum: 'suruyor' }).filter((x) => !bellekteDurdu.has(x.id)).length >= AYNI_ANDA_EN_COK) return { hata: `Aynı anda en çok ${AYNI_ANDA_EN_COK} görev sürebilir; önce birini durdur.` };
  if (k.adim >= k.plan.azamiAdim) return { hata: 'Görevin adım sınırı doldu; yeni bir görev başlat.' };
  const simdi = d.simdi();
  if (k.plan.bitis.tur === 'zaman' && Date.parse(k.plan.bitis.iso) <= simdi) return { hata: 'Görevin bitiş zamanı geçti; yeni bir görev başlat.' };
  kusakArtir(id);
  bellekteDurdu.delete(id);
  istisna.delete(id);
  isGuncelle(id, { durum: 'suruyor', durmaNedeni: null, basarisiz: 0, baslangic: iso(simdi), bitisZamani: planlananBitis(k.plan, iso(simdi)), sonraki: iso(simdi), aralik: k.plan.aralik.min });
  olayKaydet('gorev', { id, olay: 'surdu' });
  gorevOlayi('surdu', k, {}, simdi);
  not(k, 'Görev yeniden başladı.');
  yayin();
  planla();
  return { is: ozete(isGetir(id)!) };
}

/** Bütün süren görevleri durdurur (acil durdurma, kapanış). ÖNCE zamanlayıcı temizlenir; her görev ayrı denenir (bir kaydın hatası ötekileri
 *  engellemez; görev bellekte yine durur). Bekleyen zamanlayıcı kalmaz. Durdurulan sayısı. */
export function tumIsleriDurdur(neden: 'acil' | 'kapanis'): number {
  if (zaman !== null) { try { d.iptal(zaman); } catch { /* yine de bırak */ } zaman = null; }
  ekranSahibi = null;
  let suren: IsKaydi[] = [];
  try { suren = isKayitlari({ durum: 'suruyor' }).filter((k) => !bellekteDurdu.has(k.id)); } catch (e) {
    console.warn('[görev] süren görevler okunamadı:', (e as Error).message);
    // Okunamıyorsa çalışan adımları yine kes (bellekteki kesiciler).
    for (const k of kesiciler.values()) k.abort();
    return 0;
  }
  for (const k of suren) {
    try { durdurKaydi(k, neden); } catch (e) { console.warn(`[görev] #${k.id} durdurma kaydı yazılamadı (bellekte durdu):`, (e as Error).message); }
  }
  if (zaman !== null) { try { d.iptal(zaman); } catch { /* yine de bırak */ } zaman = null; }
  if (suren.length) yayin();
  return suren.length;
}

// ── Ekran kilidi: aynı anda tek sahip; kullanıcının kendi turu ekranı kullanıyorsa görev adımı bekler ──
export function ekranAl(isId: number): boolean {
  if (d.kullaniciEkranda()) return false;
  if (ekranSahibi !== null && ekranSahibi !== isId) return false;
  ekranSahibi = isId;
  return true;
}
export function ekranBirak(isId: number): void { if (ekranSahibi === isId) ekranSahibi = null; }

/** Test kancaları: bekleyen zamanlayıcı var mı; süren işler bitene dek bekle; zinciri yeniden kur. */
export const _test = {
  bekleyenZamanlayici: (): boolean => zaman !== null,
  async bosta(): Promise<void> { while (sozler.size) await Promise.allSettled([...sozler]); },
  planla,
};
