/**
 * v1 sır deposu aktarımı, SENTETİK fikstürle uçtan uca: gerçek DPAPI ile şifrelenmiş sahte ana anahtar,
 * Electron `safeStorage` v10 biçiminde (AES-256-GCM) şifrelenmiş sahte sağlayıcı anahtarları.
 * Gerçek v1 deposu (`%APPDATA%\Fuber AI`) okunmaz.
 */

import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dpapiProtect, dpapiUnprotect } from '../dpapi';
import { extractV1ProviderKeys, scanV1 } from '../v1-import';

const FAKE = {
  anthropic: 'sk-' + 'ant-FAKE-synthetic-0000-aaaa-bbbb-cccc',
  gemini: 'AIz' + 'aFAKE-synthetic-gemini-key-1234',
};

function v10(key: Buffer, plain: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from('v10'), nonce, body, cipher.getAuthTag()]).toString('base64');
}

function digest(dir: string): string {
  const hash = createHash('sha256');
  for (const name of fs.readdirSync(dir).sort()) {
    const stat = fs.statSync(path.join(dir, name));
    hash.update(`${name}:${stat.mtimeMs}:`);
    hash.update(fs.readFileSync(path.join(dir, name)));
  }
  return hash.digest('hex');
}

describe.skipIf(process.platform !== 'win32')('v1 sır deposu aktarımı (sentetik fikstür)', () => {
  let dir: string;
  let masterKey: Buffer;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-v1-fixture-'));
    masterKey = randomBytes(32);
    const protectedKey = await dpapiProtect(masterKey);
    const localState = {
      os_crypt: { audit_enabled: true, encrypted_key: Buffer.concat([Buffer.from('DPAPI'), protectedKey]).toString('base64') },
    };
    fs.writeFileSync(path.join(dir, 'Local State'), JSON.stringify(localState));
    fs.writeFileSync(
      path.join(dir, 'sirlar.json'),
      JSON.stringify({
        'hesap:cihaz': v10(masterKey, 'cihaz-sırrı-aktarılmamalı'),
        'api:anthropic': v10(masterKey, FAKE.anthropic),
        'api:gemini': v10(masterKey, FAKE.gemini),
        'api:fuber': v10(masterKey, 'tanınmayan-sağlayıcı'),
      }),
    );
  }, 30_000);

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('DPAPI gidiş-dönüş çalışır', async () => {
    const data = randomBytes(40);
    expect((await dpapiUnprotect(await dpapiProtect(data))).equals(data)).toBe(true);
  }, 30_000);

  it('tarama yalnız adları görür', () => {
    const scan = scanV1(dir);
    expect(scan.secretsReadable).toBe(true);
    expect(scan.localStatePresent).toBe(true);
    // Tanınmayan sağlayıcı kayıtları (ör. kaldırılmış bir geçit) aktarılmaz; yalnız adı görülür.
    expect(scan.providers.sort()).toEqual(['anthropic', 'gemini']);
    expect(scan.otherEntries.sort()).toEqual(['api:fuber', 'hesap:cihaz']);
  });

  it('yalnız sağlayıcı anahtarlarını çözer ve v1 dosyalarına dokunmaz', async () => {
    const before = digest(dir);
    const result = await extractV1ProviderKeys(dir, dpapiUnprotect);
    expect(result.failures).toEqual([]);
    expect(result.keys).toEqual({ ...FAKE });
    expect(digest(dir)).toBe(before);
  }, 30_000);

  it('asıl dosya bozuksa yedekten okur; bozuk tek değer ötekileri düşürmez', async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-v1-fixture-'));
    try {
      fs.copyFileSync(path.join(dir, 'Local State'), path.join(other, 'Local State'));
      fs.writeFileSync(path.join(other, 'sirlar.json'), '{ yarım yazılmış');
      const tampered = Buffer.from(v10(masterKey, 'xxxxxxxxxxxxxxxx'), 'base64');
      tampered[20] = (tampered[20] ?? 0) ^ 0xff;
      fs.writeFileSync(
        path.join(other, 'sirlar.json.bak'),
        JSON.stringify({ 'api:anthropic': v10(masterKey, FAKE.anthropic), 'api:openai': tampered.toString('base64') }),
      );
      expect(scanV1(other).usedBackup).toBe(true);
      const result = await extractV1ProviderKeys(other, dpapiUnprotect);
      expect(result.keys).toEqual({ anthropic: FAKE.anthropic });
      expect(result.failures.map((f) => f.provider)).toEqual(['openai']);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  }, 30_000);

  it('eski (öneksiz, doğrudan DPAPI) biçimi de çözer', async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-v1-fixture-'));
    try {
      const legacy = await dpapiProtect(Buffer.from(FAKE.gemini, 'utf8'));
      fs.writeFileSync(path.join(other, 'sirlar.json'), JSON.stringify({ 'api:gemini': legacy.toString('base64') }));
      const result = await extractV1ProviderKeys(other, dpapiUnprotect);
      expect(result.keys).toEqual({ gemini: FAKE.gemini });
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  }, 30_000);

  it('depo yoksa açık hata', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-v1-empty-'));
    try {
      expect(scanV1(empty)).toMatchObject({ secretsReadable: false, providers: [] });
      await expect(extractV1ProviderKeys(empty, dpapiUnprotect)).rejects.toThrow(/bulunamadı/);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
