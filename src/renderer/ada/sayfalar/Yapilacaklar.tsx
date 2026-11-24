// ── Panelin Yapılacaklar sayfası (0.14 T26) ───────────────────────────────────────────────────────────────────────────────────────────────────
// Kokpitin Yapılacaklar kartıyla AYNI veri (yeni depo yok): 'yapilacak:liste' = planlama.ts kokpitYapilacaklari (açıklar önce, ardından bugünün işaretlileri;
// işaretlenen madde silinmez, üstü çizili kalır — kokpitteki kural). Solda açık iş sayısı iri ve sıkı (BuyukSayi), sağda en çok üç satır: işaret kutusu (yerel
// <input type="checkbox">; klavye: Sekme + Boşluk; 'plan:gorev' ile işaretler) ve başlık. Sığmayan maddeler "N öğe daha" notuna iner. Altta tek satır ekleme:
// yazı alanı (uzunluk sınırı YAPILACAK_METIN_SINIRI), isteğe bağlı saat ve "Ekle" — saat verilirse çentik o saatte hatırlatır (main/planlama.ts yapilacakEkle).
// Başlıklar METİN olarak çizilir (HTML yorumlanmaz). Liste kokpit verisi değişince ('kokpit:veri-degisti', 150 ms birleştirilir) tazelenir; yoklama yok. Karakter yok
// (Sade modda da); vurgu Panel'in --panel-vurgu'su.
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { cagir, dinle } from '../../api';
import { BuyukSayi, HapDugme } from '../../ui/fintech';
import { YAPILACAK_METIN_SINIRI } from '../../../shared/odak';
import { acikYapilacaklar, yapilacakGorunumu } from '../../../shared/yapilacaklar';
import type { Gorev } from '../../../shared/tipler';

/** Panelde en çok bu kadar satır (sığmazsa son satır "N öğe daha" notuna iner). */
const SATIR = 3;
/** Kokpit olaylarının birleştirildiği süre (ms). */
const BIRLESTIRME_MS = 150;

let son: Gorev[] | null = null;

function useYapilacaklar(): Gorev[] | null {
  const [l, setL] = useState<Gorev[] | null>(son);
  useEffect(() => {
    let takili = true;
    let z: ReturnType<typeof setTimeout> | null = null;
    const al = () => { void Promise.resolve(cagir<Gorev[]>('yapilacak:liste')).then((x) => { if (Array.isArray(x)) { son = x; if (takili) setL(x); } }).catch(() => undefined); };
    const sonra = () => { if (z) clearTimeout(z); z = setTimeout(() => { z = null; al(); }, BIRLESTIRME_MS); };
    al();
    const k = dinle('kokpit:veri-degisti', sonra);
    return () => { takili = false; if (z) clearTimeout(z); k(); };
  }, []);
  return l;
}

/** Son tarihin saati ("14:30"); yalnız saat içeren (gece yarısı olmayan) açık maddelerde. */
function saatCipi(g: Gorev): string | null {
  if (g.durum === 'tamam' || !g.sonTarih) return null;
  const t = new Date(g.sonTarih);
  if (Number.isNaN(t.getTime()) || (t.getHours() === 0 && t.getMinutes() === 0)) return null;
  return t.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

export function Yapilacaklar(): ReactElement {
  const liste = useYapilacaklar();
  const tum = liste ?? [];
  const acik = acikYapilacaklar({ gorevler: tum, yapilacaklar: tum }).length;
  let gorunum = yapilacakGorunumu(tum, SATIR);
  if (gorunum.gizli.length) gorunum = yapilacakGorunumu(tum, SATIR - 1); // son satır "N öğe daha" notuna iner
  const [baslik, setBaslik] = useState('');
  const [saat, setSaat] = useState('');
  const [bekliyor, setBekliyor] = useState(false);

  const isaretle = (g: Gorev, tamam: boolean) => { void Promise.resolve(cagir('plan:gorev', g.id, { durum: tamam ? 'tamam' : 'acik' })).catch(() => undefined); };
  const ekle = (e: FormEvent) => {
    e.preventDefault();
    const b = baslik.trim();
    if (!b || bekliyor) return;
    setBekliyor(true);
    void Promise.resolve(cagir('yapilacak:ekle', { baslik: b, saat: saat || null }))
      .then((r) => { if (r) { setBaslik(''); setSaat(''); } })
      .catch(() => undefined)
      .finally(() => setBekliyor(false));
  };

  return (
    <div className="yapilacak-sayfa">
      <div className="yapilacak-sayfa__sayi"><BuyukSayi deger={acik} etiket="açık iş" /></div>
      <div className="yapilacak-sayfa__sag">
        {gorunum.gorunen.length === 0
          ? <span className="yapilacak-sayfa__bos" data-yapilacak-bos="">Yapılacak yok. Aklındaki işi yaz.</span>
          : (
            <ul className="yapilacak-sayfa__liste">
              {gorunum.gorunen.map((g) => {
                const tamam = g.durum === 'tamam';
                const cip = saatCipi(g);
                return (
                  <li key={g.id} className="yapilacak-sayfa__satir" data-yapilacak-satiri={g.id} data-tamam={tamam ? '' : undefined}>
                    <label className="yapilacak-sayfa__etiket">
                      <input type="checkbox" className="yapilacak-sayfa__kutu" checked={tamam} onChange={(e) => isaretle(g, e.target.checked)} />
                      <span className="yapilacak-sayfa__baslik" title={g.baslik}>{g.baslik}</span>
                    </label>
                    {cip && <span className="yapilacak-sayfa__saat">{cip}</span>}
                  </li>
                );
              })}
              {gorunum.gizli.length > 0 && <li className="yapilacak-sayfa__daha centik-not" data-yapilacak-daha="">{gorunum.gizli.length} öğe daha · Kokpit’te</li>}
            </ul>
          )}
        <form className="yapilacak-sayfa__ekle" onSubmit={ekle}>
          <input type="text" className="yapilacak-sayfa__yazi" aria-label="Yapılacak ekle" placeholder="Yapılacak ekle…" maxLength={YAPILACAK_METIN_SINIRI} autoComplete="off" spellCheck={false}
            value={baslik} onChange={(e) => setBaslik(e.target.value)} />
          <input type="time" className="yapilacak-sayfa__saat-girdi" aria-label="Hatırlatma saati (isteğe bağlı)" value={saat} onChange={(e) => setSaat(e.target.value)} />
          <HapDugme type="submit" tur="birincil" boy="k" disabled={!baslik.trim() || bekliyor}>Ekle</HapDugme>
        </form>
      </div>
    </div>
  );
}
