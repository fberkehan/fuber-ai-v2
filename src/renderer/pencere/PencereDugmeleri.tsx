// ── Kendi pencere düğmelerimiz (Görev 22, K12) ─────────────────────────────────────────────────────────────────────
// Pencere düğmeleri saydam kalıyor ve Windows'un katmanının arkasında kalıyordu; uygulama kendi düğmelerini çizer.
// Windows'un saydam başlık şeridi kaplaması kalktı (main/pencere-kabugu.ts); küçült / büyüt-geri al / kapat burada çizilir:
//  - 'kose' (ana pencere, kurulum sihirbazı): panonun sağ üst köşesine oyulmuş ÇENTİK — logolu orta çentikle aynı dil (aynı omuz
//    eğrisi; işaret orta çentikteki logo gibi çentiğin gövdesinde ortalı). Düğmeler çentiğin içinde, tıklama alanları pencerenin
//    üst ve sağ kenarına kadar uzanır (büyütülmüşken imleci köşeye atmak "Kapat"ı bulur).
//  - 'satir' (Fuber Tarayıcı): araç çubuğunun sağında, aynı düğmeler.
// Düğme: 40 px genişlik × şerit yüksekliği tıklama alanı, içinde 26 px daire; üzerine gelince ince dolgu, Kapat'ta kırmızı (Windows 11 gibi ama bizim
// biçimimizde), basılıyken bir ton koyu; klavyeyle odakta daire halkası. Pencere odakta değilken simgeler bir ton söner (Windows ve
// macOS da böyle). Sürükleme ve çift tıkla büyüt Windows'un kendisidir (çentik ve şerit sürükleme bölgesidir). macOS'ta (yerel trafik
// ışıkları) ve telefonda hiçbir şey çizilmez.
import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { cagir, dinle } from '../api';
import { dugmeAdi, ozelDugmeler, type PencereDurumu, type PencereEylemi } from '../../shared/pencere';
import './pencere.css';

const platform = (): string => window.fuber?.platform ?? '';

// Pencere durumu tek yerden (düğme ve <html> işaretleri aynı kaynaktan); ilk değer ana süreçten, sonra 'pencere:durum' olayı.
// Odak PENCERENİN odağıdır (ana süreç BrowserWindow focus/blur'u bildirir): belgenin focus/blur'u değil — Fuber Tarayıcı'da web
// sayfası ayrı bir görünümdür, sayfaya tıklanınca araç çubuğunun belgesi "blur" alır ama pencere öndedir.
let durum: PencereDurumu = { buyuk: false, tamEkran: false, odak: true };
const dinleyiciler = new Set<(d: PencereDurumu) => void>();
let kuruldu = false;

function durumYaz(d: PencereDurumu): void {
  durum = { buyuk: Boolean(d?.buyuk), tamEkran: Boolean(d?.tamEkran), odak: d?.odak !== false };
  const kok = document.documentElement;
  if (durum.buyuk) kok.dataset.pencereBuyuk = ''; else delete kok.dataset.pencereBuyuk;
  if (durum.tamEkran) kok.dataset.pencereTam = ''; else delete kok.dataset.pencereTam;
  kok.dataset.pencereOdak = durum.odak ? '1' : '0';
  for (const f of dinleyiciler) f(durum);
}

/**
 * <html> işaretleri: data-pencere="ozel" (düğmeleri biz çiziyoruz) | "mac" (yerel trafik ışıkları); data-pencere-odak (PENCERE
 * odakta mı; ilk yanıta dek "1": açılışta sönük bir kare görünmesin), data-pencere-buyuk, data-pencere-tam. Her pencere bir kez
 * çağırır (birden çok çağrı zararsız).
 */
export function pencereIsaretleriniKur(): void {
  if (kuruldu) return;
  kuruldu = true;
  const kok = document.documentElement;
  const p = platform();
  if (p === 'darwin') { kok.dataset.pencere = 'mac'; return; }
  if (!ozelDugmeler(p)) return;
  kok.dataset.pencere = 'ozel';
  kok.dataset.pencereOdak = '1';
  void cagir<PencereDurumu>('pencere:durum').then(durumYaz).catch(() => undefined);
  dinle('pencere:durum', durumYaz);
}

function usePencereDurumu(): PencereDurumu {
  const [d, setD] = useState(durum);
  useEffect(() => { dinleyiciler.add(setD); setD(durum); return () => { dinleyiciler.delete(setD); }; }, []);
  return d;
}

// 12 px simgeler (12 birimlik kutu; simge kutusu tam piksele oturur): Windows'un düğme simgeleri kadar yalın. Yatay ve dikey çizgiler
// 1 px kalınlıkta yarım piksel koordinatlarında (100 %'de keskin, bulanık iki piksel değil); çapraz Kapat 1,2 (çapraz çizgi zaten
// yumuşatılır, 1 px'te ince kalıyordu).
const SIMGE: Record<'kucult' | 'buyut' | 'geri' | 'kapat', ReactNode> = {
  kucult: <path d="M1.5 6.5h9" strokeWidth="1" />,
  buyut: <rect x="1.5" y="1.5" width="9" height="9" rx="2" strokeWidth="1" />,
  // Geri al: öndeki kare + arkadakinin görünen üst ve sağ kenarı.
  geri: <><rect x="1.5" y="3.5" width="7" height="7" rx="1.75" strokeWidth="1" /><path d="M3.5 3.5v-.25A1.75 1.75 0 0 1 5.25 1.5h3.5a1.75 1.75 0 0 1 1.75 1.75v3.5a1.75 1.75 0 0 1-1.75 1.75H8.5" strokeWidth="1" /></>,
  kapat: <path d="M2.4 2.4l7.2 7.2M9.6 2.4l-7.2 7.2" />,
};

function Dugme({ eylem, d, tepsi }: { eylem: PencereEylemi; d: PencereDurumu; tepsi: boolean }) {
  const ad = dugmeAdi(eylem, d, tepsi);
  const simge = eylem === 'buyut' ? (d.buyuk ? 'geri' : 'buyut') : eylem;
  return (
    <button
      type="button"
      className="pd-dgm"
      data-eylem={eylem}
      aria-label={ad}
      title={ad}
      // Fareyle basınca odak halkası çıkmasın ve odak sayfadaki yazı alanından kopmasın (klavyeyle Tab yine ulaşır).
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => void cagir('pencere:eylem', eylem).catch(() => undefined)}
    >
      <span className="pd-dgm__daire" aria-hidden="true">
        <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">{SIMGE[simge]}</svg>
      </span>
    </button>
  );
}

/** Üç düğme. `tepsi`: Kapat pencereyi tepsiye gizler (ana pencere) — ipucu bunu söyler. */
export function PencereDugmeleri({ yerlesim, tepsi = false }: { yerlesim: 'kose' | 'satir'; tepsi?: boolean }) {
  const d = usePencereDurumu();
  if (!ozelDugmeler(platform())) return null;
  const dugmeler = (
    <div className="pd-dugmeler" role="group" aria-label="Pencere">
      <Dugme eylem="kucult" d={d} tepsi={tepsi} />
      <Dugme eylem="buyut" d={d} tepsi={tepsi} />
      <Dugme eylem="kapat" d={d} tepsi={tepsi} />
    </div>
  );
  if (yerlesim === 'satir') return <div className="pd pd--satir">{dugmeler}</div>;
  return (
    <div className="pd pd--kose">
      {/* Köşe çentiği: 45 px omuz (orta çentiğin eğrisi, aynı oranda) + 136 px gövde; panoya 32 px iner (üstteki 8 px çerçeveyle
          40 px — sayfaların içeriği 48 px'ten başlar, hiçbiri kaymaz ya da altında kalmaz). Altında panonun 20 px'lik köşesi.
          Daireler gövdenin içinde (camda çerçeve saydamdır: daire çentikten taşmaz). */}
      <svg className="pd-centik" viewBox="0 0 181 52" width="181" height="52" aria-hidden="true">
        <path d="M0 0H181V52A20 20 0 0 0 161 32H45C32.34 32 28.13 24.8 22.5 16C16.88 7.2 12.66 0 0 0Z" />
      </svg>
      <div className="pd-surukle" aria-hidden="true" />
      {dugmeler}
    </div>
  );
}

/** Ana pencere: düğmeler sayfanın kendi kökünden ayrı bir kökte, gövdenin sonunda (sürükleme bölgeleri belge sırasıyla birleşir:
 *  çentiğin sürükleme alanı sayfanınkinden sonra, düğmelerin "sürüklenmez" alanı en sonda gelir). Kurulum sihirbazı da bu köşeyi
 *  kullanır (form levhasının sağ üst köşesi panonunkiyle aynı yerde). */
export function pencereKabugunuKur(): void {
  pencereIsaretleriniKur();
  if (!ozelDugmeler(platform())) return;
  const yer = document.createElement('div');
  yer.id = 'pencere-kabugu';
  document.body.append(yer);
  createRoot(yer).render(<PencereDugmeleri yerlesim="kose" tepsi />);
}
