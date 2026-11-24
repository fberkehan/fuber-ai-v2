// v1 `tests/cc-oturum.test.ts`, `cc-canli-ayar.test.ts` ve `cc-kredi.test.ts` senaryolarından `manager.test.ts`'te olmayanlar.
// Sahte Claude Code CLI ile gerçek süreç ve gerçek denetim protokolü; senaryo işaretleri sahte CLI'nin başındaki yorumda.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isAlive } from '../../../core/claude-cli/process';
import { INPUT_LIMIT } from '../../../core/claude-cli/session-events';
import { listedElsewhere } from './bridge';
import { cappedMode, modeSelectable, permissionEvent, startMode, type StartInput } from './manager';
import { createHarness, waitFor, type Harness } from './testkit';
import type { LiveImage, LiveModel } from './types';

let h: Harness;
const outputs: string[] = [];
afterEach(async () => {
  await h?.cleanup();
  for (const file of outputs.splice(0)) await fs.promises.rm(file, { force: true });
});

async function run(prompt: string, extra: Partial<StartInput> = {}): Promise<string> {
  const started = await h.manager.start({ cwd: h.dir, prompt, ...extra });
  expect(started.ok, started.error).toBe(true);
  return started.session!.id;
}
const results = (id: string, count: number, timeoutMs?: number) => waitFor(() => h.of('result', id).length >= count, `sonuç #${count}`, timeoutMs);
const lastText = (id: string): string => h.of('text', id).at(-1)?.text ?? '';
const summary = (id: string) => h.manager.summary(id)!;
const png = (count: number): LiveImage[] => Array.from({ length: count }, () => ({ mediaType: 'image/png' as const, data: 'iVBORw0KGgo=' }));
const flowing = (id: string) => waitFor(() => h.of('text_delta', id).length > 0, 'akış başladı');

describe('izin isteği olayı ve kip kuralları (saf)', () => {
  it('izin isteği: araç türü/özet, "hep" seçeneği önerilerle; soru kartı; ANSI temizlenir; uzun girdi kısaltılır', () => {
    const event = permissionEvent({
      requestId: 'r1',
      toolName: 'Write',
      input: { file_path: 'C:\\p\\b.md', content: 'y'.repeat(INPUT_LIMIT + 10) },
      suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }],
      decisionReason: '\u001b[31mdikkat\u001b[0m',
      defaultToNo: true,
      toolUseId: 't9',
      title: 'Claude yazmak istiyor',
    });
    expect(event).toMatchObject({ kind: 'edit', summary: 'C:\\p\\b.md', canAlways: true, reason: 'dikkat', defaultNo: true, toolUseId: 't9', truncated: true, title: 'Claude yazmak istiyor' });
    expect(event.input.content as string).toHaveLength(INPUT_LIMIT);
    // Kalıcı kural yasaklıysa ya da öneri yoksa "hep" sunulmaz.
    expect(permissionEvent({ requestId: 'r2', toolName: 'Bash', input: { command: 'ls' }, suggestions: [{}], suppressAlwaysAllow: true }).canAlways).toBe(false);
    expect(permissionEvent({ requestId: 'r3', toolName: 'Bash', input: { command: 'ls' }, suggestions: [] }).canAlways).toBe(false);
    const question = permissionEvent({
      requestId: 'r4',
      toolName: 'AskUserQuestion',
      input: { questions: [{ question: 'Hangisi?', header: 'Seç', multiSelect: true, options: [{ label: 'A', description: 'a' }, { label: 'B' }] }] },
      suggestions: [{}],
    });
    expect(question.questions).toEqual([{ question: 'Hangisi?', header: 'Seç', multiSelect: true, options: [{ label: 'A', description: 'a' }, { label: 'B' }] }]);
    expect(question.canAlways).toBe(false);
  });

  it('başlangıç kipi: istenen (seçilebiliyorsa) → kayıtlı varsayılan → her şeyi sor; tavan Tam yetkiyi indirir', () => {
    expect(startMode({ fullAccess: false, defaultMode: 'acceptEdits' })).toBe('acceptEdits');
    expect(startMode({ fullAccess: false, defaultMode: 'acceptEdits' }, 'plan')).toBe('plan');
    expect(startMode({ fullAccess: false, defaultMode: 'acceptEdits' }, 'bypassPermissions')).toBe('acceptEdits');
    expect(startMode({ fullAccess: true, defaultMode: 'acceptEdits' }, 'bypassPermissions')).toBe('bypassPermissions');
    expect(startMode({ fullAccess: false, defaultMode: 'bypassPermissions' })).toBe('default');
    expect(startMode({ fullAccess: true, defaultMode: 'default' }, 'auto')).toBe('default');
    expect([modeSelectable('bypassPermissions', false), modeSelectable('bypassPermissions', true), modeSelectable('plan', false)]).toEqual([false, true, true]);
    expect([cappedMode('bypassPermissions'), cappedMode('plan'), cappedMode('default')]).toEqual(['acceptEdits', 'plan', 'default']);
  });

  it('"başka yerde açık": etkin ajan listesinde oturum bizim olmayan bir süreçteyse', () => {
    const id = 'cccc0c0c-0000-4000-8000-00000000000c';
    expect(listedElsewhere('', id, new Set())).toBe(false);
    expect(listedElsewhere(JSON.stringify([{ sessionId: id, pid: 41 }]), id, new Set([41]))).toBe(false);
    expect(listedElsewhere(JSON.stringify([{ sessionId: id, pid: 41 }, { sessionId: id, pid: 77 }]), id, new Set([41]))).toBe(true);
    expect(listedElsewhere(JSON.stringify({ agents: [{ sessionId: id }] }), id, new Set([41]))).toBe(true);
    expect(listedElsewhere(JSON.stringify([{ sessionId: 'baska', pid: 5 }]), id, new Set())).toBe(false);
    // Ayrıştırılamayan çıktıda kimlik aranır.
    expect(listedElsewhere(`çalışan: ${id}`, id, new Set())).toBe(true);
  });
});

describe('izin: "hep izin ver" ve Tam yetki önerisi', () => {
  it('"hep" yalnız oturum kapsamına yazılır; Tam yetkiye geçiş önerisi ayar kapalıyken ve kısıtlı oturumda süzülür', async () => {
    h = createHarness();
    const closed = await run('#modoneri');
    await h.waitStatus(closed, 'permission');
    expect(h.manager.answerPermission(closed, h.permissions[0]!.request.requestId, { decision: 'always' })).toEqual({ ok: true });
    await results(closed, 1);
    expect(h.of('permission_resolved', closed)).toEqual([{ type: 'permission_resolved', requestId: h.permissions[0]!.request.requestId, decision: 'always' }]);
    const updates = JSON.parse(lastText(closed).replace('guncellemeler=', '')) as Array<{ type: string; destination: string }>;
    expect(updates.map((update) => [update.type, update.destination])).toEqual([['addRules', 'session']]);
    await h.cleanup();

    h = createHarness({ config: { fullAccess: true } });
    const open = await run('#modoneri');
    await h.waitStatus(open, 'permission');
    h.manager.answerPermission(open, h.permissions[0]!.request.requestId, { decision: 'always' });
    await results(open, 1);
    expect((JSON.parse(lastText(open).replace('guncellemeler=', '')) as Array<{ type: string; destination: string }>).map((update) => [update.type, update.destination])).toEqual([
      ['setMode', 'session'],
      ['addRules', 'session'],
    ]);
    // Asistanın başlattığı (kısıtlı) oturumda ayar açık olsa da Tam yetki önerisi geçmez.
    const restricted = await run('#modoneri', { source: 'assistant' });
    await h.waitStatus(restricted, 'permission');
    h.manager.answerPermission(restricted, h.permissions[1]!.request.requestId, { decision: 'always' });
    await results(restricted, 1);
    expect((JSON.parse(lastText(restricted).replace('guncellemeler=', '')) as Array<{ type: string }>).map((update) => update.type)).toEqual(['addRules']);
    // "İzin ver" hiçbir kural yazmaz.
    const once = await run('#modoneri');
    await h.waitStatus(once, 'permission');
    h.manager.answerPermission(once, h.permissions[2]!.request.requestId, { decision: 'allow' });
    await results(once, 1);
    expect(lastText(once)).toBe('guncellemeler=null');
  });

  it('soru yanıtı doğrulanır (eksik, fazla, geçersiz seçenek reddedilir; istek bekler); "Diğer" serbest metin ve çoklu seçim geçer', async () => {
    h = createHarness();
    const id = await run('#soru2');
    await h.waitStatus(id, 'permission');
    const requestId = h.permissions[0]!.request.requestId;
    const answer = (answers: Record<string, string | string[]>, freeText?: string[]) =>
      h.manager.answerPermission(id, requestId, { decision: 'allow', answers, ...(freeText ? { freeText } : {}) });
    expect(answer({ 'Hangi dil?': 'TypeScript' })).toMatchObject({ ok: false, code: 'bad_answer', error: 'Yanıtlanmamış soru: Hangi özellikler?' });
    expect(answer({ 'Hangi dil?': 'Rust', 'Hangi özellikler?': ['Test'] })).toMatchObject({ ok: false, code: 'bad_answer', error: 'Seçeneklerde yok: Rust' });
    expect(answer({ 'Hangi dil?': 'Python', 'Hangi özellikler?': 'Test', 'Uydurma?': 'x' })).toMatchObject({ ok: false, code: 'bad_answer' });
    expect(h.status(id)).toBe('permission');
    expect(h.manager.answerPermission(id, requestId, { decision: 'belki' as never })).toMatchObject({ ok: false, code: 'invalid' });
    expect(answer({ 'Hangi dil?': 'Rust', 'Hangi özellikler?': ['Test', 'CI'] }, ['Hangi dil?'])).toEqual({ ok: true });
    await results(id, 1);
    expect(lastText(id)).toBe('Yanıtlar: {"Hangi dil?":"Rust","Hangi özellikler?":"Test, CI"}');
  });
});

describe('Tam yetki', () => {
  it('ayar açıkken seçilir ve düzenleme sorulmaz; ayar kapanınca oturum "Düzenlemelere izin ver"e iner', async () => {
    h = createHarness({ config: { fullAccess: true, defaultMode: 'acceptEdits' } });
    const id = await run('#durum', { mode: 'bypassPermissions' });
    await results(id, 1);
    expect(lastText(id)).toMatch(/^mod=bypassPermissions /);
    await h.manager.send(id, { text: '#duzenle' });
    await results(id, 2);
    expect(h.permissions).toHaveLength(0);
    expect(summary(id).changedFiles).toBe(1);
    h.config.fullAccess = false;
    await h.manager.fullAccessRevoked();
    expect(summary(id).mode).toBe('acceptEdits');
    await h.manager.send(id, { text: '#durum' });
    await results(id, 3);
    expect(lastText(id)).toMatch(/^mod=acceptEdits /);
  });

  it('ayar kapandı ve kip değiştirilemedi → süreç kapatılır (Tam yetkide sürmez); sonraki tur "Düzenlemelere izin ver"', async () => {
    h = createHarness({ config: { fullAccess: true, defaultMode: 'bypassPermissions' } });
    const id = await run('#modreddet');
    await results(id, 1);
    expect(summary(id).mode).toBe('bypassPermissions');
    const pid = h.manager.pids()[0]!;
    h.config.fullAccess = false;
    await h.manager.fullAccessRevoked();
    expect(h.manager.pids()).toHaveLength(0);
    await waitFor(() => !isAlive(pid), 'süreç kapandı');
    expect(summary(id).mode).toBe('acceptEdits');
    await h.manager.send(id, { text: '#durum' });
    await results(id, 2);
    expect(lastText(id)).toMatch(/^mod=acceptEdits /);
  });

  it('ayar sonradan açılınca boştaki oturum Tam yetkiye geçer: süreç kapatılır, sonraki tur izinle açılır; çalışırken geçilemez', async () => {
    h = createHarness({ config: { defaultMode: 'acceptEdits' } });
    const id = await run('#durum');
    await results(id, 1);
    expect(lastText(id)).toMatch(/^mod=acceptEdits /);
    // Bu süreç de Tam yetki izni olmadan açıldı; çalışırken yeniden açılamaz.
    const busy = await run('#yavas:30');
    await h.waitStatus(busy, 'running');
    h.config.fullAccess = true;
    expect(await h.manager.setMode(id, 'bypassPermissions')).toEqual({ ok: true });
    expect(h.manager.pids()).toHaveLength(1);
    await h.manager.send(id, { text: '#durum' });
    await results(id, 2);
    expect(lastText(id)).toMatch(/^mod=bypassPermissions /);

    expect(await h.manager.setMode(busy, 'bypassPermissions')).toMatchObject({ ok: false, code: 'busy' });
    expect(await h.manager.setMode(busy, 'auto')).toMatchObject({ ok: false, code: 'invalid' });
    expect(await h.manager.setMode('yok', 'plan')).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('Tam yetkiye geçiş için yeniden açma sürerken gönderilen ileti Tam yetkiyle çalışır (eski kipte değil)', async () => {
    h = createHarness({ config: { defaultMode: 'acceptEdits' } });
    const id = await run('#durum');
    await results(id, 1);
    h.config.fullAccess = true;
    const switching = h.manager.setMode(id, 'bypassPermissions');
    expect(await h.manager.send(id, { text: '#durum' })).toEqual({ ok: true });
    expect(await switching).toEqual({ ok: true });
    await results(id, 2);
    expect(lastText(id)).toMatch(/^mod=bypassPermissions /);
  });

  it('asistandan gelen ileti sayfada açık Tam yetkili oturumu "Düzenlemelere izin ver"e indirir; indirilemezse ileti gitmez', async () => {
    h = createHarness({ config: { fullAccess: true } });
    const id = await run('#durum', { mode: 'bypassPermissions' });
    await results(id, 1);
    expect(await h.manager.send(id, { text: '#durum', source: 'assistant' })).toEqual({ ok: true });
    await results(id, 2);
    expect(lastText(id)).toMatch(/^mod=acceptEdits /);
    expect(summary(id).mode).toBe('acceptEdits');
    expect(h.of('system', id).some((event) => event.text.includes('indirildi'))).toBe(true);
    // Kısıt yalnız sayfada açıkça Tam yetki seçilince kalkar.
    expect(await h.manager.setMode(id, 'bypassPermissions')).toEqual({ ok: true });
    await h.manager.send(id, { text: '#durum' });
    await results(id, 3);
    expect(lastText(id)).toMatch(/^mod=bypassPermissions /);

    const stubborn = await run('#modreddet', { mode: 'bypassPermissions' });
    await results(stubborn, 1);
    const users = h.of('user', stubborn).length;
    expect(await h.manager.send(stubborn, { text: '#durum', source: 'assistant' })).toMatchObject({ ok: false, code: 'unsupported' });
    expect(h.of('user', stubborn)).toHaveLength(users);
    expect(summary(stubborn).mode).toBe('bypassPermissions');
  });

  it('kısıtlı oturumda düzenleme koruması: kanca neden döndürünce "Düzenlemelere izin ver"de de izin sorulur; sayfa oturumunda sorulmaz', async () => {
    const guarded: Array<{ cwd: string; tool: string }> = [];
    h = createHarness({
      config: { defaultMode: 'acceptEdits' },
      deps: {
        guardEdit: (cwd, tool) => {
          guarded.push({ cwd, tool });
          return 'Oturum klasörünün dışına yazım onayınıza sunulur.';
        },
      },
    });
    const page = await run('#yaz:sayfa.txt');
    await results(page, 1);
    expect(h.permissions).toHaveLength(0);
    expect(guarded).toHaveLength(0);
    expect(fs.existsSync(path.join(h.dir, 'sayfa.txt'))).toBe(true);

    const assistant = await run('#yaz:asistan.txt', { source: 'assistant' });
    await h.waitStatus(assistant, 'permission');
    expect(guarded).toEqual([{ cwd: h.dir, tool: 'Write' }]);
    expect(h.permissions[0]!.request).toMatchObject({ tool: 'Write', kind: 'edit' });
    expect(fs.existsSync(path.join(h.dir, 'asistan.txt'))).toBe(false);
    h.manager.answerPermission(assistant, h.permissions[0]!.request.requestId, { decision: 'deny' });
    await results(assistant, 1);
    expect(fs.existsSync(path.join(h.dir, 'asistan.txt'))).toBe(false);
  });
});

describe('kuyruk ve sınırlar', () => {
  it('eşzamanlı sınırda bekleyen iletiler görünür ve kaldırılabilir; boş, çok uzun ve sınırı aşan ileti reddedilir; görseller süzülür', async () => {
    h = createHarness({ config: { maxConcurrent: 1 } });
    const busy = await run('#yavas:30');
    await h.waitStatus(busy, 'running');
    const waiting = await run('ilk');
    expect(summary(waiting)).toMatchObject({ status: 'queued', queuePosition: 1, queued: 1 });
    expect(await h.manager.send(waiting, { text: 'iki', images: [...png(1), { mediaType: 'text/html' as never, data: 'x' }] })).toEqual({ ok: true });
    expect(await h.manager.send(waiting, { text: '', images: png(12) })).toEqual({ ok: true });
    const queue = h.manager.detail(waiting)!.queue;
    expect(queue.map((item) => [item.text, item.images])).toEqual([
      ['ilk', 0],
      ['iki', 1],
      ['', 10],
    ]);
    expect(await h.manager.send(waiting, { text: '   ' })).toMatchObject({ ok: false, code: 'empty' });
    expect(await h.manager.send(waiting, { text: 'x'.repeat(200_001) })).toMatchObject({ ok: false, code: 'too_large' });
    expect(await h.manager.send('yok', { text: 'x' })).toMatchObject({ ok: false, code: 'not_found' });
    // Bekleyen iletilerdeki görseller toplamda sınırlıdır.
    expect(await h.manager.send(waiting, { text: 'dört', images: png(9) })).toEqual({ ok: true });
    expect(await h.manager.send(waiting, { text: 'beş', images: png(1) })).toMatchObject({ ok: false, code: 'too_large' });
    expect(h.manager.removeQueued(waiting, queue[1]!.id)).toEqual({ ok: true });
    expect(h.manager.removeQueued(waiting, queue[1]!.id)).toMatchObject({ ok: false, code: 'not_found' });
    expect(summary(waiting).queued).toBe(3);

    // "Durdur" bekleyen iletileri de atar ve oturumu sıradan çıkarır; `keepQueue` ile kalırlar.
    expect(await h.manager.interrupt(waiting, { keepQueue: true })).toEqual({ ok: true });
    expect(summary(waiting)).toMatchObject({ status: 'queued', queued: 3 });
    expect(await h.manager.interrupt(waiting)).toEqual({ ok: true });
    expect(summary(waiting).queued).toBe(0);
    expect(summary(waiting).status).not.toBe('queued');
    expect(h.of('result', waiting)).toHaveLength(0);

    const full = await run('1');
    for (let index = 2; index <= 50; index++) expect((await h.manager.send(full, { text: String(index) })).ok).toBe(true);
    expect(await h.manager.send(full, { text: '51' })).toMatchObject({ ok: false, code: 'queue_full' });
    // Yer açılınca sıradaki oturum başlar ve bekleyen iletilerin hepsi sırayla işlenir.
    await h.manager.interrupt(full, { keepQueue: true });
    await h.manager.removeQueued(full, h.manager.detail(full)!.queue[49]!.id);
    await h.manager.interrupt(busy);
    await results(full, 49, 30_000);
    expect(h.of('user', full).map((event) => event.text)).toEqual(Array.from({ length: 49 }, (_, index) => String(index + 1)));
  }, 40_000);

  it('"Durdur" tur sürerken yazılmış ama henüz işlenmemiş iletiyi de iptal eder; `keepQueue` ile ileti sonra işlenir', async () => {
    h = createHarness();
    const id = await run('#yavas:30');
    await flowing(id);
    await h.manager.send(id, { text: '#durum' });
    await h.manager.interrupt(id);
    await h.waitStatus(id, 'stopped');
    await h.manager.send(id, { text: 'işaret' });
    await waitFor(() => lastText(id).includes('yanıtı: işaret'), 'işaret yanıtı');
    await h.waitStatus(id, 'done');
    expect(h.of('result', id)).toHaveLength(2);
    expect(h.of('text', id).some((event) => event.text.startsWith('mod='))).toBe(false);

    const kept = await run('#yavas:30');
    await flowing(kept);
    await h.manager.send(kept, { text: '#durum' });
    await h.manager.interrupt(kept, { keepQueue: true });
    await waitFor(() => lastText(kept).startsWith('mod='), 'bırakılan ileti işlendi');
    await h.waitStatus(kept, 'done');
    expect(h.of('result', kept).map((event) => event.interrupted)).toEqual([true, false]);
  });

  it('kapalı oturum kayıtları sınırlı (en eskiler unutulur); "unut" kaydı siler', async () => {
    h = createHarness({ deps: { maxClosed: 2 } });
    const ids: string[] = [];
    for (let index = 0; index < 4; index++) {
      const started = await h.manager.start({ cwd: h.dir });
      ids.push(started.session!.id);
      expect(started.session!.status).toBe('idle');
      // Sıralama son etkinlik anına göre: kayıtların anları ayrışsın.
      const stamp = started.session!.createdAt;
      await waitFor(() => Date.now() > stamp + 2, 'saat ilerledi');
    }
    for (const id of ids) await h.manager.close(id);
    expect(h.manager.sessions().map((session) => session.id).sort()).toEqual(ids.slice(2).sort());
    expect(ids.slice(0, 2).map((id) => h.of('forgotten', id).length)).toEqual([1, 1]);
    expect(await h.manager.forget(ids[3]!)).toEqual({ ok: true });
    expect(h.manager.summary(ids[3]!)).toBeNull();
    expect(h.of('forgotten', ids[3]!)).toHaveLength(1);
    expect(await h.manager.close('yok')).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('süreç sınırı: boştaki oturum budanır ama arka planda işi süren oturumun süreci KAPATILMAZ', async () => {
    h = createHarness({ config: { maxConcurrent: 1 }, deps: { maxLiveProcesses: 2 } });
    const a = await run('#arkaplan');
    await h.waitStatus(a, 'done');
    const b = await run('#durum');
    await h.waitStatus(b, 'done');
    const before = h.manager.pids();
    expect(before).toHaveLength(2);
    const c = await run('#durum');
    await h.waitStatus(c, 'done');
    await waitFor(() => !isAlive(before[1]!), 'B süreci kapandı');
    expect(isAlive(before[0]!)).toBe(true);
    expect(summary(a).background).toBe(1);
    expect(summary(b).background).toBe(0);
    // Budanan oturum sonraki iletide --resume ile açılır.
    await h.manager.send(b, { text: '#bayraklar' });
    await results(b, 2);
    expect(lastText(b)).toContain(`"--resume","${summary(b).sessionId}"`);
    // A'nın işi bitince sayı 0.
    await h.manager.send(a, { text: '#arkabit' });
    await results(a, 2);
    expect(summary(a).background).toBe(0);
  });
});

describe('döküm: araç kartları, alt ajan, yapılacaklar', () => {
  it('"her şeyi sor"da düzenleme izin ister; reddedilen sayılmaz; araç kartları, alt ajan (iç içe) ve yapılacaklar', async () => {
    h = createHarness();
    const id = await run('#duzenle');
    await h.waitStatus(id, 'permission');
    expect(h.permissions[0]!.request).toMatchObject({ kind: 'edit', tool: 'Edit' });
    expect(h.permissions[0]!.request.input.new_string).toBe('yeni satır');
    h.manager.answerPermission(id, h.permissions[0]!.request.requestId, { decision: 'deny' });
    await results(id, 1);
    expect(summary(id).changedFiles).toBe(0);
    await h.manager.send(id, { text: '#duzenle' });
    await waitFor(() => h.permissions.length === 2, 'ikinci izin');
    h.manager.answerPermission(id, h.permissions[1]!.request.requestId, { decision: 'allow' });
    await results(id, 2);
    expect(summary(id).changedFiles).toBe(1);

    await h.manager.send(id, { text: '#arac' });
    await results(id, 3);
    const tools = h.of('tool_start', id).slice(-2);
    expect(tools.map((event) => [event.name, event.kind])).toEqual([
      ['Read', 'read'],
      ['Grep', 'search'],
    ]);
    expect(h.of('tool_end', id).slice(-2).map((event) => event.output)).toEqual(['1\t# Sahte proje', 'Bulunamadı']);

    await h.manager.send(id, { text: '#alt' });
    await results(id, 4);
    const agent = h.of('subagent', id)[0]!;
    expect(agent).toMatchObject({ description: 'Dosyaları tara', agentType: 'general-purpose', parent: null });
    expect(h.of('tool_start', id).at(-1)).toMatchObject({ name: 'Read', parent: agent.id });
    expect(h.of('tool_end', id).find((event) => event.id === agent.id)!.output).toMatch(/Alt ajan raporu/);

    await h.manager.send(id, { text: '#yapilacak' });
    await results(id, 5);
    const todos = h.of('todos', id)[0]!;
    expect(todos.items.map((item) => item.status)).toEqual(['done', 'in_progress']);
    // TodoWrite sonucu kart olmaz.
    expect(h.of('tool_end', id).some((event) => event.id === todos.id)).toBe(false);
    expect(h.manager.detail(id)!.todos.map((item) => item.content)).toEqual(['Testleri yaz', 'Belgeyi güncelle']);
    // Belirteçler tur bitince birikir.
    expect(summary(id).usage).toEqual({ input: 600, output: 170, cacheRead: 250, cacheWrite: 50 });
    expect(h.manager.detail(id)!.usage).toEqual(summary(id).usage);
  });

  it('TaskCreate/TaskUpdate/TaskList yapılacaklar listesini kurar (kart olmaz)', async () => {
    h = createHarness();
    const id = await run('#gorev');
    await results(id, 1);
    expect(h.manager.detail(id)!.todos).toEqual([
      { content: 'Testleri yaz', status: 'in_progress', taskId: '1', activeForm: 'Testler yazılıyor' },
      { content: 'Belgeyi güncelle', status: 'done', taskId: '2' },
    ]);
    expect(h.of('tool_start', id)).toHaveLength(0);
  });

  it('tur bittikten sonra gelen alt ajan metni oturumu yeniden "çalışıyor" yapmaz', async () => {
    h = createHarness();
    const id = await run('#gecalt');
    await h.waitStatus(id, 'done');
    await waitFor(() => h.of('text', id).some((event) => event.parent === 'toolu_arka_ajan'), 'geç alt ajan metni');
    expect(h.status(id)).toBe('done');
    expect(h.turnEnds).toHaveLength(1);
    // Ana konuşmanın son metni alt ajanınkiyle ezilmez.
    expect(h.turnEnds[0]!.info.lastText).toBe('Ana tur bitti.');
  });
});

describe('arka plan işleri', () => {
  it('sayı özete girer, tur bitse de sürer; son iş bitince 0; süreç kapanınca sıfırlanır', async () => {
    h = createHarness();
    const id = await run('#arkaplan');
    await h.waitStatus(id, 'done');
    expect(h.of('result', id)[0]!.ok).toBe(true);
    expect(summary(id).background).toBe(1);
    expect(h.of('background', id)).toEqual([{ type: 'background', count: 1 }]);
    const seq = (type: string) => h.events.find((envelope) => envelope.session === id && envelope.event.type === type)!.seq;
    // Sayı sonuçtan ÖNCE gelir.
    expect(seq('background')).toBeLessThan(seq('result'));
    await waitFor(() => h.turnEnds.length === 1, 'bitiş');
    expect(h.turnEnds[0]!.summary.background).toBe(1);
    await h.manager.send(id, { text: '#arkabit' });
    await results(id, 2);
    expect(summary(id).background).toBe(0);
    await h.manager.send(id, { text: '#arkaplan' });
    await results(id, 3);
    expect(summary(id).background).toBe(1);
    expect(h.manager.detail(id)!.tasks).toMatchObject([{ id: 'gorev-1', kind: 'agent', status: 'running', backgrounded: true, description: 'Sahte arka plan ajanı' }]);
    await h.manager.close(id);
    expect(summary(id).background).toBe(0);
    expect(h.of('background', id).at(-1)).toEqual({ type: 'background', count: 0 });
    // Süreç öldü: süren iş "durduruldu" görünür, sessizce kaybolmaz.
    expect(h.manager.detail(id)!.tasks).toMatchObject([{ id: 'gorev-1', status: 'stopped' }]);
  });

  it('arka plan kabuk işi: ad, canlı süre, çıktı kuyruğu; durdurma; dökümde iş listesi tutulmaz', async () => {
    h = createHarness();
    const id = await run('#arkakabuk');
    await results(id, 1);
    const task = await waitFor(() => h.manager.detail(id)!.tasks.find((item) => item.kind === 'shell' && (item.elapsedSec ?? 0) >= 1), 'canlı süre');
    outputs.push(task.outputFile!);
    expect(task).toMatchObject({ description: 'Geliştirme sunucusu', status: 'running', backgrounded: true });
    expect(task.outputFile).toMatch(/\.output$/);
    expect(summary(id).background).toBe(1);
    // İş sürerken oturum "bitti" kalır (ilerleme iletileri turu yeniden açmaz).
    expect(h.status(id)).toBe('done');
    await waitFor(() => h.manager.taskOutput(id, task.id).lines.some((line) => /satır 2:/.test(line)), 'çıktı satırları');
    const tail = h.manager.taskOutput(id, task.id, 3);
    expect(tail.lines.length).toBeLessThanOrEqual(3);
    expect(tail.bytes).toBeGreaterThan(0);
    expect(h.manager.detail(id)!.events.filter((envelope) => envelope.event.type === 'tasks')).toHaveLength(0);
    expect(await h.manager.stopTask(id, task.id)).toEqual({ ok: true });
    await waitFor(() => h.manager.detail(id)!.tasks.find((item) => item.id === task.id)?.status === 'stopped', 'iş durdu');
    await waitFor(() => summary(id).background === 0, 'sayı 0');
    expect(await h.manager.stopTask(id, 'yok-böyle')).toMatchObject({ ok: false, code: 'not_found' });
    expect(h.manager.taskOutput(id, 'yok').error).toBeTruthy();
    // Durmuş işi yeniden durdurmak hata değildir.
    expect(await h.manager.stopTask(id, task.id)).toEqual({ ok: true });
  });

  it('ön plandaki iş "arka plana al" ile arkaya geçer ve tur biter; araç kimliği olmayan iş tek başına alınamaz', async () => {
    h = createHarness();
    const id = await run('#onplan:20');
    const task = await waitFor(() => h.manager.detail(id)?.tasks.find((item) => item.status === 'running' && !item.backgrounded), 'ön plan işi');
    expect(h.status(id)).toBe('running');
    expect(await h.manager.backgroundTask(id, task.id)).toEqual({ ok: true });
    await results(id, 1);
    expect(h.of('result', id)[0]!.ok).toBe(true);
    const moved = await waitFor(() => h.manager.detail(id)!.tasks.find((item) => item.id === task.id && item.backgrounded), 'iş arkada');
    outputs.push(moved.outputFile!);
    expect(summary(id).background).toBe(1);
    expect(lastText(id)).toMatch(/arka plana alındı/);
    // Zaten arkadaki iş için istek yinelenmez.
    expect(await h.manager.backgroundTask(id, task.id)).toEqual({ ok: true });

    const bare = await run('#kimliksiz:20');
    const orphan = await waitFor(() => h.manager.detail(bare)?.tasks.find((item) => item.id === 'kimliksiz-1'), 'kimliksiz iş');
    expect(orphan.toolUseId).toBeUndefined();
    expect(await h.manager.backgroundTask(bare, orphan.id)).toMatchObject({ ok: false, code: 'unsupported' });
    await h.manager.interrupt(bare);
    await h.waitStatus(bare, 'stopped');
  });
});

describe('model, efor, maliyet, hesap', () => {
  it('efor canlı oturumda değişir (süreç yeniden açılmadan); `null` varsayılana döner; geçersiz değer reddedilir', async () => {
    h = createHarness();
    const id = await run('#durum', { effort: 'high' });
    await results(id, 1);
    expect(lastText(id)).toMatch(/efor=high /);
    expect(summary(id).effort).toBe('high');
    const pid = h.manager.pids()[0];
    expect(await h.manager.setEffort(id, 'low')).toEqual({ ok: true });
    expect(summary(id).effort).toBe('low');
    await h.manager.send(id, { text: '#durum' });
    await results(id, 2);
    expect(lastText(id)).toMatch(/efor=low /);
    expect(h.manager.pids()[0]).toBe(pid);
    expect(await h.manager.setEffort(id, null)).toEqual({ ok: true });
    expect(summary(id).effort).toBeUndefined();
    await h.manager.send(id, { text: '#durum' });
    await results(id, 3);
    expect(lastText(id)).toMatch(/efor=- /);
    expect(await h.manager.setEffort(id, 'çok')).toMatchObject({ ok: false, code: 'invalid' });
    for (const effort of ['--dangerously-skip-permissions', 'dev', 5, {}]) {
      expect(await h.manager.start({ cwd: h.dir, prompt: 'x', effort: effort as never }), String(effort)).toMatchObject({ ok: false, code: 'invalid' });
    }
  });

  it('Claude Code canlı efor isteğini tanımıyorsa değer kayda yazılır (`next_turn`); sonraki ileti yeni süreçle o güçte', async () => {
    h = createHarness({ env: { SAHTE_CC_EFOR_RET: '1' } });
    const id = await run('#durum');
    await h.waitStatus(id, 'done');
    expect(await h.manager.setEffort(id, 'max')).toEqual({ ok: true, code: 'next_turn' });
    expect(summary(id).effort).toBe('max');
    expect(h.manager.pids()).toHaveLength(0);
    await h.manager.send(id, { text: '#durum' });
    await results(id, 2);
    expect(lastText(id)).toMatch(/efor=max /);
  });

  it('canlıda uygulanamayan efor arkada iş sürerken bekler; iş bitince süreç yeniden açılır, sonraki ileti yeni güçte', async () => {
    h = createHarness({ env: { SAHTE_CC_EFOR_RET: '1' } });
    const id = await run('#arkaplan');
    await h.waitStatus(id, 'done');
    await waitFor(() => summary(id).background === 1, 'arka plan işi');
    const pid = h.manager.pids()[0]!;
    expect(await h.manager.setEffort(id, 'max')).toEqual({ ok: true, code: 'next_turn' });
    // Arkada iş varken süreç kapatılmaz (iş ölmesin).
    expect(h.manager.pids()).toEqual([pid]);
    await h.manager.send(id, { text: '#arkabit' });
    await results(id, 2);
    await waitFor(() => h.manager.pids().length === 0, 'iş bitince süreç kapandı');
    await h.manager.send(id, { text: '#durum' });
    await results(id, 3);
    expect(lastText(id)).toMatch(/efor=max /);
  });

  it('init’in tam model kimliği kullanıcının seçimini ezmez; tam kimlik `activeModel`de', async () => {
    h = createHarness({
      env: {
        SAHTE_CC_TAM_KIMLIK: '1',
        SAHTE_CC_MODELLER: JSON.stringify([
          { value: 'default', displayName: 'Default (recommended)', description: 'Opus' },
          { value: 'sonnet', displayName: 'Sonnet', description: 'Sonnet 4.5' },
        ]),
      },
    });
    const id = await run('#durum');
    await results(id, 1);
    expect(summary(id).model).toBeUndefined();
    expect(summary(id).activeModel).toBe('claude-opus-4-5-20251101');
    expect(await h.manager.setModel(id, 'sonnet')).toEqual({ ok: true });
    await h.manager.send(id, { text: '#durum' });
    await results(id, 2);
    expect(lastText(id)).toMatch(/model=sonnet /);
    expect(summary(id)).toMatchObject({ model: 'sonnet', activeModel: 'claude-sonnet-4-5-20250929' });
    expect(h.of('init', id).at(-1)!.model).toBe('claude-sonnet-4-5-20250929');
    expect(await h.manager.setModel(id, null)).toEqual({ ok: true });
    await h.manager.send(id, { text: '#durum' });
    await results(id, 3);
    expect(summary(id).model).toBeUndefined();
    expect(await h.manager.setModel(id, '--x')).toMatchObject({ ok: false, code: 'invalid' });
  });

  it('model listesi oturumdan gelince saklanır; oturum yokken saklı liste, o da yoksa varsayılan takma adlar; bozuk kayıt girmez', async () => {
    let stored: LiveModel[] | null = null;
    const models = { read: () => stored, write: (list: LiveModel[]) => void (stored = list) };
    h = createHarness({ deps: { models } });
    expect(h.manager.models().map((model) => model.value)).toEqual(['default', 'opus', 'sonnet', 'haiku']);
    const id = await run('#durum');
    await results(id, 1);
    await waitFor(() => stored !== null, 'liste saklandı');
    expect(stored!.map((model) => [model.value, model.label])).toEqual([
      ['default', 'Varsayılan'],
      ['claude-sahte-hizli', 'Hızlı'],
    ]);
    expect(h.manager.models().map((model) => model.value)).toEqual(['default', 'claude-sahte-hizli']);
    expect(h.manager.detail(id)!.commands.map((command) => command.name)).toEqual(['compact', 'clear', 'sahte-beceri']);
    await h.cleanup();
    // Uygulama yeniden açılınca (yeni yönetici, oturum yok) saklı liste okunur.
    h = createHarness({ deps: { models } });
    expect(h.manager.models().map((model) => model.value)).toEqual(['default', 'claude-sahte-hizli']);
    await h.cleanup();
    h = createHarness({ deps: { models: { read: () => [{ value: '--x', label: 'Kötü', description: '' }, { value: '', label: '', description: '' }, 'bozuk'], write: () => undefined } } });
    expect(h.manager.models().map((model) => model.value)).toEqual(['default', 'opus', 'sonnet', 'haiku']);
  });

  it('tahmini dolar yalnız API anahtarıyla çalışan oturumda görünür; abonelikte ve kaynak bilinmiyorken özete girmez', async () => {
    for (const source of ['none', '-', 'oauth', 'user']) {
      h = createHarness({ env: { SAHTE_CC_API_KAYNAK: source } });
      const id = await run('merhaba');
      await results(id, 1);
      const result = h.of('result', id)[0]!;
      // Tahmin tutarı Claude Code'dan gelir ama gösterilmez.
      expect(result.costUsd, source).toBeGreaterThan(0);
      expect(result.showCost, source).toBe(false);
      expect(summary(id).costUsd, source).toBeUndefined();
      await h.cleanup();
    }
    for (const source of ['ANTHROPIC_API_KEY', 'apiKeyHelper', '/login managed key']) {
      h = createHarness({ env: { SAHTE_CC_API_KAYNAK: source } });
      const id = await run('merhaba');
      await results(id, 1);
      expect(h.of('result', id)[0]!.showCost, source).toBe(true);
      expect(summary(id).costUsd, source).toBe(0.0012);
      await h.cleanup();
    }
  }, 20_000); // yük altında (başka sınamalar koşarken) 5 sn yetmedi: zamana bağlı değil, süreç açılışına bağlı

  it('hesap: el sıkışmadan yalnız e-posta ve plan; kuruluş adı ve belirteç kaynağı dışarı çıkmaz', async () => {
    const accounts: Array<{ email?: string; plan?: string } | null> = [];
    h = createHarness({
      env: { SAHTE_CC_HESAP: JSON.stringify({ email: 'deniz@ornek.test', subscriptionType: 'max', organization: 'Gizli Kuruluş', tokenSource: 'claude.ai', apiKeySource: 'none' }) },
      deps: { onAccount: (account) => void accounts.push(account) },
    });
    const id = await run('merhaba');
    await results(id, 1);
    await waitFor(() => accounts.length === 1, 'hesap');
    expect(accounts).toEqual([{ email: 'deniz@ornek.test', plan: 'max' }]);
    expect(JSON.stringify(h.events)).not.toContain('Gizli Kuruluş');
  });
});

describe('gerçek hata biçimleri', () => {
  it('kredi, oturum, ağ, ham 401, sınır: Türkçe tek cümle; ham İngilizce metin, JSON ve istek kimliği dökümde yok', async () => {
    h = createHarness();
    const cases: Array<{ mark: string; status: 'error' | 'limit'; errorClass: string; text: RegExp; raw: RegExp }> = [
      { mark: '#kredi', status: 'error', errorClass: 'billing', text: /kredi ya da ödeme sorunu/, raw: /Credit balance/ },
      { mark: '#girisyok', status: 'error', errorClass: 'auth', text: /oturum açın/, raw: /Invalid API key|\/login/ },
      { mark: '#ag', status: 'error', errorClass: 'network', text: /internet bağlantınızı/, raw: /ConnectionRefused|API Error/ },
      { mark: '#ham401', status: 'error', errorClass: 'auth', text: /oturum açın/, raw: /req_011|authentication_error|x-api-key/ },
      { mark: '#limit', status: 'limit', errorClass: 'limit', text: /sıfırlanma: 5pm \(Europe\/Istanbul\)/, raw: /hit your limit/ },
    ];
    for (const item of cases) {
      const id = await run(item.mark);
      await h.waitStatus(id, item.status);
      const result = h.of('result', id)[0]!;
      expect(result, item.mark).toMatchObject({ ok: false, errorClass: item.errorClass, errorShown: true });
      expect(result.error, item.mark).toMatch(item.text);
      const shown = h.of('system', id).filter((event) => event.level === 'error');
      expect(shown, item.mark).toHaveLength(1);
      expect(shown[0]!.text, item.mark).toMatch(item.text);
      const transcript = JSON.stringify(h.manager.detail(id)!.events);
      expect(transcript, item.mark).not.toMatch(item.raw);
      expect(h.turnEnds.at(-1)!.info.result.errorClass, item.mark).toBe(item.errorClass);
    }
    // Ağ hatasında yeniden denemeler uyarı olarak görünür.
    const network = h.manager.sessions().find((session) => session.title === '#ag')!;
    expect(h.of('system', network.id).filter((event) => event.level === 'warn').map((event) => event.text)).toEqual([
      'Claude’a ulaşılamadı; yeniden deneniyor (1/10).',
      'Claude’a ulaşılamadı; yeniden deneniyor (2/10).',
    ]);
    // Hata veren tur oturumu kilitlemez: sonraki ileti aynı süreçle sürer.
    await h.manager.send(network.id, { text: 'devam' });
    await h.waitStatus(network.id, 'done');
  });

  it.runIf(process.platform === 'win32')('süreç hiç başlatılamazsa tek bir hata bildirilir (ileti kaybolmaz, sonraki denemede gider)', async () => {
    let broken = true;
    h = createHarness({ cli: () => (broken ? { command: path.join(h.dir, 'yok.cmd'), prefixArgs: [] } : { command: process.execPath, prefixArgs: [path.resolve(h.dir, '..', '..', 'yok.mjs')] }) });
    const started = await h.manager.start({ cwd: h.dir, prompt: 'selam' });
    const id = started.session!.id;
    await h.waitStatus(id, 'error');
    await waitFor(() => h.errors.length >= 1, 'hata bildirimi');
    expect(h.manager.detail(id)!.queue.map((item) => item.text)).toEqual(['selam']);
    expect(h.errors).toHaveLength(1);
    expect(h.of('system', id).filter((event) => event.level === 'error')).toHaveLength(1);
    broken = false;
  });
});

describe('izler, sohbet işleri, güven', () => {
  it('süreç çıkınca PID unutulur ama kısa süre bizim sayılır; kapanış anı kaydedilir; çatalın kaynağı bizim sayılmaz', async () => {
    h = createHarness();
    const resumeId = 'cccc0c0c-0000-4000-8000-00000000000c';
    const id = await run('#durum', { resume: resumeId });
    await results(id, 1);
    const pid = h.manager.pids()[0]!;
    expect(h.manager.traces().live.has(resumeId)).toBe(true);
    expect(h.manager.traces().pids.has(pid)).toBe(true);
    expect(h.manager.manages(resumeId)).toBe(true);
    const before = Date.now();
    await h.manager.close(id);
    expect(h.manager.pids()).toEqual([]);
    const traces = h.manager.traces();
    expect(traces.live.has(resumeId)).toBe(false);
    expect(traces.closedAt.get(resumeId)).toBeGreaterThanOrEqual(before);
    // Az önce kapattığımız süreç etkin ajan listesinde hâlâ görünse de "başka yerde" sayılmaz.
    expect(listedElsewhere(JSON.stringify([{ sessionId: resumeId, pid }]), resumeId, traces.pids)).toBe(false);
    expect(h.manager.manages(resumeId)).toBe(true);

    const forked = await run('#durum', { resume: resumeId, fork: true });
    await results(forked, 1);
    const forkId = summary(forked).sessionId!;
    expect(forkId).not.toBe(resumeId);
    expect([h.manager.traces().live.has(forkId), h.manager.traces().live.has(resumeId)]).toEqual([true, false]);

    // Çöken sürecin PID'i de unutulur.
    const crashed = await run('#cok');
    await h.waitStatus(crashed, 'error');
    await waitFor(() => h.manager.pids().length === 1, 'yalnız çatalın süreci yaşıyor');
  });

  it('sırada bekleyen sohbet işi Durdur/Kapat ile atılınca sohbete bir kez "durduruldu"; sonraki sayfa turu eski sohbete yazmaz', async () => {
    h = createHarness({ config: { maxConcurrent: 1 } });
    const busy = await run('#yavas:30');
    await h.waitStatus(busy, 'running');
    const job = await run('#durum', { source: 'assistant', chatSessionId: 'sohbet-5' });
    expect(h.status(job)).toBe('queued');
    await h.manager.interrupt(job);
    const ends = () => h.turnEnds.filter((entry) => entry.summary.id === job).map((entry) => [entry.info.chatSessionId, entry.info.result.interrupted]);
    expect(ends()).toEqual([['sohbet-5', true]]);
    await h.manager.interrupt(busy);
    await h.waitStatus(busy, 'stopped');
    await h.manager.send(job, { text: '#durum' });
    await results(job, 1);
    await waitFor(() => ends().length === 2, 'sayfa turu bitti');
    expect(ends()).toEqual([
      ['sohbet-5', true],
      [undefined, false],
    ]);

    const busy2 = await run('#yavas:30');
    await h.waitStatus(busy2, 'running');
    const job2 = await run('#durum', { source: 'assistant', chatSessionId: 'sohbet-6' });
    await h.manager.close(job2);
    expect(h.turnEnds.filter((entry) => entry.summary.id === job2).map((entry) => [entry.info.chatSessionId, entry.info.result.interrupted])).toEqual([['sohbet-6', true]]);
  });

  it('sohbet işi çökerse ya da çalışırken kapatılırsa sohbete bildirilir', async () => {
    h = createHarness();
    const crashed = await run('#cok', { source: 'assistant', chatSessionId: 'sohbet-8' });
    await waitFor(() => h.errors.some((entry) => entry.summary.id === crashed), 'çökme bildirimi');
    expect(h.errors.find((entry) => entry.summary.id === crashed)!.chatSessionId).toBe('sohbet-8');
    const long = await run('#yavas:30', { source: 'assistant', chatSessionId: 'sohbet-9' });
    await flowing(long);
    await h.manager.close(long);
    const closed = h.turnEnds.filter((entry) => entry.summary.id === long);
    expect(closed.map((entry) => [entry.info.chatSessionId, entry.info.result.interrupted])).toEqual([['sohbet-9', true]]);
    expect(h.status(long)).toBe('closed');
  });

  it('güven kararı değişince klasörün boştaki süreci kapanır; sonraki ileti yeni kararla --resume eder; çalışan oturuma dokunulmaz', async () => {
    h = createHarness();
    const id = await run('#bayraklar');
    await results(id, 1);
    expect(lastText(id)).toContain('"--setting-sources","user,project,local"');
    const pid = h.manager.pids()[0]!;
    const busy = await run('#yavas:30');
    await h.waitStatus(busy, 'running');
    h.trust.set(h.dir, { required: true, decision: 'distrust' });
    expect(await h.manager.trustChanged(h.dir)).toBe(1);
    await waitFor(() => !isAlive(pid), 'boştaki süreç kapandı');
    expect(h.status(busy)).toBe('running');
    expect(h.status(id)).toBe('done');
    await h.manager.send(id, { text: '#bayraklar' });
    await results(id, 2);
    expect(lastText(id)).toContain('"--setting-sources","user"');
    expect(lastText(id)).toContain(`"--resume","${summary(id).sessionId}"`);
    expect(summary(id).untrusted).toBe(true);
    // Başka klasörün kararı bu oturumları etkilemez.
    expect(await h.manager.trustChanged(path.join(h.dir, 'başka'))).toBe(0);
  });
});
