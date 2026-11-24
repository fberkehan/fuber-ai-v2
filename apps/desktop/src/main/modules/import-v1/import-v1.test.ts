import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UserError, localTime, type Bus, type ModuleContext, type SchedulerApi } from '@fuber/shared';
import { createMemory } from '../../core/memory';
import { createScheduler } from '../../core/scheduler';
import { loadModule, miniTools, moduleContext, silentLog, tempStore, testBus } from '../../core/brain/testkit';
import planner from '../planner/index';
import { createV1Importer, IMPORT_V1_MIGRATIONS, type ImportSink, type V1Importer } from './importer';
import { createPlannerImportApi } from '../planner/import-api';
import { createImportSink } from './sink';
import { createV1Fixture, type V1Fixture } from './fixture';
import { looksSecret } from './secrets';
import { monthlyAnchor, recurrenceOf, todoPriorityOf, reminderPriorityOf, importanceOf, confidenceOf, mapMemory } from './mapping';
import { DEFAULT_IMPORT_OPTIONS, type ImportV1Options } from './types';

let env: ReturnType<typeof tempStore>;
let bus: Bus;
let scheduler: SchedulerApi;
let ctx: ModuleContext;
let work: string;
let fixture: V1Fixture | null;

async function boot() {
  env = tempStore();
  bus = testBus();
  scheduler = createScheduler({ store: env.store, bus, log: silentLog });
  scheduler.start();
  const memory = createMemory({ store: env.store, bus, log: silentLog });
  const attention = { start() {}, stop() {}, notify: () => ({}) as never, dismiss() {}, act() {}, pending: () => [], recent: () => [] };
  await loadModule(planner, moduleContext('planner', { bus, scheduler, memory, attention }, env.store), env.store, miniTools());
  ctx = moduleContext('import-v1', { bus, scheduler, memory, attention }, env.store);
  env.store.migrate('import-v1', IMPORT_V1_MIGRATIONS);
  memory.stats();
}

function importer(dir: string | null, sink: ImportSink = createImportSink(ctx)): V1Importer {
  return createV1Importer({ db: ctx.db, sink, bus, log: silentLog, v1Dir: () => dir, tempDir: path.join(work, 'temp') });
}

/** v1 klasöründeki her dosyanın özeti (ad → sha256). */
function fingerprint(dir: string): Record<string, string> {
  return Object.fromEntries(
    fs
      .readdirSync(dir)
      .sort()
      .map((name) => [name, createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex')]),
  );
}

const count = (sql: string) => (env.store.scoped('core').get<{ n: number }>(sql)?.n ?? 0);
const memories = () => count("SELECT COUNT(*) AS n FROM memory_items WHERE source = 'import'");
const reminders = () => count("SELECT COUNT(*) AS n FROM planner_reminders WHERE source = 'import'");
const todos = () => count("SELECT COUNT(*) AS n FROM planner_todos WHERE source = 'import'");
const ledger = () => count('SELECT COUNT(*) AS n FROM import_v1_items');

beforeEach(async () => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-v1-import-'));
  fixture = null;
  await boot();
});

afterEach(async () => {
  fixture?.close();
  await planner.teardown?.();
  scheduler.stop();
  env.close();
  fs.rmSync(work, { recursive: true, force: true });
});

describe('v1 içe aktarma: önizleme', () => {
  it('v1 yoksa dürüstçe "bulunamadı" der ve hiçbir şey yazmaz', async () => {
    const run = importer(path.join(work, 'yok'));
    expect(run.status()).toMatchObject({ found: false, dir: null, plannerReady: true });
    await expect(run.preview()).rejects.toBeInstanceOf(UserError);
    expect(ledger()).toBe(0);
  });

  it('çalışan v1 (WAL açık) üzerinde yalnız sayıları verir; WAL içindeki satırları da görür', async () => {
    const dir = path.join(work, 'Fuber AI');
    fixture = createV1Fixture(dir, { now: new Date() });
    fixture.addMemory('Son dakika', 'Henüz yalnız WAL dosyasında duran kayıt.');
    expect(fs.existsSync(`${fixture.db}-wal`)).toBe(true);
    const preview = await importer(dir).preview();
    expect(preview.schemaVersion).toBe(8);
    expect(preview.tables.every((table) => table.state === 'ok')).toBe(true);
    expect(preview.memories).toEqual({ active: 13, private: 0, deletedOrArchived: 2 });
    expect(preview.reminders).toEqual({ upcoming: 8, past: 3, private: 0 });
    expect(preview.todos).toEqual({ open: 4, done: 1, private: 1 });
    expect(preview.issues).toEqual({ open: 2, closed: 1, private: 1 });
    expect(memories() + reminders() + todos() + ledger()).toBe(0);
  });

  it('eski sürüm v1 şemasında okunamayan tabloyu adıyla söyler, ötekileri aktarır', async () => {
    const dir = path.join(work, 'eski');
    fixture = createV1Fixture(dir, { now: new Date(), variant: 'old' });
    const run = importer(dir);
    const preview = await run.preview();
    expect(preview.tables.find((t) => t.table === 'hafizalar')).toMatchObject({ state: 'incompatible', missingColumns: ['silindi'] });
    expect(preview.tables.find((t) => t.table === 'meseleler')).toMatchObject({ state: 'missing' });
    expect(preview.reminders.upcoming).toBe(1);
    const result = await run.run(DEFAULT_IMPORT_OPTIONS);
    expect(result.tableErrors.map((error) => error.table).sort()).toEqual(['hafizalar', 'meseleler']);
    expect(result.tableErrors[0]!.message).toMatch(/hafızalar|meseleler/);
    expect(result.imported).toMatchObject({ memories: 0, reminders: 1, todos: 1, issueNotes: 0 });
  });
});

describe('v1 içe aktarma: aktarım', () => {
  let dir: string;
  beforeEach(() => {
    dir = path.join(work, 'Fuber AI');
    fixture = createV1Fixture(dir, { now: new Date() });
  });

  it('varsayılan seçimle doğru sayıları aktarır; gizli ve sır gibi görünenleri atlar', async () => {
    const result = await importer(dir).run(DEFAULT_IMPORT_OPTIONS);
    expect(result.imported).toEqual({ memories: 8, reminders: 5, todos: 3, issueNotes: 1, pastReminderNotes: 0 });
    expect(result.skipped).toEqual({ private: 2, secrets: 4, duplicates: 1, invalid: 4, notSelected: 7 });
    expect(result.tableErrors).toEqual([]);
    // Hatırlatıcının "söz" hafızası da içe aktarma kökenlidir: 8 hafıza + 1 mesele + 5 hatırlatıcı sözü.
    expect(memories()).toBe(14);
    expect(reminders()).toBe(5);
    expect(todos()).toBe(3);
    expect(ledger()).toBe(17);
  });

  it('alanları en yakın karşılığa eşler: tür, önem, sabitlik, güven, köken, özgün tarih', async () => {
    await importer(dir).run(DEFAULT_IMPORT_OPTIONS);
    const items = ctx.memory.list({ limit: 100 }).filter((item) => item.source === 'import');
    const byText = (needle: string) => items.find((item) => item.text.includes(needle))!;

    const name = byText('Çağrı Öztürk; ona');
    expect(name).toMatchObject({ kind: 'fact', pinned: true, importance: 1, confidence: 1, at: '2026-09-03T08:15:00.000Z' });
    expect(name.text).toBe('Kullanıcının adı: Adı Çağrı Öztürk; ona “efendim” diye hitap edilir.');
    expect(name.tags).toEqual(['v1', 'v1:kullanici', 'kimlik']);

    expect(byText('Muhasebeci')).toMatchObject({ subject: 'Ayşe Yılmaz', confidence: 0.8, importance: 0.5 });
    expect(byText('Kocaeli')).toMatchObject({ kind: 'episode', at: '2026-10-12T09:00:00.000Z', confidence: 0.7, importance: 0.25 });
    expect(byText('Cuma günü Ali’ye')).toMatchObject({ kind: 'commitment', text: 'Söz: Cuma günü Ali’ye sözleşmeyi gönderecek.' });
    expect(byText('Sabah dokuzdan')).toMatchObject({ pinned: true, tags: ['v1', 'v1:kural'] });
    const long = byText('ığdır, şişli');
    expect(long.text.length).toBe(4000);
    expect(long.subject).toBe('KİLİM');
    expect(byText('İzmir')).toBeTruthy();

    const issue = byText('Bekleyen iş: Ali sözleşmeyi gönderecek.');
    expect(issue).toMatchObject({ kind: 'commitment', subject: 'Ali', tags: ['v1', 'v1:mesele'] });
    expect(issue.text).toContain('İmzalı nüsha bekleniyor');
    expect(issue.text).toContain('20 Kasım 2026');

    // Hafıza araması Türkçe büyük harfle de bulur (FTS katlama).
    expect(ctx.memory.search({ text: 'KİLİM', limit: 3 }).length).toBeGreaterThan(0);
    // Sır, parola, anahtar metni hiçbir yere girmedi.
    expect(items.some((item) => /Kedi1234|sk-ant|445566|abc123/.test(item.text))).toBe(false);
  });

  it('hatırlatıcılar: yalnız gelecekteki ve etkin olanlar; tekrar kuralı doğru çevrilir', async () => {
    const now = Date.now();
    await importer(dir).run(DEFAULT_IMPORT_OPTIONS);
    const list = env.store
      .scoped('core')
      .all<{ text: string; due_at: string; recurrence: string | null; priority: string }>("SELECT text, due_at, recurrence, priority FROM planner_reminders WHERE source = 'import'");
    const get = (text: string) => list.find((row) => row.text === text)!;
    expect(list.map((row) => row.text).sort()).toEqual(['Haftalık rapor', 'Haftalık spor', 'KDV beyannamesini ver (Ayşe Hanım’a sor)', 'Kira (Ev sahibine)', 'İlaç'].sort());
    for (const row of list) expect(Date.parse(row.due_at)).toBeGreaterThan(now - 60_000);
    expect(get('KDV beyannamesini ver (Ayşe Hanım’a sor)')).toMatchObject({ recurrence: null, priority: 'high' });
    expect(JSON.parse(get('İlaç').recurrence!)).toEqual({ freq: 'daily', interval: 1 });
    expect(JSON.parse(get('Haftalık rapor').recurrence!)).toEqual({ freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] });
    expect(JSON.parse(get('Haftalık spor').recurrence!)).toEqual({ freq: 'weekly', interval: 1 });
    const rent = get('Kira (Ev sahibine)');
    expect(JSON.parse(rent.recurrence!)).toEqual({ freq: 'monthly', interval: 1 });
    expect(rent.priority).toBe('urgent');
    // Asıl gün 31: kısa ayda ayın son günü, uzun ayda 31; saat v1'deki saattir.
    const due = new Date(rent.due_at);
    const monthDays = new Date(due.getFullYear(), due.getMonth() + 1, 0).getDate();
    expect(due.getDate()).toBe(Math.min(31, monthDays));
    expect(localTime(due)).toBe(localTime('2026-02-28T07:00:00.000Z'));
    // Günlük seri v1'deki saatini korur.
    expect(localTime(get('İlaç').due_at)).toBe(localTime(new Date(now - 5 * 86_400_000)));
    // Zamanlayıcıya kuruldu.
    expect(scheduler.list('planner.reminder').length).toBe(5);
  });

  it('yapılacaklar: başlık, not, son gün, öncelik; bitmişler ve geçmiş hatırlatıcı notları isteğe bağlı', async () => {
    const options: ImportV1Options = { ...DEFAULT_IMPORT_OPTIONS, doneTodos: true, pastRemindersAsNotes: true };
    const result = await importer(dir).run(options);
    expect(result.imported).toMatchObject({ todos: 4, pastReminderNotes: 3 });
    const rows = env.store
      .scoped('core')
      .all<{ text: string; notes: string; done: number; due_day: string | null; priority: string; created_at: string; done_at: string | null }>(
        "SELECT * FROM planner_todos WHERE source = 'import' ORDER BY sort",
      );
    expect(rows[0]).toMatchObject({ text: 'Faturaları öde', notes: 'Proje: Fuber', done: 0, priority: 'high' });
    // Asıl zaman damgaları korunur: kayıt "bugün oluşturulmuş" görünmez, bitmiş iş bittiği günü taşır.
    const startedAt = Date.now() - 60_000;
    expect(rows.every((row) => Date.parse(row.created_at) < startedAt)).toBe(true);
    expect(rows[0]!.done_at).toBeNull();
    expect(rows.find((row) => row.text === 'Eski iş')!.done_at).toBe('2026-11-01T10:00:00.000Z');
    expect(rows[0]!.due_day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rows[1]!.text.length).toBe(300);
    expect(rows[1]!.notes.startsWith('Uzun başlık')).toBe(true);
    expect(rows.find((row) => row.text === 'Eski iş')).toMatchObject({ done: 1, notes: 'Eski uygulamada 1 Kasım 2026 günü tamamlandı.' });
    expect(rows.find((row) => row.text === 'Çağrı’yı ara')).toMatchObject({ notes: 'Sözleşme için', priority: 'low' });
    const notes = ctx.memory.list({ limit: 100 }).filter((item) => item.tags.includes('v1:hatirlatici'));
    expect(notes.map((note) => note.text).join('\n')).toMatch(/Eski hatırlatıcı \(.+\): Eski toplantı\. Durumu: çaldı\./);
    expect(notes.every((note) => note.kind === 'episode')).toBe(true);
  });

  it('aktarılan kayıt "yeni" sayılmaz: hafızada son değişme anı, hatırlatıcıda oluşturulma anı v1’deki tarihtir', async () => {
    const startedAt = Date.now() - 60_000;
    await importer(dir).run({ ...DEFAULT_IMPORT_OPTIONS, pastRemindersAsNotes: true });
    const imported = ctx.memory.list({ limit: 200 }).filter((item) => item.source === 'import' && item.tags.includes('v1'));
    expect(imported.length).toBeGreaterThan(5);
    // Tarihi okunabilen her kayıtta `updatedAt` kaydın kendi tarihidir (aktarım anı değil).
    const dated = imported.filter((item) => Date.parse(item.at) < startedAt);
    expect(dated.length).toBeGreaterThan(5);
    expect(dated.every((item) => item.updatedAt === item.at)).toBe(true);
    // Tarihi bozuk kayıt dürüstçe aktarım anını taşır.
    const undated = imported.find((item) => item.text.includes('İzmir’e gidildi'));
    expect(Date.parse(undated!.updatedAt)).toBeGreaterThanOrEqual(startedAt);
    const reminderRows = env.store.scoped('core').all<{ created_at: string }>("SELECT created_at FROM planner_reminders WHERE source = 'import'");
    expect(reminderRows.length).toBeGreaterThan(0);
    expect(reminderRows.every((row) => Date.parse(row.created_at) < startedAt)).toBe(true);
    // Hatırlatıcının hafızadaki "söz verilen iş" kaydı da aynı tarihi taşır.
    const commitments = ctx.memory.list({ limit: 200 }).filter((item) => item.source === 'import' && item.kind === 'commitment' && item.reminderId);
    expect(commitments.length).toBe(reminderRows.length);
    expect(commitments.every((item) => Date.parse(item.updatedAt) < startedAt)).toBe(true);
  });

  it('Planlar var olan kaydı döndürürse (kopya koruması) aktarıcı onu kendi kaydı saymaz: defterine yazmaz, geri almada silmez', async () => {
    const real = createImportSink(ctx);
    const existing = createPlannerImportApi(ctx).importReminder({ text: 'Elle kurulmuş hatırlatıcı', dueAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect(existing.created).toBe(true);
    // Hedef, aktarılan her hatırlatıcı için var olan kaydı döndürüyormuş gibi davranır (`null` = "benim değil").
    const deduping: ImportSink = { ...real, createReminder: () => null };
    const run = importer(dir, deduping);
    const result = await run.run(DEFAULT_IMPORT_OPTIONS);
    expect(result.imported.reminders).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM import_v1_items WHERE target_type = 'reminder'")).toBe(0);
    run.undo(run.status().lastRun!.id);
    expect(count('SELECT COUNT(*) AS n FROM planner_reminders')).toBe(1);
  });

  it('gizli kayıtlar ayrı onayla aktarılır', async () => {
    const result = await importer(dir).run({ ...DEFAULT_IMPORT_OPTIONS, includePrivate: true });
    expect(result.skipped.private).toBe(0);
    expect(result.imported).toMatchObject({ todos: 4, issueNotes: 2 });
  });

  it('ikinci çalıştırma kopya üretmez; v1 sonradan büyüse yalnız yeniler gelir', async () => {
    const run = importer(dir);
    await run.run(DEFAULT_IMPORT_OPTIONS);
    const before = { m: memories(), r: reminders(), t: todos(), l: ledger() };
    const again = await run.run(DEFAULT_IMPORT_OPTIONS);
    expect(again.imported).toEqual({ memories: 0, reminders: 0, todos: 0, issueNotes: 0, pastReminderNotes: 0 });
    expect(again.skipped.duplicates).toBe(18);
    expect({ m: memories(), r: reminders(), t: todos(), l: ledger() }).toEqual(before);
    // Boş koşu, ilk aktarımın geri alınmasını gizlemez.
    expect(run.status().lastRun).toMatchObject({ undoable: 17 });

    fixture!.addMemory('Yeni bilgi', 'v1 açıkken eklendi.');
    const third = await run.run(DEFAULT_IMPORT_OPTIONS);
    expect(third.imported.memories).toBe(1);
    const preview = await run.preview();
    expect(preview.alreadyImported).toMatchObject({ hafizalar: 9, hatirlaticilar: 5, gorevler: 3, meseleler: 1 });
  });

  it('geri alma aktarılan bütün kayıtları kaldırır; sonra yeniden aktarılabilir', async () => {
    const run = importer(dir);
    const first = await run.run(DEFAULT_IMPORT_OPTIONS);
    // Kullanıcı aktarılan bir yapılacağı kendisi silmiş olsun.
    const todoId = env.store.scoped('core').get<{ id: string }>("SELECT id FROM planner_todos WHERE source = 'import' LIMIT 1")!.id;
    env.store.scoped('core').run('DELETE FROM planner_todos WHERE id = ?', [todoId]);
    // Kullanıcının kendi kaydına dokunulmaz.
    const own = ctx.memory.save({ kind: 'fact', text: 'Kullanıcının kendi kaydı', source: 'user' });
    expect(run.status().lastRun).toMatchObject({ id: first.runId, undoable: 17 });

    const undone = run.undo(first.runId);
    expect(undone).toEqual({ runId: first.runId, removed: 16, alreadyGone: 1 });
    expect(memories() + reminders() + todos() + ledger()).toBe(0);
    expect(scheduler.list('planner.reminder').length).toBe(0);
    expect(ctx.memory.get(own.id)).not.toBeNull();
    expect(run.status().lastRun).toBeNull();
    expect(() => run.undo(first.runId)).toThrow(UserError);

    const again = await run.run(DEFAULT_IMPORT_OPTIONS);
    expect(again.imported.memories).toBe(8);
  });

  it('yarıda kesilen aktarım tümüyle geri alınır', async () => {
    const real = createImportSink(ctx);
    let calls = 0;
    const failing: ImportSink = {
      ...real,
      createTodo(input, done) {
        if (++calls === 2) throw new Error('disk dolu (sınama)');
        return real.createTodo(input, done);
      },
    };
    await expect(importer(dir, failing).run(DEFAULT_IMPORT_OPTIONS)).rejects.toThrow(/geri alındı; hiçbir kayıt eklenmedi/);
    expect(memories() + reminders() + todos() + ledger()).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM memory_items')).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM import_v1_runs')).toBe(0);
    expect(scheduler.list('planner.reminder').length).toBe(0);
  });

  it('v1 dosyalarına tek bayt yazılmaz: önizleme, aktarım ve geri alma öncesi ve sonrası özetler aynı', async () => {
    const before = fingerprint(dir);
    expect(Object.keys(before)).toEqual(['fuber.db', 'fuber.db-shm', 'fuber.db-wal']);
    const run = importer(dir);
    await run.preview();
    const result = await run.run({ ...DEFAULT_IMPORT_OPTIONS, doneTodos: true, pastRemindersAsNotes: true, includePrivate: true });
    run.undo(result.runId);
    expect(fingerprint(dir)).toEqual(before);
    // Geçici kopyalar silindi.
    expect(fs.readdirSync(path.join(work, 'temp'))).toEqual([]);
  });

  it('aynı anda ikinci iş başlatılamaz', async () => {
    const run = importer(dir);
    const first = run.preview();
    await expect(run.run(DEFAULT_IMPORT_OPTIONS)).rejects.toThrow(/zaten sürüyor/);
    await first;
  });
});

describe('v1 içe aktarma: eşleme kuralları', () => {
  it('tekrar kuralları ve öncelikler', () => {
    expect(recurrenceOf('yok')).toBeNull();
    expect(recurrenceOf(null)).toBeNull();
    expect(recurrenceOf('gunluk')).toEqual({ freq: 'daily', interval: 1 });
    expect(recurrenceOf('hafta_ici')).toEqual({ freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] });
    expect(recurrenceOf('aylik')).toEqual({ freq: 'monthly', interval: 1 });
    expect(recurrenceOf('yillik')).toBeUndefined();
    expect([1, 2, 3, 4, 5].map(todoPriorityOf)).toEqual(['low', 'low', 'normal', 'high', 'urgent']);
    expect([1, 2, 3, 4, 5].map(reminderPriorityOf)).toEqual(['normal', 'normal', 'high', 'high', 'urgent']);
    expect([1, 3, 5, null].map(importanceOf)).toEqual([0, 0.5, 1, 0.5]);
    expect(['kurulum', 'sohbet:3', 'gunkaydi:2026-10-01', '', 'sohbet:2, kullanici'].map(confidenceOf)).toEqual([1, 0.8, 0.7, 0.7, 1]);
  });

  it('aylık seride asıl gün geri kazanılır', () => {
    const clipped = new Date(2026, 1, 28, 10, 0);
    expect(monthlyAnchor(clipped, 31)).toEqual(new Date(2026, 0, 31, 10, 0));
    expect(monthlyAnchor(clipped, 28)).toEqual(clipped);
    expect(monthlyAnchor(clipped, null)).toEqual(clipped);
  });

  it('boş başlıklı kayıtta içerik tek başına metin olur; içerik başlıkla başlıyorsa yinelenmez', () => {
    const base = { id: 1, tur: 'bilgi', etiketler: '[]', onem: 3, sabit: 0, kaynak: '', olay_tarihi: null, olusturma: null, silindi: 0, gizli: null };
    const only = mapMemory({ ...base, baslik: '', icerik: 'Yalnız içerik' });
    expect(only.ok && only.value.text).toBe('Yalnız içerik');
    const same = mapMemory({ ...base, baslik: 'Atlas', icerik: 'Atlas Limited Ankara’da.' });
    expect(same.ok && same.value.text).toBe('Atlas Limited Ankara’da.');
  });
});

describe('sır deseni', () => {
  it('anahtar, parola, kart numarası ve belirteçleri yakalar', () => {
    for (const text of [
      'sk-' + 'ant-api03-AbCdEfGhIjKlMnOpQrStUv',
      'AKI' + 'AIOSFODNN7EXAMPLE',
      'ghp' + '_abcdefghijklmnopqrstuvwxyz0123456789',
      'Wi-Fi şifresi: ev12345',
      'Parola = Gizli!99',
      'Banka şifresi 445566',
      'password: hunter22',
      'kart 4111 1111 1111 1111',
      'postgres://admin:s3cr3t@db.example.com/app',
      '-----' + 'BEGIN OPENSSH PRIVATE KEY-----',
      'eyJ' + 'hbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N',
    ]) {
      expect(looksSecret(text), text).toBe(true);
    }
  });

  it('olağan cümleleri sır saymaz', () => {
    for (const text of [
      'Şifresini unuttuğunu söyledi, yenisini isteyecek.',
      'Parola yöneticisi olarak Bitwarden kullanıyor.',
      'Telefonu 0500 000 00 00.',
      'Vergi numarası 1234567890.',
      'Toplantı saat 14:00’te.',
    ]) {
      expect(looksSecret(text), text).toBe(false);
    }
  });
});
