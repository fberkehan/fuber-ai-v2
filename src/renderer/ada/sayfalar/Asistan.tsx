// ── Panelin Asistan sayfası (0.14 T23; R13) ───────────────────────────────────────────────────────────────────────────────────────────────
// Solda gözler (11 Kas "Pamuk"; 96 px × ölçek — ölçek kökteki zoom'dan; iki modda aynı göz, parıltı kipin renginde); Sade modda aynı kutuda kipin vurgu
// renkli nötr işareti (GorunenGoz → SadeIsaret). Sağda ad ("Fuber"), "Nasıl yardımcı olabilirim?" (selamMetni, uygulamanın dili), yazı alanı ve
// mikrofon (mikrofon tamamen kapalıysa yok), altta son yanıtın iki satırı. Gönderince adanın bugünkü yolu: "Düşünüyorum…", sonra `yanit` hâli.
// Tıklama (R13 tarifi): gözler selam verir (kısa gülümseme ve zıplama) — gözün `tetik` özelliğiyle (sapka.no; svg'nin kendi pointerdown'u kapalı —
// disTiklama: çentik penceresi tıklamayı yutabilir) — ve ardından "nasıl yardımcı olabilirim" hâline geçer (dinliyor; son girdiden TIK_DINLEME_MS sonra sakine
// döner, tek setTimeout). Yazı alanı odakta. Mod değişince (Business ↔ Developer) göz aynı kalır, parıltının rengi çapraz solar (ModGecisi). İmleç izlenir.
// Ses yok: sayfa açılırken hiçbir şey seslendirilmez, dinleme başlamaz.
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Ikon } from '../../bilesenler/Ikon';
import { GorunenGoz, ModGecisi } from '../../ui/goz';
import { useKarakterGorunur } from '../../karakter-gorunum';
import { PANEL_TIKLAMA, selamMetni, tiklamaTazeMi } from '../../../shared/ada';
import { TIK_DINLEME_MS, type GozTetigi } from '../../../shared/goz';
// 11 Kas (tasarımcı bulgu 21): yazı alanı üstteki adla konuşur ("Fuber’e sor…").
import { yonelmeHali } from '../../../shared/isler';
import { useAdaBaglami } from '../useAsistan';

/** Gözlerin kutusu (CSS px, ölçek 1; R13). */
const KARAKTER_PX = 96;
/** Selamın süresi (gülümseme ve zıplama): bitince yardım hâli. */
const SAPKA_DON_MS = 520;
/** Markdown işaretleri ve atıflar iki satırlık önizlemede görünmez. */
const duz = (m: string) => m.replace(/\[(H|M|D|N|G|R)-\d+[^\]]*\]/g, '').replace(/[*_#`>]/g, '').replace(/\s+/g, ' ').trim();

export function Asistan(): ReactElement {
  const { a, azHareket, kipi, gecisBitti } = useAdaBaglami();
  // Sade modda ModGecisi kendisi SadeModGecisi çizer; kanca burada da okunur (karakter çizen her dosya ona bakar: tests/karakter-gorunum.test.ts).
  const karakterGorunur = useKarakterGorunur();
  const { taslak, setTaslak } = a;
  const soru = selamMetni(a.dil);
  // Düzeltme turu 1: tıklama paneli de açtığından sayfa çoğu kez tıklamayla aynı anda takılır; hareket kancası takılmadaki tetik numarasını görülmüş sayar.
  // Bu yüzden ilk karede tetik YOK; takıldıktan sonraki etkide tıklama tazeyse (≤ 300 ms) tetik verilir — ilk tıklamada da şapka döner. Hover'la sonradan
  // takılan sayfa eski tıklamanın şapkasını döndürmez.
  const [tetik, setTetik] = useState<{ ad: GozTetigi; no: number } | undefined>(undefined);
  // Tıklamanın "nasıl yardımcı olabilirim" hâli: selamdan sonra dinliyor; son girdiden TIK_DINLEME_MS sonra (ya da panel kapanınca) sakin.
  const [yardim, setYardim] = useState(false);
  useEffect(() => {
    if (tiklamaTazeMi(a.sapka, Date.now())) setTetik({ ad: PANEL_TIKLAMA.tetik, no: a.sapka.no });
    else return;
    const z = setTimeout(() => setYardim(true), azHareket || !karakterGorunur ? 0 : SAPKA_DON_MS);
    return () => clearTimeout(z);
  }, [a.sapka.no]);
  useEffect(() => {
    if (!yardim) return;
    const z = setTimeout(() => setYardim(false), TIK_DINLEME_MS);
    return () => clearTimeout(z);
  }, [yardim, taslak]);
  useEffect(() => { if (!a.panelAcik) setYardim(false); }, [a.panelAcik]);
  // Tıklama (ya da ana sürecin açtırması) yazı alanına klavye odağı verir; yalnız o anda (sonraki çizimler odağı geri çalmaz).
  const yazi = useRef<HTMLInputElement>(null);
  useEffect(() => { if (a.panelAcik) yazi.current?.focus(); }, [a.panelAcik, a.sapka.no]);
  const gonder = () => { if (!taslak.trim()) return; void a.gonder(taslak, false); setTaslak(''); };
  return (
    <div className="asistan-sayfa">
      <button type="button" className="asistan-sayfa__karakter" onClick={a.panelTikla} aria-label={`${a.karakterAdi}: ${soru}`} tabIndex={-1}>
        {kipi.gecis
          ? <ModGecisi eski={kipi.gecis.eski} yeni={kipi.gecis.yeni} boyut={KARAKTER_PX} azHareket={azHareket} bitti={gecisBitti} />
          : <GorunenGoz kip={kipi.gorunen} boyut={KARAKTER_PX} hal={yardim ? 'dinliyor' : 'sakin'} azHareket={azHareket} tetik={tetik} disTiklama />}
      </button>
      <div className="asistan-sayfa__sag">
        <span className="asistan-sayfa__ad" title={a.karakterAdi}>{a.karakterAdi}</span>
        <span className="asistan-sayfa__soru">{soru}</span>
        <div className="asistan-sayfa__yazi">
          <input
            data-panel-yazi="" value={taslak} placeholder={`${yonelmeHali(a.karakterAdi || 'Fuber')} sor…`} aria-label={`${yonelmeHali(a.karakterAdi || 'Fuber')} sor`} spellCheck={false}
            ref={yazi} autoFocus={a.panelAcik}
            onChange={(e) => setTaslak(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') gonder(); }}
            onMouseDown={() => { if (!a.panelAcik) a.panelTikla(); }}
            onBlur={a.panelYaziBirakildi}
          />
          {taslak.trim() || a.mikrofonKapali
            ? <button type="button" className="dgm dgm--beyaz dgm--simge ada__yuvarlak" title="Gönder (Enter)" aria-label="Gönder" disabled={!taslak.trim()} onClick={gonder}><Ikon ad="gonder" olcu={16} kalinlik={2} /></button>
            : <button type="button" className="dgm dgm--koyu dgm--simge ada__yuvarlak" title="Sesle sor" aria-label="Sesle sor" onClick={a.selamdanDinle}><Ikon ad="mikrofon" olcu={16} /></button>}
        </div>
        {a.sonYanit && <p className="asistan-sayfa__son" title={duz(a.sonYanit)}>{duz(a.sonYanit)}</p>}
      </div>
    </div>
  );
}
