// ── Kurulum › Gizlilik (0.10 E4, K4; G8 Step 5: C-14, C-16) ─────────────────────────────────────────────────────────────────────
// "Gizli mod ister misiniz": gizli modda yapılanlar sunucuya gönderilmez. Tek soru, iki büyük seçenek: "Normal
// (önerilen)" ve "Gizli mod". Donanım ızgarası, model adı ve indirme düğmesi YOK (cihazdaki yapay zekâ bir sonraki sayfada, tek öneriyle).
// Gizli mod seçilince bir sonraki sayfa bu bilgisayara uygun yapay zekâyı kendiliğinden seçer; sayfa hazırlandığını söyler (hazır olana dek
// sohbet bekler: motor/secici.ts — Gizli modda yerel hazır değilse yol yok). F1 (son inceleme K1): metin yalnız doğru olanı söz verir
// (shared/kurulum-yerel.ts gizliKapsami: sohbet, ses, notlar, hafıza; bağlantılar ve pano; Geliştirici'de Claude Code). Seçim sayfadan
// "Devam"la çıkarken kaydedilir (sayfalar/Kurulum.tsx). Hesapsız İş kullanıcısında Gizli mod önerilmiş gelir (K1: hesapsız yol).
// Bu bilgisayar cihazda çalışan yapay zekâya yetmiyorsa Gizli mod kapalı, nedeni tek cümle.
import type { YerelOneri } from '../../shared/yerel-boyut';
import { gizliKapsami } from '../../shared/kurulum-yerel';
import { Bas, Secenekler } from './Adimlar';

export type GizlilikSecimi = 'normal' | 'gizli';

export function GizlilikAdimi({ secim, sec, oneri, hesapsizIs, gelistirici = false }: {
  secim: GizlilikSecimi; sec: (v: GizlilikSecimi) => void;
  /** Cihazdaki yapay zekânın önerisi (null: bilgisayara bakılıyor). */
  oneri: YerelOneri | null;
  /** Hesapsız İş kullanıcısı: Gizli mod önerilen. */
  hesapsizIs: boolean;
  /** Geliştirici: sözlükte "yerel model" (P2). */
  gelistirici?: boolean;
}) {
  const uygunDegil = oneri && !oneri.uygun ? oneri.neden : null;
  const kapsam = gizliKapsami(gelistirici ? 'gelistirici' : 'is');
  return (
    <>
      <Bas baslik="Ne kadar gizli kalayım?" giris={hesapsizIs && !uygunDegil ? 'Hesabın olmadığı için gizli modu önerdim: yapay zekâ bu bilgisayarda çalışır.' : 'İstediğin an Ayarlar’dan değiştirirsin.'} />
      <Secenekler
        etiket="Gizlilik" deger={uygunDegil ? 'normal' : secim} sec={sec}
        secenekler={[
          { deger: 'normal', ad: 'Normal', rozet: !hesapsizIs, aciklama: 'En iyi yanıtlar için Fuber’in yapay zekâsını kullanırım; hafızan yine bu bilgisayarda saklanır.' },
          {
            deger: 'gizli', ad: 'Gizli mod', rozet: hesapsizIs && !uygunDegil, devreDisi: Boolean(uygunDegil),
            aciklama: uygunDegil ? `Bu bilgisayarda kullanılamıyor: ${uygunDegil.charAt(0).toLocaleLowerCase('tr-TR')}${uygunDegil.slice(1)}.` : kapsam.secenek,
          },
        ]}
      />
      {secim === 'gizli' && !uygunDegil && (
        <>
          <div className="kurulum-not" role="status" data-gizli-hazirlaniyor="">
            <span className="nokta nokta--yesil" />
            <span>{kapsam.hazirlaniyor}</span>
          </div>
          <p className="kurulum__dip" data-gizli-kapsam="">{kapsam.dip}</p>
        </>
      )}
    </>
  );
}
