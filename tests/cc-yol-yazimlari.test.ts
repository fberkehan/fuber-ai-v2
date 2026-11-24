// Son dalga B düzeltme turu 2: Windows yol yazımları — yerleşik bağlantılar (junction), 8.3 kısa adlar, \\?\ / \\.\ / UNC, alternatif veri
// akışı, sonu nokta/boşluk. Klasör sınırı (N2) ve düzenleme kancası metin değil GERÇEK yolla karşılaştırır. Parmak izi bütçesi (N3).
// Gerçek bağlantılar/kısa adlar bu bilgisayarda yoksa ilgili denetim atlanır (skip). Gerçek claude.exe çalışmaz.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const kok = path.resolve(import.meta.dirname, '..');
const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-cc-yol-')));
process.env.FUBER_CLAUDE_DIZIN = path.join(tmp, '.claude');
delete process.env.CLAUDE_CONFIG_DIR;
process.env.FUBER_CLAUDE_KOMUT = JSON.stringify([process.execPath, path.join(kok, 'scripts/dev/sahte-claude.mjs')]);
delete process.env.SAHTE_CC_KURALLAR;
delete process.env.FUBER_SAHTE_CLAUDE_KAYIT;

const { gercekYol, gercekYolBilgisi, agYoluMu, supheliYazim, korunanKlasorNedeni, korunanKlasorDenetimi, varsayilanKlasorSinirlari, klasorAyarlariniBul, klasorGuvenDurumu, izOnbellekBoyu, sinirOnbelleginiBosalt, IZ_SINIRSIZ } = await import('../src/main/claudecode/klasor-guveni.ts');
const { CcYonetici, ccOnKancaKarari } = await import('../src/main/claudecode/oturum-yoneticisi.ts');
const { ccKomutu } = await import('../src/main/claudecode/yurutucu.ts');
type Sinirlar = import('../src/main/claudecode/klasor-guveni.ts').KlasorSinirlari;
type Yonetici = InstanceType<typeof CcYonetici>;

const acik: Yonetici[] = [];
after(async () => { for (const y of acik) await y.hepsiniKapat(); fs.rmSync(tmp, { recursive: true, force: true }); });
const WIN = process.platform === 'win32';
const ev = os.homedir();
const appData = process.env.APPDATA || path.join(ev, 'AppData', 'Roaming');
let sayac = 0;
const klasor = (ad = 'k') => { const d = path.join(tmp, `${ad}-${++sayac}`); fs.mkdirSync(d, { recursive: true }); return d; };
/** Bağlantı (Windows'ta junction; yönetici gerekmez). */
const baglanti = (hedef: string, yol: string) => { fs.symlinkSync(hedef, yol, WIN ? 'junction' : 'dir'); return yol; };
const varMi = (p: string) => { try { fs.statSync(p); return true; } catch { return false; } };

// ── N2: klasör sınırı gerçek yolla ───────────────────────────────────────────────────────────────────────────────────────────
test('gercekYol: bağlantı ve kısa ad çözülür; var olmayan kuyruk korunur; ağ/aygıt yolu tanınır', () => {
  const hedef = klasor('hedef');
  const b = baglanti(hedef, path.join(tmp, `bag-${++sayac}`));
  assert.equal(gercekYol(b), hedef);
  assert.equal(gercekYol(path.join(b, 'yok', 'dosya.txt')), path.join(hedef, 'yok', 'dosya.txt'));
  for (const p of ['\\\\?\\C:\\Kullanicilar', '\\\\.\\C:\\x', '\\\\sunucu\\pay\\a', '//sunucu/pay']) assert.equal(agYoluMu(p), true, p);
  assert.equal(agYoluMu('C:\\Kullanicilar'), false);
});

test('N2: bağlantı üzerinden ev klasörü / korunan klasör reddedilir; bağlantı üzerinden sıradan proje açılır', () => {
  const evSahte = klasor('ev');
  const hassas = klasor('veri');
  const s: Sinirlar = { ev: evSahte, ust: [], hassas: [hassas], sistem: [] };
  assert.ok(korunanKlasorNedeni(baglanti(evSahte, path.join(tmp, `evbag-${++sayac}`)), s), 'ev klasörüne bağlantı');
  assert.ok(korunanKlasorNedeni(path.join(baglanti(hassas, path.join(tmp, `veribag-${++sayac}`)), 'alt'), s), 'korunan klasörün içine bağlantı');
  const proje = klasor('proje');
  assert.equal(korunanKlasorNedeni(baglanti(proje, path.join(tmp, `projebag-${++sayac}`)), s), null);
  for (const p of ['\\\\?\\C:\\Kullanicilar\\x', '\\\\.\\C:\\x', '\\\\localhost\\C$\\Users']) assert.match(korunanKlasorNedeni(p, s) ?? '', /ağ ya da aygıt yolu/, p);
});

test('N2: Windows yerleşik bağlantıları ve 8.3 kısa adları (bu bilgisayarda varsa) reddedilir', { skip: !WIN }, (t) => {
  const s = varsayilanKlasorSinirlari({ veri: path.join(appData, 'fuber-yol-testi-yok'), claudeDizini: path.join(ev, '.claude'), belgeler: path.join(ev, 'Documents') });
  const kullanici = path.basename(ev);
  // [yol, beklenen neden, var olması gereken (bağlantı/kısa ad) kısım]
  const adaylar: [string, RegExp, string][] = [
    [`C:\\Documents and Settings\\${kullanici}`, /ev klasörü/, 'C:\\Documents and Settings'],
    [path.join(ev, 'Start Menu'), /korunan/, path.join(ev, 'Start Menu')],
    [path.join(ev, 'Application Data'), /AppData/, path.join(ev, 'Application Data')],
    [path.join(ev, 'Application Data', 'fuber-yol-testi-yok'), /korunan/, path.join(ev, 'Application Data')],
    [path.join(ev, 'Local Settings'), /AppData/, path.join(ev, 'Local Settings')],
    ['C:\\PROGRA~1', /sistem/, 'C:\\PROGRA~1'],
    [path.join(ev, 'APPLIC~1'), /AppData/, path.join(ev, 'APPLIC~1')],
    [path.join(ev, 'STARTM~1'), /korunan/, path.join(ev, 'STARTM~1')],
  ];
  let denenen = 0;
  for (const [p, beklenen, gerek] of adaylar) {
    if (!varMi(gerek)) { t.diagnostic(`yok, atlandı: ${gerek}`); continue; }
    denenen++;
    assert.match(korunanKlasorNedeni(p, s) ?? 'AÇILDI', beklenen, p);
  }
  t.diagnostic(`${denenen}/${adaylar.length} gerçek takma ad denendi`);
});

test('N2 motor: telefon/sohbet oturumu bağlantılı klasörde GERÇEK yolla açılır; bağlantı ev klasörüne çıkıyorsa reddedilir', async () => {
  const evSahte = klasor('ev');
  const y = new CcYonetici({ komut: ccKomutu, ayar: () => ({ tamYetki: false, varsayilanMod: 'acceptEdits' }), uzakPolitikaDenetimi: async () => true, klasorSinirlari: () => ({ ev: evSahte, ust: [], hassas: [], sistem: [] }), kapanisSuresiMs: 1500 });
  acik.push(y);
  const r = await y.baslat({ cwd: baglanti(evSahte, path.join(tmp, `evbag-${++sayac}`)), istem: '#durum', kaynak: 'telefon' });
  assert.equal(r.kod, 'genis-klasor');
  const proje = klasor('proje');
  const b = baglanti(proje, path.join(tmp, `projebag-${++sayac}`));
  const s = await y.baslat({ cwd: b, istem: '#durum', kaynak: 'sohbet', sohbetId: 3 });
  assert.ok(s.tamam, s.hata);
  assert.equal(s.oturum!.cwd, proje, 'oturum gerçek yolla');
  const m = await y.baslat({ cwd: b, istem: '#durum' });
  assert.equal(m.oturum!.cwd, b, 'masa oturumu kullanıcının verdiği yolu korur');
});

// ── Düzenleme kancası: gerçek hedef + şüpheli yazım ──────────────────────────────────────────────────────────────────────────
test('kanca: klasör içindeki bağlantı dışarı çıkıyorsa yazım sorulur; korunan klasöre bağlantı sorulur; şüpheli yazımlar sorulur; olağan yazım sorulmaz', () => {
  const cwd = klasor('cwd');
  const disari = klasor('disari');
  const hassas = klasor('hassas');
  baglanti(disari, path.join(cwd, 'dis'));
  baglanti(hassas, path.join(cwd, 'gizli'));
  const s: Sinirlar = { ev: path.join(tmp, 'ev-yok'), ust: [], hassas: [hassas], sistem: [] };
  const k = (hedef: string) => ccOnKancaKarari({ uzak: false, tavan: true, cwd, sinirlar: s, arac: 'Write', girdi: { file_path: hedef } });
  assert.match(k('dis/x.txt') ?? '', /dışına/, 'bağlantı dışarı');
  assert.match(k(path.join(cwd, 'dis', 'yeni', 'y.txt')) ?? '', /dışına/, 'bağlantı dışarı, var olmayan kuyruk');
  assert.match(k('gizli/ayarlar.json') ?? '', /dışına|Korunan/, 'korunan klasöre bağlantı');
  for (const h of ['notlar.txt:gizli', `${cwd}\\a.txt:akis:$DATA`, '.claude./settings.json', 'notlar.txt ', 'src /a.ts', 'KLASOR~1/a.txt', 'a~2.txt', '\\\\?\\C:\\x\\y.txt', '\\\\.\\C:\\x', '\\\\sunucu\\pay\\z.txt']) {
    assert.match(k(h) ?? '', /şüpheli/, h);
  }
  for (const h of ['.git/config', '.GIT/HOOKS/pre-push', '.Claude/commands/x.md', '.mcp.json', '.MCP.JSON']) assert.match(k(h) ?? '', /ayarlarına|kancalarına/, h);
  for (const h of ['src/a.ts', 'README.md', '.gitignore', '.github/workflows/ci.yml', 'a.b.c.txt', 'yol/../b.txt']) assert.equal(k(h), null, h);
});

// ── N3 bütçesi ve kanca betikleri ─────────────────────────────────────────────────────────────────────────────────────────────
const AYAR = JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'bash "$CLAUDE_PROJECT_DIR"/.claude/betikler/kontrol.sh' }] }] } });
const yaz = (p: string, icerik: string | Buffer) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, icerik); };

test('N3: kanca komutlarının işaret ettiği .claude/ dosyaları ve .claude/hooks/ izi değiştirir; önbellek aynı dosyayı yeniden okumaz', (t) => {
  const p = klasor('kancali');
  yaz(path.join(p, '.claude', 'settings.json'), AYAR);
  yaz(path.join(p, '.claude', 'betikler', 'kontrol.sh'), 'echo iyi\n');
  yaz(path.join(p, '.claude', 'hooks', 'oncesi.py'), 'print(1)\n');
  const ilk = klasorAyarlariniBul(p);
  assert.ok(ilk.dosyalar.some((d) => /1 kanca betiği/.test(d.ozet)), JSON.stringify(ilk.dosyalar));
  const boy = izOnbellekBoyu();
  assert.ok(boy >= 3, `önbellekte ${boy}`);
  // İkinci çağrıda betikler YENİDEN OKUNMAZ (yalnız ayar dosyası özet için okunur).
  const okunan: string[] = [];
  const asil = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (...a: Parameters<typeof fs.readFileSync>) => { okunan.push(String(a[0])); return asil(...a); });
  assert.equal(klasorAyarlariniBul(p).parmakIzi, ilk.parmakIzi);
  t.mock.restoreAll();
  assert.equal(okunan.filter((x) => /kontrol\.sh|oncesi\.py/.test(x)).length, 0, `yeniden okunan: ${okunan.join(', ')}`);
  assert.equal(izOnbellekBoyu(), boy, 'ikinci çağrı önbellekten');
  yaz(path.join(p, '.claude', 'betikler', 'kontrol.sh'), 'curl kotu\n');
  const iki = klasorAyarlariniBul(p).parmakIzi;
  assert.notEqual(iki, ilk.parmakIzi, 'kancanın çalıştırdığı betik değişti');
  yaz(path.join(p, '.claude', 'hooks', 'oncesi.py'), 'print(2)\n');
  assert.notEqual(klasorAyarlariniBul(p).parmakIzi, iki, '.claude/hooks/ değişti');
});

test('N3: bütçe aşılırsa (toplam 400 girdi, 4 MB, tek dosya 512 KB) iz "sınırsız" — güven kabul edilmez, güvenme geçerli', () => {
  const coklu = klasor('coklu');
  yaz(path.join(coklu, '.claude', 'settings.json'), '{}');
  for (let i = 0; i < 230; i++) yaz(path.join(coklu, '.claude', 'commands', `k${i}.md`), `# ${i}\n`);
  for (let i = 0; i < 230; i++) yaz(path.join(coklu, '.claude', 'skills', `b${i}`, 'SKILL.md'), `# ${i}\n`); // klasör başına değil TOPLAM
  const buyuk = klasor('buyuk');
  yaz(path.join(buyuk, '.claude', 'settings.json'), '{}');
  yaz(path.join(buyuk, '.claude', 'agents', 'dev.md'), Buffer.alloc(600 * 1024, 97));
  const toplam = klasor('toplam');
  yaz(path.join(toplam, '.claude', 'settings.json'), '{}');
  for (let i = 0; i < 9; i++) yaz(path.join(toplam, '.claude', 'skills', `s${i}.md`), Buffer.alloc(500 * 1024, 98));
  for (const p of [coklu, buyuk, toplam]) {
    const a = klasorAyarlariniBul(p);
    assert.equal(a.sinirsiz, true, path.basename(p));
    assert.equal(a.parmakIzi, IZ_SINIRSIZ);
    const g = klasorGuvenDurumu(p, { karar: 'guven', parmakIzi: IZ_SINIRSIZ });
    assert.equal(g.karar, undefined, 'güven kabul edilmez');
    assert.equal(g.degisti, true);
    assert.equal(klasorGuvenDurumu(p, 'guven').karar, undefined, 'yalnız karar metni de');
    assert.equal(klasorGuvenDurumu(p, { karar: 'guvenme' }).karar, 'guvenme', 'güvenli yön geçerli');
    assert.equal(g.gerekli, true);
  }
  const kucuk = klasor('kucuk');
  yaz(path.join(kucuk, '.claude', 'settings.json'), '{}');
  for (let i = 0; i < 100; i++) yaz(path.join(kucuk, '.claude', 'commands', `k${i}.md`), 'x');
  assert.equal(klasorAyarlariniBul(kucuk).sinirsiz, undefined, 'bütçe içinde');
});

// ── Düzeltme turu 3 ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const yazKanca = (cwd: string, hedef: string, s: Sinirlar, ek: Record<string, unknown> = {}) =>
  ccOnKancaKarari({ uzak: true, tavan: true, cwd, sinirlar: s, arac: 'Write', girdi: { file_path: hedef }, ...ek });
const BOS: Sinirlar = { ev: path.join(tmp, 'ev-yok'), ust: [], hassas: [], sistem: [] };

test('A: hedefi olmayan bağlantı (junction ve dosya bağlantısı) kanca tarafından sorulur; altındaki klasör telefondan açılmaz', (t) => {
  const cwd = klasor('cwd-a');
  const disari = klasor('disari-a');
  baglanti(path.join(disari, 'henuz-yok'), path.join(cwd, 'dj'));
  assert.ok(gercekYolBilgisi(path.join(cwd, 'dj', 'x.txt')).cozulemeyen, 'çözülemeyen bağlantı bildirildi');
  assert.match(yazKanca(cwd, 'dj/x.txt', BOS) ?? '', /çözülemeyen/);
  assert.match(yazKanca(cwd, path.join(cwd, 'dj'), BOS) ?? '', /çözülemeyen/);
  assert.match(korunanKlasorNedeni(path.join(cwd, 'dj', 'alt'), BOS) ?? '', /çözülemeyen/, 'cwd denetimi de reddeder');
  assert.equal(gercekYolBilgisi(path.join(cwd, 'yok', 'y.txt')).cozulemeyen, undefined, 'sıradan var olmayan yol çözülemeyen sayılmaz');
  assert.equal(yazKanca(cwd, 'yeni/klasor/y.txt', BOS), null);
  let dosyaBag = false;
  try { fs.symlinkSync(path.join(disari, 'yeni.txt'), path.join(cwd, 'fl.txt'), 'file'); dosyaBag = true; } catch (e) { t.diagnostic(`dosya bağlantısı kurulamadı (${(e as NodeJS.ErrnoException).code}); o kısım atlandı`); }
  if (dosyaBag) assert.match(yazKanca(cwd, 'fl.txt', BOS) ?? '', /çözülemeyen/, 'proje\\fl.txt → var olmayan dışarı\\yeni.txt');
});

test('B: gerçek hâli ağ yolu olan sürücü (F: → \\\\sunucu\\pay) telefondan açılmaz; kancada ağa giden hedef sorulur', () => {
  const agCoz = (p: string) => ({ yol: `\\\\sunucu\\pay${p.slice(2)}` });
  assert.match(korunanKlasorNedeni('F:\\proje', BOS, agCoz) ?? '', /ağ ya da aygıt yolu/);
  assert.match(korunanKlasorNedeni('F:\\', BOS, agCoz) ?? '', /ağ ya da aygıt yolu/);
  const cwd = klasor('cwd-b');
  assert.match(yazKanca(cwd, 'x.txt', BOS, { coz: () => ({ yol: '\\\\sunucu\\pay\\x.txt' }) }) ?? '', /ağ yolu/);
  for (const p of ['\\??\\C:\\Kullanicilar', '/??/C:/x']) assert.equal(agYoluMu(p), true, p);
  // Sürücüye/köke göreli ve şüpheli yazımlı klasörler de açılmaz.
  for (const p of ['C:Users', '\\Users\\x', 'C:\\Kullanicilar\\x.', 'C:\\Kullanicilar\\x ', `${cwd}::$INDEX_ALLOCATION`, '\\??\\C:\\Kullanicilar']) assert.ok(korunanKlasorNedeni(p, BOS), p);
  assert.equal(korunanKlasorNedeni(cwd, BOS), null);
  assert.equal(supheliYazim('C:dosya.txt'), 'sürücüye göreli yol');
});

test('C: kanca kayda sabitlenen yolla karşılaştırır — klasör sonradan bağlantıyla değiştirilirse yazımlar sorulur', () => {
  const evSahte = klasor('ev-c');
  const s: Sinirlar = { ev: evSahte, ust: [], hassas: [], sistem: [] };
  const kurban = klasor('kurban');
  const d = korunanKlasorDenetimi(kurban, s);
  assert.equal(d.neden, null);
  assert.equal(d.yol, kurban, 'denetlenen gerçek yol (kayda sabitlenen)');
  fs.rmdirSync(kurban);
  baglanti(evSahte, kurban);
  try {
    assert.match(yazKanca(d.yol, path.join(evSahte, '.gitconfig'), s) ?? '', /dışına/);
    assert.match(yazKanca(d.yol, 'x.txt', s) ?? '', /dışına/);
  } finally { fs.unlinkSync(kurban); }
});

test('D: .git klasörünün tamamı (modules/*/hooks|config, config.worktree, worktrees) ve iç içe .git/.claude/.mcp.json sorulur', () => {
  const cwd = klasor('cwd-d');
  for (const h of ['.git/modules/m/hooks/pre-commit', '.git/modules/a/b/config', '.git/modules/a/modules/b/hooks/x', '.git/config.worktree',
    '.git/worktrees/w/config.worktree', '.git', '.git/info/exclude', 'alt/.git/hooks/pre-push', 'vendor/lib/.claude/settings.json', 'paket/.mcp.json']) {
    assert.match(yazKanca(cwd, h, BOS) ?? '', /git klasörüne|ayarlarına/, h);
  }
  for (const h of ['.gitignore', '.gitattributes', '.github/workflows/ci.yml', 'src/git/config', 'a.git/x', 'docs/claude/notlar.md']) assert.equal(yazKanca(cwd, h, BOS), null, h);
});

test('E: sınır klasörleri önbellekten (her düzenlemede yeniden çözülmez); başka sürücüdeki hedef hiç çözülmeden sorulur', { skip: !WIN }, (t) => {
  sinirOnbelleginiBosalt();
  const cwd = klasor('cwd-e');
  const hassas = [klasor('h1'), klasor('h2'), klasor('h3'), klasor('h4'), klasor('h5')];
  const s: Sinirlar = { ev: path.join(tmp, 'ev-yok'), ust: [], hassas, sistem: [] };
  const cozulen: string[] = [];
  const bakilan: string[] = [];
  const asilR = fs.realpathSync.native;
  const asilL = fs.lstatSync;
  t.mock.method(fs.realpathSync, 'native', (p: string) => { cozulen.push(String(p)); return asilR(p); });
  t.mock.method(fs, 'lstatSync', (...a: Parameters<typeof fs.lstatSync>) => { bakilan.push(String(a[0])); return asilL(...a); });
  for (let i = 0; i < 20; i++) assert.equal(yazKanca(cwd, `src/a${i}.ts`, s), null);
  for (const h of hassas) assert.ok(cozulen.filter((x) => x.toLowerCase() === h.toLowerCase()).length <= 1, `sınır bir kez çözüldü: ${h}`);
  const harf = cwd[0].toUpperCase() === 'Q' ? 'R' : 'Q';
  const once = cozulen.length + bakilan.length;
  assert.match(yazKanca(cwd, `${harf}:\\ag\\x.txt`, s) ?? '', /dışına/);
  assert.equal(cozulen.length + bakilan.length, once, 'başka sürücüye hiç dokunulmadı');
  t.mock.restoreAll();
});

test('F: kanca komutlarının çalıştırdığı .claude/ DIŞINDAKİ proje dosyaları ize girer (proje dışı girmez); .claude içinde bağlantı → sınırsız', (t) => {
  const p = klasor('kancali-f');
  const disari = path.join(klasor('disari-f'), 'k.js');
  yaz(disari, '1');
  yaz(path.join(p, '.claude', 'settings.json'), JSON.stringify({ hooks: { PreToolUse: [{ hooks: [
    { type: 'command', command: 'node tools/kanca.js --sessiz' },
    { type: 'command', command: 'bash "$CLAUDE_PROJECT_DIR"/scripts/oncesi.sh' },
    { type: 'command', command: `node --ayar=ayar/k.json "${disari}"` },
  ] }] } }));
  yaz(path.join(p, 'tools', 'kanca.js'), 'a');
  yaz(path.join(p, 'scripts', 'oncesi.sh'), 'b');
  yaz(path.join(p, 'ayar', 'k.json'), '{}');
  let iz = klasorAyarlariniBul(p).parmakIzi;
  for (const [dosya, yeni] of [['tools/kanca.js', 'kotu'], ['scripts/oncesi.sh', 'curl x'], ['ayar/k.json', '{"a":1}']] as const) {
    yaz(path.join(p, dosya), yeni);
    const simdi = klasorAyarlariniBul(p).parmakIzi;
    assert.notEqual(simdi, iz, `${dosya} değişti`);
    iz = simdi;
  }
  yaz(disari, '2');
  assert.equal(klasorAyarlariniBul(p).parmakIzi, iz, 'proje dışındaki dosya klasörün dosyası sayılmaz');
  // .claude/ içinde bağlantı: içerik izlenemez → sınırsız (güven kabul edilmez).
  const b1 = klasor('bagli-f');
  yaz(path.join(b1, '.claude', 'settings.json'), '{}');
  fs.mkdirSync(path.join(b1, '.claude', 'skills'), { recursive: true });
  baglanti(klasor('ortak-beceriler'), path.join(b1, '.claude', 'skills', 'ortak'));
  const b2 = klasor('bagli-f');
  const asil = klasor('asil-claude');
  yaz(path.join(asil, 'settings.json'), '{}');
  baglanti(asil, path.join(b2, '.claude'));
  for (const b of [b1, b2]) {
    const a = klasorAyarlariniBul(b);
    assert.equal(a.sinirsiz, true, path.basename(b));
    assert.equal(klasorGuvenDurumu(b, { karar: 'guven', parmakIzi: a.parmakIzi }).karar, undefined);
  }
  const b3 = klasor('bagli-f');
  yaz(path.join(asil, 'baska.json'), '{}');
  fs.mkdirSync(path.join(b3, '.claude'));
  try { fs.symlinkSync(path.join(asil, 'baska.json'), path.join(b3, '.claude', 'settings.json'), 'file'); } catch (e) { t.diagnostic(`dosya bağlantısı kurulamadı (${(e as NodeJS.ErrnoException).code}); atlandı`); return; }
  assert.equal(klasorAyarlariniBul(b3).sinirsiz, true, 'ayar dosyası bağlantı');
});
