// Fuber AI v2 plugin installer (shared by every plugins/<id>/install.mjs and uninstall.mjs).
//
// A plugin is a folder with a `plugin.json` manifest and a `desktop/` tree. Installing copies the files listed in the
// manifest into the core tree (modules, pages and dictionaries are discovered by folder, see scripts/gen-index.mjs),
// registers the module ids in packages/shared/src/constants.ts (below the `// PLUGIN-MODULES` marker), adds the npm
// dependencies the plugin needs, and regenerates the discovery indexes. Uninstalling reverses every step using the
// record written to `.plugins/installed/<id>.json`.
//
// No network access happens except the optional `npm install` of the plugin's own dependencies (skip with --no-npm).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKER = '// PLUGIN-MODULES';
const RECORD_DIR = path.join('.plugins', 'installed');

export function findRepoRoot(start = path.dirname(fileURLToPath(import.meta.url))) {
  let dir = path.resolve(start);
  for (;;) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const json = JSON.parse(fs.readFileSync(pkg, 'utf8'));
        if (json.name === 'fuber-ai-v2') return dir;
      } catch {
        // keep walking up
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('Run this from inside a Fuber AI v2 checkout (package.json with name "fuber-ai-v2" not found).');
    dir = parent;
  }
}

export function readManifest(pluginDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'plugin.json'), 'utf8'));
  for (const key of ['id', 'version', 'files', 'moduleIds']) if (!(key in manifest)) throw new Error(`plugin.json: "${key}" is missing`);
  return manifest;
}

const recordFile = (root, id) => path.join(root, RECORD_DIR, `${id}.json`);
export const isInstalled = (root, id) => fs.existsSync(recordFile(root, id));
export function installedPlugins(root) {
  const dir = path.join(root, RECORD_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith('.json')).map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
}

function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

function eolOf(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/** Inserts `'<id>',` lines above the marker (idempotent). */
export function registerModuleIds(root, ids) {
  const file = path.join(root, 'packages', 'shared', 'src', 'constants.ts');
  let text = fs.readFileSync(file, 'utf8');
  if (!text.includes(MARKER)) throw new Error(`${MARKER} marker not found in constants.ts (is this a Fuber AI v2 core?)`);
  const eol = eolOf(text);
  for (const id of ids) {
    if (new RegExp(`^\\s*'${id}',\\s*$`, 'm').test(text)) continue;
    text = text.replace(new RegExp(`^(\\s*)${MARKER.replace(/[/]/g, '\\/')}`, 'm'), (_m, indent) => `${indent}'${id}',${eol}${indent}${MARKER}`);
  }
  fs.writeFileSync(file, text);
}

export function unregisterModuleIds(root, ids) {
  const file = path.join(root, 'packages', 'shared', 'src', 'constants.ts');
  let text = fs.readFileSync(file, 'utf8');
  for (const id of ids) text = text.replace(new RegExp(`^[ \\t]*'${id}',[ \\t]*\\r?\\n`, 'm'), '');
  fs.writeFileSync(file, text);
}

function run(root, command, args) {
  // npm is npm.cmd on Windows and needs a shell; node does not (and its path may contain spaces).
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: command === 'npm' && process.platform === 'win32' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed (exit ${result.status})`);
}

export function install(pluginDir, options = {}) {
  const root = options.root ?? findRepoRoot(pluginDir);
  const manifest = readManifest(pluginDir);
  const log = options.log ?? ((line) => console.log(line));
  if (isInstalled(root, manifest.id)) {
    log(`${manifest.id} is already installed. Run its uninstall.mjs first to reinstall.`);
    return { installed: false, reason: 'already-installed' };
  }
  for (const required of manifest.requires ?? []) {
    if (isInstalled(root, required)) continue;
    if (options.withRequires) {
      log(`Installing required plugin ${required} first...`);
      install(path.join(root, 'plugins', required), { ...options, root });
    } else {
      throw new Error(`${manifest.id} requires the "${required}" plugin. Install it first (node plugins/${required}/install.mjs) or pass --with-requires.`);
    }
  }
  const copies = [];
  for (const entry of manifest.files) {
    const from = path.join(pluginDir, entry.from);
    const to = path.join(root, entry.to);
    if (!fs.existsSync(from)) throw new Error(`plugin file missing: ${entry.from}`);
    const sources = fs.statSync(from).isDirectory() ? listFiles(from).map((file) => [file, path.join(to, path.relative(from, file))]) : [[from, to]];
    for (const [source, target] of sources) {
      if (fs.existsSync(target) && !options.force) throw new Error(`${path.relative(root, target)} already exists (use --force to overwrite).`);
      copies.push([source, target]);
    }
  }
  for (const [source, target] of copies) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  registerModuleIds(root, manifest.moduleIds);
  const deps = manifest.dependencies ?? {};
  const devDeps = manifest.devDependencies ?? {};
  if (!options.noNpm) {
    const specs = (record) => Object.entries(record).map(([name, version]) => `${name}@${version}`);
    if (Object.keys(deps).length) run(root, 'npm', ['install', '--save-exact', '-w', manifest.workspace ?? '@fuber/desktop', ...specs(deps)]);
    if (Object.keys(devDeps).length) run(root, 'npm', ['install', '--save-exact', '--save-dev', '-w', manifest.workspace ?? '@fuber/desktop', ...specs(devDeps)]);
  }
  run(root, process.execPath, [path.join('scripts', 'gen-index.mjs')]);
  const record = {
    id: manifest.id,
    version: manifest.version,
    installedAt: new Date().toISOString(),
    files: copies.map(([, target]) => path.relative(root, target).split(path.sep).join('/')),
    moduleIds: manifest.moduleIds,
    dependencies: deps,
    devDependencies: devDeps,
    workspace: manifest.workspace ?? '@fuber/desktop',
    npmInstalled: !options.noNpm,
  };
  fs.mkdirSync(path.join(root, RECORD_DIR), { recursive: true });
  fs.writeFileSync(recordFile(root, manifest.id), `${JSON.stringify(record, null, 2)}\n`);
  log(`Installed ${manifest.id} ${manifest.version}: ${copies.length} files, modules: ${manifest.moduleIds.join(', ')}.`);
  log('Next: npm run typecheck && npm test, then npm run dev:desktop.');
  return { installed: true, record };
}

export function uninstall(pluginDir, options = {}) {
  const root = options.root ?? findRepoRoot(pluginDir);
  const manifest = readManifest(pluginDir);
  const log = options.log ?? ((line) => console.log(line));
  if (!isInstalled(root, manifest.id)) {
    log(`${manifest.id} is not installed.`);
    return { removed: false };
  }
  const dependents = installedPlugins(root).filter((record) => record.id !== manifest.id && (readPluginRequires(root, record.id).includes(manifest.id)));
  if (dependents.length && !options.force) {
    throw new Error(`${dependents.map((record) => record.id).join(', ')} depends on ${manifest.id}. Uninstall it first (or use --force).`);
  }
  const record = JSON.parse(fs.readFileSync(recordFile(root, manifest.id), 'utf8'));
  for (const rel of record.files) fs.rmSync(path.join(root, rel), { force: true });
  // Remove directories the plugin created that are now empty.
  for (const rel of [...record.files].sort((a, b) => b.length - a.length)) {
    let dir = path.dirname(path.join(root, rel));
    while (dir.startsWith(root) && dir !== root && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
      dir = path.dirname(dir);
    }
  }
  unregisterModuleIds(root, record.moduleIds);
  if (record.npmInstalled && !options.noNpm) {
    const stillNeeded = new Set(installedPlugins(root).filter((other) => other.id !== manifest.id).flatMap((other) => [...Object.keys(other.dependencies ?? {}), ...Object.keys(other.devDependencies ?? {})]));
    const names = [...Object.keys(record.dependencies ?? {}), ...Object.keys(record.devDependencies ?? {})].filter((name) => !stillNeeded.has(name));
    if (names.length) run(root, 'npm', ['uninstall', '-w', record.workspace, ...names]);
  }
  fs.rmSync(recordFile(root, manifest.id), { force: true });
  run(root, process.execPath, [path.join('scripts', 'gen-index.mjs')]);
  log(`Removed ${manifest.id}.`);
  return { removed: true };
}

function readPluginRequires(root, id) {
  const file = path.join(root, 'plugins', id, 'plugin.json');
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')).requires ?? []) : [];
}

export function parseFlags(argv) {
  return {
    force: argv.includes('--force'),
    noNpm: argv.includes('--no-npm'),
    withRequires: argv.includes('--with-requires'),
  };
}
