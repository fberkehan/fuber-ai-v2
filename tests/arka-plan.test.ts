// Arka plan test kipi (28 Eki: testler koşarken arayüz öne gelmemeli, testler arka planda koşar): yalnız FUBER_DEMO'da ve FUBER_GORUNUR
// '1' değilken; üretimde asla (src/shared/arka-plan.ts; uygulaması src/main/arka-plan-test.ts).
// 0.11 G12a: arka plan kipinde işletim sistemi GENELİ kısayol kaydı da yok — `globalShortcut` mantıksal defterle değişir (aşağıdaki testler):
// kullanıcı bilgisayar başında çalışırken Alt+Shift+Q (acil durdurma) ve asistan kısayolu görünmez önizleme örneğine gitmesin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';
import { arkaPlanKipi, kisayolBaskaListesi, kisayolDefteri, kisayolKanonik } from '../src/shared/arka-plan.ts';

test('arka plan kipi: yalnız FUBER_DEMO ile, FUBER_GORUNUR=1 kapatır, üretimde hiç', () => {
  assert.equal(arkaPlanKipi({}), false);
  assert.equal(arkaPlanKipi({ FUBER_DEMO: '' }), false);
  assert.equal(arkaPlanKipi({ FUBER_DEMO: '1' }), true);
  assert.equal(arkaPlanKipi({ FUBER_DEMO: '1', FUBER_GORUNUR: '0' }), true);
  assert.equal(arkaPlanKipi({ FUBER_DEMO: '1', FUBER_GORUNUR: '1' }), false);
  assert.equal(arkaPlanKipi({ FUBER_GORUNUR: '1' }), false);
});

test('arka plan kipi ilk pencereden önce kurulur ve işletim sistemi odağını hiç vermez', () => {
  const ana = fs.readFileSync(new URL('../src/main/main.ts', import.meta.url), 'utf8');
  const kur = ana.indexOf('arkaPlanTestKipiniKur();');
  assert.ok(kur > 0, 'main.ts arkaPlanTestKipiniKur çağırmalı');
  assert.ok(kur < ana.indexOf('new BrowserWindow('), 'ilk pencereden önce');
  const kip = fs.readFileSync(new URL('../src/main/arka-plan-test.ts', import.meta.url), 'utf8');
  for (const s of ['setOpacity', 'setFocusable', 'setSkipTaskbar', 'setIgnoreMouseEvents', 'showInactive', "'browser-window-created'"]) {
    assert.ok(kip.includes(s), `arka plan kipi ${s} kullanmalı`);
  }
  assert.ok(!/\bw\.focus\(\)|\.moveTop\(\)/.test(kip.replace(/w\.focus = /g, '')), 'gerçek focus/moveTop çağrısı yok');
  // Windows başlangıç kaydı (HKCU Run) arka plan kipinde hiç yazılmaz: kurulum fonksiyonunun içinde, kip kapısından SONRA etkisizleşir.
  const kurulum = kip.slice(kip.indexOf('export function arkaPlanTestKipiniKur'));
  assert.ok(kurulum.indexOf('if (!arkaPlanKipi(process.env)) return;') < kurulum.indexOf('app.setLoginItemSettings = () => undefined;'), 'setLoginItemSettings arka plan kipinde etkisiz');
  // 0.12 H5 incelemesi: "Hey Fuber" varsayılan açık — arka plan kipinde kulak GERÇEK mikrofonu açmaz (bilgisayarda biri çalışıyor olabilir):
  // Chromium sahte ses aygıtı, kip kapısından SONRA, her koşuda.
  const kapi = kurulum.indexOf('if (!arkaPlanKipi(process.env)) return;');
  const sahte = kurulum.indexOf("app.commandLine.appendSwitch('use-fake-device-for-media-stream')");
  assert.ok(sahte > kapi && kapi >= 0, 'arka plan kipinde sahte ses aygıtı zorunlu');
});

// ── G12a: genel kısayollar ──────────────────────────────────────────────────────────────────────────────────────────────

test('kısayol kanonik biçimi: büyük/küçük harf, sıra ve takma adlar tek tuş; geçersiz hızlandırıcı TypeError', () => {
  assert.equal(kisayolKanonik('Alt+Shift+Q', 'win32'), kisayolKanonik('shift+ALT+q', 'win32'));
  assert.equal(kisayolKanonik('CommandOrControl+Shift+Space', 'win32'), kisayolKanonik('Ctrl+Shift+space', 'win32'));
  assert.equal(kisayolKanonik('CmdOrCtrl+Shift+Space', 'darwin'), kisayolKanonik('Command+Shift+Space', 'darwin'), 'macOS: CommandOrControl = Command');
  assert.notEqual(kisayolKanonik('CommandOrControl+Q', 'win32'), kisayolKanonik('CommandOrControl+Q', 'darwin'), 'platforma göre farklı fiziksel tuş');
  assert.equal(kisayolKanonik('Command+Shift+Escape', 'darwin'), kisayolKanonik('Cmd+Shift+Esc', 'darwin'));
  assert.equal(kisayolKanonik('Ctrl+Alt+F9', 'win32'), kisayolKanonik('Alt+Control+f9', 'win32'));
  for (const gecersiz of ['', '   ', 'Foo', 'Ctrl+', 'Ctrl+Alt', 'A+B', 'Ctrl++', 'Ctrl+Şş', 'F25', 'Ctrl+Alt+Boşluk']) {
    assert.throws(() => kisayolKanonik(gecersiz, 'win32'), TypeError, `«${gecersiz}» geçersiz sayılmalı`);
  }
  // Uygulamanın gerçekten kullandığı tuşlar geçerli: acil durdurma (Windows/Mac), varsayılan asistan, Ayarlar'ın üreteceği örnekler.
  for (const gecerli of ['Alt+Shift+Q', 'Command+Shift+Escape', 'CommandOrControl+Shift+Space', 'CommandOrControl+Shift+F9', 'Alt+Shift+F9', 'Control+Alt+F', 'Ctrl+Plus', 'Shift+F12']) {
    assert.doesNotThrow(() => kisayolKanonik(gecerli, 'win32'), gecerli);
  }
});

test('mantıksal defter: gerçek Electron gibi — alındı true, aynı tuş ikinci kez ve başka uygulamadaki tuş false, geçersiz TypeError', () => {
  const d = kisayolDefteri({ platform: 'win32' });
  let tetik = 0;
  assert.equal(d.register('Alt+Shift+Q', () => { tetik++; }), true, 'boşta tuş alınır');
  assert.equal(d.isRegistered('shift+alt+q'), true, 'takma ad/sıra farkı aynı tuş');
  assert.equal(d.register('Alt+Shift+Q', () => undefined), false, 'bu uygulamada zaten kayıtlı → false (gerçek Electron gibi)');
  assert.equal(d.register('CommandOrControl+Shift+Space', () => undefined), true);
  assert.deepEqual(d.kayitlilar().sort(), [kisayolKanonik('Alt+Shift+Q', 'win32'), kisayolKanonik('Ctrl+Shift+Space', 'win32')].sort());
  assert.equal(d.tetikle('Alt+Shift+Q'), true);
  assert.equal(tetik, 1, 'tetikle kayıtlı geri çağrıyı çalıştırır');
  assert.equal(d.tetikle('Alt+Shift+F1'), false, 'kayıtsız tuş tetiklenmez');
  d.unregister('Alt+Shift+Q');
  assert.equal(d.isRegistered('Alt+Shift+Q'), false);
  assert.doesNotThrow(() => d.unregister('Alt+Shift+Q'), 'kayıtsız tuşu bırakmak sessiz (main.ts "zaten yok")');
  assert.equal(d.register('Alt+Shift+Q', () => undefined), true, 'bırakılan tuş yeniden alınır');
  d.unregisterAll();
  assert.deepEqual(d.kayitlilar(), []);
  assert.throws(() => d.register('Foo', () => undefined), TypeError);
  assert.throws(() => d.register('Alt+Q', 'x' as never), TypeError, 'geri çağrı işlev olmalı');
  assert.throws(() => d.isRegistered(''), TypeError);
});

test('"başka uygulamada" test kancası: başlangıç listesi (FUBER_TEST_KISAYOL_BASKA) ve çalışırken baskaUygulamada; register false, bırakılınca true', () => {
  assert.deepEqual(kisayolBaskaListesi({ FUBER_TEST_KISAYOL_BASKA: ' Alt+Shift+Q ; ;Ctrl+Shift+F9' }), ['Alt+Shift+Q', 'Ctrl+Shift+F9']);
  assert.deepEqual(kisayolBaskaListesi({}), []);
  const d = kisayolDefteri({ platform: 'win32', baska: kisayolBaskaListesi({ FUBER_TEST_KISAYOL_BASKA: 'Alt+Shift+Q;Geçersiz!!' }) });
  assert.equal(d.register('Alt+Shift+Q', () => undefined), false, 'başka uygulamada → alınamadı (sessiz false)');
  assert.equal(d.isRegistered('Alt+Shift+Q'), false);
  assert.equal(d.register('CommandOrControl+Shift+Space', () => undefined), true, 'öteki tuş etkilenmez');
  d.baskaUygulamada('Alt+Shift+F9');
  assert.equal(d.register('shift+alt+f9', () => undefined), false, 'çalışırken de taklit edilir (takma ad/sıra fark etmez)');
  d.baskaUygulamada('Alt+Shift+F9', false);
  assert.equal(d.register('Alt+Shift+F9', () => undefined), true, 'tuş boşa çıkınca alınır');
});

test('main.ts kayıt akışı mantıksal defterde: acil durdurma "alındı → başka uygulamada alınamadı → yeniden alındı", asistan kısayolunu önce yenisini alıp eskisini bırakır', () => {
  const d = kisayolDefteri({ platform: 'win32' });
  // main.ts kisayollariKaydet'in acil durdurma kısmı (isRegistered değilse register; sonuç alındı bayrağı).
  const acil = 'Alt+Shift+Q';
  const acilKaydet = () => (d.isRegistered(acil) ? true : d.register(acil, () => undefined));
  assert.equal(acilKaydet(), true, 'açılışta alındı');
  assert.equal(acilKaydet(), true, 'tepsi/ayar tazelemesinde zaten kayıtlı → alındı kalır');
  d.unregister(acil);
  d.baskaUygulamada(acil); // başka bir uygulama tuşu aldı
  assert.equal(acilKaydet(), false, 'alınamadı → tepsi/Ayarlar tuş söz vermez');
  d.baskaUygulamada(acil, false);
  assert.equal(acilKaydet(), true, 'tuş boşalınca her çağrıda yeniden denenir ve alınır');
  // Asistan kısayolu değişimi: yenisi alınamazsa eskisi korunur.
  let kayitli = 'CommandOrControl+Shift+Space';
  assert.equal(d.register(kayitli, () => undefined), true);
  d.baskaUygulamada('CommandOrControl+Shift+F9');
  assert.equal(d.register('CommandOrControl+Shift+F9', () => undefined), false, 'yeni kısayol başka uygulamada');
  assert.equal(d.isRegistered(kayitli), true, 'eskisi çalışmaya devam eder');
  d.baskaUygulamada('CommandOrControl+Shift+F9', false);
  assert.equal(d.register('CommandOrControl+Shift+F9', () => undefined), true);
  d.unregister(kayitli); kayitli = 'CommandOrControl+Shift+F9';
  assert.equal(d.isRegistered('CommandOrControl+Shift+Space'), false);
  assert.equal(d.isRegistered(kayitli), true);
});

// ── arka plan kipi `globalShortcut`ı gerçekten değiştirir (sahte Electron'la; işletim sistemine hiçbir kayıt gitmez) ─────────────────

const g = globalThis as Record<string, unknown>;
const OS_CAGRILARI: string[] = []; // sahte "işletim sistemi" çağrıları: arka plan kipinde BOŞ kalmalı
const dogal = () => ({
  register: (h: string) => { OS_CAGRILARI.push(`register:${h}`); return true; },
  registerAll: (hs: string[]) => { OS_CAGRILARI.push(`registerAll:${hs.join(',')}`); },
  unregister: (h: string) => { OS_CAGRILARI.push(`unregister:${h}`); },
  isRegistered: (h: string) => { OS_CAGRILARI.push(`isRegistered:${h}`); return false; },
  unregisterAll: () => { OS_CAGRILARI.push('unregisterAll'); },
});
const sahteKisayol = dogal() as Record<string, unknown>;
g.__sahteGlobalShortcut = sahteKisayol;
const veri = (kod: string) => `data:text/javascript,${encodeURIComponent(kod)}`;
const kanca = registerHooks({
  resolve(belirtec, baglam, sonraki) {
    if (belirtec === 'electron') {
      return {
        url: veri(`export const app = { commandLine: { appendSwitch() {} }, on(o, f) { globalThis.__sahteAppOn?.(o, f); } };
          export class BrowserWindow { static getFocusedWindow() { return null; } static getAllWindows() { return globalThis.__sahtePencereler ?? []; } }
          export const globalShortcut = globalThis.__sahteGlobalShortcut;`),
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

/** Ortamı ayarlayıp sahte nesneyi sıfırlayarak `arkaPlanTestKipiniKur()` koşar; ortam sonunda geri verilir. */
async function kipKur(env: Record<string, string | undefined>): Promise<Record<string, (...a: unknown[]) => unknown> & { mantiksal?: ReturnType<typeof kisayolDefteri> }> {
  for (const k of Object.keys(sahteKisayol)) delete sahteKisayol[k];
  Object.assign(sahteKisayol, dogal());
  OS_CAGRILARI.length = 0;
  const onceki: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) { onceki[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try {
    const { arkaPlanTestKipiniKur } = await import('../src/main/arka-plan-test.ts');
    arkaPlanTestKipiniKur();
  } finally {
    for (const [k, v] of Object.entries(onceki)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  return sahteKisayol as never;
}
const TEMIZ = { FUBER_DEMO: undefined, FUBER_GORUNUR: undefined, FUBER_TEST_KISAYOL_BASKA: undefined };

test('arka plan kipi (FUBER_DEMO): globalShortcut mantıksal — işletim sistemine hiçbir kısayol kaydedilmez, kayıt sonuçları uygulamaya aynen döner', async () => {
  const gs = await kipKur({ ...TEMIZ, FUBER_DEMO: '1' });
  let acilTetik = 0;
  const acil = gs.register('Alt+Shift+Q', () => { acilTetik++; });
  const asistan = gs.register('CommandOrControl+Shift+Space', () => undefined);
  assert.deepEqual([acil, asistan], [true, true], 'alındı');
  assert.equal(gs.isRegistered('Alt+Shift+Q'), true);
  assert.equal(gs.isRegistered('CommandOrControl+Shift+Space'), true);
  assert.equal(gs.isRegistered('Control+Alt+Q'), false, 'eski acil durdurma tuşu alınmadı');
  assert.equal(gs.register('Alt+Shift+Q', () => undefined), false, 'aynı tuş ikinci kez → alınamadı');
  assert.throws(() => gs.register('Foo+Bar', () => undefined), TypeError, 'geçersiz hızlandırıcı: gerçek Electron gibi fırlatır (main.ts yakalar)');
  assert.equal(gs.mantiksal?.tetikle('Alt+Shift+Q'), true, 'test kancası tuş basışını taklit eder');
  assert.equal(acilTetik, 1);
  gs.registerAll(['Alt+Shift+F1', 'Alt+Shift+F2'], () => undefined);
  assert.equal(gs.isRegistered('Alt+Shift+F2'), true);
  gs.unregister('Alt+Shift+Q');
  assert.equal(gs.isRegistered('Alt+Shift+Q'), false);
  gs.unregisterAll();
  assert.equal(gs.isRegistered('CommandOrControl+Shift+Space'), false);
  assert.deepEqual(OS_CAGRILARI, [], 'işletim sistemi kısayol API\'sine HİÇ dokunulmadı');
});

test('arka plan kipi: "başka uygulamada" taklidi ortam değişkeniyle ve çalışırken — register false döner, kayıt işletim sistemine gitmez', async () => {
  const gs = await kipKur({ ...TEMIZ, FUBER_DEMO: '1', FUBER_TEST_KISAYOL_BASKA: 'Alt+Shift+Q' });
  assert.equal(gs.register('Alt+Shift+Q', () => undefined), false, 'FUBER_TEST_KISAYOL_BASKA: başka uygulamada');
  assert.equal(gs.isRegistered('Alt+Shift+Q'), false);
  gs.mantiksal?.baskaUygulamada('Alt+Shift+Q', false);
  assert.equal(gs.register('Alt+Shift+Q', () => undefined), true, 'tuş boşalınca alınır');
  gs.mantiksal?.baskaUygulamada('CommandOrControl+Shift+Space');
  assert.equal(gs.register('CommandOrControl+Shift+Space', () => undefined), false, 'çalışırken taklit');
  assert.deepEqual(OS_CAGRILARI, []);
});

test('FUBER_GORUNUR=1 ve üretim (FUBER_DEMO yok): globalShortcut DEĞİŞMEZ — gerçek (işletim sistemi) kayıt sürer', async () => {
  for (const [ad, env] of [['FUBER_GORUNUR=1', { ...TEMIZ, FUBER_DEMO: '1', FUBER_GORUNUR: '1' }], ['üretim', { ...TEMIZ }]] as const) {
    const gs = await kipKur({ ...env });
    assert.equal(gs.mantiksal, undefined, `${ad}: mantıksal defter kurulmaz`);
    assert.equal(gs.register('Alt+Shift+Q', () => undefined), true);
    gs.unregister('Alt+Shift+Q');
    assert.equal(gs.isRegistered('Alt+Shift+Q'), false);
    assert.deepEqual(OS_CAGRILARI, ['register:Alt+Shift+Q', 'unregister:Alt+Shift+Q', 'isRegistered:Alt+Shift+Q'], `${ad}: çağrılar gerçek işlevlere gider`);
  }
});

// ── Son inceleme (G12b artığı): pencereler MANTIKSAL odaklanabilirlik/opaklık, web içerikleri MANTIKSAL odak bildirir ─────────────────────
// pencere-onizle (Tarayıcı'da web sayfası odakta: sayfa görünümü odakta, araç çubuğu değil) ve tarayici-onizle (düşmanca window.open: "odaklanır,
// opak") arka planda da gerçek davranışı ölçsün diye. İşletim sistemi hâli değişmez: pencere odaklanamaz ve saydam kalır, odak hiç verilmez.

type SahteIcerik = { odak: number; destroyed: boolean; isDestroyed: () => boolean; focus: () => void; isFocused: () => boolean };
const sahteIcerik = (): SahteIcerik => { const wc: SahteIcerik = { odak: 0, destroyed: false, isDestroyed: () => wc.destroyed, focus() { wc.odak++; }, isFocused: () => false }; return wc; };
/** Gerçek Electron penceresinin arka plan kipinin dokunduğu yüzü; `os` işletim sistemine giden hâl ve çağrılar. */
class SahtePencere {
  os: { focusable: boolean; opacity: number; cagrilar: string[] };
  webContents = sahteIcerik();
  contentView = { children: [] as { webContents?: SahteIcerik; children: unknown[] }[] };
  olaylar: string[] = [];
  constructor(focusable = true) { this.os = { focusable, opacity: 1, cagrilar: [] }; }
  isDestroyed() { return false; }
  setOpacity(o: number) { this.os.opacity = o; this.os.cagrilar.push(`opacity:${o}`); }
  getOpacity() { return this.os.opacity; }
  setFocusable(f: boolean) { this.os.focusable = f; this.os.cagrilar.push(`focusable:${f}`); }
  isFocusable() { return this.os.focusable; }
  setSkipTaskbar() { /* işletim sistemi */ }
  setIgnoreMouseEvents() { /* işletim sistemi */ }
  showInactive() { this.os.cagrilar.push('showInactive'); }
  hide() { this.os.cagrilar.push('hide'); }
  moveTop() { this.os.cagrilar.push('moveTop'); }
  flashFrame() { this.os.cagrilar.push('flashFrame'); }
  show() { this.os.cagrilar.push('show'); }
  focus() { this.os.cagrilar.push('focus'); }
  blur() { this.os.cagrilar.push('blur'); }
  isFocused() { return false; }
  once() { /* closed */ }
  emit(o: string) { this.olaylar.push(o); }
}

/** Kipi kurar ve `app.on` ile kaydedilen işleyicileri döner (yoksa boş). */
async function kipIsleyicileri(env: Record<string, string | undefined>): Promise<Map<string, (...a: unknown[]) => void>> {
  const isleyiciler = new Map<string, (...a: unknown[]) => void>();
  g.__sahteAppOn = (o: string, f: (...a: unknown[]) => void) => { isleyiciler.set(o, f); };
  try { await kipKur(env); } finally { delete g.__sahteAppOn; }
  return isleyiciler;
}

test('arka plan kipi: isFocusable/getOpacity uygulamanın istediği MANTIKSAL değeri döner; işletim sistemi hâli odaklanamaz ve saydam kalır', async () => {
  const k = await kipIsleyicileri({ ...TEMIZ, FUBER_DEMO: '1' });
  const olustu = k.get('browser-window-created');
  assert.ok(olustu && k.get('web-contents-created'), 'pencere ve web içeriği işleyicileri kuruldu');
  const w = new SahtePencere(true);      // olağan pencere (Tarayıcı'nın düşmanca window.open açılır penceresi dahil)
  const ada = new SahtePencere(false);   // oluşturulurken odaklanamaz (ada gibi)
  g.__sahtePencereler = [w, ada];
  try {
    olustu!({}, w); olustu!({}, ada);
    assert.deepEqual([w.os.focusable, w.os.opacity, ada.os.focusable], [false, 0, false], 'işletim sisteminde odaklanamaz ve saydam');
    assert.equal(w.isFocusable(), true, 'mantıksal: oluşturulurkenki değer (odaklanır)');
    assert.equal(ada.isFocusable(), false, 'mantıksal: odaklanamaz oluşturulan pencere odaklanamaz kalır');
    assert.equal(w.getOpacity(), 1, 'mantıksal: opak');
    w.setFocusable(false); assert.equal(w.isFocusable(), false);
    w.setFocusable(true); assert.equal(w.isFocusable(), true);
    ada.setFocusable(true); assert.equal(ada.isFocusable(), true);
    w.setOpacity(0.4); assert.equal(w.getOpacity(), 0.4);
    w.setOpacity(1); assert.equal(w.getOpacity(), 1);
    assert.deepEqual(w.os, { focusable: false, opacity: 0, cagrilar: ['opacity:0', 'focusable:false'] }, 'uygulamanın çağrıları işletim sistemine gitmedi');
    assert.deepEqual(ada.os.cagrilar, ['opacity:0', 'focusable:false']);
  } finally { delete g.__sahtePencereler; }
});

test('arka plan kipi: webContents.isFocused gerçek Electron anlamıyla mantıksal — pencere odakta VE pencerenin odaktaki içeriği; focus() içeriği taşır, işletim sistemi odağı verilmez', async () => {
  const k = await kipIsleyicileri({ ...TEMIZ, FUBER_DEMO: '1' });
  const pencere = k.get('browser-window-created')!, icerik = k.get('web-contents-created')!;
  const tarayici = new SahtePencere(), ana = new SahtePencere();
  const sayfa = sahteIcerik(); // Tarayıcı'nın web sayfası görünümü (WebContentsView)
  tarayici.contentView.children.push({ webContents: sayfa, children: [] });
  g.__sahtePencereler = [tarayici, ana];
  try {
    for (const w of [tarayici, ana]) { pencere({}, w); icerik({}, w.webContents); }
    icerik({}, sayfa);
    assert.deepEqual([tarayici.webContents.isFocused(), sayfa.isFocused()], [false, false], 'pencere odakta değilken hiçbir içerik odakta değil');
    tarayici.focus();
    assert.equal(tarayici.isFocused(), true);
    assert.deepEqual([tarayici.webContents.isFocused(), sayfa.isFocused()], [true, false], 'varsayılan: pencerenin kendi içeriği');
    sayfa.focus();
    assert.equal(sayfa.odak, 1, 'sayfa içi gerçek focus da çağrıldı');
    assert.deepEqual([tarayici.isFocused(), sayfa.isFocused(), tarayici.webContents.isFocused()], [true, true, false], 'pencere-onizle: sayfa odakta, araç çubuğu değil, pencere önde');
    ana.focus();
    assert.deepEqual([sayfa.isFocused(), tarayici.webContents.isFocused(), ana.webContents.isFocused()], [false, false, true], 'başka pencere öne gelince');
    tarayici.focus();
    assert.equal(sayfa.isFocused(), true, 'pencere geri gelince odak son içeriğe döner');
    tarayici.contentView.children.length = 0;
    assert.deepEqual([sayfa.isFocused(), tarayici.webContents.isFocused()], [false, true], 'görünüm kaldırılınca odak pencerenin kendi içeriğine');
    sayfa.destroyed = true;
    assert.equal(sayfa.isFocused(), false);
    for (const w of [tarayici, ana]) assert.ok(!w.os.cagrilar.includes('focus') && !w.os.cagrilar.includes('moveTop'), 'işletim sistemi odağı hiç verilmedi');
  } finally { delete g.__sahtePencereler; }
});

test('FUBER_GORUNUR=1 ve üretim: pencere/web içeriği işleyicisi kurulmaz — isFocusable, getOpacity, webContents.isFocused gerçek kalır', async () => {
  for (const env of [{ ...TEMIZ, FUBER_DEMO: '1', FUBER_GORUNUR: '1' }, { ...TEMIZ }]) {
    const k = await kipIsleyicileri(env);
    assert.equal(k.size, 0, JSON.stringify(env));
  }
});

test.after(() => {
  kanca.deregister();
  delete g.__sahteGlobalShortcut;
});

// ── statik denetim: arka plan kipi `globalShortcut.register`ı (ve işletim sistemine dokunan öteki işlevleri) geçersiz kılar ───────────

const kok = path.resolve(import.meta.dirname, '..');
const kaynaklar = (dizin: string): string[] => fs.readdirSync(dizin, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? kaynaklar(path.join(dizin, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dizin, e.name)] : []));

test('statik: arka plan kipi globalShortcut.register / unregister / isRegistered / unregisterAll (+ registerAll) işlevlerini geçersiz kılar ve yalnız kipteyken', () => {
  const kip = fs.readFileSync(path.join(kok, 'src/main/arka-plan-test.ts'), 'utf8');
  for (const ad of ['register', 'registerAll', 'unregister', 'isRegistered', 'unregisterAll']) assert.match(kip, new RegExp(`\\bg\\.${ad} = `), `arka-plan-test.ts globalShortcut.${ad}'i geçersiz kılmalı`);
  const kur = kip.slice(kip.indexOf('export function arkaPlanTestKipiniKur'));
  assert.ok(kur.indexOf('if (!arkaPlanKipi(process.env)) return;') > 0, 'kur() kipte değilse hiçbir şey yapmaz');
  assert.ok(kur.indexOf('if (!arkaPlanKipi(process.env)) return;') < kur.indexOf('genelKisayollariMantiksalYap();'), 'kısayol geçersiz kılma yalnız kip denetiminden SONRA');
  // Geçersiz kılma işletim sistemi işlevini çağırmaz: kısayol bölümünde eski işlevi saklayan/çağıran bir kalıp yok.
  const govde = kip.slice(kip.indexOf('function genelKisayollariMantiksalYap'), kip.indexOf('/** Arka plan test kipini kurar'));
  assert.ok(govde.length > 200 && !/globalShortcut\.(register|registerAll|unregister|isRegistered|unregisterAll)\s*\(|\.bind\(/.test(govde), 'gerçek globalShortcut çağrılmaz');
});

test('statik: ana süreç globalShortcut\'tan yalnız geçersiz kılınan işlevleri kullanır ve onu içe aktarırken işlev kopyalamaz (geç bağlanan kopya gerçek kaydı yapardı)', () => {
  const dosyalar = kaynaklar(path.join(kok, 'src'));
  const kullanilan = new Set<string>();
  const iceAktaranlar: string[] = [];
  for (const d of dosyalar) {
    const sade = fs.readFileSync(d, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); // yorumlar sayılmaz
    if (/import\s*\{[^}]*\bglobalShortcut\b[^}]*\}\s*from\s*'electron'/.test(sade)) iceAktaranlar.push(path.relative(kok, d).replace(/\\/g, '/'));
    if (d.endsWith('arka-plan-test.ts')) continue; // geçersiz kılan modül nesneyi bilerek ele alır (onu değiştirir)
    for (const m of sade.matchAll(/\bglobalShortcut\.(\w+)/g)) kullanilan.add(m[1]);
    // Takma ad ("= globalShortcut;" ya da "{ register } = globalShortcut"), işlev kopyası ("= globalShortcut.register;") ve .bind yasak:
    // modül yüklenirken (arka plan kipi kurulmadan ÖNCE) yakalanan kopya gerçek işletim sistemi kaydı yapardı. Çağrı ("globalShortcut.register(…)") serbest.
    assert.ok(!/=\s*globalShortcut\s*(?![.\w])|=\s*globalShortcut\.\w+\s*(?:;|$)|\bglobalShortcut\.\w+\.bind\b/m.test(sade), `${d}: globalShortcut kopyalanamaz/ayrıştırılamaz (modül yüklenirken gerçek işlev yakalanır)`);
  }
  assert.deepEqual(iceAktaranlar.sort(), ['src/main/arka-plan-test.ts', 'src/main/main.ts'], 'globalShortcut yalnız main.ts ve arka-plan-test.ts\'te');
  assert.ok(kullanilan.size > 0, 'main.ts globalShortcut kullanıyor');
  const GECERSIZ_KILINAN = new Set(['register', 'registerAll', 'unregister', 'isRegistered', 'unregisterAll']);
  for (const ad of kullanilan) assert.ok(GECERSIZ_KILINAN.has(ad), `globalShortcut.${ad} arka plan kipinde geçersiz kılınmıyor — arka-plan-test.ts'e ekle`);
});
