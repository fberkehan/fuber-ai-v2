// ── Geçmiş oturum dökümü (JSONL'nin SONUNDAN, sayfalı), "başka yerde açık" tespiti, projeler, proje CLAUDE.md'si ──────────────
// Electron'a bağlı değil. Claude Code dosyaları salt okunur (CLAUDE.md dışında: yalnız proje kökündeki dosya, çakışma denetimiyle).
// Dökümler 1 GB'ı bulabilir: SDK'nın getSessionMessages'i bütün dosyayı okuduğu için kullanılmaz; dosya sondan geriye 256 KB'lık
// parçalarla okunur, istenen sayıda konuşma satırı toplanınca durur ("Daha eskisi" için bayt imleci döner).
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { claudeDizini, type CcOturum } from './indeks.ts';
import { dokumSatiriOlaylari, yeniBaglam, CC_KIMLIK_RE as KIMLIK, type CcOlay } from '../../shared/cc-olay.ts';
import { ajanlardaAcik } from './yurutucu.ts';

/** ~/.claude/projects/<klasör>/<kimlik>.jsonl (FUBER_CLAUDE_DIZIN'e uyar). */
export function oturumDosyasiBul(kimlik: string): string | null {
  if (!KIMLIK.test(kimlik)) return null;
  const kok = path.join(claudeDizini(), 'projects');
  let klasorler: fs.Dirent[];
  try { klasorler = fs.readdirSync(kok, { withFileTypes: true }); } catch { return null; }
  for (const k of klasorler) {
    if (!k.isDirectory()) continue;
    const d = path.join(kok, k.name, `${kimlik}.jsonl`);
    if (fs.existsSync(d)) return d;
  }
  return null;
}

export interface DokumSayfasi {
  olaylar: { zaman: number; olay: CcOlay }[];
  /** Sonraki ("Daha eskisi") sayfa için bayt imleci; null = dosyanın başına gelindi. */
  once: number | null;
  boyut: number;
}

const PARCA = 256 * 1024;
const SATIR_SINIRI = 4 * 1024 * 1024;
const TARAMA_SINIRI = 48 * 1024 * 1024;
const KONUSMA = /"type":"(user|assistant)"/;

/**
 * Dosyanın `once` baytından (yoksa sonundan) geriye doğru `adet` konuşma satırı (user/assistant) toplar ve kronolojik sırayla
 * olaylara çevirir. Çok büyük satırlar (dev araç çıktısı) atlanır.
 */
export function dokumOku(dosya: string, o: { once?: number; adet?: number } = {}): DokumSayfasi {
  const boyut = fs.statSync(dosya).size;
  const adet = Math.min(500, Math.max(1, Math.floor(o.adet ?? 80)));
  let son = Math.min(boyut, Math.max(0, Math.floor(o.once ?? boyut)));
  const fd = fs.openSync(dosya, 'r');
  const satirlar: Buffer[] = []; // ters sırada
  // `kuyruk`: okunan parçanın ardından gelen ve DAHA ESKİ parçada başlayan yarım satır. `dev`: o satır SATIR_SINIRI'nı aştı; baytları
  // tutulmaz (1 GB'lık tek satır belleği doldurmasın), başı bulununca atlanır.
  let kuyruk: Buffer = Buffer.alloc(0);
  let dev = false;
  let konusma = 0;
  let taranan = 0;
  let imlec = son; // toplanan (ya da atlanan) en eski satırın başlangıcı
  const ekle = (satir: Buffer) => {
    satirlar.push(Buffer.from(satir));
    if (KONUSMA.test(satir.subarray(0, 800).toString('utf8'))) konusma++;
  };
  try {
    while (son > 0 && konusma < adet && taranan < TARAMA_SINIRI) {
      const bas = Math.max(0, son - PARCA);
      const b = Buffer.alloc(son - bas);
      fs.readSync(fd, b, 0, b.length, bas);
      taranan += b.length;
      const veri = dev ? b : Buffer.concat([b, kuyruk]);
      // Satırlar '\n' (0x0A) ile ayrılır; UTF-8'de bu bayt çok baytlı karakterin içinde geçmez.
      let sonNl = veri.length;
      let ilk = true;
      for (let i = veri.length - 1; i >= 0; i--) {
        if (veri[i] !== 0x0a) continue;
        const satir = veri.subarray(i + 1, sonNl);
        const atla = dev && ilk; // dev satırın başı
        if (atla) dev = false;
        ilk = false;
        sonNl = i;
        imlec = bas + i + 1;
        if (!atla && satir.length && satir.length <= SATIR_SINIRI) ekle(satir);
        if (konusma >= adet) break;
      }
      if (konusma >= adet) break;
      if (!(dev && ilk)) { // parçada satır sonu yoksa ve dev satır sürüyorsa kuyruk boş kalır
        kuyruk = Buffer.from(veri.subarray(0, sonNl));
        if (kuyruk.length > SATIR_SINIRI) { kuyruk = Buffer.alloc(0); dev = true; }
      }
      son = bas;
      if (son === 0) { // dosyanın ilk satırı
        if (!dev && kuyruk.length) ekle(kuyruk);
        imlec = 0;
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  const b = yeniBaglam();
  const olaylar: DokumSayfasi['olaylar'] = [];
  for (let i = satirlar.length - 1; i >= 0; i--) {
    let j: Record<string, unknown>;
    try { j = JSON.parse(satirlar[i].toString('utf8')); } catch { continue; }
    const zaman = typeof j.timestamp === 'string' ? Date.parse(j.timestamp) || 0 : 0;
    for (const olay of dokumSatiriOlaylari(j, b)) olaylar.push({ zaman, olay });
  }
  return { olaylar, once: imlec > 0 ? imlec : null, boyut };
}

// ── Başka yerde açık mı (K17) ────────────────────────────────────────────────────────────────────────────────────────────────
export const YAKIN_YAZIM_MS = 90_000;
/** Kendi sürecimiz kapanırken JSONL'ye son yazımı bu pay içinde sayılır (kapandıktan sonraki yazım başkasınındır). */
export const KENDI_YAZIM_PAYI_MS = 3_000;
export interface BaskaYerde { acik: boolean; neden?: 'yakin-yazildi' | 'etkin-ajan' }
export interface BizimIzler {
  /** Uygulamada süreci ŞU AN yaşayan oturum kimlikleri (çatalın kaynağı değil, kendi kimliği). */
  canli: Set<string>;
  /** Kimlik → bizim sürecimizin o oturumda son kapandığı an. */
  kapanislar?: Map<string, number>;
  /** Bizim Claude Code süreçlerimizin PID'leri (`claude agents` bizim süreçlerimizi de listeler). */
  pidler?: Set<number>;
}

/**
 * Oturum bu uygulamanın DIŞINDA açık görünüyor mu (K17; düzeltme 1):
 *  • Uygulamada süreci yaşayan oturum bizimdir → hayır.
 *  • `claude agents --json`'da bu sessionId bizim olmayan bir süreçte (açık terminal dahil) → evet.
 *  • JSONL son 90 sn içinde yazılmış ve bu yazım bizim sürecimizin son kapanışından (+3 sn) SONRA → evet (uygulamada kapatılıp
 *    terminalde sürdürülen oturum yakalanır; kendi kapanış yazımımız sayılmaz).
 */
export async function baskaYerdeAcik(kimlik: string, bizim: BizimIzler, ajanMetni: () => Promise<string>, simdi = Date.now()): Promise<BaskaYerde> {
  if (bizim.canli.has(kimlik)) return { acik: false };
  const d = oturumDosyasiBul(kimlik);
  if (d) {
    try {
      const m = fs.statSync(d).mtimeMs;
      const kapanis = bizim.kapanislar?.get(kimlik);
      const bizimYazimimiz = kapanis !== undefined && m <= kapanis + KENDI_YAZIM_PAYI_MS;
      if (simdi - m < YAKIN_YAZIM_MS && !bizimYazimimiz) return { acik: true, neden: 'yakin-yazildi' };
    } catch { /* silinmiş */ }
  }
  const metin = await ajanMetni().catch(() => '');
  if (ajanlardaAcik(metin, kimlik, bizim.pidler)) return { acik: true, neden: 'etkin-ajan' };
  return { acik: false };
}

/** CLAUDE.md, "Klasörü aç", "@" önerisi ve telefondan oturum yalnız BİLİNEN proje köklerinde (oturum geçmişi, açık oturum, seçilen
 *  klasör). Eşleşen bilinen yolu döner; değilse fırlatır. */
export function bilinenProjeKlasoru(cwd: unknown, bilinenler: string[]): string {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd)) throw new Error('Geçersiz proje klasörü.');
  const ayni = (a: string) => (process.platform === 'win32' ? path.resolve(a).toLowerCase() : path.resolve(a));
  const hedef = ayni(cwd);
  const k = bilinenler.filter(Boolean).find((b) => ayni(b) === hedef);
  if (!k) throw new Error('Bu klasör bilinen bir Claude Code projesi değil.');
  if (!fs.existsSync(k) || !fs.statSync(k).isDirectory()) throw new Error('Klasör bulunamadı.');
  return k;
}

/**
 * "@" dosya önerisi: en çok `n` (50) yol. Sıra: yolun başı → dosya adının başı → bir klasör adının başı → içinde geçen → harf sırası
 * korunarak dağınık eşleşme (bulanık); eşitlikte kısa yol önce. Boş sorgu: en sığ yollar.
 */
export function dosyaEslestir(liste: string[], sorgu: string, n = 50): string[] {
  const q = sorgu.trim().toLowerCase().replace(/\\/g, '/').replace(/^@/, '');
  const derinlik = (p: string) => p.split('/').length;
  if (!q) return liste.slice().sort((a, b) => derinlik(a) - derinlik(b) || a.localeCompare(b)).slice(0, n);
  const puanli: { p: string; puan: number }[] = [];
  for (const p of liste) {
    const k = p.toLowerCase();
    const ad = k.slice(k.lastIndexOf('/') + 1);
    let puan = -1;
    if (k.startsWith(q)) puan = 0;
    else if (ad.startsWith(q)) puan = 1;
    else if (k.split('/').some((s) => s.startsWith(q))) puan = 2;
    else if (k.includes(q)) puan = 3;
    else {
      let i = 0, bosluk = 0, son = -1;
      for (let j = 0; j < k.length && i < q.length; j++) if (k[j] === q[i]) { if (son >= 0) bosluk += j - son - 1; son = j; i++; }
      if (i === q.length) puan = 4 + Math.min(bosluk, 500) / 1000;
    }
    if (puan >= 0) puanli.push({ p, puan });
  }
  return puanli.sort((a, b) => a.puan - b.puan || a.p.length - b.p.length || a.p.localeCompare(b.p)).slice(0, n).map((x) => x.p);
}

// ── Projeler ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface CcProje { cwd: string; ad: string; sonEtkinlik?: string; oturumSayisi: number; dal?: string; claudeMd: boolean; var: boolean }

export function projeleriTopla(oturumlar: CcOturum[], ekKlasorler: string[] = []): CcProje[] {
  const harita = new Map<string, CcProje>();
  const anahtar = (c: string) => path.resolve(c).toLowerCase();
  for (const o of oturumlar) {
    if (!o.cwd) continue;
    const k = anahtar(o.cwd);
    const p = harita.get(k) ?? { cwd: o.cwd, ad: path.basename(o.cwd), oturumSayisi: 0, claudeMd: false, var: false };
    p.oturumSayisi++;
    if ((o.sonZaman ?? '') > (p.sonEtkinlik ?? '')) { p.sonEtkinlik = o.sonZaman; p.dal = o.dal; }
    harita.set(k, p);
  }
  for (const c of ekKlasorler) {
    const k = anahtar(c);
    if (!harita.has(k)) harita.set(k, { cwd: c, ad: path.basename(c), oturumSayisi: 0, claudeMd: false, var: false, sonEtkinlik: new Date().toISOString() });
  }
  const liste = [...harita.values()];
  for (const p of liste) {
    try { p.var = fs.statSync(p.cwd).isDirectory(); } catch { p.var = false; }
    p.claudeMd = p.var && fs.existsSync(path.join(p.cwd, 'CLAUDE.md'));
  }
  return liste.sort((a, b) => (b.sonEtkinlik ?? '').localeCompare(a.sonEtkinlik ?? ''));
}

// ── Proje CLAUDE.md'si (yalnız proje kökündeki dosya) ─────────────────────────────────────────────────────────────────────────
export const CLAUDE_MD_SINIRI = 1024 * 1024;
const ozetle = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export interface ClaudeMd { yol: string; var: boolean; icerik: string; ozet: string }

export function claudeMdOku(cwd: string): ClaudeMd {
  const yol = path.join(path.resolve(cwd), 'CLAUDE.md');
  let icerik = '';
  let var_ = false;
  try {
    const st = fs.statSync(yol);
    if (st.isFile()) {
      if (st.size > CLAUDE_MD_SINIRI) throw new Error('CLAUDE.md çok büyük (1 MB üstü).');
      icerik = fs.readFileSync(yol, 'utf8');
      var_ = true;
    }
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  return { yol, var: var_, icerik, ozet: ozetle(icerik) };
}

/**
 * Yazar: `beklenenOzet` okunduğu andaki içeriğin özetidir — dosya o arada değiştiyse YAZILMAZ ('degisti'). Atomik (geçici dosya +
 * yeniden adlandırma).
 */
export function claudeMdYaz(cwd: string, icerik: string, beklenenOzet: string | undefined): { tamam: boolean; kod?: 'degisti' | 'buyuk'; ozet?: string } {
  if (Buffer.byteLength(icerik, 'utf8') > CLAUDE_MD_SINIRI) return { tamam: false, kod: 'buyuk' };
  const simdiki = claudeMdOku(cwd);
  if (beklenenOzet !== undefined && beklenenOzet !== simdiki.ozet) return { tamam: false, kod: 'degisti' };
  const gecici = path.join(path.dirname(simdiki.yol), `.CLAUDE.md.${randomUUID().slice(0, 8)}.tmp`);
  fs.writeFileSync(gecici, icerik, 'utf8');
  try { fs.renameSync(gecici, simdiki.yol); } catch (e) { try { fs.rmSync(gecici, { force: true }); } catch { /* yok */ } throw e; }
  return { tamam: true, ozet: ozetle(icerik) };
}
