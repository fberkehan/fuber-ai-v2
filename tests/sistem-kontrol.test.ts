// Kurulumun sistem kontrolü (saf mantık): eşikler, kurulumu durdurmayan satırlar, takılı belleğin tahmini.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sistemDegerlendir, bellekGB, type SistemBilgisi } from '../src/shared/sistem-kontrol.ts';

const TABAN: SistemBilgisi = { platform: 'win32', surum: '10.0.22631', ramGB: 16, bosDiskGB: 120, nvidia: false, mikrofon: true };
const satir = (b: Partial<SistemBilgisi>, ad: string) => {
  const s = sistemDegerlendir({ ...TABAN, ...b }).find((x) => x.ad === ad);
  assert.ok(s, `${ad} satırı yok`);
  return s;
};

test('beş satır, sırasıyla; hepsinde kısa bir metin var (0.12 H3a: buzlu cam satırı kalktı)', () => {
  const s = sistemDegerlendir(TABAN);
  assert.deepEqual(s.map((x) => x.ad), ['İşletim sistemi', 'Bellek', 'Disk', 'Bu bilgisayardaki yapay zekâ', 'Mikrofon']);
  for (const x of s) assert.ok(x.metin.trim().length > 0, `${x.ad} metni boş`);
});

test('işletim sistemi: Windows 10 derleme 19044 (21H2) ve üstü ya da Windows 11 tamam, daha eskisi uyarı', () => {
  assert.equal(satir({ surum: '10.0.19043' }, 'İşletim sistemi').durum, 'uyari');
  assert.equal(satir({ surum: '10.0.19044' }, 'İşletim sistemi').durum, 'tamam');
  assert.equal(satir({ surum: '10.0.22631' }, 'İşletim sistemi').durum, 'tamam');
  assert.match(satir({ surum: '10.0.22631' }, 'İşletim sistemi').metin, /Windows 11/);
  assert.match(satir({ surum: '10.0.19045' }, 'İşletim sistemi').metin, /Windows 10/);
  assert.equal(satir({ surum: 'bozuk' }, 'İşletim sistemi').durum, 'uyari');
  // Mac: macOS 13 Ventura = Darwin 22.
  assert.equal(satir({ platform: 'darwin', surum: '22.1.0' }, 'İşletim sistemi').durum, 'tamam');
  assert.equal(satir({ platform: 'darwin', surum: '21.6.0' }, 'İşletim sistemi').durum, 'uyari');
});

test('bellek: 8 GB altı uyarı, 8–16 tamam ama "16 GB önerilir", 16 ve üstü tamam', () => {
  assert.equal(satir({ ramGB: 7.5 }, 'Bellek').durum, 'uyari');
  const sekiz = satir({ ramGB: 8 }, 'Bellek');
  assert.equal(sekiz.durum, 'tamam');
  assert.match(sekiz.metin, /16 GB önerilir/);
  const onalti = satir({ ramGB: 16 }, 'Bellek');
  assert.equal(onalti.durum, 'tamam');
  assert.doesNotMatch(onalti.metin, /önerilir/);
});

test('disk: 3 GB altı uyarı, 3 GB ve üstü tamam', () => {
  assert.equal(satir({ bosDiskGB: 2.9 }, 'Disk').durum, 'uyari');
  assert.equal(satir({ bosDiskGB: 3 }, 'Disk').durum, 'tamam');
  // Okunamayan sürücü: "ölçülemedi" uyarısı (NaN metne sızmaz).
  const olcusuz = satir({ bosDiskGB: Number.NaN }, 'Disk');
  assert.equal(olcusuz.durum, 'uyari');
  assert.doesNotMatch(olcusuz.metin, /NaN/);
});

// 0.12 H3a: buzlu cam teması kalktı — sistem kontrolünde de satırı yok (hiçbir Windows sürümünde "cam açılabilir" denmez).
test('buzlu cam satırı yok (0.12 H3a: tema kalktı; pencere her zaman opak)', () => {
  for (const surum of ['10.0.22621', '10.0.22000', '10.0.19045']) assert.equal(sistemDegerlendir({ ...TABAN, surum }).some((x) => /cam/i.test(x.ad + x.metin)), false, surum);
});

// Görev 15: yerel beyin kurulumda her iki modda "Ekstra gizlilik" adımında sunulur (ekran kartı şart değil: hafif model işlemcide
// çalışır). Satır bu bilgisayarın en iyi yerel seçeneğinden (model-bilgisi.ts → enIyiYerel) yazılır; eski "Geliştirici modunda
// açılabilir" / NVIDIA'sız "kullanılamaz" yanlıştı.
const yerelSatiri = (yerel: Parameters<typeof sistemDegerlendir>[1]) => sistemDegerlendir(TABAN, yerel).find((x) => x.ad === 'Bu bilgisayardaki yapay zekâ');
test('yerel beyin: en iyi seçenek rahat → kurulabilir (neden), zorlanır → öneri, çalışmaz → yok; bilinmiyorsa denetlenemedi', () => {
  assert.deepEqual(yerelSatiri({ durum: 'rahat', neden: 'Ekran kartı gerekmez; işlemcide de rahat çalışır' }), { ad: 'Bu bilgisayardaki yapay zekâ', durum: 'tamam', metin: 'Kurulabilir · Ekran kartı gerekmez; işlemcide de rahat çalışır' });
  assert.deepEqual(yerelSatiri({ durum: 'zorlanir', neden: 'Uygun ekran kartı yok; işlemcide yavaş çalışır' }), { ad: 'Bu bilgisayardaki yapay zekâ', durum: 'uyari', metin: 'Kurulabilir ama yavaş · Uygun ekran kartı yok; işlemcide yavaş çalışır' });
  assert.deepEqual(yerelSatiri({ durum: 'calismaz', neden: 'En az 6 GB bellek gerekir' }), { ad: 'Bu bilgisayardaki yapay zekâ', durum: 'yok', metin: 'Bu bilgisayarda çalışmaz · En az 6 GB bellek gerekir' });
  for (const s of [yerelSatiri(undefined), yerelSatiri(null)]) assert.deepEqual(s, { ad: 'Bu bilgisayardaki yapay zekâ', durum: 'uyari', metin: 'Denetlenemedi; sonra Ayarlar → Gizlilik’ten bakabilirsin' });
  // Ne mod ne ekran kartı şartı yazılır.
  for (const d of ['rahat', 'zorlanir', 'calismaz'] as const) assert.doesNotMatch(yerelSatiri({ durum: d, neden: 'x' })!.metin, /Geliştirici/);
});

test('I2 (sözlük P2): yerel satırın adı moda göre — İş "Bu bilgisayardaki yapay zekâ", Geliştirici "Yerel model"', () => {
  const adlar = (sade: boolean) => sistemDegerlendir(TABAN, { durum: 'rahat', neden: 'x' }, sade).map((x) => x.ad);
  assert.ok(adlar(true).includes('Bu bilgisayardaki yapay zekâ') && !adlar(true).includes('Yerel model'));
  assert.ok(adlar(false).includes('Yerel model') && !adlar(false).includes('Bu bilgisayardaki yapay zekâ'));
  assert.deepEqual(sistemDegerlendir(TABAN).map((x) => x.ad), adlar(true), 'varsayılan İş');
});

test('mikrofon: varsa "Hey Fuber ve sesli komut", yoksa kullanılamaz', () => {
  assert.deepEqual(satir({ mikrofon: true }, 'Mikrofon'), { ad: 'Mikrofon', durum: 'tamam', metin: 'Hey Fuber ve sesli komut' });
  assert.equal(satir({ mikrofon: false }, 'Mikrofon').durum, 'yok');
});

test('hiçbir satır kurulumu durdurmaz: en zayıf bilgisayarda da yalnız uyarı ve "yok" var', () => {
  const zayif = sistemDegerlendir({ platform: 'win32', surum: '10.0.18363', ramGB: 4, bosDiskGB: 0.5, nvidia: false, mikrofon: false });
  assert.ok(zayif.every((x) => x.durum === 'uyari' || x.durum === 'yok'));
  assert.equal(zayif.length, 5); // 0.12 H3a: buzlu cam satırı kalktı
});

test('takılı bellek tahmini: işletim sisteminin ayırdığı payı geri ekler, standart boya yuvarlar', () => {
  const GiB = 2 ** 30;
  assert.equal(bellekGB(15.7 * GiB), 16); // 16 GB bilgisayar ~15,7 GiB görünür
  assert.equal(bellekGB(13.9 * GiB), 16); // tümleşik ekran kartı 2 GB ayırmış
  assert.equal(bellekGB(7.8 * GiB), 8);
  assert.equal(bellekGB(31.8 * GiB), 32);
  assert.equal(bellekGB(10 * GiB), 10); // standart boya yakın değil: olduğu gibi (yuvarlanmış)
});

// 8 GB'lık dizüstünde tümleşik ekran kartı 1,5–2 GB ayırır: Windows 5,9–6,5 GiB gösterir. Bu bilgisayara "en az 8 GB gerekir"
// denmemeli (8 GB sınıfı sayılır); gerçekten küçük bellek (4 GB, 5 GiB) yine uyarılır.
test('takılı bellek tahmini: tümleşik ekran kartı 2 GB ayıran 8 GB dizüstü 8 GB sınıfıdır, uyarılmaz', () => {
  const GiB = 2 ** 30;
  for (const gorunen of [5.5, 5.9, 6.5, 7.2]) {
    const gb = bellekGB(gorunen * GiB);
    assert.equal(gb, 8, `${gorunen} GiB → ${gb}`);
    const s = satir({ ramGB: gb }, 'Bellek');
    assert.equal(s.durum, 'tamam', `${gorunen} GiB: ${s.metin}`);
    assert.doesNotMatch(s.metin, /en az 8 GB/);
  }
  assert.equal(satir({ ramGB: bellekGB(3.8 * GiB) }, 'Bellek').durum, 'uyari'); // 4 GB
  assert.equal(satir({ ramGB: bellekGB(5 * GiB) }, 'Bellek').durum, 'uyari');
});

test('Ruling CB: mikrofon bilgisi verilmezse (Ses adımı sayar) Mikrofon satırı yok; öteki beş satır yerinde', () => {
  const { mikrofon: _m, ...b } = TABAN;
  const l = sistemDegerlendir(b);
  assert.deepEqual(l.map((s) => s.ad), ['İşletim sistemi', 'Bellek', 'Disk', 'Bu bilgisayardaki yapay zekâ']);
  assert.equal(sistemDegerlendir({ ...TABAN, mikrofon: false }).at(-1)?.ad, 'Mikrofon');
});
