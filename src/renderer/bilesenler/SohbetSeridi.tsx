// Sohbet yazı alanının üstündeki durum şeridi (Görev 14; tasarım belgesi §4.4; Ruling K; 0.10 Görev 2, Karar D2). Hâl motor sinyalinden
// (tek kaynak: renderer/motor-sinyali.ts gorunum → shared/motor-durumu.ts motorBildirimi): hiç bağlanmamışsa NÖTR (gri) "Fuber hesabına
// giriş yap" + tek düğme "Giriş yap" (Fuber hesabı penceresi); çalışan bağlantı koptuysa kırmızı; hesap onay bekliyorsa sakin nötr, kapalıysa
// ya da kullanım hakkı dolduysa kırmızı (R10 metinleri); yalnız yerel model varsa sarı not; Gizli modda Gizli modun kendi bildirimi.
// Gönderim yalnız hiç motor yokken kapalı (0.11 G8: ödeme şeridi kalktı). Metin ve kural: shared/abonelik.ts sohbetSeridi.
// Veri kilitlenmez (mesajlar okunur). Kokpit'te sohbet boşken şerit çizilmez (A-1/A-3: tek bildirim "Bugünün özeti" panelinin kartında;
// Sohbet `bosPanelBildirir`).
import { sohbetSeridi, type SohbetSeridi as Serit } from '../../shared/abonelik';
import { etkinKarakter } from '../../shared/karakterler';
import { motorEylemiYap, useMotorSinyali } from '../motor-sinyali';
import { YerelYenidenIndirDugmeleri } from './YerelYenidenIndir';
import './sohbet-seridi.css';

/** Şerit (yoksa null), gönderim ve Gizli mod bilgisi (0.11 G7: boş sohbetin hazır önerileri Gizli'de araçsız; tek abonelik, ikinci `useMotorSinyali` yok). Sinyal gelene dek şerit yok ve gönderim açık (yanlış bir "bağlı değil" karesi görünmesin). */
export function useSohbetSeridi(): { serit: Serit | null; gonderimKapali: boolean; gizli: boolean; aracsiz: boolean; karakter: string } {
  const m = useMotorSinyali();
  // Ayardaki modun karakteri: kilitli adı bilinmeyen süren yanıtın başı (0.13; Sohbet.tsx). Ayar gelene dek boş.
  const karakter = m.a ? etkinKarakter(m.mod, m.a.hesap?.karakterler).ad : '';
  if (!m.hazir || !m.a) return { serit: null, gonderimKapali: false, gizli: m.gizli, aracsiz: m.aracsiz, karakter };
  const serit = sohbetSeridi(m.mod, m.motor, m.gorunum, m.hesapDurumu, m.gizli);
  return { serit, gonderimKapali: !m.gonderilebilir, gizli: m.gizli, aracsiz: m.aracsiz, karakter };
}

export function SohbetSeridi({ serit }: { serit: Serit }) {
  return (
    <div className="sohbet-seridi" data-seviye={serit.seviye} data-tur={serit.tur} data-sohbet-seridi={serit.seviye} role="status">
      <div className="sohbet-seridi__ust"><span className="sohbet-seridi__nokta" aria-hidden="true" /><b>{serit.baslik}</b></div>
      {serit.aciklama && <p className="sohbet-seridi__metin">{serit.aciklama}</p>}
      {serit.dugmeler.length > 0 && (
        <div className="sohbet-seridi__dugmeler">
          {serit.dugmeler[0]?.eylem === 'yerel-kur' ? (
            <YerelYenidenIndirDugmeleri b={{ seviye: 'notr', baslik: serit.baslik, kisa: serit.baslik, dugme: serit.dugmeler[0].etiket, eylem: 'yerel-kur', ...(serit.dugmeler[1] ? { ikincil: serit.dugmeler[1] } : {}) }} />
          ) : serit.dugmeler.map((d, i) => (
            <button
              key={d.eylem ?? d.cipa ?? d.etiket} type="button" className={`dgm dgm--k ${i === 0 ? 'dgm--beyaz' : 'dgm--hayalet'}`} data-cipa={d.cipa} data-eylem={d.eylem}
              onClick={() => motorEylemiYap(d)}
            >{d.etiket}</button>
          ))}
        </div>
      )}
    </div>
  );
}
