// Dosya yönetimi araçlarının sınaması: GERÇEK dosya sistemi, ama depo içindeki yalıtılmış geçici klasörde (sahte "ev"
// klasörü). Geliştiricinin dosyalarına ve gerçek Geri Dönüşüm Kutusu'na dokunulmaz: çöp kutusu, açma ve Gezgin sahtedir.
import fs from 'node:fs';
import nodePath from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ApprovalInput, ToolResult } from '@fuber/shared';
import { miniTools, moduleContext, testBus } from '../../core/brain/testkit';
import type { AccessConfig } from '../documents/access';
import { scratchDir } from '../documents/testkit';
import { EXECUTABLE_EXTENSIONS, FILE_LIMITS, fileControlTools, fileReadTools, fileTools, sizeLabel, validName, type FilesEnv } from './files';
import { createPcGate, type PcGateControl } from './gate';

const origin = { channel: 'voice' as const, speakerVerified: null };

interface World {
  dir: string;
  home: string;
  desktop: string;
  documents: string;
  downloads: string;
  /** İzinli köklerin dışında, engelli olmayan klasör. */
  outside: string;
  trashDir: string;
  gate: PcGateControl;
  tools: ReturnType<typeof miniTools>;
  approvals: ApprovalInput[];
  trashed: string[];
  opened: string[];
  revealed: string[];
  activity: string[];
  env: FilesEnv;
  /** Çöp kutusunun davranışı: `fail` hata fırlatır, `noop` hiçbir şey yapmadan "tamam" der. */
  trashMode: 'move' | 'fail' | 'noop';
  openError: string;
  run(name: string, input: unknown, signal?: AbortSignal): Promise<ToolResult>;
  cleanup(): Promise<void>;
}

let w: World;

function write(file: string, content = 'içerik'): string {
  fs.mkdirSync(nodePath.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

const reason = (result: ToolResult): unknown => (result.data as { reason?: string } | undefined)?.reason;

beforeEach(() => {
  const scratch = scratchDir('pc-files');
  const home = nodePath.join(scratch.dir, 'home');
  const desktop = nodePath.join(home, 'Desktop');
  const documents = nodePath.join(home, 'Documents');
  const downloads = nodePath.join(home, 'Downloads');
  const outside = nodePath.join(scratch.dir, 'outside');
  const trashDir = nodePath.join(scratch.dir, 'trash');
  for (const folder of [desktop, documents, downloads, outside, trashDir, nodePath.join(home, 'AppData', 'Roaming')]) fs.mkdirSync(folder, { recursive: true });
  const config: AccessConfig = { platform: process.platform, home, readRoots: () => [desktop, documents, downloads], extraBlocked: [nodePath.join(scratch.dir, 'data')] };
  const activity: string[] = [];
  const gate = createPcGate({ onActivity: (event) => void activity.push(`${event.state}:${event.action}:${event.label ?? ''}`) });
  const tools = miniTools();
  const approvals: ApprovalInput[] = [];
  const base = tools.requestApproval.bind(tools);
  tools.requestApproval = async (input: ApprovalInput) => {
    approvals.push(input);
    return base(input);
  };
  const trashed: string[] = [];
  const opened: string[] = [];
  const revealed: string[] = [];
  const aliases: Record<string, string> = { masaüstü: desktop, belgeler: documents, indirilenler: downloads };
  const world = {
    dir: scratch.dir,
    home,
    desktop,
    documents,
    downloads,
    outside,
    trashDir,
    gate,
    tools,
    approvals,
    trashed,
    opened,
    revealed,
    activity,
    trashMode: 'move',
    openError: '',
    cleanup: scratch.cleanup,
  } as World;
  world.env = {
    gate,
    access: () => config,
    expand(raw) {
      const [first = '', ...rest] = raw.trim().split(/[\\/]/);
      const alias = aliases[first.toLocaleLowerCase('tr')];
      return alias ? nodePath.join(alias, ...rest) : raw.trim();
    },
    async trash(target) {
      trashed.push(target);
      if (world.trashMode === 'fail') throw new Error('çöp kutusu yok');
      if (world.trashMode === 'noop') return;
      fs.renameSync(target, nodePath.join(trashDir, `${trashed.length}-${nodePath.basename(target)}`));
    },
    async openPath(target) {
      opened.push(target);
      return world.openError;
    },
    reveal(target) {
      revealed.push(target);
    },
  };
  const ctx = moduleContext('pc', { bus: testBus(), tools });
  tools.bind(ctx, [...fileReadTools(world.env), ...fileControlTools(world.env)]);
  world.run = (name, input, signal) => tools.run(name, input, { origin, ...(signal ? { signal } : {}) });
  w = world;
});

afterEach(async () => {
  await w.cleanup();
});

describe('araç tanımları', () => {
  it('dokuz araç, hepsi "files" kümesinde; silme danger, arama read, gerisi write', () => {
    const { read, control } = fileTools(w.env);
    expect(read.map((tool) => tool.name)).toEqual(['file_find']);
    expect(control.map((tool) => tool.name)).toEqual(['file_copy', 'file_move', 'folder_create', 'file_delete', 'file_open', 'file_reveal', 'file_write', 'file_edit']);
    for (const tool of [...read, ...control]) {
      expect(tool.group).toBe('files');
      expect(tool.description.length).toBeGreaterThan(80);
    }
    expect(read[0]!.risk).toBe('read');
    expect(Object.fromEntries(control.map((tool) => [tool.name, tool.risk]))).toEqual({
      file_copy: 'write',
      file_move: 'write',
      folder_create: 'write',
      file_delete: 'danger',
      file_open: 'write',
      file_reveal: 'write',
      // Üzerine yazma araç içinde HER SEFERİNDE onay ister (`overwrite: true`); yeni dosya ve düzenleme write.
      file_write: 'write',
      file_edit: 'write',
    });
  });

  it('ad ve boyut yardımcıları', () => {
    expect(validName('rapor 2026.pdf')).toBe(true);
    for (const bad of ['', '.', '..', 'a/b', 'a\\b', 'a:b', 'x?', 'son.', 'CON', 'nul.txt']) expect(validName(bad), bad).toBe(false);
    expect(sizeLabel(512)).toBe('512 B');
    expect(sizeLabel(2048)).toBe('2.0 KB');
    expect(sizeLabel(5 * 1024 ** 2)).toBe('5.0 MB');
    for (const ext of ['exe', 'bat', 'cmd', 'ps1', 'vbs', 'js', 'msi', 'lnk', 'scr', 'com', 'reg', 'hta']) expect(EXECUTABLE_EXTENSIONS.has(ext), ext).toBe(true);
  });
});

describe('file_find', () => {
  it('ada göre alt klasörlerde arar: Türkçe harf ve büyük/küçük duyarsız; engelli dosyaları ve gizli klasörleri atlar', async () => {
    write(nodePath.join(w.documents, 'Vergi', '2026', 'Fatura Kasım 2026.pdf'));
    write(nodePath.join(w.desktop, 'fatura-ekim.pdf'));
    write(nodePath.join(w.desktop, 'fatura şifreler.txt'));
    write(nodePath.join(w.desktop, '.gizli', 'fatura.pdf'));
    write(nodePath.join(w.desktop, 'node_modules', 'fatura.pdf'));
    write(nodePath.join(w.outside, 'fatura-disarida.pdf'));

    const result = await w.run('file_find', { name: 'FATURA kasim' });
    expect(result.ok).toBe(true);
    expect(result.text).toContain('Fatura Kasım 2026.pdf');
    expect((result.data as { count: number }).count).toBe(1);

    const all = await w.run('file_find', { name: 'fatura' });
    const paths = (all.data as { results: Array<{ path: string }> }).results.map((item) => nodePath.basename(item.path)).sort();
    expect(paths).toEqual(['Fatura Kasım 2026.pdf', 'fatura-ekim.pdf']);
    expect(w.approvals).toHaveLength(0);
    expect(w.activity).toContain('start:files:');
  });

  it('uzantı ve tür süzgeci; sonuç sınırı aşılırsa bunu söyler', async () => {
    for (let i = 0; i < 5; i++) write(nodePath.join(w.downloads, `rapor-${i}.xlsx`));
    write(nodePath.join(w.downloads, 'rapor.pdf'));
    fs.mkdirSync(nodePath.join(w.downloads, 'rapor klasörü'));
    const xlsx = await w.run('file_find', { name: 'rapor', extension: '.XLSX' });
    expect((xlsx.data as { count: number }).count).toBe(5);
    const folders = await w.run('file_find', { name: 'rapor', kind: 'folder' });
    expect((folders.data as { results: Array<{ path: string; folder: boolean }> }).results).toEqual([{ path: nodePath.join(w.downloads, 'rapor klasörü'), folder: true }]);
    const limited = await w.run('file_find', { name: 'rapor', max_results: 2 });
    expect(limited.data).toMatchObject({ count: 2, more: true });
    expect(limited.text).toContain('sonuç sınırına ulaşıldı');
    const none = await w.run('file_find', { name: 'yokboyle' });
    expect(none).toMatchObject({ ok: true, data: { count: 0 } });
    expect((await w.run('file_find', {})).ok).toBe(false);
  });

  it('izinli klasörlerin dışındaki klasör onay ister; engelli klasörde onayla da aramaz', async () => {
    write(nodePath.join(w.outside, 'sozlesme.docx'));
    const denied = await w.run('file_find', { name: 'sozlesme', folder: w.outside });
    expect(denied.ok).toBe(false);
    expect(reason(denied)).toBe('denied');
    expect(w.approvals).toHaveLength(1);
    expect(w.approvals[0]!.summary).toContain(w.outside);

    w.tools.approvals.push('approved');
    const allowed = await w.run('file_find', { name: 'sozlesme', folder: w.outside });
    expect(allowed).toMatchObject({ ok: true, data: { count: 1 } });

    w.tools.approvals.push('approved');
    const blocked = await w.run('file_find', { name: 'x', folder: nodePath.join(w.home, 'AppData') });
    expect(blocked.ok).toBe(false);
    expect(reason(blocked)).toBe('blocked');
    expect(w.approvals).toHaveLength(2);
  });
});

describe('file_copy', () => {
  it('dosyayı başka klasöre kopyalar; kaynak yerinde kalır; kısaltmalı yol ("Masaüstü\\…") çalışır', async () => {
    const source = write(nodePath.join(w.desktop, 'rapor.txt'), 'merhaba');
    const result = await w.run('file_copy', { from: 'Masaüstü\\rapor.txt', to: 'Belgeler' });
    expect(result.ok).toBe(true);
    const target = nodePath.join(w.documents, 'rapor.txt');
    expect(result.text).toContain(target);
    expect((result.data as { path: string }).path).toBe(target);
    expect(fs.readFileSync(target, 'utf8')).toBe('merhaba');
    expect(fs.existsSync(source)).toBe(true);
    expect(w.approvals).toHaveLength(0);
    expect(w.activity).toEqual(['start:files:rapor.txt', 'end:files:rapor.txt']);
  });

  it('hedefte aynı ad varsa ÜZERİNE YAZMAZ; yeni adla aynı klasöre kopyalar', async () => {
    write(nodePath.join(w.desktop, 'a.txt'), 'yeni');
    write(nodePath.join(w.documents, 'a.txt'), 'eski');
    const clash = await w.run('file_copy', { from: nodePath.join(w.desktop, 'a.txt'), to: w.documents });
    expect(clash.ok).toBe(false);
    expect(reason(clash)).toBe('exists');
    expect(clash.text).toContain('new_name');
    expect(fs.readFileSync(nodePath.join(w.documents, 'a.txt'), 'utf8')).toBe('eski');

    const same = await w.run('file_copy', { from: nodePath.join(w.desktop, 'a.txt'), to: w.desktop });
    expect(reason(same)).toBe('same_place');
    const renamed = await w.run('file_copy', { from: nodePath.join(w.desktop, 'a.txt'), new_name: 'a-yedek.txt' });
    expect(renamed.ok).toBe(true);
    expect(fs.readFileSync(nodePath.join(w.desktop, 'a-yedek.txt'), 'utf8')).toBe('yeni');
    expect(reason(await w.run('file_copy', { from: nodePath.join(w.desktop, 'a.txt') }))).toBe('bad_input');
    expect(reason(await w.run('file_copy', { from: nodePath.join(w.desktop, 'a.txt'), new_name: 'alt\\b.txt' }))).toBe('bad_name');
    expect(reason(await w.run('file_copy', { from: nodePath.join(w.desktop, 'a.txt'), to: nodePath.join(w.desktop, 'yok') }))).toBe('dest_missing');
  });

  it('klasörü özyinelemeli kopyalar; bağları ve parola/anahtar dosyalarını atlar ve sayısını söyler', async () => {
    const project = nodePath.join(w.documents, 'Proje');
    write(nodePath.join(project, 'bir.txt'));
    write(nodePath.join(project, 'alt', 'iki.txt'));
    write(nodePath.join(project, 'alt', 'sunucu.pem'), 'GİZLİ');
    write(nodePath.join(w.outside, 'disarida.txt'));
    fs.symlinkSync(w.outside, nodePath.join(project, 'kacis'), 'junction');

    const result = await w.run('file_copy', { from: project, to: w.desktop });
    expect(result.ok).toBe(true);
    const copy = nodePath.join(w.desktop, 'Proje');
    expect(fs.existsSync(nodePath.join(copy, 'bir.txt'))).toBe(true);
    expect(fs.existsSync(nodePath.join(copy, 'alt', 'iki.txt'))).toBe(true);
    expect(fs.existsSync(nodePath.join(copy, 'alt', 'sunucu.pem'))).toBe(false);
    expect(fs.existsSync(nodePath.join(copy, 'kacis'))).toBe(false);
    expect(result.data).toMatchObject({ count: 3, skipped: 2 });
    expect(result.text).toContain('2 öğe atlandı');
    // Klasör kendi içine kopyalanamaz.
    expect(reason(await w.run('file_copy', { from: project, to: nodePath.join(project, 'alt') }))).toBe('into_itself');
  });

  it('engelli kaynak (parola/anahtar dosyası, AppData) onayla da kopyalanmaz', async () => {
    write(nodePath.join(w.desktop, '.env'), 'ANAHTAR=1');
    write(nodePath.join(w.home, 'AppData', 'Roaming', 'veri.txt'));
    w.tools.approvals.push('approved', 'approved');
    for (const from of [nodePath.join(w.desktop, '.env'), nodePath.join(w.home, 'AppData', 'Roaming', 'veri.txt'), 'C:\\Windows\\win.ini', '\\\\sunucu\\paylasim\\a.txt', 'goreli\\yol.txt']) {
      const result = await w.run('file_copy', { from, to: w.documents });
      expect(result.ok, from).toBe(false);
    }
    expect(w.approvals).toHaveLength(0);
    expect(fs.readdirSync(w.documents)).toEqual([]);
    // Hedef engelliyse de kopyalanmaz.
    write(nodePath.join(w.desktop, 'a.txt'));
    expect(reason(await w.run('file_copy', { from: nodePath.join(w.desktop, 'a.txt'), to: nodePath.join(w.home, 'AppData', 'Roaming') }))).toBe('blocked');
    expect(reason(await w.run('file_copy', { from: nodePath.join(w.desktop, 'a.txt'), new_name: 'gizli.pem' }))).toBe('blocked');
  });

  it('izinli klasörlerin dışına dokunan kopya HER SEFERİNDE onay ister', async () => {
    const source = write(nodePath.join(w.desktop, 'a.txt'));
    const denied = await w.run('file_copy', { from: source, to: w.outside });
    expect(reason(denied)).toBe('denied');
    expect(fs.existsSync(nodePath.join(w.outside, 'a.txt'))).toBe(false);
    expect(w.approvals[0]).toMatchObject({ toolName: 'file_copy', moduleId: 'pc' });
    expect(w.approvals[0]!.summary).toContain(nodePath.join(w.outside, 'a.txt'));

    w.tools.approvals.push('approved');
    expect((await w.run('file_copy', { from: source, to: w.outside })).ok).toBe(true);
    // Önceki onay hatırlanmaz: yeniden sorulur.
    w.tools.approvals.push('expired');
    const again = await w.run('file_copy', { from: source, to: w.outside, new_name: 'b.txt' });
    expect(again.ok).toBe(false);
    expect(again.text).toContain('süresi doldu');
    expect(w.approvals).toHaveLength(3);
    // Dışarıdan içeri kopya da onay ister.
    w.tools.approvals.push('approved');
    expect((await w.run('file_copy', { from: nodePath.join(w.outside, 'a.txt'), to: w.documents })).ok).toBe(true);
    expect(w.approvals).toHaveLength(4);
  });

  it('kopya bir dosyayı çalıştırılabilir türe çeviremez', async () => {
    const source = write(nodePath.join(w.desktop, 'not.txt'), 'calc.exe');
    const result = await w.run('file_copy', { from: source, new_name: 'not.bat' });
    expect(reason(result)).toBe('executable');
    expect(fs.existsSync(nodePath.join(w.desktop, 'not.bat'))).toBe(false);
  });
});

describe('file_move', () => {
  it('yeniden adlandırır (yalnız new_name) ve başka klasöre taşır', async () => {
    const source = write(nodePath.join(w.desktop, 'taslak.docx'), 'x');
    const renamed = await w.run('file_move', { from: source, new_name: 'Sözleşme 2026.docx' });
    expect(renamed.ok).toBe(true);
    expect(renamed.text).toContain('Yeniden adlandırıldı');
    expect(renamed.data).toMatchObject({ renamed: true, path: nodePath.join(w.desktop, 'Sözleşme 2026.docx') });
    expect(fs.existsSync(source)).toBe(false);

    fs.mkdirSync(nodePath.join(w.documents, 'Arşiv'));
    const moved = await w.run('file_move', { from: nodePath.join(w.desktop, 'Sözleşme 2026.docx'), to: 'Belgeler\\Arşiv' });
    expect(moved.ok).toBe(true);
    expect(moved.text).toContain('Taşındı');
    expect(fs.readFileSync(nodePath.join(w.documents, 'Arşiv', 'Sözleşme 2026.docx'), 'utf8')).toBe('x');
    expect(fs.existsSync(nodePath.join(w.desktop, 'Sözleşme 2026.docx'))).toBe(false);
    expect(w.approvals).toHaveLength(0);
  });

  it('yalnız harf büyüklüğü değişen yeniden adlandırma çalışır', async () => {
    const source = write(nodePath.join(w.desktop, 'rapor.txt'));
    const result = await w.run('file_move', { from: source, new_name: 'Rapor.txt' });
    expect(result.ok).toBe(true);
    expect(fs.readdirSync(w.desktop)).toEqual(['Rapor.txt']);
  });

  it('üzerine yazmaz; klasörü kendi içine taşımaz; olmayan hedef klasörde çözümü söyler', async () => {
    const a = write(nodePath.join(w.desktop, 'a.txt'), 'A');
    write(nodePath.join(w.documents, 'a.txt'), 'B');
    const clash = await w.run('file_move', { from: a, to: w.documents });
    expect(reason(clash)).toBe('exists');
    expect(fs.readFileSync(nodePath.join(w.documents, 'a.txt'), 'utf8')).toBe('B');
    expect(fs.readFileSync(a, 'utf8')).toBe('A');

    const folder = nodePath.join(w.desktop, 'Klasör');
    fs.mkdirSync(nodePath.join(folder, 'iç'), { recursive: true });
    expect(reason(await w.run('file_move', { from: folder, to: nodePath.join(folder, 'iç') }))).toBe('into_itself');
    const missing = await w.run('file_move', { from: a, to: nodePath.join(w.documents, 'Yok') });
    expect(reason(missing)).toBe('dest_missing');
    expect(missing.text).toContain('folder_create');
    expect(reason(await w.run('file_move', { from: nodePath.join(w.desktop, 'olmayan.txt'), new_name: 'x.txt' }))).toBe('missing');
    expect(reason(await w.run('file_move', { from: a }))).toBe('bad_input');
    expect(reason(await w.run('file_move', { from: a, new_name: 'a.cmd' }))).toBe('executable');
  });

  it('izinli klasörün kendisi, kullanıcı klasörü ve doğrudan alt klasörleri taşınamaz', async () => {
    fs.mkdirSync(nodePath.join(w.home, 'Pictures'));
    w.tools.approvals.push('approved', 'approved', 'approved');
    for (const from of [w.desktop, w.home, nodePath.join(w.home, 'Pictures')]) {
      const result = await w.run('file_move', { from, new_name: 'Eski' });
      expect(reason(result), from).toBe('protected');
    }
    expect(fs.existsSync(w.desktop)).toBe(true);
    expect(w.approvals).toHaveLength(0);
  });

  it('dışarı taşıma onay ister; ret halinde dosya yerinde kalır', async () => {
    const source = write(nodePath.join(w.desktop, 'a.txt'));
    const denied = await w.run('file_move', { from: source, to: w.outside });
    expect(reason(denied)).toBe('denied');
    expect(fs.existsSync(source)).toBe(true);
    w.tools.approvals.push('approved');
    expect((await w.run('file_move', { from: source, to: w.outside })).ok).toBe(true);
    expect(fs.existsSync(nodePath.join(w.outside, 'a.txt'))).toBe(true);
    // İzinli klasörlerin dışındaki dosyanın adını değiştirmek de onay ister.
    const rename = await w.run('file_move', { from: nodePath.join(w.outside, 'a.txt'), new_name: 'b.txt' });
    expect(reason(rename)).toBe('denied');
    expect(w.approvals.at(-1)!.summary).toContain('b.txt');
  });
});

describe('folder_create', () => {
  it('iç içe klasör oluşturur; var olan klasöre dokunmaz ve bunu söyler', async () => {
    const result = await w.run('folder_create', { path: 'Belgeler\\Vergi\\2026' });
    expect(result).toMatchObject({ ok: true, data: { created: true, path: nodePath.join(w.documents, 'Vergi', '2026') } });
    expect(fs.statSync(nodePath.join(w.documents, 'Vergi', '2026')).isDirectory()).toBe(true);
    const again = await w.run('folder_create', { path: nodePath.join(w.documents, 'Vergi') });
    expect(again).toMatchObject({ ok: true, data: { created: false } });
    expect(again.text).toContain('zaten vardı');
    write(nodePath.join(w.desktop, 'dosya'));
    expect(reason(await w.run('folder_create', { path: nodePath.join(w.desktop, 'dosya') }))).toBe('exists');
    expect(reason(await w.run('folder_create', { path: nodePath.join(w.desktop, 'a', 'b', 'c', 'd', 'e', 'f') }))).toBe('dest_missing');
  });

  it('izinli klasörlerin dışında onay ister; engelli yerde onayla da oluşturmaz', async () => {
    const target = nodePath.join(w.outside, 'Yeni');
    expect(reason(await w.run('folder_create', { path: target }))).toBe('denied');
    expect(fs.existsSync(target)).toBe(false);
    w.tools.approvals.push('approved');
    expect((await w.run('folder_create', { path: target })).ok).toBe(true);
    expect(w.approvals).toHaveLength(2);

    w.tools.approvals.push('approved', 'approved', 'approved');
    for (const path of [nodePath.join(w.home, 'AppData', 'Roaming', 'Yeni'), nodePath.join(w.desktop, '.ssh'), 'C:\\Windows\\FuberSinama', nodePath.join(w.desktop, 'son. ')]) {
      expect((await w.run('folder_create', { path })).ok, path).toBe(false);
    }
    expect(w.approvals).toHaveLength(2);
    expect(fs.existsSync(nodePath.join(w.home, 'AppData', 'Roaming', 'Yeni'))).toBe(false);
  });

  it('bağ üzerinden engelli yere kaçış: hedefin GERÇEK yoluna göre karar verilir', async () => {
    fs.symlinkSync(nodePath.join(w.home, 'AppData', 'Roaming'), nodePath.join(w.desktop, 'kisayol'), 'junction');
    w.tools.approvals.push('approved');
    const result = await w.run('folder_create', { path: nodePath.join(w.desktop, 'kisayol', 'Yeni') });
    expect(result.ok).toBe(false);
    expect(reason(result)).toBe('blocked');
    expect(fs.existsSync(nodePath.join(w.home, 'AppData', 'Roaming', 'Yeni'))).toBe(false);
    expect(w.approvals).toHaveLength(0);
  });
});

describe('file_delete', () => {
  const deleteTool = () => fileControlTools(w.env).find((tool) => tool.name === 'file_delete')!;

  it('kalıcı silmez: Geri Dönüşüm Kutusu’na gönderir ve bunu söyler', async () => {
    const source = write(nodePath.join(w.desktop, 'eski.txt'), 'sakla');
    const result = await w.run('file_delete', { path: 'Masaüstü\\eski.txt' });
    expect(result.ok).toBe(true);
    expect(result.text).toContain('Geri Dönüşüm Kutusu');
    expect(result.data).toMatchObject({ path: source, recycleBin: true, count: 1 });
    expect(w.trashed).toEqual([source]);
    expect(fs.existsSync(source)).toBe(false);
    expect(fs.readFileSync(nodePath.join(w.trashDir, '1-eski.txt'), 'utf8')).toBe('sakla');
  });

  it('onay cümlesi tam yolu, klasörse içindeki öğe sayısını söyler', async () => {
    const file = write(nodePath.join(w.desktop, 'a.txt'));
    const folder = nodePath.join(w.documents, 'Eski Proje');
    write(nodePath.join(folder, 'bir.txt'));
    write(nodePath.join(folder, 'alt', 'iki.txt'));
    const tool = deleteTool();
    expect(tool.approvalText!({ path: 'Masaüstü\\a.txt' })).toBe(`“${file}” dosyasını Geri Dönüşüm Kutusu’na göndermek istiyorum.`);
    expect(tool.approvalText!({ path: folder })).toBe(`“${folder}” klasörünü içindeki 3 öğeyle birlikte Geri Dönüşüm Kutusu’na göndermek istiyorum.`);
    expect(tool.approvalText!({ path: nodePath.join(w.desktop, 'yok.txt') })).toContain(nodePath.join(w.desktop, 'yok.txt'));

    const result = await w.run('file_delete', { path: folder });
    expect(result).toMatchObject({ ok: true, data: { folder: true, count: 3 } });
    expect(fs.existsSync(folder)).toBe(false);
  });

  it('izinli klasörün kendisi, kullanıcı klasörü, engelli yol ve bağ silinmez', async () => {
    write(nodePath.join(w.desktop, 'anahtar.pem'));
    write(nodePath.join(w.home, 'AppData', 'Roaming', 'veri.txt'));
    write(nodePath.join(w.outside, 'hedef.txt'));
    fs.symlinkSync(w.outside, nodePath.join(w.desktop, 'bag'), 'junction');
    expect(reason(await w.run('file_delete', { path: w.desktop }))).toBe('protected');
    expect(reason(await w.run('file_delete', { path: w.home }))).toBe('protected');
    expect(reason(await w.run('file_delete', { path: nodePath.dirname(w.home) }))).toBe('protected');
    expect(reason(await w.run('file_delete', { path: nodePath.parse(w.home).root }))).toBe('protected');
    expect(reason(await w.run('file_delete', { path: nodePath.join(w.desktop, 'anahtar.pem') }))).toBe('blocked');
    expect(reason(await w.run('file_delete', { path: nodePath.join(w.home, 'AppData', 'Roaming', 'veri.txt') }))).toBe('blocked');
    expect(reason(await w.run('file_delete', { path: 'C:\\Windows\\System32\\drivers\\etc\\hosts' }))).toBe('blocked');
    const link = await w.run('file_delete', { path: nodePath.join(w.desktop, 'bag') });
    expect(reason(link)).toBe('link');
    expect(reason(await w.run('file_delete', { path: nodePath.join(w.desktop, 'yok.txt') }))).toBe('missing');
    expect(w.trashed).toEqual([]);
    expect(fs.existsSync(nodePath.join(w.outside, 'hedef.txt'))).toBe(true);
  });

  it('çöp kutusu hata verirse ya da öğe yerinde kalırsa "silindi" denmez', async () => {
    const source = write(nodePath.join(w.desktop, 'a.txt'));
    w.trashMode = 'fail';
    const failed = await w.run('file_delete', { path: source });
    expect(failed.ok).toBe(false);
    expect(failed.text).toContain('Silindi deme');
    w.trashMode = 'noop';
    const still = await w.run('file_delete', { path: source });
    expect(still.ok).toBe(false);
    expect(reason(still)).toBe('no_effect');
    expect(fs.existsSync(source)).toBe(true);
  });
});

describe('file_open ve file_reveal', () => {
  it('belgeyi varsayılan uygulamada, klasörü Gezgin’de açar; hata dürüstçe döner', async () => {
    const doc = write(nodePath.join(w.documents, 'rapor.pdf'));
    const opened = await w.run('file_open', { path: 'Belgeler\\rapor.pdf' });
    expect(opened.ok).toBe(true);
    expect(w.opened).toEqual([doc]);
    expect((await w.run('file_open', { path: w.downloads })).text).toContain('Gezgin');
    expect(w.opened).toEqual([doc, w.downloads]);
    w.openError = 'İlişkili uygulama yok';
    const failed = await w.run('file_open', { path: doc });
    expect(failed.ok).toBe(false);
    expect(failed.text).toContain('İlişkili uygulama yok');
  });

  it('çalıştırılabilir ve betik dosyalarını AÇMAZ', async () => {
    for (const name of ['kur.exe', 'betik.bat', 'betik.CMD', 'betik.ps1', 'makro.vbs', 'kod.js', 'paket.msi', 'kisayol.lnk', 'ekran.scr', 'ayar.reg', 'uyg.hta']) {
      const file = write(nodePath.join(w.downloads, name));
      const result = await w.run('file_open', { path: file });
      expect(result.ok, name).toBe(false);
      expect(reason(result), name).toBe('executable');
    }
    expect(w.opened).toEqual([]);
  });

  it('izinli klasörlerin dışındaki dosya onay ister; engelli dosya hiç açılmaz; bağın gerçek hedefine bakılır', async () => {
    const doc = write(nodePath.join(w.outside, 'not.txt'));
    expect(reason(await w.run('file_open', { path: doc }))).toBe('denied');
    w.tools.approvals.push('approved');
    expect((await w.run('file_open', { path: doc })).ok).toBe(true);
    expect(w.opened).toEqual([doc]);

    write(nodePath.join(w.home, 'AppData', 'Roaming', 'gizli.txt'));
    fs.symlinkSync(nodePath.join(w.home, 'AppData', 'Roaming'), nodePath.join(w.desktop, 'kisayol'), 'junction');
    w.tools.approvals.push('approved');
    const escaped = await w.run('file_open', { path: nodePath.join(w.desktop, 'kisayol', 'gizli.txt') });
    expect(escaped.ok).toBe(false);
    expect(reason(escaped)).toBe('blocked');
    expect(w.opened).toEqual([doc]);
    // İzinli klasördeki bağ izinli klasörün DIŞINA gidiyorsa "dışarıda" sayılır: onay ister.
    fs.symlinkSync(w.outside, nodePath.join(w.desktop, 'disari'), 'junction');
    w.tools.approvals.splice(0);
    expect(reason(await w.run('file_open', { path: nodePath.join(w.desktop, 'disari', 'not.txt') }))).toBe('denied');
  });

  it('file_reveal Gezgin’de gösterir; engelli yolu göstermez', async () => {
    const doc = write(nodePath.join(w.desktop, 'a.txt'));
    const result = await w.run('file_reveal', { path: doc });
    expect(result).toMatchObject({ ok: true, data: { path: doc } });
    expect(w.revealed).toEqual([doc]);
    expect((await w.run('file_reveal', { path: nodePath.join(w.home, 'AppData') })).ok).toBe(false);
    expect((await w.run('file_reveal', { path: nodePath.join(w.desktop, 'yok.txt') })).ok).toBe(false);
    expect(w.revealed).toEqual([doc]);
  });
});

describe('file_write', () => {
  it('yeni metin dosyası yazar: UTF-8 (BOM’suz), satır ve boyut sonuçta; kısaltmalı yol çalışır; onay istemez', async () => {
    const result = await w.run('file_write', { path: 'Masaüstü\\notlar.md', content: '# Başlık\nçğıöşü ÇĞİÖŞÜ\n' });
    expect(result.ok).toBe(true);
    const file = nodePath.join(w.desktop, 'notlar.md');
    expect(result.text).toContain(`Oluşturuldu: ${file} (2 satır`);
    expect(result.data).toMatchObject({ path: file, created: true, overwritten: false, lines: 2 });
    const bytes = fs.readFileSync(file);
    expect(bytes.subarray(0, 3)).not.toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(bytes.toString('utf8')).toBe('# Başlık\nçğıöşü ÇĞİÖŞÜ\n');
    expect(w.approvals).toEqual([]);
    expect(w.activity).toEqual(['start:files:notlar.md', 'end:files:notlar.md']);
    // Baştaki BOM yazılmaz; boş dosya yazılabilir.
    expect((await w.run('file_write', { path: nodePath.join(w.desktop, 'bom.txt'), content: '﻿merhaba' })).ok).toBe(true);
    expect(fs.readFileSync(nodePath.join(w.desktop, 'bom.txt'), 'utf8')).toBe('merhaba');
    expect((await w.run('file_write', { path: nodePath.join(w.desktop, 'bos.txt'), content: '' })).data).toMatchObject({ bytes: 0, lines: 0 });
  });

  it('var olan dosyanın ÜZERİNE YAZMAZ: overwrite verilmezse neden ve öneri döner, onay sorulmaz', async () => {
    const file = write(nodePath.join(w.desktop, 'rapor.txt'), 'eski içerik');
    const result = await w.run('file_write', { path: file, content: 'yeni' });
    expect(reason(result)).toBe('exists');
    expect(result.text).toContain('file_edit');
    expect(result.text).toContain('overwrite=true');
    expect(fs.readFileSync(file, 'utf8')).toBe('eski içerik');
    expect(w.approvals).toEqual([]);
    // Klasörün üzerine de yazılmaz.
    fs.mkdirSync(nodePath.join(w.desktop, 'Klasör'));
    expect(reason(await w.run('file_write', { path: nodePath.join(w.desktop, 'Klasör'), content: 'x', overwrite: true }))).toBe('exists');
  });

  it('overwrite: izinli klasörde de HER SEFERİNDE onay; kartta yol, eski ve yeni boyut; ret dosyaya dokunmaz', async () => {
    const file = write(nodePath.join(w.desktop, 'rapor.txt'), 'eski içerik');
    const denied = await w.run('file_write', { path: file, content: 'yepyeni içerik burada', overwrite: true });
    expect(reason(denied)).toBe('denied');
    expect(fs.readFileSync(file, 'utf8')).toBe('eski içerik');
    expect(w.approvals[0]).toMatchObject({ toolName: 'file_write', moduleId: 'pc' });
    expect(w.approvals[0]!.summary).toContain(file);
    expect(w.approvals[0]!.summary).toContain('12 B');
    expect(w.approvals[0]!.summary).toContain('22 B');
    // Yazılan metin onay girdisine girmez.
    expect(JSON.stringify(w.approvals[0]!.input)).not.toContain('yepyeni');

    w.tools.approvals.push('approved');
    const done = await w.run('file_write', { path: file, content: 'yepyeni içerik burada', overwrite: true });
    expect(done.ok).toBe(true);
    expect(done.text).toContain('Üzerine yazıldı');
    expect(done.data).toMatchObject({ created: false, overwritten: true });
    expect(fs.readFileSync(file, 'utf8')).toBe('yepyeni içerik burada');
    // Önceki onay hatırlanmaz.
    expect(reason(await w.run('file_write', { path: file, content: 'üçüncü', overwrite: true }))).toBe('denied');
    expect(w.approvals).toHaveLength(3);
    // Yan (geçici) dosya kalmaz.
    expect(fs.readdirSync(w.desktop)).toEqual(['rapor.txt']);
  });

  it('izinli klasörlerin dışında yeni dosya onay ister; engelli yere ve parola/anahtar adına onayla da yazmaz', async () => {
    const outside = nodePath.join(w.outside, 'not.txt');
    expect(reason(await w.run('file_write', { path: outside, content: 'x' }))).toBe('denied');
    expect(fs.existsSync(outside)).toBe(false);
    expect(w.approvals[0]!.summary).toContain(outside);
    w.tools.approvals.push('approved');
    expect((await w.run('file_write', { path: outside, content: 'x' })).ok).toBe(true);

    w.tools.approvals.push('approved', 'approved', 'approved');
    const before = w.approvals.length;
    expect(reason(await w.run('file_write', { path: nodePath.join(w.home, 'AppData', 'Roaming', 'a.txt'), content: 'x' }))).toBe('blocked');
    expect(reason(await w.run('file_write', { path: nodePath.join(w.desktop, 'gizli.pem'), content: 'x' }))).toBe('blocked');
    expect(reason(await w.run('file_write', { path: nodePath.join(w.desktop, '.env'), content: 'x' }))).toBe('blocked');
    expect(reason(await w.run('file_write', { path: 'göreli\\yol.txt', content: 'x' }))).toBe('bad_path');
    expect(w.approvals).toHaveLength(before);
  });

  it('çalıştırılabilir/betik uzantısına ve PowerShell profil klasörüne HİÇ yazmaz (onay da sormaz)', async () => {
    for (const name of ['kur.bat', 'betik.ps1', 'program.exe', 'kod.js', 'kisayol.lnk', 'ayar.reg', 'makro.docm']) {
      const result = await w.run('file_write', { path: nodePath.join(w.desktop, name), content: 'x' });
      expect(reason(result), name).toBe('executable');
    }
    fs.mkdirSync(nodePath.join(w.documents, 'WindowsPowerShell'));
    expect(reason(await w.run('file_write', { path: nodePath.join(w.documents, 'WindowsPowerShell', 'profil.txt'), content: 'x' }))).toBe('blocked');
    expect(fs.readdirSync(w.desktop)).toEqual([]);
    expect(w.approvals).toEqual([]);
  });

  it('boyut sınırı, NUL içeren içerik, geçersiz ad ve olmayan klasör reddedilir (klasör sessizce oluşturulmaz)', async () => {
    expect(reason(await w.run('file_write', { path: nodePath.join(w.desktop, 'buyuk.txt'), content: 'a'.repeat(FILE_LIMITS.writeBytes + 1) }))).toBe('too_big');
    expect(reason(await w.run('file_write', { path: nodePath.join(w.desktop, 'ikili.txt'), content: 'a\u0000b' }))).toBe('binary');
    expect(reason(await w.run('file_write', { path: nodePath.join(w.desktop, 'CON'), content: 'x' }))).toBe('bad_name');
    const missing = await w.run('file_write', { path: nodePath.join(w.desktop, 'Yok', 'a.txt'), content: 'x' });
    expect(reason(missing)).toBe('dest_missing');
    expect(missing.text).toContain('folder_create');
    expect(fs.readdirSync(w.desktop)).toEqual([]);
  });

  it('bağ üzerinden ve çok adlı (sabit bağlı) dosyaya yazmaz; bağın GERÇEK hedefi engelliyse yeni dosya da yazılmaz', async () => {
    const real = write(nodePath.join(w.documents, 'asıl.txt'), 'asıl');
    const hard = nodePath.join(w.desktop, 'ikiz.txt');
    fs.linkSync(real, hard);
    w.tools.approvals.push('approved');
    expect(reason(await w.run('file_write', { path: hard, content: 'x', overwrite: true }))).toBe('link');
    expect(fs.readFileSync(real, 'utf8')).toBe('asıl');
    expect(w.approvals).toEqual([]);

    // Masaüstündeki bağlantı noktası AppData'ya gidiyor: içine yazılmaz.
    const junction = nodePath.join(w.desktop, 'Kaçış');
    fs.symlinkSync(nodePath.join(w.home, 'AppData', 'Roaming'), junction, 'junction');
    expect(reason(await w.run('file_write', { path: nodePath.join(junction, 'a.txt'), content: 'x' }))).toBe('blocked');
    expect(fs.readdirSync(nodePath.join(w.home, 'AppData', 'Roaming'))).toEqual([]);
  });
});

describe('file_edit', () => {
  it('tam bir kez geçen parçayı değiştirir; özet satır numarasını, satır sayılarını ve yeni boyutu söyler', async () => {
    const file = write(nodePath.join(w.desktop, 'plan.md'), '# Plan\n\nSalı: toplantı\nÇarşamba: rapor\n');
    const result = await w.run('file_edit', { path: 'Masaüstü\\plan.md', old_text: 'Salı: toplantı', new_text: 'Salı: toplantı (14.00)\nSalı: sunum' });
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('# Plan\n\nSalı: toplantı (14.00)\nSalı: sunum\nÇarşamba: rapor\n');
    expect(result.text).toContain(`Düzenlendi: ${file}. 1 yer değişti (3. satırda): 1 satır → 2 satır`);
    expect(result.text).toContain('- Salı: toplantı\n+ Salı: toplantı (14.00)');
    expect(result.data).toMatchObject({ replaced: 1, line: 3, oldLines: 1, newLines: 2, lineEndings: 'lf', bom: false });
    expect(w.approvals).toEqual([]);
    // Silme: new_text boş.
    const removed = await w.run('file_edit', { path: file, old_text: 'Salı: sunum\n', new_text: '' });
    expect(removed.text).toContain('+ (silindi)');
    expect(fs.readFileSync(file, 'utf8')).toBe('# Plan\n\nSalı: toplantı (14.00)\nÇarşamba: rapor\n');
    expect(fs.readdirSync(w.desktop)).toEqual(['plan.md']);
  });

  it('bulunamayan ve birden çok yerde geçen parça dosyayı DEĞİŞTİRMEZ; replace_all hepsini değiştirir', async () => {
    const file = write(nodePath.join(w.desktop, 'liste.txt'), 'elma\narmut\nelma\nkiraz\nelma\n');
    const none = await w.run('file_edit', { path: file, old_text: 'muz', new_text: 'x' });
    expect(reason(none)).toBe('not_found');
    const many = await w.run('file_edit', { path: file, old_text: 'elma', new_text: 'ayva' });
    expect(reason(many)).toBe('ambiguous');
    expect(many.text).toContain('3 yerde geçiyor');
    expect(many.text).toContain('replace_all');
    expect(reason(await w.run('file_edit', { path: file, old_text: 'elma', new_text: 'elma' }))).toBe('no_change');
    expect(fs.readFileSync(file, 'utf8')).toBe('elma\narmut\nelma\nkiraz\nelma\n');

    const all = await w.run('file_edit', { path: file, old_text: 'elma', new_text: 'ayva', replace_all: true });
    expect(all.ok).toBe(true);
    expect(all.text).toContain('3 yer değişti (ilki 1. satırda)');
    expect(fs.readFileSync(file, 'utf8')).toBe('ayva\narmut\nayva\nkiraz\nayva\n');
    // Çevresiyle benzersiz yapılan parça tek eşleşir.
    expect((await w.run('file_edit', { path: file, old_text: 'kiraz\nayva', new_text: 'kiraz\nüzüm' })).ok).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('ayva\narmut\nayva\nkiraz\nüzüm\n');
  });

  it('CRLF satır sonu ve BOM KORUNUR: model \\n verse de dosya CRLF kalır', async () => {
    const file = nodePath.join(w.desktop, 'windows.txt');
    fs.writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('birinci satır\r\nikinci satır\r\nüçüncü satır\r\n', 'utf8')]));
    const result = await w.run('file_edit', { path: file, old_text: 'birinci satır\nikinci satır', new_text: 'BİR\nİKİ\nARA' });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ lineEndings: 'crlf', bom: true, oldLines: 2, newLines: 3 });
    const bytes = fs.readFileSync(file);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = bytes.subarray(3).toString('utf8');
    expect(text).toBe('BİR\r\nİKİ\r\nARA\r\nüçüncü satır\r\n');
    // Tek başına \n kalmadı.
    expect(/[^\r]\n/.test(text)).toBe(false);

    // LF dosyada model CRLF verirse dosya LF kalır.
    const unix = write(nodePath.join(w.desktop, 'unix.txt'), 'a\nb\nc\n');
    expect((await w.run('file_edit', { path: unix, old_text: 'a\r\nb', new_text: 'x\r\ny' })).ok).toBe(true);
    expect(fs.readFileSync(unix, 'utf8')).toBe('x\ny\nc\n');
  });

  it('ikili, UTF-8 olmayan ve çok büyük dosya düzenlenmez; dosya bayt bayt aynı kalır', async () => {
    const binary = nodePath.join(w.desktop, 'veri.dat');
    fs.writeFileSync(binary, Buffer.from([0x41, 0x00, 0x42, 0x43]));
    expect(reason(await w.run('file_edit', { path: binary, old_text: 'B', new_text: 'X' }))).toBe('binary');
    expect([...fs.readFileSync(binary)]).toEqual([0x41, 0x00, 0x42, 0x43]);

    const latin = nodePath.join(w.desktop, 'eski-kodlama.txt');
    fs.writeFileSync(latin, Buffer.from([0x6d, 0x65, 0x72, 0x68, 0x61, 0x62, 0x61, 0x20, 0xfd, 0xfe, 0xf0]));
    const refused = await w.run('file_edit', { path: latin, old_text: 'merhaba', new_text: 'selam' });
    expect(reason(refused)).toBe('not_utf8');
    expect(fs.readFileSync(latin)).toHaveLength(11);

    const big = nodePath.join(w.desktop, 'buyuk.txt');
    fs.writeFileSync(big, 'x'.repeat(FILE_LIMITS.editBytes + 10));
    expect(reason(await w.run('file_edit', { path: big, old_text: 'x', new_text: 'y', replace_all: true }))).toBe('too_big');
    expect(reason(await w.run('file_edit', { path: nodePath.join(w.desktop, 'yok.txt'), old_text: 'a', new_text: 'b' }))).toBe('missing');
  });

  it('izinli klasörlerin dışında HER SEFERİNDE onay; ret dosyaya dokunmaz', async () => {
    const file = write(nodePath.join(w.outside, 'ayar.txt'), 'renk=mavi\n');
    expect(reason(await w.run('file_edit', { path: file, old_text: 'mavi', new_text: 'yeşil' }))).toBe('denied');
    expect(fs.readFileSync(file, 'utf8')).toBe('renk=mavi\n');
    expect(w.approvals[0]).toMatchObject({ toolName: 'file_edit', moduleId: 'pc' });
    expect(w.approvals[0]!.summary).toContain(file);
    w.tools.approvals.push('approved');
    expect((await w.run('file_edit', { path: file, old_text: 'mavi', new_text: 'yeşil' })).ok).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('renk=yeşil\n');
    expect(reason(await w.run('file_edit', { path: file, old_text: 'yeşil', new_text: 'kırmızı' }))).toBe('denied');
    expect(w.approvals).toHaveLength(3);
  });

  it('engelli yol, betik/çalıştırılabilir dosya, bağ ve çok adlı dosya düzenlenmez (onay da sorulmaz)', async () => {
    w.tools.approvals.push('approved', 'approved', 'approved', 'approved', 'approved');
    const script = write(nodePath.join(w.desktop, 'kur.bat'), '@echo off\r\necho merhaba\r\n');
    expect(reason(await w.run('file_edit', { path: script, old_text: 'merhaba', new_text: 'del /q *' }))).toBe('executable');
    expect(fs.readFileSync(script, 'utf8')).toContain('merhaba');
    const secret = write(nodePath.join(w.desktop, 'gizli.pem'), 'anahtar');
    expect(reason(await w.run('file_edit', { path: secret, old_text: 'anahtar', new_text: 'x' }))).toBe('blocked');
    const appdata = write(nodePath.join(w.home, 'AppData', 'Roaming', 'ayar.txt'), 'a');
    expect(reason(await w.run('file_edit', { path: appdata, old_text: 'a', new_text: 'b' }))).toBe('blocked');

    const real = write(nodePath.join(w.documents, 'asıl.txt'), 'asıl metin');
    const hard = nodePath.join(w.desktop, 'ikiz.txt');
    fs.linkSync(real, hard);
    expect(reason(await w.run('file_edit', { path: hard, old_text: 'asıl', new_text: 'sahte' }))).toBe('link');
    expect(fs.readFileSync(real, 'utf8')).toBe('asıl metin');
    expect(reason(await w.run('file_edit', { path: w.desktop, old_text: 'a', new_text: 'b' }))).toBe('not_file');
    expect(w.approvals).toEqual([]);
  });

  it('onay beklenirken "Durdur"a basılırsa yazılmaz (file_write overwrite ve file_edit)', async () => {
    const inside = write(nodePath.join(w.desktop, 'rapor.txt'), 'eski');
    const outside = write(nodePath.join(w.outside, 'ayar.txt'), 'renk=mavi');
    w.tools.requestApproval = async () => {
      w.gate.stop();
      return 'approved';
    };
    expect(reason(await w.run('file_write', { path: inside, content: 'yeni', overwrite: true }))).toBe('panic');
    expect(fs.readFileSync(inside, 'utf8')).toBe('eski');
    expect(reason(await w.run('file_edit', { path: outside, old_text: 'mavi', new_text: 'yeşil' }))).toBe('panic');
    expect(fs.readFileSync(outside, 'utf8')).toBe('renk=mavi');
  });
});

describe('Durdur ve iptal', () => {
  const calls = (): Array<[string, unknown]> => {
    const a = nodePath.join(w.desktop, 'a.txt');
    return [
      ['file_find', { name: 'a' }],
      ['file_copy', { from: a, to: w.documents }],
      ['file_move', { from: a, new_name: 'b.txt' }],
      ['folder_create', { path: nodePath.join(w.desktop, 'Yeni') }],
      ['file_delete', { path: a }],
      ['file_open', { path: a }],
      ['file_reveal', { path: a }],
      ['file_write', { path: nodePath.join(w.desktop, 'yeni.txt'), content: 'x' }],
      ['file_edit', { path: a, old_text: 'içerik', new_text: 'başka' }],
    ];
  };

  it('"Durdur"dan sonra hiçbir dosya aracı başlamaz', async () => {
    write(nodePath.join(w.desktop, 'a.txt'));
    w.gate.stop();
    for (const [name, input] of calls()) {
      const result = await w.run(name, input);
      expect(result.ok, name).toBe(false);
      expect(reason(result), name).toBe('panic');
    }
    expect(fs.readdirSync(w.desktop)).toEqual(['a.txt']);
    expect(fs.readdirSync(w.documents)).toEqual([]);
    expect(w.trashed).toEqual([]);
    expect(w.opened).toEqual([]);
    expect(w.revealed).toEqual([]);
    expect(w.activity).toEqual([]);
  });

  it('iptal edilmiş çağrı başlamaz', async () => {
    write(nodePath.join(w.desktop, 'a.txt'));
    const abort = new AbortController();
    abort.abort();
    for (const [name, input] of calls()) expect(reason(await w.run(name, input, abort.signal)), name).toBe('aborted');
    expect(fs.readdirSync(w.desktop)).toEqual(['a.txt']);
  });

  it('onay beklenirken "Durdur"a basılırsa onay gelse de iş yapılmaz', async () => {
    const source = write(nodePath.join(w.desktop, 'a.txt'));
    w.tools.requestApproval = async () => {
      w.gate.stop();
      return 'approved';
    };
    const result = await w.run('file_copy', { from: source, to: w.outside });
    expect(reason(result)).toBe('panic');
    expect(fs.existsSync(nodePath.join(w.outside, 'a.txt'))).toBe(false);
  });

  it('süren klasör kopyası "Durdur"la kesilir ve yarım kopya geri alınır', async () => {
    const project = nodePath.join(w.documents, 'Büyük');
    for (let i = 0; i < 40; i++) write(nodePath.join(project, `dosya-${String(i).padStart(2, '0')}.txt`), 'x'.repeat(100));
    // İlk dosyalar kopyalanırken dur: gate.busy başladığında bir sonraki tıkta "Durdur".
    const original = w.env.gate.busy.bind(w.env.gate);
    w.env.gate.busy = (action, label, work) =>
      original(action, label, async () => {
        setTimeout(() => w.gate.stop(), 0);
        return work();
      });
    const result = await w.run('file_copy', { from: project, to: w.desktop });
    expect(result.ok).toBe(false);
    expect(reason(result)).toBe('aborted');
    expect(fs.existsSync(nodePath.join(w.desktop, 'Büyük'))).toBe(false);
    expect(fs.readdirSync(project)).toHaveLength(40);
  });
});
