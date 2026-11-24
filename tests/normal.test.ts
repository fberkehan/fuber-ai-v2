// Türkçe normalizasyon, FTS sorgusu ve tarih ifadeleri (hafıza aramasının temeli).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sadelestir, ftsSorgusu, tarihAraligi, anahtarKelimeler } from '../src/main/hafiza/normal.ts';

test('sadelestir: Türkçe harfler ve büyük İ/I', () => {
  assert.equal(sadelestir('Toplantısı İŞ Çağrı Görüşme'), 'toplantisi is cagri gorusme');
  assert.equal(sadelestir('IŞIK'), 'isik');
});

test('ftsSorgusu: Türkçe ekleri yakalayan önek araması', () => {
  const q = ftsSorgusu('yatırımcı toplantısı');
  assert.ok(q);
  // Son iki harf atılır: "yatırımcı" → "yatirim"* ("yatırım", "yatırımcılar"ı da bulur)
  assert.match(q!, /"yatirim"\*/);
  assert.match(q!, /"toplant"\*/); // 11 Kas: hafif kökleyici ("toplantısı" → "toplant"; shared/tr-kok.ts)
  assert.equal(ftsSorgusu('ve bir'), null);
});

test('anahtarKelimeler: sık kelimeler atılır', () => {
  const k = anahtarKelimeler('hey fuber bu bir deneme ve proje');
  assert.ok(!k.includes('fuber') && !k.includes('ve'));
  assert.ok(k.includes('deneme') && k.includes('proje'));
});

test('tarihAraligi: dün / geçen hafta / "18 ekim"', () => {
  const simdi = new Date(2026, 9, 19, 9, 30); // 19 Eki 2026 Pazartesi
  const dun = tarihAraligi('dün ne konuştuk', simdi)!;
  assert.equal(new Date(dun.baslangic).getDate(), 18);
  assert.equal(new Date(dun.bitis).getDate(), 19);
  const gh = tarihAraligi('geçen hafta neler oldu', simdi)!;
  assert.equal(new Date(gh.baslangic).getDate(), 12);
  assert.equal(new Date(gh.bitis).getDate(), 19);
  const ekim = tarihAraligi('18 ekim toplantısı', simdi)!;
  assert.equal(new Date(ekim.baslangic).getMonth(), 9);
  assert.equal(new Date(ekim.baslangic).getDate(), 18);
  assert.equal(tarihAraligi('Mavi Kuş projesi', simdi), null);
});
