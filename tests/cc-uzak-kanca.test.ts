// Son dalga B düzeltme turu: telefon/sohbet oturumlarının SDK PreToolUse kancası (CA kemer-askı + N2 düzenleme koruması), geniş klasör
// reddi (N2), masadaki açık Tam yetkili oturuma sohbetten iş (N1), telefon politikası denetiminin kendi mantığı — GERÇEK Agent SDK + SAHTE
// Claude Code (scripts/dev/sahte-claude.mjs: PreToolUse kancalarını SDK'nın hook_callback protokolüyle sorar; SAHTE_CC_KURALLAR kullanıcının
// allow kurallarını taklit eder). Gerçek claude.exe ASLA çalışmaz; yapılandırma dizini ve klasörler geçici.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const kok = path.resolve(import.meta.dirname, '..');
// Gerçek yol: kanca, kayda sabitlenen GERÇEK klasörle karşılaştırır (düzeltme turu 3); geçici klasör kısa adla gelirse de tutarlı.
const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-cc-kanca-')));
const claudeDiz = path.join(tmp, '.claude');
fs.mkdirSync(claudeDiz, { recursive: true });
// Ana süreçteki SDK (resolveSettings) ile çocuk süreç aynı geçici dizini görsün (varsayılan politika denetimi tutarlı).
process.env.FUBER_CLAUDE_DIZIN = claudeDiz;
process.env.CLAUDE_CONFIG_DIR = claudeDiz;
process.env.FUBER_CLAUDE_KOMUT = JSON.stringify([process.execPath, path.join(kok, 'scripts/dev/sahte-claude.mjs')]);
// Kullanıcının ayarlarında Bash'e izin veren kural (sahte Claude Code bunu sormadan uygular).
process.env.SAHTE_CC_KURALLAR = JSON.stringify([{ toolName: 'Bash' }]);
delete process.env.FUBER_SAHTE_CLAUDE_KAYIT;
delete process.env.SAHTE_CC_PID_DOSYASI;

const { CcYonetici, ccOnKancaKarari, ccUzakPolitikaSonucu, ccUzakPolitikaEtkinMi, CC_UZAK_POLITIKA } = await import('../src/main/claudecode/oturum-yoneticisi.ts');
const { ccKomutu } = await import('../src/main/claudecode/yurutucu.ts');
const { korunanKlasorNedeni, varsayilanKlasorSinirlari } = await import('../src/main/claudecode/klasor-guveni.ts');
type Olay = import('../src/shared/cc-olay.ts').CcOlay;
type Mod = import('../src/shared/cc-olay.ts').CcMod;
type Sinirlar = import('../src/main/claudecode/klasor-guveni.ts').KlasorSinirlari;
type Yonetici = InstanceType<typeof CcYonetici>;

const uyu = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function bekleKosul(f: () => boolean, ms = 10_000, ne = 'koşul'): Promise<void> {
  const son = Date.now() + ms;
  while (Date.now() < son) { if (f()) return; await uyu(15); }
  throw new Error(`zaman aşımı: ${ne}`);
}
const acik: Yonetici[] = [];
after(async () => { for (const y of acik) await y.hepsiniKapat(); fs.rmSync(tmp, { recursive: true, force: true }); });

let sayac = 0;
const klasor = (ad = 'proje') => { const d = path.join(tmp, `${ad}-${++sayac}`); fs.mkdirSync(d, { recursive: true }); return d; };
const disari = path.join(tmp, 'disari', 'hedef.txt');
const BOS_SINIR: Sinirlar = { ev: path.join(tmp, 'ev-yok'), ust: [], hassas: [], sistem: [] };

function kur(o: { ayar?: { tamYetki: boolean; varsayilanMod: Mod }; sinirlar?: Sinirlar } = {}) {
  const olaylar: { id: string; olay: Olay }[] = [];
  const y = new CcYonetici({
    komut: ccKomutu, ayar: () => o.ayar ?? { tamYetki: false, varsayilanMod: 'acceptEdits' }, olay: (z) => olaylar.push({ id: z.oturum, olay: z.olay }),
    uzakPolitikaDenetimi: async () => true, klasorSinirlari: () => o.sinirlar ?? BOS_SINIR, kapanisSuresiMs: 1500, kapatmaBeklemeMs: 1500,
  });
  acik.push(y);
  const ol = (id: string, tur?: Olay['tur']) => olaylar.filter((z) => z.id === id && (!tur || z.olay.tur === tur)).map((z) => z.olay);
  const bekleOlay = async <T extends Olay['tur']>(id: string, tur: T, n = 1) => {
    await bekleKosul(() => ol(id, tur).length >= n, 10_000, `${tur} #${n}`);
    return ol(id, tur)[n - 1] as Extract<Olay, { tur: T }>;
  };
  const sonMetin = (id: string) => (ol(id, 'metin').at(-1) as { metin: string } | undefined)?.metin ?? '';
  return { y, ol, bekleOlay, sonMetin };
}
/** Bir tur: sonuca dek bekler; izin isterse reddeder. Dönen: izin istenen araçlar + son metin. */
async function tur(t: ReturnType<typeof kur>, id: string, n: number) {
  const son = Date.now() + 10_000;
  const istenen: string[] = [];
  while (t.ol(id, 'sonuc').length < n && Date.now() < son) {
    for (const i of t.y.oturum(id)?.bekleyenIzinler ?? []) { istenen.push(i.arac); t.y.izinYanitla(id, i.istekId, { karar: 'ret' }); }
    await uyu(15);
  }
  assert.ok(t.ol(id, 'sonuc').length >= n, 'tur bitmedi');
  return { istenen, metin: t.sonMetin(id) };
}
async function baslatVeTur(t: ReturnType<typeof kur>, i: Record<string, unknown>) {
  const r = await t.y.baslat({ cwd: '', ...i } as never);
  assert.ok(r.tamam, r.hata);
  return { id: r.oturum!.id, ...(await tur(t, r.oturum!.id, 1)) };
}

// ── Saf karar (PreToolUse) ─────────────────────────────────────────────────────────────────────────────────────────────────
test('kanca kararı: telefon oturumunda komut ve MCP araçları HER ZAMAN sorulur; masa oturumunda kanca karışmaz', () => {
  const cwd = klasor();
  const ortak = { cwd, sinirlar: BOS_SINIR, girdi: { command: 'ls' } };
  for (const arac of ['Bash', 'PowerShell', 'Monitor', 'mcp__github__create_issue']) {
    assert.match(ccOnKancaKarari({ ...ortak, uzak: true, tavan: true, arac }) ?? '', /masada onaylanır/, arac);
    assert.equal(ccOnKancaKarari({ ...ortak, uzak: false, tavan: false, arac }), null, `masa ${arac}`);
  }
  assert.equal(ccOnKancaKarari({ ...ortak, uzak: false, tavan: true, arac: 'Bash' }), null, 'sohbet oturumunda Bash kullanıcının kurallarına bırakılır');
  assert.equal(ccOnKancaKarari({ ...ortak, uzak: true, tavan: true, arac: 'Read', girdi: { file_path: disari } }), null, 'okuma sorulmaz');
});

test('kanca kararı (N2): telefon/sohbet oturumunda klasör dışına, korunan klasöre, .claude/.mcp.json/.git/hooks yazımı sorulur; klasör içi sıradan yazım sorulmaz', () => {
  const cwd = klasor();
  const hassas = path.join(tmp, 'fuber-veri');
  const s: Sinirlar = { ev: path.join(tmp, 'ev'), ust: [tmp], hassas: [hassas], sistem: [] }; // cwd bir "ust" (AppData gibi) klasörün İÇİNDE
  const k = (arac: string, girdi: unknown, uzak = false, tavan = true) => ccOnKancaKarari({ uzak, tavan, cwd, sinirlar: s, arac, girdi });
  assert.match(k('Write', { file_path: disari }) ?? '', /klasörünün dışına/);
  assert.match(k('Edit', { file_path: path.join(hassas, 'ayarlar.json') }) ?? '', /dışına|Korunan/);
  assert.match(k('NotebookEdit', { notebook_path: path.join(cwd, '..', 'x.ipynb') }) ?? '', /dışına/);
  for (const p of ['.claude/settings.json', '.CLAUDE/commands/x.md', '.mcp.json', '.git/hooks/pre-commit']) assert.match(k('Write', { file_path: p }) ?? '', /ayarlarına|kancalarına/, p);
  assert.match(k('MultiEdit', {}) ?? '', /belirsiz/);
  // Gerçek ikili koşusunda (D) bulunan hata: cwd AppData'nın içindeyken klasör içi yazım "korunan" sayılıyordu.
  assert.equal(k('Write', { file_path: 'serbest.txt' }), null);
  assert.equal(k('Write', { file_path: path.join(cwd, 'alt', 'a.ts') }), null);
  assert.equal(k('Write', { file_path: disari }, false, false), null, 'masa oturumu: kanca karışmaz');
  // Hassas klasör cwd'nin içindeyse (yalnız masada açılabilir) ona yazım sorulur.
  const ic = path.join(cwd, 'hassas-ic');
  assert.match(ccOnKancaKarari({ uzak: true, tavan: true, cwd, sinirlar: { ...s, hassas: [ic] }, arac: 'Write', girdi: { file_path: path.join(ic, 'x') } }) ?? '', /Korunan/);
});

test('N2: geniş/korunan klasörler — ev, sürücü kökü, AppData ve atası, Fuber verisi (içi ve atası), sistem; sıradan proje açılır', { skip: process.platform !== 'win32' }, () => {
  const s: Sinirlar = {
    ev: 'C:\\Kullanicilar\\deniz', ust: ['C:\\Kullanicilar\\deniz\\AppData\\Roaming', 'C:\\Kullanicilar\\deniz\\AppData\\Local'],
    hassas: ['C:\\Kullanicilar\\deniz\\AppData\\Roaming\\Fuber AI', 'C:\\Kullanicilar\\deniz\\.claude', 'C:\\Kullanicilar\\deniz\\Documents\\WindowsPowerShell'],
    sistem: ['C:\\Windows', 'C:\\Program Files', 'C:\\ProgramData'],
  };
  const red = ['C:\\', 'D:\\', 'C:\\Kullanicilar', 'C:\\Kullanicilar\\deniz', 'c:\\kullanicilar\\DENIZ\\', 'C:\\Kullanicilar\\deniz\\AppData', 'C:\\Kullanicilar\\deniz\\AppData\\Roaming',
    'C:\\Kullanicilar\\deniz\\AppData\\Roaming\\Fuber AI', 'C:\\Kullanicilar\\deniz\\AppData\\Roaming\\Fuber AI\\gunluk', 'C:\\Kullanicilar\\deniz\\.claude\\projects',
    'C:\\Kullanicilar\\deniz\\Documents', 'C:\\Windows\\System32', 'C:\\Program Files\\Uygulama', 'C:\\ProgramData'];
  for (const p of red) assert.ok(korunanKlasorNedeni(p, s), `reddedilmeliydi: ${p}`);
  const acik = ['C:\\Kullanicilar\\deniz\\Desktop\\proje', 'C:\\Kullanicilar\\deniz\\Documents\\GitHub\\site', 'C:\\Kullanicilar\\deniz\\AppData\\Local\\Temp\\x', 'D:\\kod\\uygulama', 'C:\\Program FilesX\\a'];
  for (const p of acik) assert.equal(korunanKlasorNedeni(p, s), null, `açılmalıydı: ${p}`);
  // Varsayılan sınırlar ortamdan (yonetim.ts veri klasörünü ve Belgeler'i ekler).
  const v = varsayilanKlasorSinirlari({ veri: 'C:\\x\\Fuber AI', claudeDizini: 'C:\\x\\.claude', belgeler: 'C:\\x\\Belgeler' });
  assert.ok(v.hassas.includes(path.resolve('C:\\x\\Fuber AI')) && v.hassas.includes(path.resolve('C:\\x\\Belgeler\\WindowsPowerShell')) && v.ust.length >= 2 && v.ev === os.homedir());
});

// ── Telefon politikası denetiminin KENDİ mantığı (önceden `return true` da testleri geçiyordu) ──────────────────────────────────
test('ccUzakPolitikaSonucu / ccUzakPolitikaEtkinMi: kilitler + iki ask kuralı yoksa, çözücü hata verir ya da gecikirse FALSE', async () => {
  const tam = { allowManagedPermissionRulesOnly: true, allowManagedHooksOnly: true, permissions: { ask: ['Bash', 'PowerShell', 'Edit'] } };
  assert.equal(ccUzakPolitikaSonucu({ effective: tam }), true);
  for (const [ad, e] of [
    ['yönetici katmanı SDK katmanını düşürdü (kilit yok)', { permissions: { ask: ['Bash', 'PowerShell'] } }],
    ['kanca kilidi yok', { ...tam, allowManagedHooksOnly: undefined }],
    ['PowerShell ask yok', { ...tam, permissions: { ask: ['Bash'] } }],
    ['ask dizi değil', { ...tam, permissions: { ask: 'Bash,PowerShell' } }],
  ] as const) assert.equal(ccUzakPolitikaSonucu({ effective: e as never }), false, ad);
  assert.equal(ccUzakPolitikaSonucu(null), false);
  assert.equal(ccUzakPolitikaSonucu({ effective: undefined as never }), false);
  const istekler: unknown[] = [];
  assert.equal(await ccUzakPolitikaEtkinMi(tmp, async (o) => { istekler.push(o); return { effective: tam } as never; }), true);
  assert.deepEqual(istekler[0], { cwd: tmp, managedSettings: CC_UZAK_POLITIKA }, 'çözücüye Fuber politikası verilir');
  assert.equal(await ccUzakPolitikaEtkinMi(tmp, async () => ({ effective: { permissions: {} } }) as never), false);
  assert.equal(await ccUzakPolitikaEtkinMi(tmp, async () => { throw new Error('x'); }), false);
  assert.equal(await ccUzakPolitikaEtkinMi(tmp, () => new Promise(() => undefined), 50), false, 'zaman aşımı');
  // Gerçek SDK birleştirme motoru (geçici yapılandırma dizini; yönetici katmanı yok) → politika etkin.
  assert.equal(await ccUzakPolitikaEtkinMi(tmp), true);
  assert.deepEqual(CC_UZAK_POLITIKA, { allowManagedPermissionRulesOnly: true, allowManagedHooksOnly: true, permissions: { ask: ['Bash', 'PowerShell'], disableBypassPermissionsMode: 'disable' } });
});

// ── Motor + sahte Claude Code: kanca gerçekten sorduruyor mu (telefon oturumunun GERÇEK modu acceptEdits) ─────────────────────────
test('CA kemer-askı: telefon oturumu (acceptEdits) — kullanıcının Bash allow kuralına rağmen kanca masaya sorar; masada aynı kural sormadan çalıştırır', async () => {
  const t = kur();
  const tel = await baslatVeTur(t, { cwd: klasor(), istem: '#izin', kaynak: 'telefon' });
  assert.equal(t.y.ozetAl(tel.id)!.mod, 'acceptEdits');
  assert.deepEqual(tel.istenen, ['Bash'], 'kanca sordurdu');
  assert.match(tel.metin, /İzin verilmedi/);
  const masa = await baslatVeTur(t, { cwd: klasor(), istem: '#izin' });
  assert.deepEqual(masa.istenen, [], 'masada allow kuralı sormadan uyguladı (kıyas)');
  assert.match(masa.metin, /Komut çalıştı/);
});

test('N2 düzenleme koruması: telefon ve sohbet oturumunda klasör dışına ve .claude/ içine yazım sorulur; klasör içi yazım ve masa oturumu sormaz', async () => {
  const t = kur();
  for (const kaynak of ['telefon', 'sohbet'] as const) {
    const cwd = klasor();
    const ek = kaynak === 'sohbet' ? { sohbetId: 5 } : {};
    const r = await baslatVeTur(t, { cwd, istem: `#yaz:${disari}`, kaynak, ...ek });
    assert.deepEqual(r.istenen, ['Write'], `${kaynak}: klasör dışı`);
    assert.match(r.metin, /Yazılmadı/);
    assert.equal((await t.y.gonder(r.id, { metin: '#yaz:icerde.txt' })).tamam, true);
    const ic = await tur(t, r.id, 2);
    assert.deepEqual(ic.istenen, [], `${kaynak}: klasör içi sormaz (acceptEdits)`);
    assert.match(ic.metin, /Yazıldı: icerde\.txt/);
    assert.equal((await t.y.gonder(r.id, { metin: '#yaz:.claude/settings.json' })).tamam, true);
    assert.deepEqual((await tur(t, r.id, 3)).istenen, ['Write'], `${kaynak}: .claude/`);
  }
  const masa = await baslatVeTur(t, { cwd: klasor(), istem: `#yaz:${disari}` });
  assert.deepEqual(masa.istenen, [], 'masa oturumu (kıyas): kanca karışmaz');
});

test('N2: telefondan ve sohbetten ev klasöründe / korunan klasörü içeren klasörde oturum AÇILMAZ; masadan açılır', async () => {
  const ev = klasor('ev');
  const ust = klasor('ust');
  const hassas = path.join(ust, 'fuber-veri');
  fs.mkdirSync(hassas);
  const t = kur({ sinirlar: { ev, ust: [], hassas: [hassas], sistem: [] } });
  for (const kaynak of ['telefon', 'sohbet'] as const) {
    for (const cwd of [ev, ust, hassas]) {
      const r = await t.y.baslat({ cwd, istem: '#durum', kaynak, ...(kaynak === 'sohbet' ? { sohbetId: 1 } : {}) });
      assert.equal(r.kod, 'genis-klasor', `${kaynak} ${path.basename(cwd)}`);
      assert.match(r.hata ?? '', /bir proje klasörü seç/);
    }
  }
  assert.equal(t.y.oturumlar().length, 0);
  const masa = await t.y.baslat({ cwd: ev, istem: '#durum' });
  assert.equal(masa.tamam, true, 'masadan kullanıcı istediği klasörü açar');
});

// ── N1: masadaki açık Tam yetkili oturuma sohbetten iş ──────────────────────────────────────────────────────────────────────────
test('N1: sohbet aracı masadaki AÇIK Tam yetkili oturuma iş verirse oturum önce "Düzenlemelere izin ver"e indirilir, tavan konur, düzenleme koruması hemen geçerli', async () => {
  const t = kur({ ayar: { tamYetki: true, varsayilanMod: 'bypassPermissions' } });
  const cwd = klasor();
  const kimlik = 'aaaa5555-0000-4000-8000-000000000005';
  const r = await t.y.baslat({ cwd, istem: '#durum', surdur: kimlik });
  const id = r.oturum!.id;
  await t.bekleOlay(id, 'sonuc');
  assert.match(t.sonMetin(id), /^mod=bypassPermissions /);
  assert.deepEqual(t.y.sohbetModu(kimlik), { simdiki: 'bypassPermissions', olacak: 'acceptEdits' }, 'kart için önizleme');
  assert.deepEqual(t.y.sohbetModu(), { olacak: 'acceptEdits' }, 'yeni oturum: varsayılan Tam yetki → tavanlı');
  const s = await t.y.baslat({ cwd, surdur: kimlik, istem: '#durum', kaynak: 'sohbet', sohbetId: 8 });
  assert.equal(s.tamam, true, s.hata);
  assert.equal(s.oturum!.id, id, 'aynı açık oturum');
  await t.bekleOlay(id, 'sonuc', 2);
  assert.match(t.sonMetin(id), /^mod=acceptEdits /, 'Claude Code süreci gerçekten indirildi (setPermissionMode)');
  assert.equal(t.y.ozetAl(id)!.mod, 'acceptEdits');
  assert.ok(t.ol(id, 'mod').some((m) => (m as { mod: string }).mod === 'acceptEdits'));
  assert.ok(t.ol(id, 'sistem').some((m) => /Sohbetten gelen iş için oturum/.test((m as { metin: string }).metin)));
  // Süreç masada açılmıştı (kancası o an boştu); tavan konunca klasör dışı yazım artık masaya sorulur.
  assert.equal((await t.y.gonder(id, { metin: `#yaz:${disari}` })).tamam, true);
  assert.deepEqual((await tur(t, id, 3)).istenen, ['Write']);
  // Tavan yalnız masada açıkça Tam yetki seçilince kalkar.
  assert.equal((await t.y.modDegistir(id, 'bypassPermissions')).tamam, true);
  assert.equal((await t.y.gonder(id, { metin: `#yaz:${disari}` })).tamam, true);
  assert.deepEqual((await tur(t, id, 4)).istenen, [], 'kullanıcı masada Tam yetkiye döndü: koruma kalktı');
});

test('N1: oturum Tam yetkiden indirilemezse sohbetin işi GİTMEZ (mod-dusurulemedi)', async () => {
  const t = kur({ ayar: { tamYetki: true, varsayilanMod: 'bypassPermissions' } });
  const cwd = klasor();
  const kimlik = 'aaaa6666-0000-4000-8000-000000000006';
  const r = await t.y.baslat({ cwd, istem: '#modreddet', surdur: kimlik });
  const id = r.oturum!.id;
  await t.bekleOlay(id, 'sonuc');
  const once = t.ol(id, 'kullanici').length;
  const s = await t.y.baslat({ cwd, surdur: kimlik, istem: 'rm -rf yap', kaynak: 'sohbet', sohbetId: 9 });
  assert.equal(s.tamam, false);
  assert.equal(s.kod, 'mod-dusurulemedi');
  await uyu(200);
  assert.equal(t.ol(id, 'kullanici').length, once, 'mesaj kuyruğa girmedi');
  assert.equal(t.y.ozetAl(id)!.mod, 'bypassPermissions');
  assert.equal(t.y.ozetAl(id)!.kuyruk, 0);
});

// ── Düzeltme turu 3 (C): sabitlenen gerçek klasör — açılış, sürdürme, açık oturum; süreç açılmadan önce yeniden denetim ─────────────
test('C (tur 3): sohbet oturumunun klasörü süreç kapandıktan sonra ev klasörüne giden bağlantıyla değiştirilirse süreç yeniden AÇILMAZ', async () => {
  const ev = klasor('ev');
  const t = kur({ sinirlar: { ev, ust: [], hassas: [], sistem: [] } });
  const cwd = klasor('kurban');
  const r = await baslatVeTur(t, { cwd, istem: '#durum', kaynak: 'sohbet', sohbetId: 11 });
  assert.equal((await t.y.kapat(r.id)).tamam, true);
  fs.renameSync(cwd, `${cwd}-eski`);
  fs.symlinkSync(ev, cwd, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    const once = t.ol(r.id, 'kullanici').length;
    assert.equal((await t.y.gonder(r.id, { metin: '#durum' })).tamam, true);
    await bekleKosul(() => Boolean(t.y.ozetAl(r.id)?.hata), 5000, 'süreç açılmadan hata');
    assert.match(t.y.ozetAl(r.id)!.hata!, /ev klasörü|değişti/);
    assert.equal(t.ol(r.id, 'kullanici').length, once, 'mesaj sürece gitmedi');
  } finally { fs.unlinkSync(cwd); }
});

test('C (tur 3): masada geniş klasörde açılmış oturuma sohbetten iş GİTMEZ; kapanmış kaydı telefondan sürdürürken KAYDIN klasörü denetlenir', async () => {
  const ev = klasor('ev');
  const t = kur({ sinirlar: { ev, ust: [], hassas: [], sistem: [] } });
  const kimlik = 'aaaa7777-0000-4000-8000-000000000007';
  const r = await t.y.baslat({ cwd: ev, istem: '#durum', surdur: kimlik });
  assert.ok(r.tamam, 'masadan açılır');
  const id = r.oturum!.id;
  await t.bekleOlay(id, 'sonuc');
  const s = await t.y.baslat({ cwd: klasor(), surdur: kimlik, istem: 'bir şey yaz', kaynak: 'sohbet', sohbetId: 12 });
  assert.equal(s.kod, 'genis-klasor', 'açık oturum: istekteki klasör değil oturumun klasörü');
  assert.equal(t.ol(id, 'kullanici').length, 1, 'iş kuyruğa girmedi');
  assert.equal((await t.y.kapat(id)).tamam, true);
  const p = await t.y.baslat({ cwd: klasor(), surdur: kimlik, istem: 'bir şey yaz', kaynak: 'telefon' });
  assert.equal(p.kod, 'genis-klasor', 'kapanmış kayıt: kaydın klasörü denetlendi');
  assert.equal(t.ol(id, 'kullanici').length, 1);
});

test('C (tur 3): masada bağlantılı yolla açılmış kayıt sohbetten sürdürülünce gerçek yolu sabitlenir; klasör içi yazım sormaz, dışı sorar', async () => {
  const t = kur();
  const proje = klasor('proje');
  const b = path.join(tmp, `bag-${++sayac}`);
  fs.symlinkSync(proje, b, process.platform === 'win32' ? 'junction' : 'dir');
  const kimlik = 'aaaa8888-0000-4000-8000-000000000008';
  const r = await t.y.baslat({ cwd: b, istem: '#durum', surdur: kimlik });
  const id = r.oturum!.id;
  await t.bekleOlay(id, 'sonuc');
  assert.equal((await t.y.kapat(id)).tamam, true);
  const s = await t.y.baslat({ cwd: b, surdur: kimlik, istem: '#yaz:icerde.txt', kaynak: 'sohbet', sohbetId: 13 });
  assert.equal(s.tamam, true, s.hata);
  const ic = await tur(t, id, 2);
  assert.deepEqual(ic.istenen, [], 'klasör içi');
  assert.match(ic.metin, /Yazıldı: icerde\.txt/);
  assert.equal((await t.y.gonder(id, { metin: `#yaz:${disari}` })).tamam, true);
  assert.deepEqual((await tur(t, id, 3)).istenen, ['Write'], 'klasör dışı');
});
