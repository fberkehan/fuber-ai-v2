#!/usr/bin/env node
// ═══ Boşta işlemci ve kare süresi ölçümü (0.14 T28; spec: hafiflik, 60 fps) ═══
// Uygulama ARKA PLAN KİPİNDE açılır (FUBER_DEMO: pencereler saydamlık 0, tıklamayı geçirir, odak mantıksal; FUBER_GORUNUR ASLA; gerçek fare ve klavye yok).
// Olay yardımcısı GERÇEK `resources/bin/fuber-olay.exe`'dir (FUBER_OLAY_KOMUT ve FUBER_TEST_TAM_EKRAN verilmez: ölçülen, gerçek kullanımda çalışacak ikilidir).
//   1) Boşta (Playwright YOK): uygulama doğrudan `--gizli` ile açılır (tepsiden başlangıç: ana pencere hiç gösterilmez, yalnız çentik durur). Playwright ya da
//      açık bir DevTools oturumu ölçüme karışır: bağlı CDP istemcisi gizli ana pencereyi "görünür" tutar ve onun işleyicisi ile GPU süreci her saniye çalışır
//      (T28 tanısı: Playwright altında gizli ana pencere ~30 ms/sn işleyici + ~40 ms/sn GPU; pencere yok edilince GPU ~1 ms/sn). Bu yüzden ölçüm penceresi
//      boyunca uygulamaya HİÇBİR şey bağlanmaz: yalnız `--remote-debugging-port` açıktır, ölçümden önce ve sonra TEK bir Runtime.evaluate ile karakterin
//      uyuduğu doğrulanır (60 sn gerçek saat beklenir; uygulama kodu değişmez).
//      İşlemci süreleri işletim sisteminden (Win32_Process ağacı + Get-Process TotalProcessorTime) pencere başında ve sonunda okunur: GPU süreci
//      (--type=gpu-process), her işleyici (--type=renderer; çentik arayüzü bunlardan biridir — sınır EN YÜKSEK işleyiciye uygulanır, toplam da yazılır), ana süreç,
//      `fuber-olay.exe`. Yüzde TEK ÇEKİRDEĞE göredir (işlemci saniyesi / duvar saniyesi × 100; Görev Yöneticisi'nin makine geneli yüzdesinden çekirdek sayısı
//      kadar sıkı); makine geneli de yazılır. Ardından 15 sn CDP ekran yayını: yayın yalnız ekran değişince kare verir — boşta çizim yoksa kare gelmez.
//   2) Kare süresi (Playwright ile ayrı açılış): panel açılışı (imleç CDP ile şekle girer) ve sayfa geçişleri (hover'la açık panelde nokta ve ok tıklaması)
//      sırasında, YALNIZ ölçüm süresince, sayfaya kurulan requestAnimationFrame kaydedicisi damgaları toplar; ardışık damga farklarının p95'i.
// Geçme (T28): çentik arayüz süreci ortalama ≤ %0,3, GPU süreci ≤ %0,3, fuber-olay.exe ≤ %0,1, kare süresi p95 ≤ 17 ms, boşta yayın karesi 0.
// Makine yükü: sistem geneli işlemci (os.cpus() zaman farkı) her koşunun başında, ölçüm penceresi boyunca (5 sn'lik dilimler) ve sonunda yazılır; aynı dilimlerde
// GPU, işleyiciler ve fuber-olay.exe'nin işlemci süresi (Get-Process) ve koşu başında/sonunda ön plandaki pencere (süreç, sınıf, Windows bildirim durumu).
// Karar (T28 düzeltme turu 3; ayrıntı karar kuralının yanında): yüzü olan ve uyumayan koşu her yükte DÜŞTÜ; GEÇTİ için yük eşiğinin (%25) altında, geçerli
// (tam ekran/gizli değil, yardımcı yenilenmemiş) ve yüzün uyuduğu bir koşu gerekir; yoksa KARARSIZ (çıkış kodu 2). Karar yoksa 60 sn sonra yeniden (en çok 4 koşu).
// Çalıştır: npm run build && node scripts/dev/bosta-islemci.mjs [çıktı-klasörü]   (varsayılan: <depo>/.superpowers/0.14/centik; olcum.json'un `bosta` bölümü) · FUBER_BOSTA_MOD=gelistirici: Developer modu (Odak gözleri; 12 Kas)
import { _electron as electron } from 'playwright-core';
import electronYolu from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { KURULUM_SURUMU } from '../../src/shared/kurulum-adimlari.ts';
import { soyAgaci, tamEkranYaDaGizli } from './surec-agaci.mjs';

if (process.env.FUBER_GORUNUR) { console.error('DUR: FUBER_GORUNUR ayarlı; bu betik yalnız arka plan kipinde koşar.'); process.exit(1); }
const kok = path.resolve(import.meta.dirname, '../..');
if (!fs.existsSync(path.join(kok, 'dist', 'main', 'main.js'))) { console.error('dist yok: önce npm run build'); process.exit(1); }
// Bayat dist koruması: ölçüm dist/'i çalıştırır; kaynak dist'ten yeniyse sonuç eski koddur (0.17: 30a24ad2 düzeltmesi dist'e girmediği için sahte "1441 kare" çıktı).
{
  const enYeni = (d) => { let m = 0; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const y = path.join(d, e.name); m = Math.max(m, e.isDirectory() ? enYeni(y) : fs.statSync(y).mtimeMs); } return m; };
  const kaynak = Math.max(enYeni(path.join(kok, 'src')), fs.statSync(path.join(kok, 'package.json')).mtimeMs);
  const derleme = Math.min(enYeni(path.join(kok, 'dist', 'renderer')), enYeni(path.join(kok, 'dist', 'main')));
  if (kaynak > derleme && !process.env.FUBER_BOSTA_BAYAT_OK) { console.error('DUR: dist kaynaktan eski; önce npm run build (yoksa ölçüm eski kodu ölçer). Yok saymak için FUBER_BOSTA_BAYAT_OK=1.'); process.exit(1); }
}
if (!fs.existsSync(path.join(kok, 'resources', 'bin', 'fuber-olay.exe'))) { console.error('resources/bin/fuber-olay.exe yok'); process.exit(1); }
const cikti = path.resolve(process.argv[2] ?? path.join(kok, '.superpowers', '0.14', 'centik'));
fs.mkdirSync(cikti, { recursive: true });
const SINIR = { ui: 0.3, gpu: 0.3, olay: 0.1, p95: 17 };
const OLCUM_MS = 120_000;
const DILIM_MS = 5000;
const YUK_ESIGI = 25;
const EN_COK_KOSU = 4;
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const yuzde = (x) => Math.round(x * 1000) / 1000;

// ── Sistem yükü: os.cpus() zamanları (yerelleştirilmiş başarım sayacı adı gerekmez) ──
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
const anlikYuk = async (ms = 2000) => { const a = cpuAn(); await bekle(ms); return sistemYuku(a, cpuAn()); };
const enMesgul = () => {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', 'Get-Process | Sort-Object CPU -Descending | Select-Object -First 6 Name,Id,CPU | ConvertTo-Json -Compress'], { encoding: 'utf8', windowsHide: true });
  try { return JSON.parse(r.stdout).map((p) => `${p.Name}(${Math.round(p.CPU)} sn)`); } catch { return []; }
};

/** Kök süreçten inen bütün süreçler: kimlik, ad, tür (--type=…), toplam işlemci süresi (ms). Tek PowerShell çağrısı (uygulamaya dokunmaz). */
// T28b: ağaç JS'te (surec-agaci.mjs) kurulur; ebeveyn kimliği yeniden kullanılmış yabancı süreç (ebeveynden önce oluşmuş; T28b'de Discord) alınmaz.
function surecAgaci(kokPid) {
  const liste = `Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; olusma = if ($_.CreationDate) { [long]($_.CreationDate.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds } else { $null } } } | ConvertTo-Json -Compress`;
  const r0 = spawnSync('powershell', ['-NoProfile', '-Command', liste], { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  let tum;
  try { tum = JSON.parse(r0.stdout); } catch { return []; }
  const pidler = soyAgaci(Array.isArray(tum) ? tum : [tum], Number(kokPid)).map((p) => p.pid);
  if (!pidler.length) return [];
  const k = `$kume = @{ ${pidler.map((p) => `${p} = $true`).join('; ')} }
Get-CimInstance Win32_Process | Where-Object { $kume.ContainsKey([int]$_.ProcessId) } | ForEach-Object { $g = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; $tur = if ($_.CommandLine -match '--type=([a-z-]+)') { $Matches[1] } else { '' }
  [pscustomobject]@{ pid = [int]$_.ProcessId; ad = $_.Name; tur = $tur; ms = if ($g) { $g.TotalProcessorTime.TotalMilliseconds } else { $null } } } | ConvertTo-Json -Compress`;
  const r = spawnSync('powershell', ['-NoProfile', '-Command', k], { encoding: 'utf8', windowsHide: true });
  try { const j = JSON.parse(r.stdout); return Array.isArray(j) ? j : [j]; } catch { return []; }
}
/** Verilen süreçlerin toplam işlemci süresi (ms; Get-Process, tek çağrı). Ölçüm penceresinin 5 sn'lik dilimlerinde: hangi dilimde hangi süreç çalıştı (T28 düzeltme
 *  turu 1: GPU'nun açıklanamayan 750 ms'si gibi patlamaların sistem yüküyle aynı dilime düşüp düşmediği görülsün). Uygulamaya dokunmaz. */
function surecSureleri(pidler) {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', `Get-Process -Id ${pidler.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id)=$($_.TotalProcessorTime.TotalMilliseconds)" }`], { encoding: 'utf8', windowsHide: true });
  return Object.fromEntries(String(r.stdout).split(/\r?\n/).filter(Boolean).map((x) => { const [a, b] = x.split('='); return [Number(a), Number(String(b).replace(',', '.'))]; }));
}
/** Ön plandaki pencere: süreç adı, sınıf, tam ekranı kaplıyor mu (yalnız okur). Düşen koşuya "yük" yerine bu iliştirilir (inceleme Important 4). */
function onPencere() {
  const k = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; using System.Text; public static class On { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n); [StructLayout(LayoutKind.Sequential)] public struct R { public int L; public int T; public int Ri; public int B; } [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r); [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c); [DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int s); }'
[void][On]::SetThreadDpiAwarenessContext([IntPtr](-4)); $h = [On]::GetForegroundWindow(); $p = 0; [void][On]::GetWindowThreadProcessId($h, [ref]$p); $s = New-Object Text.StringBuilder 128; [void][On]::GetClassNameW($h, $s, 128); $r = New-Object On+R; [void][On]::GetWindowRect($h, [ref]$r); $n = 0; [void][On]::SHQueryUserNotificationState([ref]$n)
$ad = (Get-Process -Id $p -ErrorAction SilentlyContinue).ProcessName; @{ surec = $ad; sinif = $s.ToString(); kutu = "$($r.L),$($r.T),$($r.Ri),$($r.B)"; bildirimDurumu = $n } | ConvertTo-Json -Compress`;
  const r = spawnSync('powershell', ['-NoProfile', '-Command', k], { encoding: 'utf8', windowsHide: true });
  try { return JSON.parse(r.stdout); } catch { return null; }
}
const bosKapi = () => new Promise((coz) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => coz(p)); }); });

/** En küçük CDP istemcisi (yalnız ölçümden önce/sonra; Node'un yerleşik WebSocket'i). */
async function cdpBaglan(port, urlParcasi) {
  for (let i = 0; i < 120; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const s = l.find((x) => x.type === 'page' && x.url.includes(urlParcasi));
      if (s) {
        const ws = new WebSocket(s.webSocketDebuggerUrl);
        await new Promise((coz, red) => { ws.onopen = coz; ws.onerror = red; });
        let no = 0;
        const bekleyen = new Map();
        const dinleyici = [];
        ws.onmessage = (m) => { const v = JSON.parse(m.data); if (v.id && bekleyen.has(v.id)) { bekleyen.get(v.id)(v); bekleyen.delete(v.id); } else if (v.method) for (const f of dinleyici) f(v); };
        const gonder = (method, params = {}) => new Promise((coz) => { const id = ++no; bekleyen.set(id, coz); ws.send(JSON.stringify({ id, method, params })); });
        const degerlendir = async (ifade) => (await gonder('Runtime.evaluate', { expression: ifade, returnByValue: true })).result?.result?.value;
        return { gonder, degerlendir, olay: (f) => dinleyici.push(f), kapat: () => ws.close() };
      }
    } catch { /* henüz açılmadı */ }
    await bekle(500);
  }
  throw new Error(`${urlParcasi} sayfası CDP'de bulunamadı`);
}

function profilYap({ sahteOlay = false } = {}) {
  const veri = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-bosta-'));
  fs.mkdirSync(path.join(veri, 'belgeler'), { recursive: true });
  fs.writeFileSync(path.join(veri, 'ayarlar.json'), JSON.stringify({
    kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: '0.9.0', kullaniciAdi: 'Deniz', hitap: 'Deniz', baslangictaAc: false, mod: process.env.FUBER_BOSTA_MOD === 'gelistirici' ? 'gelistirici' : 'is',
    ses: { uyandirma: false, seslendirme: false }, proaktif: { etkin: false, sessizBaslangic: '00:00', sessizBitis: '00:00' }, gorunum: { tema: 'koyu', adaSessiz: true },
  }));
  const ortam = Object.fromEntries(Object.entries(process.env).filter(([x]) => !x.startsWith('FUBER_SIR_') && !['FUBER_GORUNUR', 'FUBER_OLAY_KOMUT', 'FUBER_TEST_TAM_EKRAN'].includes(x)));
  Object.assign(ortam, { FUBER_DEMO: '1', FUBER_VERI: veri, FUBER_BELGELER: path.join(veri, 'belgeler'), FUBER_BILGISAYAR_ADI: 'DENIZ-PC', FUBER_TEST_ANA_ONDE: '0' });
  // Kare ölçümü geliştirme bilgisayarındaki tam ekran uygulamalara bağlı olmasın: sahte olay yardımcısı + sabit "tam ekran yok". Gerçek tam ekranda çentik doğru olarak
  // gizlenir ve hiç kare gelmez (T28'de böyle görüldü).
  if (sahteOlay) Object.assign(ortam, { FUBER_TEST_TAM_EKRAN: '0', FUBER_OLAY_KOMUT: JSON.stringify([process.execPath, path.join(kok, 'scripts', 'dev', 'sahte-olay.mjs')]) });
  return { veri, ortam };
}
const agaciKapat = (pid) => spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });

// ── 1) Boşta ölçüm ──
async function bostaOlc(k) {
  const { veri, ortam } = profilYap();
  const port = await bosKapi();
  const p = spawn(electronYolu, [`--remote-debugging-port=${port}`, kok, '--gizli'], { env: ortam, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  k.olayGunlugu = [];
  for (const akis of [p.stdout, p.stderr]) akis.on('data', (b) => { for (const s of String(b).split('\n')) if (/\[olay\]|fuber-olay/.test(s)) k.olayGunlugu.push(s.trim().slice(0, 300)); });
  let c = null;
  try {
    c = await cdpBaglan(port, 'asistan.html');
    // Uyku: ilk girdisizlikten 60 sn. Bekleme boyunca uygulamaya bağlanılmaz; 65 sn sonra bir kez bakılır, uyumadıysa 2 sn'de bir (en çok 30 sn).
    c.kapat(); c = null;
    const t0 = Date.now();
    await bekle(65_000);
    c = await cdpBaglan(port, 'asistan.html');
    // Boşta hâl (T28 düzeltme turu 3, yeniden inceleme 2 N1): yüz varsa (dinlenme) uyumuş olmalı; uyumadıysa koşu DÜŞER — yük ne olursa olsun (60 sn'lik saat yüke
    // bağlı değildir). Yüz yoksa (Kapalı hap: medya çalıyor) uyku denetimi UYGULANMAZ (null): geçti sayılmaz; işlemci, GPU ve çizim yine ölçülür.
    const BOSTA = "(() => { const a = document.querySelector('.ada'); const yuz = document.querySelector('.centik-yuz svg.gozler'); return { hal: a?.dataset.adaHal, yuz: Boolean(yuz), uyuyor: Boolean(yuz?.hasAttribute('data-uyuyor')), gorunurluk: document.visibilityState }; })()";
    const bostaMi = (h) => h && (h.uyuyor || (!h.yuz && h.hal === 'sessiz'));
    while (!bostaMi(await c.degerlendir(BOSTA)) && Date.now() - t0 < 200_000) await bekle(2000);
    k.uykuSn = Math.round((Date.now() - t0) / 1000);
    k.halOnce = await c.degerlendir(BOSTA);
    // Karar (b): Windows tam ekran/sunu bildiriyorsa (QUNS 2, 3, 4) ya da sayfa gizliyse görünür boştaki çentik ölçülemez — ölçülmez, "kararsız (tam ekran/gizli)".
    const onBas = onPencere();
    if (tamEkranYaDaGizli(onBas?.bildirimDurumu, k.halOnce?.gorunurluk)) {
      k.gecersiz = `tam ekran/gizli: Windows bildirim durumu ${onBas?.bildirimDurumu ?? '?'} (2 meşgul/tam ekran, 3 Direct3D tam ekran, 4 sunu), sayfa ${k.halOnce?.gorunurluk ?? '?'}, ön pencere ${onBas?.surec ?? '?'}`;
      k.onPencere = { bas: onBas };
      return;
    }
    if (!bostaMi(k.halOnce)) { k.uyku = false; k.uykuYok = `karakter ${k.uykuSn} sn içinde uyumadı (son girdiden 60 sn beklenir): ${JSON.stringify(k.halOnce)}`; return; }
    k.uyku = k.halOnce.uyuyor ? true : null;
    k.bostaHal = k.halOnce.uyuyor ? 'dinlenme, karakter uyuyor' : 'Kapalı hap (medya çalıyor; yüz yok): uyku denetimi uygulanmadı';
    c.kapat(); c = null; // ölçüm boyunca bağlı istemci yok
    await bekle(3000);
    k.onPencere = { bas: onPencere() };
    const agacBas = surecAgaci(p.pid);
    const izlenen = agacBas.filter((x) => x.tur === 'gpu-process' || x.ad === 'fuber-olay.exe' || x.tur === 'renderer');
    const cpuBas = cpuAn();
    const duvarBas = Date.now();
    const dilimler = [];
    const surecDilimleri = [];
    let son = cpuAn();
    let sonSure = surecSureleri(izlenen.map((x) => x.pid));
    while (Date.now() - duvarBas < OLCUM_MS) {
      await bekle(DILIM_MS);
      const s = cpuAn(); dilimler.push(sistemYuku(son, s)); son = s;
      const t = surecSureleri(izlenen.map((x) => x.pid));
      const fark = (f) => Math.round(izlenen.filter(f).reduce((a, x) => a + ((t[x.pid] ?? 0) - (sonSure[x.pid] ?? 0)), 0));
      surecDilimleri.push({ gpu: fark((x) => x.tur === 'gpu-process'), olay: fark((x) => x.ad === 'fuber-olay.exe'), isleyici: fark((x) => x.tur === 'renderer') });
      sonSure = t;
    }
    const agacSon = surecAgaci(p.pid);
    k.onPencere.son = onPencere();
    // N2 (yeniden inceleme 2): fuber-olay.exe ölçüm penceresinde yeniden açıldıysa (kimlik değişti, kayboldu ya da bir dilim eksi) koşu GEÇERSİZ; yardımcının
    // denetçisinin günlük satırları (çıkış kodu, açık kalma süresi; src/main/olay-yardimcisi.ts) iliştirilir. Kök neden T28b'de.
    const olayPid = (l) => l.filter((x) => x.ad === 'fuber-olay.exe').map((x) => x.pid);
    k.olayPid = { bas: olayPid(agacBas), son: olayPid(agacSon) };
    const eksiDilim = surecDilimleri.some((x) => x.olay < 0 || x.gpu < 0 || x.isleyici < 0);
    if (JSON.stringify(k.olayPid.bas) !== JSON.stringify(k.olayPid.son) || k.olayPid.bas.length !== 1 || eksiDilim) {
      k.yardimciYenilendi = `yardımcı yeniden açıldı: fuber-olay kimliği başta ${k.olayPid.bas.join(',') || 'yok'}, sonda ${k.olayPid.son.join(',') || 'yok'}${eksiDilim ? ', eksi dilim' : ''}; denetçi günlüğü: ${k.olayGunlugu.join(' | ') || '(satır yok)'}`;
    }
    k.surecDilimleri = surecDilimleri;
    const duvarSn = (Date.now() - duvarBas) / 1000;
    k.sistemYuku.olcum = sistemYuku(cpuBas, cpuAn());
    k.sistemYuku.dilimler = dilimler;
    const cekirdek = os.cpus().length;
    k.cekirdek = cekirdek;
    k.duvarSn = Math.round(duvarSn * 10) / 10;
    k.surecler = agacSon.map((s) => {
      const a = agacBas.find((x) => x.pid === s.pid);
      const ms = a && a.ms != null && s.ms != null ? Math.round(s.ms - a.ms) : null;
      return { pid: s.pid, ad: s.ad, tur: s.tur || (s.ad === 'fuber-olay.exe' ? 'olay' : 'ana'), islemciMs: ms, cekirdekYuzde: ms == null ? null : yuzde((ms / 1000 / duvarSn) * 100) };
    });
    const tur = (t) => k.surecler.filter((s) => s.tur === t && s.islemciMs != null);
    const ozet = (l) => { const ms = l.reduce((t, s) => t + s.islemciMs, 0); return { islemciMs: ms, cekirdekYuzde: yuzde((ms / 1000 / duvarSn) * 100), makineYuzde: yuzde((ms / 1000 / duvarSn) * 100 / cekirdek) }; };
    const isleyiciler = tur('renderer').sort((a, b) => b.islemciMs - a.islemciMs);
    if (k.yardimciYenilendi) return; // geçersiz koşu: değerler ölçüm sayılmaz (dilimler ve süreçler kayıtta kalır)
    if (!isleyiciler.length || !tur('gpu-process').length || !tur('olay').length) throw new Error(`süreç ağacı eksik: ${JSON.stringify(k.surecler)}`);
    k.ui = { ...ozet(isleyiciler.slice(0, 1)), isleyiciSayisi: isleyiciler.length, toplam: ozet(isleyiciler), tanim: 'en yüksek işleyici (çentik arayüzü bunlardan biri)' };
    k.gpu = ozet(tur('gpu-process'));
    k.olay = ozet(tur('olay'));
    k.anaSurec = ozet(tur('ana'));
    // Sonra: hâlâ uyuyor mu, 15 sn ekran yayını (kare yalnız değişimde).
    c = await cdpBaglan(port, 'asistan.html');
    k.halSonra = await c.degerlendir(BOSTA);
    // T28b: tam ekran ölçüm SIRASINDA başladıysa (ör. Ekran Alıntısı Aracı'nın kaplaması, bildirim durumu 2) çentik doğru olarak gizlenir ve gizlenme kare verir:
    // koşu da kararsız (tam ekran/gizli) sayılır, yalnız başta değil.
    if (!k.gecersiz && tamEkranYaDaGizli(k.onPencere.son?.bildirimDurumu, k.halSonra?.gorunurluk)) {
      k.gecersiz = `tam ekran/gizli ölçüm sırasında başladı: sonda Windows bildirim durumu ${k.onPencere.son?.bildirimDurumu ?? '?'}, sayfa ${k.halSonra?.gorunurluk ?? '?'}, ön pencere ${k.onPencere.son?.surec ?? '?'}`;
    }
    let kare = 0;
    c.olay((v) => { if (v.method === 'Page.screencastFrame') { kare++; void c.gonder('Page.screencastFrameAck', { sessionId: v.params.sessionId }); } });
    await c.gonder('Page.startScreencast', { format: 'jpeg', quality: 50, everyNthFrame: 1 });
    await bekle(1500);
    const acilis = kare;
    await bekle(15_000);
    await c.gonder('Page.stopScreencast');
    k.bostaCizim = { sureSn: 15, kare: kare - acilis, acilisKaresi: acilis };
  } finally {
    try { c?.kapat(); } catch { /* kapalı */ }
    agaciKapat(p.pid);
    await bekle(1000);
    try { fs.rmSync(veri, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* kilitli */ }
  }
}

// ── 2) Kare süresi ──
async function kareOlc(k) {
  const { veri, ortam } = profilYap({ sahteOlay: true });
  let u = null;
  try {
    u = await electron.launch({ executablePath: electronYolu, args: [kok], env: ortam, timeout: 60000 });
    const pencere = async (ad) => { for (let i = 0; i < 160; i++) { const w = u.windows().find((x) => x.url().includes(ad)); if (w) return w; await bekle(250); } throw new Error(`${ad} yok`); };
    const ana = await pencere('index.html');
    await ana.waitForSelector('.kokpit', { timeout: 30000 });
    const ada = await pencere('asistan.html');
    await ada.waitForSelector('.ada:is([data-ada-hal="sessiz"], [data-ada-hal="dinlenme"])', { state: 'attached', timeout: 20000 });
    // İmleç noktası sabit (gerçek imleç ekran değiştirince çentik ölçüm sırasında başka ölçekle yeniden kurulmasın); ana pencere gizli.
    await u.evaluate(({ BrowserWindow, screen }) => {
      const p = screen.getCursorScreenPoint();
      screen.getCursorScreenPoint = () => ({ ...p });
      BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('index.html'))?.hide();
    });
    await bekle(1500);
    const cdp = await ada.context().newCDPSession(ada);
    const kaydet = (ms) => ada.evaluate((sure) => new Promise((coz) => {
      const d = [];
      const bitis = performance.now() + sure;
      let bitti = false;
      const f = (t) => { if (bitti) return; d.push(t); if (performance.now() < bitis) requestAnimationFrame(f); else { bitti = true; coz(d); } };
      requestAnimationFrame(f);
      // Kare hiç gelmezse (pencere çizilmiyor) ölçüm takılmaz: gelen damgalarla döner.
      setTimeout(() => { if (!bitti) { bitti = true; coz(d); } }, sure + 1500);
    }), ms);
    const farklar = (d) => d.slice(1).map((t, i) => t - d[i]);
    const merkez = (sec) => ada.evaluate((s) => { const e = [...document.querySelectorAll(s)].find((x) => !x.closest('.ada__katman--cikan')); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sec);
    const fareGit = (p) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
    const tikla = async (p) => { await fareGit(p); await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 }); await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 }); };
    const hal = () => ada.evaluate(() => document.querySelector('.ada')?.dataset.adaHal);
    const halBekle = async (h, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { const x = await hal(); if (x === h || (h === 'bos' && (x === 'dinlenme' || x === 'sessiz'))) return true; await bekle(30); } return false; };
    // Ekranın tazeleme aralığı (boşta, ölçüm kaydedicisiyle): p95 sınırı 60 Hz'e göredir, ekran daha hızlıysa damgalar daha sık gelir.
    const taban = farklar(await kaydet(500));
    const panelFark = [];
    const gecisFark = [];
    const sekil = await merkez('.ada__sekil');
    for (let i = 0; i < 5; i++) {
      await fareGit({ x: sekil.x, y: sekil.y + 200 });
      const kayit = kaydet(900);
      await fareGit(sekil);
      panelFark.push(...farklar(await kayit));
      await halBekle('panel');
      await fareGit({ x: 4, y: 440 });
      await halBekle('bos');
      await bekle(600);
    }
    // Hover'la açık panel (imleç panelde kalır), noktalar ve oklarla geçiş.
    await fareGit(sekil);
    await halBekle('panel');
    await bekle(700);
    const PANEL = '.ada__katman:not(.ada__katman--cikan) .panel';
    const hedefler = ['Gündem', 'Görevler', 'Gelenler', 'Müzik', 'ok-sol', 'ok-sol', 'Odak', 'ok-sag', 'Raf', 'Asistan'];
    const gecilen = [];
    for (const h of hedefler) {
      const sec = h === 'ok-sol' ? `${PANEL} .panel__ok--sol` : h === 'ok-sag' ? `${PANEL} .panel__ok--sag` : `${PANEL} .panel__nokta[aria-label="${h}"]`;
      const p = await merkez(sec);
      if (!p) { gecilen.push(`${h}: yok`); continue; }
      await fareGit(p);
      await bekle(150);
      const kayit = kaydet(700);
      await tikla(p);
      gecisFark.push(...farklar(await kayit));
      gecilen.push(await ada.evaluate((s) => document.querySelector(s)?.dataset.panelSayfa ?? null, PANEL));
      await bekle(250);
    }
    const p95 = (l) => { const s = [...l].sort((a, b) => a - b); return s.length ? Math.round(s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] * 100) / 100 : null; };
    const ortanca = (l) => (l.length ? Math.round([...l].sort((a, b) => a - b)[Math.floor(l.length / 2)] * 100) / 100 : null);
    const tum = [...panelFark, ...gecisFark];
    const enUzun = (l) => (l.length ? Math.round(Math.max(...l) * 100) / 100 : null);
    k.kare = {
      tazelemeMs: ortanca(taban),
      panelAcilisi: { kare: panelFark.length, p95: p95(panelFark), enUzun: enUzun(panelFark) },
      sayfaGecisi: { kare: gecisFark.length, p95: p95(gecisFark), enUzun: enUzun(gecisFark), gecilen },
      tum: { kare: tum.length, p95: p95(tum), ortanca: ortanca(tum), ustu17: tum.filter((x) => x > 17).length },
    };
    // Minor 3 (T28 incelemesi): 144 Hz ekranda 17 ms geniş bir eşik — tazeleme aralığının 1,5 katını aşan (kaçan) karelerin oranı ayrıca yazılır.
    const tz = k.kare.tazelemeMs ?? 16.7;
    k.kare.tum.kacanKare = tum.filter((x) => x > tz * 1.5).length;
    k.kare.tum.kacanKareOrani = tum.length ? Math.round((k.kare.tum.kacanKare / tum.length) * 10000) / 100 : null;
    if (gecisFark.length === 0 || panelFark.length === 0) throw new Error(`kare ölçümü eksik: ${JSON.stringify(k.kare)}`);
  } finally {
    if (u) { const p = u.process(); await Promise.race([u.close().catch(() => undefined), bekle(10000)]); if (p.exitCode === null && p.signalCode === null) agaciKapat(p.pid); }
    await bekle(800);
    try { fs.rmSync(veri, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* kilitli */ }
  }
}

async function kosu(no) {
  const k = { no, baslangic: new Date().toISOString(), sistemYuku: {}, hata: null };
  try {
    k.sistemYuku.bas = await anlikYuk();
    await bostaOlc(k);
    if (!k.uykuYok && !k.gecersiz && !k.yardimciYenilendi) await kareOlc(k);
    k.sistemYuku.son = await anlikYuk();
    k.enMesgulSurecler = enMesgul();
  } catch (e) {
    k.hata = String(e?.stack ?? e).slice(0, 1500);
    k.enMesgulSurecler = enMesgul();
  }
  k.denetim = {
    ui: k.ui?.cekirdekYuzde != null && k.ui.cekirdekYuzde <= SINIR.ui,
    gpu: k.gpu?.cekirdekYuzde != null && k.gpu.cekirdekYuzde <= SINIR.gpu,
    olay: k.olay?.cekirdekYuzde != null && k.olay.cekirdekYuzde <= SINIR.olay,
    p95: k.kare?.tum?.p95 != null && k.kare.tum.p95 <= SINIR.p95,
    bostaCizim: k.bostaCizim ? k.bostaCizim.kare === 0 : false,
  };
  // Uyku ayrı: true (yüz uyudu), false (yüz uyumadı: DÜŞER), null (yüz yok: uygulanmadı, geçti sayılmaz).
  k.denetim.uyku = k.uyku ?? null;
  k.gecerli = !k.hata && !k.gecersiz && !k.yardimciYenilendi;
  k.gecti = k.gecerli && k.uyku !== false && ['ui', 'gpu', 'olay', 'p95', 'bostaCizim'].every((x) => k.denetim[x]);
  return k;
}

// Karar (T28 düzeltme turu 3; yeniden inceleme 2 N1, karar (b), N2):
//   · Yüzü olan ve uyumayan koşu (uyku false) her yükte DÜŞTÜ — sonraki bir geçiş bunu ezmez.
//   · Sayılan koşu: yük eşiğin (%25) altında, ölçüm aracı hatası yok, tam ekran/gizli değil, yardımcı yeniden açılmamış. Sayılan bir koşunun sınırı düştüyse DÜŞTÜ.
//   · GEÇTİ için yüzün olduğu ve uyuduğu, sayılan, geçen en az bir koşu gerekir. Yalnız Kapalı hapta (yüz yok) geçen koşu yetmez: yeniden koşulur.
//   · Hiçbiri yoksa: tam ekran/gizli varsa "kararsız (tam ekran/gizli)", yardımcı yenilendiyse "kararsız (yardımcı yeniden açıldı)", değilse "kararsız (meşgul)".
// Karar verilene dek 60 sn beklenip yeniden koşulur (en çok EN_COK_KOSU).
const kosular = [];
const yukOf = (k) => Math.max(k.sistemYuku.bas ?? 0, k.sistemYuku.olcum ?? 0, k.sistemYuku.son ?? 0);
const sayilir = (k) => k.gecerli && k.sessiz;
const kararVer = (l) => {
  if (l.some((k) => k.uyku === false)) return 'dustu-uyku';
  if (l.some((k) => sayilir(k) && !k.gecti)) return 'dustu';
  if (l.some((k) => sayilir(k) && k.gecti && k.uyku === true)) return 'gecti';
  if (l.some((k) => sayilir(k) && k.gecti)) return 'kararsiz-uyku-denetlenmedi';
  if (l.some((k) => k.gecersiz)) return 'kararsiz-tam-ekran';
  if (l.some((k) => k.yardimciYenilendi)) return 'kararsiz-yardimci';
  return 'kararsiz-mesgul';
};
const KESIN = new Set(['dustu-uyku', 'dustu', 'gecti']);
for (let i = 1; i <= EN_COK_KOSU; i++) {
  console.log(`── koşu ${i} (${new Date().toLocaleTimeString('tr-TR')}) ──`);
  const k = await kosu(i);
  k.yuk = yukOf(k);
  k.sessiz = k.yuk <= YUK_ESIGI;
  kosular.push(k);
  if (k.hata) console.log(`❌ koşu ${i}: ölçüm aracı hatası: ${k.hata.split('\n')[0]}`);
  if (k.uykuYok) console.log(`❌ uyku: ${k.uykuYok} — DÜŞTÜ (yükten bağımsız)`);
  if (k.gecersiz) console.log(`⏸  ${k.gecersiz} — ölçülmedi (kararsız)`);
  if (k.yardimciYenilendi) console.log(`⏸  ${k.yardimciYenilendi} — koşu geçersiz`);
  const d = (b) => (b ? '✅' : '❌');
  console.log(`   sistem yükü: başta %${k.sistemYuku.bas} · ölçüm boyunca %${k.sistemYuku.olcum ?? '?'} · sonda %${k.sistemYuku.son ?? '?'} → ${k.sessiz ? 'sessiz' : 'MEŞGUL'} (eşik %${YUK_ESIGI})  (en meşgul: ${(k.enMesgulSurecler ?? []).join(', ')})`);
  console.log(`   ön pencere: başta ${k.onPencere?.bas?.surec ?? '?'} (${k.onPencere?.bas?.sinif ?? '?'}; bildirim durumu ${k.onPencere?.bas?.bildirimDurumu ?? '?'}) · sonda ${k.onPencere?.son?.surec ?? '?'} (${k.onPencere?.son?.sinif ?? '?'}) · fuber-olay kimliği ${k.olayPid?.bas?.join(',') ?? '?'} → ${k.olayPid?.son?.join(',') ?? '?'}`);
  console.log(`   ${k.uyku === true ? '✅' : k.uyku === false ? '❌' : '➖'} uyku: ${k.uyku === true ? `yüz ${k.uykuSn} sn'de uyudu` : k.uyku === false ? 'yüz uyumadı' : `uygulanmadı (${k.bostaHal ?? k.gecersiz ?? 'ölçülmedi'})`}`);
  console.log(`   ${d(k.denetim.ui)} çentik arayüzü (en yüksek işleyici) %${k.ui?.cekirdekYuzde} (çekirdek; ${k.ui?.islemciMs} ms / ${k.duvarSn} sn; makine %${k.ui?.makineYuzde}; ${k.ui?.isleyiciSayisi} işleyicinin toplamı %${k.ui?.toplam?.cekirdekYuzde}) ≤ %${SINIR.ui}`);
  console.log(`   ${d(k.denetim.gpu)} GPU %${k.gpu?.cekirdekYuzde} (çekirdek; ${k.gpu?.islemciMs} ms; makine %${k.gpu?.makineYuzde}) ≤ %${SINIR.gpu}   · 5 sn'lik dilimler (ms): ${(k.surecDilimleri ?? []).map((x) => x.gpu).join(' ')}`);
  console.log(`   ${d(k.denetim.olay)} fuber-olay.exe %${k.olay?.cekirdekYuzde} (çekirdek; ${k.olay?.islemciMs} ms) ≤ %${SINIR.olay}   · dilimler (ms): ${(k.surecDilimleri ?? []).map((x) => x.olay).join(' ')}   · ana süreç %${k.anaSurec?.cekirdekYuzde}`);
  console.log(`   ${d(k.denetim.bostaCizim)} boşta çizim yok: 15 sn ekran yayınında ${k.bostaCizim?.kare} kare · sonda ${k.halSonra?.uyuyor ? 'hâlâ uyuyor' : k.halSonra?.yuz ? 'UYANIK' : `yüz yok (${k.halSonra?.hal})`}`);
  console.log(`   ${d(k.denetim.p95)} kare süresi p95 ${k.kare?.tum?.p95} ms (ekran tazelemesi ${k.kare?.tazelemeMs} ms; panel ${k.kare?.panelAcilisi?.p95}, geçiş ${k.kare?.sayfaGecisi?.p95}; en uzun ${k.kare?.panelAcilisi?.enUzun}/${k.kare?.sayfaGecisi?.enUzun}; >17 ms: ${k.kare?.tum?.ustu17}/${k.kare?.tum?.kare}; tazelemenin 1,5 katını aşan: %${k.kare?.tum?.kacanKareOrani}) ≤ ${SINIR.p95}`);
  console.log(`   koşu ${i}: ${k.gecti ? 'GEÇTİ' : 'DÜŞTÜ'}${sayilir(k) ? ' (sayıldı)' : k.uyku === false ? ' (uyku: yükten bağımsız sayıldı)' : ' (karara sayılmaz)'}`);
  if (KESIN.has(kararVer(kosular))) break;
  if (i < EN_COK_KOSU) { console.log('   karar yok: 60 sn beklenip yeniden koşulur'); await bekle(60_000); }
}
const karar = kararVer(kosular);
const sessizler = kosular.filter(sayilir);
const KARAR_METNI = {
  gecti: 'GEÇTİ (sessiz makinede; yüz uyudu)', dustu: 'DÜŞTÜ (sessiz makinede)', 'dustu-uyku': 'DÜŞTÜ: yüz uyumadı (yükten bağımsız)',
  'kararsiz-uyku-denetlenmedi': 'KARARSIZ: sayılan koşularda yüz yoktu (Kapalı hap), uyku denetlenmedi', 'kararsiz-tam-ekran': 'KARARSIZ (tam ekran/gizli): görünür çentik ölçülemedi',
  'kararsiz-yardimci': 'KARARSIZ: yardımcı ölçüm sırasında yeniden açıldı', 'kararsiz-mesgul': 'KARARSIZ (meşgul): hiçbir koşu yük eşiğinin altında değil',
};
const olcumYolu = path.join(cikti, 'olcum.json');
let olcum = {};
try { olcum = JSON.parse(fs.readFileSync(olcumYolu, 'utf8')); } catch { /* ilk yazım */ }
olcum.bosta = {
  zaman: new Date().toISOString(), sinirlar: SINIR, yukEsigi: YUK_ESIGI, yuzdeTanimi: 'tek çekirdek: işlemci saniyesi / duvar saniyesi × 100 (makineYuzde: çekirdek sayısına bölünmüş)',
  karar, kararMetni: KARAR_METNI[karar], gecti: karar === 'gecti', kosuSayisi: kosular.length, gecenKosu: kosular.filter((k) => k.gecti).length, sayilanKosu: sessizler.length,
  kosular: kosular.map((k) => ({ ...k, karar: k.gecersiz ? 'gecersiz-tam-ekran' : k.yardimciYenilendi ? 'gecersiz-yardimci' : k.hata ? 'arac-hatasi' : k.gecti ? 'gecti' : 'dustu', sayildi: sayilir(k) || k.uyku === false })),
};
fs.writeFileSync(olcumYolu, JSON.stringify(olcum, null, 2));
console.log(`\n${kosular.length} koşu (${kosular.filter((k) => k.gecti).length} geçti, ${sessizler.length} sayıldı) · karar: ${KARAR_METNI[karar]} · ${olcumYolu}`);
process.exit(karar === 'gecti' ? 0 : karar.startsWith('dustu') ? 1 : 2);
