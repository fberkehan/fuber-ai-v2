// Eklenti API belgesi tek kaynaktan gelir (`api-doc.ts`): `docs/EKLENTI-API.md`, yapım istemi ve sahte CLI'nin kullandığı
// örnek dosyaları aynı metni taşır. Bu sınama üçünün eşitliğini ve örneklerin GERÇEKTEN çalıştığını denetler.
// Belgeyi ve örnek dosyasını yeniden yazmak için: FUBER2_WRITE_DOCS=1 npx vitest run <bu dosya>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { silentLog } from '../../core/brain/testkit';
import { EXAMPLE_PLUGINS, NEEDS_CORE_MARKER, PLUGIN_API, renderApiDocument } from './api-doc';
import { auditPage, prepareSource } from './audit';
import { createSkillHost, type HostProcess } from './host';
import { parseManifest } from './manifest';
import { BUILDER_INSTRUCTIONS, buildUpdateMessage, CLI_BUILDER_INSTRUCTIONS, EXAMPLE_SKILL } from './prompt';
import { forkHost, hostBundle } from './testkit';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..');
const docFile = path.join(repoRoot, 'docs', 'EKLENTI-API.md');
const examplesFile = path.join(repoRoot, 'scripts', 'e2e', 'workshop', 'plugin-examples.json');
const write = process.env.FUBER2_WRITE_DOCS === '1';

const examplesJson = () => `${JSON.stringify(Object.fromEntries(EXAMPLE_PLUGINS.map((example) => [example.id, example.files])), null, 2)}\n`;

let file: string;
const spawned: HostProcess[] = [];
beforeAll(async () => {
  file = await hostBundle();
}, 30_000);
afterAll(() => {
  for (const process of spawned) process.kill();
});

describe('Eklenti API belgesi', () => {
  it('docs/EKLENTI-API.md, api-doc.ts ile birebir aynıdır', () => {
    const expected = renderApiDocument();
    if (write) fs.writeFileSync(docFile, expected, 'utf8');
    expect(fs.readFileSync(docFile, 'utf8')).toBe(expected);
    expect(expected).toContain(PLUGIN_API);
  });

  it('sahte CLI örnek dosyası (plugin-examples.json) belgeyle aynı örnekleri taşır', () => {
    if (write) fs.writeFileSync(examplesFile, examplesJson(), 'utf8');
    expect(fs.readFileSync(examplesFile, 'utf8')).toBe(examplesJson());
  });

  it('yapım istemleri belgenin gövdesini ve bütün örnekleri içerir', () => {
    for (const prompt of [BUILDER_INSTRUCTIONS, CLI_BUILDER_INSTRUCTIONS]) {
      expect(prompt).toContain(PLUGIN_API);
      expect(prompt).toContain(NEEDS_CORE_MARKER);
      expect(prompt).toContain('yeni bir YETENEK yazıyorsun');
      for (const example of EXAMPLE_PLUGINS) expect(prompt).toContain(`"id": "${example.id}"`);
    }
    expect(CLI_BUILDER_INSTRUCTIONS).not.toMatch(/ws_|web_search|web_fetch/);
    expect(BUILDER_INSTRUCTIONS).toContain('ws_finish');
    const update = buildUpdateMessage('Euro kurunu da göster', { id: 'doviz', name: 'Döviz', version: 3 });
    expect(update).toContain('GÜNCELLEME TURU');
    expect(update).toContain('id: doviz');
    expect(update).toContain('3. sürüm');
  });

  it('belge, sözleşmenin bütün yüzeyini anlatır', () => {
    for (const part of [
      'ctx.fetch',
      'ctx.storage',
      'ctx.settings.get',
      'ctx.files.read',
      'ctx.tools.call',
      'ctx.speak',
      'ctx.notify',
      'ctx.remind',
      'ctx.showCard',
      '"cards"',
      '"pages"',
      '"jobs"',
      '"watches"',
      '"settings"',
      '"voice"',
      'fuber.call',
      'fuber.storage',
      'mockFetch',
      'mockTool',
      'setSetting',
      'net.hosts',
      'fs.roots',
      'uses.tools',
      'hidden',
      'Eklentiyle yapılamayanlar',
    ]) {
      expect(PLUGIN_API, part).toContain(part);
    }
  });
});

describe('belgedeki örnekler gerçek denetimden ve konaktan geçer', () => {
  const host = () =>
    createSkillHost({
      spawn: () => forkHost(file, spawned),
      log: silentLog,
      // Öz-sınamada köprüye yalnız girdi doğrulaması ulaşır (ağ, araçlar, dosyalar çalışma zamanında taklit edilir).
      bridge: async (call) => {
        if (call.method === 'validate') return null;
        throw new Error(`öz-sınamada beklenmeyen köprü isteği: ${call.method}`);
      },
      timeouts: { selftestMs: 8000 },
    });

  for (const example of [...EXAMPLE_PLUGINS, { id: EXAMPLE_SKILL.id, title: 'döviz kuru', files: { 'manifest.json': EXAMPLE_SKILL.manifest, 'index.mjs': EXAMPLE_SKILL.index, 'selftest.mjs': EXAMPLE_SKILL.selftest } }]) {
    it(`${example.id}: manifest geçerli, kaynak temiz, öz-sınama geçer`, async () => {
      const files = example.files as Record<string, string>;
      const parsed = parseManifest(files['manifest.json']!, example.id);
      expect(parsed.ok ? [] : parsed.issues).toEqual([]);
      if (!parsed.ok) return;
      const index = prepareSource(files['index.mjs']!, 'index.mjs');
      const selftest = prepareSource(files['selftest.mjs']!, 'selftest.mjs');
      expect(index.issues).toEqual([]);
      expect(selftest.issues).toEqual([]);
      for (const page of parsed.manifest.pages ?? []) {
        expect(files[page.file], page.file).toBeTypeOf('string');
        expect(auditPage(files[page.file]!, page.file)).toEqual([]);
      }

      const running = host();
      try {
        const outcome = await running.selftest({
          skillId: example.id,
          script: index.script,
          selftestScript: selftest.script,
          spec: {
            declared: parsed.manifest.tools.map((tool) => tool.name),
            mustCall: parsed.manifest.tools.filter((tool) => tool.risk === 'read').map((tool) => tool.name),
            settings: Object.fromEntries((parsed.manifest.settings ?? []).map((setting) => [setting.key, setting.default])),
          },
        });
        expect(outcome.error).toBeNull();
        expect(outcome.ok).toBe(true);
      } finally {
        running.stop();
      }
    }, 20_000);
  }
});
