// ── Claude Code'u terminalde açmak: --resume <oturum> --dangerously-skip-permissions "<komut>" ───────────────────
// "Bu projede şunu yap" denince terminal o klasörde tam yetkiyle (izin sormadan) açılır ve komut ona olduğu gibi
// verilir. Fuber bunu kendi modeliyle yapmaz, yalnız komutu iletir; istenen sohbet /resume ile bulunup açılır,
// kendiliğinden iş yapılmaz. → Fuber kod yazmaz; Claude Code'u (kullanıcının aboneliği) doğru
// klasörde, doğru oturumla, komut OLDUĞU GİBİ verilerek görünür bir pencerede başlatır.
// Güvenlik: kabuk YOK — claude.exe argüman dizisiyle başlatılır (komut metnindeki tırnak/; işaretleri kabuğa
// ulaşmaz). Windows Terminal kipinde wt'nin ';' ayıracı kaçışlanır. Tam yetki (--dangerously-skip-permissions)
// Ayarlar → Claude Code'dan kapatılabilir.
// Test: FUBER_CLAUDE_KOMUT='["node","sahte-claude.mjs"]' gerçek claude yerine; FUBER_CLAUDE_GIZLI=1 pencere açmaz. Görev 27: bu eski yol
// artık isteğe bağlı; varsayılan uygulama içi oturumdur (oturum-yoneticisi.ts). Testte/önizlemede sahte verilmemişse gerçek claude açılmaz
// (yurutucu.ts ccKomutu kapısı). İki çağıran, iki kural (son dalga B, Ruling CI):
//  • Claude Code sayfasının "Terminalde sürdür"ü (Denetci.tsx → claudecode:ac, terminal: true): kullanıcının MASADAKİ kendi eylemi; telefondan
//    ya da sohbetten erişilemez (claudecode:ac telefonda terminal yolunu yok sayar). Ayarlar → Claude Code → Tam yetki açıksa kullanıcının
//    istediği gibi --dangerously-skip-permissions ile açılır (`tamYetki` verilmez → ayardaki değer).
//  • Sohbetin claude_code_gorev aracı (Ayarlar'da "Terminalde" yolu seçiliyse; gorev.ts): `tamYetki: false` — sohbetten (istem enjeksiyonu
//    olabilir) açılan terminal ASLA izinsiz kipte açılmaz; Claude Code terminalde kendisi sorar.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { ayarlar } from '../ayarlar.js';
import { claudeYolu, testOrtami } from './yurutucu.js';

export { claudeYolu };

export interface Acilis { komutSatiri: string; pencere: 'konsol' | 'wt' | 'test' }

/** Görünür bir terminalde Claude Code başlatır. oturum verilirse --resume ile o sohbet devam eder. */
export function terminaldeAc(o: { cwd: string; oturum?: string; komut?: string; tamYetki?: boolean; baslik?: string }): Acilis {
  if (!fs.existsSync(o.cwd) || !fs.statSync(o.cwd).isDirectory()) throw new Error(`Klasör bulunamadı: ${o.cwd}`);
  const a = ayarlar().claudeCode;
  const tam = o.tamYetki ?? a.tamYetki;
  const arg = [...(o.oturum ? ['--resume', o.oturum] : []), ...(tam ? ['--dangerously-skip-permissions'] : []), ...(o.komut?.trim() ? [o.komut.trim()] : [])];
  const gorunur = arg.map((x) => (/[\s"]/.test(x) ? `"${x.replace(/"/g, '\\"')}"` : x)).join(' ');
  if (process.env.FUBER_CLAUDE_KOMUT) {
    const [exe, ...on] = JSON.parse(process.env.FUBER_CLAUDE_KOMUT) as string[];
    const p = spawn(exe, [...on, ...arg], { cwd: o.cwd, detached: true, stdio: 'ignore', windowsHide: process.env.FUBER_CLAUDE_GIZLI === '1' });
    p.unref();
    return { komutSatiri: `claude ${gorunur}`, pencere: 'test' };
  }
  if (testOrtami()) throw new Error('TEST GÜVENLİĞİ: gerçek claude.exe testte/önizlemede açılamaz — FUBER_CLAUDE_KOMUT ver.');
  const exe = claudeYolu();
  if (!exe) throw new Error('Claude Code (claude.exe) bulunamadı. Kurulum: https://claude.com/claude-code');
  if (a.terminal === 'wt') {
    // wt kendi argümanlarında ';' ile yeni sekme ayırır: kaçışla.
    const wtArg = ['-w', 'new', '--title', o.baslik ?? 'Fuber → Claude Code', '-d', o.cwd, exe, ...arg.map((x) => x.replace(/;/g, '\\;'))];
    const p = spawn('wt.exe', wtArg, { detached: true, stdio: 'ignore', windowsHide: false });
    p.unref();
    return { komutSatiri: `claude ${gorunur}`, pencere: 'wt' };
  }
  // Konsol: Windows'ta detached çocuk süreç kendi konsol penceresini alır (varsayılan terminal neyse onda açılır).
  const p = spawn(exe, arg, { cwd: o.cwd, detached: true, stdio: 'ignore', windowsHide: false });
  p.unref();
  return { komutSatiri: `claude ${gorunur}`, pencere: 'konsol' };
}
