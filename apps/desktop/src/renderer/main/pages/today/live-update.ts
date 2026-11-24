// Kartların canlı güncelleme efekti (bütün kartlar için ortak). Veri değişince kartın kenarında kısa bir ışık süpürmesi,
// yeni satırın kayarak girişi ve sayaçta sayı geçişi; yeni e-posta gelince 1–2 sn'lik "Yeni" vurgusu. Hiçbir şey
// sürekli yanıp sönmez: her efekt bir kez oynar. Azaltılmış harekette yalnız renk geçişi kalır (`live-cards.css`).
import { useEffect, useRef, useState } from 'react';
import { localDay, localTime, relativeDay } from '@fuber/shared';

/** Işık süpürmesinin ve "Yeni" vurgusunun süresi (ms; CSS ile aynı). */
export const LIVE_SWEEP_MS = 1100;
export const LIVE_NEW_MS = 1800;

/** Verinin imzası: içerik değişmedikçe aynıdır (nesne kimliğinden bağımsız). */
export function dataSignature(data: unknown): string {
  try {
    return JSON.stringify(data) ?? '';
  } catch {
    return '';
  }
}

/**
 * Veri değiştikçe artan sayaç (ilk çizimde 0): kart çerçevesi bununla ışık süpürmesini yeniden oynatır (`key`).
 * Aynı veriyle gelen yeniden okuma (pano başka bir kart için yenilendi) sayılmaz.
 */
export function useLivePulse(data: unknown): number {
  const signature = dataSignature(data);
  const last = useRef(signature);
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    if (last.current === signature) return;
    last.current = signature;
    setPulse((n) => n + 1);
  }, [signature]);
  return pulse;
}

/**
 * İlk çizimden SONRA beliren anahtarlar (yeni satırlar) kısa bir süre "taze" sayılır: satır kayarak girer. İlk açılışta
 * zaten var olan satırlar taze değildir (pano açılırken her satır girmesin).
 */
export function useFreshKeys(keys: readonly string[], ms = LIVE_NEW_MS): ReadonlySet<string> {
  const known = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const joined = keys.join('\u0000');
  useEffect(() => {
    if (known.current === null) {
      known.current = new Set(keys);
      return;
    }
    const added = keys.filter((key) => !known.current!.has(key));
    for (const key of keys) known.current.add(key);
    if (added.length === 0) return;
    setFresh(new Set(added));
    const timer = window.setTimeout(() => setFresh(new Set()), ms);
    return () => window.clearTimeout(timer);
    // `joined` anahtar listesinin içeriğidir.
  }, [joined]);
  return fresh;
}

/**
 * En yeni ileti anı büyüdüyse (yeni ileti geldi; önceden hiç yokken ilk ileti dahil) `ms` boyunca `true`. Açılıştaki
 * değer vurgu üretmez.
 */
export function useArrival(newestAt: string | null | undefined, ms = LIVE_NEW_MS): boolean {
  const last = useRef<string | null | undefined>(newestAt);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const previous = last.current;
    last.current = newestAt;
    if (!newestAt || (previous && newestAt <= previous) || previous === newestAt) return;
    setOn(true);
    const timer = window.setTimeout(() => setOn(false), ms);
    return () => window.clearTimeout(timer);
  }, [newestAt, ms]);
  return on;
}

/** "Ayşe Demir" → "AD"; tek sözcükte ilk iki harf; rakamla başlayan (numara) adda "#". */
export function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '#';
  if (/^\p{N}/u.test(words[0]!)) return '#';
  const first = words[0]!;
  const letters = words.length > 1 ? `${first[0]}${words[words.length - 1]![0]}` : first.slice(0, 2);
  return letters.toLocaleUpperCase('tr');
}

/** Bugünse saat ("14:32"), değilse gün ("Dün", "Pzt" …). */
export function stamp(iso: string | null, now: Date): string {
  if (!iso) return '';
  const at = new Date(iso);
  return localDay(at) === localDay(now) ? localTime(at) : relativeDay(at, now);
}
