// ── Sunucu ↔ masaüstü güçlü sohbet sözleşmesi (0.14 T0; saf → birim testli: tests/sohbet-protokolu.test.ts) ──
// Araçlar Fuber'indir ve modelden bağımsızdır (ürün kararı, 2 Kas): her modele aynı araç seti, aynı şemalarla gider. Yerel araç çağırma
// (OpenAI `tools` / `tool_calls`) yalnız bir taşıma ayrıntısıdır; desteklemeyen modelde sunucu aynı kataloğu sistem istemine yazar ve
// `<arac ad="…">{json}</arac>` bloklarını kendisi ayrıştırır (R3). İstemci iki yolda da `toolCalls` alır; `aracYolu` yalnız bilgi ve ölçüm içindir.
// Uyum: 0.14 masaüstü eski sunucuda (`yetenekler` yok) bugünkü metin yoluyla çalışır; 0.13 istemcisi yeni sunucuda bozulmaz (`tools`, `stream`
// isteğe bağlı). Ayrıştırıcı tolerans gösterir: bozuk ya da tanınmayan olay atlanır, akış kopmaz.

/** Aracın hangi yoldan çağrıldığı: modelin yerel araç çağırması ya da sunucunun metin yedeği. */
export type AracYolu = 'yerel' | 'metin';

/** Modele sunulan araç (OpenAI function biçiminin sade hâli; `parameters` JSON Şema). */
export interface ProtokolAraci { name: string; description: string; parameters: Record<string, unknown> }

/** Modelin istediği araç çağrısı; `arguments` JSON metnidir (ayrıştırmak istemcinin işi). */
export interface ProtokolAracCagrisi { id: string; name: string; arguments: string }

/** Bugünkü içerik parçaları: metin ve görsel (`image_url`, data adresi). */
export type ProtokolParcasi = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

/** İsteğin mesajları. Araç çağrısı (assistant `tool_calls`) ile sonucu (`tool` mesajı) bölünmez: ikisi birlikte girer ya da birlikte düşer. */
export type ProtokolMesaji =
  | { role: 'user'; content: string | ProtokolParcasi[] }
  | { role: 'assistant'; content: string; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string | ProtokolParcasi[] };

/** Akışsız (ya da akış sonunda birleşmiş) sohbet yanıtı. */
export interface SohbetYaniti {
  model: string;
  content: string;
  usage: { inputTokens: number; outputTokens: number };
  toolCalls: ProtokolAracCagrisi[];
  finishReason: 'stop' | 'tool_calls' | 'length';
  aracYolu: AracYolu;
}

/** SSE akışının olayları. `done` içerik ve araç çağrılarını taşımaz (onlar `delta` ve `tool_call` ile gelmiştir). */
export type SunucuAkisOlayi =
  | { tur: 'delta'; text: string }
  | ({ tur: 'tool_call' } & ProtokolAracCagrisi)
  | ({ tur: 'done' } & Omit<SohbetYaniti, 'content' | 'toolCalls'>)
  | { tur: 'error'; code: string; message: string };

const sayi = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const metin = (x: unknown): x is string => typeof x === 'string';

/** Tek SSE olayını (`event:` adı + `data:` JSON) tipli olaya çevirir; tanınmayan ya da eksik alanlıysa null. */
function olayCoz(ad: string, veri: unknown): SunucuAkisOlayi | null {
  if (!veri || typeof veri !== 'object' || Array.isArray(veri)) return null;
  const v = veri as Record<string, unknown>;
  switch (ad) {
    case 'delta':
      return metin(v.text) ? { tur: 'delta', text: v.text } : null;
    case 'tool_call':
      return metin(v.id) && metin(v.name) && metin(v.arguments) ? { tur: 'tool_call', id: v.id, name: v.name, arguments: v.arguments } : null;
    case 'error':
      return metin(v.code) && metin(v.message) ? { tur: 'error', code: v.code, message: v.message } : null;
    case 'done': {
      const u = v.usage as Record<string, unknown> | null | undefined;
      if (!metin(v.model) || !u || typeof u !== 'object' || !sayi(u.inputTokens) || !sayi(u.outputTokens)) return null;
      if (v.finishReason !== 'stop' && v.finishReason !== 'tool_calls' && v.finishReason !== 'length') return null;
      if (v.aracYolu !== 'yerel' && v.aracYolu !== 'metin') return null;
      return { tur: 'done', model: v.model, usage: { inputTokens: u.inputTokens, outputTokens: u.outputTokens }, finishReason: v.finishReason, aracYolu: v.aracYolu };
    }
    default:
      return null;
  }
}

/** SSE tamponunu ayrıştırır: tamamlanmış olaylar (boş satırla biten bloklar) `olaylar`a, yarım kalan kuyruk `kalan`a gider; çağıran bir sonraki
 *  parçanın başına `kalan`ı ekler. `:` ile başlayan satır nabızdır, yok sayılır. CRLF çözülür (yarım `\r` kuyrukta kalır, sonraki parçayla birleşir).
 *  Birden çok `data:` satırı `\n` ile birleşir. Bozuk JSON, bilinmeyen tür ve eksik alanlı olay atlanır. */
export function sseAyristir(tampon: string): { olaylar: SunucuAkisOlayi[]; kalan: string } {
  const t = tampon.replace(/\r\n/g, '\n');
  const son = t.lastIndexOf('\n\n');
  if (son < 0) return { olaylar: [], kalan: t };
  const olaylar: SunucuAkisOlayi[] = [];
  for (const blok of t.slice(0, son).split('\n\n')) {
    let ad = '';
    const veri: string[] = [];
    for (const satir of blok.split('\n')) {
      if (!satir || satir.startsWith(':')) continue;
      const i = satir.indexOf(':');
      const alan = i < 0 ? satir : satir.slice(0, i);
      let deger = i < 0 ? '' : satir.slice(i + 1);
      if (deger.startsWith(' ')) deger = deger.slice(1);
      if (alan === 'event') ad = deger;
      else if (alan === 'data') veri.push(deger);
    }
    if (!ad || veri.length === 0) continue;
    let json: unknown;
    try { json = JSON.parse(veri.join('\n')); } catch { continue; }
    const o = olayCoz(ad, json);
    if (o) olaylar.push(o);
  }
  return { olaylar, kalan: t.slice(son + 2) };
}

/** Sunucunun bildirdiği yetenekler (`CihazDurumYaniti.yetenekler`). Eski sunucuda alan yoktur → hepsi kapalı (bugünkü metin yolu). */
export interface SunucuYetenekleri { aracCagirma: boolean; akis: boolean; webAra: boolean; mcpKatalog: boolean }

/** Bilinmeyen değerden yetenekleri okur; yalnız tam `true` açar, alan yoksa ya da biçim bozuksa kapalı. */
export function yetenekleriOku(x: unknown): SunucuYetenekleri {
  const o = x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
  return { aracCagirma: o.aracCagirma === true, akis: o.akis === true, webAra: o.webAra === true, mcpKatalog: o.mcpKatalog === true };
}

/** Araçlı isteğin sunucu sınırları (R4, B36). Araçsız istekte bugünkü 100 mesaj ve 120.000 karakter sürer. `arac`: araç sayısı; `sema`: araç
 *  başına şema (JSON metni) karakteri; `aciklama`: araç başına açıklama karakteri; `katalog` (0.14 T16, T7 devri): sunucunun metin kataloğunun
 *  (metinKatalogu) akıl sağlığı tavanı — aşan istek 400 ARAC_KATALOGU_BUYUK alır; ölçü aracKataloguUzunlugu (sunucunun saydığı gibi). */
export const ARAC_ISTEK_SINIRI = { mesaj: 300, metin: 300_000, arac: 256, sema: 16_000, aciklama: 4_000, katalog: 2_000_000 } as const;

/** Sunucunun metin kataloğundaki tek aracın bloğunun boyu: `### ad\n<açıklama>\nGirdi şeması: <şema>` (sunucu desktop.arac.ts metinKatalogu ile birebir:
 *  açıklamadaki blok etiketleri `&lt;…` olur (+3), şemadaki her `<` altı karakterlik JSON kaçışına döner (+5)). */
export function aracBlokUzunlugu(a: ProtokolAraci): number {
  const etiket = a.description.match(/<(\s*(?:\/\s*)?arac_(?:katalogu|sonucu))/gi)?.length ?? 0;
  const sema = JSON.stringify(a.parameters);
  let kucuk = 0;
  for (let i = sema.indexOf('<'); i >= 0; i = sema.indexOf('<', i + 1)) kucuk += 1;
  return 4 + a.name.length + 1 + a.description.length + etiket * 3 + 1 + 'Girdi şeması: '.length + sema.length + kucuk * 5;
}
/** `n` aracın bloklarının toplamı verilince kataloğun boyu: `<arac_katalogu>\n` + bloklar ("\n\n" ile) + `\n</arac_katalogu>`; araç yoksa 0. */
export const katalogBoyu = (n: number, bloklar: number): number => (n ? 33 + bloklar + 2 * (n - 1) : 0);
/** Araç listesinin sunucudaki metin kataloğunun boyu (karakter; sunucu metinKatalogu(araclar).length ile aynı — test eşler). */
export function aracKataloguUzunlugu(araclar: readonly ProtokolAraci[]): number {
  let t = 0;
  for (const a of araclar) t += aracBlokUzunlugu(a);
  return katalogBoyu(araclar.length, t);
}
/** 400 ARAC_KATALOGU_BUYUK'un (ya da istemcinin aynı ölçüyle göndermediği isteğin) kullanıcıya görünen cümlesi: ham ileti (karakter sayısı, mcp_kullan)
 *  gösterilmez; iki modda da aynı. */
export const ARAC_KATALOGU_BUYUK_METNI = "Bağlı servislerin araçları tek bir istekte gönderilemeyecek kadar çok. Bağlantılar'dan şu an kullanmadığın bir servisin bağlantısını kesip yeniden dene.";

/** Araç listesinin sınır ihlali: hangi alan, ölçülen değer ve sınır. */
export interface AracSinirAsimi { alan: 'arac' | 'sema' | 'aciklama'; deger: number; sinir: number }

/** Araç listesini `ARAC_ISTEK_SINIRI`'na göre denetler (sunucu isteği reddederken, istemci göndermeden önce kullanır); ilk ihlali döner, yoksa null.
 *  Sıra: önce araç sayısı, sonra her araç için şema (`JSON.stringify(parameters).length`), sonra açıklama. Sınırın kendisi serbesttir (> ile aşılır). */
export function aracListesiSinirAsimi(araclar: ProtokolAraci[]): AracSinirAsimi | null {
  const s = ARAC_ISTEK_SINIRI;
  if (araclar.length > s.arac) return { alan: 'arac', deger: araclar.length, sinir: s.arac };
  for (const a of araclar) {
    const sema = JSON.stringify(a.parameters).length;
    if (sema > s.sema) return { alan: 'sema', deger: sema, sinir: s.sema };
    if (a.description.length > s.aciklama) return { alan: 'aciklama', deger: a.description.length, sinir: s.aciklama };
  }
  return null;
}
