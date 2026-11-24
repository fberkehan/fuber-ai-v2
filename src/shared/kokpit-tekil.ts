// ── Kokpitte her bilgi tek yerde (11 Kas tasarımcı analizi, bulgu 6; saf — tests/kokpit-tekil.test.ts) ────────────────────────────────────
// Kokpit aynı bilgiyi 2–3 kez gösteriyordu: Bugün bandı + Yapılacaklar/Hatırlatıcılar kartları + sağdaki "Bugünün özeti"; Gündemde + Haberler
// kartı + özet; hava kartı + özet. "Ne yapmalıyım?" sorusunun yanıtı (Bugün bandı) kalabalıkta kayboluyordu. Kural:
//  · Bugün bandında görünen kayıtlar (en çok BUGUN_EN_COK) Hatırlatıcılar ve Yapılacaklar kartlarına girmez (bandda ✓ ile tamamlanırlar);
//    Son e-postalar gelen kutusunun görünümüdür, toplantı e-postası orada da kalır (kartın kendi amacı: okunmamışları tara); kartta kayıt kalmazsa kart çizilmez
//    (kartDoluMu). Bandın fazlası ("+N daha · kartlarda") kartlarda kalır.
//  · Gündemde'nin gösterdiği haberler Haberler kartında yinelenmez (kartın "Tümü" levhası yine bütün haberleri listeler).
//  · "Bugünün özeti" yalnız ızgarada olmayanı taşır; hepsi ızgaradaysa özet çizilmez — sağ panel sohbet olur.
import { gundemOgeleri } from './gundem.ts';
import type { GundemKonusu, Haber } from './pano.ts';
import type { KokpitVerisi } from './tipler.ts';

/** Bugün bandının en çok gösterdiği kayıt sayısı (PanoKartlari.tsx GundemBandi ile aynı). */
export const BUGUN_EN_COK = 4;
/** Gündemde bölümünün en çok gösterdiği konu / başlık sayısı. */
export const KONU_EN_COK = 3;

/** Bandda görünen kayıtlar çıkarılmış kart verisi (girdi değişmez). Bant ve selam bandı tam veriyi okumaya devam eder. */
export function bantDisiVeri(v: KokpitVerisi, simdi = Date.now()): KokpitVerisi {
  let ogeler: string[];
  try { ogeler = gundemOgeleri(v, simdi).ogeler.slice(0, BUGUN_EN_COK).map((o) => o.id); } catch { return v; }
  if (!ogeler.length) return v;
  const bantta = new Set(ogeler);
  const gorevDisi = <T extends { id: number }>(l: readonly T[]) => l.filter((g) => !bantta.has(`g:${g.id}`));
  return {
    ...v,
    hatirlaticilar: v.hatirlaticilar.filter((h) => !bantta.has(`h:${h.id}`)),
    gorevler: gorevDisi(v.gorevler),
    ...(v.yapilacaklar ? { yapilacaklar: gorevDisi(v.yapilacaklar) } : {}),
  };
}

/** Gündemde bölümünün gösterdiği haberlerin kimlikleri: konular varsa ilk konuların örnek haberi, yoksa ilk başlıklar ("Son haberler"). */
export function bantHaberleri(konular: readonly GundemKonusu[], haberler: readonly Haber[]): Set<string> {
  return new Set(konular.length ? konular.slice(0, KONU_EN_COK).map((k) => k.ornek.id) : haberler.slice(0, KONU_EN_COK).map((h) => h.id));
}

/** "Bugünün özeti"nin satırları: ızgarada kartı olanın satırı yok. `bos`: gösterilecek satır kalmadı (özet çizilmez). Gündem bandı konuları ve
 *  bugünü zaten gösterir. */
export function ozetSatirlari(izgara: ReadonlySet<string>): { gundem: boolean; hava: boolean; konu: boolean; dolar: boolean; bos: boolean } {
  const gundem = !izgara.has('gundem');
  const hava = !izgara.has('hava');
  const konu = !izgara.has('gundem') && !izgara.has('haberler');
  const dolar = !izgara.has('piyasa');
  return { gundem, hava, konu, dolar, bos: !(gundem || hava || konu || dolar) };
}
