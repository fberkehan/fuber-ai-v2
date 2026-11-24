// LOG: asistanın gerçek olayları için halka tampon (beyin, bildirim, köprü, uyarı). Yeni satır `onAdd` ile hemen
// Quest'e (`hud.log`) gider; son 20'si anlık görüntüde durur.
// `upsert`: aynı anahtarlı satır YENİ SATIR AÇMAZ, günceli yerine yazılır ve en üste alınır (ör. "SAAT · son örnek 19:12").
// Bağlan/kop gibi sık olaylar böyle tekilleştirilir; `quiet` satır Quest'e `hud.log` olarak da gitmez (bildirim üretmez).
import type { LogEntry } from './types';

export const LOG_CAPACITY = 100;
export const LOG_IN_SNAPSHOT = 20;

const pad = (n: number) => String(n).padStart(2, '0');
export const clockOf = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

interface Row {
  entry: LogEntry;
  key: string | null;
}

export class LogRing {
  private rows: Row[] = [];
  private lastKey = '';
  private lastAt = 0;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly onAdd?: (entry: LogEntry) => void,
    private readonly capacity = LOG_CAPACITY,
  ) {}

  /** Satır ekler. Aynı etiket+metin 5 sn içinde yinelenirse atlanır. */
  add(tag: string, text: string, ref?: string): LogEntry | null {
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 160);
    if (!clean) return null;
    const t = this.now();
    const key = `${tag}|${clean}`;
    if (key === this.lastKey && t - this.lastAt < 5000) return null;
    this.lastKey = key;
    this.lastAt = t;
    const entry: LogEntry = { ts: clockOf(new Date(t)), tag, text: clean, ...(ref ? { ref } : {}) };
    this.push({ entry, key: null });
    this.onAdd?.(entry);
    return entry;
  }

  /** Anahtarlı tekil satır: varsa güncellenir ve en üste alınır, yoksa eklenir. `quiet`: Quest'e yollanmaz. */
  upsert(key: string, tag: string, text: string, opts: { quiet?: boolean } = {}): LogEntry | null {
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, 160);
    if (!clean) return null;
    const entry: LogEntry = { ts: clockOf(new Date(this.now())), tag, text: clean };
    const i = this.rows.findIndex((r) => r.key === key);
    if (i >= 0) this.rows.splice(i, 1);
    this.push({ entry, key });
    if (!opts.quiet) this.onAdd?.(entry);
    return entry;
  }

  private push(row: Row): void {
    this.rows.push(row);
    if (this.rows.length > this.capacity) this.rows.shift();
  }

  /** En yeni önde. */
  recent(n = LOG_IN_SNAPSHOT): LogEntry[] {
    return this.rows
      .slice(-n)
      .reverse()
      .map((r) => r.entry);
  }

  size(): number {
    return this.rows.length;
  }
}
