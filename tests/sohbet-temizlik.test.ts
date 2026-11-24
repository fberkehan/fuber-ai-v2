// Boş sohbet birikmez (src/main/sohbet-temizlik.ts; Görev 20b, K11): masaüstünde yeni sohbet ilk mesajda oluşur; telefondan ya da
// eski sürümden kalan mesajsız "Yeni sohbet"ler açılışta arşive kalkar (silinmez). Az önce açılmış (yazılıyor olabilir) ve ana
// sohbet dokunulmaz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { bosSohbetleriArsivle, mesajlaArsivdenCikar, kullaniciYazdiMi } from '../src/main/sohbet-temizlik.ts';

// Düzeltme turu 2: arşivden çıkaran yalnız kullanıcının GERÇEKTEN yazdığı mesaj (araç sonuçları da rol 'user' ile kaydediliyor:
// arka planda süren bir tur arşivdeki sohbeti geri getiriyordu).
test('arşivden yalnız kullanıcının yazdığı/söylediği mesaj çıkarır; araç sonucu, proaktif ve Fuber mesajı çıkarmaz', () => {
  for (const k of [undefined, 'kullanici', 'ses', 'mobil']) assert.equal(kullaniciYazdiMi('user', k), true, String(k));
  for (const k of ['arac', 'proaktif', 'eslikci']) assert.equal(kullaniciYazdiMi('user', k), false, k);
  for (const r of ['assistant', 'not'] as const) assert.equal(kullaniciYazdiMi(r, 'kullanici'), false, r);
});

function vtKur() {
  const vt = new DatabaseSync(':memory:');
  vt.exec(`CREATE TABLE sohbetler(id INTEGER PRIMARY KEY, baslik TEXT NOT NULL DEFAULT 'Yeni sohbet', tur TEXT NOT NULL DEFAULT 'normal',
      ozet TEXT, ozet_son_mesaj INTEGER DEFAULT 0, olusturma TEXT NOT NULL, guncelleme TEXT NOT NULL,
      arsiv INTEGER NOT NULL DEFAULT 0, okunmamis INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE mesajlar(id INTEGER PRIMARY KEY, sohbet_id INTEGER NOT NULL, rol TEXT NOT NULL, metin TEXT NOT NULL DEFAULT '', bloklar TEXT NOT NULL DEFAULT '[]', olusturma TEXT NOT NULL);`);
  return vt;
}

// Düzeltme turu 1: eşik 24 saat ve son dokunuşa (guncelleme) göre — telefonda son bir günde açılmış boş sohbet arşive gitmez.
test('mesajsız ve 24 saattir dokunulmamış normal sohbetler arşivlenir; mesajlı, son 24 saatte dokunulmuş, ana ve asistan kalır', () => {
  const vt = vtKur();
  const simdi = Date.parse('2026-10-25T12:00:00.000Z');
  const once = (sa: number) => new Date(simdi - sa * 3_600_000).toISOString();
  const s = vt.prepare('INSERT INTO sohbetler(id, baslik, tur, olusturma, guncelleme) VALUES(?,?,?,?,?)');
  s.run(1, 'Fuber', 'ana', once(200), once(200));
  s.run(2, 'Yeni sohbet', 'normal', once(30), once(30));     // boş, 30 saat önce → arşiv
  s.run(3, 'Yeni sohbet', 'normal', once(10), once(10));     // boş ama telefonda 10 saat önce açıldı → kalır
  s.run(4, 'Sunum', 'normal', once(70), once(70));           // mesajlı → kalır
  s.run(5, 'Ses', 'asistan', once(80), once(80));            // asistan sohbeti → kalır
  s.run(6, 'Yeni sohbet', 'normal', once(48), once(2));      // eski açılmış ama 2 saat önce dokunulmuş → kalır
  vt.prepare("INSERT INTO mesajlar(sohbet_id, rol, metin, olusturma) VALUES(4, 'user', 'merhaba', ?)").run(once(70));
  assert.equal(bosSohbetleriArsivle(vt, simdi), 1);
  const arsiv = (vt.prepare('SELECT id FROM sohbetler WHERE arsiv = 1').all() as { id: number }[]).map((x) => Number(x.id));
  assert.deepEqual(arsiv, [2]);
  assert.equal(bosSohbetleriArsivle(vt, simdi), 0, 'ikinci çalıştırma etkisiz');
});

test('arşive kalkmış sohbete (telefonda hâlâ açık) mesaj gelirse arşivden çıkar; ana sohbete dokunulmaz', () => {
  const vt = vtKur();
  const z = '2026-10-25T12:00:00.000Z';
  vt.prepare("INSERT INTO sohbetler(id, tur, olusturma, guncelleme, arsiv) VALUES(2, 'normal', ?, ?, 1), (3, 'normal', ?, ?, 0)").run(z, z, z, z);
  assert.equal(mesajlaArsivdenCikar(vt, 2), true);
  assert.equal(Number((vt.prepare('SELECT arsiv FROM sohbetler WHERE id = 2').get() as { arsiv: number }).arsiv), 0);
  assert.equal(mesajlaArsivdenCikar(vt, 3), false, 'arşivde değilse değişmez');
});
