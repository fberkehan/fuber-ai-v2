// G2 (denetleyici eki, G1 incelemesi K3): 0.10.0'dan kalan proaktif yankı balonları açılışta BİR KEZ (meta bayrağıyla) süpürülür. Yankı
// balonu: kaynağı 'proaktif' olan Fuber mesajı, hemen önceki kayıt iç talimat (gizliTetikMi: rol 'not', kaynak 'proaktif') ve yanıt o
// talimatı tekrar ediyor (icTalimatYankisiMi). G1'in yankı için seçtiği yolun aynısı (main/sohbet.ts mesajlariSil): mesaj kayıttan ve
// arama dizininden SİLİNİR, okunmamış sayısı düşer; tetiğin kendisi modelin bağlamı için kalır. Meşru proaktif yanıt, kullanıcının
// mesajından sonraki Fuber yanıtı ve araya kayıt girmiş yanıt dokunulmaz. İkinci açılışta hiçbir şey yapılmaz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { proaktifYankilariSupur, YANKI_SUPURME_ISARETI } from '../src/main/sohbet-temizlik.ts';

const MERAK = 'MERAK SORUSU: Kullanıcıyı daha iyi tanımak için hafızadaki boşluklara bak ve TEK bir merak sorusu sor. Hafızada zaten olan bir şeyi sorma; kısa ve doğal ol.';
const SABAH = 'SABAH ÖZETİ: Bugünün takvimini, hatırlatıcılarını ve bekleyen işleri kısaca özetle; en önemli üç işi sırala.';

function vtKur(): DatabaseSync {
  const vt = new DatabaseSync(':memory:');
  vt.exec(`CREATE TABLE meta(k TEXT PRIMARY KEY, v TEXT);
    CREATE TABLE sohbetler(id INTEGER PRIMARY KEY, baslik TEXT NOT NULL DEFAULT 'Yeni sohbet', tur TEXT NOT NULL DEFAULT 'normal',
      olusturma TEXT NOT NULL, guncelleme TEXT NOT NULL, arsiv INTEGER NOT NULL DEFAULT 0, okunmamis INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE mesajlar(id INTEGER PRIMARY KEY, sohbet_id INTEGER NOT NULL, rol TEXT NOT NULL, metin TEXT NOT NULL DEFAULT '',
      bloklar TEXT NOT NULL DEFAULT '[]', kaynak TEXT, olusturma TEXT NOT NULL, gizli INTEGER NOT NULL DEFAULT 0);
    CREATE VIRTUAL TABLE mesaj_ara USING fts5(metin, content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2');`);
  const z = '2026-10-26T09:00:00.000Z';
  vt.prepare("INSERT INTO sohbetler(id, baslik, tur, olusturma, guncelleme, okunmamis) VALUES(1, 'Fuber', 'ana', ?, ?, 3), (2, 'Plan', 'normal', ?, ?, 0)").run(z, z, z, z);
  return vt;
}
let sira = 0;
function ekle(vt: DatabaseSync, sohbet: number, rol: string, kaynak: string | null, metin: string): number {
  const id = Number(vt.prepare('INSERT INTO mesajlar(sohbet_id, rol, metin, kaynak, olusturma) VALUES(?,?,?,?,?)')
    .run(sohbet, rol, metin, kaynak, new Date(Date.UTC(2026, 9, 26, 9, sira++)).toISOString()).lastInsertRowid);
  if (rol !== 'not') vt.prepare('INSERT INTO mesaj_ara(rowid, metin) VALUES(?, ?)').run(id, metin);
  return id;
}
const kalanlar = (vt: DatabaseSync) => (vt.prepare('SELECT id FROM mesajlar ORDER BY id').all() as { id: number }[]).map((x) => Number(x.id));
const dizinde = (vt: DatabaseSync, s: string) => (vt.prepare('SELECT rowid FROM mesaj_ara WHERE mesaj_ara MATCH ?').all(s) as unknown[]).length;

test('yankı balonu süpürülür (kayıt + arama dizini + okunmamış); tetik, meşru proaktif yanıt ve kullanıcı turu kalır; ikinci açılış hiçbir şey yapmaz', () => {
  const vt = vtKur();
  // 1) Yankı: MERAK tetiği → Fuber talimatı aynen geri yazmış (başlık önekiyle).
  const t1 = ekle(vt, 1, 'not', 'proaktif', MERAK);
  const y1 = ekle(vt, 1, 'assistant', 'proaktif', `**${MERAK}**`);
  // 2) Meşru proaktif yanıt: SABAH tetiği → gerçek özet.
  const t2 = ekle(vt, 1, 'not', 'proaktif', SABAH);
  const m2 = ekle(vt, 1, 'assistant', 'proaktif', 'Günaydın Deniz! Bugün üç işin var; ilki 10:00’daki ekip toplantısı.');
  // 3) Yankı (≥ 40 karakter ortak parça, başlıksız): başka sohbette.
  const t3 = ekle(vt, 2, 'not', 'proaktif', MERAK);
  const y3 = ekle(vt, 2, 'assistant', 'proaktif', 'Peki: hafızadaki boşluklara bak ve TEK bir merak sorusu sor. Hafızada zaten olan bir şeyi sorma');
  // 4) Kullanıcının sorusuna yanıt (talimatı içerse bile kaynak proaktif değil): kalır.
  const k4 = ekle(vt, 1, 'user', 'kullanici', 'Merak sorusu nedir?');
  const m4 = ekle(vt, 1, 'assistant', null, MERAK);
  // 5) Araya kayıt girmiş (araç sonucu) proaktif yanıt: hemen önceki kayıt tetik değil → dokunulmaz.
  const t5 = ekle(vt, 1, 'not', 'proaktif', SABAH);
  const a5 = ekle(vt, 1, 'user', 'arac', '{"sonuc":"takvim boş"}');
  const m5 = ekle(vt, 1, 'assistant', 'proaktif', SABAH);
  const once = kalanlar(vt);

  assert.equal(proaktifYankilariSupur(vt), 2);
  assert.deepEqual(kalanlar(vt), once.filter((id) => id !== y1 && id !== y3));
  for (const id of [t1, t2, m2, t3, k4, m4, t5, a5, m5]) assert.ok(kalanlar(vt).includes(id), `${id} silindi`);
  assert.equal(dizinde(vt, '"Peki"'), 0, 'yankı arama dizininde kaldı');
  assert.equal(dizinde(vt, 'Günaydın'), 1, 'meşru yanıt dizinden düştü');
  // Okunmamış: ana sohbetten bir yankı düştü (3 → 2), öteki sohbet 0'ın altına inmez.
  const okunmamis = (id: number) => Number((vt.prepare('SELECT okunmamis FROM sohbetler WHERE id = ?').get(id) as { okunmamis: number }).okunmamis);
  assert.equal(okunmamis(1), 2);
  assert.equal(okunmamis(2), 0);
  assert.ok(vt.prepare('SELECT v FROM meta WHERE k = ?').get(YANKI_SUPURME_ISARETI), 'bayrak yazılmadı');

  // İkinci açılış: yeni bir yankı olsa da süpürme bir daha çalışmaz (bugünkü yankıyı G1'in bekçisi zaten kayda hiç yazmaz).
  ekle(vt, 1, 'not', 'proaktif', MERAK);
  const y6 = ekle(vt, 1, 'assistant', 'proaktif', MERAK);
  assert.equal(proaktifYankilariSupur(vt), 0);
  assert.ok(kalanlar(vt).includes(y6));
});

test('yankı yokken de bayrak yazılır (her açılışta tablo taranmaz); meta tablosu yoksa kurulur', () => {
  const vt = vtKur();
  vt.exec('DROP TABLE meta');
  ekle(vt, 1, 'not', 'proaktif', SABAH);
  ekle(vt, 1, 'assistant', 'proaktif', 'Günaydın!');
  assert.equal(proaktifYankilariSupur(vt), 0);
  assert.ok(vt.prepare('SELECT v FROM meta WHERE k = ?').get(YANKI_SUPURME_ISARETI));
  assert.equal(kalanlar(vt).length, 2);
});

test('main.ts süpürmeyi açılışta veritabanı açıldıktan sonra bir kez çağırır', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const kaynak = fs.readFileSync(path.resolve(import.meta.dirname, '../src/main/main.ts'), 'utf8');
  const i = kaynak.indexOf('proaktifYankilariSupur(veritabani())');
  assert.ok(i > kaynak.indexOf('app.whenReady('), 'whenReady içinde değil');
});
