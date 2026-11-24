// ── Olay yardımcısı (resources/bin/fuber-olay.exe) ana süreçte (0.14 T22, Ruling R1) ─────────────────────────────────────────────────
// Yardımcı sistem olaylarını olay güdümlü dinler ve satır başına bir JSON yazar (protokol ve saf hâl: shared/sistem-olay.ts). Bu katman süreci açar,
// satırları son bilinen hâle (`sistemDurumu`) uygular ve dinleyicilere (çentik: main/ada.ts, tam ekran: main/tam-ekran.ts) olayı ve olaydan önceki hâli
// verir. Yoklama yok: değer yalnız değişince gelir; zamanlayıcılar tek atımlıktır (hazır bekleme, kapanış, yeniden başlatma).
// Kurallar:
//  · Açılışta `hazir` beklenir (en çok 5 sn; gelmezse süreç öldürülür ve çöküş sayılır). `hazir` gelince son istenen klavye kancası (`klavye`) ve tabanın
//    tamamı için `durum` istenir — her (yeniden) başlatmada.
//  · Yardımcı çöker ya da kapanırsa hâl boşalır ve dinleyiciler boş bir `durum` alır: tam ekran "yok" sayılır (çentik iner, kuyruk boşalır; Review Focus 2).
//    Yeniden başlatma 1, 5, 30 sn sonra; 10 dk içinde üçüncü çöküşte bu oturumda durur (günlüğe tek satır) — `yenidenBaslatmaPlani`.
//  · Kapanışta stdin kapatılır; yardımcı 2 sn içinde çıkmazsa öldürülür. Kapanıştan sonra yeniden başlatılmaz. Düzeltme turu 1 (Important 2): kapanış
//    `before-quit`'in bekleme listesine en çok 2 sn'lik bir söz olarak girer (main.ts); `will-quit`'te süreç hâlâ yaşıyorsa doğrudan öldürülür (`oldur`) —
//    Windows'ta ana süreç ölünce çocuk süreç ölmez, stdin'i yok sayan yardımcı yetim kalmasın.
//  · Komutlar yalnız hazır süreçte yazılır; değilse düşer (klavye isteği saklanır, hazır olunca gider).
//  · 0.14 T28b: yardımcı temiz çıkışta (stdin kapandı) son satır olarak geri çağırma sayaçlarını yazar ({"t":"sayac",…}; yalnız izinli adlar ve tamsayılar,
//    tuş verisi ve pencere başlığı yok). Yalnız FUBER_DEMO'da tek günlük satırı olur; hâle uygulanmaz, dinleyicilere yayılmaz. Kapanan süreçten de okunur.
//    Süreç ortada çıkar ve bu satır gelirse çıkış temizdi (stdin kapandı ya da okunamadı); gelmezse çökme ya da dışarıdan öldürülme (N2 tanısı).
// Test: FUBER_DEMO + FUBER_OLAY_KOMUT (["node", "scripts/dev/sahte-olay.mjs"]) sahte yardımcıyı açar; FUBER_DEMO'da FUBER_TEST_TAM_EKRAN tanımlıysa (sabit
// tam ekran kancası; önizlemeler) gerçek yardımcı hiç açılmaz — sonuç makinenin ses, şarj ve tam ekranına bağlı olmasın. Electron'suz sınıf:
// tests/olay-yardimcisi.test.ts.
import fs from 'node:fs';
import { satirSureci, type SatirSureci } from './durum-yardimcisi.ts';
import {
  BOS_DURUM, MEDYA_EYLEMLERI, durumGuncelle, komutSatiri, olaySatiriAyristir, type CentikMedyasi, type MedyaEylemi, type MedyaOlayi, type SayacAlani, type SistemDurumu, type SistemOlayi,
  type YardimciKomutu,
} from '../shared/sistem-olay.ts';

/** Ardışık yeniden başlatma gecikmeleri (son değerde kalır). */
export const YENIDEN_BASLATMA_MS = [1000, 5000, 30000] as const;
/** Bu pencerede üçüncü çöküşten sonra yeniden başlatılmaz. */
const COKUS_PENCERESI_MS = 10 * 60_000;
const COKUS_ESIGI = 3;
/** `hazir` bekleme ve kapanışta çıkış bekleme süreleri. */
export const HAZIR_MS = 5000;
export const CIKIS_MS = 2000;

/**
 * Çöküşten sonra kaç ms sonra yeniden başlatılır; null: durur. `cokusler`: bu oturumdaki çöküş anları (sonuncusu dahil). Son 10 dk'da 3 çöküş → null;
 * değilse oturumdaki çöküş sayısına göre 1, 5, 30 sn (30'da kalır).
 */
export function yenidenBaslatmaPlani(cokusler: number[], simdi: number): number | null {
  const pencerede = cokusler.filter((t) => simdi - t < COKUS_PENCERESI_MS).length;
  if (pencerede >= COKUS_ESIGI) return null;
  return YENIDEN_BASLATMA_MS[Math.min(YENIDEN_BASLATMA_MS.length - 1, Math.max(0, cokusler.length - 1))];
}

export type KapanisSonucu = 'cikti' | 'olduruldu' | 'yok';
export type OlayDinleyici = (o: SistemOlayi, onceki: SistemDurumu) => void;

export interface OlayYardimcisiSecenekleri {
  /** Süreci açar; açamazsa fırlatır (çöküş sayılır). */
  baslat: () => SatirSureci;
  simdi?: () => number;
  hazirMs?: number;
  cikisMs?: number;
  /** Tek satırlık günlük (varsayılan console.warn). */
  gunluk?: (m: string) => void;
  /** FUBER_DEMO: yardımcının çıkıştaki `sayac` satırı (geri çağırma sayaçları; T28b) günlüğe yazılır. Demo dışında yazılmaz. */
  demo?: boolean;
}

type Zamanlayici = ReturnType<typeof setTimeout>;
const kur = (f: () => void, ms: number): Zamanlayici => { const z = setTimeout(f, ms); (z as { unref?: () => void }).unref?.(); return z; };

export class OlayYardimcisi {
  private surec: SatirSureci | null = null;
  private hazir = false;
  private durum: SistemDurumu = BOS_DURUM;
  private readonly dinleyiciler = new Set<OlayDinleyici>();
  private readonly cokusler: number[] = [];
  private hazirZaman: Zamanlayici | null = null;
  /** Süren sürecin açılış anı (beklenmedik çıkışta açık kalma süresi günlüğe yazılır). */
  private acilis = 0;
  private yenidenZaman: Zamanlayici | null = null;
  private cikisZaman: Zamanlayici | null = null;
  private klavye: boolean | null = null;
  private basladi = false;
  private kapandi = false;
  private durdu = false;
  private readonly o: OlayYardimcisiSecenekleri;

  constructor(o: OlayYardimcisiSecenekleri) { this.o = o; }

  /** Süreci açar (bir kez; kapandıysa ya da çöküş sınırında durduysa hiçbir şey yapmaz). */
  baslat(): void {
    if (this.basladi || this.kapandi) return;
    this.basladi = true;
    this.ac();
  }

  dinle(f: OlayDinleyici): () => void {
    this.dinleyiciler.add(f);
    return () => { this.dinleyiciler.delete(f); };
  }

  durumu(): SistemDurumu { return this.durum; }
  hazirMi(): boolean { return this.hazir; }
  /** Süreç açık mı (kapanışta stdin'i yok sayan yardımcı da öldürülene dek açıktır). */
  calisiyorMu(): boolean { return this.surec !== null || this.kapanan !== null; }

  /** Komut yazar (yalnız hazır süreçte). Klavye isteği saklanır ve her `hazir`da yinelenir; kanca açılınca taban (Caps Lock, dil) için durum istenir. */
  gonder(k: YardimciKomutu): void {
    let satir: string;
    try { satir = komutSatiri(k); } catch { return; }
    if (k.k === 'klavye') this.klavye = k.acik;
    if (!this.surec || !this.hazir) return;
    this.yaz(this.surec, satir);
    if (k.k === 'klavye') this.yaz(this.surec, komutSatiri({ k: 'durum' }));
  }

  /** YALNIZ test (sahte yardımcının `sahte-olay` / `sahte-cik` komutları): ham JSON satırı yazar. */
  hamYaz(v: unknown): void {
    if (this.surec && this.hazir) this.yaz(this.surec, JSON.stringify(v));
  }

  /**
   * Uygulama kapanıyor: stdin kapanır, yardımcı 2 sn'de çıkmazsa öldürülür; yeniden başlatılmaz. Dönen söz yardımcı çıkınca ('cikti'), öldürülünce
   * ('olduruldu') ya da süreç yoksa hemen ('yok') çözülür; en geç `cikisMs`. İkinci çağrı aynı sözü döner.
   */
  kapat(): Promise<KapanisSonucu> {
    if (this.kapanis) return this.kapanis;
    this.kapandi = true;
    this.zamanlayicilariSil();
    const s = this.surec;
    this.surec = null;
    this.hazir = false;
    if (!s) return (this.kapanis = Promise.resolve('yok'));
    this.kapanan = s;
    this.kapanis = new Promise<KapanisSonucu>((coz) => { this.kapanisCoz = coz; });
    this.cikisZaman = kur(() => { this.cikisZaman = null; this.kapananiOldur(); }, this.o.cikisMs ?? CIKIS_MS);
    try { s.kapat(); } catch { /* zaten kapalı */ }
    return this.kapanis;
  }

  /** `will-quit`: süreç hâlâ yaşıyorsa (kapanış beklenmedi ya da yardımcı stdin'i yok saydı) hemen öldürülür. Kapatılmamışsa önce kapatılır. */
  oldur(): void {
    if (!this.kapanis) void this.kapat();
    this.kapananiOldur();
  }

  private kapanan: SatirSureci | null = null;
  private kapanis: Promise<KapanisSonucu> | null = null;
  private kapanisCoz: ((r: KapanisSonucu) => void) | null = null;

  private kapananiOldur(): void {
    const s = this.kapanan;
    if (!s) return;
    this.kapanan = null;
    if (this.cikisZaman) { clearTimeout(this.cikisZaman); this.cikisZaman = null; }
    try { s.oldur(); } catch { /* zaten kapalı */ }
    this.kapanisBitti('olduruldu');
  }

  private kapanisBitti(r: KapanisSonucu): void {
    const coz = this.kapanisCoz;
    this.kapanisCoz = null;
    coz?.(r);
  }

  private ac(): void {
    if (this.kapandi || this.durdu) return;
    let s: SatirSureci;
    try { s = this.o.baslat(); } catch (e) { this.cokus(`başlatılamadı: ${(e as Error).message}`); return; }
    this.surec = s;
    this.acilis = (this.o.simdi ?? Date.now)();
    this.hazir = false;
    s.satirda((satir) => {
      if (this.surec === s) this.satirIsle(s, satir);
      else if (this.kapanan === s) this.kapananSatiri(satir); // stdin kapandı: yalnız çıkıştaki sayaç satırı
    });
    s.bitince((neden) => {
      if (s === this.kapanan) {
        this.kapanan = null;
        if (this.cikisZaman) { clearTimeout(this.cikisZaman); this.cikisZaman = null; }
        this.kapanisBitti('cikti');
        return;
      }
      if (this.surec !== s) return;
      this.surec = null;
      this.cokus(neden);
    });
    this.hazirZaman = kur(() => {
      this.hazirZaman = null;
      if (this.surec !== s || this.hazir) return;
      this.surec = null; // geç gelen satırı ve çıkış olayını yok say
      try { s.oldur(); } catch { /* zaten kapalı */ }
      this.cokus(`${this.o.hazirMs ?? HAZIR_MS} ms içinde hazır demedi`);
    }, this.o.hazirMs ?? HAZIR_MS);
  }

  private satirIsle(s: SatirSureci, satir: string): void {
    const o = olaySatiriAyristir(satir);
    if (!o) return; // bozuk ya da bilinmeyen satır sessizce düşer (yardımcı sürümü değişmiş olabilir)
    if (o.t === 'sayac') { this.sayacGunlugu(o.sayaclar); return; } // tanı: hâle uygulanmaz, yayılmaz
    if (o.t === 'hazir') {
      if (this.hazir) return;
      this.hazir = true;
      if (this.hazirZaman) { clearTimeout(this.hazirZaman); this.hazirZaman = null; }
      if (this.klavye !== null) this.yaz(s, komutSatiri({ k: 'klavye', acik: this.klavye }));
      this.yaz(s, komutSatiri({ k: 'durum' }));
    }
    const onceki = this.durum;
    this.durum = durumGuncelle(this.durum, o);
    this.yay(o, onceki);
  }

  /** Kapanan sürecin (stdin kapandı, henüz çıkmadı) satırı: yalnız `sayac` işlenir. */
  private kapananSatiri(satir: string): void {
    const o = olaySatiriAyristir(satir);
    if (o?.t === 'sayac') this.sayacGunlugu(o.sayaclar);
  }

  /** 0.14 T28b: yalnız FUBER_DEMO'da tek satır. Ayrıştırıcıdan geçen nesne yalnız izinli adlar ve tamsayılardır (tuş verisi, başlık yok). */
  private sayacGunlugu(sayaclar: Partial<Record<SayacAlani, number>>): void {
    if (!this.o.demo) return;
    (this.o.gunluk ?? ((m: string) => console.warn(m)))(`[olay] yardımcı sayaçları ${JSON.stringify(sayaclar)}`);
  }

  /** Süreç kapandı/çöktü/takıldı: hâl boşalır (tam ekran yok), yeniden başlatma planlanır ya da durulur. */
  private cokus(neden: string): void {
    this.hazir = false;
    if (this.hazirZaman) { clearTimeout(this.hazirZaman); this.hazirZaman = null; }
    const onceki = this.durum;
    this.durum = BOS_DURUM;
    this.yay({ t: 'durum', ...BOS_DURUM }, onceki);
    if (this.kapandi) return;
    const simdi = (this.o.simdi ?? Date.now)();
    this.cokusler.push(simdi);
    const ms = yenidenBaslatmaPlani(this.cokusler, simdi);
    const gunluk = this.o.gunluk ?? ((m: string) => console.warn(m));
    // 0.14 T28 düzeltme turu 3 (N2): HER beklenmedik çıkış tek satır (neden: çıkış kodu ya da hazır zaman aşımı; açık kalma süresi) — yalnız üçüncüde değil.
    const acik = this.acilis ? Math.max(0, Math.round((simdi - this.acilis) / 1000)) : 0;
    gunluk(`[olay] yardımcı beklenmedik biçimde kapandı (${neden}; ${acik} sn açık kaldı); ${ms === null ? 'yeniden açılmıyor' : `${ms} ms sonra yeniden açılıyor`}`);
    if (ms === null) {
      this.durdu = true;
      gunluk(`[olay] yardımcı 10 dk içinde ${COKUS_ESIGI} kez kapandı; bu oturumda yeniden açılmıyor (son neden: ${neden})`);
      return;
    }
    this.yenidenZaman = kur(() => { this.yenidenZaman = null; this.ac(); }, ms);
  }

  private yay(o: SistemOlayi, onceki: SistemDurumu): void {
    for (const f of [...this.dinleyiciler]) {
      try { f(o, onceki); } catch (e) { console.warn('[olay] dinleyici:', (e as Error).message); }
    }
  }

  private yaz(s: SatirSureci, satir: string): void {
    try { s.yaz(satir.replace(/\n$/, '')); } catch { /* süreç kapanıyor: bitince bildirir */ }
  }

  private zamanlayicilariSil(): void {
    for (const z of [this.hazirZaman, this.yenidenZaman]) if (z) clearTimeout(z);
    this.hazirZaman = null;
    this.yenidenZaman = null;
  }
}

// ── Uygulamanın tek yardımcısı ──────────────────────────────────────────────────────────────────────────────────────────────────────
let tek: OlayYardimcisi | null = null;

/** Sahte yardımcı komutu (yalnız FUBER_DEMO): ["node", "scripts/dev/sahte-olay.mjs"]. */
function ozelKomut(): string[] | null {
  if (!(process.env.FUBER_DEMO && process.env.FUBER_OLAY_KOMUT)) return null;
  try {
    const k = JSON.parse(process.env.FUBER_OLAY_KOMUT) as unknown;
    return Array.isArray(k) && k.length > 0 && k.every((x) => typeof x === 'string') ? (k as string[]) : null;
  } catch { return null; }
}

/** Gerçek yardımcının yolu (paketli: kaynak/bin; geliştirme: resources/bin). Açılışta bir kez çözülür (yollar.ts Electron'a bağlı: bu modül Electron'suz sınanır). */
let exeYolu: string | null = null;

function yardimci(): OlayYardimcisi {
  tek ??= new OlayYardimcisi({
    baslat: () => {
      const ozel = ozelKomut();
      if (ozel) return satirSureci(ozel[0], ozel.slice(1));
      if (!exeYolu || !fs.existsSync(exeYolu)) throw new Error('fuber-olay.exe bulunamadı (kurulum eksik)');
      return satirSureci(exeYolu, []);
    },
    demo: Boolean(process.env.FUBER_DEMO),
  });
  return tek;
}

/** Uygulama açılışında bir kez: Windows'ta yardımcıyı açar. FUBER_DEMO'da FUBER_TEST_TAM_EKRAN tanımlı ve sahte komut yoksa açmaz (sabit test hâli). */
export function olayYardimcisiBaslat(): void {
  const ozel = ozelKomut();
  if (!ozel && process.platform !== 'win32') return;
  if (!ozel && process.env.FUBER_DEMO && process.env.FUBER_TEST_TAM_EKRAN !== undefined) return;
  if (ozel) { yardimci().baslat(); return; }
  void import('./yollar.js').then(({ yollar }) => { exeYolu = yollar.kaynak('bin', 'fuber-olay.exe'); yardimci().baslat(); })
    .catch((e: unknown) => console.warn('[olay] yardımcı yolu çözülemedi:', (e as Error)?.message ?? e));
}

/** Her olayı (ve olaydan önceki hâli) dinler; dönen işlev aboneliği kaldırır. Yardımcı çökünce boş bir `durum` gelir. */
export function sistemOlayiDinle(f: (o: SistemOlayi, onceki: SistemDurumu) => void): () => void { return yardimci().dinle(f); }
/** Son bilinen hâl (yardımcı yoksa ya da çöktüyse boş: tam ekran yok). */
export function sistemDurumu(): SistemDurumu { return tek?.durumu() ?? BOS_DURUM; }
export function yardimciyaGonder(k: YardimciKomutu): void { yardimci().gonder(k); }
/** before-quit: stdin kapanır; yardımcı çıkınca ya da en geç 2 sn'de öldürülünce çözülen söz (süreç yoksa null: çıkış beklemez). */
export function olayYardimcisiniKapat(): Promise<KapanisSonucu> | null {
  if (!tek) return null;
  const calisiyor = tek.calisiyorMu();
  const soz = tek.kapat(); // bekleyen yeniden başlatma da düşer
  return calisiyor ? soz : null;
}
/** will-quit: hâlâ yaşayan yardımcı doğrudan öldürülür (Windows'ta ana süreçle birlikte ölmez). */
export function olayYardimcisiniOldur(): void { tek?.oldur(); }
// ── 0.14 T25: medya durumunun çentiğe yayını ve panelin medya komutları ──────────────────────────────────────────────────────────────────────────
// Çentik (main/ada.ts → 'ada:medya') Kapalı hapı, panelin medya çubukları, Müzik ve Şarkı sözü sayfaları için medya oturumunu ve ses düzeyini alır. Yayın
// yalnız ikisinden biri DEĞİŞİNCE (şarj, ağ, dil olayları yaymaz; yardımcının aynı medya satırını yinelemesi de); yardımcı çökünce boş. Konum her saniye
// gelmez: arayüz anlık konumu medyaKonumu ile kendi hesaplar (T21).

/** Çentiğe giden medya hâli (son bilinen hâlden). */
export function centikMedyasi(d: SistemDurumu): CentikMedyasi {
  return { medya: d.medya ? { ...d.medya } : null, ses: d.ses ? { ...d.ses } : null };
}

const ayniMedya = (a: MedyaOlayi | null, b: MedyaOlayi | null): boolean => {
  if (a === b) return true;
  if (!a || !b || a.var !== b.var) return false;
  if (!a.var || !b.var) return true;
  return a.uygulama === b.uygulama && a.baslik === b.baslik && a.sanatci === b.sanatci && a.album === b.album && a.sure === b.sure && a.konum === b.konum
    && a.konumZamani === b.konumZamani && a.caliyor === b.caliyor && a.hiz === b.hiz && a.kapak === b.kapak;
};

/** Olay medya oturumunu ya da ses düzeyini değiştirdi mi (yayın kapısı). */
export function centikMedyasiDegisti(onceki: SistemDurumu, simdiki: SistemDurumu): boolean {
  if (!ayniMedya(onceki.medya, simdiki.medya)) return true;
  const a = onceki.ses, b = simdiki.ses;
  return a === b ? false : !a || !b || a.duzey !== b.duzey || a.sessiz !== b.sessiz;
}

/** Medya ya da ses değişince çentiğin hâlini verir; dönen işlev aboneliği kaldırır. */
export function centikMedyasiDinle(f: (m: CentikMedyasi) => void): () => void {
  return sistemOlayiDinle((o, onceki) => {
    const simdiki = sistemDurumu();
    if (centikMedyasiDegisti(onceki, simdiki)) f(centikMedyasi(simdiki));
  });
}

/**
 * Panelin 'medya:komut' girdisi → yardımcı komutu; geçersizse null. Yalnız medya eylemleri (oynat, duraklat, ileri, geri, konum + sn) ve ses düzeyi
 * (`{ ses: 0..1 }`, kıstırılır). Medya tuşu (klavye olayı) hiçbir yolda gönderilmez: komut oturumun kendi yöntemine gider (native/fuber-olay/medya.cpp).
 */
export function medyaKomutuAyikla(x: unknown): YardimciKomutu | null {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return null;
  const v = x as Record<string, unknown>;
  if ('ses' in v) return typeof v.ses === 'number' && Number.isFinite(v.ses) ? { k: 'ses', duzey: Math.min(1, Math.max(0, v.ses)) } : null;
  const eylem = v.eylem;
  if (typeof eylem !== 'string' || !(MEDYA_EYLEMLERI as readonly string[]).includes(eylem)) return null;
  if (eylem === 'konum') return typeof v.sn === 'number' && Number.isFinite(v.sn) ? { k: 'medya', eylem: 'konum', sn: Math.max(0, v.sn) } : null;
  return { k: 'medya', eylem: eylem as Exclude<MedyaEylemi, 'konum'> };
}

/** 'medya:komut': geçerli komut yardımcıya gider; medya eylemi yalnız çalan bir oturum varken (yoksa denetimler zaten kapalı). true: gönderildi. */
export function medyaKomutu(x: unknown): boolean {
  const k = medyaKomutuAyikla(x);
  if (!k) return false;
  if (k.k === 'medya' && !sistemDurumu().medya?.var) return false;
  yardimciyaGonder(k);
  return true;
}

/** YALNIZ FUBER_DEMO + sahte yardımcı (ada:test-olay): sahte yardımcıya olay yazdırır ya da onu çökertir. */
export function olayYardimcisiTestKomutu(v: unknown): boolean {
  if (!ozelKomut() || !tek?.hazirMi()) return false;
  tek.hamYaz(v);
  return true;
}
