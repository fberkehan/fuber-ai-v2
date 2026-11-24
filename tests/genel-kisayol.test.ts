// Genel (her uygulamada geçerli) kısayollar (src/shared/genel-kisayol.ts; Görev 20b düzeltme turu 1): acil durdurma Ctrl+Alt+Q idi
// — Türkçe Q klavyede AltGr = Ctrl+Alt, AltGr+Q = "@": her "@" yazışta Fuber'in bütün işi duruyor, karakter yutuluyordu. Varsayılanlar
// "yasak" kümesine karşı denetlenir: Ctrl+Alt (AltGr) + yazı tuşu (Türkçe Q ve F'de karakter yazar), işletim sistemi ve yaygın uygulama
// kısayolları. Eski ifade kaynakta (kurulum sihirbazı ve tanıtım sayfası dahil) kalmamalı.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LANDING_VAR } from './yardimci/ozel.ts';
import { ACIL_DURDURMA, ACIL_DURDURMA_METNI, VARSAYILAN_ASISTAN, ESKI_ACIL_DURDURMA, acilDurdurmaKisayolu, genelKisayolSorunu, BILINEN_CAKISMALAR, tepsiDurdurEtiketi, acilDurdurmaNotu, asistanKisayolNotu, ACIL_YER, ACIL_YEDEK_METNI, acilYerlestir } from '../src/shared/genel-kisayol.ts';

// Düzeltme turu 2: acil durdurma başka bir uygulamada kayıtlıysa alınamıyor (register → false) ama tepsi ve Ayarlar yine tuşu
// söz veriyordu. Alınamayan tuş yazılmaz; Ayarlar "alınamadı" der ve tepsiye yönlendirir.
test('alınamayan acil durdurma kısayolu söz verilmez: tepsi tuşsuz, Ayarlar "alınamadı" der', () => {
  assert.equal(tepsiDurdurEtiketi(true, 'Alt+Shift+Q'), 'Tümünü durdur (Alt+Shift+Q)');
  assert.equal(tepsiDurdurEtiketi(false, 'Alt+Shift+Q'), 'Tümünü durdur');
  const yok = acilDurdurmaNotu(false, 'Alt+Shift+Q');
  assert.equal(yok?.sorun, true);
  assert.match(yok?.metin ?? '', /alınamadı/);
  assert.match(yok?.metin ?? '', /Tümünü durdur/);
  assert.deepEqual(acilDurdurmaNotu(true, 'Alt+Shift+Q'), { metin: ' Acil durdurma: Alt+Shift+Q.', sorun: false });
  assert.equal(acilDurdurmaNotu(null, 'Alt+Shift+Q'), null, 'durum bilinmeden ne söz ne uyarı');
});

// A12 (son düzeltme): kayıtlı asistan kısayolu açılışta yasak kümede bulunursa alınmaz; Ayarlar nedenini ve "değiştir"i söyler.
test('A12: asistan kısayolu alınamadıysa Ayarlar notu nedeni ve "değiştir"i söyler; alındıysa ya da bilinmiyorsa not yok', () => {
  const sorun = genelKisayolSorunu('Control+Alt+F', 'win32')!;
  const not = asistanKisayolNotu({ tus: 'Control+Alt+F', alindi: false, sorun }, 'Ctrl+Alt+F') ?? '';
  assert.match(not, /Asistan kısayolu \(Ctrl\+Alt\+F\) alınamadı: Ctrl\+Alt birleşimi/);
  assert.match(not, /yeni bir kısayol yaz/);
  assert.match(asistanKisayolNotu({ tus: 'X', alindi: false }, 'X') ?? '', /başka bir uygulama kullanıyor/);
  assert.equal(asistanKisayolNotu({ tus: 'CommandOrControl+Shift+Space', alindi: true }, 'Ctrl+Shift+Space'), null);
  assert.equal(asistanKisayolNotu(null, ''), null);
});

test('varsayılan genel kısayollar yasak kümede değil (Windows ve Mac)', () => {
  assert.equal(genelKisayolSorunu(ACIL_DURDURMA, 'win32'), null);
  assert.equal(genelKisayolSorunu(acilDurdurmaKisayolu('darwin'), 'darwin'), null);
  assert.equal(genelKisayolSorunu(VARSAYILAN_ASISTAN, 'win32'), null);
  assert.equal(ACIL_DURDURMA_METNI, 'Alt+Shift+Q');
  assert.ok(!/Control|Ctrl/.test(ACIL_DURDURMA) || !/Alt/.test(ACIL_DURDURMA), 'acil durdurmada Ctrl+Alt yok');
});

test('Ctrl+Alt + yazı tuşu (AltGr) yasak: eski acil durdurma, @ € { [ ] } \\ | ~ tuşları; F tuşu/boşluk serbest', () => {
  assert.match(genelKisayolSorunu(ESKI_ACIL_DURDURMA, 'win32') ?? '', /AltGr/);
  for (const k of ['CommandOrControl+Alt+Q', 'Ctrl+Alt+E', 'Control+Alt+7', 'Control+Alt+0', 'CmdOrCtrl+Alt+-', 'Control+Alt+Shift+Q', 'Control+Alt+Ğ', 'Control+Alt+,']) assert.ok(genelKisayolSorunu(k, 'win32'), k);
  for (const k of ['CommandOrControl+Alt+F9', 'Control+Alt+Space']) assert.equal(genelKisayolSorunu(k, 'win32'), null, k);
});

test('işletim sistemi ve yaygın uygulama kısayolları yasak; Mac\'te Option + yazı tuşu da (karakter yazar)', () => {
  for (const k of ['Control+C', 'CommandOrControl+V', 'Ctrl+Z', 'Control+Shift+Escape', 'Control+Shift+T', 'Control+Shift+N', 'Control+Shift+Q', 'Alt+F4', 'Alt+Tab', 'Alt+Space', 'F11', 'Super+L', 'Control+Tab']) assert.ok(genelKisayolSorunu(k, 'win32'), k);
  assert.ok(genelKisayolSorunu('Alt+Shift+Q', 'darwin'), 'Mac: Option+Shift+Q = Œ');
  assert.equal(genelKisayolSorunu('', 'win32'), 'Kısayol boş.');
});

test('bilinen (engellemeyen) çakışmalar belgeli: asistanın Ctrl+Shift+Space\'i Office/VS Code\'da kullanılıyor', () => {
  assert.match(BILINEN_CAKISMALAR[VARSAYILAN_ASISTAN] ?? '', /Word/);
});

test('eski acil durdurma ifadesi kaynakta kalmadı (kurulum sihirbazı ve tanıtım sayfası dahil)', () => {
  const kok = path.resolve(import.meta.dirname, '..');
  const kalan: string[] = [];
  const tara = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const y = path.join(d, e.name);
      if (e.isDirectory()) { tara(y); continue; }
      if (!/\.(tsx?|html|css)$/.test(e.name) || e.name === 'genel-kisayol.ts') continue;
      if (/Ctrl\+Alt\+Q|Control\+Alt\+Q/.test(fs.readFileSync(y, 'utf8'))) kalan.push(path.relative(kok, y));
    }
  };
  tara(path.join(kok, 'src'));
  if (LANDING_VAR) tara(path.join(kok, 'landing')); // açık kaynak hazırlığı: genel depoda yok (tests/yardimci/ozel.ts)
  assert.deepEqual(kalan, []);
  assert.ok(fs.readFileSync(path.join(kok, 'src', 'renderer', 'imlec.html'), 'utf8').includes(ACIL_DURDURMA_METNI), 'imleç şeridi yeni tuşu yazar');
});