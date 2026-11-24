// "Tümü" levhası (0.11 G5): kokpit kartında sığmayan kayıtların TAMAMI. Kartta kaydırma çubuğu yok (spec §4) — kart sığanı gösterir,
// başlığındaki "Tümü" bu levhayı açar: aynı satırlar, aynı eylemler (haber açılır, hatırlatıcı tamamlanır, yapılacak işaretlenir…),
// hiçbir kayıt erişilemez kalmaz (G4 denetleyici eki). Pencerenin üstünde levha (aria-modal): odak levhada kalır (Tab döngüsü), Esc ve
// perdeye tıklama kapatır, kapanınca odak "Tümü" düğmesine döner. Liste uzunsa levhanın kendisi kayar (kart değildir).
// Düzeltme turu 1 (K2): odaktaki satır levhadan kalkınca (✓ tamamlandı, öneri kapatıldı) odak kaybolmaz — bir sonraki satırın aynı
// öğesine, o yoksa bir öncekine, liste boşaldıysa Kapat'a geçer; odak bir şekilde dışarıda kalsa da Tab/Shift+Tab levhaya döner.
// "Tümü" düğmesi kapanışta yoksa (kalanlar karta sığdı) odak aynı kartın ilk denetimine döner.
import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Dugme } from '../ui';
import { sayiBicim } from '../ui/bicim';

const ODAKLANIR = 'button:not(:disabled), [href], [tabindex="0"]';

export function TumuLevhasi({ baslik, alt, kapat, children }: { baslik: string; alt?: string; kapat: () => void; children: ReactNode }) {
  const id = useId();
  const levha = useRef<HTMLDivElement>(null);
  const kapatRef = useRef(kapat);
  kapatRef.current = kapat;
  useEffect(() => {
    const once = document.activeElement as HTMLElement | null;
    const kart = once?.closest<HTMLElement>('[data-kart]')?.dataset.kart;
    const kok = levha.current;
    const odaklanabilir = () => [...(kok?.querySelectorAll<HTMLElement>(ODAKLANIR) ?? [])];
    requestAnimationFrame(() => {
      if (kok?.contains(document.activeElement)) return;
      // İlk kayıt (kapat düğmesi değil): klavyeyle hemen listede gezilir.
      (kok?.querySelector<HTMLElement>('.tumu__govde button, .tumu__govde [tabindex="0"]') ?? odaklanabilir()[0])?.focus({ preventScroll: true });
    });
    // Odak aldığı anda levhanın odaklanabilirleri ve odaktakinin sırası: odaktaki öğe (satırıyla) kalkarsa, ondan SONRA gelip hâlâ
    // belgede olan ilk öğenin satırı (bir sonraki satır), yoksa ondan önceki son öğenin satırı (bir önceki satır) seçilir ve odak o
    // satırda kalkanla aynı türdeki denetime (✓ → ✓, Kapat → Kapat; yoksa satırın ilk denetimi) geçer; satır kalmadıysa levhanın Kapat'ı.
    // Sıra numarası değil öğenin kendisi: kalkan satırda birden çok odaklanabilir varsa (kırpılmış başlık + ✓) satır atlanmaz.
    let anlik: HTMLElement[] = [];
    let son = -1;
    const odakGeldi = (e: FocusEvent) => { const l = odaklanabilir(); const i = l.indexOf(e.target as HTMLElement); if (i >= 0) { anlik = l; son = i; } };
    kok?.addEventListener('focusin', odakGeldi);
    const onar = new MutationObserver(() => {
      const a = document.activeElement;
      if (!kok || (a && a !== document.body && a.isConnected)) return; // odak yerinde (ya da bilerek başka yerde)
      const yerinde = (e: HTMLElement) => e.isConnected && kok.contains(e);
      const kalkan = anlik[son];
      const komsu = anlik.slice(son + 1).find(yerinde) ?? anlik.slice(0, Math.max(0, son)).reverse().find(yerinde);
      const satir = komsu?.closest<HTMLElement>('.tumu__govde li');
      const ayni = kalkan && satir
        ? [...satir.querySelectorAll<HTMLElement>(ODAKLANIR)].find((e) => e.tagName === kalkan.tagName && e.getAttribute('aria-label') === kalkan.getAttribute('aria-label'))
        : undefined;
      (ayni ?? (satir?.querySelector<HTMLElement>(ODAKLANIR) || komsu) ?? odaklanabilir()[0])?.focus({ preventScroll: false });
    });
    if (kok) onar.observe(kok, { childList: true, subtree: true });
    const tus = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); kapatRef.current(); return; }
      if (e.key !== 'Tab') return;
      const l = odaklanabilir();
      if (!l.length) return;
      // Odak levhanın dışındaysa (kalkan öğeden sonra belge gövdesinde) Tab levhaya döner, perdenin arkasına geçmez.
      if (!kok?.contains(document.activeElement)) { e.preventDefault(); (e.shiftKey ? l[l.length - 1] : l[0]).focus(); return; }
      const i = l.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); l[l.length - 1].focus(); } else if (!e.shiftKey && i === l.length - 1) { e.preventDefault(); l[0].focus(); }
    };
    addEventListener('keydown', tus, true);
    return () => {
      removeEventListener('keydown', tus, true);
      kok?.removeEventListener('focusin', odakGeldi);
      onar.disconnect();
      if (once?.isConnected) { once.focus({ preventScroll: true }); return; }
      // "Tümü" kalktıysa (her şey artık karta sığıyor): aynı kartın ilk denetimi.
      const k = kart ? document.querySelector<HTMLElement>(`.izgara > [data-kart="${kart}"]`) : null;
      k?.querySelector<HTMLElement>(ODAKLANIR)?.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div className="tumu" data-tumu-levhasi="">
      <div className="tumu__perde" onClick={() => kapatRef.current()} aria-hidden="true" />
      <div ref={levha} className="tumu__levha" role="dialog" aria-modal="true" aria-labelledby={id}>
        <header className="tumu__bas">
          <div className="tumu__baslik">
            <h2 id={id}>{baslik}</h2>
            {alt && <p>{alt}</p>}
          </div>
          <Dugme tur="hayalet" boyut="k" simge="kapat" aria-label="Kapat" title="Kapat (Esc)" onClick={() => kapatRef.current()} />
        </header>
        <div className="tumu__govde">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** Kartın başlığındaki "Tümü" düğmesi (levhayı açar; önizleme data-tumu-ac ile bulur). */
export function TumuDugmesi({ etiket, ac }: { etiket: string; ac: () => void }) {
  return <Dugme tur="hayalet" boyut="k" data-tumu-ac="" onClick={ac}>{etiket}</Dugme>;
}

/** Kartın "Tümü" eylemi ve levhanın açık/kapalı hâli. `toplam` etikete yazılır ("Tümü · 12"); gizli kayıt yoksa eylem yok. */
export function useTumu(toplam: number, gizli: number): { acik: boolean; kapat: () => void; eylem: ReactElement | undefined } {
  const [acik, setAcik] = useState(false);
  return {
    acik,
    kapat: () => setAcik(false),
    eylem: gizli > 0 ? <TumuDugmesi etiket={`Tümü · ${sayiBicim(toplam)}`} ac={() => setAcik(true)} /> : undefined,
  };
}
