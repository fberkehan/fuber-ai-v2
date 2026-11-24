// ── Klasör güveni (son dalga B, I1): klasörün KENDİ Claude Code ayarları — kancalar, izin kuralları, MCP sunucuları, komut/beceri/ajan ─
// Başsız (SDK) Claude Code, terminaldeki "Bu klasöre güveniyor musun?" sorusunu SORMAZ: settingSources verilmezse yeni klonlanmış bir
// deponun .claude/settings.json kancaları ilk oturumda çalışır, allow kuralları geçerli olur, .mcp.json sunucuları başlar. Fuber kendi
// kartını gösterir (Claude Code sayfası, claudecode/KlasorGuveni.tsx) ve kararı klasör başına KENDİ veri klasöründe saklar.
//  • Karar ayarlar.json'da DEĞİL: ayarlar:kaydet telefona açık (kopru-protokol.ts uzakAyarSuz). Bu dosyaya yalnız bilgisayarın başındaki
//    'claudecode:klasor-guveni' kanalı yazar (UZAKTAN_KAPALI) — telefon güven kartını yanıtlayamaz, karar veremez.
//  • Güvenilmeyen ya da kararı verilmemiş klasör (oturum-yoneticisi.ts): settingSources ['user'] (proje + yerel kaynak YOK: kancalar,
//    izin kuralları, CLAUDE.md, komut/beceri/ajanlar yüklenmez) ve .mcp.json varsa strictMcpConfig (klasörün MCP sunucuları başlamaz).
//  • Hangi dosyalar (Claude Code 2.1.310 ikilisinden okundu): proje ayarı cwd/.claude/settings.json; yerel ayar cwd ya da git kökünde
//    .claude/settings.local.json; .mcp.json cwd'den yukarı her klasörde. Kullanıcının kendi ~/.claude'u (cwd = ev klasörü) sayılmaz.
// Electron'a bağlı değil: depo dosyasının yolu dışarıdan verilir (main/claudecode/yonetim.ts).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

export type GuvenKarari = 'guven' | 'guvenme';
export interface KlasorAyarDosyasi {
  /** Görünen göreli ad (ör. `.claude/settings.json`, `../.mcp.json`). */
  ad: string;
  tur: 'proje' | 'yerel' | 'mcp' | 'ozellestirme';
  /** Ne içerdiği (Türkçe, kısa): "kancalar: SessionStart · 2 izin kuralı". */
  ozet: string;
}
export interface KlasorAyarlari {
  dosyalar: KlasorAyarDosyasi[]; mcp: boolean;
  /** Düzeltme turu (N3): taranan dosya kümesinin parmak izi (adlar + içerikler, SHA-256). Karar bununla saklanır; değişince yeniden sorulur. */
  parmakIzi: string;
  /** Düzeltme turu 2: bütçe aşıldı (çok dosya / çok büyük) → iz çıkarılamadı; "güven" kararı saklanmaz, ayarlar yüklenmez. */
  sinirsiz?: boolean;
}
export interface KlasorGuvenDurumu extends KlasorAyarlari {
  cwd: string; gerekli: boolean; karar?: GuvenKarari;
  /** Karar vardı ama klasörün ayarları o karardan sonra değişti (ör. `git pull` yeni kanca getirdi): karar yok sayılır, kart yeniden sorar. */
  degisti?: boolean;
}
/** Depodaki kayıt (ya da testlerde yalnız karar). */
export type GuvenKaydi = GuvenKarari | { karar: GuvenKarari; parmakIzi?: string };

const OKUMA_SINIRI = 512 * 1024;
const DERINLIK = 40;
/** Görünen metinde denetim ve yön karakterleri yok (dosya içeriği güvenilmez). */
const temiz = (s: unknown, n = 40): string => {
  const t = String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const dosyaMi = (p: string) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const klasorMu = (p: string) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const ayni = (a: string, b: string) => (process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));
const nesne = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x);

function jsonOku(p: string): { j?: Record<string, unknown>; hata?: string } {
  try {
    const st = fs.statSync(p);
    if (st.size > OKUMA_SINIRI) return { hata: 'çok büyük; okunmadı' };
    const j = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\ufeff/, '')) as unknown;
    return nesne(j) ? { j } : { hata: 'beklenmeyen biçim' };
  } catch { return { hata: 'okunamadı (bozuk JSON)' }; }
}

const liste = (adlar: string[], n = 4) => adlar.slice(0, n).map((x) => temiz(x, 32)).join(', ') + (adlar.length > n ? ` +${adlar.length - n}` : '');

/** settings(.local).json içinden kart için kısa özet: kancalar, izin kuralları, ortam, eklenti, yardımcı komutlar. */
export function ayarOzeti(j: Record<string, unknown>): string {
  const p: string[] = [];
  if (nesne(j.hooks)) { const k = Object.keys(j.hooks).filter((x) => Array.isArray((j.hooks as Record<string, unknown>)[x])); if (k.length) p.push(`kancalar: ${liste(k)}`); }
  if (j.disableAllHooks === true) p.push('kancalar kapalı');
  const izin = nesne(j.permissions) ? j.permissions : {};
  const say = (x: unknown) => (Array.isArray(x) ? x.length : 0);
  if (say(izin.allow)) p.push(`${say(izin.allow)} izin kuralı`);
  if (say(izin.ask) || say(izin.deny)) p.push(`${say(izin.ask) + say(izin.deny)} sorma/yasak kuralı`);
  if (typeof izin.defaultMode === 'string') p.push(`varsayılan mod: ${temiz(izin.defaultMode, 20)}`);
  if (say(izin.additionalDirectories)) p.push(`${say(izin.additionalDirectories)} ek klasör`);
  if (nesne(j.env) && Object.keys(j.env).length) p.push(`${Object.keys(j.env).length} ortam değişkeni`);
  if (nesne(j.enabledPlugins) && Object.keys(j.enabledPlugins).length) p.push(`${Object.keys(j.enabledPlugins).length} eklenti`);
  if (j.enableAllProjectMcpServers === true || say(j.enabledMcpjsonServers)) p.push('MCP sunucularını açar');
  for (const [a, ad] of [['apiKeyHelper', 'anahtar yardımcısı'], ['statusLine', 'durum satırı komutu'], ['awsAuthRefresh', 'AWS komutu'], ['otelHeadersHelper', 'başlık yardımcısı']] as const) if (j[a] !== undefined) p.push(ad);
  return p.length ? p.join(' · ') : 'ayar dosyası';
}

/** .mcp.json özeti: sunucu adları. */
function mcpOzeti(j: Record<string, unknown>): string {
  const s = nesne(j.mcpServers) ? Object.keys(j.mcpServers) : [];
  return s.length ? `MCP sunucuları: ${liste(s)}` : 'MCP yapılandırması';
}

function gitKoku(cwd: string): string | null {
  let d = path.resolve(cwd);
  for (let i = 0; i < DERINLIK; i++) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    const ust = path.dirname(d);
    if (ust === d) return null;
    d = ust;
  }
  return null;
}

/**
 * Klasörün kendi Claude Code ayarları. `kullaniciDizini`: kullanıcının ~/.claude'u (FUBER_CLAUDE_DIZIN) — cwd ev klasörüyse oradaki
 * settings.json KULLANICI ayarıdır, klasörün değil.
 */
// ── Parmak izi bütçesi (düzeltme turu 2): bir parmak izinde en çok 400 girdi (dosya + klasör, TOPLAM) ve 4 MB; tek dosya en çok 512 KB.
// Aşılırsa iz "sınırsız" olur: güven kararı kabul edilmez (yeniden sorulur), "güvenme" geçerli kalır — sessizce kabul yok.
export const IZ_AZAMI_GIRDI = 400;
export const IZ_AZAMI_BAYT = 4 * 1024 * 1024;
export const IZ_SINIRSIZ = 'sinirsiz';
interface IzButcesi { girdi: number; bayt: number; sinirsiz: boolean; gorulen: Set<string> }
/** İçerik özeti önbelleği: (yol, mtime, ctime, boyut) → SHA-256 — ctime `utimes` ile geri alınamaz; aynı dosya her çağrıda yeniden okunmaz. */
const ozetOnbellegi = new Map<string, string>();
const ONBELLEK_AZAMI = 4000;
/** Testler için: önbellekteki kayıt sayısı. */
export const izOnbellekBoyu = () => ozetOnbellegi.size;

/** Dosyayı bütçeyle izlere ekler (aynı dosya bir kez); bütçe aşılınca `sinirsiz`. */
function izEkle(p: string, gor: (p: string) => string, izler: string[], b: IzButcesi): void {
  if (b.sinirsiz) return;
  const anahtar = kucuk(path.resolve(p));
  if (b.gorulen.has(anahtar)) return;
  b.gorulen.add(anahtar);
  let st: fs.Stats;
  try { st = fs.statSync(p); } catch { izler.push(`${gor(p)}|okunamadi`); return; }
  b.girdi++;
  b.bayt += st.size;
  if (b.girdi > IZ_AZAMI_GIRDI || st.size > OKUMA_SINIRI || b.bayt > IZ_AZAMI_BAYT) { b.sinirsiz = true; return; }
  const k = `${anahtar}|${st.mtimeMs}|${st.ctimeMs}|${st.size}`;
  let ozet = ozetOnbellegi.get(k);
  if (!ozet) {
    try { ozet = createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } catch { ozet = 'okunamadi'; }
    ozetOnbellegi.set(k, ozet);
    while (ozetOnbellegi.size > ONBELLEK_AZAMI) ozetOnbellegi.delete(ozetOnbellegi.keys().next().value as string);
  }
  izler.push(`${gor(p)}|${ozet}`);
}
/** Klasördeki dosyalar, derinlik ve TOPLAM girdi bütçesiyle (klasörler de sayılır). */
function klasorIzleri(kok: string, gor: (p: string) => string, izler: string[], b: IzButcesi, derinlik = 0): void {
  if (b.sinirsiz) return;
  if (derinlik > 6) { b.sinirsiz = true; return; }
  let g: fs.Dirent[] = [];
  try { g = fs.readdirSync(kok, { withFileTypes: true }); } catch { return; }
  for (const e of g.sort((x, y) => x.name.localeCompare(y.name))) {
    if (b.sinirsiz) return;
    const p = path.join(kok, e.name);
    if (e.isDirectory()) { if (++b.girdi > IZ_AZAMI_GIRDI) { b.sinirsiz = true; return; } izler.push(`${gor(p)}/`); klasorIzleri(p, gor, izler, b, derinlik + 1); }
    else if (e.isFile()) izEkle(p, gor, izler, b);
    // Düzeltme turu 3 (F): .claude/ içinde bağlantı (symlink/junction) ya da özel girdi → içeriği izlenemez (bağlantının hedefi sessizce
    // değişebilir); iz "sınırsız": güven kararı kabul edilmez, kart yeniden sorar.
    else { b.sinirsiz = true; return; }
  }
}
/** Girdi bağlantı mı (symlink ya da junction; izlenmez, hedefine gidilmez). */
const baglantiMi = (p: string) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };
/**
 * settings(.local).json kanca komutlarının çalıştırdığı, PROJENİN İÇİNDEKİ dosyalar: `.claude/<yol>` (ör. "$CLAUDE_PROJECT_DIR"/.claude/hooks/x.sh)
 * ve düzeltme turu 3 (F) ile `.claude/` dışındakiler de (ör. `node tools/kanca.js`, `"$CLAUDE_PROJECT_DIR"/scripts/x.sh`). Kanca komutu
 * proje klasöründe çalışır; göreli parça projeye göre çözülür. Proje dışındaki yollar klasörün dosyası değildir (sayılmaz).
 */
function kancaDosyalari(j: Record<string, unknown> | undefined, kok: string): string[] {
  if (!j || !nesne(j.hooks)) return [];
  const komutlar: string[] = [];
  const gez = (x: unknown, d = 0) => {
    if (d > 8) return;
    if (Array.isArray(x)) for (const y of x) gez(y, d + 1);
    else if (nesne(x)) for (const [k, v] of Object.entries(x)) { if (k === 'command' && typeof v === 'string') komutlar.push(v); else gez(v, d + 1); }
  };
  gez(j.hooks);
  const ozel = path.join(kok, '.claude');
  const out = new Set<string>();
  const ekle = (tam: string) => { if (out.size < IZ_AZAMI_GIRDI && dosyaMi(tam)) out.add(tam); };
  for (const c of komutlar.slice(0, 200)) {
    // Komut içindeki her `.claude/<yol>` (önünde "$CLAUDE_PROJECT_DIR", tırnak, ./ ya da mutlak yol olabilir) projenin .claude'una göre.
    for (const m of c.matchAll(/\.claude[\\/]+([^\s"'`;|&<>()]+)/gi)) {
      const tam = path.resolve(ozel, m[1]);
      if (iceride(ozel, tam)) ekle(tam);
    }
    // Komutun yol gibi görünen her parçası (ayraç ya da uzantı içeren): proje değişkeni proje köküyle, tırnaklar silinir, `--x=yol`'un yolu.
    const duz = c.replace(/\$\{?CLAUDE_PROJECT_DIR\}?|%CLAUDE_PROJECT_DIR%/g, '.').replace(/["'`]/g, '');
    for (const parca of duz.split(/[\s;|&<>()]+/).slice(0, 64)) {
      const y = parca.includes('=') ? parca.slice(parca.lastIndexOf('=') + 1) : parca;
      if (!y || y.startsWith('-') || !(/[\\/]/.test(y) || /\.[A-Za-z0-9]{1,8}$/.test(y))) continue;
      const tam = path.resolve(kok, y);
      if (iceride(kok, tam)) ekle(tam);
    }
  }
  return [...out];
}

export function klasorAyarlariniBul(cwd: string, kullaniciDizini?: string): KlasorAyarlari {
  const kok = path.resolve(cwd);
  const dosyalar: KlasorAyarDosyasi[] = [];
  const izler: string[] = [];
  const b: IzButcesi = { girdi: 0, bayt: 0, sinirsiz: false, gorulen: new Set() };
  const gor = (p: string) => (path.relative(kok, p) || path.basename(p)).split(path.sep).join('/');
  const kullanicininMi = (claudeKlasoru: string) => Boolean(kullaniciDizini) && ayni(claudeKlasoru, kullaniciDizini!);
  const kancalar: string[] = [];
  const ayarEkle = (p: string, tur: 'proje' | 'yerel') => {
    if (!dosyaMi(p) || kullanicininMi(path.dirname(p)) || dosyalar.some((d) => d.ad === gor(p))) return;
    const r = jsonOku(p);
    dosyalar.push({ ad: gor(p), tur, ozet: r.j ? ayarOzeti(r.j) : r.hata! });
    // Düzeltme turu 3 (F): ayar dosyası ya da .claude klasörü bağlantıysa iz sınırsız (hedefi sessizce başka bir dosyaya çevrilebilir).
    if (baglantiMi(p) || baglantiMi(path.dirname(p))) b.sinirsiz = true;
    izEkle(p, gor, izler, b);
    kancalar.push(...kancaDosyalari(r.j, path.dirname(path.dirname(p))));
  };
  ayarEkle(path.join(kok, '.claude', 'settings.json'), 'proje');
  ayarEkle(path.join(kok, '.claude', 'settings.local.json'), 'yerel');
  const git = gitKoku(kok);
  if (git && !ayni(git, kok)) ayarEkle(path.join(git, '.claude', 'settings.local.json'), 'yerel');
  // Komut/beceri/ajan/kanca betiği klasörleri: becerilerin allowed-tools ön bilgisi izin verir; kanca betikleri kancaların çalıştırdığı kod.
  const ozel = path.join(kok, '.claude');
  if (!kullanicininMi(ozel)) {
    const parcalar: string[] = [];
    if (baglantiMi(ozel)) b.sinirsiz = true;
    for (const [alt, ad] of [['commands', 'komut'], ['skills', 'beceri'], ['agents', 'ajan'], ['hooks', 'kanca betiği']] as const) {
      const d = path.join(ozel, alt);
      if (!klasorMu(d)) continue;
      if (baglantiMi(d)) b.sinirsiz = true;
      let n = 0;
      try { n = fs.readdirSync(d).filter((x) => !x.startsWith('.')).length; } catch { /* okunamadı */ }
      if (n) parcalar.push(`${n} ${ad}`);
      klasorIzleri(d, gor, izler, b);
    }
    if (parcalar.length) dosyalar.push({ ad: '.claude/ (komut, beceri, ajan, kanca)', tur: 'ozellestirme', ozet: parcalar.join(' · ') });
  }
  // Kanca komutlarının işaret ettiği .claude/ dosyaları (hooks/ dışında da olabilir) — aynı bütçeyle.
  for (const k of kancalar) {
    // .claude/ altındaki kanca dosyasının yolunda bağlantı varsa (dosya ya da ara klasör) iz sınırsız (F).
    for (let d = k; !kullanicininMi(ozel) && iceride(ozel, d) && !ayni(d, kok); d = path.dirname(d)) if (baglantiMi(d)) { b.sinirsiz = true; break; }
    izEkle(k, gor, izler, b);
  }
  // .mcp.json: cwd ve üstleri (Claude Code proje MCP yapılandırmasını yukarı doğru toplar).
  let mcp = false;
  let d = kok;
  for (let i = 0; i < DERINLIK; i++) {
    const p = path.join(d, '.mcp.json');
    if (dosyaMi(p)) { mcp = true; const r = jsonOku(p); dosyalar.push({ ad: gor(p), tur: 'mcp', ozet: r.j ? mcpOzeti(r.j) : r.hata! }); izEkle(p, gor, izler, b); }
    const ust = path.dirname(d);
    if (ust === d) break;
    d = ust;
  }
  const parmakIzi = b.sinirsiz ? IZ_SINIRSIZ : izler.length ? createHash('sha256').update(izler.sort().join('\n')).digest('hex') : '';
  return { dosyalar, mcp, parmakIzi, ...(b.sinirsiz ? { sinirsiz: true } : {}) };
}

// ── Düzeltme turu (N2): telefondan ya da sohbetten açılamayacak geniş/hassas klasörler ──────────────────────────────────────────
// "Düzenlemelere izin ver" cwd içindeki her yazımı sormadan onaylar: cwd ev klasörü ya da AppData olursa telefondan/sohbetten açılan oturum
// Fuber'in ayarlar.json'unu, güven kararlarını, Başlangıç klasörünü, PowerShell profilini sormadan değiştirebilirdi.
export interface KlasorSinirlari {
  ev: string;
  /** Kendisi ya da ATASI cwd olamaz (yazımlar içine düşer): AppData (Roaming/Local). */
  ust: string[];
  /** Kendisi, atası ya da İÇİ cwd olamaz; düzenleme hedefi içindeyse masada sorulur: Fuber'in veri klasörü, ~/.claude, Başlangıç, PowerShell profili. */
  hassas: string[];
  /** Kendisi ya da içi cwd olamaz: Windows, Program Files, ProgramData. */
  sistem: string[];
}
const kucuk = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
const yolDuz = (p: string) => { let r = path.resolve(p); if (r.length > path.parse(r).root.length) r = r.replace(/[\\/]+$/, ''); return kucuk(r); };
/** `alt`, `ust`'un kendisi ya da içinde mi (büyük/küçük harf Windows'ta duyarsız). */
export function iceride(ust: string, alt: string): boolean {
  const u = yolDuz(ust), a = yolDuz(alt);
  if (a === u) return true;
  const ayrac = u.endsWith(path.sep) ? u : u + path.sep;
  return a.startsWith(ayrac);
}

/** Ortamdan varsayılan sınırlar; `ek`: Fuber'in veri klasörü, ~/.claude, Belgeler (main/claudecode/yonetim.ts verir). */
export function varsayilanKlasorSinirlari(ek: { veri?: string; claudeDizini?: string; belgeler?: string } = {}): KlasorSinirlari {
  const e = process.env;
  const ev = os.homedir();
  const appData = e.APPDATA || path.join(ev, 'AppData', 'Roaming');
  const yerel = e.LOCALAPPDATA || path.join(ev, 'AppData', 'Local');
  const belgeler = ek.belgeler || path.join(ev, 'Documents');
  const varOlan = (l: (string | undefined)[]) => [...new Set(l.filter((x): x is string => Boolean(x && x.trim())).map((x) => path.resolve(x)))];
  return {
    ev,
    ust: varOlan([appData, yerel]),
    hassas: varOlan([ek.veri ?? e.FUBER_VERI, ek.claudeDizini, path.join(appData, 'Microsoft', 'Windows', 'Start Menu'), path.join(belgeler, 'WindowsPowerShell'), path.join(belgeler, 'PowerShell')]),
    sistem: varOlan([e.SystemRoot, e.WINDIR, e.ProgramFiles, e['ProgramFiles(x86)'], e.ProgramW6432, e.ProgramData]),
  };
}

// ── Düzeltme turu 2: yol yazımları — metin karşılaştırması yetmez ─────────────────────────────────────────────────────────────
// Windows'ta aynı klasöre birçok yazım götürür: yerleşik bağlantılar (C:\Documents and Settings, ~\Start Menu, ~\Application Data),
// 8.3 kısa adlar (PROGRA~1), \\?\ ve UNC yolları, büyük/küçük harf. Karşılaştırmadan önce yol GERÇEK hâline çevrilir.
/** \\?\, \\.\, UNC (\\sunucu\pay) ve NT (\??\) yolları — telefon/sohbet oturumunda hiç kabul edilmez. */
export const agYoluMu = (p: string): boolean => /^[\\/]{2}|^[\\/]\?\?[\\/]/.test(String(p ?? '').trim());
export const AG_YOLU_NEDENI = 'ağ ya da aygıt yolu (UNC, \\\\?\\, \\\\.\\, \\??\\, ağ sürücüsü)';
export interface GercekYolBilgisi {
  yol: string;
  /** Düzeltme turu 3 (A): yolda VAR OLAN ama çözülemeyen bir girdi (hedefi olmayan bağlantı, erişilemeyen öğe) — o girdinin yolu. */
  cozulemeyen?: string;
}
const yokKodu = (e: unknown) => { const k = (e as NodeJS.ErrnoException)?.code; return k === 'ENOENT' || k === 'ENOTDIR'; };
/**
 * Yolun gerçek hâli: en derin VAR OLAN atanın `fs.realpathSync.native`'i (bağlantı/junction, 8.3 kısa ad, büyük/küçük harf çözülür) +
 * var olmayan kuyruk. Düzeltme turu 3 (A): bir girdi `lstat` ile VAR görünüp `realpath` ile çözülemiyorsa (hedefi olmayan bağlantı) ya da
 * hata "yok" dışında bir şeyse üste ÇIKILMAZ — bağlantının adı gerçek yol sanılırdı (proje\fl.txt → var olmayan dışarı\yeni.txt).
 */
export function gercekYolBilgisi(p: string): GercekYolBilgisi {
  const ilk = path.resolve(p);
  let bas = ilk;
  const kuyruk: string[] = [];
  for (let i = 0; i < 128; i++) {
    try { const r = fs.realpathSync.native(bas); return { yol: kuyruk.length ? path.join(r, ...[...kuyruk].reverse()) : r }; } catch (e) {
      if (!yokKodu(e)) return { yol: ilk, cozulemeyen: bas };
      try { fs.lstatSync(bas); return { yol: ilk, cozulemeyen: bas }; } catch (e2) { if (!yokKodu(e2)) return { yol: ilk, cozulemeyen: bas }; }
    }
    const ust = path.dirname(bas);
    if (ust === bas) break;
    kuyruk.push(path.basename(bas));
    bas = ust;
  }
  return { yol: ilk }; // hiçbir parçası yok (ör. olmayan sürücü): çözülecek bağlantı da yok
}
/** Gerçek yol (çözülemeyen bağlantı bilgisi gerekmiyorsa). */
export const gercekYol = (p: string): string => gercekYolBilgisi(p).yol;
// Düzeltme turu 3 (E): sınır klasörlerinin gerçek hâlleri önbellekte (kanca her düzenlemede 5 klasörü yeniden çözmez); kısa ömürlü.
const sinirOnbellegi = new Map<string, { yol: string; zaman: number }>();
const SINIR_ONBELLEK_MS = 60_000;
export function sinirGercek(p: string): string {
  const a = kucuk(path.resolve(p));
  const simdi = Date.now();
  const o = sinirOnbellegi.get(a);
  if (o && simdi - o.zaman < SINIR_ONBELLEK_MS) return o.yol;
  const yol = gercekYol(p);
  sinirOnbellegi.set(a, { yol, zaman: simdi });
  if (sinirOnbellegi.size > 64) sinirOnbellegi.delete(sinirOnbellegi.keys().next().value as string);
  return yol;
}
/** Testler için. */
export const sinirOnbelleginiBosalt = () => sinirOnbellegi.clear();
/** Sürücü harfi (küçük) ya da '' — farklı sürücü çözülmeden "klasör dışı" sayılır (kopuk ağ sürücüsü beklenmez). */
export const surucuHarfi = (p: string): string => (/^[A-Za-z]:/.test(p) ? p[0].toLowerCase() : '');
/**
 * Düzenleme hedefinin ŞÜPHELİ yazımı (masada sorulur; muhafazakâr): ağ/aygıt yolu, sürücüye göreli yol (`C:dosya`), sürücü harfinden sonra
 * ':' (alternatif veri akışı), 8.3 kısa ad bileşeni (`~` + rakam), sonu nokta ya da boşlukla biten bileşen (Windows bunları siler).
 * `kisaAd: false`: kısa ad bileşeni denetlenmez (var olan klasör yolu realpath ile zaten çözülür).
 */
export function supheliYazim(hedef: string, o: { kisaAd?: boolean } = {}): string | null {
  const h = String(hedef ?? '');
  if (agYoluMu(h)) return 'ağ ya da aygıt yolu';
  if (/^[A-Za-z]:(?![\\/])/.test(h)) return 'sürücüye göreli yol';
  const govde = /^[A-Za-z]:/.test(h) ? h.slice(2) : h;
  if (govde.includes(':')) return 'alternatif veri akışı ya da geçersiz ad';
  for (const b of govde.split(/[\\/]+/)) {
    if (!b || b === '.' || b === '..') continue;
    if (o.kisaAd !== false && /~\d/.test(b)) return 'kısa (8.3) ad';
    if (/[. ]$/.test(b)) return 'sonu nokta ya da boşlukla biten ad';
  }
  return null;
}

/**
 * Telefondan/sohbetten açılacak klasörün denetimi: açılamazsa `neden` (Türkçe), açılabilirse null + denetlenen GERÇEK yol (`yol`; oturum
 * kaydına bu sabitlenir — düzeltme turu 3, C). Yol da sınırlar da gerçek hâlleriyle karşılaştırılır. Düzeltme turu 3: çözülemeyen bağlantı
 * (A), gerçek hâli ağ yolu olan sürücü (B: F: → \\sunucu\pay), sürücüye göreli/köke göreli yazım ve şüpheli adlar reddedilir.
 */
export function korunanKlasorDenetimi(cwd: string, s: KlasorSinirlari, coz: (p: string) => GercekYolBilgisi = gercekYolBilgisi): { neden: string | null; yol: string } {
  const ham = String(cwd ?? '');
  const red = (neden: string) => ({ neden, yol: path.resolve(ham || '.') });
  if (agYoluMu(ham)) return red(AG_YOLU_NEDENI);
  if (!path.isAbsolute(ham) || (process.platform === 'win32' && !/^[A-Za-z]:[\\/]/.test(ham))) return red('tam yol değil (sürücü harfiyle başlamıyor)');
  const sup = supheliYazim(ham, { kisaAd: false });
  if (sup) return red(`şüpheli yazım: ${sup}`);
  const r = coz(ham);
  if (r.cozulemeyen) return red('çözülemeyen bağlantı ya da erişilemeyen yol');
  const p = r.yol;
  if (agYoluMu(p)) return { neden: AG_YOLU_NEDENI, yol: p };
  const g = sinirGercek;
  const sonuc = (neden: string | null) => ({ neden, yol: p });
  if (yolDuz(p) === yolDuz(path.parse(p).root)) return sonuc('sürücü kökü');
  if (iceride(p, g(s.ev))) return sonuc('ev klasörü ya da onu içeren bir klasör');
  for (const u of s.ust) if (iceride(p, g(u))) return sonuc('uygulama verisi klasörü (AppData) ya da onu içeren bir klasör');
  for (const h of s.hassas.map(g)) if (iceride(p, h) || iceride(h, p)) return sonuc('korunan bir klasör (Fuber’in verisi, Claude Code ayarları, Başlangıç ya da PowerShell profili)');
  for (const y of s.sistem) if (iceride(g(y), p)) return sonuc('sistem klasörü');
  return sonuc(null);
}
/** cwd telefondan/sohbetten açılamazsa nedeni (Türkçe), açılabilirse null. */
export const korunanKlasorNedeni = (cwd: string, s: KlasorSinirlari, coz?: (p: string) => GercekYolBilgisi): string | null => korunanKlasorDenetimi(cwd, s, coz).neden;

/** Kayıt anahtarı: tam yol; Windows'ta büyük/küçük harf duyarsız, sondaki ayıraç yok. */
export function guvenAnahtari(cwd: string): string {
  let p = path.resolve(cwd);
  if (p.length > path.parse(p).root.length) p = p.replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

interface DepoKaydi { karar: GuvenKarari; yol: string; zaman: number; parmakIzi?: string }
const AZAMI_KAYIT = 2000;

/** Klasör başına güven kararı (Fuber'in veri klasöründe tek JSON; atomik yazım). */
export class KlasorGuvenDeposu {
  private bellek: Map<string, DepoKaydi> | null = null;
  private readonly dosya: () => string;
  constructor(dosya: () => string) { this.dosya = dosya; }

  private oku(): Map<string, DepoKaydi> {
    if (this.bellek) return this.bellek;
    const m = new Map<string, DepoKaydi>();
    try {
      const j = JSON.parse(fs.readFileSync(this.dosya(), 'utf8')) as { klasorler?: Record<string, DepoKaydi> };
      for (const [a, k] of Object.entries(j.klasorler ?? {})) {
        if (k && (k.karar === 'guven' || k.karar === 'guvenme') && typeof k.yol === 'string') m.set(a, { karar: k.karar, yol: k.yol, zaman: Number(k.zaman) || 0, ...(typeof k.parmakIzi === 'string' ? { parmakIzi: k.parmakIzi } : {}) });
      }
    } catch { /* dosya yok ya da bozuk: karar yok (güvenilmemiş sayılır) */ }
    this.bellek = m;
    return m;
  }

  private yaz(): void {
    const m = this.oku();
    const d = this.dosya();
    fs.mkdirSync(path.dirname(d), { recursive: true });
    const gecici = `${d}.${process.pid}.tmp`;
    fs.writeFileSync(gecici, JSON.stringify({ surum: 1, klasorler: Object.fromEntries(m) }, null, 1));
    fs.renameSync(gecici, d);
  }

  karar(cwd: string): GuvenKarari | undefined { return this.oku().get(guvenAnahtari(cwd))?.karar; }

  /** Karar + kararın verildiği andaki ayar parmak izi (N3). */
  kayit(cwd: string): { karar: GuvenKarari; parmakIzi?: string } | undefined {
    const k = this.oku().get(guvenAnahtari(cwd));
    return k ? { karar: k.karar, ...(k.parmakIzi !== undefined ? { parmakIzi: k.parmakIzi } : {}) } : undefined;
  }

  /** `karar` null: kayıt silinir (sonraki oturumda kart yeniden sorar). `parmakIzi`: kartta gösterilen dosya kümesinin izi. */
  ayarla(cwd: string, karar: GuvenKarari | null, parmakIzi?: string): void {
    const m = this.oku();
    const a = guvenAnahtari(cwd);
    if (karar === null) m.delete(a);
    else { m.delete(a); m.set(a, { karar, yol: path.resolve(cwd), zaman: Date.now(), ...(parmakIzi !== undefined ? { parmakIzi } : {}) }); }
    while (m.size > AZAMI_KAYIT) m.delete(m.keys().next().value as string);
    this.yaz();
  }

  liste(): { yol: string; karar: GuvenKarari; zaman: number }[] {
    return [...this.oku().values()].sort((x, y) => y.zaman - x.zaman).map((k) => ({ yol: k.yol, karar: k.karar, zaman: k.zaman }));
  }
}

/**
 * Klasörün güven durumu: kendi ayarı var mı (kart gerekir mi) ve kayıtlı karar. N3: depodaki kayıt parmak iziyle gelir; klasörün ayar
 * dosyaları (ad + içerik) o karardan sonra değiştiyse — ya da kayıtta iz yoksa — karar YOK sayılır (`degisti`), kart yeniden sorar.
 * Yalnız karar (metin) verilirse iz denetlenmez (testler).
 */
export function klasorGuvenDurumu(cwd: string, kayit: GuvenKaydi | undefined, kullaniciDizini?: string): KlasorGuvenDurumu {
  const a = klasorAyarlariniBul(cwd, kullaniciDizini);
  const gerekli = a.dosyalar.length > 0 || Boolean(a.sinirsiz);
  let karar: GuvenKarari | undefined;
  let degisti = false;
  const k = typeof kayit === 'string' ? { karar: kayit } : kayit;
  if (k && a.sinirsiz) {
    // Düzeltme turu 2: iz çıkarılamıyor → değişiklik izlenemez; yalnız güvenli yön ("güvenme") geçerli.
    if (k.karar === 'guvenme') karar = 'guvenme'; else degisti = true;
  } else if (typeof kayit === 'string') karar = kayit;
  else if (kayit) {
    if (!gerekli || (kayit.parmakIzi === a.parmakIzi && a.parmakIzi !== IZ_SINIRSIZ)) karar = kayit.karar;
    else degisti = true;
  }
  return { cwd: path.resolve(cwd), ...a, gerekli, ...(karar ? { karar } : {}), ...(degisti ? { degisti } : {}) };
}

/** Klasörün kendi ayarları yüklenir mi: kendi ayarı yoksa (yüklenecek bir şey yok) ya da açıkça güvenildiyse. */
export const klasorAyarlariYuklenir = (d: Pick<KlasorGuvenDurumu, 'gerekli' | 'karar'>) => !d.gerekli || d.karar === 'guven';
