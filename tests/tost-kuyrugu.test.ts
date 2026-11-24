// Uygulama içi tostların tek kuyruğu ve yerleşimi (src/shared/tost-kuyrugu.ts; Görev 20b düzeltme turu 2). Tostlar artık sayfa
// alanını kısaltan alt şeritte DEĞİL, çentiğin altında sayfanın üstünde (yerleşim kayması yok): en çok 2 tost görünür, öncelik
// sırasıyla ("Geri al" > onay > hatırlatma > hata > Fuber'in sözü/mesajı > bilgi); kalanı sırada bekler ("+N"). Süre yalnız tost
// GÖRÜNÜRKEN ve üstünde imleç yokken işler; sırada bekleyen bilgi 30 sn içinde gösterilemezse düşer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TostKuyrugu, tostYerlesimi, GORUNEN_TOST, KATLAMA_MS } from '../src/shared/tost-kuyrugu.ts';
import type { Saat } from '../src/shared/ertelenmis.ts';

function sahteSaat(): Saat & { ilerle: (ms: number) => void } {
  let t = 0, n = 0;
  const isler = new Map<number, { an: number; f: () => void }>();
  return {
    kur: (f, ms) => { const id = ++n; isler.set(id, { an: t + ms, f }); return id; },
    iptal: (id) => { isler.delete(id as number); },
    simdi: () => t,
    ilerle: (ms) => { t += ms; for (const [id, x] of [...isler].sort((a, b) => a[1].an - b[1].an)) if (x.an <= t) { isler.delete(id); x.f(); } },
  };
}

test('yerleşim: en çok 2 tost görünür, öncelik sırasıyla; kalanı sırada ("+N")', () => {
  assert.equal(GORUNEN_TOST, 2);
  const o = (anahtar: string, tur: Parameters<typeof tostYerlesimi>[0][number]['tur'], sira: number) => ({ anahtar, tur, sira });
  const y = tostYerlesimi([o('b1', 'bilgi', 1), o('h', 'hatirlatma', 2), o('s', 'soz', 3), o('on', 'onay', 4), o('g', 'geri-al', 0)]);
  assert.deepEqual(y.gorunen.map((x) => x.anahtar), ['g', 'on'], '"Geri al" ve onay önce');
  assert.deepEqual(y.sirada.map((x) => x.anahtar), ['h', 's', 'b1']);
  const y2 = tostYerlesimi([o('b1', 'bilgi', 1), o('e', 'hata', 2), o('b2', 'bilgi', 3)]);
  assert.deepEqual(y2.gorunen.map((x) => x.anahtar), ['e', 'b1'], 'aynı öncelikte gelişe göre');
  assert.deepEqual(tostYerlesimi([]).gorunen, []);
});

test('Görev 28: tostun "yol"u (Claude Code oturumu) listede korunur — "Aç" o oturuma götürür', () => {
  const k = new TostKuyrugu(sahteSaat());
  k.ekle({ tur: 'mesaj', baslik: 'Claude Code izin bekliyor · mavi-kus', metin: 'Bash: npm test', sure: 12_000, yol: 'claude#cc-o-1' });
  k.ekle({ tur: 'bilgi', metin: 'yolsuz', sure: 6000 });
  const l = k.liste();
  assert.equal(l[0].yol, 'claude#cc-o-1');
  assert.equal('yol' in l[1], false);
});

test('süre yalnız görünürken işler: sırada bekleyen tostun süresi geçmez; görünür olunca baştan sayar', () => {
  const s = sahteSaat();
  const k = new TostKuyrugu(s);
  const a = k.ekle({ tur: 'bilgi', metin: 'A', sure: 6000 });
  s.ilerle(10_000);
  assert.deepEqual(k.liste().map((t) => t.id), [a], 'görünmeden süre işlemez');
  k.gorunenler([a]);
  s.ilerle(5999);
  assert.equal(k.liste().length, 1);
  s.ilerle(1);
  assert.equal(k.liste().length, 0, 'görünür olduktan 6 sn sonra kalkar');
});

test('üstüne gelince süre durur, çıkınca kalandan (en az 1,5 sn) sürer; görünmez olunca duraklatma da kalkar', () => {
  const s = sahteSaat();
  const k = new TostKuyrugu(s);
  const a = k.ekle({ tur: 'hata', metin: 'E-posta: bağlanamadı', sure: 6000 });
  k.gorunenler([a]);
  s.ilerle(5500);
  k.duraklat(a, true);
  s.ilerle(60_000);
  assert.equal(k.liste().length, 1, 'üstündeyken kalkmaz');
  k.duraklat(a, false);
  s.ilerle(1499);
  assert.equal(k.liste().length, 1, 'çıkınca okumaya en az 1,5 sn');
  s.ilerle(1);
  assert.equal(k.liste().length, 0);
  const b = k.ekle({ tur: 'bilgi', metin: 'B', sure: 6000 });
  k.gorunenler([b]);
  k.duraklat(b, true);
  k.gorunenler([]); // üstündeyken başka tostlar öne geçti: fare ayrılma olayı gelmez
  k.gorunenler([b]);
  s.ilerle(6000);
  assert.equal(k.liste().length, 0, 'duraklatma takılı kalmadı');
});

test('pencere odağı gidince bütün duraklatmalar kalkar', () => {
  const s = sahteSaat();
  const k = new TostKuyrugu(s);
  const a = k.ekle({ tur: 'soz', baslik: 'Fuber', metin: 'Ece sunumu cuma bekliyor.', sure: 12_000 });
  k.gorunenler([a]);
  k.duraklat(a, true);
  k.hepsiniSurdur();
  s.ilerle(12_000);
  assert.equal(k.liste().length, 0);
});

test('hatırlatıcı ve onay kendiliğinden kalkmaz; aynı onay ikinci kez eklenmez; süzgeçle kalkar', () => {
  const s = sahteSaat();
  const k = new TostKuyrugu(s);
  const h = k.ekle({ tur: 'hatirlatma', baslik: 'Hatırlatma · Görüşme', metin: 'Zoom', sure: null });
  const o = k.ekle({ tur: 'onay', baslik: 'Onayın gerekiyor', metin: 'Dosya oku', sohbetId: 4, onayId: 'x1', sure: null });
  assert.equal(k.ekle({ tur: 'onay', baslik: 'Onayın gerekiyor', metin: 'Dosya oku', sohbetId: 4, onayId: 'x1', sure: null }), o, 'aynı onay: aynı tost');
  k.gorunenler([h, o]);
  s.ilerle(3_600_000);
  assert.deepEqual(k.liste().map((t) => t.tur), ['hatirlatma', 'onay']);
  k.suz((t) => t.onayId === 'x1');
  assert.deepEqual(k.liste().map((t) => t.tur), ['hatirlatma']);
  k.kaldir(h);
  assert.deepEqual(k.liste(), []);
});

test('aynı bilgi/hata metni yinelenirse tek tost kalır (yeni tost açılmaz, süresi tazelenir)', () => {
  const s = sahteSaat();
  const k = new TostKuyrugu(s);
  const a = k.ekle({ tur: 'hata', metin: 'WhatsApp: bağlantı koptu', sure: 6000 });
  k.gorunenler([a]);
  s.ilerle(5000);
  assert.equal(k.ekle({ tur: 'hata', metin: 'WhatsApp: bağlantı koptu', sure: 6000 }), a);
  assert.equal(k.liste().length, 1);
  s.ilerle(5999);
  assert.equal(k.liste().length, 1, 'süre tazelendi');
  s.ilerle(1);
  assert.equal(k.liste().length, 0);
});

test('sırada bekleyen süreli tost 30 sn içinde gösterilemezse düşer; hatırlatıcı beklemeye devam eder', () => {
  const s = sahteSaat();
  const k = new TostKuyrugu(s);
  const b = k.ekle({ tur: 'bilgi', metin: 'Öğrendim: a.pdf', sure: 6000 });
  const h = k.ekle({ tur: 'hatirlatma', baslik: 'Hatırlatma', metin: 'x', sure: null });
  s.ilerle(29_999);
  assert.equal(k.liste().length, 2);
  s.ilerle(1);
  assert.deepEqual(k.liste().map((t) => t.id), [h]);
  const c = k.ekle({ tur: 'bilgi', metin: 'C', sure: 6000 });
  k.gorunenler([c]);
  s.ilerle(1000);
  k.gorunenler([]); // bir kez göründü: artık bekleme süresiyle düşmez, kalanı korunur
  s.ilerle(60_000);
  assert.ok(k.liste().some((t) => t.id === c));
  void b;
});

// B8 (son düzeltme): kalıcı tostlar (hatırlatıcı, onay) sayfanın üstünü sürekli örtmesin — görünür kaldıktan 8 sn sonra çentiğe "+N"
// hapı olarak katlanır (silinmez); imleç üstündeyken süre durur; hapa tıklayınca açılır ve süre baştan işler.
test('B8: kalıcı tost görünür kaldıktan 8 sn sonra katlanır (silinmez); üstündeyken durur; açılınca yeniden 8 sn', () => {
  const s = sahteSaat();
  const k = new TostKuyrugu(s);
  const h = k.ekle({ tur: 'hatirlatma', baslik: 'Hatırlatma · Görüşme', metin: 'Zoom', sure: null });
  s.ilerle(60_000);
  assert.equal(k.liste()[0].katli, undefined, 'görünmeden katlanmaz');
  k.gorunenler([h]);
  s.ilerle(KATLAMA_MS - 1);
  assert.equal(k.liste()[0].katli, undefined);
  k.duraklat(h, true);
  s.ilerle(60_000);
  assert.equal(k.liste()[0].katli, undefined, 'üstündeyken katlanmaz');
  k.duraklat(h, false);
  s.ilerle(1499);
  assert.equal(k.liste()[0].katli, undefined, 'çıkınca en az 1,5 sn');
  s.ilerle(1);
  assert.equal(k.liste()[0].katli, true, 'katlandı');
  assert.equal(k.liste().length, 1, 'silinmedi');
  k.gorunenler([]); // katman artık göstermiyor
  k.katlilariAc();
  assert.equal(k.liste()[0].katli, undefined, 'hapa tıklandı: açıldı');
  k.gorunenler([h]);
  s.ilerle(KATLAMA_MS);
  assert.equal(k.liste()[0].katli, true, 'yeniden 8 sn sonra katlanır');
});

test('B8: sırada bekleyen HATA 30 sn sonra görülmeden düşmez (bilgi düşer); göründüğünde süresi işler', () => {
  const s = sahteSaat();
  const k = new TostKuyrugu(s);
  const e = k.ekle({ tur: 'hata', metin: 'E-posta: bağlanamadı', sure: 6000 });
  const b = k.ekle({ tur: 'bilgi', metin: 'Öğrendim: a.pdf', sure: 6000 });
  s.ilerle(5 * 60_000);
  assert.deepEqual(k.liste().map((t) => t.id), [e], 'bilgi düştü, hata bekliyor');
  k.gorunenler([e]);
  s.ilerle(6000);
  assert.deepEqual(k.liste(), []);
  void b;
});

test('dinleyiciye her değişiklik bildirilir; liste geliş sırasıyla', () => {
  const s = sahteSaat();
  const k = new TostKuyrugu(s);
  let n = 0;
  const birak = k.dinle(() => { n++; });
  const a = k.ekle({ tur: 'bilgi', metin: 'A', sure: 6000 });
  const b = k.ekle({ tur: 'hata', metin: 'B', sure: 6000 });
  assert.deepEqual(k.liste().map((t) => t.id), [a, b]);
  assert.ok(k.liste()[0].sira < k.liste()[1].sira);
  k.kaldir(a);
  assert.equal(n, 3);
  birak();
  k.kaldir(b);
  assert.equal(n, 3);
});
