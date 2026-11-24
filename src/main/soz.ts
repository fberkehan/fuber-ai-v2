// ── Şarkı sözü kaynağı: LRCLIB + bu bilgisayardaki önbellek (0.14 T25; P14, Review Focus 3) — Electron'suz sınıf: tests/soz.test.ts ─────────────────
// Çentiğin Şarkı sözü sayfası çalan parçanın sözünü 'soz:getir' ile ister (ipc.ts; sayfa hızlı atlamada 600 ms bekler, süren istek yenisi gelince kesilir).
// Kaynak LRCLIB (https://lrclib.net/api/get; anahtarsız, açık veri): `artist_name`, `track_name`, `album_name`, `duration`; User-Agent ürünün adı; 6 sn sınır.
// Kurallar:
//  · P14: Gizli mod ya da "Yalnız bu bilgisayar" (bulutYasak) — istek HİÇ çıkmaz, önbellek de gösterilmez: sonuç `kapali` (sayfa BULUT_KAPALI_METNI.soz
//    satırını gösterir). Karar İSTEK ANINDA ve her adımda yeniden verilir: istek sürerken Gizli açılırsa (ayar olayı) istek AbortController ile kesilir,
//    sonuç `kapali` döner, önbelleğe bir şey yazılmaz (kesilmeyen kaynak yine de yanıt verse bile yanıt atılır).
//  · Önbellek parça başına (sanatçı, başlık, albüm, saniyeye yuvarlanmış süre; shared/lrc.ts sozAnahtari) `userData/soz-onbellek.json`'da, en çok 200 şarkı,
//    en eski düşer. Eşli, düz ve "bulunamadı" (404, enstrümantal) önbelleğe girer — atlarken aynı parça kaynağa yeniden gitmez; hata ve kesilen istek girmez.
//  · Düzeltme turu 1: gövde en çok 1 MB (SOZ_GOVDE_SINIRI): `content-length` aşarsa okunmaz, akış sayaçla okunur ve aşınca istek kesilir → `hata`.
//  · Yanıt LRCLIB'in alanları: `syncedLyrics` (LRC; satır çıkmazsa düz), `plainLyrics`, `instrumental`. Metin sınırı 200.000 karakter.
import path from 'node:path';
import { jsonOku, jsonYaz } from './json-dosya.ts';
import { lrcAyristir, sozAnahtari, type SozIstegi, type SozSonucu } from '../shared/lrc.ts';
import { DAGITIM } from '../shared/dagitim.ts';

export type { SozSonucu, SozIstegi } from '../shared/lrc.ts';

export const LRCLIB = 'https://lrclib.net/api/get';
export const LRCLIB_KULLANICI = `${DAGITIM.urunAdi} (open source; ${DAGITIM.depo})`;
/** Tek LRCLIB isteğinin sınırı (yanıt gövdesi dahil). */
export const LRCLIB_MS = 6000;
/** 'soz:getir' en geç bu sürede yanıtlar (önbellek dosyası + istek); sayfa zaten beklemez, satırı "Sözler aranıyor…" ile çizer. */
export const SOZ_TAVAN_MS = 8000;
export const SOZ_ONBELLEK_SINIRI = 200;
const METIN_SINIRI = 200_000;

/** Yanıt gövdesinin üst sınırı (bayt; düzeltme turu 1). `content-length` aşarsa gövde hiç okunmaz; akış sayaçla okunur, aşınca istek kesilir. */
export const SOZ_GOVDE_SINIRI = 1024 * 1024;

/** Kaynağın en küçük yanıt arayüzü (global fetch'in Response'u uyar). `body` varsa gövde akıştan sınırla okunur; yoksa (sahte) `json()`. */
export interface SozYaniti {
  status: number; ok: boolean; json: () => Promise<unknown>;
  headers?: { get: (ad: string) => string | null };
  body?: ReadableStream<Uint8Array> | null;
}

/** Gövdeyi en çok SOZ_GOVDE_SINIRI bayt okuyup JSON'a çevirir; sınır aşılırsa ya da gövde bozuksa null (sınır aşımında istek de kesilir). */
async function govdeOku(r: SozYaniti, k: AbortController): Promise<unknown | null> {
  const uzunluk = Number(r.headers?.get('content-length') ?? NaN);
  if (Number.isFinite(uzunluk) && uzunluk > SOZ_GOVDE_SINIRI) { k.abort(new Error('yanıt çok büyük')); return null; }
  if (!r.body) return r.json();
  const okuyucu = r.body.getReader();
  const parcalar: Uint8Array[] = [];
  let toplam = 0;
  for (;;) {
    const { done, value } = await okuyucu.read();
    if (done) break;
    toplam += value.byteLength;
    if (toplam > SOZ_GOVDE_SINIRI) {
      k.abort(new Error('yanıt çok büyük'));
      void okuyucu.cancel().catch(() => undefined);
      return null;
    }
    parcalar.push(value);
  }
  try { return JSON.parse(Buffer.concat(parcalar).toString('utf8')); } catch { return null; }
}

export interface SozBagimliliklari {
  fetch: (url: string, init: RequestInit) => Promise<SozYaniti>;
  /** Bulut şu an yasak mı (Gizli ya da "Yalnız bu bilgisayar"); her adımda yeniden sorulur. */
  yasak: () => boolean;
  /** Ayar değişince çağrılır (süren isteği kesmek için); dönüş: dinlemeyi bırak. */
  ayarDegisince: (f: () => void) => () => void;
  /** Önbellek dosyası (userData/soz-onbellek.json); null: yalnız bellekte. */
  dosya: () => string | null;
  /** Kaynak adresi (yalnız FUBER_DEMO'da sahte LRCLIB: FUBER_TEST_LRCLIB). */
  adres?: string;
  /** İstek sınırı (ms; test kısaltır). */
  sureMs?: number;
}

interface Girdi { anahtar: string; zaman: number; sonuc: SozSonucu }
type OnbellekSonucu = Extract<SozSonucu, { tur: 'esli' | 'duz' | 'bulunamadi' }>;

const nesneMi = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const dolu = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** LRCLIB gövdesini sonuca çevirir: eşli (satır çıkarsa) > düz > bulunamadı. */
function cevir(j: unknown): OnbellekSonucu {
  if (!nesneMi(j) || j.instrumental === true) return { tur: 'bulunamadi' };
  if (dolu(j.syncedLyrics)) {
    const satirlar = lrcAyristir(j.syncedLyrics.slice(0, METIN_SINIRI));
    if (satirlar.some((s) => s.metin)) return { tur: 'esli', satirlar };
  }
  if (dolu(j.plainLyrics)) return { tur: 'duz', metin: j.plainLyrics.slice(0, METIN_SINIRI).replace(/\r\n/g, '\n').trim() };
  return { tur: 'bulunamadi' };
}

/** Dosyadaki girdinin sonucu geçerli mi (elle bozulmuş dosya, eski sürüm). */
function sonucGecerli(s: unknown): s is OnbellekSonucu {
  if (!nesneMi(s)) return false;
  if (s.tur === 'bulunamadi') return true;
  if (s.tur === 'duz') return typeof s.metin === 'string';
  if (s.tur === 'esli') return Array.isArray(s.satirlar) && s.satirlar.every((x) => nesneMi(x) && typeof x.sn === 'number' && Number.isFinite(x.sn) && typeof x.metin === 'string');
  return false;
}

export type SozGetirici = (m: SozIstegi, sinyal?: AbortSignal) => Promise<SozSonucu>;

/** Bağımlılıklarıyla bir getirici (önbelleği kendi içinde; dosyadan bir kez okunur). */
export function sozGetirici(b: SozBagimliliklari): SozGetirici {
  let bellek: Map<string, Girdi> | null = null;
  const onbellek = (): Map<string, Girdi> => {
    if (bellek) return bellek;
    bellek = new Map();
    const d = b.dosya();
    const o = d ? jsonOku(d) : 'yok';
    if (typeof o === 'object' && Array.isArray(o.veri.girdiler)) {
      for (const g of o.veri.girdiler as unknown[]) {
        if (nesneMi(g) && typeof g.anahtar === 'string' && typeof g.zaman === 'number' && sonucGecerli(g.sonuc)) bellek.set(g.anahtar, { anahtar: g.anahtar, zaman: g.zaman, sonuc: g.sonuc });
      }
    }
    return bellek;
  };
  const yaz = (anahtar: string, sonuc: OnbellekSonucu) => {
    const m = onbellek();
    m.delete(anahtar); // yeniden eklenen sona geçer (Map ekleme sırası = yaş sırası)
    m.set(anahtar, { anahtar, zaman: Date.now(), sonuc });
    while (m.size > SOZ_ONBELLEK_SINIRI) m.delete(m.keys().next().value as string);
    const d = b.dosya();
    if (!d) return;
    try { jsonYaz(d, { surum: 1, girdiler: [...m.values()] }); } catch (e) { console.warn('[söz] önbellek yazılamadı:', (e as Error).message); }
  };

  return async (m, sinyal) => {
    const kapali: SozSonucu = { tur: 'kapali' };
    if (b.yasak()) return kapali;
    if (!dolu(m?.baslik)) return { tur: 'bulunamadi' };
    const anahtar = sozAnahtari(m);
    const kayit = onbellek().get(anahtar);
    if (kayit) return kayit.sonuc;
    if (sinyal?.aborted) return { tur: 'hata' };

    const url = new URL(b.adres ?? LRCLIB);
    url.searchParams.set('artist_name', m.sanatci.trim());
    url.searchParams.set('track_name', m.baslik.trim());
    if (dolu(m.album)) url.searchParams.set('album_name', m.album.trim());
    if (Number.isFinite(m.sure) && m.sure > 0) url.searchParams.set('duration', String(Math.round(m.sure)));

    const k = new AbortController();
    let gizlendi = false;
    const birak = b.ayarDegisince(() => { if (b.yasak()) { gizlendi = true; k.abort(new Error('bulut kapandı')); } });
    const sure = setTimeout(() => k.abort(new Error('süre doldu')), b.sureMs ?? LRCLIB_MS);
    const ustKes = () => k.abort(new Error('parça değişti'));
    sinyal?.addEventListener('abort', ustKes, { once: true });
    const kapandiMi = () => gizlendi || b.yasak();
    try {
      const r = await b.fetch(url.toString(), { headers: { 'User-Agent': LRCLIB_KULLANICI, Accept: 'application/json' }, signal: k.signal });
      if (kapandiMi()) return kapali;
      let sonuc: OnbellekSonucu;
      if (r.status === 404) sonuc = { tur: 'bulunamadi' };
      else if (!r.ok) return { tur: 'hata' };
      else {
        const j = await govdeOku(r, k);
        if (kapandiMi()) return kapali;
        if (j === null) return { tur: 'hata' }; // çok büyük ya da bozuk gövde: önbelleğe girmez
        sonuc = cevir(j);
      }
      if (k.signal.aborted) return kapandiMi() ? kapali : { tur: 'hata' };
      yaz(anahtar, sonuc);
      return sonuc;
    } catch {
      return kapandiMi() ? kapali : { tur: 'hata' };
    } finally {
      clearTimeout(sure);
      sinyal?.removeEventListener('abort', ustKes);
      birak();
    }
  };
}

// ── Uygulamanın tek getiricisi (ayarlar ve userData; Electron'a bağlı modüller ilk çağrıda yüklenir: bu dosya Electron'suz sınanır) ──────────────────
let tek: Promise<SozGetirici> | null = null;

async function varsayilan(): Promise<SozGetirici> {
  const [{ ayarlar, ayarDinle }, { yollar }, { bulutYasak }] = await Promise.all([import('./ayarlar.ts'), import('./yollar.ts'), import('../shared/bulut-kapisi.ts')]);
  const sahte = process.env.FUBER_DEMO ? process.env.FUBER_TEST_LRCLIB : undefined;
  return sozGetirici({
    fetch: (url, init) => fetch(url, init),
    yasak: () => { const y = ayarlar().yerel; return bulutYasak({ gizliMod: y.gizliMod === true, yalnizYerel: y.yalnizYerel === true }); },
    ayarDegisince: (f) => ayarDinle(() => f()),
    dosya: () => path.join(yollar.veri(), 'soz-onbellek.json'),
    ...(sahte ? { adres: sahte } : {}),
  });
}

/** Parçanın sözü (bkz. dosya başı). Hiç fırlatmaz. */
export async function sozGetir(m: SozIstegi, sinyal?: AbortSignal): Promise<SozSonucu> {
  try {
    tek ??= varsayilan();
    return await (await tek)(m, sinyal);
  } catch (e) {
    console.warn('[söz] alınamadı:', (e as Error).message);
    return { tur: 'hata' };
  }
}

// ── 'soz:getir' (ipc.ts): yeni istek süreni keser (hızlı atlamada kaynağa tek istek), en geç SOZ_TAVAN_MS'de yanıt ──────────────────────────────────────
let suren: AbortController | null = null;

export function sozIstegiAyikla(x: unknown): SozIstegi | null {
  if (!nesneMi(x) || typeof x.baslik !== 'string' || typeof x.sanatci !== 'string') return null;
  const sure = typeof x.sure === 'number' && Number.isFinite(x.sure) ? Math.max(0, x.sure) : 0;
  return { baslik: x.baslik.slice(0, 256), sanatci: x.sanatci.slice(0, 256), album: typeof x.album === 'string' ? x.album.slice(0, 256) : '', sure };
}

export async function sozIstegi(x: unknown): Promise<SozSonucu> {
  const m = sozIstegiAyikla(x);
  if (!m) return { tur: 'hata' };
  suren?.abort();
  const k = new AbortController();
  suren = k;
  let zaman: ReturnType<typeof setTimeout> | undefined;
  const tavan = new Promise<SozSonucu>((coz) => { zaman = setTimeout(() => { k.abort(); coz({ tur: 'hata' }); }, SOZ_TAVAN_MS); });
  try {
    return await Promise.race([sozGetir(m, k.signal), tavan]);
  } finally {
    clearTimeout(zaman);
    if (suren === k) suren = null;
  }
}
