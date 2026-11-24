// MetinKirp (0.11 G3): metni en çok `satir` satırda tutar (… ile biter), uzun tek sözcüğü böler; tamamı `title`'da ve klavye odağında
// okunur (kırpılmışsa odaklanabilir, ipucu açar). Bilinçli kırpmadır: [data-kirp] — taşma denetimi (scripts/dev/tasma.mjs) bunu hata
// saymaz. Yazı biçimi (boyut, kalınlık, renk) üst öğeden gelir: bileşen yalnız satır sınırını koyar.
import { useRef, type CSSProperties } from 'react';
import { kirpGerekli } from './bicim';
import { useKirpildi, useOdakIpucu } from './kirp';
import './ui.css';

export interface MetinKirpOzellikleri {
  metin: string;
  /** En çok kaç satır (1'den küçükse 1). */
  satir: number;
  as?: 'p' | 'span' | 'h3';
}

export function MetinKirp({ metin, satir, as: Etiket = 'p' }: MetinKirpOzellikleri) {
  const n = Math.max(1, Math.floor(satir) || 1);
  const ref = useRef<HTMLElement>(null);
  const kesik = useKirpildi([ref], kirpGerekli(metin, n), `${n}|${metin}`);
  const { olaylar, ipucu } = useOdakIpucu(kesik, metin);
  return (
    <>
      <Etiket
        ref={(e: HTMLElement | null) => { ref.current = e; }}
        className="ui-kirp"
        data-kirp={n}
        title={metin}
        tabIndex={kesik ? 0 : undefined}
        style={{ '--kirp-satir': n } as CSSProperties}
        {...(kesik ? olaylar : {})}
      >
        {metin}
      </Etiket>
      {ipucu}
    </>
  );
}
