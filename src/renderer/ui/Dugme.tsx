// Dugme (0.11 G3): tasarim.css'in hap düğmeleri (.dgm) — tür ve boyut adlarıyla. Birincil = .dgm--beyaz (açık temada mürekkep),
// ikincil = .dgm--koyu, hayalet, tehlike; boyut 'k' 32 px, 'n' 38 px (ikisi de ≥ 32 px dokunma). Devre dışı hâl tasarim.css'ten (üç
// temada ≥ 4,5:1). Etiket tek satır: kabından uzunsa … (bilinçli kırpma) — metin etiketin TAMAMI `title`'da (Rozet gibi) ve kırpılmışsa
// klavye odağında ipucuyla okunur (düzeltme turu 1, inceleme K4); erişilebilir ad görünen yazının kendisidir. `simge`: Ikon adı ya da öğe;
// yazısız düğme yalnız simgedir — o zaman `aria-label` ver (ipucu da odur).
import { useRef, type ComponentPropsWithRef, type ReactElement, type ReactNode } from 'react';
import { Ikon } from '../bilesenler/Ikon';
import { kirpGerekli } from './bicim';
import { useKirpildi, useOdakIpucu } from './kirp';
import './ui.css';

export type DugmeTuru = 'birincil' | 'ikincil' | 'hayalet' | 'tehlike';

const TUR: Record<DugmeTuru, string> = { birincil: 'dgm--beyaz', ikincil: 'dgm--koyu', hayalet: 'dgm--hayalet', tehlike: 'dgm--tehlike' };

export type DugmeOzellikleri = {
  tur: DugmeTuru;
  boyut?: 'k' | 'n';
  simge?: string | ReactElement;
  children?: ReactNode;
} & Omit<ComponentPropsWithRef<'button'>, 'children'>;

export function Dugme({ tur, boyut = 'n', simge, children, className, type = 'button', onFocus, onBlur, onKeyDown, ...dugme }: DugmeOzellikleri) {
  const yazisiz = children === undefined || children === null || children === false || children === '';
  const metin = typeof children === 'string' ? children : undefined;
  const mRef = useRef<HTMLSpanElement>(null);
  const kesik = useKirpildi([mRef], metin ? kirpGerekli(metin, 1, 28) : false, metin ?? '');
  const { olaylar, ipucu } = useOdakIpucu(kesik && metin !== undefined, metin ?? '');
  const sinif = ['dgm', TUR[tur], boyut === 'k' && 'dgm--k', yazisiz && simge && 'dgm--simge', 'ui-dugme', className].filter(Boolean).join(' ');
  return (
    <>
      <button
        {...dugme}
        type={type}
        className={sinif}
        title={dugme.title ?? metin ?? (yazisiz ? dugme['aria-label'] : undefined)}
        onFocus={(e) => { olaylar.onFocus(e); onFocus?.(e); }}
        onBlur={(e) => { olaylar.onBlur(); onBlur?.(e); }}
        onKeyDown={(e) => { olaylar.onKeyDown(e); onKeyDown?.(e); }}
      >
        {simge && (typeof simge === 'string' ? <Ikon ad={simge} olcu={boyut === 'k' ? 16 : 18} /> : simge)}
        {!yazisiz && <span ref={mRef} className="ui-dugme__metin" data-kirp="1">{children}</span>}
      </button>
      {ipucu}
    </>
  );
}
