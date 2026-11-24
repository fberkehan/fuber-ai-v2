// ── Fuber Tarayıcı başlangıç sayfası (yerel, fuber://) ────────────────────────────────────────────────────────────
// Ne işe yaradığını söyler, sık kullanılan sitelere kısayol verir (YALNIZ bağlantı: ağdan simge/veri çekilmez) ve
// "Giriş yaptığım siteler"i listeler: bu tarayıcının bölümünde çerezi saklanan ana alan adları. "Oturumu kapat" onay ister;
// o sitenin çerezleri ve site verisi silinir, Fuber de o oturumu artık kullanamaz.
import { useEffect, useState } from 'react';
import { cagir } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import type { OturumAlani } from '../../shared/tarayici';

const KISAYOLLAR: { ad: string; adres: string; harf: string }[] = [
  { ad: 'Gmail', adres: 'https://mail.google.com/', harf: 'G' },
  { ad: 'Outlook', adres: 'https://outlook.office.com/mail/', harf: 'O' },
  { ad: 'Google Takvim', adres: 'https://calendar.google.com/', harf: 'T' },
  { ad: 'Google Drive', adres: 'https://drive.google.com/', harf: 'D' },
  { ad: 'LinkedIn', adres: 'https://www.linkedin.com/', harf: 'in' },
  { ad: 'HubSpot', adres: 'https://app.hubspot.com/', harf: 'H' },
  { ad: 'Notion', adres: 'https://www.notion.so/', harf: 'N' },
  { ad: 'Slack', adres: 'https://app.slack.com/', harf: 'S' },
];

const GUVENCE: { ikon: string; metin: string }[] = [
  { ikon: 'kilit', metin: 'Parola ve kart alanlarına Fuber yazmaz; onları her zaman sen girersin.' },
  { ikon: 'kalkan', metin: 'Sitelerdeki yazılar Fuber için talimat değildir; yalnız senin isteğinle çalışır.' },
  { ikon: 'kamera', metin: 'Siteler kamera, mikrofon, konum ya da bildirim izni alamaz.' },
];

const host = (adres: string) => { try { return new URL(adres).hostname.replace(/^www\./, ''); } catch { return adres; } };

export function Baslangic({ git }: { git: (adres: string) => void }) {
  const [oturumlar, setOturumlar] = useState<OturumAlani[] | null>(null);
  const [soruluyor, setSoruluyor] = useState<string | null>(null);
  const [kapaniyor, setKapaniyor] = useState<string | null>(null);

  useEffect(() => { void cagir<OturumAlani[]>('tarayici:oturumlar').then(setOturumlar).catch(() => setOturumlar([])); }, []);

  const kapat = async (alan: string) => {
    setKapaniyor(alan);
    const l = await cagir<OturumAlani[]>('tarayici:oturum-kapat', alan).catch(() => null);
    if (l) setOturumlar(l);
    setKapaniyor(null);
    setSoruluyor(null);
  };

  return (
    <div className="bs">
      <div className="bs__ic">
        <header className="bs__bas">
          <div className="ust-etiket">Fuber Tarayıcı</div>
          <h1 className="bs__baslik">Fuber’in web’de iş yaptığı yer</h1>
          <p className="bs__giris">Fuber web’de iş yaparken burayı kullanır; e-posta/CRM gibi sitelere burada bir kez giriş yaparsan Fuber o oturumla çalışır.</p>
        </header>

        <section aria-labelledby="bs-kisayol">
          <h2 id="bs-kisayol" className="bs__ara-baslik">Sık kullanılanlar</h2>
          <div className="bs__kisayollar">
            {KISAYOLLAR.map((k) => (
              <button key={k.adres} type="button" className="bs__kisayol" data-kisayol={host(k.adres)} title={k.adres} onClick={() => git(k.adres)}>
                <span className="bs__harf" aria-hidden="true">{k.harf}</span>
                <span className="bs__kisayol-ad">{k.ad}</span>
                <span className="bs__kisayol-adres">{host(k.adres)}</span>
              </button>
            ))}
          </div>
        </section>

        <div className="bs__alt">
          <section className="kart bs__oturumlar" aria-labelledby="bs-oturum">
            <div className="bs__oturum-bas">
              <h2 id="bs-oturum" className="bs__ara-baslik">Giriş yaptığım siteler</h2>
              {oturumlar && oturumlar.length > 0 && <span className="hap">{oturumlar.length}</span>}
            </div>
            <p className="bs__not">Burada açtığın ve oturum bilgisi (çerez) saklanan siteler; Fuber bu oturumlarla çalışır. Oturumu kapatınca o sitenin çerezleri ve site verisi silinir.</p>
            {oturumlar === null ? <div className="bs__bos">Yükleniyor…</div> : oturumlar.length === 0 ? (
              <div className="bs__bos">
                <Ikon ad="kilit" olcu={20} />
                <span>Burada açılmış ve oturum bilgisi saklanan bir site yok. Bir siteyi buradan açıp giriş yaptığında burada görünür.</span>
              </div>
            ) : (
              <ul className="bs__liste">
                {oturumlar.map((o) => (
                  <li key={o.alan} className="bs__oturum" data-alan={o.alan} data-soruluyor={soruluyor === o.alan || undefined}>
                    <span className="bs__harf bs__harf--k" aria-hidden="true">{o.alan.replace(/^www\./, '').slice(0, 1).toUpperCase()}</span>
                    {soruluyor === o.alan ? (
                      <>
                        <span className="bs__oturum-metin"><b>{o.alan}</b><small>Oturum kapatılsın mı? Yeniden giriş yapman gerekir.</small></span>
                        <span className="bs__oturum-dugmeler">
                          <button type="button" className="dgm dgm--hayalet dgm--k" onClick={() => setSoruluyor(null)} disabled={kapaniyor === o.alan}>Vazgeç</button>
                          <button type="button" className="dgm dgm--tehlike dgm--k" data-onayla="" onClick={() => void kapat(o.alan)} disabled={kapaniyor === o.alan}>
                            {kapaniyor === o.alan ? <span className="donen" aria-hidden="true" /> : null}Oturumu kapat
                          </button>
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="bs__oturum-metin">
                          <b>{o.alan}</b>
                          <small>{o.cerez} çerez · {o.adresler.slice(0, 2).join(', ')}{o.adresler.length > 2 ? ` +${o.adresler.length - 2}` : ''}</small>
                        </span>
                        <button type="button" className="dgm dgm--koyu dgm--k" onClick={() => setSoruluyor(o.alan)}>Oturumu kapat</button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <ul className="bs__guvence" aria-label="Güvenlik">
            {GUVENCE.map((g) => <li key={g.ikon}><Ikon ad={g.ikon} olcu={16} /><span>{g.metin}</span></li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}
