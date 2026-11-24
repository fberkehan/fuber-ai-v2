// Tema + sohbet balonları + kokpit ızgarası görsel denetimi (koyu, açık, Şeffaf, Otomatik; 0.13 T13: Şeffaf (cam) geri geldi — bu betik gerçek
// pencerenin piksellerini, DWM malzemesini ve okunurluğu ölçer; kurulum / açılış cam temada da opak). Ağ YOK, anahtar YOK: geçici FUBER_VERI,
// FUBER_DEMO (yapay zekâ planlaması kapalı), sentetik demo verisi ("Deniz"; gerçek kişi yok). 'sohbet:gonder' ana
// süreçte etkisizleştirilir; canlı tur (araç adımları + onay kartı) ana süreçten gelmiş gibi yayınlanır. Tema, gerçek
// yoldan değişir: ayarlar:kaydet → ana süreç nativeTheme + 'ayarlar:degisti' → pencereler.
// Çalıştır: npm run build && node scripts/dev/tema-onizle.mjs [çıktı-klasörü]
import { KURULUM_SURUMU } from '../../src/shared/kurulum-adimlari.ts';
import { _electron as electron } from 'playwright-core';
import electronYolu from 'electron';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { demoVerisiKur } from './demo-veri.mjs';
import { camDestekli } from '../../src/shared/tema-cozum.ts';
import { TANITIM_SURUMU } from '../../src/shared/tanitim.ts';
import { renkOku, kontrastOrani, ustune, BEYAZ, SIYAH } from './kontrast.mjs';

const kok = path.resolve(import.meta.dirname, '../..');
const cikti = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'fuber-tema-onizle'));
fs.mkdirSync(cikti, { recursive: true });
const veri = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-tema-ui-'));
fs.mkdirSync(path.join(veri, 'belgeler'), { recursive: true });
fs.writeFileSync(path.join(veri, 'ayarlar.json'), JSON.stringify({
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: TANITIM_SURUMU, kullaniciAdi: 'Deniz', hitap: 'Deniz', baslangictaAc: false,
  ses: { uyandirma: false, seslendirme: false }, proaktif: { etkin: false }, gorunum: { tema: 'koyu' },
}));
// Ortamdaki olası anahtarlar bu sürece geçmesin (ağ isteği olmasın). Tam ekran sahte '0': ada gerçek girdi yardımcısını açmaz,
// sonuç makinenin o anki tam ekran durumuna bağlı olmaz.
const ortam = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('FUBER_SIR_')));
Object.assign(ortam, { FUBER_DEMO: '1', FUBER_VERI: veri, FUBER_BELGELER: path.join(veri, 'belgeler'), FUBER_BILGISAYAR_ADI: 'DENIZ-PC', FUBER_TEST_TAM_EKRAN: '0' });
const ac = () => electron.launch({ executablePath: electronYolu, args: [kok], env: ortam, timeout: 60000 });
const pencere = async (u, ad) => {
  for (let i = 0; i < 120; i++) { const w = u.windows().find((x) => x.url().includes(ad)); if (w) return w; await new Promise((r) => setTimeout(r, 250)); }
  throw new Error(`${ad} yok`);
};

// 1) Şemayı uygulama kursun.
let u = await ac();
await (await pencere(u, 'index.html')).waitForSelector('.kokpit', { timeout: 30000 });
await u.close();

// 2) Sentetik veri + KALABALIK yerleşim (planlayıcının dağınık önerilerine benzer: 5, 3, 7 gibi genişlikler, karışık boylar).
demoVerisiKur(veri);
{
  const vt = new DatabaseSync(path.join(veri, 'fuber.db'));
  vt.prepare("UPDATE ozel_kartlar SET baslik = ?, veri = ? WHERE id = 'hafta'").run('Beta büyüyor', JSON.stringify({ metrikler: [{ ad: 'beta kullanıcısı', deger: '340' }, { ad: 'haftalık artış', deger: '+18%' }, { ad: 'aktif kafe', deger: '12' }] }));
  const duzen = JSON.parse(String(vt.prepare('SELECT duzen FROM kokpit WHERE id = 1').get().duzen));
  duzen.kartlar = [
    { id: 'zihin', tip: 'zihin', kolon: 1, genislik: 12, yukseklik: 'k' }, // üst bant: tek başına, tam genişlik (izgara.ts zorlar)
    { id: 'hatirlatici', tip: 'hatirlatici', kolon: 1, genislik: 4, yukseklik: 'o' },
    { id: 'eposta', tip: 'eposta', genislik: 5, yukseklik: 'o' },
    { id: 'plan', tip: 'plan', genislik: 3, yukseklik: 'o' },
    { id: 'dikkat', tip: 'dikkat', genislik: 4, yukseklik: 'k', baslik: 'Dikkat' },
    { id: 'meseleler', tip: 'meseleler', genislik: 5, yukseklik: 'o' },
    { id: 'dusunme', tip: 'dusunme', genislik: 7, yukseklik: 'k' },
    { id: 'ozel:hafta', tip: 'ozel', genislik: 4, yukseklik: 'k', onem: 'olumlu' },
    { id: 'whatsapp', tip: 'whatsapp', genislik: 4, yukseklik: 'k' },
    { id: 'oneriler', tip: 'oneriler', genislik: 4, yukseklik: 'k' },
    { id: 'projeler', tip: 'projeler', genislik: 6, yukseklik: 'k' },
    { id: 'sohbetler', tip: 'sohbetler', genislik: 6, yukseklik: 'k' },
    { id: 'hafiza', tip: 'hafiza', genislik: 7, yukseklik: 'k' },
    { id: 'arac_kiti', tip: 'arac_kiti', genislik: 5, yukseklik: 'k' },
  ];
  vt.prepare('UPDATE kokpit SET duzen = ? WHERE id = 1').run(JSON.stringify(duzen));
  vt.close();
}

// 3) Uygulama
u = await ac();
const w = await pencere(u, 'index.html');
const hatalar = [];
w.on('pageerror', (e) => hatalar.push(String(e)));
w.on('console', (m) => { if (m.type() === 'error') hatalar.push(m.text()); });
const boyut = (en, boy) => u.evaluate(({ BrowserWindow }, [e, b]) => { const x = BrowserWindow.getAllWindows().find((p) => p.webContents.getURL().includes('index.html')); x?.unmaximize(); x?.setContentSize(e, b); }, [en, boy]);
await boyut(1440, 900);
await w.waitForSelector('.kokpit', { timeout: 30000 });

// Gün kaydı kartları için sentetik veri (ana süreçteki gunkaydi tablolarına dokunmadan): kokpit:al sarılır.
await u.evaluate(({ ipcMain }) => {
  const simdi = Date.now();
  const once = (dk) => new Date(simdi - dk * 60_000).toISOString();
  const gun = (n = 0) => new Date(simdi - n * 86_400_000).toLocaleDateString('sv-SE');
  const durum = {
    etkin: true, dinliyor: true, yazici: { motor: 'whisper', aciklama: 'Whisper (yerel)' }, whisper: { kurulu: true, calisiyor: true },
    bugun: { satir: 186, madde: 8, onemli: 4, eslik: 2 },
    ajanlar: [
      { ad: 'kulak', etiket: 'Kulak', durum: 'calisiyor', sayac: 186 }, { ad: 'yazici', etiket: 'Yazıcı', durum: 'bekliyor', sayac: 186 },
      { ad: 'notTutucu', etiket: 'Not tutucu', durum: 'calisiyor', sayac: 9 }, { ad: 'eslikci', etiket: 'Eşlikçi', durum: 'bekliyor', sayac: 2 },
    ],
    sonEslik: { zaman: once(34), metin: 'Sunum dosyasını cuma Ece’ye gönderecektin; yarın son gün.' }, acikMesele: 3,
  };
  const madde = (id, dk, metin) => ({ id, gun: gun(), zaman: once(dk), metin, onem: 'onemli', kisiler: [], eglenceli: false, satirlar: '', silinme: '' });
  const meseleler = [
    { id: 1, baslik: 'Sunumu Ece’ye gönder', kisi: 'Ece', hedef: gun(1), ayrinti: 'Grafikler sadeleşecek', ilkGun: gun(3), durum: 'acik', guncelleme: once(30) },
    { id: 2, baslik: 'Pazarlama bütçesini konuş', kisi: 'Mert', hedef: gun(-1), ayrinti: 'Kalem %15 aşıldı', ilkGun: gun(2), durum: 'acik', guncelleme: once(30) },
    { id: 3, baslik: 'Ürün adı kısa listesi', hedef: gun(-6), ilkGun: gun(4), durum: 'acik', guncelleme: once(30) },
  ];
  const v = { durum, bugunOnemli: [madde(1, 25, 'Sunumun son hâli cuma Ece’ye gidecek; grafikler yeniden çizilecek.'), madde(2, 70, 'Kira sözleşmesi için emlakçı salı 14:00’te arayacak.'), madde(3, 130, 'Pazarlama kalemi %15 aşıldı; Mert’le konuşulacak.')], sonRapor: { id: 1, tur: 'gunluk', donem: gun(1), baslik: 'Sunum haftası başladı', ozet: 'Gün sunum hazırlığı ve bütçe konuşmalarıyla geçti; Ece ile teslim tarihi netleşti.', onemli: [], onemsiz: [], kararlar: [], acikMeseleler: [], ileriye: [], maddeSayisi: 12, olusturma: once(600), guncelleme: once(45) }, meseleler };
  const orijinal = ipcMain._invokeHandlers?.get?.('kokpit:al');
  ipcMain.removeHandler('kokpit:al');
  ipcMain.handle('kokpit:al', async (e) => {
    const k = structuredClone(await orijinal(e));
    k.veri.dusunme = v;
    // Ana süreçteki kural, gerçek veride hedefi geçmiş meseleyi acil yapardı (tests/izgara.test.ts); sahte veride elle.
    for (const x of k.kartlar) if (x.tip === 'meseleler') { x.onem = 'acil'; x.vurgu = true; }
    return k;
  });
  // Ağ yok: mesaj gönderimi alınmış sayılır, model çağrılmaz.
  ipcMain.removeHandler('sohbet:gonder');
  ipcMain.handle('sohbet:gonder', () => true);
});

const ray = w.locator('.ray__dgm');
const sayfa = async (n, ms = 1200) => { await ray.nth(n).click(); await w.waitForTimeout(ms); };
// Ayarlar ray sırasıyla değil adıyla açılır (İş modunda Claude Code menüsü yok, sıra kayar); `cipa` kategori/akordeon açar.
const ayarlarAc = async (ms = 1200, cipa) => {
  if (cipa) await w.evaluate((c) => { location.hash = c; }, cipa);
  await w.locator('.ray__dgm[data-tur="ayarlar"]').click(); await w.waitForTimeout(ms);
};
const foto = async (p, ad, sec = {}) => { await p.screenshot({ path: path.join(cikti, `${ad}.png`), ...sec }); console.log('📸', ad); };
const tema = async (t) => { await w.evaluate((x) => window.fuber.cagir('ayarlar:kaydet', { gorunum: { tema: x } }), t); await w.waitForTimeout(900); console.log('tema →', await w.evaluate(() => document.documentElement.dataset.tema)); };

const kokpitCek = async (t) => {
  await sayfa(1, 400); await ray.nth(0).click(); // yeniden takılınca ilk açılış parıltısı oynar
  await w.waitForTimeout(650); await foto(w, `${t}-kokpit-parilti`);
  await w.waitForTimeout(3200); await foto(w, `${t}-kokpit`);
  // Izgara denetimi: hücreler üst üste binmiyor, ızgaradan taşmıyor.
  const denetim = await w.evaluate(() => {
    const iz = document.querySelector('.izgara').getBoundingClientRect();
    const k = [...document.querySelectorAll('.izgara > .kk')].map((e) => e.getBoundingClientRect());
    let ust = 0;
    for (let i = 0; i < k.length; i++) for (let j = i + 1; j < k.length; j++) { const a = k[i], b = k[j]; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) ust++; }
    const tasan = k.filter((r) => r.right > iz.right + 1 || r.left < iz.left - 1).length;
    return { kart: k.length, ustUste: ust, tasan, sutun: getComputedStyle(document.querySelector('.izgara')).getPropertyValue('--sutun').trim() };
  });
  console.log('ızgara', t, JSON.stringify(denetim));
  const asagi = async (ad) => { await w.evaluate(() => { const a = document.querySelector('.kokpit__alan'); a.scrollTop = a.scrollHeight; }); await w.waitForTimeout(500); await foto(w, ad); await w.evaluate(() => { document.querySelector('.kokpit__alan').scrollTop = 0; }); };
  await asagi(`${t}-kokpit-alt`);
  await boyut(1100, 800); await w.waitForTimeout(900); await foto(w, `${t}-kokpit-dar`);
  console.log('ızgara dar', t, await w.evaluate(() => getComputedStyle(document.querySelector('.izgara')).getPropertyValue('--sutun').trim()));
  await asagi(`${t}-kokpit-dar-alt`);
  await boyut(1440, 900); await w.waitForTimeout(700);
};

// ── Koyu ──
await kokpitCek('koyu');

// Canlı tur: asistandan soru (gerçek akış), sonra ana süreçten gelmiş gibi araç adımları + metin + onay.
const anaId = await w.evaluate(() => window.fuber.cagir('sohbet:ana'));
await w.evaluate(() => window.fuber.cagir('asistan:goster', false));
const asistan = await pencere(u, 'asistan.html');
await asistan.waitForTimeout(900);
// Anahtarsız demoda motor bağlı değil: ada soru kutusu yerine "motor durdu" gösterir; soru kulağın yolundan (asistan:ses) gelir.
await u.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes('asistan.html'))?.webContents.send('asistan:ses', { tur: 'metin', metin: 'Ece’ye revizyonlar için kısa bir yanıt yaz ve gönder.' }));
await u.evaluate(({ BrowserWindow }, ana) => {
  const yolla = (kanal, o) => { for (const b of BrowserWindow.getAllWindows()) b.webContents.send(kanal, o); };
  const olay = (o) => yolla('sohbet:olay', { sohbetId: ana, ...o });
  const istek = { id: 'onay-1', baslik: 'E-posta gönderilsin mi?', aciklama: 'Kime: Ece Aydın <ece@kuzeyruzgari.example> · Konu: Re: Ana sayfa revizyonları', onizleme: 'Merhaba Ece,\n\nRevizyonları aldım; bugün akşama kadar işleyip yayına hazır hâlini paylaşacağım.\n\nSevgiler,\nDeniz', tehlike: 'orta', secenekler: ['bir_kez', 'bu_gorev', 'reddet'] };
  olay({ tur: 'basladi', kullaniciMesaji: { id: 990001, rol: 'user', bloklar: [{ tur: 'metin', metin: 'Ece’ye revizyonlar için kısa bir yanıt yaz ve gönder.' }], zaman: new Date().toISOString(), kaynak: 'kullanici' } });
  setTimeout(() => olay({ tur: 'arac', blok: { tur: 'arac', id: 'a1', ad: 'eposta_oku', etiket: 'E-posta okundu · Ece Aydın', girdi: {}, durum: 'tamam', ozet: 'Ana sayfa revizyonları — son hali: başlık kısalsın, hizmetler bölümü iki sütun.' } }), 80);
  setTimeout(() => olay({ tur: 'arac', blok: { tur: 'arac', id: 'a2', ad: 'hafiza_ara', etiket: 'Hafızada arıyor · Kuzey Rüzgârı', girdi: {}, durum: 'calisiyor' } }), 160);
  setTimeout(() => olay({ tur: 'metin', parca: 'Taslak hazır. Ece aynı gün dönüş bekliyor [H-4 · 2026-10-12]; kısa ve net tuttum. **Göndermeden önce onayını istiyorum** (müşteri e-postası kuralı).' }), 240);
  setTimeout(() => { olay({ tur: 'onay', istek }); yolla('asistan:onay', { sohbetId: ana, istek }); }, 320);
}, anaId);
await w.waitForTimeout(1600);
await foto(w, 'koyu-kokpit-sohbet');
await foto(asistan, 'koyu-asistan', { omitBackground: true });

// ── Açık (canlı tur ekranda kalır) ──
await tema('acik');
await w.waitForTimeout(400);
await foto(w, 'acik-kokpit-sohbet');
await asistan.waitForTimeout(200);
await foto(asistan, 'acik-asistan', { omitBackground: true });
await kokpitCek('acik');
const sayfalar = async (t) => {
  await sayfa(1); await foto(w, `${t}-sohbetler`);
  await sayfa(2); await foto(w, `${t}-hafiza`);
  // 0.10 Görev 1 (D1, P1): Beyin sayfası kalktı; Etkinlik Bağlantılar'dan sonra durur (sırası moda göre kayar) → kimliğiyle açılır.
  await w.locator('.ray__dgm[data-tur="etkinlik"]').click(); await w.waitForTimeout(1800); await foto(w, `${t}-etkinlik`);
  await ayarlarAc(1200, 'genel'); await foto(w, `${t}-ayarlar`); // 0 kokpit · 1 sohbetler · 2 hafıza (ilk üçü iki modda da aynı sırada)
  await ayarlarAc(700, 'yetkiler'); await foto(w, `${t}-ayarlar-2`);
};
await sayfalar('acik');

// ── Sistem → (Windows teması) ve tekrar koyu ──
await tema('sistem');
await tema('koyu');
await sayfalar('koyu');

// ── Şeffaf (cam) + pencere kuralları (0.13 T13) ──
// Şeffaf tema geri geldi (0.13 T13). Windows 11 22H2+ / macOS'ta etkin tema 'cam' olur: sayfa saydamlaşır, ana pencereye sistem malzemesi
// (acrylic / vibrancy) uygulanır. Destek yoksa (Windows 10) seçim ne olursa olsun 'koyu'ya düşer ve Şeffaf sunulmaz. Kurulum, Tekrar hoş geldin ve
// açılış HER durumda opaktır (0.12 H3a sorunu: "yarı şeffaf bozuk ekran"). Bu bölüm bunları GERÇEK pencereden ölçer (sayfa görüntüsünün alfası +
// DWM malzemesi). Başarısız her denetim sayılır; son satır "N denetim · N hata".
const sonuclar = [];
const kontrol = (ad, tamam, ayrinti = '') => { sonuclar.push(Boolean(tamam)); console.log(tamam ? '  tamam' : '  HATA ', ad, ayrinti); };
const camVar = camDestekli(process.platform, os.release());
// Windows: DWM'nin pencereye uyguladığı sistem arka plan malzemesi (1 yok, 2 mica, 3 acrylic); okunamazsa null.
const dwmMalzemesi = (hwndHex) => {
  if (process.platform !== 'win32') return null;
  const t = Buffer.from(hwndHex, 'hex');
  const hwnd = (t.length >= 8 ? t.readBigUInt64LE(0) : BigInt(t.readUInt32LE(0))).toString();
  const komut = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class D { [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s); }'; $v = 0; [void][D]::DwmGetWindowAttribute([IntPtr]::new([long]::Parse($env:FUBER_HWND)), 38, [ref]$v, 4); $v`;
  try { return Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', komut], { env: { ...process.env, FUBER_HWND: hwnd }, encoding: 'utf8' }).trim()); } catch { return null; }
};
// Ana pencerenin gerçek durumu: sayfanın saydam piksel oranı (capturePage alfası), pencere zemini, sistem malzemesi.
const anaDurumu = async (uyg) => {
  const d = await uyg.evaluate(async ({ BrowserWindow }) => {
    const x = BrowserWindow.getAllWindows().find((p) => p.webContents.getURL().includes('index.html'));
    const bmp = (await x.webContents.capturePage()).toBitmap();
    let saydam = 0;
    for (let i = 3; i < bmp.length; i += 4) if (bmp[i] < 255) saydam++;
    return { zemin: x.getBackgroundColor(), saydam: saydam / (bmp.length / 4), hwnd: x.getNativeWindowHandle().toString('hex') };
  });
  return { ...d, malzeme: dwmMalzemesi(d.hwnd) };
};
// Temaya göre beklenen [body zemini, pencere zemini]: koyu ve açık opak; cam saydam (getBackgroundColor alfayı döndürmez).
const BEKLENEN_ZEMIN = { koyu: ['rgb(0, 0, 0)', '#000000'], acik: ['rgb(233, 233, 236)', '#E9E9EC'], cam: ['rgba(0, 0, 0, 0)', null] };
const temaDenetle = async (uyg, sayfa_, beklenen, etiket) => {
  const cam = beklenen === 'cam';
  console.log(`denetim: ${etiket} (beklenen tema: ${beklenen})`);
  kontrol(`${etiket}: data-tema`, (await sayfa_.evaluate(() => document.documentElement.dataset.tema)) === beklenen);
  const yanit = await sayfa_.evaluate(() => window.fuber.cagir('tema:etkin')).catch((e) => ({ hata: String(e).slice(0, 90) }));
  kontrol(`${etiket}: tema:etkin`, yanit?.tema === beklenen && yanit?.cam === camVar, JSON.stringify(yanit));
  const [bodyZemin, pencereZemin] = BEKLENEN_ZEMIN[beklenen];
  const zemin = await sayfa_.evaluate(() => getComputedStyle(document.body).backgroundColor);
  kontrol(`${etiket}: body zemini`, zemin === bodyZemin, zemin);
  const d = await anaDurumu(uyg);
  kontrol(`${etiket}: sayfa saydamlığı`, cam ? d.saydam > 0.005 : d.saydam === 0, `saydam piksel %${(d.saydam * 100).toFixed(2)}`);
  if (pencereZemin) kontrol(`${etiket}: pencere zemini`, d.zemin === pencereZemin, d.zemin);
  if (d.malzeme !== null) kontrol(`${etiket}: sistem malzemesi`, d.malzeme === (cam ? 3 : 1), `DWM ${d.malzeme} (1 yok, 2 mica, 3 acrylic)`);
};
// Pencerenin kendi görüntüsü (desktopCapturer; YALNIZ bu pencere kaydedilir, masaüstü değil): sayfa alfası korunur; sistem malzemesini DWM çizdiği için
// yakalamada görünmez.
const pencereResmi = async (ad) => {
  const b64 = await u.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
    const x = BrowserWindow.getAllWindows().find((p) => p.webContents.getURL().includes('index.html'));
    const kaynaklar = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1440, height: 900 } });
    return kaynaklar.find((k) => k.id === x.getMediaSourceId())?.thumbnail.toPNG().toString('base64') ?? null;
  });
  if (!b64) { console.log('pencere görüntüsü alınamadı:', ad); return; }
  fs.writeFileSync(path.join(cikti, `${ad}.png`), Buffer.from(b64, 'base64'));
  console.log('📸', ad);
};
// Pencere düğmeleri (Görev 22: kendi düğmelerimiz; Windows kaplaması YOK): daireler köşe çentiğinin opak gövdesinde.
const pencereDugmeleri = async (etiket) => {
  const b = await w.evaluate(() => {
    const wco = Boolean(navigator.windowControlsOverlay?.visible);
    const c = document.querySelector('.pd-centik')?.getBoundingClientRect();
    const daireler = [...document.querySelectorAll('.pd-dgm__daire')].map((d) => d.getBoundingClientRect());
    const centikte = c && daireler.length === 3 ? daireler.every((d) => d.top >= c.top && d.bottom <= c.top + 32 && d.right <= c.right && d.left >= c.left) : null;
    return { wco, centikte };
  });
  kontrol(`${etiket}: Windows başlık şeridi kaplaması yok`, b.wco === false);
  kontrol(`${etiket}: pencere düğmeleri köşe çentiğinin opak gövdesinde`, b.centikte === true, String(b.centikte));
};
// Ekran görüntüleri için saydam sayfanın arkasına masaüstü benzeri bir zemin konur (gerçek cam bulanık duvar kâğıdı gösterir):
// 'gradyan' koyu duvar kâğıdı; 'beyaz' ve 'mavi' parlak (en kötü durum) arka planlar. Argümansız çağrı zemini kaldırır.
const CAM_ARKALARI = { gradyan: 'linear-gradient(135deg, #46588f 0%, #1a1e2b 48%, #7a4a6d 100%)', beyaz: '#ffffff', mavi: '#6ec1ff' };
const camArka = (ad) => w.evaluate((a) => { document.documentElement.style.background = a ?? ''; }, ad ? CAM_ARKALARI[ad] : null);

// ── Okunurluk (kurgu gereği): cam yüzeyler saydam olduğu için metin kontrastı ARKADAKİ şeye bağlıdır. Akrilik tonu yok sayılarak en kötü durum
// (saf beyaz) ve siyah arka plan üstünde ölçülür. Çıta: metin ≥ 4,5:1, arayüz öğeleri (simge, anahtar, seçili halka) ≥ 3:1 (WCAG 1.4.11).
// Üç ölçüm: (1) belirteçler (metin × yüzey, 0.10'dan beri), (2) fintech belirteçleri (0.12: kurulumdan sonra Ayarlar → Gizlilik / Hesap'taki kartlar da
// panoda durur; --ft-* yüzeyleri OPAK, yazıları .pano içinde cam tonlarıyla yeniden kurulur) ve (3) GERÇEK sayfaların taraması: görünen her metin ve
// etkileşimli simge için ata zincirindeki arka planlar duvar kâğıdının üstüne alfa karışımıyla birleştirilir (gradyanlarda her durak ayrı sınanır).
// Renk okuma, alfa birleştirme ve WCAG oranı: kontrast.mjs (ada-onizle.mjs de aynısını kullanır).
const DUVARLAR = [['beyaz', BEYAZ], ['siyah', SIYAH], ['mavi', [110, 193, 255, 1]]];
const camBelirtecOkunurlugu = async () => {
  const MIN = 4.5, MIN_SIMGE = 3;
  const b = await w.evaluate(() => {
    const pano = document.querySelector('.pano');
    // Belirteci panonun İÇİNDE çözer (.pano kapsamlı cam kuralları --ft-ink-* değerlerini orada değiştirir).
    const al = (ozellik, belirtec, kap = document.body) => { const e = document.createElement('i'); e.style[ozellik] = `var(${belirtec})`; kap.append(e); const d = getComputedStyle(e)[ozellik]; e.remove(); return d; };
    const metin = ['--ink', '--metin', '--ink-2', '--ink-3', '--ink-4', '--yazi-hata', '--yazi-basari', '--yazi-uyari'];
    const yuzey = ['--pano-zemin', '--kart', '--kart-2', '--kart-3', '--girdi', '--cam', '--centik', '--dugme-2', '--dugme-2-ust', '--cam-ray', '--dolgu-2', '--dolgu-3'];
    const ftMetin = ['--ft-ink', '--ft-ink-2', '--ft-ink-3', '--ft-ink-4'];
    const ftYuzey = ['--ft-yuzey', '--ft-yuzey-2', '--ft-yuzey-3', '--ft-tepsi', '--ft-sahne'];
    const ftSimge = ['--ft-anahtar-kenar', '--ft-halka', '--ft-yesil-simge', '--ft-birincil', '--ft-ink-2'];
    const ikon = (sec) => { const s = document.querySelector(sec); return s ? getComputedStyle(s).color : null; };
    const wco = Boolean(navigator.windowControlsOverlay?.visible);
    const c = document.querySelector('.pd-centik')?.getBoundingClientRect();
    const daireler = [...document.querySelectorAll('.pd-dgm__daire')].map((d) => d.getBoundingClientRect());
    const baslikCentikte = c && daireler.length === 3 ? daireler.every((d) => d.top >= c.top && d.bottom <= c.top + 32 && d.right <= c.right && d.left >= c.left) : null;
    const pd = document.querySelector('.pd-dgm__daire');
    const centikYolu = document.querySelector('.pd-centik path');
    return {
      metin: Object.fromEntries(metin.map((k) => [k, al('color', k, pano)])), yuzey: Object.fromEntries(yuzey.map((k) => [k, al('backgroundColor', k, pano)])),
      ftMetin: Object.fromEntries(ftMetin.map((k) => [k, al('color', k, pano)])), ftYuzey: Object.fromEntries(ftYuzey.map((k) => [k, al('backgroundColor', k, pano)])),
      ftSimge: Object.fromEntries(ftSimge.map((k) => [k, al('color', k, pano)])),
      ray: { pasif: ikon('.ray__dgm:not([aria-current]) svg'), secili: ikon('.ray__dgm[aria-current] svg'), baslikCentikte, wco },
      pencere: { simge: pd ? getComputedStyle(pd).color : null, centik: centikYolu ? getComputedStyle(centikYolu).fill : null },
    };
  });
  const y = Object.fromEntries(Object.entries(b.yuzey).map(([k, v]) => [k, renkOku(v)]));
  const fy = Object.fromEntries(Object.entries(b.ftYuzey).map(([k, v]) => [k, renkOku(v)]));
  const enKotu = Object.fromEntries(Object.keys(b.metin).map((k) => [k, { oran: Infinity, nerede: '' }]));
  const ftEnKotu = Object.fromEntries(Object.keys(b.ftMetin).map((k) => [k, { oran: Infinity, nerede: '' }]));
  const simgeEnKotu = {};
  const simgeIsle = (ad, renk, yuz, arkaAd) => { const oran = kontrastOrani(renk, yuz); if (!simgeEnKotu[ad] || oran < simgeEnKotu[ad].oran) simgeEnKotu[ad] = { oran, nerede: arkaAd }; };
  for (const [arkaAd, arka] of DUVARLAR) {
    const pano = ustune(y['--pano-zemin'], arka), kart = ustune(y['--kart'], pano);
    const ray = ustune(y['--cam-ray'], arka), rayUstu = ustune(y['--dolgu-2'], ray), raySecili = ustune(y['--dolgu-3'], ray);
    // Düğme zemini (kartta) yalnız --ink metni taşır (ikincil düğme: color var(--ink)); gerisi bütün metin belirteçleriyle sınanır.
    const yuzeyler = {
      pano, kart, 'kart-2': ustune(y['--kart-2'], pano), 'kart-3': ustune(y['--kart-3'], pano), 'girdi (kartta)': ustune(y['--girdi'], kart),
      'cam (panoda)': ustune(y['--cam'], pano), 'çentik': ustune(y['--centik'], arka),
      'ray': ray, 'ray (üzerine gelince)': rayUstu, 'ray (seçili)': raySecili,
      'düğme (kartta)': ustune(y['--dugme-2'], kart), 'düğme üstünde (kartta)': ustune(y['--dugme-2-ust'], kart),
    };
    for (const [yAd, yuz] of Object.entries(yuzeyler)) for (const [mAd, m] of Object.entries(b.metin)) {
      if (yAd.startsWith('düğme') && mAd !== '--ink') continue;
      const oran = kontrastOrani(renkOku(m), yuz);
      if (oran < enKotu[mAd].oran) enKotu[mAd] = { oran, nerede: `${yAd} / ${arkaAd}` };
    }
    // Fintech yazıları: panonun kendisinde (kart dışı yazı) ve OPAK fintech yüzeylerinde (kart içi yazı).
    const ftYuzeyler = { pano, ...Object.fromEntries(Object.entries(fy).map(([k, v]) => [k, ustune(v, arka)])) };
    for (const [yAd, yuz] of Object.entries(ftYuzeyler)) for (const [mAd, m] of Object.entries(b.ftMetin)) {
      const oran = kontrastOrani(renkOku(m), yuz);
      if (oran < ftEnKotu[mAd].oran) ftEnKotu[mAd] = { oran, nerede: `${yAd} / ${arkaAd}` };
    }
    // Arayüz öğeleri (≥ 3:1): ray ikonları (pasif / üzerine gelince / seçili), ürün işareti, pencere düğmesi simgesi (çentikte), fintech anahtar kenarı /
    // seçili halka / yeşil simge (kartlarının OPAK yüzeyinde).
    const centik = ustune(renkOku(b.pencere.centik ?? 'rgb(0, 0, 0)'), arka);
    for (const [ad, renk, yuz] of [
      ['ray ikonu (pasif)', renkOku(b.ray.pasif ?? 'rgb(0, 0, 0)'), ray],
      ['ray ikonu (üzerine gelince, --ink)', renkOku(b.metin['--ink']), rayUstu],
      ['ray ikonu (seçili)', renkOku(b.ray.secili ?? 'rgb(0, 0, 0)'), raySecili],
      ['pencere düğmesi simgesi (köşe çentiğinde)', renkOku(b.pencere.simge ?? 'rgb(0, 0, 0)'), centik],
    ]) simgeIsle(ad, renk, yuz, arkaAd);
    for (const [ad, c] of Object.entries(b.ftSimge)) if (ad !== '--ft-halka') simgeIsle(`fintech ${ad} (kart yüzeyinde)`, renkOku(c), ustune(fy['--ft-yuzey'], arka), arkaAd);
    // Seçili halka yarı saydam beyazdır (--ft-halka): kartın opak yüzeyine karıştırılır.
    simgeIsle('fintech seçili kart halkası (--ft-halka)', ustune(renkOku(b.ftSimge['--ft-halka']), ustune(fy['--ft-yuzey'], arka)), ustune(fy['--ft-yuzey'], arka), arkaAd);
  }
  console.log('cam okunurluğu (belirteçler):', JSON.stringify(b.metin), JSON.stringify(b.ftMetin));
  for (const [m, { oran, nerede }] of Object.entries(enKotu)) kontrol(`kontrast ${m} ≥ ${MIN}`, oran >= MIN, `${oran.toFixed(2)}:1 (en kötü: ${nerede})`);
  for (const [m, { oran, nerede }] of Object.entries(ftEnKotu)) kontrol(`kontrast fintech ${m} ≥ ${MIN}`, oran >= MIN, `${oran.toFixed(2)}:1 (en kötü: ${nerede})`);
  for (const [ad, { oran, nerede }] of Object.entries(simgeEnKotu)) kontrol(`kontrast ${ad} ≥ ${MIN_SIMGE}`, oran >= MIN_SIMGE, `${oran.toFixed(2)}:1 (en kötü: ${nerede})`);
  kontrol('Windows başlık şeridi kaplaması yok', b.ray.wco === false);
  kontrol('pencere düğmeleri köşe çentiğinin opak gövdesinde', b.ray.baslikCentikte === true, String(b.ray.baslikCentikte));
};

// (3) Gerçek sayfa taraması: görünen metin (≥ 4,5:1; büyük yazı ≥ 3:1) ve etkileşimli simge (≥ 3:1). Sayfa DOM'unda her öğenin ata zincirinden arka planlar
// ve saydamlıklar toplanır; birleştirme burada (Node) yapılır.
const sayfaZinciri = () => w.evaluate(() => {
  const ata = (e) => { const z = []; for (let n = e; n && n.nodeType === 1; n = n.parentElement) z.push(n); return z; };
  const katman = (n) => {
    const cs = getComputedStyle(n);
    const k = { bg: cs.backgroundColor, img: cs.backgroundImage, op: Number(cs.opacity) };
    if (n.classList.contains('ray')) { const p = getComputedStyle(n, '::before'); k.bg = p.backgroundColor; k.img = p.backgroundImage; }
    return k;
  };
  const gorunur = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    for (const n of ata(e)) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false; }
    return true;
  };
  const ad = (e) => `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
  const cikti = [];
  for (const e of document.body.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE', 'SVG', 'PATH', 'CANVAS', 'OPTION'].includes(e.tagName.toUpperCase()) || e.closest('svg')) continue;
    if (e.closest('[disabled], [aria-disabled="true"], .acilis, .tanitim, .pd-dgm')) continue;
    const dogrudanMetin = [...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim().length > 0);
    const alan = (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA') && (e.value || e.placeholder);
    if ((!dogrudanMetin && !alan) || !gorunur(e)) continue;
    const cs = getComputedStyle(e);
    cikti.push({ tur: 'metin', ad: ad(e), metin: (alan ? (e.value || e.placeholder) : e.textContent).trim().slice(0, 36), renk: cs.color, boyut: parseFloat(cs.fontSize), kalin: Number(cs.fontWeight) >= 700, zincir: ata(e).reverse().map(katman), opYok: 1 });
  }
  for (const s of document.body.querySelectorAll('button svg, a svg, [role="radio"] svg, [role="tab"] svg, [role="switch"] svg')) {
    if (s.closest('[disabled], [aria-disabled="true"], .acilis, .tanitim, .pd-dgm') || !gorunur(s)) continue;
    const kap = s.closest('button, a, [role]');
    if (kap && kap.textContent.trim().length > 0 && !kap.getAttribute('aria-label')) continue; // yanında yazısı olan simge: yazı anlatır
    cikti.push({ tur: 'simge', ad: ad(s.parentElement), metin: kap?.getAttribute('aria-label') ?? '', renk: getComputedStyle(s).color, boyut: 0, kalin: false, zincir: ata(s).reverse().map(katman) });
  }
  return cikti;
});
const gradyanRenkleri = (img) => (String(img).match(/(?:rgba?|color)\([^)]*\)/g) ?? []).map(renkOku);
const etkinOran = (oge, duvar) => {
  // Zinciri kökten uca birleştir; gradyan çeşitleri ayrı dallanır, en kötü oran döner.
  let dallar = [[duvar[0], duvar[1], duvar[2], 1]];
  let toplamOp = 1;
  for (const k of oge.zincir) {
    toplamOp *= k.op;
    const bg = renkOku(k.bg);
    if (bg[3] > 0) dallar = dallar.map((d) => ustune([bg[0], bg[1], bg[2], bg[3] * toplamOp], d));
    const g = gradyanRenkleri(k.img);
    if (g.length) dallar = g.flatMap((c) => dallar.map((d) => ustune([c[0], c[1], c[2], c[3] * toplamOp], d)));
  }
  const m = renkOku(oge.renk);
  let en = Infinity;
  for (const d of dallar) { const on = ustune([m[0], m[1], m[2], m[3] * toplamOp], d); en = Math.min(en, kontrastOrani(on, d)); }
  return en;
};
const sayfaTara = async (etiket) => {
  const ogeler = await sayfaZinciri();
  const kotu = [];
  let en = Infinity;
  for (const o of ogeler) for (const [duvarAd, duvar] of DUVARLAR) {
    const oran = etkinOran(o, duvar);
    const esik = o.tur === 'simge' ? 3 : (o.boyut >= 24 || (o.boyut >= 18.66 && o.kalin) ? 3 : 4.5);
    if (oran < en) en = oran;
    if (oran < esik) kotu.push({ oran, ad: o.ad, metin: o.metin, duvar: duvarAd, tur: o.tur });
  }
  const tekil = new Map();
  for (const k of kotu) { const a = `${k.ad}|${k.metin}`; if (!tekil.has(a) || tekil.get(a).oran > k.oran) tekil.set(a, k); }
  const liste = [...tekil.values()].sort((a, b) => a.oran - b.oran);
  kontrol(`okunurluk taraması ${etiket}: ${ogeler.length} öğe, hepsi çıtada`, liste.length === 0, `en düşük ${en.toFixed(2)}:1${liste.length ? ' · ' + liste.slice(0, 8).map((k) => `${k.oran.toFixed(2)} ${k.tur} ${k.ad} “${k.metin}” (${k.duvar})`).join(' | ') : ''}`);
};
// Sentetik sayfa gezintisi: kokpit, sohbetler, hafıza, etkinlik ve fintech kartlarının durduğu Ayarlar kategorileri.
const camSayfalariTara = async () => {
  await sayfa(0, 2500); await sayfaTara('kokpit');
  await sayfa(1, 1200); await sayfaTara('sohbetler');
  await sayfa(2, 1200); await sayfaTara('hafıza');
  await w.locator('.ray__dgm[data-tur="etkinlik"]').click(); await w.waitForTimeout(1800); await sayfaTara('etkinlik');
  for (const kat of ['hesap', 'genel', 'gorunum', 'pano', 'ses', 'gizlilik', 'proaktif', 'yetkiler', 'veri']) { await ayarlarAc(900, kat); await sayfaTara(`ayarlar/${kat}`); }
};

// ── Kurulum / Tekrar hoş geldin / açılış cam temada da OPAK ──
const kurulumOpakDenetle = async () => {
  await ayarlarAc(900, 'sihirbaz');
  await w.locator('[data-kurulumu-ac]').click();
  await w.waitForSelector('.k2', { timeout: 15000 });
  await w.waitForTimeout(1200);
  let d = await anaDurumu(u);
  kontrol('cam + kurulum açık: sayfa piksellerinde saydam nokta yok', d.saydam === 0, `saydam piksel %${(d.saydam * 100).toFixed(2)}`);
  kontrol('cam + kurulum açık: pencere zemini opak koyu', d.zemin === '#000000', d.zemin);
  if (d.malzeme !== null) kontrol('cam + kurulum açık: sistem malzemesi YOK (DWM 1)', d.malzeme === 1, `DWM ${d.malzeme}`);
  await pencereResmi('cam-kurulum-opak');
  await camArka('mavi'); await w.waitForTimeout(300); await foto(w, 'cam-kurulum-mavi-arka'); await camArka();
  // Görünüm adımına kadar ilerleyip Şeffaf seçeneğini sun / sunma denetimi (kurulum penceresi yine opak).
  await w.keyboard.press('Escape'); await w.waitForSelector('.k2', { state: 'detached', timeout: 15000 }); await w.waitForTimeout(900);
  d = await anaDurumu(u);
  kontrol('cam + kurulum kapandı: tema geri geldi (sayfa saydam)', d.saydam > 0.005, `saydam piksel %${(d.saydam * 100).toFixed(2)}`);
  if (d.malzeme !== null) kontrol('cam + kurulum kapandı: acrylic geri geldi (DWM 3)', d.malzeme === 3, `DWM ${d.malzeme}`);
};

await sayfa(0, 2500); // kokpitte: sayfa içeriği hazır olsun
await temaDenetle(u, w, 'koyu', 'koyu');
await pencereDugmeleri('koyu');
await pencereResmi('koyu-pencere');
await tema('acik');
await temaDenetle(u, w, 'acik', 'açık');
await pencereDugmeleri('açık');
await pencereResmi('acik-pencere');
kontrol('asistan penceresi de aynı tema (açık)', (await asistan.evaluate(() => document.documentElement.dataset.tema)) === 'acik');

// Ayarlar → Görünüm: Şeffaf yalnız destekleyen bilgisayarda sunulur.
await ayarlarAc(800, 'gorunum'); await foto(w, 'acik-gorunum');
{
  const t = await w.evaluate(() => [...document.querySelectorAll('[aria-label="Tema"] [role="radio"]')].map((b) => b.textContent.trim()));
  const beklenen = camVar ? ['Koyu', 'Açık', 'Şeffaf', 'Otomatik'] : ['Koyu', 'Açık', 'Otomatik'];
  kontrol(`Ayarlar → Görünüm: ${beklenen.join(' · ')}`, JSON.stringify(t) === JSON.stringify(beklenen), JSON.stringify(t));
}

// ── Şeffaf ──
await tema('cam');
await temaDenetle(u, w, camVar ? 'cam' : 'koyu', 'ana pencere');
kontrol('asistan penceresi de aynı tema', (await asistan.evaluate(() => document.documentElement.dataset.tema)) === (camVar ? 'cam' : 'koyu'));
if (camVar) {
  await pencereDugmeleri('cam');
  await camBelirtecOkunurlugu();
  await sayfa(0, 2500);
  await pencereResmi('cam-pencere');
  await camArka('gradyan');
  await kokpitCek('cam');
  await sayfalar('cam');
  await ayarlarAc(700, 'gorunum'); await foto(w, 'cam-gorunum');
  {
    const dugme = w.getByRole('radio', { name: 'Şeffaf' });
    kontrol('Görünüm: Şeffaf seçili ve etkin', (await dugme.getAttribute('aria-checked')) === 'true' && (await dugme.isEnabled()));
  }
  await foto(asistan, 'cam-asistan', { omitBackground: true });
  // Parlak arka planlar (en kötü durum): beyaz ve doygun açık mavi. Fintech kartları: Ayarlar → Hesap / Gizlilik.
  for (const ad of ['beyaz', 'mavi']) {
    await camArka(ad);
    await sayfa(0, 1800); await foto(w, `cam-${ad}-kokpit`);
    await sayfa(1, 900); await foto(w, `cam-${ad}-sohbetler`);
    await ayarlarAc(900, 'genel'); await foto(w, `cam-${ad}-ayarlar`);
    await ayarlarAc(900, 'hesap'); await foto(w, `cam-${ad}-ayarlar-hesap`);
    await ayarlarAc(900, 'gizlilik'); await foto(w, `cam-${ad}-ayarlar-gizlilik`);
  }
  await camArka('gradyan');
  await ayarlarAc(900, 'gizlilik'); await foto(w, 'cam-gradyan-ayarlar-gizlilik');
  await ayarlarAc(900, 'hesap'); await foto(w, 'cam-gradyan-ayarlar-hesap');
  await camArka();
  await camSayfalariTara();
  await kurulumOpakDenetle();
}

// "Otomatik": etkin tema ana süreçte işletim sisteminin rengine göre çözülür ve pencerelere yayınlanır.
await tema('sistem');
const sistemKoyu = await u.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors);
kontrol('Otomatik: data-tema işletim sistemine uyar', (await w.evaluate(() => document.documentElement.dataset.tema)) === (sistemKoyu ? 'koyu' : 'acik'), `sistem ${sistemKoyu ? 'koyu' : 'açık'}`);
await temaDenetle(u, w, sistemKoyu ? 'koyu' : 'acik', 'Otomatik');
await tema('koyu');
await temaDenetle(u, w, 'koyu', 'koyuya dönüş');

await u.close();

// Açılışta ayar zaten 'cam' ise ilk pencere de camla doğar (pencere temaKur'dan SONRA oluşturulur); açılış örtüsü yine OPAK. Cam desteklenmiyorsa Koyu.
{
  const ayarYolu = path.join(veri, 'ayarlar.json');
  const ayar = JSON.parse(fs.readFileSync(ayarYolu, 'utf8'));
  fs.writeFileSync(ayarYolu, JSON.stringify({ ...ayar, gorunum: { ...ayar.gorunum, tema: 'cam' } }));
  const u2 = await ac();
  const w2 = await pencere(u2, 'index.html');
  w2.on('pageerror', (e) => hatalar.push(String(e)));
  w2.on('console', (m) => { if (m.type() === 'error') hatalar.push(m.text()); });
  await w2.waitForSelector('.acilis', { state: 'attached', timeout: 30000 }).catch(() => undefined);
  if (camVar && await w2.$('.acilis')) {
    // Örtünün animasyonları durdurulur (görüntü alınırken erimesin) ve bütün pencere piksellerine bakılır.
    await w2.evaluate(() => { for (const a of document.getAnimations()) if (a.effect?.target?.closest?.('.acilis')) a.pause(); });
    const zeminRenk = await w2.evaluate(() => getComputedStyle(document.querySelector('.acilis')).backgroundColor);
    kontrol('cam + açılış örtüsü: zemin opak (alfa 1)', !/rgba\([^)]*,\s*0?\.\d+\)/.test(zeminRenk) && zeminRenk !== 'rgba(0, 0, 0, 0)', zeminRenk);
    const d = await anaDurumu(u2);
    kontrol('cam + açılış örtüsü: sayfa piksellerinde saydam nokta yok', d.saydam === 0, `saydam piksel %${(d.saydam * 100).toFixed(2)}`);
    await w2.screenshot({ path: path.join(cikti, 'cam-acilis-opak.png') });
    await w2.evaluate(() => { for (const a of document.getAnimations()) if (a.effect?.target?.closest?.('.acilis')) a.finish(); });
  }
  await w2.waitForSelector('.kokpit', { timeout: 30000 });
  await w2.waitForTimeout(1500);
  await temaDenetle(u2, w2, camVar ? 'cam' : 'koyu', 'açılışta cam seçili');
  kontrol('açılışta cam kaydı dosyada korundu', JSON.parse(fs.readFileSync(ayarYolu, 'utf8')).gorunum.tema === 'cam');
  await u2.close();
}
kontrol('konsol hatası yok', hatalar.length === 0, hatalar.join(' | '));
console.log('Çıktı:', cikti);
fs.rmSync(veri, { recursive: true, force: true });
const hataSayisi = sonuclar.filter((x) => !x).length;
console.log(`\n${sonuclar.length} denetim · ${hataSayisi} hata`);
process.exitCode = hataSayisi ? 1 : 0;
