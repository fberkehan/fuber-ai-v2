// Claude Code CLI sınamalarının ortak yardımcıları. Uygulama demetine girmez (yalnız sınamalar içe aktarır).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CliCommand } from './process';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Sahte Claude Code CLI betiği (uçtan uca sınamayla ortak fikstür). */
export const FAKE_CLI_PATH = path.resolve(here, '..', '..', '..', '..', '..', '..', 'scripts', 'e2e', 'workshop', 'fake-claude.mjs');

/** Sahte CLI'yi bu sürecin Node'uyla çalıştıran komut. `env`: `FAKE_CLAUDE_AUTH=out`, `FAKE_CLAUDE_VERSION=…`. */
export function fakeCli(env: Record<string, string> = {}): CliCommand {
  return { command: process.execPath, prefixArgs: [FAKE_CLI_PATH], env };
}

/** Tek sahte ikili: alt kipi argümandan seçer (`scripts/e2e/lib/fake-claude.mjs`). Konuşan beynin kalıcı süreci de buradan. */
export const FAKE_CLI_ENTRY = path.resolve(here, '..', '..', '..', '..', '..', '..', 'scripts', 'e2e', 'lib', 'fake-claude.mjs');

/**
 * Konuşan beyin sınamalarının sahte CLI'si: `--version`, `auth status` ve kalıcı süreç kipi. `env`:
 * `FAKE_CLAUDE_AUTH=out`, `FAKE_CLAUDE_VERSION=…`, `SAHTE_CC_ACILIS=cokme`, `SAHTE_CC_HER_TUR=limit`, `SAHTE_CC_GECIKME=<ms>`.
 */
export function fakeBrainCli(env: Record<string, string> = {}): CliCommand {
  return { command: process.execPath, prefixArgs: [FAKE_CLI_ENTRY], env };
}

export function tempDir(label: string): { dir: string; cleanup(): Promise<void> } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `fuber2-cli-test-${label}-`));
  return { dir, cleanup: () => fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) };
}
