// Ayarlar → Kendiliğinden yazma: proaktif Fuber (aç/kapa, merak soruları, e-posta takibi), sabah/akşam özeti saatleri ve sessiz
// saatler + 1 saat rahatsız etme (sol raydaki hızlı denetimle aynı alan). Saat girdileri odaktan çıkınca (ya da Enter'da) kaydeder;
// boş saat = kapalı (zamanlayici.ts).
import { Anahtar } from '../bilesenler/Ortak';
import { Secici } from '../bilesenler/Secici';
import { OdakGirdi } from '../bilesenler/DusunmeOrtak';
import { useAyarlar, type IcerikHaritasi } from './baglam';
import { SAAT_MS, Satir, saatMetni, useSureBitince } from './Ortak';
import { TERIM } from '../../shared/terimler';
import { neredeYerelMi } from '../../shared/nerede';
import { YEREL_MERAK_NOTU, YEREL_OZET_NOTU } from '../../shared/ic-talimat';

const MERAK = [0, 1, 2, 3].map((n) => ({ deger: n, etiket: n === 0 ? 'Hiç' : `Günde ${n} kez` }));

function ProaktifGrubu() {
  const { a, kaydet } = useAyarlar();
  const p = a.proaktif;
  return (
    <>
      <Satir id="proaktif-fuber"><Anahtar acik={p.etkin} etiket={TERIM.kendiliginden} degistir={(v) => kaydet({ proaktif: { ...p, etkin: v } })} /></Satir>
      <Satir id="merak" ek={neredeYerelMi(a.yerel) ? <span data-yerel-merak-notu=""> {YEREL_MERAK_NOTU}</span> : null}><Secici etiket="Seni tanıma soruları" genislik={170} deger={p.merakSorusuGunluk} secenekler={MERAK} degistir={(n) => kaydet({ proaktif: { ...p, merakSorusuGunluk: n } })} /></Satir>
      <Satir id="eposta-takip"><Anahtar acik={p.epostaTakip} etiket="E-posta takibi" degistir={(v) => kaydet({ proaktif: { ...p, epostaTakip: v } })} /></Satir>
    </>
  );
}

function OzetGrubu() {
  const { a, kaydet } = useAyarlar();
  const p = a.proaktif;
  // Düzeltme turu 1 (I-2): Gizli / "Yalnız bu bilgisayar" seçiliyken özetler araç istediği için çalışmaz — saat yine ayarlanabilir, not söyler.
  const yerelde = neredeYerelMi(a.yerel);
  return (
    <>
      <Satir id="sabah-ozeti" ek={yerelde ? <span data-yerel-ozet-notu=""> {YEREL_OZET_NOTU}</span> : null}><OdakGirdi tur="time" genislik={130} aria-label="Sabah özeti saati" deger={p.sabahOzeti} kaydet={(v) => kaydet({ proaktif: { ...p, sabahOzeti: v } })} /></Satir>
      <Satir id="aksam-ozeti"><OdakGirdi tur="time" genislik={130} aria-label="Akşam kapanışı saati" deger={p.aksamOzeti} kaydet={(v) => kaydet({ proaktif: { ...p, aksamOzeti: v } })} /></Satir>
    </>
  );
}

function SessizGrubu() {
  const { a, kaydet } = useAyarlar();
  const p = a.proaktif;
  // Rahatsız etme (1 saat): sol raydaki hızlı denetimle aynı alan (proaktif.rahatsizEtmeBitis). Bitince anahtar kendiliğinden kapanır.
  const rahatsiz = useSureBitince(p.rahatsizEtmeBitis);
  return (
    <>
      <Satir id="sessiz-saatler">
        <span className="saat-araligi">
          <OdakGirdi tur="time" genislik={120} aria-label="Sessiz saatler başlangıcı" deger={p.sessizBaslangic} duzelt={(v) => v || p.sessizBaslangic} kaydet={(v) => kaydet({ proaktif: { ...p, sessizBaslangic: v } })} />
          <span aria-hidden="true">–</span>
          <OdakGirdi tur="time" genislik={120} aria-label="Sessiz saatler bitişi" deger={p.sessizBitis} duzelt={(v) => v || p.sessizBitis} kaydet={(v) => kaydet({ proaktif: { ...p, sessizBitis: v } })} />
        </span>
      </Satir>
      <Satir id="rahatsiz-etme" ek={rahatsiz && p.rahatsizEtmeBitis ? ` Şu an ${saatMetni(p.rahatsizEtmeBitis)}’e kadar açık.` : ''}>
        <Anahtar acik={rahatsiz} etiket="Rahatsız etme (1 saat)" degistir={(v) => kaydet({ proaktif: { ...p, rahatsizEtmeBitis: v ? new Date(Date.now() + SAAT_MS).toISOString() : undefined } })} />
      </Satir>
    </>
  );
}

export const PROAKTIF: IcerikHaritasi = { proaktif: ProaktifGrubu, ozetler: OzetGrubu, sessiz: SessizGrubu };
