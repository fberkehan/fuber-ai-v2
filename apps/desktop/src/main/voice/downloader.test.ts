import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LocalModel, LocalModelProgress, ServiceDeps } from '@fuber/shared';
import { DownloadError, downloadToFile, extractFromZip } from './downloader';
import { createModels } from './models';

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const tarExe = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');

interface Served {
  body: Buffer;
  /** Aralık isteklerini yok say (hep 200 ve tam gövde). */
  ignoreRange?: boolean;
  /** Bu kadar bayt gönderdikten sonra bağlantıyı kopar (bir kez). */
  breakAfter?: number;
  /** Durum kodu (hata sınaması). */
  status?: number;
  /** Parça başına bekleme: iptal sınamasında indirmeyi yavaşlatır. */
  slowMs?: number;
}

let tmp: string;
let server: http.Server;
let base: string;
let files: Map<string, Served>;
let requests: Array<{ url: string; range: string | null }>;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-indirme-'));
  files = new Map();
  requests = [];
  server = http.createServer((req, res) => {
    const url = req.url ?? '';
    const range = (req.headers.range as string | undefined) ?? null;
    requests.push({ url, range });
    const served = files.get(url);
    if (!served) {
      res.writeHead(404).end();
      return;
    }
    if (served.status) {
      res.writeHead(served.status).end();
      return;
    }
    let start = 0;
    const match = served.ignoreRange ? null : range?.match(/^bytes=(\d+)-$/);
    if (match) {
      start = Number(match[1]);
      if (start >= served.body.length) {
        res.writeHead(416, { 'content-range': `bytes */${served.body.length}` }).end();
        return;
      }
      res.writeHead(206, {
        'content-length': served.body.length - start,
        'content-range': `bytes ${start}-${served.body.length - 1}/${served.body.length}`,
      });
    } else {
      res.writeHead(200, { 'content-length': served.body.length });
    }
    const slice = served.body.subarray(start);
    if (served.breakAfter !== undefined) {
      const cut = served.breakAfter;
      served.breakAfter = undefined;
      res.write(slice.subarray(0, cut), () => req.socket.destroy());
      return;
    }
    if (served.slowMs) {
      let offset = 0;
      const pump = (): void => {
        if (res.destroyed) return;
        if (offset >= slice.length) return void res.end();
        res.write(slice.subarray(offset, offset + 16_384));
        offset += 16_384;
        setTimeout(pump, served.slowMs);
      };
      pump();
      return;
    }
    res.end(slice);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.promises.rm(tmp, { recursive: true, force: true });
});

const live = () => new AbortController().signal;

describe('indirme', () => {
  it('dosyayı indirir, ilerleme bildirir, yarım dosya bırakmaz', async () => {
    const body = randomBytes(300_000);
    files.set('/a.bin', { body });
    const target = path.join(tmp, 'alt klasör İş', 'a.bin');
    const seen: number[] = [];
    const result = await downloadToFile({ url: `${base}/a.bin`, target, signal: live(), onProgress: (received) => seen.push(received) });
    expect(result).toEqual({ bytes: 300_000, resumed: false, retries: 0 });
    expect(sha256(fs.readFileSync(target))).toBe(sha256(body));
    expect(seen.at(-1)).toBe(300_000);
    expect(fs.existsSync(`${target}.part`)).toBe(false);
  });

  it('yarım dosyanın üstüne kaldığı yerden sürer (Range)', async () => {
    const body = randomBytes(200_000);
    files.set('/b.bin', { body });
    const target = path.join(tmp, 'b.bin');
    fs.writeFileSync(`${target}.part`, body.subarray(0, 120_000));
    const result = await downloadToFile({ url: `${base}/b.bin`, target, signal: live() });
    expect(result.resumed).toBe(true);
    expect(result.bytes).toBe(200_000);
    expect(requests.at(-1)?.range).toBe('bytes=120000-');
    expect(sha256(fs.readFileSync(target))).toBe(sha256(body));
  });

  it('bağlantı koparsa yeniden dener ve kaldığı yerden tamamlar', async () => {
    const body = randomBytes(400_000);
    files.set('/c.bin', { body, breakAfter: 150_000 });
    const target = path.join(tmp, 'c.bin');
    const result = await downloadToFile({ url: `${base}/c.bin`, target, signal: live(), retryDelayMs: 5 });
    expect(result.retries).toBe(1);
    expect(result.resumed).toBe(true);
    expect(requests.map((request) => request.range)).toEqual([null, expect.stringMatching(/^bytes=\d+-$/)]);
    expect(sha256(fs.readFileSync(target))).toBe(sha256(body));
  });

  it('sunucu aralığı desteklemiyorsa baştan alır; yarım dosya sunucudakinden uzunsa atar', async () => {
    const body = randomBytes(50_000);
    files.set('/d.bin', { body, ignoreRange: true });
    const target = path.join(tmp, 'd.bin');
    fs.writeFileSync(`${target}.part`, Buffer.alloc(10_000, 7));
    expect((await downloadToFile({ url: `${base}/d.bin`, target, signal: live() })).resumed).toBe(false);
    expect(sha256(fs.readFileSync(target))).toBe(sha256(body));

    files.set('/e.bin', { body });
    const longer = path.join(tmp, 'e.bin');
    fs.writeFileSync(`${longer}.part`, Buffer.alloc(80_000, 7));
    await downloadToFile({ url: `${base}/e.bin`, target: longer, signal: live() });
    expect(sha256(fs.readFileSync(longer))).toBe(sha256(body));
  });

  it('404 yeniden denenmez; 503 denenir ve tükenince hata verir; yarım dosya yanlışlıkla hedef olmaz', async () => {
    const target = path.join(tmp, 'yok.bin');
    await expect(downloadToFile({ url: `${base}/yok.bin`, target, signal: live(), retryDelayMs: 5 })).rejects.toMatchObject({ code: 'http', status: 404 });
    expect(requests).toHaveLength(1);
    files.set('/mesgul.bin', { body: Buffer.alloc(1), status: 503 });
    await expect(downloadToFile({ url: `${base}/mesgul.bin`, target, signal: live(), retries: 2, retryDelayMs: 5 })).rejects.toMatchObject({ code: 'http', status: 503 });
    expect(requests.filter((request) => request.url === '/mesgul.bin')).toHaveLength(3);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('iptal: hemen durur, yarım dosya sonraki deneme için kalır ve oradan sürer', async () => {
    const body = randomBytes(600_000);
    files.set('/f.bin', { body, slowMs: 10 });
    const target = path.join(tmp, 'f.bin');
    const controller = new AbortController();
    const pending = downloadToFile({ url: `${base}/f.bin`, target, signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 120));
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(DownloadError);
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
    expect(fs.existsSync(target)).toBe(false);
    const partial = fs.statSync(`${target}.part`).size;
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(600_000);

    files.set('/f.bin', { body });
    const resumed = await downloadToFile({ url: `${base}/f.bin`, target, signal: live() });
    expect(resumed.resumed).toBe(true);
    expect(sha256(fs.readFileSync(target))).toBe(sha256(body));
  });
});

/** Sınama arşivi: Windows'un kendi tar'ı zip üretir (uygulamanın açarken kullandığıyla aynı araç). */
function makeZip(entries: Record<string, Buffer>): Buffer {
  const stage = fs.mkdtempSync(path.join(tmp, 'zip-'));
  for (const [name, content] of Object.entries(entries)) {
    const file = path.join(stage, ...name.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  const zip = path.join(tmp, `arsiv-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
  execFileSync(tarExe, ['-a', '-cf', zip, '-C', stage, ...new Set(Object.keys(entries).map((name) => name.split('/')[0] as string))], { windowsHide: true });
  return fs.readFileSync(zip);
}

describe.skipIf(process.platform !== 'win32' || !fs.existsSync(tarExe))('arşivden çıkarma ve model yöneticisi (ağ)', () => {
  it('zip arşivinden yalnız istenen dosyaları çıkarır (Türkçe harfli klasörde de)', async () => {
    const dir = path.join(tmp, 'İndirilenler ş');
    fs.mkdirSync(dir, { recursive: true });
    const archive = path.join(dir, 'a.zip');
    fs.writeFileSync(archive, makeZip({ 'piper/piper.exe': Buffer.from('çalıştırıcı'), 'piper/data/tr_dict': Buffer.from('sözlük'), 'piper/fazla.txt': Buffer.from('istenmeyen') }));
    const destDir = path.join(dir, 'x-a');
    await extractFromZip({ archive, entries: ['piper/piper.exe', 'piper/data/tr_dict'], destDir, signal: live() });
    expect(fs.readFileSync(path.join(destDir, 'piper', 'piper.exe'), 'utf8')).toBe('çalıştırıcı');
    expect(fs.readFileSync(path.join(destDir, 'piper', 'data', 'tr_dict'), 'utf8')).toBe('sözlük');
    expect(fs.existsSync(path.join(destDir, 'piper', 'fazla.txt'))).toBe(false);
    await expect(extractFromZip({ archive, entries: ['piper/yok.bin'], destDir, signal: live() })).rejects.toMatchObject({ code: 'extract' });
  });

  function setup(models: LocalModel[]) {
    const root = path.join(tmp, 'veri İşğü', 'models');
    fs.mkdirSync(root, { recursive: true });
    const events: LocalModelProgress[] = [];
    const log = { debug() {}, info() {}, warn() {}, error() {}, child: () => log };
    const deps = {
      paths: { models: root },
      policy: { get: () => ({ localModels: models }), networkAllowed: () => true },
      bus: {
        emit: (type: string, payload: LocalModelProgress) => {
          if (type === 'setup.modelProgress') events.push(payload);
        },
        on: () => () => {},
      },
      log,
    } as unknown as ServiceDeps['models'];
    const api = createModels(deps, { sources: () => [], retryDelayMs: 5 });
    const settle = async () => {
      for (let i = 0; i < 1000; i++) {
        if (!api.status().some((item) => ['queued', 'downloading', 'verifying'].includes(item.status))) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('model işi bitmedi');
    };
    return { api, events, root, settle };
  }

  const fileSpec = (url: string, relative: string, content: Buffer) => ({ url, sha256: sha256(content), bytes: content.length, path: relative });

  it('arşivsiz ve arşivli dosyaları ağdan indirir, doğrular, yerine koyar; arşiv bir kez iner ve temizlenir', async () => {
    const vad = randomBytes(40_000);
    const exe = randomBytes(90_000);
    const dict = randomBytes(12_000);
    files.set('/vad.onnx', { body: vad });
    files.set('/piper.zip', { body: makeZip({ 'piper/piper.exe': exe, 'piper/espeak-ng-data/tr_dict': dict, 'piper/kullanilmayan.dll': randomBytes(5000) }) });
    const { api, events, root, settle } = setup([
      { id: 'vad-1', role: 'vad', required: true, files: [fileSpec(`${base}/vad.onnx`, 'vad/vad.onnx', vad)] },
      {
        id: 'piper-1',
        role: 'tts',
        required: true,
        files: [
          fileSpec(`${base}/piper.zip#piper/piper.exe`, 'piper/1/piper.exe', exe),
          fileSpec(`${base}/piper.zip#piper/espeak-ng-data/tr_dict`, 'piper/1/espeak-ng-data/tr_dict', dict),
        ],
      },
    ]);
    api.download();
    await settle();
    expect(api.status().map((item) => [item.id, item.status, item.error])).toEqual([
      ['vad-1', 'ready', null],
      ['piper-1', 'ready', null],
    ]);
    expect(sha256(fs.readFileSync(path.join(root, 'piper', '1', 'piper.exe')))).toBe(sha256(exe));
    expect(sha256(fs.readFileSync(path.join(root, 'piper', '1', 'espeak-ng-data', 'tr_dict')))).toBe(sha256(dict));
    expect(api.filePath('vad-1')).toBe(path.join(root, 'vad', 'vad.onnx'));
    expect(requests.filter((request) => request.url === '/piper.zip')).toHaveLength(1);
    // Arşiv, çıkarma klasörü ve yarım dosya kalmaz; listede olmayan dosya çıkarılmaz.
    expect(fs.readdirSync(path.join(root, '.downloads'))).toEqual([]);
    expect(fs.existsSync(path.join(root, 'piper', '1', 'kullanilmayan.dll'))).toBe(false);
    const piper = events.filter((event) => event.id === 'piper-1');
    expect(piper.some((event) => event.status === 'downloading')).toBe(true);
    expect(piper.at(-1)).toMatchObject({ status: 'ready', receivedBytes: exe.length + dict.length });
  });

  it('özeti tutmayan indirme kullanılmaz ve temizlenir; model "başarısız" olur', async () => {
    const expected = randomBytes(30_000);
    files.set('/bozuk.onnx', { body: randomBytes(30_000) });
    files.set('/bozuk.zip', { body: makeZip({ 'a/b.bin': randomBytes(8000) }) });
    const { api, root, settle } = setup([
      { id: 'vad-1', role: 'vad', required: true, files: [fileSpec(`${base}/bozuk.onnx`, 'vad/vad.onnx', expected)] },
      { id: 'tts-1', role: 'tts', required: true, files: [fileSpec(`${base}/bozuk.zip#a/b.bin`, 'tts/b.bin', randomBytes(8000))] },
    ]);
    api.download();
    await settle();
    expect(api.status().map((item) => item.status)).toEqual(['failed', 'failed']);
    expect(api.status()[0]?.error).toBeTruthy();
    expect(api.filePath('vad-1')).toBeNull();
    expect(fs.readdirSync(path.join(root, 'vad'))).toEqual([]);
    expect(fs.existsSync(path.join(root, 'tts', 'b.bin'))).toBe(false);
    expect(fs.readdirSync(path.join(root, '.downloads'))).toEqual([]);
  });

  it('iptal edilen indirme yarım kalır; yeniden başlatılınca kaldığı yerden sürer ve hazır olur', async () => {
    const big = randomBytes(900_000);
    files.set('/buyuk.bin', { body: big, slowMs: 10 });
    const { api, events, root, settle } = setup([{ id: 'stt-1', role: 'stt', required: true, files: [fileSpec(`${base}/buyuk.bin`, 'whisper/buyuk.bin', big)] }]);
    api.download();
    for (let i = 0; i < 200 && !events.some((event) => event.status === 'downloading' && event.receivedBytes > 0); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    api.cancel();
    await settle();
    expect(api.status()[0]?.status).toBe('missing');
    const partial = path.join(root, 'whisper', 'buyuk.bin.download.part');
    const kept = fs.statSync(partial).size;
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(big.length);
    expect(api.filePath('stt-1')).toBeNull();

    files.set('/buyuk.bin', { body: big });
    api.download();
    await settle();
    expect(api.status()[0]?.status).toBe('ready');
    expect(requests.at(-1)?.range).toBe(`bytes=${kept}-`);
    expect(sha256(fs.readFileSync(path.join(root, 'whisper', 'buyuk.bin')))).toBe(sha256(big));
    expect(fs.existsSync(partial)).toBe(false);
  });

  it('ağ kapalıyken (Gizli kip) indirmez: model "indirme gerekiyor" durumunda kalır', async () => {
    const body = randomBytes(1000);
    files.set('/x.bin', { body });
    const models: LocalModel[] = [{ id: 'vad-1', role: 'vad', required: true, files: [fileSpec(`${base}/x.bin`, 'vad/x.bin', body)] }];
    const root = path.join(tmp, 'kapali', 'models');
    fs.mkdirSync(root, { recursive: true });
    const log = { debug() {}, info() {}, warn() {}, error() {}, child: () => log };
    const api = createModels(
      { paths: { models: root }, policy: { get: () => ({ localModels: models }), networkAllowed: () => false }, bus: { emit() {}, on: () => () => {} }, log } as unknown as ServiceDeps['models'],
      { sources: () => [] },
    );
    api.download();
    for (let i = 0; i < 100 && api.status()[0]?.status !== 'missing'; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(api.status()[0]).toMatchObject({ status: 'missing' });
    expect(requests).toHaveLength(0);
  });
});
