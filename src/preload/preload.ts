// ── Preload: arayüze yalnız beyaz listedeki kanallar açılır ─────────────────────────────────────────────────
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { CAGRI_KANALLARI, OLAY_KANALLARI } from '../shared/kanallar.js';

const cagriIzin = new Set<string>(CAGRI_KANALLARI);
const olayIzin = new Set<string>(OLAY_KANALLARI);

contextBridge.exposeInMainWorld('fuber', {
  cagir: (kanal: string, ...a: unknown[]) => {
    if (!cagriIzin.has(kanal)) return Promise.reject(new Error(`İzinsiz kanal: ${kanal}`));
    return ipcRenderer.invoke(kanal, ...a);
  },
  dinle: (kanal: string, f: (veri: unknown) => void) => {
    if (!olayIzin.has(kanal)) throw new Error(`İzinsiz olay: ${kanal}`);
    const sar = (_e: IpcRendererEvent, veri: unknown) => f(veri);
    ipcRenderer.on(kanal, sar);
    return () => ipcRenderer.removeListener(kanal, sar);
  },
  /**
   * 0.14 T27 (Raf; I1): bırakılan dosyaların yolunu ARAYÜZ DEĞİL preload çözer (webUtils.getPathForFile yalnız gerçek bırakma/seçim nesnesi için dolu döner; uydurma File boş)
   * ve özel `raf:birak` kanalıyla ana sürece yollar. Kanal genel çağrı listesinde değildir: arayüz yol dizisi gönderemez, ana süreç de yalnız çentik penceresinden kabul eder.
   */
  rafBirak: (dosyalar: File[], metin?: string) => {
    const yollar: string[] = [];
    const liste = Array.isArray(dosyalar) ? dosyalar.slice(0, 100) : [];
    for (const d of liste) { try { const y = webUtils.getPathForFile(d); if (y) yollar.push(y); } catch { /* File değil */ } }
    return ipcRenderer.invoke('raf:birak', { yollar, metin: typeof metin === 'string' ? metin : '' }).then((r: object) => ({ ...r, cozulemeyen: liste.length - yollar.length }));
  },
  /**
   * Analiz 11 Kas bulgu 8–9: sohbet eki. Yolu ARAYÜZ DEĞİL preload çözer (gerçek seçilen/bırakılan File; uydurma nesne boş yol → ret). Belge metne
   * çevrilir ('ek:hazirla'), video bu bilgisayarda kare + konuşma yazısına ('ek:video'; ilerleme 'ek:ilerleme' olayıyla, `kimlik` eşler). Kanallar
   * genel çağrı listesinde değil.
   */
  ekHazirla: (dosya: File) => {
    let yol = '';
    try { yol = webUtils.getPathForFile(dosya); } catch { /* File değil */ }
    if (!yol) return Promise.resolve({ hata: 'Dosyanın yolu okunamadı; dosyayı yeniden seç ya da sürükle.' });
    return ipcRenderer.invoke('ek:hazirla', { yol });
  },
  videoHazirla: (dosya: File, kimlik: string) => {
    let yol = '';
    try { yol = webUtils.getPathForFile(dosya); } catch { /* File değil */ }
    if (!yol) return Promise.resolve({ hata: 'Videonun yolu okunamadı; dosyayı yeniden seç ya da sürükle.' });
    return ipcRenderer.invoke('ek:video', { yol, kimlik: typeof kimlik === 'string' ? kimlik : '' });
  },
  /** İnceleme I2: işlenen videonun çipi kaldırıldı — iş durur (gizli pencere kapanır). */
  videoIptal: (kimlik: string) => ipcRenderer.invoke('ek:video-iptal', typeof kimlik === 'string' ? kimlik : ''),
  platform: process.platform,
  // 0.11 G3: test derlemesi mi (önizleme betikleri FUBER_DEMO=1 ile açar). Yalnız geliştirici yüzeylerini (#galeri) açar; müşteri
  // sürümünde false — galeri ne yüklenir ne açılır (renderer/ui/galeri-kapisi.ts).
  demo: Boolean(process.env.FUBER_DEMO),
});
