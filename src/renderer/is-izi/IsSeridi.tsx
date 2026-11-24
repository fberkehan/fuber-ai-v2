// ── İş izi bileşenleri (11 Kas): her yüzeyin AYNI işareti, AYNI cümlesi ve AYNI hareketi ───────────────────────────────────────────────────
// Hangi işin nerede yapıldığını gösteren özel animasyonlar — Apple kalitesinde, sakin. Kurallar (tasarımcı Bölüm 5.4; is-izi.css):
//   · Yalnız transform ve opacity canlanır. Satır girişi 220 ms; fiil değişimi 180 ms çapraz solma (eski yukarı kayıp söner, yeni aşağıdan gelir);
//     yörünge (Çalışıyor) ya da nefes (Bekliyor) 2,4 sn — YALNIZ iş aktifken takılı; boşta hiçbir döngü yok, iş yokken hiçbir şey çizilmez.
//   · İlerleme çubuğu scaleX (genişlik canlanmaz); yalnız ilerleme biliniyorsa.
//   · Bitince tik (320 ms, yay eğrisi) ve 480 ms hedefe uçuş (ray simgesi ya da çentikte hapın işareti; isUcur).
//   · Az hareket (Görünüm ayarı ya da Windows): yalnız opaklık; döngü, kayma, tik sıçraması ve uçuş yok.
//   · Paralel yardımcılar ayrışır: kipin vurgusundan sıraya göre ton kayması (--is-ton; shared/is-izi.ts yardimciTonu).
//   · Kimlik HİÇBİR yerde yazmaz (data-is-id yalnız DOM'da, uçuşun kaynağını bulmak için). İş modunda "alt ajan" denmez: "Yardımcı N".
import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { IS_HALI_ADI, aktifMi, isAltMetni, isSuresi, yardimciAdi, yardimciOzeti, yardimciTonu, type IsHali, type IsKaydi } from '../../shared/is-izi';
import { kipVurgusu } from '../ui/goz/vurgu';
import { MetinKirp } from '../ui/MetinKirp';
import { Ikon } from '../bilesenler/Ikon';
import type { KipKimligi } from '../../shared/karakterler';
import { isAzHareketMi } from './depo';
import './is-izi.css';

/** Yüzeyin kökü: kipin vurgusu (Business turuncu, Developer yeşil) — yardımcı tonları bundan türer. */
export const isVurguStili = (kip: KipKimligi): CSSProperties => ({ ['--is-vurgu' as string]: kipVurgusu(kip) });
/** Yardımcının tonu (yalnız sıralı işlerde: alt ajanlar). */
export const isTonStili = (is: Pick<IsKaydi, 'sira' | 'kaynak'>): CSSProperties | undefined =>
  is.sira !== undefined ? { ['--is-ton' as string]: String(yardimciTonu(is.sira)) } : undefined;

/** Durum işareti (16 px): yörüngeli halka (Çalışıyor / Başlıyor), nefes alan nokta (Bekliyor), boş halka (Sırada), amber nokta (Onay), tik (Bitti),
 *  durağan nokta (Olmadı). Döngü yalnız aktif işte; Az hareket'te yok (CSS). */
export const IsIsareti = memo(function IsIsareti({ hal, olcu = 16 }: { hal: IsHali; olcu?: number }) {
  return (
    <span className="is-isaret" data-hal={hal} style={{ width: olcu, height: olcu }} role="img" aria-label={IS_HALI_ADI[hal]}>
      {hal === 'bitti'
        ? <svg className="is-isaret__tik" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8.4 6.9 11 12 5.4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
        : <>
          <i className="is-isaret__halka" />
          {(hal === 'calisiyor' || hal === 'basliyor') && <i className="is-isaret__yorunge"><b /></i>}
          {(hal === 'bekliyor' || hal === 'onay' || hal === 'olmadi') && <i className="is-isaret__nokta" />}
        </>}
    </span>
  );
});

/**
 * Yörünge (çentik hapı): ortadaki işaretin (karakter ya da Sade'de Fuber işareti) çevresinde paralel iş sayısı kadar nokta tek halkada döner (2,4 sn).
 * Noktalar sabit açılarla yerleşir, yalnız kapsayıcı döner (transform); her nokta kendi yardımcısının tonunda. `sayi` 0 iken halka yok (döngü yok).
 */
export function IsYorungesi({ sayi, olcu, children }: { sayi: number; olcu: number; children: ReactNode }) {
  const n = Math.min(5, Math.max(0, Math.floor(sayi)));
  const r = olcu / 2 + 3;
  return (
    <span className="is-yorunge" data-is-hedef="" style={{ width: olcu, height: olcu }}>
      {children}
      {n > 0 && (
        <i className="is-yorunge__halka" aria-hidden="true">
          {Array.from({ length: n }, (_, i) => (
            <b key={i} style={{ transform: `rotate(${(i * 360) / n}deg) translateY(-${r}px)`, ['--is-ton' as string]: String(yardimciTonu(i)) }} />
          ))}
        </i>
      )}
    </span>
  );
}

/** Fiil değişimi: eski metin yukarı kayıp söner, yenisi aşağıdan gelir (180 ms). Az hareket'te yalnız opaklık. */
export function FiilGecisi({ metin, className = '' }: { metin: string; className?: string }) {
  const [onceki, setOnceki] = useState<{ metin: string; no: number } | null>(null);
  const son = useRef(metin);
  const no = useRef(0);
  useLayoutEffect(() => {
    if (son.current === metin) return;
    const eski = son.current;
    son.current = metin;
    no.current += 1;
    setOnceki({ metin: eski, no: no.current });
    const z = setTimeout(() => setOnceki(null), 200);
    return () => clearTimeout(z);
  }, [metin]);
  return (
    <span className={`is-fiil ${className}`} aria-live="off">
      {onceki && <span key={`o${onceki.no}`} className="is-fiil__metin is-fiil__metin--cikan" aria-hidden="true"><MetinKirp metin={onceki.metin} satir={1} as="span" /></span>}
      <span key={`y${no.current}`} className={`is-fiil__metin${onceki ? ' is-fiil__metin--giren' : ''}`}><MetinKirp metin={metin} satir={1} as="span" /></span>
    </span>
  );
}

/** İlerleme çubuğu (2 px): yalnız ilerleme biliniyorsa; scaleX ile. */
function Ilerleme({ oran }: { oran: number }) {
  return <i className="is-ilerleme" aria-hidden="true"><b style={{ transform: `scaleX(${Math.min(1, Math.max(0, oran)).toFixed(4)})` }} /></i>;
}

export type IsCesidi = 'sohbet' | 'kokpit' | 'centik' | 'cc';

/**
 * Bir işin şeridi. Sol: durum işareti (yardımcının tonunda). Orta: üstte kim ve işin adı ("Yardımcı 2 · Şifre ekranını tara"), altta canlı fiil (çapraz solma).
 * Sağ: süre (aktifken canlı) ve verilen tek eylem. `tikla`: satır işin yerine götürür. Bitince tik; satır biraz sonra listeden çıkar (ana süreç tutar).
 */
export const IsSeridi = memo(function IsSeridi({ is, simdi, cesit, eylem, tikla, kim, yer = false, acik, anaSinif, kimEk, sagEk, ipucu }: {
  is: IsKaydi; simdi: number; cesit: IsCesidi; eylem?: ReactNode; tikla?: () => void;
  /** Üst satırın adı (verilmezse kaynağın adı: "Yardımcı 2", "Claude Code"…). Boş dize: yalnız işin adı. */
  kim?: string;
  /** Yer adını (sohbet adı, proje) alt satırda göster (kokpit ve çentik: iş başka sayfada). */
  yer?: boolean;
  /** Claude Code kartı: satır açılır/kapanır (aria-expanded), satırın sınıfı (cc-arac__bas), adın yanındaki çip ve süreden önceki ek (adım sayısı, izin rozeti). */
  acik?: boolean; anaSinif?: string; kimEk?: ReactNode; sagEk?: ReactNode; ipucu?: string;
}) {
  const ad = kim ?? yardimciAdi(is);
  const baslik = is.baslik && is.baslik !== ad ? is.baslik : '';
  const sure = isSuresi((aktifMi(is.hal) ? simdi : (is.bitis ?? simdi)) - is.baslangic);
  const oran = aktifMi(is.hal) ? is.ilerleme?.oran : undefined;
  const ust = [ad, baslik].filter(Boolean).join(' · ');
  const ozet = `${ust ? `${ust}: ` : ''}${is.ne} · ${IS_HALI_ADI[is.hal]}${yer ? ` · ${is.nerede.ad}` : ''}`;
  const Kok = tikla ? 'button' : 'div';
  return (
    <div className="is-seridi" data-cesit={cesit} data-hal={is.hal} data-kaynak={String(is.kaynak)} data-is-id={is.id} style={isTonStili(is)}>
      <Kok {...(tikla ? { type: 'button' as const, onClick: tikla, title: ipucu ?? `${is.nerede.ad} sayfasını aç`, ...(acik !== undefined ? { 'aria-expanded': acik } : {}) } : {})}
        className={`is-seridi__ana${anaSinif ? ` ${anaSinif}` : ''}`} aria-label={ozet}>
        <IsIsareti hal={is.hal} />
        <span className="is-seridi__govde">
          {ust && <span className="is-seridi__ust">{ad && <b className={`is-seridi__kim${cesit === 'cc' ? ' cc-arac__ad' : ''}`}>{ad}{kimEk}</b>}{baslik && <span className="is-seridi__baslik"><MetinKirp metin={baslik} satir={1} as="span" /></span>}</span>}
          <FiilGecisi metin={is.ne} className="is-seridi__fiil" />
          {yer && <span className="is-seridi__yer">{is.nerede.ad}</span>}
        </span>
        {sagEk}
        <span className="is-seridi__sure" aria-hidden="true">{sure}</span>
      </Kok>
      {eylem && <span className="is-seridi__eylem">{eylem}</span>}
      {oran !== undefined && <Ilerleme oran={oran} />}
    </div>
  );
});

/**
 * Katlı satır (11 Kas; biten alt ajanlar sohbette çok büyük yer kaplıyordu): biten iş tek kısa satır — "✓ 3 yardımcı · 15 adım · 16 sn" —
 * tıklayınca açılır. Sohbet ve kokpitin grupları, Claude Code dökümündeki art arda biten yardımcılar ve araç kartları aynı satırı kullanır. Yükseklik
 * canlanmaz: kapanış anında, açılışta içerik solarak ve 4 px kayarak gelir; ok döner (is-izi.css). `tamam` değilse işaret "Olmadı" noktasıdır.
 */
export function KatliSatir({ metin, tamam = true, acik, degistir, children, etiket, ...veri }: {
  metin: string; tamam?: boolean; acik: boolean; degistir: (acik: boolean) => void; children: ReactNode;
  /** Erişilebilir ad (verilmezse metin). */
  etiket?: string;
} & { [k: `data-${string}`]: string | undefined }) {
  return (
    <div className="is-katli" data-acik={acik ? '' : undefined} {...veri}>
      <button type="button" className="is-katli__bas" aria-expanded={acik} aria-label={`${etiket ?? metin}${acik ? '' : ' · ayrıntıları göster'}`} onClick={() => degistir(!acik)}>
        <IsIsareti hal={tamam ? 'bitti' : 'olmadi'} olcu={14} />
        <span className="is-katli__metin">{metin}</span>
        <Ikon ad="asagi" olcu={14} className="is-katli__ok" />
      </button>
      {acik && <div className="is-katli__ic">{children}</div>}
    </div>
  );
}

/**
 * Bir işin ve yardımcılarının grubu (sohbet ve kokpit): üst satır işin kendisi ("Claude Code · mavi-kus"); altında her yardımcı kendi şeridinde, kendi
 * tonunda. Yardımcı birden çoksa üstte "Fuber işi 3 yardımcıya böldü". Yalnız süren iş tam şeritlerle görünür: yardımcılar bitince şeritleri tek katlı satıra
 * iner ("3 yardımcı · 14 adım · 42 sn"); iş de bittiyse grubun tamamı o tek satırdır. Satıra tıklayınca şeritler açılır.
 */
export function IsGrubu({ ust, cocuklar, simdi, cesit, eylem, tikla }: {
  ust: IsKaydi; cocuklar: IsKaydi[]; simdi: number; cesit: IsCesidi; eylem?: (is: IsKaydi) => ReactNode; tikla?: (is: IsKaydi) => void;
}) {
  const [acik, setAcik] = useState(false);
  const yardimci = cocuklar.filter((c) => c.kaynak === 'cc-ajan');
  const cocuklarBitti = cocuklar.length > 0 && cocuklar.every((c) => !aktifMi(c.hal));
  const hepsiBitti = cocuklarBitti && !aktifMi(ust.hal);
  const ustSerit = (
    <IsSeridi is={ust} simdi={simdi} cesit={cesit} eylem={eylem?.(ust)} tikla={tikla ? () => tikla(ust) : undefined}
      kim={ust.kaynak === 'cc-oturum' ? `Claude Code · ${ust.nerede.ad}` : undefined} />
  );
  const cocukSeritleri = (
    <div className="is-grubu__cocuklar">
      {cocuklar.map((c) => <IsSeridi key={c.id} is={c} simdi={simdi} cesit={cesit} eylem={eylem?.(c)} tikla={tikla ? () => tikla(c) : undefined} />)}
    </div>
  );
  const ozet = yardimciOzeti(yardimci.length ? yardimci : cocuklar);
  const tamam = cocuklar.every((c) => c.hal !== 'olmadi') && ust.hal !== 'olmadi';
  if (hepsiBitti) {
    return (
      <div className="is-grubu" data-cesit={cesit} data-cocuk={cocuklar.length} data-katli="">
        <KatliSatir metin={ozet} tamam={tamam} acik={acik} degistir={setAcik} data-is-id={ust.id}>{ustSerit}{cocukSeritleri}</KatliSatir>
      </div>
    );
  }
  return (
    <div className="is-grubu" data-cesit={cesit} data-cocuk={cocuklar.length || undefined}>
      {ustSerit}
      {yardimci.length > 1 && !cocuklarBitti && <div className="is-grubu__not">Fuber işi {yardimci.length} yardımcıya böldü</div>}
      {cocuklarBitti
        ? <KatliSatir metin={ozet} tamam={tamam} acik={acik} degistir={setAcik}>{cocukSeritleri}</KatliSatir>
        : cocuklar.length > 0 && cocukSeritleri}
    </div>
  );
}

/** Satırın ikinci satır metni (erişilebilir ad ve ipucu için dışarıya da açık). */
export const isSatirAlti = (is: IsKaydi, simdi: number): string => isAltMetni(is, simdi);

/**
 * Hedefe uçuş (480 ms): biten işin işaretinden küçük bir nokta hedefe (ray simgesi, çentikte hapın işareti) uçar; son %30'da söner ve küçülür. Yalnız
 * transform ve opacity (Web Animations). Az hareket'te, görünmeyen kaynakta ya da hedef yoksa uçuş yok.
 */
export function isUcur(kaynak: Element | null, hedef: Element | null, renk?: string): void {
  if (!kaynak || !hedef || isAzHareketMi()) return;
  const a = kaynak.getBoundingClientRect();
  const b = hedef.getBoundingClientRect();
  if (!a.width || !b.width) return;
  const nokta = document.createElement('i');
  nokta.className = 'is-ucan';
  if (renk) nokta.style.setProperty('--is-ucan-renk', renk);
  const x0 = a.left + a.width / 2 - 4, y0 = a.top + a.height / 2 - 4;
  const dx = b.left + b.width / 2 - 4 - x0, dy = b.top + b.height / 2 - 4 - y0;
  nokta.style.left = `${x0}px`;
  nokta.style.top = `${y0}px`;
  document.body.appendChild(nokta);
  const an = nokta.animate([
    { transform: 'translate(0, 0) scale(1)', opacity: 1 },
    { transform: `translate(${dx * 0.7}px, ${dy * 0.7}px) scale(.8)`, opacity: 1, offset: 0.7 },
    { transform: `translate(${dx}px, ${dy}px) scale(.5)`, opacity: 0 },
  ], { duration: 480, easing: 'cubic-bezier(.2,.8,.2,1)' });
  an.onfinish = () => nokta.remove();
  an.oncancel = () => nokta.remove();
}

/**
 * Bitiş uçuşu: listede aktiften "Bitti"ye geçen işin işaretinden hedefe uçar. `hedef`: işin hedef öğesi (ray simgesi ya da hap işareti). Kaynak bu yüzeyde
 * görünmüyorsa (başka sayfa) uçuş olmaz. Olmadı uçmaz (yerinde durağan nokta).
 */
export function useBitisUcusu(liste: readonly IsKaydi[], hedef: (is: IsKaydi) => Element | null, kok?: () => ParentNode | null): void {
  const once = useRef(new Map<string, IsHali>());
  useEffect(() => {
    const yeni = new Map(liste.map((x) => [x.id, x.hal] as const));
    for (const x of liste) {
      const eski = once.current.get(x.id);
      if (x.hal !== 'bitti' || !eski || !aktifMi(eski)) continue;
      const k = (kok?.() ?? document).querySelector(`[data-is-id="${CSS.escape(x.id)}"] .is-isaret`);
      // Tik çizildikten sonra uçar (tik 320 ms; uçuş onun bitiminde başlar).
      const t = setTimeout(() => isUcur(k, hedef(x), k ? getComputedStyle(k).color : undefined), 300);
      void t;
    }
    once.current = yeni;
  }, [liste, hedef, kok]);
}
