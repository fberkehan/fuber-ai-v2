// ── Panelin Gelenler sayfası (0.14 T24) ───────────────────────────────────────────────────────────────────────────────────────────────────
// Solda okunmamış sayısı iri ve sıkı (BuyukSayi); sağda gelenler (en çok 3): e-posta ve WhatsApp, KOKPİTİN önem sırasıyla (shared/centik-veri.ts
// gelenlerSayfasi; önem e-posta eşitlemesinin kaydı — burada model çağrısı yok). Satıra tıklamak kokpitin e-posta satırının yolunu kullanır: kokpit sohbetine
// (ana sohbet) "Şu mesaja yanıt taslağı hazırla: …" gider (sohbet:gonder) ve ana pencere kokpitte açılır (ana:goster 'kokpit'; Fuber Tarayıcı'nın "Fuber'e
// sor"uyla aynı). Fuber taslağı gösterir, göndermez: gönderme her seferinde onaylıdır. Okumak bir araç ister: Gizli ve "Yalnız bu bilgisayar"da satırlar
// tıklanmaz (kokpitin AracsizMod kuralı) ve nedeni tek satırda söylenir (düzeltme turu 1). Kaynak yoksa tek satır "E-posta ya da WhatsApp bağlı değil." ve "Bağla" (Bağlantılar → E-posta).
// Karakter yok (Sade modda da); vurgu Panel'in --panel-vurgu'su.
import { useState, type ReactElement } from 'react';
import { cagir } from '../../api';
import { Ikon } from '../../bilesenler/Ikon';
import { BuyukSayi } from '../../ui/fintech';
import { GELEN_YOK, gelenIstemi, type GelenOgesi } from '../../../shared/centik-veri';
import { MESGUL_MESAJI } from '../../../shared/mesgul';
import { useAdaBaglami } from '../useAsistan';
import { useCentikVerisi } from './useCentikVerisi';
import { BosSatir } from './Gundem';

const GONDERILEMEDI = 'Fuber’e iletilemedi; yeniden dene.';

export function Gelenler(): ReactElement {
  const { a } = useAdaBaglami();
  const v = useCentikVerisi();
  const [hata, setHata] = useState('');
  if (!v) return <div className="gelenler-sayfa" aria-busy="true" />;
  const g = v.gelenler;
  if (g.bos) return <div className="gelenler-sayfa gelenler-sayfa--tek"><BosSatir id="gelenler" bos={g.bos} /></div>;
  const ac = async (o: GelenOgesi) => {
    setHata('');
    const ana = await Promise.resolve(cagir<number>('sohbet:ana')).catch(() => null);
    if (!ana) { setHata(GONDERILEMEDI); return; }
    const alindi = await Promise.resolve(cagir<boolean>('sohbet:gonder', ana, gelenIstemi(o).metin)).catch(() => false);
    if (!alindi) { setHata(MESGUL_MESAJI); return; }
    void cagir('ana:goster', 'kokpit');
    a.kapat();
  };
  return (
    <div className="gelenler-sayfa">
      <div className="gelenler-sayfa__sayi">
        {/* Düzeltme turu 1: sayı listeden değil, kesmeden önce sayılan okunmamışlardan (e-posta + WhatsApp mesajı). */}
        <BuyukSayi deger={g.okunmamis} etiket="okunmamış" />
      </div>
      <div className="gelenler-sayfa__sag">
        {g.ogeler.length === 0
          ? <span className="gelenler-sayfa__bos" data-gelenler-bos="">{GELEN_YOK}</span>
          : (
            <ul className="gelenler-sayfa__liste">
              {g.ogeler.slice(0, 3).map((o) => {
                const ic = (
                  <>
                    <span className="gelenler-sayfa__simge" aria-hidden="true"><Ikon ad={o.kanal === 'eposta' ? 'posta' : 'wp'} olcu={14} /></span>
                    <span className="gelenler-sayfa__kimden" title={o.kimden}>{o.kimden}</span>
                    <span className="gelenler-sayfa__ozet" title={o.ozet}>{o.ozet}</span>
                    {o.oncelik >= 4 && <i className="gelenler-sayfa__onemli" aria-label="Önemli" role="img" />}
                  </>
                );
                return (
                  <li key={o.anahtar} data-gelen={o.anahtar}>
                    {v.bulutKapali
                      ? <span className="gelenler-sayfa__satir">{ic}</span>
                      : <button type="button" className="gelenler-sayfa__satir" title="Yanıt taslağı hazırlat" onClick={() => void ac(o)}>{ic}</button>}
                  </li>
                );
              })}
            </ul>
          )}
        {hata ? <p className="centik-not centik-not--hata" role="alert">{hata}</p> : g.not ? <p className="centik-not" data-gelenler-not="">{g.not}</p> : null}
      </div>
    </div>
  );
}
