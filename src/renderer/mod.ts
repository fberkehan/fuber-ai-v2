// Kullanım biçimi (K2) arayüz kancası: ayarlardaki `mod` + değişiklikleri ('ayarlar:degisti'). Yüklenene dek null — çağıran bu
// arada mod'a bağlı metni çizmez (İş ↔ Geliştirici sözcükleri bir kare yer değiştirip titremesin). Son bilinen değer modülde
// tutulur: sonradan takılan bileşen beklemeden doğru metinle başlar.
import { useEffect, useState } from 'react';
import { cagir, dinle } from './api';
import type { Ayarlar, Mod } from '../shared/tipler';

let sonMod: Mod | null = null;
const coz = (a: Pick<Ayarlar, 'mod'>): Mod => (a.mod === 'gelistirici' ? 'gelistirici' : 'is');
// Önyükleme: modül yüklenirken istenir; kabuk (main.tsx) kendi ayar isteği dönene dek çizilmediğinden, sonra takılan bileşen
// (kokpit hapı) ilk karede doğru metinle başlar.
if (typeof window !== 'undefined' && window.fuber) void cagir<Ayarlar>('ayarlar:al').then((a) => { sonMod ??= coz(a); }).catch(() => undefined);

export function useMod(): Mod | null {
  const [mod, setMod] = useState<Mod | null>(sonMod);
  useEffect(() => {
    const yaz = (a: Ayarlar) => { sonMod = coz(a); setMod(sonMod); };
    void cagir<Ayarlar>('ayarlar:al').then(yaz).catch(() => undefined);
    return dinle('ayarlar:degisti', yaz);
  }, []);
  return mod;
}
