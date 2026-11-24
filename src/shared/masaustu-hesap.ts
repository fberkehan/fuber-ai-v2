// ── Remote-service state shims (pure; no network) ─────────────────────────────────────────────────────────────────────────────────
// Fuber AI v1 has no Fuber account, server or hosted voice service. This module only keeps the small, pure types and messages that the
// engine-status, voice and onboarding logic still share. Nothing here performs I/O; the "account" is permanently absent and the app
// runs on the user's own provider key (Claude, OpenAI-compatible) or on local models.
import type { Karakter, KipKimligi } from './karakterler.ts';
import type { PaketBilgisi } from './whatsapp-yetki.ts';

/** Kept for the settings schema: a remote-service record can never exist in this build. */
export type HesapDurumu = 'aktif' | 'bekliyor' | 'kapali' | 'kredi-bitti';
export interface HesapAyari {
  eposta: string;
  cihazAdi: string;
  durum: HesapDurumu;
  kredi?: number;
  sesId?: string | null;
  epostaDogrulandi?: boolean;
  karakterler?: Record<KipKimligi, Karakter>;
  paket?: PaketBilgisi;
}

export const HESAP_DURUM_METNI: Readonly<Record<HesapDurumu, string>> = {
  aktif: 'Uzak hizmet bağlı.',
  bekliyor: 'Uzak hizmet onay bekliyor.',
  kapali: 'Uzak hizmet kapalı.',
  'kredi-bitti': 'Uzak hizmet kullanım hakkı doldu.',
};
export const HESAP_DURUM_ETIKETI: Readonly<Record<HesapDurumu, string>> = {
  aktif: 'Bağlı', bekliyor: 'Onay bekliyor', kapali: 'Kapalı', 'kredi-bitti': 'Kullanım hakkı doldu',
};

/** Always false: this build has no remote engine. */
export const hesapMotoruAcik = (_hesap: Pick<HesapAyari, 'durum'> | null | undefined): boolean => false;
export const hesapGecerliMi = (h: Pick<HesapAyari, 'durum'> | null | undefined): boolean => Boolean(h) && h!.durum !== 'kapali';
/** The settings file can never carry a remote-service record: anything found there is dropped. */
export const cihazSonekiGecerli = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{4}$/.test(x);
export const hesapAyariDuzelt = (_x: unknown): HesapAyari | undefined => undefined;

// ── Voice fallbacks ──
/** Thrown by an optional remote speech provider that has no model; callers fall back to local speech silently. */
export class SesModeliYok extends Error {
  readonly sesYok = true as const;
  readonly tur: 'tts' | 'stt';
  constructor(tur: 'tts' | 'stt') {
    super(tur === 'tts' ? 'Ses şu an kullanılamıyor.' : 'Dikte şu an kullanılamıyor.');
    this.name = 'SesModeliYok';
    this.tur = tur;
  }
}
export const sesModeliYokMu = (e: unknown): e is SesModeliYok => Boolean(e && typeof e === 'object' && (e as { sesYok?: unknown }).sesYok === true);

export const DIKTE_KULLANILAMIYOR = 'Dikte şu an kullanılamıyor.';
export const DIKTE_BELIRTEC_SN = 120;
export type DikteSiniriTuru = 'kredi' | 'tavan';
export const DIKTE_SINIR_METNI: Readonly<Record<DikteSiniriTuru, string>> = {
  kredi: 'Kullanım hakkın doldu; dikte şimdilik çalışmıyor.',
  tavan: 'Bugünkü dikte sınırın doldu; yarın yeniden açılır.',
};
export class DikteSiniri extends Error {
  readonly dikteSiniri = true as const;
  readonly tur: DikteSiniriTuru;
  constructor(tur: DikteSiniriTuru) {
    super(DIKTE_SINIR_METNI[tur]);
    this.name = 'DikteSiniri';
    this.tur = tur;
  }
}
export const dikteSiniriMi = (e: unknown): e is DikteSiniri => Boolean(e && typeof e === 'object' && (e as { dikteSiniri?: unknown }).dikteSiniri === true);
export const TELEFON_SES_YOK = 'Ses şu an kullanılamıyor; yazıyla devam edebilirsin.';
export const TELEFON_SES_HATA = 'Ses şu an çalınamadı; birazdan yeniden dene.';
