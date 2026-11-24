// Uyandırma (0.13 T8): "Hey Fuber" kapısı. Motor (sherpa-onnx WASM) yavaş ve dış bağımlılık olduğu için kilit/yaşam döngüsü testlerinde
// yalnız motor sahtedir; kapı gerçektir. "Tek başına hey" testi gerçek WASM + gerçek modelle, gerçek sesle koşar (sahte motor bunu kanıtlayamaz).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { isciMotoru, uyandiriciKur, UYANMA_BOS_MS, type IsciBenzeri, type MotorAcici } from '../src/renderer/uyandirma.ts';
import { soruBekle } from '../src/renderer/ses-yakala.ts';
import { kwsAc } from '../src/renderer/uyandirma-motor.ts';
import { kulakKarari, UYANDIRMA_AYARI, UYANDIRMA_DUSTU_METNI, uyandirmaGecisi } from '../src/shared/uyandirma-ayar.ts';
import { vadAdim, vadBaslat, SESSIZLIK_MS } from '../src/shared/konusma-sonu.ts';
import { wavdanPcm } from '../src/shared/pcm.ts';
import { UCUNCU_TARAF } from '../src/shared/ucuncu-taraf.ts';
import { yerelYollar } from '../scripts/dev/uyandirma/wasm-yol-temizle.mjs';

const KOK = join(import.meta.dirname, '..');
const KAYNAK = join(KOK, 'resources/uyandirma');

/** Depodaki WASM + model: pakete giren dosyaların aynısı, Node'da. */
async function gercekMotor(): Promise<MotorAcici> {
  const require = createRequire(import.meta.url);
  const SherpaKws = require(join(KAYNAK, 'sherpa-onnx-wasm-kws-main.js'));
  const { createKws } = require(join(KAYNAK, 'sherpa-onnx-kws.js'));
  const modul = await SherpaKws({ locateFile: (f: string) => join(KAYNAK, f) });
  const dosyalar = Object.fromEntries(Object.values(UYANDIRMA_AYARI.dosyalar).map((f) => [f, readFileSync(join(KAYNAK, f))]));
  return async (bulundu) => kwsAc(modul, createKws, dosyalar, UYANDIRMA_AYARI, bulundu);
}

/** tests/veri klibini (16 kHz PCM16) bloklar hâlinde kapıdan geçirir. */
function klipBesle(u: { besle(o: Float32Array, hz: number): void }, ad: string): void {
  const w = wavdanPcm(new Uint8Array(readFileSync(join(KOK, 'tests/veri', ad))));
  assert.ok(w && w.hz === 16000);
  const i = new Int16Array(w.pcm.slice().buffer);
  for (let k = 0; k < i.length; k += 1365) u.besle(Float32Array.from(i.subarray(k, k + 1365), (x) => x / 32768), 16000);
}

/** Sahte motor: gelen sesi tutar; `soyle` motorun anahtar sözcük bildirmesini taklit eder. */
function sahte() {
  const gelen: Float32Array[] = [];
  let bildir: (anahtar: string) => void = () => undefined;
  let kapandi = 0;
  const ac: MotorAcici = async (bulundu) => {
    bildir = bulundu;
    return { besle: (o) => { gelen.push(o); }, kapat: () => { kapandi++; } };
  };
  return { ac, gelen, soyle: (a = 'hey_fuber') => bildir(a), kapandi: () => kapandi };
}
const hazir = () => new Promise((c) => setTimeout(c, 0));

test('arka arkaya iki uyanma arasında 1500 ms kilit', async () => {
  const s = sahte();
  let t = 10_000;
  const olaylar: number[] = [];
  uyandiriciKur({ motorAc: s.ac, simdi: () => t }, () => olaylar.push(t));
  await hazir();
  s.soyle();        // 10000: uyanır
  t += 1499; s.soyle(); // 11499: kilitli
  t += 1; s.soyle();    // 11500: kilit bitti, uyanır
  t += 1; s.soyle();    // 11501: yeni kilit
  assert.deepEqual(olaylar, [10_000, 11_500]);
});

test('kapatılınca motor bir kez kapanır, geç gelen bildirim uyandırmaz, ses motora gitmez', async () => {
  const s = sahte();
  let olay = 0;
  const u = uyandiriciKur({ motorAc: s.ac }, () => { olay++; });
  await hazir();
  u.kapat();
  u.kapat();
  s.soyle();
  u.besle(new Float32Array(1600), 16000);
  assert.equal(olay, 0);
  assert.equal(s.kapandi(), 1);
  assert.equal(s.gelen.length, 0);
});

test('motor açılırken kapatılırsa açılan motor da kapanır (mikrofon/işçi sızmaz)', async () => {
  const s = sahte();
  const u = uyandiriciKur({ motorAc: s.ac }, () => undefined);
  u.kapat();
  await hazir();
  assert.equal(s.kapandi(), 1);
});

/** Sahte saatte (mock timers) söz çözülmesi için mikro görevleri boşaltır. */
const isle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('motor açılamazsa bir kez söylenir, 30 sn sonra BİR kez yeniden dener, yine açılmazsa vazgeçer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let deneme = 0;
  const durumlar: string[] = [];
  const u = uyandiriciKur({ motorAc: async () => { deneme++; throw new Error('wasm yok'); }, durum: (d) => durumlar.push(d) }, () => undefined);
  await isle();
  assert.deepEqual(durumlar, ['dustu']);
  t.mock.timers.tick(29_999); await isle();
  assert.equal(deneme, 1); // 30 sn dolmadan denenmez
  t.mock.timers.tick(1); await isle();
  assert.equal(deneme, 2);
  assert.deepEqual(durumlar, ['dustu', 'vazgecti']);
  t.mock.timers.tick(600_000); await isle();
  assert.equal(deneme, 2); // bir kez: döngüye girmez
  u.kapat();
});

test('motor ilk denemede açılınca da çalışıyor bildirir: ana sürecin bayat hâli böyle biter', async () => {
  const s = sahte();
  const durumlar: string[] = [];
  const u = uyandiriciKur({ motorAc: s.ac, durum: (d) => durumlar.push(d) }, () => undefined);
  await hazir();
  assert.deepEqual(durumlar, ['calisiyor']);
  u.kapat();
});

test('yeniden deneme tutarsa durum düzelir ve ses yeniden motora gider', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let deneme = 0;
  const gelen: Float32Array[] = [];
  const durumlar: string[] = [];
  const u = uyandiriciKur({
    motorAc: async () => { if (++deneme === 1) throw new Error('ilk'); return { besle: (o) => { gelen.push(o); }, kapat: () => undefined }; },
    durum: (d) => durumlar.push(d),
  }, () => undefined);
  await isle();
  u.besle(new Float32Array(1600), 16000);
  assert.equal(gelen.length, 0); // düşmüşken ses bekletilmez
  t.mock.timers.tick(30_000); await isle();
  u.besle(new Float32Array(1600), 16000);
  assert.equal(gelen.length, 1);
  assert.deepEqual(durumlar, ['dustu', 'calisiyor']);
  u.kapat();
});

test('çalışırken düşerse yeniden dener; deneme hakkı bir kez: ikinci düşüşte vazgeçer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dus: (() => void)[] = [];
  const durumlar: string[] = [];
  let acilan = 0, kapanan = 0;
  const u = uyandiriciKur({
    motorAc: async (_b, dustu) => { acilan++; dus.push(dustu); return { besle: () => undefined, kapat: () => { kapanan++; } }; },
    durum: (d) => durumlar.push(d),
  }, () => undefined);
  await isle();
  dus[0]();
  dus[0](); // işçi hatası iki kez gelse de kullanıcı bir kez duyar
  assert.deepEqual(durumlar, ['calisiyor', 'dustu']);
  assert.equal(kapanan, 1); // düşen motor kapatılır
  t.mock.timers.tick(30_000); await isle();
  assert.equal(acilan, 2);
  dus[1]();
  t.mock.timers.tick(600_000); await isle();
  assert.equal(acilan, 2);
  assert.deepEqual(durumlar, ['calisiyor', 'dustu', 'calisiyor', 'vazgecti']);
  u.kapat();
});

test('kapatılınca bekleyen yeniden deneme iptal olur (kapalı ayar motor açmaz)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let deneme = 0;
  const durumlar: string[] = [];
  const u = uyandiriciKur({ motorAc: async () => { deneme++; throw new Error('yok'); }, durum: (d) => durumlar.push(d) }, () => undefined);
  await isle();
  u.kapat();
  t.mock.timers.tick(60_000); await isle();
  assert.equal(deneme, 1);
  assert.deepEqual(durumlar, ['dustu']);
});

test('kullanıcı kapattıktan sonra gelen düşme bildirilmez', async () => {
  const durumlar: string[] = [];
  let dus: () => void = () => undefined;
  const u = uyandiriciKur({ motorAc: async (_b, dustu) => { dus = dustu; return { besle: () => undefined, kapat: () => undefined }; }, durum: (d) => durumlar.push(d) }, () => undefined);
  await hazir();
  u.kapat(); // işçi sonlandırılınca da hata olayı gelebilir: uyarı çıkmamalı
  dus();
  assert.deepEqual(durumlar, ['calisiyor']);
});

test('besle hiçbir zaman atmaz: motor hatası kulakta gün kaydı satırlarını atlatmaz, düşme sayılır', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const durumlar: string[] = [];
  const u = uyandiriciKur({
    motorAc: async () => ({ besle: () => { throw new Error('DataCloneError'); }, kapat: () => undefined }),
    durum: (d) => durumlar.push(d),
  }, () => undefined);
  await isle();
  assert.doesNotThrow(() => u.besle(new Float32Array(1600), 16000));
  assert.deepEqual(durumlar, ['calisiyor', 'dustu']);
  u.kapat();
});

/** Elle sürülen sahte işçi: mesajları tutar, yanıtları test verir. */
function sahteIsci() {
  const gelen: { tur: string }[] = [];
  let sonlandi = 0;
  const w: IsciBenzeri = {
    onmessage: null,
    onerror: null,
    postMessage: (v) => { gelen.push(v as { tur: string }); },
    terminate: () => { sonlandi++; },
  };
  const yanit = (tur: string, ek: object = {}) => w.onmessage?.({ data: { tur, ...ek } } as MessageEvent);
  return { w, gelen, yanit, sonlandi: () => sonlandi };
}

test('işçi açılışta hiç ilerleme bildirmezse 45 sn sonra sonlandırılır, açılış reddedilir', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const s = sahteIsci();
  let hata: Error | null = null;
  isciMotoru(() => undefined, () => undefined, () => s.w).catch((e: Error) => { hata = e; });
  t.mock.timers.tick(44_999); await isle();
  assert.equal(hata, null);
  t.mock.timers.tick(1); await isle();
  assert.ok(hata, 'açılış reddedilmeli');
  assert.equal(s.sonlandi(), 1);
});

test('yavaş diskte model okunurken ilerleme geldikçe açılış çökme sayılmaz, toplam süre kaç olursa olsun', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const s = sahteIsci();
  let hata: Error | null = null;
  let dustu = 0;
  const p = isciMotoru(() => undefined, () => { dustu++; }, () => s.w);
  p.catch((e: Error) => { hata = e; });
  for (let i = 0; i < 10; i++) { t.mock.timers.tick(30_000); await isle(); s.yanit('ilerleme'); } // 5 dakika, hep ilerliyor
  assert.equal(hata, null);
  assert.equal(s.sonlandi(), 0);
  s.yanit('hazir');
  const m = await p;
  t.mock.timers.tick(600_000);
  assert.equal(dustu, 0); // açılış zamanlayıcısı hazırdan sonra düşürmez
  m.kapat();
});

test('ilerleme kesilirse açılış son ilerlemeden 45 sn sonra düşer (takılan okuma sonsuza dek bekletmez)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const s = sahteIsci();
  let hata: Error | null = null;
  isciMotoru(() => undefined, () => undefined, () => s.w).catch((e: Error) => { hata = e; });
  t.mock.timers.tick(40_000); await isle();
  s.yanit('ilerleme');
  t.mock.timers.tick(44_999); await isle();
  assert.equal(hata, null);
  t.mock.timers.tick(1); await isle();
  assert.ok(hata);
});

test('hazır olan işçi sesi işlemeyi bırakırsa 10 sn içinde düşmüş sayılır', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const s = sahteIsci();
  let dustu = 0;
  const p = isciMotoru(() => undefined, () => { dustu++; }, () => s.w);
  s.yanit('hazir');
  const m = await p;
  m.besle(new Float32Array(1600));
  t.mock.timers.tick(8_000);
  assert.equal(dustu, 0);
  t.mock.timers.tick(2_000);
  assert.equal(dustu, 1);
  assert.equal(s.sonlandi(), 1);
});

test('işçi yanıt verdikçe nöbetçi düşürmez; ses yokken sessizlik düşme sayılmaz', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const s = sahteIsci();
  let dustu = 0;
  const p = isciMotoru(() => undefined, () => { dustu++; }, () => s.w);
  s.yanit('hazir');
  const m = await p;
  for (let i = 0; i < 20; i++) { m.besle(new Float32Array(1600)); t.mock.timers.tick(2_000); s.yanit('islendi'); } // yavaş ama yaşıyor
  t.mock.timers.tick(600_000); // soru yakalanırken ses gitmez: işçi boşta
  assert.equal(dustu, 0);
  m.kapat();
  m.besle(new Float32Array(1600));
  t.mock.timers.tick(600_000);
  assert.equal(dustu, 0); // kapatınca nöbetçi durur
});

test('motor kurulamazsa (geçersiz tutamaç) açılış reddedilir: bozuk motor "hazır" sanılmaz', () => {
  const modul = { FS: { mkdirTree: () => undefined, writeFile: () => undefined }, lengthBytesUTF8: () => 0 };
  const kurulamadi = () => ({ handle: 0 }) as never;
  assert.throws(() => kwsAc(modul, kurulamadi, {}, UYANDIRMA_AYARI, () => undefined), /kurulamadı/);
});

test('48 kHz mikrofon sesi motora 16 kHz ve −1…1 aralığında gider (parçalar arası kesinti yok)', async () => {
  const s = sahte();
  const u = uyandiriciKur({ motorAc: s.ac }, () => undefined);
  await hazir();
  // 1 sn, 440 Hz, genlik 0,5: 4096 örneklik parçalarla (ScriptProcessor gibi).
  const n = 48000, sin = new Float32Array(n);
  for (let i = 0; i < n; i++) sin[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / 48000);
  for (let i = 0; i < n; i += 4096) u.besle(sin.slice(i, i + 4096), 48000);
  const o = new Float32Array(s.gelen.reduce((t, p) => t + p.length, 0));
  let k = 0;
  for (const p of s.gelen) { o.set(p, k); k += p.length; }
  assert.ok(Math.abs(o.length - 16000) < 40, `örnek sayısı ${o.length}`);
  const tepe = o.subarray(1000).reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  assert.ok(tepe > 0.47 && tepe < 0.53, `tepe ${tepe}`); // Int16'ya sayıya bölünmeden kalırsa tepe ≈ 16384 olur
  // 440 Hz'te 16 kHz örnekler arası en büyük fark 0,5 · 2π · 440/16000 ≈ 0,086. Örnekleyici parça başına sıfırlansa süzgeç geçmişi silinir, sınırda sıçrar.
  let sicrama = 0;
  for (let i = 1000; i < o.length - 1; i++) sicrama = Math.max(sicrama, Math.abs(o[i + 1] - o[i]));
  assert.ok(sicrama < 0.1, `sıçrama ${sicrama}`);
});

test('uyandıktan 3 sn konuşma yoksa olay boş: 3 sn dolmadan bekler, dolunca bırakır', () => {
  const d = vadBaslat(0);
  assert.equal(vadAdim(d, 0.006, 2940, SESSIZLIK_MS, UYANMA_BOS_MS), 'surer');
  assert.equal(vadAdim(d, 0.006, 3060, SESSIZLIK_MS, UYANMA_BOS_MS), 'bos');
  assert.equal(d.konustu, false); // konuşma sayılmadı: kulak 'metin' değil 'bos' bildirir, sohbete bir şey yazılmaz
});

test('uyandıktan sonra konuşma başladıysa 3 sn kuralı işlemez (uzun soru kesilmez)', () => {
  const d = vadBaslat(0);
  assert.equal(vadAdim(d, 0.12, 2000, SESSIZLIK_MS, UYANMA_BOS_MS), 'surer');
  assert.equal(d.konustu, true);
  assert.equal(vadAdim(d, 0.12, 3500, SESSIZLIK_MS, UYANMA_BOS_MS), 'surer');
});

test('elle dinlemede (varsayılan) boş süresi 6 sn kalır', () => {
  const d = vadBaslat(0);
  assert.equal(vadAdim(d, 0.006, 5940), 'surer');
  assert.equal(vadAdim(d, 0.006, 6060), 'bos');
});

/** konusmaYakala'yı gerçek hâliyle sürer: yalnız saat sahte. Seviye hep gürültü tabanında (hiç konuşma yok). */
async function sessizlikteBiter(t: import('node:test').TestContext, uyandirmayla: boolean): Promise<{ ms: number | null; konustu: boolean | null }> {
  let simdi = 0;
  t.mock.method(performance, 'now', () => simdi);
  t.mock.timers.enable({ apis: ['setInterval'] });
  let sonuc: { konustu: boolean } | null = null;
  void soruBekle(null as never, () => 0.001, uyandirmayla, () => undefined).then((r) => { sonuc = r; });
  for (; simdi < 8000 && !sonuc; simdi += 60) { t.mock.timers.tick(60); await isle(); }
  return { ms: sonuc ? simdi : null, konustu: sonuc ? (sonuc as { konustu: boolean }).konustu : null };
}

test('lisans bildirimi WASM içinde olduğu sayılan her bileşeni anar (wasm-icerik.mjs); uygulama listesi de', () => {
  const basliklar = readFileSync(join(KAYNAK, 'LISANSLAR.txt'), 'utf8').split('\n').filter((s) => s.startsWith('==== '));
  for (const ad of ['sherpa-onnx', 'ONNX Runtime v1.28.2', 'ONNX v1.22.0', 'Abseil', 'RE2', 'Protocol Buffers', 'FlatBuffers', 'GSL', 'SafeInt', 'Mp11', 'Eigen', 'nlohmann/json', 'KISS FFT', 'Emscripten', 'libc++', 'compiler-rt', 'musl', 'dlmalloc']) {
    assert.ok(basliklar.some((b) => b.includes(ad)), ad);
  }
  const giris = UCUNCU_TARAF.find((x) => x.ad === 'sherpa-onnx');
  assert.ok(giris);
  for (const ad of ['ONNX Runtime', 'ONNX,', 'RE2', 'Protocol Buffers', 'Abseil', 'Emscripten']) assert.ok(giris.atif.includes(ad), ad);
  assert.ok(readFileSync(join(KAYNAK, 'ThirdPartyNotices-onnxruntime.txt'), 'utf8').startsWith('THIRD PARTY SOFTWARE NOTICES'));
});

test('dağıtılan WASM: geçerli, yerel derleme yolu taşımaz; gerçek motor modelle açılır, sesi işler, gürültüde uyanmaz', async () => {
  const wasm = readFileSync(join(KAYNAK, 'sherpa-onnx-wasm-kws-main.wasm'));
  assert.ok(WebAssembly.validate(wasm));
  assert.deepEqual(yerelYollar(wasm), [], '__FILE__ yolları nötr olmalı: scripts/dev/uyandirma/wasm-yol-temizle.mjs');
  const ac = await gercekMotor();
  const uyanmalar: string[] = [];
  const motor = await ac((a) => { uyanmalar.push(a); }, () => undefined);
  let tohum = 1;
  const gurultu = () => { tohum = (Math.imul(tohum, 1103515245) + 12345) >>> 0; return (tohum / 4294967296 - 0.5) * 0.002; };
  for (let k = 0; k < 30; k++) motor.besle(Float32Array.from({ length: 1600 }, gurultu)); // 3 sn, −60 dBFS civarı
  motor.kapat();
  assert.deepEqual(uyanmalar, []);
});

test('uyanmayla açılan dinleme konuşma gelmezse 3 sn\'de biter (gerçek konusmaYakala üzerinden)', async (t) => {
  const r = await sessizlikteBiter(t, true);
  assert.equal(r.konustu, false);
  assert.ok(r.ms !== null && r.ms >= 3000 && r.ms <= 3200, String(r.ms));
});

test('elle açılan dinleme konuşma gelmezse 6 sn bekler (gerçek konusmaYakala üzerinden)', async (t) => {
  const r = await sessizlikteBiter(t, false);
  assert.equal(r.konustu, false);
  assert.ok(r.ms !== null && r.ms >= 6000 && r.ms <= 6200, String(r.ms));
});

test('uyandırma vazgeçince gün kaydı kapalıysa kulak gerekmez (mikrofon bırakılır), gün kaydı açıksa kalır', () => {
  const k = { durum: 'calisiyor', mikrofonKapali: false, uyandirma: true, gunKaydi: false, kurulumTamam: true } as const;
  assert.equal(kulakKarari(k).gerekli, true);
  assert.equal(kulakKarari({ ...k, durum: 'dustu' }).gerekli, true); // yeniden deneme bekliyor: kulak kalır
  assert.equal(kulakKarari({ ...k, durum: 'vazgecti' }).gerekli, false); // mikrofon gerçekten bırakılır
  assert.equal(kulakKarari({ ...k, durum: 'vazgecti', gunKaydi: true }).gerekli, true); // gün kaydı sürer
  assert.equal(kulakKarari({ ...k, uyandirma: false, gunKaydi: false }).gerekli, false);
  assert.equal(kulakKarari({ ...k, mikrofonKapali: true, gunKaydi: true }).gerekli, false);
  assert.equal(kulakKarari({ ...k, kurulumTamam: false }).gerekli, false);
});

test('bayat durum: kullanıcı kapatınca düşme hâli biter, kulak penceresi yaşasa da değişiklik görülür', () => {
  const k = { durum: 'vazgecti', mikrofonKapali: false, uyandirma: true, gunKaydi: true, kurulumTamam: true } as const;
  assert.equal(kulakKarari(k).durum, 'vazgecti'); // ayar açıkken sürer: sessizce temizlenmez
  assert.deepEqual(kulakKarari({ ...k, uyandirma: false }), { durum: 'calisiyor', gerekli: true }); // pencere gün kaydı için yaşıyor, ama durum değişti
  assert.deepEqual(kulakKarari({ ...k, uyandirma: false, gunKaydi: false }), { durum: 'calisiyor', gerekli: false });
  assert.equal(kulakKarari({ ...k, mikrofonKapali: true }).durum, 'calisiyor');
});

test('bayat durum: pencere yeniden kurulup motor ilk denemede açılınca, gün kaydı kapanması çalışan "Hey Fuber"i kapatmaz', async () => {
  // Gün kaydı açıkken vazgeçti; pencere yenilendi; yeni kulak motoru ilk denemede açtı. Bildirimi ana sürecin geçişinden geçirilir.
  let ana = uyandirmaGecisi('dustu', 'vazgecti').durum;
  const s = sahte();
  const u = uyandiriciKur({ motorAc: s.ac, durum: (d) => { ana = uyandirmaGecisi(ana, d).durum; } }, () => undefined);
  await hazir();
  assert.equal(ana, 'calisiyor');
  assert.equal(kulakKarari({ durum: ana, mikrofonKapali: false, uyandirma: true, gunKaydi: false, kurulumTamam: true }).gerekli, true);
  u.kapat();
});

test('ana süreç geçişi: ilk düşüşte bir kez söyler, vazgeçince kulağı yeniler, düzelince sessiz', () => {
  assert.deepEqual(uyandirmaGecisi('calisiyor', 'dustu'), { durum: 'dustu', soyle: true, kulakYenile: false });
  assert.deepEqual(uyandirmaGecisi('dustu', 'vazgecti'), { durum: 'vazgecti', soyle: false, kulakYenile: true });
  assert.deepEqual(uyandirmaGecisi('dustu', 'calisiyor'), { durum: 'calisiyor', soyle: false, kulakYenile: false });
  assert.deepEqual(uyandirmaGecisi('calisiyor', 'vazgecti'), { durum: 'vazgecti', soyle: true, kulakYenile: true }); // hiç söylenmediyse söyle
  assert.equal(UYANDIRMA_DUSTU_METNI, '“Hey Fuber” şu an çalışmıyor; kısayolla konuşabilirsin.');
});
