// Kurulum v2 › İzinler (spec §1.8): ekran ve klavye denetimi, tarayıcı, dosyalar, bildirimler — tek ekranda net açıklama. Seçim ANINDA
// kaydedilir (yetki.*, proaktif.etkin; Vazgeç açılıştakine döndürür). Tam yetki kurulumda sorulmaz (Ayarlar → Yetkiler). Acil durdurma
// tuşu satırın kendisinde yazar. Sağda canlı önizleme (H3a düzeltme turu 1: listeyi tekrar etmez): "örnek gün" — her iznin Fuber'e
// yaptırdığı tek iş (bildirim akışı gibi); açık izinler canlı, kapalı olanlar soluk ve "İzin verirsen" der. Üstte açık izin sayısı.
// 0.13 spec B: yazı gerçeğe uyar — "Ekran ve klavye" isteğe bağlıdır, varsayılan kapalıdır (kurulum "önerilenler açık" diye geçince kapalı kalır).
import { Ikon } from '../../bilesenler/Ikon';
import { ACIL_YEDEK, useAcilDurdurma } from '../../acil-kisayol';
import { Nesne, Tepsi } from '../../ui/fintech';
import type { KurulumTaslagi } from '../../../shared/kurulum-taslak';
import { KM, type Cift } from '../../../shared/kurulum-metin';
import { useAdim } from '../baglam';
import { AnahtarListesi, Bas, kademe } from '../Ortak';

type IzinAdi = keyof KurulumTaslagi['izin'];
const IZINLER: readonly { id: IzinAdi; simge: string; ad: string; rozet?: string }[] = [
  { id: 'bilgisayar', simge: 'ekran', ad: 'Ekran ve klavye', rozet: 'İsteğe bağlı' },
  { id: 'tarayici', simge: 'kure', ad: 'Tarayıcı' },
  { id: 'dosyaOkuma', simge: 'klasor', ad: 'Dosyalar' },
  { id: 'bildirim', simge: 'zil', ad: 'Bildirimler' },
];

export function IzinlerAdimi() {
  const { taslak: t, degistir, kaydet, ayar, m } = useAdim();
  const acil = useAcilDurdurma() ?? ACIL_YEDEK;
  const aciklama: Record<IzinAdi, string> = {
    bilgisayar: m(KM.izinBilgisayar(acil)),
    tarayici: 'Kendi penceremde web’de gezinir, okurum. Tıklamadan önce sorarım.',
    dosyaOkuma: 'Masaüstü, Belgeler ve İndirilenler’i okurum. Başka klasör için sorarım.',
    bildirim: m(KM.izinBildirim),
  };
  const degis = (id: IzinAdi, v: boolean) => {
    degistir((x) => ({ ...x, izin: { ...x.izin, [id]: v } }));
    if (id === 'bildirim') kaydet({ proaktif: { ...ayar.proaktif, etkin: v } });
    else kaydet({ yetki: { ...ayar.yetki, [id]: v } });
  };
  return (
    <div className="k2-adim" data-izinler="">
      <Bas baslik={m(KM.izinlerBaslik)} giris="Önerilenler açık." />
      <div {...kademe(2)}>
        <AnahtarListesi satirlar={IZINLER.map((z) => ({ id: z.id, simge: z.simge, ad: z.ad, rozet: z.rozet, aciklama: aciklama[z.id], acik: t.izin[z.id], degistir: (v: boolean) => degis(z.id, v) }))} />
      </div>
    </div>
  );
}

/** Önizlemenin "örnek gün"ü: her iznin Fuber'e yaptırdığı tek iş — [saat, açıkken yaptığı, kapalıyken "izin verirsen"]. İş dilinde;
 *  gönderim/silme/ödeme yok (onay ister). */
const ORNEK_IS: Readonly<Record<IzinAdi, [string, Cift, Cift]>> = {
  bilgisayar: ['10:12', KM.izinBilgisayarAcik, KM.izinBilgisayarKapali],
  tarayici: ['11:40', ['Üç uçuşu karşılaştırdım. En uygunu 09:15', 'Üç uçuşu karşılaştırdım. En uygunu 09:15'], KM.izinTarayiciKapali],
  dosyaOkuma: ['13:05', KM.izinDosyaAcik, KM.izinDosyaKapali],
  bildirim: ['14:20', KM.izinBildirimAcik, KM.izinBildirimKapali],
};

export function IzinlerOnizleme() {
  const { taslak: t, m } = useAdim();
  const sayi = IZINLER.filter((z) => t.izin[z.id]).length;
  return (
    <Tepsi etiket="İzinler önizlemesi" dip={m(KM.izinDip)}>
      <div className="k2-izinler" data-onizleme-izin={String(sayi)}>
        <div className="k2-izinler__ust">
          <b>{m(KM.izinBaslik)}</b>
          <span className="ft-sayi" data-izin-sayisi="">{sayi} / 4 izin açık</span>
        </div>
        {IZINLER.map((z) => {
          const acik = t.izin[z.id];
          const [saat, yapti, yapar] = ORNEK_IS[z.id];
          return (
            <Nesne key={z.id} className={`k2-izin${acik ? ' k2-izin--acik' : ''}`} data-onizleme-izin-ogesi={z.id}>
              <span className="k2-izin__simge" aria-hidden="true"><Ikon ad={z.simge} olcu={18} /></span>
              <span className="k2-izin__yazi">
                <span className="k2-izin__ust"><b>{z.ad}</b><span className="ft-sayi">{acik ? saat : 'Kapalı'}</span></span>
                <span className="k2-izin__is">{m(acik ? yapti : yapar)}</span>
              </span>
            </Nesne>
          );
        })}
      </div>
    </Tepsi>
  );
}
