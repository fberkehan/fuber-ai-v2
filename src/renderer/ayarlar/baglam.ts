// Ayarlar bağlamı: kabuk (sayfalar/Ayarlar.tsx) ayarları, kaydetmeyi, modu ve iç gezinmeyi grup içeriklerine buradan verir.
// Grup bileşenleri prop almaz (kayit.ts'te yalnız eşlenir): `const { a, kaydet, mod } = useAyarlar();`.
import { createContext, useContext, type ComponentType } from 'react';
import type { Ayarlar, Mod } from '../../shared/tipler';

/** Bir kategorinin grup kimliği → grup içeriği (dizin.ts'teki grup kimlikleriyle aynı). */
export type IcerikHaritasi = Readonly<Record<string, ComponentType>>;

export interface AyarBaglami {
  a: Ayarlar;
  /** Kısmi kayıt (ana süreç derin birleştirir); kayıttan sonra "Kaydedildi" rozeti. */
  kaydet: (d: Partial<Ayarlar>) => void;
  mod: Mod;
  /** Ayarları ana süreçten yeniden okur (anahtar, duraklatma gibi kayıt dışı değişikliklerden sonra). */
  yenile: () => void;
  /** Ayarlar içinde gezinme: 'kategori', 'kategori/grup' ya da ayar kimliği (ör. 'genel/mod'). */
  git: (cipa: string) => void;
  /** Görünüm → "Kurulum sihirbazını yeniden aç" (main.tsx katman olarak açar). */
  sihirbaziAc?: () => void;
}

export const AyarBaglamiCtx = createContext<AyarBaglami | null>(null);

export function useAyarlar(): AyarBaglami {
  const b = useContext(AyarBaglamiCtx);
  if (!b) throw new Error('useAyarlar yalnız Ayarlar kabuğunun içinde kullanılır.');
  return b;
}
