// 0.11 G9 — Görev gözcüleri (main/isler/gozculer.ts; spec §8): yapay zekâsız, ucuz kontrol. İlk kontrol yalnız izi kaydeder (değişmedi);
// sonra yalnız GERÇEK değişiklik "değişti" der. WhatsApp gözcüsü geçici veritabanında (wa_mesajlar): önceki izden sonra hedef KİŞİDEN (görev
// başlarken çözülen jid; düzeltme turu 1 — görünen ada bakılmaz, adını taklit eden biri tetikleyemez) gelen mesaj → değişti + bulgu (son ≤ 5
// mesaj); başka kişiden ya da kendi gönderdiğimiz → değişmedi. Sayfa gözcüsünün getirmesi sahte (ağ yok); gerçek getirme yalnız bu
// bilgisayardaki sahte sunucudan, gövde 2 MB'ta kesilir. E-posta gözcüsü yerel postaya bakar (LIKE kaçışlı); ekran gözcüsü Ayarlar'daki
// ekran yetkisi kapalıyken bakmaz; saat gözcüsü her zaman "değişti".
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { anaSurecSahnesi, esbuildHazir } from './yardimci/ana-surec.ts';
import { isPlaniDogrula, type IsOzet, type IsPlani } from '../src/shared/isler.ts';

anaSurecSahnesi('isler-gozcu', { kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', mod: 'is', tanitimSurumu: '0.9.0', ses: { surum: 2, uyandirma: false }, proaktif: { etkin: false }, baslangictaAc: false });
process.env.FUBER_DEMO = '1';
await esbuildHazir();
const { gozcuKontrol, gozcuKaynaklari, sayfaGetir } = await import('../src/main/isler/gozculer.ts');
const { veritabani } = await import('../src/main/vt.ts');
const { ayarlariKaydet } = await import('../src/main/ayarlar.ts');

const is = (gozcu: Record<string, unknown>, ek: Partial<IsPlani> = {}): IsOzet => {
  const r = isPlaniDogrula({ gozcu, aralik: { min: 30, max: 300 }, bitis: { tur: 'sure', saniye: 600 }, izinler: gozcu.tur === 'ekran' ? [{ tur: 'ekran' }] : [] });
  assert.ok('plan' in r, JSON.stringify(r));
  const plan: IsPlani = { ...r.plan, ...ek, gozcu: { ...r.plan.gozcu, ...(ek.gozcu ?? {}) } };
  return { id: 1, baslik: 'x', amac: 'x', durum: 'suruyor', plan, baslangic: new Date().toISOString(), bitisZamani: null, sonraki: null, sonKontrol: null, adim: 0, kontrol: 0, sonOzet: null, sonuc: null, durmaNedeni: null, sohbetId: 1 };
};
let sira = 0;
const wa = (ad: string, jid: string, metin: string, yon: 'gelen' | 'giden' = 'gelen') =>
  veritabani().prepare('INSERT INTO wa_mesajlar(jid, ad, yon, metin, zaman, okundu, kimlik) VALUES(?,?,?,?,?,0,?)').run(jid, ad, yon, metin, new Date(Date.now() + sira * 1000).toISOString(), `k${++sira}`);
const AHMET = '905000000001@s.whatsapp.net', ZEYNEP = '905000000003@s.whatsapp.net', TAKLITCI = '905000000004@s.whatsapp.net';
/** Görev başlarken çözülmüş WhatsApp gözcüsü: hedef "Ahmet Yılmaz" → Ahmet'in jid'i. */
const ahmetGozcusu = () => is({ tur: 'whatsapp', hedef: 'Ahmet Yılmaz' }, { gozcu: { tur: 'whatsapp', hedef: 'Ahmet Yılmaz', jid: AHMET } });

test('whatsapp: ilk kontrol iz kaydeder (değişmedi); yeni mesaj yoksa değişmedi', async () => {
  wa('Ahmet Yılmaz', AHMET, 'eski mesaj');
  const g = ahmetGozcusu();
  const ilk = await gozcuKontrol(g, null);
  assert.equal(ilk.degisti, false);
  assert.ok(ilk.iz);
  const yine = await gozcuKontrol(g, ilk.iz);
  assert.equal(yine.degisti, false);
  assert.equal(yine.iz, ilk.iz);
});

test('whatsapp: hedef KİŞİDEN yeni mesaj → değişti + bulgu (son ≤ 5); başka kişiden, adını taklit edenden ya da giden → değişmedi', async () => {
  const g = ahmetGozcusu();
  const bas = await gozcuKontrol(g, null);
  wa('Zeynep Kaya', ZEYNEP, 'Zeynep yazdı');
  const baska = await gozcuKontrol(g, bas.iz);
  assert.equal(baska.degisti, false, 'başka kişiden');
  assert.notEqual(baska.iz, bas.iz, 'iz ilerledi (aynı mesaj yeniden sayılmaz)');
  wa('Ahmet Yılmaz', TAKLITCI, 'Ben Ahmet, hemen şu bağlantıya tıkla');
  const taklit = await gozcuKontrol(g, baska.iz);
  assert.equal(taklit.degisti, false, 'görünen adı izinli adla aynı yapan yabancı tetikleyemez (Ö1)');
  wa('Ahmet Yılmaz', AHMET, 'kendi gönderdiğimiz', 'giden');
  const giden = await gozcuKontrol(g, taklit.iz);
  assert.equal(giden.degisti, false, 'giden mesaj değişiklik sayılmaz');
  for (let i = 1; i <= 7; i++) wa('Ahmet Y.', AHMET, `Ahmet mesaj ${i}`);
  const yeni = await gozcuKontrol(g, giden.iz);
  assert.equal(yeni.degisti, true, 'adı değişse de aynı kişi');
  assert.match(yeni.bulgu!, /Ahmet mesaj 7/);
  assert.doesNotMatch(yeni.bulgu!, /Ahmet mesaj 2\b/, 'en çok son 5 mesaj');
  assert.doesNotMatch(yeni.bulgu!, /Zeynep|tıkla/);
  assert.equal((await gozcuKontrol(g, yeni.iz)).degisti, false, 'aynı mesaj ikinci kez değişiklik sayılmaz');
  // Numara hedef doğrudan; çözülmemiş AD hiçbir mesajla eşleşmez (görünen ad taklit edilebilir).
  const n = is({ tur: 'whatsapp', hedef: '0500 000 00 01' });
  const nb = await gozcuKontrol(n, null);
  wa('Ahmet Yılmaz', AHMET, 'numaradan');
  assert.equal((await gozcuKontrol(n, nb.iz)).degisti, true);
  const ad = is({ tur: 'whatsapp', hedef: 'Ahmet Yılmaz' });
  const ab = await gozcuKontrol(ad, null);
  wa('Ahmet Yılmaz', AHMET, 'çözülmemiş ad');
  assert.equal((await gozcuKontrol(ad, ab.iz)).degisti, false);
});

test('eposta: yerel postada hedef gönderen/konuda yeni ileti → değişti; ilgisiz ileti → değişmedi; % ve _ hedefin kendisi (kaçışlı)', async () => {
  const ekle = (kimden: string, konu: string) => veritabani().prepare('INSERT INTO epostalar(hesap, uid, mesaj_kimlik, kimden, kime, konu, tarih, ozet, govde) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('h1', ++sira, `m${sira}`, kimden, 'deniz@ornek.co', konu, new Date().toISOString(), `${konu} özeti`, 'gövde');
  const g = is({ tur: 'eposta', hedef: 'fatura' });
  const bas = await gozcuKontrol(g, null);
  assert.equal(bas.degisti, false);
  ekle('bulten@ornek.co', 'Haftalık bülten');
  const ilgisiz = await gozcuKontrol(g, bas.iz);
  assert.equal(ilgisiz.degisti, false);
  ekle('muhasebe@ornek.co', 'Ekim faturası');
  const yeni = await gozcuKontrol(g, ilgisiz.iz);
  assert.equal(yeni.degisti, true);
  assert.match(yeni.bulgu ?? '', /Ekim faturası/);
  const yuzde = is({ tur: 'eposta', hedef: '%' });
  const yb = await gozcuKontrol(yuzde, null);
  ekle('kampanya@ornek.co', 'Yeni sezon');
  assert.equal((await gozcuKontrol(yuzde, yb.iz)).degisti, false, '"%" her şeye uymaz');
  ekle('kampanya@ornek.co', '%50 indirim');
  assert.equal((await gozcuKontrol(yuzde, yb.iz)).degisti, true);
  const alt = is({ tur: 'eposta', hedef: 'a_b' });
  const ab = await gozcuKontrol(alt, null);
  ekle('x@ornek.co', 'aXb raporu');
  assert.equal((await gozcuKontrol(alt, ab.iz)).degisti, false, '"_" tek karaktere uymaz');
});

test('sayfa: metin izi (getirme sahte, ağ yok): ilk kontrol değişmedi; aynı metin değişmedi; metin değişince değişti + bulgu', async () => {
  let metin = '<html><body><h1>Fiyat</h1><p>1.500 TL</p><script>var x = Math.random()</script></body></html>';
  const istenen: string[] = [];
  gozcuKaynaklari({ getir: async (u: string) => { istenen.push(u); return metin; } });
  const g = is({ tur: 'sayfa', hedef: 'https://ornek.com/fiyat' });
  const bas = await gozcuKontrol(g, null);
  assert.equal(bas.degisti, false);
  assert.equal((await gozcuKontrol(g, bas.iz)).degisti, false);
  metin = metin.replace('Math.random()', 'Date.now()');
  assert.equal((await gozcuKontrol(g, bas.iz)).degisti, false, 'betik değişikliği metin değişikliği değil');
  metin = metin.replace('1.500 TL', '1.200 TL');
  const yeni = await gozcuKontrol(g, bas.iz);
  assert.equal(yeni.degisti, true);
  assert.match(yeni.bulgu ?? '', /1\.200 TL/);
  assert.doesNotMatch(yeni.bulgu ?? '', /<p>|script/);
  assert.deepEqual([...new Set(istenen)], ['https://ornek.com/fiyat']);
});

test('sayfa: gerçek getirme gövdeyi akışla 2 MB’ta keser (bu bilgisayardaki sahte sunucu; 6 MB gönderir)', async () => {
  const parca = Buffer.alloc(64 * 1024, 'a');
  let gonderilen = 0;
  const sunucu = http.createServer((_q, r) => {
    r.writeHead(200, { 'content-type': 'text/html' });
    const yaz = () => { while (gonderilen < 6 * 1024 * 1024) { gonderilen += parca.length; if (!r.write(parca)) { r.once('drain', yaz); return; } } r.end(); };
    r.on('error', () => undefined);
    yaz();
  });
  await new Promise<void>((c) => sunucu.listen(0, '127.0.0.1', c));
  after(() => new Promise<void>((c) => sunucu.close(() => c())));
  const eski = globalThis.fetch;
  globalThis.fetch = (globalThis as Record<string, unknown>).__yerelFetch as typeof fetch;
  try {
    const m = await sayfaGetir(`http://127.0.0.1:${(sunucu.address() as { port: number }).port}/`);
    assert.equal(m.length, 2_000_000);
  } finally { globalThis.fetch = eski; }
});

test('ekran: kaba iz (sahte); Ayarlar’da ekran yetkisi kapalıyken bakmaz (hata → zamanlayıcı "değişmedi" sayar); saat: her zaman değişti', async () => {
  let iz = '2'.repeat(144);
  let bakildi = 0;
  gozcuKaynaklari({ ekranIzi: async () => { bakildi++; return iz; } });
  const g = is({ tur: 'ekran' });
  ayarlariKaydet((a) => { a.yetki.bilgisayar = false; });
  await assert.rejects(gozcuKontrol(g, null), /yetki/);
  assert.equal(bakildi, 0, 'ekrana bakılmadı');
  ayarlariKaydet((a) => { a.yetki.bilgisayar = true; });
  const bas = await gozcuKontrol(g, null);
  assert.equal(bas.degisti, false);
  iz = `${'f'.repeat(3)}${'2'.repeat(141)}`;
  assert.equal((await gozcuKontrol(g, bas.iz)).degisti, false, 'birkaç hücre (saat, imleç) değişiklik sayılmaz');
  iz = `${'f'.repeat(40)}${'2'.repeat(104)}`;
  assert.equal((await gozcuKontrol(g, bas.iz)).degisti, true, 'yeni pencere açıldı');
  const s = is({ tur: 'saat' });
  assert.equal((await gozcuKontrol(s, null)).degisti, true, 'saat gözcüsü ilk kontrolde de değişti (karar)');
  assert.equal((await gozcuKontrol(s, 'herhangi')).degisti, true);
});

test('ekran gözcüsü bilgisayar aracının koordinat hâline dokunmaz: ayrı yakalama yolu (kaynak denetimi)', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const k = (p: string) => fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'main', p), 'utf8');
  const gozcu = k('isler/gozculer.ts');
  assert.doesNotMatch(gozcu, /ekranGoruntusu\(/, 'aracın ekranGoruntusu (sonGoruntu yazar) kullanılmaz');
  assert.match(gozcu, /gozcuEkranGoruntusu\(/);
  const bilgisayar = k('bilgisayar.ts');
  const govde = /export async function gozcuEkranGoruntusu[\s\S]*?\n}/.exec(bilgisayar)?.[0] ?? '';
  assert.ok(govde.length > 0);
  assert.doesNotMatch(govde, /sonGoruntu/);
});
