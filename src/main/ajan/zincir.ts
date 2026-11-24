// ── Ajan zinciri: adım tavanı, istek sınırına sığdırma, araç sırası, tavan ve "Devam et" (0.14 T13; saf → birim testli: tests/arac-zinciri.test.ts) ──
// 2 Kas: model yalnız sohbet ediyor, Claude Code gibi her yere bağlanıp iş yapamıyordu. Tur artık 100 adıma dek sürer (eskiden 30). Uzun zincir
// sunucunun istek sınırını aşmasın diye her model çağrısından önce sıkıştırılır: son 6 adım dışındaki araç sonuçları ilk 200 karakterine iner; yine
// sığmazsa en eski birim (tek ileti ya da çağrı + sonucu) bütün olarak düşer — çağrı ile sonucu hiçbir zaman ayrılmaz, turun isteği hep kalır. Sınır yola
// göre seçilir (istekSiniri): sunucu `aracCagirma` verdiyse yerel araç protokolünün sınırı (ARAC_ISTEK_SINIRI), vermiyorsa (eski sunucu, metin yolu)
// 100 mesaj ve 120.000 karakter; adım tavanı iki yolda da 100. Tavanda ek model çağrısı yapılmaz: sabit not (R24) ve "Devam et". Araç listesi 256'yı
// aşarsa bağlı MCP servisleri bütün olarak dışarıda kalır, `mcp_kullan` ile tembel açılır ve kullanıcıya bir satırla söylenir (R4, B36): araç sessizce
// düşmez. Araç sonucu 20.000 karakterde kesilirse sonuca not düşer (sessiz kesme yok). 0.14 T16 (T7/T13 devirleri): servisler sunucunun metin
// kataloğu tavanına da (2.000.000; ARAC_ISTEK_SINIRI.katalog, sunucunun saydığı gibi) sığdırılır; önceden kesilmiş sonuç yeniden kesilirse not gerçek boyu taşır.
import type { Blok, Mesaj } from '../motor/tipler.js';
import type { Arac } from './araclar/kayit.js';
import { ARAC_ISTEK_SINIRI, aracBlokUzunlugu, katalogBoyu } from '../../shared/sohbet-protokolu.ts';
import { DEVAM_METNI, TAVAN_NOTU_KAYNAGI } from '../../shared/sohbet-gorunum.ts';

/** Bir turda en çok model çağrısı (adım). Her adım bir model yanıtı ve onun araçlarıdır. */
export const AZAMI_ADIM = 100;
/** Arka plan görev adımının tavanı (düzeltme turu 1, denetleyici kararı): 30 kalır; sohbetin 100'ü görev adımına uygulanmaz. Tavana ulaşan adım
 *  tamamlandı sayılmaz (isler/adim.ts "yarım kaldı" der), tavan notu görev sohbetine yazılmaz. */
export const GOREV_AZAMI_ADIM = 30;
/** "Devam et" bağlamındaki asıl isteğin sınırı (karakter). */
export const ASIL_ISTEK_SINIRI = 1_000;
/** "Çalışıyor" hâli (R13): tur 8 sn'yi ya da 3 adımı aşınca. */
export const CALISIYOR_ESIGI = { ms: 8000, adim: 3 } as const;
/** Tam sonucuyla kalan son adım sayısı. */
export const KORUNAN_SON_ADIM = 6;
/** Eski sunucu (yetenek yok, metin yolu): sunucunun sınırı 100 mesaj ve 120.000 karakter; metin yolu (motor/fuber.ts gatewayMesajlari) 110.000'de
 *  keser — ajan da 110.000'e sığdırır ki o son kesim turun isteğini düşürmesin (10.000 emniyet payı). */
export const ESKI_ISTEK_SINIRI = { mesaj: 100, metin: 110_000 } as const;
/** Modele giden tek araç sonucunun sınırı (iki protokolde aynı). */
export const ARAC_SONUC_SINIRI = 20_000;
/** Kısaltılan eski sonucun ve uzun araç girdisinin önizlemesi. */
const ONIZLEME = 200;
/** Eski adımın araç girdisindeki bundan uzun metin (ör. dosyaya yazılan içerik) önizlemeye iner. */
const GIRDI_METIN_SINIRI = 2_000;

export const calisiyorMu = (gecenMs: number, adim: number): boolean => gecenMs >= CALISIYOR_ESIGI.ms || adim > CALISIYOR_ESIGI.adim;

/** Request limit used when trimming the message chain (tool-calling providers). */
export function istekSiniri(): { mesaj: number; metin: number } {
  return { mesaj: ARAC_ISTEK_SINIRI.mesaj, metin: ARAC_ISTEK_SINIRI.metin };
}

const binlik = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const KISALTMA_NOTU = /… \(sonuç kısaltıldı: [\d.]+ \/ ([\d.]+) karakter\)$/;

/** Araç sonucu sınırı aşarsa kesilir ve sonuna "… (sonuç kısaltıldı: X / Y karakter)" notu düşer: model de kullanıcı da kesildiğini bilir. Zaten
 *  kısaltılmış metin bir daha kesilmez (ajan döngüsü keser, sağlayıcı aynı işlevi son güvenlik ağı olarak yeniden uygular). 0.14 T16 (T13 devri):
 *  daha büyük bir sınırda önceden kesilmiş metin (MCP 40.000'de keser) yeniden kesilirse not GERÇEK boyu (öncekinin Y'si) taşır. */
export function aracSonucuKisalt(icerik: string, sinir = ARAC_SONUC_SINIRI): string {
  if (icerik.length <= sinir) return icerik;
  const m = KISALTMA_NOTU.exec(icerik);
  if (m && m.index <= sinir) return icerik;
  const gercek = m ? Number(m[1].replace(/\./g, '')) : icerik.length;
  return `${icerik.slice(0, sinir)}… (sonuç kısaltıldı: ${binlik(sinir)} / ${binlik(Math.max(gercek, icerik.length - (m?.[0].length ?? 0)))} karakter)`;
}
export const sonucKisaltildiMi = (icerik: string): boolean => KISALTMA_NOTU.test(icerik);

// ── Zinciri sığdırma ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
type SonucBlogu = Extract<Blok, { tur: 'arac_sonuc' }>;
/** Birim: tek ileti ya da bir adım (araç çağıran Fuber iletisi + hemen ardındaki sonuç iletisi). Düşürme ve kısaltma birim birimdir. */
interface Birim { mesajlar: Mesaj[]; adim: boolean }

const cagriVar = (m: Mesaj): boolean => m.rol === 'assistant' && m.bloklar.some((b) => b.tur === 'arac_cagri');
const sonucVar = (m: Mesaj): boolean => m.rol === 'user' && m.bloklar.some((b) => b.tur === 'arac_sonuc');
/** Kullanıcının sözü (turun isteği, geçmiş bir soru ya da sistem notu): araç sonucu taşımayan, metinli ya da görselli kullanıcı iletisi. */
const istekMi = (m: Mesaj): boolean => m.rol === 'user' && !sonucVar(m) && m.bloklar.some((b) => b.tur === 'metin' || b.tur === 'gorsel');

function birimler(l: readonly Mesaj[]): Birim[] {
  const out: Birim[] = [];
  for (let i = 0; i < l.length; i++) {
    if (cagriVar(l[i]) && l[i + 1] && sonucVar(l[i + 1])) { out.push({ mesajlar: [l[i], l[i + 1]], adim: true }); i++; }
    else out.push({ mesajlar: [l[i]], adim: false });
  }
  return out;
}

/** İletinin sağlayıcıya gidişte tutacağı yer (iki protokolün büyüğü; güvenli yönde): yerel protokolde her sonuç ayrı `tool` iletisidir, metin yolunda
 *  sonuç ve çağrılar etiketlerle sarılır. Görsel metin sayılmaz; yer tutucuya inebileceği için küçük pay. */
function olcu(m: Mesaj): { mesaj: number; metin: number } {
  let metin = 0, sonuc = 0, diger = 0;
  for (const b of m.bloklar) {
    if (b.tur === 'metin') { metin += b.metin.length; diger++; }
    else if (b.tur === 'gorsel') { metin += 30; diger++; }
    else if (b.tur === 'arac_cagri') metin += b.ad.length + b.id.length + JSON.stringify(b.girdi ?? {}).length + 40;
    else { sonuc++; metin += Math.min(b.icerik.length, ARAC_SONUC_SINIRI + 64) + (b.ad?.length ?? 0) + b.id.length + 64 + (b.gorseller?.length ?? 0) * 30; }
  }
  return { mesaj: m.rol === 'assistant' ? 1 : Math.max(1, sonuc + (diger ? 1 : 0)), metin: Math.max(1, metin) };
}

function sonucuKisalt(b: SonucBlogu): SonucBlogu {
  const { gorseller, ...govde } = b;
  if (b.icerik.length > ONIZLEME + 40) return { ...govde, icerik: `[önceki araç sonucu kısaltıldı: ${b.icerik.slice(0, ONIZLEME)}]` };
  return gorseller?.length ? { ...govde, icerik: `${b.icerik}\n[ekran görüntüsü vardı]` } : b;
}

function girdiKisalt(v: unknown): unknown {
  if (typeof v === 'string') return v.length > GIRDI_METIN_SINIRI ? `${v.slice(0, ONIZLEME)}… [kısaltıldı: ${binlik(v.length)} karakter]` : v;
  if (Array.isArray(v)) return v.map(girdiKisalt);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, girdiKisalt(x)]));
  return v;
}

/** Eski adım: sonuçlar önizlemeye iner (görseller kalkar); çağrının uzun metin girdisi de. Girdisi değişen iletinin sağlayıcı içeriği (`ham`) atılır. */
function adimiKisalt(b: Birim): Birim {
  const [cagri, sonuc] = b.mesajlar;
  let girdiDegisti = false;
  const cBloklar = cagri.bloklar.map((x) => {
    if (x.tur !== 'arac_cagri' || JSON.stringify(x.girdi ?? {}).length <= GIRDI_METIN_SINIRI) return x;
    girdiDegisti = true;
    return { ...x, girdi: girdiKisalt(x.girdi) as Record<string, unknown> };
  });
  return {
    adim: true,
    mesajlar: [
      girdiDegisti ? { rol: cagri.rol, bloklar: cBloklar } : cagri,
      { ...sonuc, bloklar: sonuc.bloklar.map((x) => (x.tur === 'arac_sonuc' ? sonucuKisalt(x) : x)) },
    ],
  };
}

/** Geçmiş + turun iletileri → sınıra sığan liste (girdi değişmez). Son `korunanSon` adım dışındaki araç sonuçları "[önceki araç sonucu kısaltıldı:
 *  <ilk 200 karakter>]" olur. Yine sığmazsa en eski birim bütün olarak düşer; turun isteği (son kullanıcı sözü), `sabitMi`nin tuttuğu kullanıcı sözleri
 *  ("Devam et" zincirinin asıl isteği; düzeltme turu 1) ve en yeni birim hep kalır — kırpma sabitlerin dışındaki en eski birimden başlar, liste
 *  kullanıcının sözüyle başlar. Ölçü sağlayıcının saydığından büyük ya da eşittir (iki protokolde de güvenli yönde). */
export function zinciriSikistir(mesajlar: Mesaj[], sinir: { mesaj: number; metin: number }, korunanSon = KORUNAN_SON_ADIM, sabitMi?: (m: Mesaj) => boolean): Mesaj[] {
  const b = birimler(mesajlar);
  const adimlar = b.filter((x) => x.adim);
  const tam = new Set(adimlar.slice(Math.max(0, adimlar.length - korunanSon)));
  const l = b.map((x) => (x.adim && !tam.has(x) ? adimiKisalt(x) : x));
  let istek: Birim | null = null;
  for (let i = l.length - 1; i >= 0 && !istek; i--) if (!l[i].adim && istekMi(l[i].mesajlar[0])) istek = l[i];
  const sabit = new Set(l.filter((x) => x === istek || (sabitMi && !x.adim && istekMi(x.mesajlar[0]) && sabitMi(x.mesajlar[0]))));
  const olculer = new Map(l.map((x) => [x, x.mesajlar.reduce((t, m) => { const o = olcu(m); return { mesaj: t.mesaj + o.mesaj, metin: t.metin + o.metin }; }, { mesaj: 0, metin: 0 })]));
  let top = [...olculer.values()].reduce((t, o) => ({ mesaj: t.mesaj + o.mesaj, metin: t.metin + o.metin }), { mesaj: 0, metin: 0 });
  const dus = (i: number) => { const o = olculer.get(l[i])!; top = { mesaj: top.mesaj - o.mesaj, metin: top.metin - o.metin }; l.splice(i, 1); };
  while (top.mesaj > sinir.mesaj || top.metin > sinir.metin) {
    const i = l.findIndex((x, k) => !sabit.has(x) && k < l.length - 1);
    if (i < 0) break;
    dus(i);
  }
  // Baş kullanıcının sözü olmalı: baştaki Fuber yanıtı, yetim sonuç ya da adım (geçmişten kalan yarım parça) atılır.
  while (l.length > 1 && !sabit.has(l[0]) && !(!l[0].adim && istekMi(l[0].mesajlar[0]))) dus(0);
  return l.flatMap((x) => x.mesajlar);
}

// ── Araç sırası (R4, B36) ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** MCP aracının servisi (grup 'mcp'); MCP aracı değilse null. Ad yoksa araç adından (`mcp__<servis>__<araç>`). */
export function mcpServisi(a: Arac): { ad: string; katalog: boolean } | null {
  if (a.grup !== 'mcp') return null;
  const ad = a.mcp?.servis || /^mcpg?__(.+?)__/.exec(a.tanim.ad)?.[1]?.replace(/_/g, ' ') || 'MCP';
  return { ad, katalog: a.mcp?.katalog === true };
}

/** Sıra: çekirdek araçlar (MCP dışı her şey; `mcp_kullan` dahil) hep ve önce; sonra `oncelikli` servisler (bu turda modelin açtıkları), sonra bağlı
 *  katalog servisleri, sonra Developer'ın kendi (stdio/http) sunucuları — her biri ilk görünüş sırasıyla. Servis bölünmez: sınıra sığmayan servis
 *  `disarida`ya adıyla düşer (sonraki küçük servis yine denenir). Aynı adlı araç bir kez gider. Çekirdek sınırı tek başına aşarsa yine hepsi gider
 *  (sağlayıcı açık hatayla durur; çekirdek araç düşmez). 0.14 T16 (T7 devri): sayı sınırının yanında sunucunun metin kataloğu tavanı
 *  (`katalogSiniri`, ARAC_ISTEK_SINIRI.katalog; sunucunun saydığı gibi: aracKataloguUzunlugu) da uygulanır; yalnız boyu yüzünden dışarıda kalan servisler
 *  `buyuk`ta da (notlar nedenini söyler). Tembel açıcı (`mcp_kullan` → dongu.ts araclariAc) aynı işlevi kullanır: iki tavanı da aşmaz. */
export function araclariSirala(
  araclar: readonly Arac[], sinir: number, oncelikli: ReadonlySet<string> = new Set(), katalogSiniri: number = ARAC_ISTEK_SINIRI.katalog,
): { gidenler: Arac[]; disarida: string[]; buyuk: string[] } {
  const adlar = new Set<string>();
  const cekirdek: Arac[] = [];
  const servisler = new Map<string, { katalog: boolean; araclar: Arac[] }>();
  for (const a of araclar) {
    if (adlar.has(a.tanim.ad)) continue;
    adlar.add(a.tanim.ad);
    const s = mcpServisi(a);
    if (!s) { cekirdek.push(a); continue; }
    const v = servisler.get(s.ad) ?? { katalog: false, araclar: [] };
    v.katalog = v.katalog || s.katalog;
    v.araclar.push(a);
    servisler.set(s.ad, v);
  }
  const derece = (ad: string, katalog: boolean): number => (oncelikli.has(ad) ? 0 : katalog ? 1 : 2);
  const sirali = [...servisler.entries()].map(([ad, v], i) => ({ ad, v, i })).sort((x, y) => derece(x.ad, x.v.katalog) - derece(y.ad, y.v.katalog) || x.i - y.i);
  const blok = (a: Arac) => aracBlokUzunlugu({ name: a.tanim.ad, description: a.tanim.aciklama, parameters: a.tanim.sema });
  const gidenler = [...cekirdek];
  let bloklar = cekirdek.reduce((t, a) => t + blok(a), 0);
  const disarida: string[] = [];
  const buyuk: string[] = [];
  for (const { ad, v } of sirali) {
    const ek = v.araclar.reduce((t, a) => t + blok(a), 0);
    const sayiSigar = gidenler.length + v.araclar.length <= sinir;
    const boySigar = katalogBoyu(gidenler.length + v.araclar.length, bloklar + ek) <= katalogSiniri;
    if (sayiSigar && boySigar) { gidenler.push(...v.araclar); bloklar += ek; continue; }
    disarida.push(ad);
    if (sayiSigar) buyuk.push(ad);
  }
  return { gidenler, disarida, buyuk };
}

/** ARAÇ NOTLARI'nın bağlı servisler (MCP) satırı — tek satır: taşma yoksa genel kullanım, varsa dışarıda kalan servisler ve "mcp_kullan ile aç" (B36).
 *  Satır yalnız taşma olunca değişir (istem önbelleği). */
export const mcpNotu = (disarida: readonly string[], sinir: number = ARAC_ISTEK_SINIRI.arac): string => (disarida.length
  ? `- Bağlı servisler (MCP): araçları listede; ${disarida.join(', ')} araç sınırı (${sinir}) yüzünden listede yok: gerekince mcp_kullan ile aç.`
  : '- Bağlı servisler (MCP): araçları listede; listede olmayan bir servis için mcp_kullan.');
/** Kullanıcıya giden tek satır (sohbette not; aynı durum için bir kez). `buyuk` (0.14 T16): hepsi araç sayısı yüzünden değil, araçlarının toplam boyu
 *  yüzünden dışarıdaysa cümle boyu söyler. */
export const aracSiniriNotu = (disarida: readonly string[], sinir: number = ARAC_ISTEK_SINIRI.arac, buyuk: readonly string[] = []): string =>
  (buyuk.length && disarida.every((x) => buyuk.includes(x))
    ? `Bağlı servislerin araçları bir istekte verilebilecek boyu aşıyor; ${disarida.join(', ')} gerektiğinde açılacak.`
    : `Bağlı servislerin araç sayısı bir istekte verilebilecek sınırı (${sinir}) aşıyor; ${disarida.join(', ')} gerektiğinde açılacak.`);
/** Model bir servisi tur ortasında açınca sonucuna eklenen not: yer açmak için kapanan ya da sığmadığı için açılamayan servisler (sessiz düşme yok).
 *  `buyuk` (0.14 T16): araç sayısı değil araç kataloğunun boyu yüzünden açılamayanlar. */
export function acilisNotu(o: { kapanan: readonly string[]; acilamayan: readonly string[]; buyuk?: readonly string[] }, sinir: number = ARAC_ISTEK_SINIRI.arac): string {
  const s: string[] = [];
  const boy = o.acilamayan.filter((x) => o.buyuk?.includes(x));
  const sayi = o.acilamayan.filter((x) => !o.buyuk?.includes(x));
  if (sayi.length) s.push(`Araç sınırı (${sinir}) yüzünden açılamadı: ${sayi.join(', ')} (araç sayısı sınırı aşıyor).`);
  if (boy.length) s.push(`Açılamadı: ${boy.join(', ')} (araç kataloğu bir istek için çok büyük).`);
  if (o.kapanan.length) s.push(`Araç sınırı (${sinir}) yüzünden yer açmak için bu turda kapandı: ${o.kapanan.join(', ')} (gerekirse mcp_kullan ile yeniden aç).`);
  return s.join(' ');
}

// ── Tavan ve "Devam et" (R24) ───────────────────────────────────────────────────────────────────────────────────────────────────
/** Tavan notu (sabit; model çağrılmaz). */
export function tavanMetni(adim: number, sonEtiketler: readonly string[]): string {
  const son = sonEtiketler.map((e) => e.replace(/[.\s]+$/, '')).filter(Boolean);
  // 11 Kas (iş izi işi, bulgu 7): iç sınır sayısı (`adim`) kullanıcı metnine yazılmaz; imza aynı kalır.
  void adim;
  return `Uzun bir işti, burada durdum. ${son.length ? `Son yaptıklarım: ${son.join(', ')}. ` : ''}Kaldığım yerden sürdürmek için Devam et'e bas.`;
}

/** İletilerdeki son `n` araç çağrısının etiketi, eskiden yeniye. */
export function sonAdimEtiketleri(mesajlar: readonly { bloklar: readonly Blok[] }[], n: number, etiket: (ad: string, girdi: Record<string, unknown>) => string): string[] {
  const out: string[] = [];
  for (let i = mesajlar.length - 1; i >= 0 && out.length < n; i--) {
    const cagrilar = mesajlar[i].bloklar.filter((b): b is Extract<Blok, { tur: 'arac_cagri' }> => b.tur === 'arac_cagri');
    for (let k = cagrilar.length - 1; k >= 0 && out.length < n; k--) out.unshift(etiket(cagrilar[k].ad, cagrilar[k].girdi));
  }
  return out;
}

/** "Devam et" turu mu: metin tam DEVAM_METNI ve son kullanıcı iletisinden sonra bir tavan notu var (araç sonuçları ve iç notlar sayılmaz). */
export function devamMi(metin: string, onceki: readonly { rol: string; kaynak?: string }[]): boolean {
  if (metin.trim() !== DEVAM_METNI) return false;
  for (let i = onceki.length - 1; i >= 0; i--) {
    const m = onceki[i];
    if (m.rol === 'not' && m.kaynak === TAVAN_NOTU_KAYNAGI) return true;
    if (m.rol === 'user' && m.kaynak !== 'arac') return false;
  }
  return false;
}

/** "Devam et" zincirinin asıl isteği (düzeltme turu 1): kullanıcı sözleri ve kendiliğinden turların tetikleri YENİDEN ESKİYE verilir; "Devam et" turları
 *  atlanır, ilk gerçek kullanıcı sözü asıl istektir. Zincir kendiliğinden bir turla (iç talimat) başladıysa, bulut turunda Gizli bölümün sözüne
 *  geldiyse ya da söz metinsizse null (bağlama istek yazılmaz; iç talimat ve Gizli söz buluta gitmez). Özetlenmiş bölümdeki söz de bulunur. */
export function asilIstekBul<T extends { rol: string; kaynak?: string; metin: string; gizli?: boolean }>(sozler: readonly T[], bulut: boolean): T | null {
  for (const m of sozler) {
    if (m.rol !== 'user') return null;
    if (m.metin.trim() === DEVAM_METNI) continue;
    if (bulut && m.gizli) return null;
    return m.metin.trim() ? m : null;
  }
  return null;
}

/** Asıl istek kendi sınırıyla (ASIL_ISTEK_SINIRI) kısalır; kısalınca sonuna not düşer. */
export function asilIstekKisalt(metin: string, sinir = ASIL_ISTEK_SINIRI): string {
  const t = metin.trim();
  return t.length <= sinir ? t : `${t.slice(0, sinir)}… (istek kısaltıldı: ${binlik(sinir)} / ${binlik(t.length)} karakter)`;
}

/** "Devam et" turunun bağlam satırları (<baglam> içinde; kayıtta görünmez): zincirin asıl isteği (kayıt ne kadar kırpılırsa kırpılsın, sunucu sürümünden
 *  bağımsız: turun isteği her istekte kalır) ve son adımların etiketi. */
export const devamBaglami = (etiketler: readonly string[], asilIstek?: string | null): string => [
  `Önceki tur adım sınırında (${AZAMI_ADIM}) durdu; kullanıcı kaldığın yerden sürdürmeni istiyor. Bitmiş adımları yineleme.`,
  asilIstek ? `Asıl istek: ${asilIstekKisalt(asilIstek)}` : '',
  etiketler.length ? `Son ${etiketler.length} adım: ${etiketler.join(', ')}.` : '',
].filter(Boolean).join('\n');
