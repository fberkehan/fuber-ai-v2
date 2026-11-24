// Kullanım biçimi (mod, K2) başlangıcı — denetleyici kararı G: kayıtlı `mod` yoksa (0.7.0'dan yükselen profil) bağlı bir yapay zekâ
// anahtarı ya da açık Claude Code Geliştirici demektir; yoksa İş. Kayıtlı geçerli mod korunur; bozuk değer İş; dosya yoksa (yeni
// kurulum) İş. Saf modül: src/shared/kullanim-bicimi.ts (ana süreç ayarlar.ts derin birleştirmeden ÖNCEki ham değeri verir).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baslangicModu } from '../src/shared/kullanim-bicimi.ts';

const iz = (p: Partial<{ profilVar: boolean; anahtarVar: boolean; claudeCodeEtkin: boolean }> = {}) => ({ profilVar: true, anahtarVar: false, claudeCodeEtkin: false, ...p });

test('kayıtlı geçerli mod olduğu gibi kalır (izler ne olursa olsun)', () => {
  assert.equal(baslangicModu('is', iz({ anahtarVar: true, claudeCodeEtkin: true })), 'is');
  assert.equal(baslangicModu('gelistirici', iz()), 'gelistirici');
  assert.equal(baslangicModu('gelistirici', iz({ profilVar: false })), 'gelistirici');
});

test('yükselen profil (mod yok): kayıtlı anahtar ya da açık Claude Code → Geliştirici', () => {
  assert.equal(baslangicModu(undefined, iz({ anahtarVar: true })), 'gelistirici');
  assert.equal(baslangicModu(undefined, iz({ claudeCodeEtkin: true })), 'gelistirici');
  assert.equal(baslangicModu(undefined, iz({ anahtarVar: true, claudeCodeEtkin: true })), 'gelistirici');
});

test('yükselen profil (mod yok), anahtar yok ve Claude Code kapalı → İş', () => {
  assert.equal(baslangicModu(undefined, iz()), 'is');
});

test('profil dosyası yok (yeni kurulum) → İş; ortamdan gelen anahtar bile Geliştirici yapmaz', () => {
  assert.equal(baslangicModu(undefined, iz({ profilVar: false })), 'is');
  assert.equal(baslangicModu(undefined, iz({ profilVar: false, anahtarVar: true, claudeCodeEtkin: true })), 'is');
});

test('bozuk kayıtlı değer → İş (izlere bakılmaz)', () => {
  for (const bozuk of ['developer', '', 0, null, true, {}]) assert.equal(baslangicModu(bozuk, iz({ anahtarVar: true })), 'is', JSON.stringify(bozuk));
});
