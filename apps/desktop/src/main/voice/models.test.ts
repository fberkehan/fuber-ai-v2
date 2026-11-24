import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCAL_MODELS,
  LOCAL_MODEL_IDS,
  LOCAL_MODEL_PATHS,
  LocalModelSchema,
  type LocalModel,
  type LocalModelProgress,
  type ServiceDeps,
} from '@fuber/shared';
import {
  VerifyCache,
  findLocalCopy,
  isSafeRelativePath,
  placeFile,
  quickState,
  removeFile,
  verifyFile,
} from './model-files';
import { createModels } from './models';

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

let tmp: string;
let root: string;
let source: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-models-'));
  root = path.join(tmp, 'veri İşğü', 'models');
  source = path.join(tmp, 'kaynak');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(source, { recursive: true });
});

afterEach(async () => {
  // `fs.rmSync` Türkçe harfli yolda sessizce hiçbir şey silmiyor (Node 24.11, Windows).
  await fs.promises.rm(tmp, { recursive: true, force: true });
});

function writeSource(relative: string, content: string): void {
  const file = path.join(source, ...relative.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const spec = (relative: string, content: string) => ({
  url: `https://example.invalid/${relative}`,
  sha256: sha256(content),
  bytes: Buffer.byteLength(content),
  path: relative,
});

describe('varsayılan yerel model listesi', () => {
  it('boş değildir ve şemaya uyar', () => {
    expect(DEFAULT_LOCAL_MODELS.length).toBeGreaterThan(0);
    for (const model of DEFAULT_LOCAL_MODELS) expect(LocalModelSchema.safeParse(model).success, model.id).toBe(true);
  });

  it('hattın her rolü için dosya içerir ve yollar güvenlidir', () => {
    const roles = new Set(DEFAULT_LOCAL_MODELS.map((model) => model.role));
    for (const role of ['stt', 'tts', 'vad', 'wake']) expect(roles.has(role as LocalModel['role']), role).toBe(true);
    const paths = DEFAULT_LOCAL_MODELS.flatMap((model) => model.files.map((file) => file.path));
    expect(new Set(paths).size).toBe(paths.length);
    for (const file of paths) expect(isSafeRelativePath(file), file).toBe(true);
    expect(new Set(DEFAULT_LOCAL_MODELS.map((model) => model.id)).size).toBe(DEFAULT_LOCAL_MODELS.length);
  });

  it('ses hattının kullandığı sabit yollar listede vardır', () => {
    const byId = new Map(DEFAULT_LOCAL_MODELS.map((model) => [model.id, model.files.map((file) => file.path)]));
    const expectFile = (id: string, file: string) => expect(byId.get(id), `${id} → ${file}`).toContain(file);
    expectFile(LOCAL_MODEL_IDS.whisperModel, LOCAL_MODEL_PATHS.whisperModel);
    expectFile(LOCAL_MODEL_IDS.whisperServer, LOCAL_MODEL_PATHS.whisperServer);
    expectFile(LOCAL_MODEL_IDS.vad, LOCAL_MODEL_PATHS.vad);
    expectFile(LOCAL_MODEL_IDS.kws, LOCAL_MODEL_PATHS.kwsEncoder);
    expectFile(LOCAL_MODEL_IDS.kws, LOCAL_MODEL_PATHS.kwsBpeModel);
    expectFile(LOCAL_MODEL_IDS.piper, LOCAL_MODEL_PATHS.piperExe);
    expectFile(LOCAL_MODEL_IDS.piperVoice, LOCAL_MODEL_PATHS.piperVoice);
  });
});

describe('model dosyası denetimi', () => {
  it('klasör dışına çıkan yolu reddeder', () => {
    for (const bad of ['../x', 'a/../../x', '/etc/x', 'C:/x', 'a\\b', '', 'a//b', './a']) {
      expect(isSafeRelativePath(bad), bad).toBe(false);
    }
    expect(isSafeRelativePath('whisper/v1.9.2-cuda/whisper-server.exe')).toBe(true);
  });

  it('eksik, boyutu yanlış, özeti yanlış ve doğru dosyayı ayırır', async () => {
    const cache = new VerifyCache(root);
    const good = spec('vad/model.onnx', 'gerçek model');
    expect(quickState(root, good, cache)).toBe('missing');

    fs.mkdirSync(path.join(root, 'vad'));
    fs.writeFileSync(path.join(root, 'vad', 'model.onnx'), 'kısa');
    expect(quickState(root, good, cache)).toBe('mismatch');

    // Aynı boyut, farklı içerik: yalnız özet ayırt eder.
    const tampered = 'gerçek modeL';
    expect(Buffer.byteLength(tampered)).toBe(good.bytes);
    fs.writeFileSync(path.join(root, 'vad', 'model.onnx'), tampered);
    expect(quickState(root, good, cache)).toBe('unverified');
    expect(await verifyFile(root, good, cache)).toBe(false);
    expect(quickState(root, good, cache)).toBe('mismatch');

    fs.writeFileSync(path.join(root, 'vad', 'model.onnx'), 'gerçek model');
    // Değişiklik anı aynı milisaniyeye düşerse önbellek eski özeti geçerli sayar; sınamada açıkça ilerletilir.
    fs.utimesSync(path.join(root, 'vad', 'model.onnx'), new Date(), new Date(Date.now() + 5000));
    expect(await verifyFile(root, good, cache)).toBe(true);
    expect(quickState(root, good, cache)).toBe('ready');
  });

  it('doğrulama önbelleği diske yazılır ve dosya değişince geçersiz kalır', async () => {
    const file = spec('a/b.bin', 'içerik');
    fs.mkdirSync(path.join(root, 'a'));
    fs.writeFileSync(path.join(root, 'a', 'b.bin'), 'içerik');
    const cache = new VerifyCache(root);
    expect(await verifyFile(root, file, cache)).toBe(true);
    cache.save();

    expect(quickState(root, file, new VerifyCache(root))).toBe('ready');
    fs.writeFileSync(path.join(root, 'a', 'b.bin'), 'içeriK');
    fs.utimesSync(path.join(root, 'a', 'b.bin'), new Date(), new Date(Date.now() + 5000));
    expect(quickState(root, file, new VerifyCache(root))).toBe('unverified');
  });

  it('yerel kaynakta özeti tutan kopyayı bulur; tutmayanı kullanmaz', async () => {
    const cache = new VerifyCache(root);
    const wanted = spec('piper/1.0/espeak-ng-data/tr_dict', 'türkçe sözlük');
    // Düz klasör: yalnız yolun son parçaları eşleşir.
    writeSource('espeak-ng-data/tr_dict', 'türkçe sözlük');
    expect(await findLocalCopy(wanted, [{ dir: source }], cache)).toBe(path.join(source, 'espeak-ng-data', 'tr_dict'));

    const other = spec('whisper/model.bin', 'beklenen içerik');
    writeSource('model.bin', 'başka bir içerik');
    expect(await findLocalCopy(other, [{ dir: source }], cache)).toBeNull();
  });

  it('Türkçe harfli yoldaki dosyayı gerçekten siler; olmayan dosyada sessizce geçer', () => {
    const file = path.join(root, 'silinecek.part');
    fs.writeFileSync(file, 'x');
    removeFile(file);
    expect(fs.existsSync(file)).toBe(false);
    expect(() => removeFile(file)).not.toThrow();
  });

  it('hedefte eski bir dosya varsa üstüne yerleştirir', async () => {
    const cache = new VerifyCache(root);
    const file = spec('whisper/model.bin', 'yeni içerik');
    writeSource('model.bin', 'yeni içerik');
    fs.mkdirSync(path.join(root, 'whisper'), { recursive: true });
    fs.writeFileSync(path.join(root, 'whisper', 'model.bin'), 'eski ve bozuk');
    await placeFile(root, file, path.join(source, 'model.bin'), cache);
    expect(fs.readFileSync(path.join(root, 'whisper', 'model.bin'), 'utf8')).toBe('yeni içerik');
  });

  it('kaynağı hedefe yerleştirir ve yerleştirilen dosya doğrulanmış sayılır', async () => {
    const cache = new VerifyCache(root);
    const file = spec('whisper/model.bin', 'model içeriği');
    writeSource('model.bin', 'model içeriği');
    const how = await placeFile(root, file, path.join(source, 'model.bin'), cache);
    expect(['linked', 'copied']).toContain(how);
    expect(fs.readFileSync(path.join(root, 'whisper', 'model.bin'), 'utf8')).toBe('model içeriği');
    expect(quickState(root, file, cache)).toBe('ready');
  });
});

describe('model yöneticisi', () => {
  function setup(models: LocalModel[]) {
    const events: LocalModelProgress[] = [];
    const policy = { localModels: models };
    const log = { debug() {}, info() {}, warn() {}, error() {}, child: () => log };
    const deps = {
      paths: { models: root },
      policy: { get: () => policy, networkAllowed: () => false },
      bus: {
        emit: (type: string, payload: LocalModelProgress) => {
          if (type === 'setup.modelProgress') events.push(payload);
        },
        on: () => () => {},
      },
      log,
    } as unknown as ServiceDeps['models'];
    const api = createModels(deps, { sources: () => [{ dir: source }] });
    const settle = async () => {
      for (let i = 0; i < 200; i++) {
        const busy = api.status().some((item) => ['queued', 'downloading', 'verifying'].includes(item.status));
        if (!busy) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('model işi bitmedi');
    };
    return { api, events, policy, settle };
  }

  const model = (id: string, role: LocalModel['role'], files: LocalModel['files'], required = true): LocalModel => ({
    id,
    role,
    required,
    files,
  });

  it('eksik modeli "indirme gerekiyor" diye bildirir, yolunu vermez', () => {
    const { api } = setup([model('vad-1', 'vad', [spec('vad/v.onnx', 'vad')])]);
    const [status] = api.status();
    expect(status?.status).toBe('missing');
    expect(status?.error).toBeTruthy();
    expect(api.ready('vad')).toBe(false);
    expect(api.filePath('vad-1')).toBeNull();
  });

  it('yerel kaynaktan yerleştirir, ilerleme yayınlar ve hazır olur', async () => {
    writeSource('v.onnx', 'vad içeriği');
    writeSource('w.bin', 'whisper içeriği');
    const { api, events, settle } = setup([
      model('vad-1', 'vad', [spec('vad/v.onnx', 'vad içeriği')]),
      model('stt-1', 'stt', [spec('whisper/w.bin', 'whisper içeriği')]),
    ]);
    api.download();
    await settle();

    expect(api.status().map((item) => item.status)).toEqual(['ready', 'ready']);
    expect(api.ready('vad')).toBe(true);
    expect(api.ready('stt')).toBe(true);
    expect(api.filePath('vad-1', 'vad/v.onnx')).toBe(path.join(root, 'vad', 'v.onnx'));
    const seen = events.filter((event) => event.id === 'vad-1').map((event) => event.status);
    expect(seen).toContain('queued');
    expect(seen.at(-1)).toBe('ready');
  });

  it('özeti tutmayan yerel dosyayı kullanmaz; model eksik kalır', async () => {
    writeSource('v.onnx', 'bozuk içerik!');
    const { api, settle } = setup([model('vad-1', 'vad', [spec('vad/v.onnx', 'beklenen içerik')])]);
    api.download();
    await settle();
    expect(api.status()[0]?.status).toBe('missing');
    expect(fs.existsSync(path.join(root, 'vad', 'v.onnx'))).toBe(false);
  });

  it('listede olmayan dosyayı diskte dursa bile kullanmaz', async () => {
    writeSource('v.onnx', 'vad içeriği');
    const { api, policy, settle } = setup([model('vad-1', 'vad', [spec('vad/v.onnx', 'vad içeriği')])]);
    api.download();
    await settle();
    expect(api.filePath('vad-1')).not.toBeNull();

    // Yönetim modeli listeden çıkardı: dosya yerinde ama artık kullanılmaz.
    policy.localModels = [];
    expect(api.status()).toEqual([]);
    expect(api.filePath('vad-1')).toBeNull();
    expect(api.ready('vad')).toBe(true);
    expect(fs.existsSync(path.join(root, 'vad', 'v.onnx'))).toBe(true);
  });

  it('diskteki dosya bozulursa model yeniden eksik sayılır', async () => {
    writeSource('v.onnx', 'vad içeriği');
    const models = [model('vad-1', 'vad', [spec('vad/v.onnx', 'vad içeriği')])];
    const first = setup(models);
    first.api.download();
    await first.settle();
    expect(first.api.ready('vad')).toBe(true);

    fs.unlinkSync(path.join(root, 'vad', 'v.onnx'));
    fs.writeFileSync(path.join(root, 'vad', 'v.onnx'), 'vad içeriğI');
    fs.utimesSync(path.join(root, 'vad', 'v.onnx'), new Date(), new Date(Date.now() + 5000));
    const second = setup(models);
    second.api.status();
    await second.settle();
    expect(second.api.status()[0]?.status).toBe('missing');
    expect(second.api.filePath('vad-1')).toBeNull();
  });

  it('klasör dışına yazdıracak yolu olan modeli reddeder', async () => {
    const evil = model('evil', 'vad', [{ ...spec('x.bin', 'x'), path: '../../x.bin' }]);
    const { api, settle } = setup([evil]);
    api.download();
    await settle();
    expect(api.status()[0]?.status).toBe('failed');
    expect(api.filePath('evil')).toBeNull();
  });

  it('zorunlu olmayan model yalnız adıyla istenince hazırlanır', async () => {
    writeSource('k.onnx', 'kws');
    const { api, settle } = setup([model('kws-1', 'wake', [spec('kws/k.onnx', 'kws')], false)]);
    api.download();
    await settle();
    expect(api.status()[0]?.status).toBe('missing');
    api.download(['kws-1']);
    await settle();
    expect(api.status()[0]?.status).toBe('ready');
  });
});
