// Kurulum v2 › Hoş geldin (spec §1.1): "Fuber’e hoş geldin" ve tek düğme; sağda 0.11 açılış işaretinin BÜYÜK hâli. Açılış örtüsü
// (acilis/Acilis.tsx) ilk gösterimde üstte oynarken işaret bekler; örtü kalkınca kendi animasyonunu oynar (iki kez görünmesin).
// Önizlemenin canlı satırı: bugünün tarihi ve saati. H3a düzeltme turu 1 (Ö3): başlık iki satır ("Fuber’e / hoş geldin."), maddeler başlık +
// tek cümle; önizlemede işaretin altında adanın ilk sözü (kurulumdan sonra Fuber'in ekranda durduğu yer) — iki sütun da dolu.
import { useEffect, useState } from 'react';
import { Ikon } from '../../bilesenler/Ikon';
import { MiniLogo, IsaretAnimasyonu, Tepsi } from '../../ui/fintech';
import { useAdim } from '../baglam';
import { Bas, kademe } from '../Ortak';

/** [simge, başlık, tek cümle] */
const MADDELER_ILK: readonly [string, string, string][] = [
  ['kilit', 'Hafızan bu bilgisayarda', 'Sohbetlerin ve öğrendiklerim bu bilgisayarda saklanır.'],
  // 0.13.1: yazıda sayı yok (adımlar eklenip çıkarılınca sayı yalan olurdu: tests/kurulum-cila.test.ts).
  ['saat', 'Birkaç dakika', 'Çoğunda “Devam” yeter.'],
  ['ada', 'Ekranın üstündeyim', 'Kurulumdan sonra bir kısayolla yanında olurum.'],
  ['kalkan', 'Önemli adımda sorarım', 'Gönderim, silme ve ödeme her zaman onayını bekler.'],
];
const MADDELER_YENIDEN: readonly [string, string, string][] = [
  ['kilit', 'Hafızan olduğu gibi', 'Sohbetlerin ve öğrendiklerim yerinde kalır.'],
  ['tamam', '“Bitti” yalnız ayarları kaydeder', 'Seçimlerin güncellenir; kurulum baştan yapılmaz.'],
  ['kapat', 'Esc ile çıkarsın', 'Değişiklikleri geri alıp kapatır.'],
];

export function HosgeldinAdimi() {
  const { kip } = useAdim();
  const yeniden = kip === 'yeniden';
  const maddeler = yeniden ? MADDELER_YENIDEN : MADDELER_ILK;
  return (
    <div className="k2-adim" data-hosgeldin="">
      <Bas
        baslik={yeniden ? 'Kurulumu gözden geçir.' : <>Fuber’e{' '}<br />hoş geldin.</>}
        giris={yeniden ? 'Seçimlerin şimdiki ayarlarınla dolu. Değiştirmek istediğini değiştir, gerisini “Devam”la geç.' : 'Seni tanıyıp işe hazır olurum. Hepsini sonra Ayarlar’dan değiştirebilirsin.'}
      />
      <ul className="k2-maddeler" {...kademe(2)}>
        {maddeler.map(([simge, baslik, metin]) => (
          <li key={simge}>
            <span className="k2-maddeler__simge" aria-hidden="true"><Ikon ad={simge} olcu={18} /></span>
            <span className="k2-maddeler__yazi"><b>{baslik}</b><span>{metin}</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Açılış örtüsü (.acilis) ekrandaysa kalkmasını bekler (en çok 4 sn), sonra true. */
function useOrtuBitti(): boolean {
  const [bitti, setBitti] = useState(() => !document.querySelector('.acilis'));
  useEffect(() => {
    if (bitti) return;
    const bas = Date.now();
    const z = setInterval(() => { if (!document.querySelector('.acilis') || Date.now() - bas > 4000) { setBitti(true); clearInterval(z); } }, 80);
    return () => clearInterval(z);
  }, [bitti]);
  return bitti;
}

export function HosgeldinOnizleme() {
  const { simdi } = useAdim();
  const oyna = useOrtuBitti();
  const tarih = simdi.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
  const saat = simdi.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  return (
    <Tepsi etiket="Fuber" className="k2-hosgeldin" dip={<span className="ft-sayi" data-canli-saat="">{tarih} · {saat}</span>}>
      <IsaretAnimasyonu oyna={oyna} />
      {/* Adanın ilk sözü: işaret oynadıktan sonra belirir (azaltılmış harekette yalnız opaklık). */}
      <div className="k2-ada-soz k2-hosgeldin__ada" data-oyna={oyna ? 'evet' : 'bekle'} data-onizleme-ada="">
        <span className="k2-ada-soz__isaret" aria-hidden="true"><MiniLogo olcu={15} /></span>
        <span className="k2-ada-soz__yazi"><b>Merhaba, ben Fuber.</b><span>Hazır olduğunda başlayalım.</span></span>
      </div>
    </Tepsi>
  );
}
