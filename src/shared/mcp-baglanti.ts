// ── MCP bağlantıları: hijyen, geri dönüş adresi, arayüz sözleşmesi (0.14 T16; saf → birim testli: tests/mcp-oauth.test.ts, tests/mcp-katalog-istemci.test.ts) ──
// MCP neredeyse oraya bağlanılır; kullanıcı katalogdaki servise tek tıkla bağlanır. Katalog servisleri (Gmail, Takvim, Notion…) her modda,
// Developer'ın kendi sunucuları yalnız Developer mode'da. Burada yalnız saf kurallar:
//  • Araç adı: sağlayıcılar yalnız ^[a-zA-Z0-9_-]{1,64}$ kabul eder (sunucu da uymayanı 400 ARAC_ADI_GECERSIZ ile reddeder). MCP sunucusunun adı
//    (nokta, eğik çizgi, Türkçe harf, 64'ten uzun) temizlenir; çağrı her zaman ÖZGÜN adla gider (mcpAracAdlari: temiz → özgün eşlemesi).
//  • Girdi şeması: bazı sağlayıcılar (ör. OpenRouter üzerinden Gemini) `type: [..]` dizisini, anyOf/oneOf/allOf'u reddeder; o modelde bütün araçlı
//    sohbet 400 verirdi. mcpSemaDuzlestir sağlayıcının kabul ettiği tek türlü biçime indirir; doğrulama özgün şemayla yapılır (Arac.dogrulamaSemasi).
//  • stdio komutu: satır sonu ya da denetim karakteri taşıyan komut ve argüman reddedilir (komut satırına gizli ikinci komut eklenemesin).
//  • OAuth geri dönüş adresi (RFC 8252): yalnız http://127.0.0.1:<kapı>/… ya da http://[::1]:<kapı>/…, kapı açıkça yazılı; `localhost` ve :80
//    sunucunun belirteç aracısı tarafından da reddedilir.

/** Sağlayıcıya gidebilecek araç adı (OpenAI `function.name`; sunucunun ARAC_ADI'siyle aynı). */
export const MCP_ARAC_ADI = /^[a-zA-Z0-9_-]{1,64}$/;
const AD_AZAMI = 64;

const guvenli = (s: string): string => s.replace(/[^a-zA-Z0-9_-]/g, '_');

/** Servisin araç adı öneki (servis adı en çok 20 güvenli karakter; boşsa `servis`): katalog servisi `mcp__<servis>__`, Developer'ın kendi sunucusu
 *  `mcpg__<servis>__` (düzeltme turu 1: aynı adlı katalog servisi ve Developer sunucusunun araç adları çakışmaz — model bir şemayı görüp çağrı öteki
 *  sunucuya gitmez). */
export const mcpOneki = (servis: string, tur: 'katalog' | 'gelistirici' = 'katalog'): string =>
  `${tur === 'gelistirici' ? 'mcpg' : 'mcp'}__${guvenli(servis).slice(0, 20) || 'servis'}__`;
/** Araç adından MCP servisi ve aracı (görünen etiket): `mcp__S__a` ya da `mcpg__S__a`; MCP aracı değilse null. */
export const mcpAdCoz = (ad: string): { servis: string; arac: string } | null => {
  const m = /^mcpg?__(.+?)__(.+)$/.exec(ad);
  return m ? { servis: m[1], arac: m[2] } : null;
};

/** FNV-1a (32 bit) → 6 karakter taban 36: çakışan ya da kesilen adın kısa, belirlenimci ayırt edicisi. */
function kisaOzet(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36).padStart(7, '0').slice(-6);
}

/** Servisin araç adları → sağlayıcıya gidecek temiz adlar. Sıra korunur; her temiz ad MCP_ARAC_ADI'ye uyar ve benzersizdir. Sığmayan (64'ü aşan)
 *  ya da başka bir adla çakışan ad, özgün adın kısa özetiyle ayrışır. Dönen: temiz ad → özgün ad (çağrı özgün adla gider). */
export function mcpAracAdlari(onek: string, adlar: readonly string[]): Map<string, string> {
  const cikti = new Map<string, string>();
  const on = guvenli(onek).slice(0, AD_AZAMI - 8);
  for (const ozgun of adlar) {
    const yalin = `${on}${guvenli(ozgun) || 'arac'}`;
    let ad = yalin.length <= AD_AZAMI && !cikti.has(yalin) ? yalin : `${yalin.slice(0, AD_AZAMI - 7)}_${kisaOzet(ozgun)}`;
    for (let n = 2; cikti.has(ad); n++) ad = `${yalin.slice(0, AD_AZAMI - 7 - String(n).length)}_${kisaOzet(`${ozgun}#${n}`)}${n}`.slice(0, AD_AZAMI);
    cikti.set(ad, ozgun);
  }
  return cikti;
}

// ── Şema düzleştirme ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
type Dugum = Record<string, unknown>;
const nesne = (x: unknown): x is Dugum => typeof x === 'object' && x !== null && !Array.isArray(x);
const DERINLIK_AZAMI = 24;

/** Birden çok türden sağlayıcının kabul edeceği tek tür: metin varsa metin (her değer metinle anlatılabilir), sonra sayı, sonra ilki. */
function turSec(turler: readonly string[]): string {
  if (turler.includes('string')) return 'string';
  if (turler.includes('number')) return 'number';
  if (turler.includes('integer')) return 'integer';
  return turler[0] ?? 'string';
}
/** Değerin JSON Şema türü (sabit/enum'dan tür çıkarmak için). */
const degerTuru = (v: unknown): string | undefined =>
  (typeof v === 'string' ? 'string' : typeof v === 'boolean' ? 'boolean' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : undefined);
/** Düğümün türü: yazılıysa o; özellikleri varsa nesne; yalnız sabit (`const`) ya da `enum` varsa değerin türü. */
const turuOf = (d: Dugum): string | undefined => (typeof d.type === 'string' ? d.type : nesne(d.properties) ? 'object'
  : 'const' in d ? degerTuru(d.const) : Array.isArray(d.enum) && d.enum.length ? degerTuru(d.enum[0]) : undefined);
const notEkle = (d: Dugum, not: string): void => { d.description = typeof d.description === 'string' && d.description ? `${d.description} (${not})` : `(${not})`; };

/** Seçenekler (anyOf/oneOf) → tek şema. `null` seçenekleri düşer; tek seçenek kalırsa odur; hepsi nesneyse özellikler birleşir (zorunlu = hepsinde
 *  zorunlu olanlar); hepsi aynı türse o tür (sabit değerler enum'da birleşir); karışıksa turSec'in seçtiği seçenek + açıklamada seçenekler. */
function secenekBirlestir(kendi: Dugum, secenekler: Dugum[]): Dugum {
  const dolu = secenekler.filter((s) => !(s.type === 'null' && Object.keys(s).length <= 2));
  if (!dolu.length) return kendi;
  if (dolu.length === 1) {
    const t = turuOf(dolu[0]);
    return { ...(t && typeof dolu[0].type !== 'string' ? { type: t } : {}), ...dolu[0], ...kendi };
  }
  const turler = dolu.map(turuOf);
  if (turler.every((t) => t === 'object')) {
    const ozellikler: Dugum = {};
    for (const s of dolu) for (const [k, v] of Object.entries(nesne(s.properties) ? s.properties : {})) if (!(k in ozellikler)) ozellikler[k] = v;
    const zorunlular = dolu.map((s) => new Set(Array.isArray(s.required) ? s.required.filter((x): x is string => typeof x === 'string') : []));
    const ortak = [...zorunlular[0]].filter((k) => zorunlular.every((z) => z.has(k)));
    return { type: 'object', properties: ozellikler, ...(ortak.length ? { required: ortak } : {}), ...kendi };
  }
  if (turler.every((t) => t !== undefined && t === turler[0])) {
    const degerler: unknown[] = [];
    const hepsiSabit = dolu.every((s) => Array.isArray(s.enum) || 'const' in s);
    if (hepsiSabit) for (const s of dolu) for (const v of Array.isArray(s.enum) ? s.enum : [s.const]) if (!degerler.includes(v)) degerler.push(v);
    const ilk: Dugum = { ...dolu[0], type: turler[0] };
    delete ilk.const;
    if (hepsiSabit) ilk.enum = degerler; else delete ilk.enum;
    return { ...ilk, ...kendi };
  }
  const bilinen = [...new Set(turler.filter((t): t is string => Boolean(t)))];
  const secilen = turSec(bilinen);
  const s: Dugum = { ...(dolu.find((x) => turuOf(x) === secilen) ?? dolu[0]), ...kendi };
  if (bilinen.length > 1) notEkle(s, `şunlardan biri olabilir: ${bilinen.join(', ')}`);
  return s;
}

function duzlestir(d: Dugum, derinlik: number): Dugum {
  if (derinlik > DERINLIK_AZAMI) return {};
  let s: Dugum = { ...d };
  if (Array.isArray(s.allOf)) {
    const parcalar = s.allOf.filter(nesne).map((x) => duzlestir(x, derinlik + 1));
    delete s.allOf;
    const ozellikler: Dugum = {};
    const zorunlu = new Set<string>();
    let tur: unknown;
    for (const p of parcalar) {
      tur ??= p.type;
      if (nesne(p.properties)) Object.assign(ozellikler, p.properties);
      if (Array.isArray(p.required)) for (const r of p.required) if (typeof r === 'string') zorunlu.add(r);
    }
    if (nesne(s.properties)) Object.assign(ozellikler, s.properties);
    if (Array.isArray(s.required)) for (const r of s.required) if (typeof r === 'string') zorunlu.add(r);
    s = { ...Object.assign({}, ...parcalar), ...s, ...(Object.keys(ozellikler).length ? { properties: ozellikler } : {}), ...(zorunlu.size ? { required: [...zorunlu] } : {}) };
    if (s.type === undefined && tur !== undefined) s.type = tur;
  }
  for (const k of ['anyOf', 'oneOf'] as const) {
    if (!Array.isArray(s[k])) continue;
    const secenekler = (s[k] as unknown[]).filter(nesne).map((x) => duzlestir(x, derinlik + 1));
    const { [k]: _at, ...kendi } = s;
    s = secenekBirlestir(kendi, secenekler);
  }
  if (Array.isArray(s.type)) {
    const turler = (s.type as unknown[]).filter((t): t is string => typeof t === 'string');
    const nullsuz = turler.filter((t) => t !== 'null');
    s.type = turSec(nullsuz.length ? nullsuz : ['string']);
    if (new Set(nullsuz).size > 1) notEkle(s, `şunlardan biri olabilir: ${[...new Set(nullsuz)].join(', ')}`);
  }
  if (nesne(s.properties)) s.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, nesne(v) ? duzlestir(v, derinlik + 1) : {}]));
  if (Array.isArray(s.items)) {
    const parcalar = s.items.filter(nesne).map((x) => duzlestir(x, derinlik + 1));
    s.items = parcalar.length ? secenekBirlestir({}, parcalar) : {};
  } else if (nesne(s.items)) s.items = duzlestir(s.items, derinlik + 1);
  if (nesne(s.additionalProperties)) s.additionalProperties = duzlestir(s.additionalProperties, derinlik + 1);
  // Düzleştirme sonunda bile kalan bir dizi/birleşim (derinlik sınırı) bırakılmaz.
  for (const k of ['anyOf', 'oneOf', 'allOf']) delete s[k];
  return s;
}

/** MCP aracının girdi şeması → sağlayıcıların kabul ettiği biçim: kök hep `type: 'object'` + `properties`; hiçbir düğümde tür dizisi, anyOf, oneOf,
 *  allOf yok (properties, items, additionalProperties içinde de). Girdi değişmez. */
export function mcpSemaDuzlestir(sema: unknown): Record<string, unknown> {
  const kok = duzlestir(nesne(sema) ? sema : {}, 0);
  if (kok.type !== 'object') return { type: 'object', properties: {}, ...(typeof kok.description === 'string' ? { description: kok.description } : {}) };
  if (!nesne(kok.properties)) kok.properties = {};
  return kok;
}

/** Şemadan bütün `description` alanlarını atar (çok büyük şemayı sınıra sığdırmak için; yapı aynı kalır). */
export function semaAciklamasiz(sema: unknown, derinlik = 0): unknown {
  if (derinlik > DERINLIK_AZAMI) return {};
  if (Array.isArray(sema)) return sema.map((x) => semaAciklamasiz(x, derinlik + 1));
  if (!nesne(sema)) return sema;
  const cikti: Dugum = {};
  for (const [k, v] of Object.entries(sema)) {
    if (k === 'description' || k === 'examples' || k === 'title') continue;
    cikti[k] = k === 'properties' && nesne(v) ? Object.fromEntries(Object.entries(v).map(([a, b]) => [a, semaAciklamasiz(b, derinlik + 1)])) : semaAciklamasiz(v, derinlik + 1);
  }
  return cikti;
}

// ── stdio komutu ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Satır sonu, denetim ya da görünmeyen biçim karakteri var mı: Unicode Cc (C0, DEL, C1), Cf (yön denetimleri, sıfır genişlikli karakterler,
 *  BOM, yumuşak tire…), Zl ve Zp (satır/paragraf ayırıcı). Düzeltme turu 1: yön denetimi (ör. sağdan sola geçersiz kılma) stdio onay kartında
 *  gösterilen komutu çalışacak olandan farklı okutabilirdi. */
const GORUNMEYEN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
export const denetimKarakteriVar = (s: string): boolean => GORUNMEYEN.test(s);

/** stdio komutunun reddi (null = geçerli): boş komut, ya da komutta/argümanlarda satır sonu veya denetim karakteri. */
export function stdioKomutuReddi(komut: string | undefined, argumanlar: readonly string[] = []): string | null {
  if (!komut || !komut.trim()) return 'Komut boş.';
  if (denetimKarakteriVar(komut) || argumanlar.some((a) => denetimKarakteriVar(String(a)))) return 'Komut satır sonu ya da görünmeyen denetim karakteri içeremez.';
  return null;
}

// ── OAuth geri dönüş adresi ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** RFC 8252 geri dönüş adresi: yalnız http://127.0.0.1:<kapı>/… ya da http://[::1]:<kapı>/…, kapı AÇIK (URL varsayılan :80'i boşaltır → ret);
 *  `localhost`, kullanıcı bilgisi ve başka şema reddedilir (sunucunun belirteç aracısıyla aynı kural). */
export function geriDonusAdresiGecerli(adres: string): boolean {
  let u: URL;
  try { u = new URL(adres); } catch { return false; }
  if (u.protocol !== 'http:' || u.username || u.password) return false;
  if (u.hostname !== '127.0.0.1' && u.hostname !== '[::1]') return false;
  return /^\d{1,5}$/.test(u.port) && Number(u.port) > 0 && Number(u.port) <= 65535;
}

// ── Arayüz sözleşmesi (ipc 'mcp:katalog') ve metinler ──────────────────────────────────────────────────────────────────────────────
/** Katalog servisinin bu bilgisayardaki hâli. */
export type McpBaglantiDurumu = 'bagli' | 'bagli-degil' | 'yenilenmeli';

/** Bağlantılar'daki tek kart (adres, OAuth ayarı ve belirteç arayüze GİTMEZ). */
export interface McpKatalogKarti {
  id: string;
  ad: string;
  simge: string;
  aciklama: string;
  tur: 'http' | 'stdio';
  durum: McpBaglantiDurumu;
  /** Bilinen araç sayısı (bağlıyken, araç listesi alındıysa). */
  aracSayisi?: number;
}

/** 'mcp:katalog' yanıtı: kartlar (moda göre: stdio girdileri yalnız Developer mode'da) ve bulut kapısı (Gizli / "Yalnız bu bilgisayar"). */
export interface McpKatalogGorunumu { kartlar: McpKatalogKarti[]; bulutKapali: boolean }

/** Katalog gerçekten boş (sunucu `{ katalog: [] }` dedi ya da henüz hiç alınamadı). */
export const KATALOG_BOS_METNI = 'Şu an sunulan bağlantı yok.';
/** 11 Kas: boş katalogda neyin nereden geldiği (Google/Outlook takvimi, Gmail…: Fuber hesabıyla). */
export const KATALOG_YOL_METNI = 'Servisleri kendin eklersin: bir MCP sunucusunun adresini ya da komutunu gir.';
/** Yenileme reddedildi ya da servisin adresi değişti: araç bunu döner, Bağlantılar "Yeniden bağla" gösterir; ikinci deneme yapılmaz. */
export const BAGLANTI_YENILENMELI_METNI = "Bağlantı yenilenmeli: Bağlantılar'dan yeniden bağla.";
/** 0.14 son inceleme tur 2: Developer MCP sunucusunun gizli değerleri (başlık/ortam) bu bilgisayarın sır yuvasından okunamadı — bağlanılmaz. */
export const MCP_SIR_OKUNAMADI_METNI = "Bu sunucunun gizli değerleri okunamadı; bağlanılmadı. Sunucuyu sil ve yeniden ekle ya da Claude Code'dan yeniden içe aktar.";
/** Araç listesi henüz gelmemiş bağlı servis(ler) için sohbetteki tek satır (sohbet başına bir kez; düzeltme turu 1). */
export const hazirlanmaNotu = (adlar: readonly string[]): string => `${adlar.join(', ')} hazırlanıyor; araçları bir sonraki mesajda hazır olacak.`;
/** Yanıt vermeyen servise çağrı (bağlantı 10 sn'de kurulamadı ya da servis yakın zamanda bağlanamadı; yeniden inceleme 1). */
export const yanitVermiyorMetni = (ad: string): string => `${ad} şu an yanıt vermiyor; biraz sonra yeniden denenecek.`;
/** Bağlı olmayan katalog servisi (mcp_kullan ile açılmak istendi): izni yalnız kullanıcı verir. */
export const baglantiYokMetni = (ad: string): string => `${ad} bağlı değil; Bağlantılar'dan bağlanabilir.`;
