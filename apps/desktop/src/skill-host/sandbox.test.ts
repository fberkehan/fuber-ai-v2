// Kaçış denemeleri: yetenek bağlamı (`sandbox.ts` + `runtime-source.ts`) süreç içinde kurulur ve statik denetim
// (`audit.ts`) BİLEREK atlanır: denetim metne bakar, hesaplanan adlarla geçilebilir. Burada sınanan, bağlamın kendisidir.
import { describe, expect, it } from 'vitest';
import { createSkillContext } from './sandbox';

function context(mode: 'live' | 'selftest' = 'live') {
  const logs: string[] = [];
  const skill = createSkillContext({
    skillId: 'kacis',
    mode,
    bridge: async (method) => {
      if (method === 'storage.get') return { found: true, value: { a: 1 } };
      if (method === 'storage.keys') return { keys: ['k'] };
      if (method === 'fetch') throw new Error('ağ yok');
      return null;
    },
    log: (_level, text) => logs.push(text),
  });
  return { skill, logs };
}

/** Bir aracın gövdesini koşturur; araç sonucu `{ ok, text }` olarak döner. */
async function attempt(body: string): Promise<string> {
  const { skill } = context();
  try {
    await skill.load(`__exports.tools = { async skill_kacis_dene(input, ctx) { ${body} } };`);
    const result = await skill.call('skill_kacis_dene', {});
    return result.text;
  } finally {
    skill.dispose();
  }
}

/** Konak dünyasından bir değere ulaşıldıysa onun `Function`ı ile kod üretip `process`'e uzanmayı dener. */
const ESCAPE = `
  function tryEscape(value) {
    try {
      if (value === null || value === undefined) return 'yok';
      const F = value['constr' + 'uctor']['constr' + 'uctor'];
      const p = F('return typeof process === "object" ? process : null')();
      return p ? 'KAÇTI:' + p.pid : 'kod üretildi ama process yok';
    } catch (error) {
      return 'engellendi:' + String(error && error.message).slice(0, 80);
    }
  }
`;

describe('yetenek bağlamı: kaçış denemeleri', () => {
  it('küresel Error yeniden atanıp prepareStackTrace kurulamaz (yığın çerçevelerine ulaşılamaz)', async () => {
    const text = await attempt(`
      ${ESCAPE}
      const out = [];
      let frames = null;
      const fake = { prepareStackTrace(error, stack) { frames = stack; return 'kanca'; } };
      try { Error = fake; out.push('atama:geçti'); } catch (e) { out.push('atama:' + e.constructor.name); }
      try { Object.defineProperty(globalThis, 'Error', { value: fake }); out.push('tanım:geçti'); } catch (e) { out.push('tanım:' + e.constructor.name); }
      try { Error['prepare' + 'StackTrace'] = fake.prepareStackTrace; out.push('kanca:geçti'); } catch (e) { out.push('kanca:' + e.constructor.name); }
      try { Error.captureStackTrace = function () {}; out.push('capture:geçti'); } catch (e) { out.push('capture:' + e.constructor.name); }
      const probe = new TypeError('x');
      void probe.stack;
      out.push('çerçeve:' + (frames ? frames.length : 0));
      if (frames) {
        for (const frame of frames) {
          for (const pick of ['getThis', 'getFunction']) {
            try { const v = frame[pick](); if (v) out.push(pick + ':' + tryEscape(v)); } catch (e) {}
          }
          out.push('callsite:' + tryEscape(frame) + ' @' + frame.getFileName());
        }
      }
      return { ok: true, text: out.join(' | ') };
    `);
    expect(text).not.toContain('KAÇTI');
    expect(text).toContain('çerçeve:0');
    expect(text).not.toContain('atama:geçti');
    expect(text).not.toContain('tanım:geçti');
    expect(text).not.toContain('kanca:geçti');
    expect(text).not.toContain('capture:geçti');
  });

  it('yerleşikler yazılamaz ve yeniden tanımlanamaz', async () => {
    const text = await attempt(`
      const names = ['Error', 'TypeError', 'Promise', 'Reflect', 'JSON', 'Object', 'Function', 'Symbol', 'Array', 'Map', 'Set', 'Date', 'Math', 'String', 'Number', 'RegExp', 'Proxy'];
      const changed = [];
      for (const name of names) {
        const before = globalThis[name];
        try { globalThis[name] = { sahte: true }; } catch (e) {}
        try { Object.defineProperty(globalThis, name, { value: { sahte: true } }); } catch (e) {}
        try { delete globalThis[name]; } catch (e) {}
        if (globalThis[name] !== before) changed.push(name);
      }
      const statics = [];
      for (const [owner, key] of [[JSON, 'parse'], [JSON, 'stringify'], [Promise.prototype, 'then'], [Reflect, 'apply'], [Object, 'freeze'], [Promise, 'resolve'], [Array, 'isArray']]) {
        const before = owner[key];
        try { owner[key] = function () { return 'sahte'; }; } catch (e) {}
        if (owner[key] !== before) statics.push(key);
      }
      return { ok: true, text: 'değişen:' + changed.join(',') + ' statik:' + statics.join(',') };
    `);
    expect(text).toBe('değişen: statik:');
  });

  it('ctx, yanıt nesneleri, hata nesneleri ve Promise’ler bağlamın kendi dünyasındandır (constructor.constructor ile kaçış yok)', async () => {
    const text = await attempt(`
      ${ESCAPE}
      const out = [];
      out.push('ctx:' + tryEscape(ctx));
      out.push('ctx.fetch:' + tryEscape(ctx.fetch));
      out.push('storage:' + tryEscape(ctx.storage));
      out.push('storage.get:' + tryEscape(ctx.storage.get));
      const stored = await ctx.storage.get('k');
      out.push('veri:' + tryEscape(stored));
      out.push('promise:' + tryEscape(ctx.storage.keys()));
      try { await ctx.fetch('https://api.example.com/'); } catch (error) { out.push('hata:' + tryEscape(error)); }
      out.push('input:' + tryEscape(input));
      out.push('console:' + tryEscape(console.log));
      out.push('setTimeout:' + tryEscape(setTimeout));
      out.push('now:' + tryEscape(ctx.now()));
      return { ok: true, text: out.join(' | ') };
    `);
    expect(text).not.toContain('KAÇTI');
    // Bağlamda metinden kod üretimi kapalı: kurucu zinciri bağlamın Function'ına çıkar ve fırlatır.
    expect(text.split(' | ').every((part) => part.includes('engellendi:'))).toBe(true);
  });

  it('yığın taşmasıyla yakalanan hata bağlamın dünyasındandır', async () => {
    const text = await attempt(`
      ${ESCAPE}
      function deep() { return deep() + 1; }
      try { deep(); } catch (error) { return { ok: true, text: tryEscape(error) }; }
      return { ok: false, text: 'taşmadı' };
    `);
    expect(text).toMatch(/^engellendi:/);
  });
});

describe('yetenek bağlamı: kilit sıradan kodu bozmaz', () => {
  it('özel hata sınıfı, Promise.all, Map, JSON, Intl, Date ve setTimeout çalışır', async () => {
    const text = await attempt(`
      class KurHatasi extends Error {
        constructor(message) { super(message); this.name = 'KurHatasi'; this.kod = 42; }
      }
      const out = [];
      try { throw new KurHatasi('olmadı'); } catch (error) { out.push(error.name + ':' + error.message + ':' + error.kod + ':' + (error instanceof Error)); }
      const values = await Promise.all([1, Promise.resolve(2), new Promise((resolve) => setTimeout(() => resolve(3), 5))]);
      out.push(values.join(','));
      const map = new Map([['a', 1]]);
      out.push(JSON.stringify({ m: map.get('a'), d: new Date(0).toISOString().slice(0, 4) }));
      out.push(new Intl.NumberFormat('tr-TR').format(1234.5));
      const plain = {};
      plain.toString = () => 'özel';
      out.push(String(plain));
      return { ok: true, text: out.join(' | ') };
    `);
    expect(text).toBe('KurHatasi:olmadı:42:true | 1,2,3 | {"m":1,"d":"1970"} | 1.234,5 | özel');
  });
});
