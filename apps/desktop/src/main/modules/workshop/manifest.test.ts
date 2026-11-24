import { describe, expect, it } from 'vitest';
import { normalizeHost, parseManifest } from './manifest';
import { EXAMPLE_SKILL } from './prompt';

const base = () => ({
  id: 'hava',
  name: 'Hava durumu',
  description: 'Bir şehrin güncel hava durumunu söyler.',
  version: 1,
  permissions: ['net'],
  net: { hosts: ['api.open-meteo.com'] },
  tools: [
    {
      name: 'skill_hava_getir',
      description: 'Şehrin hava durumunu getirir. Kullanıcı "hava nasıl" dediğinde kullan.',
      risk: 'read',
      inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
    },
  ],
});

const issuesOf = (value: unknown, folder?: string) => {
  const result = parseManifest(JSON.stringify(value), folder);
  return result.ok ? [] : result.issues;
};

describe('manifest şeması', () => {
  it('geçerli manifesti kabul eder ve varsayılanları doldurur', () => {
    const result = parseManifest(JSON.stringify(base()), 'hava');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.createdBy).toBe('manual');
    expect(result.manifest.net?.hosts).toEqual(['api.open-meteo.com']);
    expect(result.manifest.tools[0]?.risk).toBe('read');
  });

  it('isteme gömülü örnek manifest geçerlidir', () => {
    const result = parseManifest(EXAMPLE_SKILL.manifest, EXAMPLE_SKILL.id);
    expect(result.ok ? [] : result.issues).toEqual([]);
  });

  it('bozuk JSON ve aşırı büyük dosyayı reddeder', () => {
    expect(parseManifest('{ "id": ').ok).toBe(false);
    expect(parseManifest(JSON.stringify({ ...base(), description: 'x'.repeat(40_000) })).ok).toBe(false);
  });

  it('kimlik biçimini ve klasör adıyla eşleşmeyi denetler', () => {
    expect(issuesOf({ ...base(), id: 'Hava-Durumu' }).join(' ')).toMatch(/id/);
    expect(issuesOf({ ...base(), id: '../kacak' }).join(' ')).toMatch(/id/);
    expect(issuesOf(base(), 'baska').join(' ')).toMatch(/klasör adıyla/);
  });

  it('yeteneklere açık olmayan izinleri reddeder', () => {
    for (const permission of ['shell', 'screen', 'mic']) {
      expect(issuesOf({ ...base(), permissions: ['net', permission] }).join(' ')).toContain(`"${permission}" eklentilere açık değil`);
    }
  });

  it('ağ izni ile alan adı listesini birbirine bağlar', () => {
    expect(issuesOf({ ...base(), permissions: [] }).join(' ')).toMatch(/"net" yok/);
    expect(issuesOf({ ...base(), net: undefined }).join(' ')).toMatch(/en az bir alan adı/);
  });

  it('alan adı girdilerini doğrular', () => {
    for (const bad of ['https://api.example.com', 'api.example.com/v1', '*.example.com', 'user@example.com', 'example.com:99999', '']) {
      expect(normalizeHost(bad)).toBeNull();
    }
    expect(normalizeHost('API.Example.com.')).toBe('api.example.com');
    expect(normalizeHost('xn--dviz-1ra.example.com')).toBe('xn--dviz-1ra.example.com');
    expect(normalizeHost('api.frankfurter.dev')).toBe('api.frankfurter.dev');
    expect(issuesOf({ ...base(), net: { hosts: ['https://api.example.com/x'] } }).join(' ')).toMatch(/net\.hosts/);
  });

  it('IP sabiti, port, localhost ve yerel ağ adı kabul edilmez (yalnız genel alan adı)', () => {
    const local = [
      // IP sabitleri ve URL ayrıştırıcısının IPv4 saydığı biçimler
      '127.0.0.1', '127.0.0.1:47820', '10.0.0.1', '8.8.8.8', '127.1', '2130706433', '0x7f000001', '0x7f.0.0.1',
      '0177.0.0.1', '017700000001', '[::1]', '::1', '[::ffff:127.0.0.1]', 'fe80::1',
      // port belirtimi
      'api.example.com:443', 'api.example.com:8443',
      // yerel adlar
      'localhost', 'LOCALHOST.', 'evil.localhost', 'yazici.local', 'nas.internal', 'router.lan', 'pc.home', 'srv.corp',
      'x.localdomain', 'x.home.arpa', '1.0.0.127.in-addr.arpa', 'intranet', 'sunucu',
    ];
    for (const bad of local) expect(normalizeHost(bad), bad).toBeNull();
    const issues = issuesOf({ ...base(), net: { hosts: ['127.0.0.1:47820'] } }).join(' ');
    expect(issues).toMatch(/net\.hosts: "127\.0\.0\.1:47820" geçersiz/);
    expect(issues).toMatch(/IP adresi/);
  });

  it('araç adında yetenek önekini ve benzersizliği ister', () => {
    const tool = base().tools[0]!;
    expect(issuesOf({ ...base(), tools: [{ ...tool, name: 'reminder_create' }] }).join(' ')).toMatch(/skill_hava_<fiil>/);
    expect(issuesOf({ ...base(), tools: [{ ...tool, name: 'skill_hava_Getir' }] }).join(' ')).toMatch(/skill_hava_<fiil>/);
    expect(issuesOf({ ...base(), tools: [tool, tool] }).join(' ')).toMatch(/yineleniyor/);
    expect(issuesOf({ ...base(), tools: [] }).length).toBeGreaterThan(0);
  });

  it('girdi şemasının nesne şeması olmasını ister', () => {
    const tool = base().tools[0]!;
    expect(issuesOf({ ...base(), tools: [{ ...tool, inputSchema: { type: 'string' } }] }).join(' ')).toMatch(/type "object"/);
  });

  it('risk düzeyini sınırlar', () => {
    const tool = base().tools[0]!;
    expect(issuesOf({ ...base(), tools: [{ ...tool, risk: 'admin' }] }).length).toBeGreaterThan(0);
  });
});
