// Geri alınabilir silme (src/shared/ertelenmis.ts; Görev 20b, K2): Hafıza "Unut", e-posta "Kaldır" ve belge silme 5 sn
// beklenir, sonra uygulanır. Pencere içinde çökme/kapanış veri kaybettirmez (silme hiç uygulanmamıştır) ve yarım silme olmaz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ErtelenmisSilme, GERI_AL_MS, geriAlGruplari, type Saat } from '../src/shared/ertelenmis.ts';

/** Elle ilerletilen saat: kurulan işler `ilerle` ile sırayla çalışır. */
function sahteSaat(): Saat & { ilerle: (ms: number) => void; bekleyen: () => number } {
  let t = 0, n = 0;
  const isler = new Map<number, { an: number; f: () => void }>();
  return {
    kur: (f, ms) => { const id = ++n; isler.set(id, { an: t + ms, f }); return id; },
    iptal: (id) => { isler.delete(id as number); },
    simdi: () => t,
    ilerle: (ms) => {
      t += ms;
      for (const [id, x] of [...isler].sort((a, b) => a[1].an - b[1].an)) if (x.an <= t) { isler.delete(id); x.f(); }
    },
    bekleyen: () => isler.size,
  };
}
const bos = () => new Promise((r) => setImmediate(r));

test('süre 5 sn; silme hemen UYGULANMAZ, kayıt gizlenir ve tostu listede', () => {
  const s = sahteSaat();
  const e = new ErtelenmisSilme(s);
  let uygulandi = 0;
  e.ertele({ anahtar: 'hafiza:7', etiket: '“Kahve” unutuldu', uygula: () => { uygulandi++; } });
  assert.equal(GERI_AL_MS, 5000);
  assert.equal(uygulandi, 0);
  assert.equal(e.gizliMi('hafiza:7'), true);
  assert.deepEqual(e.bekleyenler().map((b) => [b.anahtar, b.etiket, b.bitis]), [['hafiza:7', '“Kahve” unutuldu', 5000]]);
  s.ilerle(4999);
  assert.equal(uygulandi, 0, '5 sn dolmadan silinmez');
});

test('5 sn dolunca bir kez uygulanır; kayıt gizli kalır (liste yenilenene dek geri belirmez), tost kalkar', async () => {
  const s = sahteSaat();
  const e = new ErtelenmisSilme(s);
  let uygulandi = 0, bildirim = 0;
  e.dinle(() => { bildirim++; });
  e.ertele({ anahtar: 'eposta:a1', etiket: 'x', uygula: async () => { uygulandi++; } });
  s.ilerle(5000);
  await bos();
  assert.equal(uygulandi, 1);
  assert.equal(e.gizliMi('eposta:a1'), true);
  assert.deepEqual(e.bekleyenler(), []);
  assert.ok(bildirim >= 2, 'erteleme ve uygulama dinleyiciye bildirilir');
  s.ilerle(60_000);
  await bos();
  assert.equal(uygulandi, 1, 'ikinci kez uygulanmaz');
});

test('"Geri al": silme hiç uygulanmaz, kayıt yeniden görünür; süre dolduktan sonra geri alınamaz', async () => {
  const s = sahteSaat();
  const e = new ErtelenmisSilme(s);
  let uygulandi = 0;
  e.ertele({ anahtar: 'belge:3', etiket: 'x', uygula: () => { uygulandi++; } });
  s.ilerle(2000);
  assert.equal(e.geriAl('belge:3'), true);
  assert.equal(e.gizliMi('belge:3'), false);
  assert.equal(s.bekleyen(), 0, 'zamanlayıcı iptal edildi');
  s.ilerle(10_000);
  assert.equal(uygulandi, 0);
  e.ertele({ anahtar: 'belge:4', etiket: 'y', uygula: () => { uygulandi++; } });
  s.ilerle(5000);
  await bos();
  assert.equal(e.geriAl('belge:4'), false, 'uygulanmış silme geri alınamaz');
  assert.equal(uygulandi, 1);
});

test('çökme pencere içinde olursa silme hiç uygulanmamıştır: veri yerinde (yarım silme yok)', () => {
  const s = sahteSaat();
  let e: ErtelenmisSilme | null = new ErtelenmisSilme(s);
  const veri = new Set(['hafiza:1', 'hafiza:2']);
  e.ertele({ anahtar: 'hafiza:1', etiket: 'x', uygula: () => { veri.delete('hafiza:1'); } });
  s.ilerle(3000);
  e = null; // süreç düştü: zamanlayıcı da gider
  assert.deepEqual([...veri], ['hafiza:1', 'hafiza:2']);
});

// Düzeltme turu 1: normal çıkışta (tepsi "Çık") bekleyen silme düşmesin — "Unut" deyip kapatınca kayıt gerçekten unutulur.
test('normal çıkışta bekleyenlerin hepsi şimdi ve eşzamanlı uygulanır; zamanlayıcılar iptal, geri alınamaz', () => {
  const s = sahteSaat();
  const e = new ErtelenmisSilme(s);
  const veri = new Set(['hafiza:1', 'hafiza:2', 'eposta:a']);
  e.ertele({ anahtar: 'hafiza:1', etiket: 'x', uygula: () => { veri.delete('hafiza:1'); } });
  e.ertele({ anahtar: 'eposta:a', etiket: 'y', uygula: () => { veri.delete('eposta:a'); } });
  s.ilerle(1000);
  e.hepsiniHemenUygula();
  assert.deepEqual([...veri], ['hafiza:2']);
  assert.equal(s.bekleyen(), 0);
  assert.deepEqual(e.bekleyenler(), []);
  assert.equal(e.gizliMi('hafiza:1'), true);
  assert.equal(e.geriAl('hafiza:1'), false);
  let hata = '';
  e.ertele({ anahtar: 'belge:3', etiket: 'z', uygula: () => { throw new Error('kilitli'); }, hata: (h) => { hata = (h as Error).message; } });
  e.hepsiniHemenUygula();
  assert.equal(hata, 'kilitli');
  assert.equal(e.gizliMi('belge:3'), false, 'uygulanamayan geri belirir');
});

test('duraklat: süre işlemez (tostun üstüne gelindi); sürdür kalan süreden devam eder', async () => {
  const s = sahteSaat();
  const e = new ErtelenmisSilme(s);
  let uygulandi = 0;
  e.ertele({ anahtar: 'hafiza:5', etiket: 'x', uygula: () => { uygulandi++; } });
  s.ilerle(3000);
  e.duraklat();
  assert.equal(e.durakli, true);
  assert.deepEqual(e.bekleyenler().map((b) => [b.anahtar, b.durakli, b.bitis]), [['hafiza:5', true, 3000 + 2000]], 'duraklatılmışken bitiş = şimdi + kalan');
  s.ilerle(60_000);
  assert.equal(uygulandi, 0, 'duraklatılmışken uygulanmaz');
  e.surdur();
  assert.equal(e.durakli, false);
  s.ilerle(1999);
  assert.equal(uygulandi, 0);
  s.ilerle(1);
  await bos();
  assert.equal(uygulandi, 1, 'kalan 2 sn sonra');
});

// Düzeltme turu 2: birleşik tost yanlış süre gösteriyordu — A 0. sn'de, B 4. sn'de silinince tost B'nin süresini (9. sn) gösterirken
// A 5. sn'de siliniyor, "Geri al" yalnız B'yi kurtarıyordu. Artık grup tek süre paylaşır.
test('grup tek süre paylaşır: A@0, B@4 sn → A da B ile 9. sn\'de uygulanır; tostun süresi doğru; "Geri al" ikisini de kurtarır', async () => {
  const s = sahteSaat();
  const e = new ErtelenmisSilme(s);
  const silinen: string[] = [];
  e.ertele({ anahtar: 'hafiza:1', etiket: '“A” unutuldu', grup: 'hafiza', uygula: () => { silinen.push('A'); } });
  s.ilerle(4000);
  e.ertele({ anahtar: 'hafiza:2', etiket: '“B” unutuldu', grup: 'hafiza', uygula: () => { silinen.push('B'); } });
  assert.deepEqual(e.bekleyenler().map((b) => [b.anahtar, b.bitis]), [['hafiza:1', 9000], ['hafiza:2', 9000]], 'öncekinin süresi yenisininkine uzar');
  const [g] = geriAlGruplari(e.bekleyenler());
  assert.equal(g.bitis - s.simdi(), 5000, 'tost 5 sn gösterir');
  s.ilerle(1500); // 5,5. sn: A'nın eski süresi geçti
  await bos();
  assert.deepEqual(silinen, [], 'A kendi eski süresiyle silinmez');
  assert.deepEqual(e.bekleyenler().map((b) => b.anahtar), ['hafiza:1', 'hafiza:2']);
  assert.deepEqual(g.anahtarlar.map((a) => e.geriAl(a)), [true, true], '"Geri al" ikisini de geri alır');
  s.ilerle(20_000);
  await bos();
  assert.deepEqual(silinen, []);
});

test('grup tek süre: geri alınmazsa ikisi birlikte 9. sn\'de uygulanır; başka türün grubu etkilenmez', async () => {
  const s = sahteSaat();
  const e = new ErtelenmisSilme(s);
  const silinen: string[] = [];
  e.ertele({ anahtar: 'hafiza:1', etiket: 'A', grup: 'hafiza', uygula: () => { silinen.push(`A@${s.simdi()}`); } });
  e.ertele({ anahtar: 'eposta:x', etiket: 'X', grup: 'eposta', uygula: () => { silinen.push(`X@${s.simdi()}`); } });
  s.ilerle(4000);
  e.ertele({ anahtar: 'hafiza:2', etiket: 'B', grup: 'hafiza', uygula: () => { silinen.push(`B@${s.simdi()}`); } });
  s.ilerle(1000);
  await bos();
  assert.deepEqual(silinen, ['X@5000'], 'e-posta grubu kendi süresiyle');
  s.ilerle(4000);
  await bos();
  assert.deepEqual(silinen, ['X@5000', 'A@9000', 'B@9000']);
});

test('duraklatma grup başına: üstüne gelinen grup durur, öteki akar; gruba katılan silme duraklatılmış gruba uyar', async () => {
  const s = sahteSaat();
  const e = new ErtelenmisSilme(s);
  const silinen: string[] = [];
  const sil = (a: string, grup: string) => e.ertele({ anahtar: a, etiket: a, grup, uygula: () => { silinen.push(`${a}@${s.simdi()}`); } });
  sil('hafiza:1', 'hafiza');
  sil('eposta:x', 'eposta');
  s.ilerle(1000);
  e.duraklat('hafiza');
  assert.deepEqual(e.duraklatilanlar(), ['hafiza']);
  assert.deepEqual(geriAlGruplari(e.bekleyenler()).map((g) => [g.grup, g.durakli]), [['hafiza', true], ['eposta', false]]);
  s.ilerle(4000);
  await bos();
  assert.deepEqual(silinen, ['eposta:x@5000'], 'duraklatılmayan grup akar');
  s.ilerle(10_000);
  sil('hafiza:2', 'hafiza'); // duraklatılmış gruba katıldı: grup yine duraklı, ikisinin kalanı tam süre
  assert.deepEqual(e.bekleyenler().map((b) => [b.anahtar, b.durakli, b.bitis - s.simdi()]), [['hafiza:1', true, 5000], ['hafiza:2', true, 5000]]);
  s.ilerle(60_000);
  assert.equal(silinen.length, 1);
  e.surdur('hafiza');
  s.ilerle(5000);
  await bos();
  assert.deepEqual(silinen.slice(1), ['hafiza:1@80000', 'hafiza:2@80000']);
});

test('duraklatma takılı kalmaz: grup boşalınca kalkar; grupsuz sürdür hepsini sürdürür', async () => {
  const s = sahteSaat();
  const e = new ErtelenmisSilme(s);
  let uygulandi = 0;
  e.ertele({ anahtar: 'hafiza:1', etiket: 'A', grup: 'hafiza', uygula: () => { uygulandi++; } });
  e.duraklat('hafiza');
  assert.equal(e.geriAl('hafiza:1'), true); // üstündeyken "Geri al": fare ayrılma olayı gelmez
  assert.equal(e.durakli, false, 'boşalan grubun duraklatması kalkar');
  e.ertele({ anahtar: 'hafiza:2', etiket: 'B', grup: 'hafiza', uygula: () => { uygulandi++; } });
  s.ilerle(5000);
  await bos();
  assert.equal(uygulandi, 1, 'sonraki silme duraklatılmış başlamaz');
  e.ertele({ anahtar: 'hafiza:3', etiket: 'C', grup: 'hafiza', uygula: () => { uygulandi++; } });
  e.ertele({ anahtar: 'belge:4', etiket: 'D', grup: 'belge', uygula: () => { uygulandi++; } });
  e.duraklat(); // grupsuz: o an bekleyen bütün gruplar
  assert.deepEqual(e.duraklatilanlar().sort(), ['belge', 'hafiza']);
  s.ilerle(30_000);
  e.surdur(); // pencere gizlendi / odak gitti / arayüz yeniden yüklendi
  assert.deepEqual(e.duraklatilanlar(), []);
  s.ilerle(5000);
  await bos();
  assert.equal(uygulandi, 3);
  e.ertele({ anahtar: 'hafiza:5', etiket: 'E', grup: 'hafiza', uygula: () => { uygulandi++; } });
  e.duraklat('hafiza');
  e.hepsiniHemenUygula();
  assert.equal(e.durakli, false, 'çıkışta da temizlenir');
});

test('tost grupları: art arda silinenler tek tostta ("3 kayıt unutuldu"), tekli kendi etiketiyle; geri al hepsini kapsar', () => {
  const g = geriAlGruplari([
    { anahtar: 'hafiza:1', etiket: '“A” unutuldu', bitis: 5000, grup: 'hafiza' },
    { anahtar: 'eposta:x', etiket: 'x@y.co kaldırıldı', bitis: 5500, grup: 'eposta' },
    { anahtar: 'hafiza:2', etiket: '“B” unutuldu', bitis: 6000, grup: 'hafiza' },
    { anahtar: 'hafiza:3', etiket: '“C” unutuldu', bitis: 7000, grup: 'hafiza', durakli: true },
  ]);
  assert.deepEqual(g, [
    { grup: 'hafiza', anahtarlar: ['hafiza:1', 'hafiza:2', 'hafiza:3'], etiket: '3 kayıt unutuldu', bitis: 7000, durakli: true },
    { grup: 'eposta', anahtarlar: ['eposta:x'], etiket: 'x@y.co kaldırıldı', bitis: 5500, durakli: false },
  ]);
  assert.equal(geriAlGruplari([{ anahtar: 'belge:1', etiket: 'a', bitis: 1, grup: 'belge' }, { anahtar: 'belge:2', etiket: 'b', bitis: 2, grup: 'belge' }])[0].etiket, '2 belge silindi');
});

test('uygulama hata verirse kayıt geri belirir ve hata bildirilir', async () => {
  const s = sahteSaat();
  const e = new ErtelenmisSilme(s);
  let hata: unknown = null;
  e.ertele({ anahtar: 'eposta:b', etiket: 'x', uygula: async () => { throw new Error('ana süreç yanıt vermedi'); }, hata: (h) => { hata = h; } });
  s.ilerle(5000);
  await bos(); await bos();
  assert.equal(e.gizliMi('eposta:b'), false);
  assert.match(String((hata as Error)?.message), /yanıt vermedi/);
});

test('aynı kayıt yeniden ertelenirse tek bekleyen kalır, eski zamanlayıcı iptal edilir', async () => {
  const s = sahteSaat();
  const e = new ErtelenmisSilme(s);
  const cagri: string[] = [];
  e.ertele({ anahtar: 'hafiza:9', etiket: 'ilk', uygula: () => { cagri.push('ilk'); } });
  s.ilerle(3000);
  e.ertele({ anahtar: 'hafiza:9', etiket: 'ikinci', uygula: () => { cagri.push('ikinci'); } });
  assert.equal(e.bekleyenler().length, 1);
  s.ilerle(2500);
  assert.deepEqual(cagri, [], 'ilk zamanlayıcı çalışmaz');
  s.ilerle(2500);
  await bos();
  assert.deepEqual(cagri, ['ikinci']);
});

test('uygulama sürerken geri alınamaz (yarıda kalan silme olmaz)', async () => {
  const s = sahteSaat();
  const e = new ErtelenmisSilme(s);
  let bitir: () => void = () => undefined;
  e.ertele({ anahtar: 'belge:8', etiket: 'x', uygula: () => new Promise<void>((c) => { bitir = c; }) });
  s.ilerle(5000);
  assert.equal(e.geriAl('belge:8'), false);
  assert.equal(e.gizliMi('belge:8'), true);
  bitir();
  await bos();
  assert.equal(e.gizliMi('belge:8'), true);
});
