// Düşünme motoru ajanlarının model çağrısı: Ayarlar → Düşünme motoru → "Ajan modeli" (boşsa yardımcı model; ucuz).
// OpenRouter ":free" modelleri de seçilebilir. Hepsi araçsız, kısa, JSON çıktılı ve arka plan önceliğinde.
import { ayarlar } from '../ayarlar.js';
import { cagirSecimle, secim, jsonAyikla } from '../motor/secici.js';
import { hitapMetni } from '../../shared/hitap.js';
import type { ModelSecimi } from '../../shared/tipler.js';
import { tekMotorYolu } from '../motor/yerel.js';
import type { SabitYol } from '../../shared/tek-motor.js';

/**
 * Gün kaydı işinin yolu (Görev 21 düzeltme turu 2), işin BAŞINDA bir kez: yerel beyin tek motorsa (Gizli mod) iş yerelde ve Gizli
 * kayıtları da okur; bulutsa Gizli kayıtlar HİÇ okunmaz (`gizliHaric`). Yol yoksa null. Yazılan sonuç (rapor, eşlik, mesele) okunan
 * kayıtlardan biri Gizli ise Gizli bölüme girer (çağıran belirler).
 */
export function isYolu(): { sabit: SabitYol; gizliHaric: boolean } | null {
  const y = tekMotorYolu();
  if (y === 'yok') return null;
  return y === 'yerel' ? { sabit: 'yerel', gizliHaric: false } : { sabit: 'bulut', gizliHaric: true };
}

export function ajanSecimi(): ModelSecimi {
  const m = ayarlar().gunKaydi.ajanModeli;
  return m?.model ? m : secim('yardimci');
}

export const kullaniciHitabi = () => hitapMetni(ayarlar().kullaniciAdi, ayarlar().hitap) || 'kullanıcı';

/** `sabit` (Görev 21 düzeltme turu 2): işin başında seçilen yol — Gizli kayıtları okuyan iş 'yerel', onları dışarıda bırakan iş 'bulut'
 *  (arada Gizli mod açılırsa bulut çağrısı yapılmaz; motor/secici.ts). */
export async function ajanJson<T>(sistem: string, kullanici: string, amac: string, maxToken = 2500, sabit?: SabitYol): Promise<{ veri: T | null; model: string }> {
  // 0.12 cila: ajanın modeli YALNIZ bulut yolunda okunur (işlev olarak verilir) — yerel yolda (Gizli / "Yalnız bu bilgisayar", bulut motoru
  // yokken de) secim('yardimci') "motor yok" diye atıp işi düşürüyordu.
  const y = await cagirSecimle(ajanSecimi, {
    jsonCikti: true,
    sistemSabit: `${sistem}\n\nYanıtın YALNIZ geçerli JSON olsun; açıklama, kod çiti ya da başka metin ekleme.`,
    mesajlar: [{ rol: 'user', bloklar: [{ tur: 'metin', metin: kullanici }] }],
    araclar: [], maxToken, arkaPlan: true, efor: 'low',
  }, amac, sabit);
  const metin = y.bloklar.filter((b) => b.tur === 'metin').map((b) => (b as { metin: string }).metin).join('').trim();
  const veri = jsonAyikla<T>(metin);
  // Sessiz "null" kararı ajanı susturur ve iz bırakmaz (eşlikçi 300 belirteçte böyle düşüyordu): günlüğe yaz.
  if (veri === null) console.warn(`[gunkaydi] ${amac}: JSON çözümlenemedi (${y.model}, ${metin.length} karakter, sınır ${maxToken})`);
  return { veri, model: y.model };
}

/** "2026-10-19" → "19 Ekim Pazartesi" */
export function gunAdi(g: string): string {
  const [y, a, d] = g.split('-').map(Number);
  return new Date(y, a - 1, d).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' });
}
