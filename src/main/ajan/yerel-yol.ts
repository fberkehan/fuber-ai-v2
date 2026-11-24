// ── "Yalnız bu bilgisayar"ın kod yolu (11 Kas analizi #9, §6.3) ────────────────────────────────────────────────────────────────────────────
// Yerel turda (Gizli DEĞİL) mesaj modele gitmeden önce işine bakılır (shared/yerel-yonlendirme.ts yerelIsTuru):
//  · hatırlatıcı / yapılacak iş → kural tabanlı Türkçe zaman çözücü + ONAY KARTI ("Hatırlatıcı kurulsun mu?") → planlama.ts; model çağrılmaz.
//    Zaman anlaşılmazsa uydurulmaz: ne zaman olduğu sorulur.
//  · tarih ("45 gün sonra hangi gün") ve aritmetik ("1.500’ün %40’ı") → kodla kesin sonuç; model çağrılmaz.
//  · takvim ("bugün kaçta toplantım var") → Fuber'deki hatırlatıcı ve yapılacaklardan liste + dürüst satır (takvim uygulamasına bakılamaz).
//  · kodla çözülemeyen hesap → model yanıtlar, ardından dürüst bir not ("önemliyse doğrula").
// Geri kalanı (selamlama, özet, taslak, çeviri, hafızadan hatırlama) yerel modele gider. Gizli'de kod yolu çalışmaz: Gizli bölüm iz bırakmaz.
import { onayIste } from '../olaylar.js';
import { hatirlaticiEkle, gorevEkle, hatirlaticilar, gorevler } from '../planlama.js';
import { kokpitYenile } from '../kokpit/duzen.js';
import { zamanCoz, zamanMetni, tarihMetni } from '../../shared/tr-zaman.ts';
import {
  yerelIsTuru, hatirlaticiBasligi, gorevBasligi, aritmetik, tarihYaniti, sayiMetni, YEREL_HESAP_NOTU, YEREL_TAKVIM_NOTU,
} from '../../shared/yerel-yonlendirme.ts';

export type KodYolu = { metin: string } | { not: string } | null;

const TEKRAR_ADI: Record<string, string> = { gunluk: 'her gün', hafta_ici: 'hafta içi her gün', haftalik: 'her hafta', aylik: 'her ay' };
const saatKisa = (iso: string) => new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

/** Mesajın kod yolu: `metin` → yanıt budur (model çağrılmaz); `not` → model yanıtlar, sonuna bu not düşer; null → olağan yerel tur. */
export async function yerelKodYolu(sohbetId: number, metin: string, sinyal?: AbortSignal, simdi: Date = new Date()): Promise<KodYolu> {
  const is = yerelIsTuru(metin);
  if (is === 'hatirlatici') {
    const z = zamanCoz(metin, simdi);
    if (!z || z.zaman.getTime() <= simdi.getTime()) return { metin: 'Ne zaman hatırlatayım? Örneğin “yarın 14:00”, “cuma 16:00” ya da “24 Ekim 15:00” yaz; onaylayınca kurarım.' };
    const baslik = hatirlaticiBasligi(metin, z);
    const tekrar = z.tekrar !== 'yok' ? ` (${TEKRAR_ADI[z.tekrar]})` : '';
    const karar = await onayIste(sohbetId, { baslik: 'Hatırlatıcı kurulsun mu?', aciklama: `${baslik} · ${zamanMetni(z.zaman)}${tekrar}`, tehlike: 'dusuk' }, sinyal);
    if (karar === 'reddet') return { metin: 'Tamam, hatırlatıcıyı kurmadım.' };
    hatirlaticiEkle({ baslik, zaman: z.zaman.toISOString(), tekrar: z.tekrar, aciklama: z.olay ? `Asıl zaman: ${zamanMetni(z.olay)}` : undefined, kaynak: `sohbet:${sohbetId}` });
    void kokpitYenile('yeni hatırlatıcı', true);
    return { metin: `⏰ Kurdum: **${baslik}** · ${zamanMetni(z.zaman)}${tekrar}.${z.olay ? ` (Asıl zaman: ${zamanMetni(z.olay)}.)` : ''}` };
  }
  if (is === 'gorev') {
    const g = gorevBasligi(metin, simdi);
    const son = g.sonTarih ? ` · son tarih ${tarihMetni(g.sonTarih)}` : '';
    const karar = await onayIste(sohbetId, { baslik: 'Yapılacaklara eklensin mi?', aciklama: `${g.baslik}${son}`, tehlike: 'dusuk' }, sinyal);
    if (karar === 'reddet') return { metin: 'Tamam, eklemedim.' };
    gorevEkle({ baslik: g.baslik, sonTarih: g.sonTarih?.toISOString() });
    void kokpitYenile('yeni yapılacak', true);
    return { metin: `Yapılacaklara ekledim: **${g.baslik}**${son}.` };
  }
  if (is === 'tarih') {
    const y = tarihYaniti(metin, simdi);
    if (y) return { metin: y };
  }
  if (is === 'hesap') {
    const h = aritmetik(metin);
    return h ? { metin: `${h.ifade} = **${sayiMetni(h.sonuc)}**` } : { not: YEREL_HESAP_NOTU };
  }
  if (is === 'takvim') {
    const z = zamanCoz(metin, simdi);
    const gun = new Date(z?.zaman ?? simdi);
    gun.setHours(0, 0, 0, 0);
    const bitis = new Date(gun);
    bitis.setDate(bitis.getDate() + 1);
    const hat = hatirlaticilar({ durum: 'bekliyor', limit: 50 }).filter((h) => { const t = Date.parse(h.zaman); return t >= gun.getTime() && t < bitis.getTime(); });
    const acik = gorevler({ limit: 8 });
    const satirlar = [
      `${tarihMetni(gun)}:`,
      ...(hat.length ? hat.map((h) => `- ${saatKisa(h.zaman)} ${h.baslik}`) : ['- Bu güne kurulu hatırlatıcı yok.']),
      ...(acik.length ? ['Açık yapılacaklar:', ...acik.map((g) => `- ${g.baslik}${g.sonTarih ? ` (son ${tarihMetni(new Date(g.sonTarih))})` : ''}`)] : []),
      YEREL_TAKVIM_NOTU,
    ];
    return { metin: satirlar.join('\n') };
  }
  return null;
}
