// Küçük denetimler (fintech): anahtar (görünen 46×28, tıklama alanı ≥ 36; 0.14 T29: açıkken ekranın vurgusu — --vurgu, Yönetim'de yoksa
// yeşil; fintech.css), metin alanı (etiket üstte, 52 px, 17 px yazı) ve saat seçici
// (yerel <input type=time> ya da <select> yok: büyük tabular rakam, −/+ 30 dk, ↑/↓ ←/→ tuşları).
import { useId, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { Ikon } from '../../bilesenler/Ikon';

export function Anahtar({ acik, degistir, etiket, devreDisi }: { acik: boolean; degistir: (v: boolean) => void; etiket: string; devreDisi?: boolean }) {
  return <button type="button" className="ft-anahtar" role="switch" aria-checked={acik} aria-label={etiket} disabled={devreDisi} onClick={() => degistir(!acik)} />;
}

export function Alan({ etiket, ipucu, children }: { etiket: string; ipucu?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="ft-alan">
      <label className="ft-etiket" htmlFor={id}>{etiket}{ipucu && <span className="ft-etiket__ipucu"> · {ipucu}</span>}</label>
      {children(id)}
    </div>
  );
}

export function Girdi(o: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...o} className={`ft-girdi${o.className ? ` ${o.className}` : ''}`} />;
}

const SAAT = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** "HH:MM" + dakika (gün içinde döner). */
export function saatEkle(s: string, dk: number): string {
  const m = SAAT.exec(s);
  const top = m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  const y = (((top + dk) % 1440) + 1440) % 1440;
  return `${String(Math.floor(y / 60)).padStart(2, '0')}:${String(y % 60).padStart(2, '0')}`;
}

export function SaatSecici({ deger, degistir, etiket, adim = 30, kucuk = false, devreDisi = false }: {
  deger: string; degistir: (s: string) => void; etiket: string; adim?: number; kucuk?: boolean; devreDisi?: boolean;
}) {
  const tus = (e: KeyboardEvent<HTMLElement>) => {
    const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? adim : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -adim : e.key === 'PageUp' ? 60 : e.key === 'PageDown' ? -60 : 0;
    if (!d || devreDisi) return;
    e.preventDefault();
    degistir(saatEkle(deger, d));
  };
  return (
    <div className={`ft-saat${kucuk ? ' ft-saat--k' : ''}`} data-saat={etiket}>
      <button type="button" className="ft-saat__dgm" aria-label={`${etiket}: ${adim} dakika geri`} disabled={devreDisi} onClick={() => degistir(saatEkle(deger, -adim))} tabIndex={-1}><Ikon ad="eksi" olcu={16} /></button>
      <span
        className="ft-saat__deger" role="spinbutton" tabIndex={devreDisi ? -1 : 0} aria-label={etiket} aria-valuetext={deger} aria-valuenow={Number(deger.slice(0, 2)) * 60 + Number(deger.slice(3, 5))}
        aria-valuemin={0} aria-valuemax={1439} onKeyDown={tus}
      >{deger}</span>
      <button type="button" className="ft-saat__dgm" aria-label={`${etiket}: ${adim} dakika ileri`} disabled={devreDisi} onClick={() => degistir(saatEkle(deger, adim))} tabIndex={-1}><Ikon ad="arti" olcu={16} /></button>
    </div>
  );
}
