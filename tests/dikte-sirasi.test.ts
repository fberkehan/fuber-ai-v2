// Dikte sırası (0.13 Görev 10): Vosk dikteden çıktı; bulut kiplerinde yalnız Fuber hesabı (canlı → toplu → tek satır), Gizli ve "Yalnız bu bilgisayar"da
// yerel Whisper (ilk kullanımda kurulur, inecek GERÇEK toplam satırda söylenir, düşerse "Yeniden dene"). 'cihaz' yolu yok: ses hattı yoksa DIKTE_YOK tek satırı.
// Saf karar (shared/dikte-yolu.ts), SesMerkezi, gün kaydı modelinin yaşam döngüsü (gun-kaydi-modeli.ts: ayar çalışma anında açılıp kapanır) ve dikte kapısı
// (dikte-kapisi.ts: yanlış uyanmada hiçbir şey açılmaz) davranış olarak sınanır; kaynak denetimi yalnız "Vosk dikteye dönmedi" için.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DIKTE_YOK, WHISPER_BOYUT_MB, WHISPER_CALISTIRICI_MB, dikteKarari, dikteYolu, whisperIndirmeMB, type DikteGirdisi } from '../src/shared/dikte-yolu.ts';
import { SesMerkezi, type HesapSesi, type SesAyarlari, type Whisper } from '../src/main/ses/merkez.ts';
import { DIKTE_SINIR_METNI } from '../src/shared/masaustu-hesap.ts';
import { isDiliIhlali } from '../src/shared/is-dili.ts';
import { gunKaydiUygulayici, modelYoneticisi } from '../src/renderer/gun-kaydi-modeli.ts';
import { dikteKapisi } from '../src/renderer/dikte-kapisi.ts';

const girdi = (o: Partial<DikteGirdisi> = {}): DikteGirdisi => ({
  bulutsuz: false, hesapKullanilir: false, mod: 'is',
  whisper: { kurulu: false, kurulabilir: true, boyutMB: 595 }, ...o,
});
const kuruluWhisper = { kurulu: true, kurulabilir: true };

test('bulut kipinde Whisper seçilmez ve otomatik kurulmaz', () => {
  assert.equal(dikteYolu(girdi({ whisper: kuruluWhisper })), 'yok', 'hesap yokken kurulu Whisper bulutta seçilmez');
  assert.equal(dikteYolu(girdi({ hesapKullanilir: true, whisper: kuruluWhisper })), 'hesap');
  const k = dikteKarari(girdi());
  assert.deepEqual({ yol: k.yol, kur: k.kur, satir: k.satir }, { yol: 'yok', kur: false, satir: DIKTE_YOK }, 'bulut kipinde indirme başlamaz');
});

test('yerel kipte Whisper: Gizli ve "Yalnız bu bilgisayar" hesap olsa da buluta çıkmaz', () => {
  assert.equal(dikteYolu(girdi({ bulutsuz: true, whisper: kuruluWhisper })), 'whisper');
  assert.equal(dikteYolu(girdi({ bulutsuz: true, hesapKullanilir: true, whisper: kuruluWhisper })), 'whisper');
  assert.equal(dikteKarari(girdi({ bulutsuz: true, whisper: kuruluWhisper })).satir, null, 'çalışan yolda uyarı yok');
});

test('yerel kipte Whisper kurulu değilse kurulum başlatılır ve kullanıcıya söylenir (inecek toplam, bir kez, satırda)', () => {
  const k = dikteKarari(girdi({ bulutsuz: true }));
  assert.equal(k.yol, 'yok');
  assert.equal(k.kur, true);
  assert.match(k.satir!, /indiriliyor \(yaklaşık 595 MB\)/);
  assert.match(k.satir!, /yazarak devam edebilirsin/);
  assert.equal(isDiliIhlali(k.satir!), null, `İş dilinde teknik sözcük yok: ${k.satir}`);
  // Büyük toplam GB olarak söylenir.
  assert.match(dikteKarari(girdi({ bulutsuz: true, whisper: { kurulu: false, kurulabilir: true, boyutMB: 1351 } })).satir!, /1,4 GB/);
  // Geliştirici ilerlemeyi nerede göreceğini de duyar; İş'te Ayarlar'da böyle bir satır yok.
  assert.match(dikteKarari(girdi({ bulutsuz: true, mod: 'gelistirici' })).satir!, /Ayarlar/);
  assert.doesNotMatch(k.satir!, /Ayarlar/);
  // Sürerken yeniden kurulmaz: ilerleme söylenir, boyut tekrarlanmaz.
  const suruyor = dikteKarari(girdi({ bulutsuz: true, whisper: { kurulu: false, kurulabilir: true, boyutMB: 595, indirme: { yuzde: 41.6, adim: 'Model' } } }));
  assert.equal(suruyor.kur, false);
  assert.match(suruyor.satir!, /%42/);
  assert.doesNotMatch(suruyor.satir!, /MB/);
  // Kurulum yolu yoksa (kurulabilir değil) DIKTE_YOK.
  assert.equal(dikteKarari(girdi({ bulutsuz: true, whisper: { kurulu: false, kurulabilir: false } })).satir, DIKTE_YOK);
});

test('satırdaki boyut gerçek toplamdır: NVIDIA\'da CUDA arşivi dahil; çalıştırıcı ya da model zaten varsa yalnız eksik olan', () => {
  const m = 'large-v3-turbo-q5_0' as const;
  // Hiçbiri kurulu değil: işlemci 21 + model 574; NVIDIA'da 671 + 574.
  assert.equal(whisperIndirmeMB({ model: m, cuda: false, calistiriciVar: false, modelVar: false }), 21 + 574);
  assert.equal(whisperIndirmeMB({ model: m, cuda: true, calistiriciVar: false, modelVar: false }), 671 + 574);
  assert.ok(WHISPER_CALISTIRICI_MB.cuda > 10 * WHISPER_CALISTIRICI_MB.cpu, 'CUDA yolu işlemci yolundan çok daha büyük: sürpriz olmasın');
  // Gün kaydı çalıştırıcıyı zaten kurmuşsa yalnız model; ikisi de varsa 0.
  assert.equal(whisperIndirmeMB({ model: m, cuda: true, calistiriciVar: true, modelVar: false }), WHISPER_BOYUT_MB[m]);
  assert.equal(whisperIndirmeMB({ model: m, cuda: true, calistiriciVar: false, modelVar: true }), 671);
  assert.equal(whisperIndirmeMB({ model: m, cuda: true, calistiriciVar: true, modelVar: true }), 0);
  assert.equal(whisperIndirmeMB({ model: 'large-v3-q5_0', cuda: true, calistiriciVar: false, modelVar: false }), 671 + 1081);
  // Satır toplamı olduğu gibi söyler.
  assert.match(dikteKarari(girdi({ bulutsuz: true, whisper: { kurulu: false, kurulabilir: true, boyutMB: 844 } })).satir!, /yaklaşık 844 MB/);
});

test('düşen kurulum: İş\'te tek "Yeniden dene" (düğme satırla gelir), Geliştirici\'de Ayarlar yönlendirmesi; yeniden denince kurulum bir kez daha başlar', () => {
  const dustu = { kurulu: false, kurulabilir: true, boyutMB: 595, indirme: { yuzde: 30, adim: 'Kurulum durdu', hata: 'ağ' } };
  const is = dikteKarari(girdi({ bulutsuz: true, whisper: dustu }));
  assert.deepEqual({ kur: is.kur, yenidenDene: is.yenidenDene }, { kur: false, yenidenDene: true }, 'kendiliğinden yeniden indirmez; düğme sunar');
  assert.match(is.satir!, /kurulamadı/);
  assert.equal(isDiliIhlali(is.satir!), null);
  const dev = dikteKarari(girdi({ bulutsuz: true, mod: 'gelistirici', whisper: dustu }));
  assert.deepEqual({ kur: dev.kur, yenidenDene: dev.yenidenDene }, { kur: false, yenidenDene: undefined });
  assert.match(dev.satir!, /Ayarlar → Gün kaydı/);
  // "Yeniden dene": kurulum yeniden başlar ve boyut yine söylenir.
  const yeniden = dikteKarari(girdi({ bulutsuz: true, yeniden: true, whisper: dustu }));
  assert.equal(yeniden.kur, true);
  assert.match(yeniden.satir!, /yaklaşık 595 MB/);
  // Bulut kipinde "Yeniden dene" Whisper'ı kurmaz.
  assert.equal(dikteKarari(girdi({ yeniden: true, whisper: dustu })).kur, false);
  // Ayarlar'daki Geliştirici düğmesi hata varken "Yeniden dene" der.
  assert.match(fs.readFileSync(new URL('../src/renderer/ayarlar/Dusunme.tsx', import.meta.url), 'utf8'), /ind\?\.hata \? 'Yeniden dene'/);
});

test("'cihaz' yolu yok: hiçbir girdi 'cihaz' ya da 'scribe' döndürmez; arayüz Vosk'a dönmez", () => {
  for (const bulutsuz of [false, true]) for (const hesapKullanilir of [false, true]) for (const kurulu of [false, true]) {
    const yol = dikteYolu(girdi({ bulutsuz, hesapKullanilir, whisper: { kurulu, kurulabilir: true } }));
    assert.ok(['hesap', 'whisper', 'yok'].includes(yol), yol);
  }
  // Kaynak: dikte yolunda cihazdaki tanıyıcıya dönüş kalmadı.
  const kulak = fs.readFileSync(new URL('../src/renderer/kulak.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(kulak, /cihazdaCevir|serbest\s*=\s*new model|retrieveFinalResult|partialresult/, 'kulak: serbest Vosk ve cihazda çevirme yok');
  const yakala = fs.readFileSync(new URL('../src/renderer/ses-yakala.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(yakala, /'cihaz'/);
  const tipler = fs.readFileSync(new URL('../src/shared/tipler.ts', import.meta.url), 'utf8');
  assert.match(tipler, /export type YaziyaMotoru = 'hesap' \| 'whisper' \| 'yok';/);
});

// ── SesMerkezi: motor 'yok', kurulum yalnız söz istenince ve yalnız yerel kipte ──
function merkez(o: { bulutsuz?: boolean; hesap?: boolean; durum?: 'aktif' | 'kredi-bitti'; whisper?: boolean | 'yok'; mod?: string }) {
  const ayar: SesAyarlari = { hiz: 1, dil: 'tr', bulutsuz: o.bulutsuz === true, mod: o.mod };
  const hesap: HesapSesi | undefined = o.hesap || o.durum ? {
    kullanilir: () => true, yaziyaKullanilir: () => o.hesap === true && o.durum !== 'kredi-bitti', sesId: () => 'x', kip: () => 'business',
    durum: () => o.durum ?? 'aktif',
    seslendir: async () => new Uint8Array(), yaziya: async () => 'Hesaptan', yaziyaBelirteci: async () => null, yaziyaSure: async () => undefined,
  } : undefined;
  const w = { kurulduSayisi: 0, indirme: undefined as { yuzde: number; adim: string; hata?: string } | undefined, kurulu: o.whisper === true, toplamMB: 844 };
  const whisper: Whisper | undefined = o.whisper === undefined ? undefined : {
    hazirMi: () => w.kurulu, isit: () => undefined, cevir: async () => 'Whisper metni',
    kurulum: () => ({ kurulu: w.kurulu, ...(w.indirme ? { indirme: w.indirme } : {}) }),
    boyutMB: async () => w.toplamMB,
    kur: () => { w.kurulduSayisi++; w.indirme = { yuzde: 3, adim: 'Hazırlanıyor' }; },
  };
  return { m: new SesMerkezi({ ayar: () => ayar, yedek: { hazirMi: () => true, async *pcm() { yield new Uint8Array(2); } }, hesap, whisper }), w };
}

test('SesMerkezi: dinlemeBaslat hiçbir koşulda "cihaz" vermez; yolu yoksa "yok" ve oturum açılmaz', () => {
  for (const bulutsuz of [false, true]) for (const hesap of [false, true]) for (const whisper of [undefined, true, 'yok'] as const) {
    const { m } = merkez({ bulutsuz, hesap, whisper });
    const d = m.dinlemeBaslat('p');
    assert.ok(['hesap', 'whisper', 'yok'].includes(d.motor), `${bulutsuz}/${hesap}/${whisper} → ${d.motor}`);
    assert.equal(m.yaziyaMotoru(), d.motor);
  }
  const { m, w } = merkez({ bulutsuz: true, whisper: 'yok' });
  assert.equal(m.dinlemeBaslat('p').motor, 'yok');
  assert.equal(w.kurulduSayisi, 0, 'dinleme başlamak (yanlış uyanma dahil) indirme başlatmaz');
});

test('SesMerkezi: söz gerçekten istenince (dikteYokSatiri) yerel kipte kurulum BİR kez başlar ve gerçek toplam söylenir; sürerken ilerleme; bulutta hiç kurulmaz', async () => {
  const { m, w } = merkez({ bulutsuz: true, whisper: 'yok' });
  const ilk = await m.dikteYokSatiri();
  assert.equal(w.kurulduSayisi, 1);
  assert.match(ilk.satir, /yaklaşık 844 MB/);
  const ikinci = await m.dikteYokSatiri();
  assert.equal(w.kurulduSayisi, 1, 'sürerken yeniden başlamaz');
  assert.match(ikinci.satir, /%3/);
  // Eşzamanlı iki istek iki kez kurmaz.
  const e = merkez({ bulutsuz: true, whisper: 'yok' });
  await Promise.all([e.m.dikteYokSatiri(), e.m.dikteYokSatiri()]);
  assert.equal(e.w.kurulduSayisi, 1);

  const bulut = merkez({ bulutsuz: false, whisper: 'yok' });
  assert.equal((await bulut.m.dikteYokSatiri()).satir, DIKTE_YOK);
  assert.equal(bulut.w.kurulduSayisi, 0, 'bulut kipinde Whisper kurulmaz');

  const kurulu = merkez({ bulutsuz: true, whisper: true });
  assert.equal(kurulu.m.yaziyaMotoru(), 'whisper');
  assert.equal(kurulu.w.kurulduSayisi, 0);
});

test('0.13 son düzeltme 13: Gizli\'de yanlış uyanma + konuşma Whisper indirmesini başlatmaz; satır elle yolu söyler, indirme yalnız elle başlatılan diktede', async () => {
  const { m, w } = merkez({ bulutsuz: true, whisper: 'yok' });
  const u = await m.dikteYokSatiri({ uyandirma: true });
  assert.equal(w.kurulduSayisi, 0, 'uyanma yolu indirme başlatmaz');
  assert.match(u.satir, /kurulu değil/);
  assert.match(u.satir, /mikrofona basınca indirilir \(yaklaşık 844 MB\)/, 'boyut yine söylenir: kota sürprizi olmasın');
  assert.doesNotMatch(u.satir, /indiriliyor/);
  assert.equal(u.yenidenDene, undefined);
  await m.dikteYokSatiri({ uyandirma: true });
  assert.equal(w.kurulduSayisi, 0, 'ikinci yanlış uyanma da');
  // Elle bastı: kurulum başlar; sürerken uyanma yolu da ilerlemeyi söyler, kurulumu yeniden başlatmaz.
  await m.dikteYokSatiri();
  assert.equal(w.kurulduSayisi, 1);
  assert.match((await m.dikteYokSatiri({ uyandirma: true })).satir, /%3/);
  assert.equal(w.kurulduSayisi, 1);
  // Saf karar ve kablolama: uyanma yolu kulaktan işaretle gelir, elle yol işaretsiz.
  assert.deepEqual(dikteKarari({ bulutsuz: true, hesapKullanilir: false, uyandirma: true, whisper: { kurulu: false, kurulabilir: true } }).kur, false);
  const kulak = fs.readFileSync(new URL('../src/renderer/kulak.ts', import.meta.url), 'utf8');
  assert.match(kulak, /dikteYokSatiri\(\{ uyandirma: uyandirmayla \}\)/);
  assert.match(fs.readFileSync(new URL('../src/main/ipc.ts', import.meta.url), 'utf8'), /'ses:dikte-yok', \(o\?: \{ uyandirma\?: unknown \}\) => dikteYokSatiri\(false, o\?\.uyandirma === true\)/);
  assert.match(fs.readFileSync(new URL('../src/renderer/ses-yakala.ts', import.meta.url), 'utf8'), /cagir<DikteSatiri>\('ses:dikte-yok', o\)/);
});

test('SesMerkezi: kurulum düşünce İş\'te "Yeniden dene" sunulur; basınca (yeniden) kurulum bir kez daha başlar, kendiliğinden başlamaz', async () => {
  const { m, w } = merkez({ bulutsuz: true, whisper: 'yok' });
  await m.dikteYokSatiri();
  w.indirme = { yuzde: 20, adim: 'Kurulum durdu', hata: 'ağ' };
  const dustu = await m.dikteYokSatiri();
  assert.match(dustu.satir, /kurulamadı/);
  assert.equal(dustu.yenidenDene, true);
  assert.equal(w.kurulduSayisi, 1, 'düşen kurulum sessizce yeniden indirilmez');
  const yeniden = await m.dikteYokSatiri({ yeniden: true });
  assert.equal(w.kurulduSayisi, 2);
  assert.match(yeniden.satir, /indiriliyor/);
  assert.equal(yeniden.yenidenDene, undefined);
  // Geliştirici: düğme satırda yok, Ayarlar'a yönlendirir.
  const d = merkez({ bulutsuz: true, whisper: 'yok', mod: 'gelistirici' });
  d.w.indirme = { yuzde: 20, adim: 'Kurulum durdu', hata: 'ağ' };
  const ds = await d.m.dikteYokSatiri();
  assert.equal(ds.yenidenDene, undefined);
  assert.match(ds.satir, /Ayarlar/);
});

test('SesMerkezi: kredi bitti → motor "yok" ve satır kredi satırı; sonraki dikte de aynı (genel metne düşmez)', async () => {
  const { m } = merkez({ durum: 'kredi-bitti', whisper: true });
  assert.equal(m.yaziyaMotoru(), 'yok');
  assert.equal((await m.dikteYokSatiri()).satir, DIKTE_SINIR_METNI.kredi);
  assert.equal((await m.dikteYokSatiri()).satir, DIKTE_SINIR_METNI.kredi);
});

// ── Gün kaydı modeli: yalnız gün kaydı açıkken yüklü; ayar çalışma anında açılıp kapanır ──
function modelDuzeni() {
  const gunluk = { yuklenen: 0, birakilan: 0, yuklemeBekle: null as null | (() => void), kur: 0, kapat: 0, esitle: 0, ayar: [] as boolean[] };
  const model = modelYoneticisi<{ id: number }>({
    yukle: () => new Promise((coz) => { const id = ++gunluk.yuklenen; const bitir = () => coz({ id }); if (gunluk.yuklemeBekle === null) bitir(); else gunluk.yuklemeBekle = bitir; }),
    birak: () => { gunluk.birakilan++; },
  });
  // kulak.ts'teki gibi: gunlukKur, tanıyıcıyı yalnız ayar açık VE model yüklüyse kurar.
  let ayarAcik = false, kuruldu = false;
  const uygula = gunKaydiUygulayici<{ gunKaydi: boolean }, { id: number }>({
    model, ayarYaz: (v) => { ayarAcik = v.gunKaydi; gunluk.ayar.push(v.gunKaydi); },
    gunlukKur: () => { if (model.al() && ayarAcik && !kuruldu) { kuruldu = true; gunluk.kur++; } },
    gunlukKapat: () => { kuruldu = false; gunluk.kapat++; },
    uyandirmaEsitle: () => { gunluk.esitle++; },
  });
  return { gunluk, model, uygula };
}
const bos = () => new Promise<void>((c) => setImmediate(c));

test('gün kaydı kapalıyken model hiç yüklenmez; çalışma anında AÇILINCA yüklenir ve tanıyıcı kurulur (yeniden başlatma gerekmez)', async () => {
  const { gunluk, model, uygula } = modelDuzeni();
  uygula({ gunKaydi: false }); // açılış: gün kaydı kapalı
  await bos();
  assert.equal(gunluk.yuklenen, 0, 'kapalıyken yükleme yok');
  assert.equal(model.al(), null);
  assert.equal(gunluk.esitle, 1, '"Hey Fuber" yine eşitlenir');
  uygula({ gunKaydi: true }); // kullanıcı Ayarlar\'dan açtı (gunkaydi:kulak olayı)
  await bos();
  assert.equal(gunluk.yuklenen, 1);
  assert.ok(model.al(), 'model yüklendi');
  assert.equal(gunluk.kur, 1, 'tanıyıcı kuruldu');
});

test('kontrol: eski kapı ("model yüklüyse uygula") gün kaydını çalışma anında açamıyordu; yeni uygulayıcı açar (hata yeniden üretilebilir)', async () => {
  const { gunluk, model, uygula } = modelDuzeni();
  const eskiIsleyici = (v: { gunKaydi: boolean }) => { if (model.al()) uygula(v); /* model yok: yalnız ayar yazılırdı, yükleme hiç başlamazdı */ };
  eskiIsleyici({ gunKaydi: true });
  await bos();
  assert.equal(gunluk.yuklenen, 0, 'eski davranış: model null olduğundan açma olayı yutulur');
  uygula({ gunKaydi: true });
  await bos();
  assert.equal(gunluk.yuklenen, 1, 'yeni davranış');
});

test('gün kaydı kapatılınca tanıyıcı kapanır ve model bırakılır; açılıp kapanıp yeniden açılınca yine çalışır', async () => {
  const { gunluk, model, uygula } = modelDuzeni();
  uygula({ gunKaydi: true });
  await bos();
  uygula({ gunKaydi: false });
  await bos();
  assert.equal(gunluk.kapat, 1);
  assert.equal(gunluk.birakilan, 1);
  assert.equal(model.al(), null);
  uygula({ gunKaydi: true });
  await bos();
  assert.equal(gunluk.yuklenen, 2, 'yeniden yüklendi');
  assert.equal(gunluk.kur, 2);
  assert.ok(model.al());
  // Aynı ayar yeniden gelirse ikinci yükleme yok.
  uygula({ gunKaydi: true });
  await bos();
  assert.equal(gunluk.yuklenen, 2);
});

test('yüklenirken gün kaydı kapatılırsa yüklenen model tutulmaz; kapatılıp yeniden açılırsa son istek kazanır', async () => {
  const k = modelDuzeni();
  k.gunluk.yuklemeBekle = () => undefined; // yükleme askıda
  k.uygula({ gunKaydi: true });
  await bos();
  k.uygula({ gunKaydi: false });
  k.gunluk.yuklemeBekle();
  await bos(); await bos();
  assert.equal(k.model.al(), null, 'kapatıldı: model tutulmadı');
  assert.equal(k.gunluk.birakilan, 1);
  assert.equal(k.gunluk.kur, 0, 'tanıyıcı kurulmadı');

  const e = modelDuzeni();
  e.gunluk.yuklemeBekle = () => undefined;
  e.uygula({ gunKaydi: true });
  await bos();
  e.uygula({ gunKaydi: false });
  e.uygula({ gunKaydi: true });
  e.gunluk.yuklemeBekle();
  await bos(); await bos();
  assert.ok(e.model.al(), 'son istek açık: model kaldı');
  assert.equal(e.gunluk.yuklenen, 1, 'aynı yükleme sürdü');
  assert.equal(e.gunluk.kur, 1);
});

// ── Dikte kapısı: yanlış uyanmada hiçbir şey açılmaz ──
function sahteOturum() {
  const durum = { alinan: [] as number[], iptal: 0 };
  return { durum, besle: (x: Float32Array) => { durum.alinan.push(x[0]); }, iptal: () => { durum.iptal++; } };
}
const orn = (v: number) => new Float32Array([v]);

test('yanlış uyanma: konuşma yoksa oturum HİÇ açılmaz (belirteç/soket/ses yok), bekleyenler atılır', async () => {
  let acilan = 0;
  const kapi = dikteKapisi(async () => { acilan++; return sahteOturum(); });
  for (let i = 0; i < 40; i++) kapi.besle(orn(i), 48000); // uyanma sonrası sessizlik
  kapi.iptal(); // konuşma duyulmadı
  await bos();
  assert.equal(acilan, 0);
  assert.equal(await kapi.oturum(), undefined, 'hiç açılmadı');
});

test('konuşma duyulunca oturum bir kez açılır ve bekleyen örnekler (ilk hece dahil) sırayla akar, sonrası canlı', async () => {
  const s = sahteOturum();
  let acilan = 0;
  const kapi = dikteKapisi(async () => { acilan++; return s; });
  kapi.besle(orn(1), 48000); kapi.besle(orn(2), 48000);
  kapi.baslat(); kapi.baslat();
  kapi.besle(orn(3), 48000); // oturum açılırken gelen
  const o = await kapi.oturum();
  kapi.besle(orn(4), 48000);
  assert.equal(acilan, 1);
  assert.equal(o, s);
  assert.deepEqual(s.durum.alinan, [1, 2, 3, 4]);
});

test('yol yok ("yok"): oturum null döner, örnekler tutulmaz (bellek şişmez); elle dinlemede hemen sorulabilir', async () => {
  const kapi = dikteKapisi(async () => null);
  kapi.baslat();
  assert.equal(await kapi.oturum(), null);
  kapi.besle(orn(1), 48000);
  assert.equal(await kapi.oturum(), null);
});

test('açılış sürerken vazgeçilirse açılan oturum kapatılır', async () => {
  const s = sahteOturum();
  let ac: (o: typeof s) => void = () => undefined;
  const kapi = dikteKapisi(() => new Promise<typeof s>((c) => { ac = c; }));
  kapi.baslat();
  kapi.iptal();
  ac(s);
  await bos();
  assert.equal(s.durum.iptal, 1);
  assert.deepEqual(s.durum.alinan, []);
});

test('kulak: Vosk dikteye dönmedi; ayar olayı doğrudan uygulayıcıya bağlı, soru yakalama kapıdan geçer', () => {
  const kulak = fs.readFileSync(new URL('../src/renderer/kulak.ts', import.meta.url), 'utf8');
  assert.match(kulak, /dinle\('gunkaydi:kulak', ayarUygula\)/, 'olay işleyicisi araya model koşulu koymaz');
  assert.match(kulak, /dikteKapisi\(/);
  assert.doesNotMatch(kulak, /await dinlemeAc\(/, 'oturum doğrudan, konuşma beklemeden açılmaz');
});

// ── Yanlış uyanma: konuşma duyulmadan "konuşma başladı" bildirilmez ──
/** soruBekle'yi gerçek hâliyle sürer (sahte saat): `seviyeler` her 60 ms'de bir okunan ses düzeyi. */
async function bekleyerek(t: import('node:test').TestContext, seviyeler: (adim: number) => number, sure: number): Promise<{ basladi: number; konustu: boolean | null }> {
  let simdi = 0;
  t.mock.method(performance, 'now', () => simdi);
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { soruBekle } = await import('../src/renderer/ses-yakala.ts');
  let basladi = 0, sonuc: { konustu: boolean } | null = null;
  void soruBekle(null as never, () => seviyeler(simdi / 60), true, () => undefined, () => { basladi++; }).then((r) => { sonuc = r; });
  for (; simdi < sure && !sonuc; simdi += 60) { t.mock.timers.tick(60); await new Promise<void>((c) => setImmediate(c)); }
  return { basladi, konustu: sonuc ? (sonuc as { konustu: boolean }).konustu : null };
}

test('yanlış uyanma: konuşma yoksa "konuşma başladı" hiç bildirilmez (kapı hiç açılmaz)', async (t) => {
  const r = await bekleyerek(t, () => 0.001, 8000);
  assert.deepEqual(r, { basladi: 0, konustu: false });
});

test('konuşma duyulunca "konuşma başladı" bir kez bildirilir (kapı o an açılır)', async (t) => {
  const r = await bekleyerek(t, (adim) => (adim > 15 && adim < 40 ? 0.15 : 0.001), 8000);
  assert.equal(r.konustu, true);
  assert.equal(r.basladi, 1);
});
