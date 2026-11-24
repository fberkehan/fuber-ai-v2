// Paketli test koşularının ortak kapısı (0.12 H6 düzeltme turu 1, inceleme I-1): Playwright paketli uygulamaya ana sürece --inspect ile bağlanır;
// dağıtılan exe'de bu sigorta KAPALI, bu yüzden paketli testler DAĞITILMAYAN test kopyasında koşar (scripts/paket-test-kopyasi.mjs:
// <dağıtılan>-test). Kopya bayatsa (npm run dist yeniden derledi, kopya eskide kaldı) test ESKİ derlemeyi sınar ve "geçer" — bu kapı bunu
// durdurur. Açılışta doğrulanır:
//   1. exe bir test kopyası klasöründe (<ad>-test) ve kardeş dağıtılan klasör (<ad>) var;
//   2. iki klasörün resources/app.asar SHA-256'sı AYNI (kopya güncel derlemeden);
//   3. iki exe aynı boyda ve TAM 1 bayt farklı; o bayt sigorta telindeki EnableNodeCliInspectArguments (dağıtılanda kapalı, kopyada açık);
//   4. (düzeltme turu 2) exe dışındaki BÜTÜN dosyalar (resources/**, kaynak/, DLL'ler) aynı: liste, boy, SHA-256.
// Tutmazsa betik açık bir iletiyle durur ve ne yapılacağını yazar; kopyayı kendiliğinden ÜRETMEZ (hangi derlemenin sınandığı bilinçli kalsın).
// Kullanım: import { paketliTestExe } from '../paket-dogrula.mjs'; const exe = paketliTestExe(verilenYaDaNull, 'masaustu' | 'yonetim');
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIGORTA_ADLARI, sigortalariOku, teliBul } from './sigorta-teli.mjs';

export const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEST_EKI = '-test';
const INSPECT = SIGORTA_ADLARI.indexOf('EnableNodeCliInspectArguments');
/** Varsayılan paketli exe'ler: TEST KOPYASI (dağıtılan exe değil). */
export const VARSAYILAN_TEST_EXE = {
  masaustu: path.join(KOK, 'release', `win-unpacked${TEST_EKI}`, 'Fuber AI.exe'),
  yonetim: path.join(KOK, 'yonetim', 'release', `win-unpacked${TEST_EKI}`, 'Fuber Yonetim.exe'),
};
const URET = {
  masaustu: 'npm run dist && node scripts/paket-test-kopyasi.mjs',
  yonetim: 'npm run dist:yonetim && node scripts/paket-test-kopyasi.mjs yonetim/release/win-unpacked',
};

const sha256 = (dosya) => crypto.createHash('sha256').update(fs.readFileSync(dosya)).digest('hex');

/** Klasördeki bütün dosyalar: göreli yol (/) → { boyut, yol } (bağlantılar { bag: true }: kopya ağacında bağlantı beklenmez). */
function dosyaListesi(kok) {
  const out = new Map();
  const gez = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const y = path.join(d, e.name), r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) out.set(r, { bag: true });
      else if (e.isDirectory()) gez(y, r);
      else out.set(r, { boyut: fs.statSync(y).size, yol: y });
    }
  };
  gez(kok, '');
  return out;
}

/** Paketli test koşusunun ev klasörleri GEÇİCİ (düzeltme turu 2): USERPROFILE/HOME, APPDATA, LOCALAPPDATA `<veri>-ev\…` altına yönlenir ve
 *  klasörler yaratılır. Windows bilinen klasörleri (Electron'un appData'sı) %USERPROFILE%'tan çözüldüğü için kurulu uygulamanın varsayılan veri
 *  klasörü de geçici evin içine düşer: hiçbir koşu gerçek %APPDATA%\Fuber AI ya da %APPDATA%\Fuber Yönetim'i yaratmaz, okumaz.
 *  Ev, veri klasörünün KARDEŞİ (içinde değil): yalıtılmış profil kuralı FUBER_VERI'nin varsayılan klasörü içermesini de reddeder. Süreç
 *  biterken silinir. */
const geciciEvler = new Set();
process.on('exit', () => { for (const d of geciciEvler) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* kilitli */ } } });
export function geciciEv(veri) {
  const ev = `${path.resolve(veri)}-ev`;
  geciciEvler.add(ev);
  const roaming = path.join(ev, 'AppData', 'Roaming'), local = path.join(ev, 'AppData', 'Local');
  for (const d of [roaming, local, path.join(ev, 'Documents')]) fs.mkdirSync(d, { recursive: true });
  return { USERPROFILE: ev, HOME: ev, APPDATA: roaming, LOCALAPPDATA: local };
}

/** Test kopyasını doğrular; tutmazsa Error (ileti: neden + ne yapılmalı). Dönen: { kopyaExe, dagitilanExe, asarOzeti, farkKonumu }. */
export function testKopyasiDogrula(kopyaExe) {
  const exe = path.resolve(kopyaExe);
  const kopyaKlasor = path.dirname(exe);
  const ad = path.basename(kopyaKlasor);
  const coz = (uygulama) => `Ne yapılmalı: ${URET[uygulama]}  (kopya dağıtılan klasörden üretilir; sonra bu betiği yeniden çalıştır)`;
  const uygulama = /yonetim/i.test(path.basename(exe)) ? 'yonetim' : 'masaustu';
  if (!fs.existsSync(exe)) throw new Error(`TEST KOPYASI YOK: ${exe}\n  ${coz(uygulama)}`);
  if (!ad.endsWith(TEST_EKI)) {
    let ins = null;
    try { ins = sigortalariOku(exe).EnableNodeCliInspectArguments; } catch { /* Electron ikilisi değil */ }
    throw new Error(ins === 'kapalı'
      ? `DAĞITILAN EXE VERİLDİ: ${exe}\n  Bu exe'de --inspect sigortası kapalı; Playwright ana sürece bağlanamaz (zaman aşımı). Test kopyasını ver: ${path.join(path.dirname(kopyaKlasor), ad + TEST_EKI, path.basename(exe))}\n  ${coz(uygulama)}`
      : `TEST KOPYASI DEĞİL: ${exe} (klasör adı …${TEST_EKI} ile bitmeli; kardeşinde dağıtılan klasör olmalı)\n  ${coz(uygulama)}`);
  }
  const dagitilanKlasor = path.join(path.dirname(kopyaKlasor), ad.slice(0, -TEST_EKI.length));
  const dagitilanExe = path.join(dagitilanKlasor, path.basename(exe));
  if (!fs.existsSync(dagitilanExe)) throw new Error(`DAĞITILAN EXE YOK: ${dagitilanExe} (kopyanın karşılaştırılacağı derleme)\n  ${coz(uygulama)}`);
  const asarK = path.join(kopyaKlasor, 'resources', 'app.asar'), asarD = path.join(dagitilanKlasor, 'resources', 'app.asar');
  if (!fs.existsSync(asarK) || !fs.existsSync(asarD)) throw new Error(`app.asar eksik (${!fs.existsSync(asarK) ? asarK : asarD})\n  ${coz(uygulama)}`);
  const ozK = sha256(asarK), ozD = sha256(asarD);
  if (ozK !== ozD) throw new Error(`TEST KOPYASI BAYAT: app.asar dağıtılan derlemeden farklı (kopya ${ozK.slice(0, 12)}…, dağıtılan ${ozD.slice(0, 12)}…)\n  ${coz(uygulama)}`);
  // Düzeltme turu 2 (N-3): app.asar dışındaki her dosya da (resources/kaynak/**, app.asar.unpacked, elevate.exe, DLL'ler, paketler) aynı olmalı —
  // yalnız kaynak/ altını değiştiren bir derleme (ör. girdi yardımcısı) bayat kopyayla geçmesin. Göreli yol listesi, boy ve SHA-256.
  const exeAdi = path.basename(exe);
  const listeK = dosyaListesi(kopyaKlasor), listeD = dosyaListesi(dagitilanKlasor);
  listeK.delete(exeAdi); listeD.delete(exeAdi);
  const fazla = [...listeK.keys()].filter((r) => !listeD.has(r)), eksik = [...listeD.keys()].filter((r) => !listeK.has(r));
  if (fazla.length || eksik.length) throw new Error(`TEST KOPYASI BAYAT: dosya listesi farklı (kopyada fazla: ${fazla.slice(0, 3).join(', ') || '—'}; eksik: ${eksik.slice(0, 3).join(', ') || '—'})\n  ${coz(uygulama)}`);
  for (const [r, d] of listeD) {
    const k = listeK.get(r);
    if (d.bag || k.bag || d.boyut !== k.boyut || sha256(d.yol) !== sha256(k.yol)) throw new Error(`TEST KOPYASI BAYAT: ${r} dağıtılan derlemeden farklı\n  ${coz(uygulama)}`);
  }
  const a = fs.readFileSync(dagitilanExe), b = fs.readFileSync(exe);
  if (a.length !== b.length) throw new Error(`TEST KOPYASI BAYAT: exe boyutları farklı (${b.length} ≠ ${a.length})\n  ${coz(uygulama)}`);
  const farklar = [];
  for (let i = 0; i < a.length && farklar.length < 3; i++) if (a[i] !== b[i]) farklar.push(i);
  const tel = teliBul(a);
  const beklenen = tel.konum + INSPECT;
  if (farklar.length !== 1 || farklar[0] !== beklenen || a[beklenen] !== 48 || b[beklenen] !== 49) {
    throw new Error(`TEST KOPYASI BAYAT ya da BOZUK: exe farkı yalnız --inspect sigorta baytı olmalı (bulunan fark konumları: ${farklar.join(', ') || 'yok'}; beklenen ${beklenen})\n  ${coz(uygulama)}`);
  }
  return { kopyaExe: exe, dagitilanExe, asarOzeti: ozD, farkKonumu: beklenen };
}

/** Betik girişi: verilen yol (ya da varsayılan test kopyası) doğrulanır; tutmazsa ileti + çıkış 1. Dönen: doğrulanmış kopya exe'si. */
export function paketliTestExe(verilen, uygulama = 'masaustu', { betik = path.basename(process.argv[1] ?? 'betik') } = {}) {
  const exe = path.resolve(verilen || VARSAYILAN_TEST_EXE[uygulama]);
  try {
    const d = testKopyasiDogrula(exe);
    console.log(`[${betik}] paketli test kopyası doğrulandı: ${path.relative(KOK, d.kopyaExe)} (app.asar ${d.asarOzeti.slice(0, 12)}… ve öteki bütün dosyalar dağıtılanla aynı; exe farkı yalnız --inspect sigortası)`);
    return d.kopyaExe;
  } catch (e) {
    console.error(`[${betik}] DUR — ${e.message}`);
    process.exit(1);
  }
}
