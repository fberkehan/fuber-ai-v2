import { describe, expect, it, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { Logger, PolicyApi } from '@fuber/shared';
import { createLlmServer, type GpuProbe, type LlmFiles, type LlmServerDeps } from './llm-server';

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent } as unknown as Logger;
const policy = { get: () => ({ brain: { local: { contextTokens: 8192, modelId: 'm' } } }) } as unknown as PolicyApi;
const gpuFree: GpuProbe = { freeMiB: async () => 24_000, usesGpu: async () => true };
const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Sahte `llama-server` süreci: başlatılmaz; sağlık yanıtı `fetchFn` ile verilir, `kill` ile kapanır. */
class FakeProc extends EventEmitter {
  pid = 4242;
  exitCode: number | null = null;
  stderr = new EventEmitter();
  kill(): boolean {
    if (this.exitCode === null) {
      this.exitCode = 0;
      queueMicrotask(() => this.emit('exit', 0));
    }
    return true;
  }
}

const tmpDirs: string[] = [];
function makeFiles(): LlmFiles {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-test-'));
  tmpDirs.push(dir);
  const modelFile = path.join(dir, 'model.gguf');
  // Ekran belleği denetimi dosya boyutunu okur: küçük bir dosya yeter (freeMiB bol).
  fs.writeFileSync(modelFile, Buffer.alloc(1024));
  return { serverExe: path.join(dir, 'server.exe'), modelFile, modelId: 'm' };
}

function server(extra: Partial<LlmServerDeps> = {}) {
  const spawned: FakeProc[] = [];
  const srv = createLlmServer({
    log: silent,
    policy,
    resolve: () => makeFiles(),
    gpu: gpuFree,
    contextTokens: () => 8192,
    spawnFn: (() => {
      const proc = new FakeProc();
      spawned.push(proc);
      return proc as unknown as ChildProcess;
    }) as unknown as LlmServerDeps['spawnFn'],
    fetchFn: (async () => ({ ok: true, json: async () => ({ status: 'ok' }) })) as unknown as typeof fetch,
    ...extra,
  });
  return { srv, spawned };
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('yerel beyin sunucusu: boşta kapatma', () => {
  it('boştayken (meşgul değil) idleMs sonra ekran belleği bırakılır', async () => {
    const { srv, spawned } = server({ idleMs: 40 });
    await srv.ensure();
    expect(srv.status().state).toBe('ready');
    await delay(140);
    expect(srv.status().state).toBe('stopped');
    expect(spawned[0]!.exitCode).not.toBeNull();
    await srv.stop();
  });

  // Kök neden: tam kullanıcı konuşurken ekran belleğini boşaltıp hemen yeniden yüklemek, ses konağını işlemciye düşüren
  // aç-kapa savaşına yol açıyordu. Düzeltme: sesli tur sürerken boşta kapatma ertelenir.
  it('sesli tur sürerken boşta kapatma ERTELENİR; tur bitince kapatır', async () => {
    let busy = true;
    const { srv } = server({ idleMs: 40, voiceBusy: () => busy });
    await srv.ensure();
    expect(srv.status().state).toBe('ready');
    // Birkaç idle penceresi boyunca meşgul: hâlâ hazır (bellek bırakılmadı).
    await delay(160);
    expect(srv.status().state).toBe('ready');
    // Tur bitti: bir sonraki boşta penceresinde kapanır.
    busy = false;
    await delay(140);
    expect(srv.status().state).toBe('stopped');
    await srv.stop();
  });

  it('yakın zamanda kullanılırsa (touch) kapatma gecikir: histerezis', async () => {
    const { srv } = server({ idleMs: 80 });
    await srv.ensure();
    // Her 50 ms'de kullanım: 80 ms'lik boşta sayacı sürekli yeniden başlar.
    for (let i = 0; i < 4; i++) {
      await delay(50);
      srv.touch();
    }
    expect(srv.status().state).toBe('ready');
    // Kullanım durdu: boşta süresi dolunca kapanır.
    await delay(140);
    expect(srv.status().state).toBe('stopped');
    await srv.stop();
  });
});
