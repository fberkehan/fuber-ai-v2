// Olay yardımcısının (fuber-olay.exe, T20) satır protokolü — saf, gerçek exe açılmaz. Sınananlar: her olay türü brief'teki örnek
// satırıyla ayrışır; bozuk satır, bilinmeyen tür ve zorunlu alanı eksik satır null; `yuzde` ve `pil` 0–100 dışında null olur (olay
// düşmez); düzeyler 0..1'e kıstırılır; `durum` gövdesi alan alan doğrulanır (bozuk alan null); komut satırları tek satır JSON;
// `durumGuncelle` girdiyi değiştirmeden yeni hâl döner.
// T21 (medya oturumu): medya olayı ayrışır (çalan yoksa var:false); kapak yalnız jpeg/png data URL ve en çok 256 KB, değilse null
// (olay düşmez; ağ adresi asla geçmez); `medyaKonumu` çalarken ilerler, duraklamışken sabit, süreyi aşmaz; medya komut satırları.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOS_DURUM, KAPAK_SINIRI, MEDYA_EYLEMLERI, OLAY_TURLERI, SAYAC_ALANLARI, durumGuncelle, komutSatiri, medyaKonumu, olaySatiriAyristir,
  type MedyaOlayi, type SistemDurumu, type SistemOlayi,
} from '../src/shared/sistem-olay.ts';

const EKRAN = { x: 0, y: 0, en: 2560, boy: 1440 };
/** Brief'teki örnek satır (kapak geçerli base64: JPEG başlığı). */
const T0 = 1730540000000;
const CALAN: Extract<MedyaOlayi, { var: true }> = {
  t: 'medya', var: true, uygulama: 'Spotify.exe', baslik: 'Gesi Bağları', sanatci: 'Zülfü Livaneli', album: 'Ömür Bitti',
  sure: 213.4, konum: 82.1, konumZamani: T0, caliyor: true, hiz: 1, kapak: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==',
};
const yakin = (a: number, b: number, ad: string) => assert.ok(Math.abs(a - b) < 1e-9, `${ad}: ${a} ≈ ${b}`);

test('olay türleri listesi brief ile birebir', () => {
  assert.deepEqual([...OLAY_TURLERI], ['hazir', 'guc', 'ag', 'ses-aygiti', 'ses', 'parlaklik', 'caps', 'dil', 'tam-ekran', 'medya', 'durum', 'hata', 'sayac']);
  assert.deepEqual([...MEDYA_EYLEMLERI], ['oynat', 'duraklat', 'ileri', 'geri', 'konum']);
  assert.equal(KAPAK_SINIRI, 256 * 1024);
});

test('her olay türü brief örneğiyle ayrışır', () => {
  const ornekler: [string, SistemOlayi][] = [
    ['{"t":"hazir","surum":1}', { t: 'hazir', surum: 1 }],
    ['{"t":"guc","sarj":true,"yuzde":81}', { t: 'guc', sarj: true, yuzde: 81 }],
    ['{"t":"guc","sarj":true,"yuzde":null}', { t: 'guc', sarj: true, yuzde: null }],
    ['{"t":"ag","bagli":false}', { t: 'ag', bagli: false }],
    ['{"t":"ses-aygiti","ad":"WH-1000XM4","tur":"kulaklik","bagli":true,"pil":72}', { t: 'ses-aygiti', ad: 'WH-1000XM4', tur: 'kulaklik', bagli: true, pil: 72 }],
    ['{"t":"ses-aygiti","ad":"Hoparlör","tur":"hoparlor","bagli":false,"pil":null}', { t: 'ses-aygiti', ad: 'Hoparlör', tur: 'hoparlor', bagli: false, pil: null }],
    ['{"t":"ses","duzey":0.42,"sessiz":false}', { t: 'ses', duzey: 0.42, sessiz: false }],
    ['{"t":"parlaklik","duzey":0.6}', { t: 'parlaklik', duzey: 0.6 }],
    ['{"t":"caps","acik":true}', { t: 'caps', acik: true }],
    ['{"t":"dil","kod":"tr-TR","ad":"Türkçe"}', { t: 'dil', kod: 'tr-TR', ad: 'Türkçe' }],
    ['{"t":"tam-ekran","acik":true,"ekran":{"x":0,"y":0,"en":2560,"boy":1440}}', { t: 'tam-ekran', acik: true, ekran: EKRAN }],
    ['{"t":"tam-ekran","acik":false,"ekran":{"x":-1920,"y":0,"en":1920,"boy":1080}}', { t: 'tam-ekran', acik: false, ekran: { x: -1920, y: 0, en: 1920, boy: 1080 } }],
    ['{"t":"hata","mesaj":"Ağ olayları alınamadı"}', { t: 'hata', mesaj: 'Ağ olayları alınamadı' }],
  ];
  for (const [satir, beklenen] of ornekler) assert.deepEqual(olaySatiriAyristir(satir), beklenen, satir);
});

test('satır sonu \\r ve boşluk tolere edilir; tanınmayan fazladan alanlar atılır', () => {
  assert.deepEqual(olaySatiriAyristir('  {"t":"ag","bagli":true}\r'), { t: 'ag', bagli: true });
  assert.deepEqual(olaySatiriAyristir('{"t":"caps","acik":false,"tus":20,"vk":"VK_A"}'), { t: 'caps', acik: false });
});

test('bozuk satır null', () => {
  for (const s of ['', '   ', '{', 'null', '[]', '"guc"', '42', 'true', '{"t":1}', '{"t":null}', '{}', '{"sarj":true}', '{"t":"guc","sarj":true', 'x'.repeat(10)]) {
    assert.equal(olaySatiriAyristir(s), null, JSON.stringify(s));
  }
  assert.equal(olaySatiriAyristir(`{"t":"hata","mesaj":"${'a'.repeat(70_000)}"}`), null, 'aşırı uzun satır');
  // @ts-expect-error — dize olmayan girdi
  assert.equal(olaySatiriAyristir(undefined), null);
});

test('bilinmeyen tür null', () => {
  for (const s of ['{"t":"bilinmeyen"}', '{"t":"klavye-tusu","vk":65}', '{"t":"GUC","sarj":true,"yuzde":1}', '{"t":"__proto__"}', '{"t":"toString"}']) {
    assert.equal(olaySatiriAyristir(s), null, s);
  }
});

test('yuzde 0–100 dışı null olur; olay düşmez', () => {
  for (const y of ['-1', '101', '100.5', '"81"', 'true', '{}', '1e9']) {
    assert.deepEqual(olaySatiriAyristir(`{"t":"guc","sarj":false,"yuzde":${y}}`), { t: 'guc', sarj: false, yuzde: null }, y);
  }
  assert.deepEqual(olaySatiriAyristir('{"t":"guc","sarj":false}'), { t: 'guc', sarj: false, yuzde: null }, 'yuzde yoksa null');
  assert.deepEqual(olaySatiriAyristir('{"t":"guc","sarj":false,"yuzde":0}'), { t: 'guc', sarj: false, yuzde: 0 });
  assert.deepEqual(olaySatiriAyristir('{"t":"guc","sarj":true,"yuzde":100}'), { t: 'guc', sarj: true, yuzde: 100 });
  // pil de aynı kural
  assert.deepEqual(olaySatiriAyristir('{"t":"ses-aygiti","ad":"A","tur":"kulaklik","bagli":true,"pil":255}'), { t: 'ses-aygiti', ad: 'A', tur: 'kulaklik', bagli: true, pil: null });
  assert.deepEqual(olaySatiriAyristir('{"t":"ses-aygiti","ad":"A","tur":"kulaklik","bagli":true}'), { t: 'ses-aygiti', ad: 'A', tur: 'kulaklik', bagli: true, pil: null });
});

test('zorunlu alan eksik ya da yanlış türde: null', () => {
  for (const s of [
    '{"t":"hazir"}', '{"t":"hazir","surum":"1"}', '{"t":"hazir","surum":0}',
    '{"t":"guc","yuzde":50}', '{"t":"guc","sarj":"evet","yuzde":50}',
    '{"t":"ag"}', '{"t":"ag","bagli":1}',
    '{"t":"ses-aygiti","tur":"kulaklik","bagli":true,"pil":1}', '{"t":"ses-aygiti","ad":"A","bagli":true}', '{"t":"ses-aygiti","ad":"A","tur":"kulaklik"}',
    '{"t":"ses","duzey":"0.4","sessiz":false}', '{"t":"ses","duzey":0.4}',
    '{"t":"parlaklik"}', '{"t":"parlaklik","duzey":null}',
    '{"t":"caps"}', '{"t":"caps","acik":"true"}',
    '{"t":"dil","kod":"","ad":"Türkçe"}', '{"t":"dil","kod":"tr-TR"}',
    '{"t":"tam-ekran","acik":true}', '{"t":"tam-ekran","acik":true,"ekran":{"x":0,"y":0,"en":0,"boy":1440}}',
    '{"t":"tam-ekran","acik":true,"ekran":{"x":0,"y":0,"en":2560}}', '{"t":"tam-ekran","ekran":{"x":0,"y":0,"en":2560,"boy":1440}}',
    '{"t":"hata"}', '{"t":"hata","mesaj":5}',
  ]) assert.equal(olaySatiriAyristir(s), null, s);
});

test('düzeyler 0..1 aralığına kıstırılır', () => {
  assert.deepEqual(olaySatiriAyristir('{"t":"ses","duzey":1.5,"sessiz":true}'), { t: 'ses', duzey: 1, sessiz: true });
  assert.deepEqual(olaySatiriAyristir('{"t":"ses","duzey":-0.1,"sessiz":false}'), { t: 'ses', duzey: 0, sessiz: false });
  assert.deepEqual(olaySatiriAyristir('{"t":"parlaklik","duzey":7}'), { t: 'parlaklik', duzey: 1 });
});

test('durum: tam gövde ayrışır', () => {
  const { t: _t, ...medyaGovdesi } = CALAN;
  const satir = JSON.stringify({
    t: 'durum',
    guc: { sarj: true, yuzde: null }, ag: true,
    sesAygiti: { ad: 'Hoparlör (Realtek)', tur: 'hoparlor', bagli: true, pil: null },
    ses: { duzey: 0.42, sessiz: false }, parlaklik: null, caps: false,
    dil: { kod: 'tr-TR', ad: 'Türkçe' }, tamEkran: { acik: false, ekran: EKRAN }, medya: medyaGovdesi,
  });
  const beklenen: SistemDurumu = {
    guc: { sarj: true, yuzde: null }, ag: true,
    sesAygiti: { ad: 'Hoparlör (Realtek)', tur: 'hoparlor', bagli: true, pil: null },
    ses: { duzey: 0.42, sessiz: false }, parlaklik: null, caps: false,
    dil: { kod: 'tr-TR', ad: 'Türkçe' }, tamEkran: { acik: false, ekran: EKRAN }, medya: CALAN,
  };
  assert.deepEqual(olaySatiriAyristir(satir), { t: 'durum', ...beklenen });
  // Çalan yoksa yardımcı {"var":false} yazar; medya kaynağı henüz hazır değilse (ya da kurulamadıysa) null.
  assert.deepEqual(olaySatiriAyristir('{"t":"durum","medya":{"var":false}}'), { t: 'durum', ...BOS_DURUM, medya: { t: 'medya', var: false } });
  assert.deepEqual(olaySatiriAyristir('{"t":"durum","medya":null}'), { t: 'durum', ...BOS_DURUM });
});

test('durum: bozuk ya da eksik alan null olur (eksik alanlı medya dahil)', () => {
  const o = olaySatiriAyristir(JSON.stringify({
    t: 'durum', guc: { yuzde: 50 }, ag: 'evet', sesAygiti: { ad: 'A' }, ses: { duzey: 2, sessiz: true }, parlaklik: 0.5, caps: true,
    dil: { kod: 'en-US', ad: 'English' }, tamEkran: { acik: true }, medya: { var: true, baslik: 'x' },
  }));
  assert.deepEqual(o, {
    t: 'durum', guc: null, ag: null, sesAygiti: null, ses: { duzey: 1, sessiz: true }, parlaklik: 0.5, caps: true,
    dil: { kod: 'en-US', ad: 'English' }, tamEkran: null, medya: null,
  });
  assert.deepEqual(olaySatiriAyristir('{"t":"durum"}'), { t: 'durum', ...BOS_DURUM }, 'boş gövde: hepsi null');
  assert.deepEqual(olaySatiriAyristir('{"t":"durum","guc":{"sarj":false,"yuzde":140}}'), { t: 'durum', ...BOS_DURUM, guc: { sarj: false, yuzde: null } });
});

test('komutSatiri: tek satır JSON ve satır sonu', () => {
  assert.equal(komutSatiri({ k: 'durum' }), '{"k":"durum"}\n');
  assert.equal(komutSatiri({ k: 'klavye', acik: true }), '{"k":"klavye","acik":true}\n');
  assert.equal(komutSatiri({ k: 'klavye', acik: false }), '{"k":"klavye","acik":false}\n');
  assert.equal(komutSatiri({ k: 'ses', duzey: 0.42 }), '{"k":"ses","duzey":0.42}\n');
  assert.equal(komutSatiri({ k: 'ses', duzey: 1.7 }), '{"k":"ses","duzey":1}\n', 'üst sınıra kıstırılır');
  assert.equal(komutSatiri({ k: 'ses', duzey: -3 }), '{"k":"ses","duzey":0}\n', 'alt sınıra kıstırılır');
  assert.throws(() => komutSatiri({ k: 'ses', duzey: Number.NaN }), /düzey/, 'NaN sesi sıfıra çekmez, hata verir');
  assert.throws(() => komutSatiri({ k: 'ses', duzey: Number.POSITIVE_INFINITY }), /düzey/);
  // Fazladan alan yardımcıya gitmez.
  assert.equal(komutSatiri({ k: 'klavye', acik: true, tus: 65 } as never), '{"k":"klavye","acik":true}\n');
  for (const k of [{ k: 'durum' }, { k: 'klavye', acik: true }, { k: 'ses', duzey: 0.5 }] as const) {
    assert.equal(komutSatiri(k).split('\n').length, 2, 'tek satır');
  }
});

test('komutSatiri: medya eylemleri; konum sn ister, ms çözünürlüğe yuvarlanır, 0 altına inmez', () => {
  assert.equal(komutSatiri({ k: 'medya', eylem: 'oynat' }), '{"k":"medya","eylem":"oynat"}\n');
  assert.equal(komutSatiri({ k: 'medya', eylem: 'duraklat' }), '{"k":"medya","eylem":"duraklat"}\n');
  assert.equal(komutSatiri({ k: 'medya', eylem: 'ileri' }), '{"k":"medya","eylem":"ileri"}\n');
  assert.equal(komutSatiri({ k: 'medya', eylem: 'geri' }), '{"k":"medya","eylem":"geri"}\n');
  assert.equal(komutSatiri({ k: 'medya', eylem: 'konum', sn: 82.12345 }), '{"k":"medya","eylem":"konum","sn":82.123}\n');
  assert.equal(komutSatiri({ k: 'medya', eylem: 'konum', sn: -5 }), '{"k":"medya","eylem":"konum","sn":0}\n');
  assert.throws(() => komutSatiri({ k: 'medya', eylem: 'konum', sn: Number.NaN }), /konum/, 'NaN başa sarmaz, hata verir');
  assert.throws(() => komutSatiri({ k: 'medya', eylem: 'konum' } as never), /konum/, 'sn yoksa hata');
  // Listede olmayan eylem (durdur, karıştır, ses tuşu …) yardımcıya hiç gitmez.
  for (const eylem of ['durdur', 'karistir', 'oynat-duraklat', 'VK_MEDIA_PLAY_PAUSE', '']) {
    assert.throws(() => komutSatiri({ k: 'medya', eylem } as never), TypeError, eylem);
  }
  // Fazladan alan gitmez (konum dışındaki eylemde sn yok).
  assert.equal(komutSatiri({ k: 'medya', eylem: 'ileri', sn: 5, uygulama: 'x' } as never), '{"k":"medya","eylem":"ileri"}\n');
});

test('medya olayı ayrışır', () => {
  assert.deepEqual(olaySatiriAyristir(JSON.stringify(CALAN)), CALAN, 'brief örneği');
  assert.deepEqual(olaySatiriAyristir('{"t":"medya","var":false}'), { t: 'medya', var: false }, 'çalan yok');
  assert.deepEqual(olaySatiriAyristir('{"t":"medya","var":false,"baslik":"x","kapak":null}'), { t: 'medya', var: false }, 'var:false fazla alanları atar');
  assert.deepEqual(olaySatiriAyristir(JSON.stringify({ ...CALAN, kapak: null })), { ...CALAN, kapak: null }, 'kapak yok');
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  assert.deepEqual(olaySatiriAyristir(JSON.stringify({ ...CALAN, kapak: png })), { ...CALAN, kapak: png }, 'png kapak');
  // Uygulama üst veri vermeyebilir: boş dizeler geçerli; fazladan alan atılır; uzun dize 256'da kesilir.
  const bos = { ...CALAN, uygulama: 'chrome', baslik: '', sanatci: '', album: '', sure: 0, konum: 0, kapak: null };
  assert.deepEqual(olaySatiriAyristir(JSON.stringify({ ...bos, tus: 1 })), bos);
  const uzun = olaySatiriAyristir(JSON.stringify({ ...CALAN, baslik: 'ş'.repeat(400) }));
  assert.equal(uzun?.t === 'medya' && uzun.var && uzun.baslik.length, 256);
  // Negatif süre ve konum 0'a çekilir.
  const neg = olaySatiriAyristir(JSON.stringify({ ...CALAN, sure: -1, konum: -3 }));
  assert.equal(neg?.t === 'medya' && neg.var && `${neg.sure},${neg.konum}`, '0,0');
});

test('medya: kapak yalnız jpeg/png base64 data URL ve en çok 256 KB; değilse null, olay düşmez', () => {
  const kapakli = (kapak: unknown) => {
    const o = olaySatiriAyristir(JSON.stringify({ ...CALAN, kapak }));
    assert.ok(o?.t === 'medya' && o.var, `olay düşmemeli: ${String(kapak).slice(0, 40)}`);
    return o.kapak;
  };
  // Tam 256 KB kapak (base64 ≈ 342 KB) satır sınırına takılmaz.
  const tam = `data:image/jpeg;base64,${Buffer.alloc(KAPAK_SINIRI, 0xff).toString('base64')}`;
  assert.equal(kapakli(tam), tam, '256 KB kapak geçer');
  assert.equal(kapakli(`data:image/jpeg;base64,${Buffer.alloc(KAPAK_SINIRI + 3, 0xff).toString('base64')}`), null, '256 KB\'ı aşan kapak null');
  for (const k of [
    'https://i.scdn.co/image/ab67616d0000b273', 'http://127.0.0.1/kapak.jpg', 'file:///C:/kapak.jpg', 'javascript:alert(1)',
    'data:text/html;base64,PGI+', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/jpeg,ham', 'data:image/jpeg;base64,',
    'data:image/jpeg;base64,!!!!', 'data:image/jpeg;base64,abc', 'data:image/jpeg;base64,ab"c', ' data:image/png;base64,iVBORw0KGgo=', '', 5, true, {},
  ]) assert.equal(kapakli(k), null, String(k));
});

test('medya: zorunlu alan eksik ya da yanlış türde null', () => {
  const { t: _t, ...govde } = CALAN;
  assert.equal(olaySatiriAyristir('{"t":"medya"}'), null, 'var yok');
  assert.equal(olaySatiriAyristir('{"t":"medya","var":"true"}'), null, 'var dize');
  for (const alan of ['uygulama', 'baslik', 'sanatci', 'album', 'sure', 'konum', 'konumZamani', 'caliyor', 'hiz'] as const) {
    const { [alan]: _a, ...eksik } = govde;
    assert.equal(olaySatiriAyristir(JSON.stringify({ t: 'medya', ...eksik })), null, `${alan} yok`);
  }
  for (const [alan, deger] of [['baslik', 5], ['uygulama', null], ['sure', '213'], ['konum', null], ['konumZamani', 'dün'], ['caliyor', 1], ['hiz', null]] as const) {
    assert.equal(olaySatiriAyristir(JSON.stringify({ ...CALAN, [alan]: deger })), null, `${alan}: ${String(deger)}`);
  }
  // Kapak taşıyabilen satır büyük olabilir; öbür türlerde 64 KB sınırı sürer (yukarıdaki "aşırı uzun satır").
  assert.equal(olaySatiriAyristir(`{"t":"medya","var":false,"dolgu":"${'a'.repeat(600_000)}"}`), null, '512 KB\'ı aşan satır');
});

test('medyaKonumu çalarken ilerler', () => {
  assert.equal(medyaKonumu(CALAN, T0), 82.1);
  yakin(medyaKonumu(CALAN, T0 + 10_000), 92.1, '10 sn sonra');
  yakin(medyaKonumu(CALAN, T0 + 250), 82.35, '250 ms sonra');
  yakin(medyaKonumu({ ...CALAN, hiz: 2 }, T0 + 10_000), 102.1, 'hız 2');
  yakin(medyaKonumu({ ...CALAN, hiz: 0.5 }, T0 + 10_000), 87.1, 'hız 0,5');
  assert.equal(medyaKonumu(CALAN, T0 - 5_000), 82.1, 'saat konum zamanından gerideyse geri gitmez');
});

test('medyaKonumu duraklamışken sabit', () => {
  const duran = { ...CALAN, caliyor: false };
  for (const simdi of [T0, T0 + 1, T0 + 60_000, T0 + 3_600_000, T0 - 5_000]) assert.equal(medyaKonumu(duran, simdi), 82.1, String(simdi));
});

test('medyaKonumu süreyi aşmaz', () => {
  assert.equal(medyaKonumu(CALAN, T0 + 3_600_000), 213.4, 'bir saat sonra süre sonunda durur');
  assert.equal(medyaKonumu(CALAN, T0 + 131_400), 213.4, 'sonu 100 ms geçince');
  assert.equal(medyaKonumu({ ...CALAN, konum: 500 }, T0), 213.4, 'yardımcı süreden büyük konum verse de');
  assert.equal(medyaKonumu({ ...CALAN, hiz: -4 }, T0 + 60_000), 0, 'geri sarma 0 altına inmez');
  assert.equal(medyaKonumu({ ...CALAN, sure: 0 }, T0 + 10_000), 0, 'zaman çizelgesi yoksa (sure 0) 0');
  assert.equal(medyaKonumu({ t: 'medya', var: false }, T0), 0, 'çalan yok');
});

test('durumGuncelle: her olay kendi alanını günceller; girdi değişmez', () => {
  const d0: SistemDurumu = { ...BOS_DURUM };
  const kopya = structuredClone(d0);
  const adimlar: [SistemOlayi, Partial<SistemDurumu>][] = [
    [{ t: 'guc', sarj: true, yuzde: 81 }, { guc: { sarj: true, yuzde: 81 } }],
    [{ t: 'ag', bagli: false }, { ag: false }],
    [{ t: 'ses-aygiti', ad: 'WH', tur: 'kulaklik', bagli: true, pil: 72 }, { sesAygiti: { ad: 'WH', tur: 'kulaklik', bagli: true, pil: 72 } }],
    [{ t: 'ses', duzey: 0.42, sessiz: false }, { ses: { duzey: 0.42, sessiz: false } }],
    [{ t: 'parlaklik', duzey: 0.6 }, { parlaklik: 0.6 }],
    [{ t: 'caps', acik: true }, { caps: true }],
    [{ t: 'dil', kod: 'tr-TR', ad: 'Türkçe' }, { dil: { kod: 'tr-TR', ad: 'Türkçe' } }],
    [{ t: 'tam-ekran', acik: true, ekran: EKRAN }, { tamEkran: { acik: true, ekran: EKRAN } }],
    [CALAN, { medya: CALAN }],
    [{ t: 'medya', var: false }, { medya: { t: 'medya', var: false } }],
  ];
  let d = d0;
  for (const [o, alan] of adimlar) {
    const yeni = durumGuncelle(d, o);
    assert.notEqual(yeni, d, `${o.t}: yeni nesne`);
    assert.deepEqual(yeni, { ...d, ...alan }, o.t);
    d = yeni;
  }
  assert.deepEqual(d0, kopya, 'ilk hâl değişmedi');
  // Olay nesnesi sonradan değişse de hâl etkilenmez (iç nesneler kopyalanır).
  const ekran = { ...EKRAN };
  const o: SistemOlayi = { t: 'tam-ekran', acik: true, ekran };
  const d2 = durumGuncelle(BOS_DURUM, o);
  ekran.en = 1;
  assert.equal(d2.tamEkran?.ekran.en, 2560);
  const medya = { ...CALAN };
  const d3 = durumGuncelle(BOS_DURUM, medya);
  medya.baslik = 'değişti';
  assert.equal(d3.medya?.var === true && d3.medya.baslik, 'Gesi Bağları', 'medya hâli kopyalanır');
});

test('durumGuncelle: durum olayı tüm hâli değiştirir; hazir ve hata değiştirmez', () => {
  const d: SistemDurumu = { ...BOS_DURUM, caps: true, ag: true };
  assert.equal(durumGuncelle(d, { t: 'hazir', surum: 1 }), d);
  assert.equal(durumGuncelle(d, { t: 'hata', mesaj: 'x' }), d);
  const tam: SistemDurumu = { ...BOS_DURUM, ag: false, parlaklik: 0.3 };
  assert.deepEqual(durumGuncelle(d, { t: 'durum', ...tam }), tam);
  assert.equal('t' in durumGuncelle(d, { t: 'durum', ...tam }), false, 'durum hâline "t" girmez');
});

// 0.14 T28b: yardımcı temiz çıkışta geri çağırma sayaçlarını tek satırla yazar. Yalnız listedeki adlar ve negatif olmayan tamsayılar geçer: tuş verisi,
// pencere başlığı ya da başka bir dize hiçbir yoldan ana sürece ulaşmaz.
test('sayac: yalnız izinli adlar ve negatif olmayan tamsayılar; dize, kesirli, negatif ve bilinmeyen alan atılır', () => {
  assert.deepEqual([...SAYAC_ALANLARI], ['sureMs', 'on', 'kucultme', 'appbar', 'ekran', 'klavyeKurulum', 'klavyeKaldirma', 'klavyeAcikMs', 'klavyeIsMs']);
  assert.deepEqual(olaySatiriAyristir('{"t":"sayac","sureMs":120000,"on":3,"kucultme":0,"appbar":2,"ekran":0,"klavyeKurulum":2,"klavyeKaldirma":2,"klavyeAcikMs":90000,"klavyeIsMs":16}'), {
    t: 'sayac', sayaclar: { sureMs: 120000, on: 3, kucultme: 0, appbar: 2, ekran: 0, klavyeKurulum: 2, klavyeKaldirma: 2, klavyeAcikMs: 90000, klavyeIsMs: 16 },
  });
  assert.deepEqual(olaySatiriAyristir('{"t":"sayac","on":1,"baslik":"Gizli belge","tus":65,"appbar":-1,"ekran":1.5,"kucultme":"2"}'), { t: 'sayac', sayaclar: { on: 1 } });
  assert.deepEqual(olaySatiriAyristir('{"t":"sayac"}'), { t: 'sayac', sayaclar: {} });
  const d: SistemDurumu = { ...BOS_DURUM, caps: true };
  assert.equal(durumGuncelle(d, { t: 'sayac', sayaclar: { on: 1 } }), d, 'sayaç hâli değiştirmez');
});

test('BOS_DURUM: tüm alanlar null ve dondurulmuş', () => {
  assert.deepEqual(BOS_DURUM, { guc: null, ag: null, sesAygiti: null, ses: null, parlaklik: null, caps: null, dil: null, tamEkran: null, medya: null });
  assert.equal(Object.isFrozen(BOS_DURUM), true);
});
