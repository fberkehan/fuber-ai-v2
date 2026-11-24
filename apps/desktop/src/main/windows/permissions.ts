/**
 * Chromium izin politikası: mikrofon yalnız gizli ses penceresine verilir (KURGU §5.2); başka hiçbir pencere
 * ve sahnedeki hiçbir mini uygulama çerçevesi mikrofon, kamera, konum ya da bildirim izni alamaz.
 */

import { session, type WebContents } from 'electron';
import { isAppUrl } from '../runtime';
import { testing } from '../testing';
import { systemAudioRequestOpen } from '../voice/system-audio';

interface MediaDetails {
  mediaTypes?: string[];
  mediaType?: string;
  isMainFrame?: boolean;
}

export function installPermissionPolicy(audioContents: () => WebContents | null): void {
  const allowed = (contents: WebContents | null, permission: string, details: MediaDetails): boolean => {
    if (!contents || details.isMainFrame === false) return false;
    switch (permission) {
      case 'media': {
        if (testing.denyMic) return false;
        const types = details.mediaTypes ?? (details.mediaType ? [details.mediaType] : []);
        return contents === audioContents() && !types.includes('video');
      }
      // Çıkış aygıtı seçimi de ses penceresinin işidir.
      case 'speaker-selection':
        return contents === audioContents();
      // Toplantının "Karşı taraf" kaynağı (bilgisayar sesi, Windows loopback): `getDisplayMedia` önce BU izni sorar,
      // ekran paylaşımı işleyicisine ancak sonra gelinir. İzin listede yokken her istek "Permission denied" ile
      // düşüyordu (bir oturum günlüğünde: "bilgisayar sesi: denied"; sınama kipi `getDisplayMedia` çağırmadığı için
      // görülmedi). Yalnız ses penceresi ve yalnız toplantı kipi bilgisayar sesini istedikten sonraki kısa pencerede.
      case 'display-capture':
        return contents === audioContents() && systemAudioRequestOpen();
      // "Kopyala" düğmeleri: yalnız kendi sayfalarımız panoya yazabilir.
      case 'clipboard-sanitized-write':
        return isAppUrl(contents.getURL());
      default:
        return false;
    }
  };

  const target = session.defaultSession;
  target.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(allowed(contents, permission, details as MediaDetails));
  });
  target.setPermissionCheckHandler((contents, permission, _origin, details) =>
    allowed(contents, permission, details as MediaDetails),
  );
}
