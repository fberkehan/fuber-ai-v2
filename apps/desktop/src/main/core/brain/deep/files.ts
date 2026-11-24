/**
 * Derin işin dosya yardımcıları: çalışma klasörüne hapsedilmiş yol çözümü (API sağlayıcısının dosya araçları için)
 * ve görüntü dosyalarının okunması.
 */
import fs from 'node:fs';
import path from 'node:path';
import { t, type BrainImage } from '@fuber/shared';
import { DeepBrainError, type DeepImage } from './types';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

/** Dosya yolunu ya da bellekteki görüntüyü base64 görüntüye çevirir. Okunamıyorsa `DeepBrainError` fırlatır. */
export async function loadImage(image: DeepImage): Promise<BrainImage> {
  if (typeof image !== 'string') return image;
  const name = path.basename(image);
  const mediaType = IMAGE_TYPES[path.extname(image).toLowerCase()];
  if (!mediaType) throw new DeepBrainError('error', t('deep.error.imageType', { name }));
  let data: Buffer;
  try {
    const stat = await fs.promises.stat(image);
    if (stat.size > MAX_IMAGE_BYTES) throw new DeepBrainError('error', t('deep.error.imageSize', { name }));
    data = await fs.promises.readFile(image);
  } catch (error) {
    if (error instanceof DeepBrainError) throw error;
    throw new DeepBrainError('error', t('deep.error.image', { detail: error instanceof Error ? error.message : String(error) }));
  }
  return { mediaType, data: data.toString('base64') };
}

/**
 * `relative` yolunu `root` içinde çözer; dışarı çıkan, mutlak ya da bağlantıdan geçen yolu reddeder (`null`).
 * Yazılacak dosya henüz yoksa da çalışır.
 */
export function resolveInWorkDir(root: string, relative: string): string | null {
  if (!relative || relative.length > 240 || relative.includes('\0') || relative.includes(':')) return null;
  if (path.win32.isAbsolute(relative) || path.posix.isAbsolute(relative)) return null;
  const parts = relative.split(/[\\/]+/).filter((part) => part !== '');
  if (parts.length === 0 || parts.some((part) => part === '.' || part === '..' || /[. ]$/.test(part))) return null;
  const base = path.resolve(root);
  const target = path.resolve(base, ...parts);
  if (!target.startsWith(base + path.sep)) return null;
  let current = base;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return null;
    } catch {
      break;
    }
  }
  return target;
}

/** Klasördeki dosyaların göreli yolları (alt klasörler dahil, en çok `limit`). */
export function listWorkDir(root: string, limit = 200): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (entry.isSymbolicLink()) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), relative);
      else if (entry.isFile()) out.push(relative);
    }
  };
  walk(root, '');
  return out;
}
