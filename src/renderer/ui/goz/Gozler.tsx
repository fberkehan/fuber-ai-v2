// Gözler (11 Kas, onaylanan "Pamuk" tasarımı; eski hayvan karakterlerinin yerine): çentikte, sohbet avatarında, panelde, kurulumda, boş durumlarda ve Yönetim'de
// aynı bileşen. 12 Kas: iki modun gözü AYRI (yalnız renk değişimi yetmez): Business "Pamuk", Developer keskin bakışlı "Odak" (geometri.ts
// SEKILLER, KIP_SEKLI). Gövde ve kapak her iki biçimin katmanıyla çizilir; kök svg'nin data-sekil'i görüneni seçer. Mod değişince beyin zıplatır, kırpar
// ve biçimi kırpmanın KAPALI anında takas eder (sekilUygula: data-sekil'i doğrudan yazar; React o özniteliğe ilk çizimden sonra dokunmaz). Küçük
// parıltı yine kipin renginde (Business turuncu, Developer yeşil; 280 ms çapraz solma). `sekil` verilirse kipin biçiminin yerine o çizilir (önizleme).
// Girdiler eski Karakter'le aynıdır (kip, poz, ifade, boyut, hal, azHareket, etiket, disImlec, tetik, disTiklama, etkinlik): çağrı yerleri tek satırda
// değişir. `poz` gözde anlamsızdır (baş, büst, kollu yok) ve yok sayılır. `hal` verilmezse göz durağandır (sohbet avatarı, boş durumlar: ileti başına
// zamanlayıcı yok); verilirse hareket beyni (beyin.ts) canlıdır: sakkad, kırpma, imleç, hâller, 60 sn sonra uyku ve uyanış.
//   · Kutu: `kesit='kare'` (varsayılan) boyut × boyut, gözler ortada (tasarımın VB_SIKI'si, kutunun ~%87'si); `kesit='centik'` çentiğin şeridi:
//     `boyut` gözün boyudur (çentikte 16 px), svg tasarımın 100×40 kutusu.
//   · Göz beyaz, kapak ve yanak siyahtır: göz her yüzeyde siyah bir sahnede durur (çentik, avatar dairesi, kart sahnesi). svg taşanı kırpar.
//   · Yalnız transform ve opacity canlanır (Web Animations, satır içi stil: React ilk durumdan sonra stile dokunmaz). Nefes kök svg'nin dönüşümüdür
//     (kompozitör). Uykuda kök svg `data-uyuyor` taşır (bosta-islemci ve testler bakar).
import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactElement } from 'react';
import type { KipKimligi } from '../../../shared/karakterler';
import { ALAN_PX, IMLEC_ARALIK_MS, gozDurumu, type GozDurumu, type GozHali, type GozIfadesi, type GozTetigi } from '../../../shared/goz';
import { GozBeyni, baslangictaUyurMu, GERCEK_SAAT, type Canlandirici, type GozOgeleri, type UykuDefteri } from './beyin';
import {
  EGRI_YUMUSAK, GOZ_BIRIM, KAPALI_YOL, KIP_SEKLI, PAMUK, SEKILLER, UYKU_INIS, VB_KARE, VB_TAM, bakisDonusumu, bebek, govdeYolu, gozKademesi, halBakisi, hedef, kapakY,
  kapakYolu, kipSekli, kutuMetni, yanakYolu, yayOpak, yuv, type GozSekli, type GozSekliAdi, type Kare,
} from './geometri';
import { KIP_VURGUSU } from './vurgu';
import './goz.css';

export interface GozlerOzellikleri {
  kip: KipKimligi;
  /** Eski Karakter'den kalma (baş, büst, kollu): gözde poz yoktur, yok sayılır. */
  poz?: string;
  /** Durağan ifade; verilirse hâlden üstündür. */
  ifade?: GozIfadesi;
  /** CSS piksel: kare kesitte kutunun kenarı, çentik kesitinde gözün boyu. */
  boyut: number;
  /** Verilirse göz canlıdır (sakkad, kırpma, imleç, uyku); verilmezse durağan. */
  hal?: GozHali;
  /** Az hareket (R16) ayarı; ayrıca sistemin prefers-reduced-motion tercihine bakılır. */
  azHareket?: boolean;
  /** Erişilebilir ad; verilmezse süs (aria-hidden). */
  etiket?: string;
  /** Dışarıdan gelen imleç (çentik penceresi): göz çiftinin merkezine göre ölçeksiz CSS px, pencere kutusunun dışında null. Verilirse sayfa dinlenmez. */
  disImlec?: { x: number; y: number } | null;
  /** `no` arttıkça `ad` jesti bir kez oynar (ilk değer oynamaz). */
  tetik?: { ad: GozTetigi; no: number };
  /** Tıklama dışarıdan (`tetik`) gelir: svg'nin kendi tıklaması selam vermez. */
  disTiklama?: boolean;
  /** Uyku defteri: yeniden takılan göz geri sayımı son gerçek girdiden sürdürür (Ada.tsx). */
  etkinlik?: UykuDefteri;
  kesit?: 'kare' | 'centik';
  /** Kipin biçiminin yerine bu biçim (önizleme ve galeri; ürün yüzeyleri vermez: biçim kipten gelir). */
  sekil?: GozSekliAdi;
  /** Duruş devrine katıl (ModGecisi'nin durağan gözü). Canlı göz her zaman katılır. */
  devir?: boolean;
}

/**
 * Duruş devri (12 Kas, kare kare denetimde bulunan sıçrama): mod değişince yüzeyler canlı gözü söküp ModGecisi'nin durağan gözünü takar (bitince tersi).
 * Yeni göz ilk karede kendi başlangıç duruşuyla çizildiğinden bakış ortaya, kırpan kapak açığa SIÇRIYORDU. Sökülen göz (canlı ya da devir'li) her öğesinin o
 * anki dönüşümünü buraya bırakır; aynı kesit ve boydaki yeni göz 150 ms içinde takılırsa o duruştan kendi duruşuna 240 ms'de süzülür (yalnız transform ve
 * opacity). Sohbet avatarı gibi durağan gözler katılmaz (ileti listesinde yeniden takılma süzülme oynatmasın).
 */
const DEVIR_MS = 150;
const DEVIR_SURE = 240;
const DEVIR_SECICI = '.goz-cift, .goz-bakis, .goz-durum, .goz-dongu, .goz-bebek, .goz-bebek-durum, .goz-yanak, .goz-kapak';
const devirler = new Map<string, { an: number; t: string[]; o: string[]; k: string }>();
function devirBirak(svg: SVGSVGElement, anahtar: string): void {
  if (!svg.isConnected) return;
  devirler.set(anahtar, {
    an: GERCEK_SAAT.simdi(),
    t: [...svg.querySelectorAll(DEVIR_SECICI)].map((e) => getComputedStyle(e).transform),
    o: [...svg.querySelectorAll('.goz-kapali')].map((e) => getComputedStyle(e).opacity),
    k: getComputedStyle(svg).transform,
  });
}
function devirAl(svg: SVGSVGElement, anahtar: string): void {
  const d = devirler.get(anahtar);
  devirler.delete(anahtar);
  if (!d || GERCEK_SAAT.simdi() - d.an > DEVIR_MS) return;
  const suz = (e: Element, oz: 'transform' | 'opacity', once: string) => {
    const simdi = getComputedStyle(e)[oz];
    if (!once || once === simdi) return;
    e.animate([{ [oz]: once }, { [oz]: simdi }], { duration: DEVIR_SURE, easing: EGRI_YUMUSAK });
  };
  [...svg.querySelectorAll(DEVIR_SECICI)].forEach((e, i) => suz(e, 'transform', d.t[i]));
  [...svg.querySelectorAll('.goz-kapali')].forEach((e, i) => suz(e, 'opacity', d.o[i]));
  suz(svg, 'transform', d.k);
}

/** Windows animasyon efektleri kapalı mı (R16): karar anında okunur, dinleyici yok. */
let sistemSorgu: MediaQueryList | null | undefined;
const sistemAzMi = (): boolean => {
  if (sistemSorgu === undefined) sistemSorgu = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  return sistemSorgu?.matches ?? false;
};

/** Web Animations canlandırıcısı (tasarımın `diz`i): her öğede tek kanal, o anki hesaplanmış değerden başlar, son değer satır içi stile yazılır. */
export const WAAPI: Canlandirici<Element> = {
  diz(el, oz, kareler, sure, gecik = 0) {
    const e = el as SVGElement;
    // Anında yazım (nefes adımı): hesaplanmış stil okunmaz, yalnız süren hareket bırakılır ve değer yazılır.
    if (sure <= 0) { e.getAnimations().forEach((a) => a.cancel()); e.style[oz] = kareler[kareler.length - 1].v; return; }
    const simdi = getComputedStyle(e)[oz];
    e.getAnimations().forEach((a) => a.cancel());
    const kf: Keyframe[] = [{ [oz]: simdi, offset: 0 }];
    kareler.forEach((k: Kare) => kf.push({ [oz]: k.v, offset: k.o }));
    kareler.forEach((k: Kare, i) => { kf[i].easing = k.e ?? 'linear'; });
    e.style[oz] = kareler[kareler.length - 1].v;
    if (sure <= 0) return;
    e.animate(kf, { duration: sure, delay: gecik, fill: 'backwards' });
  },
  dongu(el, kareler, o) {
    (el as SVGElement).animate(kareler.map((k) => ({ ...k })), { duration: o.sure, delay: o.gecik, iterations: o.tekrar, easing: o.egri ?? 'linear' });
  },
  kapakF(el) {
    const t = getComputedStyle(el).transform;
    if (!t || t === 'none') return kapakY(0);
    const p = t.slice(t.indexOf('(') + 1, -1).split(',').map(Number);
    return p.length === 6 ? p[5] : p[13] ?? kapakY(0);
  },
};

/** İlk çizimin satır içi stilleri (React yalnız takılırken yazar; sonra hareket beyni). */
function ilkStil(dd: GozDurumu, s: number, sk: GozSekli) {
  const h = hedef(dd, s, sk);
  // Düşünme yönü beyinle aynı başlar (−1).
  const b = halBakisi(dd, -1) ?? { x: 0, y: 0 };
  const bk = bakisDonusumu(b.x, b.y, s);
  return {
    bakis: { transform: bk.bakis }, bebek: { transform: bk.bebek }, durum: { transform: h.durum }, bebekDurum: { transform: h.bebek },
    yanak: { transform: h.yanak }, kapak: { transform: h.kapak }, kapali: { opacity: yuv(yayOpak(h.p)) },
  };
}

/** Kesite göre ölçüler: svg eni/boyu, görünüm kutusu ve göz biriminin CSS pikseli. */
export function gozOlcusu(boyut: number, kesit: 'kare' | 'centik' = 'kare'): { en: number; boy: number; vb: typeof VB_TAM; birimPx: number } {
  if (kesit === 'centik') {
    const boy = (boyut * VB_TAM.h) / GOZ_BIRIM;
    return { en: (boy * VB_TAM.w) / VB_TAM.h, boy, vb: VB_TAM, birimPx: boyut / GOZ_BIRIM };
  }
  return { en: boyut, boy: boyut, vb: VB_KARE, birimPx: boyut / VB_KARE.w };
}

export function Gozler(o: GozlerOzellikleri): ReactElement {
  // Canlı ↔ durağan değişince (ör. çentikte odak) bileşen yeniden kurulur: beyin bir kez, doğru kiple kurulur.
  return <GozlerIc key={o.hal === undefined ? 'durgun' : 'canli'} {...o} />;
}

function GozlerIc({ kip, ifade, boyut, hal, azHareket = false, etiket, disImlec, tetik, disTiklama = false, etkinlik, kesit = 'kare', sekil, devir = false }: GozlerOzellikleri): ReactElement {
  const kok = useRef<SVGSVGElement | null>(null);
  const beyin = useRef<GozBeyni<Element> | null>(null);
  const canli = hal !== undefined;
  const durum = gozDurumu(hal, ifade);
  const olcu = gozOlcusu(boyut, kesit);
  const sk = sekil ? SEKILLER[sekil] : kipSekli(kip);
  const son = useRef({ azHareket, birimPx: olcu.birimPx, sk });
  son.current = { azHareket, birimPx: olcu.birimPx, sk };
  // İlk çizimin biçimi (data-sekil React'ten bir kez; sonra beyin yazar). Katmanlar: iki kipin biçimi ve verilmişse önizleme biçimi.
  const ilkSekil = useRef(sk.ad);
  const katmanlar = [...new Set<GozSekliAdi>([KIP_SEKLI.business, KIP_SEKLI.developer, ilkSekil.current, sk.ad])];
  // İlk durum takılırken bir kez: defterde süresi dolmuşsa uyuyan göz (dizi oynamaz).
  const ilk = useRef<GozDurumu | null>(null);
  ilk.current ??= canli && baslangictaUyurMu(etkinlik, GERCEK_SAAT.simdi(), durum) ? 'uyuyor' : durum;
  const ilkDurum = ilk.current;
  const stiller = useRef<ReturnType<typeof ilkStil>[] | null>(null);
  stiller.current ??= [ilkStil(ilkDurum, -1, sk), ilkStil(ilkDurum, 1, sk)];
  const ciftStil = useRef<CSSProperties>({ transform: ilkDurum === 'uyuyor' ? `translate(0px, ${yuv(UYKU_INIS)}px)` : 'translate(0px, 0px)' });
  const tetikNo = useRef(tetik?.no);
  const sonKip = useRef({ kip, sekil: sk.ad });

  useLayoutEffect(() => {
    const svg = kok.current;
    if (!svg) return;
    const devirAnahtari = canli || devir ? `${kesit}:${yuv(boyut)}` : null;
    if (devirAnahtari) devirAl(svg, devirAnahtari);
    const sec = (g: Element, c: string) => g.querySelector(`.${c}`) as Element;
    const gozler: GozOgeleri<Element>[] = [...svg.querySelectorAll('.goz')].map((g) => ({
      s: Number((g as SVGElement).dataset.s), bakis: sec(g, 'goz-bakis'), durum: sec(g, 'goz-durum'), dongu: sec(g, 'goz-dongu'), bebek: sec(g, 'goz-bebek'),
      bebekDurum: sec(g, 'goz-bebek-durum'), yanak: sec(g, 'goz-yanak'), kapak: sec(g, 'goz-kapak'), kapali: sec(g, 'goz-kapali'),
    }));
    const b = new GozBeyni<Element>({
      gozler, cift: svg.querySelector('.goz-cift') as Element, kok: svg, can: WAAPI, canli, defter: etkinlik,
      az: () => son.current.azHareket || sistemAzMi(), birimPx: () => son.current.birimPx,
      uykuDegisti: (u) => { svg.toggleAttribute('data-uyuyor', u); },
      sekil: () => son.current.sk, sekilUygula: (ad) => { svg.setAttribute('data-sekil', ad); },
    });
    beyin.current = b;
    b.baslat(ilkDurum);
    return () => { if (devirAnahtari) devirBirak(svg, devirAnahtari); b.durdur(); beyin.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { beyin.current?.istek(durum); }, [durum]);
  useEffect(() => { beyin.current?.azDegisti(); }, [azHareket]);
  // Mod (ya da biçim) değişti: parıltı CSS'te çapraz solar; beyin zıplatır, kırpar ve biçimi kapalı anda takas eder (biçim aynıysa yalnız jest).
  useEffect(() => {
    if (kip === sonKip.current.kip && sk.ad === sonKip.current.sekil) return;
    sonKip.current = { kip, sekil: sk.ad };
    beyin.current?.sekilDegisti();
  }, [kip, sk.ad]);
  useEffect(() => {
    if (!tetik || tetik.no === tetikNo.current) return;
    tetikNo.current = tetik.no;
    beyin.current?.tetikle(tetik.ad);
  }, [tetik?.ad, tetik?.no]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dış imleç (çentik): göz çiftinin merkezine göre ölçeksiz px → göz birimi. Alan dışı "yok".
  const disarida = disImlec !== undefined;
  const dx = disImlec ? disImlec.x : null;
  const dy = disImlec ? disImlec.y : null;
  useEffect(() => {
    const b = beyin.current;
    if (!disarida || !canli || !b) return;
    if (dx === null || dy === null || Math.hypot(dx, dy) > ALAN_PX) b.imlecGitti();
    else b.imlec(dx / son.current.birimPx, dy / son.current.birimPx);
  }, [disarida, canli, dx, dy]);

  // Sayfa imleci, üzerine gelme ve tıklama (yalnız canlı göz). Olaylar pencerenin kendi kutusundan gelir (R14); imleç 32 ms'de bir okunur.
  useEffect(() => {
    const svg = kok.current;
    if (!svg || !canli) return;
    const b = () => beyin.current;
    const iceri = () => b()?.etkinlik();
    const bas = (e: PointerEvent) => { if (e.button === 0) b()?.tetikle('selam'); };
    svg.addEventListener('pointerenter', iceri);
    if (!disTiklama) svg.addEventListener('pointerdown', bas);
    let sonOlay: PointerEvent | null = null;
    let z: ReturnType<typeof setTimeout> | null = null;
    const oku = () => {
      z = null;
      const e = sonOlay;
      if (!e) return;
      const r = svg.getBoundingClientRect();
      if (!r.width) return;
      const birim = r.height / olcu.vb.h;
      const px = e.clientX - (r.left + r.width / 2);
      const py = e.clientY - (r.top + r.height / 2);
      if (Math.hypot(px, py) > ALAN_PX) b()?.imlecGitti();
      else b()?.imlec(px / birim, py / birim);
    };
    const hareket = (e: PointerEvent) => { sonOlay = e; if (!z) z = setTimeout(oku, IMLEC_ARALIK_MS); };
    const cikti = () => { sonOlay = null; if (z) { clearTimeout(z); z = null; } b()?.imlecGitti(); };
    const belge = svg.ownerDocument;
    if (!disarida) {
      belge.addEventListener('pointermove', hareket, { passive: true });
      belge.documentElement.addEventListener('pointerleave', cikti);
    }
    return () => {
      svg.removeEventListener('pointerenter', iceri);
      svg.removeEventListener('pointerdown', bas);
      belge.removeEventListener('pointermove', hareket);
      belge.documentElement.removeEventListener('pointerleave', cikti);
      if (z) clearTimeout(z);
    };
  }, [canli, disarida, disTiklama, olcu.vb.h]);

  const kademe = gozKademesi(olcu.birimPx);
  const st = stiller.current;
  return (
    <svg
      ref={kok}
      className="gozler"
      width={yuv(olcu.en)}
      height={yuv(olcu.boy)}
      viewBox={kutuMetni(olcu.vb)}
      data-gozler={kip}
      data-mod={kip}
      data-sekil={ilkSekil.current}
      data-kademe={kademe}
      data-durum={durum}
      data-canli={canli ? '' : undefined}
      data-az-hareket={azHareket ? '' : undefined}
      style={{ ['--goz-biz' as string]: KIP_VURGUSU.business, ['--goz-dev' as string]: KIP_VURGUSU.developer }}
      {...(etiket ? { role: 'img', 'aria-label': etiket } : { 'aria-hidden': true })}
    >
      <g className="goz-cift" style={ciftStil.current}>
        {([-1, 1] as const).map((s, i) => {
          const b = bebek(s);
          const x = st[i];
          return (
            <g key={s} className="goz" data-s={s} transform={`translate(${PAMUK.cx[i]} 20)`}>
              <g className="goz-bakis" style={x.bakis}>
                <g className="goz-durum" style={x.durum}>
                  <g className="goz-dongu">
                    <g className="goz-govde">
                      {katmanlar.map((ad) => <path key={ad} className="goz-govde-yolu" data-katman={ad} d={govdeYolu(SEKILLER[ad], s)} fill="#fff" />)}
                      <g className="goz-bebek" style={x.bebek}>
                        <g className="goz-bebek-durum" style={x.bebekDurum}>
                          <circle cx={b.bebek.cx} cy={b.bebek.cy} r={b.bebek.r} fill="#000" />
                          <circle cx={b.buyukParilti.cx} cy={b.buyukParilti.cy} r={b.buyukParilti.r} fill="#fff" />
                          <g className="goz-parilti goz-ince">
                            <circle className="goz-p-n" cx={b.kucukParilti.cx} cy={b.kucukParilti.cy} r={b.kucukParilti.r} fill="#fff" />
                            <circle className="goz-p-b" cx={b.kucukParilti.cx} cy={b.kucukParilti.cy} r={b.kucukParilti.r} fill="var(--goz-biz)" />
                            <circle className="goz-p-d" cx={b.kucukParilti.cx} cy={b.kucukParilti.cy} r={b.kucukParilti.r} fill="var(--goz-dev)" />
                          </g>
                        </g>
                      </g>
                      <path className="goz-yanak" d={yanakYolu()} fill="#000" style={x.yanak} />
                      <g className="goz-kapak" style={x.kapak}>
                        {katmanlar.map((ad) => <path key={ad} data-katman={ad} d={kapakYolu(SEKILLER[ad].lidK)} fill="#000" />)}
                      </g>
                    </g>
                    <path className="goz-kapali" d={KAPALI_YOL} style={x.kapali} />
                  </g>
                </g>
              </g>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
