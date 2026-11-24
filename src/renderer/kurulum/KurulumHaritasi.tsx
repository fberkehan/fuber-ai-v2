// ── Kurulumun sol paneli: Fuber logosu, sayfa haritası (seçilen değerlerle) ve güven cümlesi (0.10 E4; G8 Step 3, D1, denetim C-3/C-6) ──
// 3B beyin kalktı; Fuber adı ve logosu düzgünce kullanılır. Panel temaya uyan bir levha: üstte büyük FUBER yazısı,
// ortada dikey sayfa listesi (sağdaki ilerleme çubuğunun, "1 / 10" sayacının ve çift başlığın yerine), altta tek cümle. Satırlar:
// işaret (tamam ✓ · şimdiki dolu nokta · sıradaki ince çember), sayfanın adı ve altında yapılan seçim ("Deniz Bey", "Koyu", "Sonra").
// Tamamlanan satır tıklanınca o sayfaya döner; Ayarlar'dan yeniden açılan sihirbazda bütün satırlar tıklanır. Bulunulan satır
// değişince yalnız işaret ve renk 240 ms'de geçer (liste kaymaz); azaltılmış harekette geçiş yok. Beyin, 3B, "Faz/önizleme" yok.
import { Ikon } from '../bilesenler/Ikon';
import { Logo } from '../bilesenler/Ortak';
import { adimAdi, KURULUM_ADIMLARI, type AdimId } from '../../shared/kurulum-adimlari';
import type { Mod } from '../../shared/tipler';

export function KurulumHaritasi({ sira, simdiki, ozetler, git, tiklanir, altBaslik, hepsiniOzetle = false, mod }: {
  sira: readonly AdimId[];
  /** Kullanım biçimi: sayfa adları sözlüğe göre (Geliştirici'de "Yerel model"; P2). */
  mod?: Mod;
  /** Bulunulan sayfa; null: yükseltme özeti (henüz hiçbir sayfa açılmadı). */
  simdiki: AdimId | null;
  ozetler: Partial<Record<AdimId, string>>;
  git: (id: AdimId) => void;
  tiklanir: (id: AdimId, i: number) => boolean;
  altBaslik: string;
  /** Seçim özeti yalnız geçilen sayfalarda; yeniden açılan sihirbazda ve yükseltme özetinde her sayfada (şimdiki ayarlar). */
  hepsiniOzetle?: boolean;
}) {
  const s = simdiki ? sira.indexOf(simdiki) : -1;
  return (
    // Sınıf bilerek `.kurulum__sahne` DEĞİL: tasarim.css o sınıfı her temada koyu tutar (eski "zihin odası"); harita temaya uyar.
    <aside className="kh" aria-label="Kurulum" data-kurulum-haritasi="">
      <div className="kh__marka">
        <span className="kh__logo"><Logo yukseklik={26} /></span>
        <span className="kh__alt-baslik">{altBaslik}</span>
      </div>
      <ol className="kh__liste" data-satir={sira.length}>
        {sira.map((id, i) => {
          const hal = i < s ? 'tamam' : i === s ? 'simdi' : 'sirada';
          const ozet = hal === 'tamam' || (hepsiniOzetle && hal !== 'simdi') ? ozetler[id] : '';
          const acik = tiklanir(id, i) && hal !== 'simdi';
          return (
            <li key={id}>
              <button
                type="button" className="kh__satir" data-hal={hal} data-adim={id} disabled={!acik} aria-current={hal === 'simdi' ? 'step' : undefined}
                onClick={() => git(id)} title={acik ? `${adimAdi(id, KURULUM_ADIMLARI, mod)} sayfasına git` : undefined}
              >
                <span className="kh__isaret" aria-hidden="true">{hal === 'tamam' && <Ikon ad="tamam" olcu={11} kalinlik={2.6} />}</span>
                <span className="kh__yazi">
                  <span className="kh__ad">{adimAdi(id, KURULUM_ADIMLARI, mod)}</span>
                  {ozet ? <span className="kh__ozet" data-ozet="">{ozet}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="kh__guven"><Ikon ad="kilit" olcu={14} />Hafızan ve ayarların bu bilgisayarda saklanır.</p>
    </aside>
  );
}
