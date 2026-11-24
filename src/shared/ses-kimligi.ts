// ── Fuber'in sesi (Görev 21, K9; 0.13 spec A, C; saf, birim testli: tests/ses-kimligi.test.ts) ────────────────────────────────────────
// Ses seçimi kullanıcıya bırakılmaz; ses yönetim panelinden atanır. Kullanıcı ses SEÇMEZ ve kendi ElevenLabs
// anahtarını girmez: ses kipin karakterine bağlıdır ve Yönetim'den atanır; istemci sunucuya yalnız `kip` söyler (main/hesap.ts seslendir).
// Tek kural (sesSec):
//   Gizli mod ve "Yalnız bu bilgisayar" kapalıysa ve Fuber hesabının sesi kullanılabilirse → karakterin sesi (barındırılan servis seçer).
//   Yoksa → yedek ses: Piper tr_TR-dfki-medium (bu bilgisayarda, işlemcide, yerel beyinden bağımsız). Gizli ve "Yalnız bu bilgisayar"da
//   tek ses odur.
//   İkisi de yoksa → ses yok, yalnız yazı.
// 0.12'den kalan `api:elevenlabs` sırrı silinmez ama hiçbir yerde okunmaz (kullanıcı verisine dokunulmaz): ne ses, ne yazıya çevirme.
// Seçilen ses bir konuşma BAŞLARKEN kilitlenir (main/ses/konusma.ts); sağlayıcı düşerse metin gösterilir, başka sese geçilmez.
import type { SesMotoru, SesSecenegi } from './tipler.ts';
import type { HesapDurumu } from './masaustu-hesap.ts';
import { IS_YASAK } from './is-dili.ts';
import { YEDEK_SES_NASIL } from './gizlilik-metni.ts';

/** Yedek ses (hesabın sesi yokken ve Gizli modda): Piper Türkçe dfki (orta), bu bilgisayarda. */
export const YEDEK_SES: SesSecenegi = { id: 'tr_TR-dfki-medium', ad: 'Yedek ses', aciklama: YEDEK_SES_NASIL, kaynak: 'fuber' };

/** ElevenLabs ayarları (resmî belge: elevenlabs.io/docs/models, …/api-reference/text-to-speech/stream). */
export const ELEVEN = {
  /** En düşük gecikmeli çok dilli model (~75 ms çıkarım; 32 dil, Türkçe dahil). */
  model: 'eleven_flash_v2_5',
  /** Ham 16 bit PCM, 22,05 kHz, tek kanal: çözücü beklemeden Web Audio'da hemen çalar; yedek sesle (Piper dfki, 22,05 kHz) aynı biçim. */
  bicim: 'pcm_22050',
  hz: 22050,
  /** Konuşmadan yazıya (gerçek zamanlı). */
  sttModel: 'scribe_v2_realtime',
} as const;

export const SES_HIZLARI: readonly [number, string][] = [[0.9, 'Sakin'], [1, 'Normal'], [1.1, 'Hızlı']];
export const hizDuzelt = (h: unknown): number => (typeof h === 'number' && Number.isFinite(h) ? Math.min(1.15, Math.max(0.85, h)) : 1);

/** İş modunda Fuber'in sesi bu bilgisayardaki yedek sesken (anahtar ve hesap sesi yok): ne olduğu ve ne zaman indiği (0.10 G2: "Faz 1" yok). */
export const SES_IS_NOTU = 'Fuber bu bilgisayardaki sesiyle konuşur; ilk kullanımda bir kez indirilir.';
/** Kurulumun Ses adımı: yedek ses inmediyse (internet yok, sunucu hatası, doğrulama) tek, sakin satır — iki modda aynı, kurulum sürer. */
export const YEDEK_SES_INMEDI = 'İndirilemedi; internet gelince yeniden deneyebilirsin. Şimdilik yazıyla konuşuruz.';

/** Konuşmadan yazıya motoru düştü (bağlantı yok, yerel Whisper yanıt vermedi; düzeltme 6): tek satırlık uyarı. İş modunda sağlayıcı dili yok
 *  (shared/is-dili.ts). Cihazdaki Vosk'a dönülmez (0.13): uyarı yanlış metin yerine açıkça söylenir. */
export function tanimaDustuMetni(mod: string, neden: 'whisper' | 'hesap' = 'hesap'): string {
  if (mod !== 'gelistirici') return 'Ses tanıma şu an çalışmıyor; yazarak da sorabilirsin.';
  // 0.10 E3: Fuber hesabının ses tanıması düştü — kullanıcının anahtarı yok, anahtar denmez.
  if (neden === 'hesap') return 'Ses tanıma şu an çalışmıyor — bulut ses tanıma yanıt vermedi.';
  return 'Ses tanıma şu an çalışmıyor — bu bilgisayardaki Whisper yanıt vermedi (Ayarlar → Gün kaydı).';
}

/** Ses önizlemesi / yedek sesin indirilmesi düştü: İş modunda ham hata (adres, HTTP kodu, sağlayıcı iletisi) görünmez (düzeltme 7). */
export function sesHataMetni(ham: string | undefined, mod: string, ne: 'dinle' | 'indir' = 'dinle', siz = false): string {
  if (mod === 'gelistirici' && ham) return ham;
  // Zaten sade olan kendi cümlelerimiz ("Ses yok: yedek ses kurulu değil.") kalır; teknik/sağlayıcı izi taşıyan ileti sade cümleyle değişir.
  if (ham && !IS_YASAK.test(ham) && !/https?:|HTTP|\b\d{3}\b|[{}<>]|Error|fetch|ECONN|ENOTFOUND|SHA/i.test(ham)) return ham;
  if (siz) return ne === 'indir' ? 'Yedek ses indirilemedi; bağlantınızı kontrol edip yeniden deneyin.' : 'Ses şu an çalınamadı; birazdan yeniden deneyin.';
  return ne === 'indir' ? 'Yedek ses indirilemedi; bağlantını kontrol edip yeniden dene.' : 'Ses şu an çalınamadı; birazdan yeniden dene.';
}

/** Karakterin sesi neden çalmıyor (hesabın hâline göre): sesDusuMetni. */
const SES_DUSUS_NEDENI: Readonly<Record<HesapDurumu, string>> = {
  aktif: 'Karakterin sesi şu an kullanılamıyor',
  bekliyor: 'Hesabın onaylanınca karakterin sesini duyacaksın',
  kapali: 'Fuber erişimin kapalı olduğu için karakterin sesi çalmıyor',
  'kredi-bitti': 'Kullanım hakkın dolduğu için karakterin sesi çalmıyor',
};

/** Aynı nedenler resmî hitapta (kurulum; shared/kurulum-metin.ts). */
const SES_DUSUS_NEDENI_SIZ: Readonly<Record<HesapDurumu, string>> = {
  aktif: 'Karakterin sesi şu an kullanılamıyor',
  bekliyor: 'Hesabınız onaylanınca karakterin sesini duyacaksınız',
  kapali: 'Fuber erişiminiz kapalı olduğu için karakterin sesi çalmıyor',
  'kredi-bitti': 'Kullanım hakkınız dolduğu için karakterin sesi çalmıyor',
};

/**
 * Sessiz düşüş yok (0.13 spec): yanıt karakterin sesiyle çalmıyorsa söylenecek tek satır. Gizli ve "Yalnız bu bilgisayar"da yerel ses zaten tek sestir, hesapsız profilde
 * düşülen bir ses yoktur: yerel ses çalıyorsa satır yok (null). `yedekVar`: yerel ses kurulu; değilse yanıt yalnız yazıdır. Oturumda bir kez: main/ses/merkez.ts.
 */
export function sesDusuMetni(g: { bulutsuz: boolean; hesapDurumu: HesapDurumu | null; yedekVar: boolean }, siz = false): string | null {
  const hesap = g.bulutsuz ? null : g.hesapDurumu;
  if (!hesap) return g.yedekVar ? null : 'Bu bilgisayarın sesi kurulu değil; yanıtlar yazı olarak gelir.';
  return `${(siz ? SES_DUSUS_NEDENI_SIZ : SES_DUSUS_NEDENI)[hesap]}; ${g.yedekVar ? 'şimdilik bu bilgisayarın sesiyle konuşuyorum' : 'yanıtlar yazı olarak gelir'}.`;
}

export interface SesSecimGirdisi {
  /** Gizli mod: ses de bu bilgisayardan çıkmaz. */
  bulutsuz: boolean;
  /** Yedek ses (Piper) kurulu. */
  yedekKurulu: boolean;
  /** 0.10 E3 (K3): Fuber hesabının sesi kullanılabilir (hesap aktif, cihaz anahtarı var; main/hesap.ts sesKullanilir) ve sunucunun ses
   *  kimliği (null: sunucunun varsayılanı). Verilmezse hesap yolu yok. */
  hesapSesi?: { sesId: string | null };
}
/** `hesap`: ses Fuber hesabından gelir (cümle başına MP3; sesId boşsa servis seçer) — motor yine 'elevenlabs' (Fuber'in
 *  sesi; 2.1.1 telefonu ve arayüz onu "Fuber’in sesi" diye gösterir). */
export interface SesKimligi { motor: SesMotoru; sesId: string; hesap?: true }

/** Şu an konuşacak TEK ses; null = ses yok (yalnız yazı). Başka hiçbir ses yok (tarayıcı, Windows, Google… kalktı). Sıra: Fuber hesabının
 *  sesi → yedek ses. Gizli modda yalnız yedek ses (sunucuya hiçbir şey gitmez). Kullanıcının kendi ElevenLabs anahtarı yok sayılır. */
export function sesSec(g: SesSecimGirdisi): SesKimligi | null {
  if (g.hesapSesi && !g.bulutsuz) return { motor: 'elevenlabs', sesId: g.hesapSesi.sesId?.trim() || '', hesap: true };
  if (g.yedekKurulu) return { motor: 'yerel', sesId: YEDEK_SES.id };
  return null;
}


/** Göçün dokunduğu ayar alanları (ayarlar.ts derin birleştirmeden SONRA çağırır; nesneyi yerinde değiştirir). */
export interface GocAyari {
  ses: { saglayici?: string; sesler?: Record<string, string>; sesAdi?: string; azureBolge?: string; hiz?: number; surum?: number; bilgisayarSesi?: boolean };
  yerel: { gizliMod?: boolean; hizliSes?: string; etkin?: boolean };
}

/**
 * Ses ayarlarının göçü (bir kez; `ses.surum` = 3). `hamSurum`: dosyadaki (birleştirme öncesi) ses.surum. Değişiklik olduysa true (dosyaya yazılmalı).
 *  · 0.9.0 (surum 2'den eski): eski sağlayıcı seçimi (google, windows, openai, azure, google-cloud, yerel, elevenlabs) silinir — artık tek kural var (sesSec). 0.13: eskiden seçilmiş
 *    ElevenLabs sesi artık taşınmaz (ses kipe bağlı). Ayrı "Hızlı yanıtın sesi" (yerel.hizliSes) silinir; Gizli mod KAPALI başlar (yerel beyin kurulu ve açık kalır ama yanıt
 *    yoluna girmez; K10).
 *  · 0.13: 0.12'nin kurulumdaki "Bu bilgisayarın sesi" kaydı (ses.bilgisayarSesi) silinir: hiçbir ekran kapatamıyordu, kişi yedek seste kilitli kalıyordu. Gizli ve
 *    "Yalnız bu bilgisayar"da yedek ses zaten tek sestir.
 */
export function sesGocu(a: GocAyari, hamSurum: unknown): boolean {
  if (hamSurum === 3) return false;
  if (hamSurum !== 2) {
    delete a.ses.saglayici;
    delete a.ses.sesler;
    delete a.ses.sesAdi;
    delete a.ses.azureBolge;
    a.ses.hiz = hizDuzelt(a.ses.hiz);
    delete a.yerel.hizliSes;
    a.yerel.gizliMod = a.yerel.gizliMod === true;
  }
  delete a.ses.bilgisayarSesi;
  a.ses.surum = 3;
  return true;
}
