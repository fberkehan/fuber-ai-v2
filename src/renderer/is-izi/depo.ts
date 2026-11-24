// ── İş izi arayüz deposu (11 Kas): tek abonelik, bütün yüzeyler aynı listeyi okur ────────────────────────────────────────────────────────
// Ana süreç (main/is-izi.ts) listeyi olayla yayar ('is-izi:degisti'); açılışta bir kez 'is-izi:liste'. Yoklama yok. Çentik, sohbet, kokpit, Etkinlik,
// ray ve Claude Code sayfası useIsIzi ile okur (useSyncExternalStore: ileti başına IPC yok). Süre yazısı yalnız aktif iş görünürken saniyede bir tazelenir
// (useSaniye; pencere gizliyken durur). "Az hareket": Görünüm'deki ayar (gorunum.azHareket) ya da Windows'un animasyon tercihi — ikisinde de yalnız opaklık.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { cagir, dinle } from '../api';
import type { IsKaydi } from '../../shared/is-izi';
import type { Ayarlar } from '../../shared/tipler';

const kopruVar = (): boolean => typeof window !== 'undefined' && Boolean(window.fuber);
let liste: IsKaydi[] = [];
const dinleyenler = new Set<() => void>();
let basladi = false;
let olayGeldi = false;

/** Yardımcı sıraları (iş listeden düşse de "Yardımcı N" ve tonu Claude Code sayfasında aynı kalsın; sayfa iş sürerken açık olmasa bile). */
const siralar = new Map<string, number>();
export const isSirasi = (id: string): number | undefined => siralar.get(id);

function yaz(l: unknown): void {
  if (!Array.isArray(l)) return;
  liste = l as IsKaydi[];
  for (const x of liste) if (x.sira !== undefined) siralar.set(x.id, x.sira);
  for (const f of dinleyenler) f();
}

function baslat(): void {
  if (basladi || !kopruVar()) return;
  basladi = true;
  dinle('is-izi:degisti', (l: IsKaydi[]) => { olayGeldi = true; yaz(l); });
  // Olay ilk yanıttan önce gelirse (daha yeni) eski yanıt onu ezmesin.
  void cagir<IsKaydi[]>('is-izi:liste').then((l) => { if (!olayGeldi) yaz(l); }).catch(() => undefined);
}

const abone = (f: () => void) => { baslat(); dinleyenler.add(f); return () => { dinleyenler.delete(f); }; };
const anlik = (): IsKaydi[] => liste;

/** Bütün işler (sıralı: aktifler önce, sonra bir an kalan bitenler). */
export function useIsIzi(): IsKaydi[] {
  return useSyncExternalStore(abone, anlik, anlik);
}

/** Test/önizleme dışı kancasız okuma. */
export const isIziAnlik = (): IsKaydi[] => liste;

// ── Az hareket ──
let azAyar = false;
let azSistem = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const azDinleyenler = new Set<() => void>();
let azBasladi = false;
function azBaslat(): void {
  if (azBasladi) return;
  azBasladi = true;
  const yay = () => { for (const f of azDinleyenler) f(); };
  if (typeof matchMedia === 'function') {
    const m = matchMedia('(prefers-reduced-motion: reduce)');
    m.addEventListener('change', () => { azSistem = m.matches; yay(); });
  }
  if (!kopruVar()) return;
  const al = (a: Ayarlar | null | undefined) => { const y = Boolean(a?.gorunum?.azHareket); if (y !== azAyar) { azAyar = y; yay(); } };
  void cagir<Ayarlar>('ayarlar:al').then(al).catch(() => undefined);
  dinle('ayarlar:degisti', al);
}
const azAbone = (f: () => void) => { azBaslat(); azDinleyenler.add(f); return () => { azDinleyenler.delete(f); }; };
const azAnlik = (): boolean => azAyar || azSistem;
/** "Az hareket" (ayar ya da Windows): yalnız opaklık geçişleri; döngü ve uçuş yok. */
export function useIsAzHareket(): boolean {
  return useSyncExternalStore(azAbone, azAnlik, azAnlik);
}
export const isAzHareketMi = (): boolean => azAnlik();

/** Şimdiki an: `aktif` iken saniyede bir (süre yazısı), değilken durur. Pencere gizliyken tazelenmez. */
export function useSaniye(aktif: boolean): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    if (!aktif) return;
    const tazele = () => { if (!document.hidden) setT(Date.now()); };
    tazele();
    const z = setInterval(tazele, 1000);
    document.addEventListener('visibilitychange', tazele);
    return () => { clearInterval(z); document.removeEventListener('visibilitychange', tazele); };
  }, [aktif]);
  return t;
}

// ── Eylemler (kimlik yalnız burada çözülür; ekranda hiçbir yerde yazmaz) ──
/** İşin yerine git (ana pencere öne gelir, o sayfa ve o sohbet/oturum açılır). */
export function isGit(is: IsKaydi): void { void cagir('ana:goster', is.nerede.yol); }

/** İşi durdur: kaynağına göre kendi kanalı. Desteklenmeyen kaynakta hiçbir şey yapmaz. */
export async function isDurdur(is: IsKaydi): Promise<void> {
  const [tur, a, b, c] = is.id.split(':');
  if (tur === 'sohbet') await cagir('sohbet:durdur', Number(a));
  else if (tur === 'gorev') await cagir('isler:durdur', Number(a));
  else if (tur === 'surec') await cagir('surec:durdur', is.id.slice('surec:'.length));
  else if (tur === 'cc' && b === 'is' && c) await cagir('claudecode:is-durdur', a, is.id.split(':is:')[1]);
  else if (tur === 'cc' && !b) await cagir('claudecode:kes', a);
}
