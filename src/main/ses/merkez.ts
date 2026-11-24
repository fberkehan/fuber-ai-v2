// ── Ses merkezi (Görev 21, K9): Fuber'in TEK sesi ve konuşmadan yazıya — Electron'dan bağımsız çekirdek ─────────────────────────────
// main/ses.ts bunu ayarlar, hesap ve pencerelerle kurar; testler (tests/ses-hesap.test.ts, tests/kip-metinleri.test.ts) sahte hesap ve yedek
// sesle doğrudan kurar.
//  - Konuşma: sesSec() (shared/ses-kimligi.ts) konuşma başlarken BİR KEZ çağrılır; oturumun üreticisi o sese bağlanır. Hesabın sesi düşerse
//    oturum "yalnız metin"e geçer (main/ses/konusma.ts) — yedek sese ya da başka sese geçilmez. Hesabın sesinde (0.13 A) kip de konuşma
//    başında bir kez okunur: yanıt sürerken kip değişse süren konuşma eski sesle biter, bir sonraki yeni kiple başlar. Kullanıcının kendi
//    ElevenLabs anahtarı (0.12'den kalan sır) okunmaz.
//  - Sessiz düşüş yok (0.13): sesle sorulan yanıtta ses üretilemezse 'hata' olayı tek satır taşır (`satir`: sesHataMetni); karakterin sesi yerine bu bilgisayarın sesi çalarsa
//    (404 TTS_MODEL_YOK, kredi bitti, onay bekliyor, erişim kapalı) ilk sesten önce 'uyari' gider, oturumda bir kez (sesDusuMetni).
//  - Önizleme ("Dinle"): kaynak 'onizleme'; ses seçilmez, karakterin sesi çalar (kurulumda seçilen kip `o.kip` ile gelir).
//  - Yazıya çevirme (0.13 C): bulut kipinde yalnız Fuber hesabı; Whisper yalnız Gizli ve "Yalnız bu bilgisayar"da; yol yoksa 'yok' (Vosk dikteye dönmez, arayüz
//    tek satır söyler: dikteYokSatiri). Yerel kipte Whisper kurulu değilse ilk elle dikte isteğinde kurulur (saf karar: shared/dikte-yolu.ts).
//  - Canlı dikte (0.13 C): hesap yolunda sıra canlı Scribe → toplu çeviri → tek satır uyarı. Konuşma belirteç başına bölümlere ayrılır: bölüm kendi sesini
//    tutar, canlı oturum düşerse yalnız o ses toplu çevrilir; böylece metin yinelenmez, kısmi metin kaybolmaz, uzun dikte 30 sn sınırına takılmaz. Belirtecin süresi
//    dolunca (120 sn) yeni bölüm açılır, ikinci belirteç alınır. 402 ve günlük tavan tek satır söylenir; toplu çeviri aynı yanıtı alacağı için denenmez. Konuşma sürerken
//    Gizli açılırsa ses o an kesilir ve dikte sessizce biter: kullanıcının kendi kararıdır, uyarı gösterilmez, elde kalan metin durur. Uygulama kapanırken süren dikteler
//    kesilir, süre raporu kısa süre beklenir (rapor gitmezse sunucuda 120 sn'lik rezerv kalır).
import { randomUUID } from 'node:crypto';
import { sesDusuMetni, sesHataMetni, sesSec, ELEVEN, tanimaDustuMetni, type SesKimligi } from '../../shared/ses-kimligi.ts';
import { birlestir, pcmdenWav, wavdanPcm } from '../../shared/pcm.ts';
import { DIKTE_YOK, dikteKarari, type DikteKarari, type DikteSatiri } from '../../shared/dikte-yolu.ts';
import { sesModeliYokMu, dikteSiniriMi, DIKTE_BELIRTEC_SN, DIKTE_KULLANILAMIYOR, DIKTE_SINIR_METNI, type DikteSiniriTuru, type HesapDurumu } from '../../shared/masaustu-hesap.ts';
import type { KipKimligi } from '../../shared/karakterler.ts';
import type { SesMotoru, YaziyaMotoru } from '../../shared/tipler.ts';
import { Konusma, type KonusmaOlayi, type KonusmaUretici, type SesBicimi } from './konusma.ts';
import { ScribeOturumu } from './elevenlabs.ts';

export interface SesAyarlari { hiz: number; dil: string; /** Gizli mod: ses ve yazıya çevirme bu bilgisayardan çıkmaz. */ bulutsuz: boolean; /** Kullanıcının kipi ('is' | 'gelistirici'): dikte satırında Ayarlar yönlendirmesi yalnız Geliştirici'de. */ mod?: string }

export interface YedekSes {
  hazirMi(): boolean;
  pcm(metin: string, hiz: number, sinyal?: AbortSignal): AsyncIterable<Uint8Array>;
}

export interface Whisper {
  hazirMi(): boolean;
  /** Sunucuyu ısıt (soru gelmeden önce; model yüklemesi saniyeler sürebilir). */
  isit(): void;
  /** `dil`: dikte dili (ayardaki 'tr' | 'en'); yanlış dili sezip yanlış metin üretmesin. */
  cevir(wav: Uint8Array, dil?: string): Promise<string | null>;
  /** Kurulum durumu (0.13 T10): kurulu mu, seçili model, bu oturumdaki indirme. Yoksa kurulum yolu yok sayılır (yalnız `hazirMi`). */
  kurulum?(): { kurulu: boolean; indirme?: { yuzde: number; adim: string; hata?: string } };
  /** Bu kurulumda inecek GERÇEK toplam (MB): hangi çalıştırıcı (NVIDIA'da CUDA arşivi) ve hangi parçalar eksik. Satırda söylenir. */
  boyutMB?(): Promise<number>;
  /** Kurulumu başlatır (indirme sürüyorsa yeniden başlamaz). Yalnız yerel kipte, yalnız söz gerçekten istenince çağrılır. */
  kur?(): void;
}

/** 0.10 E3 (K3): Fuber hesabının sesi (main/hesap.ts). Kendi ElevenLabs anahtarı yokken ve Gizli mod kapalıyken: cümle başına
 *  seslendirme (MP3), dikte için canlı Scribe (0.13 C), düşerse konuşma bitince toplu çeviri (kaldırılan barındırılan servis). */
export interface HesapSesi {
  /** Konuşma: hesap aktif + cihaz anahtarı var + Gizli mod kapalı + kendi ElevenLabs anahtarı yok + sunucu ses kimliği verdi + bu oturumda
   *  404 TTS_MODEL_YOK alınmadı. */
  kullanilir(): boolean;
  /** Dikte: aynı koşullar, 404 STT_MODEL_YOK için ayrı. */
  yaziyaKullanilir(): boolean;
  /** Hesabın durumu: kredi bitince (kredi-bitti) hesap yolu kapanır ama sonraki dikte yine kredi satırını söyler. */
  durum?(): HesapDurumu | null;
  /** Sunucunun masaüstü ses kimliği (null: sunucunun varsayılanı). */
  sesId(): string | null;
  /** 0.13 A: şu anki kip; konuşma başında bir kez okunur. */
  kip(): KipKimligi;
  /** Bir cümle → MP3. Ses kimliği gönderilmez: sunucu kipin sesini seçer. */
  seslendir(metin: string, kip: KipKimligi, sinyal: AbortSignal): Promise<Uint8Array>;
  /** Kaydın tamamı → metin (boşsa null). 402 ya da günlük tavanda DikteSiniri fırlar. */
  yaziya(bayt: Uint8Array, mime: string, dil: string): Promise<string | null>;
  /** Canlı dikte belirteci: alınamazsa null (toplu çeviri dener). 402 ya da günlük tavanda DikteSiniri fırlar. `sureSn` yoksa 120 sn. */
  yaziyaBelirteci(amac?: 'toplanti'): Promise<{ token: string; sureSn?: number } | null>;
  /** Canlı oturum bitti: ElevenLabs'e giden sesin süresi; rezervin farkı iade edilir. */
  yaziyaSure(belirtec: string, saniye: number): Promise<void>;
}

export interface SesBagimliliklari {
  ayar: () => SesAyarlari;
  yedek: YedekSes;
  whisper?: Whisper;
  hesap?: HesapSesi;
  gunluk?: (m: string) => void;
  /** Konuşma zamanlamaları (varsayılanlar main/ses/konusma.ts; testler kısaltır). */
  zamanlar?: Partial<Pick<ConstructorParameters<typeof Konusma>[0], 'ilkZorlaMs' | 'ilkParcaMs' | 'duraklamaMs' | 'tekrarMs'>>;
  /** Canlı dikte adresi (varsayılan ElevenLabs; testte sahte sunucu). */
  scribeTaban?: () => string;
  /** Kesin metin bekleme üst sınırı (ms; varsayılan main/ses/elevenlabs.ts; testler kısaltır). */
  dikteBitisMs?: number;
}

export type KonusmaKaynagi = 'yanit' | 'bildirim' | 'onizleme' | 'sohbet';
/** Tek satır yalnız sesle sorulan yanıtta görünür (çentik, sohbet): önizleme kendi satırını söyler, bildirim metni zaten ekrandadır. */
const kaynakSatirSoyler = (k: KonusmaKaynagi): boolean => k === 'yanit' || k === 'sohbet';
export interface Gecikme { ms: number; motor: SesMotoru; kaynak: string; zaman: string }
/** Konuşmadan yazıya sonucu. `dustu`: hangi motor hata verdi (Scribe: anahtar/bağlantı; Whisper: yerel sunucu) — "duyulmadı" değil. */
/** `kullanilamaz` (0.10 E3 düzeltme turu 1): sunucunun dikte modeli yok (404 STT_MODEL_YOK) ve bu bilgisayarda yerel tanıyıcı da yok — söz
 *  sessizce kaybolmasın: arayüz BİR KEZ "Dikte şu an kullanılamıyor." der (main/ses.ts); sonraki dinleme cihazdaki tanıyıcıya gider. */
/** `sinir` (0.13 C): 402 ya da günlük tavan; o ana kadarki metin `metin`de kalır, arayüz tek satır söyler. */
export interface DinlemeSonucu { metin: string | null; dustu?: 'whisper' | 'hesap'; kullanilamaz?: true; sinir?: DikteSiniriTuru }
/** Sonucun kullanıcıya söylenecek tek satırı (yoksa undefined): en özel neden önce. */
export function dinlemeUyarisi(r: DinlemeSonucu, mod: string): string | undefined {
  if (r.sinir) return DIKTE_SINIR_METNI[r.sinir];
  if (r.kullanilamaz) return DIKTE_KULLANILAMIYOR;
  return r.dustu ? tanimaDustuMetni(mod, r.dustu) : undefined;
}
/** Hesabın sesi MP3 olarak 44,1 kHz gelir (sunucu: mp3_44100_128); pencere çalarını bu hızda açar. */
const MP3_HZ = 44100;
/** ElevenLabs gerçek zamanlı STT adresi. Tek kullanımlık belirteç bu adresin sorgusunda gider. */
const SCRIBE_TABANI = 'https://api.elevenlabs.io';
/** Dikte sesi: 16 kHz, 16 bit, tek kanal. */
const DIKTE_HZ = 16_000;
const DIKTE_BAYT_SN = DIKTE_HZ * 2;
/** Yerel tanıyıcıya giden sesin sınırı: 30 sn (≈ 960 kB); aşan baştaki parçalar atılır. */
const YEREL_SES_SINIRI = 960_000;
/** Kapanışta süre raporlarını bekleme üst sınırı (ms; hesap oturumlarıyla aynı). */
const KAPANIS_BEKLEME_MS = 3000;

/** Bir belirtecin ömrü kadar konuşma. Sesini kendi tutar: canlı oturum düşerse yalnız bu ses toplu çevrilir, bölümlerin metni sırayla birleşir. */
interface Bolum {
  pcm: Uint8Array[];
  bayt: number;
  /** Bölümün en son metni (kesin ya da kısmi): oturum koparsa elde kalan budur. */
  metin: string;
  sureSn: number;
  /** Süresi henüz bildirilmemiş belirteç. */
  belirtec?: string;
  oturum?: ScribeOturumu;
  /** Belirteç isteği bitti (oturum açıldı ya da açılmayacak). */
  hazir: Promise<void>;
}
type BolumSonucu = Pick<DinlemeSonucu, 'metin' | 'dustu' | 'kullanilamaz'>;
interface Dinleme {
  motor: YaziyaMotoru;
  sahip: string;
  kismi?: (metin: string) => void;
  /** Sırayla bütün bölümler; sonuncusu sürüyor. */
  bolumler: Bolum[];
  /** Süresi dolmuş bölümlerin sonuçları (kendi başına biter; sırası bölüm sırasıdır). */
  bitenler: Promise<BolumSonucu>[];
  sinir?: DikteSiniriTuru;
  iptal?: true;
}

interface Kayit { konusma: Konusma; sahip: string; kaynak: KonusmaKaynagi }

export class SesMerkezi {
  private readonly konusmalar = new Map<string, Kayit>();
  readonly sonGecikmeler: Gecikme[] = [];
  private readonly d: SesBagimliliklari;

  constructor(d: SesBagimliliklari) { this.d = d; }

  /** Şu an konuşacak ses (null: yalnız yazı). */
  kimlik(): SesKimligi | null {
    const a = this.d.ayar();
    const hesapSesi = !a.bulutsuz && this.d.hesap?.kullanilir() ? { sesId: this.d.hesap.sesId() } : undefined;
    return sesSec({ bulutsuz: a.bulutsuz, yedekKurulu: this.d.yedek.hazirMi(), hesapSesi });
  }

  /** Karakterin sesi yerine ne çalıyor: tek satır, oturumda bir kez (ikinci çağrı null). Hesabın sesi yeniden çalınca sıfırlanır: sonraki düşüş yine söylenir. */
  private dusuSoylendi = false;
  private dusuSatiri(yedekVar: boolean): string | null {
    if (this.dusuSoylendi) return null;
    const m = sesDusuMetni({ bulutsuz: this.d.ayar().bulutsuz, hesapDurumu: this.d.hesap?.durum?.() ?? null, yedekVar });
    if (m) this.dusuSoylendi = true;
    return m;
  }

  /** Ses hiç yok (`baslat` null verdi): yanıtı yalnız yazı kalan soruya söylenecek tek satır. Yalnız sesle sorulan yanıtta: önizleme ve bildirim bu satırı göstermez. */
  sesYokSatiri(kaynak: KonusmaKaynagi): string | null { return kaynakSatirSoyler(kaynak) ? this.dusuSatiri(false) : null; }

  /** Bu kimlik için cümle üreticisi (ses kimliğine ve kipe bağlı; oturum boyunca değişmez). `dustu`: konuşma hesabın sesinden yedek sese döndü (tek satır). */
  private uretici(k: SesKimligi, hiz: number, dil: string, kip: KipKimligi, dustu: () => void): KonusmaUretici | null {
    if (k.hesap) {
      const h = this.d.hesap;
      if (!h) return null;
      const yedek = this.d.yedek;
      const caldi = () => { this.dusuSoylendi = false; };
      // Cümle başına tek istek; yanıt bir cümlenin TAM MP3'ü (konuşma oturumu sırayı, ön almayı ve kesmeyi yönetir). Hız sunucuda yok.
      // Sözleşme notu: 404 TTS_MODEL_YOK (SesModeliYok) ölümcül DEĞİL — bu konuşmada henüz hesabın sesi çalmadıysa konuşma yedek sesle sürer (cümle WAV olarak; pencerenin
      // çözücüsü biçimi içerikten tanır; kullanıcıya tek satır söylenir). Hesabın sesi çaldıktan sonra başka sese geçilmez (tek ses kuralı): hata "ses yok" olarak biter, yazı kalır.
      let hesapCaldi = false, yereleDondu = false;
      return async function* (metin, o) {
        if (!yereleDondu) {
          try { const b = await h.seslendir(metin, kip, o.sinyal); hesapCaldi = true; caldi(); yield b; return; } catch (e) {
            if (!sesModeliYokMu(e) || hesapCaldi || !yedek.hazirMi()) throw e;
            yereleDondu = true;
            dustu();
          }
        }
        // Hız 1 ile üretilir: bu konuşmanın bütün cümlelerine hızı pencere uygular (playbackRate, perde korunur) — çift hız olmaz.
        const parcalar: Uint8Array[] = [];
        for await (const p of yedek.pcm(metin, 1, o.sinyal)) parcalar.push(p);
        yield pcmdenWav(birlestir(parcalar), ELEVEN.hz);
      };
    }
    return (metin, o) => this.d.yedek.pcm(metin, hiz, o.sinyal);
  }

  /**
   * Konuşma başlatır; ses yoksa (hesabın sesi yok, yedek kurulu değil) null — arayüz yalnız yazı gösterir. Ses seçilmez (0.13): hesabın sesinde
   * sunucu kipin sesini seçer. `kip`: konuşmanın kipi — turun başında kilitlenen kip (sohbet olayı `basladi`); verilmezse şu anki kip. Böylece
   * yanıt sürerken kip değişse, araç sonrası yeniden açılan konuşma da turun karakteriyle söyler. `sahip`: olayların gideceği pencere.
   */
  baslat(sahip: string, gonder: (o: KonusmaOlayi) => void, o: { kaynak: KonusmaKaynagi; kip?: KipKimligi }): { id: string; kimlik: SesKimligi; hz: number; bicim: SesBicimi; hiz: number } | null {
    const a = this.d.ayar();
    const k = this.kimlik();
    if (!k) return null;
    const soru = kaynakSatirSoyler(o.kaynak);
    // Tek satır ilk sesle gider: pencere konuşmayı ancak baslat dönünce tanır, ve sesi çıkmadan kesilen konuşma satırın hakkını yemez (araç öncesi yeniden açılan konuşma).
    let dusuBekliyor = soru && !k.hesap;
    const uret = this.uretici(k, a.hiz, a.dil, o.kip ?? this.d.hesap?.kip() ?? 'business', () => { dusuBekliyor = soru; });
    if (!uret) return null;
    const id = randomUUID();
    const kimlik = k;
    const bicim: SesBicimi = k.hesap ? 'mp3' : 'pcm16';
    const hz = k.hesap ? MP3_HZ : ELEVEN.hz;
    const konusma = new Konusma({
      ...this.d.zamanlar,
      id, kimlik, hz, bicim, uret,
      gonder: (olay) => {
        if (olay.tur === 'bitti' || olay.tur === 'hata') this.konusmalar.delete(id);
        if (olay.tur === 'hata') {
          this.d.gunluk?.(`[ses] ${kimlik.motor} sesi üretilemedi; bu konuşma yalnız metin: ${olay.mesaj}`);
          gonder(soru ? { ...olay, ...this.hataSatiri(olay, kimlik) } : olay);
          return;
        }
        if (dusuBekliyor && olay.tur === 'ses') {
          dusuBekliyor = false;
          const mesaj = this.dusuSatiri(true);
          if (mesaj) gonder({ tur: 'uyari', id, mesaj });
        }
        gonder(olay);
      },
      gecikme: (ms) => {
        this.sonGecikmeler.unshift({ ms, motor: kimlik.motor, kaynak: o.kaynak, zaman: new Date().toISOString() });
        this.sonGecikmeler.length = Math.min(this.sonGecikmeler.length, 10);
        this.d.gunluk?.(`[ses] ilk ses ${ms} ms (${kimlik.motor} · ${o.kaynak})`);
      },
    });
    this.konusmalar.set(id, { konusma, sahip, kaynak: o.kaynak });
    // Hesabın sesinde hız sunucuya gitmez (sözleşmede yok): pencere çalarken uygular (playbackRate, perde korunur). Öteki yollarda hız
    // üretimde uygulanır (ElevenLabs voice_settings.speed, yedek sesin length_scale'i) → pencereye 1.
    return { id, kimlik, hz, bicim, hiz: k.hesap ? a.hiz : 1 };
  }

  /** Ses üretilemedi: kullanıcıya tek satır (sesHataMetni). "Ses yok" oturumda bir kez söylenir; konuşma sürerken Gizli ya da "Yalnız bu bilgisayar" seçildiyse hesabın sesinin
   *  düşmesi kullanıcının kendi kararıdır, söylenmez. */
  private hataSatiri(olay: { mesaj: string; yok?: true }, kimlik: SesKimligi): { satir?: string } {
    const a = this.d.ayar();
    if (kimlik.hesap && a.bulutsuz) return {};
    const satir = olay.yok ? this.dusuSatiri(false) : sesHataMetni(olay.mesaj, a.mod ?? 'is');
    return satir ? { satir } : {};
  }

  ekle(id: string, metin: string): void { this.konusmalar.get(id)?.konusma.ekle(String(metin ?? '')); }
  bitir(id: string): void { this.konusmalar.get(id)?.konusma.bitir(); }

  /** Kes: id verilirse o konuşma, verilmezse bu sahibin (pencerenin) bütün konuşmaları. */
  kes(sahip: string, id?: string): number {
    let n = 0;
    for (const [k, v] of this.konusmalar) {
      if ((id && k !== id) || (!id && v.sahip !== sahip)) continue;
      v.konusma.kes();
      this.konusmalar.delete(k);
      n++;
    }
    return n;
  }

  /** Bütün konuşmalar (acil durdurma). */
  hepsiniKes(): number {
    const n = this.konusmalar.size;
    for (const v of this.konusmalar.values()) v.konusma.kes();
    this.konusmalar.clear();
    return n;
  }

  get suren(): number { return this.konusmalar.size; }

  /** Tam önizleme (telefon "Telefonda dinle"; akışsız istemci): metni Fuber'in sesiyle WAV olarak döndürür. Hesabın sesinde (MP3)
   *  cümlelerin MP3'leri art arda (`mime` 'audio/mpeg'; MP3 çerçeveleri birleştirilince tek dosya gibi çalar). */
  async wav(metin: string): Promise<{ wav: Uint8Array; motor: SesMotoru; mime: 'audio/wav' | 'audio/mpeg' } | null> {
    return new Promise((coz, red) => {
      const parcalar: Uint8Array[] = [];
      const b = this.baslat('wav', (o) => {
        if (o.tur === 'ses') parcalar.push(o.pcm);
        else if (o.tur === 'bitti') {
          const motor = b!.kimlik.motor;
          // Hesabın sesi sessizce yedek sese döndüyse (sözleşme notu) her parça bir cümlenin WAV'ıdır: PCM'leri tek WAV'da birleşir.
          const wavlar = b!.bicim === 'mp3' ? parcalar.map((p) => wavdanPcm(p)) : [];
          if (wavlar.length && wavlar.every(Boolean)) coz({ wav: pcmdenWav(birlestir(wavlar.map((x) => x!.pcm)), wavlar[0]!.hz), motor, mime: 'audio/wav' });
          else if (b!.bicim === 'mp3') coz({ wav: birlestir(parcalar), motor, mime: 'audio/mpeg' });
          else coz({ wav: pcmdenWav(birlestir(parcalar), ELEVEN.hz), motor, mime: 'audio/wav' });
        } else if (o.tur === 'hata') red(Object.assign(new Error(o.mesaj), o.yok ? { sesYok: true } : {}));
      }, { kaynak: 'onizleme' });
      if (!b) { coz(null); return; }
      this.ekle(b.id, metin);
      this.bitir(b.id);
    });
  }

  // ── Konuşmadan yazıya ──
  /** "Dikte şu an kullanılamıyor" bu oturumda söylendi (bir kez; hesapla başarılı bir dikte sıfırlar). */
  private dikteYokSoylendi = false;
  private readonly dinlemeler = new Map<string, Dinleme>();
  /** Konuşması bitmiş, sonucu bekleyen dinlemeler (`dinlemeBitir` sürüyor): kapanışta bunların da raporu gider. */
  private readonly bitiyor = new Set<Dinleme>();
  /** Yoldaki süre raporları (kapanış bekler). */
  private readonly raporlar = new Set<Promise<void>>();

  /** Dikte kararı (shared/dikte-yolu.ts): bulut kipinde yalnız Fuber hesabı (K3; canlı Scribe, düşerse toplu çeviri), Gizli ve "Yalnız bu bilgisayar"da kurulu
   *  Whisper; yol yoksa 'yok' ve kullanıcıya söylenecek tek satır. */
  private dikteKarari(o: { boyutMB?: number; yeniden?: boolean; uyandirma?: boolean } = {}): DikteKarari {
    const a = this.d.ayar();
    const w = this.d.whisper;
    const k = w?.kurulum?.();
    return dikteKarari({
      bulutsuz: a.bulutsuz, hesapKullanilir: this.d.hesap?.yaziyaKullanilir() === true, hesapDurumu: this.d.hesap?.durum?.() ?? null, mod: a.mod, yeniden: o.yeniden, uyandirma: o.uyandirma,
      ...(w ? { whisper: { kurulu: w.hazirMi(), kurulabilir: Boolean(w.kur && k), ...(o.boyutMB ? { boyutMB: o.boyutMB } : {}), ...(k?.indirme ? { indirme: k.indirme } : {}) } } : {}),
    });
  }

  yaziyaMotoru(): YaziyaMotoru { return this.dikteKarari().yol; }

  /**
   * Yol yok ('yok') ve kullanıcı gerçekten dikte istedi (elle bastı ya da uyandırdıktan sonra konuştu): söylenecek tek satır. Yerel kipte Whisper kurulu değilse ve kullanıcı
   * ELLE başlattıysa kurulum BURADA başlar ve satır inecek gerçek toplamı söyler (çalıştırıcı + model; NVIDIA'da CUDA dahil); bulut kipinde hiçbir şey indirilmez. `uyandirma`:
   * söz "Hey Fuber"den geldi: yanlış uyanmanın ardından gelen konuşma yüzlerce MB indirmesin, yalnız tek satır söylenir. `yeniden`: kullanıcı düşmüş kurulum için "Yeniden dene"ye bastı.
   */
  async dikteYokSatiri(o: { yeniden?: boolean; uyandirma?: boolean } = {}): Promise<DikteSatiri> {
    // Boyut yalnız söylenecekse sorulur (yerel kip, kurulu değil); karar bundan SONRA, kur ile aynı eşzamanlı adımda verilir (iki çağrı iki kez kurmaz).
    const boyutMB = this.d.ayar().bulutsuz && !this.d.whisper?.hazirMi() ? await this.d.whisper?.boyutMB?.().catch(() => 0) : 0;
    const k = this.dikteKarari({ boyutMB: boyutMB || undefined, yeniden: o.yeniden, uyandirma: o.uyandirma });
    if (k.kur) this.d.whisper?.kur?.();
    return { satir: k.satir ?? DIKTE_YOK, ...(k.yenidenDene ? { yenidenDene: true as const } : {}) };
  }

  /** Dinleme başlat: 'yok' dönerse oturum açılmaz (arayüz `dikteYokSatiri`ni söyler). `kismi`: canlı ara metin (konuşmanın başından bugüne). */
  dinlemeBaslat(sahip: string, kismi?: (metin: string) => void): { id: string; motor: YaziyaMotoru } {
    const motor = this.yaziyaMotoru();
    const id = randomUUID();
    if (motor === 'yok') return { id, motor };
    const k: Dinleme = { motor, sahip, kismi, bolumler: [], bitenler: [] };
    if (motor === 'whisper') this.d.whisper!.isit();
    this.dinlemeler.set(id, k);
    this.bolumAc(k);
    return { id, motor };
  }

  /** Yeni bölüm: hesap yolunda belirteç istenir, gelince canlı oturum açılır ve o ana dek biriken ses akıtılır. Konuşma belirteci beklemez. */
  private bolumAc(k: Dinleme): void {
    const b: Bolum = { pcm: [], bayt: 0, metin: '', sureSn: DIKTE_BELIRTEC_SN, hazir: Promise.resolve() };
    k.bolumler.push(b);
    if (k.motor !== 'hesap' || k.sinir || !this.d.hesap) return;
    b.hazir = this.d.hesap.yaziyaBelirteci().then((r) => {
      if (!r) return;
      b.belirtec = r.token;
      if (r.sureSn) b.sureSn = r.sureSn;
      // Belirteç beklenirken vazgeçildi ya da Gizli açıldı: bağlantı açılmaz; vazgeçişte rezerv 0 sn ile iade edilir.
      if (k.iptal || this.d.ayar().bulutsuz) { this.sureBildir(b); return; }
      const oturum = new ScribeOturumu({
        taban: this.d.scribeTaban?.() ?? SCRIBE_TABANI, belirtec: r.token, dil: this.d.ayar().dil,
        olaylar: { kismi: (m) => { b.metin = m; k.kismi?.(k.bolumler.map((x) => x.metin).filter(Boolean).join(' ')); } },
      });
      b.oturum = oturum;
      for (const p of b.pcm) oturum.ekle(p);
    }).catch((e) => {
      if (dikteSiniriMi(e)) k.sinir = e.tur;
      else this.d.gunluk?.(`[ses] canlı dikte açılamadı: ${(e as Error).message}`);
    });
  }

  /** Canlı oturum bitti: yollanan sesin süresi bir kez bildirilir (rapor gelmezse sunucuda 120 sn'lik rezerv kalır). Gizli açıldıysa ağa çıkılmaz. */
  private sureBildir(b: Bolum): void {
    const belirtec = b.belirtec;
    if (!belirtec) return;
    b.belirtec = undefined;
    if (this.d.ayar().bulutsuz || !this.d.hesap) return;
    const rapor: Promise<void> = this.d.hesap.yaziyaSure(belirtec, b.oturum?.saniye ?? 0).catch(() => undefined).finally(() => { this.raporlar.delete(rapor); });
    this.raporlar.add(rapor);
  }

  /** Canlı oturumu hemen kapatır (vazgeçildi, Gizli açıldı). */
  private oturumuKes(b: Bolum): void {
    b.oturum?.iptal();
    this.sureBildir(b);
    b.oturum = undefined;
  }

  /** 16 kHz PCM16 parçası (konuşma sürerken). Hesap yolunda canlı oturuma akar ve bölümde saklanır; Whisper yolunda bellekte en çok ~30 sn birikir. */
  dinlemeParca(id: string, pcm: Uint8Array): void {
    const k = this.dinlemeler.get(id);
    if (!k || !pcm?.length) return;
    const b = k.bolumler[k.bolumler.length - 1];
    if (k.motor !== 'hesap') {
      b.pcm.push(pcm);
      b.bayt += pcm.length;
      while (b.bayt > YEREL_SES_SINIRI && b.pcm.length > 1) b.bayt -= b.pcm.shift()!.length;
      return;
    }
    // Konuşma sürerken Gizli açıldı: bu parça dahil hiçbir ses buluta gitmez (süren bölümler de kesilir). Bu sesin gideceği yer yok: tutulmaz.
    if (this.d.ayar().bulutsuz) { for (const x of k.bolumler) this.oturumuKes(x); return; }
    // Sınıra gelindi, açık oturum da yok: toplu çeviri denenmeyecek, ses tutulmaz.
    if (k.sinir && !b.oturum) return;
    b.pcm.push(pcm);
    b.bayt += pcm.length;
    b.oturum?.ekle(pcm);
    if (b.bayt < b.sureSn * DIKTE_BAYT_SN) return;
    // Belirtecin süresi doldu: bu bölüm kapanır (kesin metin ya da toplu çeviri), konuşma ikinci belirteçle sürer.
    k.bitenler.push(this.bolumuCoz(k, b));
    this.bolumAc(k);
  }

  /** Bir bölümün metni: canlı oturum → toplu çeviri. Hiç reddedilmez; kesin metin yoksa eldeki metin kalır. */
  private async bolumuCoz(k: Dinleme, b: Bolum): Promise<BolumSonucu> {
    await b.hazir;
    // Gizli açıldı (son parçadan sonra da olabilir): commit bile gitmez, elde kalan metin durur. Bölümde ses yoksa da oturum beklenmez.
    if (this.d.ayar().bulutsuz || !b.bayt) this.oturumuKes(b);
    const o = b.oturum;
    if (o) {
      try {
        const m = (await o.bitir(this.d.dikteBitisMs)).trim();
        this.sureBildir(b);
        b.metin = m;
        b.pcm = [];
        this.dikteYokSoylendi = false;
        return { metin: m || null };
      } catch (e) {
        this.d.gunluk?.(`[ses] canlı dikte düştü, ses toplu çevriliyor: ${(e as Error).message}`);
      }
    }
    // Oturum hiç kurulamadıysa da belirteç sahipsiz kalmaz: rezerv iade edilir.
    this.sureBildir(b);
    const s = await this.bolumuCevir(k, b);
    // Uzun konuşmada ses bellekte birikmez; sonraki bölümün ara metni bu metinle başlar.
    b.metin = s.metin ?? '';
    b.pcm = [];
    return s;
  }

  /** Bölümün sesi tek seferde: hesap yolunda toplu çeviri, yerel yolda Whisper. Canlıdan gelen metin her yolda son çaredir (0.13 C): çeviri düşer ya da boş dönerse o kalır. */
  private async bolumuCevir(k: Dinleme, b: Bolum): Promise<BolumSonucu> {
    const elde = b.metin.trim() || null;
    if (k.iptal) return { metin: null };
    if (!b.pcm.length) return { metin: elde };
    const wav = pcmdenWav(birlestir(b.pcm), DIKTE_HZ);
    return k.motor === 'hesap' ? this.topluCevir(k, wav, elde) : this.whisperCevir(wav, elde);
  }

  /**
   * Bulut kipinin son adımı: Whisper'a düşülmez, sıra canlı → toplu → tek satır (0.13 C). `dustu` (düzeltme 6): yazıya çevirme hata verdi — "boş" değil; arayüz tek satırla
   * söyler. Sınırda toplu çeviri de aynı yanıtı alır, denenmez. Gizli sonradan açıldıysa ses buluta gitmez ve uyarı yoktur: bunu kullanıcı kendisi yaptı.
   */
  private async topluCevir(k: Dinleme, wav: Uint8Array, elde: string | null): Promise<BolumSonucu> {
    if (k.sinir || this.d.ayar().bulutsuz || !this.d.hesap) return { metin: elde };
    try {
      const m = (await this.d.hesap.yaziya(wav, 'audio/wav', this.d.ayar().dil))?.trim() || null;
      this.dikteYokSoylendi = false;
      return { metin: m ?? elde };
    } catch (e) {
      this.d.gunluk?.(`[ses] bulut ses tanıması: ${(e as Error).message}`);
      if (dikteSiniriMi(e)) { k.sinir = e.tur; return { metin: elde }; }
      // İstek yoldayken Gizli açıldı: düşmesi önemsiz.
      if (this.d.ayar().bulutsuz) return { metin: elde };
      if (!sesModeliYokMu(e)) return { metin: elde, dustu: 'hesap' };
      // Sözleşme notu: 404 STT_MODEL_YOK "düştü" değil; söz kaybolmasın: bir kez "kullanılamıyor" (düzeltme turu 1).
      if (this.dikteYokSoylendi) return { metin: elde };
      this.dikteYokSoylendi = true;
      return { metin: elde, kullanilamaz: true };
    }
  }

  /** Yerel yol (Gizli, "Yalnız bu bilgisayar"). */
  private async whisperCevir(wav: Uint8Array, elde: string | null): Promise<BolumSonucu> {
    if (!this.d.whisper) return { metin: elde };
    try {
      return { metin: (await this.d.whisper.cevir(wav, this.d.ayar().dil))?.trim() || elde };
    } catch (e) {
      this.d.gunluk?.(`[ses] Whisper: ${(e as Error).message}`);
      return { metin: elde, dustu: 'whisper' };
    }
  }

  /** Konuşma bitti: bölümlerin metni sırayla (boşsa null). Sınır varsa uyarıyı o belirler: `sinir`, `dustu`dan önce gelir. */
  async dinlemeBitir(id: string): Promise<DinlemeSonucu> {
    const k = this.dinlemeler.get(id);
    if (!k) return { metin: null };
    this.dinlemeler.delete(id);
    this.bitiyor.add(k);
    try {
      const sonuclar = await Promise.all([...k.bitenler, this.bolumuCoz(k, k.bolumler[k.bolumler.length - 1])]);
      const metin = sonuclar.map((s) => s.metin).filter(Boolean).join(' ') || null;
      const dustu = sonuclar.find((s) => s.dustu)?.dustu;
      if (k.sinir) return { metin, sinir: k.sinir };
      return { metin, ...(dustu ? { dustu } : {}), ...(sonuclar.some((s) => s.kullanilamaz) ? { kullanilamaz: true as const } : {}) };
    } finally {
      this.bitiyor.delete(k);
    }
  }

  /** Vazgeçildi: oturumlar kapanır, süreleri bildirilir, ses yazıya çevrilmez. */
  private dinlemeyiKes(k: Dinleme): void {
    k.iptal = true;
    for (const b of k.bolumler) this.oturumuKes(b);
  }

  dinlemeIptal(id: string): void {
    const k = this.dinlemeler.get(id);
    if (!k) return;
    this.dinlemeler.delete(id);
    this.dinlemeyiKes(k);
  }

  /**
   * Uygulama kapanıyor (main.ts before-quit): süren ve sonucu beklenen dikteler kesilir, süre raporları en çok `ms` beklenir. Yoldaki belirteç gelince 0 sn ile bildirilir,
   * o da beklenir. Bekletecek bir şey yoksa null: çıkış hiç gecikmez. Hiç fırlatmaz.
   */
  dinlemeleriKapat(ms = KAPANIS_BEKLEME_MS): Promise<void> | null {
    const hepsi = [...this.dinlemeler.values(), ...this.bitiyor];
    this.dinlemeler.clear();
    for (const k of hepsi) this.dinlemeyiKes(k);
    const hazirlar = hepsi.filter((k) => k.motor === 'hesap').flatMap((k) => k.bolumler.map((b) => b.hazir));
    if (!hazirlar.length && !this.raporlar.size) return null;
    let saat: ReturnType<typeof setTimeout> | undefined;
    const sinir = new Promise<void>((coz) => { saat = setTimeout(coz, ms); });
    const raporlar = Promise.all(hazirlar).then(() => Promise.all(this.raporlar)).then(() => undefined);
    return Promise.race([raporlar, sinir]).finally(() => clearTimeout(saat));
  }

  /** Bir pencere kapandı/yeniden yüklendi: onun konuşmaları ve dinlemeleri kalmasın. */
  sahibiTemizle(sahip: string): void {
    this.kes(sahip);
    for (const [id, k] of this.dinlemeler) if (k.sahip === sahip) this.dinlemeIptal(id);
  }
}
