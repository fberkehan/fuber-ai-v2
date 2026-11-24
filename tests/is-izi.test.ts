// İş izi (11 Kas; alt ajanlara giden işlerde ne yapıldığı belli olmuyordu): tek iş modeli ve kaynak eşlemeleri. Saf; Electron yok.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IS_HALI_ADI, IS_HALLERI, aktifMi, isleriSirala, isSuresi, centikOzeti, centikSatirlari, yaprakIsler, rayNoktalari, telefonIsOzeti,
  yardimciAdi, yardimciTonu, sohbetTuruIsi, gorevIsi, surecIsi, ccOturumIsi, ccAltAjanIsi, ccArkaIsIsi, ccAracFiili, ccAjanTipiAdi,
  sohbetYardimcilari, isAltMetni, centikIsSayisi, bitenleriTut, BITEN_OMRU_MS, yardimciOzeti, ustGruplari, gorevleriKat, type IsKaydi,
} from '../src/shared/is-izi.ts';
import type { IsOzet } from '../src/shared/isler.ts';
import type { CcOturumOzeti, CcArkaIs } from '../src/shared/cc-olay.ts';
import { icKimlikVarMi } from '../src/shared/gorunen-metin.ts';

const T0 = Date.parse('2026-11-11T10:00:00Z');
const is = (o: Partial<IsKaydi> & Pick<IsKaydi, 'id'>): IsKaydi => ({
  kaynak: 'sohbet', ne: 'Çalışıyor', baslik: '', nerede: { sayfa: 'sohbetler', yol: 'sohbetler/1', ad: 'Sohbet' }, hal: 'calisiyor', baslangic: T0, ...o,
});

test('yedi durum, Türkçe adlarıyla ve sırasıyla', () => {
  assert.deepEqual(IS_HALLERI, ['sirada', 'basliyor', 'calisiyor', 'bekliyor', 'onay', 'bitti', 'olmadi']);
  assert.deepEqual(IS_HALLERI.map((h) => IS_HALI_ADI[h]), ['Sırada', 'Başlıyor', 'Çalışıyor', 'Bekliyor', 'Onay bekliyor', 'Bitti', 'Olmadı']);
  assert.ok(aktifMi('calisiyor') && aktifMi('onay') && aktifMi('sirada') && aktifMi('bekliyor') && aktifMi('basliyor'));
  assert.ok(!aktifMi('bitti') && !aktifMi('olmadi'));
});

test('süre insan diliyle', () => {
  assert.equal(isSuresi(0), '0 sn');
  assert.equal(isSuresi(4_400), '4 sn');
  assert.equal(isSuresi(72_000), '1 dk 12 sn');
  assert.equal(isSuresi(12 * 60_000), '12 dk');
  assert.equal(isSuresi(65 * 60_000), '1 sa 5 dk');
  assert.equal(isSuresi(-5), '0 sn');
});

test('sıralama: onay > çalışıyor > başlıyor > bekliyor > sırada; bitenler en sonda, en yenisi önce', () => {
  const l = isleriSirala([
    is({ id: 'a', hal: 'bitti', bitis: T0 + 10 }), is({ id: 'b', hal: 'sirada' }), is({ id: 'c', hal: 'onay' }), is({ id: 'd', hal: 'calisiyor', baslangic: T0 + 5 }),
    is({ id: 'e', hal: 'calisiyor', baslangic: T0 }), is({ id: 'f', hal: 'bekliyor' }), is({ id: 'g', hal: 'olmadi', bitis: T0 + 20 }), is({ id: 'h', hal: 'basliyor' }),
  ]);
  assert.deepEqual(l.map((x) => x.id), ['c', 'e', 'd', 'h', 'f', 'b', 'g', 'a']);
});

test('yapraklar: çocuğu süren üst iş satır olmaz; çentik en çok 3 satır ve kalan sayısı', () => {
  const l = [
    is({ id: 'cc:1', kaynak: 'cc-oturum' }),
    is({ id: 'cc:1:a', kaynak: 'cc-ajan', ust: 'cc:1', sira: 0 }), is({ id: 'cc:1:b', kaynak: 'cc-ajan', ust: 'cc:1', sira: 1 }),
    is({ id: 'cc:1:c', kaynak: 'cc-ajan', ust: 'cc:1', sira: 2 }), is({ id: 'gorev:4', kaynak: 'gorev', hal: 'bekliyor' }),
    is({ id: 'surec:x', kaynak: 'surec', surekli: true }),
  ];
  assert.deepEqual(yaprakIsler(l).map((x) => x.id), ['cc:1:a', 'cc:1:b', 'cc:1:c', 'gorev:4', 'surec:x']);
  const s = centikSatirlari(l);
  assert.deepEqual(s.satirlar.map((x) => x.id), ['cc:1:a', 'cc:1:b', 'cc:1:c']);
  assert.equal(s.kalan, 1); // sürekli süreç çentikte sayılmaz
  assert.equal(centikIsSayisi(l), 4);
  // Bitenler yalnız bir an kalır; çentiğin sayısı onları saymaz.
  assert.equal(centikIsSayisi([is({ id: 'x', hal: 'bitti' })]), 0);
});

test('çentik özeti: tek işte işin fiili; çok işte "N iş · <ilk başlık>"', () => {
  assert.equal(centikOzeti([is({ id: 'a', ne: "Web'de arıyor", baslik: 'Rakip fiyatları' })]), "Web'de arıyor");
  assert.equal(centikOzeti([is({ id: 'a', ne: 'Okuyor', baslik: 'Eski ekranları tara', kaynak: 'cc-ajan', ust: 'p' }), is({ id: 'b', ne: 'Arıyor', kaynak: 'cc-ajan', ust: 'p' }), is({ id: 'c', ne: 'X', kaynak: 'cc-ajan', ust: 'p' })]), '3 iş · Eski ekranları tara');
  assert.equal(centikOzeti([]), '');
});

test('yardımcı adı ve tonu: sıra 1’den sayılır; ton sıraya göre ayrışır, ilk yardımcı kipin vurgusu', () => {
  assert.equal(yardimciAdi(is({ id: 'a', kaynak: 'cc-ajan', sira: 0 })), 'Yardımcı 1');
  assert.equal(yardimciAdi(is({ id: 'a', kaynak: 'cc-ajan', sira: 2 })), 'Yardımcı 3');
  assert.equal(yardimciAdi(is({ id: 'a', kaynak: 'cc-oturum' })), 'Claude Code');
  assert.equal(yardimciAdi(is({ id: 'a', kaynak: 'gorev' })), 'Görev');
  assert.equal(yardimciTonu(0), 0);
  const t = [0, 1, 2, 3, 4, 5].map(yardimciTonu);
  assert.equal(new Set(t).size, 6, `tonlar ayrışmalı: ${t}`);
  assert.equal(yardimciTonu(6), yardimciTonu(0));
});

test('ray noktaları: aktif işlerin sayfaları; sürekli süreç ayrı (nefes almaz)', () => {
  const r = rayNoktalari([
    is({ id: 'a', nerede: { sayfa: 'claude', yol: 'claude#cc-1', ad: 'mavi-kus' } }),
    is({ id: 'b', hal: 'bitti', nerede: { sayfa: 'sohbetler', yol: 'sohbetler/2', ad: 'S' } }),
    is({ id: 'c', kaynak: 'surec', surekli: true, nerede: { sayfa: 'sohbetler', yol: 'sohbetler/3', ad: 'S' } }),
  ]);
  assert.deepEqual(r, { claude: 'canli', sohbetler: 'surekli' });
});

test('telefon: yalnız durum — fiil, başlık, yer adı, yol ve kimlik yok', () => {
  const l = [is({ id: 'sohbet:12', ne: 'Gizli Proje dosyasını okuyor', baslik: 'Gizli Proje', nerede: { sayfa: 'sohbetler', yol: 'sohbetler/12', ad: 'Gizli Proje' }, ilerleme: { adim: 3, oran: 0.5 } })];
  const t = telefonIsOzeti(l);
  assert.deepEqual(t, [{ kaynak: 'sohbet', hal: 'calisiyor', baslangic: T0, sayfa: 'sohbetler', ilerleme: { adim: 3, oran: 0.5 } }]);
  assert.doesNotMatch(JSON.stringify(t), /Gizli|okuyor|sohbetler\/12|sohbet:12/);
  assert.deepEqual(telefonIsOzeti('bozuk' as unknown as IsKaydi[]), []);
});

test('sohbet turu: başlarken "Başlıyor", araçta aracın cümlesi, onayda "Onay bekliyor"; yer sohbetin kendisi', () => {
  const t = sohbetTuruIsi({ sohbetId: 7, baslik: 'Rakip fiyat araştırması', baslangic: T0, adim: 0, ne: '', onay: false });
  assert.equal(t.id, 'sohbet:7');
  assert.equal(t.hal, 'basliyor');
  assert.equal(t.ne, 'Düşünüyor');
  assert.deepEqual(t.nerede, { sayfa: 'sohbetler', yol: 'sohbetler/7', ad: 'Rakip fiyat araştırması' });
  assert.equal(t.durdurulabilir, true);
  const c = sohbetTuruIsi({ sohbetId: 7, baslik: '', baslangic: T0, adim: 4, ne: "Web'de 'kafe fiyatları' arıyor", onay: false });
  assert.equal(c.hal, 'calisiyor');
  assert.equal(c.ne, "Web'de 'kafe fiyatları' arıyor");
  assert.equal(c.nerede.ad, 'Sohbet');
  assert.deepEqual(c.ilerleme, { adim: 4 });
  const o = sohbetTuruIsi({ sohbetId: 7, baslik: 'x', baslangic: T0, adim: 2, ne: 'y', onay: true });
  assert.equal(o.hal, 'onay');
  assert.equal(o.ne, 'Onayını bekliyor');
});

const gorev = (o: Partial<IsOzet>): IsOzet => ({
  id: 4, baslik: 'Ece’nin yanıtını izle', amac: '', durum: 'suruyor', baslangic: '2026-11-11T09:50:00.000Z', bitisZamani: '2026-11-11T10:10:00.000Z', sonraki: '2026-11-11T10:30:00.000Z',
  sonKontrol: null, adim: 2, kontrol: 3, sonOzet: null, sonuc: null, durmaNedeni: null, sohbetId: 9,
  plan: { baslik: 'x', amac: 'y', gozcu: { tur: 'saat' }, aralik: 60, bitis: { tur: 'sure', saniye: 1200 }, azamiAdim: 60, izinler: [] } as unknown as IsOzet['plan'], ...o,
});

test('görev: adımdayken Çalışıyor, iki kontrol arasında "Bekliyor · sonraki kontrol HH:MM"; süreli işte ilerleme oranı', () => {
  const simdi = new Date(T0);
  const b = gorevIsi(gorev({}), simdi, 'is');
  assert.equal(b.id, 'gorev:4');
  assert.equal(b.hal, 'bekliyor');
  assert.match(b.ne, /^Bekliyor · sonraki kontrol \d\d:\d\d$/);
  assert.equal(b.baslik, 'Ece’nin yanıtını izle');
  assert.deepEqual(b.nerede, { sayfa: 'sohbetler', yol: 'sohbetler/9', ad: 'Ece’nin yanıtını izle' });
  assert.ok(b.ilerleme?.oran !== undefined && Math.abs(b.ilerleme.oran - 0.5) < 0.01, JSON.stringify(b.ilerleme));
  assert.equal(b.durdurulabilir, true);
  const c = gorevIsi(gorev({ adimda: true }), simdi, 'is');
  assert.equal(c.hal, 'calisiyor');
  assert.equal(c.ne, 'Kontrol ediyor');
  assert.equal(gorevIsi(gorev({ durum: 'onay' }), simdi, 'is').hal, 'onay');
  assert.equal(gorevIsi(gorev({ durum: 'bitti' }), simdi, 'is').hal, 'bitti');
  const d = gorevIsi(gorev({ durum: 'durdu', durmaNedeni: 'kullanici' }), simdi, 'is');
  assert.equal(d.hal, 'olmadi');
  assert.equal(d.ne, 'Durdurdun');
});

test('kokpit: arayüzdeki süren görev listede yoksa katılır, varsa yinelenmez; biten görev katılmaz', () => {
  const simdi = new Date(T0);
  const l = gorevleriKat([is({ id: 'gorev:4', kaynak: 'gorev' })], [gorev({}), gorev({ id: 5 }), gorev({ id: 6, durum: 'bitti' })], simdi);
  assert.deepEqual(l.map((x) => x.id).sort(), ['gorev:4', 'gorev:5']);
});

test('arka plan süreci: sürekli iş, sohbetine bağlı; komut kısaltılır', () => {
  const s = surecIsi({ kimlik: 'k1', komut: 'npm run dev -- --port 5173 --host 0.0.0.0 --strictPort', klasor: 'C:/x', durum: 'calisiyor', kod: null, baslangic: T0, sonSatir: 'ready', sohbetId: 3 });
  assert.equal(s.id, 'surec:k1');
  assert.equal(s.hal, 'calisiyor');
  assert.equal(s.surekli, true);
  assert.equal(s.sohbetId, 3);
  assert.equal(s.nerede.yol, 'sohbetler/3');
  assert.ok(s.baslik.length <= 40, s.baslik);
  assert.equal(s.ne, 'Arka planda çalışıyor');
  assert.equal(surecIsi({ kimlik: 'k2', komut: 'x', klasor: '', durum: 'hata', kod: 1, baslangic: T0, sonSatir: '' }).hal, 'olmadi');
  assert.equal(surecIsi({ kimlik: 'k2', komut: 'x', klasor: '', durum: 'bitti', kod: 0, baslangic: T0, sonSatir: '' }).nerede.sayfa, 'kokpit');
});

const oturum = (o: Partial<CcOturumOzeti>): CcOturumOzeti => ({
  id: 'o1', kimlik: 'aaaa1111-0000', cwd: 'C:/k/mavi-kus', proje: 'mavi-kus', baslik: 'Bütün bileşenleri gözden geçir', durum: 'calisiyor', mod: 'acceptEdits', kaynak: 'sayfa',
  bekleyenIzin: 0, kuyruk: 0, arkaPlan: 0, degisenDosyaSayisi: 0, yetenekler: [], olusturma: T0, sonEtkinlik: T0, ...o,
});

test('Claude Code oturumu: durumlar eşlenir, yer oturumun kendisi, sohbetten verildiyse sohbetine bağlı', () => {
  const c = ccOturumIsi(oturum({}), { tip: 'okuma', ad: 'Read', ozet: 'C:/k/mavi-kus/src/Kartlar.tsx' });
  assert.equal(c.id, 'cc:o1');
  assert.equal(c.kaynak, 'cc-oturum');
  assert.equal(c.hal, 'calisiyor');
  assert.equal(c.ne, 'Okuyor · Kartlar.tsx');
  assert.equal(c.nerede.sayfa, 'claude');
  assert.match(c.nerede.yol, /^claude#cc-o1/);
  assert.equal(c.nerede.ad, 'mavi-kus');
  assert.equal(ccOturumIsi(oturum({ durum: 'izin', bekleyenIzin: 1 })).hal, 'onay');
  assert.equal(ccOturumIsi(oturum({ durum: 'sirada' })).hal, 'sirada');
  assert.equal(ccOturumIsi(oturum({ durum: 'bosta' })).hal, 'bitti');
  assert.equal(ccOturumIsi(oturum({ durum: 'bosta', arkaPlan: 2 })).hal, 'calisiyor');
  assert.equal(ccOturumIsi(oturum({ durum: 'hata' })).hal, 'olmadi');
  assert.equal(ccOturumIsi(oturum({ kaynak: 'sohbet', sohbetId: 5 })).sohbetId, 5);
});

test('Claude Code alt ajanı: yardımcı satırı — canlı fiil son süren adımdan, adım sayısı, ton sırası; iç kimlik ve "general-purpose" görünmez', () => {
  const a = ccAltAjanIsi({
    id: 'toolu_01', aciklama: 'Eski ekranları tara', ajanTipi: 'general-purpose', durum: 'calisiyor', baslangic: T0,
    cocuklar: [{ tip: 'okuma', ad: 'Read', ozet: 'src/eski/kayit.css', durum: 'tamam' }, { tip: 'arama', ad: 'Grep', ozet: 'width: 1200px', durum: 'calisiyor' }],
  }, oturum({}), 1);
  assert.equal(a.id, 'cc:o1:toolu_01');
  assert.equal(a.ust, 'cc:o1');
  assert.equal(a.kaynak, 'cc-ajan');
  assert.equal(a.sira, 1);
  assert.equal(a.hal, 'calisiyor');
  assert.equal(a.ne, 'Arıyor · width: 1200px');
  assert.equal(a.baslik, 'Eski ekranları tara');
  assert.deepEqual(a.ilerleme, { adim: 2 });
  for (const m of [a.ne, a.baslik, a.nerede.ad, yardimciAdi(a)]) { assert.ok(!icKimlikVarMi(m), m); assert.doesNotMatch(m, /general-purpose|toolu_/); }
  assert.equal(ccAltAjanIsi({ id: 'x', aciklama: 'a', durum: 'calisiyor', baslangic: T0, cocuklar: [] }, oturum({}), 0).hal, 'basliyor');
  assert.equal(ccAltAjanIsi({ id: 'x', aciklama: 'a', durum: 'calisiyor', baslangic: T0, cocuklar: [], izinde: true }, oturum({}), 0).hal, 'onay');
  assert.equal(ccAltAjanIsi({ id: 'x', aciklama: 'a', durum: 'tamam', baslangic: T0, bitis: T0 + 9000, cocuklar: [] }, oturum({}), 0).hal, 'bitti');
  assert.equal(ccAltAjanIsi({ id: 'x', aciklama: 'a', durum: 'hata', baslangic: T0, cocuklar: [] }, oturum({}), 0).hal, 'olmadi');
  // Biten adımlardan sonra süren yoksa son adımın fiili kalır.
  assert.equal(ccAltAjanIsi({ id: 'x', aciklama: 'a', durum: 'calisiyor', baslangic: T0, cocuklar: [{ tip: 'duzenleme', ad: 'Edit', ozet: 'a/b/c.css', durum: 'tamam' }] }, oturum({}), 0).ne, 'Düzenliyor · c.css');
});

test('alt ajan türü insan diliyle: general-purpose boş (çip yok), Explore "Keşif", bilinmeyen okunur ad', () => {
  assert.equal(ccAjanTipiAdi('general-purpose'), '');
  assert.equal(ccAjanTipiAdi('Explore'), 'Keşif');
  assert.equal(ccAjanTipiAdi('Plan'), 'Planlama');
  assert.equal(ccAjanTipiAdi('code-reviewer'), 'Code reviewer');
  assert.equal(ccAjanTipiAdi(undefined), '');
});

test('Claude Code işi (arka plan): durumlar ve fiil', () => {
  const i: CcArkaIs = { id: 't1', aciklama: 'npm test', tip: 'kabuk', durum: 'suruyor', arkaPlanda: true, baslangic: T0 };
  const k = ccArkaIsIsi(i, oturum({}));
  assert.equal(k.id, 'cc:o1:is:t1');
  assert.equal(k.ust, 'cc:o1');
  assert.equal(k.hal, 'calisiyor');
  assert.equal(k.ne, 'Komut çalıştırıyor');
  assert.equal(ccArkaIsIsi({ ...i, durum: 'bitti', bitis: T0 + 1 }, oturum({})).hal, 'bitti');
  assert.equal(ccArkaIsIsi({ ...i, durum: 'basarisiz' }, oturum({})).hal, 'olmadi');
});

test('araç fiilleri: dosya adı, arama tırnaklı, komut kısaltılmış', () => {
  assert.equal(ccAracFiili({ tip: 'okuma', ad: 'Read', ozet: 'C:\\a\\b\\giris.css' }), 'Okuyor · giris.css');
  assert.equal(ccAracFiili({ tip: 'kabuk', ad: 'Bash', ozet: 'npm run test -- --watch=false --reporter=spec' }).length <= 50, true);
  assert.equal(ccAracFiili({ tip: 'web', ad: 'WebFetch', ozet: '' }), "Web'de arıyor");
  assert.equal(ccAracFiili({ tip: 'diger', ad: 'X', ozet: '' }), 'Çalışıyor');
});

test('sohbetin yardımcıları: o sohbetten verilen Claude Code oturumu ve onun alt ajanları, arka plan süreçleri; sohbet turunun kendisi değil', () => {
  const l = [
    is({ id: 'sohbet:5', sohbetId: 5 }),
    is({ id: 'cc:o1', kaynak: 'cc-oturum', sohbetId: 5 }),
    is({ id: 'cc:o1:a', kaynak: 'cc-ajan', ust: 'cc:o1', sira: 0 }), is({ id: 'cc:o1:b', kaynak: 'cc-ajan', ust: 'cc:o1', sira: 1 }),
    is({ id: 'cc:o2', kaynak: 'cc-oturum', sohbetId: 6 }), is({ id: 'cc:o2:a', kaynak: 'cc-ajan', ust: 'cc:o2', sira: 0 }),
    is({ id: 'surec:k', kaynak: 'surec', sohbetId: 5, surekli: true }),
  ];
  const y = sohbetYardimcilari(l, 5);
  assert.deepEqual(y.map((g) => [g.is.id, g.cocuklar.map((c) => c.id)]), [['cc:o1', ['cc:o1:a', 'cc:o1:b']], ['surec:k', []]]);
});

test('Şu an grupları: üst işler sıralı, çocukları sırayla; üstü olmayan çocuk kendi başına', () => {
  const g = ustGruplari([
    is({ id: 'gorev:1', kaynak: 'gorev', hal: 'bekliyor' }),
    is({ id: 'cc:o1', kaynak: 'cc-oturum' }),
    is({ id: 'cc:o1:b', kaynak: 'cc-ajan', ust: 'cc:o1', sira: 1 }), is({ id: 'cc:o1:a', kaynak: 'cc-ajan', ust: 'cc:o1', sira: 0 }),
    is({ id: 'cc:o9:z', kaynak: 'cc-ajan', ust: 'cc:o9', sira: 0, hal: 'onay' }),
  ]);
  assert.deepEqual(g.map((x) => [x.is.id, x.cocuklar.map((c) => c.id)]), [['cc:o9:z', []], ['cc:o1', ['cc:o1:a', 'cc:o1:b']], ['gorev:1', []]]);
});

test('alt metin: yer · süre · adım', () => {
  const m = isAltMetni(is({ id: 'a', baslangic: T0, ilerleme: { adim: 5 }, nerede: { sayfa: 'claude', yol: 'x', ad: 'mavi-kus' } }), T0 + 42_000);
  assert.equal(m, 'mavi-kus · 42 sn · 5 adım');
  assert.equal(isAltMetni(is({ id: 'a', hal: 'bitti', baslangic: T0, bitis: T0 + 9_000 }), T0 + 99_000), 'Sohbet · 9 sn');
});

test('yardımcı özeti: hepsi bitince tek satır "3 yardımcı · 14 adım · 42 sn"', () => {
  const c = [0, 1, 2].map((i) => is({ id: `c${i}`, kaynak: 'cc-ajan', hal: 'bitti', sira: i, baslangic: T0, bitis: T0 + 42_000, ilerleme: { adim: [4, 5, 5][i] } }));
  assert.equal(yardimciOzeti(c), '3 yardımcı · 14 adım · 42 sn');
  assert.equal(yardimciOzeti([]), '');
});

test('bitenleri tut: aktiften çıkan iş bir an "Bitti" olarak kalır, sonra düşer; hiç aktif görülmemiş biten iş eklenmez', () => {
  const once = new Map<string, IsKaydi>([['a', is({ id: 'a' })], ['b', is({ id: 'b' })]]);
  const tutulan = new Map<string, IsKaydi>();
  // a kayboldu (bitti sayılır), b olmadı oldu, c hiç görülmeden bitmiş geldi.
  const yeni = [is({ id: 'b', hal: 'olmadi' }), is({ id: 'c', hal: 'bitti' })];
  const r = bitenleriTut(once, yeni, tutulan, T0);
  assert.deepEqual(r.map((x) => [x.id, x.hal]).sort(), [['a', 'bitti'], ['b', 'olmadi']]);
  assert.equal(r.find((x) => x.id === 'a')?.bitis, T0);
  // Süre dolunca düşer.
  const r2 = bitenleriTut(new Map(), [], tutulan, T0 + BITEN_OMRU_MS + 1);
  assert.deepEqual(r2, []);
});

test('bitenleri tut: üstü süren yardımcı düşmez (grup bütün kalsın); üst bitince ikisi birlikte ömrünü doldurur', () => {
  const ust = is({ id: 'cc:o1', kaynak: 'cc-oturum' });
  const c = is({ id: 'cc:o1:a', kaynak: 'cc-ajan', ust: 'cc:o1', sira: 0 });
  const tutulan = new Map<string, IsKaydi>();
  bitenleriTut(new Map([[ust.id, ust], [c.id, c]]), [ust, { ...c, hal: 'bitti', bitis: T0 }], tutulan, T0);
  const r = bitenleriTut(new Map([[ust.id, ust]]), [ust, { ...c, hal: 'bitti', bitis: T0 }], tutulan, T0 + 10 * BITEN_OMRU_MS);
  assert.deepEqual(r.map((x) => x.id), ['cc:o1:a'], 'üst sürerken yardımcı kalır');
  const t1 = T0 + 10 * BITEN_OMRU_MS;
  const r3 = bitenleriTut(new Map([[ust.id, ust]]), [], tutulan, t1);
  assert.deepEqual(r3.map((x) => x.id).sort(), ['cc:o1', 'cc:o1:a'], 'üst biter: ikisi birlikte bir an kalır');
  assert.deepEqual(bitenleriTut(new Map(), [], tutulan, t1 + BITEN_OMRU_MS + 1), []);
});
