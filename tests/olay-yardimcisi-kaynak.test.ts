// Olay yardımcısı (fuber-olay.exe, T20, Ruling R1) — kaynak ve ikili taraması (durağan; exe çalıştırılmaz). Gizlilik ve güvenlik
// sözleşmesi: girdi gönderme, süreç açma, ağ, kayıt defterine yazma, uyku ve zamanlayıcı YOK; klavye kancası yalnız klavye.cpp'de, yalnız
// WH_KEYBOARD_LL, yalnız ana süreç {"k":"klavye","acik":true} gönderince kurulur; kanca işlevi yalnız listedeki tuş adlarının
// bırakılışına bakar, her olayı CallNextHookEx ile geçirir, bloklamaz ve tuş kodunu dışarı taşımaz. Çıktıya yazılan "t" değerleri
// yalnız protokol listesindedir. Derlenmiş exe statik CRT'lidir (VC++ paketi gerekmez) ve yasak API'leri içe aktarmaz.
// Düzeltme turu 1: klasör özyinelemeli taranır ve yalnız .cpp/.h bulunabilir; kanca işlevi birebir altın metinle karşılaştırılır
// (izin listesi: tanımlayıcılar, sayılar); vkCode ve KBDLLHOOKSTRUCT bütün kaynaklarda tam bir kez; makro birleştirme yok, #define
// yalnız NOMINMAX ve WIN32_LEAN_AND_MEAN; GetProcAddress yalnız tek bilinen adla; konum olayında bildirim durumu yeniden sorulur.
// T21 (medya oturumu, medya.cpp): medya komutları yalnız beş oturum yöntemini çağırır (oynat → TryPlayAsync, duraklat → TryPauseAsync,
// ileri → TrySkipNextAsync, geri → TrySkipPreviousAsync, konum → TryChangePlaybackPositionAsync); medya tuşu ve APPCOMMAND yok; dört
// GSMTC olayına abone olunur, her belirteç bırakılır; bekleyen (.get) çağrı yok; kullanıcı dizeleri JSON yazıcısından geçer.
// T28b (boşta işlemci): konum değişimi kancası yok, tam ekran kabuğun ABN_FULLSCREENAPP bildirimiyle (ekran başına gizli appbar, yer ayırmaz, çıkışta ve acil
// yolda ABM_REMOVE); klavye kancası tam ekranda kaldırılır ve yalnız istenmişse yeniden kurulur; kanca işlevinin altın metni DEĞİŞMEDİ; `sayac` satırı yalnız
// protokoldeki tamsayı sayaçları taşır.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { YONETIM_VAR } from './yardimci/ozel.ts';
import { fileURLToPath } from 'node:url';
import { KAPAK_SINIRI, MEDYA_EYLEMLERI, OLAY_TURLERI, SAYAC_ALANLARI } from '../src/shared/sistem-olay.ts';

const kok = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KLASOR = path.join(kok, 'native/fuber-olay');
const EXE = path.join(kok, 'resources/bin/fuber-olay.exe');
const BEKLENEN_DOSYALAR = ['olay.cpp', 'guc.cpp', 'ag.cpp', 'ses.cpp', 'klavye.cpp', 'tamekran.cpp', 'parlaklik.cpp', 'medya.cpp', 'cikti.h'];
/** Medya eylemi → çağırabileceği TEK oturum yöntemi (brief). Başka denetim yöntemi (durdur, sar, karıştır, hız …) hiç anılmaz. */
const MEDYA_YONTEMLERI: Record<(typeof MEDYA_EYLEMLERI)[number], string> = {
  oynat: 'TryPlayAsync', duraklat: 'TryPauseAsync', ileri: 'TrySkipNextAsync', geri: 'TrySkipPreviousAsync', konum: 'TryChangePlaybackPositionAsync',
};
const IZINLI_UZANTILAR = ['.cpp', '.h'];
const IZINLI_TUSLAR = ['VK_CAPITAL', 'VK_SPACE', 'VK_SHIFT', 'VK_LSHIFT', 'VK_RSHIFT', 'VK_MENU', 'VK_LMENU', 'VK_RMENU', 'VK_CONTROL', 'VK_LCONTROL', 'VK_RCONTROL', 'VK_LWIN', 'VK_RWIN'];

/**
 * Kanca işlevinin BİREBİR metni (boşluklar tek boşluğa indirilmiş, yorumsuz). Gizlilik sözleşmesinin bekçisi: bu metin ancak
 * gerekçesi yazılarak değiştirilir. İzin verilen davranış: yalnız bırakılış iletisi, yalnız listedeki 13 tuş adı, ana pencereye sabit
 * ileti (wParam 1 ya da 0, lParam 0), her olay CallNextHookEx ile sıradakine.
 */
const KANCA_ALTIN_METIN = [
  'LRESULT CALLBACK KancaIslevi(int kod, WPARAM ileti, LPARAM veri) {',
  'if (kod == HC_ACTION && (ileti == WM_KEYUP || ileti == WM_SYSKEYUP)) {',
  'const DWORD tus = reinterpret_cast<const KBDLLHOOKSTRUCT*>(veri)->vkCode;',
  'if (tus == VK_CAPITAL) { PostMessageW(g_hedef, WM_OLAY_KLAVYE, 1, 0); }',
  'else if (tus == VK_SPACE || tus == VK_SHIFT || tus == VK_LSHIFT || tus == VK_RSHIFT || tus == VK_MENU || tus == VK_LMENU ||',
  'tus == VK_RMENU || tus == VK_CONTROL || tus == VK_LCONTROL || tus == VK_RCONTROL || tus == VK_LWIN || tus == VK_RWIN) {',
  'PostMessageW(g_hedef, WM_OLAY_KLAVYE, 0, 0); } }',
  'return CallNextHookEx(nullptr, kod, ileti, veri); }',
].join(' ');
/** Kanca gövdesinde bulunabilecek tanımlayıcıların tamamı (izin listesi). */
const KANCA_TANIMLAYICILARI = new Set([
  'if', 'else', 'return', 'const', 'reinterpret_cast', 'nullptr', 'kod', 'HC_ACTION', 'ileti', 'WM_KEYUP', 'WM_SYSKEYUP', 'DWORD', 'tus',
  'KBDLLHOOKSTRUCT', 'veri', 'vkCode', 'PostMessageW', 'g_hedef', 'WM_OLAY_KLAVYE', 'CallNextHookEx', ...IZINLI_TUSLAR,
]);

/** Klasördeki BÜTÜN dosyalar, alt klasörler dahil (anahtar: klasöre göre yol, '/' ile). T21 medya.cpp ekleyince o da taranır. */
function kaynaklar(): Map<string, string> {
  const m = new Map<string, string>();
  const gez = (d: string) => {
    for (const g of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, g.name);
      if (g.isDirectory()) gez(p);
      else m.set(path.relative(KLASOR, p).split(path.sep).join('/'), fs.readFileSync(p, 'utf8'));
    }
  };
  gez(KLASOR);
  return m;
}
const bosluksuz = (s: string) => s.replace(/\s+/g, ' ').trim();
/** Yorumlar atılmış kod (// satır sonu ve /* … *\/); dize içindeki "//" korunmaz ama kaynaklarda URL yok. */
const yorumsuz = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
/** `ac` konumundaki '{' ile eşleşen '}' arasını döner (dengeli ayraç). */
function govde(s: string, ac: number): string {
  assert.equal(s[ac], '{');
  let derinlik = 0;
  for (let i = ac; i < s.length; i++) {
    if (s[i] === '{') derinlik++;
    else if (s[i] === '}' && --derinlik === 0) return s.slice(ac + 1, i);
  }
  throw new Error('ayraç kapanmadı');
}
/** Adı verilen işlevin gövdesi (ilk tanım). */
function islevGovdesi(kod: string, ad: string): string {
  const m = new RegExp(`\\b${ad}\\s*\\([^)]*\\)\\s*(?:noexcept\\s*)?\\{`).exec(kod);
  assert.ok(m, `${ad} tanımı bulunamadı`);
  return govde(kod, m.index + m[0].length - 1);
}

test('dosyalar yerinde; klasörde (alt klasörler dahil) yalnız .cpp ve .h var', () => {
  const k = kaynaklar();
  for (const f of BEKLENEN_DOSYALAR) assert.ok(k.has(f), `native/fuber-olay/${f} yok`);
  for (const f of k.keys()) assert.ok(IZINLI_UZANTILAR.includes(path.extname(f).toLowerCase()), `native/fuber-olay/${f}: izinli uzantı değil (taranmayan dosya olmasın)`);
});

test('bütün kaynaklarda: vkCode ve KBDLLHOOKSTRUCT tam bir kez; makro birleştirme yok; #define yalnız NOMINMAX ve WIN32_LEAN_AND_MEAN', () => {
  const s = kaynaklar();
  const say = (desen: RegExp) => [...s.values()].reduce((n, k) => n + [...k.matchAll(desen)].length, 0);
  assert.equal(say(/vkCode/g), 1, 'vkCode yalnız kanca işlevinde, bir kez');
  assert.equal(say(/KBDLLHOOKSTRUCT/g), 1, 'KBDLLHOOKSTRUCT yalnız kanca işlevinde, bir kez');
  for (const [f, k] of s) {
    assert.equal(k.includes('##'), false, `${f}: makro birleştirme (##) yok`);
    for (const m of k.matchAll(/^[ \t]*#[ \t]*define[ \t]+(\w+)/gm)) assert.ok(['NOMINMAX', 'WIN32_LEAN_AND_MEAN'].includes(m[1]), `${f}: #define ${m[1]}`);
  }
  // Derleme komut satırındaki makrolar da yalnız UNICODE / _UNICODE.
  const d = fs.readFileSync(path.join(kok, 'native/derle.mjs'), 'utf8');
  const cl = /export const OLAY_CL = \[([^\]]*)\]/.exec(d);
  assert.ok(cl, 'OLAY_CL bulunamadı');
  for (const m of cl[1].matchAll(/'\/D(\w+)'/g)) assert.ok(['UNICODE', '_UNICODE'].includes(m[1]), `/D${m[1]}`);
});

test('GetProcAddress yalnız bilinen tek adla (SetProcessDpiAwarenessContext)', () => {
  const cagrilar = [...kaynaklar()].flatMap(([f, k]) => [...yorumsuz(k).matchAll(/GetProcAddress\s*\(([^()]*)\)/g)].map((m) => ({ f, arg: m[1] })));
  assert.equal(cagrilar.length, 1, 'tek GetProcAddress');
  assert.equal(cagrilar[0].f, 'olay.cpp');
  assert.match(cagrilar[0].arg, /^\s*\w+\s*,\s*"SetProcessDpiAwarenessContext"\s*$/);
  for (const [f, k] of kaynaklar()) assert.equal((k.match(/GetProcAddress/g) ?? []).length, f === 'olay.cpp' ? 1 : 0, f);
});

test('yasak API ve desenler hiçbir kaynakta geçmez (yorumlar dahil)', () => {
  const YASAK = [
    // girdi gönderme / imleç
    'SendInput', 'keybd_event', 'mouse_event', 'SetCursorPos', 'BlockInput',
    // süreç açma
    'CreateProcess', 'ShellExecute', 'WinExec', 'system(', '_popen', '_wpopen', '_spawn', '_wspawn', 'Launcher',
    // ağ
    'WinHttp', 'InternetOpen', 'WSAStartup', 'WSASocket', 'socket(', 'URLDownload', 'HttpClient', 'Windows.Web', 'Windows.Networking',
    // kayıt defterine yazma
    'RegSetValue', 'RegSetKeyValue', 'RegCreateKey', 'RegDeleteKey', 'RegDeleteValue', 'RegDeleteTree', 'SHSetValue', 'SHRegSet',
    // uyku ve zamanlayıcı (olay güdümlü; boşta uyanma yok)
    'Sleep(', 'SleepEx(', 'SetTimer(', 'SetCoalescableTimer', 'WaitableTimer', 'CreateTimerQueueTimer', 'SetThreadpoolTimer', 'timeSetEvent',
    // tuş okuma / çevirme (kanca yalnız tuş adına bakar)
    'GetAsyncKeyState', 'GetKeyboardState', 'ToUnicode', 'ToAscii', 'MapVirtualKey', 'RegisterRawInputDevices', 'GetRawInputData', 'AttachThreadInput', 'RegisterHotKey',
    // COM ya da dinamik yükleme yoluyla süreç açma ve ağ (WMI yöntem çağrısı, XMLHTTP, BITS, kabuk nesnesi)
    'Win32_Process', 'ExecMethod', 'XMLHTTP', 'ServerXMLHTTP', 'BITS', 'IBackgroundCopyManager', 'BackgroundCopy', 'IShellDispatch', 'LoadLibrary',
    // medya: tuş ya da uygulama komutu taklidi ve kendi oynatıcısı yok (yalnız GSMTC oturum yöntemleri, T21)
    'APPCOMMAND', 'VK_MEDIA', 'VK_VOLUME', 'MediaPlayer', 'Windows.Media.Playback',
  ];
  for (const [f, s] of kaynaklar()) for (const y of YASAK) assert.equal(s.includes(y), false, `${f}: "${y}" geçmemeli`);
});

test('klavye kancası yalnız klavye.cpp\'de, tek yerde ve yalnız WH_KEYBOARD_LL', () => {
  for (const [f, s] of kaynaklar()) {
    const kancalar = [...s.matchAll(/SetWindowsHookEx\w*/g)].map((m) => m[0]);
    if (f === 'klavye.cpp') assert.deepEqual(kancalar, ['SetWindowsHookExW'], 'klavye.cpp\'de tam bir SetWindowsHookExW');
    else assert.deepEqual(kancalar, [], `${f}: kanca kurmaz`);
    // Başka kanca türü (WH_KEYBOARD, WH_MOUSE*, WH_GETMESSAGE, WH_CALLWNDPROC, WH_JOURNAL*, WH_CBT …) hiç anılmaz.
    for (const m of s.matchAll(/\bWH_\w+/g)) assert.equal(m[0], 'WH_KEYBOARD_LL', `${f}: ${m[0]}`);
  }
  const k = yorumsuz(kaynaklar().get('klavye.cpp')!);
  assert.match(k, /SetWindowsHookExW\(\s*WH_KEYBOARD_LL\s*,\s*\w+\s*,/);
  assert.match(k, /UnhookWindowsHookEx\(/, 'kanca kapatılınca kaldırılır');
  assert.match(k, /PostThreadMessageW\([^)]*WM_QUIT/, 'kanca iş parçacığı WM_QUIT ile biter');
});

test('pencere olayları yalnız süreç dışı (WINEVENT_OUTOFCONTEXT); DLL enjeksiyonu yok', () => {
  for (const [f, s] of kaynaklar()) {
    const k = yorumsuz(s);
    assert.equal(k.includes('WINEVENT_INCONTEXT'), false, f);
    for (const m of k.matchAll(/SetWinEventHook\(([^;]*);/g)) assert.match(m[1], /WINEVENT_OUTOFCONTEXT/, `${f}: ${m[0]}`);
  }
});

test('kanca işlevi birebir altın metin: yalnız bırakılış, yalnız 13 tuş adı, sabit ileti, her olay CallNextHookEx ile geçer', () => {
  const k = yorumsuz(kaynaklar().get('klavye.cpp')!);
  // SetWindowsHookExW'ye verilen işlev KancaIslevi; adı yalnız tanımında ve kurulumda geçer (ikinci bir kanca işlevi yok).
  assert.equal(/SetWindowsHookExW\(\s*WH_KEYBOARD_LL\s*,\s*(\w+)\s*,/.exec(k)?.[1], 'KancaIslevi');
  assert.equal((k.match(/\bKancaIslevi\b/g) ?? []).length, 2, 'KancaIslevi: bir tanım + bir kurulum');
  const bas = k.indexOf('LRESULT CALLBACK KancaIslevi(');
  assert.ok(bas >= 0, 'KancaIslevi tanımı');
  const ac = k.indexOf('{', bas);
  const tanim = k.slice(bas, ac) + '{' + govde(k, ac) + '}';
  assert.equal(bosluksuz(tanim), KANCA_ALTIN_METIN, 'kanca işlevi değişti: gizlilik sözleşmesi, gerekçesiyle güncellenmeli');
  // Altın metin değişse bile bekçiler: gövdede yalnız izinli tanımlayıcılar ve yalnız 0/1 sayıları.
  const g = govde(k, ac);
  for (const m of g.matchAll(/[A-Za-z_]\w*/g)) assert.ok(KANCA_TANIMLAYICILARI.has(m[0]), `kanca gövdesinde izinsiz tanımlayıcı: ${m[0]}`);
  for (const m of g.matchAll(/(?<![A-Za-z_\w])\d[\w.]*/g)) assert.ok(['0', '1'].includes(m[0]), `kanca gövdesinde izinsiz sayı: ${m[0]}`);
  const donusler = [...g.matchAll(/\breturn\b([^;]*);/g)].map((m) => m[1].trim());
  assert.deepEqual(donusler, ['CallNextHookEx(nullptr, kod, ileti, veri)'], 'tek çıkış: her olay sıradaki kancaya');
  for (const m of g.matchAll(/PostMessageW\(([^;]*)\);/g)) assert.match(m[1], /^\s*g_hedef\s*,\s*WM_OLAY_KLAVYE\s*,\s*[01]\s*,\s*0\s*$/, `sabit ileti: ${m[0]}`);
  // Bütün klavye.cpp de tuş adı listesinin dışına çıkmaz.
  for (const m of k.matchAll(/\bVK_\w+/g)) assert.ok(IZINLI_TUSLAR.includes(m[0]), `klavye.cpp ${m[0]} anmamalı`);
});

test('kanca iş parçacığı yüksek öncelikte (zaman aşımında Windows kancayı sessizce kaldırmasın)', () => {
  const k = yorumsuz(kaynaklar().get('klavye.cpp')!);
  const g = islevGovdesi(k, 'KancaIsParcacigi');
  const oncelik = g.indexOf('SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST)');
  assert.ok(oncelik >= 0, 'THREAD_PRIORITY_HIGHEST');
  assert.ok(oncelik < g.indexOf('SetWindowsHookExW('), 'öncelik kanca kurulmadan önce');
});

// 0.14 T28b (T28 incelemesi Important 3): önceki "konum olayında bildirim durumu yeniden sorulur" sınaması, konum kancası kaldırıldığı için appbar yoluna
// taşındı. Aynı söz korunur: Direct3D tam ekrandan Alt+Enter ile çıkan oyunda bayat bildirim durumu yüzünden "açık"ta takılınmaz — kabuğun bildirimi her
// seferinde bildirim durumunu da sorar.
test('tam ekran: konum kancası yok; kabuğun ABN_FULLSCREENAPP bildirimi ekran başına appbar ile, yer ayırmadan; her olayda bildirim durumu sorulur', () => {
  const s = kaynaklar();
  for (const [f, k] of s) {
    // İmleç ve düzeltme iminin her hareketinde uyandıran konum olayı hiçbir kaynakta kancalanmaz; ekranda yer ayıran appbar iletileri hiç yok.
    assert.equal(yorumsuz(k).includes('EVENT_OBJECT_LOCATIONCHANGE'), false, `${f}: konum değişimi kancası yok`);
    for (const y of ['ABM_SETPOS', 'ABM_QUERYPOS', 'ABM_SETAUTOHIDEBAR', 'ABM_SETSTATE']) assert.equal(k.includes(y), false, `${f}: ${y} (ekranda yer ayırma) yok`);
    if (f !== 'tamekran.cpp') assert.equal(k.includes('SHAppBarMessage'), false, `${f}: appbar yalnız tamekran.cpp'de`);
  }
  const t = yorumsuz(s.get('tamekran.cpp')!);
  assert.equal(bosluksuz(islevGovdesi(t, 'bildirimTamEkranMi')), 'return d == QUNS_RUNNING_D3D_FULL_SCREEN || d == QUNS_PRESENTATION_MODE;');
  assert.match(islevGovdesi(t, 'degerlendir'), /if \(bildirimTamEkranMi\(g_bildirim\)\) acik = true;/);
  assert.doesNotMatch(t, /degerlendir\(\s*false\s*,/, 'bildirim durumu hiçbir yolda koşulsuz atlanmaz');
  // Appbar kaydı yalnız geri çağırma iletisiyle; bildirim değerlendirmeyi bildirim durumuyla birlikte başlatır.
  const kaydet = bosluksuz(islevGovdesi(t, 'appbarKaydet'));
  assert.match(kaydet, /a\.uCallbackMessage = WM_OLAY_APPBAR;/);
  assert.match(kaydet, /SHAppBarMessage\(ABM_NEW, &a\)/);
  assert.doesNotMatch(kaydet, /a\.rc|a\.uEdge/, 'konum ve kenar bildirilmez');
  assert.deepEqual([...t.matchAll(/SHAppBarMessage\(\s*(\w+)/g)].map((m) => m[1]).sort(), ['ABM_NEW', 'ABM_REMOVE']);
  const bar = islevGovdesi(t, 'BarIslevi');
  assert.match(bosluksuz(bar), /if \(w == ABN_FULLSCREENAPP\) \{ g_sayAppbar\+\+; degerlendir\(true, true\); \}/);
  // Ekran başına bir appbar; ekran düzeni değişince ve görev çubuğu yeniden açılınca yeniden kurulur; çıkışta (ve acil yolda) ABM_REMOVE.
  assert.match(islevGovdesi(t, 'barlariKur'), /EnumDisplayMonitors\(/);
  const yonetici = islevGovdesi(t, 'YoneticiIslevi');
  assert.match(yonetici, /WM_DISPLAYCHANGE[\s\S]*barlariKur\(\)/);
  assert.match(yonetici, /g_gorevCubuguAcildi[\s\S]*barlariKur\(\)/);
  assert.match(t, /RegisterWindowMessageW\(L"TaskbarCreated"\)/);
  assert.match(islevGovdesi(t, 'barlariBirak'), /appbarBirak\(h\)/);
  assert.match(islevGovdesi(t, 'appbarBirak'), /SHAppBarMessage\(ABM_REMOVE, &a\)/);
  assert.match(islevGovdesi(t, 'tamEkranKapat'), /barlariBirak\(\)/);
  assert.match(islevGovdesi(t, 'tamEkranAcilKapat'), /appbarBirak\(h\)/);
  const olay = yorumsuz(s.get('olay.cpp')!);
  assert.match(islevGovdesi(olay, 'IstisnaSuzgeci'), /tamEkranAcilKapat\(\)/, 'işlenmeyen istisnada appbar bırakılır');
  assert.match(islevGovdesi(olay, 'StdinOkuyucu'), /WaitForSingleObject\(g_bitti, 700\) != WAIT_OBJECT_0\) tamEkranAcilKapat\(\)/, 'takılan ana iş parçacığında da');
  assert.match(olay, /SetUnhandledExceptionFilter\(IstisnaSuzgeci\)/);
  // Appbar pencereleri hiç gösterilmez (ShowWindow yok, WS_VISIBLE yok).
  assert.equal(/ShowWindow|WS_VISIBLE/.test(t), false, 'appbar pencereleri görünmez');
});

test('klavye kancası tam ekranda kaldırılır, bitince YALNIZ istenmişse yeniden kurulur; kanca işlevi değişmedi', () => {
  const k = yorumsuz(kaynaklar().get('klavye.cpp')!);
  // Kancayı kuran tek işlev kancaKur: tanım + iki çağrı (istek ve tam ekranın bitişi).
  assert.equal((k.match(/\bkancaKur\(\)/g) ?? []).length, 3, 'kancaKur: tanım + klavyeAyarla + klavyeTamEkran');
  assert.equal((k.match(/CreateThread\(/g) ?? []).length, 1, 'kanca iş parçacığı yalnız kancaKur\'da açılır');
  assert.match(islevGovdesi(k, 'kancaKur'), /CreateThread\(nullptr, 0, KancaIsParcacigi,/);
  const ayarla = bosluksuz(islevGovdesi(k, 'klavyeAyarla'));
  assert.match(ayarla, /g_istendi = true;.*if \(g_tamEkran\) return;.*kancaKur\(\)/, 'istek: tam ekranda kurulmaz');
  const tam = bosluksuz(islevGovdesi(k, 'klavyeTamEkran'));
  assert.match(tam, /if \(!g_istendi\) return;.*if \(tamEkran\) \{ kancaKaldir\(\); return; \}.*if \(!kancaKur\(\)\) return; capsBak\(true\); dilBak\(true\);/,
    'tam ekranın bitmesi yalnız istenmiş kancayı kurar; fark bir kez yazılır');
  // Yalnız tamekran.cpp çağırır, yalnız tam ekran kararı değişince.
  for (const [f, s] of kaynaklar()) {
    const n = (yorumsuz(s).match(/klavyeTamEkran\(/g) ?? []).length;
    if (f === 'tamekran.cpp') assert.equal(n, 1, f);
    else if (f !== 'klavye.cpp' && f !== 'cikti.h') assert.equal(n, 0, f);
  }
  assert.match(islevGovdesi(yorumsuz(kaynaklar().get('tamekran.cpp')!), 'degerlendir'), /if \(acik != oncekiAcik\) klavyeTamEkran\(acik\);/);
});

test('sayac satırı: yalnız protokoldeki sayaç adları, yalnız tamsayı; tuş, başlık ya da dize yazılmaz', () => {
  const s = kaynaklar();
  const olay = yorumsuz(s.get('olay.cpp')!);
  const yaz = islevGovdesi(olay, 'sayacYaz');
  assert.match(yaz, /Olay o\("sayac"\)/);
  const govdeler = [yaz, islevGovdesi(yorumsuz(s.get('tamekran.cpp')!), 'tamEkranSayaclari'), islevGovdesi(yorumsuz(s.get('klavye.cpp')!), 'klavyeSayaclari')];
  const adlar = govdeler.flatMap((g) => [...g.matchAll(/\.tamsayi\(\s*"(\w+)"/g)].map((m) => m[1]));
  assert.deepEqual([...adlar].sort(), [...SAYAC_ALANLARI].sort(), 'adlar protokolle birebir');
  for (const g of govdeler) {
    assert.doesNotMatch(g, /\.(metin|ham|mantik|sayi|bos)\(/, 'yalnız tamsayı alanlar');
    assert.doesNotMatch(g, /vkCode|GetWindowText|GetClassName|tus/, 'tuş ya da pencere verisi yok');
  }
  assert.match(olay.slice(olay.indexOf('while (GetMessageW')), /klavyeAyarla\(false\);[\s\S]*sayacYaz\(acilis\);[\s\S]*SetEvent\(g_bitti\)/, 'kanca kapandıktan sonra, çıkıştan önce');
});

test('kanca yalnız {"k":"klavye","acik":true} komutuyla kurulur; açılışta kurulmaz', () => {
  const s = kaynaklar();
  for (const [f, k] of s) assert.doesNotMatch(yorumsuz(k), /klavyeAyarla\(\s*true\s*\)/, `${f}: kanca koşulsuz kurulmamalı`);
  const olay = yorumsuz(s.get('olay.cpp')!);
  const komut = islevGovdesi(olay, 'komutIsle');
  assert.match(komut, /"klavye"/);
  assert.match(komut, /klavyeAyarla\(\s*\w+\s*\)/);
  const cagrilar = [...olay.matchAll(/klavyeAyarla\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert.deepEqual(cagrilar.filter((c) => c !== 'false').length, 1, 'olay.cpp\'de kancayı açabilen tek çağrı komut işleyicisinde');
  for (const [f, k] of s) if (f !== 'olay.cpp' && f !== 'klavye.cpp' && f !== 'cikti.h') assert.doesNotMatch(yorumsuz(k), /klavyeAyarla\(/, f);
  // Caps Lock yalnız kendi geçiş biti için okunur.
  for (const [f, k] of s) for (const m of yorumsuz(k).matchAll(/GetKeyState\(([^)]*)\)/g)) assert.equal(m[1].trim(), 'VK_CAPITAL', `${f}: ${m[0]}`);
});

test('çıktıya yazılan "t" değerleri yalnız protokol listesinde; "t" anahtarını yalnız Olay kurar', () => {
  assert.deepEqual([...OLAY_TURLERI], ['hazir', 'guc', 'ag', 'ses-aygiti', 'ses', 'parlaklik', 'caps', 'dil', 'tam-ekran', 'medya', 'durum', 'hata', 'sayac']);
  const kullanilan = new Set<string>();
  for (const [f, s] of kaynaklar()) {
    const k = yorumsuz(s);
    // Her Olay kurulumu dize sabitiyle: `Olay o("guc");`, geçici `Olay("hata")` ya da küme ayraçlı `Olay o{"ag"}`.
    const kurulumlar = [...k.matchAll(/\bOlay\s+\w+\s*\(([^)]*)\)|\bOlay\s*\(([^)]*)\)|\bOlay\s+\w+\s*\{([^}]*)\}|\bOlay\s*\{([^}]*)\}/g)]
      .filter((m) => !/^\s*const\s+char/.test(m[1] ?? m[2] ?? m[3] ?? m[4] ?? ''));
    for (const m of kurulumlar) {
      const arg = (m[1] ?? m[2] ?? m[3] ?? m[4]).trim();
      const d = /^"([^"]*)"$/.exec(arg);
      assert.ok(d, `${f}: Olay türü dize sabiti olmalı: ${m[0]}`);
      assert.ok((OLAY_TURLERI as readonly string[]).includes(d[1]), `${f}: bilinmeyen olay türü "${d[1]}"`);
      kullanilan.add(d[1]);
    }
    // "t" anahtarı başka yoldan yazılmaz.
    const tAnahtari = [...k.matchAll(/"t"|\\"t\\"/g)].length;
    if (f === 'cikti.h') assert.equal(tAnahtari, 1, 'cikti.h: "t" yalnız Olay kurucusunda');
    else assert.equal(tAnahtari, 0, `${f}: "t" anahtarını elle yazmamalı`);
  }
  for (const t of OLAY_TURLERI) assert.ok(kullanilan.has(t), `"${t}" olayı hiç yazılmıyor`);
});

test('medya komutları yalnız oturum yöntemlerini çağırır: oynat, duraklat, ileri, geri, konum', () => {
  const s = kaynaklar();
  const komutYontemleri = Object.values(MEDYA_YONTEMLERI);
  // Bütün kaynaklarda Try…Async yalnız beş komut ve özellik okuması; her komut yöntemi tam bir kez, medya.cpp'nin medyaKomutu'nda.
  for (const [f, k] of s) for (const c of yorumsuz(k).matchAll(/\bTry\w*Async\b/g)) {
    assert.ok([...komutYontemleri, 'TryGetMediaPropertiesAsync'].includes(c[0]), `${f}: ${c[0]} çağrılmamalı`);
  }
  const say = (desen: RegExp) => [...s.values()].reduce((n, k) => n + [...yorumsuz(k).matchAll(desen)].length, 0);
  for (const y of komutYontemleri) assert.equal(say(new RegExp(`\\b${y}\\b`, 'g')), 1, `${y} tek yerde`);
  // Medya oturumuna yalnız medya.cpp dokunur.
  for (const [f, k] of s) if (f !== 'medya.cpp') assert.doesNotMatch(k, /GlobalSystemMediaTransportControls|Windows\.Media|Media::Control/, `${f}: medya oturumuna dokunmaz`);
  const m = yorumsuz(s.get('medya.cpp')!);
  // Eylem listesi protokolle (src/shared/sistem-olay.ts) aynı.
  const liste = /EYLEMLER\[\]\s*=\s*\{([^}]*)\}/.exec(m);
  assert.ok(liste, 'EYLEMLER listesi');
  assert.deepEqual([...liste[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]), [...MEDYA_EYLEMLERI]);
  // medyaKomutu: her eylem tam bir oturum yöntemine; gövdede izin listesi dışında çağrı yok (tuş, ileti, süreç yok).
  const g = islevGovdesi(m, 'medyaKomutu');
  for (const [eylem, yontem] of Object.entries(MEDYA_YONTEMLERI)) {
    assert.match(bosluksuz(g), new RegExp(`if \\(eylem == "${eylem}"\\) islem = g_oturum\\.${yontem}\\(`), `${eylem} → ${yontem}`);
  }
  assert.deepEqual([...g.matchAll(/g_oturum\s*\.\s*(\w+)\s*\(/g)].map((x) => x[1]).sort(), [...komutYontemleri].sort(), 'oturumda yalnız beş yöntem');
  const IZINLI = new Set(['if', 'catch', 'eylemMi', 'hataYaz', 'konumAdimi', 'PostMessageW', 'Completed', 'GetResults', ...komutYontemleri]);
  for (const c of g.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) assert.ok(IZINLI.has(c[1]), `medyaKomutu içinde izinsiz çağrı: ${c[1]}`);
  // Konum adımı yalnız aritmetik (oturuma ya da başka bir şeye sorulmaz).
  for (const c of islevGovdesi(m, 'konumAdimi').matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) assert.ok(['if', 'fmin', 'fmax', 'llround'].includes(c[1]), `konumAdimi: ${c[1]}`);
  // Oturum nesnesinde bütün dosyada yalnız okuma, abonelik ve beş komut.
  const OTURUM_IZINLI = new Set(['SourceAppUserModelId', 'TryGetMediaPropertiesAsync', 'GetTimelineProperties', 'GetPlaybackInfo',
    'MediaPropertiesChanged', 'PlaybackInfoChanged', 'TimelinePropertiesChanged', ...komutYontemleri]);
  for (const c of m.matchAll(/g_oturum\s*\.\s*(\w+)\s*\(/g)) assert.ok(OTURUM_IZINLI.has(c[1]), `g_oturum.${c[1]}`);
  // medyaKomutu yalnız stdin komutundan: tanım (medya.cpp), bildirim (cikti.h), tek çağrı (olay.cpp komutIsle "medya" dalı).
  assert.equal(say(/\bmedyaKomutu\s*\(/g), 3, 'medyaKomutu: tanım + bildirim + tek çağrı');
  const komut = islevGovdesi(yorumsuz(s.get('olay.cpp')!), 'komutIsle');
  const bas = komut.indexOf('ad == "medya"');
  assert.ok(bas >= 0, 'komutIsle: medya dalı');
  const dal = govde(komut, komut.indexOf('{', bas));
  assert.match(dal, /medyaKomutu\(/);
  for (const c of dal.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) assert.ok(['if', 'hataYaz', 'medyaKomutu'].includes(c[1]), `medya dalında izinsiz çağrı: ${c[1]}`);
});

test('medya: yalnız olay güdümlü — dört GSMTC olayı, her belirteç bırakılır, bekleyen çağrı yok', () => {
  const s = kaynaklar();
  const m = yorumsuz(s.get('medya.cpp')!);
  const OLAYLAR = [
    ['CurrentSessionChanged', 'g_oturumBelirteci'], ['MediaPropertiesChanged', 'g_ozellikBelirteci'],
    ['PlaybackInfoChanged', 'g_oynatmaBelirteci'], ['TimelinePropertiesChanged', 'g_zamanBelirteci'],
  ] as const;
  for (const [olay, belirtec] of OLAYLAR) {
    assert.equal([...m.matchAll(new RegExp(`\\.${olay}\\(\\s*\\[`, 'g'))].length, 1, `${olay}: tek abonelik`);
    assert.match(m, new RegExp(`${belirtec}\\s*=\\s*g_\\w+\\.${olay}\\(\\s*\\[`), `${olay}: belirteç ${belirtec} saklanır`);
    assert.match(m, new RegExp(`\\.${olay}\\(\\s*${belirtec}\\s*\\)`), `${olay}: belirteçle bırakılır`);
  }
  // Oturum değişince ve çıkışta: oturumBirak üç oturum belirtecini, medyaKapat ayrıca oturum değişimi belirtecini bırakır.
  const birak = islevGovdesi(m, 'oturumBirak');
  for (const [olay, belirtec] of OLAYLAR.slice(1)) assert.match(birak, new RegExp(`\\.${olay}\\(\\s*${belirtec}\\s*\\)`), `oturumBirak: ${olay}`);
  const kapat = islevGovdesi(m, 'medyaKapat');
  assert.match(kapat, /oturumBirak\(\)/);
  assert.match(kapat, /\.CurrentSessionChanged\(\s*g_oturumBelirteci\s*\)/);
  assert.match(islevGovdesi(m, 'oturumBagla'), /oturumBirak\(\)/, 'yeni oturuma geçmeden eski belirteçler bırakılır');
  const olay = yorumsuz(s.get('olay.cpp')!);
  assert.match(olay.slice(olay.indexOf('while (GetMessageW')), /medyaKapat\(\)/, 'çıkışta medyaKapat');
  // Bekleme yok: tamamlanma işleyicileri yalnız ileti bırakır; oturum listesi taranmaz.
  for (const y of ['.get()', 'wait_for', 'WaitForSingleObject', 'WaitForMultipleObjects', 'MsgWaitForMultipleObjects', 'SessionsChanged', 'GetSessions']) {
    assert.equal(m.includes(y), false, `medya.cpp: ${y}`);
  }
});

test('medya: kapak akıştan beklemeden okunur, 256 KB\'ı aşarsa null; kullanıcı dizeleri JSON yazıcısından geçer', () => {
  const m = yorumsuz(kaynaklar().get('medya.cpp')!);
  assert.match(m, /IRandomAccessStreamReference/);
  assert.match(m, /\.OpenReadAsync\(\)\s*\.Completed\(/, 'kapak akışı tamamlanma işleyicisiyle açılır (ana iş parçacığı beklemez)');
  assert.match(m, /\.ReadAsync\([^;]*\)\s*\.Completed\(/, 'okuma da tamamlanma işleyicisiyle');
  assert.match(m, /KAPAK_SINIRI\s*=\s*256\s*\*\s*1024/, 'sınır protokolle aynı');
  assert.equal(KAPAK_SINIRI, 256 * 1024);
  assert.match(m, /boy\s*>\s*KAPAK_SINIRI/, 'sınırı aşan kapak okunmaz');
  for (const onek of ['data:image/jpeg;base64,', 'data:image/png;base64,']) assert.ok(m.includes(`"${onek}"`), onek);
  // Uygulama adı, başlık, sanatçı, albüm metin() ile (kaçışlı, 256 karakterle sınırlı); ham() yalnız kapak (base64 alfabesi) için.
  for (const a of ['uygulama', 'baslik', 'sanatci', 'album']) assert.match(m, new RegExp(`\\.metin\\(\\s*"${a}"\\s*,`), a);
  assert.deepEqual([...m.matchAll(/\.ham\(\s*"(\w+)"/g)].map((x) => x[1]), ['kapak']);
});

test('derle.mjs: olay hedefi vswhere → vcvars64.bat → cl, /MT statik CRT ve brief bağlantı listesi', () => {
  const d = fs.readFileSync(path.join(kok, 'native/derle.mjs'), 'utf8');
  assert.match(d, /export function olayDerle\(/);
  assert.match(d, /hedef === 'olay'/);
  assert.match(d, /vswhere\.exe/);
  assert.match(d, /vcvars64\.bat/);
  for (const s of ['/nologo', '/std:c++17', '/EHsc', '/O2', '/MT', '/utf-8', '/DUNICODE', '/D_UNICODE']) assert.ok(d.includes(`'${s}'`), s);
  for (const l of ['windowsapp.lib', 'ole32.lib', 'oleaut32.lib', 'user32.lib', 'wbemuuid.lib', 'powrprof.lib']) assert.ok(d.includes(`'${l}'`), l);
  assert.ok(d.includes('/SUBSYSTEM:CONSOLE'), 'konsol alt sistemi');
});

// ── İkili: PE içe aktarma tablosu ───────────────────────────────────────────────────────────────────────────────────────────────
interface PeBilgisi { makine: number; altSistem: number; iceAktarma: Map<string, string[]> }
function peOku(b: Buffer): PeBilgisi {
  assert.equal(b.toString('latin1', 0, 2), 'MZ');
  const pe = b.readUInt32LE(0x3c);
  assert.equal(b.toString('latin1', pe, pe + 4), 'PE\0\0');
  const makine = b.readUInt16LE(pe + 4);
  const bolumSayisi = b.readUInt16LE(pe + 6);
  const isteğeBagliBoy = b.readUInt16LE(pe + 20);
  const ib = pe + 24;
  assert.equal(b.readUInt16LE(ib), 0x20b, 'PE32+ (x64)');
  const altSistem = b.readUInt16LE(ib + 68);
  const veriDizini = ib + 112;
  const iceRva = b.readUInt32LE(veriDizini + 8);
  const bolumler = ib + isteğeBagliBoy;
  const dosyaKonumu = (rva: number): number => {
    for (let i = 0; i < bolumSayisi; i++) {
      const s = bolumler + i * 40;
      const va = b.readUInt32LE(s + 12), boy = Math.max(b.readUInt32LE(s + 8), b.readUInt32LE(s + 16)), ham = b.readUInt32LE(s + 20);
      if (rva >= va && rva < va + boy) return rva - va + ham;
    }
    throw new Error(`RVA bölümde değil: ${rva}`);
  };
  const cstr = (o: number) => b.toString('latin1', o, b.indexOf(0, o));
  const iceAktarma = new Map<string, string[]>();
  for (let d = dosyaKonumu(iceRva); ; d += 20) {
    const ad = b.readUInt32LE(d + 12);
    if (ad === 0) break;
    const thunk = b.readUInt32LE(d) || b.readUInt32LE(d + 16);
    const islevler: string[] = [];
    for (let t = dosyaKonumu(thunk); ; t += 8) {
      const v = b.readBigUInt64LE(t);
      if (v === 0n) break;
      if (v & (1n << 63n)) islevler.push(`#${Number(v & 0xffffn)}`);
      else islevler.push(cstr(dosyaKonumu(Number(v & 0x7fffffffn)) + 2));
    }
    iceAktarma.set(cstr(dosyaKonumu(ad)).toLowerCase(), islevler);
  }
  return { makine, altSistem, iceAktarma };
}

// Açık kaynak hazırlığı: genel depoda derlenmiş exe yok (node native/derle.mjs olay ile üretilir); exe yoksa ve özel depo değilse atlanır.
test('derlenmiş exe: x64 konsol, statik CRT (VC++ paketi gerekmez), ağ DLL\'i yok, yasak API içe aktarılmaz', { skip: !YONETIM_VAR && !fs.existsSync(EXE) ? 'derlenmiş exe yok (genel depo: node native/derle.mjs olay)' : false }, () => {
  assert.ok(fs.existsSync(EXE), 'resources/bin/fuber-olay.exe yok (node native/derle.mjs olay)');
  const pe = peOku(fs.readFileSync(EXE));
  assert.equal(pe.makine, 0x8664, 'x64');
  assert.equal(pe.altSistem, 3, 'IMAGE_SUBSYSTEM_WINDOWS_CUI (konsol)');
  const dller = [...pe.iceAktarma.keys()];
  for (const d of dller) {
    assert.doesNotMatch(d, /^(vcruntime|msvcp|ucrtbase|concrt|api-ms-win-crt-)/, `${d}: CRT statik bağlanmalı (/MT)`);
    assert.doesNotMatch(d, /^(ws2_32|wsock32|mswsock|winhttp|wininet|urlmon|webio|dnsapi)\.dll$/, `${d}: ağ kitaplığı`);
  }
  const YASAK_ISLEVLER = new Set([
    'SendInput', 'keybd_event', 'mouse_event', 'SetCursorPos', 'BlockInput',
    'CreateProcessW', 'CreateProcessA', 'CreateProcessAsUserW', 'ShellExecuteW', 'ShellExecuteExW', 'ShellExecuteA', 'WinExec',
    'RegSetValueExW', 'RegSetValueExA', 'RegSetKeyValueW', 'RegCreateKeyExW', 'RegDeleteKeyW', 'RegDeleteValueW',
    'Sleep', 'SleepEx', 'SetTimer', 'SetCoalescableTimer', 'CreateWaitableTimerW', 'CreateWaitableTimerExW', 'SetWaitableTimer', 'CreateTimerQueueTimer', 'SetThreadpoolTimer',
    'GetAsyncKeyState', 'GetKeyboardState', 'ToUnicode', 'ToUnicodeEx', 'ToAscii', 'MapVirtualKeyW', 'RegisterRawInputDevices', 'GetRawInputData', 'AttachThreadInput',
  ]);
  for (const [d, islevler] of pe.iceAktarma) for (const i of islevler) assert.equal(YASAK_ISLEVLER.has(i), false, `${d}!${i} içe aktarılmamalı`);
  // Kanca yalnız SetWindowsHookExW ile (A sürümü ya da başka yol yok).
  const user32 = pe.iceAktarma.get('user32.dll') ?? [];
  assert.ok(user32.includes('SetWindowsHookExW'));
  assert.equal(user32.includes('SetWindowsHookExA'), false);
});
