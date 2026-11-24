// ModGecisi (11 Kas; 0.14 T5'in sadeleşmiş hâli; 12 Kas biçim): mod değişince (Business mode ↔ Developer mode) göz bir kez zıplayıp kırpar (az harekette
// yalnız kırpma), biçim kırpmanın kapalı anında Pamuk ↔ Odak takas edilir (beyin.ts sekilDegisti), küçük parıltının rengi 280 ms'de çapraz solar. Bebek ve
// kapak 480 ms içinde yeni biçimin duruşuna varır: ardından takılan canlı göz sıçramaz. Göz ilk karede eski kiple çizilir,
// bir sonraki karede yeni kipe geçer: CSS geçişi oynar. Bitince bir kez `bitti` (çağıran taraf canlı gözüne döner); eski ya da yeni değişirse
// (yarıda kesilen geçiş) ya da bileşen sökülürse çağırmaz. Döngü yok: tek `setTimeout`, göz durağan.
// Sade'de (renderer/karakter-gorunum.ts) göz yok: iki nötr işaret üst üste, eskisi söner yenisi belirir (SadeModGecisi, sade.css; değişmedi).
import { useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import type { KipKimligi } from '../../../shared/karakterler';
import { Gozler } from './Gozler';
import { SadeIsaret } from './SadeIsaret';
import { useKarakterGorunur } from '../../karakter-gorunum';
import { ZIPLA_SURE } from './geometri';

/** Geçişin süresi (zıplama; parıltı 280 ms'de solar). */
export const MOD_GECISI_MS = ZIPLA_SURE;
/** Az harekette ve Sade'de çapraz solma süresi. */
export const MOD_GECISI_AZ_MS = 240;

export interface ModGecisiOzellikleri {
  eski: KipKimligi;
  yeni: KipKimligi;
  /** CSS piksel (Gozler ile aynı anlam). */
  boyut: number;
  bitti?: () => void;
  /** Eski Karakter'den kalma: gözde yok sayılır. */
  poz?: string;
  azHareket?: boolean;
  kesit?: 'kare' | 'centik';
}

const sistemAzMi = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function ModGecisi(o: ModGecisiOzellikleri): ReactElement {
  const gorunur = useKarakterGorunur();
  return gorunur ? <GozluModGecisi {...o} /> : <SadeModGecisi {...o} />;
}

function useBitis(eski: KipKimligi, yeni: KipKimligi, ms: number, bitti?: () => void): void {
  const sonBitti = useRef(bitti);
  sonBitti.current = bitti;
  useLayoutEffect(() => {
    const z = setTimeout(() => sonBitti.current?.(), ms);
    return () => clearTimeout(z);
  }, [eski, yeni, ms]);
}

function GozluModGecisi({ eski, yeni, boyut, bitti, azHareket = false, kesit }: ModGecisiOzellikleri): ReactElement {
  const [kip, setKip] = useState(eski);
  // Bir sonraki karede yeni kip: parıltı çapraz solar, Gozler kip değişiminde zıplayıp kırpar.
  useLayoutEffect(() => {
    setKip(eski);
    const r = requestAnimationFrame(() => setKip(yeni));
    return () => cancelAnimationFrame(r);
  }, [eski, yeni]);
  // Az harekette de 480 ms: zıplama yok ama mod kırpması (120 ms sonra, 320 ms) ve kapalı anda biçim takası bu sürenin içinde biter (12 Kas).
  useBitis(eski, yeni, MOD_GECISI_MS, bitti);
  return (
    <span className="mod-gecisi" data-mod-gecisi={`${eski}>${yeni}`} data-az-hareket={azHareket ? '' : undefined}>
      <Gozler kip={kip} boyut={boyut} azHareket={azHareket} kesit={kesit} devir />
    </span>
  );
}

/** Sade'de mod geçişi: iki nötr işaret üst üste, eskisi söner yenisi belirir (240 ms; az harekette ya da prefers-reduced-motion'da anında). */
function SadeModGecisi({ eski, yeni, boyut, bitti, azHareket = false }: ModGecisiOzellikleri): ReactElement {
  useBitis(eski, yeni, azHareket || sistemAzMi() ? 0 : MOD_GECISI_AZ_MS, bitti);
  const anahtar = `${eski}>${yeni}`;
  return (
    <div className="mod-gecisi mod-gecisi--sade" data-mod-gecisi={anahtar} data-az-hareket={azHareket ? '' : undefined}
      style={{ width: boyut, height: boyut, ['--sade-gecis' as string]: `${MOD_GECISI_AZ_MS}ms` }}>
      <div key={`yeni-${anahtar}`} data-gecis="yeni"><SadeIsaret kip={yeni} boyut={boyut} azHareket={azHareket} /></div>
      <div key={`eski-${anahtar}`} data-gecis="eski"><SadeIsaret kip={eski} boyut={boyut} azHareket={azHareket} /></div>
    </div>
  );
}
