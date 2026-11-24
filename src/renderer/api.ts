// Arayüzden ana sürece tipli erişim (preload `window.fuber`).
import type { CagriKanali, OlayKanali } from '../shared/kanallar';

declare global {
  interface Window {
    fuber: {
      cagir: <T = unknown>(kanal: CagriKanali, ...a: unknown[]) => Promise<T>;
      dinle: (kanal: OlayKanali, f: (veri: any) => void) => () => void;
      platform: string;
      /** Raf: bırakılan dosyalar ve/veya metin. Yolu preload çözer (arayüz yol göndermez); yolu çözülemeyen (uydurma) dosya eklenmez. */
      rafBirak?: (dosyalar: File[], metin?: string) => Promise<unknown>;
      /** Sohbet eki (analiz 11 Kas): belge → metin; video → kareler + konuşma yazısı (ilerleme 'ek:ilerleme'). Yolu preload çözer. Telefonda yok. */
      ekHazirla?: (dosya: File) => Promise<{ ad: string; tur: 'belge'; metin: string; kisaltildi?: boolean; toplam?: number } | { hata: string }>;
      videoIptal?: (kimlik: string) => Promise<boolean>;
      videoHazirla?: (dosya: File, kimlik: string) => Promise<{ ad: string; tur: 'video'; metin: string; kisaltildi?: boolean; kareSayisi?: number; sureSn: number; kareler: { medya: string; veri: string }[] } | { hata: string }>;
      /** Test derlemesi (FUBER_DEMO; preload). Telefonda ve müşteri sürümünde yok/false. */
      demo?: boolean;
    };
  }
}

export const cagir = <T = unknown>(kanal: CagriKanali, ...a: unknown[]) => window.fuber.cagir<T>(kanal, ...a);
export const dinle = (kanal: OlayKanali, f: (veri: any) => void) => window.fuber.dinle(kanal, f);

/** Uygulama kaynağı (yazı tipi, beyin görselleri). Fuber Cep'te dosyalar uygulamanın içinde, göreli yoldadır. */
export const kaynak = (yol: string) => (window.fuber?.platform === 'cep' ? `./kaynak/${yol}` : `fuber://app/kaynak/${yol}`);

/** Pencereye bırakılan dosya/bağlantı sayfayı oraya götürmesin (uygulama kabuğu kaybolur). Metin kutusuna yazı
 *  bırakmak serbest; dosya her yerde engelli. Ana süreçteki will-navigate kalkanının arayüz tarafı. */
export function birakmayiEngelle(): void {
  const engelle = (e: DragEvent) => {
    const hedef = e.target as HTMLElement | null;
    const yaziAlani = Boolean(hedef?.closest?.('input, textarea, [contenteditable="true"]'));
    if (!yaziAlani || e.dataTransfer?.types.includes('Files')) e.preventDefault();
  };
  window.addEventListener('dragover', engelle);
  window.addEventListener('drop', engelle);
}

export function zamanGoreli(iso: string): string {
  const d = new Date(iso);
  const fark = (d.getTime() - Date.now()) / 1000;
  const mutlak = Math.abs(fark);
  const rtf = new Intl.RelativeTimeFormat('tr', { numeric: 'auto' });
  if (mutlak < 60) return fark > 0 ? 'birazdan' : 'az önce';
  if (mutlak < 3600) return rtf.format(Math.round(fark / 60), 'minute');
  if (mutlak < 86400) return rtf.format(Math.round(fark / 3600), 'hour');
  if (mutlak < 86400 * 7) return rtf.format(Math.round(fark / 86400), 'day');
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
}

export const saatTarih = (iso: string) =>
  new Date(iso).toLocaleString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
