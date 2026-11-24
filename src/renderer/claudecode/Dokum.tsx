// ── Sanallaştırılmış canlı döküm (Görev 28, K17) ────────────────────────────────────────────────────────────────────────────────
// Yalnız görünen pencere (+ pay) çizilir: üst ve alt boşluk ölçülmüş (ResizeObserver) ya da tahmini yüksekliklerin toplamıdır —
// 5 000 olaylık oturumda da DOM'da birkaç düzine öğe kalır. Tarayıcının kaydırma çapası (overflow-anchor) yukarıda ölçülen öğe
// büyüyünce görünen içeriği yerinde tutar. En alttayken (akış) her çizimde alta yapışır; kullanıcı yukarı kaydırınca yapışma
// bırakılır ve "En sona" düğmesi çıkar. Kaydırma YALNIZ bu kutuda (sayfa kaymaz).
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Ikon } from '../bilesenler/Ikon';
import { AcikBaglam, KatliGrupKarti, OgeCiz, tahminiBoy } from './Kartlar';
import { dokumKatla, gorunenSira, type GorunenOge } from './katla';
import { konumlar, gorunurAralik } from './yardimci';
import type { DokumOgesi } from './dokum-modeli';

const PAY = 900;

const Olcer = memo(function Olcer({ o, cwd, gozlemci }: { o: GorunenOge; cwd: string; gozlemci: ResizeObserver | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !gozlemci) return;
    gozlemci.observe(el);
    return () => gozlemci.unobserve(el);
  }, [gozlemci]);
  return <div ref={ref} className="cc-dokum__oge" data-anahtar={o.anahtar} data-tur={o.tur}>{o.tur === 'katli' ? <KatliGrupKarti g={o} cwd={cwd} /> : <OgeCiz o={o} cwd={cwd} />}</div>;
});

export function Dokum({ kimlik, ogeler: hamOgeler, cwd, ust, alt, yaziKutusu, hedef, izinGorunur }: {
  /** Oturum değişince kaydırma ve ölçüler sıfırlanır. */
  kimlik: string; ogeler: readonly DokumOgesi[]; cwd: string; ust?: ReactNode; alt?: ReactNode;
  /** "Göster": üst düzey öğeye kaydır, sonra isteğin GERÇEK kartına (iç içe alt ajanda da) kaydır ve odaklan (`no` her istekte artar). */
  hedef?: { anahtar: string; istekId: string; no: number } | null;
  /** Bekleyen bir izin kartı en az %60 görünür mü (görünürken "İzin bekleniyor · Göster" hapı gizlenir). */
  izinGorunur?: (gorunur: boolean) => void;
  /** Esc / "En sona" sonrası odak buraya dönebilir. */
  yaziKutusu?: () => void;
}) {
  // 11 Kas: art arda biten yardımcılar ve araç kartları tek katlı satıra iner (katla.ts); yalnız süren iş tam kartıyla görünür.
  const ogeler = useMemo(() => dokumKatla(hamOgeler), [hamOgeler]);
  const kap = useRef<HTMLDivElement>(null);
  const basBosluk = useRef<HTMLDivElement>(null);
  const boylar = useRef(new Map<string, number>());
  const acikHarita = useRef(new Map<string, boolean>());
  const [olcuSurum, setOlcuSurum] = useState(0);
  const [pencere, setPencere] = useState({ ust: 0, boy: 800 });
  const altta = useRef(true);
  const [alttaMi, setAlttaMi] = useState(true);
  const kare = useRef(0);
  /** Son kullanıcı kaydırma niyeti (tekerlek, dokunma, tuş, kaydırma çubuğu): yapışmayı yalnız kullanıcı bırakır — yerleşimin ya da
   *  pencere boyunun yol açtığı kaydırma "alttayım"ı bozmaz. */
  const niyet = useRef(0);
  const niyetVar = () => { niyet.current = performance.now(); };
  // Oturum değişince çağıran bileşeni `key={kimlik}` ile yeniden kurar: ölçüler, aç/kapa hâli ve kaydırma sıfırdan.
  void kimlik;

  const gozlemci = useMemo(() => (typeof ResizeObserver === 'function' ? new ResizeObserver((girdiler) => {
    let degisti = false;
    for (const g of girdiler) {
      const el = g.target as HTMLElement;
      const k = el.dataset.anahtar;
      if (!k) continue;
      const h = g.borderBoxSize?.[0]?.blockSize ?? el.offsetHeight;
      if (Math.abs((boylar.current.get(k) ?? -1) - h) > 0.5) { boylar.current.set(k, h); degisti = true; }
    }
    if (degisti) setOlcuSurum((n) => n + 1);
  }) : null), []);
  useEffect(() => () => gozlemci?.disconnect(), [gozlemci]);

  const ofs = useMemo(() => konumlar(ogeler.map((o) => boylar.current.get(o.anahtar) ?? (o.tur === 'katli' ? 38 : tahminiBoy(o))), 0), [ogeler, olcuSurum]); // eslint-disable-line react-hooks/exhaustive-deps
  const listeUstu = basBosluk.current?.offsetTop ?? 0;
  const { bas, son } = gorunurAralik(ofs, pencere.ust - listeUstu, pencere.boy, PAY);
  const n = ogeler.length;

  const olc = useCallback(() => {
    const el = kap.current;
    if (!el) return;
    kare.current = 0;
    const dipte = el.scrollHeight - el.scrollTop - el.clientHeight < 56;
    if (dipte) altta.current = true;
    else if (performance.now() - niyet.current < 600) altta.current = false;
    setAlttaMi(altta.current);
    setPencere((p) => (Math.abs(p.ust - el.scrollTop) < 40 && p.boy === el.clientHeight ? p : { ust: el.scrollTop, boy: el.clientHeight }));
  }, []);
  const kaydirildi = () => { if (!kare.current) kare.current = requestAnimationFrame(olc); };
  useEffect(() => () => cancelAnimationFrame(kare.current), []);

  // Her çizimden sonra: alttaysa alta yapış (akan metin, yeni kart). Kullanıcı yukarıdaysa dokunulmaz.
  useLayoutEffect(() => {
    const el = kap.current;
    if (el && altta.current) el.scrollTop = el.scrollHeight;
  });
  // Pencere boyu değişince görünür aralık yeniden hesaplanır.
  useEffect(() => {
    const el = kap.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    const r = new ResizeObserver(() => { if (altta.current) el.scrollTop = el.scrollHeight; olc(); });
    r.observe(el);
    return () => r.disconnect();
  }, [olc]);

  // "İzin bekleniyor · Göster": öğeye kaydırılır (kullanıcı niyeti: alta yapışma bırakılır, sonra karta odak — "İzin ver"e DEĞİL).
  useEffect(() => {
    const el = kap.current;
    if (!el || !hedef) return;
    const i = gorunenSira(ogeler, hedef.anahtar);
    if (i < 0) return;
    niyetVar();
    el.scrollTop = Math.max(0, (basBosluk.current?.offsetTop ?? 0) + ofs[i] - 12);
    let z = 0;
    let deneme = 0;
    // Kart, öğe çizilip (ve zorla açılan alt ajan ölçülüp) yerleşince bulunur; birkaç kare denenir.
    const bul = () => {
      const kart = el.querySelector<HTMLElement>(`[data-izin-kart][data-istek="${CSS.escape(hedef.istekId)}"]`)
        ?? el.querySelector<HTMLElement>(`[data-anahtar="${CSS.escape(hedef.anahtar)}"] [data-izin-kart]`);
      if (!kart && ++deneme < 8) { z = requestAnimationFrame(bul); return; }
      if (!kart) return;
      niyetVar();
      kart.scrollIntoView({ block: kart.offsetHeight > el.clientHeight ? 'start' : 'center' });
      kart.focus({ preventScroll: true });
    };
    z = requestAnimationFrame(() => { z = requestAnimationFrame(bul); });
    return () => cancelAnimationFrame(z);
  }, [hedef?.no]); // eslint-disable-line react-hooks/exhaustive-deps

  // Düzeltme 2 (a): bekleyen izin kartlarının görünürlüğü (kart en az %60'ı ya da dökümün %60'ını dolduruyorsa "görünür").
  const izinGorunurRef = useRef(izinGorunur);
  izinGorunurRef.current = izinGorunur;
  const goz = useRef<{ io: IntersectionObserver; gorunur: Map<Element, boolean>; son: boolean; bildir: () => void } | null>(null);
  useEffect(() => {
    const el = kap.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const gorunur = new Map<Element, boolean>();
    const g = {
      io: new IntersectionObserver((girdiler) => {
        for (const e of girdiler) {
          const kok = e.rootBounds?.height ?? el.clientHeight;
          gorunur.set(e.target, e.isIntersecting && (e.intersectionRatio >= 0.6 || e.intersectionRect.height >= kok * 0.6));
        }
        g.bildir();
      }, { root: el, threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] }),
      gorunur, son: false,
      bildir: () => { const v = [...gorunur.values()].some(Boolean); if (v !== g.son) { g.son = v; izinGorunurRef.current?.(v); } },
    };
    goz.current = g;
    return () => { g.io.disconnect(); goz.current = null; izinGorunurRef.current?.(false); };
  }, []);
  useEffect(() => {
    // Her çizimden sonra: sanal listeye giren/çıkan bekleyen kartlar izlenir.
    const g = goz.current;
    const el = kap.current;
    if (!g || !el) return;
    const simdi = new Set(el.querySelectorAll('[data-izin-kart]'));
    for (const e of [...g.gorunur.keys()]) if (!simdi.has(e)) { g.io.unobserve(e); g.gorunur.delete(e); }
    for (const e of simdi) if (!g.gorunur.has(e)) { g.gorunur.set(e, false); g.io.observe(e); }
    g.bildir();
  });

  const enSona = () => {
    const el = kap.current;
    if (!el) return;
    altta.current = true;
    setAlttaMi(true);
    el.scrollTo({ top: el.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    yaziKutusu?.();
  };

  return (
    <AcikBaglam.Provider value={acikHarita.current}>
      <div className="cc-dokum-kap">
        <div ref={kap} className="cc-dokum" onScroll={kaydirildi} onWheel={niyetVar} onTouchMove={niyetVar} onPointerDown={niyetVar}
          onKeyDown={(e) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) niyetVar(); }} tabIndex={0} role="log" aria-label="Claude Code dökümü" aria-live="off" data-oge-sayisi={n} data-ham-oge-sayisi={hamOgeler.length}>
          {ust}
          <div ref={basBosluk} style={{ height: n ? ofs[bas] : 0 }} aria-hidden="true" />
          {ogeler.slice(bas, son).map((o) => <Olcer key={o.anahtar} o={o} cwd={cwd} gozlemci={gozlemci} />)}
          <div style={{ height: n ? ofs[n] - ofs[son] : 0 }} aria-hidden="true" />
          {alt}
        </div>
        {!alttaMi && n > 0 && (
          <button type="button" className="dgm dgm--koyu dgm--k cc-dokum__sona" onClick={enSona}><Ikon ad="asagi" olcu={14} />En sona</button>
        )}
      </div>
    </AcikBaglam.Provider>
  );
}
