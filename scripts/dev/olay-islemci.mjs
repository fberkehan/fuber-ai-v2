#!/usr/bin/env node
// ═══ fuber-olay.exe işlemci ölçümü: eski ve yeni ikili YAN YANA (0.14 T28b; T28 incelemesi Important 3) ═══
// Uygulama açılmaz; yalnız yardımcılar. Aynı ölçüm penceresinde (aynı ön pencere, aynı kullanıcı girdisi, aynı sistem olayları) iki ikili birlikte çalışır:
//   · yeni: resources/bin/fuber-olay.exe (çalışma ağacı);
//   · eski: `--eski-rev <git sürümü>` (varsayılan 7827218, T28 birleşmesi) içindeki resources/bin/fuber-olay.exe, geçici klasöre çıkarılır; `--eski <yol>` da olur.
// İkisine de uygulamanın varsayılanı gönderilir: {"k":"klavye","acik":true} (Caps Lock ve dil uyarıları varsayılan açık: alçak düzey klavye kancası kurulu).
// Ayrıca scripts/dev/konum-sayaci.cpp (derlenir) ön pencerenin iş parçacığındaki konum olaylarını SAYAR: eski yardımcının kaç kez uyandığı.
// Ölçülen (her ikili için): işlemci süresi (Get-Process TotalProcessorTime; başta, 10 sn'lik dilimlerde, sonda), tek çekirdeğe göre yüzde; PID kararlılığı;
// sistem geneli yük (os.cpus); ön pencere (süreç adı, sınıf, tam ekran mı, Windows bildirim durumu — başlık OKUNMAZ); kullanıcının son girdisinden geçen süre
// (GetLastInputInfo; dilimde gerçek girdi oldu mu). Sonda stdin kapatılır: yeni ikili `sayac` satırını yazar (geri çağırma sayaçları).
// SENTETİK GİRDİ YOK: konum kancası ön pencerenin iş parçacığına bağlıdır, alçak düzey klavye kancası yalnız gerçek (ya da SendInput ile enjekte edilmiş)
// girdiyi görür. Başka bir pencereye bırakılan WM_MOUSEMOVE/WM_KEYDOWN iletileri ikisini de tetiklemez; SendInput ise kullanıcının girdi akışına karışır
// (yasak). Bu yüzden "etkin" ölçüm gerçek kullanım sırasında koşar: iki ikili aynı girdiyi görür, fark yalnız ikiliden gelir.
// Çalıştır: node scripts/dev/olay-islemci.mjs [--sn 120] [--eski-rev 7827218 | --eski <exe>] [--klavye-yok] [--cikti <klasör>]
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { vcvarsBul } from '../../native/derle.mjs';
import { olaySatiriAyristir, komutSatiri } from '../../src/shared/sistem-olay.ts';

const kok = path.resolve(import.meta.dirname, '../..');
const arg = (ad, varsayilan) => { const i = process.argv.indexOf(ad); return i > 0 ? process.argv[i + 1] : varsayilan; };
const SN = Number(arg('--sn', '120'));
const DILIM_MS = 10_000;
const KLAVYE = !process.argv.includes('--klavye-yok');
const ciktiKlasoru = path.resolve(arg('--cikti', path.join(kok, '.superpowers', '0.14', 'olay-islemci')));
fs.mkdirSync(ciktiKlasoru, { recursive: true });
const gecici = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-olay-islemci-'));
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const yuzde = (ms, sureMs) => Math.round((ms / sureMs) * 100 * 1000) / 1000;

// ── ikililer ──
const YENI = path.join(kok, 'resources/bin/fuber-olay.exe');
let ESKI = arg('--eski', null);
if (!ESKI) {
  const rev = arg('--eski-rev', '7827218');
  ESKI = path.join(gecici, `fuber-olay-${rev}.exe`);
  const r = spawnSync('git', ['show', `${rev}:resources/bin/fuber-olay.exe`], { cwd: kok, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' });
  if (r.status !== 0) { console.error(`git show ${rev} başarısız: ${r.stderr}`); process.exit(1); }
  fs.writeFileSync(ESKI, r.stdout);
}
function sayaciDerle() {
  const { vcvars, vswhereKlasoru } = vcvarsBul();
  const exe = path.join(gecici, 'konum-sayaci.exe');
  const cmd = path.join(gecici, 'derle.cmd');
  fs.writeFileSync(cmd, `@echo off\r\ncall "${vcvars}" >nul\r\ncd /d "${gecici}"\r\ncl /nologo /O2 /MT /utf-8 /DUNICODE /D_UNICODE "${path.join(kok, 'scripts/dev/konum-sayaci.cpp')}" /Fe"${exe}" /link /SUBSYSTEM:CONSOLE user32.lib\r\n`);
  const r = spawnSync('cmd.exe', ['/d', '/c', cmd], { encoding: 'utf8', env: { ...process.env, Path: `${vswhereKlasoru};${process.env.Path ?? process.env.PATH ?? ''}` } });
  if (r.status !== 0) { console.error(r.stdout + r.stderr); process.exit(1); }
  return exe;
}

// ── okuma yardımcıları (uygulamaya ve başka süreçlere dokunmaz; yalnız okur) ──
const cpuAn = () => os.cpus().map((c) => c.times);
const sistemYuku = (a, b) => {
  let mesgul = 0, toplam = 0;
  for (let i = 0; i < a.length; i++) {
    const d = (x) => b[i][x] - a[i][x];
    const t = d('user') + d('nice') + d('sys') + d('idle') + d('irq');
    toplam += t; mesgul += t - d('idle');
  }
  return toplam ? Math.round((mesgul / toplam) * 1000) / 10 : 0;
};
function surecSureleri(pidler) {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', `Get-Process -Id ${pidler.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id)=$($_.TotalProcessorTime.TotalMilliseconds)" }`], { encoding: 'utf8', windowsHide: true });
  return Object.fromEntries(String(r.stdout).split(/\r?\n/).filter(Boolean).map((x) => { const [a, b] = x.split('='); return [Number(a), Number(String(b).replace(',', '.'))]; }));
}
/** Ön pencere: süreç adı, sınıf, kutu, ekranı kaplıyor mu, bildirim durumu, son girdiden geçen ms. Pencere başlığı okunmaz. */
function onPencere() {
  const k = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; using System.Text; public static class On { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n); [StructLayout(LayoutKind.Sequential)] public struct R { public int L; public int T; public int Ri; public int B; } [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r); [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c); [DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int s); [StructLayout(LayoutKind.Sequential)] public struct L { public uint cb; public uint t; } [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref L l); }'
[void][On]::SetThreadDpiAwarenessContext([IntPtr](-4)); $h = [On]::GetForegroundWindow(); $p = 0; [void][On]::GetWindowThreadProcessId($h, [ref]$p); $s = New-Object Text.StringBuilder 128; [void][On]::GetClassNameW($h, $s, 128); $r = New-Object On+R; [void][On]::GetWindowRect($h, [ref]$r); $n = 0; [void][On]::SHQueryUserNotificationState([ref]$n); $l = New-Object On+L; $l.cb = 8; [void][On]::GetLastInputInfo([ref]$l)
$ad = (Get-Process -Id $p -ErrorAction SilentlyContinue).ProcessName; @{ surec = $ad; sinif = $s.ToString(); kutu = "$($r.L),$($r.T),$($r.Ri),$($r.B)"; bildirimDurumu = $n; bostaMs = [Environment]::TickCount - [int]$l.t } | ConvertTo-Json -Compress`;
  const r = spawnSync('powershell', ['-NoProfile', '-Command', k], { encoding: 'utf8', windowsHide: true });
  try { return JSON.parse(r.stdout); } catch { return null; }
}

// ── süreçler ──
function yardimciAc(ad, exe) {
  const c = spawn(exe, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  const y = { ad, exe, c, pid: c.pid, satirlar: [], sayac: null, cikis: null, hazir: null };
  y.hazir = new Promise((coz) => {
    readline.createInterface({ input: c.stdout }).on('line', (ham) => {
      const o = olaySatiriAyristir(ham);
      if (o?.t === 'hazir') coz(true);
      if (o?.t === 'sayac') y.sayac = o.sayaclar;
      if (o && o.t !== 'medya' && o.t !== 'durum' && o.t !== 'dil') y.satirlar.push(o.t === 'tam-ekran' ? `tam-ekran ${o.acik}` : o.t);
    });
    setTimeout(() => coz(false), 15_000);
  });
  c.on('exit', (kod) => { y.cikis = kod; });
  return y;
}

const sayaciExe = sayaciDerle();
const yardimcilar = [yardimciAc('eski', ESKI), yardimciAc('yeni', YENI)];
const sayac = spawn(sayaciExe, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
let sayacSonuc = null;
readline.createInterface({ input: sayac.stdout }).on('line', (ham) => { try { const v = JSON.parse(ham); if ('konum' in v) sayacSonuc = v; } catch { /* yok */ } });
try {
  for (const y of yardimcilar) if (!(await y.hazir)) throw new Error(`${y.ad}: hazir gelmedi`);
  if (KLAVYE) for (const y of yardimcilar) y.c.stdin.write(komutSatiri({ k: 'klavye', acik: true }));
  await bekle(2000); // açılış işi (WMI, medya) bitsin
  const pidler = yardimcilar.map((y) => y.pid);
  const onBas = onPencere();
  const t0 = Date.now(), cpu0 = cpuAn(), sure0 = surecSureleri(pidler);
  const dilimler = [];
  let oncekiSure = sure0, oncekiCpu = cpu0;
  console.log(`${SN} sn ölçülüyor (eski pid ${pidler[0]}, yeni pid ${pidler[1]}, klavye ${KLAVYE ? 'açık' : 'kapalı'}); ön pencere: ${onBas?.surec} / ${onBas?.sinif}, bildirim ${onBas?.bildirimDurumu}`);
  while (Date.now() - t0 < SN * 1000) {
    await bekle(Math.min(DILIM_MS, SN * 1000 - (Date.now() - t0)));
    const s = surecSureleri(pidler), c = cpuAn(), on = onPencere();
    dilimler.push({
      sn: Math.round((Date.now() - t0) / 1000), yuk: sistemYuku(oncekiCpu, c), on: on && { surec: on.surec, sinif: on.sinif, bildirim: on.bildirimDurumu },
      kullaniciGirdisi: on ? on.bostaMs < DILIM_MS : null,
      eskiMs: s[pidler[0]] !== undefined ? Math.round(s[pidler[0]] - oncekiSure[pidler[0]]) : null, yeniMs: s[pidler[1]] !== undefined ? Math.round(s[pidler[1]] - oncekiSure[pidler[1]]) : null,
    });
    oncekiSure = s; oncekiCpu = c;
    const d = dilimler.at(-1);
    console.log(`  ${String(d.sn).padStart(4)} sn  yük %${d.yuk}  eski ${d.eskiMs} ms  yeni ${d.yeniMs} ms  girdi ${d.kullaniciGirdisi ? 'var' : 'yok'}  ön ${d.on?.surec}`);
  }
  const sureMs = Date.now() - t0;
  const sure1 = surecSureleri(pidler), cpu1 = cpuAn(), onSon = onPencere();
  const pidKararli = yardimcilar.every((y) => y.cikis === null && sure1[y.pid] !== undefined);
  for (const y of yardimcilar) y.c.stdin.end();
  sayac.stdin.end();
  for (let i = 0; i < 40 && (yardimcilar.some((y) => y.cikis === null) || !sayacSonuc); i++) await bekle(50);
  const sonuc = {
    zaman: new Date().toISOString(), sn: Math.round(sureMs / 1000), klavye: KLAVYE, sistemYuku: sistemYuku(cpu0, cpu1), cekirdek: os.cpus().length,
    onBas, onSon, pidKararli, kullaniciGirdisiOlanDilim: dilimler.filter((d) => d.kullaniciGirdisi).length, dilimSayisi: dilimler.length,
    eski: { exe: path.basename(ESKI), pid: pidler[0], islemciMs: Math.round(sure1[pidler[0]] - sure0[pidler[0]]), yuzde: yuzde(sure1[pidler[0]] - sure0[pidler[0]], sureMs), satirlar: yardimcilar[0].satirlar, cikis: yardimcilar[0].cikis },
    yeni: { exe: 'resources/bin/fuber-olay.exe', pid: pidler[1], islemciMs: Math.round(sure1[pidler[1]] - sure0[pidler[1]]), yuzde: yuzde(sure1[pidler[1]] - sure0[pidler[1]], sureMs), sayac: yardimcilar[1].sayac, satirlar: yardimcilar[1].satirlar, cikis: yardimcilar[1].cikis },
    konumOlayi: sayacSonuc && { ...sayacSonuc, saniyede: Math.round((sayacSonuc.konum / (sureMs / 1000)) * 10) / 10 },
    dilimler,
  };
  const dosya = path.join(ciktiKlasoru, `olcum-${sonuc.zaman.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(dosya, JSON.stringify(sonuc, null, 2));
  console.log(`\nsistem yükü %${sonuc.sistemYuku} (${sonuc.cekirdek} çekirdek); PID kararlı: ${pidKararli}; gerçek girdili dilim ${sonuc.kullaniciGirdisiOlanDilim}/${sonuc.dilimSayisi}`);
  console.log(`eski: ${sonuc.eski.islemciMs} ms = %${sonuc.eski.yuzde} (tek çekirdek)`);
  console.log(`yeni: ${sonuc.yeni.islemciMs} ms = %${sonuc.yeni.yuzde} (tek çekirdek); sayaç ${JSON.stringify(sonuc.yeni.sayac)}`);
  console.log(`konum olayı (eski yardımcının uyanma kaynağı): ${JSON.stringify(sonuc.konumOlayi)}`);
  console.log(`yazıldı: ${dosya}`);
} finally {
  for (const y of yardimcilar) if (y.cikis === null) { try { y.c.kill(); } catch { /* yok */ } }
  try { sayac.kill(); } catch { /* yok */ }
  try { execFileSync('cmd.exe', ['/d', '/c', 'rmdir', '/s', '/q', gecici], { windowsHide: true }); } catch { /* geçici */ }
}
