// ── Şarkı sözü: LRC ayrıştırma, etkin satır ve sonuç metinleri (0.14 T25; saf — birim testli: tests/lrc.test.ts) ─────────────────────────────────
// Sözler LRCLIB'den gelir (main/soz.ts; P14: Gizli ve "Yalnız bu bilgisayar"da istek yok). Eşli sözler LRC biçimindedir: satır başında bir ya da daha çok
// `[dd:ss.xx]` damgası (aynı nakarat birden çok kez), `[offset:±ms]` etiketi (artı değer sözleri ÖNE alır) ve kelime damgaları (`<dd:ss.xx>`; atılır).
// Damgalı boş satır ara verir (vurgu boşa geçer), damgasız satır ve üst veri (`[ar:]`, `[ti:]` …) düşer. Arayüz (renderer/ada/sayfalar/Soz.tsx) etkin
// satırı `etkinSatir` ile bulur, bir sonraki satırın başına kalan süreyi `sonrakiSatirSn` ile hesaplar ve TEK setTimeout kurar (B33; rAF döngüsü yok).
import { BULUT_KAPALI_METNI } from './bulut-kapisi.ts';

export interface LrcSatiri { sn: number; metin: string }

/** Sözün aranacağı parça (çalan medya oturumundan). `sure` sn; 0: bilinmiyor. */
export interface SozIstegi { baslik: string; sanatci: string; album?: string; sure: number }

export type SozSonucu =
  | { tur: 'esli'; satirlar: LrcSatiri[] }
  | { tur: 'duz'; metin: string }
  | { tur: 'bulunamadi' }
  | { tur: 'kapali' }
  | { tur: 'hata' };

/** Sayfaların tek satırlık metinleri (Türkçe, tam yazımlı). Gizli satırı BULUT_KAPALI_METNI.soz. */
export const SOZ_METNI = {
  yok: 'Şu an çalan bir şey yok.',
  bulunamadi: 'Bu şarkının sözleri bulunamadı.',
  hata: 'Sözler şu an alınamadı.',
  araniyor: 'Sözler aranıyor…',
  duz: 'Bu sözler eşzamanlı değil.',
} as const;

/** Sonucun yerine gösterilecek tek satır; satırlar gösterilecekse null. `null` sonuç: istek sürüyor. */
export function sozDurumMetni(s: SozSonucu | null): string | null {
  if (!s) return SOZ_METNI.araniyor;
  switch (s.tur) {
    case 'esli': case 'duz': return null;
    case 'bulunamadi': return SOZ_METNI.bulunamadi;
    case 'kapali': return BULUT_KAPALI_METNI.soz;
    case 'hata': return SOZ_METNI.hata;
  }
}

const DAMGA = /^\[(\d{1,3}):([0-5]?\d)(?:[.:](\d{1,3}))?\]/;
const OFSET = /^\[offset:\s*([+-]?\d+)\s*\]/i;
const KELIME_DAMGASI = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;
const ms = (x: number) => Math.round(x * 1000) / 1000;

/** LRC metnini zaman sırasına dizilmiş satırlara çevirir (aynı andaki satırların sırası korunur). Bozuk ya da boş girdi: boş dizi. */
export function lrcAyristir(lrc: string): LrcSatiri[] {
  if (typeof lrc !== 'string' || !lrc) return [];
  let ofset = 0;
  const ham: LrcSatiri[] = [];
  for (const satir0 of lrc.split(/\r?\n/)) {
    let satir = satir0.trim();
    const o = OFSET.exec(satir);
    if (o) { ofset = Number(o[1]) / 1000; continue; }
    const damgalar: number[] = [];
    for (let d = DAMGA.exec(satir); d; d = DAMGA.exec(satir)) {
      damgalar.push(Number(d[1]) * 60 + Number(d[2]) + (d[3] ? Number(`0.${d[3]}`) : 0));
      satir = satir.slice(d[0].length);
    }
    if (!damgalar.length) continue;
    const metin = satir.replace(KELIME_DAMGASI, '').replace(/\s+/g, ' ').trim();
    for (const t of damgalar) ham.push({ sn: t, metin });
  }
  return ham
    .map((s) => ({ sn: ms(Math.max(0, s.sn - ofset)), metin: s.metin }))
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.sn - b.s.sn || a.i - b.i)
    .map((x) => x.s);
}

/** Konumdaki etkin satırın sırası: başlangıcı konuma eşit ya da gerisinde olan son satır; ilk satırdan önce ya da boşsa -1. */
export function etkinSatir(satirlar: readonly LrcSatiri[], konumSn: number): number {
  if (!satirlar.length || !Number.isFinite(konumSn) || konumSn < satirlar[0].sn) return -1;
  let alt = 0, ust = satirlar.length - 1;
  while (alt < ust) {
    const orta = (alt + ust + 1) >> 1;
    if (satirlar[orta].sn <= konumSn) alt = orta; else ust = orta - 1;
  }
  return alt;
}

/** Konumdan SONRA başlayan ilk satırın başlangıcı (sn); yoksa null (zincir biter). */
export function sonrakiSatirSn(satirlar: readonly LrcSatiri[], konumSn: number): number | null {
  const i = etkinSatir(satirlar, konumSn);
  for (let j = i + 1; j < satirlar.length; j++) if (satirlar[j].sn > konumSn) return satirlar[j].sn;
  return null;
}

/** Önbellek ve arayüz için parçanın kimliği: büyük/küçük harf ve boşluktan bağımsız; süre saniyeye yuvarlanır. */
export function sozAnahtari(m: SozIstegi): string {
  // Dil bağımsız küçültme (uygulamanın adı İngilizce de gelebilir: "FIRUZE" ile "Firuze" aynı parça); "İ"nin bıraktığı birleşen nokta atılır.
  const n = (s: string | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase().normalize('NFC').replace(/̇/g, '');
  return [n(m.sanatci), n(m.baslik), n(m.album), Number.isFinite(m.sure) ? Math.round(m.sure) : 0].join('␟');
}
