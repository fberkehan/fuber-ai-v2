// JARVIS servisi: bütün kaynakları (env, cal, core, fin, links, log) toplayıp her saniye tek `HudSnapshot`
// üretir; renderer'a (`jarvis.snapshot` pencere olayı) yollar. Cihaz eklentilerinden (Quest, saat) gelen `hud.action`
// iletilerini işler; cihaza giden iletiler (`publish`) olay olarak yayımlanır. Elektron'a dokunmaz: her dış bağımlılık `JarvisDeps` ile verilir (birim
// sınamalı). Ağ/ölçüm işleri arka planda yürür; saniyelik tur yalnız son bilinen değerleri birleştirir.
import { buildCal, overdueCount, type CalSources } from './cal';
import { buildLinks, type LinksSource, type ProbeTarget } from './links';
import { LogRing } from './log';
import { AutoPalette, computeLoad, PALETTE_OF } from './load';
import { hudStateOf, VoiceHudTracker, type HudVoiceMsg } from './voice-level';
import { buildSnapshot } from './snapshot';
import { DEFAULT_WATCHLIST, HUD_PALETTES, HUD_TABS, type FinWatch, type HudJob, type HudNotice, type HudPalette, type HudSnapshot, type HudTab, type JarvisConfig, type LogEntry } from './types';
import type { CoreSource } from './core';
import type { EnvSource } from './env';
import type { FinSource } from './fin';

export function defaultConfig(): JarvisConfig {
  return { palette: 'cyan', paletteMode: 'auto', tab: 'overview', city: null, watchlist: DEFAULT_WATCHLIST.map((w) => ({ ...w })), focus: 'BTC' };
}

/** Saklı ayarı doğrular; bozuk/eksik alanlar varsayılanla tamamlanır. */
export function sanitizeConfig(raw: unknown): JarvisConfig {
  const d = defaultConfig();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const list = Array.isArray(r.watchlist) ? r.watchlist.map(sanitizeWatch).filter((w): w is FinWatch => w !== null).slice(0, 12) : null;
  return {
    palette: HUD_PALETTES.includes(r.palette as HudPalette) ? (r.palette as HudPalette) : d.palette,
    paletteMode: r.paletteMode === 'manual' ? 'manual' : 'auto',
    tab: HUD_TABS.includes(r.tab as HudTab) ? (r.tab as HudTab) : d.tab,
    city: typeof r.city === 'string' && r.city.trim() ? r.city.trim().slice(0, 80) : null,
    watchlist: list && list.length ? list : d.watchlist,
    focus: typeof r.focus === 'string' && r.focus ? r.focus.slice(0, 24) : d.focus,
  };
}

export function sanitizeWatch(raw: unknown): FinWatch | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const sym = typeof r.sym === 'string' ? r.sym.trim().toUpperCase().slice(0, 16) : '';
  const ticker = typeof r.ticker === 'string' ? r.ticker.trim().slice(0, 24) : '';
  if (!sym || !/^[A-Za-z0-9.^=\-/]+$/.test(ticker)) return null;
  const source = r.source === 'binance' ? 'binance' : 'yahoo';
  return {
    sym,
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 40) : sym,
    source,
    ticker: source === 'binance' ? ticker.toUpperCase() : ticker,
    currency: typeof r.currency === 'string' && r.currency.trim() ? r.currency.trim().toUpperCase().slice(0, 6) : 'USD',
  };
}

export interface JarvisDeps {
  now?: () => number;
  env: EnvSource;
  fin: FinSource;
  core: CoreSource;
  links: LinksSource;
  config: { load(): JarvisConfig; save(config: JarvisConfig): void };
  reads: {
    /** Takvim kaynakları: hatırlatıcılar + görevler. */
    cal(): CalSources;
    notices(): HudNotice[];
    jobs(): HudJob[];
    address(): string | null;
    /** Bekleyen araç onayı sayısı. */
    approvals(): number;
  };
  /** Bağlantı denetimi hedefleri. */
  targets(): ProbeTarget[];
  emit(snapshot: HudSnapshot): void;
  /** Cihaz eklentilerine ileti (ses seviyesi, günlük satırı). Eklenti yoksa kimse dinlemez. */
  publish(msg: Record<string, unknown>): void;
  panic(): void;
  navigate(page: string): void;
  node: string;
  timeZone?: string;
  /** false: ağ/sistem kaynakları hiç çağrılmaz (sınama kipi); yalnız elle beslenen veri akar. */
  live: boolean;
}

export class JarvisService {
  readonly log: LogRing;
  readonly voice = new VoiceHudTracker();
  private auto = new AutoPalette();
  /** Otomatik palet durumunu sıfırlar (yalnız sınama: 2 dk bekleme olmadan düzey sahneleri). */
  resetAutoPalette(): void {
    this.auto = new AutoPalette();
  }
  private config: JarvisConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;
  private last: HudSnapshot | null = null;

  constructor(private readonly deps: JarvisDeps) {
    this.now = deps.now ?? Date.now;
    this.log = new LogRing(this.now, (entry) => this.onLog(entry));
    this.config = deps.config.load();
  }

  private readonly now: () => number;

  getConfig(): JarvisConfig {
    return this.config;
  }

  start(): void {
    if (this.timer) return;
    this.log.add('SYS', 'JARVIS hazır.');
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 1000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ───────── arka plan tazelemeleri ─────────

  private refreshSources(): Promise<unknown>[] {
    if (!this.deps.live) return [];
    const c = this.config;
    const jobs: Promise<unknown>[] = [
      this.deps.env.refresh(c.city),
      this.deps.fin.refresh(c.watchlist, c.focus),
      this.deps.links.refresh(),
    ];
    return jobs.map((p) => p.catch(() => undefined));
  }

  /** Saniyelik birleştirme (kaynaklar son bilinen halleriyle). */
  build(): HudSnapshot {
    const env = this.deps.env.current();
    const calSources = this.deps.reads.cal();
    const reminders = calSources.reminders;
    const links = buildLinks(this.deps.links.results());
    const fin = this.deps.fin.current(this.config.focus);
    const cal = buildCal(calSources, this.now());
    const notices = this.deps.reads.notices();
    const jobs = this.deps.reads.jobs();
    const overdue = overdueCount(reminders, this.now());
    const pending = { low: 0, normal: 0, high: 0, urgent: 0 };
    for (const n of notices) if (n.pending) pending[n.priority ?? 'normal'] += 1;
    const load = computeLoad({
      remainingToday: cal.items.filter((i) => (i.at ?? 0) >= this.now()).length,
      overdue,
      approvals: this.deps.reads.approvals(),
      pending,
      nextInSec: cal.nextInSec,
      jobs: jobs.length,
    });
    const stickyLevel = this.auto.update(load, this.now());
    // Elle seçimde gösterge ham düzeyi söyler (palet zaten elle); otomatikte histerezisli düzey paleti sürer.
    const level = this.config.paletteMode === 'auto' ? stickyLevel : load.rawLevel;
    const palette = this.config.paletteMode === 'auto' ? PALETTE_OF[level] : this.config.palette;
    const snapshot = buildSnapshot({
      now: this.now(),
      address: this.deps.reads.address(),
      node: this.deps.node,
      config: this.config,
      palette,
      load: { score: load.score, level, reasons: load.reasons },
      voice: { state: this.voice.state, ...(this.voice.text && this.voice.state !== 'idle' ? { text: this.voice.text } : {}) },
      env,
      cal,
      overdue,
      core: this.deps.core.sample(),
      fin,
      links,
      log: this.log.recent(),
      notices,
      jobs,
      seq: ++this.seq,
      ...(this.deps.timeZone ? { timeZone: this.deps.timeZone } : {}),
    });
    this.last = snapshot;
    return snapshot;
  }

  get(): HudSnapshot {
    return this.last ?? this.build();
  }

  /** Bir tur: kaynakları arka planda tazele, görüntüyü birleştir, yayınla. `wait`: tazelemeleri bekle (sınama). */
  async tick(wait = false): Promise<HudSnapshot> {
    const pending = this.refreshSources();
    if (wait) await Promise.all(pending);
    const snapshot = this.build();
    this.deps.emit(snapshot);
    return snapshot;
  }

  private onLog(entry: LogEntry): void {
    this.deps.publish({ t: 'hud.log', entry });
  }

  // ───────── ayar ─────────

  private commit(next: JarvisConfig): HudSnapshot {
    this.config = next;
    this.deps.config.save(next);
    const snap = this.build();
    this.deps.emit(snap);
    return snap;
  }

  setTab(tab: HudTab): HudSnapshot {
    if (!HUD_TABS.includes(tab)) return this.get();
    return tab === this.config.tab ? this.get() : this.commit({ ...this.config, tab });
  }

  /** `auto`: otomatiğe döner; bir palet adı elle seçimdir (otomatik kapanır). */
  setPalette(palette: HudPalette | 'auto'): HudSnapshot {
    if (palette === 'auto') {
      if (this.config.paletteMode === 'auto') return this.get();
      this.auto = new AutoPalette(); // elle kipten dönüşte güncel yoğunluğa hemen oturur
      return this.commit({ ...this.config, paletteMode: 'auto' });
    }
    if (!HUD_PALETTES.includes(palette)) return this.get();
    if (palette === this.config.palette && this.config.paletteMode === 'manual') return this.get();
    return this.commit({ ...this.config, palette, paletteMode: 'manual' });
  }

  setConfig(patch: { city?: string | null; watchlist?: unknown[]; focus?: string }): HudSnapshot {
    const raw: Record<string, unknown> = { ...this.config };
    if ('city' in patch) raw.city = patch.city;
    if (patch.watchlist) raw.watchlist = patch.watchlist;
    if (typeof patch.focus === 'string') raw.focus = patch.focus;
    const next = sanitizeConfig(raw);
    // Odak, listede olmayan bir sembolse ilkine döner.
    if (!next.watchlist.some((w) => w.sym === next.focus)) next.focus = next.watchlist[0]!.sym;
    const cityChanged = (next.city ?? '') !== (this.config.city ?? '');
    const snap = this.commit(next);
    if (this.deps.live) {
      if (cityChanged) void this.deps.env.refresh(next.city, true).catch(() => undefined);
      if (patch.watchlist) void this.deps.fin.refresh(next.watchlist, next.focus, true).catch(() => undefined);
    }
    return snap;
  }

  // ───────── ses (konuşma modu) ─────────

  private pushVoice(msg: HudVoiceMsg | null): void {
    if (msg) this.deps.publish({ ...msg });
  }

  /** Ses katmanı durumu değişti (voice.state). Görüntü ANINDA yollanır. */
  onVoiceState(state: string): void {
    const next = hudStateOf(state);
    if (next === this.voice.state) return;
    const msg = this.voice.setState(next, this.now());
    this.pushVoice(msg);
    const snap = this.build();
    this.deps.emit(snap);
  }

  /** Jarvis'in söylediği cümle (voice.partial, rol assistant). */
  onVoiceText(text: string): void {
    this.voice.setText(text);
  }

  /** Gerçek ses seviyesi (voice.level: rms 0..1). */
  onVoiceLevel(source: 'mic' | 'speaker', rms: number): void {
    this.pushVoice(this.voice.onRms(source, rms, this.now()));
  }

  // ───────── cihaz eklentileri ─────────

  /** Cihaz eklentisinden gelen ileti (`jarvis.deviceMessage`); yalnız `hud.action` işlenir. */
  onDeviceMessage(kind: string, msg: Record<string, unknown>): void {
    if (msg.t !== 'hud.action') return;
    switch (msg.action) {
      case 'tab':
        if (typeof msg.tab === 'string') this.setTab(msg.tab as HudTab);
        return;
      case 'palette':
        if (typeof msg.palette === 'string') this.setPalette(msg.palette as HudPalette | 'auto');
        return;
      case 'focus':
        if (typeof msg.sym === 'string' && this.config.watchlist.some((w) => w.sym === msg.sym)) this.commit({ ...this.config, focus: msg.sym });
        return;
      case 'open': {
        const ref = typeof msg.ref === 'string' ? msg.ref : '';
        if (ref.startsWith('cal:')) this.deps.navigate('planner');
        else if (ref.startsWith('notice:')) this.deps.navigate('today');
        else if (ref.startsWith('job:')) this.deps.navigate('watch');
        return;
      }
      case 'stop':
        this.log.add('SYS', `Acil durdurma: ${kind === 'watch' ? 'saatten' : 'gözlükten'} istendi.`);
        this.deps.panic();
        return;
    }
  }
}
