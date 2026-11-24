// ── Panelin Gündem sayfası (0.14 T24; R12, P14) ─────────────────────────────────────────────────────────────────────────────────────────────
// Solda sıradaki öğenin saati iri ve sıkı (BuyukSayi) ve adı; sağda bugünün geri kalanı (tüm gün etkinlikleri, gecikenler, sonrakiler; en çok 3 satır).
// Kaynak: kokpitin gündemi + bağlı takvimin bugünkü etkinlikleri (shared/centik-veri.ts gundemSayfasi). Takvim bağlı değilse sayfa gizlenmez: altta tek
// satır "Takvim bağlı değil." ve "Bağla" — ana pencerede Bağlantılar'ın takvim kartını açar (ana:goster 'baglantilar#servis-<id>'; yoksa E-posta/Servisler).
// Gizli ve "Yalnız bu bilgisayar"da takvim bu bilgisayardaki son kopyadan, altta BULUT_KAPALI_METNI.takvim satırı. Karakter yok (Sade modda da); vurgu
// Panel'in --panel-vurgu'su (PANEL_SAYFALARI). Saat ve "25 dk sonra" Panel'in dakika başı yeniden çizimiyle tazelenir (bu sayfada zamanlayıcı yok).
import type { ReactElement } from 'react';
import { cagir } from '../../api';
import { BuyukSayi, HapDugme } from '../../ui/fintech';
import { GUNDEM_YOK, takvimOlayiMi, type BosDurum, type GundemSatiri } from '../../../shared/centik-veri';
import { useAdaBaglami } from '../useAsistan';
import { useCentikVerisi } from './useCentikVerisi';

/** Satırın zaman sütunu: saatli öğede saat; tüm gün, e-posta daveti, mesele ve gecikende kısa sözcük. */
function zamanEtiketi(o: GundemSatiri, saat: (iso: string) => string): string {
  if (takvimOlayiMi(o)) return o.tumGun ? 'Tüm gün' : saat(o.bas);
  if (o.gecikti) return 'Gecikti';
  if (o.tur === 'toplanti') return 'E-posta';
  if (o.tur === 'mesele' || !o.zaman) return 'Bugün';
  return saat(o.zaman);
}
const zamanOf = (o: GundemSatiri): number => Date.parse(takvimOlayiMi(o) ? o.bas : o.zaman ?? '');

/** "Şimdi", "25 dk sonra", "2 sa sonra", "2 sa 10 dk sonra". */
function kalanMetni(t: number, simdi: number): string {
  const dk = Math.round((t - simdi) / 60_000);
  if (dk <= 0) return 'Şimdi';
  if (dk < 60) return `${dk} dk sonra`;
  const sa = Math.floor(dk / 60), kalan = dk % 60;
  return `${sa} sa${kalan ? ` ${kalan} dk` : ''} sonra`;
}

/** Kaynağı olmayan bölümün tek satırı + "Bağla" (Panel'in boş durum deseni; düğme hap). */
export function BosSatir({ id, bos }: { id: string; bos: BosDurum }): ReactElement {
  return (
    <div className="centik-bos" data-sayfa-bos={id}>
      <span className="centik-bos__metin">{bos.metin}</span>
      {bos.eylem && <HapDugme tur="ikincil" boy="k" onClick={() => { void cagir('ana:goster', `baglantilar#${bos.cipa}`); }}>Bağla</HapDugme>}
    </div>
  );
}

export function Gundem(): ReactElement {
  const { a } = useAdaBaglami();
  const v = useCentikVerisi();
  const simdi = Date.now();
  const saatBicimi = new Intl.DateTimeFormat(a.dil || 'tr-TR', { hour: '2-digit', minute: '2-digit' });
  const saat = (iso: string) => { const z = Date.parse(iso); return Number.isFinite(z) ? saatBicimi.format(z) : ''; };
  if (!v) return <div className="gundem-sayfa" aria-busy="true" />;
  const g = v.gundem;
  const bos = !g.siradaki && !g.ogeler.length;
  if (bos && g.bos) return <div className="gundem-sayfa gundem-sayfa--tek"><BosSatir id="gundem" bos={g.bos} /></div>;
  const s = g.siradaki;
  return (
    <div className="gundem-sayfa">
      <div className="gundem-sayfa__ust">
        {s ? (
          <div className="gundem-sayfa__siradaki" data-gundem-siradaki="">
            <BuyukSayi deger={saat(takvimOlayiMi(s) ? s.bas : s.zaman ?? '')} etiket={kalanMetni(zamanOf(s), simdi)} />
            <span className="gundem-sayfa__baslik" title={s.baslik}>{s.baslik}</span>
          </div>
        ) : (
          <div className="gundem-sayfa__siradaki">
            <BuyukSayi deger={g.ogeler.length} etiket={g.ogeler.length ? 'bugün bekleyen' : 'Bugün'} />
            {!g.ogeler.length && <span className="gundem-sayfa__baslik gundem-sayfa__baslik--soluk">{GUNDEM_YOK}</span>}
          </div>
        )}
        {g.ogeler.length > 0 && (
          <ul className="gundem-sayfa__liste">
            {g.ogeler.slice(0, 3).map((o, i) => (
              <li key={takvimOlayiMi(o) ? `t:${o.bas}:${i}` : o.id} className="gundem-sayfa__satir" data-gecikti={!takvimOlayiMi(o) && o.gecikti ? '' : undefined}>
                <span className="gundem-sayfa__zaman">{zamanEtiketi(o, saat)}</span>
                <span className="gundem-sayfa__satir-baslik" title={o.baslik}>{o.baslik}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {g.bos ? <BosSatir id="gundem" bos={g.bos} /> : g.not ? <p className="centik-not" data-gundem-not="">{g.not}</p> : null}
    </div>
  );
}
