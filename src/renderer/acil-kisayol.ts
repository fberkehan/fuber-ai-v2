// ── Acil durdurma kısayolunun GERÇEK durumu (Görev 20b düzeltme turu 2) ───────────────────────────────────────────────────
// Başka bir uygulama Alt+Shift+Q'yu tutuyorsa ana süreç onu alamaz; o zaman Fuber ekranı kullanırken görünen yüzeyler (adanın
// "Durdur: …"u, Fuber imlecinin şeridi, Fuber Tarayıcı ipucu) tuşu söz vermez, tepsideki "Tümünü durdur"u söyler. Durum ana
// süreçten: `kisayol:durum`, değişince `kisayol:degisti` (main.ts). Durum gelene dek varsayılan tuş (bir an "alınamadı" yazmasın).
// B8 (son düzeltme): durum modülde TEK abonelikle tutulur (Ayarlar'daki her satır ayrıca istemesin); sabit metinlerdeki yer tutucu
// (shared/genel-kisayol.ts ACIL_YER) bununla doldurulur.
import { useEffect, useState } from 'react';
import { cagir, dinle } from './api';
import { acilDurdurmaKisayolu, ACIL_YEDEK_METNI, type KisayolDurumu } from '../shared/genel-kisayol';
import { kisayolOkunur } from '../shared/kisayol';

const mac = () => window.fuber?.platform === 'darwin';
/** Tuş alınamadıysa söylenecek yer. */
export const ACIL_YEDEK = ACIL_YEDEK_METNI;

export const varsayilanAcilTus = () => kisayolOkunur(acilDurdurmaKisayolu(mac() ? 'darwin' : 'win32'), mac());

let son: string | null | undefined; // undefined: durum henüz gelmedi
const dinleyiciler = new Set<(tus: string | null) => void>();
let bagli = false;
function yaz(d: KisayolDurumu | null | undefined): void {
  if (!d?.acil) return;
  son = d.acil.alindi ? kisayolOkunur(d.acil.tus, mac()) : null;
  for (const f of [...dinleyiciler]) f(son);
}
function baglan(): void {
  if (bagli || typeof window === 'undefined' || !window.fuber) return;
  bagli = true;
  void cagir<KisayolDurumu>('kisayol:durum').then(yaz).catch(() => undefined);
  dinle('kisayol:degisti', yaz);
}

/** Okunur tuş (alındıysa) ya da null (alınamadı) bildirir; bırakma işlevi döner. */
export function acilDurdurmaDinle(f: (tus: string | null) => void): () => void {
  baglan();
  dinleyiciler.add(f);
  if (son !== undefined) f(son);
  return () => { dinleyiciler.delete(f); };
}

/** React: okunur tuş ya da null (alınamadı). */
export function useAcilDurdurma(): string | null {
  const [t, setT] = useState<string | null>(() => (son !== undefined ? son : varsayilanAcilTus()));
  useEffect(() => acilDurdurmaDinle(setT), []);
  return t;
}
