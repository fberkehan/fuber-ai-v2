/** Sınama yardımcıları (yalnız `*.test.ts` dosyaları kullanır). */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ControlLogger, SecretsDriver } from './types';

/** Gerçek şifreleme değil: yalnız düz metnin veritabanına aynen düşmediğini sınamaya yeter. */
export function fakeSecrets(available = true): SecretsDriver {
  return {
    isAvailable: () => available,
    encrypt(plain) {
      if (!available) throw new Error('şifreleme yok');
      return Buffer.concat([Buffer.from('FAKE1'), Buffer.from(plain, 'utf8').map((b) => b ^ 0x5a)]);
    },
    decrypt(cipher) {
      if (cipher.subarray(0, 5).toString() !== 'FAKE1') throw new Error('tanınmayan şifreli veri');
      return Buffer.from(cipher.subarray(5).map((b) => b ^ 0x5a)).toString('utf8');
    },
  };
}

export function tempDir(prefix = 'fuber2-control-'): { dir: string; cleanup(): void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) };
}

export function memoryLogger(): ControlLogger & { lines: string[] } {
  const lines: string[] = [];
  const push = (level: string) => (message: string, data?: Record<string, unknown>) =>
    lines.push(`${level} ${message} ${data ? JSON.stringify(data) : ''}`);
  return { lines, info: push('info'), warn: push('warn'), error: push('error') };
}

export const ADMIN_TOKEN = 'admin-token-for-tests-0123456789';
