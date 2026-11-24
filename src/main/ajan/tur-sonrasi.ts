// ── Tur sonrası işler: ertelenir ve birleştirilir (Görev 21, K10) ─────────────────────────────────────────────────────────────────
// Her yanıttan sonra hafıza yazımı, sohbet başlığı, uzun sohbet özeti ve kokpit planı yardımcı modele gider. Sesli konuşmada kullanıcı
// hemen yeni bir şey sorabilir: bu işler yanıtla aynı anda koşup bağlantıyı/hız sınırını paylaşmasın diye kısa bir sessizlikten sonra
// çalışır; araya yeni tur girerse yine ertelenir. Aynı anahtarlı iş (başlık, özet, kokpit) birleşir — en sonuncusu bir kez çalışır;
// hafıza işleri her tur için ayrı anahtarla birikir (hiçbiri kaybolmaz). Çıkışta bekleyenler hemen çalışır ve sözleri beklenir
// (dongu.ts turSonrasiniBitir; main.ts before-quit). Saf (birim testli: tests/tur-sonrasi.test.ts).

export interface Zamanlayici { kur: (f: () => void, ms: number) => unknown; iptal: (z: unknown) => void }
const gercek: Zamanlayici = { kur: (f, ms) => setTimeout(f, ms), iptal: (z) => clearTimeout(z as ReturnType<typeof setTimeout>) };

/** Bir iş: dönen söz (varsa) çıkışta beklenir (hepsiniCalistir). */
export type TurIsi = () => unknown;

export class TurSonrasi {
  private readonly bekleyen = new Map<number, { isler: Map<string, TurIsi>; zaman: unknown; ms: number }>();
  private readonly suren = new Set<number>();
  private readonly z: Zamanlayici;
  constructor(z: Zamanlayici = gercek) { this.z = z; }

  /** Tur başladı: bu sohbetin bekleyen işleri tur bitene dek bekler. */
  basladi(sohbetId: number): void {
    this.suren.add(sohbetId);
    const b = this.bekleyen.get(sohbetId);
    if (b?.zaman !== undefined && b.zaman !== null) { this.z.iptal(b.zaman); b.zaman = null; }
  }

  /** Tur bitti: işler `ms` sessizlikten sonra çalışır (yeni tur gelirse yine ertelenir). */
  bitti(sohbetId: number, isler: Record<string, TurIsi>, ms: number): void {
    this.suren.delete(sohbetId);
    if (!Object.keys(isler).length && !this.bekleyen.has(sohbetId)) return;
    const b = this.bekleyen.get(sohbetId) ?? { isler: new Map<string, TurIsi>(), zaman: null, ms };
    for (const [k, f] of Object.entries(isler)) { b.isler.delete(k); b.isler.set(k, f); }
    b.ms = ms;
    if (b.zaman) this.z.iptal(b.zaman);
    b.zaman = this.z.kur(() => this.calistir(sohbetId), ms);
    this.bekleyen.set(sohbetId, b);
  }

  private calistir(sohbetId: number, sec: (anahtar: string) => boolean = () => true): Promise<unknown>[] {
    const b = this.bekleyen.get(sohbetId);
    if (!b || this.suren.has(sohbetId)) return [];
    this.bekleyen.delete(sohbetId);
    const sozler: Promise<unknown>[] = [];
    for (const [k, f] of b.isler) {
      if (!sec(k)) continue;
      try {
        const r = f();
        if (r instanceof Promise) sozler.push(r.catch((e) => console.warn('[tur sonrası]', (e as Error)?.message)));
      } catch (e) { console.warn('[tur sonrası]', (e as Error).message); }
    }
    return sozler;
  }

  /** Çıkışta / testte: bekleyen her şey hemen çalışır (`sec`: hangi anahtarlar; atlananlar düşer). İşlerin sözleri döner (beklenebilir). */
  hepsiniCalistir(sec?: (anahtar: string) => boolean): Promise<unknown>[] {
    const sozler: Promise<unknown>[] = [];
    for (const [id, b] of [...this.bekleyen]) { if (b.zaman) this.z.iptal(b.zaman); this.suren.delete(id); sozler.push(...this.calistir(id, sec)); }
    return sozler;
  }

  /** Bu sohbette tur sürüyor mu (başladı, henüz bitti() çağrılmadı)? */
  suruyorMu(sohbetId: number): boolean { return this.suren.has(sohbetId); }

  get bekleyenSayisi(): number { let n = 0; for (const b of this.bekleyen.values()) n += b.isler.size; return n; }
}
