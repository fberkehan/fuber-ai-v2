// Kurulum v2 › Hazırsın (spec §1.9): özet kartı (seçimler) + "Fuber’i aç"; ardından 0.11 açılış animasyonu (renderer/main.tsx). Yapay
// zekânın hâli TEK nötr satır (shared/kurulum-yerel.ts hazirDurumu; motor durumu yalnız motor sinyalinden — I1, R19); her şey hazırsa yok.
// Sağda Wallet kartı gibi tek özet: üstte hitap (ekranın tek vurgusu), altında satırlar. 0.12 H3c: Nerede satırı seçimi ve yerel sürümü söyler;
// sürüm iniyorsa yüzdesi ve ince ilerleme çizgisi canlıdır (yerel:durum) — indirme arka planda sürer, "Fuber’i aç" beklemez. Düzeltme turu 1:
// özet kartının rozeti yerel seçimde gerçeği söyler ("İniyor · %N", "İnemedi"; Kü5); indirme hatası sakin bir satır + "Yeniden dene", önceden
// istenmiş başka bir indirme sürerken açıkça seçilen sürüm yok sayılmaz — satır söyler (Kü3). 0.13 T5: özet kipi ve karakteri, görünümü ve sesin
// gerçek hâlini söyler (yerel ses seçili ama inmediyse düz bir not; "Sesli konuşma" kapalıysa özet bunu söyler); tema "Fuber’i aç"la uygulanır
// (Kurulum2.tsx).
import { Ikon } from '../../bilesenler/Ikon';
import { CagirmaIpucu } from '../../kurulum/Adimlar';
import { MiniLogo, HapDugme, Tepsi } from '../../ui/fintech';
import { yerelHataSade } from '../../../shared/yerel-bekleyen';
import { TERIM, buyukBasla } from '../../../shared/terimler';
import { KM } from '../../../shared/kurulum-metin';
import { hazirDurumu } from '../../../shared/kurulum-yerel';
import { etkinKarakter } from '../../../shared/karakterler';
import { BAGLANTI_YOK, hazirsinMetinleri, ilkSozler, neredeOzeti, ozetSatirlari, sesInmediNotu } from '../../../shared/kurulum-taslak';
import { inenModel } from '../../bilesenler/NeredeSecimi';
import type { CSSProperties } from 'react';
import { useAdim } from '../baglam';
import { useKarakterGorunur } from '../../karakter-gorunum';
import { Bas, Not, kademe } from '../Ortak';
import { yerelSesDurumu } from './Ses';

export function HazirsinAdimi() {
  const baglam = useAdim();
  const { taslak: t, ayar, kip, motor, yerel: y, nerede, siz, m } = baglam;
  const sesNotu = sesInmediNotu(yerelSesDurumu(baglam));
  const metin = hazirsinMetinleri({ ad: t.ad, hitap: t.hitap, kip });
  // 0.13.1: örnek sözler izinlere ve bağlantıya bağlı (kurulum-metin.ts ilkSozCiftleri); yalnız bu bilgisayar / Gizli'de araç yok: örnekler bu bilgisayarda yapılabilenler.
  const sozler = ilkSozler({ eposta: ayar.eposta.some((e) => e.parolaVar), dosya: t.izin.dosyaOkuma, tarayici: t.izin.tarayici, yerel: nerede !== 'fuber' }, siz);
  const durum = hazirDurumu({
    mod: ayar.mod, gorunum: motor.gorunum, gizliMod: ayar.yerel.gizliMod === true, yerelHazir: y.kurulu && ayar.yerel.etkin === true,
    yerelIniyor: y.iniyor !== null, yerelIstendi: y.baslatildi || Boolean(ayar.yerel.bekleyenKurulum), gizliGeriAlindi: y.gizliGeriAlindi,
    yerelYarim: motor.yarim && !y.baslatildi, yalnizYerel: ayar.yerel.yalnizYerel === true && ayar.yerel.gizliMod !== true, yerelGeriAlindi: y.yerelGeriAlindi,
    yerelYuzde: y.iniyor, hesapsiz: !ayar.hesap, siz,
  });
  const sade = ayar.mod !== 'gelistirici';
  const kartAdi = (ad: string) => y.kd.katalog?.kartlar.find((x) => x.ad === ad)?.baslik ?? ad;
  // Kü3: hatayla biten indirme ve yok sayılmayan açık seçim (yazılar İş dilinde: sürüm adı, model yok).
  const hata = y.kurHata ? `${buyukBasla(TERIM.yzYerel)} inemedi: ${sade ? yerelHataSade(y.kurHata, siz) : y.kurHata}` : null;
  const surer = y.oncekiSurer ? m(KM.surer(kartAdi(y.oncekiSurer.inen), kartAdi(y.oncekiSurer.istenen))) : null;
  return (
    <div className="k2-adim" data-hazirsin="">
      <Bas baslik={metin.baslik} giris={metin.giris} />
      <div className="k2-cagir k2-cagir--buyuk" {...kademe(2)}>
        <span className="ft-etiket">Beni çağırmak için</span>
        <span className="k2-cagir__tuslar" data-cagir=""><CagirmaIpucu kisayol={ayar.ses.kisayol} uyandirma={t.heyFuber} /></span>
      </div>
      {/* 0.14 T32: yeniden açılan kurulumda da ilk sözler (sol sütun kısa kalıyordu; boşluk kuralı). */}
      {(kip === 'ilk' || kip === 'yeniden') && (
        <div className="k2-cagir" {...kademe(3)}>
          <span className="ft-etiket">{m(KM.baslayabilirsin)}</span>
          <ul className="k2-ornekler">
            {sozler.map((s) => <li key={s} data-soz=""><Ikon ad="sohbet" olcu={16} />{s}</li>)}
          </ul>
        </div>
      )}
      {hata ? (
        <div className="k2-hata-satiri" {...kademe(4)}>
          <Not simge="uyari" data-yerel-hata="">{hata}</Not>
          <HapDugme tur="ikincil" boy="k" onClick={y.yenidenDene} data-yerel-yeniden="">Yeniden dene</HapDugme>
        </div>
      ) : durum && <div {...kademe(4)}><Not nokta="kehribar" data-hazir-durumu="">{durum}</Not></div>}
      {surer && <div {...kademe(5)}><Not nokta="kehribar" data-onceki-surer="">{surer}</Not></div>}
      {sesNotu && <div {...kademe(5)}><Not nokta="kehribar" data-ses-inmedi="">{sesNotu}</Not></div>}
    </div>
  );
}

export function HazirsinOnizleme() {
  const baglam = useAdim();
  const { taslak: t, ayar, nerede, yerel: y, m } = baglam;
  const karakter = etkinKarakter(t.mod, ayar.hesap?.karakterler);
  // 0.14 T6b (Sade mod): Kullanım satırında hayvan adı yok (yalnız kipin adı).
  const gorunur = useKarakterGorunur();
  // Nerede satırı: uygulanan seçim + hazırlanan sürüm (inen > istenen kurulum > ayardaki kurulu sürüm) + inerken yüzde.
  const inen = inenModel(y.kd.d);
  const surumAdi = inen?.ad ?? ayar.yerel.bekleyenKurulum?.model ?? ayar.yerel.model;
  const kart = nerede === 'fuber' ? null : y.kd.katalog?.kartlar.find((k) => k.ad === surumAdi) ?? null;
  // 0.13.1: dört satır (Kullanım, Nerede, Bağlantılar, İzinler); ad başlıkta, kartta tekrar etmez. Hesap, mesai, sabah özeti, görünüm ve ses
  // satırları kalktı (ekranlarında görüldü; ses ve indirme durumları sol sütundaki notlarda).
  const satirlar = ozetSatirlari(t, {
    epostaSayisi: ayar.eposta.filter((e) => e.parolaVar).length, whatsapp: ayar.whatsapp.bagli === true,
    nerede: neredeOzeti(nerede, kart ? { etiket: kart.baslik, kurulu: kart.kurulu, yuzde: inen?.ad === kart.ad ? inen.yuzde : null } : null),
    karakter: gorunur ? karakter.ad : undefined,
  });
  const yuzde = kart && inen?.ad === kart.ad ? inen.yuzde : null;
  // Kü5: yerel seçimde rozet gerçeği söyler — inerken "İniyor · %N" (0'da da), hata "İnemedi"; hazırsa yeşil "Hazır".
  // 0.13.1: e-postası doğrulanmamış hesapta yeşil "Hazır" yok — kehribar "Doğrulama bekliyor".
  const yerelRozet = nerede === 'fuber' || !kart ? null : y.kurHata ? 'İnemedi' : yuzde !== null ? `İniyor · %${yuzde}` : !kart.kurulu ? 'İniyor' : null;
  const rozet = yerelRozet;
  return (
    <Tepsi etiket="Kurulum özeti" dip={m(KM.hazirsinDip)}>
      <div className="k2-ozet" data-ozet-karti="">
        <div className="k2-ozet__ust">
          <MiniLogo olcu={28} />
          <span className="k2-ozet__hazir" data-ozet-rozeti={yerelRozet ? 'yerel' : 'hazir'}><span className={`ft-nokta ${rozet ? 'ft-nokta--kehribar' : 'ft-nokta--yesil'}`} aria-hidden="true" />{rozet ?? 'Hazır'}</span>
        </div>
        {/* 0.13.1: ad başlıkta (soldaki Hazırsın başlığı); kartta tekrar etmez — küçük "Özet". */}
        <p className="k2-ozet__baslik">Özet</p>
        <dl className="k2-ozet__liste">
          {satirlar.map(([k, v]) => (
            <div key={k} data-ozet-satiri={k} data-bos={k === 'Bağlantılar' && v === BAGLANTI_YOK ? '' : undefined}>
              <dt>{k}</dt><dd>{v}</dd>
              {k === 'Nerede' && yuzde !== null && <span className="k2-ozet__cubuk" role="progressbar" aria-label={`${kart?.baslik ?? 'Sürüm'} indirmesi`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={yuzde}><i style={{ '--ft-oran': yuzde / 100 } as CSSProperties} /></span>}
            </div>
          ))}
        </dl>
      </div>
    </Tepsi>
  );
}
