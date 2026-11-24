// ── Veri yaşam döngüsü: "Yeni başla", "Verilerimi sil", "Eski yedekleri sil", "Tekrar hoş geldin" özeti (0.11 G2; spec §2) ───────────────
// Saf + fs; kök PARAMETREYLE gelir (yollar.ts okunmaz): testler geçici dizinde çalışır, gerçek %APPDATA%\Fuber AI'ye hiçbir test dokunmaz
// (tests/veri-temizlik.test.ts). Uygulama kökü main.ts'ten verir.
//  · İstek (veriIslemiIste): arayüz "Yeni başla" ya da "Verilerimi sil" deyince kökte `.veri-islemi` işareti yazılır, uygulama yeniden açılır.
//  · Uygulama (bekleyenVeriIsleminiUygula): bir sonraki açılışta, ayarlar ve veritabanı AÇILMADAN (açık dosya taşınmaz/silinmez; spec
//    kararı) — main.ts'in en başında, yalnız birinci örnekte. İşaret işlemden ÖNCE silinir: işlem en çok bir kez yapılır (işaret
//    silinemezse hiçbir şey yapılmaz — yeni profil her açılışta yeniden silinmesin). Yeniden kurulum işareti de silinir.
//      - yeni-basla: KISISEL + EK_KISISEL `yedekler/<YYYY-AA-GG-SS-DD>/` altına TAŞINIR (silinmez). İndirilen yapay zekâ (yerel/, whisper/)
//        ve Electron'un önbelleği yerinde kalır.
//      - sil: kökün içindeki her şey silinir; `yerelDahil` değilse yerel/ ve whisper/ kalır. Karar (brief'teki seçim): Electron'un kendi
//        klasörleri de silinir — Chromium tarayıcı oturumlarını (Partitions), çerezleri ve depolamayı kendi klasörlerinde tutar ve
//        "Verilerimi sil" WhatsApp/tarayıcı oturumlarının gittiğini söyler; işlem Chromium bu klasörleri açmadan yapılır. Yalnız açılışta
//        Chromium'un tuttuğu iki çalışma dosyası (lockfile: tek örnek kilidi; Local State: bu kurulumun şifreleme anahtarı) dokunulmaz —
//        kişisel veri taşımazlar.
//  · Bağlantılar (sembolik bağlantı, Windows dizin bağlantısı/junction) HİÇ izlenmez: kökün kendi girdisi bağlantıysa atlanır (taşınmaz,
//    silinmez — ör. kullanıcının başka diske taşıdığı yerel/); silinen bir klasörün içindeki bağlantının yalnız KENDİSİ kalkar, hedefine
//    dokunulmaz. Her yol kökün içinde olmalı; göreli kök ya da sürücü kökü reddedilir.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** "Yeni başla"da yedeğe taşınan kişisel dosyalar (spec §2; sözleşmedeki liste). */
export const KISISEL: readonly string[] = ['fuber.db', 'fuber.db-wal', 'fuber.db-shm', 'ayarlar.json', 'ayarlar.json.bak', 'sirlar.json', 'sirlar.json.bak', 'whatsapp-oturum', 'tarayici', 'gunluk'];
/**
 * Karar (G2): kökte duran öteki kişisel durum da yedeğe gider — yeni başlayan profil eskisini görmesin: Fuber Tarayıcı'nın giriş yapılmış
 * oturumları (Chromium'un kalıcı bölümü `Partitions/fuber-tarayici`; spec'teki `tarayici/` aslında bu), ziyaret edilen siteler, Claude Code
 * klasör güveni kararları, Claude Code oturum dizini, pano önbelleği (şehir, haberler) ve Etkinlik'in gün kaydı. 0.14 T25 düzeltme turu 1: şarkı sözü
 * önbelleği (dinlenen parçalar; main/soz.ts) ve yedeği de. 0.14 son inceleme I2: Raf listesi (main/raf.ts), MCP araç listesi ve katalog önbelleği
 * (entegrasyon/mcp-katalog.ts) ve jsonYaz'ın .bak eşleri. Odak ve Yapılacaklar fuber.db'dedir (veritabanıyla birlikte taşınır). 12 Kas: geçmiş toplantılar (`toplantilar/`).
 */
export const EK_KISISEL: readonly string[] = [
  'Partitions', 'tarayici-siteler.json', 'tarayici-siteler.json.bak', 'claude-klasor-guveni.json', 'claude-oturumlar.json', 'pano-onbellek.json', 'pano-onbellek.json.bak',
  'beyin-gunu.json', 'soz-onbellek.json', 'soz-onbellek.json.bak',
  'raf.json', 'raf.json.bak', 'mcp-araclar.json', 'mcp-araclar.json.bak', 'mcp-katalog.json', 'mcp-katalog.json.bak',
  // 12 Kas: Toplantı modunun geçmiş toplantıları (döküm, çeviri, özet; main/toplanti/depo.ts). "Verilerimi sil" kökle birlikte siler.
  'toplantilar',
];
/** İndirilmiş yapay zekâ (llama + GGUF modeller, Whisper, Fuber'in yedek sesi `ses/piper`): kişisel veri değil, GB'larca — yalnız seçilince
 *  silinir; "≈N GB" bunların toplamı (G2 düzeltme turu 1, K4: ses modeli de). */
export const INDIRILEN: readonly string[] = ['yerel', 'whisper', 'ses'];
/** "Sil"de dokunulmayan Chromium çalışma dosyaları (açılışta tutulur; kişisel veri yok). */
export const CALISMA_DOSYALARI: readonly string[] = ['lockfile', 'Local State'];
export const YEDEKLER = 'yedekler';
/** Kaldırıcı "verilerim kalsın" deyince yazar (build/kurulum.nsh): açılışta "Tekrar hoş geldin". */
export const ISARET_YENIDEN_KURULUM = '.yeniden-kurulum';
/** Bekleyen veri işlemi (JSON): { tur: 'yeni-basla' | 'sil'; yerelDahil?: boolean; zaman: string }. */
export const ISARET_VERI_ISLEMI = '.veri-islemi';

export type VeriIslemiTuru = 'yeni-basla' | 'sil';
export interface VeriIslemi { tur: VeriIslemiTuru; yerelDahil?: boolean }
export interface VeriIslemiSonucu {
  yapildi: VeriIslemiTuru | null;
  /** yeni-basla: yedeğin klasörü (mutlak). */
  yedek?: string;
  /** Atlanan (bağlantı) ya da taşınamayan/silinemeyen girdiler (kökten göreli; günlük için). */
  atlanan?: string[];
}
export interface VeriOzeti { hafiza: number; sohbet: number; sonKullanim: string | null; hesapEposta: string | null }
/** Dosya işlemleri (yeniden adlandırma, dosya silme). Varsayılan gerçek fs; testler bir hatayı taklit etmek için değiştirir (K3). */
export interface DosyaIslemleri { yeniAd: (a: string, b: string) => void; sil: (p: string) => void }
const GERCEK_ISLEMLER: DosyaIslemleri = { yeniAd: (a, b) => fs.renameSync(a, b), sil: (p) => fs.unlinkSync(p) };
/** SQLite üçlüsü (G2 düzeltme turu 1, K3): eşler (-wal, -shm) veritabanından ÖNCE; eşlerden biri taşınamaz/silinemezse veritabanına
 *  dokunulmaz — üçlü ayrılırsa eski WAL yeni profilin boş veritabanında açılışta yeniden oynatılır (eski sayfalar karışır). */
const VT = 'fuber.db';
const VT_ESLERI: readonly string[] = ['fuber.db-wal', 'fuber.db-shm'];
const VT_UCLUSU = new Set<string>([VT, ...VT_ESLERI]);

/** Kök güvenli mi: mutlak ve bir sürücü/dosya sistemi kökü değil. */
function kokGecerli(kok: string): boolean {
  if (typeof kok !== 'string' || !kok || !path.isAbsolute(kok)) return false;
  const r = path.resolve(kok);
  return path.parse(r).root !== r;
}
/** `p` kökün İÇİNDE mi (kökün kendisi değil). */
function icinde(kok: string, p: string): boolean {
  const g = path.relative(path.resolve(kok), path.resolve(p));
  return Boolean(g) && !g.startsWith('..') && !path.isAbsolute(g);
}
const lstat = (p: string): fs.Stats | null => { try { return fs.lstatSync(p); } catch { return null; } };

/** Windows'ta virüs koruması/dizin tarayıcısı bir dosyayı kısa süre tutabilir: kilit hatalarında kısa beklemeyle yeniden dener. */
const KILIT = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY']);
const uyku = (ms: number): void => {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch {
    const son = Date.now() + ms; // Atomics.wait'e izin vermeyen ortam: kısa meşgul bekleme (yalnız kilit hatasında, açılışta)
    while (Date.now() < son) { /* bekle */ }
  }
};
function dene(f: () => void, kez = 8): void {
  for (let i = 0; ; i++) {
    try { f(); return; } catch (e) {
      if (i >= kez - 1 || !KILIT.has((e as NodeJS.ErrnoException).code ?? '')) throw e;
      uyku(120);
    }
  }
}

/** Bağlantının yalnız kendisini kaldırır (hedefine dokunmaz): dosya bağlantısı unlink, dizin bağlantısı/junction rmdir. */
function baglantiyiKaldir(p: string): void {
  try { fs.unlinkSync(p); } catch { fs.rmdirSync(p); }
}

/** Bağlantı izlemeden siler; tamamen kalktıysa true. Hatalar `atlanan`a. */
function guvenliSil(kok: string, p: string, atlanan: string[]): boolean {
  if (!icinde(kok, p)) { atlanan.push(p); return false; }
  const s = lstat(p);
  if (!s) return true;
  try {
    if (s.isSymbolicLink()) { dene(() => baglantiyiKaldir(p)); return true; }
    if (s.isDirectory()) {
      let tamam = true;
      for (const ad of fs.readdirSync(p)) tamam = guvenliSil(kok, path.join(p, ad), atlanan) && tamam;
      if (!tamam) return false;
      dene(() => fs.rmdirSync(p));
      return true;
    }
    dene(() => fs.unlinkSync(p));
    return true;
  } catch {
    atlanan.push(path.relative(kok, p));
    return false;
  }
}

/** Yerel saatle YYYY-AA-GG-SS-DD. */
function zamanAdi(d: Date): string {
  const iki = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${iki(d.getMonth() + 1)}-${iki(d.getDate())}-${iki(d.getHours())}-${iki(d.getMinutes())}`;
}

/** Arayüzün isteği: işaret atomik yazılır (geçici dosya + yeniden adlandırma). Uygulama hemen ardından yeniden açılır. */
export function veriIslemiIste(kok: string, islem: VeriIslemi): void {
  if (!kokGecerli(kok)) throw new Error('Veri klasörü geçersiz.');
  if (islem?.tur !== 'yeni-basla' && islem?.tur !== 'sil') throw new Error('Bilinmeyen veri işlemi.');
  fs.mkdirSync(kok, { recursive: true });
  const govde = { tur: islem.tur, ...(islem.tur === 'sil' ? { yerelDahil: islem.yerelDahil === true } : {}), zaman: new Date().toISOString() };
  const hedef = path.join(kok, ISARET_VERI_ISLEMI);
  const gecici = `${hedef}.${process.pid}.tmp`;
  fs.writeFileSync(gecici, JSON.stringify(govde));
  dene(() => fs.renameSync(gecici, hedef));
}

/** İşareti okur ve doğrular; yoksa/bağlantıysa null, bozuksa 'bozuk'. */
function islemOku(kok: string): VeriIslemi | 'bozuk' | null {
  const p = path.join(kok, ISARET_VERI_ISLEMI);
  const s = lstat(p);
  if (!s) return null;
  if (!s.isFile()) return 'bozuk';
  try {
    const o = JSON.parse(fs.readFileSync(p, 'utf8')) as { tur?: unknown; yerelDahil?: unknown };
    if (o?.tur === 'yeni-basla') return { tur: 'yeni-basla' };
    if (o?.tur === 'sil') return { tur: 'sil', yerelDahil: o.yerelDahil === true };
    return 'bozuk';
  } catch { return 'bozuk'; }
}

/**
 * Bekleyen veri işlemini uygular (main.ts, açılışın en başında). İşlem yoksa hiçbir şeye dokunmaz. Bkz. dosya başı.
 * `simdi`: yedek klasörünün adı (testlerde sabit). `islemler`: dosya işlemleri (testte hata taklidi; K3).
 */
export function bekleyenVeriIsleminiUygula(kok: string, simdi: Date = new Date(), islemler: DosyaIslemleri = GERCEK_ISLEMLER): VeriIslemiSonucu {
  if (!kokGecerli(kok) || !lstat(kok)?.isDirectory()) return { yapildi: null };
  const islem = islemOku(kok);
  if (!islem) return { yapildi: null };
  // İşaret ÖNCE kalkar: işlem en çok bir kez. Silinemezse (kilitli/izin) hiçbir şey yapılmaz.
  try { dene(() => fs.unlinkSync(path.join(kok, ISARET_VERI_ISLEMI))); } catch { return { yapildi: null }; }
  if (islem === 'bozuk') return { yapildi: null };
  const atlanan: string[] = [];
  try { dene(() => fs.unlinkSync(path.join(kok, ISARET_YENIDEN_KURULUM))); } catch { /* yoktu */ }

  if (islem.tur === 'yeni-basla') {
    const yedekKoku = path.join(kok, YEDEKLER);
    if (lstat(yedekKoku)?.isSymbolicLink()) return { yapildi: 'yeni-basla', atlanan: [YEDEKLER] }; // bağlantılı yedek klasörüne taşınmaz
    fs.mkdirSync(yedekKoku, { recursive: true });
    const ad = zamanAdi(simdi);
    let yedek = path.join(yedekKoku, ad);
    for (let n = 2; lstat(yedek); n++) yedek = path.join(yedekKoku, `${ad}-${n}`);
    fs.mkdirSync(yedek);
    const tasi = (ad2: string, a: string, b: string) => dene(() => islemler.yeniAd(path.join(a, ad2), path.join(b, ad2)));
    // SQLite üçlüsü önce ve birlikte (K3): eşler, sonra veritabanı; biri taşınamazsa taşınan eşler geri alınır, üçlü kökte kalır.
    const tasinan: string[] = [];
    let vtKalsin = false;
    for (const ad2 of [...VT_ESLERI, VT]) {
      const s = lstat(path.join(kok, ad2));
      if (!s) continue;
      if (s.isSymbolicLink()) { vtKalsin = true; break; }
      try { tasi(ad2, kok, yedek); tasinan.push(ad2); } catch { vtKalsin = true; break; }
    }
    if (vtKalsin) {
      for (const ad2 of tasinan) { try { tasi(ad2, yedek, kok); } catch { atlanan.push(`${YEDEKLER}/${path.basename(yedek)}/${ad2}`); } }
      atlanan.push(VT);
    }
    for (const ad2 of [...KISISEL, ...EK_KISISEL]) {
      if (VT_UCLUSU.has(ad2)) continue;
      const kaynak = path.join(kok, ad2);
      const s = lstat(kaynak);
      if (!s) continue;
      if (s.isSymbolicLink() || !icinde(kok, kaynak)) { atlanan.push(ad2); continue; }
      try { tasi(ad2, kok, yedek); } catch { atlanan.push(ad2); }
    }
    return { yapildi: 'yeni-basla', yedek, ...(atlanan.length ? { atlanan } : {}) };
  }

  // SQLite üçlüsü önce (K3): eşler silinemezse veritabanı korunur.
  let vtKalsin = false;
  for (const ad of VT_ESLERI) {
    const p = path.join(kok, ad);
    const s = lstat(p);
    if (!s) continue;
    if (s.isSymbolicLink() || !s.isFile()) { atlanan.push(ad); vtKalsin = true; break; }
    try { dene(() => islemler.sil(p)); } catch { atlanan.push(ad); vtKalsin = true; break; }
  }
  const vtYolu = path.join(kok, VT);
  const vtDurumu = lstat(vtYolu);
  if (vtDurumu) {
    if (vtKalsin || vtDurumu.isSymbolicLink()) atlanan.push(VT);
    else if (vtDurumu.isFile()) { try { dene(() => islemler.sil(vtYolu)); } catch { atlanan.push(VT); } }
    else guvenliSil(kok, vtYolu, atlanan);
  }
  const kalsin = new Set<string>([...CALISMA_DOSYALARI, ...VT_UCLUSU, ...(islem.yerelDahil ? [] : INDIRILEN)]);
  for (const ad of fs.readdirSync(kok)) {
    if (kalsin.has(ad)) continue;
    const p = path.join(kok, ad);
    if (lstat(p)?.isSymbolicLink()) { atlanan.push(ad); continue; }
    guvenliSil(kok, p, atlanan);
  }
  return { yapildi: 'sil', ...(atlanan.length ? { atlanan } : {}) };
}

/** "Eski yedekleri sil": yalnız yedekler/ (bağlantıysa dokunulmaz). Silinen yedek klasörü sayısı. */
export function yedekleriSil(kok: string): number {
  if (!kokGecerli(kok)) return 0;
  const p = path.join(kok, YEDEKLER);
  const s = lstat(p);
  if (!s || s.isSymbolicLink() || !s.isDirectory()) return 0;
  const sayi = yedekSayisi(kok);
  guvenliSil(kok, p, []);
  return lstat(p) ? Math.max(0, sayi - yedekSayisi(kok)) : sayi;
}

/** Yedek klasörü sayısı. */
export function yedekSayisi(kok: string): number {
  const p = path.join(kok, YEDEKLER);
  const s = lstat(p);
  if (!s || s.isSymbolicLink() || !s.isDirectory()) return 0;
  return fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
}

/**
 * Kökteki bir klasörün bayt boyutu — EŞZAMANSIZ ve SINIRLI (G2 düzeltme turu 1, K2): ana süreci bekletmez; yalnız Ayarlar → Veri
 * isteyince çağrılır. Bağlantılar izlenmez. `enCokGirdi` ya da `enCokMs` aşılırsa yarım toplam (alt sınır) ve `tam: false` döner
 * ("Yeni başla" yedeğindeki Chromium önbelleği binlerce dosya olabilir).
 */
export async function klasorBoyutuSinirli(kok: string, ad: string, o: { enCokGirdi?: number; enCokMs?: number } = {}): Promise<{ bayt: number; tam: boolean }> {
  const p = path.join(kok, ad);
  if (!icinde(kok, p)) return { bayt: 0, tam: true };
  const enCokGirdi = o.enCokGirdi ?? 20_000;
  const bitis = Date.now() + (o.enCokMs ?? 2000);
  let bayt = 0;
  let girdi = 0;
  const kuyruk = [p];
  while (kuyruk.length) {
    if (girdi >= enCokGirdi || Date.now() > bitis) return { bayt, tam: false };
    const x = kuyruk.pop()!;
    girdi++;
    let s: fs.Stats;
    try { s = await fs.promises.lstat(x); } catch { continue; }
    if (s.isSymbolicLink()) continue;
    if (!s.isDirectory()) { bayt += s.size; continue; }
    try { for (const y of await fs.promises.readdir(x)) kuyruk.push(path.join(x, y)); } catch { /* okunamayan alt klasör */ }
  }
  return { bayt, tam: true };
}

export const yenidenKurulumVar = (kok: string): boolean => Boolean(lstat(path.join(kok, ISARET_YENIDEN_KURULUM))?.isFile());
export function yenidenKurulumIsaretiniSil(kok: string): void {
  const p = path.join(kok, ISARET_YENIDEN_KURULUM);
  if (lstat(p)?.isFile()) dene(() => fs.unlinkSync(p));
}

/** ayarlar.json (bozuksa .bak) içindeki hesap e-postası. */
function hesapEpostasi(kok: string): string | null {
  for (const ad of ['ayarlar.json', 'ayarlar.json.bak']) {
    try {
      const e = (JSON.parse(fs.readFileSync(path.join(kok, ad), 'utf8')) as { hesap?: { eposta?: unknown } })?.hesap?.eposta;
      return typeof e === 'string' && e ? e : null;
    } catch { /* yok ya da bozuk: yedeğe bak */ }
  }
  return null;
}

/**
 * "Tekrar hoş geldin" özeti: silinmemiş hafıza notu, mesajı olan ve arşivde olmayan sohbet sayısı, son kullanım (en yeni mesajın zamanı)
 * ve bağlı hesabın e-postası. `vt`: ana süreçte açık bağlantı; verilmezse fuber.db salt okunur açılır (yoksa sıfırlar).
 */
export function veriOzeti(kok: string, vt?: DatabaseSync): VeriOzeti {
  const ozet: VeriOzeti = { hafiza: 0, sohbet: 0, sonKullanim: null, hesapEposta: hesapEpostasi(kok) };
  let baglanti = vt;
  let kapat = false;
  if (!baglanti) {
    const dosya = path.join(kok, 'fuber.db');
    if (!lstat(dosya)?.isFile()) return ozet;
    try { baglanti = new DatabaseSync(dosya, { readOnly: true }); kapat = true; } catch { return ozet; }
  }
  try {
    const sayi = (sql: string) => { try { return Number((baglanti!.prepare(sql).get() as { n?: number } | undefined)?.n ?? 0); } catch { return 0; } };
    ozet.hafiza = sayi('SELECT COUNT(*) n FROM hafizalar WHERE silindi = 0');
    ozet.sohbet = sayi('SELECT COUNT(*) n FROM sohbetler s WHERE s.arsiv = 0 AND EXISTS (SELECT 1 FROM mesajlar m WHERE m.sohbet_id = s.id)');
    try {
      const z = (baglanti.prepare('SELECT MAX(olusturma) z FROM mesajlar').get() as { z?: string | null } | undefined)?.z;
      ozet.sonKullanim = typeof z === 'string' && z ? z : null;
    } catch { /* tablo yok */ }
  } finally { if (kapat) baglanti.close(); }
  return ozet;
}
