// Sahibi: T3. `voice.*` kanalları ve gizli ses penceresinin rapor kanalı (`audio.report`).
import { t, UserError } from '@fuber/shared';
import { audioReports } from '../../voice/audio-bridge';
import type { VoiceService } from '../../voice/index';
import { setListeningPaused, setQuietFromUi } from '../../voice/quick';
import type { RegisterHandlers } from '../router';

export const register: RegisterHandlers = (ipc, services) => {
  const { voice } = services;

  ipc.handle('audio.report', (report, ctx) => {
    // Yalnız ses penceresi rapor verebilir; başka bir sayfa oynatma ya da mikrofon durumu uyduramaz.
    if (!/\/audio\/index\.html/.test(ctx.sender.getURL())) throw new UserError(t('common.unknownError'));
    audioReports.deliver(report);
    return { ok: true as const };
  });

  ipc.handle('voice.status', () => voice.status());
  ipc.handle('voice.listen', () => {
    voice.startListening('island');
    return voice.status();
  });
  ipc.handle('voice.stop', () => {
    voice.stopSpeaking();
    return voice.status();
  });
  ipc.handle('voice.retry', () => {
    const service = voice as Partial<VoiceService>;
    if (typeof service.retry !== 'function' || !service.retry()) throw new UserError(t('turn.nothingToRetry'));
    return voice.status();
  });
  ipc.handle('voice.mute', ({ muted, minutes }) => {
    if (muted) voice.muteMic({ minutes });
    else voice.unmuteMic();
    return voice.status();
  });
  ipc.handle('voice.setQuiet', ({ on }) => setQuietFromUi(voice, on === true));
  ipc.handle('voice.pauseListening', ({ paused }) => setListeningPaused(voice, paused === true));
  ipc.handle('voice.speak', ({ text }) => voice.speak(text));
  ipc.handle('voice.startConversation', () => {
    if (!voice.startConversation()) throw new UserError(t('voice.conversation.notAllowed'));
    return voice.status();
  });
  ipc.handle('voice.endConversation', () => {
    voice.endConversation();
    return voice.status();
  });
  ipc.handle('voice.bargeTest', () => {
    const service = voice as Partial<VoiceService>;
    if (typeof service.bargeInTest !== 'function') throw new UserError(t('voice.notReady'));
    return service.bargeInTest();
  });
  ipc.handle('voice.setAmbient', ({ enabled }) => {
    voice.setAmbient?.(enabled === true);
    return voice.status();
  });
  // Seslendirme motorları (Ayarlar › Ses): katalog + bu cihazdaki durum, ve "Dinle".
  ipc.handle('voice.ttsEngines', () => {
    const service = voice as Partial<VoiceService>;
    if (typeof service.ttsEngines !== 'function') throw new UserError(t('voice.notReady'));
    return service.ttsEngines();
  });
  ipc.handle('voice.ttsPreview', ({ engine, voice: voiceId }) => {
    const service = voice as Partial<VoiceService>;
    if (typeof service.ttsPreview !== 'function') throw new UserError(t('voice.notReady'));
    return service.ttsPreview(engine, voiceId);
  });
  ipc.handle('voice.ttsPrepare', ({ engine }) => {
    const service = voice as Partial<VoiceService>;
    if (typeof service.ttsPrepare !== 'function') throw new UserError(t('voice.notReady'));
    return service.ttsPrepare(engine);
  });
  ipc.handle('voice.ttsCancelPrepare', () => {
    const service = voice as Partial<VoiceService>;
    if (typeof service.ttsCancelPrepare !== 'function') throw new UserError(t('voice.notReady'));
    return service.ttsCancelPrepare();
  });
  // Tanı özeti `VoiceApi` sözleşmesinde yok; ses servisinin kendi yüzünden okunur. Servis hazır değilse (taslak) genel hata.
  ipc.handle('voice.diagnostics', () => {
    const service = voice as Partial<VoiceService>;
    if (typeof service.diagnosticsReport !== 'function') throw new UserError(t('voice.notReady'));
    return service.diagnosticsReport();
  });
};
