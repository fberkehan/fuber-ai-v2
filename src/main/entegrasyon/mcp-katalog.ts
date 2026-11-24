// ── MCP kataloğu: her modda bağlı servisler (0.14 T16; R10, R11, B36, B39, P14) ───────────────────────────────────────────────────────────
// MCP neredeyse oraya bağlanılır; kullanıcı katalogdaki servise tek tıkla bağlanır. Katalog (Gmail, Takvim, Drive, Microsoft 365, Slack, Notion,
// GitHub…) barındırılan servisten gelir (kaldırılan barındırılan servis; yalnız açık girdiler) ve bu bilgisayarda önbelleğe alınır (userData/mcp-katalog.json):
//  • katalogYenile: hesap durumu yenilenirken (main.ts). Arıza (ağ, 5xx, 401, bozuk gövde, eski sunucu) önbelleği silmez; sunucu gerçekten `{ katalog: [] }`
//    derse liste boştur ("Şu an sunulan bağlantı yok"). Gizli ve "Yalnız bu bilgisayar"da HİÇ ağa çıkılmaz: katalog yalnız önbellekten okunur (P14); süren
//    istek kapı kapanınca kesilir, geç gelen yanıt önbelleğe yazılmaz.
//  • Görünürlük: `http` girdileri her modda; `stdio` girdileri (bu bilgisayarda komut çalıştırır) yalnız Developer mode'da (B39).
//  • Bağla (mcpBagla): http → OAuth (mcp-oauth.ts; PKCE, 127.0.0.1 geri dönüş, dinamik kayıt ya da istemciKimligi, sırrı sunucuda olanlar aracıdan); süren
//    Bağla "Vazgeç" ile (mcpBaglantiyiKes) iptal edilir. stdio → ürün kararı (2 Kas): komut kullanıcı görmeden ve onaylamadan HİÇ başlamaz. "Bağla" önce
//    onay kartı döner (komutun tamamı + servis adı); komut ancak kart onaylanınca (komutun sha256 özetiyle) ilk kez başlar; özet kayıtta saklanır,
//    Yönetim komutu değiştirirse sonraki başlatma yeniden sorar.
//  • Araçlar: bağlı servisin araçları HER turda listede (ilgililik süzgeci yok). Düzeltme turu 1 (tur başı bekleme): araç listesi SIRSIZ olarak diske
//    önbelleklenir (userData/mcp-araclar.json; ad, açıklama, şema, ipuçları — belirteç yok); açılışta araçlar ağa çıkmadan listede olur, bağlantı ilk
//    çağrıda kurulur ve listeyi tazeler. Listesi hiç olmayan servis için tur en çok 3 sn bekler (turun Durdur sinyaline bağlı); bağlantı arka planda sürer,
//    o turda `mcp_kullan` süren bağlantıyı paylaşır, kullanıcıya sohbet başına bir satır düşer. Bağlanamamış servis turu hiç bekletmez (arka planda yeniden).
//  • Onay (düzeltme turu 1, denetleyici kararı): karar HER çağrıda o anki katalog girdisinden (saltOkunur; shared/mcp-katalog.ts aracOnayGerekirMi).
//  • P14: kapı kapanınca (ayar dinleyicisi) süren her istek kesilir (bulutuKes), bağlantılar kapanır; araçlar listeden çıkar; çağrı ağa çıkmadan
//    BULUT_KAPALI_METNI.mcp döner. Gündem (T24) için mcpKatalogAraciCagir da aynı kapıdan geçer ve yalnız girdinin gündem aracını çağırır.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { app } from 'electron';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ayarlar, ayarDinle } from '../ayarlar.js';
import { yollar } from '../yollar.js';
import { dinamikAracKaynagi, type Arac } from '../ajan/araclar/kayit.js';
import { katalogListesiDogrula, gundemAraciSec, gundemAraciOnayIster, OTOMATIK_GUNDEM_ARACI, takvimServisiMi, type McpKatalogGirdisi } from '../../shared/mcp-katalog.js';
import { BULUT_KAPALI_METNI } from '../../shared/bulut-kapisi.js';
import { komutAyristir, komutSatiri } from '../../shared/komut-satiri.js';
import {
  stdioKomutuReddi, baglantiYokMetni, yanitVermiyorMetni, BAGLANTI_YENILENMELI_METNI, type McpBaglantiDurumu, type McpKatalogGorunumu, type McpKatalogKarti,
} from '../../shared/mcp-baglanti.js';
import { mcpAraclariKur, type McpAracBilgisi, type McpCagriSonucu, type McpServisi } from './mcp-arac.js';
import {
  kayitOku, kayitYaz, sifrelemeVarMi, bulutKapaliMi, bulutSinyali, bulutuKes, mcpGetirOlustur, geriDonusSunucusu, yetkiAdresiniAc, FuberOauthSaglayici,
  McpBulutKapali, McpYenilenmeli, McpBaglantiHatasi, SIFRELEME_YOK, SERVISE_ULASILAMADI, type BaglantiKaydi, type Etkilesim, type GetirDurumu,
} from './mcp-oauth.js';

const BAGLANTI_SURESI = 30_000;
const CAGRI_SURESI = 120_000;
const BOSTA_KAPAT_MS = 10 * 60_000;
/** Bağlanamayan servis bu süre geçmeden tur başında yeniden denenmez; denendiğinde de tur onu beklemez (arka planda). Bağla ve çağrı yine dener. */
const HATA_BEKLEME_MS = 2 * 60_000;
/** Araç listesi hiç olmayan bağlı servis için tur başında en uzun bekleme (düzeltme turu 1). */
export const HAZIRLIK_AZAMI_MS = 3_000;
/** Araç çağrısının bağlantı evresine ayrılan en uzun süre (yeniden inceleme 1): yanıt vermeyen servis çağrıyı 30 sn bekletmez. */
export const CAGRI_BAGLANTI_MS = 10_000;
const SUNULMUYOR = 'Bu bağlantı şu an sunulmuyor.';

// ── Katalog önbelleği ──
const onbellekYolu = (): string => path.join(yollar.veri(), 'mcp-katalog.json');
let bellek: { imza: string; liste: McpKatalogGirdisi[] } | null = null;

/** Yazım yarıda kesilirse eski dosya sağlam kalır (geçici dosya + yeniden adlandırma). */
function atomikYaz(yol: string, veri: unknown): void {
  fs.mkdirSync(path.dirname(yol), { recursive: true });
  const gecici = `${yol}.${process.pid}.yaziliyor`;
  fs.writeFileSync(gecici, JSON.stringify(veri));
  fs.renameSync(gecici, yol);
}

/** Önbellekteki katalog (yalnız açık girdiler, `sira`ya göre). Hiç alınmadıysa ya da okunamıyorsa boş. Ağa çıkmaz. */
export function katalogOku(): McpKatalogGirdisi[] {
  let imza: string;
  try { const s = fs.statSync(onbellekYolu()); imza = `${s.mtimeMs}:${s.size}`; } catch { return []; }
  if (bellek?.imza === imza) return bellek.liste;
  let liste: McpKatalogGirdisi[] = [];
  try {
    const j = JSON.parse(fs.readFileSync(onbellekYolu(), 'utf8')) as { katalog?: unknown };
    liste = (katalogListesiDogrula(j?.katalog) ?? []).filter((g) => g.acik).sort((a, b) => a.sira - b.sira || a.id.localeCompare(b.id));
  } catch { liste = []; }
  bellek = { imza, liste };
  return liste;
}
function onbellegeYaz(liste: readonly McpKatalogGirdisi[]): void { atomikYaz(onbellekYolu(), { surum: 1, katalog: liste }); bellek = null; }

const gelistirici = (): boolean => ayarlar().mod === 'gelistirici';
/** Bu modda görünen girdiler: `stdio` yalnız Developer mode'da (B39). */
export const gorunenKatalog = (): McpKatalogGirdisi[] => katalogOku().filter((g) => g.tur === 'http' || gelistirici());
const gorunenGirdi = (id: string): McpKatalogGirdisi | null => gorunenKatalog().find((g) => g.id === id) ?? null;

async function yenile(): Promise<void> {
  // No hosted MCP catalog in this build: users add MCP servers themselves in Settings.
  return;
}

let suren: Promise<void> | null = null;
/** Sunucudan tazeler (hesap durumu yenilenirken; main.ts). Hiç fırlatmaz; aynı anda gelen çağrılar tek istek. */
export function katalogYenile(): Promise<void> {
  dinleyiciKur();
  suren ??= yenile().catch((e) => { console.warn(`[mcp] katalog yenilenemedi: ${(e as Error)?.message ?? e}`); }).finally(() => { suren = null; });
  return suren;
}

// ── Durum ──
/** stdio girdisinin komutu (program + argümanlar). */
export const komutParcalari = (g: McpKatalogGirdisi): string[] => komutAyristir(g.adres);
/** Onaylanan komutun özeti (ürün kararı): sha256(JSON(program + argümanlar)). */
export const komutOzeti = (parcalar: readonly string[]): string => createHash('sha256').update(JSON.stringify(parcalar)).digest('hex');

function durumOf(g: McpKatalogGirdisi): McpBaglantiDurumu {
  const k = kayitOku(g.id);
  if (!k) return 'bagli-degil';
  if (k.yenilenmeli || k.adres !== g.adres) return 'yenilenmeli';
  if (g.tur === 'stdio' && k.komutOzeti !== komutOzeti(komutParcalari(g))) return 'yenilenmeli';
  return 'bagli';
}
/** Katalog servisinin bu bilgisayardaki hâli. */
export function mcpBaglantiDurumu(id: string): McpBaglantiDurumu {
  const g = katalogOku().find((x) => x.id === id);
  return g ? durumOf(g) : 'bagli-degil';
}

// ── Araç listesi önbelleği (düzeltme turu 1; SIRSIZ: ad, başlık, açıklama, şema, ipuçları) ──
const aracOnbellekYolu = (): string => path.join(yollar.veri(), 'mcp-araclar.json');
type AracKaydi = { adres: string; araclar: McpAracBilgisi[] };
let aracDiski: Record<string, AracKaydi> | null = null;
const ARAC_AZAMI = 1_000;
const nesneMi = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** `tools/list` öğesinin yalnız kullanılan, sır taşımayan alanları (diskten okurken de aynı süzgeç). Bozuksa null. */
function aracBilgisiSade(x: unknown): McpAracBilgisi | null {
  if (!nesneMi(x) || typeof x.name !== 'string' || !x.name || x.name.length > 200) return null;
  const a = nesneMi(x.annotations) ? x.annotations : {};
  const sema = nesneMi(x.inputSchema) && JSON.stringify(x.inputSchema).length <= 200_000 ? x.inputSchema : undefined;
  return {
    name: x.name,
    ...(typeof x.title === 'string' ? { title: x.title.slice(0, 200) } : {}),
    ...(typeof x.description === 'string' ? { description: x.description.slice(0, 4_000) } : {}),
    ...(sema ? { inputSchema: sema } : {}),
    annotations: { ...(a.readOnlyHint === true ? { readOnlyHint: true } : {}), ...(a.destructiveHint === true ? { destructiveHint: true } : {}), ...(typeof a.title === 'string' ? { title: a.title.slice(0, 200) } : {}) },
  };
}
function aracDiskiOku(): Record<string, AracKaydi> {
  if (aracDiski) return aracDiski;
  const d: Record<string, AracKaydi> = {};
  try {
    const j = JSON.parse(fs.readFileSync(aracOnbellekYolu(), 'utf8')) as { surum?: unknown; servisler?: unknown };
    if (j?.surum === 1 && nesneMi(j.servisler)) {
      for (const [id, v] of Object.entries(j.servisler)) {
        if (!nesneMi(v) || typeof v.adres !== 'string' || !Array.isArray(v.araclar) || v.araclar.length > ARAC_AZAMI) continue;
        const araclar = v.araclar.map(aracBilgisiSade);
        if (araclar.every((a): a is McpAracBilgisi => a !== null)) d[id] = { adres: v.adres, araclar };
      }
    }
  } catch { /* yok ya da bozuk: boş */ }
  aracDiski = d;
  return d;
}
function aracDiskiYaz(id: string, k: AracKaydi | null): void {
  const d = { ...aracDiskiOku() };
  if (k) d[id] = k; else delete d[id];
  aracDiski = d;
  try { atomikYaz(aracOnbellekYolu(), { surum: 1, servisler: d }); } catch (e) { console.warn(`[mcp] araç listesi önbelleğe yazılamadı: ${(e as Error)?.message ?? e}`); }
}

// ── Bağlantılar ──
interface Bag { girdi: McpKatalogGirdisi; client: Client; araclar: Arac[]; bilgiler: McpAracBilgisi[]; son: number; kapat: () => Promise<void> }
const baglar = new Map<string, Bag>();
const kuruluyor = new Map<string, Promise<Bag>>();
/** Bellekteki araç listesi (canlı bağlantıdan ya da disk önbelleğinden). `adres`: listenin ait olduğu adres/komut. */
const aracListesi = new Map<string, { adres: string; araclar: Arac[] }>();
const basarisiz = new Map<string, number>();
/** Kurulmakta olan her bağlantının iptali (yeniden inceleme 1): bağlantı kapatılınca (mod/Gizli geçişi, Bağlantıyı kes, çıkış) süren kurulum da kesilir —
 *  stdio'da süreç hemen kapanır, kurulum tamamlanıp yerleşmez. */
const kurulumIptalleri = new Map<string, AbortController>();
/** Kurulum iptal edildi (bağlantı kapatıldı). */
class McpKurulumIptal extends McpBaglantiHatasi { constructor() { super('Bağlantı kapatıldı.'); this.name = 'McpKurulumIptal'; } }
const durduruldu = (): Error => Object.assign(new Error('Durduruldu.'), { name: 'AbortError' });

let bostaSaati: ReturnType<typeof setInterval> | null = null;
/** Boştaki bağlantı 10 dk sonra kapanır (araç listesi kalır). Saat yalnız açık bağlantı varken döner (düzeltme turu 1, hafiflik). */
function bostaSaatiniKur(): void {
  if (bostaSaati || !baglar.size) return;
  bostaSaati = setInterval(() => {
    for (const [id, b] of baglar) if (Date.now() - b.son > BOSTA_KAPAT_MS) baglantiyiKapat(id);
  }, 60_000);
  bostaSaati.unref?.();
}
function baglantiyiKapat(id: string): void {
  const b = baglar.get(id);
  baglar.delete(id);
  kuruluyor.delete(id);
  kurulumIptalleri.get(id)?.abort();
  kurulumIptalleri.delete(id);
  if (b) void b.kapat();
  if (!baglar.size && bostaSaati) { clearInterval(bostaSaati); bostaSaati = null; }
}
/** Servisin araç listesini bellekten ve diskten siler (adres değişti, bağlantı kesildi). */
function listeyiUnut(id: string): void {
  aracListesi.delete(id);
  if (aracDiskiOku()[id]) aracDiskiYaz(id, null);
}

/** Bağlıyken çağrı anında sorulur (ağa çıkmadan): metin dönerse araç çalışmaz. */
function kapaliMetni(id: string): string | null {
  if (bulutKapaliMi()) return BULUT_KAPALI_METNI.mcp;
  const g = gorunenGirdi(id);
  if (!g) return SUNULMUYOR;
  const d = durumOf(g);
  return d === 'bagli' ? null : d === 'yenilenmeli' ? BAGLANTI_YENILENMELI_METNI : baglantiYokMetni(g.ad);
}
/** Çağrı fırladı: bilinen hataların tek cümlesi. */
function cagriHataMetni(id: string, e: unknown): string | null {
  if (bulutKapaliMi() || e instanceof McpBulutKapali || (e as { name?: string })?.name === 'McpBulutKapali') return BULUT_KAPALI_METNI.mcp;
  if (e instanceof McpYenilenmeli) { baglantiyiKapat(id); return BAGLANTI_YENILENMELI_METNI; }
  if (e instanceof McpBaglantiHatasi) return e.message;
  return null;
}

function servisOf(g: McpKatalogGirdisi): McpServisi {
  const id = g.id;
  return {
    ad: g.ad, katalog: true,
    girdi: () => gorunenGirdi(id), // onay kararı her çağrıda güncel girdiden (saltOkunur)
    kapali: () => kapaliMetni(id),
    hataMetni: (e) => cagriHataMetni(id, e),
    async cagir(ozgunAd, girdi, sinyal) {
      const guncel = gorunenGirdi(id);
      if (!guncel) throw new McpBaglantiHatasi(SUNULMUYOR);
      const bag = await cagriIcinBaglan(guncel, sinyal); // bağlantı yoksa (açılış, boşta kapandı) burada, ilk çağrıda kurulur
      return (await bag.client.callTool({ name: ozgunAd, arguments: girdi }, undefined, { signal: AbortSignal.any([sinyal, bulutSinyali()]), timeout: CAGRI_SURESI })) as McpCagriSonucu;
    },
  };
}

/** Çağrının bağlantısı (yeniden inceleme 1): açık bağlantı varsa o; servis olumsuz önbellekteyse (yakın zamanda bağlanamadı) beklemeden "yanıt vermiyor";
 *  değilse kurulum en çok CAGRI_BAGLANTI_MS (10 sn) beklenir — aşılırsa servis olumsuz önbelleğe girer (sonraki çağrılar hemen döner), kurulum arka planda
 *  sürer. Turun Durdur sinyali bağlantı evresini de anında keser (AbortError). */
async function cagriIcinBaglan(g: McpKatalogGirdisi, sinyal?: AbortSignal): Promise<Bag> {
  const v = baglar.get(g.id);
  if (v && v.girdi.adres === g.adres) { v.son = Date.now(); return v; }
  const son = basarisiz.get(g.id);
  if (son !== undefined && Date.now() - son <= HATA_BEKLEME_MS) throw new McpBaglantiHatasi(yanitVermiyorMetni(g.ad));
  if (sinyal?.aborted) throw durduruldu();
  const p = baglan(g);
  p.catch(() => undefined); // yarış bırakılırsa sonuç arka planda (yerleşir ya da olumsuz önbelleğe girer)
  let zaman: ReturnType<typeof setTimeout> | undefined;
  let birak: () => void = () => undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, red) => { zaman = setTimeout(() => { basarisiz.set(g.id, Date.now()); red(new McpBaglantiHatasi(yanitVermiyorMetni(g.ad))); }, CAGRI_BAGLANTI_MS); }),
      new Promise<never>((_, red) => { if (sinyal) { birak = () => red(durduruldu()); sinyal.addEventListener('abort', birak, { once: true }); } }),
    ]);
  } finally {
    clearTimeout(zaman);
    sinyal?.removeEventListener('abort', birak);
  }
}

/** Servisin bellekteki ya da diskteki araç listesi (aynı adrese aitse); yoksa null. Ağa çıkmaz. */
function listeAl(g: McpKatalogGirdisi): Arac[] | null {
  const c = aracListesi.get(g.id);
  if (c && c.adres === g.adres) return c.araclar;
  const d = aracDiskiOku()[g.id];
  if (!d || d.adres !== g.adres) return null;
  const araclar = mcpAraclariKur(servisOf(g), d.araclar);
  aracListesi.set(g.id, { adres: g.adres, araclar });
  return araclar;
}

/** Taşıma: stdio (yalnız onaylı komut; ortam değişkenleri SDK'nın güvenli alt kümesi) ya da Streamable HTTP (+ OAuth sağlayıcısı). */
function tasimaKur(g: McpKatalogGirdisi, kayit: BaglantiKaydi, etkilesim?: Etkilesim): { tasima: Transport; saglayici?: FuberOauthSaglayici } {
  if (g.tur === 'stdio') {
    const [komut, ...argumanlar] = komutParcalari(g);
    const red = stdioKomutuReddi(komut, argumanlar);
    if (red) throw new McpBaglantiHatasi(red);
    return { tasima: new StdioClientTransport({ command: komut, args: argumanlar, stderr: 'ignore' }) };
  }
  const durum: GetirDurumu = { sonHata: null };
  const saglayici = g.oauth ? new FuberOauthSaglayici({ girdi: g, kayit, kaydet: (k) => kayitYaz(g.id, k), durum, ...(etkilesim ? { etkilesim } : {}) }) : undefined;
  const tasima = new StreamableHTTPClientTransport(new URL(g.adres), {
    fetch: mcpGetirOlustur(g, durum), ...(saglayici ? { authProvider: saglayici } : {}),
    reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
  });
  return { tasima, ...(saglayici ? { saglayici } : {}) };
}

/** İstemciyi açar ve araçları listeler (30 sn; bulut kapanırsa ya da `iptal` gelirse hemen kesilir). Hata ve iptalde taşıma ve (stdio'da) alt süreç
 *  kapatılır. */
async function istemciAc(g: McpKatalogGirdisi, tasima: Transport, iptal?: AbortSignal): Promise<Bag> {
  const client = new Client({ name: 'fuber-ai', version: app.getVersion() });
  let zaman: ReturnType<typeof setTimeout> | undefined;
  const bulut = bulutSinyali();
  let ham: unknown[];
  try {
    ham = await Promise.race([
      client.connect(tasima).then(() => client.listTools(undefined, { signal: bulut, timeout: BAGLANTI_SURESI })).then((r) => r.tools as unknown[]),
      new Promise<never>((_, red) => { zaman = setTimeout(() => red(new McpBaglantiHatasi(SERVISE_ULASILAMADI)), BAGLANTI_SURESI); }),
      new Promise<never>((_, red) => { if (bulut.aborted) red(new McpBulutKapali()); else bulut.addEventListener('abort', () => red(new McpBulutKapali()), { once: true }); }),
      new Promise<never>((_, red) => { if (!iptal) return; if (iptal.aborted) red(new McpKurulumIptal()); else iptal.addEventListener('abort', () => red(new McpKurulumIptal()), { once: true }); }),
    ]);
  } catch (e) {
    // İptal ya da bulut kapısı (yeniden inceleme 1): stdio süreci hemen sonlandırılır (SDK'nın kapanışı önce 2 sn bekler); süreç başka iş yapmaz.
    if ((e instanceof McpKurulumIptal || e instanceof McpBulutKapali) && tasima instanceof StdioClientTransport && tasima.pid) {
      try { process.kill(tasima.pid); } catch { /* zaten kapandı */ }
    }
    try { await client.close(); } catch { /* bağlanmamıştı */ }
    try { await tasima.close(); } catch { /* kapalı */ }
    throw e;
  } finally {
    clearTimeout(zaman);
  }
  const bilgiler = ham.slice(0, ARAC_AZAMI).map(aracBilgisiSade).filter((a): a is McpAracBilgisi => a !== null);
  return {
    girdi: g, client, araclar: mcpAraclariKur(servisOf(g), bilgiler), bilgiler, son: Date.now(),
    kapat: async () => { try { await client.close(); } catch { /* kapalı */ } },
  };
}

function yerlestir(g: McpKatalogGirdisi, bag: Bag): void {
  const eski = baglar.get(g.id);
  if (eski && eski !== bag) void eski.kapat();
  baglar.set(g.id, bag);
  aracListesi.set(g.id, { adres: g.adres, araclar: bag.araclar });
  aracDiskiYaz(g.id, { adres: g.adres, araclar: bag.bilgiler });
  basarisiz.delete(g.id);
  bostaSaatiniKur();
}

/** Bağlı servise bağlanır ya da hazırını verir (etkileşimsiz: izin akışı başlamaz; onaysız stdio başlamaz). Süren kurulum paylaşılır. */
function baglan(g: McpKatalogGirdisi): Promise<Bag> {
  dinleyiciKur();
  const v = baglar.get(g.id);
  if (v && v.girdi.adres === g.adres) { v.son = Date.now(); return Promise.resolve(v); }
  const s = kuruluyor.get(g.id);
  if (s) return s;
  const iptal = new AbortController();
  const p: Promise<Bag> = (async () => {
    if (bulutKapaliMi()) throw new McpBulutKapali();
    const d = durumOf(g);
    if (d === 'bagli-degil') throw new McpBaglantiHatasi(baglantiYokMetni(g.ad));
    if (d === 'yenilenmeli') throw new McpYenilenmeli();
    return istemciAc(g, tasimaKur(g, kayitOku(g.id)!).tasima, iptal.signal);
  })().then(
    (bag) => {
      // Kurulum sürerken bağlantı kapatıldıysa ya da girdi artık görünmüyorsa (Business mode'a geçildi, katalogdan kalktı) yerleşmez.
      if (kuruluyor.get(g.id) !== p || !gorunenGirdi(g.id)) {
        if (kuruluyor.get(g.id) === p) kuruluyor.delete(g.id);
        void bag.kapat();
        throw new McpKurulumIptal();
      }
      kuruluyor.delete(g.id);
      if (kurulumIptalleri.get(g.id) === iptal) kurulumIptalleri.delete(g.id);
      yerlestir(g, bag);
      return bag;
    },
    (e: unknown) => {
      if (kuruluyor.get(g.id) === p) { kuruluyor.delete(g.id); basarisiz.set(g.id, Date.now()); }
      if (kurulumIptalleri.get(g.id) === iptal) kurulumIptalleri.delete(g.id);
      throw e;
    },
  );
  kuruluyor.set(g.id, p);
  kurulumIptalleri.set(g.id, iptal);
  return p;
}

// ── Araçlar (ajan döngüsü) ──
/** Bu turda listede olan katalog araçları (senkron; dinamikAracKaynagi): görünen, bağlı (ya da 'yenilenmeli': çağrı ağa çıkmadan söyler) servislerin
 *  bellekteki ya da diskteki araç listesi (aynı adrese ait). Ağa çıkmaz. Gizli ve "Yalnız bu bilgisayar"da boş. */
export function katalogAraclari(): Arac[] {
  if (bulutKapaliMi()) return [];
  const out: Arac[] = [];
  for (const g of gorunenKatalog()) if (durumOf(g) !== 'bagli-degil') out.push(...(listeAl(g) ?? []));
  return out;
}

/** `sozler` bitene, `ms` dolana ya da `sinyal` kesilene dek bekler (hangisi önce). Zamanlayıcı ve dinleyici temizlenir. */
async function enCok(sozler: Promise<unknown>[], ms: number, sinyal?: AbortSignal): Promise<void> {
  if (!sozler.length || sinyal?.aborted) return;
  let zaman: ReturnType<typeof setTimeout> | undefined;
  let birak: () => void = () => undefined;
  await Promise.race([
    Promise.allSettled(sozler),
    new Promise<void>((c) => { zaman = setTimeout(c, ms); }),
    new Promise<void>((c) => { if (sinyal) { birak = () => c(); sinyal.addEventListener('abort', birak, { once: true }); } }),
  ]);
  clearTimeout(zaman);
  sinyal?.removeEventListener('abort', birak);
}

/** Tur başında (dongu.ts turAraclari; düzeltme turu 1). Araç listesi ne bellekte ne diskte olan bağlı servise bağlanmaya başlar (kayıtlı belirteçle;
 *  tarayıcı açılmaz) ve en çok `azamiMs` (3 sn) ya da `sinyal` (Durdur) kesilene dek bekler; bağlantı arka planda sürer. Önceden bağlanamamış servis
 *  beklenmez (süresi dolduysa arka planda yeniden denenir); süren kurulum (önceki tur, mcp_kullan) yeniden beklenmez. Dönen: hâlâ hazırlanan servislerin
 *  adları (kullanıcıya bir satır). Hiç fırlatmaz. */
export async function katalogAraclariniHazirla(o: { sinyal?: AbortSignal; azamiMs?: number } = {}): Promise<string[]> {
  if (bulutKapaliMi()) return [];
  const simdi = Date.now();
  const eksik = gorunenKatalog().filter((g) => durumOf(g) === 'bagli' && !listeAl(g));
  const beklenecek: Promise<unknown>[] = [];
  for (const g of eksik) {
    if (kuruluyor.has(g.id)) continue;
    const son = basarisiz.get(g.id);
    if (son !== undefined && simdi - son <= HATA_BEKLEME_MS) continue;
    const p = baglan(g);
    p.catch((e: unknown) => console.warn(`[mcp] ${g.ad} araçları alınamadı: ${String((e as Error)?.message ?? e).slice(0, 160)}`));
    if (son === undefined) beklenecek.push(p);
  }
  await enCok(beklenecek, o.azamiMs ?? HAZIRLIK_AZAMI_MS, o.sinyal);
  return eksik.filter((g) => !listeAl(g) && kuruluyor.has(g.id)).map((g) => g.ad);
}

/** mcp_kullan için: bu modda görünen katalog servisleri ve hâlleri. */
export const katalogServisleri = (): { id: string; ad: string; aciklama: string; durum: McpBaglantiDurumu }[] =>
  gorunenKatalog().map((g) => ({ id: g.id, ad: g.ad, aciklama: g.aciklama, durum: durumOf(g) }));

/** mcp_kullan: bağlı katalog servisini bu tura açar (araçlarını döner; süren kurulumu paylaşır). Bağlı değilse ya da yenilenmeliyse tek cümleyle fırlatır
 *  (izin akışı başlamaz). */
export async function katalogServisiniAc(id: string, sinyal?: AbortSignal): Promise<Arac[]> {
  if (bulutKapaliMi()) throw new McpBulutKapali();
  const g = gorunenGirdi(id);
  if (!g) throw new McpBaglantiHatasi(SUNULMUYOR);
  const d = durumOf(g);
  if (d !== 'bagli') throw d === 'yenilenmeli' ? new McpYenilenmeli() : new McpBaglantiHatasi(baglantiYokMetni(g.ad));
  return (await cagriIcinBaglan(g, sinyal)).araclar;
}

// ── Bağla / Bağlantıyı kes ──
export interface McpBaglaSonucu {
  tamam: boolean;
  hata?: string;
  /** Kullanıcı süren bağlanmadan vazgeçti (mcpBaglantiyiKes): hata gösterilmez. */
  iptal?: boolean;
  /** stdio (ürün kararı): komut başlamadan önce kullanıcıya gösterilecek kart — servis adı, komutun tamamı (program + argümanlar) ve özeti. Onay
   *  `mcpBagla(id, { komutOzeti })` ile döner; özet o anki komutunkiyle eşleşmezse yeniden kart. */
  onay?: { ad: string; komut: string; parcalar: string[]; ozet: string };
}

/** Kullanıcıya söylenecek tek cümle (ham hata günlüğe, sırsız). */
function kullaniciHatasi(e: unknown): string {
  if (bulutKapaliMi() || e instanceof McpBulutKapali) return BULUT_KAPALI_METNI.mcp;
  if (e instanceof McpYenilenmeli || e instanceof McpBaglantiHatasi) return e.message;
  const m = String((e as Error)?.message ?? e);
  console.warn(`[mcp] bağlanılamadı: ${(e as Error)?.name ?? 'Hata'}: ${m.slice(0, 200)}`);
  if (/dynamic client registration/i.test(m)) return 'Bu servise şu an tek tıkla bağlanılamıyor.';
  return 'Servise bağlanılamadı; biraz sonra yeniden dene.';
}

async function stdioBagla(g: McpKatalogGirdisi, onaylanan?: string): Promise<McpBaglaSonucu> {
  const parcalar = komutParcalari(g);
  const [komut, ...argumanlar] = parcalar;
  const red = stdioKomutuReddi(komut, argumanlar);
  if (red) return { tamam: false, hata: red };
  const ozet = komutOzeti(parcalar);
  // Ürün kararı: komut kullanıcı görmeden ve onaylamadan başlamaz; gösterilen komutun özetiyle onaylanır (araya giren değişiklik yeniden sorulur).
  if (onaylanan !== ozet) return { tamam: false, onay: { ad: g.ad, komut: komutSatiri(komut, argumanlar), parcalar, ozet } };
  // Yeniden inceleme 1: "Vazgeç" (mcpBaglantiyiKes) süren stdio kurulumunu da durdurur — süreç kapanır, kayıt yazılmaz, eski kayıt (varsa) korunur.
  const vazgec = new AbortController();
  iptaller.set(g.id, () => vazgec.abort());
  try {
    let bag: Bag;
    try { bag = await istemciAc(g, tasimaKur(g, { surum: 1, adres: g.adres, zaman: new Date().toISOString() }).tasima, vazgec.signal); }
    catch (e) { if (vazgec.signal.aborted) return { tamam: false, iptal: true }; throw e; }
    if (vazgec.signal.aborted) { await bag.kapat(); return { tamam: false, iptal: true }; }
    try { kayitYaz(g.id, { surum: 1, adres: g.adres, komutOzeti: ozet, zaman: new Date().toISOString() }); } catch { await bag.kapat(); return { tamam: false, hata: SIFRELEME_YOK }; }
    yerlestir(g, bag);
    return { tamam: true };
  } finally {
    iptaller.delete(g.id);
  }
}

/** Süren bağlanmaların (OAuth ve stdio) iptali (Bağlantılar'daki "Vazgeç" → mcpBaglantiyiKes). */
const iptaller = new Map<string, () => void>();

async function httpBagla(g: McpKatalogGirdisi): Promise<McpBaglaSonucu> {
  const geri = await geriDonusSunucusu({ sinyal: bulutSinyali() });
  let acmaHatasi: unknown = null;
  let vazgecildi = false;
  iptaller.set(g.id, () => { vazgecildi = true; geri.kapat(); });
  try {
    const kayit: BaglantiKaydi = { surum: 1, adres: g.adres, geriDonus: geri.adres, zaman: new Date().toISOString() };
    const etkilesim: Etkilesim = {
      geriDonus: geri.adres, durum: geri.durum,
      ac: (u) => { void yetkiAdresiniAc(u, geri.adres).catch((e: unknown) => { acmaHatasi = e; geri.kapat(); }); },
    };
    const ilk = tasimaKur(g, kayit, etkilesim);
    let bag: Bag | null = null;
    let saglayici = ilk.saglayici;
    try { bag = await istemciAc(g, ilk.tasima); } // izin istemeyen servis hemen bağlanır
    catch (e) { if (!(e instanceof UnauthorizedError)) throw e; }
    if (!bag) {
      const s = await geri.sonuc;
      if ('hata' in s) {
        if (vazgecildi) return { tamam: false, iptal: true };
        if (acmaHatasi) return { tamam: false, hata: kullaniciHatasi(acmaHatasi) };
        if (bulutKapaliMi()) return { tamam: false, hata: BULUT_KAPALI_METNI.mcp };
        return { tamam: false, hata: s.hata === 'reddedildi' ? 'İzin verilmedi.' : s.hata === 'sure' ? 'Süre doldu; yeniden dene.' : 'Bağlantı tamamlanamadı; yeniden dene.' };
      }
      await (ilk.tasima as StreamableHTTPClientTransport).finishAuth(s.kod);
      // İkinci açılış izin akışını yeniden başlatamaz: servis belirteci yine kabul etmezse açık hata.
      const ikinci = tasimaKur(g, kayit, { ...etkilesim, ac: () => { throw new McpBaglantiHatasi('Servis izni kabul etmedi; yeniden bağlanmayı dene.'); } });
      saglayici = ikinci.saglayici;
      bag = await istemciAc(g, ikinci.tasima);
    }
    if (vazgecildi) { await bag.kapat(); return { tamam: false, iptal: true }; }
    delete kayit.yenilenmeli;
    try { kayitYaz(g.id, kayit); } catch { await bag.kapat(); return { tamam: false, hata: SIFRELEME_YOK }; }
    // Kayıt yazıldı: bu bağlantı artık etkileşimsiz (yenileme yuvaya yazar; izin gerekirse 'yenilenmeli', tarayıcı açılmaz).
    saglayici?.etkilesimiBitir();
    yerlestir(g, bag);
    return { tamam: true };
  } finally {
    iptaller.delete(g.id);
    geri.kapat();
  }
}

const bagliyor = new Map<string, Promise<McpBaglaSonucu>>();
/** Bağla (Bağlantılar → "Bağla" / "Yeniden bağla"): http → OAuth (tarayıcıda izin); stdio → önce onay kartı (yalnız Developer mode). Gizli ve "Yalnız bu
 *  bilgisayar"da ağa çıkmadan reddedilir. Aynı servise ikinci tık süreni bekler. */
export function mcpBagla(id: string, o: { komutOzeti?: string } = {}): Promise<McpBaglaSonucu> {
  dinleyiciKur();
  const s = bagliyor.get(id);
  if (s) return s;
  const p = (async (): Promise<McpBaglaSonucu> => {
    if (bulutKapaliMi()) return { tamam: false, hata: BULUT_KAPALI_METNI.mcp };
    const g = gorunenGirdi(id);
    if (!g || !g.adres.trim()) return { tamam: false, hata: SUNULMUYOR };
    if (!sifrelemeVarMi()) return { tamam: false, hata: SIFRELEME_YOK };
    try {
      if (g.tur === 'stdio') return await stdioBagla(g, o.komutOzeti);
      baglantiyiKapat(id);
      return await httpBagla(g);
    } catch (e) {
      return { tamam: false, hata: kullaniciHatasi(e) };
    }
  })().finally(() => bagliyor.delete(id));
  bagliyor.set(id, p);
  return p;
}

/** Bağlantıyı kes: bağlantı kapanır, araçlar listeden kalkar (bellek ve disk), kayıt (belirteç) sır yuvasından silinir. Süren bir bağlanma varsa
 *  ("Bağlanıyor… · Vazgeç"; yeniden inceleme 1) YALNIZ o iptal edilir: eski kayıt korunur ("Yeniden bağla"dan vazgeçen kart "Yenilenmeli" kalır). */
export async function mcpBaglantiyiKes(id: string): Promise<void> {
  const vazgec = iptaller.get(id);
  if (vazgec) { vazgec(); return; }
  const b = baglar.get(id);
  baglantiyiKapat(id);
  listeyiUnut(id);
  basarisiz.delete(id);
  kayitYaz(id, null);
  await b?.kapat();
}

/** Gündem (T24, R12): girdinin GÜNDEM aracını (Yönetim'in tanımladığı `gundemAraci.ad`) özgün adıyla çağırır, ham MCP sonucunu döner — başka araç bu yoldan
 *  çağrılamaz (onaysız yazma yolu olmasın; düzeltme turu 1). Gizli ve "Yalnız bu bilgisayar"da ağa çıkmadan fırlatır (takvim önbellekten okunur); bağlı
 *  değilse ya da yenilenmeliyse tek cümleyle fırlatır. */
const gundemSecimiYazildi = new Set<string>();
export async function mcpKatalogAraciCagir(id: string, ad: string, girdi: Record<string, unknown>): Promise<unknown> {
  const kapali = kapaliMetni(id);
  if (kapali) throw new Error(kapali);
  const g = gorunenGirdi(id)!;
  // 5 Kas: Yönetim gündem aracı tanımlamadıysa takvim servisinin bağlı sunucusundan etkinlik listeleyen OKUMA aracı seçilir (gundemAraciSec; yazan araç
  // seçilmez). Başka araç bu yoldan yine çağrılamaz.
  const otomatik = !g.gundemAraci && ad === OTOMATIK_GUNDEM_ARACI && takvimServisiMi(g);
  if (!otomatik && (!g.gundemAraci || g.gundemAraci.ad !== ad)) throw new Error('Bu yoldan yalnız servisin gündem aracı çağrılır.');
  try {
    const bag = await cagriIcinBaglan(g);
    let cagri = { ad, girdi };
    if (otomatik) {
      const s = gundemAraciSec(bag.bilgiler, Date.now(), g);
      if (!s) {
        throw new McpBaglantiHatasi(gundemAraciOnayIster(bag.bilgiler, g)
          ? `${g.ad} takvimi onay ya da ayar istiyor; Gündem kendiliğinden okumaz.`
          : `${g.ad} etkinlik listeleyen bir araç sunmuyor.`);
      }
      if (!gundemSecimiYazildi.has(`${g.id}:${s.ad}`)) { gundemSecimiYazildi.add(`${g.id}:${s.ad}`); console.info(`[mcp] ${g.ad}: Gündem aracı ${s.ad}`); } // inceleme m2
      cagri = s;
    }
    return await bag.client.callTool({ name: cagri.ad, arguments: cagri.girdi }, undefined, { signal: bulutSinyali(), timeout: 60_000 });
  } catch (e) {
    throw new Error(cagriHataMetni(id, e) ?? kullaniciHatasi(e));
  }
}

/** Bağlantılar sayfası ('mcp:katalog'): bu moddaki kartlar (adres, OAuth ayarı ve belirteç yok) ve bulut kapısı. Ağa çıkmaz. */
export function mcpKatalogGorunumu(): McpKatalogGorunumu {
  return {
    bulutKapali: bulutKapaliMi(),
    kartlar: gorunenKatalog().map((g): McpKatalogKarti => {
      const durum = durumOf(g);
      const l = durum !== 'bagli-degil' ? listeAl(g) : null;
      return { id: g.id, ad: g.ad, simge: g.simge, aciklama: g.aciklama, tur: g.tur, durum, ...(l ? { aracSayisi: l.length } : {}) };
    }),
  };
}

/** Bütün katalog bağlantılarını kapatır ve bellekteki listeleri unutur (çıkış; test "uygulama yeniden açıldı"). Kayıtlar (belirteçler) ve disk önbelleği kalır. */
export function mcpKatalogBaglantilariniKapat(): Promise<void> {
  const l = [...baglar.values()];
  for (const c of kurulumIptalleri.values()) c.abort(); // kurulmakta olanlar da (stdio süreci hemen kapanır)
  kurulumIptalleri.clear();
  baglar.clear();
  kuruluyor.clear();
  aracListesi.clear();
  basarisiz.clear();
  aracDiski = null;
  if (bostaSaati) { clearInterval(bostaSaati); bostaSaati = null; }
  return Promise.all(l.map((b) => b.kapat())).then(() => undefined);
}

// ── Kayıt ve dinleyici ──
let dinleyici = false;
/** P14 ve mod dinleyicisi (bir kez): bulut kapısı kapanınca süren her istek kesilir ve bağlantılar kapanır; Business mode'a geçince stdio bağlantıları kapanır. */
function dinleyiciKur(): void {
  if (dinleyici) return;
  dinleyici = true;
  let onceKapali = bulutKapaliMi();
  ayarDinle(() => {
    const kapali = bulutKapaliMi();
    if (kapali && !onceKapali) { bulutuKes(); for (const id of [...baglar.keys(), ...kuruluyor.keys()]) baglantiyiKapat(id); }
    onceKapali = kapali;
    // Business mode: açık VE kurulmakta olan stdio bağlantıları kapanır (yeniden inceleme 1; kurulum iptal edilir, süreç hemen kapanır).
    if (!gelistirici()) {
      const stdio = new Set(katalogOku().filter((g) => g.tur === 'stdio').map((g) => g.id));
      for (const [id, b] of baglar) if (b.girdi.tur === 'stdio') stdio.add(id);
      for (const id of [...baglar.keys(), ...kuruluyor.keys()]) if (stdio.has(id)) baglantiyiKapat(id);
    }
  });
}

/** Araç kaydı (main.ts → mcp.ts mcpAraclariniKaydet): katalog araçları dinamik kaynak olarak; dinleyici kurulur. */
export function katalogAraclariniKaydet(): void {
  dinleyiciKur();
  dinamikAracKaynagi(() => katalogAraclari());
}
