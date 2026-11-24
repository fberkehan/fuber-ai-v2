// ── Çentiğin açık paneli: sayfalar, sıra ayarı ve gezinme (0.14 T23; saf; tests/centik-sayfalar.test.ts) ──────────────────────────────────────
// Panel (560×188; src/shared/ada.ts 'panel') dokuz sayfadan birini gösterir. Asistan her zaman vardır (kapatılamaz, sırası değişebilir); öbürleri
// Görünüm → "Çentik sayfaları"nda açılıp kapanır ve sıralanır (Ayarlar.gorunum.centikSayfalari). Kaydı olmayan sayfa gizlenmez: Panel.tsx'te tek
// satır boş durum ve "Bağla" düğmesi gösterir; T24–T27 kendi sayfa bileşenini `sayfaKaydet` ile kaydeder (B9).
// Gezinme (R20): uçlarda durur, sarmaz (`komsuSayfa` uçta null; uçtaki ok gizlenir). Fare tekerleği 60 birim biriktirince bir sayfa (en sık 250 ms'de bir;
// süre denetimi Panel.tsx'te zaman damgasıyla, zamanlayıcı yok).
// Renkler (R19, B31): sayfa vurguları burada tek yerde; Asistan'ın vurgusu kipin rengidir (ui/goz/vurgu.ts KIP_VURGUSU: Business turuncu, Developer
// yeşil) — `sayfaVurgusu` kipe göre seçer. DOM yok: ana süreç (ayar doğrulaması) ve arayüz aynı kuralı okur.
import { KIP_VURGUSU } from '../renderer/ui/goz/vurgu.ts';

export type SayfaKimligi = 'asistan' | 'gundem' | 'gorevler' | 'gelenler' | 'muzik' | 'soz' | 'odak' | 'yapilacaklar' | 'raf';

/** Sayfa adı, simgesi (`Ikon` adı) ve vurgusu. Asistan'ın vurgusu burada Business rengidir; kipe göre doğrusu `sayfaVurgusu`. */
export const PANEL_SAYFALARI: Record<SayfaKimligi, { ad: string; simge: string; vurgu: string }> = {
  asistan: { ad: 'Asistan', simge: 'asistan', vurgu: KIP_VURGUSU.business },
  gundem: { ad: 'Gündem', simge: 'saat', vurgu: '#5E5CE6' },
  gorevler: { ad: 'Görevler', simge: 'bolt', vurgu: '#64D2FF' },
  gelenler: { ad: 'Gelenler', simge: 'posta', vurgu: '#FFD60A' },
  muzik: { ad: 'Müzik', simge: 'dalga', vurgu: '#FF375F' },
  soz: { ad: 'Şarkı sözü', simge: 'kalem', vurgu: '#BF5AF2' },
  odak: { ad: 'Odak', simge: 'hedef', vurgu: '#FF453A' },
  yapilacaklar: { ad: 'Yapılacaklar', simge: 'tamam', vurgu: '#30D158' },
  raf: { ad: 'Raf', simge: 'klasor', vurgu: '#0A84FF' },
};

/** Dokuz sayfa, Asistan başta (yeni profilde hepsi açık). */
export const VARSAYILAN_SAYFA_SIRASI: readonly SayfaKimligi[] = ['asistan', 'gundem', 'gorevler', 'gelenler', 'muzik', 'soz', 'odak', 'yapilacaklar', 'raf'];

const sayfaMi = (x: unknown): x is SayfaKimligi => typeof x === 'string' && Object.hasOwn(PANEL_SAYFALARI, x);

/** Sayfanın vurgusu: Asistan kipin rengini alır (Developer mode'da yeşil), öbürleri kendi rengini. `kip`: mod ('is' | 'gelistirici') ya da
 *  gözlerin kipi ('business' | 'developer'; çentik ikisini de taşır). */
export function sayfaVurgusu(id: SayfaKimligi, kip: string = 'is'): string {
  if (id !== 'asistan') return PANEL_SAYFALARI[id].vurgu;
  return kip === 'gelistirici' || kip === 'developer' ? KIP_VURGUSU.developer : KIP_VURGUSU.business;
}

/**
 * Ayarlardaki "Çentik sayfaları"nı doğrular (elle bozulmuş dosya, eski profil, gelecekteki sürümden kalan sayfa). Bilinmeyen sayfa düşer, tekrar düşer;
 * sırada olmayan sayfa (yeni sürümle gelen) varsayılan yerinden sona eklenir — kaybolmaz. Asistan kapatılamaz (kapalı listesinden düşer); sırası değişebilir.
 */
export function sayfaAyariDogrula(x: unknown): { sira: SayfaKimligi[]; kapali: SayfaKimligi[] } {
  const o = x && typeof x === 'object' ? (x as { sira?: unknown; kapali?: unknown }) : {};
  const tekil = (l: unknown): SayfaKimligi[] => (Array.isArray(l) ? [...new Set(l.filter(sayfaMi))] : []);
  const sira = tekil(o.sira);
  for (const s of VARSAYILAN_SAYFA_SIRASI) if (!sira.includes(s)) sira.push(s);
  return { sira, kapali: tekil(o.kapali).filter((s) => s !== 'asistan') };
}

/** Panelde gezilen sayfalar: sıradakilerden kapalı olmayanlar (doğrulanmış ayar; Asistan hep içinde). */
export function acikSayfalar(a: unknown): SayfaKimligi[] {
  const d = sayfaAyariDogrula(a);
  return d.sira.filter((s) => !d.kapali.includes(s));
}

/** Sıradaki komşu sayfa (R20): uçlarda durur (sarmaz) — uçta ya da sayfa sırada yoksa null. */
export function komsuSayfa(sira: readonly SayfaKimligi[], simdiki: SayfaKimligi, yon: 1 | -1): SayfaKimligi | null {
  const i = sira.indexOf(simdiki);
  if (i < 0) return null;
  return sira[i + yon] ?? null;
}

/** Bir sayfa için gereken tekerlek birikimi (R20). */
export const TEKERLEK_ESIGI = 60;
/** Tekerlek iki sayfa adımı arasında en az bu kadar bekler (ms; Panel.tsx zaman damgasıyla uygular). */
export const TEKERLEK_ARALIK_MS = 250;

/**
 * Tekerlek birikimi (R20): `deltaY` birikir, ±60'ı geçince bir adım verir ve birikim sıfırlanır. Yön değişince birikim yeni yönden baştan başlar (geri dönen
 * parmak eski yöndeki birikimi tüketmek zorunda kalmasın). Trackpad'in küçük adımları da aynı yoldan toplanır.
 */
export function tekerlekBirikimi(birikim: number, deltaY: number): { birikim: number; adim: -1 | 0 | 1 } {
  const d = Number.isFinite(deltaY) ? deltaY : 0;
  const b = (Math.sign(birikim) !== 0 && Math.sign(d) !== 0 && Math.sign(birikim) !== Math.sign(d) ? 0 : birikim) + d;
  if (b >= TEKERLEK_ESIGI) return { birikim: 0, adim: 1 };
  if (b <= -TEKERLEK_ESIGI) return { birikim: 0, adim: -1 };
  return { birikim: b, adim: 0 };
}
