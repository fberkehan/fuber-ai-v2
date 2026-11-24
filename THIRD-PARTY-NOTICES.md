# Third-party notices

The code of this repository is licensed under FSL-1.1-ALv2 (`LICENSE`). Third-party components keep their own licenses;
nothing here changes them. If you redistribute a build, check the terms of everything it contains, in particular any
downloaded models.

## Stored in this repository

| Component | Location | License |
| --- | --- | --- |
| Chakra Petch font (Light, Medium, SemiBold) | `plugins/jarvis-quest/device/quest-unity/Assets/Fuber/Fonts` | SIL OFL 1.1 (`OFL.txt` next to the fonts) |
| Gradle wrapper | `plugins/jarvis-watch/device/watch-android/gradle/wrapper`, `gradlew`, `gradlew.bat` | Apache-2.0 |
| Bouncy Castle license text | `plugins/jarvis-quest/device/quest-unity/Assets/Plugins/BouncyCastle/LICENSE.md` | MIT (the DLL itself is not included, see below) |

## Code in this repository adapted from third-party sources

Two speech engines contain code ported from other projects. Both files are TypeScript rewrites for ONNX Runtime and
were modified; each carries a notice at the top. The upstream copyright notices, license texts and `NOTICE` contents
are reproduced below.

| File | Adapted from | License |
| --- | --- | --- |
| `apps/desktop/src/tts-host/engines/supertonic.ts` | `supertonic` 1.3.1 Python package: text preprocessing (`_SYMBOL_REPLACEMENTS`, `UnicodeProcessor._preprocess_text`) and inference pipeline, <https://github.com/supertone-inc/supertonic-py> | MIT |
| `apps/desktop/src/tts-host/engines/ema.ts` | `ema-lightning` Python package: `frontend.py`, `chunker.py`, `engine.py`, <https://github.com/canberk7/ema-lightning> | Apache-2.0 |
| `apps/desktop/src/tts-host/engines/ema.ts` | `web/tts.js` of `ozcancelik/ema-lightning-onnx` at commit `13c431db0356b2f7fafb1247cd823ec0d777c820`, <https://huggingface.co/ozcancelik/ema-lightning-onnx> | Apache-2.0 |

### supertonic (MIT)

```text
MIT License

Copyright (c) 2025 Supertone Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### ema-lightning (Apache-2.0)

Licensed under the Apache License, Version 2.0; the full text is in [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt).
The upstream package states no copyright notice beyond its `LICENSE` file and ships no `NOTICE` file; its
`pyproject.toml` names the author as Canberk Aslan.

### ema-lightning-onnx (Apache-2.0)

Licensed under the Apache License, Version 2.0; the full text is in [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt).
Its `NOTICE` file, reproduced as published:

```text
ema-lightning-onnx
Licensed under the Apache License, Version 2.0 (see LICENSE).

This repository redistributes, in modified form, works by others:

- EMA Lightning model weights (ema.pt, decoder.pt) by canberkkkkkk, Apache-2.0.
  https://huggingface.co/canberkkkkkk/ema-lightning
  Modifications: converted to ONNX and split into text, sound and decoder graphs
  (*.onnx); fp16/sound.onnx is an fp16 conversion of the sound graph. The scripts
  that do this are in export/.

- normalizer-tr by Erdem Tuna, Apache-2.0, at commit d0bc1bc6523faa4f6257642190bb723b7f4274a5.
  https://github.com/erdemtuna/normalizer-tr
  Modifications: compiled to WebAssembly (normalizer.wasm) behind a small C ABI
  (alloc, dealloc, normalize, result_ptr, result_len) using the "fallback" ambiguity policy.
  The source of the wrapper is in normalizer-wasm/. The binary also contains its Rust
  dependencies and the Rust standard library; their notices are in
  licenses/normalizer-tr-THIRD_PARTY_NOTICES.md.

web/tts.js reimplements text handling, chunking and the frame timeline of the ema-lightning
Python package (Apache-2.0, https://github.com/canberk7/ema-lightning) in JavaScript.
```

This project uses neither the WebAssembly normalizer nor normalizer-tr; the lines about them are kept only because the
notice is reproduced in full.

## npm packages (installed by `npm ci`, not stored here)

The exact set is in `package-lock.json`; run a license checker such as `npx license-checker --production` for the full
list of a build. The Electron builds bundle the packages the apps import. At the time of this release:

- almost all packages are under MIT, ISC, Apache-2.0, BSD-2-Clause or BSD-3-Clause;
- a few use 0BSD, BlueOak-1.0.0, MIT-0, Unlicense, WTFPL, Python-2.0 (`argparse`) or MIT AND Zlib (`pako`);
- some are dual-licensed and used under their permissive option: `jszip` (MIT or GPL-3.0-or-later), `@zone-eu/mailsplit`
  (MIT or EUPL-1.1+), `type-fest` (MIT or CC0-1.0);
- `buffers` 0.1.1 (pulled in by `exceljs` through `unzipper` and `binary`) has no license field in its `package.json`;
  its README states MIT/X11, the license of its sibling `chainsaw`;
- `lightningcss` (MPL-2.0) is a CSS build tool used by Tailwind CSS and Vite; it is not part of the apps;
- the fonts Inter Variable (`@fontsource-variable/inter`) and JetBrains Mono (`@fontsource-variable/jetbrains-mono`) are
  under the SIL OFL 1.1 and are bundled with the apps.

Electron ships Chromium and Node.js; their licenses are included in every Electron build (`LICENSES.chromium.html`).

## Models and runtimes downloaded by the app (not stored here)

The app downloads these on demand and checks each file against the SHA-256 pinned in
`packages/shared/src/local-models.ts`; `scripts/voice/prepare-models.mjs` can fetch them ahead of time.

| Component | License / terms |
| --- | --- |
| Whisper large-v3-turbo (ggml), whisper.cpp | MIT |
| Silero VAD | MIT |
| Wake-word model (sherpa-onnx keyword spotter trained on GigaSpeech) | Apache-2.0; check the training-data terms |
| Piper runtime | MIT; it includes espeak-ng (GPL-3.0), which runs as a separate process |
| Piper voice `tr_TR-dfki-medium` (default Turkish voice) | **CC BY-NC-SA 4.0 (non-commercial)** |
| Supertonic 3 speech synthesis model | OpenRAIL-M (use restrictions apply; the license is downloaded with the model); inference code MIT |
| EMA Lightning Turkish voice (ONNX conversion) | Apache-2.0 (license and notice are downloaded with the model) |
| ONNX Runtime (CUDA and DirectML builds) | MIT; `DirectML.dll` under Microsoft's redistribution terms |
| llama.cpp server (PrismML fork) | MIT |
| Qwen3.5 4B and 9B GGUF models | Apache-2.0 |
| NVIDIA CUDA runtime, cuBLAS, cuDNN | NVIDIA license terms (taken unmodified from the whisper.cpp release and NVIDIA's own packages) |

## Device plugins (fetched by their build tools, not stored here)

| Component | Used by | License |
| --- | --- | --- |
| Meta XR Core SDK, MR Utility Kit (Unity packages from Meta's registry) | headset app | Meta Platform Technologies SDK License |
| Unity packages listed in `Packages/manifest.json` (URP, OpenXR, XR Hands, Input System, …) | headset app | Unity Companion License and Unity terms of service |
| BouncyCastle.Cryptography 2.x (NuGet; you add the DLL yourself) | headset app | MIT |
| AndroidX, Jetpack Compose for Wear OS, Health Services client, Guava, kotlinx.coroutines | watch app | Apache-2.0 |
| Bouncy Castle for Java (`bcprov-jdk18on`) | watch app | MIT |
| JUnit 4, JSON-java (`org.json`) | watch app unit tests only, not shipped in the app | EPL-1.0; public domain |

## Names

"Fuber AI" and the Fuber AI logo are the names and marks of this project; the license does not grant the right to use
them (see the Trademarks clause in `LICENSE`). "Jarvis" is only the assistant's default persona name and is not
affiliated with any third-party trademark owner. Meta Quest, Galaxy Watch, Windows, NVIDIA and the other product names
mentioned here belong to their owners.
