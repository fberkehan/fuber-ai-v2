// ── Uyandırma işçisi (0.13 T8): WASM burada koşar, gizli pencerenin ana iş parçacığı (ScriptProcessor, gün kaydı) tıkanmaz ────────────
// Klasik işçi: Emscripten çıktısı ES modülü değil, importScripts ile yüklenir. Dosyalar fuber://app/kaynak/uyandirma/ altından okunur
// (pakette kaynak/uyandirma, asar dışı); ağa çıkılmaz, ses işçiden dışarı gitmez.
// Açılış ilerlemesi (uyandirma.ts ACILIS_SESSIZLIK_MS): dosyalar parça parça okunur, her parça 'ilerleme' bildirir; yavaş disk çökme sayılmaz.
import { kwsAc, type KwsKurucu, type KwsModul } from './uyandirma-motor.ts';
import { UYANDIRMA_AYARI } from '../shared/uyandirma-ayar.ts';
import type { UyandirmaMotoru } from './uyandirma.ts';

const TABAN = 'fuber://app/kaynak/uyandirma/';

interface IsciKapsami {
  importScripts(...u: string[]): void;
  postMessage(v: unknown): void;
  onmessage: ((e: MessageEvent<{ tur: string; o?: Float32Array }>) => void) | null;
  SherpaKws: (m: { locateFile(f: string): string; wasmBinary: Uint8Array }) => Promise<KwsModul>;
  createKws: KwsKurucu;
}
const isci = self as unknown as IsciKapsami;
let motor: UyandirmaMotoru | null = null;

const ilerle = () => isci.postMessage({ tur: 'ilerleme' });

/** Dosyayı parça parça okur: her parça ilerlemedir. Takılan okuma ilerleme üretmez, açılış süresi dolar. */
async function oku(ad: string): Promise<Uint8Array> {
  const y = await fetch(TABAN + ad);
  if (!y.ok || !y.body) throw new Error(`${ad}: ${y.status}`);
  const parcalar: Uint8Array[] = [];
  let boy = 0;
  const r = y.body.getReader();
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    parcalar.push(value);
    boy += value.length;
    ilerle();
  }
  const out = new Uint8Array(boy);
  let o = 0;
  for (const p of parcalar) { out.set(p, o); o += p.length; }
  return out;
}

async function ac(): Promise<void> {
  isci.importScripts(`${TABAN}sherpa-onnx-wasm-kws-main.js`, `${TABAN}sherpa-onnx-kws.js`);
  ilerle();
  // WASM da burada okunur (Emscripten'e bırakılsa okuma sırasında ilerleme gelmezdi). Sırayla: her dosya süreyi yeniler.
  const wasmBinary = await oku('sherpa-onnx-wasm-kws-main.wasm');
  const dosyalar: Record<string, Uint8Array> = {};
  for (const f of Object.values(UYANDIRMA_AYARI.dosyalar)) dosyalar[f] = await oku(f);
  const modul = await isci.SherpaKws({ locateFile: (f) => TABAN + f, wasmBinary });
  ilerle();
  motor = kwsAc(modul, isci.createKws, dosyalar, UYANDIRMA_AYARI, (anahtar) => isci.postMessage({ tur: 'bulundu', anahtar }));
}

isci.onmessage = (e) => {
  if (e.data.tur === 'ac') ac().then(() => isci.postMessage({ tur: 'hazir' }), (h: Error) => isci.postMessage({ tur: 'hata', hata: h.message }));
  else if (e.data.tur === 'ses' && e.data.o) {
    motor?.besle(e.data.o);
    isci.postMessage({ tur: 'islendi' }); // nöbetçi (uyandirma.ts): işçinin yaşadığının tek kanıtı
  }
};
