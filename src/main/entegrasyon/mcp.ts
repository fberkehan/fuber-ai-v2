// ── MCP istemcisi ────────────────────────────────────────────────────────────────────────────────────────────
// Her sohbette gerekli MCP sunucularına bağlanılıp doğru veri çekilir. → Sunucular ayarlarda (stdio komutu
// ya da HTTP adresi). Token için her sohbete HEPSİ eklenmez: "her sohbete bağla" işaretliler + mesaj sunucunun
// adı/açıklaması/araç adlarıyla eşleşenler o tura bağlanır; model gerekirse `mcp_kullan` ile tur ortasında bir
// sunucuyu kendisi açar. Bağlantılar 10 dk boşta kalınca kapanır. Claude Code'daki MCP tanımları (~/.claude.json) tek tıkla içe aktarılabilir.
// 0.14 T16: bunlar Developer'ın KENDİ sunucularıdır — yalnız Developer mode'da (Business mode'da listede yok, bağlanılmaz). Fuber kataloğunun servisleri
// (her modda) entegrasyon/mcp-katalog.ts'te; `mcp_kullan` ikisini de açar. Araç kuralları ortak (entegrasyon/mcp-arac.ts): sağlayıcıya uyan ad (özgün
// adla çağrı), düzleşmiş şema, yazan araç her çağrıda onay (görev boyu izin yok; readOnlyHint onaysız), sonuç 40.000'de gerçek boyu söyleyen notla.
// stdio komutunda satır sonu ya da denetim karakteri varsa kaydedilmez ve çalıştırılmaz. P14: Gizli ve "Yalnız bu bilgisayar"da hiç bağlanılmaz.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ayarlar, ayarlariKaydet, ayarDinle, sirOku, sirYaz, sirDosyasiOkunamiyor } from '../ayarlar.js';
import { aracKaydet, sema, metinKisalt, type Arac } from '../ajan/araclar/kayit.js';
import { sadelestir, anahtarKelimeler } from '../hafiza/normal.js';
import type { Ayarlar, McpSunucu } from '../../shared/tipler.js';
import { stdioKomutuReddi, baglantiYokMetni, BAGLANTI_YENILENMELI_METNI, MCP_SIR_OKUNAMADI_METNI } from '../../shared/mcp-baglanti.js';
import { BULUT_KAPALI_METNI } from '../../shared/bulut-kapisi.js';
import { mcpAraclariKur, type McpAracBilgisi, type McpCagriSonucu } from './mcp-arac.js';
import { bulutKapaliMi, bulutSinyali, McpBulutKapali, McpYenilenmeli, McpBaglantiHatasi } from './mcp-oauth.js';
import { katalogAraclariniKaydet, katalogServisleri, katalogServisiniAc } from './mcp-katalog.js';

// ── 0.14 son inceleme I7: `ortam` (env) ve `basliklar` (ör. Authorization) değerleri SIR yuvasında ─────────────────────────────────────────────
// Değerler sirYaz('mcp-sunucu:<id>') ile (safeStorage/DPAPI) saklanır; ayarlar.json'da yalnız ADLAR durur, değerin yerinde MCP_SIR_YER_TUTUCU. Böylece
// ayarlar:al, ayarlar:degisti ve telefon köprüsü (ayarlar:al TELEFONA_IZINLI) düz değer hiç görmez; Claude Code'dan içe aktarma listesi de yer tutucuyla
// döner. Bağlantı ana süreçte çözülmüş değerlerle kurulur (sunucuCoz). Kayıtta yer tutucu "eski değer kalsın" demektir. Açılışta eski düz değerler
// (0.14 öncesi) sır yuvasına taşınır (mcpSirlariniTasi): ayarlar.json'dan YALNIZ sır yazımı başarılıysa silinir; tekrar çalışınca bir şey yapmaz.
export const MCP_SIR_YER_TUTUCU = '••• kayıtlı';
type McpSirri = { ortam?: Record<string, string>; basliklar?: Record<string, string> };
const SIR_ALANLARI = ['ortam', 'basliklar'] as const;
const mcpSirAdi = (id: string): string => `mcp-sunucu:${id}`;
const maskele = (m: Record<string, string> | undefined): Record<string, string> | undefined =>
  m ? Object.fromEntries(Object.keys(m).map((k) => [k, MCP_SIR_YER_TUTUCU])) : undefined;
/** Düz (yer tutucu olmayan) değer taşıyor mu. */
const duzDegerVar = (s: Pick<McpSunucu, 'ortam' | 'basliklar'>): boolean =>
  SIR_ALANLARI.some((a) => Object.values(s[a] ?? {}).some((v) => v !== MCP_SIR_YER_TUTUCU));
/** Sır yuvasındaki değerler; okunamıyorsa (DPAPI yok, çözülemedi, bozuk değer, sır dosyası bütünüyle okunamıyor) 'okunamadi' — "yok" ile karışmaz. */
function mcpSirriOku(id: string): McpSirri | 'okunamadi' {
  if (sirDosyasiOkunamiyor()) return 'okunamadi';
  let h: string | undefined;
  try { h = sirOku(mcpSirAdi(id)); } catch { return 'okunamadi'; }
  if (!h) return {};
  try { const v = JSON.parse(h) as McpSirri; return v && typeof v === 'object' ? v : 'okunamadi'; } catch { return 'okunamadi'; }
}
const sirVeyaBos = (s: McpSirri | 'okunamadi'): McpSirri => (s === 'okunamadi' ? {} : s);
/** Son inceleme tur 2 (kaygı 3): kayıttaki yer tutuculu bir ad sır yuvasından çözülemiyor mu (okunamadı ya da kayıt yok). */
function cozulemeyenVar(s: Pick<McpSunucu, 'ortam' | 'basliklar'>, sir: McpSirri | 'okunamadi'): boolean {
  return SIR_ALANLARI.some((a) => Object.entries(s[a] ?? {}).some(([k, v]) => v === MCP_SIR_YER_TUTUCU && (sir === 'okunamadi' || typeof sir[a]?.[k] !== 'string')));
}
/** Satırın hata bayrağı (ayarlar.json'da yalnız boolean; değer yok). Değiştiyse yazılır. */
function sirBayraginiYaz(degisen: Map<string, boolean>): void {
  const fark = [...degisen].filter(([id, v]) => Boolean(ayarlar().mcp.find((x) => x.id === id)?.sirOkunamadi) !== v);
  if (!fark.length) return;
  ayarlariKaydet((a) => { for (const [id, v] of fark) { const x = a.mcp.find((y) => y.id === id); if (!x) continue; if (v) x.sirOkunamadi = true; else delete x.sirOkunamadi; } });
}
/** Açılışta (ve sınamada): her sunucunun gizli değerleri çözülebiliyor mu — çözülemeyenin satırı açık hata gösterir (Bağlantılar). */
export function mcpSirDurumunuDenetle(): void {
  sirBayraginiYaz(new Map(ayarlar().mcp.map((s) => [s.id, cozulemeyenVar(s, mcpSirriOku(s.id))])));
}
/** Gelen alanı (yer tutucu = eski değer) eski sır ve yedekle (Claude Code'un kendi dosyası) birleştirir; anahtarı listede olmayan değer düşer. */
function alaniBirlestir(gelen: Record<string, string> | undefined, eski: Record<string, string> | undefined, yedek: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!gelen) return undefined;
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(gelen)) {
    const d = v === MCP_SIR_YER_TUTUCU ? (eski?.[k] ?? yedek?.[k]) : v;
    if (typeof d === 'string') o[k] = d;
  }
  return o;
}
/** Bağlantı için çözülmüş kayıt (yalnız ana süreçte; hiçbir yere yazılmaz, gönderilmez). Düz değer (taşınamamış eski kayıt) olduğu gibi kullanılır. */
function sunucuCoz(s: McpSunucu): McpSunucu {
  const oku = mcpSirriOku(s.id);
  // Tur 2 (kaygı 3 kararı): bir ad bile çözülemiyorsa BAĞLANILMAZ — eksik kimlikle de (stdio sunucusu başka kimliğe düşebilirdi); satır hata gösterir.
  if (cozulemeyenVar(s, oku)) { sirBayraginiYaz(new Map([[s.id, true]])); throw new McpBaglantiHatasi(MCP_SIR_OKUNAMADI_METNI); }
  const sir = sirVeyaBos(oku);
  return { ...s, ortam: alaniBirlestir(s.ortam, sir.ortam, undefined), basliklar: alaniBirlestir(s.basliklar, sir.basliklar, undefined) };
}
/** Değerleri sır yuvasına yazar (boşsa kaydı siler); başarısızsa FIRLATIR (çağıran düz değeri silmez). */
function mcpSirriYaz(id: string, sir: McpSirri): void {
  const dolu = SIR_ALANLARI.some((a) => Object.keys(sir[a] ?? {}).length);
  sirYaz(mcpSirAdi(id), dolu ? JSON.stringify({ ...(sir.ortam ? { ortam: sir.ortam } : {}), ...(sir.basliklar ? { basliklar: sir.basliklar } : {}) }) : null);
}

/**
 * Açılış göçü (I7): ayarlar.json'daki düz MCP değerleri sır yuvasına. Her sunucu için önce sır yazılır; yalnız başarılıysa kayıt yer tutucuya döner. Sır
 * yazılamazsa (DPAPI yok, sır dosyası okunamıyor) düz değer yerinde kalır, bağlantı eskisi gibi çalışır, sonraki açılışta yeniden denenir. İkinci kayıt
 * .bak yedeğini de temizler (jsonYaz önceki dosyayı .bak'a kopyalar). Günlüğe değer ya da ad yazılmaz.
 */
export function mcpSirlariniTasi(): { tasinan: number; kalan: number } {
  const tasinan: string[] = [];
  let kalan = 0;
  for (const s of ayarlar().mcp) {
    if (!duzDegerVar(s)) continue;
    const eski = sirVeyaBos(mcpSirriOku(s.id)); // kaynak düz değerdir; okunamayan eski kayıt yalnız yer tutucuları çözemez
    if (cozulemeyenVar(s, mcpSirriOku(s.id))) { kalan++; continue; } // yarı düz yarı yer tutuculu kayıt: değer kaybolmasın diye dokunulmaz
    const sir: McpSirri = { ortam: alaniBirlestir(s.ortam, eski.ortam, undefined), basliklar: alaniBirlestir(s.basliklar, eski.basliklar, undefined) };
    try { mcpSirriYaz(s.id, sir); tasinan.push(s.id); } catch { kalan++; }
  }
  if (kalan) console.warn(`[mcp] ${kalan} sunucunun gizli değerleri sır yuvasına taşınamadı; bir sonraki açılışta yeniden denenecek.`);
  if (!tasinan.length) return { tasinan: 0, kalan };
  const maskeleKayit = (a: Ayarlar) => { for (const x of a.mcp) if (tasinan.includes(x.id)) { x.ortam = maskele(x.ortam); x.basliklar = maskele(x.basliklar); } };
  ayarlariKaydet(maskeleKayit);
  ayarlariKaydet(() => undefined); // .bak de yer tutuculu kopya olsun (ilk kayıt düz değerli eski dosyayı .bak'a kopyaladı)
  return { tasinan: tasinan.length, kalan };
}

interface Bag { client: Client; araclar: Arac[]; son: number; kapat: () => Promise<void> }
const baglar = new Map<string, Bag>();
const kuruluyor = new Map<string, Promise<Bag>>(); // sürmekte olan bağlantı: aynı sunucuya ikinci süreç açılmasın
const basarisiz = new Map<string, { zaman: number; mesaj: string }>(); // olumsuz önbellek
const aracAdOnbellek = new Map<string, string[]>(); // sunucu id → araç adları (eşleştirme için)
const BAGLANTI_SURESI = 30_000;
const HATA_BEKLEME = 5 * 60_000;

/** 0.14 T16 (P14): bağlı servisler ve mcp_kullan yalnız bulut açıkken (dongu.ts grupEtkin('mcp' | 'temel-mcp')). */
export const mcpEtkinMi = (): boolean => !bulutKapaliMi();
/** Developer'ın kendi sunucuları yalnız Developer mode'da (0.14 T16; Bağlantılar'daki bölüm de yalnız orada). */
const gelistirici = (): boolean => ayarlar().mod === 'gelistirici';

/** stdio kaydının reddi (null = geçerli). */
const kayitReddi = (s: Pick<McpSunucu, 'tur' | 'komut' | 'argumanlar'>): string | null => (s.tur === 'http' ? null : stdioKomutuReddi(s.komut, s.argumanlar ?? []));

/** Bağlantıyı kurar ya da hazırını verir. Az önce bağlanamayan sunucu 5 dk denenmez ("her sohbete" işaretli ölü bir
 *  sunucu her turu 30 sn bekletiyordu); `zorla` (Sına düğmesi) bu beklemeyi atlar. */
function baglan(s: McpSunucu, zorla = false): Promise<Bag> {
  dinleyiciKur();
  if (bulutKapaliMi()) return Promise.reject(new McpBulutKapali());
  const red = kayitReddi(s);
  if (red) return Promise.reject(new McpBaglantiHatasi(red));
  const v = baglar.get(s.id);
  if (v) { v.son = Date.now(); return Promise.resolve(v); }
  const suren = kuruluyor.get(s.id);
  if (suren) return suren;
  const h = basarisiz.get(s.id);
  if (!zorla && h && Date.now() - h.zaman < HATA_BEKLEME) {
    return Promise.reject(new Error(`${s.ad} az önce bağlanamadı (${h.mesaj}); ${Math.ceil((HATA_BEKLEME - (Date.now() - h.zaman)) / 60_000)} dk sonra yeniden denenecek.`));
  }
  const p = kur(s).then(
    (bag) => {
      // Bağlanırken ayar değiştiyse (mcpKaydet/mcpSil) bu bağlantı eskidir: kapat.
      if (kuruluyor.get(s.id) !== p) { void bag.kapat(); throw new Error('MCP ayarı değişti; yeniden dene.'); }
      kuruluyor.delete(s.id);
      basarisiz.delete(s.id);
      baglar.set(s.id, bag);
      bostaSaatiniKur();
      return bag;
    },
    (e: unknown) => {
      if (kuruluyor.get(s.id) === p) { kuruluyor.delete(s.id); basarisiz.set(s.id, { zaman: Date.now(), mesaj: metinKisalt((e as Error)?.message ?? String(e), 120) }); }
      throw e;
    },
  );
  kuruluyor.set(s.id, p);
  return p;
}

/** Developer'ın http sunucusunun fetch'i: istek anında bulut kapısı, bulut sinyaliyle kesilir. */
const httpGetir = (u: string | URL | Request, i: RequestInit = {}): Promise<Response> => {
  if (bulutKapaliMi()) return Promise.reject(new McpBulutKapali());
  return fetch(u, { ...i, signal: i.signal ? AbortSignal.any([i.signal, bulutSinyali()]) : bulutSinyali() });
};

async function kur(kayit: McpSunucu): Promise<Bag> {
  const s = sunucuCoz(kayit); // I7: başlık ve ortam değerleri yalnız burada, sır yuvasından çözülür
  const client = new Client({ name: 'fuber-ai', version: '0.1.0' });
  const tasima = s.tur === 'http'
    ? new StreamableHTTPClientTransport(new URL(String(s.url)), { requestInit: { headers: s.basliklar ?? {} }, fetch: httpGetir })
    : new StdioClientTransport({ command: String(s.komut), args: s.argumanlar ?? [], env: { ...(process.env as Record<string, string>), ...(s.ortam ?? {}) }, stderr: 'ignore' });
  let zaman: NodeJS.Timeout | undefined;
  let tools: McpAracBilgisi[];
  try {
    tools = await Promise.race([
      client.connect(tasima).then(() => client.listTools()).then((r) => r.tools as McpAracBilgisi[]),
      new Promise<never>((_, red) => { zaman = setTimeout(() => red(new Error(`MCP bağlantısı ${BAGLANTI_SURESI / 1000} sn içinde kurulamadı`)), BAGLANTI_SURESI); }),
    ]);
  } catch (e) {
    // Zaman aşımı/hata: taşıma ve (stdio'da) alt süreç kapatılır; yoksa her deneme arkada bir süreç bırakıyordu.
    try { await client.close(); } catch { /* bağlanmamıştı */ }
    try { await tasima.close(); } catch { /* kapalı */ }
    throw e;
  } finally {
    clearTimeout(zaman);
  }
  aracAdOnbellek.set(s.id, tools.map((t) => t.name));
  // 0.14 T13: araç sınırı aşılırsa servis adıyla tembel açılır (ajan/zincir.ts araclariSirala). 0.14 T16: ortak araç kuralları (mcp-arac.ts).
  const araclar = mcpAraclariKur({
    ad: s.ad, katalog: false, girdi: () => null, // araç adları `mcpg__<sunucu>__` (katalog servisleriyle çakışmaz)
    kapali: () => (bulutKapaliMi() ? BULUT_KAPALI_METNI.mcp : null),
    hataMetni: (e) => (bulutKapaliMi() || e instanceof McpBulutKapali ? BULUT_KAPALI_METNI.mcp : null),
    cagir: async (ad, g, sinyal) => {
      const bag = await baglan(s);
      return (await bag.client.callTool({ name: ad, arguments: g }, undefined, { signal: AbortSignal.any([sinyal, bulutSinyali()]), timeout: 120_000 })) as McpCagriSonucu;
    },
  }, tools);
  return { client, araclar, son: Date.now(), kapat: async () => { try { await client.close(); } catch { /* kapalı */ } } };
}

/** Ayar değişti/silindi: açık bağlantı kapanır, sürmekte olan kurulum ve olumsuz önbellek unutulur. */
function unut(id: string): void {
  const b = baglar.get(id); if (b) { baglar.delete(id); void b.kapat(); }
  kuruluyor.delete(id);
  basarisiz.delete(id);
  if (!baglar.size && bostaSaati) { clearInterval(bostaSaati); bostaSaati = null; }
}
/** Açık Developer bağlantısı sayısı (test ve denetim). */
export const mcpAcikBaglantiSayisi = (): number => baglar.size;

// Boştaki bağlantı 10 dk sonra kapanır. Düzeltme turu 1 (hafiflik): saat yalnız açık bağlantı varken döner.
let bostaSaati: ReturnType<typeof setInterval> | null = null;
function bostaSaatiniKur(): void {
  if (bostaSaati || !baglar.size) return;
  bostaSaati = setInterval(() => {
    for (const [id, b] of baglar) if (Date.now() - b.son > 10 * 60_000) { baglar.delete(id); void b.kapat(); }
    if (!baglar.size && bostaSaati) { clearInterval(bostaSaati); bostaSaati = null; }
  }, 60_000);
  bostaSaati.unref?.();
}

/** Düzeltme turu 1: Business mode'a ya da Gizli / "Yalnız bu bilgisayar"a geçilince Developer'ın açık bağlantıları (stdio süreçleri dahil) HEMEN kapanır. */
let dinleyici = false;
function dinleyiciKur(): void {
  if (dinleyici) return;
  dinleyici = true;
  ayarDinle(() => { if (!gelistirici() || bulutKapaliMi()) for (const id of [...baglar.keys(), ...kuruluyor.keys()]) unut(id); });
}

function ilgiliMi(s: McpSunucu, metin: string): boolean {
  if (s.her) return true;
  const kelime = new Set(anahtarKelimeler(metin, 30));
  const havuz = sadelestir(`${s.ad} ${s.aciklama} ${(aracAdOnbellek.get(s.id) ?? []).join(' ').replace(/[_-]/g, ' ')}`);
  for (const k of kelime) if (k.length >= 4 && havuz.includes(k.slice(0, Math.max(4, k.length - 2)))) return true;
  return false;
}

/** Bu tura bağlanacak Developer MCP araçları (Business mode'da ve Gizli / "Yalnız bu bilgisayar"da hiç). */
export async function mcpAraclari(metin: string): Promise<Arac[]> {
  if (!gelistirici() || bulutKapaliMi()) return [];
  // Paralel: yavaş/ölü bir sunucu ötekileri sıraya sokmasın; bağlanamayan sunucu atlanır.
  const sonuclar = await Promise.allSettled(ayarlar().mcp.filter((x) => x.etkin && ilgiliMi(x, metin)).map((s) => baglan(s)));
  return sonuclar.flatMap((r) => (r.status === 'fulfilled' ? r.value.araclar : []));
}

export async function mcpSina(s: McpSunucu): Promise<{ tamam: boolean; araclar?: string[]; hata?: string }> {
  try {
    const b = await baglan(s, true);
    return { tamam: true, araclar: b.araclar.map((a) => a.tanim.ad) };
  } catch (e) {
    return { tamam: false, hata: (e as Error).message };
  }
}

/** Kaydet: stdio komutunda satır sonu ya da denetim karakteri varsa reddedilir (fırlatır; kayıt değişmez). */
export function mcpKaydet(s: Omit<McpSunucu, 'id'> & { id?: string }): McpSunucu {
  const red = kayitReddi(s);
  if (red) throw new Error(red);
  const id = s.id || randomUUID();
  // I7: değerler sır yuvasına; kayıtta yalnız adlar + yer tutucu. Yer tutucu = eski değer kalsın (arayüzün anahtar/her sohbete kaydı); kayıtlı değeri olmayan
  // yer tutucu Claude Code'dan içe aktarmadır — değer ana süreçte ~/.claude.json'dan okunur (arayüze hiç gitmedi). Sır yazılamazsa kayıt DEĞİŞMEZ (fırlatır).
  const varolan = ayarlar().mcp.some((x) => x.id === id);
  const okunan = varolan ? mcpSirriOku(id) : {};
  // Tur 2 (kaygı 3 kararı): gizli değerler okunamıyorken yer tutuculu kayıt (anahtar, her sohbete…) onların üstüne yazamaz — reddedilir, kayıt değişmez.
  if (okunan === 'okunamadi' && SIR_ALANLARI.some((a) => Object.values(s[a] ?? {}).includes(MCP_SIR_YER_TUTUCU))) {
    throw new Error(`${MCP_SIR_OKUNAMADI_METNI} Değişiklik kaydedilmedi.`);
  }
  const eski = sirVeyaBos(okunan);
  // Minor (yeniden inceleme): içe aktarma yedeği yalnız aynı ad VE aynı komut ya da adresle (aynı adlı başka sunucu Claude Code'un değerlerini almaz).
  const yedek = claudeCodeMcpleriHam().find((x) => x.ad === s.ad && x.tur === s.tur && (s.tur === 'http' ? x.url === s.url : x.komut === s.komut));
  const sir: McpSirri = { ortam: alaniBirlestir(s.ortam, eski.ortam, yedek?.ortam), basliklar: alaniBirlestir(s.basliklar, eski.basliklar, yedek?.basliklar) };
  const degerVar = SIR_ALANLARI.some((a) => Object.keys(sir[a] ?? {}).length);
  if (degerVar || SIR_ALANLARI.some((a) => Object.keys(eski[a] ?? {}).length)) {
    try { mcpSirriYaz(id, sir); } catch (e) { throw new Error(`Sunucunun gizli değerleri güvenli olarak saklanamadı; kaydedilmedi (${(e as Error).message})`); }
  }
  const kayit: McpSunucu = { ...s, id, ortam: maskele(sir.ortam), basliklar: maskele(sir.basliklar) } as McpSunucu;
  delete kayit.sirOkunamadi; // yeni değerler yazıldı (ya da hiç gizli değer yok)
  if (!kayit.ortam) delete kayit.ortam;
  if (!kayit.basliklar) delete kayit.basliklar;
  ayarlariKaydet((a) => { const i = a.mcp.findIndex((x) => x.id === id); if (i >= 0) a.mcp[i] = kayit; else a.mcp.push(kayit); });
  unut(id);
  return kayit;
}
export function mcpSil(id: string): void {
  ayarlariKaydet((a) => { a.mcp = a.mcp.filter((x) => x.id !== id); });
  try { sirYaz(mcpSirAdi(id), null); } catch { /* sır dosyası okunamıyor: kayıt silindi, değer yuvada kalır (kimse okumaz) */ }
  unut(id);
}

/** Claude Code'un MCP tanımları, arayüz için (I7): ortam/başlık değerleri yer tutucuyla — düz değer ana süreçten çıkmaz. */
export function claudeCodeMcpleri(): Omit<McpSunucu, 'id'>[] {
  return claudeCodeMcpleriHam().map((s) => ({ ...s, ortam: maskele(s.ortam), basliklar: maskele(s.basliklar) }));
}

/** Claude Code'un MCP tanımları (~/.claude.json: genel + proje bazlı); YALNIZ ana süreçte (değerler düz). */
function claudeCodeMcpleriHam(): Omit<McpSunucu, 'id'>[] {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'));
    const kume: Record<string, { type?: string; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> }> = { ...(j.mcpServers ?? {}) };
    for (const p of Object.values((j.projects ?? {}) as Record<string, { mcpServers?: typeof kume }>)) Object.assign(kume, p.mcpServers ?? {});
    return Object.entries(kume).map(([ad, v]) => ({
      ad, aciklama: `Claude Code'dan aktarıldı (${ad})`,
      tur: v.url ? 'http' : 'stdio', komut: v.command, argumanlar: v.args, ortam: v.env, url: v.url, basliklar: v.headers, etkin: false, her: false,
    }));
  } catch {
    return [];
  }
}

const DURUM_ADI = { bagli: 'bağlı', 'bagli-degil': "bağlı değil; Bağlantılar'dan bağlanabilir", yenilenmeli: "bağlantısı yenilenmeli; Bağlantılar'dan yeniden bağlanabilir" } as const;

/** 0.14 T16: katalog servislerini (her mod; stdio olmayanlar Business'ta da) ve Developer'ın kendi sunucularını (yalnız Developer) açar. Bağlı olmayan
 *  katalog servisinin izni yalnız kullanıcıdan gelir: tek cümle (izin akışı başlamaz, onaysız komut çalışmaz). */
const mcpKullan: Arac = {
  grup: 'temel-mcp', risk: 'serbest',
  etiket: (g) => `MCP sunucusunu açıyor: ${g.sunucu}`,
  tanim: {
    ad: 'mcp_kullan',
    aciklama: 'Bağlı bir servisin (MCP) araçlarını bu konuşmaya açar. Önce boş çağırıp servis listesini gör.',
    sema: sema({ sunucu: { type: 'string', description: 'Servis ya da sunucu adı (boş = listele)' } }),
  },
  async calistir(g, ctx) {
    if (bulutKapaliMi()) return { icerik: BULUT_KAPALI_METNI.mcp, hata: true };
    const katalog = katalogServisleri();
    const yerel = gelistirici() ? ayarlar().mcp.filter((x) => x.etkin) : [];
    if (!g.sunucu) {
      const satirlar = [...katalog.map((k) => `- ${k.ad} (${DURUM_ADI[k.durum]}): ${k.aciklama}`), ...yerel.map((s) => `- ${s.ad}: ${s.aciklama}`)];
      return { icerik: satirlar.length ? satirlar.join('\n') : "Bağlı servis yok (Bağlantılar'dan bağlanabilir)." };
    }
    const aranan = sadelestir(String(g.sunucu));
    const bul = <T extends { ad: string }>(l: T[]) => l.find((x) => sadelestir(x.ad) === aranan) ?? l.find((x) => sadelestir(x.ad).includes(aranan));
    const k = bul(katalog);
    if (k) {
      if (k.durum === 'bagli-degil') return { icerik: baglantiYokMetni(k.ad), hata: true };
      if (k.durum === 'yenilenmeli') return { icerik: BAGLANTI_YENILENMELI_METNI, hata: true };
      try {
        const araclar = await katalogServisiniAc(k.id, ctx.sinyal); // Durdur bağlantı evresini de keser
        return { icerik: `${k.ad} açıldı. Araçlar: ${araclar.map((a) => a.tanim.ad).join(', ')}`, ozet: `${araclar.length} araç`, yeniAraclar: araclar };
      } catch (e) {
        return { icerik: e instanceof McpBulutKapali || e instanceof McpYenilenmeli || e instanceof McpBaglantiHatasi ? e.message : `${k.ad} açılamadı: ${metinKisalt((e as Error)?.message ?? String(e), 160)}`, hata: true };
      }
    }
    const s = bul(yerel);
    if (!s) return { icerik: 'Sunucu bulunamadı.', hata: true };
    const b = await baglan(s);
    return { icerik: `${s.ad} açıldı. Araçlar: ${b.araclar.map((a) => a.tanim.ad).join(', ')}`, ozet: `${b.araclar.length} araç`, yeniAraclar: b.araclar };
  },
};

export function mcpAraclariniKaydet(): void {
  aracKaydet(mcpKullan);
  katalogAraclariniKaydet(); // 0.14 T16: bağlı katalog servislerinin araçları (dinamik kaynak; her turda listede)
}
