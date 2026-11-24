/**
 * Gerçek zamanlı ses denetleyicisi: `RealtimeSession` (OpenAI soketi) ile ses servisinin (`index.ts`) parçalarını
 * birbirine bağlar. `voice.engine === 'openai-realtime'` iken cascade yerine bu çalışır. Mevcut hattan ÖDÜNÇ alır:
 * uyandırma sözü (sezici), mikrofon VAD bölütleri ve gizli ses penceresinin oynatması. Böylece Sustur, mikrofon
 * kapatma ve uyandırma sözü realtime'da da tutarlıdır.
 *
 * Akış: uyandırma → `onWake` (dinleme açılır) → kullanıcının söz bölütü `onUtterance` ile OpenAI'ye (16 kHz → 24 kHz,
 * append + commit + response.create) → dönen ses oynatma yoluna (`play`) → yanıt bitince takip penceresi. Kullanıcı
 * konuşunca (`onUserSpeechStart`) modelin sesi kesilir (araya girme). Durum ve ara metin olay akışıyla adaya düşer.
 *
 * SAF değil ama Electron'a doğrudan dokunmaz: oynatma, durdurma, olay yayını ve anahtar/persona okuması dışarıdan
 * verilir (`RealtimeControllerDeps`); birim olarak sahte bağımlılıklarla sınanır.
 */

import { newId, type VoiceState, type VoiceStateReason } from '@fuber/shared';
import { RealtimeSession, REALTIME_SAMPLE_RATE, resamplePcm, type RealtimeConfig, type RealtimeTransport } from './realtime';

export interface RealtimeControllerDeps {
  /** Gerçek soketi açan taşıma (gerçek: `ws`; sınama: sahte). */
  transport: RealtimeTransport;
  /** OpenAI anahtarı (kasadan / politikadan); yoksa `null`. */
  getKey(): string | null | undefined;
  /** Oturum ayarı: model, ses ve persona istemi (politika + persona). */
  getConfig(): RealtimeConfig;
  /** Çıkış sesini gizli ses penceresinde çalar (24 kHz mono PCM16). `end`: akışın son parçası. */
  play(streamId: string, sampleRate: number, pcm: Int16Array, end: boolean): void;
  /** Çalmayı hemen keser (araya girme / sustur). */
  stopPlayback(): void;
  /** Kısa uyarı sesi (uyandırma / duydum); yoksa sessiz. */
  earcon?(kind: 'wake' | 'heard'): void;
  /** Durum geçişi (`voice.state`): ada, tepsi, ana pencere dinler. */
  emitState(state: VoiceState, prev: VoiceState, reason: VoiceStateReason): void;
  /** Ara/son metin (`voice.partial`): adaya/sohbete düşer. */
  emitPartial(turnId: string, role: 'user' | 'assistant', text: string, final: boolean): void;
  /** Hata (`voice.error`): kullanıcıya bilgi. */
  reportError(code: string, message: string): void;
  /** Takip dinleme süresi (sn): yanıttan sonra uyandırma sözü olmadan konuşmaya devam. */
  followUpSeconds(): number;
  log: { info(msg: string): void; warn(msg: string, err?: unknown): void; error(msg: string, err?: unknown): void };
  /** Mikrofonun örnekleme hızı (işçi çerçeveleri 16 kHz). */
  inputRate?: number;
}

type Timer = ReturnType<typeof setTimeout>;

export class RealtimeController {
  private engine: RealtimeSession | null = null;
  private running = false;
  private state: VoiceState = 'idle';
  /** Dinleme açık (uyandırma sonrası ya da takip penceresinde): sıradaki söz bölütü OpenAI'ye gider. */
  private armed = false;
  private micMuted = false;
  /** Süren yanıtın oynatma akışı; ilk ses parçasında oluşur. */
  private streamId: string | null = null;
  private turnId: string = newId();
  /** Asistanın birikmekte olan metni (son olduğunda döküme/adaya tam düşer). */
  private assistantText = '';
  private followTimer: Timer | null = null;
  private listenTimer: Timer | null = null;

  constructor(private readonly deps: RealtimeControllerDeps) {}

  /** Motor çalışıyor ve kullanıma hazır mı (worker olayları buna göre yönlendirilir). */
  active(): boolean {
    return this.running;
  }

  /** Soketi açar (anahtar yoksa hata verir, cascade'e bırakılmaz ama uyarılır). */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.engine = new RealtimeSession(
      this.deps.transport,
      () => this.deps.getKey(),
      () => this.deps.getConfig(),
      {
        onAudio: (pcm) => this.onAudio(pcm),
        onAudioDone: () => this.finishResponseAudio(),
        onAssistantText: (text, final) => this.onAssistantText(text, final),
        onUserTranscript: (text, final) => this.deps.emitPartial(this.turnId, 'user', text, final),
        onSpeechStarted: () => this.onUserSpeechStart(),
        onResponseDone: (cancelled) => this.onResponseDone(cancelled),
        onError: (error) => this.onEngineError(error),
        onReady: () => this.deps.log.info('gerçek zamanlı oturum hazır'),
        onClose: (reconnecting) => {
          if (!reconnecting) this.deps.log.info('gerçek zamanlı oturum kapandı');
        },
        log: (level, message) => this.deps.log[level](message),
      },
    );
    this.engine.start();
  }

  /** Soketi kapatır ve durumu sıfırlar. */
  stop(): void {
    this.running = false;
    this.clearTimers();
    this.armed = false;
    this.engine?.stop();
    this.engine = null;
    this.endStream();
    this.setState('idle', 'api');
  }

  /** Politika/persona değişti: yeni ayarla yeniden kurar (model/ses/istem güncellensin). */
  reconfigure(): void {
    if (!this.running) return;
    this.stop();
    this.start();
  }

  /** Uyandırma sözü algılandı: dinleme açılır, sıradaki söz OpenAI'ye gider. */
  onWake(): void {
    if (!this.running || this.micMuted) return;
    // Konuşurken uyandırma = araya girme + yeni tur.
    if (this.state === 'speaking' || this.state === 'thinking') this.interruptPlayback();
    this.deps.earcon?.('wake');
    this.arm('wake');
  }

  /** Kullanıcı konuşmaya başladı (işçi VAD ya da sunucu VAD): model konuşuyorsa sesi kesilir. */
  onUserSpeechStart(): void {
    if (!this.running) return;
    if (this.state === 'speaking' || this.state === 'thinking') this.interruptPlayback();
  }

  /**
   * Mikrofon söz bölütü bitti (işçi `speech_end`, 16 kHz mono). Dinleme açıksa OpenAI'ye gönderilir. Dinleme kapalıysa
   * (uyandırma beklenmemiş) yok sayılır: cascade'deki gibi uyandırma sözü gerekir.
   */
  onUtterance(pcm: Int16Array): void {
    if (!this.running || this.micMuted || !this.armed || !this.engine) return;
    if (pcm.length === 0) return;
    this.clearTimers();
    this.armed = false;
    // Yeni tur: ara metin birikimi sıfırlanır.
    this.turnId = newId();
    this.assistantText = '';
    const rate = this.deps.inputRate ?? 16_000;
    const resampled = resamplePcm(pcm, rate, REALTIME_SAMPLE_RATE);
    this.engine.appendAudio(resampled);
    this.engine.commit();
    this.engine.createResponse();
    this.setState('thinking', 'speech_end');
  }

  /** Sustur: süren yanıt ve çalma kesilir; dinlemeye dönülmez (boşta). */
  hush(): void {
    if (!this.running) return;
    this.interruptPlayback();
    this.clearTimers();
    this.armed = false;
    this.setState('idle', 'stop_word');
  }

  /** Mikrofon kapatma: söz işlenmez, süren yanıt kesilir. */
  setMicMuted(on: boolean): void {
    this.micMuted = on;
    if (!this.running) return;
    if (on) {
      this.interruptPlayback();
      this.clearTimers();
      this.armed = false;
      this.setState('mic_off', 'mute');
    } else if (this.state === 'mic_off') {
      this.setState('idle', 'unmute');
    }
  }

  /** Oynatma penceresi akışın bittiğini bildirdi: tur kapanır, takip penceresi açılır. */
  onPlaybackEnded(streamId: string): void {
    if (streamId !== this.streamId) return;
    this.endStream();
    if (this.running && this.state === 'speaking') this.openFollowUp();
  }

  // ───────────────────────────── içeride ─────────────────────────────

  private onAudio(pcm: Int16Array): void {
    if (!this.running) return;
    if (this.streamId === null) {
      this.streamId = `rt-${newId()}`;
      this.setState('speaking', 'first_audio');
    }
    this.deps.play(this.streamId, REALTIME_SAMPLE_RATE, pcm, false);
  }

  private finishResponseAudio(): void {
    if (this.streamId !== null) this.deps.play(this.streamId, REALTIME_SAMPLE_RATE, new Int16Array(0), true);
  }

  private onAssistantText(text: string, final: boolean): void {
    if (!this.running) return;
    if (final) {
      // Son metin tam gelir (`..._transcript.done`); yoksa deltalardan biriktirilen kullanılır.
      this.assistantText = text.trim() || this.assistantText.trim();
      this.deps.emitPartial(this.turnId, 'assistant', this.assistantText, true);
    } else {
      this.assistantText += text;
      this.deps.emitPartial(this.turnId, 'assistant', this.assistantText, false);
    }
  }

  private onResponseDone(cancelled: boolean): void {
    if (!this.running) return;
    // Ses hiç gelmediyse (yalnız metin ya da boş yanıt) tur burada kapanır.
    if (this.streamId === null && !cancelled) this.openFollowUp();
  }

  private onEngineError(error: { code: string; message: string; fatal: boolean }): void {
    this.deps.reportError(error.code, error.message);
    if (error.fatal) {
      this.running = false;
      this.clearTimers();
      this.endStream();
      this.setState('idle', 'error');
    }
  }

  /** Çalmayı ve süren yanıtı keser (araya girme / sustur / mikrofon kapatma). */
  private interruptPlayback(): void {
    this.engine?.interrupt();
    this.deps.stopPlayback();
    this.endStream();
  }

  private endStream(): void {
    this.streamId = null;
  }

  /** Dinlemeyi açar (uyandırma ya da takip): bir süre söz beklenir, gelmezse boşta. */
  private arm(reason: VoiceStateReason): void {
    this.clearTimers();
    this.armed = true;
    this.setState('listening', reason);
    // Uyandırma sonrası kısa dinleme penceresi: söz gelmezse boşa döner.
    this.listenTimer = setTimeout(() => {
      if (this.armed && this.state === 'listening') {
        this.armed = false;
        this.setState('idle', 'no_speech');
      }
    }, 8_000);
    this.listenTimer.unref?.();
  }

  /** Yanıttan sonra takip penceresi: uyandırma sözü olmadan konuşmaya devam. */
  private openFollowUp(): void {
    this.endStream();
    this.clearTimers();
    const seconds = Math.max(0, this.deps.followUpSeconds());
    if (seconds === 0) {
      this.setState('idle', 'followup_timeout');
      return;
    }
    this.armed = true;
    this.setState('followup', 'speech_done');
    this.followTimer = setTimeout(() => {
      if (this.armed && this.state === 'followup') {
        this.armed = false;
        this.setState('idle', 'followup_timeout');
      }
    }, seconds * 1000);
    this.followTimer.unref?.();
  }

  private clearTimers(): void {
    if (this.followTimer !== null) {
      clearTimeout(this.followTimer);
      this.followTimer = null;
    }
    if (this.listenTimer !== null) {
      clearTimeout(this.listenTimer);
      this.listenTimer = null;
    }
  }

  private setState(state: VoiceState, reason: VoiceStateReason): void {
    if (state === this.state) return;
    const prev = this.state;
    this.state = state;
    this.deps.emitState(state, prev, reason);
  }
}
