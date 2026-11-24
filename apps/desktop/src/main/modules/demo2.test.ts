// demo.2: yinelenen kayıt koruması (hatırlatıcı, yapılacak, hafıza) ve öz-durum aracı. İlk denemelerde aynı
// hatırlatıcı üç kez kuruldu (üç hatırlatıcı + üç hafıza kaydı) ve model donanım hakkında uydurdu.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineTool, type Bus, type MemoryApi, type ModuleContext, type SchedulerApi, type VoiceDiagnosticsReport } from '@fuber/shared';
import { z } from 'zod';
import { fakePolicy, fakeVoice, loadModule, miniTools, moduleContext, silentLog, tempStore, testBus } from '../core/brain/testkit';
import { createTools } from '../core/tools';
import { createMemory } from '../core/memory';
import { createScheduler } from '../core/scheduler';
import memoryModule from './memory/index';
import { applyExtraction, isSelfTalk } from './memory/writer';
import { findDuplicateReminder, sameTask } from './planner/dedupe';
import planner from './planner/index';
import { describeHardware, parseNvidiaSmi, parseWmiGpus, readHardware } from './voice-control/hardware';
import voiceControl, { collectSelfSource, readVoiceState } from './voice-control/index';

const T0 = new Date('2026-11-16T12:38:51+03:00');
const voice = { channel: 'voice' as const, speakerVerified: null, sessionId: 's1' };

let env: ReturnType<typeof tempStore>;
let bus: Bus;
let memory: MemoryApi;
let scheduler: SchedulerApi;
let tools: ReturnType<typeof miniTools>;
let ctx: ModuleContext;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
  vi.setSystemTime(T0);
  env = tempStore();
  bus = testBus();
  memory = createMemory({ store: env.store, bus, log: silentLog });
  scheduler = createScheduler({ store: env.store, bus, log: silentLog });
  scheduler.start();
  tools = miniTools();
  ctx = moduleContext('planner', { bus, scheduler, memory, attention: { start() {}, stop() {}, notify: () => ({}) as never, dismiss() {}, act() {}, pending: () => [], recent: () => [] } }, env.store);
  await loadModule(planner, ctx, env.store, tools);
  await loadModule(memoryModule, moduleContext('memory', { bus, memory }), env.store, tools);
});
afterEach(async () => {
  await planner.teardown?.();
  await memoryModule.teardown?.();
  scheduler.stop();
  vi.useRealTimers();
  env.close();
});

const reminders = () => env.store.scoped('planner').all<{ text: string }>('SELECT text FROM planner_reminders ORDER BY created_at');
const commitments = () => memory.list({ kind: 'commitment', limit: 20 });

describe('araç kümesi (`ToolDef.group`)', () => {
  it('araç kaydı tanımdaki kümeyi listede taşır; küme bildirmeyen araçta alan yoktur', () => {
    const real = createTools({ store: env.store, policy: fakePolicy(), stage: { show: () => ({}) as never, close() {}, items: () => [] } as never, bus, log: silentLog });
    real.register(moduleContext('pc', { bus }), [
      defineTool({ name: 'pc_ornek', description: 'x', input: z.object({}), risk: 'read', group: 'pc', run: async () => ({ ok: true, text: 'x' }) }),
      defineTool({ name: 'duz_arac', description: 'x', input: z.object({}), risk: 'read', run: async () => ({ ok: true, text: 'x' }) }),
    ]);
    expect(real.list().find((tool) => tool.name === 'pc_ornek')).toMatchObject({ group: 'pc', moduleId: 'pc' });
    expect(real.list().find((tool) => tool.name === 'duz_arac')).not.toHaveProperty('group');
  });
});

describe('yinelenen hatırlatıcı koruması', () => {
  it('sınama senaryosu: aynı hatırlatıcı üç kez istenir, tek kayıt ve tek hafıza kaydı oluşur', async () => {
    const due = '2026-11-16T20:00:00+03:00';
    const first = await tools.run('reminder_create', { text: "Kaan'a önemli iş konusunu hatırlat", due_at: due }, { origin: voice });
    expect(first.text).toContain('Hatırlatıcı kuruldu');
    vi.setSystemTime(new Date(T0.getTime() + 20_000));
    const second = await tools.run('reminder_create', { text: "Kaan'a önemli iş konusunu hatırlat", due_at: due }, { origin: voice });
    vi.setSystemTime(new Date(T0.getTime() + 29_000));
    const third = await tools.run('reminder_create', { text: "Kaan'a bugün önemli bir iş konusuyla uyarı", due_at: due }, { origin: voice });
    for (const result of [second, third]) {
      expect(result.ok).toBe(true);
      expect(result.text).toContain('zaten kurulu');
      expect(result.text).toContain('Yenisi AÇILMADI');
      expect((result.data as { id: string }).id).toBe((first.data as { id: string }).id);
    }
    expect(reminders()).toHaveLength(1);
    expect(commitments()).toHaveLength(1);
    expect(scheduler.list('planner.reminder')).toHaveLength(1);
  });

  it('farklı iş, farklı vakit ya da on dakikadan sonraki istek yeni kayıttır', async () => {
    const due = '2026-11-16T20:00:00+03:00';
    await tools.run('reminder_create', { text: "Kaan'ı ara", due_at: due }, { origin: voice });
    expect((await tools.run('reminder_create', { text: "Kaan'a mail at", due_at: due }, { origin: voice })).text).toContain('Hatırlatıcı kuruldu');
    expect((await tools.run('reminder_create', { text: "Kaan'ı ara", due_at: '2026-11-16T21:00:00+03:00' }, { origin: voice })).text).toContain('Hatırlatıcı kuruldu');
    vi.setSystemTime(new Date(T0.getTime() + 11 * 60_000));
    expect((await tools.run('reminder_create', { text: "Kaan'ı ara", due_at: due }, { origin: voice })).text).toContain('Hatırlatıcı kuruldu');
    expect(reminders()).toHaveLength(4);
  });

  it('göreli süre: aynı "10 dakika sonra" isteği yinelenince çalma anı kaysa da yineleme sayılır', async () => {
    await tools.run('reminder_create', { text: 'Çayı kapat', after_seconds: 600 }, { origin: voice });
    vi.setSystemTime(new Date(T0.getTime() + 15_000));
    expect((await tools.run('reminder_create', { text: 'Çayı kapat', after_seconds: 585 }, { origin: voice })).text).toContain('zaten kurulu');
    expect((await tools.run('reminder_create', { text: 'Çayı kapat', after_seconds: 3600 }, { origin: voice })).text).toContain('Hatırlatıcı kuruldu');
    expect(reminders()).toHaveLength(2);
  });

  it('saf denetim: iptal edilmiş kayıt yineleme sayılmaz; tek ortak sözcük yetmez', () => {
    expect(sameTask('KDV beyannamesini ver', 'kdv beyannamesini ver!')).toBe(true);
    expect(sameTask("Kaan'ı ara", "Kaan'a mail at")).toBe(false);
    const base = { id: 'r', text: 'Toplantı', dueAt: '2026-11-17T07:00:00.000Z', recurrence: null, priority: 'high' as const, source: 'voice' as const, createdAt: T0.toISOString(), firedAt: null, memoryId: null };
    const candidate = { text: 'toplantı', dueAt: '2026-11-17T10:00:00+03:00', relative: false, recurring: false };
    expect(findDuplicateReminder([{ ...base, status: 'scheduled' }], candidate, T0.getTime() + 1000)?.id).toBe('r');
    expect(findDuplicateReminder([{ ...base, status: 'cancelled' }], candidate, T0.getTime() + 1000)).toBeNull();
  });
});

describe('yinelenen yapılacak ve hafıza koruması', () => {
  it('aynı madde ikinci kez eklenmez; toplu eklemede listede olanlar ve çağrı içi yinelenenler atlanır', async () => {
    await tools.run('todo_add', { text: 'Rapor yaz' }, { origin: voice });
    expect((await tools.run('todo_add', { text: 'rapor yaz.' }, { origin: voice })).text).toContain('zaten var');
    const many = await tools.run('todo_add_many', { items: [{ text: 'Rapor yaz' }, { text: 'Süt' }, { text: 'süt' }, { text: 'Ekmek' }] }, { origin: voice });
    expect(many.text).toContain('2 madde yapılacaklara eklendi');
    expect(many.text).toContain('2 madde zaten listedeydi');
    expect(env.store.scoped('planner').all('SELECT id FROM planner_todos')).toHaveLength(3);
    expect((await tools.run('todo_add_many', { items: [{ text: 'Süt' }, { text: 'Ekmek' }] }, { origin: voice })).text).toContain('hepsi yapılacaklarda zaten var');
  });

  it('memory_save: aynı bilgi yeniden yazılmaz, yeni söyleniş kaydı günceller, farklı bilgi yeni kayıttır', async () => {
    const save = (text: string) => tools.run('memory_save', { text }, { origin: voice });
    expect((await save('Kullanıcının şirketi Atlas Limited, Ankara’da kurulu.')).text).toBe('Hafızaya kaydedildi.');
    expect((await save('Kullanıcının şirketi Atlas Limited Ankara’da kurulu')).text).toContain('zaten var');
    expect((await save('Kullanıcının şirketi Atlas Limited, Ankara’da Çankaya’da kurulu bir mobilya şirketi.')).text).toContain('güncellendi');
    expect((await save('Kullanıcının muhasebecisinin adı Kaan.')).text).toBe('Hafızaya kaydedildi.');
    const facts = memory.list({ kind: 'fact', limit: 20 });
    expect(facts).toHaveLength(2);
    expect(facts.some((item) => item.text.includes('Çankaya'))).toBe(true);
  });

  it('arka plan yazıcısı: köklerinin onda dokuzu ortak olan "ekleme" yinelemedir', () => {
    memory.save({ kind: 'fact', text: 'Kullanıcı kahveyi sütsüz ve şekersiz içer.', source: 'voice', confidence: 1, importance: 0.5 });
    const written = applyExtraction({ memory, log: silentLog }, { items: [
      { action: 'add', target_id: null, kind: 'fact', text: 'Kullanıcı kahveyi şekersiz ve sütsüz içer', subject: null, importance: 0.5 },
      { action: 'add', target_id: null, kind: 'fact', text: 'Kullanıcının kızı Ada ilkokula gidiyor.', subject: 'Ada', importance: 0.6 },
    ] }, { source: 'voice', sessionId: null });
    expect(written.map((item) => item.text)).toEqual(['Kullanıcının kızı Ada ilkokula gidiyor.']);
  });

  it('arka plan yazıcısı: asistanın kendi hakkındaki sözü hafızaya yazılmaz (durumu öz-durum bloğundan bilinir)', () => {
    for (const text of ['Asistanın ekran kartına erişimi yok.', 'Jarvis yeni özellik ekleyemez.', 'Asistan tamamen yerelde çalışıyor.', 'Jarvis hava durumuna bakamaz.']) expect(isSelfTalk(text), text).toBe(true);
    for (const text of ['Kullanıcının şirketi Atlas Limited.', 'Kullanıcı yerel modelin hızını beğendi.', 'Kaan muhasebeci.']) expect(isSelfTalk(text), text).toBe(false);
    const written = applyExtraction({ memory, log: silentLog }, { items: [{ action: 'add', target_id: null, kind: 'fact', text: 'Asistan tamamen yerelde çalışıyor, bulut bağlantısı yok.', subject: null, importance: 0.5 }] }, { source: 'voice', sessionId: null });
    expect(written).toEqual([]);
  });
});

describe('öz-durum: ses hattının gerçek durumu ve donanım', () => {
  const report = (tts: Partial<VoiceDiagnosticsReport['engines']['tts']>): VoiceDiagnosticsReport =>
    ({
      engines: {
        stt: { id: 'whisper-local', state: 'ready', gpu: true, reason: null },
        tts: { provider: 'elevenlabs', active: 'elevenlabs', local: true, voiceId: 'x', model: 'eleven_flash_v2_5', hasKey: true, fallback: null, charsBilled: 0, ...tts },
      },
      bargeIn: { policy: 'voice', effective: 'wake', echo: null },
    }) as unknown as VoiceDiagnosticsReport;

  it('ses tanıdan okunur: bulut ses etkinse "elevenlabs", düşüldüyse yerel motor ve nedeni; tanı yoksa null (tahmin yok)', () => {
    const fake = fakeVoice();
    expect(readVoiceState(fake, 'whisper-local')).toBeNull();
    const cloud = Object.assign(fakeVoice(), { diagnosticsReport: () => report({}) });
    expect(readVoiceState(cloud, 'whisper-local')).toMatchObject({
      stt: { provider: 'whisper-local', gpu: true },
      tts: { provider: 'elevenlabs', active: 'elevenlabs', fallbackReason: null },
      bargeIn: 'wake',
      micMuted: false,
    });
    const fallen = Object.assign(fakeVoice(), { diagnosticsReport: () => report({ active: 'piper-local', fallback: { reason: 'quota', message: 'Kota doldu', until: null } }) });
    expect(readVoiceState(fallen, 'whisper-local')?.tts).toEqual({ provider: 'elevenlabs', active: 'piper-local', fallbackReason: 'quota' });
  });

  it('kaynak: kısayollar gerçekte kayıtlı tuşlardan, konuşma diliyle', () => {
    const context = moduleContext('voice-control', { bus, voice: Object.assign(fakeVoice(), { diagnosticsReport: () => report({}) }) });
    const source = collectSelfSource(context);
    expect(source.voice?.tts.active).toBe('elevenlabs');
    expect(source.hotkeys).toEqual({ talk: 'Ctrl+Alt+J', mute: 'Ctrl+Alt+M' });
    expect(source.admin).toBe('offline');
  });

  it('donanım: nvidia-smi varsa ad ve bellek oradan; yoksa WMI adları; hiçbiri yoksa "okunamadı"', async () => {
    expect(parseNvidiaSmi('NVIDIA GeForce RTX 4080 SUPER, 16376, 3968\r\n')).toEqual([{ name: 'NVIDIA GeForce RTX 4080 SUPER', totalMiB: 16376, freeMiB: 3968 }]);
    expect(parseWmiGpus('[{"Name":"Intel(R) UHD Graphics 770"},{"Name":"AMD Radeon RX 7600"}]').map((gpu) => gpu.name)).toEqual(['Intel(R) UHD Graphics 770', 'AMD Radeon RX 7600']);
    expect(parseWmiGpus('bozuk')).toEqual([]);
    const withNvidia = await readHardware(async (file) => {
      if (file === 'nvidia-smi') return 'NVIDIA GeForce RTX 4080 SUPER, 16376, 3968\n';
      throw new Error('çağrılmamalı');
    });
    const text = describeHardware(withNvidia);
    expect(text).toContain('ekran kartı NVIDIA GeForce RTX 4080 SUPER (16 GB ekran belleği, şu an 3,9 GB boş)');
    expect(text).toMatch(/İşlemci .+ \(\d+ iş parçacığı\)\. RAM \d+ GB/);
    const none = await readHardware(async () => {
      throw new Error('yok');
    });
    expect(describeHardware(none)).toContain('ekran kartı okunamadı');
  });

  it('self_status aracı: salt okunur; beyin durumu veremese de donanımı söyler ve "tahmin etme" der', async () => {
    const local = miniTools();
    await loadModule(voiceControl, moduleContext('voice-control', { bus, voice: fakeVoice() }), env.store, local);
    vi.useRealTimers();
    const result = await local.run('self_status', {}, { origin: voice });
    expect(result.ok).toBe(true);
    expect(result.text).toContain('Çalışma durumu şu an okunamadı.');
    expect(result.text).toContain('Bu bilgisayarın donanımı');
    expect(result.text).toContain('burada yazmayanı ekleme');
    expect(local.list().find((tool) => tool.name === 'self_status')?.risk).toBe('read');
    await voiceControl.teardown?.();
  });
});
