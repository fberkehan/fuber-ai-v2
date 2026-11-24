// Yerel yardımcıları Windows'ta hazır gelen .NET Framework 4 derleyicisiyle (csc.exe) derler.
//  `node native/derle.mjs` → resources/bin/ (electron-builder resources/ klasörünü "kaynak" olarak paketler):
//   - fuber-girdi.exe: ekran görüntüsü + fare + klavye + pencereler (yalnız bilgisayar kontrolünde başlar; src/main/bilgisayar.ts).
//   (0.14 T22: eski salt okunur tam ekran yardımcısı kalktı; tam ekran ve sistem olayları aşağıdaki fuber-olay.exe'den, olay güdümlü.)
//  `node native/derle.mjs kurulum [çıktı.exe]` → kurulum başlatıcısı (Görev 17, native/fuber-kurulum), paketsiz geliştirme derlemesi.
//   Dağıtılan başlatıcıyı scripts/kurulum-paketle.mjs üretir (iç NSIS paketini gömerek; `npm run dist` sonunda). Başlatıcı
//   resources/bin'e GİRMEZ (uygulamayla paketlenmez).
//  `node native/derle.mjs olay` → resources/bin/fuber-olay.exe (0.14 T20, Ruling R1): olay güdümlü sistem olayları yardımcısı,
//   C++17 + C++/WinRT, MSVC ile (vswhere → vcvars64.bat → cl; Visual Studio Build Tools + Windows SDK gerekir). Derlenmiş exe depoya
//   girer; varsayılan hedef (boş) onu derlemez (C# derleyicisi her Windows'ta var, MSVC yok).
// Kaynaklar UTF-8 (Türkçe metinler): /codepage:65001. C# 5 (csc v4.0.30319).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CSC = 'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe';

/**
 * Bir C# programını derler; çıktı yolunu döner. `ekler`: ek csc seçenekleri (/resource:, /win32icon: …).
 * Yollar mutlak ters bölülü yapılır: csc göreli "a/b.cs" yolunu yanlış çözüyor.
 */
export function csDerle({ kaynaklar, cikti, ref = ['System.dll'], hedef = 'exe', ekler = [] }) {
  cikti = path.resolve(cikti);
  fs.mkdirSync(path.dirname(cikti), { recursive: true });
  execFileSync(CSC, ['/nologo', '/optimize+', '/codepage:65001', '/platform:anycpu', `/target:${hedef}`, `/out:${cikti}`,
    ...ref.map((r) => `/r:${r}`), ...ekler, ...kaynaklar.map((k) => path.resolve(k))], { stdio: 'inherit' });
  return cikti;
}

const YARDIMCILAR = [
  { ad: 'fuber-girdi', ref: ['System.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll', 'System.Web.Extensions.dll'] },
];

export function yardimcilariDerle() {
  for (const y of YARDIMCILAR) {
    const cikti = csDerle({ kaynaklar: [path.join(KOK, `native/${y.ad}/Program.cs`)], cikti: path.join(KOK, `resources/bin/${y.ad}.exe`), ref: y.ref });
    console.log('derlendi:', cikti, fs.statSync(cikti).size, 'bayt');
  }
}

/** FUBER kelime markası tek kaynaktan (src/shared/logo.ts): 1. satır viewBox, sonraki her satır bir SVG yolu. */
export function logoMetni() {
  const ts = fs.readFileSync(path.join(KOK, 'src/shared/logo.ts'), 'utf8');
  const vb = ts.match(/LOGO_VB\s*=\s*'([^']+)'/)?.[1];
  const blok = ts.match(/LOGO_YOLLAR[^=]*=\s*\[([\s\S]*?)\];/)?.[1];
  const yollar = blok ? [...blok.matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
  if (!vb || yollar.length === 0) throw new Error('src/shared/logo.ts içinden logo okunamadı');
  return [vb, ...yollar].join('\n');
}

/**
 * Fuber AI'nin F işareti (mini logo) tek kaynaktan (resources/ikon/kaynak/fuber-ai-mini.svg; uygulama ikonu ailesiyle aynı dosya, geometri
 * değiştirilmez): logo.txt ile aynı biçim — 1. satır viewBox, sonraki her satır bir SVG yolu.
 */
export function isaretMetni() {
  const svg = fs.readFileSync(path.join(KOK, 'resources/ikon/kaynak/fuber-ai-mini.svg'), 'utf8');
  const vb = svg.match(/viewBox="([^"]+)"/)?.[1].trim();
  const yollar = [...svg.matchAll(/<path\b[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
  if (!vb || yollar.length === 0) throw new Error('resources/ikon/kaynak/fuber-ai-mini.svg içinden F işareti okunamadı');
  return [vb, ...yollar].join('\n');
}

/**
 * Kurulum başlatıcısı (native/fuber-kurulum). `paket` verilirse içine "paket.exe" kaynağı olarak gömülür (iç NSIS paketi, ~176 MB;
 * başlatıcı onu akışla çıkarır). `bilgi`: surum, guid (electron-builder APP_GUID), urun, exe, klasor, boyut (kurulu bayt).
 */
export function kurulumDerle({ cikti, paket = null, bilgi = {} }) {
  const kl = path.join(KOK, 'native/fuber-kurulum');
  const is = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-kurulum-derle-'));
  try {
    const b = { surum: 'geliştirme', guid: '', urun: 'Fuber AI', exe: 'Fuber AI.exe', klasor: 'Fuber AI', boyut: 0, ...bilgi };
    const surumSayi = /^\d+\.\d+\.\d+/.test(b.surum) ? b.surum.match(/^\d+\.\d+\.\d+/)[0] + '.0' : '0.0.0.0';
    fs.writeFileSync(path.join(is, 'logo.txt'), logoMetni());
    fs.writeFileSync(path.join(is, 'isaret.txt'), isaretMetni());
    fs.writeFileSync(path.join(is, 'bilgi.txt'), Object.entries(b).map(([k, v]) => `${k}=${v}`).join('\n'));
    // Dosya özellikleri (Ayrıntılar sekmesi): ürün adı, sürüm, yayımlayan (proje adı).
    fs.writeFileSync(path.join(is, 'SurumBilgisi.cs'), [
      'using System.Reflection;',
      '[assembly: AssemblyTitle("Fuber AI Kurulum")]',
      '[assembly: AssemblyProduct("Fuber AI")]',
      '[assembly: AssemblyCompany("Fuber AI")]',
      '[assembly: AssemblyCopyright("© 2026 Fuber AI")]',
      `[assembly: AssemblyVersion("${surumSayi}")]`,
      `[assembly: AssemblyFileVersion("${surumSayi}")]`,
      `[assembly: AssemblyInformationalVersion("${b.surum}")]`,
      '',
    ].join('\n'));
    const kaynak = (dosya, ad) => `/resource:${dosya},${ad}`;
    // Kurulum ikonu (0.12; scripts/ikon-uret.mjs): uygulama karosu (mini logo) + sağ altta beyaz "indir" rozeti — exe'nin kendisi ve penceresi.
    const ikon = path.join(KOK, 'build/kurulum.ico');
    const ekler = [
      `/win32icon:${ikon}`,
      `/win32manifest:${path.join(kl, 'uygulama.manifest')}`,
      kaynak(path.join(is, 'logo.txt'), 'logo.txt'),
      kaynak(path.join(is, 'bilgi.txt'), 'bilgi.txt'),
      // Pencerenin sağındaki görsel: F işareti (vektör, her DPI'da keskin). Raster görsel gömülmez.
      kaynak(path.join(is, 'isaret.txt'), 'isaret.txt'),
      kaynak(ikon, 'ikon.ico'),
    ];
    if (paket) ekler.push(kaynak(paket, 'paket.exe'));
    const kaynaklar = ['Program.cs', 'Pencere.cs', 'Cizim.cs', 'Kurucu.cs'].map((f) => path.join(kl, f));
    kaynaklar.push(path.join(is, 'SurumBilgisi.cs'));
    return csDerle({ kaynaklar, cikti, ref: ['System.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll'], hedef: 'winexe', ekler });
  } finally {
    fs.rmSync(is, { recursive: true, force: true });
  }
}

// ── fuber-olay.exe (C++17 + C++/WinRT, MSVC) ──────────────────────────────────────────────────────────────────────────────────────
/** cl seçenekleri (brief): /MT statik CRT (VC++ dağıtılabilir paketi gerekmez), UTF-8 kaynak; /Brepro yeniden üretilebilir ikili. */
export const OLAY_CL = ['/nologo', '/std:c++17', '/EHsc', '/O2', '/MT', '/utf-8', '/DUNICODE', '/D_UNICODE', '/W3', '/Brepro'];
/** Bağlantı: brief listesi + shell32 (SHQueryUserNotificationState). Konsol alt sistemi: ana süreç `windowsHide` ile açar. */
export const OLAY_LINK = ['/SUBSYSTEM:CONSOLE', '/Brepro', 'windowsapp.lib', 'ole32.lib', 'oleaut32.lib', 'user32.lib', 'wbemuuid.lib', 'powrprof.lib', 'shell32.lib'];

/** vswhere ile x64 C++ araç takımlı Visual Studio'yu bulur; vcvars64.bat yolu. Yoksa ne eksik olduğunu söyleyen hata. */
export function vcvarsBul() {
  const vswhere = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (!fs.existsSync(vswhere)) throw new Error(`vswhere.exe yok (${vswhere}): Visual Studio Build Tools kurulu değil`);
  const kurulum = execFileSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' }).trim();
  if (!kurulum) throw new Error('vswhere: x64 C++ araç takımı (Microsoft.VisualStudio.Component.VC.Tools.x86.x64) kurulu değil');
  const vcvars = path.join(kurulum, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
  if (!fs.existsSync(vcvars)) throw new Error(`vcvars64.bat yok: ${vcvars}`);
  return { vcvars, vswhereKlasoru: path.dirname(vswhere) };
}

/**
 * native/fuber-olay/*.cpp → resources/bin/fuber-olay.exe. Geçici klasörde bir .cmd yazılır: vcvars64.bat ortamı kurar, cl derler ve bağlar
 * (ara .obj dosyaları geçici klasörde kalır). Yollar ortam değişkeniyle geçer (boşluklu ve Türkçe harfli klasörlerde tırnak sorunu yok).
 */
export function olayDerle({ cikti = path.join(KOK, 'resources/bin/fuber-olay.exe') } = {}) {
  cikti = path.resolve(cikti);
  const { vcvars, vswhereKlasoru } = vcvarsBul();
  const kaynak = path.join(KOK, 'native', 'fuber-olay');
  const dosyalar = fs.readdirSync(kaynak).filter((f) => f.endsWith('.cpp')).sort();
  if (dosyalar.length === 0) throw new Error('native/fuber-olay içinde .cpp yok');
  fs.mkdirSync(path.dirname(cikti), { recursive: true });
  const is = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-olay-derle-'));
  try {
    const betik = path.join(is, 'derle.cmd');
    fs.writeFileSync(betik, [
      '@echo off',
      'call "%FUBER_VCVARS%" >nul',
      'if errorlevel 1 exit /b 1',
      'cd /d "%FUBER_ARA%"',
      `cl ${OLAY_CL.join(' ')} ${dosyalar.map((f) => `"%FUBER_KAYNAK%\\${f}"`).join(' ')} /Fe"%FUBER_CIKTI%" /link ${OLAY_LINK.join(' ')}`,
      'exit /b %errorlevel%',
      '',
    ].join('\r\n'));
    // vcvars64.bat vswhere'i PATH'te arar: Installer klasörü başa eklenir (yoksa "vswhere.exe is not recognized" uyarısı basar).
    const yol = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'Path';
    execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', betik], {
      stdio: 'inherit',
      env: { ...process.env, [yol]: `${vswhereKlasoru};${process.env[yol] ?? ''}`, FUBER_VCVARS: vcvars, FUBER_ARA: is, FUBER_KAYNAK: kaynak, FUBER_CIKTI: cikti },
    });
  } finally {
    fs.rmSync(is, { recursive: true, force: true });
  }
  return cikti;
}

// Doğrudan çalıştırıldı mı (içe aktarılınca değil). Windows'ta sürücü harfi/klasör adı büyük-küçük farklı gelebilir.
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const [hedef, ...arg] = process.argv.slice(2);
  if (!hedef) yardimcilariDerle();
  else if (hedef === 'kurulum') {
    const surum = JSON.parse(fs.readFileSync(path.join(KOK, 'package.json'), 'utf8')).version;
    const cikti = kurulumDerle({ cikti: path.resolve(arg[0] ?? path.join(KOK, 'release/fuber-kurulum-gelistirme.exe')), bilgi: { surum } });
    console.log('derlendi:', cikti, fs.statSync(cikti).size, 'bayt (paketsiz; --onizleme / --kuru için)');
  } else if (hedef === 'olay') {
    const cikti = olayDerle(arg[0] ? { cikti: arg[0] } : {});
    const ozet = crypto.createHash('sha256').update(fs.readFileSync(cikti)).digest('hex');
    console.log('derlendi:', cikti, fs.statSync(cikti).size, 'bayt, sha256', ozet);
  } else {
    console.error('bilinmeyen hedef:', hedef, '(boş | kurulum | olay)');
    process.exit(64);
  }
}
