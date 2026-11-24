// ── Seçici: yerel <select> yerine ortak açılır liste ──────────────────────────────────────────────────────────────────
// Yerleşik açılır listeler yetersizdi. Tetik düğmesi + gövdeye çizilen (portal) panel: kartların `overflow: hidden`ına takılmaz,
// tetiğin altında açılır (aşağıda yer yoksa üstünde), kaydırma ve pencere boyutu değişince izler. 8+ seçenekte (ya da `ara`)
// üstte arama kutusu (Türkçe harf katlamalı: "gorunum" → "Görünüm"); `serbest` listede olmayan değeri de kabul eder (ör. OpenRouter
// model kimliği). Seçenek: etiket + isteğe bağlı açıklama ve rozet; devre dışı seçenek görünür ama seçilmez.
// Klavye (WAI-ARIA combobox + listbox): kapalıyken ↓/↑/Enter/Boşluk açar, harf ilk eşleşene gider; açıkken ↑/↓, Home/End,
// PageUp/PageDown gezinir, Enter seçer, Esc değiştirmeden kapatır (tetiğe döner), Tab kapatır. Klavyeyle açılınca canlandırma
// yok (sık tekrarlanan eylem); fareyle açılınca 150 ms, tetikten doğru.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as TusOlayi } from 'react';
import { createPortal } from 'react-dom';
import { Ikon } from './Ikon';
import { katla } from '../../shared/ayar-arama';
import './secici.css';

export interface SeciciSecenegi<T extends string | number = string> {
  deger: T;
  etiket: string;
  aciklama?: string;
  /** Sağda küçük hap ("önerilen", "anahtar yok"). */
  rozet?: string;
  devreDisi?: boolean;
}

export interface SeciciOzellikleri<T extends string | number> {
  deger: T;
  secenekler: readonly SeciciSecenegi<T>[];
  degistir: (deger: T) => void;
  /** Ekran okuyucu adı (görünen etiket ayrıca yazılır). */
  etiket: string;
  /** Tetik genişliği (px ya da CSS); verilmezse içeriğe göre (en az 150 px). */
  genislik?: number | string;
  /** Arama kutusu; verilmezse 8 ve daha çok seçenekte açılır. */
  ara?: boolean;
  /** Listede olmayan değer yazılabilir: aramada "“…” kullan" satırı (yalnız metin değerler). */
  serbest?: boolean;
  devreDisi?: boolean;
  /** Değer listede yoksa (ve serbest değilse) tetikte görünen yazı. */
  yerTutucu?: string;
  /** Panel açılırken (ör. listeyi tembel yüklemek için). */
  acilinca?: () => void;
  title?: string;
  className?: string;
  id?: string;
}

type Satir<T extends string | number> = { tur: 'secenek'; s: SeciciSecenegi<T> } | { tur: 'ozel'; deger: string };
interface Konum { sol: number; en: number; ust?: number; alt?: number; enCokBoy: number; yon: 'alt' | 'ust' }

const ARAMA_ESIGI = 8;
const PANEL_EN_AZ = 220;
const PANEL_EN_COK_BOY = 360;
const PAY = 8;

export function Secici<T extends string | number>({
  deger, secenekler, degistir, etiket, genislik, ara, serbest, devreDisi, yerTutucu, acilinca, title, className, id,
}: SeciciOzellikleri<T>) {
  const taban = useId();
  const listeId = `${taban}-liste`;
  const tetik = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const aramaKutusu = useRef<HTMLInputElement>(null);
  const [acik, setAcik] = useState(false);
  const [klavyeyle, setKlavyeyle] = useState(false);
  const [sorgu, setSorgu] = useState('');
  const [aktif, setAktif] = useState(-1);
  const [konum, setKonum] = useState<Konum | null>(null);
  const aramali = ara ?? secenekler.length >= ARAMA_ESIGI;
  const secili = secenekler.find((s) => s.deger === deger);

  const satirlar = useMemo<Satir<T>[]>(() => {
    const sozler = katla(sorgu).split(' ').filter(Boolean);
    const l: Satir<T>[] = secenekler
      .filter((s) => !sozler.length || sozler.every((x) => katla(`${s.etiket} ${s.aciklama ?? ''} ${s.rozet ?? ''} ${s.deger}`).includes(x)))
      .map((s) => ({ tur: 'secenek', s }));
    const yazilan = sorgu.trim();
    if (serbest && yazilan && !secenekler.some((s) => String(s.deger) === yazilan)) l.push({ tur: 'ozel', deger: yazilan });
    return l;
  }, [secenekler, sorgu, serbest]);
  const secilebilir = (i: number) => { const r = satirlar[i]; return Boolean(r) && (r.tur === 'ozel' || !r.s.devreDisi); };
  const satirId = (i: number) => `${taban}-s${i}`;

  const ac = (klavye: boolean, ilkHarf?: string) => {
    if (devreDisi) return;
    setKlavyeyle(klavye);
    setSorgu(aramali && ilkHarf ? ilkHarf : '');
    const i = secenekler.findIndex((s) => s.deger === deger && !s.devreDisi);
    setAktif(i >= 0 ? i : secenekler.findIndex((s) => !s.devreDisi));
    setAcik(true);
    acilinca?.();
  };
  const kapat = (odakGeri = true) => {
    setAcik(false);
    setKonum(null);
    if (odakGeri) tetik.current?.focus({ preventScroll: true });
  };
  const sec = (i: number) => {
    const r = satirlar[i];
    if (!r || !secilebilir(i)) return;
    const yeni = (r.tur === 'ozel' ? r.deger : r.s.deger) as T;
    kapat();
    if (yeni !== deger) degistir(yeni);
  };
  /** Etkin satırı `adim` kadar kaydırır; devre dışıları atlar, uçlarda durur. */
  const kaydir = (adim: number) => {
    if (!satirlar.length) return;
    const yon = Math.sign(adim) || 1;
    let i = aktif < 0 ? (yon > 0 ? -1 : satirlar.length) : aktif;
    let kalan = Math.abs(adim);
    let son = aktif;
    while (kalan > 0) {
      i += yon;
      if (i < 0 || i >= satirlar.length) break;
      if (secilebilir(i)) { son = i; kalan--; }
    }
    if (son !== aktif && son >= 0) setAktif(son);
  };
  const uca = (bas: boolean) => {
    const sira = satirlar.map((_, i) => i);
    const i = (bas ? sira : sira.reverse()).find(secilebilir);
    if (i !== undefined) setAktif(i);
  };
  /** Aramasız listede harfle atlama: etkin satırdan sonra adı o harfle başlayan ilk seçenek. */
  const harfleAtla = (h: string) => {
    const k = katla(h);
    if (!k.trim()) return;
    for (let n = 1; n <= satirlar.length; n++) {
      const i = (Math.max(aktif, 0) + n) % satirlar.length;
      const r = satirlar[i];
      if (r.tur === 'secenek' && !r.s.devreDisi && katla(r.s.etiket).trimStart().startsWith(k)) { setAktif(i); return; }
    }
  };

  const tus = (e: TusOlayi) => {
    const harf = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (!acik) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); ac(true); }
      else if (harf) { e.preventDefault(); ac(true, e.key); if (!aramali) requestAnimationFrame(() => harfleAtla(e.key)); }
      return;
    }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); kaydir(1); break;
      case 'ArrowUp': e.preventDefault(); if (e.altKey) sec(aktif); else kaydir(-1); break;
      case 'PageDown': e.preventDefault(); kaydir(8); break;
      case 'PageUp': e.preventDefault(); kaydir(-8); break;
      case 'Home': if (!aramali) { e.preventDefault(); uca(true); } break;
      case 'End': if (!aramali) { e.preventDefault(); uca(false); } break;
      case 'Enter': e.preventDefault(); sec(aktif); break;
      case ' ': if (!aramali) { e.preventDefault(); sec(aktif); } break;
      // Esc yalnız seçiciyi kapatır: üstteki katmana (kurulum sihirbazı, arama) ulaşmasın.
      case 'Escape': e.preventDefault(); e.stopPropagation(); kapat(); break;
      // Odak önce tetiğe (aramalıda arama kutusu gövdenin sonundaki panelde): Tab'ın varsayılan işi sırayı tetikten sürdürür.
      case 'Tab': tetik.current?.focus({ preventScroll: true }); kapat(false); break;
      default: if (harf && !aramali) harfleAtla(e.key);
    }
  };

  // Arama değişince etkin satır ilk seçilebilire döner; arama boşalınca (yeniden açılış dahil) geçerli değere.
  useEffect(() => {
    if (!acik || !aramali) return;
    const mevcut = sorgu.trim() ? -1 : satirlar.findIndex((r) => r.tur === 'secenek' && r.s.deger === deger && !r.s.devreDisi);
    setAktif(mevcut >= 0 ? mevcut : satirlar.findIndex((_, n) => secilebilir(n)));
  }, [sorgu, acik]); // eslint-disable-line react-hooks/exhaustive-deps

  // Konum: tetiğin altı (yer yoksa üstü); pencere boyutu ve herhangi bir kaydırmada (panelin kendi listesi hariç) izler.
  useLayoutEffect(() => {
    if (!acik) return;
    const olc = () => {
      const r = tetik.current?.getBoundingClientRect();
      if (!r) return;
      if (r.bottom < 0 || r.top > innerHeight) { kapat(false); return; }
      const en = Math.min(Math.max(r.width, PANEL_EN_AZ), innerWidth - 2 * PAY);
      // Panel tetikten genişse: sağ yarıdaki tetikte sağ kenarlar hizalanır (kartın dışına taşmasın), solda sol kenarlar.
      const hiza = en > r.width + 1 && r.left + r.width / 2 > innerWidth / 2 ? r.right - en : r.left;
      const sol = Math.max(PAY, Math.min(hiza, innerWidth - en - PAY));
      const tahmini = Math.min(PANEL_EN_COK_BOY, satirlar.length * 40 + (aramali ? 48 : 0) + 14);
      const asagi = innerHeight - r.bottom - PAY - 6;
      const yukari = r.top - PAY - 6;
      const yon: Konum['yon'] = asagi >= tahmini || asagi >= yukari ? 'alt' : 'ust';
      const enCokBoy = Math.max(120, Math.min(PANEL_EN_COK_BOY, yon === 'alt' ? asagi : yukari));
      setKonum(yon === 'alt' ? { sol, en, ust: r.bottom + 6, enCokBoy, yon } : { sol, en, alt: innerHeight - r.top + 6, enCokBoy, yon });
    };
    olc();
    const kaydirmada = (e: Event) => { if (!panel.current?.contains(e.target as Node)) olc(); };
    addEventListener('resize', olc);
    addEventListener('scroll', kaydirmada, true);
    return () => { removeEventListener('resize', olc); removeEventListener('scroll', kaydirmada, true); };
  }, [acik, satirlar.length, aramali]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dışarı tıklama ve pencereden çıkış kapatır; aramalıda odak arama kutusuna.
  useEffect(() => {
    if (!acik) return;
    const disari = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !tetik.current?.contains(t)) kapat(false);
    };
    const bulanik = () => kapat(false);
    document.addEventListener('pointerdown', disari, true);
    addEventListener('blur', bulanik);
    if (aramali) requestAnimationFrame(() => aramaKutusu.current?.focus({ preventScroll: true }));
    return () => { document.removeEventListener('pointerdown', disari, true); removeEventListener('blur', bulanik); };
  }, [acik]); // eslint-disable-line react-hooks/exhaustive-deps

  // Etkin satır görünür kalsın.
  useEffect(() => {
    if (acik && aktif >= 0) document.getElementById(satirId(aktif))?.scrollIntoView({ block: 'nearest' });
  }, [acik, aktif, konum]); // eslint-disable-line react-hooks/exhaustive-deps

  const gorunen = secili?.etiket ?? (serbest && deger !== '' ? String(deger) : '');
  const etkinId = acik && aktif >= 0 ? satirId(aktif) : undefined;
  const stil: CSSProperties = genislik !== undefined ? { width: genislik } : {};

  return (
    <>
      <button
        ref={tetik} id={id} type="button" className={`secici${className ? ` ${className}` : ''}`} style={stil} title={title}
        role="combobox" aria-haspopup="listbox" aria-expanded={acik} aria-controls={acik ? listeId : undefined} aria-label={etiket}
        aria-activedescendant={!aramali ? etkinId : undefined} disabled={devreDisi}
        onClick={() => (acik ? kapat() : ac(false))} onKeyDown={tus}
      >
        <span className={`secici__deger${gorunen ? '' : ' secici__deger--bos'}`}>{gorunen || yerTutucu || 'Seç'}</span>
        <Ikon ad="asagi" olcu={15} className="secici__ok" />
      </button>
      {acik && createPortal(
        <div
          ref={panel} className="secici__panel" data-yon={konum?.yon ?? 'alt'} data-klavye={klavyeyle ? '' : undefined}
          style={konum ? { left: konum.sol, width: konum.en, top: konum.ust, bottom: konum.alt, maxHeight: konum.enCokBoy } : { visibility: 'hidden', left: 0, top: 0 }}
        >
          {aramali && (
            <div className="secici__ara">
              <Ikon ad="ara" olcu={15} />
              <input
                ref={aramaKutusu} value={sorgu} onChange={(e) => setSorgu(e.target.value)} onKeyDown={tus} placeholder={serbest ? 'Ara ya da kimlik yaz' : 'Ara'}
                role="combobox" aria-expanded="true" aria-controls={listeId} aria-autocomplete="list" aria-activedescendant={etkinId} aria-label={`${etiket}: ara`}
              />
            </div>
          )}
          <ul className="secici__liste" id={listeId} role="listbox" aria-label={etiket}>
            {satirlar.map((r, i) => {
              const ozel = r.tur === 'ozel';
              const s = ozel ? null : r.s;
              const seciliMi = !ozel && s!.deger === deger;
              return (
                <li
                  key={ozel ? '__ozel' : String(s!.deger)} id={satirId(i)} role="option" aria-selected={seciliMi} aria-disabled={!ozel && s!.devreDisi ? true : undefined}
                  className="secici__secenek" data-aktif={i === aktif ? '' : undefined}
                  onPointerMove={() => { if (i !== aktif && secilebilir(i)) setAktif(i); }}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => sec(i)}
                >
                  <span className="secici__metin">
                    <span className="secici__etiket">{ozel ? `“${r.deger}” kullan` : s!.etiket}</span>
                    {(ozel || s!.aciklama) && <span className="secici__aciklama">{ozel ? 'Listede yok; bu kimlik olduğu gibi kullanılır.' : s!.aciklama}</span>}
                  </span>
                  {!ozel && s!.rozet ? <span className="secici__rozet">{s!.rozet}</span> : <span />}
                  <span className="secici__isaret" aria-hidden="true">{seciliMi && <Ikon ad="tamam" olcu={15} />}</span>
                </li>
              );
            })}
            {!satirlar.length && <li className="secici__bos" role="presentation">Eşleşen yok.</li>}
          </ul>
        </div>,
        document.body,
      )}
    </>
  );
}
