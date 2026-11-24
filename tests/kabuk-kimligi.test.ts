// 0.10 E1 fix turu 2: kimlik gaspı temizliği açılışta ana pencereden ÖNCE çalışır (main.ts whenReady) — içindeki hiçbir hata (ayar
// dosyası yazılamadı: disk dolu, kilitli dosya; beklenmedik bir Electron hatası) ana pencerenin açılmasını engellememeli. GERÇEK ana
// süreç modülüyle (src/main/kabuk-kimligi.ts + ayarlar.ts) sınanır; Electron sahte, veri geçici (FUBER_VERI → KURU kip: yalnız testin
// klasörü taranır, hiçbir kısayola dokunulmaz), ağ yok (tests/yardimci/ana-surec.ts).
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { anaSurecSahnesi, esbuildHazir } from './yardimci/ana-surec.ts';

const { klasor } = anaSurecSahnesi('kabuk-kimligi', { kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', mod: 'is', tanitimSurumu: '0.9.0', ses: { surum: 2, uyandirma: false }, proaktif: { etkin: false }, baslangictaAc: false });
const baslat = path.join(klasor, 'baslat-menusu');
fs.mkdirSync(baslat, { recursive: true });
process.env.FUBER_TEST_BASLAT_MENUSU = baslat;
await esbuildHazir();
const { kimlikGaspiniTemizle } = await import('../src/main/kabuk-kimligi.ts');
const { ayarlariKaydet, ayarlar } = await import('../src/main/ayarlar.ts');
const { app } = (await import('electron')) as unknown as { app: { getVersion: () => string } };
const kayitYolu = path.join(klasor, 'kisayol-temizligi.json');
const ayarDosyasi = path.join(klasor, 'ayarlar.json');

/** console.warn'ı yakalar (temizlik hatayı günlüğe yazmalı). */
function uyarilarla<T>(f: () => T): { sonuc: T; uyarilar: string[] } {
  const uyarilar: string[] = [];
  const eski = console.warn;
  console.warn = (...a: unknown[]) => { uyarilar.push(a.map(String).join(' ')); };
  try { return { sonuc: f(), uyarilar }; } finally { console.warn = eski; }
}

test('ayar dosyası yazılamazken (disk dolu / kilitli) temizlik FIRLATMAZ: hatayı günlüğe yazar, kuru kaydı yine yazar, açılış sürer', () => {
  // jsonYaz önce `<ayarlar.json>.yaziliyor`a yazar: aynı adlı bir KLASÖR her yazımı düşürür (platformdan bağımsız, belirlenimci).
  const engel = `${ayarDosyasi}.yaziliyor`;
  fs.mkdirSync(engel);
  try {
    assert.throws(() => ayarlariKaydet((a) => { a.kullaniciAdi = 'Deniz'; }), 'sahne kurulamadı: ayar yazımı fırlatmıyor');
    const diskteOnce = fs.readFileSync(ayarDosyasi, 'utf8');
    const { sonuc, uyarilar } = uyarilarla(() => { let r: string[] | undefined; assert.doesNotThrow(() => { r = kimlikGaspiniTemizle(); }); return r; });
    assert.deepEqual(sonuc, []);
    assert.equal(fs.readFileSync(ayarDosyasi, 'utf8'), diskteOnce, 'ayar dosyası değişmemeli (yazım başarısız)');
    if (process.platform === 'win32') {
      assert.ok(uyarilar.some((u) => /temizlik sürümü ayara yazılamadı/.test(u)), uyarilar.join(' | '));
      // Sürüm yazılamadı ama temizlik sürdü: kuru kayıt yazıldı (boş klasör → taşınacak yok).
      const kayit = JSON.parse(fs.readFileSync(kayitYolu, 'utf8'));
      assert.equal(kayit.kuru, true);
      assert.deepEqual(kayit.tasinacak, []);
      assert.equal(kayit.klasor, baslat);
    }
  } finally {
    fs.rmSync(engel, { recursive: true, force: true });
  }
});

test('temizliğin içinde beklenmedik bir hata (Electron fırlatır) giriş noktasından dışarı ÇIKMAZ: günlüğe yazılır, [] döner', () => {
  // Önceki testte sürüm bellekte yazılmış olabilir: kapı yeniden açılsın, tarama gerçekten çalışsın.
  ayarlariKaydet((a) => { delete a.kisayolTemizligiSurumu; });
  assert.equal(ayarlar().kisayolTemizligiSurumu, undefined);
  const eski = app.getVersion;
  app.getVersion = () => { throw new Error('test: sürüm okunamadı'); };
  try {
    const { sonuc, uyarilar } = uyarilarla(() => { let r: string[] | undefined; assert.doesNotThrow(() => { r = kimlikGaspiniTemizle(); }); return r; });
    assert.deepEqual(sonuc, []);
    if (process.platform === 'win32') assert.ok(uyarilar.some((u) => /kısayol temizliği yapılamadı, açılış sürüyor: test: sürüm okunamadı/.test(u)), uyarilar.join(' | '));
  } finally {
    app.getVersion = eski;
  }
});

test('hata yokken: kuru kip kaydı yazar, sürümü ayara (diske) yazar; aynı sürümde ikinci çağrı taramaz', () => {
  fs.rmSync(kayitYolu, { force: true });
  ayarlariKaydet((a) => { delete a.kisayolTemizligiSurumu; });
  assert.deepEqual(kimlikGaspiniTemizle(), []);
  if (process.platform !== 'win32') return; // temizlik yalnız Windows'ta
  assert.ok(fs.existsSync(kayitYolu));
  assert.equal(JSON.parse(fs.readFileSync(ayarDosyasi, 'utf8')).kisayolTemizligiSurumu, app.getVersion());
  fs.rmSync(kayitYolu, { force: true });
  kimlikGaspiniTemizle();
  assert.equal(fs.existsSync(kayitYolu), false, 'aynı sürümde yeniden taradı');
});
