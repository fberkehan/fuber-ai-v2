// Ayarlar → Veri: kayıtların yeri (tek SQLite dosyası; sırlar DPAPI ile ayrı dosyada), veri klasörünü açma ve 0.11 G2 (spec §2) veri yaşam
// döngüsü — "Eski yedekleri sil", "Verilerimi sil ve çıkış yap", "Fuber'i bu bilgisayardan kaldır". Üçü de SAYFA İÇİ onayla: satırın
// yerinde onay kutusu açılır (silinenlerin listesi; "Bunun geri alınamayacağını biliyorum" işaretlenmeden düğme kapalı; odak "Vazgeç"te).
//  · Sil: seçenek "İndirilen yapay zekâ da silinsin (≈N GB)" (varsayılan kapalı; yalnız indirilmiş bir şey varsa). Onayda hesap çıkışı,
//    uygulama yeniden açılır ve dosyalar açılmadan silinir (main/veri/temizlik.ts); ilk kurulum açılır.
//  · Kaldır: her şey (indirilen yapay zekâ dahil); onayda hesap çıkışı, kaldırıcı ayrık başlar, uygulama kapanır. Geliştirme kopyasında
//    (paketsiz) düğme kapalı ve nedenini söyler.
//  · Eski yedekler: yalnız yedekler/ (yedek yoksa düğme yok).
// Düzeltme turu 1: boyutlar yalnız bu sayfada istenir (`veri:ozet { boyut: true }`; eşzamansız, sınırlı — K2); onay kutusunda Escape
// kapatır, odak açan düğmeye döner, ilk odak güvenli eylemde ("Vazgeç") (K5).
// 0.11 G8 (G2 incelemesi Kü-1): iki ayrı çağrı — önce SAYILAR (hızlı), sonra BOYUTLAR. Sayı gelene dek "Eski yedekler" satırı nötr yükleniyor
// hâlinde (G3 Iskelet; "Yedek yok." DENMEZ); "Verilerimi sil" onay kutusu hiçbir şeyi beklemez (silinenler listesi sabit; "indirilen yapay
// zekâ da" seçeneği boyut gelene dek Iskelet); sınıra takılan boyut "en az ≈N GB". Mantığı shared/veri-islemi.ts (testli).
// Metinler shared/veri-islemi.ts (İş dili: "anahtar", "model" yok). 0.12 H3b düzeltme turu 2 (Y2): Gizli'de çıkış sunucuya bildirilmez —
// listenin hesap satırı "bağlantı kapatılır" demez (silListesi / kaldirListesi(gizli)).
import { useEffect, useRef, useState } from 'react';
import { cagir } from '../api';
import { Ikon } from '../bilesenler/Ikon';
import { Iskelet } from '../ui';
import type { IcerikHaritasi } from './baglam';
import { Satir } from './Ortak';
import { useGizliMod } from '../bilesenler/gizli-mod';
import {
  BELGELER_KALIR, ONAY_KUTUSU, YEDEK_DENETLENEMEDI, kaldirDurumu, kaldirListesi, silListesi, yedekSatiri, yedekSilListesi, yerelSecenegiDurumu,
  type VeriDurumu, type VeriIslemYaniti,
} from '../../shared/veri-islemi';

/** `veri:ozet` iki ayrı çağrıda (sayfa açılınca ve işlemden sonra): önce SAYILAR (hızlı; yedek sayısı, `kaldirilabilir`), sonra BOYUTLAR
 *  (`{ boyut: true }`; eşzamansız, sınırlı tarama). Hiçbiri sonsuz yükleniyor bırakmaz: sayı çağrısı düşerse `hata` (satırlar nedenini söyler),
 *  boyut çağrısı düşerse `boyutHata` (boyut yerine "boyutu bilinmiyor"; sayılar çalışır). */
function useVeriDurumu(): { d: VeriDurumu | null; hata: boolean; boyutHata: boolean; yenile: () => void } {
  const [d, setD] = useState<VeriDurumu | null>(null);
  const [hata, setHata] = useState(false);
  const [boyutHata, setBoyutHata] = useState(false);
  const nesil = useRef(0);
  const yenile = () => {
    const bu = ++nesil.current;
    setD(null); setHata(false); setBoyutHata(false);
    void (async () => {
      let sayilar: VeriDurumu;
      try { sayilar = await cagir<VeriDurumu>('veri:ozet'); } catch { if (bu === nesil.current) setHata(true); return; }
      if (bu !== nesil.current) return;
      setD(sayilar);
      try { const tam = await cagir<VeriDurumu>('veri:ozet', { boyut: true }); if (bu === nesil.current) setD(tam); } catch { if (bu === nesil.current) setBoyutHata(true); }
    })();
  };
  useEffect(yenile, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { d, hata, boyutHata, yenile };
}

function VeriGrubu() {
  const { d, hata, boyutHata, yenile } = useVeriDurumu();
  const [onay, setOnay] = useState(false);
  const yedek = yedekSatiri(d, boyutHata);
  return (
    <>
      <Satir id="veri-klasoru">
        <button type="button" className="dgm dgm--koyu dgm--k" onClick={() => void cagir('sistem:veri-klasoru')}><Ikon ad="klasor" olcu={14} />Veri klasörünü aç</button>
      </Satir>
      {hata ? <Satir id="eski-yedekler" aciklama={YEDEK_DENETLENEMEDI} />
        : yedek.yukleniyor ? (
          // Sayı gelene dek nötr yükleniyor (G3 Iskelet); satır `Satir`'ın kendisi — başlık ve yerleşim değişmez, kart zıplamaz.
          <Satir id="eski-yedekler" dikey aciklama=""><div data-yukleniyor="" aria-busy="true"><Iskelet satir={1} alt /></div></Satir>
        ) : (
          <Satir id="eski-yedekler" aciklama={yedek.aciklama}>
            {yedek.dugme && !onay && (
              <button type="button" className="dgm dgm--koyu dgm--k" onClick={() => setOnay(true)} data-yedek-sil=""><Ikon ad="cop" olcu={14} />Eski yedekleri sil</button>
            )}
          </Satir>
        )}
      {onay && d && (
        <OnayKutusu
          tur="yedek" baslik="Eski yedekler silinsin mi?" liste={yedekSilListesi(d)} eylem="Yedekleri sil"
          vazgec={() => setOnay(false)} geriOdak="[data-yedek-sil]"
          onayla={async () => {
            const hata = await cagir<number>('veri:yedekleri-sil').then(() => null, () => ({ tamam: false as const, hata: 'Olmadı; bir daha dene.' }));
            if (hata) return hata;
            setOnay(false); yenile(); return null;
          }}
        />
      )}
    </>
  );
}

function SilKaldirGrubu() {
  const { d, hata, boyutHata } = useVeriDurumu();
  const [acik, setAcik] = useState<'sil' | 'kaldir' | null>(null);
  const [yerelDahil, setYerelDahil] = useState(false);
  const gizli = useGizliMod();
  // `kaldirilabilir` hızlı ilk çağrıda gelir; gelene dek düğme kapalı ama nedeni söylenmez (geliştirme kopyası yazısı yanlış çıkmasın);
  // sayı çağrısı düştüyse kapalı ve nedeni söylenir (K6).
  const kaldir = kaldirDurumu(d, hata);
  const yerelSecenek = yerelSecenegiDurumu(d, boyutHata || hata); // sayı çağrısı düştüyse boyut çağrısı hiç yapılmaz: yine sonsuz Iskelet yok
  return (
    <>
      <Satir id="verileri-sil">
        {acik !== 'sil' && <button type="button" className="dgm dgm--tehlike dgm--k" onClick={() => { setYerelDahil(false); setAcik('sil'); }} data-verileri-sil=""><Ikon ad="cop" olcu={14} />Verilerimi sil</button>}
      </Satir>
      {acik === 'sil' && (
        <OnayKutusu
          tur="sil" baslik="Verilerin silinsin mi?" liste={silListesi(gizli)} eylem="Sil ve yeniden başlat" vazgec={() => setAcik(null)} geriOdak="[data-verileri-sil]"
          secenek={yerelSecenek.durum === 'var' ? { etiket: yerelSecenek.etiket, deger: yerelDahil, sec: setYerelDahil } : undefined}
          secenekYukleniyor={yerelSecenek.durum === 'bekliyor'}
          onayla={async () => {
            const r = await cagir<VeriIslemYaniti>('veri:sil', { yerelDahil }).catch((): VeriIslemYaniti => ({ tamam: false, hata: 'Olmadı; bir daha dene.' }));
            return r.tamam ? 'Fuber yeniden açılıyor…' : r;
          }}
        />
      )}
      <Satir id="fuberi-kaldir" aciklama={kaldir.neden}>
        {acik !== 'kaldir' && (
          <button type="button" className="dgm dgm--tehlike dgm--k" disabled={kaldir.kapali} title={kaldir.neden}
            onClick={() => setAcik('kaldir')} data-fuberi-kaldir=""><Ikon ad="cop" olcu={14} />Kaldır</button>
        )}
      </Satir>
      {acik === 'kaldir' && (
        <OnayKutusu
          tur="kaldir" baslik="Fuber bu bilgisayardan kaldırılsın mı?" liste={kaldirListesi(gizli)} eylem="Fuber’i kaldır" vazgec={() => setAcik(null)} geriOdak="[data-fuberi-kaldir]"
          onayla={async () => {
            const r = await cagir<VeriIslemYaniti>('veri:kaldir').catch((): VeriIslemYaniti => ({ tamam: false, hata: 'Olmadı; bir daha dene.' }));
            return r.tamam ? 'Fuber kaldırılıyor…' : r;
          }}
        />
      )}
    </>
  );
}

/**
 * Sayfa içi onay: başlık, silinenler, (varsa) seçenek, "Bunun geri alınamayacağını biliyorum" ve iki düğme. Odak açılınca "Vazgeç"te
 * (güvenli eylem; yanlışlıkla Enter silmesin). Escape ya da "Vazgeç" kutuyu kapatır ve odak açan düğmeye (`geriOdak`) döner (K5).
 * `onayla`: null → kutu kapanır (çağıran yönetir); metin → işlem sürüyor ("…açılıyor"); { hata } → hata satırı.
 */
function OnayKutusu({ tur, baslik, liste, eylem, secenek, secenekYukleniyor, vazgec: kapat, geriOdak, onayla }: {
  tur: 'sil' | 'kaldir' | 'yedek'; baslik: string; liste: readonly string[]; eylem: string;
  secenek?: { etiket: string; deger: boolean; sec: (v: boolean) => void };
  /** Seçeneğin boyutu henüz taranıyor (G8, Kü-1): yerinde nötr yükleniyor hâli; onay kutusu beklemez. */
  secenekYukleniyor?: boolean;
  vazgec: () => void;
  /** Kapanınca odaklanacak açan düğme (seçici; yeniden çizilir). */
  geriOdak: string;
  onayla: () => Promise<string | null | { tamam: false; hata: string }>;
}) {
  const [biliyorum, setBiliyorum] = useState(false);
  const [durum, setDurum] = useState<{ suruyor?: string; hata?: string }>({});
  const vazgecDugmesi = useRef<HTMLButtonElement>(null);
  useEffect(() => { vazgecDugmesi.current?.focus(); }, []);
  const mesgul = Boolean(durum.suruyor);
  const vazgec = () => {
    if (mesgul) return;
    kapat();
    requestAnimationFrame(() => document.querySelector<HTMLElement>(geriOdak)?.focus());
  };
  const yap = async () => {
    if (!biliyorum || mesgul) return;
    setDurum({ suruyor: '…' });
    const r = await onayla();
    if (r === null) return;
    setDurum(typeof r === 'string' ? { suruyor: r } : { hata: r.hata });
  };
  return (
    <div className="veri-onay ic-kutu" role="group" aria-label={baslik} data-veri-onay={tur}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); vazgec(); } }}>
      <b className="veri-onay__baslik">{baslik}</b>
      <ul className="veri-onay__liste">{liste.map((x) => <li key={x}>{x}</li>)}</ul>
      {tur !== 'yedek' && <p className="veri-onay__not">{BELGELER_KALIR}</p>}
      {secenekYukleniyor && <div className="veri-onay__yukleniyor" data-secenek-yukleniyor=""><Iskelet satir={1} /></div>}
      {secenek && (
        <button type="button" role="checkbox" aria-checked={secenek.deger} className="veri-onay__kutu" disabled={mesgul} onClick={() => secenek.sec(!secenek.deger)} data-yerel-dahil="">
          <span className="veri-onay__isaret" aria-hidden="true">{secenek.deger && <Ikon ad="tamam" olcu={12} />}</span>{secenek.etiket}
        </button>
      )}
      <button type="button" role="checkbox" aria-checked={biliyorum} className="veri-onay__kutu" disabled={mesgul} onClick={() => setBiliyorum(!biliyorum)} data-biliyorum="">
        <span className="veri-onay__isaret" aria-hidden="true">{biliyorum && <Ikon ad="tamam" olcu={12} />}</span>{ONAY_KUTUSU}
      </button>
      {durum.hata && <p className="veri-onay__hata" role="status">{durum.hata}</p>}
      <div className="veri-onay__dugmeler">
        <button ref={vazgecDugmesi} type="button" className="dgm dgm--hayalet dgm--k" disabled={mesgul} onClick={vazgec} data-vazgec="">Vazgeç</button>
        <button type="button" className="dgm dgm--tehlike dgm--k" disabled={!biliyorum || mesgul} onClick={() => void yap()} data-onayla="">
          {mesgul ? (durum.suruyor === '…' ? <span className="donen" aria-label="Bekleniyor" /> : durum.suruyor) : <><Ikon ad="cop" olcu={14} />{eylem}</>}
        </button>
      </div>
    </div>
  );
}

export const VERI: IcerikHaritasi = { 'yerel-veri': VeriGrubu, 'sil-kaldir': SilKaldirGrubu };
