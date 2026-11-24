// Pano ortakları (Görev 24): konum (saat dilimi + dil; IP yok), şehir listesi, MET simgeleri ve Türkçe metin, güneş saatleri, yaş yazısı,
// geri çekilme. src/shared/pano.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  varsayilanSehir, panoKonumu, sehirBul, SEHIRLER, koordinat, havaSimgesi, havaMetni, gunesSaatleri, yasMetni, geriCekilmeMs,
  haberKaynaklari, yerelPara, gosterilecekKurlar,
} from '../src/shared/pano.ts';
import { IS_YASAK } from '../src/shared/is-dili.ts';

test('varsayılan şehir: saat diliminden (Türkiye → İstanbul, Berlin dilimi → Berlin), eş adlar, dil bölgesi, en son İstanbul', () => {
  assert.equal(varsayilanSehir('Europe/Istanbul').id, 'istanbul');
  assert.equal(varsayilanSehir('Asia/Istanbul').id, 'istanbul');
  assert.equal(varsayilanSehir('Europe/Berlin').id, 'berlin');
  assert.equal(varsayilanSehir('Europe/Kiev').id, 'kiev');
  assert.equal(varsayilanSehir('America/Los_Angeles').id, 'los-angeles');
  assert.equal(varsayilanSehir('Etc/UTC', 'de-CH').id, 'zurih');
  assert.equal(varsayilanSehir('Etc/UTC', 'tr-TR').id, 'istanbul');
  assert.equal(varsayilanSehir(undefined, undefined).id, 'istanbul');
});

test('panoKonumu: ayardaki şehir öncelikli (geçersizse saat dilimi); kaynak işaretli', () => {
  assert.deepEqual(panoKonumu({ sehir: 'ankara' }, 'Europe/Berlin'), { sehirId: 'ankara', sehir: 'Ankara', ulke: 'TR', enlem: 39.93, boylam: 32.86, saatDilimi: 'Europe/Istanbul', kaynak: 'ayar', haberUlke: 'TR', paraUlke: 'TR' });
  assert.equal(panoKonumu({ sehir: 'yok-boyle' }, 'Europe/Berlin').sehirId, 'berlin');
  assert.equal(panoKonumu({ sehir: '' }, 'Europe/Istanbul').kaynak, 'saat-dilimi');
});

test('listede olmayan saat dilimi: en yakın saat farklı şehir TAHMİN edilir; haberler uluslararası katalogdan, para dil bölgesinden', () => {
  const kis = Date.UTC(2026, 0, 15, 12); // yaz saati farkları karışmasın
  for (const [tz, dil, beklenen] of [
    ['Europe/Ljubljana', 'sl-SI', 'berlin'], ['Asia/Manila', 'en-PH', 'sanghay'], ['Australia/Perth', 'en-AU', 'sanghay'],
    ['America/Bogota', 'es-CO', 'new-york'] /* ocakta ikisi de UTC−5 */, ['Europe/Vilnius', 'lt-LT', 'atina'],
  ] as const) {
    const k = panoKonumu(undefined, tz, dil, kis);
    assert.equal(k.kaynak, 'tahmin', tz);
    assert.equal(k.sehirId, beklenen, `${tz} → ${k.sehirId}`);
    assert.equal(k.haberUlke, '*', `${tz}: tahmin edilen şehrin ülkesinin haberleri gösterilmez`);
  }
  // Para: dilin bölgesi (sl-SI → Slovenya, avro) — tahmin edilen şehrin ülkesi değil.
  assert.equal(panoKonumu(undefined, 'Europe/Ljubljana', 'sl-SI', kis).paraUlke, 'SI');
  // Listede olan dilim tahmin değildir; genel UTC dilimi saat farkına bakmaz (dil bölgesi → şehir).
  assert.equal(panoKonumu(undefined, 'Europe/Berlin', 'de-DE', kis).kaynak, 'saat-dilimi');
  assert.equal(panoKonumu(undefined, 'Etc/UTC', 'de-CH', kis).sehirId, 'zurih');
  assert.equal(panoKonumu(undefined, 'Etc/UTC', 'tr-TR', kis).sehirId, 'istanbul');
  // Türkiye saat dilimi her dilde İstanbul (tahmin değil).
  const tr = panoKonumu(undefined, 'Europe/Istanbul', 'en-US', kis);
  assert.equal(tr.sehirId, 'istanbul');
  assert.notEqual(tr.kaynak, 'tahmin');
});

test('şehir listesi: 81 il, tekil kimlikler, geçerli koordinat ve saat dilimi; istekte 2 ondalık', () => {
  assert.equal(SEHIRLER.filter((s) => s.ulke === 'TR').length, 81);
  assert.equal(new Set(SEHIRLER.map((s) => s.id)).size, SEHIRLER.length);
  for (const s of SEHIRLER) {
    assert.ok(Math.abs(s.enlem) <= 90 && Math.abs(s.boylam) <= 180, s.id);
    assert.doesNotThrow(() => new Date().toLocaleString('tr-TR', { timeZone: s.saatDilimi }), s.saatDilimi);
  }
  assert.equal(sehirBul('izmir')?.ad, 'İzmir');
  assert.equal(koordinat(41.0082), '41.01');
  assert.equal(koordinat(-0.1276), '-0.13');
});

test('MET simgesi ve Türkçe koşul', () => {
  assert.equal(havaSimgesi('clearsky_day'), 'acik-gun');
  assert.equal(havaSimgesi('clearsky_night'), 'acik-gece');
  assert.equal(havaSimgesi('fair_polartwilight'), 'az-bulut-gece');
  assert.equal(havaSimgesi('partlycloudy_day'), 'az-bulut-gun');
  assert.equal(havaSimgesi('cloudy'), 'bulut');
  assert.equal(havaSimgesi('fog'), 'sis');
  assert.equal(havaSimgesi('lightrainshowers_day'), 'saganak');
  assert.equal(havaSimgesi('heavyrain'), 'yagmur');
  assert.equal(havaSimgesi('lightssleetshowersandthunder_day'), 'firtina');
  assert.equal(havaSimgesi('snow'), 'kar');
  assert.equal(havaSimgesi('sleet'), 'sulu-sepken');
  assert.equal(havaSimgesi(undefined), 'bulut');
  assert.equal(havaMetni('clearsky_day'), 'Açık');
  assert.equal(havaMetni('partlycloudy_night'), 'Parçalı bulutlu');
  assert.equal(havaMetni('lightrain'), 'Hafif yağmur');
  assert.equal(havaMetni('rain'), 'Yağmurlu');
  assert.equal(havaMetni('heavyrainshowers_day'), 'Kuvvetli sağanak');
  assert.equal(havaMetni('lightsleet'), 'Hafif karla karışık yağmur');
  assert.equal(havaMetni('snowshowers_day'), 'Kar sağanağı');
  assert.equal(havaMetni('rainandthunder'), 'Gök gürültülü sağanak');
  assert.equal(havaMetni('bilinmez'), 'Bulutlu');
});

test('güneş saatleri (çevrimdışı): Londra yaz gündönümü ±4 dk; ekvator ~12 saat gündüz; kutup gününde null', () => {
  const l = gunesSaatleri(new Date('2026-06-21T12:00:00Z'), 51.5074, -0.1278);
  const dk = (d: Date | null, hhmm: string) => Math.abs(d!.getTime() - Date.parse(`2026-06-21T${hhmm}:00Z`)) / 60_000;
  assert.ok(dk(l.dogus, '03:43') <= 4, String(l.dogus?.toISOString()));
  assert.ok(dk(l.batis, '20:21') <= 4, String(l.batis?.toISOString()));
  const e = gunesSaatleri(new Date('2026-03-20T12:00:00Z'), 0, 0);
  const gunduz = (e.batis!.getTime() - e.dogus!.getTime()) / 3600_000;
  assert.ok(gunduz > 11.9 && gunduz < 12.3, String(gunduz));
  assert.deepEqual(gunesSaatleri(new Date('2026-06-21T12:00:00Z'), 78.2, 15.6), { dogus: null, batis: null });
});

test('yaş yazısı, geri çekilme, haber kataloğu, para birimi', () => {
  const s = Date.parse('2026-10-25T12:00:00Z');
  assert.equal(yasMetni('2026-10-25T11:59:40Z', s), 'az önce');
  assert.equal(yasMetni('2026-10-25T11:48:00Z', s), '12 dk önce');
  assert.equal(yasMetni('2026-10-25T09:00:00Z', s), '3 sa önce');
  assert.equal(yasMetni('2026-10-23T12:00:00Z', s), '2 gün önce');
  assert.equal(yasMetni(undefined, s), '');
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(geriCekilmeMs), [2, 4, 8, 16, 30, 30].map((d) => d * 60_000));
  assert.ok(haberKaynaklari('TR').length >= 3 && haberKaynaklari('TR').every((k) => k.url.startsWith('https://')));
  assert.equal(haberKaynaklari('ZZ'), haberKaynaklari('*'));
  assert.equal(yerelPara('TR'), 'TRY');
  assert.equal(yerelPara('DE'), 'EUR');
  assert.equal(yerelPara('ZZ'), 'USD');
  assert.deepEqual(gosterilecekKurlar('TRY'), ['USD', 'EUR', 'GBP']);
  assert.deepEqual(gosterilecekKurlar('EUR'), ['USD', 'GBP', 'CHF']);
  for (const k of [...haberKaynaklari('TR'), ...haberKaynaklari('*')]) assert.doesNotMatch(k.ad, IS_YASAK, k.ad);
});
