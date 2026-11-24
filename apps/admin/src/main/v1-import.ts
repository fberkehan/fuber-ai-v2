/**
 * v1 ("Fuber AI", 0.x) sır deposundan sağlayıcı anahtarlarını SALT OKUNUR çıkarır.
 *
 * v1 biçimi (v1 kaynağı `src/main/ayarlar.ts` + `json-dosya.ts`):
 * - `%APPDATA%\Fuber AI\sirlar.json`: `{ "api:anthropic": base64(safeStorage.encryptString(değer)), … }`;
 *   asıl dosya okunamazsa `sirlar.json.bak` yedeği geçerlidir.
 * - Electron `safeStorage` (Windows): değer `"v10"` + 12 bayt nonce + şifreli metin + 16 bayt etiket,
 *   AES-256-GCM. Anahtar `Local State` → `os_crypt.encrypted_key` (base64, `"DPAPI"` önekli) → DPAPI ile çözülür.
 *
 * Bu modül Electron'a dokunmaz ve hiçbir şey yazmaz; v1 dosyalarını yalnız okur.
 */

import { createDecipheriv } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { KEY_PROVIDERS, type KeyProvider } from '@fuber/shared';

export const V1_SECRETS_FILE = 'sirlar.json';
export const V1_LOCAL_STATE_FILE = 'Local State';
const V10_PREFIX = Buffer.from('v10', 'latin1');
const DPAPI_PREFIX = Buffer.from('DPAPI', 'latin1');

export interface V1Scan {
  dir: string;
  /** Sır dosyası (ya da yedeği) okunabildi mi. */
  secretsReadable: boolean;
  usedBackup: boolean;
  localStatePresent: boolean;
  /** Depoda kaydı bulunan sağlayıcılar (yalnız adlar; değerler okunmaz). */
  providers: KeyProvider[];
  /** Tanınmayan ya da aktarılmayan kayıt adları (`hesap:cihaz` gibi). */
  otherEntries: string[];
}

export interface V1Extraction {
  keys: Partial<Record<KeyProvider, string>>;
  /** Çözülemeyen sağlayıcılar ve nedeni (değer içermez). */
  failures: Array<{ provider: KeyProvider; reason: string }>;
}

export type Unprotect = (data: Buffer) => Promise<Buffer>;

function readJsonObject(file: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readSecretsFile(dir: string): { entries: Record<string, unknown>; usedBackup: boolean } | null {
  const main = readJsonObject(path.join(dir, V1_SECRETS_FILE));
  if (main) return { entries: main, usedBackup: false };
  const backup = readJsonObject(path.join(dir, `${V1_SECRETS_FILE}.bak`));
  return backup ? { entries: backup, usedBackup: true } : null;
}

const providerOf = (name: string): KeyProvider | null => {
  const match = /^api:(.+)$/.exec(name);
  const candidate = match?.[1];
  return candidate && (KEY_PROVIDERS as readonly string[]).includes(candidate) ? (candidate as KeyProvider) : null;
};

/** Depoyu yalnız adlar düzeyinde tarar; hiçbir değer çözülmez. */
export function scanV1(dir: string): V1Scan {
  const secrets = readSecretsFile(dir);
  const providers: KeyProvider[] = [];
  const otherEntries: string[] = [];
  for (const [name, value] of Object.entries(secrets?.entries ?? {})) {
    const provider = providerOf(name);
    if (provider && typeof value === 'string' && value) providers.push(provider);
    else otherEntries.push(name);
  }
  return {
    dir,
    secretsReadable: !!secrets,
    usedBackup: secrets?.usedBackup ?? false,
    localStatePresent: fs.existsSync(path.join(dir, V1_LOCAL_STATE_FILE)),
    providers,
    otherEntries,
  };
}

async function masterKey(dir: string, unprotect: Unprotect): Promise<Buffer> {
  const state = readJsonObject(path.join(dir, V1_LOCAL_STATE_FILE));
  const encoded = (state?.os_crypt as { encrypted_key?: unknown } | undefined)?.encrypted_key;
  if (typeof encoded !== 'string' || !encoded) throw new Error('v1 "Local State" içinde şifreleme anahtarı yok.');
  const raw = Buffer.from(encoded, 'base64');
  if (!raw.subarray(0, DPAPI_PREFIX.length).equals(DPAPI_PREFIX)) {
    throw new Error('v1 şifreleme anahtarı beklenen "DPAPI" biçiminde değil.');
  }
  const key = await unprotect(raw.subarray(DPAPI_PREFIX.length));
  if (key.length !== 32) throw new Error('v1 şifreleme anahtarı beklenen uzunlukta değil.');
  return key;
}

/** `safeStorage.encryptString` çıktısını çözer (v10 = AES-256-GCM; öneksiz = eski DPAPI biçimi). */
export async function decryptSafeStorageValue(value: Buffer, key: Buffer | null, unprotect: Unprotect): Promise<string> {
  if (value.subarray(0, V10_PREFIX.length).equals(V10_PREFIX)) {
    if (!key) throw new Error('v10 değeri için anahtar yok.');
    const nonce = value.subarray(3, 15);
    const tag = value.subarray(value.length - 16);
    const cipherText = value.subarray(15, value.length - 16);
    if (nonce.length !== 12 || tag.length !== 16) throw new Error('v10 değeri kısa.');
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(cipherText), decipher.final()]).toString('utf8');
  }
  return (await unprotect(value)).toString('utf8');
}

/**
 * Sağlayıcı anahtarlarını çözer. Yalnız `api:<sağlayıcı>` kayıtları alınır; öteki sırlara (hesap,
 * e-posta parolası) dokunulmaz. Kullanıcının açık isteğiyle çağrılır.
 */
export async function extractV1ProviderKeys(dir: string, unprotect: Unprotect): Promise<V1Extraction> {
  const secrets = readSecretsFile(dir);
  if (!secrets) throw new Error('v1 sır dosyası bulunamadı ya da okunamadı.');
  const wanted = Object.entries(secrets.entries)
    .map(([name, value]) => ({ provider: providerOf(name), value }))
    .filter((e): e is { provider: KeyProvider; value: string } => !!e.provider && typeof e.value === 'string' && !!e.value);
  const result: V1Extraction = { keys: {}, failures: [] };
  if (wanted.length === 0) return result;

  let key: Buffer | null = null;
  let keyError: string | null = null;
  if (wanted.some((e) => Buffer.from(e.value, 'base64').subarray(0, 3).equals(V10_PREFIX))) {
    try {
      key = await masterKey(dir, unprotect);
    } catch (error) {
      keyError = (error as Error).message;
    }
  }
  for (const { provider, value } of wanted) {
    try {
      const raw = Buffer.from(value, 'base64');
      if (keyError && raw.subarray(0, 3).equals(V10_PREFIX)) throw new Error(keyError);
      const plain = (await decryptSafeStorageValue(raw, key, unprotect)).trim();
      if (!plain) throw new Error('boş değer');
      result.keys[provider] = plain;
    } catch (error) {
      result.failures.push({ provider, reason: (error as Error).message.replace(/\s+/g, ' ').slice(0, 200) });
    }
  }
  key?.fill(0);
  return result;
}
