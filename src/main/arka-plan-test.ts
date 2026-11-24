// ── Arka plan test kipi ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// 28 Eki: testler koşarken arayüz kullanıcının ekranına gelmemeli, öne çıkmamalı; testler arka planda koşar. Önizleme betikleri,
// ekran çekimi ve duman testi uygulamayı FUBER_DEMO ile açar; bu kipte pencereler kullanıcının ekranında GÖRÜNMEZ (saydamlık 0), odak
// ÇALMAZ (işletim sistemi odağı hiç verilmez), görev çubuğunda DURMAZ ve tıklamaları YUTMAZ (fare olayları alttaki pencereye geçer).
// Sayfa içi etkileşim (Playwright CDP girdileri) ve ekran görüntüleri (CDP) pencerenin ekrandaki hâlinden bağımsızdır, etkilenmez.
// Ana sürecin odak mantığı (ada "uygulama önde mi", isFocused, getFocusedWindow) MANTIKSAL odakla sürer: show()/focus() pencereyi
// mantıksal olarak öne alır ve focus/blur olaylarını yayar — uygulama kendi davranışını değiştirmeden sınanır.
// Gizlenen pencereler Chromium'da örtülü/arka plan sayılıp boyamayı ya da zamanlayıcıları kısmasın diye o kısmalar kapatılır.
// Görünür koşu (yalnız bilgisayar başında kimse yokken; ör. gerçek imleç/isabet denetimleri): FUBER_GORUNUR=1.
// Genel kısayollar (0.11 G12a): arka plan kipinde `globalShortcut` işletim sistemine HİÇBİR tuş kaydetmez — kayıtlar mantıksal bir defterdedir
// (shared/arka-plan.ts kisayolDefteri); acil durdurma (Alt+Shift+Q) ve asistan kısayolu kullanıcının gerçek tuşlarını yakalamaz, görünmez örnek
// mikrofonu açamaz. Kayıt sonuçları uygulamanın kendi mantığına gerçek Electron gibi döner (alındı / alınamadı); "başka uygulamada" durumu
// `FUBER_TEST_KISAYOL_BASKA` ya da ana süreçte `globalShortcut.mantiksal.baskaUygulamada(tus)` ile taklit edilir, tuş basışı
// `globalShortcut.mantiksal.tetikle(tus)` ile (önizlemelerin IPC kancaları da çalışır). FUBER_GORUNUR=1'de gerçek kayıt sürer.
// Mantıksal odaklanabilirlik ve web içeriği odağı (0.11 son inceleme; G12b artığı): pencere işletim sisteminde hep odaklanamaz kalır, ama
// `isFocusable()` uygulamanın İSTEDİĞİ değeri (oluşturulurkenki `focusable` + `setFocusable` çağrıları) döner; `webContents.isFocused()` gerçek
// Electron'daki gibi "pencere (mantıksal) odakta VE bu web içeriği pencerenin odaktaki içeriği" der (`webContents.focus()` pencere içinde odağı
// o içeriğe taşır; varsayılan pencerenin kendi webContents'i). Önizlemelerin denetimleri (düşmanca window.open "odaklanır"; Tarayıcı'da sayfa
// görünümü odakta, araç çubuğu değil) böylece arka planda da gerçek davranışı ölçer — hiçbir denetim gevşetilmez, işletim sistemi odağı yine verilmez.
import { app, BrowserWindow, globalShortcut, type View, type WebContents } from 'electron';
import { arkaPlanKipi, kisayolBaskaListesi, kisayolDefteri } from '../shared/arka-plan.js';

let mantiksalOdak: BrowserWindow | null = null;
/** Pencerenin mantıksal odaktaki web içeriği (`webContents.focus()` taşır; yoksa pencerenin kendi webContents'i). */
const odaktakiIcerik = new WeakMap<BrowserWindow, WebContents>();

/** Bir görünüm ağacında bu web içeriği var mı (WebContentsView'lar iç içe olabilir). */
function agactaMi(v: View, wc: WebContents): boolean {
  for (const c of v.children) {
    if ((c as View & { webContents?: WebContents }).webContents === wc || agactaMi(c, wc)) return true;
  }
  return false;
}

/** Web içeriğinin sahibi pencere: kendi webContents'i ya da görünüm ağacındaki bir WebContentsView'ünki. */
function sahibi(wc: WebContents): BrowserWindow | null {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue;
    if (w.webContents === wc || agactaMi(w.contentView, wc)) return w;
  }
  return null;
}

/** Pencerenin odaktaki içeriği: taşınan içerik hâlâ yaşıyor ve bu pencerede ise o, değilse pencerenin kendi webContents'i. */
function odaktaki(w: BrowserWindow): WebContents {
  const c = odaktakiIcerik.get(w);
  return c && !c.isDestroyed() && sahibi(c) === w ? c : w.webContents;
}

/** Web içeriğini mantıksal odağa bağlar (gerçek `focus()` da çağrılır: sayfa içi odak — autofocus, klavye olayları — aynen sürer). */
function arkaPlanWebIcerigi(wc: WebContents): void {
  const gercekOdak = wc.focus.bind(wc);
  wc.focus = () => {
    gercekOdak();
    const w = sahibi(wc);
    if (w) odaktakiIcerik.set(w, wc);
  };
  wc.isFocused = () => {
    if (wc.isDestroyed()) return false;
    const w = sahibi(wc);
    return Boolean(w) && mantiksalOdak === w && odaktaki(w!) === wc;
  };
}

function odakla(w: BrowserWindow): void {
  if (w.isDestroyed() || mantiksalOdak === w) return;
  const onceki = mantiksalOdak;
  mantiksalOdak = w;
  if (onceki && !onceki.isDestroyed()) onceki.emit('blur');
  w.emit('focus');
}

function birak(w: BrowserWindow): void {
  if (mantiksalOdak !== w) return;
  mantiksalOdak = null;
  if (!w.isDestroyed()) w.emit('blur');
}

/** Bir pencereyi arka plan kipine alır: görünmez, odak almaz, görev çubuğunda yok, tıklamayı geçirir; odak mantıksal. */
function arkaPlanPenceresi(w: BrowserWindow): void {
  const opaklik = w.setOpacity.bind(w);
  const fareyiYoksay = w.setIgnoreMouseEvents.bind(w);
  const gosterEtkinlesmeden = w.showInactive.bind(w);
  const gizle = w.hide.bind(w);
  // Mantıksal hâl, işletim sistemi hâli değişmeden ÖNCE okunur (oluşturulurkenki `focusable` / `opacity`).
  let odaklanir = w.isFocusable();
  let mantiksalOpaklik = w.getOpacity();
  opaklik(0);
  w.setSkipTaskbar(true);
  w.setFocusable(false);
  fareyiYoksay(true);
  // Uygulamanın kendi çağrıları işletim sistemi hâlini geri açmasın; mantıksal hâl sürer (sorgular onu döner).
  w.setOpacity = (o: number) => { if (Number.isFinite(o)) mantiksalOpaklik = Math.min(1, Math.max(0, o)); };
  w.getOpacity = () => mantiksalOpaklik;
  w.setIgnoreMouseEvents = () => undefined;
  w.setSkipTaskbar = () => undefined;
  w.setFocusable = (f: boolean) => { odaklanir = Boolean(f); };
  w.isFocusable = () => odaklanir;
  w.moveTop = () => undefined;
  w.flashFrame = () => undefined;
  w.show = () => { gosterEtkinlesmeden(); odakla(w); };
  w.focus = () => odakla(w);
  w.blur = () => birak(w);
  w.hide = () => { birak(w); gizle(); };
  w.isFocused = () => !w.isDestroyed() && mantiksalOdak === w;
  w.once('closed', () => { if (mantiksalOdak === w) mantiksalOdak = null; });
}

/**
 * `globalShortcut`ın işletim sistemine dokunan bütün işlevlerini mantıksal deftere çevirir (uygulamanın kullandığı dördü + `registerAll`;
 * tests/arka-plan.test.ts: ana süreç kodu bunlardan başkasını çağırırsa test düşer). Defter nesnesi `globalShortcut.mantiksal` olarak açılır
 * (yalnız test kancası: önizlemeler `electronApp.evaluate(({ globalShortcut }) => globalShortcut.mantiksal…)` ile erişir).
 */
function genelKisayollariMantiksalYap(): void {
  const defter = kisayolDefteri({ platform: process.platform, baska: kisayolBaskaListesi(process.env) });
  const g = globalShortcut as unknown as Record<string, unknown>;
  g.register = (hizlandirici: string, geriCagri: () => void) => defter.register(hizlandirici, geriCagri);
  g.registerAll = (hizlandiricilar: string[], geriCagri: () => void) => { for (const h of hizlandiricilar) defter.register(h, geriCagri); };
  g.unregister = (hizlandirici: string) => defter.unregister(hizlandirici);
  g.isRegistered = (hizlandirici: string) => defter.isRegistered(hizlandirici);
  g.unregisterAll = () => defter.unregisterAll();
  g.mantiksal = defter;
}

/** Arka plan test kipini kurar: ilk pencereden ve `app.ready`'den ÖNCE çağrılır (Chromium anahtarları). Kipte değilse hiçbir şey yapmaz. */
export function arkaPlanTestKipiniKur(): void {
  if (!arkaPlanKipi(process.env)) return;
  genelKisayollariMantiksalYap();
  // Önizleme "Başlangıçta aç"ı değiştirse bile kullanıcının Windows başlangıç kaydına (HKCU Run) dev electron.exe yazılmaz (G12a incelemesi).
  app.setLoginItemSettings = () => undefined;
  // 0.12 H5 incelemesi: "Hey Fuber" varsayılan açık (ayarlar ses.uyandirma) — kulak ve mikrofon denetimleri GERÇEK mikrofonu hiç açmaz;
  // getUserMedia Chromium'un sahte aygıtını alır (ses dosyası isteyen betikler kendi --use-file-for-fake-audio-capture'ını ekler).
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  BrowserWindow.getFocusedWindow = () => (mantiksalOdak && !mantiksalOdak.isDestroyed() ? mantiksalOdak : null);
  app.on('browser-window-created', (_e, w) => arkaPlanPenceresi(w));
  app.on('web-contents-created', (_e, wc) => arkaPlanWebIcerigi(wc));
}
