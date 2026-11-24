// ── sayfa_oku: bir web adresinin metnini okur (0.14 T14, Ruling R6; düzeltme turu 1) — ana süreç ──────────────────────────────────
// Sayfa Chromium'da DEĞİL Node'da (`node:https`/`node:http`) çekilir: gizli pencere, JavaScript, iletişim kutusu ve Chromium'un ayrı DNS çözümlemesi yok.
//  • HTML: gövde indirilir (en çok 5 MB), metni `shared/html-metin.ts` ile çıkarılır. JavaScript ile çizilen sayfa tanınır ve "Fuber Tarayıcı ile açabilirim" denir.
//  • PDF: `pdf-parse`; düz metin (text/*, json, xml): doğrudan.
// Güvenlik (SSRF, B40): özel `lookup` kancası BAĞLANTI ANINDA çözülen her IP'yi denetler (özel ağ, loopback, link-local, IPv6 eşdeğerleri reddedilir) —
// denetlenen IP, bağlanılan IP'dir; denetimle bağlantı arasında DNS yeniden bağlama boşluğu kalmaz. IP yazılı adresler (Node'da çözümleme yapılmaz)
// ve `file:`/`localhost` gibi adlar her adımda `ozelAdresMi` ile önceden denetlenir. Yönlendirmeler elle izlenir (en çok 5), HER adımda aynı denetim yinelenir.
// Gövde akış hâlinde okunur, 5 MB'ı (sıkıştırma açıldıktan sonra) aşınca kesilir ve hata döner; toplam süre 20 sn. Adreste kimlik bilgisi olamaz.
// Bedel: Chromium'un vekil sunucu/sertifika deposu ayarları kullanılmaz (Node varsayılan sertifika deposu, doğrudan bağlantı).
// Önizleme/test (FUBER_DEMO + FUBER_TEST_SAYFA_IZIN="127.0.0.1:5555,…"): yalnız o sunucu adresleri "genel" sayılır (yerel sahte sayfa/PDF okunabilsin).
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { ozelAdresMi } from '../shared/sayfa-bolme.js';
import { htmlSayfaMetni, JS_GEREKLI_METNI } from '../shared/html-metin.js';

export const SAYFA_SURESI_MS = 20_000;
export const SAYFA_BOYUT_SINIRI = 5 * 1024 * 1024;
const YONLENDIRME_SINIRI = 5;

export type SayfaTuru = 'html' | 'pdf' | 'metin';
export interface SayfaSonucu { baslik: string; metin: string; tur: SayfaTuru }

/** Kullanıcıya olduğu gibi söylenebilecek okuma hatası (teknik ayrıntı yok). */
export class SayfaOkunamadi extends Error {
  readonly sayfaOkunamadi = true as const;
  constructor(mesaj: string) { super(mesaj); this.name = 'SayfaOkunamadi'; }
}
export const sayfaOkunamadiMi = (e: unknown): e is SayfaOkunamadi => typeof e === 'object' && e !== null && (e as { sayfaOkunamadi?: unknown }).sayfaOkunamadi === true;

const OZEL_METNI = 'Bu adres bu bilgisayarın ya da yerel ağın içinde; okunmaz.';

export type SayfaGetir = (url: string, init: RequestInit) => Promise<Response>;
export interface SayfaBagimliliklari {
  getir?: SayfaGetir;
  /** Adres (bağlantıdan ÖNCE, yazıldığı hâliyle) özel/yerel mi. Varsayılan: `adresReddedilirMi`. Çözülen IP bağlantı anında `getir` içinde ayrıca denetlenir. */
  ozelMi?: (url: string) => Promise<boolean>;
  /** PDF baytlarından metin. Varsayılan: pdf-parse. */
  pdfMetni?: (bayt: Uint8Array) => Promise<{ baslik?: string; metin: string }>;
  sureMs?: number;
}

// ── Adres denetimi (bağlantıdan önce, yazıldığı hâliyle) ─────────────────────────────────────────────────────────────────────
const testIzni = (): string[] => (process.env.FUBER_DEMO ? (process.env.FUBER_TEST_SAYFA_IZIN ?? '').split(',').map((x) => x.trim()).filter(Boolean) : []);

/** Adres okunamayacak kadar yerel/özel mi (yazıldığı hâliyle: şema, IP, `localhost` ve yerel ağ adları). Sunucu adının çözümü burada YAPILMAZ: bağlantı anında
 *  `nodeGetirOlustur`'un `lookup` kancası çözülen IP'yi denetler (DNS yeniden bağlama kapalı). Yalnız FUBER_DEMO + FUBER_TEST_SAYFA_IZIN'deki sunucu adresi genel sayılır. */
export async function adresReddedilirMi(url: string): Promise<boolean> {
  let u: URL;
  try { u = new URL(url); } catch { return true; }
  if (testIzni().includes(u.host)) return false;
  return ozelAdresMi(url);
}

// ── Node ağ isteği: bağlantı anında IP denetimi ────────────────────────────────────────────────────────────────────────────────
type Cozum = (host: string, secenek: dns.LookupOptions, cb: (e: NodeJS.ErrnoException | null, adresler?: dns.LookupAddress[]) => void) => void;
export interface NodeGetirSecenekleri {
  /** Ad çözücü (testte sahte; varsayılan `dns.lookup`). `all: true` ile çağrılır. */
  lookup?: Cozum;
  /** Çözülen IP reddedilsin mi (varsayılan: özel/ayrılmış aralıklar). */
  ipReddi?: (ip: string) => boolean;
}
const ipOzelMi = (ip: string): boolean => {
  const s = ip.split('%')[0];
  return ozelAdresMi(`http://${s.includes(':') ? `[${s}]` : s}/`);
};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/** Yönlendirmeyi İZLEMEYEN GET: 3xx + Location olduğu gibi döner (çağıran denetleyip izler); öteki yanıtların gövdesi (sıkıştırma açılmış) akar.
 *  Bağlantı kurulurken çözülen HER IP `ipReddi`'den geçer; biri bile özelse bağlantı hiç kurulmaz ve `SayfaOkunamadi` fırlar. */
export function nodeGetirOlustur(o: NodeGetirSecenekleri = {}): SayfaGetir {
  const cozum: Cozum = o.lookup ?? ((h, s, cb) => dns.lookup(h, s, cb as never));
  const ipReddi = o.ipReddi ?? ipOzelMi;
  // http(s).request'in `lookup` seçeneği: yalnız ad çözümlemesi gereken (IP yazılı olmayan) adreslerde çağrılır.
  const lookup = (host: string, secenek: dns.LookupOptions, cb: (...a: unknown[]) => void): void => {
    cozum(host, { ...secenek, all: true }, (hata, adresler) => {
      if (hata) { cb(hata); return; }
      const liste = adresler ?? [];
      if (!liste.length || liste.some((a) => ipReddi(a.address))) { cb(Object.assign(new Error('özel adres'), { code: 'FUBER_OZEL_ADRES' })); return; }
      if (secenek.all) cb(null, liste); else cb(null, liste[0].address, liste[0].family);
    });
  };
  return (adres, init) => new Promise<Response>((coz, red) => {
    const sinyal = init.signal ?? undefined;
    if (sinyal?.aborted) { red(sinyal.reason ?? new Error('iptal')); return; }
    const u = new URL(adres);
    const modul = u.protocol === 'https:' ? https : http;
    const basliklar: Record<string, string> = { 'user-agent': UA, 'accept-encoding': 'gzip, deflate, br', ...((init.headers ?? {}) as Record<string, string>) };
    const istek = modul.request(u, { method: 'GET', headers: basliklar, lookup: lookup as never, agent: false, signal: sinyal }, (yanit) => {
      try {
        const durum = yanit.statusCode ?? 0;
        // Node 600–999 gibi durum kodlarını da verir (ör. LinkedIn 999); `new Response` 200–599 dışını RangeError ile reddeder → burada, ayrıştırıcıdan taşmadan hata.
        if (durum < 200 || durum > 599) { yanit.destroy(); red(new SayfaOkunamadi(`Sayfa açılamadı (HTTP ${durum}).`)); return; }
        const h = new Headers();
        for (const [k, v] of Object.entries(yanit.headers)) {
          if (v === undefined || k === 'set-cookie') continue;
          try { h.set(k, Array.isArray(v) ? v.join(', ') : v); } catch { /* geçersiz başlık atlanır */ }
        }
        if ((durum >= 300 && durum < 400) || [204, 205, 304].includes(durum)) { yanit.destroy(); coz(new Response(null, { status: durum, headers: h })); return; }
        /** Açıcıyı kaynağa bağlar: açıcı kapanınca (iptal, 5 MB aşımı, hata) kaynak soket de yok edilir; kaynak hatası açıcıya geçer. */
        const ac = (donusturucu: zlib.Gunzip | zlib.Inflate | zlib.InflateRaw | zlib.BrotliDecompress): void => {
          yanit.pipe(donusturucu);
          donusturucu.on('close', () => yanit.destroy());
          yanit.on('error', (e) => donusturucu.destroy(e));
          h.delete('content-encoding'); h.delete('content-length');
          coz(new Response(Readable.toWeb(donusturucu) as unknown as ReadableStream<Uint8Array>, { status: durum, headers: h }));
        };
        const kodlama = String(yanit.headers['content-encoding'] ?? '').toLowerCase().trim();
        if (kodlama === 'gzip' || kodlama === 'x-gzip') ac(zlib.createGunzip());
        else if (kodlama === 'br') ac(zlib.createBrotliDecompress());
        else if (kodlama === 'deflate') {
          // "deflate" etiketli yanıtlar zlib başlıklı (RFC 1950) ya da ham (RFC 1951) olabilir: ilk iki bayta bakılır, akış bozulmadan geri konur.
          // Sunucu gövde baytından ÖNCE bağlantıyı keserse 'readable' de 'error' de gelmez: kapanış sözü reddeder (coz'dan sonra red etkisizdir).
          yanit.once('close', () => red(new SayfaOkunamadi('Sayfa açılamadı.')));
          const karar = (): void => {
            try {
              const ilk = yanit.read(2) as Buffer | null;
              if (!ilk) { yanit.once('readable', karar); return; } // iki bayt henüz yok (tek baytlık ilk parça yanlış tanınmasın)
              yanit.unshift(ilk);
              const zlibMi = ilk.length < 2 || ((ilk[0] & 0x0f) === 8 && ((ilk[0] << 8) | ilk[1]) % 31 === 0);
              ac(zlibMi ? zlib.createInflate() : zlib.createInflateRaw());
            } catch (e) { yanit.destroy(); red(e); }
          };
          yanit.once('readable', karar);
        } else coz(new Response(Readable.toWeb(yanit) as unknown as ReadableStream<Uint8Array>, { status: durum, headers: h }));
      } catch (e) { yanit.destroy(); red(e); }
    });
    // İptal (Durdur, Gizli'ye geçiş, 20 sn süresi) bekleyen sözü HER durumda reddeder: istek zaten yok edilmiş olsa da (örn. yanıt başlıktan sonra kopmuş) askıda kalmaz.
    if (sinyal) sinyal.addEventListener('abort', () => { istek.destroy(); red(sinyal.reason ?? new Error('iptal')); }, { once: true });
    istek.on('error', (e: NodeJS.ErrnoException) => red(e.code === 'FUBER_OZEL_ADRES' ? new SayfaOkunamadi(OZEL_METNI) : e));
    istek.end();
  });
}

// ── Varsayılan PDF okuyucu ────────────────────────────────────────────────────────────────────────────────────────────────────
async function pdfMetniOku(bayt: Uint8Array): Promise<{ baslik?: string; metin: string }> {
  const { PDFParse } = await import('pdf-parse');
  const p = new PDFParse({ data: bayt });
  try {
    const t = await p.getText();
    let baslik: string | undefined;
    try { const b = await p.getInfo(); const x = (b as { info?: { Title?: unknown } }).info?.Title; if (typeof x === 'string' && x.trim()) baslik = x.trim(); } catch { /* başlık isteğe bağlı */ }
    return { baslik, metin: t.text };
  } finally { await p.destroy(); }
}

// ── Ana işlev ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const tur = (ct: string, adres: string): SayfaTuru | null => {
  const t = ct.split(';')[0].trim().toLowerCase();
  if (t === 'application/pdf') return 'pdf';
  if (t === 'text/html' || t === 'application/xhtml+xml') return 'html';
  if (t.startsWith('text/') || t === 'application/json' || t === 'application/xml' || t.endsWith('+json') || t.endsWith('+xml')) return 'metin';
  if (!t || t === 'application/octet-stream') return /\.pdf(\?|#|$)/i.test(adres) ? 'pdf' : null;
  return null;
};

const BOYUT_ASILDI = 'Sayfa 5 MB sınırından büyük; okunmadı.';
/** Gövdeyi en çok `sinir` bayta kadar okur (akış hâlinde; Content-Length olmasa da); aşarsa bağlantıyı keser ve SayfaOkunamadi. */
async function govdeOku(r: Response, sinir: number): Promise<Uint8Array> {
  const uzun = Number(r.headers.get('content-length'));
  if (Number.isFinite(uzun) && uzun > sinir) { void r.body?.cancel().catch(() => undefined); throw new SayfaOkunamadi(BOYUT_ASILDI); }
  if (!r.body) return new Uint8Array(await r.arrayBuffer());
  const okuyucu = r.body.getReader();
  const parcalar: Uint8Array[] = [];
  let toplam = 0;
  for (;;) {
    const { done, value } = await okuyucu.read();
    if (done) break;
    toplam += value.byteLength;
    if (toplam > sinir) { void okuyucu.cancel().catch(() => undefined); throw new SayfaOkunamadi(BOYUT_ASILDI); }
    parcalar.push(value);
  }
  const out = new Uint8Array(toplam);
  let o = 0;
  for (const p of parcalar) { out.set(p, o); o += p.byteLength; }
  return out;
}

/** Bir web adresini okur (Ruling R6). Reddedilen/okunamayan her durumda `SayfaOkunamadi` (kullanıcıya söylenebilir cümle); sinyal iptali olduğu gibi fırlar. */
export async function sayfaOku(adres: string, sinyal: AbortSignal, bag: SayfaBagimliliklari = {}): Promise<SayfaSonucu> {
  const getir = bag.getir ?? nodeGetirOlustur();
  const ozelMi = bag.ozelMi ?? adresReddedilirMi;
  const sureMs = bag.sureMs ?? SAYFA_SURESI_MS;
  const sure = AbortSignal.timeout(sureMs);
  const hepsi = AbortSignal.any([sinyal, sure]);
  const zamanAsimi = () => new SayfaOkunamadi(`Sayfa ${Math.round(sureMs / 1000)} saniyede açılmadı; okunmadı.`);

  let u: URL;
  try { u = new URL(String(adres).trim()); } catch { throw new SayfaOkunamadi('Adres geçerli değil; http:// ya da https:// ile başlayan tam bir adres ver.'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new SayfaOkunamadi('Yalnız http ve https adresleri okunur.');
  if (u.username || u.password) throw new SayfaOkunamadi('Adreste kullanıcı adı ya da parola olamaz.');

  try {
    let simdiki = u.href;
    let r: Response | null = null;
    for (let adim = 0; adim <= YONLENDIRME_SINIRI; adim++) {
      if (await ozelMi(simdiki)) throw new SayfaOkunamadi(OZEL_METNI);
      r = await getir(simdiki, { method: 'GET', redirect: 'manual', signal: hepsi, headers: { accept: 'text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.5', 'accept-language': 'tr-TR,tr;q=0.9,en;q=0.8' } } as RequestInit);
      if (r.status >= 300 && r.status < 400) {
        const yer = r.headers.get('location');
        void r.body?.cancel().catch(() => undefined);
        if (!yer) throw new SayfaOkunamadi('Sayfa yönlendirdi ama gideceği yeri vermedi.');
        let sonraki: URL;
        try { sonraki = new URL(yer, simdiki); } catch { throw new SayfaOkunamadi('Sayfa geçersiz bir adrese yönlendirdi.'); }
        if (sonraki.protocol !== 'http:' && sonraki.protocol !== 'https:') throw new SayfaOkunamadi('Sayfa desteklenmeyen bir adrese yönlendirdi.');
        if (sonraki.username || sonraki.password) throw new SayfaOkunamadi('Sayfa kimlik bilgili bir adrese yönlendirdi; okunmadı.');
        simdiki = sonraki.href;
        r = null;
        continue;
      }
      break;
    }
    if (!r) throw new SayfaOkunamadi('Sayfa çok fazla yönlendirdi.');
    if (r.status >= 400) {
      void r.body?.cancel().catch(() => undefined);
      throw new SayfaOkunamadi(r.status === 404 || r.status === 410 ? 'Sayfa bulunamadı (404).' : `Sayfa açılamadı (HTTP ${r.status}).`);
    }

    const t = tur(r.headers.get('content-type') ?? '', simdiki);
    if (!t) { void r.body?.cancel().catch(() => undefined); throw new SayfaOkunamadi(`Bu içerik türü okunamıyor (${(r.headers.get('content-type') ?? 'bilinmiyor').split(';')[0]}).`); }

    const bayt = await govdeOku(r, SAYFA_BOYUT_SINIRI);
    const ad = new URL(simdiki);
    if (t === 'pdf') {
      if (!(bayt.length >= 5 && String.fromCharCode(...bayt.subarray(0, 5)) === '%PDF-')) throw new SayfaOkunamadi('PDF dosyası geçerli görünmüyor.');
      const p = await (bag.pdfMetni ?? pdfMetniOku)(bayt);
      return { baslik: p.baslik?.trim() || ad.pathname.split('/').filter(Boolean).pop() || ad.hostname, metin: p.metin, tur: 'pdf' };
    }
    const kodlama = /charset\s*=\s*["']?([\w-]+)/i.exec(r.headers.get('content-type') ?? '')?.[1]
      ?? (t === 'html' ? /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(new TextDecoder('latin1').decode(bayt.subarray(0, 2048)))?.[1] : undefined);
    let metin: string;
    try { metin = new TextDecoder(kodlama || 'utf-8').decode(bayt); } catch { metin = new TextDecoder('utf-8').decode(bayt); }
    if (t === 'html') {
      const h = htmlSayfaMetni(metin);
      if (h.jsGerekli) throw new SayfaOkunamadi(JS_GEREKLI_METNI);
      return { baslik: h.baslik || ad.hostname, metin: h.metin, tur: 'html' };
    }
    return { baslik: ad.pathname.split('/').filter(Boolean).pop() || ad.hostname, metin, tur: 'metin' };
  } catch (e) {
    if (sinyal.aborted) throw e; // çağıran iptal etti (Durdur, Gizli'ye geçiş)
    if (sure.aborted) throw zamanAsimi();
    if (sayfaOkunamadiMi(e)) throw e;
    throw new SayfaOkunamadi('Sayfa açılamadı.');
  }
}
