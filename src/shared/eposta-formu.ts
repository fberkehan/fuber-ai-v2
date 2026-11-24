// ── E-posta hesap formu: doğrulama ve sınama sonucunun metni (saf) ─────────────────────────────────────────────────
// Görev 19 denetimi: biçimsiz adres ("deniz") ve özel sunucuda boş IMAP/SMTP adıyla "Bağla ve sına" açıktı (sunucuya boşuna
// bağlanmaya çalışıyordu); Bağlantılar'daki "Sına" sonucu ham JSON'la tarayıcı uyarısında (alert) çıkıyordu.

/** Basit biçim denetimi: boşluksuz yerel kısım, "@", en az bir nokta içeren alan adı. */
export const EPOSTA_BICIMI = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export interface EpostaFormGirdisi { adres: string; parola: string; imapSunucu?: string; smtpSunucu?: string }

/** Formdaki ilk eksik/yanlış (gönderilmeden önce); tamamsa null. `ozel`: sunucu adları elle yazılır. */
export function epostaFormuEksigi(f: EpostaFormGirdisi, ozel: boolean): string | null {
  const adres = f.adres.trim();
  if (!adres) return 'E-posta adresini yaz.';
  if (!EPOSTA_BICIMI.test(adres)) return 'Geçerli bir e-posta adresi yaz (ör. ad@alan.com).';
  if (!f.parola) return 'Parolayı yaz.';
  if (ozel && (!f.imapSunucu?.trim() || !f.smtpSunucu?.trim())) return 'Özel sunucuda IMAP ve SMTP sunucu adları gerekli.';
  return null;
}

const KIRPILAN = ['ad', 'adres', 'kullanici', 'imapSunucu', 'smtpSunucu'] as const;

/** Kaydedilecek/sınanacak hesap: ad, adres, kullanıcı ve sunucu adları kırpılır (Görev 20b: " imap.ornek.com " doğrulamadan geçip
 *  boşluğuyla kaydediliyordu). Parola ve portlar olduğu gibi; olmayan alan eklenmez; girdi değişmez. */
export function epostaGirdisiniKirp<T extends Partial<Record<(typeof KIRPILAN)[number], string>>>(h: T): T {
  const k = { ...h };
  for (const a of KIRPILAN) if (typeof k[a] === 'string') (k as Record<string, unknown>)[a] = (k[a] as string).trim();
  return k;
}

/** Hesabın bağlantı alanları (sunucular, portlar, kullanıcı adı, güvenli bağlantı). */
export interface EpostaBaglantisi { adres?: string; kullanici?: string; imapSunucu?: string; imapPort?: number; smtpSunucu?: string; smtpPort?: number; guvenli?: boolean }

/**
 * C1 kardeşi (son inceleme, düzeltme turu 2): kayıtlı parola YALNIZ kaydedildiği bağlantıyla kullanılır. Sunucu, port, kullanıcı adı ya da
 * güvenli bağlantı değiştiyse aynı bağlantı değildir: parola yeniden yazılmalı (eposta.ts hesapDene/hesapKaydet ve ayarlar:kaydet).
 * Karşılaştırma büyük/küçük harf ve baş/son boşluk duyarsız; kullanıcı adı boşsa adres (bağlanırken kullanılan ad).
 */
export function epostaBaglantisiAyni(a: EpostaBaglantisi, b: EpostaBaglantisi): boolean {
  const ad = (x: EpostaBaglantisi) => String(x.kullanici || x.adres || '').trim().toLowerCase();
  const sunucu = (s: unknown) => String(s ?? '').trim().toLowerCase();
  return sunucu(a.imapSunucu) === sunucu(b.imapSunucu) && Number(a.imapPort) === Number(b.imapPort)
    && sunucu(a.smtpSunucu) === sunucu(b.smtpSunucu) && Number(a.smtpPort) === Number(b.smtpPort)
    && ad(a) === ad(b) && Boolean(a.guvenli) === Boolean(b.guvenli);
}

/** Sınama sonucu tek satır: "✓ okuma · ✕ gönderim — neden". */
export function sinamaMetni(r: { imap?: boolean; smtp?: boolean; hata?: string } | null | undefined): { tamam: boolean; metin: string } {
  const imap = Boolean(r?.imap), smtp = Boolean(r?.smtp);
  const neden = r?.hata && r.hata !== 'yok' ? ` — ${r.hata}` : r?.hata === 'yok' ? ' — hesap bulunamadı' : '';
  return { tamam: imap && smtp, metin: `${imap ? '✓' : '✕'} okuma · ${smtp ? '✓' : '✕'} gönderim${neden}` };
}
