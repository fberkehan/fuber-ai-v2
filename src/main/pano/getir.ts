// ── Pano ağ katmanı (Görev 24): zaman aşımlı, kimliği belli, boyutu sınırlı istekler ─────────────────────────────────────────
// Yalnız ANA SÜREÇ çağırır (arayüz ağa çıkmaz). `getir` dışarıdan verilir: uygulamada Electron'un net.fetch'i (sistem vekil sunucusuna
// uyar), testlerde düz fetch + yerel sahte sunucu. MET Norway koşulları: tanımlayıcı User-Agent (uygulama + iletişim adresi), Expires'a
// kadar yeniden sorma, If-Modified-Since, koordinat en çok 4 ondalık (biz 2), sıkıştırma. Electron'suz: tests/pano-motoru.test.ts.
// Boyut sınırı gövde AKARKEN uygulanır (düzeltme turu 1): yanıt baştan belleğe alınmaz; sınır aşılınca okuma kesilir. Sıkıştırmayı
// getirici açtığı için sınır AÇILMIŞ bayta uygulanır (gzip bombası da durur); Content-Length'siz (chunked) yanıt da.
export type Getirici = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;
export interface GetirSecenegi { getir: Getirici; ua: string; zamanAsimiMs?: number; enCokBayt?: number }

export const EN_COK_BAYT = 3_000_000;
export const ZAMAN_ASIMI_MS = 8000;

export class BoyutHatasi extends Error {
  constructor() { super('yanıt çok büyük'); this.name = 'BoyutHatasi'; }
}

/** Yanıt + isteği kesen işlev: sınır aşılınca gövdeyi iptal etmek yetmez (Electron net.fetch'te istek zaman aşımına dek sürer; Görev 23,
 *  G24 küçüğü) — isteğin kendi sinyali de kesilir (AbortSignal.any: zaman aşımı YA DA biz). */
const kesiciler = new WeakMap<Response, () => void>();

async function istek(o: GetirSecenegi, url: string, ek: Record<string, string> = {}): Promise<Response> {
  // Accept-Encoding elle yazılmaz: net.fetch (Chromium) ve undici gzip/deflate'i kendisi ister ve kendisi açar (elle yazılınca
  // sıkıştırılmış gövde açılmadan gelebilir). Zaman aşımı gövdenin okunmasını da kapsar (aynı sinyal).
  const kes = new AbortController();
  const signal = AbortSignal.any([AbortSignal.timeout(o.zamanAsimiMs ?? ZAMAN_ASIMI_MS), kes.signal]);
  const r = await o.getir(url, { headers: { 'User-Agent': o.ua, ...ek }, signal });
  kesiciler.set(r, () => kes.abort(new BoyutHatasi()));
  if (r.status !== 304 && !r.ok) { await iptal(r); throw new Error(`HTTP ${r.status}`); }
  return r;
}

/** Gövdeyi bırakır ve (bu katmanın isteğiyse) isteğin kendisini keser. */
async function iptal(r: Response, okuyucu?: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  kesiciler.get(r)?.();
  await (okuyucu ? okuyucu.cancel() : r.body?.cancel())?.catch(() => undefined);
}

/** Gövdeyi en çok `sinir` bayta dek akarak okur; aşılırsa akışı ve isteği keser, BoyutHatasi fırlatır. */
export async function sinirliMetin(r: Response, sinir = EN_COK_BAYT): Promise<string> {
  const uzunluk = Number(r.headers.get('content-length'));
  if (Number.isFinite(uzunluk) && uzunluk > sinir) { await iptal(r); throw new BoyutHatasi(); }
  if (!r.body) return '';
  const okuyucu = r.body.getReader();
  const parcalar: Uint8Array[] = [];
  let toplam = 0;
  for (;;) {
    const { done, value } = await okuyucu.read();
    if (done) break;
    toplam += value.byteLength;
    if (toplam > sinir) { await iptal(r, okuyucu); throw new BoyutHatasi(); }
    parcalar.push(value);
  }
  const tum = new Uint8Array(toplam);
  let i = 0;
  for (const p of parcalar) { tum.set(p, i); i += p.byteLength; }
  return new TextDecoder('utf-8').decode(tum);
}

/** Düz metin (RSS/XML). */
export async function metinGetir(o: GetirSecenegi, url: string): Promise<string> {
  return sinirliMetin(await istek(o, url, { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' }), o.enCokBayt);
}

/** MET Locationforecast: 304'te "değişmedi"; Expires ve Last-Modified döner. */
export async function havaGetir(o: GetirSecenegi, url: string, sonDegisiklik?: string): Promise<{ degismedi: true; bitis?: number; sonDegisiklik?: string } | { degismedi: false; json: unknown; bitis?: number; sonDegisiklik?: string }> {
  const r = await istek(o, url, { Accept: 'application/json', ...(sonDegisiklik ? { 'If-Modified-Since': sonDegisiklik } : {}) });
  const bitisHam = Date.parse(r.headers.get('expires') ?? '');
  const bitis = Number.isFinite(bitisHam) ? bitisHam : undefined;
  const sd = r.headers.get('last-modified') ?? sonDegisiklik;
  if (r.status === 304) { await iptal(r); return { degismedi: true, bitis, sonDegisiklik: sd ?? undefined }; }
  const metin = await sinirliMetin(r, o.enCokBayt);
  return { degismedi: false, json: JSON.parse(metin), bitis, sonDegisiklik: sd ?? undefined };
}
