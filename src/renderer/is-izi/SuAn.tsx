// ── İş izi yüzeyleri (11 Kas): kokpitin "Şu an" kartı, Etkinlik'in "Şu an"ı, sohbetin yardımcı şeridi, rayın noktası ────────────────────────────────
// Hepsi aynı listeyi (depo.ts useIsIzi) ve aynı bileşenleri (IsSeridi.tsx) kullanır: aynı cümle, aynı işaret, aynı hareket.
//   · Kokpit "Şu an" (tasarımcı bulgu 1, 6; Bölüm 5.3 C): Görevler kartının süren bölümü ile Etkinlik'in "Şu an"ı tek kartta. Süren, bekleyen ve onay bekleyen
//     bütün işler; her satırda yer adı ve tek eylem (Durdur / Onayla); satır işin yerine götürür. Altında bugün biten/duran görevler (Sürdür'üyle).
//   · Sohbet: o sohbetten verilen işler ve yardımcıları (Claude Code oturumu ve alt ajanları, arka plan süreci) yazı alanının üstünde şerit şerit.
//   · Ray: işin yürüdüğü sayfanın simgesinde 6 px nokta (canlıyken nefes alır; yalnız sürekli iş varsa durağan).
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Dugme, Kart, Liste } from '../ui';
import { tostGoster } from '../tostlar';
import { useMod } from '../mod';
import { modKip } from '../../shared/karakterler';
import { aktifMi, gorevleriKat, rayNoktalari, sohbetYardimcilari, ustGruplari, type IsKaydi, type IsSayfasi } from '../../shared/is-izi';
import { gorevKartiOgeleri } from '../../shared/isler-gorunum';
import type { IsOzet } from '../../shared/isler';
import { IsGrubu, isVurguStili, useBitisUcusu } from './IsSeridi';
import { isDurdur, isGit, useIsAzHareket, useIsIzi, useSaniye } from './depo';
import { GorevSatiriKutusu } from '../pano/GorevlerKarti';
import type { Hucre } from '../pano/PanoKartlari';

/** Boş durum: tek satır (tasarımcı 5.3 C). */
export const SU_AN_BOS = 'Şu an çalışan bir iş yok. Bir şey iste, burada izle.';

/** Satırın tek eylemi: onay bekleyende "Onayla" (onay kartı işin yerinde: oraya götürür), durdurulabilende "Durdur". */
function IsEylemi({ is }: { is: IsKaydi }) {
  const [mesgul, setMesgul] = useState(false);
  if (is.hal === 'onay') return <Dugme tur="birincil" boyut="k" data-is-eylem="onayla" onClick={() => isGit(is)}>Onayla</Dugme>;
  if (!is.durdurulabilir || !aktifMi(is.hal)) return null;
  const gorev = is.kaynak === 'gorev';
  return (
    <Dugme tur="ikincil" boyut="k" simge="dur" disabled={mesgul} data-is-eylem="durdur" {...(gorev ? { 'data-gorev-eylem': 'durdur' } : {})}
      aria-label={`Durdur: ${is.baslik || is.ne}`}
      onClick={() => { setMesgul(true); void isDurdur(is).catch(() => tostGoster('Durdurulamadı; yeniden dene.', 'hata', 5000)).finally(() => setMesgul(false)); }}>Durdur</Dugme>
  );
}

/** "Şu an" listesi (kokpit ve Etkinlik): üst işler ve yardımcıları; `en` kadar satır, fazlası "+N iş daha". */
export function SuAnListesi({ en = 6, bos = SU_AN_BOS, devam, gorevler }: { en?: number; bos?: string | null; devam?: () => void; gorevler?: readonly IsOzet[] }) {
  const ham = useIsIzi();
  const mod = useMod() ?? 'is';
  const liste = useMemo(() => (gorevler ? gorevleriKat(ham, gorevler, new Date(), mod) : ham), [ham, gorevler, mod]);
  const simdi = useSaniye(liste.some((x) => aktifMi(x.hal)));
  const gruplar = useMemo(() => ustGruplari(liste), [liste]);
  // Satır sayısı bütçesi: grup başlığı + çocukları.
  let kalan = en;
  const gorunen: typeof gruplar = [];
  for (const g of gruplar) {
    if (kalan <= 0) break;
    const c = g.cocuklar.slice(0, Math.max(0, kalan - 1));
    gorunen.push({ is: g.is, cocuklar: c });
    kalan -= 1 + c.length;
  }
  const gizli = gruplar.reduce((n, g) => n + 1 + g.cocuklar.length, 0) - gorunen.reduce((n, g) => n + 1 + g.cocuklar.length, 0);
  if (!gruplar.length) return bos ? <p className="su-an__bos" data-su-an-bos="">{bos}</p> : null;
  return (
    <div className="su-an__liste" style={isVurguStili(modKip(mod))}>
      {gorunen.map((g) => <IsGrubu key={g.is.id} ust={g.is} cocuklar={g.cocuklar} simdi={simdi} cesit="kokpit" eylem={(is) => <IsEylemi is={is} />} tikla={isGit} />)}
      {gizli > 0 && (devam
        ? <button type="button" className="su-an__devam" onClick={devam}>+{gizli} iş daha</button>
        : <span className="su-an__devam">+{gizli} iş daha</span>)}
    </div>
  );
}

/** Kokpit "Şu an" kartı: canlı işler + bugün biten/duran görevler. `gorevler`: kokpitin görev listesi (isler:durum). */
export function SuAnKarti({ gorevler, git, aracsiz, ...hucre }: { gorevler: readonly IsOzet[]; git: (sayfa: string, id?: number) => void; aracsiz: boolean } & Hucre) {
  const mod = useMod() ?? 'is';
  const liste = useIsIzi();
  const bugun = gorevKartiOgeleri(gorevler, new Date()).bugun;
  const canli = liste.length > 0;
  const az = useIsAzHareket();
  return (
    <Kart {...hucre} baslik="Şu an" data-su-an="" data-is-az={az ? '' : undefined}>
      <div className="su-an">
        <SuAnListesi gorevler={gorevler} en={bugun.length ? 4 : 6} bos={bugun.length ? 'Şu an çalışan bir iş yok.' : SU_AN_BOS} devam={() => git('etkinlik')} />
        {bugun.length > 0 && (
          <div className="su-an__bugun" data-canli={canli ? '' : undefined}>
            <div className="ust-etiket su-an__etiket">Bugün</div>
            <Liste>{bugun.slice(0, canli ? 2 : 3).map((g) => <GorevSatiriKutusu key={g.id} is={g} simdi={new Date()} git={git} aracsiz={aracsiz} mod={mod} ozetli={false} />)}</Liste>
          </div>
        )}
      </div>
    </Kart>
  );
}

/** Sohbetin yardımcı şeridi: bu sohbetten verilen işler (Claude Code oturumu ve alt ajanları, arka plan süreci). Yoksa hiçbir şey çizilmez. */
export function IsSohbetSeridi({ sohbetId }: { sohbetId: number | null }) {
  const liste = useIsIzi();
  const mod = useMod() ?? 'is';
  // Arka plan süreçleri kendi şeridinde (CalisanSurecler: canlı çıktı ve Durdur; aynı işaret) — burada yinelenmez.
  const gruplar = useMemo(() => (sohbetId === null ? [] : sohbetYardimcilari(liste, sohbetId).filter((g) => g.is.kaynak !== 'surec')), [liste, sohbetId]);
  const simdi = useSaniye(gruplar.some((g) => aktifMi(g.is.hal) || g.cocuklar.some((c) => aktifMi(c.hal))));
  const az = useIsAzHareket();
  if (!gruplar.length) return null;
  return (
    <section className="is-sohbet" aria-label="Yardımcılar" data-is-sohbet="" data-is-az={az ? '' : undefined} style={isVurguStili(modKip(mod)) as CSSProperties}>
      {gruplar.map((g) => <IsGrubu key={g.is.id} ust={g.is} cocuklar={g.cocuklar} simdi={simdi} cesit="sohbet" tikla={isGit} eylem={(is) => (is === g.is ? <IsEylemi is={is} /> : null)} />)}
    </section>
  );
}

/** Ray simgesinin noktası (işin yürüdüğü sayfa). */
export function IsRayNoktasi({ sayfa }: { sayfa: string }) {
  const liste = useIsIzi();
  const mod = useMod() ?? 'is';
  const tur = rayNoktalari(liste)[sayfa as IsSayfasi];
  if (!tur) return null;
  return <span className="ray__is" data-is-ray={tur} aria-hidden="true" style={isVurguStili(modKip(mod))} />;
}

/** Ana pencere: biten işin işaretinden işin sayfasının ray simgesine uçuş (kaynak görünürse). Ayrıca "Az hareket" kökte işaretlenir. */
export function IsUcusIzleyici() {
  const liste = useIsIzi();
  const az = useIsAzHareket();
  useEffect(() => { document.documentElement.toggleAttribute('data-is-az', az); }, [az]);
  const hedef = useCallback((is: IsKaydi) => document.querySelector(`.ray__dgm[data-tur="${is.nerede.sayfa === 'kokpit' ? 'kokpit' : is.nerede.sayfa === 'claude' ? 'claude' : is.nerede.sayfa === 'etkinlik' ? 'etkinlik' : 'sohbetler'}"]`), []);
  useBitisUcusu(liste, hedef);
  return null;
}
