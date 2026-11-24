// ── Biten işlerin katlanması (11 Kas; saf; tests/is-katla.test.ts) ─────────────────────────────────────────────────────────────────────
// Biten alt ajanlar sohbette çok büyük yer kaplıyordu. Claude Code dökümünde art arda biten yardımcılar (alt ajanlar) ve art arda biten
// araç kartları tek, kısa bir satıra katlanır: "✓ 3 yardımcı · 15 adım · 16 sn" ya da "✓ 6 adım · 12 sn". Satıra tıklayınca açılır. Yalnız süren iş tam
// kartıyla görünür: süren bir öğe diziyi böler ve kendisi katlanmaz. Tek başına biten yardımcı kendi şeridinde kalır (gövdesi kapalı; Kartlar.tsx).
// Görünüm katmanıdır: döküm modeli (dokum-modeli.ts) değişmez; katlanan grup, ilk öğesinin anahtarından türeyen kararlı bir anahtar taşır.
import type { AltAjanOgesi, AracOgesi, DokumOgesi } from './dokum-modeli.ts';
import { isSuresi } from '../../shared/is-izi.ts';

export type KatliCesit = 'ajan' | 'arac';
export interface KatliGrup { tur: 'katli'; anahtar: string; cesit: KatliCesit; ogeler: (AltAjanOgesi | AracOgesi)[] }
export type GorunenOge = DokumOgesi | KatliGrup;

/** Katlamanın en az öğe sayısı (tek öğe kendi satırında kalır). */
export const KATLA_EN_AZ = 2;

const bittiMi = (o: AltAjanOgesi | AracOgesi): boolean => o.durum !== 'calisiyor';
const cesidi = (o: DokumOgesi): KatliCesit | null => (o.tur === 'alt-ajan' ? 'ajan' : o.tur === 'arac' ? 'arac' : null);

/**
 * Üst düzey öğeler → görünen öğeler. Aynı çeşitten art arda biten öğeler (en az KATLA_EN_AZ) tek gruba katlanır. `bekleyen`: izin bekleyen araç kimliği
 * (bekleyen kart katlanmaz; içinde bekleyen torunu olan yardımcı da).
 */
export function dokumKatla(ogeler: readonly DokumOgesi[], bekleyen: (o: DokumOgesi) => boolean = () => false): GorunenOge[] {
  const out: GorunenOge[] = [];
  let dizi: (AltAjanOgesi | AracOgesi)[] = [];
  let cesit: KatliCesit | null = null;
  const bosalt = () => {
    if (dizi.length >= KATLA_EN_AZ && cesit) out.push({ tur: 'katli', anahtar: `katli:${dizi[0].anahtar}`, cesit, ogeler: dizi });
    else out.push(...dizi);
    dizi = [];
    cesit = null;
  };
  for (const o of ogeler) {
    const c = cesidi(o);
    if (c && bittiMi(o as AltAjanOgesi | AracOgesi) && !bekleyen(o)) {
      if (cesit !== c) bosalt();
      cesit = c;
      dizi.push(o as AltAjanOgesi | AracOgesi);
      continue;
    }
    bosalt();
    out.push(o);
  }
  bosalt();
  return out;
}

/** Yardımcının adım sayısı (içindeki araç ve alt yardımcı kartları). */
const adimSayisi = (o: AltAjanOgesi | AracOgesi): number => (o.tur === 'alt-ajan' ? o.cocuklar.filter((c) => c.tur === 'arac' || c.tur === 'alt-ajan').length : 1);

/** Katlı satırın özeti: "3 yardımcı · 15 adım · 16 sn" ya da "6 adım · 12 sn"; olmayan varsa "· 1 olmadı". `tamam`: hepsi başarılı (✓). */
export function katliOzet(g: KatliGrup): { metin: string; tamam: boolean } {
  const bas = Math.min(...g.ogeler.map((o) => o.zaman));
  const son = Math.max(...g.ogeler.map((o) => o.bitis ?? o.zaman));
  const adim = g.ogeler.reduce((n, o) => n + adimSayisi(o), 0);
  const olmadi = g.ogeler.filter((o) => o.durum === 'hata' || o.durum === 'kesildi').length;
  const parcalar = g.cesit === 'ajan'
    ? [`${g.ogeler.length} yardımcı`, adim ? `${adim} adım` : '', isSuresi(son - bas)]
    : [`${adim} adım`, isSuresi(son - bas)];
  if (olmadi) parcalar.push(`${olmadi} olmadı`);
  return { metin: parcalar.filter(Boolean).join(' · '), tamam: olmadi === 0 };
}

/** Hedef anahtar (izin "Göster") katlı bir grubun içindeyse grubun sırası. */
export function gorunenSira(liste: readonly GorunenOge[], anahtar: string): number {
  return liste.findIndex((o) => o.anahtar === anahtar || (o.tur === 'katli' && o.ogeler.some((x) => x.anahtar === anahtar)));
}
