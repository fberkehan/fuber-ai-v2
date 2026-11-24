// Kurulum v2 › Günün (spec §1.4): çalışma saatleri (segment: Erken · Klasik · Geç + iki saat seçici) ve sabah özeti saati. Mesai dışı
// sessiz saat olur (kurulum:tamamla → shared/kurulum-adimlari.ts sessizSaatleri; gece vardiyası eşlenmez). Sağda gün şeridi canlı: mesai
// bandı, sabah özeti işareti, şimdi çizgisi, mesainin süresi büyük sayıyla.
import type { CSSProperties } from 'react';
import { Ikon } from '../../bilesenler/Ikon';
import { Anahtar, BuyukSayi, Nesne, SaatSecici, Segment, Tepsi } from '../../ui/fintech';
import { GUN_KALIPLARI, gunKalibi, gunSeridi, sureMetni } from '../../../shared/kurulum-taslak';
import { GUN_VARSAYILAN, sessizUygulanirMi } from '../../../shared/kurulum-adimlari';
import { KM } from '../../../shared/kurulum-metin';
import type { AdimBaglami } from '../baglam';
import { useAdim } from '../baglam';
import { Bas, kademe } from '../Ortak';

/** Saatler sessiz saate eşlenecek mi (kurulum:tamamla / "Bitti"): ilk kurulumda, kayıtlı ya da sessiz saatten türetilmiş saatte ya da
 *  kullanıcı değiştirince — gece yarısını aşan mesai eşlenmez. Metin ve önizleme yalnız buna göre sessizlik söz verir (I1 5b). */
const sessizUygulanir = (b: Pick<AdimBaglami, 'kip' | 'taslak' | 'gunAcilis'>) => sessizUygulanirMi({
  kip: b.kip === 'ilk' ? 'ilk' : 'yeniden', kaynak: b.gunAcilis.kaynak, dokunuldu: b.taslak.gunBas !== b.gunAcilis.bas || b.taslak.gunBit !== b.gunAcilis.bit,
  gunBas: b.taslak.gunBas, gunBit: b.taslak.gunBit, sabah: b.taslak.sabah,
});

export function GununAdimi() {
  const b = useAdim();
  const { taslak: t, degistir, m } = b;
  const sessiz = sessizUygulanir(b);
  const kalip = gunKalibi(t.gunBas, t.gunBit);
  const mac = window.fuber?.platform === 'darwin';
  return (
    <div className="k2-adim" data-gunun="">
      <Bas baslik={m(KM.gunBaslik)} giris={m(sessiz ? KM.gunGirisSessiz : KM.gunGirisAyar)} />
      <div className="k2-alanlar" {...kademe(2)}>
        <div className="ft-alan">
          <span className="ft-etiket">{m(KM.calismaSaatleri)}</span>
          <Segment etiket="Çalışma saatleri" deger={kalip} secenekler={GUN_KALIPLARI.map(([id, , , ad]) => [id, ad] as const)}
            sec={(id) => { const k = GUN_KALIPLARI.find(([x]) => x === id); if (k) degistir({ gunBas: k[1], gunBit: k[2] }); }} />
        </div>
        <div className="k2-saatler">
          <div className="ft-alan"><span className="ft-etiket">Başlangıç</span><SaatSecici etiket="Çalışma başlangıcı" deger={t.gunBas} degistir={(gunBas) => degistir({ gunBas })} /></div>
          <span className="k2-saatler__ara" aria-hidden="true">–</span>
          <div className="ft-alan"><span className="ft-etiket">Bitiş</span><SaatSecici etiket="Çalışma bitişi" deger={t.gunBit} degistir={(gunBit) => degistir({ gunBit })} /></div>
        </div>
        <div className="k2-satir" data-sabah="">
          <span className="k2-satir__yazi"><b>Sabah özeti</b><span>{m(t.sabah ? KM.sabahAcik : KM.sabahKapali)}</span></span>
          {t.sabah && <SaatSecici kucuk etiket="Sabah özeti saati" deger={t.sabah} degistir={(sabah) => degistir({ sabah })} />}
          <Anahtar acik={Boolean(t.sabah)} degistir={(v) => degistir({ sabah: v ? GUN_VARSAYILAN.sabah : '' })} etiket="Sabah özeti" />
        </div>
        {/* 0.13.1: söz tutulur — "Fuber kapalıyken sabah özeti gelmez" notu yerine anahtar (varsayılan açık; kurulum bitince uygulanır). Sabah özeti kapalıyken de durur. */}
        <div className="k2-satir" data-baslangic="">
          <span className="k2-satir__yazi"><b>{mac ? 'Mac açılınca başlat' : 'Windows açılınca başlat'}</b><span>{m(KM.baslangicAlt)}</span></span>
          <Anahtar acik={t.baslangictaAc} degistir={(baslangictaAc) => degistir({ baslangictaAc })} etiket={mac ? 'Mac açılınca başlat' : 'Windows açılınca başlat'} />
        </div>
      </div>
    </div>
  );
}

const SAATLER = [0, 6, 12, 18, 24];

export function GununOnizleme() {
  const b = useAdim();
  const { taslak: t, simdi, m } = b;
  const s = gunSeridi(t.gunBas, t.gunBit, t.sabah);
  const sessiz = sessizUygulanir(b) ? s.sessiz : null;
  const simdiYuzde = ((simdi.getHours() * 60 + simdi.getMinutes()) / 1440) * 100;
  // Bugünün akışı (saate göre sıralı): sabah özeti, mesai başı, sessiz saat.
  const akis = ([
    ...(t.sabah ? [[t.sabah, 'sabah', 'Sabah özeti gelir']] : []),
    [t.gunBas, 'mesai', m(KM.akisMesai)],
    [t.gunBit, 'sessiz', sessiz ? 'Sessiz saatler, yalnız hatırlatıcılar' : 'Mesai biter'],
  ] as [string, string, string][]).sort((a, b) => a[0].localeCompare(b[0]));
  return (
    <Tepsi etiket="Gün şeridi önizlemesi" dip={sessiz ? <><Ikon ad="ay" olcu={14} /> Sessiz saatler <span className="ft-sayi">{sessiz.sessizBaslangic} – {sessiz.sessizBitis}</span></> : m(KM.gunDipAyar)}>
      <Nesne className="k2-gun" data-onizleme-gun="">
        <div className="k2-gun__sayilar">
          <BuyukSayi deger={sureMetni(s.sure)} etiket={`Mesai · ${t.gunBas}–${t.gunBit}`} />
          <BuyukSayi deger={t.sabah || 'Kapalı'} etiket="Sabah özeti" />
        </div>
        <div className="k2-serit" aria-hidden="true">
          <div className="k2-serit__iz">
            {s.mesai.map((m, i) => <span key={i} className="k2-serit__mesai" style={{ left: `${m.bas}%`, width: `${Math.max(0.5, m.bit - m.bas)}%` } as CSSProperties} />)}
            {s.sabah !== null && <span className="k2-serit__sabah" style={{ left: `${s.sabah}%` }} data-serit-sabah="" />}
            <span className="k2-serit__simdi" style={{ left: `${simdiYuzde}%` }} />
          </div>
          <div className="k2-serit__saatler">{SAATLER.map((h) => <span key={h} className="ft-sayi" style={{ left: `${(h / 24) * 100}%` }}>{String(h).padStart(2, '0')}</span>)}</div>
        </div>
        <div className="k2-gun__lejant">
          <span><i className="k2-lejant k2-lejant--mesai" />Mesai</span>
          {t.sabah && <span><i className="k2-lejant k2-lejant--sabah" />Sabah özeti</span>}
          <span><i className="k2-lejant k2-lejant--simdi" />Şimdi</span>
        </div>
      </Nesne>
      <Nesne className="k2-gun-akisi">
        <ul className="k2-akis-listesi" data-onizleme-akis="">
          {akis.map(([saat, tur, metin]) => <li key={`${saat}-${tur}`}><b>{saat}</b><i data-tur={tur} aria-hidden="true" /><span>{metin}</span></li>)}
        </ul>
      </Nesne>
    </Tepsi>
  );
}
