// ── Kurulum › Ses: Fuber'in sesi — tek "Dinle" ve konuşma hızı (0.10 E4, K6; G8: C-12, C-13) ─────────────────────────────────────
// Fuber'in belirli bir sesi var; ElevenLabs sağlam olmalı (K3). Sayfada
// sağlayıcı adı, anahtar alanı ve ses listesi YOK (iki modda da; Geliştirici sesi ve kendi anahtarını Ayarlar → Ses'ten değiştirir).
// Kart tek ses ve TEK "Dinle":
//   · hesabın sesi ya da kendi anahtarlı ses → "Dinle" hemen çalar (renderer/fuber-sesi.ts; Ayarlar'la aynı düğme);
//   · bu bilgisayardaki yedek ses kuruluysa → "Dinle" çalar (internetsiz, Gizli modda da);
//   · hiçbiri yoksa → "Dinle" yedek sesi BİR KEZ indirir ("İndiriliyor… (86 MB, bir kez)"), biter bitmez örneği çalar; inmezse başlık
//     "Yedek ses inmedi" (C-13) ve "Yeniden dene" — kurulum sürer.
// Alt şeritteki "Devam" ekranın tek birincil düğmesidir ("Dinle" ikincil). Hız anında kaydedilir.
import { useState } from 'react';
import { cagir } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { DinleDugmesi, useSesBilgisi } from '../ayarlar/SesSecimi';
import { etkinKarakter } from '../../shared/karakterler';
import { SES_HIZLARI, YEDEK_SES_INMEDI } from '../../shared/ses-kimligi';
import type { Ayarlar, SesBilgisi } from '../../shared/tipler';
import { GIZLI_SES, YEDEK_SES_NASIL } from '../../shared/gizlilik-metni';
import { Bas } from './Adimlar';

const mb = (b: number) => `${Math.round(b / 1e6)} MB`;

export type SesKartDurumu = 'bekle' | 'hazir' | 'yedek' | 'indir' | 'iniyor' | 'hata';
/** Kartın hâli: çalacak ses hazır (hesap / kendi anahtarı), kurulu yedek ses, indirilecek / inen / inmeyen yedek ses. */
export function sesKartDurumu(b: SesBilgisi | null, istek: boolean, hata: string): SesKartDurumu {
  if (!b) return 'bekle';
  if (b.motor === 'elevenlabs') return 'hazir';
  if (b.motor === 'yerel' || b.yedek.kurulu) return 'yedek';
  const ind = b.yedek.indirme;
  if (istek || (ind && !ind.hata && ind.yuzde < 100)) return 'iniyor';
  if (hata || ind?.hata) return 'hata';
  return 'indir';
}

export function SesAdimi({ ayar, kaydet }: { ayar: Ayarlar; kaydet: (d: Partial<Ayarlar>) => void }) {
  const [b, yukle] = useSesBilgisi();
  const gel = ayar.mod === 'gelistirici';
  const [istek, setIstek] = useState(false);
  const [hata, setHata] = useState('');
  const [otomatik, setOtomatik] = useState(0); // indirme bitince örnek kendiliğinden bir kez çalar
  const durum = sesKartDurumu(b, istek, hata);

  /** Yedek ses yokken "Dinle" / "Yeniden dene": bir kez iner (ana süreç; ilerleme 'ses:durum'la gelir), biter bitmez örnek çalar. */
  const indirVeDinle = async () => {
    setHata(''); setIstek(true);
    const r = await cagir<{ hata?: string }>('ses:yedek-kur').catch((e: Error) => ({ hata: e.message || 'bilinmeyen hata' }));
    setIstek(false);
    if (r?.hata) { setHata(r.hata); return; }
    yukle();
    setOtomatik((n) => n + 1);
  };

  const ind = b?.yedek.indirme;
  const boyut = mb(b?.yedek.boyut ?? 86e6);
  const baslik = durum === 'hata' ? 'Yedek ses inmedi' : 'Fuber’in sesi';
  const alt = durum === 'hazir' ? (b?.hesapSesi ? 'Hesabınla gelir; her yerde aynı ses.' : gel && b?.ses?.ad ? `${b.ses.ad} · kendi hesabınla` : 'Her yerde aynı ses.')
    : durum === 'yedek' ? (b?.gizliMod ? GIZLI_SES : `${YEDEK_SES_NASIL}.`)
    : durum === 'iniyor' ? `İndiriliyor… (${boyut}, bir kez)`
    : durum === 'hata' ? YEDEK_SES_INMEDI
    : durum === 'indir' ? `Dinleyince bir kez iner (${boyut}); sonra internetsiz de konuşurum.`
    : '';

  return (
    <>
      <Bas baslik="Sesimi bir dinle." giris="Yanıtlarda, hatırlatıcılarda ve ekranın üstünde hep bu sesle konuşurum." />
      <div className="kart ses-karti" data-ses-durum={durum} data-ses-motoru={b?.motor ?? 'yok'}>
        <span className="ses-karti__simge" aria-hidden="true"><Ikon ad="dalga" olcu={20} /></span>
        <span className="ses-karti__yazi">
          <b>{baslik}</b>
          {alt && <span role={durum === 'hata' || durum === 'iniyor' ? 'status' : undefined} title={gel && durum === 'hata' ? (hata || ind?.hata) : undefined}>{alt}</span>}
          {durum === 'iniyor' && <span className="ses-karti__ilerleme" data-yedek="iniyor"><span className="ilerleme"><i style={{ width: `${Math.max(2, ind?.yuzde ?? 0)}%` }} /></span><span>%{ind?.yuzde ?? 0}</span></span>}
        </span>
        {durum === 'hazir' || durum === 'yedek' ? <DinleDugmesi ad={etkinKarakter(ayar.mod, ayar.hesap?.karakterler).ad} otomatik={otomatik} />
          : durum === 'indir' ? <button type="button" className="dgm dgm--koyu dgm--k" data-dinle="" data-yedek="indir" onClick={() => void indirVeDinle()}><Ikon ad="oynat" olcu={13} />Dinle</button>
          : durum === 'hata' ? <button type="button" className="dgm dgm--koyu dgm--k" data-yedek="yeniden" onClick={() => void indirVeDinle()}>Yeniden dene</button>
          : <button type="button" className="dgm dgm--koyu dgm--k" data-dinle="" disabled><Ikon ad="oynat" olcu={13} />Dinle</button>}
      </div>
      <div className="izin-listesi">
        <div className="izin-satiri" data-hiz="">
          <span className="izin-satiri__yazi"><b>Konuşma hızı</b><span>Yanıtları ne hızda okuyayım?</span></span>
          <div className="sekmeler" role="radiogroup" aria-label="Konuşma hızı">
            {SES_HIZLARI.map(([h, ad]) => (
              <button key={h} type="button" role="radio" aria-checked={Math.abs((ayar.ses.hiz ?? 1) - h) < 0.01} onClick={() => kaydet({ ses: { ...ayar.ses, hiz: h } })}>{ad}</button>
            ))}
          </div>
        </div>
      </div>
      {gel && <p className="kurulum__dip">Başka bir ses ya da kendi ses hesabın: Ayarlar → Ses.</p>}
    </>
  );
}
