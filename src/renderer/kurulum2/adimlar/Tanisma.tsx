// Kurulum v2 › Seni tanıyayım (spec §1.3; 0.13 spec B): ad + hitap + şirket. Hiçbiri zorunlu değil. Rol çipleri kalktı: mod değildi, yalnız örnek
// cümleyi değiştiriyordu (kipi sonraki adım sorar; kayıtlı rol silinmez). Sağda kokpitin selamı canlı: "Günaydın, Deniz Bey." — saat gerçek,
// şirket adı kokpitin başlığında, odak satırı örnek bir gün ("örnek gün" diye işaretli).
import { Ikon } from '../../bilesenler/Ikon';
import { Alan, CipGrubu, MiniLogo, Girdi, Nesne, Tepsi } from '../../ui/fintech';
import { HITAPLAR, selamCumlesi } from '../../../shared/kurulum-taslak';
import { hitapMetni } from '../../../shared/hitap';
import { KM } from '../../../shared/kurulum-metin';
import { useAdim } from '../baglam';
import { Bas, kademe } from '../Ortak';

export function TanismaAdimi() {
  const { taslak: t, degistir } = useAdim();
  // Kayıtlı hitap çiplerde yoksa ("Patron") kendi çipiyle görünür.
  const hitaplar = t.hitap && !HITAPLAR.some(([d]) => d === t.hitap) ? [...HITAPLAR, [t.hitap, t.hitap] as const] : HITAPLAR;
  return (
    <div className="k2-adim" data-tanisma="">
      <Bas baslik="Seni tanıyayım." giris="Adını söylersen sana öyle seslenirim. Şirketini söylersen işini daha iyi anlarım." />
      <div className="k2-alanlar" {...kademe(2)}>
        <Alan etiket="Adın">{(id) => <Girdi id={id} autoFocus value={t.ad} maxLength={60} placeholder="Adın" autoComplete="given-name" spellCheck={false} onChange={(e) => degistir({ ad: e.target.value })} data-alan="ad" />}</Alan>
        <div className="ft-alan">
          <span className="ft-etiket" id="k2-hitap">Nasıl hitap edeyim?</span>
          <CipGrubu etiket="Hitap" secenekler={hitaplar} deger={t.hitap} sec={(hitap) => degistir({ hitap })} />
        </div>
        <Alan etiket="Şirketin" ipucu="isteğe bağlı">{(id) => <Girdi id={id} value={t.sirket} maxLength={80} placeholder="Şirketinin adı" autoComplete="organization" spellCheck={false} onChange={(e) => degistir({ sirket: e.target.value })} data-alan="sirket" />}</Alan>
      </div>
    </div>
  );
}

/** Kokpitin karşılama kartı (Adım 3'ün önizlemesi; Adım 7 Görünüm'ün temalı önizlemesi aynı kartı çizer). */
export function KokpitKarti() {
  const { taslak: t, simdi, m } = useAdim();
  const tarih = simdi.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
  const saat = simdi.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  return (
    <Nesne className="k2-kokpit" data-onizleme-kokpit="">
      <div className="k2-kokpit__ust">
        <span className="k2-kokpit__marka" data-onizleme-sirket=""><MiniLogo olcu={16} />{t.sirket.trim() || 'Kokpit'}</span>
        <span className="ft-sayi k2-kokpit__tarih">{tarih} · {saat}</span>
      </div>
      <p className="k2-kokpit__selam" data-onizleme-selam="">{selamCumlesi(simdi.getHours(), t.ad, t.hitap)}</p>
      <p className="k2-kokpit__odak" data-onizleme-odak="">{m(KM.tanismaOdak)}</p>
      <div className="k2-kokpit__kartlar">
        <span className="k2-mini"><Ikon ad="saat" olcu={15} /><b className="ft-sayi">09:30</b><span>Ekip toplantısı</span></span>
        <span className="k2-mini"><Ikon ad="posta" olcu={15} /><b className="ft-sayi">2</b><span>önemli e-posta</span></span>
        <span className="k2-mini"><Ikon ad="tamam" olcu={15} /><b className="ft-sayi">3</b><span>yapılacak</span></span>
      </div>
    </Nesne>
  );
}

export function TanismaOnizleme() {
  const { taslak: t, m } = useAdim();
  return (
    <Tepsi etiket="Kokpit önizlemesi" dip={m(KM.tanismaDip)}>
      <KokpitKarti />
      <div className="k2-ada-soz" data-onizleme-ada="">
        <span className="k2-ada-soz__isaret" aria-hidden="true"><MiniLogo olcu={15} /></span>
        <span className="k2-ada-soz__yazi">
          <b data-onizleme-ada-soz="">{m(KM.adaSozu(hitapMetni(t.ad, t.hitap)))}</b>
          <span>{m(KM.adaAlt)}</span>
        </span>
      </div>
    </Tepsi>
  );
}
