// ── Öğretme (İçe Aktar) klasörü: hangi dosya öğretilir, hangisi neden reddedilir (saf) ─────────────────────────────
// Görev 19 denetimi: klasöre bırakılan desteklenmeyen dosya (ör. .png), boş ya da 60 MB üstü dosya SESSİZCE yok sayılıyordu;
// kullanıcı "öğrendi mi?" diye bekliyordu. Yeni bırakılan (ya da "Dosya seç"le seçilen) dosya reddedilirse neden söylenir;
// kopyalama sürerken oluşan geçici dosyalar ve sistem dosyaları sessiz geçilir. Açılıştaki klasör taraması bildirim göstermez.

export const ICE_AKTAR_UZANTILARI: readonly string[] = ['.txt', '.md', '.markdown', '.csv', '.log', '.json', '.jsonl', '.html', '.htm', '.xml', '.eml', '.pdf', '.docx', '.yaml', '.yml', '.ts', '.js', '.py'];
export const ICE_AKTAR_AZAMI_BOYUT = 60 * 1024 * 1024;

const uzanti = (ad: string) => { const i = ad.lastIndexOf('.'); return i > 0 ? ad.slice(i).toLowerCase() : ''; };

/** Kopyalama/indirme sürerken oluşan ya da sisteme ait dosya: hiç dokunulmaz, bildirilmez. */
export function geciciDosyaMi(ad: string): boolean {
  return /^(~\$|\.)/.test(ad) || /\.(tmp|temp|crdownload|part|partial|download|lnk)$/i.test(ad) || /^(desktop\.ini|thumbs\.db|BENİ OKU\.txt)$/i.test(ad);
}

export type IceAktarimKarari = { tur: 'al' } | { tur: 'sessiz' } | { tur: 'red'; neden: string };

/** `ad`: dosya adı (yolsuz), `boyut`: bayt. */
export function iceAktarimKarari(ad: string, boyut: number): IceAktarimKarari {
  if (geciciDosyaMi(ad)) return { tur: 'sessiz' };
  const u = uzanti(ad);
  if (!ICE_AKTAR_UZANTILARI.includes(u)) {
    return { tur: 'red', neden: `${u ? `bu dosya türü (${u})` : 'uzantısız dosya'} öğretilemiyor. Desteklenenler: metin, Markdown, PDF, Word (.docx), e-posta (.eml), CSV, HTML, JSON ve sohbet dışa aktarımları.` };
  }
  if (boyut <= 0) return { tur: 'red', neden: 'dosya boş.' };
  if (boyut > ICE_AKTAR_AZAMI_BOYUT) return { tur: 'red', neden: 'dosya çok büyük (60 MB üstü).' };
  return { tur: 'al' };
}
