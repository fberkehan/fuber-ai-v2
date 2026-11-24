// ── İndirme yardımcısı: akışla indir, SHA-256 doğrula, zip aç ───────────────────────────────────────────────────
// Yerel model/çalıştırıcı kurulumları kullanır. Dosya önce `.indiriliyor` adıyla yazılır; özet tutmazsa silinir, tutarsa
// yerine taşınır ve yanına `.dogrulandi` işareti bırakılır (sonraki kurulumda 7 GB'ı yeniden özetlemeyelim diye).
// Yazma hatası (disk doldu: ENOSPC) beklenen her noktada yakalanır — 'drain' beklerken de: eskiden 'error' dinleyicisi yoktu ve
// 'drain' hiç gelmediğinden indirme sonsuza dek asılı kalıyor, bütün kurulum düğmeleri yeniden başlatmaya dek kilitleniyordu. Hata ya da
// durdurma (AbortSignal) olunca ağ okuması bırakılır, yarım dosya silinir; disk dolduysa ileti "Diskte yer kalmadı.".
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Writable } from 'node:stream';

export type Ilerleme = (gelen: number, toplam: number) => void;
/** Özet tuttuktan sonra, dosya yerine konmadan son söz (`gecici`: tam dosya, `bayt`: inen bayt). Fırlatırsa dosya silinir, var olan `hedef` ve işareti yerinde kalır. */
export type SonDenetim = (gecici: string, bayt: number) => void | Promise<void>;

/** Okunan parça kaynağı (fetch gövdesinin okuyucusu ya da testte sahtesi). */
export interface ParcaOkuyucu { read(): Promise<{ value?: Uint8Array; done: boolean }>; cancel?(neden?: unknown): Promise<void> | void }

const durduruldu = () => Object.assign(new Error('İndirme durduruldu.'), { name: 'AbortError' });

/**
 * Okuyucudan gelen parçaları yazıcıya yazar (her parça `her` ile de verilir: özet, ilerleme). Yazıcı hata verirse — parça yazarken,
 * 'drain' beklerken ya da kapanırken — hemen reddeder (asılı kalmaz); yazıcı erken kapanırsa da. Durdurma sinyalinde okumayı bırakır.
 * Yazılan bayt sayısını döner. Yazıcıyı kapatmaz/silmez: çağıran temizler.
 */
export async function akisaYaz(okuyucu: ParcaOkuyucu, yaz: Writable, her?: (p: Uint8Array) => void, sinyal?: AbortSignal): Promise<number> {
  let hata: Error | null = null;
  let uyandir: ((e: Error) => void) | null = null;
  // Dinleyici kalıcı: sonradan gelen 'error' da yakalanır (dinleyicisiz 'error' süreci düşürürdü).
  yaz.on('error', (e: Error) => { hata ??= e; uyandir?.(e); });
  const denetle = () => {
    if (hata) throw hata;
    if (sinyal?.aborted) throw durduruldu();
  };
  let gelen = 0;
  for (;;) {
    denetle();
    const { value, done } = await okuyucu.read();
    denetle(); // durdurulan okuma "bitti" diye dönebilir: tamamlanmış sayılmaz
    if (done) break;
    if (!value?.length) continue;
    her?.(value);
    gelen += value.length;
    if (!yaz.write(value)) {
      await new Promise<void>((coz, reddet) => {
        if (hata) { reddet(hata); return; }
        const temizle = () => { yaz.off('drain', bosaldi); yaz.off('close', kapandi); sinyal?.removeEventListener('abort', durdu); uyandir = null; };
        const bosaldi = () => { temizle(); coz(); };
        const kapandi = () => { temizle(); reddet(hata ?? new Error('Dosya yazımı yarıda kesildi.')); };
        const durdu = () => { temizle(); reddet(durduruldu()); };
        uyandir = (e) => { temizle(); reddet(e); };
        yaz.once('drain', bosaldi);
        yaz.once('close', kapandi);
        sinyal?.addEventListener('abort', durdu, { once: true });
      });
    }
  }
  await new Promise<void>((coz, reddet) => {
    if (hata) { reddet(hata); return; }
    uyandir = reddet;
    yaz.end((h?: Error | null) => { uyandir = null; if (h ?? hata) reddet(h ?? hata!); else coz(); });
  });
  denetle();
  return gelen;
}

/** Yazıcıyı kapatır ve 'close'u bekler (zaten kapandıysa hemen; en çok `ms`). */
function yaziciKapansin(yaz: Writable, ms = 3000): Promise<void> {
  return new Promise<void>((coz) => {
    if ((yaz as Writable & { closed?: boolean }).closed) { coz(); return; }
    const son = () => { clearTimeout(z); coz(); };
    const z = setTimeout(son, ms);
    yaz.once('close', son);
    yaz.destroy();
  });
}

/** Dosya sistemi hatasının kullanıcıya iletisi (disk doldu → "Diskte yer kalmadı."). */
function yazmaHatasi(e: unknown): Error {
  const kod = (e as { code?: unknown } | null)?.code;
  if (kod === 'ENOSPC') return Object.assign(new Error('Diskte yer kalmadı.'), { code: 'ENOSPC' });
  return e instanceof Error ? e : new Error(String(e));
}

/**
 * `url`'i `hedef`e indirir (önce `.indiriliyor`), SHA-256'yı doğrular. Hata ya da durdurmada yarım dosya silinir ve okuma bırakılır.
 * `yaziciAc`: testte sahte yazıcı (ör. disk doluymuş gibi hata veren) için; üretimde fs.createWriteStream. Hata kodları: 'SHA' özet tutmadı, 'BUYUK' `azamiBayt` aşıldı.
 */
export async function indir(url: string, hedef: string, sha256?: string, ilerleme?: Ilerleme, sinyal?: AbortSignal, yaziciAc: (yol: string) => Writable = (y) => fs.createWriteStream(y), azamiBayt?: number, sonDenetim?: SonDenetim): Promise<void> {
  if (sinyal?.aborted) throw durduruldu();
  const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Fuber-AI' }, signal: sinyal });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}: ${url}`);
  const toplam = Number(r.headers.get('content-length') ?? 0);
  // Üst sınır (verildiyse): bildirilen boyut aşıyorsa hiç başlamaz; bildirilmeyen/yanlış bildirilen akış sınırı geçtiği an KESİLİR.
  const buyuk = (n: number) => Object.assign(new Error(`dosya beklenenden büyük (${n} > ${azamiBayt} bayt)`), { code: 'BUYUK' });
  if (azamiBayt !== undefined && toplam > azamiBayt) { void Promise.resolve(r.body.cancel()).catch(() => undefined); throw buyuk(toplam); }
  const gecici = `${hedef}.indiriliyor`;
  const ozet = createHash('sha256');
  let gelen = 0, son = 0;
  const okuyucu = r.body.getReader();
  const birak = () => { void Promise.resolve(okuyucu.cancel()).catch(() => undefined); };
  sinyal?.addEventListener('abort', birak, { once: true });
  const yaz = yaziciAc(gecici);
  try {
    await akisaYaz(okuyucu, yaz, (p) => {
      if (azamiBayt !== undefined && gelen + p.length > azamiBayt) throw buyuk(gelen + p.length);
      ozet.update(p);
      gelen += p.length;
      if (ilerleme && Date.now() - son > 300) { son = Date.now(); ilerleme(gelen, toplam); }
    }, sinyal);
  } catch (e) {
    birak();
    // Yarım dosya, yazıcının tutamağı KAPANDIKTAN sonra silinir (Windows'ta açık dosya silinemez ya da "silinmeyi bekler" kalır;
    // klasörü kaldırma EBUSY verirdi — Görev 20b). Kapanış en çok 3 sn beklenir.
    await yaziciKapansin(yaz);
    fs.rmSync(gecici, { force: true });
    throw yazmaHatasi(e);
  } finally {
    sinyal?.removeEventListener('abort', birak);
  }
  const sha = ozet.digest('hex');
  if (sha256 && sha !== sha256.toLowerCase()) { fs.rmSync(gecici, { force: true }); throw Object.assign(new Error(`SHA-256 doğrulanamadı: ${hedef.split(/[\\/]/).pop()} (dosya bozuk ya da değiştirilmiş)`), { code: 'SHA' }); }
  if (sonDenetim) {
    try { await sonDenetim(gecici, gelen); } catch (e) { fs.rmSync(gecici, { force: true }); throw e; }
  }
  fs.renameSync(gecici, hedef);
  if (sha256) fs.writeFileSync(`${hedef}.dogrulandi`, sha);
  ilerleme?.(gelen, toplam || gelen);
}

/** Dosya zaten var ve (varsa) özeti doğrulanmış mı? Boyut tutuyor ama işaret yoksa bir kez özetlenir. */
export async function hazirMi(hedef: string, boyut?: number, sha256?: string): Promise<boolean> {
  if (!fs.existsSync(hedef)) return false;
  if (boyut && fs.statSync(hedef).size !== boyut) return false;
  if (!sha256) return true;
  const isaret = `${hedef}.dogrulandi`;
  if (fs.existsSync(isaret) && fs.readFileSync(isaret, 'utf8').trim() === sha256) return true;
  const ozet = createHash('sha256');
  await new Promise<void>((c, e) => fs.createReadStream(hedef).on('data', (p) => ozet.update(p)).on('end', () => c()).on('error', e));
  if (ozet.digest('hex') !== sha256) return false;
  fs.writeFileSync(isaret, sha256);
  return true;
}

/** Dosyanın ilk 4 baytı GGUF mu. Okunamazsa null: karar verilemez, çağıran dosyayı silmez (virüs tarayıcısı kısa süre kilitlemiş olabilir). */
export function ggufBasligi(yol: string): boolean | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(yol, 'r');
    const b = Buffer.alloc(4);
    return fs.readSync(fd, b, 0, 4, 0) === 4 && b.toString('latin1') === 'GGUF';
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* zaten kapalı */ }
  }
}

/** Windows'ta yerleşik bsdtar zip açar (ek bağımlılık yok). */
export function zipAc(zip: string, klasor: string): Promise<void> {
  fs.mkdirSync(klasor, { recursive: true });
  // Windows'un kendi bsdtar'ı (zip açar). PATH'te Git'in GNU tar'ı öne geçebiliyor: o zip açamaz.
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  return new Promise((c, e) => execFile(fs.existsSync(tar) ? tar : 'tar', ['-xf', zip, '-C', klasor], { windowsHide: true }, (h) => (h ? e(h) : c())));
}

/** Klasörde (alt klasörler dahil) adı eşleşen ilk dosya. */
export function dosyaBul(klasor: string, ad: RegExp): string | null {
  if (!fs.existsSync(klasor)) return null;
  for (const x of fs.readdirSync(klasor, { withFileTypes: true })) {
    const y = `${klasor}/${x.name}`;
    if (x.isDirectory()) { const z = dosyaBul(y, ad); if (z) return z; } else if (ad.test(x.name)) return y;
  }
  return null;
}
