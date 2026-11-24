// ── Komut çalıştırma aracı: komut_calistir (0.14 T18, R8; yalnız Developer mode) ─────────────────────────────────────────────────────
// Fuber, Claude Code gibi çalışır; onay YALNIZ geri dönüşsüz adımda. Grup 'komut' (dongu.ts grupEtkin: Developer mode ve Gizli kapalı —
// shared/komut-siniflama.ts komutAraciAcik; Business mode'da ve Gizli'de listede yok; başarılı her çağrı arka plan görev adımında geri dönüşsüz sayılır).
//   komut_calistir { komut, klasor? }   klasör verilmezse Belgeler.
// Kurallar:
//   · Sınıf (komutSinifi): okuyan bilinen komut sormadan çalışır (son inceleme C1: proje kodunu çalıştıran npm test/run vb. her seferinde onaylı); yıkıcı ya da tanınmayan, ağa çıkan ve bileşik/iç içe komut HER SEFERİNDE
//     dongu.ts'in onay kapısından (b.onay → onay kartı) geçer — ikinci bir kart yolu yok. Kart "dosyaları ya da sistemi değiştirebilir" der.
//   · "Yalnız bu bilgisayar" seçiliyken ağa çıkan komut hiç çalışmaz, onay da sorulmaz (KOMUT_AG_KAPALI_METNI); Gizli açıksa araç çalışmaz. İkisi onaydan
//     sonra yeniden denetlenir (kart beklenirken seçilmiş olabilir).
//   · Kabuk: powershell.exe -NoProfile -NonInteractive -Command; çıktı UTF-8 ([Console]::OutputEncoding), girdi yok (stdin kapalı). Çocuk süreç
//     kullanıcının olağan ortamını alır, uygulamanın iç değişkenlerini almaz (cocukOrtami: ELECTRON_*, FUBER_*, NODE_OPTIONS, uygulamanın koyduğu
//     TOKEN/SECRET/KEY/PASSWORD adlı değişkenler) — cihaz anahtarı ve oturum belirteci çocuğa geçmez.
//   · Süre KOMUT_SURE_MS (120 sn, süreç başladıktan sonra); Durdur ve Alt+Shift+Q (turun sinyali) ile süre sınırında süreç AĞACI kapanır
//     (taskkill /T /F; claudecode/yurutucu.ts agacOldur). Uygulama kapanırken süren komutların ağacı da kapanır.
//   · Çıktı: stdout ve stderr geliş sırasıyla tek metin; ANSI ve denetim karakterleri silinir. 20.000 karakteri aşan sonuç baş (≈6.000) + "ortadan N
//     karakter atlandı" + SON (≈13.000) olur — uzun çıktının özeti (test sonucu, hata) sondadır — ve sonuna ajan/zincir.ts aracSonucuKisalt'ın notu
//     düşer (döngü ikinci kez kesmez). Çıkış kodu sonucun ilk satırıdır; sıfır olmayan çıkış aracın hatası sayılmaz.
//   · git (düzeltme turu 1): serbest git komutu depo ayarındaki programı başlatmasın diye sertleştirilir — ortam (GIT_OPTIONAL_LOCKS=0; GIT_CONFIG_* ile
//     core.fsmonitor=false, log.showSignature=false), diff/log/show'a --no-ext-diff --no-textconv (gitKomutunuSertlestir). Depo (klasörden yukarı;
//     -C dahil) program çalıştırabilecek ayar taşıyorsa (filter, include, gpg, diff.external, textconv; hook'lar değil), okunamıyorsa ya da git 2.36'dan
//     eskiyse (sürüm bir kez okunur) komut onay ister.
//   · Düzeltme turu 4: status/diff/log/show alt modülleri bastırır (--ignore-submodules=all, ortamda diff.submodule=short); depo ayarında submodule.* ya da
//     diff.submodule varsa onay. Sarmalayıcı, çift tırnak, % ya da $ yüzünden onaya düşen komutun kartı BICIM_METNI'dir (birden çok komut iddia etmez).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { app } from 'electron';
import { aracKaydet, sema, metinKisalt, type Arac, type AracSonucu } from './kayit.js';
import { ARAC_SONUC_SINIRI } from '../zincir.js';
import { agacOldur } from '../../claudecode/yurutucu.js';
import { arkaPlandaBaslat, surecCiktisi, surecDurdur, surecListesi, type SurecOzeti } from '../surec-yoneticisi.js';
import { ayarlar } from '../../ayarlar.js';
import { yalnizYerelSeciliMi } from '../../motor/yerel.js';
import {
  komutSinifi, komutAgaCikar, komutAraciAcik, komutBicimdenOnay, komutIciGorulmez, serbestGitKomutu, projeKoduCalistirir, gitKomutunuSertlestir, GIT_YENIDEN_YAZILAN, KOMUT_SURE_MS,
  KOMUT_AG_KAPALI_METNI, KOMUT_GORULMEZ_METNI, type KomutNedeni, type KomutSinifi,
} from '../../../shared/komut-siniflama.js';

export const KOMUT_GRUBU = 'komut';
/** Komut metninin en çok karakteri. Onay kartı komutun TAMAMINI gösterir (kesmez; kart kaydırılır): kullanıcı görmediği bir parçayı onaylamaz. Uzun iş
 *  için model betiği dosya_yaz ile yazıp çalıştırır. */
const KOMUT_UZUNLUK_SINIRI = 2_000;
/** Bellekte tutulan çıktının başı (temizlenmeden önce); fazlası yalnız sayılır — taşan çıktı (ör. dev bir günlük) belleği doldurmaz. */
const TUTMA_SINIRI = 200_000;
/** Dönen son tampon: çıktının son bu kadar karakteri her zaman elde (baş tamponu taşsa da). */
const KUYRUK_SINIRI = 20_000;
/** Kesilen sonucun başı ve sonu (karakter; son, başlık ve notla birlikte ARAC_SONUC_SINIRI'na sığacak kadar). */
const BAS_PAYI = 6_000;
const SON_PAYI = 13_000;
/** Süreç çıktıktan sonra boruların kapanması için bekleme (arka planda kalan bir torun boruyu açık tutabilir). */
const KAPANIS_BEKLEME_MS = 1_500;
/** Durdurma ya da süre sınırından sonra sonuç en geç bu kadar sürede döner (taskkill gecikse de araç takılmaz). */
const ZORLA_BITIR_MS = 5_000;

// ── Ortam ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Uygulama açılırken devraldığı ortam (bu modül yüklenirken; main.ts'te ortam-kapisi.js'ten sonra): kullanıcının olağan ortamı. Sonradan uygulamanın
 *  koyduğu sır adlı değişkenler bunda yoktur. */
const ILK_ORTAM: Readonly<Record<string, string | undefined>> = { ...process.env };
const UYGULAMA_ONEKI = /^(?:ELECTRON_|FUBER_)/i;
const SIR_ADI = /TOKEN|SECRET|KEY|PASSWORD|ANAHTAR|SIFRE|ŞIFRE|PAROLA|BELIRTEC/i;

/**
 * Çocuk sürecin ortamı: `simdi` (process.env) eksi uygulamanın iç değişkenleri — her ELECTRON_* ve FUBER_*, NODE_OPTIONS ve adında TOKEN, SECRET, KEY,
 * PASSWORD (ya da Türkçe karşılığı) geçen ama `ilk` ortamda olmayan (uygulamanın koyduğu) değişkenler. Kullanıcının kendi sırrı (ilk ortamda vardı)
 * geçer; uygulama değerini değiştirdiyse kullanıcının ilk değeriyle. Adlar Windows'taki gibi büyük-küçük harf duyarsız karşılaştırılır.
 */
export function cocukOrtami(simdi: Readonly<Record<string, string | undefined>>, ilk: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const ilkler = new Map(Object.entries(ilk).map(([k, v]) => [k.toUpperCase(), v]));
  const out: Record<string, string> = {};
  for (const [ad, deger] of Object.entries(simdi)) {
    if (deger === undefined || UYGULAMA_ONEKI.test(ad) || ad.toUpperCase() === 'NODE_OPTIONS') continue;
    if (SIR_ADI.test(ad)) {
      const ilkDeger = ilkler.get(ad.toUpperCase());
      if (ilkDeger !== undefined) out[ad] = ilkDeger;
      continue;
    }
    out[ad] = deger;
  }
  return out;
}

// ── Çıktı ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** ANSI kaçışları (renk, imleç, pencere başlığı) ve denetim karakterleri silinir; \r ile üzerine yazılan satırın (ilerleme çubuğu) son hâli kalır.
 *  Satır sonu \n, sekme kalır. */
export function ciktiTemizle(s: string): string {
  /* eslint-disable no-control-regex */
  const ansisiz = s
    .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u009b[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[ -/]*[0-~]/g, '');
  return ansisiz.replace(/\r\n/g, '\n').split('\n')
    .map((satir) => { const t = satir.replace(/\r+$/, ''); return t.slice(t.lastIndexOf('\r') + 1); })
    .join('\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ufeff]/g, '');
  /* eslint-enable no-control-regex */
}

/** Dönen tamponun başı bir satırın (ya da ANSI dizisinin) ortasına denk gelebilir: ilk 2.000 karakterde satır sonu varsa ondan öncesi atılır. */
const yarimIlkSatiriAt = (s: string): string => { const n = s.indexOf('\n'); return n >= 0 && n < 2_000 ? s.slice(n + 1) : s; };
const binlik = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

// ── Çalıştırma ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// PowerShell: çıktı UTF-8 (BOM'suz; Türkçe karakter bozulmasın), ilerleme kayıtları kapalı (yönlendirilmiş stderr'e CLIXML yazmasın). Komut kendi
// satırında; ardından çıkış kodu: son yerel programın kodu ($LASTEXITCODE), yoksa PowerShell komutu başarısızsa 1.
const PS_ONEK = "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $OutputEncoding = [Console]::OutputEncoding; $ProgressPreference = 'SilentlyContinue'";
const PS_SONEK = '$__fuberBasari = $?; if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE } elseif (-not $__fuberBasari) { exit 1 }';

function kabuk(komut: string): { exe: string; args: string[] } {
  if (process.platform === 'win32') {
    const ps = path.join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    return { exe: fs.existsSync(ps) ? ps : 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', `${PS_ONEK}\n${komut}\n${PS_SONEK}`] };
  }
  return { exe: '/bin/sh', args: ['-c', komut] }; // Windows dışı yalnız geliştirme içindir (ağaç değil, kabuk kapanır)
}

/** Süren komutların PID'leri: uygulama kapanırken ağaçlarıyla kapatılır. */
const calisanlar = new Set<number>();
let cikisKancasi = false;
function cikisKancasiKur(): void {
  if (cikisKancasi) return;
  cikisKancasi = true;
  process.on('exit', () => { for (const pid of calisanlar) agacOldur(pid, true); });
}

export interface KomutSonucu {
  /** bitti: süreç kendisi çıktı; zaman: süre sınırında kapatıldı; durdu: turun sinyaliyle (Durdur, Alt+Shift+Q) kapatıldı; baslamadi: başlatılamadı. */
  durum: 'bitti' | 'zaman' | 'durdu' | 'baslamadi';
  kod: number | null;
  /** Temizlenmiş birleşik çıktı (en çok TUTMA_SINIRI kadarı). */
  cikti: string;
  /** Tutma sınırını aşan, yalnız sayılan karakter. */
  atilan: number;
  /** Taşma varsa çıktının temizlenmiş SON kısmı (dönen tampondan, en çok KUYRUK_SINIRI; yarım ilk satırı atılmış); taşma yoksa boş. */
  son: string;
  /** Süreç çıktı ama bir alt süreci boruları açık tuttu (beklenmedi). */
  acikKaldi?: boolean;
  hata?: string;
}

/** Komutu kabukta çalıştırır (onay ve sınıf denetimi ÇAĞIRANDA). `sinyal` gelince ya da `sureMs` dolunca süreç ağacı kapanır, o ana dek çıktı döner. */
export function komutuCalistir(komut: string, o: { klasor: string; sinyal?: AbortSignal; sureMs?: number; ortam?: (e: Record<string, string>) => Record<string, string> }): Promise<KomutSonucu> {
  return new Promise((coz) => {
    const { exe, args } = kabuk(komut);
    let c: ChildProcess;
    try {
      c = spawn(exe, args, { cwd: o.klasor, env: (o.ortam ?? ((e) => e))(cocukOrtami(process.env, ILK_ORTAM)), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      coz({ durum: 'baslamadi', kod: null, cikti: '', atilan: 0, son: '', hata: (e as Error).message });
      return;
    }
    const pid = c.pid;
    if (pid !== undefined) { calisanlar.add(pid); cikisKancasiKur(); }
    const parcalar: string[] = [];
    let tutulan = 0;
    let atilan = 0;
    let kuyruk = '';
    const ekle = (s: string) => {
      if (!s) return;
      kuyruk += s;
      if (kuyruk.length > 2 * KUYRUK_SINIRI) kuyruk = kuyruk.slice(-KUYRUK_SINIRI);
      const yer = Math.max(0, TUTMA_SINIRI - tutulan);
      const al = s.length <= yer ? s : s.slice(0, yer);
      if (al) { parcalar.push(al); tutulan += al.length; }
      atilan += s.length - al.length;
    };
    // stdout ve stderr ayrı çözücüyle (bölünmüş çok baytlı karakter bozulmasın), geliş sırasıyla tek metne.
    const cOut = new StringDecoder('utf8');
    const cErr = new StringDecoder('utf8');
    c.stdout?.on('data', (p: Buffer) => ekle(cOut.write(p)));
    c.stderr?.on('data', (p: Buffer) => ekle(cErr.write(p)));

    let durum: 'bitti' | 'zaman' | 'durdu' = 'bitti';
    let kod: number | null = null;
    let bitti = false;
    const saatler: NodeJS.Timeout[] = [];
    const son = (acikKaldi = false, baslamadi?: string) => {
      if (bitti) return;
      bitti = true;
      for (const s of saatler) clearTimeout(s);
      o.sinyal?.removeEventListener('abort', durdur); // bitmiş sürecin PID'i başka programa geçebilir: sonradan gelen sinyal ona dokunmasın
      if (pid !== undefined) calisanlar.delete(pid);
      if (baslamadi) { coz({ durum: 'baslamadi', kod: null, cikti: '', atilan: 0, son: '', hata: baslamadi }); return; }
      ekle(cOut.end());
      ekle(cErr.end());
      if (acikKaldi) { c.stdout?.destroy(); c.stderr?.destroy(); }
      coz({ durum, kod, cikti: ciktiTemizle(parcalar.join('')), atilan, son: atilan > 0 ? ciktiTemizle(yarimIlkSatiriAt(kuyruk.slice(-KUYRUK_SINIRI))) : '', ...(acikKaldi ? { acikKaldi: true } : {}) });
    };
    const kes = (neden: 'zaman' | 'durdu') => {
      if (bitti || durum !== 'bitti') return;
      durum = neden;
      if (pid !== undefined && c.exitCode === null && c.signalCode === null) agacOldur(pid);
      saatler.push(setTimeout(() => son(true), ZORLA_BITIR_MS));
    };
    const durdur = () => kes('durdu');
    saatler.push(setTimeout(() => kes('zaman'), o.sureMs ?? KOMUT_SURE_MS));
    if (o.sinyal?.aborted) durdur();
    else o.sinyal?.addEventListener('abort', durdur, { once: true });
    c.on('error', (e) => { if (pid === undefined) son(false, e.message); }); // `on`: ikinci bir 'error' olayı işlenmeden kalıp ana süreci düşürmesin
    c.once('exit', (k) => { kod = k; saatler.push(setTimeout(() => son(true), KAPANIS_BEKLEME_MS)); });
    c.once('close', (k) => { if (kod === null) kod = k; son(); });
  });
}

// ── Araç ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const hata = (icerik: string): AracSonucu => ({ icerik, hata: true });

/** Varsayılan klasör: Belgeler (Windows'un bilinen klasörü; OneDrive'a taşınmış olabilir), yoksa ev klasörü. */
function belgeler(): string {
  try { const p = app.getPath('documents'); if (p && fs.existsSync(p)) return p; } catch { /* bilinen klasör çözülemedi */ }
  const ev = process.env.USERPROFILE || os.homedir();
  const d = path.join(ev, 'Documents');
  return fs.existsSync(d) ? d : ev;
}

function klasorCoz(g: unknown): { klasor: string } | { hata: string } {
  if (g === undefined || g === null || (typeof g === 'string' && !g.trim())) return { klasor: belgeler() };
  if (typeof g !== 'string') return { hata: 'klasor tam yol olmalı (metin).' };
  let y = g.trim().replace(/^"(.*)"$/, '$1');
  if (/^~(?:[\\/]|$)/.test(y)) y = path.join(process.env.USERPROFILE || os.homedir(), y.slice(1));
  if (!path.isAbsolute(y)) return { hata: `klasor tam yol olmalı (ör. ${belgeler()}); göreli yol kabul edilmez.` };
  try {
    if (!fs.statSync(y).isDirectory()) return { hata: `Bu yol bir klasör değil: ${y}` };
  } catch { return { hata: `Klasör yok: ${y}` }; }
  return { klasor: path.resolve(y) };
}

/** Analiz 11 Kas bulgu 4: arka plan modu (dev sunucusu, izleyici) her seferinde onay ister; kart bunu söyler. */
export const ARKA_PLAN_METNI = 'Bu komut arka planda süre sınırı olmadan çalışır (sunucu ya da izleyici); “Çalışan süreçler” listesinden durdurabilirsin, uygulama kapanınca kapanır.';
/** İnceleme I3: telefondan arka plan komutu istenince modelin ve kullanıcının göreceği tek satır. */
export const ARKA_PLAN_UZAK_METNI = 'Arka plan komutu (sunucu, izleyici) telefondan başlatılmaz; bilgisayarın başında başlat: orada görünür ve durdurulur.';
/** Arka planda başlayan komutun ilk çıktısı için en çok bu kadar beklenir (süreç bu arada biterse hemen döner). */
const ARKA_ILK_BEKLEME_MS = 4_000;

/** Onay kartının metni (neden başına). Yıkıcı ve tanınmayan komut için "değiştirebilir" — yıkıcı olduğu iddia edilmez. */
const KART: Record<KomutNedeni, { aciklama: string; tehlike: 'orta' | 'yuksek' }> = {
  yikici: { aciklama: 'Bu komut dosyaları ya da sistemi değiştirebilir.', tehlike: 'yuksek' },
  ag: { aciklama: 'Bu komut bu bilgisayardan dışarı (internete ya da başka bir bilgisayara) bağlanır.', tehlike: 'orta' },
  karmasik: { aciklama: 'Bu komut birden çok komut ya da iç içe bir komut içeriyor; ne yapacağı tek bakışta belli değil.', tehlike: 'yuksek' },
};
/** 0.14 son inceleme C1: proje kodunu (npm test, npm run, node/python dosya, make …) çalıştıran komutun kartı — dosyaları kim yazmış olursa olsun. */
export const PROJE_KODU_METNI = 'Bu komut bu klasördeki projenin kodunu (betikler, testler) çalıştırır; dosyaları ya da sistemi değiştirebilir.';

/** Minor 2: serbest komutun PowerShell modül yolu — yalnız sistemin kendi modül klasörü ($PSHOME\Modules; Windows PowerShell 5.1 yönetici yazabilen
 *  Program Files\WindowsPowerShell\Modules'u kendisi ekler). Kullanıcının Belgeler\WindowsPowerShell\Modules klasörü (ajanın yazabildiği yer) yolda olmaz:
 *  serbest bir cmdlet oraya bırakılmış bir modülü kendiliğinden yükleyemez. Onaylı komut kullanıcının olağan modül yoluyla çalışır. */
export function psModulYolu(): string {
  return path.join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules');
}
/** Serbest komutun ortamı: PSModulePath yalnız sistem klasörü (Minor 2); tur 2 (N1, derinlik): NoDefaultCurrentDirectoryInExePath=1 (çalışma klasöründeki
 *  exe/kabuk program aranırken bulunmaz) ve PATH'in göreli girdileri (".", "araclar" — çalışma klasörüne çözülür) atılır. */
export function serbestOrtam(e: Record<string, string>): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(e)) {
    const u = k.toUpperCase();
    if (u === 'PSMODULEPATH' || u === 'NODEFAULTCURRENTDIRECTORYINEXEPATH') continue;
    o[k] = u === 'PATH' ? v.split(';').filter((p) => p && path.win32.isAbsolute(p) && /^(?:[A-Za-z]:[\\/]|\\\\)/.test(p)).join(';') : v;
  }
  o.PSModulePath = psModulYolu();
  o.NoDefaultCurrentDirectoryInExePath = '1';
  return o;
}
const psModulOrtami = serbestOrtam;

/** Düzeltme turu 1: serbest git komutunun onaya düşme nedenleri (kartın açıklaması). */
export const DEPO_PROGRAM_METNI = 'Bu depo, git komutlarında program çalıştıracak ayarlar içeriyor.';
export const ESKI_GIT_METNI = 'Bu bilgisayardaki git’in sürümü okunamadı ya da 2.36’dan eski; depo ayarlarındaki programlar kapatılamıyor.';
/** Düzeltme turu 3: boş hook klasörü hazırlanamadı (oluşturulamadı ya da temizlenemedi). */
export const HOOK_KLASORU_METNI = 'Git hook’larını kapatan boş klasör hazırlanamadı; bu yüzden git komutu onay istiyor.';
/** Düzeltme turu 4 (Y-4): komut yalnız biçimi yüzünden (sarmalayıcı, çift tırnak, %, $; komutBicimdenOnay) onaya düştüyse kartın açıklaması — birden çok
 *  komut ya da iç içe komut iddia etmez. */
export const BICIM_METNI = 'Bu komutu çalıştırmadan önce onayınızı istiyorum.';

/** Gizli ve "Yalnız bu bilgisayar" kapısı (istek anında; onaydan önce ve sonra). Denetleyici kararı (düzeltme turu 4, P14): "Yalnız bu bilgisayar"
 *  seçiliyken içi görülemeyen sarmalayıcı (kodlanmış komut, betik dosyası, Start-Process) karta düşmez, reddedilir — yalnız onay isteyen komutta (serbest
 *  komutun içeriği bilinir). Ağa çıkan komutun metni önce gelir. */
function kapiEngeli(komut: string, s: KomutSinifi, agKlasoru: boolean): AracSonucu | null {
  if (ayarlar().yerel.gizliMod === true) return hata('Gizli modda komut çalıştırılmaz.');
  // Son inceleme Minor 6: kart beklenirken Business mode'a geçildiyse onaylı komut da çalışmaz.
  if (!komutAraciAcik({ mod: ayarlar().mod, gizliMod: false })) return hata('Komut çalıştırma yalnız Developer mode\'da.');
  if (!yalnizYerelSeciliMi()) return null;
  if (s.neden === 'ag' || agKlasoru || komutAgaCikar(komut)) return hata(KOMUT_AG_KAPALI_METNI);
  if (s.sinif === 'onay' && komutIciGorulmez(komut)) return hata(KOMUT_GORULMEZ_METNI);
  return null;
}

// ── git sertleştirmesi (düzeltme turu 1-2) ─────────────────────────────────────────────────────────────────────────────────────────────
// Risk: zip ya da arşivden gelen bir .git klasörü (git clone ayar ve hook kopyalamaz, arşiv kopyalar). git okuma komutları depo ayarındaki ya da hook'undaki
// yardımcı programı sormadan başlatabilir; sahiplik denetimi (safe.directory) kullanıcının kendi açtığı arşivi durdurmaz. core.pager bu yolda tetiklenmez
// (stdout terminal değil, boru). Sertleştirme iki kanatlı: ortam (gitOrtami; komut kapsamlı GIT_CONFIG, depo ayarının üstünde) + yeniden yazma (diff/log/show'a
// --no-ext-diff --no-textconv) + depo ayarı taraması (depoRiskli: ortamla susturulamayanlar — filter, include, gpg, diff.external, textconv).

/** Serbest git komutunun ortamı. Komut kapsamlı GIT_CONFIG girdileri (depo ayarının üstünde gelir) tüm hook'ları ve alt modül inişini kapatır:
 *  · GIT_OPTIONAL_LOCKS=0 — git status indeksi yazmaz (emsal claudecode/yurutucu.ts).
 *  · core.hooksPath=<boş klasör> (düzeltme turu 2, Y1) — hiçbir hook çalışmaz (diff'in indeks yenilemesi bir hook tetiklese de klasör boş). Çağıran her zaman
 *    verir (hookKlasoruHazirla; hazırlanamazsa var olmayan bir yol); verilmezse atlanır.
 *  · diff.autoRefreshIndex=false (Y1) — diff indeksi sessizce yazmaz.
 *  · diff.ignoreSubmodules=all, status.submoduleSummary=false (Y2) — status/diff alt modüllere inmez; alt modülün kendi ayarındaki sürücü çalışmaz.
 *  · diff.submodule=short (düzeltme turu 4, Y-2b) — satır içi alt modül farkı seçilemez (ortam girdisi depo ayarının üstünde; depoda bu ayar varsa
 *    depoRiskli zaten onay ister).
 *  · `yeni` (git 2.36+) ise ek olarak core.fsmonitor=false ve log.showSignature=false (2.36 öncesinde "false" hook yolu sayılır: verilmez, komut zaten onay ister).
 *  Hepsi kullanıcının var olan GIT_CONFIG_* girdilerinin ardına yazılır (üzerine değil). */
export function gitOrtami(e: Record<string, string>, yeni: boolean, hookKlasoru?: string): Record<string, string> {
  const o: Record<string, string> = { ...e, GIT_OPTIONAL_LOCKS: '0' };
  const ek: [string, string][] = [];
  if (hookKlasoru) ek.push(['core.hooksPath', hookKlasoru]);
  ek.push(['diff.autoRefreshIndex', 'false'], ['diff.ignoreSubmodules', 'all'], ['status.submoduleSummary', 'false'], ['diff.submodule', 'short']);
  if (yeni) ek.push(['core.fsmonitor', 'false'], ['log.showSignature', 'false']);
  const n = /^\d+$/.test(e.GIT_CONFIG_COUNT ?? '') ? Number(e.GIT_CONFIG_COUNT) : 0;
  ek.forEach(([anahtar, deger], i) => { o[`GIT_CONFIG_KEY_${n + i}`] = anahtar; o[`GIT_CONFIG_VALUE_${n + i}`] = deger; });
  o.GIT_CONFIG_COUNT = String(n + ek.length);
  return o;
}

/** Uygulamanın kendi boş hook klasörünün yolu (userData/git-bos-hooks; yol önbellekte, içerik her seferinde denetlenir). Sınama kancası değiştirebilir. */
let hookKlasoruYolu: string | undefined;
const hookKlasoru = (): string => (hookKlasoruYolu ??= path.join(app.getPath('userData'), 'git-bos-hooks'));
/** Sınama kancası: hook klasörünün yolu (undefined = varsayılan). */
export function hookKlasorunuAyarla(yol: string | undefined): void { hookKlasoruYolu = yol; }

/**
 * Düzeltme turu 3 (Y1 kurcalama, N1): git çağrısından HEMEN önce, her seferinde: hook klasörü var mı (yoksa oluşturulur) ve boş mu (değilse içi temizlenir).
 * Hazırsa { yol: klasör, temiz: true }. Hazırlanamazsa (oluşturulamadı, temizlenemedi, okunamadı) { temiz: false } ve yol olarak bu çağrıya özgü, var olmayan
 * bir yol döner: git'e yine core.hooksPath verilir (hooksPath'siz çalışmaz) ama orada hook bulunmaz; kurcalanmış klasör asla gösterilmez. Serbest komut bu
 * durumda onaya düşer (komut.ts calistir).
 */
export function hookKlasoruHazirla(): { yol: string; temiz: boolean } {
  try {
    const d = hookKlasoru();
    fs.mkdirSync(d, { recursive: true });
    for (const ad of fs.readdirSync(d)) fs.rmSync(path.join(d, ad), { recursive: true, force: true });
    if (fs.readdirSync(d).length === 0) return { yol: d, temiz: true };
  } catch { /* aşağıda: hazırlanamadı */ }
  return { yol: path.join(os.tmpdir(), `fuber-git-hooks-yok-${randomUUID()}`), temiz: false };
}

type Surum = { ana: number; alt: number };
/** Okunan git sürümü (yalnız başarı önbelleğe girer; okunamazsa sonraki komutta yeniden denenir). */
let gitSurumOnbellek: { surum: Surum | null } | undefined;
const surumCoz = (m: string | null): Surum | null => { const x = /git version (\d+)\.(\d+)/.exec(m ?? ''); return x ? { ana: Number(x[1]), alt: Number(x[2]) } : null; };
const surumYeterli = (s: Surum | null): boolean => s !== null && (s.ana > 2 || (s.ana === 2 && s.alt >= 36));

/** `git version` (bir kez; geçici klasörde, süzülmüş ortamla, 5 sn sınırla). */
async function gitSurumu(): Promise<Surum | null> {
  if (gitSurumOnbellek) return gitSurumOnbellek.surum;
  const metin = await new Promise<string | null>((coz) => {
    try {
      execFile('git', ['version'], { cwd: os.tmpdir(), env: cocukOrtami(process.env, ILK_ORTAM), timeout: 5_000, windowsHide: true }, (h, out) => coz(h ? null : String(out)));
    } catch { coz(null); }
  });
  const s = surumCoz(metin);
  if (s) gitSurumOnbellek = { surum: s };
  return s;
}
/** Sınama kancası: sürüm metni ("git version 2.45.1"), null = okunamadı, undefined = önbellek boşalır (gerçek git'e sorulur). */
export function gitSurumunuAyarla(metin: string | null | undefined): void {
  gitSurumOnbellek = metin === undefined ? undefined : { surum: surumCoz(metin) };
}

/** Onay isteyen depo ayarları (ham metinde, harf duyarsız; şüphede "var"; dosyanın bölüm sözdizimiyle de: [filter "x"], [diff] external =). Daraltma
 *  (denetleyici kararı): filter.* (clean/smudge/process — git status çalıştırabilir), include/includeIf (taranmayan dosya), gpg/imza ayarları (gpg.program,
 *  gpg.*.program) ve diff.external (--no-ext-diff eklense de: diff dışı yollar için güvenli taraf). textconv da kalır: `git status -v` textconv'u açar ve
 *  --no-textconv bayrağı yoktur; depo düzeyinde textconv sürücüsü de seyrektir. Çıkanlar (gitOrtami ile susturulanlar; taranmaz): core.fsmonitor (GIT_CONFIG
 *  komut kapsamı depo ayarının ÜSTÜNDE false verir), hook dosyaları ve core.hooksPath (boş hooksPath + GIT_OPTIONAL_LOCKS=0 + diff.autoRefreshIndex=false ile
 *  hiçbir hook çalışmaz; Husky her JS projesinde hooksPath koyar). Düzeltme turu 4 (Y-2b): alt modül ayarları (submodule.*, diff.submodule) taranır —
 *  kaba ham metin araması (/submodule/i): bölüm biçimi ([submodule "x"], [diff] submodule =) ve noktalı biçim birlikte; şüphede "var". */
const RISKLI_AYAR = [/\[\s*filter\b/i, /\bfilter\./i, /include/i, /\[\s*gpg\b/i, /\bgpg\./i, /diff\.external/i, /\bexternal\s*=/i, /textconv/i, /submodule/i];

/** Dosyanın metni; yoksa null (öbür okuma hataları fırlar: çağıran "okunamadı" sayar). */
function okuVarsa(p: string): string | null {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) {
    const k = (e as NodeJS.ErrnoException).code;
    if (k === 'ENOENT' || k === 'ENOTDIR') return null;
    throw e;
  }
}

/** Klasörden yukarı doğru git klasörü: `.git` klasörü, `.git` dosyası (çalışma ağacı/alt modül: gitdir + commondir) ya da klasörün kendisi (çıplak depo,
 *  .git'in içi). Depo yoksa null; okunamayan .git dosyası fırlar. */
function gitKlasoruBul(baslangic: string): { gitDir: string; ortak: string; kok?: string } | null {
  const sonuc = (gitDir: string, kok?: string) => { const c = okuVarsa(path.join(gitDir, 'commondir')); return { gitDir, ortak: c ? path.resolve(gitDir, c.trim()) : gitDir, kok }; };
  for (let d = baslangic; ; d = path.dirname(d)) {
    const p = path.join(d, '.git');
    let st: fs.Stats | null = null;
    try { st = fs.statSync(p); } catch (e) {
      const k = (e as NodeJS.ErrnoException).code;
      if (k !== 'ENOENT' && k !== 'ENOTDIR') throw e;
    }
    if (st?.isDirectory()) return sonuc(p, d);
    if (st) {
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(p, 'utf8'));
      if (!m) throw new Error('.git dosyası okunamadı');
      return sonuc(path.resolve(d, m[1]), d);
    }
    if (['HEAD', 'objects', 'refs'].every((x) => fs.existsSync(path.join(d, x)))) return sonuc(d);
    if (path.dirname(d) === d) return null;
  }
}

/**
 * Klasörden yukarı bulunan depo, git okuma komutunda program çalıştırabilecek bir ayar (RISKLI_AYAR; ortak config ve config.worktree) taşıyor mu —
 * taşıyorsa ya da okunamıyorsa true, depo yoksa false. Hook dosyalarına ve hooksPath'e bakılmaz (RISKLI_AYAR açıklaması).
 */
export function depoRiskli(baslangic: string): boolean {
  try {
    const g = gitKlasoruBul(path.resolve(baslangic));
    if (!g) return false;
    const dosyalar = [...new Set([path.join(g.ortak, 'config'), path.join(g.gitDir, 'config.worktree'), path.join(g.ortak, 'config.worktree')])];
    return dosyalar.some((f) => { const metin = okuVarsa(f); return metin !== null && RISKLI_AYAR.some((d) => d.test(metin)); });
  } catch { return true; }
}

/** Düzeltme turu 3 (N3): klasörden yukarı bulunan deponun çalışma ağacında `.gitmodules` var mı (alt modül tanımlı). Belirlenemezse true (not zararsızdır). */
export const ALT_MODUL_NOTU = '(Alt modüller gösterilmedi.)';
export function altModulVar(baslangic: string): boolean {
  try {
    const g = gitKlasoruBul(path.resolve(baslangic));
    return Boolean(g?.kok && fs.existsSync(path.join(g.kok, '.gitmodules')));
  } catch { return true; }
}

// ── Sonuç ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** 20.000'i aşan sonuç: başlık + baş (BAS_PAYI) + "… (ortadan N karakter atlandı) …" + son (SON_PAYI; başlıkla birlikte sınıra sığacak kadar) + ajan/zincir.ts
 *  aracSonucuKisalt'ın notu (sonucKisaltildiMi tanır, döngü ikinci kez kesmez). Bellek sınırı aşıldıysa son dönen tampondan; toplam o zaman yaklaşık
 *  (taşan kısım temizlenmeden sayıldı). */
function basVeSon(baslik: string, govde: string, r: KomutSonucu, ek = ''): string {
  const tasti = r.atilan > 0;
  const kaynakSon = tasti ? (r.son.replace(/\s+$/, '') ? r.son.replace(/\s+$/, '') + ek : govde) : govde;
  const toplamGovde = tasti ? r.cikti.length + r.atilan : govde.length;
  const bas = govde.slice(0, BAS_PAYI);
  const orta = (n: number) => `… (ortadan ${binlik(n)} karakter atlandı) …`;
  const yer = Math.min(SON_PAYI, ARAC_SONUC_SINIRI - (baslik.length + bas.length + orta(toplamGovde).length + 3));
  const son = yer > 0 ? kaynakSon.slice(-yer) : '';
  const atlanan = Math.max(0, toplamGovde - bas.length - son.length);
  return `${baslik}\n${bas}\n${orta(atlanan)}\n${son}… (sonuç kısaltıldı: ${binlik(ARAC_SONUC_SINIRI)} / ${binlik(baslik.length + 1 + toplamGovde)} karakter)`;
}

/** `ekSatir`: çıktının sonuna eklenen tek satır (ör. ALT_MODUL_NOTU); kesilen sonuçta da sonda görünür. */
function sonucMetni(r: KomutSonucu, klasor: string, ekSatir?: string): AracSonucu {
  if (r.durum === 'baslamadi') return hata(`Komut başlatılamadı: ${r.hata ?? 'bilinmeyen hata'}`);
  const sn = KOMUT_SURE_MS / 1000;
  const satirlar = [
    r.durum === 'zaman' ? `Komut ${sn} sn içinde bitmedi; durduruldu (süreç ağacı kapatıldı).`
      : r.durum === 'durdu' ? 'Kullanıcı durdurdu; komut ve alt süreçleri kapatıldı.'
        : `Çıkış kodu: ${r.kod ?? 'bilinmiyor'}`,
    `Klasör: ${klasor}`,
  ];
  if (r.acikKaldi && r.durum === 'bitti') satirlar.push('Not: komutun başlattığı bir süreç çıktıyı açık tuttu; o süreç beklenmedi.');
  const baslik = satirlar.join('\n');
  const ek = ekSatir ? `\n${ekSatir}` : '';
  const govde = (r.cikti.replace(/\s+$/, '') || '(çıktı yok)') + ek;
  const tam = `${baslik}\n${govde}`;
  const kesildi = r.atilan > 0 || tam.length > ARAC_SONUC_SINIRI;
  const icerik = kesildi ? basVeSon(baslik, govde, r, ek) : tam;
  const ozet = (r.durum === 'zaman' ? `${sn} sn sınırında durduruldu` : r.durum === 'durdu' ? 'durduruldu' : `çıkış kodu ${r.kod ?? 'bilinmiyor'}`)
    + (kesildi ? ' · çıktı kısaltıldı' : '');
  return { icerik, ozet, ...(r.durum === 'bitti' ? {} : { hata: true }) };
}

const komutAraci: Arac = {
  grup: KOMUT_GRUBU, risk: 'onay',
  etiket: (g) => `Komut çalıştırıyor: ${metinKisalt(String(g.komut ?? '').replace(/\s+/g, ' ').trim(), 60)}`,
  tanim: {
    ad: 'komut_calistir',
    aciklama: 'Windows PowerShell\'de TEK bir komut çalıştırır; çıktısını (stdout ve stderr birlikte; uzunsa başı ve sonu, en çok 20.000 karakter) ve çıkış kodunu '
      + 'döndürür. klasor verilmezse Belgeler klasöründe çalışır (klasör TAM yol olmalı). Süre sınırı 120 sn; uzun süren sunucu (npm run dev gibi) ya da girdi '
      + 'bekleyen etkileşimli komut çalıştırma. Okuyan bilinen komutlar (git status/log/diff/show/branch, dir, Get-ChildItem, Get-Content/type/cat, '
      + 'where, Get-Command) sormadan çalışır; npm, node, python, pip, go, cargo, dotnet gibi başlatıcılar (sürüm sorgusu dahil), projenin kodunu çalıştıran (npm test, make), dosyaları ya da sistemi '
      + 'değiştirebilecek, ağa çıkan, dosyaya yönlendiren (>) ya da birden '
      + 'çok komut içeren (; && | $( )) komutlar kullanıcıdan HER SEFERİNDE onay ister: bağımsız işleri ayrı komut_calistir çağrılarına böl. Komutu doğrudan '
      + 'yaz: cmd /c, powershell -c, & ya da Start-Process ile sarmalanan komut da onay ister. Sormadan çalışacak komutta yalnız harf, rakam, boşluk ve '
      + '- _ . / \\ : = , bulunur; tırnak (tek ya da çift), $ % @ ~ # ! [ ] gibi karakter, uzak bilgisayar (-ComputerName) ya da ağ yolu (\\\\sunucu) içeren '
      + 'komut onay ister — boşluklu klasörde çalışmak için klasor parametresini kullan. Sunucu ya da izleyici (npm run dev, vite, --watch) için arka_plan: true '
      + 'ver: komut süre sınırı olmadan arka planda çalışır (her seferinde onay ister), kimliği döner; çıktısını surec_cikti ile oku, surec_durdur ile durdur.',
    sema: sema({
      komut: { type: 'string', description: 'Çalıştırılacak PowerShell komutu (ör. git status, npm test)' },
      klasor: { type: 'string', description: 'Çalışma klasörünün tam yolu (verilmezse Belgeler)' },
      arka_plan: { type: 'boolean', description: 'true: süre sınırı olmadan arka planda çalıştır (dev sunucusu, izleyici); her seferinde onay ister' },
    }, ['komut']),
  },
  async calistir(g, b) {
    const komut = typeof g.komut === 'string' ? g.komut.trim() : '';
    const arkaPlan = g.arka_plan === true;
    // İnceleme I3: telefondan gelen turda süre sınırsız süreç başlamaz — listesi, çıktısı ve Durdur'u yalnız masada (surec:* UZAKTAN_KAPALI).
    if (arkaPlan && b.uzak) return hata(ARKA_PLAN_UZAK_METNI);
    if (!komut) return hata('komut zorunlu (çalıştırılacak PowerShell komutu).');
    if (komut.length > KOMUT_UZUNLUK_SINIRI) return hata(`komut çok uzun (en çok ${binlik(KOMUT_UZUNLUK_SINIRI)} karakter); işi daha küçük komutlara böl.`);
    const k = klasorCoz(g.klasor);
    if ('hata' in k) return hata(k.hata);
    // Ağ yolundaki klasörde (\\sunucu\pay) her komut ağa çıkar.
    const agKlasoru = /^[\\/]{2}/.test(k.klasor);
    let s = komutSinifi(komut);
    if (agKlasoru && s.sinif === 'serbest') s = { sinif: 'onay', neden: 'ag' };
    const engel = kapiEngeli(komut, s, agKlasoru);
    if (engel) return engel;
    // Düzeltme turu 1-3 (git). `git`: SERBEST git komutu (sınıflayıcıya göre). Serbest git komutu git 2.36'dan eskiyse (sürüm okunamadıysa da), depo program
    // çalıştırabilecek ayar taşıyorsa (ya da okunamıyorsa) ya da boş hook klasörü hazırlanamazsa onay ister. Sertleştirme (gitOrtami + bayrak yeniden yazımı)
    // YALNIZ serbest kalan git komutuna uygulanır; onaylı git komutu kullanıcının yazdığı gibi, normal git davranışıyla (Husky, pre-commit, pre-push hook'ları
    // dahil) çalışır — onay kartı bunun iznidir; yalnız genel çocuk ortam süzgecinden geçer (denetleyici kararı, N2 geri alındı). Depo: çalışma klasörü,
    // -C'lerle çözülmüş.
    const git = serbestGitKomutu(komut);
    const depoKlasoru = git ? git.cKlasorleri.reduce((d, c) => path.resolve(d, c), k.klasor) : k.klasor;
    let yeniGit = false;
    let kartMetni: string | undefined;
    if (git && s.sinif === 'serbest') {
      yeniGit = surumYeterli(await gitSurumu());
      kartMetni = !yeniGit ? ESKI_GIT_METNI
        : depoRiskli(depoKlasoru) ? DEPO_PROGRAM_METNI
          : !hookKlasoruHazirla().temiz ? HOOK_KLASORU_METNI : undefined;
      if (kartMetni) s = { sinif: 'onay', neden: 'yikici' };
    }
    const serbestGit = git !== null && s.sinif === 'serbest' && !arkaPlan;
    if (s.sinif === 'onay' || arkaPlan) {
      const kart = s.sinif === 'onay' ? KART[s.neden ?? 'yikici'] : { aciklama: '', tehlike: 'orta' as const };
      // Düzeltme turu 4 (Y-4): yalnız biçim yüzünden (sarmalayıcı, çift tırnak, %, $) onaya düşen komutun kartı birden çok komut iddia etmez.
      const neden = s.sinif !== 'onay' ? '' : kartMetni ?? (s.neden === 'karmasik' && komutBicimdenOnay(komut) ? BICIM_METNI
        : s.neden === 'yikici' && projeKoduCalistirir(komut) ? PROJE_KODU_METNI : kart.aciklama);
      // Arka plan modu (bulgu 4): okuyan komut bile olsa sürekli çalışacağı için her seferinde onay; kart nedeni ve arka planı birlikte söyler.
      const aciklama = arkaPlan ? [neden, ARKA_PLAN_METNI].filter(Boolean).join(' ') : neden;
      const karar = await b.onay({
        baslik: arkaPlan ? 'Komut arka planda çalıştırılsın mı?' : 'Komut çalıştırılsın mı?', aciklama, tehlike: kart.tehlike,
        onizleme: `${komut}\n\nKlasör: ${k.klasor}`, // kesilmez (KOMUT_UZUNLUK_SINIRI)
      });
      if (karar === 'reddet') return hata('Kullanıcı onay vermedi (reddedildi): komut çalıştırılmadı.');
      const sonra = kapiEngeli(komut, s, agKlasoru); // kart beklenirken Gizli ya da "Yalnız bu bilgisayar" seçilmiş olabilir
      if (sonra) return sonra;
    }
    if (b.sinyal.aborted) return hata('Durduruldu; komut çalıştırılmadı.');
    if (arkaPlan) return arkaPlandaCalistir(komut, k.klasor, b.sohbetId);
    // Serbest git çağrısından HEMEN önce hook klasörü yeniden denetlenir; hazır değilse var olmayan bir yol verilir — serbest git hooksPath'siz çalışmaz,
    // kurcalanmış klasör hiç gösterilmez.
    const hook = serbestGit ? hookKlasoruHazirla() : undefined;
    // Minor 2: serbest komut (onay kartından geçmeyen) kullanıcının modül klasöründen PowerShell modülü yükleyemez (psModulOrtami).
    const serbest = s.sinif === 'serbest';
    const r = await komutuCalistir(serbestGit ? gitKomutunuSertlestir(komut) : komut, {
      klasor: k.klasor, sinyal: b.sinyal,
      ...(hook ? { ortam: (e: Record<string, string>) => psModulOrtami(gitOrtami(e, yeniGit, hook.yol)) } : serbest ? { ortam: psModulOrtami } : {}),
    });
    // N3: serbest status/diff/log/show (düzeltme turu 4: log ve show da) alt modülleri bastırır; depoda alt modül tanımlıysa bunu sonuçta tek satırla
    // söyler (model ağacı temiz sanmasın).
    const altModulNotu = serbestGit && GIT_YENIDEN_YAZILAN.has(git.altKomut) && altModulVar(depoKlasoru) ? ALT_MODUL_NOTU : undefined;
    return sonucMetni(r, k.klasor, altModulNotu);
  },
};

/** Arka plan modu: onaylı komut süre sınırı olmadan başlar (kullanıcının olağan ortamıyla, onaylı ön plan komutu gibi); ilk çıktı en çok ARKA_ILK_BEKLEME_MS beklenir. */
async function arkaPlandaCalistir(komut: string, klasor: string, sohbetId?: number): Promise<AracSonucu> {
  const { exe, args } = kabuk(komut);
  const r = arkaPlandaBaslat({ komut, klasor, exe, args, env: cocukOrtami(process.env, ILK_ORTAM), ...(typeof sohbetId === 'number' ? { sohbetId } : {}) });
  if (r.kimlik === undefined) return hata(r.hata);
  const son = Date.now() + ARKA_ILK_BEKLEME_MS;
  let c = surecCiktisi(r.kimlik, 30);
  while (Date.now() < son && c && c.surec.durum === 'calisiyor' && c.satirlar.filter((x) => x.trim()).length < 3) {
    await new Promise((z) => setTimeout(z, 200));
    c = surecCiktisi(r.kimlik, 30);
  }
  const o: SurecOzeti = c?.surec ?? r;
  const ilk = (c?.satirlar ?? []).join('\n').replace(/\s+$/, '');
  const durum = o.durum === 'calisiyor' ? `Arka planda çalışıyor (kimlik ${o.kimlik}; süre sınırı yok). Çıktı için surec_cikti, durdurmak için surec_durdur { kimlik: "${o.kimlik}" }.`
    : o.durum === 'hata' ? `Başlatılamadı: ${o.hata ?? 'bilinmeyen hata'}` : `Süreç hemen bitti (çıkış kodu ${o.kod ?? 'bilinmiyor'}).`;
  return { icerik: `${durum}\nKlasör: ${klasor}\n${ilk || '(henüz çıktı yok)'}`, ozet: o.durum === 'calisiyor' ? `arka planda · ${o.kimlik}` : `bitti · çıkış kodu ${o.kod ?? '?'}`, ...(o.durum === 'hata' ? { hata: true } : {}) };
}

/** surec_cikti: arka plan sürecinin son satırları ve hâli (salt okur). */
const surecCiktiAraci: Arac = {
  grup: KOMUT_GRUBU, risk: 'serbest',
  etiket: (g) => `Süreç çıktısına bakıyor: ${String(g.kimlik ?? '')}`,
  tanim: {
    ad: 'surec_cikti',
    aciklama: 'komut_calistir { arka_plan: true } ile başlatılan arka plan sürecinin hâlini ve son çıktı satırlarını döndürür. kimlik verilmezse çalışan süreçleri listeler.',
    sema: sema({
      kimlik: { type: 'string', description: 'Sürecin kimliği (ör. s1)' },
      satir: { type: 'number', description: 'Son kaç satır (en çok 200; varsayılan 60)' },
    }, []),
  },
  async calistir(g) {
    if (typeof g.kimlik !== 'string' || !g.kimlik.trim()) {
      const l = surecListesi();
      if (!l.length) return { icerik: 'Arka planda çalışan süreç yok.' };
      return { icerik: l.map((s) => `${s.kimlik} · ${s.durum}${s.durum !== 'calisiyor' ? ` (çıkış kodu ${s.kod ?? '?'})` : ''} · ${s.komut} · ${s.klasor}`).join('\n') };
    }
    const c = surecCiktisi(g.kimlik.trim(), typeof g.satir === 'number' ? g.satir : 60);
    if (!c) return hata(`Böyle bir süreç yok: ${g.kimlik}`);
    const s = c.surec;
    const bas = s.durum === 'calisiyor' ? `Çalışıyor (${s.kimlik})` : s.durum === 'durduruluyor' ? `Durduruluyor (${s.kimlik})` : s.durum === 'durduruldu' ? `Durduruldu (${s.kimlik})` : s.durum === 'hata' ? `Hata (${s.kimlik}): ${s.hata ?? ''}` : `Bitti (${s.kimlik}), çıkış kodu ${s.kod ?? 'bilinmiyor'}`;
    return { icerik: `${bas}\nKomut: ${s.komut}\nKlasör: ${s.klasor}\n${c.satirlar.join('\n').replace(/\s+$/, '') || '(çıktı yok)'}` };
  },
};

/** surec_durdur: arka plan sürecini ağacıyla durdurur (kullanıcının onayladığı süreci durdurmak geri dönüşsüz bir iş yapmaz). */
const surecDurdurAraci: Arac = {
  grup: KOMUT_GRUBU, risk: 'serbest',
  etiket: (g) => `Süreci durduruyor: ${String(g.kimlik ?? '')}`,
  tanim: {
    ad: 'surec_durdur',
    aciklama: 'komut_calistir { arka_plan: true } ile başlatılan arka plan sürecini (ve alt süreçlerini) durdurur.',
    sema: sema({ kimlik: { type: 'string', description: 'Sürecin kimliği (ör. s1)' } }, ['kimlik']),
  },
  async calistir(g) {
    const r = surecDurdur(typeof g.kimlik === 'string' ? g.kimlik.trim() : '');
    return r.tamam ? { icerik: `Durduruldu: ${String(g.kimlik)}` } : hata(r.hata ?? 'Durdurulamadı.');
  },
};

export function komutAraciniKaydet(): void { aracKaydet(komutAraci, surecCiktiAraci, surecDurdurAraci); }
