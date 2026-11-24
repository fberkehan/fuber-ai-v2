// İnce çizgili ikon seti (24 kutu, 1.6 çizgi). Tek tip: kokpit, ray ve kartlarda aynı dil.
// `ustuCizili`: kapalı hâl (sol ray hızlı denetimleri) — simgenin üstünden çapraz çizgi geçer; çizginin iki yanında simge maskeyle
// açılır (boşluk), böylece zeminin rengi ne olursa olsun çizgi simgeden ayrı okunur.
// Simgelerin bir kısmının çizim yolları Lucide (ISC, © Lucide Icons and Contributors) ve Feather (MIT, © Cole Bemis) simgelerinden uyarlanmıştır
// (ör. uyari, ayarlar, ice, yenile, arac, kamera, cop). Lisans metni: resources/lisanslar/LUCIDE-LICENSE.txt; THIRD_PARTY_NOTICES.md ve Ayarlar →
// Hakkında (shared/ucuncu-taraf.ts) aynı atfı taşır.
import { useId } from 'react';

const YOL: Record<string, string> = {
  kokpit: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  sohbet: 'M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
  // Hafıza (0.10 Görev 1, D1): beyin çizimi değil — yer imli kart yığını (arkada bir kart, önde yer imli kart).
  hafiza: 'M8 4.5h10.5A1.5 1.5 0 0 1 20 6v10.5M5.5 7.5h10A1.5 1.5 0 0 1 17 9v10a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 19V9a1.5 1.5 0 0 1 1.5-1.5zM8 7.5V13l2-1.5 2 1.5V7.5',
  // Toplantı (12 Kas): iki konuşma balonu — biri öbürünün arkasında (karşı taraf ve siz).
  toplanti: 'M4 5.5h10a1.5 1.5 0 0 1 1.5 1.5v5.5a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 3v-3H4a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 4 5.5zM18.5 9.5H20a1.5 1.5 0 0 1 1.5 1.5v5.5A1.5 1.5 0 0 1 20 18h-1.5v3l-3.5-3h-3.5a1.5 1.5 0 0 1-1.5-1.5V16',
  // Etkinlik (0.10 Görev 1, D1): nabız çizgisi.
  etkinlik: 'M3 12h3.5L9 6l4 12 2.5-6H21',
  baglanti: 'M9 15l6-6M10 6l1-1a4 4 0 0 1 6 6l-1 1M14 18l-1 1a4 4 0 0 1-6-6l1-1',
  ayarlar: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
  saat: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  zil: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4',
  posta: 'M3 6h18v12H3zM3 7l9 6 9-6',
  isik: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.4 1 2.5h6c0-1.1.4-1.9 1-2.5A6 6 0 0 0 12 3z',
  uyari: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  liste: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  klasor: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  kopyala: 'M9 9h10v10H9zM5 15V5h10',
  kamera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 10.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  dahasi: 'M5 12h.01M12 12h.01M19 12h.01',
  arac: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z',
  wp: 'M20 12a8 8 0 0 1-11.8 7l-4.2 1 1.1-4A8 8 0 1 1 20 12zM9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 1a3 3 0 0 1-2-2l1-1-1-2z',
  ice: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  // İndir / kur (0.10 Görev 7, B-32): tepsiye inen ok — "Kur" düğmeleri (açılır menü okuyla karışmasın).
  indir: 'M12 4v10.5M7.5 10 12 14.5 16.5 10M5 15.5v2.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-2.5',
  arti: 'M12 5v14M5 12h14',
  gonder: 'M5 12h14M13 6l6 6-6 6',
  dur: 'M8 8h8v8H8z',
  mikrofon: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  ek: 'M21 12l-8.5 8.5a5 5 0 0 1-7-7L14 5a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 8',
  kapat: 'M6 6l12 12M18 6 6 18',
  tamam: 'M5 12l5 5 9-10',
  eksi: 'M7 12h10',
  yenile: 'M20 12a8 8 0 1 1-2.3-5.7L20 8M20 3v5h-5',
  ara: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  igne: 'M9 4h6l-1 5 3 3H7l3-3zM12 15v6',
  cop: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  kalem: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  kalkan: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  ekran: 'M3 5h18v11H3zM8 21h8M12 16v5',
  // Telefon (Bağlantılar → Fuber Cep): yuvarlak köşeli gövde + alt çizgi.
  telefon: 'M8.5 2.5h7a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2zM10.5 18.5h3',
  kure: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z',
  dis: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  oynat: 'M8 5v14l11-7z',
  hedef: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 11.5h.01',
  yildiz: 'M12 3l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.9-5.4 2.9 1-6L3.3 9.4l6-.9z',
  geri: 'M15 6l-6 6 6 6',
  ileri: 'M9 6l6 6-6 6',
  duraklat: 'M8 5v14M16 5v14',
  // 0.14 T25 (Müzik): önceki / sonraki parça.
  onceki: 'M18 6.5v11l-8.5-5.5zM6 6v12',
  sonraki: 'M6 6.5v11l8.5-5.5zM18 6v12',
  bolt: 'M13 3 5 14h6l-1 7 8-11h-6z',
  kod: 'M8.5 7 3.5 12l5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15',
  gunes: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4',
  ay: 'M20 14.2A8 8 0 0 1 9.8 4 8 8 0 1 0 20 14.2z',
  cam: 'M6 9h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM8 5.5V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-.5',
  agi: 'M6 5.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4zM18 3.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4zM12 14.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4zM8.2 7.7l7.6-1.4M7.2 9.9l3.6 5M16.9 7.9l-3.8 7.1',
  // Claude Code çalışma alanı (Görev 28): dosya, terminal, git dalı, çatal.
  dosya: 'M6.5 3h7.5l4.5 4.5V21h-12zM14 3v4.5h4.5M9 12.5h6M9 16h6',
  terminal: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM7 9.5l3 2.5-3 2.5M12.5 15h4.5',
  dal: 'M7 4v11M7 15a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM17 4a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM17 9c0 4-3.5 4.5-9.2 6.4',
  catal: 'M6 3.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM18 3.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM12 16.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM6 7.5V9a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7.5M12 12v4.5',
  panel: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM15 5v14',
  // Ayarlar kategorileri, akordeon ve seçici
  asagi: 'M6 9l6 6 6-6',
  kisi: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4.5 20.5a7.5 7.5 0 0 1 15 0',
  kaydirici: 'M4 7h9M17 7h3M15 5v4M4 17h3M11 17h9M9 15v4',
  kilit: 'M6 11h12v9.5H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3M12 15v2.5',
  grafik: 'M5 20v-6M11 20V5M17 20v-9M3 20.5h18',
  veri: 'M12 4c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  canta: 'M4 8h16v11H4zM9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M4 13h16',
  kart: 'M3 6h18v12H3zM3 10h18M7 15h4',
  // Ada: üstünde çentik hapı olan ekran. 11 Kas (tasarımcı bulgu 5): eski çentikli çizim küçük boyda kitap gibi okunuyordu; hap ekranın içinde.
  ada: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM9.5 8.25h5',
  // Sürekli dinleme: ses dalgası.
  dalga: 'M4 10.5v3M8 7.5v9M12 4.5v15M16 8.5v7M20 10.5v3',
  // 0.14 T22 sistem uyarı hapları (shared/sistem-uyarilari.ts simge adları): kulaklık, hoparlör (ses düzeyi ve hoparlör aygıtı), sessiz (hoparlör + çarpı),
  // pil (şarj çıkarıldı; takılınca bolt), büyük harf kilidi (ok + taban çizgisi), internet (kablosuz yaylar; koptu: üstü çizili yaylar).
  kulaklik: 'M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H5a1 1 0 0 1-1-1zM20 14h-3v6h2a1 1 0 0 0 1-1z',
  hoparlor: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11',
  sessiz: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9.5l5 5M21 9.5l-5 5',
  pil: 'M4 8h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM21.5 10.5v3M6 11v2',
  'buyuk-harf': 'M12 4.5 5 11.5h4v4.5h6v-4.5h4zM8 19.5h8',
  wifi: 'M2.5 9a14 14 0 0 1 19 0M5.5 12.3a9.5 9.5 0 0 1 13 0M8.6 15.5a5 5 0 0 1 6.8 0M12 19h.01',
  'wifi-yok': 'M2.5 9a14 14 0 0 1 19 0M5.5 12.3a9.5 9.5 0 0 1 13 0M8.6 15.5a5 5 0 0 1 6.8 0M12 19h.01M3.5 3.5l17 17',
  // Parıltı: eski asistan simgesi (nötron yıldızına benziyordu); raydan ve Fuber Tarayıcı'dan kalktı (Görev 22), yerine "asistan".
  parilti: 'M11 4l1.7 4.8L17.5 10.5l-4.8 1.7L11 17l-1.7-4.8L4.5 10.5l4.8-1.7zM18 15.5l.75 2 2 .75-2 .75L18 21l-.75-2-2-.75 2-.75z',
  // Asistan ("Fuber'e sor"; Görev 22): yuvarlak konuşma balonunda ürün işaretinin iki noktası — Fuber'le konuş. Sohbetler'in
  // köşeli balonundan ve raydaki mikrofon/dalga denetimlerinden ayrı okunur. Noktalar 0,8 yarıçaplı halka + 1,6 çizgi = dolu disk.
  asistan: 'M12 4.25c4.7 0 8.5 3.05 8.5 6.85s-3.8 6.85-8.5 6.85c-1.05 0-2.05-.15-2.98-.43L4.75 19.5l1.2-3.82C4.5 14.45 3.5 12.86 3.5 11.1c0-3.8 3.8-6.85 8.5-6.85zM9.4 10.3a.8.8 0 1 0 0 1.6.8.8 0 1 0 0-1.6zM14.6 10.3a.8.8 0 1 0 0 1.6.8.8 0 1 0 0-1.6z',
};

/** Üstü çizili hâlin çizgisi (sol üstten sağ alta). */
const CIZGI = 'M3.5 3.5l17 17';

export function Ikon({ ad, olcu = 18, kalinlik = 1.6, className, ustuCizili = false }: { ad: keyof typeof YOL | string; olcu?: number; kalinlik?: number; className?: string; ustuCizili?: boolean }) {
  const maske = `ikon-maske-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg className={className} width={olcu} height={olcu} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={kalinlik} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ustuCizili && (
        <defs>
          <mask id={maske} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
            <rect width="24" height="24" fill="#fff" stroke="none" />
            <path d={CIZGI} stroke="#000" strokeWidth={kalinlik * 3.2} />
          </mask>
        </defs>
      )}
      <path d={YOL[ad] ?? YOL.isik} mask={ustuCizili ? `url(#${maske})` : undefined} />
      {ustuCizili && <path d={CIZGI} />}
    </svg>
  );
}
