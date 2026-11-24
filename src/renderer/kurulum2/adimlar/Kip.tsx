// Kurulum v2 › Nasıl kullanacaksın (0.13 spec B; 0.14 T32 Nusa dili): iki büyük kart yan yana, Business mode ve Developer mode; her kartın üstünde
// gözleri (11 Kas "Pamuk"; 120 px siyah sahne, parıltı kipin renginde; kip-karakter.ts), altında kipin adı ve tek cümlelik tonu (shared/kurulum-taslak.ts
// kipKartlari: Yönetim'in değerleri varsa onlar, yoksa gömülü varsayılanlar; ad iki modda da "Fuber"). Business önerilen olarak seçili gelir. Gözler
// imleci izler; kartın üzerine gelince selam verir (kısa gülümseme ve zıplama); az harekette (Görünüm → "Az hareket" ya da Windows'un animasyon tercihi,
// olay anında okunur) yalnız kırpma. Seçili kartın halkası ekranın vurgusu (kök vurguStili: seçilen kipin rengi). Seçim ANINDA kaydedilir: sonraki
// adımlar (Nerede, Ses) ve "Dinle" kipi görsün; Vazgeç açılıştakine döndürür (shared/kurulum-vazgec.ts). Developer'da ilk kurulumda "Claude Code notlarımı
// oku" anahtarı çıkar (varsayılan kapalı). Sağda gözler konuşur: seçim değişince göz aynı kalır, parıltının rengi çapraz solar (ModGecisi), altında örnek
// bir soru ve yanıtı, en altta bu kipte neler olduğu.
// 0.14 T6b (Sade mod): kartlarda ve önizlemede göz YOK — kartta kipin adı ve kipin vurgu rengini taşıyan nötr işaret (SadeIsaret); önizlemede ModGecisi
// kendisi Sade geçişine döner, durağan hâlde de SadeIsaret.
import { useEffect, useState, type CSSProperties } from 'react';
import { cagir } from '../../api';
import { Ikon } from '../../bilesenler/Ikon';
import { Anahtar, Nesne, Tepsi } from '../../ui/fintech';
import { radyoTusu } from '../../ui/fintech/radyo';
import { Gozler, ModGecisi, SadeIsaret } from '../../ui/goz';
import type { GozTetigi } from '../../../shared/goz';
import { KIP_ADI, KIP_ISLEVI, etkinKarakter, modKip, type KipKimligi } from '../../../shared/karakterler';
import { DEVELOPER_KAPSAMI, claudeNotlariGorunur, kipKartlari, type KipKarti as KipKartiVerisi } from '../../../shared/kurulum-taslak';
import { KM, type Cift } from '../../../shared/kurulum-metin';
import type { Mod } from '../../../shared/tipler';
import { useAdim } from '../baglam';
import { vurguStili } from '../../ui/vurgu';
import { useKarakterGorunur } from '../../karakter-gorunum';
import { gorunenKarakterAdi } from '../../../shared/karakter-gorunum';
import { Bas, kademe } from '../Ortak';
import { KIP_KARTI_KARAKTERI, KIP_ONIZLEME_KARAKTERI, SADE_KART_ISARETI_PX, kipGecisi, uzerineGelinceTetik } from '../kip-karakter';

/** Windows animasyon efektleri kapalı mı (R16): olay anında bir kez okunur, dinleyici yok. */
const sistemAzMi = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Az hareket: Görünüm → "Az hareket" (gorunum.azHareket) ya da Windows'un tercihi. */
function useAzHareket(): { az: boolean; azMi: () => boolean } {
  const { ayar } = useAdim();
  const ayarAz = ayar.gorunum?.azHareket === true;
  return { az: ayarAz, azMi: () => ayar.gorunum?.azHareket === true || sistemAzMi() };
}

/** Sade'de kartın ve önizlemenin işareti: SadeIsaret, kipin rengi yüzeyde okunur (≥ 3:1) — sarmalayıcı kipin --vurgu'sunu taşır, kurulum2.css
 *  işaretin rengini temanın açıklık sınırına çeker (açık temada ham turuncu beyaz kartta 1,6:1 kalıyordu). */
function SadeKartIsareti({ kip, az }: { kip: KipKimligi; az: boolean }) {
  return <span className="k2-sade-isaret" style={vurguStili('kurulum', kip) as CSSProperties}><SadeIsaret kip={kip} boyut={SADE_KART_ISARETI_PX} azHareket={az} /></span>;
}

function KipKarti({ k, secili, sec, onerilen, gorunur }: { k: KipKartiVerisi; secili: boolean; sec: (m: Mod) => void; onerilen: boolean; gorunur: boolean }) {
  const kip: KipKimligi = modKip(k.mod);
  const { az, azMi } = useAzHareket();
  // Üzerine gelme kenar tetiği: `no` arttıkça gözlerin jesti bir kez oynar (ilk değer oynamaz).
  const [tetik, setTetik] = useState<{ ad: GozTetigi; no: number }>();
  const uzerine = () => {
    const ad = uzerineGelinceTetik(k.mod, { azHareket: azMi(), gorunur });
    if (ad) setTetik((o) => ({ ad, no: (o?.no ?? 0) + 1 }));
  };
  return (
    <button
      type="button" role="radio" className="k2-kip" data-deger={k.mod} data-kip-karti={k.mod} aria-checked={secili} tabIndex={secili ? 0 : -1}
      aria-label={onerilen ? `${k.ad} (önerilen)` : k.ad} onClick={() => sec(k.mod)} onPointerEnter={uzerine}
    >
      <span className="k2-kip__sahne" aria-hidden="true" data-sade={gorunur ? undefined : ''}>
        {gorunur
          ? <Gozler kip={kip} boyut={KIP_KARTI_KARAKTERI.boyut} hal="sakin" azHareket={az} tetik={tetik} />
          : <SadeKartIsareti kip={kip} az={az} />}
      </span>
      <span className="k2-kip__yazi">
        <span className="k2-kip__baslik"><span className="k2-kip__ad">{k.ad}</span>{onerilen && <span className="ft-rozet">Önerilen</span>}</span>
        {/* 11 Kas (tasarımcı bulgu 10): Sade'de kart tonu değil işlevi anlatır; gözlü görünümde kipin tonu (ad iki kartta da Fuber olduğu için yazılmaz). */}
        <span className="k2-kip__aciklama">{gorunur && k.tanim ? k.tanim : KIP_ISLEVI[k.mod]}</span>
      </span>
      <span className="ft-secim__isaret k2-kip__isaret" aria-hidden="true"><Ikon ad="tamam" olcu={13} kalinlik={2.6} /></span>
    </button>
  );
}

export function KipAdimi() {
  const { kip, taslak: t, degistir, kaydet, ayar, m } = useAdim();
  // 0.14 T6b (Sade mod): kartın ikinci satırı kipin işlevi; gözlü görünümde kipin tonu.
  const gorunur = useKarakterGorunur();
  const notlar = claudeNotlariGorunur(kip, t.mod);
  // Bu bilgisayardaki not sayısı; null: henüz bakılıyor. Not yoksa anahtar söz vermez (kapalı, nedeniyle).
  const [sayi, setSayi] = useState<number | null>(null);
  useEffect(() => { if (notlar) void cagir<number>('kurulum:claude-hafiza-sayisi').then(setSayi).catch(() => setSayi(0)); }, [notlar]);
  const sec = (mod: Mod) => { degistir({ mod }); kaydet({ mod }); };
  const acik = (['is', 'gelistirici'] as const);
  return (
    <div className="k2-adim k2-kipler" data-kip-adimi="">
      <Bas baslik={m(KM.kipBaslik)} giris={m(KM.kipGiris)} />
      <div {...kademe(2)}>
        <div className="k2-kip-kartlari" role="radiogroup" aria-label="Kullanım" onKeyDown={(e) => radyoTusu(e, acik, t.mod, sec)}>
          {kipKartlari(ayar.hesap?.karakterler).map((k) => <KipKarti key={k.mod} k={k} secili={k.mod === t.mod} sec={sec} onerilen={k.mod === 'is'} gorunur={gorunur} />)}
        </div>
      </div>
      {notlar && (
        <div className="k2-satir" data-claude-hafiza="" {...kademe(3)}>
          <span className="k2-satir__yazi"><b>Claude Code notlarımı oku</b><span>{sayi === null ? 'Notlara bakıyorum…' : sayi ? m(KM.claudeNotVar(sayi)) : 'Bu bilgisayarda henüz Claude Code notu yok.'}</span></span>
          <Anahtar acik={t.claudeHafiza && Boolean(sayi)} degistir={(claudeHafiza) => degistir({ claudeHafiza })} etiket="Claude Code notlarımı oku" devreDisi={!sayi} />
        </div>
      )}
    </div>
  );
}

/** Önizlemenin örnek konuşması ve kipte neler olduğu (spec "Kipler arası fark"): karakter adı Yönetim'den değişse de cümle doğru kalır. */
const ORNEK: Record<Mod, { soru: Cift; yanit: Cift; maddeler: readonly (readonly [string, string])[] }> = {
  is: {
    soru: KM.kipIsSoru,
    yanit: KM.kipIsYanit,
    maddeler: [['kokpit', 'Kokpit ve günlük özet'], ['posta', 'E-posta ve WhatsApp yanıtları'], ['saat', 'Hatırlatıcılar ve planlar']],
  },
  gelistirici: {
    soru: KM.kipGelSoru,
    yanit: KM.kipGelYanit,
    maddeler: DEVELOPER_KAPSAMI,
  },
};

export function KipOnizleme() {
  const { taslak: t, ayar, m } = useAdim();
  const k = etkinKarakter(t.mod, ayar.hesap?.karakterler);
  const gorunur = useKarakterGorunur();
  const { az } = useAzHareket();
  const o = ORNEK[t.mod];
  // Seçim değişince ModGecisi (göz aynı kalır, parıltı çapraz solar). Geçiş render sırasında türetilir: yeni kip bir kare bile
  // geçişsiz görünmez. Bitince canlı gözler (ModGecisi bir kez `bitti` der; yarıda yeni seçim gelirse yeni geçiş başlar).
  const [son, setSon] = useState<Mod>(t.mod);
  const [gecis, setGecis] = useState<{ eski: KipKimligi; yeni: KipKimligi } | null>(null);
  if (son !== t.mod) { setSon(t.mod); setGecis(kipGecisi(son, t.mod)); }
  const kipK = modKip(t.mod);
  return (
    <Tepsi etiket="Kullanım önizlemesi" dip='Ses de modla birlikte değişir.'>
      <Nesne className="k2-karakter" data-onizleme-kip={t.mod}>
        <div className="k2-karakter__ust">
          <span className="k2-karakter__sahne" aria-hidden="true" data-onizleme-gecis={gecis ? '' : undefined}>
            {gecis
              ? <ModGecisi eski={gecis.eski} yeni={gecis.yeni} boyut={KIP_ONIZLEME_KARAKTERI.boyut} azHareket={az} bitti={() => setGecis(null)} />
              : gorunur
                ? <Gozler kip={kipK} boyut={KIP_ONIZLEME_KARAKTERI.boyut} hal="sakin" azHareket={az} />
                : <SadeKartIsareti kip={kipK} az={az} />}
          </span>
          <span className="k2-karakter__ad" key={t.mod} data-gecis-ad={gecis && !az ? '' : undefined}><b data-onizleme-karakter="">{gorunenKarakterAdi(gorunur, k.ad)}</b><span>{KIP_ADI[t.mod]}</span></span>
        </div>
        <span className="k2-soru__sen">{m(o.soru)}</span>
        <span className="k2-soru__yanit">{m(o.yanit)}</span>
      </Nesne>
      <Nesne className="k2-karakter-liste">
        <ul className="k2-karakter__maddeler">
          {o.maddeler.map(([simge, metin]) => <li key={metin}><Ikon ad={simge} olcu={16} />{metin}</li>)}
        </ul>
      </Nesne>
    </Tepsi>
  );
}
