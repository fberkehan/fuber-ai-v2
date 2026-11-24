// Sistem uyarı hapları (0.14 T22) — saf kurallar, Electron'suz. Sınananlar: `uyariUret` her türün metni, simgesi ve düzeyi (brief metinleri birebir);
// kapalı tür ve aynı değerin tekrarı null; tabanı bilinmeyen aç/kapa olayı (şarj, ağ, Caps Lock, dil) uyarı vermez; R25 kapısı (ana pencere önde, çentik
// kapalı/gizli, tam ekran, görünmeyen çentik: gösterilmez ve kuyruğa girmez); klavye kancası yalnız Caps Lock ya da dil anahtarı açıkken; dil patlaması
// (A→B→A, ~400 ms) tek uyarıya iner ya da hiç uyarı vermez; `adaHaliBul`: uyarı yalnız boşta, iş onu ezer; Sade modda hap karakter çizmez.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BOS_DURUM, type SistemDurumu, type SistemOlayi } from '../src/shared/sistem-olay.ts';
import {
  BINDIRME_SURESI_MS, DIL_BIRLESTIRME_MS, DilBirlestirici, UYARI_ANAHTARLARI, UYARI_SURESI_MS, klavyeGerekli, uyariAnahtarlari, uyariGosterilsinMi, uyariYolu,
  uyariSuresi, uyariUret, type SistemUyarisi, type UyariAnahtari,
} from '../src/shared/sistem-uyarilari.ts';
import { adaHaliBul, adaOlcusu, type AdaDurumu } from '../src/shared/ada.ts';

const kaynakOku = (yol: string): string => readFileSync(new URL(`../${yol}`, import.meta.url), 'utf8');
const HEPSI: Record<UyariAnahtari, boolean> = { kulaklik: true, sarj: true, ses: true, parlaklik: true, caps: true, dil: true, ag: true };
/** Tabanı bilinen hâl: her alan dolu (tekrar ve değişim buna göre). */
const TABAN: SistemDurumu = {
  ...BOS_DURUM,
  guc: { sarj: false, yuzde: 80 }, ag: true, sesAygiti: { ad: 'Hoparlör', tur: 'hoparlor', bagli: true, pil: null }, ses: { duzey: 0.3, sessiz: false },
  parlaklik: 0.5, caps: false, dil: { kod: 'en-US', ad: 'English' },
};
const uret = (o: SistemOlayi, onceki: SistemDurumu = TABAN, acik = HEPSI) => uyariUret(o, onceki, acik);

test('uyarı anahtarları yedi, hepsi varsayılan açık; eski ayar alanı yoksa da açık; "odak-bitti" anahtar değildir', () => {
  assert.deepEqual([...UYARI_ANAHTARLARI], ['kulaklik', 'sarj', 'ses', 'parlaklik', 'caps', 'dil', 'ag']);
  assert.deepEqual(uyariAnahtarlari(undefined), HEPSI);
  assert.deepEqual(uyariAnahtarlari({}), HEPSI);
  assert.deepEqual(uyariAnahtarlari({ uyarilar: { caps: false } }), { ...HEPSI, caps: false });
  assert.ok(!(UYARI_ANAHTARLARI as readonly string[]).includes('odak-bitti'));
  assert.equal(UYARI_SURESI_MS, 2200);
  assert.equal(BINDIRME_SURESI_MS, 1500);
});

test('uyarıUret: her tür ve metni; kapalı tür null; aynı değer tekrarında null', () => {
  const beklenen: [SistemOlayi, Partial<SistemUyarisi>, SistemDurumu?][] = [
    [{ t: 'ses-aygiti', ad: 'AirPods Pro', tur: 'kulaklik', bagli: true, pil: 72 }, { tur: 'kulaklik', metin: 'AirPods Pro bağlandı · %72', simge: 'kulaklik' }],
    [{ t: 'ses-aygiti', ad: 'AirPods Pro', tur: 'kulaklik', bagli: true, pil: null }, { tur: 'kulaklik', metin: 'AirPods Pro bağlandı', simge: 'kulaklik' }],
    [{ t: 'ses-aygiti', ad: 'AirPods Pro', tur: 'kulaklik', bagli: false, pil: null }, { tur: 'kulaklik', metin: 'AirPods Pro ayrıldı', simge: 'kulaklik' },
      { ...TABAN, sesAygiti: { ad: 'AirPods Pro', tur: 'kulaklik', bagli: true, pil: 70 } }],
    [{ t: 'ses-aygiti', ad: 'JBL Flip', tur: 'hoparlor', bagli: true, pil: null }, { tur: 'kulaklik', metin: 'JBL Flip bağlandı', simge: 'hoparlor' }],
    [{ t: 'guc', sarj: true, yuzde: 81 }, { tur: 'sarj', metin: 'Şarj takıldı · %81', simge: 'bolt' }],
    [{ t: 'guc', sarj: false, yuzde: 80 }, { tur: 'sarj', metin: 'Şarj çıkarıldı · %80', simge: 'pil' }, { ...TABAN, guc: { sarj: true, yuzde: 80 } }],
    [{ t: 'ses', duzey: 0.42, sessiz: false }, { tur: 'ses', metin: 'Ses %42', duzey: 0.42, simge: 'hoparlor' }],
    [{ t: 'ses', duzey: 0.42, sessiz: true }, { tur: 'ses', metin: 'Sessiz', duzey: 0, simge: 'sessiz' }],
    [{ t: 'parlaklik', duzey: 0.6 }, { tur: 'parlaklik', metin: 'Parlaklık %60', duzey: 0.6, simge: 'gunes' }],
    [{ t: 'caps', acik: true }, { tur: 'caps', metin: 'Büyük harf kilidi açık', simge: 'buyuk-harf' }],
    [{ t: 'caps', acik: false }, { tur: 'caps', metin: 'Büyük harf kilidi kapalı', simge: 'buyuk-harf' }, { ...TABAN, caps: true }],
    [{ t: 'dil', kod: 'tr-TR', ad: 'Türkçe' }, { tur: 'dil', metin: 'Klavye: Türkçe', simge: 'kure' }],
    [{ t: 'ag', bagli: false }, { tur: 'ag', metin: 'İnternet bağlantısı koptu', simge: 'wifi-yok' }],
    [{ t: 'ag', bagli: true }, { tur: 'ag', metin: 'İnternet bağlantısı geri geldi', simge: 'wifi' }, { ...TABAN, ag: false }],
  ];
  for (const [o, b, onceki] of beklenen) {
    const u = uret(o, onceki);
    assert.ok(u, `${JSON.stringify(o)} uyarı vermeli`);
    for (const [k, v] of Object.entries(b)) assert.deepEqual(u[k as keyof SistemUyarisi], v, `${JSON.stringify(o)} · ${k}`);
    // Düzey yalnız ses ve parlaklıkta (bindirme çubuğu); öbürlerinde alan yok.
    if (o.t !== 'ses' && o.t !== 'parlaklik') assert.equal(u.duzey, undefined, `${o.t}: düzey yok`);
    // Kapalı tür: aynı olay null.
    assert.equal(uyariUret(o, onceki ?? TABAN, { ...HEPSI, [b.tur as UyariAnahtari]: false }), null, `${b.tur} kapalıyken null`);
  }
  // Aynı değer tekrarı null.
  const tekrar: [SistemOlayi, SistemDurumu][] = [
    [{ t: 'ses', duzey: 0.3, sessiz: false }, TABAN],
    [{ t: 'ses', duzey: 0.304, sessiz: false }, TABAN], // aynı yüzde
    [{ t: 'parlaklik', duzey: 0.5 }, TABAN],
    [{ t: 'caps', acik: false }, TABAN],
    [{ t: 'dil', kod: 'en-US', ad: 'English' }, TABAN],
    [{ t: 'ag', bagli: true }, TABAN],
    [{ t: 'guc', sarj: false, yuzde: 79 }, TABAN], // yalnız yüzde değişti: hap yok (pil her %1'de olay verir)
    [{ t: 'ses-aygiti', ad: 'Hoparlör', tur: 'hoparlor', bagli: true, pil: null }, TABAN],
  ];
  for (const [o, d] of tekrar) assert.equal(uret(o, d), null, `tekrar: ${JSON.stringify(o)}`);
  // Uyarı vermeyen olaylar (tam ekran, medya, durum, hazir, hata).
  const yok: SistemOlayi[] = [
    { t: 'tam-ekran', acik: true, ekran: { x: 0, y: 0, en: 1920, boy: 1080 } }, { t: 'medya', var: false }, { t: 'hazir', surum: 1 },
    { t: 'hata', mesaj: 'x' }, { t: 'durum', ...BOS_DURUM },
  ];
  for (const o of yok) assert.equal(uret(o), null, o.t);
});

test('tabanı bilinmeyen aç/kapa olayı uyarı vermez (şarj, ağ, Caps Lock, dil); ses, parlaklık ve aygıt olayı kendisi değişimdir', () => {
  for (const o of [{ t: 'guc', sarj: true, yuzde: 50 }, { t: 'ag', bagli: false }, { t: 'caps', acik: true }, { t: 'dil', kod: 'tr-TR', ad: 'Türkçe' }] as SistemOlayi[]) {
    assert.equal(uret(o, BOS_DURUM), null, `${o.t}: taban yok`);
  }
  assert.equal(uret({ t: 'ses', duzey: 0.5, sessiz: false }, BOS_DURUM)?.metin, 'Ses %50');
  assert.equal(uret({ t: 'parlaklik', duzey: 0.25 }, BOS_DURUM)?.metin, 'Parlaklık %25');
  assert.equal(uret({ t: 'ses-aygiti', ad: 'Kulaklık', tur: 'kulaklik', bagli: true, pil: null }, BOS_DURUM)?.metin, 'Kulaklık bağlandı');
});

test('sessizken düzey değişse de "Sessiz" hapı yinelenmez; sessizden çıkış hap verir (düzeltme turu 1, Minor 2)', () => {
  const sessiz: SistemDurumu = { ...TABAN, ses: { duzey: 0.3, sessiz: true } };
  assert.equal(uret({ t: 'ses', duzey: 0.6, sessiz: true }, sessiz), null);
  assert.equal(uret({ t: 'ses', duzey: 0.6, sessiz: false }, sessiz)?.metin, 'Ses %60');
  assert.equal(uret({ t: 'ses', duzey: 0.3, sessiz: true }, TABAN)?.metin, 'Sessiz');
});

test('ses ve parlaklık bindirmesi 1,5 sn; öbür haplar 2,2 sn', () => {
  assert.equal(uyariSuresi(uret({ t: 'ses', duzey: 0.5, sessiz: false })!), 1500);
  assert.equal(uyariSuresi(uret({ t: 'parlaklik', duzey: 0.9 })!), 1500);
  assert.equal(uyariSuresi(uret({ t: 'ag', bagli: false })!), 2200);
  assert.equal(uyariSuresi({ tur: 'odak-bitti', metin: 'Odak bitti', simge: 'saat' }), 2200);
});

test('uyarı ana pencere öndeyken, çentik kapalıyken ve tam ekranda gösterilmez, kuyruğa girmez (R25)', () => {
  const k = (x: Partial<Parameters<typeof uyariYolu>[0]> = {}) => uyariYolu({ anaOnde: false, kapali: false, tamEkran: false, gorunur: true, ...x });
  assert.equal(k(), 'yaz', 'görünür çentiğe yazılır');
  assert.equal(k({ anaOnde: true }), 'yok', 'ana pencere önde');
  assert.equal(k({ kapali: true }), 'yok', 'çentik kapalı ya da 1 saat gizli');
  assert.equal(k({ tamEkran: true }), 'yok', 'tam ekran');
  // Düzeltme turu 1 (Important 3): gizli çentik (ör. "Ada sessizken görünsün" kapalı) hap için iner; kapılar gizli çentikte de sürer.
  assert.equal(k({ gorunur: false }), 'in');
  for (const x of [{ anaOnde: true }, { kapali: true }, { tamEkran: true }]) assert.equal(k({ gorunur: false, ...x }), 'yok', JSON.stringify(x));
  assert.equal(uyariGosterilsinMi({ anaOnde: false, kapali: false, tamEkran: false }), true);
  // Kuyruğa girmez: ana süreçte uyarı yolu doğrudan arayüze yazar, AdaKuyrugu'na ve kapıya (adaGonder) dokunmaz; iniş odaksız (showInactive) ve tek atımlık süreyle çekilir.
  const ada = kaynakOku('src/main/ada.ts');
  const govde = /function uyariGoster\([^)]*\): (?:void|boolean) \{[\s\S]*?\n\}/.exec(ada)?.[0] ?? '';
  assert.ok(govde, 'uyariGoster var');
  assert.match(govde, /uyariYolu\(\{ anaOnde: anaOnde\(\), kapali: adaKapali\(\), tamEkran: tamEkranSimdi\(\), gorunur: w\.isVisible\(\) \}\)/);
  assert.match(govde, /dogrudan\('ada:uyari', u\)/);
  assert.match(govde, /w\.showInactive\(\)/);
  assert.match(govde, /uyariCekme = setTimeout\([\s\S]*adayiCek\(\);[\s\S]*\}, uyariSuresi\(u\)\);/);
  assert.doesNotMatch(govde, /kuyruk\.|adaGonder|adaGoster\(|\.show\(|\.focus\(/, 'uyarı kuyruğa girmez, odak almaz');
});

test('Caps Lock ve klavye dili anahtarı kapalıyken yardımcıya klavye:false gider (kanca kurulmaz)', () => {
  assert.equal(klavyeGerekli(HEPSI), true);
  assert.equal(klavyeGerekli({ ...HEPSI, caps: false }), true, 'dil açık');
  assert.equal(klavyeGerekli({ ...HEPSI, dil: false }), true, 'Caps Lock açık');
  assert.equal(klavyeGerekli({ ...HEPSI, caps: false, dil: false }), false);
  assert.equal(klavyeGerekli({ kulaklik: false, sarj: false, ses: false, parlaklik: false, ag: false, caps: false, dil: false }), false);
  // Ana süreç: açılışta ve ayar değişikliğinde — yalnız değer değişince (düzeltme turu 1, Minor 1; yardımcı yeniden açılınca son istek yinelenir).
  const ana = kaynakOku('src/main/main.ts');
  assert.match(ana, /const acik = klavyeGerekli\(uyariAnahtarlari\(ayarlar\(\)\.gorunum\)\);\r?\n\s*if \(acik === sonKlavye\) return;\r?\n\s*sonKlavye = acik;\r?\n\s*yardimciyaGonder\(\{ k: 'klavye', acik \}\);/);
  assert.match(ana, /klavyeyiUygula\(\);\r?\n\s*ayarDinle\(klavyeyiUygula\);/);
});

test('dil patlaması: A→B→A (Alt+Shift iki kez) uyarı vermez; A→B→C tek uyarı (son dil); son olaydan ~400 ms sonra', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    assert.equal(DIL_BIRLESTIRME_MS, 400);
    const gelen: SistemUyarisi[] = [];
    const b = new DilBirlestirici((u) => gelen.push(u));
    const en = { kod: 'en-US', ad: 'English' }, tr = { kod: 'tr-TR', ad: 'Türkçe' }, de = { kod: 'de-DE', ad: 'Deutsch' };
    let d: SistemDurumu = { ...TABAN, dil: en };
    const olay = (x: { kod: string; ad: string }) => { const onceki = d; d = { ...d, dil: x }; b.olay({ t: 'dil', ...x }, onceki, HEPSI); };
    // A→B→A
    olay(tr); mock.timers.tick(150); olay(en);
    mock.timers.tick(399);
    assert.equal(gelen.length, 0, 'son olaydan 400 ms geçmedi');
    mock.timers.tick(1);
    assert.equal(gelen.length, 0, 'dil başa döndü: uyarı yok');
    // A→B→C: tek uyarı, son dil
    olay(tr); mock.timers.tick(100); olay(de);
    mock.timers.tick(400);
    assert.deepEqual(gelen.map((u) => u.metin), ['Klavye: Deutsch']);
    // Tek değişim: 400 ms sonra bir uyarı
    olay(tr);
    mock.timers.tick(400);
    assert.deepEqual(gelen.map((u) => u.metin), ['Klavye: Deutsch', 'Klavye: Türkçe']);
    // Patlama sürerken dil anahtarı kapandı: uyarı yok (son anın anahtarı geçerli)
    olay(en);
    b.olay({ t: 'dil', ...de }, { ...d }, { ...HEPSI, dil: false });
    mock.timers.tick(400);
    assert.equal(gelen.length, 2);
    b.kapat();
  } finally { mock.timers.reset(); }
});

test('adaHaliBul: uyarı yalnız boşta görünür; onay, dinleme, yanıt ve görev onu ezer', () => {
  const BOS: AdaDurumu = { hal: 'bos', onaySayisi: 0, bildirimVar: false, kartAcik: false, yanitVar: false, sorAcik: false, ekranda: false, motor: 'hazir' };
  const uyari = uret({ t: 'ses', duzey: 0.42, sessiz: false })!;
  assert.equal(adaHaliBul({ ...BOS, uyari }), 'uyari');
  assert.equal(adaHaliBul({ ...BOS, uyari, medya: true }), 'uyari', 'Kapalı hapın yerine');
  assert.equal(adaHaliBul({ ...BOS, uyari, hover: true }), 'uyari', 'hover uyarıyı açmaz');
  assert.equal(adaHaliBul({ ...BOS, uyari, onaySayisi: 1 }), 'onay');
  assert.equal(adaHaliBul({ ...BOS, uyari, hal: 'dinliyor' }), 'dinliyor');
  assert.equal(adaHaliBul({ ...BOS, uyari, hal: 'dusunuyor' }), 'dusunuyor');
  assert.equal(adaHaliBul({ ...BOS, uyari, yanitVar: true }), 'yanit');
  assert.equal(adaHaliBul({ ...BOS, uyari, sorAcik: true }), 'sor');
  assert.equal(adaHaliBul({ ...BOS, uyari, bildirimVar: true }), 'bildirim');
  assert.equal(adaHaliBul({ ...BOS, uyari, gorev: { id: 1, baslik: 'Rapor', ekran: false } }), 'gorev');
  assert.equal(adaHaliBul({ ...BOS, uyari, calisiyor: { sohbetId: 1, adim: 2, etiket: '' } }), 'gorev');
  assert.equal(adaHaliBul({ ...BOS, uyari, ekranda: true }), 'ekranda');
  assert.equal(adaHaliBul({ ...BOS, uyari: null }), 'dinlenme');
  assert.deepEqual(adaOlcusu('uyari'), { en: 300, boy: 36 });
  // Arayüz: uyarı boş hâl sayılır (geri çekilme ve ada:bos onu iş saymaz).
  assert.match(kaynakOku('src/renderer/ada/useAsistan.ts'), /const bosMu = \(d: AdaDurumu\) => !d\.sorAcik && !d\.panelAcik && \['dinlenme', 'sessiz', 'uyari', 'motor-durdu', 'motor-hap'\]/);
});

test('Sade mod: uyarı hapı iki modda aynı çizilir, karakter içermez (yalnız simge ve metin); düzey çubuğu yalnız transform', () => {
  const ada = kaynakOku('src/renderer/ada/Ada.tsx');
  const hap = /function UyariHapi\([\s\S]*?\n\}/.exec(ada)?.[0] ?? '';
  assert.ok(hap, 'UyariHapi var');
  assert.doesNotMatch(hap, /Karakter|karakterGorunur|kip=|UrunIsareti/, 'hapta karakter yok, Sade mod ayrımı yok');
  assert.match(hap, /<Ikon ad=\{u\.simge\}/);
  assert.match(hap, /transform: `scaleX\(/, 'düzey çubuğu scaleX ile (genişlik canlandırılmaz)');
  assert.match(ada, /case 'uyari':\r?\n\s*return a\.uyari && <UyariHapi u=\{a\.uyari\} \/>;/);
  // Arayüz zamanlayıcısı tek atımlık setTimeout (yoklama yok).
  const y = kaynakOku('src/renderer/ada/useAsistan.ts');
  assert.match(y, /uyariZaman\.current = setTimeout\(\(\) => \{ uyariZaman\.current = null; setUyari\(null\); \}, uyariSuresi\(u\)\);/);
  assert.doesNotMatch(y, /setInterval/);
});
