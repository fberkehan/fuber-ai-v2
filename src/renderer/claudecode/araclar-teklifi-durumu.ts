// ── "Geliştirici araçları" teklifinin durumu (I8, son inceleme) ───────────────────────────────────────────────────────────────────
// Eskiden kabuk (main.tsx) teklifi pencerenin üstüne SABİT bir kart olarak çiziyordu (top: 44px): Ayarlar'da İş → Geliştirici geçince
// sayfa başlığını örtüyordu (ayarlar-onizle 1/665). Artık teklif Ayarlar → Genel'de mod anahtarının HEMEN ALTINDA, satır içinde
// (ayarlar/Genel.tsx). Kabuk geçişi görür ve teklifi açar (araclarTeklifEdilsinMi); "Göster" kabuğa tek adımlı sihirbazı açtırır.
// Oturum boyunca kalır (sayfadan çıkıp dönünce de görünür); "Şimdi değil", "Göster" ya da İş'e dönüş kapatır.
import { useEffect, useState } from 'react';

let acik = false;
let gosterici: (() => void) | null = null;
const dinleyiciler = new Set<(v: boolean) => void>();

export const araclarTeklifi = {
  ac(): void { acik = true; for (const f of [...dinleyiciler]) f(true); },
  kapat(): void { acik = false; for (const f of [...dinleyiciler]) f(false); },
  acikMi: (): boolean => acik,
  /** Kabuk (main.tsx): "Göster" tek adımlı "Geliştirici araçları" sihirbazını açar. */
  gostericiBagla(f: (() => void) | null): void { gosterici = f; },
  goster(): void { araclarTeklifi.kapat(); gosterici?.(); },
};

export function useAraclarTeklifi(): boolean {
  const [v, setV] = useState(acik);
  useEffect(() => { dinleyiciler.add(setV); setV(acik); return () => { dinleyiciler.delete(setV); }; }, []);
  return v;
}
