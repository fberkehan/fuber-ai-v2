// F1 (son inceleme K1): Gizli mod açıkken pano (hava/haber/kur) ağa çıkmaz — GERÇEK main/pano/pano.ts, GERÇEK adresler (MET Norway,
// yayıncılar, ECB/TCMB) ve ana süreç ağ bekçisi (tests/yardimci/ana-surec.ts: Electron net.fetch yalnız 127.0.0.1'e gider, gerisi
// kaydedilir ve reddedilir; dosyanın sonunda kayıt boş olmalı). Karşı sınama: Gizli kapalıyken aynı yol gerçekten ağa çıkmak ister
// (bekçi yakalar, reddeder — istek dışarı gitmez); bu kayıt sınamadan sonra temizlenir.
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anaSurecSahnesi, esbuildHazir } from './yardimci/ana-surec.ts';

const { agIstekleri } = anaSurecSahnesi('pano-gizli', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', mod: 'is', tanitimSurumu: '0.9.0', ses: { surum: 2, uyandirma: false },
  proaktif: { etkin: false }, baslangictaAc: false, yerel: { gizliMod: true, etkin: true },
});
// FUBER_DEMO'da pano hiç ağa çıkmaz (önizleme kuralı); burada gerçek yol sınanır — bekçi her dış isteği yakalar.
delete process.env.FUBER_DEMO;
delete process.env.FUBER_PANO_SAHTE;
await esbuildHazir();
const { ayarlariKaydet } = await import('../src/main/ayarlar.ts');
const { panoDurumu, panoYenile } = await import('../src/main/pano/pano.ts');
const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('Gizli mod: pano durumu ve "Şimdi yenile" hiçbir ağ isteği yapmaz; kaynaklar "Gizli modda güncellenmiyor" (gizli)', async () => {
  const d = panoDurumu();
  await panoYenile();
  await bekle(150);
  assert.deepEqual(agIstekleri, [], 'Gizli modda pano ağa çıktı');
  for (const k of [d.hava, d.haberler, d.piyasa]) assert.deepEqual([k.durum, k.gizli], ['yok', true]);
});

test('karşı sınama: Gizli kapanınca aynı pano gerçek kaynaklara gitmek ister (bekçi yakalar)', async () => {
  ayarlariKaydet((a) => { a.yerel.gizliMod = false; });
  panoDurumu();
  await panoYenile();
  await bekle(150);
  assert.ok(agIstekleri.some((u) => /api\.met\.no/.test(u)), JSON.stringify(agIstekleri));
  agIstekleri.length = 0; // istekler bekçide reddedildi (dışarı gitmedi); dosya sonu denetimi Gizli sınaması içindir
});
