// 13 Kas (paketli onarım): claude.exe bulma — kurulu uygulamanın PATH'i terminalinkinden farklı olabilir (Explorer oturum açılışındaki kopya).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { claudeAra, regPathCoz, ortamGenislet, type AramaOrtami } from '../src/main/claudecode/claude-ara.ts';

const P = (...a: string[]) => path.join(...a);
const ev = 'C:\\Kullanicilar\\Deniz';
function ortam(dosyalar: string[], o: Partial<AramaOrtami> = {}): AramaOrtami {
  const set = new Set(dosyalar.map((d) => d.toLowerCase()));
  return {
    platform: 'win32',
    env: { APPDATA: `${ev}\\AppData\\Roaming`, LOCALAPPDATA: `${ev}\\AppData\\Local`, USERPROFILE: ev },
    home: ev,
    var: (p) => set.has(p.toLowerCase()),
    where: () => [],
    kayitPath: () => [],
    ...o,
  };
}

test('PATH\'te claude.exe: where çıktısı doğrudan', () => {
  const e = P(ev, '.local', 'bin', 'claude.exe');
  assert.equal(claudeAra(ortam([e], { where: () => [e] })), e);
});

test('npm -g: where yalnız .cmd + uzantısız kabuk verir → paketin gerçek claude.exe\'si (eski kod "yok" derdi)', () => {
  const npm = P(ev, 'AppData', 'Roaming', 'npm');
  const gercek = P(npm, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  const r = claudeAra(ortam([P(npm, 'claude.cmd'), P(npm, 'claude'), gercek], { where: () => [P(npm, 'claude'), P(npm, 'claude.cmd')] }));
  assert.equal(r, gercek);
  assert.ok(!/\.cmd$/i.test(r ?? ''), '.cmd başlatılamaz (EINVAL)');
});

test('bayat PATH (Explorer kopyası): where boş → ~/.local/bin', () => {
  const e = P(ev, '.local', 'bin', 'claude.exe');
  assert.equal(claudeAra(ortam([e])), e);
});

test('bayat PATH + özel klasör: kayıt defterindeki GÜNCEL PATH aranır', () => {
  const e = P('D:\\Araclar', 'claude.exe');
  assert.equal(claudeAra(ortam([e], { kayitPath: () => ['C:\\Windows', 'D:\\Araclar'] })), e);
  // kayıt okunamazsa (istisna) arama çökmez
  assert.equal(claudeAra(ortam([], { kayitPath: () => { throw new Error('reg yok'); } })), null);
});

test('where çökerse / hiçbir yerde yoksa null', () => {
  assert.equal(claudeAra(ortam([], { where: () => { throw new Error('where yok'); } })), null);
});

test('.exe satırı var ama dosya yoksa (bayat kayıt) bir sonraki yola düşer', () => {
  const e = P(ev, '.local', 'bin', 'claude.exe');
  assert.equal(claudeAra(ortam([e], { where: () => ['D:\\silinmis\\claude.exe'] })), e);
});

test('regPathCoz + ortamGenislet: REG_EXPAND_SZ %USERPROFILE% genişler', () => {
  const cikti = '\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\.local\\bin;C:\\Araclar;"D:\\Bosluklu Yol"\r\n';
  assert.deepEqual(regPathCoz(cikti, { USERPROFILE: 'C:\\Kullanicilar\\Deniz' }), ['C:\\Kullanicilar\\Deniz\\.local\\bin', 'C:\\Araclar', 'D:\\Bosluklu Yol']);
  assert.deepEqual(regPathCoz('hata', {}), []);
  assert.equal(ortamGenislet('%yok%\\x', {}), '%yok%\\x');
});
