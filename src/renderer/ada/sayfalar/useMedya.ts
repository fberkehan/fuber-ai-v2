// ── Çentiğin medya hâli: Müzik ve Şarkı sözü sayfaları, Kapalı hap ve panelin medya çubukları (0.14 T25) ───────────────────────────────────────────
// Kaynak olay yardımcısının medya oturumu (GSMTC: Spotify, tarayıcı, mağaza uygulamaları; T21) ve ses düzeyi. Ana süreç yalnız DEĞİŞİNCE 'ada:medya' yollar
// (main/olay-yardimcisi.ts centikMedyasiDinle); açılışta bir kez 'medya:al'. Pencerede tek abonelik (modül deposu; useAsistan ve sayfalar aynı değeri okur).
// Konum her saniye gelmez: anlık konum `medyaKonumu` ile hesaplanır. Saniye göstergesi yalnız çalarken ve sayfa takılıyken saniye başına kurulan TEK
// setTimeout zinciriyle (R26 deseni); duraklamada hiç zamanlayıcı yok. Komutlar yalnız 'medya:komut' (olay yardımcısı; medya tuşu yok).
import { useEffect, useState, useSyncExternalStore } from 'react';
import { cagir, dinle } from '../../api';
import { medyaKonumu, type CentikMedyasi, type MedyaEylemi, type MedyaOlayi } from '../../../shared/sistem-olay';

export type CalanMedya = Extract<MedyaOlayi, { var: true }>;
export type MedyaKomutu = { eylem: Exclude<MedyaEylemi, 'konum'> } | { eylem: 'konum'; sn: number } | { ses: number };

const BOS: CentikMedyasi = { medya: null, ses: null };
let son: CentikMedyasi = BOS;
let olayGeldi = false;
let kuruldu = false;
const dinleyiciler = new Set<() => void>();
const yay = () => { for (const f of [...dinleyiciler]) f(); };

/** Gelen değer biçimce doğru mu (ana süreç doğrular; burada yalnız çökmesin diye). */
const gecerli = (m: unknown): CentikMedyasi => {
  const v = m as Partial<CentikMedyasi> | null;
  return { medya: v?.medya && typeof v.medya === 'object' ? v.medya : null, ses: v?.ses && typeof v.ses === 'object' ? v.ses : null };
};

function kur(): void {
  if (kuruldu) return;
  kuruldu = true;
  dinle('ada:medya', (m: unknown) => { olayGeldi = true; son = gecerli(m); yay(); });
  // Açılış: ilk olay gelmişse daha yenidir (yanıt onu ezmez).
  void Promise.resolve(cagir<CentikMedyasi>('medya:al')).then((m) => { if (!olayGeldi) { son = gecerli(m); yay(); } }).catch(() => undefined);
}

const abone = (f: () => void) => { kur(); dinleyiciler.add(f); return () => { dinleyiciler.delete(f); }; };
const oku = () => son;

/** Pencerenin medya hâli (oturum yoksa medya null ya da `var: false`). */
export function useMedya(): CentikMedyasi {
  return useSyncExternalStore(abone, oku, oku);
}

/** Çalan bir oturum var mı (duraklamış dahil). */
export const calanMedya = (m: CentikMedyasi): CalanMedya | null => (m.medya?.var ? m.medya : null);
/** Çalıyor mu (Kapalı hap ve panelin medya çubukları; R13: yalnız çalarken, hız > 0 — kural shared/sistem-olay.ts'te). */
export { medyaCaliyor } from '../../../shared/sistem-olay';

/** Komut (oynat, duraklat, ileri, geri, konum, ses düzeyi). IPC düşerse sessizce false. */
export function medyaKomutuGonder(k: MedyaKomutu): Promise<boolean> {
  return Promise.resolve(cagir<boolean>('medya:komut', k)).catch(() => false);
}

/** Kapak yalnız yardımcının iki biçiminde (jpeg/png base64 data URL); değilse null (sayfa vurgu renginde yer tutucu çizer). HTML olarak basılmaz: <img src>. */
export function kapakAdresi(k: string | null | undefined): string | null {
  if (typeof k !== 'string') return null;
  return /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(k) ? k : null;
}

/** Kaynak uygulamanın okunur adı (başlık gelmediğinde başlığın yerine): "Spotify.exe" → "Spotify", "…!App" → "App". */
export function uygulamaAdi(aumid: string): string {
  const ham = (aumid.includes('!') ? aumid.slice(aumid.lastIndexOf('!') + 1) : aumid).replace(/\.exe$/i, '').trim();
  const bilinen: Record<string, string> = { msedge: 'Microsoft Edge', chrome: 'Google Chrome', firefox: 'Firefox', spotify: 'Spotify', opera: 'Opera', brave: 'Brave' };
  return bilinen[ham.toLowerCase()] ?? (ham ? ham[0].toUpperCase() + ham.slice(1) : 'Medya');
}

/** "3:07", "1:02:05". */
export function sureMetni(sn: number): string {
  const t = Math.max(0, Math.floor(Number.isFinite(sn) ? sn : 0));
  const s = t % 60, d = Math.floor(t / 60) % 60, sa = Math.floor(t / 3600);
  return sa ? `${sa}:${String(d).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${d}:${String(s).padStart(2, '0')}`;
}

/** Anlık konum (sn), çalarken saniye başında yeniden çizilir (tek setTimeout zinciri); duraklamada zamanlayıcı yok. */
export function useAnlikKonum(m: CalanMedya | null): number {
  const [simdi, setSimdi] = useState(() => Date.now());
  const caliyor = Boolean(m?.caliyor && m.hiz > 0);
  useEffect(() => {
    setSimdi(Date.now());
    if (!m || !caliyor) return;
    let z: ReturnType<typeof setTimeout>;
    const kur = () => {
      const k = medyaKonumu(m, Date.now());
      // Bir sonraki tam saniyeye kalan (oynatma hızıyla).
      const kalan = ((Math.floor(k) + 1 - k) / m.hiz) * 1000;
      z = setTimeout(() => { setSimdi(Date.now()); kur(); }, Math.max(50, kalan + 10));
    };
    kur();
    return () => clearTimeout(z);
    // m alanları ayrı ayrı: aynı medya satırının yeni nesnesi zinciri yeniden kurmasın.
  }, [m?.baslik, m?.konum, m?.konumZamani, m?.hiz, caliyor, m?.sure]);
  return m ? medyaKonumu(m, simdi) : 0;
}
