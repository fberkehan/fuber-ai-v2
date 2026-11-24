// ── Kurulum › Geliştirici araçları (0.10 E4, K8; yalnız Geliştirici, Hazırsın'dan önce; ilk kurulumda ve yükseltmede) ──────────────────
// Graphify gibi Claude Code eklentileri sponsorlu öğe gibi öne çıkarılmaz. Sayfa
// TEK liste ("Önerilen araçlar"): her araç tek satır ad + tek kısa cümle (shared/cc-eklentiler.ts `kazanc`), sıra GELISTIRICI_PAKETI'nin
// kendi sırası (R23; G7 birleşti: Graphify sonda, R20) — hiçbiri öne çıkmaz, uyarı ya da açıklama yok. Tek soru: "Hepsini kur (önerilen)" / "Sonra". "Devam" seçimi uygular (sayfalar/Kurulum.tsx):
// hepsi ARKA PLANDA kurulur (claudecode:paket-baslat; sihirbaz beklemez; Claude Code yoksa kurulunca kurulur) ya da sayfa yalnız
// "görüldü" sayılır (bir daha teklif edilmez; Claude Code → Eklentiler'den istediği an kurar).
import { GELISTIRICI_PAKETI, ogeDesteklenirMi, varsayilanSecim } from '../../shared/cc-eklentiler';
import { Bas, Secenekler } from './Adimlar';

export type AraclarSecimi = 'hepsi' | 'sonra';

/** Önerilen araçlar (bu işletim sisteminde kurulabilenler), GELISTIRICI_PAKETI sırasıyla (R23). */
export function onerilenAraclar(platform = window.fuber?.platform) {
  const secim = new Set(varsayilanSecim(platform));
  return GELISTIRICI_PAKETI.filter((o) => secim.has(o.id) && ogeDesteklenirMi(o, platform));
}

export function GelistiriciAraclariAdimi({ secim, sec, claudeYok }: { secim: AraclarSecimi; sec: (v: AraclarSecimi) => void; claudeYok: boolean }) {
  const l = onerilenAraclar();
  return (
    <>
      <Bas baslik="Önerilen araçlar" giris={claudeYok ? 'Claude Code için; Claude Code kurulunca kurarım.' : 'Claude Code için; arka planda kurarım.'} />
      <Secenekler
        etiket="Önerilen araçlar" bicim="hap" deger={secim} sec={sec}
        secenekler={[{ deger: 'hepsi', ad: 'Hepsini kur', rozet: true }, { deger: 'sonra', ad: 'Sonra' }]}
      />
      <ul className="arac-listesi" aria-label="Önerilen araçlar" data-arac-sayisi={l.length}>
        {l.map((o) => (
          <li key={o.id} className="arac-satiri" data-arac={o.id}>
            <b>{o.ad}</b>
            <span>{o.kazanc}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
