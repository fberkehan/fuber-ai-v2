// Oturum yöneticisi: sahte Claude Code CLI ile gerçek süreç ve gerçek denetim protokolü üzerinden.
// (v1 `tests/cc-oturum.test.ts` senaryolarının v2 karşılığı; v2'ye özgü olanlar: araya girme, kip tavanı, ayar kaynakları.)
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isAlive } from '../../../core/claude-cli/process';
import { createHarness, sleep, waitFor, type Harness } from './testkit';

let h: Harness;
afterEach(async () => {
  await h?.cleanup();
});

describe('oturum: başlat, akış, sonuç', () => {
  it('Türkçe harfli proje yolunda başlar; metin akar, tam metinle eşleşir; sonuç belirteç taşır; bitiş bir kez bildirilir', async () => {
    h = createHarness();
    const started = await h.manager.start({ cwd: h.dir, prompt: 'selam' });
    expect(started.ok).toBe(true);
    const id = started.session!.id;
    await h.waitStatus(id, 'done');
    expect(h.text(id)).toContain('Merhaba! Sahte Claude Code yanıtı: selam');
    const detail = h.manager.detail(id)!;
    expect(detail.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(detail.cwd).toBe(h.dir);
    expect(detail.usage).toEqual({ input: 120, output: 34, cacheRead: 50, cacheWrite: 10 });
    // Abonelikte (apiKeySource: none) tahmini dolar özete girmez.
    expect(detail.costUsd).toBeUndefined();
    expect(detail.events.filter((envelope) => envelope.event.type === 'text_delta')).toHaveLength(0);
    expect(detail.events.map((envelope) => envelope.event.type)).toEqual(expect.arrayContaining(['user', 'init', 'text', 'result']));
    expect(detail.commands.map((command) => command.name)).toContain('compact');
    await waitFor(() => h.turnEnds.length === 1, 'bitiş bildirimi');
    expect(h.turnEnds[0]!.info.result.ok).toBe(true);
    expect(h.turnEnds[0]!.info.lastText).toContain('Merhaba!');
  });

  it('bayraklar: sistem istemi verilmez, ayar kaynakları açıkça üç kaynak; güvenilmeyen klasörde yalnız kullanıcı kaynağı', async () => {
    h = createHarness();
    const first = await h.manager.start({ cwd: h.dir, prompt: '#bayraklar', model: 'sonnet', effort: 'high' });
    await h.waitStatus(first.session!.id, 'done');
    const flags = h.text(first.session!.id);
    expect(flags).toContain('"--setting-sources","user,project,local"');
    expect(flags).toContain('"--permission-prompt-tool=stdio"');
    expect(flags).toContain('"--permission-mode","default"');
    expect(flags).toContain('"--model","sonnet"');
    expect(flags).toContain('"--effort","high"');
    expect(flags).not.toContain('system-prompt');
    expect(flags).not.toContain('--allow-dangerously-skip-permissions');
    expect(flags).not.toContain('"-p"');

    h.trust.set(h.dir, { required: true, decision: 'distrust', mcp: true });
    const second = await h.manager.start({ cwd: h.dir, prompt: '#bayraklar' });
    await h.waitStatus(second.session!.id, 'done');
    expect(h.text(second.session!.id)).toContain('"--setting-sources","user","--strict-mcp-config"');
    expect(h.manager.summary(second.session!.id)!.untrusted).toBe(true);
    expect(h.of('system', second.session!.id).some((event) => event.text.includes('yüklenmedi'))).toBe(true);
  });

  it('güven kararı verilmemiş klasör: sayfadan açılmaz (trust_required); asistan açar ama ayarları yüklemeden', async () => {
    h = createHarness();
    h.trust.set(h.dir, { required: true, decision: null, hooks: true });
    const page = await h.manager.start({ cwd: h.dir, prompt: 'selam' });
    expect(page).toMatchObject({ ok: false, code: 'trust_required' });
    expect(page.trust?.required).toBe(true);
    expect(h.manager.sessions()).toHaveLength(0);
    const assistant = await h.manager.start({ cwd: h.dir, prompt: '#bayraklar', source: 'assistant' });
    expect(assistant.ok).toBe(true);
    await h.waitStatus(assistant.session!.id, 'done');
    expect(h.text(assistant.session!.id)).toContain('"--setting-sources","user"');
  });

  it('geçersiz model, oturum kimliği ve klasör reddedilir; Claude Code yoksa dürüst hata', async () => {
    h = createHarness();
    expect(await h.manager.start({ cwd: h.dir, prompt: 'x', model: '--dangerously-skip-permissions' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await h.manager.start({ cwd: h.dir, prompt: 'x', resume: '../../kaçış' })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await h.manager.start({ cwd: path.join(h.dir, 'yok'), prompt: 'x' })).toMatchObject({ ok: false, code: 'no_folder' });
    expect(await h.manager.start({ cwd: 'göreli', prompt: 'x' })).toMatchObject({ ok: false, code: 'no_folder' });
    expect(await h.manager.start({ cwd: h.dir, prompt: 'x', mode: 'bypassPermissions' })).toMatchObject({ ok: false, code: 'full_access_off' });
    await h.cleanup();
    h = createHarness({ cli: () => null });
    const none = await h.manager.start({ cwd: h.dir, prompt: 'x' });
    expect(none).toMatchObject({ ok: false, code: 'no_cli' });
    expect(none.error).toContain('bulunamadı');
  });
});

describe('izin istekleri', () => {
  it('"İzin ver" → araç çalışır ve dosya yazılır; değişen dosya sayılır', async () => {
    h = createHarness();
    const { session } = await h.manager.start({ cwd: h.dir, prompt: '#yaz:çıktı.txt' });
    const id = session!.id;
    await h.waitStatus(id, 'permission');
    const request = h.permissions[0]!.request;
    expect(request).toMatchObject({ tool: 'Write', kind: 'edit', canAlways: true });
    expect(request.summary).toContain('çıktı.txt');
    expect(fs.existsSync(path.join(h.dir, 'çıktı.txt'))).toBe(false);
    expect(h.manager.answerPermission(id, request.requestId, { decision: 'allow' })).toEqual({ ok: true });
    await h.waitStatus(id, 'done');
    expect(fs.readFileSync(path.join(h.dir, 'çıktı.txt'), 'utf8')).toContain('ğüşiöç');
    expect(h.manager.detail(id)!.changedFilesList).toEqual([path.join(h.dir, 'çıktı.txt')]);
    expect(h.turnEnds[0]!.info.changedFiles).toHaveLength(1);
    // Yanıtlanmış izin ikinci kez yanıtlanamaz.
    expect(h.manager.answerPermission(id, request.requestId, { decision: 'allow' })).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('"Reddet" → dosya yazılmaz, neden Claude Code’a iletilir; reddedilen düzenleme değişen dosya sayılmaz', async () => {
    h = createHarness();
    const { session } = await h.manager.start({ cwd: h.dir, prompt: '#yaz:olmaz.txt' });
    const id = session!.id;
    await h.waitStatus(id, 'permission');
    h.manager.answerPermission(id, h.permissions[0]!.request.requestId, { decision: 'deny', reason: 'şimdi değil' });
    await h.waitStatus(id, 'done');
    expect(fs.existsSync(path.join(h.dir, 'olmaz.txt'))).toBe(false);
    expect(h.of('tool_end', id)[0]).toMatchObject({ error: true });
    expect(h.of('tool_end', id)[0]!.output).toContain('şimdi değil');
    expect(h.manager.detail(id)!.changedFiles).toBe(0);
    expect(h.text(id)).toContain('reddedildi');
  });

  it('"Bu oturumda hep izin ver" → aynı istek bu oturumda bir daha sorulmaz', async () => {
    h = createHarness();
    const { session } = await h.manager.start({ cwd: h.dir, prompt: '#izin' });
    const id = session!.id;
    await h.waitStatus(id, 'permission');
    h.manager.answerPermission(id, h.permissions[0]!.request.requestId, { decision: 'always' });
    await h.waitStatus(id, 'done');
    await h.manager.send(id, { text: '#izin yine' });
    await waitFor(() => h.of('result', id).length === 2, 'ikinci tur');
    expect(h.permissions).toHaveLength(1);
  });

  it('AskUserQuestion: yanıt sorulara uymalı; uymayan yanıt reddedilir ve istek bekler', async () => {
    h = createHarness();
    const { session } = await h.manager.start({ cwd: h.dir, prompt: '#soru' });
    const id = session!.id;
    await h.waitStatus(id, 'permission');
    const request = h.permissions[0]!.request;
    expect(request.kind).toBe('question');
    expect(request.canAlways).toBe(false);
    const question = request.questions![0]!;
    expect(h.manager.answerPermission(id, request.requestId, { decision: 'allow', answers: { [question.question]: 'listede olmayan' } })).toMatchObject({ ok: false, code: 'bad_answer' });
    expect(h.status(id)).toBe('permission');
    expect(h.manager.answerPermission(id, request.requestId, { decision: 'allow', answers: { [question.question]: question.options[0]!.label } })).toEqual({ ok: true });
    await h.waitStatus(id, 'done');
    expect(h.text(id)).toContain(question.options[0]!.label);
  });
});

describe('ileti gönderme, araya girme, durdurma', () => {
  it('biten oturuma ikinci ileti aynı süreçle ve aynı oturum kimliğiyle gider', async () => {
    h = createHarness();
    const { session } = await h.manager.start({ cwd: h.dir, prompt: 'bir' });
    const id = session!.id;
    await h.waitStatus(id, 'done');
    const pid = h.manager.pids()[0];
    const sessionId = h.manager.summary(id)!.sessionId;
    expect(await h.manager.send(id, { text: '#durum' })).toEqual({ ok: true });
    await waitFor(() => h.of('result', id).length === 2, 'ikinci sonuç');
    expect(h.manager.pids()[0]).toBe(pid);
    expect(h.text(id)).toContain(`oturum=${sessionId}`);
    expect(h.manager.summary(id)!.turns).toBe(2);
  });

  it('araya girme: tur sürerken yazılan ileti hemen Claude Code’a gider ve tura katılır; yarıda "bitti" denmez', async () => {
    h = createHarness({ env: { SAHTE_CC_KATLA: '1' } });
    const { session } = await h.manager.start({ cwd: h.dir, prompt: '#yavas:20' });
    const id = session!.id;
    await h.waitStatus(id, 'running');
    await waitFor(() => h.text(id).includes('.'), 'akış başladı');
    expect(await h.manager.send(id, { text: 'şunu da ekle' })).toEqual({ ok: true });
    // İleti sıraya girmedi: dökümde hemen görünür.
    expect(h.manager.detail(id)!.queue).toHaveLength(0);
    expect(h.of('user', id).map((event) => event.text)).toEqual(['#yavas:20', 'şunu da ekle']);
    await h.waitStatus(id, 'done');
    expect(h.text(id)).toContain('araya giren ileti alındı: şunu da ekle');
    expect(h.of('result', id)).toHaveLength(1);
    expect(h.turnEnds).toHaveLength(1);
  });

  it('araya giren ileti tura katılmazsa ardından yeni tur açılır: oturum yeniden çalışıyor olur, bitiş tek kez bildirilir', async () => {
    h = createHarness({ deps: { settleMs: 400 } });
    const { session } = await h.manager.start({ cwd: h.dir, prompt: '#yavas:1' });
    const id = session!.id;
    await h.waitStatus(id, 'running');
    await h.manager.send(id, { text: '#yavas:1 ikinci' });
    await waitFor(() => h.of('result', id).length === 2, 'iki sonuç', 15_000);
    await h.waitStatus(id, 'done');
    await sleep(600);
    expect(h.turnEnds).toHaveLength(1);
  });

  it('durdur: süren tur kesilir, durum "durduruldu"; oturum aynı süreçle sürer', async () => {
    h = createHarness();
    const { session } = await h.manager.start({ cwd: h.dir, prompt: '#yavas:30' });
    const id = session!.id;
    await h.waitStatus(id, 'running');
    await waitFor(() => h.text(id).includes('.'), 'akış başladı');
    const pid = h.manager.pids()[0];
    expect(await h.manager.interrupt(id)).toEqual({ ok: true });
    await h.waitStatus(id, 'stopped');
    expect(h.of('result', id)[0]).toMatchObject({ ok: false, interrupted: true });
    expect(h.turnEnds[0]!.info.result.interrupted).toBe(true);
    await h.manager.send(id, { text: 'devam' });
    await h.waitStatus(id, 'done');
    expect(h.manager.pids()[0]).toBe(pid);
  });

  it('izin beklerken durdur: bekleyen izin iptal edilir', async () => {
    h = createHarness();
    const { session } = await h.manager.start({ cwd: h.dir, prompt: '#izin' });
    const id = session!.id;
    await h.waitStatus(id, 'permission');
    await h.manager.interrupt(id);
    await h.waitStatus(id, 'stopped');
    expect(h.of('permission_resolved', id)[0]).toMatchObject({ decision: 'cancelled' });
    expect(h.manager.detail(id)!.permissions).toHaveLength(0);
  });

  it('inatçı süreç: durdurma isteğine uymazsa bekçi süreci kapatır; tur "durduruldu" sayılır, yetim süreç kalmaz', async () => {
    h = createHarness();
    const { session } = await h.manager.start({ cwd: h.dir, prompt: '#inat' });
    const id = session!.id;
    await h.waitStatus(id, 'running');
    const pid = await waitFor(() => h.manager.pids()[0], 'pid');
    await h.manager.interrupt(id);
    await h.waitStatus(id, 'stopped', 15_000);
    await waitFor(() => !isAlive(pid), 'süreç öldü');
    expect(h.turnEnds).toHaveLength(1);
  });
});

describe('çökme, sınır, uzun çıktı', () => {
  it('çökme: süreç beklenmedik biçimde biterse "hata" (neden görünür, ham yığın yok); sonraki ileti --resume ile sürdürür', async () => {
    h = createHarness();
    const { session } = await h.manager.start({ cwd: h.dir, prompt: '#cok' });
    const id = session!.id;
    await h.waitStatus(id, 'error');
    const summary = h.manager.summary(id)!;
    expect(summary.error).toContain('beklenmedik biçimde kapandı');
    expect(summary.error).toContain('çıkış kodu 3');
    expect(h.errors).toHaveLength(1);
    expect(h.manager.pids()).toHaveLength(0);
    const sessionId = summary.sessionId!;
    await h.manager.send(id, { text: '#bayraklar' });
    await h.waitStatus(id, 'done');
    expect(h.text(id)).toContain(`"--resume","${sessionId}"`);
  });

  it('kullanım sınırı: durum "limit", sıfırlanma anı ve Türkçe tek cümle; ham İngilizce ileti dökümde yok', async () => {
    h = createHarness();
    const { session } = await h.manager.start({ cwd: h.dir, prompt: '#sinir' });
    const id = session!.id;
    await h.waitStatus(id, 'limit');
    const summary = h.manager.summary(id)!;
    expect(summary.limitResetsAt).toBeGreaterThan(Date.now());
    const result = h.of('result', id)[0]!;
    expect(result).toMatchObject({ ok: false, errorClass: 'limit' });
    expect(result.error).toContain('kullanım sınırına ulaşıldı');
    expect(JSON.stringify(h.manager.detail(id)!.events)).not.toContain('hit your limit');
    expect(h.turnEnds[0]!.info.result.errorClass).toBe('limit');
  });

  it('uzun çıktı: 5 000 parçalı yanıt dökümde blok başına tek kayıt; yayın toplu; kartlar korunur', async () => {
    h = createHarness();
    const { session } = await h.manager.start({ cwd: h.dir, prompt: '#cokparca:5000' });
    const id = session!.id;
    await h.waitStatus(id, 'done', 60_000);
    const detail = h.manager.detail(id)!;
    const texts = detail.events.filter((envelope) => envelope.event.type === 'text');
    expect(texts).toHaveLength(1);
    expect((texts[0]!.event as { text: string }).text.split(' ').filter(Boolean)).toHaveLength(5000);
    expect(detail.events.filter((envelope) => envelope.event.type === 'tool_start')).toHaveLength(2);
    expect(detail.events.length).toBeLessThan(20);
    // 5 000 parça 5 000 olay olarak yayınlanmaz.
    expect(h.of('text_delta', id).length).toBeLessThan(2500);
  }, 70_000);
});

describe('kip, model, eşzamanlılık, kapanış', () => {
  it('kip ve model oturum içinde değişir; Tam yetki yalnız ayar açıkken', async () => {
    h = createHarness();
    const { session } = await h.manager.start({ cwd: h.dir, prompt: '#durum' });
    const id = session!.id;
    await h.waitStatus(id, 'done');
    expect(h.text(id)).toContain('mod=default');
    expect(await h.manager.setMode(id, 'acceptEdits')).toEqual({ ok: true });
    expect(await h.manager.setModel(id, 'claude-sahte-hizli')).toEqual({ ok: true });
    expect(await h.manager.setMode(id, 'bypassPermissions')).toMatchObject({ ok: false, code: 'full_access_off' });
    await h.manager.send(id, { text: '#durum' });
    await waitFor(() => h.of('result', id).length === 2, 'ikinci tur');
    expect(h.text(id)).toContain('mod=acceptEdits model=claude-sahte-hizli');
    expect(h.manager.summary(id)).toMatchObject({ mode: 'acceptEdits', model: 'claude-sahte-hizli' });
  });

  it('asistanın başlattığı oturum en çok "Düzenlemelere izin ver"; onaylı Tam yetki ayrı', async () => {
    h = createHarness({ config: { fullAccess: true, defaultMode: 'bypassPermissions' } });
    const capped = await h.manager.start({ cwd: h.dir, prompt: '#bayraklar', source: 'assistant' });
    await h.waitStatus(capped.session!.id, 'done');
    expect(capped.session!.mode).toBe('acceptEdits');
    expect(h.text(capped.session!.id)).not.toContain('--allow-dangerously-skip-permissions');
    const approved = await h.manager.start({ cwd: h.dir, prompt: '#bayraklar', source: 'assistant', mode: 'bypassPermissions', fullAccessApproved: true });
    await h.waitStatus(approved.session!.id, 'done');
    expect(approved.session!.mode).toBe('bypassPermissions');
    expect(h.text(approved.session!.id)).toContain('--allow-dangerously-skip-permissions');
  });

  it('eşzamanlı sınır: fazlası sırada (sıra numarasıyla), yer açılınca başlar', async () => {
    h = createHarness({ config: { maxConcurrent: 2 } });
    const ids: string[] = [];
    for (let index = 0; index < 3; index++) ids.push((await h.manager.start({ cwd: h.dir, prompt: '#yavas:30' })).session!.id);
    await h.waitStatus(ids[0]!, 'running');
    await h.waitStatus(ids[1]!, 'running');
    expect(h.manager.summary(ids[2]!)).toMatchObject({ status: 'queued', queuePosition: 1, queued: 1 });
    expect(h.manager.runningCount()).toBe(2);
    await h.manager.interrupt(ids[0]!);
    await h.waitStatus(ids[2]!, 'running');
  });

  it('kapanış: süren turlar durdurulur, süreçler kapanır, YETİM SÜREÇ KALMAZ (inatçı süreç ağacıyla öldürülür)', async () => {
    h = createHarness();
    const a = (await h.manager.start({ cwd: h.dir, prompt: '#yavas:30' })).session!.id;
    const b = (await h.manager.start({ cwd: h.dir, prompt: '#inat' })).session!.id;
    await h.waitStatus(a, 'running');
    await h.waitStatus(b, 'running');
    const pids = await waitFor(() => (h.manager.pids().length === 2 ? h.manager.pids() : null), 'iki süreç');
    await h.manager.shutdown();
    await waitFor(() => pids.every((pid) => !isAlive(pid)), 'süreçler öldü');
    // Kapanışta bitiş bildirimi verilmez.
    expect(h.turnEnds).toHaveLength(0);
    expect(await h.manager.start({ cwd: h.dir, prompt: 'x' })).toMatchObject({ ok: false, code: 'shutting_down' });
  });

  it('kapat ve unut: kapatılan oturum "kapandı" kalır, yeni ileti --resume ile açar; unutulan listeden silinir', async () => {
    h = createHarness();
    const { session } = await h.manager.start({ cwd: h.dir, prompt: 'bir' });
    const id = session!.id;
    await h.waitStatus(id, 'done');
    const sessionId = h.manager.summary(id)!.sessionId!;
    await h.manager.close(id);
    expect(h.status(id)).toBe('closed');
    expect(h.manager.pids()).toHaveLength(0);
    await h.manager.send(id, { text: '#bayraklar' });
    await h.waitStatus(id, 'done');
    expect(h.text(id)).toContain(`"--resume","${sessionId}"`);
    await h.manager.forget(id);
    expect(h.manager.summary(id)).toBeNull();
    expect(h.of('forgotten', id)).toHaveLength(1);
  });

  it('sürdür ve çatalla; başka yerde açık oturum doğrudan sürdürülmez', async () => {
    h = createHarness();
    const resumeId = '11111111-2222-3333-4444-555555555555';
    const resumed = await h.manager.start({ cwd: h.dir, resume: resumeId, prompt: '#durum' });
    await h.waitStatus(resumed.session!.id, 'done');
    expect(h.manager.summary(resumed.session!.id)!.sessionId).toBe(resumeId);
    const forked = await h.manager.start({ cwd: h.dir, resume: resumeId, fork: true, prompt: '#bayraklar' });
    await h.waitStatus(forked.session!.id, 'done');
    expect(h.text(forked.session!.id)).toContain('--fork-session');
    expect(h.manager.summary(forked.session!.id)!.sessionId).not.toBe(resumeId);
    const other = '99999999-2222-3333-4444-555555555555';
    h.elsewhere.add(other);
    expect(await h.manager.start({ cwd: h.dir, resume: other, prompt: 'x' })).toMatchObject({ ok: false, code: 'open_elsewhere' });
    expect((await h.manager.start({ cwd: h.dir, resume: other, prompt: 'x', force: true })).ok).toBe(true);
  });

  it('sohbetten verilen iş: özet için sohbet kimliği yalnız bir kez verilir', async () => {
    h = createHarness();
    const { session } = await h.manager.start({ cwd: h.dir, prompt: 'iş', source: 'assistant', chatSessionId: 'sohbet-1' });
    const id = session!.id;
    await h.waitStatus(id, 'done');
    await waitFor(() => h.turnEnds.length === 1, 'ilk bitiş');
    expect(h.turnEnds[0]!.info.chatSessionId).toBe('sohbet-1');
    await h.manager.send(id, { text: 'sayfadan devam' });
    await waitFor(() => h.turnEnds.length === 2, 'ikinci bitiş');
    expect(h.turnEnds[1]!.info.chatSessionId).toBeUndefined();
  });
});
