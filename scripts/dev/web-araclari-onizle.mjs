// 0.14 T14 — web_ara ve sayfa_oku GERÇEK uygulamada (Electron, arka plan test kipi FUBER_DEMO; görünür pencere ve gerçek fare/klavye YOK).
// Gerçek internet ve gerçek arama motoru YOK: DuckDuckGo/Bing yerine yerel sahte sunucu (FUBER_TEST_WEB_ARAMA), sayfa/PDF yerel sahte sunucu;
// o sunucunun kapısı yalnız FUBER_TEST_SAYFA_IZIN ile "genel" sayılır (özel adres kuralı başka her yerde sürer).
// Araçlar `__fuberAracDene` kancasıyla GERÇEK yollarından çağrılır (cc-motor-onizle.mjs deseni; model çağrılmaz). Denetimler (başarısızsa çıkış 1):
//   - web_ara: sunucuda sağlayıcı yok (hesap yok) → bilgisayardan (sahte DuckDuckGo), numaralı kaynaklar, kart özeti; DuckDuckGo boş → Bing
//   - sayfa_oku: HTML (Node'da çekilir, pencere/JavaScript yok: görsel isteği sunucuya HİÇ gelmez), düz metin parçaları, GERÇEK pdf-parse ile PDF
//   - genel adresten özel adrese yönlendirme reddedilir (özel adrese istek atılmaz), file:/localhost reddedilir; alert açılmaz, JavaScript isteyen sayfa tanınır
// Çalıştır: npm run build:main && node scripts/dev/web-araclari-onizle.mjs
import { _electron as electron } from 'playwright-core';
import electronYolu from 'electron';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KURULUM_SURUMU } from '../../src/shared/kurulum-adimlari.ts';

const kok = path.resolve(import.meta.dirname, '../..');
if (!fs.existsSync(path.join(kok, 'dist', 'main', 'main.js'))) { console.error('dist yok: önce npm run build:main'); process.exit(1); }
const sonuclar = [];
const kontrol = (ad, tamam, ayrinti = '') => { sonuclar.push({ ad, tamam: Boolean(tamam) }); console.log(`${tamam ? 'OK  ' : 'FAIL'} ${ad}${ayrinti ? ` — ${String(ayrinti).slice(0, 400)}` : ''}`); };
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

/** Geçerli en küçük PDF (xref ofsetleri hesaplanır): tek sayfa, "Merhaba PDF dunyasi" metni. */
function sahtePdf() {
  const nesneler = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const akis = 'BT /F1 18 Tf 20 80 Td (Merhaba PDF dunyasi) Tj ET';
  nesneler[3] = `<< /Length ${akis.length} >>\nstream\n${akis}\nendstream`;
  let s = '%PDF-1.4\n';
  const ofs = [];
  nesneler.forEach((n, i) => { ofs.push(s.length); s += `${i + 1} 0 obj\n${n}\nendobj\n`; });
  const xref = s.length;
  s += `xref\n0 ${nesneler.length + 1}\n0000000000 65535 f \n${ofs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  s += `trailer\n<< /Size ${nesneler.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(s, 'latin1');
}

const ddgHtml = fs.readFileSync(path.join(kok, 'tests', 'veri', 'ddg.html'), 'utf8');
const bingHtml = fs.readFileSync(path.join(kok, 'tests', 'veri', 'bing.html'), 'utf8');
const gelenler = [];
let ddgBos = false;
const sunucu = http.createServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://127.0.0.1');
  gelenler.push(u.pathname);
  const html = (g) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(g); };
  if (u.pathname === '/html/') return html(ddgBos ? '<html><body>No results.</body></html>' : ddgHtml);
  if (u.pathname === '/search') return html(bingHtml);
  if (u.pathname === '/sayfa') return html(`<!doctype html><html><head><title>Örnek Sayfa Başlığı</title></head><body><h1>Merhaba Fuber</h1><p>Bu bir deneme paragrafıdır.</p><img src="/gorsel.png"><script>document.body.insertAdjacentHTML('beforeend','<p id="js">Betikle eklendi.</p>')</script></body></html>`);
  if (u.pathname === '/alert') return html('<html><body><script>alert("kutu"); confirm("emin misin")</script>Gerçek metin</body></html>');
  if (u.pathname === '/js') return html('<html><body><noscript>You need to enable JavaScript to run this app.</noscript><div id="root"></div><script src="/app.js"></script></body></html>');
  if (u.pathname === '/gorsel.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(Buffer.from([137, 80, 78, 71])); }
  if (u.pathname === '/uzun') { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); return res.end(Array.from({ length: 300 }, (_, i) => `K${String(i).padStart(3, '0')}${'x'.repeat(94)}`).join('\n\n')); }
  if (u.pathname === '/belge.pdf') { res.writeHead(200, { 'content-type': 'application/pdf' }); return res.end(sahtePdf()); }
  if (u.pathname === '/ozele') { res.writeHead(302, { location: 'http://10.0.0.5/gizli' }); return res.end(); }
  res.writeHead(404).end();
});
await new Promise((c) => sunucu.listen(0, '127.0.0.1', c));
const kapi = sunucu.address().port;
const TABAN = `http://127.0.0.1:${kapi}`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-web-onizle-'));
const veri = path.join(tmp, 'veri'), ev = path.join(tmp, 'ev');
for (const d of [veri, ev, path.join(veri, 'belgeler')]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(veri, 'ayarlar.json'), JSON.stringify({
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: '0.9.0', kullaniciAdi: 'Deniz', hitap: 'Deniz', baslangictaAc: false, mod: 'gelistirici',
  ses: { uyandirma: false, seslendirme: false }, proaktif: { etkin: false }, gorunum: { tema: 'koyu', adaSessiz: false },
}));
const ortam = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('FUBER_SIR_') && k !== 'FUBER_GORUNUR'));
Object.assign(ortam, {
  FUBER_DEMO: '1', FUBER_VERI: veri, FUBER_BELGELER: path.join(veri, 'belgeler'), FUBER_TEST_TAM_EKRAN: '0', USERPROFILE: ev, HOME: ev,
  FUBER_TEST_WEB_ARAMA: TABAN, FUBER_TEST_SAYFA_IZIN: `127.0.0.1:${kapi}`,
});

let u;
try {
  u = await electron.launch({ executablePath: electronYolu, args: [kok], env: ortam, timeout: 60000 });
  for (let i = 0; i < 120; i++) { if (await u.evaluate(() => typeof globalThis.__fuberAracDene === 'function')) break; await bekle(250); }
  const dene = (ad, girdi) => u.evaluate((_e, [a, g]) => globalThis.__fuberAracDene(a, g, 1), [ad, girdi]);
  const yolSayisi = (y) => gelenler.filter((x) => x === y).length;

  // ── web_ara ──
  const a = await dene('web_ara', { sorgu: 'fuber ai masaüstü' });
  kontrol('web_ara: hesap yok → bilgisayardan (sahte DuckDuckGo), numaralı kaynaklar, kart özeti "4 kaynak"', !a.hata && a.ozet === '4 kaynak' && /bu bilgisayardan arama/.test(a.icerik) && /\[1\] Fuber AI — masaüstü yapay zekâ asistanı\n {4}https:\/\/fuber\.ai\/masaustu/.test(a.icerik), a.icerik.slice(0, 200));
  kontrol('DuckDuckGo sonuç verdi → Bing sorulmadı', yolSayisi('/html/') === 1 && yolSayisi('/search') === 0);
  ddgBos = true;
  const b = await dene('web_ara', { sorgu: 'x' });
  kontrol('DuckDuckGo boş → Bing sayfası ayrıştı', !b.hata && /\[1\] Fuber AI · Masaüstü asistan/.test(b.icerik) && yolSayisi('/search') === 1, b.icerik.slice(0, 160));

  // ── sayfa_oku ──
  const h = await dene('sayfa_oku', { adres: `${TABAN}/sayfa` });
  kontrol('sayfa_oku HTML: Node üzerinden çekilip metne çevrildi (başlık, metin); sayfa betiği ÇALIŞTIRILMADI', !h.hata && /SAYFA: Örnek Sayfa Başlığı/.test(h.icerik) && /Merhaba Fuber/.test(h.icerik) && !/Betikle eklendi/.test(h.icerik) && /<sayfa_icerigi>/.test(h.icerik), h.icerik.slice(0, 300));
  const pencere0 = await u.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  const al = await dene('sayfa_oku', { adres: `${TABAN}/alert` });
  const js = await dene('sayfa_oku', { adres: `${TABAN}/js` });
  kontrol('alert/confirm içeren sayfa: kutu açılmaz, yeni pencere yok, yalnız metin gelir', !al.hata && /Gerçek metin/.test(al.icerik) && !al.icerik.includes('emin misin') && (await u.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)) === pencere0, al.icerik.slice(0, 200));
  kontrol('JavaScript isteyen sayfa → Fuber Tarayıcı notu', js.hata === true && js.icerik === 'Bu sayfa içerik için JavaScript istiyor; Fuber Tarayıcı ile açabilirim.', js.icerik);
  kontrol('görseller kapalı: sunucu görsel isteği hiç görmedi', yolSayisi('/gorsel.png') === 0, gelenler.join(' '));
  const u1 = await dene('sayfa_oku', { adres: `${TABAN}/uzun`, parca: 2 });
  kontrol('sayfa_oku düz metin: parca=2 → ikinci parça, "Parça 2/3"', !u1.hata && /K120/.test(u1.icerik) && !/K000/.test(u1.icerik) && /Parça 2\/3/.test(u1.icerik), u1.icerik.slice(-120));
  const p = await dene('sayfa_oku', { adres: `${TABAN}/belge.pdf` });
  kontrol('sayfa_oku PDF: gerçek pdf-parse ile metin', !p.hata && /Merhaba PDF dunyasi/.test(p.icerik) && /TÜR: pdf/.test(p.icerik), p.icerik.slice(0, 300));

  // ── özel adres kuralları (Node http + bağlantı anında IP denetimi) ──
  const oz = await dene('sayfa_oku', { adres: `${TABAN}/ozele` });
  kontrol('genel adresten özel adrese yönlendirme reddedilir', oz.hata === true && /yerel ağın içinde/.test(oz.icerik), oz.icerik);
  for (const adres of ['file:///C:/Windows/win.ini', 'http://localhost:1/', 'http://192.168.1.1/']) {
    const r = await dene('sayfa_oku', { adres });
    kontrol(`reddedilir: ${adres}`, r.hata === true, r.icerik);
  }

  // Gizli denetimi (araç listesinde yok, süren istek kesilir) tests/web-araclari.test.ts'te gerçek ayarlarla yapılır: uygulama Gizli açık başlatılırsa
  // açılış denetimi (yerel model hazır değilse Gizli kapanır) onu geri aldığından önizlemede sınanamaz.
} catch (e) {
  kontrol('önizleme çalıştı', false, e?.stack ?? e);
} finally {
  try { await u?.close(); } catch { /* kapanış */ }
  sunucu.closeAllConnections();
  sunucu.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* geçici */ }
}
const kotu = sonuclar.filter((x) => !x.tamam);
console.log(`\n${sonuclar.length - kotu.length}/${sonuclar.length} denetim geçti`);
process.exit(kotu.length ? 1 : 0);
