/**
 * Yerel modellerin tek listesi. `DEFAULT_POLICY.localModels` (masaüstünün gömülü varsayılanı ve kontrol
 * servisinin başlangıç politikası) bu sabiti okur; liste başka hiçbir yerde yinelenmez.
 * Dosyanın sahibi ses görevidir (T3).
 *
 * Her kayıt (`LocalModel`):
 * - `id`: benzersiz ve sürümlü kimlik (`whisper-large-v3-turbo-q5`). Kimlik değişirse model yeniden iner.
 * - `role`: hattaki görev: `stt` (Whisper) · `tts` (Piper) · `vad` (Silero) · `wake` (sherpa KWS) ·
 *   `speaker` (konuşmacı doğrulama; Demo 1'de kullanılmıyor) · `llm`.
 * - `files[]`: modelin dosyaları.
 *   - `url`: indirme adresi (https). Dosya bir arşivin içindeyse adres `<arşiv adresi>#<arşiv içi yol>`
 *     biçimindedir (`…/piper_windows_amd64.zip#piper/piper.exe`); `sha256` ve `bytes` arşivin değil,
 *     çıkarılmış dosyanındır. Aynı arşivi paylaşan dosyalar için arşiv bir kez indirilir.
 *   - `sha256`: küçük harf onaltılık özet; indirme ve yerel kopyalama sonrası doğrulanır. Özet tutmayan dosya kullanılmaz.
 *   - `bytes`: boyut (bayt); ilerleme ve boş disk denetimi için.
 *   - `path`: `Paths.models` (veri klasörü `models/`) altına göreli hedef, `/` ayraçlı.
 * - `required`: `true` ise inmeden ilgili özellik "hazırlanıyor" der ve kurulum sihirbazı bekler.
 *
 * Çalıştırılabilir dosyalar da (whisper-server, Piper) bu listededir: kurulum paketine girmezler,
 * veri klasöründe dururlar ve aynı özet denetiminden geçerler.
 *
 * Özetler 16 Kasım 2026'da doğrulandı: Whisper modeli Hugging Face LFS özetiyle, whisper.cpp arşivi GitHub
 * sürüm varlığının `digest` alanıyla (443110dd…b39c), Piper arşivi v1'in sabitlediği özetle (f3c58906…fcea),
 * KWS dosyaları k2-fsa'nın resmî `kws-models` sürüm arşivinden çıkarılanlarla (Hugging Face aynası bayt bayt aynı).
 *
 * LİSANS — ticari kullanım ya da yeniden dağıtım öncesi doğrulanmalı (bkz. THIRD-PARTY-NOTICES.md):
 * - Piper sesi `tr_TR-dfki-medium`: eğitim verisi CC BY-NC-SA 4.0 (ticari kullanım YOK); ticari sürümde ses değişmeli.
 * - Piper çalıştırıcısı espeak-ng (GPL-3.0) içerir; ayrı süreç olarak koşar, yine de dağıtım koşulları incelenmeli.
 * - KWS modeli (sherpa-onnx, GigaSpeech ile eğitilmiş): model kartı Apache-2.0 diyor, veri kümesinin koşulları ayrıca doğrulanmalı.
 * - Silero VAD: MIT. Whisper large-v3-turbo: MIT. whisper.cpp: MIT. cuBLAS/CUDA çalışma zamanı DLL'leri: NVIDIA
 *   yeniden dağıtım koşulları (whisper.cpp'nin resmî arşivinden, değiştirilmeden).
 * - Yerel beyin: llama.cpp (PrismML çatalı) MIT; Qwen3.5-4B Apache-2.0 (unsloth'un GGUF dönüşümü). CUDA 13 çalışma
 *   zamanı DLL'leri yine NVIDIA koşullarına bağlıdır. Özetler geliştirme önbelleğindeki, v1'in doğruladığı
 *   arşivlerden çıkarılmış dosyalardan alındı (K1, 16 Kasım 2026).
 * - YEREL EKRAN KARTI SESİ (demo.3):
 *   - Supertonic 3 (Supertone): model ağırlıkları OpenRAIL-M (kullanım kısıtları içeren "sorumlu yapay zekâ" lisansı;
 *     lisans metni modelle birlikte `tts/supertonic-3/LICENSE` olarak iner), çıkarım kodu MIT. Proje Eylül 2026'da
 *     arşivlendi (güncelleme gelmeyecek). TİCARİ SÜRÜMDEN ÖNCE lisans koşulları (kullanım kısıtlarının son kullanıcıya
 *     aktarılması dahil) hukukça gözden geçirilecek. Dosyalar Hugging Face deposunun sabit bir sürümünden
 *     (`724fb5ab…`, resmî Python paketinin sabitlediği sürüm) alınır; özetler LFS kayıtlarıyla aynıdır.
 *   - EMA Lightning (canberkkkkkk, Apache-2.0): özgün ağırlıklar PyTorch'tur; burada üçüncü bir kişinin ONNX dönüşümü
 *     (`ozcancelik/ema-lightning-onnx`, Apache-2.0, sabit sürüm `13c431db…`) kullanılır. Dönüşüm özgün modelle sayısal
 *     olarak karşılaştırıldı (`scripts/voice/ema-parity.py`). Lisans ve NOTICE dosyaları modelle birlikte iner.
 *   - ONNX Runtime (MIT): GPU yapısı resmî PyPI tekerleğinden (`onnxruntime-gpu` 1.32.0); DirectML yapısı
 *     `onnxruntime-directml` 1.24.4 (DirectML.dll: Microsoft yeniden dağıtım koşulları).
 *   - cuBLAS 13 ve cuDNN 9: NVIDIA'nın PyPI tekerleklerinden, değiştirilmeden; NVIDIA yeniden dağıtım koşullarına
 *     bağlıdır (kurulum paketine girmez, kullanıcının bilgisayarına NVIDIA'nın kendi dağıtımından iner).
 */

import type { LocalModel } from './policy';

type ModelFile = LocalModel['files'][number];

const hf = (repo: string, file: string) => `https://huggingface.co/${repo}/resolve/main/${file}`;

const WHISPER_CPP_ZIP =
  'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-cublas-12.4.0-bin-x64.zip';
const PIPER_ZIP = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip';
const KWS_REPO = 'mobilebytesensei/sherpa-onnx-kws-zipformer-gigaspeech-3.3M';

// llama.cpp sunucusu (PrismML çatalı, b10777, CUDA 13.3): v1'in kullandığı ve doğruladığı yapı. İki arşiv olarak
// yayımlanır (ikili + CUDA çalışma zamanı); dosyalar arşivlerin kökündedir.
const LLAMA_RELEASE = 'https://github.com/PrismML-Eng/llama.cpp/releases/download/prism-b10777-e3de715';
const LLAMA_BIN_ZIP = `${LLAMA_RELEASE}/llama-prism-b10777-e3de715-bin-win-cuda-13.3-x64.zip`;
const LLAMA_CUDART_ZIP = `${LLAMA_RELEASE}/cudart-llama-bin-win-cuda-13.3-x64.zip`;

// Yerel ekran kartı sesi: ONNX Runtime ve NVIDIA kitaplıkları PyPI tekerleklerinden (tekerlek bir zip arşividir).
const PYPI = 'https://files.pythonhosted.org/packages';
const ORT_GPU_WHEEL = `${PYPI}/ee/3b/6ce3c2548db5f8f3e639373640fa7f7fcdbcbce7b754971c0b293ab105b5/onnxruntime_gpu-1.32.0-cp312-cp312-win_amd64.whl`;
const ORT_DML_WHEEL = `${PYPI}/88/ea/33814eb0ec96775eda4c1d30b0d86e91d7d2cd0d84c66d3915aef0e06fa3/onnxruntime_directml-1.24.4-cp312-cp312-win_amd64.whl`;
const CUBLAS_WHEEL = `${PYPI}/12/39/e1b1b4adb8b171894d9a89035df0596d448cf73dc403802d24dbe30cc0be/nvidia_cublas-13.10.0.20-py3-none-win_amd64.whl`;
const CUDNN_WHEEL = `${PYPI}/48/9c/26e6bdd31c97c389aa565b49c916be0dec17dd61dad6cd33fee286d1b946/nvidia_cudnn_cu13-9.28.1.4-py3-none-win_amd64.whl`;
const SUPERTONIC_REPO = 'https://huggingface.co/Supertone/supertonic-3/resolve/724fb5abbf5502583fb520898d45929e62f02c0b';
const EMA_ONNX_REPO = 'https://huggingface.co/ozcancelik/ema-lightning-onnx/resolve/13c431db0356b2f7fafb1247cd823ec0d777c820';

const WHISPER_DIR = 'whisper/v1.9.2-cuda';
const PIPER_DIR = 'piper/2023.11.14-2';
const KWS_DIR = 'kws/gigaspeech-3.3M-2024-01-01';
const LLAMA_DIR = 'llm/llama-prism-b10777-cuda';
const TTS_ORT_CUDA_DIR = 'tts/ort-1.32.0-cuda13';
const TTS_ORT_DML_DIR = 'tts/ort-1.24.4-directml';
const TTS_SUPERTONIC_DIR = 'tts/supertonic-3';
const TTS_EMA_DIR = 'tts/ema-lightning';

const llamaBinary = (name: string, bytes: number, sha256: string, archive = LLAMA_BIN_ZIP): ModelFile => ({
  url: `${archive}#${name}`,
  sha256,
  bytes,
  path: `${LLAMA_DIR}/${name}`,
});

const whisperBinary = (name: string, bytes: number, sha256: string): ModelFile => ({
  url: `${WHISPER_CPP_ZIP}#Release/${name}`,
  sha256,
  bytes,
  path: `${WHISPER_DIR}/${name}`,
});

const piperBinary = (name: string, bytes: number, sha256: string): ModelFile => ({
  url: `${PIPER_ZIP}#piper/${name}`,
  sha256,
  bytes,
  path: `${PIPER_DIR}/${name}`,
});

const kwsFile = (name: string, bytes: number, sha256: string): ModelFile => ({
  url: hf(KWS_REPO, name),
  sha256,
  bytes,
  path: `${KWS_DIR}/${name}`,
});

/** Tekerlek (zip) içindeki dosya: `inner` arşiv içi klasör; dosya hedef `dir` altına yalnız adıyla yerleşir. */
const wheelFile = (wheel: string, inner: string, dir: string, name: string, bytes: number, sha256: string): ModelFile => ({
  url: `${wheel}#${inner}/${name}`,
  sha256,
  bytes,
  path: `${dir}/${name}`,
});

const repoFile = (repo: string, dir: string, name: string, bytes: number, sha256: string): ModelFile => ({
  url: `${repo}/${name}`,
  sha256,
  bytes,
  path: `${dir}/${name}`,
});

export const DEFAULT_LOCAL_MODELS: LocalModel[] = [
  {
    id: 'whisper-large-v3-turbo-q5',
    role: 'stt',
    required: true,
    files: [
      {
        url: hf('ggerganov/whisper.cpp', 'ggml-large-v3-turbo-q5_0.bin'),
        sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
        bytes: 574_041_195,
        path: 'whisper/ggml-large-v3-turbo-q5_0.bin',
      },
    ],
  },
  {
    // CUDA 12.4 arşivi şart: 11.8 arşivinde cuBLAS yok, sunucu sessizce işlemciye düşüyor (v1'de ölçüldü).
    id: 'whisper-cpp-1.9.2-cuda12.4',
    role: 'stt',
    required: true,
    files: [
      whisperBinary('whisper-server.exe', 728_576, 'd1bf781d1614ed159dd3b915e3e42e615457811e00df3d917eac6ab46821dde5'),
      whisperBinary('whisper.dll', 1_310_208, '566a333465a90e6b2c28881b843dab75056c067d2f5f4d8ecdeff85580fdf1b1'),
      whisperBinary('ggml.dll', 66_560, '877fe7dca850f903069da9d2c83f715db3d53a553574fdd9a689e01c0836bb94'),
      whisperBinary('ggml-base.dll', 650_752, '743a2b5b2b5d96e0f93e80ba3c47bf8e14ba49bf844e9d9a662c6103fa9dbbcb'),
      whisperBinary('ggml-cuda.dll', 536_766_976, '2a4b77087c9f32ccb4e64d4e0ad8fb86b547dce884b5e2ea2f784de8742a0811'),
      whisperBinary('cublas64_12.dll', 100_033_536, 'e40202fe4223c1cd2d2dce7beec59e1ed61c7801bd827309183be9b50e358f4c'),
      whisperBinary('cublasLt64_12.dll', 473_551_360, '2a896460bef60ed57ef32b0875812f355a6984e671d638bb632f5e8c1d7a831f'),
      whisperBinary('cudart64_12.dll', 553_984, 'd28e42265da7462162a54da6b7a99ea4fa2caf8139d862bb500db875d0b32dfc'),
      // İşlemci arka ucu açılışta işlemciye göre seçilir; hangisinin yükleneceği makineye bağlı olduğundan hepsi durur.
      whisperBinary('ggml-cpu-alderlake.dll', 806_400, 'e00f8199e96bc388d7eeb3e0f1512e1d7812cd4767c844ae614e68cc4cb3c4b7'),
      whisperBinary('ggml-cpu-cannonlake.dll', 850_944, 'dd56f42f3892ede493db27af45b8e01862a09581d720b24bf85db385858ff4b7'),
      whisperBinary('ggml-cpu-cascadelake.dll', 848_384, 'a91651050fdb42f75d38e14eeea0b3d69c4a5f3f13ec9588ee5b0c0cb2a5c749'),
      whisperBinary('ggml-cpu-haswell.dll', 807_424, '752b0215a07806fd3896618f94d1b6c5a6ea1abf145cc4f2f74d3cb36fd69971'),
      whisperBinary('ggml-cpu-icelake.dll', 848_384, '8683585ff3f03369e2286869b0b99d41a1ce8236049442fb41018caecf889c84'),
      whisperBinary('ggml-cpu-sandybridge.dll', 780_800, 'aa22eca3e07cf8526f1887bd7c9d0bb557e3218a9c6803bf08874b929cf6adff'),
      whisperBinary('ggml-cpu-skylakex.dll', 850_944, '227546c352acfec7da2f374eaedccbd5ed6ebb0812e056cf0f1e57aadaf13127'),
      whisperBinary('ggml-cpu-sse42.dll', 768_000, 'be1989f93809ca257ed5b55d389d096d441286c9ab7335a8ac50a0a59e3a95fe'),
      whisperBinary('ggml-cpu-x64.dll', 769_024, '51f8cdda3d47562bbe5562d30137179f95cf2cf1590fd5b1d7bb4e7a9060a3d7'),
    ],
  },
  {
    id: 'silero-vad-v5',
    role: 'vad',
    required: true,
    files: [
      {
        url: hf('csukuangfj/vad', 'silero_vad_v5.onnx'),
        sha256: '6b99cbfd39246b6706f98ec13c7c50c6b299181f2474fa05cbc8046acc274396',
        bytes: 2_313_101,
        path: 'vad/silero_vad_v5.onnx',
      },
    ],
  },
  {
    // Kurulumda diğerleriyle birlikte hazırlansın diye zorunlu işaretli; ses hattı bu model olmadan da açılır
    // (uyandırmanın Whisper yolu çalışır, KURGU §5.2 madde 8).
    id: 'kws-zipformer-gigaspeech-3.3m-2024-01-01',
    role: 'wake',
    required: true,
    files: [
      kwsFile(
        'encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
        4_807_159,
        '1e721676515bcd42a186979733981213c66c80db680e1cc582dfedf3be76e678',
      ),
      kwsFile(
        'decoder-epoch-12-avg-2-chunk-16-left-64.onnx',
        1_063_189,
        'f61ebd3eed3773a44d088d53dfae92dbb6aec4839f4dcaee2d402414741663a3',
      ),
      kwsFile(
        'joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
        163_380,
        'eae9da0c7e1e6c6a3f4cc42d167899c388f6c6701b94cb96320e4f55df79624c',
      ),
      kwsFile('tokens.txt', 5_006, 'fd2ded4050a55d2b1578870ba8697d02371980217806b7558bd0a5cc60f3ba53'),
      kwsFile('bpe.model', 244_837, 'c8a2a0129c4ab8e463164c142f82d25649661b122c8cd0b7aab5c9e80b90ad24'),
    ],
  },
  {
    // sherpa-onnx 2.x espeak-ng'yi çıkardı; Piper sesleri espeak fonemleri ister. Bu yüzden Piper'ın kendi
    // çalıştırıcısı ayrı süreç olarak kullanılır. espeak verisinden yalnız Türkçe için gereken altı dosya alınır.
    id: 'piper-2023.11.14-2-win64',
    role: 'tts',
    required: true,
    files: [
      piperBinary('piper.exe', 509_952, '96f3da3811151580073e40bb4dd20eb0fb8115f5f5f76e2fb54282b3edfa5c1f'),
      piperBinary('piper_phonemize.dll', 407_040, '4b5f344b2f31204a8a94a0bf485f93e4971671e81188a0d67f326e113bfb0b2e'),
      piperBinary('espeak-ng.dll', 380_928, '9588480f8197df62fd8461a8431f8eaec6e8e7749c5ffcbe7fee656fe40a2189'),
      piperBinary('onnxruntime.dll', 9_271_704, 'a630f67f4a82b6689e4178bf81d362d945522dd907b2a92cb43cebf72c83a06f'),
      piperBinary(
        'onnxruntime_providers_shared.dll',
        22_424,
        '71705b9bd76baced583eb37fe5ec2101946b4de50f1e9bdb156109f7e8082980',
      ),
      piperBinary('espeak-ng-data/phontab', 55_796, '886f3fa402cb0ba73d483aa8ad000af47a6b7cc06293c75a97913fba68a530f6'),
      piperBinary('espeak-ng-data/phonindex', 39_074, '3ca7b8fa3b42624e4b0f152707e7a39245fce569aa99ea47c055d9e622fcf0c4'),
      piperBinary('espeak-ng-data/phondata', 550_424, '4e0288957874029a8c3c9f41a8f517ad4bf18127046decbdd4b9d1d6807ce3a3'),
      piperBinary('espeak-ng-data/intonations', 2_040, '3f8af65fd3eda9759a10f021d61361c120871f463515229c925995c7f90918cc'),
      piperBinary('espeak-ng-data/tr_dict', 46_793, '311b0557059f2dab5ee2faabb51361f5033368f0e2a54c4bdfe45e730674f26e'),
      piperBinary('espeak-ng-data/lang/trk/tr', 25, '490eb5a2f777a2f3396f3a824ed8021bd77a94be801214411461bde6689738c9'),
    ],
  },
  {
    id: 'piper-voice-tr_TR-dfki-medium',
    role: 'tts',
    required: true,
    files: [
      {
        url: hf('rhasspy/piper-voices', 'tr/tr_TR/dfki/medium/tr_TR-dfki-medium.onnx'),
        sha256: '2844717f524ab965d3fe86e60562cbb601d3e456836efcc2196cc3a14112a8fb',
        bytes: 63_201_294,
        path: 'piper/voices/tr_TR-dfki-medium.onnx',
      },
      {
        url: hf('rhasspy/piper-voices', 'tr/tr_TR/dfki/medium/tr_TR-dfki-medium.onnx.json'),
        sha256: '13ebd7810f1b61b5027583cf3131a0a233b6ea81c38f2200ebc4ff41c3cca039',
        bytes: 4_960,
        path: 'piper/voices/tr_TR-dfki-medium.onnx.json',
      },
    ],
  },
  {
    // Supertonic 3 (ONNX, ~99 M parametre): varsayılan ses. Ekran kartında (CUDA) ilk ses ≈0,2 sn, ≈1 GB ekran belleği.
    // On hazır ses (M1–M5, F1–F5) `voice_styles/` altındadır. Lisans notu dosyanın başında.
    id: 'supertonic-3-onnx',
    role: 'tts',
    required: true,
    files: [
      repoFile(SUPERTONIC_REPO, TTS_SUPERTONIC_DIR, 'onnx/duration_predictor.onnx', 3_700_147, 'c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db'),
      repoFile(SUPERTONIC_REPO, TTS_SUPERTONIC_DIR, 'onnx/text_encoder.onnx', 36_416_150, 'c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff'),
      repoFile(SUPERTONIC_REPO, TTS_SUPERTONIC_DIR, 'onnx/vector_estimator.onnx', 256_534_781, '883ac868ea0275ef0e991524dc64f16b3c0376efd7c320af6b53f5b780d7c61c'),
      repoFile(SUPERTONIC_REPO, TTS_SUPERTONIC_DIR, 'onnx/vocoder.onnx', 101_424_195, '085de76dd8e8d5836d6ca66826601f615939218f90e519f70ee8a36ed2a4c4ba'),
      repoFile(SUPERTONIC_REPO, TTS_SUPERTONIC_DIR, 'onnx/tts.json', 8_253, '42078d3aef1cd43ab43021f3c54f47d2d75ceb4e75f627f118890128b06a0d09'),
      repoFile(SUPERTONIC_REPO, TTS_SUPERTONIC_DIR, 'onnx/unicode_indexer.json', 277_676, '9bf7346e43883a81f8645c81224f786d43c5b57f3641f6e7671a7d6c493cb24f'),
      repoFile(SUPERTONIC_REPO, TTS_SUPERTONIC_DIR, 'LICENSE', 15_007, '0d944a9110fed9a9602d60e0423a272903e7bd21ab060490774efc77c2275e9f'),
      repoFile(SUPERTONIC_REPO, TTS_SUPERTONIC_DIR, 'voice_styles/M1.json', 291_748, 'e35604687f5d23694b8e91593a93eec0e4eca6c0b02bb8ed69139ab2ea6b0a5b'),
      repoFile(SUPERTONIC_REPO, TTS_SUPERTONIC_DIR, 'voice_styles/M2.json', 292_055, 'b76cbf62bac707c710cf0ae5aba5e31eea1a6339a9734bfae33ab98499534a50'),
      repoFile(SUPERTONIC_REPO, TTS_SUPERTONIC_DIR, 'voice_styles/M3.json', 290_198, 'ea1ac35ccb91b0d7ecad533a2fbd0eec10c91513d8951e3b25fbba99954e159b'),
      repoFile(SUPERTONIC_REPO, TTS_SUPERTONIC_DIR, 'voice_styles/M4.json', 291_522, 'ca8eefad4fcd989c9379032ff3e50738adc547eeb5e221b82593a6d7b3bac303'),
      repoFile(SUPERTONIC_REPO, TTS_SUPERTONIC_DIR, 'voice_styles/M5.json', 291_469, 'dd22b92740314321f8ae11c5e87f8dd60d060f15dd3a632b5adf77f471f77af2'),
      repoFile(SUPERTONIC_REPO, TTS_SUPERTONIC_DIR, 'voice_styles/F1.json', 292_046, 'bbdec6ee00231c2c742ad05483df5334cab3b52fda3ba38e6a07059c4563dbc2'),
      repoFile(SUPERTONIC_REPO, TTS_SUPERTONIC_DIR, 'voice_styles/F2.json', 292_423, '7c722c6a72707b1a77f035d67f0d1351ba187738e06f7683e8c72b1df3477fc6'),
      repoFile(SUPERTONIC_REPO, TTS_SUPERTONIC_DIR, 'voice_styles/F3.json', 290_794, '12f6ef2573baa2defa1128069cb59f203e3ab67c92af77b42df8a0e3a2f7c6ab'),
      repoFile(SUPERTONIC_REPO, TTS_SUPERTONIC_DIR, 'voice_styles/F4.json', 291_808, 'c2fa764c1225a76dfc3e2c73e8aa4f70d9ee48793860eb34c295fff01c2e032b'),
      repoFile(SUPERTONIC_REPO, TTS_SUPERTONIC_DIR, 'voice_styles/F5.json', 291_479, '45966e73316415626cf41a7d1c6f3b4c70dbc1ba2bee5c1978ef0ce33244fc8d'),
    ],
  },
  {
    // ONNX Runtime 1.32.0 (CUDA 13) ve gereken NVIDIA kitaplıkları: yalnız Supertonic ve EMA'nın gerçekten yüklediği
    // on iki DLL (ölçüldü: süreçteki modül listesi) ve cuDNN'in iki küçük yardımcı kitaplığı. cuFFT, cuRAND, nvrtc
    // yüklenmiyor; alınmaz (≈560 MB tasarruf). Üç tekerlek birer kez iner (158 + 427 + 407 MB), dosyalar içinden çıkarılır.
    id: 'onnxruntime-1.32.0-cuda13',
    role: 'tts',
    required: true,
    files: [
      wheelFile(ORT_GPU_WHEEL, 'onnxruntime/capi', TTS_ORT_CUDA_DIR, 'onnxruntime.dll', 22_056_760, 'bf15aef3dbb3bf486596731c59d870f0f0f38fb2ae2a4071f4fd0755ca0b32cf'),
      wheelFile(ORT_GPU_WHEEL, 'onnxruntime/capi', TTS_ORT_CUDA_DIR, 'onnxruntime_providers_cuda.dll', 186_557_240, '91e707393f8aa2ebbcce1a92da0447956d6c1c026e47f0d228c74c0ccef0c998'),
      wheelFile(ORT_GPU_WHEEL, 'onnxruntime/capi', TTS_ORT_CUDA_DIR, 'onnxruntime_providers_shared.dll', 21_816, '26531e1788db4652dd47e8c4bf85f47a52c169fadb9c18ca25131f71b455c00b'),
      wheelFile(CUBLAS_WHEEL, 'nvidia/cu13/bin/x86_64', TTS_ORT_CUDA_DIR, 'cublas64_13.dll', 55_212_656, 'db5a1d5a0ed0ef126e005fc7449d3584353aaeb8739a18d716fe74be1254a3da'),
      wheelFile(CUBLAS_WHEEL, 'nvidia/cu13/bin/x86_64', TTS_ORT_CUDA_DIR, 'cublasLt64_13.dll', 499_102_832, 'ca478e1ea932f883ef4fc284f8f33d910079df4e77f9a2ec38d9b4387795f96f'),
      wheelFile(CUDNN_WHEEL, 'nvidia/cudnn/bin', TTS_ORT_CUDA_DIR, 'cudnn64_9.dll', 272_496, '4a9e4377b8dd01bbbfacfef70fc5ce0bcedac0c4a6467b08be64ee9b3a21d012'),
      wheelFile(CUDNN_WHEEL, 'nvidia/cudnn/bin', TTS_ORT_CUDA_DIR, 'cudnn_graph64_9.dll', 125_943_920, '6413db6e0b4bb57750797084d0b88ed7bf1e90d714f48b6d5795eae06049cc84'),
      wheelFile(CUDNN_WHEEL, 'nvidia/cudnn/bin', TTS_ORT_CUDA_DIR, 'cudnn_ops64_9.dll', 33_099_376, 'cca7dd430d34a3a95808d119537776e0d469e147a8adab25b304ec9a81897f3c'),
      wheelFile(CUDNN_WHEEL, 'nvidia/cudnn/bin', TTS_ORT_CUDA_DIR, 'cudnn_engines_precompiled64_9.dll', 219_385_456, '6def0d87bef6e51c0615e04089b621ef02a5e4a5edbf1525960d33817b79ad4d'),
      wheelFile(CUDNN_WHEEL, 'nvidia/cudnn/bin', TTS_ORT_CUDA_DIR, 'cudnn_heuristic64_9.dll', 94_795_376, '0946e0391135f4a813eae28f727fbff8dfa208ad31ffb450007f43336946fe3c'),
      wheelFile(CUDNN_WHEEL, 'nvidia/cudnn/bin', TTS_ORT_CUDA_DIR, 'cudnn_engines_runtime_compiled64_9.dll', 38_390_896, '01e81f1a691174e5b259d24323f483a10dfa8a34313bf2eba2a2f1d86eae12e4'),
      wheelFile(CUDNN_WHEEL, 'nvidia/cudnn/bin', TTS_ORT_CUDA_DIR, 'cudnn_engines_tensor_ir64_9.dll', 156_784, '2acad24ea4bdf289476b15d16bb2fe5ffea0e8b1f4aa76c65a06eb2b8d2e815f'),
      wheelFile(CUDNN_WHEEL, 'nvidia/cudnn/bin', TTS_ORT_CUDA_DIR, 'cudnn_cnn64_9.dll', 1_462_384, '557cc789dd5151ba9d512f831f3b50cbbf94a1919b6577d4d19227445324434b'),
      wheelFile(CUDNN_WHEEL, 'nvidia/cudnn/bin', TTS_ORT_CUDA_DIR, 'cudnn_ext64_9.dll', 130_160, '51b2efd1d94140b400de39e635da5bfcfdf1d058100c75a482b426e14bcb231d'),
    ],
  },
  {
    // DirectML yedeği: CUDA açılamazsa (NVIDIA kartı yok, sürücü eski) aynı modeller DirectX 12 üzerinden ekran
    // kartında koşar (ölçüm: Supertonic'te ilk ses ≈0,7–0,8 sn). Zorunlu değil; arka planda iner.
    id: 'onnxruntime-1.24.4-directml',
    role: 'tts',
    required: false,
    files: [
      wheelFile(ORT_DML_WHEEL, 'onnxruntime/capi', TTS_ORT_DML_DIR, 'onnxruntime.dll', 21_111_832, '302c69f9779d63ef4ab90316e59444c4acbaca7fe3455020d79d10bcfcb00715'),
      wheelFile(ORT_DML_WHEEL, 'onnxruntime/capi', TTS_ORT_DML_DIR, 'DirectML.dll', 18_527_776, 'b73972115320e906a49602f2027a3266622881b0d325ba685e0f165a9482a8d7'),
    ],
  },
  {
    // EMA Lightning (8,6 M parametre, tek Türkçe ses): ikinci yerel motor. Üç ONNX grafiği ve sözlük (`meta.json`).
    id: 'ema-lightning-onnx-1.0',
    role: 'tts',
    required: false,
    files: [
      repoFile(EMA_ONNX_REPO, TTS_EMA_DIR, 'text.onnx', 4_806_400, 'ad5d4885b5d218f63d976a6e562334ea0194aec54847a6c6482d328e784089f0'),
      repoFile(EMA_ONNX_REPO, TTS_EMA_DIR, 'sound.onnx', 18_120_655, '958364217360cecaa92dc5ff2170d19f3c9f6995fd5e61241ea4068971a46a59'),
      repoFile(EMA_ONNX_REPO, TTS_EMA_DIR, 'decoder.onnx', 12_031_945, '396c06a8e5711fd40bfd2c3f4f33851feb2ad07a86485833844e0ae8ff637b17'),
      repoFile(EMA_ONNX_REPO, TTS_EMA_DIR, 'meta.json', 357, '76627201405723633f5319a208ed7dea63c42acbf3ca997671bccdca9d9186b2'),
      repoFile(EMA_ONNX_REPO, TTS_EMA_DIR, 'LICENSE', 11_356, '5c9817c129b98e7bb966bca028c43c19107102ef8e03fe799bffb4354f4ef015'),
      repoFile(EMA_ONNX_REPO, TTS_EMA_DIR, 'NOTICE', 1_170, '498684f051de6523c86c08b6f182f2d69b65df873ed260b96dbe802be4df94d3'),
    ],
  },
  {
    // Yerel beyin (KURGU §6): Claude kullanılamadığında turu bu bilgisayarda yürüten sunucu. Zorunlu değil:
    // yoksa uygulama açılır, yalnız yerel beyin "kurulu değil" der. Arşivdeki öteki araçlar (bench, cli…) alınmaz.
    id: 'llama-server-prism-b10777-cuda13',
    role: 'llm',
    required: false,
    files: [
      llamaBinary('llama-server.exe', 10_752, '4f67e95172df70640d44e5ec49cda6b56e33affe51ad1a039363f0cd0739d0dc'),
      llamaBinary('llama-server-impl.dll', 7_484_928, '6d0720a321d318d5f7d836ff095f25fc850f5ec54b8cad62045ab91631ab1e2b'),
      llamaBinary('llama-common.dll', 9_757_184, 'e193f6a24cf5d47a8e9aa187897cce0d6c455af6c20e5be3011482f6aecff876'),
      llamaBinary('llama.dll', 2_605_056, '3d5dd808bada84b3148f8ba4d908f0eea698ade0e0246d5065cd3c2e26efc077'),
      llamaBinary('mtmd.dll', 2_377_728, 'cc5964bdbbb2397c61c6d69ee41db50755593b092d824c0a9cf7987eb8db8b48'),
      llamaBinary('ggml.dll', 66_560, '4222f5847c4ca04558adabc4c30fa863af4403eb3a34d4949012335f131a5a69'),
      llamaBinary('ggml-base.dll', 677_888, '813556ac24333c739a82c51c8b0b78035e36f242e68192fcdc5762a46e624c31'),
      llamaBinary('ggml-cuda.dll', 180_652_032, '1e7d8062b77106c691d73df6bbffd89e24fdf3e7379cd5d605076bd43e724ceb'),
      llamaBinary('ggml-rpc.dll', 124_416, '39e0a41c3ab440ce5f243db5d5555e5e7e7d63279dc8e4ac468882f6296ac2b7'),
      // İşlemci arka ucu açılışta işlemciye göre seçilir (Whisper paketindeki gibi); hepsi durur.
      llamaBinary('ggml-cpu-alderlake.dll', 985_088, 'fd66ca72bb2820a67e321129c644ddc13629c9b88083d5e1d3fed971abf37bc6'),
      llamaBinary('ggml-cpu-cannonlake.dll', 1_222_656, '5434db76a0158e5561b6dae392e95ad6fade9db46ef4461eceafa10fa20ff5da'),
      llamaBinary('ggml-cpu-cascadelake.dll', 1_224_704, 'aa7a9e36ff6133385905b704b3654705839b0d617feca0ea1a8047e0eda3dbf0'),
      llamaBinary('ggml-cpu-haswell.dll', 987_648, 'b6f78e6c2d7bbd152d85167554dcd8f221f557df7c3f8cd2d495e6dc38c5be97'),
      llamaBinary('ggml-cpu-icelake.dll', 1_224_704, 'f2824ffd3d2efcc57c7adaf1d68dd1413ee9af0af398a5de79b5eabf45df5730'),
      llamaBinary('ggml-cpu-sandybridge.dll', 894_464, 'a2a8fd6dbea033144909d46e68acae4fabbeb6a664b9448972ef8e7400235e19'),
      llamaBinary('ggml-cpu-skylakex.dll', 1_222_656, 'f33885abc7eea0a6d5db4012bd8580ad8274a98f1fe91033b316be7fa24c4e8b'),
      llamaBinary('ggml-cpu-sse42.dll', 813_568, '8b4362a1801edef13ec014a5e0095f955490e27cfa7549478753c5407eafd8d4'),
      llamaBinary('ggml-cpu-ssse3.dll', 831_488, '396c3b16a7c38323eaa17b3304c815da5b90c9d003530b912625ce0c301cabf5'),
      llamaBinary('ggml-cpu-x64.dll', 814_592, 'a7cf9befbc5993e946f8de360bbae85914c5c960a49f55e207209895c7573019'),
      llamaBinary('cublas64_13.dll', 51_870_320, 'f1d500d0cd892f5b8c6b6cdbffd82d0c55d5f5427215668e7ceb55aeeccc1b63', LLAMA_CUDART_ZIP),
      llamaBinary('cublasLt64_13.dll', 460_301_424, 'b592cd016d7673e9cb97716a22b27c4010ee635377a3ba28f37070a9bdb76a68', LLAMA_CUDART_ZIP),
      llamaBinary('cudart64_13.dll', 551_024, 'b00ca6f53699120da815bf3e06e2e4285fae2f201235b883dcbb50eec51e2a2a', LLAMA_CUDART_ZIP),
    ],
  },
  {
    // Qwen3.5 4B (Apache-2.0), Q4_K_M. Değerlendirme: `scripts/e2e/local-llm-eval.mjs`. Kimlik `Policy.brain.local.modelId`
    // varsayılanıyla aynıdır. Kaynak: https://huggingface.co/unsloth/Qwen3.5-4B-GGUF
    id: 'qwen3.5-4b-q4km',
    role: 'llm',
    required: false,
    files: [
      {
        url: hf('unsloth/Qwen3.5-4B-GGUF', 'Qwen3.5-4B-Q4_K_M.gguf'),
        sha256: '00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4',
        bytes: 2_740_937_888,
        path: 'llm/Qwen3.5-4B-Q4_K_M.gguf',
      },
    ],
  },
];

/**
 * Ses hattının modelleri kimlikle değil rolle ve dosya adıyla bulması için sabit yollar (`Paths.models` altına göreli).
 * Model sürümü değişirse hem yukarıdaki liste hem bu yollar birlikte değişir.
 */
export const LOCAL_MODEL_PATHS = {
  whisperModel: 'whisper/ggml-large-v3-turbo-q5_0.bin',
  whisperServer: `${WHISPER_DIR}/whisper-server.exe`,
  vad: 'vad/silero_vad_v5.onnx',
  kwsEncoder: `${KWS_DIR}/encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx`,
  kwsDecoder: `${KWS_DIR}/decoder-epoch-12-avg-2-chunk-16-left-64.onnx`,
  kwsJoiner: `${KWS_DIR}/joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx`,
  kwsTokens: `${KWS_DIR}/tokens.txt`,
  kwsBpeModel: `${KWS_DIR}/bpe.model`,
  piperExe: `${PIPER_DIR}/piper.exe`,
  piperEspeakData: `${PIPER_DIR}/espeak-ng-data`,
  piperVoice: 'piper/voices/tr_TR-dfki-medium.onnx',
  llamaServer: `${LLAMA_DIR}/llama-server.exe`,
  /** Yerel ekran kartı sesi: klasörler (ses konağı dosyaları adlarıyla bulur). */
  ttsRuntimeCuda: TTS_ORT_CUDA_DIR,
  ttsRuntimeDirectml: TTS_ORT_DML_DIR,
  ttsSupertonic: TTS_SUPERTONIC_DIR,
  ttsEma: TTS_EMA_DIR,
} as const;

/** `LOCAL_MODEL_PATHS` içindeki yolların ait olduğu model kimlikleri (hazır olma denetimi için). */
export const LOCAL_MODEL_IDS = {
  whisperModel: 'whisper-large-v3-turbo-q5',
  whisperServer: 'whisper-cpp-1.9.2-cuda12.4',
  vad: 'silero-vad-v5',
  kws: 'kws-zipformer-gigaspeech-3.3m-2024-01-01',
  piper: 'piper-2023.11.14-2-win64',
  piperVoice: 'piper-voice-tr_TR-dfki-medium',
  llamaServer: 'llama-server-prism-b10777-cuda13',
} as const;

/**
 * İsteğe bağlı yerel modeller: `DEFAULT_LOCAL_MODELS` içinde DEĞİLDİR (masaüstü açılışta listedeki eksik her modeli
 * yerleştirmeye/indirmeye çalışır; 5,7 GB'lık bir dosya kendiliğinden inmemeli). Kullanmak için kayıt
 * `Policy.localModels` listesine eklenir ve `Policy.brain.local.modelId` bu kimliğe çevrilir (Fuber Yönetim ›
 * Beyin › "Yerel model" listesi politikadaki `llm` kayıtlarını gösterir). Ekran belleği yetmezse yerel beyin "yeterli
 * ekran belleği yok" der; daha küçük modele kendiliğinden düşülmez.
 *
 * Qwen3.5 9B (Apache-2.0), Q4_K_M: aynı ailenin büyüğü; ~6,5 GB boş ekran belleği ister (4B: ~3,5 GB). Özet ve boyut
 * Hugging Face LFS kaydından (16 Kasım 2026). Ölçüm: `node scripts/e2e/local-llm-eval.mjs qwen3.5-9b-q4km`.
 *
 * Ölçüm (16 Kasım 2026, RTX 4080 SUPER, 121 deneme, aynı istem ve araçlar): 9B 115/121, 4B 117–118/121. 9B 5,5 GB
 * ekran belleği tuttu (4B: 3,2 GB), 110 token/sn üretti (4B: ~175), ilk parça 412 ms (4B: ~290 ms), tur 768 ms
 * (4B: ~440 ms). Bu istem kümesinde kazanç görülmedi; VARSAYILAN DEĞİŞMEDİ. Uzun, serbest sohbette fark ölçülmedi.
 */
export const OPTIONAL_LOCAL_MODELS: LocalModel[] = [
  {
    id: 'qwen3.5-9b-q4km',
    role: 'llm',
    required: false,
    files: [
      {
        url: hf('unsloth/Qwen3.5-9B-GGUF', 'Qwen3.5-9B-Q4_K_M.gguf'),
        sha256: '03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8',
        bytes: 5_680_522_464,
        path: 'llm/Qwen3.5-9B-Q4_K_M.gguf',
      },
    ],
  },
];
