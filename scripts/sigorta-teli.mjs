// Electron sigorta teli: okuma ve tek sigorta çevirme (0.12 H6 düzeltme turu 1). Dağıtılan exe'nin sigortalarını electron-builder kendisi
// çevirir (electronFuses → @electron/fuses; o paket projenin DOĞRUDAN bağımlılığı değil, app-builder-lib'in bağımlılığıdır — bugün 1.8.0).
// Test betikleri ona dayanmasın diye biçim burada: @electron/fuses 1.8.0 `getCurrentFuseWire`/`flipFuses` ile birebir aynı (Windows):
//   ikilide SENTINEL dizesi → hemen ardından [tel sürümü (1), tel uzunluğu, durum baytları…]; durum '0' (48) kapalı, '1' (49) açık,
//   'r' (114) kaldırılmış. Sıra FuseV1Options: 0 RunAsNode, 1 EnableCookieEncryption, 2 EnableNodeOptionsEnvironmentVariable,
//   3 EnableNodeCliInspectArguments, 4 EnableEmbeddedAsarIntegrityValidation, 5 OnlyLoadAppFromAsar, 6 LoadBrowserProcessSpecificV8Snapshot,
//   7 GrantFileProtocolExtraPrivileges; 8 Electron 35+ telinde WasmTrapHandlers (@electron/fuses 1.8.0 adını bilmez).
// Birim testli: tests/sigortalar.test.ts (yapay tel + projenin Electron ikilisi; @electron/fuses kuruluysa onunla karşılaştırma).
import fs from 'node:fs';

export const SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX';
export const SIGORTA_ADLARI = [
  'RunAsNode', 'EnableCookieEncryption', 'EnableNodeOptionsEnvironmentVariable', 'EnableNodeCliInspectArguments',
  'EnableEmbeddedAsarIntegrityValidation', 'OnlyLoadAppFromAsar', 'LoadBrowserProcessSpecificV8Snapshot', 'GrantFileProtocolExtraPrivileges',
  'WasmTrapHandlers(8)',
];
/** electron-builder `electronFuses` anahtarı → FuseV1Options adı. */
export const YML_ADLARI = {
  runAsNode: 'RunAsNode', enableCookieEncryption: 'EnableCookieEncryption', enableNodeOptionsEnvironmentVariable: 'EnableNodeOptionsEnvironmentVariable',
  enableNodeCliInspectArguments: 'EnableNodeCliInspectArguments', enableEmbeddedAsarIntegrityValidation: 'EnableEmbeddedAsarIntegrityValidation',
  onlyLoadAppFromAsar: 'OnlyLoadAppFromAsar', loadBrowserProcessSpecificV8Snapshot: 'LoadBrowserProcessSpecificV8Snapshot',
  grantFileProtocolExtraPrivileges: 'GrantFileProtocolExtraPrivileges',
};
const DURUM = { 48: 'kapalı', 49: 'açık', 114: 'kaldırılmış' };

/** Teli bulur: { konum (ilk durum baytı), surum, uzunluk }. Sentinel yoksa ya da birden çoksa (evrensel ikili; Windows'ta olmaz) hata. */
export function teliBul(ikili) {
  const s = Buffer.from(SENTINEL, 'latin1');
  const ilk = ikili.indexOf(s);
  if (ilk < 0) throw new Error('sigorta teli bulunamadı (Electron 12+ ikilisi değil)');
  if (ikili.lastIndexOf(s) !== ilk) throw new Error('birden çok sigorta teli (beklenmeyen ikili)');
  const p = ilk + s.length;
  return { konum: p + 2, surum: ikili[p], uzunluk: ikili[p + 1] };
}

/** { SigortaAdı: 'açık' | 'kapalı' | 'kaldırılmış' | <bayt> } — dosya yolu ya da Buffer. */
export function sigortalariOku(ikiliYaDaYol) {
  const ikili = Buffer.isBuffer(ikiliYaDaYol) ? ikiliYaDaYol : fs.readFileSync(ikiliYaDaYol);
  const t = teliBul(ikili);
  if (t.surum !== 1) throw new Error(`beklenmeyen sigorta teli sürümü: ${t.surum}`);
  const o = {};
  for (let i = 0; i < t.uzunluk; i++) o[SIGORTA_ADLARI[i] ?? `Bilinmeyen${i}`] = DURUM[ikili[t.konum + i]] ?? String(ikili[t.konum + i]);
  return o;
}

/** Tek sigortayı Buffer içinde çevirir (yerinde); çevrilen baytın konumunu döner. */
export function sigortaCevir(ikili, ad, acik) {
  const i = SIGORTA_ADLARI.indexOf(ad);
  const t = teliBul(ikili);
  if (t.surum !== 1) throw new Error(`beklenmeyen sigorta teli sürümü: ${t.surum} (çevrilmedi)`);
  if (i < 0 || i >= t.uzunluk) throw new Error(`bilinmeyen sigorta: ${ad}`);
  if (ikili[t.konum + i] === 114) throw new Error(`${ad} bu Electron'da kaldırılmış`);
  ikili[t.konum + i] = acik ? 49 : 48;
  return t.konum + i;
}

/** electron-builder.yml `electronFuses:` bloğu → { SigortaAdı: 'açık' | 'kapalı' }. */
export function ymlSigortalari(yml) {
  const blok = /^electronFuses:\r?\n((?: {2}[A-Za-z0-9]+: (?:true|false)\r?\n)+)/m.exec(yml)?.[1] ?? '';
  return Object.fromEntries([...blok.matchAll(/^ {2}([A-Za-z0-9]+): (true|false)/gm)].map((m) => [YML_ADLARI[m[1]] ?? m[1], m[2] === 'true' ? 'açık' : 'kapalı']));
}
