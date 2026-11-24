// ── Hafıza kaydının kaynağı (I6, son inceleme; saf — birim testli: tests/hafiza-silme.test.ts) ─────────────────────────────────────
// Vaka (G26): model doğru bir hafızayı sessizce sildi; bağlam satırlarında kaydın nereden geldiği yoktu, model kullanıcının kendi
// söylediğini "yanlış kayıt" sanabildi. Artık her bağlam satırı kaynağını taşır ("(kurulum)", "(sen söyledin)", "(sohbetten)"…) ve
// kullanıcıdan gelen kayıt (kurulum, Hafıza'da elle eklenen, Ayarlar'daki ad) modelce yalnız ONAYLA silinir (ajan/araclar/temel.ts).
// `kaynak` alanı virgülle birleşebilir ("kurulum, sohbet:3": sonradan güncellendi): kullanıcıdan gelen bir parça varsa kayıt korunur.
// Bağlam satırlarında 'sen' kullanıcıdır (depo.ts turBaglami'nın Konuşma satırlarıyla aynı söz).

export type HafizaKaynagi = 'kurulum' | 'kullanici' | 'ayarlar' | 'sohbet' | 'belge' | 'gunkaydi' | 'yapilacaklar' | 'bilinmiyor';

const parcalar = (kaynak: string | undefined): string[] => String(kaynak ?? '').split(',').map((s) => s.trim()).filter(Boolean);

function tur(p: string): HafizaKaynagi {
  if (p === 'kurulum') return 'kurulum';
  if (p === 'kullanici') return 'kullanici';
  if (p === 'ayarlar') return 'ayarlar';
  if (p.startsWith('sohbet:')) return 'sohbet';
  if (p.startsWith('dosya:') || p.startsWith('belge:')) return 'belge';
  if (p.startsWith('gunkaydi:')) return 'gunkaydi';
  if (p.startsWith('yapilacaklar:')) return 'yapilacaklar'; // 0.11 G4: gün dönümünün "Tamamlananlar" kaydı (planlama.ts gunDonumu)
  return 'bilinmiyor';
}

/** Kullanıcının kendisinden gelen kaynaklar: model bunları kendiliğinden değiştirmez/silmez (onay ister). */
const KORUNAN: ReadonlySet<HafizaKaynagi> = new Set(['kurulum', 'kullanici', 'ayarlar']);

export const hafizaKaynaklari = (kaynak: string | undefined): HafizaKaynagi[] => parcalar(kaynak).map(tur);

/** Kayıt kullanıcıdan mı geldi (kurulum, Hafıza'da elle, Ayarlar'daki ad)? */
export const kullaniciKaynakliMi = (kaynak: string | undefined): boolean => hafizaKaynaklari(kaynak).some((k) => KORUNAN.has(k));

/**
 * Güncellemede kaynak birleştirme (düzeltme turu 2): yeni parça yoksa sona eklenir ("kurulum, sohbet:3"); alan `sinir` karakteri aşarsa
 * KULLANICIDAN gelen parçalar (kurulum, kullanici, ayarlar) hep kalır, en eski öteki parçalar düşer. Eskiden `.slice(-400)` baştaki
 * "kurulum" etiketini kesebiliyordu: kayıt kullanıcıdan gelmemiş sayılır, model onu onaysız silebilirdi.
 */
export function kaynakBirlestir(eski: string | undefined, yeni: string | undefined, sinir = 400): string {
  const l = parcalar(eski);
  const y = String(yeni ?? '').trim();
  if (y && !l.includes(y)) l.push(y);
  const korunan = l.filter((p) => KORUNAN.has(tur(p)));
  let oteki = l.filter((p) => !KORUNAN.has(tur(p)));
  const metin = () => [...korunan, ...oteki].join(', ');
  while (oteki.length > 1 && metin().length > sinir) oteki = oteki.slice(1);
  return metin().slice(0, Math.max(sinir, korunan.join(', ').length));
}

const ETIKET: Record<HafizaKaynagi, string> = {
  kurulum: 'kurulum', kullanici: 'sen söyledin', ayarlar: 'ayarlardan', sohbet: 'sohbetten', belge: 'belgeden', gunkaydi: 'gün kaydından', yapilacaklar: 'yapılacaklardan', bilinmiyor: 'eski kayıt',
};
/** 11 Kas (tasarımcı bulgu 7): Hafıza sayfasında kaydın kaynağı insan diliyle ("sohbet:1" değil "Sohbetten"). Önce kullanıcıdan gelen kaynak;
 *  bilinmeyen kaynak hiç yazılmaz (boş). */
const GORUNUM: Record<HafizaKaynagi, string> = {
  kurulum: 'Kurulumda', kullanici: 'Sen ekledin', ayarlar: 'Ayarlardan', sohbet: 'Sohbetten', belge: 'Belgeden', gunkaydi: 'Gün kaydından', yapilacaklar: 'Yapılacaklardan', bilinmiyor: '',
};
export function kaynakGorunumu(kaynak: string | undefined): string {
  const l = hafizaKaynaklari(kaynak);
  const k = (['kurulum', 'kullanici', 'ayarlar'] as const).find((x) => l.includes(x)) ?? l.find((x) => x !== 'bilinmiyor') ?? 'bilinmiyor';
  return GORUNUM[k];
}

/** Bağlam satırının kaynak etiketi: önce kullanıcıdan gelen kaynak (kurulum > sen söyledin > ayarlardan), yoksa ilk kaynak. */
export function kaynakEtiketi(kaynak: string | undefined): string {
  const l = hafizaKaynaklari(kaynak);
  const k = (['kurulum', 'kullanici', 'ayarlar'] as const).find((x) => l.includes(x)) ?? l[0] ?? 'bilinmiyor';
  return ETIKET[k];
}
