// Düşünme motoru (gün kaydı) arayüzünün ortak parçaları: canlı durum kancası, ajan noktası, tarih yardımcıları,
// odaktan çıkınca kaydeden girdi. Ana süreçte bir kanal henüz yoksa çağrılar düşer ve boş durum gösterilir.
import { useEffect, useState, type CSSProperties } from 'react';
import { cagir, dinle } from '../api';
import type { AjanDurumu, DusunmeDurumu } from '../../shared/tipler';
import { isDiliIhlali } from '../../shared/is-dili';
import { gunKaydiSayaclari } from '../../shared/gun-kaydi-metni';

/** `gunkaydi:durum` ilk değer + değişiklik olayları. Kanal yoksa null kalır. İkinci öğe: çağrı yanıtıyla tazeleme. */
export function useDusunmeDurumu(): [DusunmeDurumu | null, (y: DusunmeDurumu | null | undefined) => void] {
  const [d, setD] = useState<DusunmeDurumu | null>(null);
  useEffect(() => {
    void cagir<DusunmeDurumu>('gunkaydi:durum').then(setD).catch(() => null);
    return dinle('gunkaydi:durum', (y: DusunmeDurumu) => setD(y));
  }, []);
  return [d, (y) => { if (y && typeof y === 'object' && 'bugun' in y) setD(y); }];
}

/** "Error invoking remote method 'x': Error: …" önekini atar; kanal kayıtlı değilse sade bir cümle döner. */
export function hataMetni(e: unknown): string {
  const m = String((e as Error)?.message ?? e ?? '');
  if (/No handler registered/i.test(m)) return 'Bu özellik henüz hazır değil.';
  return m.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '') || 'Bir şeyler ters gitti.';
}

const iki = (n: number) => String(n).padStart(2, '0');
/** Yerel gün anahtarı: YYYY-MM-DD. */
export const gunAnahtari = (t: Date) => `${t.getFullYear()}-${iki(t.getMonth() + 1)}-${iki(t.getDate())}`;

/** ISO zamandan "14:05" (saniyeli: "14:05:33"); çözülemezse metnin kendisi. */
export function saatMetni(iso: string, saniye = false): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso.slice(0, saniye ? 8 : 5);
  return t.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', ...(saniye ? { second: '2-digit' } : {}) });
}

/** Küçük hap (etiket, kişi, konu): mevcut sayfalardaki satır içi ölçü. */
export const UFAK_HAP = { height: 20, fontSize: 12 } as const; // yazı ≥ 12 px (Görev 19 denetimi: 10,5 px okunmuyordu)

/** Yalnız gün ("2026-10-21") ya da tam ISO → o günün yerel başlangıcı. */
function gunBasi(s: string): Date {
  const t = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00`) : new Date(s);
  t.setHours(0, 0, 0, 0);
  return t;
}

/** Bugünden kaç gün sonra (geçmişse eksi). */
export function gunFarki(s: string): number {
  const bugun = new Date(); bugun.setHours(0, 0, 0, 0);
  return Math.round((gunBasi(s).getTime() - bugun.getTime()) / 86_400_000);
}

/** "bugün", "yarın", "3 gün sonra", "2 gün önce"; bir haftadan uzaksa "26 Eki". */
export function gunGoreli(s: string): string {
  const f = gunFarki(s);
  if (Number.isNaN(f)) return s;
  if (Math.abs(f) >= 7) return gunBasi(s).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
  return new Intl.RelativeTimeFormat('tr', { numeric: 'auto' }).format(f, 'day');
}

/** Saklama süresi: "bugün silinecek" / "yarın silinecek" / "4 gün sonra silinecek". */
export function silinmeMetni(iso?: string): string {
  if (!iso) return '';
  const f = gunFarki(iso);
  if (Number.isNaN(f)) return '';
  return f <= 0 ? 'bugün silinecek' : f === 1 ? 'yarın silinecek' : `${f} gün sonra silinecek`;
}

export const AJAN_DURUM: Record<AjanDurumu['durum'], string> = { bekliyor: 'bekliyor', calisiyor: 'çalışıyor', hata: 'hata', kapali: 'kapalı' };

/** Ajan durum noktası: bekliyor gri, çalışıyor turuncu (nabız), hata kırmızı, kapalı sönük. İpucunda yalnız sade not (kokpitte her
 *  modda görünür: teknik ad ya da ham hata taşıyan not yazılmaz — Ruling O; ayrıntı Ayarlar → Düşünme motoru'nda, Geliştirici'de). */
export function AjanNoktasi({ a }: { a: AjanDurumu }) {
  const sinif = a.durum === 'calisiyor' ? 'nokta--turuncu nokta--nabiz' : a.durum === 'hata' ? 'nokta--kirmizi' : a.durum === 'kapali' ? 'nokta--sonuk' : '';
  const not = a.not && !isDiliIhlali(a.not) ? a.not : a.durum === 'hata' ? 'bir sorun oldu' : '';
  return <span className={`nokta ${sinif}`} title={`${a.etiket} · ${AJAN_DURUM[a.durum]}${not ? ` — ${not}` : ''}`} />;
}

/** Bugünün sayaçları tek satır, insan diliyle (11 Kas, tasarımcı bulgu 7: "Bugün 14 not (3 önemli) · 2 kez araya girdi"; hepsi sıfırsa
 *  "Bugün henüz not yok."; döküm satırı sayısı yazılmaz). */
export function bugunMetni(d: DusunmeDurumu): string {
  return gunKaydiSayaclari(d.bugun);
}

/** Saat, sayı ve tarih girdisi: yazarken kaydetmez; odaktan çıkınca ya da Enter'da kaydeder. */
export function OdakGirdi({ deger, kaydet, tur = 'text', genislik = 120, duzelt, stil, ...ek }: {
  deger: string; kaydet: (v: string) => void; tur?: 'text' | 'time' | 'number' | 'date'; genislik?: number | string;
  /** Kaydetmeden önce değeri düzeltir (ör. sayıyı sınırlar). */
  duzelt?: (v: string) => string; stil?: CSSProperties; min?: number; max?: number; title?: string; list?: string; placeholder?: string; 'aria-label'?: string;
}) {
  const [v, setV] = useState(deger);
  useEffect(() => setV(deger), [deger]);
  const bitir = () => {
    const n = duzelt ? duzelt(v) : v;
    setV(n);
    if (n !== deger) kaydet(n);
  };
  return (
    <input className="girdi" type={tur} style={{ width: genislik, ...stil }} value={v} {...ek}
      onChange={(e) => setV(e.target.value)} onBlur={bitir}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
  );
}

/** Sayıyı [en, en çok] aralığına sıkıştırır; geçersizse varsayılan. */
export const sinirla = (v: string, en: number, enCok: number, varsayilan: number) => {
  const n = Math.round(Number(v));
  return String(Number.isFinite(n) && v.trim() !== '' ? Math.min(enCok, Math.max(en, n)) : varsayilan);
};
