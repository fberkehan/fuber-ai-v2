// ── Sohbet geçmişi onarımı (saf; birim testli: tests/gecmis.test.ts) ─────────────────────────────────────────
import type { Blok, Mesaj } from '../motor/tipler.js';

/** Sohbet özetinin kesim noktası (11 Kas analizi #10; ajan/dongu.ts ozetGuncelle): kaydın %60'ı; kesimden SONRAKİ ilk ileti araç sonucuysa (çağrısı
 *  özetlenecek bölümde kalırdı) ya da kesimin kendisi araç çağrısıysa kesim, çift bütün kalana dek ileri kayar — araç çağrısı ile sonucu hiçbir zaman
 *  ayrı bölümlere düşmez. Kesilecek yer yoksa (çok kısa kayıt ya da sona dek araç zinciri) null. */
export function ozetKesimi<T extends { id: number; rol: string; bloklar: { tur: string }[] }>(liste: T[]): T | null {
  if (liste.length < 4) return null;
  let i = Math.floor(liste.length * 0.6);
  const aracSonucu = (m: T | undefined) => Boolean(m && m.rol === 'user' && m.bloklar.length && m.bloklar.every((b) => b.tur === 'arac_sonuc'));
  const aracCagrisi = (m: T | undefined) => Boolean(m && m.bloklar.some((b) => b.tur === 'arac_cagri'));
  while (i < liste.length - 1 && (aracSonucu(liste[i + 1]) || aracCagrisi(liste[i]))) i++;
  return i < liste.length - 1 ? liste[i] : null;
}

const AYLAR = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const GUNLER = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];

/**
 * Önceki günlerde yazılmış bir kullanıcı mesajının yerel gün etiketi ("dün 18:40", "16 Eki Cum 09:10"); bugünse null.
 * Model geçmişte zaman görmezse dün yazılan "yarın"ı bugüne göre okur ve doğru kurulmuş hatırlatıcıyı "yanlış" sanır.
 */
export function gunEtiketi(zaman: string, simdi: Date = new Date()): string | null {
  const t = new Date(zaman);
  if (Number.isNaN(t.getTime())) return null;
  const gun = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const fark = Math.round((gun(simdi) - gun(t)) / 864e5);
  if (fark <= 0) return null;
  const saat = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  if (fark === 1) return `dün ${saat}`;
  return `${t.getDate()} ${AYLAR[t.getMonth()]} ${GUNLER[t.getDay()]}${t.getFullYear() !== simdi.getFullYear() ? ` ${t.getFullYear()}` : ''} ${saat}`;
}

/**
 * Araç çağrısı ↔ sonucu eşleşmesini garanti eder. Uygulama bir araç döngüsünün ortasında kapanırsa (ya da kayıt
 * yarım kalırsa) sonucu olmayan bir çağrı kalır ve sağlayıcı o sohbetteki HER isteği 400 ile reddeder — sohbet
 * kalıcı olarak kilitlenir. Eşleşmeyen çağrı/sonuçlar düz metin notuna çevrilir; bağlam kaybolmaz.
 */
export function araclariOnar(liste: Mesaj[]): Mesaj[] {
  const not = (metin: string): Blok => ({ tur: 'metin', metin });
  const out: Mesaj[] = liste.map((m) => ({ rol: m.rol, bloklar: [...m.bloklar] }));
  for (let i = 0; i < out.length; i++) {
    const m = out[i];
    if (m.rol === 'assistant') {
      const sonraki = out[i + 1];
      const yanitlanan = new Set(sonraki?.rol === 'user' ? sonraki.bloklar.filter((b) => b.tur === 'arac_sonuc').map((b) => (b as { id: string }).id) : []);
      m.bloklar = m.bloklar.map((b) => {
        if (b.tur === 'arac_sonuc') return not(`[araç sonucu: ${b.icerik.slice(0, 400)}]`);
        if (b.tur === 'arac_cagri' && !yanitlanan.has(b.id)) return not(`[${b.ad} aracı çağrıldı; sonucu kaydedilmedi]`);
        return b;
      });
    } else {
      const onceki = out[i - 1];
      const cagrilan = new Set(onceki?.rol === 'assistant' ? onceki.bloklar.filter((b) => b.tur === 'arac_cagri').map((b) => (b as { id: string }).id) : []);
      const sonuclar = m.bloklar.filter((b) => b.tur === 'arac_sonuc' && cagrilan.has(b.id));
      const digerleri = m.bloklar.filter((b) => !(b.tur === 'arac_sonuc' && cagrilan.has(b.id))).map((b) => (b.tur === 'arac_sonuc' ? not(`[araç sonucu: ${b.icerik.slice(0, 400)}]`) : b));
      m.bloklar = [...sonuclar, ...digerleri]; // araç sonuçları mesajın başında olmalı
    }
  }
  return out.filter((m) => m.bloklar.length);
}
