import { createCipheriv, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createControlService, type ControlService, type FetchLike } from '@fuber/control';
import { importKeysFromV1, parseSeedFlag, previewV1Import, seedKeyFromEnv } from '../key-import';

const secrets = {
  encrypt: (s: string) => Buffer.from(Buffer.from(s, 'utf8').map((b) => b ^ 0x33)),
  decrypt: (b: Buffer) => Buffer.from(b.map((x) => x ^ 0x33)).toString('utf8'),
};
const okFetch: FetchLike = async (url) =>
  url.includes('subscription') ? new Response('{"tier":"free"}', { status: 200 }) : new Response('{}', { status: 200 });
const KEY = 'sk-' + 'ant-FAKE-seed-0000000000000000';

let service: ControlService;
beforeEach(() => {
  service = createControlService({ dbPath: ':memory:', secrets, adminToken: 'x'.repeat(32), fetch: okFetch });
});
afterEach(async () => service.close());

describe('--seed-key-from-env', () => {
  it('bayrak ayrıştırma', () => {
    expect(parseSeedFlag(['electron', '.', '--seed-key-from-env=ANTHROPIC'])).toBe('anthropic');
    expect(parseSeedFlag(['electron', '--seed-key-from-env=nope'])).toBe('invalid');
    expect(parseSeedFlag(['electron', '--hidden'])).toBeNull();
  });

  it('anahtarı kasaya yazar, sınar; satır anahtar içermez', async () => {
    const result = await seedKeyFromEnv(service.admin, 'anthropic', { ANTHROPIC_API_KEY: KEY });
    expect(result.exitCode).toBe(0);
    expect(result.line).toContain('sınama=valid');
    expect(result.line).not.toContain(KEY);
    expect(result.line).not.toContain(KEY.slice(-4));
    expect((await service.admin.listKeys()).find((k) => k.provider === 'anthropic')).toMatchObject({ present: true });
  });

  it('ortam değişkeni boşsa hiçbir şey yazmaz', async () => {
    const result = await seedKeyFromEnv(service.admin, 'gemini', {});
    expect(result.exitCode).toBe(1);
    expect((await service.admin.listKeys()).every((k) => !k.present)).toBe(true);
  });
});

describe('v1 aktarımı (düzenleyici)', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-v1-orch-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('çözülen anahtarları kasaya yazar ve sınar; sahte DPAPI ile', async () => {
    const master = randomBytes(32);
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', master, nonce);
    const body = Buffer.concat([cipher.update(KEY, 'utf8'), cipher.final()]);
    const value = Buffer.concat([Buffer.from('v10'), nonce, body, cipher.getAuthTag()]).toString('base64');
    const wrapped = Buffer.concat([Buffer.from('DPAPI'), Buffer.from('wrapped')]).toString('base64');
    fs.writeFileSync(path.join(dir, 'Local State'), JSON.stringify({ os_crypt: { encrypted_key: wrapped } }));
    fs.writeFileSync(path.join(dir, 'sirlar.json'), JSON.stringify({ 'api:anthropic': value }));

    const result = await importKeysFromV1(service.admin, dir, async (data) => {
      expect(data.toString()).toBe('wrapped');
      return master;
    });
    expect(result.imported).toEqual(['anthropic']);
    expect(result.message).not.toContain(KEY);
    expect(result.tests[0]).toMatchObject({ provider: 'anthropic', status: 'valid' });
  });

  it('ön izleme değer çözmeden adları ve üstüne yazılacakları söyler', async () => {
    fs.writeFileSync(path.join(dir, 'sirlar.json'), JSON.stringify({ 'api:anthropic': 'djEw', 'api:gemini': 'djEw', 'hesap:x': 'djEw' }));
    await service.admin.setKey('anthropic', KEY);
    // Değerler geçersiz bayt dizileridir ve Local State yoktur: ön izleme çözmeye kalkarsa bunu fark ederdik.
    const preview = await previewV1Import(service.admin, dir);
    expect(preview).toMatchObject({ found: true, providers: ['anthropic', 'gemini'], overwrites: ['anthropic'], usedBackup: false });
    expect(preview.message).toContain('Anthropic');
    expect(await previewV1Import(service.admin, path.join(dir, 'yok'))).toMatchObject({ found: false, providers: [] });
  });

  it('depo yoksa kullanıcıya gösterilebilir hata', async () => {
    await expect(importKeysFromV1(service.admin, path.join(dir, 'yok'))).rejects.toThrow(/bulunamadı/);
    await expect(importKeysFromV1(service.admin, null)).rejects.toThrow(/bulunamadı/);
  });
});
