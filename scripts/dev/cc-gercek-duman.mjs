// Görev 26 / Ruling CF + son dalga B (I1, M4) — G27 motorunun GERÇEK claude.exe ile korumalı doğrulaması (3 kısa istem, tek koşu).
// Uygulamanın kendi motoru (main/claudecode/oturum-yoneticisi.ts → CcYonetici, ccKomutu: kullanıcının KURULU claude.exe'si) Electron'suz
// açılır; Agent SDK'nın `query`'si bir modül kancasıyla korumalı sarmala yönlendirilir (cc-duman/kanca.mjs → cc-duman/sdk-sarmal.mjs).
// KORUMALAR (hepsi zorunlu; biri sağlanamazsa hiçbir süreç başlamaz):
//  • Yapılandırma: GEÇİCİ CLAUDE_CONFIG_DIR (motor FUBER_CLAUDE_DIZIN'i çocuk süreçte CLAUDE_CONFIG_DIR'e eşler; sarmal süreç açılmadan
//    denetler) → gerçek ~/.claude'a (ayarlar, kancalar, eklentiler, oturumlar, politika önbellekleri) hiçbir şey yazılmaz/okunmaz.
//    Sonra ~/.claude SALT OKUNUR karşılaştırılır; yeni dosya varsa RAPORLANIR, silinmez.
//  • cwd: YENİ geçici klasörler + sentetik dosyalar. Hiçbir gerçek proje.
//  • Kimlik: TEST anahtarı yalnız o claude sürecine ANTHROPIC_API_KEY olarak (kişisel abonelik değil; yapılandırma dizini geçici
//    olduğundan abonelik girişi zaten bulunamaz). Anahtar hiçbir yere yazılmaz/yazdırılmaz; bütün çıktı gizle()'den geçer.
//  • Model claude-sonnet-5-5; permissionMode 'default' (ASLA atlatma); araç İZİN LİSTESİ (tools: Read, Glob, Grep; Bash yalnız onu sınayan
//    senaryoda ve PreToolUse kalkanıyla yalnız istemdeki zararsız `echo … > isaret-*.txt` / `ls`); canUseTool okumaları yalnız geçici
//    klasörde onaylar, komutları REDDEDER; oturum kalıcılığı kapalı.
//  • Sarmalın yüklendiği süreç açılmadan doğrulanır (kanca yönlendirmesi çalışmadıysa koşum hiçbir şey başlatmadan düşer).
// Senaryolar (her biri tek kısa istem; `--senaryo=A,B,C,D` ile seçilir — gerçek ikili koşuları: ilk tur A,B,C; düzeltme turu yalnız D):
//  A) Telefon kipi (kaynak 'telefon'): geçici kullanıcı ayarında `Bash(*)` allow kuralı → Bash isteği canUseTool'a GELİR, kendiliğinden
//     ÇALIŞMAZ (CC_UZAK_POLITIKA: managedSettings ask + allowManagedPermissionRulesOnly).
//  B) Güven kartı reddedildi: klasörün .claude/settings.json SessionStart kancası (geçici klasöre işaret dosyası yazar) ÇALIŞMAZ; .mcp.json
//     sunucusu başlamaz.
//  C) Güven kartı kabul edildi (aynı klasör): kanca ÇALIŞIR (kapının neden gerektiğinin kanıtı) + kıyas: masadaki oturumda aynı `Bash(*)`
//     kuralıyla zararsız komut canUseTool'a SORULMADAN çalışır (A'daki korumanın gerçek bir kuralı yendiğinin kanıtı).
//  D) Düzeltme turu — telefon oturumu GERÇEK modunda (acceptEdits), güvenilen klasör: motorun SDK PreToolUse kancası ikinci çalışma
//     dizinine (--add-dir; acceptEdits normalde sormaz) yazımı ve Bash'i masaya sorduruyor mu; allowManagedHooksOnly kullanıcının ve
//     klasörün SessionStart kancalarını durduruyor ama Fuber'in SDK kancasını durdurmuyor mu; klasör içi yazım sormadan sürüyor mu.
// Çalıştır: node scripts/dev/cc-gercek-duman.mjs [çıktı-klasörü] [--senaryo=D]   ·   --sahte: tesisat provası (sahte Claude Code; ikili,
// ağ, anahtar yok)
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

register('./cc-duman/kanca.mjs', import.meta.url);

const SAHTE = process.argv.includes('--sahte');
const kokProje = path.resolve(import.meta.dirname, '../..');
const cikti = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(os.tmpdir(), 'fuber-cc-gercek-duman'));
fs.mkdirSync(cikti, { recursive: true });
// Anahtar yalnız gerçek koşuda ve yalnız bu dosyadan okunur (klasördeki başka hiçbir dosya okunmaz).
// Açık kaynak hazırlığı: dosya yolu koddan çıktı — FUBER_CC_DUMAN_ANAHTAR_DOSYASI ortam değişkeniyle verilir.
const anahtarDosyasi = process.env.FUBER_CC_DUMAN_ANAHTAR_DOSYASI;
if (!SAHTE && !anahtarDosyasi) { console.error('Gerçek koşu için FUBER_CC_DUMAN_ANAHTAR_DOSYASI=<anahtar dosyası> ver (ya da --sahte).'); process.exit(2); }
const ANAHTAR = SAHTE ? 'sk-ant-' + 'sahte-duman-0000000000000000' : fs.readFileSync(anahtarDosyasi, 'utf8').trim();
const gizle = (s) => String(s ?? '').split(ANAHTAR).join('[SIR]').replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-[SIR]');
const satirlar = [];
const yaz = (s) => { const t = gizle(s); satirlar.push(t); console.log(t); };
const sonuclar = [];
const kontrol = (ad, tamam, ayrinti = '') => { const a = gizle(typeof ayrinti === 'string' ? ayrinti : JSON.stringify(ayrinti)); sonuclar.push({ ad, tamam: Boolean(tamam), ayrinti: a.slice(0, 1500) }); yaz(`${tamam ? '✅' : '❌'} ${ad}${a ? ` — ${a.slice(0, 700)}` : ''}`); };
const bilgi = (ad, ayrinti) => yaz(`ℹ️  ${ad}: ${gizle(typeof ayrinti === 'string' ? ayrinti : JSON.stringify(ayrinti))}`);
const bekle = (ms) => new Promise((c) => setTimeout(c, ms));

// ── Ortam: test kapıları kapalı; kimlik/taban/yapılandırma değişkenleri silinir; yapılandırma dizini GEÇİCİ ──
for (const k of Object.keys(process.env)) if (/^(FUBER_|ANTHROPIC_|CLAUDE)/i.test(k) || k === 'NODE_TEST_CONTEXT') delete process.env[k];
const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-sondB-duman-'));
const yapilandirma = path.join(kok, 'yapilandirma');
fs.mkdirSync(yapilandirma, { recursive: true });
// Geçici "kullanıcı ayarı": her komuta izin veren kural (telefon politikası bunu yenmeli — senaryo A) ve SessionStart kancası (oturumun
// klasörüne, yalnız geçici kökün içindeyse, işaret yazar — senaryo D: telefon oturumunda allowManagedHooksOnly bunu durdurmalı).
const ileri0 = (p) => p.split(path.sep).join('/');
fs.writeFileSync(path.join(kok, 'kullanici-kanca.cjs'), [
  "let v = ''; process.stdin.on('data', (c) => { v += c; }); process.stdin.on('end', () => {",
  "  try { const j = JSON.parse(v); const p = require('path'); const k = " + JSON.stringify(kok) + ";",
  "    if (typeof j.cwd === 'string' && p.resolve(j.cwd).toLowerCase().startsWith(p.resolve(k).toLowerCase())) require('fs').appendFileSync(p.join(j.cwd, 'kanca-kullanici-isaret.txt'), 'x');",
  "  } catch { /* yok */ } });",
].join('\n'));
fs.writeFileSync(path.join(yapilandirma, 'settings.json'), JSON.stringify({
  permissions: { allow: ['Bash(*)'] },
  hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `node "${ileri0(path.join(kok, 'kullanici-kanca.cjs'))}"` }] }] },
}, null, 1));
process.env.CLAUDE_CONFIG_DIR = yapilandirma; // ana süreçteki SDK (resolveSettings) aynı dizini görsün
process.env.FUBER_CLAUDE_DIZIN = yapilandirma; // motor çocuk sürece CLAUDE_CONFIG_DIR olarak geçirir
if (SAHTE) process.env.FUBER_CLAUDE_KOMUT = JSON.stringify([process.execPath, path.join(import.meta.dirname, 'sahte-claude.mjs')]);

const ileri = (p) => p.split(path.sep).join('/');
const A = path.join(kok, 'a');
fs.mkdirSync(A);
fs.writeFileSync(path.join(A, 'notlar.txt'), 'Fuber AI son dalga B duman testi (sentetik).\n');
fs.writeFileSync(path.join(A, 'sehirler.txt'), 'İstanbul\nAnkara\n');
const B = path.join(kok, 'b');
fs.mkdirSync(path.join(B, '.claude'), { recursive: true });
fs.writeFileSync(path.join(B, 'kanca.cjs'), "require('fs').appendFileSync(require('path').join(__dirname, 'kanca-isaret.txt'), new Date().toISOString() + '\\n');\n");
fs.writeFileSync(path.join(B, 'mcp.cjs'), "require('fs').appendFileSync(require('path').join(__dirname, 'mcp-isaret.txt'), new Date().toISOString() + '\\n'); process.exit(0);\n");
fs.writeFileSync(path.join(B, '.claude', 'settings.json'), JSON.stringify({
  hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `node "${ileri(path.join(B, 'kanca.cjs'))}"` }] }] },
  permissions: { allow: ['Bash(*)'] },
}, null, 1));
fs.writeFileSync(path.join(B, '.mcp.json'), JSON.stringify({ mcpServers: { isaret: { command: 'node', args: [ileri(path.join(B, 'mcp.cjs'))] } } }, null, 1));
fs.writeFileSync(path.join(B, 'okuma.txt'), 'sentetik\n');
// Senaryo D (düzeltme turu): güvenilen klasör, kendi SessionStart kancası; E = geçici kökte ikinci çalışma dizini (--add-dir).
const D = path.join(kok, 'd');
const E = path.join(kok, 'e');
fs.mkdirSync(path.join(D, '.claude'), { recursive: true });
fs.mkdirSync(E, { recursive: true });
fs.writeFileSync(path.join(D, 'kanca.cjs'), "require('fs').appendFileSync(require('path').join(__dirname, 'kanca-proje-isaret.txt'), 'x');\n");
fs.writeFileSync(path.join(D, '.claude', 'settings.json'), JSON.stringify({
  hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `node "${ileri(path.join(D, 'kanca.cjs'))}"` }] }] },
  permissions: { allow: ['Bash(*)'] },
}, null, 1));
fs.writeFileSync(path.join(D, 'okuma.txt'), 'sentetik\n');
const var_ = (p) => fs.existsSync(p);
const SECIM = (process.argv.find((x) => x.startsWith('--senaryo='))?.split('=')[1] ?? 'A,B,C,D').toUpperCase().split(',').map((x) => x.trim());

// ── Gerçek ~/.claude: SALT OKUNUR anlık görüntü (yol kümesi) ──
const ev = os.homedir();
const gercekClaude = path.join(ev, '.claude');
const yollar = (kokDiz, sinir = 400_000) => {
  const s = new Set();
  const yigin = [kokDiz];
  while (yigin.length && s.size < sinir) {
    const d = yigin.pop();
    let g = [];
    try { g = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of g) { const p = path.join(d, e.name); s.add(p); if (e.isDirectory() && !e.isSymbolicLink()) yigin.push(p); }
  }
  return s;
};
const mtime = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return null; } };

globalThis.__ccDuman = { anahtar: ANAHTAR, kok, yapilandirma, sarmal: null, senaryo: null, izinler: [], kalkan: [], calisan: [], acilis: [], spawn: [], secenekler: [], init: [], sonuc: [], motorKanca: [] };
const d = globalThis.__ccDuman;
const ozetCikti = { zaman: new Date().toISOString(), sahte: SAHTE, senaryolar: {} };
const t0 = Date.now();

async function ana() {
  const once = { yollar: yollar(gercekClaude), claudeJson: mtime(path.join(ev, '.claude.json')) };
  bilgi('gerçek ~/.claude anlık görüntüsü (salt okunur)', `${once.yollar.size} yol`);

  const { CcYonetici, ccUzakPolitikaEtkinMi, CC_UZAK_POLITIKA } = await import(pathToFileURL(path.join(kokProje, 'src/main/claudecode/oturum-yoneticisi.ts')).href);
  const { ccKomutu, claudeYolu } = await import(pathToFileURL(path.join(kokProje, 'src/main/claudecode/yurutucu.ts')).href);
  // Ön uçuş: motorun SDK'yı yüklemesi (sdkYukle) kanca üzerinden sarmala gitmeli — süreç açılmadan önce.
  const politika = await ccUzakPolitikaEtkinMi(A);
  kontrol('Sarmal yüklendi (kanca yönlendirmesi çalıştı) — süreç açılmadan önce', d.sarmal === 'yuklendi', String(d.sarmal));
  if (d.sarmal !== 'yuklendi') throw new Error('DUMAN KORUMASI: sarmal yüklenmedi; hiçbir süreç başlatılmadı');
  kontrol('Ön uçuş: telefon politikası (CC_UZAK_POLITIKA) bu makinede etkin — SDK resolveSettings, geçici yapılandırma dizini', politika === true, { politika });
  const exe = SAHTE ? 'sahte' : claudeYolu();
  yaz(`claude: ${exe ?? 'YOK'}`);
  if (!exe) { kontrol('Kurulu claude.exe bulundu', false); return; }
  const komutKapisi = () => {
    if (d.sarmal !== 'yuklendi' || !d.senaryo) throw new Error('DUMAN KORUMASI: sarmal/senaryo yok');
    return ccKomutu();
  };

  async function senaryo(ad, { cwd, kaynak, karar, araclar, istem, mod = 'default', ekKlasorler }) {
    d.senaryo = { ad, cwd, araclar, ...(ekKlasorler ? { ekKlasorler } : {}) };
    const olaylar = [];
    let sonuc = null;
    let y;
    y = new CcYonetici({
      komut: komutKapisi,
      ayar: () => ({ tamYetki: false, varsayilanMod: mod }),
      olay: (z) => { olaylar.push(z.olay); if (z.olay.tur === 'sonuc') sonuc = z.olay; },
      // Motorun kendi izin yolu: okuma (sarmal yalnız geçici klasör içini iletir) onaylanır; komut REDDEDİLİR.
      izinBekliyor: (o, i) => y.izinYanitla(o.id, i.istekId, ['Read', 'Glob', 'Grep'].includes(i.arac) ? { karar: 'izin' } : { karar: 'ret', neden: 'Duman testi: komut masada reddedildi.' }),
      klasorGuveni: () => karar,
      istemci: 'fuber-ai/sondB-duman',
      kapanisSuresiMs: 5000,
    });
    const bas = Date.now();
    let r;
    try {
      r = await y.baslat({ cwd, istem, mod, model: 'claude-sonnet-5-5', kaynak });
      if (r.tamam) {
        const son = Date.now() + 180_000;
        while (!sonuc && Date.now() < son) { if (y.ozetAl(r.oturum?.id)?.durum === 'hata') break; await bekle(250); }
      }
    } finally { await y.hepsiniKapat().catch(() => undefined); }
    await bekle(800); // kanca/MCP süreçlerinin yazması
    const metin = olaylar.filter((o) => o.tur === 'metin' && o.ust === null).map((o) => o.metin).join('\n');
    const s = { ad, cwd, baslat: { tamam: r?.tamam, kod: r?.kod, hata: r?.hata }, sureMs: Date.now() - bas, sonuc, metin: metin.slice(0, 300),
      izinIstekleri: olaylar.filter((o) => o.tur === 'izin-istegi').map((o) => ({ arac: o.arac, ozet: String(o.ozet ?? '').slice(0, 120), herZamanSunulur: o.herZamanSunulur })),
      sistem: olaylar.filter((o) => o.tur === 'sistem').map((o) => `${o.seviye}: ${o.metin}`),
      init: d.init.filter((x) => x.senaryo === ad), sarmalIzin: d.izinler.filter((x) => x.senaryo === ad), kalkan: d.kalkan.filter((x) => x.senaryo === ad),
      calisan: d.calisan.filter((x) => x.senaryo === ad), acilis: d.acilis.filter((x) => x.senaryo === ad), secenek: d.secenekler.find((x) => x.senaryo === ad) ?? null,
      sonucHam: d.sonuc.filter((x) => x.senaryo === ad), spawn: d.spawn.filter((x) => x.senaryo === ad), motorKanca: d.motorKanca.filter((x) => x.senaryo === ad) };
    ozetCikti.senaryolar[ad] = s;
    bilgi(`${ad} özet`, { baslat: s.baslat, sonuc: s.sonucHam, izin: s.izinIstekleri, sarmalIzin: s.sarmalIzin, motorKanca: s.motorKanca, calisan: s.calisan, kalkan: s.kalkan, acilis: s.acilis, secenek: s.secenek, init: s.init.map((x) => ({ ...x, araclar: x.araclar.length })), metin: s.metin, sistem: s.sistem });
    return s;
  }
  const initAdi = (s) => s.init[0]?.apiKeySource;

  let sa = null, sb = null, sc = null, sd = null;
  // ── A) Telefon kipi: Bash(*) allow kuralına rağmen komut masada onay bekler ──
  if (SECIM.includes('A')) {
  sa = await senaryo('A-telefon', { cwd: A, kaynak: 'telefon', karar: undefined, araclar: ['Read', 'Glob', 'Grep', 'Bash'],
    istem: SAHTE ? '#izin' : 'Bash aracıyla şu iki komutu ayrı ayrı çalıştır: önce `echo fuber-a > isaret-a.txt`, sonra `ls`. İzin verilmezse yeniden deneme ve başka araç kullanma; sonucu tek kısa cümleyle yaz.' });
  kontrol('A: oturum telefon kipinde başladı (kart sorulmadı: klasörün kendi ayarı yok)', sa.baslat.tamam === true, sa.baslat);
  kontrol('A: süreç CC_UZAK_POLITIKA ile açıldı (managedSettings: allowManagedPermissionRulesOnly + ask Bash/PowerShell); komutlar kapatılmadı',
    JSON.stringify(sa.secenek?.managedSettings) === JSON.stringify(CC_UZAK_POLITIKA) && sa.secenek?.disallowedTools === null && sa.secenek?.settingSources === null, sa.secenek);
  const aBash = sa.sarmalIzin.filter((x) => x.arac === 'Bash');
  kontrol('A: Bash isteği canUseTool’a GELDİ (masadaki izin kartı yolu) ve reddedildi', SAHTE ? aBash.length >= 1 : aBash.length >= 1 && sa.izinIstekleri.some((x) => x.arac === 'Bash'), { bash: aBash, motor: sa.izinIstekleri });
  kontrol('A: hiçbir komut kendiliğinden ÇALIŞMADI (PostToolUse yok, isaret-a.txt yok)', sa.calisan.length === 0 && !var_(path.join(A, 'isaret-a.txt')), { calisan: sa.calisan, isaret: var_(path.join(A, 'isaret-a.txt')) });
  kontrol('A: telefon oturumunda Bash izin kartında "Bu oturumda hep izin ver" yok', sa.izinIstekleri.filter((x) => x.arac === 'Bash').every((x) => x.herZamanSunulur === false), sa.izinIstekleri);
  if (!SAHTE) kontrol('A: kimlik TEST anahtarı (system/init apiKeySource = ANTHROPIC_API_KEY)', initAdi(sa) === 'ANTHROPIC_API_KEY', { apiKeySource: initAdi(sa) });
  }

  // ── B) Güven kartı reddedildi: klasörün kancası ve MCP'si yüklenmez ──
  if (SECIM.includes('B')) {
  sb = await senaryo('B-guvenme', { cwd: B, kaynak: 'sayfa', karar: 'guvenme', araclar: ['Read', 'Glob', 'Grep'], istem: SAHTE ? '#durum' : "Yalnızca 'tamam' yaz." });
  kontrol('B: süreç --setting-sources user (proje + yerel YOK) ve --strict-mcp-config ile açıldı',
    JSON.stringify(sb.secenek?.settingSources) === '["user"]' && sb.secenek?.strictMcpConfig === true && sb.secenek?.managedSettings === null, sb.secenek);
  const kancaB = var_(path.join(B, 'kanca-isaret.txt'));
  const mcpB = var_(path.join(B, 'mcp-isaret.txt'));
  kontrol('B: klasörün SessionStart kancası ÇALIŞMADI ve .mcp.json sunucusu başlamadı', !kancaB && !mcpB && (sb.init[0]?.mcp ?? []).length === 0, { kanca: kancaB, mcp: mcpB, initMcp: sb.init[0]?.mcp, sdkAcilis: sb.acilis });
  kontrol('B: dökümde "ayarları yüklenmedi (güvenmedin)" notu', sb.sistem.some((x) => /yüklenmedi \(güvenmedin\)/.test(x)), sb.sistem);
  }

  // ── C) Güven kartı kabul edildi (aynı klasör) + kıyas: masada allow kuralı komutu sormadan çalıştırır ──
  if (SECIM.includes('C')) {
  sc = await senaryo('C-guven', { cwd: B, kaynak: 'sayfa', karar: 'guven', araclar: ['Read', 'Glob', 'Grep', 'Bash'],
    istem: SAHTE ? '#durum' : "Bash aracıyla `echo fuber-c > isaret-c.txt` komutunu bir kez çalıştır, sonra yalnızca 'tamam' yaz." });
  kontrol('C: süreç bütün ayar kaynaklarıyla açıldı (settingSources verilmedi, strict-mcp yok)', sc.secenek?.settingSources === null && sc.secenek?.strictMcpConfig === false, sc.secenek);
  const kancaC = var_(path.join(B, 'kanca-isaret.txt'));
  if (SAHTE) bilgi('C: kanca (sahte Claude Code kanca çalıştırmaz)', 'atlandı');
  else kontrol('C: güvenilen klasörde SessionStart kancası ÇALIŞTI (kapı olmasa B’de de çalışacaktı)', kancaC, { kanca: kancaC, sdkAcilis: sc.acilis });
  const cBash = sc.sarmalIzin.filter((x) => x.arac === 'Bash');
  if (SAHTE) bilgi('C: kıyas (sahte Claude Code komut çalıştırmaz)', 'atlandı');
  else kontrol('C (kıyas): masadaki oturumda `Bash(*)` kuralı komutu canUseTool’a SORMADAN çalıştırdı — A’daki korumanın yendiği gerçek bir kural',
    cBash.length === 0 && sc.calisan.some((x) => /isaret-c/.test(x.komut)) && var_(path.join(B, 'isaret-c.txt')), { canUseTool: cBash, calisan: sc.calisan, isaret: var_(path.join(B, 'isaret-c.txt')) });
  bilgi('C: .mcp.json sunucusu (güvenilen klasör; yalnız bilgi)', { mcpIsaret: var_(path.join(B, 'mcp-isaret.txt')), initMcp: sc.init[0]?.mcp });
  }

  // ── D) Düzeltme turu: telefon oturumu GERÇEK modunda (acceptEdits), güvenilen klasör. Motorun SDK PreToolUse kancası politika
  // katmanından bağımsız soruyor mu; allowManagedHooksOnly kullanıcı + proje kancalarını durduruyor mu (ve SDK kancasını durdurmuyor mu)?
  //  • `serbest.txt` (oturum klasörü): acceptEdits SORMADAN yazar (kıyas; kanca karışmaz).
  //  • `E/isaret.txt`: E ikinci çalışma dizini (--add-dir) → acceptEdits normalde SORMADAN yazardı; kanca "klasör dışı" der → canUseTool.
  //  • `echo fuber-d > isaret-d.txt` (Bash): kanca 'ask' (+ politika ask) → canUseTool → reddedilir.
  if (SECIM.includes('D')) {
  sd = await senaryo('D-telefon-kanca', { cwd: D, kaynak: 'telefon', karar: 'guven', mod: 'acceptEdits', ekKlasorler: [E], araclar: ['Read', 'Glob', 'Grep', 'Write', 'Bash'],
    istem: SAHTE ? `#yaz:${ileri(path.join(E, 'isaret.txt'))}` : `Şunları sırayla yap: (1) Write aracıyla \`serbest.txt\` dosyasını "x" içeriğiyle oluştur. (2) Write aracıyla \`${ileri(path.join(E, 'isaret.txt'))}\` dosyasını "x" içeriğiyle oluştur. (3) Bash aracıyla \`echo fuber-d > isaret-d.txt\` çalıştır. İzin verilmeyeni yeniden deneme ve başka araç kullanma; sonucu tek kısa cümleyle yaz.` });
  kontrol('D: telefon oturumu acceptEdits’te başladı; süreç CC_UZAK_POLITIKA (allowManagedHooksOnly dahil) ile; komutlar kapatılmadı (politika etkin)',
    sd.baslat.tamam === true && JSON.stringify(sd.secenek?.managedSettings) === JSON.stringify(CC_UZAK_POLITIKA) && sd.secenek?.disallowedTools === null && sd.secenek?.settingSources === null, { baslat: sd.baslat, secenek: sd.secenek });
  const dKancaYaz = sd.motorKanca.filter((x) => x.arac === 'Write' && /[\\/]e[\\/]isaret\.txt$/i.test(String(x.yol)));
  const dKancaBash = sd.motorKanca.filter((x) => x.arac === 'Bash');
  kontrol('D: motorun SDK PreToolUse kancası telefon oturumunda ÇAĞRILDI (allowManagedHooksOnly onu durdurmadı) — E’ye yazım ve Bash için "ask"',
    dKancaYaz.length >= 1 && dKancaYaz.every((x) => x.karar === 'ask') && (SAHTE || (dKancaBash.length >= 1 && dKancaBash.every((x) => x.karar === 'ask'))), sd.motorKanca);
  const dYazIzin = sd.sarmalIzin.filter((x) => x.arac === 'Write' && /[\\/]e[\\/]isaret\.txt$/i.test(String(x.yol)));
  kontrol('D: E’ye yazım canUseTool’a GELDİ (kanca nedeniyle) ve reddedildi; dosya YOK',
    dYazIzin.length >= 1 && !var_(path.join(E, 'isaret.txt')), { yaz: dYazIzin, dosya: var_(path.join(E, 'isaret.txt')) });
  if (SAHTE) bilgi('D: kıyas + kanca dosyaları (sahte Claude Code yazmaz/kanca çalıştırmaz)', 'atlandı');
  else {
    kontrol('D (kıyas): oturum klasörüne `serbest.txt` canUseTool’a SORULMADAN yazıldı (kanca klasör içine karışmaz)',
      var_(path.join(D, 'serbest.txt')) && !sd.sarmalIzin.some((x) => x.arac === 'Write' && /serbest\.txt$/.test(String(x.yol))), { dosya: var_(path.join(D, 'serbest.txt')), izin: sd.sarmalIzin });
    kontrol('D: Bash canUseTool’a geldi, reddedildi, çalışmadı (isaret-d.txt yok)', sd.sarmalIzin.some((x) => x.arac === 'Bash') && !sd.calisan.some((x) => x.arac === 'Bash') && !var_(path.join(D, 'isaret-d.txt')), { izin: sd.sarmalIzin.filter((x) => x.arac === 'Bash'), calisan: sd.calisan });
    const proje = var_(path.join(D, 'kanca-proje-isaret.txt')), kullanici = var_(path.join(D, 'kanca-kullanici-isaret.txt'));
    kontrol('D: allowManagedHooksOnly — güvenilen klasörün VE kullanıcının SessionStart kancası telefon oturumunda ÇALIŞMADI', !proje && !kullanici, { proje, kullanici });
  }
  bilgi('D: canUseTool decisionReason (kancadan mı?)', sd.sarmalIzin.map((x) => ({ arac: x.arac, yol: x.yol, komut: x.komut, neden: x.neden })));
  }

  // ── Ortak ──
  const hepsi = [sa, sb, sc, sd].filter(Boolean);
  const kokIleri = ileri(kok).toLowerCase();
  kontrol('Kalkan: izin listesi dışında hiçbir komut/düzenleme denenmedi; çalışanlar yalnız zararsız komutlar ve geçici kök içi yazımlar',
    hepsi.every((s) => s.kalkan.length === 0) && hepsi.every((s) => s.calisan.every((x) => (x.arac === 'Write' || x.arac === 'Edit') ? Boolean(x.yol) && ileri(path.resolve(s.cwd, x.yol)).toLowerCase().startsWith(kokIleri) : /^(echo fuber-[a-d] > isaret-[a-d]\.txt|ls( -[A-Za-z1]+)?( \.)?|pwd|dir)$/.test(String(x.komut).trim()))),
    hepsi.map((s) => ({ kalkan: s.kalkan, calisan: s.calisan })));
  kontrol('Araç izin listesi: init’teki araçlar yalnız senaryonun listesi (+ MCP yok)', hepsi.every((s) => (s.init[0]?.araclar ?? []).every((t) => s.secenek?.tools.includes(t))) || SAHTE, hepsi.map((s) => s.init[0]?.araclar));
  if (!SAHTE) kontrol('Her istemde kimlik TEST anahtarı (apiKeySource = ANTHROPIC_API_KEY)', hepsi.every((s) => initAdi(s) === 'ANTHROPIC_API_KEY'), hepsi.map(initAdi));
  const maliyet = hepsi.reduce((t, s) => t + (s.sonucHam[0]?.total_cost_usd ?? 0), 0);
  bilgi('Maliyet (CLI total_cost_usd toplamı)', `$${maliyet.toFixed(4)} · ${hepsi.map((s) => `${s.ad} $${(s.sonucHam[0]?.total_cost_usd ?? 0).toFixed(4)}`).join(' · ')}`);
  bilgi('init eklentileri (yalnız adlar, geçici yapılandırma dizini)', hepsi.map((s) => ({ [s.ad]: s.init[0]?.eklentiler ?? [] })));
  ozetCikti.maliyetUsd = maliyet;

  // ── Sonrası: geçici yapılandırma dizinine ne yazıldı (adlar) ve gerçek ~/.claude (SALT OKUNUR) ──
  await bekle(1500);
  const gecici = [...yollar(yapilandirma)].map((p) => ileri(path.relative(yapilandirma, p))).sort();
  bilgi('Geçici CLAUDE_CONFIG_DIR’e yazılanlar (adlar)', gecici.slice(0, 60));
  ozetCikti.geciciYapilandirma = gecici;
  const sonra = { yollar: yollar(gercekClaude), claudeJson: mtime(path.join(ev, '.claude.json')) };
  const yeni = [...sonra.yollar].filter((p) => !once.yollar.has(p)).map((p) => ileri(path.relative(gercekClaude, p)));
  const buKosudan = yeni.filter((p) => /fuber-sondB-duman|policy-limits|remote-settings/i.test(p) || !p.includes('/'));
  ozetCikti.gercekClaude = { yeni, buKosudan, claudeJsonDegisti: once.claudeJson !== sonra.claudeJson };
  bilgi('Gerçek ~/.claude’da koşu sırasında beliren yeni yollar (eşzamanlı oturumlar dahil; SİLİNMEDİ)', yeni.slice(0, 80));
  kontrol('Gerçek ~/.claude: bu koşudan yeni dosya YOK (geçici yol adı, policy-limits*/remote-settings*, yeni üst düzey girdi) ve ~/.claude.json değişmedi',
    buKosudan.length === 0 && once.claudeJson === sonra.claudeJson, { buKosudan, claudeJsonDegisti: once.claudeJson !== sonra.claudeJson });
}

try {
  await ana();
} catch (e) {
  kontrol('Koşum düşmeden tamamlandı', false, gizle(e?.stack ?? e));
} finally {
  ozetCikti.sureMs = Date.now() - t0;
  ozetCikti.sonuclar = sonuclar;
  fs.writeFileSync(path.join(cikti, 'cc-gercek-duman.json'), gizle(JSON.stringify(ozetCikti, null, 2)));
  fs.writeFileSync(path.join(cikti, 'cc-gercek-duman.txt'), gizle(satirlar.join('\n')));
  try { fs.rmSync(kok, { recursive: true, force: true }); } catch { /* süreç tutuyorsa kalır (geçici klasör) */ }
  const k = sonuclar.filter((x) => !x.tamam).length;
  yaz(`${sonuclar.length - k}/${sonuclar.length} denetim geçti · ${Math.round((Date.now() - t0) / 1000)} sn`);
  process.exitCode = k ? 1 : 0;
}
