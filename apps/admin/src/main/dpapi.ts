/**
 * Windows DPAPI (`CurrentUser` kapsamı). Yönetim ana süreci tek demettir ve yerel eklenti (koffi)
 * taşımaz; bu yüzden .NET'in `ProtectedData` sınıfı PowerShell üzerinden çağrılır. Veri yalnız süreç
 * borusundan (stdin/stdout, base64) geçer; diske, komut satırına ya da günlüğe yazılmaz.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';

const scriptFor = (op: 'Protect' | 'Unprotect') => `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$inputText = [Console]::In.ReadToEnd().Trim()
$bytes = [Convert]::FromBase64String($inputText)
$out = [System.Security.Cryptography.ProtectedData]::${op}($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($out))
`;

function powershellPath(): string {
  const root = process.env.SystemRoot || 'C:\\Windows';
  return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

export class DpapiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DpapiError';
  }
}

function run(op: 'Protect' | 'Unprotect', data: Buffer, timeoutMs: number): Promise<Buffer> {
  if (process.platform !== 'win32') return Promise.reject(new DpapiError('DPAPI yalnız Windows’ta var.'));
  const encoded = Buffer.from(scriptFor(op), 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const child = spawn(
      powershellPath(),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      reject(new DpapiError(`DPAPI ${timeoutMs / 1000} sn içinde yanıt vermedi.`));
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new DpapiError(`PowerShell başlatılamadı: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const text = Buffer.concat(out).toString('ascii').trim();
      if (code !== 0 || !text) {
        // stderr yalnız PowerShell'in hata metnidir (girdiyi içermez); ilk satırı yeter.
        const reason = Buffer.concat(err).toString('utf8').split(/\r?\n/).find((l) => l.trim()) ?? `çıkış kodu ${code}`;
        reject(new DpapiError(`DPAPI işlemi başarısız: ${reason.trim()}`));
        return;
      }
      resolve(Buffer.from(text, 'base64'));
    });
    child.stdin.end(data.toString('base64'));
  });
}

export const dpapiUnprotect = (data: Buffer, timeoutMs = 20_000) => run('Unprotect', data, timeoutMs);
/** Yalnız sentetik fikstür üretimi için (sınamalar). */
export const dpapiProtect = (data: Buffer, timeoutMs = 20_000) => run('Protect', data, timeoutMs);
