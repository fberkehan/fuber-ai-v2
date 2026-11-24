// ── Kurulum › Hazırsın: adanın tanıtımı + "Şimdi dene" (0.10 E4, K6; G8 kapanışı, denetim C-7, C-24, C-29) ─────────────────────────────
// Son sayfa sakin ve kısa: başlık, tek cümleyle ada ("Ekranın üstündeyim — buna ada diyoruz"), adanın sayfa içi canlandırması
// (AdaSahnesi; az harekette sabit kart), "Şimdi dene" (gerçek adayı soru kutusu hâlinde ve KLAVYE ODAĞIYLA açar; dinlemeye başlamaz)
// ve kısayol ipucu ("Hey Fuber" kapalıysa yalnız kısayol). Yapay zekânın durumu TEK nötr satır (kırmızı yok): sihirbaz hesaplar
// (shared/kurulum-yerel.ts hazirDurumu — Gizli mod açık ama yerel hazır değilse her zaman söyler); her şey hazırsa satır yok. Kimliği
// 'ada' kalır (yükseltme kapanışı; eklentiler önizlemesi).
import { cagir } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { hitapMetni } from '../../shared/hitap';
import type { KurulumKipi } from '../../shared/kurulum-adimlari';
import type { Ayarlar } from '../../shared/tipler';
import { AdaSahnesi } from './AdaKopyasi';
import { Bas, CagirmaIpucu } from './Adimlar';

export function AdaAdimi({ ayar, kip, tanisma, durum }: {
  ayar: Ayarlar; kip: KurulumKipi; tanisma: { kullaniciAdi: string; hitap: string };
  /** Tek nötr durum satırı (yoksa null). */
  durum: string | null;
}) {
  const hitap = hitapMetni(tanisma.kullaniciAdi, tanisma.hitap);
  const son = kip === 'ilk' ? '“Başla”ya basınca seni kısa bir tura çıkarırım.' : kip === 'yukseltme' ? 'Hafızan ve sohbetlerin olduğu gibi duruyor.' : '“Bitti”ye basınca ayarlarını kaydederim.';
  return (
    <>
      <Bas baslik={hitap ? `Hazırsın, ${hitap}.` : 'Hazırsın.'} giris={`Ekranın üstündeyim — buna ada diyoruz. ${son}`} />
      <AdaSahnesi />
      <div className="ada-dene">
        <button type="button" className="dgm dgm--koyu" onClick={() => void cagir('asistan:goster', false, true)} data-simdi-dene=""><Ikon ad="oynat" olcu={14} />Şimdi dene</button>
        <div className="ada-ipucu"><span>Kendin çağırmak için</span><CagirmaIpucu kisayol={ayar.ses.kisayol} uyandirma={ayar.ses.uyandirma} /></div>
      </div>
      {durum && <p className="kurulum-durum" role="note" data-hazir-durumu="">{durum}</p>}
    </>
  );
}
