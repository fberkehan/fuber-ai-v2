// Removes this plugin from the Fuber AI v2 core. Usage (from the repository root):
//   node plugins/<plugin>/uninstall.mjs [--no-npm] [--force]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFlags, uninstall } from '../_lib/plugin-lib.mjs';

try {
  uninstall(path.dirname(fileURLToPath(import.meta.url)), parseFlags(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
