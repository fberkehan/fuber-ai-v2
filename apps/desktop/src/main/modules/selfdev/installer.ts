// Kurulum + yeniden başlatma + geri alma sürücüsü. `Installer` arayüzü: gerçek (Windows) ve sahte (sınama).
//
// Gerçek sürücü uygulamanın KENDİ süreci içinde kurulum yapamaz (çalışan dosyalar kilitli); bu yüzden AYRI (detached) bir
// PowerShell betiği başlatır ve uygulama kapanır. Betik: uygulamanın kapanmasını bekler → NSIS kurulumunu sessiz çalıştırır
// (`/S`) → yeni sürümü başlatır → SAĞLIK İŞARETİNİ bekler (`<data>/selfdev/health.json`: yeni sürüm + ok:true) → gelmezse Windows
// ileti kutusuyla "önceki sürüme döneyim mi?" diye sorar, evet denirse önceki kurulumu geri yükler (anlık kopya `robocopy /MIR`
// ya da önceki kurulum paketi `/S`).
//
// Betik SABİT bir metindir; yollar, sürümler vb. betiğe GÖMÜLMEZ, ayrı bir UTF-8 JSON dosyasından (`job.json`) okunur. Böylece
// boşluklu ve Türkçe harfli yollarda (`C:\Users\Çağrı\Projects`) tırnak/çıkış sorunu doğamaz.
//
// DOĞRULANMADI (bu geliştirme ortamında gerçek kurulum denenmez): NSIS tek-tık kurulumunun `/S` ile sessiz çalışması ve
// `runAfterFinish`'in sessiz kipte uygulamayı başlatıp başlatmadığı (electron-builder belgesine göre sessiz kipte uygulamayı
// `--force-run` bayrağı olmadan başlatmaz; betik bu yüzden uygulamayı kendisi başlatır, çift başlatma tek örnek kilidiyle zararsızdır).
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface InstallJob {
  mode: 'install' | 'rollback';
  runId: string;
  /** Kapanması beklenecek uygulamanın süreç numarası. */
  pid: number;
  /** Kurulu uygulamanın klasörü (`dirname(process.execPath)`). */
  installDir: string;
  /** Başlatılacak uygulama dosyası (`process.execPath`). */
  exe: string;
  /** Başlatılınca beklenen sürüm (sağlık işaretinde aranır). */
  version: string;
  fromVersion: string;
  /** `install`: yeni kurulum paketi. `rollback`: kullanılmaz. */
  installer: string | null;
  /** Geri yüklenecek sürümün anlık kopyası (rollback hedefi; `install` kipinde kurulum tutmazsa kullanılacak eski sürüm). */
  restoreSnapshot: string | null;
  /** Geri yüklenecek sürümün kurulum paketi (anlık kopya yoksa). */
  restoreInstaller: string | null;
  healthFile: string;
  resultFile: string;
  waitHealthSeconds: number;
}

export interface Installer {
  /** Bu kipte gerçek kurulum yapılabilir mi (paketli uygulama, Windows). */
  available(): { ok: boolean; reason: string | null };
  /** Çalışan kurulu uygulamanın klasörünün anlık kopyasını `targetDir`'e alır. */
  snapshot(installDir: string, targetDir: string): Promise<{ ok: boolean; error?: string }>;
  /** Kurulum/geri alma betiğini başlatır. Çağıran bundan sonra uygulamayı kapatır. */
  start(job: InstallJob, workDir: string): Promise<{ ok: boolean; error?: string }>;
}

/** Sabit PowerShell betiği (yol gömülmez; `-JobFile` ile verilen JSON okunur). */
export const INSTALL_SCRIPT = `# Fuber AI 2: kurulum / geri alma yardımcısı (modules/selfdev/installer.ts). Uygulama kapandıktan sonra çalışır.
param([Parameter(Mandatory = $true)][string]$JobFile)
$ErrorActionPreference = 'Continue'
$job = Get-Content -LiteralPath $JobFile -Raw -Encoding UTF8 | ConvertFrom-Json
$logFile = [System.IO.Path]::ChangeExtension($JobFile, '.log')

function Write-Log([string]$text) {
  try { Add-Content -LiteralPath $logFile -Value ((Get-Date).ToString('o') + ' ' + $text) -Encoding UTF8 } catch { }
}
function Write-Result([bool]$ok, [string]$message) {
  Write-Log ('sonuç: ' + $ok + ' ' + $message)
  $result = [ordered]@{ ok = $ok; message = $message; at = (Get-Date).ToString('o'); mode = $job.mode; runId = $job.runId }
  try { ($result | ConvertTo-Json) | Set-Content -LiteralPath $job.resultFile -Encoding UTF8 } catch { }
}
function Ask-User([string]$text) {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    return ([System.Windows.Forms.MessageBox]::Show($text, 'Fuber AI 2', 'YesNo', 'Question') -eq 'Yes')
  } catch { return $false }
}
function Tell-User([string]$text) {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show($text, 'Fuber AI 2', 'OK', 'Information')
  } catch { }
}
function Wait-AppExit {
  $process = Get-Process -Id $job.pid -ErrorAction SilentlyContinue
  if ($process) {
    [void]$process.WaitForExit(90000)
    if (-not $process.HasExited) { Write-Log 'uygulama kapanmadı; sonlandırılıyor'; Stop-Process -Id $job.pid -Force -ErrorAction SilentlyContinue }
  }
  Start-Sleep -Seconds 2
}
function Start-App {
  Start-Process -FilePath $job.exe -WorkingDirectory (Split-Path -Parent $job.exe)
}
function Wait-Health {
  $deadline = (Get-Date).AddSeconds([int]$job.waitHealthSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath $job.healthFile) {
      try {
        $health = Get-Content -LiteralPath $job.healthFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($health.version -eq $job.version -and $health.runId -eq $job.runId) { return [bool]$health.ok }
      } catch { }
    }
    Start-Sleep -Seconds 2
  }
  return $false
}
function Restore-Previous {
  Get-Process | Where-Object { $_.Path -eq $job.exe } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  if ($job.restoreSnapshot -and (Test-Path -LiteralPath $job.restoreSnapshot)) {
    # Emniyet: /MIR hedefte kaynakta olmayan her şeyi SİLER. Anlık kopya uygulamayı içermiyorsa (boş ya da yarım) ya da hedef
    # uygulamanın kendi klasörü değilse hiçbir şeye dokunulmaz.
    $exeName = Split-Path -Leaf $job.exe
    if (-not (Test-Path -LiteralPath (Join-Path $job.restoreSnapshot $exeName))) { Write-Log 'anlık kopya uygulamayı içermiyor; geri yükleme yapılmadı'; return $false }
    if ((-not $job.installDir) -or ((Split-Path -Parent $job.exe).TrimEnd([char]92) -ne ([string]$job.installDir).TrimEnd([char]92))) { Write-Log 'kurulum klasörü uygulamanın klasörü değil; geri yükleme yapılmadı'; return $false }
    & robocopy $job.restoreSnapshot $job.installDir /MIR /NFL /NDL /NJH /NJS /NP /R:2 /W:1 | Out-Null
    Write-Log ('robocopy çıkış kodu: ' + $LASTEXITCODE)
    return ($LASTEXITCODE -lt 8)
  }
  if ($job.restoreInstaller -and (Test-Path -LiteralPath $job.restoreInstaller)) {
    $run = Start-Process -FilePath $job.restoreInstaller -ArgumentList '/S' -Wait -PassThru
    Write-Log ('önceki kurulum çıkış kodu: ' + $run.ExitCode)
    return ($run.ExitCode -eq 0)
  }
  return $false
}

Write-Log ('başladı: ' + $job.mode + ' ' + $job.fromVersion + ' -> ' + $job.version)
Wait-AppExit

if ($job.mode -eq 'rollback') {
  if (-not (Restore-Previous)) {
    Write-Result $false 'önceki sürüm geri yüklenemedi'
    Tell-User 'Önceki sürüm geri yüklenemedi. Fuber AI 2 için kurulum dosyasını elle çalıştırmanız gerekebilir.'
    exit 1
  }
  Start-App
  Write-Result (Wait-Health) 'geri alındı'
  exit 0
}

$install = Start-Process -FilePath $job.installer -ArgumentList '/S' -Wait -PassThru
Write-Log ('kurulum çıkış kodu: ' + $install.ExitCode)
if ($install.ExitCode -ne 0) {
  Write-Result $false ('kurulum tamamlanamadı (kod ' + $install.ExitCode + ')')
  Tell-User 'Güncelleme kurulamadı; mevcut sürüm açılıyor.'
  Start-App
  exit 1
}
Start-App
if (Wait-Health) {
  Write-Result $true 'yeni sürüm sağlıklı açıldı'
  exit 0
}
if (Ask-User 'Yeni sürüm açılamadı ya da sağlıklı çalışmıyor. Önceki sürüme döneyim mi?') {
  if (Restore-Previous) {
    Start-App
    Write-Result $false 'yeni sürüm açılamadı; önceki sürüme dönüldü'
  } else {
    Write-Result $false 'yeni sürüm açılamadı; önceki sürüm geri yüklenemedi'
    Tell-User 'Önceki sürüm geri yüklenemedi.'
  }
} else {
  Write-Result $false 'yeni sürüm sağlıksız; kullanıcı geri almadı'
}
`;

/** Görev dosyasının metni (UTF-8 JSON). */
export function jobJson(job: InstallJob): string {
  return JSON.stringify(job, null, 2);
}

const BOM = '\uFEFF';

/** Gerçek sürücü: Windows + paketli uygulama. */
export function createWindowsInstaller(env: { isPackaged: boolean }): Installer {
  return {
    available() {
      if (process.platform !== 'win32') return { ok: false, reason: 'kurulum yalnız Windows\'ta yapılır' };
      if (!env.isPackaged) return { ok: false, reason: 'bu kipte (kurulu olmayan, geliştirme ya da sınama) kurulum yapılmaz' };
      return { ok: true, reason: null };
    },

    snapshot(installDir, targetDir) {
      return new Promise((resolve) => {
        fs.mkdirSync(targetDir, { recursive: true });
        // robocopy başarıda 1-7 çıkış kodu verir (8 ve üstü hata).
        execFile('robocopy', [installDir, targetDir, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1'], { windowsHide: true, timeout: 10 * 60_000 }, (error) => {
          const code = typeof (error as NodeJS.ErrnoException | null)?.code === 'number' ? ((error as unknown as { code: number }).code) : 0;
          if (code >= 8) return resolve({ ok: false, error: `robocopy çıkış kodu ${code}` });
          // Kopya gerçekten uygulamayı içermeli: eksik bir kopyadan geri yükleme (/MIR) kurulu klasörü bozardı.
          const exeName = path.basename(process.execPath);
          if (!fs.existsSync(path.join(targetDir, exeName))) return resolve({ ok: false, error: `anlık kopya eksik: ${exeName} kopyalanamadı` });
          resolve({ ok: true });
        });
      });
    },

    async start(job, workDir) {
      try {
        await fs.promises.mkdir(workDir, { recursive: true });
        const script = path.join(workDir, 'install.ps1');
        const jobFile = path.join(workDir, 'job.json');
        await fs.promises.writeFile(script, BOM + INSTALL_SCRIPT, 'utf8');
        await fs.promises.writeFile(jobFile, jobJson(job), 'utf8');
        const child = spawn(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script, '-JobFile', jobFile],
          { detached: true, stdio: 'ignore', windowsHide: true },
        );
        child.on('error', () => undefined);
        child.unref();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

/** Sahte kipte "çalışan sürüm": sahte kurulumun yazdığı sürüm; yoksa null (gerçek sürüm geçerli). */
export function fakeRunningVersion(dataDir: string): string | null {
  try {
    return fs.readFileSync(path.join(dataDir, 'selfdev', 'fake-running-version.txt'), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/**
 * SAHTE sürücü (yalnız sınama, FUBER2_SELFDEV=fake): hiçbir şey kurmaz ve uygulamayı kapatmaz; yapılacak işi
 * <data>/selfdev/fake-installer.json dosyasına yazar ("kurdu + yeniden başlat istendi"). Dosyayı sınama okur.
 */
export function createFakeInstaller(dataDir: string): Installer {
  const record = path.join(dataDir, 'selfdev', 'fake-installer.json');
  const append = (entry: Record<string, unknown>): void => {
    let list: unknown[] = [];
    try {
      list = JSON.parse(fs.readFileSync(record, 'utf8')) as unknown[];
    } catch {
      // ilk kayıt
    }
    list.push({ ...entry, at: new Date().toISOString() });
    fs.mkdirSync(path.dirname(record), { recursive: true });
    fs.writeFileSync(record, JSON.stringify(list, null, 2), 'utf8');
  };
  return {
    available: () => ({ ok: true, reason: null }),
    async snapshot(installDir, targetDir) {
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, 'SAHTE-ANLIK-KOPYA.txt'), `sahte anlık kopya: ${installDir}`, 'utf8');
      append({ action: 'snapshot', installDir, targetDir });
      return { ok: true };
    },
    async start(job) {
      append({ action: job.mode, job });
      // Sahte "yeniden başlatma": bundan sonra açılan uygulama bu sürümü çalışıyor sayar (`fakeRunningVersion`).
      fs.writeFileSync(path.join(dataDir, 'selfdev', 'fake-running-version.txt'), job.version, 'utf8');
      return { ok: true };
    },
  };
}
