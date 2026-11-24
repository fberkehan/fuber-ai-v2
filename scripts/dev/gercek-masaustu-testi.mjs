// Gerçek masaüstünde fare/klavye/ekran doğrulaması — kullanıcıyı RAHATSIZ ETMEDEN: oturum kilitli değilse VE kullanıcı
// en az BOS_SN saniyedir fare/klavyeye dokunmadıysa paketli uygulamanın "Dene" öz-sınamasını BİR KEZ çalıştırır
// (kendi küçük penceresi; Fuber imleci oraya gider, tıklar; odak o pencerede değilse YAZMAZ). Kilit ekranı atlatılmaz.
// Çalıştır: node scripts/dev/gercek-masaustu-testi.mjs <çıktı-klasörü> [bos_sn=180]
import { KURULUM_SURUMU } from '../../src/shared/kurulum-adimlari.ts';
import { geciciEv, paketliTestExe } from '../paket-dogrula.mjs';
import { _electron as electron } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const kok = path.resolve(import.meta.dirname, '../..');
const cikti = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'fuber-gercek-masaustu'));
const BOS_SN = Number(process.argv[3] ?? 180);
// 0.12 H6: paketli exe = DAĞITILMAYAN test kopyası (dağıtılan exe'de --inspect sigortası kapalı); bayat kopyada durur (scripts/paket-dogrula.mjs).
const exe = paketliTestExe(process.env.FUBER_TEST_EXE, 'masaustu', { betik: 'gercek-masaustu-testi' });
fs.mkdirSync(cikti, { recursive: true });
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

const DURUM_PS = `Add-Type @'
using System; using System.Runtime.InteropServices;
public static class FuberBos { [StructLayout(LayoutKind.Sequential)] struct LII { public uint cbSize; public uint dwTime; }
[DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LII p);
public static uint Sn() { var l = new LII(); l.cbSize = (uint)Marshal.SizeOf(l); GetLastInputInfo(ref l); return ((uint)Environment.TickCount - l.dwTime) / 1000; } }
'@
"$([FuberBos]::Sn()) $([bool](Get-Process LogonUI -ErrorAction SilentlyContinue))"`;
const durum = () => {
  // Saatlerce beklerken PowerShell bir kez başlayamazsa (düşük bellekte 0xC0000142, 20 Eki) çökme: "aktif" say, beklemeye devam.
  try {
    const [bos, kilit] = execFileSync('powershell', ['-NoProfile', '-Command', DURUM_PS], { encoding: 'utf8' }).trim().split(/\s+/);
    return { bos: Number(bos), kilitli: kilit === 'True' };
  } catch { return { bos: 0, kilitli: false }; }
};

let son = '';
for (;;) {
  const d = durum();
  const satir = d.kilitli ? 'kilitli' : d.bos < BOS_SN ? 'kullanıcı aktif' : 'uygun';
  if (satir !== son) { console.log(`${new Date().toLocaleTimeString('tr-TR')} · ${satir} (boşta ${d.bos} sn)`); son = satir; }
  if (!d.kilitli && d.bos >= BOS_SN) break;
  await bekle(15000);
}

const veri = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-gercek-veri-'));
fs.writeFileSync(path.join(veri, 'ayarlar.json'), JSON.stringify({ kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: '0.9.0', kullaniciAdi: 'Test', hitap: 'Test', baslangictaAc: false, ses: { uyandirma: false, seslendirme: false } }));
const u = await electron.launch({ executablePath: exe, args: [], env: { ...process.env, ...geciciEv(veri), FUBER_VERI: veri }, timeout: 60000 });
let sonuc;
try {
  let w;
  for (let i = 0; i < 120 && !w; i++) { w = u.windows().find((x) => x.url().includes('index.html')); if (!w) await bekle(250); }
  await w.waitForSelector('.kokpit', { timeout: 30000 });
  const d = durum();
  if (d.kilitli || d.bos < BOS_SN) throw new Error(`son anda koşul bozuldu (kilitli=${d.kilitli}, boşta ${d.bos} sn) — sınama yapılmadı`);
  sonuc = await w.evaluate(() => window.fuber.cagir('bilgisayar:dene'));
} catch (h) {
  sonuc = { tamam: false, adimlar: [{ ad: 'HATA', tamam: false, ayrinti: h.message }] };
} finally {
  await u.close().catch(() => undefined);
  fs.rmSync(veri, { recursive: true, force: true });
}
fs.writeFileSync(path.join(cikti, 'sonuc.json'), JSON.stringify({ zaman: new Date().toISOString(), exe, ...sonuc }, null, 2));
for (const a of sonuc.adimlar) console.log(`${a.tamam ? '✅' : '❌'} ${a.ad} — ${a.ayrinti ?? ''}`);
console.log(sonuc.tamam ? 'GERÇEK MASAÜSTÜ ÖZ-SINAMASI GEÇTİ' : 'GERÇEK MASAÜSTÜ ÖZ-SINAMASI GEÇMEDİ');
process.exitCode = sonuc.tamam ? 0 : 1;
