// ── Kurulum v2'nin adımları (0.12 H3a; brief: ADIMLAR = { id, Bilesen, Onizleme, gecerliMi }) ─────────────────────────────────────────
// Sıra shared/kurulum-taslak.ts KURULUM2_SIRASI ile aynı (tests/kurulum-v2.test.ts bu dosyadaki sırayı okur). Bilesen sol sütunun içeriği
// (en çok 520 px, dikey ortalı), Onizleme sağ sütunun CANLI önizlemesi, gecerliMi "Devam"ın açık olup olmadığı (saf; taslaktan).
// H3b 'hesap' satırını kurulum2/HesapAdimi.tsx'e taşıdı (Google, doğrulama kodu, şifremi unuttum; akış renderer/hesap/HesapAkisi.tsx); H3c
// 'nerede' satırını kurulum2/NeredeAdimi.tsx'e (Fuber · Yalnız bu bilgisayar · Gizli + model kartları; Ayarlar ile ortak bileşen). 0.13 T5:
// 'kip' (Business mode, Developer mode) ve 'gorunum' eklendi (adimlar/Kip.tsx, adimlar/Gorunum.tsx); kurulum on bir adım.
import type { ComponentType } from 'react';
import { ADIM_GECERLILIGI, type Kurulum2Adim, type KurulumTaslagi } from '../../shared/kurulum-taslak';
import { HosgeldinAdimi, HosgeldinOnizleme } from './adimlar/Hosgeldin';
import { TanismaAdimi, TanismaOnizleme } from './adimlar/Tanisma';
import { KipAdimi, KipOnizleme } from './adimlar/Kip';
import { GununAdimi, GununOnizleme } from './adimlar/Gunun';
import { NeredeAdimi, NeredeOnizleme } from './NeredeAdimi';
import { GorunumAdimi, GorunumOnizleme } from './adimlar/Gorunum';
import { SesAdimi, SesOnizleme } from './adimlar/Ses';
import { BaglantilarAdimi, BaglantilarOnizleme } from './adimlar/Baglantilar';
import { IzinlerAdimi, IzinlerOnizleme } from './adimlar/Izinler';
import { HazirsinAdimi, HazirsinOnizleme } from './adimlar/Hazirsin';

export interface Kurulum2AdimTanimi {
  id: Kurulum2Adim;
  /** Kısa ad (ekran okuyucu ve önizleme betiği). */
  ad: string;
  Bilesen: ComponentType;
  Onizleme: ComponentType;
  gecerliMi: (t: KurulumTaslagi) => boolean;
}

export const ADIMLAR: readonly Kurulum2AdimTanimi[] = [
  { id: 'hosgeldin', ad: 'Hoş geldin', Bilesen: HosgeldinAdimi, Onizleme: HosgeldinOnizleme, gecerliMi: ADIM_GECERLILIGI.hosgeldin },
  { id: 'tanisma', ad: 'Seni tanıyayım', Bilesen: TanismaAdimi, Onizleme: TanismaOnizleme, gecerliMi: ADIM_GECERLILIGI.tanisma },
  { id: 'kip', ad: 'Nasıl kullanacaksın', Bilesen: KipAdimi, Onizleme: KipOnizleme, gecerliMi: ADIM_GECERLILIGI.kip },
  { id: 'gunun', ad: 'Günün', Bilesen: GununAdimi, Onizleme: GununOnizleme, gecerliMi: ADIM_GECERLILIGI.gunun },
  { id: 'nerede', ad: 'Nerede çalışsın', Bilesen: NeredeAdimi, Onizleme: NeredeOnizleme, gecerliMi: ADIM_GECERLILIGI.nerede },
  { id: 'gorunum', ad: 'Görünüm', Bilesen: GorunumAdimi, Onizleme: GorunumOnizleme, gecerliMi: ADIM_GECERLILIGI.gorunum },
  { id: 'ses', ad: 'Ses', Bilesen: SesAdimi, Onizleme: SesOnizleme, gecerliMi: ADIM_GECERLILIGI.ses },
  { id: 'baglantilar', ad: 'Bağlantılar', Bilesen: BaglantilarAdimi, Onizleme: BaglantilarOnizleme, gecerliMi: ADIM_GECERLILIGI.baglantilar },
  { id: 'izinler', ad: 'İzinler', Bilesen: IzinlerAdimi, Onizleme: IzinlerOnizleme, gecerliMi: ADIM_GECERLILIGI.izinler },
  { id: 'hazirsin', ad: 'Hazırsın', Bilesen: HazirsinAdimi, Onizleme: HazirsinOnizleme, gecerliMi: ADIM_GECERLILIGI.hazirsin },
];

export const adimTanimi = (id: Kurulum2Adim): Kurulum2AdimTanimi => ADIMLAR.find((a) => a.id === id)!;
