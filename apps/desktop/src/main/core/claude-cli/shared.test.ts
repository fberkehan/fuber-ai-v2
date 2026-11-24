// Ortak CLI katmanı: tek sahte ikiliyle (alt kip argümandan) hem başsız koşu hem etkileşimli oturum; tek süreç izleme kümesi.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCliArgs, runClaudeCli, userMessageLine } from './headless';
import { isAlive, killTrackedCli, probeClaudeCli, trackedCliPids, type CliCommand } from './process';
import { buildSessionArgs, openSessionChannel, type SessionChannel } from './session-channel';
import { tempDir } from './testkit';

const here = path.dirname(fileURLToPath(import.meta.url));
const COMBINED_FAKE = path.resolve(here, '..', '..', '..', '..', '..', '..', 'scripts', 'e2e', 'lib', 'fake-claude.mjs');
const combined = (env: Record<string, string> = {}): CliCommand => ({ command: process.execPath, prefixArgs: [COMBINED_FAKE], env });

const cleanups: Array<() => Promise<void>> = [];
const channels: SessionChannel[] = [];
afterEach(async () => {
  for (const channel of channels.splice(0)) await channel.close(200);
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const work = (label: string) => {
  const temp = tempDir(label);
  cleanups.push(temp.cleanup);
  return temp.dir;
};
const waitUntil = async (probe: () => boolean, ms = 8000) => {
  const deadline = Date.now() + ms;
  while (!probe() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  return probe();
};

describe('core/claude-cli · ortak kullanım', () => {
  it('tek sahte ikili: yoklama, başsız koşu ve etkileşimli oturum aynı komutla çalışır', async () => {
    const dir = work('ortak');
    expect(await probeClaudeCli(combined())).toMatchObject({ installed: true, version: '2.1.325', loggedIn: true, supported: true });
    // Başsız fikstürün ayarı kısa alt komutlarda da geçerli kalır.
    expect(await probeClaudeCli(combined({ FAKE_CLAUDE_AUTH: 'out' }))).toMatchObject({ installed: true, loggedIn: false });

    // Başsız koşu (derin beyin yolu): `-p` → workshop fikstürü.
    const promptFile = path.join(dir, 'istem.txt');
    (await import('node:fs')).writeFileSync(promptFile, 'Kısa yanıt ver.');
    const outcome = await runClaudeCli({
      command: combined(),
      cwd: dir,
      args: buildCliArgs({ systemPromptFile: promptFile, model: 'claude-opus-5-5', tools: [], maxTurns: 2 }),
      stdin: userMessageLine([{ type: 'text', text: 'Merhaba' }]),
      timeoutMs: 15_000,
      onEvent: () => undefined,
    });
    expect(outcome.spawnError).toBeNull();
    expect(outcome.result?.ok).toBe(true);
    expect(outcome.result?.text).toContain('Sahte yanıt');

    // Etkileşimli oturum (Claude Code yönetimi yolu): `-p` yok → oturum fikstürü; denetim protokolü el sıkışır.
    const messages: Array<Record<string, unknown>> = [];
    const channel = openSessionChannel({
      command: combined(),
      cwd: dir,
      args: buildSessionArgs({ mode: 'default', allowBypass: false, folderSettings: false }),
      onMessage: (message) => messages.push(message),
      onPermission: () => undefined,
      onPermissionCancelled: () => undefined,
      onExit: () => undefined,
    });
    channels.push(channel);
    const info = await channel.initialize(10_000);
    expect(info.version ?? info.pid).toBeTruthy();
    expect(channel.sendUser({ id: 'u1', text: '#durum' })).toBe(true);
    expect(await waitUntil(() => messages.some((message) => message.type === 'result'))).toBe(true);
  }, 40_000);

  it('süreç izleme tek kümedir: oturum süreci de izlenir ve toplu öldürmede ölür', async () => {
    const dir = work('kume');
    let exited = false;
    const channel = openSessionChannel({
      command: combined(),
      cwd: dir,
      args: buildSessionArgs({ mode: 'default', allowBypass: false, folderSettings: false }),
      onMessage: () => undefined,
      onPermission: () => undefined,
      onPermissionCancelled: () => undefined,
      onExit: () => {
        exited = true;
      },
    });
    channels.push(channel);
    await channel.initialize(10_000);
    const pid = channel.pid!;
    expect(trackedCliPids()).toContain(pid);
    killTrackedCli();
    expect(await waitUntil(() => exited && !isAlive(pid))).toBe(true);
    expect(trackedCliPids()).not.toContain(pid);
  }, 30_000);
});
