// ── Hafıza türlerinin görünen adları (tek kaynak) ──────────────────────────────────────────────────────────────
// Hafıza sayfasının süzgeç sekmeleri çoğul ("Kişiler"), kayıt üstündeki hap tekil ("Kişi") yazar. Kokpitteki "Son öğrendiklerim"
// kartı eskiden ham kimliği ("kullanici", "kisi") gösteriyordu (Görev 19 denetimi); iki yer de buradan okur.
import type { HafizaTuru } from './tipler.ts';

export const HAFIZA_TURLERI: readonly { tur: HafizaTuru; cogul: string; tekil: string }[] = [
  { tur: 'kullanici', cogul: 'Sen', tekil: 'Sen' },
  { tur: 'proje', cogul: 'Projeler', tekil: 'Proje' },
  { tur: 'kisi', cogul: 'Kişiler', tekil: 'Kişi' },
  { tur: 'tercih', cogul: 'Tercihler', tekil: 'Tercih' },
  { tur: 'olay', cogul: 'Olaylar', tekil: 'Olay' },
  { tur: 'bilgi', cogul: 'Bilgiler', tekil: 'Bilgi' },
  { tur: 'kural', cogul: 'Kurallar', tekil: 'Kural' },
  { tur: 'gorev', cogul: 'Görevler', tekil: 'Görev' },
];

/** Kayıt hapı için tekil ad; bilinmeyen tür (eski kayıt) "Bilgi" olur — ham kimlik ekrana çıkmaz. */
export function hafizaTurAdi(tur: string): string {
  return HAFIZA_TURLERI.find((t) => t.tur === tur)?.tekil ?? 'Bilgi';
}

/** "Bir şey öğret" / düzenle formu kaydedilebilir mi: başlık ve bilgi boş (ya da yalnız boşluk) olamaz. */
export function hafizaFormuGecerli(d: { baslik?: string; icerik?: string } | null | undefined): boolean {
  return Boolean(d?.baslik?.trim() && d.icerik?.trim());
}
