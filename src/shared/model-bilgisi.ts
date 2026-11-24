// ── Model bilgisi: model seçicinin satırları ve yerel modelin bu bilgisayara uygunluğu (saf; birim testli: tests/model-bilgisi.test.ts) ──
// OpenRouter gibi sağlayıcılar eklenince açılır listeler yetersiz kalıyordu ve model seçiminde RAM gibi bilgiler yoktu;
// daha kullanışlı bir seçici gerekiyordu. Seçici (renderer/bilesenler/ModelSecici.tsx) her satırda ad, bağlam, giriş/çıkış
// fiyatı ($ / 1M token), yetenek rozetleri ve — yerel modellerde — disk, bellek, ekran kartı gereksinimiyle uygunluğu gösterir.
// Kaynaklar (ana süreç toplar: main/motor/model-listesi.ts):
//   - OpenRouter: /api/v1/models (context_length, pricing.prompt/completion $/token, architecture.input_modalities,
//     supported_parameters) → hepsi canlı.
//   - Anthropic: Models API (display_name, max_input_tokens, capabilities) canlı; fiyat YERLEŞİK tablodan ("yaklaşık").
//   - OpenAI: /models yalnız kimlik verir → sohbet modelleri süzülür; bağlam ve fiyat yerleşik tablodan ("yaklaşık").
//   - Yerel: main/yerel/paketler.ts (disk, bellek, ekran kartı) + yerelUygunluk (sistem:kontrol verisiyle).
// Yerleşik tablo YALNIZ emin olunan değerleri taşır: Anthropic 6 Eki 2026 liste fiyatları, OpenAI yayımlanmış liste fiyatları.
// Tabloda olmayan kimlik yalnız adıyla görünür (bağlam ve fiyat "—"); değer uydurulmaz.
import type { SaglayiciAdi } from './tipler.ts';
import { katla } from './ayar-arama.ts';

export type Yetenek = 'gorsel' | 'arac' | 'akil';
/** Seçicinin sekmeleri: dört bulut sağlayıcı + bu bilgisayarda çalışan yerel beyin. */
export type ModelKaynagi = SaglayiciAdi | 'yerel';

/** Yerel modelin gereksinimi. `ramGB`: işlemcide çalışması için gereken toplam bellek (model + çalışma belleği + sistem payı);
 *  `vramGB`: hızlı çalışması için ekran kartı belleği — yoksa model işlemcide de rahat çalışacak kadar hafiftir. `listedenKalkti`: katalogdan kapatıldı, kurulu olan çalışır, önerilmez. */
export interface YerelGereksinim { boyutGB: number; ramGB: number; vramGB?: number; listedenKalkti?: boolean }

export interface ModelBilgisi {
  id: string;
  ad: string;
  saglayici: ModelKaynagi;
  /** Bağlam penceresi (token). */
  baglam?: number;
  /** $ / 1M token. 0 = ücretsiz; yoksa bilinmiyor ("—"). */
  girisFiyat?: number;
  cikisFiyat?: number;
  yetenekler: Yetenek[];
  /** İnceleme I4: `gorsel` yeteneği sağlayıcının kendi bilgisinden (OpenRouter modaliteleri, Anthropic yetenekleri) — yoksa
   *  bilinmiyor sayılır ve görsel gider. */
  gorselKesin?: boolean;
  yerel?: YerelGereksinim;
  /** Modeli yapan şirket (OpenRouter'da "Anthropic", "Google"…). */
  uretici?: string;
  /** Kısa açıklama (yerel modeller). */
  aciklama?: string;
  /** Bağlam/fiyat yerleşik tablodan geldi: arayüzde "yaklaşık". */
  yaklasik?: boolean;
  /** Fiyatın koşulu (fiyat hücresinin ipucu): ör. Haiku 5.5'te "100 bin token’a kadar". */
  fiyatNotu?: string;
}

export interface ModelListesi {
  saglayici: ModelKaynagi;
  modeller: ModelBilgisi[];
  /** canli: sağlayıcıdan şimdi alındı · yerlesik: anahtar yok ya da liste alınamadı (yerleşik tablo). */
  kaynak: 'canli' | 'yerlesik';
  /** Liste alınamadı (sağlayıcının hatası; kısa Türkçe ileti): seçici "Liste alınamadı" kutusunu çizer. */
  hata?: string;
  /** Liste BİLEREK alınmadı (Gizli / "Yalnız bu bilgisayar": anahtar buluta taşınmaz) — hata değil, sakin bilgi notu (kilit simgeli satır). */
  bilgi?: string;
}

export const KAYNAK_ADI: Record<ModelKaynagi, string> = { anthropic: 'Anthropic', openai: 'OpenAI', openrouter: 'OpenRouter', yerel: 'Yerel' };
export const YETENEK_ADI: Record<Yetenek, string> = { gorsel: 'Görsel', arac: 'Araç', akil: 'Akıl yürütme' };
export const YETENEK_ACIKLAMA: Record<Yetenek, string> = {
  gorsel: 'Ekran görüntüsü ve resim okur',
  arac: 'Araç kullanır (dosya, tarayıcı, e-posta)',
  akil: 'Yanıt vermeden önce düşünür; düşünme gücü ayarlanır',
};

/** Rol başına önerilen modeller (sıra = seçicide "Önerilen" sıralamasının başı). Rolün önerileni VARSAYILAN_MODEL'dir. */
export const ONERILEN_MODELLER: Record<SaglayiciAdi, readonly string[]> = {
  anthropic: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'],
  openai: ['gpt-5.5', 'gpt-5.5-mini'],
  openrouter: ['anthropic/claude-opus-5.5', 'anthropic/claude-sonnet-5.5', 'anthropic/claude-haiku-5.5', 'openai/gpt-5.5', 'google/gemini-3-pro'],
};

// ── Yerleşik tablo ("yaklaşık") ───────────────────────────────────────────────────────────────────────────────────────
type TabloSatiri = readonly [id: string, ad: string, baglam: number | undefined, giris: number | undefined, cikis: number | undefined, yetenekler: readonly Yetenek[], aciklama?: string, fiyatNotu?: string];
const TAM: readonly Yetenek[] = ['gorsel', 'arac', 'akil'];
const GA: readonly Yetenek[] = ['gorsel', 'arac'];
const M = 1_000_000;

const TABLO: Partial<Record<SaglayiciAdi, readonly TabloSatiri[]>> = {
  // Anthropic liste fiyatları (6 Eki 2026). Haiku 5.5: 100 bin token'a kadar olan istemlerde (üstü 0,50 $ / 2,50 $).
  anthropic: [
    ['claude-opus-5-5', 'Claude Opus 5.5', M, 4, 20, TAM],
    ['claude-sonnet-5-5', 'Claude Sonnet 5.5', M, 2, 10, TAM],
    ['claude-haiku-5-5', 'Claude Haiku 5.5', M, 0.1, 0.5, TAM, undefined, '100 bin token’a kadar olan istemlerde; daha uzun istemde giriş 0,50 $, çıkış 2,50 $'],
    ['claude-fable-5-1', 'Claude Fable 5.1', M, 10, 50, TAM],
    ['claude-fable-5', 'Claude Fable 5', M, 10, 50, TAM],
    ['claude-opus-5', 'Claude Opus 5', M, 5, 25, TAM],
    ['claude-sonnet-5', 'Claude Sonnet 5', M, 2, 10, TAM],
    ['claude-opus-4-8', 'Claude Opus 4.8', M, 5, 25, TAM],
    ['claude-opus-4-7', 'Claude Opus 4.7', M, 5, 25, TAM],
    ['claude-opus-4-6', 'Claude Opus 4.6', M, 5, 25, TAM],
    ['claude-sonnet-4-6', 'Claude Sonnet 4.6', M, 3, 15, TAM],
    ['claude-haiku-4-5', 'Claude Haiku 4.5', 200_000, 1, 5, TAM],
  ],
  // OpenAI yayımlanmış liste fiyatları. GPT-5.5 ailesinin değerlerinden emin değiliz: yalnız ad.
  openai: [
    ['gpt-5.5', 'GPT-5.5', undefined, undefined, undefined, []],
    ['gpt-5.5-mini', 'GPT-5.5 mini', undefined, undefined, undefined, []],
    ['gpt-5', 'GPT-5', 400_000, 1.25, 10, TAM],
    ['gpt-5-mini', 'GPT-5 mini', 400_000, 0.25, 2, TAM],
    ['gpt-5-nano', 'GPT-5 nano', 400_000, 0.05, 0.4, TAM],
    ['gpt-4.1', 'GPT-4.1', 1_047_576, 2, 8, GA],
    ['gpt-4.1-mini', 'GPT-4.1 mini', 1_047_576, 0.4, 1.6, GA],
    ['gpt-4.1-nano', 'GPT-4.1 nano', 1_047_576, 0.1, 0.4, GA],
    ['gpt-4o', 'GPT-4o', 128_000, 2.5, 10, GA],
    ['gpt-4o-mini', 'GPT-4o mini', 128_000, 0.15, 0.6, GA],
    ['o3', 'o3', 200_000, 2, 8, TAM],
    ['o4-mini', 'o4-mini', 200_000, 1.1, 4.4, TAM],
  ],
};

/** OpenRouter kimliğinin öneki → üretici adı (adında "Üretici: " öneki olmayan kayıtlar ve yerleşik liste için). */
const URETICI: Record<string, string> = {
  anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google', 'meta-llama': 'Meta', mistralai: 'Mistral', deepseek: 'DeepSeek',
  qwen: 'Qwen', 'x-ai': 'xAI', cohere: 'Cohere', microsoft: 'Microsoft', nvidia: 'NVIDIA', amazon: 'Amazon', perplexity: 'Perplexity',
  moonshotai: 'Moonshot AI', 'z-ai': 'Z.ai', minimax: 'MiniMax', nousresearch: 'Nous', openrouter: 'OpenRouter',
};
/** Yerleşik OpenRouter listesindeki, tabloda bilgisi olmayan önerilerin adı. */
const OPENROUTER_ADI: Record<string, string> = { 'google/gemini-3-pro': 'Gemini 3 Pro' };

const satirdan = (s: ModelKaynagi, t: TabloSatiri, id = t[0]): ModelBilgisi => {
  const [, ad, baglam, giris, cikis, yetenekler, aciklama, fiyatNotu] = t;
  const m: ModelBilgisi = { id, ad, saglayici: s, yetenekler: [...yetenekler] };
  if (baglam !== undefined) m.baglam = baglam;
  if (giris !== undefined) m.girisFiyat = giris;
  if (cikis !== undefined) m.cikisFiyat = cikis;
  if (aciklama) m.aciklama = aciklama;
  if (fiyatNotu) m.fiyatNotu = fiyatNotu;
  if (baglam !== undefined || giris !== undefined) m.yaklasik = true;
  return m;
};

/** OpenAI'ın tarihli anlık sürümü (gpt-4o-2024-08-06): fiyatı ve bağlamı ana modelden farklı olabilir → yalnız ad ve yetenekler. */
const OPENAI_TARIH = /-(\d{4}-\d{2}-\d{2})$/;

/** Yerleşik tablodaki bilgi (Anthropic'in tarih ekli kimliği ana modelin bilgisini alır; OpenAI'ın tarihli sürümü yalnız ad ve
 *  yetenek alır; OpenRouter'daki Anthropic/OpenAI kimlikleri o tablodan). */
export function yerlesikBilgi(s: ModelKaynagi, id: string): ModelBilgisi | undefined {
  if (s === 'yerel') return undefined;
  if (s === 'openrouter') {
    const bol = id.indexOf('/');
    if (bol < 0 || id.endsWith(':free')) return undefined;
    const on = id.slice(0, bol);
    const kalan = id.slice(bol + 1);
    const b = on === 'anthropic' ? yerlesikBilgi('anthropic', kalan.replace(/\./g, '-')) : on === 'openai' ? yerlesikBilgi('openai', kalan) : undefined;
    return b && { ...b, id, saglayici: 'openrouter', uretici: URETICI[on] };
  }
  const tarih = s === 'openai' ? id.match(OPENAI_TARIH)?.[1] : undefined;
  const yalin = s === 'anthropic' ? id.replace(/-\d{8}$/, '') : tarih ? id.replace(OPENAI_TARIH, '') : id;
  const t = TABLO[s]?.find((x) => x[0] === yalin);
  if (!t) return undefined;
  return tarih ? { id, ad: `${t[1]} (${tarih})`, saglayici: s, yetenekler: [...t[5]] } : satirdan(s, t, id);
}

/** Anahtar yokken ya da liste alınamadığında gösterilen yerleşik liste. */
export function yerlesikListe(s: SaglayiciAdi): ModelBilgisi[] {
  if (s === 'openrouter') return ONERILEN_MODELLER.openrouter.map((id) => yerlesikBilgi('openrouter', id) ?? adliBilgi('openrouter', id));
  return (TABLO[s] ?? []).map((t) => satirdan(s, t));
}

const buyukHarf = (s: string) => s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1);
/** Tanınan kimlik deseninden okunur ad (claude-opus-4-1 → Claude Opus 4.1, gpt-5.5-mini → GPT-5.5 mini); tanınmazsa undefined. */
function desenliAd(id: string): string | undefined {
  const yalin = id.replace(/^[^/]+\//, '').replace(/:free$/, '');
  const c = yalin.match(/^claude-([a-z]+)-(\d+)(?:[-.](\d{1,2}))?(?:-\d{8})?$/);
  if (c) return `Claude ${buyukHarf(c[1])} ${c[2]}${c[3] ? `.${c[3]}` : ''}`;
  const e = yalin.match(/^claude-(\d+)(?:-(\d))?-([a-z]+)(?:-\d{8})?$/);
  if (e) return `Claude ${buyukHarf(e[3])} ${e[1]}${e[2] ? `.${e[2]}` : ''}`;
  const g = yalin.match(/^gpt-(.+)$/i);
  if (g) return `GPT-${g[1].replace(/-(mini|nano|pro|turbo)\b/g, ' $1')}`;
  return undefined;
}
/** Kimliğin okunur adı: tanınan desen, değilse sağlayıcı öneki ve ":free" atılmış kimlik. */
export function adGuzellestir(id: string): string {
  return desenliAd(id) ?? id.replace(/^[^/]+\//, '').replace(/:free$/, '');
}
/** Seçili modelin görünen adı (akordeon özeti, tetik): tablodaki ad, tanınan desen ya da kimliğin kendisi (serbest yazılmış kimlik). */
export function modelAdi(s: ModelKaynagi, id: string): string {
  return yerlesikBilgi(s, id)?.ad ?? desenliAd(id) ?? id;
}
const adliBilgi = (s: ModelKaynagi, id: string): ModelBilgisi => {
  const m: ModelBilgisi = { id, ad: (s === 'openrouter' && OPENROUTER_ADI[id]) || modelAdi(s, id), saglayici: s, yetenekler: [] };
  if (s === 'openrouter' && id.includes('/')) { const u = URETICI[id.split('/')[0]]; if (u) m.uretici = u; }
  return m;
};

/** Geçerli seçim ve önerilen kimlikler listede yoksa (serbest yazılmış kimlik, alınamayan liste) başa eklenir. */
export function listeyiTamamla(liste: ModelBilgisi[], s: ModelKaynagi, idler: readonly string[]): ModelBilgisi[] {
  const var_ = new Set(liste.map((m) => m.id));
  const ek: ModelBilgisi[] = [];
  for (const id of idler) {
    if (!id || var_.has(id)) continue;
    var_.add(id);
    ek.push(yerlesikBilgi(s, id) ?? adliBilgi(s, id));
  }
  return ek.length ? [...ek, ...liste] : liste;
}

// ── Sağlayıcı yanıtlarının dönüşümü ───────────────────────────────────────────────────────────────────────────────────
const dizi = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const nesneler = (ham: unknown): Record<string, unknown>[] => {
  const l = Array.isArray(ham) ? ham : Array.isArray((ham as { data?: unknown } | null)?.data) ? (ham as { data: unknown[] }).data : [];
  return l.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object');
};
const pozitif = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
/** OpenRouter fiyatı ($ / token, metin) → $ / 1M token; negatif ("-1": değişken) ve okunamayan değer bilinmiyor. */
function milyonda(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() ? Number(v) : typeof v === 'number' ? v : Number.NaN;
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 1e6 * 1e4) / 1e4; // kayan nokta gürültüsü: 0,15000000000000002 → 0,15
}

/** OpenRouter /api/v1/models yanıtı (ya da `data` dizisi) → satırlar. Yalnız görsel/ses üreten modeller sohbet için değil: atlanır. */
export function openRouterDonustur(ham: unknown): ModelBilgisi[] {
  const out: ModelBilgisi[] = [];
  for (const x of nesneler(ham)) {
    const id = typeof x.id === 'string' ? x.id.trim() : '';
    if (!id) continue;
    const mimari = (x.architecture ?? {}) as Record<string, unknown>;
    const cikis = dizi(mimari.output_modalities);
    if (cikis.length && !cikis.includes('text')) continue;
    const modalite = typeof mimari.modality === 'string' ? mimari.modality : '';
    const giris = dizi(mimari.input_modalities);
    const param = dizi(x.supported_parameters);
    const yetenekler: Yetenek[] = [];
    if (giris.includes('image') || modalite.split('->')[0].includes('image')) yetenekler.push('gorsel');
    if (param.includes('tools')) yetenekler.push('arac');
    if (param.includes('reasoning') || param.includes('include_reasoning')) yetenekler.push('akil');
    const tamAd = typeof x.name === 'string' && x.name.trim() ? x.name.trim() : adGuzellestir(id);
    const onekli = tamAd.match(/^([^:]{1,40}):\s+(.+)$/);
    const fiyat = (x.pricing ?? {}) as Record<string, unknown>;
    const m: ModelBilgisi = { id, ad: onekli ? onekli[2] : tamAd, saglayici: 'openrouter', yetenekler, gorselKesin: true };
    const uretici = onekli?.[1] ?? URETICI[id.split('/')[0]];
    if (uretici) m.uretici = uretici;
    const baglam = pozitif(x.context_length);
    if (baglam) m.baglam = baglam;
    const gf = milyonda(fiyat.prompt), cf = milyonda(fiyat.completion);
    if (gf !== undefined) m.girisFiyat = gf;
    if (cf !== undefined) m.cikisFiyat = cf;
    out.push(m);
  }
  return out;
}

/** Anthropic Models API listesi → satırlar. Bağlam ve yetenekler canlı; fiyat yerleşik tablodan; araç kullanımı bütün Claude
 *  modellerinde var. Emekli model atlanır: kurulu SDK'nın ModelInfo tipinde `lifecycle: 'active' | 'deprecated' | 'retired'` var
 *  (@anthropic-ai/sdk resources/models.d.ts) ve emekli model "tarihsel kayıt olarak katalogda kalır", istekte hata verir. */
export function anthropicDonustur(ham: unknown): ModelBilgisi[] {
  const out: ModelBilgisi[] = [];
  for (const x of nesneler(ham)) {
    const id = typeof x.id === 'string' ? x.id.trim() : '';
    if (!id || x.lifecycle === 'retired') continue;
    const t = yerlesikBilgi('anthropic', id);
    const yet = x.capabilities as { image_input?: { supported?: boolean }; thinking?: { supported?: boolean } } | null | undefined;
    const yetenekler: Yetenek[] = yet
      ? [...(yet.image_input?.supported ? ['gorsel' as const] : []), 'arac', ...(yet.thinking?.supported ? ['akil' as const] : [])]
      : [...(t?.yetenekler ?? [])];
    const m: ModelBilgisi = { id, ad: (typeof x.display_name === 'string' && x.display_name.trim()) || t?.ad || adGuzellestir(id), saglayici: 'anthropic', yetenekler, ...(yet ? { gorselKesin: true } : {}) };
    const baglam = pozitif(x.max_input_tokens) ?? t?.baglam;
    if (baglam) m.baglam = baglam;
    if (t?.girisFiyat !== undefined) { m.girisFiyat = t.girisFiyat; m.cikisFiyat = t.cikisFiyat; m.yaklasik = true; }
    if (t?.fiyatNotu) m.fiyatNotu = t.fiyatNotu;
    out.push(m);
  }
  return out;
}

const OPENAI_SOHBET = /^(gpt-|o\d|chatgpt-)/;
/** Sohbet tamamlama (Chat Completions) ile kullanılmayanlar: gömme, ses, görsel, arama, Responses'a özel (pro, codex) modeller. */
const OPENAI_DISI = /(embedding|whisper|tts|dall-e|audio|realtime|transcribe|image|moderation|search|instruct|codex|computer-use|sora|(^|-)pro($|-))/;
/** OpenAI /models (kimlikler ya da {data:[{id}]}) → yalnız sohbet modelleri, bilgi yerleşik tablodan. Tarihli sürüm adına tarihi
 *  alır, fiyatı ve bağlamı ana modelden MİRAS ALMAZ ("—"; anlık sürümün fiyatı farklı olabilir). */
export function openaiDonustur(ham: unknown): ModelBilgisi[] {
  const idler = (Array.isArray(ham) && ham.every((x) => typeof x === 'string') ? (ham as string[]) : nesneler(ham).map((x) => (typeof x.id === 'string' ? x.id : '')))
    .map((x) => x.trim()).filter((x) => x && OPENAI_SOHBET.test(x) && !OPENAI_DISI.test(x));
  return [...new Set(idler)].map((id) => yerlesikBilgi('openai', id) ?? adliBilgi('openai', id));
}

// ── Çağrı maliyeti (Kullanım sayfası, K5) ──────────────────────────────────────────────────────────────────────────────
/** $ / 1M token, giriş ve çıkış. */
export interface Fiyat { giris: number; cikis: number }
/** Bir çağrının (ya da toplanmış çağrıların) token sayıları; önbellek alanları Anthropic'in sayımıdır (OpenAI uyumlularda okuma girişin içindedir). */
export interface Tokenler { giris: number; cikis: number; onbellekOkuma?: number; onbellekYazma?: number }

/**
 * Kaydedilen bir çağrının fiyatı: bu bilgisayardaki yerel beyin ve OpenRouter ":free" modelleri ücretsizdir (0 — bilinen); kalanı
 * yerleşik tablodan (Anthropic, OpenAI, OpenRouter'daki Anthropic/OpenAI kimlikleri) ya da çağıranın verdiği canlı listeden (OpenRouter
 * /models, `canli`). Bilinmeyen kimlik → undefined (arayüz "—" yazar; 0 YAZILMAZ).
 */
export function modelFiyati(s: string, id: string, canli?: Pick<ModelBilgisi, 'girisFiyat' | 'cikisFiyat'>): Fiyat | undefined {
  if (s === 'yerel') return { giris: 0, cikis: 0 };
  if (s === 'openrouter' && /:free$/.test(id)) return { giris: 0, cikis: 0 };
  const tam = (b?: Pick<ModelBilgisi, 'girisFiyat' | 'cikisFiyat'>): Fiyat | undefined =>
    b && b.girisFiyat !== undefined && b.cikisFiyat !== undefined && Number.isFinite(b.girisFiyat) && Number.isFinite(b.cikisFiyat) ? { giris: b.girisFiyat, cikis: b.cikisFiyat } : undefined;
  if (s !== 'anthropic' && s !== 'openai' && s !== 'openrouter') return undefined;
  return tam(canli) ?? tam(yerlesikBilgi(s, s === 'anthropic' ? id.replace(/^anthropic\//, '') : id));
}

/**
 * Yaklaşık maliyet ($). Anthropic girişi önbellek dışıdır: önbelleğe yazma 1,25×, önbellekten okuma 0,1× giriş fiyatı. OpenAI uyumlu
 * sağlayıcılarda (OpenAI, OpenRouter, yerel) önbellekten okunan zaten girişin içinde sayılır: giriş olduğu gibi (indirim yok sayılır →
 * üst sınır; arayüz "yaklaşık" der).
 */
export function cagriMaliyeti(s: string, f: Fiyat, k: Tokenler): number {
  const giris = s === 'anthropic' ? k.giris + (k.onbellekYazma ?? 0) * 1.25 + (k.onbellekOkuma ?? 0) * 0.1 : k.giris;
  return (giris * f.giris + k.cikis * f.cikis) / 1_000_000;
}

// ── Biçimler ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** 200 bin · 1 milyon · 1,5 milyon; bilinmiyorsa "—". */
export function baglamMetni(n?: number): string {
  if (!n || !Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1e6) return `${(n / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} milyon`;
  if (n >= 1000) return `${Math.round(n / 1000).toLocaleString('tr-TR')} bin`;
  return n.toLocaleString('tr-TR');
}
/** $ / 1M token: 4 · 2,50 · 0,15 · 0,038; 0 "Ücretsiz"; bilinmiyorsa "—". */
export function fiyatMetni(n?: number): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  if (n === 0) return 'Ücretsiz';
  return n.toLocaleString('tr-TR', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: n < 0.1 ? 3 : 2 });
}
/** 7,2 GB · 16 GB (on ve üstünde ondalık yok). */
export const gbMetni = (n: number) => `${n.toLocaleString('tr-TR', { maximumFractionDigits: n >= 10 ? 0 : 1 })} GB`;

// ── Arama, süzme, sıralama ───────────────────────────────────────────────────────────────────────────────────────────
/** Ad, kimlik, üretici ve açıklamada arar (harf katlamalı; her sözcük bir yerde eşleşmeli). Puan: adın başı > ad sözcüğünün başı >
 *  başka yer; eşit puanda gelen sıra korunur. */
export function modelAra(liste: readonly ModelBilgisi[], sorgu: string): ModelBilgisi[] {
  const sozler = katla(sorgu).split(' ').filter(Boolean);
  if (!sozler.length) return [...liste];
  const puanli: { m: ModelBilgisi; p: number; i: number }[] = [];
  liste.forEach((m, i) => {
    const ad = katla(m.ad).trim();
    const tum = katla(`${m.ad} ${m.id} ${m.uretici ?? ''} ${m.aciklama ?? ''}`);
    let p = 0;
    for (const s of sozler) {
      if (!tum.includes(s)) return;
      p += ad.startsWith(s) ? 3 : ` ${ad}`.includes(` ${s}`) ? 2 : 1;
    }
    puanli.push({ m, p, i });
  });
  return puanli.sort((a, b) => b.p - a.p || a.i - b.i).map((x) => x.m);
}

export interface ModelSuzgeci { gorsel?: boolean; arac?: boolean; akil?: boolean; ucretsiz?: boolean }
export function modelleriSuz(liste: readonly ModelBilgisi[], s: ModelSuzgeci): ModelBilgisi[] {
  return liste.filter((m) => (!s.gorsel || m.yetenekler.includes('gorsel')) && (!s.arac || m.yetenekler.includes('arac'))
    && (!s.akil || m.yetenekler.includes('akil')) && (!s.ucretsiz || (m.girisFiyat === 0 && m.cikisFiyat === 0)));
}

export type ModelSirasi = 'onerilen' | 'ad' | 'fiyat' | 'baglam';
/** onerilen: önerilenler verilen sırayla başta, kalanı gelen sırada (sağlayıcının sırası: en yeni önce) · ad: alfabetik (Türkçe) ·
 *  fiyat: giriş fiyatı ucuzdan (bilinmeyen sonda) · baglam: büyükten (bilinmeyen sonda). */
export function modelleriSirala(liste: readonly ModelBilgisi[], sira: ModelSirasi, oneriler: readonly string[]): ModelBilgisi[] {
  const l = liste.map((m, i) => ({ m, i }));
  const adla = (a: ModelBilgisi, b: ModelBilgisi) => a.ad.localeCompare(b.ad, 'tr');
  const sonsuz = (n?: number) => n ?? Number.POSITIVE_INFINITY;
  if (sira === 'ad') l.sort((a, b) => adla(a.m, b.m) || a.i - b.i);
  else if (sira === 'fiyat') l.sort((a, b) => sonsuz(a.m.girisFiyat) - sonsuz(b.m.girisFiyat) || sonsuz(a.m.cikisFiyat) - sonsuz(b.m.cikisFiyat) || adla(a.m, b.m));
  else if (sira === 'baglam') l.sort((a, b) => (b.m.baglam ?? -1) - (a.m.baglam ?? -1) || adla(a.m, b.m));
  else {
    const sira_ = (m: ModelBilgisi) => { const k = oneriler.indexOf(m.id); return k < 0 ? Number.POSITIVE_INFINITY : k; };
    l.sort((a, b) => sira_(a.m) - sira_(b.m) || a.i - b.i);
  }
  return l.map((x) => x.m);
}

// ── Yerel model: bu bilgisayara uygunluk ─────────────────────────────────────────────────────────────────────────────
export type Uygunluk = 'rahat' | 'zorlanir' | 'calismaz';
export const UYGUNLUK_ADI: Record<Uygunluk, string> = { rahat: 'Rahat çalışır', zorlanir: 'Zorlanır', calismaz: 'Çalışmaz' };
/** Bilgisayar (sistem:kontrol): bellek, yerel beynin KULLANABİLECEĞİ NVIDIA ekran kartı var mı, ekran kartı belleği (okunamadıysa
 *  yok), boş disk (ölçülemediyse NaN). `ekranKartiKapali`: kart var ama yerel beyin kullanamıyor ("Yalnız işlemci" seçili ya da
 *  ekran kartı sürümü kurulu değil) — `nvidia` o zaman false'tur; neden metni buna göre yazılır. Ham bilgiden: yerelMakinesi. */
export interface Makine { ramGB: number; nvidia: boolean; vramGB?: number; bosDiskGB?: number; ekranKartiKapali?: 'islemci' | 'cuda' }
/** Kurulum için model dosyasının yanında gereken pay (çalıştırıcı + geçici dosya). */
export const KURULUM_PAYI_GB = 1;

/**
 * sistem:kontrol bilgisi + yerel beynin durumu → uygunluk girdisi. Ekran kartı yalnız gerçekten kullanılabilirse sayılır: Ayarlar'da
 * "Yalnız işlemci" seçiliyse sunucu -ngl 0 ile açılır; çalıştırıcı işlemci sürümüyle kuruluysa (CUDA yok) kart kullanılamaz. Henüz
 * hiçbir şey kurulu değilse kurulum NVIDIA varken ekran kartı sürümünü indirir (kurulum.ts) → kart sayılır.
 */
export function yerelMakinesi(b: Makine, y: { gpu: 'otomatik' | 'cpu'; calistiriciKurulu: boolean; cuda: boolean }): Makine {
  const kapali = !b.nvidia ? undefined : y.gpu === 'cpu' ? 'islemci' as const : y.calistiriciKurulu && !y.cuda ? 'cuda' as const : undefined;
  const m: Makine = { ramGB: b.ramGB, nvidia: b.nvidia && !kapali };
  if (b.vramGB !== undefined) m.vramGB = b.vramGB;
  if (b.bosDiskGB !== undefined) m.bosDiskGB = b.bosDiskGB;
  if (kapali) m.ekranKartiKapali = kapali;
  return m;
}

/**
 * Yerel model bu bilgisayarda nasıl çalışır?
 *  1. Kurulu değil ve diskte (model + kurulum payı) yer yok → Çalışmaz.
 *  2. NVIDIA ekran kartının belleği `vramGB`'ye yetiyor → Rahat çalışır (model ekran kartında; sistem belleği belirleyici değil).
 *  3. Sistem belleği `ramGB`'nin altında → Çalışmaz (ekran kartına da sığmıyor).
 *  4. Model ekran kartı istemiyor (`vramGB` yok) → Rahat çalışır (işlemcide).
 *  5. Aksi hâlde Zorlanır: belleğe sığar ama işlemcide yavaş çalışır (ekran kartı yok, belleği az ya da okunamadı).
 */
export function yerelUygunluk(g: YerelGereksinim, m: Makine, o: { kurulu?: boolean } = {}): { durum: Uygunluk; neden: string } {
  const disk = g.boyutGB + KURULUM_PAYI_GB;
  if (!o.kurulu && m.bosDiskGB !== undefined && Number.isFinite(m.bosDiskGB) && m.bosDiskGB < disk) {
    return { durum: 'calismaz', neden: `Diskte ${gbMetni(disk)} boş yer gerekir` };
  }
  if (g.vramGB !== undefined && m.nvidia && m.vramGB !== undefined && m.vramGB >= g.vramGB) return { durum: 'rahat', neden: 'Ekran kartında hızlı çalışır' };
  if (m.ramGB < g.ramGB) {
    return { durum: 'calismaz', neden: g.vramGB !== undefined ? `En az ${gbMetni(g.ramGB)} bellek ya da ${gbMetni(g.vramGB)} ekran kartı gerekir` : `En az ${gbMetni(g.ramGB)} bellek gerekir` };
  }
  if (g.vramGB === undefined) return { durum: 'rahat', neden: 'Ekran kartı gerekmez; işlemcide de rahat çalışır' };
  if (m.ekranKartiKapali === 'islemci') return { durum: 'zorlanir', neden: '“Yalnız işlemci” seçili; işlemcide yavaş çalışır' };
  if (m.ekranKartiKapali === 'cuda') return { durum: 'zorlanir', neden: 'Ekran kartı sürümü kurulu değil; işlemcide yavaş çalışır' };
  // 0.10 Görev 3: neden İş'te de görünür (sihirbaz, sistem satırı) — marka adı yok; Geliştirici kartın adını model seçicide görür.
  if (!m.nvidia) return { durum: 'zorlanir', neden: 'Uygun ekran kartı yok; işlemcide yavaş çalışır' };
  if (m.vramGB === undefined) return { durum: 'zorlanir', neden: 'Ekran kartı belleği okunamadı; işlemcide yavaş çalışabilir' };
  return { durum: 'zorlanir', neden: `Ekran kartı belleği yetmez (${gbMetni(m.vramGB)}); işlemcide yavaş çalışır` };
}

/** Bu bilgisayar için önerilen yerel model: büyükten küçüğe rahat çalışan ilk model; yoksa zorlanan en hafifi; hiçbiri uymuyorsa yok (arayüz "Önerilen" göstermez). Disk de
 *  sayılır: kurulu olmayan modelin dosyası diske sığmalı (`kuruluMu`). 0.13 G: liste katalogdaki sırayla gelir, burada boyuta göre sıralanır; listeden kalkan önerilmez. */
export function onerilenYerel(liste: readonly ModelBilgisi[], m: Makine, kuruluMu: (id: string) => boolean = () => false): string | undefined {
  const durum = (x: ModelBilgisi) => (x.yerel ? yerelUygunluk(x.yerel, m, { kurulu: kuruluMu(x.id) }).durum : 'calismaz');
  const l = liste.filter((x) => !x.yerel?.listedenKalkti).sort((a, b) => (b.yerel?.boyutGB ?? 0) - (a.yerel?.boyutGB ?? 0));
  return l.find((x) => durum(x) === 'rahat')?.id ?? [...l].reverse().find((x) => durum(x) === 'zorlanir')?.id;
}

/** Bu bilgisayarın en iyi yerel seçeneği (kurulum sihirbazı: Sistem satırı ve "Ekstra gizlilik" adımı): önerilen model ve uygunluğu;
 *  hiçbiri uymuyorsa `id` yok ve neden en hafif modelinki (en az istenen: "En az 6 GB bellek gerekir"). Liste boşsa undefined. */
export function enIyiYerel(liste: readonly ModelBilgisi[], m: Makine, kuruluMu: (id: string) => boolean = () => false): { id?: string; durum: Uygunluk; neden: string } | undefined {
  const uy = (x: ModelBilgisi) => (x.yerel ? yerelUygunluk(x.yerel, m, { kurulu: kuruluMu(x.id) }) : { durum: 'calismaz' as const, neden: 'Gereksinim bilinmiyor' });
  const id = onerilenYerel(liste, m, kuruluMu);
  const secilen = id ? liste.find((x) => x.id === id) : undefined;
  if (secilen) return { id: secilen.id, ...uy(secilen) };
  const hafif = [...liste].filter((x) => x.yerel).sort((a, b) => a.yerel!.ramGB - b.yerel!.ramGB || a.yerel!.boyutGB - b.yerel!.boyutGB)[0];
  return hafif ? { durum: 'calismaz', neden: uy(hafif).neden } : undefined;
}

/** Model listesi alınamadı: sağlayıcının hata türüne göre kısa Türkçe ileti (ham İngilizce hata metni arayüze çıkmaz). Girdi SDK
 *  hatası (status, name), MotorHatasi (kod) ya da fetch hatası (TypeError: fetch failed) olabilir. */
export function listeHatasiMetni(e: unknown): string {
  const o = (e && typeof e === 'object' ? e : {}) as { status?: unknown; kod?: unknown; name?: unknown; message?: unknown; cause?: unknown };
  const status = typeof o.status === 'number' ? o.status : undefined;
  const kod = typeof o.kod === 'string' ? o.kod : undefined;
  const ad = typeof o.name === 'string' ? o.name : '';
  const mesaj = `${typeof o.message === 'string' ? o.message : ''} ${String((o.cause as { code?: unknown } | undefined)?.code ?? '')}`;
  if (kod === 'anahtar' || status === 401 || status === 403) return 'Anahtar geçersiz ya da yetkisiz.';
  if (status === 402) return 'Kredi yetersiz.';
  if (kod === 'limit' || status === 429) return 'Hız sınırına takıldı; biraz sonra yeniden dene.';
  if (status === 404) return 'Liste adresi bulunamadı; taban adresini denetle.';
  if (status !== undefined && status >= 500) return 'Sağlayıcı şu an yanıt vermiyor.';
  if (kod === 'baglanti' || /Connection|Timeout|Abort/i.test(ad) || /fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network/i.test(mesaj)) return 'Bağlantı kurulamadı.';
  return 'Liste alınamadı.';
}
