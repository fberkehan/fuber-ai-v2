import { describe, expect, it } from 'vitest';
import type { LiveEvent, PermissionRequestEvent, TurnResultEvent } from '../../../../../main/modules/projects/claude/types';
import { lineDiff, parseUnifiedDiff, toolDiff } from './diff';
import { completeTrigger, filterCommands, findTrigger, relativePath, sortSessions } from './format';
import { foldItems, foldStats, TranscriptModel, type TranscriptItem } from './model';

const result = (patch: Partial<TurnResultEvent> = {}): TurnResultEvent => ({
  type: 'result',
  ok: true,
  interrupted: false,
  durationMs: 1200,
  turns: 2,
  costUsd: 0,
  usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
  ...patch,
});

const toolStart = (id: string, name = 'Read', parent: string | null = null): LiveEvent => ({
  type: 'tool_start',
  id,
  name,
  kind: name === 'Edit' ? 'edit' : name === 'Bash' ? 'shell' : 'read',
  input: { file_path: `C:\\proje\\${id}.ts` },
  summary: `C:\\proje\\${id}.ts`,
  parent,
});
const toolEnd = (id: string, error = false): LiveEvent => ({ type: 'tool_end', id, error, output: 'çıktı', truncated: false, parent: null });

const permission = (requestId: string, toolUseId?: string): PermissionRequestEvent => ({
  type: 'permission_request',
  requestId,
  tool: 'Write',
  kind: 'edit',
  input: { file_path: 'a.txt', content: 'x' },
  summary: 'a.txt',
  canAlways: true,
  ...(toolUseId ? { toolUseId } : {}),
});

const kinds = (items: readonly TranscriptItem[]) => items.map((item) => item.kind);

describe('TranscriptModel', () => {
  it('akan metni blok başına tek öğede biriktirir, tam metin gelince değiştirir', () => {
    const model = new TranscriptModel();
    model.apply({ type: 'user', id: 'u1', text: 'Merhaba', images: 0 });
    model.apply({ type: 'text_delta', block: 'm1#0', text: 'Şu ', parent: null });
    model.apply({ type: 'text_delta', block: 'm1#0', text: 'dosyaya', parent: null });
    let list = model.list();
    expect(kinds(list)).toEqual(['user', 'text']);
    expect(list[1]).toMatchObject({ text: 'Şu dosyaya', streaming: true });
    expect(model.streaming()).toBe(true);

    model.apply({ type: 'text', block: 'm1#0', text: 'Şu dosyaya bakıyorum.', parent: null });
    list = model.list();
    expect(list).toHaveLength(2);
    expect(list[1]).toMatchObject({ text: 'Şu dosyaya bakıyorum.', streaming: false });
    expect(model.streaming()).toBe(false);
  });

  it('araç başlangıcı ile sonucunu tek kartta birleştirir; değişmeyen öğe aynı nesne kalır', () => {
    const model = new TranscriptModel();
    model.apply({ type: 'user', id: 'u1', text: 'oku', images: 0 });
    model.apply(toolStart('t1'));
    const before = model.list();
    expect(before[1]).toMatchObject({ kind: 'tool', state: 'running' });
    model.apply(toolEnd('t1'));
    const after = model.list();
    expect(after[1]).toMatchObject({ kind: 'tool', state: 'done', output: 'çıktı' });
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
  });

  it('başlangıcı olmayan araç sonucunu saklar, başlangıç gelince karta işler', () => {
    const model = new TranscriptModel();
    expect(model.apply(toolEnd('t9', true))).toBe(false);
    model.apply(toolStart('t9'));
    expect(model.list()[0]).toMatchObject({ kind: 'tool', state: 'error' });
  });

  it('alt ajanın olaylarını içine yerleştirir', () => {
    const model = new TranscriptModel();
    model.apply({ type: 'subagent', id: 'a1', description: 'Araştır', prompt: 'bak', parent: null });
    model.apply(toolStart('t1', 'Read', 'a1'));
    model.apply({ type: 'text', block: 'm2#0', text: 'buldum', parent: 'a1' });
    const list = model.list();
    expect(list).toHaveLength(1);
    const agent = list[0]!;
    expect(agent.kind).toBe('subagent');
    if (agent.kind === 'subagent') expect(kinds(agent.children)).toEqual(['tool', 'text']);
  });

  it('art arda gelen yapılacaklar güncellemesini tek kartta tutar, araya öğe girince eskisini işaretler', () => {
    const model = new TranscriptModel();
    model.apply({ type: 'todos', id: 'x1', items: [{ content: 'bir', status: 'pending' }], parent: null });
    model.apply({ type: 'todos', id: 'x2', items: [{ content: 'bir', status: 'done' }], parent: null });
    expect(model.list()).toHaveLength(1);
    model.apply({ type: 'text', block: 'm3#0', text: 'sürüyor', parent: null });
    model.apply({ type: 'todos', id: 'x3', items: [{ content: 'iki', status: 'in_progress' }], parent: null });
    const list = model.list();
    expect(kinds(list)).toEqual(['todos', 'text', 'todos']);
    expect(list[0]).toMatchObject({ stale: true });
    expect(list[2]).toMatchObject({ stale: false });
  });

  it('bekleyen izin dökümde satır olmaz; karar kendi araç kartına rozet olur', () => {
    const model = new TranscriptModel();
    model.apply(toolStart('t1', 'Edit'));
    model.apply(permission('p1', 't1'));
    expect(kinds(model.list())).toEqual(['tool']);
    model.apply({ type: 'permission_resolved', requestId: 'p1', decision: 'allow' });
    expect(model.list()[0]).toMatchObject({ kind: 'tool', decision: 'allow' });
    expect(kinds(model.list())).toEqual(['tool']);

    // Kartı olmayan istek yanıtlanınca satır olarak görünür.
    model.apply(permission('p2'));
    expect(kinds(model.list())).toEqual(['tool']);
    model.apply({ type: 'permission_resolved', requestId: 'p2', decision: 'deny' });
    expect(model.list()[1]).toMatchObject({ kind: 'permission', decision: 'deny' });
  });

  it('sonuç gelince süren araçları kesildi sayar ve arka plan sayısını son sonuç kartında tutar', () => {
    const model = new TranscriptModel();
    model.apply(toolStart('t1', 'Bash'));
    model.apply({ type: 'background', count: 2 });
    model.apply(result({ interrupted: true, ok: false }));
    let list = model.list();
    expect(list[0]).toMatchObject({ kind: 'tool', state: 'interrupted' });
    expect(list[1]).toMatchObject({ kind: 'result', background: 2 });
    model.apply({ type: 'background', count: 0 });
    list = model.list();
    expect(list[1]).toMatchObject({ kind: 'result', background: 0 });
  });

  it('yalnız "sınır doldu" bildirimini döküme koyar', () => {
    const model = new TranscriptModel();
    expect(model.apply({ type: 'rate_limit', status: 'allowed', resetsAt: null, limitType: null })).toBe(false);
    expect(model.apply({ type: 'rate_limit', status: 'rejected', resetsAt: 1_800_000_000, limitType: 'five_hour' })).toBe(true);
    expect(model.apply({ type: 'rate_limit', status: 'rejected', resetsAt: 1_800_000_000, limitType: 'five_hour' })).toBe(false);
    expect(kinds(model.list())).toEqual(['limit']);
  });

  it('durum ve iş listesi olaylarını dökümde öğe yapmaz', () => {
    const model = new TranscriptModel();
    expect(model.apply({ type: 'tasks', tasks: [] })).toBe(false);
    expect(model.apply({ type: 'forgotten' })).toBe(false);
    expect(model.list()).toEqual([]);
  });
});

describe('foldItems', () => {
  it('art arda biten araç kartlarını katlar; süren kart diziyi böler', () => {
    const model = new TranscriptModel();
    for (const id of ['t1', 't2', 't3']) {
      model.apply(toolStart(id), 1000);
      model.apply(toolEnd(id), 3000);
    }
    model.apply(toolStart('t4'), 4000);
    const visible = foldItems(model.list());
    expect(visible.map((item) => item.kind)).toEqual(['folded', 'tool']);
    const group = visible[0]!;
    if (group.kind === 'folded') expect(foldStats(group)).toEqual({ count: 3, steps: 3, durationMs: 2000, failed: 0 });
  });

  it('tek biten kartı katlamaz', () => {
    const model = new TranscriptModel();
    model.apply(toolStart('t1'));
    model.apply(toolEnd('t1'));
    expect(foldItems(model.list()).map((item) => item.kind)).toEqual(['tool']);
  });
});

describe('diff', () => {
  it('satır farkını ve numaraları üretir', () => {
    const lines = lineDiff('a\nb\nc', 'a\nB\nc\nd', { oldStart: 10, newStart: 10 });
    expect(lines.map((line) => `${line.kind}:${line.text}`)).toEqual(['same:a', 'del:b', 'add:B', 'same:c', 'add:d']);
    expect(lines[0]).toMatchObject({ oldNo: 10, newNo: 10 });
    expect(lines[4]).toMatchObject({ newNo: 13 });
  });

  it('Write girdisini eklenen satırlara, Edit girdisini farka çevirir', () => {
    expect(toolDiff('Write', { content: 'bir\niki' })).toMatchObject({ created: true, lines: [{ kind: 'add', newNo: 1 }, { kind: 'add', newNo: 2 }] });
    const edit = toolDiff('Edit', { old_string: 'eski', new_string: 'yeni' });
    expect(edit?.lines.map((line) => line.kind)).toEqual(['del', 'add']);
    expect(toolDiff('Read', { file_path: 'x' })).toBeNull();
  });

  it('birleşik farkı ve başlıksız ekleme listesini ayrıştırır', () => {
    const files = parseUnifiedDiff('diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n ilk\n-eski\n+yeni\n');
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: 'src/a.ts', added: 1, removed: 1 });
    expect(files[0]!.hunks[0]!.lines.map((line) => line.kind)).toEqual(['same', 'del', 'add']);

    const untracked = parseUnifiedDiff('--- /dev/null\n+++ b/yeni.txt\n+bir\n+iki');
    expect(untracked[0]).toMatchObject({ path: 'yeni.txt', created: true, added: 2 });
  });
});

describe('format', () => {
  it('"/" ve "@" tetiklerini bulur ve tamamlar', () => {
    expect(findTrigger('/comp', 5)).toMatchObject({ kind: 'command', query: 'comp' });
    expect(findTrigger('bak src/a', 9)).toBeNull();
    const trigger = findTrigger('şuna bak @src/a', 15)!;
    expect(trigger).toMatchObject({ kind: 'file', query: 'src/a', start: 9 });
    expect(completeTrigger('şuna bak @src/a', trigger, 'src/app.ts')).toEqual({ text: 'şuna bak @src/app.ts ', cursor: 21 });
    expect(findTrigger('ali@ornek.com', 13)).toBeNull();
  });

  it('komutları önekle süzer; tek harfte yalnız önek eşleşir', () => {
    const commands = [
      { name: 'compact', description: 'Bağlamı özetle', argumentHint: '' },
      { name: 'clear', description: 'Temizle', argumentHint: '' },
      { name: 'review', description: 'compact kod incelemesi', argumentHint: '' },
    ];
    expect(filterCommands(commands, 'c').map((command) => command.name)).toEqual(['clear', 'compact']);
    expect(filterCommands(commands, 'comp').map((command) => command.name)).toEqual(['compact', 'review']);
  });

  it('proje içindeki yolu göreli yazar (Türkçe harfli klasörde de)', () => {
    expect(relativePath('C:\\Projeler\\İş Çözümü\\src\\a.ts', 'C:\\Projeler\\İş Çözümü')).toBe('src/a.ts');
    expect(relativePath('D:\\baska\\b.ts', 'C:\\Projeler\\x')).toBe('D:/baska/b.ts');
  });

  it('izin bekleyen oturumu listenin en üstüne alır', () => {
    const base = { pendingPermissions: 0, lastActivityAt: 0 };
    const sorted = sortSessions([
      { ...base, id: 'bitti', status: 'done' as const, lastActivityAt: 50 },
      { ...base, id: 'calisan', status: 'running' as const, lastActivityAt: 10 },
      { ...base, id: 'izin', status: 'permission' as const, pendingPermissions: 1, lastActivityAt: 1 },
      { ...base, id: 'kapali', status: 'closed' as const, lastActivityAt: 99 },
    ]);
    expect(sorted.map((session) => session.id)).toEqual(['izin', 'calisan', 'bitti', 'kapali']);
  });
});
