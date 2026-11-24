// 13 Kas ("Cowork çalışmıyor" onarımı): kullanıcının kendi Chrome'u. Saf durum kuralı, diske/kayıt defterine yalnız OKUYAN denetleyici (sahte okuyucuyla;
// gerçek Chrome profiline ve kayıt defterine dokunulmaz) ve Claude Code oturumunun `--chrome` bayrağı (GERÇEK Agent SDK + SAHTE Claude Code;
// gerçek claude.exe ASLA çalışmaz). Kök neden: bayrak hiçbir yerde geçirilmiyordu ve Fuber'in kendi eklentisi hiç yazılmamıştı.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const kok = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-chrome-'));
process.env.FUBER_CLAUDE_DIZIN = path.join(tmp, '.claude');
delete process.env.CLAUDE_CONFIG_DIR;
process.env.FUBER_CLAUDE_KOMUT = JSON.stringify([process.execPath, path.join(kok, 'scripts/dev/sahte-claude.mjs')]);
const KAYIT = path.join(tmp, 'argv.jsonl');
process.env.FUBER_SAHTE_CLAUDE_KAYIT = KAYIT;
delete process.env.SAHTE_CC_PID_DOSYASI;

const {
  CHROME_ANA_BILGISAYAR, CHROME_EKLENTI_ADRESI, CHROME_EKLENTI_KIMLIGI, chromeBayraklari, chromeDurumuHesapla, chromeProfilAdiMi,
} = await import('../src/shared/chrome-baglanti.ts');
const { anaBilgisayarDurumu, chromeBilgisi, chromeEklentisiKurulu, eklentiProfilleri } = await import('../src/main/chrome-baglanti.ts');
const { CcYonetici } = await import('../src/main/claudecode/oturum-yoneticisi.ts');
const { ccKomutu } = await import('../src/main/claudecode/yurutucu.ts');
const { CC_AYAR_VARSAYILAN, ccAyarGoc } = await import('../src/shared/cc-ayar.ts');
const { CAGRI_KANALLARI } = await import('../src/shared/kanallar.ts');
type Okuyucu = import('../src/main/chrome-baglanti.ts').ChromeOkuyucu;

const acik: InstanceType<typeof CcYonetici>[] = [];
// Önce oturumlar kapanır (sahte claude'un klasörü tutması), sonra geçici klasör silinir.
after(async () => { for (const y of acik) await y.hepsiniKapat(); fs.rmSync(tmp, { recursive: true, force: true }); });

// ── Saf kural ──────────────────────────────────────────────────────────────────────────────────────────────────────────
test('durum: Chrome yok → eklenti yok → hazır; her durumda kullanıcıya adım adım yol verilir', () => {
  const yok = chromeDurumuHesapla({ chromeVar: false, eklentiProfilleri: [], anaBilgisayar: 'yok' });
  assert.equal(yok.durum, 'chrome-yok');
  const eklentisiz = chromeDurumuHesapla({ chromeVar: true, eklentiProfilleri: [], anaBilgisayar: 'yok' });
  assert.equal(eklentisiz.durum, 'eklenti-yok');
  assert.match(eklentisiz.adimlar[0], /Eklentiyi aç/);
  assert.equal(eklentisiz.adimlar.length, 3, 'eklentiyi kur → giriş yap → dene');
  const hazir = chromeDurumuHesapla({ chromeVar: true, eklentiProfilleri: ['Default'], anaBilgisayar: 'tamam' });
  assert.equal(hazir.durum, 'hazir');
  assert.doesNotMatch(hazir.ozet, /kendisi yazar/);
  // Ana bilgisayar kaydı henüz yoksa hazır sayılır ama kullanıcıya dürüstçe söylenir (Claude Code ilk `--chrome` açılışında yazar).
  assert.match(chromeDurumuHesapla({ chromeVar: true, eklentiProfilleri: ['Default'], anaBilgisayar: 'yok' }).ozet, /ilk açılışta kendisi yazar/);
  assert.match(chromeDurumuHesapla({ chromeVar: true, eklentiProfilleri: ['Default'], anaBilgisayar: 'bozuk' }).ozet, /bozuk/);
  for (const b of [yok, eklentisiz, hazir]) assert.ok(b.ozet.length > 0 && b.adimlar.every((a) => a.length > 0));
});

test('bayrak: --chrome yalnız ayar açık VE eklenti kuruluysa', () => {
  assert.deepEqual(chromeBayraklari(true, 'hazir'), { chrome: null });
  assert.deepEqual(chromeBayraklari(false, 'hazir'), {});
  assert.deepEqual(chromeBayraklari(true, 'eklenti-yok'), {});
  assert.deepEqual(chromeBayraklari(true, 'chrome-yok'), {});
});

test('sabitler: eklenti kimliği Claude Code ana bilgisayar manifestindeki kimlikle aynı, adres mağaza adresi, ana bilgisayar adı Claude Code\'un', () => {
  assert.equal(CHROME_EKLENTI_KIMLIGI, 'fcoeoabgfenejglbffodgkkbkcdhcgfn');
  assert.equal(CHROME_EKLENTI_ADRESI, `https://chromewebstore.google.com/detail/claude/${CHROME_EKLENTI_KIMLIGI}`);
  assert.equal(CHROME_ANA_BILGISAYAR, 'com.anthropic.claude_code_browser_extension');
  assert.ok(chromeProfilAdiMi('Default') && chromeProfilAdiMi('Profile 3'));
  assert.ok(!chromeProfilAdiMi('System Profile') && !chromeProfilAdiMi('Guest Profile') && !chromeProfilAdiMi('Profile'));
});

// ── Denetleyici (sahte disk + sahte kayıt defteri) ───────────────────────────────────────────────────────────────────────
/** Geçici "User Data" ağacı: her profil için eklenti klasörleri. */
function ChromeAgaci(profiller: Record<string, string[]>): string {
  const kokDizin = fs.mkdtempSync(path.join(tmp, 'ud-'));
  for (const [p, eklentiler] of Object.entries(profiller)) {
    fs.mkdirSync(path.join(kokDizin, p, 'Extensions'), { recursive: true });
    for (const e of eklentiler) fs.mkdirSync(path.join(kokDizin, p, 'Extensions', e, '1.0_0'), { recursive: true });
  }
  return kokDizin;
}
function okuyucu(kullaniciVerisi: string | null, kayit: string | null): Okuyucu {
  return {
    kullaniciVerisi: () => kullaniciVerisi,
    kayitDegeri: async (ad) => (ad === CHROME_ANA_BILGISAYAR ? kayit : null),
    dosyaVar: (y) => { try { return fs.statSync(y).isFile(); } catch { return false; } },
    dosyaOku: (y) => { try { return fs.readFileSync(y, 'utf8'); } catch { return null; } },
    klasorler: (y) => { try { return fs.readdirSync(y, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; } },
  };
}
function manifest(exeVar: boolean, o: { ad?: string; kimlik?: string } = {}): string {
  const d = fs.mkdtempSync(path.join(tmp, 'mf-'));
  const exe = path.join(d, 'ana-bilgisayar.bat');
  if (exeVar) fs.writeFileSync(exe, '@echo off\r\n');
  const yol = path.join(d, 'm.json');
  fs.writeFileSync(yol, JSON.stringify({ name: o.ad ?? CHROME_ANA_BILGISAYAR, description: 'x', path: exe, type: 'stdio', allowed_origins: [`chrome-extension://${o.kimlik ?? CHROME_EKLENTI_KIMLIGI}/`] }));
  return yol;
}

test('eklenti taraması: yalnız Default ve Profile N; eklentisi olan profiller, sıralı; başka eklentiler sayılmaz', () => {
  const ud = ChromeAgaci({ Default: ['abc', CHROME_EKLENTI_KIMLIGI], 'Profile 2': ['abc'], 'Profile 5': [CHROME_EKLENTI_KIMLIGI], 'System Profile': [CHROME_EKLENTI_KIMLIGI] });
  assert.deepEqual(eklentiProfilleri(okuyucu(ud, null)), ['Default', 'Profile 5']);
  assert.equal(chromeEklentisiKurulu(okuyucu(ud, null)), true);
  assert.equal(chromeEklentisiKurulu(okuyucu(ChromeAgaci({ Default: ['abc'] }), null)), false);
  assert.equal(chromeEklentisiKurulu(okuyucu(null, null)), false, 'Chrome yoksa kurulu değil');
});

test('ana bilgisayar kaydı: anahtar yok → yok; manifest yok / yanlış ad / yanlış kimlik / exe yok → bozuk; hepsi tamam → tamam', async () => {
  assert.equal(await anaBilgisayarDurumu(okuyucu(null, null)), 'yok');
  assert.equal(await anaBilgisayarDurumu(okuyucu(null, path.join(tmp, 'olmayan.json'))), 'bozuk');
  assert.equal(await anaBilgisayarDurumu(okuyucu(null, manifest(false))), 'bozuk', 'çalıştırılacak dosya yerinde değil');
  assert.equal(await anaBilgisayarDurumu(okuyucu(null, manifest(true, { ad: 'baska.ad' }))), 'bozuk');
  assert.equal(await anaBilgisayarDurumu(okuyucu(null, manifest(true, { kimlik: 'x'.repeat(32) }))), 'bozuk', 'yalnız Claude eklentisinin kimliğine açık olmalı');
  assert.equal(await anaBilgisayarDurumu(okuyucu(null, manifest(true))), 'tamam');
  const bozukJson = path.join(tmp, 'bozuk.json'); fs.writeFileSync(bozukJson, '{ bozuk');
  assert.equal(await anaBilgisayarDurumu(okuyucu(null, bozukJson)), 'bozuk');
});

test('chromeBilgisi: Chrome yok / eklenti yok / hazır, uçtan uca', async () => {
  assert.equal((await chromeBilgisi(okuyucu(null, null))).durum, 'chrome-yok');
  assert.equal((await chromeBilgisi(okuyucu(ChromeAgaci({ Default: [] }), null))).durum, 'eklenti-yok');
  const b = await chromeBilgisi(okuyucu(ChromeAgaci({ Default: [CHROME_EKLENTI_KIMLIGI] }), manifest(true)));
  assert.equal(b.durum, 'hazir'); assert.equal(b.anaBilgisayar, 'tamam'); assert.deepEqual(b.eklentiProfilleri, ['Default']);
});

// ── Claude Code oturumu: --chrome ──────────────────────────────────────────────────────────────────────────────────────
const uyu = (ms: number) => new Promise((r) => setTimeout(r, ms));
let sayac = 0;

async function oturumBayraklari(ayar: { chrome?: boolean }, kurulu: boolean | 'atar'): Promise<string[]> {
  const proje = path.join(tmp, `proje-${++sayac}`);
  fs.mkdirSync(proje, { recursive: true });
  const y = new CcYonetici({
    komut: ccKomutu, ayar: () => ({ tamYetki: false, varsayilanMod: 'acceptEdits', ...ayar }),
    chromeKurulu: () => { if (kurulu === 'atar') throw new Error('disk okunamadı'); return kurulu; },
    kapanisSuresiMs: 1500, kapatmaBeklemeMs: 1500,
  });
  acik.push(y);
  const r = await y.baslat({ cwd: proje, istem: 'merhaba' });
  assert.ok(r.tamam, r.hata);
  const son = Date.now() + 10_000;
  for (;;) {
    const satirlar = fs.existsSync(KAYIT) ? fs.readFileSync(KAYIT, 'utf8').trim().split('\n').filter(Boolean).map((s) => JSON.parse(s) as { argv: string[]; cwd: string }) : [];
    const bu = satirlar.find((x) => path.resolve(x.cwd).toLowerCase() === path.resolve(proje).toLowerCase() && x.argv.includes('--input-format'));
    if (bu) return bu.argv;
    if (Date.now() > son) throw new Error('sahte claude açılmadı');
    await uyu(20);
  }
}

test('oturum: ayar açık + eklenti kurulu → claude --chrome ile açılır', async () => {
  const a = await oturumBayraklari({ chrome: true }, true);
  assert.ok(a.includes('--chrome'), a.join(' '));
  assert.ok(!a.includes('--no-chrome'));
});

test('oturum: ayar alanı yoksa (eski kayıt) açık sayılır; ayar kapalı, eklenti yok ya da denetim atarsa --chrome yok (Chrome\'suz açılır, oturum düşmez)', async () => {
  assert.ok((await oturumBayraklari({}, true)).includes('--chrome'));
  assert.ok(!(await oturumBayraklari({ chrome: false }, true)).includes('--chrome'));
  assert.ok(!(await oturumBayraklari({ chrome: true }, false)).includes('--chrome'));
  assert.ok(!(await oturumBayraklari({ chrome: true }, 'atar')).includes('--chrome'));
});
