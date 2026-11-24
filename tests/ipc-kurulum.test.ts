// G23 incelemesi küçüğü (c) — Görev 29: GERÇEK ipc.ts işleyicileri (ipcKur) sınanır; bunlar silinirse ya da `ayarlar:kaydet`teki
// `ayarKaydiniSuz` çağrısı çıkarılırsa bu dosya düşer:
//   · ayarlar:kaydet arayüzden gelen kurulumSurumu'nu YOK SAYAR (bayat kopya yükseltme sihirbazını yeniden açtırmasın),
//   · kurulum:yukseltme-bitti YALNIZ kurulum sürümünü yazar (KURULUM_SURUMU; hafıza ve sohbet değişmez),
//   · kurulum:tamamla kurulumu bitirir ve kurulum sürümünü yazar.
// Electron sahtelenir (node:module registerHooks; ipcMain.handle işleyicileri bir haritaya yazar), veri klasörü geçici (FUBER_VERI); ağ,
// anahtar (FUBER_SIR_* silinir), pencere ve gerçek ~/.claude YOK (ev geçici).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const klasor = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-ipc-kurulum-'));
const ev = path.join(klasor, 'ev');
fs.mkdirSync(path.join(ev, '.claude'), { recursive: true });
for (const k of Object.keys(process.env)) if (/^FUBER_SIR_/.test(k)) delete process.env[k];
Object.assign(process.env, { FUBER_VERI: klasor, FUBER_BELGELER: path.join(klasor, 'belgeler'), USERPROFILE: ev, HOME: ev, FUBER_CLAUDE_DIZIN: path.join(ev, '.claude') });
fs.writeFileSync(path.join(klasor, 'ayarlar.json'), JSON.stringify({ kurulumTamam: true, kurulumSurumu: 2, kullaniciAdi: 'Deniz', mod: 'is', tanitimSurumu: '0.9.0', ses: { surum: 2, uyandirma: false }, proaktif: { etkin: false }, baslangictaAc: false }));

// Ağ bekçisi: hiçbir işleyici gerçek ağa çıkamaz (kayıt; sonda boş olmalı).
const agIstekleri: string[] = [];
globalThis.fetch = (async (u: unknown) => { agIstekleri.push(String((u as { url?: string })?.url ?? u)); throw new Error('test: ağ yok'); }) as typeof fetch;
after(() => assert.deepEqual(agIstekleri, [], 'ağ isteği yapıldı'));
const isleyiciler = new Map<string, (...a: unknown[]) => unknown>();
(globalThis as Record<string, unknown>).__ipcIsleyiciler = isleyiciler;
(globalThis as Record<string, unknown>).__ipcKlasor = klasor;
const ELECTRON = `
const h = globalThis.__ipcIsleyiciler;
const bos = () => undefined;
export const ipcMain = { handle: (k, f) => h.set(k, f), on: bos, removeHandler: (k) => h.delete(k), once: bos };
const appOlay = (o, f) => { (globalThis.__appOlaylari ??= []).push([o, f]); };
export const app = { getVersion: () => '0.0.0-test', getPath: () => globalThis.__ipcKlasor, isPackaged: false, getAppPath: () => process.cwd(), on: appOlay, once: appOlay, whenReady: () => Promise.resolve(), setLoginItemSettings: (o) => (globalThis.__girisKayitlari ??= []).push(o), quit: bos, getLocale: () => 'tr', requestSingleInstanceLock: () => true };
export class BrowserWindow { static getAllWindows() { return []; } static getFocusedWindow() { return null; } static fromWebContents() { return null; } }
export const shell = { openPath: async () => '', openExternal: async () => undefined, showItemInFolder: bos, trashItem: async () => undefined };
export const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showMessageBox: async () => ({ response: 0 }) };
export const safeStorage = { isEncryptionAvailable: () => false, encryptString: (s) => Buffer.from(s), decryptString: (b) => Buffer.from(b).toString() };
export const nativeTheme = { shouldUseDarkColors: true, on: bos, themeSource: 'system' };
const ekran = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1 };
export const screen = { getPrimaryDisplay: () => ekran, getAllDisplays: () => [ekran], on: bos, getCursorScreenPoint: () => ({ x: 0, y: 0 }), getDisplayNearestPoint: () => ekran, getDisplayMatching: () => ekran };
export class Notification { static isSupported() { return false; } show() {} on() {} }
export class Tray { setToolTip() {} setContextMenu() {} on() {} }
export const Menu = { buildFromTemplate: () => ({}), setApplicationMenu: bos };
const resim = { isEmpty: () => true, resize() { return resim; }, toPNG: () => Buffer.alloc(0), setTemplateImage: bos };
export const nativeImage = { createFromPath: () => resim, createEmpty: () => resim, createFromBuffer: () => resim, createFromDataURL: () => resim };
export const clipboard = { readText: () => '', writeText: bos };
export const globalShortcut = { register: () => true, unregister: bos, isRegistered: () => false, unregisterAll: bos };
export const net = { fetch: () => Promise.reject(new Error('test: ağ yok')) };
export const powerMonitor = { on: bos, getSystemIdleTime: () => 0, isOnBatteryPower: () => false, getSystemIdleState: () => 'active' };
export const protocol = { handle: bos, registerSchemesAsPrivileged: bos };
export const session = { defaultSession: { setPermissionRequestHandler: bos, setPermissionCheckHandler: bos, webRequest: { onBeforeRequest: bos } }, fromPartition: () => session.defaultSession };
export class WebContentsView {}
export const Display = undefined, NativeImage = undefined, WebContents = undefined;
export default { ipcMain, app, BrowserWindow, shell, dialog, safeStorage, nativeTheme, screen, Notification, Tray, Menu, nativeImage, clipboard, globalShortcut, net, powerMonitor, protocol, session, WebContentsView };
`;
const veri = (kod: string) => `data:text/javascript,${encodeURIComponent(kod)}`;
// ipc.ts'in bağımlılık ağacında tür ayıklamanın (strip-only) desteklemediği TypeScript var (parametre özellikleri): kaynak dosyalar
// esbuild'le (paketlemenin kendi derleyicisi) bellekte JS'e çevrilir.
const { transformSync } = await import('esbuild');
const kaynakKoku = path.resolve(import.meta.dirname, '..', 'src') + path.sep;
const kanca = registerHooks({
  load(url, baglam, sonraki) {
    if (url.startsWith('file:') && url.endsWith('.ts')) {
      const dosya = fileURLToPath(url);
      if (dosya.startsWith(kaynakKoku)) {
        const { code } = transformSync(fs.readFileSync(dosya, 'utf8'), { loader: 'ts', format: 'esm', target: 'es2023', sourcefile: dosya });
        return { format: 'module', source: code, shortCircuit: true };
      }
    }
    return sonraki(url, baglam);
  },
  resolve(belirtec, baglam, sonraki) {
    if (belirtec === 'electron') return { url: veri(ELECTRON), shortCircuit: true };
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
  try { fs.rmSync(klasor, { recursive: true, force: true }); } catch { /* veritabanı açık kalabilir */ }
});

const { ipcKur } = await import('../src/main/ipc.ts');
const { KURULUM_SURUMU } = await import('../src/shared/kurulum-adimlari.ts');
const ayarDosyasi = () => JSON.parse(fs.readFileSync(path.join(klasor, 'ayarlar.json'), 'utf8'));
const bos = () => undefined;
const adaFareCagrilari: [boolean, boolean | undefined][] = [];
ipcKur({
  asistanGoster: bos, asistanGizle: bos, anaGoster: bos, kulakYenile: bos, kisayollariKaydet: () => true,
  kisayolDurumu: () => ({ asistan: { alindi: true, tus: '' }, acil: { alindi: true, tus: '' } }) as never,
  kulakOlay: bos, kulakKomut: () => false, adaFare: (u: boolean, d?: boolean) => { adaFareCagrilari.push([u, d]); }, asistanKisayolu: bos, acilDurdur: bos,
});
const cagir = (k: string, ...a: unknown[]) => { const f = isleyiciler.get(k); assert.ok(f, `${k} işleyicisi ipc.ts'te yok`); return f(undefined, ...a); };

// G10 düzeltme turu 1: ada:fare (gerçek işleyici) imleç bilgisini ve "Durdur düğmesinin üstünde" bayrağını ana sürece boolean olarak iletir
// (src/main/ada.ts adaFare → shared/ada.ts adaYasamAdimi); bayrak yoksa false.
test('ada:fare (gerçek işleyici) uzerinde ve durdur bayraklarını boolean olarak iletir', async () => {
  adaFareCagrilari.length = 0;
  await cagir('ada:fare', true, true);
  await cagir('ada:fare', true);
  await cagir('ada:fare', 1, 'x');
  await cagir('ada:fare', false, undefined);
  assert.deepEqual(adaFareCagrilari, [[true, true], [true, false], [true, true], [false, false]]);
});

test('ipc.ts: üç kurulum işleyicisi kayıtlı (ayarlar:kaydet, kurulum:yukseltme-bitti, kurulum:tamamla)', () => {
  for (const k of ['ayarlar:kaydet', 'kurulum:yukseltme-bitti', 'kurulum:tamamla']) assert.ok(isleyiciler.has(k), `${k} kayıtlı değil`);
  assert.ok(isleyiciler.size > 100, `yalnız ${isleyiciler.size} işleyici`);
});

test('ayarlar:kaydet (gerçek işleyici) arayüzden gelen kurulumSurumu\'nu yok sayar — ayarKaydiniSuz çağrısı yerinde', async () => {
  const a = await cagir('ayarlar:kaydet', { kurulumSurumu: 0, kullaniciAdi: 'Deniz', gorunum: { tema: 'acik' } }) as { kurulumSurumu: number; gorunum: { tema: string } };
  assert.equal(a.kurulumSurumu, 2, 'bellekte sürüm geri alındı');
  assert.equal(a.gorunum.tema, 'acik', 'öteki alanlar kaydedilir');
  assert.equal(ayarDosyasi().kurulumSurumu, 2, 'diskte sürüm geri alındı');
  await cagir('ayarlar:kaydet', { kurulumSurumu: 99 });
  assert.equal(ayarDosyasi().kurulumSurumu, 2, 'arayüz sürümü ileri de alamaz');
});

test('kurulum:yukseltme-bitti (gerçek işleyici) YALNIZ kurulum sürümünü yazar; kurulumTamam ve ad değişmez', async () => {
  const once = ayarDosyasi();
  const a = await cagir('kurulum:yukseltme-bitti') as { kurulumSurumu: number; kurulumTamam: boolean; kullaniciAdi: string };
  assert.equal(a.kurulumSurumu, KURULUM_SURUMU);
  assert.equal(KURULUM_SURUMU, 5); // 0.11 G2 düzeltme turu 1 (Ö2)
  const sonra = ayarDosyasi();
  assert.equal(sonra.kurulumSurumu, KURULUM_SURUMU);
  assert.equal(sonra.kurulumTamam, once.kurulumTamam);
  assert.equal(sonra.kullaniciAdi, once.kullaniciAdi);
  // Sürüm geri gitmez (ikinci çağrı da aynı).
  await cagir('kurulum:yukseltme-bitti');
  assert.equal(ayarDosyasi().kurulumSurumu, KURULUM_SURUMU);
});

test('kurulum:tamamla (gerçek işleyici) kurulumu bitirir ve kurulum sürümünü yazar', async () => {
  // Taze profil gibi: kurulum bitmemiş.
  const a0 = ayarDosyasi();
  fs.writeFileSync(path.join(klasor, 'ayarlar.json'), JSON.stringify({ ...a0, kurulumTamam: false, kurulumSurumu: 0 }));
  const { ayarlariKaydet } = await import('../src/main/ayarlar.ts');
  ayarlariKaydet((a) => { a.kurulumTamam = false; a.kurulumSurumu = 0; });
  const a = await cagir('kurulum:tamamla', { kullaniciAdi: ' Deniz ', hitap: 'Bey', hakkinda: '', projeler: '', claudeHafiza: false, sabahOzeti: '' }) as { kurulumTamam: boolean; kurulumSurumu: number; kullaniciAdi: string; hitap: string };
  assert.equal(a.kurulumTamam, true);
  assert.equal(a.kurulumSurumu, KURULUM_SURUMU);
  assert.equal(a.kullaniciAdi, 'Deniz');
  assert.equal(a.hitap, 'Bey');
  assert.equal(ayarDosyasi().kurulumSurumu, KURULUM_SURUMU);
});

// 0.11 G12b: sürüm yenilik kartının (0.12 H6: "0.12’de yeni") işareti (shared/yenilik.ts). Yeni kurulum kartı hiç görmez (kurulum:tamamla işareti yazar);
// yükselen profilde (kurulumu tamam, alan hiç yok) kart bir kez açılır; yenilik:kapat işareti yazar; ayarlar:kaydet işareti yazamaz/silemez.
test('G12b: kurulum:tamamla yenilik işaretini yazar; yükselen profil kartı görür; yenilik:kapat kapatır; ayarlar:kaydet dokunamaz', async () => {
  const { YENILIK_SURUMU, yeniKartAcilsinMi } = await import('../src/shared/yenilik.ts');
  const { ayarlariKaydet, ayarlar } = await import('../src/main/ayarlar.ts');
  // Yeni kurulum: işaret yok, kurulum bitmemiş → kurulum:tamamla işareti yazar → kart hiç açılmaz.
  ayarlariKaydet((a) => { a.kurulumTamam = false; a.kurulumSurumu = 0; delete a.yenilikSurumu; });
  assert.equal(yeniKartAcilsinMi(ayarlar()), false, 'kurulum bitmeden kart yok');
  await cagir('kurulum:tamamla', { kullaniciAdi: 'Deniz', hitap: '', hakkinda: '', projeler: '', claudeHafiza: false, sabahOzeti: '' });
  assert.equal(ayarDosyasi().yenilikSurumu, YENILIK_SURUMU, 'diskte işaret');
  assert.equal(yeniKartAcilsinMi(ayarlar()), false, 'yeni kurulum kartı görmez');
  // Yükselen profil: kurulumu tamam, alan hiç yok (0.10 profili) → kart bir kez; yenilik:kapat işareti yazar.
  ayarlariKaydet((a) => { delete a.yenilikSurumu; });
  assert.equal(ayarDosyasi().yenilikSurumu, undefined, '0.10 profilinde alan yok');
  assert.equal(yeniKartAcilsinMi(ayarlar()), true, 'yükselen profil kartı görür');
  await cagir('yenilik:kapat');
  assert.equal(ayarDosyasi().yenilikSurumu, YENILIK_SURUMU);
  assert.equal(yeniKartAcilsinMi(ayarlar()), false, 'kapatılınca bir daha yok');
  // Bayat arayüz kopyası işareti geri alıp kartı diriltemez; boş işaret de yazamaz.
  await cagir('ayarlar:kaydet', { yenilikSurumu: '', kullaniciAdi: 'Deniz' });
  assert.equal(ayarDosyasi().yenilikSurumu, YENILIK_SURUMU, 'ayarlar:kaydet işareti silemez');
  await cagir('yenilik:kapat'); // ikinci çağrı zararsız
  assert.equal(ayarDosyasi().yenilikSurumu, YENILIK_SURUMU);
});

// 0.10 E4 (K6): "İşin" ve "Günün" sayfalarının seçimleri ayara (isProfili) ve TEK sabit hafıza kaydına yazılır — Fuber kişiyi tanır.
// Yeniden açılan sihirbaz ayarlar:kaydet ile değiştirir: aynı kayıt güncellenir (ikinci kayıt açılmaz).
test('kurulum:tamamla iş profilini (rol, şirket, çalışma saatleri) ayara ve tek sabit hafıza kaydına yazar; ayarlar:kaydet aynı kaydı günceller', async () => {
  const { ayarlariKaydet } = await import('../src/main/ayarlar.ts');
  ayarlariKaydet((a) => { a.kurulumTamam = false; a.kurulumSurumu = 0; });
  const a = await cagir('kurulum:tamamla', {
    kullaniciAdi: 'Deniz', hitap: 'Bey', hakkinda: '', projeler: '', claudeHafiza: false, sabahOzeti: '08:30',
    isProfili: { rol: 'kurucu', sirket: ' Mavi Kuş ', gunBas: '09:00', gunBit: '19:00' },
  }) as { isProfili?: Record<string, string>; proaktif: { sabahOzeti: string } };
  assert.deepEqual(a.isProfili, { rol: 'kurucu', sirket: 'Mavi Kuş', gunBas: '09:00', gunBit: '19:00' });
  assert.equal(a.proaktif.sabahOzeti, '08:30');
  // Çalışma saatleri sessiz saate eşlenir (zamanlayıcı bunu okur): mesai bitişi → sabah özeti (mesai başlangıcından erken).
  assert.equal((a.proaktif as Record<string, string>).sessizBaslangic, '19:00');
  assert.equal((a.proaktif as Record<string, string>).sessizBitis, '08:30');
  assert.deepEqual(ayarDosyasi().isProfili, { rol: 'kurucu', sirket: 'Mavi Kuş', gunBas: '09:00', gunBit: '19:00' });
  const kayitlar = () => (cagir('hafiza:liste', { tur: 'kullanici', limit: 200 }) as { baslik: string; icerik: string; sabit?: boolean | number }[]).filter((h) => h.baslik === 'İşi ve günü');
  const bir = kayitlar();
  assert.equal(bir.length, 1, 'tek kayıt');
  assert.match(bir[0].icerik, /Kurucu/);
  assert.match(bir[0].icerik, /Mavi Kuş/);
  assert.match(bir[0].icerik, /09:00–19:00/);
  assert.ok(bir[0].sabit, 'sabit kayıt');
  // Bozuk girdi süzülür: bilinmeyen rol yok sayılır, saat biçimi denetlenir, şirket 80 karakterle sınırlı.
  await cagir('ayarlar:kaydet', { isProfili: { rol: 'yonetici', sirket: 'x'.repeat(200), gunBas: '25:99', gunBit: '18:00' } });
  const iki = kayitlar();
  assert.equal(iki.length, 1, 'ikinci kayıt açılmadı');
  assert.match(iki[0].icerik, /Yönetici/);
  assert.doesNotMatch(iki[0].icerik, /Kurucu/);
  const p = ayarDosyasi().isProfili;
  assert.equal(p.rol, 'yonetici');
  assert.equal(p.sirket.length, 80);
  assert.equal(p.gunBas, '09:00', 'geçersiz saat yazılmaz');
  assert.equal(p.gunBit, '18:00');
  assert.equal(ayarDosyasi().proaktif.sessizBaslangic, '18:00', 'yeniden açılan sihirbazda değişen mesai sessiz saati de günceller');
  await cagir('ayarlar:kaydet', { isProfili: { rol: 'patron' } });
  assert.equal(ayarDosyasi().isProfili.rol, 'yonetici', 'bilinmeyen rol yok sayılır');
});

// 0.13 T5 (spec B): Görünüm seçimi kurulumu bitiren TEK yazımda uygulanır (kurulum penceresi o ana dek opak); kurulum artık rol sormaz, kayıtlı rol silinmez.
test('kurulum:tamamla (gerçek işleyici) seçilen temayı yazar; gönderilmezse ya da bilinmiyorsa dokunmaz; kayıtlı rol kalır, şirket eklenir', async () => {
  const { ayarlariKaydet } = await import('../src/main/ayarlar.ts');
  ayarlariKaydet((a) => { a.kurulumTamam = false; a.kurulumSurumu = 0; a.gorunum.tema = 'koyu'; a.isProfili = { rol: 'satis' }; });
  const govde = { kullaniciAdi: 'Deniz', hitap: '', claudeHafiza: false, sabahOzeti: '' };
  const a = await cagir('kurulum:tamamla', { ...govde, tema: 'acik', isProfili: { sirket: ' Mavi Kuş ', gunBas: '09:00', gunBit: '19:00' } }) as { gorunum: { tema: string }; kurulumTamam: boolean };
  assert.equal(a.kurulumTamam, true);
  assert.equal(a.gorunum.tema, 'acik');
  assert.equal(ayarDosyasi().gorunum.tema, 'acik', 'diskte');
  assert.deepEqual(ayarDosyasi().isProfili, { rol: 'satis', sirket: 'Mavi Kuş', gunBas: '09:00', gunBit: '19:00' }, 'rol silinmez');
  await cagir('kurulum:tamamla', govde);
  assert.equal(ayarDosyasi().gorunum.tema, 'acik', 'tema gönderilmedi: değişmez');
  await cagir('kurulum:tamamla', { ...govde, tema: 'mor' });
  assert.equal(ayarDosyasi().gorunum.tema, 'acik', 'bilinmeyen tema yok sayılır');
  await cagir('kurulum:tamamla', { ...govde, tema: 'sistem' });
  assert.equal(ayarDosyasi().gorunum.tema, 'sistem');
});

// 0.13.1 düzeltme turu 1: "Windows açılınca başlat" kurulum bitince uygulanır — YALNIZ paketli uygulamada ve değiştiyse; paketsiz (test, önizleme, geliştirme)
// hiçbir başlangıç kaydı yazılmaz. (Paketli test kopyasında ayrıca arka-plan-test.ts setLoginItemSettings'i etkisizleştirir: tests/arka-plan.test.ts.)
test('kurulum:tamamla baslangictaAc: paketsizde başlangıç kaydı YAZILMAZ; paketlide yalnız değişince yazılır', async () => {
  const { ayarlariKaydet } = await import('../src/main/ayarlar.ts');
  const { app } = await import('electron') as unknown as { app: { isPackaged: boolean } };
  const kayit = (globalThis as unknown as { __girisKayitlari?: unknown[] });
  const govde = { kullaniciAdi: 'Deniz', hitap: '', claudeHafiza: false, sabahOzeti: '' };
  kayit.__girisKayitlari = [];
  ayarlariKaydet((a) => { a.kurulumTamam = false; a.baslangictaAc = true; });
  await cagir('kurulum:tamamla', { ...govde, baslangictaAc: false });
  assert.equal(ayarDosyasi().baslangictaAc, false, 'ayar yazılır');
  assert.deepEqual(kayit.__girisKayitlari, [], 'paketsiz: işletim sistemi başlangıç kaydına dokunulmaz');
  app.isPackaged = true;
  try {
    await cagir('kurulum:tamamla', { ...govde, baslangictaAc: false });
    assert.deepEqual(kayit.__girisKayitlari, [], 'değişmedi: yazılmaz');
    await cagir('kurulum:tamamla', { ...govde, baslangictaAc: true });
    assert.deepEqual(kayit.__girisKayitlari, [{ openAtLogin: true, args: ['--gizli'] }], 'paketli ve değişti: yazılır');
    await cagir('kurulum:tamamla', govde);
    assert.equal(ayarDosyasi().baslangictaAc, true, 'gönderilmediyse değişmez');
    await cagir('kurulum:tamamla', { ...govde, baslangictaAc: 'evet' });
    assert.equal(ayarDosyasi().baslangictaAc, true, 'boolean olmayan yok sayılır');
  } finally { app.isPackaged = false; }
});

// Düzeltme turu 1 (madde 9): uygulama kapanırken süren eklenti kurulumu durdurulur — ipcKur'un başlattığı eklenti bağlantısı
// app 'will-quit'e eklenti kurucusunun kapat()ını bağlar (bağ silinirse bu test düşer). EN SONDA: öteki kapanış işleyicileri de çağrılır.
test('will-quit: eklenti kurucusunun kapat()ı (süren kurulum komutlarını süreç ağaçlarıyla durdurur) uygulama kapanışına bağlı', async () => {
  const { eklentiKurucu } = await import('../src/main/claudecode/eklenti-yonetim.ts');
  const k = eklentiKurucu();
  let kapatildi = 0;
  const asil = k.kapat.bind(k);
  k.kapat = () => { kapatildi++; asil(); };
  const olaylar = ((globalThis as Record<string, unknown>).__appOlaylari ?? []) as [string, () => void][];
  const kapanis = olaylar.filter(([o]) => o === 'will-quit');
  assert.ok(kapanis.length >= 1, `will-quit işleyicisi yok (${olaylar.map(([o]) => o).join(', ')})`);
  for (const [, f] of kapanis) { try { f(); } catch { /* öteki kapanış işleyicileri bu testin konusu değil */ } }
  assert.equal(kapatildi, 1, 'will-quit eklenti kurucusunu kapatmadı');
});
