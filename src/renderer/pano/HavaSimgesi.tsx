// Hava simgeleri (Görev 24): Apple Hava gibi renkli, sade glifler; renkler temaya göre pano.css belirteçlerinden (--hv-*).
// Simge süstür: koşul her zaman yazıyla da yazılır (aria-hidden).
import type { HavaSimgesi as Tur } from '../../shared/pano';

const BULUT = 'M7.2 18.5h9.9a3.9 3.9 0 0 0 .5-7.77A5.6 5.6 0 0 0 6.75 12a3.25 3.25 0 0 0 .45 6.5z';
const BULUT_UST = 'M7.6 15.6h9a3.4 3.4 0 0 0 .4-6.77A5 5 0 0 0 7.2 9.85 2.9 2.9 0 0 0 7.6 15.6z';

function Gunes({ cx = 12, cy = 12, r = 4.1, isin = 2.6 }: { cx?: number; cy?: number; r?: number; isin?: number }) {
  const isinlar = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const i1 = r + 1.9, i2 = r + 1.9 + isin;
    return <line key={i} x1={cx + Math.cos(a) * i1} y1={cy + Math.sin(a) * i1} x2={cx + Math.cos(a) * i2} y2={cy + Math.sin(a) * i2} />;
  });
  return (
    <g>
      <g stroke="var(--hv-gunes)" strokeWidth="1.6" strokeLinecap="round">{isinlar}</g>
      <circle cx={cx} cy={cy} r={r} fill="var(--hv-gunes)" />
    </g>
  );
}
const Ay = ({ x = 0, y = 0, s = 1 }: { x?: number; y?: number; s?: number }) => (
  <path transform={`translate(${x} ${y}) scale(${s})`} d="M15.6 15.4A6.6 6.6 0 0 1 8.6 5.2a6.9 6.9 0 1 0 7 10.2z" fill="var(--hv-ay)" />
);
const Damla = ({ x, y }: { x: number; y: number }) => <line x1={x} y1={y} x2={x - 1.1} y2={y + 2.6} stroke="var(--hv-yagmur)" strokeWidth="1.7" strokeLinecap="round" />;
const Tane = ({ x, y }: { x: number; y: number }) => <circle cx={x} cy={y} r={1.15} fill="var(--hv-kar)" stroke="var(--hv-kar-cizgi)" strokeWidth="0.6" />;

export function HavaSimgesi({ tur, olcu = 24, className }: { tur: Tur; olcu?: number; className?: string }) {
  let ic;
  switch (tur) {
    case 'acik-gun': ic = <Gunes />; break;
    case 'acik-gece': ic = <Ay x={0.6} y={0.8} />; break;
    case 'az-bulut-gun': ic = <><Gunes cx={8.6} cy={8.4} r={3.4} isin={2} /><path d={BULUT} fill="var(--hv-bulut)" /></>; break;
    case 'az-bulut-gece': ic = <><Ay x={-2.2} y={-2.4} s={0.82} /><path d={BULUT} fill="var(--hv-bulut)" /></>; break;
    case 'bulut': ic = <><path d={BULUT_UST} transform="translate(2.6 -2.4) scale(0.92)" fill="var(--hv-bulut-2)" /><path d={BULUT} fill="var(--hv-bulut)" /></>; break;
    case 'sis': ic = <g stroke="var(--hv-bulut)" strokeWidth="1.8" strokeLinecap="round"><line x1="4" y1="8.5" x2="20" y2="8.5" /><line x1="6" y1="12.5" x2="18" y2="12.5" /><line x1="4" y1="16.5" x2="20" y2="16.5" /></g>; break;
    case 'yagmur': ic = <><path d={BULUT_UST} fill="var(--hv-bulut)" /><Damla x={9} y={17.6} /><Damla x={12.6} y={17.6} /><Damla x={16.2} y={17.6} /></>; break;
    case 'saganak': ic = <><Gunes cx={16.4} cy={6.6} r={2.6} isin={1.6} /><path d={BULUT_UST} fill="var(--hv-bulut)" /><Damla x={9.5} y={17.6} /><Damla x={13.5} y={17.6} /></>; break;
    case 'kar': ic = <><path d={BULUT_UST} fill="var(--hv-bulut)" /><Tane x={8.8} y={18.4} /><Tane x={12.4} y={20} /><Tane x={16} y={18.4} /></>; break;
    case 'sulu-sepken': ic = <><path d={BULUT_UST} fill="var(--hv-bulut)" /><Damla x={9.6} y={17.6} /><Tane x={13.4} y={19.4} /><Damla x={16.8} y={17.6} /></>; break;
    case 'firtina': ic = <><path d={BULUT_UST} fill="var(--hv-bulut)" /><path d="M12.6 15.4 9.9 19.4h2.4l-1.1 3.4 3.6-4.9h-2.5l1.4-2.5z" fill="var(--hv-simsek)" /></>; break;
    default: ic = <path d={BULUT} fill="var(--hv-bulut)" />;
  }
  return <svg className={className} width={olcu} height={olcu} viewBox="0 0 24 24" aria-hidden="true" data-hava-simgesi={tur}>{ic}</svg>;
}
