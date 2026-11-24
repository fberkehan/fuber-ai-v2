/**
 * ONNX Runtime'ın C arayüzü, koffi ile (yerel derleme yok). Neden `onnxruntime-node` değil: Windows ikilisi CUDA'yı
 * tanımıyor (yalnız DirectML ve WebGPU derlenmiş; "cuda" adı ikilide yok) ve kendi `onnxruntime.dll`'ini getiriyor.
 * Burada DLL veri klasöründen yüklenir (`models/tts/ort-…`): CUDA için resmî GPU yapısı, DirectML için DirectML yapısı.
 * Aynı kod ikisini de sürer; hangisinin yükleneceğini ses konağının yapılandırması söyler.
 *
 * C arayüzü (`OrtApi`) bir işlev göstericileri tablosudur ve sıra sürümler arasında DEĞİŞMEZ (yalnız sona eklenir;
 * ONNX Runtime'ın ikili uyumluluk sözü). Aşağıdaki sıra numaraları `onnxruntime_c_api.h`'tan çıkarıldı ve 1.24.4,
 * 1.31.1, 1.32.0 başlıklarında aynı olduğu doğrulandı (16 Kasım 2026). Yanlış numara çökme demektir: bu yüzden
 * açılışta sürüm dizgisi okunur ve tablo yalnız o sürümün bildiği uzunlukta okunur.
 *
 * Süreç başına tek `onnxruntime.dll` yüklenebilir (iki farklı yapı aynı adla çakışır); cihaz değişecekse ses konağı
 * yeniden başlatılır. Çağrılar eşzamanlıdır: bir `run` bitene kadar olay döngüsü bekler (cümle başına 60–250 ms).
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import type { TtsDevice } from '@fuber/shared';

// koffi yerel eklentidir: demete girmez, çalışma anında node_modules'tan (paketli uygulamada app.asar.unpacked) yüklenir.
const koffi = createRequire(import.meta.url)('koffi') as typeof import('koffi');

type Pointer = unknown;

/** `OrtApi` tablosundaki sıra numaraları (başlıktaki bildirim sırası). */
const INDEX = {
  GetErrorMessage: 2,
  CreateEnv: 3,
  CreateSession: 7,
  Run: 9,
  CreateSessionOptions: 10,
  SetSessionExecutionMode: 13,
  DisableMemPattern: 17,
  SetSessionGraphOptimizationLevel: 23,
  SetIntraOpNumThreads: 24,
  SessionGetInputCount: 30,
  SessionGetOutputCount: 31,
  SessionGetInputName: 36,
  SessionGetOutputName: 37,
  CreateTensorAsOrtValue: 48,
  GetTensorMutableData: 51,
  GetDimensionsCount: 61,
  GetDimensions: 62,
  GetTensorShapeElementCount: 64,
  GetTensorTypeAndShape: 65,
  AllocatorFree: 76,
  GetAllocatorWithDefaultOptions: 78,
  ReleaseEnv: 92,
  ReleaseStatus: 93,
  ReleaseSession: 95,
  ReleaseValue: 96,
  ReleaseTensorTypeAndShapeInfo: 99,
  ReleaseSessionOptions: 100,
  SessionOptionsAppendExecutionProvider_CUDA_V2: 204,
  CreateCUDAProviderOptions: 205,
  UpdateCUDAProviderOptions: 206,
  ReleaseCUDAProviderOptions: 208,
} as const;
type ApiName = keyof typeof INDEX;
/** Tablodan okunan gösterici sayısı: kullanılan en büyük sıra + 1 (1.17 ve sonrası hepsini taşır). */
const TABLE_SIZE = 209;
/** Bu dosyanın kullandığı en yeni işlevin geldiği C arayüzü sürümü (`*_CUDA_V2` ailesi 1.11 ile geldi). */
const MIN_API_VERSION = 11;

/** Tensör eleman türleri (`ONNXTensorElementDataType`) ve koffi'deki C karşılıkları. */
const ELEMENT = { float32: 1, int64: 7 } as const;
const C_TYPE = { float32: 'float', int64: 'int64_t' } as const;
export type TensorType = keyof typeof ELEMENT;

export interface Tensor {
  type: TensorType;
  dims: number[];
  data: Float32Array | BigInt64Array;
}

export interface Session {
  readonly inputs: string[];
  readonly outputs: string[];
  /** Girdileri adlarıyla verir, bütün çıktıları `float32` olarak döndürür (bu motorlarda çıktıların hepsi öyledir). */
  run(feeds: Record<string, Tensor>): Record<string, { dims: number[]; data: Float32Array }>;
  release(): void;
}

export interface Ort {
  /** Çalışma zamanının kendi bildirdiği sürüm ("1.32.0"). */
  readonly version: string;
  readonly device: TtsDevice;
  createSession(modelFile: string): Session;
  release(): void;
}

// İşlev imzaları. Adlar süreç genelinde tek olmalı (koffi); `fuber_ort_` öneki çakışmayı önler.
function prototypes() {
  const p = (name: ApiName, signature: string) => koffi.proto(signature.replace('FN', `fuber_ort_${name}`));
  return {
    GetErrorMessage: p('GetErrorMessage', 'const char* FN(void*)'),
    CreateEnv: p('CreateEnv', 'void* FN(int, const char*, _Out_ void**)'),
    CreateSession: p('CreateSession', 'void* FN(void*, const char16_t*, void*, _Out_ void**)'),
    Run: p('Run', 'void* FN(void*, void*, const char**, void**, size_t, const char**, size_t, _Inout_ void**)'),
    CreateSessionOptions: p('CreateSessionOptions', 'void* FN(_Out_ void**)'),
    SetSessionExecutionMode: p('SetSessionExecutionMode', 'void* FN(void*, int)'),
    DisableMemPattern: p('DisableMemPattern', 'void* FN(void*)'),
    SetSessionGraphOptimizationLevel: p('SetSessionGraphOptimizationLevel', 'void* FN(void*, int)'),
    SetIntraOpNumThreads: p('SetIntraOpNumThreads', 'void* FN(void*, int)'),
    SessionGetInputCount: p('SessionGetInputCount', 'void* FN(void*, _Out_ size_t*)'),
    SessionGetOutputCount: p('SessionGetOutputCount', 'void* FN(void*, _Out_ size_t*)'),
    SessionGetInputName: p('SessionGetInputName', 'void* FN(void*, size_t, void*, _Out_ void**)'),
    SessionGetOutputName: p('SessionGetOutputName', 'void* FN(void*, size_t, void*, _Out_ void**)'),
    CreateTensorAsOrtValue: p('CreateTensorAsOrtValue', 'void* FN(void*, const int64_t*, size_t, int, _Out_ void**)'),
    GetTensorMutableData: p('GetTensorMutableData', 'void* FN(void*, _Out_ void**)'),
    GetDimensionsCount: p('GetDimensionsCount', 'void* FN(void*, _Out_ size_t*)'),
    GetDimensions: p('GetDimensions', 'void* FN(void*, _Out_ int64_t*, size_t)'),
    GetTensorShapeElementCount: p('GetTensorShapeElementCount', 'void* FN(void*, _Out_ size_t*)'),
    GetTensorTypeAndShape: p('GetTensorTypeAndShape', 'void* FN(void*, _Out_ void**)'),
    AllocatorFree: p('AllocatorFree', 'void* FN(void*, void*)'),
    GetAllocatorWithDefaultOptions: p('GetAllocatorWithDefaultOptions', 'void* FN(_Out_ void**)'),
    ReleaseEnv: p('ReleaseEnv', 'void FN(void*)'),
    ReleaseStatus: p('ReleaseStatus', 'void FN(void*)'),
    ReleaseSession: p('ReleaseSession', 'void FN(void*)'),
    ReleaseValue: p('ReleaseValue', 'void FN(void*)'),
    ReleaseTensorTypeAndShapeInfo: p('ReleaseTensorTypeAndShapeInfo', 'void FN(void*)'),
    ReleaseSessionOptions: p('ReleaseSessionOptions', 'void FN(void*)'),
    SessionOptionsAppendExecutionProvider_CUDA_V2: p('SessionOptionsAppendExecutionProvider_CUDA_V2', 'void* FN(void*, void*)'),
    CreateCUDAProviderOptions: p('CreateCUDAProviderOptions', 'void* FN(_Out_ void**)'),
    UpdateCUDAProviderOptions: p('UpdateCUDAProviderOptions', 'void* FN(void*, const char**, const char**, size_t)'),
    ReleaseCUDAProviderOptions: p('ReleaseCUDAProviderOptions', 'void FN(void*)'),
  } satisfies Record<ApiName, unknown>;
}

/** Ölçüm için: `FUBER2_TTS_CUDA_OPTIONS='{"cudnn_conv_algo_search":"HEURISTIC"}'` CUDA sağlayıcı ayarlarını ezer. */
function cudaOverrides(): Record<string, string> {
  try {
    const parsed = JSON.parse(process.env.FUBER2_TTS_CUDA_OPTIONS ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
  } catch {
    return {};
  }
}

export interface OrtOptions {
  /** `onnxruntime.dll` ve sağlayıcı kitaplıklarının klasörü. */
  runtimeDir: string;
  device: TtsDevice;
  /** Günlük etiketi. */
  logId?: string;
}

/**
 * Çalışma zamanını yükler. Fırlattığı hata iletisi düşüş zincirinde kullanıcıya gösterilen nedendir (kısa tutulur).
 * CUDA'nın gerçekten açılıp açılmadığı ilk oturum kurulurken anlaşılır (sağlayıcı kitaplığı o zaman yüklenir).
 */
export function loadOrt(options: OrtOptions): Ort {
  const { runtimeDir, device } = options;
  // Sağlayıcı kitaplıkları (cuBLAS, cuDNN) ve cuDNN'in sonradan yüklediği parçalar aynı klasörden bulunur.
  process.env.PATH = `${runtimeDir}${path.delimiter}${process.env.PATH ?? ''}`;
  const lib = koffi.load(path.join(runtimeDir, 'onnxruntime.dll'));
  const base = lib.func('void* OrtGetApiBase()')() as Pointer;
  if (!base) throw new Error('ONNX Runtime açılamadı (OrtGetApiBase)');
  const [getApi, getVersion] = koffi.decode(base, koffi.array('void*', 2)) as Pointer[];
  const version = koffi.call(getVersion, koffi.proto('const char* fuber_ort_GetVersionString()')) as string;
  const minor = Number(version.split('.')[1]);
  if (!Number.isInteger(minor) || minor < MIN_API_VERSION) throw new Error(`ONNX Runtime sürümü desteklenmiyor: ${version}`);
  // İstenen arayüz sürümü kitaplığınkini aşamaz; kullanılan işlevlerin hepsi `MIN_API_VERSION` ile vardır.
  const api = koffi.call(getApi, koffi.proto('void* fuber_ort_GetApi(uint32_t)'), minor) as Pointer;
  if (!api) throw new Error(`ONNX Runtime C arayüzü alınamadı (${version})`);
  const table = koffi.decode(api, koffi.array('void*', TABLE_SIZE)) as Pointer[];
  const proto = prototypes();

  const raw = (name: ApiName, ...args: unknown[]): unknown => koffi.call(table[INDEX[name]], proto[name], ...args);
  /** Durum döndüren çağrı: hata varsa iletisiyle fırlatır. */
  const call = (name: ApiName, ...args: unknown[]): void => {
    const status = raw(name, ...args);
    if (!status) return;
    const message = String(raw('GetErrorMessage', status));
    raw('ReleaseStatus', status);
    throw new Error(`${name}: ${message}`);
  };
  const out = (): Pointer[] => [null];

  const env = out();
  // Günlük düzeyi 3 (hata): uyarılar (işlemciye atanan düğümler) her oturumda yüzlerce satır basar.
  call('CreateEnv', 3, options.logId ?? 'fuber-tts', env);
  const allocator = out();
  call('GetAllocatorWithDefaultOptions', allocator);

  const appendDml = device === 'directml' ? lib.func('void* OrtSessionOptionsAppendExecutionProvider_DML(void*, int)') : null;

  function sessionOptions(): Pointer {
    const holder = out();
    call('CreateSessionOptions', holder);
    const so = holder[0];
    try {
      call('SetSessionGraphOptimizationLevel', so, 99);
      if (device === 'cuda') {
        const cuda = out();
        call('CreateCUDAProviderOptions', cuda);
        try {
          // `kSameAsRequested`: bellek havuzu ikiye katlanarak büyümez (ekran belleği v1 ve yerel beyinle paylaşılıyor).
          const tuned: Record<string, string> = { device_id: '0', arena_extend_strategy: 'kSameAsRequested', ...cudaOverrides() };
          const keys = Object.keys(tuned);
          const values = Object.values(tuned);
          call('UpdateCUDAProviderOptions', cuda[0], keys, values, keys.length);
          call('SessionOptionsAppendExecutionProvider_CUDA_V2', so, cuda[0]);
        } finally {
          raw('ReleaseCUDAProviderOptions', cuda[0]);
        }
      } else if (device === 'directml' && appendDml) {
        // DirectML bellek kalıbını ve koşut yürütmeyi desteklemez (ONNX Runtime belgesi).
        call('DisableMemPattern', so);
        call('SetSessionExecutionMode', so, 0);
        const status = appendDml(so, 0) as Pointer;
        if (status) {
          const message = String(raw('GetErrorMessage', status));
          raw('ReleaseStatus', status);
          throw new Error(`DirectML: ${message}`);
        }
      }
      return so;
    } catch (error) {
      raw('ReleaseSessionOptions', so);
      throw error;
    }
  }

  function names(session: Pointer, count: ApiName, name: ApiName): string[] {
    const n = [0];
    call(count, session, n);
    const list: string[] = [];
    for (let i = 0; i < Number(n[0]); i++) {
      const pointer = out();
      call(name, session, i, allocator[0], pointer);
      list.push(koffi.decode(pointer[0], 'char', -1) as string);
      call('AllocatorFree', allocator[0], pointer[0]);
    }
    return list;
  }

  /**
   * ONNX Runtime'ın kendi belleğinde bir tensör açar ve veriyi içine kopyalar (JS belleğine gösterici verilmez).
   * Kopya `koffi.encode` / `koffi.decode` ile yapılır, `koffi.view` ile DEĞİL: Electron (V8 bellek kafesi) dış belleğe
   * bakan ArrayBuffer'ı yasaklar ve süreç 134 koduyla kapanır (düz Node'da çalışır, paketli uygulamada çöker).
   */
  function toValue(tensor: Tensor): Pointer {
    const holder = out();
    const dims = BigInt64Array.from(tensor.dims.map((dim) => BigInt(dim)));
    call('CreateTensorAsOrtValue', allocator[0], dims, dims.length, ELEMENT[tensor.type], holder);
    const value = holder[0];
    try {
      if (tensor.data.length > 0) {
        const pointer = out();
        call('GetTensorMutableData', value, pointer);
        koffi.encode(pointer[0], C_TYPE[tensor.type], tensor.data, tensor.data.length);
      }
      return value;
    } catch (error) {
      raw('ReleaseValue', value);
      throw error;
    }
  }

  function fromValue(value: Pointer): { dims: number[]; data: Float32Array } {
    const info = out();
    call('GetTensorTypeAndShape', value, info);
    let dims: number[];
    let count: number;
    try {
      const rank = [0];
      call('GetDimensionsCount', info[0], rank);
      const shape = new BigInt64Array(Number(rank[0]));
      if (shape.length > 0) call('GetDimensions', info[0], shape, shape.length);
      const total = [0];
      call('GetTensorShapeElementCount', info[0], total);
      dims = Array.from(shape, Number);
      count = Number(total[0]);
    } finally {
      raw('ReleaseTensorTypeAndShapeInfo', info[0]);
    }
    if (count === 0) return { dims, data: new Float32Array(0) };
    const pointer = out();
    call('GetTensorMutableData', value, pointer);
    // Kopya: bellek ONNX Runtime'ındır ve değer bırakılınca geçersizleşir.
    const decoded = koffi.decode(pointer[0], 'float', count) as Float32Array | number[];
    return { dims, data: decoded instanceof Float32Array ? decoded : Float32Array.from(decoded) };
  }

  return {
    version,
    device,

    createSession(modelFile) {
      const so = sessionOptions();
      const holder = out();
      try {
        call('CreateSession', env[0], modelFile, so, holder);
      } finally {
        raw('ReleaseSessionOptions', so);
      }
      let handle: Pointer | null = holder[0];
      const inputs = names(handle, 'SessionGetInputCount', 'SessionGetInputName');
      const outputs = names(handle, 'SessionGetOutputCount', 'SessionGetOutputName');
      return {
        inputs,
        outputs,
        run(feeds) {
          if (!handle) throw new Error('oturum bırakılmış');
          const values: Pointer[] = [];
          const results: Pointer[] = outputs.map(() => null);
          try {
            for (const name of inputs) {
              const feed = feeds[name];
              if (!feed) throw new Error(`eksik girdi: ${name}`);
              values.push(toValue(feed));
            }
            call('Run', handle, null, inputs, values, values.length, outputs, outputs.length, results);
            const result: Record<string, { dims: number[]; data: Float32Array }> = {};
            outputs.forEach((name, index) => {
              result[name] = fromValue(results[index]);
            });
            return result;
          } finally {
            for (const value of values) raw('ReleaseValue', value);
            for (const value of results) if (value) raw('ReleaseValue', value);
          }
        },
        release() {
          if (handle) raw('ReleaseSession', handle);
          handle = null;
        },
      };
    },

    release() {
      raw('ReleaseEnv', env[0]);
    },
  };
}
