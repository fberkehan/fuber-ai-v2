// 0.11 G9 — Görevler zamanlayıcısı (main/isler/zamanlayici.ts; spec §8). Token harcamamak için 10 ya da 30 saniyelik aralar
// bırakarak kendi kendini tetikler; bir şeyin takibi istenince işe uygun aralıklar üretir.
// GERÇEK zamanlayıcı + depo + sohbet deposu; saat, zamanlayıcı (setTimeout), gözcü ve yapay zekâ adımı sahte (sayaçlı). Sınanır:
//  · değişiklik yokken yapay zekâ ÇAĞRILMAZ (0 çağrı), aralık ×1,5 uzar; değişince tam bir adım, aralık en kısaya döner;
//  · süre dolunca bitti + sonuç; adım sınırında bitti + durmaNedeni 'sinir'; üst üste 3 başarısız adımda 'hata' ve tek sakin cümle;
//  · acil durdurma hepsini durdurur, bekleyen zamanlayıcı kalmaz, geç biten adım sonucu yazılmaz; açılışta süren iş "kapanış" olur ve
//    kendiliğinden sürmez; aynı anda en çok 3 süren görev; ekran tek sahipli; Gizli/yerel yolda görevler durur, yeni görev başlamaz;
//  · zamanlayıcı tek setTimeout zinciridir (en yakın `sonraki`).
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { anaSurecSahnesi, esbuildHazir } from './yardimci/ana-surec.ts';
import { isPlaniDogrula, durmaMetni, type IsPlani } from '../src/shared/isler.ts';

anaSurecSahnesi('isler-zamanlayici', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', mod: 'is', tanitimSurumu: '0.9.0', ses: { surum: 2, uyandirma: false },
  proaktif: { etkin: false, sessizBaslangic: '00:00', sessizBitis: '00:00' }, baslangictaAc: false,
});
process.env.FUBER_DEMO = '1';
await esbuildHazir();
const Z = await import('../src/main/isler/zamanlayici.ts');
const { mesajlar, anaSohbet } = await import('../src/main/sohbet.ts');
const { veritabani } = await import('../src/main/vt.ts');
const { ayarlariKaydet } = await import('../src/main/ayarlar.ts');
const { testBildirimKaydi } = await import('../src/main/zamanlayici.ts');

// ── Sahte saat ve zamanlayıcı: kurulan her setTimeout kaydedilir; `ilerle` en yakınını çalıştırır ve süren işlerin bitmesini bekler ──
let saat = Date.parse('2026-10-28T08:00:00Z');
const zamanlar = new Set<{ f: () => void; at: number; ms?: number }>();
let enCokAyniAnda = 0;
// ── Sahte gözcü ve sahte yapay zekâ adımı (sayaçlı) ──
type AdimSonu = { ozet: string; bildir?: string; sonrakiSn?: number; bitti?: boolean; sonuc?: string } | null | 'ertele';
const gozcuCagrisi = new Map<number, number>();
const gozcuOnceki: (string | null)[] = [];
let gozcuDavranisi: (id: number, onceki: string | null) => { degisti: boolean; iz: string; bulgu?: string } = () => ({ degisti: false, iz: 'iz-0' });
let motor = 0;
const adimGirdileri: { id: number; bulgu?: string }[] = [];
let adimDavranisi: (id: number, sinyal: AbortSignal) => Promise<AdimSonu> = async () => ({ ozet: 'Bir adım yapıldı.' });
let yol: 'bulut' | 'yerel' | 'yok' = 'bulut';
let kullaniciEkranda = false;

Z.islerBagimliliklari({
  simdi: () => saat,
  kur: (f: () => void, ms: number) => { const h = { f, at: saat + Math.max(0, ms), ms }; zamanlar.add(h); enCokAyniAnda = Math.max(enCokAyniAnda, zamanlar.size); return h; },
  iptal: (h: unknown) => { zamanlar.delete(h as { f: () => void; at: number }); },
  gozcu: async (is, onceki) => { gozcuCagrisi.set(is.id, (gozcuCagrisi.get(is.id) ?? 0) + 1); gozcuOnceki.push(onceki); return gozcuDavranisi(is.id, onceki); },
  adim: async (is, bulgu, sinyal) => { motor++; adimGirdileri.push({ id: is.id, bulgu }); return adimDavranisi(is.id, sinyal); },
  yol: () => yol,
  kullaniciEkranda: () => kullaniciEkranda,
});
// Uygulamanın açılışı (main.ts): önceki oturumdan süren iş kalmadı.
Z.islerBaslat();
after(() => Z.tumIsleriDurdur('kapanis'));

async function ilerle(): Promise<boolean> {
  const h = [...zamanlar].sort((a, b) => a.at - b.at)[0];
  if (!h) return false;
  zamanlar.delete(h);
  saat = Math.max(saat, h.at);
  h.f();
  await Z._test.bosta();
  return true;
}
const plan = (ek: Record<string, unknown> = {}): IsPlani => {
  const r = isPlaniDogrula({ gozcu: { tur: 'whatsapp', hedef: 'Ahmet' }, aralik: { min: 10, max: 120 }, bitis: { tur: 'sure', saniye: 3600 }, izinler: [], azamiAdim: 60, ...ek }, new Date(saat));
  assert.ok('plan' in r, JSON.stringify(r));
  return r.plan;
};
const baslat = (baslik: string, ek: Record<string, unknown> = {}) => {
  const r = Z.isBaslat({ baslik, amac: `${baslik} — amaç`, plan: plan(ek) });
  assert.ok('is' in r, JSON.stringify(r));
  return r.is.id;
};
const is = (id: number) => { const k = Z.isListesi().find((x) => x.id === id); assert.ok(k, `iş #${id} listede yok`); return k; };
const kalanSn = (id: number) => (Date.parse(is(id).sonraki!) - saat) / 1000;
/** Her senaryo temiz başlar: süren iş yok, sahteler varsayılan. */
const temizle = () => {
  Z.tumIsleriDurdur('kapanis');
  veritabani().prepare('DELETE FROM isler').run();
  zamanlar.clear();
  gozcuDavranisi = () => ({ degisti: false, iz: 'iz-0' });
  adimDavranisi = async () => ({ ozet: 'Bir adım yapıldı.' });
  yol = 'bulut';
  kullaniciEkranda = false;
};

test('gözcü 5 kez (ve ilk kontrol) "değişmedi" → yapay zekâ 0 kez çağrılır, aralıklar artar (×1,5, en çok max)', async () => {
  temizle();
  const once = motor;
  const id = baslat('Ahmet’i takip et');
  assert.equal(zamanlar.size, 1, 'başlar başlamaz ilk kontrol kurulur');
  const araliklar: number[] = [];
  for (let i = 0; i < 6; i++) { assert.ok(await ilerle()); araliklar.push(kalanSn(id)); }
  assert.deepEqual(araliklar, [15, 23, 35, 53, 80, 120]);
  assert.equal(motor - once, 0, 'değişiklik yokken yapay zekâ çağrılmadı');
  assert.equal(is(id).kontrol, 6);
  assert.equal(is(id).adim, 0);
  assert.ok(is(id).sonKontrol);
  // "Değişti": tam bir adım, aralık en kısaya döner; bulgu adıma gider.
  gozcuDavranisi = () => ({ degisti: true, iz: 'iz-1', bulgu: 'Ahmet: Toplantı 15:00’te.' });
  await ilerle();
  assert.equal(motor - once, 1, 'tam bir adım');
  assert.equal(adimGirdileri.at(-1)?.bulgu, 'Ahmet: Toplantı 15:00’te.');
  assert.equal(is(id).adim, 1);
  assert.equal(is(id).sonOzet, 'Bir adım yapıldı.');
  assert.equal(kalanSn(id), 10, 'aralık en kısaya döndü');
  gozcuDavranisi = () => ({ degisti: false, iz: 'iz-1' });
  await ilerle();
  assert.equal(motor - once, 1, 'yeniden değişmedi: çağrı yok');
  assert.equal(kalanSn(id), 15);
  assert.ok(enCokAyniAnda <= 1, 'tek setTimeout zinciri');
});

test('yapay zekânın önerdiği aralık plan sınırlarına kırpılarak kullanılır; "bildir" ana sohbete tek satır ve bildirim olur', async () => {
  temizle();
  const id = baslat('Fiyatı izle');
  gozcuDavranisi = () => ({ degisti: true, iz: 'iz-2' });
  adimDavranisi = async () => ({ ozet: 'Fiyat düştü.', bildir: 'Fiyat\n1.200 TL’ye düştü.', sonrakiSn: 5 });
  const ana = anaSohbet();
  const anaOnce = mesajlar(ana).length, bildirimOnce = testBildirimKaydi().length;
  await ilerle();
  assert.equal(kalanSn(id), 10, 'öneri 5 → en kısa 10');
  const yeni = mesajlar(ana).slice(anaOnce);
  assert.equal(yeni.length, 1);
  assert.equal(yeni[0].rol, 'assistant');
  assert.match(yeni[0].metin, /Fiyatı izle/);
  assert.match(yeni[0].metin, /Fiyat 1\.200 TL’ye düştü\./, 'tek satır');
  assert.equal(testBildirimKaydi().length, bildirimOnce + 1);
  adimDavranisi = async () => ({ ozet: 'Bekliyorum.', sonrakiSn: 90 });
  await ilerle();
  assert.equal(kalanSn(id), 90);
});

test('süre dolunca görev biter (durum bitti), sonuç yazılır, bekleyen zamanlayıcı kalmaz', async () => {
  temizle();
  const bas = saat;
  const id = baslat('Üç dakika bak', { bitis: { tur: 'sure', saniye: 60 }, aralik: { min: 10, max: 60 } });
  for (let i = 0; i < 20 && (await ilerle()); i++) { /* süre dolana dek */ }
  const k = is(id);
  assert.equal(k.durum, 'bitti');
  assert.equal(k.durmaNedeni, null);
  assert.ok(k.sonuc && k.sonuc.length > 0, 'sonuç yazıldı');
  assert.ok(saat - bas >= 60_000 && saat - bas < 70_000, `tam bitişte uyandı: ${(saat - bas) / 1000} sn`);
  assert.equal(k.sonraki, null);
  assert.equal(zamanlar.size, 0);
  assert.ok(mesajlar(anaSohbet()).some((m) => m.rol === 'assistant' && m.metin.includes('Üç dakika bak')), 'bitince sonuç ana sohbete');
});

test('adım sınırı (azamiAdim) dolunca bitti + durmaNedeni "sinir"; fazladan çağrı yok', async () => {
  temizle();
  const once = motor;
  gozcuDavranisi = () => ({ degisti: true, iz: `iz-${saat}` });
  const id = baslat('İki adımlık iş', { azamiAdim: 2 });
  for (let i = 0; i < 10 && (await ilerle()); i++) { /* sınır dolana dek */ }
  assert.equal(motor - once, 2);
  assert.equal(is(id).durum, 'bitti');
  assert.equal(is(id).durmaNedeni, 'sinir');
  assert.equal(is(id).adim, 2);
  assert.equal(zamanlar.size, 0);
});

test('yapay zekâ "bitti" derse görev biter, sonuç onun cümlesi', async () => {
  temizle();
  gozcuDavranisi = () => ({ degisti: true, iz: 'iz-3' });
  adimDavranisi = async () => ({ ozet: 'Ahmet yanıtladı.', bitti: true, sonuc: 'Ahmet toplantıyı 15:00’e aldı.' });
  const id = baslat('Ahmet yanıtlayınca söyle');
  await ilerle();
  assert.equal(is(id).durum, 'bitti');
  assert.equal(is(id).sonuc, 'Ahmet toplantıyı 15:00’e aldı.');
  assert.equal(zamanlar.size, 0);
});

test('acil durdurma: bütün görevler durur (acil), bekleyen zamanlayıcı kalmaz; o sırada süren adımın geç sonucu yazılmaz', async () => {
  temizle();
  const a = baslat('Birinci iş');
  const b = baslat('İkinci iş');
  assert.equal(zamanlar.size, 1, 'iki iş, tek zamanlayıcı');
  const cozler: ((v: { ozet: string; bildir?: string }) => void)[] = [];
  gozcuDavranisi = () => ({ degisti: true, iz: 'iz-4' });
  adimDavranisi = () => new Promise((c) => { cozler.push(c); });
  const h = [...zamanlar][0];
  zamanlar.delete(h);
  h.f();
  for (let i = 0; i < 50 && cozler.length < 2; i++) await new Promise((c) => setImmediate(c));
  assert.equal(cozler.length, 2, 'iki adım sürüyor');
  const anaOnce = mesajlar(anaSohbet()).length;
  assert.equal(Z.tumIsleriDurdur('acil'), 2);
  for (const coz of cozler) coz({ ozet: 'Geç kalan adım.', bildir: 'GEC-KALAN-BILDIRIM' });
  await Z._test.bosta();
  for (const id of [a, b]) {
    assert.equal(is(id).durum, 'durdu');
    assert.equal(is(id).durmaNedeni, 'acil');
    assert.equal(is(id).adim, 0, 'geç sonuç sayılmadı');
    assert.equal(is(id).sonraki, null);
  }
  assert.equal(zamanlar.size, 0, 'bekleyen zamanlayıcı yok');
  assert.equal(Z._test.bekleyenZamanlayici(), false);
  assert.ok(!mesajlar(anaSohbet()).slice(anaOnce).some((m) => m.metin.includes('GEC-KALAN-BILDIRIM')));
  assert.equal(await ilerle(), false);
});

test('açılış (islerBaslat): süren iş durdu + "kapanis" olur ve kendiliğinden sürmez; "Sürdür" ile yeniden başlar', async () => {
  temizle();
  const id = baslat('Kapanışta süren iş');
  const kontrolOnce = gozcuCagrisi.get(id) ?? 0;
  Z.islerBaslat();
  assert.equal(is(id).durum, 'durdu');
  assert.equal(is(id).durmaNedeni, 'kapanis');
  assert.equal(zamanlar.size, 0);
  saat += 3_600_000;
  assert.equal(await ilerle(), false, 'kendiliğinden sürmez');
  assert.equal(gozcuCagrisi.get(id) ?? 0, kontrolOnce);
  assert.ok(mesajlar(is(id).sohbetId).some((m) => m.rol === 'not' && /kapandığı için/.test(m.metin)));
  const s = Z.isSurdur(id);
  assert.ok('is' in s, JSON.stringify(s));
  assert.equal(is(id).durum, 'suruyor');
  assert.equal(is(id).durmaNedeni, null);
  await ilerle();
  assert.equal(gozcuCagrisi.get(id), kontrolOnce + 1);
});

test('aynı anda en çok 3 süren görev: dördüncüsü (başlatma da sürdürme de) reddedilir', () => {
  temizle();
  baslat('Bir'); baslat('İki'); baslat('Üç');
  const r = Z.isBaslat({ baslik: 'Dört', amac: 'x', plan: plan() });
  assert.ok('hata' in r);
  assert.match(r.hata, /3/);
  assert.equal(Z.isListesi().filter((k) => k.durum === 'suruyor').length, 3);
  const durdurulan = Z.isListesi().find((k) => k.baslik === 'Bir')!;
  Z.isDurdur(durdurulan.id, 'kullanici');
  assert.equal(is(durdurulan.id).durmaNedeni, 'kullanici');
  assert.ok('is' in Z.isBaslat({ baslik: 'Dört', amac: 'x', plan: plan() }));
  const s = Z.isSurdur(durdurulan.id);
  assert.ok('hata' in s, 'üç süren varken sürdürülemez');
});

test('ekran tek sahipli: iki iş aynı anda ekranAl → yalnız biri; kullanıcı kendi turunda ekranı kullanıyorsa kimse alamaz', async () => {
  temizle();
  assert.equal(Z.ekranAl(101), true);
  assert.equal(Z.ekranAl(102), false);
  assert.equal(Z.ekranAl(101), true, 'sahibi yeniden alabilir');
  Z.ekranBirak(102);
  assert.equal(Z.ekranAl(102), false, 'sahibi olmayan bırakamaz');
  Z.ekranBirak(101);
  assert.equal(Z.ekranAl(102), true);
  Z.ekranBirak(102);
  kullaniciEkranda = true;
  assert.equal(Z.ekranAl(103), false);
  kullaniciEkranda = false;
  // Ekran izni olan görevin adımı ekranı başka biri tutarken BEKLER (yapay zekâ çağrılmaz, en kısa aralıkta yeniden dener).
  const once = motor;
  gozcuDavranisi = () => ({ degisti: true, iz: 'iz-5' });
  const id = baslat('Ekranla iş', { izinler: [{ tur: 'ekran' }] });
  assert.equal(Z.ekranAl(999), true);
  await ilerle();
  assert.equal(motor - once, 0, 'ekran başkasında: adım bekledi');
  assert.equal(kalanSn(id), 10);
  Z.ekranBirak(999);
  await ilerle();
  assert.equal(motor - once, 1);
  assert.equal(Z.ekranAl(999), true, 'adım bitince ekran bırakıldı');
  Z.ekranBirak(999);
});

test('üst üste 3 başarısız adım (ör. yanıt iç talimatı yankıladı) → görev "hata", tek sakin cümle; adım sayılmaz, aralık "değişmedi" gibi uzar', async () => {
  temizle();
  const once = motor;
  gozcuDavranisi = () => ({ degisti: true, iz: 'iz-6' });
  adimDavranisi = async () => null;
  const ana = anaSohbet();
  const anaOnce = mesajlar(ana).length, bildirimOnce = testBildirimKaydi().length;
  const id = baslat('Başarısız iş');
  await ilerle();
  assert.equal(kalanSn(id), 15, 'başarısız adım: aralık değişmedi gibi uzar');
  assert.equal(is(id).adim, 0);
  assert.equal(is(id).durum, 'suruyor');
  await ilerle();
  await ilerle();
  assert.equal(motor - once, 3);
  assert.equal(is(id).durum, 'hata');
  assert.equal(is(id).durmaNedeni, 'hata');
  assert.equal(is(id).adim, 0);
  assert.equal(zamanlar.size, 0);
  const notlar = mesajlar(is(id).sohbetId).filter((m) => m.rol === 'not');
  assert.equal(notlar.length, 1, JSON.stringify(notlar));
  assert.equal(notlar[0].metin.split(/[.!?](\s|$)/).filter((s) => s && s.trim()).length, 1, `tek cümle: ${notlar[0].metin}`);
  assert.equal(mesajlar(ana).length, anaOnce, 'ana sohbete bir şey yazılmadı');
  assert.equal(testBildirimKaydi().length, bildirimOnce, 'bildirim yok');
});

test('kullanıcı durdurur: durdu + "kullanici"; sürmekte olan zincirden düşer', async () => {
  temizle();
  const id = baslat('Durdurulacak iş');
  Z.isDurdur(id, 'kullanici');
  assert.equal(is(id).durum, 'durdu');
  assert.equal(is(id).durmaNedeni, 'kullanici');
  assert.equal(await ilerle(), false);
});

test('Gizli açılırsa süren görevler durur (durmaNedeni "gizli"), not yazılır; yeni görev ve sürdürme Gizli’yi söyleyerek reddedilir', async () => {
  temizle();
  const id = baslat('Gizli’de duracak iş');
  yol = 'yerel';
  ayarlariKaydet((a) => { a.yerel.gizliMod = true; });
  try {
    assert.equal(is(id).durum, 'durdu');
    assert.equal(is(id).durmaNedeni, 'gizli');
    assert.ok(mesajlar(is(id).sohbetId).some((m) => m.rol === 'not' && m.metin === durmaMetni('gizli')));
    const r = Z.isBaslat({ baslik: 'Yeni', amac: 'x', plan: plan() });
    assert.ok('hata' in r);
    assert.equal(r.hata, 'Gizli modda görevler çalışmaz.');
    const s = Z.isSurdur(id);
    assert.ok('hata' in s);
    assert.equal(s.hata, 'Gizli modda görevler çalışmaz.', 'Sürdür reddi gerçek nedeni söyler');
    assert.equal(zamanlar.size, 0);
  } finally {
    ayarlariKaydet((a) => { a.yerel.gizliMod = false; });
    yol = 'bulut';
  }
  // Gizli hazır değilken de (yol "yok") neden Gizli'dir.
  const id3 = baslat('Gizli hazırlanırken duracak iş');
  yol = 'yok';
  ayarlariKaydet((a) => { a.yerel.gizliMod = true; });
  try {
    assert.equal(is(id3).durmaNedeni, 'gizli');
  } finally {
    ayarlariKaydet((a) => { a.yerel.gizliMod = false; });
    yol = 'bulut';
  }
});

// Son inceleme I1: yol Gizli DIŞINDA yalnız bu bilgisayardaki yapay zekâ olunca (Geliştirici'nin "yalnız bu bilgisayar" anahtarı ya da bulut hesabı
// kullanılamazken kurulu yerel yapay zekâ) eskiden de 'gizli' yazılıyor, kart/Etkinlik "Gizli mod açıldı" diyordu. Gerçek neden 'yerel'.
test('I1: Gizli kapalıyken yol yerele dönerse görev "yerel" nedeniyle durur — not, Etkinlik ve Sürdür reddi Gizli demez, gerçek nedeni söyler', async () => {
  temizle();
  const { anaDinle } = await import('../src/main/olaylar.ts');
  type Olay = { olay: string; id?: number; baslik?: string; neden?: string };
  const olaylar: Olay[] = [];
  const birak = anaDinle<{ tur: string; gorev?: Olay }>('beyin:olay', (o) => { if (o.tur === 'gorev' && o.gorev) olaylar.push(o.gorev); });
  try {
    // Ayar dinleyicisi yolu (ör. kullanım hakkı doldu; ayar değişikliği yayınlanır).
    const id = baslat('Yerel yolda duracak iş');
    yol = 'yerel';
    ayarlariKaydet((a) => { a.yerel.gizliMod = false; });
    assert.equal(is(id).durum, 'durdu');
    assert.equal(is(id).durmaNedeni, 'yerel');
    assert.ok(mesajlar(is(id).sohbetId).some((m) => m.rol === 'not' && m.metin === durmaMetni('yerel')), 'görev sohbetindeki not nötr');
    assert.deepEqual(olaylar.at(-1), { olay: 'durdu', id, baslik: 'Yerel yolda duracak iş', neden: 'yerel' }, 'Etkinlik olayı gerçek nedeni taşır');
    const s = Z.isSurdur(id);
    assert.ok('hata' in s);
    assert.equal(s.hata, 'Yapay zekâ şu an yalnız bu bilgisayarda çalıştığı için görevler çalışmaz.', 'Sürdür reddi gerçek nedeni söyler');
    assert.doesNotMatch(s.hata, /Gizli/);
    const r = Z.isBaslat({ baslik: 'Yeni', amac: 'x', plan: plan() });
    assert.ok('hata' in r && r.hata === s.hata);
    assert.equal(zamanlar.size, 0);
    yol = 'bulut';
    // Yol tik anında yerelse (ayar dinleyicisinden önce) tik de durdurur — yine 'yerel'.
    const id2 = baslat('Tikte yerelde duracak iş');
    yol = 'yerel';
    await ilerle();
    assert.equal(is(id2).durum, 'durdu');
    assert.equal(is(id2).durmaNedeni, 'yerel');
    // Yol buluta dönünce sürdürülür.
    yol = 'bulut';
    assert.ok('is' in Z.isSurdur(id2));
  } finally { birak(); yol = 'bulut'; }
});

// ── Düzeltme turu 1 ──
test('Ö4: gözcü hatası izi değiştirmez — ilk kontrol hata verirse sonraki başarılı kontrol yalnız izi kaydeder ("değişti" değil)', async () => {
  temizle();
  const once = motor;
  let hata = true;
  gozcuDavranisi = (_id, onceki) => {
    if (hata) throw new Error('ağ yok');
    return onceki === null ? { degisti: false, iz: 'iz-ilk' } : { degisti: true, iz: 'iz-yeni' };
  };
  gozcuOnceki.length = 0;
  const id = baslat('Çevrimdışı başlayan iş');
  await ilerle();
  assert.equal(is(id).durum, 'suruyor');
  assert.equal(kalanSn(id), 15, 'hata "değişmedi" sayılır');
  hata = false;
  await ilerle();
  assert.deepEqual(gozcuOnceki, [null, null], 'ikinci kontrole de önceki iz null gitti');
  assert.equal(motor - once, 0, 'yapay zekâ çağrılmadı');
  const k = (await import('../src/main/isler/depo.ts')).isGetir(id)!;
  assert.equal(k.iz, 'iz-ilk');
});

test('Ö3: ekran gözcüsü ekran kullanımdayken (kullanıcının ya da başka görevin turu) bakmaz: "değişmedi", iz aynen', async () => {
  temizle();
  gozcuDavranisi = () => ({ degisti: false, iz: 'iz-ekran' });
  const id = baslat('Ekranı izle', { gozcu: { tur: 'ekran' }, izinler: [{ tur: 'ekran' }] });
  const bakis = () => gozcuCagrisi.get(id) ?? 0;
  const once = bakis();
  kullaniciEkranda = true;
  await ilerle();
  assert.equal(bakis() - once, 0, 'kullanıcının turu ekranı kullanıyor: bakılmadı');
  assert.equal(is(id).kontrol, 1);
  assert.equal(kalanSn(id), 15);
  kullaniciEkranda = false;
  assert.equal(Z.ekranAl(777), true);
  await ilerle();
  assert.equal(bakis() - once, 0, 'başka görev ekranı tutuyor: bakılmadı');
  Z.ekranBirak(777);
  await ilerle();
  assert.equal(bakis() - once, 1);
});

test('Ö5: acil durdurma veritabanı yazımı hata verse de bütün görevleri durdurur; zamanlayıcı kalmaz ve görevler zincire geri dönmez', async () => {
  temizle();
  const a = baslat('Acil A');
  const b = baslat('Acil B');
  const vt = veritabani();
  vt.exec("CREATE TRIGGER test_yazilamaz BEFORE UPDATE ON isler BEGIN SELECT RAISE(ABORT, 'test: disk dolu'); END;");
  try {
    assert.equal(Z.tumIsleriDurdur('acil'), 2, 'iki görev de durduruldu (kayıt yazılamasa da)');
    assert.equal(zamanlar.size, 0);
    assert.equal(Z._test.bekleyenZamanlayici(), false);
  } finally { vt.exec('DROP TRIGGER test_yazilamaz'); }
  const kontrolOnce = (gozcuCagrisi.get(a) ?? 0) + (gozcuCagrisi.get(b) ?? 0);
  Z._test.planla();
  baslat('Sonraki iş');
  for (let i = 0; i < 4; i++) await ilerle();
  assert.equal((gozcuCagrisi.get(a) ?? 0) + (gozcuCagrisi.get(b) ?? 0), kontrolOnce, 'bellekte durdurulan görevler bir daha çalışmadı');
  // main.ts acilDurdur: önce bellekteki turlar, görevlerin durdurulması korumalı (kaynak denetimi).
  const fs = await import('node:fs');
  const path = await import('node:path');
  const main = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'main', 'main.ts'), 'utf8');
  const govde = /function acilDurdur\(\): void \{[\s\S]*?\n\}/.exec(main)?.[0] ?? '';
  assert.ok(govde.indexOf('hepsiniDurdur()') >= 0 && govde.indexOf('hepsiniDurdur()') < govde.indexOf("tumIsleriDurdur('acil')"), govde);
  assert.match(govde, /try \{ n \+= tumIsleriDurdur\('acil'\); \} catch/);
});

test('#10: isCalistir’da beklenmeyen istisna → geri çekilir (10 sn × 2^n; 0 ms’de dönmez), art arda 3’te görev "hata" + tek sakin cümle', async () => {
  temizle();
  const id = baslat('Yazılamayan iş');
  const vt = veritabani();
  vt.exec("CREATE TRIGGER test_sonraki BEFORE UPDATE OF sonraki ON isler WHEN NEW.durum = 'suruyor' BEGIN SELECT RAISE(ABORT, 'test: yazılamadı'); END;");
  try {
    await ilerle();
    const bekleme = () => [...zamanlar].map((h) => h.at - saat);
    assert.deepEqual(bekleme(), [20_000], 'ilk istisna: 20 sn sonra');
    await ilerle();
    assert.deepEqual(bekleme(), [40_000], 'ikinci: 40 sn sonra');
    await ilerle();
    assert.equal(zamanlar.size, 0);
  } finally { vt.exec('DROP TRIGGER test_sonraki'); }
  assert.equal(is(id).durum, 'hata');
  assert.equal(is(id).durmaNedeni, 'hata');
  assert.deepEqual(mesajlar(is(id).sohbetId).filter((m) => m.rol === 'not').map((m) => m.metin), [durmaMetni('hata')]);
});

test('N1 (düzeltme turu 2): en kısa aralık büyükken istisna sonrası geri çekilme bitişi geciktirmez — görev planlanan bitişte "bitti"', async () => {
  temizle();
  const bas = saat;
  const id = baslat('Uzun aralıklı iş', { aralik: { min: 600, max: 3600 }, bitis: { tur: 'sure', saniye: 900 } });
  const vt = veritabani();
  vt.exec("CREATE TRIGGER test_n1 BEFORE UPDATE OF sonraki ON isler WHEN NEW.durum = 'suruyor' BEGIN SELECT RAISE(ABORT, 'test: yazılamadı'); END;");
  try {
    await ilerle(); // istisna: geri çekilme 600 sn × 2 = 1200 sn (bitişten sonra)
    assert.deepEqual([...zamanlar].map((h) => h.at - bas), [900_000], 'uyanış planlanan bitişe kırpıldı');
    await ilerle();
  } finally { vt.exec('DROP TRIGGER test_n1'); }
  assert.equal(is(id).durum, 'bitti');
  assert.equal(saat - bas, 900_000, 'tam bitişte');
});

test('N2 (düzeltme turu 2): görev listesi okunamazsa zincir ölmez — 30 sn sonra yeniden kurulur', async () => {
  temizle();
  const id = baslat('Okunamayan liste işi');
  const once = gozcuCagrisi.get(id) ?? 0;
  const vt = veritabani();
  vt.exec('ALTER TABLE isler RENAME TO isler_test_yedek');
  try {
    Z._test.planla();
    assert.deepEqual([...zamanlar].map((h) => h.ms), [30_000], 'yeniden deneme kuruldu');
    assert.equal(Z._test.bekleyenZamanlayici(), true);
  } finally { vt.exec('ALTER TABLE isler_test_yedek RENAME TO isler'); }
  await ilerle(); // yeniden deneme: zincir görevin uyanışına kurulur
  await ilerle();
  assert.equal((gozcuCagrisi.get(id) ?? 0) - once, 1, 'görev yine çalıştı');
});

test('#11: durdur → sürdür sırasında eski adımın sonucu yeni çalışmaya uygulanmaz (kuşak)', async () => {
  temizle();
  const cozler: ((v: AdimSonu) => void)[] = [];
  gozcuDavranisi = () => ({ degisti: true, iz: 'iz-k' });
  adimDavranisi = () => new Promise((c) => { cozler.push(c); });
  const id = baslat('Kuşak işi');
  const h = [...zamanlar][0];
  zamanlar.delete(h);
  saat = Math.max(saat, h.at);
  h.f();
  for (let i = 0; i < 50 && !cozler.length; i++) await new Promise((c) => setImmediate(c));
  Z.isDurdur(id, 'kullanici');
  assert.ok('is' in Z.isSurdur(id));
  const sonraki = is(id).sonraki;
  cozler[0](null);
  await Z._test.bosta();
  assert.equal(is(id).durum, 'suruyor');
  assert.equal((await import('../src/main/isler/depo.ts')).isGetir(id)!.basarisiz, 0, 'eski adımın başarısızlığı sayılmadı');
  assert.equal(is(id).sonraki, sonraki, 'sürdürmenin planı ezilmedi');
  adimDavranisi = async () => ({ ozet: 'Yeni kuşak adımı.' });
  await ilerle();
  assert.equal(is(id).adim, 1);
});

test('#7: kullanıcı kendi turunda ekranı kullanmaya başlarsa ekranı tutan adım kesilir — başarısız sayılmaz, görev sürer', async () => {
  temizle();
  let kesildi = false;
  gozcuDavranisi = () => ({ degisti: true, iz: 'iz-e' });
  adimDavranisi = (_id, sinyal) => new Promise((c) => { sinyal.addEventListener('abort', () => { kesildi = true; c('ertele'); }, { once: true }); });
  const id = baslat('Ekranla çalışan iş', { izinler: [{ tur: 'ekran' }] });
  const once = motor;
  const h = [...zamanlar][0];
  zamanlar.delete(h);
  saat = Math.max(saat, h.at);
  h.f();
  for (let i = 0; i < 50 && motor === once; i++) await new Promise((c) => setImmediate(c));
  assert.equal(motor - once, 1, 'adım sürüyor');
  assert.equal(Z.ekranAl(-1), false, 'adım ekranı tutuyor');
  Z.kullaniciEkranaGecti();
  await Z._test.bosta();
  assert.equal(kesildi, true);
  const k = (await import('../src/main/isler/depo.ts')).isGetir(id)!;
  assert.equal(k.durum, 'suruyor');
  assert.equal(k.basarisiz, 0);
  assert.equal(k.iz, null, 'iz ilerlemedi: değişiklik yeniden ele alınır');
  assert.equal(kalanSn(id), 10, 'kısa süre sonra yeniden');
  assert.equal(Z.ekranAl(-1), true, 'ekran bırakıldı');
  Z.ekranBirak(-1);
  // dongu.ts: kullanıcının kendi turu bilgisayar aracını çalıştırınca dinleyici çağrılır (kaynak denetimi).
  const fs = await import('node:fs');
  const path = await import('node:path');
  assert.match(fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'main', 'ajan', 'dongu.ts'), 'utf8'), /if \(arac\.grup === 'bilgisayar' && !izinli\) \{ ekranKullanicida\.add\(b\.sohbetId\); ekranaGecti\(\); \}/);
});

test('#14: adım ertelenirse (kullanıcı görev sohbetinde yazışıyor) başarısız sayılmaz, iz ilerlemez, kısa süre sonra yeniden denenir', async () => {
  temizle();
  gozcuDavranisi = () => ({ degisti: true, iz: 'iz-m' });
  adimDavranisi = async () => 'ertele';
  const id = baslat('Meşgul sohbetli iş');
  await ilerle();
  const k = (await import('../src/main/isler/depo.ts')).isGetir(id)!;
  assert.equal(k.basarisiz, 0);
  assert.equal(k.adim, 0);
  assert.equal(k.iz, null);
  assert.equal(kalanSn(id), 10);
  adimDavranisi = async () => ({ ozet: 'Şimdi yapıldı.' });
  await ilerle();
  assert.equal(is(id).adim, 1);
});

test('#15: "bildir" ile "bitti" (ya da adım sınırı) aynı adımdaysa ana sohbete TEK satır, TEK bildirim; bitişte izinle yapılan gönderimler deterministik satırla', async () => {
  temizle();
  const ana = anaSohbet();
  gozcuDavranisi = () => ({ degisti: true, iz: `iz-${saat}` });
  adimDavranisi = async () => ({ ozet: 'Ahmet yanıtladı.', bildir: 'Ahmet toplantıyı onayladı.', bitti: true, sonuc: 'Toplantı 15:00’te.' });
  let anaOnce = mesajlar(ana).length, bildirimOnce = testBildirimKaydi().length;
  const id = baslat('Tek satır işi');
  (await import('../src/main/isler/depo.ts')).gonderimEkle(id, { alici: 'Ahmet Yılmaz', kanal: 'WhatsApp', zaman: new Date(2026, 9, 28, 9, 5).toISOString() });
  await ilerle();
  let yeni = mesajlar(ana).slice(anaOnce);
  assert.equal(yeni.length, 1, JSON.stringify(yeni.map((m) => m.metin)));
  assert.equal(testBildirimKaydi().length - bildirimOnce, 1);
  assert.equal(yeni[0].metin, 'Görev bitti · Tek satır işi: Toplantı 15:00’te.\nGönderilenler: Ahmet Yılmaz (WhatsApp, 09:05)');
  assert.equal(is(id).durum, 'bitti');
  // Adım sınırıyla biten adımın bildirimi de bitiş satırının içinde.
  adimDavranisi = async () => ({ ozet: 'Bakıldı.', bildir: 'Fiyat düştü.' });
  anaOnce = mesajlar(ana).length; bildirimOnce = testBildirimKaydi().length;
  const id2 = baslat('Tek adımlık iş', { azamiAdim: 1 });
  await ilerle();
  yeni = mesajlar(ana).slice(anaOnce);
  assert.equal(yeni.length, 1);
  assert.match(yeni[0].metin, /^Görev bitti · Tek adımlık iş: Fiyat düştü\. Uzun bir işti; belirlenen adım sayısı doldu, burada durdu\.$/);
  assert.equal(testBildirimKaydi().length - bildirimOnce, 1);
  assert.equal(is(id2).durmaNedeni, 'sinir');
});

test('görev sohbeti: tür "gorev", başlık "Görev · …"; başlangıçta "başladım" yazılır (yapay zekâ çağrılmadan)', () => {
  temizle();
  const once = motor;
  const id = baslat('Sohbetli iş');
  const s = veritabani().prepare('SELECT baslik, tur FROM sohbetler WHERE id = ?').get(is(id).sohbetId) as { baslik: string; tur: string };
  assert.equal(s.tur, 'gorev');
  assert.equal(s.baslik, 'Görev · Sohbetli iş');
  const ilk = mesajlar(is(id).sohbetId);
  assert.ok(ilk.length >= 1 && /Başladım/.test(ilk[0].metin), JSON.stringify(ilk));
  assert.equal(motor, once);
});

// ── G10: arayüzün ihtiyacı olan iki alan (gonderim, adimda) ve Etkinlik akışı olayları ──────────────────────────────────────────────────────

test('G10: IsOzet.gonderim = izinle yapılan gönderim sayısı (Görevler kartının "N gönderim" rozeti); alıcı ya da metin arayüze taşınmaz', async () => {
  temizle();
  const id = baslat('Gönderimli iş');
  assert.equal(is(id).gonderim, 0);
  const { gonderimEkle } = await import('../src/main/isler/depo.ts');
  gonderimEkle(id, { alici: 'Ahmet Yılmaz', kanal: 'WhatsApp', zaman: new Date(saat).toISOString() });
  gonderimEkle(id, { alici: 'ece@ornek.co', kanal: 'e-posta', zaman: new Date(saat).toISOString() });
  assert.equal(is(id).gonderim, 2);
  assert.ok(!JSON.stringify(Z.isListesi()).includes('ece@ornek.co'), 'alıcı IsOzet’te yok');
});

test('G10: IsOzet.adimda yalnız yapay zekâ adımı sürerken true (gözcü kontrolünde değil); durum olayı adım BAŞLARKEN de yayınlanır', async () => {
  temizle();
  const { anaDinle } = await import('../src/main/olaylar.ts');
  const gorulen: { adimda: boolean | undefined }[] = [];
  const birak = anaDinle<{ id: number; adimda?: boolean }[]>('isler:durum', (l) => { for (const k of l) gorulen.push({ adimda: k.adimda }); });
  try {
    const id = baslat('Adımda mı iş');
    await ilerle(); // gözcü: değişmedi
    assert.equal(is(id).adimda, false, 'kontrol adım değildir');
    assert.ok(gorulen.every((g) => !g.adimda));
    const cozler: ((v: { ozet: string }) => void)[] = [];
    gozcuDavranisi = () => ({ degisti: true, iz: 'iz-g10' });
    adimDavranisi = () => new Promise((c) => { cozler.push(c); });
    const h = [...zamanlar][0];
    zamanlar.delete(h);
    saat = Math.max(saat, h.at); // görevin sırası geldi
    h.f();
    for (let i = 0; i < 50 && cozler.length < 1; i++) await new Promise((c) => setImmediate(c));
    assert.equal(cozler.length, 1, 'adım sürüyor');
    assert.equal(is(id).adimda, true, 'adım sürerken');
    assert.ok(gorulen.some((g) => g.adimda === true), 'durum olayı adım başında yayınlandı (ada hapı o an inebilsin)');
    cozler[0]({ ozet: 'Bitti.' });
    await Z._test.bosta();
    assert.equal(is(id).adimda, false, 'adım bitti');
    assert.equal(is(id).adim, 1);
  } finally { birak(); }
});

test('G10: Etkinlik akışı olayları — başladı, kontrol etti, adım, durdu, yeniden başladı, bitti; ardışık kontroller 30 sn’de bir satır (n kez)', async () => {
  temizle();
  const { anaDinle } = await import('../src/main/olaylar.ts');
  type GorevOlayi = { olay: string; id: number; baslik: string; n?: number; neden?: string; ozet?: string };
  const olaylar: GorevOlayi[] = [];
  const birak = anaDinle<{ tur: string; bolge: string; gorev?: GorevOlayi }>('beyin:olay', (o) => {
    if (o.tur !== 'gorev') return;
    assert.equal(o.bolge, 'saat');
    olaylar.push(o.gorev!);
  });
  try {
    const id = baslat('Olaylı iş', { aralik: { min: 10, max: 120 } });
    assert.deepEqual(olaylar.map((o) => o.olay), ['basladi']);
    assert.equal(olaylar[0].baslik, 'Olaylı iş');
    // Üç "değişmedi" kontrolü (t = 0, 15, 38 sn): ilki hemen, ikincisi 30 sn dolmadığı için birleşir, üçüncüsü "2 kez" olarak yazılır.
    await ilerle(); await ilerle(); await ilerle();
    assert.deepEqual(olaylar.filter((o) => o.olay === 'kontrol').map((o) => o.n), [1, 2], JSON.stringify(olaylar));
    // Değişiklik: adım olayı özetiyle (kontrol satırı değil).
    gozcuDavranisi = () => ({ degisti: true, iz: 'iz-olay' });
    adimDavranisi = async () => ({ ozet: 'Ahmet yazdı: tamam.' });
    await ilerle();
    const adim = olaylar.filter((o) => o.olay === 'adim');
    assert.equal(adim.length, 1);
    assert.equal(adim[0].ozet, 'Ahmet yazdı: tamam.');
    assert.equal(olaylar.filter((o) => o.olay === 'kontrol').length, 2, 'değişen kontrol "kontrol etti" satırı üretmez');
    Z.isDurdur(id, 'kullanici');
    assert.deepEqual(olaylar.at(-1), { olay: 'durdu', id, baslik: 'Olaylı iş', neden: 'kullanici' });
    assert.ok('is' in Z.isSurdur(id));
    assert.equal(olaylar.at(-1)?.olay, 'surdu');
    // Süre dolunca bitti.
    for (let i = 0; i < 400 && is(id).durum === 'suruyor' && (await ilerle()); i++) { /* süre dolana dek */ }
    assert.equal(is(id).durum, 'bitti');
    assert.equal(olaylar.at(-1)?.olay, 'bitti');
    // Acil durdurma da "durdu" olayıdır (nedeniyle).
    const b = baslat('Acil iş');
    Z.tumIsleriDurdur('acil');
    assert.deepEqual(olaylar.at(-1), { olay: 'durdu', id: b, baslik: 'Acil iş', neden: 'acil' });
  } finally { birak(); }
});
