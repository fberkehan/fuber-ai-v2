// Kurulum v2 › Bağlantılar (spec §1.7; isteğe bağlı): e-posta ve WhatsApp kartları; alt şeritteki birincil düğme hiçbir şey bağlı değilken
// "Sonra" (belirgin), bağlanınca "Devam". "Bağla" formu bir levhada açar (bugünkü formlar: bilesenler/Formlar.tsx), adımın yerleşimi bozulmaz.
// Sağda canlı önizleme: Fuber'in ekranın üstünden vereceği haber kartları; bağlı olan canlı, olmayan soluk ("Bağlanınca").
import { useState } from 'react';
import { cagir } from '../../api';
import { Ikon } from '../../bilesenler/Ikon';
import { EpostaFormu, WhatsappBaglan, useWhatsappDurumu } from '../../bilesenler/Formlar';
import { MiniLogo, HapDugme, Levha, Tepsi } from '../../ui/fintech';
import { KM } from '../../../shared/kurulum-metin';
import { useAdim } from '../baglam';
import { Bas, kademe } from '../Ortak';

export const bagliSayisi = (a: { eposta: readonly { parolaVar?: boolean }[]; whatsapp: { bagli?: boolean } }) => a.eposta.filter((e) => e.parolaVar).length + (a.whatsapp.bagli ? 1 : 0);

export function BaglantilarAdimi() {
  const { ayar, yenile, m } = useAdim();
  const [acik, setAcik] = useState<'eposta' | 'whatsapp' | null>(null);
  const [wa] = useWhatsappDurumu(); // WhatsApp kartı yalnız ana süreç izin verirse (modül + İş modu + WhatsApp hakkı)
  const eposta = ayar.eposta.filter((e) => e.parolaVar).length;
  const kart = (tur: 'eposta' | 'whatsapp', simge: string, ad: string, aciklama: string, bagli: string | null) => (
    <div className="k2-baglanti" data-baglanti={tur} data-bagli={bagli ? '' : undefined} key={tur}>
      <span className="k2-baglanti__simge" aria-hidden="true"><Ikon ad={simge} olcu={20} /></span>
      <span className="k2-baglanti__yazi"><b>{ad}</b><span>{bagli ? <><span className="ft-nokta ft-nokta--yesil" aria-hidden="true" />{bagli}</> : aciklama}</span></span>
      <HapDugme tur="ikincil" boy="k" onClick={() => { setAcik(tur); if (tur === 'whatsapp' && !ayar.whatsapp.bagli) void cagir('whatsapp:baslat').catch(() => undefined); }}>
        {bagli ? (tur === 'eposta' ? 'Bir hesap daha' : 'Yönet') : 'Bağla'}
      </HapDugme>
    </div>
  );
  return (
    <div className="k2-adim" data-baglantilar="">
      <Bas baslik="Nereden haber alayım?" giris={m(KM.baglantiGiris)} />
      <div className="k2-baglantilar" {...kademe(2)}>
        {kart('eposta', 'posta', 'E-posta', m(KM.epostaKart), eposta ? `${eposta} hesap bağlı` : null)}
        {wa.izinli && kart('whatsapp', 'wp', 'WhatsApp', m(KM.whatsappKart), ayar.whatsapp.bagli ? 'Bağlı' : null)}
      </div>
      <p className="ft-not" {...kademe(3)}>{ayar.mod === 'gelistirici' ? 'Notion, GitHub gibi servisler: Bağlantılar sayfasında.' : 'Başka servisler: Bağlantılar sayfasında.'}</p>
      {acik === 'eposta' && <Levha baslik="E-posta bağla" etiket="E-posta bağla" kapat={() => { setAcik(null); yenile(); }}><div className="k2-levha-form"><EpostaFormu birincil bitti={() => { yenile(); setAcik(null); }} /></div></Levha>}
      {acik === 'whatsapp' && wa.izinli && <Levha baslik="WhatsApp bağla" etiket="WhatsApp bağla" kapat={() => { setAcik(null); yenile(); }}><div className="k2-levha-form"><WhatsappBaglan birincil /></div></Levha>}
    </div>
  );
}

export function BaglantilarOnizleme() {
  const { ayar, simdi, m } = useAdim();
  const eposta = ayar.eposta.some((e) => e.parolaVar);
  const [wa] = useWhatsappDurumu();
  const wp = wa.izinli === true && ayar.whatsapp.bagli;
  const saat = (dk: number) => new Date(simdi.getTime() - dk * 60_000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const haber = (tur: string, simge: string, kaynak: string, baslik: string, metin: string, bagli: boolean, dk: number) => (
    <div className={`k2-haber${bagli ? '' : ' k2-haber--soluk'}`} data-onizleme-haber={tur} data-bagli={bagli ? '' : undefined}>
      <span className="k2-haber__simge" aria-hidden="true"><Ikon ad={simge} olcu={17} /></span>
      <span className="k2-haber__yazi">
        <span className="k2-haber__ust"><b>{kaynak}</b><span className="ft-sayi">{bagli ? saat(dk) : 'Örnek'}</span></span>
        <span className="k2-haber__baslik">{baslik}</span>
        <span className="k2-haber__metin">{metin}</span>
      </span>
    </div>
  );
  return (
    <Tepsi etiket="Bağlantılar önizlemesi" dip={m(KM.baglantiDip)}>
      <div className="k2-ada-mini" aria-hidden="true"><MiniLogo olcu={14} /><span>{1 + (eposta ? 1 : 0) + (wp ? 1 : 0)} yeni haber</span></div>
      {haber('hatirlatici', 'saat', 'Hatırlatıcı', 'Ece Hanım’la görüşme', m(KM.haberHatirlatici), true, 1)}
      {haber('eposta', 'posta', 'E-posta · Ece Aydın', 'Ana sayfa revizyonları', 'Son hâli ekte. Bugün dönüş bekliyor.', eposta, 4)}
      {wa.izinli && haber('whatsapp', 'wp', 'WhatsApp · Mert', 'Bütçe dosyası', m(KM.haberWhatsapp), wp, 12)}
    </Tepsi>
  );
}
