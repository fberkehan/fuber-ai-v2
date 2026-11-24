// Bağlanma kapısı (src/main/entegrasyon/baglanti-kapisi.ts; Görev 20b, G19): WhatsApp "Vazgeç" bağlanırken basılırsa, await'ten
// dönen eski deneme ne soket kurmalı ne de geç gelen QR'ı göstermeli. Her vazgeçiş denemenin neslini geçersiz kılar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BaglantiKapisi } from '../src/main/entegrasyon/baglanti-kapisi.ts';

const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** whatsappBaslat'ın iskeleti: modül yükle (await) → soket kur → QR (await) → göster. */
async function dene(kapi: BaglantiKapisi, etkin: () => boolean, kayit: string[]): Promise<void> {
  const n = kapi.basla();
  await bekle(20); // import + oturum + sürüm
  if (!kapi.gecerli(n, etkin())) { kayit.push('vazgeçildi: soket kurulmadı'); return; }
  kayit.push('soket');
  await bekle(20); // QR görseli üretiliyor
  if (!kapi.gecerli(n, etkin())) { kayit.push('geç QR yok sayıldı'); return; }
  kayit.push('qr');
}

test('bağlanırken Vazgeç: await sonrası soket kurulmaz', async () => {
  const kapi = new BaglantiKapisi();
  let etkin = true;
  const kayit: string[] = [];
  const p = dene(kapi, () => etkin, kayit);
  await bekle(5); etkin = false; kapi.iptal();
  await p;
  assert.deepEqual(kayit, ['vazgeçildi: soket kurulmadı']);
});

test('QR üretilirken Vazgeç: geç QR gösterilmez', async () => {
  const kapi = new BaglantiKapisi();
  let etkin = true;
  const kayit: string[] = [];
  const p = dene(kapi, () => etkin, kayit);
  await bekle(28); etkin = false; kapi.iptal();
  await p;
  assert.deepEqual(kayit, ['soket', 'geç QR yok sayıldı']);
});

test('vazgeçip yeniden bağlan: yeni deneme geçerli, eskisi değil; vazgeçilmeyen deneme QR gösterir', async () => {
  const kapi = new BaglantiKapisi();
  const eski = kapi.basla();
  kapi.iptal();
  const yeni = kapi.basla();
  assert.equal(kapi.gecerli(eski, true), false);
  assert.equal(kapi.gecerli(yeni, true), true);
  assert.equal(kapi.gecerli(yeni, false), false, 'ayar kapalıysa (etkin değil) geçersiz');
  const kayit: string[] = [];
  await dene(kapi, () => true, kayit);
  assert.deepEqual(kayit, ['soket', 'qr']);
});
