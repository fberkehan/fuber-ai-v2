// BIO: saatten gelen `bio.sample` / `bio.status`. Saat SÜREKLİ ölçmez: her kendi ölçümünde bir `bio.sample` yollar (`ts` =
// ölçümün gerçek anı) ve bağlantı kısa ömürlü olabilir. Bu yüzden durum BAĞLANTIYA değil SON GERÇEK ÖRNEĞİN YAŞINA bağlıdır:
//   ≤ 20 dk  → `live`  (panel "CANLI"; gösterilen sayı son gerçek ölçümdür, yaşı `lastSampleAgoSec`te)
//   20 dk–2 sa → `stale` (soluk; "SON ÖLÇÜM x DK ÖNCE")
//   > 2 sa ya da hiç örnek yok → `off` (sayı yok)
// Örnek zamanı: saatin `ts`'i makul ise (son 2 saat ile 1 dk ileri arası) o, değilse alış anı (saatin saati kayık olabilir).
// Gösterimdeki "sürekli ölçülüyormuş" canlandırması YALNIZ arayüzdedir (sayı son gerçek değerin ±1-2 bpm çevresinde oynar,
// satırda gerçek değer ve yaşı yazar); bu dosya hiçbir sayı uydurmaz.
import type { HudBio } from './types';

export const BIO_LIVE_MS = 20 * 60_000;
export const BIO_OFF_MS = 2 * 3600_000;
/** `hrSeries`: son 60 sn içindeki GERÇEK örnekler (çoğu zaman boş: saat 1 sn'de bir ölçmez). */
export const BIO_WINDOW_MS = 60_000;
const HISTORY = 40;

const num = (v: unknown, min: number, max: number): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null);

export function offBio(): HudBio {
  return { status: 'off', source: 'none', worn: false, battery: null, hr: null, hrSeries: [], spo2: null, steps: null, kcal: null, skinTemp: null, stress: null, sleepMin: null, lastSampleAgoSec: null };
}

/** RMSSD (ms) → 0..100 gerginlik tahmini (düşük HRV = yüksek). Yaklaşıktır; yeterli IBI yoksa null. */
export function stressFromIbi(ibi: number[]): number | null {
  const v = ibi.filter((x) => x >= 300 && x <= 2000);
  if (v.length < 5) return null;
  let sum = 0;
  for (let i = 1; i < v.length; i += 1) sum += (v[i]! - v[i - 1]!) ** 2;
  const rmssd = Math.sqrt(sum / (v.length - 1));
  return Math.round(Math.max(0, Math.min(100, 100 - ((rmssd - 10) / 70) * 100)));
}

export class BioTracker {
  private connected = false;
  private everConnected = false;
  private worn = false;
  private battery: number | null = null;
  private measuring = false;
  private history: Array<{ at: number; hr: number }> = [];
  /** Son örneğin (ölçüm) anı. */
  private lastAt: number | null = null;
  private spo2: number | null = null;
  private steps: number | null = null;
  private kcal: number | null = null;
  private skin: number | null = null;
  private sleep: number | null = null;
  private ibi: number[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  /** Saatin köprü bağlantısı değişti. Veriyi SİLMEZ: bağlantı kısa ömürlü olabilir, son gerçek örnek yaşıyla geçerlidir. */
  setConnected(connected: boolean): void {
    this.connected = connected;
    if (connected) this.everConnected = true;
  }

  /** Örneğin ölçüm anı: `ts` makulse o, değilse şimdi. */
  private sampleTime(ts: unknown): number {
    const t = this.now();
    return typeof ts === 'number' && Number.isFinite(ts) && ts <= t + 60_000 && ts >= t - BIO_OFF_MS ? ts : t;
  }

  onSample(msg: Record<string, unknown>): void {
    const at = this.sampleTime(msg.ts);
    const hr = num(msg.hr, 20, 250);
    // Daha eski ölçüm (geç gelen) en son örneği geri almaz.
    const newer = this.lastAt === null || at >= this.lastAt;
    if (hr !== null) {
      this.history.push({ at, hr: Math.round(hr) });
      this.history.sort((a, b) => a.at - b.at);
      if (this.history.length > HISTORY) this.history = this.history.slice(-HISTORY);
    }
    if (newer) this.lastAt = at;
    const spo2 = num(msg.spo2, 50, 100);
    if (spo2 !== null) this.spo2 = Math.round(spo2);
    const steps = num(msg.steps, 0, 1e6);
    if (steps !== null) this.steps = Math.round(steps);
    const kcal = num(msg.kcal, 0, 1e5);
    if (kcal !== null) this.kcal = Math.round(kcal);
    const skin = num(msg.skinTemp, 20, 45);
    if (skin !== null) this.skin = Math.round(skin * 10) / 10;
    const sleep = num(msg.sleepMin, 0, 1440);
    if (sleep !== null) this.sleep = Math.round(sleep);
    if (Array.isArray(msg.ibi)) {
      for (const x of msg.ibi) if (typeof x === 'number' && Number.isFinite(x)) this.ibi.push(x);
      if (this.ibi.length > 60) this.ibi = this.ibi.slice(-60);
    }
  }

  onStatus(msg: Record<string, unknown>): void {
    if (typeof msg.worn === 'boolean') this.worn = msg.worn;
    const b = num(msg.battery, 0, 100);
    if (b !== null) this.battery = Math.round(b);
    if (typeof msg.measuring === 'boolean') this.measuring = msg.measuring;
  }

  /** Son gerçek nabız örneği: { hr, at } (yoksa null). Günlük satırı için. */
  last(): { hr: number | null; at: number } | null {
    if (this.lastAt === null) return null;
    return { hr: this.history.at(-1)?.hr ?? null, at: this.lastAt };
  }

  snapshot(): HudBio {
    const t = this.now();
    const age = this.lastAt === null ? null : Math.max(0, t - this.lastAt);
    if (age === null || age > BIO_OFF_MS) {
      const off = offBio();
      const reason: HudBio['reason'] = age === null && !this.everConnected ? 'disconnected' : 'noData';
      // Pil/takılı bilgisi durum iletisinden gerçektir; sayı (nabız vb.) yoktur.
      return { ...off, ...(this.battery !== null || this.everConnected ? { source: 'watch' as const, battery: this.battery, worn: this.worn } : {}), measuring: this.measuring, reason, lastSampleAgoSec: age === null ? null : Math.round(age / 1000) };
    }
    const lastHr = this.history.at(-1)?.hr ?? null;
    const series = this.history.filter((p) => t - p.at <= BIO_WINDOW_MS).map((p) => p.hr);
    const recent = this.history.filter((p) => t - p.at <= BIO_LIVE_MS);
    return {
      status: age <= BIO_LIVE_MS ? 'live' : 'stale',
      source: 'watch',
      worn: this.worn,
      battery: this.battery,
      hr: lastHr,
      hrSeries: series,
      spo2: this.spo2,
      steps: this.steps,
      kcal: this.kcal,
      skinTemp: this.skin,
      stress: stressFromIbi(this.ibi),
      sleepMin: this.sleep,
      lastSampleAgoSec: Math.round(age / 1000),
      measuring: this.measuring,
      reason: 'ok',
      hrAvg: recent.length ? Math.round(recent.reduce((a, b) => a + b.hr, 0) / recent.length) : null,
      hrHistory: this.history.slice(-20).map((p) => ({ ts: p.at, hr: p.hr })),
      connected: this.connected,
    };
  }
}
