// ── Kokpit "Görevler" kartı (0.11 G10; spec §8 Görünürlük) ───────────────────────────────────────────────────────────────────────────
// Bir şeyin takibi istenince Fuber aralıklar üretip kendi kendini tetikler. Fuber'e verilen süreli/sürekli işler burada görünür:
//   · SÜREN: başlık, kalan süre · son kontrol · adım sayısı ("2 dk 10 sn kaldı · son kontrol 12 sn önce · 3 adım"), son adım özeti (+ izinle yapılan
//     gönderim varsa kısa "N gönderim" rozeti), Durdur;
//   · DURAN: nedeni tek cümle ("Fuber kapandığı için durdu", "Gizli mod açıldığı için durdu") ve — sürdürülebiliyorsa — Sürdür;
//   · BUGÜN BİTEN: tek satır sonuç ("Bitti · <sonuç>").
// Satırın kendisi görevin sohbetine götürür (Sohbetler'de "Görev · <başlık>"). Kart G5'in kütüphane kartıdır (ListeKarti): kartta kaydırma yok, sığmayan
// satırlar "Tümü" levhasında; bütün cümleler shared/isler-gorunum.ts'te (saf, testli) ve İş dilindedir. Boş kart hiç çizilmez (Kokpit.tsx karar verir).
// Gizli modda ya da yalnız bu bilgisayardaki yapay zekâda (`aracsiz`) görevler çalışmaz: Sürdür kapalıdır ve nedeni ipucunda söylenir.
// 0.14 T31 (Nusa dili): kart kokpitin parçasıdır, kokpitin TEK vurgusunu (mavi) miras alır — ekran başına tek vurgu (koordinatör kararı, M5;
// görev camgöbeği yalnız kendi ekranında). Vurgu yalnız süren görevin Durdur hapındaki dur simgesinde. Yer darsa önce son adım özeti bırakılır (ikiSatir planı): yarım kartta tek görev
// ve altında boşluk kalmaz. Düzeltme turu 1 (I2): özet ya da "N gönderim" bırakıldıysa kartta "Tümü" çıkar (ayrintiVar → gizliSayisi); levhada
// özet ve rozet hep görünür — ayrıntı kartta yer yok diye erişilemez kalmaz.
import { useState, type CSSProperties } from 'react';
import { cagir } from '../api';
import { Dugme, MetinKirp, Rozet, Satir, vurguStili } from '../ui';
import { tostGoster } from '../tostlar';
import { ListeKarti } from './KullaniciKartlari';
import type { Hucre } from './PanoKartlari';
import { useSimdi } from './useGorevler';
import { TERIM } from '../../shared/terimler';
import { GOREV_DURDUR_HATASI, GOREV_SURDUR_HATASI, gonderimRozeti, gorevKartiOgeleri, gorevOzeti, gorevSatiri } from '../../shared/isler-gorunum';
import type { Mod } from '../../shared/tipler';
import { useMod } from '../mod';
import type { IsOzet } from '../../shared/isler';

type Git = (sayfa: string, id?: number) => void;

/** Sürdür kapalıyken ipucu (Gizli modda ya da yalnız bu bilgisayardaki yapay zekâda görevler araç ister, araç yok). */
export const SURDUR_KAPALI_IPUCU = 'Gizli modda ya da yalnız bu bilgisayardaki yapay zekâyla görevler çalışmaz';

/** Bir görevin satırı: [başlık + durum cümlesi + rozet] [Durdur | Sürdür], altında son adım özeti (+ "N gönderim"). `ozetli` false: özet
 *  satırı yok (kokpit kartında yer darken; levhada hep var). */
export function GorevSatiriKutusu({ is, simdi, git, aracsiz, mod, ozetli = true }: { is: IsOzet; simdi: Date; git: Git; aracsiz: boolean; mod: Mod; ozetli?: boolean }) {
  const s = gorevSatiri(is, simdi, mod);
  const ozet = gorevOzeti(is, mod);
  const gonderim = gonderimRozeti(is);
  const [mesgul, setMesgul] = useState(false);
  const bitir = () => setMesgul(false);
  // Güvenlik eylemi (Durdur/Sürdür) IPC'si düşerse sessiz kalmaz: ana pencerenin tost katmanında tek satır (düğme yeniden denenebilir kalır).
  const durdur = () => { setMesgul(true); void Promise.resolve(cagir('isler:durdur', is.id)).catch(() => tostGoster(GOREV_DURDUR_HATASI, 'hata', 5000)).finally(bitir); };
  const surdur = () => {
    setMesgul(true);
    void Promise.resolve(cagir<{ is: IsOzet } | { hata: string }>('isler:surdur', is.id))
      .then((r) => { if (r && typeof r === 'object' && 'hata' in r) tostGoster(r.hata, 'hata', 5000); })
      .catch(() => tostGoster(GOREV_SURDUR_HATASI, 'hata', 5000))
      .finally(bitir);
  };
  // Rozet yalnız dikkat isteyen/ek bilgi veren durumda (Çalışıyor, Sorun, Sınıra ulaştı, Gizli/acil durma): "Sürüyor", "Durdu", "Bitti" zaten satırın
  // kendisinden (Durdur/Sürdür düğmesi, "… için durdu", "Bitti · …") okunur — rozet yineleyip alt satırı daraltmaz.
  const rozet = s.rozet.ton === 'iyi' || s.rozet.ton === 'notr' ? null : <Rozet ton={s.rozet.ton}>{s.rozet.metin}</Rozet>;
  return (
    // Satır kokpitin vurgusunu kendisi de taşır: "Tümü" levhası kartın dışında (portal) çizilir, vurgu oraya miras gelmez.
    <div className="gorev-satir" style={vurguStili('kokpit') as CSSProperties} data-gorev={String(is.id)} data-durum={is.durum} data-adimda={is.adimda ? '' : undefined}>
      <div className="eylemli-satir">
        <Satir
          baslik={s.baslik} alt={s.alt} sag={rozet ?? undefined} soluk={is.durum === 'bitti'} ipucu="Görevin sohbetini açar" data-gorev-sohbet={String(is.sohbetId)}
          tikla={() => git('sohbetler', is.sohbetId)}
        />
        {s.eylem === 'durdur' && <Dugme tur="ikincil" boyut="k" simge="dur" data-gorev-eylem="durdur" disabled={mesgul} aria-label={`Durdur: ${s.baslik}`} onClick={durdur}>Durdur</Dugme>}
        {s.eylem === 'surdur' && (
          <Dugme tur="ikincil" boyut="k" data-gorev-eylem="surdur" disabled={mesgul || aracsiz} title={aracsiz ? SURDUR_KAPALI_IPUCU : undefined} aria-label={`Sürdür: ${s.baslik}`} onClick={surdur}>Sürdür</Dugme>
        )}
      </div>
      {ozetli && (ozet || gonderim) && (
        <div className="gorev-ozet">
          {ozet && <span className="gorev-ozet__metin"><MetinKirp metin={ozet} satir={1} as="span" /></span>}
          {gonderim && <Rozet ton="bilgi">{gonderim.metin}</Rozet>}
        </div>
      )}
    </div>
  );
}

/** Kokpit kartı: süren görevler üstte, bugün biten/duranlar altında. `liste` kokpitten gelir (isler:durum); saniyelik saat kartın kendisinde
 *  (süren görev varken saniyede, yoksa dakikada bir): kokpitin tamamı her saniye çizilmez. */
export function GorevlerKarti({ liste, git, aracsiz, ...hucre }: { liste: readonly IsOzet[]; git: Git; aracsiz: boolean } & Hucre) {
  const simdi = useSimdi(liste.some((g) => g.durum === 'suruyor'));
  // Kullanım biçimi yüklenene dek İş sayılır (yasak sözcük bir kare bile görünmesin; useMod son bilinen değerle başlar).
  const mod = useMod() ?? 'is';
  const { hepsi } = gorevKartiOgeleri(liste, simdi);
  return (
    <ListeKarti
      baslik={TERIM.gorevler} kayitlar={hepsi} hucre={hucre} sinif="gorevler" ikiSatir ayrintiVar={(g) => Boolean(gorevOzeti(g, mod) || gonderimRozeti(g))}
      anahtar={hepsi.map((g) => `${g.id}${g.durum}${g.adimda ? '+' : ''}${g.sonOzet ? 'o' : ''}${g.gonderim ? 'g' : ''}`).join(',')}
      satir={(g, iki) => <GorevSatiriKutusu key={g.id} is={g} simdi={simdi} git={git} aracsiz={aracsiz} mod={mod} ozetli={iki} />}
    />
  );
}

/** İlk kullanımda bir kez görünen tek satır (boş kart yerine; kartın ızgarada yeri yok): "Fuber’e bir işi takip ettirebilirsin". */
export function GorevBosIpucu({ metin }: { metin: string }) {
  return (
    <p className="gorev-ipucu" data-kart="gorevler" data-bos="" role="note">
      <span className="gorev-ipucu__baslik">{TERIM.gorevler}</span>
      <span className="gorev-ipucu__metin"><MetinKirp metin={metin} satir={1} as="span" /></span>
    </p>
  );
}
