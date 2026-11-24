// Son dalga B (I1, I2): klasör güveni, telefon politikası (CC_UZAK_POLITIKA) ve sohbet aracının mod tavanı — GERÇEK Agent SDK + SAHTE
// Claude Code (scripts/dev/sahte-claude.mjs argümanlarını FUBER_SAHTE_CLAUDE_KAYIT'a yazar: motorun claude'a verdiği bayraklar burada
// denetlenir). Gerçek claude.exe ASLA çalışmaz; ~/.claude yerine geçici FUBER_CLAUDE_DIZIN; proje klasörleri geçici.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const kok = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-cc-guven-'));
const claudeDiz = path.join(tmp, '.claude');
process.env.FUBER_CLAUDE_DIZIN = claudeDiz;
delete process.env.CLAUDE_CONFIG_DIR;
process.env.FUBER_CLAUDE_KOMUT = JSON.stringify([process.execPath, path.join(kok, 'scripts/dev/sahte-claude.mjs')]);
const KAYIT = path.join(tmp, 'argv.jsonl');
process.env.FUBER_SAHTE_CLAUDE_KAYIT = KAYIT;
delete process.env.SAHTE_CC_PID_DOSYASI;

const { CcYonetici, CC_UZAK_POLITIKA } = await import('../src/main/claudecode/oturum-yoneticisi.ts');
const { ccKomutu } = await import('../src/main/claudecode/yurutucu.ts');
const { klasorAyarlariniBul, KlasorGuvenDeposu, guvenAnahtari, ayarOzeti, klasorGuvenDurumu } = await import('../src/main/claudecode/klasor-guveni.ts');
type Zarf = import('../src/shared/cc-olay.ts').CcOlayZarfi;
type Olay = import('../src/shared/cc-olay.ts').CcOlay;
type Mod = import('../src/shared/cc-olay.ts').CcMod;
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
/** Yeni proje klasörü; `dosyalar`: göreli yol → içerik. */
function proje(dosyalar: Record<string, string> = {}): string {
  const d = path.join(tmp, `proje-${++sayac}`);
  fs.mkdirSync(d, { recursive: true });
  for (const [p, i] of Object.entries(dosyalar)) { fs.mkdirSync(path.dirname(path.join(d, p)), { recursive: true }); fs.writeFileSync(path.join(d, p), i); }
  return d;
}
const AYARLI = { '.claude/settings.json': JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo x' }] }] }, permissions: { allow: ['Bash(*)'] } }) };
/** Bu klasörde açılan sahte süreçlerin argümanları (açılış sırasıyla). */
const argvler = (cwd: string): string[][] => (fs.existsSync(KAYIT) ? fs.readFileSync(KAYIT, 'utf8').trim().split('\n').filter(Boolean).map((s) => JSON.parse(s) as { argv: string[]; cwd: string }) : [])
  .filter((x) => path.resolve(x.cwd).toLowerCase() === path.resolve(cwd).toLowerCase() && x.argv.includes('--input-format')).map((x) => x.argv);
const bayrak = (a: string[], ad: string): string | true | undefined => {
  const x = a.find((s) => s === ad || s.startsWith(`${ad}=`));
  if (!x) return undefined;
  if (x.includes('=')) return x.slice(ad.length + 1);
  const s = a[a.indexOf(x) + 1];
  return s && !s.startsWith('--') ? s : true;
};

function kur(o: { ayar?: { tamYetki: boolean; varsayilanMod: Mod }; kararlar?: Map<string, 'guven' | 'guvenme'>; politika?: boolean } = {}) {
  const zarflar: Zarf[] = [];
  const kararlar = o.kararlar ?? new Map<string, 'guven' | 'guvenme'>();
  let politikaCagrisi = 0;
  const y = new CcYonetici({
    komut: ccKomutu, ayar: () => o.ayar ?? { tamYetki: false, varsayilanMod: 'acceptEdits' }, olay: (z) => zarflar.push(z),
    klasorGuveni: (cwd) => kararlar.get(guvenAnahtari(cwd)),
    ...(o.politika !== undefined ? { uzakPolitikaDenetimi: async () => { politikaCagrisi++; return o.politika!; } } : {}),
    kapanisSuresiMs: 1500, kapatmaBeklemeMs: 1500,
  });
  acik.push(y);
  const olaylar = (id: string, tur?: Olay['tur']) => zarflar.filter((z) => z.oturum === id && (!tur || z.olay.tur === tur)).map((z) => z.olay);
  const bekleOlay = async <T extends Olay['tur']>(id: string, tur: T, n = 1) => {
    await bekleKosul(() => olaylar(id, tur).length >= n, 10_000, `${tur} #${n}`);
    return olaylar(id, tur)[n - 1] as Extract<Olay, { tur: T }>;
  };
  return { y, olaylar, bekleOlay, kararlar, politikaCagrisi: () => politikaCagrisi };
}

// ── Klasör tarama ve depo ───────────────────────────────────────────────────────────────────────────────────────────────────
test('klasör tarama: proje/yerel ayar, git kökündeki yerel ayar, üst klasördeki .mcp.json, komut/beceri/ajan; kullanıcının ~/.claude’u sayılmaz', () => {
  const ust = proje({ '.mcp.json': JSON.stringify({ mcpServers: { github: {}, 'veri\u202etabani': {} } }), '.git/HEAD': 'ref: refs/heads/main\n', '.claude/settings.local.json': JSON.stringify({ permissions: { allow: ['Read'] } }) });
  const alt = path.join(ust, 'paket');
  fs.mkdirSync(path.join(alt, '.claude', 'commands'), { recursive: true });
  fs.writeFileSync(path.join(alt, '.claude', 'commands', 'dagit.md'), '# dağıt');
  fs.writeFileSync(path.join(alt, '.claude', 'settings.json'), JSON.stringify({ hooks: { SessionStart: [], PreToolUse: [] }, permissions: { allow: ['Bash(*)', 'Edit'] }, env: { A: '1' } }));
  const a = klasorAyarlariniBul(alt, claudeDiz);
  const adlar = a.dosyalar.map((d) => d.ad);
  assert.deepEqual(adlar, ['.claude/settings.json', '../.claude/settings.local.json', '.claude/ (komut, beceri, ajan, kanca)', '../.mcp.json']);
  assert.equal(a.mcp, true);
  assert.equal(a.dosyalar[0].ozet, 'kancalar: SessionStart, PreToolUse · 2 izin kuralı · 1 ortam değişkeni');
  assert.equal(a.dosyalar[2].ozet, '1 komut');
  assert.match(a.dosyalar[3].ozet, /^MCP sunucuları: github, veritabani$/, 'yön karakteri ayıklandı');
  assert.equal(klasorAyarlariniBul(proje()).dosyalar.length, 0, 'ayarsız klasör');
  // cwd ev klasörüyse oradaki .claude/settings.json KULLANICI ayarıdır.
  const ev = proje({ '.claude/settings.json': '{}' });
  assert.equal(klasorAyarlariniBul(ev, path.join(ev, '.claude')).dosyalar.length, 0);
  assert.equal(klasorAyarlariniBul(ev).dosyalar.length, 1);
  assert.equal(ayarOzeti({ apiKeyHelper: 'x', enableAllProjectMcpServers: true }), 'MCP sunucularını açar · anahtar yardımcısı');
  const bozuk = proje({ '.claude/settings.json': '{ bozuk' });
  assert.equal(klasorAyarlariniBul(bozuk).dosyalar[0].ozet, 'okunamadı (bozuk JSON)');
});

test('güven deposu: klasör başına karar, kalıcı, Windows’ta büyük/küçük harf duyarsız, silinir; bozuk dosya = karar yok', () => {
  const dosya = path.join(tmp, 'guven', 'claude-klasor-guveni.json');
  const d = new KlasorGuvenDeposu(() => dosya);
  const p = proje();
  assert.equal(d.karar(p), undefined);
  d.ayarla(p, 'guvenme');
  d.ayarla(p + path.sep, 'guven');
  assert.equal(new KlasorGuvenDeposu(() => dosya).karar(p), 'guven', 'yeni örnek dosyadan okur; sondaki ayıraç aynı klasör');
  if (process.platform === 'win32') assert.equal(d.karar(p.toUpperCase()), 'guven');
  assert.equal(d.liste().length, 1);
  d.ayarla(p, null);
  assert.equal(new KlasorGuvenDeposu(() => dosya).karar(p), undefined);
  fs.writeFileSync(dosya, '{ bozuk');
  assert.equal(new KlasorGuvenDeposu(() => dosya).karar(p), undefined);
});

// ── N3: karar, taranan dosya kümesinin parmak iziyle; ayarlar değişince yeniden sorulur ───────────────────────────────────────
test('N3: parmak izi ad + içerikten; karar izle eşleşirse geçerli, kanca eklenince / yeni .mcp.json / yeni komut gelince ya da izsiz kayıtta YOK sayılır', () => {
  const p = proje(AYARLI);
  const ilk = klasorAyarlariniBul(p);
  assert.match(ilk.parmakIzi, /^[0-9a-f]{64}$/);
  assert.equal(klasorAyarlariniBul(p).parmakIzi, ilk.parmakIzi, 'kararlı');
  assert.equal(klasorAyarlariniBul(proje()).parmakIzi, '', 'ayarsız klasör');
  const kayit = { karar: 'guven' as const, parmakIzi: ilk.parmakIzi };
  assert.equal(klasorGuvenDurumu(p, kayit).karar, 'guven');
  assert.equal(klasorGuvenDurumu(p, kayit).degisti, undefined);
  // `git pull` yeni kanca getirdi
  fs.writeFileSync(path.join(p, '.claude', 'settings.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'curl kötü' }] }] } }));
  const d1 = klasorGuvenDurumu(p, kayit);
  assert.equal(d1.karar, undefined);
  assert.equal(d1.degisti, true);
  // Geri alınca karar yine geçerli; yeni dosyalar da izi değiştirir.
  fs.writeFileSync(path.join(p, '.claude', 'settings.json'), AYARLI['.claude/settings.json']);
  assert.equal(klasorGuvenDurumu(p, kayit).karar, 'guven');
  fs.writeFileSync(path.join(p, '.mcp.json'), '{"mcpServers":{"y":{}}}');
  assert.equal(klasorGuvenDurumu(p, kayit).degisti, true, 'yeni .mcp.json');
  fs.rmSync(path.join(p, '.mcp.json'));
  fs.mkdirSync(path.join(p, '.claude', 'skills', 'b'), { recursive: true });
  fs.writeFileSync(path.join(p, '.claude', 'skills', 'b', 'SKILL.md'), '---\nallowed-tools: Bash(*)\n---\n');
  assert.equal(klasorGuvenDurumu(p, kayit).degisti, true, 'yeni beceri');
  assert.equal(klasorGuvenDurumu(p, { karar: 'guven' }).degisti, true, 'izsiz (eski) kayıt geçerli sayılmaz');
  // Depo izi saklar.
  const dosya = path.join(tmp, 'guven-n3', 'k.json');
  const dp = new KlasorGuvenDeposu(() => dosya);
  dp.ayarla(p, 'guvenme', 'a'.repeat(64));
  assert.deepEqual(new KlasorGuvenDeposu(() => dosya).kayit(p), { karar: 'guvenme', parmakIzi: 'a'.repeat(64) });
});

test('N3: güvenilen klasörün ayarları sonradan değişince sayfadan oturum yine kartla başlar (degisti); telefon oturumu ayarları yüklemez', async () => {
  const p = proje(AYARLI);
  const iz = klasorAyarlariniBul(p).parmakIzi;
  const kararlar = new Map<string, { karar: 'guven'; parmakIzi: string }>([[guvenAnahtari(p), { karar: 'guven', parmakIzi: iz }]]);
  const y = new CcYonetici({ komut: ccKomutu, ayar: () => ({ tamYetki: false, varsayilanMod: 'acceptEdits' }), klasorGuveni: (cwd) => kararlar.get(guvenAnahtari(cwd)), uzakPolitikaDenetimi: async () => true, kapanisSuresiMs: 1500 });
  acik.push(y);
  fs.writeFileSync(path.join(p, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { allow: ['Bash(*)'] } }));
  const r = await y.baslat({ cwd: p, istem: '#durum' });
  assert.equal(r.kod, 'klasor-guveni');
  assert.equal(r.guven?.degisti, true);
  assert.equal(r.guven?.karar, undefined);
  const tel = await y.baslat({ cwd: p, istem: '#durum', kaynak: 'telefon' });
  assert.ok(tel.tamam, tel.hata);
  await bekleKosul(() => argvler(p).length > 0, 10_000, 'süreç');
  assert.equal(bayrak(argvler(p)[0], '--setting-sources'), 'user', 'değişen ayarlar yüklenmez');
});

// ── Motor: klasör güveni ───────────────────────────────────────────────────────────────────────────────────────────────────
test('I1: sayfadan ilk oturum, klasörün kendi ayarları varken karar verilmeden AÇILMAZ (süreç yok); ayarsız klasör kapısız', async () => {
  const t = kur();
  const p = proje({ ...AYARLI, '.mcp.json': '{"mcpServers":{"x":{}}}' });
  const r = await t.y.baslat({ cwd: p, istem: '#durum', kaynak: 'sayfa' });
  assert.equal(r.tamam, false);
  assert.equal(r.kod, 'klasor-guveni');
  assert.deepEqual(r.guven?.dosyalar.map((d) => d.ad), ['.claude/settings.json', '.mcp.json']);
  assert.equal(t.y.oturumlar().length, 0, 'kayıt oluşmadı');
  // Geçmişten sürdürme de aynı kapıdan geçer.
  const s = await t.y.baslat({ cwd: p, surdur: 'aaaa3333-0000-4000-8000-000000000003', istem: 'x' });
  assert.equal(s.kod, 'klasor-guveni');
  await uyu(300);
  assert.equal(argvler(p).length, 0, 'claude hiç başlamadı');
  const bos = proje();
  const b = await t.y.baslat({ cwd: bos, istem: '#durum' });
  assert.equal(b.tamam, true);
  await t.bekleOlay(b.oturum!.id, 'sonuc');
  assert.equal(bayrak(argvler(bos)[0], '--setting-sources'), undefined, 'ayarsız klasörde bütün kaynaklar (CLI varsayılanı)');
});

test('I1: güvenilmeyen klasör → --setting-sources=user (+ .mcp.json varsa --strict-mcp-config) ve dökümde not; güvenilen → bütün kaynaklar', async () => {
  const t = kur();
  const red = proje({ ...AYARLI, '.mcp.json': '{"mcpServers":{"x":{}}}' });
  t.kararlar.set(guvenAnahtari(red), 'guvenme');
  const r = await t.y.baslat({ cwd: red, istem: '#durum' });
  assert.ok(r.tamam, r.hata);
  await t.bekleOlay(r.oturum!.id, 'sonuc');
  const a = argvler(red)[0];
  assert.equal(bayrak(a, '--setting-sources'), 'user', 'proje ve yerel kaynak yok');
  assert.equal(bayrak(a, '--strict-mcp-config'), true);
  const not = t.olaylar(r.oturum!.id, 'sistem') as Extract<Olay, { tur: 'sistem' }>[];
  assert.ok(not.some((n) => n.seviye === 'bilgi' && /ayarları yüklenmedi \(güvenmedin\)/.test(n.metin)), JSON.stringify(not));
  const evet = proje(AYARLI);
  t.kararlar.set(guvenAnahtari(evet), 'guven');
  const g = await t.y.baslat({ cwd: evet, istem: '#durum' });
  await t.bekleOlay(g.oturum!.id, 'sonuc');
  const ga = argvler(evet)[0];
  assert.equal(bayrak(ga, '--setting-sources'), undefined);
  assert.equal(bayrak(ga, '--strict-mcp-config'), undefined);
  assert.equal((t.olaylar(g.oturum!.id, 'sistem') as { metin: string }[]).filter((n) => /yüklenmedi/.test(n.metin)).length, 0);
});

test('I1: telefon ve sohbet aracı güven kartını yanıtlayamaz — karar yoksa kapı yok ama klasörün ayarları YÜKLENMEZ', async () => {
  const t = kur({ politika: true });
  for (const kaynak of ['telefon', 'sohbet'] as const) {
    const p = proje(AYARLI);
    const r = await t.y.baslat({ cwd: p, istem: '#durum', kaynak, ...(kaynak === 'sohbet' ? { sohbetId: 7 } : {}) });
    assert.ok(r.tamam, `${kaynak}: ${r.hata}`);
    await t.bekleOlay(r.oturum!.id, 'sonuc');
    assert.equal(bayrak(argvler(p)[0], '--setting-sources'), 'user', kaynak);
    assert.ok((t.olaylar(r.oturum!.id, 'sistem') as { metin: string }[]).some((n) => /güven kararı bilgisayarda/.test(n.metin)), kaynak);
  }
});

test('I1: kullanıcı kararı değiştirince klasörün boştaki süreci kapanır; sonraki mesaj yeni kararla açılır', async () => {
  const t = kur();
  const p = proje(AYARLI);
  t.kararlar.set(guvenAnahtari(p), 'guvenme');
  const r = await t.y.baslat({ cwd: p, istem: '#durum' });
  const id = r.oturum!.id;
  await t.bekleOlay(id, 'sonuc');
  await bekleKosul(() => t.y.ozetAl(id)?.durum === 'bosta', 3000, 'boşta');
  t.kararlar.set(guvenAnahtari(p), 'guven');
  assert.equal(await t.y.klasorGuveniDegisti(p), 1);
  assert.equal((await t.y.gonder(id, { metin: '#durum' })).tamam, true);
  await t.bekleOlay(id, 'sonuc', 2);
  const iki = argvler(p);
  assert.equal(iki.length, 2);
  assert.equal(bayrak(iki[0], '--setting-sources'), 'user');
  assert.equal(bayrak(iki[1], '--setting-sources'), undefined, 'yeni süreç klasörün ayarlarıyla');
  assert.ok(bayrak(iki[1], '--resume'), 'aynı konuşma sürer');
});

// ── Motor: telefon politikası (Ruling CA + I1) ─────────────────────────────────────────────────────────────────────────────
test('CA + I1: telefon oturumu --managed-settings (allowManagedPermissionRulesOnly + ask Bash/PowerShell) ile açılır; "hep izin ver" komutta sunulmaz', async () => {
  const t = kur({ politika: true });
  const p = proje();
  const r = await t.y.baslat({ cwd: p, istem: '#izin', kaynak: 'telefon' });
  assert.ok(r.tamam, r.hata);
  const id = r.oturum!.id;
  const istek = await t.bekleOlay(id, 'izin-istegi');
  assert.equal(istek.arac, 'Bash');
  assert.equal(istek.herZamanSunulur, false, 'ask kuralı oturum kuralını da yener: "Bu oturumda hep izin ver" yanıltıcı olurdu');
  t.y.izinYanitla(id, istek.istekId, { karar: 'ret' });
  await t.bekleOlay(id, 'sonuc');
  const a = argvler(p)[0];
  const ms = bayrak(a, '--managed-settings');
  assert.equal(typeof ms, 'string');
  assert.deepEqual(JSON.parse(ms as string), CC_UZAK_POLITIKA);
  assert.deepEqual(CC_UZAK_POLITIKA, { allowManagedPermissionRulesOnly: true, allowManagedHooksOnly: true, permissions: { ask: ['Bash', 'PowerShell'], disableBypassPermissionsMode: 'disable' } });
  assert.equal(bayrak(a, '--disallowedTools'), undefined, 'politika etkin: komutlar masada onayla çalışabilir');
  assert.equal(t.politikaCagrisi(), 1);
  // Masadaki oturum politikasız (kullanıcının kendi kuralları geçerli; masada "hep izin ver" sunulur).
  const masa = proje();
  const m = await t.y.baslat({ cwd: masa, istem: '#izin' });
  const mi = await t.bekleOlay(m.oturum!.id, 'izin-istegi');
  assert.equal(mi.herZamanSunulur, true);
  t.y.izinYanitla(m.oturum!.id, mi.istekId, { karar: 'ret' });
  await t.bekleOlay(m.oturum!.id, 'sonuc');
  assert.equal(bayrak(argvler(masa)[0], '--managed-settings'), undefined);
});

test('CA + I1: politika bu makinede etkin değilse (yönetici katmanı düşürdü / denetlenemedi) telefon oturumunda Bash ve PowerShell KAPALI', async () => {
  const t = kur({ politika: false });
  const p = proje();
  const r = await t.y.baslat({ cwd: p, istem: '#durum', kaynak: 'telefon' });
  await t.bekleOlay(r.oturum!.id, 'sonuc');
  const a = argvler(p)[0];
  assert.equal(bayrak(a, '--disallowedTools'), 'Bash,PowerShell');
  assert.ok(bayrak(a, '--managed-settings'));
  assert.ok((t.olaylar(r.oturum!.id, 'sistem') as Extract<Olay, { tur: 'sistem' }>[]).some((n) => n.seviye === 'uyari' && /komutlar \(Bash, PowerShell\) kapalı/.test(n.metin)));
  // Varsayılan denetim: testte çocuk sürecin yapılandırma dizini (FUBER_CLAUDE_DIZIN) ana süreçtekiyle aynı değil → denetlenemez → kapalı.
  const v = new CcYonetici({ komut: ccKomutu, ayar: () => ({ tamYetki: false, varsayilanMod: 'acceptEdits' }), kapanisSuresiMs: 1500 });
  acik.push(v);
  const vp = proje();
  const vr = await v.baslat({ cwd: vp, istem: '#durum', kaynak: 'telefon' });
  assert.ok(vr.tamam);
  await bekleKosul(() => argvler(vp).length > 0, 10_000, 'süreç');
  assert.equal(bayrak(argvler(vp)[0], '--disallowedTools'), 'Bash,PowerShell', 'varsayılan: kapalı başarısızlık');
});

// ── Motor: sohbet aracının mod tavanı (I2) ─────────────────────────────────────────────────────────────────────────────────
test('I2: varsayılan mod Tam yetki iken sohbet aracından başlayan oturum en çok acceptEdits (izinsiz bayrak YOK); masada açıkça Tam yetki seçilince tavan kalkar', async () => {
  const t = kur({ ayar: { tamYetki: true, varsayilanMod: 'bypassPermissions' } });
  const p = proje();
  const r = await t.y.baslat({ cwd: p, istem: '#durum', kaynak: 'sohbet', sohbetId: 9, mod: 'bypassPermissions' });
  assert.ok(r.tamam, r.hata);
  const id = r.oturum!.id;
  assert.equal(r.oturum!.mod, 'acceptEdits');
  await t.bekleOlay(id, 'sonuc');
  await bekleKosul(() => t.y.ozetAl(id)?.durum === 'bosta', 3000, 'boşta');
  const a = argvler(p)[0];
  assert.equal(bayrak(a, '--permission-mode'), 'acceptEdits');
  assert.equal(a.includes('--allow-dangerously-skip-permissions'), false, 'süreç Tam yetki izniyle açılmadı');
  assert.equal(bayrak(a, '--managed-settings'), undefined, 'masadaki sohbet turu telefon politikası almaz');
  // Kapanıp yeniden açılsa da tavan kalır (resume).
  await t.y.kapat(id);
  assert.equal((await t.y.gonder(id, { metin: '#durum' })).tamam, true);
  await t.bekleOlay(id, 'sonuc', 2);
  assert.equal(bayrak(argvler(p)[1], '--permission-mode'), 'acceptEdits');
  assert.equal(argvler(p)[1].includes('--allow-dangerously-skip-permissions'), false);
  // Kullanıcı masada (claudecode:mod telefondan KAPALI) açıkça Tam yetki seçer → süreç Tam yetki izniyle yeniden açılır.
  await bekleKosul(() => t.y.ozetAl(id)?.durum === 'bosta', 3000, 'boşta 2');
  assert.equal((await t.y.modDegistir(id, 'bypassPermissions')).tamam, true);
  assert.equal((await t.y.gonder(id, { metin: '#durum' })).tamam, true);
  await t.bekleOlay(id, 'sonuc', 3);
  const son = argvler(p).at(-1)!;
  assert.equal(bayrak(son, '--permission-mode'), 'bypassPermissions');
  assert.equal(son.includes('--allow-dangerously-skip-permissions'), true);
  // Kıyas: sayfadan başlayan oturum varsayılanla Tam yetkide.
  const masa = proje();
  const m = await t.y.baslat({ cwd: masa, istem: '#durum' });
  assert.equal(m.oturum!.mod, 'bypassPermissions');
  await t.bekleOlay(m.oturum!.id, 'sonuc');
  assert.equal(argvler(masa)[0].includes('--allow-dangerously-skip-permissions'), true);
});

test('I2: kapanmış bir masa oturumunu sohbet aracı sürdürürse de tavan konur', async () => {
  const t = kur({ ayar: { tamYetki: true, varsayilanMod: 'bypassPermissions' } });
  const p = proje();
  const kimlik = 'aaaa4444-0000-4000-8000-000000000004';
  const r = await t.y.baslat({ cwd: p, istem: '#durum', surdur: kimlik });
  const id = r.oturum!.id;
  await t.bekleOlay(id, 'sonuc');
  await t.y.kapat(id);
  const s = await t.y.baslat({ cwd: p, surdur: kimlik, istem: '#durum', kaynak: 'sohbet', sohbetId: 4 });
  assert.equal(s.oturum!.id, id, 'aynı kayıt');
  assert.equal(s.oturum!.mod, 'acceptEdits');
  await t.bekleOlay(id, 'sonuc', 2);
  assert.equal(argvler(p).at(-1)!.includes('--allow-dangerously-skip-permissions'), false);
});
