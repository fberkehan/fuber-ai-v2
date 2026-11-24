// WhatsApp kapısı: WhatsApp bağlantısı bu depoda yoktur (isteğe bağlı modül, ozel/whatsapp/); kapı modülsüz kapalı kalır. Genel kod modülle YALNIZ
// main/entegrasyon/whatsapp-kapisi.ts üzerinden konuşur: kayıt (whatsappModuluKaydet) + yetki (shared/whatsapp-yetki.ts).
// Karar ANA SÜREÇTE uygulanır: modül yoksa satır yok, araç yok, IPC başlatmaz, kokpit verisi boş, hata yok; modül varken yalnız İş modunda ve
// WhatsApp hakkı olan hesapta; kapı kapanınca süren bağlantı durur (oturum ve "etkin" korunur), kapı yeniden açılınca kendiliğinden bağlanır.
// Bu test modülsüz de koşar: gerçek modül yerine SAHTE bir modül kaydeder (ağ yok, WhatsApp kitaplığı yok).
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { anaSurecSahnesi, ipcKurBos, ipcIsleyicileri } from './yardimci/ana-surec.ts';

anaSurecSahnesi('whatsapp-kapisi', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', hitap: 'Deniz', mod: 'is', tanitimSurumu: '0.9.0',
  ses: { surum: 2, uyandirma: false }, proaktif: { etkin: false }, baslangictaAc: false,
  hesap: { eposta: 'deniz@ornek.com', cihazAdi: 'DENIZ-PC', durum: 'aktif' },
});
delete process.env.FUBER_DEMO;
delete process.env.FUBER_TEST_WHATSAPP_PAKET;
await ipcKurBos();
const K = await import('../src/main/entegrasyon/whatsapp-kapisi.ts');
const { ayarlar, ayarlariKaydet } = await import('../src/main/ayarlar.ts');
const { veritabani } = await import('../src/main/vt.ts');
const { kokpitVerisi } = await import('../src/main/kokpit/duzen.ts');
const { turAraclari } = await import('../src/main/ajan/dongu.ts');
const { aracKaydet, sema } = await import('../src/main/ajan/araclar/kayit.ts');
const { herOlayiDinle } = await import('../src/main/olaylar.ts');
const ipc = (k: string, ...a: unknown[]) => Promise.resolve(ipcIsleyicileri().get(k)!({}, ...a));
const kok = path.resolve(import.meta.dirname, '..');
const bekle = (ms = 20) => new Promise((c) => setTimeout(c, ms));

veritabani().prepare("INSERT INTO wa_mesajlar(jid, ad, yon, metin, zaman, okundu, kimlik) VALUES('905000000001@s.whatsapp.net', 'Ahmet', 'gelen', 'merhaba', ?, 0, 'k-1')").run(new Date().toISOString());
const olaylar: { kanal: string; veri: unknown }[] = [];
herOlayiDinle((kanal: string, veri: unknown) => { if (kanal === 'whatsapp:durum' || kanal === 'kokpit:veri-degisti') olaylar.push({ kanal, veri }); });

test('modül yok (bu depo): satır yok, IPC başlatmaz, araç yok, kokpit ve alıcı çözümü boş — hata yok', async () => {
  assert.equal(K.whatsappModuluVar(), false);
  assert.deepEqual(K.whatsappDurumu(), { durum: 'kapali', izinli: false, neden: 'modul-yok' });
  assert.deepEqual(await ipc('whatsapp:durum'), { durum: 'kapali', izinli: false, neden: 'modul-yok' });
  const d = await ipc('whatsapp:baslat') as { izinli: boolean };
  assert.equal(d.izinli, false);
  assert.equal(ayarlar().whatsapp.etkin, false, 'başlatma isteği ayarı açmadı');
  assert.equal((await ipc('durum:al') as { whatsapp: string }).whatsapp, 'kapali');
  K.whatsappAraclariniKaydet(); // modül yokken sessizce hiçbir şey kaydetmez
  assert.ok(!(await turAraclari('x', false, false)).some((a) => a.grup === 'whatsapp'));
  assert.deepEqual(K.whatsappKisiCoz('Ahmet'), { jid: null, adaylar: [] });
  assert.deepEqual(kokpitVerisi().whatsapp, [], 'yerel kayıt dursa da kokpitte WhatsApp yok');
  assert.equal(K.whatsappBagli(), false);
  await ipc('whatsapp:cikis'); // çıkış her zaman güvenli
});

// ── Sahte modül (gerçek modülün yerine): çağrılar kaydedilir ──
const cagrilar: string[] = [];
let baglanti: 'kapali' | 'bagli' = 'kapali';
const sahte = {
  durum: () => ({ durum: baglanti, numara: baglanti === 'bagli' ? '905000000000' : undefined }),
  baslat: async () => { cagrilar.push('baslat'); baglanti = 'bagli'; K.whatsappDurumYayinla(); },
  durdur: () => { cagrilar.push('durdur'); baglanti = 'kapali'; K.whatsappDurumYayinla(); },
  cikis: async () => { cagrilar.push('cikis'); baglanti = 'kapali'; ayarlariKaydet((a) => { a.whatsapp.etkin = false; a.whatsapp.bagli = false; }); },
  kisiCoz: (kime: string) => ({ jid: kime === 'Ahmet' ? '905000000001@s.whatsapp.net' : null, adaylar: [] }),
  araclariKaydet: () => aracKaydet({ grup: 'whatsapp', risk: 'serbest', etiket: () => 'sahte', tanim: { ad: 'whatsapp_sahte', aciklama: 'sahte', sema: sema({}) }, calistir: async () => ({ icerik: 'ok' }) }),
  lisanslar: [{ ad: 'Sahte', ne: 'WhatsApp bağlantısı', atif: 'Sahte — MIT lisansı', lisans: 'MIT', dosya: 'x', metin: 'MIT' }],
};

test('genel kod özel modül klasörünü içe aktarmaz; özel modül bağımlılıkları (varsa) zorunlu bağımlılık değil', () => {
  // Modülün kitaplık adları burada bilerek yazılmaz; adlı denetim modülün kendi testindedir.
  const yasak = /(from\s+|import\s*\(\s*)['"][^'"]*\/ozel\//;
  const gez = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? gez(path.join(d, e.name)) : /\.(ts|tsx|mjs|js)$/.test(e.name) ? [path.join(d, e.name)] : []);
  const ihlal = gez(path.join(kok, 'src')).filter((f) => yasak.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(kok, f));
  assert.deepEqual(ihlal, []);
  const pk = JSON.parse(fs.readFileSync(path.join(kok, 'package.json'), 'utf8'));
  const ozel = Object.values((pk.ozelModulBagimliliklari ?? {}) as Record<string, string[]>).flat();
  for (const ad of ozel) {
    assert.ok(!(ad in (pk.dependencies ?? {})), `${ad}: zorunlu (genel) bağımlılık değil`);
    assert.ok(ad in (pk.optionalDependencies ?? {}), `${ad}: yalnız isteğe bağlı grupta (modülle birlikte kurulur)`);
  }
  if (!fs.existsSync(path.join(kok, 'ozel'))) assert.equal(pk.ozelModulBagimliliklari, undefined, 'modülsüz depoda modül bağımlılığı listesi yok');
});
