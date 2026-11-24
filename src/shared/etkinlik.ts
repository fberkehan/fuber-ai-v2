// ── Etkinlik sayfasının saf yardımcıları (Görev 1, Karar D1; birim testli: tests/etkinlik.test.ts) ─────────────────────────────────────
// 3B beyin kalktı; Beyin sayfasının yerinde 2B "Etkinlik" sayfası (sayfalar/Etkinlik.tsx) aynı veriyi (`beyin:durum`, `beyin:olay`) sade
// gösterir: Akış satırı saniyeli saatle, düz cümlelerle. 0.13 T15 (Spec H): "Parçalar" listesi (Akıl, El, Göz, Kulak…) kalktı; sayfa yalnız
// Fuber'in ne yaptığını gösteren tek sütun akıştır. Eski sayfa adı ("beyin": telefondan ya da kayıtlı bir yerden gelen `ana:git`)
// Etkinlik'e çözülür — boş sayfa açılmaz. Saf modül: çalışma anı içe aktarması yok.
import { olayMetni, type BeyinOlayi } from './beyin.ts';

const iki = (n: number) => String(n).padStart(2, '0');

/** Akış satırının saati: 'SS:DD:ss' (tr-TR, 24 saat, yerel saat). Geçersiz zaman boş. */
export function akisSaati(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return `${iki(t.getHours())}:${iki(t.getMinutes())}:${iki(t.getSeconds())}`;
}

/** Akış'ın görünen satırları, en yenisi üstte: satıra dönüşmeyen olaylar (başla/bitti gürültüsü, İş'te Kod) süzülür; peş peşe AYNI satır
 *  (bir araç çalışırken hem sinyal hem başlangıç olayı yazar) tek satır olur; en çok `enCok` satır. */
export function akisSatirlari(olaylar: readonly BeyinOlayi[], mod: 'is' | 'gelistirici', enCok = 60): { o: BeyinOlayi; m: { ust: string; alt?: string } }[] {
  const satirlar: { o: BeyinOlayi; m: { ust: string; alt?: string } }[] = [];
  for (const o of olaylar) {
    const m = olayMetni(o, mod);
    if (!m) continue;
    const once = satirlar[satirlar.length - 1]?.m;
    if (once && once.ust === m.ust && once.alt === m.alt) continue; // ilk olayın saati kalır
    satirlar.push({ o, m });
  }
  return satirlar.slice(-enCok).reverse();
}

/** Akış boşken tek satır. 11 Kas (tasarımcı bulgu 1): görev sürerken "Henüz bir şey olmadı" denmez (kokpit aynı anda görevleri gösterir). */
export function akisBosMetni(surenGorev: number): string {
  return surenGorev > 0
    ? `${surenGorev} görev arka planda sürüyor; attıkları adımlar burada saniyesiyle akar.`
    : 'Henüz bir şey olmadı. Fuber çalıştıkça her adım burada saniyesiyle akar.';
}

/** Eski sayfa adları: 'beyin' (0.9'un Beyin sayfası) → 'etkinlik'; gerisi aynen. */
export const sayfaAdiCoz = (ad: string): string => (ad === 'beyin' ? 'etkinlik' : ad);
