// Sesli sohbeti BİTİRME (veda sözü: "güle güle", "bay bay", "görüşürüz", "iyi geceler"): sohbet kipi ve takip dinlemesi
// kapanır; mikrofon kapanmaz, uyandırma sözü dinlenmeye devam eder, uygulama kapanmaz.
//
// Araç bir turun İÇİNDEN çağrılır. Sohbet o an bitirilirse süren tur iptal olur ve veda cümlesi hiç söylenmez
// ("voice.endConversation" → "cancelTurn"). Bu yüzden bitirme, tur bitip veda söylendikten SONRA yapılır.
//
// Sesli turda veda sözünü çoğu kez ses oturumunun hızlı yolu yakalar ("voice/session.ts": model turu açılmaz); bu dosya
// yazılı sohbetten gelen vedanın ve oturumun yakalamadığı sözlerin yoludur.
import type { ModuleContext } from '@fuber/shared';
import { whenTurnSettles } from './spoken-tests';

export type EndConversationContext = Pick<ModuleContext, 'bus' | 'voice' | 'log'>;

/** Bitirilecek bir şey var mı: sohbet kipi açık ya da takip dinlemesi sürüyor. */
function openListening(ctx: Pick<ModuleContext, 'voice'>): 'conversation' | 'followup' | null {
  const status = ctx.voice.status();
  if (status.conversation) return 'conversation';
  return status.state === 'followup' ? 'followup' : null;
}

/**
 * Sohbeti tur bittikten sonra bitirir ve hemen döner. "ended": bitirme yapıldıysa "true" ile çözülür (sınamalar için).
 * Uyandırmayla ya da kısayolla YENİ başlamış dinlemeye dokunulmaz: yalnız sohbet kipi ve takip penceresi kapatılır.
 */
export function endConversationAfterTurn(ctx: EndConversationContext): { ended: Promise<boolean> } {
  const ended = (async () => {
    try {
      await whenTurnSettles(ctx, { graceMs: 0, pollMs: 50 });
      const open = openListening(ctx);
      if (open === 'conversation') ctx.voice.endConversation();
      else if (open === 'followup') ctx.voice.cancelTurn();
      return open !== null;
    } catch (error) {
      ctx.log.debug(`sohbet bitirilemedi: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  })();
  return { ended };
}
