// Kullanım verisi (`kullanim:ozet`): Ayarlar → Hesap ve kullanım'ın "Bu ay N yanıt" satırı (her iki mod) ve Ayarlar → Maliyet (Geliştirici) aynı
// kancayı kullanır — tek istek biçimi, tek saat (ana sürecin saati: demo test saati kaydırılmışsa onunla). 0.11 G8 düzeltme turu 1.
import { useEffect, useState } from 'react';
import { cagir } from '../api';
import type { KullanimOzeti } from '../../shared/kullanim-ozeti';
import { anaSimdi } from '../../shared/saat-kaymasi';

export type KullanimPenceresi = number | { baslangic: string };
/** Bu ayın ilk günü (yerel saat; ana sürecin saati). */
export const ayBasi = (): string => { const d = new Date(anaSimdi()); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString(); };
export const sayi = (n: number): string => Number(n).toLocaleString('tr-TR');

/** `kullanim:ozet`: yüklenirken undefined, ana süreç yanıt vermezse null. Pencere: gün sayısı ya da `{ baslangic }`. */
export function useKullanim(p: KullanimPenceresi): KullanimOzeti | null | undefined {
  const [k, setK] = useState<KullanimOzeti | null | undefined>(undefined);
  const anahtar = JSON.stringify(p);
  useEffect(() => {
    let iptal = false;
    void cagir<KullanimOzeti>('kullanim:ozet', p).then((x) => { if (!iptal) setK(x); }).catch(() => { if (!iptal) setK(null); });
    return () => { iptal = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anahtar]);
  return k;
}
