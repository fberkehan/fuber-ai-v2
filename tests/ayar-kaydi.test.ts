// Kurulum sürümü göçünün KABLOLAMASI (Görev 23 düzeltme 1, küçük 5): ayarlar() 0.8 profilini okuyunca sürüm 1'i diske yazar; arayüzden
// gelen ayarlar:kaydet kurulum sürümünü (ve abonelik / bekleyen yerel kurulum kaydını) yok sayar (ayarKaydiniSuz). main/ayarlar.ts
// Electron'a bağlıdır: 'electron' ve yollar.ts bu dosyada sahtelenir (node:module registerHooks; tests/beyin-gece.test.ts ile aynı yol).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ayarKaydiniSuz } from '../src/main/ayar-kaydi.ts';

const klasor = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-ayar-kaydi-'));
(globalThis as Record<string, unknown>).__ayarTestKlasoru = klasor;
const veri = (kod: string) => `data:text/javascript,${encodeURIComponent(kod)}`;
const kanca = registerHooks({
  resolve(belirtec, baglam, sonraki) {
    if (belirtec === 'electron') return { url: veri('export const safeStorage = { isEncryptionAvailable: () => false };'), shortCircuit: true };
    if (belirtec === './yollar.js' && baglam.parentURL?.endsWith('/src/main/ayarlar.ts')) {
      return {
        url: veri(`const k = globalThis.__ayarTestKlasoru; const y = (a) => k + '/' + a;
          export const yollar = { ayarlar: () => y('ayarlar.json'), sirlar: () => y('sirlar.json'), varsayilanIceAktar: () => y('ice-aktar'), veri: () => k };`),
        shortCircuit: true,
      };
    }
    // Ana süreç kaynakları derleyici için '.js' uzantısıyla içe aktarır; burada yanındaki '.ts' dosyasına gider.
    if (belirtec.startsWith('.') && belirtec.endsWith('.js') && baglam.parentURL?.startsWith('file:')) {
      const ts = new URL(belirtec.replace(/\.js$/, '.ts'), baglam.parentURL);
      if (fs.existsSync(fileURLToPath(ts))) return sonraki(ts.href, baglam);
    }
    return sonraki(belirtec, baglam);
  },
});
after(() => {
  kanca.deregister();
  delete (globalThis as Record<string, unknown>).__ayarTestKlasoru;
  fs.rmSync(klasor, { recursive: true, force: true });
});

test('ayarKaydiniSuz: kurulum sürümü, abonelik ve bekleyen yerel kurulum kaydı düşer; geri kalanı ve girdi olduğu gibi', () => {
  const girdi = { kurulumSurumu: 0, abonelik: { durum: 'etkin' }, gorunum: { tema: 'acik' }, yerel: { etkin: true, bekleyenKurulum: { model: 'x' } } } as never;
  const kopya = structuredClone(girdi);
  const c = ayarKaydiniSuz(girdi) as Record<string, unknown>;
  assert.equal('kurulumSurumu' in c, false);
  assert.equal('abonelik' in c, false);
  assert.deepEqual(c.gorunum, { tema: 'acik' });
  assert.deepEqual(c.yerel, { etkin: true });
  assert.deepEqual(girdi, kopya, 'girdi değişmez');
  assert.deepEqual(ayarKaydiniSuz({ kullaniciAdi: 'Deniz' }), { kullaniciAdi: 'Deniz' });
});

// F1 (son inceleme Ö1): "Gizli modu kapattım" notunu yalnız ana süreç yazar ve siler (yerel:gizli-notu-kapat) — bayat kopya onu diriltmesin.
// F1 (K5): cihaz adının kurulum başına son eki yalnız ana süreçte (main/hesap.ts) — arayüz başka bir son ek yazıp ad değiştiremez.
test('ayarKaydiniSuz: yerel.gizliGeriAlindi ve cihazSoneki düşer', () => {
  const c = ayarKaydiniSuz({ yerel: { etkin: true, gizliGeriAlindi: 'hata' }, cihazSoneki: 'ffff', kullaniciAdi: 'Deniz' } as never) as Record<string, unknown>;
  assert.deepEqual(c.yerel, { etkin: true });
  assert.equal('cihazSoneki' in c, false);
  assert.equal(c.kullaniciAdi, 'Deniz');
});

// 0.10 E3: masaüstü Fuber hesabının kaydı yalnız main/hesap.ts'ten — arayüz kapalı bir hesabı "aktif" yazamaz, bayat kopya çıkıştan
// sonra hesabı diriltemez.
test('ayarKaydiniSuz: hesap kaydı (masaüstü Fuber hesabı) düşer', () => {
  const c = ayarKaydiniSuz({ hesap: { eposta: 'a@b.co', cihazAdi: 'X', durum: 'aktif' }, kullaniciAdi: 'Deniz' } as never) as Record<string, unknown>;
  assert.equal('hesap' in c, false);
  assert.equal(c.kullaniciAdi, 'Deniz');
});

// 0.10 Görev 2 (P3): "motor çalıştı" bilgisini yalnız ana süreç yazar (ilk başarılı bulut çağrısı) — arayüz "durdu"yu "bağlı değil"e
// (ya da tersine) çeviremez.
test('ayarKaydiniSuz: motorCalisti düşer', () => {
  const c = ayarKaydiniSuz({ motorCalisti: false, kullaniciAdi: 'Deniz' } as never) as Record<string, unknown>;
  assert.equal('motorCalisti' in c, false);
  assert.equal(c.kullaniciAdi, 'Deniz');
});

test('0.8 profili: ayarlar() göçte kurulum sürümü 1 yazar (diskte); arayüzden gelen kurulumSurumu: 0 yok sayılır', async () => {
  const dosya = path.join(klasor, 'ayarlar.json');
  // 0.8.0 profili: kurulum bitmiş, kurulumSurumu alanı HİÇ yok, ses göçü yapılmış (yalnız kurulum göçü sınansın).
  fs.writeFileSync(dosya, JSON.stringify({ kurulumTamam: true, kullaniciAdi: 'Deniz', mod: 'gelistirici', tanitimSurumu: '0.7.0', ses: { surum: 2 } }));
  // Kayıtlı bir anahtar (şifreli sır; içerik okunmaz): 0.13 T15 — kayıtlı API anahtarları artık okunmaz ve "bağlı" sayılmaz (silinmez); P3 göçü
  // onunla motorCalisti'yi true YAZMAZ (anahtarı olan 0.9 kullanıcısı Fuber hesabına giriş yap der).
  fs.writeFileSync(path.join(klasor, 'sirlar.json'), JSON.stringify({ 'api:anthropic': 'c2lmcmVsaQ==' }));
  const m = await import('../src/main/ayarlar.ts');
  const a = m.ayarlar();
  assert.equal(a.kurulumSurumu, 1, 'bellekte 1');
  assert.equal(JSON.parse(fs.readFileSync(dosya, 'utf8')).kurulumSurumu, 1, 'göç diske yazıldı');
  // 0.10 Görev 2 (P3): motorCalisti göçü artık kayıtlı anahtara bakmaz; 0.13'te kayıtlı sır sayılmaz → false (göç yine bir kez yazılır).
  assert.equal(a.motorCalisti, false, 'kayıtlı anahtar motor çalışmış saymaz');
  assert.equal(a.saglayicilar.anthropic.anahtarVar, false, 'kayıtlı sır okunmaz');
  assert.equal(JSON.parse(fs.readFileSync(dosya, 'utf8')).motorCalisti, false, 'P3 göçü diske yazıldı');
  assert.equal(JSON.parse(fs.readFileSync(path.join(klasor, 'sirlar.json'), 'utf8'))['api:anthropic'], 'c2lmcmVsaQ==', 'sır silinmedi');
  m.ayarlariKaydet(ayarKaydiniSuz({ motorCalisti: true } as never));
  assert.equal(m.ayarlar().motorCalisti, false, 'arayüzün kopyası geri almaz');
  assert.equal(JSON.parse(fs.readFileSync(dosya, 'utf8')).kullaniciAdi, 'Deniz', 'öteki alanlar korunur');
  // ipc.ts ayarlar:kaydet ile aynı yol: süzgeç + kayıt.
  m.ayarlariKaydet(ayarKaydiniSuz({ kurulumSurumu: 0, kullaniciAdi: 'Deniz' }));
  assert.equal(m.ayarlar().kurulumSurumu, 1);
  assert.equal(JSON.parse(fs.readFileSync(dosya, 'utf8')).kurulumSurumu, 1, 'bayat kopya sürümü geri almaz');
});
