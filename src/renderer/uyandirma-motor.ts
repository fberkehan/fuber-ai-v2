// ── Uyandırma motoru: sherpa-onnx KWS WASM'ının üstünde ince katman (0.13 T8) ───────────────────────────────────────────────────────
// DOM yok: tarayıcıda uyandirma-isci.ts, Node'da testler ve scripts/dev/uyandirma/olc.mjs aynı kodu çağırır (ölçülen = dağıtılan).
// Model pakete gömülü değil: dosyalar WASM'ın bellek içi dosya sistemine yazılır. Anahtar sözcük bulununca akış sıfırlanır.
import type { UyandirmaAyari } from '../shared/uyandirma-ayar.ts';
import type { UyandirmaMotoru } from './uyandirma.ts';

const DIZIN = '/uyandirma';

export interface KwsAkis { acceptWaveform(hz: number, o: Float32Array): void; free(): void }
export interface Kws {
  handle: number;
  createStream(): KwsAkis;
  isReady(s: KwsAkis): boolean;
  decode(s: KwsAkis): void;
  getResult(s: KwsAkis): { keyword: string };
  reset(s: KwsAkis): void;
  free(): void;
}
export interface KwsModul { FS: { mkdirTree(y: string): void; writeFile(y: string, v: Uint8Array): void }; lengthBytesUTF8(s: string): number }
export type KwsKurucu = (m: KwsModul, ayar: unknown) => Kws;

export function kwsAc(modul: KwsModul, kur: KwsKurucu, dosyalar: Record<string, Uint8Array>, a: UyandirmaAyari, bulundu: (anahtar: string) => void): UyandirmaMotoru {
  modul.FS.mkdirTree(DIZIN);
  for (const [ad, v] of Object.entries(dosyalar)) modul.FS.writeFile(`${DIZIN}/${ad}`, v);
  const yol = (f: string) => `${DIZIN}/${f}`;
  const kws = kur(modul, {
    featConfig: { samplingRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: yol(a.dosyalar.encoder), decoder: yol(a.dosyalar.decoder), joiner: yol(a.dosyalar.joiner) },
      tokens: yol(a.dosyalar.tokens), provider: 'cpu', numThreads: 1, debug: 0, modelType: '', modelingUnit: '', bpeVocab: '',
    },
    maxActivePaths: a.yol,
    numTrailingBlanks: a.kuyruk,
    keywordsScore: a.skor,
    keywordsThreshold: a.esik,
    keywords: '',
    keywordsBuf: a.anahtar,
    keywordsBufSize: modul.lengthBytesUTF8(a.anahtar),
  });
  if (!kws.handle) throw new Error('anahtar sözcük motoru kurulamadı');
  const akis = kws.createStream();
  return {
    besle(o) {
      akis.acceptWaveform(16000, o);
      while (kws.isReady(akis)) {
        kws.decode(akis);
        const r = kws.getResult(akis);
        if (r.keyword) { kws.reset(akis); bulundu(r.keyword); }
      }
    },
    kapat() { akis.free(); kws.free(); },
  };
}
