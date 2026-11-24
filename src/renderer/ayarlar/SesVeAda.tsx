// Ayarlar → Ses ve ada: mikrofonu tamamen kapatma, "Hey Fuber" + asistan kısayolu, sesli yanıt (Fuber'in tek sesi, yedek ses, hız:
// SesSecimi.tsx; Görev 21) ve ekranın üstündeki ada. Mikrofon ve ada sol raydaki hızlı denetimlerle (bilesenler/HizliDenetimler.tsx) AYNI alanları yazar
// (ses.mikrofonKapali; gorunum.ada, gorunum.adaGizliBitis, gorunum.adaSessiz) — tek doğruluk kaynağı.
// Ada: göster / 1 saat gizle / kapalı; uygulama öndeyken ada zaten görünmez (main/ada.ts). "Boştayken göster" (adaSessiz): iş yokken
// ada üstte küçük çentik olarak durur; kapalıysa yalnız bir şey olunca iner (raydaki ada menüsüyle aynı ad).
import { useEffect, useState } from 'react';
import { cagir, dinle } from '../api';
import { Anahtar } from '../bilesenler/Ortak';
import { acilDurdurmaNotu, asistanKisayolNotu, genelKisayolSorunu, type KisayolDurumu } from '../../shared/genel-kisayol';
import { kisayolElectron, kisayolOkunur } from '../../shared/kisayol';
import { UYANDIRMA_DUSTU_METNI, type UyandirmaDurumu } from '../../shared/uyandirma-ayar';
import { useAyarlar, type IcerikHaritasi } from './baglam';
import { KaydetliGirdi, SAAT_MS, Satir, saatMetni, useSureBitince } from './Ortak';
import { SesSecimi } from './SesSecimi';

/** Genel kısayolların gerçek durumu (ana süreç alabildi mi); bilinene dek null. */
function useKisayolDurumu(): KisayolDurumu | null {
  const [d, setD] = useState<KisayolDurumu | null>(null);
  useEffect(() => {
    void cagir<KisayolDurumu>('kisayol:durum').then(setD).catch(() => undefined);
    return dinle('kisayol:degisti', (y: KisayolDurumu) => setD(y));
  }, []);
  return d;
}

/** Uyandırma motorunun gerçek durumu (ana süreç; değişince 'kulak:durum'). Düşmüşse satır tek cümleyle söyler. */
function useUyandirmaDurumu(): UyandirmaDurumu {
  const [d, setD] = useState<UyandirmaDurumu>('calisiyor');
  useEffect(() => {
    void cagir<UyandirmaDurumu>('kulak:uyandirma-durum').then(setD).catch(() => undefined);
    return dinle('kulak:durum', (y: { uyandirma?: UyandirmaDurumu }) => { if (y.uyandirma) setD(y.uyandirma); });
  }, []);
  return d;
}

function UyandirmaGrubu() {
  const { a, kaydet } = useAyarlar();
  const kapali = Boolean(a.ses.mikrofonKapali);
  // Görev 20b: genel kısayol yasak kümedeyse (Ctrl+Alt = AltGr karakter yazar; sistem/yaygın uygulama kısayolu) kaydedilmez, nedeni yazılır.
  const [sorun, setSorun] = useState<string | null>(null);
  const kisayolKaydet = (v: string) => { const s = genelKisayolSorunu(v, window.fuber?.platform); setSorun(s); if (!s) kaydet({ ses: { ...a.ses, kisayol: v } }); };
  // Acil durdurma (düzeltme turu 2): tuş yalnız gerçekten alındıysa yazılır; başka bir uygulama kullanıyorsa "alınamadı" denir.
  const d = useKisayolDurumu();
  const mac = window.fuber?.platform === 'darwin';
  const acil = acilDurdurmaNotu(d ? d.acil.alindi : null, d ? kisayolOkunur(d.acil.tus, mac) : '');
  // A12: kayıtlı asistan kısayolu alınamadıysa (açılışta yasak kümede bulundu ya da başka uygulamada) nedeni + "değiştir". Kullanıcı
  // şimdi yazdığı kısayolun sorununu görüyorsa (aşağıda) ikisi yinelenmez.
  const asistanNotu = d && d.asistan.tus === a.ses.kisayol && !sorun ? asistanKisayolNotu(d.asistan, kisayolOkunur(d.asistan.tus, mac)) : null;
  const uyandirmaDustu = useUyandirmaDurumu() !== 'calisiyor' && a.ses.uyandirma && !kapali;
  return (
    <>
      <Satir id="mikrofon-kapali"><Anahtar acik={kapali} etiket="Mikrofonu tamamen kapat" degistir={(v) => kaydet({ ses: { ...a.ses, mikrofonKapali: v } })} /></Satir>
      <Satir id="hey-fuber" ek={uyandirmaDustu ? <em className="ayar__sorun" role="alert" data-uyandirma="dustu">{UYANDIRMA_DUSTU_METNI}</em> : kapali ? ' Mikrofon kapalıyken çalışmaz.' : ''}><Anahtar acik={a.ses.uyandirma} etiket="“Hey Fuber”" degistir={(v) => kaydet({ ses: { ...a.ses, uyandirma: v } })} /></Satir>
      <Satir id="kisayol" ek={<>
        {asistanNotu && <em className="ayar__sorun" role="alert" data-asistan-kisayol="alinamadi">{asistanNotu}</em>}
        {acil && (acil.sorun ? <em className="ayar__sorun" role="alert" data-acil-kisayol="alinamadi">{acil.metin}</em> : <span data-acil-kisayol="alindi">{acil.metin}</span>)}
        {sorun && <em className="ayar__sorun" role="alert"> {sorun}</em>}
      </>}>
        {/* 0.10 Görev 3 (D-6): alan Electron yazımını değil okunur gösterimi yazar ("Ctrl+Shift+Boşluk"); kayıt Electron biçiminde. */}
        <KaydetliGirdi deger={kisayolOkunur(a.ses.kisayol, mac)} genislik={260} etiket="Asistan kısayolu" kaydet={(v) => kisayolKaydet(kisayolElectron(v))} />
      </Satir>
    </>
  );
}

function YanitGrubu() {
  const { a, kaydet } = useAyarlar();
  return (
    <>
      <Satir id="seslendirme"><Anahtar acik={a.ses.seslendirme} etiket="Sesli yanıt" degistir={(v) => kaydet({ ses: { ...a.ses, seslendirme: v } })} /></Satir>
      {/* 0.11 G11: açılış çanı (yeni profilde açık; sessiz saatte ve rahatsız etmede çalmaz). */}
      <Satir id="acilis-sesi"><Anahtar acik={a.ses.acilisSesi !== false} etiket="Açılış sesi" degistir={(v) => kaydet({ ses: { ...a.ses, acilisSesi: v } })} /></Satir>
      <SesSecimi />
    </>
  );
}

type AdaSecimi = 'goster' | 'gizli' | 'kapali';
const ADA_SECENEKLERI: [AdaSecimi, string][] = [['goster', 'Göster'], ['gizli', '1 saat gizle'], ['kapali', 'Kapalı']];

function AdaGrubu() {
  const { a, kaydet } = useAyarlar();
  const g = a.gorunum;
  const bitis = g?.adaGizliBitis;
  const gizli = useSureBitince(bitis); // "1 saat gizle" bitince seçim kendiliğinden "Göster"e döner
  const secim: AdaSecimi = g?.ada === 'kapali' ? 'kapali' : gizli ? 'gizli' : 'goster';
  const sec = (s: AdaSecimi) => kaydet({ gorunum: { ...g, ada: s === 'kapali' ? 'kapali' : 'goster', adaGizliBitis: s === 'gizli' ? new Date(Date.now() + SAAT_MS).toISOString() : undefined } });
  return (
    <>
      <Satir id="ada-gorunurluk" ust ek={secim === 'gizli' && bitis ? ` Şu an ${saatMetni(bitis)}’e kadar gizli.` : ''}>
        <div className="sekmeler" role="radiogroup" aria-label="Ada">
          {ADA_SECENEKLERI.map(([s, ad]) => (
            <button key={s} type="button" role="radio" aria-checked={secim === s} onClick={() => { if (secim !== s) sec(s); }}>{ad}</button>
          ))}
        </div>
      </Satir>
      <Satir id="ada-sessiz">
        <Anahtar acik={g?.adaSessiz !== false} etiket="Boştayken göster" degistir={(v) => kaydet({ gorunum: { ...g, adaSessiz: v } })} />
      </Satir>
    </>
  );
}

export const SES: IcerikHaritasi = { uyandirma: UyandirmaGrubu, yanit: YanitGrubu, ada: AdaGrubu };
