// İş izi: Claude Code olay akışının oturum başına iş durumuna indirgenmesi (üç paralel alt ajan, izin, arka plan işi).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ccIzAdimi, ccIzIsleri, type CcIzDurumu } from '../src/shared/is-izi-cc.ts';
import type { CcOlay, CcOturumOzeti } from '../src/shared/cc-olay.ts';

const T0 = 1_000_000;
const ozet = (o: Partial<CcOturumOzeti> = {}): CcOturumOzeti => ({
  id: 'o1', cwd: 'C:/k/mavi-kus', proje: 'mavi-kus', baslik: 'Eski ekranları düzelt', durum: 'calisiyor', mod: 'acceptEdits', kaynak: 'sohbet', sohbetId: 4,
  bekleyenIzin: 0, kuyruk: 0, arkaPlan: 0, degisenDosyaSayisi: 0, yetenekler: [], olusturma: T0, sonEtkinlik: T0, ...o,
});
let sira = 0;
const uygula = (d: CcIzDurumu, olay: CcOlay, t = T0) => ccIzAdimi(d, { oturum: 'o1', sira: ++sira, zaman: t, olay }, t);

test('üç paralel alt ajan: her biri ayrı yardımcı, sırası ve canlı fiili; oturum üst iş ve sohbetine bağlı', () => {
  const d: CcIzDurumu = new Map();
  assert.equal(uygula(d, { tur: 'durum', ozet: ozet() }), true);
  for (const [i, a] of ['Kayıt ekranını tara', 'Şifre ekranını tara', 'Testleri çalıştır'].entries()) {
    uygula(d, { tur: 'alt-ajan', id: `t${i}`, aciklama: a, ajanTipi: 'general-purpose', istem: 'gizli istem', ust: null }, T0 + i);
  }
  uygula(d, { tur: 'arac-basladi', id: 'r1', ad: 'Read', tip: 'okuma', girdi: {}, ozet: 'src/kayit.css', ust: 't0' });
  uygula(d, { tur: 'arac-basladi', id: 'g1', ad: 'Grep', tip: 'arama', girdi: {}, ozet: 'width', ust: 't1' });
  uygula(d, { tur: 'arac-basladi', id: 'b1', ad: 'Bash', tip: 'kabuk', girdi: {}, ozet: 'npm test', ust: 't2' });
  // Metin akışı iş görünümünü değiştirmez.
  assert.equal(uygula(d, { tur: 'metin-parca', blok: 'x', metin: 'merhaba', ust: 't0' }), false);
  const l = ccIzIsleri(d);
  assert.deepEqual(l.map((x) => x.id), ['cc:o1', 'cc:o1:t0', 'cc:o1:t1', 'cc:o1:t2']);
  assert.equal(l[0].sohbetId, 4);
  assert.equal(l[0].ne, '3 yardımcı çalışıyor', 'oturumun kendi süren aracı yokken fiil yardımcıları söyler');
  assert.deepEqual(l.slice(1).map((x) => [x.sira, x.ust, x.hal, x.ne]), [
    [0, 'cc:o1', 'calisiyor', 'Okuyor · kayit.css'],
    [1, 'cc:o1', 'calisiyor', 'Arıyor · width'],
    [2, 'cc:o1', 'calisiyor', 'Komut çalıştırıyor · npm test'],
  ]);
  assert.doesNotMatch(JSON.stringify(l), /gizli istem|general-purpose/);
  // Adım biter, alt ajan biter.
  uygula(d, { tur: 'arac-bitti', id: 'r1', hata: false, cikti: '', kisaltildi: false, ust: 't0' });
  uygula(d, { tur: 'arac-bitti', id: 't0', hata: false, cikti: 'rapor', kisaltildi: false, ust: null }, T0 + 9000);
  const a0 = ccIzIsleri(d).find((x) => x.id === 'cc:o1:t0')!;
  assert.equal(a0.hal, 'bitti');
  assert.equal(a0.bitis, T0 + 9000);
  uygula(d, { tur: 'arac-bitti', id: 't1', hata: true, cikti: '', kisaltildi: false, ust: null });
  assert.equal(ccIzIsleri(d).find((x) => x.id === 'cc:o1:t1')!.hal, 'olmadi');
});

test('alt ajanın içindeki izin isteği o yardımcıyı "Onay bekliyor" yapar; yanıtlanınca döner', () => {
  const d: CcIzDurumu = new Map();
  uygula(d, { tur: 'durum', ozet: ozet() });
  uygula(d, { tur: 'alt-ajan', id: 't0', aciklama: 'Sunucuyu dene', istem: '', ust: null });
  uygula(d, { tur: 'arac-basladi', id: 'b1', ad: 'Bash', tip: 'kabuk', girdi: {}, ozet: 'npm run dev', ust: 't0' });
  uygula(d, { tur: 'izin-istegi', istekId: 'i1', arac: 'Bash', tip: 'kabuk', girdi: {}, ozet: 'npm run dev', herZamanSunulur: false, aracKimligi: 'b1' });
  assert.equal(ccIzIsleri(d).find((x) => x.id === 'cc:o1:t0')!.hal, 'onay');
  uygula(d, { tur: 'izin-yanitlandi', istekId: 'i1', karar: 'izin' });
  assert.equal(ccIzIsleri(d).find((x) => x.id === 'cc:o1:t0')!.hal, 'calisiyor');
});

test('yeni tur biten yardımcıları temizler, sıra baştan başlar; "unutuldu" oturumu siler', () => {
  const d: CcIzDurumu = new Map();
  uygula(d, { tur: 'durum', ozet: ozet() });
  uygula(d, { tur: 'alt-ajan', id: 't0', aciklama: 'a', istem: '', ust: null });
  uygula(d, { tur: 'arac-bitti', id: 't0', hata: false, cikti: '', kisaltildi: false, ust: null });
  uygula(d, { tur: 'kullanici', id: 'u2', metin: 'devam', gorselSayisi: 0 });
  uygula(d, { tur: 'alt-ajan', id: 't9', aciklama: 'b', istem: '', ust: null });
  assert.deepEqual(ccIzIsleri(d).filter((x) => x.kaynak === 'cc-ajan').map((x) => [x.id, x.sira]), [['cc:o1:t9', 0]]);
  uygula(d, { tur: 'unutuldu' });
  assert.deepEqual(ccIzIsleri(d), []);
});

test('üst düzey araç oturumun fiilidir; arka plan işi ayrı satır, alt ajanı yinelemez; tur sonu süren yardımcıyı kapatır', () => {
  const d: CcIzDurumu = new Map();
  uygula(d, { tur: 'durum', ozet: ozet() });
  uygula(d, { tur: 'arac-basladi', id: 'r1', ad: 'Read', tip: 'okuma', girdi: {}, ozet: 'a/b/giris.css', ust: null });
  assert.equal(ccIzIsleri(d)[0].ne, 'Okuyor · giris.css');
  uygula(d, { tur: 'alt-ajan', id: 't0', aciklama: 'a', istem: '', ust: null });
  uygula(d, { tur: 'arka-isler', isler: [
    { id: 'k1', aciklama: 'npm run dev', tip: 'kabuk', durum: 'suruyor', arkaPlanda: true, baslangic: T0 },
    { id: 'k2', aciklama: 'a', tip: 'ajan', durum: 'suruyor', arkaPlanda: false, baslangic: T0, aracId: 't0' },
  ] });
  assert.deepEqual(ccIzIsleri(d).map((x) => x.id), ['cc:o1', 'cc:o1:t0', 'cc:o1:is:k1']);
  uygula(d, { tur: 'sonuc', basarili: true, kesildi: true, sureMs: 1, turSayisi: 1, maliyetUsd: 0, belirtec: { girdi: 0, cikti: 0, onbellekOkuma: 0, onbellekYazma: 0 } });
  // t0 arka-isler'de süren ajan işi (aracId'li) — arkada sayılır, kesilmez (adımı yok: Başlıyor).
  assert.equal(ccIzIsleri(d).find((x) => x.id === 'cc:o1:t0')!.hal, 'basliyor');
});
