// Anlık görüntü birleştirme: bütün kaynakların son halini tek `HudSnapshot`a toplar (saf işlev; saat ve veri dışarıdan
// verilir). Selam saate göre, özet dikkat bekleyen GERÇEK madde sayısına göre yazılır.
import type { HudCal, HudCore, HudEnv, HudFin, HudJob, HudLinks, HudNotice, HudPalette, HudSnapshot, JarvisConfig, LogEntry, LoadLevel, VoiceHudState } from './types';

export interface SnapshotParts {
  now: number;
  /** Kullanıcının hitabı ("efendim"); yoksa "efendim". */
  address: string | null;
  node: string;
  config: JarvisConfig;
  env: HudEnv;
  cal: HudCal;
  overdue: number;
  core: HudCore;
  fin: HudFin;
  links: HudLinks;
  log: LogEntry[];
  notices: HudNotice[];
  jobs: HudJob[];
  seq: number;
  /** Gösterilecek palet (otomatikte yoğunluktan). */
  palette: HudPalette;
  load: { score: number; level: LoadLevel; reasons: string[] };
  voice: { state: VoiceHudState; text?: string };
  /** IANA saat dilimi (sınama için); yoksa sistemin. */
  timeZone?: string;
}

export function greetingFor(hour: number, address: string | null): string {
  const who = address?.trim() || 'efendim';
  const hello = hour >= 5 && hour < 12 ? 'Günaydın' : hour >= 12 && hour < 18 ? 'İyi günler' : hour >= 18 && hour < 23 ? 'İyi akşamlar' : 'İyi geceler';
  return `${hello}, ${who}.`;
}

export function summaryFor(attention: number, linksDown: number): string {
  const head = linksDown > 0 ? 'Bir bağlantıda sorun var.' : 'Bütün sistemler normal.';
  if (attention <= 0) return `${head} Dikkatinizi bekleyen konu yok.`;
  return `${head} Dikkatinizi bekleyen ${attention} konu var.`;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function clockFor(now: number, place: string, timeZone?: string): HudSnapshot['clock'] {
  const d = new Date(now);
  const opts: Intl.DateTimeFormatOptions = timeZone ? { timeZone } : {};
  const parts = new Intl.DateTimeFormat('tr-TR', { ...opts, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(d);
  const date = new Intl.DateTimeFormat('tr-TR', { ...opts, weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(d).toLocaleUpperCase('tr');
  const tz = new Intl.DateTimeFormat('en-US', { ...opts, timeZoneName: 'short' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? '';
  return { time: parts || `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`, date, tz, place };
}

export function hourOf(now: number, timeZone?: string): number {
  if (!timeZone) return new Date(now).getHours();
  const h = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date(now));
  return Number(h);
}

export function buildSnapshot(p: SnapshotParts): HudSnapshot {
  const pendingNotices = p.notices.filter((n) => n.pending).length;
  const total = pendingNotices + p.overdue;
  const linksDown = p.links.items.filter((i) => !i.up).length;
  return {
    ts: p.now,
    greeting: greetingFor(hourOf(p.now, p.timeZone), p.address),
    summary: summaryFor(total, linksDown),
    palette: p.palette,
    tab: p.config.tab,
    clock: clockFor(p.now, p.env.place || '', p.timeZone),
    env: p.env,
    cal: p.cal,
    core: p.core,
    fin: p.fin,
    links: p.links,
    log: p.log,
    seq: p.seq,
    node: p.node,
    attention: total,
    jobs: p.jobs,
    notices: p.notices,
    voice: p.voice,
    paletteMode: p.config.paletteMode,
    load: p.load,
  };
}
