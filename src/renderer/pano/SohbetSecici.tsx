// ── Kokpit sohbet seçici (0.11 G7) ─────────────────────────────────────────────────────────────────────────────────────────────────
// Ana sayfadaki sohbetler: yeni sohbete ve önceki sohbetlere ana sayfadan erişilebilir (eskiden ana sayfada
// tek sohbet kalıyordu). Kokpitin sağındaki sohbet panelinin BAŞLIĞI: [geçerli başlık ▾] [Yeni sohbet] [Tümü].
//  · Başlık açılır liste (WAI-ARIA listbox; fareyle ve klavyeyle): Ana sohbet (her zaman ilk; okunmamış rozeti) + son 8 sohbet (başlık,
//    önizleme, göreli zaman, okunmamış rozeti). Seçim paneldeki sohbeti değiştirir. "Tüm sohbetler" (Sohbetler sayfası) bir seçenek DEĞİL,
//    listbox'ın dışında ayrı bir düğmedir (eylem; seçilebilir değil): ok tuşları yalnız seçenekleri gezer, düğmeye Tab ile geçilir.
//    Klavye: tetikte ↓/↑ açar; listede ↑/↓/Home/End gezinir (sarar), Enter seçer, Esc kapatır (odak tetiğe döner); Tab seçenekten "Tüm
//    sohbetler"e, oradan listeyi kapatıp tetikten devam eder (Shift+Tab geri); dışarı tıklama kapatır.
//  · "Yeni sohbet" taslağı açar: kayıt ilk mesajda oluşur (Sohbetler sayfasıyla aynı yol); boş bırakılan taslak iz bırakmaz.
//  · Başka sohbetteyken ana sohbete kendiliğinden mesaj gelirse başlığın altında "Ana sohbette N yeni mesaj" çipi (N gerçek sayı; sayı
//    ve "okunmuş" kuralı shared/kokpit-sohbet.ts anaYeniSayisi, liste bayatlığı useKokpitSohbet.ts'te çözülür).
//  · Bu bir başlık şeridi: Sohbet'in `ust` yuvasına konur (eski "Fuber" başlığının yerine), üstteki sürükleme bölgesini ve iç boşluğu
//    (.sohbet__ust) korur; denetimler `surukleme` (sürüklenemez). Etkinlik hapı (düşünüyor/dinliyor/konuşuyor) başlık satırında, yalnız
//    etkinlikte: yatay yer alır, dikey kaydırma yapmaz (mesaj listesi tur başında/sonunda kaymaz); dar şeritte yalnız nokta, yazısı ekran
//    okuyucuya kalır.
//  · Tost şeridi (çentiğin altı, y 52…132) sütunun sol kenarına girer ve hiçbir denetimin üstüne binmemelidir (ozellik-denetimi tost-yerlesimi):
//    şeridin ve çip satırının denetimleri tost şeridinin sağından başlar (pano.css --tost-payi); dar sütunda "Yeni sohbet" yalnız simgedir.
// Kütüphane: Satir (seçenekler; `rol="option"`), Rozet, Dugme. Renkler yalnız belirteçlerden (pano.css).
import { useEffect, useId, useRef, useState, type KeyboardEvent as TusOlayi, type ReactNode } from 'react';
import { Dugme, Rozet, Satir, Ayrac } from '../ui';
import { kirpGerekli } from '../ui/bicim';
import { useKirpildi, useOdakIpucu } from '../ui/kirp';
import { zamanGoreli } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { acilirListe, anaYeniMesajMetni, anaYeniSayisi, secimBasligi, type KokpitSecimi } from '../../shared/kokpit-sohbet';
import { yeniSohbetKisayolu } from '../../shared/uygulama-kisayol';
import type { SohbetOzet } from '../../shared/tipler';

export interface SohbetSeciciOzellikleri {
  anaId: number | null;
  /** Hook'un listesi: açık sohbetin okunmamışı zaten 0'dır (useKokpitSohbet). */
  liste: readonly SohbetOzet[];
  secim: KokpitSecimi;
  sec: (id: number) => void;
  taslakAc: () => void;
  /** "Tümü" ve "Tüm sohbetler": Sohbetler sayfasına gider. */
  tumu: () => void;
  /** Liste açılırken tazelenir. */
  yenile: () => Promise<void>;
  /** Başlık satırında (düğmelerin solunda) gösterilecek etkinlik hapı; yalnız etkinlikte verilir. */
  durum?: ReactNode;
}

/** Seçeneğin sağ sütunu: göreli zaman (üstte) + okunmamış rozeti (altta). */
function Sag({ guncelleme, okunmamis }: { guncelleme: string; okunmamis: number }) {
  return (
    <span className="sohbet-secici__sag">
      {guncelleme && <span>{zamanGoreli(guncelleme)}</span>}
      {okunmamis > 0 && <Rozet ton="bilgi">{`${okunmamis} yeni`}</Rozet>}
    </span>
  );
}

export function SohbetSecici({ anaId, liste, secim, sec, taslakAc, tumu, yenile, durum }: SohbetSeciciOzellikleri) {
  const [acik, setAcik] = useState(false);
  const tetik = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const baslikRef = useRef<HTMLSpanElement>(null);
  const kimlik = useId();
  const listeKimligi = `${kimlik}-liste`;
  const mac = typeof window !== 'undefined' && window.fuber?.platform === 'darwin';

  const { ana: listedekiAna, son } = acilirListe(liste, anaId ?? -1);
  // Liste alınamadıysa bile ana sohbete dönülebilir (Ana sohbet her zaman ilk satırdır).
  const ana: SohbetOzet | null = listedekiAna ?? (anaId !== null ? { id: anaId, baslik: 'Fuber', tur: 'ana', guncelleme: '', okunmamis: 0 } : null);
  const anaMi = secim === null || (anaId !== null && secim === anaId);
  const baslik = secimBasligi(secim, { anaId, liste });
  const anaYeni = anaYeniSayisi({ secim, anaId, liste });

  // Başlık uzunsa tetikte … ile kesilir; tamamı `title`'da ve klavye odağında okunur (kütüphanenin kuralı, ui/kirp.tsx).
  const kesik = useKirpildi([baslikRef], kirpGerekli(baslik, 1, 22), baslik);
  const { olaylar: odakOlaylari, ipucu } = useOdakIpucu(kesik, baslik);

  const kapat = (odakDon = true) => { setAcik(false); if (odakDon) tetik.current?.focus({ preventScroll: true }); };
  const ac = () => { setAcik(true); void yenile(); };
  const git = (id: number) => { kapat(); if (id !== secim) sec(id); };
  const secenekler = () => [...(panel.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
  const tumuDugmesi = () => panel.current?.querySelector<HTMLElement>('[data-secici-tumu]') ?? null;

  // Açılınca odak seçili seçeneğe (yoksa ilkine); dışarı tıklayınca kapanır (odak tıklanan yerde kalır).
  useEffect(() => {
    if (!acik) return;
    const oge = panel.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]') ?? panel.current?.querySelector<HTMLElement>('[role="option"]');
    oge?.focus({ preventScroll: true });
    const disari = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !tetik.current?.contains(t)) kapat(false);
    };
    document.addEventListener('pointerdown', disari, true);
    return () => document.removeEventListener('pointerdown', disari, true);
  }, [acik]); // eslint-disable-line react-hooks/exhaustive-deps

  const tetikTusu = (e: TusOlayi<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!acik) ac(); }
    else if (e.key === 'Escape' && acik) { e.preventDefault(); e.stopPropagation(); kapat(); }
    else odakOlaylari.onKeyDown(e); // kırpılmış başlığın odak ipucunu Esc kapatır
  };
  // Capture: odaklı satırın kendi Esc işleyicisi (kırpılmış metin ipucunu kapatır) araya girmesin; Esc önce listeyi kapatır.
  const panelTusu = (e: TusOlayi<HTMLDivElement>) => {
    const ogeler = secenekler();
    const aktif = document.activeElement as HTMLElement | null;
    const i = aktif ? ogeler.indexOf(aktif) : -1;
    const tumudaMi = aktif !== null && aktif === tumuDugmesi();
    const odakla = (n: number) => { e.preventDefault(); ogeler[(n + ogeler.length) % ogeler.length]?.focus(); };
    switch (e.key) {
      case 'ArrowDown': odakla(tumudaMi ? 0 : i + 1); break;
      case 'ArrowUp': odakla(tumudaMi || i < 0 ? ogeler.length - 1 : i - 1); break;
      case 'Home': odakla(0); break;
      case 'End': odakla(ogeler.length - 1); break;
      case 'Escape': e.preventDefault(); e.stopPropagation(); kapat(); break;
      case 'Tab':
        if (!e.shiftKey && i >= 0) { e.preventDefault(); tumuDugmesi()?.focus(); } // seçenekten "Tüm sohbetler"e
        else if (e.shiftKey && tumudaMi) { e.preventDefault(); (ogeler.find((o) => o.getAttribute('aria-selected') === 'true') ?? ogeler[0])?.focus(); }
        else { tetik.current?.focus({ preventScroll: true }); setAcik(false); } // dışarı: odak önce tetiğe, Tab'ın varsayılan işi oradan sürer
        break;
    }
  };

  const satir = (s: SohbetOzet, anaSatiri = false) => (
    <Satir key={s.id} rol="option" aria-selected={anaSatiri ? anaMi : s.id === secim}
      data-sohbet-id={String(s.id)} data-ana={anaSatiri ? '' : undefined}
      sol={<Ikon ad={anaSatiri ? 'yildiz' : 'sohbet'} olcu={16} />} baslik={anaSatiri ? 'Ana sohbet' : s.baslik} alt={s.sonMesaj || undefined}
      sag={<Sag guncelleme={s.guncelleme} okunmamis={s.okunmamis ?? 0} />} tikla={() => git(s.id)} />
  );

  return (
    <div className="sohbet-secici" data-sohbet-secici="">
      <div className="sohbet__ust surukle sohbet-secici__ust">
        <button
          ref={tetik} type="button" className="sohbet-secici__tetik surukleme" data-secici-tetik=""
          aria-haspopup="listbox" aria-expanded={acik} aria-controls={acik ? listeKimligi : undefined} aria-label={`Sohbet: ${baslik}`} title={baslik}
          onClick={() => (acik ? kapat() : ac())} onKeyDown={tetikTusu} onFocus={odakOlaylari.onFocus} onBlur={odakOlaylari.onBlur}
        >
          <span ref={baslikRef} className="ui-kirp sohbet-secici__baslik" data-kirp="1">{baslik}</span>
          <Ikon ad="asagi" olcu={15} className="sohbet-secici__ok" />
        </button>
        {ipucu}
        {durum && <span className="sohbet-secici__durum surukleme" data-sohbet-durumu="">{durum}</span>}
        <Dugme tur="ikincil" boyut="k" simge="arti" className="surukleme sohbet-secici__yeni" data-sohbet-yeni="" aria-keyshortcuts={mac ? 'Meta+N' : 'Control+N'}
          aria-label="Yeni sohbet" title={`Yeni sohbet (${yeniSohbetKisayolu(mac)})`} onClick={() => { setAcik(false); taslakAc(); }}>Yeni sohbet</Dugme>
        <Dugme tur="hayalet" boyut="k" className="surukleme" data-sohbet-tumu="" title="Tüm sohbetler" onClick={tumu}>Tümü</Dugme>
        {acik && (
          <div ref={panel} className="sohbet-secici__panel surukleme" data-secici-panel="" onKeyDownCapture={panelTusu}>
            <div role="listbox" id={listeKimligi} aria-label="Sohbetler" className="sohbet-secici__liste">
              {ana && satir(ana, true)}
              {son.map((s) => satir(s))}
            </div>
            <Ayrac />
            <Dugme tur="hayalet" boyut="k" simge="liste" className="sohbet-secici__tumu" data-secici-tumu="" onClick={() => { kapat(false); tumu(); }}>Tüm sohbetler</Dugme>
          </div>
        )}
      </div>
      {anaYeni > 0 && ana && (
        <div className="sohbet-secici__serit surukleme">
          <Dugme tur="ikincil" boyut="k" className="sohbet-secici__cip" data-ana-yeni={String(anaYeni)} simge={<span className="nokta nokta--mavi" aria-hidden="true" />}
            onClick={() => git(ana.id)}>{anaYeniMesajMetni(anaYeni)}</Dugme>
        </div>
      )}
    </div>
  );
}
