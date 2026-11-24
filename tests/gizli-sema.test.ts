// Göç 5 (Görev 21 düzeltme turu 2): `gizli` sütunları PRAGMA table_info denetimiyle eklenir — tekrar çalışması zararsız, başka bir dalın
// aynı sütunu (ya da aynı numaralı başka göçü) eklemiş olması bozmaz; eski satırlar 0 (gizli değil) olur, veri kaybolmaz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { gizliSutunlari, GIZLI_TABLOLAR } from '../src/main/gizli-sema.ts';

function eskiSema(): DatabaseSync {
  const v = new DatabaseSync(':memory:');
  v.exec(`CREATE TABLE mesajlar(id INTEGER PRIMARY KEY, sohbet_id INTEGER, rol TEXT, metin TEXT);
    CREATE TABLE dokum(id INTEGER PRIMARY KEY, zaman TEXT, gun TEXT, metin TEXT);
    CREATE TABLE not_maddeleri(id INTEGER PRIMARY KEY, metin TEXT);
    CREATE TABLE meseleler(id INTEGER PRIMARY KEY, baslik TEXT);
    CREATE TABLE raporlar(id INTEGER PRIMARY KEY, baslik TEXT);
    CREATE TABLE eslikler(id INTEGER PRIMARY KEY, metin TEXT);
    CREATE TABLE gorevler(id INTEGER PRIMARY KEY, baslik TEXT);
    INSERT INTO mesajlar(sohbet_id, rol, metin) VALUES(1, 'user', 'eski mesaj');
    INSERT INTO dokum(zaman, gun, metin) VALUES('2026-10-24T10:00:00Z', '2026-10-24', 'eski satır');`);
  return v;
}

test('eksik sütunlar eklenir; eski satırlar korunur ve gizli=0; ikinci çalıştırma hiçbir şey yapmaz', () => {
  const v = eskiSema();
  assert.deepEqual(gizliSutunlari(v), [...GIZLI_TABLOLAR]);
  assert.deepEqual(v.prepare('SELECT metin, gizli FROM mesajlar').all().map((r) => ({ ...r })), [{ metin: 'eski mesaj', gizli: 0 }]);
  assert.deepEqual(v.prepare('SELECT metin, gizli FROM dokum').all().map((r) => ({ ...r })), [{ metin: 'eski satır', gizli: 0 }]);
  assert.deepEqual(gizliSutunlari(v), [], 'idempotent');
});

test('başka bir dal sütunu zaten eklemişse ya da tablo yoksa hata vermez', () => {
  const v = eskiSema();
  v.exec('ALTER TABLE mesajlar ADD COLUMN gizli INTEGER NOT NULL DEFAULT 0; DROP TABLE eslikler;');
  assert.deepEqual(gizliSutunlari(v), ['dokum', 'not_maddeleri', 'meseleler', 'raporlar', 'gorevler']);
});

test('0.11 G4: yapılacaklar (gorevler) tablosu da gizli sütunu alır — tamamlanma anında Gizli açıktı demek; eski satırlar 0', () => {
  const v = eskiSema();
  v.exec("INSERT INTO gorevler(baslik) VALUES('eski görev')");
  gizliSutunlari(v);
  assert.deepEqual(v.prepare('SELECT baslik, gizli FROM gorevler').all().map((r) => ({ ...r })), [{ baslik: 'eski görev', gizli: 0 }]);
});
