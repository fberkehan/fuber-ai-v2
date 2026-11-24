// ── Claude Code yürütülebilir dosyası: yol, test kapısı, süreç başlatma/öldürme, auth durumu, etkin ajanlar, git özeti ──────────
// Electron'a bağlı DEĞİL (birim/bütünleşme testleri doğrudan içe aktarır). Hepsi argüman dizisiyle (kabuk yok), zaman aşımlı.
// Test kapısı (Görev 27, kesin kural): testte ve önizlemede (node --test → NODE_TEST_CONTEXT, FUBER_DEMO) gerçek claude.exe ASLA
// çalışmaz — FUBER_CLAUDE_KOMUT='["node","sahte-claude.mjs"]' verilmemişse çalıştırma noktaları yüksek sesle hata verir.
// Kimlik (Ruling BT): Claude kimlik dosyalarına/belirteçlerine dokunulmaz; `claude auth status` çıktısından YALNIZ giriş durumu ve
// yöntemi alınır, çıktının geri kalanı ne saklanır ne günlüğe yazılır. Giriş `claude auth login` görünür konsolda: kod Fuber'den geçmez.
import { spawn, spawnSync, execFile, execFileSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeAra, regPathCoz } from './claude-ara.ts';

let bulunan: string | null | undefined;
let bulunamadiAni = 0;
/** "Yok" sonucu yalnız kısa süre önbelleğe alınır: Claude Code sonradan kurulunca / PATH güncellenince uygulama yeniden açılmadan bulur. */
export const BULUNAMADI_ONBELLEK_MS = 10_000;

/** Kayıt defterinden GÜNCEL kullanıcı + makine PATH'i (Explorer'ın oturum açılışındaki bayat kopyası değil). Yalnız okur. */
function kayitPath(): string[] {
  const out: string[] = [];
  for (const anahtar of ['HKCU\\Environment', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment']) {
    try {
      const c = execFileSync('reg.exe', ['query', anahtar, '/v', 'Path'], { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
      out.push(...regPathCoz(c, process.env));
    } catch { /* anahtar yok / okunamadı */ }
  }
  return out;
}

/** claude çalıştırılabilirinin yolu (PATH, npm -g, ~/.local/bin, kayıt defteri PATH'i; ayrıntı: claude-ara.ts). FUBER_CLAUDE_KOMUT varsa 'test'. Yalnız arar, çalıştırmaz. */
export function claudeYolu(): string | null {
  if (process.env.FUBER_CLAUDE_KOMUT) return 'test';
  if (bulunan) return bulunan;
  if (bulunan === null && Date.now() - bulunamadiAni < BULUNAMADI_ONBELLEK_MS) return null;
  const yol = claudeAra({
    platform: process.platform,
    env: process.env,
    home: os.homedir(),
    var: (p) => fs.existsSync(p),
    where: () => execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['claude'], { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/),
    kayitPath,
  });
  bulunan = yol;
  if (!yol) bulunamadiAni = Date.now();
  return yol;
}
/** Görev 29: Claude Code sonradan kurulunca (resmi yükleyici ~/.local/bin'e yazar) önbellek bırakılır; sonraki claudeYolu() yeniden arar. */
export function claudeYoluSifirla(yol?: string | null): void { bulunan = yol === undefined ? undefined : yol; bulunamadiAni = yol === null ? Date.now() : 0; }

/** Testte/önizlemede miyiz (node --test alt süreci ya da FUBER_DEMO önizlemesi). */
export const testOrtami = () => Boolean(process.env.NODE_TEST_CONTEXT || process.env.FUBER_DEMO);

export interface CcKomut { exe: string; onArgs: string[]; test: boolean }

export class ClaudeYokHatasi extends Error {
  kod = 'claude-yok';
  constructor() { super('Claude Code (claude.exe) bulunamadı. Kurulum: https://claude.com/claude-code'); }
}

/** Çalıştırılacak komut. Testte sahte zorunlu: yoksa YÜKSEK SESLE düşer (gerçek claude.exe'ye asla ulaşılmaz). */
export function ccKomutu(): CcKomut {
  const k = process.env.FUBER_CLAUDE_KOMUT;
  if (k) {
    let dizi: unknown;
    try { dizi = JSON.parse(k); } catch { throw new Error('FUBER_CLAUDE_KOMUT geçerli bir JSON dizisi değil.'); }
    if (!Array.isArray(dizi) || !dizi.length || !dizi.every((x) => typeof x === 'string')) throw new Error('FUBER_CLAUDE_KOMUT bir metin dizisi olmalı.');
    return { exe: dizi[0], onArgs: dizi.slice(1), test: true };
  }
  if (testOrtami()) {
    throw new Error('TEST GÜVENLİĞİ: gerçek claude.exe testte/önizlemede çalıştırılamaz — FUBER_CLAUDE_KOMUT ile sahte Claude Code ver (scripts/dev/sahte-claude.mjs).');
  }
  const exe = claudeYolu();
  if (!exe || exe === 'test') throw new ClaudeYokHatasi();
  return { exe, onArgs: [], test: false };
}

// ── Süreç izleme: yetim süreç kalmasın ─────────────────────────────────────────────────────────────────────────────────────
const izlenen = new Set<number>();
/** Başlattığımız Claude Code PID'leri → çıkış anı (yaşıyorsa null). `claude agents` çıktısında bizimkileri ayırmak için; çıkmış PID
 *  yalnız ~30 sn bizim sayılır (sonra işletim sistemi numarayı başka bir sürece — belki gerçekten başka yerde açılan Claude Code'a — verebilir). */
const gecmisPidler = new Map<number, number | null>();
export const CIKMIS_PID_SURESI_MS = 30_000;
export function bizimPidler(simdi = Date.now()): Set<number> {
  const s = new Set<number>();
  for (const [pid, cikis] of gecmisPidler) {
    if (cikis === null || simdi - cikis <= CIKMIS_PID_SURESI_MS) s.add(pid);
    else if (simdi - cikis > 10 * CIKMIS_PID_SURESI_MS) gecmisPidler.delete(pid);
  }
  return s;
}
let cikisKancasi = false;

/** Süreç yaşıyor mu (yalnız varlık sorgusu; sinyal göndermez). */
export function yasiyorMu(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** Süreci ve çocuklarını (Claude Code'un kabukları, MCP sunucuları) öldürür. Windows: taskkill /T /F. */
export function agacOldur(pid: number, esZamanli = false): void {
  if (!yasiyorMu(pid)) return;
  if (process.platform === 'win32') {
    const arg = ['/PID', String(pid), '/T', '/F'];
    if (esZamanli) { try { spawnSync('taskkill', arg, { windowsHide: true, timeout: 5000, stdio: 'ignore' }); } catch { /* yok */ } }
    else { try { spawn('taskkill', arg, { windowsHide: true, stdio: 'ignore' }).on('error', () => undefined); } catch { /* yok */ } }
    return;
  }
  try { process.kill(pid, 'SIGKILL'); } catch { /* çoktan çıktı */ }
}

/** Ana süreç (uygulama) beklenmedik biçimde çıkarsa izlenen bütün Claude Code süreçleri ağaçlarıyla öldürülür. */
function cikisKancasiKur(): void {
  if (cikisKancasi) return;
  cikisKancasi = true;
  process.on('exit', () => { for (const pid of izlenen) agacOldur(pid, true); });
}

export const izlenenSurecler = () => [...izlenen].filter(yasiyorMu);
/** Bu süreç bizim başlattığımız ve henüz çıkmamış bir Claude Code süreci mi (çıkışta izlenenden düşer → yeniden kullanılan PID değil). */
export const izlenenMi = (pid: number | undefined): pid is number => pid !== undefined && izlenen.has(pid) && yasiyorMu(pid);
/** Yalnız bizim ve yaşayan süreci ağacıyla öldürür (bayat PID başka bir programa ait olabilir: dokunulmaz). */
export function guvenliOldur(pid: number | undefined): boolean {
  if (!izlenenMi(pid)) return false;
  agacOldur(pid);
  return true;
}

export interface SurecSecenegi { args: string[]; cwd?: string; env: Record<string, string | undefined>; signal?: AbortSignal }

/**
 * Agent SDK'nın `spawnClaudeCodeProcess` kancası için: komutu (gerçek ya da sahte) borularla başlatır, PID'i izler. stderr okunur
 * (boru dolup süreç kilitlenmesin) ve yalnız son 4 KB hata iletisi için tutulur — günlüğe yazılmaz. `signal` (SDK'nın stdin kapatma +
 * ~2 sn nezaket süresinden SONRA keser) gelince süreç ağacıyla öldürülür.
 */
export function surecBaslat(k: CcKomut, o: SurecSecenegi, stderrKuyrugu?: (parca: string) => void): ChildProcess {
  cikisKancasiKur();
  const c = spawn(k.exe, [...k.onArgs, ...o.args], { cwd: o.cwd, env: o.env as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const pid = c.pid;
  if (pid !== undefined) {
    izlenen.add(pid);
    gecmisPidler.set(pid, null);
    if (gecmisPidler.size > 1000) gecmisPidler.delete(gecmisPidler.keys().next().value as number);
  }
  // Düzeltme C: bizim sürecimiz çıkınca `claude agents` önbelleği bayatlar (az önce kapattığımız oturum hâlâ listede görünürdü).
  c.once('exit', () => {
    if (pid !== undefined) { izlenen.delete(pid); if (gecmisPidler.has(pid)) gecmisPidler.set(pid, Date.now()); }
    ajanOnbellekSil();
  });
  c.once('error', () => { if (pid !== undefined) izlenen.delete(pid); });
  c.stderr?.setEncoding('utf8');
  c.stderr?.on('data', (p: string) => stderrKuyrugu?.(p));
  if (o.signal) {
    const kes = () => { if (pid !== undefined && c.exitCode === null && c.signalCode === null) agacOldur(pid); };
    if (o.signal.aborted) kes(); else o.signal.addEventListener('abort', kes, { once: true });
  }
  return c;
}

/** Kısa bir claude alt komutu (auth status, agents --json): çıktıyı döner; sıfır olmayan çıkışta da stdout korunur. */
export function ccCalistir(args: string[], o: { timeoutMs?: number; cwd?: string } = {}): Promise<{ kod: number | null; stdout: string }> {
  const k = ccKomutu();
  return new Promise((coz) => {
    execFile(k.exe, [...k.onArgs, ...args], { timeout: o.timeoutMs ?? 10_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', cwd: o.cwd },
      (hata, stdout) => {
        const kod = hata ? (typeof (hata as { code?: unknown }).code === 'number' ? Number((hata as { code: number }).code) : null) : 0;
        coz({ kod, stdout: String(stdout ?? '') });
      });
  });
}

// ── Kimlik durumu (yalnız iki alan) ─────────────────────────────────────────────────────────────────────────────────────────
export interface CcAuthDurumu { kurulu: boolean; girisYapildi: boolean; yontem?: string; hata?: string }

/** `claude auth status` JSON çıktısından YALNIZ loggedIn ve authMethod (Ruling BT). Çıktının geri kalanı hiçbir yere yazılmaz. */
export function authCiktisiniOku(stdout: string): Pick<CcAuthDurumu, 'girisYapildi' | 'yontem'> | null {
  const bas = stdout.indexOf('{');
  const son = stdout.lastIndexOf('}');
  if (bas < 0 || son <= bas) return null;
  let j: unknown;
  try { j = JSON.parse(stdout.slice(bas, son + 1)); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  const g = (j as { loggedIn?: unknown }).loggedIn;
  const y = (j as { authMethod?: unknown }).authMethod;
  return { girisYapildi: g === true, ...(typeof y === 'string' && y.length <= 60 ? { yontem: y } : {}) };
}

export async function ccAuthDurumu(): Promise<CcAuthDurumu> {
  let r: { kod: number | null; stdout: string };
  try { r = await ccCalistir(['auth', 'status'], { timeoutMs: 15_000 }); } catch (e) {
    if (e instanceof ClaudeYokHatasi) return { kurulu: false, girisYapildi: false };
    throw e;
  }
  const d = authCiktisiniOku(r.stdout);
  r.stdout = ''; // ham çıktı tutulmaz
  if (!d) return { kurulu: true, girisYapildi: false, hata: 'Claude Code oturum durumu okunamadı.' };
  return { kurulu: true, ...d };
}

/** `claude auth login` GÖRÜNÜR bir konsol penceresinde (Anthropic'in kendi akışı; kod gerekirse kullanıcı oraya yapıştırır). */
export function ccGirisBaslat(): void {
  const k = ccKomutu();
  const gizli = k.test && process.env.FUBER_CLAUDE_GIZLI === '1';
  const p = spawn(k.exe, [...k.onArgs, 'auth', 'login'], { detached: true, stdio: 'ignore', windowsHide: gizli });
  p.on('error', () => undefined);
  p.unref();
}

// ── Başka yerde açık mı: `claude agents --json` ─────────────────────────────────────────────────────────────────────────────
// 2.1.310'da (denetleyici doğruladı) nesne dizisi: { id, cwd, kind: 'background' | 'interactive', startedAt, sessionId, name, state, pid,
// status: 'waiting' | 'busy' | 'idle', waitingFor } — açık terminal oturumları da listelenir. Ayrıştırılamazsa çıktıda kimlik aranır.
/** Çıktıda bu oturum (sessionId) bizim olmayan bir süreçte açık mı. */
export function ajanlardaAcik(metin: string, kimlik: string, bizimPidler: Set<number> = new Set()): boolean {
  if (!metin.trim()) return false;
  let j: unknown;
  try { j = JSON.parse(metin); } catch { return metin.includes(kimlik); }
  const liste = Array.isArray(j) ? j : j && typeof j === 'object' && Array.isArray((j as { agents?: unknown }).agents) ? (j as { agents: unknown[] }).agents : null;
  if (!liste) return metin.includes(kimlik);
  return liste.some((a) => {
    if (!a || typeof a !== 'object') return false;
    const o = a as { sessionId?: unknown; pid?: unknown };
    return o.sessionId === kimlik && !(typeof o.pid === 'number' && bizimPidler.has(o.pid));
  });
}

let ajanOnbellek: { zaman: number; metin: string } | null = null;
export async function etkinAjanMetni(): Promise<string> {
  if (ajanOnbellek && Date.now() - ajanOnbellek.zaman < 15_000) return ajanOnbellek.metin;
  let metin = '';
  try { metin = (await ccCalistir(['agents', '--json'], { timeoutMs: 8_000 })).stdout; } catch { metin = ''; }
  ajanOnbellek = { zaman: Date.now(), metin };
  return metin;
}
export const ajanOnbellekSil = () => { ajanOnbellek = null; };

// ── Git özeti (argüman dizisi; deponun yapılandırması program ÇALIŞTIRAMAZ) ───────────────────────────────────────────────────
// Düzeltme 1: `-c core.fsmonitor=` (izleme kancası kapalı), `-c diff.external=` (+ diff'te --no-ext-diff --no-textconv);
// --no-optional-locks (status dizin dosyasına yazmaz); GIT_EXTERNAL_DIFF/GIT_PAGER ortamdan atılır. status ve diff kanca çalıştırmaz.
const GIT_SERTLESTIR = ['--no-optional-locks', '-c', 'core.fsmonitor=', '-c', 'diff.external='];
function gitOrtami(): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
  delete e.GIT_EXTERNAL_DIFF;
  delete e.GIT_PAGER;
  return e;
}
function git(cwd: string, args: string[], maxBuffer = 2 * 1024 * 1024): Promise<{ tamam: boolean; cikti: string }> {
  return new Promise((coz) => {
    execFile('git', ['-C', cwd, ...GIT_SERTLESTIR, ...args], { timeout: 10_000, windowsHide: true, maxBuffer, encoding: 'utf8', env: gitOrtami() },
      (hata, stdout) => coz({ tamam: !hata, cikti: String(stdout ?? '') }));
  });
}

/** `tam` (sembolik bağlantılar/bağlantı noktaları çözülünce) `kok`un içinde mi. Olmayan dosyada en yakın var olan üst klasör çözülür. */
export function gercekIcindeMi(kok: string, tam: string): boolean {
  const ayni = (a: string) => (process.platform === 'win32' ? a.toLowerCase() : a);
  let kokGercek: string;
  try { kokGercek = ayni(fs.realpathSync.native(path.resolve(kok))); } catch { return false; }
  let ust = path.resolve(tam);
  const kalan: string[] = [];
  for (let i = 0; i < 64; i++) {
    try {
      const g = ayni(path.join(fs.realpathSync.native(ust), ...kalan));
      return g === kokGercek || g.startsWith(kokGercek.endsWith(path.sep) ? kokGercek : kokGercek + path.sep);
    } catch {
      const sonraki = path.dirname(ust);
      if (sonraki === ust) return false;
      kalan.unshift(path.basename(ust));
      ust = sonraki;
    }
  }
  return false;
}

export interface GitDosyasi { yol: string; durum: string }
export interface GitOzeti { git: boolean; dal?: string; dosyalar: GitDosyasi[] }

/** `git status --porcelain=v1 -z` → değişen dosyalar (yeniden adlandırmada yeni ad). Git deposu değilse { git: false }. */
export function porcelainCoz(cikti: string): GitDosyasi[] {
  const parcalar = cikti.split('\0');
  const out: GitDosyasi[] = [];
  for (let i = 0; i < parcalar.length; i++) {
    const p = parcalar[i];
    if (p.length < 4) continue;
    const durum = p.slice(0, 2);
    out.push({ yol: p.slice(3), durum: durum.trim() || durum });
    if (durum[0] === 'R' || durum[0] === 'C') i++; // eski ad bir sonraki parçada
  }
  return out.slice(0, 500);
}

/**
 * Görev 28 düzeltme 2 (N2): porcelain yolları DEPO KÖKÜNE göredir; proje deponun alt klasöründeyse (`git rev-parse --show-prefix`, ör.
 * "paketler/uygulama/") yollar proje klasörüne göre çevrilir — denetçi ve `gitFark` aynı tabanı kullanır. Önek dışındaki yollar atılır.
 */
export function projeyeGore(dosyalar: GitDosyasi[], onek: string): GitDosyasi[] {
  const o = onek.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!o) return dosyalar;
  const ayni = (s: string) => (process.platform === 'win32' ? s.toLowerCase() : s);
  const bas = ayni(`${o}/`);
  return dosyalar.filter((f) => ayni(f.yol).startsWith(bas)).map((f) => ({ ...f, yol: f.yol.slice(bas.length) }));
}

export async function gitOzeti(cwd: string): Promise<GitOzeti> {
  // `-- .`: yalnız proje klasörünün altı (deponun geri kalanı bu oturumun projesi değil).
  // Üç çağrı birbirinden bağımsız: koşut (düzeltme 3).
  const [durum, onek, dal] = await Promise.all([
    git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']),
    git(cwd, ['rev-parse', '--show-prefix']),
    git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
  ]);
  if (!durum.tamam) return { git: false, dosyalar: [] };
  return { git: true, ...(dal.tamam && dal.cikti.trim() ? { dal: dal.cikti.trim() } : {}), dosyalar: projeyeGore(porcelainCoz(durum.cikti), onek.tamam ? onek.cikti.trim() : '') };
}

// ── "@" dosya önerisi için proje dosyaları (.gitignore'a uyar) ─────────────────────────────────────────────────────────────────
// Düzeltme B: ana süreç ASLA donmaz — gezinti eşzamansız (fs.promises.opendir), klasör/dosya/süre bütçeli, kısmi sonuç `kisaltildi`
// ile döner; ağır klasörler atlanır; cwd başına aynı anda TEK tarama (sonraki tuş vuruşları onu bekler); önbellek sınırlı. Git listesi
// taşar ya da zaman aşımına uğrarsa gezintiye DÜŞÜLMEZ: kısmi git listesi döner.
const ATLANAN = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'bower_components', 'dist', 'build', 'out', 'release', '.next', '.nuxt', '.turbo', '.venv', 'venv',
  '__pycache__', '.cache', 'coverage', 'target', '.gradle', '.idea', '.vs', '.pnpm-store', '.yarn', '.npm',
  // Ev klasörü / sistem kökü proje seçildiyse:
  'AppData', 'Application Data', '$Recycle.Bin', 'System Volume Information', 'Windows', 'WinSxS', 'Program Files', 'Program Files (x86)', 'ProgramData', 'Library', '.Trash',
]);
export interface DosyaListesi { liste: string[]; kisaltildi: boolean; kaynak: 'git' | 'gezinti' }
export interface TaramaSecenegi { dizinSiniri?: number; dosyaSiniri?: number; sureMs?: number; gitAzamiBayt?: number; gitZamanAsimiMs?: number }
const TARAMA: Required<TaramaSecenegi> = { dizinSiniri: 5000, dosyaSiniri: 50_000, sureMs: 300, gitAzamiBayt: 16 * 1024 * 1024, gitZamanAsimiMs: 5000 };
const ONBELLEK_OMRU_MS = 10_000;
const ONBELLEK_SINIRI = 16;
const dosyaOnbellek = new Map<string, { zaman: number; sonuc: DosyaListesi }>();
const surenTaramalar = new Map<string, Promise<DosyaListesi>>();
export const dosyaOnbellekSil = () => dosyaOnbellek.clear();

const yolBicimi = (s: string) => s.replace(/\\/g, '/');

/** `git ls-files -co --exclude-standard -z`: 'yok' = depo değil / git yok (gezintiye geçilir); 'kesik' = taştı / zaman aşımı (kısmi liste). */
function gitDosyalari(kok: string, s: Required<TaramaSecenegi>): Promise<{ durum: 'tamam' | 'kesik' | 'yok'; liste: string[] }> {
  return new Promise((coz) => {
    execFile('git', ['-C', kok, ...GIT_SERTLESTIR, 'ls-files', '-co', '--exclude-standard', '-z'],
      { timeout: s.gitZamanAsimiMs, maxBuffer: s.gitAzamiBayt, windowsHide: true, encoding: 'utf8', env: gitOrtami() },
      (hata, stdout) => {
        const parcalar = String(stdout ?? '').split('\0');
        if (!hata) return coz({ durum: 'tamam', liste: parcalar.filter(Boolean).slice(0, s.dosyaSiniri).map(yolBicimi) });
        const e = hata as Error & { code?: unknown; killed?: boolean };
        if (e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || e.killed === true) {
          parcalar.pop(); // son parça yarım olabilir
          return coz({ durum: 'kesik', liste: parcalar.filter(Boolean).slice(0, s.dosyaSiniri).map(yolBicimi) });
        }
        coz({ durum: 'yok', liste: [] });
      });
  });
}

/** Eşzamansız, enine (önce sığ klasörler) ve bütçeli gezinti; bağlantılar izlenmez. */
async function klasorGez(kok: string, s: Required<TaramaSecenegi>): Promise<{ liste: string[]; kisaltildi: boolean }> {
  const bitis = Date.now() + s.sureMs;
  const kuyruk: { klasor: string; derinlik: number }[] = [{ klasor: kok, derinlik: 0 }];
  const liste: string[] = [];
  let bas = 0;
  let kisaltildi = false;
  while (bas < kuyruk.length) {
    if (bas >= s.dizinSiniri || liste.length >= s.dosyaSiniri || Date.now() > bitis) { kisaltildi = true; break; }
    const { klasor, derinlik } = kuyruk[bas++];
    let dizin: fs.Dir;
    try { dizin = await fs.promises.opendir(klasor, { bufferSize: 64 }); } catch { continue; }
    try {
      for await (const e of dizin) {
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) { if (!ATLANAN.has(e.name) && derinlik < 12) kuyruk.push({ klasor: path.join(klasor, e.name), derinlik: derinlik + 1 }); }
        else if (e.isFile()) liste.push(yolBicimi(path.relative(kok, path.join(klasor, e.name))));
        if (liste.length >= s.dosyaSiniri || Date.now() > bitis) { kisaltildi = true; break; }
      }
    } catch { /* okunamayan klasör */ }
    if (kisaltildi) break;
  }
  return { liste, kisaltildi };
}

/** "@" önerisinin dosyaları: git deposunda .gitignore'a uyan liste (taşarsa kısmi), değilse bütçeli gezinti. 10 sn önbellek. */
export function projeDosyalari(cwd: string, secenek: TaramaSecenegi = {}): Promise<DosyaListesi> {
  const kok = path.resolve(cwd);
  const o = dosyaOnbellek.get(kok);
  if (o && Date.now() - o.zaman < ONBELLEK_OMRU_MS) return Promise.resolve(o.sonuc);
  const suren = surenTaramalar.get(kok);
  if (suren) return suren; // sonraki tuş vuruşu süren taramayı bekler
  const s = { ...TARAMA, ...secenek };
  const p = (async (): Promise<DosyaListesi> => {
    const g = await gitDosyalari(kok, s);
    const sonuc: DosyaListesi = g.durum === 'yok'
      ? { ...(await klasorGez(kok, s)), kaynak: 'gezinti' }
      : { liste: g.liste, kisaltildi: g.durum === 'kesik' || g.liste.length >= s.dosyaSiniri, kaynak: 'git' };
    dosyaOnbellek.delete(kok);
    dosyaOnbellek.set(kok, { zaman: Date.now(), sonuc });
    while (dosyaOnbellek.size > ONBELLEK_SINIRI) dosyaOnbellek.delete(dosyaOnbellek.keys().next().value as string);
    return sonuc;
  })().finally(() => surenTaramalar.delete(kok));
  surenTaramalar.set(kok, p);
  return p;
}

/** Tek dosyanın farkı (izlenmeyen dosya: içeriği "+" satırlarıyla). `dosya` cwd içinde olmalı. */
export async function gitFark(cwd: string, dosya: string): Promise<{ fark: string; kisaltildi: boolean }> {
  const tam = path.resolve(cwd, dosya);
  const kok = path.resolve(cwd);
  if (tam !== kok && !tam.startsWith(kok + path.sep)) throw new Error('Dosya proje klasörünün dışında.');
  // Sembolik bağlantı / bağlantı noktası proje dışına çıkarıyorsa okunmaz.
  if (!gercekIcindeMi(kok, tam)) throw new Error('Dosya proje klasörünün dışında (bağlantı).');
  const goreli = path.relative(kok, tam);
  const SINIR = 200_000;
  const r = await git(cwd, ['diff', '--no-color', '--no-ext-diff', '--no-textconv', 'HEAD', '--', goreli], 8 * 1024 * 1024);
  let fark = r.tamam ? r.cikti : '';
  if (!fark && fs.existsSync(tam) && fs.statSync(tam).isFile()) {
    const icerik = fs.readFileSync(tam, 'utf8').slice(0, SINIR);
    fark = `--- /dev/null\n+++ b/${goreli.replace(/\\/g, '/')}\n${icerik.split('\n').map((s) => `+${s}`).join('\n')}`;
  }
  return { fark: fark.slice(0, SINIR), kisaltildi: fark.length > SINIR };
}
