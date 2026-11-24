// ── Adanın sayfa içi kopyası: üç an döngüde (sessiz → hatırlatıcı → Fuber konuşur) ─────────────────────────────────────
// Onaylı taslak: ada-bicimi.html "A · Çentik" ve ada-temalar.html. Gerçek ada (src/renderer/ada) ayrı saydam penceredir; burada
// kurulumun Ada adımı, tema kartları ve tanıtım turunun son durağı için aynı biçim ve hareket yalnız CSS ile oynatılır (kanca yok,
// pencere yok). Malzeme gerçek adayla aynı: her temada siyah (`koyu-bolge`: yazı belirteçleri koyuda kalır). Az harekette canlandırma yok: sabit kart ("Fuber konuşur").
//   büyük: gerçek yazılarla (≥ 12 px), px ölçülerde (Ada adımının sahnesi, tur);
//   mini:  yazısız (çizgi ve hap biçimleri), sahneye göre (cqw/cqh) — tema kartlarının küçük önizlemesi.
import { Ikon } from '../bilesenler/Ikon';
import './ada-kopyasi.css';

export function AdaKopyasi({ olcek = 'buyuk' }: { olcek?: 'buyuk' | 'mini' }) {
  if (olcek === 'mini') {
    return (
      <div className="ada-kopya koyu-bolge" data-olcek="mini" aria-hidden="true">
        <div className="ak-an ak-an--1"><span className="ak-isik" /><i className="ak-cizgi" style={{ width: '7cqw' }} /></div>
        <div className="ak-an ak-an--2"><span className="ak-nokta" /><i className="ak-cizgi" style={{ width: '22cqw' }} /><i className="ak-cizgi ak-cizgi--uyari" style={{ width: '6cqw', marginLeft: 'auto' }} /></div>
        <div className="ak-an ak-an--3">
          <i className="ak-cizgi ak-cizgi--soluk" style={{ width: '18cqw' }} />
          <i className="ak-cizgi" style={{ width: '54cqw' }} />
          <i className="ak-cizgi" style={{ width: '38cqw' }} />
          <span className="ak-haplar"><i className="ak-hap ak-hap--birincil" /><i className="ak-hap" /></span>
        </div>
      </div>
    );
  }
  return (
    <div className="ada-kopya koyu-bolge" data-olcek="buyuk" role="img" aria-label="Ada: sessizken küçük bir çentik; hatırlatıcı gelince uzar; Fuber konuşunca düğmeli karta dönüşür, iş bitince geri çekilir.">
      <div className="ak-an ak-an--1"><span className="ak-isik" data-simge="" /><span className="ak-ad">Fuber</span></div>
      <div className="ak-an ak-an--2">
        <span className="ak-zil"><Ikon ad="zil" olcu={15} /></span>
        <span className="ak-baslik">Yatırımcı görüşmesi</span>
        <span className="ak-sure">12 dk</span>
      </div>
      <div className="ak-an ak-an--3">
        <span className="ak-ust">Fuber · şimdi</span>
        <p className="ak-metin">Mert ödeme hatasının düzeldiğini yazdı. <b>Teşekkür edip yanıtlayayım mı?</b></p>
        <span className="ak-dugmeler"><span className="ak-dgm ak-dgm--birincil">Yanıtla</span><span className="ak-dgm">Sonra</span></span>
      </div>
    </div>
  );
}

/** Masaüstü sahnesi: duvar kâğıdı + küçük Fuber penceresi + görev çubuğu + ada. `olcek` adaya geçer. */
export function AdaSahnesi({ olcek = 'buyuk' }: { olcek?: 'buyuk' | 'mini' }) {
  return (
    <div className={olcek === 'mini' ? 'ada-sahne ada-sahne--mini' : 'ada-sahne'}>
      <div className="ada-sahne__pencere" aria-hidden="true">
        <div className="ada-sahne__ray"><i /><i /><i /><i /></div>
        <div className="ada-sahne__ana"><i /><i /><i className="uzun" /></div>
      </div>
      <div className="ada-sahne__gorev" aria-hidden="true" />
      <AdaKopyasi olcek={olcek} />
    </div>
  );
}
