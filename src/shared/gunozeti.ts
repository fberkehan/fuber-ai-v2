// ── Kokpit üst bandının yedek odak cümlesi ───────────────────────────────────────────────────────────────────────
// Planlayıcı "odak" yazmadıysa (ilk açılış, motor yok) bant tek satırlık selamlamayla kalmasın: veriden çıkan GERÇEK
// sayılar ("Bekleyenler: 2 hatırlatıcı ve 3 açık görev."). Hiçbir şey beklemiyorsa sakin bir yönlendirme. Saf işlev.
import { listeBirlestir } from './beyin.ts';
import { acikYapilacakSayisi } from './yapilacaklar.ts';

export interface GunOzetiVerisi {
  hatirlaticilar: { durum: string }[];
  gorevler: unknown[];
  /** 0.11 G5 düzeltme turu 1 (K3): kokpitin yapılacakları (açıkların tamamı + bugün işaretlenenler); varsa açık sayısı buradan —
   *  `gorevler` gündem ve planlayıcı için kısaltılmış listedir (12), sayısı kartın "Tümü · N"siyle çelişiyordu. */
  yapilacaklar?: { durum: string }[];
  epostalar: { okundu: boolean }[];
  whatsapp: { okunmamis: number }[];
  dusunme?: { meseleler: { durum: string }[] };
}

const SAKIN = 'Bekleyen bir şey yok; Fuber’e sorarak ya da hatırlatıcı kurarak başlayabilirsin.';

export function gunOzeti(v: GunOzetiVerisi): string {
  const kalemler: [number, string][] = [
    [v.hatirlaticilar.filter((h) => h.durum === 'bekliyor').length, 'hatırlatıcı'],
    [acikYapilacakSayisi(v), 'açık görev'],
    [v.epostalar.filter((e) => !e.okundu).length, 'okunmamış e-posta'],
    [v.whatsapp.reduce((n, w) => n + w.okunmamis, 0), 'okunmamış WhatsApp mesajı'],
    [(v.dusunme?.meseleler ?? []).filter((m) => m.durum === 'acik').length, 'takip edilecek iş'],
  ];
  const var_ = kalemler.filter(([n]) => n > 0).map(([n, ad]) => `${n} ${ad}`);
  return var_.length ? `Bekleyenler: ${listeBirlestir(var_)}.` : SAKIN;
}
