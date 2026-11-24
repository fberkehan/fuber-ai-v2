// Atölye birim sınamalarının ortak yardımcıları. Uygulama demetine girmez (yalnız sınamalar içe aktarır).
import { fork } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { HostToMain } from '../../../skill-host/protocol';
import type { HostProcess } from './host';

const here = path.dirname(fileURLToPath(import.meta.url));
let bundle: Promise<string> | null = null;

/** Gerçek konak girişini (`src/skill-host/index.ts`) geçici bir klasöre demetler; sınama dosyası başına bir kez. */
export function hostBundle(): Promise<string> {
  bundle ??= (async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-skill-host-'));
    const outfile = path.join(dir, 'index.mjs');
    await build({
      entryPoints: [path.resolve(here, '..', '..', '..', 'skill-host', 'index.ts')],
      outfile,
      bundle: true,
      platform: 'node',
      target: 'node24',
      format: 'esm',
      logLevel: 'silent',
    });
    return outfile;
  })();
  return bundle;
}

/** Konağı düz Node çocuk süreci olarak başlatır (uygulamada `utilityProcess`). Ortam boştur. */
export function forkHost(file: string, spawned: HostProcess[] = []): HostProcess {
  const child = fork(file, [], { env: {}, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const host: HostProcess = {
    postMessage: (message) => {
      if (child.connected) child.send(message);
    },
    onMessage: (listener) => void child.on('message', (message) => listener(message as HostToMain)),
    onExit: (listener) => void child.once('exit', (code) => listener(code)),
    kill: () => void child.kill('SIGKILL'),
  };
  spawned.push(host);
  return host;
}

/** Geçici yetenek kökü; `write(id, files)` bir yetenek klasörü yazar. */
export function tempSkills() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-skills-'));
  return {
    root,
    write(id: string, files: Record<string, string>) {
      const dir = path.join(root, id);
      fs.mkdirSync(dir, { recursive: true });
      for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content, 'utf8');
      return dir;
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

/** Ağsız örnek yetenek: zar atar ve iki sayıyı toplar. */
export function diceSkill(id = 'zar'): Record<string, string> {
  return {
    'manifest.json': JSON.stringify({
      id,
      name: 'Zar',
      description: 'Zar atar ve sonucu söyler; ağ gerektirmez.',
      version: 1,
      permissions: [],
      tools: [
        {
          name: `skill_${id}_at`,
          description: 'Bir ya da birden çok zar atar. Kullanıcı "zar at" dediğinde kullan.',
          risk: 'read',
          inputSchema: {
            type: 'object',
            properties: { sides: { type: 'integer', minimum: 2, maximum: 100 }, count: { type: 'integer', minimum: 1, maximum: 10 } },
          },
        },
      ],
    }),
    'index.mjs': `export const tools = {
  async skill_${id}_at(input, ctx) {
    const sides = input.sides ?? 6;
    const count = input.count ?? 1;
    const rolls = [];
    for (let i = 0; i < count; i++) rolls.push(1 + Math.floor(Math.random() * sides));
    ctx.log('atılan', rolls);
    return { ok: true, text: 'Zar: ' + rolls.join(', ') + '.', data: { rolls, sides } };
  },
};
`,
    'selftest.mjs': `export default async function ({ tools, assert }) {
  const result = await tools.skill_${id}_at({ sides: 6, count: 3 });
  assert(result.ok, 'zar atılamadı');
  assert.equal(result.data.rolls.length, 3);
  assert(result.data.rolls.every((roll) => roll >= 1 && roll <= 6), 'zar 1–6 arasında olmalı');
}
`,
  };
}
