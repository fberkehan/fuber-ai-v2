// ── Toplantı modu: ses kaynağı hataları ve izin kararı (13 Kas 2026, 0.17.3; saf — tests/toplanti.test.ts) ────────────────────────────────────
// Kurulu 0.17.2'de "Ne bilgisayarın sesi ne mikrofon alınabildi" çıkıyordu. Paketli ölçüm (scripts/dev/toplanti-paketli.mjs) kök nedeni
// gösterdi: "mikrofonu tamamen kapat" ayarı açıkken izin işleyicisi YALNIZ mikrofonu değil, getDisplayMedia'yı (bilgisayarın sesi) da reddediyordu —
// ikisi de `NotAllowedError: Permission denied`. Hata ayrıntısı da yutuluyordu. Burada: (1) izin kararı, (2) her kaynak için gerçek nedeni tek cümle + eylem.

import type { Konusan } from './toplanti.ts';

/**
 * 'media' izni kararı (main.ts izin işleyicisi): "mikrofonu tamamen kapat" açıkken mikrofon (mediaTypes ['audio']) reddedilir ama bilgisayarın sesi
 * (getDisplayMedia; mediaTypes BOŞ gelir — 13 Kas paketli ölçüm) yalnız Toplantı'nın açtığı kısa pencerede geçer. Mikrofon kapalı değilse her media isteği geçer.
 */
export function mediaIzniVerilir(g: { mikrofonKapali: boolean; mediaTypes?: readonly string[]; ekranSesiPenceresi: boolean }): boolean {
  if (!g.mikrofonKapali) return true;
  return (g.mediaTypes?.length ?? 0) === 0 && g.ekranSesiPenceresi;
}

/** Tarayıcının verdiği ham hata (yalnız günlüğe; kullanıcıya gösterilmez). */
export interface HamKaynakHatasi { ad: string; ileti: string }

export type KaynakEylemi = 'yeniden' | 'windows-mikrofon' | 'mikrofon-ac';
export type KaynakNedeni = 'ayar-kapali' | 'windows-izin' | 'izin' | 'bulunamadi' | 'kullanimda' | 'paylasilamadi' | 'bilinmiyor';
export interface KaynakHatasiGorunumu { neden: KaynakNedeni; metin: string; eylem: KaynakEylemi }

/** Ayarlar → Gizlilik → Mikrofon (Windows). Yalnız bu sabit adres açılır. */
export const WINDOWS_MIKROFON_AYARI = 'ms-settings:privacy-microphone';

/** Her kaynak için tek cümle (ne oldu) — eylem düğmesi yanında durur. Kullanıcıya hata adı/izi gösterilmez. */
export const KAYNAK_METNI: Record<Konusan, Record<KaynakNedeni, string>> = {
  siz: {
    'ayar-kapali': 'Mikrofon Fuber ayarlarında kapalı; yalnız karşı taraf yazılıyor.',
    'windows-izin': 'Windows mikrofon izni kapalı; yalnız karşı taraf yazılıyor.',
    izin: 'Mikrofon izni verilmedi; yalnız karşı taraf yazılıyor.',
    bulunamadi: 'Mikrofon bulunamadı; yalnız karşı taraf yazılıyor.',
    kullanimda: 'Mikrofon başka bir uygulamada kullanılıyor ya da açılamadı; yalnız karşı taraf yazılıyor.',
    paylasilamadi: 'Mikrofon açılamadı; yalnız karşı taraf yazılıyor.',
    bilinmiyor: 'Mikrofon açılamadı; yalnız karşı taraf yazılıyor.',
  },
  karsi: {
    'ayar-kapali': 'Bilgisayar sesi paylaşılamadı; yalnız mikrofon yazılıyor.',
    'windows-izin': 'Bilgisayar sesi paylaşılamadı; yalnız mikrofon yazılıyor.',
    izin: 'Bilgisayar sesi paylaşılamadı; yalnız mikrofon yazılıyor.',
    bulunamadi: 'Bilgisayar sesi paylaşılamadı; yalnız mikrofon yazılıyor.',
    kullanimda: 'Bilgisayar sesi paylaşılamadı; yalnız mikrofon yazılıyor.',
    paylasilamadi: 'Bilgisayar sesi paylaşılamadı; yalnız mikrofon yazılıyor.',
    bilinmiyor: 'Bilgisayar sesi paylaşılamadı; yalnız mikrofon yazılıyor.',
  },
};
/** İki kaynak da yokken (toplantı başlamaz): kaynak başına cümle "yalnız … yazılıyor" demez. */
export const KAYNAK_METNI_HICBIRI: Record<Konusan, Record<KaynakNedeni, string>> = {
  siz: {
    'ayar-kapali': 'Mikrofon Fuber ayarlarında kapalı.', 'windows-izin': 'Windows mikrofon izni kapalı.', izin: 'Mikrofon izni verilmedi.',
    bulunamadi: 'Mikrofon bulunamadı.', kullanimda: 'Mikrofon başka bir uygulamada kullanılıyor ya da açılamadı.', paylasilamadi: 'Mikrofon açılamadı.', bilinmiyor: 'Mikrofon açılamadı.',
  },
  karsi: {
    'ayar-kapali': 'Bilgisayar sesi paylaşılamadı.', 'windows-izin': 'Bilgisayar sesi paylaşılamadı.', izin: 'Bilgisayar sesi paylaşılamadı.',
    bulunamadi: 'Bilgisayar sesi paylaşılamadı.', kullanimda: 'Bilgisayar sesi paylaşılamadı.', paylasilamadi: 'Bilgisayar sesi paylaşılamadı.', bilinmiyor: 'Bilgisayar sesi paylaşılamadı.',
  },
};

/**
 * Ham hata → kullanıcıya görünen neden + eylem.
 *  · Mikrofon: ayar kapalıysa "Mikrofonu aç"; NotAllowedError + "by system" (Windows gizlilik) "Windows ayarlarını aç"; NotFoundError/OverconstrainedError bulunamadı;
 *    NotReadableError/AbortError/TrackStartError kullanımda; ham NotAllowedError (Fuber'in izin işleyicisi) izin verilmedi.
 *  · Bilgisayarın sesi: hangi hata olursa olsun tek cümle "Bilgisayar sesi paylaşılamadı" + "Yeniden dene" (neden günlükte).
 */
export function kaynakHatasiCoz(kaynak: Konusan, h: Partial<HamKaynakHatasi> | null | undefined, ctx: { mikrofonKapali?: boolean; hicbiri?: boolean } = {}): KaynakHatasiGorunumu {
  const ad = String(h?.ad ?? '');
  const ileti = String(h?.ileti ?? '');
  let neden: KaynakNedeni = 'bilinmiyor';
  let eylem: KaynakEylemi = 'yeniden';
  if (kaynak === 'siz') {
    if (ctx.mikrofonKapali && (ad === 'NotAllowedError' || ad === 'SecurityError' || ad === '')) { neden = 'ayar-kapali'; eylem = 'mikrofon-ac'; }
    else if (ad === 'NotAllowedError' && /by system/i.test(ileti)) { neden = 'windows-izin'; eylem = 'windows-mikrofon'; }
    else if (ad === 'NotAllowedError' || ad === 'SecurityError') neden = 'izin';
    else if (ad === 'NotFoundError' || ad === 'OverconstrainedError' || ad === 'DevicesNotFoundError') neden = 'bulunamadi';
    else if (ad === 'NotReadableError' || ad === 'AbortError' || ad === 'TrackStartError') neden = 'kullanimda';
  } else neden = 'paylasilamadi';
  const tablo = ctx.hicbiri ? KAYNAK_METNI_HICBIRI : KAYNAK_METNI;
  return { neden, metin: tablo[kaynak][neden], eylem };
}

/** Açılışın sonucu: en az bir kaynak açıksa toplantı onunla başlar; ikisi de yoksa başlamaz. `eksik` her açılamayan kaynak için bir çip demektir. */
export function kaynakDurumu(k: Record<Konusan, 'acik' | 'yok' | 'kesildi'>): { baslar: boolean; eksik: Konusan[] } {
  const eksik = (['karsi', 'siz'] as const).filter((x) => k[x] !== 'acik');
  return { baslar: eksik.length < 2, eksik };
}
