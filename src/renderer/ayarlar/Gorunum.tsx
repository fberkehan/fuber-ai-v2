// Ayarlar → Görünüm: tema (Koyu · Açık · Şeffaf · Otomatik). Kayıt ana sürece gider; ana süreç nativeTheme'i, pencere zeminini ve sistem malzemesini
// günceller, 'tema:degisti' ile bütün pencereler (üst ortadaki ada dahil) temayı anında değiştirir. "Otomatik" ('sistem') Windows'un temasını izler.
// 0.12 H3a: yeni kurulum "Otomatik" başlar (Görünüm sorusu kurulum2'nin 0.13 Görünüm adımına döndü). 0.13 T13: "Şeffaf" (yarı saydam pencere) geri geldi;
// yalnız Windows 11 22H2+ ve macOS'ta SUNULUR (ana süreç `tema:etkin` ile bildirir, renderer/cam-destegi.ts) — yoksa düğme hiç çizilmez ve
// başka bilgisayardan kalmış bir 'cam' kaydı Koyu seçili görünür (kayıt değişmez).
// "Tanıtımı yeniden izle": tanıtım işareti (tanitimSurumu) silinir → ana pencere (main.tsx) kokpit turunu yeniden açar (Tanitim.tsx).
// "Kurulumu yeniden aç": yeni kurulum (renderer/kurulum2) mevcut ayarlarla, uygulamanın üstünde OPAK ve tam pencere açılır (main.tsx);
// bitince yalnız ayarlar kaydedilir, kurulum bitmiş kalır. ("Ada sessizken görünsün" Ses ve ada → Ada'da.)
// 0.14 T6b (11 Kas: "Gözler"): Göster / Sade (göz yok); Sade modda hiçbir yüzeyde göz yok, yerinde F işareti.
// 0.14 T19: "Çentik ve hareket": tam ekranda çentiği gizle (varsayılan açık) ve Az hareket (R16).
// 0.14 T22: "Sistem uyarıları": yedi anahtar (gorunum.uyarilar; hepsi varsayılan açık; shared/sistem-uyarilari.ts). Kaydedince ana süreç klavye kancasını yeniden
// söyler (Caps Lock ve dil ikisi de kapalıysa kanca kurulmaz).
// 0.14 T23: "Çentik sayfaları": açık paneldeki dokuz sayfanın sırası ve aç/kapa (gorunum.centikSayfalari); Asistan her zaman açık.
import { Ikon } from '../bilesenler/Ikon';
import { Anahtar } from '../bilesenler/Ortak';
import { sunulanTemalar, temaGocu } from '../../shared/tema-cozum';
import type { KarakterGorunumu, Tema } from '../../shared/tipler';
import { karakterGorunurMu } from '../../shared/karakter-gorunum';
import { uyariAnahtarlari, type UyariAnahtari } from '../../shared/sistem-uyarilari';
import { PANEL_SAYFALARI, sayfaAyariDogrula, type SayfaKimligi } from '../../shared/centik-sayfalar';
import { useCamDestegi } from '../cam-destegi';
import { useAyarlar, type IcerikHaritasi } from './baglam';
import { Satir } from './Ortak';

const SECENEKLER: [Tema, string, string][] = [['koyu', 'Koyu', 'ay'], ['acik', 'Açık', 'gunes'], ['cam', 'Şeffaf', 'cam'], ['sistem', 'Otomatik', 'ekran']];

function TemaGrubu() {
  const { a, kaydet } = useAyarlar();
  const sunulan = sunulanTemalar(useCamDestegi());
  const ayarTema: Tema = temaGocu(a.gorunum?.tema);
  // Şeffaf sunulmayan bilgisayarda kayıt 'cam' kalmış olabilir (başka bilgisayardan): ekranda geçerli olan Koyu seçili görünür.
  const tema: Tema = sunulan.includes(ayarTema) ? ayarTema : 'koyu';
  return (
    <Satir id="tema" ust>
      <div className="sekmeler" role="radiogroup" aria-label="Tema">
        {SECENEKLER.filter(([t]) => sunulan.includes(t)).map(([t, ad, ikon]) => (
          <button key={t} type="button" role="radio" aria-checked={tema === t}
            title={t === 'sistem' ? 'Windows’un temasına uyar' : t === 'cam' ? 'Masaüstün pencerenin arkasından görünür' : undefined}
            onClick={() => { if (tema !== t) kaydet({ gorunum: { ...a.gorunum, tema: t } }); }}>
            <Ikon ad={ikon} olcu={14} />{ad}
          </button>
        ))}
      </div>
    </Satir>
  );
}

// 0.14 T6b (Sade mod): "Göster" / "Sade (göz yok)". İki modda da (Business, Developer) aynı; kayıt gorunum.karakterler. Değişiklik
// 'ayarlar:degisti' ile her pencereye (çentik dahil) anında gider (renderer/karakter-gorunum.ts).
const KARAKTER_SECENEKLERI: [KarakterGorunumu, string, string][] = [['goster', 'Göster', 'parilti'], ['sade', 'Sade (göz yok)', 'hedef']];
function KarakterGrubu() {
  const { a, kaydet } = useAyarlar();
  const secili: KarakterGorunumu = karakterGorunurMu(a) ? 'goster' : 'sade';
  return (
    <Satir id="karakterler" ust>
      <div className="sekmeler" role="radiogroup" aria-label="Gözler">
        {KARAKTER_SECENEKLERI.map(([k, ad, ikon]) => (
          <button key={k} type="button" role="radio" aria-checked={secili === k} data-karakter-secimi={k}
            onClick={() => { if (secili !== k) kaydet({ gorunum: { ...a.gorunum, karakterler: k } }); }}>
            <Ikon ad={ikon} olcu={14} />{ad}
          </button>
        ))}
      </div>
    </Satir>
  );
}

function TanitimGrubu() {
  const { kaydet, sihirbaziAc } = useAyarlar();
  return (
    <>
      <Satir id="tanitim">
        <button type="button" className="dgm dgm--koyu dgm--k" onClick={() => kaydet({ tanitimSurumu: '' })}><Ikon ad="oynat" olcu={13} />Tanıtımı yeniden izle</button>
      </Satir>
      {sihirbaziAc && (
        <Satir id="sihirbaz">
          <button type="button" className="dgm dgm--koyu dgm--k" onClick={sihirbaziAc} data-kurulumu-ac=""><Ikon ad="ayarlar" olcu={13} />Kurulumu yeniden aç</button>
        </Satir>
      )}
    </>
  );
}

/** 0.14 T19: çentik ve hareket — "Tam ekranda çentiği gizle" (gorunum.tamEkrandaGizle, varsayılan açık) ve "Az hareket" (gorunum.azHareket, R16, varsayılan
 *  kapalı; Windows'un animasyon tercihi ayrıca izlenir). */
function HareketGrubu() {
  const { a, kaydet } = useAyarlar();
  const g = a.gorunum;
  return (
    <>
      <Satir id="tam-ekranda-gizle">
        <Anahtar acik={g?.tamEkrandaGizle !== false} etiket="Tam ekranda çentiği gizle" degistir={(v) => kaydet({ gorunum: { ...g, tamEkrandaGizle: v } })} />
      </Satir>
      <Satir id="az-hareket">
        <Anahtar acik={Boolean(g?.azHareket)} etiket="Az hareket" degistir={(v) => kaydet({ gorunum: { ...g, azHareket: v } })} />
      </Satir>
    </>
  );
}

/** 0.14 T22: "Sistem uyarıları" — çentikteki kısa haplar; satır kimliği `uyari-<anahtar>` (ayarlar/dizin.ts). */
const UYARI_ETIKETLERI: [UyariAnahtari, string][] = [
  ['kulaklik', 'Kulaklık ve hoparlör'], ['sarj', 'Şarj'], ['ses', 'Ses düzeyi'], ['parlaklik', 'Parlaklık'], ['caps', 'Büyük harf kilidi'], ['dil', 'Klavye dili'], ['ag', 'İnternet bağlantısı'],
];
function SistemUyarilariGrubu() {
  const { a, kaydet } = useAyarlar();
  const g = a.gorunum;
  const acik = uyariAnahtarlari(g);
  return (
    <>
      {UYARI_ETIKETLERI.map(([k, etiket]) => (
        <Satir key={k} id={`uyari-${k}`}>
          <Anahtar acik={acik[k]} etiket={etiket} degistir={(v) => kaydet({ gorunum: { ...g, uyarilar: { ...g?.uyarilar, [k]: v } } })} />
        </Satir>
      ))}
    </>
  );
}

/** 0.14 T23: "Çentik sayfaları" — açık paneldeki dokuz sayfanın sırası (yukarı / aşağı) ve aç/kapa (gorunum.centikSayfalari; doğrulama
 *  shared/centik-sayfalar.ts sayfaAyariDogrula). Asistan kapatılamaz (anahtarı yok), sırası değişebilir. Kayıt anında her pencereye gider ('ayarlar:degisti'). */
function CentikSayfalariGrubu() {
  const { a, kaydet } = useAyarlar();
  const g = a.gorunum;
  const d = sayfaAyariDogrula(g?.centikSayfalari);
  const yaz = (sira: SayfaKimligi[], kapali: SayfaKimligi[]) => kaydet({ gorunum: { ...g, centikSayfalari: sayfaAyariDogrula({ sira, kapali }) } });
  const tasi = (i: number, y: -1 | 1) => {
    const sira = [...d.sira];
    const j = i + y;
    if (j < 0 || j >= sira.length) return;
    [sira[i], sira[j]] = [sira[j], sira[i]];
    yaz(sira, d.kapali);
  };
  return (
    <Satir id="centik-sayfalari" ust>
      <ol className="centik-sayfalari" aria-label="Çentik sayfaları">
        {d.sira.map((s, i) => {
          const p = PANEL_SAYFALARI[s];
          return (
            <li key={s} className="centik-sayfalari__satir" data-centik-sayfa={s}>
              <Ikon ad={p.simge} olcu={14} />
              <span className="centik-sayfalari__ad">{p.ad}{s === 'asistan' && <small>her zaman açık</small>}</span>
              <span className="centik-sayfalari__sira">
                <button type="button" className="dgm dgm--hayalet dgm--k dgm--simge" aria-label={`${p.ad}: yukarı taşı`} title="Yukarı taşı" disabled={i === 0} onClick={() => tasi(i, -1)}><Ikon ad="asagi" olcu={13} className="centik-sayfalari__yukari" /></button>
                <button type="button" className="dgm dgm--hayalet dgm--k dgm--simge" aria-label={`${p.ad}: aşağı taşı`} title="Aşağı taşı" disabled={i === d.sira.length - 1} onClick={() => tasi(i, 1)}><Ikon ad="asagi" olcu={13} /></button>
              </span>
              {s !== 'asistan' && <Anahtar acik={!d.kapali.includes(s)} etiket={p.ad} degistir={(v) => yaz(d.sira, v ? d.kapali.filter((x) => x !== s) : [...d.kapali, s])} />}
            </li>
          );
        })}
      </ol>
    </Satir>
  );
}

export const GORUNUM: IcerikHaritasi = { tema: TemaGrubu, karakterler: KarakterGrubu, hareket: HareketGrubu, 'centik-sayfalari': CentikSayfalariGrubu, uyarilar: SistemUyarilariGrubu, tanitim: TanitimGrubu };
