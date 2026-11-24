// ── Çentiğin Raf'ı: ana süreç (0.14 T27; R21; tests/raf.test.ts) ─────────────────────────────────────────────────────────────────────────────────
// Kullanıcının çentiğe bıraktığı dosya ve metinlerin geçici durağı. Kurallar:
//   · DOSYA KOPYALANMAZ: raf yalnız yolu (referansı), adı ve boyutu `userData/raf.json`'a yazar; diske hiçbir dosya eklenmez, taşınmaz, silinmez.
//   · Yol yalnız BIRAKMA yoluyla girer (`ekle`; arayüz yol dizisi gönderemez: preload çözer): mutlak, yerel sürücü yolu olmalı. UNC/ağ yolu (\\sunucu\paylaşım, \\?\, eşlenmiş ağ sürücüsünün gerçek yolu dahil),
//     `file:` ve her tür bağlantı, göreli yol, alternatif veri akışı (`a.txt:x`) ve denetim karakteri REDDEDİLİR. Ağ yolu açılırken Windows kimlik bilgisi sızdırabilir.
//   · Açma ve dışarı sürükleme YALNIZ öğe kimliğiyle ve YALNIZ listedeki yol için çalışır; arayüzden gelen başka bir yol ya da kimlik reddedilir (arayüz yol veremez).
//     Disktekinin yolu her açışta yeniden doğrulanır (kayıt dosyası elle bozulmuş olabilir).
//   · Dosya ASLA çalıştırılmaz: `shell.openPath` yalnız İZİN LİSTESİNDEKİ türlerde (görsel, pdf, metin, makrosuz Office, ses/video, zip); öbür her şey ve uzantısız dosya klasörde GÖSTERİLİR.
//   · Kayıt kaynağı: yol yalnız preload'un `rafBirak` köprüsünden (gerçek bırakma nesnesi + webUtils) özel `raf:birak` kanalıyla girer; tüm `raf:*` yalnız çentik penceresinden (`rafGonderenBagla`).
//   · Yerinde olmayan (silinmiş/taşınmış) dosya "eksik" görünür ve açılmaz ("Dosya yerinde yok"). Varlık yoklanmaz: liste çekilirken (sayfa takılınca) ve açarken bakılır.
//   · Ağ yok, bulut yok (P14): rafın hiçbir şeyi bir yere yüklenmez; sohbet eki yok. Metin kartı tıklanınca panoya kopyalanır.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { clipboard, shell } from 'electron';
import { jsonOku, jsonYaz } from './json-dosya.js';
import { yollar } from './yollar.js';
import { DOSYA_YOK_METNI, RAF_EN_COK, metniKes, rafDogrula, rafEkle, type RafOgesi } from '../shared/raf.js';

/** Tek bırakmada işlenecek en çok yol (30'dan fazlası bırakılırsa en yenileri kalır; sınırsız liste gövdesi ana süreci uğraştırmasın). */
const BIRAKMA_EN_COK = 100;

/**
 * `shell.openPath` YALNIZ bu türlerde (küçük/büyük harf duyarsız) çalışır: görsel, PDF, düz metin, makrosuz Office, ses/video, zip. Kara liste yok, İZİN LİSTESİ: listede olmayan
 * her tür (.exe .lnk .docm .appinstaller .iso …) ve uzantısız dosya `showItemInFolder` ile klasörde gösterilir; ilişkili işleyicisi kod çalıştıran ya da ağa bağlanan türler açılmaz.
 * Klasör Gezgin'de açılır (içindekini çalıştırmaz).
 */
// 0.14 T35 (T27 yeniden incelemesi): .svg de .html gibi dışarıda — ikisinin de varsayılan işleyicisi çoğu zaman tarayıcıdır ve betik çalıştırabilir.
const ACILABILIR = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.heic',
  '.pdf',
  '.txt', '.md', '.csv', '.json', '.log',
  '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp', '.rtf',
  '.mp3', '.wav', '.m4a', '.flac', '.ogg', '.mp4', '.mov', '.mkv', '.webm', '.avi',
  '.zip',
]);

/** Dosya adından uzantı: Windows sondaki nokta ve boşlukları yok sayar ("a.exe. " hâlâ a.exe'dir). */
function uzanti(yol: string): string {
  return path.extname(path.basename(yol).replace(/[. ]+$/, '')).toLowerCase();
}
/** Bu DOSYA `shell.openPath` ile açılabilir mi (izin listesi)? Değilse klasörde gösterilir. */
export const acilabilirMi = (yol: string): boolean => ACILABILIR.has(uzanti(yol));

// ── Yol doğrulama ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Gerçek yol (bağlantılar ve eşlenmiş ağ sürücüleri çözülmüş); yoksa null. */
export function gercekYolOku(yol: string): string | null {
  try { return fs.realpathSync.native(yol); } catch { return null; }
}

/** 0.14 T35 (T27 Minor 3): yolun her parçası `lstat` ile (bağlantı İZLENMEDEN) yoklanır; sembolik bağlantı ya da kavşak olan parçaların hedefleri döner.
 *  `lstat` ve `readlink` hedefe gitmez: ağ hedefli bağlantı, gerçek yol çözücü (realpath) ona dışarıdan bağlanmayı denemeden önce görülür. */
export function baglantiHedefleriOku(yol: string): string[] {
  const hedefler: string[] = [];
  const kok = path.parse(yol).root;
  let simdiki = kok;
  for (const parca of yol.slice(kok.length).split(/[\\/]+/).filter(Boolean)) {
    simdiki = path.join(simdiki, parca);
    try {
      if (fs.lstatSync(simdiki).isSymbolicLink()) hedefler.push(fs.readlinkSync(simdiki));
    } catch { break; } // parça yok: ötesine bakılmaz (yol zaten "eksik")
  }
  return hedefler;
}

/** Yol (ya da bağlantı hedefi) ağ yolu mu: \\sunucu\…, \\?\UNC\…, \\.\… (yerel \\?\C:\ öneki ağ değildir). */
const agYoluMu = (y: string): boolean => /^[\\/]{2}(?!\?[\\/][A-Za-z]:)/.test(y);

export type YolSonucu = { yol: string } | { hata: string };

/**
 * Bırakılan/kayıtlı yolun yazımını ve ağ yolu olup olmadığını denetler. `gercek`: gerçek yol çözücü (eşlenmiş ağ sürücüsü \\sunucu\… olarak döner → reddedilir).
 * `win`: Windows kuralları (sürücü harfi zorunlu); varsayılan çalışma platformu.
 */
export function rafYoluDogrula(girdi: unknown, gercek: (y: string) => string | null = gercekYolOku, win = process.platform === 'win32', baglantilar: (y: string) => string[] = baglantiHedefleriOku): YolSonucu {
  const yazim = rafYoluYazimi(girdi, win);
  if ('hata' in yazim) return yazim;
  // Bağlantı/kavşak hedefi ağdaysa realpath DENENMEZ (Windows ağ hedefine bağlanırken kimlik bilgisi gönderebilir).
  if (baglantilar(yazim.yol).some(agYoluMu)) return { hata: 'Ağ yolları rafa eklenemez' };
  const r = gercek(yazim.yol);
  if (r && agYoluMu(r)) return { hata: 'Ağ yolları rafa eklenemez' }; // eşlenmiş ağ sürücüsü: gerçek yol \\sunucu\…
  return yazim;
}

/** Zaman uyumsuz eşi (liste: fs.promises; aynı kurallar). */
async function rafYoluDogrulaP(girdi: unknown, gercek: (y: string) => Promise<string | null>, baglantilar: (y: string) => string[]): Promise<YolSonucu> {
  const yazim = rafYoluYazimi(girdi, process.platform === 'win32');
  if ('hata' in yazim) return yazim;
  if (baglantilar(yazim.yol).some(agYoluMu)) return { hata: 'Ağ yolları rafa eklenemez' };
  const r = await gercek(yazim.yol);
  if (r && agYoluMu(r)) return { hata: 'Ağ yolları rafa eklenemez' };
  return yazim;
}

/** Yalnız yazım (disk ve ağa bakmaz): mutlak, yerel sürücü yolu; çözülmüş biçimi döner. */
function rafYoluYazimi(girdi: unknown, win: boolean): YolSonucu {
  if (typeof girdi !== 'string') return { hata: 'Yol metin olmalı' };
  const y = girdi.trim().replace(/^"(.*)"$/, '$1');
  if (!y) return { hata: 'Yol boş' };
  if (y.length > 2000) return { hata: 'Yol çok uzun' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(y)) return { hata: 'Yolda geçersiz karakter var' };
  if (/^[a-z][a-z0-9+.-]*:(?![\\/]|$)/i.test(y) || /^[a-z][a-z0-9+.-]+:\/\//i.test(y)) return { hata: 'Bağlantılar (file:, http: …) rafa eklenemez; dosyayı doğrudan bırak' };
  if (/^[\\/]{2}/.test(y)) return { hata: 'Ağ yolları rafa eklenemez' };
  if (win) {
    if (!/^[A-Za-z]:[\\/]/.test(y)) return { hata: 'Tam bir sürücü yolu gerekli' };
    if (y.slice(2).includes(':')) return { hata: 'Yolda ":" olamaz' };
  } else if (!path.isAbsolute(y)) return { hata: 'Tam yol gerekli' };
  return { yol: path.resolve(y) };
}

// ── Yönetici ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RafBagimliliklari {
  /** Kayıtlı ham öğeler (yoksa undefined). */
  oku: () => unknown;
  yaz: (l: RafOgesi[]) => void;
  /** Yolun varlığı: dosya/klasör ve boyutu; yoksa null. */
  durum: (yol: string) => { klasor: boolean; boyut: number } | null;
  gercekYol: (yol: string) => string | null;
  /** 0.14 T35 (T27 Minor 7): liste() için zaman uyumsuz eşler (fs.promises; verilmezse eşzamanlılar sarılır). */
  durumP?: (yol: string) => Promise<{ klasor: boolean; boyut: number } | null>;
  gercekYolP?: (yol: string) => Promise<string | null>;
  /** Bağlantı/kavşak hedefleri (lstat zinciri); verilmezse yok sayılır. */
  baglantilar?: (yol: string) => string[];
  /** shell.openPath: boş metin = başarı, doluysa hata iletisi. */
  ac: (yol: string) => Promise<string>;
  goster: (yol: string) => void;
  kopyala: (metin: string) => void;
  simdi: () => Date;
  kimlik: () => string;
}

export interface RafEkleSonucu {
  liste: RafOgesi[];
  eklenen: number;
  /** Reddedilen yollar ve nedenleri (arayüz tek satır söyler). */
  reddedilen: { yol: string; neden: string }[];
}
export interface RafAcSonucu {
  tamam: boolean;
  mesaj: string;
  eylem: 'acildi' | 'gosterildi' | 'kopyalandi' | 'yok' | 'reddedildi';
}

export interface RafYoneticisi {
  /** Liste (eskiden yeniye); dosyaların varlığına o an bakılır (`eksik`), öğeler paralel ve zaman uyumsuz (fs.promises: yavaş sürücü ana iş parçacığını dondurmaz). */
  liste(): Promise<RafOgesi[]>;
  /** Bırakılan yollar ve/veya metin. Yollar doğrulanır; kopyalama yok. */
  ekle(girdi: { yollar?: unknown; metin?: unknown }): RafEkleSonucu;
  ac(id: unknown): Promise<RafAcSonucu>;
  sil(id: unknown): RafOgesi[];
  temizle(): RafOgesi[];
  /** Dışarı sürüklenebilir dosya yolu: yalnız listedeki, yerinde duran dosya; yoksa null. */
  surukleYolu(id: unknown): string | null;
  /** surukleYolu + klasör mü (sürükleme simgesinin önbellek anahtarı için). */
  surukleHedefi(id: unknown): { yol: string; klasor: boolean } | null;
}

export function rafYoneticisiKur(b: RafBagimliliklari): RafYoneticisi {
  let l: RafOgesi[] = rafDogrula(b.oku());
  const kaydet = () => b.yaz(l.map((o) => (o.tur === 'dosya' ? { id: o.id, tur: o.tur, yol: o.yol, ad: o.ad, boyut: o.boyut, eklendi: o.eklendi } : o)));
  const bul = (id: unknown): RafOgesi | null => (typeof id === 'string' ? l.find((o) => o.id === id) ?? null : null);

  const baglantilar = b.baglantilar ?? (() => []);
  const dogrulaYol = (yol: string): YolSonucu => rafYoluDogrula(yol, b.gercekYol, process.platform === 'win32', baglantilar);
  const durumP = b.durumP ?? (async (y: string) => b.durum(y));
  const gercekYolP = b.gercekYolP ?? (async (y: string) => b.gercekYol(y));

  /** Öğeye o anki durumu işler (eksik / klasör); durum bir kez okunur. */
  const isle = (o: RafOgesi, y: YolSonucu, d: { klasor: boolean; boyut: number } | null): RafOgesi =>
    o.tur !== 'dosya' ? o : 'hata' in y || !d ? { ...o, eksik: true } : d.klasor ? { ...o, klasor: true } : o;
  /** Eşzamanlı anlık liste (ekle/sil yanıtı: yeni eklenen zaten yoklandı). */
  const anlik = (): RafOgesi[] => l.map((o) => {
    if (o.tur !== 'dosya') return o;
    const y = dogrulaYol(o.yol);
    return isle(o, y, 'hata' in y ? null : b.durum(y.yol));
  });
  const liste = async (): Promise<RafOgesi[]> => Promise.all(l.map(async (o) => {
    if (o.tur !== 'dosya') return o;
    const y = await rafYoluDogrulaP(o.yol, gercekYolP, baglantilar);
    return isle(o, y, 'hata' in y ? null : await durumP(y.yol));
  }));
  const surukleHedefi = (id: unknown): { yol: string; klasor: boolean } | null => {
    const o = bul(id);
    if (!o || o.tur !== 'dosya') return null;
    const y = dogrulaYol(o.yol);
    const d = 'hata' in y ? null : b.durum(y.yol);
    return 'hata' in y || !d ? null : { yol: y.yol, klasor: d.klasor };
  };

  return {
    liste,
    ekle(girdi) {
      const reddedilen: { yol: string; neden: string }[] = [];
      let eklenen = 0;
      const yollar_ = Array.isArray(girdi?.yollar) ? (girdi.yollar as unknown[]).slice(0, BIRAKMA_EN_COK) : [];
      for (const ham of yollar_) {
        const y = dogrulaYol(ham as string);
        if ('hata' in y) { reddedilen.push({ yol: String(ham).slice(0, 200), neden: y.hata }); continue; }
        const d = b.durum(y.yol);
        if (!d) { reddedilen.push({ yol: y.yol, neden: DOSYA_YOK_METNI }); continue; }
        const o: RafOgesi = { id: b.kimlik(), tur: 'dosya', yol: y.yol, ad: path.basename(y.yol) || y.yol, boyut: d.klasor ? 0 : d.boyut, eklendi: b.simdi().toISOString() };
        const yeni = rafEkle(l, o);
        if (yeni.some((x) => x.id === o.id)) eklenen++; // aynı yol zaten rafta: eklenmedi
        l = yeni;
      }
      if (typeof girdi?.metin === 'string' && girdi.metin.trim()) {
        const o: RafOgesi = { id: b.kimlik(), tur: 'metin', metin: metniKes(girdi.metin), eklendi: b.simdi().toISOString() };
        l = rafEkle(l, o);
        eklenen++;
      }
      if (eklenen) kaydet();
      return { liste: anlik(), eklenen, reddedilen };
    },
    async ac(id) {
      const o = bul(id);
      if (!o) return { tamam: false, mesaj: 'Rafta böyle bir öğe yok', eylem: 'reddedildi' };
      if (o.tur === 'metin') { b.kopyala(o.metin); return { tamam: true, mesaj: 'Kopyalandı', eylem: 'kopyalandi' }; }
      const y = dogrulaYol(o.yol);
      if ('hata' in y) return { tamam: false, mesaj: 'Bu yol açılamaz', eylem: 'reddedildi' };
      const durum = b.durum(y.yol);
      if (!durum) return { tamam: false, mesaj: DOSYA_YOK_METNI, eylem: 'yok' };
      if (!durum.klasor && !acilabilirMi(y.yol)) { b.goster(y.yol); return { tamam: true, mesaj: 'Çalıştırılmadı: klasörde gösterildi', eylem: 'gosterildi' }; }
      const hata = await b.ac(y.yol);
      return hata ? { tamam: false, mesaj: 'Açılamadı', eylem: 'reddedildi' } : { tamam: true, mesaj: 'Açıldı', eylem: 'acildi' };
    },
    sil(id) {
      const o = bul(id);
      if (o) { l = l.filter((x) => x !== o); kaydet(); }
      return anlik();
    },
    temizle() {
      if (l.length) { l = []; kaydet(); }
      return [];
    },
    surukleYolu: (id) => surukleHedefi(id)?.yol ?? null,
    surukleHedefi,
  };
}

// ── Gerçek bağlayıcılar ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const kayitYolu = (): string => path.join(yollar.veri(), 'raf.json');

let tekil: RafYoneticisi | null = null;
/** Sürecin tek rafı (ilk kullanımda diskten okunur). */
export function rafYoneticisi(): RafYoneticisi {
  tekil ??= rafYoneticisiKur({
    oku: () => { const r = jsonOku(kayitYolu()); return typeof r === 'object' ? r.veri.ogeler : undefined; },
    yaz: (l) => { try { jsonYaz(kayitYolu(), { surum: 1, ogeler: l }); } catch (e) { console.warn('[raf] yazılamadı:', (e as Error).message); } },
    durum: (yol) => { try { const s = fs.statSync(yol); return { klasor: s.isDirectory(), boyut: s.size }; } catch { return null; } },
    gercekYol: gercekYolOku,
    durumP: async (yol) => { try { const s = await fs.promises.stat(yol); return { klasor: s.isDirectory(), boyut: s.size }; } catch { return null; } },
    gercekYolP: async (yol) => { try { return await fs.promises.realpath(yol); } catch { return null; } },
    baglantilar: baglantiHedefleriOku,
    ac: (yol) => shell.openPath(yol),
    goster: (yol) => shell.showItemInFolder(yol),
    kopyala: (metin) => clipboard.writeText(metin),
    simdi: () => new Date(),
    kimlik: () => randomUUID(),
  });
  return tekil;
}

// ── Dışarı sürükleme ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** 0.14 T35 (T27): sürükleme simgesinin önbellek anahtarı — dosyada uzantı (küçük harf), uzantısızda ve klasörde sabit anahtar (eskiden yolun son
 *  noktasından sonrası: uzantısız dosyada yolun son harfi, noktalı klasörde yolun parçası olurdu). */
export function surukleSimgeAnahtari(yol: string, klasor: boolean): string {
  if (klasor) return 'klasor';
  return uzanti(yol) || 'uzantisiz';
}

let surukleBaglayici: ((yol: string, klasor: boolean) => boolean | Promise<boolean>) | null = null;
/** ada.ts: çentiğin penceresinin `webContents.startDrag`'ini bağlar (bu modül pencereye bağımlı olmasın). */
export function rafSurukleBagla(f: (yol: string, klasor: boolean) => boolean | Promise<boolean>): void { surukleBaglayici = f; }
/** Raftaki dosyayı sürüklemeyi başlatır: yalnız listedeki, yerinde duran dosya; öbürleri false. Dosya kopyalanmaz (işletim sistemi sürükleme kaynağı olarak yolu verir). */
export async function rafSurukle(id: unknown): Promise<boolean> {
  const h = rafYoneticisi().surukleHedefi(id);
  if (!h || !surukleBaglayici) return false;
  try { return await surukleBaglayici(h.yol, h.klasor); } catch { return false; }
}

// ── Gönderen kapısı (I1) ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

let gonderenGecerli: (gonderen: unknown) => boolean = () => false;
/** ada.ts: gönderenin çentik penceresinin webContents'i olup olmadığını söyler (varsayılan: hiçbiri; ana pencere Raf'ı kullanmaz). */
export function rafGonderenBagla(f: (gonderen: unknown) => boolean): void { gonderenGecerli = f; }
/** Bir `raf:*` çağrısı yalnız çentik penceresinden kabul edilir. */
export const rafGonderenGecerliMi = (gonderen: unknown): boolean => { try { return Boolean(gonderen) && gonderenGecerli(gonderen); } catch { return false; } };
