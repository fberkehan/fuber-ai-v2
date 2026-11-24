// İçe aktarılmış belgeler (src/main/belge-depo.ts; Görev 20b, K3): Hafıza → Belgeler listesi, arama, silme. Silme belgeyi ve
// parçalarını kaldırır, YALNIZ bu belgeden öğrenilen hafıza kayıtlarını unutur (başka kaynağı da olanlar kalır, kaynaktan bu
// belge düşer); dosya klasörde kaldığı için içerik özeti "silindi" izi olarak kalır (açılışta yeniden öğrenilmesin).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { belgeListesi, belgeSil, belgeIslendiYaz, belgeSilindiMi, kaynakBelgesiSilindiMi, silinmisIzleriKaldir, parcaVarMi } from '../src/main/belge-depo.ts';
import { sadelestir } from '../src/main/hafiza/normal.ts';
import { belgeTurAdi } from '../src/shared/belge.ts';
import { isDiliIhlali } from '../src/shared/is-dili.ts';

// vt.ts GOCLER[0] ile aynı tablolar (yalnız bu testin kullandıkları).
function vtKur(): DatabaseSync {
  const vt = new DatabaseSync(':memory:');
  vt.exec(`
    CREATE TABLE hafizalar(
      id INTEGER PRIMARY KEY, tur TEXT NOT NULL, baslik TEXT NOT NULL, icerik TEXT NOT NULL,
      etiketler TEXT NOT NULL DEFAULT '[]', onem INTEGER NOT NULL DEFAULT 3, sabit INTEGER NOT NULL DEFAULT 0,
      kaynak TEXT NOT NULL DEFAULT '', olay_tarihi TEXT, olusturma TEXT NOT NULL, guncelleme TEXT NOT NULL,
      son_erisim TEXT, erisim_sayisi INTEGER NOT NULL DEFAULT 0, silindi INTEGER NOT NULL DEFAULT 0);
    CREATE VIRTUAL TABLE hafiza_ara USING fts5(baslik, icerik, etiketler, content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2');
    CREATE TABLE belgeler(
      id INTEGER PRIMARY KEY, yol TEXT NOT NULL, ad TEXT NOT NULL, tur TEXT, boyut INTEGER, ozet_hash TEXT UNIQUE,
      ozet TEXT, durum TEXT NOT NULL DEFAULT 'bekliyor', hata TEXT, parca_sayisi INTEGER DEFAULT 0,
      olusturma TEXT NOT NULL, islenme TEXT);
    CREATE TABLE parcalar(id INTEGER PRIMARY KEY, belge_id INTEGER NOT NULL REFERENCES belgeler(id), sira INTEGER NOT NULL, metin TEXT NOT NULL);
    CREATE VIRTUAL TABLE parca_ara USING fts5(metin, content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2');
  `);
  const belge = (id: number, ad: string, tur: string, metin: string, tarih: string, durum = 'islendi', ozet: string | null = null) => {
    vt.prepare('INSERT INTO belgeler(id, yol, ad, tur, boyut, ozet_hash, ozet, durum, parca_sayisi, olusturma) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(id, `C:/İçe Aktar/${ad}`, ad, tur, metin.length, `h${id}:0`, ozet, durum, 1, tarih);
    const p = vt.prepare('INSERT INTO parcalar(belge_id, sira, metin) VALUES(?,?,?)').run(id, 0, metin);
    vt.prepare('INSERT INTO parca_ara(rowid, metin) VALUES(?, ?)').run(Number(p.lastInsertRowid), sadelestir(metin));
  };
  belge(1, 'Mavi Kuş toplantı notu.md', 'md', 'Lansman tarihi 3 Kasım. Basın bülteni Mert’te.', '2026-10-20T09:00:00.000Z', 'islendi', 'Mavi Kuş lansman toplantısı.');
  belge(12, 'Kuzey sözleşmesi.pdf', 'pdf', 'Kuzey Rüzgârı ödeme ekranı teslimi 14 Kasım; sorumlu Ece.', '2026-10-22T09:00:00.000Z');
  belge(13, 'bozuk.docx', 'docx', 'yarım metin', '2026-10-23T09:00:00.000Z', 'hata');
  const hafiza = (id: number, baslik: string, kaynak: string) => {
    vt.prepare("INSERT INTO hafizalar(id, tur, baslik, icerik, kaynak, olusturma, guncelleme) VALUES(?, 'bilgi', ?, ?, ?, 'z', 'z')").run(id, baslik, `${baslik} içerik`, kaynak);
    vt.prepare('INSERT INTO hafiza_ara(rowid, baslik, icerik, etiketler) VALUES(?,?,?,?)').run(id, sadelestir(baslik), sadelestir(baslik), '');
  };
  hafiza(100, 'Kuzey teslimi', 'dosya:D-12');                       // yalnız bu belgeden → unutulur
  hafiza(101, 'Ece sorumlu', 'sohbet:3/mesaj:9, dosya:D-12');       // başka kaynağı da var → kalır, kaynaktan D-12 düşer
  hafiza(102, 'Mavi Kuş lansmanı', 'dosya:D-1');                    // başka belge → dokunulmaz
  hafiza(103, 'D-120 değil', 'dosya:D-120');                        // önek benzerliği: D-12 sayılmaz
  return vt;
}

test('liste: en yeni önce; ad, tür, tarih, metin boyu, durum, özet ve bu belgeden gelen hafıza sayısı', () => {
  const vt = vtKur();
  const l = belgeListesi(vt);
  assert.deepEqual(l.map((b) => b.id), [13, 12, 1]);
  const k = l.find((b) => b.id === 12)!;
  assert.equal(k.ad, 'Kuzey sözleşmesi.pdf');
  assert.equal(k.tur, 'pdf');
  assert.equal(k.durum, 'islendi');
  assert.equal(k.tarih, '2026-10-22T09:00:00.000Z');
  assert.ok(k.boyut > 20);
  assert.equal(k.hafiza, 2, 'D-12 kaynaklı iki kayıt (D-120 sayılmaz)');
  assert.equal(k.yalnizBundan, 1, 'yalnız bu belgeden öğrenilen (silinince unutulacak) kayıt sayısı');
  assert.equal(l.find((b) => b.id === 1)!.ozet, 'Mavi Kuş lansman toplantısı.');
});

test('arama: adda harf katlamalı ("mavi kus"), içerikte ("teslimi"), kimlikle ("D-12"); sonuçsuz boş', () => {
  const vt = vtKur();
  assert.deepEqual(belgeListesi(vt, { sorgu: 'mavi kus' }).map((b) => b.id), [1]);
  assert.deepEqual(belgeListesi(vt, { sorgu: 'teslimi' }).map((b) => b.id), [12]);
  assert.deepEqual(belgeListesi(vt, { sorgu: 'D-12' }).map((b) => b.id), [12]);
  assert.deepEqual(belgeListesi(vt, { sorgu: 'SÖZLEŞME' }).map((b) => b.id), [12]);
  assert.deepEqual(belgeListesi(vt, { sorgu: 'zzqx' }), []);
});

test('silme: belge listeden ve aramadan düşer, yalnız bu belgeden öğrenilen kayıt unutulur, ortak kayıt kalır', () => {
  const vt = vtKur();
  const r = belgeSil(vt, 12);
  assert.deepEqual(r, { silindi: true, unutulan: 1, guncellenen: 1 });
  assert.deepEqual(belgeListesi(vt).map((b) => b.id), [13, 1]);
  assert.deepEqual(belgeListesi(vt, { sorgu: 'teslimi' }), []);
  assert.equal(Number((vt.prepare('SELECT COUNT(*) n FROM parcalar WHERE belge_id = 12').get() as { n: number }).n), 0);
  const h = (id: number) => ({ ...(vt.prepare('SELECT silindi, kaynak FROM hafizalar WHERE id = ?').get(id) as { silindi: number; kaynak: string }) });
  assert.equal(h(100).silindi, 1);
  assert.deepEqual(h(101), { silindi: 0, kaynak: 'sohbet:3/mesaj:9' });
  assert.deepEqual(h(102), { silindi: 0, kaynak: 'dosya:D-1' });
  assert.deepEqual(h(103), { silindi: 0, kaynak: 'dosya:D-120' });
  // Unutulan kayıt hafıza aramasından da düşer; kalan kayıt aranabilir.
  const ara = (s: string) => (vt.prepare('SELECT rowid FROM hafiza_ara WHERE hafiza_ara MATCH ?').all(`"${s}"*`) as { rowid: number }[]).map((x) => Number(x.rowid));
  assert.deepEqual(ara('kuzey'), []);
  assert.deepEqual(ara('ece'), [101]);
});

// Düzeltme turu 1: işlenirken (özet modeli beklenirken) silinen belge, özet dönünce "işlendi" olup geri gelmesin; hafıza yazıcısı
// bu belgeden gelen işi bıraksın (dosya:D-n kaynaklı kayıt kalmasın).
test('işlenirken silinen belge: özet yazımı dokunmaz (silindi kalır), kaynağı silinen belgeden gelen hafıza yazımı bırakılır', () => {
  const vt = vtKur();
  vt.prepare("INSERT INTO belgeler(id, yol, ad, tur, boyut, ozet_hash, durum, olusturma) VALUES(20, 'x', 'yavas.txt', 'txt', 40, 'h20:0', 'bekliyor', '2026-10-25T09:00:00.000Z')").run();
  assert.equal(belgeSilindiMi(vt, 20), false);
  assert.equal(kaynakBelgesiSilindiMi(vt, 'dosya:D-20'), false);
  belgeSil(vt, 20); // kullanıcı "inceleniyor" iken sildi
  assert.equal(belgeIslendiYaz(vt, 20, 'Geç gelen özet', '2026-10-25T09:01:00.000Z'), false, 'özet dönünce yazılmaz');
  const iz = { ...(vt.prepare('SELECT durum, ozet FROM belgeler WHERE id = 20').get() as Record<string, unknown>) };
  assert.deepEqual(iz, { durum: 'silindi', ozet: null });
  assert.equal(belgeSilindiMi(vt, 20), true);
  assert.equal(kaynakBelgesiSilindiMi(vt, 'dosya:D-20'), true, 'yazıcı bu işi bırakır');
  assert.equal(kaynakBelgesiSilindiMi(vt, 'sohbet:3/mesaj:9'), false, 'belge kaynağı olmayan yazımlara dokunulmaz');
  assert.equal(kaynakBelgesiSilindiMi(vt, 'dosya:D-1'), false);
  assert.equal(Number((vt.prepare("SELECT COUNT(*) n FROM hafizalar WHERE kaynak LIKE '%dosya:D-20%'").get() as { n: number }).n), 0);
  // Silinmemiş belgede özet yazılır.
  assert.equal(belgeIslendiYaz(vt, 12, 'Özet', '2026-10-25T09:02:00.000Z'), true);
});

// A4 (son düzeltme): silinen belge "Dosya öğret"le (açık öğretme) yeniden öğretilebilir: yalnız "silindi" izleri kalkar (aynı içerik
// özeti yeniden eklenebilir); silinmemiş parçalar ve başka içerikler dokunulmaz. Klasör izleyicisi açık değildir: iz durur, geçer.
test('A4: açık öğretmede silinmiş izler kalkar (yeniden eklenebilir), duran parça ve başka belge kalır', () => {
  const vt = vtKur();
  // Çok parçalı dışa aktarım: h50:0 duruyor, h50:1 silindi.
  vt.prepare("INSERT INTO belgeler(id, yol, ad, tur, boyut, ozet_hash, durum, olusturma) VALUES(50, 'x', 'ChatGPT: A', 'json', 40, 'h50:0', 'islendi', 'z')").run();
  vt.prepare("INSERT INTO belgeler(id, yol, ad, tur, boyut, ozet_hash, durum, olusturma) VALUES(51, 'x', 'ChatGPT: B', 'json', 40, 'h50:1', 'islendi', 'z')").run();
  belgeSil(vt, 51);
  belgeSil(vt, 12); // başka içerik (h12) silindi: dokunulmamalı
  assert.equal(parcaVarMi(vt, 'h50:1'), true, 'silinmiş iz yeniden öğrenmeyi engelliyordu');
  assert.equal(silinmisIzleriKaldir(vt, 'h50'), 1);
  assert.equal(parcaVarMi(vt, 'h50:1'), false, 'iz kalktı: parça yeniden eklenebilir');
  assert.equal(parcaVarMi(vt, 'h50:0'), true, 'silinmemiş parça kalır (yeniden işlenmez)');
  assert.equal(parcaVarMi(vt, 'h12:0'), true, 'başka belgenin izi kalır');
  // Aynı içerik özetiyle yeniden eklenebilir (UNIQUE engellemez).
  vt.prepare("INSERT INTO belgeler(yol, ad, tur, boyut, ozet_hash, durum, olusturma) VALUES('x', 'ChatGPT: B', 'json', 40, 'h50:1', 'bekliyor', 'z')").run();
  assert.equal(silinmisIzleriKaldir(vt, 'h50'), 0, 'yeni eklenen silinmiş değil');
  // LIKE jokerleri özetin içinde sayılmaz.
  assert.equal(silinmisIzleriKaldir(vt, '%'), 0);
});

test('A5: .jsonl türü İş\'te "Sohbet kaydı" (araç adı yok), Geliştirici\'de "Claude Code sohbeti"; diğer türler değişmez', () => {
  assert.equal(belgeTurAdi('jsonl', 'is'), 'Sohbet kaydı');
  assert.equal(belgeTurAdi('jsonl', null), 'Sohbet kaydı');
  assert.equal(belgeTurAdi('jsonl', 'gelistirici'), 'Claude Code sohbeti');
  assert.equal(isDiliIhlali(belgeTurAdi('jsonl', 'is')), null);
  assert.equal(belgeTurAdi('pdf', 'is'), 'PDF');
  assert.equal(belgeTurAdi('', 'is'), 'Belge');
  assert.equal(belgeTurAdi('rtf', 'gelistirici'), 'RTF');
});

test('silinen belgenin izi kalır (aynı dosya açılışta yeniden öğrenilmez), içeriği ve özeti kalmaz; ikinci silme etkisiz', () => {
  const vt = vtKur();
  belgeSil(vt, 1);
  const iz = vt.prepare('SELECT durum, ozet, ozet_hash, parca_sayisi FROM belgeler WHERE id = 1').get() as Record<string, unknown>;
  assert.deepEqual({ ...iz }, { durum: 'silindi', ozet: null, ozet_hash: 'h1:0', parca_sayisi: 0 });
  assert.deepEqual(belgeSil(vt, 1), { silindi: false, unutulan: 0, guncellenen: 0 });
  assert.deepEqual(belgeSil(vt, 999), { silindi: false, unutulan: 0, guncellenen: 0 });
});
