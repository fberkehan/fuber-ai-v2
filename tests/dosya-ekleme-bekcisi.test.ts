// Dosya ekleme bekçisi (13 Kas 2026; "görsel harici dosya yükleyemiyorum"): kök neden Claude Code yazma kutusunun yalnız görsel kabul etmesiydi
// (PNG/JPEG/GIF/WebP seçici + yapıştırma + bırakma). Bir daha sessizce görsele daralmasın: her SOHBET yazma kutusu ortak kuralı (shared/ek-kural.ts)
// kullanır, desteklenen her tür modele gider, desteklenmeyen tür tek cümleyle söylenir, belge işçisi pakete girer. Paketli denetim:
// scripts/dev/kurulu-dosya-ekleme.mjs (gerçek paket, üç yol).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EK_SECICI_KABUL, BELGE_UZ, ekSinifla, ekliMesajMetni, ekleriAyikla, ekMetinleri, EK_TOPLAM_METIN } from '../src/shared/ek-kural.ts';

const kok = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const oku = (g: string) => fs.readFileSync(path.join(kok, g), 'utf8');
const dosyalar = (dizin: string, uz: RegExp, out: string[] = []): string[] => {
  for (const a of fs.readdirSync(path.join(kok, dizin), { withFileTypes: true })) {
    const g = `${dizin}/${a.name}`;
    if (a.isDirectory()) dosyalar(g, uz, out); else if (uz.test(a.name)) out.push(g);
  }
  return out;
};

test('seçici kabul listesi: görsel, PDF, Office, metin, kod ve video türlerinin hepsini içerir', () => {
  const k = EK_SECICI_KABUL.split(',');
  for (const x of ['image/*', '.pdf', '.docx', '.xlsx', '.pptx', '.txt', '.md', '.csv', '.json', '.mp4', '.mov', '.webm']) assert.ok(k.includes(x), x);
  for (const u of BELGE_UZ) assert.ok(k.includes(`.${u}`), u);
});

test('her dosya girişi ortak kuralı kullanır: masaüstü sohbet ve Claude Code kutuları yalnız görsel kabul etmez', () => {
  // Masaüstü arayüzündeki her <input type="file"> için kabul listesi: ortak liste ya da belgeleri de içeren özel liste (toplantı bağlamı: belge listesi).
  // Telefon arayüzü (cep/) ayrı bir köprüdür; orada görsel dışı dosya yoktur (bilinen sınır, rapor).
  const ozel = new Map<string, RegExp>([['src/renderer/toplanti/Toplanti.tsx', /BAGLAM_BELGE_KABUL/]]);
  const bulunan: string[] = [];
  for (const g of dosyalar('src/renderer', /\.tsx$/)) {
    if (g.startsWith('src/renderer/cep/')) continue;
    const kaynak = oku(g);
    for (const m of kaynak.matchAll(/<input\b[^>]*type="file"[^>]*>/g)) {
      bulunan.push(g);
      const etiket = m[0];
      const tamam = /accept=\{(?:EK_SECICI_KABUL|SECICI_KABUL)\}/.test(etiket) || (ozel.get(g)?.test(etiket) ?? false);
      assert.ok(tamam, `${g}: dosya girişi ortak kabul listesini (EK_SECICI_KABUL) kullanmıyor — yalnız görsel olmasın: ${etiket.slice(0, 160)}`);
    }
  }
  assert.ok(bulunan.some((g) => g.endsWith('claudecode/Yazici.tsx')), 'Claude Code yazma kutusunun dosya girişi bulunamadı');
  assert.ok(bulunan.some((g) => g.endsWith('bilesenler/Sohbet.tsx')), 'Sohbet yazma kutusunun dosya girişi bulunamadı');
});

test('Claude Code yazma kutusu: seçici, bırakma ve yapıştırma belge/videoyu ekHazirla/videoHazirla hattına verir; görsele geri dönmez', () => {
  const y = oku('src/renderer/claudecode/Yazici.tsx');
  assert.ok(/onDrop=\{[^}]*dosyalariAl\(/.test(y), 'bırakma dosyalariAl kullanmalı');
  assert.ok(/clipboardData\.files/.test(y) && /dosyalariAl\(dosyalar\)/.test(y), 'yapıştırma dosya (PDF…) da almalı');
  assert.ok(/onChange=\{\(e\) => \{ dosyalariAl\(/.test(y), 'seçici dosyalariAl kullanmalı');
  assert.ok(/ekHazirla/.test(y) && /videoHazirla/.test(y) && /ekliMesajMetni/.test(y), 'belge/video hazırlama ve mesaja ekleme');
  assert.ok(!/accept="image\//.test(y), 'seçici yalnız görsel kabul etmemeli');
});

test('desteklenen her tür kabul edilir: PDF, DOCX, XLSX, PPTX, TXT, MD, CSV, JSON, EML, MP4 (+ tarayıcı MIME ile)', () => {
  const mime: Record<string, string> = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', eml: 'message/rfc822' };
  for (const [u, m] of Object.entries(mime)) {
    assert.deepEqual(ekSinifla(`dosya.${u}`, m, 5000), { tur: 'belge' }, u);
    assert.deepEqual(ekSinifla(`dosya.${u}`, '', 5000), { tur: 'belge' }, `${u} (MIME'siz)`);
  }
  assert.deepEqual(ekSinifla('klip.mp4', 'video/mp4', 5_000_000), { tur: 'video' });
  assert.deepEqual(ekSinifla('klip.MOV', 'video/quicktime', 5_000_000), { tur: 'video' });
});

test('desteklenmeyen tür ve boyut: tek cümlelik açık ileti', () => {
  assert.deepEqual(ekSinifla('arsiv.zip', 'application/zip', 100), { hata: 'Bu dosya türü desteklenmiyor: .zip' });
  assert.deepEqual(ekSinifla('garip.xyz', '', 100), { hata: 'Bu dosya türü desteklenmiyor: .xyz' });
  const buyuk = ekSinifla('buyuk.txt', 'text/plain', 21 * 1024 * 1024);
  assert.ok('hata' in buyuk && /çok büyük/.test(buyuk.hata) && /20 MB/.test(buyuk.hata), JSON.stringify(buyuk));
  assert.ok(!('hata' in buyuk) || !buyuk.hata.includes('\n'));
});

test('mesaja ek: yazılan metin + <ek> blokları; her ekin içeriği modele gider; görünümde çip olur', () => {
  const ekler = [
    { ad: 'rapor.pdf', tur: 'belge' as const, metin: 'PDFISARETI içerik' },
    { ad: 'tablo.xlsx', tur: 'belge' as const, metin: 'Ay\tXLSXISARETI' },
    { ad: 'klip.mp4', tur: 'video' as const, metin: 'Konuşma yazısı: VIDEOISARETI', kareSayisi: 4 },
  ];
  const m = ekliMesajMetni('Bunları özetle', ekler);
  for (const i of ['PDFISARETI', 'XLSXISARETI', 'VIDEOISARETI']) assert.ok(m.includes(i), i);
  assert.ok(m.startsWith('Bunları özetle\n\n<ek ad="rapor.pdf" tur="belge">'));
  const ay = ekleriAyikla(m);
  assert.equal(ay.metin, 'Bunları özetle');
  assert.deepEqual(ay.ekler.map((e) => [e.ad, e.tur]), [['rapor.pdf', 'belge'], ['tablo.xlsx', 'belge'], ['klip.mp4', 'video']]);
  // yalnız ek (metin yok) ve ek yok
  assert.equal(ekliMesajMetni('', ekler), ekMetinleri(ekler));
  assert.equal(ekliMesajMetni('merhaba', []), 'merhaba');
  assert.equal(ekliMesajMetni('merhaba', undefined), 'merhaba');
  // toplam sınır AÇIKÇA söylenir (sessiz kesme yok)
  const uzun = ekliMesajMetni('x', Array.from({ length: 3 }, (_, i) => ({ ad: `u${i}.txt`, tur: 'belge' as const, metin: 'a'.repeat(60_000), toplam: 60_000 })));
  assert.ok(uzun.length < EK_TOPLAM_METIN + 2_000 && /ek kısaltıldı/.test(uzun));
});

test('paket: belge işçisi ve ayrıştırıcı bağımlılıkları pakete girer (asar içinden utilityProcess; dev\'de gizlenen kırılmalar)', () => {
  const pkg = JSON.parse(oku('package.json')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
  for (const b of ['pdf-parse', 'mailparser']) {
    assert.ok(pkg.dependencies[b], `${b} dependencies içinde olmalı (devDependencies pakete girmez)`);
    assert.ok(!pkg.devDependencies[b], `${b} devDependencies'te olmamalı`);
  }
  const yml = oku('electron-builder.yml');
  assert.ok(/dist\/\*\*\/\*/.test(yml), 'dist/** pakete girer (belge-isci.js dahil)');
  assert.ok(!/!dist\/main/.test(yml) && !/!node_modules\/(pdf-parse|mailparser|@napi-rs)/.test(yml), 'işçi ve ayrıştırıcı paketten dışlanmamalı');
  const b = oku('scripts/build-main.mjs');
  assert.ok(/outfile: 'dist\/main\/belge-isci\.js'/.test(b), 'belge işçisi ayrı paket olarak derlenir');
  // İşçi, belge-ayristir'in açtığı dosya adıyla aynı
  assert.ok(/belge-isci\.js/.test(oku('src/main/belge-ayristir.ts')));
  assert.ok(/UTILITY_IZINLI/.test(oku('tests/sigortalar.test.ts')) && /belge-isci/.test(oku('tests/sigortalar.test.ts')));
});
