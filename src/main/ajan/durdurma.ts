// ── Durdurulan yanıtın kaydı (saf) ─────────────────────────────────────────────────────────────────────────────────────
// Görev 20b (K14): "Durdur"a basılınca akan yarım metin atılıyor, kayıtta iz kalmıyordu (soru cevapsız görünüyordu; sayfa
// yenilenince "Durduruldu." da kayboluyordu). Artık yarım metin Fuber mesajı olarak kalır (kaynak 'durduruldu': hafızaya
// işlenmez, tamamlanmış sayılmaz) ve ardından kalıcı "Durduruldu." notu yazılır. Sağlayıcıdan bağımsız: akan metin ajan
// döngüsünde toplanır (Claude, OpenAI/OpenRouter); akışsız yollarda (Fuber gateway, yerel beyin) yalnız not kalır.
import type { Blok } from '../motor/tipler.js';
import { icTalimatYankisiMi } from '../../shared/ic-talimat.ts';

export const DURDURULDU = 'Durduruldu.';

export interface DurdurmaKaydi { rol: 'assistant' | 'not'; bloklar: Blok[]; kaynak?: string; model?: string }

/** Kayda geçecekler, sırasıyla. Kendiliğinden (kullanıcının görmediği tetikle başlayan) turda görünür metin yoksa iz bırakılmaz. G1 (F2):
 *  o turun yarım metni iç talimatın (`talimat`) yankısıysa görünür metin sayılmaz — iç talimat hiçbir yüzeyde görünmez. */
export function durdurmaKayitlari(o: { yarimMetin: string; model?: string; gizliTetik?: boolean; talimat?: string }): DurdurmaKaydi[] {
  const yanki = Boolean(o.gizliTetik && o.talimat && icTalimatYankisiMi(o.yarimMetin, o.talimat));
  const metin = yanki ? '' : o.yarimMetin.trimEnd();
  const out: DurdurmaKaydi[] = [];
  if (metin.trim()) out.push({ rol: 'assistant', bloklar: [{ tur: 'metin', metin }], kaynak: 'durduruldu', ...(o.model ? { model: o.model } : {}) });
  if (out.length || !o.gizliTetik) out.push({ rol: 'not', bloklar: [{ tur: 'metin', metin: DURDURULDU }] });
  return out;
}
