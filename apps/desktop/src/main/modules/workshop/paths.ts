/**
 * Yetenek klasörlerine güvenli yol çözümü. Atölye'nin dosya araçları (modelin yazdığı yol) ve kod görüntüleme
 * (arayüzden gelen yol) buradan geçer: klasörün dışına çıkan, mutlak, aygıt adı taşıyan ya da sembolik
 * bağlantıdan geçen hiçbir yol kabul edilmez.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Bir eklenti klasöründe bulunabilecek sabit adlı dosyalar. Alt klasör yoktur. Sayfa dosyaları ayrıca: `PAGE_FILE`. */
export const SKILL_FILES = ['manifest.json', 'index.mjs', 'selftest.mjs', 'README.md'] as const;
export type SkillFile = (typeof SKILL_FILES)[number];
/** Eklenti sayfası: `page.html` ya da `page_<ad>.html` (tek dosyalık HTML). */
export const PAGE_FILE = /^page(?:_[a-z0-9]+)*\.html$/;
/** Kullanıcıya ve modele gösterilen dosya adı listesi. */
export const SKILL_FILE_NAMES = `${SKILL_FILES.join(', ')}, page.html (ya da page_<ad>.html)`;

/** Yapımı süren eklentilerin taslak klasörü; adı noktayla başladığı için eklenti taramasına girmez. */
export const DRAFTS_DIR = '.drafts';
/** Onay bekleyen güncellemeler: `.staged/<id>/`. Eski sürüm onaya dek çalışmayı sürdürür. */
export const STAGED_DIR = '.staged';
/** Saklanan eski sürümler: `.versions/<id>/<sürüm>/`. */
export const VERSIONS_DIR = '.versions';

export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathError';
  }
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

export function isSkillFile(name: string): boolean {
  return (SKILL_FILES as readonly string[]).includes(name) || PAGE_FILE.test(name);
}

/**
 * `relative` yolunu `root` içinde çözer. Reddedilenler: boş/çok uzun yol, NUL, mutlak yol (sürücü harfi, UNC, kök),
 * `..` ve `.` parçaları, `:` (alternatif veri akışı), aygıt adları, sonu nokta/boşlukla biten parçalar ve
 * yol üzerindeki sembolik bağlantılar / bağlantı noktaları (junction).
 */
export function resolveInside(root: string, relative: string): string {
  if (typeof relative !== 'string' || relative.length === 0) throw new PathError('Dosya yolu boş olamaz.');
  if (relative.length > 200) throw new PathError('Dosya yolu çok uzun.');
  if (relative.includes('\0')) throw new PathError('Dosya yolu geçersiz karakter içeriyor.');
  if (path.win32.isAbsolute(relative) || path.posix.isAbsolute(relative) || /^[a-zA-Z]:/.test(relative)) {
    throw new PathError('Mutlak yol kabul edilmez; yalnız yetenek klasörünün içindeki dosya adı verilir.');
  }
  const parts = relative.split(/[\\/]+/);
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') throw new PathError('Yol klasörün dışına çıkamaz ("..", "." kabul edilmez).');
    if (part.includes(':')) throw new PathError('Dosya adında ":" olamaz.');
    if (RESERVED.test(part)) throw new PathError(`"${part}" ayrılmış bir aygıt adı.`);
    if (/[. ]$/.test(part)) throw new PathError('Dosya adı nokta ya da boşlukla bitemez.');
  }

  const base = path.resolve(root);
  const target = path.resolve(base, ...parts);
  if (target !== base && !target.startsWith(base + path.sep)) throw new PathError('Yol klasörün dışına çıkıyor.');

  // Var olan her parça gerçek bir klasör/dosya olmalı: bağlantı üzerinden klasörün dışına yazılıp okunamaz.
  let current = base;
  for (const part of [null, ...parts]) {
    if (part !== null) current = path.join(current, part);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(current);
    } catch {
      break; // henüz yok: yazılacak dosya ya da oluşturulacak klasör
    }
    if (stat.isSymbolicLink()) throw new PathError('Yol bir bağlantıdan (symlink/junction) geçiyor.');
  }
  return target;
}

/** Yetenek klasöründeki izinli dosyalardan birinin yolu; başka ad kabul edilmez. */
export function skillFilePath(dir: string, name: string): string {
  if (!isSkillFile(name)) {
    throw new PathError(`Yalnız şu dosyalar yazılabilir/okunabilir: ${SKILL_FILE_NAMES}.`);
  }
  return resolveInside(dir, name);
}

/** Klasör gerçekten `root`'un doğrudan çocuğu olan sıradan bir klasör mü (bağlantı değil). */
export function isPlainChildDir(root: string, dir: string): boolean {
  if (path.dirname(path.resolve(dir)) !== path.resolve(root)) return false;
  try {
    const stat = fs.lstatSync(dir);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}
