// Installs this plugin into the Fuber AI v2 core. Usage (from the repository root):
//   node plugins/<plugin>/install.mjs [--no-npm] [--force] [--with-requires]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { install, parseFlags } from '../_lib/plugin-lib.mjs';

try {
  install(path.dirname(fileURLToPath(import.meta.url)), parseFlags(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
