// 0.14 son inceleme I6 — paket bekçisi (scripts/paket-bekcisi.mjs): junction'lı node_modules ya da eksik üretim paketiyle kurulum dosyası "başarılı"
// diye çıkmaz. Geçici klasörlerde sahte node_modules ve gerçek @electron/asar ile küçük asar; gerçek release/ ya da kurulum dosyasına dokunulmaz.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { nodeModulesDenetle, uretimKapanisi, dislamalar, eksikleriBul, paketAdlari, paketiDenetle } from '../scripts/paket-bekcisi.mjs';

const KOK = path.resolve(import.meta.dirname, '..');
const geciciler: string[] = [];
after(() => { for (const d of geciciler) fs.rmSync(d, { recursive: true, force: true }); });
const gecici = (ad: string) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `fuber-bekci-${ad}-`)); geciciler.push(d); return d; };
const yaz = (p: string, v: unknown) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v)); };

/** Sahte proje: a → (b iç içe, c üstte), a isteğe bağlı d (kurulu değil), e zorunlu (kurulu değil yalnız `kayipli`de), @k/n yerel eklentili. */
function projeKur(o: { kayipli?: boolean } = {}): string {
  const kok = gecici('proje');
  yaz(path.join(kok, 'package.json'), { name: 'p', dependencies: { a: '1', '@k/n': '1', ...(o.kayipli ? { e: '1' } : {}) }, devDependencies: { gelistirme: '1' } });
  const nm = path.join(kok, 'node_modules');
  yaz(path.join(nm, 'a', 'package.json'), { name: 'a', dependencies: { b: '1', c: '1' }, optionalDependencies: { d: '1' } });
  yaz(path.join(nm, 'a', 'node_modules', 'b', 'package.json'), { name: 'b' });
  yaz(path.join(nm, 'c', 'package.json'), { name: 'c' });
  yaz(path.join(nm, '@k', 'n', 'package.json'), { name: '@k/n' });
  yaz(path.join(nm, '@k', 'n', 'bin', 'n.node'), 'MZ');
  yaz(path.join(nm, 'gelistirme', 'package.json'), { name: 'gelistirme' });
  return kok;
}

test('once: gerçek node_modules sağlam; junction/symlink ya da proje dışı gerçek yol durdurur; yoksa durdurur', (t) => {
  const kok = projeKur();
  assert.equal(nodeModulesDenetle(kok), null);
  const bos = gecici('bos');
  assert.match(nodeModulesDenetle(bos)!, /node_modules yok/);
  const dis = projeKur();
  const bagli = gecici('bagli');
  try { fs.symlinkSync(path.join(dis, 'node_modules'), path.join(bagli, 'node_modules'), 'junction'); } catch (e) { t.skip(`junction kurulamadı: ${(e as Error).message}`); return; }
  assert.match(nodeModulesDenetle(bagli)!, /bağlantı/);
  // Komut satırı: sıfır olmayan çıkış, açık satır.
  const r = spawnSync(process.execPath, [path.join(KOK, 'scripts', 'paket-bekcisi.mjs'), 'once', bagli], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /PAKET BEKÇİSİ \(once\)/);
  assert.match(r.stderr, /npm ci/);
  const iyi = spawnSync(process.execPath, [path.join(KOK, 'scripts', 'paket-bekcisi.mjs'), 'once', kok], { encoding: 'utf8' });
  assert.equal(iyi.status, 0, iyi.stderr);
});

test('uretimKapanisi: dependencies + kurulu optionalDependencies özyinelemeli (iç içe node_modules dahil); devDependencies girmez; diskte olmayan zorunlu "kayip"', () => {
  const kok = projeKur({ kayipli: true });
  const { paketler, kayip } = uretimKapanisi(kok);
  assert.deepEqual(paketler.map((p: { ad: string }) => p.ad).sort(), ['@k/n', 'a', 'b', 'c']);
  assert.deepEqual(kayip, ['e'], 'kurulu olmayan isteğe bağlı d kayıp sayılmaz');
});

test('dislamalar: electron-builder.yml\'deki "!node_modules/<desen>/**" — Agent SDK ikilisi bilerek eksik', () => {
  const r = dislamalar(fs.readFileSync(path.join(KOK, 'electron-builder.yml'), 'utf8'));
  assert.ok(r.some((x: RegExp) => x.test('@anthropic-ai/claude-agent-sdk-win32-x64')));
  assert.ok(!r.some((x: RegExp) => x.test('@anthropic-ai/claude-agent-sdk')), 'SDK\'nın kendisi dışlanmaz');
  assert.ok(!r.some((x: RegExp) => x.test('docx')));
});

test('eksikleriBul ve paketAdlari (saf): asar ya da açık klasörde olmayan gerekli paket eksik; yerel eklentili paket açık klasörde olmalı', () => {
  const asar = paketAdlari(['\\node_modules\\a\\package.json', '\\node_modules\\a\\node_modules\\b\\package.json', '\\node_modules\\@k\\n\\package.json', '\\dist\\main\\main.js']);
  assert.deepEqual([...asar].sort(), ['@k/n', 'a', 'b']);
  const gerekli = [{ ad: 'a' }, { ad: 'b' }, { ad: 'c' }, { ad: '@k/n', yerel: true }, { ad: 'x-win32' }];
  const r = eksikleriBul({ gerekli, asar, acik: new Set(), haric: [/^x-.*$/] });
  assert.deepEqual(r, { eksik: ['c'], yerelEksik: ['@k/n'] });
  assert.deepEqual(eksikleriBul({ gerekli, asar: new Set([...asar, 'c']), acik: new Set(['@k/n']), haric: [/^x-.*$/] }), { eksik: [], yerelEksik: [] });
});

test('paketiDenetle: gerçek asar — eksik paketli (junction\'lı kopya gibi) paket durdurur; tam paket sağlam; app.asar yoksa durdurur', async () => {
  const kok = projeKur();
  const asar = createRequire(path.join(KOK, 'package.json'))('@electron/asar') as { createPackage: (a: string, b: string) => Promise<void> };
  // Eksik: yalnız a (b, c, @k/n yok) — T35'teki 26/263 durumu gibi.
  const eksikApp = gecici('eksik-app');
  yaz(path.join(eksikApp, 'package.json'), { name: 'p' });
  yaz(path.join(eksikApp, 'node_modules', 'a', 'package.json'), { name: 'a' });
  const eksikRes = gecici('eksik-res');
  await asar.createPackage(eksikApp, path.join(eksikRes, 'app.asar'));
  const h = paketiDenetle({ kok, kaynaklar: eksikRes, yml: '' });
  assert.ok(h.some((x: string) => /3 üretim paketi eksik: @k\/n, b, c/.test(x)), h.join('\n'));
  // Tam: hepsi asar'da, yerel eklentili @k/n app.asar.unpacked'da.
  const tamApp = gecici('tam-app');
  for (const p of ['a', 'a/node_modules/b', 'c', '@k/n']) yaz(path.join(tamApp, 'node_modules', ...p.split('/'), 'package.json'), { name: path.basename(p) });
  const tamRes = gecici('tam-res');
  await asar.createPackage(tamApp, path.join(tamRes, 'app.asar'));
  yaz(path.join(tamRes, 'app.asar.unpacked', 'node_modules', '@k', 'n', 'package.json'), { name: '@k/n' });
  assert.deepEqual(paketiDenetle({ kok, kaynaklar: tamRes, yml: '' }), []);
  // Yerel eklenti açık klasörde değilse durdurur.
  fs.rmSync(path.join(tamRes, 'app.asar.unpacked'), { recursive: true });
  assert.ok(paketiDenetle({ kok, kaynaklar: tamRes, yml: '' }).some((x: string) => /app\.asar\.unpacked'da yok: @k\/n/.test(x)));
  assert.match(paketiDenetle({ kok, kaynaklar: gecici('asarsiz'), yml: '' })[0], /app\.asar yok/);
  // En az paket sayısı.
  assert.ok(paketiDenetle({ kok, kaynaklar: eksikRes, yml: '', enAz: 200 }).some((x: string) => /en az 200/.test(x)));
});

test('kablolama: npm run dist önce bekçiyle başlar; kurulum-paketle.mjs başlatıcıdan ÖNCE paketi denetler ve bozuksa çıkış 1; Fuber Yönetim de', () => {
  const pk = JSON.parse(fs.readFileSync(path.join(KOK, 'package.json'), 'utf8'));
  assert.match(pk.scripts.dist, /^node scripts\/paket-bekcisi\.mjs once && npm run build && electron-builder --win nsis && node scripts\/kurulum-paketle\.mjs$/);
  const kp = fs.readFileSync(path.join(KOK, 'scripts', 'kurulum-paketle.mjs'), 'utf8');
  assert.match(kp, /import \{ nodeModulesDenetle, paketiDenetle \} from '\.\/paket-bekcisi\.mjs'/);
  assert.ok(kp.indexOf('paketiDenetle(') < kp.indexOf('kurulumDerle({'), 'denetim başlatıcı derlenmeden önce');
  assert.match(kp, /process\.exit\(1\)/);
  if (fs.existsSync(path.join(KOK, 'scripts', 'yonetim-paketle.mjs'))) { // açık kaynak hazırlığı: Fuber Yönetim paketlemesi yalnız özel depoda
    const yp = fs.readFileSync(path.join(KOK, 'scripts', 'yonetim-paketle.mjs'), 'utf8');
    assert.match(yp, /nodeModulesDenetle\(KOK\)/);
    assert.match(yp, /paketiDenetle\(\{/);
  }
});
