// Klasörden keşif: modüller, IPC işleyicileri ve sözlük dosyaları için dizin dosyalarını üretir.
// Kimse ortak bir liste dosyasını elle düzenlemez; yeni klasör/dosya eklemek yeter.
//
//   apps/desktop/src/main/modules/<id>/index.ts        → modules/registry.gen.ts   (builtinModules)
//   apps/desktop/src/main/ipc/handlers/<alan>.ts       → ipc/handlers/index.gen.ts (ipcHandlers)
//   packages/shared/src/i18n/tr/<alan>.ts              → i18n/tr/index.gen.ts      (tr)
//
// Adı alt çizgiyle başlayanlar (_example) ve *.test.ts / *.gen.ts dosyaları atlanır.
// Üretilen dosyalar .gitignore'dadır; typecheck, test, build, dev ve postinstall öncesi kendiliğinden yenilenir.
// Sayfalar (renderer/main/pages/<id>/index.tsx) Vite'ın import.meta.glob'u ile keşfedilir; üretim gerekmez.
// Elle: npm run gen
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HEADER = '// ÜRETİLMİŞ DOSYA: elle düzenlemeyin. Kaynak: scripts/gen-index.mjs (npm run gen)\n';

const isDiscoverable = (name) => !name.startsWith('_') && !name.startsWith('.');

/** İçerik değişmediyse dosyaya dokunmaz (izleme kipinde gereksiz yeniden derleme olmasın). */
function writeIfChanged(file, content) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return true;
}

function identifier(name) {
  return name.replace(/[^a-zA-Z0-9]+(.)?/g, (_, next) => (next ? next.toUpperCase() : ''));
}

function genModules() {
  const dir = path.join(root, 'apps', 'desktop', 'src', 'main', 'modules');
  const ids = fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && isDiscoverable(entry.name))
        .filter((entry) => fs.existsSync(path.join(dir, entry.name, 'index.ts')))
        .map((entry) => entry.name)
        .sort()
    : [];
  const lines = [
    HEADER,
    "import type { ModuleDef } from '@fuber/shared';",
    ...ids.map((id) => `import ${identifier(`module-${id}`)} from './${id}/index';`),
    '',
    '/** Yerleşik modüller: `modules/<id>/index.ts` dosyalarının varsayılan dışa aktarımları, ada göre sıralı. */',
    `export const builtinModules: ModuleDef[] = [${ids.map((id) => identifier(`module-${id}`)).join(', ')}];`,
    '',
  ];
  return [path.join(dir, 'registry.gen.ts'), lines.join('\n'), ids];
}

function genHandlers() {
  const dir = path.join(root, 'apps', 'desktop', 'src', 'main', 'ipc', 'handlers');
  const names = fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && isDiscoverable(entry.name))
        .map((entry) => entry.name)
        .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.gen.ts'))
        .map((name) => name.slice(0, -3))
        .sort()
    : [];
  const lines = [
    HEADER,
    "import type { RegisterHandlers } from '../router';",
    ...names.map((name) => `import { register as ${identifier(`register-${name}`)} } from './${name}';`),
    '',
    '/** IPC işleyici dosyaları: her `ipc/handlers/<alan>.ts` bir `register(ipc, services)` dışa aktarır. */',
    'export const ipcHandlers: Array<{ name: string; register: RegisterHandlers }> = [',
    ...names.map((name) => `  { name: '${name}', register: ${identifier(`register-${name}`)} },`),
    '];',
    '',
  ];
  return [path.join(dir, 'index.gen.ts'), lines.join('\n'), names];
}

function genDictionary() {
  const dir = path.join(root, 'packages', 'shared', 'src', 'i18n', 'tr');
  const names = fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && isDiscoverable(entry.name))
        .map((entry) => entry.name)
        .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.gen.ts'))
        .map((name) => name.slice(0, -3))
        .sort()
    : [];

  // Aynı anahtar iki dosyada tanımlanırsa sonuncusu sessizce kazanırdı; üretim anında yakalanır.
  const owners = new Map();
  const duplicates = [];
  for (const name of names) {
    const source = fs.readFileSync(path.join(dir, `${name}.ts`), 'utf8');
    for (const match of source.matchAll(/^\s*(['"])((?:(?!\1).)+)\1\s*:/gm)) {
      const key = match[2];
      if (owners.has(key)) duplicates.push(`"${key}": ${owners.get(key)}.ts ve ${name}.ts`);
      else owners.set(key, name);
    }
  }
  if (duplicates.length > 0) {
    throw new Error(`Sözlükte yinelenen anahtar:\n  ${duplicates.join('\n  ')}`);
  }

  const lines = [
    HEADER,
    ...names.map((name) => `import ${identifier(`tr-${name}`)} from './${name}';`),
    '',
    '/** Türkçe sözlük: `i18n/tr/<alan>.ts` dosyalarının birleşimi. */',
    'export const tr = {',
    ...names.map((name) => `  ...${identifier(`tr-${name}`)},`),
    '} as const;',
    '',
    'export type MessageKey = keyof typeof tr;',
    '',
  ];
  return [path.join(dir, 'index.gen.ts'), lines.join('\n'), names];
}

/** Bütün dizinleri üretir; değişen dosyaların yollarını döndürür. */
export function generateIndexes() {
  const changed = [];
  for (const [file, content] of [genModules(), genHandlers(), genDictionary()]) {
    if (writeIfChanged(file, content)) changed.push(path.relative(root, file));
  }
  return changed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const changed = generateIndexes();
    if (changed.length > 0) console.log(`Dizinler yenilendi: ${changed.join(', ')}`);
  } catch (error) {
    console.error(String(error?.message ?? error));
    process.exit(1);
  }
}
