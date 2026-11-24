// Paketli uygulamanın DAĞITILMAYAN test kopyası (0.12 H6). Dağıtılan exe'de EnableNodeCliInspectArguments sigortası KAPALI (electron-builder.yml
// electronFuses): --inspect yok sayılır. Playwright'ın Electron sürücüsü ana sürece --inspect=0 ile bağlanır; bu yüzden paketli testler bu
// kopyada koşar ve açılışta kopyanın güncel olduğunu doğrular (scripts/paket-dogrula.mjs — bayatsa durur):
//   · win-unpacked klasörü olduğu gibi kopyalanır (app.asar, kaynak/, DLL'ler bayt bayt aynı; asar bütünlük kaynağı exe'nin içinde aynen kalır);
//   · kopyanın exe'sinde YALNIZ EnableNodeCliInspectArguments açılır (scripts/sigorta-teli.mjs; @electron/fuses biçimi, ona bağımlı değil);
//   · asıl exe ile kopya bayt bayt karşılaştırılır: tam olarak 1 bayt farklı olmalı (sigorta teli) — değilse çıkış 1.
// Hedef YALNIZ kaynağın kardeşi ve adı "<kaynak>-test" olabilir (düzeltme turu 1: yanlış bir hedef — ör. release — silinmesin).
// Kopya release/ altında kalır (commit'lenmez), kurulum dosyasına girmez (NSIS paketi win-unpacked'tan, kopyadan önce üretilir).
// Çalıştır: node scripts/paket-test-kopyasi.mjs [kaynak-win-unpacked]
//   varsayılan: release/win-unpacked → release/win-unpacked-test ; Fuber Yönetim için: yonetim/release/win-unpacked → yonetim/release/win-unpacked-test
// Son satır JSON özet: { kaynakExe, kopyaExe, farkliBayt, sigortalar: { asil, kopya } }.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sigortaCevir, sigortalariOku } from './sigorta-teli.mjs';
import { TEST_EKI, testKopyasiDogrula } from './paket-dogrula.mjs';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kaynak = path.resolve(process.argv[2] || path.join(KOK, 'release', 'win-unpacked'));
const hedef = `${kaynak}${TEST_EKI}`;
if (process.argv[3] && path.resolve(process.argv[3]) !== hedef) { console.error(`hedef yalnız "${hedef}" olabilir (kaynağın kardeşi, adı …${TEST_EKI})`); process.exit(1); }
if (!fs.existsSync(kaynak) || !fs.statSync(kaynak).isDirectory()) { console.error(`kaynak klasör yok: ${kaynak}`); process.exit(1); }
if (path.basename(kaynak).endsWith(TEST_EKI)) { console.error(`kaynak zaten bir test kopyası: ${kaynak}`); process.exit(1); }

/** Klasördeki uygulama exe'si (Electron dağıtımında tek exe; kaldırıcı burada değil). */
function uygulamaExe(klasor) {
  const adaylar = fs.readdirSync(klasor).filter((a) => a.toLowerCase().endsWith('.exe'));
  if (adaylar.length !== 1) throw new Error(`${klasor}: tek exe bekleniyordu, bulunan: ${adaylar.join(', ') || 'yok'}`);
  return path.join(klasor, adaylar[0]);
}

const kaynakExe = uygulamaExe(kaynak);
// Hedefin içinde exe + resources olmalı (yalnız daha önce bu betiğin ürettiği bir kopya silinir).
if (fs.existsSync(hedef)) {
  const icerik = fs.readdirSync(hedef);
  if (icerik.length && !(icerik.includes(path.basename(kaynakExe)) && icerik.includes('resources'))) { console.error(`hedef bir test kopyasına benzemiyor, silinmedi: ${hedef}`); process.exit(1); }
}
fs.rmSync(hedef, { recursive: true, force: true });
fs.cpSync(kaynak, hedef, { recursive: true });
const kopyaExe = path.join(hedef, path.basename(kaynakExe));
const ikili = fs.readFileSync(kopyaExe);
sigortaCevir(ikili, 'EnableNodeCliInspectArguments', true);
fs.writeFileSync(kopyaExe, ikili);

// Bayt karşılaştırması: tam olarak sigorta telinin bir baytı farklı olmalı (paket-dogrula ile aynı denetim + app.asar özeti).
const a = fs.readFileSync(kaynakExe);
let farkliBayt = a.length === ikili.length ? 0 : -1;
if (farkliBayt === 0) for (let i = 0; i < a.length; i++) if (a[i] !== ikili[i]) farkliBayt++;
const ozet = { kaynakExe, kopyaExe, farkliBayt, sigortalar: { asil: sigortalariOku(a), kopya: sigortalariOku(ikili) } };
console.log(`Test kopyası: ${path.relative(KOK, hedef)} (dağıtılmaz; yalnız EnableNodeCliInspectArguments açık; ${farkliBayt} bayt farklı)`);
console.log(JSON.stringify(ozet));
try { testKopyasiDogrula(kopyaExe); } catch (e) { console.error(e.message); process.exit(1); }
if (farkliBayt !== 1 || ozet.sigortalar.kopya.EnableNodeCliInspectArguments !== 'açık') process.exit(1);
