// ── Kullanıcının okuduğu metinde iç kimlik bekçisi (11 Kas tasarımcı analizi, bulgu 7; saf — tests/ic-kimlik-sizintisi.test.ts) ─────────────
// Sohbet dışındaki ekranlarda iç kimlikler ("H-8", "sohbet:1", "gorev:12"), tam dosya yolları ve parantez içi sınır sayıları ("(100)")
// görünmez. `klasorAdi` tam yol yerine klasörün adını verir ("Klasörü aç" düğmesi yolu zaten açar).

/** İç kimlik, ham kaynak etiketi, tam yol ya da parantez içi sınır sayısı. */
export const IC_KIMLIK_KALIBI = /\b[HMDNGR]-\d+\b|\b(?:sohbet|gorev|dosya|belge|gunkaydi|yapilacaklar):\S+|\b[A-Za-z]:\\|(?:^|\s)\/(?:home|Users|tmp|var)\/|\(\d{2,}\)|aralığı \d+ sn/;

export const icKimlikVarMi = (metin: string): boolean => IC_KIMLIK_KALIBI.test(metin);

/** Tam yolun son parçası (Windows ve POSIX ayırıcıları; sondaki ayırıcı yok sayılır). Boşsa boş. */
export function klasorAdi(yol: string | null | undefined): string {
  const parcalar = String(yol ?? '').split(/[\\/]+/).filter(Boolean);
  return parcalar[parcalar.length - 1] ?? '';
}

// ── Sohbet metnindeki atıflar (iş izi işi, 11 Kas; bulgu 7'nin sohbet yarısı) ─────────────────────────────────────────────────────────────
// Model yanıtına "[H-12 · 2026-10-18]" gibi atıf yazar. Eskiden balonda "H-12" hapı görünüyordu (iç kimlik). Artık küçük bir üst simge noktası:
// kimlik HİÇBİR yerde yazmaz; üstüne gelince ve ekran okuyucuda yalnız kaynağın türü ve (varsa) tarihi: "Hafızadan · 2026-10-18".
const ATIF_ADI: Record<string, string> = { H: 'Hafızadan', M: 'Önceki konuşmadan', D: 'Belgeden', N: 'Gün kaydından', G: 'Yazıya dökülen konuşmadan', R: 'Rapordan' };
/** Temizlenmiş HTML'deki atıfları nokta işaretine çevirir (renderer/bilesenler/Ortak.tsx Markdown). Ek bilgi tarih değilse (iç not) yazılmaz. */
export function atiflariNoktala(html: string): string {
  return html.replace(/\[(H|M|D|N|G|R)-\d+(?:\s*·\s*([^\]<]{1,48}))?\]/g, (_m, h: string, t?: string) => {
    const ek = t && /^\d{4}-\d{2}-\d{2}/.test(t.trim()) ? ` · ${t.trim().replace(/["<>&]/g, '')}` : '';
    const ad = `${ATIF_ADI[h]}${ek}`;
    return `<sup class="atif" role="note" tabindex="0" aria-label="${ad}" title="${ad}"></sup>`;
  });
}
