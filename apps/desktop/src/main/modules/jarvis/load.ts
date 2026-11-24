// Yoğunluk puanı ve otomatik palet. Girdiler GERÇEKTİR: bugünkü kalan/gecikmiş hatırlatıcılar, bekleyen onaylar, bekleyen
// bildirimler, sıradaki olaya kalan süre, süren işler. Puan 0..100; düzey → palet: sakin BUZ, normal CAMGÖBEĞİ, yoğun MAVİ,
// çok yoğun/gecikmiş/acil KOR. Titremesin diye: eşiklerde histerezis (5 puan) ve palet değişimleri arasında en az 2 dk
// (kritik düzeye çıkış beklemez).
import type { HudPalette, LoadLevel } from './types';

export interface LoadInputs {
  /** Bugün kalan (henüz çalmamış) hatırlatıcı sayısı. */
  remainingToday: number;
  /** Gecikmiş ya da çalıp tamamlanmamış hatırlatıcı sayısı. */
  overdue: number;
  /** Bekleyen araç onayı sayısı. */
  approvals: number;
  /** Bekleyen bildirimler, öneme göre. */
  pending: { low: number; normal: number; high: number; urgent: number };
  /** Sıradaki olaya kalan sn (yoksa null). */
  nextInSec: number | null;
  /** Süren (çalışan + sıradaki) iş sayısı. */
  jobs: number;
}

export interface LoadResult {
  score: number;
  /** Histerezissiz ham düzey. */
  rawLevel: LoadLevel;
  /** Zorla kritik: iki gecikmiş ya da acil bildirim. */
  forceCritical: boolean;
  reasons: string[];
}

export const LEVEL_ORDER: LoadLevel[] = ['calm', 'normal', 'busy', 'critical'];
/** Düzeye GİRİŞ eşikleri (puan ≥). */
export const LEVEL_MIN: Record<LoadLevel, number> = { calm: 0, normal: 15, busy: 40, critical: 65 };
export const PALETTE_OF: Record<LoadLevel, HudPalette> = { calm: 'ice', normal: 'cyan', busy: 'blue', critical: 'ember' };
export const LEVEL_LABEL: Record<LoadLevel, string> = { calm: 'SAKİN', normal: 'NORMAL', busy: 'YOĞUN', critical: 'ÇOK YOĞUN' };
export const HYSTERESIS = 5;
export const MIN_DWELL_MS = 120_000;

export function levelOfScore(score: number): LoadLevel {
  let out: LoadLevel = 'calm';
  for (const l of LEVEL_ORDER) if (score >= LEVEL_MIN[l]) out = l;
  return out;
}

export function computeLoad(i: LoadInputs): LoadResult {
  const reasons: string[] = [];
  let score = 0;
  const add = (pts: number, reason: string | null) => {
    if (pts <= 0) return;
    score += pts;
    if (reason) reasons.push(reason);
  };
  add(Math.min(20, i.remainingToday * 4), i.remainingToday ? `bugün ${i.remainingToday} hatırlatıcı kaldı` : null);
  add(Math.min(30, i.overdue * 15), i.overdue ? `${i.overdue} gecikmiş hatırlatıcı` : null);
  add(Math.min(20, i.approvals * 10), i.approvals ? `${i.approvals} onay bekliyor` : null);
  const p = i.pending;
  const pendingTotal = p.urgent + p.high + p.normal + p.low;
  add(Math.min(24, p.urgent * 12) + Math.min(18, p.high * 6) + Math.min(10, p.normal * 2) + Math.min(4, p.low), pendingTotal ? `${pendingTotal} bekleyen bildirim${p.urgent ? ' (acil var)' : ''}` : null);
  if (i.nextInSec !== null) {
    const min = i.nextInSec / 60;
    if (min <= 15) add(20, `sıradaki olaya ${Math.max(1, Math.round(min))} dk`);
    else if (min <= 60) add(12, `sıradaki olaya ${Math.round(min)} dk`);
    else if (min <= 180) add(5, `sıradaki olaya ${Math.round(min / 60)} sa`);
  }
  add(Math.min(15, i.jobs * 5), i.jobs ? `${i.jobs} iş sürüyor` : null);
  score = Math.max(0, Math.min(100, Math.round(score)));
  const forceCritical = i.overdue >= 2 || i.pending.urgent > 0;
  const rawLevel: LoadLevel = forceCritical ? 'critical' : levelOfScore(score);
  return { score, rawLevel, forceCritical, reasons };
}

/** Palet kararı: histerezis + en az 2 dk bekleme (kritik düzeye çıkış hariç). */
export class AutoPalette {
  level: LoadLevel = 'normal';
  private changedAt = -Infinity;
  private started = false;

  /** Yeni ölçümle düzeyi günceller; geçerli düzeyi döner. */
  update(load: LoadResult, now: number): LoadLevel {
    if (!this.started) {
      // ilk ölçümde bekleme yok
      this.started = true;
      this.level = load.rawLevel;
      this.changedAt = now;
      return this.level;
    }
    let target = load.rawLevel;
    const cur = LEVEL_ORDER.indexOf(this.level);
    const want = LEVEL_ORDER.indexOf(target);
    // histerezis: aşağı inmek için geçerli düzeyin eşiğinin 5 puan altına inmek gerekir
    if (!load.forceCritical && want < cur && load.score > LEVEL_MIN[this.level] - HYSTERESIS) target = this.level;
    if (target === this.level) return this.level;
    if (target !== 'critical' && now - this.changedAt < MIN_DWELL_MS) return this.level;
    this.level = target;
    this.changedAt = now;
    return this.level;
  }
}
