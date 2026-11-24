// ── Toplantı oturumu: ses → yazı → çeviri → robot önerisi → özet (12 Kas 2026; 14 Kas: gerçek zamanlı akış; Electron'suz çekirdek — tests/toplanti.test.ts) ──────────────
// main/toplanti.ts bunu ayarlar, Fuber hesabı, Whisper, yapay zekâ ve pencereyle kurar; testler sahte yazıya çevirme ve sahte yapay zekâyla doğrudan kurar.
//  · Yol (P14) HER ÇAĞRIDA yeniden sorulur: Gizli ya da "Yalnız bu bilgisayar"da yazıya çevirme yalnız bu bilgisayardaki tanıyıcı (Whisper), yapay zekâ
//    yalnız yerel ('yerel' yolu); hiçbir ses ya da metin buluta gitmez. Toplantı ortasında Gizli açılırsa canlı akış HEMEN kapanır, sonraki ses buluta gitmez.
//  · Yazıya çevirme üç biçimde çalışır (her konuşmanın "kipi"; konuşma başında seçilir, arıza olursa düşer — metin kaybolmaz):
//     'akis'    bulut, GERÇEK ZAMANLI: konuşan başına tek Scribe bağlantısı (main/toplanti/akis.ts); ses konuştukça akar, kısmi metin satırda canlı görünür, konuşma
//               bitince (VAD) commit edilir ve kesin metin gelir. Parça beklemek, istek beklemek yok. Düşerse bekleyen ses toplu yola devredilir.
//     'whisper' bu bilgisayarda: büyüyen pencere — konuşma sürerken ~0,7 sn'de bir satırın o ana dek sesi yeniden çevrilir (kısmi metin), bitince son geçiş. Yerel sunucu tek
//               iş yaptığı için sıra öncelikli: kesin geçişler kısmi pencerelerin önüne geçer, kısmi pencere asla kuyrukta birikmez.
//     'toplu'   bulut yedeği (akış yok / düştü): ses ≤4 sn'lik parçalarla toplu çeviriye gider (eski yol; konuşan başına sıralı).
//  · Çeviri kesin cümle gelir gelmez TEK TEK ve PARALEL (en çok CEVIRI_PARALEL) başlar; toplu bekleme yok. Yanıt düz metin olarak harf harf akar (YzIstegi.akis). Konuşma
//    sürerken uzun kısmi metin için hafif bir ön çeviri denenir (bulut yolu, en çok 2 çağrı/satır; kesin çeviri gelince yerini alır). Satırın dili hedef dille aynıysa çağrı yok.
//  · Robot: yalnız karşı tarafın satırı. Sezgi 'soru' → öneri; 'belki' → hafif model denetimi; 'degil' → hiçbir şey. Aynı anda tek öneri üretilir; çeviri sürerken bekler
//    (düşük öncelik: çeviriyi yavaşlatmaz). Öneri yalnız durumda durur: seslendirilmez, gönderilmez.
//  · "Siz" satırı karşı tarafın aynı aralıktaki satırının yankısıysa (hoparlör → mikrofon) atılır; kısmi metin de yankıya benziyorsa satır görünmez.
//  · Uzun toplantı: durum yayını hafif olabilir (hafifYayin: yalnız değişen satırlar; ToplantiDurumu.yama) ve en çok her 30 ms'de bir gider.
//  · durdur(): bekleyen yazıya çevirmeler ve çeviriler biter (üst sınırlı), özet istenir; iptal(): hemen durur (uygulama kapanışı), özet yok.
import { pcmdenWav } from '../../shared/pcm.ts';
import { dikteSiniriMi, sesModeliYokMu } from '../../shared/masaustu-hesap.ts';
import { baglamBosMu, baglamMetni, baglamTemizle, bosBaglam, type ToplantiBaglami } from '../../shared/toplanti-baglam.ts';
import {
  BULUT_NEDENI_METNI, CEVIRI_PARALEL, SATIR_ZAMAN_ASIMI_MS, TOPLANTI_SINIR_METNI, UYARI, bulutGecisMetni, toplantiYolu, ceviriIstemiTek, ceviriTemiz, dilSez, ozetCoz, ozetIstemi, robotCoz, robotIstemi, soruDenetimCoz, soruDenetimIstemi, soruMu, yankiMi,
  type BulutNedeni, type Konusan, type RobotOnerisi, type ToplantiDurumu, type ToplantiSatiri, type ToplantiTani, type YaziYolu,
} from '../../shared/toplanti.ts';
import { WHISPER_YAVAS_MS, WhisperHatasi, gecikmeOrtalamasi, hataArindir, whisperSorunu, type WhisperSorunu } from '../../shared/whisper-tani.ts';
import type { AkisDusumu } from './akis.ts';

/** Bir konuşan için canlı akış bağlantısı (main/toplanti/akis.ts ScribeAkisi; testte sahte). */
export interface CanliAkis {
  /** Bağlantıyı önceden kurar (ilk söz beklemesin). */
  baslat(): void;
  /** Ses (16 kHz PCM16): segment numarası; akış kapalıysa 0. */
  ses(pcm: Uint8Array): number;
  /** Açık segmenti kapatır: kesin metin `kesin(metin, no)` ile gelir. Ses yoksa 0. */
  commit(): number;
  kapat(): void;
  readonly kapaliMi: boolean;
}
export interface AkisOlaylari {
  kismi(metin: string, no: number): void;
  kesin(metin: string, no: number): void;
  dustu(d: AkisDusumu): void;
}
export interface AkisFabrikasi {
  /** Bulut akışı şu an kullanılabilir mi (hesap var, "Bu bilgisayar" seçili değil, Gizli kapalı). */
  kullanilir(): boolean;
  ac(konusan: Konusan, o: AkisOlaylari): CanliAkis;
}

export interface ToplantiStt {
  /** Fuber hesabının yazıya çevirmesi (bulut, toplu). 402 ya da günlük tavanda DikteSiniri fırlar. */
  hesap?: { kullanilir(): boolean; yaziya(wav: Uint8Array, konusan: Konusan): Promise<string | null> };
  /** Bu bilgisayardaki tanıyıcı (dil otomatik). */
  whisper?: {
    hazirMi(): boolean; cevir(wav: Uint8Array, konusan: Konusan): Promise<string | null>;
    /** Tanı (Ayrıntılar): sunucunun gerçek donanımı, model, ortalama istek süresi. */
    tani?(): { calisiyor: boolean; donanim: string; model: string; derleme: string; gecikmeMs: number | null; sonHata: string };
  };
  /** Bulut yolu kullanıcı seçimi DIŞINDA neden kapalı (hesap yok, pasif, sunucuda model yok…)? Kullanıcı yerel ya da Gizli seçtiyse null (seçim, hata değil). Yol 'whisper'a düşünce çipte söylenir. */
  bulutNeden?(): BulutNedeni | null;
  /** Bulut yazıya çevirmenin görünen adı (varsayılan 'Fuber bulutu'; Gemini'de 'Gemini'). */
  bulutAdi?: string;
  /** Gerçek zamanlı bulut akışı (varsa bulut yolunun ilk tercihi; toplu yol yedek kalır). */
  akis?: AkisFabrikasi;
}
/** 'yerel': yalnız bu bilgisayardaki yapay zekâ (Gizli / "Yalnız bu bilgisayar"); 'serbest': uygulamanın bugünkü kuralı. */
export type YzYolu = 'yerel' | 'serbest';
export interface YzIstegi {
  sistem: string; kullanici: string; amac: string; json?: boolean; maxToken: number;
  /** Yanıt üretildikçe parça parça (sağlayıcı akışı destekliyorsa); dönen tam metin yine esastır. */
  akis?: (parca: string) => void;
}

export interface ToplantiBagimliliklari {
  /** Gizli ya da "Yalnız bu bilgisayar" (her çağrıda sorulur). */
  bulutsuz(): boolean;
  stt: ToplantiStt;
  yz(i: YzIstegi, yol: YzYolu): Promise<string>;
  /** Robot için kullanıcının notları (çekirdek hafıza); boş olabilir. */
  baglam?(): string;
  /** Üst şeritteki iki sade satır (ayarlardan: hangi yazıya çevirme / hangi yapay zekâ). */
  etiketler?(yazi: YaziYolu, bulutsuz: boolean): { yazi: string; yz: string };
  kullaniciAdi?(): string;
  /** Satır bu kadar süre hiç metin almazsa "yazıya çevrilemedi" olur (ms; varsayılan SATIR_ZAMAN_ASIMI_MS; önizleme/test kısaltır). */
  satirZamanAsimiMs?: number;
  /** Geliştirici kipi: Ayrıntılar'da model adı ve ham hata görünür; İş'te teknik sözcük yok (shared/is-dili.ts). */
  gelistirici?(): boolean;
  /** Durum değişti (aynı mikro görevdeki değişiklikler tek yayın; `yayinAraligiMs` varsa en sık o aralıkta). */
  degisti(d: ToplantiDurumu): void;
  simdi?(): number;
  /** Eski toplu çeviri beklemesi: artık kullanılmaz (çeviri anında başlar). */
  ceviriBeklemeMs?: number;
  /** durdur() bekleyen işleri en çok bu kadar bekler (ms). */
  kapanisBeklemeMs?: number;
  gunluk?(m: string): void;
  /** Yayın en sık bu aralıkta (ms). Verilmezse bir mikro görevde birleşir (testler). Üretimde 30. */
  yayinAraligiMs?: number;
  /** true: yayında `satirlar` boş, yalnız değişen satırlar `yama`da (uzun toplantıda IPC ve çizim hafif kalır). */
  hafifYayin?: boolean;
  /** Konuşma sürerken kısmi metin için hafif ön çeviri (varsayılan açık; yalnız bulut yapay zekâsında çalışır). */
  onCeviri?: boolean;
  /** Eşzamanlı çeviri sayısı (varsayılan CEVIRI_PARALEL). */
  ceviriParalel?: number;
  /** Canlı akış düştükten sonra yeniden denemeden önce bekleme (ms; varsayılan 60 sn). */
  akisYenidenMs?: number;
}

export interface ParcaGirdisi { konusan: Konusan; konusmaNo: number; parcaNo: number; pcm: Uint8Array; son: boolean; basMs: number; bitMs: number }

type Kip = 'akis' | 'whisper' | 'toplu' | 'yok';
interface SatirIc {
  s: ToplantiSatiri;
  /** Toplu yol: parça numarası → metin. */
  parcalar: Map<number, string | null>;
  sonParca?: number;
  kip?: Kip;
  akisNo?: number;
  /** Akıştan önce (ya da kip değişmeden önce) onaylanmış metin: sonraki metin bunun ARKASINA eklenir. */
  onayli: string;
  /** Yerel yol: satırın o ana dek bütün sesi (büyüyen pencere). */
  tum: Uint8Array[]; tumBayt: number;
  /** Toplu yol: henüz yollanmamış ses. */
  parcaPcm: Uint8Array[]; parcaBayt: number; parcaSayac: number;
  wMesgul: boolean; wSonBayt: number; wMetin: string | null;
  bitti: boolean; atilacak: boolean; gizli: boolean;
  /** VAD konuşma numarası ve (yerel kesmede) kaçıncı devam satırı. */
  vadNo: number; devamNo: number;
  /** Çeviri: her kesin başlangıçta artar; eski (kısmi / önceki) sonuçlar bununla elenir. */
  cevNo: number; onCevSay: number; onCevKelime: number; onCevZaman: number;
  /** Zaman aşımı denetimi (ms, simdi() tabanı): satırın doğuşu, son metin ilerlemesi, bitiş anı; metin hiç geldi mi. */
  olusma: number; sonIlerleme: number; bittiZaman: number; metinGeldi: boolean;
}

const DIKTE_HZ = 16_000;
const BAYT_SN = DIKTE_HZ * 2;
/** Toplu yol: bir parça en çok ~4 sn (eski VAD parçası); yerel tanıyıcı sınırı 30 sn. */
const PARCA_BAYT = 4 * BAYT_SN;
const PARCA_SINIRI = 30 * BAYT_SN;
const DIL_YENIDEN_CEVIRI = 30;
/** Yerel büyüyen pencere: ilk kısmi en az 1,0 sn sesle, sonra ≥0,7 sn yeni sesle yenilenir; pencere son 15 sn. */
const WHISPER_ILK_BAYT = 1.0 * BAYT_SN;
const WHISPER_ADIM_BAYT = 0.7 * BAYT_SN;
const WHISPER_PENCERE_BAYT = 15 * BAYT_SN;
/** Yerel satır en çok bu kadar sesle büyür (7 sn); kesim 4,5–6,8 sn arasındaki en sessiz blokta, duraklama yoksa 6 sn'de. */
const WHISPER_KES_BAYT = 7 * BAYT_SN;
const WHISPER_KES_ARALIK = [4.5 * BAYT_SN, 6.8 * BAYT_SN] as const;
const WHISPER_KES_SERT = 6 * BAYT_SN;
const AKIS_YENIDEN_MS = 60_000;
const ON_CEVIRI_EN_AZ_KELIME = 8;
const ON_CEVIRI_ARALIK_MS = 2500;
const ON_CEVIRI_EN_COK = 2;
/** Bir ses bloğunun ortalama enerjisi (RMS; 0…32768). */
function blokEnerjisi(b: Uint8Array): number {
  const n = b.length >> 1;
  if (!n) return 0;
  const v = new DataView(b.buffer, b.byteOffset, n * 2);
  let t = 0;
  for (let i = 0; i < n; i++) { const x = v.getInt16(i * 2, true); t += x * x; }
  return Math.sqrt(t / n);
}
const kelimeSay = (m: string): number => (m.trim() ? m.trim().split(/\s+/).length : 0);
const uyku = (ms: number) => new Promise<void>((c) => setTimeout(c, ms));
const birlestir = (l: readonly Uint8Array[]): Uint8Array => { const o = new Uint8Array(l.reduce((n, p) => n + p.length, 0)); let k = 0; for (const p of l) { o.set(p, k); k += p.length; } return o; };

/** Öncelikli sıra (yerel tanıyıcı tek iş yapar): küçük sayı önce. */
class OncelikliKuyruk {
  private calisan = 0;
  private bekleyen: { o: number; calis: () => void }[] = [];
  private readonly en: number;
  constructor(en: number) { this.en = en; }
  ekle<T>(oncelik: number, f: () => Promise<T>): Promise<T> {
    return new Promise<T>((coz, red) => {
      const calis = () => { this.calisan++; f().then(coz, red).finally(() => { this.calisan--; this.sonraki(); }); };
      if (this.calisan < this.en && !this.bekleyen.length) { calis(); return; }
      this.bekleyen.push({ o: oncelik, calis });
      this.bekleyen.sort((a, b) => a.o - b.o);
    });
  }
  private sonraki(): void { while (this.calisan < this.en && this.bekleyen.length) this.bekleyen.shift()!.calis(); }
  /** Bekleyen ya da çalışan iş var mı (kısmi pencere bunu görünce kuyruğa girmez). */
  get mesgul(): boolean { return this.calisan > 0 || this.bekleyen.length > 0; }
}

export class ToplantiOturumu {
  private readonly d: ToplantiBagimliliklari;
  private readonly durum: ToplantiDurumu;
  private readonly satirlar = new Map<string, SatirIc>();
  private readonly kuyruk: Record<Konusan, Promise<void>> = { karsi: Promise.resolve(), siz: Promise.resolve() };
  private readonly sonDil: Partial<Record<Konusan, string>> = {};
  private readonly akislar: Partial<Record<Konusan, CanliAkis>> = {};
  private readonly akisSatirlari: Record<Konusan, Map<number, SatirIc>> = { karsi: new Map(), siz: new Map() };
  private readonly akisDustu: Partial<Record<Konusan, number>> = {};
  /** Yerel kesmede (whisperKes) bir VAD konuşmasının SÜREN devam satırı: 'karsi:3' → karsi:3.1 … */
  private readonly devam = new Map<string, SatirIc>();
  private readonly whisperKuyrugu = new OncelikliKuyruk(1);
  private readonly isler = new Set<Promise<unknown>>();
  private ceviriSirasi: (() => Promise<void>)[] = [];
  private ceviriAktif = 0;
  private onCeviriAktif = 0;
  private robotSuruyor: Promise<void> | null = null;
  private robotSiradaki: string | null = null;
  /** Bulutta yazıya çevirme bu toplantıda düştü (sınır, sunucuda ses modeli yok, üst üste hata): kurulu yerel tanıyıcıya geçilir, yoksa eylem düğmesi çıkar. */
  private bulutDustu = false;
  private hesapArdisikHata = 0;
  private ceviriArdisikHata = 0;
  /** Geçici uyarı (bir sonraki başarılı işte kalkar); kalıcı olan (yol değişti, yazıya çevirme kapalı) yerinde durur. */
  private geciciUyari = false;
  private yayinSirada = false;
  private sonYayin = 0;
  private kirli = new Set<string>();
  private silinen = new Set<string>();
  private oneriNo = 0;
  private baglamIc: ToplantiBaglami;
  /** Bulut bu toplantıda neden bırakıldı / canlı akış neden düştü (çipte ve Ayrıntılar'da). */
  private bulutNedeniIc: BulutNedeni | null = null;
  private akisNedeniIc: BulutNedeni | null = null;
  /** Ayrıntılar sayaçları: yazıya çevirmeye giden ses blokları, metin alan satırlar, zaman aşımına/hataya düşen satırlar; son (arındırılmış) hata. */
  private gelenParca = 0;
  private gelenMetin = 0;
  private basarisiz = 0;
  private sonHataIc = '';
  /** Yerel yazıya çevirmenin son sorunu (satır "yazıya çevrilemedi" olunca çipte nedeni söylenir). */
  private whisperSorunuIc: WhisperSorunu | null = null;
  /** Yerel isteklerin ortalama süresi (ms); WHISPER_YAVAS_MS'i aşarsa kısmi pencere kapanır, yalnız kesin geçiş çalışır. */
  private whisperOrt: number | null = null;
  private denetimSaati: ReturnType<typeof setInterval> | null = null;

  constructor(d: ToplantiBagimliliklari, o: { id: string; hedefDil: string; robot: boolean; baglam?: unknown }) {
    this.d = d;
    const bulutsuz = d.bulutsuz();
    this.baglamIc = o.baglam ? baglamTemizle(o.baglam) : bosBaglam();
    this.durum = {
      id: o.id, hal: 'dinliyor', baslangic: this.simdi(), yol: this.yaziYolu(bulutsuz), bulutsuz, hedefDil: o.hedefDil, robot: o.robot,
      satirlar: [], oneriler: [], ozet: null, yankiAtilan: 0, baglamVar: !baglamBosMu(this.baglamIc),
    };
    // Hiçbir satır "…"de sonsuza dek kalmaz: saniyede bir süresi dolan satırlar "yazıya çevrilemedi" olur (denetim satirlariDenetle; testler doğrudan çağırır).
    this.denetimSaati = setInterval(() => this.satirlariDenetle(), 1000);
    this.denetimSaati.unref?.();
  }

  private denetimiDurdur(): void { if (this.denetimSaati) { clearInterval(this.denetimSaati); this.denetimSaati = null; } }

  /** Ham hatayı Ayrıntılar'a koyar: yol, anahtar/belirteç benzeri uzun diziler maskelenir, kısa tutulur. */
  private hataKaydet(e: unknown): void {
    this.sonHataIc = hataArindir(String((e as Error)?.message ?? e ?? ''));
  }

  /** Satırı "yazıya çevrilemedi" yapar (kesin, metinsiz, hata bayrağı); nedeni çipte söyler. */
  private satirHata(x: SatirIc, sorun?: WhisperSorunu): void {
    if (x.s.kesin && x.s.hata) return;
    x.s.kesin = true; x.s.hata = true; x.s.ceviriDurum = 'yok'; x.atilacak = true;
    x.cevNo++;
    this.basarisiz++;
    this.dokun(x);
    const sor = sorun ?? this.whisperSorunuIc;
    if (sor) this.uyar(sor.metin, sor.seviye === 'bilgi' ? 'sorun' : sor.seviye, sor.eylem, sor.eylem === undefined);
    else if (!this.durum.uyari || this.geciciUyari) this.uyar(UYARI.satirYok, 'sorun', undefined, true);
  }

  /** Süresi dolan satırlar: SATIR_ZAMAN_ASIMI_MS boyunca hiç metin almadıysa "yazıya çevrilemedi"; bitmiş ama kesin metni gelmeyen satır elde kalan metinle kesinleşir. */
  satirlariDenetle(): void {
    if (this.durum.hal !== 'dinliyor') return;
    const simdi = this.simdi();
    const zaman = this.d.satirZamanAsimiMs ?? SATIR_ZAMAN_ASIMI_MS;
    let degisti = false;
    for (const x of [...this.satirlar.values()]) {
      if (x.s.kesin || x.gizli) continue;
      if (!x.s.metin && simdi - x.sonIlerleme >= zaman) {
        let sor: WhisperSorunu | undefined;
        if (x.kip === 'whisper' || x.kip === 'yok') {
          // Yerel yol: motorun sorunu (eksik model, yavaş, çökme) çipte söylenir.
          sor = this.whisperSorunuIc ?? undefined;
          if (!sor && this.whisperOrt !== null && this.whisperOrt >= WHISPER_YAVAS_MS) sor = whisperSorunu(new WhisperHatasi('zaman-asimi'));
          if (!sor && x.kip === 'yok') sor = { neden: 'model-yok', metin: UYARI.yerelYok, eylem: 'whisper-indir', seviye: 'sorun' };
        } else if (x.kip === 'akis') {
          this.hataKaydet(new Error('canlı akıştan metin gelmedi'));
          this.akislar[x.s.konusan]?.commit();
        }
        this.satirHata(x, sor);
        degisti = true;
      } else if (x.s.metin && x.bitti && x.bittiZaman && simdi - x.bittiZaman >= zaman + 10_000) {
        this.kesinlestir(x); degisti = true; // son yanıt hiç gelmedi: elde kalan metin
      }
    }
    if (degisti) this.yayin();
  }

  private simdi(): number { return this.d.simdi?.() ?? Date.now(); }

  /** Yazıya çevirmenin yolu (shared/toplanti.ts toplantiYolu): bulutsuzda yalnız kurulu Whisper (P14); bulutta Fuber hesabı, o yoksa/düştüyse kurulu Whisper. Her çağrıda yeniden sorulur. */
  private yaziYolu(bulutsuz = this.d.bulutsuz()): YaziYolu {
    return toplantiYolu({ bulutsuz, hesapKullanilir: this.d.stt.hesap?.kullanilir() === true || this.d.stt.akis?.kullanilir() === true, bulutDustu: this.bulutDustu, whisperKurulu: this.d.stt.whisper?.hazirMi() === true });
  }

  /** Oturum kurulunca bir kez: bulut akışı kullanılabiliyorsa iki konuşan için bağlantılar önceden açılır (ilk söz bağlantı beklemesin). */
  baslat(): void {
    if (this.akisKullanilabilir()) for (const k of ['karsi', 'siz'] as const) this.akisAc(k);
  }

  anlik(satirlarDahil = true): ToplantiDurumu {
    const satirlar = satirlarDahil ? [...this.satirlar.values()].filter((x) => !x.gizli).map((x) => ({ ...x.s })).sort((a, b) => a.basMs - b.basMs || (a.konusan === 'karsi' ? -1 : 1)) : [];
    // Yol her anlıkta yeniden okunur: Whisper bu arada kurulduysa ya da hesap girişi değiştiyse üst şerit doğruyu söyler.
    if (this.dinliyor) {
      this.durum.yol = this.yaziYolu();
      // Yerel yazıya çevirme bu arada kuruldu (düğme): "indir" eylemi kalkar; bulut düşmüşse sakin bilgi kalır.
      if (this.durum.yol === 'whisper' && this.durum.uyariEylemi === 'whisper-indir' && !this.whisperSorunuIc) {
        if (this.bulutDustu) this.uyar(UYARI.bulutDustuYerelVar, 'bilgi'); else this.uyariyiTemizle2();
      }
      this.gecisCipi();
    }
    let et: { yazi: string; yz: string } | undefined;
    try { et = this.d.etiketler?.(this.durum.yol, this.d.bulutsuz()); } catch { /* etiket en iyi çaba */ }
    const { yama: _y, ...temel } = this.durum;
    return {
      ...temel, tani: this.taniAl(), satirlar, oneriler: this.durum.oneriler.map((o) => ({ ...o })), ...(this.durum.ozet ? { ozet: { ...this.durum.ozet } } : {}),
      ...(et ? { yaziMotoru: et.yazi, yzMotoru: et.yz } : {}),
    };
  }

  /** Bulut yazıya çevirme kullanılamayıp YEREL yazılıyorsa (seçim değil, düşüş): neden her zaman çipte: "Fuber bulutu kullanılamadı: <neden>; bu bilgisayarda yazılıyor." */
  private gecisNedeni(): BulutNedeni | null {
    if (this.durum.bulutsuz || this.durum.yol !== 'whisper') return null;
    return this.bulutNedeniIc ?? this.d.stt.bulutNeden?.() ?? null;
  }
  private gecisCipi(): void {
    const n = this.gecisNedeni();
    if (!n) return;
    const ad = this.d.stt.bulutAdi ?? 'Bulut';
    const metin = bulutGecisMetni(n).replace('Bulut', ad);
    // Başka bir sorun çipi varsa ona dokunulmaz (satır hatası, yerel model eksik…); geçiş çipi sakin bilgidir. Kayıtlı oturum için kredi/tavan çipi zaten kendi metnini taşır.
    const bizim = !this.durum.uyari || this.durum.uyari.startsWith(`${ad} kullanılamadı`) || this.durum.uyari === UYARI.bulutDustuYerelVar;
    if (!bizim || this.durum.uyari === TOPLANTI_SINIR_METNI.kredi || this.durum.uyari === TOPLANTI_SINIR_METNI.tavan) return;
    this.uyar(metin, 'bilgi', n === 'hesap-yok' || n === 'hesap-pasif' ? 'giris' : undefined);
  }

  private taniAl(): ToplantiTani {
    const yol = this.durum.yol;
    const a = this.d.stt.bulutAdi ?? 'Bulut';
    const gel = this.d.gelistirici?.() === true;
    const canli = (['karsi', 'siz'] as const).filter((k) => this.akislar[k] && !this.akislar[k]!.kapaliMi).length;
    const w = this.d.stt.whisper?.tani?.();
    let yerelAd = 'Bu bilgisayar';
    try { yerelAd = this.d.etiketler?.('whisper', this.d.bulutsuz()).yazi ?? yerelAd; } catch { /* etiket en iyi çaba */ }
    const motor = yol === 'hesap' ? (canli ? `${a} (canlı)` : `${a} (toplu)`) : yol === 'whisper' ? yerelAd : 'Yok';
    const donanim = w?.donanim === 'cuda' ? 'ekran kartı' : w?.donanim === 'cpu' ? 'işlemci' : 'donanım bilinmiyor';
    let baglanti: string;
    if (yol === 'hesap') baglanti = canli ? `canlı akış: ${(['karsi', 'siz'] as const).map((k) => `${k === 'karsi' ? 'karşı taraf' : 'siz'} ${this.akislar[k] && !this.akislar[k]!.kapaliMi ? 'bağlı' : this.akisDustu[k] ? 'düştü' : 'yok'}`).join(', ')}` : this.akisNedeniIc ? `canlı akış kapalı (${BULUT_NEDENI_METNI[this.akisNedeniIc]}); toplu yazıya çevirme` : 'toplu yazıya çevirme';
    else if (yol === 'whisper') baglanti = w ? `yerel yazıya çevirme ${w.calisiyor ? 'çalışıyor' : 'kapalı'} · ${donanim}${this.whisperOrt !== null ? ` · ort. ${(this.whisperOrt / 1000).toFixed(1)} sn` : ''}` : 'yerel yazıya çevirme';
    else baglanti = 'yazıya çevirme yolu yok';
    const n = this.gecisNedeni();
    return {
      motor, baglanti, sonHata: gel ? this.sonHataIc : this.sonHataIc ? 'var' : '', gelenParca: this.gelenParca, gelenMetin: this.gelenMetin, basarisiz: this.basarisiz,
      ...(n ? { bulutNedeni: n } : {}),
      ...(w && gel ? { yerel: { donanim: w.donanim, model: w.model, gecikmeMs: this.whisperOrt ?? w.gecikmeMs, derleme: w.derleme } } : {}),
    };
  }

  /** Toplantı bağlamı (konu, katılımcılar, notlar, ton, belgeler): başlarken ya da süren toplantıda değişir; sonraki istemlere girer. */
  baglamAyarla(ham: unknown): void {
    this.baglamIc = baglamTemizle(ham);
    this.durum.baglamVar = !baglamBosMu(this.baglamIc);
    this.yayin();
  }
  baglamKaydi(): ToplantiBaglami { return this.baglamIc; }
  /** Kullanıcı modeli / yazıya çevirme yolunu değiştirdi: bağımlılıklar seçimi her istekte okur; burada yalnız yol ve üst şerit etiketleri tazelenir (durum yayını). */
  yenile(): void { this.yayin(); }

  private uyar(metin: string, seviye: 'bilgi' | 'sorun', eylem?: ToplantiDurumu['uyariEylemi'], gecici = false): void {
    this.durum.uyari = metin;
    this.durum.uyariSeviyesi = seviye;
    if (eylem) this.durum.uyariEylemi = eylem; else delete this.durum.uyariEylemi;
    this.geciciUyari = gecici;
  }
  private uyariyiTemizle2(): void { delete this.durum.uyari; delete this.durum.uyariEylemi; delete this.durum.uyariSeviyesi; this.geciciUyari = false; }
  /** Bir iş başarıyla bitti: geçici uyarı kalkar (sonsuz sarı uyarı yok). */
  private uyariyiTemizle(): void {
    if (this.geciciUyari) this.uyariyiTemizle2();
  }

  // ── Yayın (hafif yama) ──
  private dokun(x: SatirIc): void { if (x.gizli) { this.kirli.delete(x.s.id); this.silinen.add(x.s.id); } else { this.kirli.add(x.s.id); this.silinen.delete(x.s.id); } }
  private satirSil(x: SatirIc): void { this.satirlar.delete(x.s.id); this.kirli.delete(x.s.id); this.silinen.add(x.s.id); }
  private yamaAl(): { satirlar: ToplantiSatiri[]; silinen: string[] } {
    const satirlar: ToplantiSatiri[] = [];
    for (const id of this.kirli) { const x = this.satirlar.get(id); if (x && !x.gizli) satirlar.push({ ...x.s }); }
    const silinen = [...this.silinen];
    this.kirli.clear(); this.silinen.clear();
    return { satirlar, silinen };
  }
  private yayin(): void {
    if (this.yayinSirada) return;
    this.yayinSirada = true;
    const calistir = () => {
      this.yayinSirada = false;
      this.sonYayin = Date.now();
      try { this.d.degisti(this.d.hafifYayin ? { ...this.anlik(false), yama: this.yamaAl() } : this.anlik()); } catch { /* pencere yok */ }
    };
    const aralik = this.d.yayinAraligiMs ?? 0;
    if (!aralik) { queueMicrotask(calistir); return; }
    setTimeout(calistir, Math.max(0, aralik - (Date.now() - this.sonYayin)));
  }

  private get dinliyor(): boolean { return this.durum.hal === 'dinliyor'; }
  private isTakip<T>(p: Promise<T>): Promise<T> {
    this.isler.add(p);
    void p.finally(() => this.isler.delete(p)).catch(() => undefined);
    return p;
  }

  // ── Satır ──
  private yeniSatir(konusan: Konusan, id: string, basMs: number): SatirIc {
    const x: SatirIc = {
      s: { id, konusan, basMs, metin: '', kesin: false, dil: null, ceviriDurum: 'bekliyor' }, parcalar: new Map(), onayli: '', tum: [], tumBayt: 0, parcaPcm: [], parcaBayt: 0, parcaSayac: 0,
      wMesgul: false, wSonBayt: 0, wMetin: null, bitti: false, atilacak: false, gizli: false, vadNo: 0, devamNo: 0, cevNo: 0, onCevSay: 0, onCevKelime: 0, onCevZaman: 0,
      olusma: this.simdi(), sonIlerleme: this.simdi(), bittiZaman: 0, metinGeldi: false,
    };
    this.satirlar.set(id, x);
    this.dokun(x);
    return x;
  }

  /** Konuşma başladı (VAD): "…" satırı hemen görünür. */
  basladi(konusan: Konusan, konusmaNo: number, basMs: number): void {
    if (!this.dinliyor) return;
    const id = `${konusan}:${konusmaNo}`;
    if (this.satirlar.has(id)) return;
    this.yeniSatir(konusan, id, basMs).vadNo = konusmaNo;
    this.yayin();
  }

  /** Bir VAD konuşmasının şu an ses alan satırı (yerel kesmeden sonra devam satırı). */
  private satirOf(konusan: Konusan, konusmaNo: number): SatirIc | undefined { return this.devam.get(`${konusan}:${konusmaNo}`) ?? this.satirlar.get(`${konusan}:${konusmaNo}`); }

  /** Konuşma kısa kaldı (VAD): satır kalkar; ses çoktan gittiyse sonucu atılır. */
  vazgecildi(konusan: Konusan, konusmaNo: number): void {
    const x = this.satirOf(konusan, konusmaNo);
    this.devam.delete(`${konusan}:${konusmaNo}`);
    if (!x || x.s.kesin) return;
    if (x.kip === 'akis' && x.akisNo) { x.atilacak = true; this.akislar[konusan]?.commit(); this.satirSil(x); this.yayin(); return; }
    if (!x.parcalar.size && !x.s.metin) { x.atilacak = true; this.satirSil(x); this.yayin(); }
  }

  /** Bir konuşmanın sesi (16 kHz PCM16; akış kipi — toplanti-vad.ts 'ses' olayı). */
  sesGeldi(konusan: Konusan, konusmaNo: number, pcm: Uint8Array, basMs: number): void {
    if (!this.dinliyor || !pcm?.length) return;
    this.basladi(konusan, konusmaNo, basMs);
    const x = this.satirOf(konusan, konusmaNo);
    if (!x || x.s.kesin || x.atilacak) return;
    if (!x.kip) x.kip = this.kipSec(konusan);
    else this.kipDenetle(x);
    this.sesIsle(x, pcm);
  }

  private sesIsle(x: SatirIc, pcm: Uint8Array): void {
    const k = x.s.konusan;
    this.gelenParca++;
    switch (x.kip) {
      case 'akis': {
        const a = this.akislar[k];
        const no = a && !a.kapaliMi ? a.ses(pcm) : 0;
        if (!no) { x.kip = this.kipSec(k, true); this.sesIsle(x, pcm); return; }
        if (x.akisNo === undefined) { x.akisNo = no; this.akisSatirlari[k].set(no, x); }
        return;
      }
      case 'whisper':
        x.tum.push(pcm); x.tumBayt += pcm.length;
        while (x.tumBayt > PARCA_SINIRI * 2 && x.tum.length > 1) x.tumBayt -= x.tum.shift()!.length;
        if (x.tumBayt >= WHISPER_KES_BAYT && !x.bitti) { this.whisperKes(x); return; }
        this.whisperPlanla(x);
        return;
      case 'toplu':
        x.parcaPcm.push(pcm); x.parcaBayt += pcm.length;
        if (x.parcaBayt >= PARCA_BAYT) this.topluGonder(x, false);
        return;
      default: return;
    }
  }

  /** Konuşma bitti (VAD): akışta commit, yerelde son geçiş, toplu yolda son parça. */
  konusmaBitti(konusan: Konusan, konusmaNo: number, bitMs: number): void {
    const x = this.satirOf(konusan, konusmaNo);
    this.devam.delete(`${konusan}:${konusmaNo}`);
    if (!x || x.s.kesin || x.atilacak) return;
    x.s.bitMs = Math.max(x.s.bitMs ?? 0, bitMs);
    x.bitti = true;
    x.bittiZaman = this.simdi();
    this.dokun(x);
    switch (x.kip) {
      case 'akis': {
        const n = this.akislar[konusan]?.commit() ?? 0;
        if (!n) { this.kesinlestir(x); this.yayin(); }
        return;
      }
      case 'whisper': this.whisperPlanla(x); return;
      case 'toplu': this.topluGonder(x, true); return;
      default: this.kesinlestir(x); this.yayin();
    }
  }

  /** Eski parça arayüzü (toplu yol; testler ve yedek): VAD parçası gelir gelmez toplu yazıya çevirmeye gider. */
  parca(p: ParcaGirdisi): void {
    // Boş son parça (konuşma kısa duraklamada kesildikten sonra sessizlikle bitti) yalnız satırı kesinleştirir: yazıya çevirmeye gitmez.
    if (!this.dinliyor || !p?.pcm || (!p.pcm.length && !p.son)) return;
    this.basladi(p.konusan, p.konusmaNo, p.basMs);
    const x = this.satirlar.get(`${p.konusan}:${p.konusmaNo}`)!;
    x.kip = 'toplu';
    x.s.bitMs = Math.max(x.s.bitMs ?? 0, p.bitMs);
    if (p.son) x.sonParca = p.parcaNo;
    const pcm = p.pcm.length > PARCA_SINIRI ? p.pcm.subarray(p.pcm.length - PARCA_SINIRI) : p.pcm;
    this.parcaIsle(x, p.parcaNo, pcm);
  }

  private parcaIsle(x: SatirIc, parcaNo: number, pcm: Uint8Array): void {
    const k = x.s.konusan;
    this.kuyruk[k] = this.kuyruk[k].then(() => this.yaziyaCevir(x, parcaNo, pcm)).catch((e) => this.d.gunluk?.(`[toplantı] parça: ${(e as Error).message}`));
  }

  private topluGonder(x: SatirIc, son: boolean): void {
    const pcm = birlestir(x.parcaPcm);
    x.parcaPcm = []; x.parcaBayt = 0;
    const no = x.parcaSayac++;
    if (son) x.sonParca = no;
    if (!pcm.length && !son) return;
    this.parcaIsle(x, no, pcm.length > PARCA_SINIRI ? pcm.subarray(pcm.length - PARCA_SINIRI) : pcm);
  }

  hedefDilDegistir(dil: string): void {
    if (!dil || dil === this.durum.hedefDil) return;
    this.durum.hedefDil = dil;
    // Son satırlar yeni dile yeniden çevrilir; eskiler özgün metinle kalır.
    const kesinler = [...this.satirlar.values()].filter((x) => x.s.kesin && x.s.metin).sort((a, b) => a.s.basMs - b.s.basMs);
    for (const x of kesinler.slice(0, -DIL_YENIDEN_CEVIRI)) { x.s.ceviri = undefined; x.s.ceviriDurum = 'yok'; this.dokun(x); }
    for (const x of kesinler.slice(-DIL_YENIDEN_CEVIRI)) { x.s.ceviri = undefined; x.s.ceviriDurum = 'bekliyor'; this.dokun(x); this.ceviriSirala(x.s.id); }
    this.yayin();
  }

  robotAc(acik: boolean): void { this.durum.robot = acik; this.yayin(); }

  // ── Kip seçimi (P14: her karede yeniden sorulur) ──
  private akisKullanilabilir(): boolean { return Boolean(this.d.stt.akis) && !this.d.bulutsuz() && this.d.stt.akis!.kullanilir(); }

  private kipSec(k: Konusan, akisDustu = false): Kip {
    const yol = this.yaziYolu();
    if (yol === 'yok') return 'yok';
    if (yol === 'whisper') return 'whisper';
    if (!akisDustu && this.akisKullanilabilir()) {
      const dus = this.akisDustu[k];
      const a = this.akislar[k];
      if (!dus || this.simdi() - dus >= (this.d.akisYenidenMs ?? AKIS_YENIDEN_MS)) {
        if (!a || a.kapaliMi) this.akisAc(k);
        if (this.akislar[k] && !this.akislar[k]!.kapaliMi) return 'akis';
      }
    }
    return this.d.stt.hesap ? 'toplu' : 'yok';
  }

  /** Süren satırın yolu her karede denetlenir: Gizli açıldıysa / tercih "Bu bilgisayar" olduysa bulut kipi (akış, toplu) bırakılır — sonraki ses buluta gitmez. */
  private kipDenetle(x: SatirIc): void {
    if (x.kip !== 'akis' && x.kip !== 'toplu') return;
    const yol = this.yaziYolu();
    if (yol === 'hesap' && !(x.kip === 'akis' && !this.akisKullanilabilir())) return;
    // Bulut yolu kapandı (Gizli, yerel tercih, sınır): akış kapanır, satır yerel kipte sürer.
    for (const k of ['karsi', 'siz'] as const) this.akisiKapat(k);
    const yeni = this.kipSec(x.s.konusan, true);
    x.onayli = x.s.metin; // buluttan gelen kısım kalır, yerel metin arkasına eklenir
    x.kip = yeni;
    x.akisNo = undefined;
    if (x.parcaPcm.length && yeni === 'toplu') this.topluGonder(x, false);
    x.parcaPcm = []; x.parcaBayt = 0;
  }

  /** Bir konuşanın akışını kapatır (Gizli, yerel tercih, düştü): bekleyen satırlar elde kalan metinle kesinleşir, açık satır yerel kipte sürer. */
  private akisiKapat(k: Konusan): void {
    const a = this.akislar[k];
    if (!a) return;
    delete this.akislar[k];
    a.kapat();
    for (const [, x] of this.akisSatirlari[k]) {
      if (x.s.kesin || x.atilacak) continue;
      if (x.bitti) { this.kesinlestir(x); } // commit gitmiş, cevap beklenirken kapandı: elde kalan metin
    }
    this.akisSatirlari[k].clear();
    this.yayin();
  }

  // ── Canlı akış ──
  private akisAc(k: Konusan): CanliAkis {
    const f = this.d.stt.akis!;
    const a = f.ac(k, { kismi: (m, no) => this.akisKismi(k, m, no), kesin: (m, no) => this.akisKesin(k, m, no), dustu: (dd) => this.akisDustuOlayi(k, dd) });
    this.akislar[k] = a;
    a.baslat();
    return a;
  }

  /** Satır ilk kez metin aldı: sayaç ve zaman aşımı saati. */
  private metinAldi(x: SatirIc): void {
    x.sonIlerleme = this.simdi();
    if (!x.metinGeldi && x.s.metin) { x.metinGeldi = true; this.gelenMetin++; }
  }

  private gosterMetin(x: SatirIc, kismi: string): string { return [x.onayli, kismi.trim()].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(); }

  /** Kısmi (değişebilir) metin: satırda canlı görünür; dil ve yankı hemen sezilir, uzun cümle için hafif ön çeviri denenir. */
  private kismiMetin(x: SatirIc, metin: string): void {
    if (x.s.kesin || x.atilacak) return;
    const m = this.gosterMetin(x, metin);
    if (!m || m === x.s.metin) return;
    x.s.metin = m;
    this.metinAldi(x);
    if (kelimeSay(m) >= 3) { const dil = dilSez(m); if (dil) x.s.dil = dil; }
    if (x.s.konusan === 'siz') {
      const karsilar = [...this.satirlar.values()].filter((k) => k.s.konusan === 'karsi' && k.s.metin).sort((a, b) => b.s.basMs - a.s.basMs).slice(0, 6).map((k) => k.s);
      const g = yankiMi({ metin: m, basMs: x.s.basMs, bitMs: x.s.bitMs }, karsilar);
      if (g !== x.gizli) { x.gizli = g; this.yayin(); }
    }
    this.dokun(x);
    this.onCeviriDene(x);
    this.yayin();
  }

  private akisKismi(k: Konusan, metin: string, no: number): void {
    const x = this.akisSatirlari[k].get(no);
    if (x) this.kismiMetin(x, metin);
  }

  private akisKesin(k: Konusan, metin: string, no: number): void {
    const x = this.akisSatirlari[k].get(no);
    this.akisSatirlari[k].delete(no);
    if (!x || x.s.kesin || x.atilacak) return;
    this.hesapArdisikHata = 0;
    this.uyariyiTemizle();
    x.s.metin = this.gosterMetin(x, metin);
    this.metinAldi(x);
    this.kesinlestir(x);
    this.yayin();
  }

  /** Akış kalıcı düştü: bekleyen sesler toplu yola (ya da yerel tanıyıcıya) gider, sonraki konuşmalar da orada sürer; bir süre sonra akış yeniden denenir. */
  private akisDustuOlayi(k: Konusan, dd: AkisDusumu): void {
    this.akisDustu[k] = this.simdi();
    delete this.akislar[k];
    this.d.gunluk?.(`[toplantı] canlı akış düştü (${k}): ${dd.neden}`);
    const sinir = dd.neden === 'kredi' || dd.neden === 'tavan' ? TOPLANTI_SINIR_METNI[dd.neden] : null;
    this.akisNedeniIc = dd.neden;
    this.hataKaydet(new Error(`canlı akış düştü: ${dd.neden}`));
    if (sinir) { this.bulutNedeniIc = dd.neden as 'kredi' | 'tavan'; this.bulutuBirakUyari(sinir); }
    else if (this.yaziYolu(false) === 'hesap' && !this.durum.uyari) this.uyar(`Canlı yazı kullanılamadı: ${BULUT_NEDENI_METNI[dd.neden === 'belirtec' ? 'belirtec' : 'baglanti']}; yazı cümle bitince gelecek.`, 'bilgi');
    for (const b of dd.bekleyenler) {
      const x = this.akisSatirlari[k].get(b.no);
      if (!x) continue;
      this.akisSatirlari[k].delete(b.no);
      if (x.s.kesin || x.atilacak) continue;
      x.kip = this.kipSec(k, true);
      x.akisNo = undefined;
      if (b.kesinlesmis) {
        // Satır bitmişti, kesin metin gelmedi: aynı ses yedek yoldan yazıya çevrilir (metin kaybolmaz).
        x.onayli = '';
        if (x.kip === 'toplu') { x.sonParca = 0; this.parcaIsle(x, 0, b.pcm); }
        else if (x.kip === 'whisper') { x.tum = [b.pcm]; x.tumBayt = b.pcm.length; x.bitti = true; this.whisperPlanla(x); }
        else this.kesinlestir(x);
      } else {
        // Satır sürüyor: o ana dek ses yedek yolda birikir, sonraki kareler de oraya gider.
        x.onayli = '';
        if (x.kip === 'toplu') { x.parcaPcm = [b.pcm]; x.parcaBayt = b.pcm.length; if (x.parcaBayt >= PARCA_BAYT) this.topluGonder(x, false); }
        else if (x.kip === 'whisper') { x.tum = [b.pcm]; x.tumBayt = b.pcm.length; this.whisperPlanla(x); }
      }
    }
    this.yayin();
  }

  // ── Yerel tanıyıcı: büyüyen pencere ──
  /**
   * Uzun satır kesilir (yerel pencere en çok ~7 sn kalsın: büyüyen pencerenin maliyeti uzunlukla artar, 12 sn'lik kesintisiz konuşmada gecikme katlanırdı). Kesim, son
   * sürede enerjisi en düşük bloktadır (cümle içi küçük bir duraklama: kelime ortası bölünmesin); duraklama yoksa 6 sn'de. Baştaki kısım kendi satırı olarak
   * kesinleşir (son geçiş), kalan ses yeni satırda sürer (devam satırı; VAD konuşmasının sonraki sesleri ona gider).
   */
  private whisperKes(x: SatirIc): void {
    const k = x.s.konusan;
    // Blok sınırları (bayt) ve enerjileri.
    const sinirlar: number[] = [];
    const enerji: number[] = [];
    let t = 0;
    for (const c of x.tum) { t += c.length; sinirlar.push(t); enerji.push(blokEnerjisi(c)); }
    const enAz = WHISPER_KES_ARALIK[0], enCok = WHISPER_KES_ARALIK[1];
    let en = -1;
    for (let i = 0; i < sinirlar.length - 1; i++) {
      if (sinirlar[i] < enAz || sinirlar[i] > enCok) continue;
      if (en < 0 || enerji[i] <= enerji[en]) en = i;
    }
    if (en < 0) en = Math.max(0, sinirlar.findIndex((b) => b >= WHISPER_KES_SERT) - 1);
    const bas = x.tum.slice(0, en + 1);
    const kalan = x.tum.slice(en + 1);
    if (!bas.length || !kalan.length) { this.whisperPlanla(x); return; }
    const basBayt = sinirlar[en];
    x.tum = bas; x.tumBayt = basBayt;
    x.bitti = true;
    x.s.bitMs = x.s.basMs + Math.round(basBayt / 32);
    const id = `${k}:${x.vadNo}.${++x.devamNo}`;
    const y = this.yeniSatir(k, id, x.s.basMs + Math.round(basBayt / 32));
    y.vadNo = x.vadNo; y.devamNo = x.devamNo; y.kip = 'whisper';
    y.tum = kalan; y.tumBayt = kalan.reduce((n, c) => n + c.length, 0);
    this.devam.set(`${k}:${x.vadNo}`, y);
    this.dokun(x);
    this.whisperPlanla(x);
    this.whisperPlanla(y);
    this.yayin();
  }

  private whisperPlanla(x: SatirIc): void {
    if (x.kip !== 'whisper' || x.wMesgul || x.s.kesin || x.atilacak || !this.d.stt.whisper) return;
    const bayt = x.tumBayt;
    const son = x.bitti;
    if (son) {
      if (!bayt) { this.kesinlestir(x); this.yayin(); return; }
      // Son geçiş: bütün sesi kapsayan bir sonuç zaten varsa o kesindir.
      if (x.wSonBayt === bayt && x.wMetin !== null) { x.s.metin = this.gosterMetin(x, x.wMetin); this.kesinlestir(x); this.yayin(); return; }
    } else {
      if (bayt < WHISPER_ILK_BAYT || bayt - x.wSonBayt < WHISPER_ADIM_BAYT) return;
      if (this.whisperKuyrugu.mesgul) return; // kısmi pencere birikmez: yerel sunucu meşgulse bir sonraki kareyi bekler
      // Yavaş yerel motor (ortalama ≥ WHISPER_YAVAS_MS): büyüyen pencere kuyruğu yalnız şişirir; yalnız cümle bitince tek geçiş çalışır.
      if (this.whisperOrt !== null && this.whisperOrt >= WHISPER_YAVAS_MS) return;
    }
    x.wMesgul = true;
    const k = x.s.konusan;
    const wav = pcmdenWav(sonBayt(x.tum, WHISPER_PENCERE_BAYT), DIKTE_HZ);
    const is = this.whisperKuyrugu.ekle(son ? 0 : 1, async () => {
      const t0 = Date.now();
      const m = await this.d.stt.whisper!.cevir(wav, k);
      this.whisperOrt = gecikmeOrtalamasi(this.whisperOrt, Date.now() - t0);
      return m;
    })
      .then((m) => { this.hesapArdisikHata = 0; this.whisperSorunuIc = null; this.uyariyiTemizle(); this.yavasCipi(); return m; })
      .catch((e) => {
        this.d.gunluk?.(`[toplantı] yazıya çevirme: ${(e as Error).message}`);
        this.hataKaydet(e);
        // Eski sessiz davranış (genel "bir parça" çipi) yerine GERÇEK neden: eksik model, çökme, zaman aşımı… + eylem.
        const sor = whisperSorunu(e);
        this.whisperSorunuIc = sor;
        this.uyar(sor.metin, sor.seviye === 'bilgi' ? 'sorun' : sor.seviye, sor.eylem, sor.eylem === undefined);
        return undefined;
      })
      .then((m) => {
        x.wMesgul = false;
        if (x.s.kesin || x.atilacak) return;
        if (m !== undefined) { x.wMetin = m?.trim() || ''; x.wSonBayt = bayt; }
        if (x.bitti && m === undefined && !x.wMetin && !x.s.metin) {
          // Son geçiş hata verdi ve elde hiç metin yok: satır sessizce silinmez, "yazıya çevrilemedi" olur.
          this.satirHata(x);
        } else if (x.bitti && (m === undefined || bayt === x.tumBayt)) {
          x.s.metin = this.gosterMetin(x, x.wMetin ?? '');
          this.metinAldi(x);
          this.kesinlestir(x);
        } else if (m !== undefined) {
          this.kismiMetin(x, x.wMetin ?? '');
          this.whisperPlanla(x);
        } else if (x.bitti) this.whisperPlanla(x);
        this.yayin();
      });
    this.isTakip(is);
  }

  /** Yerel motor yavaş: tek sakin bilgi çipi (başka çip yoksa). */
  private yavasCipi(): void {
    if (this.whisperOrt === null || this.whisperOrt < WHISPER_YAVAS_MS || this.durum.yol !== 'whisper') return;
    const sor = whisperSorunu(new WhisperHatasi('yavas'));
    if (!this.durum.uyari || this.durum.uyari === sor.metin) this.uyar(sor.metin, 'bilgi');
  }

  // ── Toplu yol (yedek) ──
  private async yaziyaCevir(x: SatirIc, parcaNo: number, pcm: Uint8Array): Promise<void> {
    let metin: string | null = null;
    this.gelenParca++;
    // En az 200 ms ses (daha kısası yazıya çevrilmez: kredi harcamasın).
    if (pcm.length >= BAYT_SN * 0.2 && (this.durum.hal === 'dinliyor' || this.durum.hal === 'ozetleniyor')) metin = await this.stt(pcmdenWav(pcm, DIKTE_HZ), x.s.konusan);
    if (x.atilacak) return;
    x.parcalar.set(parcaNo, metin?.trim() || null);
    const toplu = [...x.parcalar.entries()].sort((a, b) => a[0] - b[0]).map(([, m]) => m).filter(Boolean).join(' ');
    x.s.metin = this.gosterMetin(x, toplu);
    this.metinAldi(x);
    if (kelimeSay(x.s.metin) >= 3) { const dil = dilSez(x.s.metin); if (dil) x.s.dil = dil; }
    this.dokun(x);
    if (x.sonParca !== undefined && x.parcalar.size >= x.sonParca + 1) this.kesinlestir(x);
    this.yayin();
  }

  private async stt(wav: Uint8Array, konusan: Konusan): Promise<string | null> {
    const bulutsuz = this.d.bulutsuz();
    if (bulutsuz !== this.durum.bulutsuz) { this.durum.bulutsuz = bulutsuz; this.durum.yol = this.yaziYolu(bulutsuz); }
    const yol = this.yaziYolu(bulutsuz);
    this.durum.yol = yol;
    try {
      if (yol === 'hesap' && this.d.stt.hesap) {
        try {
          const m = await this.d.stt.hesap.yaziya(wav, konusan);
          this.hesapArdisikHata = 0;
          this.uyariyiTemizle();
          return m;
        } catch (e) {
          // Dikte sınırı (kredi / günlük tavan) ya da sunucuda ses modeli yok: bu toplantıda bulut yolu kapanır. Başka hata üst üste 3 kez gelirse de.
          const sinir = dikteSiniriMi(e) ? TOPLANTI_SINIR_METNI[e.tur] : null;
          this.hataKaydet(e);
          if (sinir || sesModeliYokMu(e) || ++this.hesapArdisikHata >= 3) {
            this.bulutNedeniIc = dikteSiniriMi(e) ? e.tur : sesModeliYokMu(e) ? 'sunucu-ses-yok' : 'yazi-hatasi';
            return await this.bulutuBirak(wav, konusan, sinir, e);
          }
          throw e;
        }
      }
      if (yol === 'whisper') {
        const m = await this.whisperKuyrugu.ekle(0, () => this.d.stt.whisper!.cevir(wav, konusan));
        this.uyariyiTemizle();
        return m;
      }
      // Yol yok: ne hesap kullanılabiliyor ne yerel tanıyıcı kurulu. Tek cümle + indirme düğmesi (sessiz boş dönme yok).
      if (!this.durum.uyari || this.geciciUyari) this.uyar(bulutsuz || !this.bulutDustu ? UYARI.yerelYok : UYARI.bulutDustuYerelYok, 'sorun', 'whisper-indir');
      return null;
    } catch (e) {
      this.d.gunluk?.(`[toplantı] yazıya çevirme: ${(e as Error).message}`);
      this.hataKaydet(e);
      this.uyar(UYARI.parca, 'sorun', undefined, true);
      return null;
    }
  }

  /** Bulut yolu bu toplantıda kapandı: kurulu yerel tanıyıcı varsa parça orada yazılır (P14: yerel her zaman güvenli), yoksa durum çipi "indir" düğmesi taşır. */
  private async bulutuBirak(wav: Uint8Array, konusan: Konusan, sinir: string | null, e: unknown): Promise<string | null> {
    this.d.gunluk?.(`[toplantı] bulutta yazıya çevirme kapandı: ${(e as Error)?.message ?? e}`);
    this.bulutuBirakUyari(sinir);
    if (this.yaziYolu(false) !== 'whisper') return null;
    return await this.whisperKuyrugu.ekle(0, () => this.d.stt.whisper!.cevir(wav, konusan));
  }
  private bulutuBirakUyari(sinir: string | null): void {
    this.bulutDustu = true;
    this.bulutNedeniIc ??= 'yazi-hatasi';
    for (const k of ['karsi', 'siz'] as const) this.akisiKapat(k);
    const yol = this.yaziYolu(false);
    this.durum.yol = yol;
    if (yol !== 'whisper') this.uyar(sinir ?? UYARI.bulutDustuYerelYok, 'sorun', 'whisper-indir');
    else this.uyar(bulutGecisMetni(this.bulutNedeniIc ?? 'yazi-hatasi').replace('Bulut', this.d.stt.bulutAdi ?? 'Bulut'), 'bilgi');
  }

  // ── Kesinleşme ──
  private kesinlestir(x: SatirIc): void {
    if (x.s.kesin) return;
    x.s.kesin = true;
    x.s.metin = x.s.metin.trim();
    x.cevNo++; // kısmi ön çevirilerin sonuçları artık geçersiz
    if (!x.s.metin) { this.satirSil(x); return; }
    if (x.s.konusan === 'siz') {
      x.gizli = false;
      const karsilar = [...this.satirlar.values()].filter((k) => k.s.konusan === 'karsi' && k.s.metin).map((k) => k.s);
      if (yankiMi(x.s, karsilar)) { this.satirSil(x); this.durum.yankiAtilan++; return; }
    }
    x.s.dil = dilSez(x.s.metin) ?? this.sonDil[x.s.konusan] ?? null;
    if (x.s.dil) this.sonDil[x.s.konusan] = x.s.dil;
    this.dokun(x);
    this.ceviriSirala(x.s.id);
    if (x.s.konusan === 'karsi' && this.durum.robot && this.durum.hal === 'dinliyor') this.robotSirala(x.s.id);
  }

  // ── Çeviri (kesin cümle anında, paralel, akışlı) ──
  private yzYolu(): YzYolu { return this.d.bulutsuz() ? 'yerel' : 'serbest'; }

  private ceviriSirala(id: string): void {
    const x = this.satirlar.get(id);
    if (!x) return;
    if (x.s.dil && x.s.dil === this.durum.hedefDil) { x.s.ceviri = x.s.metin; x.s.ceviriDurum = 'ayni'; this.dokun(x); return; }
    x.s.ceviriDurum = 'bekliyor';
    this.dokun(x);
    this.ceviriSirasi.push(() => this.ceviriCalistir(x, 'son'));
    this.ceviriPompa();
  }

  private ceviriPompa(): void {
    const en = this.d.ceviriParalel ?? CEVIRI_PARALEL;
    while (this.ceviriAktif < en && this.ceviriSirasi.length) {
      const is = this.ceviriSirasi.shift()!;
      this.ceviriAktif++;
      this.isTakip(is().catch((e) => this.d.gunluk?.(`[toplantı] çeviri: ${(e as Error).message}`)).finally(() => { this.ceviriAktif--; this.ceviriPompa(); }));
    }
  }

  /** Konuşma sürerken uzun kısmi metin için hafif ön çeviri: yalnız bulut yapay zekâsında, satır başına en çok 2 çağrı, en az 2,5 sn arayla, en çok 2 eşzamanlı. */
  private onCeviriDene(x: SatirIc): void {
    if (this.d.onCeviri === false || this.yzYolu() !== 'serbest' || x.s.kesin || x.atilacak || x.gizli) return;
    const w = kelimeSay(x.s.metin);
    if (w < ON_CEVIRI_EN_AZ_KELIME || x.onCevSay >= ON_CEVIRI_EN_COK || this.onCeviriAktif >= 2) return;
    if (x.onCevSay > 0 && w - x.onCevKelime < 5) return;
    if (x.s.dil && x.s.dil === this.durum.hedefDil) return;
    const simdi = Date.now();
    if (simdi - x.onCevZaman < ON_CEVIRI_ARALIK_MS) return;
    x.onCevSay++; x.onCevKelime = w; x.onCevZaman = simdi;
    this.onCeviriAktif++;
    this.isTakip(this.ceviriCalistir(x, 'on').catch(() => undefined).finally(() => { this.onCeviriAktif--; }));
  }

  private async ceviriCalistir(x: SatirIc, tur: 'on' | 'son'): Promise<void> {
    const hedef = this.durum.hedefDil;
    const metin = x.s.metin;
    if (!metin) return;
    const no = tur === 'son' ? ++x.cevNo : x.cevNo;
    const eski = () => no !== x.cevNo || hedef !== this.durum.hedefDil || !this.satirlar.has(x.s.id) || (tur === 'on' && x.s.kesin);
    const ist = ceviriIstemiTek(metin, hedef, baglamMetni(this.baglamIc, 'ceviri'));
    let akan = '';
    let yanit = '';
    try {
      yanit = await this.d.yz({
        sistem: ist.sistem, kullanici: ist.kullanici, amac: 'toplantı çevirisi', maxToken: Math.min(600, 48 + Math.ceil(metin.length * 0.9)),
        akis: (p) => {
          if (eski()) return;
          akan += p;
          x.s.ceviri = akan.replace(/^["“„]\s*/, '').trimStart();
          x.s.ceviriDurum = tur === 'on' ? 'on' : 'akiyor';
          this.dokun(x);
          this.yayin();
        },
      }, this.yzYolu());
    } catch (e) {
      if (tur === 'son') this.d.gunluk?.(`[toplantı] çeviri: ${(e as Error).message}`);
    }
    if (eski()) return;
    const sonuc = ceviriTemiz(yanit) ?? ceviriTemiz(akan);
    if (tur === 'on') {
      if (sonuc) { x.s.ceviri = sonuc; x.s.ceviriDurum = 'on'; this.dokun(x); this.yayin(); }
      return;
    }
    if (sonuc) {
      x.s.ceviri = sonuc; x.s.ceviriDurum = 'tamam';
      this.ceviriArdisikHata = 0;
      if (this.durum.uyari === UYARI.ceviri) this.uyariyiTemizle();
    } else {
      x.s.ceviri = undefined; x.s.ceviriDurum = 'olmadi';
      if (++this.ceviriArdisikHata >= 1 && (!this.durum.uyari || this.geciciUyari)) this.uyar(UYARI.ceviri, 'sorun', undefined, true);
    }
    this.dokun(x);
    this.yayin();
  }

  /** Düşük öncelik: robot (öneri, soru denetimi) çeviri sürerken bekler (en çok `ms`): çeviri hiçbir zaman robotun arkasında kalmaz. */
  private async ceviriBosBekle(ms = 2500): Promise<void> {
    const son = Date.now() + ms;
    while ((this.ceviriAktif > 0 || this.ceviriSirasi.length > 0) && Date.now() < son && this.dinliyor) await uyku(30);
  }

  // ── Robot ──
  private gecmis(): { konusan: Konusan; metin: string }[] {
    return [...this.satirlar.values()].filter((x) => x.s.kesin && x.s.metin).sort((a, b) => a.s.basMs - b.s.basMs).slice(-12).map((x) => ({ konusan: x.s.konusan, metin: x.s.metin }));
  }

  private robotSirala(id: string): void {
    const x = this.satirlar.get(id);
    if (!x) return;
    const s = soruMu(x.s.metin);
    if (s === 'degil') return;
    this.robotSiradaki = id; // bekleyen en yeni soru
    if (this.robotSuruyor) return;
    this.robotSuruyor = this.robotCalistir().finally(() => { this.robotSuruyor = null; });
  }

  private async robotCalistir(): Promise<void> {
    while (this.robotSiradaki) {
      const id = this.robotSiradaki;
      this.robotSiradaki = null;
      const x = this.satirlar.get(id);
      if (!x || !this.durum.robot || this.durum.hal !== 'dinliyor') continue;
      await this.ceviriBosBekle();
      const yol = this.yzYolu();
      if (soruMu(x.s.metin) === 'belki') {
        const ist = soruDenetimIstemi(this.gecmis().slice(0, -1), x.s.metin);
        try {
          if (!soruDenetimCoz(await this.d.yz({ sistem: ist.sistem, kullanici: ist.kullanici, amac: 'toplantı soru denetimi', maxToken: 8 }, yol))) continue;
        } catch { continue; }
      }
      const oneri: RobotOnerisi = { id: `o${++this.oneriNo}`, satirId: id, soru: x.s.metin, durum: 'hazirlaniyor' };
      this.durum.oneriler = [...this.durum.oneriler, oneri].slice(-20);
      this.yayin();
      const ist = robotIstemi({ soru: x.s.metin, soruDili: x.s.dil, hedefDil: this.durum.hedefDil, gecmis: this.gecmis(), baglam: this.d.baglam?.() ?? '', kullaniciAdi: this.d.kullaniciAdi?.(), toplanti: baglamMetni(this.baglamIc, 'robot', { sorgu: x.s.metin }) });
      try {
        const r = robotCoz(await this.d.yz({ sistem: ist.sistem, kullanici: ist.kullanici, amac: 'toplantı yanıt önerisi', json: true, maxToken: 320 }, yol));
        if (r) Object.assign(oneri, { durum: 'hazir', yanit: r.yanit, ...(r.ceviri ? { ceviri: r.ceviri } : {}) });
        else oneri.durum = 'olmadi';
      } catch (e) { this.d.gunluk?.(`[toplantı] öneri: ${(e as Error).message}`); oneri.durum = 'olmadi'; }
      this.yayin();
    }
  }

  // ── Bitiş ──
  /** Canlı akışta commit'i gitmiş ama kesin metni gelmemiş satır var mı. */
  private akisBekleyenVar(): boolean { return [...this.satirlar.values()].some((x) => x.kip === 'akis' && x.bitti && !x.s.kesin && !x.atilacak); }

  /** Bekleyen yazıya çevirmeler ve çeviriler bitene dek (testler ve durdur). */
  async bosalinca(): Promise<void> {
    for (let i = 0; i < 6; i++) {
      await Promise.all([this.kuyruk.karsi, this.kuyruk.siz]);
      const son = Date.now() + 8000;
      while (this.akisBekleyenVar() && Date.now() < son) await uyku(10);
      while (this.isler.size) await Promise.allSettled([...this.isler]);
      if (this.robotSuruyor) await this.robotSuruyor;
      if (!this.isler.size && !this.robotSuruyor && !this.akisBekleyenVar() && !this.ceviriSirasi.length) break;
    }
  }

  /** Toplantı bitti: bekleyenler biter (üst sınırlı), yarım satırlar elde kalan metinle kesinleşir, özet istenir. */
  async durdur(): Promise<ToplantiDurumu> {
    if (this.durum.hal !== 'dinliyor') return this.anlik();
    this.denetimiDurdur();
    this.durum.hal = 'ozetleniyor';
    this.robotSiradaki = null;
    this.yayin();
    let saat: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([this.bosalinca(), new Promise<void>((c) => { saat = setTimeout(c, this.d.kapanisBeklemeMs ?? 20_000); })]).finally(() => clearTimeout(saat));
    for (const k of ['karsi', 'siz'] as const) { const a = this.akislar[k]; delete this.akislar[k]; a?.kapat(); }
    for (const x of [...this.satirlar.values()]) if (!x.s.kesin) this.kesinlestir(x);
    // Durdurmada kesinleşen son satırların çevirisi de beklenir (üst sınırlı).
    let saat2: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([this.bosalinca(), new Promise<void>((c) => { saat2 = setTimeout(c, Math.min(this.d.kapanisBeklemeMs ?? 20_000, 8000)); })]).finally(() => clearTimeout(saat2));
    this.ceviriSirasi = [];
    const satirlar = this.anlik().satirlar.filter((s) => s.metin);
    if (satirlar.length) {
      const ist = ozetIstemi(satirlar, this.durum.hedefDil, baglamMetni(this.baglamIc, 'ozet'));
      try {
        this.durum.ozet = ozetCoz(await this.d.yz({ sistem: ist.sistem, kullanici: ist.kullanici, amac: 'toplantı özeti', json: true, maxToken: 900 }, this.yzYolu()));
        if (!this.durum.ozet) this.uyar(UYARI.ozet, 'sorun');
      } catch (e) {
        this.d.gunluk?.(`[toplantı] özet: ${(e as Error).message}`);
        this.uyar(UYARI.ozet, 'sorun');
      }
    }
    this.durum.hal = 'bitti';
    this.durum.bitis = this.simdi();
    this.yayin();
    return this.anlik();
  }

  /** Hemen dur (uygulama kapanıyor): bekleyen istekler sonuçlansa da yok sayılır, özet yok. */
  iptal(): ToplantiDurumu {
    this.denetimiDurdur();
    if (this.durum.hal === 'dinliyor' || this.durum.hal === 'ozetleniyor') {
      this.durum.hal = 'durdu';
      this.durum.bitis = this.simdi();
    }
    for (const k of ['karsi', 'siz'] as const) { const a = this.akislar[k]; delete this.akislar[k]; a?.kapat(); }
    this.ceviriSirasi = [];
    this.robotSiradaki = null;
    return this.anlik();
  }
}

/** Parçaların son `en` baytı (çift bayt hizalı). */
function sonBayt(l: readonly Uint8Array[], en: number): Uint8Array {
  const b = birlestir(l);
  return b.length > en ? b.subarray(b.length - en - ((b.length - en) % 2)) : b;
}
