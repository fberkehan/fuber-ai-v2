// Kurulum v2 › Ses (spec §1.6; 0.13 spec B): ses SEÇİLMEZ — ses kipin karakterine bağlıdır (Yönetim atar). Kişi karakterin sesini "Dinle" ile duyar,
// "Sesli konuşma" (ses.seslendirme) ve "Hey Fuber" (ses.uyandirma) anahtarlarını bırakır; ikisi ANINDA kaydedilir (Vazgeç açılıştakine döndürür:
// shared/kurulum-vazgec.ts). Kip kartı da anında kaydedildiği için "Dinle" seçilen kipin sesiyle çalar. Gizli ve "Yalnız bu bilgisayar"da ses bu
// bilgisayardan çıkar (kural shared/nerede.ts sesBuBilgisayarda — ana süreç ses.ts aynı kuralı okur): kurulu değilse "Dinle" önce bir kez indirir
// (86 MB; ses:yedek-kur); adımdan çıkarken de arka planda iner — yalnız "Sesli konuşma" açıksa (shared/kurulum-taslak.ts sesIndirilsinMi). "Dinle" seçilen
// kipin sesiyle çalar (kip anında kaydedilse de açıkça gönderilir). Sağda ses dalgası: konuşurken canlanır; "Hey Fuber" dinleme hapı.
// Hesap onay bekliyorsa ses yolu kapalıdır (shared/kurulum-taslak.ts dinlemeDurumu): adım ve yan panel bunu söyler, yerel ses kurulu değilse çıkış "İndir ve dinle"dir.
import { useEffect, useState, type CSSProperties } from 'react';
import { cagir } from '../../api';
import { Ikon } from '../../bilesenler/Ikon';
import { fuberSoyle, type FuberKonusmasi } from '../../fuber-sesi';
import { Anahtar, HapDugme, Nesne, Tepsi } from '../../ui/fintech';
import { KIP_ADI, etkinKarakter, modKip } from '../../../shared/karakterler';
import { dinlemeDurumu, dinlemeSozu, type YerelSesDurumu } from '../../../shared/kurulum-taslak';
import { sesHataMetni } from '../../../shared/ses-kimligi';
import { KM } from '../../../shared/kurulum-metin';
import { sesBuBilgisayarda } from '../../../shared/nerede';
import { SES_BU_BILGISAYARDA } from '../../../shared/gizlilik-metni';
import { useAdim, type AdimBaglami } from '../baglam';
import { useGorunenKarakterAdi } from '../../karakter-gorunum';
import { Bas, Not, kademe } from '../Ortak';

const mb = (b: number) => `${Math.round(b / 1e6)} MB`;
/** Dalga çubukları (sabit desen; yükseklikler önizlemenin "ses imi"). */
const DALGA = [0.28, 0.46, 0.7, 0.52, 0.86, 0.6, 0.94, 0.72, 0.5, 0.82, 1, 0.66, 0.9, 0.58, 0.76, 0.44, 0.84, 0.62, 0.96, 0.7, 0.54, 0.8, 0.48, 0.66, 0.38, 0.56, 0.3, 0.42];

/** Önizleme ile adım aynı konuşmayı paylaşır (dalga çalarken canlanır). */
let konusmaDinleyici: ((v: boolean) => void) | null = null;

/** Ses bu bilgisayardan mı çıkıyor: Gizli ya da "Yalnız bu bilgisayar" (hesabın sesi kullanılmaz). Adım, Hazırsın özeti ve adımdan çıkarken indirme aynı kuralı okur. */
export const sesBilgisayardan = ({ nerede, ayar }: Pick<AdimBaglami, 'nerede' | 'ayar'>): boolean => nerede !== 'fuber' || sesBuBilgisayarda(ayar.yerel);

/** Yerel (bu bilgisayarın) sesin kurulumdaki gerçek hâli: Hazırsın özeti ve notu okur (shared/kurulum-taslak.ts sesOzeti, sesInmediNotu). Ses bilgisi
 *  bağlamdan gelir (tek abonelik; Kurulum2.tsx); gelene dek (yok) "kurulu" sayılır — var olmayan bir sorun söylenmez. */
export function yerelSesDurumu({ ayar, nerede, ses }: Pick<AdimBaglami, 'ayar' | 'nerede' | 'ses'>): YerelSesDurumu {
  const b = ses.bilgi;
  const ind = b?.yedek.indirme;
  return { seslendirme: ayar.ses.seslendirme, bilgisayardan: sesBilgisayardan({ nerede, ayar }), kurulu: b ? b.yedek.kurulu : true, yuzde: ind && !ind.hata && ind.yuzde < 100 ? ind.yuzde : null, hata: Boolean(ind?.hata) };
}

/** "Dinle"nin gerçek hâli: adım ve yan panel aynı sonucu okur. Ses bilgisi gelene dek sorun yok sayılır (var olmayan bir sorun söylenmez). */
const dinlemeHali = ({ ayar, nerede, siz, ses: { bilgi: b } }: Pick<AdimBaglami, 'ayar' | 'nerede' | 'ses' | 'siz'>) => dinlemeDurumu({
  bilgisayardan: sesBilgisayardan({ nerede, ayar }), hesapSesi: b ? b.hesapSesi === true : true, kurulu: b ? b.yedek.kurulu : true, hesapDurumu: ayar.hesap?.durum ?? null,
}, siz);

export function SesAdimi() {
  const baglam = useAdim();
  const { taslak: t, degistir, kaydet, ayar, nerede, siz, m, ses: { bilgi: b, yukle } } = baglam;
  // 0.14 T6b (Sade mod): görünen (ve "Dinle"de söylenen, ekrandaki sözle aynı) ad Sade'de "Fuber".
  const karakter = { ad: useGorunenKarakterAdi(etkinKarakter(t.mod, ayar.hesap?.karakterler).ad) };
  const [k, setK] = useState<FuberKonusmasi | null>(null);
  const [iniyor, setIniyor] = useState(false);
  const [hata, setHata] = useState('');
  useEffect(() => () => k?.kes(), [k]);
  useEffect(() => { konusmaDinleyici?.(Boolean(k)); }, [k]);
  const bilgisayar = sesBilgisayardan({ nerede, ayar });
  const dinleme = dinlemeHali(baglam);
  const kurulu = Boolean(b?.yedek.kurulu);
  const ind = b?.yedek.indirme;
  const cal = () => {
    if (k) { k.kes(); setK(null); return; }
    setHata('');
    const yeni = fuberSoyle(dinlemeSozu(karakter.ad, siz), 'onizleme', modKip(t.mod));
    setK(yeni);
    void yeni.sonuc.then((s) => {
      setK((x) => (x === yeni ? null : x));
      // "Ses yok" yalnız nedeni söylenmemişse: hesap onay bekliyorsa not zaten ekranda.
      if (s === 'yok') setHata(dinleme.not ? '' : 'Ses yok: bu bilgisayarın sesi henüz kurulu değil.');
      else if (s === 'hata') setHata(sesHataMetni(undefined, ayar.mod, 'dinle', siz));
    });
  };
  const indirVeCal = async () => {
    setHata(''); setIniyor(true);
    const r = await cagir<{ hata?: string }>('ses:yedek-kur').catch((e: Error) => ({ hata: e.message || 'hata' }));
    setIniyor(false);
    if (r?.hata) { setHata(m(KM.yedekSesInmedi)); return; }
    yukle();
    cal();
  };
  const indiriyor = iniyor || Boolean(ind && !ind.hata && ind.yuzde < 100);
  // Karakter iki durumda da konuşur; değişen yalnız sesin nereden çıktığı.
  const nasil = !dinleme.yerel ? 'bu sesle söylerim' : `${bilgisayar ? '' : 'şimdilik '}bu bilgisayardan söylerim. ${kurulu ? 'Çevrimdışı çalışır' : `Ses bir kez iner (${mb(b?.yedek.boyut ?? 86e6)})`}`;
  return (
    <div className="k2-adim" data-ses="">
      <Bas baslik="Sesimi dinle." giris={m(KM.sesGiris(karakter.ad, nasil))} />
      <div className="k2-dinle" {...kademe(2)}>
        {dinleme.indir ? (
          <HapDugme tur="ikincil" boy="b" simge={<Ikon ad="indir" olcu={15} />} bekliyor={indiriyor} onClick={() => void indirVeCal()} data-dinle="" data-yedek="indir">İndir ve dinle</HapDugme>
        ) : (
          <HapDugme tur="ikincil" boy="b" simge={<Ikon ad={k ? 'dur' : 'oynat'} olcu={14} />} onClick={cal} data-dinle="">{k ? 'Durdur' : 'Dinle'}</HapDugme>
        )}
        {indiriyor && ind && <span className="ft-not ft-sayi" role="status">İndiriliyor · %{ind.yuzde}</span>}
      </div>
      {dinleme.not && <Not nokta="kehribar" data-ses-not="">{dinleme.not}</Not>}
      {hata && <Not simge="uyari" data-ses-hata="">{hata}</Not>}
      <div className="k2-satirlar" {...kademe(3)}>
        <div className="k2-satir" data-sesli-konusma="">
          <span className="k2-satir__yazi"><b>Sesli konuşma</b><span>{m(KM.sesliKonusma)}</span></span>
          <Anahtar acik={ayar.ses.seslendirme} degistir={(v) => kaydet({ ses: { ...ayar.ses, seslendirme: v } })} etiket="Sesli konuşma" />
        </div>
        <div className="k2-satir" data-hey-fuber="">
          <span className="k2-satir__yazi"><b>“Hey Fuber”</b><span>{bilgisayar ? '“Hey Fuber” ve konuşma tanıma bu bilgisayarda çalışır.' : m(KM.heyFuber)}</span></span>
          <Anahtar acik={t.heyFuber} degistir={(v) => { degistir({ heyFuber: v }); kaydet({ ses: { ...ayar.ses, uyandirma: v } }); }} etiket="“Hey Fuber”" />
        </div>
      </div>
    </div>
  );
}

export function SesOnizleme() {
  const baglam = useAdim();
  const { taslak: t, ayar, nerede, siz, m } = baglam;
  const [caliyor, setCaliyor] = useState(false);
  useEffect(() => { konusmaDinleyici = setCaliyor; return () => { konusmaDinleyici = null; }; }, []);
  const karakter = { ad: useGorunenKarakterAdi(etkinKarakter(t.mod, ayar.hesap?.karakterler).ad) };
  const bilgisayar = sesBilgisayardan({ nerede, ayar });
  const dinleme = dinlemeHali(baglam);
  return (
    <Tepsi etiket="Ses önizlemesi" dip={bilgisayar ? SES_BU_BILGISAYARDA : dinleme.yerel ? 'Şimdilik bu bilgisayarın sesi.' : m(KM.sesDipHesap)}>
      <Nesne className="k2-ses" data-onizleme-ses={dinleme.yerel ? 'bilgisayar' : 'karakter'} data-caliyor={caliyor ? '' : undefined}>
        <div className="k2-ses__ust">
          <span className="k2-ses__ad"><b>{karakter.ad}</b><span>{dinleme.yerel ? 'Bu bilgisayarın sesi' : KIP_ADI[t.mod]}</span></span>
          <span className="ft-rozet" data-ses-rozet="">{caliyor ? 'Konuşuyor' : dinleme.rozet}</span>
        </div>
        <div className="k2-dalga" aria-hidden="true">
          {DALGA.map((h, i) => <i key={i} style={{ '--h': h, '--i': i } as CSSProperties} />)}
        </div>
        <p className="k2-ses__soz">“{dinlemeSozu(karakter.ad, siz)}”</p>
      </Nesne>
      <span className={`k2-hap${t.heyFuber ? '' : ' k2-hap--kapali'}`} data-onizleme-hey={t.heyFuber ? 'acik' : 'kapali'}>
        <span className={`ft-nokta${t.heyFuber ? ' ft-nokta--yesil ft-nokta--nabiz' : ''}`} aria-hidden="true" />
        {t.heyFuber ? '“Hey Fuber” dinleniyor' : '“Hey Fuber” kapalı'}
      </span>
    </Tepsi>
  );
}
