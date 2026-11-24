// ── Sohbet ekleri: tür, boyut ve sayı kuralları (analiz 11 Kas bulgu 8–12; saf, birim testli: tests/ek-kural.test.ts) ─────────────────
// Sohbet kutusu yalnız görsel kabul ediyordu (boyut/tür denetimi yok, 4. görsel ilkini siliyordu). Artık seçici, sürükle-bırak ve yapıştırma:
//  • görsel: PNG, JPEG, GIF, WebP olduğu gibi; BMP ve SVG arayüzde PNG'ye çevrilir; HEIC/TIFF okunmaz (tek satır). En çok 5 MB (büyükse arayüz
//    küçültüp yeniden dener), mesaj başına en çok 4 görsel (Fuber geçidinin parça sınırı: metin + 4 görsel ≤ 8 parça; video kareleri de görsel sayılır).
//  • belge: PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), metin, Markdown, CSV ve kod dosyaları — ana süreçte dosya_oku'nun ayrıştırıcısıyla
//    (iceaktar.ts metneCevir) metne çevrilir. En çok 20 MB; ek başına 40.000, mesaj başına 80.000 karakter (aşan kısım AÇIKÇA kısaltılır).
//  • video: MP4, MOV, WebM, M4V — bu bilgisayarda kare + ses yazısı (main/video-isle.ts). En çok 200 MB ve 10 dakika.
// Sessiz düşme yok: kural dışı her dosya tek satırlık nedenle reddedilir; sınır aşımı da söylenir.

export type EkTuru = 'gorsel' | 'belge' | 'video';
export const GORSEL_MEDYA: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
/** Arayüzün PNG'ye çevirebildiği (tarayıcının çözdüğü) görsel türleri. */
export const CEVRILEN_GORSEL = ['bmp', 'svg', 'avif', 'ico'];
export const GORSEL_AZAMI_BAYT = 5 * 1024 * 1024;
export const AZAMI_GORSEL = 4;
export const BELGE_AZAMI_BAYT = 20 * 1024 * 1024;
export const VIDEO_AZAMI_BAYT = 200 * 1024 * 1024;
export const VIDEO_AZAMI_SN = 10 * 60;
/** Videodan çıkarılan kare sayısı (görsel sınırına sayılır). */
export const VIDEO_KARE_SAYISI = 4;
/** Mesaj başına belge + video eki. */
export const AZAMI_EK = 6;
export const EK_METIN_SINIRI = 40_000;
export const EK_TOPLAM_METIN = 80_000;
/** Bu bilgisayardaki model (Gizli / "Yalnız bu bilgisayar") için mesajın TÜM eklerine karakter: 4.096 belirteçlik yuvaya istem, soru ve 1.024'lük
 *  yanıtla birlikte sığsın (testte ölçüldü: tests/yerel-istek-sigma.test.ts). */
export const YEREL_EK_SINIRI = 3_000;

const GORSEL_UZ = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const OKUNMAYAN_GORSEL = new Set(['heic', 'heif', 'tif', 'tiff', 'raw', 'cr2', 'nef', 'psd']);
const VIDEO_UZ = new Set(['mp4', 'mov', 'webm', 'm4v']);
const ESKI_OFFICE: Record<string, string> = { doc: '.docx', xls: '.xlsx', ppt: '.pptx' };
export const BELGE_UZ: readonly string[] = [
  'pdf', 'docx', 'xlsx', 'pptx', 'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'log', 'eml', 'html', 'htm', 'xml', 'yaml', 'yml', 'toml', 'ini', 'rtf',
  // Kod dosyaları
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'java', 'kt', 'kts', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'm', 'scala', 'dart',
  'lua', 'r', 'sql', 'sh', 'bash', 'zsh', 'ps1', 'psm1', 'bat', 'cmd', 'css', 'scss', 'sass', 'less', 'vue', 'svelte', 'astro', 'gradle', 'cmake', 'makefile',
  'dockerfile', 'env.example', 'gitignore', 'proto', 'graphql', 'tf', 'ipynb',
];
const BELGE_KUMESI = new Set(BELGE_UZ);
/** Dosya seçicinin (`<input type=file accept>`) kabul listesi: görseller (çevrilenler dahil), belgeler, kod, video. TÜM sohbet kutuları bunu kullanır
 *  (tests/dosya-ekleme-bekcisi.test.ts): bir kutu yalnız görsel kabul ederse "görsel harici dosya yükleyemiyorum" olur. */
export const EK_SECICI_KABUL: string = ['image/*', '.heic', ...BELGE_UZ.map((u) => `.${u}`), '.mp4', '.mov', '.webm', '.m4v'].join(',');

export const uzanti = (ad: string): string => {
  const a = String(ad ?? '').toLowerCase().trim();
  const taban = a.split(/[\\/]/).pop() ?? a;
  if (taban === 'makefile' || taban === 'dockerfile') return taban;
  const i = taban.lastIndexOf('.');
  return i > 0 ? taban.slice(i + 1) : '';
};
export const ekBoyutMetni = (bayt: number): string => (bayt >= 1024 * 1024 ? `${(bayt / 1024 / 1024).toFixed(bayt >= 10 * 1024 * 1024 ? 0 : 1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bayt / 1024))} KB`);

export type EkKarari = { tur: EkTuru; cevir?: boolean } | { hata: string };

/** Dosya kabul edilir mi, hangi yoldan: görsel (çevrilecek mi), belge ya da video; değilse tek satırlık neden. */
export function ekSinifla(ad: string, mime: string, boyut: number): EkKarari {
  const uz = uzanti(ad);
  const m = String(mime ?? '').toLowerCase();
  const adi = String(ad ?? '').split(/[\\/]/).pop() || 'Dosya';
  if (GORSEL_UZ.has(uz) || GORSEL_MEDYA.includes(m)) {
    // Görselin boyutu arayüzde küçültülerek denenir; burada yalnız çok büyük (40 MB) dosya baştan reddedilir.
    if (boyut > 40 * 1024 * 1024) return { hata: `${adi} çok büyük (${ekBoyutMetni(boyut)}); görsel en çok 5 MB olabilir.` };
    return { tur: 'gorsel' };
  }
  if (OKUNMAYAN_GORSEL.has(uz) || m === 'image/heic' || m === 'image/heif' || m === 'image/tiff') return { hata: `${adi}: bu görsel türü okunmuyor (${uz.toUpperCase() || 'HEIC/TIFF'}); PNG ya da JPEG olarak kaydedip ekle.` };
  if (CEVRILEN_GORSEL.includes(uz) || m === 'image/bmp' || m === 'image/svg+xml' || m === 'image/avif') {
    if (boyut > 40 * 1024 * 1024) return { hata: `${adi} çok büyük (${ekBoyutMetni(boyut)}).` };
    return { tur: 'gorsel', cevir: true };
  }
  if (VIDEO_UZ.has(uz) || /^video\/(mp4|quicktime|webm|x-m4v)$/.test(m)) {
    if (boyut > VIDEO_AZAMI_BAYT) return { hata: `${adi} çok büyük (${ekBoyutMetni(boyut)}); video en çok ${ekBoyutMetni(VIDEO_AZAMI_BAYT)} ve ${VIDEO_AZAMI_SN / 60} dakika olabilir.` };
    return { tur: 'video' };
  }
  if (ESKI_OFFICE[uz]) return { hata: `${adi}: eski Office biçimi okunmuyor; ${ESKI_OFFICE[uz]} olarak kaydedip ekle.` };
  // Uzantı MIME'den önce: tarayıcı .ts (TypeScript) dosyasına "video/mp2t" der.
  if (BELGE_KUMESI.has(uz) || (!uz && m.startsWith('text/'))) {
    if (boyut > BELGE_AZAMI_BAYT) return { hata: `${adi} çok büyük (${ekBoyutMetni(boyut)}); belge en çok ${ekBoyutMetni(BELGE_AZAMI_BAYT)} olabilir.` };
    if (boyut === 0) return { hata: `${adi} boş.` };
    return { tur: 'belge' };
  }
  if (m.startsWith('video/') || ['avi', 'mkv', 'wmv', 'flv', '3gp'].includes(uz)) return { hata: `${adi}: bu video türü okunmuyor; MP4, MOV ya da WebM ekle.` };
  if (m.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'ogg', 'flac'].includes(uz)) return { hata: `${adi}: ses dosyası eklenmiyor; videoyu ya da konuşmanın yazısını ekle.` };
  // Tek cümle: kullanıcı neyin neden gitmediğini hemen görsün (uzantı yoksa dosya adı).
  return { hata: `Bu dosya türü desteklenmiyor: ${uz ? `.${uz}` : adi}` };
}

/** Ek adı modele giden etikete güvenle girsin (tırnak, açılı ayraç ve satır sonu yok). */
export const ekAdiTemizle = (ad: string): string => String(ad ?? '').replace(/[<>"\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) || 'ek';

export interface MetinEki { ad: string; tur: 'belge' | 'video'; metin: string; kisaltildi?: boolean; toplam?: number; kareSayisi?: number }

/** İnceleme M7: içerikteki (ya da kullanıcının yazdığı) `<ek`/`</ek` etiketi bloğu erken kapatmasın ve çip sanılmasın: araya sıfır genişlikli
 *  boşluk girer (model metni yine okur). */
export const ekEtiketiniEtkisizlestir = (s: string): string => String(s ?? '').replace(/<(\/?)ek\b/gi, '<$1\u200bek');

/** Ek metni sınırına (karakter) kısaltılır; kısaltıldıysa sonuna AÇIK not düşer (model ve kullanıcı ikisi de bilir). */
export function ekMetniKisalt(metin: string, sinir: number, toplam = metin.length): { metin: string; kisaltildi: boolean } {
  if (metin.length <= sinir) return { metin, kisaltildi: toplam > metin.length };
  return { metin: `${metin.slice(0, sinir)}\n…(ek kısaltıldı: ${sinir.toLocaleString('tr-TR')} / ${toplam.toLocaleString('tr-TR')} karakter)`, kisaltildi: true };
}

/** Eklerin modele giden metni: her ek `<ek ad="…" tur="…">…</ek>` bloğu (gorunume bunu sohbet balonunda bir çipe çevirir). `yerel`: ek başına YEREL_EK_SINIRI. */
export function ekMetinleri(ekler: readonly MetinEki[] | undefined, o: { yerel?: boolean } = {}): string {
  if (!ekler?.length) return '';
  let kalan = o.yerel ? YEREL_EK_SINIRI : EK_TOPLAM_METIN;
  return ekler.slice(0, AZAMI_EK).map((e) => {
    const sinir = Math.max(0, Math.min(o.yerel ? YEREL_EK_SINIRI : EK_METIN_SINIRI, kalan));
    const k = ekMetniKisalt(String(e.metin ?? ''), sinir, e.toplam ?? String(e.metin ?? '').length);
    kalan -= Math.min(sinir, String(e.metin ?? '').length);
    const ek = e.tur === 'video' && e.kareSayisi ? ` kare="${e.kareSayisi}"` : '';
    return `<ek ad="${ekAdiTemizle(e.ad)}" tur="${e.tur === 'video' ? 'video' : 'belge'}"${ek}>\n${ekEtiketiniEtkisizlestir(k.metin)}\n</ek>`;
  }).join('\n\n');
}

/** Kendi ek hattı olmayan sohbet kutuları (Claude Code) için: yazılan metin + ekler tek mesaj metni olur (ek blokları sonda; görünümde çipe ayrılır). */
export function ekliMesajMetni(metin: string, ekler: readonly MetinEki[] | undefined): string {
  const blok = ekMetinleri(ekler);
  if (!blok) return metin;
  return metin.trim() ? `${metin.trimEnd()}\n\n${blok}` : blok;
}

/**
 * Bu bilgisayardaki model (Gizli, "Yalnız bu bilgisayar") için sohbete düşen tek satır (bulgu 12): görsel okunmaz (video karesi dahil) ve ek metni
 * yerel sınırda kısaldı. Söylenecek bir şey yoksa null. Bulutta null.
 */
export function yerelEkNotu(o: { yerel: boolean; gorsel: number; video: boolean; kisaldi: boolean; gorselsizModel?: string }): string | null {
  // İnceleme I4: bulutta görsel okumayan model (adıyla) — yerel modelin kalıbıyla aynı tek satır.
  if (!o.yerel && !o.gorselsizModel) return null;
  const parca: string[] = [];
  const bas = o.yerel ? 'Bu modelde resim okunmaz' : `Seçili model (${o.gorselsizModel}) resim okumaz`;
  if (o.gorsel > 0) parca.push(o.video ? `${bas}: videonun kareleri gönderilmedi, yalnız konuşma yazısı gitti.` : `${bas}: eklediğin ${o.gorsel > 1 ? `${o.gorsel} görsel` : 'görsel'} gönderilmedi.`);
  if (o.yerel && o.kisaldi) parca.push(`Ekin yalnız ilk ${YEREL_EK_SINIRI.toLocaleString('tr-TR')} karakteri gönderildi (bu bilgisayardaki modelin sınırı).`);
  return parca.length ? parca.join(' ') : null;
}

/** `sohbet:gonder`'in görselleri: izinli tür, base64 metni ≤ ~5 MB'lık görselin karşılığı, en çok AZAMI_GORSEL (arayüz zaten denetler; bu son ağ). */
export function sohbetGorselleri(ham: unknown): { medya: string; veri: string }[] {
  if (!Array.isArray(ham)) return [];
  return ham.filter((g): g is { medya: string; veri: string } => Boolean(g) && typeof g === 'object' && GORSEL_MEDYA.includes((g as { medya?: string }).medya ?? '')
    && typeof (g as { veri?: unknown }).veri === 'string' && (g as { veri: string }).veri.length > 0 && (g as { veri: string }).veri.length <= Math.ceil(GORSEL_AZAMI_BAYT * 4 / 3) + 16)
    .slice(0, AZAMI_GORSEL).map((g) => ({ medya: g.medya, veri: g.veri }));
}
/** `sohbet:gonder`'in belge/video ekleri: ad, tür, metin (sınırlı; kısaltma notu ekMetinleri'nde). */
export function sohbetEkleri(ham: unknown): MetinEki[] {
  if (!Array.isArray(ham)) return [];
  const out: MetinEki[] = [];
  for (const e of ham.slice(0, AZAMI_EK)) {
    if (!e || typeof e !== 'object') continue;
    const x = e as Record<string, unknown>;
    if (typeof x.ad !== 'string' || typeof x.metin !== 'string' || (x.tur !== 'belge' && x.tur !== 'video')) continue;
    out.push({
      ad: ekAdiTemizle(x.ad), tur: x.tur, metin: x.metin.slice(0, EK_METIN_SINIRI + 200),
      ...(typeof x.toplam === 'number' && Number.isFinite(x.toplam) ? { toplam: Math.max(0, Math.floor(x.toplam)) } : {}),
      ...(typeof x.kareSayisi === 'number' && Number.isFinite(x.kareSayisi) ? { kareSayisi: Math.max(0, Math.min(VIDEO_KARE_SAYISI, Math.floor(x.kareSayisi))) } : {}),
    });
  }
  return out;
}

/** Kayıttaki kullanıcı metninden ek blokları ayrılır: kalan metin + çip listesi (ad, tür). Ek yoksa metin aynen. */
export function ekleriAyikla(metin: string): { metin: string; ekler: { ad: string; tur: 'belge' | 'video' }[] } {
  const ekler: { ad: string; tur: 'belge' | 'video' }[] = [];
  const kalan = String(metin ?? '').replace(/<ek ad="([^"]*)" tur="(belge|video)"[^>]*>[\s\S]*?<\/ek>\s*/g, (_t, ad: string, tur: 'belge' | 'video') => { ekler.push({ ad, tur }); return ''; });
  return { metin: ekler.length ? kalan.trim() : metin, ekler };
}
