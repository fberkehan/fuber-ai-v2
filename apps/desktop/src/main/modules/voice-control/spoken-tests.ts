// Sesle başlatılan ses sınamaları: söz kesme sınaması, yankı sınaması, uyandırma alıştırması, mikrofon sınaması.
// Bugüne dek yalnız Ayarlar › Ses'teki düğmelerle başlıyorlardı. Sınamanın kendisi ses servisindedir (`voice/index.ts`);
// burada yalnız başlatma, sıralama ve sonucun kullanıcıya iletilmesi vardır.
//
// Sıralama önemlidir: araç bir turun İÇİNDEN çağrılır. Sınama o an başlarsa süren turu iptal eder (`cancelTurn`) ve
// "başlatıyorum" yanıtı hiç söylenmez. Bu yüzden sınama, tur bitip yanıt söylendikten SONRA başlar (`whenTurnSettles`).
import { t, type ModuleContext, type ToolResult, type VoiceApi } from '@fuber/shared';
import { SPOKEN_TESTS, type SpokenTestId } from '../../core/brain/local-commands';
import type { VoiceService } from '../../voice/index';

/** Aynı anda tek sınama: ikinci istek "sürüyor" yanıtını alır (ses servisi de reddederdi, ama o tur bittikten sonra). */
let pending: SpokenTestId | null = null;

/** Sınamayı başlatmadan önce beklenen en uzun süre (tur bitmedi, yanıt hâlâ söyleniyor). */
const SETTLE_TIMEOUT_MS = 45_000;
/** Yanıtın son sesi ile sınamanın ilk sesi arasındaki pay. */
const SETTLE_GRACE_MS = 600;
const POLL_MS = 200;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Tur bitene ve asistan susana kadar bekler (en çok `SETTLE_TIMEOUT_MS`). `graceMs`: yanıtın son sesinden sonraki pay;
 * `pollMs`: ses durumunun yoklanma aralığı (veda sözünde kısa tutulur: dinleme penceresi hemen kapansın).
 */
export async function whenTurnSettles(ctx: Pick<ModuleContext, 'bus' | 'voice'>, { graceMs = SETTLE_GRACE_MS, pollMs = POLL_MS } = {}): Promise<void> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  // 1) Bu turun yanıtı tamamlansın (yazılı sohbette de aynı olay yayınlanır).
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, 15_000);
    const off = ctx.bus.once('conversation.turn', done);
    function done() {
      clearTimeout(timer);
      off();
      resolve();
    }
  });
  // 2) Yanıtın seslendirilmesi bitsin: düşünürken ya da konuşurken sınama başlamaz.
  for (;;) {
    const state = ctx.voice.status().state;
    if ((state !== 'thinking' && state !== 'speaking') || Date.now() >= deadline) break;
    await sleep(pollMs);
  }
  if (graceMs > 0) await sleep(graceMs);
}

/** Sınamanın başlatılırken söylenen cümlesi: kullanıcı ne yapacağını bilsin. */
function introOf(id: SpokenTestId, wake: string): string {
  switch (id) {
    case 'barge_in':
      return t('voice.spokenTest.introBarge');
    case 'echo':
      return t('voice.spokenTest.introEcho');
    case 'wake_training':
      return t('voice.spokenTest.introWake', { wake });
    case 'mic':
      return t('voice.spokenTest.introMic');
  }
}

/** Sınamayı koşar ve kullanıcıya söylenecek sonucu döndürür. */
async function runTest(id: SpokenTestId, ctx: Pick<ModuleContext, 'voice' | 'settings'>): Promise<string> {
  const voice = ctx.voice as VoiceApi & Partial<Pick<VoiceService, 'bargeInTest'>>;
  switch (id) {
    case 'barge_in': {
      if (typeof voice.bargeInTest !== 'function') return t('voice.notReady');
      return (await voice.bargeInTest()).message;
    }
    case 'echo':
      return (await voice.echoTest()).message;
    case 'wake_training':
      return (await voice.calibrateWake(3)).message;
    case 'mic': {
      const result = await voice.testMic(ctx.settings.get().inputDeviceId, 4);
      if (!result.ok) return result.error ?? t('voice.notReady');
      if (result.transcript) return t('voice.spokenTest.micHeard', { text: result.transcript });
      return result.speechDetected ? t('voice.spokenTest.micSpeech') : t('voice.spokenTest.micSilent');
    }
  }
}

/** Sınama bitince sonucu söyler ve bildirim olarak da bırakır (sessiz kipte ya da yazılı sohbette ses yoktur). */
async function announce(id: SpokenTestId, message: string, ctx: Pick<ModuleContext, 'voice' | 'attention' | 'moduleId' | 'log'>): Promise<void> {
  const label = SPOKEN_TESTS.find((test) => test.id === id)?.label ?? id;
  let spoken = false;
  try {
    spoken = (await ctx.voice.speak(message)).spoken;
  } catch (error) {
    ctx.log.debug(`sınama sonucu seslendirilemedi: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    ctx.attention.notify({
      moduleId: ctx.moduleId,
      title: label[0]!.toLocaleUpperCase('tr') + label.slice(1),
      body: message,
      // Sesle söylendiyse sessiz bir kayıt yeter; söylenemediyse adada görünsün.
      priority: spoken ? 'low' : 'normal',
      dedupeKey: `voice-test:${id}`,
    });
  } catch (error) {
    ctx.log.debug(`sınama sonucu bildirilemedi: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export type SpokenTestContext = Pick<ModuleContext, 'bus' | 'voice' | 'settings' | 'policy' | 'attention' | 'moduleId' | 'log'>;

/**
 * Sınamayı sıraya koyar ve hemen döner: araç sonucu "başlatıyorum" cümlesini taşır, sınama tur bittikten sonra koşar.
 * Koşulamayacaksa (ses hattı hazır değil, mikrofon kapalı, başka sınama sürüyor) nedenini söyler; hiçbir şey başlamaz.
 * `settled`: sınama ve sonucun iletilmesi bitince çözülür (sınama betikleri için).
 */
export function startSpokenTest(id: SpokenTestId, ctx: SpokenTestContext): { result: ToolResult; settled: Promise<void> } {
  const test = SPOKEN_TESTS.find((item) => item.id === id)!;
  const refuse = (text: string) => ({ result: { ok: false, text }, settled: Promise.resolve() });
  let status: ReturnType<VoiceApi['status']>;
  try {
    status = ctx.voice.status();
  } catch {
    return refuse(`${test.label} başlatılamadı: ses hattının durumu okunamadı.`);
  }
  if (pending) return refuse(`Şu an ${SPOKEN_TESTS.find((item) => item.id === pending)?.label ?? 'başka bir sınama'} sürüyor; bitince yeniden deneyin.`);
  if (!status.ready) return refuse(`${test.label} başlatılamadı: ses hattı hazır değil${status.notReadyReason ? ` (${status.notReadyReason})` : ''}.`);
  if (status.micMuted) return refuse(`${test.label} için mikrofon açık olmalı; şu an kapalı. Kullanıcıya mikrofonu açmasını söyle.`);
  // Toplantı kipinde sınama başlamaz: Jarvis toplantıda sesli konuşmaz ve sınama toplantının dökümünü keserdi.
  if (status.meeting?.on) return refuse(`${test.label} başlatılmadı: toplantı kipi açık. Kullanıcıya yalnız şunu söyle: "${t('voice.test.meeting')}"`);

  pending = id;
  const settled = (async () => {
    try {
      await whenTurnSettles(ctx);
      const message = await runTest(id, ctx);
      await announce(id, message, ctx);
    } catch (error) {
      ctx.log.warn(`${test.label} koşulamadı`, error);
      await announce(id, t('voice.spokenTest.failed', { name: test.label }), ctx);
    } finally {
      pending = null;
    }
  })();
  return { result: { ok: true, text: startedText(id, ctx.policy.get().persona) }, settled };
}

/**
 * Sınama sıraya alındığında modele dönen metin. Söylenecek cümle hazır verilir: küçük model yönergeyi aynen okuyordu
 * (`docs/TUZAKLAR.md`).
 */
export function startedText(id: SpokenTestId, persona: { name: string; wakePhrases: readonly string[] }): string {
  const test = SPOKEN_TESTS.find((item) => item.id === id)!;
  // Uyandırma sözü politikada küçük harfle durur ("hey jarvis"); söylenirken sözcük başları büyütülür.
  const wake = (persona.wakePhrases[0] ?? persona.name)
    .split(' ')
    .map((word) => (word ? word[0]!.toLocaleUpperCase('tr') + word.slice(1) : word))
    .join(' ');
  const intro = introOf(id, wake);
  return `${test.label} sıraya alındı; bu yanıt söylendikten sonra başlar ve sonucu ayrıca söylenir. Kullanıcıya yalnız şunu söyle: "${intro}"`;
}

/** Sınama için (modül kapanışı): bekleyen sınama kaydını temizler. */
export function resetSpokenTests(): void {
  pending = null;
}
