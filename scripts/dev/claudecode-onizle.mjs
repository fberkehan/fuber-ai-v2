// Görev 28 (K17): Claude Code çalışma alanının görsel + davranış denetimi — GERÇEK uygulama (Electron) + GERÇEK Agent SDK + SAHTE Claude
// Code (scripts/dev/sahte-claude.mjs; #vitrin, #izinfark, #akis, #uzun senaryoları). Gerçek claude.exe, ağ, gerçek ~/.claude ve gerçek
// anahtar YOK: geçici FUBER_VERI / ev / FUBER_CLAUDE_DIZIN, FUBER_DEMO=1, FUBER_SIR_* silinir, FUBER_TEST_TAM_EKRAN='0'. Gerçek
// fare/klavye yok (Playwright sayfa içi olaylar); kullanıcının masaüstü yakalanmaz (yalnız uygulamanın kendi sayfası).
// Sahneler × (Koyu, Açık, Buzlu cam) × (1080×680, 1440×900):
//   boş durum · uzun döküm (her araç kartı) · bekleyen izin (Edit farkı; Bash) · AskUserQuestion · çok oturum (Çalışıyor / İzin bekliyor /
//   Bitti / Hata) · komut paleti · "@" önerisi · denetçi + git farkı · Projeler + CLAUDE.md düzenleyici · Ayarlar · hata durumu.
// Her görüntüde ölçülür: yazı ≥ 12 px, kontrast yazı ≥ 4,5 / simge ≥ 3, düğme ≥ 32 px, sayfa kaymaz (yalnız izinli kutular kayar),
// etkileşimli öğeler üst üste binmez, boş kutu yok. Ayrıca: akış sırasında kare süresi, 5 000 olaylık oturumda sanallaştırma, klavye
// (Ctrl+N, Ctrl+K, Esc, Enter/Shift+Enter, "/" ve "@"), izin kartında "İzin ver" kendiliğinden odak almaz ve sekmeyle gezilir, Tam yetki
// kırmızı rozeti ve "yeniden açılmalı" şeridi, ada/tost bildiriminden oturuma gitme, azaltılmış hareket, eski terminal yolu, geçmişten
// sürdürme, "@" sorgusunun gecikmeli gitmesi, konsol hatası yok, kapanışta sahte süreç kalmaz. Sonda temas sayfaları.
// Düzeltme turu 1: bekleyen izin kendi araç kartında bir kez (Türkçe cümle, "Göster" hapı), durdurunca 0 izin kartı, taslakta "/" süreç
// açmaz, A akarken B değişmez, kapanmış oturumun dökümü bırakılır, denetçi "Bu oturumda" + sabit 2×2 eylemler, cam çekmece pikselleri.
// Çalıştır: npm run build && node scripts/dev/claudecode-onizle.mjs [çıktı-klasörü]
import { KURULUM_SURUMU } from '../../src/shared/kurulum-adimlari.ts';
import { _electron as electron } from 'playwright-core';
import electronYolu from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { OLC } from './okunurluk.mjs';
import { renkOku, kontrastOrani, ustune, BEYAZ } from './kontrast.mjs';

const kok = path.resolve(import.meta.dirname, '../..');
if (!fs.existsSync(path.join(kok, 'dist', 'main', 'main.js'))) { console.error('dist yok: önce npm run build'); process.exit(1); }
const cikti = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'fuber-claudecode-onizle'));
fs.mkdirSync(cikti, { recursive: true });
for (const f of fs.readdirSync(cikti)) if (f.endsWith('.png')) fs.rmSync(path.join(cikti, f));
const sonuclar = [];
const kontrol = (ad, tamam, ayrinti = '') => { sonuclar.push({ ad, tamam: Boolean(tamam) }); console.log(`${tamam ? '✅' : '❌'} ${ad}${ayrinti ? ` — ${String(ayrinti).slice(0, 700)}` : ''}`); };
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Geçici ortam ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-cc-arayuz-'));
const veri = path.join(tmp, 'veri');
const ev = path.join(tmp, 'ev');
const claudeDiz = path.join(tmp, '.claude');
const kodKok = path.join(tmp, 'kod');
const PROJELER = { mavi: path.join(kodKok, 'mavi-kus'), yesil: path.join(kodKok, 'yesil-elma'), site: path.join(kodKok, 'fuber-site') };
for (const d of [veri, ev, path.join(veri, 'belgeler'), ...Object.values(PROJELER)]) fs.mkdirSync(d, { recursive: true });
const kayit = path.join(tmp, 'sahte-claude.jsonl');
const pidDosyasi = path.join(tmp, 'pid.txt');
const dosya = (p, icerik) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, icerik); };
// mavi-kus: git deposu (denetçi farkı), CLAUDE.md'li; "@" için kalabalık src/
const M = PROJELER.mavi;
dosya(path.join(M, 'src', 'giris.css'), '.giris {\n  display: grid;\n  grid-template-columns: 1fr 1fr;\n  gap: 24px;\n  width: 1200px;\n}\n\n.giris__kart {\n  padding: 32px;\n  border-radius: 22px;\n}\n');
dosya(path.join(M, 'src', 'odeme.ts'), 'export function toplam(sepet) {\n  return sepet.reduce((t, u) => t + u.fiyat, 0);\n}\n');
dosya(path.join(M, 'src', 'eski', 'kayit.css'), '.kayit { width: 1200px; margin: 0 auto; }\n');
dosya(path.join(M, 'src', 'eski', 'sifre.css'), '.sifre { width: 1200px; }\n');
dosya(path.join(M, 'src', 'giris.tsx'), 'export function Giris() { return null; }\n');
for (let i = 0; i < 30; i++) dosya(path.join(M, 'src', `modul-${i % 6}`, `bilesen-${i}.tsx`), `export const B${i} = ${i};\n`);
dosya(path.join(M, 'README.md'), '# Mavi Kuş\n\nGiriş ve ödeme ekranları.\n');
dosya(path.join(M, 'package.json'), '{ "name": "mavi-kus", "version": "1.4.0" }\n');
dosya(path.join(M, 'CLAUDE.md'), '# Mavi Kuş\n\n## Kurallar\n- Türkçe yaz.\n- Testleri çalıştırmadan bitti deme.\n\n## Komutlar\n- `npm test`\n');
dosya(path.join(M, '.gitignore'), 'node_modules/\ndist/\n');
// Son dalga B (I1): yeni klonlanmış depo — kendi .claude/settings.json'u (kancalar, izin kuralları, ortam), komutu ve .mcp.json'u var
// (geçmişi YOK: proje sayıları değişmez; klasör seçiciyle açılır). Kancalar ve MCP sahte Claude Code'da çalışmaz.
const KLON = path.join(kodKok, 'klon-depo');
dosya(path.join(KLON, '.claude', 'settings.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node kur.js' }] }], PreToolUse: [] }, permissions: { allow: ['Bash(*)', 'Edit'] }, env: { NODE_OPTIONS: '--x' } }, null, 1));
dosya(path.join(KLON, '.claude', 'commands', 'dagit.md'), '# Dağıt\n');
dosya(path.join(KLON, '.mcp.json'), JSON.stringify({ mcpServers: { github: { command: 'npx', args: ['x'] }, veritabani: { command: 'node', args: ['db.js'] } } }, null, 1));
dosya(path.join(KLON, 'README.md'), '# Klon depo\n');
dosya(path.join(PROJELER.yesil, 'index.html'), '<!doctype html><title>Yeşil Elma</title>\n');
dosya(path.join(PROJELER.site, 'astro.config.mjs'), 'export default {};\n');
const gitOrtam = { ...process.env, HOME: ev, USERPROFILE: ev, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
const git = (...a) => execFileSync('git', ['-C', M, '-c', 'user.email=onizleme@ornek.test', '-c', 'user.name=Önizleme', '-c', 'core.autocrlf=false', ...a], { env: gitOrtam, stdio: 'pipe' });
let gitVar = true;
try {
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'ilk');
  // Claude Code'un yaptığı düzenlemeler diskte (sahte Edit dosyaya dokunmaz): denetçinin `git diff`i bunları gösterir.
  dosya(path.join(M, 'src', 'giris.css'), '.giris {\n  display: grid;\n  grid-template-columns: 1fr 1fr;\n  gap: clamp(16px, 2vw, 24px);\n  width: 100%;\n  max-width: 1200px;\n}\n\n.giris__kart {\n  padding: 32px;\n  border-radius: 22px;\n}\n');
  dosya(path.join(M, 'src', 'giris.test.ts'), "import { test } from 'node:test';\n\ntest('giriş ekranı dar pencerede taşmaz', () => {});\n");
} catch (e) { gitVar = false; console.log('ℹ️  git yok: denetçi farkı git\'siz yoldan sınanır', String(e.message).slice(0, 120)); }

// Claude Code geçmişi (JSONL): üç proje, yedi oturum; biri gerçekçi döküm
const kodla = (p) => p.replace(/[:\\/ ]/g, '-');
const simdi = Date.now();
let sayac = 0;
const gecmisYaz = (proje, kimlik, baslik, dakikaOnce, istemler, ek = []) => {
  const k = path.join(claudeDiz, 'projects', kodla(proje));
  fs.mkdirSync(k, { recursive: true });
  const t0 = simdi - dakikaOnce * 60_000;
  const satirlar = [];
  istemler.forEach((ist, i) => {
    satirlar.push({ type: 'user', cwd: proje, gitBranch: 'main', sessionId: kimlik, uuid: `u${++sayac}`, timestamp: new Date(t0 + i * 60_000).toISOString(), message: { role: 'user', content: ist } });
    satirlar.push({ type: 'assistant', sessionId: kimlik, uuid: `a${++sayac}`, timestamp: new Date(t0 + i * 60_000 + 5000).toISOString(), message: { id: `m${sayac}`, role: 'assistant', content: [{ type: 'text', text: `Tamam: ${ist.slice(0, 60)}. Önce ilgili dosyalara bakıyorum.` }] } });
  });
  satirlar.push(...ek.map((s) => ({ sessionId: kimlik, timestamp: new Date(t0 + 30_000).toISOString(), ...s })));
  satirlar.push({ type: 'ai-title', sessionId: kimlik, aiTitle: baslik });
  const d = path.join(k, `${kimlik}.jsonl`);
  fs.writeFileSync(d, satirlar.map((s) => JSON.stringify(s)).join('\n') + '\n');
  fs.utimesSync(d, (simdi - dakikaOnce * 60_000) / 1000, (simdi - dakikaOnce * 60_000) / 1000);
};
const GECMIS_KIMLIK = 'bbbb2222-0000-4000-8000-000000000001';
gecmisYaz(M, GECMIS_KIMLIK, 'Ödeme toplamı yuvarlama hatası', 180, ['Ödeme toplamında kuruş hatası var, düzelt', 'Testleri de ekle'], [
  { type: 'assistant', uuid: 'ax1', message: { id: 'mx1', role: 'assistant', content: [{ type: 'text', text: 'Hesap `reduce` içinde adetle çarpılmıyor.' }, { type: 'tool_use', id: 'tx1', name: 'Read', input: { file_path: path.join(M, 'src', 'odeme.ts') } }] } },
  { type: 'user', uuid: 'rx1', cwd: M, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tx1', content: '     1→export function toplam(sepet) {\n     2→  return sepet.reduce((t, u) => t + u.fiyat, 0);\n     3→}' }] } },
  { type: 'assistant', uuid: 'ax2', message: { id: 'mx2', role: 'assistant', content: [{ type: 'tool_use', id: 'tx2', name: 'Edit', input: { file_path: path.join(M, 'src', 'odeme.ts'), old_string: '  return sepet.reduce((t, u) => t + u.fiyat, 0);', new_string: '  return Math.round(sepet.reduce((t, u) => t + u.fiyat * u.adet, 0) * 100) / 100;' } }] } },
  { type: 'user', uuid: 'rx2', cwd: M, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tx2', content: 'The file was updated.' }] } },
]);
gecmisYaz(M, 'bbbb2222-0000-4000-8000-000000000002', 'README güncellemesi', 60 * 26, ['README’yi güncel duruma getir']);
gecmisYaz(M, 'bbbb2222-0000-4000-8000-000000000003', 'Giriş ekranı erişilebilirlik denetimi', 60 * 50, ['Giriş ekranında kontrastı denetle']);
gecmisYaz(PROJELER.yesil, 'bbbb2222-0000-4000-8000-000000000004', 'Açılış sayfası animasyonu', 60 * 8, ['Hero bölümüne hafif bir giriş animasyonu ekle']);
gecmisYaz(PROJELER.yesil, 'bbbb2222-0000-4000-8000-000000000005', 'Form doğrulaması', 60 * 72, ['İletişim formuna doğrulama ekle']);
gecmisYaz(PROJELER.site, 'bbbb2222-0000-4000-8000-000000000006', 'Fiyat sayfası dört dil', 60 * 30, ['Fiyat sayfasını dört dile çevir']);
gecmisYaz(PROJELER.site, 'bbbb2222-0000-4000-8000-000000000007', 'Blog RSS akışı', 60 * 24 * 6, ['Blog için RSS akışı ekle']);

fs.writeFileSync(path.join(veri, 'ayarlar.json'), JSON.stringify({
  // Kurulum sürümü güncel (Görev 29: 3) — yoksa Geliştirici profili açılışta "Geliştirici araçları" yükseltme sihirbazına düşerdi.
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: '0.9.0', kullaniciAdi: 'Deniz', hitap: 'Deniz', baslangictaAc: false, mod: 'gelistirici',
  ses: { uyandirma: false, seslendirme: false }, proaktif: { etkin: false }, gorunum: { tema: 'koyu', adaSessiz: false },
  claudeCode: { etkin: true, terminal: 'konsol', tamYetki: false, varsayilanMod: 'acceptEdits', yol: 'uygulama' },
}));
const ortam = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('FUBER_SIR_')));
Object.assign(ortam, {
  FUBER_DEMO: '1', FUBER_VERI: veri, FUBER_BELGELER: path.join(veri, 'belgeler'), FUBER_TEST_TAM_EKRAN: '0', USERPROFILE: ev, HOME: ev,
  FUBER_CLAUDE_DIZIN: claudeDiz, FUBER_CLAUDE_GIZLI: '1', FUBER_SAHTE_CLAUDE_KAYIT: kayit, SAHTE_CC_PID_DOSYASI: pidDosyasi,
  FUBER_CLAUDE_KOMUT: JSON.stringify([process.execPath, path.join(kok, 'scripts/dev/sahte-claude.mjs')]), GIT_CONFIG_NOSYSTEM: '1',
});
const kayitlar = () => (fs.existsSync(kayit) ? fs.readFileSync(kayit, 'utf8').trim().split('\n').filter(Boolean).map((s) => JSON.parse(s)) : []);
const pidler = () => (fs.existsSync(pidDosyasi) ? fs.readFileSync(pidDosyasi, 'utf8').trim().split(/\s+/).filter(Boolean).map(Number) : []);
const yasiyor = (p) => { try { process.kill(p, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// ── Sayfa içi ek ölçüm: kayma, binme, boş kutu ──
const EK_OLC = () => {
  const gorunur = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const c = getComputedStyle(el); return c.visibility !== 'hidden' && c.display !== 'none' && c.clipPath !== 'inset(50%)'; };
  const ad = (el) => `${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className ?? '').split(' ')[0]}${el.textContent?.trim() ? ` «${el.textContent.trim().slice(0, 24)}»` : ''}`;
  const o = { sayfa: [], izinsizKayan: [], binen: [], bos: [], tostSeridi: [], baslikAltinda: [] };
  const se = document.scrollingElement;
  if (se.scrollHeight > se.clientHeight + 1 || se.scrollWidth > se.clientWidth + 1) o.sayfa.push(`belge ${se.scrollWidth}×${se.scrollHeight} / ${se.clientWidth}×${se.clientHeight}`);
  for (const s of ['.pano', '.pano__sayfalar', '.cc', '.cc__govde:not(.cc__govde--ayarlar)']) {
    const el = document.querySelector(s);
    if (el && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)) o.sayfa.push(`${s} ${el.scrollWidth}×${el.scrollHeight} / ${el.clientWidth}×${el.clientHeight}`);
  }
  // Kayan kutular yalnız izinli olanlar (döküm, listeler, denetçi, palet, fark, düzenleyici, ayarlar gövdesi…)
  const IZINLI = '.cc-dokum, .cc-sol__liste, .cc-denetci, .cc-denetci__icerik, .cc-izinler, .cc-palet__liste, .cc-fark-sayfa__govde, .cc-bos, .cc-yeni-govde, .cc-guven__icerik, .cc-md-duzen__fark, .cc-md-duzen__alan, .cc__govde--ayarlar, .cc-alanlar dd, textarea, .secici__liste';
  for (const el of document.querySelectorAll('.cc *')) {
    const c = getComputedStyle(el);
    if (/(auto|scroll)/.test(c.overflowY) && el.scrollHeight > el.clientHeight + 1 && !el.matches(IZINLI)) o.izinsizKayan.push(`${ad(el)} [${c.overflowX}/${c.overflowY} ${el.scrollHeight}>${el.clientHeight}]`);
    if (/(auto|scroll)/.test(c.overflowX) && el.scrollWidth > el.clientWidth + 1) o.izinsizKayan.push(`${ad(el)} (yatay ${c.overflowX} ${el.scrollWidth}>${el.clientWidth})`);
  }
  // Binme: görünen (kaydırma kutusuna kırpılmış) etkileşimli öğeler, kendi katmanlarında çift çift.
  const KATMAN = ['.cc-palet', '.secici__panel', '.cc-fark-sayfa', '.cc-denetci--cekmece', '.cc-dokum__sona'];
  const kirp = (el) => {
    let r = el.getBoundingClientRect();
    let x1 = r.left, y1 = r.top, x2 = r.right, y2 = r.bottom;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const c = getComputedStyle(p);
      if (c.overflowX !== 'visible' || c.overflowY !== 'visible') {
        const q = p.getBoundingClientRect();
        x1 = Math.max(x1, q.left); y1 = Math.max(y1, q.top); x2 = Math.min(x2, q.right); y2 = Math.min(y2, q.bottom);
      }
    }
    return x2 - x1 > 1 && y2 - y1 > 1 ? { x1, y1, x2, y2 } : null;
  };
  const ogeler = [...document.querySelectorAll('.cc button, .cc input, .cc textarea, .cc [role="option"], .secici__panel [role="option"]')].filter(gorunur)
    .map((el) => ({ el, k: kirp(el), katman: KATMAN.find((s) => el.closest(s)) ?? 'taban' })).filter((x) => x.k);
  for (let i = 0; i < ogeler.length; i++) {
    for (let j = i + 1; j < ogeler.length; j++) {
      const a = ogeler[i], b = ogeler[j];
      if (a.katman !== b.katman || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.k.x2, b.k.x2) - Math.max(a.k.x1, b.k.x1), h = Math.min(a.k.y2, b.k.y2) - Math.max(a.k.y1, b.k.y1);
      if (w > 1.5 && h > 1.5) o.binen.push(`${ad(a.el)} × ${ad(b.el)} (${Math.round(w)}×${Math.round(h)})`);
    }
  }
  // Pencere düğmelerinin (kendi düğmelerimiz + köşe sürükleme alanı) altında GÖRÜNEN yazı/düğme yok (kaydırma kutusuna kırpılmış hâliyle;
  // okunurluk.mjs'nin ölçümü kırpmayı saymıyor: dökümde yukarı kaymış satırı "altında" sanıyordu).
  const pdD = document.querySelector('.pd-dugmeler')?.getBoundingClientRect();
  const pdS = document.querySelector('.pd-surukle')?.getBoundingClientRect();
  if (pdD) {
    const x0 = pdS ? Math.min(pdD.left, pdS.left) : pdD.left, y1 = pdS ? Math.max(pdD.bottom, pdS.bottom) : pdD.bottom;
    for (const el of document.querySelectorAll('.cc *')) {
      if (!gorunur(el) || !([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || el.tagName === 'BUTTON')) continue;
      const k = kirp(el);
      if (k && k.x2 > x0 + 1 && k.y1 < y1 - 1 && k.y2 > 0) o.baslikAltinda.push(ad(el));
    }
  }
  // Tost katmanı (bilesenler/tostlar.css: pencerede y 52…132, ortada en çok 520 px): orada sayfanın düğmesi/girdisi olmaz.
  const tl = document.querySelector('.tostlar')?.getBoundingClientRect();
  if (tl) for (const x of ogeler) if (x.katman === 'taban' && x.k.x2 > tl.left + 1 && x.k.x1 < tl.right - 1 && x.k.y1 < 132 && x.k.y2 > 52) o.tostSeridi.push(ad(x.el));
  // Ana bölmeler birbirine binmez (çekmece ve fark sayfası bilerek üstte)
  const bolmeler = [...document.querySelectorAll('.cc__bas, .cc-sol, .cc-orta, .cc-denetci:not(.cc-denetci--cekmece)')].filter(gorunur);
  for (let i = 0; i < bolmeler.length; i++) for (let j = i + 1; j < bolmeler.length; j++) {
    const a = bolmeler[i].getBoundingClientRect(), b = bolmeler[j].getBoundingClientRect();
    if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) o.binen.push(`bölme ${ad(bolmeler[i])} × ${ad(bolmeler[j])}`);
  }
  const KUTU = '.cc-sol, .cc-orta, .cc-denetci, .cc-izin-hap, .cc-denetci__alt, .cc-arac, .cc-yapilacak, .cc-kod, .cc-fark, .cc-bilgi-kart, .cc-yeni-kart, .cc-proje-kart, .cc-izin, .cc-ayarlar__kart, .cc-denetci__bolum, .cc-oturum, .cc-satir, .cc-serit, .cc-hata-kart, .cc-palet, .cc-alanlar, .cc-komut, .cc-guven__oge, .cc-guven__secenek';
  for (const el of document.querySelectorAll(KUTU)) if (gorunur(el) && kirp(el) && !el.innerText.trim()) o.bos.push(ad(el));
  return o;
};
/** OLC (okunurluk.mjs) çıktısından sorunlar: yazı < 12 px, düğme < 32 px, kontrast, taşma, pencere düğmelerinin altı. Kesilen tek satır
 *  ("…": uzun yol/komut özeti) bilgi olarak sayılır, hata değil. */
const okunurlukSorunlari = (tema, o) => {
  const s = { kucuk: o.kucuk, kisa: o.kisa, anahtar: o.anahtar.filter((a) => a.alan < 31.5).map((a) => `${a.isim} ${a.alan}`), tasan: [...o.tasan, ...(o.sayfaTasiyor ? ['sayfa yatay'] : [])], baslik: o.baslikAltinda, kontrast: [], enKotu: Infinity };
  const taban = tema === 'cam' ? BEYAZ : renkOku(o.zemin);
  for (const y of o.yazilar) {
    const z = y.katmanlar.reduce((a, k) => ustune(renkOku(k), a), taban);
    const r = kontrastOrani(ustune(renkOku(y.renk), z), z);
    s.enKotu = Math.min(s.enKotu, r);
    if (r < 4.5) s.kontrast.push(`${y.ad} «${y.metin}» ${r.toFixed(2)}:1`);
  }
  for (const y of o.simgeler) {
    const z = y.katmanlar.reduce((a, k) => ustune(renkOku(k), a), taban);
    const r = kontrastOrani(ustune(renkOku(y.renk), z), z);
    if (r < 3) s.kontrast.push(`${y.ad} (simge) ${r.toFixed(2)}:1`);
  }
  return s;
};

const TEMALAR_TUM = ['koyu', 'acik', 'cam'];
const BOYUTLAR = [[1080, 718], [1440, 900]];
const CAM_ARKA = 'linear-gradient(135deg, #46588f 0%, #1a1e2b 48%, #7a4a6d 100%)';
const TEMA_ADI = { koyu: 'Koyu', acik: 'Açık', cam: 'Buzlu cam' };
const fotolar = []; // { sahne, tema, boyut, dosya }
const bilgi = [];

let u;
const hatalar = [];
try {
  u = await electron.launch({ executablePath: electronYolu, args: [kok], env: ortam, timeout: 60000 });
  let w;
  for (let i = 0; i < 120 && !w; i++) { w = u.windows().find((x) => x.url().includes('index.html')); if (!w) await bekle(250); }
  w.on('pageerror', (e) => hatalar.push(String(e)));
  w.on('console', (m) => { if (m.type() === 'error') hatalar.push(m.text()); });
  const boyut = (en, boy) => u.evaluate(({ BrowserWindow }, [e, b]) => { const x = BrowserWindow.getAllWindows().find((p) => p.webContents.getURL().includes('index.html')); x?.unmaximize(); x?.setContentSize(e, b); }, [en, boy]);
  await boyut(1440, 900);
  await w.waitForSelector('.kokpit', { timeout: 30000 });
  const cagir = (k, ...a) => w.evaluate(([kk, aa]) => window.fuber.cagir(kk, ...aa), [k, a]);
  const { cam: camVar } = await cagir('tema:etkin');
  const TEMALAR = camVar ? TEMALAR_TUM : ['koyu', 'acik'];
  if (!camVar) console.log('ℹ️  buzlu cam bu bilgisayarda yok: cam görüntüleri atlanır');
  let tema = 'koyu';
  const temaYap = async (t) => {
    if (t === tema) return;
    tema = t;
    await cagir('ayarlar:kaydet', { gorunum: { tema: t } });
    await w.evaluate((a) => { document.documentElement.style.background = a ?? ''; }, t === 'cam' ? CAM_ARKA : null);
    await bekle(650);
  };
  const oturumlar = () => cagir('claudecode:oturumlar');
  const ozet = async (id) => (await oturumlar()).find((o) => o.id === id);
  const bekleKosul = async (f, ms = 15000, ad = 'koşul') => {
    const son = Date.now() + ms;
    while (Date.now() < son) { if (await f()) return true; await bekle(100); }
    throw new Error(`zaman aşımı: ${ad}`);
  };
  const yazici = () => w.locator('.cc-yazici textarea');
  const gonder = async (metin) => { await yazici().fill(metin); await yazici().press('Enter'); };
  const seciliId = () => w.evaluate(() => document.querySelector('.cc-oturum[aria-current="true"]')?.getAttribute('data-oturum') ?? null);
  const sonucBekle = async (id, n = 1) => bekleKosul(async () => ((await ozet(id))?.turSayisi ?? 0) >= n && !['calisiyor', 'izin', 'sirada'].includes((await ozet(id))?.durum), 25000, `sonuç ${id}`);
  const modSec = async (ad) => {
    await w.locator('.cc-yazici .cc-secici').first().click();
    await w.locator('.secici__panel [role="option"]', { hasText: ad }).first().click();
    await bekle(300);
  };

  /** Görüntüden önce: imleç sayfanın kenarına (ray ipucu/üstüne gelme izi kalmasın), geçici tostlar kapanır. */
  const temizle = async (en, boy) => {
    await w.mouse.move(en - 3, boy - 3);
    for (let i = 0; i < 12; i++) { const k = w.locator('.tostlar .tost__kapat').first(); if (!(await k.count())) break; await k.click().catch(() => undefined); await bekle(80); }
    await w.mouse.move(en - 3, boy - 3);
  };
  /** Bir sahne: üç tema × iki boyut görüntü + her birinde ölçüm. `hazirla` her boyut değişiminden sonra (çekmece aç vb.). */
  const sahne = async (ad, baslik, hazirla) => {
    const sorun = { kucuk: [], kisa: [], kontrast: [], tasan: [], baslik: [], sayfa: [], izinsizKayan: [], binen: [], bos: [], tostSeridi: [] };
    let enKotu = Infinity;
    for (const t of TEMALAR) {
      await temaYap(t);
      for (const [en, boy] of BOYUTLAR) {
        await boyut(en, boy);
        await bekle(450);
        if (hazirla) await hazirla(en);
        await temizle(en, boy);
        await bekle(250);
        const etiket = `${TEMA_ADI[t]} ${en}×${boy}`;
        const o = await w.evaluate(OLC, '.cc');
        const ek = await w.evaluate(EK_OLC);
        const s = okunurlukSorunlari(t, o);
        enKotu = Math.min(enKotu, s.enKotu);
        for (const k of ['kucuk', 'kisa', 'kontrast', 'tasan']) sorun[k].push(...s[k].map((x) => `[${etiket}] ${x}`));
        sorun.baslik.push(...ek.baslikAltinda.map((x) => `[${etiket}] ${x}`));
        sorun.kisa.push(...s.anahtar.map((x) => `[${etiket}] anahtar ${x}`));
        for (const k of ['sayfa', 'izinsizKayan', 'binen', 'bos', 'tostSeridi']) sorun[k].push(...ek[k].map((x) => `[${etiket}] ${x}`));
        if (o.kesik.length) bilgi.push(`${ad} ${etiket}: kısaltılan tek satır ${o.kesik.length}`);
        const d = path.join(cikti, `${ad}-${t}-${en}x${boy}.png`);
        await w.screenshot({ path: d });
        fotolar.push({ sahne: ad, baslik, tema: t, boyut: `${en}×${boy}`, dosya: d });
      }
    }
    const tekil = (l) => [...new Set(l)];
    kontrol(`${baslik}: yazılar ≥ 12 px`, !sorun.kucuk.length, tekil(sorun.kucuk).join(' | '));
    kontrol(`${baslik}: kontrast yazı ≥ 4,5 · simge ≥ 3`, !sorun.kontrast.length, sorun.kontrast.length ? tekil(sorun.kontrast).join(' | ') : `en düşük yazı ${enKotu.toFixed(2)}:1`);
    kontrol(`${baslik}: düğmeler ≥ 32 px`, !sorun.kisa.length, tekil(sorun.kisa).join(' | '));
    kontrol(`${baslik}: sayfa kaymaz, yalnız izinli kutular kayar, taşma yok`, !sorun.sayfa.length && !sorun.izinsizKayan.length && !sorun.tasan.length && !sorun.baslik.length, tekil([...sorun.sayfa, ...sorun.izinsizKayan, ...sorun.tasan, ...sorun.baslik]).join(' | '));
    kontrol(`${baslik}: üst üste binen öğe yok`, !sorun.binen.length, tekil(sorun.binen).join(' | '));
    kontrol(`${baslik}: boş kutu yok`, !sorun.bos.length, tekil(sorun.bos).join(' | '));
    kontrol(`${baslik}: tost şeridinde (başlığın ortası) düğme/girdi yok`, !sorun.tostSeridi.length, tekil(sorun.tostSeridi).join(' | '));
  };
  const tekFoto = async (ad, baslik, t = 'koyu', [en, boy] = [1440, 900]) => {
    await temaYap(t); await boyut(en, boy); await bekle(400);
    await temizle(en, boy);
    const d = path.join(cikti, `${ad}-${t}-${en}x${boy}.png`);
    await w.screenshot({ path: d });
    fotolar.push({ sahne: ad, baslik, tema: t, boyut: `${en}×${boy}`, dosya: d, ek: true });
  };

  // ════════ 0. Sayfa ════════
  await w.locator('.ray__dgm[data-tur="claude"]').click();
  await w.waitForSelector('.cc', { timeout: 10000 });
  await bekleKosul(() => w.evaluate(() => document.querySelectorAll('.cc-proje-kart').length > 0 && document.querySelectorAll('.cc-oturum--gecmis').length > 0), 20000, 'boş durum dolu');
  const sekmeler = await w.evaluate(() => [...document.querySelectorAll('.cc__sekmeler [role="tab"]')].map((b) => b.textContent.trim()));
  // Görev 29 birleşimi: "Eklentiler" sekmesi bu sekme çubuğunda tek bir giriş (içeriği ve ölçümleri eklentiler-onizle.mjs'te).
  kontrol('Üst sekmeler: Oturumlar · Projeler · Eklentiler · Ayarlar (Eklentiler: Görev 29, tek sekme çubuğu)', JSON.stringify(sekmeler) === '["Oturumlar","Projeler","Eklentiler","Ayarlar"]' && (await w.locator('.cc__sekmeler [role="tab"][data-sekme="eklentiler"]').count()) === 1, JSON.stringify(sekmeler));

  // ════════ 1. Boş durum ════════
  const bos = await w.evaluate(() => ({ proje: document.querySelectorAll('.cc-proje-kart').length, gecmis: document.querySelectorAll('.cc-oturum--gecmis').length, metin: document.querySelector('.cc-orta')?.textContent ?? '' }));
  kontrol('Boş durum dolu ve yararlı: son projeler, yeni oturum, kısayollar, durum; geçmiş projelere göre', bos.proje === 3 && bos.gecmis >= 6 && /Yeni oturum/.test(bos.metin) && /Kısayollar/.test(bos.metin) && /Son projeler/.test(bos.metin), JSON.stringify({ proje: bos.proje, gecmis: bos.gecmis }));
  await sahne('01-bos', 'Boş durum');

  // ════════ 2. Uzun döküm: her araç kartı ════════
  await temaYap('koyu'); await boyut(1440, 900); await bekle(300);
  await w.keyboard.press('Control+N');
  await w.waitForSelector('.cc-yeni-govde');
  kontrol('Ctrl+N: yeni oturum görünümü (sohbet değil)', await w.locator('.ray__dgm[data-tur="claude"][aria-current="page"]').count() === 1 && /Yeni oturum/.test(await w.locator('.cc-oturum-bas h2').innerText()));
  await w.locator('.cc-yeni-kart .cc-secici').click();
  await w.locator('.secici__panel [role="option"]', { hasText: 'mavi-kus' }).first().click();
  await gonder('#vitrin Giriş ekranındaki taşmayı düzelt, testleri çalıştır');
  await w.waitForSelector('.cc-oturum[aria-current="true"][data-hal]');
  const vitrinId = await seciliId();
  await sonucBekle(vitrinId);
  await w.waitForSelector('.cc-sonuc', { timeout: 10000 });
  await bekle(600);
  // 11 Kas ("biten agentlar chatte çok büyük yer kaplıyor"): biten döküm katlı satırlarla başlar — art arda biten araç kartları ve yardımcılar tek satır.
  const katliOnce = await w.evaluate(async () => {
    const d = document.querySelector('.cc-dokum');
    const metinler = new Set(); let suren = 0;
    for (let y = 0; y <= d.scrollHeight; y += 300) {
      d.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }));
      d.scrollTop = y;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      for (const e of d.querySelectorAll('[data-cc-katli] .is-katli__metin')) metinler.add(e.textContent);
      suren += d.querySelectorAll('.cc-arac[data-durum="calisiyor"]').length;
    }
    return { metinler: [...metinler], suren };
  });
  kontrol('11 Kas: biten dökümde art arda biten araç kartları ve yardımcılar katlı satır ("N adım · S sn" / "N yardımcı · …"); süren kart yok',
    katliOnce.metinler.length > 0 && katliOnce.metinler.every((m) => /^\d+ (adım|yardımcı) · /.test(m)) && katliOnce.suren === 0, JSON.stringify(katliOnce));
  await sahne('02k-dokum-katli', 'Biten döküm katlı satırlarla');
  // Bütün dökümü gez (katlı satırlar ve kapalı yardımcılar açılarak): görülen kart türleri
  const gorulen = await w.evaluate(async () => {
    const d = document.querySelector('.cc-dokum');
    const adlar = new Set(); const sinif = new Set();
    const ac = async () => {
      for (let i = 0; i < 6; i++) {
        const kapali = [...d.querySelectorAll('.is-katli__bas[aria-expanded="false"], .cc-ajan > .is-seridi > .cc-arac__bas[aria-expanded="false"]')];
        if (!kapali.length) return;
        for (const b of kapali) b.click();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }
    };
    for (let y = 0; y <= d.scrollHeight; y += 200) {
      d.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }));
      d.scrollTop = y;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await ac();
      for (const e of d.querySelectorAll('.cc-arac__ad')) adlar.add(e.textContent.trim().replace(/general-purpose|Explore|Keşif|Planlama/, '').replace(/^Yardımcı \d+$/, 'Yardımcı').trim());
      for (const s of ['.cc-ajan', '.cc-ajan__cocuklar .cc-arac', '.cc-yapilacak', '.cc-fark__satir[data-tur="ekle"]', '.cc-fark__satir[data-tur="sil"]', '.cc-fark[data-numarali]', '.cc-komut', '.cc-kod--numarali', '.cc-ben', '.cc-yanit pre', '.cc-sonuc', '.cc-yapilacak[data-eski]']) if (d.querySelector(s)) sinif.add(s);
      for (const b of d.querySelectorAll('.cc-katla')) if (/Tamamını göster/.test(b.textContent)) sinif.add('katla');
    }
    d.scrollTop = d.scrollHeight;
    return { adlar: [...adlar], sinif: [...sinif] };
  });
  // Okuma kartı varsayılan kapalı: biri açılınca `cat -n` çıktısı numaralı satırlarla.
  await w.evaluate(() => { const d = document.querySelector('.cc-dokum'); d.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true })); d.scrollTop = 0; });
  await bekle(300);
  await w.locator('.cc-arac[data-tip="okuma"] > .cc-arac__bas').first().click();
  await bekle(300);
  if (await w.locator('.cc-kod--numarali').count()) gorulen.sinif.push('.cc-kod--numarali');
  await w.evaluate(() => { const d = document.querySelector('.cc-dokum'); d.scrollTop = d.scrollHeight; });
  // İş izi (11 Kas): alt ajan kartının başlığı ortak şerit — "Yardımcı N" ("general-purpose" çipi yok).
  const beklenenAdlar = ['Okuma', 'Arama', 'Dosya bulma', 'Düzenleme', 'Yazma', 'Komut', 'Yardımcı', 'Web sayfası', 'MCP · github'];
  kontrol('Uzun döküm: her araç kartı (Read, Grep, Glob, Edit, Write, Bash, Task, WebFetch, MCP)', beklenenAdlar.every((a) => gorulen.adlar.includes(a)), JSON.stringify(gorulen.adlar));
  kontrol('Döküm: iç içe alt ajan, yapılacaklar (önceki + güncel), fark (+/−, satır numaralı), komut, numaralı okuma, Markdown kod, sonuç, "Tamamını göster"',
    ['.cc-ajan', '.cc-ajan__cocuklar .cc-arac', '.cc-yapilacak', '.cc-yapilacak[data-eski]', '.cc-fark__satir[data-tur="ekle"]', '.cc-fark__satir[data-tur="sil"]', '.cc-fark[data-numarali]', '.cc-komut', '.cc-kod--numarali', '.cc-ben', '.cc-yanit pre', '.cc-sonuc', 'katla'].every((s) => gorulen.sinif.includes(s)), JSON.stringify(gorulen.sinif));
  await sahne('02-dokum', 'Uzun döküm (alt)');
  // Ekler: dökümün üstü ve ortası (koyu, geniş)
  await temaYap('koyu'); await boyut(1440, 900); await bekle(300);
  for (const [oran, ad] of [[0, '02a-dokum-ust'], [0.42, '02b-dokum-orta']]) {
    await w.evaluate((x) => { const d = document.querySelector('.cc-dokum'); d.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true })); d.scrollTop = (d.scrollHeight - d.clientHeight) * x; }, oran);
    await bekle(500);
    await tekFoto(ad, oran ? 'Uzun döküm (orta)' : 'Uzun döküm (üst)');
  }
  await w.evaluate(() => { const d = document.querySelector('.cc-dokum'); d.scrollTop = d.scrollHeight; });

  // ════════ 3. İzin: Edit farkı ════════
  await w.keyboard.press('Control+N');
  await w.waitForSelector('.cc-yeni-govde');
  await modSec('Her şeyi sor');
  await gonder('#izinfark Ödeme toplamını adetle hesapla');
  await w.waitForSelector('[data-izin-kart]', { timeout: 15000 });
  const izinId = await seciliId();
  await bekle(500);
  const odak = await w.evaluate(() => ({ aktif: document.activeElement?.textContent?.trim() ?? '', izinVerOdakta: document.activeElement === [...document.querySelectorAll('[data-izin-kart] button')].find((b) => /İzin ver/.test(b.textContent)) }));
  kontrol('İzin kartı: "İzin ver" kendiliğinden odak ALMAZ (kaçan Enter onaylamaz)', !odak.izinVerOdakta, JSON.stringify(odak));
  const farkVar = await w.evaluate(() => ({ ekle: document.querySelectorAll('[data-izin-kart] .cc-fark__satir[data-tur="ekle"]').length, sil: document.querySelectorAll('[data-izin-kart] .cc-fark__satir[data-tur="sil"]').length, yol: document.querySelector('[data-izin-kart] .cc-arac__ozet')?.textContent ?? '' }));
  kontrol('İzin kartı (Edit): dosya yolu + fark önizlemesi', farkVar.ekle >= 3 && farkVar.sil >= 2 && /src\/odeme\.ts/.test(farkVar.yol), JSON.stringify(farkVar));
  // Düzeltme 1: bekleyen fark BİR KEZ (araç kartının içinde); yazma kutusunun üstünde ikinci kopya yok, yerine tek satırlık hap.
  const tek = await w.evaluate(() => ({
    fark: [...document.querySelectorAll('.cc-orta .cc-fark')].filter((f) => /Math\.round\(ara/.test(f.textContent)).length,
    kart: document.querySelectorAll('.cc-orta [data-izin-kart]').length, dok: document.querySelectorAll('.cc-izinler').length,
    kartDokumde: Boolean(document.querySelector('.cc-dokum [data-izin-kart].cc-arac[data-durum="izin"]')), donen: document.querySelectorAll('[data-izin-kart] .donen').length,
    hap: document.querySelector('[data-izin-hap]')?.textContent ?? '', durum: document.querySelector('[data-izin-durum]')?.textContent ?? '',
  }));
  kontrol('Düzeltme 1+2: bekleyen fark bir kez çizilir (araç kartında "İzin gerekiyor", dönen gösterge yok); kart ekrandayken "Göster" hapı yok (ekran okuyucu durumu var)',
    tek.fark === 1 && tek.kart === 1 && tek.dok === 0 && tek.kartDokumde && tek.donen === 0 && tek.hap === '' && /İzin bekleniyor/.test(tek.durum), JSON.stringify(tek));
  const baslik = await w.evaluate(() => {
    const k = document.querySelector('[data-izin-kart]');
    return { cumle: k?.querySelector('[data-izin-cumle]')?.textContent ?? '', ipucu: k?.querySelector('[data-izin-cumle]')?.getAttribute('title') ?? '', ad: k?.querySelector('.cc-arac__ad')?.textContent ?? '', rozet: k?.querySelector('.cc-izin-rozet')?.textContent ?? '' };
  });
  const INGILIZCE = /\b(Edit|MultiEdit|Write|Bash|PowerShell|WebFetch|WebSearch|Read|Skill|SlashCommand|ExitPlanMode|AskUserQuestion)\b/;
  kontrol('Düzeltme 1: izin başlığında İngilizce araç adı yok ("Claude bu dosyayı düzenlemek istiyor"; Claude Code’un başlığı ipucunda)',
    baslik.cumle === 'Claude bu dosyayı düzenlemek istiyor' && !INGILIZCE.test(baslik.cumle + baslik.ad + baslik.rozet) && /Edit/.test(baslik.ipucu), JSON.stringify(baslik));
  // 1080×680'de döküm kullanılabilir yükseklikte kalır (izin dökümü ezmez)
  await boyut(1080, 680); await bekle(500);
  const dokumBoy = await w.evaluate(() => Math.round(document.querySelector('.cc-dokum')?.getBoundingClientRect().height ?? 0));
  await boyut(1440, 900); await bekle(300);
  kontrol('Düzeltme 1: 1080×680’de bekleyen izinle döküm yüksekliği ≥ 300 px', dokumBoy >= 300, `${dokumBoy} px`);
  // Kaçan Enter: yazma kutusunda Enter izni onaylamaz (mesaj kuyruğa girer)
  await yazici().fill('kaçan enter');
  await yazici().press('Enter');
  await bekle(400);
  kontrol('Yazma kutusunda Enter izni onaylamaz; mesaj kuyruğa girer ve görünür', (await w.locator('[data-izin-kart]').count()) === 1 && (await ozet(izinId)).bekleyenIzin === 1 && await w.locator('.cc-kuyruk').count() === 1, await w.locator('.cc-kuyruk').innerText().catch(() => 'kuyruk yok'));
  // Sekmeyle gezinti: Reddet → Neden ekle → Bu oturumda hep izin ver (varsa) → İzin ver
  await w.locator('[data-izin-kart] button', { hasText: 'Reddet' }).focus();
  const sira = [];
  for (let i = 0; i < 3; i++) { await w.keyboard.press('Tab'); sira.push(await w.evaluate(() => document.activeElement?.textContent?.trim() ?? '')); }
  kontrol('İzin kartının düğmeleri klavyeyle sırayla gezilir', sira.includes('İzin ver') && sira[0] === 'Neden ekle', JSON.stringify(sira));
  await yazici().focus();
  await sahne('03-izin-duzenle', 'İzin kartı (Edit farkı)');
  // Tanıtım sayfası (landing/kaynak/varlik.py): FUBER_TANITIM_CC bir PNG yoluysa bu an koyu 1440×900'de bir kez daha çekilir; test
  // kalıntıları (senaryo etiketleri, sahte model/sürüm adı, geçici klasör yolu, "kaçan enter" kuyruğu) yalnız o görüntü için ekrandan
  // kaldırılır, çekimden sonra metinler geri konur. Arayüz gerçek; testlerin gördüğü hiçbir şey değişmez.
  if (process.env.FUBER_TANITIM_CC) {
    await temaYap('koyu'); await boyut(1440, 900); await bekle(500); await temizle(1440, 900); await bekle(250);
    await w.evaluate(([gecici]) => {
      const degis = [[/#(izinfark|vitrin|akis|uzun) /g, ''], [/claude-sahte-varsayilan/g, 'claude-opus-5-5'], [/-sahte\b/g, ''], [gecici, 'C:\\Kullanicilar\\Deniz\\kod']];
      const geri = [];
      const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = tw.nextNode(); n; n = tw.nextNode()) {
        let t = n.nodeValue;
        for (const [a, b] of degis) t = typeof a === 'string' ? t.split(a).join(b) : t.replace(a, b);
        if (t !== n.nodeValue) { geri.push([n, n.nodeValue]); n.nodeValue = t; }
      }
      const kuyruk = document.querySelector('.cc-kuyruk');
      if (kuyruk) { kuyruk.dataset.tanitimGizli = kuyruk.style.display; kuyruk.style.display = 'none'; }
      window.__tanitimGeri = () => { for (const [n, v] of geri) n.nodeValue = v; if (kuyruk) kuyruk.style.display = kuyruk.dataset.tanitimGizli ?? ''; };
    }, [path.join(tmp, 'kod')]);
    await bekle(200);
    await w.screenshot({ path: process.env.FUBER_TANITIM_CC });
    await w.evaluate(() => window.__tanitimGeri?.());
    console.log('ℹ️  tanıtım görüntüsü:', process.env.FUBER_TANITIM_CC);
  }
  await w.locator('[data-izin-kart] button', { hasText: 'İzin ver' }).click();
  await sonucBekle(izinId, 2);
  kontrol('"İzin ver" → araç çalıştı (kartta "izin verildi"), kuyruktaki mesaj tur bitince gitti, kuyruk boşaldı', (await w.locator('.cc-arac__karar', { hasText: 'izin verildi' }).count()) >= 1 && !(await w.locator('[data-izin-kart]').count()) && !(await w.locator('[data-izin-hap]').count()) && await w.locator('.cc-kuyruk').count() === 0 && (await w.locator('.cc-ben__balon', { hasText: 'kaçan enter' }).count()) === 1);

  // ════════ 4. İzin: Bash ════════
  await gonder('#izin Selam yaz');
  await w.waitForSelector('[data-izin-kart] .cc-komut', { timeout: 15000 });
  await bekle(400);
  const bash = await w.evaluate(() => ({ komut: document.querySelector('[data-izin-kart] .cc-komut')?.textContent ?? '', klasor: document.querySelector('[data-izin-kart] .cc-izin__yol')?.textContent ?? '', hep: [...document.querySelectorAll('[data-izin-kart] button')].some((b) => /hep izin ver/.test(b.textContent)), cumle: document.querySelector('[data-izin-kart] [data-izin-cumle]')?.textContent ?? '', ad: document.querySelector('[data-izin-kart] .cc-arac__ad')?.textContent ?? '', komutSayisi: [...document.querySelectorAll('.cc-orta .cc-komut')].filter((k) => /echo merhaba/.test(k.textContent)).length }));
  kontrol('İzin kartı (Bash): komut + klasör + "Bu oturumda hep izin ver"; Türkçe cümle, komut bir kez', /echo merhaba/.test(bash.komut) && /mavi-kus/.test(bash.klasor) && bash.hep && bash.cumle === 'Claude bu komutu çalıştırmak istiyor' && !INGILIZCE.test(bash.cumle + bash.ad) && bash.komutSayisi === 1, JSON.stringify(bash));
  await sahne('04-izin-bash', 'İzin kartı (Bash)');
  await w.locator('[data-izin-kart] button', { hasText: 'Bu oturumda hep izin ver' }).click();
  await sonucBekle(izinId, 3);
  await gonder('#izin yeniden');
  await sonucBekle(izinId, 4);
  kontrol('"Bu oturumda hep izin ver" → aynı istek bu oturumda bir daha sorulmaz', !(await w.locator('[data-izin-kart]').count()) && (await w.locator('.cc-arac__karar', { hasText: 'oturumda hep izinli' }).count()) >= 1);

  // ════════ 5. AskUserQuestion ════════
  await gonder('#soru2 Proje kurulumu');
  await w.waitForSelector('.cc-soru', { timeout: 15000 });
  await bekle(400);
  kontrol('Soru kartı: iki soru, tek seçim radyo, çoklu seçim kutusu, "Diğer"; yanıtlanana dek Yanıtla kapalı',
    (await w.locator('.cc-soru__soru').count()) === 2 && (await w.locator('.cc-soru [role="radio"]').count()) >= 3 && (await w.locator('.cc-soru [role="checkbox"]').count()) >= 4 && await w.locator('.cc-soru [data-yanitla]').isDisabled());
  const soruYeri = await w.evaluate(() => ({ dokumde: document.querySelectorAll('.cc-dokum .cc-soru').length, dok: document.querySelectorAll('.cc-izinler').length, soruKarti: document.querySelectorAll('.cc-dokum .cc-arac[data-tip="soru"]').length, hap: Boolean(document.querySelector('[data-izin-hap], [data-izin-durum]')) }));
  kontrol('Düzeltme 1: AskUserQuestion "Soru" araç kartının YERİNDE seçenek kartı (dökümde bir kez; ayrı kopya yok)', soruYeri.dokumde === 1 && soruYeri.dok === 0 && soruYeri.soruKarti === 0 && soruYeri.hap, JSON.stringify(soruYeri));
  const yalin = await w.evaluate(() => [...document.querySelectorAll('.cc-soru__secenekler[data-yalin] .cc-soru__secenek')].map((b) => Math.round(b.getBoundingClientRect().height)));
  kontrol('Düzeltme 1: açıklamasız seçenekler sıkı (tek satır, ≤ 44 px)', yalin.length > 0 && yalin.every((h) => h >= 32 && h <= 44), JSON.stringify(yalin));
  await w.locator('.cc-soru [role="radio"]', { hasText: 'TypeScript' }).click();
  await sahne('05-soru', 'AskUserQuestion kartı');
  await w.locator('.cc-soru [role="checkbox"]', { hasText: 'Test' }).click();
  await w.locator('.cc-soru [role="checkbox"]', { hasText: 'Belge' }).click();
  await w.locator('.cc-soru [data-yanitla]').click();
  await sonucBekle(izinId, 5);
  const yankı = await w.locator('.cc-yanit', { hasText: 'Yanıtlar' }).last().innerText().catch(() => '');
  kontrol('Soru yanıtı Claude Code’a gitti (updatedInput.answers)', /TypeScript/.test(yankı) && /Test, Belge/.test(yankı), yankı);

  // ════════ 5b. Düzeltme 2 (N1): kapatılmış alt ajanın içinde, gizli adımların arasında bekleyen izin ════════
  await temaYap('koyu'); await boyut(1440, 900); await bekle(300);
  await gonder('#ajanizin:3500 Alt ajanla sunucuyu dene');
  const sonAjan = () => w.evaluate(() => { const a = [...document.querySelectorAll('.cc-ajan')].pop(); return a ? { adim: a.querySelector(':scope > .is-seridi > .cc-arac__bas .cc-arac__sag')?.textContent ?? '', acik: a.querySelector(':scope > .is-seridi > .cc-arac__bas')?.getAttribute('aria-expanded'), onceki: /Önceki \d+ adımı göster/.test(a.textContent), kart: Boolean(a.querySelector('[data-izin-kart]')) } : null; });
  await bekleKosul(async () => /10 adım/.test((await sonAjan())?.adim ?? ''), 12000, 'alt ajanın 10 adımı');
  const ajanOnce = await sonAjan();
  await w.locator('.cc-ajan > .is-seridi > .cc-arac__bas').last().click(); // elle kapatılır (izin henüz sorulmadı)
  await bekle(250);
  const ajanKapali = await sonAjan();
  await bekleKosul(async () => (await ozet(izinId))?.durum === 'izin', 15000, 'alt ajanda izin');
  await bekle(600);
  // Kart ekranda değilse "Göster" hapı çıkar; tıklanınca GERÇEK (iç içe) karta kaydırır
  if (await w.locator('[data-izin-hap] button').count()) { await w.locator('[data-izin-hap] button', { hasText: 'Göster' }).click(); await bekle(700); }
  const ajanIzin = { ...(await sonAjan()), dok: await w.locator('.cc-izinler').count() };
  kontrol('Düzeltme 2 (N1): kapatılmış alt ajanın içindeki (gizli adımların arasında) bekleyen izin görünür — ajan zorla açık, bütün adımlar, kart içeride',
    ajanOnce?.onceki === true && ajanKapali?.acik === 'false' && ajanIzin.acik === 'true' && ajanIzin.kart && !ajanIzin.onceki && ajanIzin.dok === 0, JSON.stringify({ ajanOnce, ajanKapali, ajanIzin }));
  // Zorla açıkken kapatılamaz (başlık aria-disabled: Playwright tıklamaz; sayfa içi tıklama gönderilir)
  await w.evaluate(() => [...document.querySelectorAll('.cc-ajan > .is-seridi > .cc-arac__bas')].pop()?.click());
  await bekle(200);
  const ajanKapanmadi = (await sonAjan())?.acik === 'true';
  await tekFoto('05a-ajan-izin', 'Alt ajanın içinde bekleyen izin');
  // (a) Kart ekrandayken hap yok; başa kayınca hap; "Göster" iç içe kartın kendisine kaydırır ve odaklar
  const kartta = await w.evaluate(() => ({ hap: Boolean(document.querySelector('[data-izin-hap]')), durum: document.querySelector('[data-izin-durum]')?.textContent ?? '' }));
  await w.evaluate(() => { const d = document.querySelector('.cc-dokum'); d.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true })); d.scrollTop = 0; });
  await bekle(500);
  const ustte = await w.locator('[data-izin-hap]').count();
  await w.locator('[data-izin-hap] button', { hasText: 'Göster' }).click();
  await bekle(800);
  const goster = await w.evaluate(() => {
    const k = document.querySelector('.cc-ajan [data-izin-kart]'); const d = document.querySelector('.cc-dokum').getBoundingClientRect(); const r = k?.getBoundingClientRect();
    const oran = r ? Math.max(0, Math.min(r.bottom, d.bottom) - Math.max(r.top, d.top)) / Math.min(r.height, d.height) : 0;
    return { odak: Boolean(k) && document.activeElement === k, oran: Number(oran.toFixed(2)), hap: Boolean(document.querySelector('[data-izin-hap]')), izinVerOdakta: /İzin ver/.test(document.activeElement?.textContent ?? '') && document.activeElement?.tagName === 'BUTTON' };
  });
  kontrol('Düzeltme 2 (a): kart ekrandayken "İzin bekleniyor · Göster" gizli (ekran okuyucu durumu duyurulur); kart dışarıdayken görünür', !kartta.hap && /İzin bekleniyor/.test(kartta.durum) && ustte === 1, JSON.stringify({ kartta, ustte }));
  kontrol('Düzeltme 2 (N1): "Göster" iç içe kartın KENDİSİNE kaydırır ve odaklar (İzin ver’e değil); kart görününce hap gizlenir; zorla açık ajan elle kapanmaz',
    goster.odak && goster.oran >= 0.6 && !goster.hap && !goster.izinVerOdakta && ajanKapanmadi, JSON.stringify({ ...goster, ajanKapanmadi }));
  await w.locator('.cc-ajan [data-izin-kart] button', { hasText: 'İzin ver' }).click();
  await sonucBekle(izinId, 6);
  await bekle(300);
  // İzin kalkınca zorlama biter: kullanıcının kapattığı ajan yeniden kapalı; açınca kartta karar
  const ajanSonra = await sonAjan();
  const kapaliDondu = ajanSonra?.acik === 'false';
  if (kapaliDondu) await w.locator('.cc-ajan > .is-seridi > .cc-arac__bas').last().click();
  await bekle(300);
  // Zorlama kalkınca yine yalnız son 5 adım görünür (Bash 4. adım): önceki adımlar açılır
  const onceki = w.locator('.cc-ajan .cc-katla', { hasText: /Önceki \d+ adımı göster/ }).last();
  if (await onceki.count()) { await onceki.click(); await bekle(300); }
  const kararlar = await w.evaluate(() => [...document.querySelectorAll('.cc-ajan .cc-arac__karar')].map((e) => e.textContent));
  kontrol('Alt ajandaki izin verilince tur biter; zorlama kalkar (elle kapatılan ajan kapalı döner), kartta "izin verildi"', kapaliDondu && (await w.locator('.cc-ajan [data-izin-kart]').count()) === 0 && kararlar.includes('izin verildi'), JSON.stringify({ ajanSonra, kararlar }));

  // ════════ 6. Çok oturum: Çalışıyor / İzin bekliyor / Bitti / Hata ════════
  const yeniBaslat = async (i) => { const r = await cagir('claudecode:baslat', i); if (!r.tamam) throw new Error(`baslat: ${r.hata}`); return r.oturum.id; };
  const bitti = await yeniBaslat({ cwd: PROJELER.site, istem: '#durum Fiyat sayfasının dilini denetle' });
  const hata = await yeniBaslat({ cwd: PROJELER.yesil, istem: '#cok Form doğrulamasını ekle' });
  const izinli = await yeniBaslat({ cwd: PROJELER.yesil, istem: '#izin Geliştirme sunucusunu başlat', mod: 'default' });
  const calisan = await yeniBaslat({ cwd: M, istem: '#yavas:400 Bütün bileşenleri tek tek gözden geçir' });
  await bekleKosul(async () => { const l = await oturumlar(); const d = (id) => l.find((o) => o.id === id)?.durum; return d(bitti) === 'bosta' && d(hata) === 'hata' && d(izinli) === 'izin' && d(calisan) === 'calisiyor'; }, 20000, 'dört hâl');
  await w.locator(`.cc-oturum[data-oturum="${calisan}"]`).click();
  await bekle(800);
  const haller = await w.evaluate(() => [...document.querySelectorAll('.cc-oturum[data-oturum] .cc-hal')].map((e) => e.textContent.trim()));
  kontrol('Çalışanlar: canlı hâl rozetleri (Çalışıyor, İzin bekliyor, Bitti, Hata)', ['Çalışıyor', 'İzin bekliyor', 'Bitti', 'Hata'].every((h) => haller.includes(h)), JSON.stringify(haller));
  kontrol('Sekmede bekleyen izin sayısı (rozet)', (await w.locator('.cc-sekme-rozet').innerText().catch(() => '0')) === '1');
  await sahne('06-cok-oturum', 'Çok oturum (hâller)');

  // ════════ 7a. Taslakta "/" süreç AÇMAZ (düzeltme 1) ════════
  await w.keyboard.press('Control+N');
  await w.waitForSelector('.cc-yeni-govde');
  await w.locator('.cc-yeni-kart .cc-secici').click();
  await w.locator('.secici__panel [role="option"]', { hasText: 'yesil-elma' }).first().click();
  const pidOnce = pidler().length, oturumOnce = (await oturumlar()).length;
  await yazici().fill('/');
  await w.waitForSelector('.cc-palet .cc-palet__oge', { timeout: 8000 });
  await bekle(900);
  const taslakPalet = { adlar: await w.evaluate(() => [...document.querySelectorAll('.cc-palet__ad')].map((e) => e.textContent.trim())), not: await w.locator('[data-komut-notu]').innerText().catch(() => ''), pid: pidler().length - pidOnce, oturum: (await oturumlar()).length - oturumOnce };
  kontrol('Düzeltme 1: taslakta "/" süreç başlatmaz (yeni pid/oturum yok); yerleşik komutlar + "Beceri komutları ilk mesajdan sonra görünür"',
    taslakPalet.pid === 0 && taslakPalet.oturum === 0 && ['/compact', '/clear', '/init', '/review'].every((k) => taslakPalet.adlar.some((a) => a.startsWith(k))) && /Beceri komutları ilk mesajdan sonra görünür/.test(taslakPalet.not), JSON.stringify(taslakPalet));
  await tekFoto('07a-taslak-palet', 'Taslakta "/" (süreç açılmadan)', 'koyu', [1080, 680]);
  await yazici().press('Escape');
  await yazici().fill('');

  // ════════ 7. Komut paleti ════════
  await w.locator(`.cc-oturum[data-oturum="${bitti}"]`).click();
  await w.waitForSelector('.cc-yazici textarea');
  await yazici().fill('/');
  await w.waitForSelector('.cc-palet .cc-palet__oge', { timeout: 15000 });
  const komutlar = await w.evaluate(() => [...document.querySelectorAll('.cc-palet__ad')].map((e) => e.textContent.trim()));
  kontrol('"/" komut paleti: supportedCommands() (compact, clear, kullanıcı becerisi)', komutlar.some((k) => k.startsWith('/compact')) && komutlar.some((k) => k.startsWith('/clear')) && komutlar.some((k) => k.startsWith('/sahte-beceri')), JSON.stringify(komutlar));
  await sahne('07-komut-paleti', 'Komut paleti', async () => { await yazici().focus(); await w.waitForSelector('.cc-palet .cc-palet__oge', { timeout: 5000 }); });
  await yazici().fill('/co');
  await bekle(150);
  await yazici().press('Enter');
  kontrol('Palet: Enter seçilen komutu yazar (paleti kapatır, gönderilmez)', (await yazici().inputValue()) === '/compact ' && !(await w.locator('.cc-palet').count()), await yazici().inputValue());
  await yazici().fill('/');
  await w.waitForSelector('.cc-palet');
  await yazici().press('Escape');
  kontrol('Palet: Esc kapatır (tur durdurulmaz)', !(await w.locator('.cc-palet').count()));

  // ════════ 8. "@" dosya önerisi (gecikmeli) ════════
  if (gitVar) dosya(path.join(M, 'NOTLAR.md'), '# Notlar\n\nBu dosyayı Claude Code değil, kullanıcı ekledi.\n'); // denetçi: "Depodaki diğer değişiklikler"
  await w.locator(`.cc-oturum[data-oturum="${vitrinId}"]`).click();
  await w.waitForSelector('.cc-yazici textarea');
  const sayacKuruldu = await u.evaluate(({ ipcMain }) => {
    const m = ipcMain._invokeHandlers;
    const asil = m?.get?.('claudecode:dosya-oner');
    if (!asil) return false;
    globalThis.__ccOneri = 0;
    m.set('claudecode:dosya-oner', (...a) => { globalThis.__ccOneri++; return asil(...a); });
    return true;
  });
  await yazici().focus();
  await yazici().fill('');
  for (const h of 'şuna bak @src/gi') { await w.keyboard.type(h); await bekle(25); }
  await w.waitForSelector('.cc-palet .cc-palet__oge', { timeout: 10000 });
  await bekle(400);
  const oneri = { n: await u.evaluate(() => globalThis.__ccOneri), adlar: await w.evaluate(() => [...document.querySelectorAll('.cc-palet__ad')].map((e) => e.textContent.trim())) };
  kontrol('"@" önerisi: proje dosyaları; ~120 ms gecikmeli (7 tuşta en çok 3 istek; her tuşta istek YOK)', sayacKuruldu && oneri.adlar.includes('giris.css') && oneri.n >= 1 && oneri.n <= 3, JSON.stringify({ sayacKuruldu, ...oneri }));
  await sahne('08-dosya-oneri', '"@" dosya önerisi', async () => { await yazici().focus(); await w.waitForSelector('.cc-palet .cc-palet__oge', { timeout: 5000 }); });
  await yazici().press('Enter');
  kontrol('"@" önerisi: Enter yolu yazar', /@src\/giris\.\w+ $/.test(await yazici().inputValue()), await yazici().inputValue());
  await yazici().fill('');

  // ════════ 9. Denetçi + git farkı ════════
  const denetciAc = async (en) => { if (en < 1300 && !(await w.locator('.cc-denetci').count())) { await w.locator('.cc-oturum-bas button', { hasText: 'Denetçi' }).click(); await bekle(300); } };
  await denetciAc(1440);
  await bekleKosul(() => w.evaluate(() => document.querySelectorAll('[data-dosya-grup="oturum"] .cc-dosya').length > 0), 10000, 'değişen dosyalar');
  if (gitVar) await bekleKosul(() => w.evaluate(() => Boolean(document.querySelector('[data-dosya-grup="diger"]'))), 8000, 'diğer değişiklikler').catch(() => undefined);
  const dosyalar = await w.evaluate(() => {
    const ad = (b) => `${b.querySelector('.cc-dosya__durum')?.textContent}:${b.querySelector('.cc-dosya__ad')?.textContent}`;
    const diger = document.querySelector('[data-dosya-grup="diger"] .cc-denetci__ac');
    return { oturum: [...document.querySelectorAll('[data-dosya-grup="oturum"] .cc-dosya')].map(ad), baslik: [...document.querySelectorAll('.cc-denetci .cc-denetci__bolum-bas')].map((e) => e.textContent.trim()), diger: diger?.textContent.trim() ?? '', digerAcik: diger?.getAttribute('aria-expanded'), digerSatir: document.querySelectorAll('[data-dosya-grup="diger"] .cc-dosya').length, nokta: document.querySelectorAll('.cc-dosya__bu').length };
  });
  kontrol('Denetçi (düzeltme 1): "Bu oturumda (N)" önce (bu oturumun Edit/Write’ları), "Depodaki diğer değişiklikler (M)" kapalı, mavi nokta yok; yapılacaklar; üyelikle çalışana dolar tutarı yok (0.13 F)',
    (gitVar ? JSON.stringify(dosyalar.oturum) === '["M:giris.css","?:giris.test.ts"]' && dosyalar.baslik.includes('Bu oturumda (2)') && dosyalar.diger === 'Depodaki diğer değişiklikler (1)' && dosyalar.digerAcik === 'false' && dosyalar.digerSatir === 0 : dosyalar.oturum.some((d) => /giris\.css/.test(d)))
    && dosyalar.nokta === 0 && (await w.locator('.cc-denetci .cc-yapilacak__liste li').count()) === 4 && /oturum/i.test(await w.locator('.cc-denetci').innerText()) && !/[$]\s?\d/.test(await w.locator('.cc-denetci').innerText()), JSON.stringify(dosyalar));
  if (gitVar) {
    await w.locator('[data-dosya-grup="diger"] .cc-denetci__ac').click();
    kontrol('Denetçi: "Depodaki diğer değişiklikler" açılınca o dosyalar listelenir', (await w.locator('[data-dosya-grup="diger"] .cc-dosya', { hasText: 'NOTLAR.md' }).count()) === 1);
    await w.locator('[data-dosya-grup="diger"] .cc-denetci__ac').click();
  }
  // Alt eylemler: sabit 2×2, eşit düğmeler, iki boyutta da kesilmeden görünür
  const altOlc = [];
  const denetciAltOlc = async (en) => {
    await denetciAc(en);
    altOlc.push(await w.evaluate((e) => {
      const kap = document.querySelector('.cc-denetci')?.getBoundingClientRect();
      const d = [...document.querySelectorAll('.cc-denetci__alt .cc-denetci__izgara > button')];
      const r = d.map((b) => b.getBoundingClientRect());
      const ici = r.every((x) => kap && x.top >= kap.top - 0.5 && x.bottom <= kap.bottom + 0.5 && x.left >= kap.left - 0.5 && x.right <= kap.right + 0.5 && x.bottom <= innerHeight);
      const satir = new Set(r.map((x) => Math.round(x.top))).size, sutun = new Set(r.map((x) => Math.round(x.left))).size;
      const genis = r.map((x) => x.width), yuksek = r.map((x) => x.height);
      const kesik = d.some((b) => b.scrollWidth > b.clientWidth + 1);
      const unut = d.find((b) => /Unut/.test(b.textContent)), catal = d.find((b) => /Çatalla/.test(b.textContent));
      return { en: e, adlar: d.map((b) => b.textContent.trim()), ici, satir, sutun, esit: Math.max(...genis) - Math.min(...genis) <= 1 && Math.max(...yuksek) - Math.min(...yuksek) <= 1, kesik, yuksek: Math.round(Math.min(...yuksek)), unutRenk: unut ? getComputedStyle(unut).color : '', catalRenk: catal ? getComputedStyle(catal).color : '' };
    }, en));
  };
  await sahne('09-denetci', 'Denetçi', denetciAltOlc);
  const altTamam = altOlc.every((o) => JSON.stringify(o.adlar) === '["Çatalla","Durdur","Kapat","Unut"]' && o.ici && o.satir === 2 && o.sutun === 2 && o.esit && !o.kesik && o.yuksek >= 32 && o.unutRenk !== o.catalRenk);
  kontrol('Düzeltme 1: denetçi eylemleri altta sabit 2×2 (Çatalla, Durdur, Kapat, Unut), eşit, kesilmeden; "Unut" kırmızı yazı', altTamam, JSON.stringify(altOlc.filter((o) => !o.ici || o.kesik || !o.esit || o.satir !== 2).slice(0, 2).concat(altOlc.slice(0, 1))));
  await temaYap('koyu'); await boyut(1440, 900); await bekle(300);
  await denetciAc(1440);
  await w.locator('.cc-denetci__alt button[data-unut]').click();
  const unutOnay = await w.evaluate(() => { const b = document.querySelector('[data-unut-onay]'); return { sinif: b?.className ?? '', metin: b?.textContent ?? '', odak: document.activeElement === b }; });
  await tekFoto('09a-denetci-unut', 'Denetçi: "Unut" onayı');
  await w.locator('.cc-denetci__onay button', { hasText: 'Vazgeç' }).click();
  kontrol('Düzeltme 1: "Unut" iki adımlı; onay düğmesi kırmızı (dgm--tehlike "Evet, unut"), kendiliğinden odak almaz; Vazgeç geri alır',
    /dgm--tehlike/.test(unutOnay.sinif) && unutOnay.metin === 'Evet, unut' && !unutOnay.odak && (await w.locator('[data-unut-onay]').count()) === 0 && (await ozet(vitrinId)) !== undefined, JSON.stringify(unutOnay));
  // Buzlu cam çekmece: bileşik (ekrandaki) piksellerde alttaki döküm sızmaz, yazı kontrastı ≥ 4,5
  if (TEMALAR.includes('cam')) {
    await temaYap('cam'); await boyut(1080, 680); await bekle(500);
    await denetciAc(1080);
    await bekle(400);
    await temizle(1080, 680);
    const cek = await w.evaluate(() => {
      const c = document.querySelector('.cc-denetci--cekmece'); if (!c) return null;
      const r = c.getBoundingClientRect();
      const alt = c.querySelector('.cc-denetci__alt')?.getBoundingClientRect();
      const dd = c.querySelector('.cc-deger dd') ?? c.querySelector('.cc-proje-ozet b');
      const y = dd.getBoundingClientRect();
      // Çekmecenin sol iç boşluğu (yazı/çizgi yok): üstte 40 px, altta eylem şeridinin çizgisinden önce biter.
      return { serit: { x: Math.round(r.left + 4), y: Math.round(r.top + 40), width: 9, height: Math.round((alt ? alt.top - 6 : r.bottom - 120) - (r.top + 40)) }, yazi: { x: Math.round(y.left), y: Math.round(y.top), width: Math.max(1, Math.round(Math.min(y.width, 120))), height: Math.max(1, Math.round(y.height)) }, renk: getComputedStyle(dd).color, dpr: devicePixelRatio };
    });
    const pikselOlc = async () => cek && await u.evaluate(async ({ BrowserWindow }, c) => {
      const p = BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes('index.html'));
      const al = async (rect) => { const im = await p.webContents.capturePage(rect); const { width, height } = im.getSize(); const b = im.toBitmap(); const l = []; for (let i = 0; i < width * height; i++) l.push([b[i * 4 + 2], b[i * 4 + 1], b[i * 4]]); return l; };
      const serit = await al(c.serit);
      const lum = serit.map(([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b);
      const ort = serit.reduce((a, x) => [a[0] + x[0], a[1] + x[1], a[2] + x[2]], [0, 0, 0]).map((v) => v / serit.length);
      const yazi = await al(c.yazi);
      return { ort, aralik: Math.max(...lum) - Math.min(...lum), yaziPiksel: yazi.length };
    }, cek);
    const olc = await pikselOlc();
    // Karşılaştırma (kanıt): düzeltmeden önceki çekmece (bulanıklık yok, %95 opak) aynı yerde
    await w.evaluate(() => { const s = document.createElement('style'); s.id = 'eski-cekmece'; s.textContent = '.cc-denetci--cekmece{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;background:rgb(24 26 32 / .95)!important}'; document.head.append(s); });
    await bekle(300);
    const eski = await pikselOlc();
    await w.evaluate(() => document.getElementById('eski-cekmece')?.remove());
    const parse = (s) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const kanal = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const L = ([r, g, b]) => 0.2126 * kanal(r) + 0.7152 * kanal(g) + 0.0722 * kanal(b);
    const oran = olc ? (() => { const a = L(parse(cek.renk)), b = L(olc.ort); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); })() : 0;
    kontrol('Düzeltme 1: Buzlu cam çekmece — ekrandaki piksellerde alttaki döküm sızmaz (zemin düz), yazı kontrastı ≥ 4,5',
      olc && olc.aralik <= 10 && oran >= 4.5, olc ? `zemin parlaklık aralığı ${olc.aralik.toFixed(1)} (düzeltmesiz ${eski?.aralik.toFixed(1)}) · ort rgb(${olc.ort.map((v) => Math.round(v)).join(' ')}) · yazı ${cek.renk} → ${oran.toFixed(2)}:1` : 'çekmece yok');
    await temaYap('koyu'); await boyut(1440, 900); await bekle(300);
  }
  const farkHazirla = async (en) => {
    if (!(await w.locator('.cc-fark-sayfa').count())) { await denetciAc(en); await w.locator('.cc-dosya', { hasText: 'giris.css' }).click(); }
    else if (en < 1300 && await w.locator('.cc-denetci--cekmece').count()) await w.locator('.cc-denetci__kapat').click();
    await w.waitForSelector('.cc-fark-sayfa .cc-fark__satir', { timeout: 10000 });
  };
  await farkHazirla(1440);
  const fark = await w.evaluate(() => ({ ekle: document.querySelectorAll('.cc-fark-sayfa .cc-fark__satir[data-tur="ekle"]').length, sil: document.querySelectorAll('.cc-fark-sayfa .cc-fark__satir[data-tur="sil"]').length, no: [...document.querySelectorAll('.cc-fark-sayfa .cc-fark__no')].map((e) => e.textContent).filter(Boolean).slice(0, 4) }));
  kontrol('Denetçi → git farkı: eklenen/silinen satırlar, gerçek satır numaraları', fark.ekle >= 2 && fark.sil >= 1 && fark.no.length > 0, JSON.stringify(fark));
  await sahne('10-git-farki', 'Denetçi + git farkı', farkHazirla);
  await w.keyboard.press('Escape');
  await bekle(200);
  kontrol('Fark sayfası açılınca odak alır; Esc ile kapanır', !(await w.locator('.cc-fark-sayfa').count()));

  // ════════ 10. Projeler + CLAUDE.md ════════
  await w.locator('.cc__sekmeler [data-sekme="projeler"]').click();
  await w.waitForSelector('.cc-proje');
  await w.locator('.cc-proje', { hasText: 'mavi-kus' }).click();
  await w.waitForSelector('.cc-md-duzen__alan');
  await bekleKosul(async () => /Mavi Kuş/.test(await w.locator('.cc-md-duzen__alan').inputValue()), 8000, 'CLAUDE.md');
  await w.locator('.cc-md-duzen__alan').fill('# Mavi Kuş\n\n## Kurallar\n- Türkçe yaz.\n- Testleri çalıştırmadan bitti deme.\n- Erişilebilirlik: kontrast en az 4,5:1.\n\n## Komutlar\n- `npm test`\n- `npm run build`\n');
  await sahne('11-projeler', 'Projeler + CLAUDE.md düzenleyici');
  await w.locator('.cc-md-duzen__alt button', { hasText: 'Farkı gör ve kaydet' }).click();
  await w.waitForSelector('.cc-md-duzen__fark .cc-fark__satir');
  await tekFoto('11a-claude-md-fark', 'CLAUDE.md: kaydetmeden önce fark');
  await w.locator('.cc-md-duzen__alt button', { hasText: 'Kaydet' }).click();
  await w.waitForSelector('.cc-md-duzen .cc-ileti');
  kontrol('CLAUDE.md: fark gösterilip kaydedildi (proje kökü)', /Erişilebilirlik/.test(fs.readFileSync(path.join(M, 'CLAUDE.md'), 'utf8')) && /kaydedildi/.test(await w.locator('.cc-md-duzen .cc-ileti').innerText()));
  fs.appendFileSync(path.join(M, 'CLAUDE.md'), '\n- dışarıdan eklendi\n');
  await w.locator('.cc-md-duzen__alan').fill('# başka\n');
  await w.locator('.cc-md-duzen__alt button', { hasText: 'Farkı gör ve kaydet' }).click();
  await w.locator('.cc-md-duzen__alt button', { hasText: 'Kaydet' }).click();
  await w.waitForSelector('.cc-md-duzen .cc-ileti--hata');
  kontrol('CLAUDE.md: dosya o arada değiştiyse yazılmaz, "Diskteki sürümü yükle" sunulur', /dışarıdan eklendi/.test(fs.readFileSync(path.join(M, 'CLAUDE.md'), 'utf8')) && (await w.locator('.cc-md-duzen button', { hasText: 'Diskteki sürümü yükle' }).count()) === 1);

  // ════════ 11. Ayarlar ════════
  await w.locator('.cc__sekmeler [data-sekme="ayarlar"]').click();
  await w.waitForSelector('.cc-ayarlar');
  kontrol('Ayarlar: Tam yetki kapalıyken Tam yetki modu seçilemez', await w.locator('.cc-mod-secenek[data-tam]').isDisabled());
  await sahne('12-ayarlar', 'Ayarlar sekmesi');
  await w.locator('[data-ayar="cc-tam-yetki"] .anahtar').click();
  await bekleKosul(async () => (await cagir('ayarlar:al')).claudeCode.tamYetki === true, 5000, 'tam yetki açık');
  kontrol('Ayarlar: "Tam yetki" açılınca Tam yetki modu seçilebilir', !(await w.locator('.cc-mod-secenek[data-tam]').isDisabled()));

  // ════════ 12. Hata durumu ════════
  await w.locator('.cc__sekmeler [data-sekme="oturumlar"]').click();
  await w.locator(`.cc-oturum[data-oturum="${hata}"]`).click();
  await w.waitForSelector('.cc-hata-kart');
  kontrol('Hata durumu: çöken oturum nedenle görünür, sürdürülebilir', /çıkış kodu 3/.test(await w.locator('.cc-hata-kart').innerText()));
  await sahne('13-hata', 'Hata durumu');

  // ════════ 13b. Klasör güveni (son dalga B, I1) ════════
  // Yeni klonlanmış depo: kendi .claude/settings.json'u (kancalar, izin kuralları), komutu ve .mcp.json'u var. Klasör seçici (Electron'un
  // iletişim kutusu ana süreçte yerine konur; gerçek pencere açılmaz) bu klasörü döndürür → kart yazma kutusundan ÖNCE çıkar.
  await u.evaluate(({ dialog }, yol) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [yol] }); }, KLON);
  /** Ctrl+N → (en yakın proje zaten kararsız klon-depo ise kart HEMEN çıkar; değilse) "Klasör seç…" → kart. Kart açıkken döner. */
  const klasorSecYeni = async () => {
    await w.keyboard.press('Control+N');
    await w.waitForSelector('.cc-yeni-govde, [data-klasor-guveni]');
    await bekle(400); // güven durumu okunur (kart gelebilir)
    if (!(await w.locator('[data-klasor-guveni]').count())) await w.locator('.cc-yeni-kart button', { hasText: 'Klasör seç' }).click();
    await w.waitForSelector('[data-klasor-guveni]', { timeout: 10000 });
  };
  await temaYap('koyu'); await boyut(1440, 900); await bekle(300);
  await klasorSecYeni();
  await bekle(300);
  const gKart = await w.evaluate(() => ({
    soru: document.querySelector('#cc-guven-soru')?.textContent ?? '',
    adlar: [...document.querySelectorAll('.cc-guven__ad')].map((e) => e.textContent),
    ozet: [...document.querySelectorAll('.cc-guven__ozet')].map((e) => e.textContent),
    yazici: document.querySelectorAll('.cc-yazici').length,
    odak: Boolean(document.activeElement?.matches('[data-klasor-guveni]')),
    dugmeler: [...document.querySelectorAll('[data-klasor-guveni] button')].map((b) => b.textContent.trim()),
  }));
  kontrol('Klasör güveni: kendi ayarları olan klasör seçilince kart YAZMADAN önce çıkar — soru, dosyalar + özet, yazma kutusu yok, odak kartta ("Güveniyorum"da değil)',
    gKart.soru === 'Bu klasörün kendi Claude Code ayarları var (kancalar, izin kuralları, MCP sunucuları). Güveniyor musun?'
      && JSON.stringify(gKart.adlar) === JSON.stringify(['.claude/settings.json', '.claude/ (komut, beceri, ajan, kanca)', '.mcp.json'])
      && /^kancalar: SessionStart, PreToolUse · 2 izin kuralı · 1 ortam değişkeni$/.test(gKart.ozet[0]) && gKart.ozet[1] === '1 komut' && gKart.ozet[2] === 'MCP sunucuları: github, veritabani'
      && gKart.yazici === 0 && gKart.odak && JSON.stringify(gKart.dugmeler) === JSON.stringify(['Vazgeç', 'Güvenme, yükleme', 'Güveniyorum']), JSON.stringify(gKart));
  // Soru ve üç karar düğmesi her boyutta görünür alanda (ayrıntılar kartın içinde kayar): sahne her temada × boyutta ölçer.
  const gorunurAlan = [];
  await sahne('18-klasor-guveni', 'Klasör güven kartı', async (en) => {
    gorunurAlan.push(await w.evaluate((e) => {
      const govde = document.querySelector('.cc-guven-govde')?.getBoundingClientRect();
      const ic = (el) => { const r = el.getBoundingClientRect(); return r.height > 0 && r.top >= govde.top - 0.5 && r.bottom <= govde.bottom + 0.5; };
      const ogeler = [document.querySelector('#cc-guven-soru'), ...document.querySelectorAll('[data-klasor-guveni] .cc-izin__dugmeler button')];
      return { en: e, tamam: Boolean(govde) && ogeler.length === 4 && ogeler.every(ic) };
    }, en));
  });
  kontrol('Klasör güven kartı: soru ve üç karar düğmesi her temada ve boyutta (1080×680 dahil) kaydırmadan görünür', gorunurAlan.length > 0 && gorunurAlan.every((x) => x.tamam), JSON.stringify(gorunurAlan));
  // Güvenme → oturum klasörün ayarları olmadan açılır.
  await temaYap('koyu'); await boyut(1440, 900); await bekle(300);
  await w.locator('[data-klasor-guveni] button[data-guven="guvenme"]').click();
  await w.waitForSelector('[data-klasor-guveni-durum="guvenme"]', { timeout: 8000 });
  kontrol('"Güvenme": kart kapanır, yazma kutusu gelir, karar görünür ("yüklenmeyecek")', !(await w.locator('[data-klasor-guveni]').count()) && (await w.locator('.cc-yazici textarea').count()) === 1 && /yüklenmeyecek \(güvenmedin\)/.test(await w.locator('[data-klasor-guveni-durum]').innerText()));
  const gOnce = kayitlar().length;
  await gonder('#durum Bu depoyu incele');
  await w.waitForSelector('.cc-oturum[aria-current="true"][data-hal]');
  const klonId = await seciliId();
  await sonucBekle(klonId);
  await bekle(400);
  const gArgv = kayitlar().slice(gOnce).find((r) => r.argv.includes('--input-format'))?.argv ?? [];
  const gNot = await w.evaluate(() => document.querySelector('.cc-orta .cc-dokum')?.textContent ?? '');
  kontrol('Güvenilmeyen klasörde oturum: claude --setting-sources=user + --strict-mcp-config; dökümde "yüklenmedi (güvenmedin)" notu',
    gArgv.includes('--setting-sources=user') && gArgv.includes('--strict-mcp-config') && /ayarları yüklenmedi \(güvenmedin\)/.test(gNot), JSON.stringify(gArgv));
  // Ayarlar → Klasör güveni: karar listede; "Kararı sil".
  await w.locator('.cc__sekmeler [data-sekme="ayarlar"]').click();
  await w.waitForSelector('[data-klasor-guveni-listesi] .cc-guven-kararlar li', { timeout: 8000 });
  const gListe = await w.evaluate(() => [...document.querySelectorAll('[data-klasor-guveni-listesi] .cc-guven-kararlar li')].map((li) => li.textContent));
  kontrol('Ayarlar → Klasör güveni: karar listede ("Güvenilmedi" + klasör)', gListe.length === 1 && /Güvenilmedi/.test(gListe[0]) && gListe[0].includes('klon-depo'), JSON.stringify(gListe));
  await temaYap('koyu'); await boyut(1080, 680); await bekle(450);
  await w.locator('[data-klasor-guveni-listesi]').scrollIntoViewIfNeeded();
  await bekle(300);
  await tekFoto('18b-klasor-guveni-ayarlar', 'Ayarlar → Klasör güveni', 'koyu', [1080, 680]);
  await boyut(1440, 900); await bekle(300);
  await w.locator('[data-klasor-guveni-listesi] button', { hasText: 'Kararı sil' }).click();
  await w.waitForSelector('[data-klasor-guveni-listesi] [data-bos]', { timeout: 5000 });
  kontrol('"Kararı sil": liste boşalır (sonraki oturumda kart yeniden sorar)', (await w.locator('[data-klasor-guveni-listesi] .cc-guven-kararlar li').count()) === 0);
  // Karar silindi: aynı klasörde yeni oturum yine kartla başlar (Ctrl+N en yakın proje = klon-depo → kart hemen). Vazgeç → oturum
  // açılmaz, boş duruma dönülür; yeniden → "Güveniyorum" → klasörün ayarlarıyla.
  await w.locator('.cc__sekmeler [data-sekme="oturumlar"]').click();
  await w.keyboard.press('Control+N');
  await w.waitForSelector('[data-klasor-guveni]', { timeout: 10000 });
  kontrol('Karar silinince aynı klasörde yeni oturum kartı yeniden sorar (Ctrl+N → en yakın proje klon-depo → kart hemen)', (await w.locator('[data-klasor-guveni]').count()) === 1 && (await w.locator('.cc-yazici').count()) === 0);
  const gOturumSayisi = (await oturumlar()).length;
  await w.locator('[data-klasor-guveni] button', { hasText: 'Vazgeç' }).click();
  await w.waitForSelector('.cc-bos', { timeout: 5000 });
  kontrol('"Vazgeç": kart kapanır, oturum açılmaz, boş duruma dönülür', !(await w.locator('[data-klasor-guveni]').count()) && (await oturumlar()).length === gOturumSayisi);
  await klasorSecYeni();
  await w.locator('[data-klasor-guveni] button[data-guven="guven"]').click();
  await w.waitForSelector('[data-klasor-guveni-durum="guven"]', { timeout: 8000 });
  const gOnce2 = kayitlar().length;
  await gonder('#durum Güvenilen depo');
  await w.waitForSelector('.cc-oturum[aria-current="true"][data-hal]');
  const klonId2 = await seciliId();
  await sonucBekle(klonId2);
  const gArgv2 = kayitlar().slice(gOnce2).find((r) => r.argv.includes('--input-format'))?.argv ?? [];
  kontrol('"Güveniyorum": oturum klasörün kendi ayarlarıyla (--setting-sources ve --strict-mcp-config yok)', gArgv2.length > 0 && !gArgv2.some((x) => /^--setting-sources/.test(x)) && !gArgv2.includes('--strict-mcp-config'), JSON.stringify(gArgv2));
  // Düzeltme turu (N3): güvenilen klasöre `git pull` yeni kanca getirdi → karar geçersiz, kart "değişti" notuyla yeniden sorar.
  const klonAyar = JSON.parse(fs.readFileSync(path.join(KLON, '.claude', 'settings.json'), 'utf8'));
  klonAyar.hooks.Stop = [{ hooks: [{ type: 'command', command: 'node yeni-kanca.js' }] }];
  fs.writeFileSync(path.join(KLON, '.claude', 'settings.json'), JSON.stringify(klonAyar, null, 1));
  await klasorSecYeni();
  const gDegisti = await w.evaluate(() => ({ not: document.querySelector('[data-guven-degisti]')?.textContent ?? '', ozet: [...document.querySelectorAll('.cc-guven__ozet')].map((e) => e.textContent)[0] ?? '' }));
  kontrol('N3: güvenilen klasörün ayarları değişince kart yeniden sorar ("son kararından sonra değişti"; yeni kanca listede)', /son kararından sonra değişti/.test(gDegisti.not) && /Stop/.test(gDegisti.ozet), JSON.stringify(gDegisti));
  await tekFoto('18c-klasor-guveni-degisti', 'Klasör güveni: ayarlar değişti', 'acik', [1080, 680]);
  await w.locator('[data-klasor-guveni] button', { hasText: 'Vazgeç' }).click();
  await cagir('claudecode:klasor-guveni', { cwd: KLON, karar: null });

  // ════════ Davranış ════════
  await temaYap('koyu'); await boyut(1440, 900); await bekle(300);
  // Tam yetki: boştaki oturumda kırmızı rozet (süreç Tam yetkisiz açılmıştı → motor kendiliğinden yeniden açar)
  await w.locator(`.cc-oturum[data-oturum="${bitti}"]`).click();
  await w.waitForSelector('.cc-yazici .cc-secici');
  await modSec('Tam yetki');
  await bekleKosul(async () => (await ozet(bitti))?.mod === 'bypassPermissions', 8000, 'tam yetki modu');
  await bekle(300);
  kontrol('Tam yetki: seçilir (ayar açık), mod seçicisi ve listede kırmızı rozet', await w.locator('.cc-yazici .cc-secici--tam').count() === 1 && await w.locator(`.cc-oturum[data-oturum="${bitti}"] .cc-tam-rozet`).count() === 1);
  await tekFoto('14-tam-yetki', 'Tam yetki rozeti');
  // Çalışan oturumda Tam yetkiye geçiş: "yeniden açılmalı" şeridi → Durdur ve geç
  await w.locator(`.cc-oturum[data-oturum="${calisan}"]`).click();
  await w.waitForSelector('.cc-yazici .cc-secici');
  await modSec('Tam yetki');
  await w.waitForSelector('.cc-serit', { timeout: 5000 });
  kontrol('Çalışırken Tam yetki: açık satır içi şerit ("yeniden açılmalı", Tur bitince geç / Durdur ve geç)', /yeniden açılmalı/.test(await w.locator('.cc-serit').innerText()) && await w.locator('.cc-serit button', { hasText: 'Tur bitince geç' }).count() === 1);
  await tekFoto('15-tam-yetki-serit', 'Tam yetki: yeniden açılmalı şeridi');
  await tekFoto('15-tam-yetki-serit', 'Tam yetki: yeniden açılmalı şeridi', 'acik', [1080, 680]);
  await temaYap('koyu'); await boyut(1440, 900);
  await w.locator('.cc-serit button', { hasText: 'Durdur ve geç' }).click();
  await bekleKosul(async () => (await ozet(calisan))?.mod === 'bypassPermissions' && (await ozet(calisan))?.durum !== 'calisiyor', 20000, 'durdur ve geç');
  // 0.15: şerit özetteki mod hedefe ulaşınca kalkar (ana sürecin eski süreci kapatmasını beklemez). Özeti bu betik IPC ile okur, arayüz olayla — olayın
  // React'te çizilmesi için kısa pay (en çok 1,5 sn; eskiden şerit ana süreç yanıt verene dek, yüklü makinede ~4 sn kalıyordu).
  await w.waitForSelector('.cc-serit', { state: 'detached', timeout: 1500 }).catch(() => undefined);
  kontrol('"Durdur ve geç": tur durdu, oturum Tam yetkiye geçti, şerit kalktı', !(await w.locator('.cc-serit').count()));

  // Esc durdurur (odak yazma kutusundayken)
  await w.locator(`.cc-oturum[data-oturum="${bitti}"]`).click();
  await gonder('#yavas:60 uzun iş');
  await bekleKosul(async () => (await ozet(bitti))?.durum === 'calisiyor', 8000, 'çalışıyor');
  await bekle(600);
  await yazici().focus();
  await w.keyboard.press('Escape');
  await bekleKosul(async () => (await ozet(bitti))?.durum !== 'calisiyor', 12000, 'esc durdurdu');
  await w.waitForSelector('.cc-sonuc[data-ton="notr"]', { timeout: 5000 });
  kontrol('Esc (yazma kutusunda, tur sürerken) = Durdur → "Durduruldu"', (await w.locator('.cc-sonuc', { hasText: 'Durduruldu' }).count()) >= 1);
  // Enter gönderir, Shift+Enter satır
  await yazici().fill('birinci satır');
  await yazici().press('Shift+Enter');
  await yazici().pressSequentially('ikinci satır');
  const iki = await yazici().inputValue();
  await yazici().press('Enter');
  await w.waitForSelector('.cc-ben__balon:has-text("ikinci satır")', { timeout: 8000 });
  kontrol('Shift+Enter satır ekler, Enter gönderir (iki satırlı mesaj)', iki === 'birinci satır\nikinci satır' && (await yazici().inputValue()) === '');
  // Ctrl+K oturum arama
  await w.keyboard.press('Control+K');
  await bekle(200);
  const aramaOdak = await w.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  await w.keyboard.type('fiyat');
  await bekle(700);
  const aramaSonuc = await w.evaluate(() => [...document.querySelectorAll('.cc-oturum .cc-oturum__baslik')].map((e) => e.textContent.trim()));
  kontrol('Ctrl+K: oturum arama odaklanır ve süzer (çalışan + geçmiş)', aramaOdak === 'Oturum ara' && aramaSonuc.length >= 1 && aramaSonuc.every((t) => /fiyat/i.test(t)), JSON.stringify(aramaSonuc));
  await w.locator('.cc-ara__temizle').click();

  // Geçmiş oturum: JSONL dökümü, eski terminal yolu, uygulamada sürdürme (önceki konuşma üstte)
  await w.locator(`.cc-oturum--gecmis[data-gecmis="${GECMIS_KIMLIK}"]`).click();
  // 11 Kas: geçmişte art arda biten araç kartları katlı satırdır ("N adım · S sn"); açınca kartlar görünür.
  await w.waitForSelector('.cc-dokum .cc-arac, .cc-dokum [data-cc-katli]');
  const gecmisKatli = await w.evaluate(() => [...document.querySelectorAll('.cc-dokum [data-cc-katli] .is-katli__metin')].map((e) => e.textContent));
  for (const b of await w.locator('.cc-dokum [data-cc-katli] .is-katli__bas[aria-expanded="false"]').all()) await b.click();
  await bekle(300);
  kontrol('Geçmiş oturum: biten araç kartları katlı satırda, açılınca görünür', gecmisKatli.every((m) => /^\d+ adım · /.test(m)), JSON.stringify(gecmisKatli));
  const gd = await w.evaluate(() => ({ ben: document.querySelectorAll('.cc-dokum .cc-ben').length, arac: [...document.querySelectorAll('.cc-dokum .cc-arac__ad')].map((e) => e.textContent) }));
  kontrol('Geçmiş oturum: JSONL dökümü (istem, metin, Okuma ve Düzenleme kartları)', gd.ben >= 2 && gd.arac.includes('Okuma') && gd.arac.includes('Düzenleme'), JSON.stringify(gd));
  await tekFoto('16-gecmis', 'Geçmiş oturum (JSONL)');
  const once = kayitlar().length;
  await w.locator('.cc-denetci button[data-terminal]').click();
  await w.waitForSelector('[data-terminal-ileti]');
  await bekleKosul(async () => kayitlar().slice(once).some((r) => r.argv[0] === '--resume'), 6000, 'terminal kaydı').catch(() => undefined);
  const term = kayitlar().slice(once).find((r) => r.argv[0] === '--resume');
  kontrol('Geçmiş: "Terminalde sürdür" eski yolla (claude --resume … --dangerously-skip-permissions; Tam yetki açık)', term?.argv[1] === GECMIS_KIMLIK && term.argv.includes('--dangerously-skip-permissions') && /Terminal açıldı: claude --resume/.test(await w.locator('[data-terminal-ileti]').innerText()), JSON.stringify(term?.argv));
  fs.utimesSync(path.join(claudeDiz, 'projects', kodla(M), `${GECMIS_KIMLIK}.jsonl`), (Date.now() - 3600_000) / 1000, (Date.now() - 3600_000) / 1000); // terminal yazmadı
  await gonder('#durum geçmişten sürdür');
  await bekleKosul(async () => (await oturumlar()).some((o) => o.kimlik === GECMIS_KIMLIK && (o.turSayisi ?? 0) >= 1), 15000, 'geçmişten sürdürme');
  await w.waitForSelector('.cc-ayrac:has-text("Uygulamada sürüyor")', { timeout: 5000 });
  kontrol('Geçmişte yazınca uygulamada sürer (resume); önceki konuşma üstte, "Uygulamada sürüyor" ayracı', (await w.locator('.cc-dokum .cc-ben').count()) >= 3);
  // Düzeltme 2 (N5): sürdürülen oturum kapatılıp başka oturuma geçilince (döküm bırakılır) geri dönüldüğünde önceki konuşma yine üstte
  const surdurulen = (await oturumlar()).find((o) => o.kimlik === GECMIS_KIMLIK)?.id;
  const benOnce = await w.locator('.cc-dokum .cc-ben').count();
  await w.locator(`.cc-oturum[data-oturum="${bitti}"]`).click();
  await bekle(300);
  await cagir('claudecode:kapat', surdurulen);
  await bekleKosul(async () => (await ozet(surdurulen))?.durum === 'kapandi', 8000, 'sürdürülen kapandı');
  await bekle(300);
  await w.locator(`.cc-oturum[data-oturum="${surdurulen}"]`).click();
  await bekleKosul(() => w.evaluate(() => Number(document.querySelector('.cc-dokum')?.dataset.ogeSayisi ?? 0) > 0), 8000, 'sürdürülen yeniden yüklendi');
  await bekle(400);
  const n5 = { ayrac: await w.locator('.cc-ayrac:has-text("Uygulamada sürüyor")').count(), ben: await w.locator('.cc-dokum .cc-ben').count(), benOnce };
  kontrol('Düzeltme 2 (N5): kapatılıp bırakılan sürdürülmüş oturumda önceki konuşma kaybolmaz ("Uygulamada sürüyor" ayracı ve eski istemler)', n5.ayrac === 1 && n5.ben === benOnce, JSON.stringify(n5));
  // Düzeltme 2 (N4): kapanmış oturumda "/" — motor boş/hatalı dönerse yedek liste ("Komutlar yükleniyor…"da kalınmaz)
  await yazici().fill('/');
  await bekle(2500);
  const n4 = await w.evaluate(() => ({ oge: document.querySelectorAll('.cc-palet .cc-palet__oge').length, yukleniyor: /Komutlar yükleniyor/.test(document.querySelector('.cc-palet')?.textContent ?? '') }));
  kontrol('Düzeltme 2 (N4): kapanmış oturumda "/" listesi gelir ("Komutlar yükleniyor…"da kalmaz)', n4.oge > 0 && !n4.yukleniyor, JSON.stringify(n4));
  await yazici().press('Escape');
  await yazici().fill('');
  // Düzeltme 2 (N3): bayat "Oturumu aç" (uygulama yeniden açılmış gibi: bilinmeyen oturum id'si) — kimlik geçmişte varsa o açılır, yoksa not
  const BAYAT_KIMLIK = 'bbbb2222-0000-4000-8000-000000000002';
  await cagir('ana:goster', `claude#cc-bayat-oturum~${BAYAT_KIMLIK}`);
  let bayatGecmis = false;
  for (let i = 0; i < 40 && !bayatGecmis; i++) { bayatGecmis = await w.evaluate((k) => document.querySelector(`.cc-oturum--gecmis[data-gecmis="${k}"]`)?.getAttribute('aria-current') === 'true', BAYAT_KIMLIK); if (!bayatGecmis) await bekle(150); }
  await cagir('ana:goster', 'claude#cc-hic-olmayan-oturum');
  let bayatNot = '';
  for (let i = 0; i < 40 && !bayatNot; i++) { bayatNot = await w.evaluate(() => [...document.querySelectorAll('.tostlar .tost')].map((t) => t.textContent).find((t) => /artık açık değil/.test(t)) ?? ''); if (!bayatNot) await bekle(150); }
  kontrol('Düzeltme 2 (N3): bayat "Oturumu aç" — aynı Claude Code kimlikli geçmiş oturum açılır; hiçbiri yoksa "Bu oturum artık açık değil; geçmişten sürdürebilirsin."', bayatGecmis && /geçmişten sürdürebilirsin/.test(bayatNot), JSON.stringify({ bayatGecmis, bayatNot }));
  await temizle(1440, 900);

  // Ada / tost bildiriminden oturuma gitme
  await w.locator('.ray__dgm[data-tur="kokpit"]').click();
  await w.waitForSelector('.kokpit');
  await cagir('ana:goster', `claude#cc-${izinli}`);
  await bekleKosul(() => w.evaluate((id) => document.querySelector(`.cc-oturum[aria-current="true"]`)?.getAttribute('data-oturum') === id, izinli), 8000, 'bildirimden oturum');
  await w.waitForSelector('[data-izin-kart]', { timeout: 8000 }).catch(() => undefined);
  kontrol('Ada bildirimi (ana:git claude#cc-<id>): başka sayfadan Claude Code’a gider ve o oturumu seçer; izin kartı görünür', await w.locator('[data-izin-kart]').count() === 1);
  await temizle(1440, 900);
  await u.evaluate(({ BrowserWindow }, yol) => { BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes('index.html'))?.webContents.send('ana:ada-tost', { kanal: 'asistan:bildir', veri: { tur: 'mesaj', baslik: 'Claude Code bitirdi · fuber-site', metin: 'dosya değişmedi.', yol } }); }, `claude#cc-${bitti}`);
  await w.waitForSelector('.tost [data-tost-ac]', { timeout: 5000 });
  await w.locator('.tost [data-tost-ac]').click();
  await bekleKosul(() => w.evaluate((id) => document.querySelector(`.cc-oturum[aria-current="true"]`)?.getAttribute('data-oturum') === id, bitti), 8000, 'tosttan oturum');
  kontrol('Uygulama içi tost: "Aç" o oturuma götürür', true);
  // Düzeltme 3 (F1): bildirim yolları Claude Code kimliğini de taşır ('claude#cc-<id>~<kimlik>'); EKRANDAKİ oturumun bildirimi yine
  // tost olarak tekrarlanmaz (eskiden tam eşitlik bakıldığı için kimlik ekli yol her seferinde tost oluyordu).
  await temizle(1440, 900);
  const tostSay = () => w.evaluate(() => [...document.querySelectorAll('.tostlar .tost')].filter((t) => /Claude Code bitirdi/.test(t.textContent)).length);
  const tostOnce = await tostSay();
  await u.evaluate(({ BrowserWindow }, yol) => { BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes('index.html'))?.webContents.send('ana:ada-tost', { kanal: 'asistan:bildir', veri: { tur: 'mesaj', baslik: 'Claude Code bitirdi · fuber-site', metin: 'dosya değişmedi.', yol } }); }, `claude#cc-${bitti}~${'aaaa1111-0000-4000-8000-00000000abcd'}`);
  await bekle(900);
  const tostEkranda = await tostSay();
  kontrol('Düzeltme 3 (F1): ekrandaki oturumun kimlik ekli bildirimi tost olarak tekrarlanmaz', tostEkranda === tostOnce, JSON.stringify({ tostOnce, tostEkranda }));
  await w.locator(`.cc-oturum[data-oturum="${izinli}"]`).click();
  await w.waitForSelector('[data-izin-kart]', { timeout: 8000 });
  // Düzeltme 1: izin beklerken Durdur (Esc, odak yazma kutusunda) → hiçbir izin kartı/hapı kalmaz; kartta "izin kapandı"
  await yazici().focus();
  await w.keyboard.press('Escape');
  await bekleKosul(async () => !['izin', 'calisiyor'].includes((await ozet(izinli))?.durum), 12000, 'izinde durdur');
  await bekle(500);
  const kesIzin = await w.evaluate(() => ({ kart: document.querySelectorAll('[data-izin-kart]').length, dok: document.querySelectorAll('.cc-izinler').length, hap: document.querySelectorAll('[data-izin-hap]').length, karar: [...document.querySelectorAll('.cc-arac__karar')].map((e) => e.textContent) }));
  kontrol('Düzeltme 1: izin beklerken durdurunca 0 izin kartı (kart, alttaki kutu, hap yok); kartta "izin kapandı"', kesIzin.kart === 0 && kesIzin.dok === 0 && kesIzin.hap === 0 && kesIzin.karar.includes('izin kapandı'), JSON.stringify(kesIzin));

  // Akış sırasında kare süresi
  const akisId = await yeniBaslat({ cwd: PROJELER.site, istem: 'hazırlık' });
  await sonucBekle(akisId);
  await w.locator(`.cc-oturum[data-oturum="${akisId}"]`).click();
  await bekle(500);
  await w.evaluate(() => { window.__uzun = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__uzun.push(e.duration); }).observe({ type: 'longtask', buffered: false }); } catch { /* yok */ } });
  await gonder('#akis:5 Akışı sına');
  await bekleKosul(() => w.evaluate(() => Boolean(document.querySelector('.cc-yanit[data-akiyor]'))), 8000, 'akış başladı');
  const kare = await w.evaluate(() => new Promise((coz) => {
    const d = []; let son = performance.now(); const bitis = son + 3500;
    const f = (t) => { d.push(t - son); son = t; if (t < bitis) requestAnimationFrame(f); else coz(d); };
    requestAnimationFrame(f);
  }));
  const sirali = [...kare].sort((a, b) => a - b);
  const p95 = sirali[Math.floor(sirali.length * 0.95)];
  const enUzun = sirali[sirali.length - 1];
  const uzunlar = await w.evaluate(() => window.__uzun.filter((x) => x > 50).length);
  kontrol('Akış sırasında kare süresi: p95 ≤ 25 ms, en uzun ≤ 120 ms, 50 ms+ uzun görev ≤ 3', p95 <= 25 && enUzun <= 120 && uzunlar <= 3, `${kare.length} kare · p50 ${sirali[Math.floor(sirali.length / 2)].toFixed(1)} ms · p95 ${p95.toFixed(1)} ms · en uzun ${enUzun.toFixed(1)} ms · uzun görev ${uzunlar}`);
  await sonucBekle(akisId, 2);
  // Düzeltme 1: A (akisId) akarken ekrandaki B (bitti) yeniden kurulmaz: öğe sayısı sabit, B'de akan metin yok
  await gonder('#akis:3 ikinci akış');
  await bekleKosul(() => w.evaluate(() => Boolean(document.querySelector('.cc-yanit[data-akiyor]'))), 8000, 'ikinci akış');
  const aOnce = await w.evaluate(() => Number(document.querySelector('.cc-dokum')?.dataset.ogeSayisi ?? 0));
  await w.locator(`.cc-oturum[data-oturum="${bitti}"]`).click();
  await bekle(400);
  const bSayilar = [];
  for (let i = 0; i < 10; i++) { bSayilar.push(await w.evaluate(() => ({ n: Number(document.querySelector('.cc-dokum')?.dataset.ogeSayisi ?? -1), akan: document.querySelectorAll('.cc-yanit[data-akiyor]').length }))); await bekle(180); }
  const aAkiyordu = (await ozet(akisId))?.durum === 'calisiyor' || ((await ozet(akisId))?.turSayisi ?? 0) >= 3;
  await sonucBekle(akisId, 3);
  await w.locator(`.cc-oturum[data-oturum="${akisId}"]`).click();
  await bekle(500);
  const aSonra = await w.evaluate(() => Number(document.querySelector('.cc-dokum')?.dataset.ogeSayisi ?? 0));
  kontrol('Düzeltme 1: A oturumu akarken B’nin öğe sayısı değişmez (B’de akan metin yok); A’nın öğeleri arttı',
    aAkiyordu && new Set(bSayilar.map((x) => x.n)).size === 1 && bSayilar[0].n > 0 && bSayilar.every((x) => x.akan === 0) && aSonra > aOnce, JSON.stringify({ aOnce, aSonra, b: [...new Set(bSayilar.map((x) => x.n))] }));
  // Düzeltme 1 (bellek): kapanmış ve ekranda olmayan oturumun dökümü bırakılır; yeniden seçilince motordan yeniden yüklenir
  await u.evaluate(({ ipcMain }) => {
    const m = ipcMain._invokeHandlers;
    const asil = m?.get?.('claudecode:oturum-al');
    if (!asil || globalThis.__ccAlSar) return;
    globalThis.__ccAlSar = true; globalThis.__ccAl = 0;
    m.set('claudecode:oturum-al', (...a) => { globalThis.__ccAl++; return asil(...a); });
  });
  await w.locator(`.cc-oturum[data-oturum="${bitti}"]`).click();
  await bekle(300);
  await cagir('claudecode:kapat', akisId);
  await bekleKosul(async () => (await ozet(akisId))?.durum === 'kapandi', 8000, 'kapandı');
  await bekle(300);
  const alOnce = await u.evaluate(() => globalThis.__ccAl);
  await w.locator(`.cc-oturum[data-oturum="${akisId}"]`).click();
  await bekleKosul(() => w.evaluate(() => Number(document.querySelector('.cc-dokum')?.dataset.ogeSayisi ?? 0) > 0), 8000, 'yeniden yüklendi');
  const alSonra = await u.evaluate(() => globalThis.__ccAl);
  const yeniden = await w.evaluate(() => Number(document.querySelector('.cc-dokum')?.dataset.ogeSayisi ?? 0));
  kontrol('Düzeltme 1 (bellek): kapanmış + görünmeyen oturumun dökümü bırakıldı, seçilince yeniden yüklendi (aynı öğeler)', alSonra - alOnce === 1 && yeniden === aSonra, JSON.stringify({ yukleme: alSonra - alOnce, yeniden, aSonra }));

  // 5 000 olaylık oturum: sanallaştırma
  const uzunId = await yeniBaslat({ cwd: M, istem: 'hazırlık' });
  await sonucBekle(uzunId);
  await w.locator(`.cc-oturum[data-oturum="${uzunId}"]`).click();
  await bekle(500);
  const t0 = Date.now();
  await gonder('#uzun:2500 Bütün modülleri oku');
  await bekleKosul(async () => ((await ozet(uzunId))?.turSayisi ?? 0) >= 2 && (await ozet(uzunId))?.durum === 'bosta', 60000, 'uzun oturum');
  await bekle(800);
  const sanal = await w.evaluate(() => ({ toplam: Number(document.querySelector('.cc-dokum')?.dataset.hamOgeSayisi ?? 0), gorunen: Number(document.querySelector('.cc-dokum')?.dataset.ogeSayisi ?? 0), dom: document.querySelectorAll('.cc-dokum__oge').length }));
  const kaydirma = await w.evaluate(async () => {
    const d = document.querySelector('.cc-dokum');
    const sureler = [];
    for (let i = 0; i <= 40; i++) {
      const t = performance.now();
      d.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }));
      d.scrollTop = (d.scrollHeight - d.clientHeight) * (1 - i / 40);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      sureler.push(performance.now() - t);
    }
    return { enUzun: Math.max(...sureler), ort: sureler.reduce((a, b) => a + b, 0) / sureler.length, sona: Boolean(document.querySelector('.cc-dokum__sona')) };
  });
  kontrol('5 000+ olaylık oturum: döküm sanallaştırılmış (DOM’da az öğe; biten araçlar katlı satırda), baştan sona kaydırma akıcı, "En sona" düğmesi', sanal.toplam >= 2550 && sanal.gorunen < sanal.toplam && sanal.dom < 160 && kaydirma.enUzun < 120 && kaydirma.sona,
    `${sanal.toplam} öğe (görünen ${sanal.gorunen}) · DOM ${sanal.dom} · kaydırma adımı ort ${kaydirma.ort.toFixed(1)} ms, en uzun ${kaydirma.enUzun.toFixed(1)} ms · süre ${Date.now() - t0} ms`);
  await tekFoto('17-uzun-oturum', '5 000 olaylık oturum (baş)');

  // Azaltılmış hareket
  await gonder('#yavas:20 hareket denetimi');
  await bekleKosul(async () => (await ozet(uzunId))?.durum === 'calisiyor', 8000, 'çalışıyor (hareket)');
  await bekle(400);
  const nabiz = () => w.evaluate((id) => { const i = document.querySelector(`.cc-oturum[data-oturum="${id}"] .cc-hal i`); return i ? getComputedStyle(i).animationName : 'yok'; }, uzunId);
  const hareketOnce = await nabiz();
  await w.emulateMedia({ reducedMotion: 'reduce' });
  await bekle(200);
  const hareketSonra = await nabiz();
  kontrol('Azaltılmış hareket: "Çalışıyor" nabzı ve ışık süpürmesi durur', hareketOnce === 'cc-nabiz' && hareketSonra === 'none', `${hareketOnce} → ${hareketSonra}`);
  await w.emulateMedia({ reducedMotion: 'no-preference' });
  await cagir('claudecode:kes', uzunId);

  // ════════ İşler şeridi (12 Kas: şerit ekranın yarısını kaplıyordu) ════════
  {
    const yeniOturum = async (istem) => {
      await w.keyboard.press('Control+N');
      await w.waitForSelector('.cc-yeni-govde');
      await w.locator('.cc-yeni-kart .cc-secici').click();
      await w.locator('.secici__panel [role="option"]', { hasText: 'mavi-kus' }).first().click();
      await gonder(istem);
      await w.waitForSelector('.cc-oturum[aria-current="true"][data-hal]');
      return seciliId();
    };
    const sd = () => w.evaluate(() => {
      const s = document.querySelector('.cc-isler');
      if (!s) return null;
      const b = s.querySelector('.cc-isler__bas');
      const l = s.querySelector('.cc-isler__liste');
      return { boy: Math.round(s.getBoundingClientRect().height), acik: b.getAttribute('aria-expanded') === 'true', liste: l ? Math.round(l.getBoundingClientRect().height) : 0, pencere: innerHeight, ozet: s.querySelector('.cc-isler__ozet')?.textContent ?? '', suren: s.hasAttribute('data-suren'), satir: s.querySelectorAll('.cc-is').length, tasma: s.scrollWidth > s.clientWidth + 1 };
    });
    const baslikTikla = () => w.locator('.cc-isler__bas').click();
    // Hareket: .cc-isler içindeki animasyonlar (sonsuz olanlar, hareket edilen özellikler)
    const hareket = () => w.evaluate(() => {
      const s = document.querySelector('.cc-isler');
      const an = (s ? s.getAnimations({ subtree: true }) : []).filter((a) => a.playState === 'running');
      const ozellik = new Set();
      for (const a of an) for (const k of a.effect.getKeyframes()) for (const p of Object.keys(k)) if (!['offset', 'easing', 'composite', 'computedOffset'].includes(p)) ozellik.add(p);
      return { sonsuz: an.filter((a) => a.effect.getComputedTiming().iterations === Infinity).length, toplam: an.length, ozellik: [...ozellik] };
    });
    await temaYap('koyu'); await boyut(1440, 900); await bekle(300);

    // 1) #arkakabuk: arka planda süren kabuk işi → kapalı tek satır
    const kabukId = await yeniOturum('#arkakabuk Sunucuyu başlat');
    await w.waitForSelector('.cc-isler', { timeout: 15000 });
    await sonucBekle(kabukId);
    await bekle(500);
    let d = await sd();
    kontrol('İşler: arka planda süren iş varken şerit KAPALI ve tek satır (≤ 40 px, liste yok)', d && !d.acik && d.liste === 0 && d.boy <= 40 && /^1 iş sürüyor$/.test(d.ozet) && !d.tasma, JSON.stringify(d));
    const hk = await hareket();
    kontrol('İşler: kapalı hâlde nabız ışığı yalnız iş sürerken yanar (sonsuz animasyon yalnız opacity/transform)', d.suren && hk.sonsuz === 1 && hk.ozellik.every((p) => ['opacity', 'transform'].includes(p)), JSON.stringify(hk));
    await tekFoto('18a-isler-kapali', 'İşler şeridi (kapalı)', 'koyu', [1440, 900]);
    await baslikTikla(); await bekle(300);
    d = await sd();
    kontrol('İşler: başlığa tıklayınca liste açılır; açık liste pencere yüksekliğinin %26’sını aşmaz', d.acik && d.satir >= 1 && d.liste > 0 && d.liste <= Math.floor(d.pencere * 0.26) + 1, JSON.stringify(d));
    // Çıktı ve Durdur açık listede çalışır
    await w.locator('.cc-is .dgm', { hasText: 'Çıktı' }).first().click();
    await bekleKosul(() => w.evaluate(() => /satır \d+/.test(document.querySelector('.cc-is__cikti')?.textContent ?? '')), 8000, 'is çıktısı');
    kontrol('İşler: "Çıktı" düğmesi açık listede canlı çıktıyı gösterir', true, await w.locator('.cc-is__cikti').innerText());
    await w.locator('.cc-is .dgm', { hasText: 'Çıktıyı gizle' }).first().click();
    d = await sd();
    kontrol('İşler: çıktı açıkken de liste ≤ %26', d.liste <= Math.floor(d.pencere * 0.26) + 1, JSON.stringify(d));
    await w.locator('.cc-is .dgm', { hasText: 'Çıktı' }).first().click(); await bekle(900);
    await tekFoto('18b-isler-acik', 'İşler şeridi (açık, çıktı)', 'koyu', [1440, 900]);
    await w.locator('.cc-is .dgm', { hasText: 'Çıktıyı gizle' }).first().click();
    await w.locator('[data-is-durdur]').first().click();
    await bekleKosul(() => w.evaluate(() => !document.querySelector('.cc-is[data-durum="suruyor"]')), 10000, 'is durdu');
    d = await sd();
    kontrol('İşler: "Durdur" işi durdurur (satır artık sürmüyor, Durdur düğmesi yok)', d.satir === 1 && !(await w.locator('[data-is-durdur]').count()), JSON.stringify(d));
    await baslikTikla(); await bekle(300);
    d = await sd();
    const hb = await hareket();
    kontrol('İşler: biten iş kapalı hâlde yalnız "1 iş bitti" (tek satır ≤ 40 px)', !d.acik && d.liste === 0 && d.boy <= 40 && /^1 iş bitti$/.test(d.ozet) && !d.suren, JSON.stringify(d));
    kontrol('İşler: boşta (iş yok) şeritte hiçbir animasyon çalışmaz', hb.toplam === 0 && hb.sonsuz === 0, JSON.stringify(hb));
    await tekFoto('18c-isler-bitti', 'İşler şeridi (bitti, kapalı)', 'koyu', [1440, 900]);

    // 2) #onplan: ön planda süren iş → liste kendiliğinden açık
    const onId = await yeniOturum('#onplan:40 testleri izle');
    await w.waitForSelector('.cc-isler[data-acik]', { timeout: 15000 });
    await bekle(500);
    d = await sd();
    kontrol('İşler: ön planda iş varken liste kendiliğinden AÇIK gelir, ≤ %26', d.acik && d.satir === 1 && d.liste <= Math.floor(d.pencere * 0.26) + 1 && /Arka plana al/.test(await w.locator('.cc-is').innerText()), JSON.stringify(d));
    await baslikTikla(); await bekle(300);
    d = await sd();
    kontrol('İşler: açık gelen liste kullanıcı kapatınca kapanır (tek satır) ve yeniden açılır', !d.acik && d.boy <= 40 && (await baslikTikla(), await bekle(300), (await sd()).acik), JSON.stringify(d));
    // Azaltılmış hareket + odak halkası
    await w.emulateMedia({ reducedMotion: 'reduce' }); await bekle(200);
    const hr = await hareket();
    const ok = await w.evaluate(() => getComputedStyle(document.querySelector('.cc-isler__bas > svg')).transitionDuration);
    kontrol('İşler: azaltılmış harekette şeritte animasyon ve ok geçişi yok', hr.toplam === 0 && /^(0|0\.001)s(, (0|0\.001)s)*$/.test(ok), `${JSON.stringify(hr)} ok=${ok}`);
    await w.emulateMedia({ reducedMotion: 'no-preference' });
    await w.locator('.cc-isler__bas').focus(); await w.keyboard.press('Tab'); await w.keyboard.press('Shift+Tab');
    const halka = await w.evaluate(() => { const c = getComputedStyle(document.querySelector('.cc-isler__bas')); return { genislik: c.outlineWidth, stil: c.outlineStyle, odakta: document.activeElement?.classList.contains('cc-isler__bas') }; });
    kontrol('İşler: klavye odağında görünür odak halkası', halka.odakta && halka.stil !== 'none' && parseFloat(halka.genislik) >= 2, JSON.stringify(halka));
    // Görüntüler: koyu/açık × dar/geniş, kapalı ve açık (ön planda iş sürerken); ölçüm: okunurluk + taşma
    const sorunI = [];
    for (const t of ['koyu', 'acik']) {
      await temaYap(t);
      for (const [en, boy] of [[1080, 718], [1440, 900]]) {
        await boyut(en, boy); await bekle(450);
        for (const acikMi of [true, false]) {
          if ((await sd()).acik !== acikMi) { await baslikTikla(); await bekle(250); }
          await temizle(en, boy); await bekle(200);
          const e = `${TEMA_ADI[t]} ${en}×${boy} ${acikMi ? 'açık' : 'kapalı'}`;
          const x = await sd();
          const o = await w.evaluate(OLC, '.cc-isler');
          const s = okunurlukSorunlari(t, o);
          sorunI.push(...[...s.kucuk, ...s.kontrast, ...s.tasan].map((m) => `[${e}] ${m}`), ...s.anahtar.map((m) => `[${e}] anahtar ${m}`));
          if (x.tasma) sorunI.push(`[${e}] yatay taşma`);
          if (!acikMi && x.boy > 40) sorunI.push(`[${e}] kapalı yükseklik ${x.boy}`);
          if (acikMi && x.liste > Math.floor(x.pencere * 0.26) + 1) sorunI.push(`[${e}] açık liste ${x.liste}`);
          const f = path.join(cikti, `18-isler-${t}-${en}x${boy}-${acikMi ? 'acik' : 'kapali'}.png`);
          await w.screenshot({ path: f });
        }
      }
    }
    kontrol('İşler: koyu/açık × 1080 (pencere alt sınırı)/1440 × kapalı/açık: yazı ≥ 12 px, kontrast, taşma yok, kapalı ≤ 40 px, açık ≤ %26', !sorunI.length, [...new Set(sorunI)].join(' | '));
    // Ön plandaki işi Durdur ile bitir
    await temaYap('koyu'); await boyut(1440, 900); await bekle(300);
    if (!(await sd()).acik) await baslikTikla();
    await w.locator('.cc-is .dgm', { hasText: 'Arka plana al' }).click();
    await bekleKosul(() => w.evaluate(() => document.querySelector('.cc-is')?.hasAttribute('data-arkada')), 10000, 'arka plana alındı');
    kontrol('İşler: "Arka plana al" ön plandaki işi arkaya alır (düğme kaybolur)', !(await w.locator('.cc-is .dgm', { hasText: 'Arka plana al' }).count()));
    await w.locator('[data-is-durdur]').first().click();
    await bekleKosul(async () => !(await w.locator('.cc-is[data-durum="suruyor"]').count()), 10000, 'on plan durdu');
    kontrol('İşler: arkaya alınan iş "Durdur" ile biter', true);
    await cagir('claudecode:kes', onId).catch(() => undefined);
  }

  kontrol('Arayüzde konsol hatası yok', hatalar.length === 0, hatalar.slice(0, 4).join(' | '));

  // ════════ Temas sayfaları ════════
  const sahneler = [...new Map(fotolar.filter((f) => !f.ek).map((f) => [f.sahne, f.baslik])).entries()];
  const sutunlar = TEMALAR.flatMap((t) => BOYUTLAR.map(([e, b]) => ({ t, b: `${e}×${b}` })));
  const temasYap = async (dosyaAdi, baslik, satirlar, ekler = []) => {
    const hucre = (f) => (f ? `<img src="data:image/png;base64,${fs.readFileSync(f.dosya).toString('base64')}" style="width:100%;display:block;border-radius:8px;box-shadow:0 0 0 1px #2a2a2a">` : '<div></div>');
    const html = `<div id="temas" style="padding:24px;background:#0d0d0d;font-family:system-ui,sans-serif;color:#eee;width:${sutunlar.length * 330 + 190}px">
      <div style="font-size:20px;font-weight:650;margin-bottom:16px">${baslik}</div>
      <div style="display:grid;grid-template-columns:170px repeat(${sutunlar.length},320px);gap:12px 10px;align-items:center">
        <div></div>${sutunlar.map((c) => `<div style="font-size:13px;font-weight:650;color:#bbb">${TEMA_ADI[c.t]} · ${c.b}</div>`).join('')}
        ${satirlar.map(([s, b]) => `<div style="font-size:13px;font-weight:600;color:#ddd">${b}</div>${sutunlar.map((c) => hucre(fotolar.find((f) => f.sahne === s && f.tema === c.t && f.boyut === c.b))).join('')}`).join('')}
      </div>
      ${ekler.length ? `<div style="font-size:16px;font-weight:650;margin:22px 0 10px">Ek görüntüler</div><div style="display:grid;grid-template-columns:repeat(3,640px);gap:12px">${ekler.map((f) => `<div><div style="font-size:12px;color:#bbb;margin-bottom:4px">${f.baslik} · ${TEMA_ADI[f.tema]} · ${f.boyut}</div>${hucre(f)}</div>`).join('')}</div>` : ''}
    </div>`;
    await w.evaluate((h) => {
      document.documentElement.style.cssText = 'height:auto;background:#0d0d0d';
      document.body.style.cssText = 'height:auto;overflow:visible;background:#0d0d0d;margin:0';
      document.body.innerHTML = h;
    }, html);
    await bekle(900);
    await w.locator('#temas').screenshot({ path: path.join(cikti, dosyaAdi) });
    console.log('📸', path.join(cikti, dosyaAdi));
  };
  await temaYap('koyu');
  await temasYap('temas-1.png', 'Claude Code çalışma alanı (Görev 28) — 1/2', sahneler.slice(0, 7));
  await temasYap('temas-2.png', 'Claude Code çalışma alanı (Görev 28) — 2/2', sahneler.slice(7), fotolar.filter((f) => f.ek));

  // ── Kapanış: sahte süreç kalmaz ──
  const kapanis = u.waitForEvent('close', { timeout: 25000 }).catch(() => undefined);
  await u.evaluate(({ app }) => { setTimeout(() => app.quit(), 10); }).catch(() => undefined);
  await kapanis;
  u = null;
  await bekle(600);
  const kalan = pidler().filter(yasiyor);
  kontrol('Kapanışta sahte Claude Code süreci kalmadı', kalan.length === 0, kalan.join(','));
} catch (h) {
  kontrol('HATA', false, h.stack);
} finally {
  if (u) await u.close().catch(() => undefined);
  for (const p of pidler()) if (yasiyor(p)) { try { process.kill(p); } catch { /* yok */ } }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* git kilitleri */ }
  if (bilgi.length) console.log(`ℹ️  ${bilgi.length} görüntüde "…" ile kısaltılan tek satır (yol/komut özeti) var — bilgi`);
  const k = sonuclar.filter((x) => !x.tamam).length;
  console.log(`\n${sonuclar.length - k}/${sonuclar.length} geçti · görüntüler: ${cikti}`);
  process.exitCode = k ? 1 : 0;
}
