// ── Dosya oluşturma, düzenleme, silme ve belge üretme araçları (0.14 T17; R7, R9, B22) ───────────────────────────
// Fuber, Claude Code gibi iş yapar. Dört araç (grup 'dosya-yaz'; Business ve Developer'da, bulut yolunda açık; Gizli ve
// "Yalnız bu bilgisayar"da hiç sunulmaz — ajan/dongu.ts grupEtkin):
//   dosya_yaz     { yol, icerik, kip: 'yeni' | 'uzerine' | 'ekle' }
//   dosya_duzenle { yol, eski, yeni }   (eski metin dosyada TAM BİR KEZ geçmeli)
//   dosya_sil     { yol }               (Geri Dönüşüm Kutusu'na)
//   belge_uret    { tur: 'docx' | 'xlsx' | 'pptx' | 'pdf', yol, icerik }   (shared/belge-sema.ts, main/belge-uret.ts)
// Kurallar (R9):
//   · Yalnız kullanıcı klasörlerinde yazılır: İçe Aktar, Masaüstü, Belgeler, İndirilenler, OneDrive (iceaktar.ts izinliKokler). Tam yetki
//     ayarı yazmayı AÇMAZ. Yol çözümü `path.resolve` + gerçek yol (`realpath`): bağlantı (junction/symlink) ve ".." ile kaçış yok; Windows
//     tuzakları (akış adı `a.txt:x`, ayrılmış aygıt adları, UNC, göreli yol) reddedilir. Reddedilen yol için onay BİLE sorulmaz.
//   · Son inceleme I1: var olan kullanıcı dosyasına EKLEME de onaylıdır (ajanın bu sohbette oluşturduğu, o andan beri değişmemiş dosyası hariç); sabit
//     bağlantılı (nlink > 1) ya da yolu bağlantı olan dosyaya yazılmaz (onay sorulmadan reddedilir). Belgeler\WindowsPowerShell ve \PowerShell yazılmaz.
//   · YENİ dosya onaysızdır. Var olan dosyanın ÜZERİNE YAZMA (dosya_yaz uzerine, dosya_duzenle, belge_uret) ve SİLME her seferinde
//     onaylıdır; onay kartı farkı gösterir (-/+ satırlar; belgede şimdiki boyut/tarih ve yeni içerik özeti). Silme Geri Dönüşüm Kutusu'na gider
//     (`shell.trashItem`); kutu başarısızsa dosya KALICI silinmez.
//   · Ek sertlik (temel kuralın dışında): çalıştırılabilir/betik uzantılı dosya (.exe, .bat, .ps1, .lnk…) yazmak onay ister.
// Yazım atomiktir (yan dosya + taşıma). Yazılan metin hiçbir etikette yok (P10): kartta yalnız dosya adı.
import fs from 'node:fs';
import path from 'node:path';
import { shell } from 'electron';
import { aracKaydet, sema, type Arac, type AracBaglami, type AracSonucu } from './kayit.js';
import { izinliKokler } from '../../iceaktar.js';
import { kokIcindeMi } from '../../yol-izni.js';
import { atomikYaz, belgeUret } from '../../belge-uret.js';
import { belgeIstegiDogrula, belgeIstegiHatasi, belgeOzetiMetni, BELGE_TURLERI, type BelgeTuru } from '../../../shared/belge-sema.js';

export const DOSYA_YAZ_GRUBU = 'dosya-yaz';
/** dosya_duzenle ve fark önizlemesi bu boyuta kadar (bayt) dosyaları açar. */
const SINIR_METIN = 5_000_000;
/** dosya_yaz içeriği en çok bu kadar karakter (bir model çıktısına sığar; girdi araç günlüğüne de yazılır — vt.ts olayKaydet — şişmesin). */
const SINIR_YAZMA = 1_000_000;
/** Onay önizlemesinin en çok karakteri (kart bunu kırpmadan gösterir; diğer araçlardaki 600–900'e yakın). */
const ONIZLEME_SINIR = 1200;

/** Yazması onay isteyen uzantılar (Windows'ta çift tıkla çalışan ya da kısayol/kayıt değişikliği yapan türler). `.js`/`.sh` kod dosyası: dışarıda. */
const CALISTIRILABILIR = new Set(['.exe', '.bat', '.cmd', '.com', '.ps1', '.psm1', '.psd1', '.ps1xml', '.vbs', '.vbe', '.wsf', '.wsh', '.msi', '.msp', '.scr', '.lnk', '.url',
  '.hta', '.reg', '.dll', '.cpl', '.pif', '.jar', '.appx', '.msix', '.application', '.gadget']);
const AYRILMIS_AD = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\..*)?$/i;

const hata = (icerik: string): AracSonucu => ({ icerik, hata: true });
const redMetni = (ne: string): string => `Kullanıcı onay vermedi (reddedildi): ${ne}`;
const boyutMetni = (n: number): string => (n < 1024 ? `${n} bayt` : `${Math.round(n / 1024)} KB`);
const yerelZaman = (d: Date): string => d.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });

// ── Yol çözümü ───────────────────────────────────────────────────────────────────────────────────────────────────
export type YolSonucu = { yol: string; gercek: string } | { hata: string };

/** Yazmaya izinli kökler: iceaktar.ts listesi; USERPROFILE yoksa göreli çıkan kökler (cwd'ye çözülürdü) atılır. */
function yazmaKokleri(): string[] {
  return izinliKokler().filter((k) => path.isAbsolute(k));
}

const gercekKok = (k: string): string => { try { return fs.realpathSync.native(k); } catch { return path.resolve(k); } };

/**
 * `girdi` yolunu çözer ve izinli kökün içinde olduğunu doğrular. `yol`: mutlak, normalleşmiş; `gercek`: bağlantılar çözülmüş hâli
 * (var olmayan kuyruk için en yakın var olan atanın gerçek yoluna eklenir) — fs işlemleri `gercek` üzerinde yapılır.
 */
export function yolCoz(girdi: unknown, kokler: string[] = yazmaKokleri()): YolSonucu {
  if (typeof girdi !== 'string' || !girdi.trim()) return { hata: 'yol zorunlu (dosyanın tam yolu)' };
  let y = girdi.trim().replace(/^"(.*)"$/, '$1');
  if (y.length > 1000) return { hata: 'yol çok uzun' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(y)) return { hata: 'yolda geçersiz karakter var' };
  const ev = process.env.USERPROFILE ?? '';
  if (/^~(?:[\\/]|$)/.test(y)) { if (!ev) return { hata: 'kullanıcı klasörü bilinmiyor' }; y = path.join(ev, y.slice(1)); }
  const ornek = path.join(ev || '%USERPROFILE%', 'Desktop', 'dosya.txt');
  if (!path.isAbsolute(y)) return { hata: `Tam yol ver (örn. ${ornek}); göreli yol kabul edilmez.` };
  if (/^[\\/]{2}/.test(y)) return { hata: 'Ağ yolları ve \\\\?\\ yolları kabul edilmez.' };
  const cozulen = path.resolve(y);
  const surucuSonrasi = cozulen.replace(/^[A-Za-z]:/, '');
  if (surucuSonrasi.includes(':')) return { hata: 'Yolda ":" olamaz (alternatif veri akışı yasak).' };
  for (const parca of cozulen.split(/[\\/]/).slice(1)) {
    if (!parca) continue;
    if (AYRILMIS_AD.test(parca)) return { hata: `"${parca}" Windows'ta ayrılmış bir ad; başka bir ad seç.` };
    if (/[. ]$/.test(parca)) return { hata: `"${parca}" nokta ya da boşlukla bitemez.` };
  }
  const izinsiz = { hata: `Yalnızca Masaüstü, Belgeler, İndirilenler, OneDrive ve İçe Aktar klasörlerinde yazılabilir: ${cozulen}` };
  if (!kokIcindeMi(cozulen, kokler)) return izinsiz;
  // Gerçek yol: var olan en yakın atanın realpath'i + kalan kuyruk. Kırık bağlantı (lstat var, realpath yok) reddedilir.
  let p = cozulen;
  const kuyruk: string[] = [];
  let gercek = '';
  for (;;) {
    try { gercek = fs.realpathSync.native(p); break; } catch (e) {
      let bagVar = false;
      try { fs.lstatSync(p); bagVar = true; } catch { /* yok */ }
      if (bagVar) return { hata: `Yol çözülemedi (kırık bağlantı ya da erişim yok): ${p}` };
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT' && (e as NodeJS.ErrnoException).code !== 'ENOTDIR') return { hata: `Yol çözülemedi: ${(e as Error).message}` };
      const ust = path.dirname(p);
      if (ust === p) return { hata: `Yol çözülemedi: ${cozulen}` };
      kuyruk.unshift(path.basename(p));
      p = ust;
    }
  }
  const gercekYol = kuyruk.length ? path.join(gercek, ...kuyruk) : gercek;
  if (!kokIcindeMi(gercekYol, kokler.map(gercekKok))) return izinsiz;
  // Minor 2: kökün altındaki PowerShell modül/profil klasörü (Belgeler\WindowsPowerShell, Belgeler\PowerShell; OneDrive\Belgeler\… de) yazılmaz.
  const psAlti = (p: string, kk: string[]) => kk.some((k) => { const g = path.relative(k, p); return Boolean(g) && !g.startsWith('..') && !path.isAbsolute(g) && PS_KLASORU.test(`\\${g}`); });
  if (psAlti(cozulen, kokler.map((k) => path.resolve(k))) || psAlti(gercekYol, kokler.map(gercekKok))) {
    return { hata: `PowerShell'in modül ve profil klasörüne (WindowsPowerShell, PowerShell) yazılmaz: ${cozulen}` };
  }
  return { yol: cozulen, gercek: gercekYol };
}

/** Yolun izinli kökün KENDİSİ olup olmadığı (silinemez). */
const kokMu = (gercek: string): boolean => yazmaKokleri().some((k) => [path.resolve(k), gercekKok(k)].some((x) => x.toLowerCase() === gercek.toLowerCase()));

// ── Fark önizlemesi ──────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Eski ve yeni metnin farkı (onay kartı): ortak baş ve son satırlar atılır, değişen aralık "- eski" / "+ yeni" olarak, çevresinde iki satır bağlam
 * ("  satır"). CRLF/LF farkı değişiklik sayılmaz. `sinir` karakteri aşarsa "… (+N satır daha)" ile kesilir. Farksızsa "(değişiklik yok)".
 */
export function farkOnizleme(eski: string, yeni: string, sinir = ONIZLEME_SINIR): string {
  const a = eski.split(/\r?\n/), b = yeni.split(/\r?\n/);
  let bas = 0;
  while (bas < a.length && bas < b.length && a[bas] === b[bas]) bas++;
  if (bas === a.length && bas === b.length) return '(değişiklik yok)';
  let son = 0;
  while (son < a.length - bas && son < b.length - bas && a[a.length - 1 - son] === b[b.length - 1 - son]) son++;
  const once = a.slice(Math.max(0, bas - 2), bas);
  const sonra = a.slice(a.length - son, a.length - son + 2).filter((_, k, l) => !(k === l.length - 1 && l[k] === '' && son <= 2)); // dosya sonundaki boş satır bağlam olmaz
  const kes = (s: string) => (s.length > 200 ? `${s.slice(0, 199)}…` : s);
  const satirlar = [
    `@@ satır ${bas - once.length + 1} @@`,
    ...once.map((s) => `  ${kes(s)}`),
    ...a.slice(bas, a.length - son).map((s) => `- ${kes(s)}`),
    ...b.slice(bas, b.length - son).map((s) => `+ ${kes(s)}`),
    ...sonra.map((s) => `  ${kes(s)}`),
  ];
  const cikti: string[] = [];
  let toplam = 0;
  for (let k = 0; k < satirlar.length; k++) {
    if (toplam + satirlar[k].length + 1 > sinir - 32) { cikti.push(`… (+${satirlar.length - k} satır daha)`); break; }
    cikti.push(satirlar[k]);
    toplam += satirlar[k].length + 1;
  }
  return cikti.join('\n');
}

// ── Okuma yardımcıları ───────────────────────────────────────────────────────────────────────────────────────────
/** Dosyanın UTF-8 metni; ikili (NUL) ya da UTF-8 olmayan (gidiş-dönüşte bozulan) dosya için null. */
function metinOku(gercek: string): { metin: string } | { neden: string } {
  const st = fs.statSync(gercek);
  if (st.size > SINIR_METIN) return { neden: `Dosya çok büyük (${boyutMetni(st.size)}; en çok ${boyutMetni(SINIR_METIN)}).` };
  const buf = fs.readFileSync(gercek);
  if (buf.subarray(0, 8192).includes(0)) return { neden: 'Bu bir metin dosyası değil (ikili içerik).' };
  const metin = buf.toString('utf8');
  if (!Buffer.from(metin, 'utf8').equals(buf)) return { neden: 'Dosya UTF-8 değil; bozulmaması için düzenlenmedi.' };
  return { metin };
}

const dosyaAdi = (yol: string) => path.basename(yol);
const DOSYA_ACIKLAMASI = 'Yol TAM (mutlak) olmalı; yalnız Masaüstü, Belgeler, İndirilenler, OneDrive ve İçe Aktar klasörlerinde yazılabilir (başka yer reddedilir).';

/** Var olan hedefin türü: 'dosya' | 'klasor' | null (yok). */
function hedefTuru(gercek: string): 'dosya' | 'klasor' | null {
  try { return fs.statSync(gercek).isDirectory() ? 'klasor' : 'dosya'; } catch { return null; }
}

/**
 * 0.14 son inceleme I1: var olan dosyaya bağlantı üzerinden yazılmaz (onay bile sorulmaz). Yolun son parçası sembolik bağlantı/junction ise (hedefi
 * kökün içinde olsa da; silme bağlantının hedefini kutuya atardı) ya da dosyanın birden çok sabit bağlantısı varsa (nlink > 1: ekleme kökün DIŞINDAKİ
 * aynı dosyaya da yazardı; realpath bunu göremez) hata metni döner.
 */
function baglantiEngeli(c: { yol: string; gercek: string }): string | null {
  try { if (fs.lstatSync(c.yol).isSymbolicLink()) return `Bu yol bir bağlantı (kısayol/sembolik bağlantı); bağlantı üzerinden yazılmaz: ${c.yol}`; } catch { /* yok */ }
  try {
    const st = fs.statSync(c.gercek);
    if (st.isFile() && st.nlink > 1) return `Bu dosyanın başka yerlerde de sabit bağlantısı var (${st.nlink} ad); bağlantı üzerinden yazılmaz: ${c.yol}`;
  } catch { /* yok */ }
  return null;
}

/** Minor 2: PowerShell'in kullanıcı modül/profil klasörleri (Belgeler\WindowsPowerShell, Belgeler\PowerShell) — buraya bırakılan modül bir cmdlet'le
 *  kendiliğinden yüklenebilir. Bu klasörlere ajan yazmaz. */
const PS_KLASORU = /[\\/](?:windowspowershell|powershell)(?:[\\/]|$)/i;

/** I1: ajanın bu oturumda (sohbet başına) oluşturduğu ya da eklediği dosyalar: gerçek yol → { sohbet, değişme zamanı, boyut }. Dosya o andan beri değişmediyse
 *  ajan kendi dosyasına onaysız ekleyebilir (büyük metni parça parça yazmak); kullanıcının dosyası (önceden var olan ya da sonradan değişen) onay ister. */
const ajanDosyalari = new Map<string, { sohbet: number; mtimeMs: number; size: number }>();
const anahtar = (gercek: string): string => path.resolve(gercek).toLowerCase();
function ajanDosyasiKaydet(gercek: string, sohbet: number): void {
  try { const st = fs.statSync(gercek); ajanDosyalari.set(anahtar(gercek), { sohbet, mtimeMs: st.mtimeMs, size: st.size }); } catch { /* yazılamadıysa kayıt yok */ }
}
function ajanDosyasiMi(gercek: string, sohbet: number): boolean {
  const k = ajanDosyalari.get(anahtar(gercek));
  if (!k || k.sohbet !== sohbet) return false;
  try { const st = fs.statSync(gercek); return st.mtimeMs === k.mtimeMs && st.size === k.size; } catch { return false; }
}

// ── Araçlar ──────────────────────────────────────────────────────────────────────────────────────────────────────
const dosyaYaz: Arac = {
  grup: DOSYA_YAZ_GRUBU, risk: 'onay',
  etiket: (g) => `Dosya yazıyor: ${dosyaAdi(String(g.yol ?? ''))}`,
  tanim: {
    ad: 'dosya_yaz',
    aciklama: `Metin dosyası oluşturur, üzerine yazar ya da sonuna ekler (kod, not, csv, markdown, json…). ${DOSYA_ACIKLAMASI} `
      + 'Yazma biçimi "yeni": dosya yoksa oluşturur (onay istemez; varsa hata verir). "ekle": sonuna ekler, yoksa oluşturur; kullanıcının var olan '
      + 'dosyasına eklemek HER SEFERİNDE onay ister (bu sohbette senin oluşturduğun dosyaya parça parça eklemek istemez). '
      + '"uzerine": var olan dosyanın içeriğini TAMAMEN değiştirir ve kullanıcıdan HER SEFERİNDE onay ister (fark gösterilir). '
      + 'Küçük değişiklik için dosya_duzenle kullan (tüm dosyayı yeniden yazma). Word/Excel/PowerPoint/PDF için belge_uret kullan. Parola ve anahtar yazma.',
    sema: sema({
      yol: { type: 'string', description: 'Dosyanın tam yolu (ör. D:\\Belgeler\\notlar.md)' },
      icerik: { type: 'string', description: 'Dosyanın metni (UTF-8). Boş dosya için "" ver.' },
      kip: { type: 'string', enum: ['yeni', 'uzerine', 'ekle'], description: 'yeni = yalnız yoksa oluştur; uzerine = var olanı değiştir (onaylı); ekle = sona ekle' },
    }, ['yol', 'kip']),
  },
  async calistir(g, b) {
    const kip = String(g.kip);
    if (typeof g.icerik !== 'string') return hata('icerik zorunlu (metin; boş dosya için "")');
    if (g.icerik.length > SINIR_YAZMA) return hata(`icerik çok uzun (en çok ${SINIR_YAZMA} karakter); parçalara böl ("ekle" ile art arda ekle).`);
    const c = yolCoz(g.yol);
    if ('hata' in c) return hata(c.hata);
    const tur = hedefTuru(c.gercek);
    if (tur === 'klasor') return hata(`Bu yol bir klasör: ${c.yol}`);
    const uz = path.extname(c.gercek).toLowerCase();
    const betik = CALISTIRILABILIR.has(uz);

    if (tur === 'dosya' && kip === 'yeni') return hata(`Bu yolda dosya zaten var: ${c.yol}. Üzerine yazmak için "uzerine" (onay ister), sonuna eklemek için "ekle" değerini kullan.`);
    if (tur === 'dosya') { const e = baglantiEngeli(c); if (e) return hata(e); }
    // I1: var olan dosyanın sonuna ekleme de bir değişikliktir — ajanın bu sohbette oluşturduğu ve o andan beri değişmemiş dosyası dışında onay ister.
    const ajaninEklemesi = tur === 'dosya' && kip === 'ekle' && ajanDosyasiMi(c.gercek, b.sohbetId);
    if (tur === null || ajaninEklemesi) {
      // Yeni dosya (her kipte, yol yoksa) ya da ajanın kendi dosyasına ekleme: onaysız — yalnız çalıştırılabilir türler sorulur.
      if (betik) {
        const k = await b.onay({
          baslik: tur === null ? 'Çalıştırılabilir bir dosya oluşturulsun mu?' : 'Çalıştırılabilir dosyaya eklensin mi?',
          aciklama: `${dosyaAdi(c.yol)} (${uz}) çift tıklanınca çalışabilen bir dosya türü: ${c.yol}`,
          onizleme: g.icerik.slice(0, ONIZLEME_SINIR), tehlike: 'yuksek',
        });
        if (k === 'reddet') return hata(redMetni(`${dosyaAdi(c.yol)} yazılmadı.`));
      }
      if (b.sinyal.aborted) return hata('Durduruldu; dosya yazılmadı.');
      const eklendi = ajaninEklemesi;
      try {
        if (eklendi) fs.appendFileSync(c.gercek, g.icerik, 'utf8');
        else atomikYaz(c.gercek, g.icerik);
      } catch (e) { return hata(`Dosya yazılamadı: ${(e as Error).message}`); }
      ajanDosyasiKaydet(c.gercek, b.sohbetId);
      return { icerik: `${eklendi ? 'Sonuna eklendi' : 'Oluşturuldu'}: ${c.yol} (${g.icerik.length} karakter)`, ozet: eklendi ? 'eklendi' : 'oluşturuldu' };
    }

    if (kip === 'ekle') {
      // I1: kullanıcının var olan dosyası — üzerine yazma gibi her seferinde onaylı; kart eklenen satırları gösterir.
      const st = fs.statSync(c.gercek);
      const eski = st.size <= SINIR_METIN ? metinOku(c.gercek) : { neden: `Dosya çok büyük (${boyutMetni(st.size)}).` };
      const onizleme = 'metin' in eski
        ? farkOnizleme(eski.metin, eski.metin + g.icerik)
        : `Şimdiki dosya: ${boyutMetni(st.size)} · değişme ${yerelZaman(st.mtime)}\n${eski.neden}\nSonuna ${g.icerik.length} karakter metin eklenecek.`;
      const k = await b.onay({ baslik: 'Dosyanın sonuna eklensin mi?', aciklama: `${c.yol} dosyasının sonuna metin eklenecek.`, onizleme, tehlike: betik ? 'yuksek' : 'orta' });
      if (k === 'reddet') return hata(redMetni(`${dosyaAdi(c.yol)} değişmedi.`));
      if (b.sinyal.aborted) return hata('Durduruldu; dosya değişmedi.');
      const sonra = baglantiEngeli(c); // kart beklenirken bağlantıya dönüşmüş olabilir
      if (sonra) return hata(sonra);
      try { fs.appendFileSync(c.gercek, g.icerik, 'utf8'); } catch (e) { return hata(`Dosya yazılamadı: ${(e as Error).message}`); }
      return { icerik: `Sonuna eklendi: ${c.yol} (${g.icerik.length} karakter)`, ozet: 'eklendi' };
    }

    // Var olan dosya, kip uzerine: her seferinde onay.
    const st = fs.statSync(c.gercek);
    const eski = st.size <= SINIR_METIN ? metinOku(c.gercek) : { neden: `Dosya çok büyük (${boyutMetni(st.size)}).` };
    if ('metin' in eski && eski.metin === g.icerik) return { icerik: `Dosya zaten bu içeriğe sahip, değişiklik yapılmadı: ${c.yol}`, ozet: 'değişiklik yok' };
    const onizleme = 'metin' in eski
      ? farkOnizleme(eski.metin, g.icerik)
      : `Şimdiki dosya: ${boyutMetni(st.size)} · değişme ${yerelZaman(st.mtime)}\n${eski.neden}\nYeni içerik: ${g.icerik.length} karakter metin.\nŞimdiki içerik silinir; yerine yenisi yazılır.`;
    const k = await b.onay({ baslik: 'Dosyanın üzerine yazılsın mı?', aciklama: `${c.yol} dosyasının içeriği değişecek.`, onizleme, tehlike: betik ? 'yuksek' : 'orta' });
    if (k === 'reddet') return hata(redMetni(`${dosyaAdi(c.yol)} değişmedi.`));
    if (b.sinyal.aborted) return hata('Durduruldu; dosya değişmedi.');
    try { atomikYaz(c.gercek, g.icerik); } catch (e) { return hata(`Dosya yazılamadı: ${(e as Error).message}`); }
    return { icerik: `Üzerine yazıldı: ${c.yol} (${g.icerik.length} karakter)`, ozet: 'üzerine yazıldı' };
  },
};

const dosyaDuzenle: Arac = {
  grup: DOSYA_YAZ_GRUBU, risk: 'onay',
  etiket: (g) => `Dosyayı düzenliyor: ${dosyaAdi(String(g.yol ?? ''))}`,
  tanim: {
    ad: 'dosya_duzenle',
    aciklama: `Var olan bir metin dosyasında bir metni başka bir metinle değiştirir. "eski" metin dosyada TAM BİR KEZ geçmelidir (yoksa ya da birden çok geçiyorsa hata verir ve dosya değişmez: eski'ye çevresindeki satırları ekleyerek benzersiz yap). `
      + `Önce dosya_oku ile dosyayı oku. Kullanıcıdan HER SEFERİNDE onay ister (fark gösterilir). ${DOSYA_ACIKLAMASI} Satır sonları (CRLF/LF) dosyanınkine uyarlanır.`,
    sema: sema({
      yol: { type: 'string', description: 'Düzenlenecek dosyanın tam yolu' },
      eski: { type: 'string', description: 'Dosyada olduğu gibi (boşluklarıyla) tam bir kez geçen değiştirilecek metin' },
      yeni: { type: 'string', description: 'Yerine yazılacak metin ("" = eski metni sil)' },
    }, ['yol', 'eski']),
  },
  async calistir(g, b) {
    if (typeof g.eski !== 'string' || g.eski === '') return hata('eski boş olamaz (değiştirilecek metni ver).');
    if (typeof g.yeni !== 'string') return hata('yeni zorunlu (silmek için "").');
    const c = yolCoz(g.yol);
    if ('hata' in c) return hata(c.hata);
    const tur = hedefTuru(c.gercek);
    if (tur === null) return hata(`Dosya yok: ${c.yol}`);
    if (tur === 'klasor') return hata(`Bu yol bir klasör: ${c.yol}`);
    const bag = baglantiEngeli(c);
    if (bag) return hata(bag);
    const o = metinOku(c.gercek);
    if ('neden' in o) return hata(o.neden);
    // Satır sonu uyumu: dosya CRLF ise ve eski/yeni LF ile verildiyse (modellerin tipik hatası) ikisi de CRLF'e çevrilir.
    const crlf = o.metin.includes('\r\n');
    const uydur = (s: string) => (crlf && !s.includes('\r\n') ? s.replace(/\n/g, '\r\n') : s);
    const eski = uydur(g.eski), yeni = uydur(g.yeni);
    if (eski === yeni) return hata('eski ve yeni aynı; değişiklik yok.');
    const say = (metin: string) => { let n = 0; for (let i = metin.indexOf(eski); i !== -1; i = metin.indexOf(eski, i + eski.length)) n++; return n; };
    const adet = say(o.metin);
    if (adet === 0) return hata('eski metin dosyada bulunamadı; dosya_oku ile güncel içeriğe bak (boşluk ve satır sonları dahil birebir olmalı). Dosya değişmedi.');
    if (adet > 1) return hata(`eski metin dosyada ${adet} kez geçiyor; tam bir kez geçmeli. Çevresindeki satırlarla birlikte benzersiz yap. Dosya değişmedi.`);
    const konum = o.metin.indexOf(eski);
    const sonuc = o.metin.slice(0, konum) + yeni + o.metin.slice(konum + eski.length);
    const k = await b.onay({
      baslik: 'Dosya düzenlensin mi?', aciklama: `${c.yol} dosyasında bir yer değişecek.`,
      onizleme: farkOnizleme(o.metin, sonuc), tehlike: 'orta',
    });
    if (k === 'reddet') return hata(redMetni(`${dosyaAdi(c.yol)} değişmedi.`));
    if (b.sinyal.aborted) return hata('Durduruldu; dosya değişmedi.');
    // Onay beklenirken dosya değişmiş olabilir: yeniden okunur, aynı tek eşleşme aranır.
    const son = metinOku(c.gercek);
    if ('neden' in son) return hata(son.neden);
    if (son.metin !== o.metin) {
      if (say(son.metin) !== 1) return hata('Dosya onay beklenirken değişti; düzenleme uygulanmadı. Dosyayı yeniden oku.');
    }
    const yerSon = son.metin.indexOf(eski);
    try { atomikYaz(c.gercek, son.metin.slice(0, yerSon) + yeni + son.metin.slice(yerSon + eski.length)); } catch (e) { return hata(`Dosya yazılamadı: ${(e as Error).message}`); }
    return { icerik: `Düzenlendi: ${c.yol}`, ozet: 'düzenlendi' };
  },
};

const dosyaSil: Arac = {
  grup: DOSYA_YAZ_GRUBU, risk: 'onay',
  etiket: (g) => `Dosyayı siliyor: ${dosyaAdi(String(g.yol ?? ''))}`,
  tanim: {
    ad: 'dosya_sil',
    aciklama: `Bir dosyayı Geri Dönüşüm Kutusu'na gönderir (kalıcı silmez; kullanıcı geri alabilir). Kullanıcıdan HER SEFERİNDE onay ister. Klasör silmez. ${DOSYA_ACIKLAMASI}`,
    sema: sema({ yol: { type: 'string', description: 'Silinecek dosyanın tam yolu' } }, ['yol']),
  },
  async calistir(g, b) {
    const c = yolCoz(g.yol);
    if ('hata' in c) return hata(c.hata);
    const tur = hedefTuru(c.gercek);
    if (tur === null) return hata(`Dosya yok: ${c.yol}`);
    if (tur === 'klasor' || kokMu(c.gercek)) return hata(`Klasör silinmez (yalnız dosya): ${c.yol}`);
    // I1: bağlantının yolu verildiyse kutuya bağlantının HEDEFİ giderdi (c.gercek): reddedilir. Sabit bağlantının bir adını kutuya atmak öbür adlara dokunmaz.
    try { if (fs.lstatSync(c.yol).isSymbolicLink()) return hata(`Bu yol bir bağlantı (kısayol/sembolik bağlantı); bağlantı üzerinden silinmez: ${c.yol}`); } catch { /* yok */ }
    const st = fs.statSync(c.gercek);
    const m = st.size <= 200_000 ? metinOku(c.gercek) : { neden: '' };
    const k = await b.onay({
      baslik: 'Dosya silinsin mi?',
      aciklama: `${c.yol} dosyası Geri Dönüşüm Kutusu’na taşınacak (${boyutMetni(st.size)} · değişme ${yerelZaman(st.mtime)}).`,
      onizleme: ('metin' in m ? m.metin : `(metin önizlemesi yok · ${boyutMetni(st.size)})`).slice(0, 600), tehlike: 'yuksek',
    });
    if (k === 'reddet') return hata(redMetni(`${dosyaAdi(c.yol)} silinmedi.`));
    if (b.sinyal.aborted) return hata('Durduruldu; dosya silinmedi.');
    try { await shell.trashItem(c.gercek); } catch (e) {
      return hata(`Dosya Geri Dönüşüm Kutusu’na gönderilemedi, silinmedi (kalıcı silme yapılmaz): ${(e as Error).message}`);
    }
    return { icerik: `Geri Dönüşüm Kutusu’na gönderildi: ${c.yol}`, ozet: 'Geri Dönüşüm Kutusu’nda' };
  },
};

const belgeUretAraci: Arac = {
  grup: DOSYA_YAZ_GRUBU, risk: 'onay',
  etiket: (g) => `Belge hazırlıyor: ${dosyaAdi(String(g.yol ?? ''))}`,
  tanim: {
    ad: 'belge_uret',
    aciklama: 'Word (docx), Excel (xlsx), PowerPoint (pptx) ya da PDF belgesi üretir. '
      + 'icerik türe göre: docx ve pdf için { baslik?, bolumler: [{ baslik?, paragraflar?: [metin], tablo?: [[hücre]] }] } (tablonun ilk satırı başlık satırı); '
      + 'xlsx için { sayfalar: [{ ad, satirlar: [[hücre metni]] }] } (ilk satır kalın başlık; hücrenin hepsi metin olarak verilir, sayıyı metin olarak yaz, ör. "12.5": nokta ondalıklı sayı gibi görünen hücre Excel\'e sayı olarak yazılır; baştaki sıfırlı ya da başka biçimli değerler metin kalır); '
      + 'pptx için { slaytlar: [{ baslik, maddeler: [metin] }] }. Yalnız türe uyan alanı ver. '
      + `Yeni dosya onay istemez; var olan dosyanın üzerine yazmak HER SEFERİNDE onay ister. yol uzantısı türle aynı olmalı (verilmezse eklenir). ${DOSYA_ACIKLAMASI}`,
    sema: sema({
      tur: { type: 'string', enum: [...BELGE_TURLERI], description: 'docx | xlsx | pptx | pdf' },
      yol: { type: 'string', description: 'Kaydedilecek dosyanın tam yolu (ör. D:\\Belgeler\\rapor.docx)' },
      icerik: {
        type: 'object',
        description: 'Türe uygun içerik (araç açıklamasına bak). docx/pdf: bolumler (+ baslik); xlsx: sayfalar (satirlar hücreleri metindir; sayıyı "12.5" gibi yaz); pptx: slaytlar.',
        properties: {
          baslik: { type: 'string' },
          bolumler: { type: 'array', items: { type: 'object', properties: {
            baslik: { type: 'string' },
            paragraflar: { type: 'array', items: { type: 'string' } },
            tablo: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
          } } },
          sayfalar: { type: 'array', items: { type: 'object', properties: {
            ad: { type: 'string' },
            satirlar: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
          } } },
          slaytlar: { type: 'array', items: { type: 'object', properties: {
            baslik: { type: 'string' },
            maddeler: { type: 'array', items: { type: 'string' } },
          } } },
        },
      },
    }, ['tur', 'yol', 'icerik']),
  },
  async calistir(g, b: AracBaglami) {
    const tur = String(g.tur) as BelgeTuru;
    // Uzantı: yoksa türünki eklenir, başka uzantı hata (yanlış türde dosya üretilmez).
    let yol = typeof g.yol === 'string' ? g.yol.trim() : '';
    if (!yol) return hata('yol zorunlu (kaydedilecek belgenin tam yolu)');
    const uz = path.extname(yol).toLowerCase();
    if (!uz) yol = `${yol}.${tur}`;
    else if (uz !== `.${tur}`) return hata(`yol uzantısı .${tur} olmalı (verilen: ${uz}).`);
    const istek = { tur, yol, icerik: g.icerik };
    const h = belgeIstegiHatasi(istek);
    if (h) return hata(`Belge isteği geçersiz: ${h}`);
    const d = belgeIstegiDogrula(istek)!;
    const c = yolCoz(yol);
    if ('hata' in c) return hata(c.hata);
    const hedef = hedefTuru(c.gercek);
    if (hedef === 'klasor') return hata(`Bu yol bir klasör: ${c.yol}`);
    if (hedef === 'dosya') {
      const bag = baglantiEngeli(c);
      if (bag) return hata(bag);
      const st = fs.statSync(c.gercek);
      const k = await b.onay({
        baslik: 'Belgenin üzerine yazılsın mı?', aciklama: `${c.yol} dosyası yeni belgeyle değiştirilecek.`,
        onizleme: `Şimdiki dosya: ${boyutMetni(st.size)} · değişme ${yerelZaman(st.mtime)}\nYeni: ${belgeOzetiMetni(d)}\nŞimdiki içerik silinir; yerine yenisi yazılır.`.slice(0, ONIZLEME_SINIR),
        tehlike: 'orta',
      });
      if (k === 'reddet') return hata(redMetni(`${dosyaAdi(c.yol)} değişmedi.`));
    }
    if (b.sinyal.aborted) return hata('Durduruldu; belge yazılmadı.');
    try {
      const s = await belgeUret(d, c.gercek);
      return { icerik: `${hedef === 'dosya' ? 'Üzerine yazıldı' : 'Hazırlandı'}: ${c.yol} (${boyutMetni(s.boyut)})`, ozet: boyutMetni(s.boyut) };
    } catch (e) { return hata(`Belge hazırlanamadı: ${(e as Error).message}`); }
  },
};

export function dosyaYazAraclariniKaydet(): void { aracKaydet(dosyaYaz, dosyaDuzenle, dosyaSil, belgeUretAraci); }
