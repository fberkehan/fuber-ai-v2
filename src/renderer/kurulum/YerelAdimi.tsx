// ── Kurulum › Bu cihazda çalışan yapay zekâ (0.10 E4, K5) ───────────────────────────────────────────────────────────────────────────
// Kurulum yerel modeli de bilir ve sorar: yalnız cihazınızda çalışan özellik ister misiniz?
// Kullanıcıya model listesi gösterilmez: bilgisayardan TEK öneri (shared/yerel-boyut.ts yerelOnerisi; ekran kartı belleği ≥ 16 GB → en
// büyük, ≥ 8 GB → orta, yoksa en hafif) ve tek cümle: "Bu bilgisayar için önerilen: Hafif sürüm · ~1,9 GB iner". İki seçenek: "İstiyorum"
// (önerilen, seçili) / "Şimdilik hayır". "Devam" seçimi uygular: indirme ARKA PLANDA başlar (yerel:kur; sihirbaz beklemez, kapansa da
// sürer, bitince açılır). Gizli mod seçildiyse seçim yok: önerilen kendiliğinden hazırlanır. Kuruluysa ya da iniyorsa yalnız durumu.
// R25: model adı hiçbir modda yok (Geliştirici'de de yalnız boy ve boyut; model kimliği yalnız Ayarlar → Yapay zekâ'da). Yerel yapay zekâ
// Normal modda internet kesilince devreye GİRMEZ (yedekleme yok): metin yalnız gerçeği söyler — Gizli modda beklemeden çalışır (R25).
import type { YerelOneri } from '../../shared/yerel-boyut';
import { Bas, Secenekler } from './Adimlar';

export type YerelSecimi = 'evet' | 'hayir';

export function YerelAdimi({ oneri, bakamadim = false, secim, sec, gizli, iniyor, gelistirici }: {
  oneri: YerelOneri | null;
  /** Öneri ~10 sn'de gelmedi (bilgisayar ya da yerel durum okunamadı; I1 5b): sayfa geçilebilir, hiçbir şey indirilmez. */
  bakamadim?: boolean;
  secim: YerelSecimi; sec: (v: YerelSecimi) => void; gizli: boolean;
  /** İndirme sürüyor (yüzde) — bu sihirbazda ya da önceden başlatılmış. */
  iniyor: number | null;
  gelistirici: boolean;
}) {
  const giris = 'Gizli modda yanıtları bu bilgisayar verir. Arka planda iner; kurulumu beklemezsin.';
  // Sözlük (P2): İş'te K6'nın sayfa adı, Geliştirici'de "Yerel model".
  const baslik = gelistirici ? 'Yerel model' : 'Bu cihazda çalışan yapay zekâ';
  if (!oneri && bakamadim) {
    return (
      <>
        <Bas baslik={baslik} giris="Bu bilgisayara bakamadım. İstediğin an Ayarlar → Gizlilik’ten kurarsın." />
        {/* Gizli mod istenmişti: "Devam" onu geri alır (sayfalar/Kurulum.tsx yereliUygula; hazır olmayan Gizli mod kalmaz). */}
        {gizli && <p className="kurulum__dip" data-yerel-gizli-geri="">Gizli modu açmıyorum; Normal modda sürdürürüz.</p>}
      </>
    );
  }
  if (!oneri) return <><Bas baslik={baslik} giris={giris} /><div className="kart sistem-bekle" aria-live="polite"><span className="donen" />Bilgisayarına bakıyorum…</div></>;
  if (!oneri.uygun) {
    return (
      <>
        <Bas baslik={baslik} giris="Bu bilgisayar buna yetmiyor. Daha güçlü bir bilgisayarda Ayarlar → Gizlilik’ten kurarsın." />
        <div className="kart yerel-oneri" data-yerel-oneri="uygun-degil"><span className="nokta" aria-hidden="true" /><span>{oneri.neden}.</span></div>
        {/* Gizli mod istenmişti: "Devam" onu geri alır (sayfalar/Kurulum.tsx yereliUygula) — sessizce hiç hazır olmayan Gizli mod kalmaz. */}
        {gizli && <p className="kurulum__dip" data-yerel-gizli-geri="">Gizli modu açmıyorum; Normal modda sürdürürüz.</p>}
      </>
    );
  }
  const satir = `${oneri.etiket} · ${oneri.kurulu ? 'bu bilgisayarda kurulu' : oneri.metin}${oneri.ekranKarti ? ' · ekran kartında' : ''}`;
  if (oneri.kurulu || iniyor !== null) {
    return (
      <>
        <Bas baslik={baslik} giris={giris} />
        <div className="kart yerel-oneri" data-yerel-oneri={oneri.kurulu ? 'kurulu' : 'iniyor'}>
          <span className="nokta nokta--yesil" aria-hidden="true" />
          <span className="yerel-oneri__yazi">
            <b>{oneri.kurulu ? 'Hazır: bu bilgisayarda kurulu.' : `İniyor · %${iniyor}`}</b>
            <span>{satir}</span>
            {!oneri.kurulu && <span className="ilerleme yerel-oneri__cubuk"><i style={{ width: `${Math.max(2, iniyor ?? 0)}%` }} /></span>}
          </span>
        </div>
      </>
    );
  }
  return (
    <>
      <Bas baslik={baslik} giris={giris} />
      <div className="yerel-oneri__satir" data-yerel-oneri="oneri">Bu bilgisayar için önerilen: <b>{oneri.etiket} · {oneri.metin}</b></div>
      {gizli ? (
        <div className="kurulum-not" role="status" data-yerel-gizli="">
          <span className="nokta nokta--yesil" />
          <span>Gizli mod için bunu hazırlıyorum; “Devam”a basınca arka planda iner.</span>
        </div>
      ) : (
        <Secenekler
          etiket={baslik} deger={secim} sec={sec}
          secenekler={[
            { deger: 'evet', ad: 'İstiyorum', rozet: true, aciklama: 'Gizli moda geçtiğinde beklemeden, çevrimdışı çalışır.' },
            { deger: 'hayir', ad: 'Şimdilik hayır', aciklama: 'İstediğin an Ayarlar → Gizlilik’ten kurarsın.' },
          ]}
        />
      )}
      {gelistirici && <p className="kurulum__dip">Başka bir sürüm: Ayarlar → Gizlilik.</p>}
    </>
  );
}
