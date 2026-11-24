// ── Yerel web araması (0.14 T14, Ruling R5) — ana süreç ──────────────────────────────────────────────────────────────────────
// Sunucuda arama sağlayıcısı yoksa (ya da sunucu 503 dönerse) `web_ara` aramayı kullanıcının KENDİ bilgisayarından, kendi IP'siyle yapar:
// önce DuckDuckGo HTML (`https://html.duckduckgo.com/html/`), sonuçsuz ya da engelliyse (403/429, "anomali" sayfası, ağ hatası) Bing
// (`https://www.bing.com/search`). Kredi düşmez. Her istek 8 sn ile sınırlıdır; çağıranın sinyali (Alt+Shift+Q, Gizli'ye geçiş) ikisini de keser.
// Sayfa ayıklama saf kodda (shared/arama-ayikla.ts). OpenRouter web eklentisi ya da sohbet modeli bu yolda hiç yoktur.
// Önizleme/test (FUBER_DEMO + FUBER_TEST_WEB_ARAMA): iki motorun tabanı yerel sahte sunucuya yönlenir; gerçek siteye istek gitmez.
import { net } from 'electron';
import { ddgAyikla, bingAyikla } from '../shared/arama-ayikla.js';
import { WEB_SINIR, type WebAramaSonucu } from '../shared/web-arama.js';

/** Tek motorun istek süresi (ms). */
export const YEREL_ARAMA_SURESI_MS = 8_000;

/** İki motor da yanıt vermediğinde (engel ya da ağ): çağıran "Şu an web'de arama yapılamıyor" der. Sonuçsuz arama bu hata DEĞİLDİR (boş liste döner). */
export class YerelAramaYapilamadi extends Error {
  readonly yerelAramaYapilamadi = true as const;
  constructor(readonly ayrinti: string) { super('Şu an web\'de arama yapılamıyor.'); this.name = 'YerelAramaYapilamadi'; }
}
export const yerelAramaYapilamadiMi = (e: unknown): e is YerelAramaYapilamadi => typeof e === 'object' && e !== null && (e as { yerelAramaYapilamadi?: unknown }).yerelAramaYapilamadi === true;

export type AramaGetir = (url: string, init: RequestInit) => Promise<Pick<Response, 'status' | 'ok' | 'text'>>;
export interface YerelAramaSecenekleri {
  getir?: AramaGetir;
  /** Motor tabanları (sonunda / yok). Varsayılan gerçek adresler; FUBER_DEMO'da FUBER_TEST_WEB_ARAMA iki motor için de tek taban. */
  taban?: { ddg: string; bing: string };
  sureMs?: number;
}

const GERCEK_TABAN = { ddg: 'https://html.duckduckgo.com', bing: 'https://www.bing.com' };
function varsayilanTaban(): { ddg: string; bing: string } {
  const t = process.env.FUBER_DEMO ? process.env.FUBER_TEST_WEB_ARAMA?.trim().replace(/\/+$/, '') : undefined;
  return t ? { ddg: t, bing: t } : GERCEK_TABAN;
}

// Sıradan bir masaüstü tarayıcı gibi görünür (motorlar kimliksiz istekte engel sayfası verir). Çerez ve önbellek yok.
const BASLIKLAR = {
  accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
  'accept-language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
};

/** Sayfa metni döner; engel (403/429/5xx, DuckDuckGo'nun 202 "anomali" yanıtı) ya da ağ hatasında null. Çağıran sinyali iptal edilirse fırlatır. */
async function sayfaAl(getir: AramaGetir, adres: string, sinyal: AbortSignal, sureMs: number): Promise<string | null> {
  try {
    const r = await getir(adres, { method: 'GET', headers: BASLIKLAR, signal: AbortSignal.any([sinyal, AbortSignal.timeout(sureMs)]), redirect: 'follow', cache: 'no-store', credentials: 'omit' } as RequestInit);
    if (r.status !== 200) return null; // 202: DuckDuckGo'nun bot denetimi; 403/429: engel
    return await r.text();
  } catch (e) {
    if (sinyal.aborted) throw e;
    return null;
  }
}

/** Aramayı bu bilgisayardan yapar. En çok `enCok` (1–10) sonuç; hiç sonuç yoksa [] (engel değil). İki motor da engelli/ulaşılamazsa `YerelAramaYapilamadi`. */
export async function yerelAra(sorgu: string, enCok: number, sinyal: AbortSignal, secenek: YerelAramaSecenekleri = {}): Promise<WebAramaSonucu[]> {
  const getir = secenek.getir ?? ((u, i) => net.fetch(u, i));
  const taban = secenek.taban ?? varsayilanTaban();
  const sure = secenek.sureMs ?? YEREL_ARAMA_SURESI_MS;
  const sinir = Math.max(1, Math.min(WEB_SINIR.sonuc, Math.floor(enCok) || 5));
  const q = encodeURIComponent(String(sorgu).trim().slice(0, 400));
  if (sinyal.aborted) throw sinyal.reason ?? new Error('iptal');

  let yanitVar = false; // en az bir motor sayfa verdi (sonuçsuz olsa da): "arama yapılamıyor" değil, "sonuç yok"
  const ddg = await sayfaAl(getir, `${taban.ddg}/html/?q=${q}`, sinyal, sure);
  if (ddg !== null) {
    yanitVar = true;
    const s = ddgAyikla(ddg, sinir);
    if (s.length) return s;
  }
  const bing = await sayfaAl(getir, `${taban.bing}/search?q=${q}&setlang=tr`, sinyal, sure);
  if (bing !== null) {
    yanitVar = true;
    const s = bingAyikla(bing, sinir);
    if (s.length) return s;
  }
  if (!yanitVar) throw new YerelAramaYapilamadi('DuckDuckGo ve Bing yanıt vermedi');
  return [];
}
