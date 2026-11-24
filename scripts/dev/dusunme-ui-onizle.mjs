// Düşünme motoru arayüzünün hızlı görsel denetimi (geçici betik). Geçici FUBER_VERI ile açar (kurulum tamam, anahtar
// yok, FUBER_DEMO: yapay zekâ planlaması kapalı). Önce gerçek ana süreçle BOŞ durumlar, sonra ana süreçteki gunkaydi:*
// işleyicileri SENTETİK örnek veriyle değiştirilip DOLU durumlar çekilir (ayar dosyasına yazılmaz, mikrofon açılmaz).
// Çalıştır: npm run build && node scripts/dev/dusunme-ui-onizle.mjs [çıktı-klasörü]
import { KURULUM_SURUMU } from '../../src/shared/kurulum-adimlari.ts';
import { _electron as electron } from 'playwright-core';
import electronYolu from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const kok = path.resolve(import.meta.dirname, '../..');
const cikti = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'fuber-dusunme-ui'));
fs.mkdirSync(cikti, { recursive: true });
const veri = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-dusunme-ui-'));
fs.writeFileSync(path.join(veri, 'ayarlar.json'), JSON.stringify({ kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: '0.9.0', kullaniciAdi: 'Deniz', hitap: 'Deniz', ses: { uyandirma: false, seslendirme: false }, baslangictaAc: false, mod: 'gelistirici' }));

const u = await electron.launch({ executablePath: electronYolu, args: [kok], env: { ...process.env, FUBER_DEMO: '1', FUBER_VERI: veri, FUBER_BELGELER: veri }, timeout: 60000 });
let w;
for (let i = 0; i < 120 && !w; i++) { w = u.windows().find((x) => x.url().includes('index.html')); if (!w) await new Promise((c) => setTimeout(c, 250)); }
if (!w) throw new Error('ana pencere yok');
await u.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes('index.html'))?.setContentSize(1440, 900));
await w.waitForSelector('.kokpit', { timeout: 30000 });
const hatalar = [];
w.on('pageerror', (e) => hatalar.push(String(e)));
w.on('console', (m) => { if (m.type() === 'error') hatalar.push(m.text()); });

const bekle = (ms) => w.waitForTimeout(ms);
const foto = async (ad, hedef) => { await (hedef ?? w).screenshot({ path: path.join(cikti, `${ad}.png`) }); console.log('📸', ad); };
const ray = w.locator('.ray__dgm');
const sayfa = async (n) => { await ray.nth(n).click(); await bekle(900); };
// Ayarlar → Düşünme motoru (çapa) ve bütün akordeon grupları açık (her grup bir kart).
const dusunmeAyarlari = async () => {
  await w.evaluate(() => { location.hash = 'dusunme'; });
  await w.locator('.ray__dgm:has-text("Ayarlar")').click(); await bekle(900);
  for (let i = 0; i < 6; i++) { const k = w.locator('#dusunme .akordeon__bas[aria-expanded="false"]'); if (!(await k.count())) break; await k.first().click(); }
  await bekle(500);
};
const ayarKartlari = async (onEk) => {
  const kartlar = w.locator('#dusunme .kart');
  for (let i = 0; i < (await kartlar.count()); i++) { await kartlar.nth(i).scrollIntoViewIfNeeded(); await bekle(250); await foto(`${onEk}-${i + 1}`, kartlar.nth(i)); }
};
const hafizaSekmeleri = async (onEk) => {
  // Sekmeler adla seçilir (Görev 20b'de Hafıza'ya "Belgeler" eklendi; sıra kaydı).
  for (const [etiket, ad] of [['Notlar', 'notlar'], ['Raporlar', 'raporlar'], ['Takip edilecekler', 'meseleler']]) { await w.locator('.ust-sekmeler button', { hasText: etiket }).click(); await bekle(700); await foto(`${onEk}-${ad}`); }
};

// ── 1) Gerçek ana süreç: boş durumlar ──
await dusunmeAyarlari();
await ayarKartlari('1-ayarlar-bos');
// Rıza paneli ve silme onayı (onaylanmaz: dinleme başlamasın, veri silinmesin).
await w.locator('#dusunme .anahtar').first().click(); await bekle(300);
await foto('1-ayarlar-riza', w.locator('#dusunme .kart').first());
await w.getByRole('button', { name: 'Vazgeç' }).first().click();
await w.getByRole('button', { name: 'Bütün konuşmalar' }).click(); await bekle(300);
await foto('1-ayarlar-sil-onayi', w.locator('#dusunme .kart').last());
await w.getByRole('button', { name: 'Vazgeç' }).first().click();
await sayfa(2); await foto('1-hafiza'); await hafizaSekmeleri('1-hafiza-bos');
await sayfa(0); await foto('1-kokpit');

// ── 2) Sentetik örnek veri (gerçek kişi yok) ──
const simdi = Date.now();
const once = (dk) => new Date(simdi - dk * 60_000).toISOString();
const gunSonra = (n) => new Date(simdi + n * 86_400_000).toISOString();
const gun = (n = 0) => new Date(simdi - n * 86_400_000).toLocaleDateString('sv-SE');
const durum = {
  etkin: true, dinliyor: true,
  yazici: { motor: 'whisper', aciklama: 'Whisper large-v3-turbo-q5_0 (yerel, ücretsiz)' },
  whisper: { kurulu: false, calisiyor: false, indirme: { yuzde: 42, adim: 'Model indiriliyor · 241 / 574 MB' } },
  bugun: { satir: 186, madde: 8, onemli: 4, eslik: 2 },
  ajanlar: [
    { ad: 'kulak', etiket: 'Kulak', durum: 'calisiyor', son: once(0.3), sayac: 186, not: 'Vosk Türkçe · cihazda' },
    { ad: 'yazici', etiket: 'Yazıcı', durum: 'bekliyor', son: once(1), sayac: 186 },
    { ad: 'notTutucu', etiket: 'Not tutucu', durum: 'calisiyor', son: once(12), sayac: 9 },
    { ad: 'eslikci', etiket: 'Eşlikçi', durum: 'bekliyor', son: once(34), sayac: 2 },
    { ad: 'raporcu', etiket: 'Raporcu', durum: 'hata', son: once(300), sayac: 1, not: 'Model yanıt vermedi (429); 10 dk sonra yeniden denenecek.' },
    { ad: 'bekci', etiket: 'Bekçi', durum: 'kapali', sayac: 0 },
  ],
  sonEslik: { zaman: once(34), metin: 'Sunum dosyasını cuma Ece’ye gönderecektin; yarın son gün.' },
  acikMesele: 3,
};
const madde = (id, dk, metin, onem, ek = {}) => ({ id, gun: gun(), zaman: once(dk), metin, onem, kisiler: [], eglenceli: false, satirlar: '', silinme: gunSonra(onem === 'onemli' ? 7 : 3), ...ek });
const maddeler = [
  madde(1, 25, 'Ece ile sunumun son hâli cuma gönderilecek; grafikler yeniden çizilecek.', 'onemli', { konu: 'Sunum', kisiler: ['Ece'] }),
  madde(2, 70, 'Kira sözleşmesi için emlakçı salı 14:00’te arayacak.', 'onemli', { konu: 'Ev', silinme: gunSonra(6) }),
  madde(3, 130, 'Bütçe tablosunda pazarlama kalemi %15 aşıldı; Mert’le konuşulacak.', 'onemli', { konu: 'Bütçe', kisiler: ['Mert'] }),
  madde(4, 190, 'Yeni ürün adı için üç aday: Pusula, Lena, Kıyı.', 'onemli', { konu: 'Ürün' }),
  madde(5, 40, 'Öğle yemeğinde mercimek çorbası bitmişti, yerine ezogelin.', 'onemsiz', { eglenceli: true }),
  madde(6, 95, 'Kahve makinesi yine kireç uyarısı veriyor.', 'onemsiz', { silinme: gunSonra(1) }),
  madde(7, 150, 'Toplantı odasının kliması çok soğuk.', 'onemsiz'),
  madde(8, 210, 'Kedi klavyenin üstünden geçti, mesaj yarım gitti.', 'onemsiz', { eglenceli: true, silinme: gunSonra(0) }),
];
const dokum = Array.from({ length: 14 }, (_, i) => ({ id: i + 1, zaman: once(60 - i * 4), motor: 'vosk', metin: ['sunumu cuma göndereyim o zaman', 'grafikler biraz kalabalık oldu bence', 'tamam ben yarın sabah bakarım', 'emlakçı salı arayacakmış', 'bütçede pazarlama yine fazla', 'Mert’e yazayım mı şimdi', 'yok toplantıda konuşalım', 'kahve alacak mısın', 'ürün adı için Pusula güzel', 'Lena da fena değil', 'kıyı biraz yumuşak kaldı', 'neyse akşam düşünürüm', 'klima çok soğuk ya', 'birisi kapatsın şunu'][i] }));
const rapor = (id, tur, donem, baslik, ozet, ek = {}) => ({ id, tur, donem, baslik, ozet, onemli: [], onemsiz: [], kararlar: [], acikMeseleler: [], ileriye: [], maddeSayisi: 12, model: 'claude-haiku-5-5', olusturma: once(600), guncelleme: once(45), ...ek });
const raporlar = [
  rapor(1, 'gunluk', gun(1), 'Sunum haftası başladı', 'Gün sunum hazırlığı ve bütçe konuşmalarıyla geçti. Ece ile teslim tarihi netleşti; pazarlama bütçesindeki aşım ertesi güne kaldı.', {
    onemli: [{ metin: 'Sunum cuma Ece’ye gidecek; grafikler yeniden çizilecek.' }, { metin: 'Pazarlama kalemi %15 aşıldı.' }, { metin: 'Ürün adı için üç aday çıktı.' }],
    onemsiz: [{ metin: 'Ezogelin, mercimeğin yerini tuttu.', silinme: gunSonra(2) }, { metin: 'Klima tartışması sürdü.', silinme: gunSonra(2) }],
    kararlar: ['Grafikler sadeleşecek', 'Bütçe Mert’le toplantıda konuşulacak'], acikMeseleler: ['Sunum teslimi (cuma)', 'Kira sözleşmesi'], ileriye: ['Salı 14:00 emlakçı araması', 'Ürün adı kısa listesi'],
    espri: 'Klima bugün de toplantının en soğukkanlı katılımcısıydı.',
  }),
  rapor(2, 'haftalik', '2026-W42', '42. hafta: teslimler ve bütçe', 'Hafta iki teslime ve bir bütçe düzeltmesine odaklandı.', { onemli: [{ metin: 'İki müşteri teslimi zamanında yapıldı.' }], onemsiz: [{ metin: 'Ofis kahvesi değişti.', silinme: gunSonra(5) }], kararlar: ['Cuma günleri toplantı yok'], maddeSayisi: 54 }),
  rapor(3, 'aylik', '2026-09', 'Eylül: yeni ürünün ilk adımları', 'Ay, yeni ürün fikrinin şekillenmesi ve ekibin büyümesiyle geçti.', { onemli: [{ metin: 'Ürün fikri netleşti.' }, { metin: 'Ekibe iki kişi katıldı.' }], ileriye: ['Ekim’de ilk prototip'], maddeSayisi: 212 }),
];
const mesele = (id, baslik, ek = {}) => ({ id, baslik, ilkGun: gun(2), durum: 'acik', guncelleme: once(30), ...ek });
const meseleler = [
  mesele(1, 'Sunumu Ece’ye gönder', { kisi: 'Ece', hedef: gun(-1), ayrinti: 'Grafikler sadeleştirilecek, son hâli PDF olarak.', kaynak: 'gün kaydı' }),
  mesele(2, 'Pazarlama bütçesini konuş', { kisi: 'Mert', hedef: gun(1), ayrinti: 'Kalem %15 aşıldı.' }),
  mesele(3, 'Ürün adı kısa listesi', { hedef: gun(-6), ilkGun: gun(4) }),
  mesele(4, 'Emlakçıya belgeleri ilet', { durum: 'kapandi', kapanis: once(300) }),
  mesele(5, 'Klima servisini ara', { durum: 'iptal', kapanis: once(900) }),
];
const kartlar = [
  { id: 'dusunme', tip: 'dusunme', kolon: 1, genislik: 7, yukseklik: 'b' },
  { id: 'meseleler', tip: 'meseleler', kolon: 8, genislik: 5, yukseklik: 'b', vurgu: true },
];

await u.evaluate(({ ipcMain }, o) => {
  const orijinal = (k) => ipcMain._invokeHandlers?.get?.(k);
  const h = (k, f) => { ipcMain.removeHandler(k); ipcMain.handle(k, (_e, ...a) => f(...a)); };
  h('gunkaydi:durum', () => o.durum);
  h('gunkaydi:maddeler', (x) => o.maddeler.filter((m) => !x?.gun || m.gun === x.gun));
  h('gunkaydi:dokum', () => o.dokum);
  h('gunkaydi:raporlar', (x) => o.raporlar.filter((r) => !x?.tur || r.tur === x.tur));
  h('gunkaydi:meseleler', (d) => o.meseleler.filter((m) => (d ?? 'acik') === 'hepsi' || m.durum === (d ?? 'acik') || (d === 'kapandi' && m.durum === 'iptal')));
  const ayar = orijinal('ayarlar:al');
  if (ayar) h('ayarlar:al', async () => { const a = structuredClone(await ayar({})); a.gunKaydi = { ...a.gunKaydi, etkin: true, rizaTarihi: new Date().toISOString(), eslikci: 'hatirlatma_espri' }; return a; });
  const kokpit = orijinal('kokpit:al');
  if (kokpit) h('kokpit:al', async () => {
    const k = structuredClone(await kokpit({}));
    k.veri.dusunme = { durum: o.durum, bugunOnemli: o.maddeler.filter((m) => m.onem === 'onemli'), sonRapor: o.raporlar[0], meseleler: o.meseleler.filter((m) => m.durum === 'acik') };
    k.kartlar = [...k.kartlar.filter((x) => x.tip === 'zihin'), ...o.kartlar, ...k.kartlar.filter((x) => x.tip !== 'zihin' && x.tip !== 'dusunme' && x.tip !== 'meseleler')];
    return k;
  });
}, { durum, maddeler, dokum, raporlar, meseleler, kartlar });

await sayfa(1); await sayfa(0); await bekle(800); await foto('2-kokpit');
await dusunmeAyarlari();
await ayarKartlari('2-ayarlar');
await sayfa(2); await hafizaSekmeleri('2-hafiza');
await w.locator('.ust-sekmeler button', { hasText: 'Notlar' }).click(); await bekle(500);
await w.getByRole('button', { name: 'Konuşmayı göster' }).click(); await bekle(600); await foto('2-hafiza-notlar-dokum');
await w.locator('.ust-sekmeler button', { hasText: 'Takip edilecekler' }).click(); await bekle(500);
await w.getByRole('tab', { name: 'Kapanan' }).click(); await bekle(500); await foto('2-hafiza-meseleler-kapanan');
// Kokpit "Raporlar" düğmesi → Hafıza/Raporlar sekmesi
await sayfa(0); await bekle(500);
await w.locator('.kk').getByRole('button', { name: 'Raporlar' }).click(); await bekle(900);
const secili = await w.locator('.ust-sekmeler button[aria-selected="true"]').textContent().catch(() => null);
console.log('Kokpit → Raporlar sonrası seçili sekme:', secili);

await u.close();
console.log(hatalar.length ? `Konsol hataları:\n${hatalar.join('\n')}` : 'Konsol hatası yok.');
console.log('Çıktı:', cikti, '· veri:', veri);
