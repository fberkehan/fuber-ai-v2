#!/usr/bin/env node
// ── Uyandırma WASM'ındaki yerel derleme yollarını nötrler ─────────────────────────────────────────────────────────────────────────────
// C/C++ derleyicisi __FILE__ ile kaynak dosyanın MUTLAK yolunu ikiliye yazar (sherpa-onnx ve kaldi-decoder günlük/iddia iletileri); bu yollar derlemenin
// yapıldığı bilgisayarın klasör adlarını taşır. Bu betik, derleme kökünü (<depo>/.superpowers/uyandirma/wasm/) içeren her dizginin önekini AYNI
// UZUNLUKTA nötr bir önekle değiştirir:
//   <derleme kökü>/sherpa/sherpa-onnx/csrc/cat.cc  →  /build//////…//////sherpa/sherpa-onnx/csrc/cat.cc
// Boyut ve konumlar değişmez: WASM'ın bölüm boyları, veri kesimi adresleri ve dizgi kuyrukları (birleştirilmiş dizgiler dahil) aynı kalır; art arda
// eğik çizgiler POSIX yolunda tek eğik çizgiyle eşdeğerdir. Yalnız NUL'dan sonra başlayan yazdırılabilir dizgilerdeki önek değişir. Hazır ONNX Runtime
// kitaplığının ve emsdk'nin kendi yolları (/home/runner/…, /emsdk/…) kişisel değildir, dokunulmaz. wasm-derle.mjs her derlemede bunu uygular.
//   node scripts/dev/uyandirma/wasm-yol-temizle.mjs <dosya.wasm>            yerinde temizler (geçersiz WASM ya da kalan yerel yol: 1 ile çıkar)
//   node scripts/dev/uyandirma/wasm-yol-temizle.mjs <dosya.wasm> --denetle  yalnız denetler (yerel yol varsa 1 ile çıkar)
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const NOTR_ONEK = '/build';
/** Dizgi başından (NUL'dan sonra) derleme kökünün sonuna kadarki önek; ayraç / ya da \ olabilir. */
const KOK_ONEKI = /(?<=\0)(?:[A-Za-z]:[\\/]|\/)[\x20-\x7e]*?[\\/]\.superpowers[\\/]uyandirma[\\/]wasm[\\/]/g;
/** Denetim: NUL'dan sonra başlayan sürücü yolu (C:/…, D:\…) ya da kullanıcı klasörü (/Users/…, /home/<ad>/…; CI'nin /home/runner'ı hariç). */
const YEREL_YOL = /(?<=\0)(?:[A-Za-z]:[\\/]|\/Users\/|\/home\/(?!runner\/))[\x20-\x7e]*/g;

/** Tamponun temizlenmiş kopyası; `sayi` değişen dizgi sayısı. Boyut hep aynıdır. */
export function yollariTemizle(tampon) {
  const metin = Buffer.from(tampon).toString('latin1');
  const cikti = Buffer.from(tampon);
  let sayi = 0;
  for (const m of metin.matchAll(KOK_ONEKI)) {
    cikti.write(NOTR_ONEK + '/'.repeat(m[0].length - NOTR_ONEK.length), m.index, 'latin1');
    sayi++;
  }
  return { tampon: cikti, sayi };
}

/** Kalan yerel yollar: [{ konum, ornek }] (denetim ve tests/uyandirma.test.ts). */
export function yerelYollar(tampon) {
  const metin = Buffer.from(tampon).toString('latin1');
  return [...metin.matchAll(YEREL_YOL)].map((m) => ({ konum: m.index, ornek: m[0].slice(0, 80) }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dosya = process.argv[2];
  if (!dosya) { console.error('kullanım: node scripts/dev/uyandirma/wasm-yol-temizle.mjs <dosya.wasm> [--denetle]'); process.exit(2); }
  const ham = readFileSync(dosya);
  if (process.argv.includes('--denetle')) {
    const kalan = yerelYollar(ham);
    if (kalan.length) { console.error(`${kalan.length} yerel yol var; ilki ${kalan[0].konum}. baytta: ${kalan[0].ornek}`); process.exit(1); }
    console.log('yerel yol yok:', dosya);
  } else {
    const { tampon, sayi } = yollariTemizle(ham);
    if (!WebAssembly.validate(tampon)) { console.error('temizlenen WASM geçersiz; dosya değiştirilmedi'); process.exit(1); }
    const kalan = yerelYollar(tampon);
    if (kalan.length) { console.error(`${kalan.length} yerel yol kaldı (derleme kökü dışında); ilki: ${kalan[0].ornek}`); process.exit(1); }
    if (sayi) writeFileSync(dosya, tampon);
    console.log(`${sayi} yol nötrlendi, ${tampon.length} bayt: ${dosya}`);
  }
}
