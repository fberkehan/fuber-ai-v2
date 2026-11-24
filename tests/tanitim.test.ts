// Kokpit tanıtım turunun sürüm işareti (Ruling 20): tur kurulumdan sonra bir kez açılır; 0.6.0'dan yükselen kurulu profil (işaret
// yok) de turu bir kez görür; izlenince bir daha açılmaz; "Tanıtımı yeniden izle" işareti siler. Görev 23 (K11): tur 0.9.0 (yeni
// duraklar: pano, hızlı denetimler); durak sayısı moda göre. 0.12 H3a: yükseltme sihirbazı yok — kurulum sürümü tura karar vermez.
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ILK_GOREV_METNI, TANITIM_SURUMU, sonDurakEylemi, sonDurakNotu, tanitimAcilsinMi, tanitimDuraklari } from '../src/shared/tanitim.ts';
import { HESAP_DURUM_METNI } from '../src/shared/masaustu-hesap.ts';

test('kurulum bitmeden tur açılmaz', () => {
  assert.equal(tanitimAcilsinMi({ kurulumTamam: false, tanitimSurumu: '' }), false);
  assert.equal(tanitimAcilsinMi({ kurulumTamam: false }), false);
});

test('yeni kurulum: kurulum bitince tur açılır (işaret boş)', () => {
  assert.equal(tanitimAcilsinMi({ kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: '' }), true);
});

test('0.6.0 profili (kurulumTamam, işaret hiç yok) yükseltmede turu bir kez görür; 0.12 H3a: kurulum sürümü karara girmez', () => {
  assert.equal(tanitimAcilsinMi({ kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU }), true);
  assert.equal(tanitimAcilsinMi({ kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: undefined }), true);
  // Yükseltme sihirbazı yok: her kurulum sürümünde (alan yok, 1, 2, 3) kural aynı — kabuk çizilince tur açılır.
  assert.equal(tanitimAcilsinMi({ kurulumTamam: true, mod: 'is' }), true);
  assert.equal(tanitimAcilsinMi({ kurulumTamam: true, kurulumSurumu: 1, mod: 'gelistirici', tanitimSurumu: '0.7.0' }), true);
  assert.equal(tanitimAcilsinMi({ kurulumTamam: true, kurulumSurumu: 2, mod: 'gelistirici' }), true);
  assert.equal(tanitimAcilsinMi({ kurulumTamam: true, kurulumSurumu: 3, mod: 'is', tanitimSurumu: '' }), true);
  // Kurulum bitmemişse tur yok (önce kurulum; renderer/main.tsx kabuğu kurulum açıkken çizmez).
  assert.equal(tanitimAcilsinMi({ kurulumTamam: false, kurulumSurumu: KURULUM_SURUMU }), false);
});

test('izlenen tur (işaret bu sürüm) bir daha açılmaz; eski sürümün işareti turu yeniden açar', () => {
  assert.equal(tanitimAcilsinMi({ kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: TANITIM_SURUMU }), false);
  assert.equal(tanitimAcilsinMi({ kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: '0.7.0' }), true);
});

// G23 bulgu 5: sürüm 2'deki İş kullanıcısı oturum ortasında Geliştirici'ye geçince yükseltme bekler; "Tanıtımı yeniden izle" (işaret '')
// yine açılmalı — açılış kararı çoktan verildi (oturumOrtasi). İzlenmiş tur yine açılmaz; kurulum bitmeden yine yok.
test('"Tanıtımı yeniden izle" açılışta da oturum ortasında da aynı kuralla açar (0.12 H3a: bekleyen yükseltme yok)', () => {
  const bekleyen = { kurulumTamam: true, kurulumSurumu: 2, mod: 'gelistirici' as const, tanitimSurumu: '' };
  assert.equal(tanitimAcilsinMi(bekleyen), true, 'açılışta sihirbaz yok');
  assert.equal(tanitimAcilsinMi(bekleyen, true), true, 'oturum ortasında tur yeniden izlenebilir');
  assert.equal(tanitimAcilsinMi({ ...bekleyen, tanitimSurumu: TANITIM_SURUMU }, true), false);
  assert.equal(tanitimAcilsinMi({ ...bekleyen, kurulumTamam: false }, true), false);
});

test('işaret 0.9.0 turu', () => {
  assert.equal(TANITIM_SURUMU, '0.9.0');
});

// 0.10 Görev 1 (D1): 3B beyin kalktı — turda "beyin" durağı yok (beyni anlatan metin de yok).
test('hiçbir modda beyin durağı yok', () => {
  for (const mod of ['is', 'gelistirici'] as const) {
    const l = tanitimDuraklari(mod);
    assert.ok(!l.some((d) => d.id === 'beyin'), mod);
    for (const d of l) assert.doesNotMatch(`${d.baslik} ${d.metin}`, /bey(?:in|n[aeıiuü])|üç boyutlu|\b3B\b|fareyle çevir/i, `${mod}/${d.id}`);
  }
});

// 0.10 E4 (G8 Step 7, P6): tur kısa — İş 4, Geliştirici 5 durak; yalnız simge sözlüğü olan ray durakları (pano, sohbetler,
// bağlantılar, ayarlar, hızlı denetimler) kalktı. Kokpit balonu selamlamanın ALTINDA (vurgu kokpitin kendisi), sohbet yazı alanı gerçek bir
// iş öğretir, son durak ada.
test('duraklar moda göre: İş 4 (Claude Code yok), Geliştirici 5; son durak ada', () => {
  const is = tanitimDuraklari('is').map((d) => d.id), g = tanitimDuraklari('gelistirici').map((d) => d.id);
  assert.deepEqual(is, ['kokpit', 'sohbet-yazi', 'hafiza', 'ada']);
  assert.deepEqual(g, ['kokpit', 'sohbet-yazi', 'hafiza', 'claude', 'ada']);
  for (const yok of ['beyin', 'pano', 'hizli', 'ayarlar', 'baglantilar', 'sohbetler']) assert.ok(!g.includes(yok), yok);
  // Kokpit durağı rayın simgesini değil kokpitin kendisini vurgular ve balon altına yerleşir; yazı alanı durağı kokpitteki sohbetin yazıcısı.
  const k = tanitimDuraklari('is')[0];
  assert.ok(k.hedef && !/data-tur/.test(k.hedef), k.hedef);
  assert.equal(k.yer, 'alt');
  assert.match(tanitimDuraklari('is')[1].hedef ?? '', /yazici/);
  // İş modunda durak metinlerinde teknik/sağlayıcı dili yok; Türkçe kesme işareti ’.
  for (const d of tanitimDuraklari('is')) {
    assert.doesNotMatch(`${d.baslik} ${d.metin}`, /\bAPI\b|anahtar|\bmodel|Claude|ElevenLabs|token|beyin/i, d.id);
    assert.doesNotMatch(`${d.baslik} ${d.metin}`, /'/, `${d.id}: düz kesme işareti`);
  }
});

// I1 (R19): son durak motor durumunu YALNIZ motorGorunumu'dan alır (shared/motor-durumu.ts).
test('son durağın eylemi: yapay zekâ hazırsa ilk görev (hatırlatıcı), değilse hesap girişi, Gizli modda yalnız "Bitir"', () => {
  const HATIRLAT = { tur: 'hatirlatici', etiket: 'Yarın sabah için bir hatırlatıcı kur' };
  const GIRIS = { tur: 'hesap', etiket: 'Yapay zekâ bağla' };
  assert.deepEqual(sonDurakEylemi({ gorunum: 'hazir', gizliMod: false }), HATIRLAT);
  for (const g of ['bagli-degil', 'durdu', 'yerel'] as const) assert.deepEqual(sonDurakEylemi({ gorunum: g, gizliMod: false }), GIRIS, g);
  // 0.12 H3c düzeltme turu 1 (P14 K1): "Yalnız bu bilgisayar" seçiliyken HER hâlde yalnız "Bitir" — yanıtlar buluta gitmez, hatırlatıcı (araç)
  // yerelde yok; ilk iş bulut işi olmaz (eskiden inerken bulut yanıtlıyor ve hatırlatıcı öneriliyordu).
  for (const g of ['yerel', 'hazirlaniyor', 'yerel-hazir-degil', 'hazir'] as const) assert.equal(sonDurakEylemi({ gorunum: g, gizliMod: false, yalnizYerel: true }), null, g);
  // Gizli modda HER ZAMAN yalnız "Bitir": hatırlatıcı bu kipte kapalı, bulut hesabı sayılmaz (E4 düzeltme turu 1).
  for (const g of ['hazir', 'bagli-degil', 'hesap-kapali'] as const) assert.equal(sonDurakEylemi({ gorunum: g, gizliMod: true }), null, g);
  assert.match(ILK_GOREV_METNI, /^Yarın sabah/);
});

test('son durak, hesap hâllerinde (R10): onay bekliyor → düğme yok ("Bitir") + sakin not; kapalı / hak doldu → "Hesabı gör" + not', () => {
  assert.equal(sonDurakEylemi({ gorunum: 'hesap-bekliyor', gizliMod: false }), null);
  assert.deepEqual(sonDurakEylemi({ gorunum: 'hesap-kapali', gizliMod: false }), { tur: 'hesap', etiket: 'Hesabı gör' });
  assert.deepEqual(sonDurakEylemi({ gorunum: 'kredi-bitti', gizliMod: false }), { tur: 'hesap', etiket: 'Hesabı gör' });
  assert.equal(sonDurakNotu({ gorunum: 'hesap-bekliyor', gizliMod: false }), HESAP_DURUM_METNI.bekliyor);
  assert.equal(sonDurakNotu({ gorunum: 'hesap-kapali', gizliMod: false }), HESAP_DURUM_METNI.kapali);
  assert.equal(sonDurakNotu({ gorunum: 'kredi-bitti', gizliMod: false }), HESAP_DURUM_METNI['kredi-bitti']);
  for (const g of ['hazir', 'yerel', 'bagli-degil', 'durdu'] as const) assert.equal(sonDurakNotu({ gorunum: g, gizliMod: false }), null, g);
  assert.equal(sonDurakNotu({ gorunum: 'hesap-kapali', gizliMod: true }), null, 'Gizli modda hesap anılmaz');
});

test('son durak (G2 düzeltme turu 1): hesap aktif ama bağlantı koptu → "Yeniden dene" (giriş yapmış kullanıcıya "giriş yap" denmez)', () => {
  assert.deepEqual(sonDurakEylemi({ gorunum: 'durdu', gizliMod: false, hesapAktif: true }), { tur: 'yeniden-dene', etiket: 'Yeniden dene' });
  assert.deepEqual(sonDurakEylemi({ gorunum: 'durdu', gizliMod: false, hesapAktif: false }), { tur: 'hesap', etiket: 'Yapay zekâ bağla' });
  assert.equal(sonDurakEylemi({ gorunum: 'durdu', gizliMod: true, hesapAktif: true }), null, 'Gizli modda (yerel hazır değil → durdu) yalnız "Bitir"');
});
