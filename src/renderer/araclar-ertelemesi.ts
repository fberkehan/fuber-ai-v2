// ── "Geliştirici araçları" teklifinin ertelenmesi (0.10 Görev 2, D-2) ───────────────────────────────────────────────────────────────
// İş → Geliştirici geçişinde bulut motoru yoksa kullanıcı önce Yapay zekâ → Motorlar'a iner (ayarlar/Genel.tsx); araçlar teklifi
// (claudecode/araclar-teklifi-durumu.ts) BEKLER — motor bağlanınca kabuk (main.tsx) teklifi açar. Bekleme sürerken Motorlar'ın üstünde tek
// satır (ayarlar/YapayZeka.tsx). Oturum boyunca modülde; İş'e dönüş ya da teklifin açılması bitirir.
import { useEffect, useState } from 'react';

let ertelendi = false;
const dinleyiciler = new Set<(v: boolean) => void>();
const yay = () => { for (const f of [...dinleyiciler]) f(ertelendi); };

export const MOTOR_ONCE_SATIRI = 'Önce bir motor bağla; geliştirici araçlarını sonra öneririm.';

export const araclarErtelemesi = {
  ertele(): void { if (!ertelendi) { ertelendi = true; yay(); } },
  birak(): void { if (ertelendi) { ertelendi = false; yay(); } },
  ertelendiMi: (): boolean => ertelendi,
};

export function useAraclarErtelendi(): boolean {
  const [v, setV] = useState(ertelendi);
  useEffect(() => { dinleyiciler.add(setV); setV(ertelendi); return () => { dinleyiciler.delete(setV); }; }, []);
  return v;
}
