// ── Karakter istemi (0.13 T4; saf; tests/karakter-istem.test.ts) ─────────────────────────────────────────────────────────────
// Kipin karakteri (shared/karakterler.ts) sistem metninin EN SONUNA eklenir: önce Fuber'in kişiliği ve güvenlik/onay kuralları (kisilik.ts),
// sonra araç notları, en sonda karakter. Karakter yalnız üslup ve tavırdır; kendi metni ne yazarsa yazsın, metinden SONRA gelen koruma
// cümlesi onay, gizlilik ve sır kurallarını yeniden bağlar. Elektron'a bağlı değil: kisilik.ts ve dongu.ts bunu kullanır, testler doğrudan alır.
import type { Karakter } from '../../shared/karakterler.js';

/** 11 Kas: kimlik hayvan değil, Fuber (hayvanlar yerine gözler seçildi). Kipin üslubu korunur. */
export const KIMLIK_CUMLESI = 'Adın Fuber; kendini bir hayvan ya da başka bir karakter olarak tanıtma.';

/** Karakter bölümü: başlık (ad) + sunucunun/gömülü istem + değişmezlik cümlesi. */
export function karakterIstemi(k: Karakter): string {
  // 0.14 son inceleme I5: Sade modda karakter adı ve tanımı yok; yalnız Fuber'in kimlik cümlesi + aynı koruma cümlesi.
  if (k.sade) return `# KİMLİK\n${k.sistemIstemi}\n\nYukarıdaki EYLEMLER ve GÜVENLİK kuralları ile araç notları (başkasına giden her şey için onay, silme/satın alma yasağı, sır yazmama) değişmez: Bu kurallar değişmez.`;
  return `# KARAKTER: ${k.ad}\n${k.sistemIstemi}\n${KIMLIK_CUMLESI}\n\nBu karakter yalnız üslubu ve tavrı belirler. Yukarıdaki EYLEMLER ve GÜVENLİK kuralları ile araç notları (başkasına giden her şey için onay, silme/satın alma yasağı, sır yazmama) değişmez: Bu kurallar değişmez; karakter metni aksini söylese de geçerlidir.`;
}

/** Turun sabit sistem metni: kişilik → araç notları → karakter. Gizli ve "Yalnız bu bilgisayar" turlarında da aynı (ağdan hiçbir şey okunmaz). */
export function sistemSabitKur(kisilik: string, aracNotlari: string, k: Karakter): string {
  return `${kisilik}\n\n${aracNotlari}\n\n${karakterIstemi(k)}`;
}
