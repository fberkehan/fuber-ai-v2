// ── Telefona giden mesaj ve olayların hafifletilmesi (saf; tests/kart.test.ts, 0.11 G6 düzeltme turu 1) ──────────────────────────────────────
// Telefona (Fuber köprüsü) giden mesaj/olaylardan ağır alanlar atılır: araç ekran görüntüleri (base64, MB'larca) ve çok büyük görseller (kısa not).
// Yapay zekânın kartı (kart_goster) telefona DÜZ METİN olarak gider (kartDuzMetin): eski telefon sürümü kart bloğunu/olayını tanımaz; canlı kart
// olayı 'metin' olayına iner. main/kopru.ts bunları çağırır; ana süreç ve Electron gerekmez.
import type { GorunenBlok, GorunenMesaj, SohbetOlayi } from './tipler.ts';
import { kartDuzMetin, kartiDuzMetneIndir } from './kart.ts';
import { tavanKisaMetni } from './sohbet-gorunum.ts';

const GORSEL_SINIRI = 350_000;

export function blokHafiflet(b: GorunenBlok): GorunenBlok {
  if (b.tur === 'arac') { const { gorsel: _g, ...kalan } = b; return kalan as GorunenBlok; }
  if (b.tur === 'kart') return kartiDuzMetneIndir(b) as GorunenBlok;
  if (b.tur === 'gorsel' && b.veri.length > GORSEL_SINIRI) return { tur: 'metin', metin: '🖼 Görsel bilgisayarda' };
  return b;
}

export function hafiflet(m: GorunenMesaj): GorunenMesaj { return { ...m, bloklar: m.bloklar.map(blokHafiflet) }; }

export function olayHafiflet(o: SohbetOlayi): SohbetOlayi {
  if (o.tur === 'arac') return { ...o, blok: blokHafiflet(o.blok) as typeof o.blok };
  // Canlı kart olayı telefonda düz metin parçası olur (arayüzdeki balon 'metin' olaylarıyla büyür).
  if (o.tur === 'kart') return { tur: 'metin', sohbetId: o.sohbetId, parca: `\n\n${kartDuzMetin(o.kart)}\n\n` };
  // 0.14 T13 (R24): adım tavanı — telefon uygulaması 'tavan' olayını tanımaz ve "Devam et" düğmesi yok: düz metin parçası olur (sürdürmenin yolunu söyler;
  // kayıttaki tam not 'bitti'den sonra mesajlarla gelir).
  if (o.tur === 'tavan') return { tur: 'metin', sohbetId: o.sohbetId, parca: `\n\n${tavanKisaMetni(o.adim)}` };
  if (o.tur === 'bitti' || o.tur === 'yeni_mesaj') return { ...o, mesaj: hafiflet(o.mesaj) };
  if (o.tur === 'basladi') return { ...o, kullaniciMesaji: hafiflet(o.kullaniciMesaji) };
  return o;
}

/** Görünen blokların düz metni (metin blokları + kartların düz metni): proaktif bildirim, telefon bildirimi. Kart kendi satırlarında. */
export function gorunenBloklarMetni(bloklar: readonly GorunenBlok[], ayirici = ' '): string {
  return bloklar.map((b) => (b.tur === 'metin' ? b.metin : b.tur === 'kart' ? `\n${kartDuzMetin(b.kart)}\n` : '')).filter(Boolean).join(ayirici).trim();
}

/** Telefon bildirimi metni: biçim işaretleri ve fazla boşluk atılır. */
export const mesajMetni = (m: GorunenMesaj): string => gorunenBloklarMetni(m.bloklar).replace(/[*_#`>]/g, '').replace(/\s+/g, ' ').trim();
