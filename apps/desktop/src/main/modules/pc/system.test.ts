// Komut çalıştırma, hazır sorgular, uygulama kapatma ve süreç sonlandırma sınamaları.
// Sınırlar: gerçek PowerShell yalnız ZARARSIZ komutlarla ve depo içindeki geçici klasörde koşar; süreç sonlandırma yalnız
// bu sınamanın kendi başlattığı süreçte denenir; pencere kapatma sahte sürücüyle. Hazır sorguların çıktısı günlüğe yazılmaz.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { ToolContext, ToolDef, ToolResult } from '@fuber/shared';
import type { AccessConfig } from '../documents/access';
import { scratchDir } from '../documents/testkit';
import { createPcGate, type PcGateControl } from './gate';
import { scene, win } from './pc-testkit';
import {
  BACKGROUND_LIMITS,
  backgroundProcesses,
  childEnv,
  cleanOutput,
  COMMAND_LIMITS,
  fakePowerShell,
  headAndTail,
  ownFamily,
  processKey,
  protectedProcess,
  refuseCommand,
  runPowerShell,
  stopAllBackground,
  systemControlTools,
  systemReadTools,
  type SystemEnv,
} from './system';

const scratch = scratchDir('pc-system');
afterAll(async () => {
  await stopAllBackground();
  // Az önce kapatılan sürecin çalışma klasörü kısa süre kilitli kalabilir (EBUSY): birkaç kez denenir.
  for (let attempt = 0; ; attempt++) {
    try {
      scratch.cleanup();
      break;
    } catch (error) {
      if (attempt >= 20) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
});

const access = (): AccessConfig => ({ platform: 'win32', home: path.join(scratch.dir, 'home'), readRoots: () => [scratch.dir], env: process.env });

interface Harness {
  env: SystemEnv;
  gate: PcGateControl;
  activity: string[];
}

function harness(extra: Partial<SystemEnv> = {}): Harness {
  const activity: string[] = [];
  const gate = createPcGate({ onActivity: (event) => activity.push(`${event.state}:${event.action}`) });
  const env: SystemEnv = { gate, access, expand: (raw) => raw, defaultCwd: () => scratch.dir, ...extra };
  return { env, gate, activity };
}

function context(options: { approve?: boolean; signal?: AbortSignal } = {}) {
  const approvals: string[] = [];
  const ctx = {
    signal: options.signal ?? new AbortController().signal,
    report() {},
    moduleId: 'pc',
    origin: { channel: 'voice', speakerVerified: null },
    tools: {
      async requestApproval(request: { summary: string }) {
        approvals.push(request.summary);
        return options.approve === false ? 'denied' : 'approved';
      },
    },
  } as unknown as ToolContext;
  return { ctx, approvals };
}

const tool = (tools: ToolDef[], name: string): ToolDef => {
  const found = tools.find((item) => item.name === name);
  if (!found) throw new Error(`araç yok: ${name}`);
  return found;
};
const reason = (result: ToolResult): unknown => (result.data as { reason?: unknown } | undefined)?.reason;
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const waitFor = async (test: () => boolean, ms = 8000): Promise<boolean> => {
  for (const until = Date.now() + ms; Date.now() < until; ) {
    if (test()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return test();
};

describe('saf kurallar', () => {
  it('çocuk ortamı: uygulamanın iç değişkenleri ve sonradan konan sırlar geçmez; kullanıcının kendi sırrı ilk değeriyle geçer', () => {
    const initial = { PATH: 'C:\\bin', GITHUB_TOKEN: 'kullanıcının', SystemRoot: 'C:\\Windows' };
    const now = {
      ...initial,
      GITHUB_TOKEN: 'uygulama değiştirdi',
      FUBER2_DATA: 'x',
      fuber_device_key: 'y',
      ELECTRON_RUN_AS_NODE: '1',
      NODE_OPTIONS: '--inspect',
      ANTHROPIC_API_KEY: 'sk-sonradan',
      SERVIS_PAROLA: 'sonradan',
      NORMAL: 'kalır',
      BOS: undefined,
    };
    expect(childEnv(now, initial)).toEqual({ PATH: 'C:\\bin', GITHUB_TOKEN: 'kullanıcının', SystemRoot: 'C:\\Windows', NORMAL: 'kalır' });
  });

  it('çıktı temizliği: ANSI, denetim karakteri ve üzerine yazılan ilerleme satırı', () => {
    expect(cleanOutput('\u001b[31mkırmızı\u001b[0m\r\n%10\r%100\r\nson\u0007\u0000')).toBe('kırmızı\n%100\nson');
    expect(cleanOutput('\u001b]0;başlık\u0007metin\tsekme')).toBe('metin\tsekme');
  });

  it('uzun çıktı: baş + atlandı notu + son', () => {
    const all = Array.from({ length: 4000 }, (_, i) => `satır ${i + 1}`).join('\n');
    const short = headAndTail('kısa çıktı', 'kısa çıktı', 10, 1000);
    expect(short).toEqual({ text: 'kısa çıktı', truncated: false });
    const shaped = headAndTail(all.slice(0, 1000), all.slice(-1000), all.length, 1000);
    expect(shaped.truncated).toBe(true);
    expect(shaped.text.startsWith('satır 1\n')).toBe(true);
    expect(shaped.text.endsWith('satır 4000')).toBe(true);
    expect(shaped.text).toMatch(/ortadan \d+ karakter atlandı/);
    expect(shaped.text.length).toBeLessThan(1100);
  });

  it('yönetici yükseltmesi, etkileşimli ve kodlanmış komut reddedilir; zararsız komut geçer', () => {
    const refused = (command: string) => refuseCommand(command)?.reason ?? null;
    expect(refused('Start-Process notepad -Verb RunAs')).toBe('elevation');
    expect(refused('start-process cmd -verb:runas')).toBe('elevation');
    expect(refused('runas /user:Administrator cmd')).toBe('elevation');
    expect(refused('sudo winget install x')).toBe('elevation');
    expect(refused('Get-Date; gsudo netsh x')).toBe('elevation');
    expect(refused('$ad = Read-Host "Adın"')).toBe('interactive');
    expect(refused('Get-Date; pause')).toBe('interactive');
    expect(refused('Get-Credential')).toBe('interactive');
    expect(refused('Invoke-Command -ComputerName x -Credential y { 1 }')).toBe('interactive');
    expect(refused('cmd /k dir')).toBe('interactive');
    expect(refused('powershell -NoExit -Command 1')).toBe('interactive');
    expect(refused('powershell -EncodedCommand ZABpAHIA')).toBe('encoded');
    expect(refused('pwsh -enc ZABpAHIA')).toBe('encoded');
    expect(refused('   ')).toBe('empty');
    expect(refused(`Write-Output '${'a'.repeat(COMMAND_LIMITS.maxCommandChars)}'`)).toBe('too_long');
    expect(refused('Write-Output "a\u0000b"')).toBe('bad_chars');
    // Sözcük yalnız komut konumunda sayılır.
    expect(refused("Write-Output 'pause'")).toBeNull();
    expect(refused('Get-Date')).toBeNull();
    expect(refused('Get-ChildItem *.pdf | Measure-Object')).toBeNull();
    expect(refused('git status; npm test')).toBeNull();
    expect(refused('Get-Process | Where-Object { $_.Name -like "pseudo*" }')).toBeNull();
  });

  it('süreç koruması: sistem süreçleri, kendi ailemiz ve Fuber uygulamaları', () => {
    const rows = [
      { pid: 4, parent: 0, name: 'System' },
      { pid: 800, parent: 4, name: 'lsass.exe' },
      { pid: 1000, parent: 900, name: 'WindowsTerminal.exe' },
      { pid: 1100, parent: 1000, name: 'node.exe' },
      { pid: 1200, parent: 1100, name: 'Fuber AI 2.exe' },
      { pid: 1300, parent: 1200, name: 'powershell.exe' },
      { pid: 1400, parent: 1300, name: 'conhost.exe' },
      { pid: 2000, parent: 900, name: 'notepad.exe' },
      { pid: 2100, parent: 900, name: 'Fuber Yönetim 2.exe' },
      { pid: 2200, parent: 900, name: 'Fuber AI.exe' },
    ];
    const family = ownFamily(rows, 1200);
    expect([...family].sort((a, b) => a - b)).toEqual([1000, 1100, 1200, 1300, 1400]);
    const verdict = (pid: number) => protectedProcess(rows.find((row) => row.pid === pid)!, family);
    expect(verdict(4)).toBe('system');
    expect(verdict(800)).toBe('system');
    expect(verdict(1000)).toBe('own');
    expect(verdict(1300)).toBe('own');
    expect(verdict(2100)).toBe('fuber');
    expect(verdict(2200)).toBe('fuber');
    expect(verdict(2000)).toBeNull();
    expect(processKey(' NotePad.EXE ')).toBe('notepad');
  });
});

describe('pc_run_command', () => {
  const run = (h: Harness, input: Record<string, unknown>, ctx = context().ctx) => tool(systemControlTools(h.env), 'pc_run_command').run(input, ctx);

  it('risk danger; onay kartı komutun TAMAMINI, klasörü ve süreyi gösterir', () => {
    const h = harness();
    const def = tool(systemControlTools(h.env), 'pc_run_command');
    expect(def.risk).toBe('danger');
    expect(def.group).toBe('system');
    const long = `Write-Output '${'uzun '.repeat(380)}son-parça'`;
    const card = def.approvalText!({ command: long, timeout_seconds: 90 });
    expect(card).toContain(long);
    expect(card).toContain(scratch.dir);
    expect(card).toContain('90 sn');
  });

  it('zararsız komut gerçek PowerShell’de çalışır: çıkış kodu, çerçeveli çıktı, Türkçe karakter, çalışma klasörü', async () => {
    const h = harness();
    const result = await run(h, { command: "Write-Output 'merhaba ğüşıöç İ'; (Get-Location).Path" });
    expect(result.ok).toBe(true);
    expect(result.text).toContain('Çıkış kodu: 0');
    expect(result.text).toContain('[KOMUT ÇIKTISI');
    expect(result.text).toContain('[ÇIKTININ SONU]');
    expect(result.text).toContain('merhaba ğüşıöç İ');
    expect(result.text.toLowerCase()).toContain(scratch.dir.toLowerCase());
    expect(result.data).toMatchObject({ exitCode: 0, timedOut: false, stopped: false, truncated: false, untrusted: true });
    expect(h.activity).toEqual(['start:command', 'end:command']);
  }, 30_000);

  it('sıfır olmayan çıkış kodu aracın hatası değildir ama metinde uyarılır', async () => {
    const result = await run(harness(), { command: "Write-Output 'yarım'; exit 3" });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ exitCode: 3 });
    expect(result.text).toContain('Çıkış kodu: 3');
    expect(result.text).toContain('hata koduyla bitti');
  }, 30_000);

  it('uygulamanın iç değişkenleri ve sonradan konan sırlar çocuğa geçmez', async () => {
    process.env.FUBER2_SINAMA_PROBE = 'ic-deger';
    process.env.PC_SINAMA_API_TOKEN = 'gizli-deger';
    try {
      const result = await run(harness(), { command: 'Write-Output "[$env:FUBER2_SINAMA_PROBE][$env:PC_SINAMA_API_TOKEN][$($env:SystemRoot.Length -gt 0)]"' });
      expect(result.ok).toBe(true);
      expect(result.text).toContain('[][][True]');
      expect(result.text).not.toContain('ic-deger');
      expect(result.text).not.toContain('gizli-deger');
    } finally {
      delete process.env.FUBER2_SINAMA_PROBE;
      delete process.env.PC_SINAMA_API_TOKEN;
    }
  }, 30_000);

  it('uzun çıktının başı ve sonu kalır', async () => {
    const result = await run(harness(), { command: '1..3000 | ForEach-Object { "satir $_ ----------------------------------------" }' });
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ truncated: true, exitCode: 0 });
    expect(result.text).toContain('satir 1 -');
    expect(result.text).toContain('satir 3000 -');
    expect(result.text).toMatch(/ortadan \d+ karakter atlandı/);
    expect(result.text.length).toBeLessThan(COMMAND_LIMITS.maxOutput + 1000);
  }, 30_000);

  it('süre dolunca süreç AĞACI kapatılır (torun süreç de ölür)', async () => {
    const pidFile = path.join(scratch.dir, 'torun.pid');
    const script = `require('fs').writeFileSync('torun.pid', String(process.pid)); setTimeout(function () {}, 60000)`;
    const started = Date.now();
    const result = await run(harness(), { command: `& '${process.execPath}' -e "${script}"`, timeout_seconds: 6 });
    expect(result.ok).toBe(false);
    expect(reason(result)).toBe('timeout');
    expect(result.text).toContain('SÜRE DOLDU');
    expect(Date.now() - started).toBeLessThan(6000 + COMMAND_LIMITS.forceFinishMs + 3000);
    expect(fs.existsSync(pidFile)).toBe(true);
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    expect(pid).toBeGreaterThan(0);
    expect(await waitFor(() => !alive(pid))).toBe(true);
  }, 40_000);

  it('“Durdur” süren komutu öldürür; ardından yeni komut bir süre başlamaz', async () => {
    const h = harness();
    const started = Date.now();
    setTimeout(() => h.gate.stop(), 1500);
    const result = await run(h, { command: 'Start-Sleep -Seconds 40', timeout_seconds: 60 });
    expect(result.ok).toBe(false);
    expect(reason(result)).toBe('stopped');
    expect(result.text).toContain('DURDURULDU');
    expect(Date.now() - started).toBeLessThan(1500 + COMMAND_LIMITS.forceFinishMs + 3000);
    const next = await run(h, { command: 'Get-Date' });
    expect(next.ok).toBe(false);
    expect(reason(next)).toBe('panic');
  }, 30_000);

  it('çağrı iptali (ctx.signal) süren komutu keser; iptal edilmiş çağrı hiç başlamaz', async () => {
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 1200);
    const outcome = await runPowerShell('Start-Sleep -Seconds 40', { cwd: scratch.dir, timeoutMs: 60_000, maxOutput: 2000, signal: abort.signal });
    expect(outcome).toMatchObject({ stopped: true, timedOut: false, exitCode: null });
    const fake = fakePowerShell(() => ({}));
    const result = await run(harness({ runPowerShell: fake }), { command: 'Get-Date' }, context({ signal: abort.signal }).ctx);
    expect(reason(result)).toBe('aborted');
    expect(fake.calls).toHaveLength(0);
  }, 30_000);

  it('reddedilen komut ve engelli çalışma klasörü hiç çalıştırılmaz; nedeni ve önerisi döner', async () => {
    const fake = fakePowerShell(() => ({ output: 'çalıştı' }));
    const h = harness({ runPowerShell: fake });
    const elevated = await run(h, { command: 'Start-Process powershell -Verb RunAs' });
    expect(elevated.ok).toBe(false);
    expect(reason(elevated)).toBe('elevation');
    expect(elevated.text).toContain('yönetici');
    const interactive = await run(h, { command: 'Read-Host "parola"' });
    expect(reason(interactive)).toBe('interactive');
    expect(interactive.text).toContain('parametre');
    const system = await run(h, { command: 'Get-Date', cwd: 'C:\\Windows\\System32' });
    expect(reason(system)).toBe('bad_cwd');
    const missing = await run(h, { command: 'Get-Date', cwd: path.join(scratch.dir, 'yok-boyle-klasor') });
    expect(reason(missing)).toBe('bad_cwd');
    expect(fake.calls).toHaveLength(0);
    const fine = await run(h, { command: '  Get-Date  ', timeout_seconds: 5 });
    expect(fine.ok).toBe(true);
    expect(fake.calls).toEqual([{ script: 'Get-Date', cwd: fs.realpathSync.native(scratch.dir), timeoutMs: 5000 }]);
  });

  it('başlatılamayan komut dürüstçe bildirilir', async () => {
    const h = harness({ runPowerShell: fakePowerShell(() => ({ exitCode: null, error: 'spawn ENOENT' })) });
    const result = await run(h, { command: 'Get-Date' });
    expect(result.ok).toBe(false);
    expect(reason(result)).toBe('no_start');
    expect(result.text).toContain('ENOENT');
  });
});

describe('hazır sorgular (salt okunur, onaysız)', () => {
  it('dördü de risk read ve system kümesinde', () => {
    const tools = systemReadTools(harness().env);
    // `process_output` (arka plan süreçlerinin çıktısı) da okuma aracıdır; kendi bölümünde sınanır.
    expect(tools.map((item) => item.name)).toEqual(['system_info', 'process_list', 'network_status', 'app_list', 'process_output']);
    expect(tools.every((item) => item.risk === 'read' && item.group === 'system')).toBe(true);
  });

  it('modelin verdiği metin betiğe GÖMÜLMEZ: betik her girdide aynıdır, süzme Node tarafında', async () => {
    const fake = fakePowerShell((script) =>
      script.includes('Get-Process')
        ? { output: JSON.stringify([{ Name: 'chrome', Id: 11, WorkingSet64: 300 * 2 ** 20, CPU: 12 }, { Name: 'chrome', Id: 15, WorkingSet64: 100 * 2 ** 20, CPU: 3 }, { Name: 'notepad', Id: 19, WorkingSet64: 20 * 2 ** 20, CPU: null }]) }
        : { output: JSON.stringify([{ DisplayName: 'Örnek Ofis', DisplayVersion: '16.0', Publisher: 'Örnek A.Ş.' }, { DisplayName: 'Örnek Ofis', DisplayVersion: '16.0', Publisher: 'Örnek A.Ş.' }, { DisplayName: 'Başka Program', DisplayVersion: '', Publisher: '' }]) },
    );
    const tools = systemReadTools(harness({ runPowerShell: fake }).env);
    const { ctx } = context();
    const evil = "chrome'; Remove-Item C:\\ -Recurse; '";
    const plain = await tool(tools, 'process_list').run({}, ctx);
    const filtered = await tool(tools, 'process_list').run({ name: 'CHROME', sort: 'cpu', limit: 5 }, ctx);
    const injected = await tool(tools, 'process_list').run({ name: evil }, ctx);
    expect(new Set(fake.calls.map((call) => call.script)).size).toBe(1);
    expect(fake.calls.every((call) => !call.script.includes('Remove-Item'))).toBe(true);
    expect(plain.text).toContain('chrome: 400 MB · 2 süreç');
    expect(plain.text).toContain('pid 11, 15');
    expect(filtered.data).toMatchObject({ processes: [{ name: 'chrome', count: 2, memoryMb: 400 }] });
    expect(injected.ok).toBe(true);
    expect(injected.data).toMatchObject({ count: 0 });

    const before = fake.calls.length;
    const apps = await tool(tools, 'app_list').run({ name: 'ofis' }, ctx);
    const none = await tool(tools, 'app_list').run({ name: evil }, ctx);
    expect(new Set(fake.calls.slice(before).map((call) => call.script)).size).toBe(1);
    expect(apps.data).toMatchObject({ total: 2, count: 1, apps: ['Örnek Ofis'] });
    expect(none.data).toMatchObject({ count: 0 });
  });

  it('sorgu çalışmazsa dürüst hata; system_info ve network_status Node’un bildiğiyle sürer', async () => {
    const tools = systemReadTools(harness({ runPowerShell: fakePowerShell(() => ({ exitCode: 1, output: 'erişim reddedildi' })) }).env);
    const { ctx } = context();
    expect((await tool(tools, 'process_list').run({}, ctx)).ok).toBe(false);
    expect((await tool(tools, 'app_list').run({}, ctx)).ok).toBe(false);
    const info = await tool(tools, 'system_info').run({}, ctx);
    expect(info.ok).toBe(true);
    expect(info.text).toContain('Bellek:');
    expect(info.text).toContain('Ayrıntılar okunamadı');
    const network = await tool(tools, 'network_status').run({}, ctx);
    expect(network.ok).toBe(true);
    expect(network.data).toMatchObject({ internet: null });
  });

  it('gerçek makinede çalışır ve yapı döndürür (içerik günlüğe yazılmaz)', async () => {
    const tools = systemReadTools(harness().env);
    const { ctx } = context();
    const info = await tool(tools, 'system_info').run({}, ctx);
    expect(info.ok).toBe(true);
    const infoData = info.data as { memory: { totalGb: number }; disks?: Array<{ totalGb: number }>; battery?: unknown };
    expect(infoData.memory.totalGb).toBeGreaterThan(0);
    expect(infoData.disks?.length ?? 0).toBeGreaterThan(0);
    expect(info.text.split('\n').length).toBeGreaterThanOrEqual(5);
    expect(info.text).not.toContain('Ayrıntılar okunamadı');

    const processes = await tool(tools, 'process_list').run({ name: 'node' }, ctx);
    expect(processes.ok).toBe(true);
    expect((processes.data as { processes: unknown[] }).processes.length).toBeGreaterThan(0);

    const network = await tool(tools, 'network_status').run({}, ctx);
    expect(network.ok).toBe(true);
    expect(typeof (network.data as { connected: unknown }).connected).toBe('boolean');
    expect(network.text).not.toContain('Ayrıntılar okunamadı');

    const apps = await tool(tools, 'app_list').run({ limit: 5 }, ctx);
    expect(apps.ok).toBe(true);
    expect((apps.data as { total: number }).total).toBeGreaterThan(0);
  }, 90_000);
});

describe('process_kill', () => {
  const children: ChildProcess[] = [];
  afterAll(() => {
    for (const child of children) child.kill();
  });
  const sleeper = async (): Promise<number> => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(function () {}, 60000)'], { stdio: 'ignore', windowsHide: true });
    children.push(child);
    await waitFor(() => child.pid !== undefined && alive(child.pid), 5000);
    return child.pid!;
  };
  // Var olamayacak süreç kimlikleri (Windows kimlikleri 4'ün katıdır): sahte tabloda bir hata olsa da gerçek bir sürece dokunulmaz.
  const table = (rows: Array<[number, number, string]>) => fakePowerShell(() => ({ output: JSON.stringify(rows.map(([ProcessId, ParentProcessId, Name]) => ({ ProcessId, ParentProcessId, Name }))) }));

  it('risk danger; onay kartı süreç adını, pid’i ve kaybı söyler', () => {
    const def = tool(systemControlTools(harness({ processName: (pid) => (pid === 4242 ? 'notepad.exe' : null) }).env), 'process_kill');
    expect(def.risk).toBe('danger');
    const named = def.approvalText!({ pid: 4242, tree: true });
    expect(named).toContain('notepad.exe');
    expect(named).toContain('4242');
    expect(named).toContain('Kaydedilmemiş iş kaybolur');
    expect(named).toContain('alt süreçleriyle');
    expect(def.approvalText!({ pid: 7 })).toContain('pid 7');
    expect(def.approvalText!({ name: 'notepad' })).toContain('“notepad” adlı bütün süreçleri');
  });

  it('yalnız sınamanın kendi başlattığı süreç sonlandırılır ve gittiği doğrulanır', async () => {
    const pid = await sleeper();
    // Sınama süreci hedefin atası olduğundan "kendi ailemiz" koruması devreye girerdi; aile dışı bir kimlik verilir.
    const h = harness({ ownPid: 999_999_991 });
    const result = await tool(systemControlTools(h.env), 'process_kill').run({ pid }, context().ctx);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ killed: [pid] });
    expect(alive(pid)).toBe(false);
    expect(h.activity).toEqual(['start:command', 'end:command']);
  }, 40_000);

  it('kendi sürecimiz ve çocuklarımız sonlandırılmaz', async () => {
    const pid = await sleeper();
    const kill = tool(systemControlTools(harness().env), 'process_kill');
    const child = await kill.run({ pid }, context().ctx);
    expect(child.ok).toBe(false);
    expect(child.data).toMatchObject({ reason: 'protected', protection: 'own' });
    const self = await kill.run({ pid: process.pid }, context().ctx);
    expect(self.data).toMatchObject({ reason: 'protected', protection: 'own' });
    expect(alive(pid)).toBe(true);
  }, 40_000);

  it('sistem süreçleri ve Fuber uygulamaları ASLA; olmayan süreç dürüstçe bildirilir', async () => {
    const fake = table([
      [999_999_901, 999_999_900, 'lsass.exe'],
      [999_999_903, 999_999_900, 'Fuber AI 2.exe'],
      [999_999_905, 999_999_900, 'Fuber Yönetim 2.exe'],
      [999_999_907, 999_999_900, 'Fuber AI.exe'],
      [999_999_909, 999_999_900, 'explorer.exe'],
      ...Array.from({ length: 14 }, (_, i): [number, number, string] => [999_999_801 + i * 2, 999_999_900, 'cok.exe']),
    ]);
    const kill = tool(systemControlTools(harness({ runPowerShell: fake, ownPid: 999_999_991 }).env), 'process_kill');
    const { ctx } = context();
    expect((await kill.run({ name: 'lsass' }, ctx)).data).toMatchObject({ reason: 'protected', protection: 'system' });
    expect((await kill.run({ pid: 999_999_909 }, ctx)).data).toMatchObject({ reason: 'protected', protection: 'system' });
    expect((await kill.run({ name: 'Fuber AI 2.exe' }, ctx)).data).toMatchObject({ reason: 'protected', protection: 'fuber' });
    expect((await kill.run({ pid: 999_999_905 }, ctx)).data).toMatchObject({ reason: 'protected', protection: 'fuber' });
    expect((await kill.run({ name: 'fuber ai' }, ctx)).data).toMatchObject({ reason: 'protected', protection: 'fuber' });
    expect((await kill.run({ name: 'cok' }, ctx)).data).toMatchObject({ reason: 'too_many' });
    expect((await kill.run({ name: 'yok-boyle' }, ctx)).data).toMatchObject({ reason: 'not_found' });
    // pid ile ad birlikte verildiyse ikisi tutmalı.
    expect((await kill.run({ pid: 999_999_801, name: 'notepad' }, ctx)).data).toMatchObject({ reason: 'not_found' });
    expect((await kill.run({}, ctx)).data).toMatchObject({ reason: 'bad_input' });
  });
});

describe('app_close', () => {
  const setup = (answer = true) => {
    const s = scene([win(1, 'Adsız - Not Defteri', 'notepad', 'Not Defteri'), win(2, 'notlar.txt - Not Defteri', 'notepad', 'Not Defteri'), win(3, 'Haberler - Google Chrome', 'chrome', 'Google Chrome')]);
    const h = harness({ uia: s.uia, input: s.input, sleep: (ms) => s.sleep(ms), ownPid: 999_999_991 });
    const { ctx, approvals } = context({ approve: answer });
    const close = (app: string) => tool(systemControlTools(h.env), 'app_close').run({ app }, ctx);
    return { s, h, approvals, close };
  };

  it('pencere okuyucusu ya da sürücü yoksa sunulmaz', () => {
    expect(systemControlTools(harness().env).map((item) => item.name)).toEqual(['pc_run_command', 'process_kill', 'process_stop']);
  });

  it('onayla uygulamanın bütün pencerelerine kibar kapatma isteği gider; başka uygulamaya dokunulmaz', async () => {
    const { s, h, approvals, close } = setup();
    const result = await close('not defteri');
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ closed: 2 });
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toContain('Not Defteri');
    expect(approvals[0]).toContain('2 pencere');
    expect(s.input.events).toEqual([{ type: 'close', hwnd: 1 }, { type: 'close', hwnd: 2 }]);
    expect(s.input.windows.has(3)).toBe(true);
    expect(h.activity).toEqual(['start:window', 'end:window']);
  });

  it('pencere kapanmadıysa (kaydetme sorusu) “kapandı” denmez', async () => {
    const { s, close } = setup();
    s.input.state.closeWorks = false;
    const result = await close('notepad');
    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({ reason: 'pending', open: 2 });
    expect(result.text).toContain('Kapandı deme');
  });

  it('onay verilmezse hiçbir pencereye dokunulmaz', async () => {
    const { s, close } = setup(false);
    const result = await close('chrome');
    expect(reason(result)).toBe('denied');
    expect(s.input.events).toEqual([]);
  });

  it('Fuber AI’nin kendi penceresi, kabuk ve hassas pencere kapatılmaz; olmayan uygulama bildirilir', async () => {
    const s = scene([
      win(1, 'Fuber AI 2', 'fuber ai 2', 'Fuber AI 2', { own: true }),
      win(2, 'Program Manager', 'explorer', 'Windows Gezgini', { className: 'Progman' }),
      win(3, 'Kasa - 1Password', '1password', '1Password'),
      win(4, 'Fuber Yönetim 2', 'fuber yönetim 2', 'Fuber Yönetim 2'),
    ]);
    const h = harness({ uia: s.uia, input: s.input, sleep: (ms) => s.sleep(ms), ownPid: 999_999_991 });
    const { ctx, approvals } = context();
    const close = (app: string) => tool(systemControlTools(h.env), 'app_close').run({ app }, ctx);
    expect(reason(await close('1'))).toBe('own_window');
    expect(reason(await close('4'))).toBe('own_window');
    expect(reason(await close('2'))).toBe('shell');
    expect(reason(await close('3'))).toBe('sensitive');
    expect(reason(await close('olmayan uygulama xyz'))).toBe('no_window');
    expect(approvals).toEqual([]);
    expect(s.input.events).toEqual([]);
  });

  it('kilitli oturumda ve “Durdur”dan sonra çalışmaz', async () => {
    const { s, h, close } = setup();
    s.uia.state.locked = true;
    expect(reason(await close('notepad'))).toBe('locked');
    s.uia.state.locked = false;
    h.gate.stop();
    expect(reason(await close('notepad'))).toBe('panic');
    expect(s.input.events).toEqual([]);
  });
});

describe('ret denetimi onay kartından ÖNCE (`refuse` kancası)', () => {
  it('pc_run_command: yükseltme, etkileşimli ve kodlanmış komut için neden döner; zararsız komutta null', () => {
    const def = tool(systemControlTools(harness().env), 'pc_run_command');
    const refuse = (command: string) => def.refuse!({ command });
    expect(refuse('Start-Process notepad -Verb RunAs')).toContain('RunAs');
    expect(refuse('$ad = Read-Host "ad"')).toContain('Read-Host');
    expect(refuse('powershell -EncodedCommand ZABpAHIA')).toContain('EncodedCommand');
    expect(refuse('   ')).toBe('Komut boş.');
    expect(refuse('Get-Date')).toBeNull();
    expect(refuse('Get-ChildItem *.pdf | Measure-Object')).toBeNull();
    // Arka plan komutu için de aynı ret geçerlidir.
    expect(def.refuse!({ command: 'sudo npm run dev', background: true })).toContain('sudo');
  });

  it('process_kill: hedefsiz, sistem pid’i ve kendi sürecimiz kart çıkmadan reddedilir; olağan hedefte null', () => {
    const def = tool(systemControlTools(harness({ ownPid: 4242 }).env), 'process_kill');
    expect(def.refuse!({})).toContain('pid ya da tam süreç adı');
    expect(def.refuse!({ pid: 4 })).toContain('sistem süreci');
    expect(def.refuse!({ pid: 4242 })).toContain('kendi süreci');
    expect(def.refuse!({ pid: 99_999 })).toBeNull();
    expect(def.refuse!({ name: 'notepad' })).toBeNull();
  });

  it('`run` aynı denetimi yine yapar (kancayı çağırmayan kayıt için)', async () => {
    const h = harness({ runPowerShell: fakePowerShell(() => ({ output: 'çalışmamalıydı' })) });
    const result = await tool(systemControlTools(h.env), 'pc_run_command').run({ command: 'Start-Process x -Verb RunAs', background: true }, context().ctx);
    expect(result.ok).toBe(false);
    expect(reason(result)).toBe('elevation');
    expect(backgroundProcesses()).toEqual([]);
  });
});

describe('arka plan süreçleri (pc_run_command background, process_output, process_stop)', () => {
  // Zararsız, bitmeyen komut: saniyede beş kez "tik" yazar.
  const TICK = 'while ($true) { Write-Output tik; Start-Sleep -Milliseconds 200 }';
  afterEach(async () => {
    await stopAllBackground();
  });
  const tools = (h: Harness) => [...systemReadTools(h.env), ...systemControlTools(h.env)];
  const start = (h: Harness, command = TICK, ctx = context().ctx) => tool(tools(h), 'pc_run_command').run({ command, background: true }, ctx);
  const output = (h: Harness, input: Record<string, unknown> = {}) => tool(tools(h), 'process_output').run(input, context().ctx);
  const stop = (h: Harness, id: string) => tool(tools(h), 'process_stop').run({ id }, context().ctx);
  const info = (result: ToolResult) => result.data as { id: string; pid: number; state: string; exitCode: number | null };

  it('onay kartı arka planda çalışacağını ve süre sınırı olmadığını açıkça söyler; araçların riski ve kümesi', () => {
    const h = harness();
    const def = tool(tools(h), 'pc_run_command');
    const card = def.approvalText!({ command: TICK, background: true });
    expect(def.risk).toBe('danger');
    expect(card).toContain('ARKA PLANDA');
    expect(card).toContain('Süre sınırı yok');
    expect(card).toContain(TICK);
    expect(card).toContain(scratch.dir);
    // Tanımlar tek başına yeterli ama sınırlı uzunlukta (modülün ortak sınaması 800 karakteri aşanı reddeder).
    for (const name of ['pc_run_command', 'process_output', 'process_stop']) expect(tool(tools(h), name).description.length, name).toBeLessThanOrEqual(780);
    expect(tool(tools(h), 'process_output')).toMatchObject({ risk: 'read', group: 'system' });
    expect(tool(tools(h), 'process_stop')).toMatchObject({ risk: 'write', group: 'system' });
  });

  it('başlatır, çıktısının sonunu ve "çalışıyor"u verir; process_stop ağacı kapatır ve durum "durduruldu" olur', async () => {
    const h = harness({ backgroundFirstWaitMs: 1500 });
    const started = await start(h);
    expect(started.ok).toBe(true);
    const { id, pid } = info(started);
    expect(id).toMatch(/^p\d+$/);
    expect(started.text).toContain(`kimlik ${id} (pid ${pid})`);
    expect(started.text).toContain('process_output');
    expect(started.text).toContain('Süre sınırı yok');
    expect(started.data).toMatchObject({ background: true, state: 'running' });
    expect(alive(pid)).toBe(true);
    expect(h.activity).toEqual(['start:command', 'end:command']);

    // Çıktı gelene dek beklenir (PowerShell'in açılışı bir saniyeyi bulabilir).
    let read = await output(h, { id });
    for (let i = 0; i < 60 && !read.text.includes('tik'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      read = await output(h, { id });
    }
    expect(read.ok).toBe(true);
    expect(read.text).toContain(`Arka plan süreci ${id} (pid ${pid}) · çalışıyor`);
    expect(read.text).toContain('[KOMUT ÇIKTISI');
    expect(read.text).toContain('tik');
    expect(read.data).toMatchObject({ id, state: 'running', running: true, untrusted: true });

    const list = await output(h);
    expect(list.text).toContain(`- ${id} (pid ${pid}) · çalışıyor`);

    const stopped = await stop(h, id);
    expect(stopped.ok).toBe(true);
    expect(stopped.text).toContain(`Durduruldu: ${id}`);
    expect(await waitFor(() => !alive(pid))).toBe(true);
    const after = await output(h, { id });
    expect(after.text).toContain('· durduruldu ·');
    expect(after.data).toMatchObject({ state: 'stopped', running: false });
    // İkinci kez durdurmak zararsız ve dürüst.
    expect((await stop(h, id)).text).toContain('zaten çalışmıyor');
  }, 60_000);

  it('çıktının yalnız sonu döner (max_chars) ve kısaltıldığı söylenir', async () => {
    const h = harness({ backgroundFirstWaitMs: 15_000 });
    const done = await start(h, '1..400 | ForEach-Object { "satir $_" }');
    expect(done.ok).toBe(true);
    const read = await output(h, { id: info(done).id, max_chars: 200 });
    expect(read.text).toContain('satir 400');
    expect(read.text).not.toContain('satir 1\n');
    expect(read.text).toContain('karakterlik çıktının son');
  }, 40_000);

  it('ilk beklemede biten komut olağan komut gibi sonuçlanır (çıkış kodu, çıktı) ve kaydı okunabilir kalır', async () => {
    const h = harness({ backgroundFirstWaitMs: 15_000 });
    const result = await start(h, "Write-Output 'bitti ğüş'; exit 3");
    expect(result.ok).toBe(true);
    expect(result.text).toContain('arka plana alınmadan bitti');
    expect(result.text).toContain('Çıkış kodu: 3');
    expect(result.text).toContain('hata koduyla bitti');
    expect(result.text).toContain('bitti ğüş');
    expect(result.data).toMatchObject({ state: 'exited', exitCode: 3 });
    const read = await output(h, { id: info(result).id });
    expect(read.text).toContain('bitti (çıkış kodu 3)');
  }, 40_000);

  it('aynı anda en çok dört süreç: beşincisi başlamaz, neden ve öneri döner', async () => {
    const h = harness({ backgroundFirstWaitMs: 100 });
    const ids: string[] = [];
    for (let i = 0; i < BACKGROUND_LIMITS.maxRunning; i++) {
      const started = await start(h);
      expect(started.ok).toBe(true);
      ids.push(info(started).id);
    }
    const fifth = await start(h);
    expect(fifth.ok).toBe(false);
    expect(reason(fifth)).toBe('too_many');
    expect(fifth.text).toContain('process_stop');
    for (const id of ids) expect(fifth.text).toContain(id);
    expect(backgroundProcesses().filter((item) => item.state === 'running')).toHaveLength(BACKGROUND_LIMITS.maxRunning);
    // Biri durunca yer açılır.
    await stop(h, ids[0]!);
    const again = await start(h);
    expect(again.ok).toBe(true);
  }, 90_000);

  it('“Durdur” süren bütün arka plan süreçlerini öldürür; ardından yenisi bir süre başlamaz', async () => {
    const h = harness({ backgroundFirstWaitMs: 300 });
    const first = info(await start(h));
    const second = info(await start(h));
    expect(alive(first.pid) && alive(second.pid)).toBe(true);
    h.gate.stop();
    expect(await waitFor(() => !alive(first.pid) && !alive(second.pid))).toBe(true);
    expect(backgroundProcesses().filter((item) => item.state === 'running')).toEqual([]);
    expect((await output(h, { id: first.id })).text).toContain('durduruldu');
    const next = await start(h);
    expect(next.ok).toBe(false);
    expect(reason(next)).toBe('panic');
  }, 60_000);

  it('stopAllBackground (modül kapanışı): hiçbir süreç ayakta kalmaz', async () => {
    const h = harness({ backgroundFirstWaitMs: 300 });
    const pids = [info(await start(h)).pid, info(await start(h)).pid];
    expect(await stopAllBackground()).toBe(2);
    expect(await waitFor(() => pids.every((pid) => !alive(pid)))).toBe(true);
    expect(await stopAllBackground()).toBe(0);
  }, 60_000);

  it('çağrı iptali (ctx.signal) başlamakta olan arka plan sürecini de kapatır', async () => {
    const h = harness({ backgroundFirstWaitMs: 20_000 });
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 1200);
    const result = await start(h, TICK, context({ signal: abort.signal }).ctx);
    expect(result.ok).toBe(false);
    expect(reason(result)).toBe('stopped');
    expect(result.text).toContain('DURDURULDU');
    expect(await waitFor(() => !alive(info(result).pid))).toBe(true);
  }, 40_000);

  it('process_kill pid ile KENDİ arka plan sürecimizi sonlandırır (ailemiz diye reddedilmez); kayıt "durduruldu" olur', async () => {
    const h = harness({ backgroundFirstWaitMs: 300 });
    const { id, pid } = info(await start(h));
    // Uygulamanın kendisi korunmaya devam eder.
    const kill = tool(tools(h), 'process_kill');
    expect((await kill.run({ pid: process.pid }, context().ctx)).data).toMatchObject({ reason: 'protected', protection: 'own' });
    const result = await kill.run({ pid }, context().ctx);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ killed: [pid] });
    expect(await waitFor(() => !alive(pid))).toBe(true);
    expect(await waitFor(() => backgroundProcesses().find((item) => item.id === id)?.state === 'stopped')).toBe(true);
  }, 60_000);

  it('bilinmeyen kimlik ve başkasının süreci: okunmaz, durdurulmaz, dürüst hata', async () => {
    const h = harness();
    const none = await output(h);
    expect(none.ok).toBe(true);
    const missing = await output(h, { id: 'p9999' });
    expect(missing.ok).toBe(false);
    expect(reason(missing)).toBe('not_found');
    // Bu sınama sürecinin kendi pid'i bizim arka plan sürecimiz değildir.
    const foreign = await stop(h, String(process.pid));
    expect(foreign.ok).toBe(false);
    expect(reason(foreign)).toBe('not_found');
    expect((await output(h, { id: String(process.pid) })).ok).toBe(false);
  });

  it('engelli çalışma klasöründe arka plan komutu başlamaz', async () => {
    const h = harness();
    const result = await tool(tools(h), 'pc_run_command').run({ command: TICK, background: true, cwd: process.env.SystemRoot ?? 'C:\\Windows' }, context().ctx);
    expect(result.ok).toBe(false);
    expect(reason(result)).toBe('bad_cwd');
    expect(backgroundProcesses().filter((item) => item.state === 'running')).toEqual([]);
  });
});
