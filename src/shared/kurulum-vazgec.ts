// ── Yeniden açılan kurulum sihirbazında "Vazgeç" (Ruling 20; Görev 23 düzeltme 1) — saf, birim testli: tests/kurulum-vazgec.test.ts ──
// Sihirbaz seçimleri anında kaydeder (tema, kullanım biçimi, ana model, ses ve hız, yetkiler, Windows açılışı, Gizli mod ve yerel beynin
// açık/kapalı durumu). "Vazgeç"/Esc bunları açılıştaki hâline döndürür. Onaylı eylemler kalır: başlatılan deneme/plan ve yerel beyin
// indirmesi sürer (model ve indirme geri alınmaz); yalnız sihirbazda verilen "indirme bitince Gizli modu aç" isteği geri çekilir.
import type { Ayarlar } from './tipler.ts';

export type VazgecAyari = Pick<Ayarlar, 'gorunum' | 'mod' | 'modeller' | 'yetki' | 'ses' | 'baslangictaAc' | 'yerel'> & { proaktif?: Pick<Ayarlar['proaktif'], 'etkin'> & Partial<Ayarlar['proaktif']> };

/** Sihirbazın anında uyguladığı ayarların özeti: açılıştakiyle aynıysa geri alınacak bir şey yok. */
export const vazgecAnligi = (a: VazgecAyari): string => JSON.stringify([
  a.gorunum, a.mod, a.modeller, a.yetki, a.ses.uyandirma, a.ses.seslendirme, a.ses.hiz, a.baslangictaAc,
  a.yerel.gizliMod, a.yerel.etkin, Boolean(a.yerel.bekleyenKurulum?.gizliMod),
  // 0.12 H3c: Nerede adımının "Yalnız bu bilgisayar"ı da anında kaydedilir (adımdan ileri çıkarken).
  a.yerel.yalnizYerel === true,
  // 0.12 H3a (kurulum v2): İzinler'deki "Bildirimler" (proaktif.etkin) de anında kaydedilir.
  a.proaktif?.etkin,
]);

/**
 * Açılıştaki (`o`) ve şimdiki (`s`) ayarlardan geri alma: `ayar` ayarlar:kaydet'e gider (ses ve yerel alanları şimdikinin üstüne yalnız
 * sihirbazın değiştirdikleriyle yazılır — kısayol, model, indirme kaydı gibi öteki alanlar olduğu gibi); `bekleyenGizliKapat`: sihirbazda
 * verilen "indirme bitince Gizli modu aç" isteği ana süreçte geri çekilsin (yerel:bekleyen-gizli false). Değişiklik yoksa null.
 */
export function vazgecGeriAlma(o: VazgecAyari, s: VazgecAyari): { ayar: Partial<Ayarlar>; bekleyenGizliKapat: boolean } | null {
  if (vazgecAnligi(o) === vazgecAnligi(s)) return null;
  const ayar: Partial<Ayarlar> = {
    gorunum: o.gorunum, mod: o.mod, modeller: o.modeller, yetki: o.yetki,
    ses: { ...s.ses, uyandirma: o.ses.uyandirma, seslendirme: o.ses.seslendirme, hiz: o.ses.hiz },
  };
  if (o.proaktif && s.proaktif && o.proaktif.etkin !== s.proaktif.etkin) ayar.proaktif = { ...(s.proaktif as Ayarlar['proaktif']), etkin: o.proaktif.etkin };
  // Yerel beyin: Gizli mod, "Yalnız bu bilgisayar" (0.12 H3c) ve açık/kapalı açılıştaki hâline; bekleyen kurulum kaydını yalnız ana süreç
  // yazar (ipc.ts süzer), gönderilmez.
  if (o.yerel.gizliMod !== s.yerel.gizliMod || o.yerel.etkin !== s.yerel.etkin || (o.yerel.yalnizYerel === true) !== (s.yerel.yalnizYerel === true)) {
    const { bekleyenKurulum: _b, ...yerel } = s.yerel;
    ayar.yerel = { ...yerel, gizliMod: o.yerel.gizliMod, etkin: o.yerel.etkin, yalnizYerel: o.yerel.yalnizYerel === true } as Ayarlar['yerel'];
  }
  if (o.baslangictaAc !== s.baslangictaAc) ayar.baslangictaAc = o.baslangictaAc; // yalnız değiştiyse (Windows açılış öğesi)
  const bekleyenGizliKapat = Boolean(s.yerel.bekleyenKurulum?.gizliMod) && !o.yerel.bekleyenKurulum?.gizliMod;
  return { ayar, bekleyenGizliKapat };
}
