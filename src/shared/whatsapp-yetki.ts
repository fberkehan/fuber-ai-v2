// ── WhatsApp yetkisi (saf — tests/whatsapp-yetki.test.ts) ─────────────────────────────────────────────────────────────
// WhatsApp bağlantısı bu depoda yoktur: bağlantı ayrı, isteğe bağlı bir modüldür (ozel/whatsapp/); modül yokken kapı kapalı kalır. Burada yalnız
// KARAR var — ana süreç uygular (main/entegrasyon/whatsapp-kapisi.ts), arayüz yalnız sonucu gösterir:
//   · modül yok (bu depo)                    → yok: satır görünmez, hata yok.
//   · Developer mode                         → yok (WhatsApp İş modunun özelliği).
//   · hesabın WhatsApp hakkı yok             → yok.
// Hak: hesap kaydında `paket` alanı varsa o karar verir (aktif ve özellik listesinde `whatsapp` ya da liste yok); alan yoksa hesabın var olan hâli
// karar verir — kayıt var ve `durum === 'aktif'`. Gizli mod ve "Yalnız bu bilgisayar" bu karara girmez: oradaki WhatsApp davranışı (araçlar yerel
// turda sunulmaz) değişmedi.
import type { HesapAyari } from './masaustu-hesap.ts';
import type { Mod } from './tipler.ts';

/** `paket` alanının özellik listesindeki WhatsApp adı. */
export const WHATSAPP_OZELLIGI = 'whatsapp';

/** Hesap kaydının `paket` alanı (isteğe bağlı). `ozellikler` yoksa paket bütün özellikleri kapsar. */
export interface PaketBilgisi { aktif: boolean; ozellikler?: string[] }

export type WhatsappEngeli = 'modul-yok' | 'mod' | 'paket';
export interface WhatsappYetkisi { izinli: boolean; neden?: WhatsappEngeli }

/** `paket` alanının okunuşu: yalnız `{ aktif: boolean, ozellikler?: string[] }`; başka her şey "alan yok" (undefined). */
export function paketOku(x: unknown): PaketBilgisi | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const y = x as Record<string, unknown>;
  if (typeof y.aktif !== 'boolean') return undefined;
  const p: PaketBilgisi = { aktif: y.aktif };
  if (Array.isArray(y.ozellikler)) p.ozellikler = y.ozellikler.filter((o): o is string => typeof o === 'string' && o.length > 0 && o.length <= 60).slice(0, 50);
  return p;
}

/** Hesabın WhatsApp hakkı var mı (WhatsApp'ı kapsayan etkin paket). Erişimi açık ('aktif') olmayan hesap hiçbir zaman. */
export function paketHakkiVar(hesap: Pick<HesapAyari, 'durum' | 'paket'> | null | undefined): boolean {
  if (!hesap || hesap.durum !== 'aktif') return false;
  if (!hesap.paket) return true; // alan yok: hesabın etkin olması yeter
  return hesap.paket.aktif && (!hesap.paket.ozellikler || hesap.paket.ozellikler.includes(WHATSAPP_OZELLIGI));
}

/** Tek karar: WhatsApp gösterilir ve kullanılabilir mi; değilse neden. */
export function whatsappYetkisi(g: { modulVar: boolean; mod: Mod; hesap: Pick<HesapAyari, 'durum' | 'paket'> | null | undefined }): WhatsappYetkisi {
  if (!g.modulVar) return { izinli: false, neden: 'modul-yok' };
  if (g.mod !== 'is') return { izinli: false, neden: 'mod' };
  if (!paketHakkiVar(g.hesap)) return { izinli: false, neden: 'paket' };
  return { izinli: true };
}
