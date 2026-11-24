// 0.14 T24 — 'centik:veri' ana süreçte (main/centik-veri.ts): gerçek bağlantılar Electron'suz sahnede (tests/yardimci/ana-surec.ts). Ağ bekçisi açık:
// 127.0.0.1 dışına giden her istek testi düşürür — Gizli'de ve 15 dk içinde takvim aracı ağa çıkmaz. Kurallar tests/centik-veri.test.ts'te.
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { anaSurecSahnesi, ipcKurBos, ipcIsleyicileri } from './yardimci/ana-surec.ts';
import { BULUT_KAPALI_METNI } from '../src/shared/bulut-kapisi.ts';
import { TAKVIM_BAGLI_DEGIL, TAKVIM_ONBELLEK_ANAHTARI, GELEN_KAYNAK_YOK, type CentikVerisi, type TakvimOlayi } from '../src/shared/centik-veri.ts';
import type { McpKatalogGirdisi } from '../src/shared/mcp-katalog.ts';

const { klasor, agIstekleri } = anaSurecSahnesi('centik-veri', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', hitap: 'Deniz', mod: 'is', tanitimSurumu: '0.9.0', ses: { surum: 2, uyandirma: false },
  proaktif: { etkin: false }, baslangictaAc: false,
});
(globalThis as Record<string, unknown>).__sifreleme = true;
Object.assign(process.env, { FUBER_DEMO: '1', FUBER_TEST_TAM_EKRAN: '0', FUBER_TEST_ANA_ONDE: '1' });

// Bu bilgisayardaki katalog önbelleği: gündem araçlı bir takvim girdisi (sunucuya hiç gidilmez).
const TAKVIM: McpKatalogGirdisi = {
  id: 'google-takvim', ad: 'Google Takvim', simge: 'takvim', aciklama: 'Takvimindeki etkinlikleri okur.', tur: 'http', adres: 'https://takvim.sahte.example/mcp',
  oauth: {}, saltOkunur: ['list_events'], gundemAraci: { ad: 'list_events', girdi: { calendarId: 'primary' } }, acik: true, sira: 1,
};
fs.writeFileSync(path.join(klasor, 'mcp-katalog.json'), JSON.stringify({ surum: 1, katalog: [TAKVIM] }));

await ipcKurBos();
const { ayarlariKaydet } = await import('../src/main/ayarlar.ts');
const { kayitYaz } = await import('../src/main/entegrasyon/mcp-oauth.ts');
const { meta, metaYaz } = await import('../src/main/vt.ts');
const ipc = <T>(kanal: string, ...a: unknown[]) => Promise.resolve(ipcIsleyicileri().get(kanal)!(...a)) as Promise<T>;

const birSaatSonra = new Date(Date.now() + 3600_000);
// Gece yarısına bir saatten az kaldıysa "bugün" dışına taşmasın: etkinlik şimdiden 1 dk sonra, bitişi 30 dk sonra.
const bas = birSaatSonra.toDateString() === new Date().toDateString() ? birSaatSonra : new Date(Date.now() + 60_000);
const OLAY: TakvimOlayi = { baslik: 'Ekip toplantısı', bas: bas.toISOString(), bit: new Date(bas.getTime() + 30 * 60_000).toISOString(), tumGun: false };
const onbellek = (yasMs: number) => metaYaz(TAKVIM_ONBELLEK_ANAHTARI, JSON.stringify({ surum: 1, zaman: Date.now() - yasMs, kaynak: 'google-takvim', olaylar: [OLAY] }));

test("Gizli'de takvim yerel veritabanındaki son kopyadan; ağa ve MCP'ye çıkılmaz", async () => {
  kayitYaz('google-takvim', { surum: 1, adres: TAKVIM.adres, zaman: new Date().toISOString() });
  onbellek(3 * 3600_000); // 3 saatlik kopya: Gizli olmasa çağrılırdı
  ayarlariKaydet((a) => { a.yerel.gizliMod = true; });
  try {
    const v = await ipc<CentikVerisi>('centik:veri');
    assert.equal(v.gundem.not, BULUT_KAPALI_METNI.takvim);
    assert.equal((v.gundem.siradaki as TakvimOlayi | null)?.baslik, 'Ekip toplantısı');
    assert.equal(v.gundem.bos, null);
    assert.equal(v.bulutKapali, true);
    assert.deepEqual(agIstekleri, []);
  } finally {
    ayarlariKaydet((a) => { a.yerel.gizliMod = false; });
  }
  // "Yalnız bu bilgisayar" da aynı kapı.
  ayarlariKaydet((a) => { a.yerel.yalnizYerel = true; });
  try {
    assert.equal((await ipc<CentikVerisi>('centik:veri')).gundem.not, BULUT_KAPALI_METNI.takvim);
    assert.deepEqual(agIstekleri, []);
  } finally {
    ayarlariKaydet((a) => { a.yerel.yalnizYerel = false; });
  }
});

test('15 dk içindeki kopya varken takvim aracı çağrılmaz; önbellek kokpit veritabanında', async () => {
  onbellek(5 * 60_000);
  const v = await ipc<CentikVerisi>('centik:veri');
  assert.equal(v.gundem.not, null);
  assert.equal((v.gundem.siradaki as TakvimOlayi | null)?.baslik, 'Ekip toplantısı');
  assert.deepEqual(agIstekleri, [], 'takvim aracı ağa çıkmadı');
  assert.ok(meta(TAKVIM_ONBELLEK_ANAHTARI)?.includes('Ekip toplantısı'));
});

test('düzeltme 1: yavaş takvimde (30 sn) Görevler ve Gelenler 1 sn içinde dolu gelir; takvim bitince kokpit:veri-degisti ile yeniden çizilir', async () => {
  const { takvimBaglami } = await import('../src/main/centik-veri.ts');
  const { anaDinle } = await import('../src/main/olaylar.ts');
  const { isEkle } = await import('../src/main/isler/depo.ts');
  const { veritabani } = await import('../src/main/vt.ts');
  // Yerel veri: bir okunmamış e-posta ve süren bir görev.
  veritabani().prepare("INSERT INTO epostalar(hesap, mesaj_kimlik, kimden, konu, tarih, ozet, okundu, onem) VALUES('h1', 'm-yavas', 'Ece Aydın <ece@ornek.example>', 'Ana sayfa', ?, '', 0, 5)").run(new Date().toISOString());
  isEkle({ baslik: 'Kargo takibi', amac: 'kargo', plan: { gozcu: { tur: 'saat' }, aralik: { min: 60, max: 600 }, bitis: { tur: 'sure', saniye: 3600 }, izinler: [], azamiAdim: 60 }, sohbetId: 1, baslangic: new Date().toISOString(), bitisZamani: new Date(Date.now() + 3600_000).toISOString(), aralik: 60 });
  kayitYaz('google-takvim', { surum: 1, adres: TAKVIM.adres, zaman: new Date().toISOString() });
  onbellek(3 * 3600_000); // bayat kopya: çağrı gerekir
  const gercek = takvimBaglami.aracCagir;
  let birak: (x: unknown) => void = () => undefined;
  let yavasZaman: ReturnType<typeof setTimeout> | undefined;
  let cagri = 0;
  takvimBaglami.aracCagir = () => { cagri++; return new Promise((c) => { birak = c; yavasZaman = setTimeout(() => c({ items: [] }), 30_000); }); };
  takvimBaglami.durum.sonDeneme = Number.NEGATIVE_INFINITY;
  const olaylar: unknown[] = [];
  const birakDinle = anaDinle('kokpit:veri-degisti', (v) => olaylar.push(v));
  try {
    const bas = Date.now();
    const v = await ipc<CentikVerisi>('centik:veri');
    const sure = Date.now() - bas;
    assert.ok(sure < 1000, `yanıt ${sure} ms`);
    assert.equal(cagri, 1, 'takvim arka planda çağrıldı');
    assert.ok(v.gorevler.isler.some((i) => i.baslik === 'Kargo takibi'), 'Görevler dolu');
    assert.ok(v.gelenler.ogeler.some((o) => o.kimden === 'Ece Aydın'), 'Gelenler dolu');
    assert.equal(v.gelenler.okunmamis, 1);
    assert.equal((v.gundem.siradaki as TakvimOlayi | null)?.baslik, 'Ekip toplantısı', 'takvim önbellekteki kopyadan');
    assert.deepEqual(olaylar, []);
    birak({ items: [{ summary: 'Yeni toplantı', start: { dateTime: new Date(Date.now() + 60_000).toISOString() } }] });
    for (let i = 0; i < 50 && !olaylar.length; i++) await new Promise((c) => setTimeout(c, 10));
    assert.deepEqual(olaylar, [{ neden: 'takvim' }]);
    const v2 = await ipc<CentikVerisi>('centik:veri');
    assert.equal((v2.gundem.siradaki as TakvimOlayi | null)?.baslik, 'Yeni toplantı');
    assert.equal(cagri, 1, 'yeni kopya varken yeniden çağrılmaz');
    assert.deepEqual(agIstekleri, []);
  } finally {
    clearTimeout(yavasZaman);
    birakDinle();
    veritabani().exec("DELETE FROM epostalar WHERE mesaj_kimlik = 'm-yavas'; DELETE FROM isler WHERE baslik = 'Kargo takibi';");
    takvimBaglami.aracCagir = gercek;
  }
});

test('takvim bağlı değilse Bağla takvimin katalog kartına; kaynaksız Gelenler E-posta\'ya; görev yok', async () => {
  kayitYaz('google-takvim', null);
  const v = await ipc<CentikVerisi>('centik:veri');
  assert.deepEqual(v.gundem.bos, { metin: TAKVIM_BAGLI_DEGIL, eylem: 'baglantilar', cipa: 'servis-google-takvim' });
  assert.deepEqual(v.gelenler.bos, { metin: GELEN_KAYNAK_YOK, eylem: 'baglantilar', cipa: 'eposta' });
  assert.deepEqual(v.gorevler.isler, []);
  assert.equal(v.gorevler.mod, 'is');
  assert.deepEqual(agIstekleri, []);
});

test('5 Kas: gündem aracı tanımsız takvim servisi bağlıysa takvim sayılır (araç sunucudan seçilir); katalogda takvim yoksa Bağla yok', async () => {
  const { takvimBaglami } = await import('../src/main/centik-veri.ts');
  const { OTOMATIK_GUNDEM_ARACI } = await import('../src/shared/mcp-katalog.ts');
  const { TAKVIM_SERVISI_YOK } = await import('../src/shared/centik-veri.ts');
  const dosya = path.join(klasor, 'mcp-katalog.json');
  let n = 0;
  const yaz = (katalog: McpKatalogGirdisi[]) => {
    fs.writeFileSync(dosya, JSON.stringify({ surum: 1, katalog }));
    const t = new Date(Date.now() + ++n * 5_000); // imza (mtime:boyut) her yazışta değişsin
    fs.utimesSync(dosya, t, t);
  };
  try {
    yaz([{ ...TAKVIM, gundemAraci: null, saltOkunur: [] }]);
    kayitYaz('google-takvim', { surum: 1, adres: TAKVIM.adres, zaman: new Date().toISOString() });
    assert.deepEqual(takvimBaglami.girdi(), { id: 'google-takvim', arac: { ad: OTOMATIK_GUNDEM_ARACI, girdi: {} } });
    kayitYaz('google-takvim', null);
    assert.deepEqual((await ipc<CentikVerisi>('centik:veri')).gundem.bos, { metin: TAKVIM_BAGLI_DEGIL, eylem: 'baglantilar', cipa: 'servis-google-takvim' });
    // Katalogda yalnız takvim olmayan servis: neyin bağlanacağı söylenir, Bağla Servisler'i açar (11 Kas: açık kaynak kullanıcısına yol göster).
    yaz([{ ...TAKVIM, id: 'notion', ad: 'Notion', simge: 'notion', gundemAraci: null }]);
    assert.equal(takvimBaglami.girdi(), null);
    assert.deepEqual((await ipc<CentikVerisi>('centik:veri')).gundem.bos, { metin: TAKVIM_SERVISI_YOK, eylem: 'baglantilar', cipa: 'servisler' });
    assert.deepEqual(agIstekleri, []);
  } finally {
    yaz([TAKVIM]);
  }
});
