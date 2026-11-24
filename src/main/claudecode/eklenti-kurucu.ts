// ── Fuber Geliştirici Paketi kurucusu (Görev 29, K18): katalog, eklenti kurma, kurulum komutu onayı, uv + Graphify, durum, günlük ─────────
// Electron'a bağlı DEĞİL (tests/eklenti-kurucu.test.ts doğrudan içe aktarır; Electron tarafı eklenti-yonetim.ts). Kurallar:
//   · Hepsi argüman dizisiyle (kabuk YOK), zaman aşımlı (aşılırsa süreç ağacıyla öldürülür), günlüklü (uygulama veri klasöründe; sır yazılmaz).
//   · Kurulu olan atlanır (yeniden çalıştırılabilir); biri düşerse ötekiler sürer. Claude Code'u değiştiren komutlar TEK sırada çalışır.
//   · Kurulum komutu bildiren eklenti (Claude Code `--json` çıktısında shownCommand {command, sha256}): komut kullanıcıya GÖSTERİLİR; yalnız
//     uygulama içi onaydan sonra `--accept-command <sha256>` verilir. Körlemesine `-y` ASLA verilmez (test sabitler).
//   · Graphify: sabit uv (GitHub arşivi) önce indirilir, SHA-256 tutmazsa AÇILMAZ; açarken arşivdeki yol kullanılmaz (yalnız izinli dosya
//     adları hedef klasöre yazılır: yol geçişi olanaksız). `uv tool install graphifyy==0.9.95` → `graphify install --platform windows`.
//     uv'nin araç ortamı, Python'u ve önbelleği uygulama veri klasöründe (UV_TOOL_DIR, UV_PYTHON_INSTALL_DIR, UV_CACHE_DIR); araç komutu
//     (graphify.exe) uv'nin varsayılan yerinde, ~/.local/bin'de kalır — Claude Code'un resmi yükleyicisi de oraya yazar ve PATH'e ekler; Graphify'ın
//     Claude Code kancası `graphify`yi bu yoldan çağırabilsin diye (UV_TOOL_BIN_DIR uygulama klasörüne alınsaydı kanca komutu bulamazdı).
//   · Claude Code'un kendi dosyalarına (settings.json, ~/.claude.json) doğrudan YAZILMAZ: yalnız `claude plugin|mcp` komutları; okuma yalnız
//     `claude plugin list --json`, `claude mcp list` ve beceri klasörü (~/.claude/skills).
// Test kapısı (yurutucu.ts ile aynı kural): testte/önizlemede (NODE_TEST_CONTEXT, FUBER_DEMO) gerçek claude.exe, gerçek uv, gerçek graphify ve
// gerçek yükleyici ASLA çalışmaz — FUBER_CLAUDE_KOMUT / FUBER_UV_KOMUT / FUBER_GRAPHIFY_KOMUT / FUBER_CC_YUKLEYICI_KOMUT sahteleri verilmezse
// yüksek sesle düşer; uv arşivi testte yalnız 127.0.0.1'den iner.
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { ccKomutu, ccAuthDurumu, claudeYoluSifirla, testOrtami, agacOldur } from './yurutucu.ts';
import { indir, type Ilerleme } from '../indirme.ts';
import { jsonOku, jsonYaz } from '../json-dosya.ts';
import {
  ALAN_COK_UZUN, ALAN_GOSTERIM_SINIRI, CC_KATALOG, CC_KATALOG_DEPOSU, CC_YUKLEYICI_KOMUTU, GELISTIRICI_PAKETI, GRAPHIFY_BECERILERI, GRAPHIFY_GEREKSINIMI,
  GRAPHIFY_PAKETI, KOMUT_BICIMI_BILINMIYOR, KOMUT_COK_UZUN, KOMUT_GOSTERIM_SINIRI, KOMUT_SATIR_SINIRI, UV_ARSIVI, UV_DOSYALARI, UV_SURUMU,
  eklentiKimligi, paketOgesi, secimiSuz, tamamMi,
  type Beceri, type CcKurulumDurumu, type EklentiDurumu, type GraphifyDenetimi, type KatalogOgesi, type KomutOnayi, type KuruluEklenti, type ListeSonucu, type ListeTuru,
  type McpSunucu, type OgeHali, type PaketDurumu, type PaketOgeDurumu,
} from '../../shared/cc-eklentiler.ts';

// ── Komutlar (gerçek ya da sahte) ───────────────────────────────────────────────────────────────────────────────────────────
export interface Komut { exe: string; onArgs: string[]; test: boolean }

function testKomutu(degisken: string): Komut | null {
  const k = process.env[degisken];
  if (!k) return null;
  let dizi: unknown;
  try { dizi = JSON.parse(k); } catch { throw new Error(`${degisken} geçerli bir JSON dizisi değil.`); }
  if (!Array.isArray(dizi) || !dizi.length || !dizi.every((x) => typeof x === 'string')) throw new Error(`${degisken} bir metin dizisi olmalı.`);
  return { exe: dizi[0], onArgs: dizi.slice(1), test: true };
}

/** İndirilen uv (ya da testte sahtesi). */
export function uvKomutu(uvExe: string): Komut {
  const t = testKomutu('FUBER_UV_KOMUT');
  if (t) return t;
  if (testOrtami()) throw new Error('TEST GÜVENLİĞİ: gerçek uv testte/önizlemede çalıştırılamaz — FUBER_UV_KOMUT ile sahte uv ver (scripts/dev/sahte-uv.mjs).');
  return { exe: uvExe, onArgs: [], test: false };
}

/**
 * uv'nin komut klasöründeki graphify (yalnız orası: `uv tool dir --bin`). PATH'teki çıplak `graphify`ye ya da başka bir klasöre ASLA
 * düşülmez — başka bir programın aynı adlı komutu çalışabilirdi (düzeltme turu 1). Klasör bilinmiyor ya da dosya yoksa null.
 */
export function graphifyYolu(binDizini: string | null): string | null {
  if (!binDizini) return null;
  const y = path.join(binDizini, process.platform === 'win32' ? 'graphify.exe' : 'graphify');
  return fs.existsSync(y) ? y : null;
}

/** uv'nin kurduğu graphify komutu (ya da testte sahtesi); bulunamazsa düşer. */
export function graphifyKomutu(binDizini: string | null): Komut {
  const t = testKomutu('FUBER_GRAPHIFY_KOMUT');
  if (t) return t;
  if (testOrtami()) throw new Error('TEST GÜVENLİĞİ: gerçek graphify testte/önizlemede çalıştırılamaz — FUBER_GRAPHIFY_KOMUT ile sahte graphify ver (scripts/dev/sahte-graphify.mjs).');
  const y = graphifyYolu(binDizini);
  if (!y) throw new Error(`graphify komutu uv'nin komut klasöründe bulunamadı (${binDizini ?? 'klasör okunamadı'}).`);
  return { exe: y, onArgs: [], test: false };
}

/** Claude Code'un resmi Windows yükleyicisi (görünür PowerShell; `-NoExit`: kullanıcı sonucu görür). */
export function yukleyiciKomutu(): Komut {
  const t = testKomutu('FUBER_CC_YUKLEYICI_KOMUT');
  if (t) return t;
  if (testOrtami()) throw new Error('TEST GÜVENLİĞİ: gerçek Claude Code yükleyicisi testte/önizlemede çalıştırılamaz — FUBER_CC_YUKLEYICI_KOMUT ile sahte yükleyici ver.');
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return { exe: fs.existsSync(ps) ? ps : 'powershell.exe', onArgs: ['-NoProfile', '-NoExit', '-Command', `$Host.UI.RawUI.WindowTitle = 'Claude Code kurulumu'; ${CC_YUKLEYICI_KOMUTU}`], test: false };
}

/** Resmi yükleyicinin claude.exe'yi koyduğu yer (%USERPROFILE%\.local\bin). */
export const yerelClaudeYolu = () => path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');

function whereClaude(): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  return new Promise((coz) => {
    execFile('where.exe', ['claude'], { encoding: 'utf8', windowsHide: true, timeout: 5000 }, (h, out) => {
      if (h) return coz(null);
      coz(String(out ?? '').split(/\r?\n/).map((s) => s.trim()).find((s) => /\.exe$/i.test(s)) ?? null);
    });
  });
}

/**
 * Claude Code kurulu mu. Testte (FUBER_CLAUDE_KOMUT) sahte "kurulu"dur; FUBER_CLAUDE_KURULU_DENETIM=1 ise geçici evdeki ~/.local/bin/claude.exe
 * aranır (sahte yükleyici oraya yazar). Testte sahte verilmemişse gerçek Claude Code ARANMAZ (kurulu değil sayılır). Üretimde önce resmi
 * yükleyicinin yeri, sonra PATH (eşzamansız where.exe); bulununca claudeYolu() önbelleği bırakılır (uygulamanın geri kalanı da görsün).
 */
export async function claudeKuruluMu(): Promise<boolean> {
  if (process.env.FUBER_CLAUDE_KOMUT) return process.env.FUBER_CLAUDE_KURULU_DENETIM === '1' ? fs.existsSync(yerelClaudeYolu()) : true;
  if (testOrtami()) return false;
  if (fs.existsSync(yerelClaudeYolu())) { claudeYoluSifirla(); return true; }
  const w = await whereClaude();
  if (w) claudeYoluSifirla();
  return Boolean(w);
}

// ── Süreç: argüman dizisi, zaman aşımı, ağaçla öldürme ──────────────────────────────────────────────────────────────────────
export interface Calisma { kod: number | null; stdout: string; stderr: string; zamanAsimi: boolean; hata?: string }

/** Süren kurulum komutları (uygulama kapanırken ağaçlarıyla durdurulur: yarım kurulum yetim süreç bırakmaz). */
const calisanlar = new Set<number>();
export const calisanSurecler = () => [...calisanlar];
export function calisanlariDurdur(): void { for (const pid of calisanlar) agacOldur(pid, true); calisanlar.clear(); }

export function calistir(k: Komut, args: string[], o: { zamanAsimiMs: number; env?: NodeJS.ProcessEnv; cwd?: string }): Promise<Calisma> {
  return new Promise((coz) => {
    let c: ChildProcess;
    try {
      c = spawn(k.exe, [...k.onArgs, ...args], { cwd: o.cwd, env: o.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { coz({ kod: null, stdout: '', stderr: '', zamanAsimi: false, hata: (e as Error).message }); return; }
    const pid = c.pid;
    if (pid !== undefined) { calisanlar.add(pid); c.once('exit', () => calisanlar.delete(pid)); }
    let out = '', err = '', bitti = false;
    c.stdout?.setEncoding('utf8');
    c.stderr?.setEncoding('utf8');
    c.stdout?.on('data', (p: string) => { if (out.length < 8 * 1024 * 1024) out += p; });
    c.stderr?.on('data', (p: string) => { if (err.length < 64 * 1024) err += p; });
    const z = setTimeout(() => {
      if (bitti) return;
      bitti = true;
      if (c.pid !== undefined) agacOldur(c.pid);
      coz({ kod: null, stdout: out, stderr: err, zamanAsimi: true });
    }, o.zamanAsimiMs);
    c.on('error', (e) => { if (bitti) return; bitti = true; clearTimeout(z); coz({ kod: null, stdout: out, stderr: err, zamanAsimi: false, hata: e.message }); });
    c.on('close', (kod) => { if (bitti) return; bitti = true; clearTimeout(z); coz({ kod, stdout: out, stderr: err, zamanAsimi: false }); });
  });
}

/** Ortam: Fuber'in sırları (FUBER_SIR_*) geçmez; testte sahte ~/.claude (FUBER_CLAUDE_DIZIN → CLAUDE_CONFIG_DIR); Graphify sorgu günlüğü kapalı. */
export function temelOrtam(): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^FUBER_SIR_/i.test(k)) e[k] = v;
  if (process.env.FUBER_CLAUDE_DIZIN) e.CLAUDE_CONFIG_DIR = process.env.FUBER_CLAUDE_DIZIN;
  e.GRAPHIFY_QUERY_LOG_DISABLE = '1';
  return e;
}
/** PATH'in başına klasör ekler (Windows'ta anahtar "Path" olabilir: aynı anahtar güncellenir). */
export function yolaEkle(e: NodeJS.ProcessEnv, klasor: string): NodeJS.ProcessEnv {
  const anahtar = Object.keys(e).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  return { ...e, [anahtar]: e[anahtar] ? `${klasor}${path.delimiter}${e[anahtar]}` : klasor };
}

// ── Ayrıştırıcılar (saf; birim testli) ─────────────────────────────────────────────────────────────────────────────────────
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const SIR_GIBI = /\b(sk-ant-[A-Za-z0-9_-]{6,}|sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{12,}|xox[abprs]-[A-Za-z0-9-]{10,})/g;
/** Kullanıcıya ve günlüğe giden ileti: ANSI kodları ve sır gibi dizgiler atılır, kısaltılır. */
export function iletiTemizle(v: unknown, sinir = 400): string {
  if (typeof v !== 'string') return '';
  const s = v.replace(ANSI, '').replace(SIR_GIBI, '•••').replace(/\s+/g, ' ').trim();
  return s.length > sinir ? `${s.slice(0, sinir - 1)}…` : s;
}
const ilkSatir = (s: string) => { const l = iletiTemizle(s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(-3).join(' · '), 240); return l ? ` ${l}` : ''; };
const nesneMi = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x);

/** `--json` çıktısının son JSON satırı (Claude Code bir sonuç satırı yazar; öncesinde başka satırlar olabilir). */
export function sonJsonSatiri(stdout: string): Record<string, unknown> | null {
  const satirlar = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (let i = satirlar.length - 1; i >= 0; i--) {
    if (!satirlar[i].startsWith('{')) continue;
    try { const j: unknown = JSON.parse(satirlar[i]); if (nesneMi(j)) return j; } catch { /* sonraki */ }
  }
  return null;
}
/** Bütün çıktı tek JSON değeri (dizi ya da nesne); önünde metin varsa ilk '[' / '{'den. */
export function jsonCoz(stdout: string): unknown {
  const t = stdout.trim();
  for (const bas of [0, t.search(/[[{]/)]) {
    if (bas < 0) continue;
    try { return JSON.parse(t.slice(bas)); } catch { /* sonraki */ }
  }
  return null;
}

export type KurulumSonucu = { tur: 'tamam'; ileti?: string } | { tur: 'onay'; onay: KomutOnayi; ileti?: string } | { tur: 'hata'; ileti: string; kod?: string };

/**
 * `claude plugin install|update|enable|disable|uninstall … --json` sonucu: `{command, outcome:'ok'|'failed'|…, message, pluginId?, scope?,
 * failureCode?, shownCommand?: {kind, pluginId, command, mode | archiveUrl, catalogRevision, sha256}}`. shownCommand'ı olan başarısızlık
 * = kurulum komutu onay bekliyor. Düzeltme turu 1: kullanıcının gördüğü TAM olarak `--accept-command`ın onayladığıdır —
 *   · komut ASLA kısaltılmaz; gösterilemeyecek kadar uzunsa (KOMUT_GOSTERIM_SINIRI) onay sunulmaz: "kurulmadı";
 *   · `pluginId` istenen eklentiyle aynı olmalı (değilse ya da yoksa: "kurulmadı");
 *   · `archiveUrl` / `mode` / `catalogRevision` saklanır ve gösterilir; görünmeyen karakterler arayüzde işaretlenir (komutParcalari).
 * Sertleştirme (birleşim turu): kartta gösterilen HİÇBİR alan kısaltılmaz — sınırı aşan (komut 1.000 karakter / 20 satır, arşiv adresi
 * 1.000, kip ve katalog sürümü 200) onayı düşürür; `shownCommand`ta bilinmeyen anahtar, bilinmeyen `kind`, yanlış türde alan ya da
 * türüne ait olmayan alan (command_source'ta archiveUrl, entry_helper'da mode — özetin kapsamadığı veri gösterilmesin) → "kurulmadı".
 */
const GOSTERILEN_ALANLAR = new Set(['kind', 'pluginId', 'command', 'mode', 'archiveUrl', 'catalogRevision', 'sha256', 'acceptCommandMatched']);
function gosterilenKomutCoz(g: unknown, beklenenId: string): { onay: KomutOnayi } | { ileti: string; kod: string } {
  const bicim = { ileti: KOMUT_BICIMI_BILINMIYOR, kod: 'komut_bicimi_bilinmiyor' };
  if (!nesneMi(g) || Object.keys(g).some((k) => !GOSTERILEN_ALANLAR.has(k))) return bicim;
  const tur = g.kind;
  if (tur !== 'command_source' && tur !== 'entry_helper') return bicim;
  const metinMi = (v: unknown) => v === undefined || typeof v === 'string';
  if (!metinMi(g.command) || !metinMi(g.sha256) || !metinMi(g.pluginId) || !metinMi(g.mode) || !metinMi(g.archiveUrl)
    || !(metinMi(g.catalogRevision) || typeof g.catalogRevision === 'number') || !(g.acceptCommandMatched === undefined || typeof g.acceptCommandMatched === 'boolean')) return bicim;
  if ((tur === 'command_source' && g.archiveUrl !== undefined) || (tur === 'entry_helper' && (g.mode !== undefined || !g.archiveUrl))) return bicim;
  const sha = g.sha256 as string | undefined, komut = g.command as string | undefined, arsiv = g.archiveUrl as string | undefined;
  const mod = g.mode as string | undefined, katalog = g.catalogRevision === undefined ? undefined : String(g.catalogRevision);
  if (!sha || !/^[0-9a-f]{64}$/i.test(sha) || !komut || !komut.trim()) return { ileti: 'Eklentinin kurulum komutu okunamadı; kurulmadı.', kod: 'komut_okunamadi' };
  if (komut.length > KOMUT_GOSTERIM_SINIRI || komut.split('\n').length > KOMUT_SATIR_SINIRI || (arsiv?.length ?? 0) > KOMUT_GOSTERIM_SINIRI) return { ileti: KOMUT_COK_UZUN, kod: 'komut_cok_uzun' };
  if ((mod?.length ?? 0) > ALAN_GOSTERIM_SINIRI || (katalog?.length ?? 0) > ALAN_GOSTERIM_SINIRI) return { ileti: ALAN_COK_UZUN, kod: 'alan_cok_uzun' };
  const pid = g.pluginId as string | undefined;
  if (pid !== beklenenId) return { ileti: `Gösterilen kurulum komutu başka bir eklentiye ait (${iletiTemizle(pid ?? 'kimliksiz', 120)}); kurulmadı.`, kod: 'komut_kimligi_tutmadi' };
  return { onay: { komut, sha256: sha.toLowerCase(), pluginId: pid, tur, ...(arsiv ? { arsivAdresi: arsiv } : {}), ...(mod ? { mod } : {}), ...(katalog ? { katalogSurumu: katalog } : {}) } };
}

export function kurulumSonucuCoz(c: Calisma, beklenenId: string): KurulumSonucu {
  if (c.zamanAsimi) return { tur: 'hata', ileti: 'Zaman aşımı: Claude Code yanıt vermedi.' };
  const j = sonJsonSatiri(c.stdout);
  if (j) {
    const sonuc = String(j.outcome ?? '');
    if (sonuc === 'ok' || sonuc === 'up_to_date' || j.alreadyInGoalState === true) return { tur: 'tamam', ileti: iletiTemizle(j.message) || undefined };
    if (j.shownCommand !== undefined && j.shownCommand !== null) {
      const r = gosterilenKomutCoz(j.shownCommand, beklenenId);
      return 'onay' in r ? { tur: 'onay', onay: r.onay, ileti: iletiTemizle(j.message) || undefined } : { tur: 'hata', ileti: r.ileti, kod: r.kod };
    }
    const kod = typeof j.failureCode === 'string' ? j.failureCode : undefined;
    return { tur: 'hata', ileti: iletiTemizle(j.message) || `Kurulamadı (${kod ?? (sonuc || 'bilinmeyen sonuç')}).`, ...(kod ? { kod } : {}) };
  }
  if (c.hata) return { tur: 'hata', ileti: iletiTemizle(c.hata) };
  return c.kod === 0 ? { tur: 'tamam' } : { tur: 'hata', ileti: `Claude Code yanıtı okunamadı (çıkış kodu ${c.kod ?? '?'}).${ilkSatir(c.stderr)}` };
}

/** `claude plugin marketplace list --json` → resmi katalog tanımlı mı (okunamadıysa null). */
export function katalogTanimliMi(stdout: string): boolean | null {
  const j = jsonCoz(stdout);
  const l = Array.isArray(j) ? j : nesneMi(j) && Array.isArray(j.marketplaces) ? j.marketplaces : null;
  if (!l) return null;
  return l.some((m) => nesneMi(m) && (m.name === CC_KATALOG || String(m.repo ?? '').toLowerCase() === CC_KATALOG_DEPOSU || (nesneMi(m.source) && String(m.source.repo ?? '').toLowerCase() === CC_KATALOG_DEPOSU)));
}

const metinler = (x: unknown): string[] => {
  if (Array.isArray(x)) return x.map((e) => (typeof e === 'string' ? e : nesneMi(e) ? String(e.message ?? e.error ?? e.name ?? '') : '')).map((s) => iletiTemizle(s, 200)).filter(Boolean);
  if (nesneMi(x)) return Object.keys(x);
  return typeof x === 'string' && x ? [iletiTemizle(x, 200)] : [];
};

/**
 * `claude plugin list --json` → kurulu eklentiler. Denetleyicinin gerçek 2.1.310 ikilisinde doğruladığı alanlar (salt okur, yalnız adlar):
 * `id, version, scope, enabled, installPath, installedAt, lastUpdated, projectEnabled, mcpServers (nesne), errors (dizi), errorDetails (dizi)`.
 * Dizi ya da `{installed}` kabul edilir (`--available` çıktısının `installed`ı aynı biçimde); okunamadıysa null.
 */
export function eklentiListesiCoz(stdout: string): KuruluEklenti[] | null {
  const j = jsonCoz(stdout);
  const l = Array.isArray(j) ? j : nesneMi(j) && Array.isArray(j.installed) ? j.installed : null;
  if (!l) return null;
  return l.filter(nesneMi).map((x) => {
    const id = String(x.id ?? x.pluginId ?? '');
    const [ad, katalog] = id.split('@');
    const p = katalog === CC_KATALOG ? paketOgesi(ad) : undefined;
    const hatalar = [...new Set([...metinler(x.errors), ...metinler(x.errorDetails)])];
    return {
      id, ad: p?.ad ?? ad, ...(katalog ? { katalog } : {}),
      ...(typeof x.version === 'string' ? { surum: x.version } : {}), ...(typeof x.scope === 'string' ? { kapsam: x.scope } : {}),
      etkin: x.enabled !== false, ...(typeof x.installPath === 'string' ? { yol: x.installPath } : {}),
      hatalar, mcp: metinler(x.mcpServers), paketteMi: Boolean(p),
      ...(p ? { aciklama: p.kazanc } : {}),
    } satisfies KuruluEklenti;
  }).filter((e) => e.id);
}

/** `source` alanı (dize ya da nesne: `{source, repo}` / `{source, url}` / `{source, path}`) → kısa gösterim. */
function kaynakMetni(s: unknown): string | undefined {
  if (typeof s === 'string') return iletiTemizle(s, 160) || undefined;
  if (!nesneMi(s)) return undefined;
  const v = s.repo ?? s.url ?? s.path ?? s.package ?? s.source;
  return typeof v === 'string' ? iletiTemizle(v, 160) || undefined : undefined;
}

/**
 * `claude plugin list --available --json` → `{installed: [...], available: [...]}` (denetleyici gerçek ikilide doğruladı). `available[]`:
 * `pluginId, name, description, marketplaceName, source (nesne ya da dize), installCount, version`; kurulu olan `installed[].id`'den.
 * Hoşgörü: dizi gelirse öğeler, `pluginId` yoksa `name@marketplaceName`. En çok 600 öğe.
 */
export function katalogListesiCoz(stdout: string): KatalogOgesi[] | null {
  const j = jsonCoz(stdout);
  const kurulu = new Set((nesneMi(j) && Array.isArray(j.installed) ? j.installed : []).filter(nesneMi).map((x) => String(x.id ?? x.pluginId ?? '')));
  const l = nesneMi(j) && Array.isArray(j.available) ? j.available : Array.isArray(j) ? j : null;
  if (!l) return null;
  const out: KatalogOgesi[] = [];
  for (const x of l.filter(nesneMi)) {
    const pk = typeof x.marketplaceName === 'string' ? x.marketplaceName : '';
    const id = typeof x.pluginId === 'string' && x.pluginId ? x.pluginId : typeof x.name === 'string' && x.name ? (pk ? `${x.name}@${pk}` : x.name) : '';
    if (!id) continue;
    const [ad, katalog = ''] = id.split('@');
    const kaynak = kaynakMetni(x.source);
    out.push({
      id, ad: typeof x.name === 'string' && x.name ? x.name : ad,
      aciklama: iletiTemizle(x.description, 240),
      katalog: pk || katalog,
      kurulu: kurulu.has(id),
      ...(typeof x.version === 'string' ? { surum: x.version } : {}),
      ...(typeof x.installCount === 'number' ? { kurulumSayisi: x.installCount } : {}),
      ...(kaynak ? { kaynak } : {}),
    });
    if (out.length >= 600) break;
  }
  return out;
}

/**
 * `claude mcp list` (metin; `--json` yok, sunucuları sağlık denetiminden geçirir): her satır `ad: hedef - durum`. Eklentiyle gelen sunucu
 * (`plugin:…`) ve claude.ai bağlayıcıları buradan kaldırılmaz (eklentiyi kaldır / claude.ai). Biçim gerçek ikiliyle doğrulanmadı: hoşgörülü.
 */
export function mcpListesiCoz(stdout: string): McpSunucu[] {
  const out: McpSunucu[] = [];
  for (const ham of stdout.replace(ANSI, '').split(/\r?\n/)) {
    const s = ham.trim();
    if (!s || /^checking mcp server/i.test(s) || /^no mcp servers/i.test(s)) continue;
    const m = /^(.+?):\s+(.+?)\s+-\s+(.+)$/.exec(s);
    if (!m) continue;
    const [, ad, hedef, durum] = m;
    const hal = /✓|\bconnected\b/i.test(durum) ? 'bagli' : /✗|fail|error|hata/i.test(durum) ? 'hata' : /pending|⏸|auth|!|bekl/i.test(durum) ? 'bekliyor' : 'bilinmiyor';
    const kaynak = /^plugin:/i.test(ad) ? 'eklenti' : /^claude\.ai\b/i.test(ad) ? 'claude.ai' : 'kullanici';
    out.push({ ad: ad.trim(), hedef: iletiTemizle(hedef, 200), hal, durumMetni: iletiTemizle(durum.replace(/^[✓✗⏸!\s]+/u, ''), 120), kaynak, kaldirilabilir: kaynak === 'kullanici' });
  }
  return out.slice(0, 200);
}

/** SKILL.md'nin ön bilgisinden (--- … ---) name / description. */
export function beceriBasligi(icerik: string): { ad?: string; aciklama?: string } {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(icerik);
  if (!m) return {};
  const o: Record<string, string> = {};
  const satirlar = m[1].split(/\r?\n/);
  for (let i = 0; i < satirlar.length; i++) {
    const a = /^([A-Za-z_-]+):\s*(.*)$/.exec(satirlar[i]);
    if (!a) continue;
    let v = a[2].trim();
    if (v === '>' || v === '|' || v === '>-' || v === '|-') { const d: string[] = []; while (i + 1 < satirlar.length && /^\s+/.test(satirlar[i + 1])) d.push(satirlar[++i].trim()); v = d.join(' '); }
    o[a[1].toLowerCase()] = v.replace(/^(['"])(.*)\1$/, '$2');
  }
  return { ...(o.name ? { ad: o.name } : {}), ...(o.description ? { aciklama: o.description } : {}) };
}

/** Ev klasörü önekini "~" ile gösterir (kullanıcıya gösterilen yollar kısa ve kişisel adı taşımaz). */
export function evKisalt(yol: string, ev = os.homedir()): string {
  const y = path.normalize(yol), e = path.normalize(ev);
  return y.toLowerCase().startsWith(e.toLowerCase() + path.sep) || y.toLowerCase() === e.toLowerCase() ? `~${y.slice(e.length)}` : y;
}
/** Graphify'ın kurduğu beceri mi (TAM ad; «graphify-notlar» gibi kullanıcı becerisi kendisi olarak çöpe taşınabilir). */
export const graphifyAdi = (ad: string) => GRAPHIFY_BECERILERI.some((g) => g.toLowerCase() === ad.toLowerCase());
/** ~/.claude/skills/<ad>/SKILL.md (yalnız okunur; en çok 300). Graphify'ın becerisi ayrıca işaretlenir. */
export function becerileriOku(claudeDizini: string): Beceri[] {
  const kok = path.join(claudeDizini, 'skills');
  let l: fs.Dirent[];
  try { l = fs.readdirSync(kok, { withFileTypes: true }); } catch { return []; }
  const out: Beceri[] = [];
  for (const d of l) {
    if (!d.isDirectory()) continue;
    const yol = path.join(kok, d.name);
    let icerik = '';
    try { const f = path.join(yol, 'SKILL.md'); if (!fs.existsSync(f)) continue; icerik = fs.readFileSync(f, 'utf8').slice(0, 16_000); } catch { continue; }
    const b = beceriBasligi(icerik);
    out.push({ ad: d.name, aciklama: iletiTemizle(b.aciklama ?? '', 260), yol: evKisalt(yol), kaynak: graphifyAdi(d.name) ? 'graphify' : 'kullanici' });
    if (out.length >= 300) break;
  }
  return out.sort((a, b) => a.ad.localeCompare(b.ad, 'tr'));
}
export const graphifyBecerisiVar = (claudeDizini: string) => becerileriOku(claudeDizini).some((b) => b.kaynak === 'graphify');

/**
 * Görev 7 (0.10) + K8: Graphify'ın Claude Code kancası bozuk mu — yalnız OKUR (settings.json'a ve hiçbir dosyaya yazmaz, komut çalıştırmaz).
 *   · kanca: ~/.claude/settings.json → hooks.*[].hooks[].command içinde `graphify` komutu (tam sözcük: «graphify-notlar» değil). Ayrıştırma
 *     settings.json'ın değişme zamanı + boyuna göre önbellekte (her durum okumasında tek stat).
 *   · calistirilabilir: kancadaki komut mutlak yolsa o dosya, değilse verilen komut klasörlerinde (uv'nin komut klasörleri — PATH'in tamamı
 *     TARANMAZ: ana süreçte eşzamanlı stat yükü olmasın; düzeltme turu 1) graphify bulunuyor; bulunan dosya Fuber'in uv ortamına (uygulama
 *     veri klasörü/araclar/uv-araclar/graphifyy) bağlı bir uv kısayoluysa gösterdiği Python da yerinde (veri klasörü silinince kısayol durur
 *     ama ortamı gider — M3).
 */
const GRAPHIFY_KOMUTU_RE = /(?:^|[\s"'\\/&|;(])graphify(?:\.exe|\.cmd|\.bat)?(?=$|[\s"')&|;])/i;
const BOM = String.fromCharCode(0xfeff);
const kancaOnbellek = new Map<string, { anahtar: string; komutlar: string[] }>();
function kancaKomutlari(claudeDizini: string): string[] {
  const dosya = path.join(claudeDizini, 'settings.json');
  let st: fs.Stats;
  try { st = fs.statSync(dosya); } catch { kancaOnbellek.delete(dosya); return []; }
  const anahtar = `${st.mtimeMs}:${st.size}`;
  const o = kancaOnbellek.get(dosya);
  if (o?.anahtar === anahtar) return o.komutlar;
  let j: unknown = null;
  try { const m = fs.readFileSync(dosya, 'utf8'); j = JSON.parse(m.startsWith(BOM) ? m.slice(1) : m); } catch { j = null; }
  const komutlar: string[] = [];
  const hooks = nesneMi(j) ? j.hooks : null;
  for (const olay of nesneMi(hooks) ? Object.values(hooks) : []) {
    for (const g of Array.isArray(olay) ? olay : []) {
      for (const h of nesneMi(g) && Array.isArray(g.hooks) ? g.hooks : []) if (nesneMi(h) && typeof h.command === 'string') komutlar.push(h.command);
    }
  }
  kancaOnbellek.set(dosya, { anahtar, komutlar });
  return komutlar;
}
/** Kancadaki graphify komutunun ilk sözcüğü mutlak bir yolsa o yol (tırnaklı ya da tırnaksız). */
function komutYolu(komut: string): string | null {
  const t = komut.trim();
  const kapanis = t.indexOf('"', 1);
  const ilk = t.startsWith('"') ? t.slice(1, kapanis > 0 ? kapanis : undefined) : t.split(/\s+/)[0];
  return /graphify(\.exe|\.cmd|\.bat)?$/i.test(ilk) && (path.isAbsolute(ilk) || /^[A-Za-z]:[\\/]/.test(ilk)) ? ilk : null;
}
/** Dosya Fuber'in uv ortamına bağlı bir uv kısayoluysa gösterdiği Python'un yolu (UTF-8 ya da UTF-16 gömülü); değilse null. */
const kisayolOnbellek = new Map<string, { anahtar: string; py: string | null }>();
function kisayolPythonu(dosya: string): string | null {
  let st: fs.Stats;
  try { st = fs.statSync(dosya); } catch { return null; }
  const anahtar = `${st.size}:${st.mtimeMs}`;
  const o = kisayolOnbellek.get(dosya);
  if (o?.anahtar === anahtar) return o.py;
  let py: string | null = null;
  if (st.size <= 8 * 1024 * 1024) {
    try {
      const b = fs.readFileSync(dosya);
      const RE = /[A-Za-z]:[\\/][^\0\r\n"<>|*?]*?uv-araclar[\\/]graphifyy[\\/][^\0\r\n"<>|*?]*?pythonw?\.exe/i;
      const l1 = RE.exec(b.toString('latin1'));
      py = l1 ? Buffer.from(l1[0], 'latin1').toString('utf8') : RE.exec(b.toString('utf16le'))?.[0] ?? RE.exec(b.subarray(1).toString('utf16le'))?.[0] ?? null;
    } catch { py = null; }
  }
  kisayolOnbellek.set(dosya, { anahtar, py });
  return py;
}
export function graphifyDenetle(o: { claudeDizini: string; araclarDizini: string; komutDizinleri: readonly string[] }): GraphifyDenetimi {
  const komutlar = kancaKomutlari(o.claudeDizini).filter((k) => GRAPHIFY_KOMUTU_RE.test(k));
  if (!komutlar.length) return { kanca: false, calistirilabilir: false };
  // uv kısayolu Windows'ta graphify.exe (uv'nin yazdığı tek ad); en çok birkaç stat.
  const ad = process.platform === 'win32' ? 'graphify.exe' : 'graphify';
  const mutlak = komutlar.map(komutYolu).find(Boolean);
  const aday = mutlak ?? o.komutDizinleri.filter(Boolean).map((d) => path.join(d, ad)).find((y) => { try { return fs.statSync(y).isFile(); } catch { return false; } });
  if (!aday || !fs.existsSync(aday)) return { kanca: true, calistirilabilir: false };
  const py = kisayolPythonu(aday);
  return { kanca: true, calistirilabilir: !py || fs.existsSync(py) };
}

/** `uv tool list` çıktısında graphifyy kurulu mu (satır "graphifyy v0.9.95"). */
export const uvListesindeGraphify = (stdout: string) => stdout.split(/\r?\n/).some((s) => new RegExp(`^${GRAPHIFY_PAKETI}\\s+v?\\d`, 'i').test(s.trim()));

// ── Güvenli zip açıcı (yalnız izinli dosya adları; arşivdeki yol KULLANILMAZ) ──────────────────────────────────────────────────
/**
 * Merkezi dizinden okur; yalnız `izinli` adlardaki dosyaları (kökte ya da tek klasör altında) `hedef/<ad>` olarak yazar — arşivdeki yol hiç
 * kullanılmadığından yol geçişi olanaksızdır. Arşivde mutlak yol, sürücü harfi ya da `..` içeren TEK bir giriş bile varsa arşiv kurcalanmış
 * sayılır: hiçbir şey yazılmaz. CRC32 ve boyut doğrulanır; zip64 ve şifreli girişler reddedilir.
 */
export function zipCikar(zipYolu: string, hedef: string, izinli: readonly string[], azamiBayt = 256 * 1024 * 1024): string[] {
  return zipTamponuCikar(fs.readFileSync(zipYolu), hedef, izinli, azamiBayt);
}
/** zipCikar'ın bellekteki arşivle çalışanı: özeti alınan tampon AYNEN açılır (diskten ikinci okuma yok — doğrulama ile açma arası değişemez). */
export function zipTamponuCikar(b: Buffer, hedef: string, izinli: readonly string[], azamiBayt = 256 * 1024 * 1024): string[] {
  let e = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65_535); i--) if (b.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('Arşiv okunamadı (zip sonu yok).');
  const adet = b.readUInt16LE(e + 10);
  let p = b.readUInt32LE(e + 16);
  if (adet === 0xffff || p === 0xffffffff) throw new Error('Arşiv biçimi desteklenmiyor (zip64).');
  const girisler: { ad: string; taban: string; yontem: number; crc: number; sik: number; acik: number; yerel: number; bayrak: number }[] = [];
  for (let n = 0; n < adet; n++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== 0x02014b50) throw new Error('Arşiv bozuk (merkezi dizin).');
    const bayrak = b.readUInt16LE(p + 8), yontem = b.readUInt16LE(p + 10), crc = b.readUInt32LE(p + 16), sik = b.readUInt32LE(p + 20), acik = b.readUInt32LE(p + 24);
    const adBoy = b.readUInt16LE(p + 28), ekBoy = b.readUInt16LE(p + 30), notBoy = b.readUInt16LE(p + 32), yerel = b.readUInt32LE(p + 42);
    const ad = b.toString('utf8', p + 46, p + 46 + adBoy);
    p += 46 + adBoy + ekBoy + notBoy;
    const parca = ad.split(/[\\/]/).filter(Boolean);
    if (/^[\\/]/.test(ad) || /^[A-Za-z]:/.test(ad) || parca.includes('..') || ad.includes('\0')) throw new Error(`Arşiv güvensiz bir yol içeriyor (${ad.slice(0, 80)}); hiçbir şey açılmadı.`);
    if (ad.endsWith('/') || !parca.length) continue;
    girisler.push({ ad, taban: parca[parca.length - 1], yontem, crc, sik, acik, yerel, bayrak });
  }
  const secilen = girisler.filter((g) => izinli.includes(g.taban) && g.ad.split(/[\\/]/).filter(Boolean).length <= 2);
  fs.mkdirSync(hedef, { recursive: true });
  const yazilan: string[] = [];
  for (const g of secilen) {
    if (yazilan.includes(g.taban)) continue;
    if (g.bayrak & 0x1) throw new Error(`Arşivde şifreli giriş: ${g.taban}`);
    if (g.acik > azamiBayt || g.sik === 0xffffffff || g.acik === 0xffffffff) throw new Error(`Arşivdeki ${g.taban} çok büyük.`);
    if (g.yerel + 30 > b.length || b.readUInt32LE(g.yerel) !== 0x04034b50) throw new Error('Arşiv bozuk (yerel başlık).');
    const bas = g.yerel + 30 + b.readUInt16LE(g.yerel + 26) + b.readUInt16LE(g.yerel + 28);
    const sik = b.subarray(bas, bas + g.sik);
    if (sik.length !== g.sik) throw new Error('Arşiv bozuk (kısa veri).');
    const acik = g.yontem === 0 ? sik : g.yontem === 8 ? zlib.inflateRawSync(sik, { maxOutputLength: Math.max(1, g.acik) }) : null;
    if (!acik) throw new Error(`Arşivde desteklenmeyen sıkıştırma (${g.yontem}).`);
    if (acik.length !== g.acik || (zlib.crc32(acik) >>> 0) !== g.crc) throw new Error(`Arşivdeki ${g.taban} doğrulanamadı (CRC).`);
    const cikis = path.join(hedef, g.taban);
    fs.writeFileSync(`${cikis}.yaziliyor`, acik);
    fs.renameSync(`${cikis}.yaziliyor`, cikis);
    yazilan.push(g.taban);
  }
  return yazilan;
}

// ── Kurucu ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface UvKaynagi { url: string; sha256: string; boyut?: number }
export interface KurucuSecenekleri {
  /** Durum dosyası ve günlük (uygulama veri klasörü/claudecode). */
  veriDizini: string;
  /** uv, araç ortamı, Python ve önbellek (uygulama veri klasörü/araclar). */
  araclarDizini: string;
  /** ~/.claude (testte FUBER_CLAUDE_DIZIN). */
  claudeDizini: () => string;
  /** Durum değişince (ilerleme; 'claudecode:eklenti' olayı — telefona GİTMEZ). */
  olay?: (d: PaketDurumu) => void;
  /** Bildirim (ada / tost / Windows bildirimi). */
  bildir?: (baslik: string, metin: string) => void;
  /** Beceri klasörünü Geri Dönüşüm Kutusu'na taşır (Electron shell.trashItem). */
  cop?: (yol: string) => Promise<void>;
  uvKaynagi?: UvKaynagi;
  /** İndirici: `azamiBayt` aşılınca indirmeyi KESER (sunucu ne gönderirse göndersin). */
  indirici?: (url: string, hedef: string, sha256?: string, ilerleme?: Ilerleme, azamiBayt?: number) => Promise<void>;
  /** İşletim sistemi (test: Graphify yalnız Windows'ta kurulur). */
  platform?: NodeJS.Platform;
  claudeKurulu?: () => Promise<boolean>;
  auth?: () => Promise<{ girisYapildi: boolean; yontem?: string; hata?: string }>;
  zamanAsimi?: Partial<typeof ZAMAN>;
  izlemeAraligiMs?: number;
  /** Geliştirici modu mu (İş modunda hiçbir kurulum başlamaz/sürmez, bildirim yok; durum ve listeler yalnız okunur). */
  etkin?: () => boolean;
  /**
   * Görev 7: Graphify kancasının çağıracağı `graphify`nin arandığı klasörler (eklenti-yonetim.ts: ~/.local/bin + PATH; testte geçici).
   * Verilirse durum() Graphify kancasını denetler (EklentiDurumu.graphify) ve kanca bozukken Graphify'ı yeniden kurmak "beceri var" diye atlanmaz.
   */
  graphifyKomutDizinleri?: () => readonly string[];
}
const IS_MODU = 'Geliştirici araçları yalnız Developer mode’da kurulur.';
const GRAPHIFY_YALNIZ_WINDOWS = 'Graphify şimdilik yalnız Windows’ta kurulur; macOS/Linux’ta elle: uv tool install graphifyy==0.9.95, ardından graphify install.';
const GRAPHIFY_ELLE_TEMIZLIK = 'Elle: Claude Code’da /hooks ile graphify kancasını kaldır, ~/.claude/skills/graphify klasörünü ve ~/.local/bin/graphify.exe’yi sil.';

const ZAMAN = { kisa: 60_000, liste: 45_000, mcp: 90_000, katalog: 180_000, kurulum: 300_000, uv: 900_000, indirme: 600_000, izleme: 20 * 60_000 };
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}(@[A-Za-z0-9][A-Za-z0-9._-]{0,99})?$/;
const MCP_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,99}$/;
const KAPSAM = new Set(['user', 'project', 'local']);
interface Kayit { surum: 1; adimGoruldu: boolean; ogeler: PaketOgeDurumu[] }
type Islem = 'ac' | 'kapat' | 'kaldir' | 'guncelle';
export interface IslemSonucu { tamam: boolean; hata?: string; ileti?: string; onay?: KomutOnayi }

export class EklentiKurucu {
  private kayit: Kayit;
  private calisiyor = false;
  /** Uygulama kapanıyor (kapat()): yeni komut başlamaz, hâl değişmez (durdurulan kurulum "hata" diye yazılmaz; sonraki açılışta sürer). */
  private kapandi = false;
  private yeniden = false;
  private bildirilecek = false;
  private zincir: Promise<unknown> = Promise.resolve();
  private yukleyiciAcik = false;
  private izleyici: ReturnType<typeof setInterval> | null = null;
  private authOnbellek: { zaman: number; d: { girisYapildi: boolean; yontem?: string; hata?: string } } | null = null;
  private katalogHazir = false;
  private katalogHatasi = '';
  private onbellek = new Map<ListeTuru, ListeSonucu<unknown>>();
  /** Paket dışı (katalogda ara, güncelle) bekleyen kurulum komutu onayları; güncellemede özgün kapsam (`-s`) korunur. */
  private tekilOnay = new Map<string, { islem: 'install' | 'update'; onay: KomutOnayi; kapsam?: string }>();
  private readonly z: typeof ZAMAN;
  private readonly s: KurucuSecenekleri;

  constructor(s: KurucuSecenekleri) {
    this.s = s;
    this.z = { ...ZAMAN, ...s.zamanAsimi };
    this.kayit = this.yukle();
  }

  // ── Kayıt ve günlük ──
  private get durumDosyasi() { return path.join(this.s.veriDizini, 'gelistirici-paketi.json'); }
  get gunlukYolu() { return path.join(this.s.veriDizini, 'eklenti-gunlugu.log'); }
  private yukle(): Kayit {
    const r = jsonOku(this.durumDosyasi);
    const v = typeof r === 'object' ? r.veri : {};
    const ogeler = (Array.isArray(v.ogeler) ? v.ogeler : []).filter(nesneMi).filter((o) => typeof o.id === 'string' && paketOgesi(o.id))
      .map((o) => {
        const hal = String(o.hal) as OgeHali;
        // Yarıda kalan (uygulama kapandı): kuyruğa döner, sonraki açılışta sürer.
        const yeni: PaketOgeDurumu = { id: String(o.id), hal: hal === 'kuruluyor' ? 'sirada' : hal, ...(typeof o.ileti === 'string' ? { ileti: o.ileti } : {}), ...(typeof o.zaman === 'string' ? { zaman: o.zaman } : {}) };
        const k = nesneMi(o.onay) ? o.onay : null;
        const metin = (v: unknown) => (typeof v === 'string' ? v : undefined);
        // Saklı onay yalnız TAM ise geri yüklenir (komut sınırı aşmıyor, kimlik bu öğenin); değilse (eski sürümün kısaltılmış kaydı dahil)
        // kuyruğa döner: Claude Code komutu yeniden ve tam bildirir.
        if (hal === 'onay' && k && metin(k.komut) && /^[0-9a-f]{64}$/.test(metin(k.sha256) ?? '') && metin(k.komut)!.length <= KOMUT_GOSTERIM_SINIRI
          && metin(k.komut)!.split('\n').length <= KOMUT_SATIR_SINIRI && (metin(k.arsivAdresi)?.length ?? 0) <= KOMUT_GOSTERIM_SINIRI
          && (metin(k.mod)?.length ?? 0) <= ALAN_GOSTERIM_SINIRI && (metin(k.katalogSurumu)?.length ?? 0) <= ALAN_GOSTERIM_SINIRI
          && (k.tur === 'command_source' || k.tur === 'entry_helper') && k.pluginId === eklentiKimligi({ id: String(o.id) })) {
          yeni.onay = {
            komut: metin(k.komut)!, sha256: metin(k.sha256)!, pluginId: metin(k.pluginId)!, ...(metin(k.tur) ? { tur: metin(k.tur) } : {}),
            ...(metin(k.arsivAdresi) ? { arsivAdresi: metin(k.arsivAdresi) } : {}), ...(metin(k.mod) ? { mod: metin(k.mod) } : {}), ...(metin(k.katalogSurumu) ? { katalogSurumu: metin(k.katalogSurumu) } : {}),
          };
        } else if (hal === 'onay') { yeni.hal = 'sirada'; delete yeni.ileti; }
        return yeni;
      });
    return { surum: 1, adimGoruldu: v.adimGoruldu === true, ogeler };
  }
  private kaydet(): void {
    try { fs.mkdirSync(this.s.veriDizini, { recursive: true }); jsonYaz(this.durumDosyasi, this.kayit, 1); } catch (e) { this.gunluk(`durum yazılamadı: ${(e as Error).message}`); }
  }
  /** Günlük (uygulama veri klasöründe; sır gibi dizgiler atılır; 512 KB'ta bir önceki dosyaya döner). */
  gunluk(satir: string): void {
    try {
      fs.mkdirSync(this.s.veriDizini, { recursive: true });
      const y = this.gunlukYolu;
      try { if (fs.statSync(y).size > 512 * 1024) fs.renameSync(y, `${y}.1`); } catch { /* yok */ }
      fs.appendFileSync(y, `${new Date().toISOString()} ${iletiTemizle(satir, 1200)}\n`);
    } catch { /* günlük en iyi çaba */ }
  }

  paketDurumu(): PaketDurumu {
    return {
      adimGoruldu: this.kayit.adimGoruldu, calisiyor: this.calisiyor,
      claudeBekleniyor: this.kayit.ogeler.some((o) => o.hal === 'bekliyor'),
      ogeler: this.kayit.ogeler.map((o) => ({ ...o, ...(o.onay ? { onay: { ...o.onay } } : {}) })), gunluk: this.gunlukYolu,
    };
  }
  private yay(): void { try { this.s.olay?.(this.paketDurumu()); } catch { /* yayın hatası işi durdurmaz */ } }
  private oge(id: string): PaketOgeDurumu | undefined { return this.kayit.ogeler.find((o) => o.id === id); }
  private hal(id: string, hal: OgeHali, ileti?: string, asama?: string, onay?: KomutOnayi): void {
    if (this.kapandi) return;
    const o = this.oge(id) ?? (() => { const y: PaketOgeDurumu = { id, hal }; this.kayit.ogeler.push(y); return y; })();
    o.hal = hal;
    if (ileti !== undefined) o.ileti = ileti; else delete o.ileti;
    if (asama) o.asama = asama; else delete o.asama;
    if (onay) o.onay = onay; else delete o.onay;
    o.zaman = new Date().toISOString();
    if (hal !== 'kuruluyor') this.kaydet();
    this.yay();
  }
  private asama(id: string, asama: string): void { const o = this.oge(id); if (!o) return; o.asama = asama; this.yay(); }
  private sirala<T>(f: () => Promise<T>): Promise<T> {
    const p = this.zincir.then(f, f);
    this.zincir = p.catch(() => undefined);
    return p;
  }
  private onbellegiSil(): void { this.onbellek.clear(); }

  // ── Claude Code ──
  private claudeKurulu(): Promise<boolean> { return (this.s.claudeKurulu ?? claudeKuruluMu)().catch(() => false); }
  private kapaniyor(): Calisma { return { kod: null, stdout: '', stderr: '', zamanAsimi: false, hata: 'Uygulama kapanıyor.' }; }
  private async claude(args: string[], zamanAsimiMs: number): Promise<Calisma> {
    if (this.kapandi) return this.kapaniyor();
    let k: Komut;
    try { k = ccKomutu(); } catch (e) { this.gunluk(`claude ${args.join(' ')} → çalıştırılamadı: ${(e as Error).message}`); return { kod: null, stdout: '', stderr: '', zamanAsimi: false, hata: (e as Error).message }; }
    const c = await calistir(k, args, { zamanAsimiMs, env: temelOrtam(), cwd: os.homedir() });
    const j = sonJsonSatiri(c.stdout);
    this.gunluk(`claude ${args.join(' ')} → ${c.zamanAsimi ? 'zaman aşımı' : `çıkış ${c.kod ?? '?'}`}${j ? ` · ${String(j.outcome ?? '')} ${iletiTemizle(j.message, 300)}` : c.kod ? ilkSatir(c.stderr) : ''}`);
    return c;
  }

  async durum(): Promise<EklentiDurumu> {
    const kurulu = await this.claudeKurulu();
    const claude: CcKurulumDurumu = { kurulu, ...(this.yukleyiciAcik && !kurulu ? { yukleyiciAcik: true } : {}) };
    if (kurulu) {
      if (this.yukleyiciAcik) this.yukleyiciBulundu();
      try {
        if (!this.authOnbellek || Date.now() - this.authOnbellek.zaman > 30_000) {
          const a = await (this.s.auth ?? ccAuthDurumu)();
          this.authOnbellek = { zaman: Date.now(), d: { girisYapildi: a.girisYapildi, ...(a.yontem ? { yontem: a.yontem } : {}), ...(a.hata ? { hata: a.hata } : {}) } };
        }
        Object.assign(claude, this.authOnbellek.d);
      } catch (e) { claude.hata = iletiTemizle((e as Error).message, 200); }
      // Claude Code sonradan kurulduysa (başka yoldan da) bekleyen paket kaldığı yerden sürer.
      if (!this.calisiyor && this.kayit.ogeler.some((o) => o.hal === 'bekliyor')) void this.isle();
    }
    const graphify = this.graphifyDenetimi();
    return { claude, paket: this.paketDurumu(), ...(graphify ? { graphify } : {}) };
  }

  /** Graphify kancasının denetimi (yalnız okur; seçenek verilmediyse null). */
  private graphifyDenetimi(): GraphifyDenetimi | null {
    if (!this.s.graphifyKomutDizinleri) return null;
    try { return graphifyDenetle({ claudeDizini: this.s.claudeDizini(), araclarDizini: this.s.araclarDizini, komutDizinleri: this.s.graphifyKomutDizinleri() }); } catch { return null; }
  }
  /** Kanca kurulu ama graphify bulunamıyor (M3): yeniden kurmak onarır, "beceri var" diye atlanmaz. */
  private graphifySorunlu(): boolean { const g = this.graphifyDenetimi(); return Boolean(g?.kanca && !g.calistirilabilir); }

  /** Oturum açıldı (görünür `claude auth login`): durum önbelleği bırakılır. */
  authSifirla(): void { this.authOnbellek = null; }

  /** "Claude Code'u kur": resmi yükleyici GÖRÜNÜR PowerShell penceresinde (kullanıcının tıklamasıyla). Kurulunca bekleyen paket sürer. */
  private get etkin(): boolean { try { return this.s.etkin ? this.s.etkin() : true; } catch { return false; } }

  ccKur(): IslemSonucu {
    if (!this.etkin) return { tamam: false, hata: IS_MODU };
    // Yükleyici zaten açık (ikinci tık / çift tık): ikinci bir PowerShell yükleyicisi AÇILMAZ.
    if (this.yukleyiciAcik) { this.gunluk('Claude Code yükleyicisi zaten açık; ikincisi açılmadı'); return { tamam: true, ileti: 'Yükleyici zaten açık (PowerShell penceresinde).' }; }
    if (process.platform !== 'win32' && !process.env.FUBER_CC_YUKLEYICI_KOMUT) return { tamam: false, hata: 'Bu düğme Windows içindir; macOS/Linux’ta Claude Code’u claude.ai/install.sh ile kur.' };
    let k: Komut;
    try { k = yukleyiciKomutu(); } catch (e) { return { tamam: false, hata: (e as Error).message }; }
    try {
      const p = spawn(k.exe, k.onArgs, { detached: true, stdio: 'ignore', windowsHide: k.test && process.env.FUBER_CLAUDE_GIZLI === '1', env: temelOrtam() });
      p.on('error', (e) => this.gunluk(`yükleyici açılamadı: ${e.message}`));
      p.unref();
    } catch (e) { return { tamam: false, hata: (e as Error).message }; }
    this.gunluk(`Claude Code resmi yükleyicisi görünür pencerede açıldı (${k.test ? 'sahte' : CC_YUKLEYICI_KOMUTU})`);
    this.yukleyiciAcik = true;
    this.izle();
    this.yay();
    return { tamam: true };
  }
  private yukleyiciBulundu(): void {
    if (this.izleyici) { clearInterval(this.izleyici); this.izleyici = null; }
    if (!this.yukleyiciAcik) return;
    this.yukleyiciAcik = false;
    this.authOnbellek = null;
    this.gunluk('Claude Code bulundu (kurulum tamamlandı)');
    this.yay();
  }
  private izle(): void {
    if (this.izleyici) return;
    const bas = Date.now();
    this.izleyici = setInterval(() => {
      void this.claudeKurulu().then((var_) => {
        if (var_) {
          this.yukleyiciBulundu();
          if (this.kayit.ogeler.some((o) => o.hal === 'bekliyor' || o.hal === 'sirada')) void this.isle();
        } else if (Date.now() - bas > this.z.izleme) {
          if (this.izleyici) clearInterval(this.izleyici);
          this.izleyici = null;
          this.yukleyiciAcik = false;
          this.yay();
        }
      });
    }, this.s.izlemeAraligiMs ?? 3000);
    this.izleyici.unref?.();
  }

  /** Uygulama açılışı: yarıda kalan / bekleyen paket kaldığı yerden sürer (Claude Code varsa). */
  surdur(): void {
    if (this.etkin && this.kayit.ogeler.some((o) => o.hal === 'sirada' || o.hal === 'bekliyor')) void this.isle();
  }
  /**
   * Uygulama kapanırken (eklenti-yonetim.ts → app 'will-quit'): izleyici durur, süren kurulum komutları (claude / uv / graphify) süreç
   * ağaçlarıyla durdurulur — yetim süreç kalmaz. Yarıda kalan öğe diskte "sırada" kalır (kuruluyor hiç yazılmaz): sonraki açılışta sürer.
   */
  kapat(): void {
    this.kapandi = true;
    if (this.izleyici) { clearInterval(this.izleyici); this.izleyici = null; }
    const pidler = calisanSurecler();
    if (pidler.length) this.gunluk(`uygulama kapanıyor: süren ${pidler.length} kurulum komutu durduruldu (${pidler.join(', ')})`);
    calisanlariDurdur();
  }

  // ── Paket ──
  /**
   * Sihirbazın "Devam"ı / Eklentiler'in "Seçilenleri kur"u: seçim kuyruğa yazılır, kurulum ARKA PLANDA başlar (çağıran beklemez). Boş seçim
   * yalnız adımı "görüldü" işaretler. Seçimden çıkarılan, henüz kurulmamış öğe kuyruktan düşer (kurulu olan dokunulmadan kalır).
   */
  paketBaslat(secim: unknown): PaketDurumu {
    if (!this.etkin) { this.gunluk('paket isteği Business mode’da yok sayıldı'); return this.paketDurumu(); }
    // Seçim yok (null / dizi değil: sihirbaz seçimi daha yüklenmeden gönderildi) = DEĞİŞİKLİK YOK — kuyruk silinmez, adım işaretlenmez.
    if (!Array.isArray(secim)) { this.gunluk('paket isteği seçimsiz geldi; kuyruk olduğu gibi'); return this.paketDurumu(); }
    const l = secimiSuz(secim);
    this.kayit.adimGoruldu = true;
    this.kayit.ogeler = this.kayit.ogeler.filter((o) => l.includes(o.id) || tamamMi(o.hal));
    for (const id of l) {
      const o = this.oge(id);
      if (o && (o.hal === 'kuruluyor' || o.hal === 'onay')) continue; // sürüyor / onayın bekleniyor
      if (o) { o.hal = 'sirada'; delete o.ileti; delete o.asama; delete o.onay; } else this.kayit.ogeler.push({ id, hal: 'sirada' });
    }
    this.kaydet();
    this.gunluk(`paket başlatıldı: ${l.join(', ') || '(boş seçim — yalnız adım görüldü)'}`);
    if (l.length) { this.bildirilecek = true; void this.isle(); }
    this.yay();
    return this.paketDurumu();
  }

  /**
   * Teklif kartının "Şimdi değil"i: adım YALNIZ "görüldü" işaretlenir (açılışta yeniden sorulmaz); kuyruk OLDUĞU GİBİ kalır — bitmemiş
   * (sırada / Claude Code bekleyen / onay bekleyen) öğe düşmez, kurulum başlamaz.
   */
  adimGorulduIsaretle(): PaketDurumu {
    if (!this.etkin) { this.gunluk('"Şimdi değil" Business mode’da yok sayıldı'); return this.paketDurumu(); }
    if (!this.kayit.adimGoruldu) { this.kayit.adimGoruldu = true; this.kaydet(); this.gunluk('adım görüldü ("Şimdi değil"; kuyruk değişmedi)'); this.yay(); }
    return this.paketDurumu();
  }

  /** Kuyruğu işler (tek döngü; çalışırken gelen yeni seçimi aynı döngü alır). */
  private async isle(): Promise<void> {
    if (this.calisiyor) { this.yeniden = true; return; }
    if (!this.etkin) return; // İş modunda kuyruk bekler (Geliştirici'ye dönünce sürer)
    this.calisiyor = true;
    this.yay();
    let yapildi = false;
    let claudeYok = false;
    try {
      do {
        this.yeniden = false;
        const sira = () => this.kayit.ogeler.filter((o) => o.hal === 'sirada' || o.hal === 'bekliyor');
        if (!sira().length || this.kapandi) break;
        if (!(await this.claudeKurulu())) {
          for (const o of sira()) this.hal(o.id, 'bekliyor', 'Claude Code kurulunca kurarım.');
          claudeYok = true;
          break;
        }
        for (const o of sira()) if (o.hal === 'bekliyor') this.hal(o.id, 'sirada');
        const kurulu = await this.kuruluKimlikler();
        for (const o of sira().filter((x) => paketOgesi(x.id)?.tur === 'katalog')) {
          if (this.kapandi) break;
          await this.sirala(() => this.katalogOgesiKur(o.id, kurulu));
          yapildi = true;
        }
        if (!this.kapandi && sira().some((x) => x.id === 'graphify')) { await this.sirala(() => this.graphifyKur()); yapildi = true; }
      } while (this.yeniden && !this.kapandi);
    } catch (e) {
      this.gunluk(`paket döngüsü hatası: ${(e as Error).message}`);
    } finally {
      this.calisiyor = false;
      this.kaydet();
      this.onbellegiSil();
      this.yay();
      if (this.bildirilecek && (yapildi || claudeYok)) { this.bildirilecek = false; this.sonucBildir(claudeYok); }
    }
  }

  private sonucBildir(claudeYok: boolean): void {
    if (!this.s.bildir || !this.etkin || this.kapandi) return;
    const bildir = (b: string, m: string) => { this.gunluk(`bildirim: ${b} — ${m}`); this.s.bildir?.(b, m); };
    if (claudeYok) { bildir('Geliştirici araçları bekliyor', 'Claude Code kurulunca seçtiğin araçları kendiliğinden kurarım.'); return; }
    const o = this.kayit.ogeler;
    const tamam = o.filter((x) => tamamMi(x.hal)).length, onay = o.filter((x) => x.hal === 'onay').length, hata = o.filter((x) => x.hal === 'hata').length;
    const parca = [`${tamam} araç hazır`, onay ? `${onay} araç onayını bekliyor` : '', hata ? `${hata} araç kurulamadı` : ''].filter(Boolean).join(', ');
    bildir(onay ? 'Geliştirici araçları: onay bekliyor' : hata ? 'Geliştirici araçları kuruldu (eksikle)' : 'Geliştirici araçların hazır',
      `${parca}. Yeni Claude Code oturumlarında etkin; ayrıntı Claude Code → Eklentiler’de.`);
  }

  private async kuruluKimlikler(): Promise<Set<string> | null> {
    const c = await this.claude(['plugin', 'list', '--json'], this.z.liste);
    const l = eklentiListesiCoz(c.stdout);
    return l ? new Set(l.map((e) => e.id)) : null;
  }

  /** Resmi katalog tanımlı değilse ekler (bir kez; başarısızsa katalog eklentileri düşer, Graphify sürer). */
  private async katalogHazirla(): Promise<boolean> {
    if (this.katalogHazir) return true;
    const l = await this.claude(['plugin', 'marketplace', 'list', '--json'], this.z.liste);
    if (katalogTanimliMi(l.stdout)) { this.katalogHazir = true; return true; }
    const r = await this.claude(['plugin', 'marketplace', 'add', CC_KATALOG_DEPOSU, '--scope', 'user'], this.z.katalog);
    if (!r.zamanAsimi && r.kod === 0) { this.katalogHazir = true; return true; }
    this.katalogHatasi = `Resmi katalog (${CC_KATALOG}) eklenemedi.${r.zamanAsimi ? ' Zaman aşımı.' : ilkSatir(r.stderr || r.stdout)}`;
    return false;
  }

  private async katalogOgesiKur(id: string, kurulu: Set<string> | null): Promise<void> {
    const oge = paketOgesi(id);
    if (!oge) return;
    const pid = eklentiKimligi(oge);
    if (kurulu?.has(pid)) { this.hal(id, 'kurulu', 'Zaten kuruluydu; atlandı.'); return; }
    this.hal(id, 'kuruluyor', undefined, 'Kuruluyor…');
    if (!(await this.katalogHazirla())) { this.hal(id, 'hata', this.katalogHatasi); return; }
    const r = kurulumSonucuCoz(await this.claude(['plugin', 'install', pid, '-s', 'user', '--json'], this.z.kurulum), pid);
    this.sonucuYaz(id, r);
  }

  private sonucuYaz(id: string, r: KurulumSonucu, onaylanan?: string): void {
    if (r.tur === 'tamam') this.hal(id, 'kuruldu', r.ileti ?? 'Kuruldu.');
    else if (r.tur === 'onay' && r.onay.sha256 !== onaylanan) this.hal(id, 'onay', onaylanan ? 'Kurulum komutu değişti; yeniden onayın gerekiyor.' : 'Kurulurken bilgisayarında bir komut çalıştıracak; onayın gerekiyor.', undefined, r.onay);
    else if (r.tur === 'onay') this.hal(id, 'hata', `Onayladığın komut çalıştı ama kurulum tamamlanmadı.${r.ileti ? ` ${r.ileti}` : ''}`);
    else this.hal(id, 'hata', r.ileti);
  }

  // ── Graphify ──
  private uvKaynagi(): UvKaynagi {
    if (this.s.uvKaynagi) return this.s.uvKaynagi;
    if (process.env.FUBER_DEMO && process.env.FUBER_TEST_UV_URL && process.env.FUBER_TEST_UV_SHA256) return { url: process.env.FUBER_TEST_UV_URL, sha256: process.env.FUBER_TEST_UV_SHA256.toLowerCase() };
    return UV_ARSIVI;
  }
  get uvDizini() { return path.join(this.s.araclarDizini, 'uv', UV_SURUMU); }
  private uvOrtami(): NodeJS.ProcessEnv {
    const a = this.s.araclarDizini;
    return {
      ...temelOrtam(), UV_TOOL_DIR: path.join(a, 'uv-araclar'), UV_PYTHON_INSTALL_DIR: path.join(a, 'uv-python'), UV_CACHE_DIR: path.join(a, 'uv-onbellek'),
      UV_NO_PROGRESS: '1', NO_COLOR: '1',
    };
  }

  /**
   * Sabit uv: yoksa indirilir; SHA-256 tutmazsa AÇILMAZ (arşiv silinir, açık hata). Açılmış ve işaretli uv yeniden kullanılır. Düzeltme
   * turu 1: indirme `boyut`u (UV_ARSIVI: 15.264.056 bayt) aşınca KESİLİR; arşiv diskten BİR KEZ belleğe okunur, o tamponun özeti alınır ve
   * AYNI tampon açılır (doğrulama ile açma arasında dosya değiştirilemez).
   */
  async uvHazirla(ilerleme?: Ilerleme): Promise<string> {
    const kaynak = this.uvKaynagi();
    const k = this.uvDizini;
    const exe = path.join(k, 'uv.exe');
    const isaret = path.join(k, '.dogrulandi');
    try { if (fs.existsSync(exe) && fs.readFileSync(isaret, 'utf8').trim() === kaynak.sha256) return exe; } catch { /* yeniden kur */ }
    if (testOrtami() && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(kaynak.url)) throw new Error('TEST GÜVENLİĞİ: testte/önizlemede uv yalnız yerel sahte sunucudan iner (ağ yok).');
    const azami = kaynak.boyut ?? UV_ARSIVI.boyut;
    const ind = path.join(this.s.araclarDizini, 'indirme');
    fs.mkdirSync(ind, { recursive: true });
    const zip = path.join(ind, `uv-${UV_SURUMU}.zip`);
    const temizle = () => { for (const f of [zip, `${zip}.dogrulandi`, `${zip}.indiriliyor`]) fs.rmSync(f, { force: true }); };
    const dogrulanamadi = 'uv indirmesi doğrulanamadı: SHA-256 özeti tutmadı; hiçbir şey açılmadı.';
    temizle();
    this.gunluk(`uv ${UV_SURUMU} indiriliyor: ${kaynak.url}`);
    try {
      await (this.s.indirici ?? ((u, h, s, i, a) => indir(u, h, s, i, AbortSignal.timeout(this.z.indirme), undefined, a)))(kaynak.url, zip, kaynak.sha256, ilerleme, azami);
    } catch (e) {
      temizle();
      const m = (e as Error).message;
      throw new Error(/SHA-256/i.test(m) ? dogrulanamadi : /beklenenden büyük/.test(m) ? `uv indirmesi durduruldu: ${iletiTemizle(m, 200)}; hiçbir şey açılmadı.` : `uv indirilemedi: ${iletiTemizle(m, 200)}`);
    }
    let tampon: Buffer;
    try { tampon = fs.readFileSync(zip); } finally { temizle(); }
    if (tampon.length > azami) throw new Error(`uv indirmesi durduruldu: arşiv beklenenden büyük (${tampon.length} > ${azami} bayt); hiçbir şey açılmadı.`);
    if (createHash('sha256').update(tampon).digest('hex') !== kaynak.sha256) throw new Error(dogrulanamadi);
    fs.rmSync(k, { recursive: true, force: true });
    let yazilan: string[];
    try { yazilan = zipTamponuCikar(tampon, k, UV_DOSYALARI); } catch (e) { fs.rmSync(k, { recursive: true, force: true }); throw e; }
    if (!yazilan.includes('uv.exe')) { fs.rmSync(k, { recursive: true, force: true }); throw new Error('uv arşivinde uv.exe yok.'); }
    fs.writeFileSync(isaret, kaynak.sha256);
    this.gunluk(`uv ${UV_SURUMU} doğrulandı ve açıldı (${yazilan.join(', ')})`);
    return exe;
  }

  private async uvCalistir(uv: string, args: string[], ms: number): Promise<Calisma> {
    if (this.kapandi) return this.kapaniyor();
    try { fs.mkdirSync(this.s.araclarDizini, { recursive: true }); } catch { /* yazılamıyorsa komut kendi hatasını verir */ }
    const c = await calistir(uvKomutu(uv), args, { zamanAsimiMs: ms, env: this.uvOrtami(), cwd: this.s.araclarDizini });
    this.gunluk(`uv ${args.join(' ')} → ${c.zamanAsimi ? 'zaman aşımı' : `çıkış ${c.kod ?? '?'}`}${c.kod ? ilkSatir(c.stderr || c.stdout) : ''}`);
    return c;
  }
  private async uvBinDizini(uv: string): Promise<string | null> {
    const c = await this.uvCalistir(uv, ['tool', 'dir', '--bin'], this.z.kisa);
    const s = c.stdout.trim().split(/\r?\n/).pop()?.trim();
    return c.kod === 0 && s ? s : null;
  }

  private get platform(): NodeJS.Platform { return this.s.platform ?? process.platform; }

  private async graphifyKur(): Promise<void> {
    const id = 'graphify';
    const onarim = this.graphifySorunlu();
    if (graphifyBecerisiVar(this.s.claudeDizini()) && !onarim) { this.hal(id, 'kurulu', 'Graphify becerisi zaten kurulu; atlandı.'); return; }
    if (onarim) this.gunluk('Graphify’ın kancası var ama graphify bulunamıyor: yeniden kuruluyor (onarım, uv tool install --force)');
    // Yalnız Windows: sabit uv arşivi Windows'un, `graphify install --platform windows` Windows'un. macOS/Linux'ta elle (kartta yazar).
    if (this.platform !== 'win32') { this.hal(id, 'hata', GRAPHIFY_YALNIZ_WINDOWS); return; }
    try {
      this.hal(id, 'kuruluyor', undefined, 'uv hazırlanıyor…');
      const uv = await this.uvHazirla((g, t) => this.asama(id, `uv iniyor · %${t ? Math.min(100, Math.round((g / t) * 100)) : 0}`));
      this.asama(id, 'Graphify kuruluyor…');
      fs.mkdirSync(this.s.araclarDizini, { recursive: true });
      // Onarım (kanca var, graphify yok / ortamı silinmiş): `--force`. uv'nin belgelenen davranışı: başka bir ortamın (ya da artık var
      // olmayan ortamın) kısayolu komut klasöründe duruyorsa `uv tool install` "Executable already exists … (use --force to overwrite)"
      // diye REDDEDER; ortam yerinde ve istek karşılanıyorsa "already installed" der ve kısayola dokunmaz. `--force` ikisinde de kısayolu
      // yeniden yazar; ortam yoksa zaten sıfırdan kurulur. `--reinstall` (bütün paketleri PyPI'dan yeniden indirir) gerekmez: bozulan
      // kısayol/ortam bağı, paketlerin kendisi değil. İlk kurulum `--force`suz: kullanıcının kendi graphify.exe'si ezilmez.
      const kur = await this.uvCalistir(uv, onarim ? ['tool', 'install', '--force', GRAPHIFY_GEREKSINIMI] : ['tool', 'install', GRAPHIFY_GEREKSINIMI], this.z.uv);
      if (kur.zamanAsimi) throw new Error('Graphify kurulumu zaman aşımına uğradı.');
      if (kur.kod !== 0) throw new Error(`Graphify kurulamadı (uv).${ilkSatir(kur.stderr || kur.stdout)}`);
      const bin = await this.uvBinDizini(uv);
      // Komut klasörü okunamadıysa PATH'teki bir `graphify`ye düşülmez (başka bir program olabilir).
      if (!bin) throw new Error('Graphify kuruldu ama uv’nin komut klasörü okunamadı; Claude Code’a eklenmedi.');
      this.asama(id, 'Claude Code becerisi ekleniyor…');
      if (this.kapandi) throw new Error('Uygulama kapanıyor.');
      const g = await calistir(graphifyKomutu(bin), ['install', '--platform', 'windows'], { zamanAsimiMs: this.z.katalog, env: yolaEkle(this.uvOrtami(), bin), cwd: os.homedir() });
      this.gunluk(`graphify install --platform windows → ${g.zamanAsimi ? 'zaman aşımı' : `çıkış ${g.kod ?? '?'}`}${g.kod ? ilkSatir(g.stderr || g.stdout) : ''}`);
      if (g.zamanAsimi || g.kod !== 0) throw new Error(`Graphify Claude Code’a eklenemedi.${g.zamanAsimi ? ' Zaman aşımı.' : ilkSatir(g.stderr || g.stdout || g.hata || '')}`);
      this.hal(id, 'kuruldu', 'Graphify ve Claude Code becerisi kuruldu.');
    } catch (e) {
      this.hal(id, 'hata', iletiTemizle((e as Error).message, 300));
    }
  }

  /**
   * Graphify'ı kaldırır: `graphify claude uninstall` (settings.json'daki kanca + beceri; Graphify'ın kendi komutu) → `uv tool uninstall
   * graphifyy`. graphify yalnız uv'nin komut klasöründen çalıştırılır; uv (uygulama veri klasöründe) yoksa ya da klasör okunamıyorsa
   * HİÇBİR ŞEY çalıştırılmaz (PATH'teki bir `graphify`ye düşülmez) ve elle temizliğin yolu söylenir.
   */
  private async graphifyKaldir(): Promise<IslemSonucu> {
    const uv = path.join(this.uvDizini, 'uv.exe');
    const uvVar = fs.existsSync(uv) || Boolean(process.env.FUBER_UV_KOMUT);
    const bin = uvVar ? await this.uvBinDizini(uv).catch(() => null) : null;
    if (!bin) {
      this.gunluk(`graphify kaldırılamadı: ${uvVar ? 'uv’nin komut klasörü okunamadı' : 'uygulama veri klasöründeki uv yok'}; hiçbir komut çalıştırılmadı`);
      return { tamam: false, hata: `${uvVar ? 'Graphify’ın komutu bulunamadı' : 'Fuber’in uv’si silinmiş'}; kaldırma komutu çalıştırılmadı. ${GRAPHIFY_ELLE_TEMIZLIK}` };
    }
    let g: Calisma;
    try { g = await calistir(graphifyKomutu(bin), ['claude', 'uninstall'], { zamanAsimiMs: this.z.kisa, env: yolaEkle(this.uvOrtami(), bin), cwd: os.homedir() }); }
    catch (e) { return { tamam: false, hata: `${(e as Error).message} ${GRAPHIFY_ELLE_TEMIZLIK}` }; }
    this.gunluk(`graphify claude uninstall → ${g.zamanAsimi ? 'zaman aşımı' : `çıkış ${g.kod ?? '?'}`}`);
    if (g.zamanAsimi || g.kod !== 0) return { tamam: false, hata: `Graphify Claude Code’dan kaldırılamadı.${ilkSatir(g.stderr || g.stdout || g.hata || '')}` };
    await this.uvCalistir(uv, ['tool', 'uninstall', GRAPHIFY_PAKETI], this.z.kisa).catch(() => undefined);
    this.kayit.ogeler = this.kayit.ogeler.filter((o) => o.id !== 'graphify');
    this.kaydet();
    this.yay();
    return { tamam: true, ileti: 'Graphify kaldırıldı.' };
  }

  // ── Tekil işlemler (Eklentiler sekmesi) ──
  /** Paketteki bir öğeyi yeniden dener ya da katalogdan TEK eklenti kurar (`ad@katalog`). */
  async ogeKur(id: unknown): Promise<IslemSonucu> {
    if (!this.etkin) return { tamam: false, hata: IS_MODU };
    const k = String(id ?? '');
    if (paketOgesi(k)) {
      const o = this.oge(k);
      if (o && (o.hal === 'kuruluyor' || o.hal === 'onay')) return { tamam: true };
      if (o) { o.hal = 'sirada'; delete o.ileti; delete o.onay; } else this.kayit.ogeler.push({ id: k, hal: 'sirada' });
      this.kaydet();
      void this.isle();
      this.yay();
      return { tamam: true };
    }
    if (!ID_RE.test(k) || !k.includes('@')) return { tamam: false, hata: 'Geçersiz eklenti kimliği.' };
    if (!(await this.claudeKurulu())) return { tamam: false, hata: 'Claude Code kurulu değil.' };
    return this.sirala(async () => {
      const [ad, katalog] = k.split('@');
      if (katalog === CC_KATALOG && !(await this.katalogHazirla())) return { tamam: false, hata: this.katalogHatasi };
      const r = kurulumSonucuCoz(await this.claude(['plugin', 'install', `${ad}@${katalog}`, '-s', 'user', '--json'], this.z.kurulum), k);
      this.onbellegiSil();
      if (r.tur === 'onay') { this.tekilOnay.set(k, { islem: 'install', onay: r.onay }); return { tamam: false, onay: r.onay, ileti: 'Kurulurken bilgisayarında bir komut çalıştıracak; onayın gerekiyor.' }; }
      return r.tur === 'tamam' ? { tamam: true, ileti: r.ileti ?? 'Kuruldu.' } : { tamam: false, hata: r.ileti };
    });
  }

  /** Kurulum komutu onayı: kabul → `--accept-command <sha256>` (yalnız gösterilen komutun özeti); ret → kurulmaz. Asla `-y`. */
  async onay(id: unknown, sha256: unknown, kabul: unknown): Promise<IslemSonucu> {
    if (!this.etkin) return { tamam: false, hata: IS_MODU };
    const k = String(id ?? '');
    const sha = String(sha256 ?? '').toLowerCase();
    const paketteki = this.oge(k);
    const bekleyen: { islem: 'install' | 'update'; onay: KomutOnayi; kapsam?: string } | undefined = paketteki?.hal === 'onay' && paketteki.onay ? { islem: 'install', onay: paketteki.onay } : this.tekilOnay.get(k);
    if (!bekleyen) return { tamam: false, hata: 'Onay bekleyen bir kurulum yok.' };
    if (kabul !== true) {
      this.gunluk(`${k}: kurulum komutu REDDEDİLDİ (sha256 ${bekleyen.onay.sha256.slice(0, 12)}…)`);
      if (paketteki) this.hal(k, 'reddedildi', 'Kurulmadı: kurulum komutunu onaylamadın.'); else this.tekilOnay.delete(k);
      return { tamam: true };
    }
    if (sha !== bekleyen.onay.sha256) return { tamam: false, hata: 'Onayladığın komut gösterilenle aynı değil; yeniden göster.' };
    this.gunluk(`${k}: kurulum komutu ONAYLANDI (sha256 ${sha.slice(0, 12)}…)`);
    const pid = paketteki ? eklentiKimligi({ id: k }) : k;
    if (!ID_RE.test(pid)) return { tamam: false, hata: 'Geçersiz eklenti kimliği.' };
    // Onaylanan komut bu eklentinin olmalı (ayrıştırıcı da denetler; saklı kayda karşı ikinci kat).
    if (bekleyen.onay.pluginId !== pid) return { tamam: false, hata: 'Onay bekleyen komut başka bir eklentiye ait; kurulmadı.' };
    return this.sirala(async () => {
      if (paketteki) this.hal(k, 'kuruluyor', undefined, 'Onaylanan komutla kuruluyor…');
      // Güncelleme özgün kapsamında (`-s`) kalır: kullanıcı kapsamında onaylanan güncelleme proje kapsamındaki kopyaya uygulanmaz ya da tersi.
      const args = bekleyen.islem === 'update' ? ['plugin', 'update', pid, ...(bekleyen.kapsam ? ['-s', bekleyen.kapsam] : []), '--accept-command', sha, '--json'] : ['plugin', 'install', pid, '-s', 'user', '--accept-command', sha, '--json'];
      const r = kurulumSonucuCoz(await this.claude(args, this.z.kurulum), pid);
      this.onbellegiSil();
      if (paketteki) { this.sonucuYaz(k, r, sha); const o = this.oge(k); return o?.hal === 'onay' ? { tamam: false, onay: o.onay, ileti: o.ileti } : { tamam: tamamMi(o?.hal), ...(o?.hal === 'hata' ? { hata: o.ileti } : {}) }; }
      this.tekilOnay.delete(k);
      if (r.tur === 'onay' && r.onay.sha256 !== sha) { this.tekilOnay.set(k, { islem: bekleyen.islem, onay: r.onay, ...(bekleyen.kapsam ? { kapsam: bekleyen.kapsam } : {}) }); return { tamam: false, onay: r.onay, ileti: 'Kurulum komutu değişti; yeniden onayın gerekiyor.' }; }
      if (r.tur === 'tamam') return { tamam: true, ileti: r.ileti ?? 'Kuruldu.' };
      return { tamam: false, hata: r.tur === 'hata' ? r.ileti : 'Onayladığın komut çalıştı ama kurulum tamamlanmadı.' };
    });
  }

  /** Aç / kapat / kaldır / güncelle (eklenti), kaldır (MCP sunucusu, beceri, Graphify). */
  async islem(o: { tur?: unknown; id?: unknown; islem?: unknown; kapsam?: unknown }): Promise<IslemSonucu> {
    if (!this.etkin) return { tamam: false, hata: IS_MODU };
    const tur = String(o?.tur ?? ''), id = String(o?.id ?? ''), islem = String(o?.islem ?? '') as Islem;
    const kapsam = typeof o?.kapsam === 'string' && KAPSAM.has(o.kapsam) ? o.kapsam : undefined;
    if (tur === 'graphify') return islem === 'kaldir' ? this.sirala(() => this.graphifyKaldir()) : { tamam: false, hata: 'Desteklenmeyen işlem.' };
    if (tur === 'beceri') return islem === 'kaldir' ? this.beceriKaldir(id) : { tamam: false, hata: 'Desteklenmeyen işlem.' };
    if (!(await this.claudeKurulu())) return { tamam: false, hata: 'Claude Code kurulu değil.' };
    if (tur === 'mcp') {
      if (islem !== 'kaldir') return { tamam: false, hata: 'Desteklenmeyen işlem.' };
      if (!MCP_RE.test(id) || /^plugin:/i.test(id) || /^claude\.ai\b/i.test(id)) return { tamam: false, hata: 'Bu sunucu buradan kaldırılamaz (eklentiyle ya da claude.ai’den gelir).' };
      return this.sirala(async () => {
        const c = await this.claude(['mcp', 'remove', id, ...(kapsam ? ['-s', kapsam] : [])], this.z.kisa);
        this.onbellek.delete('mcp');
        return !c.zamanAsimi && c.kod === 0 ? { tamam: true, ileti: `${id} kaldırıldı.` } : { tamam: false, hata: `Kaldırılamadı.${c.zamanAsimi ? ' Zaman aşımı.' : ilkSatir(c.stderr || c.stdout || c.hata || '')}` };
      });
    }
    if (tur !== 'eklenti' || !ID_RE.test(id)) return { tamam: false, hata: 'Geçersiz eklenti kimliği.' };
    const args = islem === 'ac' ? ['plugin', 'enable', id, ...(kapsam ? ['-s', kapsam] : []), '--json']
      : islem === 'kapat' ? ['plugin', 'disable', id, ...(kapsam ? ['-s', kapsam] : []), '--json']
        : islem === 'kaldir' ? ['plugin', 'uninstall', id, '-s', kapsam ?? 'user', '--json']
          : islem === 'guncelle' ? ['plugin', 'update', id, ...(kapsam ? ['-s', kapsam] : []), '--json'] : null;
    if (!args) return { tamam: false, hata: 'Desteklenmeyen işlem.' };
    return this.sirala(async () => {
      const r = kurulumSonucuCoz(await this.claude(args, islem === 'guncelle' ? this.z.kurulum : this.z.kisa), id);
      this.onbellegiSil();
      if (r.tur === 'onay') { this.tekilOnay.set(id, { islem: 'update', onay: r.onay, ...(kapsam ? { kapsam } : {}) }); return { tamam: false, onay: r.onay, ileti: 'Güncelleme bilgisayarında bir komut çalıştıracak; onayın gerekiyor.' }; }
      if (r.tur === 'hata') return { tamam: false, hata: r.ileti };
      if (islem === 'kaldir') {
        const [ad, katalog] = id.split('@');
        if (katalog === CC_KATALOG && paketOgesi(ad)) { this.kayit.ogeler = this.kayit.ogeler.filter((x) => x.id !== ad); this.kaydet(); this.yay(); }
      }
      return { tamam: true, ileti: r.ileti };
    });
  }

  /** Kullanıcı becerisini Geri Dönüşüm Kutusu'na taşır (yalnız ~/.claude/skills'in doğrudan alt klasörü; Graphify'ınki Graphify'la kalkar). */
  private async beceriKaldir(ad: string): Promise<IslemSonucu> {
    if (!ad || ad === '.' || ad === '..' || /[\\/:*?"<>|\0]/.test(ad) || ad.length > 120) return { tamam: false, hata: 'Geçersiz beceri adı.' };
    if (graphifyAdi(ad)) return this.sirala(() => this.graphifyKaldir());
    const kok = path.join(this.s.claudeDizini(), 'skills');
    const yol = path.join(kok, ad);
    try {
      const gercek = fs.realpathSync.native(yol), kokGercek = fs.realpathSync.native(kok);
      if (path.dirname(gercek).toLowerCase() !== kokGercek.toLowerCase() || !fs.statSync(gercek).isDirectory()) return { tamam: false, hata: 'Beceri klasörü bulunamadı.' };
    } catch { return { tamam: false, hata: 'Beceri klasörü bulunamadı.' }; }
    if (!this.s.cop) return { tamam: false, hata: 'Geri Dönüşüm Kutusu kullanılamıyor.' };
    try { await this.s.cop(yol); } catch (e) { return { tamam: false, hata: `Taşınamadı: ${iletiTemizle((e as Error).message, 200)}` }; }
    this.gunluk(`beceri Geri Dönüşüm Kutusu'na taşındı: ${ad}`);
    this.onbellek.delete('beceri');
    return { tamam: true, ileti: `${ad} Geri Dönüşüm Kutusu’na taşındı.` };
  }

  // ── Listeler (Eklentiler sekmesi) ──
  async liste(tur: unknown, tazele = false): Promise<ListeSonucu<unknown>> {
    const t = String(tur) as ListeTuru;
    if (!['eklenti', 'beceri', 'mcp', 'katalog'].includes(t)) return { liste: null, hata: 'Bilinmeyen liste.', zaman: Date.now() };
    const o = this.onbellek.get(t);
    if (o && !tazele && Date.now() - o.zaman < 20_000) return o;
    let sonuc: ListeSonucu<unknown>;
    if (t === 'beceri') sonuc = { liste: becerileriOku(this.s.claudeDizini()), zaman: Date.now() };
    else if (!(await this.claudeKurulu())) sonuc = { liste: null, hata: 'Claude Code kurulu değil.', zaman: Date.now() };
    else if (t === 'eklenti') {
      const c = await this.claude(['plugin', 'list', '--json'], this.z.liste);
      const l = eklentiListesiCoz(c.stdout)?.map((e) => (e.yol ? { ...e, yol: evKisalt(e.yol) } : e));
      sonuc = l ? { liste: l, zaman: Date.now() } : { liste: null, hata: `Eklenti listesi okunamadı.${c.zamanAsimi ? ' Zaman aşımı.' : ilkSatir(c.stderr || c.hata || '')}`, zaman: Date.now() };
    } else if (t === 'mcp') {
      const c = await this.claude(['mcp', 'list'], this.z.mcp);
      sonuc = c.kod === 0 || c.stdout.trim() ? { liste: mcpListesiCoz(c.stdout), zaman: Date.now() } : { liste: null, hata: `MCP listesi okunamadı.${c.zamanAsimi ? ' Zaman aşımı.' : ilkSatir(c.stderr || c.hata || '')}`, zaman: Date.now() };
    } else {
      sonuc = await this.sirala(async () => {
        // Resmi kataloğu ekleme (`marketplace add`, Claude Code'a YAZAR) yalnız Geliştirici'de; İş modunda liste yalnız okunur.
        if (this.etkin) await this.katalogHazirla();
        const c = await this.claude(['plugin', 'list', '--available', '--json'], this.z.liste);
        const l = katalogListesiCoz(c.stdout);
        return l ? { liste: l, zaman: Date.now() } : { liste: null, hata: `Katalog okunamadı.${c.zamanAsimi ? ' Zaman aşımı.' : ilkSatir(c.stderr || c.hata || '')}`, zaman: Date.now() };
      });
    }
    this.onbellek.set(t, sonuc);
    return sonuc;
  }
}

/** Test yardımcısı: paketin bütün kimlikleri (sırayla). */
export const paketKimlikleri = () => GELISTIRICI_PAKETI.map((o) => o.id);
