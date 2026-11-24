// Ayarlar → Yetkiler: tam yetki ve tek tek erişimler (tarayıcı, fare/klavye/ekran + "Dene", dosya okuma).
// "Dene" ekranın ortasında küçük bir test penceresi açar ve gerçek fare/klavyeyle dener (yalnız kullanıcı basınca).
import { useState } from 'react';
import { cagir } from '../api';
import { Anahtar } from '../bilesenler/Ortak';
import { useAyarlar, type IcerikHaritasi } from './baglam';
import { Satir } from './Ortak';

interface Deneme { tamam: boolean; kilitli?: boolean; adimlar: { ad: string; tamam: boolean; ayrinti?: string }[] }

function TamYetkiGrubu() {
  const { a, kaydet } = useAyarlar();
  return (
    <Satir id="tam-yetki">
      <Anahtar acik={a.yetki.tamYetki} etiket="Tam yetki" degistir={(v) => kaydet({ yetki: { ...a.yetki, tamYetki: v, ...(v ? { bilgisayar: true, tarayici: true } : {}) } })} />
    </Satir>
  );
}

function ErisimGrubu() {
  const { a, kaydet } = useAyarlar();
  const [deneme, setDeneme] = useState<Deneme | null>(null);
  const [deneniyor, setDeneniyor] = useState(false);
  const dene = async () => { setDeneniyor(true); try { setDeneme(await cagir<Deneme>('bilgisayar:dene')); } finally { setDeneniyor(false); } };
  return (
    <>
      <Satir id="tarayici"><Anahtar acik={a.yetki.tarayici} etiket="Tarayıcı" degistir={(v) => kaydet({ yetki: { ...a.yetki, tarayici: v } })} /></Satir>
      <Satir id="bilgisayar">
        <span className="dugme-sirasi">
          <button type="button" className="dgm dgm--koyu dgm--k" disabled={deneniyor} title="Ekranın ortasında küçük bir test penceresi açar; gerçek fare tıklaması ve klavyeyle dener" onClick={() => void dene()}>{deneniyor ? 'Deneniyor…' : 'Dene'}</button>
          <Anahtar acik={a.yetki.bilgisayar} etiket="Fare, klavye ve ekran" degistir={(v) => kaydet({ yetki: { ...a.yetki, bilgisayar: v } })} />
        </span>
      </Satir>
      {deneme && (
        <div className="deneme-sonucu">
          {deneme.adimlar.map((s) => <div key={s.ad} style={{ color: s.tamam ? 'var(--yazi-basari)' : 'var(--yazi-hata)' }}>{s.tamam ? '✓' : '✕'} {s.ad}{s.ayrinti ? <span className="cok-soluk"> — {s.ayrinti}</span> : null}</div>)}
          <div className="cok-soluk">{deneme.tamam ? 'Fuber bu bilgisayarda fare ve klavyeyi kullanabiliyor.' : deneme.kilitli ? 'Windows oturumu kilitliyken Windows buna izin vermez.' : 'Bir adım başarısız oldu; ayrıntı yukarıda.'}</div>
        </div>
      )}
      <Satir id="dosya-okuma"><Anahtar acik={a.yetki.dosyaOkuma} etiket="Dosya okuma" degistir={(v) => kaydet({ yetki: { ...a.yetki, dosyaOkuma: v } })} /></Satir>
    </>
  );
}

export const YETKILER: IcerikHaritasi = { tam: TamYetkiGrubu, erisim: ErisimGrubu };
