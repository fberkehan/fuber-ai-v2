/**
 * Ses hattının ayar sabitleri (KURGU §5). Politikada karşılığı olanlar (takip süresi, söz kesme kipi)
 * politikadan okunur; buradakiler cihazdan bağımsız, ölçümle seçilmiş değerlerdir.
 */

import { BARGE_IN_MIN_SPEECH_MS } from '@fuber/shared';

export const VOICE_TUNING = {
  /** Silero olasılık eşiği. */
  vadThreshold: 0.5,
  /** Sözün başladığının kabulü; konuşurken söz kesmenin de ölçüsüdür (KURGU §5.1: VAD ≥ 250 ms). */
  minSpeechMs: BARGE_IN_MIN_SPEECH_MS,
  /** Söz bitti algısı için sessizlik (KURGU §5.3: 500–700 ms). */
  endSilenceMs: 600,
  maxSpeechSeconds: 30,
  /**
   * Boştayken biten söz bundan kısaysa Whisper'a gider ve dökümü uyandırma sözüyle başlıyorsa uyanılır.
   * KURGU §5.2 madde 8 "3 sn'den kısa" der; tek solukta söylenen "Jarvis, yarın saat onda KDV beyannamesini
   * hatırlat" 4,2 sn sürdüğü için sınır genişletildi. (Sözün ilk 1,5 sn'sini erkenden yazıya çevirmek denendi:
   * Whisper kesik seste uyandırma sözünü dört denemenin ikisinde atladı.)
   */
  wakeMaxSegmentMs: 10_000,
  /**
   * Kısa söz izleyici (Jarvis konuşurken / düşünürken): asıl VAD'ın söz saymadığı kısa ya da kısık sesler dur-sözcüğü
   * mü diye yazıya çevrilir. Neden: K1'de 7 koşuda 1 kez konuşma sırasında söylenen "Sus." için VAD hiç söz
   * bildirmedi (ne söz kesme oldu ne döküm; kayıt: artifacts/k1.json). Temiz kayıtta aynı ses 12/12 yakalanıyor;
   * kayıp, oynatma sürerken tarayıcının ses işlemesinden (yankı bastırıcı, yük altında çerçeve gecikmesi) geçen
   * kısa hecede oluyor. Eşik düşük, süre kısa tutulur; karar yine dökümle verilir (yalnız dur-sözcüğü keser).
   */
  blipThreshold: 0.35,
  blipMinSpeechMs: 90,
  blipMinSilenceMs: 200,
  blipMaxMs: 900,
  /** Düşünürken/konuşurken araya giren söz bundan uzunsa dur-sözcüğü için yazıya çevrilmez. */
  interjectionMaxMs: 3000,
  /** Uyandıktan sonra söz gelmezse sessizce `idle` (yanlış uyanma). */
  noSpeechTimeoutMs: 6000,
  /**
   * Tur bekçisi: tur bu kadar süre HİÇBİR etkinlik göstermezse (cümle, model metni, araç başlangıcı/bitişi/ara durumu,
   * onay) donmuş sayılır, kesilir ve nedeni söylenir. Araç çalışırken sınır `toolStallMs`'tir; onay beklenirken ve ses
   * çalarken süre işlemez. Eski değer (20 sn, yalnız cümleleri sayıyordu) çok adımlı işi ortasında kesiyordu: bir sınama
   * oturumunda art arda `pc_click` + `screen_look` adımları sürerken iki kez "tur 20000 ms ilerlemedi".
   */
  turnStallMs: 90_000,
  /** Tek bir araç çağrısı hiçbir ara durum bildirmeden en çok bu kadar sürebilir (araçların kendi süre sınırı daha kısadır). */
  toolStallMs: 5 * 60_000,
  /**
   * Sesli ilerleme: iş sürerken Jarvis bu kadar süre sessiz kaldıysa o anki adımı tek kısa cümleyle söyler
   * (`Settings.spokenProgress`). Aynı cümle art arda söylenmez; model kendi cümlesini kurduysa süre baştan başlar.
   */
  progressQuietMs: 9000,
  /** Çalınan ses bittikten sonra bu kadar süre daha "Jarvis konuşuyor" sayılır (sentez ve çıkış gecikmesi payı). */
  audibleMarginMs: 400,
  /** İş sürerken (Jarvis susmuşken) söylenen söz en az bu kadar sözcükse yeni komut sayılır (tek sözcük: gürültü, halüsinasyon). */
  interjectMinWords: 2,
  /** "Yeniden deneyeyim mi?" sorusuna verilen "evet" bu süre içinde geçerlidir. */
  retryOfferMs: 30_000,
  /** Çalma bitişi raporu gelmezse beklenen bitişten bu kadar sonra tur yine de kapatılır. */
  playbackGuardMs: 5000,
  /** Piper'ın cümleler arasına koyduğu sessizlik (sn). */
  sentenceSilence: 0.15,
  /**
   * Açılışta ses konağının (ekran kartı sesi) ilk sonucu en çok bu kadar beklenir (ms); hat ondan önce "hazır" olmaz ki
   * ilk yanıt Piper'la başlayıp ses yarı yolda değişmesin. Ölçüm: konak ≈2 sn'de hazır (yükleme ≈0,9 + ısınma ≈0,9).
   * Süre dolarsa hat onsuz hazır olur; konak sonradan gelirse devreye girer.
   */
  ttsHostGateMs: 20_000,
  /**
   * Ekran kartı sesi, geçici sıkışma yüzünden işlemciye düştükten sonra seçilen cihaza geri döndüğünde: bu kadar KARARLI
   * kalırsa düşüş kilidi açılır (gelecekteki gerçek bir düşüş yine bir kez bildirilebilir). Kısa aralıkta yeniden düşerse
   * (sıkışma sürüyor) kilit açılmaz: kullanıcıya her çırpınmada "işlemciye düşüldü" denmez; düşüşler tanıda görünür.
   */
  ttsRecoveryMs: 2 * 60_000,
  /**
   * Boştayken söz başlayınca yapılan erken ısıtmanın en sık aralığı. Bulut önbelleği 5 dk, yerel model 10 dk
   * yaşadığı için daha sık ısıtmak boşunadır; daha seyrek ısıtmak Whisper yolunda soğuk başlangıç bırakır.
   */
  speculativePrewarmEveryMs: 4 * 60_000,
  /** Kalibrasyon: bir örnek için beklenen en uzun süre ve örnek başına yineleme hakkı. */
  calibrationSampleTimeoutMs: 12_000,
  calibrationRetries: 2,
  /** Kalibrasyon örneği bu aralığın dışındaysa ("hey jarvis" ≈ 0,6–1,5 sn) yinelenir. */
  calibrationMinMs: 350,
  calibrationMaxMs: 4000,
  /** Kalibrasyon örneğinin en düşük düzeyi (0–1 RMS); altı "çok kısık / gürültü". */
  calibrationMinRms: 0.004,
  /**
   * Yankı sınaması: çalma bittikten sonra mikrofonun dinlendiği kuyruk ve sınamanın üst süresi. Kuyruk, sızan sesin
   * çalma bittikten sonra ne kadar sürdüğünü de ölçer (hoparlör tamponu + oda): koruma süresi buna göre ayarlanır.
   */
  echoTailMs: 1200,
  echoTimeoutMs: 20_000,
  /** Mikrofon başka bir yankı engelleme kipiyle yeniden açıldıktan sonra ölçümden önce beklenen süre (süzgeç yerleşsin). */
  aecSettleMs: 1500,
  /**
   * Çalma bittikten sonraki koruma süresi: bu süre dolana dek gelen ses Jarvis'in kendi sesi sayılır.
   * - Yankı sızıyor, kuyruk ölçülmüş: ölçülen kuyruk + pay, alt ve üst sınırla.
   * - Yankı sızıyor, kuyruk ölçülmemiş (eski ölçüm): 800 ms. Fuber AI 1'in aynı iş için kullandığı ve
   *   aylarca sorunsuz çalışan değer ("çalarken kalan süre + 0,8 sn kulak bekler"; v1 `renderer/fuber-sesi.ts`).
   * - Yankı sınaması hiç yapılmamış: 300 ms · yankı yok: 150 ms (yalnız hoparlör tamponu kadar).
   */
  echoGuardLeakMarginMs: 200,
  echoGuardLeakMinMs: 400,
  echoGuardLeakMaxMs: 1200,
  echoGuardLeakDefaultMs: 800,
  echoGuardUnknownMs: 300,
  echoGuardCleanMs: 150,
  /** Çalma bittikten sonra bu süre içinde biten her söz, başladığı an ne olursa olsun, sıkı yankı süzgecinden geçer. */
  echoTextWindowMs: 3000,
  /** Konuşmayı kesen söz, ilk sesten sonra bu süre içinde geldiyse "Jarvis kendini mi kesti" diye bakılır. */
  selfInterruptWindowMs: 2500,
  /**
   * Yankı gidericinin "kullanıcı konuşuyor" oranı (söz bildirildiği andaki son ~260 ms). `nearSure` ve üstü: kullanıcı,
   * Jarvis hemen susar. `nearMaybe`–`nearSure` arası: kararsız; ses kısılır ve `verifyMs` içinde oran `nearSure`ü
   * geçerse susulur, geçmezse ses geri açılır. Altı: Jarvis'in kendi yankısı. Ölçüm (`scripts/voice/aec-eval.mjs`,
   * 10 dk'lık benzetimler): bu eşiklerle kendi kendini kesme 0, kullanıcının sözü 23–28/29 yakalanıyor.
   */
  nearSure: 0.6,
  nearMaybe: 0.25,
  verifyMs: 450,
  /** Doğrulama sırasında çalınan sesin kazancı ve kısma / geri açma süreleri. */
  duckGain: 0.25,
  duckDownMs: 60,
  duckUpMs: 150,
  /** Yankı gidericinin düzey kapısı (güç oranı) ve söz kesme sınamasının ayarlayabileceği sınırlar. */
  echoGate: 4,
  echoGateMin: 2,
  echoGateMax: 16,
  /** Bu süre içinde ikinci kez kendini kesen cihazda söz kesme `wake` kipine iner. */
  selfInterruptRepeatMs: 10 * 60_000,
  /**
   * Yankı gidericinin süzgeci yakınsamadığı (Bluetooth: doğrusal olmayan hoparlör, kayan gecikme) ama Jarvis'in sesinin
   * mikrofona ulaştığı bilinen cihazda "kullanıcı konuşuyor" kararı kaba kapıyla verilir (`coarse`). Bu kanıt daha
   * zayıftır: hiçbir zaman HEMEN susturmaz; oran `nearMaybe`'yi geçince ses kısılır (`duckGain`), kısık seste YENİ bir
   * 260 ms'lik pencerede oran `nearCoarseSure`'ü geçerse susulur (`speech_near`). Kısma, hoparlörden gelen yankıyı
   * düşürür, kullanıcının sesini düşürmez. Kısma süresi Bluetooth gecikmesini (≈400 ms; kısılan ses mikrofona o kadar
   * geç ulaşır) ve yeni pencereyi kapsar. Değerler işçidekilerle aynıdır (`worker/index.ts`).
   */
  nearCoarseSure: 0.35,
  coarseVerifyMs: 1500,
  /**
   * Toplantıda bilgisayar sesinin ("Karşı taraf") bölütlenmesi: söz sonu sessizliği ve en uzun bölüt. Kısa tutulur ki
   * satır, karşı taraf durur durmaz yazılsın (d6 ölçümü: söz sonu → satır, raporda).
   */
  meetingSystemSilenceMs: 300,
  meetingSystemMaxSpeechSeconds: 8,
} as const;

/** Cihazın yankı ölçümünden çalma sonrası koruma süresi. `echo`: son yankı sınaması; hiç yapılmadıysa `null`. */
export function echoGuardFor(echo: { leaked: boolean; tailMs?: number | null } | null): number {
  if (!echo) return VOICE_TUNING.echoGuardUnknownMs;
  if (!echo.leaked) return VOICE_TUNING.echoGuardCleanMs;
  if (typeof echo.tailMs !== 'number') return VOICE_TUNING.echoGuardLeakDefaultMs;
  return Math.min(
    VOICE_TUNING.echoGuardLeakMaxMs,
    Math.max(VOICE_TUNING.echoGuardLeakMinMs, Math.round(echo.tailMs) + VOICE_TUNING.echoGuardLeakMarginMs),
  );
}
