// Kurulum v2'nin adım bağlamı: her adımın Bilesen'i ve Onizleme'si aynı taslağı okur (canlı önizleme = taslağın o anki hâli).
import { createContext, useContext } from 'react';
import type { KurulumTaslagi, Kurulum2Kipi } from '../../shared/kurulum-taslak';
import type { Cift } from '../../shared/kurulum-metin';
import type { MotorGorunumu } from '../../shared/motor-durumu';
import type { Nerede } from '../../shared/nerede';
import type { Ayarlar, SesBilgisi } from '../../shared/tipler';
import type { YerelKarar } from './yerel-karar';

export interface AdimBaglami {
  kip: Kurulum2Kipi;
  taslak: KurulumTaslagi;
  degistir: (yama: Partial<KurulumTaslagi> | ((t: KurulumTaslagi) => KurulumTaslagi)) => void;
  ayar: Ayarlar;
  /** 0.13.1: resmî hitap seçili (Bey, Hanım, Hocam…): Adım 3'ün önizlemesinden sonuna kadar metinler "siz" konuşur (shared/kurulum-metin.ts). */
  siz: boolean;
  /** Çiftten hitaba göre metin (`m(KM.kipGiris)`). */
  m: (c: Cift) => string;
  /** Anında kaydedilen ayarlar (ses, izinler; Vazgeç açılıştakine döndürür). */
  kaydet: (d: Partial<Ayarlar>) => void;
  /** Ayarları ana süreçten yeniden okur (bağlantı eklendi). */
  yenile: () => void;
  /** Bulunulan adımdan bir sonrakine (hesap bağlanınca). */
  ileri: () => void;
  yerel: YerelKarar;
  /** Ses bilgisi (ana süreç; yedek ses durumu): TEK abonelik — Ses adımı, Hazırsın ve önizlemeleri aynı değeri okur. */
  ses: { bilgi: SesBilgisi | null; yukle: () => void };
  /** 0.12 H3c: Nerede'nin o anki seçimi — açık seçim, yoksa gerçek hâl (Y1: shared/nerede.ts neredeOnSecimi; taslaktan kopya değil). */
  nerede: Nerede;
  motor: { gorunum: MotorGorunumu; yarim: boolean };
  /** Önizlemelerin canlı saati (dakikada bir). */
  simdi: Date;
  /** "Günün"ün açılış saatleri ve kaynağı (shared/kurulum-adimlari.ts gunBaslangici): metin yalnız uygulanacak şeyi söyler (I1 5b). */
  gunAcilis: { bas: string; bit: string; kaynak: 'profil' | 'sessiz' | 'varsayilan' };
}

export const AdimBaglamiK = createContext<AdimBaglami | null>(null);

export function useAdim(): AdimBaglami {
  const b = useContext(AdimBaglamiK);
  if (!b) throw new Error('kurulum2: adım bağlamı yok');
  return b;
}
