# resources/vosk

`tr.tar.gz` is the **Vosk small Turkish speech recognition model** by Alpha Cephei, repacked for `vosk-browser`.

| | |
|---|---|
| Model | `vosk-model-small-tr-0.3` (Kaldi, small Turkish model) |
| Source | <https://alphacephei.com/vosk/models/vosk-model-small-tr-0.3.zip> (listed at <https://alphacephei.com/vosk/models>) |
| License | Apache License 2.0 — <https://www.apache.org/licenses/LICENSE-2.0> (the same text as this repository's `LICENSE`) |
| Changes | Repacked by `scripts/vosk-paketle.py`: only the files the recognizer needs are kept, laid out under `model/` (`am/`, `conf/`, `graph/`, `ivector/`) as vosk-browser expects; `model/conf/model.conf` (decoder settings) is written by the script. The acoustic model, graphs and i-vector extractor are copied unchanged. |
| SHA-256 of `tr.tar.gz` | `5f7b28f6446dd5848e573e7b1f28250b68ef26db898ab31cba156bcab55f2c60` |

---

**Türkçe:** `tr.tar.gz`, Alpha Cephei’nin Vosk küçük Türkçe modelidir (`vosk-model-small-tr-0.3`, Apache-2.0). `scripts/vosk-paketle.py` ile
vosk-browser’ın beklediği yapıya yeniden paketlenmiştir; akustik model, çizgeler ve i-vector dosyaları değiştirilmemiştir.
