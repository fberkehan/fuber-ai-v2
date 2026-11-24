// ── Sohbete gelen mesajın kaynağı → tur türü (Görev 21 düzeltme 3; saf, birim testli: tests/sohbet-girdisi.test.ts) ──────────────────
// İki farklı "sesle" var:
//  - 'ses': ada (Hey Fuber, kısayol) ya da telefonda sesle SORULDU — sesli tur: yanıt kısa ve konuşma diliyle, düşük düşünme gücü, küçük
//    araç listesi (ilk söz erken gelsin; ajan/dongu.ts).
//  - 'dikte': sohbet penceresinde mikrofonla YAZDIRILDI — kullanıcı sohbetin içinde, uzun ve araçlı bir iş isteyebilir. Yanıt Fuber'in
//    sesiyle okunur (arayüz konuşmayı kendisi açar) ama tur KISITLANMAZ: tam araçlar, normal düşünme gücü, "1-3 cümle" talimatı yok.
//    Kayıtta kaynak yine 'ses' (mesajın üstünde 🎙).
export type SohbetKaynagi = 'kullanici' | 'ses' | 'proaktif' | 'mobil';

export function sohbetGirdisi(kaynak: unknown): { kaynak: SohbetKaynagi; sesli: boolean } {
  if (kaynak === 'ses') return { kaynak: 'ses', sesli: true };
  if (kaynak === 'dikte') return { kaynak: 'ses', sesli: false };
  if (kaynak === 'mobil') return { kaynak: 'mobil', sesli: false };
  return { kaynak: 'kullanici', sesli: false };
}
