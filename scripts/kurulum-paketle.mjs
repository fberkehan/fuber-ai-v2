// Kurulum başlatıcısını üretir (Görev 17, K8) — `npm run dist`'in son adımı (electron-builder'dan sonra):
// iç NSIS paketi (release/Fuber AI Paket <sürüm>.exe; tek tık, sessiz kurulur) markalı başlatıcıya (native/fuber-kurulum) "paket.exe"
// kaynağı olarak gömülür → release/Fuber AI Kurulum <sürüm>.exe (DAĞITILAN dosya; scripts/teslim.py bunu alır).
// Başlatıcıya ayrıca: sürüm, electron-builder'ın APP_GUID'i (NSIS'in kayıtlı kurulum yerini bulmak için:
// HKCU\Software\{APP_GUID}\InstallLocation), exe adı ve kurulu boyut (release/win-unpacked; ilerleme çubuğu bununla oranlanır).
// Çalıştır: node scripts/kurulum-paketle.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kurulumDerle } from '../native/derle.mjs';
import { nodeModulesDenetle, paketiDenetle } from './paket-bekcisi.mjs';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const surum = JSON.parse(fs.readFileSync(path.join(KOK, 'package.json'), 'utf8')).version;
const yml = fs.readFileSync(path.join(KOK, 'electron-builder.yml'), 'utf8');
const oku = (desen, ad) => {
  const m = yml.match(desen);
  if (!m) throw new Error(`electron-builder.yml: ${ad} bulunamadı`);
  return m[1].trim().replace(/^["']|["']$/g, '');
};
const appId = oku(/^appId:\s*(.+)$/m, 'appId');
const urun = oku(/^productName:\s*(.+)$/m, 'productName');
const exeAdi = oku(/^\s+executableName:\s*(.+)$/m, 'win.executableName') + '.exe';
const paketAdi = oku(/^\s+artifactName:\s*(.+)$/m, 'nsis.artifactName').replace('${version}', surum).replace('${ext}', 'exe');
if (/Kurulum/.test(paketAdi)) throw new Error(`iç paket adı başlatıcıyla çakışıyor: ${paketAdi}`);

const cikti = path.join(KOK, 'release', `${urun} Kurulum ${surum}.exe`);
// Önce eskisini sil: adım yarıda kalırsa aynı adlı eski (ör. asistanlı NSIS) kurulum teslim.py'ye başlatıcı diye gitmesin.
fs.rmSync(cikti, { force: true });

const paket = path.join(KOK, 'release', paketAdi);
if (!fs.existsSync(paket)) {
  console.error(`iç NSIS paketi yok: ${paket} — önce electron-builder --win nsis`);
  process.exit(1);
}

// 0.14 son inceleme I6: bozuk paket (junction'lı node_modules, asar'da eksik üretim paketi, açılmamış yerel eklenti) başlatıcıya GÖMÜLMEZ — çıkış 1,
// "Fuber AI Kurulum" dosyası üretilmez (teslim.py onu bulamaz). Ayrıntı: scripts/paket-bekcisi.mjs.
{
  const yml2 = fs.readFileSync(path.join(KOK, 'electron-builder.yml'), 'utf8');
  const nm = nodeModulesDenetle(KOK);
  const hatalar = [...(nm ? [nm] : []), ...paketiDenetle({ kok: KOK, kaynaklar: path.join(KOK, 'release', 'win-unpacked', 'resources'), yml: yml2, enAz: 150 })];
  if (hatalar.length) {
    console.error('\n✖ PAKET BEKÇİSİ (sonra): release/win-unpacked BOZUK — kurulum başlatıcısı üretilmedi.');
    for (const h of hatalar) console.error(`  · ${h}`);
    process.exit(1);
  }
  console.log('paket bekçisi (sonra): sağlam');
}

// electron-builder NsisTarget ile aynı: options.guid yoksa UUID v5(appId, ELECTRON_BUILDER_NS_UUID).
const require = createRequire(import.meta.url);
const { UUID } = require('builder-util-runtime');
const guid = UUID.v5(appId, UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3'));

const klasorBoyutu = (k) => fs.readdirSync(k, { withFileTypes: true })
  .reduce((t, g) => t + (g.isDirectory() ? klasorBoyutu(path.join(k, g.name)) : fs.statSync(path.join(k, g.name)).size), 0);
const acik = path.join(KOK, 'release/win-unpacked');
const boyut = fs.existsSync(acik) ? klasorBoyutu(acik) : 0;
if (!boyut) console.warn('uyarı: release/win-unpacked yok; ilerleme yalnız zamana göre akacak');

const t0 = Date.now();
kurulumDerle({ cikti, paket, bilgi: { surum, guid, urun, exe: exeAdi, klasor: urun, boyut } });
const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
console.log(`kurulum başlatıcısı: ${cikti}`);
console.log(`  ${mb(fs.statSync(cikti).size)} (iç paket ${paketAdi} ${mb(fs.statSync(paket).size)}; kurulu ${mb(boyut)}; APP_GUID ${guid}) — ${((Date.now() - t0) / 1000).toFixed(1)} sn`);
