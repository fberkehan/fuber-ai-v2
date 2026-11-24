// ── Pano çözücüleri (Görev 24): RSS 2.0 / RSS 1.0 (RDF) / Atom, MET Norway Locationforecast JSON, ECB ve TCMB kur XML'i ─────────
// Dış veri GÜVENİLMEZ: her alan doğrulanır, bozuk girdi istisna fırlatmaz (boş liste / null döner). Bağlantılar yalnız http(s);
// başlıklar düz metin (etiketler ve HTML varlıkları çözülür; arayüz React ile metin olarak basar). Bağımlılık yok (XML ayrıştırıcı
// kurulmadı): akışların yalnız birkaç alanı okunur. Saf modül: tests/pano-cozucu.test.ts.
// Düzeltme turu 1: ana süreçte çalışır, bu yüzden DOĞRUSAL tarama (indexOf; kapanışı olmayan açılışta durur) + öğe/alan sınırları:
// kapanmamış binlerce <item> ya da <Cube> içeren 3 MB'lık bozuk akış milisaniyeler içinde biter (eski düzenli ifadeler karesel idi).
import { gosterilecekKurlar, yerelGun, type GundemKonusu, type Haber, type HavaVerisi, type KurSatiri, type PiyasaVerisi } from './pano.ts';

// ── XML yardımcıları ──────────────────────────────────────────────────────────────────────────────────────────────────
const VARLIK = new Map<string, string>(Object.entries({
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—',
  hellip: '…', laquo: '«', raquo: '»', ccedil: 'ç', Ccedil: 'Ç', ouml: 'ö', Ouml: 'Ö', uuml: 'ü', Uuml: 'Ü', euml: 'ë', eacute: 'é', egrave: 'è', agrave: 'à', aacute: 'á',
}));
export function varliklariCoz(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{1,10});/gi, (m, v: string) => {
    if (v[0] === '#') {
      const n = v[1] === 'x' || v[1] === 'X' ? parseInt(v.slice(2), 16) : parseInt(v.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return VARLIK.get(v) ?? m; // Map: "&constructor;" gibi adlar Object.prototype'a değmez
  });
}
const cdataAc = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
/** Bir alanın en çok uzunluğu (başlık, bağlantı, tarih): uzunu kesilir — çözümleme maliyeti alanın uzunluğuyla sınırlı kalsın. */
const ALAN_EN_COK = 2000;
/** Düz metin: CDATA açılır, etiketler atılır (başlıkta <b> vb.), varlıklar çözülür (iki kez kodlanmış &amp;amp; de), boşluk sadeleşir. */
export function duzMetin(s: string): string {
  const ac = cdataAc(String(s ?? '').slice(0, ALAN_EN_COK * 2));
  return varliklariCoz(etiketleriAt(varliklariCoz(etiketleriAt(ac)))).replace(/\s+/g, ' ').trim();
}
/**
 * `<…>` (en çok 500 karakterlik) etiketleri boşlukla değiştirir — /<[^>]{0,500}>/g ile aynı sonuç, ama DOĞRUSAL: düzenli ifade "<<<<…"
 * dizisinde her '<' için 500 karakter ileri bakıp geri dönüyordu (4000 karakterlik 200 başlık ≈ 1,5 sn; düzeltme turu 1).
 */
function etiketleriAt(s: string): string {
  if (s.indexOf('<') < 0) return s;
  let out = '';
  let bas = 0;
  let sonraki = -1; // i'den sonraki ilk '>' (önbellek: her '<' için yeniden aranmaz)
  for (let i = s.indexOf('<'); i >= 0; ) {
    if (sonraki < i) sonraki = s.indexOf('>', i);
    if (sonraki < 0) break;
    if (sonraki - i - 1 <= 500) {
      out += s.slice(bas, i) + ' ';
      bas = sonraki + 1;
      i = s.indexOf('<', bas);
    } else i = s.indexOf('<', i + 1);
  }
  return out + s.slice(bas);
}
const kacis = (ad: string) => ad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Etiket eşleşmesi büyük/küçük harf DUYARSIZ (Görev 23, G24 küçüğü: <ITEM>, <Title>, <PubDate>, <cube> yazan yayıncılar): aramalar
 * metnin ASCII küçük harfli gölgesinde yapılır, içerik özgün metinden kesilir. Yalnız A–Z küçülür: uzunluk ve konumlar AYNI kalır
 * (toLowerCase "İ"yi iki karaktere açıp konumları kaydırırdı). Gölge her blok için bir kez kurulur (doğrusal).
 */
const kucuk = (s: string) => s.replace(/[A-Z]+/g, (m) => m.toLowerCase());
/** `pos`tan sonra `<ad` ile başlayan (ardından boşluk, '>' ya da '/') ilk açılışın yeri; yoksa -1. `ara`: küçük harfli gölge. Doğrusal. */
function acilisBul(ara: string, ad: string, pos: number): number {
  const hedef = `<${ad.toLowerCase()}`;
  for (let i = ara.indexOf(hedef, pos); i >= 0; i = ara.indexOf(hedef, i + hedef.length)) {
    const c = ara.charCodeAt(i + hedef.length);
    if (c === 62 || c === 47 || c === 32 || c === 9 || c === 10 || c === 13) return i;
  }
  return -1;
}
/** İlk `<ad …>…</ad>` içeriği (ham; CDATA açılmamış); kendinden kapanan `<ad/>` boş. Kapanışı yoksa undefined. Doğrusal. */
function etiket(blok: string, ad: string, ara = kucuk(blok)): string | undefined {
  const i = acilisBul(ara, ad, 0);
  if (i < 0) return undefined;
  const gt = ara.indexOf('>', i);
  if (gt < 0) return undefined;
  if (ara.charCodeAt(gt - 1) === 47) return '';
  const son = ara.indexOf(`</${ad.toLowerCase()}>`, gt + 1);
  return son < 0 ? undefined : blok.slice(gt + 1, Math.min(son, gt + 1 + ALAN_EN_COK * 2));
}
/** Açılış etiketinin öznitelik metni (`<ad` ile `>` arası); en çok `enCok` tanesi. Doğrusal. */
function acilislar(blok: string, ad: string, enCok: number, ara = kucuk(blok)): string[] {
  const out: string[] = [];
  for (let i = acilisBul(ara, ad, 0); i >= 0 && out.length < enCok;) {
    const gt = ara.indexOf('>', i);
    if (gt < 0) break;
    out.push(blok.slice(i + ad.length + 1, gt).slice(0, ALAN_EN_COK));
    i = acilisBul(ara, ad, gt + 1);
  }
  return out;
}
const OZNITELIK_RE = new Map<string, RegExp>();
function oznitelik(etiketMetni: string, ad: string): string | undefined {
  // Ad yoksa düzenli ifade hiç çalışmaz; ifade ad başına bir kez kurulur (ECB'de yüz binlerce <Cube> olabilir).
  const parca = etiketMetni.slice(0, ALAN_EN_COK * 2);
  if (!parca.toLowerCase().includes(ad.toLowerCase())) return undefined;
  let re = OZNITELIK_RE.get(ad);
  if (!re) { re = new RegExp(`\\s${kacis(ad)}\\s*=\\s*("([^"]{0,${ALAN_EN_COK}})"|'([^']{0,${ALAN_EN_COK}})')`, 'i'); OZNITELIK_RE.set(ad, re); }
  const m = re.exec(parca);
  return m ? varliklariCoz(m[2] ?? m[3] ?? '') : undefined;
}
/** Yalnız http(s) bağlantı (javascript:, data: … atılır). */
export function gecerliBaglanti(s: string | undefined): string | undefined {
  const t = (s ?? '').trim();
  if (t.length > ALAN_EN_COK || !/^https?:\/\//i.test(t)) return undefined;
  try { return new URL(t).toString(); } catch { return undefined; }
}
function isoZaman(s: string | undefined): string | undefined {
  const t = Date.parse(duzMetin((s ?? '').slice(0, 200)));
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}
/** `<item>`/`<entry>` gövdeleri: ilk görülen türden, kapanışı olanlar, en çok `enCok`. Kapanmamış açılışta durur (doğrusal). */
function ogeBloklari(xml: string, enCok: number): { tur: 'item' | 'entry'; govde: string; ara: string }[] {
  const ara = kucuk(xml);
  const iItem = acilisBul(ara, 'item', 0), iEntry = acilisBul(ara, 'entry', 0);
  const tur: 'item' | 'entry' | null = iItem >= 0 && (iEntry < 0 || iItem < iEntry) ? 'item' : iEntry >= 0 ? 'entry' : null;
  if (!tur) return [];
  const kapanis = `</${tur}>`;
  const out: { tur: 'item' | 'entry'; govde: string; ara: string }[] = [];
  for (let pos = tur === 'item' ? iItem : iEntry; pos >= 0 && out.length < enCok;) {
    const gt = ara.indexOf('>', pos);
    if (gt < 0) break;
    const son = ara.indexOf(kapanis, gt + 1);
    if (son < 0) break;
    out.push({ tur, govde: xml.slice(gt + 1, son), ara: ara.slice(gt + 1, son) });
    pos = acilisBul(ara, tur, son + kapanis.length);
  }
  return out;
}

// ── RSS / Atom ────────────────────────────────────────────────────────────────────────────────────────────────────────
export const AKIS_EN_COK = 20;
/** Bir akışın haberleri (en çok 20; en çok 200 öğeye bakılır). RSS 2.0 `<item>`, RSS 1.0 (RDF) `<item rdf:about>`, Atom `<entry>`. */
export function rssCoz(xml: string, kaynak: { id: string; ad: string }): Haber[] {
  if (typeof xml !== 'string' || xml.length > 5_000_000) return [];
  const out: Haber[] = [];
  const gorulen = new Set<string>();
  for (const { tur, govde: blok, ara } of ogeBloklari(xml, 200)) {
    if (out.length >= AKIS_EN_COK) break;
    const baslik = duzMetin(etiket(blok, 'title', ara) ?? '');
    if (!baslik) continue;
    let link: string | undefined;
    if (tur === 'entry') {
      const linkler = acilislar(blok, 'link', 20, ara);
      const secili = linkler.find((l) => !/\srel\s*=/i.test(l) || /rel\s*=\s*["']alternate["']/i.test(l)) ?? linkler[0];
      link = gecerliBaglanti(secili ? oznitelik(secili, 'href') : undefined);
    }
    link ??= gecerliBaglanti(duzMetin(etiket(blok, 'link', ara) ?? ''));
    if (!link) {
      const g = etiket(blok, 'guid', ara);
      const ac = acilislar(blok, 'guid', 1, ara)[0] ?? '';
      if (g !== undefined && !/isPermaLink\s*=\s*["']false["']/i.test(ac)) link = gecerliBaglanti(duzMetin(g));
    }
    if (!link) continue;
    const anahtar = `${link}|${baslik.toLocaleLowerCase('tr')}`;
    if (gorulen.has(anahtar)) continue;
    gorulen.add(anahtar);
    const zaman = isoZaman(etiket(blok, 'pubDate', ara) ?? etiket(blok, 'published', ara) ?? etiket(blok, 'updated', ara) ?? etiket(blok, 'dc:date', ara));
    out.push({ id: `${kaynak.id}:${link}`, baslik: baslik.slice(0, 300), link, kaynak: kaynak.ad, kaynakId: kaynak.id, zaman });
  }
  return out;
}

const baslikAnahtari = (b: string) => b.toLocaleLowerCase('tr').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/**
 * Akışları birleştirir: aynı haber (aynı bağlantı ya da aynı başlık) bir kez; en yeniler önce; tek kaynak listeyi kaplamasın diye
 * aynı kaynaktan üst üste en çok 2 haber (sıra kaynaklar arasında örülür). Zamanı olmayanlar sona. En çok `enCok`.
 */
export function haberleriBirlestir(akislar: Haber[][], enCok = 40, simdi = Date.now()): Haber[] {
  const gorulen = new Set<string>();
  const hepsi: Haber[] = [];
  for (const h of akislar.flat()) {
    const a = baslikAnahtari(h.baslik);
    if (gorulen.has(h.link) || gorulen.has(a)) continue;
    gorulen.add(h.link); gorulen.add(a);
    // Gelecekteki zaman (yanlış saat dilimi) şimdiye çekilir: listenin başına yapışmasın.
    hepsi.push(h.zaman && Date.parse(h.zaman) > simdi + 5 * 60_000 ? { ...h, zaman: new Date(simdi).toISOString() } : h);
  }
  hepsi.sort((x, y) => (Date.parse(y.zaman ?? '') || 0) - (Date.parse(x.zaman ?? '') || 0));
  const kalan = [...hepsi];
  const out: Haber[] = [];
  while (kalan.length && out.length < enCok) {
    const son2 = out.slice(-2).map((h) => h.kaynakId);
    const i = kalan.findIndex((h) => !(son2.length === 2 && son2.every((k) => k === h.kaynakId)));
    out.push(kalan.splice(i < 0 ? 0 : i, 1)[0]);
  }
  return out;
}

// ── Gündemdeki konular (başlıklardan, yerelde; ek istek yok) ─────────────────────────────────────────────────────────────
const DURAK = new Set([
  // Türkçe: başlık başındaki sıradan sözcükler, unvanlar, zaman adları, haber dili
  'son', 'dakika', 'flaş', 'canlı', 'video', 'haber', 'haberler', 'haberleri', 'gündem', 'yeni', 'bu', 'şu', 'o', 'bir', 've', 'ile', 'için', 'neden', 'nasıl', 'ne',
  'kim', 'hangi', 'en', 'daha', 'çok', 'tüm', 'ilk', 'iki', 'üç', 'dev', 'büyük', 'önemli', 'açıklama', 'açıkladı', 'uyarı', 'karar', 'bakan', 'bakanı', 'bakanlığı',
  'başkan', 'başkanı', 'cumhurbaşkanı', 'genel', 'eski', 'resmi', 'özel', 'bugün', 'yarın', 'dün', 'hafta', 'türkiye', "türkiye'de", 'türk', 'il', 'ilçe', 'milyon', 'milyar',
  'tl', 'yüzde', 'sonra', 'önce', 'artık', 'işte', 'mi', 'mı', 'mu', 'mü', 'da', 'de', 'ki', 'gibi', 'kadar', 'var', 'yok', 'oldu', 'olan', 'olarak', 'hakkında',
  'ocak', 'şubat', 'mart', 'nisan', 'mayıs', 'haziran', 'temmuz', 'ağustos', 'eylül', 'ekim', 'kasım', 'aralık',
  'pazartesi', 'salı', 'çarşamba', 'perşembe', 'cuma', 'cumartesi', 'pazar',
  // İngilizce/Almanca/Fransızca küçük sözcükler
  'the', 'a', 'an', 'in', 'on', 'of', 'for', 'to', 'how', 'what', 'why', 'who', 'when', 'after', 'as', 'at', 'with', 'from', 'live', 'watch', 'says', 'new', 'breaking',
  'news', 'update', 'latest', 'more', 'over', 'into', 'about', 'is', 'are', 'be', 'will', 'his', 'her', 'their', 'this', 'that', 'it', 'and', 'or', 'but', 'not', 'no',
  'der', 'die', 'das', 'und', 'mit', 'für', 'nach', 'bei', 'ein', 'eine', 'le', 'la', 'les', 'des', 'du', 'et', 'en', 'un', 'une', 'pour', 'sur', 'dans',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december',
]);
const UC_NOKTA = /^[“”"«»‘’'`(\[{]+|[“”"«»‘’'`)\]},.:;!?…–—-]+$/g;
interface Sozcuk { ham: string; anahtar: string; aday: boolean; kirik: boolean }
/** Başlığı sözcüklere böler; özel adın kesme işaretinden sonraki eki atılır ("İsrail'in" → "İsrail"). */
function sozcukler(baslik: string, haric: Set<string>): Sozcuk[] {
  return baslik.split(/\s+/).map((ham0) => {
    const kirik = /[,.:;!?…]$/.test(ham0); // sözcükten sonra noktalama: ikiliye bağlanmaz
    const ham = ham0.replace(UC_NOKTA, '').split(/['’]/)[0];
    const anahtar = ham.toLocaleLowerCase('tr');
    const kisaltma = /^[\p{Lu}]{2,6}$/u.test(ham);
    const aday = ham.length >= 2 && /^\p{Lu}/u.test(ham) && !/^\d+$/.test(ham) && (ham.length >= 3 || kisaltma) && !DURAK.has(anahtar) && !haric.has(anahtar);
    return { ham, anahtar, aday, kirik };
  });
}

/**
 * Birden çok yayının başlığında geçen özel adlar = "gündemdeki konular". İki sözcüklü adlar ("Merkez Bankası") tek sözcüklüleri
 * yutar. Sıralama: kaç farklı kaynak, sonra kaç haber. `haric`: kaynak adları, kullanıcının ülkesi/şehri (her başlıkta geçer).
 */
export function konulariCikar(haberler: Haber[], haric: string[] = [], enCok = 8): GundemKonusu[] {
  const disarida = new Set(haric.flatMap((h) => h.split(/\s+/)).map((h) => h.toLocaleLowerCase('tr')).filter(Boolean));
  for (const h of haberler) for (const p of h.kaynak.split(/\s+/)) disarida.add(p.toLocaleLowerCase('tr'));
  type Sayac = { anahtar: string; bicimler: Map<string, number>; kaynaklar: Set<string>; haberler: Haber[]; ikili: boolean };
  const sayac = new Map<string, Sayac>();
  const ekle = (anahtar: string, bicim: string, h: Haber, ikili: boolean) => {
    let s = sayac.get(anahtar);
    if (!s) { s = { anahtar, bicimler: new Map(), kaynaklar: new Set(), haberler: [], ikili }; sayac.set(anahtar, s); }
    s.bicimler.set(bicim, (s.bicimler.get(bicim) ?? 0) + 1);
    s.kaynaklar.add(h.kaynakId);
    if (!s.haberler.includes(h)) s.haberler.push(h);
  };
  for (const h of haberler) {
    const s = sozcukler(h.baslik, disarida);
    const buHaber = new Set<string>();
    s.forEach((w, i) => {
      if (!w.aday) return;
      if (!buHaber.has(w.anahtar)) { buHaber.add(w.anahtar); ekle(w.anahtar, w.ham, h, false); }
      const n = s[i + 1];
      if (n?.aday && !w.kirik) {
        const a = `${w.anahtar} ${n.anahtar}`;
        if (!buHaber.has(a)) { buHaber.add(a); ekle(a, `${w.ham} ${n.ham}`, h, true); }
      }
    });
  }
  const puan = (s: Sayac) => s.kaynaklar.size * 3 + s.haberler.length + (s.ikili ? 0.5 : 0);
  const tum = [...sayac.values()].sort((a, b) => puan(b) - puan(a));
  const sec = (enAzKaynak: number, enAzHaber: number) => {
    const secilen: Sayac[] = [];
    for (const s of tum) {
      if (s.kaynaklar.size < enAzKaynak || s.haberler.length < enAzHaber) continue;
      const parcalar = s.anahtar.split(' ');
      // İkili seçildiyse içindeki tekliler atılır; tekli seçilmişse onu içeren ikili (daha belirgin ad) yerine geçer.
      if (secilen.some((x) => x.ikili && x.anahtar.split(' ').includes(s.anahtar))) continue;
      if (s.ikili) {
        const i = secilen.findIndex((x) => !x.ikili && parcalar.includes(x.anahtar) && x.haberler.length <= s.haberler.length + 1);
        if (i >= 0) secilen.splice(i, 1);
        else if (secilen.some((x) => !x.ikili && parcalar.includes(x.anahtar))) continue;
      }
      secilen.push(s);
      if (secilen.length >= enCok) break;
    }
    return secilen;
  };
  let secilen = sec(2, 2);
  if (secilen.length < 3) secilen = [...secilen, ...sec(1, 2).filter((s) => !secilen.includes(s))].slice(0, enCok);
  return secilen.map((s) => {
    const ad = [...s.bicimler].sort((a, b) => b[1] - a[1])[0][0];
    const ornek = [...s.haberler].sort((a, b) => (Date.parse(b.zaman ?? '') || 0) - (Date.parse(a.zaman ?? '') || 0))[0];
    return { ad, kaynakSayisi: s.kaynaklar.size, haberSayisi: s.haberler.length, ornek };
  });
}

// ── MET Norway Locationforecast 2.0 (compact) ─────────────────────────────────────────────────────────────────────────
type MetZaman = { time?: string; data?: { instant?: { details?: Record<string, unknown> }; next_1_hours?: MetDonem; next_6_hours?: MetDonem; next_12_hours?: MetDonem } };
type MetDonem = { summary?: { symbol_code?: string }; details?: Record<string, unknown> };
const sayi = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
/** Bir anın o saat dilimindeki saati (0–23). */
function yerelSaatSayisi(t: number, saatDilimi: string): number {
  try { return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: saatDilimi }).format(t)); } catch { return new Date(t).getHours(); }
}

/** MET yanıtı → kart verisi. `saatDilimi`: şehrin saat dilimi (gün sınırları); bozuk yanıtta null. */
export function metCoz(json: unknown, saatDilimi: string, simdi = Date.now()): HavaVerisi | null {
  const p = (json as { properties?: { meta?: { updated_at?: string }; timeseries?: MetZaman[] } } | null)?.properties;
  // En çok 400 kayıt (compact ~90 kayıt; bozuk/aşırı büyük yanıtta her kayıt için saat dilimi hesabı ana süreci yormasın).
  const ts = Array.isArray(p?.timeseries) ? p!.timeseries!.slice(0, 400).filter((t) => typeof t?.time === 'string' && Number.isFinite(Date.parse(t.time!)) && sayi(t.data?.instant?.details?.air_temperature) !== undefined) : [];
  if (!ts.length) return null;
  const zaman = (t: MetZaman) => Date.parse(t.time!);
  const sicaklik = (t: MetZaman) => sayi(t.data!.instant!.details!.air_temperature)!;
  const simge = (t: MetZaman) => t.data?.next_1_hours?.summary?.symbol_code ?? t.data?.next_6_hours?.summary?.symbol_code ?? t.data?.next_12_hours?.summary?.symbol_code ?? 'cloudy';
  // Şimdi: şu saatin (geçmiş en çok 1 saat) ilk kaydı; yoksa en yakını.
  let i0 = ts.findIndex((t) => zaman(t) > simdi - 3600_000);
  if (i0 < 0) i0 = ts.length - 1;
  const su = ts[i0];
  const d = su.data!.instant!.details!;
  const bugunAnahtari = yerelGun(simdi, saatDilimi);
  const bugunler = ts.slice(i0).filter((t) => yerelGun(zaman(t), saatDilimi) === bugunAnahtari);
  const bugunSicak = (bugunler.length ? bugunler : [su]).map(sicaklik);
  const yagis = bugunler.reduce((n, t) => n + (sayi(t.data?.next_1_hours?.details?.precipitation_amount) ?? 0), 0);
  const saatlik = ts.slice(i0 + 1).filter((t) => t.data?.next_1_hours).slice(0, 6).map((t) => ({ zaman: new Date(zaman(t)).toISOString(), sicaklik: Math.round(sicaklik(t)), simge: simge(t) }));
  // Günlük: bugünden sonraki 3 gün; simge öğleye en yakın 6 saatlik dönemden.
  const gunler = new Map<string, MetZaman[]>();
  for (const t of ts.slice(i0)) {
    const g = yerelGun(zaman(t), saatDilimi);
    if (g === bugunAnahtari) continue;
    if (!gunler.has(g)) gunler.set(g, []);
    gunler.get(g)!.push(t);
  }
  const gunluk = [...gunler].filter(([, l]) => l.length >= 2).slice(0, 5).map(([gun, l]) => {
    const s = l.map(sicaklik);
    const ogleyeUzaklik = (t: MetZaman) => Math.abs(yerelSaatSayisi(zaman(t), saatDilimi) - 12);
    const ogle = [...l].sort((a, b) => ogleyeUzaklik(a) - ogleyeUzaklik(b))[0];
    return { gun, enYuksek: Math.round(Math.max(...s)), enDusuk: Math.round(Math.min(...s)), simge: ogle.data?.next_6_hours?.summary?.symbol_code ?? simge(ogle) };
  });
  return {
    guncelleme: typeof p?.meta?.updated_at === 'string' && Number.isFinite(Date.parse(p.meta.updated_at)) ? new Date(p.meta.updated_at).toISOString() : new Date(zaman(su)).toISOString(),
    simdi: { sicaklik: Math.round(sicaklik(su)), simge: simge(su), ruzgar: sayi(d.wind_speed), nem: sayi(d.relative_humidity) },
    bugun: { enYuksek: Math.round(Math.max(...bugunSicak)), enDusuk: Math.round(Math.min(...bugunSicak)), yagis: Math.round(yagis * 10) / 10 },
    saatlik,
    gunluk,
  };
}

// ── Kurlar ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** ECB eurofxref (günlük ya da son 90 gün): her gün için "1 EUR = x birim" oranları; eskiden yeniye. */
export function ecbCoz(xml: string): { tarih: string; oranlar: Record<string, number> }[] {
  if (typeof xml !== 'string' || xml.length > 5_000_000) return [];
  const gunler: { tarih: string; oranlar: Record<string, number> }[] = [];
  // Doğrusal: her <Cube …> açılışı; "time" taşıyan, kendi </Cube>'una dek okunur (içindeki para küpleri kendinden kapanır).
  const ara = kucuk(xml);
  for (let i = acilisBul(ara, 'Cube', 0); i >= 0 && gunler.length < 400;) {
    const gt = ara.indexOf('>', i);
    if (gt < 0) break;
    const tarih = /^\d{4}-\d{2}-\d{2}$/.exec(oznitelik(xml.slice(i, gt), 'time') ?? '')?.[0];
    if (!tarih) { i = acilisBul(ara, 'Cube', gt + 1); continue; }
    const son = ara.indexOf('</cube>', gt + 1);
    if (son < 0) break;
    const oranlar: Record<string, number> = {};
    for (const baslik of acilislar(xml.slice(gt + 1, son), 'Cube', 80, ara.slice(gt + 1, son))) {
      const kod = oznitelik(baslik, 'currency'), r = Number(oznitelik(baslik, 'rate'));
      if (kod && /^[A-Z]{3}$/.test(kod) && Number.isFinite(r) && r > 0) oranlar[kod] = r;
    }
    if (Object.keys(oranlar).length) gunler.push({ tarih, oranlar });
    i = acilisBul(ara, 'Cube', son + 7);
  }
  return gunler.sort((a, b) => a.tarih.localeCompare(b.tarih));
}

/** ECB günlerinden kart: 1 yabancı birim = kaç yerel birim (EUR tabanlı çapraz kur), önceki güne göre değişim, son 30 gün. */
export function ecbPiyasa(gunler: { tarih: string; oranlar: Record<string, number> }[], yerel: string): PiyasaVerisi | null {
  const oran = (g: { oranlar: Record<string, number> }, kod: string) => (kod === 'EUR' ? 1 : g.oranlar[kod]);
  const deger = (g: { oranlar: Record<string, number> }, yabanci: string) => {
    const l = oran(g, yerel), f = oran(g, yabanci);
    return l && f ? l / f : undefined;
  };
  const son = gunler.at(-1);
  if (!son || !oran(son, yerel)) return null;
  const kurlar: KurSatiri[] = [];
  for (const kod of gosterilecekKurlar(yerel)) {
    const gecmis = gunler.slice(-30).map((g) => deger(g, kod)).filter((x): x is number => x !== undefined);
    if (!gecmis.length) continue;
    const s = gecmis.at(-1)!, o = gecmis.at(-2);
    kurlar.push({ kod, deger: s, degisim: o ? ((s - o) / o) * 100 : undefined, gecmis });
  }
  return kurlar.length ? { yerel, tarih: son.tarih, kurlar, kaynak: 'ecb' } : null;
}

/** TCMB today.xml: döviz satış kuru (Unit'e bölünür); tarih "YYYY-AA-GG". */
export function tcmbCoz(xml: string): { tarih: string; kurlar: Record<string, number> } | null {
  if (typeof xml !== 'string' || xml.length > 5_000_000) return null;
  const ara = kucuk(xml);
  const tarihHam = oznitelik(acilislar(xml, 'Tarih_Date', 1, ara)[0] ?? '', 'Date'); // "10/23/2026"
  const t = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(tarihHam ?? '');
  const tarih = t ? `${t[3]}-${t[1].padStart(2, '0')}-${t[2].padStart(2, '0')}` : '';
  const kurlar: Record<string, number> = {};
  // Doğrusal: her <Currency …> kendi </Currency>'una dek; kapanışı olmayanda durur; en çok 100 para birimi.
  for (let i = acilisBul(ara, 'Currency', 0), n = 0; i >= 0 && n < 100; n++) {
    const gt = ara.indexOf('>', i);
    if (gt < 0) break;
    const son = ara.indexOf('</currency>', gt + 1);
    if (son < 0) break;
    const baslik = xml.slice(i, gt), govde = xml.slice(gt + 1, son), govdeAra = ara.slice(gt + 1, son);
    const kod = oznitelik(baslik, 'CurrencyCode') ?? oznitelik(baslik, 'Kod');
    const birim = Number(duzMetin(etiket(govde, 'Unit', govdeAra) ?? '1')) || 1;
    const satis = Number(duzMetin(etiket(govde, 'ForexSelling', govdeAra) ?? ''));
    if (kod && /^[A-Z]{3}$/.test(kod) && Number.isFinite(satis) && satis > 0) kurlar[kod] = satis / birim;
    i = acilisBul(ara, 'Currency', son + 11);
  }
  return tarih && Object.keys(kurlar).length ? { tarih, kurlar } : null;
}
export function tcmbPiyasa(t: { tarih: string; kurlar: Record<string, number> } | null): PiyasaVerisi | null {
  if (!t) return null;
  const kurlar = gosterilecekKurlar('TRY').filter((k) => t.kurlar[k]).map((kod) => ({ kod, deger: t.kurlar[kod], gecmis: [t.kurlar[kod]] }));
  return kurlar.length ? { yerel: 'TRY', tarih: t.tarih, kurlar, kaynak: 'tcmb' } : null;
}
