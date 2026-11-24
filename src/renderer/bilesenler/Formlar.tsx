// Kurulum ve Bağlantılar sayfasının ortak formları: e-posta hesabı, WhatsApp QR. (0.13 T15: motor anahtarı kartı kalktı — kimse API anahtarı girmez.)
import { useEffect, useRef, useState } from 'react';
import { cagir, dinle } from '../api';
import { Ikon } from './Ikon';
import { epostaFormuEksigi, sinamaMetni, epostaGirdisiniKirp } from '../../shared/eposta-formu';
/** `birincil`: "Bağla ve sına" birincil (beyaz) mı — kurulum sihirbazında hayır (ekranda tek birincil: alt şeritteki "Devam"). */
export function EpostaFormu({ bitti, birincil = true }: { bitti?: () => void; birincil?: boolean }) {
  const [hazir, setHazir] = useState<Record<string, { imapSunucu: string; imapPort: number; smtpSunucu: string; smtpPort: number }>>({});
  const [sec, setSec] = useState('gmail');
  const [f, setF] = useState({ ad: 'Kişisel', adres: '', parola: '', imapSunucu: '', imapPort: 993, smtpSunucu: '', smtpPort: 465 });
  const [sonuc, setSonuc] = useState<{ imap: boolean; smtp: boolean; hata?: string } | null>(null);
  const [bekle, setBekle] = useState(false);
  const [hesapId, setHesapId] = useState<string | undefined>(); // kaydedilen hesap: yeniden denemede aynısı güncellenir

  useEffect(() => { void cagir<typeof hazir>('eposta:hazir').then((h) => { setHazir(h); setF((x) => ({ ...x, ...h.gmail })); }); }, []);
  // Özel sekmesine geçince hazır sağlayıcının sunucu adları silinir: kullanıcı kendi sunucusunu yazar (yoksa "Bağla" kapalı kalır).
  const ayarla = (k: string) => { setSec(k); setSonuc(null); if (hazir[k]) setF((x) => ({ ...x, ...hazir[k] })); else if (k === 'ozel') setF((x) => ({ ...x, imapSunucu: '', smtpSunucu: '' })); };
  const eksik = epostaFormuEksigi(f, sec === 'ozel');

  const kaydet = async () => {
    setBekle(true);
    try {
      // Ana süreç önce sınar; okuma (IMAP) geçmezse hesap KAYDEDİLMEZ (hesap: null).
      // Doğrulama boşluğu kırpar; gönderilen de kırpılmış (adres, ad ve özel sunucu adları; Görev 20b — ana süreç de kırpar).
      const r = await cagir<{ hesap: { id: string } | null; sinama: { imap: boolean; smtp: boolean; hata?: string } }>('eposta:kaydet', epostaGirdisiniKirp({ ...f, id: hesapId, kullanici: f.adres, guvenli: true }));
      setSonuc(r.sinama);
      if (r.hesap) setHesapId(r.hesap.id);
      if (r.sinama.imap) void cagir('eposta:esitle');
      // Okuma ya da gönderimden biri başarısızsa form açık kalır, hata görünür.
      if (r.sinama.imap && r.sinama.smtp) bitti?.();
    } catch (e) {
      setSonuc({ imap: false, smtp: false, hata: (e as Error).message });
    } finally { setBekle(false); }
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="sekmeler" role="tablist">
        {['gmail', 'outlook', 'yandex', 'ozel'].map((k) => <button key={k} role="tab" aria-selected={sec === k} onClick={() => ayarla(k)}>{k === 'ozel' ? 'Özel' : k[0].toUpperCase() + k.slice(1)}</button>)}
      </div>
      <div className="ikili">
        <label className="alan"><span>Hesap adı</span><input className="girdi" value={f.ad} onChange={(e) => setF({ ...f, ad: e.target.value })} /></label>
        <label className="alan"><span>E-posta adresi</span><input className="girdi" value={f.adres} onChange={(e) => setF({ ...f, adres: e.target.value })} placeholder="ad@alan.com" /></label>
      </div>
      <label className="alan"><span>{sec === 'gmail' ? 'Uygulama şifresi (Google Hesabı → Güvenlik → Uygulama şifreleri)' : 'Şifre / uygulama şifresi'}</span><input className="girdi" type="password" value={f.parola} onChange={(e) => setF({ ...f, parola: e.target.value })} /></label>
      {sec === 'ozel' && (
        <div className="ikili">
          <label className="alan"><span>IMAP sunucusu</span><input className="girdi" value={f.imapSunucu} onChange={(e) => setF({ ...f, imapSunucu: e.target.value })} /></label>
          <label className="alan"><span>SMTP sunucusu</span><input className="girdi" value={f.smtpSunucu} onChange={(e) => setF({ ...f, smtpSunucu: e.target.value })} /></label>
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className={`dgm ${birincil ? 'dgm--beyaz' : 'dgm--koyu'}`} disabled={bekle || Boolean(eksik)} title={eksik ?? undefined} onClick={() => void kaydet()}>{bekle ? 'Bağlanıyor…' : 'Bağla ve sına'}</button>
        {/* Boş formda uyarı yok; yazmaya başlanınca neyin eksik/yanlış olduğu söylenir. */}
        {!sonuc && eksik && f.adres.trim() && <span className="t-kucuk" data-eposta-eksik="" style={{ fontSize: 13 }}>{eksik}</span>}
        {sonuc && <span style={{ fontSize: 13, color: sinamaMetni(sonuc).tamam ? 'var(--yazi-basari)' : 'var(--yazi-hata)' }}>{sinamaMetni(sonuc).metin}</span>}
      </div>
      <div className="t-kucuk">Fuber e-postalarını okur ve önemlileri söyler. Gönderim HER SEFERİNDE senin onayınla yapılır.</div>
    </div>
  );
}

/** WhatsApp durumu (ana süreç: main/entegrasyon/whatsapp-kapisi.ts). `izinli`: WhatsApp yalnız modül varken (bu depoda yok), İş modunda ve WhatsApp
 *  hakkıyla; değilse satır HİÇ çizilmez. Karar ana süreçte; arayüz yalnız sonucu gösterir. Olaylarda alan gelmezse son bilinen yetki korunur. */
export type WhatsappArayuzDurumu = { durum: string; qr?: string; numara?: string; izinli?: boolean };
export function useWhatsappDurumu(): [WhatsappArayuzDurumu, (x: WhatsappArayuzDurumu) => void] {
  const [d, setD] = useState<WhatsappArayuzDurumu>({ durum: 'kapali', izinli: false });
  const birlestir = (x: WhatsappArayuzDurumu) => setD((o) => ({ ...x, izinli: x.izinli ?? o.izinli }));
  useEffect(() => {
    void cagir<WhatsappArayuzDurumu>('whatsapp:durum').then(birlestir, () => undefined);
    return dinle('whatsapp:durum', birlestir);
  }, []);
  return [d, birlestir];
}

/** `birincil`: "WhatsApp'ı bağla" birincil (beyaz) mı — kurulum sihirbazında hayır (ekranda tek birincil düğme). */
export function WhatsappBaglan({ birincil = true }: { birincil?: boolean } = {}) {
  const [d, setD] = useWhatsappDurumu();
  // "Bağla"nın geç dönen yanıtı, arada basılan "Vazgeç"i ezmesin (Görev 20b, G19): her vazgeçiş nesli artırır.
  const nesil = useRef(0);
  const baslat = () => { const n = nesil.current; void cagir('whatsapp:baslat').then((x) => { if (n === nesil.current) setD(x as typeof d); }); };
  const vazgec = () => { nesil.current++; void cagir('whatsapp:cikis'); };
  return (
    <div style={{ display: 'grid', gap: 12, justifyItems: 'start' }}>
      {d.durum === 'bagli' ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="nokta nokta--yesil" /><b>Bağlı</b><span className="soluk">+{d.numara}</span></div>
          <button className="dgm dgm--koyu dgm--k" onClick={() => void cagir('whatsapp:cikis')}>Bağlantıyı kes</button>
        </>
      ) : d.durum === 'qr' && d.qr ? (
        <>
          <img className="qr" src={d.qr} alt="WhatsApp QR" />
          <div className="t-giris" style={{ fontSize: 13.5 }}>Telefonunda WhatsApp → <b>Ayarlar → Bağlı cihazlar → Cihaz bağla</b> ve bu kodu okut.</div>
          {/* Okutmadan vazgeçilebilsin: yoksa WhatsApp "açık" kalıyor, kod yenilenip duruyor ve her açılışta yeniden bağlanmaya çalışıyordu. */}
          <button className="dgm dgm--hayalet dgm--k" onClick={vazgec}>Vazgeç</button>
        </>
      ) : (
        <>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className={`dgm ${birincil ? 'dgm--beyaz' : 'dgm--koyu'}`} onClick={baslat} disabled={d.durum === 'baglaniyor'}>
              <Ikon ad="wp" olcu={16} />{d.durum === 'baglaniyor' ? 'Bağlanıyor…' : 'WhatsApp\'ı bağla'}
            </button>
            {d.durum === 'baglaniyor' && <button className="dgm dgm--hayalet dgm--k" onClick={vazgec}>Vazgeç</button>}
          </span>
          {d.durum === 'hata' && <span style={{ fontSize: 13, color: 'var(--yazi-hata)' }}>Bağlantı kurulamadı, tekrar dene.</span>}
          <div className="t-kucuk">Mesajların bu bilgisayarda saklanır. Fuber önemli olanları söyler; gönderim her seferinde onay ister.</div>
        </>
      )}
    </div>
  );
}
