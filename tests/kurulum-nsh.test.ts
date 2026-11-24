// G2 (0.11 spec §2, Review Focus "Güncelleme ≠ yeniden kurulum"): kaldırıcı eki build/kurulum.nsh — STATİK denetim (kurulum dosyası bu
// makinede derlenmez, kurulmaz, çalıştırılmaz). Üstüne kurulumda eski kaldırıcı `--updated` ile sessiz çalışır: hiçbir şey sormamalı,
// hiçbir şey silmemeli. Kuralları:
//  · `!macro customUnInstall` var; her RMDir ve her `.yeniden-kurulum` yazımı `${ifNot} ${isUpdated}` bloğunun İÇİNDE.
//  · RMDir'in tek hedefi "$APPDATA\Fuber AI" (başka hiçbir yol yok); Delete/RMDir dışında silme komutu yok; electron-builder'ın kendi
//    `--delete-app-data` bayrağı kullanılmaz.
//  · Soru spec'teki cümle; varsayılan Hayır (MB_DEFBUTTON2) ve sessiz kaldırmada `/SD IDNO`; uygulamanın "Kaldır"ı (`--verileri-sil`)
//    sormadan siler.
//  · electron-builder.yml `nsis.include: build/kurulum.nsh` taşır, `deleteAppDataOnUninstall: false` kalır.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const kok = path.resolve(import.meta.dirname, '..');
const nsh = fs.readFileSync(path.join(kok, 'build', 'kurulum.nsh'), 'utf8');
const yml = fs.readFileSync(path.join(kok, 'electron-builder.yml'), 'utf8');
/** Yorumlar (; ve #) atılmış satırlar; satır numaraları korunur. */
const satirlar = nsh.split(/\r?\n/).map((l) => l.replace(/^\s*[;#].*$/, '').trim());

/** customUnInstall makrosunun satır aralığı. */
function makro(ad: string): [number, number] {
  const bas = satirlar.findIndex((l) => new RegExp(`^!macro\\s+${ad}\\b`).test(l));
  assert.ok(bas >= 0, `!macro ${ad} yok`);
  const son = satirlar.findIndex((l, i) => i > bas && /^!macroend\b/.test(l));
  assert.ok(son > bas, `${ad} kapanmıyor`);
  return [bas, son];
}

/** `${ifNot} ${isUpdated}` bloğunun aralığı (LogicLib iç içe if/endIf sayılarak). */
function guncellemeDisiBlok(bas: number, son: number): [number, number] {
  const ac = satirlar.findIndex((l, i) => i > bas && i < son && /^\$\{ifNot\}\s+\$\{isUpdated\}$/i.test(l));
  assert.ok(ac > bas, '${ifNot} ${isUpdated} yok');
  let derinlik = 0;
  for (let i = ac; i < son; i++) {
    const l = satirlar[i];
    if (/^\$\{(if|ifNot|unless)\}/i.test(l)) derinlik++;
    if (/^\$\{endIf\}/i.test(l)) { derinlik--; if (derinlik === 0) return [ac, i]; }
  }
  assert.fail('isUpdated bloğu kapanmıyor');
}

test('customUnInstall: güncelleme koruması makronun İLK komutu; bütün silme ve işaret yazımı onun içinde', () => {
  const [bas, son] = makro('customUnInstall');
  const ilk = satirlar.slice(bas + 1, son).find((l) => l);
  assert.match(ilk ?? '', /^\$\{ifNot\}\s+\$\{isUpdated\}$/i, 'ilk komut güncelleme koruması değil');
  const [ac, kapa] = guncellemeDisiBlok(bas, son);
  const icinde = (i: number) => i > ac && i < kapa;
  const rmdir = satirlar.map((l, i) => [l, i] as const).filter(([l]) => /^RMDir\b/i.test(l));
  assert.ok(rmdir.length >= 2, 'RMDir yok (evet ve --verileri-sil dalları)');
  for (const [l, i] of rmdir) assert.ok(icinde(i), `korumasız RMDir (satır ${i + 1}): ${l}`);
  const isaret = satirlar.map((l, i) => [l, i] as const).filter(([l]) => l.includes('.yeniden-kurulum'));
  assert.ok(isaret.some(([l]) => /^FileOpen\b/i.test(l)), '.yeniden-kurulum FileOpen ile yazılmıyor');
  for (const [l, i] of isaret) assert.ok(icinde(i), `korumasız işaret yazımı (satır ${i + 1}): ${l}`);
  for (const [l, i] of satirlar.map((x, j) => [x, j] as const).filter(([x]) => /^(FileWrite|FileClose)\b/i.test(x))) assert.ok(icinde(i), `korumasız ${l}`);
  // Makro dışında hiçbir komut yok (yalnız tanımlar/yorumlar).
  const disari = satirlar.filter((l, i) => l && (i < bas || i > son) && !/^!(define|include|ifndef|ifdef|endif|macro|macroend)\b/i.test(l));
  assert.deepEqual(disari, [], 'makro dışında komut var');
});

test('RMDir hedefi yalnız "$APPDATA\\Fuber AI"; başka silme komutu ve --delete-app-data yok', () => {
  for (const l of satirlar.filter((x) => /^RMDir\b/i.test(x))) assert.equal(l.replace(/\s+/g, ' '), 'RMDir /r "$APPDATA\\Fuber AI"', l);
  assert.ok(!satirlar.some((l) => /^(Delete|RMDir)\b/i.test(l) && !/^RMDir \/r "\$APPDATA\\Fuber AI"$/.test(l.replace(/\s+/g, ' '))), 'başka silme');
  assert.ok(!/delete-app-data/i.test(nsh), 'electron-builder bayrağı kullanılmamalı');
  assert.ok(!/\$INSTDIR|\$LOCALAPPDATA|\$PROFILE|\$DOCUMENTS|\$TEMP/i.test(satirlar.join('\n')), 'başka bir yola dokunuluyor');
  // İşaret yalnız veri klasörünün içine ve yalnız klasör varsa yazılır.
  assert.match(nsh, /FileOpen\s+\$\w+\s+"\$APPDATA\\Fuber AI\\\.yeniden-kurulum"\s+w/);
  assert.match(nsh, /\$\{FileExists\}\s+"\$APPDATA\\Fuber AI\\\*\.\*"/);
});

test('soru: spec cümlesi, varsayılan Hayır (MB_DEFBUTTON2) ve sessiz kaldırmada /SD IDNO; --verileri-sil sormadan siler', () => {
  const SPEC = 'Fuber’in bu bilgisayardaki verileri de silinsin mi? (hafıza, sohbetler, ayarlar, bağlantılar, indirilen yapay zekâ) Belgeler klasöründeki dosyaların kalır.';
  const kutular = satirlar.filter((l) => /^MessageBox\b/i.test(l));
  assert.ok(kutular.length >= 1);
  for (const k of kutular) {
    const metin = /"([^"]*)"/.exec(k)?.[1] ?? '';
    assert.equal(metin.replace(/\$\\r\$\\n/g, ' ').replace(/\s+/g, ' ').trim(), SPEC);
    assert.match(k, /MB_YESNO/);
    assert.match(k, /MB_DEFBUTTON2/, 'varsayılan düğme Hayır değil');
  }
  assert.ok(kutular.some((k) => /\/SD IDNO/.test(k)), '/SD IDNO yok');
  assert.ok(!kutular.some((k) => /\/SD IDYES/.test(k)), 'sessizde evet');
  assert.match(nsh, /\$\{GetOptions\}\s+\$\w+\s+"--verileri-sil"/);
  // NSIS dosyası UTF-8 okunur (electron-builder -INPUTCHARSET UTF8; unicode varsayılan açık ve kapatılmamış).
  assert.ok(!/^\s*unicode:\s*false/m.test(yml), 'unicode kapatılmış');
});

test('electron-builder.yml: nsis.include build/kurulum.nsh; deleteAppDataOnUninstall: false kalır', () => {
  const nsis = yml.slice(yml.indexOf('\nnsis:'));
  assert.match(nsis, /\n\s+include:\s*build\/kurulum\.nsh\s*\n/);
  assert.match(nsis, /\n\s+deleteAppDataOnUninstall:\s*false\s*\n/);
  assert.match(nsis, /\n\s+oneClick:\s*true/);
});
