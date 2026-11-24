// ── Sohbetteki hata satırı iki kez görünmesin (saf) ─────────────────────────────────────────────────────────────────
// Motor hatasında ana süreç hatayı hem 'hata' olayıyla yollar hem de sohbete kalıcı bir not ("⚠ …") olarak yazar; arayüz
// mesajları yeniden okuyunca aynı satır bir gri not, bir de kırmızı uyarı olarak alt alta çıkıyordu (Görev 19 denetimi).
// Kalıcı not son mesajsa geçici uyarı gösterilmez. Durdurulan yanıtın ardından da kalıcı "Durduruldu." notu yazılır (Görev 20b,
// K14; ⚠ işaretsiz): o da kopyalanmaz. Meşgul uyarısı kayda yazılmadığı için görünür kalır.
import type { GorunenMesaj } from './tipler.ts';

export function geciciHataGosterilsinMi(hata: string, mesajlar: readonly GorunenMesaj[]): boolean {
  if (!hata) return false;
  const son = mesajlar[mesajlar.length - 1];
  if (son?.rol !== 'not') return true;
  const metin = son.bloklar.map((b) => (b.tur === 'metin' ? b.metin : '')).join(' ').trim();
  return metin !== `⚠ ${hata}`.trim() && metin !== hata.trim();
}
