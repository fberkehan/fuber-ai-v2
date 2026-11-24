import type { Icon } from '@phosphor-icons/react';
import type { ComponentType } from 'react';
import type { MessageKey } from '@fuber/shared';

/**
 * Ana pencere sayfası. Her sayfa kendi klasöründedir: `pages/<id>/index.tsx` dosyası
 * `export default definePage({...})` verir; klasörü eklemek yeter, sayfa kendiliğinden keşfedilir.
 */
export interface PageDef {
  /** Rota kimliği; klasör adıyla aynı: `planner`. `app.openMain({ page })` ve `app.navigate` bunu kullanır. */
  id: string;
  /** Gezinmede ve başlıkta görünen adın sözlük anahtarı: `nav.planner`. */
  titleKey: MessageKey;
  icon: Icon;
  /** Sol raydaki sıra; küçük olan üstte. */
  order: number;
  /** Sayfa bir modüle aitse kimliği; modül kapalıyken sayfa gezinmede görünmez. Çekirdek sayfalarda verilmez. */
  moduleId?: string;
  /** `true`: rayın altına sabitlenir (Ayarlar). */
  footer?: boolean;
  /** `true`: rayda, menüde ve Ctrl+rakam kısayollarında görünmez; yalnız kimliğiyle (`app.navigate`) açılır. */
  hidden?: boolean;
  Component: ComponentType;
}

/** Tip denetimi ve tamamlama için kimlik işlevi. */
export function definePage(def: PageDef): PageDef {
  return def;
}
