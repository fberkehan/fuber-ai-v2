import { describe, expect, it } from 'vitest';
import { prepareSource } from './audit';
import { EXAMPLE_SKILL } from './prompt';

const wrap = (body: string) => `export const tools = {\n  async skill_x_run(input, ctx) {\n${body}\n    return { ok: true, text: 'tamam' };\n  },\n};\n`;

const rules = (source: string, file: 'index.mjs' | 'selftest.mjs' = 'index.mjs') => prepareSource(source, file).issues.map((issue) => issue.rule);

describe('statik denetim: yasak kalıplar', () => {
  const banned: Array<[string, string, string]> = [
    ['statik içe aktarım (node:)', `import fs from 'node:fs';\n${wrap('')}`, 'import'],
    ['statik içe aktarım (çıplak ad)', `import { exec } from 'child_process';\n${wrap('')}`, 'import'],
    ['yan etkili içe aktarım', `import 'electron';\n${wrap('')}`, 'import'],
    ['dinamik import, sabit metin', wrap(`    const fs = await import('node:fs');`), 'import'],
    ['dinamik import, değişken', wrap(`    const name = 'node:' + 'fs';\n    const m = await import(name);`), 'import'],
    ['import.meta', wrap(`    const here = import.meta.url;`), 'import'],
    ['require', wrap(`    const http = require('http');`), 'require'],
    ['process.env', wrap(`    const key = process.env.ANTHROPIC_API_KEY;`), 'process'],
    ['yayma içinde process', wrap(`    const args = [...process.argv];`), 'process'],
    ['globalThis.process', wrap(`    const p = globalThis.process;`), 'globalThis'],
    ['eval', wrap(`    eval('1 + 1');`), 'eval'],
    ['Function kurucusu', wrap(`    const f = new Function('return 1');`), 'Function'],
    ['Function çağrısı', wrap(`    const f = Function('return this')();`), 'Function'],
    ['kurucu zinciri', wrap(`    const f = ctx.log.constructor('return process')();`), 'constructor'],
    ['metinle kurucu erişimi', wrap(`    const f = ctx['constructor'];`), 'string'],
    ['__proto__', wrap(`    const p = input.__proto__;`), '__proto__'],
    ['doğrudan fetch', wrap(`    const r = await fetch('https://example.com');`), 'fetch'],
    ['XMLHttpRequest', wrap(`    const x = new XMLHttpRequest();`), 'XMLHttpRequest'],
    ['WebSocket', wrap(`    const s = new WebSocket('wss://example.com');`), 'WebSocket'],
    ['node: adı metinde', wrap(`    const name = 'node:child_process';`), 'node-module'],
    ['child_process adı', wrap(`    const name = 'child_process';`), 'string'],
    ['unicode kaçışlı tanımlayıcı', wrap(`    const p = pro\\u0063ess;`), 'escape'],
    ['Error.prepareStackTrace', wrap(`    Error.prepareStackTrace = () => 1;`), 'prepareStackTrace'],
    ['WebAssembly', wrap(`    const m = new WebAssembly.Module(input.bytes);`), 'WebAssembly'],
    ['arguments.callee', wrap(`    const me = arguments.callee;`), 'callee'],
  ];

  it.each(banned)('%s reddedilir', (_name, source, rule) => {
    const result = prepareSource(source, 'index.mjs');
    expect(result.ok).toBe(false);
    expect(result.script).toBe('');
    expect(result.issues.map((issue) => issue.rule)).toContain(rule);
  });

  it('sorunun satırını bildirir', () => {
    const result = prepareSource(`// başlık\n\nconst a = 1;\nconst fs = require('fs');\n${wrap('')}`, 'index.mjs');
    expect(result.issues.find((issue) => issue.rule === 'require')?.line).toBe(4);
  });

  it('desteklenmeyen export biçimlerini reddeder', () => {
    expect(rules(`const tools = {};\nexport { tools };\n`)).toContain('export');
    expect(rules(`export * from './x.mjs';\n`)).toContain('export');
    expect(rules(`const a = 1; export const tools = {};\n`)).toContain('export');
  });

  it('gereken dışa aktarımı ister', () => {
    expect(prepareSource(`const tools = {};\n`, 'index.mjs').ok).toBe(false);
    expect(prepareSource(`export const helper = 1;\n`, 'selftest.mjs').ok).toBe(false);
  });

  it('büyük ve ikili dosyayı reddeder', () => {
    expect(rules(`${wrap('')}// ${'x'.repeat(210_000)}`)).toEqual(['size']);
    expect(rules(`${wrap('')}\0`)).toEqual(['binary']);
  });
});

describe('statik denetim: masum kod', () => {
  it('yorum ve metin içindeki yasak sözcükleri kod saymaz', () => {
    const source = wrap(
      [
        `    // process.env ve require('fs') burada yalnız yorumda geçiyor`,
        `    /* import x from 'node:fs'; eval(1) */`,
        `    const note = "import edilen process: eval ve Function sözcükleri metinde serbest";`,
        "    const text = `fetch(${input.url}) çağrılmadı; globalThis yazısı da metin`;",
        `    const pattern = /process|require\\(/g;`,
        `    const ratio = input.a / input.b / 2;`,
        `    const reply = await ctx.fetch('https://api.example.com/v1', { query: { q: note } });`,
        `    ctx.log(text, pattern.test(note), ratio, reply.status);`,
      ].join('\n'),
    );
    const result = prepareSource(source, 'index.mjs');
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('sınıf kurucusuna ve nesne anahtarlarına izin verir', () => {
    const source = `class Cache {\n  constructor(size) {\n    this.size = size;\n  }\n}\nexport const tools = {\n  async skill_x_run() {\n    const cache = new Cache(3);\n    return { ok: true, text: String(cache.size) };\n  },\n};\n`;
    expect(prepareSource(source, 'index.mjs').ok).toBe(true);
  });

  it('dışa aktarımı konak gövdesine çevirir ve satır sayısını korur', () => {
    const source = `const unit = 1;\nexport function helper() {\n  return unit;\n}\nexport const tools = {\n  async skill_x_run() {\n    return { ok: true, text: String(helper()) };\n  },\n};\n`;
    const result = prepareSource(source, 'index.mjs');
    expect(result.ok).toBe(true);
    expect(result.exports).toEqual(['helper', 'tools']);
    expect(result.script).not.toMatch(/\bexport\b/);
    expect(result.script).toContain('__exports.helper = helper;');
    expect(result.script).toContain('__exports.tools = tools;');
    expect(result.script.split('\n').slice(0, 9)).toHaveLength(9);
    expect(result.script.split('\n')[4]).toBe('       const tools = {');
  });

  it('varsayılan dışa aktarımı çevirir', () => {
    const result = prepareSource(`export default async function ({ tools, assert }) {\n  assert(true);\n}\n`, 'selftest.mjs');
    expect(result.ok).toBe(true);
    expect(result.script.startsWith('__exports.default = async function')).toBe(true);
  });

  it('isteme gömülü örnek yetenek denetimden geçer', () => {
    expect(prepareSource(EXAMPLE_SKILL.index, 'index.mjs').issues).toEqual([]);
    expect(prepareSource(EXAMPLE_SKILL.selftest, 'selftest.mjs').issues).toEqual([]);
  });
});
