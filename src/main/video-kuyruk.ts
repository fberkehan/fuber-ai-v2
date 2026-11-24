// ── Video işleri: sıra, iptal ve üst süre (inceleme I2; Electron'suz, birim testli: tests/video-kuyruk.test.ts) ─────────────────────
// Video işleri TEK TEK çalışır (ortak gizli oturumun fuber:// işleyicisi bir işten ötekine geçmesin). Her işin:
//  • iptali: çip kaldırılınca `iptal(kimlik)` — sıradaysa hiç başlamaz, çalışıyorsa `durdur` çağrılır (pencere yok edilir);
//  • üst süresi: `sureMs` dolunca durdurulur ve "zaman" hatasıyla biter;
//  • dışarıdan düşürülmesi: iş kendi `dus('coktu' | 'yanitsiz')` çağrısıyla (render-process-gone, unresponsive) hemen biter.
// Her yolda `temizle` BİR KEZ çağrılır (pencere her durumda kapanır) ve söz mutlaka çözülür.

export type VideoIsHatasi = 'iptal' | 'zaman' | 'coktu' | 'yanitsiz';
export class VideoIsiDurdu extends Error { readonly neden: VideoIsHatasi; constructor(neden: VideoIsHatasi) { super(neden); this.neden = neden; } }

export interface VideoIsi<T> {
  /** İşin kendisi; `durdu()` true dönerse (iptal/zaman) erken çıkmalı. `dus` dışarıdan gelen çöküşü bildirir. */
  calistir: (b: { durdu: () => boolean; dus: (n: 'coktu' | 'yanitsiz') => void; temizlemeyeKaydet: (f: () => void) => void }) => Promise<T>;
  sureMs: number;
  /** Sırada beklerken (önünde iş varken) bir kez. */
  sirada?: () => void;
}

const iptaller = new Map<string, () => void>();
let son: Promise<unknown> = Promise.resolve();

/** Videoyu sıraya koyar. Çözülen değer işin sonucu ya da VideoIsiDurdu (fırlatılmaz: döner). */
export function videoIsiEkle<T>(kimlik: string, is: VideoIsi<T>): Promise<T | VideoIsiDurdu> {
  let iptalEdildi = false;
  let durdur: (n: VideoIsHatasi) => void = () => { iptalEdildi = true; };
  iptaller.set(kimlik, () => durdur('iptal'));
  const onceki = son;
  if (iptaller.size > 1) is.sirada?.();
  const sonuc = onceki.catch(() => undefined).then(async (): Promise<T | VideoIsiDurdu> => {
    if (iptalEdildi) return new VideoIsiDurdu('iptal');
    const temizlikler: (() => void)[] = [];
    let durdu: VideoIsHatasi | null = null;
    let red: (e: VideoIsiDurdu) => void = () => undefined;
    const durus = new Promise<never>((_, r) => { red = r; });
    durus.catch(() => undefined); // iş bittikten sonra gelen duruş işlenmemiş ret olmasın
    durdur = (n) => { if (durdu) return; durdu = n; red(new VideoIsiDurdu(n)); };
    const saat = setTimeout(() => durdur('zaman'), is.sureMs);
    try {
      return await Promise.race([
        is.calistir({ durdu: () => durdu !== null, dus: (n) => durdur(n), temizlemeyeKaydet: (f) => { temizlikler.push(f); } }),
        durus,
      ]);
    } catch (e) {
      if (e instanceof VideoIsiDurdu) return e;
      throw e;
    } finally {
      clearTimeout(saat);
      for (const f of temizlikler.splice(0)) { try { f(); } catch { /* temizlik */ } }
    }
  });
  son = sonuc.catch(() => undefined);
  return sonuc.finally(() => { if (iptaller.get(kimlik)) iptaller.delete(kimlik); });
}

/** Çip kaldırıldı: sıradaysa başlamaz, çalışıyorsa durdurulur (pencere kapanır). Bilinmeyen kimlik: false. */
export function videoIsiIptal(kimlik: unknown): boolean {
  const f = typeof kimlik === 'string' ? iptaller.get(kimlik) : undefined;
  if (!f) return false;
  f();
  return true;
}
