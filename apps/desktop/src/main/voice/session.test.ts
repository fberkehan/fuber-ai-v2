import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_POLICY,
  defaultSettings,
  t,
  type ApprovalInput,
  type ApprovalRequest,
  type AuthorityState,
  type BrainResponse,
  type BusEvents,
  type ChatMessage,
  type Policy,
  type Settings,
  type ToolCallEvent,
  type TurnRequest,
  type TurnResult,
} from '@fuber/shared';
import { interpretApprovalSpeech } from '../core/tools';
import { VoiceSession, type SessionDeps } from './session';
import { VOICE_TUNING } from './tuning';
import { SttError, type SttResult } from './stt/types';

type AnyEvent = { [K in keyof BusEvents]: { type: K; payload: BusEvents[K] } }[keyof BusEvents];

interface PendingTurn {
  request: TurnRequest;
  /** Beynin bir cümle üretmesi. */
  say(sentence: string): void;
  /** Turu bitirir (varsayılan: başarıyla). */
  finish(response?: Partial<BrainResponse>): void;
}

function setup(policyPatch: (policy: Policy) => void = () => {}) {
  const policy = structuredClone(DEFAULT_POLICY) as Policy;
  policyPatch(policy);
  const events: AnyEvent[] = [];
  /** Ayarlar (sınama değiştirebilir: ortam dinleme rızası). */
  const settings = defaultSettings('C:/x');
  const io = {
    calls: [] as string[],
    spoken: [] as Array<{ streamId: string; text: string }>,
    ended: [] as string[],
    transcripts: [] as Array<string | Error>,
    canSpeak: true,
    /** Seslendirme bağlantısı ısıtmaları ve beyin ısıtmaları. */
    speechPrewarms: 0,
    brainPrewarms: 0,
    /** Kısa söz izleyicinin aç/kapa çağrıları. */
    watch: [] as boolean[],
    /** Sıradaki yazıya çevirme sonucu (verilmişse `transcripts`'ten önce kullanılır). */
    results: [] as SttResult[],
  };
  const turns: PendingTurn[] = [];
  /** Sürüm kapısı (zorunlu güncelleme) açık mı. */
  const gate = { updateRequired: false };
  /** Sesli döküme yazılan (seslendirilen) metinler. */
  const appended: string[] = [];
  const amends: Array<{ id: string; text?: string; interrupted?: boolean }> = [];
  const approvals = {
    pending: [] as ApprovalRequest[],
    resolved: [] as Array<{ id: string; decision: string; by: string }>,
    /** Araç servisine sorulan sözler ve hangi onay için soruldukları. */
    speech: [] as Array<{ text: string; approvalId: string | null }>,
  };

  /** Yetki servisi (araç kapısının yüzü): düzey, geçici yükseltme, oturumun istediği onaylar. */
  const authority = {
    state: { level: 'smart', base: 'smart', max: 'full', grant: null } as AuthorityState,
    grants: [] as Array<{ minutes: number } | { task: true } | null>,
    endTasks: 0,
    /** Oturumun `requestApproval` ile istediği onaylar; sınama `settle` ile sonuçlandırır. */
    requests: [] as Array<{ input: ApprovalInput; settle(decision: 'approved' | 'denied' | 'expired'): void }>,
    updates: [] as Array<Partial<Settings>>,
  };

  const message = (role: ChatMessage['role'], text: string): ChatMessage => ({
    id: `${role}-${turns.length}`,
    sessionId: 's1',
    role,
    text,
    channel: 'voice',
    at: '2026-11-16T00:00:00.000Z',
    interrupted: false,
    toolCalls: [],
  });

  const deps: SessionDeps = {
    policy: { get: () => policy, killSwitchActive: () => policy.killSwitch.active, updateRequired: () => gate.updateRequired } as SessionDeps['policy'],
    settings: {
      get: () => settings,
      update: (patch: Partial<Settings>) => {
        authority.updates.push(patch);
        Object.assign(settings, patch);
        return settings;
      },
    } as SessionDeps['settings'],
    tools: {
      authority: () => authority.state,
      grantAuthority: (grant: { minutes: number } | { task: true } | null) => {
        authority.grants.push(grant);
        return true;
      },
      endTask: () => void authority.endTasks++,
      requestApproval: (input: ApprovalInput) =>
        new Promise((resolve) => {
          authority.requests.push({ input, settle: resolve });
        }),
      pendingApprovals: () => approvals.pending,
      resolveApproval: (id: string, decision: string, by: string) => {
        approvals.resolved.push({ id, decision, by });
        approvals.pending = approvals.pending.filter((item) => item.id !== id);
        return true;
      },
      // Araç servisinin kuralı (core/tools.ts) gerçek sınıflandırıcıyla: kimlik verildiyse yalnız o onay,
      // verilmediyse yalnız tek bekleyen onay sonuçlanır.
      resolveApprovalFromSpeech: (text: string, opts?: { approvalId?: string }) => {
        approvals.speech.push({ text, approvalId: opts?.approvalId ?? null });
        const target =
          opts?.approvalId !== undefined
            ? approvals.pending.find((item) => item.id === opts.approvalId)
            : approvals.pending.length === 1
              ? approvals.pending[0]
              : undefined;
        if (!target) return 'unclear';
        const verdict = interpretApprovalSpeech(text, { asked: (opts as { asked?: boolean } | undefined)?.asked === true });
        if (verdict !== 'unclear') {
          approvals.resolved.push({ id: target.id, decision: verdict, by: 'voice' });
          approvals.pending = approvals.pending.filter((item) => item.id !== target.id);
        }
        return verdict;
      },
    } as unknown as SessionDeps['tools'],
    brain: {
      prewarm: async () => {
        io.brainPrewarms++;
      },
    } as unknown as SessionDeps['brain'],
    conversation: {
      turn: (request: TurnRequest) =>
        new Promise<TurnResult>((resolve) => {
          const said: string[] = [];
          turns.push({
            request,
            say(sentence) {
              said.push(sentence);
              request.onSentence?.(sentence);
            },
            finish(response = {}) {
              resolve({
                sessionId: 's1',
                userMessage: message('user', request.text),
                assistantMessage: message('assistant', said.join(' ')),
                response: {
                  text: said.join(' '),
                  stopReason: request.signal?.aborted ? 'aborted' : 'end',
                  error: null,
                  toolCalls: [],
                  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0 },
                  ...response,
                },
              });
            },
          });
        }),
      amendMessage: (id: string, patch: { text?: string; interrupted?: boolean }) => {
        amends.push({ id, ...patch });
        return null;
      },
      appendMessage: (input: { text: string }) => {
        appended.push(input.text);
        return message('assistant', input.text);
      },
      currentSession: () => ({ id: 's1' }),
    } as unknown as SessionDeps['conversation'],
    bus: {
      emit: (type: string, payload: unknown) => events.push({ type, payload } as AnyEvent),
      on: () => () => {},
      once: () => () => {},
      onAny: () => () => {},
    } as unknown as SessionDeps['bus'],
    log: { debug() {}, info() {}, warn() {}, error() {}, child: () => deps.log } as SessionDeps['log'],
    io: {
      setCapture: (on) => void io.calls.push(`capture:${on}`),
      setWake: (on) => void io.calls.push(`wake:${on}`),
      speak: (streamId, text) => {
        io.calls.push('speak');
        io.spoken.push({ streamId, text });
      },
      endStream: (streamId) => {
        io.calls.push('end');
        io.ended.push(streamId);
      },
      stopPlayback: () => void io.calls.push('stop'),
      earcon: (kind) => void io.calls.push(`earcon:${kind}`),
      transcribe: async (): Promise<SttResult> => {
        io.calls.push('transcribe');
        const prepared = io.results.shift();
        if (prepared) {
          io.transcripts.shift();
          return prepared;
        }
        const next = io.transcripts.shift() ?? '';
        if (next instanceof Error) throw next;
        return { text: next, raw: next, dropped: next ? null : 'empty', durationMs: 120, languageConfidence: 1 };
      },
      canSpeak: () => io.canSpeak,
      prewarmSpeech: () => void io.speechPrewarms++,
      setStopWatch: (on) => void io.watch.push(on),
      cutSpeech: () => void io.calls.push('cut'),
      duck: (on) => void io.calls.push(on ? 'duck' : 'unduck'),
      selfInterrupted: () => void io.calls.push('self'),
    },
  };

  let segmentId = 0;
  const session = new VoiceSession(deps);
  session.setReady(true, null);

  const states = () => events.filter((event) => event.type === 'voice.state').map((event) => `${event.payload.state}:${event.payload.reason}`);
  const of = <K extends keyof BusEvents>(type: K): Array<BusEvents[K]> =>
    events.filter((event) => event.type === type).map((event) => event.payload as BusEvents[K]);
  const flush = () => vi.advanceTimersByTimeAsync(0);
  const pcm = new Int16Array(16_000);
  /** Sıradaki bölüt kimliği (söz başlangıcı ile bitişini ayrı ayrı süren sınamalar için). */
  const nextSegment = () => ++segmentId;
  /** Kullanıcı bir şey söyledi ve sustu; dökümü `text`. */
  const utter = async (text: string | Error, durationMs = 1200) => {
    io.transcripts.push(text);
    session.onSpeechStart(++segmentId);
    session.onSpeechEnd(segmentId, pcm, durationMs);
    await flush();
  };
  /** Son açılan akışın çalınması: başladı → (bütün cümleler `audioMs`) → bitti. */
  const play = async (audioMs = 1000, options: { finish?: boolean } = {}) => {
    const stream = io.spoken.at(-1)?.streamId ?? '';
    const sentences = io.spoken.filter((item) => item.streamId === stream);
    sentences.forEach((_, index) => session.onTtsSentence(stream, index, audioMs));
    session.onPlaybackStarted(stream);
    if (options.finish !== false) session.onPlaybackEnded(stream, audioMs * sentences.length, false);
    await flush();
    return stream;
  };

  return { session, policy, settings, events, io, turns, amends, approvals, gate, appended, states, of, flush, utter, play, pcm, nextSegment, authority };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('uyandırma', () => {
  it('sezici uyandırır; söz gelmezse 6 sn sonra sessizce boşa döner (yanlış uyanma)', async () => {
    const h = setup();
    h.session.onWake('hey jarvis', 0.3);
    expect(h.session.status().state).toBe('listening');
    expect(h.of('voice.wake')[0]).toMatchObject({ phrase: 'hey jarvis', path: 'kws' });

    await vi.advanceTimersByTimeAsync(5900);
    expect(h.session.status().state).toBe('listening');
    await vi.advanceTimersByTimeAsync(200);
    expect(h.states()).toEqual(['listening:wake', 'idle:no_speech']);
    expect(h.turns).toHaveLength(0);
    expect(h.io.spoken).toHaveLength(0);
    expect(h.of('voice.error')).toHaveLength(0);
  });

  it('Whisper yolu: boştayken söz adla başlıyorsa uyanır ve kalanı komut olarak işler', async () => {
    const h = setup();
    await h.utter('Carvis, saat kaç?');
    expect(h.of('voice.wake')[0]).toMatchObject({ path: 'whisper', score: 1 });
    expect(h.states()).toEqual(['listening:wake', 'thinking:speech_end']);
    expect(h.turns[0]?.request.text).toBe('saat kaç?');
    expect(h.turns[0]?.request.channel).toBe('voice');
  });

  it('yalnız ad söylenirse dinlemeye geçer, komutu sonraki sözden alır', async () => {
    const h = setup();
    await h.utter('Hey Jarvis');
    expect(h.session.status().state).toBe('listening');
    expect(h.turns).toHaveLength(0);
    await h.utter('yarın saat onda hatırlat');
    expect(h.turns[0]?.request.text).toBe('yarın saat onda hatırlat');
  });

  it('boştayken adla başlamayan ya da ek almış adla başlayan söz yok sayılır', async () => {
    const h = setup();
    await h.utter('bugün hava çok güzel');
    await h.utter("Jarvis'e söyle yarın gelsin");
    expect(h.states()).toEqual([]);
    expect(h.turns).toHaveLength(0);
  });

  it('boştayken çok uzun söz yazıya çevrilmez', async () => {
    const h = setup();
    await h.utter('Jarvis, …', 12_000);
    expect(h.io.calls).not.toContain('transcribe');
  });

  it('sezici duyduysa döküm adı yanlış yazsa da söz komuttan ayıklanır', async () => {
    const h = setup();
    h.io.transcripts.push('Hey Javis yarın saat onda hatırlat');
    h.session.onSpeechStart(1);
    h.session.onWake('hey jarvis', 0.3);
    h.session.onSpeechEnd(1, h.pcm, 3000);
    await h.flush();
    expect(h.turns[0]?.request.text).toBe('yarın saat onda hatırlat');
  });

  it('uyandırma duraklatılmışken ve mikrofon kapalıyken uyanmaz', async () => {
    const h = setup();
    h.session.pauseWake(10);
    h.session.onWake('hey jarvis', 0.3);
    await h.utter('Jarvis, saat kaç');
    expect(h.states()).toEqual([]);
    expect(h.session.status().wakePausedUntil).not.toBeNull();

    // Kısayol ve ada yine çalışır.
    h.session.startListening('hotkey');
    expect(h.session.status().state).toBe('listening');

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(h.session.status().wakePausedUntil).toBeNull();
  });

  it('d6: konuşurken sezici açıktır; adla seslenmek konuşmayı keser (her kipte)', async () => {
    const h = setup();
    await h.utter('Jarvis, bir hikaye anlat');
    h.turns[0]?.say('Bir varmış bir yokmuş.');
    await h.play(3000, { finish: false });
    expect(h.session.status()).toMatchObject({ state: 'speaking', bargeIn: 'voice' });
    expect(h.io.calls.filter((call) => call.startsWith('wake:')).at(-1)).toBe('wake:true');
    h.session.onWake('hey jarvis', 0.3);
    expect(h.io.calls).toContain('stop');
    expect(h.states().at(-1)).toBe('listening:barge_in');
  });

  it('d6: Jarvis kendi adını söylerken gelen sezici tetiği yok sayılır (kendi sesiyle uyanmaz)', async () => {
    const h = setup();
    await h.utter('Jarvis, kendini tanıt');
    h.turns[0]?.say('Ben Jarvis, size yardım etmek için buradayım.');
    await h.play(3000, { finish: false });
    h.session.onWake('hey jarvis', 0.3);
    expect(h.session.status().state).toBe('speaking');
    expect(h.io.calls).not.toContain('stop');
  });

  it('söz kesme kapalıyken (`off`) konuşurken sezici kapalıdır', async () => {
    const h = setup((policy) => {
      policy.voice.bargeIn = 'off';
    });
    await h.utter('Jarvis, bir hikaye anlat');
    h.turns[0]?.say('Bir varmış bir yokmuş.');
    await h.play(3000, { finish: false });
    expect(h.io.calls.filter((call) => call.startsWith('wake:')).at(-1)).toBe('wake:false');
    h.session.onWake('hey jarvis', 0.3);
    expect(h.session.status().state).toBe('speaking');
  });
});

describe('tur', () => {
  it('söz bitti → uyarı sesi → döküm → cümleler TTS’e → ilk seste konuşma → takip → boş', async () => {
    const h = setup();
    h.session.startListening('hotkey');
    await h.utter('yarın saat onda KDV beyannamesini hatırlat');
    expect(h.io.calls).toContain('earcon:heard');
    expect(h.session.status().state).toBe('thinking');
    expect(h.of('voice.partial')[0]).toMatchObject({ role: 'user', final: true });

    const turn = h.turns[0];
    turn?.say('Tamam efendim.');
    turn?.say('Yarın onda hatırlatacağım.');
    expect(h.io.spoken.map((item) => item.text)).toEqual(['Tamam efendim.', 'Yarın onda hatırlatacağım.']);
    expect(new Set(h.io.spoken.map((item) => item.streamId)).size).toBe(1);
    expect(h.session.status().state).toBe('thinking');

    const stream = h.io.spoken[0]?.streamId ?? '';
    h.session.onTtsSentence(stream, 0, 1200);
    h.session.onPlaybackStarted(stream);
    expect(h.session.status().state).toBe('speaking');

    turn?.finish();
    await h.flush();
    expect(h.io.ended).toEqual([stream]);
    expect(h.session.status().state).toBe('speaking');

    h.session.onTtsSentence(stream, 1, 1800);
    h.session.onPlaybackEnded(stream, 3000, false);
    expect(h.session.status().state).toBe('followup');
    expect(h.of('voice.turn')[0]).toMatchObject({ interrupted: false, sttMs: 120 });

    await vi.advanceTimersByTimeAsync(DEFAULT_POLICY.voice.followUpSeconds * 1000 + 50);
    expect(h.states()).toEqual([
      'listening:hotkey',
      'thinking:speech_end',
      'speaking:first_audio',
      'followup:speech_done',
      'idle:followup_timeout',
    ]);
  });

  it('dinleme süresi bu cihazın ayarıyla politikanınkini ezer (Hızlı kontrol: 5 / 10 / 20 / 40 sn)', async () => {
    const h = setup((policy) => {
      policy.voice.followUpSeconds = 5;
    });
    h.settings.followUpSeconds = 20;
    h.session.startListening('island');
    await h.utter('saat kaç');
    h.turns[0]?.say('Saat üç.');
    h.turns[0]?.finish();
    await h.flush();
    await h.play();
    expect(h.session.status().state).toBe('followup');
    // Politikanın 5 saniyesi geçti: cihaz ayarı 20 sn dediği için hâlâ dinliyor.
    await vi.advanceTimersByTimeAsync(6000);
    expect(h.session.status().state).toBe('followup');
    await vi.advanceTimersByTimeAsync(14_100);
    expect(h.session.status().state).toBe('idle');

    // Cihaz ayarı kaldırılınca (`null`) yeniden politikanın değeri geçer.
    h.settings.followUpSeconds = null;
    h.session.startListening('island');
    await h.utter('peki yarın');
    h.turns[1]?.say('Güneşli.');
    h.turns[1]?.finish();
    await h.flush();
    await h.play();
    expect(h.session.status().state).toBe('followup');
    await vi.advanceTimersByTimeAsync(5100);
    expect(h.session.status().state).toBe('idle');
  });

  it('takip penceresinde uyandırma sözü gerekmez; pencere politikadan gelir', async () => {
    const h = setup((policy) => {
      policy.voice.followUpSeconds = 5;
    });
    h.session.startListening('island');
    await h.utter('saat kaç');
    h.turns[0]?.say('Saat üç.');
    h.turns[0]?.finish();
    await h.flush();
    await h.play();
    expect(h.session.status().state).toBe('followup');

    await vi.advanceTimersByTimeAsync(4000);
    await h.utter('peki yarın hava nasıl');
    expect(h.turns[1]?.request.text).toBe('peki yarın hava nasıl');

    h.turns[1]?.finish();
    await h.flush();
    expect(h.session.status().state).toBe('followup');
    await vi.advanceTimersByTimeAsync(5050);
    expect(h.session.status().state).toBe('idle');
  });

  it('boş döküm (gürültü, halüsinasyon) tur açmaz; dinleme süresi yeniden başlar', async () => {
    const h = setup();
    h.session.onWake('hey jarvis', 0.3);
    await vi.advanceTimersByTimeAsync(4000);
    await h.utter('');
    expect(h.turns).toHaveLength(0);
    expect(h.session.status().state).toBe('listening');
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.session.status().state).toBe('listening');
    await vi.advanceTimersByTimeAsync(1100);
    expect(h.session.status().state).toBe('idle');
  });

  it('tur gerçekten donarsa (90 sn hiçbir etkinlik yok) keser, NE olduğunu söyler ve sohbet açık kalır', async () => {
    const h = setup();
    h.session.startListening('hotkey');
    await h.utter('bir şey sor');
    // Eski sınır (20 sn) artık turu kesmez.
    await vi.advanceTimersByTimeAsync(20_500);
    expect(h.session.status().state).toBe('thinking');
    expect(h.of('voice.error')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(VOICE_TUNING.turnStallMs - 20_500 - 100);
    expect(h.session.status().state).toBe('thinking');
    await vi.advanceTimersByTimeAsync(200);

    expect(h.turns[0]?.request.signal?.aborted).toBe(true);
    const message = t('turn.frozen', { seconds: 90 });
    expect(h.of('voice.error')[0]).toMatchObject({ code: 'timeout', retry: true });
    expect(h.io.spoken.at(-1)?.text).toBe(message);
    expect(h.session.status().state).toBe('speaking');
    await h.play(2500);
    // Sohbet KAPANMAZ: takip dinlemesi açıktır ve söz yeniden denenebilir.
    expect(h.states().at(-1)).toBe('followup:timeout');
    expect(h.session.status()).toMatchObject({ lastError: message, canRetry: true });
  });

  it('yanıt çalınırken geçen süre üst sınıra sayılmaz', async () => {
    const h = setup();
    h.session.startListening('hotkey');
    await h.utter('uzun anlat');
    h.turns[0]?.say('Uzun bir cümle.');
    const stream = h.io.spoken[0]?.streamId ?? '';
    h.session.onTtsSentence(stream, 0, 15_000);
    h.session.onPlaybackStarted(stream);
    // Ses çalarken durum "konuşuyor"; cümle bitip beyin sürerken "düşünüyor"a döner (ada adım satırını gösterir).
    await vi.advanceTimersByTimeAsync(14_000);
    expect(h.session.status().state).toBe('speaking');
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.session.status().state).toBe('thinking');
    // 15 sn ses + 90 sn sınır: 100. saniyede hâlâ sürmeli.
    await vi.advanceTimersByTimeAsync(84_000);
    expect(h.session.status().state).toBe('thinking');
    expect(h.of('voice.error')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(6000);
    expect(h.of('voice.error')[0]).toMatchObject({ code: 'timeout' });
  });

  it('beyin hata verirse kısa bir cümle söyler ve boşa döner', async () => {
    const h = setup();
    h.session.startListening('hotkey');
    await h.utter('bir şey sor');
    h.turns[0]?.finish({ stopReason: 'no_key', error: 'Anahtar yok; Yönetim’i açın.' });
    await h.flush();
    expect(h.of('voice.error')[0]).toMatchObject({ code: 'no_key', message: 'Anahtar yok; Yönetim’i açın.' });
    expect(h.io.spoken.at(-1)?.text).toBe('Anahtar yok; Yönetim’i açın.');
    await h.play();
    expect(h.states().at(-1)).toBe('idle:error');
  });

  it('yazıya çevirme hata verirse söyler; sohbet açık kalır (yeniden söylenebilsin)', async () => {
    const h = setup();
    h.session.startListening('hotkey');
    await h.utter(new SttError('timeout', 'Yazıya çevirme zamanında yanıt vermedi.'));
    expect(h.of('voice.error')[0]).toMatchObject({ code: 'stt' });
    expect(h.io.spoken.at(-1)?.text).toBe('Yazıya çevirme zamanında yanıt vermedi.');
    await h.play();
    expect(h.states().at(-1)).toBe('followup:error');
    expect(h.turns).toHaveLength(0);
  });

  it('TTS de çalışmıyorsa hata adaya yazıyla düşer; sohbet açık kalır', async () => {
    const h = setup();
    h.io.canSpeak = false;
    h.session.startListening('hotkey');
    await h.utter('bir şey sor');
    h.turns[0]?.finish({ stopReason: 'error', error: 'Bağlantı kurulamadı.' });
    await h.flush();
    expect(h.io.spoken).toHaveLength(0);
    expect(h.of('voice.partial').some((partial) => partial.role === 'assistant' && partial.text === 'Bağlantı kurulamadı.')).toBe(true);
    expect(h.states().at(-1)).toBe('followup:error');
  });

  it('çalma bitişi hiç bildirilmezse tur yine de kapanır', async () => {
    const h = setup();
    h.session.startListening('hotkey');
    await h.utter('saat kaç');
    h.turns[0]?.say('Saat üç.');
    h.turns[0]?.finish();
    await h.flush();
    await h.play(1000, { finish: false });
    expect(h.session.status().state).toBe('speaking');
    await vi.advanceTimersByTimeAsync(7000);
    expect(h.session.status().state).toBe('followup');
  });

  it('sessiz kipte yanıt yalnız yazıyla verilir', async () => {
    const h = setup();
    h.session.setQuiet(true);
    h.session.startListening('hotkey');
    await h.utter('saat kaç');
    h.turns[0]?.say('Saat üç.');
    h.turns[0]?.finish();
    await h.flush();
    expect(h.io.spoken).toHaveLength(0);
    expect(h.of('voice.partial').some((partial) => partial.role === 'assistant' && partial.text === 'Saat üç.')).toBe(true);
    expect(h.session.status().state).toBe('followup');
    await expect(h.session.speak('deneme')).resolves.toEqual({ spoken: false });
  });
});

describe('söz kesme ve dur-sözcükleri', () => {
  async function speaking(h: ReturnType<typeof setup>) {
    h.session.startListening('hotkey');
    await h.utter('bana uzun bir hikaye anlat');
    h.turns[0]?.say('Birinci cümle.');
    h.turns[0]?.say('İkinci cümle.');
    h.turns[0]?.say('Üçüncü cümle.');
    const stream = h.io.spoken[0]?.streamId ?? '';
    h.session.onTtsSentence(stream, 0, 2000);
    h.session.onTtsSentence(stream, 1, 2000);
    h.session.onPlaybackStarted(stream);
    expect(h.session.status().state).toBe('speaking');
    return stream;
  }

  it('`voice` kipi: konuşurken söz gelince oynatma hemen durur, istek iptal edilir, yeni söz dinlenir', async () => {
    const h = setup();
    const stream = await speaking(h);
    h.io.transcripts.push('aslında şunu soracaktım');
    h.session.onSpeechStart(50);
    // Sezici konuşurken açıktır (d6); susunca kapanır: son çağrı onu kapatır, ondan önceki durdurmadır.
    expect(h.io.calls.filter((call) => !call.startsWith('wake:')).at(-1)).toBe('stop');
    expect(h.turns[0]?.request.signal?.aborted).toBe(true);
    expect(h.states().at(-1)).toBe('listening:barge_in');
    expect(h.of('voice.turn').at(-1)).toMatchObject({ interrupted: true });

    // Pencere 2,5 sn çalındığını bildirir; beyin iptalle döner: döküm yalnız söylenen kısma iner.
    h.session.onPlaybackEnded(stream, 2500, true);
    h.turns[0]?.finish();
    await h.flush();
    expect(h.amends).toEqual([{ id: 'assistant-1', text: 'Birinci cümle. İkinci cümle.', interrupted: true }]);

    h.session.onSpeechEnd(50, h.pcm, 1500);
    await h.flush();
    expect(h.turns[1]?.request.text).toBe('aslında şunu soracaktım');
    // Kesen sözde "duydum" sesi çalınmaz.
    expect(h.io.calls.filter((call) => call === 'earcon:heard')).toHaveLength(1);
  });

  it('konuşurken "sus": ses VAD’da kesilir, model turu açılmaz, sözlü yanıt verilmez', async () => {
    const h = setup();
    await speaking(h);
    const spokenBefore = h.io.spoken.length;
    h.io.transcripts.push('Süs.');
    h.session.onSpeechStart(50);
    expect(h.io.calls.filter((call) => !call.startsWith('wake:')).at(-1)).toBe('stop');
    // Kesme, döküm beklenmeden yapıldı.
    expect(h.io.calls.filter((call) => call === 'transcribe')).toHaveLength(1);
    h.session.onSpeechEnd(50, h.pcm, 400);
    await h.flush();

    // Ada "düşünüyor" göstermeden doğrudan boşa dönülür.
    expect(h.states().slice(-2)).toEqual(['listening:barge_in', 'idle:stop_word']);
    expect(h.turns).toHaveLength(1);
    expect(h.io.spoken).toHaveLength(spokenBefore);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.session.status().state).toBe('idle');
  });

  it('d6: hızlı "Dur." süzgeçten "söz yok" diye atılsa da durdurur (konuşmayı kesen söz ve kısa söz izleyici)', async () => {
    const h = setup();
    await speaking(h);
    const segment = h.nextSegment();
    h.session.onSpeechStart(segment);
    h.io.results.push({ text: '', raw: 'Dur.', dropped: 'no_speech', durationMs: 90, languageConfidence: 0.6 });
    h.session.onSpeechEnd(segment, h.pcm, 300);
    await h.flush();
    expect(h.states().slice(-2)).toEqual(['listening:barge_in', 'idle:stop_word']);

    const blip = setup();
    await speaking(blip);
    blip.io.results.push({ text: '', raw: 'Dur!', dropped: 'no_speech', durationMs: 90, languageConfidence: 0.6 });
    blip.session.onSpeechBlip(blip.pcm, 250);
    await blip.flush();
    expect(blip.states().at(-1)).toBe('idle:stop_word');
    expect(blip.turns[0]?.request.signal?.aborted).toBe(true);
  });

  it('d6: kısa "Dur." yanlış yazılırsa ("Gördüğünüz gibi.") temiz cihazda dur-sözcüğü istemiyle ikinci kez okunur ve durdurur', async () => {
    const h = setup();
    await speaking(h);
    h.io.transcripts.push('Gördüğünüz gibi.', 'Dur.');
    h.session.onSpeechBlip(h.pcm, 700);
    await h.flush();
    expect(h.states().at(-1)).toBe('idle:stop_word');
    // d10: sızan cihazda (`wake`) Jarvis konuşurken ikinci okuma YAPILMAZ: kendi sesi "Dur." diye yazılıp turu kesiyordu.
    const leaky = setup((policy) => {
      policy.voice.bargeIn = 'wake';
    });
    await speaking(leaky);
    const reads = leaky.io.calls.filter((call) => call === 'transcribe').length;
    const segment = leaky.nextSegment();
    leaky.session.onSpeechStart(segment);
    leaky.io.transcripts.push('Gördüğünüz gibi.', 'Dur.');
    leaky.session.onSpeechEnd(segment, leaky.pcm, 700);
    await leaky.flush();
    expect(leaky.io.calls.filter((call) => call === 'transcribe').length).toBe(reads + 1);
    expect(leaky.session.status().state).toBe('speaking');
    // Uzun ve olağan söz ikinci kez okunmaz.
    const other = setup((policy) => {
      policy.voice.bargeIn = 'wake';
    });
    await speaking(other);
    const before = other.io.calls.filter((call) => call === 'transcribe').length;
    const next = other.nextSegment();
    other.session.onSpeechStart(next);
    other.io.transcripts.push('Bugün hava çok güzel olacak gibi görünüyor.');
    other.session.onSpeechEnd(next, other.pcm, 2500);
    await other.flush();
    expect(other.io.calls.filter((call) => call === 'transcribe').length).toBe(before + 1);
    expect(other.session.status().state).toBe('speaking');
  });

  it('d6: "bir dakika" ve "bekle" konuşmayı keser', async () => {
    for (const word of ['Bir dakika.', 'Bekle.', 'Tamam yeter.']) {
      const h = setup((policy) => {
        policy.voice.bargeIn = 'wake';
      });
      await speaking(h);
      const segment = h.nextSegment();
      h.session.onSpeechStart(segment);
      h.io.transcripts.push(word);
      h.session.onSpeechEnd(segment, h.pcm, 700);
      await h.flush();
      expect(h.states().at(-1), word).toBe('idle:stop_word');
    }
  });

  it('d8: Jarvis\'in kendi "Bir saniye." dolgu sözü mikrofondan geri gelince konuşmayı kesmez; kullanıcının "Dur."u keser', async () => {
    const h = setup((policy) => {
      policy.voice.bargeIn = 'wake';
    });
    await h.utter('Jarvis, takvimime bak');
    h.turns[0]?.say('Bir saniye.');
    await h.play(800, { finish: false });
    // Kısa söz izleyici: hoparlörden çıkan "Bir saniye." mikrofona geri geldi (yankı giderici öğrenemeyen cihaz).
    h.io.transcripts.push('Bir saniye.');
    h.session.onSpeechBlip(h.pcm, 600);
    await h.flush();
    expect(h.session.status().state).toBe('speaking');
    expect(h.turns[0]?.request.signal?.aborted).toBe(false);
    // Aynı ses asıl bölüt olarak, biraz farklı yazımla da gelebilir.
    const segment = h.nextSegment();
    h.session.onSpeechStart(segment);
    h.io.transcripts.push('Bi saniye', '');
    h.session.onSpeechEnd(segment, h.pcm, 700);
    await h.flush();
    expect(h.session.status().state).toBe('speaking');
    expect(h.turns[0]?.request.signal?.aborted).toBe(false);
    // Jarvis'in söylemediği dur-sözcüğü kullanıcınındır: keser.
    h.io.transcripts.length = 0;
    h.io.transcripts.push('Dur.');
    h.session.onSpeechBlip(h.pcm, 300);
    await h.flush();
    expect(h.states().at(-1)).toBe('idle:stop_word');
  });

  it('`wake` kipi: sıradan söz kesmez; dur-sözcüğü ve uyandırma sözü keser', async () => {
    const h = setup((policy) => {
      policy.voice.bargeIn = 'wake';
    });
    await speaking(h);
    expect(h.io.calls.filter((call) => call.startsWith('wake:')).at(-1)).toBe('wake:true');

    await h.utter('televizyondan gelen bir cümle');
    expect(h.session.status().state).toBe('speaking');
    expect(h.io.calls).not.toContain('stop');

    await h.utter('tamam sus', 600);
    expect(h.io.calls).toContain('stop');
    expect(h.states().at(-1)).toBe('idle:stop_word');
    expect(h.turns).toHaveLength(1);
  });

  it('`wake` kipi: konuşurken sezici tetiklenirse keser ve dinler', async () => {
    const h = setup((policy) => {
      policy.voice.bargeIn = 'wake';
    });
    await speaking(h);
    h.session.onWake('hey jarvis', 0.3);
    expect(h.io.calls).toContain('stop');
    expect(h.states().at(-1)).toBe('listening:barge_in');
  });

  it('`off` kipi: konuşurken gelen söz yazıya bile çevrilmez', async () => {
    const h = setup((policy) => {
      policy.voice.bargeIn = 'off';
    });
    await speaking(h);
    const before = h.io.calls.filter((call) => call === 'transcribe').length;
    await h.utter('sus', 400);
    expect(h.session.status().state).toBe('speaking');
    expect(h.io.calls.filter((call) => call === 'transcribe')).toHaveLength(before);
    expect(h.io.calls).not.toContain('stop');
  });

  it('takipte söylenen "sus" da tur açmadan boşa döndürür', async () => {
    const h = setup();
    h.session.startListening('hotkey');
    await h.utter('saat kaç');
    h.turns[0]?.finish();
    await h.flush();
    expect(h.session.status().state).toBe('followup');
    await h.utter('yeter');
    expect(h.states().at(-1)).toBe('idle:stop_word');
    expect(h.turns).toHaveLength(1);
  });

  it('takipte veda sözü ("güle güle", "bay bay", "iyi geceler"): tur açılmaz, tek kısa veda, sonra boş; mikrofon ve uyandırma açık', async () => {
    for (const [said, reply] of [
      ['Güle güle.', 'Görüşürüz efendim.'],
      ['Bay bay Jarvis.', 'Görüşürüz efendim.'],
      ['Tamam, iyi geceler.', 'İyi geceler efendim.'],
    ] as const) {
      const h = setup();
      h.session.startListening('hotkey');
      await h.utter('saat kaç');
      h.turns[0]?.finish();
      await h.flush();
      expect(h.session.status().state).toBe('followup');
      await h.utter(said);
      expect(h.turns, said).toHaveLength(1);
      expect(h.io.spoken.at(-1)?.text, said).toBe(reply);
      await h.play(700);
      const status = h.session.status();
      expect(status, said).toMatchObject({ state: 'idle', conversation: false, micMuted: false, wakePausedUntil: null });
      expect(h.states().at(-1)).toBe('idle:stop_word');
    }
  });

  it('veda gibi görünen ama başka bir şey anlatan söz tur açar ("ona güle güle dedim")', async () => {
    const h = setup();
    h.session.startListening('hotkey');
    await h.utter('saat kaç');
    h.turns[0]?.finish();
    await h.flush();
    await h.utter('Ona güle güle dedim.');
    expect(h.turns).toHaveLength(2);
  });

  it('stopSpeaking takip penceresine, cancelTurn boşa döndürür', async () => {
    const h = setup();
    await speaking(h);
    h.session.stopSpeaking();
    expect(h.states().at(-1)).toBe('followup:api');
    expect(h.turns[0]?.request.signal?.aborted).toBe(true);

    const g = setup();
    await speaking(g);
    g.session.cancelTurn('panic');
    expect(g.states().at(-1)).toBe('idle:panic');
    expect(g.io.calls).toContain('stop');
  });

  it('kısayol konuşmayı keser ve dinlemeye geçer', async () => {
    const h = setup();
    await speaking(h);
    h.session.startListening('hotkey');
    expect(h.turns[0]?.request.signal?.aborted).toBe(true);
    expect(h.states().at(-1)).toBe('listening:hotkey');
  });
});

describe('mikrofon', () => {
  it('kapatınca yakalama durur, `mic_off` olur ve bir kez söyler; sezici ve söz yok sayılır', async () => {
    const h = setup();
    h.session.muteMic();
    expect(h.io.calls).toContain('capture:false');
    expect(h.session.status()).toMatchObject({ state: 'speaking', micMuted: true, micMutedUntil: null });
    expect(h.io.spoken[0]?.text).toBe(t('voice.mic.muted', { hotkey: 'Ctrl+Alt+M' }));
    await h.play();
    expect(h.session.status().state).toBe('mic_off');

    h.session.onWake('hey jarvis', 0.3);
    await h.utter('Jarvis, saat kaç');
    expect(h.session.status().state).toBe('mic_off');
    expect(h.turns).toHaveLength(0);
    expect(h.of('voice.wake')).toHaveLength(0);
  });

  it('süreli kapatma süre dolunca kendiliğinden açılır', async () => {
    const h = setup();
    h.session.muteMic({ minutes: 5 });
    await h.play();
    expect(h.session.status().micMutedUntil).not.toBeNull();
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1000);
    expect(h.session.status().state).toBe('mic_off');
    await vi.advanceTimersByTimeAsync(1100);
    expect(h.session.status()).toMatchObject({ state: 'idle', micMuted: false, micMutedUntil: null });
    expect(h.io.calls.filter((call) => call.startsWith('capture:')).at(-1)).toBe('capture:true');
    expect(h.states().at(-1)).toBe('idle:unmute');
  });

  it('kapalıyken konuş kısayolu önce mikrofonu açar', async () => {
    const h = setup();
    h.session.muteMic();
    await h.play();
    h.session.startListening('hotkey');
    expect(h.session.status()).toMatchObject({ state: 'listening', micMuted: false });
    expect(h.io.calls.filter((call) => call.startsWith('capture:')).at(-1)).toBe('capture:true');
  });

  it('tur sürerken kapatılırsa yanıt tamamlanır, sonra `mic_off`', async () => {
    const h = setup();
    h.session.startListening('hotkey');
    await h.utter('mikrofonu kapat');
    // Model `voice_mute_mic` aracını çağırdı.
    h.session.muteMic();
    expect(h.session.status().state).toBe('thinking');
    h.turns[0]?.say('Mikrofonu kapattım.');
    h.turns[0]?.finish();
    await h.flush();
    await h.play();
    expect(h.states().at(-1)).toBe('mic_off:mute');
    // Onayı model söyledi; servis ayrıca söylemez.
    expect(h.io.spoken.map((item) => item.text)).toEqual(['Mikrofonu kapattım.']);
  });

  // d11 (18 Kas 2026): "mikrofon kapalıyken duymuyorum diyor ama duyarak cevap veriyor". Beynin bağlamında
  // "Mikrofon KAPALI" yazarken söz ona ulaşıyordu: hem "duymuyorum" dedi hem yanıt verdi.
  it('d11: mikrofon kapalıyken gelen söz (kapatmadan önce başlamış, yolda kalmış bölüt) komut olmaz', async () => {
    const h = setup();
    h.session.startListening('hotkey');
    await h.utter('Uzun bir rapor hazırla');
    h.session.muteMic(); // tur sürerken kapatıldı: durum `thinking` kalır, yanıt tamamlanacak
    const before = h.turns.length;
    const segment = h.nextSegment();
    h.session.onSpeechStart(segment);
    h.io.transcripts.push('Onun yerine Ahmet’e hemen mesaj at');
    h.session.onSpeechEnd(segment, h.pcm, 1500);
    await h.flush();
    expect(h.turns).toHaveLength(before);
  });

  it('d11: dinleme duraklatılmışken yanıt bitince yeniden dinlemeye açılmaz (sohbet kipinde de); sonraki söz komut olmaz', async () => {
    const h = setup((policy) => {
      policy.voice.conversationMode = true;
    });
    expect(h.session.startConversation()).toBe(true);
    await h.utter('Bugün hava nasıl');
    h.session.pauseWake(10); // kullanıcı yan menüden "Dinleme"yi duraklattı
    h.turns[0]?.say('Hava güneşli.');
    h.turns[0]?.finish();
    await h.flush();
    await h.play();
    expect(h.session.status().state).toBe('idle');
    const before = h.turns.length;
    await h.utter('Peki yarın ne olacak söyle bakalım', 2000);
    await h.flush();
    expect(h.turns).toHaveLength(before);
  });

  it('d11: dinleme duraklatılmışken de konuş kısayolu açıkça dinler (kullanıcı kendisi istedi)', async () => {
    const h = setup();
    h.session.pauseWake(10);
    h.session.startListening('hotkey');
    expect(h.session.status().state).toBe('listening');
    await h.utter('Saat kaç');
    await h.flush();
    expect(h.turns).toHaveLength(1);
  });
});

describe('seslendirme ve onay', () => {
  it('bildirim boştayken hemen, tur sürerken tur bitince söylenir', async () => {
    const h = setup();
    const first = h.session.speak('KDV beyannamesi zamanı.');
    expect(h.session.status().state).toBe('speaking');
    await h.play();
    await expect(first).resolves.toEqual({ spoken: true });
    expect(h.session.status().state).toBe('followup');

    await h.utter('saat kaç');
    const second = h.session.speak('Toplantınız başlıyor.');
    expect(h.io.spoken.map((item) => item.text)).toEqual(['KDV beyannamesi zamanı.']);
    h.turns[0]?.say('Saat üç.');
    h.turns[0]?.finish();
    await h.flush();
    await h.play();
    expect(h.io.spoken.at(-1)?.text).toBe('Toplantınız başlıyor.');
    await h.play();
    await expect(second).resolves.toEqual({ spoken: true });
  });

  it('boştayken odada konuşulurken gelen bildirim, uyandırma sözü olmayan söz bitince söylenir (sonsuza dek beklemez)', async () => {
    const h = setup();
    // Odada biri konuşuyor (uyandırma sözü yok): bildirim söz bitene dek bekler.
    h.io.transcripts.push('akşam ne yiyoruz');
    h.session.onSpeechStart(h.nextSegment());
    const said = h.session.speak('KDV beyannamesi zamanı.');
    expect(h.io.spoken).toEqual([]);
    h.session.onSpeechEnd(1, h.pcm, 1500);
    await h.flush();
    // Durum boşta kaldı (uyanma yok) ama kuyruk yeniden işlenir: cümle söylenir.
    expect(h.io.spoken.map((item) => item.text)).toEqual(['KDV beyannamesi zamanı.']);
    await h.play();
    await expect(said).resolves.toEqual({ spoken: true });
  });

  it('hat hazır değilken ve acil durdurmada seslendirmez, dinlemeye de geçmez', async () => {
    const h = setup();
    h.session.setReady(false, 'Yazıya çevirme kullanılamıyor.');
    await expect(h.session.speak('deneme')).resolves.toEqual({ spoken: false });
    h.session.startListening('hotkey');
    expect(h.session.status()).toMatchObject({ state: 'idle', ready: false, notReadyReason: 'Yazıya çevirme kullanılamıyor.' });
    expect(h.of('voice.error').at(-1)).toMatchObject({ code: 'not_ready' });

    const g = setup();
    g.policy.killSwitch.active = true;
    g.session.startListening('hotkey');
    expect(g.session.status().state).toBe('idle');
    expect(g.of('voice.error').at(-1)).toMatchObject({ code: 'kill_switch' });
  });

  it('bilgi iletisi (bulut ses yerine yerel ses) hata sayılmaz: `level: info`, son hata değişmez', () => {
    const h = setup();
    h.session.reportNotice('tts_fallback', 'Bulut sesinin kotası doldu; yerel sesle devam ediyorum.');
    expect(h.of('voice.error')).toEqual([{ code: 'tts_fallback', message: 'Bulut sesinin kotası doldu; yerel sesle devam ediyorum.', level: 'info' }]);
    expect(h.session.status().lastError).toBeNull();
    expect(h.of('voice.status')).toHaveLength(1);
    h.session.reportError('stt', 'Sizi yazıya çeviremedim.');
    expect(h.of('voice.error').at(-1)).toEqual({ code: 'stt', message: 'Sizi yazıya çeviremedim.' });
    expect(h.session.status().lastError).toBe('Sizi yazıya çeviremedim.');
  });

  it('sürüm kapısı (zorunlu güncelleme) açıkken uyandırma, dinleme ve seslendirme kapalıdır', async () => {
    const h = setup();
    h.gate.updateRequired = true;
    h.session.refreshPolicy();
    // Sezici kapatılır; yine de tetiklenirse (yarışta) uyanılmaz.
    expect(h.io.calls.at(-1)).toBe('wake:false');
    h.session.onWake('hey jarvis', 0.9);
    expect(h.session.status().state).toBe('idle');
    expect(h.of('voice.wake')).toHaveLength(0);
    // Whisper yolu: boştayken gelen "Jarvis, …" sözü yazıya bile çevrilmez.
    await h.utter('Jarvis, saat kaç');
    expect(h.io.calls).not.toContain('transcribe');
    expect(h.turns).toHaveLength(0);
    // Kısayol / ada: nedenini söyler, dinlemeye geçmez.
    h.session.startListening('hotkey');
    expect(h.session.status().state).toBe('idle');
    expect(h.of('voice.error').at(-1)).toEqual({ code: 'update_required', message: t('voice.error.updateRequired') });
    await expect(h.session.speak('Hatırlatıcı zamanı.')).resolves.toEqual({ spoken: false });

    // Kapı kalkınca uyandırma geri gelir.
    h.gate.updateRequired = false;
    h.session.refreshPolicy();
    expect(h.io.calls.at(-1)).toBe('wake:true');
    h.session.onWake('hey jarvis', 0.9);
    expect(h.session.status().state).toBe('listening');
  });

  it('sürüm kapısı tur sürerken açılırsa tur kesilir ve boşa dönülür', async () => {
    const h = setup();
    h.session.startListening('hotkey');
    await h.utter('uzun bir şey anlat');
    h.turns[0]?.say('Bir varmış bir yokmuş.');
    h.gate.updateRequired = true;
    h.session.refreshPolicy();
    expect(h.turns[0]?.request.signal?.aborted).toBe(true);
    expect(h.session.status().state).toBe('idle');
  });

  it('hat düşerse süren tur bırakılır ve boşa dönülür', async () => {
    const h = setup();
    h.session.startListening('hotkey');
    await h.utter('bir şey sor');
    h.session.setReady(false, 'Mikrofon bağlantısı kesildi.');
    expect(h.turns[0]?.request.signal?.aborted).toBe(true);
    expect(h.states().at(-1)).toBe('idle:error');
  });

  it('araç onay isterse soruyu sorar, yanıtı uyandırma sözü olmadan dinler ve sonuçlandırır', async () => {
    const h = setup();
    h.session.startListening('hotkey');
    await h.utter('eski raporu sil');
    h.turns[0]?.say('Bakıyorum.');
    await h.play();

    const request = { id: 'ap1', summary: 'rapor.pdf dosyasını silmek istiyorum.', requestedAt: '2026-11-16T00:00:00.000Z' } as ApprovalRequest;
    h.approvals.pending.push(request);
    h.session.onApprovalRequest(request.id, request.summary);
    expect(h.io.spoken.at(-1)?.text).toBe(`rapor.pdf dosyasını silmek istiyorum. ${t('voice.approval.ask')}`);
    await h.play();
    expect(h.session.status().state).toBe('listening');

    // Onay beklerken 20 sn üst sınırı işlemez.
    await vi.advanceTimersByTimeAsync(25_000);
    expect(h.of('voice.error')).toHaveLength(0);

    await h.utter('evet');
    expect(h.approvals.resolved).toEqual([{ id: 'ap1', decision: 'approved', by: 'voice' }]);
    h.session.onApprovalResolved('ap1');
    expect(h.session.status().state).toBe('thinking');
    expect(h.turns).toHaveLength(1);

    h.turns[0]?.say('Sildim.');
    h.turns[0]?.finish();
    await h.flush();
    await h.play();
    expect(h.session.status().state).toBe('followup');
  });

  it('onay yanıtı anlaşılmazsa yeniden sorar; "hayır" reddeder', async () => {
    const h = setup();
    h.session.startListening('hotkey');
    await h.utter('eski raporu sil');
    const request = { id: 'ap1', summary: 'Dosyayı silmek istiyorum.', requestedAt: '2026-11-16T00:00:00.000Z' } as ApprovalRequest;
    h.approvals.pending.push(request);
    h.session.onApprovalRequest(request.id, request.summary);
    await h.play();

    await h.utter('bir saniye düşüneyim');
    expect(h.approvals.resolved).toHaveLength(0);
    expect(h.io.spoken.at(-1)?.text).toBe(t('voice.approval.reask'));
    await h.play();

    await h.utter('hayır vazgeç');
    expect(h.approvals.resolved).toEqual([{ id: 'ap1', decision: 'denied', by: 'voice' }]);
  });

  // İstek: soru sesli turun içinde DOĞRUDAN sorulduysa gündelik kabul sözleri de onaydır
  // ("evet / onayla / tamam / yap"). Kimliği bilinmeyen (başka yerde bekleyen) onayda dar kural sürer (`tools.test.ts`).
  it.each(['tamam', 'olur', 'yap', 'devam', 'aynen', 'tamam olur'])('doğrudan sorulan onayda gündelik "%s" onaylar', async (word) => {
    const h = setup();
    h.session.startListening('hotkey');
    await h.utter('eski raporu sil');
    const request = { id: 'ap1', summary: 'Dosyayı silmek istiyorum.', requestedAt: '2026-11-16T00:00:00.000Z' } as ApprovalRequest;
    h.approvals.pending.push(request);
    h.session.onApprovalRequest(request.id, request.summary);
    await h.play();

    await h.utter(word);
    expect(h.approvals.resolved).toEqual([{ id: 'ap1', decision: 'approved', by: 'voice' }]);
    expect(h.approvals.speech.at(-1)).toEqual({ text: word, approvalId: 'ap1' });
  });

  it.each(['şey', 'bir dakika bakayım', 'tamam ama önce şunu sorayım sana'])('anlaşılmayan "%s" onaylamaz: yeniden sorulur, onay bekler kalır', async (word) => {
    const h = setup();
    h.session.startListening('hotkey');
    await h.utter('eski raporu sil');
    const request = { id: 'ap1', summary: 'Dosyayı silmek istiyorum.', requestedAt: '2026-11-16T00:00:00.000Z' } as ApprovalRequest;
    h.approvals.pending.push(request);
    h.session.onApprovalRequest(request.id, request.summary);
    await h.play();

    await h.utter(word);
    expect(h.approvals.resolved).toEqual([]);
    expect(h.approvals.pending).toHaveLength(1);
    expect(h.io.spoken.at(-1)?.text).toBe(t('voice.approval.reask'));
  });

  it.each([
    ['onaylıyorum', 'approved'],
    ['Evet.', 'approved'],
    ['evet, onaylıyorum', 'approved'],
    ['hayır', 'denied'],
    ['vazgeç', 'denied'],
    ['tamam, vazgeç', 'denied'],
  ] as const)('onay beklerken "%s" → %s', async (word, decision) => {
    const h = setup();
    h.session.startListening('hotkey');
    await h.utter('eski raporu sil');
    const request = { id: 'ap1', summary: 'Dosyayı silmek istiyorum.', requestedAt: '2026-11-16T00:00:00.000Z' } as ApprovalRequest;
    h.approvals.pending.push(request);
    h.session.onApprovalRequest(request.id, request.summary);
    await h.play();

    await h.utter(word);
    expect(h.approvals.resolved).toEqual([{ id: 'ap1', decision, by: 'voice' }]);
  });

  it('söz yalnız turun sorduğu onayı kapatır: başka yerde bekleyen (daha eski) onay yerinde kalır', async () => {
    const h = setup();
    // Yazılı sohbetten gelen, sesli turla ilgisi olmayan eski bir onay bekliyor.
    h.approvals.pending.push({ id: 'eski', summary: 'x', requestedAt: '2026-11-15T00:00:00.000Z' } as ApprovalRequest);
    h.session.startListening('hotkey');
    await h.utter('eski raporu sil');
    const request = { id: 'tur', summary: 'Dosyayı silmek istiyorum.', requestedAt: '2026-11-16T00:00:00.000Z' } as ApprovalRequest;
    h.approvals.pending.push(request);
    h.session.onApprovalRequest(request.id, request.summary);
    await h.play();

    await h.utter('onaylıyorum');
    expect(h.approvals.speech.at(-1)).toEqual({ text: 'onaylıyorum', approvalId: 'tur' });
    expect(h.approvals.resolved).toEqual([{ id: 'tur', decision: 'approved', by: 'voice' }]);
    expect(h.approvals.pending.map((item) => item.id)).toEqual(['eski']);
  });

  it('turun onayı başka yoldan kapandıysa (ada düğmesi) geç gelen söz başka onayı kapatmaz', async () => {
    const h = setup();
    h.session.startListening('hotkey');
    await h.utter('eski raporu sil');
    const request = { id: 'tur', summary: 'Dosyayı silmek istiyorum.', requestedAt: '2026-11-16T00:00:00.000Z' } as ApprovalRequest;
    h.approvals.pending.push(request);
    h.session.onApprovalRequest(request.id, request.summary);
    await h.play();
    // Kullanıcı konuşurken onay adadan reddedildi ve aynı anda başka bir iş onay istedi.
    h.approvals.pending = [{ id: 'baska', summary: 'y', requestedAt: '2026-11-16T00:00:01.000Z' } as ApprovalRequest];

    await h.utter('onaylıyorum');
    expect(h.approvals.speech.at(-1)).toEqual({ text: 'onaylıyorum', approvalId: 'tur' });
    expect(h.approvals.resolved).toEqual([]);
    expect(h.approvals.pending.map((item) => item.id)).toEqual(['baska']);
  });

  it('sesli tur dışındaki onay sorusu seslendirilir ama sesli döküme yazılmaz (ayrı "Yeni sohbet" oturumu açmaz)', async () => {
    const h = setup();
    h.approvals.pending.push({ id: 'ap9', summary: 'rapor.pdf dosyasını silmek istiyorum.', requestedAt: '2026-11-16T00:00:00.000Z' } as ApprovalRequest);
    h.session.onApprovalRequest('ap9', 'rapor.pdf dosyasını silmek istiyorum.');
    expect(h.io.spoken.at(-1)?.text).toBe(`rapor.pdf dosyasını silmek istiyorum. ${t('voice.approval.ask')}`);
    expect(h.appended).toEqual([]);
    await h.play();
    // Sıradan bildirim ise döküme yazılır (takip sorusunun bağlamı olsun diye).
    void h.session.speak('KDV beyannamesi zamanı.');
    expect(h.appended).toEqual(['KDV beyannamesi zamanı.']);
  });

  it('sesli tur dışında bekleyen TEK onay açık sözle sonuçlanır ve model turu açılmaz', async () => {
    const h = setup();
    h.approvals.pending.push({ id: 'ap9', summary: 'x', requestedAt: '2026-11-16T00:00:00.000Z' } as ApprovalRequest);
    h.session.startListening('hotkey');
    await h.utter('onaylıyorum');
    expect(h.approvals.speech.at(-1)).toEqual({ text: 'onaylıyorum', approvalId: null });
    expect(h.approvals.resolved).toEqual([{ id: 'ap9', decision: 'approved', by: 'voice' }]);
    expect(h.turns).toHaveLength(0);
    expect(h.session.status().state).toBe('followup');
  });

  it('sesli tur dışında "tamam" onaylamaz: söz sıradan komut olarak modele gider', async () => {
    const h = setup();
    h.approvals.pending.push({ id: 'ap9', summary: 'x', requestedAt: '2026-11-16T00:00:00.000Z' } as ApprovalRequest);
    h.session.startListening('hotkey');
    await h.utter('tamam');
    expect(h.approvals.resolved).toEqual([]);
    expect(h.approvals.pending).toHaveLength(1);
    expect(h.turns).toHaveLength(1);
  });

  it('sesli tur dışında birden çok onay bekliyorsa söz hiçbirini kapatmaz', async () => {
    const h = setup();
    h.approvals.pending.push(
      { id: 'a', summary: 'x', requestedAt: '2026-11-16T00:00:00.000Z' } as ApprovalRequest,
      { id: 'b', summary: 'y', requestedAt: '2026-11-16T00:00:01.000Z' } as ApprovalRequest,
    );
    h.session.startListening('hotkey');
    await h.utter('onaylıyorum');
    expect(h.approvals.resolved).toEqual([]);
    expect(h.approvals.pending).toHaveLength(2);
  });

  it('sohbet kipi: yanıttan sonra uyandırmasız dinler; "tamam, bu kadar" bitirir', async () => {
    const h = setup();
    expect(h.session.startConversation()).toBe(true);
    expect(h.session.status()).toMatchObject({ state: 'listening', conversation: true });
    await h.utter('nasılsın');
    h.turns[0]?.finish();
    await h.flush();
    expect(h.states().at(-1)).toBe('listening:conversation');
    await h.utter('tamam, bu kadar');
    expect(h.session.status()).toMatchObject({ state: 'idle', conversation: false });
    expect(h.turns).toHaveLength(1);

    const g = setup((policy) => {
      policy.voice.conversationMode = false;
    });
    expect(g.session.startConversation()).toBe(false);
  });
});

describe('dil süzgecinin attığı ama adla başlayan söz', () => {
  const dropped = (raw: string, reason: 'language' | 'pattern') => ({ text: '', raw, dropped: reason, durationMs: 200, languageConfidence: 0.42 });

  it('boştayken: "dil belirsiz" diye atılan döküm adla başlıyorsa uyandırır ve komut işlenir', async () => {
    const h = setup();
    h.io.results.push(dropped('Jarvis, saat kaç?', 'language'));
    await h.utter('');
    expect(h.of('voice.wake')[0]).toMatchObject({ path: 'whisper' });
    expect(h.turns[0]?.request.text).toBe('saat kaç?');
  });

  it('adla başlamayan ya da başka nedenle (bilinen kalıp) atılan döküm yok sayılır', async () => {
    const h = setup();
    h.io.results.push(dropped('İzlediğiniz için teşekkürler', 'language'));
    await h.utter('');
    h.io.results.push(dropped('Jarvis, altyazı M.K.', 'pattern'));
    await h.utter('');
    expect(h.of('voice.wake')).toHaveLength(0);
    expect(h.turns).toHaveLength(0);
    expect(h.session.status().state).toBe('idle');
  });

  it('takip penceresinde de adla başlayan söz kurtarılır; adsız söz atılmış kalır', async () => {
    const h = setup();
    h.session.startListening('hotkey');
    h.io.results.push(dropped('bugün hava nasıl', 'language'));
    await h.utter('');
    expect(h.turns).toHaveLength(0);
    expect(h.session.status().state).toBe('listening');
    h.io.results.push(dropped('Jarvis, bugün hava nasıl', 'language'));
    await h.utter('');
    expect(h.turns[0]?.request.text).toBe('bugün hava nasıl');
  });
});

describe('kısa söz izleyici', () => {
  it('konuşurken VAD\'ın söz saymadığı kısa "sus" turu keser; model turu açılmaz', async () => {
    const h = setup();
    await h.utter('Jarvis, uzun bir hikaye anlat');
    h.turns[0]?.say('Bir varmış bir yokmuş.');
    await h.play(3000, { finish: false });
    expect(h.io.watch.at(-1)).toBe(true);
    h.io.transcripts.push('Sus.');
    h.session.onSpeechBlip(h.pcm, 180);
    await h.flush();
    expect(h.states().at(-1)).toBe('idle:stop_word');
    expect(h.turns[0]?.request.signal?.aborted).toBe(true);
    expect(h.turns).toHaveLength(1);
    expect(h.io.watch.at(-1)).toBe(false);
  });

  it('dur-sözcüğü olmayan kısa ses (öksürük, tık) hiçbir şeyi değiştirmez', async () => {
    const h = setup();
    await h.utter('Jarvis, uzun bir hikaye anlat');
    h.turns[0]?.say('Bir varmış bir yokmuş.');
    await h.play(3000, { finish: false });
    for (const text of ['', 'Evet.', 'Hı hı', 'Su']) {
      h.io.transcripts.push(text);
      h.session.onSpeechBlip(h.pcm, 150);
      await h.flush();
    }
    expect(h.session.status().state).toBe('speaking');
    expect(h.turns[0]?.request.signal?.aborted).toBe(false);
    expect(h.turns).toHaveLength(1);
  });

  it('düşünürken de dur-sözcüğünü yakalar; boşta, dinlerken ve `off` kipinde yok sayar', async () => {
    const thinking = setup();
    await thinking.utter('Jarvis, hava nasıl');
    expect(thinking.session.status().state).toBe('thinking');
    thinking.io.transcripts.push('Dur.');
    thinking.session.onSpeechBlip(thinking.pcm, 160);
    await thinking.flush();
    expect(thinking.states().at(-1)).toBe('idle:stop_word');

    const idle = setup();
    idle.io.transcripts.push('Sus.');
    idle.session.onSpeechBlip(idle.pcm, 160);
    await idle.flush();
    expect(idle.io.calls).not.toContain('transcribe');
    expect(idle.session.status().state).toBe('idle');

    const off = setup((policy) => {
      policy.voice.bargeIn = 'off';
    });
    await off.utter('Jarvis, uzun bir hikaye anlat');
    off.turns[0]?.say('Bir varmış bir yokmuş.');
    await off.play(3000, { finish: false });
    off.io.transcripts.push('Sus.');
    off.session.onSpeechBlip(off.pcm, 160);
    await off.flush();
    expect(off.session.status().state).toBe('speaking');
  });

  it('bir kısa ses yazıya çevrilirken gelen diğerleri atılır', async () => {
    const h = setup();
    await h.utter('Jarvis, uzun bir hikaye anlat');
    h.turns[0]?.say('Bir varmış bir yokmuş.');
    await h.play(3000, { finish: false });
    const before = h.io.calls.filter((call) => call === 'transcribe').length;
    // İlk kısa ses "tık" (ve d6'nın dur-sözcüğü ikinci okuması: boş); ikinci kısa ses ("Sus.") o sırada atılır.
    h.io.transcripts.push('tık', '', 'Sus.');
    h.session.onSpeechBlip(h.pcm, 100);
    h.session.onSpeechBlip(h.pcm, 100);
    await h.flush();
    expect(h.io.calls.filter((call) => call === 'transcribe').length).toBe(before + 2);
    expect(h.session.status().state).toBe('speaking');
  });
});

describe('sohbet kipi (sözle)', () => {
  it('"sohbet edelim": model turu açılmaz, kısa onay söylenir, sonra uyandırma sözü olmadan iki soru yanıtlanır', async () => {
    const h = setup();
    await h.utter('Jarvis, sohbet edelim.');
    expect(h.turns).toHaveLength(0);
    expect(h.session.status()).toMatchObject({ state: 'speaking', conversation: true });
    expect(h.io.spoken.at(-1)?.text).toBe(t('voice.conversation.started'));
    await h.play(900);
    expect(h.states().at(-1)).toBe('listening:conversation');

    await h.utter('saat kaç');
    expect(h.turns).toHaveLength(1);
    h.turns[0]?.say('Saat on efendim.');
    h.turns[0]?.finish();
    await h.flush();
    await h.play(800);
    expect(h.states().at(-1)).toBe('listening:conversation');

    await h.utter('yarın hava nasıl');
    expect(h.turns).toHaveLength(2);
    h.turns[1]?.say('Güneşli.');
    h.turns[1]?.finish();
    await h.flush();
    await h.play(600);
    expect(h.states().at(-1)).toBe('listening:conversation');
    expect(h.of('voice.wake')).toHaveLength(1);

    // Veda sözü: kip HEMEN biter, tek kısa veda söylenir, sonra boşa dönülür (model turu açılmaz).
    await h.utter('Görüşürüz.');
    expect(h.session.status()).toMatchObject({ state: 'speaking', conversation: false });
    expect(h.io.spoken.at(-1)?.text).toBe('Görüşürüz efendim.');
    await h.play(700);
    expect(h.session.status()).toMatchObject({ state: 'idle', conversation: false, micMuted: false });
    expect(h.states().at(-1)).toBe('idle:stop_word');
    expect(h.turns).toHaveLength(2);
    // Kip durumu her değişimde duyurulur.
    const flags = h.of('voice.status').map((status) => status.conversation);
    expect(flags).toContain(true);
    expect(flags.at(-1)).toBe(false);
  });

  it('45 sn sessizlik kipi bitirir; gürültü (boş döküm) süreyi baştan başlatmaz', async () => {
    const h = setup();
    expect(h.session.startConversation()).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    // Oda gürültüsü söz sanıldı, dökümü boş çıktı: dinlemeye dönülür ama 45 sn baştan başlamaz.
    await h.utter('');
    expect(h.session.status()).toMatchObject({ state: 'listening', conversation: true });
    await vi.advanceTimersByTimeAsync(14_000);
    expect(h.session.status().state).toBe('listening');
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.session.status()).toMatchObject({ state: 'idle', conversation: false });
    expect(h.states().at(-1)).toBe('idle:no_speech');
    expect(h.turns).toHaveLength(0);
  });

  it('gerçek söz sessizlik süresini yeniler', async () => {
    const h = setup();
    h.session.startConversation();
    await vi.advanceTimersByTimeAsync(40_000);
    await h.utter('bir şey soracağım');
    h.turns[0]?.finish();
    await h.flush();
    expect(h.states().at(-1)).toBe('listening:conversation');
    await vi.advanceTimersByTimeAsync(44_000);
    expect(h.session.status().conversation).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.session.status()).toMatchObject({ state: 'idle', conversation: false });
  });

  it('kip kapalıysa (politika) "sohbet edelim" sıradan bir komuttur', async () => {
    const h = setup((policy) => {
      policy.voice.conversationMode = false;
    });
    await h.utter('Jarvis, sohbet edelim.');
    expect(h.turns).toHaveLength(1);
    expect(h.session.status().conversation).toBe(false);
  });

  it('boşa dönüş ("sus", mikrofon kapatma) sohbet kipini de bitirir; beyin hatası BİTİRMEZ', async () => {
    // Hata sohbeti kapatmaz: neden söylenir, kip sürer, kullanıcı yeniden söyleyebilir (şikâyet: "sohbet tamamen kapanıyor").
    const failed = setup();
    failed.session.startConversation();
    await failed.utter('bir şey sor');
    failed.turns[0]?.finish({ stopReason: 'error', error: 'Şu an yanıt veremiyorum.' });
    await failed.flush();
    await failed.play(900);
    expect(failed.session.status()).toMatchObject({ state: 'listening', conversation: true, canRetry: true });

    const stopped = setup();
    stopped.session.startConversation();
    await stopped.utter('sus');
    expect(stopped.session.status()).toMatchObject({ state: 'idle', conversation: false });
    expect(stopped.of('voice.status').at(-1)?.conversation).toBe(false);

    const muted = setup();
    muted.session.startConversation();
    muted.session.muteMic();
    // Kapatma sözle bildirilir (durum bir an `speaking`); kip o anda bitmiştir.
    expect(muted.session.status()).toMatchObject({ micMuted: true, conversation: false });
  });

  it('sohbet kipinde bildirim, söz yokken araya girer ve dinlemeye geri dönülür', async () => {
    const h = setup();
    h.session.startConversation();
    const spoken = h.session.speak('Toplantınız beş dakika sonra.');
    await h.flush();
    expect(h.session.status().state).toBe('speaking');
    await h.play(1200);
    await expect(spoken).resolves.toEqual({ spoken: true });
    expect(h.session.status()).toMatchObject({ state: 'listening', conversation: true });
  });

  it('sohbet kipinde söz kesme kuralları aynıdır: konuşurken gelen söz keser', async () => {
    const h = setup();
    h.session.startConversation();
    await h.utter('uzun bir hikaye anlat');
    h.turns[0]?.say('Bir varmış bir yokmuş.');
    await h.play(3000, { finish: false });
    expect(h.session.status().state).toBe('speaking');
    h.session.onSpeechStart(99);
    expect(h.states().at(-1)).toBe('listening:barge_in');
    expect(h.turns[0]?.request.signal?.aborted).toBe(true);
    expect(h.session.status().conversation).toBe(true);
  });
});

describe('yankı sınırı, öğrenilen yazım, ısıtma', () => {
  it('yankı sızıyorsa politika `voice` olsa da söz kesme `wake` kipinde uygulanır', async () => {
    const h = setup();
    expect(h.session.status().bargeIn).toBe('voice');
    h.session.setEchoLeaks(true);
    expect(h.session.status().bargeIn).toBe('wake');
    expect(h.of('voice.status').at(-1)?.bargeIn).toBe('wake');

    await h.utter('Jarvis, uzun bir hikaye anlat');
    h.turns[0]?.say('Bir varmış bir yokmuş.');
    await h.play(3000, { finish: false });
    // Kendi sesi (ya da sıradan söz) kesmez…
    h.session.onSpeechStart(50);
    expect(h.session.status().state).toBe('speaking');
    expect(h.turns[0]?.request.signal?.aborted).toBe(false);
    // …sezici konuşurken de dinler ve uyandırma sözü keser.
    expect(h.io.calls.at(-1)).not.toBe('wake:false');
    h.session.onWake('hey jarvis', 0.2);
    expect(h.states().at(-1)).toBe('listening:barge_in');

    // Politika zaten `off` ise sınır bir şeyi değiştirmez; yankı düzelince `voice` geri gelir.
    h.session.setEchoLeaks(false);
    expect(h.session.status().bargeIn).toBe('voice');
    const off = setup((policy) => {
      policy.voice.bargeIn = 'off';
    });
    off.session.setEchoLeaks(true);
    expect(off.session.status().bargeIn).toBe('off');
  });

  it('kalibrasyonda öğrenilen yazım Whisper yolunda uyandırır; politika yenilenince de korunur', async () => {
    const h = setup();
    await h.utter('Garvis, saat kaç?');
    expect(h.of('voice.wake')).toHaveLength(0);
    h.session.setLearnedWake(['garvis']);
    h.session.refreshPolicy();
    await h.utter('Garvis, saat kaç?');
    expect(h.of('voice.wake')[0]).toMatchObject({ path: 'whisper', phrase: 'hey jarvis' });
    expect(h.turns[0]?.request.text).toBe('saat kaç?');
  });

  it('her uyanma yolunda beyin ve seslendirme bağlantısı ısıtılır', async () => {
    const kws = setup();
    kws.session.onWake('hey jarvis', 0.2);
    await kws.flush();
    expect([kws.io.brainPrewarms, kws.io.speechPrewarms]).toEqual([1, 1]);

    for (const trigger of ['hotkey', 'island', 'api'] as const) {
      const h = setup();
      h.session.startListening(trigger);
      await h.flush();
      expect([h.io.brainPrewarms, h.io.speechPrewarms]).toEqual([1, 1]);
    }
  });

  it('Whisper yolu: ısıtma sözün başında başlar; odadaki her konuşmada yinelenmez', async () => {
    const h = setup();
    // Boştayken söz başladı: daha ne söylendiği bilinmiyor ama ısıtma başlar.
    h.session.onSpeechStart(1);
    await h.flush();
    expect([h.io.brainPrewarms, h.io.speechPrewarms]).toEqual([1, 1]);
    h.io.transcripts.push('Carvis, saat kaç?');
    h.session.onSpeechEnd(1, h.pcm, 1500);
    await h.flush();
    // Uyanınca yeniden istenir (beyin süren ısıtmayı paylaşır).
    expect(h.of('voice.wake')).toHaveLength(1);
    h.turns[0]?.finish();
    await h.flush();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.session.status().state).toBe('idle');

    const before = h.io.brainPrewarms;
    // Odada konuşma sürüyor: dört dakika dolmadan yeniden ısıtılmaz.
    for (let i = 0; i < 5; i++) {
      await h.utter('bugün hava çok güzel');
      await vi.advanceTimersByTimeAsync(20_000);
    }
    expect(h.io.brainPrewarms).toBe(before);
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    await h.utter('yine konuşuyoruz');
    expect(h.io.brainPrewarms).toBe(before + 1);
  });

  it('uyandırma duraklatılmışken ve mikrofon sınaması sürerken erken ısıtma yapılmaz', async () => {
    const h = setup();
    h.session.pauseWake(10);
    h.session.onSpeechStart(1);
    await h.flush();
    expect(h.io.brainPrewarms).toBe(0);
    h.session.resumeWake();
    h.session.setSuspended(true);
    h.session.onSpeechStart(2);
    await h.flush();
    expect(h.io.brainPrewarms).toBe(0);
  });

  it('son turun aşama süreleri tanı için tutulur', async () => {
    const h = setup();
    expect(h.session.stages()).toBeNull();
    await h.utter('Jarvis, saat kaç');
    h.turns[0]?.say('Saat on.');
    h.turns[0]?.finish();
    await h.flush();
    const stream = await h.play(700);
    expect(h.session.stages()).toMatchObject({ endSilenceMs: 600, sttMs: 120, interrupted: false, firstStreamId: stream });
    expect(h.session.stages()?.totalMs).toBeGreaterThanOrEqual(0);
  });
});

describe('kendi sesini duyma (sınama oturumundan örnek)', () => {
  const REPLY_1 = ['Bulut hesabında kredi yok; bu bilgisayardaki modelle çalışıyorum.', 'Efendim, teşekkür ederim, iyiyim.', 'Siz nasılsınız?'];
  const HEARD_1 = 'Bu bilgisayardaki modelle çalışıyorum. Efendim teşekkür ederim, iyiyim. Siz nasılsınız?';
  const REPLY_2 = ['Efendim, hatırlatıcıyı kurdum.', "Bugün akşam 20:00'de çalacak.", 'Umarım işinize yarar.'];
  const HEARD_2 = 'Bunun işinize yarar.';

  /** Yankı sınaması "sızıyor" demiş cihaz (söz kesme `wake` kipine iner); koruma süresi `guardMs`. */
  const leaky = (guardMs = 800) => {
    const h = setup();
    h.session.setEchoLeaks(true);
    h.session.setEchoGuardMs(guardMs);
    return h;
  };

  /** Soru sorulur, Jarvis `reply` cümlelerini söylemeye başlar; çalma sürmektedir. */
  const speaking = async (h: ReturnType<typeof setup>, reply: string[]) => {
    await h.utter('Jarvis, bugün nasılsın?');
    for (const sentence of reply) h.turns.at(-1)?.say(sentence);
    h.turns.at(-1)?.finish();
    await h.flush();
    const stream = await h.play(2000, { finish: false });
    expect(h.session.status().state).toBe('speaking');
    return stream;
  };

  it('asıl hata: Jarvis konuşurken başlayan söz, çalma bitince "takip" durumunda bitse de tur AÇMAZ (zaman kapısı)', async () => {
    const h = leaky();
    const stream = await speaking(h, REPLY_1);
    const echo = h.nextSegment();
    h.session.onSpeechStart(echo, 300);
    await vi.advanceTimersByTimeAsync(6000);
    h.session.onPlaybackEnded(stream, 6000, false);
    await h.flush();
    expect(h.session.status().state).toBe('followup');

    // VAD'ın bitiş sessizliği: bölüt çalma bittikten 650 ms sonra kapanır; koruma süresi (800 ms) dolmamıştır.
    await vi.advanceTimersByTimeAsync(650);
    const before = h.io.calls.filter((call) => call === 'transcribe').length;
    h.io.transcripts.push(HEARD_1);
    h.session.onSpeechEnd(echo, h.pcm, 6500);
    await h.flush();

    expect(h.turns).toHaveLength(1);
    expect(h.io.calls.filter((call) => call === 'transcribe')).toHaveLength(before);
    expect(h.io.calls.filter((call) => call === 'earcon:heard')).toHaveLength(1);
    expect(h.session.status().state).toBe('followup');
    expect(h.session.echoReport()).toMatchObject({ guardMs: 800, dropped: 1, last: { kind: 'guard' } });
  });

  it('koruma süresi dolunca toplanan söz atılır; ardından gelen gerçek söz tur açar', async () => {
    const h = leaky(400);
    const stream = await speaking(h, REPLY_1);
    const echo = h.nextSegment();
    h.session.onSpeechStart(echo, 300);
    h.session.onPlaybackEnded(stream, 6000, false);
    await h.flush();
    expect(h.io.calls).not.toContain('cut');
    await vi.advanceTimersByTimeAsync(450);
    expect(h.io.calls.filter((call) => call === 'cut')).toHaveLength(1);
    expect(h.session.echoReport().cuts).toBe(1);

    // İşçi, kesme anından sonra söz içermeyen bölütü atar; takip penceresi yeniden işler ve gerçek söz komuttur.
    h.session.onSpeechCut(echo);
    expect(h.session.echoReport().dropped).toBe(1);
    await vi.advanceTimersByTimeAsync(2000);
    await h.utter('Yarın hava nasıl olacak?');
    expect(h.turns).toHaveLength(2);
    expect(h.turns[1]?.request.text).toBe('Yarın hava nasıl olacak?');
  });

  it('atılan sözden sonra takip süresi yeniden işler: söz gelmezse boşa dönülür', async () => {
    const h = leaky();
    const stream = await speaking(h, REPLY_1);
    const echo = h.nextSegment();
    h.session.onSpeechStart(echo, 300);
    h.session.onPlaybackEnded(stream, 6000, false);
    await vi.advanceTimersByTimeAsync(650);
    h.session.onSpeechEnd(echo, h.pcm, 6500);
    await vi.advanceTimersByTimeAsync(h.policy.voice.followUpSeconds * 1000 + 100);
    expect(h.session.status().state).toBe('idle');
    expect(h.turns).toHaveLength(1);
  });

  it.each([
    ['birinci gerçek örnek', REPLY_1, HEARD_1],
    ['ikinci gerçek örnek ("Umarım" → "Bunun")', REPLY_2, HEARD_2],
  ])('metin süzgeci (zaman kapısı kaçırırsa): %s tur açmaz', async (_label, reply, heard) => {
    // Koruma süresi kısa ve işçi kesmesi yok: bölüt koruma süresinden SONRA kapanır ve yazıya çevrilir.
    const h = leaky(200);
    const stream = await speaking(h, reply);
    const echo = h.nextSegment();
    h.session.onSpeechStart(echo, 300);
    h.session.onPlaybackEnded(stream, 6000, false);
    await vi.advanceTimersByTimeAsync(700);
    h.io.transcripts.push(heard);
    h.session.onSpeechEnd(echo, h.pcm, 6500);
    await vi.advanceTimersByTimeAsync(100);

    expect(h.turns).toHaveLength(1);
    expect(h.session.status().state).toBe('followup');
    expect(h.io.calls.filter((call) => call === 'earcon:heard')).toHaveLength(1);
    expect(h.session.echoReport()).toMatchObject({ dropped: 1, last: { kind: 'echo' } });
  });

  it('yankının ardından kullanıcı konuştuysa yalnız kullanıcının sözü komut olur', async () => {
    const h = leaky(200);
    const stream = await speaking(h, REPLY_2);
    const mixed = h.nextSegment();
    h.session.onSpeechStart(mixed, 300);
    h.session.onPlaybackEnded(stream, 6000, false);
    await vi.advanceTimersByTimeAsync(2500);
    h.io.transcripts.push('Umarım işinize yarar. Peki yarın hava nasıl olacak?');
    h.session.onSpeechEnd(mixed, h.pcm, 8000);
    await vi.advanceTimersByTimeAsync(100);

    expect(h.turns).toHaveLength(2);
    expect(h.turns[1]?.request.text).toBe('Peki yarın hava nasıl olacak?');
    expect(h.session.echoReport()).toMatchObject({ trimmed: 1, last: { kind: 'partial' } });
  });

  it('çalma bittikten sonra başlayan gerçek söz, Jarvis\'in sözcüklerini içerse de komuttur', async () => {
    const h = leaky();
    const stream = await speaking(h, REPLY_2);
    h.session.onPlaybackEnded(stream, 6000, false);
    await vi.advanceTimersByTimeAsync(1500);
    await h.utter('Saat yirmide değil yirmi birde çalsın');
    expect(h.turns).toHaveLength(2);
    expect(h.turns[1]?.request.text).toBe('Saat yirmide değil yirmi birde çalsın');
  });

  it('çalma bittikten hemen sonra aynı cümlenin tamamı gelirse (gecikmeli hoparlör) tur açılmaz', async () => {
    const h = leaky(200);
    const stream = await speaking(h, REPLY_2);
    h.session.onPlaybackEnded(stream, 6000, false);
    await vi.advanceTimersByTimeAsync(900);
    await h.utter("Bugün akşam yirmide çalacak. Umarım işinize yarar.");
    expect(h.turns).toHaveLength(1);
    expect(h.session.status().state).toBe('followup');
  });

  it('konuşurken söylenen "sus" yine keser; uyandırma sözüyle kesilen söz kullanıcınındır', async () => {
    const h = leaky();
    await speaking(h, REPLY_1);
    await h.utter('Sus.');
    expect(h.states().at(-1)).toBe('idle:stop_word');

    const g = leaky();
    const stream = await speaking(g, REPLY_1);
    const segment = g.nextSegment();
    g.session.onSpeechStart(segment, 300);
    g.session.onWake('hey jarvis', 0.2);
    expect(g.session.status().state).toBe('listening');
    g.session.onPlaybackEnded(stream, 1500, true);
    g.io.transcripts.push('Hey Jarvis, saat kaç?');
    g.session.onSpeechEnd(segment, g.pcm, 1800);
    await g.flush();
    expect(g.turns).toHaveLength(2);
    expect(g.turns[1]?.request.text).toBe('saat kaç?');
  });

  it('söz kesme `voice` kipinde Jarvis kendini keserse tur açılmaz ve cihaz "sızıyor" diye bildirilir', async () => {
    const h = setup();
    await speaking(h, ['Yarın güneşli olacak efendim.']);
    // Kendi sesi 400 ms sonra VAD'ı tetikler: söz kesme olur, bölütte cümlenin yarım başı vardır.
    await vi.advanceTimersByTimeAsync(400);
    await h.utter('Yarın güneşin');
    expect(h.states()).toContain('listening:barge_in');
    expect(h.turns).toHaveLength(1);
    expect(h.session.echoReport()).toMatchObject({ selfInterrupts: 1, last: { kind: 'self_interrupt' } });
    // Yarım kalan yanıt yeniden söylenir (tur yeniden koşulmaz: araçlar ikinci kez çalışmaz).
    expect(h.session.status().state).toBe('speaking');
    expect(h.io.spoken.at(-1)?.text).toBe('Yarın güneşli olacak efendim.');
    expect(h.turns).toHaveLength(1);
    // Tek seferlik kendini kesme hoş görülür; kısa sürede ikincisi cihazın söz kesmeyi kaldıramadığını bildirir.
    expect(h.io.calls).not.toContain('self');
    await h.play(2000, { finish: false });
    await vi.advanceTimersByTimeAsync(400);
    await h.utter('Yarın güneş');
    expect(h.io.calls).toContain('self');
    expect(h.session.echoReport().selfInterrupts).toBe(2);
  });

  it('söz kesme `voice` kipinde kullanıcının sözü, Jarvis\'in sözcüklerini yinelese de komuttur', async () => {
    const h = setup();
    await speaking(h, ['Bir zamanlar küçük bir sahil kasabasında yaşlı bir saat ustası yaşarmış.']);
    await vi.advanceTimersByTimeAsync(3000);
    await h.utter('Saat ustası mı dedin?');
    expect(h.turns).toHaveLength(2);
    expect(h.turns[1]?.request.text).toBe('Saat ustası mı dedin?');
    expect(h.io.calls).not.toContain('self');
  });

  it('onay sorusunun kendi sesi yanıt sanılmaz: "anlayamadım" diye yeniden sorulmaz', async () => {
    const h = leaky(200);
    await h.utter('Jarvis, dosyayı sil');
    h.approvals.pending = [{ id: 'a1', summary: 'Dosya silinecek.' } as never];
    h.session.onApprovalRequest('a1' as never, 'Dosya silinecek.');
    const stream = await h.play(1500, { finish: false });
    const echo = h.nextSegment();
    h.session.onSpeechStart(echo, 300);
    h.session.onPlaybackEnded(stream, 1500, false);
    await h.flush();
    expect(h.session.status().state).toBe('listening');
    const asked = h.io.spoken.length;
    const consulted = h.approvals.speech.length;
    await vi.advanceTimersByTimeAsync(700);
    h.io.transcripts.push('Dosya silinecek. Onaylıyor musunuz?');
    h.session.onSpeechEnd(echo, h.pcm, 1800);
    await vi.advanceTimersByTimeAsync(100);
    expect(h.io.spoken).toHaveLength(asked);
    expect(h.approvals.speech).toHaveLength(consulted);

    // Gerçek yanıt onayı sonuçlandırır.
    await vi.advanceTimersByTimeAsync(1500);
    await h.utter('Evet, onaylıyorum.');
    expect(h.approvals.resolved).toEqual([{ id: 'a1', decision: 'approved', by: 'voice' }]);
  });

  it('uyandırma gecikmesi iki yol için ayrı ayrı ölçülür', async () => {
    const h = setup();
    const segment = h.nextSegment();
    h.session.onSpeechStart(segment, 300);
    await vi.advanceTimersByTimeAsync(500);
    h.session.onWake('hey jarvis', 0.15);
    expect(h.session.wakeLatencies().kws).toMatchObject({ sinceSpeechStartMs: 800, sinceSpeechEndMs: null });
    expect(h.session.wakeLatencies().whisper).toBeNull();

    const g = setup();
    await g.utter('Hey Jarvis');
    expect(g.session.wakeLatencies().whisper).toMatchObject({ sttMs: 120 });
    expect(g.session.wakeLatencies().whisper?.sinceSpeechEndMs).toBeGreaterThanOrEqual(600);
  });
});

describe('ortam kipi (boştayken duyulan söz tur açmadan yayınlanır)', () => {
  /** Politika izinli, kullanıcı rıza vermiş, kip açık. */
  const ambient = () => {
    const h = setup((policy) => void (policy.ambient.allowed = true));
    h.settings.ambientConsentAt = '2026-11-16T10:00:00.000Z' as never;
    h.session.setAmbient(true);
    return h;
  };

  it('varsayılan kapalıdır; açılınca durumda görünür', () => {
    const h = setup();
    expect(h.session.status().ambient).toBe(false);
    h.session.setAmbient(true);
    expect(h.session.status().ambient).toBe(true);
    expect(h.of('voice.status').at(-1)?.ambient).toBe(true);
  });

  it('boştayken uyandırma sözüyle başlamayan söz olay olur, tur açmaz', async () => {
    const h = ambient();
    await h.utter('Yarın muhasebeciyle toplantı var, unutmayalım.', 2400);
    expect(h.turns).toHaveLength(0);
    expect(h.states()).toEqual([]);
    const [event] = h.of('voice.ambient');
    expect(event).toMatchObject({ text: 'Yarın muhasebeciyle toplantı var, unutmayalım.', durationMs: 2400, source: 'mic', lang: 'tr' });
    expect(Date.parse(event?.endedAt ?? '') - Date.parse(event?.startedAt ?? '')).toBe(2400);
    // Aynı döküm kullanılır: uyandırma için yapılan yazıya çevirmeden başka iş yok.
    expect(h.io.calls.filter((call) => call === 'transcribe')).toHaveLength(1);
  });

  it('uyandırma sözüyle başlayan söz olağan tura gider, ortam olayına değil', async () => {
    const h = ambient();
    await h.utter('Jarvis, saat kaç?');
    expect(h.turns).toHaveLength(1);
    expect(h.of('voice.ambient')).toHaveLength(0);
  });

  it.each([
    ['politika izin vermiyorsa', (h: ReturnType<typeof setup>) => void (h.policy.ambient.allowed = false)],
    ['kullanıcı rıza vermediyse', (h: ReturnType<typeof setup>) => void (h.settings.ambientConsentAt = null)],
    ['kip kapatıldıysa', (h: ReturnType<typeof setup>) => h.session.setAmbient(false)],
    ['dinleme duraklatıldıysa', (h: ReturnType<typeof setup>) => h.session.pauseWake(5)],
    ['acil durdurma etkinse', (h: ReturnType<typeof setup>) => void (h.policy.killSwitch.active = true)],
  ])('%s olay çıkmaz', async (_label, change) => {
    const h = ambient();
    change(h);
    await h.utter('Bugün hava çok güzel.');
    expect(h.of('voice.ambient')).toHaveLength(0);
    expect(h.turns).toHaveLength(0);
  });

  it('gürültü ve halüsinasyon (boş döküm) olay olmaz', async () => {
    const h = ambient();
    await h.utter('');
    expect(h.of('voice.ambient')).toHaveLength(0);
  });

  it('asistan konuşurken ve takip penceresinde söylenen söz ortam olayı olmaz', async () => {
    const h = ambient();
    await h.utter('Jarvis, bana bir şey anlat');
    h.turns[0]?.say('Bir zamanlar bir saat ustası yaşarmış.');
    h.turns[0]?.finish();
    await h.flush();
    const stream = await h.play(3000, { finish: false });
    await h.utter('Bu arada çay demledin mi?', 1500);
    expect(h.of('voice.ambient')).toHaveLength(0);
    h.session.onPlaybackEnded(stream, 3000, false);
    await vi.advanceTimersByTimeAsync(2000);
    // İkinci söz, ilki düşünülürken geldi: yeni söz eskisinin yerini alır (iş sürerken dinleme açık).
    await h.utter('Peki sonra ne olmuş?');
    expect(h.turns).toHaveLength(3);
    expect(h.turns[1]?.request.signal?.aborted).toBe(true);
    expect(h.of('voice.ambient')).toHaveLength(0);
  });

  it('Jarvis\'in kendi sesinin yankısı ortam olayı olmaz (bildirim okunduktan sonra boşa dönülmüşken)', async () => {
    const h = setup((policy) => {
      policy.ambient.allowed = true;
      policy.voice.followUpSeconds = 1;
    });
    h.settings.ambientConsentAt = '2026-11-16T10:00:00.000Z' as never;
    h.session.setAmbient(true);
    void h.session.speak('Çay demleme zamanı geldi efendim.');
    await h.flush();
    await h.play(2500);
    await vi.advanceTimersByTimeAsync(1200);
    expect(h.session.status().state).toBe('idle');
    // Gecikmeli hoparlör: cümlenin tamamı çalma bittikten sonra mikrofona geliyor.
    await h.utter('Çay demleme zamanı geldi efendim.');
    expect(h.of('voice.ambient')).toHaveLength(0);
    expect(h.turns).toHaveLength(0);
    // Başka bir söz ise olaydır.
    await h.utter('Tamam, birazdan demlerim.');
    expect(h.of('voice.ambient').map((event) => event.text)).toEqual(['Tamam, birazdan demlerim.']);
  });

  it('uzun söz (uyandırma için bakılmayan) sıraya girer; sesli tur sürerken bekler, tur bitince çevrilir', async () => {
    const h = ambient();
    // Kullanıcı konuşuyor (yeni söz başladı): uzun bölüt bekler.
    h.io.transcripts.push('Uzun bir toplantı konuşması burada geçti ve kimse asistana seslenmedi.');
    const long = h.nextSegment();
    h.session.onSpeechStart(long, 300);
    const next = h.nextSegment();
    h.session.onSpeechEnd(long, h.pcm, 14_000);
    h.session.onSpeechStart(next, 300);
    await h.flush();
    // Uzun bölütün bitişinde söz yoktu: hemen çevrilir.
    expect(h.of('voice.ambient')).toHaveLength(1);
    expect(h.of('voice.ambient')[0]).toMatchObject({ durationMs: 14_000 });

    // İkinci uzun bölüt, uyandırılmış ve komut beklenen bir anda biterse sıraya girer ve beklemede kalır.
    const g = ambient();
    const first = g.nextSegment();
    g.session.onSpeechStart(first, 300);
    g.session.onWake('hey jarvis', 0.2);
    expect(g.session.status().state).toBe('listening');
    g.io.transcripts.push('saat kaç');
    g.session.onSpeechEnd(first, g.pcm, 1500);
    await g.flush();
    expect(g.turns).toHaveLength(1);
    expect(g.of('voice.ambient')).toHaveLength(0);
  });

  it('kip kapalıyken boştaki uzun söz yazıya çevrilmez (eski davranış)', async () => {
    const h = setup();
    await h.utter('çok uzun bir konuşma', 14_000);
    expect(h.io.calls).not.toContain('transcribe');
  });
});

describe('doğal söz kesme: yankı sızan cihazda da (yankı gidericinin kanısıyla)', () => {
  const REPLY = ['Bir zamanlar küçük bir sahil kasabasında yaşlı bir saat ustası yaşarmış.', 'Dükkanının vitrininde yüzlerce saat dururmuş.'];

  /** Ham sızıntısı bilinen cihaz (eski yankı ölçümü): söz kesme `voice` kalır, yankı giderici ayırt eder. */
  const speaking = async () => {
    const h = setup();
    h.session.setEchoSuspected(true);
    await h.utter('Jarvis, bana bir hikaye anlat');
    for (const sentence of REPLY) h.turns[0]?.say(sentence);
    await h.flush();
    const stream = await h.play(4000, { finish: false });
    expect(h.session.status()).toMatchObject({ state: 'speaking', bargeIn: 'voice' });
    return { h, stream };
  };

  it('giderici "kullanıcı" diyorsa Jarvis hemen susar ve dinler; söz başından itibaren komuttur', async () => {
    const { h } = await speaking();
    const segment = h.nextSegment();
    h.session.onSpeechStart(segment, 314, 0.9);
    expect(h.states().at(-1)).toBe('listening:barge_in');
    expect(h.io.calls).toContain('stop');
    expect(h.io.calls).not.toContain('duck');
    h.io.transcripts.push('Bir dakika, başka bir şey soracağım.');
    h.session.onSpeechEnd(segment, h.pcm, 2400);
    await h.flush();
    expect(h.turns[1]?.request.text).toBe('Bir dakika, başka bir şey soracağım.');
  });

  it('giderici "yankı" diyorsa hiçbir şey olmaz: Jarvis kendi sesiyle susmaz', async () => {
    const { h } = await speaking();
    const before = h.io.calls.length;
    h.session.onSpeechStart(h.nextSegment(), 314, 0.05);
    expect(h.session.status().state).toBe('speaking');
    expect(h.io.calls.slice(before)).toEqual([]);
  });

  it('kararsızsa ses kısılır; kullanıcı olduğu anlaşılınca susulur', async () => {
    const { h } = await speaking();
    const segment = h.nextSegment();
    h.session.onSpeechStart(segment, 314, 0.4);
    expect(h.session.status().state).toBe('speaking');
    expect(h.io.calls.at(-1)).toBe('duck');
    await vi.advanceTimersByTimeAsync(200);
    h.session.onSpeechNear(segment);
    expect(h.states().at(-1)).toBe('listening:barge_in');
    expect(h.io.calls).not.toContain('unduck');
  });

  it('kararsızsa ses kısılır; kullanıcı çıkmazsa ses geri açılır ve Jarvis sürdürür', async () => {
    const { h, stream } = await speaking();
    h.session.onSpeechStart(h.nextSegment(), 314, 0.4);
    expect(h.io.calls.at(-1)).toBe('duck');
    await vi.advanceTimersByTimeAsync(500);
    expect(h.io.calls.at(-1)).toBe('unduck');
    expect(h.session.status().state).toBe('speaking');
    // Aday bölüt doğrulama bitmeden kapanırsa da ses geri açılır.
    const short = h.nextSegment();
    h.session.onSpeechStart(short, 314, 0.3);
    h.io.transcripts.push('');
    h.session.onSpeechEnd(short, h.pcm, 300);
    expect(h.io.calls.filter((call) => call === 'unduck')).toHaveLength(2);
    h.session.onPlaybackEnded(stream, 8000, false);
  });

  it('yankıyla başlayan söze kullanıcı sonradan katılırsa yine susulur', async () => {
    const { h } = await speaking();
    const segment = h.nextSegment();
    h.session.onSpeechStart(segment, 314, 0.1);
    await vi.advanceTimersByTimeAsync(900);
    h.session.onSpeechNear(segment);
    expect(h.states().at(-1)).toBe('listening:barge_in');
  });

  it('d6 kaba kanıt (giderici yakınsamadı, Bluetooth): hemen susmaz; önce ses kısılır, kısıkken ikinci kanıtla susar', async () => {
    const { h } = await speaking();
    const segment = h.nextSegment();
    h.session.onSpeechStart(segment, 314, 0.9, true);
    expect(h.session.status().state).toBe('speaking');
    expect(h.io.calls).not.toContain('stop');
    expect(h.io.calls.at(-1)).toBe('duck');
    await vi.advanceTimersByTimeAsync(300);
    h.session.onSpeechNear(segment, true);
    expect(h.states().at(-1)).toBe('listening:barge_in');
    expect(h.io.calls).toContain('stop');
  });

  it('d6 kaba kanıt: kısık seste kullanıcı çıkmazsa ses geri açılır, Jarvis sürdürür; sonraki ilk kanıt yine yalnız kısar', async () => {
    const { h } = await speaking();
    const segment = h.nextSegment();
    h.session.onSpeechStart(segment, 314, 0.1, true);
    expect(h.io.calls).not.toContain('duck');
    h.session.onSpeechNear(segment, true);
    expect(h.io.calls.at(-1)).toBe('duck');
    expect(h.session.status().state).toBe('speaking');
    await vi.advanceTimersByTimeAsync(1600);
    expect(h.io.calls.at(-1)).toBe('unduck');
    h.session.onSpeechNear(segment, true);
    expect(h.io.calls.at(-1)).toBe('duck');
    expect(h.session.status().state).toBe('speaking');
  });

  it('d6: yankı sınamasının "sızıyor" sonucu, giderici yankıyı görebiliyorsa söz kesmeyi `wake`e indirmez', async () => {
    const h = setup();
    // Deneme bayrağı varsayılan kapalı: eski davranış ("sızıyor" → wake).
    h.session.setEchoLeaks(true, 'echo_test');
    expect(h.session.status()).toMatchObject({ bargeIn: 'wake', bargeInBlockedBy: 'echo_test' });
    h.session.setCoarseBarge(true);
    expect(h.session.status()).toMatchObject({ bargeIn: 'voice', bargeInBlockedBy: null });
    // Kör giderici: indirir; giderici sonradan yankıyı görürse kip kendiliğinden geri açılır.
    h.session.setEchoLeaks(true, 'echo_test', true);
    expect(h.session.status()).toMatchObject({ bargeIn: 'wake', bargeInBlockedBy: 'echo_test' });
    h.session.setCancellerCoupled(true);
    expect(h.session.status().bargeIn).toBe('voice');
    // Gözlenen kendini kesme her zaman indirir.
    h.session.setEchoLeaks(true, 'self_interrupt');
    expect(h.session.status()).toMatchObject({ bargeIn: 'wake', bargeInBlockedBy: 'self_interrupt' });
  });

  it('giderici henüz öğrenmediyse: sızdığı bilinen cihazda aday söz kesmez, bilinmeyen cihazda eskisi gibi keser', async () => {
    const { h } = await speaking();
    h.session.onSpeechStart(h.nextSegment(), 314);
    expect(h.session.status().state).toBe('speaking');

    const clean = setup();
    await clean.utter('Jarvis, bana bir hikaye anlat');
    clean.turns[0]?.say(REPLY[0] ?? '');
    await clean.flush();
    await clean.play(4000, { finish: false });
    clean.session.onSpeechStart(clean.nextSegment(), 314);
    expect(clean.states().at(-1)).toBe('listening:barge_in');
  });

  it('çalma bittikten hemen sonra başlayan söz, giderici yankı beklemiyorsa atılmaz ve şüpheli sayılmaz', async () => {
    const { h, stream } = await speaking();
    h.turns[0]?.finish();
    h.session.onPlaybackEnded(stream, 8000, false);
    await h.flush();
    expect(h.session.status().state).toBe('followup');
    // Çalma biteli 100 ms oldu; giderici "yankı beklenmiyor" (null) diyor: tek sözcüklük yanıt bile komuttur.
    await vi.advanceTimersByTimeAsync(100);
    const segment = h.nextSegment();
    h.io.transcripts.push('Yaşarmış.');
    h.session.onSpeechStart(segment, 60, null);
    h.session.onSpeechEnd(segment, h.pcm, 700);
    await h.flush();
    expect(h.turns).toHaveLength(2);
    expect(h.io.calls.filter((call) => call === 'earcon:heard')).toHaveLength(2);
  });

  it('söz kesme sınaması: konuşmayı kesen söz tur açmaz, kullanıcı mı kendi sesi mi diye bildirilir', async () => {
    const h = setup();
    const seen: Array<{ self: boolean; text: string }> = [];
    h.session.setBargeTest((info) => seen.push(info));
    void h.session.speak('Söz kesme sınaması başlıyor. Ben bu cümleleri okurken lütfen araya girin.');
    await h.flush();
    await h.play(5000, { finish: false });
    const user = h.nextSegment();
    h.session.onSpeechStart(user, 314, 0.9);
    h.io.transcripts.push('Bir dakika.');
    h.session.onSpeechEnd(user, h.pcm, 900);
    await h.flush();
    expect(seen).toEqual([{ self: false, text: 'Bir dakika.' }]);
    expect(h.turns).toHaveLength(0);
    expect(h.session.status().state).toBe('idle');

    void h.session.speak('İkinci bölüme geçiyorum. Yine istediğiniz an sözümü kesin.');
    await h.flush();
    await h.play(5000, { finish: false });
    await vi.advanceTimersByTimeAsync(300);
    const own = h.nextSegment();
    h.session.onSpeechStart(own, 314, 0.9);
    h.io.transcripts.push('İkinci bölüme');
    h.session.onSpeechEnd(own, h.pcm, 600);
    await h.flush();
    expect(seen[1]).toEqual({ self: true, text: 'İkinci bölüme' });
    expect(h.turns).toHaveLength(0);
  });

  it('adaya giden yanıtta ifade etiketi görünmez', async () => {
    const h = setup();
    await h.utter('Jarvis, bir fıkra anlat');
    h.turns[0]?.say('<laugh> Bu çok komikti [sighs] efendim.');
    h.turns[0]?.finish();
    await h.flush();
    await h.play(1500);
    const shown = h.of('voice.partial').filter((item) => item.role === 'assistant').map((item) => item.text);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((text) => text === 'Bu çok komikti efendim.')).toBe(true);
    // Motora giden cümle etiketiyle kalır: motor destekliyorsa kendi yazımına çevrilir.
    expect(h.io.spoken[0]?.text).toBe('<laugh> Bu çok komikti [sighs] efendim.');
  });
});

describe('toplantı kipi (mikrofon ve bilgisayar sesi tur açmadan yazıya dökülür)', () => {
  const meeting = () => {
    const h = setup();
    const languages: Array<string | undefined> = [];
    const io = (h.session as unknown as { deps: SessionDeps }).deps.io;
    const transcribe = io.transcribe.bind(io);
    io.transcribe = (pcm, options) => {
      languages.push(options?.language);
      return transcribe(pcm, options);
    };
    h.session.setMeeting(true, { systemLanguage: 'en' });
    return { ...h, languages };
  };

  it('açılınca uyandırma kapanır, durumda görünür; adla başlayan söz de toplantı satırıdır', async () => {
    const h = meeting();
    expect(h.session.status().meeting).toMatchObject({ on: true, system: 'off', queued: 0 });
    expect(h.io.calls).toContain('wake:false');
    await h.utter('Jarvis, bu konuyu sonra konuşalım.', 2000);
    expect(h.turns).toHaveLength(0);
    expect(h.of('voice.wake')).toHaveLength(0);
    expect(h.of('voice.meeting')).toEqual([expect.objectContaining({ text: 'Jarvis, bu konuyu sonra konuşalım.', source: 'mic', durationMs: 2000, lang: 'tr' })]);
    h.session.onWake('hey jarvis', 0.9);
    expect(h.session.status().state).toBe('idle');
  });

  it('uzun söz de (10 sn üstü) yazılır; ortam kipi bölüt almaz (çift kayıt yok)', async () => {
    const h = meeting();
    h.policy.ambient.allowed = true;
    h.settings.ambientConsentAt = '2026-11-16T10:00:00.000Z' as never;
    h.session.setAmbient(true);
    await h.utter('Uzun bir açıklama yapıyorum, bütçe ve takvim konusunda.', 14_000);
    expect(h.of('voice.meeting')).toHaveLength(1);
    expect(h.of('voice.ambient')).toHaveLength(0);
  });

  it('bilgisayar sesi bölütü istenen dille yazıya çevrilir ve "system" kaynağıyla yayınlanır', async () => {
    const h = meeting();
    h.io.results.push({ text: 'Could you send the offer?', raw: 'Could you send the offer?', dropped: null, durationMs: 90, languageConfidence: 0.95, detectedLanguage: 'en' });
    h.session.onSystemSpeech(h.pcm, 1800);
    await h.flush();
    expect(h.languages).toEqual(['en']);
    expect(h.of('voice.meeting')[0]).toMatchObject({ source: 'system', text: 'Could you send the offer?', detectedLang: 'en', lang: 'en' });
  });

  it('kısayolla açılan tur önce gelir; yanıt seslendirilmez ve takip penceresi açılmaz', async () => {
    const h = meeting();
    h.session.startListening('hotkey');
    expect(h.session.status().state).toBe('listening');
    // Tur sürerken gelen bilgisayar sesi bekler (ekran kartı önce sesli tura).
    await h.utter('saat kaç?');
    h.io.transcripts.push('One more thing.');
    h.session.onSystemSpeech(h.pcm, 1500);
    await h.flush();
    expect(h.turns).toHaveLength(1);
    expect(h.of('voice.meeting')).toHaveLength(0);
    h.turns[0]?.say('Saat on.');
    h.turns[0]?.finish();
    await h.flush();
    expect(h.io.spoken).toHaveLength(0);
    expect(h.of('voice.partial').some((event) => event.role === 'assistant' && event.text === 'Saat on.')).toBe(true);
    expect(h.session.status().state).toBe('idle');
    await h.flush();
    expect(h.of('voice.meeting')).toHaveLength(1);
  });

  it('mikrofondaki söz başka dildeyse (hoparlörden kaçan karşı taraf) o dilde yeniden yazılır: Whisper çevirmesin', async () => {
    const h = meeting();
    h.io.results.push(
      { text: 'Teslimatı gelecek haftaya alabiliriz.', raw: '', dropped: null, durationMs: 90, languageConfidence: 0.9, detectedLanguage: 'en' },
      { text: 'We can move the delivery to next week.', raw: '', dropped: null, durationMs: 90, languageConfidence: 0.9, detectedLanguage: 'en' },
    );
    h.io.transcripts.push('', '');
    h.session.onSpeechStart(h.nextSegment());
    h.session.onSpeechEnd(h.nextSegment() - 1, h.pcm, 2500);
    await h.flush();
    await h.flush();
    expect(h.languages).toEqual([undefined, 'en']);
    expect(h.of('voice.meeting')[0]).toMatchObject({ source: 'mic', text: 'We can move the delivery to next week.', lang: 'en' });
  });

  it('bildirim seslendirilmez (toplantıda Jarvis sesli konuşmaz)', async () => {
    const h = meeting();
    await expect(h.session.speak('Saat üçte toplantınız var.')).resolves.toEqual({ spoken: false });
    expect(h.io.spoken).toHaveLength(0);
  });

  it('kapanınca sıra boşalır, uyandırma geri gelir; kip kapalıyken bilgisayar sesi yok sayılır', async () => {
    const h = meeting();
    h.session.setMeeting(false);
    expect(h.session.status().meeting?.on).toBe(false);
    expect(h.io.calls.at(-1)).toBe('wake:true');
    h.session.onSystemSpeech(h.pcm, 1500);
    await h.flush();
    expect(h.of('voice.meeting')).toHaveLength(0);
  });
});

describe('demo.3 bütünleşmesi: toplantı kipi + veda + sohbet kipi birlikte', () => {
  const inMeeting = () => {
    const h = setup();
    h.session.setMeeting(true);
    return h;
  };

  it('toplantıda söylenen veda ("görüşürüz") toplantının sözüdür: tur açılmaz, Jarvis veda etmez, toplantı sürer', async () => {
    const h = inMeeting();
    await h.utter('Görüşürüz, iyi geceler.', 1800);
    expect(h.turns).toHaveLength(0);
    expect(h.io.spoken).toHaveLength(0);
    expect(h.of('voice.meeting')).toEqual([expect.objectContaining({ source: 'mic', text: 'Görüşürüz, iyi geceler.' })]);
    expect(h.session.status().meeting?.on).toBe(true);
    expect(h.session.status().state).toBe('idle');
  });

  it('kısayolla açılan turda veda: yazıyla veda edilir (ses yok), boşa dönülür; toplantı ve uyandırma kuralı değişmez', async () => {
    const h = inMeeting();
    h.session.startListening('hotkey');
    await h.utter('Güle güle.');
    await h.flush();
    expect(h.turns).toHaveLength(0);
    expect(h.io.spoken).toHaveLength(0);
    expect(h.of('voice.partial').some((event) => event.role === 'assistant' && /Görüşürüz/.test(event.text))).toBe(true);
    expect(h.session.status()).toMatchObject({ state: 'idle', conversation: false, micMuted: false });
    expect(h.session.status().meeting?.on).toBe(true);
    // Toplantıda uyandırma kapalı kalır (veda onu açmaz); toplantı bitince geri gelir.
    expect(h.io.calls.filter((call) => call.startsWith('wake:')).at(-1)).toBe('wake:false');
    h.session.setMeeting(false);
    expect(h.io.calls.at(-1)).toBe('wake:true');
  });

  it('toplantıda sohbet kipi açılmaz: sözle de araçla da; nedeni yazıyla söylenir', async () => {
    const h = inMeeting();
    h.policy.voice.conversationMode = true;
    expect(h.session.startConversation()).toBe(false);
    h.session.startListening('hotkey');
    await h.utter('Sohbet edelim.');
    await h.flush();
    expect(h.session.status()).toMatchObject({ state: 'idle', conversation: false });
    expect(h.turns).toHaveLength(0);
    expect(h.io.spoken).toHaveLength(0);
    expect(h.of('voice.partial').some((event) => event.role === 'assistant' && event.text.includes('Toplantı kipi açıkken sohbet kipi açılmıyor'))).toBe(true);
    // Sonraki söz komut değil, toplantının sözüdür.
    await h.utter('Bütçeyi yüzde on artıralım.', 2000);
    expect(h.turns).toHaveLength(0);
    expect(h.of('voice.meeting')).toHaveLength(1);
  });

  it('sohbet kipi açıkken toplantı başlarsa kip biter; toplantı bitince kendiliğinden geri gelmez', async () => {
    const h = setup();
    h.policy.voice.conversationMode = true;
    expect(h.session.startConversation()).toBe(true);
    expect(h.session.status().conversation).toBe(true);
    h.session.setMeeting(true);
    expect(h.session.status()).toMatchObject({ conversation: false, state: 'idle' });
    h.session.setMeeting(false);
    expect(h.session.status().conversation).toBe(false);
    // Toplantıdan sonra veda sözü olağan çalışır: uyandır, veda et → sesli veda, boş.
    h.session.startListening('hotkey');
    await h.utter('Güle güle.');
    await h.flush();
    expect(h.io.spoken.map((item) => item.text).join(' ')).toMatch(/Görüşürüz/);
  });
});

describe('tur akışı (d4): uzun iş kesilmez, neden söylenir, araya girilir, onay kısa sorulur', () => {
  /** Dinleme açılır, kullanıcı `text` der; beyin turu başlar. */
  const begin = async (text = 'WhatsApp’ta Ahmet’e mesaj at', h = setup()) => {
    h.session.startListening('hotkey');
    await h.utter(text);
    const turn = h.turns.at(-1)!;
    const call = (event: ToolCallEvent) => turn.request.onToolCall?.(event);
    /** Bir araç adımı: başlar, `ms` sürer, biter. */
    const step = async (id: string, name: string, input: unknown, ms: number, result: { ok: boolean; text: string } = { ok: true, text: 'tamam' }) => {
      call({ phase: 'start', callId: id, name, input });
      await vi.advanceTimersByTimeAsync(ms);
      call({ phase: 'end', callId: id, name, ...result, durationMs: ms });
    };
    return { h, turn, call, step };
  };

  it('60 sn’yi aşan çok adımlı araç zinciri kesilmez; her adım ada satırına düşer', async () => {
    const { h, turn, step } = await begin();
    h.settings.spokenProgress = false;
    await step('c1', 'app_open', { name: 'WhatsApp' }, 4000);
    for (let i = 0; i < 9; i++) {
      // Model adımı (≈3 sn) + ekrana bakma (≈6 sn) + tıklama (≈1 sn): gerçek bir oturum günlüğündeki sıra.
      await vi.advanceTimersByTimeAsync(3000);
      await step(`look${i}`, 'screen_look', {}, 6000);
      await step(`click${i}`, 'pc_click', { name: 'Ara' }, 1000);
    }
    // 94 sn geçti: eski bekçi (20 sn, yalnız cümle sayıyordu) ilk ekrana bakmada kesmişti.
    expect(turn.request.signal?.aborted).toBe(false);
    expect(h.of('voice.error')).toHaveLength(0);
    expect(h.session.status().state).toBe('thinking');
    const steps = h.of('voice.activity').map((item) => item.step);
    expect(steps).toContain(t('turn.step.app_open', { target: '“WhatsApp”' }));
    expect(steps).toContain(t('turn.step.screen_look'));
    expect(steps).toContain(t('turn.step.pc_click', { target: '“Ara”' }));
    expect(h.of('voice.activity').at(-1)).toMatchObject({ done: 19, failed: null });

    turn.say('Mesajı yazdım.');
    turn.finish();
    await h.flush();
    await h.play();
    expect(h.states().at(-1)).toBe('followup:speech_done');
    // Tur bitince adım satırı kalkar.
    expect(h.of('voice.activity').at(-1)).toMatchObject({ turnId: null, step: null });
  });

  it('araç ara durum bildirirse satır odur ve bekçi baştan başlar', async () => {
    const { h, turn, call } = await begin('şu sayfayı araştır');
    h.settings.spokenProgress = false;
    call({ phase: 'start', callId: 'r1', name: 'web_read', input: { url: 'https://example.com' } });
    // Adres çubuğu satıra girmez: yalnız genel cümle.
    expect(h.of('voice.activity').at(-1)?.step).toBe(t('turn.step.web_read'));
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(VOICE_TUNING.toolStallMs - 5000);
      call({ phase: 'report', callId: 'r1', name: 'web_read', step: `Sayfa ${i + 1} okunuyor` });
    }
    expect(turn.request.signal?.aborted).toBe(false);
    expect(h.of('voice.activity').at(-1)?.step).toBe('Sayfa 5 okunuyor');
  });

  it('sesli ilerleme: iş sürerken sessiz kalınca o anki adım bir kez söylenir; aynı cümle yinelenmez', async () => {
    const { h, turn, call } = await begin();
    turn.say('Hemen.');
    await h.play(600);
    call({ phase: 'start', callId: 'c1', name: 'app_open', input: { name: 'WhatsApp' } });
    await vi.advanceTimersByTimeAsync(VOICE_TUNING.progressQuietMs - 1000);
    expect(h.io.spoken.map((item) => item.text)).toEqual(['Hemen.']);
    await vi.advanceTimersByTimeAsync(2500);
    const line = `${t('turn.step.app_open', { target: '“WhatsApp”' })}.`;
    expect(h.io.spoken.at(-1)?.text).toBe(line);
    // Aynı adım sürüyor: ikinci kez söylenmez.
    await vi.advanceTimersByTimeAsync(VOICE_TUNING.progressQuietMs * 2);
    expect(h.io.spoken.filter((item) => item.text === line)).toHaveLength(1);
    call({ phase: 'end', callId: 'c1', name: 'app_open', ok: true, text: 'açıldı', durationMs: 30_000 });
    call({ phase: 'start', callId: 'c2', name: 'pc_find', input: { name: 'Ahmet' } });
    await vi.advanceTimersByTimeAsync(VOICE_TUNING.progressQuietMs + 500);
    expect(h.io.spoken.at(-1)?.text).toBe(`${t('turn.step.pc_find', { target: '“Ahmet”' })}.`);

    // İlerleme cümleleri beynin yanıtı değildir: son altyazıya ve döküme girmez.
    call({ phase: 'end', callId: 'c2', name: 'pc_find', ok: true, text: 'bulundu', durationMs: 9500 });
    turn.say('Mesajı gönderdim.');
    turn.finish();
    await h.flush();
    await h.play();
    const final = h.of('voice.partial').filter((item) => item.role === 'assistant' && item.final).at(-1);
    expect(final?.text).toBe('Hemen. Mesajı gönderdim.');
  });

  it('sesli ilerleme kapalıysa hiçbir şey söylenmez (ada satırı yine yayınlanır)', async () => {
    const { h, call } = await begin();
    h.settings.spokenProgress = false;
    call({ phase: 'start', callId: 'c1', name: 'app_open', input: { name: 'WhatsApp' } });
    await vi.advanceTimersByTimeAsync(VOICE_TUNING.progressQuietMs * 3);
    expect(h.io.spoken).toHaveLength(0);
    expect(h.of('voice.activity').at(-1)?.step).toBe(t('turn.step.app_open', { target: '“WhatsApp”' }));
  });

  it('araç gerçekten donarsa hangi adımın bitmediği söylenir; sohbet açık kalır ve "evet" ile yeniden denenir', async () => {
    const { h, turn, call } = await begin('Ahmet’e yaz');
    h.settings.spokenProgress = false;
    call({ phase: 'start', callId: 'c1', name: 'pc_type', input: { text: 'gizli metin' } });
    await vi.advanceTimersByTimeAsync(VOICE_TUNING.toolStallMs - 500);
    expect(turn.request.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(turn.request.signal?.aborted).toBe(true);
    const said = h.io.spoken.at(-1)?.text ?? '';
    expect(said).toBe(t('turn.frozenTool', { step: t('turn.step.pc_type'), seconds: 300 }));
    // Yazılan metin satıra ve söze girmez.
    expect(said).not.toContain('gizli');
    expect(h.of('voice.error').at(-1)).toMatchObject({ code: 'timeout', retry: true });
    await h.play(2500);
    expect(h.states().at(-1)).toBe('followup:timeout');

    await h.utter('Evet.');
    expect(h.turns).toHaveLength(2);
    expect(h.turns[1]?.request.text).toBe('Ahmet’e yaz');
    expect(h.session.status().canRetry).toBe(false);
  });

  it('"yeniden dene" sözü ve ada düğmesi son başarısız sözü yeniden yürütür', async () => {
    const { h, turn } = await begin('saat kaç');
    turn.finish({ stopReason: 'error', error: 'Claude’a şu an ulaşılamıyor.' });
    await h.flush();
    expect(h.io.spoken.at(-1)?.text).toBe('Claude’a şu an ulaşılamıyor.');
    expect(h.of('voice.error').at(-1)).toMatchObject({ retry: true });
    await h.play();
    expect(h.states().at(-1)).toBe('followup:error');

    await h.utter('Yeniden dene.');
    expect(h.turns[1]?.request.text).toBe('saat kaç');
    h.turns[1]?.finish({ stopReason: 'error', error: 'Claude’a şu an ulaşılamıyor.' });
    await h.flush();
    await h.play();
    expect(h.session.retryLast()).toBe(true);
    expect(h.turns[2]?.request.text).toBe('saat kaç');
    expect(h.session.retryLast()).toBe(false);
  });

  it('adım başarısız olur ve model susarsa NE olduğu söylenir; sohbet açık kalır', async () => {
    const { h, turn, step } = await begin();
    h.settings.spokenProgress = false;
    await step('c1', 'app_open', { name: 'WhatsApp' }, 2000);
    await step('c2', 'pc_find', { name: 'Ara' }, 3000, { ok: false, text: 'Araç hata verdi: “WhatsApp” penceresinde arama kutusunu bulamadım. Pencereyi öne alıp yeniden dene.' });
    expect(h.of('voice.activity').at(-1)?.failed).toBe('“WhatsApp” penceresinde arama kutusunu bulamadım.');
    turn.finish();
    await h.flush();
    expect(h.io.spoken.at(-1)?.text).toBe('“WhatsApp” penceresinde arama kutusunu bulamadım.');
    await h.play();
    expect(h.states().at(-1)).toBe('followup:speech_done');
    expect(h.of('voice.error')).toHaveLength(0);
  });

  it('iptal edilen araç başarısızlık sayılmaz; sonraki başarılı adım eski hatayı siler', async () => {
    const { h, step } = await begin();
    h.settings.spokenProgress = false;
    await step('c1', 'web_read', {}, 1000, { ok: false, text: t('tool.error.aborted') });
    expect(h.of('voice.activity').at(-1)?.failed).toBeNull();
    await step('c2', 'pc_click', { name: 'Ara' }, 1000, { ok: false, text: 'Öğe bulunamadı.' });
    expect(h.of('voice.activity').at(-1)?.failed).toBe('Öğe bulunamadı.');
    await step('c3', 'pc_click', { name: 'Ara' }, 1000);
    expect(h.of('voice.activity').at(-1)?.failed).toBeNull();
  });

  it('iş sürerken yeni söz: süren tur bırakılır, araçlar iptal edilir, söz hemen işlenir', async () => {
    const { h, turn, call } = await begin();
    h.settings.spokenProgress = false;
    call({ phase: 'start', callId: 'c1', name: 'app_open', input: { name: 'WhatsApp' } });
    await vi.advanceTimersByTimeAsync(4000);
    await h.utter('Vazgeç, onun yerine Ali’ye yaz', 2600);
    expect(turn.request.signal?.aborted).toBe(true);
    expect(h.turns).toHaveLength(2);
    expect(h.turns[1]?.request.text).toBe('Vazgeç, onun yerine Ali’ye yaz');
    expect(h.session.status().state).toBe('thinking');
    expect(h.io.calls).toContain('earcon:heard');
    // Bırakılan turun adım satırı kalkar, yenisinin "düşünüyorum" satırı gelir.
    expect(h.of('voice.activity').at(-1)).toMatchObject({ step: t('turn.step.thinking'), done: 0 });
  });

  it('iş sürerken "iptal" / "vazgeç" / "dur": iş durur, yanıt beklenmez, sohbet açık kalır', async () => {
    for (const word of ['İptal.', 'Vazgeç', 'Jarvis dur']) {
      const { h, turn, call } = await begin();
      h.settings.spokenProgress = false;
      call({ phase: 'start', callId: 'c1', name: 'app_open', input: { name: 'WhatsApp' } });
      await vi.advanceTimersByTimeAsync(3000);
      await h.utter(word);
      expect(turn.request.signal?.aborted, word).toBe(true);
      expect(h.turns, word).toHaveLength(1);
      expect(h.states().at(-1), word).toBe('followup:stop_word');
      expect(h.of('voice.error'), word).toHaveLength(0);
    }
  });

  it('iş sürerken tek sözcüklük ses (gürültü, halüsinasyon) ve toplantıdaki söz işi kesmez', async () => {
    const { h, turn, call } = await begin();
    h.settings.spokenProgress = false;
    call({ phase: 'start', callId: 'c1', name: 'app_open', input: { name: 'WhatsApp' } });
    await h.utter('Teşekkürler.');
    await h.utter('');
    expect(turn.request.signal?.aborted).toBe(false);
    expect(h.turns).toHaveLength(1);

    const meeting = await begin('toplantıyı özetle');
    meeting.h.session.setMeeting(true);
    await meeting.h.utter('Bir sonraki maddeye geçelim arkadaşlar');
    expect(meeting.turn.request.signal?.aborted).toBe(false);
  });

  it('bekleme sözünden sonra iş sürerken ("konuşuyor" ama sessiz) başlayan söz kendi sesi sayılmaz, anında da kesmez', async () => {
    const { h, turn, call } = await begin();
    h.settings.spokenProgress = false;
    turn.say('Hemen.');
    const stream = h.io.spoken[0]?.streamId ?? '';
    h.session.onTtsSentence(stream, 0, 500);
    h.session.onPlaybackStarted(stream);
    expect(h.session.status().state).toBe('speaking');
    call({ phase: 'start', callId: 'c1', name: 'screen_look', input: {} });
    await vi.advanceTimersByTimeAsync(4000);
    // Söz başladı: ses çalmıyor, bu yüzden hemen susma/iptal yok (öksürük 60 sn'lik işi öldürmesin).
    const segment = h.nextSegment();
    h.session.onSpeechStart(segment, 300);
    expect(turn.request.signal?.aborted).toBe(false);
    h.io.transcripts.push('Şunu da ekle yarın geliyorum');
    h.session.onSpeechEnd(segment, h.pcm, 2200);
    await h.flush();
    expect(turn.request.signal?.aborted).toBe(true);
    expect(h.turns[1]?.request.text).toBe('Şunu da ekle yarın geliyorum');
  });

  it('iş sürerken cümle bitince durum "düşünüyor"a döner; son cümle çalarken yeniden "konuşuyor" olur', async () => {
    const { h, turn, call } = await begin();
    h.settings.spokenProgress = false;
    turn.say('Hemen.');
    const stream = h.io.spoken[0]?.streamId ?? '';
    h.session.onTtsSentence(stream, 0, 500);
    h.session.onPlaybackStarted(stream);
    expect(h.session.status().state).toBe('speaking');
    call({ phase: 'start', callId: 'c1', name: 'screen_look', input: {} });
    await vi.advanceTimersByTimeAsync(1200);
    // Ses bitti, araç çalışıyor: ada adım satırını gösterebilsin diye durum "düşünüyor".
    expect(h.session.status().state).toBe('thinking');
    expect(h.of('voice.activity').at(-1)?.step).toBe(t('turn.step.screen_look'));
    call({ phase: 'end', callId: 'c1', name: 'screen_look', ok: true, text: 'tamam', durationMs: 1200 });
    turn.say('Ekranda WhatsApp açık.');
    turn.finish();
    await h.flush();
    // Son cümle beyin bittikten sonra sentezlendi: yine "konuşuyor".
    h.session.onTtsSentence(stream, 1, 1500);
    expect(h.session.status().state).toBe('speaking');
    h.session.onPlaybackEnded(stream, 2000, false);
    await h.flush();
    expect(h.states().at(-1)).toBe('followup:speech_done');
  });

  it('onay kısa sorulur ("Göndereyim mi?"); gündelik "tamam" doğrudan sorulan soruda onaydır', async () => {
    const { h, turn } = await begin();
    turn.say('Mesajı yazdım.');
    await h.play();
    const request = { id: 'ap1', summary: '“WhatsApp” penceresinde Enter’a basmak istiyorum; bu bir iletiyi gönderebilir.', ask: 'Göndereyim mi?', kind: 'send' } as ApprovalRequest;
    h.approvals.pending.push(request);
    h.session.onApprovalRequest(request.id, request.summary, request.ask);
    expect(h.io.spoken.at(-1)?.text).toBe('Göndereyim mi?');
    expect(h.of('voice.activity').at(-1)?.step).toBe(t('turn.step.approval'));
    await h.play();
    expect(h.session.status().state).toBe('listening');
    await h.utter('Tamam.');
    expect(h.approvals.resolved).toEqual([{ id: 'ap1', decision: 'approved', by: 'voice' }]);
    expect(h.approvals.speech.at(-1)).toEqual({ text: 'Tamam.', approvalId: 'ap1' });
  });

  it('model soruyu zaten sorduysa kapı aynı şeyi ikinci kez sormaz; yanıt yine dinlenir', async () => {
    const { h, turn } = await begin();
    turn.say('Mesajı yazdım, göndereyim mi?');
    const before = h.io.spoken.length;
    h.approvals.pending.push({ id: 'ap1', summary: 'Enter’a basmak istiyorum.' } as ApprovalRequest);
    h.session.onApprovalRequest('ap1' as never, 'Enter’a basmak istiyorum.', 'Göndereyim mi?');
    expect(h.io.spoken).toHaveLength(before);
    await h.play();
    expect(h.session.status().state).toBe('listening');
    await h.utter('Yap.');
    expect(h.approvals.resolved).toEqual([{ id: 'ap1', decision: 'approved', by: 'voice' }]);
  });

  it('onay sözü Jarvis’in cümlesi BİTMEDEN kabul edilir (konuşarak kesme kapalı cihazda da); kendi sesi yanıt sanılmaz', async () => {
    const h = setup();
    // Kör giderici (yankı sınamasında Jarvis'in sesini hiç göremedi): "sızıyor" sonucu söz kesmeyi `wake`e indirir.
    h.session.setEchoLeaks(true, 'echo_test', true);
    h.session.setEchoGuardMs(800);
    expect(h.session.status()).toMatchObject({ bargeIn: 'wake', bargeInBlockedBy: 'echo_test' });
    const { turn } = await begin('mesajı gönder', h);
    h.approvals.pending.push({ id: 'ap1', summary: 'Enter’a basmak istiyorum.' } as ApprovalRequest);
    h.session.onApprovalRequest('ap1' as never, 'Enter’a basmak istiyorum.', 'Göndereyim mi?');
    const stream = await h.play(1800, { finish: false });
    expect(h.session.status().state).toBe('speaking');

    // Jarvis'in kendi sorusu mikrofona sızdı: yanıt sanılmaz, yeniden de sorulmaz.
    const echo = h.nextSegment();
    h.session.onSpeechStart(echo, 300);
    h.io.transcripts.push('Göndereyim mi?');
    h.session.onSpeechEnd(echo, h.pcm, 900);
    await h.flush();
    expect(h.approvals.resolved).toEqual([]);
    expect(h.io.spoken.at(-1)?.text).toBe('Göndereyim mi?');

    // Kullanıcı soru bitmeden "evet" dedi.
    const answer = h.nextSegment();
    h.session.onSpeechStart(answer, 300);
    h.io.transcripts.push('Evet.');
    h.session.onSpeechEnd(answer, h.pcm, 500);
    await h.flush();
    expect(h.approvals.resolved).toEqual([{ id: 'ap1', decision: 'approved', by: 'voice' }]);
    expect(turn.request.signal?.aborted).toBe(false);
    h.session.onApprovalResolved('ap1' as never);
    expect(h.io.calls).toContain('stop');
    expect(h.session.status().state).toBe('thinking');
    h.session.onPlaybackEnded(stream, 900, true);
  });

  it('onay sorusu okunurken bas-konuş ya da "Sustur": soru anında susar, onay bekler, iş iptal edilmez', async () => {
    for (const press of ['hotkey', 'stop'] as const) {
      const { h, turn } = await begin();
      h.approvals.pending.push({ id: 'ap1', summary: 'Enter’a basmak istiyorum.' } as ApprovalRequest);
      h.session.onApprovalRequest('ap1' as never, 'Enter’a basmak istiyorum.', 'Göndereyim mi?');
      await h.play(1800, { finish: false });
      const stops = h.io.calls.filter((item) => item === 'stop').length;
      if (press === 'hotkey') h.session.startListening('hotkey');
      else h.session.stopSpeaking();
      expect(h.io.calls.filter((item) => item === 'stop').length, press).toBe(stops + 1);
      expect(turn.request.signal?.aborted, press).toBe(false);
      expect(h.session.status().state, press).toBe('listening');
      await h.utter('Hayır.');
      expect(h.approvals.resolved, press).toEqual([{ id: 'ap1', decision: 'denied', by: 'voice' }]);
    }
  });

  it('konuşma sürerken (onay yokken) bas-konuş ve "Sustur" konuşmayı anında keser', async () => {
    const hot = await begin('uzun anlat');
    hot.turn.say('Bir varmış bir yokmuş.');
    await hot.h.play(8000, { finish: false });
    hot.h.session.startListening('hotkey');
    expect(hot.h.io.calls).toContain('stop');
    expect(hot.turn.request.signal?.aborted).toBe(true);
    expect(hot.h.session.status().state).toBe('listening');

    const stop = await begin('uzun anlat');
    stop.turn.say('Bir varmış bir yokmuş.');
    await stop.h.play(8000, { finish: false });
    stop.h.session.stopSpeaking();
    expect(stop.h.io.calls).toContain('stop');
    expect(stop.h.session.status().state).toBe('followup');
  });

  it('"Sustur" her durumda kesin sonuç verir: seslendirme üretilirken, ilk parça çalınmadan, parçalar arasında (demo.5)', async () => {
    // Seslendirme henüz üretiliyor: cümle gitti, ses gelmedi.
    const early = await begin('uzun anlat');
    early.turn.say('Bir varmış.');
    early.h.session.stopSpeaking();
    expect(early.h.session.status().state).toBe('followup');
    expect(early.turn.request.signal?.aborted).toBe(true);
    // Geç gelen çalma raporları durumu geri "konuşuyor"a çeviremez.
    const late = early.h.io.spoken.at(-1)!.streamId;
    early.h.session.onTtsSentence(late, 0, 900);
    early.h.session.onPlaybackStarted(late);
    expect(early.h.session.status().state).toBe('followup');

    // Parçalar arasında: ilk akış bitti, iş sürüyor (düşünüyor).
    const between = await begin('uzun anlat');
    between.turn.say('Bakıyorum.');
    await between.h.play(800);
    between.call({ phase: 'start', callId: 'c1', name: 'web_read', input: {} });
    between.h.session.stopSpeaking();
    expect(between.turn.request.signal?.aborted).toBe(true);
    expect(between.h.session.status().state).toBe('followup');
  });

  it('"Sustur" sıradaki bildirim cümlesini de atar: durum takip penceresine döner dönmez yeniden konuşmaz', async () => {
    const { h, turn } = await begin('uzun anlat');
    turn.say('Bir varmış bir yokmuş.');
    await h.play(8000, { finish: false });
    const queued = h.session.speak('Proje bitti.');
    const speaks = h.io.spoken.length;
    h.session.stopSpeaking();
    await expect(queued).resolves.toEqual({ spoken: false });
    expect(h.io.spoken).toHaveLength(speaks);
    expect(h.session.status().state).toBe('followup');
  });

  it('d10 "Bildirimi kapat" (hush): duyuru anında susar, sıradakiler atılır ve hat BOŞA döner (çentik takip penceresinde kalmaz)', async () => {
    const h = setup();
    const first = h.session.speak('Claude Code oturumu bitti: testler geçti.');
    const queued = h.session.speak('Toplantınız başlıyor.');
    expect(h.session.status().state).toBe('speaking');
    const before = h.io.spoken.length;
    h.session.hush();
    await expect(queued).resolves.toEqual({ spoken: false });
    await expect(first).resolves.toMatchObject({ spoken: false });
    expect(h.session.status().state).toBe('idle');
    expect(h.io.calls).toContain('stop');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.io.spoken).toHaveLength(before);
    expect(h.session.status().state).toBe('idle');
  });

  it('hush: kullanıcının turu konuşurken de susar ve boşa döner; çalışan (konuşmayan) iş kesilmez', async () => {
    const { h, turn } = await begin('uzun anlat');
    turn.say('Bir varmış bir yokmuş.');
    await h.play(8000, { finish: false });
    expect(h.session.status().state).toBe('speaking');
    h.session.hush();
    expect(h.session.status().state).toBe('idle');

    const second = await begin('raporu hazırla');
    expect(second.h.session.status().state).toBe('thinking');
    second.h.session.hush();
    expect(second.h.session.status().state).toBe('thinking');
    // Takip penceresindeyken de çentik kapanır.
    second.turn.say('Hazır.');
    second.turn.finish();
    await second.h.flush();
    await second.h.play();
    expect(second.h.session.status().state).toBe('followup');
    second.h.session.hush();
    expect(second.h.session.status().state).toBe('idle');
  });

  it('onay sorusu sesi gelmeden susturuldu: tur sonunda bekçiyi beklemeden kapanır (konuşuyor\'da kalmaz)', async () => {
    const { h, turn } = await begin();
    h.approvals.pending.push({ id: 'ap1', summary: 'Gönder' } as ApprovalRequest);
    h.session.onApprovalRequest('ap1' as never, 'Gönder', 'Göndereyim mi?');
    // Soru akışının hiçbir parçası pencereye ulaşmadı (işçi iptalle attı): pencere bitiş bildirmez.
    h.session.stopSpeaking();
    expect(h.session.status().state).toBe('listening');
    await h.utter('Evet.');
    h.session.onApprovalResolved('ap1' as never);
    turn.say('Gönderdim.');
    await h.play(700);
    turn.finish();
    await h.flush();
    expect(h.session.status().state).toBe('followup');
  });

  it('sesle "tam yetki ver": bir kez onay sorulur, "tamam" ile ayara yazılır; model turu açılmaz', async () => {
    const h = setup();
    h.session.startListening('hotkey');
    await h.utter('Sana tam yetki veriyorum.');
    expect(h.turns).toHaveLength(0);
    expect(h.authority.requests).toHaveLength(1);
    const asked = h.authority.requests[0]!;
    expect(asked.input).toMatchObject({ toolName: 'authority_set', kind: 'authority', ask: t('authority.ask.raiseFull') });
    // Kapı onayı yayınlar; oturum soruyu sesli sorar.
    h.approvals.pending.push({ id: 'auth1', summary: asked.input.summary } as ApprovalRequest);
    h.session.onApprovalRequest('auth1' as never, asked.input.summary, asked.input.ask);
    await h.flush();
    expect(h.io.spoken.at(-1)?.text).toBe(t('authority.ask.raiseFull'));
    await h.play(3000);
    await h.utter('Tamam.');
    expect(h.approvals.resolved).toEqual([{ id: 'auth1', decision: 'approved', by: 'voice' }]);
    asked.settle('approved');
    await h.flush();
    expect(h.authority.updates).toEqual([{ authorityLevel: 'full' }]);
    expect(h.io.spoken.at(-1)?.text).toBe(t('authority.say.full'));
    expect(h.turns).toHaveLength(0);
  });

  it('sesli tur dışında sorulan onay (yetki yükseltme) okunurken söylenen "evet" cümle bitmeden kabul edilir (wake kipinde de)', async () => {
    const h = setup();
    h.session.setEchoLeaks(true, 'echo_test');
    h.session.startListening('hotkey');
    await h.utter('Tam yetki ver.');
    const asked = h.authority.requests[0]!;
    h.approvals.pending.push({ id: 'auth1', summary: asked.input.summary } as ApprovalRequest);
    h.session.onApprovalRequest('auth1' as never, asked.input.summary, asked.input.ask);
    await h.flush();
    const stream = await h.play(6000, { finish: false });
    expect(h.session.status().state).toBe('speaking');
    // Sorunun kendi yankısı yanıt sanılmaz.
    const echo = h.nextSegment();
    h.session.onSpeechStart(echo, 300);
    h.io.transcripts.push('Tam yetki verirseniz hiçbir adımda sormayacağım');
    h.session.onSpeechEnd(echo, h.pcm, 2500);
    await h.flush();
    expect(h.approvals.resolved).toEqual([]);
    // Kullanıcı soru bitmeden yanıtladı.
    const answer = h.nextSegment();
    h.session.onSpeechStart(answer, 300);
    h.io.transcripts.push('Evet, onaylıyorum.');
    h.session.onSpeechEnd(answer, h.pcm, 1800);
    await h.flush();
    expect(h.approvals.resolved).toEqual([{ id: 'auth1', decision: 'approved', by: 'voice' }]);
    expect(h.io.calls).toContain('stop');
    expect(h.session.status().state).toBe('followup');
    h.session.onApprovalResolved('auth1' as never);
    h.session.onPlaybackEnded(stream, 3000, true);
    asked.settle('approved');
    await h.flush();
    expect(h.authority.updates).toEqual([{ authorityLevel: 'full' }]);
  });

  it('sesle süreli ve işe bağlı tam yetki; reddedilirse hiçbir şey değişmez', async () => {
    const h = setup();
    h.session.startListening('hotkey');
    await h.utter('Bir saatliğine tam yetki ver.');
    expect(h.authority.requests[0]?.input.ask).toBe(t('authority.ask.raiseFullTimed', { duration: t('authority.duration.hours', { n: 1 }) }));
    h.authority.requests[0]?.settle('approved');
    await h.flush();
    expect(h.authority.grants).toEqual([{ minutes: 60 }]);
    expect(h.authority.updates).toEqual([]);

    const task = setup();
    task.session.startListening('hotkey');
    await task.utter('Bu iş bitene kadar tam yetki.');
    task.authority.requests[0]?.settle('denied');
    await task.flush();
    expect(task.authority.grants).toEqual([]);
    expect(task.io.spoken.at(-1)?.text).toBe(t('authority.say.denied'));
  });

  it('düşürmek sorulmaz ("her şeyi sor", "tam yetkiyi kapat"); Yönetim sınırı aşılamaz ve nedeni söylenir', async () => {
    const h = setup();
    h.authority.state = { level: 'full', base: 'full', max: 'full', grant: null };
    h.session.startListening('hotkey');
    await h.utter('Her şeyi sor.');
    expect(h.authority.requests).toHaveLength(0);
    expect(h.authority.updates).toEqual([{ authorityLevel: 'ask' }]);
    expect(h.io.spoken.at(-1)?.text).toBe(t('authority.say.ask'));

    const capped = setup();
    capped.authority.state = { level: 'smart', base: 'smart', max: 'smart', grant: null };
    capped.session.startListening('hotkey');
    await capped.utter('Tam yetki ver.');
    expect(capped.authority.requests).toHaveLength(0);
    expect(capped.authority.updates).toEqual([]);
    expect(capped.io.spoken.at(-1)?.text).toBe(t('authority.say.capped', { level: t('authority.level.smart') }));
  });

  it('sesli sohbet boşa dönünce işe bağlı yetki biter', async () => {
    const h = setup((policy) => {
      policy.voice.followUpSeconds = 1;
    });
    const { turn } = await begin('saat kaç', h);
    turn.say('Saat üç.');
    turn.finish();
    await h.flush();
    await h.play();
    expect(h.authority.endTasks).toBe(0);
    await vi.advanceTimersByTimeAsync(1200);
    expect(h.session.status().state).toBe('idle');
    expect(h.authority.endTasks).toBe(1);
  });

  it('sızdığı bilinen cihazda öğrenmemiş gidericinin "yankı beklenmiyor" kanısıyla susulmaz; öğrenince susulur', async () => {
    const speak = async () => {
      const h = setup();
      h.session.setEchoSuspected(true);
      await h.utter('Jarvis, bana bir hikaye anlat');
      h.turns[0]?.say('Bir zamanlar küçük bir sahil kasabasında yaşlı bir saat ustası yaşarmış.');
      h.turns[0]?.finish();
      await h.flush();
      await h.play(4000, { finish: false });
      return h;
    };
    // Giderici gecikmeyi bulamadı (Bluetooth): `near: null` Jarvis'in kendi yankısı da olabilir.
    const blind = await speak();
    blind.session.onSpeechStart(blind.nextSegment(), 300, null);
    expect(blind.session.status().state).toBe('speaking');
    expect(blind.io.calls).not.toContain('stop');

    const trained = await speak();
    trained.session.setCancellerTrained(true);
    trained.session.onSpeechStart(trained.nextSegment(), 300, null);
    expect(trained.states().at(-1)).toBe('listening:barge_in');

    // Yankı sızdığı bilinmeyen cihazda (kulaklık) eskisi gibi hemen susulur.
    const clean = setup();
    await clean.utter('Jarvis, bana bir hikaye anlat');
    clean.turns[0]?.say('Bir varmış bir yokmuş.');
    clean.turns[0]?.finish();
    await clean.flush();
    await clean.play(4000, { finish: false });
    clean.session.onSpeechStart(clean.nextSegment(), 300, null);
    expect(clean.states().at(-1)).toBe('listening:barge_in');
  });

  it('söz kesme sınaması sırasında `wake`e inmiş cihaz geçici olarak `voice` kipinde dener', () => {
    const h = setup();
    h.session.setEchoLeaks(true, 'self_interrupt');
    expect(h.session.status()).toMatchObject({ bargeIn: 'wake', bargeInBlockedBy: 'self_interrupt' });
    h.session.setBargeTrial(true);
    expect(h.session.status()).toMatchObject({ bargeIn: 'voice', bargeInBlockedBy: null });
    h.session.setBargeTrial(false);
    expect(h.session.status().bargeIn).toBe('wake');
    h.session.setEchoLeaks(false);
    expect(h.session.status()).toMatchObject({ bargeIn: 'voice', bargeInBlockedBy: null });
  });
});
