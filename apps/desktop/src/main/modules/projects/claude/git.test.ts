import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { clearFileCache, gitDiff, gitSummary, isReallyInside, matchFiles, parsePorcelain, projectFiles, relativeToProject } from './git';

// Gerçek git süreçleri yük altında (başka sınamalar, çok sayıda worktree) 5 sn'yi aşıyor: dosya düzeyinde süre.
vi.setConfig({ testTimeout: 30_000 });

const WIN = process.platform === 'win32';
// Türkçe harfli kök: git çıktısındaki yollar ve gerçek yol karşılaştırması bu adlarla da çalışmalı.
const tmp = path.join(fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-git-'))), 'Şirket İşleri ğü');
fs.mkdirSync(tmp, { recursive: true });
afterAll(async () => {
  await fs.promises.rm(path.dirname(tmp), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const hasGit = ((): boolean => {
  try {
    execFileSync('git', ['--version'], { windowsHide: true, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

let counter = 0;
const folder = (label: string): string => {
  const dir = path.join(tmp, `${label}-${++counter}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const write = (file: string, content = ''): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};
const git = (cwd: string, ...args: string[]): void => {
  execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', ...args], { windowsHide: true, stdio: 'ignore' });
};

describe('git özeti ve fark', () => {
  it('porcelain çıktısını çözer: yeniden adlandırmada yeni ad, eski ad atlanır', () => {
    expect(parsePorcelain(' M a.ts\0R  yeni.ts\0eski.ts\0?? not.md\0')).toEqual([
      { path: 'a.ts', status: 'M' },
      { path: 'yeni.ts', status: 'R' },
      { path: 'not.md', status: '??' },
    ]);
    expect(parsePorcelain('')).toEqual([]);
    expect(parsePorcelain(Array.from({ length: 600 }, (_, i) => ` M f${i}.ts`).join('\0'))).toHaveLength(500);
  });

  it('depo kökündeki yolları proje klasörüne göre çevirir; önek dışındakiler atılır', () => {
    const files = [
      { path: 'paketler/uygulama/src/a.ts', status: 'M' },
      { path: 'paketler/baska/b.ts', status: 'M' },
      { path: 'README.md', status: '??' },
    ];
    expect(relativeToProject(files, 'paketler/uygulama/')).toEqual([{ path: 'src/a.ts', status: 'M' }]);
    expect(relativeToProject(files, '')).toBe(files);
  });

  it('depo olmayan klasörde git:false döner', async () => {
    expect(await gitSummary(folder('depo-degil'))).toEqual({ git: false, files: [] });
  });

  it.skipIf(!hasGit)('değişen ve izlenmeyen dosyaları, dalı ve farkı verir; klasör dışına çıkılmaz', async () => {
    const dir = folder('depo');
    git(dir, 'init', '-q', '-b', 'deneme');
    write(path.join(dir, 'a.txt'), 'bir\n');
    git(dir, 'add', 'a.txt');
    git(dir, 'commit', '-q', '-m', 'ilk');
    write(path.join(dir, 'a.txt'), 'iki\n');
    write(path.join(dir, 'yeni dosya.md'), 'merhaba\n');
    write(path.join(dir, 'çığlık öğüt.txt'), 'şey\n');

    const summary = await gitSummary(dir);
    expect(summary.git).toBe(true);
    expect(summary.branch).toBe('deneme');
    expect([...summary.files].sort((x, y) => x.path.localeCompare(y.path, 'en'))).toEqual(
      [
        { path: 'a.txt', status: 'M' },
        { path: 'yeni dosya.md', status: '??' },
        { path: 'çığlık öğüt.txt', status: '??' },
      ].sort((x, y) => x.path.localeCompare(y.path, 'en')),
    );

    expect((await gitDiff(dir, 'a.txt')).diff).toMatch(/-bir\n\+iki/);
    expect(await gitDiff(dir, 'yeni dosya.md')).toMatchObject({ truncated: false });
    expect((await gitDiff(dir, 'yeni dosya.md')).diff).toMatch(/\+merhaba/);
    expect((await gitDiff(dir, 'çığlık öğüt.txt')).diff).toMatch(/\+\+\+ b\/çığlık öğüt\.txt\n\+şey/);
    await expect(gitDiff(dir, '..\\..\\disari.txt')).rejects.toThrow(/dışında/);
    await expect(gitDiff(dir, '../disari.txt')).rejects.toThrow(/dışında/);
    expect((await gitDiff(dir, 'yok.txt')).diff).toBe('');
  }, 30_000); // yük altında git süreçleri 5 sn'yi aşıyor (başka sınamalar koşarken)

  it.skipIf(!hasGit)('proje deponun alt klasöründeyse yollar projeye göredir ve dışarısı listelenmez', async () => {
    const repo = folder('ust-depo');
    const sub = path.join(repo, 'paketler', 'uygulama');
    git(repo, 'init', '-q', '-b', 'main');
    write(path.join(sub, 'src', 'a.ts'), 'export const a = 1;\n');
    write(path.join(repo, 'kok.txt'), 'kök\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'ilk');
    write(path.join(sub, 'src', 'a.ts'), 'export const a = 2;\n');
    write(path.join(sub, 'src', 'b.ts'), 'export const b = 1;\n');
    write(path.join(repo, 'kok.txt'), 'kök değişti\n');

    const summary = await gitSummary(sub);
    expect([...summary.files].sort((x, y) => x.path.localeCompare(y.path))).toEqual([
      { path: 'src/a.ts', status: 'M' },
      { path: 'src/b.ts', status: '??' },
    ]);
    expect((await gitDiff(sub, 'src/a.ts')).diff).toMatch(/-export const a = 1;\n\+export const a = 2;/);
    expect((await gitDiff(sub, 'src/b.ts')).diff).toMatch(/^\+export const b/m);
  });

  it('proje içindeki bağlantı dışarıyı gösteriyorsa fark okunmaz', async () => {
    const dir = folder('baglantili');
    const outside = folder('disari');
    write(path.join(outside, 'gizli.txt'), 'PROJE-DISI-SIR\n');
    fs.symlinkSync(outside, path.join(dir, 'baglanti'), WIN ? 'junction' : 'dir');
    await expect(gitDiff(dir, 'baglanti/gizli.txt')).rejects.toThrow(/dışında \(bağlantı\)/);
    write(path.join(dir, 'ic.txt'), 'iceride\n');
    expect((await gitDiff(dir, 'ic.txt')).diff).toMatch(/\+iceride/);
    expect(isReallyInside(dir, path.join(dir, 'baglanti', 'yeni', 'x.txt'))).toBe(false);
    expect(isReallyInside(dir, path.join(dir, 'yeni', 'x.txt'))).toBe(true);
    expect(isReallyInside(path.join(dir, 'yok-kok'), dir)).toBe(false);
  });

  it('çok uzun fark kısaltılır ve işaretlenir', async () => {
    const dir = folder('uzun');
    write(path.join(dir, 'buyuk.txt'), `${'satır\n'.repeat(60_000)}`);
    const result = await gitDiff(dir, 'buyuk.txt');
    expect(result.truncated).toBe(true);
    expect(result.diff.length).toBe(200_000);
  });
});

describe('"@" dosya önerisi', () => {
  it('sıra: yolun başı, dosya adının başı, klasör adının başı, içinde geçen, bulanık; en çok 50', () => {
    expect(matchFiles(['src/app.ts', 'src/apple/x.ts', 'test/app.test.ts', 'README.md', 'docs/a/p/p.md'], 'app')).toEqual([
      'src/app.ts',
      'test/app.test.ts',
      'src/apple/x.ts',
      'docs/a/p/p.md',
    ]);
    expect(matchFiles(['src/app.ts', 'srcmap.ts'], 'src/')).toEqual(['src/app.ts']);
    expect(matchFiles(['src/main/oturum.ts', 'src/shared/olay.ts'], 'smo')).toEqual(['src/main/oturum.ts']);
    expect(matchFiles(['README.md', 'src/a.ts', 'b.ts'], '')).toEqual(['b.ts', 'README.md', 'src/a.ts']);
    expect(matchFiles(Array.from({ length: 200 }, (_, i) => `d/f${i}.ts`), 'f')).toHaveLength(50);
    expect(matchFiles(['src/app.ts'], '@SRC\\app')).toEqual(['src/app.ts']);
    expect(matchFiles(['src/app.ts', 'b.ts'], 'f', 5)).toEqual([]);
  });

  it('depo değilse bütçeli gezinti (ağır klasörler atlanır); depoda .gitignore’a uyar', async () => {
    const dir = folder('oneri');
    write(path.join(dir, 'src', 'ana.ts'));
    write(path.join(dir, 'gizli.log'));
    write(path.join(dir, 'node_modules', 'paket', 'i.js'));
    write(path.join(dir, '.gitignore'), '*.log\nnode_modules/\n');
    // Süre bütçesi bu sınamanın konusu değil (aşağıdaki sınama ölçer): varsayılan 300 ms yük altında (bütün sınamalar
    // koşarken) üç dosyalık gezintide bile dolabiliyor ve sonuç "kısmi" çıkıyordu. Geniş bütçeyle koşulur.
    const walked = await projectFiles(dir, { timeMs: 600_000 });
    expect([[...walked.list].sort(), walked.truncated, walked.source]).toEqual([['.gitignore', 'gizli.log', 'src/ana.ts'], false, 'walk']);
    // Önbellek: aynı nesne döner.
    expect(await projectFiles(dir)).toBe(walked);
    if (!hasGit) return;
    git(dir, 'init', '-q');
    clearFileCache();
    const tracked = await projectFiles(dir, { timeMs: 600_000, gitTimeoutMs: 60_000 });
    expect([[...tracked.list].sort(), tracked.truncated, tracked.source]).toEqual([['.gitignore', 'src/ana.ts'], false, 'git']);
  });

  it('aynı klasör için eşzamanlı çağrılar tek taramayı paylaşır; gezinti bütçesi dolunca kısmi sonuç işaretlenir', async () => {
    const dir = folder('butce');
    for (let i = 0; i < 30; i++) write(path.join(dir, `k${i}`, 'dosya.ts'));
    clearFileCache();
    // Süre bütçesi burada da konu değil (yük altında 300 ms'de 30 klasörün 21'i gezilip kalıyordu): geniş bütçe.
    const wide = { timeMs: 600_000 };
    const [a, b, c] = await Promise.all([projectFiles(dir, wide), projectFiles(dir, wide), projectFiles(dir, wide)]);
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(a.list).toHaveLength(30);

    clearFileCache();
    const limited = await projectFiles(dir, { dirLimit: 5, timeMs: 600_000 });
    expect(limited.truncated).toBe(true);
    expect(limited.source).toBe('walk');
    expect(limited.list.length).toBeLessThan(30);
  });

  it.skipIf(!hasGit)('git listesi taşarsa gezintiye düşülmez: kısmi git listesi işaretli döner', async () => {
    const dir = folder('tasan-depo');
    for (let i = 0; i < 40; i++) write(path.join(dir, `dosya-${String(i).padStart(2, '0')}.ts`));
    write(path.join(dir, 'gizli.log'));
    write(path.join(dir, '.gitignore'), '*.log\n');
    git(dir, 'init', '-q');
    clearFileCache();
    const result = await projectFiles(dir, { gitMaxBytes: 120 });
    expect(result.source).toBe('git');
    expect(result.truncated).toBe(true);
    expect(result.list.length).toBeGreaterThan(0);
    expect(result.list.length).toBeLessThan(41);
    expect(result.list).not.toContain('gizli.log');
  });
});
