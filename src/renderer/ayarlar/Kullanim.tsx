// Ayarlar → Maliyet (yalnız Geliştirici; kategori kimliği 'kullanim' çapa olarak kalır). Son 30 gün: işe göre dağılım (amaç → beyin bölgesi adı:
// Akıl, Hafıza, Kokpit, Not tutucu…), yaklaşık USD ve modele göre tablo. Maliyet ana süreçte model bilgisinin fiyatıyla (main/motor/kullanim.ts);
// fiyatı bilinmeyen modelde "—" (0 değil), toplama katılmaz; hiçbir çağrının fiyatı bilinmiyorsa toplam "—" ve çubuklar çağrı sayısına göre.
// 0.11 G8 düzeltme turu 1: eski İş "Kullanım" sayfası kalktı (Hesap ve kullanım ile iki "kullanım" girişi kafa karıştırıyordu) — İş'te bu ayki
// yanıt sayısı Hesap ve kullanım → Kullanım grubunda tek satır (ayarlar/Hesap.tsx BuAySatiri); bu sayfa kalan kullanımı DEĞİL maliyeti gösterir.
import { BOLGELER, amactanBolge } from '../../shared/beyin';
import type { KullanimOzeti } from '../../shared/kullanim-ozeti';
import { sayi, useKullanim } from './kullanim-veri';
import type { IcerikHaritasi } from './baglam';
import { AyarBolgesi, useAyarTanimi } from './Ortak';

const dolar = (n: number | null, h = 2) => (n === null ? '—' : `≈ $${Number(n).toFixed(h)}`);

/** Amaçlar beyin bölgelerine toplanır (aynı bölgeye düşen birkaç amaç tek satır). Maliyet null: bölgenin hiçbir çağrısının fiyatı yok. */
function bolgelereTopla(k: KullanimOzeti | null | undefined) {
  const bolgeler = new Map<string, { ad: string; maliyet: number | null; istek: number }>();
  for (const x of k?.amaclar ?? []) {
    const id = amactanBolge(x.amac);
    const ad = BOLGELER.find((b) => b.id === id)?.ad ?? 'Diğer';
    const o = bolgeler.get(ad) ?? { ad, maliyet: null, istek: 0 };
    if (x.maliyet !== null) o.maliyet = (o.maliyet ?? 0) + (Number(x.maliyet) || 0);
    o.istek += Number(x.istek) || 0;
    bolgeler.set(ad, o);
  }
  return [...bolgeler.values()];
}

function AmacGrubu() {
  const k = useKullanim(30);
  const t = useAyarTanimi('kullanim-amac');
  if (!t) return null;
  // Maliyete göre (fiyatı bilinmeyen sonda). Hiçbir çağrının fiyatı bilinmiyorsa toplam "—" (0 değil) ve çubuklar çağrı sayısına göre.
  const hepsiBilinmiyor = Boolean(k && k.istek > 0 && k.bilinmeyen >= k.istek);
  const satirlar = bolgelereTopla(k).sort((x, y) => (hepsiBilinmiyor ? y.istek - x.istek : (y.maliyet ?? -1) - (x.maliyet ?? -1) || y.istek - x.istek));
  const deger = (s: { maliyet: number | null; istek: number }) => (hepsiBilinmiyor ? s.istek : s.maliyet ?? 0);
  const enCok = Math.max(...satirlar.map(deger), 0.000001);
  return (
    <AyarBolgesi id="kullanim-amac" className="kullanim">
      <div className="kullanim__ust">
        <div className="ayar__metin"><b>{t.ad}</b><span>{t.aciklama}</span></div>
        {k && <span className="kullanim__toplam" data-toplam-maliyet={hepsiBilinmiyor ? 'bilinmiyor' : k.toplam}><b>{dolar(hepsiBilinmiyor ? null : k.toplam)}</b><span>{sayi(k.istek)} çağrı{k.bilinmeyen ? ` · ${sayi(k.bilinmeyen)} çağrının fiyatı bilinmiyor` : ''}</span></span>}
      </div>
      {k === undefined ? <div className="t-kucuk">Yükleniyor…</div> : !satirlar.length ? <div className="t-kucuk">Henüz kullanım yok.</div> : (
        <div className="kullanim__liste">
          {satirlar.map((s) => (
            <div key={s.ad} className="kullanim__satir">
              <span className="kullanim__ad">{s.ad}</span>
              <span className="kullanim__cubuk" aria-hidden="true"><i style={{ width: `${Math.max(2, (deger(s) / enCok) * 100)}%` }} /></span>
              <span className="kullanim__deger">{`${sayi(s.istek)} çağrı · ${dolar(s.maliyet, 3)}`}</span>
            </div>
          ))}
        </div>
      )}
    </AyarBolgesi>
  );
}

function ModelGrubu() {
  const k = useKullanim(30);
  const t = useAyarTanimi('kullanim-model');
  if (!t) return null;
  const bilinmeyen = k?.modeller.some((m) => m.maliyet === null);
  return (
    <AyarBolgesi id="kullanim-model" className="kullanim">
      <div className="ayar__metin"><b>{t.ad}</b><span>{t.aciklama}</span></div>
      {k?.modeller.length ? (
        <>
          <table className="kullanim__tablo">
            <thead><tr><th>Model</th><th>Çağrı</th><th>Giriş</th><th>Çıkış</th><th>≈ USD</th></tr></thead>
            <tbody>{k.modeller.map((s) => <tr key={s.saglayici + s.model} data-model-maliyet={s.maliyet === null ? 'bilinmiyor' : s.maliyet}><td>{s.model} <span className="cok-soluk">· {s.saglayici}</span></td><td>{s.istek}</td><td>{sayi(s.giris)}</td><td>{sayi(s.cikis)}</td><td>{s.maliyet === null ? '—' : Number(s.maliyet).toFixed(3)}</td></tr>)}</tbody>
          </table>
          {bilinmeyen && <div className="t-kucuk">— : fiyatı bilinmiyor (Fuber gateway krediyle ücretlendirir ya da model fiyat tablosunda yok); toplama katılmaz.</div>}
        </>
      ) : <div className="t-kucuk">Henüz kullanım yok.</div>}
    </AyarBolgesi>
  );
}

export const KULLANIM: IcerikHaritasi = { ozet: AmacGrubu, modeller: ModelGrubu };
