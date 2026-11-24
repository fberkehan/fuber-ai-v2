// Görev 17 — kurulum başlatıcısı (native/fuber-kurulum) denetimi. Bu makineye HİÇBİR ŞEY KURULMAZ, gerçek Fuber AI'ye dokunulmaz:
//  1) başlatıcı PAKETSİZ derlenir; yanına iki sahte program: NSIS paketi yerine sahte-paket.exe, uygulama yerine
//     fuber-sahte-uygulama.exe (başlatıcı kuru kipte yalnız bu adla çalışan süreçlere bakar);
//  2) --onizleme: her ekran ve hata ekranı DrawToBitmap ile PNG (100 % ve 150 %) + temas.png; denetim.json'daki her yazı ≥ 12 px ve
//     altındaki en kötü zemine karşı ≥ 4,5:1 (scripts/dev/kontrast.mjs), her düğme ≥ 32 px; kare süresi (60 fps için < 16 ms);
//  3) güvenlik: içine (sahte) paket gömülü "dağıtılan" başlatıcı test bayraklarını 64 ile reddeder, verilen dosyaları silmez/ezmez;
//     geliştirme derlemesinde de "fuber-sahte-" önekli olmayan uygulama adı, --kuru'suz --gunluk/--rapor, --onizleme'siz --olcek reddedilir;
//  4) --kuru senaryoları (pencere ekran dışında, odak çalmaz, düğmelere kendisi basar): başarılı kurulum (+ verilen günlük
//     döndürülmez, eski geçici klasör temizlenir, kapanma engeli), hata → Tekrar dene, kalıcı hata (NSIS kodu günlükte), disk dolu,
//     uygulama açık ("--cikis" ile kendiliğinden çıkan (A10) / onu duymayıp kapat isteğiyle kapanan / hiç kapanmayıp sonlandırılan),
//     başka klasördeki aynı adlı süreç dokunulmaz, yükseltme, sürüm
//     uyuşmazlığı, paket başlatılamaz, eski Windows, tüm kullanıcılara kurulu eski sürüm, yönetici + başka hesap, yönetici + aynı
//     hesap (uygulama explorer üzerinden yetkisiz açılır); Görev 22: kurulum sonunda kabuk ikonları tazelenir (test klasöründeki
//     eski ikona bakan kısayolumuz exe'nin ikonuna döner, başka programınki değişmez; genel tazeleme kuru kipte atlanır).
// Çalıştır: node scripts/dev/kurulum-ekrani-onizle.mjs [çıktı-klasörü]   (varsayılan: %TEMP%\fuber-kurulum-ekrani)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { csDerle, kurulumDerle } from '../../native/derle.mjs';
import { kontrastOrani } from './kontrast.mjs';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cikti = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'fuber-kurulum-ekrani'));
fs.rmSync(cikti, { recursive: true, force: true });
fs.mkdirSync(cikti, { recursive: true });
const surum = JSON.parse(fs.readFileSync(path.join(KOK, 'package.json'), 'utf8')).version;
const uyu = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const yasiyor = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

let hata = 0;
const ozet = { cikti, ekranlar: null, senaryolar: [] };
const sonuc = (ok, ad, ayrinti = '') => {
  console.log(`${ok ? '✓' : '✗'} ${ad}${ayrinti ? ' — ' + ayrinti : ''}`);
  if (!ok) hata++;
  return ok;
};

// ── 1) Derleme ────────────────────────────────────────────────────────────────────────────────────────────────────
const bin = path.join(cikti, 'bin');
const baslatici = kurulumDerle({ cikti: path.join(bin, 'fuber-kurulum.exe'), bilgi: { surum } });
const sahteKlasor = path.join(KOK, 'native/fuber-kurulum/sahte');
const sahtePaket = csDerle({ kaynaklar: [path.join(sahteKlasor, 'SahtePaket.cs')], cikti: path.join(bin, 'sahte-paket.exe'), hedef: 'winexe' });
// Sahte uygulama sürüm taşır (başlatıcı kurulumdan sonra exe sürümünü gömülü sürümle karşılaştırır): biri doğru, biri eski.
const surumluUygulama = (ad, s, derleme = 0) => {
  const sb = path.join(cikti, `surum-${ad}.cs`);
  fs.writeFileSync(sb, `using System.Reflection;\n[assembly: AssemblyFileVersion("${s}.${derleme}")]\n[assembly: AssemblyInformationalVersion("${s}")]\n`);
  return csDerle({
    kaynaklar: [path.join(sahteKlasor, 'SahteUygulama.cs'), sb], cikti: path.join(bin, `${ad}.exe`), hedef: 'winexe',
    ref: ['System.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll'],
  });
};
const sahteUygulama = surumluUygulama('fuber-sahte-uygulama', surum);
const sahteEski = surumluUygulama('fuber-sahte-eski', '0.0.1');
// B1 (G17): dördüncü parçası (derleme numarası, BUILD_NUMBER) farklı aynı sürüm — doğrulama yalnız ana.ara.yama karşılaştırır.
const sahteDerleme = surumluUygulama('fuber-sahte-derleme', surum, 4321);
// "Dağıtılan" derleme: içine (sahte) paket gömülü. YALNIZ test bayraklarıyla çağrılır (hepsi reddedilmeli); bayraksız ASLA açılmaz.
const paketliBaslatici = kurulumDerle({ cikti: path.join(bin, 'fuber-kurulum-paketli.exe'), paket: sahtePaket, bilgi: { surum } });
sonuc([baslatici, sahtePaket, sahteUygulama, sahteEski, sahteDerleme, paketliBaslatici].every((f) => fs.existsSync(f)), 'derleme',
  `${fs.statSync(baslatici).size} bayt başlatıcı (paketsiz), paketli test derlemesi ${fs.statSync(paketliBaslatici).size} bayt`);

// ── 2) Önizleme + okunurluk ──────────────────────────────────────────────────────────────────────────────────────
const ekranKlasoru = path.join(cikti, 'ekranlar');
const on = spawnSync(baslatici, ['--onizleme', ekranKlasoru], { timeout: 180000, encoding: 'utf8' });
sonuc(on.status === 0, 'önizleme çizildi', `çıkış ${on.status}${on.stderr ? ' ' + on.stderr.trim() : ''}`);
const denetim = JSON.parse(fs.readFileSync(path.join(ekranKlasoru, 'denetim.json'), 'utf8'));
const satirlar = [];
let enKotu = { oran: Infinity };
let kucukYazi = [], dusukKontrast = [], kucukDugme = [];
for (const e of denetim.ekranlar) {
  let ekranEnKotu = Infinity, enKucuk = Infinity;
  for (const m of e.metinler) {
    const oran = kontrastOrani(m.renk, m.zemin);
    ekranEnKotu = Math.min(ekranEnKotu, oran);
    enKucuk = Math.min(enKucuk, m.px);
    if (oran < enKotu.oran) enKotu = { oran, metin: m.metin, dosya: e.dosya };
    if (m.px < 12) kucukYazi.push(`${e.dosya}: "${m.metin}" ${m.px}px`);
    if (oran < 4.5) dusukKontrast.push(`${e.dosya}: "${m.metin}" ${oran.toFixed(2)}:1`);
  }
  for (const d of e.dugmeler) if (d.boy < 32 || d.en < 32) kucukDugme.push(`${e.dosya}: ${d.metin} ${d.en}×${d.boy}`);
  satirlar.push(`   ${e.dosya.padEnd(30)} yazı ${String(e.metinler.length).padStart(2)}  en küçük ${enKucuk}px  en düşük kontrast ${ekranEnKotu.toFixed(2)}:1  düğme ${e.dugmeler.map((d) => d.boy).join('/')}`);
}
console.log(satirlar.join('\n'));
sonuc(kucukYazi.length === 0, 'her yazı ≥ 12 px', kucukYazi.join('; '));
sonuc(dusukKontrast.length === 0, 'her yazı ≥ 4,5:1', `en düşük ${enKotu.oran.toFixed(2)}:1 ("${enKotu.metin}", ${enKotu.dosya}) ${dusukKontrast.join('; ')}`);
sonuc(kucukDugme.length === 0, 'her düğme ≥ 32 px', kucukDugme.join('; '));
for (const k of denetim.kare) sonuc(k.ms < 16, `kare süresi ${k.olcek * 100} %`, `${k.ms} ms (60 fps bütçesi 16 ms)`);
ozet.ekranlar = { klasor: ekranKlasoru, temas: path.join(ekranKlasoru, 'temas.png'), enDusukKontrast: +enKotu.oran.toFixed(2), kare: denetim.kare };

// ── 3) Güvenlik: test bayrakları ─────────────────────────────────────────────────────────────────────────────────
const MB30 = 30 * 1024 * 1024;
{
  const dir = path.join(cikti, 'bayraklar');
  fs.mkdirSync(dir, { recursive: true });
  // Nöbetçi dosyalar: başlatıcı bunları silmemeli/ezmemeli (eski kusur: --gunluk ile verilen > 1 MB dosya siliniyordu).
  const buyuk = path.join(dir, 'buyuk-gunluk.log'), raporNobet = path.join(dir, 'rapor-nobetci.json');
  fs.writeFileSync(buyuk, Buffer.alloc(2 << 20, 0x61));
  fs.writeFileSync(raporNobet, 'NOBETCI');
  const yanlisAd = path.join(dir, 'baska-uygulama.exe');
  fs.copyFileSync(sahteUygulama, yanlisAd);
  const tmpHedef = path.join(dir, 'hedef');
  const DENEMELER = [
    ['paketli', paketliBaslatici, ['--kuru', sahtePaket, sahteUygulama, '--otomatik', '--gizli', '--hedef', tmpHedef, '--rapor', raporNobet, '--gunluk', buyuk]],
    ['paketli', paketliBaslatici, ['--kuru', sahtePaket, sahteUygulama, '--otomatik', '--gizli', '--hedef', tmpHedef, '--sahte', 'makine']],
    ['paketli', paketliBaslatici, ['--gunluk', buyuk]],
    ['paketli', paketliBaslatici, ['--rapor', raporNobet]],
    ['paketli', paketliBaslatici, ['--otomatik']],
    ['paketli', paketliBaslatici, ['--gizli']],
    ['geliştirme', baslatici, ['--kuru', sahtePaket, yanlisAd, '--otomatik', '--gizli', '--hedef', tmpHedef]],
    ['geliştirme', baslatici, ['--gunluk', buyuk]],
    ['geliştirme', baslatici, ['--rapor', raporNobet]],
    ['geliştirme', baslatici, ['--olcek', '1.5']],
  ];
  const kotu = [];
  for (const [tur, exe, arg] of DENEMELER) {
    const r = spawnSync(exe, arg, { timeout: 30000, encoding: 'utf8' });
    if (r.status !== 64) kotu.push(`${tur} ${arg.filter((a) => a.startsWith('--')).join(' ')} → ${r.status}`);
  }
  sonuc(kotu.length === 0, 'test bayrakları reddedildi (64)', kotu.length ? kotu.join('; ') : `${DENEMELER.length} çağrı: paketli derlemede --kuru/--otomatik/--gizli/--rapor/--gunluk/--sahte, geliştirmede önek dışı ad, --kuru'suz --gunluk/--rapor, --onizleme'siz --olcek`);
  sonuc(fs.existsSync(buyuk) && fs.statSync(buyuk).size === 2 << 20 && fs.readFileSync(raporNobet, 'utf8') === 'NOBETCI' && !fs.existsSync(tmpHedef),
    'verilen dosyalar silinmedi/ezilmedi, hiçbir şey kurulmadı');
}

// ── 4) Kuru senaryolar ───────────────────────────────────────────────────────────────────────────────────────────
const BASARILI = ['hos-geldin', 'kuruluyor', 'hazir'];
const VARSAYILAN_ISARET = path.join(os.tmpdir(), 'fuber-sahte-isaret'); // explorer'ın açtığı uygulama ortamımızı almaz
const bozukPaket = path.join(bin, 'bozuk-paket.exe');
fs.writeFileSync(bozukPaket, 'bu bir program değil');
const SENARYOLAR = [
  { ad: 'basarili', kip: 'basarili', gunlukOnce: 1.5 * (1 << 20), eskiGecici: true,
    b: { cikis: 0, ekranlar: BASARILI, acildi: true, durum: 'Dosyalar yerleştiriliyor…', acilis: 'kabuk', gunlukte: ['kapanma engeli açık', 'kapanma engeli kapalı', 'uygulama doğrulandı'] } },
  { ad: 'tekrar-dene', kip: 'bir-kez-hata', b: { cikis: 0, ekranlar: ['hos-geldin', 'kuruluyor', 'hata', 'kuruluyor', 'hazir'], acildi: true, gunlukte: 'çıkış kodu 2' } },
  { ad: 'kalici-hata', kip: 'hata', b: { cikis: 2, ekranlar: ['hos-geldin', 'kuruluyor', 'hata', 'kuruluyor', 'hata'], acildi: false, gunlukte: 'NSIS ayrıntı' } },
  { ad: 'disk-dolu', kip: 'basarili', boyut: 1e15, b: { cikis: 2, ekranlar: ['hos-geldin', 'hata', 'hata'], acildi: false, paketCalismaz: true, gunlukte: 'boş alan yetersiz' } },
  // A10 (son düzeltme, Ruling E): 0.8.0+ açık uygulamaya önce "--cikis" (ikinci örnek) gönderilir; kendiliğinden nazikçe çıkar.
  { ad: 'acik-cikis', kip: 'basarili', bekleyen: '--bekle-cikis', b: { cikis: 0, ekranlar: ['hos-geldin', 'uygulama-acik', 'kapatiliyor', 'kuruluyor', 'hazir'], acildi: true, kapatma: 'cikis', gunlukte: ['--cikis istendi', '--cikis ile kendiliğinden çıktı'] } },
  // "--cikis"i duymayan uygulama: birkaç saniye sonra eski yol (kapat isteği; o da olmazsa sonlandırma).
  { ad: 'acik-nazik', kip: 'basarili', bekleyen: '--bekle-nazik', b: { cikis: 0, ekranlar: ['hos-geldin', 'uygulama-acik', 'kapatiliyor', 'kuruluyor', 'hazir'], acildi: true, kapatma: 'nazik', gunlukte: ['--cikis istendi', 'kapat isteğine geçiliyor'] } },
  { ad: 'acik-inatci', kip: 'basarili', bekleyen: '--bekle-inatci', b: { cikis: 0, ekranlar: ['hos-geldin', 'uygulama-acik', 'kapatiliyor', 'kuruluyor', 'hazir'], acildi: true, kapatma: 'zorla', gunlukte: ['--cikis istendi', 'süreç sonlandırıldı'] } },
  { ad: 'yukseltme', kip: 'yukseltme', once: 30, b: { cikis: 0, ekranlar: BASARILI, acildi: true, durum: 'Önceki sürüm güncelleniyor…' } },
  { ad: 'baska-yerdeki-kopya', kip: 'basarili', bekleyen: '--bekle-nazik', bekleyenBaskaYerde: true,
    b: { cikis: 0, ekranlar: BASARILI, acildi: true, bekleyenKalir: true, gunlukte: 'dokunulmadı' } },
  { ad: 'surum-derleme-numarasi', kip: 'basarili', uygulama: sahteDerleme, b: { cikis: 0, ekranlar: BASARILI, acildi: true, gunlukte: 'uygulama doğrulandı' } },
  { ad: 'surum-uyusmaz', kip: 'basarili', uygulama: sahteEski,
    b: { cikis: 2, ekranlar: ['hos-geldin', 'kuruluyor', 'hata', 'kuruluyor', 'hata'], acildi: false, gunlukte: 'SÜRÜM UYUŞMUYOR' } },
  { ad: 'paket-baslamaz', kip: 'basarili', paket: bozukPaket,
    b: { cikis: 2, ekranlar: ['hos-geldin', 'kuruluyor', 'hata', 'kuruluyor', 'hata'], acildi: false, paketCalismaz: true, gunlukte: 'paket başlatılamadı' } },
  { ad: 'eski-windows', kip: 'basarili', sahte: 'windows=19041',
    b: { cikis: 2, ekranlar: ['hos-geldin', 'hata'], acildi: false, paketCalismaz: true, gunlukte: 'Windows desteklenmiyor' } },
  { ad: 'windows-21h2', kip: 'basarili', sahte: 'windows=19044', b: { cikis: 0, ekranlar: BASARILI, acildi: true } },
  { ad: 'makine-kurulumu', kip: 'basarili', sahte: 'makine',
    b: { cikis: 2, ekranlar: ['hos-geldin', 'hata', 'hata'], acildi: false, paketCalismaz: true, gunlukte: 'tüm kullanıcılara kurulu' } },
  { ad: 'yonetici-baska-hesap', kip: 'basarili', sahte: 'yonetici=farkli',
    b: { cikis: 2, ekranlar: ['hos-geldin', 'hata'], acildi: false, paketCalismaz: true, gunlukte: 'kabuğun hesabı FARKLI' } },
  { ad: 'yonetici-ayni-hesap', kip: 'basarili', sahte: 'yonetici=ayni', isaretVarsayilan: true,
    b: { cikis: 0, ekranlar: BASARILI, acildi: true, acilis: 'explorer', gunlukte: 'explorer üzerinden' } },
  // Görev 22 (K13): kurulum sonunda kabuk ikonları tazelenir. Kuru kipte YALNIZ hedefin yanındaki test klasörü (kisayollar/):
  // hedefi kurulu uygulama olup ikonu başka yere bakan kısayol exe'nin ikonuna çevrilir; başka programın kısayoluna dokunulmaz;
  // kabuğun genel tazelemesi (SHCNE_ASSOCCHANGED) kuru kipte atlanır (kullanıcının masaüstüne dokunulmaz).
  { ad: 'kisayol-ikonu', kip: 'basarili', kisayollar: true,
    b: { cikis: 0, ekranlar: BASARILI, acildi: true, ikonlar: 'kısayol 1, düzeltilen 1, kabuk ikon önbelleği kuru kipte atlandı', gunlukte: ['kısayol ikonu düzeltildi', 'kabuk ikonları: kısayol 1, düzeltilen 1'] } },
];

// Kısayol (.lnk) yaz/oku: Windows'un kendi WScript.Shell nesnesiyle (yalnız bu betiğin test klasöründe).
const kisayolPs = (komut, ortam) => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', komut], { env: { ...process.env, ...ortam }, encoding: 'utf8', timeout: 30000 });
const kisayolYaz = (lnk, hedef, ikon) => kisayolPs('$k = (New-Object -ComObject WScript.Shell).CreateShortcut($env:K_LNK); $k.TargetPath = $env:K_HEDEF; $k.IconLocation = $env:K_IKON; $k.Save()', { K_LNK: lnk, K_HEDEF: hedef, K_IKON: ikon });
const kisayolIkonu = (lnk) => (kisayolPs('(New-Object -ComObject WScript.Shell).CreateShortcut($env:K_LNK).IconLocation', { K_LNK: lnk }).stdout ?? '').trim();

// Eski geçici klasör temizliği için: bir günden eski ve taze iki sahte klasör (yalnız bizim önekimiz).
const eskiGecici = path.join(os.tmpdir(), 'FuberAIKurulum-test-eski'), yeniGecici = path.join(os.tmpdir(), 'FuberAIKurulum-test-yeni');

for (const sn of SENARYOLAR) {
  const dir = path.join(cikti, 'kuru', sn.ad);
  const hedef = path.join(dir, 'hedef'), isaret = path.join(dir, 'isaret');
  fs.mkdirSync(isaret, { recursive: true });
  if (sn.once) {
    fs.mkdirSync(hedef, { recursive: true });
    for (let i = 0; i < sn.once; i++) fs.writeFileSync(path.join(hedef, `eski-${i}.bin`), Buffer.alloc(1 << 20));
  }
  if (sn.isaretVarsayilan) fs.rmSync(VARSAYILAN_ISARET, { recursive: true, force: true });
  if (sn.eskiGecici) {
    for (const d of [eskiGecici, yeniGecici]) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'x.bin'), 'x'); }
    const ikiGunOnce = new Date(Date.now() - 2 * 86400000);
    fs.utimesSync(eskiGecici, ikiGunOnce, ikiGunOnce);
  }
  const uygulama = sn.uygulama ?? sahteUygulama;
  // Kısayol klasörü (kuru kipte başlatıcının baktığı tek yer: hedefin yanındaki "kisayollar"): bizimki eski ikona bakıyor, başkasınınki
  // kendi ikonunda kalmalı.
  const kisayolKlasoru = path.join(dir, 'kisayollar');
  const bizimLnk = path.join(kisayolKlasoru, 'Fuber AI.lnk'), baskaLnk = path.join(kisayolKlasoru, 'Not Defteri.lnk');
  if (sn.kisayollar) {
    fs.mkdirSync(kisayolKlasoru, { recursive: true });
    kisayolYaz(bizimLnk, uygulama, 'C:\\Windows\\System32\\shell32.dll,3');
    kisayolYaz(baskaLnk, 'C:\\Windows\\System32\\notepad.exe', 'C:\\Windows\\System32\\shell32.dll,4');
  }
  const env = { ...process.env, FUBER_SAHTE_ISARET: isaret, FUBER_SAHTE_KIP: sn.kip };
  let bekleyen = null;
  if (sn.bekleyen) {
    let exe = sahteUygulama;
    if (sn.bekleyenBaskaYerde) {
      // Aynı ad, başka klasör (geliştirme/taşınabilir kopya gibi): başlatıcı dokunmamalı.
      exe = path.join(dir, 'baska-yer', path.basename(sahteUygulama));
      fs.mkdirSync(path.dirname(exe), { recursive: true });
      fs.copyFileSync(sahteUygulama, exe);
    }
    bekleyen = spawn(exe, [sn.bekleyen], { env, stdio: 'ignore', detached: true });
    bekleyen.unref();
    for (let i = 0; i < 50 && !fs.existsSync(path.join(isaret, 'uygulama-calisiyor.txt')); i++) uyu(100);
  }
  const rapor = path.join(dir, 'rapor.json'), gunluk = path.join(dir, 'gunluk.log');
  if (sn.gunlukOnce) fs.writeFileSync(gunluk, Buffer.alloc(sn.gunlukOnce, 0x2e));
  const t0 = Date.now();
  const arg = ['--kuru', sn.paket ?? sahtePaket, uygulama, '--hedef', hedef, '--boyut', String(sn.boyut ?? MB30),
    '--otomatik', '--gizli', '--rapor', rapor, '--gunluk', gunluk];
  if (sn.sahte) arg.push('--sahte', sn.sahte);
  const r = spawnSync(baslatici, arg, { env, timeout: 120000, encoding: 'utf8' });
  const sure = Date.now() - t0;
  const rap = fs.existsSync(rapor) ? JSON.parse(fs.readFileSync(rapor, 'utf8')) : {};
  const glk = fs.existsSync(gunluk) ? fs.readFileSync(gunluk, 'utf8') : '';
  const paketSatiri = fs.existsSync(path.join(isaret, 'paket-calisti.txt')) ? fs.readFileSync(path.join(isaret, 'paket-calisti.txt'), 'utf8') : '';
  const acilmaIsareti = path.join(sn.isaretVarsayilan ? VARSAYILAN_ISARET : isaret, 'uygulama-acildi.txt');
  if (sn.isaretVarsayilan) for (let i = 0; i < 50 && !fs.existsSync(acilmaIsareti); i++) uyu(100); // explorer eşzamansız açar
  const acildi = fs.existsSync(acilmaIsareti);
  // ilerleme: her kurulum denemesi ayrı dizi (Tekrar dene yeni deneme başlatır, çubuk sıfırdan akar).
  const denemeler = rap.ilerleme ?? [];
  const il = denemeler.at(-1) ?? [];
  const monoton = denemeler.every((d) => d.every((v, i) => i === 0 || v >= d[i - 1] - 1e-9));
  const b = sn.b;
  const kontroller = [
    [r.status === b.cikis, `çıkış ${r.status} (beklenen ${b.cikis})`],
    [JSON.stringify(rap.ekranlar) === JSON.stringify(b.ekranlar), `ekranlar ${JSON.stringify(rap.ekranlar)}`],
    [acildi === b.acildi && !!rap.uygulamaAcildi === b.acildi, `uygulama açıldı: ${acildi}`],
    [b.paketCalismaz ? paketSatiri === '' : (paketSatiri.includes(' /S ') && paketSatiri.includes('/D=' + hedef)), b.paketCalismaz ? 'paket çalışmadı' : 'paket /S /D=<hedef> ile çalıştı'],
    [monoton, `ilerleme hiçbir denemede geri gitmedi (${denemeler.length} deneme)`],
    [!b.acildi || il.at(-1) >= 0.999, `ilerleme sonu ${il.at(-1) ?? '-'}`],
    [rap.geciciSilindi === true && (!rap.gecici || !fs.existsSync(rap.gecici)), 'geçici paket klasörü silindi'],
  ];
  if (b.durum) kontroller.push([(rap.durumlar ?? []).includes(b.durum), `durum satırı "${b.durum}"`]);
  // Görev 22: her başarılı kurulumda kabuk ikonları tazelenir (kuru kipte genel tazeleme atlanır).
  if (b.acildi) kontroller.push([String(rap.ikonlar ?? '').startsWith('kısayol ') && String(rap.ikonlar).endsWith('kuru kipte atlandı'), `kabuk ikonları: ${rap.ikonlar}`]);
  if (b.ikonlar) kontroller.push([rap.ikonlar === b.ikonlar, `ikon özeti "${rap.ikonlar}"`]);
  if (sn.kisayollar) {
    const bizim = kisayolIkonu(bizimLnk), baska = kisayolIkonu(baskaLnk);
    kontroller.push([bizim.toLowerCase() === `${uygulama},0`.toLowerCase(), `bizim kısayol exe'nin ikonuna çevrildi (${bizim})`]);
    kontroller.push([baska.toLowerCase() === 'c:\\windows\\system32\\shell32.dll,4', `başka programın kısayoluna dokunulmadı (${baska})`]);
  }
  for (const g of [].concat(b.gunlukte ?? [])) kontroller.push([glk.includes(g), `günlükte "${g}"`]);
  if (b.kapatma) kontroller.push([rap.kapatma === b.kapatma, `kapatma: ${rap.kapatma}`]);
  if (b.acilis) kontroller.push([rap.acilis === b.acilis, `açılış yolu: ${rap.acilis}`]);
  if (sn.gunlukOnce) kontroller.push([fs.statSync(gunluk).size > sn.gunlukOnce, `verilen günlük döndürülmedi (${fs.statSync(gunluk).size} bayt, sonuna eklendi)`]);
  if (sn.eskiGecici) {
    kontroller.push([!fs.existsSync(eskiGecici) && fs.existsSync(yeniGecici), 'bir günden eski geçici klasör silindi, tazesi kaldı']);
    fs.rmSync(eskiGecici, { recursive: true, force: true });
    fs.rmSync(yeniGecici, { recursive: true, force: true });
  }
  if (bekleyen) {
    uyu(200);
    if (b.bekleyenKalir) {
      kontroller.push([yasiyor(bekleyen.pid) && !fs.existsSync(path.join(isaret, 'uygulama-nazik-kapandi.txt')), 'başka klasördeki aynı adlı süreç çalışmaya devam ediyor']);
    } else {
      kontroller.push([!yasiyor(bekleyen.pid), 'açık sahte uygulama kapandı']);
      kontroller.push([fs.existsSync(path.join(isaret, 'uygulama-nazik-kapandi.txt')) === (b.kapatma === 'nazik'), b.kapatma === 'nazik' ? 'pencere kapat isteğiyle kapandı' : b.kapatma === 'cikis' ? 'kapat isteği gerekmedi' : 'kapat isteğini yok saydı → sonlandırıldı']);
      // A10: başlatıcı 0.8.0+ uygulamaya "--cikis" ikinci örneğini çalıştırdı; yalnız onu duyan uygulama kendiliğinden çıktı.
      kontroller.push([fs.existsSync(path.join(isaret, 'cikis-istendi.txt')), '"--cikis" ikinci örneği çalıştırıldı']);
      kontroller.push([fs.existsSync(path.join(isaret, 'uygulama-cikis-ile-kapandi.txt')) === (b.kapatma === 'cikis'), b.kapatma === 'cikis' ? '--cikis ile kendiliğinden çıktı' : '--cikis\'i duymadı (eski yol)']);
    }
    if (yasiyor(bekleyen.pid)) try { process.kill(bekleyen.pid); } catch { /* yok */ }
  }
  const basarisiz = kontroller.filter(([ok]) => !ok).map(([, m]) => m);
  sonuc(basarisiz.length === 0, `kuru: ${sn.ad}`, basarisiz.length ? basarisiz.join('; ') : `${(sure / 1000).toFixed(1)} sn, ${rap.ekranlar?.join(' → ')}${rap.kapatma ? ', kapatma ' + rap.kapatma : ''}, ilerleme ${il.length} örnek`);
  ozet.senaryolar.push({ ad: sn.ad, cikis: r.status, sureMs: sure, ekranlar: rap.ekranlar, kapatma: rap.kapatma, durumlar: rap.durumlar, ilerlemeOrnek: il.length, gunluk, rapor, basarisiz });
}

fs.writeFileSync(path.join(cikti, 'ozet.json'), JSON.stringify(ozet, null, 2));
console.log(`\n${hata ? '✗ ' + hata + ' denetim başarısız' : '✓ hepsi geçti'} — ${cikti}\n  temas sayfası: ${ozet.ekranlar.temas}`);
console.log(`  canlı deneme (görünür pencere, gerçek kurulum YOK; hedef %TEMP%\\fuber-kuru-hedef):\n    "${baslatici}" --kuru "${sahtePaket}" "${sahteUygulama}" --boyut ${MB30}`);
process.exit(hata ? 1 : 0);
