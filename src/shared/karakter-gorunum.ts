// ── Sade mod (0.14 T6b; saf; tests/karakter-gorunum.test.ts) — karakterlerin görünüp görünmeyeceğinin TEK kuralı ──────────────────────────────
// Karakterlerin hiç olmadığı bir sade mod da var. Ayar: Ayarlar.gorunum.karakterler
// ('goster' varsayılan | 'sade'); Business mode ve Developer mode'dan bağımsız. Sade'de hiçbir yüzeyde (çentik, sohbet, panel, kokpit, kurulum,
// mod geçişi) göz çizilmez: yerine aynı boyda nötr işaret (renderer/ui/goz/SadeIsaret.tsx), ad
// yerine "Fuber". Son inceleme I5: sistem istemi ve ses de Fuber'indir (turKarakteri, sesKipi; aşağıda).
// Arayüzde kanca: renderer/karakter-gorunum.ts useKarakterGorunur(). Sonraki görevler (T19–T33) karakter çizen her yerde bunlardan birine bakar.
import type { Ayarlar, KarakterGorunumu } from './tipler.ts';
import { etkinKarakter, type Karakter, type KipKimligi } from './karakterler.ts';
import type { GozHali, GozIfadesi } from './goz.ts';

export type { KarakterGorunumu };
export const KARAKTER_GORUNUMLERI: readonly KarakterGorunumu[] = ['goster', 'sade'];
export const KARAKTER_GORUNUMU_VARSAYILAN: KarakterGorunumu = 'goster';
/** Sade'de karakter adının yerine görünen ad. */
export const SADE_AD = 'Fuber';

/** Geçerli bir değer mi (kayıt süzgeci, telefon köprüsü, açılış göçü). */
export const karakterGorunumuGecerli = (v: unknown): v is KarakterGorunumu => v === 'goster' || v === 'sade';

/** Karakterler çizilsin mi. Yalnız açık 'sade' kapatır: alan yoksa ya da bozuksa varsayılan ('goster'). */
export function karakterGorunurMu(a: Pick<Ayarlar, 'gorunum'> | { gorunum?: { karakterler?: unknown } } | null | undefined): boolean {
  return a?.gorunum?.karakterler !== 'sade';
}

/** Sade işaretinin hâli (renderer/ui/karakter/SadeIsaret.tsx): karakterin hâl sinyalleri hayvan çizimi olmadan. */
export type SadeHal = 'sakin' | 'dinliyor' | 'dusunuyor' | 'konusuyor' | 'onay' | 'hata' | 'sevinc' | 'uyuyor';
/** Karakterin hâli ya da ifadesi → işaretin hâli (hâl üstün; çalışıyor düşünmek gibi görünür). */
export function sadeHal(hal?: GozHali, ifade?: GozIfadesi): SadeHal {
  if (hal) return hal === 'calisiyor' ? 'dusunuyor' : hal;
  return ifade ?? 'sakin';
}

/** Ekranda görünen ad: 11 Kas'tan beri iki görünümde ve iki modda da "Fuber" (kayıtlı eski iletinin taşıdığı hayvan adı da gösterilmez). Boş ad boş kalır
 *  (çağıran "ad yok" diye bir şey çizmiyorsa yine çizmez). `gorunur` imza uyumu için durur. */
export function gorunenKarakterAdi(_gorunur: boolean, ad: string | undefined | null): string {
  if (!ad) return '';
  return SADE_AD;
}

// ── 0.14 son inceleme I5: Sade modda model ve ses de Fuber olarak konuşur ──────────────────────────────────────────────────────────────────────────
// Ürün kuralı "Sade modda karakter hiçbir yerde yok": yalnız çizim ve etiket değil, sistem istemi de karakterin adını ya da tanımını taşımaz (yoksa model
// başka bir ad söyler) ve ses kipin karakter sesi yerine Fuber'in sesidir (sunucu `kip` gelmezse Ses kimliğini seçer). Kip (Business/Developer) korunur:
// araç ve komut notları kipe bakar. Yönetim'den gelen karakter (ad + istem) yalnız karakterler görünürken uygulanır.
/** Sade'de karakter isteminin yerine giden kimlik cümlesi (main/ajan/karakter-istemi.ts karakterIstemi `sade` karakterde bunu kullanır). */
export const SADE_KIMLIK_ISTEMI = 'Adın Fuber. Kendini başka bir adla, bir hayvan ya da bir karakter olarak tanıtma; sorulursa "Ben Fuber" de. Üslubun sade, sıcak ve açık.';

/** Turun karakteri: karakterler görünürken kipin karakteri (Yönetim/hesap önbelleği ya da gömülü), Sade'de kipi koruyan ama adı "Fuber", istemi kimlik
 *  cümlesi olan nötr karakter (`sade: true`). */
export function turKarakteri(a: Pick<Ayarlar, 'mod' | 'gorunum' | 'hesap'>): Karakter {
  const k = etkinKarakter(a.mod, a.hesap?.karakterler);
  if (karakterGorunurMu(a)) return k;
  return { kip: k.kip, ad: SADE_AD, tanim: '', sistemIstemi: SADE_KIMLIK_ISTEMI, gorsel: null, sade: true };
}

/** Seslendirmenin kipi: Sade'de gönderilmez (sunucu Fuber'in sesini — Ses kimliği — seçer), görünürken turun kipi. */
export function sesKipi(kip: KipKimligi | undefined, a: Pick<Ayarlar, 'gorunum'> | null | undefined): KipKimligi | undefined {
  return karakterGorunurMu(a) ? kip : undefined;
}
