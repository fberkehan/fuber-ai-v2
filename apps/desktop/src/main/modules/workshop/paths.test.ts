import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isPlainChildDir, PathError, resolveInside, skillFilePath } from './paths';

let root: string;
let outside: string;

beforeEach(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-paths-'));
  root = path.join(base, 'skills', 'zar');
  outside = path.join(base, 'outside');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'gizli');
});

afterEach(() => {
  fs.rmSync(path.dirname(path.dirname(root)), { recursive: true, force: true });
});

describe('yol kaçışı', () => {
  const escapes = [
    '../outside/secret.txt',
    '..\\outside\\secret.txt',
    'sub/../../outside/secret.txt',
    './index.mjs',
    '..',
    '',
    'C:\\Windows\\win.ini',
    'C:index.mjs',
    '/etc/passwd',
    '\\\\server\\share\\x',
    'index.mjs:stream',
    'index.mjs\0.txt',
    'NUL',
    'con.txt',
    'index.mjs.',
    'index.mjs ',
    'a'.repeat(300),
  ];

  it.each(escapes)('%j reddedilir', (relative) => {
    expect(() => resolveInside(root, relative)).toThrow(PathError);
  });

  it('klasörün içindeki dosyayı çözer', () => {
    expect(resolveInside(root, 'index.mjs')).toBe(path.join(root, 'index.mjs'));
    expect(resolveInside(root, 'README.md')).toBe(path.join(root, 'README.md'));
  });

  it('yalnız izinli dosya adlarını yazdırır', () => {
    expect(skillFilePath(root, 'manifest.json')).toBe(path.join(root, 'manifest.json'));
    for (const name of ['package.json', 'index.js', 'lib/util.mjs', '../zar2/index.mjs', '.env']) {
      expect(() => skillFilePath(root, name)).toThrow(PathError);
    }
  });

  it('dışarıyı gösteren bağlantı klasörünü reddeder', () => {
    const link = path.join(root, 'link');
    // Windows'ta yetki gerektirmeyen bağlantı türü: junction.
    fs.symlinkSync(outside, link, 'junction');
    expect(() => resolveInside(root, 'link/secret.txt')).toThrow(/bağlantı/);
  });

  it('dışarıyı gösteren dosya bağlantısını reddeder', () => {
    const link = path.join(root, 'index.mjs');
    try {
      fs.symlinkSync(path.join(outside, 'secret.txt'), link, 'file');
    } catch {
      return; // dosya bağlantısı bu hesapta oluşturulamıyor (Windows geliştirici kipi kapalı): klasör bağlantısı sınaması yeterli
    }
    expect(() => skillFilePath(root, 'index.mjs')).toThrow(/bağlantı/);
  });

  it('bağlantı olan yetenek klasörünü sıradan klasör saymaz', () => {
    const skills = path.dirname(root);
    const linked = path.join(skills, 'baglanti');
    fs.symlinkSync(outside, linked, 'junction');
    expect(isPlainChildDir(skills, root)).toBe(true);
    expect(isPlainChildDir(skills, linked)).toBe(false);
    expect(isPlainChildDir(skills, path.join(skills, 'yok'))).toBe(false);
    expect(isPlainChildDir(skills, outside)).toBe(false);
  });
});
