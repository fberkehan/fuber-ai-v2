// Kokpit kartları: "Gün kaydı" (dinleme durumu, bugünün sayaçları, not tutma ve raporların durumu, önemli notlar, son araya girme,
// son rapor) ve "Takip edilecekler" (0.10 Görev 3, P2: eski adları "Düşünme motoru", "Açık meseleler"). Veri `KokpitVerisi.dusunme`; ana
// süreç henüz göndermiyorsa boş durum görünür. 0.11 G5: ikisi de kütüphanenin Kart'ı (pano kartlarıyla aynı dil); kartta kaydırma yok —
// sığmayan notlar kartın ölçüsüne göre bırakılır, tamamı Hafıza'da (Raporlar / Takip edilecekler).
import { useRef } from 'react';
import { cagir, zamanGoreli } from '../api';
import { Bos, Dugme, Kart, Liste, MetinKirp, Rozet, Satir } from '../ui';
import { Ikon } from './Ikon';
import { AjanNoktasi, bugunMetni, gunGoreli, saatMetni } from './DusunmeOrtak';
import { hedefYakin } from './Meseleler';
import { ListeKarti } from '../pano/KullaniciKartlari';
import { satirSayisi, useSigdir } from '../pano/sigdir';
import type { Hucre } from '../pano/PanoKartlari';
import type { DusunmeDurumu, KokpitVerisi, Mesele } from '../../shared/tipler';
import { TERIM } from '../../shared/terimler';

type Git = (sayfa: string, id?: number) => void;
/** Hafıza sayfasının sekmesine (#raporlar, #meseleler) ya da Ayarlar'daki bölüme (#dusunme) götürür. */
const hedefeGit = (git: Git, sayfa: string, cipa: string) => { location.hash = cipa; git(sayfa); };

function DinlemeRozeti({ d }: { d: DusunmeDurumu }) {
  return <Rozet ton={d.dinliyor ? 'iyi' : 'notr'}>{d.dinliyor ? 'Dinliyor' : d.neden || 'Dinlemiyor'}</Rozet>;
}

export function GunKaydiKarti({ v, git, baslik, ...hucre }: { v?: KokpitVerisi['dusunme']; git: Git; baslik?: string } & Hucre) {
  const ref = useRef<HTMLDivElement>(null);
  const d = v?.durum;
  const notlar = (v?.bugunOnemli ?? []).slice(0, 5);
  const eslik = d?.sonEslik;
  const rapor = v?.sonRapor;
  // Sığma adımları: 0 → hepsi; 1 → araya girme satırı kalkar; sonra notlar birer birer; en son raporun satırı.
  const adim = useSigdir(ref, 1 + notlar.length + (rapor ? 1 : 0), `${notlar.map((m) => m.id).join(',')}|${eslik?.zaman ?? ''}|${rapor?.id ?? ''}`);
  const notSayisi = satirSayisi(adim, notlar.length, 1, 0);
  if (!d?.etkin) {
    return (
      <Kart {...hucre} baslik={baslik ?? TERIM.gunKaydi}>
        <Bos baslik="Gün kaydı kapalı" metin="Ayarlar’dan açabilirsin." eylem={{ etiket: 'Ayarlar', tikla: () => hedefeGit(git, 'ayarlar', 'dusunme') }} />
      </Kart>
    );
  }
  return (
    <Kart {...hucre} baslik={baslik ?? TERIM.gunKaydi} eylem={rapor ? { etiket: 'Raporlar', tikla: () => hedefeGit(git, 'hafiza', 'raporlar') } : undefined}>
      <div ref={ref} className="gun-kaydi">
        <div className="gun-kaydi__ust">
          <span className="gun-kaydi__bugun"><MetinKirp metin={bugunMetni(d)} satir={1} /></span>
          <DinlemeRozeti d={d} />
          {(d.ajanlar ?? []).length > 0 && <span className="gun-kaydi__ajanlar" aria-label={TERIM.notlarRaporlar}>{d.ajanlar.slice(0, 6).map((a) => <AjanNoktasi key={a.ad} a={a} />)}</span>}
        </div>
        {notlar.length
          ? <Liste>{notlar.slice(0, notSayisi).map((m) => <Satir key={m.id} sol={saatMetni(m.zaman)} baslik={m.metin} satir={2} />)}</Liste>
          : <p className="gun-kaydi__bos">Bugün henüz önemli not yok.</p>}
        {eslik && adim === 0 && <div className="gun-kaydi__eslik"><MetinKirp metin={`Fuber araya girdi: “${eslik.metin}” · ${zamanGoreli(eslik.zaman)}`} satir={2} /></div>}
        {rapor && adim < 1 + notlar.length + 1 && (
          <Satir sol={<Ikon ad="liste" olcu={16} />} baslik={rapor.baslik} alt={rapor.ozet || undefined}
            tikla={() => hedefeGit(git, 'hafiza', 'raporlar')} />
        )}
      </div>
    </Kart>
  );
}

export function MeselelerKarti({ liste, sayi, git, yenile, baslik, ...hucre }: { liste: Mesele[]; sayi: number; git: Git; yenile: () => void; baslik?: string } & Hucre) {
  const kapat = (id: number) => void cagir('gunkaydi:mesele-guncelle', id, { durum: 'kapandi' }).catch(() => null).then(yenile);
  return (
    <ListeKarti baslik={baslik ?? TERIM.takip} kayitlar={liste} hucre={hucre} anahtar={liste.map((m) => m.id).join(',')}
      sayfa={{ etiket: `Tümü${sayi ? ` · ${sayi}` : ''}`, ac: () => hedefeGit(git, 'hafiza', 'meseleler'), hep: true }}
      satir={(m) => (
        <Satir key={m.id} baslik={m.baslik} alt={[m.kisi, m.ayrinti].filter(Boolean).join(' · ') || undefined}
          sag={(
            <span className="kk-sag">
              {m.hedef && <span data-yakin={hedefYakin(m) ? '' : undefined}>{gunGoreli(m.hedef)}</span>}
              <Dugme tur="hayalet" boyut="k" simge="tamam" aria-label="Kapandı" onClick={() => kapat(m.id)} />
            </span>
          )} />
      )}
      bos={<Bos baslik="Takip edilecek bir şey yok." />} />
  );
}
