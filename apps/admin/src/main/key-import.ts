/**
 * Anahtarı kasaya dışarıdan koymanın iki yolu: v1 deposundan aktarma (kullanıcı tıklamasıyla) ve
 * teslim adımındaki `--seed-key-from-env=<SAĞLAYICI>` bayrağı. İkisi de anahtarı yalnız kasaya yazar;
 * sonuç satırları anahtar içermez.
 */

import fs from 'node:fs';
import { PROVIDER_LABELS, type ControlAdmin, type KeyTestOutcome } from '@fuber/control';
import {
  KEY_PROVIDERS,
  t,
  UserError,
  type KeyProvider,
  type V1ImportPreview,
  type V1ImportResult,
} from '@fuber/shared';
import { dpapiUnprotect } from './dpapi';
import { extractV1ProviderKeys, scanV1, type Unprotect } from './v1-import';

const joinLabels = (providers: KeyProvider[]) => providers.map((p) => PROVIDER_LABELS[p]).join(', ');

/** Hiçbir değer çözmeden v1 deposunda neyin bulunacağını söyler ("v1'den aktar" onay penceresi). */
export async function previewV1Import(admin: ControlAdmin, v1Dir: string | null): Promise<V1ImportPreview> {
  const empty = (message: string): V1ImportPreview => ({
    found: false,
    dir: v1Dir,
    providers: [],
    overwrites: [],
    usedBackup: false,
    message,
  });
  if (!v1Dir || !fs.existsSync(v1Dir)) return empty(t('admin.main.import.notFound'));
  const scan = scanV1(v1Dir);
  if (!scan.secretsReadable) return empty(t('admin.main.import.notFound'));
  const present = new Set((await admin.listKeys()).filter((k) => k.present).map((k) => k.provider));
  const overwrites = scan.providers.filter((p) => present.has(p));
  const parts: string[] = [];
  if (scan.providers.length === 0) parts.push(t('admin.main.import.none'));
  else parts.push(t('admin.main.import.found', { list: joinLabels(scan.providers) }));
  if (overwrites.length > 0) parts.push(t('admin.main.import.overwrite', { list: joinLabels(overwrites) }));
  return {
    found: true,
    dir: v1Dir,
    providers: scan.providers,
    overwrites,
    usedBackup: scan.usedBackup,
    message: parts.join(' '),
  };
}

export async function importKeysFromV1(
  admin: ControlAdmin,
  v1Dir: string | null,
  unprotect: Unprotect = dpapiUnprotect,
): Promise<V1ImportResult> {
  if (!v1Dir || !fs.existsSync(v1Dir)) throw new UserError(t('admin.main.import.notFound'));
  const scan = scanV1(v1Dir);
  if (!scan.secretsReadable) throw new UserError(t('admin.main.import.notFound'));
  if (scan.providers.length === 0) return { imported: [], message: t('admin.main.import.none'), tests: [] };

  const extracted = await extractV1ProviderKeys(v1Dir, unprotect);
  const imported: KeyProvider[] = [];
  const tests: KeyTestOutcome[] = [];
  const failures = extracted.failures.map((f) => `${PROVIDER_LABELS[f.provider]} (${f.reason})`);
  for (const provider of KEY_PROVIDERS) {
    const value = extracted.keys[provider];
    if (!value) continue;
    try {
      await admin.setKey(provider, value);
      imported.push(provider);
      tests.push(await admin.testKey(provider));
    } catch (error) {
      failures.push(`${PROVIDER_LABELS[provider]} (${(error as Error).message})`);
    }
  }
  const parts: string[] = [];
  if (imported.length > 0) {
    const list = tests.map((r) => `${PROVIDER_LABELS[r.provider]}: ${r.message}`).join('; ');
    parts.push(t('admin.main.import.done', { count: imported.length, list }));
  }
  if (failures.length > 0) parts.push(t('admin.main.import.failed', { list: failures.join(', ') }));
  return { imported, message: parts.join(' ') || t('admin.main.import.none'), tests };
}

export const SEED_ENV: Record<KeyProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  elevenlabs: 'ELEVENLABS_API_KEY',
  gemini: 'GEMINI_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  moonshot: 'MOONSHOT_API_KEY',
  custom: 'OPENAI_COMPAT_API_KEY',
};

/** `--seed-key-from-env=anthropic` → `anthropic`; bayrak yoksa `null`, tanınmayan sağlayıcıda `'invalid'`. */
export function parseSeedFlag(argv: readonly string[]): KeyProvider | 'invalid' | null {
  const arg = argv.find((a) => a.startsWith('--seed-key-from-env'));
  if (!arg) return null;
  const value = arg.split('=')[1]?.trim().toLowerCase() ?? '';
  return (KEY_PROVIDERS as readonly string[]).includes(value) ? (value as KeyProvider) : 'invalid';
}

/**
 * Ortam değişkenindeki anahtarı kasaya yazar ve sınar. Çıkış kodu: 0 yazıldı ve geçerli (ya da tanındı: kredi
 * durumunu ücretsiz uçla söylemeyen sağlayıcı) · 2 yazıldı ama sınama geçmedi · 1 yazılamadı
 * (3: aynı veri kökünde Yönetim açık, `main.ts`). Dönen satır anahtarı içermez.
 */
export async function seedKeyFromEnv(
  admin: ControlAdmin,
  provider: KeyProvider,
  env: NodeJS.ProcessEnv,
): Promise<{ exitCode: 0 | 1 | 2; line: string }> {
  const variable = SEED_ENV[provider];
  const value = env[variable]?.trim();
  if (!value) return { exitCode: 1, line: `seed-key ${provider}: ${variable} boş; kasaya bir şey yazılmadı.` };
  try {
    await admin.setKey(provider, value);
    const test = await admin.testKey(provider);
    return {
      exitCode: test.status === 'valid' || test.status === 'recognized' ? 0 : 2,
      line: `seed-key ${provider}: kasaya yazıldı; sınama=${test.status} (${test.httpStatus ?? '-'}, ${test.latencyMs} ms): ${test.message}`,
    };
  } catch (error) {
    return { exitCode: 1, line: `seed-key ${provider}: yazılamadı: ${(error as Error).message}` };
  }
}
