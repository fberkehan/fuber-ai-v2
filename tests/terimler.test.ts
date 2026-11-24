// 0.10 Görev 3 (P2; A-4 = C-5, A-58, A-60 = D-6, D-11'in ad kısmı): tek sözlük. Aynı kavram her yerde aynı adla anılır (src/shared/
// terimler.ts TERIM); "beyin" sözcüğü masaüstü arayüzünde hiç yok (3B beyin kalktı, mecazı da kalkar — D1); "motor" yalnız Geliştirici'de
// (İş dili: src/shared/is-dili.ts IS_YASAK, tests/is-dili.test.ts). Telefon arayüzü (src/renderer/cep/, cep.tsx) taranmaz (P8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { TERIM } from '../src/shared/terimler.ts';
import { genelKisayolSorunu } from '../src/shared/genel-kisayol.ts';
import { kisayolElectron, kisayolGosterimi } from '../src/shared/kisayol.ts';
import { isDiliIhlali } from '../src/shared/is-dili.ts';
import { modaGore } from '../src/shared/ayar-arama.ts';
import { KATEGORILER, AYAR_TANIMLARI } from '../src/renderer/ayarlar/dizin.ts';
import { VERI_KAYNAKLARI, ucuncuTarafMetni } from '../src/shared/ucuncu-taraf.ts';
import { gorunenMetinler } from './yardimci/gorunen-metin.ts';

const kok = path.resolve(import.meta.dirname, '..');
const goreli = (y: string) => path.relative(kok, y).replace(/\\/g, '/');
const oku = (y: string) => fs.readFileSync(path.join(kok, y), 'utf8');
function dosyalar(dizin: string, uzanti: RegExp): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(kok, dizin), { withFileTypes: true })) {
    const y = path.join(dizin, e.name);
    if (e.isDirectory()) out.push(...dosyalar(y, uzanti));
    else if (uzanti.test(e.name)) out.push(y.replace(/\\/g, '/'));
  }
  return out;
}

/** Türkçe ünlü düşmesi: beyin, beyni, beyne, beynin, beyinle … ("beyaz", "Bey", "Deniz Bey’e", "beynelmilel" yakalanmaz). */
const BEYIN = /bey(?:in|n(?!elmilel)[aeıiuü])/i;
/** P2: "Meseleler" → "Takip edilecekler" (Kokpit kartı, Hafıza sekmesi, raporun alt bölümü, not tutucunun notu, sohbetteki araç adımı). */
const MESELE = /mesele/i;

/** Masaüstü arayüzü (telefon hariç, P8) + ortak metinler + arayüze ileti gönderen ana süreç modülleri (yerel model, Gizli mod, gün kaydı).
 *  I2: kurulum sihirbazı (Kurulum.tsx, renderer/kurulum/, kurulum-adimlari.ts) da taranır — R27'nin geçici dışlama listesi kalktı. */
function taranacaklar(): string[] {
  const renderer = dosyalar('src/renderer', /\.tsx?$/).filter((y) => !/^src\/renderer\/(cep\/|cep\.tsx$)/.test(y));
  const shared = fs.readdirSync(path.join(kok, 'src/shared')).filter((f) => f.endsWith('.ts')).map((f) => `src/shared/${f}`);
  const ana = [...dosyalar('src/main/yerel', /\.ts$/), 'src/main/motor/secici.ts', 'src/main/motor/yerel.ts', 'src/main/gunkaydi/dusunme.ts'];
  return [...renderer, ...shared, ...ana];
}
/** Ajanın sohbette görünen araç adımları (`etiket`) ve araç kartındaki kısa sonuç (`ozet`; ajan/dongu.ts karta yazar): bütün araç
 *  dosyaları. Açıklamalar ve sonuçların `icerik`i modele gider, taranmaz. */
const ARAC_ETIKETLERI = dosyalar('src/main/ajan/araclar', /\.ts$/);
const ARAC_GORUNEN = new Set(['etiket', 'ozet']);

test('TERIM: sözlüğün tek kaynağı (P2)', () => {
  assert.deepEqual({ ...TERIM }, {
    yzBulut: 'Fuber’in yapay zekâsı', yzYerel: 'bu bilgisayardaki yapay zekâ', yerelModel: 'yerel model', gunKaydi: 'Gün kaydı',
    kendiliginden: 'Fuber kendiliğinden yazsın', notlarRaporlar: 'Not tutma ve raporlar', dokum: 'yazıya dökülen konuşma',
    takip: 'Takip edilecekler', sabit: 'Sabit',
    // 0.11 G4: kokpit kartı "Yapılacaklar"; "Görevler" süreli işlere gider (G9–G10).
    yapilacaklar: 'Yapılacaklar', gorevler: 'Görevler', gorev: 'Görev',
  });
});

test('masaüstü arayüz metninde "beyin" yok (telefon hariç; sihirbaz dahil; beyin.ts anatomi alanı telefonun)', () => {
  const l = taranacaklar();
  assert.ok(l.length > 120, `taranan ${l.length} dosya`);
  for (const y of ['src/renderer/sayfalar/Kurulum.tsx', 'src/renderer/kurulum/YerelAdimi.tsx', 'src/shared/kurulum-adimlari.ts']) assert.ok(l.includes(y), `sihirbaz taranır: ${y}`);
  const bulunan = l.flatMap((y) => gorunenMetinler(y, oku(y), { atlaOzellik: y === 'src/shared/beyin.ts' ? new Set(['anatomi']) : undefined })
    .filter((m) => BEYIN.test(m.metin)).map((m) => `${y}:${m.satir} «${m.metin.slice(0, 90)}»`));
  assert.deepEqual(bulunan, []);
  // Tarayıcı gerçekten yakalar: JSX metni, boşluklu dizgi, şablon, tek sözcüklü etiket; yorum, yol ve günlük satırı değil.
  const ornek = gorunenMetinler('a.tsx', [
    "// Yerel beyin yorumu, kesme işaretli: Fuber'in `beyni`",
    "import x from './beyin';",
    "const a = 'Fuber bulut beyni'; const b = `${x} beynin`; const c = 'Beyin'; const d = 'beyin:durum';",
    "console.info('[ses] yerel beyinden bağımsız');",
    'const e = <p className="yerel beyin">Beyni izle</p>;',
    // Düzeltme turu 1: küçük harfli ve TAMAMI BÜYÜK tek sözcük, ifadeye bitişik şablon da görünen metindir; kimlik ("yerel-beyin"),
    // kanal ("beyin:durum"), yol ve karşılaştırılan anahtar (ad === 'beyin') değildir.
    "const f = 'beyni'; const g = 'BEYIN'; const h = `${x}beyni`; const i = 'yerel-beyin'; const j = `${x}/beyin`; const k = ad === 'beyin' ? 1 : 2;",
    "switch (ad) { case 'beyin': break; }",
  ].join('\n')).map((m) => m.metin);
  assert.deepEqual(ornek, ['Fuber bulut beyni', '… beynin', 'Beyin', 'Beyni izle', 'beyni', 'BEYIN', '…beyni']);
});

test('görünen metinde "mesele" yok — sözlükte "Takip edilecekler" (P2; sohbetteki araç adımları dahil)', () => {
  // I2: gündem türü "Mesele" (PanoKartlari.tsx) ve gün özetindeki "açık mesele" (gunozeti.ts) de "Takip edilecek(ler)" oldu — G4'ün geçici
  // dışlama listesi kalktı.
  const l = taranacaklar();
  for (const y of ['src/renderer/pano/PanoKartlari.tsx', 'src/shared/gunozeti.ts']) assert.ok(l.includes(y), `taranır: ${y}`);
  const metin = (y: string) => gorunenMetinler(y, oku(y), { atlaOzellik: y === 'src/shared/beyin.ts' ? new Set(['anatomi']) : undefined });
  // Küçük harfli tek parça yazılar ('meseleler' sekme/kart kimliği, 'mesele' gündem türü) anahtardır, görünen metin değil.
  const bulunan = [
    ...l.flatMap((y) => metin(y).filter((m) => !m.sozcuk && MESELE.test(m.metin)).map((m) => `${y}:${m.satir} «${m.metin.slice(0, 90)}»`)),
    ...ARAC_ETIKETLERI.flatMap((y) => gorunenMetinler(y, oku(y), { yalnizOzellik: ARAC_GORUNEN })
      .filter((m) => MESELE.test(m.metin)).map((m) => `${y}:${m.satir} «${m.metin}»`)),
  ];
  assert.deepEqual(bulunan, []);
  assert.ok(ARAC_ETIKETLERI.includes('src/main/ajan/araclar/gunkaydi.ts'), 'gün kaydı araçları taranır');
  // I2: araç kartının `ozet`i de görünen metindir (gunkaydi.ts "N mesele" → "N takip edilecek iş").
  assert.deepEqual(gorunenMetinler('a.ts', 'const r = { icerik: `modele ${n} mesele`, ozet: `${n} mesele` };', { yalnizOzellik: ARAC_GORUNEN }).map((m) => m.metin), ['… mesele']);
  // `yalnizOzellik` gerçekten yalnız o özelliğin değerini okur.
  assert.deepEqual(gorunenMetinler('a.ts', "const a = { etiket: () => 'Açık işlere bakıyor', aciklama: 'Modele giden açıklama metni' };", { yalnizOzellik: new Set(['etiket']) })
    .map((m) => m.metin), ['Açık işlere bakıyor']);
});

test('Gizli mod iletileri (secici.ts GIZLI_MOD_*): iki modda aynı sade metin — "beyin" yok, İş dilinde', () => {
  const k = oku('src/main/motor/secici.ts');
  const sabitler = Object.fromEntries([...k.matchAll(/export const (GIZLI_MOD_\w+) = '([^']*)'/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(Object.keys(sabitler).sort(), ['GIZLI_MOD_ACILDI_DURDU', 'GIZLI_MOD_HAZIR_DEGIL']);
  assert.equal(sabitler.GIZLI_MOD_HAZIR_DEGIL, 'Gizli mod açık: Fuber yalnız bu bilgisayardaki yapay zekâyla çalışır, ama o şu an hazır değil. Ayarlar → Gizlilik.');
  assert.equal(sabitler.GIZLI_MOD_ACILDI_DURDU, 'Gizli mod açıldı: süren yanıt buluta gönderilmeden durduruldu.');
  for (const [ad, m] of Object.entries(sabitler)) { assert.doesNotMatch(m, BEYIN, ad); assert.equal(isDiliIhlali(m), null, ad); }
});

test('kısayol gösterimi: Electron hızlandırıcısı → okunur tuşlar (Boşluk, Ctrl; Mac’te ⌘)', () => {
  assert.equal(kisayolGosterimi('CommandOrControl+Shift+Space'), 'Ctrl+Shift+Boşluk');
  assert.equal(kisayolGosterimi('Alt+Shift+Q'), 'Alt+Shift+Q');
  assert.equal(kisayolGosterimi('CommandOrControl+Shift+Space', true), '⌘+Shift+Boşluk');
  assert.equal(kisayolGosterimi('CmdOrCtrl+Alt+F9'), 'Ctrl+Alt+F9');
  assert.equal(kisayolGosterimi('Control+Shift+K'), 'Ctrl+Shift+K');
  assert.equal(kisayolGosterimi('Command+Shift+Escape', true), '⌘+Shift+Esc');
  assert.equal(kisayolGosterimi('Alt+Space'), 'Alt+Boşluk');
  assert.equal(kisayolGosterimi('Ctrl+Shift+7'), 'Ctrl+Shift+7');
  assert.equal(kisayolGosterimi('  '), '');
  // Düzeltme turu 1: kısayol sorunu iletisindeki örnek de gösterimle (platforma göre).
  const bos = genelKisayolSorunu('Shift', 'win32') ?? '';
  assert.match(bos, /ör\. Ctrl\+Shift\+Boşluk/);
  assert.doesNotMatch(bos, /Space|CommandOrControl/);
  assert.match(genelKisayolSorunu('Shift', 'darwin') ?? '', /ör\. ⌘\+Shift\+Boşluk/);
  // Ayarlar'daki alan gösterimi yazar; kayıt Electron biçimine döner (Ctrl, Esc Electron'da da geçerli).
  assert.equal(kisayolElectron('Ctrl+Shift+Boşluk'), 'Ctrl+Shift+Space');
  assert.equal(kisayolElectron('⌘+Shift+BOŞLUK'), 'Command+Shift+Space');
  for (const k of ['CommandOrControl+Shift+Space', 'Alt+Shift+F9', 'Control+Shift+K']) assert.equal(kisayolGosterimi(kisayolElectron(kisayolGosterimi(k))), kisayolGosterimi(k), k);
});

const ayar = (id: string) => AYAR_TANIMLARI.get(id)!;
const kategori = (id: string) => KATEGORILER.find((k) => k.id === id)!;
const grup = (k: string, g: string) => kategori(k).gruplar.find((x) => x.id === g)!;

test('Ayarlar sözlüğe göre: Gizlilik, Gün kaydı, Fuber kendiliğinden yazsın, Not tutma ve raporlar (A-4, A-60, D-6, D-11)', () => {
  const g = kategori('gizlilik');
  assert.equal(g.ad, 'Gizlilik');
  assert.equal(modaGore('is', g.aciklama, g.aciklamaIs), 'Gizli mod ve bu bilgisayardaki yapay zekâ');
  assert.equal(modaGore('gelistirici', g.aciklama, g.aciklamaIs), 'Gizli mod ve yerel model');
  const d = kategori('dusunme');
  assert.equal(d.ad, TERIM.gunKaydi);
  assert.match(d.giris, /^Gün boyu konuşulanları not alır, akşam rapor hazırlar\./);
  assert.equal(ayar('proaktif-fuber').ad, TERIM.kendiliginden);
  assert.equal(grup('dusunme', 'ajanlar').baslik, TERIM.notlarRaporlar);
  assert.match(ayar('gizli-mod').aciklamaIs ?? '', /Gizli moddayken alınan notlar/);
  assert.match(ayar('tam-yetki').aciklama ?? '', /dış serviste değişiklik yapan işler/);
  // Kısayol açıklaması okunur tuşla (Electron yazımı yok).
  assert.match(ayar('kisayol').aciklama ?? '', /Ctrl\+Shift\+Boşluk/);
  assert.doesNotMatch(ayar('kisayol').aciklama ?? '', /CommandOrControl/);
});

test('Düzeltme turu 1: kısayol açıklamasındaki varsayılan platforma göre (Mac’te ⌘)', async () => {
  const g = globalThis as { window?: unknown };
  g.window = { fuber: { platform: 'darwin' } };
  try {
    const mac = await import('../src/renderer/ayarlar/dizin.ts?mac');
    assert.match(mac.AYAR_TANIMLARI.get('kisayol')?.aciklama ?? '', /Varsayılan: ⌘\+Shift\+Boşluk\./);
  } finally { delete g.window; }
});

test('Ayarlar → Pano (A-58): sade giriş, "Bilgi kartları", şehir ve hava tek cümle; atıflar Hakkında’da', () => {
  const p = kategori('pano');
  assert.equal(p.giris, 'Kokpitte hava, haber ve kurların gösterilip gösterilmeyeceği.');
  assert.equal(grup('pano', 'kartlar').baslik, 'Bilgi kartları');
  assert.equal(ayar('pano-sehir').aciklamaIs, 'Hava ve haberler için şehrin; otomatik seçimde saat diliminden bulunur.');
  assert.equal(ayar('pano-hava').aciklama, 'Şimdiki hava ve günlük tahmin.');
  for (const id of ['pano-hava', 'pano-piyasa']) assert.doesNotMatch(`${ayar(id).aciklama} ${ayar(id).aciklamaIs ?? ''}`, /MET Norway|CC BY|Merkez Bankası/, id);
  // Hakkında: hava ve kur kaynağının atfı (İş modunda da görünür: İş dilinde); pakete giren bildirim dosyası da aynı metni taşır.
  assert.deepEqual(VERI_KAYNAKLARI.map((v) => v.ne), ['Hava durumu', 'Döviz kurları']);
  assert.match(VERI_KAYNAKLARI[0].atif, /^MET Norway/);
  assert.match(VERI_KAYNAKLARI[1].atif, /Avrupa Merkez Bankası/);
  for (const v of VERI_KAYNAKLARI) assert.equal(isDiliIhlali(`${v.ne} ${v.atif}`), null, v.ne);
  assert.match(ucuncuTarafMetni(), /Hava durumu: MET Norway/);
  // Düzeltme turu 1: lisansın tam adı Hakkında'da bağlantı olarak (adres bildirim dosyasında da); görünen metin İş dilinde.
  const hava = VERI_KAYNAKLARI[0];
  assert.deepEqual(hava.lisans, { ad: 'Creative Commons Atıf 4.0 Uluslararası lisansı', adres: 'https://creativecommons.org/licenses/by/4.0/' });
  assert.equal(isDiliIhlali(`${hava.ne} ${hava.atif} ${hava.lisans?.ad}`), null);
  assert.match(ucuncuTarafMetni(), /https:\/\/creativecommons\.org\/licenses\/by\/4\.0\//);
  assert.match(oku('src/renderer/ayarlar/Genel.tsx'), /href=\{v\.lisans\.adres\}/);
});

test('Kokpit kart başlıkları sözlükten (Gün kaydı, Takip edilecekler)', () => {
  // 0.11 G5: kartlar kütüphane kartı olarak kendi bileşenlerinde (bilesenler/DusunmeKart.tsx); Kokpit planlayıcının başlığını geçirir.
  const k = oku('src/renderer/sayfalar/Kokpit.tsx');
  const d = oku('src/renderer/bilesenler/DusunmeKart.tsx');
  assert.match(k, /<GunKaydiKarti [^>]*baslik=\{k\.baslik\}/);
  assert.match(k, /<MeselelerKarti [^>]*baslik=\{k\.baslik\}/);
  assert.match(d, /baslik=\{baslik \?\? TERIM\.gunKaydi\}/);
  assert.match(d, /baslik=\{baslik \?\? TERIM\.takip\}/);
  assert.doesNotMatch(k + d, /'Düşünme motoru'|'Açık meseleler'/);
});
