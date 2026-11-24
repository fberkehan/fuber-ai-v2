// Ortam dinleme boru hattı: sahte saat, sahte besleme (hazır metin bölütleri), sahte beyin. Gerçek mikrofon ve ses yok.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BrainExtractRequest, BrainRequest, BrainResponse, BrainStatus, BusEvents, NotifyRequest, Notification, Policy, PresenceState, ScheduleInput, ScheduledTask, SchedulerApi, Settings } from '@fuber/shared';
import { fakePolicy, fakePresence, fakeSettings, fakeVoice, loadModule, miniTools, moduleContext, silentLog, tempStore, testBus } from '../../core/brain/testkit';
import { createMemory } from '../../core/memory';
import { DecisionSchema, type Decision } from './companion';
import { createScriptFeed, parseScript, scriptSegment } from './feed';
import ambientModule from './index';
import { NoteExtractionSchema, type NoteExtraction } from './note-taker';
import { ReportSchema, type ReportDraft } from './reporter';
import { AMBIENT_MIGRATIONS, createAmbientRepo } from './repo';
import { createAmbient } from './service';

const START = new Date(2026, 10, 16, 10, 0, 0); // Pazartesi 10:00 (yerel)
const AMBIENT_ON: Policy['ambient'] = { allowed: true, maxInterjectionsPerHour: 3, minGapSeconds: 180, retentionDays: 7, interjections: 'on' };
const NO_NOTES: NoteExtraction = { notes: [], issues: [], facts: [] };
const SILENT: Decision = { speak: false, kind: 'info', text: '', confidence: 0, source: 0 };

interface KitOptions {
  ambient?: Partial<Policy['ambient']>;
  settings?: Partial<Settings>;
  consent?: boolean;
  feed?: { supported?: boolean; ready?: boolean };
  brainProvider?: BrainStatus['provider'];
}

function kit(options: KitOptions = {}) {
  const env = tempStore();
  env.store.migrate('ambient', AMBIENT_MIGRATIONS);
  const bus = testBus();
  let nowMs = START.getTime();
  const now = () => new Date(nowMs);
  const repo = createAmbientRepo(env.store.scoped('ambient'), now);
  const policy = fakePolicy({ ambient: { ...AMBIENT_ON, ...options.ambient } });
  const settings = fakeSettings(bus, options.settings);
  const presence = fakePresence();
  const voice = fakeVoice();
  let voiceState: ReturnType<typeof voice.status>['state'] = 'idle';
  const voiceStatus = voice.status.bind(voice);
  voice.status = () => ({ ...voiceStatus(), state: voiceState });
  const feed = createScriptFeed(options.feed);
  const memory = createMemory({ store: env.store, bus, log: silentLog });
  const tools = miniTools();
  const notifications: NotifyRequest[] = [];
  const deferred: Array<{ run: () => void; ms: number; cancelled: boolean }> = [];
  const extractCalls: Array<BrainExtractRequest<unknown>> = [];
  const answers = {
    notes: (_input: string): NoteExtraction | null => NO_NOTES,
    report: (_input: string): ReportDraft | null => ({ title: 'Gün', summary: 'Özet.', important: [], casual: [], decisions: [], open: [], next: [], joke: null }),
    decision: (_input: string): Decision | null | Promise<Decision | null> => SILENT,
  };
  let brainProvider = options.brainProvider ?? 'cloud';
  /** Konuşan beyin yoluna (`respond`) giden "söze girmeye değer mi" soruları. */
  const respondCalls: BrainRequest[] = [];
  const brain = {
    async respond(request: BrainRequest): Promise<BrainResponse> {
      respondCalls.push(request);
      const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0 };
      if (request.cloudOnly && brainProvider !== 'cloud') return { text: '', stopReason: 'error', error: 'bulut yok', toolCalls: [], usage };
      const decision = await answers.decision(request.text ?? '');
      return { text: decision ? JSON.stringify(decision) : 'anlaşılmadı', stopReason: 'end', error: null, toolCalls: [], usage };
    },
    async extract<T>(request: BrainExtractRequest<T>): Promise<T | null> {
      extractCalls.push(request as BrainExtractRequest<unknown>);
      const schema: unknown = request.schema;
      if (schema === NoteExtractionSchema) return answers.notes(request.input) as T | null;
      if (schema === ReportSchema) return answers.report(request.input) as T | null;
      if (schema === DecisionSchema) return (await answers.decision(request.input)) as T | null;
      throw new Error('beklenmeyen şema');
    },
    status: (): BrainStatus => ({ provider: brainProvider, reason: 'ok', cause: null, localReady: true, localModel: 'test', message: null }),
  };
  let locked = false;
  const service = createAmbient({
    repo,
    feed,
    brain,
    memory,
    attention: {
      notify(request) {
        notifications.push(request);
        return { id: `n${notifications.length}`, ...request } as unknown as Notification;
      },
    },
    policy,
    settings,
    presence,
    voice,
    tools,
    bus,
    log: silentLog,
    now,
    screenLocked: () => locked,
    defer(run, ms) {
      const entry = { run, ms, cancelled: false };
      deferred.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
  });
  if (options.consent !== false) service.consent(true);
  service.start();
  let counter = 0;
  const say = (text: string, extra: Record<string, unknown> = {}) => {
    const started = now();
    const durationMs = Math.max(600, Math.round((text.length / 14) * 1000));
    const segment = service.ingest({
      id: `t-${++counter}`,
      text,
      startedAt: started.toISOString(),
      endedAt: new Date(started.getTime() + durationMs).toISOString(),
      durationMs,
      source: 'mic',
      ...extra,
    });
    return segment;
  };
  return {
    env,
    bus,
    repo,
    policy,
    settings,
    presence,
    voice,
    feed,
    memory,
    tools,
    notifications,
    deferred,
    extractCalls,
    answers,
    service,
    now,
    say,
    advance(ms: number) {
      nowMs += ms;
    },
    setNow(date: Date) {
      nowMs = date.getTime();
    },
    setVoiceState(state: typeof voiceState) {
      voiceState = state;
    },
    setLocked(value: boolean) {
      locked = value;
      service.refresh();
    },
    setBrain(provider: BrainStatus['provider']) {
      brainProvider = provider;
    },
    setPresence(patch: Partial<PresenceState>) {
      presence.set(patch);
    },
    /** Bekleyen gecikmeli çağrıları (eşlikçi değerlendirmesi) koşturur. */
    async flushDeferred() {
      for (const entry of deferred.splice(0)) if (!entry.cancelled) entry.run();
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    },
    respondCalls,
    decisionCalls: () => respondCalls.length + extractCalls.filter((call) => (call.schema as unknown) === DecisionSchema).length,
    close() {
      service.stop();
      env.close();
    },
  };
}

type Kit = ReturnType<typeof kit>;
let active: Kit | null = null;
const make = (options?: KitOptions): Kit => {
  active = kit(options);
  return active;
};
afterEach(() => {
  active?.close();
  active = null;
});

describe('rıza ve dinleme', () => {
  it('kapalı gelir: rıza yokken dinlemez, ses hattına "aç" denmez, gelen söz yazılmaz', () => {
    const k = make({ consent: false });
    expect(k.service.status()).toMatchObject({ listening: false, reason: 'no_consent', consentAt: null });
    expect(k.service.status().prefs.enabled).toBe(false);
    expect(k.feed.enabled()).toBe(false);
    expect(k.say('Kaan yarın teklifi gönderecek')).toBeNull();
    k.feed.push({ id: 'x', text: 'besleme yine de yolladı', startedAt: k.now().toISOString(), endedAt: k.now().toISOString(), durationMs: 900, source: 'mic' });
    expect(k.repo.recentSegments(10)).toHaveLength(0);
  });

  it('rıza olmadan açılmaz: anahtar tek başına yetmez; Yönetim izni yokken rıza da verilemez', () => {
    const k = make({ consent: false });
    expect(() => k.service.setPrefs({ enabled: true })).toThrow(/rıza/);
    expect(k.service.status().listening).toBe(false);
    const blocked = make({ consent: false, ambient: { allowed: false } });
    expect(() => blocked.service.consent(true)).toThrow(/Fuber Yönetim/);
    expect(blocked.settings.get().ambientConsentAt).toBeNull();
    expect(blocked.service.status()).toMatchObject({ listening: false, reason: 'policy' });
    blocked.close();
  });

  it('rıza verilince dinler: rıza anı cihaza yazılır, ses hattı açılır, görünür bildirim ve durum olayı çıkar', () => {
    const k = make({ consent: false });
    const events: Array<BusEvents['ambient.status']> = [];
    k.bus.on('ambient.status', (status) => void events.push(status));
    const status = k.service.consent(true);
    expect(status).toMatchObject({ listening: true, reason: 'ok' });
    expect(k.settings.get().ambientConsentAt).toBe(k.now().toISOString());
    expect(k.feed.enabled()).toBe(true);
    expect(events.at(-1)).toMatchObject({ listening: true });
    expect(k.notifications.at(-1)).toMatchObject({ moduleId: 'ambient', title: 'Ortam dinleme açık', priority: 'normal' });
    expect(k.say('Kaan yarın teklifi gönderecek')).not.toBeNull();
  });

  it('gerçek ses hattı kipi değiştirince hemen `voice.status` yayınlar (yeniden giriş): açılış bildirimi yine BİR kez çıkar', () => {
    const k = make({ consent: false });
    // Gerçek hattın davranışı: `setAmbient` çağrısının içinde durum olayı yayınlanır.
    const setEnabled = k.feed.setEnabled.bind(k.feed);
    k.feed.setEnabled = (enabled) => {
      setEnabled(enabled);
      k.bus.emit('voice.status', k.voice.status());
    };
    const before = k.notifications.length;
    k.service.consent(true);
    expect(k.service.status().listening).toBe(true);
    expect(k.notifications.slice(before).filter((entry) => entry.title === 'Ortam dinleme açık')).toHaveLength(1);
    expect(k.feed.enabled()).toBe(true);
  });

  it('rıza geri alınınca kapanır; Yönetim izni kalkınca rıza olsa da dinlemez', () => {
    const k = make();
    k.service.consent(false);
    expect(k.settings.get().ambientConsentAt).toBeNull();
    expect(k.service.status()).toMatchObject({ listening: false, reason: 'no_consent' });
    expect(k.feed.enabled()).toBe(false);
    k.service.consent(true);
    k.policy.set({ ambient: { ...AMBIENT_ON, allowed: false } });
    k.bus.emit('policy.changed', { revision: 2, source: 'remote', changedKeys: ['ambient'] });
    expect(k.service.status()).toMatchObject({ listening: false, reason: 'policy' });
    expect(k.feed.enabled()).toBe(false);
    expect(k.say('izin kalktıktan sonra söylenen')).toBeNull();
  });

  it('"mikrofonu kapat", sessiz saatler, rahatsız etme, ekran kilidi ve acil durdurma ortam dinlemeyi de kapatır', () => {
    const k = make();
    k.voice.muteMic();
    k.bus.emit('voice.status', k.voice.status());
    expect(k.service.status().reason).toBe('mic_off');
    expect(k.feed.enabled()).toBe(false);
    expect(k.say('mikrofon kapalıyken')).toBeNull();
    k.voice.unmuteMic();
    k.bus.emit('voice.status', k.voice.status());
    expect(k.feed.enabled()).toBe(true);

    k.settings.update({ quietHours: { enabled: true, from: '09:00', to: '11:00' } });
    expect(k.service.status().reason).toBe('quiet_hours');
    expect(k.feed.enabled()).toBe(false);
    k.settings.update({ quietHours: { enabled: false, from: '09:00', to: '11:00' }, dnd: true });
    expect(k.service.status().reason).toBe('quiet_hours');
    k.settings.update({ dnd: false });
    expect(k.service.status().listening).toBe(true);

    k.setLocked(true);
    expect(k.service.status().reason).toBe('locked');
    expect(k.feed.enabled()).toBe(false);
    k.setLocked(false);

    k.policy.set({ killSwitch: { active: true } });
    expect(k.service.refresh().reason).toBe('kill_switch');
    expect(k.say('durdurulmuşken')).toBeNull();
    expect(k.repo.recentSegments(10)).toHaveLength(0);
  });

  it('"şimdi duraklat": süre boyunca yazmaz, dolunca kendiliğinden sürer; "bugün" gün bitimine dek', async () => {
    const k = make();
    expect(k.service.pause('15m')).toMatchObject({ listening: false, reason: 'paused' });
    expect(k.feed.enabled()).toBe(false);
    expect(k.say('duraklatılmışken söylenen')).toBeNull();
    k.advance(14 * 60_000);
    await k.service.tick();
    expect(k.service.status().reason).toBe('paused');
    k.advance(61_000);
    await k.service.tick();
    expect(k.service.status().listening).toBe(true);
    expect(k.feed.enabled()).toBe(true);

    expect(new Date(k.service.pause('today').pausedUntil!)).toEqual(new Date(2026, 10, 17, 0, 0, 0));
    expect(Date.parse(k.service.pause('1h').pausedUntil!) - k.now().getTime()).toBe(3_600_000);
    expect(k.service.pause(null)).toMatchObject({ listening: true, pausedUntil: null });
  });

  it('ses hattı sürekli dökümü desteklemiyorsa dürüstçe "döküm yok" der', () => {
    const k = make({ feed: { supported: false } });
    expect(k.service.status()).toMatchObject({ listening: false, reason: 'no_feed', feedSupported: false });
  });

  it('uyandırma sözüyle başlayan cümle, asistanın kendi sesi ve bozuk yük gün kaydına girmez', () => {
    const k = make();
    expect(k.say('Hey Jarvis yarın onda KDV beyannamesini hatırlat')).toBeNull();
    k.setVoiceState('speaking');
    expect(k.say('hatırlatıcıyı kurdum efendim')).toBeNull();
    k.setVoiceState('idle');
    expect(k.service.ingest({ id: 'bozuk', text: 'kaynağı belirsiz', startedAt: 'dün', endedAt: 'x', durationMs: 5, source: 'system' })).toBeNull();
    expect(k.service.ingest({ text: 'kimliksiz' })).toBeNull();
    expect(k.say('a')).toBeNull();
    expect(k.repo.recentSegments(10)).toHaveLength(0);
    const first = k.say('aynı bölüt iki kez gelirse', { id: 'ayni' })!;
    expect(k.service.ingest({ id: 'ayni', text: 'başka', startedAt: first.startedAt, endedAt: first.endedAt, durationMs: 1, source: 'mic' })).toBeNull();
    expect(k.repo.recentSegments(10)).toHaveLength(1);
  });
});

describe('ses diske yazılmaz', () => {
  const AUDIO_EXT = /\.(wav|pcm|raw|mp3|ogg|opus|webm|flac|m4a|aac)$/i;
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));

  it('yük ses taşısa da depoya yalnız metin girer; veri klasöründe ses dosyası, tablolarda ikili sütun yok', async () => {
    const k = make();
    const fakeAudio = Buffer.alloc(32_000, 7).toString('base64');
    const segment = k.say('Kaan yarın teklifi gönderecek', { pcm: fakeAudio, wav: `RIFF${fakeAudio}`, audio: { samples: [1, 2, 3] } })!;
    expect(Object.keys(segment).sort()).toEqual(['addressed', 'day', 'durationMs', 'endedAt', 'id', 'noted', 'startedAt', 'text']);
    await k.service.takeNotes();
    k.service.runRetention();

    const db = k.env.store.scoped('ambient');
    const tables = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'ambient_%' AND name NOT LIKE '%_fts%'");
    expect(tables.length).toBeGreaterThanOrEqual(7);
    for (const { name } of tables) {
      const columns = db.all<{ name: string; type: string }>(`PRAGMA table_info(${name})`);
      expect(columns.filter((column) => /blob/i.test(column.type)), name).toEqual([]);
      for (const row of db.all<Record<string, unknown>>(`SELECT * FROM ${name}`)) {
        for (const value of Object.values(row)) {
          expect(value instanceof Uint8Array, `${name}: ikili değer`).toBe(false);
          expect(String(value ?? '').includes(fakeAudio.slice(0, 64)), `${name}: ses verisi`).toBe(false);
        }
      }
    }
    const files = walk(k.env.dir);
    expect(files.filter((file) => AUDIO_EXT.test(file))).toEqual([]);
    for (const file of files) {
      const head = Buffer.alloc(12);
      const handle = fs.openSync(file, 'r');
      fs.readSync(handle, head, 0, 12, 0);
      fs.closeSync(handle);
      expect(head.subarray(0, 4).toString('latin1') === 'RIFF' || head.subarray(0, 4).toString('latin1') === 'OggS', file).toBe(false);
    }
  });

  it('modül kaynağı dosya yazmaz ve ses hattının içine uzanmaz', () => {
    const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
    const sources = fs.readdirSync(decodeURIComponent(dir)).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
    expect(sources.length).toBeGreaterThan(8);
    for (const name of sources) {
      const code = fs.readFileSync(path.join(decodeURIComponent(dir), name), 'utf8');
      expect(/from 'node:fs'|require\('fs'\)|writeFile|createWriteStream|appendFile/.test(code), `${name}: dosya yazımı`).toBe(false);
      expect(/from '\.\.\/\.\.\/voice\/|from '\.\.\/\.\.\/\.\.\/worker\/|getUserMedia|MediaRecorder/.test(code), `${name}: ses hattı`).toBe(false);
    }
  });
});

const MEETING = `
[00:05] Günaydın, bugün Atlas teklifini konuşmamız lazım.
[00:20] Kaan fiyatı yüzde on indirirsek kabul edeceklerini söyledi.
[00:45] Tamam, yüzde on indirime karar verelim o zaman.
[01:30] Ben yarın Kaan'ı arayacağım, teklifin son halini iletirim.
[02:10] Bu arada öğlen ne yiyoruz, çiğ köfte mi söylesek?
[02:25] Yok, geçen sefer midem ağrıdı, bir daha çiğ köfte yemeyelim.
[04:00] Sözleşme taslağı masaüstündeki Atlas klasöründe duruyor.
[06:30] Muhasebeci Ayşe Hanım cuma günü evrakları bekliyor.
[08:15] Toplantıyı perşembe saat üçe alalım.
[09:40] Tamam, perşembe üçte görüşürüz.
`;

/** Dökümü sahte saatle besler; her satır kendi anında gelir. */
function feedScript(k: Kit, script: string): number {
  const lines = parseScript(script);
  const base = k.now();
  lines.forEach((line, index) => {
    k.setNow(new Date(base.getTime() + line.at * 1000));
    k.service.ingest(scriptSegment(line, base, index));
  });
  return lines.length;
}

describe('döküm → not → mesele', () => {
  it('10 dakikalık dökümden not ve mesele çıkar; her kayıt hangi satırdan geldiğini bilir', async () => {
    const k = make();
    k.answers.notes = (input) => {
      expect(input).toContain('Tarih: Pazartesi 2026-11-16');
      expect(input).toContain('Önümüzdeki günler: Salı 2026-11-17');
      expect(input).toMatch(/4 \[10:01\] Ben yarın Kaan'ı arayacağım/);
      return {
        notes: [
          { text: 'Atlas teklifinde yüzde on indirime karar verildi.', kind: 'decision', important: true, people: ['Kaan', 'Mahmut'], lines: [2, 3], sure: true },
          { text: 'Bir daha çiğ köfte yenmeyecek.', kind: 'chat', important: false, people: [], lines: [6], sure: true },
          { text: 'Toplantı perşembe saat üçe alındı.', kind: 'decision', important: true, people: [], lines: [9, 99], sure: false },
          { text: 'Kripto cüzdanına yatırım yapılacak.', kind: 'info', important: true, people: [], lines: [1], sure: true },
        ],
        issues: [{ title: 'Kaan aranacak, teklifin son hali iletilecek', person: 'Kaan', due: '2026-11-17', closes: null, line: 4 }],
        facts: [{ text: 'Muhasebeci Ayşe Hanım evrakları cuma günleri bekliyor.', subject: 'Ayşe Hanım', line: 8 }],
      };
    };
    expect(feedScript(k, MEETING)).toBe(10);
    k.advance(4 * 60_000); // son sözden sonra sessizlik: dönem kapanır
    await k.service.tick();

    const notes = k.repo.notesOfDay('2026-11-16');
    expect(notes.map((note) => note.text)).toEqual([
      'Atlas teklifinde yüzde on indirime karar verildi.',
      'Bir daha çiğ köfte yenmeyecek.',
      'Toplantı perşembe saat üçe alındı.',
    ]);
    const segments = k.repo.segmentsOfDay('2026-11-16');
    expect(segments).toHaveLength(10);
    expect(segments.every((segment) => segment.noted)).toBe(true);
    // Kaynak gösterimi: not, dayandığı döküm satırlarını ve zaman aralığını taşır.
    expect(notes[0]!.sourceIds).toEqual([segments[1]!.id, segments[2]!.id]);
    expect(k.repo.segmentsByIds(notes[0]!.sourceIds).map((segment) => segment.text)[0]).toContain('yüzde on indirirsek');
    expect(notes[0]!.sourceFrom).toBe(segments[1]!.startedAt);
    // Dürüstlük: dökümde geçmeyen kişi düşer, uydurma not yazılmaz, modelin emin olmadığı not "sanırım" taşır.
    expect(notes[0]!.people).toEqual(['Kaan']);
    expect(notes.some((note) => note.text.includes('Kripto'))).toBe(false);
    expect(notes[2]).toMatchObject({ unsure: true, sourceIds: [segments[8]!.id] });
    expect(notes[0]!.unsure).toBe(false);
    // Saklama: önemli not 30 gün, gündelik not 7 gün.
    expect(new Date(notes[0]!.expiresAt).getDate()).toBe(16);
    expect(new Date(notes[0]!.expiresAt).getMonth()).toBe(11);
    expect(new Date(notes[1]!.expiresAt).getDate()).toBe(23);

    const issues = k.repo.listIssues('open');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ title: 'Kaan aranacak, teklifin son hali iletilecek', person: 'Kaan', dueDay: '2026-11-17', unsure: false, sourceIds: [segments[3]!.id] });
    // Hatırlatıcıya çevirme ÖNERİSİ: düşük öncelikli bildirim, eylem düğmesiyle.
    expect(k.notifications.at(-1)).toMatchObject({ priority: 'low', data: { issueId: issues[0]!.id }, actions: [{ id: 'remind' }, { id: 'skip' }] });
    // Kalıcı bilgi hafızaya yazılmaz, öneri olur.
    expect(k.repo.listSuggestions('pending').map((entry) => entry.text)).toEqual(['Muhasebeci Ayşe Hanım evrakları cuma günleri bekliyor.']);
    expect(k.memory.stats().facts).toBe(0);
  });

  it('model sözü atlasa da "arayacağım" satırı mesele olur ("sanırım"); söz notu meseleye çevrilir', async () => {
    const k = make();
    k.answers.notes = () => ({
      notes: [{ text: 'Mehmet cumaya kadar raporu gönderecek.', kind: 'promise', important: true, people: ['Mehmet'], lines: [2], sure: true }],
      issues: [],
      facts: [],
    });
    k.say("Ben yarın Kaan'ı arayacağım teklif için");
    k.say('Mehmet cumaya kadar raporu gönderecek dedi');
    k.say('Hava da bugün ne güzel açtı değil mi');
    const result = await k.service.takeNotes();
    expect(result.issues.map((issue) => [issue.title, issue.unsure])).toEqual([
      ['Mehmet cumaya kadar raporu gönderecek.', false],
      ["Ben yarın Kaan'ı arayacağım teklif için", true],
    ]);
  });

  it('aynı iş yeniden konuşulunca yeni mesele açılmaz; döküm işi bitirdiyse mesele kapanır', async () => {
    const k = make();
    k.answers.notes = () => ({ notes: [], issues: [{ title: 'Ali kira sözleşmesini gönderecek', person: 'Ali', due: null, closes: null, line: 1 }], facts: [] });
    k.say('Ali kira sözleşmesini cumartesi gönderecekmiş');
    await k.service.takeNotes();
    k.answers.notes = () => ({ notes: [], issues: [{ title: 'Ali kira sözleşmesini cumartesi gönderecek', person: 'Ali', due: '2026-11-21', closes: null, line: 1 }], facts: [] });
    k.advance(60_000);
    k.say('Ali sözleşmeyi cumartesi gönderecek, unutmayalım bunu');
    await k.service.takeNotes();
    expect(k.repo.listIssues('open')).toHaveLength(1);
    expect(k.repo.listIssues('open')[0]).toMatchObject({ dueDay: '2026-11-21' });
    expect(k.repo.listIssues('open')[0]!.sourceIds).toHaveLength(2);

    k.answers.notes = (input) => {
      expect(input).toContain('Açık meseleler:\n1. Ali kira sözleşmesini gönderecek (Ali)');
      return { notes: [], issues: [{ title: 'Ali sözleşmeyi gönderdi', person: 'Ali', due: null, closes: 1, line: 1 }], facts: [] };
    };
    k.advance(60_000);
    k.say('Ali kira sözleşmesini gönderdi, geldi az önce');
    const result = await k.service.takeNotes();
    expect(result.closed).toHaveLength(1);
    expect(k.repo.listIssues('open')).toHaveLength(0);
    expect(k.repo.listIssues('closed')[0]).toMatchObject({ status: 'done' });
  });

  it('model yanıt veremezse döküm bekler: kısa kesinti notu yakmaz; beş dakikada bir yeniden denenir', async () => {
    const k = make();
    k.answers.notes = () => null;
    k.say('Toplantıda bütçeyi yüz bin lira olarak onayladık');
    expect((await k.service.takeNotes()).failed).toBe(true);
    // Yoklama 30 saniyede bir gelir; model her seferinde yeniden çağrılmaz.
    for (let index = 0; index < 6; index++) {
      k.advance(30_000);
      await k.service.tick();
    }
    expect(k.extractCalls).toHaveLength(1);
    expect(k.repo.pendingSegments(10)).toHaveLength(1);
    // Beyin geri gelince bekleyen döküm notlanır.
    k.answers.notes = () => ({ notes: [{ text: 'Bütçe yüz bin lira olarak onaylandı.', kind: 'decision', important: true, people: [], lines: [1], sure: true }], issues: [], facts: [] });
    k.advance(3 * 60_000);
    await k.service.tick();
    expect(k.repo.notesOfDay('2026-11-16')).toHaveLength(1);
  });

  it('model yarım saat boyunca üç denemede de çıkaramazsa parti atlanır; döküm aranabilir kalır', async () => {
    const k = make();
    k.answers.notes = () => null;
    k.say('Toplantıda bütçeyi yüz bin lira olarak onayladık');
    await k.service.takeNotes();
    k.advance(6 * 60_000);
    await k.service.takeNotes();
    k.advance(6 * 60_000);
    await k.service.takeNotes();
    expect(k.repo.pendingSegments(10)).toHaveLength(1); // üç deneme oldu ama yarım saat dolmadı
    k.advance(20 * 60_000);
    await k.service.takeNotes();
    expect(k.repo.pendingSegments(10)).toHaveLength(0);
    expect(k.repo.notesOfDay('2026-11-16')).toHaveLength(0);
    expect(k.repo.searchSegments('bütçe', 5)).toHaveLength(1);
  });
});

describe('saklama ve silme', () => {
  it('ham döküm 7 günden uzun yaşamaz: zamanlanmış saklama görevi eskiyi siler, yeniyi bırakır', async () => {
    const k = make();
    k.answers.notes = () => ({ notes: [{ text: 'Bütçe yüz bin lira olarak onaylandı.', kind: 'decision', important: true, people: [], lines: [1], sure: true }], issues: [], facts: [] });
    k.say('Bütçeyi yüz bin lira olarak onayladık');
    await k.service.takeNotes();
    k.advance(3 * 86_400_000);
    k.say('Üç gün sonra söylenen ve henüz notlanmamış söz');
    k.advance(3 * 86_400_000 + 23 * 3_600_000); // ilk satır 6 gün 23 saatlik
    expect(k.service.runRetention().segments).toBe(0);
    k.advance(2 * 3_600_000); // 7 gün 1 saat
    expect(k.service.runRetention()).toMatchObject({ segments: 1, notes: 0 });
    expect(k.repo.recentSegments(10).map((segment) => segment.text)).toEqual(['Üç gün sonra söylenen ve henüz notlanmamış söz']);
    expect(k.repo.searchSegments('bütçe', 5)).toHaveLength(0);
    // Not (önemli: 30 gün) durur; kaynak satırı silinmiş olsa da zaman aralığını taşır.
    const note = k.repo.notesOfDay('2026-11-16')[0]!;
    expect(k.repo.segmentsByIds(note.sourceIds)).toEqual([]);
    expect(note.sourceFrom).toBeTruthy();
    // Notlanmamış satır da süresi dolunca silinir (saklama sözü model beklemeden tutulur).
    k.advance(4 * 86_400_000);
    expect(k.service.runRetention().segments).toBe(1);
    expect(k.repo.recentSegments(10)).toHaveLength(0);
  });

  it('saklama süresi politikadan kısaltılır; 7 günden uzun değer 7 güne kırpılır', () => {
    const short = make({ ambient: { retentionDays: 2 } });
    short.say('iki gün saklanacak söz');
    short.advance(2 * 86_400_000 + 60_000);
    expect(short.service.runRetention().segments).toBe(1);
    short.close();
    const long = make({ ambient: { retentionDays: 30 } });
    expect(long.service.status().limits.retentionDays).toBe(7);
    long.say('yedi günden fazla saklanamaz');
    long.advance(7 * 86_400_000 + 60_000);
    expect(long.service.runRetention().segments).toBe(1);
  });

  it('gündelik not 7, önemli not 30 gün sonra silinir', async () => {
    const k = make();
    k.answers.notes = () => ({
      notes: [
        { text: 'Bütçe onaylandı.', kind: 'decision', important: true, people: [], lines: [1], sure: true },
        { text: 'Öğlen çiğ köfte yendi.', kind: 'chat', important: false, people: [], lines: [2], sure: true },
      ],
      issues: [],
      facts: [],
    });
    k.say('Bütçeyi onayladık bugün');
    k.say('Öğlen çiğ köfte yedik çok acıydı');
    await k.service.takeNotes();
    k.advance(8 * 86_400_000);
    expect(k.service.runRetention().notes).toBe(1);
    expect(k.env.store.scoped('ambient').all('SELECT text FROM ambient_notes')).toEqual([{ text: 'Bütçe onaylandı.' }]);
    k.advance(23 * 86_400_000);
    expect(k.service.runRetention().notes).toBe(1);
  });

  it('"son 10 dakikayı sil": döküm ve ondan türeyen not, mesele, öneri gider; öncesi kalır', async () => {
    const k = make();
    k.answers.notes = (input) =>
      input.includes('özel')
        ? {
            notes: [{ text: 'Özel bir sağlık konusu konuşuldu.', kind: 'info', important: true, people: [], lines: [1], sure: true }],
            issues: [{ title: 'Doktordan özel randevu alınacak', person: null, due: null, closes: null, line: 1 }],
            facts: [{ text: 'Kullanıcının özel bir sağlık konusu var, doktor randevusu alacak.', subject: null, line: 1 }],
          }
        : { notes: [{ text: 'Bütçe onaylandı.', kind: 'decision', important: true, people: [], lines: [1], sure: true }], issues: [], facts: [] };
    k.say('Bütçeyi bugün yüz bin lira olarak onayladık');
    await k.service.takeNotes();
    k.advance(30 * 60_000);
    k.say('Bu özel bir sağlık konusu, doktordan randevu alacağım');
    await k.service.takeNotes();
    expect(k.repo.notesOfDay('2026-11-16')).toHaveLength(2);
    k.advance(5 * 60_000);
    k.say('henüz notlanmamış bir cümle daha');

    const removed = k.service.forgetRecent(10);
    expect(removed).toEqual({ segments: 2, notes: 1, issues: 1 });
    expect(k.repo.recentSegments(10).map((segment) => segment.text)).toEqual(['Bütçeyi bugün yüz bin lira olarak onayladık']);
    expect(k.repo.notesOfDay('2026-11-16').map((note) => note.text)).toEqual(['Bütçe onaylandı.']);
    expect(k.repo.listIssues('all')).toHaveLength(0);
    expect(k.repo.listSuggestions()).toHaveLength(0);
    expect(k.repo.searchSegments('sağlık doktor', 5)).toHaveLength(0);
    expect(k.repo.searchNotes('sağlık', 5)).toHaveLength(0);
    expect(k.deferred.every((entry) => entry.cancelled)).toBe(true);
  });

  it('"hepsini sil": döküm, not, mesele, rapor, öneri, araya girme kalmaz; tercihler ve rıza durur', async () => {
    const k = make();
    k.answers.notes = () => ({
      notes: [{ text: 'Bütçe onaylandı.', kind: 'decision', important: true, people: [], lines: [1], sure: true }],
      issues: [{ title: 'Bütçe tablosu gönderilecek', person: null, due: null, closes: null, line: 1 }],
      facts: [],
    });
    k.say('Bütçeyi onayladık, tabloyu göndereceğim');
    await k.service.buildReport('daily');
    k.service.setPrefs({ companionVoice: true });
    k.service.deleteAll();
    const db = k.env.store.scoped('ambient');
    for (const table of ['segments', 'segments_fts', 'notes', 'notes_fts', 'issues', 'reports', 'reports_fts', 'interjections', 'suggestions']) {
      expect(db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ambient_${table}`)!.n, table).toBe(0);
    }
    expect(k.service.status().prefs).toMatchObject({ enabled: true, companionVoice: true });
    expect(k.settings.get().ambientConsentAt).not.toBeNull();
  });
});

describe('eşlikçi', () => {
  /** İki gün önce alınmış bir karar notu: bugünkü söz onunla çelişecek. */
  function withOldDecision(k: Kit) {
    const old = new Date(k.now().getTime() - 2 * 86_400_000);
    return k.repo.addNote({
      day: '2026-11-14',
      at: old.toISOString(),
      text: 'Bir daha çiğ köfte yenmeyecek, mide ağrıttı.',
      important: true,
      kind: 'decision',
      people: [],
      unsure: false,
      sourceIds: ['eski-1'],
      sourceFrom: old.toISOString(),
      sourceTo: old.toISOString(),
      expiresAt: new Date(k.now().getTime() + 20 * 86_400_000).toISOString(),
    });
  }
  const REMIND: Decision = { speak: true, kind: 'reminder', text: 'Efendim, iki gün önce bir daha çiğ köfte yemeyeceğiz demiştiniz.', confidence: 0.9, source: 1 };
  /** Yerel modelin bir sözden çıkardığı ÖNEMLİ not (model olmadan, doğrudan depoya). */
  function noteFromSpeech(k: Kit, said: string, noteText = said) {
    const segment = k.say(said)!;
    return k.repo.addNote({
      day: segment.day,
      at: segment.startedAt,
      text: noteText,
      important: true,
      kind: 'decision',
      people: [],
      unsure: false,
      sourceIds: [segment.id],
      sourceFrom: segment.startedAt,
      sourceTo: segment.endedAt,
      expiresAt: new Date(k.now().getTime() + 30 * 86_400_000).toISOString(),
    });
  }
  /** Söz söylenir, yerel model önemli not çıkarır, sessizlik dolar, eşlikçi değerlendirir. */
  async function sayAndSettle(k: Kit, said: string, noteText = said) {
    noteFromSpeech(k, said, noteText);
    k.advance(3000);
    return k.service.evaluateCompanion();
  }
  const importantNote = (text: string): NoteExtraction => ({ notes: [{ text, kind: 'decision', important: true, people: [], lines: [1], sure: true }], issues: [], facts: [] });

  it('önemli not yoksa ya da iz yoksa model hiç çağrılmaz; iz ve güvenli karar varsa Dikkat Yöneticisi üzerinden küçük ada bildirimi olur', async () => {
    const k = make();
    k.say('Bugün hava ne güzel, biraz yürüyelim mi');
    k.advance(3000);
    await k.flushDeferred();
    expect(await k.service.evaluateCompanion()).toBe('no_new');
    expect(await sayAndSettle(k, 'Bugün hava ne güzel, biraz yürüyelim mi')).toBe('no_trace');
    expect(k.decisionCalls()).toBe(0);

    const note = withOldDecision(k);
    k.answers.decision = (input) => {
      expect(input).toContain('Yeni notlar');
      expect(input).toMatch(/1\. \[not · 2 gün önce 10:00\] Bir daha çiğ köfte yenmeyecek/);
      return REMIND;
    };
    k.advance(60_000);
    expect(await sayAndSettle(k, 'Öğlen çiğ köfte söyleyelim mi ne dersiniz')).toBe('spoke');
    expect(k.decisionCalls()).toBe(1);
    const sent = k.notifications.at(-1)!;
    // `high` + seslendirme yok: Dikkat Yöneticisi bunu yalnız adada gösterir (sessiz).
    expect(sent).toMatchObject({ moduleId: 'ambient', title: 'Jarvis', body: REMIND.text, priority: 'high', speak: false });
    expect(k.repo.recentInterjections(5)).toMatchObject([{ kind: 'reminder', sources: [`N-${note.id}`], voiced: false }]);
    expect(k.service.status().today.interjections).toBe(1);
  });

  it('uçtan uca: yerel model önemli not çıkarınca eşlikçi kendiliğinden uyanır; gündelik notta uyanmaz', async () => {
    const k = make();
    withOldDecision(k);
    k.answers.decision = () => REMIND;
    k.answers.notes = () => ({ notes: [{ text: 'Öğlen çiğ köfte konuşuldu.', kind: 'chat', important: false, people: [], lines: [1], sure: true }], issues: [], facts: [] });
    k.say('Öğlen çiğ köfte yiyelim mi bugün');
    k.advance(3000);
    await k.service.takeNotes(true);
    await k.flushDeferred();
    expect(k.decisionCalls()).toBe(0);

    k.answers.notes = () => importantNote('Öğlen yine çiğ köfte yenmesi önerildi.');
    k.advance(60_000);
    k.say('Öğlen yine çiğ köfte yiyelim diyorum');
    k.advance(3000);
    await k.service.takeNotes(true);
    await k.flushDeferred();
    expect(k.decisionCalls()).toBe(1);
    expect(k.repo.recentInterjections(5)).toHaveLength(1);
  });

  it('buluta giden "söze girmeye değer mi" isteğinde ham döküm yok: yalnız yerel modelin kısa notları', async () => {
    const k = make({ ambient: { interjections: 'cloud-only' }, brainProvider: 'cloud' });
    withOldDecision(k);
    k.answers.decision = () => REMIND;
    const RAW = 'Arkadaşlar öğlen çiğ köfte söyleyelim mi, ben çok acıktım, Kadıköy şubesi iyi';
    k.answers.notes = () => importantNote('Öğlen çiğ köfte söylenmesi önerildi.');
    k.say('Dün akşam Ayşe ile uzun uzun telefonda konuştuk çok güldük');
    k.say(RAW);
    k.advance(3000);
    await k.service.takeNotes(true);
    await k.flushDeferred();
    expect(k.respondCalls).toHaveLength(1);
    const request = k.respondCalls[0]!;
    // Konuşan beyin yolu (Claude Code → Anthropic), kişiliksiz, araçsız, yerel modele düşmeden.
    expect(request).toMatchObject({ role: 'voice', persona: false, tools: 'none', cloudOnly: true });
    const body = `${request.instructions ?? ''}\n${request.text ?? ''}`;
    expect(body).toContain('Öğlen çiğ köfte söylenmesi önerildi.');
    for (const segment of k.repo.recentSegments(20)) expect(body).not.toContain(segment.text);
    expect(body).not.toMatch(/Kadıköy|acıktım|telefonda/);
    // Ortam çağrılarından hiçbiri buluta çıkarım yaptırmaz: hepsi yerel.
    expect(k.extractCalls.every((call) => call.localOnly === true)).toBe(true);
  });

  it('kip "açık" ve beyin yerelde: karar bu bilgisayardaki modelde (localOnly); bulut yolu hiç denenmez', async () => {
    const k = make({ ambient: { interjections: 'on' }, brainProvider: 'local' });
    withOldDecision(k);
    k.answers.decision = () => REMIND;
    expect(await sayAndSettle(k, 'Öğlen çiğ köfte söyleyelim mi')).toBe('spoke');
    expect(k.respondCalls).toHaveLength(0);
    const decisions = k.extractCalls.filter((call) => (call.schema as unknown) === DecisionSchema);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.localOnly).toBe(true);
  });

  it('sesli söyleme kullanıcının seçimidir; sessiz kipte seçili olsa da yazıyla kalır', async () => {
    const k = make();
    withOldDecision(k);
    k.answers.decision = () => REMIND;
    k.service.setPrefs({ companionVoice: true });
    await sayAndSettle(k, 'Öğlen çiğ köfte söyleyelim mi');
    expect(k.notifications.at(-1)).toMatchObject({ priority: 'high', speak: REMIND.text });

    const quiet = make();
    withOldDecision(quiet);
    quiet.answers.decision = () => REMIND;
    quiet.service.setPrefs({ companionVoice: true });
    quiet.voice.setQuiet(true);
    await sayAndSettle(quiet, 'Öğlen çiğ köfte söyleyelim mi');
    expect(quiet.notifications.at(-1)).toMatchObject({ speak: false });
    quiet.close();
  });

  it.each([
    ['toplantıda (mikrofon başka uygulamada)', (k: Kit): void => k.setPresence({ micInUseByOther: true, meeting: true, mode: 'meeting' }), 'meeting'],
    ['tam ekranda', (k: Kit): void => k.setPresence({ fullscreen: true, mode: 'fullscreen' }), 'fullscreen'],
    ['eşlikçi kullanıcıca kapalıyken', (k: Kit): void => void k.service.setPrefs({ companion: false }), 'user_off'],
    ['politika "kapalı" iken', (k: Kit): void => k.policy.set({ ambient: { ...AMBIENT_ON, interjections: 'off' } }), 'policy_off'],
    [
      'politika "yalnız bulut" ve beyin yereldeyken',
      (k: Kit): void => {
        k.policy.set({ ambient: { ...AMBIENT_ON, interjections: 'cloud-only' } });
        k.setBrain('local');
      },
      'needs_cloud',
    ],
    ['sesli tur sürerken', (k: Kit): void => k.setVoiceState('listening'), 'user_speaking'],
  ] as const)('%s araya girmez ve modeli çağırmaz', async (_name, arrange, reason) => {
    const k = make();
    withOldDecision(k);
    k.answers.decision = () => REMIND;
    arrange(k);
    expect(await sayAndSettle(k, 'Öğlen çiğ köfte söyleyelim mi')).toBe(reason);
    await k.flushDeferred();
    expect(k.decisionCalls()).toBe(0);
    expect(k.notifications.filter((entry) => entry.priority === 'high')).toHaveLength(0);
  });

  it('yalnız bulut kipinde bulut beyni çalışıyorsa araya girer', async () => {
    const k = make({ ambient: { interjections: 'cloud-only' }, brainProvider: 'cloud' });
    withOldDecision(k);
    k.answers.decision = () => REMIND;
    expect(await sayAndSettle(k, 'Öğlen çiğ köfte söyleyelim mi')).toBe('spoke');
    expect(k.repo.recentInterjections(5)).toHaveLength(1);
    // Aralık beklemesi geçici bir durumdur: eşlikçi "etkin" görünür, nedenini de söyler.
    expect(k.service.status().companion).toEqual({ active: true, reason: 'min_gap' });
    k.setBrain('local');
    expect(k.service.status().companion).toEqual({ active: false, reason: 'needs_cloud' });
  });

  it('kullanıcı konuşurken girmez: söz sürüyorsa bekler (not sırada kalır); model düşünürken yeni söz gelirse vazgeçer', async () => {
    const k = make();
    withOldDecision(k);
    k.answers.decision = () => REMIND;
    noteFromSpeech(k, 'Öğlen çiğ köfte söyleyelim mi');
    k.advance(500);
    expect(await k.service.evaluateCompanion()).toBe('user_speaking');
    expect(k.decisionCalls()).toBe(0);

    let release: (value: Decision) => void = () => {};
    k.answers.decision = () => new Promise<Decision>((resolve) => (release = resolve));
    k.advance(3000);
    const pending = k.service.evaluateCompanion();
    await new Promise((resolve) => setImmediate(resolve));
    expect(await k.service.evaluateCompanion()).toBe('busy');
    k.say('ya da lahmacun mu alsak acaba');
    release(REMIND);
    expect(await pending).toBe('user_speaking');
    expect(k.repo.recentInterjections(5)).toHaveLength(0);
  });

  it('model düşünürken toplantı başlarsa teslimden önce yeniden sorulan kapı durdurur', async () => {
    const k = make();
    withOldDecision(k);
    let release: (value: Decision) => void = () => {};
    k.answers.decision = () => new Promise<Decision>((resolve) => (release = resolve));
    noteFromSpeech(k, 'Öğlen çiğ köfte söyleyelim mi');
    k.advance(3000);
    const pending = k.service.evaluateCompanion();
    await new Promise((resolve) => setImmediate(resolve));
    k.setPresence({ meeting: true, micInUseByOther: true });
    release(REMIND);
    expect(await pending).toBe('meeting');
    expect(k.notifications.filter((entry) => entry.priority === 'high')).toHaveLength(0);
  });

  it('saatte en çok N ve aralarında en az 3 dakika; bir saat geçince yeniden açılır', async () => {
    const k = make({ ambient: { maxInterjectionsPerHour: 2 } });
    const topics = ['çiğ köfte', 'kira sözleşmesi', 'sunucu faturası'];
    const old = new Date(k.now().getTime() - 2 * 86_400_000).toISOString();
    for (const topic of topics) {
      k.repo.addNote({ day: '2026-11-14', at: old, text: `${topic} konusunda karar: bir daha yapılmayacak.`, important: true, kind: 'decision', people: [], unsure: false, sourceIds: [`e-${topic}`], sourceFrom: old, sourceTo: old, expiresAt: new Date(k.now().getTime() + 9e8).toISOString() });
    }
    const lines: Record<string, string> = {
      'çiğ köfte': 'Efendim, çiğ köfte için iki gün önce bir daha yemeyelim demiştiniz.',
      'kira sözleşmesi': 'Kira sözleşmesi konusunda vazgeçme kararı almıştınız, hatırlatırım.',
      'sunucu faturası': 'Sunucu faturası için karar: artık ödenmeyecekti.',
    };
    k.answers.decision = (input) => {
      // Yeni notlar hangi konudaysa onun dayanağı gösterilir.
      const said = input.split('Dayanaklar:')[0]!.split('Son bir saatin öteki notları')[0]!;
      const topic = [...topics].sort((a, b) => said.lastIndexOf(b) - said.lastIndexOf(a))[0]!;
      // "Dayanaklar:" başlığından sonraki satırlar 1'den numaralıdır; baştaki boş satır dizini 1'e hizalar.
      const source = input.split('Dayanaklar:')[1]!.split(/\r?\n/).findIndex((line) => line.includes(topic));
      return { speak: true, kind: 'reminder', text: lines[topic]!, confidence: 0.9, source };
    };
    expect(await sayAndSettle(k, 'bugün çiğ köfte yiyelim mi')).toBe('spoke');
    // Aralık dolmadan ikinci konu: girmez, beyne de sorulmaz.
    k.advance(60_000);
    expect(await sayAndSettle(k, 'kira sözleşmesi imzalayalım mı')).toBe('min_gap');
    expect(k.decisionCalls()).toBe(1);
    // Aralık dolunca başka konu: girer (saatte ikinci).
    k.advance(4 * 60_000);
    expect(await sayAndSettle(k, 'kira sözleşmesi yapalım mı')).toBe('spoke');
    // Üçüncü konu, aralık dolmuş ama saatlik sınır dolu.
    k.advance(4 * 60_000);
    expect(await sayAndSettle(k, 'sunucu faturası ödeyelim mi')).toBe('hourly_limit');
    expect(k.decisionCalls()).toBe(2);
    // Bir saat geçince yeniden açılır.
    k.advance(60 * 60_000);
    expect(await sayAndSettle(k, 'şu sunucu faturası ne oldu ödeyelim mi')).toBe('spoke');
    expect(k.repo.recentInterjections(9)).toHaveLength(3);
  });

  it('bulut kotası: "değmez" yanıtı da saatlik sınıra sayılır; sınır dolunca beyne sorulmaz', async () => {
    const k = make({ ambient: { maxInterjectionsPerHour: 2, minGapSeconds: 0 } });
    withOldDecision(k);
    k.answers.decision = () => SILENT;
    expect(await sayAndSettle(k, 'öğlen çiğ köfte yiyelim mi')).toBe('silent');
    k.advance(6 * 60_000);
    expect(await sayAndSettle(k, 'akşam da çiğ köfte olur mu')).toBe('silent');
    k.advance(6 * 60_000);
    expect(await sayAndSettle(k, 'yarın yine çiğ köfte alalım')).toBe('hourly_limit');
    expect(k.decisionCalls()).toBe(2);
    expect(k.repo.recentInterjections(5)).toHaveLength(0);
  });

  it('aynı kayda dayanarak bir hafta içinde ikinci kez girmez: o kayıt dayanak olarak gösterilmez, beyne boşuna sorulmaz', async () => {
    const k = make({ ambient: { minGapSeconds: 0 } });
    withOldDecision(k);
    k.answers.decision = () => REMIND;
    expect(await sayAndSettle(k, 'bugün çiğ köfte yiyelim mi')).toBe('spoke');
    k.advance(60_000);
    expect(await sayAndSettle(k, 'yine de çiğ köfte yesek mi acaba')).toBe('no_trace');
    expect(k.decisionCalls()).toBe(1);
  });

  it('kullanıcı "sus" dediyse o gün sınır yarıya iner (ses oturumunun dur-sözü ya da dökümdeki "sus")', async () => {
    const k = make({ ambient: { maxInterjectionsPerHour: 1 } });
    withOldDecision(k);
    k.answers.decision = () => REMIND;
    k.bus.emit('voice.state', { state: 'idle', prev: 'speaking', reason: 'stop_word', at: k.now().toISOString() });
    expect(await sayAndSettle(k, 'Öğlen çiğ köfte söyleyelim mi')).toBe('hourly_limit');
    const other = make();
    expect(other.say('Sus artık')).toBeNull();
    expect(other.repo.getState('hushedDay')).toBe('2026-11-16');
    other.close();
  });

  it('modelin kararı kodda denetlenir: düşük güven, uydurma kaynak, dayanaksız söz, espri eşiği, okunamayan yanıt', async () => {
    const cases: Array<[Decision | null, string]> = [
      [{ ...REMIND, confidence: 0.69 }, 'low_confidence'],
      [{ ...REMIND, source: 4 }, 'no_source'],
      [{ ...REMIND, source: 0 }, 'no_source'],
      [{ ...REMIND, text: 'Efendim, yarın yağmur yağacak şemsiye alın.' }, 'ungrounded'],
      [{ ...REMIND, kind: 'joke', confidence: 0.8 }, 'low_confidence'],
      [{ ...REMIND, text: '   ' }, 'empty'],
      [{ ...REMIND, speak: false }, 'silent'],
      [null, 'silent'],
    ];
    for (const [decision, reason] of cases) {
      const k = make();
      withOldDecision(k);
      k.answers.decision = () => decision;
      expect(await sayAndSettle(k, 'Öğlen çiğ köfte söyleyelim mi'), JSON.stringify(decision)).toBe(reason);
      expect(k.notifications.filter((entry) => entry.priority === 'high')).toHaveLength(0);
      k.close();
    }
    active = null;
  });

  it('asistana seslenilen satırdan çıkan not için eşlikçi çalışmaz; ses oturumuna haber verilir', async () => {
    const k = make();
    withOldDecision(k);
    k.answers.decision = () => REMIND;
    const addressed: Array<BusEvents['ambient.addressed']> = [];
    k.bus.on('ambient.addressed', (event) => void addressed.push(event));
    k.answers.notes = () => importantNote('Bugün çiğ köfte yenmesi soruldu.');
    const segment = k.say('bugün çiğ köfte yesek mi sence Jarvis')!;
    expect(segment.addressed).toBe(true);
    expect(addressed).toMatchObject([{ segmentId: segment.id, why: 'name' }]);
    expect(k.deferred.filter((entry) => !entry.cancelled)).toHaveLength(0);
    k.advance(3000);
    await k.service.takeNotes(true);
    expect(await k.service.evaluateCompanion()).toBe('no_new');
    expect(k.decisionCalls()).toBe(0);
  });
});

describe('yerel not ve hafıza', () => {
  it('kural tabanlı ön süzgeç: boş laf, tek sözcük, müzik ve televizyon için yerel model hiç çağrılmaz', async () => {
    const k = make();
    for (const text of ['Evet.', 'Tamam tamam', '[Müzik]', '♪ la la la ♪', 'Altyazı M.K.', 'Hı hı']) k.say(text);
    await k.service.takeNotes(true);
    expect(k.extractCalls).toHaveLength(0);
    expect(k.repo.pendingSegments(20)).toHaveLength(0);
    // Anlamlı söz varken kısa yanıt bağlam için partide kalır; çöp satır çıkarılır.
    k.say('Toplantı ne zaman yapılacak acaba');
    k.say('Perşembe.');
    k.say('[Alkış]');
    await k.service.takeNotes(true);
    expect(k.extractCalls).toHaveLength(1);
    expect(k.extractCalls[0]!.input).toContain('Perşembe.');
    expect(k.extractCalls[0]!.input).not.toContain('Alkış');
    expect(k.extractCalls[0]!.localOnly).toBe(true);
  });

  it('önemli not hafızaya kaynak "ambient" ve etiket "ortam" ile yazılır; önemsiz, emin olunmayan ve yinelenen yazılmaz', async () => {
    const k = make();
    k.answers.notes = () => ({
      notes: [
        { text: 'Kira artışı yüzde yirmi olarak kararlaştırıldı.', kind: 'decision', important: true, people: [], lines: [1], sure: true },
        { text: 'Ayşe Hanım sütlü kahve seviyor.', kind: 'preference', important: false, people: ['Ayşe'], lines: [2], sure: true },
        { text: 'Öğlen yemeği konuşuldu.', kind: 'chat', important: false, people: [], lines: [3], sure: true },
        { text: 'Belki toplantı salıya kaydı.', kind: 'date', important: true, people: [], lines: [4], sure: false },
      ],
      issues: [],
      facts: [],
    });
    k.say('Kira artışını yüzde yirmi yaptık, kararlaştırdık');
    k.say('Ayşe sütlü kahve seviyor biliyorsun');
    k.say('Öğlen ne yemek yiyelim acaba');
    k.say('Toplantı salıya mı kaydı neydi');
    const result = await k.service.takeNotes(true);
    // Tercih modelin "önemsiz" demesine rağmen kodda önemlidir.
    expect(result.notes.filter((note) => note.important).map((note) => note.kind)).toEqual(['decision', 'preference', 'date']);
    const saved = k.memory.list({ limit: 20 });
    expect(saved.map((item) => item.text).sort()).toEqual(['Ayşe Hanım sütlü kahve seviyor.', 'Kira artışı yüzde yirmi olarak kararlaştırıldı.']);
    expect(saved.every((item) => item.source === 'ambient' && item.tags.includes('ortam') && item.kind === 'episode')).toBe(true);

    // Aynı bilgi yeniden duyulunca hafızada yinelenmez.
    k.answers.notes = () => ({ notes: [{ text: 'Kira artışı yüzde yirmi olarak kararlaştırıldı.', kind: 'decision', important: true, people: [], lines: [1], sure: true }], issues: [], facts: [] });
    k.advance(10 * 60_000);
    k.say('Kira artışı yüzde yirmi, kararlaştırıldı zaten');
    await k.service.takeNotes(true);
    expect(k.memory.list({ limit: 20 })).toHaveLength(2);
  });

  it('hafıza kopyası notla birlikte gider: "son N dakikayı unut", tek not silme, saklama süresi, hepsini sil', async () => {
    const k = make();
    const noteFor = (text: string): NoteExtraction => ({ notes: [{ text, kind: 'decision', important: true, people: [], lines: [1], sure: true }], issues: [], facts: [] });
    k.answers.notes = () => noteFor('Bütçe yüz bin lira olarak onaylandı.');
    k.say('Bütçeyi yüz bin lira olarak onayladık');
    await k.service.takeNotes(true);
    k.advance(30 * 60_000);
    k.answers.notes = () => noteFor('Kaan teklifi cuma gönderecek.');
    k.say('Kaan teklifi cuma gönderecek dedi');
    await k.service.takeNotes(true);
    expect(k.memory.list({ limit: 10 })).toHaveLength(2);

    k.service.forgetRecent(10);
    expect(k.memory.list({ limit: 10 }).map((item) => item.text)).toEqual(['Bütçe yüz bin lira olarak onaylandı.']);

    const [note] = k.repo.notesOfDay('2026-11-16');
    k.service.deleteNote(note!.id);
    expect(k.memory.list({ limit: 10 })).toHaveLength(0);

    k.answers.notes = () => noteFor('Ofis taşınması mart ayına kararlaştırıldı.');
    k.say('Ofis taşınmasını marta kararlaştırdık');
    await k.service.takeNotes(true);
    expect(k.memory.list({ limit: 10 })).toHaveLength(1);
    k.advance(31 * 86_400_000);
    k.service.runRetention();
    expect(k.memory.list({ limit: 10 })).toHaveLength(0);

    k.answers.notes = () => noteFor('Yeni depo kiralanmasına karar verildi.');
    k.say('Yeni depoyu kiralamaya karar verdik');
    await k.service.takeNotes(true);
    // Öneriden kullanıcının eklediği kayıt "hepsini sil"de durur; notun kopyası gider.
    const kept = k.memory.save({ kind: 'fact', text: 'Muhasebeci Ayşe Hanım cuma günleri çalışır.', source: 'ambient' });
    k.service.deleteAll();
    expect(k.memory.list({ limit: 10 }).map((item) => item.id)).toEqual([kept.id]);
  });
});

describe('raporlar', () => {
  const noteFor = (text: string): NoteExtraction => ({ notes: [{ text, kind: 'decision', important: true, people: [], lines: [1], sure: true }], issues: [], facts: [] });

  it('günün raporu rapor saatinden sonra, bekleyen döküm notlandıktan sonra hazırlanır ve haber verilir', async () => {
    const k = make();
    k.answers.notes = () => noteFor('Bütçe yüz bin lira olarak onaylandı.');
    k.answers.report = (input) => {
      expect(input).toContain('Gün: 16 Kasım Pazartesi');
      expect(input).toMatch(/- \[10:00\] \(önemli\) Bütçe yüz bin lira olarak onaylandı\./);
      return { title: 'Bütçe günü', summary: 'Bütçe onaylandı.', important: ['Bütçe yüz bin lira olarak onaylandı.'], casual: [], decisions: ['Bütçe onayı'], open: [], next: [], joke: 'Para konuşuldu, kimse cüzdanına bakmadı.' };
    };
    k.say('Bütçeyi yüz bin lira olarak onayladık');
    k.setNow(new Date(2026, 10, 16, 21, 0));
    expect(await k.service.runDueReports()).toBe(0);
    k.setNow(new Date(2026, 10, 16, 21, 45));
    expect(await k.service.runDueReports()).toBe(1);
    const report = k.repo.getReport('daily', '2026-11-16')!;
    expect(report).toMatchObject({ title: 'Bütçe günü', important: ['Bütçe yüz bin lira olarak onaylandı.'], decisions: ['Bütçe onayı'], itemCount: 1 });
    expect(k.notifications.at(-1)).toMatchObject({ title: 'Günün raporu hazır', priority: 'normal' });
    // Aynı rapor iki kez yazılmaz.
    k.advance(11 * 60_000);
    expect(await k.service.runDueReports()).toBe(0);
  });

  it('haftalık rapor günlük raporlardan yazılır; ham döküm rapora gitmez; model yanıt vermezse dürüst hata', async () => {
    const k = make();
    k.setNow(new Date(2026, 10, 11, 15, 0)); // önceki haftanın çarşambası
    k.answers.notes = () => noteFor('Atlas teklifinde yüzde on indirime karar verildi.');
    k.say('Atlas teklifinde yüzde on indirim yapalım');
    await k.service.buildReport('daily');
    k.setNow(new Date(2026, 10, 16, 9, 0));
    const inputs: string[] = [];
    k.answers.report = (input) => {
      inputs.push(input);
      return { title: 'Atlas haftası', summary: 'İndirim kararı.', important: ['Yüzde on indirim'], casual: [], decisions: [], open: [], next: [], joke: null };
    };
    expect(await k.service.runDueReports()).toBe(1);
    expect(k.repo.getReport('weekly', '2026-W46')).toMatchObject({ title: 'Atlas haftası' });
    expect(inputs[0]).toContain('Hafta: 9 Kasım Pazartesi – 15 Kasım Pazar');
    expect(inputs[0]).not.toContain('yüzde on indirim yapalım');

    k.answers.report = () => null;
    await expect(k.service.buildReport('daily', '2026-11-11')).rejects.toThrow(/model yanıt vermedi/);
    expect(await k.service.buildReport('daily', '2026-11-01')).toBeNull();
  });
});

describe('hafıza önerisi ve hatırlatıcı', () => {
  it('öneri kabul edilince hafızaya "ortam dinleme" kökeniyle yazılır; aynı bilgi varsa çift kayıt olmaz', async () => {
    const k = make();
    k.answers.notes = () => ({ notes: [], issues: [], facts: [{ text: 'Muhasebeci Ayşe Hanım evrakları cuma günleri bekliyor.', subject: 'Ayşe Hanım', line: 1 }] });
    k.say('Muhasebeci Ayşe Hanım evrakları her cuma bekliyor biliyorsun');
    await k.service.takeNotes();
    const [suggestion] = k.repo.listSuggestions('pending');
    k.service.resolveSuggestion(suggestion!.id, true);
    expect(k.memory.list({ limit: 10 })).toMatchObject([{ text: suggestion!.text, source: 'ambient', subject: 'Ayşe Hanım', kind: 'fact' }]);
    expect(k.repo.listSuggestions('pending')).toHaveLength(0);

    // Hafızada zaten olan bilgi yeniden önerilmez.
    k.advance(60_000);
    k.say('Ayşe Hanım cuma günleri evrakları bekliyor muhasebeci olarak');
    await k.service.takeNotes();
    expect(k.repo.listSuggestions('pending')).toHaveLength(0);
    expect(k.memory.stats().facts).toBe(1);
  });

  it('hafızanın kural kapısı: asistanın kendi hakkındaki söz öneri olmaz; elle kabul edilse de hafızaya yazılmaz', async () => {
    const k = make();
    k.answers.notes = () => ({ notes: [], issues: [], facts: [{ text: 'Jarvis’in e-postalara erişimi yok, gönderemez.', subject: 'Jarvis', line: 1 }] });
    k.say('Jarvis’in e-postalara erişimi yok dedi, gönderemez yani');
    await k.service.takeNotes();
    expect(k.repo.listSuggestions('pending')).toHaveLength(0);
    // Eski bir sürümden kalmış bekleyen öneri kabul edilirse de kapı tutar.
    const stale = k.repo.addSuggestion({ text: 'Asistanın takvime erişimi yok.', subject: null, day: '2026-11-16', sourceIds: [] });
    k.service.resolveSuggestion(stale.id, true);
    expect(k.memory.stats().facts).toBe(0);
    expect(k.repo.listSuggestions('accepted')).toHaveLength(1);
  });

  it('yok sayılan öneri hafızaya yazılmaz', async () => {
    const k = make();
    k.answers.notes = () => ({ notes: [], issues: [], facts: [{ text: 'Kullanıcı sabahları kahveyi şekersiz içiyor.', subject: null, line: 1 }] });
    k.say('Ben sabahları kahveyi hep şekersiz içiyorum');
    await k.service.takeNotes();
    k.service.resolveSuggestion(k.repo.listSuggestions('pending')[0]!.id, false);
    expect(k.memory.stats().facts).toBe(0);
    expect(k.repo.listSuggestions('dismissed')).toHaveLength(1);
  });

  it('mesele hatırlatıcıya planlar modülünün aracıyla çevrilir; bildirimdeki "Hatırlatıcı kur" da aynı yoldan', async () => {
    const k = make();
    const created: unknown[] = [];
    k.tools.bind(moduleContext('planner', { bus: k.bus }), [
      {
        name: 'reminder_create',
        description: 'sahte',
        input: { safeParse: (value: unknown) => ({ success: true, data: value }) } as never,
        risk: 'write',
        async run(input) {
          created.push(input);
          return { ok: true, text: 'Kuruldu.', data: { id: `rem-${created.length}` } };
        },
      },
    ]);
    k.answers.notes = () => ({ notes: [], issues: [{ title: 'Kaan aranacak', person: 'Kaan', due: '2026-11-17', closes: null, line: 1 }], facts: [] });
    k.say("Yarın Kaan'ı arayacağım");
    await k.service.takeNotes();
    const issue = k.repo.listIssues('open')[0]!;
    const updated = await k.service.issueToReminder(issue.id, new Date(2026, 10, 17, 15, 0).toISOString());
    expect(created).toEqual([{ text: 'Kaan aranacak', due_at: new Date(2026, 10, 17, 15, 0).toISOString() }]);
    expect(updated.reminderId).toBe('rem-1');

    k.answers.notes = () => ({ notes: [], issues: [{ title: 'Fatura ödenecek', person: null, due: null, closes: null, line: 1 }], facts: [] });
    k.advance(60_000);
    k.say('Faturayı ödeyeceğim bu hafta');
    await k.service.takeNotes();
    const second = k.repo.listIssues('open').find((entry) => entry.title === 'Fatura ödenecek')!;
    k.bus.emit('attention.action', { id: 'n', moduleId: 'ambient', actionId: 'remind', data: { issueId: second.id } });
    await new Promise((resolve) => setImmediate(resolve));
    // Hedef gün yoksa öneri yarın 09:00'dır.
    expect(created[1]).toEqual({ text: 'Fatura ödenecek', due_at: new Date(2026, 10, 17, 9, 0).toISOString() });
    expect(k.repo.getIssue(second.id)!.reminderId).toBe('rem-2');
  });
});

describe('modül', () => {
  function fakeScheduler(): SchedulerApi & { tasks: ScheduledTask[]; handlers: Map<string, (task: ScheduledTask, run: never) => void | Promise<void>> } {
    const tasks: ScheduledTask[] = [];
    const handlers = new Map<string, (task: ScheduledTask, run: never) => void | Promise<void>>();
    return {
      tasks,
      handlers,
      start() {},
      stop() {},
      schedule(input: ScheduleInput) {
        const task: ScheduledTask = { id: `task-${tasks.length}`, kind: input.kind, dueAt: input.dueAt, recurrence: input.recurrence ?? null, payload: input.payload, key: input.key ?? null, createdAt: input.dueAt };
        const index = tasks.findIndex((entry) => entry.kind === input.kind && entry.key === task.key);
        if (index >= 0) tasks[index] = task;
        else tasks.push(task);
        return task;
      },
      cancel: () => true,
      cancelByKey: () => true,
      get: () => null,
      list: (kind) => tasks.filter((task) => !kind || task.kind === kind),
      handle(kind, handler) {
        handlers.set(kind, handler as never);
        return () => void handlers.delete(kind);
      },
    };
  }

  let env: ReturnType<typeof tempStore>;
  beforeEach(() => {
    env = tempStore();
  });
  afterEach(async () => {
    await ambientModule.teardown?.();
    env.close();
  });

  async function load(options: { allowed?: boolean; consent?: boolean } = {}) {
    const bus = testBus();
    const tools = miniTools();
    const scheduler = fakeScheduler();
    const policy = fakePolicy({ ambient: { ...AMBIENT_ON } });
    let moduleAllowed = options.allowed ?? true;
    policy.moduleAllowed = () => moduleAllowed;
    const settings = fakeSettings(bus, options.consent === false ? {} : { ambientConsentAt: '2026-11-15T09:00:00.000Z' });
    const voice = Object.assign(fakeVoice(), { ambientCalls: [] as boolean[], setAmbient(enabled: boolean) { this.ambientCalls.push(enabled); } });
    const notifications: NotifyRequest[] = [];
    const ctx = moduleContext(
      'ambient',
      {
        bus,
        policy,
        settings,
        voice,
        scheduler,
        tools,
        memory: createMemory({ store: env.store, bus, log: silentLog }),
        attention: { notify: (request: NotifyRequest) => (notifications.push(request), {} as Notification) } as never,
        brain: { extract: async () => null, status: () => ({ provider: 'local', reason: 'policy_local', cause: null, localReady: true, localModel: 't', message: null }) } as never,
      },
      env.store,
    );
    await loadModule(ambientModule, ctx, env.store, tools);
    const ipc = ambientModule.ipc!(ctx);
    return { bus, tools, scheduler, policy, settings, voice, ctx, ipc, notifications, disallow: () => (moduleAllowed = false) };
  }
  const origin = { origin: { channel: 'voice' as const, speakerVerified: null } };
  const emitSegment = (bus: ReturnType<typeof testBus>, id: string, text: string, at = new Date()) =>
    (bus as unknown as { emit(type: string, payload: unknown): void }).emit('voice.ambient', {
      id,
      text,
      startedAt: at.toISOString(),
      endedAt: new Date(at.getTime() + 1500).toISOString(),
      durationMs: 1500,
      lang: 'tr',
      source: 'mic',
    });

  it('yüklenince saklama ve rapor görevlerini zamanlar; rızasız açılmaz; rıza ve anahtarla ses hattını açar', async () => {
    const m = await load({ consent: false });
    expect(m.scheduler.tasks.map((task) => [task.kind, task.recurrence?.freq])).toEqual([
      ['ambient.retention', 'daily'],
      ['ambient.report', 'daily'],
    ]);
    expect([...m.scheduler.handlers.keys()].sort()).toEqual(['ambient.report', 'ambient.retention']);
    expect(await m.ipc['ambient.status']!(undefined as never)).toMatchObject({ listening: false, reason: 'no_consent' });
    expect(m.voice.ambientCalls.at(-1)).toBe(false);
    expect(() => m.ipc['ambient.setPrefs']!({ patch: { enabled: true } })).toThrow(/rıza/);
    expect(await m.ipc['ambient.consent']!({ accept: true })).toMatchObject({ listening: true });
    expect(m.voice.ambientCalls.at(-1)).toBe(true);
    expect(m.settings.get().ambientConsentAt).not.toBeNull();
  });

  it('besleme olay yolundan gelir (voice.ambient); araçlar: arama, gün özeti, duraklat, son dakikaları sil', async () => {
    const m = await load({ consent: false });
    await m.ipc['ambient.consent']!({ accept: true });
    emitSegment(m.bus, 'a1', "Kaan'la Atlas teklifini konuştuk, yüzde on indirim istiyor");
    emitSegment(m.bus, 'a2', 'Sözleşme taslağı masaüstündeki Atlas klasöründe');
    expect(await m.ipc['ambient.transcript']!({ day: new Date().toLocaleDateString('sv-SE') })).toHaveLength(2);

    // Araç sonucu bulut beynine gidebilir: ham döküm ASLA dönmez; notlanmamış söz yalnız sayıyla söylenir.
    const found = await m.tools.run('ambient_search', { query: 'Kaan teklif' }, origin);
    expect(found).toMatchObject({ ok: true });
    expect(found.text).not.toContain('Atlas');
    expect(found.text).toContain('2 satır döküm henüz nota çevrilmedi');
    expect((await m.tools.run('ambient_search', { query: 'uzay mekiği' }, origin)).text).toContain('bununla ilgili bir şey yok');

    const summary = await m.tools.run('ambient_day_summary', {}, origin);
    expect(summary.text).toMatch(/için ortam notu yok\. 2 satır döküm var ama henüz nota çevrilmedi/);

    expect((await m.tools.run('ambient_pause', { minutes: 60 }, origin)).text).toContain('60 dakika duraklatıldı');
    expect(await m.ipc['ambient.status']!(undefined as never)).toMatchObject({ listening: false, reason: 'paused' });
    emitSegment(m.bus, 'a3', 'duraklatılmışken söylenen yazılmaz');
    expect((await m.tools.run('ambient_pause', { minutes: 0 }, origin)).text).toContain('sürüyor');

    const forgotten = await m.tools.run('ambient_forget_recent', {}, origin);
    expect(forgotten).toMatchObject({ ok: true, data: { segments: 2 } });
    expect((await m.tools.run('ambient_search', { query: 'Kaan teklif' }, origin)).text).toContain('bununla ilgili bir şey yok');
  });

  it('d10: ambient_set sesle açar/kapatır; rıza yoksa açmaz', async () => {
    const m = await load({ consent: false });
    const refused = await m.tools.run('ambient_set', { on: true }, origin);
    expect(refused).toMatchObject({ ok: false });
    expect(refused.text).toContain('onay vermeniz');
    expect((await m.ipc['ambient.status']!(undefined as never)).prefs.enabled).toBe(false);

    await m.ipc['ambient.consent']!({ accept: true });
    expect((await m.tools.run('ambient_set', { on: false }, origin)).text).toContain('kapattım');
    expect(await m.ipc['ambient.status']!(undefined as never)).toMatchObject({ listening: false, prefs: { enabled: false } });
    expect((await m.tools.run('ambient_set', { on: false }, origin)).text).toContain('zaten kapalı');

    await m.ipc['ambient.pause']!({ preset: '1h' });
    const opened = await m.tools.run('ambient_set', { on: true }, origin);
    expect(opened).toMatchObject({ ok: true });
    expect(await m.ipc['ambient.status']!(undefined as never)).toMatchObject({ listening: true, pausedUntil: null, prefs: { enabled: true } });
  });

  it('saklama görevi zamanlayıcıdan koşar', async () => {
    const m = await load();
    const old = new Date(Date.now() - 8 * 86_400_000);
    env.store.scoped('ambient').run(
      "INSERT INTO ambient_segments (id, feed_id, text, started_at, ended_at, started_ms, duration_ms, day, noted, addressed) VALUES ('eski', 'f-eski', 'sekiz gün önce söylenen', ?, ?, ?, 1000, '2026-01-01', 1, 0)",
      [old.toISOString(), old.toISOString(), old.getTime()],
    );
    await m.scheduler.handlers.get('ambient.retention')!(m.scheduler.tasks[0]!, {} as never);
    expect(env.store.scoped('ambient').get<{ n: number }>('SELECT COUNT(*) AS n FROM ambient_segments')!.n).toBe(0);
  });

  it('açılışta süresi dolan döküm silinir (uygulama günlerce kapalı kaldıysa)', async () => {
    env.store.migrate('ambient', AMBIENT_MIGRATIONS);
    const old = new Date(Date.now() - 9 * 86_400_000);
    env.store.scoped('ambient').run(
      "INSERT INTO ambient_segments (id, feed_id, text, started_at, ended_at, started_ms, duration_ms, day, noted, addressed) VALUES ('eski', 'f-eski', 'dokuz gün önce', ?, ?, ?, 1000, '2026-01-01', 0, 0)",
      [old.toISOString(), old.toISOString(), old.getTime()],
    );
    await load();
    expect(env.store.scoped('ambient').get<{ n: number }>('SELECT COUNT(*) AS n FROM ambient_segments')!.n).toBe(0);
  });

  it('modül Yönetim’den kapatılınca ham döküm hemen silinir; uygulama kapanırken silinmez', async () => {
    const m = await load();
    await m.ipc['ambient.setPrefs']!({ patch: { enabled: true } });
    emitSegment(m.bus, 'b1', 'kapanışta durması gereken söz');
    const count = () => env.store.scoped('ambient').get<{ n: number }>('SELECT COUNT(*) AS n FROM ambient_segments')!.n;
    expect(count()).toBe(1);
    await ambientModule.teardown?.(); // uygulama kapanışı: modül hâlâ izinli
    expect(count()).toBe(1);
    expect(m.voice.ambientCalls.at(-1)).toBe(false);

    const again = await load();
    again.disallow();
    await ambientModule.teardown?.();
    expect(count()).toBe(0);
  });

  it('modül kapalıyken de kalan kayıtlar silinebilir (purge): notlar, işler ve modülün bildirim geçmişi gider; rıza ve tercihler durur', async () => {
    const m = await load();
    const repo = createAmbientRepo(env.store.scoped('ambient'));
    repo.addIssue({ title: 'Kaan aranacak', person: 'Kaan', detail: null, firstDay: '2026-11-15', dueDay: '2026-11-16', unsure: false, sourceIds: [], sourceFrom: new Date().toISOString() });
    m.disallow();
    await ambientModule.teardown?.(); // Yönetim modülü kapattı: ham döküm gider, işler durur
    expect(repo.listIssues('all')).toHaveLength(1);

    const forgotten: string[] = [];
    const changed: string[] = [];
    m.bus.on('ambient.changed', (event) => void changed.push(`${event.entity}:${event.op}`));
    const offCtx = { ...m.ctx, attention: { ...m.ctx.attention, forgetModule: (id: string) => (forgotten.push(id), 3) } } as typeof m.ctx;
    await ambientModule.purge!(offCtx);
    expect(repo.listIssues('all')).toHaveLength(0);
    expect(forgotten).toEqual(['ambient']);
    expect(changed).toContain('issue:deleted');
    expect(m.settings.get().ambientConsentAt).not.toBeNull();
  });

  it('modül açıkken "hepsini sil" bildirim geçmişini de siler', async () => {
    const forgotten: string[] = [];
    const m = await load();
    (m.ctx.attention as { forgetModule?: (id: string) => number }).forgetModule = (id) => (forgotten.push(id), 1);
    await ambientModule.purge!(m.ctx);
    expect(forgotten).toEqual(['ambient']);
  });

  it('sabah özetine vadesi gelen açık işler eklenir', async () => {
    const m = await load();
    const repo = createAmbientRepo(env.store.scoped('ambient'));
    repo.addIssue({ title: 'Kaan aranacak', person: 'Kaan', detail: null, firstDay: '2026-11-15', dueDay: '2026-11-16', unsure: false, sourceIds: [], sourceFrom: new Date().toISOString() });
    repo.addIssue({ title: 'Gelecek ayın işi', person: null, detail: null, firstDay: '2026-11-15', dueDay: '2026-12-20', unsure: false, sourceIds: [], sourceFrom: new Date().toISOString() });
    const brief = { kind: 'morning' as const, day: '2026-11-16', lines: [] as string[] };
    m.bus.emit('planner.brief.collect', brief);
    expect(brief.lines).toEqual(['Açık iş: Kaan aranacak']);
  });
});
