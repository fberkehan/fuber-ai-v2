// Paket bekçisi (0.14 son inceleme I6): bozuk kurulum dosyası asla "başarılı" diye çıkmasın.
// T35'te junction'lı (bağlantılı) node_modules'tan paketlenen app.asar ≈263 yerine 26 paket taşıyordu, app.asar.unpacked (@napi-rs/canvas) yoktu:
// `npm run dist` başarılı dedi, kurulan uygulama açılışta asıldı. Bekçi iki yerde durdurur (çıkış kodu 1, açık satır):
//   · once  — paketlemeden ÖNCE: node_modules bir bağlantıysa (junction/symlink) ya da gerçek yolu proje klasörünün dışındaysa.
//   · sonra — electron-builder'dan SONRA: app.asar yoksa ya da package.json'ın üretim bağımlılıklarının kapanışındaki (dependencies +
//     kurulu optionalDependencies, özyinelemeli) bir paket asar'da da app.asar.unpacked'da da yoksa. Yerel eklentili (.node) paket
//     app.asar.unpacked'da olmalı. electron-builder.yml'deki "!node_modules/<desen>/**" dışlamaları bilerek eksiktir (ör. Agent SDK'nın ikilisi).
// Kullanım:
//   node scripts/paket-bekcisi.mjs once  [kök]
//   node scripts/paket-bekcisi.mjs sonra [kök] [resources klasörü]   (varsayılan release/win-unpacked/resources)
// npm run dist bunu çağırır (package.json "dist": once; scripts/kurulum-paketle.mjs: sonra), Fuber Yönetim scripts/yonetim-paketle.mjs'te.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ic = (kok, p) => { const g = path.relative(kok, p); return Boolean(g) && !g.startsWith('..') && !path.isAbsolute(g); };

/** Önce: node_modules bağlantı mı / proje dışında mı. Hata metni ya da null. */
export function nodeModulesDenetle(kok) {
  const nm = path.join(kok, 'node_modules');
  let st;
  try { st = fs.lstatSync(nm); } catch { return `node_modules yok: ${nm} — önce npm ci`; }
  if (st.isSymbolicLink()) return `node_modules bir bağlantı (junction/symlink): ${nm} → paket eksik çıkar. Bu klasörde gerçek bir "npm ci" çalıştır.`;
  if (!st.isDirectory()) return `node_modules bir klasör değil: ${nm}`;
  let gercek;
  try { gercek = fs.realpathSync.native(nm); } catch (e) { return `node_modules çözülemedi: ${e.message}`; }
  let kokGercek;
  try { kokGercek = fs.realpathSync.native(kok); } catch { kokGercek = path.resolve(kok); }
  if (!ic(kokGercek, gercek)) return `node_modules'ın gerçek yolu proje klasörünün dışında: ${gercek} — gerçek bir "npm ci" gerekli.`;
  return null;
}

/** electron-builder.yml'deki node_modules dışlamaları ("!node_modules/<desen>/**") → paket adı düzenli ifadeleri. */
export function dislamalar(yml) {
  const r = [];
  for (const m of String(yml).matchAll(/["']?!node_modules\/([^"'\s]+?)\/\*\*["']?/g)) {
    const desen = m[1].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
    r.push(new RegExp(`^${desen}$`));
  }
  return r;
}

/** Bağımlılığın diskteki klasörü (Node çözümlemesi: `nereden`in node_modules zinciri yukarı, köke dek). */
function bul(ad, nereden, kok) {
  for (let d = nereden; ; d = path.dirname(d)) {
    const p = path.join(d, 'node_modules', ad);
    if (fs.existsSync(path.join(p, 'package.json'))) return p;
    if (path.resolve(d) === path.resolve(kok) || path.dirname(d) === d) return null;
  }
}
const pjOku = (k) => { try { return JSON.parse(fs.readFileSync(path.join(k, 'package.json'), 'utf8')); } catch { return {}; } };

/**
 * Üretim bağımlılıklarının kapanışı: paket adı → diskteki klasör. Kök package.json'ın `dependencies`'inden başlar; her paketin `dependencies`'i ve KURULU
 * `optionalDependencies`'i izlenir. Diskte olmayan zorunlu bağımlılık `kayip`a yazılır (paketleme sorunu değil, kurulum sorunu: ayrıca söylenir).
 */
/** `esler` (11 Kas; üçüncü taraf bildirimi): KURULU eş bağımlılıklar (peerDependencies) da izlenir — npm onları kendiliğinden kurar. */
export function uretimKapanisi(kok, kokPaketi = pjOku(kok), { esler = false } = {}) {
  const paketler = new Map();
  const kayip = [];
  const kuyruk = [
    ...Object.keys(kokPaketi.dependencies ?? {}).map((ad) => ({ ad, nereden: kok, zorunlu: true })),
    ...Object.keys(kokPaketi.optionalDependencies ?? {}).map((ad) => ({ ad, nereden: kok, zorunlu: false })),
  ];
  while (kuyruk.length) {
    const { ad, nereden, zorunlu } = kuyruk.shift();
    const yer = bul(ad, nereden, kok);
    if (!yer) { if (zorunlu) kayip.push(ad); continue; }
    const anahtar = path.relative(kok, yer);
    if (paketler.has(anahtar)) continue;
    paketler.set(anahtar, { ad, yer });
    const pj = pjOku(yer);
    for (const a of Object.keys(pj.dependencies ?? {})) kuyruk.push({ ad: a, nereden: yer, zorunlu: true });
    for (const a of Object.keys(pj.optionalDependencies ?? {})) kuyruk.push({ ad: a, nereden: yer, zorunlu: false });
    if (esler) for (const a of Object.keys(pj.peerDependencies ?? {})) kuyruk.push({ ad: a, nereden: yer, zorunlu: false });
  }
  return { paketler: [...paketler.values()], kayip };
}

/** Klasörde (en çok `derinlik` alt düzey, node_modules'a inmeden) .node dosyası var mı. */
function yerelEklentiVar(k, derinlik = 4) {
  let girdiler;
  try { girdiler = fs.readdirSync(k, { withFileTypes: true }); } catch { return false; }
  for (const g of girdiler) {
    if (g.isFile() && g.name.endsWith('.node')) return true;
    if (g.isDirectory() && derinlik > 0 && g.name !== 'node_modules' && yerelEklentiVar(path.join(k, g.name), derinlik - 1)) return true;
  }
  return false;
}

/** Asar/klasör yol listesindeki paket adları (her derinlikte "node_modules/<ad>/package.json"; @kapsam/ad dahil). */
export function paketAdlari(yollar) {
  const s = new Set();
  for (const ham of yollar) {
    const y = String(ham).replace(/\\/g, '/');
    const m = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\/package\.json$/.exec(y);
    if (m) s.add(m[1]);
  }
  return s;
}

/**
 * Saf karar: gerekli paketlerden asar'da da açık klasörde de olmayanlar; yerel eklentili olup açık klasörde olmayanlar. Dışlanan adlar sayılmaz.
 * @param {{ gerekli: { ad: string, yerel?: boolean }[], asar: Set<string>, acik: Set<string>, haric?: RegExp[] }} o
 */
export function eksikleriBul(o) {
  const haric = o.haric ?? [];
  const eksik = [];
  const yerelEksik = [];
  for (const p of o.gerekli) {
    if (haric.some((r) => r.test(p.ad))) continue;
    if (!o.asar.has(p.ad) && !o.acik.has(p.ad)) eksik.push(p.ad);
    else if (p.yerel && !o.acik.has(p.ad)) yerelEksik.push(p.ad);
  }
  return { eksik: [...new Set(eksik)].sort(), yerelEksik: [...new Set(yerelEksik)].sort() };
}

function klasorYollari(k, kok = k, out = []) {
  let girdiler;
  try { girdiler = fs.readdirSync(k, { withFileTypes: true }); } catch { return out; }
  for (const g of girdiler) {
    const p = path.join(k, g.name);
    if (g.isDirectory()) klasorYollari(p, kok, out);
    else out.push(path.relative(kok, p));
  }
  return out;
}

/** Sonra: paketlenmiş uygulamanın denetimi. Hata metinleri listesi (boş = sağlam). */
export function paketiDenetle({ kok, kaynaklar, yml, kokPaketi, enAz = 0 }) {
  const hatalar = [];
  const asarYolu = path.join(kaynaklar, 'app.asar');
  if (!fs.existsSync(asarYolu)) return [`app.asar yok: ${asarYolu}`];
  const asar = createRequire(import.meta.url)('@electron/asar'); // electron-builder'ın bağımlılığı (bu deponun node_modules'u)
  const asarAdlari = paketAdlari(asar.listPackage(asarYolu, { isPack: false }));
  const acik = path.join(kaynaklar, 'app.asar.unpacked');
  const acikAdlari = paketAdlari(klasorYollari(acik));
  const { paketler, kayip } = uretimKapanisi(kok, kokPaketi);
  if (kayip.length) hatalar.push(`üretim bağımlılığı diskte yok (npm ci eksik?): ${kayip.join(', ')}`);
  const gerekli = paketler.map((p) => ({ ad: p.ad, yerel: yerelEklentiVar(p.yer) }));
  const { eksik, yerelEksik } = eksikleriBul({ gerekli, asar: asarAdlari, acik: acikAdlari, haric: dislamalar(yml) });
  if (eksik.length) hatalar.push(`app.asar'da ${eksik.length} üretim paketi eksik: ${eksik.slice(0, 40).join(', ')}${eksik.length > 40 ? ' …' : ''}`);
  if (yerelEksik.length) hatalar.push(`yerel eklentili paket app.asar.unpacked'da yok: ${yerelEksik.join(', ')}`);
  const toplam = new Set([...asarAdlari, ...acikAdlari]).size;
  if (toplam < enAz) hatalar.push(`pakette yalnız ${toplam} npm paketi var (en az ${enAz} bekleniyordu)`);
  return hatalar;
}

// ── Komut satırı ──
const buDosya = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === buDosya) {
  const [kip, kokArg, kaynakArg] = process.argv.slice(2);
  const kok = path.resolve(kokArg || path.join(path.dirname(buDosya), '..'));
  let hatalar = [];
  if (kip === 'once') {
    const h = nodeModulesDenetle(kok);
    if (h) hatalar = [h];
  } else if (kip === 'sonra') {
    const kaynaklar = path.resolve(kaynakArg || path.join(kok, 'release', 'win-unpacked', 'resources'));
    let yml = '';
    try { yml = fs.readFileSync(path.join(kok, 'electron-builder.yml'), 'utf8'); } catch { /* yok */ }
    const h = nodeModulesDenetle(kok);
    hatalar = [...(h ? [h] : []), ...paketiDenetle({ kok, kaynaklar, yml })];
  } else {
    console.error('kullanım: node scripts/paket-bekcisi.mjs once|sonra [kök] [resources]');
    process.exit(2);
  }
  if (hatalar.length) {
    console.error(`\n✖ PAKET BEKÇİSİ (${kip}): kurulum dosyası BOZUK olur — durduruldu.`);
    for (const h of hatalar) console.error(`  · ${h}`);
    process.exit(1);
  }
  console.log(`paket bekçisi (${kip}): sağlam`);
}
