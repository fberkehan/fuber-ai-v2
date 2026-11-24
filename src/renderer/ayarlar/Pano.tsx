// Ayarlar → Pano (Görev 24, K14): kokpit doldurucularının şehri ve kaynakları. Metinler dizin.ts'te (tek kaynak).
// Şehir listesi çevrimdışıdır (shared/pano.ts SEHIRLER: 81 il + yurt dışı); "Otomatik" saat diliminden bulunan şehri adıyla söyler
// (ana sürecin bulduğu: 'pano:al'). Kapalı kaynağa ana süreç hiç istek göndermez. "Şimdi yenile" açık kaynakları tazeler.
import { useMemo, useState } from 'react';
import { cagir } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { Anahtar } from '../bilesenler/Ortak';
import { Secici, type SeciciSecenegi } from '../bilesenler/Secici';
import { SEHIRLER, PANO_VARSAYILAN, yasMetni, type PanoAyari, type PanoDurumu, type PanoKaynak } from '../../shared/pano';
import { usePano } from '../pano/usePano';
import { useAyarlar, type IcerikHaritasi } from './baglam';
import { Satir } from './Ortak';

const ULKE: Record<string, string> = {
  TR: 'Türkiye', DE: 'Almanya', AT: 'Avusturya', CH: 'İsviçre', NL: 'Hollanda', BE: 'Belçika', FR: 'Fransa', GB: 'Birleşik Krallık', IE: 'İrlanda',
  ES: 'İspanya', IT: 'İtalya', GR: 'Yunanistan', BG: 'Bulgaristan', RO: 'Romanya', PL: 'Polonya', CZ: 'Çekya', HU: 'Macaristan', SE: 'İsveç',
  DK: 'Danimarka', NO: 'Norveç', FI: 'Finlandiya', PT: 'Portekiz', UA: 'Ukrayna', RU: 'Rusya', CY: 'Kıbrıs', AZ: 'Azerbaycan', GE: 'Gürcistan',
  UZ: 'Özbekistan', KZ: 'Kazakistan', KG: 'Kırgızistan', TM: 'Türkmenistan', MK: 'Kuzey Makedonya', BA: 'Bosna-Hersek', RS: 'Sırbistan', AL: 'Arnavutluk',
  AE: 'BAE', QA: 'Katar', SA: 'Suudi Arabistan', EG: 'Mısır', IR: 'İran', IQ: 'Irak', LB: 'Lübnan', JO: 'Ürdün', US: 'ABD', CA: 'Kanada', MX: 'Meksika',
  BR: 'Brezilya', AR: 'Arjantin', JP: 'Japonya', KR: 'Güney Kore', CN: 'Çin', HK: 'Hong Kong', SG: 'Singapur', MY: 'Malezya', ID: 'Endonezya',
  TH: 'Tayland', IN: 'Hindistan', PK: 'Pakistan', AU: 'Avustralya', NZ: 'Yeni Zelanda', ZA: 'Güney Afrika', NG: 'Nijerya', KE: 'Kenya', MA: 'Fas', TN: 'Tunus',
};

function usePanoAyari(): [PanoAyari, (d: Partial<PanoAyari>) => void] {
  const { a, kaydet } = useAyarlar();
  const p = { ...PANO_VARSAYILAN, ...(a.pano ?? {}) };
  return [p, (d) => kaydet({ pano: { ...p, ...d } })];
}

function KonumGrubu() {
  const [p, degistir] = usePanoAyari();
  const { pano } = usePano();
  // Otomatikte bulunan şehir açıklamanın sonunda adıyla söylenir (tetikte yalnız "Otomatik": dar sütunda kesilmesin). Saat dilimi
  // listede yoksa en yakın saat farklı şehir TAHMİN edilir ve öyle yazılır.
  const otomatik = !p.sehir && pano && pano.konum.kaynak !== 'ayar' ? pano.konum : null;
  const secenekler = useMemo<SeciciSecenegi[]>(() => [
    { deger: '', etiket: 'Otomatik', aciklama: 'Bilgisayarın saat diliminden' },
    ...[...SEHIRLER].sort((x, y) => Number(y.ulke === 'TR') - Number(x.ulke === 'TR') || x.ad.localeCompare(y.ad, 'tr')).map((s) => ({ deger: s.id, etiket: s.ad, aciklama: ULKE[s.ulke] ?? s.ulke })),
  ], []);
  const ek = otomatik
    ? <span className="pano-ayar__durum"> {otomatik.kaynak === 'tahmin' ? `Saat dilimin listede yok; en yakın şehir tahmin edildi: ${otomatik.sehir}. Şehrini buradan seçebilirsin.` : `Şu an: ${otomatik.sehir}.`}</span>
    : null;
  return (
    <Satir id="pano-sehir" ek={ek}>
      <Secici etiket="Şehir" deger={p.sehir || ''} secenekler={secenekler} degistir={(v) => degistir({ sehir: v })} ara genislik={230} />
    </Satir>
  );
}

function KartlarGrubu() {
  const [p, degistir] = usePanoAyari();
  return (
    <>
      <Satir id="pano-hava"><Anahtar acik={p.hava} etiket="Hava durumu" degistir={(v) => degistir({ hava: v })} /></Satir>
      <Satir id="pano-haberler"><Anahtar acik={p.haberler} etiket="Haberler" degistir={(v) => degistir({ haberler: v })} /></Satir>
      <Satir id="pano-gundem"><Anahtar acik={p.gundem} etiket="Gündemdeki konular" degistir={(v) => degistir({ gundem: v })} /></Satir>
      <Satir id="pano-piyasa"><Anahtar acik={p.piyasa} etiket="Döviz" degistir={(v) => degistir({ piyasa: v })} /></Satir>
    </>
  );
}

function durumMetni(ad: string, k: PanoKaynak<unknown> | undefined): string {
  if (!k) return `${ad}: …`;
  switch (k.durum) {
    case 'kapali': return `${ad}: kapalı`;
    case 'yukleniyor': return `${ad}: alınıyor…`;
    case 'yok': return `${ad}: bağlantı yok`;
    default: return `${ad}: ${k.cevrimdisi ? 'çevrimdışı, ' : ''}${yasMetni(k.zaman)}`;
  }
}

function GuncellemeGrubu() {
  // Yenileme bitince ana süreç 'pano:degisti' yayınlar; usePano yeni durumu kendisi alır.
  const { pano: d } = usePano();
  const [suruyor, setSuruyor] = useState(false);
  const yenile = () => {
    setSuruyor(true);
    void cagir<PanoDurumu>('pano:yenile').catch(() => undefined).finally(() => setSuruyor(false));
  };
  const ozet = d ? [durumMetni('Hava', d.hava), durumMetni('Haberler', d.haberler), durumMetni('Döviz', d.piyasa)].join(' · ') : '';
  return (
    <Satir id="pano-yenile" ek={ozet ? <span className="pano-ayar__durum"> {ozet}.</span> : null}>
      <button type="button" className="dgm dgm--koyu dgm--k" disabled={suruyor} onClick={yenile}>
        {suruyor ? <span className="donen" aria-hidden="true" /> : <Ikon ad="yenile" olcu={13} />}{suruyor ? 'Yenileniyor…' : 'Şimdi yenile'}
      </button>
    </Satir>
  );
}

export const PANO: IcerikHaritasi = { konum: KonumGrubu, kartlar: KartlarGrubu, guncelleme: GuncellemeGrubu };
