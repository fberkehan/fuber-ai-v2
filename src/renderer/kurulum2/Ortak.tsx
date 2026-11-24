// Kurulum v2'nin ortak parçaları: adım başlığı (tek büyük başlık + en çok iki cümle), kademeli giriş sarmalayıcısı, anahtarlı satır listesi.
import type { CSSProperties, ReactNode } from 'react';
import { Ikon } from '../bilesenler/Ikon';
import { Anahtar } from '../ui/fintech';

/** `--k` sırası: başlık 0, giriş 1, denetimler 2… (fintech.css [data-kademe]). */
export const kademe = (k: number) => ({ 'data-kademe': '', style: { '--k': k } as CSSProperties });

export function Bas({ baslik, giris }: { baslik: ReactNode; giris?: ReactNode }) {
  return (
    <header className="k2-bas">
      <h1 className="ft-baslik" tabIndex={-1} data-adim-baslik="" {...kademe(0)}>{baslik}</h1>
      {giris && <p className="ft-giris" {...kademe(1)}>{giris}</p>}
    </header>
  );
}

/** Anahtarlı satırlardan oluşan tek kart (Apple Ayarlar'ın gruplu listesi): simge, ad, tek cümle, anahtar. */
export function AnahtarListesi({ satirlar }: { satirlar: { id: string; simge: string; ad: string; rozet?: string; aciklama: string; acik: boolean; degistir: (v: boolean) => void }[] }) {
  return (
    <div className="k2-liste" role="group">
      {satirlar.map((s) => (
        <div className="k2-liste__satir" key={s.id} data-izin={s.id}>
          <span className="k2-liste__simge" aria-hidden="true"><Ikon ad={s.simge} olcu={18} /></span>
          <span className="k2-liste__yazi"><b>{s.ad}{s.rozet && <span className="ft-rozet">{s.rozet}</span>}</b><span>{s.aciklama}</span></span>
          <Anahtar acik={s.acik} degistir={s.degistir} etiket={s.ad} />
        </div>
      ))}
    </div>
  );
}

/** Sakin tek satır not (durum noktası ya da simgeyle). */
export function Not({ simge, nokta, children, ...geri }: { simge?: string; nokta?: 'yesil' | 'kehribar'; children: ReactNode } & Record<`data-${string}`, string>) {
  return (
    <p className="k2-not" role="status" {...geri}>
      {nokta ? <span className={`ft-nokta ft-nokta--${nokta}`} aria-hidden="true" /> : simge ? <Ikon ad={simge} olcu={16} /> : null}
      <span>{children}</span>
    </p>
  );
}
