// Sahte `graphify` (yalnız test/önizleme; Görev 29). Gerçek Graphify ve kullanıcının ~/.claude'u YOK: beceri ve kanca kaydı yalnız
// CLAUDE_CONFIG_DIR / FUBER_CLAUDE_DIZIN altında (ikisi de yoksa YAZMAZ). Argümanlarını ve GRAPHIFY_QUERY_LOG_DISABLE'ı FUBER_SAHTE_GRAPHIFY_KAYIT'a yazar.
//   install --platform windows   → skills/graphify/SKILL.md + sahte-graphify-kanca.json (gerçeğinde settings.json'da PreToolUse kancası)
//   claude uninstall             → ikisini siler                    SAHTE_GRAPHIFY_DUS=1 → kurulum düşer
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
if (process.env.FUBER_SAHTE_GRAPHIFY_KAYIT) {
  try { fs.appendFileSync(process.env.FUBER_SAHTE_GRAPHIFY_KAYIT, `${JSON.stringify({ argv, GRAPHIFY_QUERY_LOG_DISABLE: process.env.GRAPHIFY_QUERY_LOG_DISABLE, yol: (process.env.PATH || process.env.Path || '').split(path.delimiter)[0] })}\n`); } catch { /* en iyi çaba */ }
}
const d = process.env.CLAUDE_CONFIG_DIR || process.env.FUBER_CLAUDE_DIZIN;
if (!d) { process.stderr.write('sahte-graphify: CLAUDE_CONFIG_DIR / FUBER_CLAUDE_DIZIN yok — gerçek ~/.claude\'a yazılmaz\n'); process.exit(2); }
const beceri = path.join(d, 'skills', 'graphify');
const kanca = path.join(d, 'sahte-graphify-kanca.json');
if (argv[0] === 'install') {
  if (process.env.SAHTE_GRAPHIFY_DUS === '1') { process.stderr.write('sahte-graphify: Claude Code ayarları yazılamadı\n'); process.exit(1); }
  if (argv[1] !== '--platform' || argv[2] !== 'windows') { process.stderr.write(`sahte-graphify: beklenen --platform windows (gelen: ${argv.slice(1).join(' ')})\n`); process.exit(1); }
  fs.mkdirSync(beceri, { recursive: true });
  fs.writeFileSync(path.join(beceri, 'SKILL.md'), '---\nname: graphify\ndescription: Kod tabanının bilgi grafiğini sorgular (sahte).\n---\n\n# graphify (sahte)\n');
  fs.writeFileSync(kanca, JSON.stringify({ PreToolUse: [{ matcher: 'Grep|Glob', hooks: [{ type: 'command', command: 'graphify hook' }] }] }));
  process.stdout.write('graphify: Claude Code skill and PreToolUse hook installed\n');
  process.exit(0);
}
if (argv[0] === 'claude' && argv[1] === 'uninstall') {
  fs.rmSync(beceri, { recursive: true, force: true });
  fs.rmSync(kanca, { force: true });
  process.stdout.write('graphify: removed from Claude Code\n');
  process.exit(0);
}
process.stderr.write(`sahte-graphify: bilinmeyen komut ${argv.join(' ')}\n`);
process.exit(2);
