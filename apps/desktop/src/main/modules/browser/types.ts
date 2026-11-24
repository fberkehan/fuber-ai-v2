// Gömülü tarayıcı modülünün arayüze açtığı kanallar (tip genişletmesi; modül klasöründe durur).
import type { Ok } from '@fuber/shared';

export interface JBrowserStatus {
  /** Modül açık ve izin (Ayarlar › Gizlilik) verilmiş. */
  allowed: boolean;
  tabs: number;
  visible: boolean;
  busy: boolean;
}

declare module '@fuber/shared' {
  interface Api {
    /** Jarvis'in tarayıcı penceresini gösterir (kullanıcı bir sitede kendisi giriş yapacak). */
    'jbrowser.show': { req: void; res: Ok };
    /** Jarvis'in tarayıcısındaki bütün oturumları (çerez, depolama, önbellek) siler; sekmeler kapanır. */
    'jbrowser.clearData': { req: void; res: Ok };
    'jbrowser.status': { req: void; res: JBrowserStatus };
  }
}
