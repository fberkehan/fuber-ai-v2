// fuber-girdi.exe "kullanıcı devraldı mı?" protokolü — gerçek Windows girdi zamanıyla. Yardımcının KENDİ enjeksiyonu
// sayılmamalı, BAŞKA bir süreçten gelen girdi (kullanıcı yerine ikinci yardımcı) sayılmalı. Yalnız tek bir Shift
// basılır (zararsız). Oturum kilitliyse ya da kullanıcı son BOS_SN içinde dokunduysa bekler; kilit atlatılmaz.
// Çalıştır: node scripts/dev/devralma-yardimci-testi.mjs [bos_sn=60]
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';

const kok = path.resolve(import.meta.dirname, '../..');
const exe = path.join(kok, 'resources/bin/fuber-girdi.exe');
const BOS_SN = Number(process.argv[2] ?? 60);
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const DURUM_PS = `Add-Type @'
using System; using System.Runtime.InteropServices;
public static class FuberBos2 { [StructLayout(LayoutKind.Sequential)] struct LII { public uint cbSize; public uint dwTime; }
[DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LII p);
public static uint Sn() { var l = new LII(); l.cbSize = (uint)Marshal.SizeOf(l); GetLastInputInfo(ref l); return ((uint)Environment.TickCount - l.dwTime) / 1000; } }
'@
"$([FuberBos2]::Sn()) $([bool](Get-Process LogonUI -ErrorAction SilentlyContinue))"`;
const durum = () => {
  // Saatlerce beklerken PowerShell bir kez başlayamazsa (düşük bellekte 0xC0000142, 20 Eki) çökme: "aktif" say, beklemeye devam.
  try {
    const [bos, kilit] = execFileSync('powershell', ['-NoProfile', '-Command', DURUM_PS], { encoding: 'utf8' }).trim().split(/\s+/);
    return { bos: Number(bos), kilitli: kilit === 'True' };
  } catch { return { bos: 0, kilitli: false }; }
};

function yardimci() {
  const p = spawn(exe, [], { windowsHide: true });
  let tampon = '';
  const bekleyen = [];
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (d) => { tampon += d; let i; while ((i = tampon.indexOf('\n')) >= 0) { const s = tampon.slice(0, i).trim(); tampon = tampon.slice(i + 1); if (s) bekleyen.shift()?.(JSON.parse(s)); } });
  return { komut: (k) => new Promise((c) => { bekleyen.push(c); p.stdin.write(`${JSON.stringify(k)}\n`); }), kapat: () => p.kill() };
}

let son = '';
for (;;) {
  const d = durum();
  const satir = d.kilitli ? 'kilitli' : d.bos < BOS_SN ? 'kullanıcı aktif' : 'uygun';
  if (satir !== son) { console.log(`${new Date().toLocaleTimeString('tr-TR')} · ${satir} (boşta ${d.bos} sn)`); son = satir; }
  if (!d.kilitli && d.bos >= BOS_SN) break;
  await bekle(10000);
}

const a = yardimci(), b = yardimci();
const sonuclar = [];
const kaydet = (ad, tamam, ayrinti) => { sonuclar.push(tamam); console.log(`${tamam ? '✅' : '❌'} ${ad} — ${ayrinti}`); };
try {
  await a.komut({ k: 'referans' });
  await bekle(300);
  let r = await a.komut({ k: 'kullanici' });
  kaydet('Referanstan sonra girdi yok → dokunmadı', r.degdi === false, JSON.stringify(r));
  await a.komut({ k: 'tus', kombin: 'shift' });
  await bekle(400);
  r = await a.komut({ k: 'kullanici' });
  kaydet('Yardımcının KENDİ tuşu sayılmaz', r.degdi === false, JSON.stringify(r));
  await b.komut({ k: 'tus', kombin: 'shift' });
  await bekle(400);
  r = await a.komut({ k: 'kullanici' });
  kaydet('BAŞKA süreçten gelen girdi = kullanıcı → dokundu', r.degdi === true, JSON.stringify(r));
  await a.komut({ k: 'referans' });
  r = await a.komut({ k: 'kullanici' });
  kaydet('Yeni referanstan sonra temiz', r.degdi === false, JSON.stringify(r));
} finally {
  a.kapat(); b.kapat();
}
const k = sonuclar.filter((x) => !x).length;
console.log(`${sonuclar.length - k}/${sonuclar.length} geçti`);
process.exitCode = k ? 1 : 0;
