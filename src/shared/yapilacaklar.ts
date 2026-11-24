// ── Yapılacaklar kartı: ne gösterilir (saf; birim testli: tests/yapilacaklar.test.ts) ────────────────────────────────────────────
// İşaretlenen madde hemen siliniyordu; üstü çizilmeli. İşaretlenen madde ana süreçte silinmez
// (planlama.ts kokpitYapilacaklari: açıklar, ardından yerel bugünden beri tamamlananlar); burada kartın kısıtlı yerine nasıl sığdığı
// ve alt satırın yazısı belirlenir. Kartta kaydırma yok (arayüz kütüphanesi): sığmayan açık maddeler "N öğe daha" notuna iner —
// işaretli madde ise yer ayrılmış olarak görünür kalır (en son işaretlenen en altta).
import { oncelikGorunumu } from './oncelik.ts';
import type { Boy } from './izgara.ts';
import type { Gorev, KokpitVerisi } from './tipler.ts';

/** Kart boyuna göre en çok kaç satır (satır ≈ 40–56 px; shared/pano-duzen.ts GOVDE_PX: k 124, o 230, b 336). */
export const YAPILACAK_AZAMI: Record<Boy, number> = { k: 2, o: 4, b: 6 };

/** Kartın listesi: `yapilacaklar` (açıklar + bugünün işaretlileri); eski/boş veride yalnız açık görevler. */
export function kartGorevleri(v: Pick<KokpitVerisi, 'gorevler' | 'yapilacaklar'>): Gorev[] {
  return v.yapilacaklar ?? v.gorevler;
}

/**
 * Açık (işaretlenmemiş) yapılacak sayısı — kokpitte TEK kaynak (0.11 G5 düzeltme turu 1, K3): selamlamanın yedek cümlesi, kartın alt
 * şeridi ("N açık iş") ve "Tümü" levhası aynı sayıyı söyler. `yapilacaklar` (ana süreç: açıkların tamamı, en çok 200) varsa ondan;
 * eski/boş veride `gorevler`den (onlar zaten açık). `gorevler` kısa listedir (gündem ve planlayıcı için 12): sayı ondan alınmaz.
 */
export function acikYapilacaklar<T extends { durum: string }>(v: { gorevler: readonly T[]; yapilacaklar?: readonly T[] }): T[] {
  return v.yapilacaklar ? v.yapilacaklar.filter((g) => g.durum !== 'tamam') : [...v.gorevler];
}
export function acikYapilacakSayisi(v: { gorevler: readonly unknown[]; yapilacaklar?: readonly { durum: string }[] }): number {
  return v.yapilacaklar ? v.yapilacaklar.filter((g) => g.durum !== 'tamam').length : v.gorevler.length;
}

/**
 * Sığan satırlar. Liste açıklar önce, işaretliler (tamamlanma artan) sonra gelir. Yer yetmezse işaretlilere en az yarısı ayrılır
 * (açıklar azalır; en eski işaretliler önce düşer — az önce işaretlenen madde yerinde kalır), yer artarsa işaretliler açıkların boşluğunu alır.
 * `gizli`: sığmayanlar (önce açıklar, sonra eski işaretliler) — arayüz "N öğe daha" notu için sayar.
 */
export function yapilacakGorunumu(liste: readonly Gorev[], azami: number): { gorunen: Gorev[]; gizli: Gorev[] } {
  const acik = liste.filter((g) => g.durum !== 'tamam');
  const tam = liste.filter((g) => g.durum === 'tamam');
  const yer = Number.isFinite(azami) ? Math.max(0, Math.floor(azami)) : 0;
  const t = Math.min(tam.length, Math.max(Math.floor(yer / 2), yer - acik.length));
  const a = Math.min(acik.length, yer - t);
  return {
    gorunen: [...acik.slice(0, a), ...tam.slice(tam.length - t)],
    gizli: [...acik.slice(a), ...tam.slice(0, tam.length - t)],
  };
}

const saatMetni = (iso: string) => new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

/**
 * Satırın alt yazısı. İşaretli: "tamamlandı 14:05". Açık: proje · "son <tarih>" (geçtiyse "gecikti <tarih>") · yüksek öncelik
 * ("öncelik 4/5"; sıradan öncelik sıralamadan belli, yazılmaz). `tarih`: son tarihin yazımı (arayüzde saatTarih).
 */
export function yapilacakAlt(g: Gorev, tarih: (iso: string) => string, simdi = Date.now()): string {
  const parca: string[] = [];
  if (g.proje) parca.push(g.proje);
  if (g.durum === 'tamam') {
    parca.push(g.tamamlanma ? `tamamlandı ${saatMetni(g.tamamlanma)}` : 'tamamlandı');
    return parca.join(' · ');
  }
  if (g.sonTarih) {
    const z = Date.parse(g.sonTarih);
    parca.push(`${Number.isFinite(z) && z < simdi ? 'gecikti' : 'son'} ${tarih(g.sonTarih)}`);
  }
  const o = oncelikGorunumu(g.oncelik);
  if (o.sayi >= 4) parca.push(o.etiket.toLowerCase());
  return parca.join(' · ');
}
