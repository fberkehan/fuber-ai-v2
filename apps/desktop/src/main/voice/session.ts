/**
 * Ses oturumu: durum makinesi (KURGU §5.1) ve bir sesli turun baştan sona yürütülmesi.
 * Durumun tek kaynağıdır; her geçiş `voice.state` olayıyla duyurulur.
 *
 * Electron'a ve gerçek sese dokunmaz: mikrofon, işçi, STT ve oynatma `SessionIo` arkasındadır.
 * Böylece geçişler sahte saatle sınanır ve motorlar (ElevenLabs, konuşmadan konuşmaya) sonradan takılır.
 *
 * Değişmez kural: hiçbir hata yolu oturumu asılı bırakmaz. Her yol `idle`'a (ya da mikrofon kapalıysa
 * `mic_off`'a) döner ve kullanıcıya ne olduğunu söyleyen bir `voice.error` olayı bırakır.
 */

import {
  CONVERSATION_IDLE_SECONDS,
  effectiveFollowUpSeconds,
  newId,
  nowIso,
  t,
  type Id,
  type IsoDateTime,
  type ServiceDeps,
  type ToolCallEvent,
  type TurnResult,
  type VoiceActivity,
  type VoiceState,
  type VoiceStateReason,
  type VoiceStatus,
  type VoiceTurnMetrics,
  type WakePath,
} from '@fuber/shared';
import type { EarconKind } from '../../worker/protocol';
import { planAuthorityChange, routeAuthoritySpeech, type AuthorityRequest } from '../core/authority';
import { stripExpressionTags } from '../../worker/speech-tags';
import { toSpokenTurkish } from '../../worker/tr-speech';
import { detectEcho, isOwnSentenceStart } from './echo-filter';
import { failureReason, stepLabel } from './steps';
import { SttError, type SttResult } from './stt/types';
import {
  createWakeMatcher,
  farewellOf,
  foldSpeech,
  isCancelCommand,
  isEndOfConversation,
  isRetryCommand,
  isStartOfConversation,
  isStopCommand,
  stopWordsSpoken,
  soundKey,
  type WakeMatcher,
} from './text-match';
import { VOICE_TUNING } from './tuning';

/** Oturumun dış dünyaya açılan yüzü; `index.ts` gerçek pencere, işçi ve motorlarla doldurur. */
export interface SessionIo {
  /** Mikrofonu açar/kapatır: ses penceresinde iz gerçekten durur, işçide çerçeve işleme kesilir. */
  setCapture(on: boolean): void;
  /** Anahtar sözcük sezici çalışsın mı. */
  setWake(on: boolean): void;
  /** Cümleyi `streamId` akışına ekler (sentez + oynatma). */
  speak(streamId: string, text: string): void;
  /** Akışa başka cümle gelmeyecek. */
  endStream(streamId: string): void;
  /** Çalmayı ve bekleyen sentezi hemen keser. */
  stopPlayback(): void;
  earcon(kind: EarconKind): void;
  /** `language`: yalnız toplantının "Karşı taraf" kaynağı verir (`auto`, `en`…); verilmezse motorun dili. */
  transcribe(pcm: Int16Array, options?: { language?: string; hint?: 'stop' }): Promise<SttResult>;
  /** Yerel ya da bulut TTS şu an kullanılabilir mi; değilse yanıt yalnız yazıyla verilir. */
  canSpeak(): boolean;
  /** Kullanıcı uyandı: seslendirme bağlantısı önceden hazırlansın (bulut ses el sıkışması beklemesin). */
  prewarmSpeech?(): void;
  /** Kısa söz izleyici çalışsın mı (Jarvis konuşurken / düşünürken; `onSpeechBlip` olaylarının kaynağı). */
  setStopWatch?(on: boolean): void;
  /**
   * Bu andan önceki ses teslim edilmesin (Jarvis'in kendi sesi): süren bölüt bittiğinde yalnız sonraki kısmı gelir;
   * o kısımda söz yoksa bölüt hiç gelmez ve işçi `onSpeechCut` ile bildirir. Yoksa (sınama) oturum yalnız zaman
   * kapısına ve metin süzgecine güvenir.
   */
  cutSpeech?(): void;
  /** Jarvis kendi sesini kullanıcı sözü sanıp ikinci kez kendini kesti: söz kesme bu cihazda başarılamıyor (kalıcı kayıt ve bildirim). */
  selfInterrupted?(): void;
  /** Çalınan sesi kıs (`true`) ya da geri aç: söz adayı doğrulanırken Jarvis sesini alçaltır. */
  duck?(on: boolean): void;
}

export type SessionDeps = Pick<ServiceDeps['voice'], 'policy' | 'settings' | 'tools' | 'brain' | 'conversation' | 'bus' | 'log'> & {
  io: SessionIo;
};

interface Sentence {
  text: string;
  /** Sentezlenen sesin süresi; henüz sentezlenmediyse `null`. */
  audioMs: number | null;
  /** Oturumun kendi söylediği ilerleme cümlesi ("Ahmet’i arıyorum."): beynin yanıtına ve döküme girmez. */
  progress?: boolean;
}

interface Stream {
  id: string;
  sentences: Sentence[];
  started: boolean;
  /** Çalmanın başladığı an; henüz başlamadıysa `null`. */
  startedAt: number | null;
  done: boolean;
  interrupted: boolean;
  playedMs: number;
}

interface Turn {
  id: Id;
  /** `turn`: kullanıcının sözüne yanıt · `system`: bildirim, hata cümlesi, deneme. */
  kind: 'turn' | 'system';
  abort: AbortController;
  streams: Stream[];
  /** Yeni cümlelerin eklendiği akış. */
  open: Stream | null;
  /** Yazıyla verilen (seslendirilmeyen) cümleler. */
  shown: string[];
  /** Beyin bitti; yalnız çalmanın bitmesi bekleniyor. */
  finished: boolean;
  interrupted: boolean;
  amended: boolean;
  assistantMessageId: Id | null;
  /** Tur bitince geçilecek durum; yoksa takip penceresi. */
  after: { state: VoiceState; reason: VoiceStateReason } | null;
  resolveSpoken: ((result: { spoken: boolean }) => void) | null;
  /** Onay bekleniyor: soru akışı ve yeniden sorma sayısı. */
  approval: { id: Id; stream: Stream | null; reasks: number } | null;
  // ── ilerleme (tur bekçisi, ada adım satırı, sesli ilerleme) ──
  /** Kullanıcının bu turu açan sözü ("yeniden dene" için); sistem turunda `null`. */
  userText: string | null;
  startedAt: number;
  /** Son etkinlik anı: cümle, model metni, araç başlangıcı/ara durumu/bitişi, onay. */
  lastActivityAt: number;
  /** Çalışan araç çağrıları (çağrı kimliği → ad ve adım satırı), başlama sırasıyla. */
  running: Map<string, { name: string; step: string }>;
  toolsDone: number;
  /** Son başarısız adımın kısa nedeni (iptal edilenler sayılmaz). */
  failed: string | null;
  /** Son cümlenin sıraya konduğu an (sesli ilerleme sessizliği buna göre ölçer). */
  lastSaidAt: number;
  lastProgress: string | null;
  // ── ölçüm ──
  /** Son sesli çerçevenin anı (söz bitti olayı − bitiş sessizliği). */
  speechEndAt: number | null;
  sttMs: number | null;
  transcriptAt: number | null;
  firstSentenceAt: number | null;
  firstAudioAt: number | null;
}

interface Segment {
  id: number;
  /** Bu söz konuşmayı kesti; dökümü dur-sözcüğüyse model turu açılmaz. */
  bargedIn: boolean;
  /** Bu söz sürerken sezicinin duyduğu uyandırma sözü; dökümün başından ayıklanır. */
  heardPhrase: string | null;
  /**
   * Söz, Jarvis konuşurken ya da çalma biter bitmez (koruma süresi içinde) başladı: Jarvis'in kendi sesi olabilir.
   * Böyle bir söz, bittiği andaki duruma bakılarak komut SAYILMAZ; önce yankı olmadığı gösterilmelidir.
   */
  suspect: boolean;
  /** Sözün gerçek başlangıç anı (VAD'ın algı gecikmesi düşülmüş). */
  onsetAt: number;
  /** Sözün bittiği an (son sesli çerçeve), duvar saati; bölüt bitince dolar. */
  endedWallMs?: number;
  /** "Kullanıcı konuşuyor" kanıtı kaba kapıdan (yankı giderici yakınsamadı): susmadan önce ses kısılıp doğrulanır. */
  coarse?: boolean;
  /** Kaba kanıtın ilk geldiği an eksi pay: kullanıcının yankıyla başlamış bölüte katıldığı tahmini an. */
  userAt?: number;
}

/** Kaba kanıtın ilk bildirimi kullanıcının söz başından bu kadar sonra gelir (VAD + 260 ms pencere; ölçülen ~400–700 ms). */
const COARSE_USER_LEAD_MS = 900;
/** Sırada bekleyebilecek en çok ortam bölütü; fazlası (en eskisi) atılır: yazıya çevirme kuyruğu şişmesin. */
const AMBIENT_QUEUE_MAX = 4;
/**
 * Toplantı kipinde yazıya çevrilmeyi bekleyebilecek en çok bölüt (iki kaynak). Toplantıda söz atılmamalıdır; sınır
 * yalnız ekran kartı uzun süre kullanılamazsa belleği korur (60 bölüt ≈ birkaç dakikalık konuşma). Aşılırsa en eskisi
 * atılır ve sayılır.
 */
const MEETING_QUEUE_MAX = 60;

interface MeetingJob {
  source: 'mic' | 'system';
  pcm: Int16Array;
  durationMs: number;
  /** Sözün bittiği an (duvar saati). */
  endedWallMs: number;
  segment: Segment | null;
}

/** Tanı: bir uyandırma yolunun son ölçülen gecikmesi. */
export interface WakeLatency {
  /** Sözün başından uyanmaya. */
  sinceSpeechStartMs: number | null;
  /** Sözün bitişinden (son sesli çerçeve) uyanmaya; sezici söz bitmeden uyandırır (`null`). */
  sinceSpeechEndMs: number | null;
  /** Whisper yolunda yazıya çevirme süresi. */
  sttMs: number | null;
  at: IsoDateTime;
}

/** Tanı: kendi sesini duymaya karşı korumaların sayaçları ve son karar. */
export interface EchoGuardReport {
  /** Çalma bittikten sonra sözün toplanmadığı süre (ms); yankı sınamasının sonucuna göre ayarlanır. */
  guardMs: number;
  /** Çalma bitince atılan (işçide sıfırlanan) söz toplama sayısı. */
  cuts: number;
  /** Jarvis'in kendi sesi olduğu için tur açmayan söz sayısı (koruma süresi içinde biten + metni yankı çıkan). */
  dropped: number;
  /** Başındaki yankı ayıklanıp kalanı komut sayılan söz sayısı. */
  trimmed: number;
  /** Jarvis'in kendi sesiyle kendini kestiği anlaşılan söz kesme sayısı. */
  selfInterrupts: number;
  last: { at: IsoDateTime; kind: 'guard' | 'echo' | 'partial' | 'self_interrupt'; heard: string; coverage: number | null } | null;
}

/** Jarvis'in son seslendirdiği cümlelerden bu kadarı yankı karşılaştırması için tutulur. */
const SPOKEN_KEEP = 40;
const SPOKEN_KEEP_MS = 120_000;

/** Tanı için: son biten (ya da kesilen) sesli turun aşama süreleri. */
export interface TurnStages {
  turnId: Id;
  at: IsoDateTime;
  /** Sözün bittiğinin anlaşılması için beklenen sessizlik (ayar). */
  endSilenceMs: number;
  sttMs: number | null;
  /** Döküm hazır → beynin ilk tam cümlesi. */
  brainFirstSentenceMs: number | null;
  /** İlk cümle → hoparlörde ilk ses. */
  ttsFirstAudioMs: number | null;
  /** Son sesli çerçeve → ilk ses. */
  totalMs: number | null;
  interrupted: boolean;
  /** Turun ilk ses akışı; TTS ilk parça süresi bu akışın ilk cümlesinden okunur. */
  firstStreamId: string | null;
}

type TimerName = 'listen' | 'followup' | 'stall' | 'guard' | 'mute' | 'wakePause' | 'echoGuard' | 'verify' | 'progress' | 'settle';

const hasWords = (text: string): boolean => /[\p{L}\p{N}]/u.test(text);

export class VoiceSession {
  private state: VoiceState = 'idle';
  private ready = false;
  private notReadyReason: string | null = t('voice.notReady.starting');
  private micMuted = false;
  private micMutedUntil: IsoDateTime | null = null;
  private wakePausedUntil: IsoDateTime | null = null;
  private quiet = false;
  private conversation = false;
  private inputDeviceLabel: string | null = null;
  private lastError: string | null = null;
  /** Mikrofon sınaması sürerken söz olayları oturuma işlemez. */
  private suspended = false;
  private wakeOn = false;

  private turn: Turn | null = null;
  /** Kesilen turlar: dökümdeki asistan iletisi, gerçekten söylenen kısma indirilene kadar burada bekler. */
  private readonly detached = new Set<Turn>();
  private readonly speakQueue: Array<{ text: string; record: boolean; resolve(result: { spoken: boolean }): void }> = [];
  private speechActive = false;
  private segment: Segment | null = null;
  /** Bekleyen bir komutun (STT sürerken) geçersiz kaldığını anlamak için. */
  private epoch = 0;
  /** Sıradaki seslerin çalınmasının biteceği tahmini an. */
  private audioUntil = 0;
  private readonly timers = new Map<TimerName, ReturnType<typeof setTimeout>>();
  private wakeMatcher: WakeMatcher;
  /** Kalibrasyonda öğrenilen, Whisper'ın bu kullanıcının söyleyişini yazdığı biçimler. */
  private learnedWake: string[] = [];
  /** Yankı sınaması tutmadı: politika `voice` dese de söz kesme `wake` kipinde uygulanır (yerel güvenlik sınırı). */
  private echoLeaks = false;
  /** `echoLeaks` iken nedeni (durumda ve Ayarlar'da gösterilir). */
  private echoLeakReason: 'echo_test' | 'self_interrupt' | 'barge_test' | null = null;
  /** Söz kesme sınaması sürerken kip geçici olarak `voice` uygulanır (sınama geçerse kalıcı olur). */
  private bargeTrial = false;
  /** Yanıtı kesilen ya da başarısız olan son söz: "yeniden dene" (ada düğmesi, "evet", "yeniden dene") bunu yürütür. */
  private retryable: { text: string; offeredAt: number | null } | null = null;
  private lastActivity: VoiceActivity = { turnId: null, step: null, tool: null, done: 0, startedAt: null, failed: null };
  /** Sesli turun DIŞINDA sorulan onay (yetki yükseltme, yazılı sohbet): yanıt doğrudan bu soruya verilmiş sayılır. */
  private askedOutside: Id | null = null;
  /** Dinlemenin sessizlikten biteceği an; gürültü (boş döküm) bu süreyi baştan başlatmaz. */
  private listenDeadline = 0;
  private lastSpeculativePrewarm = Number.NEGATIVE_INFINITY;
  private stopWatchOn = false;
  /** Bir kısa ses yazıya çevrilirken gelen diğerleri atılır (gürültülü odada yazıya çevirme kuyruğu dolmasın). */
  private blipBusy = false;
  private lastStages: TurnStages | null = null;
  // ── kendi sesini duymaya karşı ──
  /** Çalmanın hoparlörde en son bittiği an (ses penceresinin raporu; çıkış gecikmesi dahil). */
  private playbackEndedAt = Number.NEGATIVE_INFINITY;
  /** Çalma bittikten sonra gelen sesin hâlâ Jarvis'in sesi sayıldığı süre (hoparlör tamponu + oda). */
  private echoGuardMs: number = VOICE_TUNING.echoGuardUnknownMs;
  /** Son seslendirilen cümleler (yankı karşılaştırması). */
  private readonly spoken: Array<{ text: string; at: number }> = [];
  /** En son kesilen turun cümleleri: konuşmayı kesen söz bu cümlelerin kendi başıysa Jarvis kendini kesmiştir. */
  private lastInterrupted: { sentences: string[]; firstAudioAt: number | null; at: number } | null = null;
  private readonly echo = { cuts: 0, dropped: 0, trimmed: 0, selfInterrupts: 0, last: null as EchoGuardReport['last'] };
  /** Jarvis kendini kesti ve yarım kalan yanıt yeniden söylenecek: dinleme penceresi beklenmeden takibe geçilir. */
  private resumeAfterSelfInterrupt = false;
  /** Doğrulanmakta olan söz adayı (ses kısılmış; kullanıcı mı yankı mı bekleniyor). */
  private verifying: number | null = null;
  /** Cihazda ham yankı sızıntısı biliniyor: yankı giderici henüz öğrenmemişken gelen aday söz kesmez. */
  private echoSuspected = false;
  /** Yankı giderici gecikmeyi öğrendi mi (`setCancellerTrained`). */
  private cancellerTrained = false;
  /** Giderici Jarvis'in sesini mikrofonda görüyor mu (`setCancellerCoupled`). */
  private cancellerCoupled = false;
  /** Yankı sınamasında giderici Jarvis'in sesini hiç göremedi (`setEchoLeaks` › `blind`). */
  private echoBlind = false;
  /** Sızan cihazda doğal söz kesme denemesi açık mı (`setCoarseBarge`; varsayılan kapalı). */
  private coarseBarge = false;
  /** Son kendini kesmelerin anları (ikincisi söz kesmeyi `wake`e indirir). */
  private selfInterruptAt = Number.NEGATIVE_INFINITY;
  /** Söz kesme sınaması sürüyor: konuşmayı kesen söz tur açmaz, sınamaya bildirilir. */
  private bargeTestHook: ((info: { self: boolean; text: string }) => void) | null = null;
  private readonly wakeLatency: Record<WakePath, WakeLatency | null> = { kws: null, whisper: null };
  // ── ortam kipi ──
  private ambient = false;
  /** Uyandırma için yazıya çevrilmeyen (uzun) ortam bölütleri: sesli tur yokken sırayla çevrilir. */
  private readonly ambientQueue: Array<{ pcm: Int16Array; segment: Segment; durationMs: number }> = [];
  private ambientBusy = false;
  // ── toplantı kipi ──
  private meeting = false;
  private meetingSystem: 'off' | 'starting' | 'on' | 'error' = 'off';
  private meetingSystemError: string | null = null;
  private meetingLanguage = 'auto';
  private readonly meetingQueue: MeetingJob[] = [];
  private meetingBusy = false;
  /** Toplantıda sıra taştığı için yazıya çevrilmeden atılan bölüt sayısı (tanı). */
  private meetingDropped = 0;
  /** Kipi açanın verdiği bölütler: kip kapanıp yeniden açılınca eski kipin bölütleri yayınlanmaz. */
  private meetingEpoch = 0;

  constructor(private readonly deps: SessionDeps) {
    this.wakeMatcher = this.buildMatcher();
  }

  // ───────────────────────────── durum ─────────────────────────────

  status(): VoiceStatus {
    const voice = this.deps.policy.get().voice;
    return {
      state: this.state,
      ready: this.ready,
      notReadyReason: this.ready ? null : this.notReadyReason,
      engine: voice.engine,
      micMuted: this.micMuted,
      micMutedUntil: this.micMutedUntil,
      wakePausedUntil: this.wakePausedUntil,
      quiet: this.quiet,
      conversation: this.conversation,
      bargeIn: this.bargeIn(),
      inputDeviceLabel: this.inputDeviceLabel,
      lastError: this.lastError,
      bargeInBlockedBy: voice.bargeIn === 'voice' && this.bargeBlocked() ? (this.echoLeakReason ?? 'self_interrupt') : null,
      canRetry: this.retryable !== null,
      ambient: this.ambient,
      meeting: {
        on: this.meeting,
        system: this.meetingSystem,
        systemError: this.meetingSystemError,
        queued: this.meetingQueue.length + (this.meetingBusy ? 1 : 0),
      },
    };
  }

  /** Sınama ve tanı için: süren tur var mı. */
  busy(): boolean {
    return this.turn !== null;
  }

  private emitStatus(): void {
    this.deps.bus.emit('voice.status', this.status());
  }

  private buildMatcher(): WakeMatcher {
    const persona = this.deps.policy.get().persona;
    return createWakeMatcher(persona.wakePhrases, persona.name, this.learnedWake);
  }

  /**
   * Söz kesmeyi `wake`e indiren bir kayıt var mı (sınama süresince geçici olarak yok sayılır). Yankı sınamasının
   * "sızıyor" sonucu yalnız giderici o ölçümde Jarvis'in sesini HİÇ göremediyse (ilinti yok, öğrenemedi: kör) ve şu an
   * da göremiyorsa indirir; göremeyen giderici kullanıcıyı yankıdan ayıramaz.
   */
  private bargeBlocked(): boolean {
    if (!this.echoLeaks || this.bargeTrial) return false;
    if (this.echoLeakReason !== 'echo_test') return true;
    // Deneme bayrağı kapalıyken (varsayılan) eski davranış: "sızıyor" → `wake`.
    if (!this.coarseBarge) return true;
    return this.echoBlind && !this.cancellerCoupled;
  }

  /** d6 deneme bayrağı (`voice-device.json` › `coarseBarge`): sızan cihazda kaba kanıtla doğal söz kesme. */
  setCoarseBarge(on: boolean): void {
    if (this.coarseBarge === on) return;
    this.coarseBarge = on;
    this.syncWake();
    this.emitStatus();
  }

  /**
   * Yürürlükteki söz kesme kipi: politika + bu cihazın kaydı. d6: yankı sınamasının "sızıyor" sonucu (`echo_test`)
   * artık `wake`e İNDİRMEZ. Ölçülen bir Bluetooth hoparlörde giderici hiç yakınsamadığı için sınama her seferinde
   * "sızıyor" dedi ve konuşarak kesme kalıcı olarak kapandı ("araya girmeme müsaade etmiyor"); kapıyı açmak için
   * söz kesme sınamasını kendisinin başlatması gerekiyordu. Sızan cihazda karar kaba kapıyla, ses kısılıp doğrulanarak
   * verilir (`onSpeechStart`). `wake`e yalnız GÖZLENEN kendini kesme (`self_interrupt`) ve umutsuz söz kesme sınaması
   * (`barge_test`) indirir.
   */
  private bargeIn(): 'voice' | 'wake' | 'off' {
    const policy = this.deps.policy.get().voice.bargeIn;
    return policy === 'voice' && this.bargeBlocked() ? 'wake' : policy;
  }

  /** Jarvis'in sesi `at` anında hoparlörde miydi (tahmini: sıradaki sesin bitişi + pay). Ses raporu hiç gelmediyse "evet". */
  private audible(at: number = performance.now()): boolean {
    if (this.state !== 'speaking') return false;
    return this.audioUntil === 0 || at < this.audioUntil + VOICE_TUNING.audibleMarginMs;
  }

  /** Süren turun canlı adımı (ada "ne yapıyor" satırı). */
  activity(): VoiceActivity {
    return this.lastActivity;
  }

  private emitActivity(turn: Turn | null): void {
    const current = turn && turn.kind === 'turn' && this.turn === turn ? turn : null;
    const last = current ? [...current.running.values()].at(-1) : undefined;
    const next: VoiceActivity = current
      ? {
          turnId: current.id,
          step: current.approval ? t('turn.step.approval') : (last?.step ?? (current.finished ? null : t('turn.step.thinking'))),
          tool: last?.name ?? null,
          done: current.toolsDone,
          startedAt: new Date(Date.now() - (performance.now() - current.startedAt)).toISOString() as IsoDateTime,
          failed: current.failed,
        }
      : { turnId: null, step: null, tool: null, done: 0, startedAt: null, failed: turn?.failed ?? null };
    const prev = this.lastActivity;
    if (prev.turnId === next.turnId && prev.step === next.step && prev.done === next.done && prev.failed === next.failed) return;
    this.lastActivity = next;
    this.deps.bus.emit('voice.activity', next);
  }

  /** Son turun aşama süreleri (tanı). */
  stages(): TurnStages | null {
    return this.lastStages;
  }

  /** Kalibrasyonun öğrendiği yazımlar: Whisper yolundaki eşleştiriciye eklenir. */
  setLearnedWake(spellings: string[]): void {
    this.learnedWake = [...spellings];
    this.wakeMatcher = this.buildMatcher();
  }

  /**
   * Yankı sınamasının sonucu. `reason`: neden (durumda gösterilir). `blind`: ölçümde giderici Jarvis'in sesini hiç
   * göremedi (yalnız `echo_test` için anlamlıdır; bkz. `bargeBlocked`).
   */
  setEchoLeaks(leaks: boolean, reason: 'echo_test' | 'self_interrupt' | 'barge_test' | null = null, blind = false): void {
    const nextReason = leaks ? reason : null;
    const nextBlind = leaks && blind;
    if (this.echoLeaks === leaks && this.echoLeakReason === nextReason && this.echoBlind === nextBlind) return;
    this.echoLeaks = leaks;
    this.echoLeakReason = nextReason;
    this.echoBlind = nextBlind;
    this.syncWake();
    this.emitStatus();
  }

  /** Giderici şu an Jarvis'in sesini mikrofonda görüyor mu (zarf ilintisi; işçinin `echo` bildirimi). */
  setCancellerCoupled(coupled: boolean): void {
    if (this.cancellerCoupled === coupled) return;
    const before = this.bargeIn();
    this.cancellerCoupled = coupled;
    if (this.bargeIn() !== before) {
      this.syncWake();
      this.emitStatus();
    }
  }

  /**
   * Söz kesme sınaması için geçici `voice` kipi: cihaz `wake`e inmişken de sınama gerçek söz kesmeyi dener; yoksa
   * `wake`e inen cihaz sınamayı hiç geçemez ve kip bir daha açılamazdı (ölçülen bir cihazda 1/3).
   */
  setBargeTrial(on: boolean): void {
    if (this.bargeTrial === on) return;
    this.bargeTrial = on;
    this.syncWake();
    this.emitStatus();
  }

  /** Cihazda ham yankı sızıntısı ölçüldü mü (yankı giderici öğrenene dek adaylar söz kesmez). */
  setEchoSuspected(on: boolean): void {
    this.echoSuspected = on;
  }

  /**
   * Yankı giderici bu cihazın gecikmesini öğrendi mi (işçinin `echo` bildirimi). Öğrenmemiş gidericinin "yankı
   * beklenmiyor" (`near: null`) kanısı sızdığı bilinen cihazda GÜVENİLMEZDİR: gecikmeyi bilmediği için Jarvis'in
   * yankısının ne zaman geleceğini de bilmez (Bluetooth'ta yankı, referans sustuktan yüzlerce ms sonra gelir).
   * Ölçülen bir cihazda giderici ilinti bulamadı, `null` dedi ve Jarvis kendi sesiyle sustu.
   */
  setCancellerTrained(trained: boolean): void {
    this.cancellerTrained = trained;
  }

  /** Söz kesme sınaması: verilirse konuşmayı kesen söz tur açmaz; kullanıcı mı Jarvis'in kendi sesi mi diye bildirilir. */
  setBargeTest(hook: ((info: { self: boolean; text: string }) => void) | null): void {
    this.bargeTestHook = hook;
  }

  /** Çalma bittikten sonraki koruma süresi (cihazın yankı ölçümünden hesaplanır; `echoGuardFor`). */
  setEchoGuardMs(ms: number): void {
    this.echoGuardMs = Math.max(0, Math.round(ms));
  }

  /** Ortam kipi: boştayken duyulan söz tur açmadan `voice.ambient` olarak yayınlanır. */
  setAmbient(on: boolean): void {
    if (this.ambient === on) return;
    this.ambient = on;
    if (!on) this.ambientQueue.length = 0;
    this.emitStatus();
  }

  /** Ortam olayı şu an çıkabilir mi: kip açık, dinleme açık (mikrofon, duraklatma, acil durdurma), politika izni ve rıza var. */
  private ambientOn(): boolean {
    if (!this.ambient || !this.wakeAllowed()) return false;
    return this.deps.policy.get().ambient.allowed && Boolean(this.deps.settings.get().ambientConsentAt);
  }

  private emitAmbient(text: string, segment: Segment, durationMs: number, result: SttResult): void {
    const ended = segment.endedWallMs ?? Date.now();
    this.deps.bus.emit('voice.ambient', {
      id: newId(),
      text,
      startedAt: new Date(ended - durationMs).toISOString() as IsoDateTime,
      endedAt: new Date(ended).toISOString() as IsoDateTime,
      durationMs,
      lang: this.deps.policy.get().persona.language,
      languageConfidence: result.languageConfidence,
      source: 'mic',
    });
  }

  /**
   * Sıradaki ortam bölütünü yazıya çevirir. Sesli tur her zaman önceliklidir: tur sürerken, kullanıcı konuşurken ya da
   * komut beklenirken iş başlatılmaz; durum boşa dönünce ya da söz bitince yeniden denenir.
   */
  private pumpAmbient(): void {
    if (this.ambientBusy || this.ambientQueue.length === 0) return;
    if (this.turn || this.speechActive || this.state === 'thinking' || this.state === 'speaking' || this.state === 'listening') return;
    const job = this.ambientQueue.shift();
    if (!job) return;
    this.ambientBusy = true;
    void this.deps.io
      .transcribe(job.pcm)
      .then((result) => {
        if (!this.ambient || !hasWords(result.text)) return;
        const own = this.ownVoice(result.text, job.segment);
        if (own !== null) this.emitAmbient(own, job.segment, job.durationMs, result);
      })
      .catch(() => {
        // Yazıya çevrilemedi: ortam bölütü atılır.
      })
      .finally(() => {
        this.ambientBusy = false;
        this.pumpAmbient();
      });
  }

  // ───────────────────────────── toplantı kipi ─────────────────────────────

  /**
   * Toplantı kipi. Açıkken: uyandırma sözü kapalı (yalnız kısayol/ada), Jarvis sesli konuşmaz (yanıt ve bildirim yazıyla),
   * takip penceresi açılmaz (toplantıdaki söz komut sanılmasın), boştayken mikrofonun her sözü ve bilgisayar sesinin
   * bölütleri yazıya çevrilip `voice.meeting` olarak yayınlanır. Ortam kipi bu sürede bölüt almaz (çift kayıt olmasın).
   */
  setMeeting(on: boolean, options: { systemLanguage?: string } = {}): void {
    if (options.systemLanguage) this.meetingLanguage = options.systemLanguage;
    if (this.meeting === on) return;
    this.meeting = on;
    this.meetingEpoch++;
    if (on) {
      this.meetingDropped = 0;
      // Süren sohbet kipi ve takip penceresi biter: toplantıdaki söz Jarvis'e söylenmiş sayılmasın.
      if (this.conversation) {
        this.conversation = false;
      }
      if (this.state === 'followup' || (this.state === 'listening' && !this.turn)) this.setState('idle', 'api');
      if (this.speakQueue.length > 0) for (const item of this.speakQueue.splice(0)) item.resolve({ spoken: false });
    } else {
      this.meetingQueue.length = 0;
      this.meetingSystem = 'off';
      this.meetingSystemError = null;
    }
    this.syncWake();
    this.emitStatus();
  }

  /** Bilgisayar sesi kaynağının durumu (ses penceresinin raporu; `index.ts` bildirir). */
  setMeetingSystem(state: 'off' | 'starting' | 'on' | 'error', error: string | null = null): void {
    if (this.meetingSystem === state && this.meetingSystemError === error) return;
    this.meetingSystem = state;
    this.meetingSystemError = state === 'error' ? error : null;
    this.emitStatus();
  }

  /** Toplantıda sıra taşıp atılan bölüt sayısı (tanı). */
  meetingDrops(): number {
    return this.meetingDropped;
  }

  /** Bilgisayar sesinde bir söz bölütü bitti (işçinin ikinci bölütleyicisi). */
  onSystemSpeech(pcm: Int16Array, durationMs: number): void {
    if (!this.meeting || !this.ready || this.gate() !== null) return;
    this.enqueueMeeting({ source: 'system', pcm, durationMs, endedWallMs: Date.now() - VOICE_TUNING.endSilenceMs, segment: null });
  }

  private enqueueMeeting(job: MeetingJob): void {
    this.meetingQueue.push(job);
    if (this.meetingQueue.length > MEETING_QUEUE_MAX) {
      this.meetingQueue.shift();
      this.meetingDropped++;
      this.deps.log.warn('toplantı: yazıya çevirme sırası taştı; en eski bölüt atıldı');
    }
    this.pumpMeeting();
  }

  /**
   * Toplantı bölütlerini sırayla yazıya çevirir. Öncelik kuralı: Jarvis'in kendi sesli turu (kısayolla açılan dinleme,
   * düşünme) sürerken ekran kartına toplantı işi verilmez; tur bitince sıra kaldığı yerden sürer. Aynı anda tek istek.
   */
  private pumpMeeting(): void {
    if (this.meetingBusy || this.meetingQueue.length === 0 || !this.meeting) return;
    if (this.turn || this.state === 'listening' || this.state === 'thinking' || this.state === 'speaking') return;
    // Karşı tarafın sözü önce: yanıt önerisi ona bağlıdır ve "Siz" satırı zaten yankı denetimi için bekletilir.
    const systemAt = this.meetingQueue.findIndex((item) => item.source === 'system');
    const [job] = this.meetingQueue.splice(systemAt >= 0 ? systemAt : 0, 1);
    if (!job) return;
    this.meetingBusy = true;
    const epoch = this.meetingEpoch;
    const language = job.source === 'system' ? this.meetingLanguage : undefined;
    const ownLanguage = this.deps.policy.get().persona.language;
    void this.deps.io
      .transcribe(job.pcm, language ? { language } : undefined)
      .then(async (first) => {
        // Mikrofon kullanıcının dilinde yazıya çevrilir; motor sesin başka dilde olduğunu sezerse (kulaklıksız toplantıda
        // hoparlörden kaçan karşı taraf, ya da kullanıcı o dilde konuştu) o dilde yeniden çevrilir. Yoksa Whisper İngilizce
        // sözü Türkçeye ÇEVİRİR ve yankı süzgeci (sözcük karşılaştırması) aynı sözü tanıyamaz (sınamada ölçüldü).
        const detected = first.detectedLanguage;
        if (job.source !== 'mic' || !detected || detected === ownLanguage || !/^[a-z]{2}$/.test(detected)) return { result: first, lang: language };
        const second = await this.deps.io.transcribe(job.pcm, { language: detected }).catch(() => null);
        return second && hasWords(second.text) ? { result: second, lang: detected } : { result: first, lang: language };
      })
      .then(({ result, lang: usedLanguage }) => {
        if (!this.meeting || epoch !== this.meetingEpoch || !hasWords(result.text)) return;
        // Jarvis toplantıda konuşmaz; yine de kendi sesi (önceden kalan kuyruk) mikrofondan yazılmasın.
        const text = job.segment ? this.ownVoice(result.text, job.segment) : result.text.trim();
        if (text === null || !hasWords(text)) return;
        this.deps.bus.emit('voice.meeting', {
          id: newId(),
          text,
          source: job.source,
          startedAt: new Date(job.endedWallMs - job.durationMs).toISOString() as IsoDateTime,
          endedAt: new Date(job.endedWallMs).toISOString() as IsoDateTime,
          durationMs: job.durationMs,
          lang: usedLanguage ?? ownLanguage,
          detectedLang: result.detectedLanguage ?? null,
          languageConfidence: result.languageConfidence,
        });
      })
      .catch((error: unknown) => {
        this.deps.log.warn('toplantı bölütü yazıya çevrilemedi', error);
      })
      .finally(() => {
        this.meetingBusy = false;
        this.pumpMeeting();
      });
  }

  /** İki uyandırma yolunun son ölçülen gecikmesi (tanı). */
  wakeLatencies(): Record<WakePath, WakeLatency | null> {
    return { ...this.wakeLatency };
  }

  /** Kendi sesini duymaya karşı korumaların durumu (tanı). */
  echoReport(): EchoGuardReport {
    return { guardMs: this.echoGuardMs, ...this.echo };
  }

  private noteEcho(kind: NonNullable<EchoGuardReport['last']>['kind'], heard: string, coverage: number | null): void {
    if (kind === 'partial') this.echo.trimmed++;
    else if (kind === 'self_interrupt') this.echo.selfInterrupts++;
    else this.echo.dropped++;
    this.echo.last = { at: nowIso(), kind, heard: heard.slice(0, 160), coverage };
    this.deps.log.info(`kendi sesi tur açmadı (${kind}${coverage === null ? '' : `, örtüşme ${coverage.toFixed(2)}`})`);
  }

  /** Jarvis'in az önce seslendirdiği metin (yankı karşılaştırması için). */
  private spokenText(): string {
    const cutoff = performance.now() - SPOKEN_KEEP_MS;
    return this.spoken
      .filter((item) => item.at >= cutoff)
      .map((item) => item.text)
      .join(' ');
  }

  /**
   * Söz Jarvis'in kendi sesi mi. Dönüş: kullanıcıya ait metin (yankı yoksa sözün tamamı, baştaki yankı ayıklandıysa
   * kalanı) ya da `null` (sözün tamamı Jarvis'in sesi: tur açılmaz).
   *
   * Eşik sözün ne zaman başladığına bağlıdır: Jarvis konuşurken ya da çalma biter bitmez başlayan söz için yankı
   * fiziksel olarak mümkündür (gevşek eşik); konuşmayı KESEN söz ve çalmadan sonra başlayan söz içinse kullanıcının
   * Jarvis'in sözcüklerini yinelemesi olağandır (sıkı eşik).
   */
  private ownVoice(text: string, segment: Segment, tail = true): string | null {
    const interrupted = this.lastInterrupted;
    if (
      segment.bargedIn &&
      interrupted &&
      interrupted.firstAudioAt !== null &&
      interrupted.at - interrupted.firstAudioAt < VOICE_TUNING.selfInterruptWindowMs &&
      isOwnSentenceStart(text, interrupted.sentences, toSpokenTurkish)
    ) {
      this.noteEcho('self_interrupt', text, null);
      // Tek seferlik kendini kesme hoş görülür (yanıt yeniden söylenir); kısa sürede ikincisi cihazın söz kesmeyi
      // kaldıramadığını gösterir ve kip `wake`e iner.
      const now = performance.now();
      if (now - this.selfInterruptAt < VOICE_TUNING.selfInterruptRepeatMs) this.deps.io.selfInterrupted?.();
      this.selfInterruptAt = now;
      // Kullanıcı sorusuna yanıt alamadan kalmasın: kesilene dek üretilmiş cümleler yeniden söylenir. Tur yeniden
      // KOŞULMAZ (araçlar ikinci kez çalışırdı); modelin o an henüz üretmediği kısım kaybolur.
      const lost = interrupted.sentences.join(' ');
      this.lastInterrupted = null;
      if (hasWords(lost)) {
        this.resumeAfterSelfInterrupt = true;
        void this.enqueueSpeech(lost, false);
      }
      return null;
    }
    if (!segment.suspect && performance.now() - this.playbackEndedAt > VOICE_TUNING.echoTextWindowMs) return text;
    const spoken = this.spokenText();
    if (!spoken) return text;
    const verdict = detectEcho(text, spoken, { lenient: segment.suspect && !segment.bargedIn, tail, normalize: toSpokenTurkish });
    if (verdict.kind === 'none') return text;
    this.noteEcho(verdict.kind, text, verdict.coverage);
    return verdict.kind === 'echo' ? null : verdict.rest;
  }

  /**
   * Tur bitti ve ses çalındı: koruma süresi dolunca o ana kadarki ses teslim dışı bırakılır (Fuber AI 1'deki zaman
   * kapısının karşılığı: "çalarken ve ardından kısa bir süre soru yakalama beslenmez"). Yalnız söz kesmenin `voice`
   * OLMADIĞI durumda: yankı engellemesine güvenilen cihazda kullanıcının Jarvis'in son sözcüğüne binen sözü atılmamalıdır.
   */
  private armEchoGuard(): void {
    if (this.bargeIn() === 'voice') return;
    const wait = Math.max(0, this.playbackEndedAt + this.echoGuardMs - performance.now());
    this.setTimer('echoGuard', wait, () => {
      // Araya yeni bir seslendirme girdiyse kesme onun bitişine kalır.
      if (this.turn || this.state === 'speaking' || this.state === 'thinking') return;
      if (!this.deps.io.cutSpeech) return;
      this.echo.cuts++;
      this.deps.io.cutSpeech();
    });
  }

  /** İşçi, kesme anından sonra söz içermeyen bölütü attı (Jarvis'in kendi sesiydi): o bölüt için bitiş gelmeyecek. */
  onSpeechCut(segmentId: number): void {
    if (this.segment && this.segment.id !== segmentId) return;
    this.speechActive = false;
    this.segment = null;
    if (this.suspended) return;
    this.noteEcho('guard', '', null);
    this.rearmAfterDrop();
  }

  /** Uyanma anı: ilk yanıt beklemesin diye beyin önbelleği ve seslendirme bağlantısı hazırlanır. Turu hiç bekletmez. */
  private prewarm(): void {
    void Promise.resolve()
      .then(() => this.deps.brain.prewarm('voice'))
      .catch(() => {});
    try {
      this.deps.io.prewarmSpeech?.();
    } catch {
      // Isıtma en iyi çabadır.
    }
  }

  private wakePaused(): boolean {
    return this.wakePausedUntil !== null && Date.parse(this.wakePausedUntil) > Date.now();
  }

  /** Yönetim asistanı kapattı mı: acil durdurma ya da zorunlu güncelleme (sürüm kapısı). İkisinde de ses hattı susar. */
  private gate(): 'kill_switch' | 'update_required' | null {
    if (this.deps.policy.killSwitchActive()) return 'kill_switch';
    if (this.deps.policy.updateRequired()) return 'update_required';
    return null;
  }

  private wakeAllowed(): boolean {
    return this.ready && !this.micMuted && !this.suspended && !this.wakePaused() && this.gate() === null;
  }

  private syncWake(): void {
    // d6: sezici Jarvis konuşurken de açıktır (söz kesme `off` değilse): "Jarvis" her kipte hemen keser. Eskiden yalnız
    // `wake` kipinde açıktı; `voice` kipinde kullanıcının sesi yankıdan belirgin yüksek değilse (Bluetooth hoparlör)
    // adla seslenmek de duyulmuyordu. Jarvis'in kendi cümlesinde adı geçiyorsa o sırada gelen tetik yok sayılır (`onWake`).
    // Toplantıda uyandırma sözü kapalıdır: konuşmada geçen ad Jarvis'i çağırmasın (dinleme kısayolla açılır).
    const want =
      !this.meeting && this.wakeAllowed() && (this.state === 'idle' || (this.state === 'speaking' && this.bargeIn() !== 'off'));
    if (want !== this.wakeOn) {
      this.wakeOn = want;
      this.deps.io.setWake(want);
    }
  }

  private setTimer(name: TimerName, ms: number, fire: () => void): void {
    this.clearTimer(name);
    this.timers.set(
      name,
      setTimeout(() => {
        this.timers.delete(name);
        fire();
      }, ms),
    );
  }

  private clearTimer(name: TimerName): void {
    const timer = this.timers.get(name);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(name);
  }

  private setState(requested: VoiceState, reason: VoiceStateReason): void {
    // Toplantıda takip penceresi yoktur: turdan sonraki söz toplantının sözüdür, Jarvis'e söylenmiş sayılmaz.
    const next: VoiceState = this.meeting && requested === 'followup' ? 'idle' : requested;
    const prev = this.state;
    this.clearTimer('listen');
    this.clearTimer('followup');
    if (next !== 'thinking' && next !== 'speaking') {
      this.clearTimer('stall');
      this.clearTimer('progress');
    }
    if (next !== 'speaking') this.clearTimer('settle');
    this.state = next;
    if (next === 'listening') {
      // Sohbet kipinde gürültüden (boş döküm) dinlemeye geri dönüş süreyi baştan başlatmaz: açık televizyon kipi
      // sonsuza dek açık tutmasın, 45 sn sessizlik gerçekten 45 sn olsun. Uyandırma sonrası kısa pencere (6 sn) ise
      // gürültüde yeniden başlar: kullanıcı öksürdü diye pencere kapanmasın.
      const now = performance.now();
      if (reason !== 'no_speech' || !this.conversation || this.listenDeadline <= now) {
        this.listenDeadline = now + this.listenWindowMs();
      }
    }
    if (next === 'listening' && !this.speechActive) this.armListen();
    if (next === 'followup' && !this.speechActive) this.armFollowup();
    this.syncWake();
    const watch = next === 'speaking' || next === 'thinking';
    if (watch !== this.stopWatchOn) {
      this.stopWatchOn = watch;
      this.deps.io.setStopWatch?.(watch);
    }
    if (prev !== next) this.deps.bus.emit('voice.state', { state: next, prev, reason, at: nowIso() });
    // Sohbet kipi boşa dönüşte biter (hata, zaman aşımı, "sus", acil durdurma, mikrofon kapatma): "boşta ama sohbet
    // kipinde" diye bir durum yoktur; yeniden konuşmak için uyandırma sözü gerekir.
    if ((next === 'idle' || next === 'mic_off') && this.conversation) {
      this.conversation = false;
      this.emitStatus();
    }
    if (next === 'idle' || next === 'followup' || next === 'mic_off' || (next === 'listening' && this.conversation)) {
      this.pumpSpeakQueue();
    }
    if (next === 'idle' || next === 'followup') this.pumpAmbient();
    if (next === 'idle' || next === 'mic_off') {
      this.pumpMeeting();
      // Sesli sohbet bitti: "bu iş boyunca sorma" yetkisi de biter. "Yeniden dene" önerisi boşa dönünce düşer.
      if (prev !== next) {
        try {
          this.deps.tools.endTask?.();
        } catch {
          // Yetki servisi yoksa (sınama) yapılacak iş yok.
        }
      }
    }
  }

  private listenWindowMs(): number {
    return this.conversation ? CONVERSATION_IDLE_SECONDS * 1000 : VOICE_TUNING.noSpeechTimeoutMs;
  }

  private armListen(): void {
    // Onay beklenirken süreyi onayın kendi zaman aşımı belirler.
    if (this.turn?.approval) return;
    const ms = Math.max(250, this.listenDeadline - performance.now());
    this.setTimer('listen', ms, () => {
      if (this.state !== 'listening' || this.speechActive) return;
      if (this.conversation) {
        this.conversation = false;
        this.emitStatus();
      }
      this.setState('idle', 'no_speech');
    });
  }

  private armFollowup(): void {
    // Dinleme süresi: bu cihazın ayarı (Hızlı kontrol, "dinleme süreni uzat") Yönetim'in değerini ezer.
    const ms = effectiveFollowUpSeconds(this.deps.settings.get(), this.deps.policy.get()) * 1000;
    this.setTimer('followup', ms, () => {
      if (this.state === 'followup' && !this.speechActive) this.setState('idle', 'followup_timeout');
    });
  }

  /**
   * Tur bekçisi. Her etkinlikte yeniden kurulur (`touch`); sıradaki ses çalınırken ve onay beklenirken süre işlemez.
   * Araç çalışırken sınır daha uzundur: çok adımlı iş "ilerlemiyor" sayılmaz.
   */
  private armStall(): void {
    const turn = this.turn;
    const playing = Math.max(0, this.audioUntil - performance.now());
    const limit = turn && turn.running.size > 0 ? VOICE_TUNING.toolStallMs : VOICE_TUNING.turnStallMs;
    this.setTimer('stall', playing + limit, () => this.onStall(limit));
  }

  /**
   * İş sürerken söylenen cümle bitti ama beyin hâlâ çalışıyor (bekleme sözünden sonra araçlar): durum "konuşuyor"da
   * kalmaz, "düşünüyor"a döner. Ada o sırada canlı adım satırını gösterir; "konuşuyor" yalnız gerçekten ses çalarken
   * görünür ve söz kesme kararı da buna bakar.
   */
  private armSettle(turn: Turn): void {
    const wait = Math.max(50, this.audioUntil + VOICE_TUNING.audibleMarginMs - performance.now());
    this.setTimer('settle', wait, () => {
      if (this.turn !== turn || turn.finished || turn.approval || turn.kind !== 'turn' || this.state !== 'speaking') return;
      if (performance.now() < this.audioUntil + VOICE_TUNING.audibleMarginMs - 20) return this.armSettle(turn);
      this.setState('thinking', 'api');
    });
  }

  /** Turda etkinlik oldu: bekçi baştan başlar. */
  private touch(turn: Turn): void {
    if (this.turn !== turn || turn.finished) return;
    turn.lastActivityAt = performance.now();
    if (!turn.approval) this.armStall();
  }

  /** Çalma bitişi raporu hiç gelmezse (pencere düştü) tur yine de kapanır. */
  private armGuard(turn: Turn): void {
    const pending = turn.streams
      .filter((stream) => !stream.done)
      .flatMap((stream) => stream.sentences)
      .reduce((sum, sentence) => sum + (sentence.audioMs ?? 8000), 0);
    this.setTimer('guard', pending + VOICE_TUNING.playbackGuardMs, () => {
      if (this.turn !== turn) return;
      this.deps.log.warn('oynatma bitişi bildirilmedi; tur kapatılıyor');
      for (const stream of turn.streams) stream.done = true;
      this.completeTurn(turn);
    });
  }

  // ───────────────────────────── hat durumu (index.ts bildirir) ─────────────────────────────

  setReady(ready: boolean, reason: string | null): void {
    const was = this.ready;
    this.ready = ready;
    this.notReadyReason = ready ? null : reason;
    if (ready && !was && !this.micMuted) this.deps.io.setCapture(true);
    if (!ready && was) {
      this.abandonTurn();
      this.deps.io.setCapture(false);
      this.speechActive = false;
      this.setState(this.micMuted ? 'mic_off' : 'idle', 'error');
    }
    this.syncWake();
    this.emitStatus();
  }

  setInputDevice(label: string | null): void {
    this.inputDeviceLabel = label;
    this.emitStatus();
  }

  /** `retry`: adada "Yeniden dene" gösterilsin (yinelenebilir bir söz var). */
  reportError(code: string, message: string, retry = false): void {
    this.lastError = message;
    this.deps.bus.emit('voice.error', retry ? { code, message, retry: true } : { code, message });
    this.emitStatus();
  }

  /**
   * Hata olmayan hat iletisi (bulut ses yerine yerel ses gibi): arayüz sakin bir bilgi olarak gösterir.
   * `lastError` değişmez; tepsi ve durum satırı hata saymaz.
   */
  reportNotice(code: string, message: string): void {
    this.deps.bus.emit('voice.error', { code, message, level: 'info' });
  }

  setSuspended(on: boolean): void {
    this.suspended = on;
    this.syncWake();
  }

  /** Politika değişti: uyandırma sözleri, söz kesme kipi, acil durdurma, sürüm kapısı. */
  refreshPolicy(): void {
    this.wakeMatcher = this.buildMatcher();
    if (this.gate() !== null && (this.turn || this.state !== 'idle')) this.cancelTurn('kill_switch');
    this.syncWake();
    this.emitStatus();
  }

  dispose(): void {
    for (const name of [...this.timers.keys()]) this.clearTimer(name);
    this.abandonTurn();
  }

  // ───────────────────────────── işçiden gelen olaylar ─────────────────────────────

  /** Anahtar sözcük sezici tetiklendi. */
  onWake(phrase: string, score: number): void {
    if (!this.wakeAllowed() || this.meeting) return;
    if (this.state !== 'idle' && !(this.state === 'speaking' && this.bargeIn() !== 'off')) return;
    if (this.state === 'speaking' && this.ownNameInSpeech()) {
      this.deps.log.info('konuşurken uyandırma tetiği: Jarvis kendi adını söylüyordu, yok sayıldı');
      return;
    }
    if (this.speechActive && this.segment) this.segment.heardPhrase = phrase;
    this.wakeLatency.kws = {
      sinceSpeechStartMs: this.speechActive && this.segment ? Math.max(0, Math.round(performance.now() - this.segment.onsetAt)) : null,
      sinceSpeechEndMs: null,
      sttMs: null,
      at: nowIso(),
    };
    if (this.state === 'idle') {
      this.wakeUp('kws', phrase, score, 'wake');
    } else {
      this.abandonTurn();
      this.wakeUp('kws', phrase, score, 'barge_in');
    }
  }

  /** Jarvis'in son cümlelerinde (≈20 sn) kendi adı geçiyor mu: konuşurken gelen sezici tetiği kendi sesi olabilir. */
  private ownNameInSpeech(): boolean {
    const cutoff = performance.now() - 20_000;
    const keys = this.wakeMatcher.nameKeys;
    return this.spoken.some(
      (item) => item.at >= cutoff && foldSpeech(item.text).split(/[^\p{L}\p{N}]+/u).some((word) => word.length > 0 && keys.has(soundKey(word))),
    );
  }

  private wakeUp(path: WakePath, phrase: string, score: number, reason: VoiceStateReason): void {
    // Uyanma izi (kaçan/yanlış uyanmayı günlükten saymak için): yol, skor, durum.
    this.deps.log.info(`uyandı: ${path === 'kws' ? `sezici (skor ${score.toFixed(2)})` : 'Whisper yolu'}${reason === 'barge_in' ? ', konuşurken' : ''}`);
    this.deps.bus.emit('voice.wake', { phrase, score, path, at: nowIso() });
    this.prewarm();
    this.setState('listening', reason);
  }

  /**
   * `onsetAgoMs`: sözün gerçek başlangıcından bu bildirime kadar geçen süre (VAD'ın algı gecikmesi).
   * `near`: yankı gidericinin kanısı (1 kullanıcı, 0 Jarvis'in yankısı; `null` o an yankı beklenmiyor; verilmezse
   * giderici henüz öğrenmedi).
   */
  onSpeechStart(segmentId: number, onsetAgoMs = 0, near?: number | null, coarse = false): void {
    this.speechActive = true;
    const onset = performance.now() - onsetAgoMs;
    // Çalma bittikten sonra başlayan söz: giderici biliyorsa onun kanısına bakılır (yankı beklenmiyorsa söz kullanıcınındır,
    // başı atılmaz); bilmiyorsa süreye dayalı korumaya düşülür.
    const afterPlayback = near === undefined ? onset < this.playbackEndedAt + this.echoGuardMs : near !== null && near < VOICE_TUNING.nearSure;
    // "Konuşuyor" durumu iş sürerken sessiz de olabilir (bekleme sözünden sonra araçlar çalışıyor): o sırada başlayan
    // söz Jarvis'in sesi olamaz; şüpheli sayılmaz ve bittiğinde yeni söz olarak değerlendirilir.
    // Beyni bitmiş turda (yalnız çalma kalmış) "konuşuyor" her zaman gerçekten konuşmaktır.
    const silentWork = this.turn !== null && this.turn.kind === 'turn' && !this.turn.finished && !this.turn.approval;
    const speakingNow = this.state === 'speaking' && (!silentWork || this.audible(onset) || onset < this.audioUntil + this.echoGuardMs);
    const suspect = speakingNow || afterPlayback;
    this.segment = { id: segmentId, bargedIn: false, heardPhrase: null, suspect, onsetAt: onset, ...(coarse ? { coarse: true } : {}) };
    if (this.suspended) return;
    if (this.state === 'idle') this.speculativePrewarm();
    else if (this.state === 'listening') this.clearTimer('listen');
    else if (this.state === 'followup') this.clearTimer('followup');
    else if (this.state === 'speaking' && this.bargeIn() === 'voice' && speakingNow && coarse && typeof near === 'number') {
      // Kaba kanıt (yankı giderici bu cihazda yakınsamadı; Bluetooth): hiçbir zaman hemen susulmaz. Aday güçlüyse ses
      // kısılır; kısık seste işçi "kullanıcı konuşuyor"u ikinci kez, yeni bir pencereyle bildirirse susulur
      // (`onSpeechNear`). Kısma hoparlörden gelen yankıyı düşürür, kullanıcının sesini düşürmez.
      if (near >= VOICE_TUNING.nearMaybe && this.deps.io.duck) this.startVerify(this.segment, VOICE_TUNING.coarseVerifyMs);
    } else if (this.state === 'speaking' && this.bargeIn() === 'voice' && speakingNow) {
      // Kullanıcı mı, Jarvis'in kendi yankısı mı? Giderici eminse hemen susulur; kararsızsa ses kısılır ve doğrulanır;
      // yankıysa hiçbir şey olmaz. Giderici henüz öğrenmediyse: yankı sızdığı bilinen cihazda aday yok sayılır
      // (yoksa ilk yanıtta kendini keser), bilinmeyen cihazda eskisi gibi hemen susulur.
      // "Yankı beklenmiyor" (`null`): sızdığı bilinen cihazda yalnız giderici gecikmeyi öğrendiyse güvenilir.
      const sure =
        near === undefined ? !this.echoSuspected : near === null ? !(this.echoSuspected && !this.cancellerTrained) : near >= VOICE_TUNING.nearSure;
      if (sure) this.bargeNow(this.segment);
      else if (near !== undefined && near !== null && near >= VOICE_TUNING.nearMaybe && this.deps.io.duck) this.startVerify(this.segment);
    }
  }

  /** Kullanıcı konuşuyor: Jarvis susar ve dinler. Söz, başından itibaren bölütte durduğu için tura eksiksiz girer. */
  private bargeNow(segment: Segment): void {
    this.endVerify(false);
    segment.bargedIn = true;
    if (this.turn?.approval) {
      // Onay sorusu okunurken yanıt geldi: yalnız soru susar, tur sürer.
      this.deps.io.stopPlayback();
    } else {
      this.abandonTurn();
    }
    this.setState('listening', 'barge_in');
  }

  /** Kıs ve doğrula: ses kısılınca yankı zayıflar, kullanıcının sesi zayıflamaz; giderici kısa sürede karar verir. */
  private startVerify(segment: Segment, ms: number = VOICE_TUNING.verifyMs): void {
    this.verifying = segment.id;
    this.deps.io.duck?.(true);
    this.setTimer('verify', ms, () => this.endVerify(true));
  }

  private endVerify(restore: boolean): void {
    this.clearTimer('verify');
    if (this.verifying === null) return;
    this.verifying = null;
    if (restore) this.deps.io.duck?.(false);
  }

  /**
   * İşçi: süren sözde kullanıcının konuştuğu artık kesin (kısılan seste oran eşiği geçti ya da yankıya kullanıcı katıldı).
   * `coarse`: kanıt kaba kapıdan; ilk bildirim yalnız sesi kısar, kısıkken gelen bildirim susturur.
   */
  onSpeechNear(segmentId: number, coarse = false): void {
    if (this.suspended || this.state !== 'speaking' || this.bargeIn() !== 'voice') return;
    const segment = this.segment;
    if (!segment || segment.id !== segmentId || segment.bargedIn || !this.speechActive) return;
    if (coarse) segment.coarse = true;
    if (coarse && segment.userAt === undefined) segment.userAt = performance.now() - COARSE_USER_LEAD_MS;
    if (coarse && this.verifying !== segment.id) {
      // Kaba kanıtın ilk bildirimi: önce ses kısılır, kısık seste ikinci bildirim gelirse susulur.
      if (this.deps.io.duck) this.startVerify(segment, VOICE_TUNING.coarseVerifyMs);
      return;
    }
    this.bargeNow(segment);
  }

  /**
   * Boştayken söz başladı: bu bir uyandırma olabilir. Whisper yolunda uyanma ancak söz bitip yazıya çevrilince
   * anlaşılır; beyin o ana kadar soğuksa (yerel model boşta kapanmış, bulut önbelleği düşmüş) ilk ses saniyelerce
   * gecikir. Bu yüzden ısıtma sözün başında, seyrek aralıkla başlatılır: odadaki her konuşmada değil.
   */
  private speculativePrewarm(): void {
    if (!this.wakeAllowed()) return;
    const now = performance.now();
    if (now - this.lastSpeculativePrewarm < VOICE_TUNING.speculativePrewarmEveryMs) return;
    this.lastSpeculativePrewarm = now;
    this.prewarm();
  }

  onSpeechEnd(segmentId: number, fullPcm: Int16Array, fullDurationMs: number): void {
    const segment = this.segment?.id === segmentId ? this.segment : { id: segmentId, bargedIn: false, heardPhrase: null, suspect: false, onsetAt: performance.now() - fullDurationMs };
    // Sızan (Bluetooth) cihazda yankı VAD'ı hiç susturmaz: kullanıcının sözü Jarvis'in yankısıyla başlamış bölüte düşer
    // ve Whisper ikisini karıştırıp kullanıcının ilk sözcüklerini atıyordu ("Bir dakika, başka bir şey soracağım" →
    // "şey soracağım"). Kaba kanıtla kesilen bölüt, kullanıcının katıldığı tahmini andan itibaren yazıya çevrilir.
    let pcm = fullPcm;
    let durationMs = fullDurationMs;
    if (segment.bargedIn && segment.userAt !== undefined && segment.userAt - segment.onsetAt > 800) {
      const skipMs = segment.userAt - segment.onsetAt + 300;
      const from = Math.min(fullPcm.length, Math.max(0, Math.round(skipMs * 16)));
      if (fullPcm.length - from > 8000) {
        pcm = fullPcm.subarray(from);
        durationMs = Math.max(0, fullDurationMs - Math.round(skipMs - 300));
      }
    }
    this.speechActive = false;
    segment.endedWallMs = Date.now() - VOICE_TUNING.endSilenceMs;
    if (this.verifying === segmentId) this.endVerify(true);
    if (this.suspended) return;
    if (this.guardDrops(segment)) {
      this.noteEcho('guard', '', null);
      this.rearmAfterDrop();
      return;
    }
    const endedAt = performance.now() - VOICE_TUNING.endSilenceMs;
    void this.routeSegment(segment, pcm, durationMs, endedAt)
      .catch((error: unknown) => {
        this.deps.log.error('söz bölütü işlenemedi', error);
        this.fail('internal', t('voice.error.internal'));
      })
      // Söz sürerken bekletilen bildirim/deneme cümlesi: söz uyandırma DEĞİLSE durum değişmez (boşta kalır) ve kuyruk hiç
      // işlenmiyordu; odada konuşma sürdükçe `speak` sonsuza dek bekledi (tts-switch.mjs gerçek mikrofonla 12 dk asılı
      // kaldı). Kuyruk her söz sonunda yeniden denenir; koşullar (tur, düşünme, süren söz) `pumpSpeakQueue` içinde.
      .finally(() => this.pumpSpeakQueue());
  }

  /**
   * Zaman kapısı: Jarvis konuşurken başlayıp çalma bittikten sonraki koruma süresi dolmadan biten söz, söz kesmenin
   * `voice` olmadığı cihazda yazıya çevrilmeden atılır (Jarvis'in cümlesinin kuyruğudur). Konuşmayı kesen söz ve
   * uyandırma sözüyle kesilen söz kullanıcınındır: atılmaz. Konuşma SÜRERKEN biten söz buraya girmez (dur-sözcüğü
   * ve uyandırma sözü için yazıya çevrilir).
   */
  private guardDrops(segment: Segment): boolean {
    if (!segment.suspect || segment.bargedIn || segment.heardPhrase !== null) return false;
    if (this.state === 'speaking' || this.state === 'thinking' || this.state === 'mic_off') return false;
    return this.bargeIn() !== 'voice' && performance.now() < this.playbackEndedAt + this.echoGuardMs;
  }

  /** Atılan sözden sonra bekleme süreleri yeniden işler (söz sürerken durdurulmuşlardı). */
  private rearmAfterDrop(): void {
    if (this.state === 'followup') this.armFollowup();
    else if (this.state === 'listening') this.armListen();
    this.pumpSpeakQueue();
  }

  /**
   * Kısa söz izleyici, asıl VAD'ın söz saymadığı kısa bir ses yakaladı (Jarvis konuşurken ya da düşünürken).
   * Dökümü dur-sözcüğüyse tur kesilir; başka her şey yok sayılır (söz kesme sayılmaz, komut olmaz).
   */
  onSpeechBlip(pcm: Int16Array, _durationMs: number): void {
    if (this.suspended || this.blipBusy || this.micMuted) return;
    if (this.state !== 'speaking' && this.state !== 'thinking') return;
    if (this.state === 'speaking' && this.bargeIn() === 'off') return;
    const turn = this.turn;
    this.blipBusy = true;
    void this.deps.io
      .transcribe(pcm)
      .then(async (result) => {
        if (this.turn !== turn || (this.state !== 'thinking' && this.state !== 'speaking')) return;
        // Onay sorusu okunurken söylenen kısa "evet / hayır": soru bitmeden kabul edilir (kendi sesi değilse).
        if (hasWords(result.text) && turn?.approval && detectEcho(result.text, this.spokenText(), { lenient: true, tail: false, normalize: toSpokenTurkish }).kind !== 'echo') {
          if (this.resolveApprovalFromSpeech(result.text, turn.approval.id, true) !== 'unclear') return;
        }
        const stop = await this.stopRecheck(pcm, result);
        if (stop && this.turn === turn && (this.state === 'thinking' || this.state === 'speaking')) this.stopByVoice(turn);
      })
      .catch(() => {
        // Yazıya çevrilemedi: kısa ses yok sayılır.
      })
      .finally(() => {
        this.blipBusy = false;
      });
  }

  private async routeSegment(segment: Segment, pcm: Int16Array, durationMs: number, endedAt: number): Promise<void> {
    // Mikrofon kapalıyken hiçbir söz işlenmez. Kapatma tur sürerken gelirse durum `thinking`/`speaking` kalır (yanıt
    // tamamlanır); kapatmadan önce başlamış ve yolda kalmış bölüt o sırada biterse eskiden yeni komut oluyordu. Beynin
    // bağlamında "Mikrofon KAPALI" yazdığı için Jarvis hem "duymuyorum" diyor hem yanıt veriyordu (18 Kas 2026).
    if (this.micMuted) return;
    switch (this.state) {
      case 'idle':
        if (!this.wakeAllowed()) return;
        if (this.meeting) {
          // Toplantı: her söz toplantı dökümüne gider; uyandırma için bakılmaz.
          this.enqueueMeeting({ source: 'mic', pcm, durationMs, endedWallMs: segment.endedWallMs ?? Date.now(), segment });
          return;
        }
        if (durationMs > VOICE_TUNING.wakeMaxSegmentMs) {
          // Uyandırma için bakılmayacak kadar uzun söz: ortam kipi açıksa sıraya girer, değilse yok sayılır.
          if (!this.ambientOn()) return;
          this.ambientQueue.push({ pcm, segment, durationMs });
          if (this.ambientQueue.length > AMBIENT_QUEUE_MAX) this.ambientQueue.shift();
          this.pumpAmbient();
          return;
        }
        return this.wakeFromSegment(pcm, endedAt, segment, durationMs);
      case 'listening':
      case 'followup':
        return this.turn?.approval ? this.answerApproval(this.turn, pcm, segment) : this.handleCommand(pcm, segment, endedAt);
      case 'thinking':
      case 'speaking':
        // Onay sorusu okunurken (söz kesme `wake` kipinde de) gelen söz yanıttır: cümlenin bitmesi beklenmez.
        if (this.turn?.approval) return this.answerApproval(this.turn, pcm, segment, true);
        // Sesli turun dışında sorulan onay (yetki yükseltme, yazılı sohbetin onayı) okunurken de aynı.
        if (this.askedOutside !== null && this.turn?.kind === 'system') return this.answerOutsideApproval(this.askedOutside, pcm, segment);
        return this.handleInterjection(pcm, durationMs, endedAt, segment);
      case 'mic_off':
        return;
    }
  }

  /**
   * Uyandırmanın Whisper yolu: boştayken biten sözün dökümü uyandırma sözüyle başlıyorsa uyanılır;
   * aynı sözde komut da varsa ("Jarvis, saat kaç") kalanı doğrudan komut olarak işlenir.
   */
  private async wakeFromSegment(pcm: Int16Array, endedAt: number, segment: Segment, durationMs: number): Promise<void> {
    let result: SttResult;
    try {
      result = await this.deps.io.transcribe(pcm);
    } catch {
      return;
    }
    const heard = this.heardText(result);
    // Jarvis'in kendi cümlesi adıyla başlayabilir ("Jarvis olarak…"): kendi sesi uyandırmaz.
    const own = hasWords(heard) ? this.ownVoice(heard, segment) : heard;
    if (own === null) return;
    const match = this.wakeMatcher.match(own);
    if (!match.matched) {
      // Kaçan uyanma tanısı: baştaki sözcük ada benziyor ama eşleşmedi (yalnız o sözcük yazılır).
      const near = hasWords(own) ? this.wakeMatcher.nearMiss(own) : null;
      if (near) this.deps.log.info(`uyandırma: ada benzeyen söz tanınmadı ("${near}")`);
      // Uyandırma sözüyle başlamayan söz: ortam kipi açıksa tur açmadan yayınlanır (aynı döküm; ek iş yok).
      if (hasWords(own) && this.ambientOn()) this.emitAmbient(own, segment, durationMs, result);
      return;
    }
    if (this.state !== 'idle' || !this.wakeAllowed()) return;
    const now = performance.now();
    this.wakeLatency.whisper = {
      sinceSpeechStartMs: Math.max(0, Math.round(now - segment.onsetAt)),
      sinceSpeechEndMs: Math.max(0, Math.round(now - endedAt)),
      sttMs: result.durationMs,
      at: nowIso(),
    };
    this.wakeUp('whisper', match.phrase, 1, 'wake');
    if (hasWords(match.rest)) {
      this.deps.io.earcon('heard');
      this.setState('thinking', 'speech_end');
      this.acceptCommand(match.rest, endedAt, result.durationMs);
    }
  }

  private async handleCommand(pcm: Int16Array, segment: Segment, endedAt: number): Promise<void> {
    const origin = this.state;
    // KURGU §5.2 madde 10: söz bitince hemen kısa bir ses, "duydum", ve "düşünüyor" durumu.
    // Konuşmayı kesen sözde ikisi de dökümden sonraya kalır: sesin kesilmesi zaten yanıttır ve söz "sus"
    // ise ardından ne ses gelmeli ne de ada "düşünüyor" göstermelidir. Jarvis'in kendi sesi olabilecek sözde de
    // dökümden sonraya kalır: yankı için "duydum" denmez.
    if (!segment.bargedIn && !segment.suspect) {
      this.deps.io.earcon('heard');
      this.setState('thinking', 'speech_end');
    }
    const waiting = this.state;
    const epoch = ++this.epoch;

    let result: SttResult;
    try {
      result = await this.deps.io.transcribe(pcm);
    } catch (error) {
      if (epoch !== this.epoch || this.state !== waiting) return;
      this.fail('stt', error instanceof SttError ? error.message : t('voice.error.stt'));
      return;
    }
    if (epoch !== this.epoch || this.state !== waiting) return;

    const heard = this.heardText(result);
    if (segment.bargedIn && this.bargeTestHook) {
      // Söz kesme sınaması: tur açılmaz. Susmaya yol açan söz Jarvis'in kendi cümlesiyse "kendini kesti" sayılır.
      const interrupted = this.lastInterrupted;
      const self =
        !hasWords(heard) ||
        (interrupted !== null && isOwnSentenceStart(heard, interrupted.sentences, toSpokenTurkish)) ||
        detectEcho(heard, this.spokenText(), { lenient: false, normalize: toSpokenTurkish }).kind === 'echo';
      this.bargeTestHook({ self, text: heard });
      this.setState('idle', 'api');
      return;
    }
    // Konuşmayı kesen kısa "Dur." süzgeçten "söz yok" diye atılmış olabilir: ham döküm dur-sözcüğüyse durulur
    // (yoksa Jarvis susmuş ama dinlemede kalmış olurdu; `dur-hizli` kararsızlığının bir yolu).
    if (segment.bargedIn && !isStopCommand(heard, this.wakeMatcher.nameKeys) && (await this.stopRecheck(pcm, result))) {
      if (epoch !== this.epoch || this.state !== waiting) return;
      this.setState('idle', 'stop_word');
      return;
    }
    // Gürültü, halüsinasyon ya da Jarvis'in kendi sesi: dinlemeye geri dönülür, süre yeniden başlar.
    const own = hasWords(heard) ? this.ownVoice(heard, segment) : null;
    if (own === null) {
      const resume = this.resumeAfterSelfInterrupt;
      this.resumeAfterSelfInterrupt = false;
      this.setState(origin === 'followup' || resume ? 'followup' : 'listening', 'no_speech');
      return;
    }
    let text = own;
    const wake = this.wakeMatcher.match(text);
    if (wake.matched || segment.heardPhrase) {
      text = wake.matched ? wake.rest : this.wakeMatcher.stripHeard(text, segment.heardPhrase ?? '');
      if (!hasWords(text)) {
        this.setState('listening', 'wake');
        return;
      }
    }
    if (segment.bargedIn && isStopCommand(text, this.wakeMatcher.nameKeys)) {
      this.setState('idle', 'stop_word');
      return;
    }
    if (segment.suspect && !segment.bargedIn && !isStopCommand(text, this.wakeMatcher.nameKeys)) this.deps.io.earcon('heard');
    this.acceptCommand(text, endedAt, result.durationMs);
  }

  /**
   * Yazıya çevirmenin süzülmüş dökümü; tek istisnayla: süzgeç dökümü yalnız "dilinden emin değilim" diye attıysa
   * ve döküm uyandırma sözüyle başlıyorsa söz geçerli sayılır. Ölçüm (17 Kas 2026): doğru yazılmış "Jarvis, saat
   * kaç?" (2,3 sn) bir koşuda dil olasılığı 0,42 çıktığı için atıldı ve kullanıcı duyulmadı. Halüsinasyonlar
   * ("Altyazı M.K.", "İzlediğiniz için teşekkürler") asistanın adıyla başlamaz; adla başlayan söz seslenmedir.
   */
  private heardText(result: SttResult): string {
    if (result.text || result.dropped !== 'language') return result.text;
    return this.wakeMatcher.match(result.raw).matched ? result.raw.trim() : '';
  }

  /**
   * Dur-sözcüğü mü: süzülmüş döküm ya da, süzgeç onu yalnız "söz yok olasılığı / dil belirsiz" diye attıysa, ham döküm.
   * Tek heceli, hızlı "Dur." için Whisper'ın söz yok olasılığı eşiğin çevresindedir: bölüt sınırı birkaç on ms kayınca
   * aynı ses bir koşuda "Dur." diye geçiyor, öbüründe atılıyordu (`voice.mjs sus › dur-hizli` kararsızlığı). Dur-sözcüğü
   * listesi dar olduğu için ham dökümden karar vermek güvenlidir (halüsinasyonlar bu sözler değildir).
   */
  /**
   * Kısa bölüt (≤ 1,3 sn) dur-sözcüğü çıkmadıysa bir kez daha, dur-sözcüklerini sayan istemle okunur. Ölçüm (d6,
   * `voice.mjs dur-hizli`): temiz, hızlı "Dur." olağan istemle "Gördüğünüz gibi." yazıldı ve Jarvis susmadı. İkinci
   * okuma yalnız SÜZÜLMÜŞ dökümü tam bir dur-sözcüğüyse kabul edilir; ilk döküm Jarvis'in kendi sözüyse yapılmaz.
   */
  private async stopRecheck(pcm: Int16Array, first: SttResult): Promise<boolean> {
    if (this.heardStop(first)) return this.userStop(first.text || first.raw, 'ilk okuma');
    // Sızan cihazda (söz kesme `wake`) Jarvis konuşurken mikrofondaki kısa ses çoğunlukla kendi sesidir; dur-sözcüklerini
    // sayan istemle ikinci okuma o sesi "Dur." diye yazabiliyor. Bir oturum günlüğünde: yanıt başladıktan 2 sn
    // sonra "dur-sözcüğü duyuldu (ikinci okuma, konuşurken)" ve iş durdu. İkinci okuma yalnız kendi sesi ortamda yokken ya
    // da cihaz temizken (`voice`) yapılır; açık söylenen dur-sözcüğü ilk okumada, "Jarvis" sezicide yakalanır.
    if (this.bargeIn() !== 'voice' && this.ownVoiceNear()) return false;
    if (pcm.length > 1.3 * 16_000) return false;
    const words = first.text.split(/\s+/).filter((word) => hasWords(word)).length;
    if (words > 3) return false;
    if (hasWords(first.text) && detectEcho(first.text, this.spokenText(), { lenient: true, tail: false, normalize: toSpokenTurkish }).kind !== 'none') return false;
    try {
      const second = await this.deps.io.transcribe(pcm, { hint: 'stop' });
      return isStopCommand(second.text, this.wakeMatcher.nameKeys) && this.userStop(second.text, 'ikinci okuma');
    } catch {
      return false;
    }
  }

  /**
   * Duyulan dur-sözcüğü kullanıcının mı: Jarvis'in az önce seslendirdiği metinde aynı söz geçiyorsa kendi sesidir
   * ("Bir saniye." dolgu sözü hoparlörden mikrofona geri gelir) ve yok sayılır. Her karar günlüğe yazılır: kendi
   * kendine susma şikâyetinde hangi yolun tetiklediği günlükten okunabilsin.
   */
  /** Jarvis konuşuyor ya da çalma az önce bitti (Bluetooth gecikmesi + yazıya çevirme süresi): mikrofondaki söz kendi sesi olabilir. */
  private ownVoiceNear(): boolean {
    return this.state === 'speaking' || performance.now() < this.playbackEndedAt + 4000;
  }

  private userStop(heard: string, via: 'ilk okuma' | 'ikinci okuma'): boolean {
    if (this.ownVoiceNear() && stopWordsSpoken(heard, this.spokenText(), this.wakeMatcher.nameKeys)) {
      this.deps.log.info(`dur-sözcüğü Jarvis'in kendi cümlesindeydi, yok sayıldı (${via})`);
      return false;
    }
    this.deps.log.info(`dur-sözcüğü duyuldu (${via}, ${this.state === 'speaking' ? 'konuşurken' : 'düşünürken'})`);
    return true;
  }

  private heardStop(result: SttResult): boolean {
    if (isStopCommand(result.text, this.wakeMatcher.nameKeys)) return true;
    if (result.text || (result.dropped !== 'no_speech' && result.dropped !== 'language')) return false;
    return isStopCommand(result.raw, this.wakeMatcher.nameKeys);
  }

  /** Dökümü hazır komut: yerel hızlı yollar (dur-sözcüğü, kip bitirme, onay), sonra model turu. */
  private acceptCommand(text: string, endedAt: number, sttMs: number): void {
    if (isStopCommand(text, this.wakeMatcher.nameKeys)) {
      this.setState('idle', 'stop_word');
      return;
    }
    if (isEndOfConversation(text, this.wakeMatcher.nameKeys)) {
      if (this.conversation) {
        this.conversation = false;
        this.emitStatus();
      }
      // Veda sözü ("güle güle", "görüşürüz", "iyi geceler"): sohbet BİTER (kip ve takip dinlemesi), tek kısa veda
      // söylenir; mikrofon kapanmaz, uyandırma sözü dinlenmeye devam eder. "Bu kadar", "sohbeti bitir" sessiz biter.
      const farewell = farewellOf(text, this.wakeMatcher.nameKeys);
      if (farewell) {
        const address = this.deps.settings.get().userAddress?.trim() || this.deps.policy.get().persona.address;
        this.say(t(farewell === 'night' ? 'voice.conversation.farewellNight' : 'voice.conversation.farewell', { address: address ? ` ${address}` : '' }), { state: 'idle', reason: 'stop_word' });
        return;
      }
      this.setState('idle', 'stop_word');
      return;
    }
    // "Yeniden deneyeyim mi?" sorusuna "evet" ya da doğrudan "yeniden dene": kesilen / başarısız olan son söz yeniden yürür.
    const retry = this.retryable;
    if (retry) {
      const offered = retry.offeredAt !== null && performance.now() - retry.offeredAt < VOICE_TUNING.retryOfferMs;
      const verdict = offered ? this.interpretYesNo(text) : 'unclear';
      if (isRetryCommand(text, this.wakeMatcher.nameKeys) || verdict === 'approved') {
        this.retryable = null;
        if (this.state !== 'thinking') this.setState('thinking', 'speech_end');
        void this.runTurn(retry.text, endedAt, sttMs);
        return;
      }
      if (verdict === 'denied') {
        this.retryable = null;
        this.emitStatus();
        this.setState('followup', 'speech_done');
        return;
      }
      // Başka bir söz: öneri düşer, söz olağan yoldan işlenir.
      if (offered) retry.offeredAt = null;
    }
    // Toplantı kipinde sohbet kipi AÇILMAZ: açılsaydı toplantıdaki her söz (uyandırma sözü olmadan) komut sayılırdı.
    // Kullanıcıya nedeni söylenir (toplantıda yazıyla); dinleme kısayolla açılmaya devam eder.
    if (this.meeting && isStartOfConversation(text, this.wakeMatcher.nameKeys)) {
      this.say(t('voice.conversation.meetingBlocked'), { state: 'idle', reason: 'api' });
      return;
    }
    // "Sohbet edelim": model turu açılmaz; kısa bir onay söylenir ve uyandırma sözü olmadan dinlenir.
    if (!this.conversation && isStartOfConversation(text, this.wakeMatcher.nameKeys) && this.deps.policy.get().voice.conversationMode) {
      this.conversation = true;
      this.emitStatus();
      this.say(t('voice.conversation.started'), { state: 'listening', reason: 'conversation' });
      return;
    }
    // Sesli tur dışında bekleyen onay (yazılı sohbet, arka plan işi): söz önce onaya sorulur. Kimlik verilmez;
    // araç servisi yalnız TEK onay bekliyorsa sonuçlandırır (hangisine yanıt verildiği başka türlü bilinemez).
    // Soruyu az önce Jarvis sesli sorduysa (yetki yükseltme gibi) yanıt o soruya aittir: gündelik "tamam" da geçerlidir.
    const asked = this.askedOutside;
    if ((asked !== null ? this.resolveApprovalFromSpeech(text, asked, true) : this.resolveApprovalFromSpeech(text, null)) !== 'unclear') {
      this.setState('followup', 'speech_done');
      return;
    }
    // Sesle yetki düzeyi ("tam yetki ver", "bir saatliğine tam yetki", "her şeyi sor"): kodla, model turu açılmadan.
    const authority = typeof (this.deps.tools as Partial<SessionDeps['tools']>).authority === 'function' ? routeAuthoritySpeech(foldSpeech(text).replace(/[^\p{L}\p{N}\s]+/gu, ' ')) : null;
    if (authority) {
      this.setState('followup', 'speech_done');
      void this.changeAuthority(authority);
      return;
    }
    if (this.state !== 'thinking') this.setState('thinking', 'speech_end');
    void this.runTurn(text, endedAt, sttMs);
  }

  /** Düşünürken ya da (söz kesmenin `wake` kipinde) konuşurken gelen kısa söz: yalnız dur-sözcüğü ve uyandırma sözü işlenir. */
  private async handleInterjection(pcm: Int16Array, durationMs: number, endedAt: number, segment: Segment): Promise<void> {
    const turn = this.turn;
    // İş sürerken dinleme AÇIK: Jarvis o an konuşmuyorsa (düşünüyor ya da araç çalışıyor) söz, uzunluğu ne olursa
    // olsun yazıya çevrilir ve yeni komut olabilir. Jarvis konuşurken başlayan söz eskisi gibi yalnız dur-sözcüğü ve
    // uyandırma sözü içindir (kendi sesi karışmıştır). Toplantıda ortamdaki söz komut sayılmaz.
    const working = turn !== null && turn.kind === 'turn' && !turn.finished && !segment.suspect && !this.meeting;
    if (!working) {
      if (this.state === 'speaking' && this.bargeIn() === 'off') return;
      if (durationMs > VOICE_TUNING.interjectionMaxMs) return;
    }
    let result: SttResult;
    try {
      result = await this.deps.io.transcribe(pcm);
    } catch {
      return;
    }
    if (this.turn !== turn || (this.state !== 'thinking' && this.state !== 'speaking')) return;
    if (working && isCancelCommand(result.text, this.wakeMatcher.nameKeys)) {
      this.stopByVoice(turn);
      return;
    }
    if (await this.stopRecheck(pcm, result)) {
      if (this.turn === turn && (this.state === 'thinking' || this.state === 'speaking')) this.stopByVoice(turn);
      return;
    }
    if (!hasWords(result.text)) return;
    if (working) {
      const heard = this.heardText(result);
      const own = hasWords(heard) ? this.ownVoice(heard, segment) : null;
      if (own === null) return;
      const wake = this.wakeMatcher.match(own);
      const text = wake.matched ? wake.rest : own;
      const words = text.split(/\s+/).filter((word) => hasWords(word)).length;
      if (!hasWords(text) || (!wake.matched && words < VOICE_TUNING.interjectMinWords)) return;
      // Yeni söz eskisinin yerini alır: süren iş durur (araçlar iptal edilir), söz hemen işlenir.
      this.deps.log.info('iş sürerken yeni söz: süren tur bırakıldı');
      this.abandonTurn();
      this.deps.io.earcon('heard');
      this.setState('thinking', 'interject');
      this.acceptCommand(text, endedAt, result.durationMs);
      return;
    }
    // Jarvis'in kendi cümlesinde adı geçiyorsa ("Ben Jarvis…") kendi sesi uyandırma sözü sayılmasın. Kuyruk kuralı
    // (tek sözcük) burada kullanılmaz: kullanıcının tek sözcüklük seslenmesi ("Jarvis") her zaman geçerlidir.
    if (segment.suspect && this.state === 'speaking') {
      const verdict = detectEcho(result.text, this.spokenText(), { lenient: true, tail: false, normalize: toSpokenTurkish });
      if (verdict.kind === 'echo') return;
    }
    const wake = this.wakeMatcher.match(result.text);
    if (!wake.matched || this.state !== 'speaking') return;
    this.abandonTurn();
    this.deps.log.info('uyandı: Whisper yolu, konuşurken');
    this.deps.bus.emit('voice.wake', { phrase: wake.phrase, score: 1, path: 'whisper', at: nowIso() });
    if (hasWords(wake.rest)) {
      this.deps.io.earcon('heard');
      this.setState('thinking', 'barge_in');
      this.acceptCommand(wake.rest, endedAt, result.durationMs);
    } else {
      this.setState('listening', 'barge_in');
    }
  }

  // ───────────────────────────── onay ─────────────────────────────

  /**
   * Sözün onay olup olmadığına yalnız araç servisi karar verir (KURGU §13). Oturum yalnız HANGİ onayın sorulduğunu ve
   * sorunun doğrudan sesli sorulup sorulmadığını (`asked`) bildirir: doğrudan sorulan soruda gündelik "tamam / yap /
   * olur" da onaydır; kimliği bilinmeyen (başka yerde bekleyen) onayda yalnız açık onay sözü geçerlidir.
   */
  private resolveApprovalFromSpeech(text: string, approvalId: Id | null, asked = false): 'approved' | 'denied' | 'unclear' {
    try {
      return this.deps.tools.resolveApprovalFromSpeech(text, approvalId === null ? undefined : { approvalId, ...(asked ? { asked: true } : {}) });
    } catch (error) {
      this.deps.log.warn('sözlü onay yorumlanamadı', error);
      return 'unclear';
    }
  }

  /**
   * Sesle yetki değiştirme. Düşürmek hemen uygulanır; YÜKSELTMEK tek seferlik açık onay ister (ada kartı ya da
   * sesle "evet"); Yönetim'in üst sınırı aşılamaz. Sonuç tek kısa cümleyle söylenir.
   */
  private async changeAuthority(request: AuthorityRequest): Promise<void> {
    const tools = this.deps.tools;
    try {
      const plan = planAuthorityChange(tools.authority(), request);
      if (plan.action === 'confirm') {
        const decision = await tools.requestApproval({
          toolName: 'authority_set',
          moduleId: 'voice-control',
          summary: plan.summary,
          ask: plan.ask,
          kind: 'authority',
          input: request as never,
          origin: { channel: 'voice', speakerVerified: null },
        });
        if (decision !== 'approved') {
          void this.enqueueSpeech(t('authority.say.denied'), true);
          return;
        }
      }
      if (plan.action !== 'say') {
        if (plan.apply.grant !== undefined) tools.grantAuthority(plan.apply.grant);
        if (plan.apply.level !== undefined) this.deps.settings.update({ authorityLevel: plan.apply.level });
        this.deps.log.info(`yetki düzeyi sesle değişti: ${JSON.stringify(plan.apply)}`);
      }
      void this.enqueueSpeech(plan.say, true);
    } catch (error) {
      this.deps.log.warn('yetki düzeyi değiştirilemedi', error);
    }
  }

  /** Evet/hayır sorusuna verilen kısa yanıt (onay kapısının sözcükleriyle; "yeniden deneyeyim mi?" için). */
  private interpretYesNo(text: string): 'approved' | 'denied' | 'unclear' {
    const words = text.toLocaleLowerCase('tr').match(/[\p{L}]+/gu) ?? [];
    if (words.length === 0 || words.length > 4) return 'unclear';
    if (words.some((word) => ['hayır', 'yok', 'gerek', 'vazgeç', 'boşver', 'kalsın', 'istemem', 'olmaz'].includes(word))) return 'denied';
    if (words.some((word) => ['evet', 'tamam', 'olur', 'dene', 'tabii', 'tabi', 'lütfen', 'hadi', 'aynen'].includes(word))) return 'approved';
    return 'unclear';
  }

  /**
   * Bir araç onay istedi. Sesli tur sürüyorsa soru o turun içinde sorulur ve yanıt uyandırma sözü olmadan dinlenir.
   * `ask`: sorunun kısa sesli biçimi ("Göndereyim mi?"); ayrıntı adadaki karttadır.
   */
  onApprovalRequest(id: Id, summary: string, ask?: string): void {
    const question = ask?.trim() || `${summary.trim()} ${t('voice.approval.ask')}`;
    const turn = this.turn;
    if (!turn || turn.kind !== 'turn' || turn.interrupted) {
      // Onay sesli turun dışında doğdu (yazılı sohbet, arka plan işi): soru seslendirilir ama sesli döküme YAZILMAZ.
      // Soru kendi oturumuna (ve adadaki onay kartına) aittir; dökümde tek iletili ayrı bir "Yeni sohbet" açmasın.
      this.askedOutside = id;
      void this.enqueueSpeech(question, false);
      return;
    }
    this.clearTimer('stall');
    this.clearTimer('progress');
    // Model soruyu zaten sorduysa ("Mesajı göndereyim mi?") aynı şey ikinci kez sorulmaz: o cümlenin bitmesi beklenir.
    const lastSentence = turn.streams.at(-1)?.sentences.at(-1);
    const alreadyAsked =
      lastSentence !== undefined && !lastSentence.progress && /\?\s*$/.test(lastSentence.text) && performance.now() - turn.lastSaidAt < 15_000;
    const asking = alreadyAsked ? (turn.streams.at(-1) ?? null) : null;
    this.closeOpenStream(turn);
    turn.approval = { id, stream: null, reasks: 0 };
    this.emitActivity(turn);
    if (asking) {
      turn.approval.stream = asking;
      if (asking.done) this.setState('listening', 'api');
      return;
    }
    this.askApproval(turn, question);
  }

  private askApproval(turn: Turn, question: string): void {
    if (!turn.approval) return;
    this.pushSentence(turn, question);
    turn.approval.stream = turn.open;
    this.closeOpenStream(turn);
    // Soru seslendirilemiyorsa (sessiz kip) doğrudan yanıt beklenir.
    if (!turn.approval.stream) this.setState('listening', 'api');
  }

  onApprovalResolved(id: Id): void {
    if (this.askedOutside === id) this.askedOutside = null;
    const turn = this.turn;
    if (!turn?.approval || turn.approval.id !== id) return;
    turn.approval = null;
    if (this.state === 'speaking') this.cutPlayback(turn);
    this.setState('thinking', 'speech_end');
    turn.lastActivityAt = performance.now();
    this.armStall();
    this.emitActivity(turn);
  }

  /**
   * Sesli turun dışında sorulan onayın sorusu okunurken gelen söz: kendi sesi değilse onay kapısına sorulur; sonuçlanırsa
   * soru susar ve takip dinlemesine geçilir. Anlaşılmayan söz hiçbir şeyi değiştirmez (soru okunmaya devam eder).
   */
  private async answerOutsideApproval(id: Id, pcm: Int16Array, segment: Segment): Promise<void> {
    const turn = this.turn;
    let text = '';
    try {
      text = (await this.deps.io.transcribe(pcm)).text;
    } catch {
      return;
    }
    if (this.turn !== turn || this.askedOutside !== id || !hasWords(text)) return;
    if (segment.suspect) {
      const own = this.ownVoice(text, segment, false);
      if (own === null) return;
      text = own;
    }
    if (isStopCommand(text, this.wakeMatcher.nameKeys)) {
      this.abandonTurn();
      this.setState('idle', 'stop_word');
      return;
    }
    if (this.resolveApprovalFromSpeech(text, id, true) === 'unclear') return;
    this.abandonTurn();
    this.setState(this.micMuted ? 'mic_off' : 'followup', 'speech_done');
  }

  /** `midQuestion`: soru hâlâ okunuyor; anlaşılmayan söz (Jarvis'in kendi sesi olabilir) yeniden sormaya yol açmaz. */
  private async answerApproval(turn: Turn, pcm: Int16Array, segment: Segment, midQuestion = false): Promise<void> {
    if (!segment.suspect && !midQuestion) this.deps.io.earcon('heard');
    let text = '';
    try {
      text = (await this.deps.io.transcribe(pcm)).text;
    } catch {
      // Yazıya çevrilemedi: anlaşılmamış sayılır, yeniden sorulur.
    }
    if (this.turn !== turn || !turn.approval) return;
    if (segment.suspect && hasWords(text)) {
      // Onay sorusunun kendi sesi yanıt sanılmasın ("anlayamadım" diye yeniden sormasın): sessizce beklenir. Kuyruk
      // kuralı kullanılmaz: tek sözcüklük yanıt sorunun sözcüğünü yineler ("…evet ya da hayır der misiniz?" → "Hayır").
      const own = this.ownVoice(text, segment, false);
      if (own === null) return;
      text = own;
      if (!midQuestion) this.deps.io.earcon('heard');
    }
    // Onay sonuçlanınca `tool.approval.resolve` olayı gelir ve tur `thinking`'e döner.
    // Söz yalnız bu turun sorduğu onaya aittir: başka bir yerde bekleyen onay bu yanıtla kapanmaz. Soru doğrudan
    // sorulduğu için gündelik kabul sözleri de ("tamam", "yap", "olur") geçerlidir.
    if (hasWords(text) && this.resolveApprovalFromSpeech(text, turn.approval.id, true) !== 'unclear') return;
    if (midQuestion) return;
    if (turn.approval.reasks < 2) {
      turn.approval.reasks++;
      this.askApproval(turn, t('voice.approval.reask'));
    } else {
      this.setState('listening', 'api');
    }
  }

  // ───────────────────────────── tur ─────────────────────────────

  private newTurn(kind: Turn['kind']): Turn {
    return {
      id: newId(),
      kind,
      abort: new AbortController(),
      streams: [],
      open: null,
      shown: [],
      finished: false,
      interrupted: false,
      amended: false,
      assistantMessageId: null,
      after: null,
      resolveSpoken: null,
      approval: null,
      userText: null,
      startedAt: performance.now(),
      lastActivityAt: performance.now(),
      running: new Map(),
      toolsDone: 0,
      failed: null,
      lastSaidAt: performance.now(),
      lastProgress: null,
      speechEndAt: null,
      sttMs: null,
      transcriptAt: null,
      firstSentenceAt: null,
      firstAudioAt: null,
    };
  }

  private async runTurn(text: string, endedAt: number, sttMs: number): Promise<void> {
    const turn = this.newTurn('turn');
    turn.speechEndAt = endedAt;
    turn.sttMs = sttMs;
    turn.transcriptAt = performance.now();
    turn.userText = text;
    this.turn = turn;
    this.audioUntil = 0;
    if (this.retryable) {
      this.retryable = null;
      this.emitStatus();
    }
    if (this.state !== 'thinking') this.setState('thinking', 'speech_end');
    this.armStall();
    this.deps.bus.emit('voice.partial', { turnId: turn.id, role: 'user', text, final: true });
    this.emitActivity(turn);

    let result: TurnResult | null = null;
    try {
      result = await this.deps.conversation.turn({
        sessionId: null,
        channel: 'voice',
        text,
        signal: turn.abort.signal,
        onSentence: (sentence) => this.onSentence(turn, sentence),
        // Model metin akıtıyor ya da araç çalışıyor: tur ilerliyor (bekçi yalnız gerçek donmada devreye girer).
        onText: () => this.touch(turn),
        onToolCall: (event) => this.onToolCall(turn, event),
      });
    } catch (error) {
      this.deps.log.error('sesli tur yürütülemedi', error);
    }
    turn.assistantMessageId = result?.assistantMessage.id ?? null;
    if (turn.interrupted) {
      this.amendInterrupted(turn);
      return;
    }
    if (this.turn !== turn) return;

    const response = result?.response;
    if (!response) {
      this.turnFailed(turn, 'error', turn.failed ?? t('voice.error.brain'));
    } else if (response.stopReason === 'aborted') {
      // Tur başka bir yerden iptal edildi (acil durdurma beyne bizden önce ulaştı).
      this.abandonTurn();
      this.setState(this.micMuted ? 'mic_off' : 'idle', 'panic');
      return;
    } else if (response.stopReason !== 'end' && response.stopReason !== 'max_steps' && response.stopReason !== 'max_tokens') {
      this.turnFailed(turn, response.stopReason, response.error ?? turn.failed ?? t('voice.error.brain'));
    } else if (turn.failed && !this.saidAnswer(turn)) {
      // Bir adım başarısız oldu ve model hiçbir şey söylemedi: neden söylenir ("… arama kutusunu bulamadım").
      this.pushSentence(turn, turn.failed);
    }
    this.finishTurn(turn);
  }

  /** Bu turda beynin kendi cümlesi söylendi/gösterildi mi (ilerleme cümleleri sayılmaz). */
  private saidAnswer(turn: Turn): boolean {
    return turn.shown.length > 0 || turn.streams.some((stream) => stream.sentences.some((sentence) => !sentence.progress));
  }

  /**
   * Beyin yanıt üretemedi: NE olduğu söylenir ve sohbet AÇIK kalır (takip dinlemesi); söz "yeniden dene" ile
   * yinelenebilir. Yalnız asistanın tümden kapalı olduğu durumlarda (acil durdurma, anahtar yok) boşa dönülür.
   */
  private turnFailed(turn: Turn, code: string, message: string): void {
    const closed = code === 'kill_switch' || code === 'no_key';
    if (!closed && turn.userText) this.retryable = { text: turn.userText, offeredAt: null };
    this.reportError(code, message, !closed && turn.userText !== null);
    turn.after = closed ? { state: 'idle', reason: 'error' } : { state: this.conversation ? 'listening' : 'followup', reason: 'error' };
    if (!this.saidAnswer(turn)) this.pushSentence(turn, message);
  }

  /** Araç çağrısı olayı (beynin bildirdiği): bekçi, ada adım satırı ve sesli ilerleme buradan beslenir. */
  private onToolCall(turn: Turn, event: ToolCallEvent): void {
    if (turn.interrupted || this.turn !== turn) return;
    if (event.phase === 'start') {
      turn.running.set(event.callId, { name: event.name, step: stepLabel(event.name, event.input) });
    } else if (event.phase === 'report') {
      const running = turn.running.get(event.callId);
      const step = event.step.trim();
      if (running && step) running.step = step.length > 80 ? `${step.slice(0, 79)}…` : step;
    } else {
      turn.running.delete(event.callId);
      turn.toolsDone++;
      // İptal edilen araç (söz kesme, "dur") başarısızlık değildir; başarılı adım önceki hatayı siler (model yeniden denedi).
      if (event.ok) turn.failed = null;
      else if (event.text !== t('tool.error.aborted')) turn.failed = failureReason(event.text) || turn.failed;
    }
    this.touch(turn);
    this.emitActivity(turn);
    this.armProgress(turn);
  }

  /**
   * Sesli ilerleme: iş sürerken Jarvis `progressQuietMs` boyunca sessiz kaldıysa o anki adımı tek kısa cümleyle söyler.
   * Gevezelik yok: aynı cümle art arda söylenmez, model kendi cümlesini kurduysa süre baştan başlar, onay beklenirken
   * ve ses çalarken söylenmez. `Settings.spokenProgress` kapalıysa hiç söylenmez (ada satırı yine görünür).
   */
  private armProgress(turn: Turn): void {
    if (this.turn !== turn || turn.finished || turn.running.size === 0) {
      this.clearTimer('progress');
      return;
    }
    if (this.deps.settings.get().spokenProgress === false) return;
    const now = performance.now();
    const quietFrom = Math.max(turn.lastSaidAt, this.audioUntil);
    const wait = Math.max(250, quietFrom + VOICE_TUNING.progressQuietMs - now);
    this.setTimer('progress', wait, () => {
      if (this.turn !== turn || turn.finished || turn.approval || turn.interrupted) return;
      const step = [...turn.running.values()].at(-1)?.step;
      if (!step || this.speechActive) return this.armProgress(turn);
      if (performance.now() < Math.max(turn.lastSaidAt, this.audioUntil) + VOICE_TUNING.progressQuietMs - 50) return this.armProgress(turn);
      if (step !== turn.lastProgress) {
        turn.lastProgress = step;
        this.pushSentence(turn, /[.!?…]$/.test(step) ? step : `${step}.`, true);
      } else {
        turn.lastSaidAt = performance.now();
      }
      this.armProgress(turn);
    });
  }

  private onSentence(turn: Turn, sentence: string): void {
    if (turn.interrupted || this.turn !== turn || !hasWords(sentence)) return;
    if (turn.firstSentenceAt === null) turn.firstSentenceAt = performance.now();
    this.pushSentence(turn, sentence);
    turn.lastActivityAt = performance.now();
    this.armStall();
  }

  private pushSentence(turn: Turn, sentence: string, progress = false): void {
    turn.lastSaidAt = performance.now();
    if (progress && (this.quiet || this.meeting || !this.deps.io.canSpeak())) return;
    if (this.quiet || this.meeting || !this.deps.io.canSpeak()) {
      // Sessiz kip, toplantı ya da TTS yok: yanıt adaya yazıyla düşer.
      turn.shown.push(sentence);
      this.deps.bus.emit('voice.partial', { turnId: turn.id, role: 'assistant', text: stripExpressionTags(sentence), final: false });
      return;
    }
    if (!turn.open) {
      turn.open = { id: newId(), sentences: [], started: false, startedAt: null, done: false, interrupted: false, playedMs: 0 };
      turn.streams.push(turn.open);
    }
    turn.open.sentences.push(progress ? { text: sentence, audioMs: null, progress: true } : { text: sentence, audioMs: null });
    this.spoken.push({ text: sentence, at: performance.now() });
    if (this.spoken.length > SPOKEN_KEEP) this.spoken.shift();
    this.deps.io.speak(turn.open.id, sentence);
  }

  private closeOpenStream(turn: Turn): void {
    if (!turn.open) return;
    this.deps.io.endStream(turn.open.id);
    turn.open = null;
  }

  /** Beyin bitti (ya da sistem cümlesi sıraya kondu): akış kapatılır, çalmanın bitmesi beklenir. */
  private finishTurn(turn: Turn): void {
    turn.finished = true;
    this.closeOpenStream(turn);
    this.clearTimer('stall');
    this.clearTimer('progress');
    turn.running.clear();
    if (turn.streams.every((stream) => stream.done)) this.completeTurn(turn);
    else this.armGuard(turn);
  }

  private completeTurn(turn: Turn): void {
    this.clearTimer('stall');
    this.clearTimer('guard');
    if (this.turn !== turn) return;
    this.turn = null;
    if (turn.kind === 'turn') this.emitActivity(turn);
    const spoken = turn.streams.some((stream) => stream.playedMs > 0);
    if (turn.kind === 'turn') {
      const text = [...turn.streams.flatMap((stream) => stream.sentences.filter((s) => !s.progress).map((s) => s.text)), ...turn.shown].join(' ');
      this.deps.bus.emit('voice.partial', { turnId: turn.id, role: 'assistant', text: stripExpressionTags(text), final: true });
      this.deps.bus.emit('voice.turn', this.metrics(turn, false));
    }
    turn.resolveSpoken?.({ spoken });

    if (turn.kind === 'turn') this.lastStages = this.stagesOf(turn, false);
    if (spoken) this.armEchoGuard();
    if (this.micMuted) this.setState('mic_off', 'mute');
    else if (turn.after) this.setState(this.reopen(turn.after.state), turn.after.reason);
    else if (this.conversation) this.setState(this.reopen('listening'), 'conversation');
    else this.setState(this.reopen('followup'), 'speech_done');
  }

  /**
   * Yanıt bitince sözü KENDİLİĞİNDEN yeniden dinlemeye açmak uygun mu. Dinleme duraklatılmışsa (`pauseWake`, yan menüdeki
   * "Dinleme") dinlemeye ya da takip penceresine dönülmez, boşa düşülür: eskiden sohbet kipinde yanıt biter bitmez
   * yeniden dinlemeye açılıyor, duraklatılmış dinlemede söylenen söz komut oluyordu (18 Kas 2026). Kullanıcının açıkça
   * istediği dinleme (konuş kısayolu, ada) bu yoldan geçmez: duraklatılmışken de çalışır.
   */
  private reopen(desired: VoiceState): VoiceState {
    if ((desired === 'listening' || desired === 'followup') && this.wakePaused()) return 'idle';
    return desired;
  }

  private metrics(turn: Turn, interrupted: boolean): VoiceTurnMetrics {
    const diff = (from: number | null, to: number | null) =>
      from === null || to === null ? null : Math.max(0, Math.round(to - from));
    return {
      turnId: turn.id,
      sttMs: turn.sttMs,
      firstSentenceMs: diff(turn.transcriptAt, turn.firstSentenceAt),
      ttsFirstAudioMs: diff(turn.firstSentenceAt, turn.firstAudioAt),
      endOfSpeechToFirstAudioMs: diff(turn.speechEndAt, turn.firstAudioAt),
      interrupted,
    };
  }

  private stagesOf(turn: Turn, interrupted: boolean): TurnStages {
    const metrics = this.metrics(turn, interrupted);
    return {
      turnId: turn.id,
      at: nowIso(),
      endSilenceMs: VOICE_TUNING.endSilenceMs,
      sttMs: metrics.sttMs,
      brainFirstSentenceMs: metrics.firstSentenceMs,
      ttsFirstAudioMs: metrics.ttsFirstAudioMs,
      totalMs: metrics.endOfSpeechToFirstAudioMs,
      interrupted,
      firstStreamId: turn.streams[0]?.id ?? null,
    };
  }

  /**
   * Süren turu bırakır: oynatma durur, kalan metin atılır, model isteği iptal edilir. Durum değiştirmez;
   * çağıran bir sonraki durumu seçer. Kesilen turun dökümü, çalınan süre öğrenilince düzeltilir.
   */
  private abandonTurn(): void {
    this.epoch++;
    this.clearTimer('stall');
    this.clearTimer('guard');
    this.clearTimer('progress');
    const turn = this.turn;
    this.turn = null;
    this.endVerify(false);
    this.deps.io.stopPlayback();
    if (!turn) return;
    turn.interrupted = true;
    turn.running.clear();
    if (turn.kind === 'turn') this.emitActivity(null);
    this.lastInterrupted = {
      sentences: turn.streams.flatMap((stream) => stream.sentences.map((sentence) => sentence.text)),
      firstAudioAt: turn.streams.reduce<number | null>((at, stream) => at ?? stream.startedAt, null),
      at: performance.now(),
    };
    turn.abort.abort();
    turn.resolveSpoken?.({ spoken: turn.streams.some((stream) => stream.started) });
    if (turn.kind === 'turn') {
      this.detached.add(turn);
      this.lastStages = this.stagesOf(turn, true);
      this.deps.bus.emit('voice.turn', this.metrics(turn, true));
      // Çalma raporu ya da beyin sonucu hiç gelmezse bile bekleyen kayıt birikmesin.
      setTimeout(() => this.detached.delete(turn), 60_000).unref?.();
    }
  }

  /** Kesilen turun asistan iletisini yalnız gerçekten söylenen kısma indirir ("yarıda kesildi"). */
  private amendInterrupted(turn: Turn): void {
    if (turn.amended || turn.assistantMessageId === null) return;
    if (turn.streams.some((stream) => stream.started && !stream.done)) return;
    turn.amended = true;
    this.detached.delete(turn);
    const spoken: string[] = [];
    for (const stream of turn.streams) {
      if (!stream.started) continue;
      let offset = 0;
      for (const sentence of stream.sentences) {
        if (stream.interrupted && (sentence.audioMs === null || offset >= stream.playedMs)) break;
        // Oturumun kendi ilerleme cümlesi beynin yanıtı değildir: dökümdeki iletiye yazılmaz.
        if (!sentence.progress) spoken.push(sentence.text);
        offset += sentence.audioMs ?? 0;
      }
    }
    try {
      this.deps.conversation.amendMessage(turn.assistantMessageId, { text: spoken.join(' '), interrupted: true });
    } catch (error) {
      this.deps.log.warn('kesilen yanıt dökümde düzeltilemedi', error);
    }
  }

  /**
   * Tur gerçekten dondu: `limit` boyunca hiçbir etkinlik yok (ne cümle, ne model metni, ne araç olayı). Tur kesilir,
   * NE olduğu söylenir ("… adımı 300 saniyedir bitmedi"), sohbet AÇIK kalır ve söz "yeniden dene" ile yinelenebilir.
   */
  private onStall(limit: number): void {
    const turn = this.turn;
    if (!turn || turn.finished || turn.approval) return;
    const idleFor = performance.now() - Math.max(turn.lastActivityAt, this.audioUntil);
    if (idleFor < limit - 50) return this.armStall();
    const step = [...turn.running.values()].at(-1)?.step ?? null;
    const seconds = Math.round(idleFor / 1000);
    this.deps.log.warn(`tur ${Math.round(idleFor)} ms hiçbir etkinlik göstermedi${step ? ` (adım: ${[...turn.running.values()].at(-1)?.name})` : ''}; kesiliyor`);
    const userText = turn.userText;
    this.abandonTurn();
    const message = step ? t('turn.frozenTool', { step, seconds }) : t('turn.frozen', { seconds });
    if (userText) this.retryable = { text: userText, offeredAt: performance.now() };
    this.reportError('timeout', message, userText !== null);
    this.say(message, { state: this.conversation ? 'listening' : 'followup', reason: 'timeout' });
  }

  /** "Dur / sus / iptal / vazgeç": süren iş ve konuşma kesilir. İş yürüyorduysa sohbet açık kalır (yeni söz beklenir). */
  private stopByVoice(turn: Turn | null): void {
    const worked = turn !== null && turn.kind === 'turn' && (turn.running.size > 0 || turn.toolsDone > 0);
    this.abandonTurn();
    if (worked) this.deps.log.info('iş kullanıcının sözüyle durduruldu');
    this.setState(worked && !this.meeting ? 'followup' : 'idle', 'stop_word');
  }

  /** Hat hatası (STT, iç hata): olay bırakılır, kısa bir cümle söylenir; sohbet açık kalır (yeniden söylenebilsin). */
  private fail(code: string, message: string): void {
    const open = this.state !== 'idle' && this.state !== 'mic_off';
    this.abandonTurn();
    this.reportError(code, message);
    this.say(message, open && !this.meeting ? { state: this.conversation ? 'listening' : 'followup', reason: 'error' } : { state: 'idle', reason: 'error' });
  }

  /** Sistem cümlesi: hemen söylenir (sıra beklemez), bitince `after` durumuna geçilir. */
  private say(text: string, after: Turn['after'], resolve: Turn['resolveSpoken'] = null): void {
    const turn = this.newTurn('system');
    turn.after = after;
    turn.resolveSpoken = resolve;
    this.turn = turn;
    this.audioUntil = 0;
    this.pushSentence(turn, text);
    if (turn.streams.length > 0 && this.state !== 'speaking') this.setState('speaking', 'api');
    this.finishTurn(turn);
  }

  private findStream(streamId: string): { turn: Turn; stream: Stream } | null {
    for (const turn of [this.turn, ...this.detached]) {
      const stream = turn?.streams.find((item) => item.id === streamId);
      if (turn && stream) return { turn, stream };
    }
    return null;
  }

  // ───────────────────────────── oynatma olayları ─────────────────────────────

  onTtsSentence(streamId: string, index: number, audioMs: number): void {
    const found = this.findStream(streamId);
    if (!found) return;
    const sentence = found.stream.sentences[index];
    if (sentence) sentence.audioMs = audioMs;
    if (found.turn !== this.turn) return;
    if (sentence && found.turn.kind === 'turn') {
      this.deps.bus.emit('voice.partial', { turnId: found.turn.id, role: 'assistant', text: stripExpressionTags(sentence.text), final: false });
    }
    this.audioUntil = Math.max(this.audioUntil, performance.now()) + audioMs;
    // İş sürerken durum "düşünüyor"a dönmüştü ve akış zaten çalıyordu: yeni cümleyle yeniden "konuşuyor" (son cümle
    // beyin bittikten sonra sentezlense de).
    if (this.state === 'thinking' && found.stream.started && found.turn.kind === 'turn' && !found.turn.approval) this.setState('speaking', 'first_audio');
    if (found.turn.finished) this.armGuard(found.turn);
    else if (!found.turn.approval) {
      this.armStall();
      this.armProgress(found.turn);
      this.armSettle(found.turn);
    }
  }

  onTtsError(streamId: string, detail: string): void {
    const found = this.findStream(streamId);
    if (!found || found.turn !== this.turn) return;
    this.deps.log.warn(`seslendirme başarısız: ${detail}`);
    this.reportError('tts', t('voice.error.tts'));
    // Söylenemeyen cümleler adaya yazıyla düşer.
    for (const sentence of found.stream.sentences) {
      if (sentence.audioMs !== null) continue;
      sentence.audioMs = 0;
      this.deps.bus.emit('voice.partial', { turnId: found.turn.id, role: 'assistant', text: stripExpressionTags(sentence.text), final: false });
    }
  }

  onPlaybackStarted(streamId: string): void {
    const found = this.findStream(streamId);
    if (!found) return;
    found.stream.started = true;
    found.stream.startedAt ??= performance.now();
    // Söz sürerken Jarvis konuşmaya başladı: o sözün kalanına kendi sesi karışır.
    if (this.speechActive && this.segment) this.segment.suspect = true;
    const turn = found.turn;
    if (turn !== this.turn) return;
    if (turn.firstAudioAt === null) turn.firstAudioAt = performance.now();
    if (this.state === 'thinking') this.setState('speaking', 'first_audio');
  }

  onPlaybackEnded(streamId: string, playedMs: number, interrupted: boolean): void {
    if (playedMs > 0) this.playbackEndedAt = performance.now();
    const found = this.findStream(streamId);
    if (!found) return;
    const { turn, stream } = found;
    stream.done = true;
    stream.interrupted = interrupted;
    stream.playedMs = playedMs;
    if (playedMs > 0) stream.started = true;
    if (turn.interrupted) {
      this.amendInterrupted(turn);
      return;
    }
    if (turn !== this.turn) return;
    if (turn.approval && turn.approval.stream === stream) {
      // Soru soruldu: yanıt uyandırma sözü olmadan dinlenir.
      if (this.state !== 'listening') this.setState('listening', 'api');
      return;
    }
    if (turn.finished && turn.streams.every((item) => item.done)) this.completeTurn(turn);
  }

  // ───────────────────────────── VoiceApi ─────────────────────────────

  startListening(trigger: 'hotkey' | 'island' | 'api'): void {
    const gate = this.gate();
    if (gate !== null) {
      this.reportError(gate, t(gate === 'kill_switch' ? 'voice.error.killSwitch' : 'voice.error.updateRequired'));
      return;
    }
    if (!this.ready) {
      this.reportError('not_ready', this.notReadyReason ?? t('voice.notReady'));
      return;
    }
    if (this.micMuted) this.unmuteMic();
    // Onay sorusu okunurken bas-konuş: yalnız soru susar, onay bekler ve yanıt hemen dinlenir (iş iptal edilmez).
    if (this.turn?.approval && this.turn.kind === 'turn') {
      this.cutPlayback(this.turn);
      this.setState('listening', trigger);
      return;
    }
    // Yeni söz eskisinin yerini alır: süren yanıt kesilir.
    if (this.turn || this.state === 'thinking' || this.state === 'speaking') this.abandonTurn();
    this.prewarm();
    this.setState('listening', trigger);
  }

  stopSpeaking(): void {
    // "Sustur" sessizlik demektir: sırada bekleyen bildirim cümleleri de atılır (yoksa durum takip penceresine döner
    // dönmez sıradaki cümle söylenir ve Jarvis "konuşuyor"da kalmış görünürdü). Bildirimin kendisi görünür kalır.
    for (const item of this.speakQueue.splice(0)) item.resolve({ spoken: false });
    if (!this.turn && this.state !== 'thinking' && this.state !== 'speaking') return;
    // Onay sorusu okunurken "Sustur": soru susar, onay kartı ve dinleme sürer.
    if (this.turn?.approval && this.turn.kind === 'turn') {
      this.cutPlayback(this.turn);
      this.setState(this.micMuted ? 'mic_off' : 'listening', 'api');
      return;
    }
    this.abandonTurn();
    this.setState(this.micMuted ? 'mic_off' : 'followup', 'api');
  }

  /**
   * "Bildirimi kapat / Sustur" (ada kartının ✕'i ve sol paneldeki Hızlı kontrol, d10). `stopSpeaking`'ten farkı: çentik
   * de kapanmalıdır. Kök neden (şikâyet: "basınca hem susmuyor hem çentik gitmiyor"): kartın ✕'i yalnız bildirim kaydını
   * kapatıyordu, duyuru ses hattında sürüyordu ve ada "konuşuyor" görünümüne düşüyordu; susturulsa bile `stopSpeaking`
   * hattı takip penceresine (`followup`) götürür ve çentik "dinliyorum" diye açık kalırdı. Burada: sıradaki duyurular
   * atılır, konuşma (duyuru ya da turun yanıtı) kesilir, hat boşa döner (sohbet kipinde dinlemeye). Konuşmayan, çalışan
   * iş (düşünüyor) kesilmez; onay bekleyen soru yalnız susar (onay kartı karar ister).
   */
  hush(): void {
    for (const item of this.speakQueue.splice(0)) item.resolve({ spoken: false });
    if (this.turn?.approval && this.turn.kind === 'turn') return this.stopSpeaking();
    const rest: VoiceState = this.micMuted ? 'mic_off' : this.conversation ? 'listening' : 'idle';
    if (this.state === 'speaking' || this.turn?.kind === 'system') {
      this.abandonTurn();
      this.setState(rest, 'api');
      return;
    }
    if (this.state === 'followup') this.setState(rest, 'api');
  }

  /**
   * Turu bırakmadan çalmayı keser (onay sorusu susturuldu). Kesilen akışların bitişi ses penceresinden gelmeyebilir:
   * sesi henüz pencereye ulaşmamış akışı işçi iptalle atar ve pencere onu hiç tanımaz. Akışlar burada bitmiş sayılır;
   * yoksa tur sonunda bütün akışların bitmesi beklenir ve durum, bekçi süresi dolana dek (cümle başına 8 sn)
   * "konuşuyor"da kalırdı (demo.5: "hızlı Dur" sonrası takılma).
   */
  private cutPlayback(turn: Turn): void {
    this.deps.io.stopPlayback();
    for (const stream of turn.streams) {
      if (stream.done) continue;
      stream.done = true;
      stream.interrupted = true;
    }
    if (turn.open?.done) turn.open = null;
  }

  /** "Yeniden dene" (ada düğmesi): yanıtı kesilen ya da başarısız olan son söz yeniden yürütülür. Yürütüldüyse `true`. */
  retryLast(): boolean {
    const retry = this.retryable;
    if (!retry || !this.ready || this.gate() !== null) return false;
    this.retryable = null;
    if (this.turn || this.state === 'thinking' || this.state === 'speaking') this.abandonTurn();
    this.setState('thinking', 'api');
    void this.runTurn(retry.text, performance.now(), 0);
    return true;
  }

  cancelTurn(reason: VoiceStateReason = 'api'): void {
    this.abandonTurn();
    for (const item of this.speakQueue.splice(0)) item.resolve({ spoken: false });
    if (this.conversation) {
      this.conversation = false;
      this.emitStatus();
    }
    this.setState(this.micMuted ? 'mic_off' : 'idle', reason);
  }

  muteMic(options: { minutes?: number } = {}): void {
    const minutes = options.minutes && options.minutes > 0 ? options.minutes : null;
    this.micMutedUntil = minutes ? (new Date(Date.now() + minutes * 60_000).toISOString() as IsoDateTime) : null;
    if (minutes) this.setTimer('mute', minutes * 60_000, () => this.unmuteMic());
    else this.clearTimer('mute');
    const already = this.micMuted;
    this.micMuted = true;
    this.deps.io.setCapture(false);
    this.speechActive = false;
    this.segment = null;
    this.emitStatus();
    if (already) return;

    // Tur sürüyorsa (kapatmayı araç istedi) yanıt tamamlanır, sonra `mic_off`; onayı model söyler.
    const inTurn = this.turn !== null || this.state === 'thinking';
    if (inTurn) return;
    this.epoch++;
    this.setState('mic_off', 'mute');
    // Ayardaki değer gerçekte kayıtlı kısayoldur (`core/hotkeys.ts`); boşsa hiçbir tuş alınamamıştır.
    const hotkey = this.deps.settings.get().hotkeys.mute.replace(/CommandOrControl|Control/g, 'Ctrl');
    void this.speak(hotkey ? t('voice.mic.muted', { hotkey }) : t('voice.mic.mutedNoHotkey'));
  }

  unmuteMic(): void {
    if (!this.micMuted) return;
    this.micMuted = false;
    this.micMutedUntil = null;
    this.clearTimer('mute');
    if (this.ready) this.deps.io.setCapture(true);
    if (this.state === 'mic_off') this.setState('idle', 'unmute');
    else this.syncWake();
    this.emitStatus();
  }

  pauseWake(minutes: number): void {
    if (!(minutes > 0)) return this.resumeWake();
    this.wakePausedUntil = new Date(Date.now() + minutes * 60_000).toISOString() as IsoDateTime;
    this.setTimer('wakePause', minutes * 60_000, () => this.resumeWake());
    this.syncWake();
    this.emitStatus();
  }

  resumeWake(): void {
    this.wakePausedUntil = null;
    this.clearTimer('wakePause');
    this.syncWake();
    this.emitStatus();
  }

  setQuiet(on: boolean): void {
    this.quiet = on;
    this.emitStatus();
  }

  startConversation(): boolean {
    // Toplantı kipinde sohbet kipi açılmaz (toplantının sözleri komut sanılmasın).
    if (!this.deps.policy.get().voice.conversationMode || !this.ready || this.meeting) return false;
    this.conversation = true;
    this.emitStatus();
    this.startListening('api');
    return true;
  }

  endConversation(): void {
    if (!this.conversation) return;
    this.cancelTurn('api');
  }

  /** Bildirim ya da deneme metni. Süren tur varsa bitmesini bekler; söylenen metin sesli döküme yazılır. */
  speak(text: string): Promise<{ spoken: boolean }> {
    return this.enqueueSpeech(text, true);
  }

  /** `record: false`: metin seslendirilir ama sesli oturumun dökümüne yazılmaz (başka oturuma ait onay sorusu). */
  private enqueueSpeech(text: string, record: boolean): Promise<{ spoken: boolean }> {
    const clean = text.trim();
    if (!hasWords(clean) || this.quiet || this.meeting || !this.ready || !this.deps.io.canSpeak() || this.gate() !== null) {
      return Promise.resolve({ spoken: false });
    }
    return new Promise((resolve) => {
      this.speakQueue.push({ text: clean, record, resolve });
      this.pumpSpeakQueue();
    });
  }

  private pumpSpeakQueue(): void {
    // Kullanıcı konuşurken ya da komutu işlenirken araya girilmez; durum boşa dönünce yeniden denenir.
    // Sohbet kipinde durum hep "dinliyor"dur: orada bildirim, söz yokken araya girer (yoksa kip bitene dek bekler).
    if (this.turn || this.speechActive || this.state === 'thinking') return;
    if (this.state === 'listening' && !this.conversation) return;
    const item = this.speakQueue.shift();
    if (!item) return;
    if (item.record) {
      try {
        const session = this.deps.conversation.currentSession('voice');
        this.deps.conversation.appendMessage({ sessionId: session.id, role: 'assistant', text: item.text, channel: 'voice' });
      } catch (error) {
        this.deps.log.debug('seslendirilen metin döküme yazılamadı', error);
      }
    }
    this.say(item.text, null, item.resolve);
  }
}
