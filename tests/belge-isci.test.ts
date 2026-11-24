// İnceleme I1: belge ayrıştırma ana süreçte değil, süre ve bellek sınırlı işçide. ZIP biçimlerinde girdi sayısı ve açılan toplam sınırlı (başlık
// yalan söylese de akışlı sayaç durdurur); xlsx satır/hücre sınırlı. Zip bombası ve dev xlsx uygulamayı (olay döngüsünü) dondurmaz, tek satırlık
// hata ya da açık not verir.
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { anaSurecSahnesi, esbuildHazir } from './yardimci/ana-surec.ts';

const sahne = anaSurecSahnesi('belge-isci', { kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', mod: 'gelistirici', tanitimSurumu: '0.9.0', proaktif: { etkin: false }, baslangictaAc: false });
await esbuildHazir();
const { belgeAyristir, ayristirmaHatasi } = await import('../src/main/belge-ayristir.ts');
const { ekMetniOku } = await import('../src/main/iceaktar.ts');
const kl = path.join(sahne.klasor, 'isci');
fs.mkdirSync(kl, { recursive: true });

/** En küçük ZIP yazıcı (deflate). `yalan`: merkez dizine yazılan açık boyut (gerçeğinden farklı: zip bombası başlığı). */
function zipYaz(girdiler: { ad: string; veri: Buffer; yalan?: number }[]): Buffer {
  const yereller: Buffer[] = [];
  const merkez: Buffer[] = [];
  let ofset = 0;
  for (const g of girdiler) {
    const sik = zlib.deflateRawSync(g.veri, { level: 9 });
    const crc = zlib.crc32(g.veri);
    const ad = Buffer.from(g.ad, 'utf8');
    const acik = g.yalan ?? g.veri.length;
    const y = Buffer.alloc(30); y.writeUInt32LE(0x04034b50, 0); y.writeUInt16LE(20, 4); y.writeUInt16LE(0x800, 6); y.writeUInt16LE(8, 8); y.writeUInt32LE(crc, 14); y.writeUInt32LE(sik.length, 18); y.writeUInt32LE(acik, 22); y.writeUInt16LE(ad.length, 26);
    yereller.push(y, ad, sik);
    const m = Buffer.alloc(46); m.writeUInt32LE(0x02014b50, 0); m.writeUInt16LE(20, 4); m.writeUInt16LE(20, 6); m.writeUInt16LE(0x800, 8); m.writeUInt16LE(8, 10); m.writeUInt32LE(crc, 16); m.writeUInt32LE(sik.length, 20); m.writeUInt32LE(acik, 24); m.writeUInt16LE(ad.length, 28); m.writeUInt32LE(ofset, 42);
    merkez.push(m, ad);
    ofset += 30 + ad.length + sik.length;
  }
  const md = Buffer.concat(merkez);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(girdiler.length, 8); e.writeUInt16LE(girdiler.length, 10); e.writeUInt32LE(md.length, 12); e.writeUInt32LE(ofset, 16);
  return Buffer.concat([...yereller, md, e]);
}

/** Ölçüm: verilen iş sürerken olay döngüsünün en uzun boşluğu (ms) — ana süreç donmuyor mu. */
async function donmadan<T>(f: () => Promise<T>): Promise<{ sonuc: T; enUzun: number }> {
  let son = performance.now(), enUzun = 0;
  const z = setInterval(() => { const t = performance.now(); enUzun = Math.max(enUzun, t - son); son = t; }, 10);
  try { return { sonuc: await f(), enUzun }; } finally { clearInterval(z); }
}

const sifirlar = Buffer.alloc(120 * 1024 * 1024); // 120 MB sıfır: ~120 KB'a sıkışır

test('zip bombası (dürüst başlık): merkez dizindeki açık toplam 100 MB\'ı aşıyor — açmadan reddedilir, tek satır', async () => {
  const yol = path.join(kl, 'bomba.docx');
  fs.writeFileSync(yol, zipYaz([{ ad: 'word/document.xml', veri: sifirlar }]));
  assert.ok(fs.statSync(yol).size < 2 * 1024 * 1024, 'dosya küçük');
  const { sonuc, enUzun } = await donmadan(() => belgeAyristir(yol, { azamiKarakter: 40_000 }));
  assert.ok('hata' in sonuc && sonuc.kod === 'sinir', JSON.stringify(sonuc));
  assert.ok(enUzun < 500, `olay döngüsü ${Math.round(enUzun)} ms durdu`);
  const ek = await ekMetniOku(yol);
  assert.ok('hata' in ek && /sıkıştırma bombası/.test(ek.hata) && !ek.hata.includes('\n'), JSON.stringify(ek));
});

test('zip bombası (yalan başlık): başlık 1 KB der, akışlı sayaç gerçek açılan bayt 100 MB\'ı aşınca durdurur', async () => {
  const yol = path.join(kl, 'yalan.xlsx');
  fs.writeFileSync(yol, zipYaz([{ ad: 'xl/worksheets/sheet1.xml', veri: sifirlar, yalan: 1024 }]));
  const { sonuc, enUzun } = await donmadan(() => belgeAyristir(yol, { azamiKarakter: 40_000 }));
  assert.ok('hata' in sonuc && sonuc.kod === 'sinir', JSON.stringify(sonuc));
  assert.ok(enUzun < 500, `olay döngüsü ${Math.round(enUzun)} ms durdu`);
});

test('çok parçalı arşiv: girdi sayısı sınırı', async () => {
  const yol = path.join(kl, 'cok.pptx');
  fs.writeFileSync(yol, zipYaz(Array.from({ length: 30 }, (_, i) => ({ ad: `ppt/slides/slide${i + 1}.xml`, veri: Buffer.from('<a:t>x</a:t>') }))));
  const r = await belgeAyristir(yol, { azamiKarakter: 40_000, zip: { azamiGirdi: 20, azamiAcik: 100 * 1024 * 1024 } });
  assert.ok('hata' in r && r.kod === 'sinir' && /çok fazla parça/.test(r.hata), JSON.stringify(r));
});

test('dev xlsx (60.000 satır): sayfa başına 5.000 satırda kesilir, açık not; uygulama donmaz', async () => {
  const satirlar: string[] = [];
  for (let i = 1; i <= 60_000; i++) satirlar.push(`<row r="${i}"><c r="A${i}" t="inlineStr"><is><t>satır ${i}</t></is></c><c r="B${i}"><v>${i * 2}</v></c></row>`);
  const sayfa = `<?xml version="1.0"?><worksheet><sheetData>${satirlar.join('')}</sheetData></worksheet>`;
  const yol = path.join(kl, 'dev.xlsx');
  fs.writeFileSync(yol, zipYaz([
    { ad: 'xl/workbook.xml', veri: Buffer.from('<workbook><sheets><sheet name="Veri" sheetId="1"/></sheets></workbook>') },
    { ad: 'xl/worksheets/sheet1.xml', veri: Buffer.from(sayfa) },
  ]));
  const t0 = Date.now();
  const { sonuc, enUzun } = await donmadan(() => belgeAyristir(yol, { azamiKarakter: 2_000_000 }));
  assert.ok(!('hata' in sonuc), JSON.stringify(sonuc));
  if ('hata' in sonuc) return;
  assert.match(sonuc.parcalar[0].metin, /^## Sayfa: Veri\nsatır 1\t2\n/);
  assert.match(sonuc.parcalar[0].metin, /satır 5000\t10000\n/);
  assert.doesNotMatch(sonuc.parcalar[0].metin, /satır 5001\t/);
  assert.match(sonuc.not ?? '', /"Veri" ilk 5\.000 satırla kesildi/);
  assert.ok(enUzun < 500, `olay döngüsü ${Math.round(enUzun)} ms durdu`);
  assert.ok(Date.now() - t0 < 20_000);
  // Ek olarak: kesilme sohbet ekinde de açıkça söylenir.
  const ek = await ekMetniOku(yol);
  assert.ok(!('hata' in ek) && /kesildi/.test(ek.metin) && ek.kisaltildi === true, JSON.stringify(ek).slice(0, 300));
});

test('süre sınırı: işçi kesin sürede öldürülür; tek satırlık hata', async () => {
  const yol = path.join(kl, 'yavas.xlsx');
  fs.writeFileSync(yol, zipYaz([{ ad: 'xl/worksheets/sheet1.xml', veri: Buffer.from('<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>') }]));
  const r = await belgeAyristir(yol, { azamiKarakter: 1000, sureMs: 1 });
  assert.ok('hata' in r && r.kod === 'zaman', JSON.stringify(r));
  const m = ayristirmaHatasi('yavas.xlsx', r)!;
  assert.match(m, /^yavas\.xlsx okunamadı: \d+ sn içinde bitmedi/);
});
