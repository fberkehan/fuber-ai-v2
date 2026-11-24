// Sol paneldeki "Hızlı kontrol"ün ses hattına dokunan iki kararı (kullanıcı isteği, d10: "bazen seni susturmak, bazen
// saçma sapan şeyleri dinlememeni istiyorum; illa ayarlara girmem gerekiyor"). Mikrofon (`voice.mute`), ortam dinleme
// (`ambient.setPrefs`) ve dinleme süresi (`Settings.followUpSeconds`) var olan kanallarla yapılır; burada yalnız tek
// tıkla birden çok adım gereken iki iş vardır. Yalnız tür içe aktarılır: arayüz de `isListeningPaused`'ı kullanır.
import type { Notification, VoiceApi, VoiceStatus } from '@fuber/shared';

/**
 * Elle duraklatmanın süresi (dk). Düğme "yeniden tıklayınca sürer" der; yine de unutulan duraklatma bir gün sonra
 * kendiliğinden kalkar (sesle duraklatmanın da üst sınırı budur: `voice_pause_listening` en çok 24 saat).
 */
export const QUICK_PAUSE_MINUTES = 24 * 60;

/**
 * Sessiz kip. Açılırken asistan o an konuşuyorsa hemen susar ("Sustur" ile aynı yol); düşünürken süren iş kesilmez,
 * yanıtı yazıyla gelir (ses hattı sessiz kipte cümleleri adaya yazar). Sesle açılan sessiz kip (`voice_set_quiet`)
 * bunu yapmaz: araç turun içinde çalışır ve turun kendi yanıtı kesilmemelidir.
 */
export function setQuietFromUi(voice: Pick<VoiceApi, 'setQuiet' | 'stopSpeaking' | 'status'>, on: boolean): VoiceStatus {
  voice.setQuiet(on);
  if (on && voice.status().state === 'speaking') voice.stopSpeaking();
  return voice.status();
}

/**
 * Dinlemeyi duraklatır ya da sürdürür. Mikrofon AÇIK kalır (kapatmak ayrı düğmedir): uyandırma sözü yok sayılır ve o an
 * süren dinleme ya da takip penceresi biter, yani ortamdaki konuşma komut sanılmaz. Kısayol ve ada yine dinletir.
 * Asistan konuşurken ya da düşünürken yanıt kesilmez (susturmak "Sessiz kip" ya da Esc'dir).
 */
export function setListeningPaused(voice: Pick<VoiceApi, 'pauseWake' | 'resumeWake' | 'cancelTurn' | 'status'>, paused: boolean): VoiceStatus {
  if (!paused) {
    voice.resumeWake();
    return voice.status();
  }
  voice.pauseWake(QUICK_PAUSE_MINUTES);
  const state = voice.status().state;
  if (state === 'listening' || state === 'followup') voice.cancelTurn();
  return voice.status();
}

/** Adada/çentikte "şu an görünen" bildirim: son bu kadar ms içinde gösterilmiş (ada eylemli kartı en çok 30 sn tutar). */
export const VISIBLE_NOTICE_MS = 60_000;
const VISIBLE_CHANNELS = new Set(['voice', 'island', 'toast']);

/**
 * "Bildirimi kapat / Sustur": ada kartının ✕'i (`id` verilir) ve sol paneldeki Hızlı kontrol (`id` yok: o an görünen
 * bütün kartlar). Bildirim kaydı kapatılır ve konuşma susar (`VoiceApi.hush`: duyuru dahil, sıradakiler atılır, çentik
 * kapanır). Bugün sayfasının kutusunda bekleyen eski bildirimlere dokunulmaz: o liste kullanıcının işleyeceği gelen kutusudur.
 */
export function hushNotices(
  attention: { pending(): Notification[]; dismiss(id: string): void },
  voice: Pick<VoiceApi, 'hush' | 'stopSpeaking'>,
  options: { id?: string; now?: number } = {},
): { dismissed: number } {
  const now = options.now ?? Date.now();
  const targets = options.id
    ? [options.id]
    : attention
        .pending()
        .filter((item) => item.status === 'shown' && item.channel !== null && VISIBLE_CHANNELS.has(item.channel) && item.shownAt !== null && now - Date.parse(item.shownAt) <= VISIBLE_NOTICE_MS)
        .map((item) => item.id);
  for (const id of targets) attention.dismiss(id);
  if (voice.hush) voice.hush();
  else voice.stopSpeaking();
  return { dismissed: targets.length };
}

/** Dinleme şu an duraklatılmış mı (süresi geçmiş duraklatma sayılmaz). */
export function isListeningPaused(status: Pick<VoiceStatus, 'wakePausedUntil'> | null, now: number = Date.now()): boolean {
  const until = status?.wakePausedUntil;
  return typeof until === 'string' && Date.parse(until) > now;
}
