// 0.11 G12a — abonelik alanının kalkışı GÖÇ GÜVENLİ olmalı: 0.9/0.10 profillerinin ayarlar.json'unda `abonelik` kaydı (ödeme sorunu, Pro, faturalar…)
// bulunur; alan tipten, varsayılandan ve düzelticiden silindi. Eski kayıt (1) yüklemede hata vermeden atılır, (2) başka hiçbir ayarı bozmaz,
// (3) bir sonraki kayıtta dosyadan da gider, (4) bayat bir arayüz/telefon kopyası `ayarlar:kaydet` ile geri yazamaz (ayarKaydiniSuz).
// main/ayarlar.ts Electron'a bağlıdır: 'electron' ve yollar.ts bu dosyada sahtelenir (tests/ayar-kaydi.test.ts ile aynı yol).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { ayarKaydiniSuz } from '../src/main/ayar-kaydi.ts';

const klasor = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-ayar-abonelik-goc-'));
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

const ESKI_ABONELIK = {
  durum: 'odeme-sorunu', plan: 'pro', yenileme: '2026-11-25T09:30:00.000Z', sorunBaslangic: '2026-10-26T09:30:00.000Z', baslangic: '2026-10-25T09:30:00.000Z',
  odemeYontemi: '2026-10-25T09:30:00.000Z', faturalar: [{ no: 'FBR-ONZ-0001', tarih: '2026-10-25T09:30:00.000Z', tutar: 49, plan: 'pro' }], onizleme: true,
};

test('eski profil: ayarlar.json\'daki `abonelik` kaydı yüklemede sessizce atılır, öteki ayarlar aynen kalır', async () => {
  const dosya = path.join(klasor, 'ayarlar.json');
  // Göç yazımı tetiklenmesin diye kurulum/ses/motor alanları dolu: dosya yüklemede yeniden yazılmaz (kayıt hâlâ içinde).
  fs.writeFileSync(dosya, JSON.stringify({ kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', mod: 'is', tanitimSurumu: '0.9.0', ses: { surum: 3 }, motorCalisti: false, abonelik: ESKI_ABONELIK }));
  const m = await import('../src/main/ayarlar.ts');
  const a = m.ayarlar() as unknown as Record<string, unknown>;
  assert.equal('abonelik' in a, false, 'bellekteki ayarda abonelik alanı yok');
  assert.equal(a.kullaniciAdi, 'Deniz');
  assert.equal(a.mod, 'is');
  assert.equal((a.ses as { surum: number }).surum, 3);
  assert.equal(JSON.stringify(a).includes('FBR-ONZ'), false, 'eski fatura kaydı hiçbir yerde kalmadı');
  // Bir sonraki kayıt alanı dosyadan da götürür; yazma başka hiçbir alanı bozmaz.
  m.ayarlariKaydet({ hitap: 'Hocam' });
  const diskte = JSON.parse(fs.readFileSync(dosya, 'utf8')) as Record<string, unknown>;
  assert.equal('abonelik' in diskte, false, 'dosyada da kalmadı');
  assert.equal(diskte.kullaniciAdi, 'Deniz');
  assert.equal(diskte.hitap, 'Hocam');
  assert.equal(diskte.kurulumSurumu, KURULUM_SURUMU);
});

test('ayarlar:kaydet yolu (süzgeç + kayıt): bayat bir kopya `abonelik`i geri yazamaz', async () => {
  const dosya = path.join(klasor, 'ayarlar.json');
  const m = await import('../src/main/ayarlar.ts');
  // ipc.ts ayarlar:kaydet ile aynı yol: ayarKaydiniSuz sonra ayarlariKaydet.
  m.ayarlariKaydet(ayarKaydiniSuz({ abonelik: ESKI_ABONELIK, kullaniciAdi: 'Ece' } as never));
  assert.equal('abonelik' in (m.ayarlar() as unknown as Record<string, unknown>), false);
  const diskte = JSON.parse(fs.readFileSync(dosya, 'utf8')) as Record<string, unknown>;
  assert.equal('abonelik' in diskte, false, 'bayat kopya alanı dosyaya yazamadı');
  assert.equal(diskte.kullaniciAdi, 'Ece', 'süzgeç öteki alanları geçirir');
});
