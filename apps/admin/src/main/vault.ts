/**
 * Electron `safeStorage` ile kasa sürücüsü ve yönetici belirteci. `safeStorage` yalnız `app` hazır
 * olduktan sonra çağrılmalıdır.
 */

import { safeStorage } from 'electron';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ControlLogger, SecretsDriver } from '@fuber/control';

export function safeStorageSecrets(): SecretsDriver {
  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt(plain) {
      // Şifreleme yoksa düz metin yazılmaz: çağıran (kontrol servisi) bunu reddetmeye çevirir.
      if (!safeStorage.isEncryptionAvailable()) throw new Error('safeStorage kullanılamıyor');
      return safeStorage.encryptString(plain);
    },
    decrypt(cipher) {
      return safeStorage.decryptString(cipher);
    },
  };
}

const TOKEN_FILE = 'admin-token.bin';

/**
 * Yönetici belirteci ilk açılışta üretilir ve şifreli saklanır (HTTP yönetim uçları ileride uzaktan
 * yönetim için). Şifreleme yoksa yalnız bu çalışma için bellekte üretilir; diske düz yazılmaz.
 */
export function loadAdminToken(dataDir: string, log: ControlLogger): { token: string; persisted: boolean } {
  const file = path.join(dataDir, TOKEN_FILE);
  if (!safeStorage.isEncryptionAvailable()) {
    log.warn('admin: safeStorage yok; yönetici belirteci yalnız bu çalışma için');
    return { token: randomBytes(32).toString('base64url'), persisted: false };
  }
  if (fs.existsSync(file)) {
    try {
      const token = safeStorage.decryptString(fs.readFileSync(file));
      if (token.length >= 32) return { token, persisted: true };
    } catch (error) {
      log.warn('admin: yönetici belirteci çözülemedi; yenisi üretiliyor', { error: (error as Error).name });
    }
  }
  const token = randomBytes(32).toString('base64url');
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, safeStorage.encryptString(token));
  fs.renameSync(temp, file);
  return { token, persisted: true };
}
