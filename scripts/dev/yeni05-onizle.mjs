// 0.5.0 yeni ekranların görsel denetimi: Claude Code sayfası (SENTETİK oturumlar) ve Ayarlar → Gizlilik, yerel model (kurulu, açık,
// "Dene" sonucu), koyu ve açık temada. Model çağrısı yalnız yerel (Bonsai); anahtar yok, FUBER_DEMO.
// Çalıştır: npm run build && node scripts/dev/yeni05-onizle.mjs [yerel-kök|-] [çıktı-klasörü]
// Yerel kök verilmezse ("-" ya da yok) boş geçici klasör kullanılır: yerel model kurulu değildir, "Dene" adımı atlanır (Claude Code ve
// Etkinlik görüntüleri yine alınır; 0.10 Görev 1: Beyin sayfası kalktı). Kullanıcının kurulu uygulamasının modeline
// (%APPDATA%\Fuber AI\yerel) bilerek dokunulmaz.
// Başarısız denetim ya da konsol hatası çıkış kodu 1.
import { KURULUM_SURUMU } from '../../src/shared/kurulum-adimlari.ts';
import { _electron as electron } from 'playwright-core';
import electronYolu from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const kok = path.resolve(import.meta.dirname, '../..');
const yerelKok = process.argv[2] && process.argv[2] !== '-' ? path.resolve(process.argv[2]) : fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-onizle05-yerel-'));
const cikti = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'fuber-yeni05'));
fs.mkdirSync(cikti, { recursive: true });
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-onizle05-'));
const claudeDiz = path.join(tmp, '.claude');
const oturum = (id, proje, baslik, istemler, saatOnce, dal = 'main') => {
  // Görüntüde gerçek kullanıcı klasörü görünmesin: sentetik, var olmayan bir yol (önizleme terminal açmaz).
  const cwd = `D:\\Projeler\\${proje}`;
  const k = path.join(claudeDiz, 'projects', cwd.replace(/[:\\/ ]/g, '-'));
  fs.mkdirSync(k, { recursive: true });
  const t0 = Date.now() - saatOnce * 3600_000;
  const s = istemler.map((m, i) => ({ type: 'user', cwd, gitBranch: dal, sessionId: id, timestamp: new Date(t0 + i * 120_000).toISOString(), message: { role: 'user', content: m } }));
  s.push({ type: 'ai-title', sessionId: id, aiTitle: baslik });
  fs.writeFileSync(path.join(k, `${id}.jsonl`), s.map((x) => JSON.stringify(x)).join('\n') + '\n');
};
oturum('a1000000-0000-4000-8000-000000000001', 'kuzey-panel', 'Stripe ödeme webhook imza hatası', ['Stripe webhook 400 dönüyor, imza doğrulaması patlıyor', 'test ortamında tekrar dene', 'şimdi canlıya alalım mı'], 3, 'odeme-webhook');
oturum('a1000000-0000-4000-8000-000000000002', 'kuzey-panel', 'Kokpit finans sayfası', ['finans sayfasına Vapi maliyetini ekle'], 30);
oturum('a1000000-0000-4000-8000-000000000003', 'mavi-web','Landing sayfası 3B sahne geçişleri', ['beyin render sahnesini GSAP ile pinle', 'mobilde taşma var'], 50);
oturum('a1000000-0000-4000-8000-000000000004', 'iptv', 'Android TV kumanda uyumluluğu', ['kumanda ile odak gezinmesi bozuk'], 140, 'tv');
oturum('a1000000-0000-4000-8000-000000000005', 'fuber-ai', 'Düşünme motoru ve beyin haritası', ['gün kaydı ajanları', 'beyin sayfası animasyonu'], 1, 'worktree-fuber-ai');

const veri = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-onizle05-veri-'));
fs.writeFileSync(path.join(veri, 'ayarlar.json'), JSON.stringify({
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: '0.9.0', kullaniciAdi: 'Deniz', hitap: 'Bey', baslangictaAc: false, ses: { uyandirma: false, seslendirme: false }, proaktif: { etkin: false },
  yerel: { etkin: true, model: 'bonsai2-27b', gpu: 'otomatik', gorevler: { gundelik: true, eslikci: true, notTutucu: true, raporcu: true, kokpit: true, siniflandirma: true }, hitapAlgila: true, hizliSes: 'yerel' },
  claudeCode: { etkin: true, terminal: 'konsol', tamYetki: true }, mod: 'gelistirici', // Claude Code sayfası yalnız Geliştirici modunda
}));
const u = await electron.launch({
  executablePath: electronYolu, args: [kok],
  env: { ...process.env, FUBER_DEMO: '1', FUBER_VERI: veri, FUBER_BELGELER: veri, FUBER_MODEL_DIZINI: yerelKok, FUBER_CLAUDE_DIZIN: claudeDiz, FUBER_CLAUDE_KOMUT: JSON.stringify([process.execPath, '-e', '0']), FUBER_CLAUDE_GIZLI: '1' },
  timeout: 60000,
});
const hatalar = [];
try {
  let w;
  for (let i = 0; i < 120 && !w; i++) { w = u.windows().find((x) => x.url().includes('index.html')); if (!w) await bekle(250); }
  await u.evaluate(({ BrowserWindow }) => { const b = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('index.html')); b?.unmaximize(); b?.setContentSize(1440, 900); });
  await w.waitForSelector('.kokpit', { timeout: 30000 });
  w.on('pageerror', (e) => hatalar.push(String(e)));
  w.on('console', (m) => { if (m.type() === 'error') hatalar.push(m.text()); });
  const foto = async (ad, hedef) => { await (hedef ?? w).screenshot({ path: path.join(cikti, `${ad}.png`) }); console.log('📸', ad); };
  const yerelDurum = await w.evaluate(() => window.fuber.cagir('yerel:durum'));
  const yerelVar = yerelDurum.kurulu.calistirici && yerelDurum.kurulu.model;
  if (yerelVar) {
    for (let i = 0; i < 120 && !(await w.evaluate(() => window.fuber.cagir('yerel:durum'))).sunucu.calisiyor; i++) await bekle(500);
    const dene = await w.evaluate(() => window.fuber.cagir('yerel:dene', 'Fuber buralarda mısın?'));
    console.log('dene:', dene.yanit, dene.dusunmeMs, 'ms');
  } else console.log('ℹ️  yerel model kurulu değil (yerel kök verilmedi): "Dene" adımı atlanır');
  const denetimler = [];
  const kontrol = (ad, tamam, ayrinti = '') => { denetimler.push(Boolean(tamam)); console.log(`${tamam ? '✅' : '❌'} ${ad}${ayrinti ? ` — ${ayrinti}` : ''}`); };

  for (const tema of ['koyu', 'acik']) {
    await w.evaluate((t) => window.fuber.cagir('ayarlar:kaydet', { gorunum: { tema: t } }), tema);
    await bekle(800);
    await w.locator('.ray__dgm:has-text("Claude Code")').click();
    // Görev 28: üç bölmeli çalışma alanı (geçmiş oturum seçilir, yazma kutusuna komut yazılır; gönderilmez).
    await w.waitForSelector('.cc-oturum--gecmis', { timeout: 15000 });
    await w.locator('.cc-oturum--gecmis:has-text("Stripe")').click();
    await w.locator('.cc-yazici textarea').fill('İmza doğrulamasını düzelt ve testleri çalıştır.');
    await bekle(400);
    kontrol(`${tema}: geçmiş oturum seçildi, başlık ve yazma kutusu hazır`, /Stripe ödeme webhook/.test(await w.locator('.cc-oturum-bas h2').innerText()) && (await w.locator('.cc-yazici textarea').inputValue()).startsWith('İmza'));
    await foto(`${tema}-claude-code`);
    await w.locator('.cc-ara input').fill('landing gsap');
    await bekle(900);
    const bulunan = await w.evaluate(() => [...document.querySelectorAll('.cc-oturum .cc-oturum__baslik')].map((e) => e.textContent.trim()));
    kontrol(`${tema}: oturum arama süzer`, bulunan.length === 1 && /Landing/.test(bulunan[0]), JSON.stringify(bulunan));
    await foto(`${tema}-claude-code-ara`);
    await w.locator('.cc-ara input').fill('');
    // Ayarlar → Gizlilik → yerel model, Hızlı yanıt (çapa: ayar kimliği 'yerel-dene' grubu açar ve kaydırır).
    await w.evaluate(() => { location.hash = 'yerel-dene'; });
    await w.locator('.ray__dgm:has-text("Ayarlar")').click();
    await bekle(700);
    if (yerelVar) {
      await w.locator('.yb__dene input').fill('Ee Fuber nasılsın, nasıl gidiyor?');
      await w.locator('.yb__dene button').click();
      await w.waitForSelector('.yb__sonuc', { timeout: 20000 }).catch(() => undefined);
    }
    await bekle(400);
    await foto(`${tema}-yerel-model`, w.locator('#gizlilik'));
    // 0.10 Görev 1 (D1): Beyin sayfası kalktı; yerinde 2B "Etkinlik" (ray kimliği 'etkinlik').
    await w.locator('.ray__dgm[data-tur="etkinlik"]').click();
    await w.waitForSelector('.etkinlik', { timeout: 15000 });
    await bekle(1000);
    kontrol(`${tema}: Etkinlik sayfası açıldı (Beyin sayfası yok)`, (await w.locator('.etkinlik').count()) === 1 && (await w.locator('.ray__dgm:has-text("Beyin")').count()) === 0);
    await foto(`${tema}-etkinlik`);
  }
  kontrol('konsol hatası yok', !hatalar.length, hatalar.slice(0, 4).join(' | '));
  console.log(`\n${denetimler.filter(Boolean).length}/${denetimler.length} geçti · görüntüler: ${cikti}`);
  process.exitCode = denetimler.every(Boolean) ? 0 : 1;
} catch (e) {
  console.log('❌ HATA', e.stack);
  process.exitCode = 1;
} finally {
  await u.close().catch(() => undefined);
  fs.rmSync(veri, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
}
