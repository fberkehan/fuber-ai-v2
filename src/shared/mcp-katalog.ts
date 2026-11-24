// ── MCP kataloğu sözleşmesi (0.14 T0; saf → birim testli: tests/mcp-katalog.test.ts) ──
// Kullanıcı servislerini (Gmail, Takvim, Drive, Microsoft, Slack, Notion, GitHub) MCP üzerinden bağlar. Katalog Yönetim'den yönetilir,
// sunucudan gelir; Gizli modda yalnız bu bilgisayardaki önbellekten okunur (bulut-kapisi.ts). Girdiler başlangıçta KAPALIdır: Yönetim adres
// girilmeden girdiyi açmaz (Ruling R11). Girdi türü `http` (uzak uç; adres https olmak zorunda) ya da `stdio` (adres bir komut; B39).
// MCP'de yazan araç her seferinde onay ister; yalnız okuyan araç onaysızdır (aracOnayGerekirMi).

/** Katalog girdisinin simgesi (arayüzdeki marka karşılığı; `genel` bilinmeyenler için). */
export const MCP_SIMGELERI = ['gmail', 'takvim', 'drive', 'microsoft', 'slack', 'notion', 'github', 'genel'] as const;
export type McpSimgesi = (typeof MCP_SIMGELERI)[number];

/** Bağlantı türü: uzak `http` ucu ya da yerel `stdio` komutu. */
export type McpTuru = 'http' | 'stdio';

/** OAuth ayarı (Ruling R10). Sunucu dinamik istemci kaydını destekliyorsa `istemciKimligi` gerekmez; `sirSunucuda` istemci sırrı isteyen servis
 *  için kod ve yenileme alışverişinin sunucu üzerinden yapıldığını söyler (sır yalnız sunucuda durur). */
export interface McpOauth { istemciKimligi?: string; kapsamlar?: string[]; sirSunucuda?: boolean; belirtecAdresi?: string }

export interface McpKatalogGirdisi {
  /** `^[a-z0-9-]{2,40}$`. */
  id: string;
  ad: string;
  simge: McpSimgesi;
  aciklama: string;
  tur: McpTuru;
  /** `http` için https adresi; `stdio` için çalıştırılacak komut. Kapalı girdide boş olabilir. */
  adres: string;
  oauth: McpOauth | null;
  /** Onaysız çalışan (yalnız okuyan) araç adları; en çok 200. */
  saltOkunur: string[];
  /** Gündem takvimi için panel açılınca çağrılan araç (R12): araç adı + sabit girdi. */
  gundemAraci: { ad: string; girdi: Record<string, unknown> } | null;
  acik: boolean;
  sira: number;
}

const ID_DESENI = /^[a-z0-9-]{2,40}$/;
const SALT_OKUNUR_EN_COK = 200;
const ADRES_EN_COK = 2048;
const AD_EN_COK = 120;
const ACIKLAMA_EN_COK = 1000;

const metin = (x: unknown): x is string => typeof x === 'string';
const nesne = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** Adres geçerli, kullanıcı adı/parolasız bir https adresi mi. */
function httpsAdresiMi(a: string): boolean {
  let u: URL;
  try { u = new URL(a); } catch { return false; }
  return u.protocol === 'https:' && !u.username && !u.password;
}

function oauthDogrula(x: unknown): McpOauth | null | undefined {
  if (x === null) return null;
  if (!nesne(x)) return undefined;
  const o: McpOauth = {};
  if (x.istemciKimligi !== undefined) { if (!metin(x.istemciKimligi) || !x.istemciKimligi || x.istemciKimligi.length > 200) return undefined; o.istemciKimligi = x.istemciKimligi; }
  if (x.kapsamlar !== undefined) {
    if (!Array.isArray(x.kapsamlar) || x.kapsamlar.length > 100 || !x.kapsamlar.every((k) => metin(k) && k.length > 0 && k.length <= 200)) return undefined;
    o.kapsamlar = [...(x.kapsamlar as string[])];
  }
  if (x.sirSunucuda !== undefined) { if (typeof x.sirSunucuda !== 'boolean') return undefined; o.sirSunucuda = x.sirSunucuda; }
  if (x.belirtecAdresi !== undefined) { if (!metin(x.belirtecAdresi) || !httpsAdresiMi(x.belirtecAdresi)) return undefined; o.belirtecAdresi = x.belirtecAdresi; }
  return o;
}

/** Girdiyi doğrular ve temiz bir kopya döner; geçersizse null. Kurallar: kimlik deseni, bilinen simge ve tür, kısa metinler, en çok 200 salt okunur
 *  ad, `http` türünde adres (doluysa) https ve kullanıcı bilgisiz, AÇIK girdide adres dolu (`stdio` için komut). */
export function katalogGirdisiDogrula(x: unknown): McpKatalogGirdisi | null {
  if (!nesne(x)) return null;
  if (!metin(x.id) || !ID_DESENI.test(x.id)) return null;
  if (!metin(x.ad) || !x.ad.trim() || x.ad.length > AD_EN_COK) return null;
  if (!MCP_SIMGELERI.includes(x.simge as McpSimgesi)) return null;
  if (!metin(x.aciklama) || x.aciklama.length > ACIKLAMA_EN_COK) return null;
  if (x.tur !== 'http' && x.tur !== 'stdio') return null;
  if (!metin(x.adres) || x.adres.length > ADRES_EN_COK) return null;
  if (typeof x.acik !== 'boolean') return null;
  if (typeof x.sira !== 'number' || !Number.isInteger(x.sira) || x.sira < 0) return null;
  if (x.acik && !x.adres.trim()) return null;
  if (x.tur === 'http' && x.adres !== '' && !httpsAdresiMi(x.adres)) return null;
  const oauth = oauthDogrula(x.oauth === undefined ? null : x.oauth);
  if (oauth === undefined) return null;
  if (!Array.isArray(x.saltOkunur) || x.saltOkunur.length > SALT_OKUNUR_EN_COK || !x.saltOkunur.every((a) => metin(a) && a.length > 0 && a.length <= 200)) return null;
  let gundemAraci: McpKatalogGirdisi['gundemAraci'] = null;
  if (x.gundemAraci !== null && x.gundemAraci !== undefined) {
    const g = x.gundemAraci;
    if (!nesne(g) || !metin(g.ad) || !g.ad.trim() || g.ad.length > 200 || !nesne(g.girdi)) return null;
    gundemAraci = { ad: g.ad, girdi: { ...g.girdi } };
  }
  return {
    id: x.id, ad: x.ad, simge: x.simge as McpSimgesi, aciklama: x.aciklama, tur: x.tur, adres: x.adres, oauth,
    saltOkunur: [...(x.saltOkunur as string[])], gundemAraci, acik: x.acik, sira: x.sira,
  };
}

/** Listeyi doğrular: dizi olmalı, her girdi geçerli, kimlikler benzersiz. Biri bozuksa null (yarım katalog kullanılmaz). */
export function katalogListesiDogrula(x: unknown): McpKatalogGirdisi[] | null {
  if (!Array.isArray(x)) return null;
  const cikti: McpKatalogGirdisi[] = [];
  const kimlikler = new Set<string>();
  for (const e of x) {
    const g = katalogGirdisiDogrula(e);
    if (!g || kimlikler.has(g.id)) return null;
    kimlikler.add(g.id);
    cikti.push(g);
  }
  return cikti;
}

const ilk = (sira: number, id: string, ad: string, simge: McpSimgesi, aciklama: string, adres: string, oauth: McpOauth): McpKatalogGirdisi =>
  ({ id, ad, simge, aciklama, tur: 'http', adres, oauth, saltOkunur: [], gundemAraci: null, acik: false, sira });

/** İlk katalog (Ruling R11): yedi girdi, hepsi kapalı ve `http`. Adres yalnız bilinen uzak uçlarda dolu (GitHub, Notion); öbürlerinde boş,
 *  Yönetim adres girilmeden açmaz. */
export const ILK_KATALOG: McpKatalogGirdisi[] = [
  ilk(1, 'gmail', 'Gmail', 'gmail', 'E-postalarını okur ve taslak hazırlar.', '', {}),
  ilk(2, 'google-takvim', 'Google Takvim', 'takvim', 'Takvimindeki etkinlikleri okur ve ekler.', '', {}),
  ilk(3, 'google-drive', 'Google Drive', 'drive', 'Drive dosyalarını arar ve okur.', '', {}),
  ilk(4, 'microsoft-365', 'Microsoft 365', 'microsoft', 'Outlook, takvim ve OneDrive.', '', {}),
  ilk(5, 'slack', 'Slack', 'slack', 'Kanal ve mesajlarını okur.', '', {}),
  ilk(6, 'notion', 'Notion', 'notion', 'Sayfalarını ve veri tabanlarını arar ve okur.', 'https://mcp.notion.com/mcp', {}),
  ilk(7, 'github', 'GitHub', 'github', 'Depo, sorun ve çekme isteklerini okur.', 'https://api.githubcopilot.com/mcp/', { sirSunucuda: true }),
];

/** Okuma fiilleri (0.14 T16 düzeltme turu 1, denetleyici kararı): adı bunlardan biriyle başlayan ya da biten (ayırıcı `_` ya da `-`, büyük-küçük harf
 *  duyarsız) araç, servis ayrıca salt okunur ilan ediyorsa onaysız sayılabilir. */
export const OKUMA_FIILLERI = ['get', 'list', 'search', 'read', 'fetch', 'query', 'find', 'view', 'describe'] as const;
const OKUMA_BASI = new RegExp(`^(?:${OKUMA_FIILLERI.join('|')})(?:[_-]|$)`, 'i');
const OKUMA_SONU = new RegExp(`(?:^|[_-])(?:${OKUMA_FIILLERI.join('|')})$`, 'i');
/** Araç adı bir okuma fiiliyle başlıyor ya da bitiyor mu (`list_issues`, `issues-list`, `GET`). */
export const okumaFiilliMi = (ad: string): boolean => OKUMA_BASI.test(ad) || OKUMA_SONU.test(ad);

/** MCP aracı çağrılmadan önce kullanıcıdan onay gerekir mi. MCP'de yazan araç her seferinde onay ister.
 *  • Katalog servisi (`g` var; 0.14 T16 düzeltme turu 1, denetleyici kararı): yalnız iki durumda onaysız — (a) adı girdinin `saltOkunur` listesinde
 *    (Yönetim'den yönetilir), ya da (b) servis aracı `readOnlyHint: true` ilan ediyor, `destructiveHint` true DEĞİL ve adı bir okuma fiiliyle
 *    başlıyor ya da bitiyor (OKUMA_FIILLERI). Servisin ipucu tek başına hiçbir aracı onaysız yapmaz; yalnız sıkılaştırabilir. Çağıran kararı her
 *    çağrıda o anki katalog girdisiyle verir (bağlantı anında dondurulmaz).
 *  • Developer'ın kendi sunucusu (`g` null): bugünkü kural — `readOnlyHint: true` onaysız, gerisi onaylı. */
export function aracOnayGerekirMi(g: McpKatalogGirdisi | null, a: { name: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }): boolean {
  if (!g) return a.annotations?.readOnlyHint !== true;
  if (g.saltOkunur.includes(a.name)) return false;
  if (a.annotations?.readOnlyHint === true && a.annotations.destructiveHint !== true && okumaFiilliMi(a.name)) return false;
  return true;
}

// ── Takvim servisi ve gündem aracının kendiliğinden seçimi (5 Kas düzeltmesi; tests/takvim-servisi.test.ts) ──
// Kök neden: Gündem yalnız Yönetim'in `gundemAraci` girdiği girdiyi takvim sayıyordu; girdi yoksa bağlı takvim de etkinlik göstermiyordu. Artık takvim
// servisinin (simge `takvim`/`microsoft`) bağlı sunucusunun araçlarından etkinlik listeleyen OKUMA aracı seçilir; Yönetim'in tanımı varsa o önce gelir.

/** Gündem aracı Yönetim'de tanımlı değilken ana sürecin kullandığı yer tutucu ad: çağrı anında sunucunun araçlarından seçilir (gundemAraciSec). */
export const OTOMATIK_GUNDEM_ARACI = '__otomatik_takvim__';
const TAKVIM_SIMGELERI: readonly McpSimgesi[] = ['takvim', 'microsoft'];
/** Girdi takvim servisi mi: gündem aracı tanımlı ya da simgesi takvim/microsoft. */
export const takvimServisiMi = (g: Pick<McpKatalogGirdisi, 'simge' | 'gundemAraci'>): boolean => !!g.gundemAraci || TAKVIM_SIMGELERI.includes(g.simge);

/** Etkinlik listeleyen araç adları (İZİN listesi, hepsi baştan ve sondan çapalı), öncelik sırasıyla (Google Calendar MCP, Microsoft Graph MCP…).
 *  İnceleme I1: yasak fiil listesi yerine izin listesi — `clear_events_list` gibi adlar hiçbir desene uymaz. */
const ETKINLIK_DESENLERI: RegExp[] = [
  /^list[_-]?events$/i,
  /^list[_-]?calendar[_-]?(events|view)$/i,
  /^(get|list)[_-](today[_-]|upcoming[_-])?(calendar[_-])?events$/i,
  /^(search|find|query)[_-](calendar[_-])?events$/i,
  /^events?[_-](list|search)$/i,
];

interface AracOzeti { name: string; inputSchema?: unknown; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }

/** Bağlı takvim sunucusunun araçlarından bugünün etkinliklerini okuyacak aracı ve girdisini seçer; uygun okuma aracı yoksa null. Girdi şemadaki bilinen
 *  alanlarla doldurulur: zaman aralığı (bu bilgisayarın bugünü, gece yarısından gece yarısına), takvim kimliği `primary`, tekil etkinlikler, sıra, sayı. */
const adUyar = (a: AracOzeti): boolean => ETKINLIK_DESENLERI.some((d) => d.test(a.name));
/** İnceleme I1: kendiliğinden (onaysız, 15 dk'da bir) çağrılabilir mi — YALNIZ servis `readOnlyHint: true` ilan ediyor VE olağan onay kuralı
 *  (aracOnayGerekirMi) onaysız diyor. Ad buluşsalı tek başına hiçbir aracı seçtirmez. */
const kendiligindenCagrilir = (a: AracOzeti, g: McpKatalogGirdisi | null): boolean =>
  a.annotations?.readOnlyHint === true && a.annotations.destructiveHint !== true && !aracOnayGerekirMi(g, a);
/** Adı etkinlik listeler gibi olan araç var ama hiçbiri kendiliğinden çağrılamıyor (salt okunur ilanı yok ya da onay istiyor): Gündem çağırmaz,
 *  tek satırla takvimin onay/ayar istediğini söyler. */
export function gundemAraciOnayIster(araclar: readonly AracOzeti[], g: McpKatalogGirdisi | null = null): boolean {
  return araclar.some(adUyar) && !araclar.some((a) => adUyar(a) && kendiligindenCagrilir(a, g));
}
export function gundemAraciSec(araclar: readonly AracOzeti[], simdi: number, g: McpKatalogGirdisi | null = null): { ad: string; girdi: Record<string, unknown> } | null {
  const uygun = araclar.filter((a) => kendiligindenCagrilir(a, g));
  let secilen: AracOzeti | undefined;
  for (const d of ETKINLIK_DESENLERI) { secilen = uygun.find((a) => d.test(a.name)); if (secilen) break; }
  if (!secilen) return null;
  const sema = secilen.inputSchema;
  const alanlar = sema && typeof sema === 'object' && (sema as { properties?: unknown }).properties && typeof (sema as { properties?: unknown }).properties === 'object'
    ? Object.keys((sema as { properties: Record<string, unknown> }).properties) : [];
  const var_ = (ad: string): boolean => alanlar.includes(ad);
  const gun = new Date(simdi); gun.setHours(0, 0, 0, 0);
  const yarin = new Date(gun); yarin.setDate(gun.getDate() + 1);
  const bas = gun.toISOString(), bit = yarin.toISOString();
  const girdi: Record<string, unknown> = {};
  for (const [b, s] of [['timeMin', 'timeMax'], ['time_min', 'time_max'], ['startDateTime', 'endDateTime'], ['start_date_time', 'end_date_time'], ['startTime', 'endTime'], ['start', 'end']] as const) {
    if (var_(b) && var_(s)) { girdi[b] = bas; girdi[s] = bit; break; }
  }
  for (const k of ['calendarId', 'calendar_id']) if (var_(k)) girdi[k] = 'primary';
  for (const k of ['singleEvents', 'single_events']) if (var_(k)) girdi[k] = true;
  for (const k of ['orderBy', 'order_by']) if (var_(k)) girdi[k] = 'startTime';
  for (const k of ['maxResults', 'max_results']) if (var_(k)) girdi[k] = 50;
  return { ad: secilen.name, girdi };
}
