// Olay yardımcısı duman testi (0.14 T20): GERÇEK resources/bin/fuber-olay.exe kısa süre açılır. Girdi gönderilmez, tuşa basılmaz, ses
// düzeyi değiştirilmez; klavye kancası yalnız aç/kapa komutuyla kurulup kaldırılır. Denetlenenler:
//   1. İlk satır {"t":"hazir","surum":1} (15 sn içinde).
//   2. {"k":"durum"} yanıtı: src/shared/sistem-olay.ts ile ayrışır, dokuz alanın hepsi var; yardımcının null olmayan her alanı
//      ayrıştırıcıdan da null olmadan geçer (biçim uyuşuyor).
//   2b. Medya (T21): medya oturumu yöneticisi gelince ilk `medya` satırı (çalan yoksa {"var":false}) gelir ve ayrışır; ardından
//      `durum.medya` dolu ve `var` mantık değeri. Oynatma başlatılmaz, duraklatılmaz, medya tuşu gönderilmez: geçerli medya eylemi
//      hiç yollanmaz; gerçek denetim (çal, ileri, duraklat) T28 elle denetim listesinde.
//   3. Bozuk, bilinmeyen ve eksik alanlı komut (geçersiz medya eylemi, sn'siz konum dahil; ikisi de oturuma ulaşmadan reddedilir)
//      tek `hata` satırı verir; yardımcı çökmez. 4096 baytı aşan satır bütünüyle atılır (kalanı ayrı komut sayılmaz, hata satırı çıkmaz).
//   4. {"k":"klavye","acik":true} → kanca iş parçacığı açılır (iş parçacığı sayısı artar), durum caps ve dil verir;
//      {"k":"klavye","acik":false} → iş parçacığı kapanır (sayı geri iner).
//   5. 30 sn boşta (klavye kapalı) işlemci süresi < 0,05 sn (Get-Process TotalProcessorTime farkı).
//   6. stdin kapanınca süreç 1 sn içinde, 0 koduyla çıkar.
//   7. (T28b) Son satır {"t":"sayac",…}: protokoldeki bütün sayaç adları tamsayı, başka alan yok; klavye kancası bir kez kuruldu, bir kez kaldırıldı.
//   8. (T28b) Tam ekran appbar'ları ekranda yer ayırmaz: her ekranın çalışma alanı yardımcı açıkken ve kapandıktan sonra açılıştakiyle aynı.
// Yardımcının yazdığı her satır ayrıştırıcıdan geçmeli; stderr boş kalmalı. Hata ya da kesintide süreç her durumda öldürülür (arka
// planda fuber-olay.exe kalmaz). Kullanım: node scripts/dev/olay-yardimcisi-duman.mjs [--bosta-sn 30]
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { olaySatiriAyristir, komutSatiri, SAYAC_ALANLARI } from '../../src/shared/sistem-olay.ts';

const kok = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXE = path.join(kok, 'resources/bin/fuber-olay.exe');
const bostaArg = process.argv.indexOf('--bosta-sn');
const BOSTA_SN = bostaArg > 0 ? Number(process.argv[bostaArg + 1]) : 30;
const BOSTA_SINIR_MS = 50;
const CIKIS_SINIR_MS = 1000;
const ALANLAR = ['guc', 'ag', 'sesAygiti', 'ses', 'parlaklik', 'caps', 'dil', 'tamEkran', 'medya'];

let hata = 0;
const kontrol = (ad, kosul, ayrinti = '') => {
  console.log(`${kosul ? '✔' : '✖'} ${ad}${ayrinti ? ` — ${ayrinti}` : ''}`);
  if (!kosul) hata++;
};
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
/** Konsola yazmak için: kapak (≤ 342 KB base64) kısaltılır. */
const medyaOzeti = (ham) => String(ham).replace(/"(data:image\/\w+;base64,)[A-Za-z0-9+/=]*"/g, (_, onek) => `"${onek}…"`);

/** Yardımcı sürecin işlemci süresi (ms) ve iş parçacığı sayısı (PowerShell Get-Process; yalnız bu betikte, ürün kodunda değil). */
function surecOlc(pid) {
  const cikti = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `$p = Get-Process -Id ${pid} -ErrorAction Stop; '{0}|{1}' -f $p.TotalProcessorTime.TotalMilliseconds, $p.Threads.Count`], { encoding: 'utf8', windowsHide: true }).trim();
  const [cpu, is] = cikti.split('|');
  return { cpuMs: Number(cpu.replace(',', '.')), is: Number(is) };
}

/** Her ekranın çalışma alanı (görev çubuğu ve appbar'lar dışı; yalnız okur). */
const calismaAlani = () => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  'Add-Type -AssemblyName System.Windows.Forms; ([System.Windows.Forms.Screen]::AllScreens | ForEach-Object { $_.DeviceName + "=" + $_.WorkingArea }) -join "; "'], { encoding: 'utf8', windowsHide: true }).trim();
const alanOnce = calismaAlani();

const cocuk = spawn(EXE, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
let cikti = null; // { kod, zaman }
cocuk.on('exit', (kod) => { cikti = { kod, zaman: performance.now() }; });
let stderr = '';
cocuk.stderr.on('data', (d) => { stderr += d; });

const satirlar = [];      // [{ ham, olay }]
const bekleyenler = [];   // { kosul, coz }
readline.createInterface({ input: cocuk.stdout }).on('line', (ham) => {
  const olay = olaySatiriAyristir(ham);
  satirlar.push({ ham, olay });
  for (const b of [...bekleyenler]) if (b.kosul(olay, ham)) { bekleyenler.splice(bekleyenler.indexOf(b), 1); b.coz({ ham, olay }); }
});
/** `kosul`u sağlayan SONRAKİ satırı bekler. */
function satirBekle(kosul, ms, ad) {
  return new Promise((coz, red) => {
    const b = { kosul, coz: (v) => { clearTimeout(z); coz(v); } };
    const z = setTimeout(() => { bekleyenler.splice(bekleyenler.indexOf(b), 1); red(new Error(`${ad}: ${ms} ms içinde gelmedi`)); }, ms);
    bekleyenler.push(b);
  });
}
const yaz = (satir) => cocuk.stdin.write(satir);
/** Komut gönderip `durum` yanıtını bekler (komutların sırayla işlendiğini de doğrular). */
async function durumIste() {
  const s = satirBekle((o) => o?.t === 'durum', 5000, 'durum');
  yaz(komutSatiri({ k: 'durum' }));
  return s;
}

try {
  // 1. hazir
  const ilkMedya = satirBekle((o, h) => o?.t === 'medya' || h.includes('"t":"medya"'), 15000, 'ilk medya satırı');
  const hazir = await satirBekle(() => true, 15000, 'ilk satır');
  kontrol('ilk satır hazir, sürüm 1', hazir.olay?.t === 'hazir' && hazir.olay.surum === 1, hazir.ham);

  const alanAcik = calismaAlani();
  kontrol('appbar ekranda yer ayırmaz (yardımcı açıkken çalışma alanı aynı)', alanAcik === alanOnce, alanAcik);

  // 2b. medya oturumu: ilk satır (yönetici gelince) ayrışır
  const m = await ilkMedya;
  kontrol('ilk medya satırı ayrışır', m.olay?.t === 'medya' && typeof m.olay.var === 'boolean', medyaOzeti(m.ham));

  // 2. durum biçimi
  const d = await durumIste();
  const ham = JSON.parse(d.ham);
  kontrol('durum ayrışır', d.olay?.t === 'durum', d.ham);
  kontrol('durum: dokuz alanın hepsi var', ALANLAR.every((a) => a in ham), Object.keys(ham).join(','));
  const kayip = ALANLAR.filter((a) => ham[a] !== null && d.olay?.[a] === null);
  kontrol('durum: yardımcının dolu alanları ayrıştırıcıdan geçer', kayip.length === 0, kayip.join(',') || 'kayıp yok');
  kontrol('durum: medya dolu (çalan yoksa var:false)', ham.medya !== null && typeof d.olay?.medya?.var === 'boolean', medyaOzeti(JSON.stringify(ham.medya)));
  kontrol('durum: tamEkran dolu (ön pencere ekranı)', d.olay?.tamEkran !== null, JSON.stringify(ham.tamEkran));
  console.log('  durum:', medyaOzeti(d.ham));

  // 3. hatalı komutlar: her biri tek hata satırı
  const hatalar = [];
  const toplayici = (o) => { if (o?.t === 'hata') hatalar.push(o.mesaj); return false; };
  bekleyenler.push({ kosul: toplayici, coz: () => {} });
  const HATALI = ['bozuk satır', '{"k":"bilinmeyen"}', '{"k":"ses","duzey":"yarım"}', '{"k":"klavye"}', '{"k":"klavye","acik":"evet"}',
    '{"k":"medya"}', '{"k":"medya","eylem":"durdur"}', '{"k":"medya","eylem":"konum"}'];
  for (const k of HATALI) yaz(`${k}\n`);
  await durumIste();
  bekleyenler.splice(bekleyenler.findIndex((b) => b.kosul === toplayici), 1);
  kontrol(`hatalı komutlar: ${HATALI.length} hata satırı, yardımcı ayakta`, hatalar.length === HATALI.length && cikti === null, hatalar.join(' | '));

  // 3b. Sınırı (4096 bayt) aşan satır bütünüyle atılır: kalanı bir sonraki satır sonunda ayrı komut sayılmaz (hata satırı yok).
  const uzunHatalar = [];
  const uzunToplayici = (o) => { if (o?.t === 'hata') uzunHatalar.push(o.mesaj); return false; };
  bekleyenler.push({ kosul: uzunToplayici, coz: () => {} });
  yaz(`{"k":"durum","dolgu":"${'x'.repeat(10_000)}"}\n`);
  const dUzun = await durumIste();
  bekleyenler.splice(bekleyenler.findIndex((b) => b.kosul === uzunToplayici), 1);
  kontrol('aşırı uzun satır sessizce atlanır, sonraki komut çalışır', uzunHatalar.length === 0 && dUzun.olay?.t === 'durum', uzunHatalar.join(' | ') || 'hata yok');

  // 4. klavye kancası aç/kapa (tuşa basılmaz)
  const once = surecOlc(cocuk.pid);
  yaz(komutSatiri({ k: 'klavye', acik: true }));
  const dAcik = await durumIste();
  const acik = surecOlc(cocuk.pid);
  kontrol('klavye açık: durum caps (mantık) ve dil verir', typeof dAcik.olay?.caps === 'boolean' && dAcik.olay?.dil !== null, `caps=${dAcik.olay?.caps} dil=${JSON.stringify(dAcik.olay?.dil)}`);
  kontrol('klavye açık: kanca iş parçacığı açıldı', acik.is > once.is, `iş parçacığı ${once.is} → ${acik.is}`);
  yaz(komutSatiri({ k: 'klavye', acik: true }));  // ikinci açma: yeni kanca kurulmaz
  await durumIste();
  const ikinci = surecOlc(cocuk.pid);
  yaz(komutSatiri({ k: 'klavye', acik: false }));
  await durumIste();
  const kapali = surecOlc(cocuk.pid);
  kontrol('klavye kapalı: kanca iş parçacığı kapandı', kapali.is < Math.max(acik.is, ikinci.is), `iş parçacığı ${acik.is} → (ikinci açma ${ikinci.is}) → ${kapali.is}`);
  const klavyeOlaylari = satirlar.filter((s) => s.olay?.t === 'caps' || s.olay?.t === 'dil');
  kontrol('kanca açılınca taban olay yazılmaz (yalnız değişim)', klavyeOlaylari.length === 0, klavyeOlaylari.map((s) => s.ham).join(' ') || 'olay yok');

  // 5. boşta işlemci süresi
  await bekle(1000);
  const oncekiSatir = satirlar.length;
  const b0 = surecOlc(cocuk.pid);
  console.log(`  ${BOSTA_SN} sn boşta bekleniyor…`);
  await bekle(BOSTA_SN * 1000);
  const b1 = surecOlc(cocuk.pid);
  const bostaMs = b1.cpuMs - b0.cpuMs;
  const bostaSatir = satirlar.slice(oncekiSatir).map((s) => s.ham);
  kontrol(`${BOSTA_SN} sn boşta işlemci süresi < ${BOSTA_SINIR_MS} ms`, bostaMs < BOSTA_SINIR_MS, `${bostaMs.toFixed(1)} ms (${(bostaMs / 1000).toFixed(4)} sn), iş parçacığı ${b1.is}, boşta gelen satır ${bostaSatir.length}${bostaSatir.length ? `: ${bostaSatir.join(' ')}` : ''}`);

  // 6. stdin kapanınca çıkış
  const t0 = performance.now();
  cocuk.stdin.end();
  for (let i = 0; i < 40 && cikti === null; i++) await bekle(50);
  const sure = cikti ? cikti.zaman - t0 : Infinity;
  kontrol(`stdin kapanınca ${CIKIS_SINIR_MS} ms içinde çıkar`, sure < CIKIS_SINIR_MS, cikti ? `${sure.toFixed(0)} ms, kod ${cikti.kod}` : 'çıkmadı');
  kontrol('çıkış kodu 0', cikti?.kod === 0);

  // 7. sayaç satırı (son satır; yalnız sayılar)
  const son = satirlar.at(-1);
  const sayacHam = son ? JSON.parse(son.ham) : {};
  const fazla = Object.keys(sayacHam).filter((a) => a !== 't' && !SAYAC_ALANLARI.includes(a));
  kontrol('son satır sayac: bütün adlar tamsayı, fazladan alan yok', son?.olay?.t === 'sayac' && SAYAC_ALANLARI.every((a) => Number.isInteger(sayacHam[a])) && fazla.length === 0, son?.ham ?? 'yok');
  kontrol('sayac: klavye kancası bir kez kuruldu ve kaldırıldı', sayacHam.klavyeKurulum === 1 && sayacHam.klavyeKaldirma === 1, `kurulum ${sayacHam.klavyeKurulum}, kaldırma ${sayacHam.klavyeKaldirma}`);
  const alanSonra = calismaAlani();
  kontrol('çıkıştan sonra çalışma alanı aynı', alanSonra === alanOnce, alanSonra);

  const gecersiz = satirlar.filter((s) => s.olay === null).map((s) => s.ham);
  kontrol('yardımcının her satırı ayrıştırıcıdan geçer', gecersiz.length === 0, gecersiz.join(' | ') || `${satirlar.length} satır`);
  kontrol('stderr boş', stderr.trim() === '', stderr.trim());
} catch (e) {
  kontrol('duman testi', false, e instanceof Error ? e.message : String(e));
} finally {
  if (cikti === null) {
    cocuk.kill();
    console.log('  (yardımcı öldürüldü)');
  }
}

console.log(hata === 0 ? '\nDUMAN TAMAM' : `\nDUMAN BAŞARISIZ (${hata})`);
process.exitCode = hata === 0 ? 0 : 1;
