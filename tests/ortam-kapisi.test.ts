// 0.12 H6 (Ruling P12): kurulu (paketli) uygulamada test geçersiz kılmalarının kapısı — shared/ortam-kapisi.ts (saf karar) ve main/ortam-kapisi.ts
// (main.ts'in İLK içe aktarımı). Kurallar:
//   · sunucu adresleri (FUBER_HESAP_ADRES, FUBER_KOPRU_ADRES; ayardaki kopru.adres): yalnız https://api.ornek.example ya da loopback;
//   · yerel hizmet / test sahteleri (FUBER_YEREL_TABAN, FUBER_WHISPER_TABAN, FUBER_TEST_ARAMA, FUBER_PANO_SAHTE, FUBER_TEST_UV_URL): yalnız loopback;
//   · başka değer → değişken silinir (varsayılan) + uyarı (değer yazılmaz); çökme yok; paketsizde hiçbir şey değişmez;
//   · RunAsNode sigortası kapalı: FUBER_TEST_PIPER kuruluda silinir; NODE_TLS_REJECT_UNAUTHORIZED kuruluda silinir;
//   · düzeltme turu 1: sahte komut/sır/köprü kaydı/klasör kancaları ve arka plan test kipi (FUBER_DEMO) kuruluda YALNIZ yalıtılmış profilde
//     (FUBER_VERI: mutlak, yerel, varsayılan veri klasörü değil); yalıtılmış profilde dokunulmaz;
//   · ANTHROPIC_BASE_URL ortamda kalır (Claude Code), Fuber'in kendi Claude çağrıları kuruluda adresi açıkça verir (yalnız loopback kabul);
//   · komut satırı: ağ/TLS/uzaktan hata ayıklama bayrakları kuruluda açılışı durdurur (yalıtılmış profilde CDP serbest);
//   · geliştirici araçları kurulu uygulamada kapalı (FUBER_DEMO açmaz).
//   · düzeltme turu 2 (N-1…N-7): yalıtılmış profil kararı yolun KİMLİĞİYLE (gerçek yol: 8.3 kısa ad, junction, harf, ADS, UNC, \\?\, sondaki
//     nokta/boşluk); varsayılan = appData + ürün adı (oluşturulmaz, --user-data-dir'den bağımsız), çözülemezse KAPALI; FUBER_VERI verilmiş ama
//     yalıtılmış değilse uygulama açılmaz; FUBER_BELGELER de kanca; SSLKEYLOGFILE silinir; yasak bayraklar genişledi (Fuber AI'de --user-data-dir);
//     açılmama kutusu yalnız gerçek kullanıcıya (arka plan test kipinde ve yalıtılmış profilde yok).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { YONETIM_VAR } from './yardimci/ozel.ts';
import { execFileSync } from 'node:child_process';
import { ACILMADI_KUTUSU, ADRES_DEGISKENLERI, ANTHROPIC_SUNUCUSU, ARKA_PLAN_DEGISKENLERI, GUVENLIK_DEGISKENLERI, MASAUSTU_EK_YASAK, NODE_GUVENLIK_DEGISKENLERI, PROFIL_KANCALARI, RUN_AS_NODE_KANCALARI, YALITILMIS_PROFILDE_SERBEST, YASAK_BAYRAKLAR, adresKabulMu, anthropicTabani, kanonikYol, kuruluOrtamUyarilari, kuruluOrtamiKaydet, kuruluSunucuAdresi, loopbackMi, paketliOrtamKarari, paketliSurecMi, yalitilmisProfilMi, yasakliBayraklar, yolParcalari, type GercekYol } from '../src/shared/ortam-kapisi.ts';
import { arkaPlanKipi } from '../src/shared/arka-plan.ts';

import { isDiliIhlali } from '../src/shared/is-dili.ts';

const kok = path.resolve(import.meta.dirname, '..');
const oku = (g: string) => fs.readFileSync(path.join(kok, g), 'utf8').replace(/\r\n/g, '\n');
const VARSAYILAN = 'C:\\Kullanicilar\\Deniz\\AppData\\Roaming\\Fuber AI';
const YALITILMIS = 'C:\\Kullanicilar\\Deniz\\AppData\\Local\\Temp\\fuber-duman-abc';
/** Saf testlerin sahte dosya sistemi: yalnız sürücü kökü "var" (gerçek yolu kendisi) — kimlik metinden gelir. */
const sahte: GercekYol = (p) => (/^[A-Za-z]:\\$/.test(p) ? p : null);
/** Gerçek dosya sistemi (main/ortam-kapisi.ts ile aynı çözücü). */
const gercek: GercekYol = (p) => { try { return fs.realpathSync.native(p); } catch { return null; } };
const kurulu = (env: Record<string, string | undefined>) => paketliOrtamKarari(env, true, { varsayilanVeri: VARSAYILAN, gercekYol: sahte });

const KABUL_LOOPBACK = ['http://127.0.0.1:5123', 'http://localhost:8080', 'http://[::1]:9000', 'https://localhost:9443/yol', 'ws://127.0.0.1:7000', 'http://127.0.0.1:9/ara?q=', 'HTTP://LOCALHOST:1', 'http://0x7f.0.0.1:4'];
const RED_HER_YER = ['https://api.ornek.example', 'http://api.ornek.example', 'https://api.ornek.example:8443', 'https://u:p@api.ornek.example', 'https://api.ornek.example.kotu.example',
  'http://127.0.0.1.kotu.example:80', 'http://10.0.0.5:8080', 'http://192.168.1.2', 'ftp://127.0.0.1/x', 'file:///C:/x', 'bozuk adres', 'http://user@127.0.0.1:5', 'http://localhost.:80', 'http://127.0.0.2:80'];

test('yolParcalari: yalnız sürücü harfli mutlak yol; UNC, aygıt, sürücüye göreli, göreli, X:yol, ADS (::$INDEX_ALLOCATION), NUL reddedilir', () => {
  assert.deepEqual(yolParcalari('C:\\A\\.\\B\\..\\C\\'), { surucu: 'C:', parcalar: ['A', 'C'] });
  assert.deepEqual(yolParcalari('c:/a/b'), { surucu: 'C:', parcalar: ['a', 'b'] });
  assert.deepEqual(yolParcalari('\\\\?\\C:\\a'), { surucu: 'C:', parcalar: ['a'] }, '\\\\?\\X: öneki atılır');
  assert.deepEqual(yolParcalari('C:\\Fuber AI. \\x'), { surucu: 'C:', parcalar: ['Fuber AI', 'x'] }, 'sondaki nokta/boşluk Win32 gibi atılır');
  for (const y of ['', '   ', '\\\\sunucu\\pay\\x', '//sunucu/pay', '\\\\?\\UNC\\s\\p', '\\\\.\\C:\\x', '\\x', '/Users/x', 'göreli', '.\\x', 'C:x',
    'C:\\x\\Fuber AI::$INDEX_ALLOCATION', 'C:\\x:akis', 'C:\\x\0y', 'C:\\x\\...\\y']) assert.equal(yolParcalari(y), null, JSON.stringify(y));
});

test('yalitilmisProfilMi (metin kimliği, sahte FS): harf, ayraç, sondaki nokta, .., \\\\?\\ → aynı; varsayılan çözülemezse KAPALI', () => {
  assert.equal(yalitilmisProfilMi(YALITILMIS, VARSAYILAN, sahte), true);
  assert.equal(yalitilmisProfilMi('D:/test/fuber-veri', VARSAYILAN, sahte), true, 'düz bölü, başka sürücü');
  for (const [v, neden] of [
    [undefined, 'verilmemiş'], ['', 'boş'], ['  ', 'boşluk'],
    [VARSAYILAN, 'varsayılanın kendisi'], ['c:\\kullanicilar\\deniz\\appdata\\roaming\\fuber ai\\', 'büyük/küçük harf + sondaki ayraç'],
    ['C:/Kullanicilar/Deniz/AppData/Roaming/Fuber AI', 'düz bölüyle varsayılan'], [`${VARSAYILAN}\\electron-profil`, 'varsayılanın içinde'],
    ['C:\\Kullanicilar\\Deniz\\AppData', 'varsayılanın üstünde'], ['C:\\', 'sürücü kökü (üstünde)'], [`${VARSAYILAN}\\..\\Fuber AI`, '.. ile varsayılana çözülen'],
    [`${VARSAYILAN}.`, 'sondaki nokta (Win32 atar)'], [`${VARSAYILAN} `, 'sondaki boşluk'], [`\\\\?\\${VARSAYILAN}`, '\\\\?\\ önekli varsayılan'],
    [`${VARSAYILAN}::$INDEX_ALLOCATION`, 'ADS'], ['\\\\sunucu\\pay\\fuber', 'UNC'], ['/Users/Deniz/AppData/Roaming/Fuber AI', 'sürücüye göreli'],
    ['fuber-veri', 'göreli'], ['.\\veri', 'göreli'],
  ] as const) assert.equal(yalitilmisProfilMi(v, VARSAYILAN, sahte), false, `${neden}: ${v}`);
  // Varsayılan bilinmiyor / çözülemiyor → kapalı (mutlak yerel FUBER_VERI körlemesine yalıtılmış SAYILMAZ).
  assert.equal(yalitilmisProfilMi(YALITILMIS, '', sahte), false);
  assert.equal(yalitilmisProfilMi(YALITILMIS, '\\\\sunucu\\pay\\Fuber AI', sahte), false);
  assert.equal(yalitilmisProfilMi(YALITILMIS, VARSAYILAN, () => null), false, 'hiçbir yol çözülemiyor');
  // Çözücü fırlatırsa çökme yok, kapalı.
  assert.equal(yalitilmisProfilMi(YALITILMIS, VARSAYILAN, () => { throw new Error('x'); }), false);
  // Gerçek yol UNC çıkarsa (ağ sürücüsüne bağlı harf) kapalı.
  assert.equal(kanonikYol('Z:\\veri', (p) => (p.startsWith('Z:') ? '\\\\sunucu\\pay' : null)), null);
  // 8.3 / junction eşdeğeri sahtesi: kısa ad gerçek yola çözülür → aynı klasör.
  const kisaAd: GercekYol = (p) => (p.toUpperCase() === 'C:\\KULLANICILAR\\DENIZ\\APPDATA\\ROAMING\\FUBERA~1' ? VARSAYILAN : sahte(p));
  assert.equal(yalitilmisProfilMi('C:\\Kullanicilar\\Deniz\\AppData\\Roaming\\FUBERA~1', VARSAYILAN, kisaAd), false, 'kısa ad sahtesi');
  assert.equal(yalitilmisProfilMi('C:\\Kullanicilar\\Deniz\\AppData\\Roaming\\FUBERA~1\\yeni\\alt', VARSAYILAN, kisaAd), false, 'kısa adın içinde, var olmayan alt');
});

test('yalitilmisProfilMi (GERÇEK dosya sistemi, geçici klasör): junction, 8.3 kısa ad, harf, "İ" içeren yol, var olmayan alt klasör', (t) => {
  if (process.platform !== 'win32') { t.skip('yalnız Windows'); return; }
  const kokT = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-yol-kimligi-')));
  try {
    const varsayilan = path.join(kokT, 'Roaming', 'Fuber AI uzun klasör adı');
    fs.mkdirSync(varsayilan, { recursive: true });
    const veri = path.join(kokT, 'test-veri');
    fs.mkdirSync(veri);
    assert.equal(yalitilmisProfilMi(veri, varsayilan, gercek), true, 'ayrı klasör');
    assert.equal(yalitilmisProfilMi(path.join(kokT, 'yok', 'veri'), varsayilan, gercek), true, 'henüz olmayan ayrı klasör');
    assert.equal(yalitilmisProfilMi(varsayilan.toUpperCase(), varsayilan, gercek), false, 'büyük harf');
    assert.equal(yalitilmisProfilMi(path.join(varsayilan, 'yeni', 'alt'), varsayilan, gercek), false, 'varsayılanın içinde, var olmayan alt');
    assert.equal(yalitilmisProfilMi(`${varsayilan}::$INDEX_ALLOCATION`, varsayilan, gercek), false, 'ADS');
    // Junction: başka bir adla aynı klasör.
    const kopru = path.join(kokT, 'kopru');
    fs.symlinkSync(path.join(kokT, 'Roaming'), kopru, 'junction');
    assert.equal(yalitilmisProfilMi(path.join(kopru, 'Fuber AI uzun klasör adı'), varsayilan, gercek), false, 'junction');
    assert.equal(yalitilmisProfilMi(path.join(kopru, 'Fuber AI uzun klasör adı', 'electron-profil'), varsayilan, gercek), false, 'junction + alt');
    // 8.3 kısa ad (birimde üretim açıksa gerçeği; değilse yukarıdaki sahte test bu yolu sınar).
    let kisa = '';
    try { kisa = execFileSync('cmd.exe', ['/d', '/s', '/c', `"for %I in ("${varsayilan}") do @echo %~sI"`], { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true }).trim(); } catch { /* yok */ }
    if (kisa && kisa.toUpperCase() !== varsayilan.toUpperCase() && fs.existsSync(kisa)) {
      assert.equal(yalitilmisProfilMi(kisa, varsayilan, gercek), false, `8.3 kısa ad: ${kisa}`);
      assert.equal(yalitilmisProfilMi(path.join(kisa, 'alt'), varsayilan, gercek), false, '8.3 + alt');
    } else t.diagnostic('bu birimde 8.3 kısa ad üretilmiyor — kısa ad sahte çözücüyle sınandı');
    // "İ" içeren yol (ör. ...\ORNEK LABS\FUBER Aİ): NTFS İ'yi I'dan ayırır; harf farkı yine aynı klasör.
    const iKok = path.join(kokT, 'ORNEK LABS');
    const aI = path.join(iKok, 'FUBER Aİ');
    fs.mkdirSync(path.join(aI, 'veri'), { recursive: true });
    assert.equal(yalitilmisProfilMi(path.join(aI, 'veri'), path.join(iKok, 'FUBER AI'), gercek), true, '"FUBER Aİ" ≠ "FUBER AI"');
    assert.equal(yalitilmisProfilMi(path.join(kokT, 'ornek labs', 'FUBER Aİ', 'veri'), aI, gercek), false, 'İ\'li varsayılanın içinde (harf farkı)');
    assert.equal(yalitilmisProfilMi(aI, aI, gercek), false);
  } finally { fs.rmSync(kokT, { recursive: true, force: true }); }
});

test('paketli: RunAsNode kancası (FUBER_TEST_PIPER), NODE_TLS_REJECT_UNAUTHORIZED ve SSLKEYLOGFILE yalıtılmış profilde bile silinir', () => {
  assert.deepEqual([...RUN_AS_NODE_KANCALARI], ['FUBER_TEST_PIPER']);
  assert.deepEqual([...GUVENLIK_DEGISKENLERI], ['NODE_TLS_REJECT_UNAUTHORIZED', 'SSLKEYLOGFILE']);
  assert.equal(NODE_GUVENLIK_DEGISKENLERI, GUVENLIK_DEGISKENLERI, 'eski ad aynı liste (Yönetim)');
  const k = kurulu({ FUBER_VERI: YALITILMIS, FUBER_DEMO: '1', FUBER_TEST_PIPER: 'C:\\x\\sahte-piper.mjs', NODE_TLS_REJECT_UNAUTHORIZED: '0', SSLKEYLOGFILE: 'C:\\x\\anahtar.log' });
  assert.deepEqual(k.sil, ['FUBER_TEST_PIPER', 'NODE_TLS_REJECT_UNAUTHORIZED', 'SSLKEYLOGFILE']);
  assert.match(k.uyarilar[0], /RunAsNode kapalı/);
  assert.match(k.uyarilar[1], /TLS sertifika doğrulaması kapatılamaz/);
  assert.match(k.uyarilar[2], /^SSLKEYLOGFILE yok sayıldı: kurulu uygulama TLS oturum anahtarlarını dosyaya yazmaz/);
  assert.doesNotMatch(k.uyarilar.join(' '), /sahte-piper|anahtar\.log/);
  // '1' (doğrulama açık) zararsız: yine silinir ama uyarı yazılmaz.
  const bir = kurulu({ NODE_TLS_REJECT_UNAUTHORIZED: '1' });
  assert.deepEqual([bir.sil, bir.uyarilar], [['NODE_TLS_REJECT_UNAUTHORIZED'], []]);
  assert.equal(k.testKipi, true, 'yalıtılmış profil + FUBER_DEMO = test kipi');
  assert.equal(k.kutu, false, 'test kipinde açılmama kutusu yok');
});

test('FUBER_VERI verilmiş ama yalıtılmış değil (varsayılan, takma ad, UNC, göreli, ADS) → uygulama AÇILMAZ; kutu yalnız gerçek kullanıcıya', () => {
  for (const veri of [VARSAYILAN, `${VARSAYILAN}\\electron-profil`, '\\\\sunucu\\pay\\veri', '\\\\sunucu@SSL\\DavWWWRoot\\x', 'goreli', `${VARSAYILAN}::$INDEX_ALLOCATION`, '/Users/x']) {
    const g = kurulu({ FUBER_VERI: veri });
    assert.equal(g.veriGecersiz, true, veri);
    assert.equal(g.kutu, true, `${veri}: gerçek kullanıcı (FUBER_DEMO yok) kutuyu görür`);
    assert.ok(g.uyarilar.some((u) => u.startsWith('FUBER_VERI kabul edilmedi')), veri);
    assert.doesNotMatch(g.uyarilar.join(' '), /sunucu|DavWWWRoot|goreli/, 'değer yazılmaz');
    const demo = kurulu({ FUBER_VERI: veri, FUBER_DEMO: '1' });
    assert.equal(demo.veriGecersiz, true);
    assert.equal(demo.kutu, false, `${veri}: arka plan test kipinde kutu yok (yalnız günlük)`);
  }
  assert.equal(kurulu({ FUBER_VERI: YALITILMIS }).veriGecersiz, false);
  assert.equal(kurulu({}).veriGecersiz, false, 'FUBER_VERI yok: normal kullanıcı, açılır');
  assert.equal(kurulu({}).kutu, true);
  // Varsayılan çözülemiyorsa (ev klasörü bozuk) KAPALI: mutlak yerel FUBER_VERI de kabul edilmez.
  assert.equal(paketliOrtamKarari({ FUBER_VERI: YALITILMIS }, true, { varsayilanVeri: '', gercekYol: sahte }).veriGecersiz, true);
  // Kutu metinleri kısa, sakin, teknik ayrıntısız (İş dili).
  for (const m of Object.values(ACILMADI_KUTUSU)) { assert.equal(isDiliIhlali(m), null, m); assert.doesNotMatch(m, /FUBER_|--|\bflag|bayrak|ortam değişkeni|'/i, m); }
});

test('yalıtılmış profil kuralı: kancalar ve arka plan kipi yalnız yalıtılmış profilde; gerçek profilde silinir (+ uyarı, değer yok)', () => {
  const kancalar: Record<string, string> = Object.fromEntries([...PROFIL_KANCALARI, ...ARKA_PLAN_DEGISKENLERI].map((k) => [k, k === 'FUBER_GORUNUR' ? '0' : `deger-${k}`]));
  kancalar.FUBER_SIR_API_ANTHROPIC = 'sk-ant-' + 'GIZLI';
  kancalar.fuber_sir_api_openai = 'sk-' + 'GIZLI'; // Windows ortamı büyük/küçük harf duyarsız
  // Yalıtılmış profil: hiçbiri silinmez (gercek-*-testi FUBER_DEMO'suz ama FUBER_VERI + FUBER_SIR_* ile açar).
  const y = kurulu({ ...kancalar, FUBER_VERI: YALITILMIS });
  assert.deepEqual(y.sil, []);
  assert.equal(y.yalitilmis, true);
  assert.equal(kurulu({ FUBER_VERI: YALITILMIS, FUBER_SIR_API_ANTHROPIC: 'x' }).testKipi, false, 'FUBER_DEMO yoksa test kipi değil (kancalar yine geçerli)');
  // Gerçek profil (FUBER_VERI yok / varsayılan / UNC / göreli): hepsi silinir (FUBER_VERI verilmişse uygulama zaten açılmaz).
  for (const veri of [undefined, VARSAYILAN, '\\\\sunucu\\pay\\veri', 'goreli']) {
    const env: Record<string, string | undefined> = { ...kancalar, ...(veri === undefined ? {} : { FUBER_VERI: veri }) };
    const g = kurulu(env);
    assert.deepEqual([...g.sil].sort(), [...Object.keys(kancalar)].sort(), `FUBER_VERI=${veri}`);
    const kancaUyarilari = g.uyarilar.filter((u) => /yalnız yalıtılmış bir test profilinde \(FUBER_VERI\) geçerli/.test(u));
    assert.equal(kancaUyarilari.length, Object.keys(kancalar).length);
    assert.equal(g.veriGecersiz, veri !== undefined);
    assert.doesNotMatch(g.uyarilar.join(' '), /GIZLI|deger-/, 'uyarı değeri yazmaz');
    assert.equal(g.testKipi, false);
    // Silindikten sonra arka plan kipi yok: kullanıcının gerçek profili görünmez çalışmaz.
    for (const ad of g.sil) delete env[ad];
    assert.equal(arkaPlanKipi(env), false);
  }
  // FUBER_VERI'nin kendisi silinmez (silinseydi test gerçek veriye giderdi; yalıtılmış değilse uygulama açılmaz). FUBER_BELGELER artık kanca:
  // gerçek profilde silinir (UNC'ye yöneltilip paylaşıma dokunulmasın, dışa aktarımlar oraya gitmesin).
  const v = kurulu({ FUBER_BELGELER: '\\\\sunucu\\pay\\belgeler' });
  assert.ok(v.sil.includes('FUBER_BELGELER'));
  assert.ok(!kurulu({ FUBER_VERI: VARSAYILAN }).sil.includes('FUBER_VERI'));
  assert.ok(!kurulu({ FUBER_VERI: YALITILMIS, FUBER_BELGELER: 'C:\\x' }).sil.includes('FUBER_BELGELER'), 'yalıtılmış profilde FUBER_BELGELER geçerli');
});

test('ANTHROPIC_BASE_URL: ortamda kalır (Claude Code); Fuber\'in kendi çağrıları kuruluda yalnız loopback kabul eder, değilse api.anthropic.com', () => {
  const k = kurulu({ FUBER_VERI: YALITILMIS, ANTHROPIC_BASE_URL: 'https://kotu.example/v1' });
  assert.deepEqual(k.sil, [], 'process.env\'den silinmez');
  assert.equal(k.uyarilar.length, 1);
  assert.match(k.uyarilar[0], /^ANTHROPIC_BASE_URL Fuber’in kendi Claude çağrılarında yok sayılıyor/);
  assert.doesNotMatch(k.uyarilar[0], /kotu/);
  assert.deepEqual(kurulu({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:4567' }).uyarilar, [], 'loopback uyarısız');
  assert.equal(anthropicTabani({ ANTHROPIC_BASE_URL: 'https://kotu.example/v1' }, true), ANTHROPIC_SUNUCUSU);
  assert.equal(anthropicTabani({}, true), ANTHROPIC_SUNUCUSU, 'kuruluda adres her zaman açık');
  assert.equal(anthropicTabani({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:4567/' }, true), 'http://127.0.0.1:4567', 'testlerin sahte sunucusu');
  assert.equal(ANTHROPIC_SUNUCUSU, 'https://api.anthropic.com');
  // Kablolama: SDK istemcisi adresi kapıdan alır; process.env'e yazılmaz.
  const motor = oku('src/main/motor/anthropic.ts');
  assert.match(motor, /new Anthropic\(\{ apiKey: k, maxRetries: 0, baseURL: anthropicTabani\(process\.env, paketliSurecMi\(\)\) \}\)/);
  assert.doesNotMatch(motor, /process\.env\.ANTHROPIC_BASE_URL\s*=|delete process\.env/);
});

test('komut satırı: kuruluda ağ/TLS/günlük/sandbox/alt süreç/uzaktan hata ayıklama bayrakları açılışı durdurur; Fuber AI\'de --user-data-dir; yalıtılmışta yalnız CDP serbest', () => {
  for (const b of ['remote-debugging-port', 'ignore-certificate-errors', 'host-resolver-rules', 'proxy-server', 'disable-web-security',
    'log-net-log', 'net-log-capture-mode', 'ssl-key-log-file', 'no-sandbox', 'disable-gpu-sandbox',
    'browser-subprocess-path', 'renderer-cmd-prefix', 'utility-cmd-prefix', 'gpu-launcher']) assert.ok(YASAK_BAYRAKLAR.includes(b), b);
  assert.ok(!YASAK_BAYRAKLAR.includes('user-data-dir'), 'Fuber Yönetim test yalıtımını bununla verir: ortak listede değil');
  assert.deepEqual([...MASAUSTU_EK_YASAK], ['user-data-dir']);
  assert.deepEqual([...YALITILMIS_PROFILDE_SERBEST], ['remote-debugging-port', 'remote-debugging-pipe']);
  const var_ = (liste: string[]) => (b: string) => liste.includes(b);
  assert.deepEqual(yasakliBayraklar(var_(['remote-debugging-port']), { paketli: true, yalitilmis: false }), ['remote-debugging-port'], 'gerçek profil: CDP yasak');
  assert.deepEqual(yasakliBayraklar(var_(['remote-debugging-port']), { paketli: true, yalitilmis: true }), [], 'yalıtılmış profil: Playwright bağlanır');
  assert.deepEqual(yasakliBayraklar(var_(['remote-debugging-port', 'ignore-certificate-errors']), { paketli: true, yalitilmis: true }), ['ignore-certificate-errors'], 'yalıtılmışta da TLS bayrağı yasak');
  assert.deepEqual(yasakliBayraklar(var_(['user-data-dir']), { paketli: true, yalitilmis: true, ek: MASAUSTU_EK_YASAK }), ['user-data-dir'], 'Fuber AI: --user-data-dir her zaman yasak');
  assert.deepEqual(yasakliBayraklar(var_(['user-data-dir']), { paketli: true, yalitilmis: false }), [], 'Yönetim: ortak listede değil (yalıtım kararı çözülmüş yolla)');
  assert.deepEqual(yasakliBayraklar(var_(['use-fake-device-for-media-stream', 'use-fake-ui-for-media-stream', 'use-file-for-fake-audio-capture', 'inspect']), { paketli: true, yalitilmis: false, ek: MASAUSTU_EK_YASAK }), [], 'test/medya bayrakları serbest (--inspect sigortada)');
  // Kablolama: iki uygulama da kararı açılışta uygular, kutu yalnız gerçek kullanıcıya, sonra pencere açmadan çıkar.
  const kapi = oku('src/main/ortam-kapisi.ts');
  assert.match(kapi, /yasakliBayraklar\(\(b\) => app\.commandLine\.hasSwitch\(b\), \{ paketli, yalitilmis: karar\.yalitilmis, ek: MASAUSTU_EK_YASAK \}\);/);
  assert.match(kapi, /if \(karar\.veriGecersiz \|\| yasak\.length\) \{[\s\S]*?if \(karar\.kutu\) \{ try \{ dialog\.showErrorBox\([\s\S]*?process\.exit\(1\);\n\}/);
  if (YONETIM_VAR) { // Açık kaynak hazırlığı: genel depoda yonetim/ yok — Yönetim kısmı yalnız özel depoda denetlenir (tests/yardimci/ozel.ts).
    const yon = oku('yonetim/main/main.ts');
    assert.match(yon, /yasakliBayraklar\(\(b\) => app\.commandLine\.hasSwitch\(b\), \{ paketli: app\.isPackaged, yalitilmis: YALITILMIS \}\)/);
    assert.match(yon, /if \(!arkaPlanKipi\(process\.env\) && !YALITILMIS\) \{ try \{ dialog\.showErrorBox\(ACILMADI_KUTUSU\.yonetimBaslik, ACILMADI_KUTUSU\.bayrak\)/);
  }
});

test('süreç durumu ve Hakkında: kapı kurulu uygulama bilgisini kaydeder; durum:al yalnız ADLARI taşır; Hakkında gösterir', () => {
  assert.equal(paketliSurecMi(), false, 'testte varsayılan: paketli değil');
  kuruluOrtamiKaydet(true, ['FUBER_HESAP_ADRES yok sayıldı: …']);
  assert.equal(paketliSurecMi(), true);
  assert.deepEqual([...kuruluOrtamUyarilari()], ['FUBER_HESAP_ADRES yok sayıldı: …']);
  kuruluOrtamiKaydet(false, []);
  assert.match(oku('src/main/ortam-kapisi.ts'), /kuruluOrtamiKaydet\(paketli, karar\.uyarilar\);/);
  assert.match(oku('src/main/ipc.ts'), /ortamUyarilari: kuruluOrtamUyarilari\(\)\.map\(\(u\) => u\.split\(' '\)\[0\]\),/);
  const genel = oku('src/renderer/ayarlar/Genel.tsx');
  assert.match(genel, /data-ortam-yok-sayilan/);
  assert.match(genel, /yokSayilan\.length > 0 &&/, 'yalnız yok sayılan varsa');
});

test('kapsam: ana süreçte okunan her adres/taban/URL ortam değişkeni kapıda; process.env\'i dolaylı okuyan yerler bilinen listede', () => {
  const dosyalar: string[] = [];
  const gez = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const y = path.join(d, e.name); if (e.isDirectory()) gez(y); else if (/\.ts$/.test(e.name)) dosyalar.push(y); } };
  gez(path.join(kok, 'src', 'main'));
  const okunan = new Set<string>();
  const dolayli: string[] = [];
  for (const d of dosyalar) {
    const s = fs.readFileSync(d, 'utf8');
    for (const m of s.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) okunan.add(m[1]);
    const g = path.relative(kok, d).replace(/\\/g, '/');
    // Dinamik okuma (process.env[x]) ve takma ad (const e = process.env): adı derleme anında görünmez — yalnız bilinen yerlerde. Muaf olan
    // YALNIZ kapının silme satırı (`delete process.env[ad];`); `const x = process.env[ad];` gibi her okuma yakalanır (inceleme N-5).
    if (/process\.env\[/.test(s.replace(/delete process\.env\[ad\];/g, ''))) dolayli.push(`${g}: process.env[…]`);
    if (/=\s*process\.env\s*;/.test(s)) dolayli.push(`${g}: takma ad`);
  }
  const adresler = [...okunan].filter((a) => /^FUBER_/.test(a) && /ADRES|TABAN|_URL|ARAMA|SAHTE/.test(a)).sort();
  assert.ok(adresler.length >= 7, `adres değişkeni bulunamadı: ${adresler.join(', ')}`);
  assert.deepEqual(adresler.filter((a) => !(a in ADRES_DEGISKENLERI)), [], 'kapıda olmayan adres değişkeni');
  // Bilinen dolaylı okumalar (rapordaki ortam tablosunda): ayarlar.ts FUBER_SIR_* (ön ekle silinir), eklenti-kurucu.ts testKomutu
  // (FUBER_UV/GRAPHIFY/CC_YUKLEYICI_KOMUT — PROFIL_KANCALARI), eklenti-yonetim.ts (UV_TOOL_BIN_DIR, XDG_*), klasor-guveni.ts (APPDATA,
  // LOCALAPPDATA, SystemRoot, WINDIR, ProgramFiles…, ProgramData). Yeni bir dolaylı okuma bu listeyi değiştirmeyi (ve tabloyu) gerektirir.
  assert.deepEqual(dolayli.sort(), [
    'src/main/ayarlar.ts: process.env[…]', 'src/main/claudecode/eklenti-kurucu.ts: process.env[…]',
    'src/main/claudecode/eklenti-yonetim.ts: takma ad', 'src/main/claudecode/klasor-guveni.ts: takma ad',
  ]);
  for (const ad of ['FUBER_UV_KOMUT', 'FUBER_GRAPHIFY_KOMUT', 'FUBER_CC_YUKLEYICI_KOMUT']) assert.ok(PROFIL_KANCALARI.includes(ad), ad);
});

test('kablolama: ortam kapısı main.ts\'in İLK içe aktarımı; kapı modülü kararı uygular (siler + uyarır) ve yalnız saf kararı içe aktarır', () => {
  const ana = oku('src/main/main.ts');
  const ilk = /^import\s[^\n]*$/m.exec(ana)?.[0];
  assert.equal(ilk, "import './ortam-kapisi.js';", 'main.ts ilk içe aktarım');
  const kapi = oku('src/main/ortam-kapisi.ts');
  assert.match(kapi, /const karar = paketliOrtamKarari\(process\.env, paketli, paketli \? \{ varsayilanVeri: varsayilanVeri\(\), gercekYol \} : \{\}\);/, 'yollar yalnız kurulu uygulamada');
  // N-4: varsayılan = appData + ürün adı; getPath('userData') kapıda HİÇ sorulmaz (ilk soruluşta klasörü yaratır; --user-data-dir'e de uyar).
  assert.doesNotMatch(kapi, /getPath\('userData'\)/);
  assert.match(kapi, /try \{ return `\$\{app\.getPath\('appData'\)\}\\\\\$\{app\.getName\(\)\}`; \} catch \{ return ''; \}/);
  assert.equal((kapi.match(/app\.getPath\(/g) ?? []).length, (kapi.match(/try \{ return [^\n]*app\.getPath\(/g) ?? []).length, 'her getPath try içinde (çökertmez)');
  assert.match(kapi, /const gercekYol: GercekYol = \(p\) => \{ try \{ return fs\.realpathSync\.native\(p\); \} catch \{ return null; \} \};/);
  assert.match(kapi, /delete process\.env\[ad\]/);
  // Boşluklu FUBER_VERI (H6 yeniden inceleme 2): uygulama ham değeri kullanır (main.ts setPath, yollar.ts) → kapı kararından ÖNCE tek yerde
  // kırpılır; yalnız boşluksa silinir (ready öncesi çökme yok).
  const kirp = kapi.indexOf('process.env.FUBER_VERI.trim()');
  assert.ok(kirp > 0 && kirp < kapi.indexOf('paketliOrtamKarari(process.env'), 'FUBER_VERI karardan önce kırpılır');
  const ice =[...kapi.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(ice, ['electron', 'node:fs', '../shared/ortam-kapisi.js'], 'kapı başka yerel modül yüklemez (önce çalışması için)');
  // main.ts FUBER_VERI'yi kapıdan SONRA uygular.
  assert.ok(ana.indexOf("import './ortam-kapisi.js';") < ana.indexOf("app.setPath('userData'"));
});

test('kablolama (derlenmiş paket): kapı en üst düzeyde, main.ts gövdesinden hemen önce; modül yüklenirken okuyanlar tembel sarmalda', (t) => {
  // (Paketli uygulamada çalışma anı kanıtı: scripts/dev/kurulu-sigorta-denetimi.mjs.)
  const paket = path.join(kok, 'dist', 'main', 'main.js');
  if (!fs.existsSync(paket)) { t.skip('dist/main/main.js yok (npm run build) — paket sırası denetlenmedi'); return; }
  const js = fs.readFileSync(paket, 'utf8').replace(/\r\n/g, '\n');
  // Saf karar modülü başka modüllerce de içe aktarıldığı için tembel sarmalda olabilir: kapı onu kendi gövdesinin başında kurar (init_…();).
  const blok = /\/\/ src\/main\/ortam-kapisi\.ts\n(?:init_ortam_kapisi\(\);\n|import [^\n]*\n)*[\s\S]*?var (\w+) = paketliOrtamKarari\(process\.env, (\w+), \2 \? \{ varsayilanVeri: varsayilanVeri\(\), gercekYol \} : \{\}\);\nfor \(const ad of \1\.sil\) delete process\.env\[ad\];\n[\s\S]*?process\.exit\(1\);\n\}\n\n\/\/ src\/main\/main\.ts\n/.exec(js);
  assert.ok(blok, 'kapı main.ts gövdesinden hemen önce, sarmalsız');
  const whisper = /var init_whisper = __esm\(\{\n\s+"src\/main\/gunkaydi\/whisper\.ts"\(\) \{[\s\S]*?process\.env\.FUBER_WHISPER_TABAN \?\? null;/.exec(js);
  assert.ok(whisper, 'whisper.ts modül düzeyindeki okuma tembel sarmalda (kapıdan sonra kurulur)');
});

test('geliştirici araçları kurulu uygulamada kapalı: preload\'lu bütün pencereler devTools: !app.isPackaged; kod hiçbir yerde devtools açmaz', () => {
  assert.match(oku('src/main/pencere-ortak.ts'), /devTools: !app\.isPackaged/, 'ortakTercih (ana, ada, kulak, tarayıcı arayüzü)');
  assert.match(oku('src/main/imlec.ts'), /devTools: !app\.isPackaged/, 'imleç katmanı');
  const dosyalar: string[] = [];
  const gez = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const y = path.join(d, e.name); if (e.isDirectory()) gez(y); else if (/\.tsx?$/.test(e.name)) dosyalar.push(y); } };
  gez(path.join(kok, 'src', 'main'));
  const acan = dosyalar.filter((d) => /openDevTools|toggleDevTools/.test(fs.readFileSync(d, 'utf8'))).map((d) => path.relative(kok, d));
  assert.deepEqual(acan, []);
  for (const d of dosyalar) {
    const s = fs.readFileSync(d, 'utf8');
    for (const m of s.matchAll(/webPreferences:\s*\{([^}]*)\}/g)) {
      if (/preload:/.test(m[1])) assert.match(m[1], /devTools: !app\.isPackaged|\.\.\.ortakTercih\(\)/, `${path.relative(kok, d)}: preload'lu pencere devtools ayarsız`);
    }
  }
});
