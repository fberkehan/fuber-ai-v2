// Ayarlar → Ses ve ada → Sesli yanıt: "Şu anki karakterin sesi" (Görev 21, K9; 0.13 spec A, C). Kullanıcı ses SEÇMEZ: ses kipin karakterine
// bağlıdır ve Yönetim'den atanır; kip değişince ses de değişir. Kart: şu anki karakter + "Dinle" (akışlı, aynı yol: renderer/fuber-sesi.ts) ve
// hız. Ses listesi, hesabın sesleri ve ElevenLabs anahtarı satırı kalktı. Gizli ve "Yalnız bu bilgisayar"da ses bu bilgisayardaki yedek sestir
// (indir). Geliştirici'de son ilk ses gecikmesi görünür.
import { useEffect, useState } from 'react';
import { cagir, dinle } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { fuberSoyle, type FuberKonusmasi } from '../fuber-sesi';
import { KIP_ADI, etkinKarakter, modKip, type KipKimligi } from '../../shared/karakterler';
import { dinlemeSozu } from '../../shared/kurulum-taslak';
import { gorunenKarakterAdi, karakterGorunurMu } from '../../shared/karakter-gorunum';
import { SES_HIZLARI, SES_IS_NOTU, sesHataMetni } from '../../shared/ses-kimligi';
import type { SesBilgisi } from '../../shared/tipler';
import { GIZLI_SES } from '../../shared/gizlilik-metni';
import { useAyarlar } from './baglam';
import { AyarBolgesi, Satir, useAyarTanimi } from './Ortak';

const mb =(b: number) => `${Math.round(b / 1e6)} MB`;

/** Ses bilgisi (ana süreç; anahtar, yedek ses indirmesi, gecikmeler) — ayar ve ses olaylarıyla tazelenir. */
export function useSesBilgisi(): [SesBilgisi | null, () => void] {
  const [b, setB] = useState<SesBilgisi | null>(null);
  const yukle = () => void cagir<SesBilgisi>('ses:bilgi').then(setB).catch(() => undefined);
  useEffect(() => {
    yukle();
    const k = [dinle('ses:durum', (y: SesBilgisi) => setB(y)), dinle('ayarlar:degisti', () => yukle())];
    return () => k.forEach((f) => f());
  }, []);
  return [b, yukle];
}

/** "Dinle" düğmesi: çalarken "Durdur" olur; `ad`: konuşan karakter kendini tanıtır; `kip` verilirse o kipin karakteri konuşur (yoksa şu anki kip). Eski kurulum sihirbazının Ses adımı da kullanır.
 *  `otomatik`: sıfırdan büyük her yeni değerde örnek kendiliğinden bir kez çalar (Ses adımı: yedek ses inince — "İndir ve dinle"). */
export function DinleDugmesi({ ad, kip, devreDisi, etiket = 'Dinle', otomatik = 0 }: { ad: string; kip?: KipKimligi; devreDisi?: boolean; etiket?: string; otomatik?: number }) {
  const [k, setK] = useState<FuberKonusmasi | null>(null);
  const [hata, setHata] = useState('');
  useEffect(() => () => k?.kes(), [k]);
  useEffect(() => { if (otomatik > 0 && !devreDisi) bas(); }, [otomatik]); // eslint-disable-line react-hooks/exhaustive-deps
  const bas = () => {
    if (k) { k.kes(); setK(null); return; }
    setHata('');
    const yeni = fuberSoyle(dinlemeSozu(ad), 'onizleme', kip);
    setK(yeni);
    void yeni.sonuc.then((s) => {
      setK((x) => (x === yeni ? null : x));
      if (s === 'yok') setHata('Ses yok: yedek ses kurulu değil.');
      else if (s === 'hata') setHata('Ses şu an üretilemedi; bağlantıyı denetleyip yeniden dene.');
    });
  };
  return (
    <span className="ses-secimi__dinle">
      {hata && <span className="t-kucuk ayar__sorun" role="status">{hata}</span>}
      <button type="button" className="dgm dgm--koyu dgm--k" data-dinle="" disabled={devreDisi} onClick={bas}><Ikon ad={k ? 'dur' : 'oynat'} olcu={13} />{k ? 'Durdur' : etiket}</button>
    </span>
  );
}

/** Şu anki karakterin sesi: karakter + kip adı + Dinle (iki mod); Geliştirici'de son gecikme. */
function FuberinSesi({ b }: { b: SesBilgisi | null }) {
  const { a, mod } = useAyarlar();
  const t = useAyarTanimi('ses-saglayici');
  if (!t) return null;
  const gel = mod === 'gelistirici';
  // 0.14 T6b (Sade mod): görünen ve "Dinle"de söylenen ad Sade'de "Fuber".
  const karakter = { ad: gorunenKarakterAdi(karakterGorunurMu(a), etkinKarakter(a.mod, a.hesap?.karakterler).ad) };
  // Yerel (Piper) motor tek ses çalar: karakter adı ses diye gösterilmez, bu bilgisayarın sesinin kullanıldığı düz söylenir.
  const sesAdi = !b ? '…' : b.motor === 'yerel' ? 'Bu bilgisayarın sesi kullanılıyor' : b.motor ? `${karakter.ad} · ${KIP_ADI[a.mod]}` : 'Ses kapalı — yanıtlar yazı olarak';
  const alt = !b ? '' : b.gizliMod ? GIZLI_SES : b.yalnizYerel ? '“Yalnız bu bilgisayar” seçili: ses de bu bilgisayarda üretilir.' : b.motor === 'yerel' ? SES_IS_NOTU : b.motor ? 'Ses karaktere bağlıdır; modu değiştirince ses de değişir.' : SES_IS_NOTU;
  const gecikme = b?.sonGecikmeler?.[0];
  return (
    <AyarBolgesi id="ses-saglayici" className="ses-secimi">
      <div className="ses-karti">
        <span className="ses-karti__simge" aria-hidden="true"><Ikon ad="dalga" olcu={18} /></span>
        <span className="ses-karti__metin">
          <b>{t.ad}</b>
          <span className="ses-karti__ad" data-ses-motoru={b?.motor ?? 'yok'}>{sesAdi}</span>
          {alt && <span className="ses-karti__alt">{alt}</span>}
          {gel && gecikme && <span className="ses-karti__alt" data-son-gecikme={gecikme.ms}>Son konuşmada ilk ses: {gecikme.ms} ms</span>}
        </span>
        <DinleDugmesi ad={karakter.ad} kip={modKip(a.mod)} devreDisi={!b?.motor} />
      </div>
      <span className="t-kucuk">{t.aciklama}</span>
    </AyarBolgesi>
  );
}

/** Yedek ses: kurulu mu, değilse indir (≈ 85 MB, ilerlemeli). */
function YedekSesSatiri({ b }: { b: SesBilgisi | null }) {
  const { mod } = useAyarlar();
  const [hata, setHata] = useState('');
  const ind = b?.yedek.indirme;
  const iniyor = Boolean(ind && !ind.hata && ind.yuzde < 100);
  const indir = async () => {
    setHata('');
    const r = await cagir<SesBilgisi & { hata?: string }>('ses:yedek-kur').catch((e: Error) => ({ hata: e.message }) as { hata: string });
    if ('hata' in r && r.hata) setHata(r.hata);
  };
  // İş modunda ham indirme hatası (adres, HTTP kodu, SHA) görünmez: sade cümle (düzeltme 7). Geliştirici'de ayrıntı.
  const sorun = ind?.hata || hata;
  const sorunMetni = !sorun ? '' : mod === 'gelistirici' ? `İndirme durdu: ${sorun}` : sesHataMetni(sorun, mod, 'indir');
  return (
    <Satir id="yedek-ses" ek={sorunMetni ? <em className="ayar__sorun"> {sorunMetni}</em> : ''}>
      {b?.yedek.kurulu
        ? <span className="hap" data-yedek="kurulu"><span className="nokta nokta--yesil" />Kurulu</span>
        : iniyor
          ? <span className="ses-yedek__ilerleme" data-yedek="iniyor"><span className="ilerleme"><i style={{ width: `${Math.max(2, ind!.yuzde)}%` }} /></span><span className="t-kucuk">%{ind!.yuzde}</span></span>
          : <button type="button" className="dgm dgm--koyu dgm--k" data-yedek="indir" disabled={!b} onClick={() => void indir()}><Ikon ad="ice" olcu={14} />İndir · {mb(b?.yedek.boyut ?? 85e6)}</button>}
    </Satir>
  );
}

function HizSatiri() {
  const { a, kaydet } = useAyarlar();
  const hiz = a.ses.hiz ?? 1;
  return (
    <Satir id="ses-hizi">
      <div className="sekmeler" role="radiogroup" aria-label="Konuşma hızı">
        {SES_HIZLARI.map(([h, ad]) => <button key={h} type="button" role="radio" aria-checked={Math.abs(hiz - h) < 0.01} onClick={() => kaydet({ ses: { ...a.ses, hiz: h } })}>{ad}</button>)}
      </div>
    </Satir>
  );
}

export function SesSecimi() {
  const [b] = useSesBilgisi();
  return (
    <>
      <FuberinSesi b={b} />
      <YedekSesSatiri b={b} />
      <HizSatiri />
    </>
  );
}
