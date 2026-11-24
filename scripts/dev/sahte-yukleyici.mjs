// Sahte Claude Code yükleyicisi (yalnız test/önizleme; Görev 29). Gerçek `irm https://claude.ai/install.ps1 | iex` ASLA çalışmaz.
// SAHTE_YUKLEYICI_MS sonra ~/.local/bin/claude.exe adlı METİN dosyası yazar (ev testte GEÇİCİ; geçici değilse hiçbir şey yazmaz) —
// Fuber yükleyiciden sonra bu yolu arar (FUBER_CLAUDE_KURULU_DENETIM=1), sahte claude FUBER_CLAUDE_KOMUT'la çalışır.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ev = os.homedir();
if (process.env.FUBER_SAHTE_YUKLEYICI_KAYIT) { try { fs.appendFileSync(process.env.FUBER_SAHTE_YUKLEYICI_KAYIT, `${JSON.stringify({ argv: process.argv.slice(2), ev })}\n`); } catch { /* en iyi çaba */ } }
if (!path.resolve(ev).toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase())) { process.stderr.write('sahte-yukleyici: ev klasörü geçici değil — yazılmaz\n'); process.exit(2); }
setTimeout(() => {
  const bin = path.join(ev, '.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'claude.exe'), 'SAHTE claude.exe (metin; çalıştırılmaz)\n');
  process.exit(0);
}, Number(process.env.SAHTE_YUKLEYICI_MS || 300));
