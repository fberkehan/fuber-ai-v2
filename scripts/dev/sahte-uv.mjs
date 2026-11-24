// Sahte `uv` (yalnız test/önizleme; Görev 29). Gerçek uv, pip, PyPI ve ağ YOK. Argümanlarını ve ortamın kapsama değişkenlerini
// FUBER_SAHTE_UV_KAYIT'a yazar (testler: paket adı tam `graphifyy==0.9.95`, UV_TOOL_DIR / UV_PYTHON_INSTALL_DIR / UV_CACHE_DIR uygulama
// veri klasöründe, sorgu günlüğü kapalı). Araç ortamı UV_TOOL_DIR'de bir makbuz + Scripts/python.exe yer tutucusu; komut kalıbı
// UV_TOOL_BIN_DIR (yoksa ~/.local/bin — ev testte GEÇİCİ) altında `graphify.exe` adlı metin dosyası: gerçek uv kısayolu gibi içinde
// ortamın Python yolu yazar (çalıştırılmaz: graphify testte FUBER_GRAPHIFY_KOMUT'la sahtedir).
//   tool install [--force] <istek> · tool list · tool dir [--bin] · tool uninstall <ad> · --version     SAHTE_UV_DUS=1 → kurulum düşer,
//   SAHTE_UV_BIN_DUS=1 → `tool dir --bin` düşer
// 0.10 Görev 7 (düzeltme turu 1): gerçek uv gibi — komut klasöründe bu ortama ait olmayan (makbuzu olmayan) graphify.exe varken `--force`
// yoksa "Executable already exists … (use `--force` to overwrite)" ile REDDEDER; ortam ve kısayol yerindeyse "already installed" der ve
// dokunmaz; ortam yerinde ama kısayol yoksa (en kötü varsayım) yine "already installed" der ve kısayolu YAZMAZ. `--force` hepsini yeniden yazar.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const kayit = process.env.FUBER_SAHTE_UV_KAYIT;
if (kayit) {
  try {
    fs.appendFileSync(kayit, `${JSON.stringify({ argv, cwd: process.cwd(), UV_TOOL_DIR: process.env.UV_TOOL_DIR, UV_TOOL_BIN_DIR: process.env.UV_TOOL_BIN_DIR, UV_PYTHON_INSTALL_DIR: process.env.UV_PYTHON_INSTALL_DIR, UV_CACHE_DIR: process.env.UV_CACHE_DIR, GRAPHIFY_QUERY_LOG_DISABLE: process.env.GRAPHIFY_QUERY_LOG_DISABLE })}\n`);
  } catch { /* en iyi çaba */ }
}
const ev = os.homedir();
// Güvenlik: sahte, gerçek ev klasörüne asla dosya koymaz (testte ev geçici: os.tmpdir() altında).
const geciciMi = (p) => path.resolve(p).toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase());
const araclar = process.env.UV_TOOL_DIR;
const bin = process.env.UV_TOOL_BIN_DIR || path.join(ev, '.local', 'bin');
if (!araclar || !geciciMi(araclar) || !geciciMi(bin)) { process.stderr.write(`sahte-uv: UV_TOOL_DIR/bin geçici klasörde değil (${araclar} · ${bin}) — yazılmaz\n`); process.exit(2); }
const makbuz = path.join(araclar, 'graphifyy', 'uv-receipt.json');

if (argv[0] === '--version') { process.stdout.write('uv 0.13.5 (sahte)\n'); process.exit(0); }
// SAHTE_UV_BIN_DUS=1 → komut klasörü okunamaz (Fuber PATH'teki bir graphify'ye düşmemeli).
if (argv[0] === 'tool' && argv[1] === 'dir') {
  if (argv.includes('--bin') && process.env.SAHTE_UV_BIN_DUS === '1') { process.stderr.write('error: sahte: komut klasörü okunamadı\n'); process.exit(1); }
  process.stdout.write(`${argv.includes('--bin') ? bin : araclar}\n`); process.exit(0);
}
if (argv[0] === 'tool' && argv[1] === 'list') {
  process.stdout.write(fs.existsSync(makbuz) ? 'graphifyy v0.9.95\n- graphify.exe\n' : 'No tools installed\n');
  process.exit(0);
}
if (argv[0] === 'tool' && argv[1] === 'install') {
  const secenekler = argv.slice(2).filter((a) => a.startsWith('-'));
  const istekler = argv.slice(2).filter((a) => !a.startsWith('-'));
  const istek = istekler[0];
  const force = secenekler.includes('--force');
  if (process.env.SAHTE_UV_DUS === '1') { process.stderr.write('error: sahte: paket çözümlenemedi\n'); process.exit(1); }
  const bilinmeyen = secenekler.filter((a) => a !== '--force');
  if (bilinmeyen.length || istekler.length !== 1) { process.stderr.write(`error: sahte uv yalnız [--force] <istek> kabul eder (gelen: ${argv.slice(2).join(' ')})\n`); process.exit(2); }
  if (istek !== 'graphifyy==0.9.95') { process.stderr.write(`error: sahte uv yalnız graphifyy==0.9.95 kurar (istenen: ${istek})\n`); process.exit(1); }
  const kisayol = path.join(bin, 'graphify.exe');
  const python = path.join(path.dirname(makbuz), 'Scripts', 'python.exe');
  if (!force && fs.existsSync(makbuz)) { process.stdout.write('`graphifyy==0.9.95` is already installed\n'); process.exit(0); }
  if (!force && fs.existsSync(kisayol)) { process.stderr.write('error: Executable already exists: graphify.exe (use `--force` to overwrite)\n'); process.exit(2); }
  fs.mkdirSync(path.dirname(python), { recursive: true });
  fs.writeFileSync(makbuz, JSON.stringify({ tool: { requirements: [{ name: 'graphifyy', specifier: '==0.9.95' }], entrypoints: [{ name: 'graphify', 'install-path': kisayol }] } }));
  fs.writeFileSync(python, 'SAHTE python — çalıştırılmaz\n');
  fs.mkdirSync(bin, { recursive: true });
  // Gerçek uv kısayolu gibi: içinde ortamın Python yolu (Fuber bununla "kısayol duruyor ama ortamı silinmiş" durumunu anlar).
  fs.writeFileSync(kisayol, `SAHTE graphify kalıbı — çalıştırılmaz\n${python}\n`);
  process.stdout.write(`Resolved 12 packages\n${force ? 'Replaced' : 'Installed'} 1 executable: graphify\n`);
  process.exit(0);
}
if (argv[0] === 'tool' && argv[1] === 'uninstall') {
  fs.rmSync(path.dirname(makbuz), { recursive: true, force: true });
  fs.rmSync(path.join(bin, 'graphify.exe'), { force: true });
  process.stdout.write(`Uninstalled 1 executable: graphify\n`);
  process.exit(0);
}
process.stderr.write(`sahte-uv: bilinmeyen komut ${argv.join(' ')}\n`);
process.exit(2);
