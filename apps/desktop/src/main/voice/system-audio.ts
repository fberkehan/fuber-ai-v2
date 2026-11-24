/**
 * Toplantı kipinin "Karşı taraf" kaynağı: bilgisayarın sesi (Windows loopback). Ses penceresi `getDisplayMedia` ister;
 * Electron'un ekran paylaşımı işleyicisi isteğe birincil ekranı ve `audio: 'loopback'` sesi verir, pencere görüntü izini
 * hemen durdurur. (Yöntemin gerekçesi: `docs/KURGU.md` › toplantı modu.)
 *
 * İstek YALNIZ ses penceresinden ve yalnız toplantı kipi bilgisayar sesini istedikten sonraki kısa pencerede kabul
 * edilir; başka her istek (başka sayfa, süre dolmuş, ses istenmemiş) geri çevrilir. Fuber AI 1'in kök kusurlarından biri
 * ("mikrofonu kapat" açıkken bilgisayar sesi de reddediliyordu) burada doğmaz: mikrofonun kapatılması izin işleyicisinden
 * değil izin durdurulmasından (`track.stop()`) geçer; bu işleyici mikrofonun durumunu hiç okumaz.
 */
import type { Session } from 'electron';
import { rendererUrl } from '../runtime';

/** `system.start` komutundan sonra pencerenin isteği bu kadar süre beklenir. */
const REQUEST_WINDOW_MS = 15_000;

let allowUntil = 0;
let installed = false;

/** Ses penceresinin sıradaki `getDisplayMedia` isteği kabul edilsin. */
export function allowSystemAudioRequest(): void {
  allowUntil = Date.now() + REQUEST_WINDOW_MS;
}

/**
 * İzin işleyicisi (`windows/permissions.ts`) için: bilgisayar sesi az önce istendi mi. Chromium `getDisplayMedia`'da
 * önce `display-capture` iznini sorar; izin verilmezse bu dosyadaki işleyiciye hiç gelinmez.
 */
export function systemAudioRequestOpen(now: number = Date.now()): boolean {
  return now <= allowUntil;
}

/** Saf karar: istek kabul edilecek mi (birim testli). */
export function acceptSystemAudioRequest(request: { url: string; audioRequested: boolean; now: number; allowUntil: number; audioUrl: string }): boolean {
  if (!request.audioRequested || request.now > request.allowUntil) return false;
  return request.url.split(/[?#]/)[0] === request.audioUrl.split(/[?#]/)[0];
}

/** İşleyiciyi bir kez kurar (oturum başına tek işleyici olabilir). */
export function installSystemAudioHandler(session: Session, log: { warn(message: string, error?: unknown): void }): void {
  if (installed) return;
  installed = true;
  session.setDisplayMediaRequestHandler(
    (request, callback) => {
      const accepted = acceptSystemAudioRequest({
        url: String(request.frame?.url ?? ''),
        audioRequested: request.audioRequested === true,
        now: Date.now(),
        allowUntil,
        audioUrl: rendererUrl('audio'),
      });
      if (!accepted) {
        log.warn(`bilgisayar sesi isteği geri çevrildi (ses istendi: ${request.audioRequested === true}, süre ${Date.now() > allowUntil ? 'doldu' : 'içinde'})`);
        callback({});
        return;
      }
      allowUntil = 0;
      // `desktopCapturer` yalnız istek gelince yüklenir (sınama sahtelerinde yok).
      void import('electron')
        .then(({ desktopCapturer }) => desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }))
        .then((sources) => {
          const screen = sources[0];
          if (!screen) {
            log.warn('bilgisayar sesi: ekran kaynağı bulunamadı');
            callback({});
            return;
          }
          callback({ video: screen, audio: 'loopback' });
        })
        .catch((error: unknown) => {
          log.warn('bilgisayar sesi kaynağı alınamadı', error);
          callback({});
        });
    },
    { useSystemPicker: false },
  );
}
