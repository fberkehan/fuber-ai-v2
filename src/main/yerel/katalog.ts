// ── Yerel model kataloğu (0.13 G): liste sunucudan gelir, önbelleğe alınır; sunucu yoksa üç Bonsai ──────────────────────────────────────────
// Açık kaynaklı modeller Hugging Face'ten çekilir; kişi hangi modeli istiyorsa onu kullanabilir, modeller katalogda açılıp
// kapatılabilir. Fuber Yönetim yazar (T3), burası okur; bütün okuyucular `katalogBul`/`katalogListe`'den geçer, YEREL_MODELLER yalnız başlangıç listesidir.
//  · Kaynak sırası: önbellek (yollar.veri()/yerel-katalog.json) › Bonsai üçlüsü. Önbellek okunamıyorsa yok sayılır, hiç yazılmamışsa Bonsai.
//  · P14: Gizli ve "Yalnız bu bilgisayar"da katalogYenile ağa çıkmaz; hesap ya da cihaz anahtarı yoksa da çıkmaz. Liste yalnız önbellekten okunur.
//  · Arıza ile boş liste ayrıdır: 5xx, ağ hatası, eski sunucunun 404'ü, bozuk gövde önbelleğe dokunmaz. Sunucu gerçekten `{ modeller: [] }` dediyse liste boştur, Bonsai'ye dönülmez;
//    kullanıcı "Şu an sunulan model yok" görür (shared/yerel-katalog.ts KATALOG_BOS).
//  · Kapatılan model listeden kalkar, indirilmiş olan silinmez ve ÇALIŞMAYI SÜRDÜRÜR: kurulan modelin kaydı önbellekten bağımsız ayrı dosyada kalır (<yerelKok>/kurulu-modeller.json;
//    "Kaldır" onu da götürür). Önbellek bozulsa ya da liste boşalsa da seçili model açılır; kaydı `acik: false` döner, kart "Kuruldu, listeden kalktı" der. Dosyası silinmişse kayıt görünmez.
//  · Kayıtlara güvenilmez (sunucu da önbellek de): depo, dosya adı ve kimlik biçimi burada yeniden denetlenir, indirme adresi yalnız https://huggingface.co olur, yol kaçışı olmaz.
// `calistirici` kayıtta taşınır ama okunmaz: 31 Eki denemesinde standart GGUF'lar Prism çatalıyla açıldı, tek ikili yetiyor (paketler.ts).
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { ayarlar } from '../ayarlar.js';
import { yollar } from '../yollar.js';
import { YEREL_MODELLER, hfAdresi, type BonsaiAdi, type Varlik } from './paketler.js';
import { neredeYerelMi } from '../../shared/nerede.js';
import type { Calistirici, KatalogKaydi } from '../../shared/yerel-katalog-sozlesme.js';

export const yerelKok = () => process.env.FUBER_MODEL_DIZINI || path.join(app.getPath('userData'), 'yerel');
const onbellekYolu = () => path.join(yollar.veri(), 'yerel-katalog.json');
const kuruluYolu = () => path.join(yerelKok(), 'kurulu-modeller.json');

const bonsaiMi = (id: string): id is BonsaiAdi => Object.hasOwn(YEREL_MODELLER, id);

/** Üç Bonsai: sunucu yokken liste, kapatılmışsa kurulu olanın kaydı. Sunucunun 0062 göçüyle aynı değerler. */
const BONSAI_UCLUSU: readonly KatalogKaydi[] = (Object.keys(YEREL_MODELLER) as BonsaiAdi[]).map((id, i) => {
  const m = YEREL_MODELLER[id];
  return {
    id, hfRepo: new URL(m.url).pathname.split('/').slice(1, 3).join('/'), dosya: m.ad, ad: m.etiket, ozet: m.ozet, boyut: m.boyut, sha256: m.sha256, ramGB: m.ramGB,
    ...(m.vramGB !== undefined ? { vramGB: m.vramGB } : {}), lisans: 'apache-2.0', acik: true, sira: (i + 1) * 10, calistirici: 'prism',
  };
});

// ── Kayıt denetimi (barındırılan servisteki kuralların karşılığı) ──
const HF_REPO = /^[\w.-]+\/[\w.-]+$/;
const GGUF_DOSYASI = /^[\w.+-]{1,195}\.gguf$/i;
/** Yalnız küçük harf (sunucu da öyle üretir): Windows dosya adında büyük-küçük harf ayrımı yok, `Foo` ile `foo` aynı dosyaya düşerdi. */
const KIMLIK = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;
/** Diske yazılamayan ad: noktayla başlayan ad ve Windows'un ayrılmış adları (ilk noktadan önceki parçaya bakılır). */
const DISKE_YAZILAMAZ = /^(\.|(con|prn|aux|nul|com\d|lpt\d)(\.|$))/i;
const CALISTIRICILAR: readonly Calistirici[] = ['prism', 'ana'];
/** Sunucunun YEREL_SINIRI ile aynı: kart düzenini bozacak değer önbellekten de gelmesin. */
const SINIR = { ad: 60, ozet: 120, lisans: 60, ramGB: 1024, vramGB: 256, sira: 1_000_000 };
const KONTROLSUZ = /^[^\u0000-\u001f\u007f]*$/;

/** İndirme adresi yalnız https://huggingface.co olabilir (kullanıcı adı, port yok). Yönlendirmeyi Hugging Face'in CDN'i alır; dosyanın doğruluğunu SHA-256 sağlar. */
export function hfAdresiMi(u: unknown): boolean {
  if (typeof u !== 'string') return false;
  try {
    const a = new URL(u);
    return a.protocol === 'https:' && a.hostname === 'huggingface.co' && !a.port && !a.username && !a.password;
  } catch { return false; }
}

const yazi = (v: unknown, azami: number): v is string => typeof v === 'string' && v.length <= azami && KONTROLSUZ.test(v);
const tamSayi = (v: unknown, alt: number, ust: number): v is number => Number.isSafeInteger(v) && (v as number) >= alt && (v as number) <= ust;
const repoGecerli = (v: unknown): v is string => typeof v === 'string' && v.length <= 200 && HF_REPO.test(v) && !v.split('/').some((p) => /^\.+$/.test(p));

/** Ham kayıt → temiz kayıt; tek alanı bile geçersizse null. Yabancı alan taşınmaz. */
function kayitCoz(h: unknown): KatalogKaydi | null {
  if (!h || typeof h !== 'object') return null;
  const k = h as Record<string, unknown>;
  if (typeof k.id !== 'string' || !KIMLIK.test(k.id) || DISKE_YAZILAMAZ.test(k.id)) return null;
  if (!repoGecerli(k.hfRepo)) return null;
  if (typeof k.dosya !== 'string' || !GGUF_DOSYASI.test(k.dosya) || DISKE_YAZILAMAZ.test(k.dosya)) return null;
  if (!hfAdresiMi(hfAdresi(k.hfRepo, k.dosya)) || ('url' in k && !hfAdresiMi(k.url))) return null;
  const sha256 = typeof k.sha256 === 'string' ? k.sha256.toLowerCase() : '';
  if (!SHA256.test(sha256) || !tamSayi(k.boyut, 1, Number.MAX_SAFE_INTEGER) || !tamSayi(k.ramGB, 1, SINIR.ramGB) || !tamSayi(k.sira, 0, SINIR.sira)) return null;
  if (!yazi(k.ad, SINIR.ad) || !yazi(k.ozet, SINIR.ozet) || !k.ad.trim() || !k.ozet.trim()) return null;
  const lisans = k.lisans ?? '';
  if (!yazi(lisans, SINIR.lisans)) return null;
  if (k.vramGB !== undefined && k.vramGB !== null && !tamSayi(k.vramGB, 1, SINIR.vramGB)) return null;
  return {
    id: k.id, hfRepo: k.hfRepo, dosya: k.dosya, ad: k.ad, ozet: k.ozet, boyut: k.boyut, sha256, ramGB: k.ramGB, ...(tamSayi(k.vramGB, 1, SINIR.vramGB) ? { vramGB: k.vramGB } : {}),
    lisans, acik: k.acik === true, sira: k.sira,
    ...(CALISTIRICILAR.includes(k.calistirici as Calistirici) ? { calistirici: k.calistirici as Calistirici } : {}),
  };
}

/** `{ modeller: [...] }` → okunabilen kayıtlar. Biçim yanlışsa ya da dolu listenin hiçbir kaydı okunamadıysa null: arızadır, boş liste sayılmaz. */
function listeCoz(h: unknown): KatalogKaydi[] | null {
  const ham = (h as { modeller?: unknown } | null | undefined)?.modeller;
  if (!Array.isArray(ham)) return null;
  const tekil = new Map<string, KatalogKaydi>();
  for (const x of ham) { const k = kayitCoz(x); if (k && !tekil.has(k.id)) tekil.set(k.id, k); }
  return ham.length && !tekil.size ? null : [...tekil.values()].sort((a, b) => a.sira - b.sira || a.id.localeCompare(b.id));
}

// ── Disk ──
/** Dosya değişmediyse bellekten: katalogBul sık çağrılır (yerelHazirMi her model çağrısında). Okunamayan dosya null. */
const bellek = new Map<string, { imza: string; kayitlar: KatalogKaydi[] | null }>();
function dosyaOku(yol: string): KatalogKaydi[] | null {
  let imza: string;
  try { const s = fs.statSync(yol); imza = `${s.mtimeMs}:${s.size}`; } catch { return null; }
  const b = bellek.get(yol);
  if (b?.imza === imza) return b.kayitlar;
  let kayitlar: KatalogKaydi[] | null = null;
  try { kayitlar = listeCoz(JSON.parse(fs.readFileSync(yol, 'utf8'))); } catch { /* bozuk: yok sayılır */ }
  bellek.set(yol, { imza, kayitlar });
  return kayitlar;
}
/** Yazım yarıda kesilirse eski dosya sağlam kalır (geçici dosya + yeniden adlandırma). */
function dosyaYaz(yol: string, modeller: readonly KatalogKaydi[]): void {
  fs.mkdirSync(path.dirname(yol), { recursive: true });
  const gecici = `${yol}.${process.pid}.yaziliyor`;
  fs.writeFileSync(gecici, JSON.stringify({ surum: 1, modeller }));
  fs.renameSync(gecici, yol);
}

/** Modelin diskteki yeri. Bonsai eski yerinde kalır (kurulu dosya yeniden inmesin); katalog modeli kimlikle yazılır: iki depo aynı dosya adını taşıyabilir, kimlik tekildir. */
export const modelDosyaYolu = (k: Pick<KatalogKaydi, 'id' | 'dosya'>): string => path.join(yerelKok(), 'modeller', bonsaiMi(k.id) ? k.dosya : `${k.id}.gguf`);
/** Dosya inmiş ve doğrulanmış mı (indirme.ts `.dogrulandi` işareti). */
export function modelDosyasiKurulu(k: Pick<KatalogKaydi, 'id' | 'dosya'>): boolean {
  const y = modelDosyaYolu(k);
  return fs.existsSync(y) && fs.existsSync(`${y}.dogrulandi`);
}

/** Kurulu dosya kayıttakinden eski mi: işaretteki özet kayıttakiyle aynı değil (Hugging Face'te dosya değişti, katalogda yeni özetle yeniden açıldı). Eski dosya çalışmayı sürdürür, kart
 *  söyler, "Yeniden indir" yenisini getirir. Biçimi özet olmayan işaret karşılaştırılmaz. */
export function modelEskiMi(k: Pick<KatalogKaydi, 'id' | 'dosya' | 'sha256'>): boolean {
  const y = modelDosyaYolu(k);
  try {
    const isaret = fs.readFileSync(`${y}.dogrulandi`, 'utf8').trim();
    return SHA256.test(isaret) && isaret !== k.sha256 && fs.existsSync(y);
  } catch { return false; }
}

/** Kurulan modellerin kaydını günceller; değişiklik yoksa dosyaya yazmaz. */
function kurulanlaraEkle(l: readonly KatalogKaydi[]): void {
  const once = dosyaOku(kuruluYolu()) ?? [];
  const harita = new Map(once.map((k) => [k.id, k]));
  for (const k of l) harita.set(k.id, k);
  const sonra = [...harita.values()];
  if (JSON.stringify(sonra) !== JSON.stringify(once)) dosyaYaz(kuruluYolu(), sonra);
}
/** İndirme doğrulanınca: model bundan sonra katalogdan bağımsız yaşar (kurulurken kapatılsa, önbellek bozulsa da). */
export function kuruluModeliKaydet(k: KatalogKaydi): void {
  const temiz = kayitCoz(k);
  if (temiz) kurulanlaraEkle([temiz]);
}

// ── Okuma ──
const sunulanlar = (): KatalogKaydi[] => {
  const l = dosyaOku(onbellekYolu());
  return l ? l.filter((k) => k.acik) : [...BONSAI_UCLUSU];
};

/** Sunulanlar (sıralı) + listeden kalkmış ama bu bilgisayarda kurulu olanlar (`acik: false`, sonda). */
export function katalogListe(): KatalogKaydi[] {
  const acik = sunulanlar();
  const gorulen = new Set(acik.map((k) => k.id));
  const kalkan: KatalogKaydi[] = [];
  for (const k of [...(dosyaOku(kuruluYolu()) ?? []), ...BONSAI_UCLUSU]) {
    if (gorulen.has(k.id) || !modelDosyasiKurulu(k)) continue;
    gorulen.add(k.id);
    kalkan.push({ ...k, acik: false });
  }
  return [...acik, ...kalkan];
}

/** Kimlikle kayıt + indirme adresi; ne listede ne kurulu ise null. DİKKAT: `ad` kartın adıdır (KatalogKaydi), diskteki ad değil: dosya için `dosya` ve modelDosyaYolu. */
export function katalogBul(id: string): (Varlik & KatalogKaydi) | null {
  const k = katalogListe().find((x) => x.id === id);
  return k ? { ...k, url: hfAdresi(k.hfRepo, k.dosya) } : null;
}

/** Developer'ın model seçicisindeki açıklama: Bonsai'de paketler.ts'teki uzun cümle, katalog kaydında özet. */
export const katalogAciklamasi = (k: KatalogKaydi): string => (bonsaiMi(k.id) ? YEREL_MODELLER[k.id].aciklama : k.ozet);

// ── Yenileme ──
let bildir: () => void = () => undefined;
/** Liste değişince (yerel:durum yayını). */
export const katalogBildirici = (f: () => void) => { bildir = f; return () => { bildir = () => undefined; }; };

async function yenile(): Promise<void> {
  // No hosted catalog in this build: the built-in model list is the only source.
  return;
}

let suren: Promise<void> | null = null;
/** Sunucudan tazeler. Hiç fırlatmaz; aynı anda gelen çağrılar tek istek. */
export function katalogYenile(): Promise<void> {
  suren ??= yenile().catch((e) => { console.warn(`[katalog] yenilenemedi: ${(e as Error)?.message ?? e}`); }).finally(() => { suren = null; });
  return suren;
}
