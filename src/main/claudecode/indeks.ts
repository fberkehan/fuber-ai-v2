// ── Claude Code oturum indeksi (~/.claude/projects/<klasör>/<oturum>.jsonl) ───────────────────────────────────
// Hiç terminal açık olmasa bile Claude Code geçmişi görünmeli; /resume içinde doğru sohbeti bulmak zordu.
// → Her oturumun başlığı (Claude Code'un ai-title'ı), çalışma klasörü, dalı, tarihleri ve kullanıcı
// istemleri çıkarılır; Türkçe sadeleştirilmiş kelimelerle aranır. Dosyalar çok büyük olabilir (tek oturum 1 GB):
// satır satır okunur, araç çıktıları ve asistan satırları JSON'a hiç çevrilmeden atlanır; bir sonraki taramada
// yalnız dosyanın SONUNA eklenen kısım okunur (bayt konumu saklanır). Salt okunur: Claude Code dosyalarına yazılmaz.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { harnesBildirimleri } from '../../shared/cc-olay.ts';

export interface CcOturum {
  id: string;
  dosya: string;
  cwd: string;
  proje: string;
  baslik: string;
  dal?: string;
  ilk?: string; // ilk kullanıcı istemi (kısaltılmış)
  son?: string; // son kullanıcı istemi
  istemler: string[]; // arama için (her biri kısaltılmış; en çok 60)
  istemSayisi: number;
  baslangic?: string;
  sonZaman?: string;
  boyut: number;
  okunan: number; // bayt konumu (sonraki tarama buradan devam eder)
}

export const claudeDizini = () => process.env.FUBER_CLAUDE_DIZIN || path.join(os.homedir(), '.claude');

const kisalt = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const TUR = /"type":"(user|ai-title|custom-title|summary|agent-name)"/;
const ISTEM_SINIRI = 60;

/** Kullanıcı satırından gerçek istem metni (araç sonucu, meta, komut çıktısı, sistem hatırlatması değil). */
function istemMetni(j: Record<string, unknown>): string | null {
  if (j.isMeta || j.isSidechain || j.isCompactSummary || j.isVisibleInTranscriptOnly) return null;
  const m = j.message as { role?: string; content?: unknown } | undefined;
  if (!m || m.role !== 'user') return null;
  let t = '';
  if (typeof m.content === 'string') t = m.content;
  else if (Array.isArray(m.content)) t = m.content.filter((p: { type?: string }) => p?.type === 'text').map((p: { text?: string }) => p.text ?? '').join('\n');
  if (harnesBildirimleri(t)) return null; // 5 Kas: arka plan işi bildirimi vb. kullanıcının istemi değil (başlık/aramaya girmez)
  t = t.replace(/<(system-reminder|local-command-stdout|local-command-stderr|command-message|command-args|bash-stdout|bash-stderr)>[\s\S]*?<\/\1>/g, '').trim();
  const komut = /<command-name>([\s\S]*?)<\/command-name>/.exec(t);
  if (komut) t = komut[1].trim();
  if (!t || /^Caveat: The messages below/i.test(t) || /^\[Request interrupted/i.test(t)) return null;
  return t.replace(/\s+/g, ' ');
}

async function dosyaOku(o: CcOturum): Promise<void> {
  const boyut = fs.statSync(o.dosya).size;
  if (boyut < o.okunan) { o.okunan = 0; o.istemler = []; o.istemSayisi = 0; o.ilk = undefined; } // dosya küçüldü: baştan
  if (boyut === o.okunan) return;
  const akis = fs.createReadStream(o.dosya, { start: o.okunan, encoding: 'utf8' });
  const rl = readline.createInterface({ input: akis, crlfDelay: Infinity });
  let okunan = o.okunan;
  for await (const satir of rl) {
    okunan += Buffer.byteLength(satir, 'utf8') + 1;
    // Ucuz ön eleme: yalnız kullanıcı istemleri ve başlık kayıtları JSON'a çevrilir (asistan/araç satırları atlanır).
    if (satir.length > 200_000 || satir.includes('"tool_result"')) continue;
    const tur = TUR.exec(satir.slice(0, 800))?.[1] ?? TUR.exec(satir)?.[1];
    if (!tur) continue;
    let j: Record<string, unknown>;
    try { j = JSON.parse(satir) as Record<string, unknown>; } catch { continue; }
    if (j.type !== tur) continue;
    if (tur === 'ai-title' && typeof j.aiTitle === 'string') { if (!o.baslik || o.baslik === o.ilk) o.baslik = kisalt(j.aiTitle, 120); continue; }
    if ((tur === 'custom-title' || tur === 'agent-name') && typeof (j.customTitle ?? j.agentName ?? j.title) === 'string') { o.baslik = kisalt(String(j.customTitle ?? j.agentName ?? j.title), 120); continue; }
    if (tur === 'summary' && typeof j.summary === 'string' && !o.baslik) { o.baslik = kisalt(j.summary, 120); continue; }
    if (tur !== 'user') continue;
    if (!o.cwd && typeof j.cwd === 'string') { o.cwd = j.cwd; o.proje = path.basename(j.cwd); }
    if (typeof j.gitBranch === 'string' && j.gitBranch) o.dal = j.gitBranch;
    if (typeof j.timestamp === 'string') { o.baslangic ??= j.timestamp; o.sonZaman = j.timestamp; }
    const t = istemMetni(j);
    if (!t) continue;
    o.istemSayisi++;
    o.ilk ??= kisalt(t, 220);
    o.son = kisalt(t, 220);
    o.istemler.push(kisalt(t, 400));
    if (o.istemler.length > ISTEM_SINIRI) o.istemler.splice(10, 1); // ilk 10'u ve en yenileri tut
  }
  o.okunan = okunan;
  o.boyut = boyut;
  if (!o.baslik) o.baslik = o.ilk ?? '(boş oturum)';
}

let onbellek: Map<string, CcOturum> | null = null;
let onbellekDosyasi = '';
let taraniyor: Promise<CcOturum[]> | null = null;

/** Önbellek dosyası (uygulama veri klasöründe) — main.ts verir. */
export function ccOnbellekYolu(y: string): void { onbellekDosyasi = y; }

function yukle(): Map<string, CcOturum> {
  if (onbellek) return onbellek;
  onbellek = new Map();
  try {
    for (const o of JSON.parse(fs.readFileSync(onbellekDosyasi, 'utf8')) as CcOturum[]) onbellek.set(o.dosya, o);
  } catch { /* ilk tarama */ }
  return onbellek;
}

/** Bütün oturumları tarar (değişen dosyalar artımlı); en yeni başta. */
export function ccTara(): Promise<CcOturum[]> {
  taraniyor ??= (async () => {
    const harita = yukle();
    const kok = path.join(claudeDizini(), 'projects');
    const gorulen = new Set<string>();
    if (fs.existsSync(kok)) {
      for (const k of fs.readdirSync(kok, { withFileTypes: true })) {
        if (!k.isDirectory() || k.name.startsWith('.')) continue;
        for (const d of fs.readdirSync(path.join(kok, k.name), { withFileTypes: true })) {
          if (!d.isFile() || !d.name.endsWith('.jsonl')) continue;
          const dosya = path.join(kok, k.name, d.name);
          gorulen.add(dosya);
          let o = harita.get(dosya);
          if (!o) { o = { id: d.name.replace(/\.jsonl$/, ''), dosya, cwd: '', proje: k.name, baslik: '', istemler: [], istemSayisi: 0, boyut: 0, okunan: 0 }; harita.set(dosya, o); }
          try { await dosyaOku(o); } catch { /* okunamayan dosya: atla */ }
        }
      }
    }
    for (const d of [...harita.keys()]) if (!gorulen.has(d)) harita.delete(d); // silinmiş oturumlar
    if (onbellekDosyasi) { try { fs.writeFileSync(onbellekDosyasi, JSON.stringify([...harita.values()])); } catch { /* önbellek en iyi çaba */ } }
    return ccListe();
  })().finally(() => { taraniyor = null; });
  return taraniyor;
}

export function ccListe(): CcOturum[] {
  return [...yukle().values()].filter((o) => o.istemSayisi > 0).sort((a, b) => (b.sonZaman ?? '').localeCompare(a.sonZaman ?? ''));
}

export function ccBul(id: string): CcOturum | undefined {
  return ccListe().find((o) => o.id === id || o.id.startsWith(id));
}
