// Gizli ya da "Yalnız bu bilgisayar" seçiliyken model seçicinin listesi sağlayıcıya GİTMEZ (anahtar kayıtlı olsa bile): liste isteği
// anahtarı buluta taşır — Gizli'nin "hiçbir şey bu bilgisayardan çıkmaz" sözü ve P14 "yalnız yerel asla bulut" kuralı (H3c takip kaygısı 3).
// 0.12 cila (H5 tur 2 kaygısı 1): bu BİLİNÇLİ bir mahremiyet davranışıdır, hata değil — not `hata` alanında değil `bilgi` alanında döner;
// arayüz onu ⚠ simgeli "Liste alınamadı" kutusunda değil, kilit simgeli sakin bir bilgi satırında gösterir. Bilgi notlu liste de (hatalı
// liste gibi) önbellekten yeniden kullanılmaz: Gizli kapanınca seçici canlı listeyi yeniden ister.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { anaSurecSahnesi, esbuildHazir } from './yardimci/ana-surec.ts';

const kok = path.resolve(import.meta.dirname, '..');
const oku = (y: string) => fs.readFileSync(path.join(kok, y), 'utf8').replace(/\r\n/g, '\n');

// ── Davranış: GERÇEK model-listesi.ts (Electron'suz ana süreç sahnesi; ağ bekçisi: yerel olmayan her istek testi düşürür) ──
anaSurecSahnesi('yerel-model-listesi', { kurulumTamam: true, mod: 'gelistirici', yerel: { gizliMod: true } });
(globalThis as Record<string, unknown>).__sifreleme = true;
await esbuildHazir();
const { sirYaz, ayarlariKaydet } = await import('../src/main/ayarlar.ts');
const { modelListesi, YEREL_LISTE_NOTU } = await import('../src/main/motor/model-listesi.ts');
process.env.FUBER_SIR_API_OPENAI = 'sk-' + 'SAHTE-yerel-model-listesi'; // 0.13 T15: kayıtlı api:* sırları okunmaz; sahte anahtar yalnız test ortamından
process.env.FUBER_SIR_API_ANTHROPIC = 'sk-ant-' + 'SAHTE-yerel-model-listesi';

test('model listesi: yerel/Gizli seçiliyken sağlayıcıya istek yok — yerleşik tablo + bilgi notu; kapı ağa çıkan her yoldan ÖNCE', () => {
  const m = oku('src/main/motor/model-listesi.ts');
  const kapi = m.indexOf('if (neredeYerelMi(ayarlar().yerel))');
  assert.ok(kapi > 0, 'modelListesi neredeYerelMi kapısını içerir');
  const govde = m.slice(m.indexOf('export async function modelListesi'));
  const kapiGovdede = govde.indexOf('if (neredeYerelMi(ayarlar().yerel))');
  assert.ok(kapiGovdede > 0 && kapiGovdede < govde.indexOf('saglayici(s)'), 'kapı sağlayıcı çağrısından önce');
  assert.ok(kapiGovdede < govde.indexOf('onbellek.get(s)'), 'kapı önbellekten bile önce (eski canlı liste de gösterilmez)');
  assert.match(m, /import \{ neredeYerelMi \} from '\.\.\/\.\.\/shared\/nerede\.js';/);
  assert.match(m, /return \{ saglayici: s, modeller: yerlesikListe\(s\), kaynak: 'yerlesik', bilgi: YEREL_LISTE_NOTU \};/);
  assert.doesNotMatch(m, /hata: YEREL_LISTE_NOTU/, 'mahremiyet notu hata alanında değil');
});

test('seçici: bilgi notu kilit simgeli sakin satır ("Liste alınamadı" kutusu değil); bilgi notlu liste önbellekten yeniden kullanılmaz', () => {
  const s = oku('src/renderer/bilesenler/ModelSecici.tsx');
  const bilgi = s.indexOf('l?.bilgi ? (');
  const hata = s.indexOf('l?.hata ? (');
  assert.ok(bilgi > 0 && hata > 0 && bilgi < hata, 'bilgi dalı hata dalından önce');
  const dal = s.slice(bilgi, hata);
  assert.match(dal, /data-not="yerel-liste"/);
  assert.match(dal, /<Ikon ad="kilit"/);
  assert.doesNotMatch(dal, /uyari|Liste alınamadı/);
  assert.match(s, /if \(hazir && !geciciListe\(hazir\)\) return Promise\.resolve\(hazir\);/, 'bilgi notlu liste de yeniden istenir');
  assert.match(s, /const geciciListe = \(l: ModelListesi\): boolean => Boolean\(l\.hata \|\| l\.bilgi\);/);
  // Gizli / "Yalnız bu bilgisayar" açılıp kapanınca sağlayıcı listeleri önbellekten atılır (eski canlı liste Gizli'de görünmesin).
  const dinleyici = s.slice(s.indexOf("dinle('ayarlar:degisti'"), s.indexOf("dinle('ayarlar:degisti'") + 500);
  assert.match(dinleyici, /neredeYerelMi\(a\?\.yerel\)/);
  assert.match(dinleyici, /if \(!k\.startsWith\('yerel\|'\)\) onbellek\.delete\(k\)/);
});

test('Gizli: anahtar kayıtlı sağlayıcının listesi ağa çıkmadan yerleşik tablo + `bilgi` (hata yok)', async () => {
  for (const s of ['openai', 'anthropic'] as const) {
    const l = await modelListesi(s);
    assert.equal(l.kaynak, 'yerlesik');
    assert.equal(l.bilgi, YEREL_LISTE_NOTU);
    assert.equal(l.hata, undefined, `${s}: mahremiyet notu hata sayılmaz`);
    assert.ok(l.modeller.length > 0);
  }
});

test('"Yalnız bu bilgisayar": aynı bilgi notu (hata yok)', async () => {
  ayarlariKaydet((a) => { a.yerel.gizliMod = false; a.yerel.yalnizYerel = true; });
  const l = await modelListesi('openai');
  assert.deepEqual([l.kaynak, l.bilgi, l.hata], ['yerlesik', YEREL_LISTE_NOTU, undefined]);
});
