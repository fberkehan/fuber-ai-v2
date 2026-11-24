// Şeffaf tema bu bilgisayarda var mı? (0.13 T13) Ayarlar → Görünüm ve kurulumun Görünüm adımı seçenekleri buna göre çizer: yoksa (Windows 10, Windows 11
// 21H2, Linux) Şeffaf hiç sunulmaz. Yanıt gelene dek `false` (seçenek sonradan belirir; ana süreç yanıtı anında verir).
import { useEffect, useState } from 'react';
import { camDestegi } from './tema';

export function useCamDestegi(): boolean {
  const [var_, setVar] = useState(false);
  useEffect(() => { let iptal = false; void camDestegi().then((v) => { if (!iptal) setVar(v); }); return () => { iptal = true; }; }, []);
  return var_;
}
