// ── MCP OAuth: belirteç yuvası, SDK sağlayıcısı, belirteç aracısı, geri dönüş sunucusu (0.14 T16; Ruling R10) ───────────────────────────────
// Kullanıcı katalogdaki servise tek tıkla bağlanır. Akış SDK'nın OAuthClientProvider'ıyla (StreamableHTTPClientTransport `authProvider`):
//  • Geri dönüş: http://127.0.0.1:<rastgele kapı>/mcp-oauth/geri (RFC 8252; kapı açık, `localhost` yok), TEK kullanımlık: ilk geçerli dönüşte ya da 5 dk
//    sonra kapanır; `state` eşleşmeyen istek kabul edilmez. PKCE (S256) SDK'dan. Yetki sayfası sistem tarayıcısında (shell.openExternal); yalnız
//    FUBER_DEMO + FUBER_TEST_OAUTH_OTOMATIK=1'de adres tarayıcı yerine doğrudan getirilir (sahte sunucu kendiliğinden izin verir; kurulu uygulamada silinir).
//  • İstemci: sunucu dinamik kaydı (RFC 7591) destekliyorsa o, yoksa katalogdaki `istemciKimligi`. İstemci sırrı isteyen servis (`oauth.sirSunucuda`)
//    bu sürümde bağlanmaz: kod alışverişi ve yenileme barındırılan bir belirteç aracısından geçerdi (kaldırılan barındırılan servis; araciyaSor).
//  • Belirteç YALNIZ bu bilgisayarın sır yuvasında: sirYaz('mcp-oauth:<id>') (Windows şifrelemesi, safeStorage). ayarlar.json'a, günlüğe, arayüze gitmez.
//    Bağlanırken kayıt bellektedir; ancak bağlantı kurulunca bir kez yazılır (şifreleme yoksa hiçbir yere yazılmaz).
//  • Review Focus 4: erişim belirteci dolunca servis 401 verir, SDK yenileme belirteciyle BİR kez yeniler ve çağrı sürer. Yenileme reddedilirse (ya da
//    yenileme sonrası yine yetki gerekirse) sohbetin ortasında izin akışı BAŞLAMAZ: kayıt 'yenilenmeli' olur, araç "Bağlantı yenilenmeli…" der, ikinci deneme yok.
//    Yenileme geçici bir nedenle düşerse (ağ, 5xx, aracının kendi hatası, Gizli) kayıt bozulmaz: o anki hata söylenir.
//  • P14: her istek anında bulut kapısına bakılır (Gizli ya da "Yalnız bu bilgisayar" → istek hiç çıkmaz); süren istekler (MCP çağrısı, belirteç
//    yenilemesi, aracı) kapı kapanınca `bulutuKes()` ile kesilir (mcp-katalog.ts ayar dinleyicisi).
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { net, shell, safeStorage } from 'electron';
import type { OAuthClientProvider, OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { ayarlar, sirOku, sirYaz } from '../ayarlar.js';
import { bulutYasak, BULUT_KAPALI_METNI } from '../../shared/bulut-kapisi.js';
import { BAGLANTI_YENILENMELI_METNI } from '../../shared/mcp-baglanti.js';
import type { McpKatalogGirdisi } from '../../shared/mcp-katalog.js';
import { DAGITIM } from '../../shared/dagitim.js';

export const MCP_SIR_ONEKI = 'mcp-oauth:';
export const GERI_DONUS_YOLU = '/mcp-oauth/geri';
export const GERI_DONUS_SURESI_MS = 5 * 60_000;

// ── Kullanıcıya söylenebilen hatalar (tek cümle; ham sağlayıcı metni değil) ──
export class McpBulutKapali extends Error { constructor() { super(BULUT_KAPALI_METNI.mcp); this.name = 'McpBulutKapali'; } }
export class McpYenilenmeli extends Error { constructor() { super(BAGLANTI_YENILENMELI_METNI); this.name = 'McpYenilenmeli'; } }
export class McpBaglantiHatasi extends Error { constructor(m: string) { super(m); this.name = 'McpBaglantiHatasi'; } }

export const SERVISE_ULASILAMADI = 'Servise şu an ulaşılamıyor; biraz sonra yeniden dene.';
export const SIFRELEME_YOK = 'Bu bilgisayarda bağlantı bilgileri güvenle saklanamıyor (Windows şifrelemesi kullanılamıyor).';

// ── Bulut kapısı (P14) ──
/** İstek anındaki karar: Gizli ya da "Yalnız bu bilgisayar" → bulut yasak (shared/bulut-kapisi.ts). */
export const bulutKapaliMi = (): boolean => { const y = ayarlar().yerel; return bulutYasak({ gizliMod: y.gizliMod === true, yalnizYerel: y.yalnizYerel === true }); };
let bulutDenetcisi = new AbortController();
/** Bütün MCP ağ isteklerinin ortak kesme sinyali: kapı kapanınca kesilir, açılınca yenisi kurulur. */
export function bulutSinyali(): AbortSignal {
  if (bulutDenetcisi.signal.aborted && !bulutKapaliMi()) bulutDenetcisi = new AbortController();
  return bulutDenetcisi.signal;
}
/** Kapı kapandı: süren her MCP isteği (çağrı, belirteç yenilemesi, aracı) kesilir. */
export function bulutuKes(): void { if (!bulutDenetcisi.signal.aborted) bulutDenetcisi.abort(new McpBulutKapali()); }

// ── Bağlantı kaydı (sır yuvası) ──
export interface BaglantiKaydi {
  surum: 1;
  /** Bağlanılan adres (`http`: MCP adresi; `stdio`: komut). Katalogda değişirse kayıt 'yenilenmeli' sayılır (belirteç başka adrese gitmez). */
  adres: string;
  /** `stdio` (ürün kararı): kullanıcının onayladığı komutun sha256 özeti; komut değişirse yeniden onay. */
  komutOzeti?: string;
  /** Bağlanırken kullanılan geri dönüş adresi (yenilemede SDK'ya aynı adres verilir). */
  geriDonus?: string;
  tokens?: OAuthTokens;
  istemci?: OAuthClientInformationMixed;
  kesif?: OAuthDiscoveryState;
  /** Yenileme reddedildi: araç ağa çıkmadan "Bağlantı yenilenmeli" der; Bağlantılar "Yeniden bağla". */
  yenilenmeli?: boolean;
  zaman: string;
}
const kayitBellegi = new Map<string, BaglantiKaydi | null>();
/** Kaydı okur (bellekte tutulur); yoksa, bozuksa ya da çözülemiyorsa null. */
export function kayitOku(id: string): BaglantiKaydi | null {
  if (kayitBellegi.has(id)) return kayitBellegi.get(id)!;
  let k: BaglantiKaydi | null = null;
  try {
    const s = sirOku(MCP_SIR_ONEKI + id);
    const j = s ? (JSON.parse(s) as BaglantiKaydi) : null;
    if (j && j.surum === 1 && typeof j.adres === 'string') k = j;
  } catch { k = null; }
  kayitBellegi.set(id, k);
  return k;
}
/** Kaydı sır yuvasına yazar (null: siler). Windows şifrelemesi yoksa fırlatır (hiçbir yere yazılmaz). */
export function kayitYaz(id: string, k: BaglantiKaydi | null): void {
  sirYaz(MCP_SIR_ONEKI + id, k ? JSON.stringify(k) : null);
  kayitBellegi.set(id, k); // bağlıyken sağlayıcı aynı nesneyle çalışır (bellek ve yuva aynı hâli taşır)
}
/** Belirteç saklanabilir mi (Windows şifrelemesi). */
export const sifrelemeVarMi = (): boolean => { try { return safeStorage.isEncryptionAvailable(); } catch { return false; } };
/** Bellekteki kayıtları unutur (yalnız test ve kapanış; diskteki kayıt kalır). */
export const kayitBelleginiBosalt = (): void => kayitBellegi.clear();

// ── Test yönlendirmesi (YALNIZ FUBER_DEMO) ──
/** Önizleme/test: katalog https ister; sahte servis 127.0.0.1'dedir. FUBER_TEST_MCP_TABAN `.example` (RFC 2606, yalnız deneme) adreslerini bu kapıya
 *  çevirir: tek adres (hepsi) ya da `ad.example=http://127.0.0.1:P;…`. Yalnız loopback hedef; kurulu uygulamada kapı yalnız loopback bırakır. */
export function testHedefi(u: URL): URL | null {
  if (!process.env.FUBER_DEMO) return null;
  const t = process.env.FUBER_TEST_MCP_TABAN?.trim();
  if (!t || u.protocol !== 'https:' || !u.hostname.endsWith('.example')) return null;
  let taban: string | undefined;
  if (t.includes('=')) for (const p of t.split(';')) { const [h, a] = p.split('='); if (h?.trim() === u.hostname) taban = a?.trim(); }
  else taban = t;
  if (!taban) return null;
  let b: URL;
  try { b = new URL(taban); } catch { return null; }
  if (b.protocol !== 'http:' || (b.hostname !== '127.0.0.1' && b.hostname !== '[::1]')) return null;
  return new URL(`${u.pathname}${u.search}`, b);
}

// ── Ağ: MCP servisine, yetki sunucusuna ve belirteç aracısına giden her istek ──
/** Son belirteç isteğinin geçici hatası (ağ, 5xx, aracının kendi hatası, Gizli): yenileme bu yüzden düştüyse kayıt 'yenilenmeli' olmaz, bu hata söylenir. */
export interface GetirDurumu { sonHata: Error | null }
export type McpGetir = (adres: string | URL | Request, init?: RequestInit) => Promise<Response>;
type TemelGetir = (u: string, i: RequestInit) => Promise<Response>;

const belirtecFormu = (b: unknown): URLSearchParams | null => (b instanceof URLSearchParams && b.has('grant_type') ? b : null);

/** Services whose OAuth client secret would live on a hosted broker are not supported in this build: only secret-less (PKCE / dynamic registration) servers connect. */
async function araciyaSor(_g: McpKatalogGirdisi, _form: URLSearchParams, _sinyal: AbortSignal, durum: GetirDurumu): Promise<Response> {
  throw (durum.sonHata = new McpBaglantiHatasi('Bu servisin bağlanma biçimi desteklenmiyor.'));
}

/** Girdinin bütün HTTP trafiği (SDK'ya `fetch` olarak verilir). Her istekte bulut kapısı; her isteğe bulut sinyali; yalnız https (FUBER_DEMO'da test
 *  yönlendirmesi). Belirteç isteği (form gövdesinde grant_type) sırrı sunucuda duran girdide aracıya gider; geçici hatası `durum.sonHata`ya yazılır. */
export function mcpGetirOlustur(g: McpKatalogGirdisi, durum: GetirDurumu, temel: TemelGetir = (u, i) => net.fetch(u, i)): McpGetir {
  return async (adres, init = {}) => {
    const u = new URL(adres instanceof Request ? adres.url : String(adres));
    const form = belirtecFormu(init.body);
    if (form) durum.sonHata = null;
    if (bulutKapaliMi()) { const e = new McpBulutKapali(); if (form) durum.sonHata = e; throw e; }
    const sinyal = init.signal ? AbortSignal.any([init.signal, bulutSinyali()]) : bulutSinyali();
    try {
      if (form && g.oauth?.sirSunucuda) return await araciyaSor(g, form, sinyal, durum);
      const test = testHedefi(u);
      if (!test && u.protocol !== 'https:') throw new McpBaglantiHatasi('Servisin adresi güvenli değil (https değil).');
      // Son inceleme Minor 13: yönlendirme izlenmez (https denetimi yalnız ilk adrese yapılıyordu).
      const r = await temel((test ?? u).href, { ...init, body: form ? form.toString() : init.body, signal: sinyal, credentials: 'omit', cache: 'no-store', redirect: 'error' });
      if (form && r.status >= 500) durum.sonHata = new McpBaglantiHatasi(SERVISE_ULASILAMADI);
      return r;
    } catch (e) {
      const kapali = bulutKapaliMi() || sinyal.reason instanceof McpBulutKapali;
      if (form && !durum.sonHata) durum.sonHata = kapali ? new McpBulutKapali() : e instanceof McpBaglantiHatasi ? e : new McpBaglantiHatasi(SERVISE_ULASILAMADI);
      if (kapali) throw new McpBulutKapali();
      throw e;
    }
  };
}

// ── SDK sağlayıcısı ──
export interface Etkilesim {
  /** Bu bağlanmanın geri dönüş adresi. */
  geriDonus: string;
  /** OAuth `state` (geri dönüş sunucusu eşleştirir). */
  durum: string;
  /** Yetki adresini açar (tarayıcı); beklemez. */
  ac: (u: URL) => void;
}
export interface SaglayiciSecenekleri {
  girdi: McpKatalogGirdisi;
  /** Çalışan kayıt: bağlanırken bellekte (sonda bir kez yazılır), bağlıyken her değişiklik sır yuvasına. */
  kayit: BaglantiKaydi;
  kaydet: (k: BaglantiKaydi) => void;
  durum: GetirDurumu;
  /** Yalnız "Bağla" akışında: izin akışı yalnız burada başlar. Yoksa etkileşimsiz (sohbet, tur başı): izin gerekirse 'yenilenmeli'. */
  etkilesim?: Etkilesim;
}

export class FuberOauthSaglayici implements OAuthClientProvider {
  private dogrulayici = '';
  constructor(private readonly o: SaglayiciSecenekleri) {}

  get redirectUrl(): string {
    // Etkileşimsizde de tanımlı olmalı (SDK tanımsızı istemci kimlik bilgisi akışı sanar); yenileme yalnız belirteç ister.
    return this.o.etkilesim?.geriDonus ?? this.o.kayit.geriDonus ?? `http://127.0.0.1:1${GERI_DONUS_YOLU}`;
  }
  get clientMetadata(): OAuthClientMetadata {
    const kapsam = this.o.girdi.oauth?.kapsamlar?.join(' ');
    return {
      client_name: DAGITIM.urunAdi, redirect_uris: [this.redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      token_endpoint_auth_method: 'none', ...(kapsam ? { scope: kapsam } : {}),
    };
  }
  state(): string { return this.o.etkilesim?.durum ?? randomBytes(24).toString('base64url'); }

  /** Kayıtlı istemci; yoksa: sırrı sunucudaysa katalogdaki istemci kimliği; sunucu dinamik kaydı destekliyorsa undefined (SDK kaydeder); değilse katalogdaki
   *  istemci kimliği. Etkileşimsizde yeni kayıt yapılmaz ('yenilenmeli'). */
  clientInformation(): OAuthClientInformationMixed | undefined {
    const k = this.o.kayit;
    if (k.istemci) return k.istemci;
    const oa = this.o.girdi.oauth ?? {};
    if (oa.sirSunucuda) {
      if (oa.istemciKimligi) return { client_id: oa.istemciKimligi };
      throw new McpBaglantiHatasi('Bu bağlantının ayarı henüz tamamlanmadı; biraz sonra yeniden dene.');
    }
    if (!this.o.etkilesim) throw this.yenilenmeli();
    if (k.kesif?.authorizationServerMetadata?.registration_endpoint) return undefined;
    return oa.istemciKimligi ? { client_id: oa.istemciKimligi } : undefined;
  }
  saveClientInformation(i: OAuthClientInformationMixed): void { this.o.kayit.istemci = i; this.kalici(); }
  tokens(): OAuthTokens | undefined { return this.o.kayit.tokens; }
  saveTokens(t: OAuthTokens): void { this.o.kayit.tokens = t; delete this.o.kayit.yenilenmeli; this.kalici(); }
  redirectToAuthorization(u: URL): void {
    if (this.o.etkilesim) { this.o.etkilesim.ac(u); return; }
    // Sohbetin ortasında izin akışı başlamaz. Yenileme geçici nedenle düştüyse kayıt bozulmaz.
    if (this.o.durum.sonHata) throw this.o.durum.sonHata;
    throw this.yenilenmeli();
  }
  saveCodeVerifier(v: string): void { this.dogrulayici = v; }
  codeVerifier(): string {
    if (!this.dogrulayici) throw new McpBaglantiHatasi('Bağlantı tamamlanamadı; yeniden bağlanmayı dene.');
    return this.dogrulayici;
  }
  invalidateCredentials(kapsam: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    const k = this.o.kayit;
    if (kapsam === 'all' || kapsam === 'tokens') delete k.tokens;
    if (kapsam === 'all' || kapsam === 'client') delete k.istemci;
    if (kapsam === 'all' || kapsam === 'discovery') delete k.kesif;
    if (kapsam === 'all' || kapsam === 'verifier') this.dogrulayici = '';
    this.kalici();
  }
  saveDiscoveryState(s: OAuthDiscoveryState): void { this.o.kayit.kesif = s; this.kalici(); }
  discoveryState(): OAuthDiscoveryState | undefined { return this.o.kayit.kesif; }

  /** Bağla akışı bitti (kayıt yazıldı): aynı bağlantı bundan sonra etkileşimsiz çalışır — yenileme kaydı yazar, izin gerekirse 'yenilenmeli' olur. */
  etkilesimiBitir(): void { delete this.o.etkilesim; }

  /** Bağlıyken değişiklik hemen yazılır; bağlanırken kayıt sonda bir kez yazılır. */
  private kalici(): void { if (!this.o.etkilesim) this.o.kaydet(this.o.kayit); }
  private yenilenmeli(): McpYenilenmeli {
    if (!this.o.etkilesim) {
      this.o.kayit.yenilenmeli = true;
      try { this.o.kaydet(this.o.kayit); } catch { /* yazılamadı: bellekteki işaret yine 'yenilenmeli' der */ }
    }
    return new McpYenilenmeli();
  }
}

// ── Geri dönüş sunucusu ──
export type GeriDonusSonucu = { kod: string } | { hata: 'reddedildi' | 'sure' | 'iptal' | 'gecersiz' };
export interface GeriDonus { adres: string; durum: string; sonuc: Promise<GeriDonusSonucu>; kapat: () => void }

const SAYFA = (metin: string) => `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Fuber</title></head><body style="font:16px system-ui;margin:48px">${metin}</body></html>`;

/** Tek kullanımlık geri dönüş sunucusu: yalnız 127.0.0.1, rastgele kapı; ilk geçerli dönüşte (state eşleşir) ya da `sureMs` (5 dk) sonra kapanır. */
export async function geriDonusSunucusu(o: { sureMs?: number; sinyal?: AbortSignal } = {}): Promise<GeriDonus> {
  const durum = randomBytes(24).toString('base64url');
  let coz: (s: GeriDonusSonucu) => void = () => undefined;
  const sonuc = new Promise<GeriDonusSonucu>((c) => { coz = c; });
  let bitti = false;
  let zaman: ReturnType<typeof setTimeout> | undefined;
  const sayfa = (res: http.ServerResponse, durumKodu: number, metin: string) => {
    res.writeHead(durumKodu, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" });
    res.end(SAYFA(metin));
  };
  const sunucu = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (bitti || req.method !== 'GET' || u.pathname !== GERI_DONUS_YOLU) { res.writeHead(404); res.end(); return; }
    if (u.searchParams.get('state') !== durum) { sayfa(res, 400, 'Bu bağlantı isteği tanınmadı.'); return; }
    const kod = u.searchParams.get('code');
    const hata = u.searchParams.get('error');
    if (hata || !kod) { sayfa(res, 200, 'İzin verilmedi. Bu sekmeyi kapatabilirsin.'); bitir({ hata: hata === 'access_denied' ? 'reddedildi' : 'gecersiz' }); return; }
    sayfa(res, 200, 'Bağlantı tamam. Fuber’e dönebilirsin; bu sekmeyi kapatabilirsin.');
    bitir({ kod });
  });
  function bitir(s: GeriDonusSonucu): void {
    if (bitti) return;
    bitti = true;
    if (zaman) clearTimeout(zaman);
    coz(s);
    sunucu.close(); // yeni bağlantı kabul edilmez; süren yanıt tamamlanır
  }
  await new Promise<void>((c, r) => { sunucu.once('error', r); sunucu.listen(0, '127.0.0.1', () => c()); });
  zaman = setTimeout(() => bitir({ hata: 'sure' }), o.sureMs ?? GERI_DONUS_SURESI_MS);
  zaman.unref?.();
  if (o.sinyal?.aborted) bitir({ hata: 'iptal' });
  else o.sinyal?.addEventListener('abort', () => bitir({ hata: 'iptal' }), { once: true });
  const kapi = (sunucu.address() as AddressInfo).port;
  return { adres: `http://127.0.0.1:${kapi}${GERI_DONUS_YOLU}`, durum, sonuc, kapat: () => bitir({ hata: 'iptal' }) };
}

/** Yalnız test kipinde: loopback adrese GET (yönlendirme izlenmez); `location` başlığı döner. */
function yerelGetir(adres: string): Promise<{ durum: number; konum: string | null }> {
  return new Promise((coz, red) => {
    const q = http.get(adres, (r) => { r.resume(); r.on('end', () => coz({ durum: r.statusCode ?? 0, konum: typeof r.headers.location === 'string' ? r.headers.location : null })); });
    q.on('error', red);
    q.setTimeout(15_000, () => q.destroy(new Error('zaman aşımı')));
  });
}

/** Yetki sayfasını açar: sistem tarayıcısı (yalnız https). FUBER_DEMO'da gerçek tarayıcı açılmaz: adres bellekte kaydedilir (__fuberDisAdresler); ayrıca
 *  FUBER_TEST_OAUTH_OTOMATIK=1 ise adres doğrudan getirilir ve sahte sunucunun dönüşü geri dönüş sunucusuna iletilir (izin kendiliğinden). */
export async function yetkiAdresiniAc(u: URL, geriDonus: string): Promise<void> {
  if (process.env.FUBER_DEMO && process.env.FUBER_TEST_OAUTH_OTOMATIK === '1') {
    const hedef = testHedefi(u);
    if (!hedef) throw new McpBaglantiHatasi('Test yetki adresi yönlendirilemedi.');
    const r = await yerelGetir(hedef.href);
    if (!r.konum || !r.konum.startsWith(`${geriDonus}?`)) throw new McpBaglantiHatasi('Servis izin vermedi.');
    await yerelGetir(r.konum);
    return;
  }
  if (u.protocol !== 'https:' || u.username || u.password) throw new McpBaglantiHatasi('Servisin izin sayfası güvenli değil (https değil).');
  if (process.env.FUBER_DEMO) { ((globalThis as { __fuberDisAdresler?: string[] }).__fuberDisAdresler ??= []).push(u.href); return; }
  await shell.openExternal(u.href);
}
