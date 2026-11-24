// Etkinlik sayfası önizlemesi ve denetimi (0.10 Görev 1, Karar D1; 0.13 T15: Parçalar ve motor kartı kalktı, tek sütun akış).
// Altyapı eski beyin-canli-testi.mjs'ten: geçici veri, sentetik demo verisi, ana süreçte SAHTE 'beyin:durum' yanıtı ve sahte
// 'beyin:olay' / 'zihin:durum' gönderimleri (gerçek ağ/model çağrısı yok; masaüstü yakalanmaz; gerçek fare/klavye yok — tıklama ve tuşlar
// sayfa içi). Denetler (başarısızsa çıkış kodu 1):
//  · Ray: "Etkinlik" (simge etkinlik) Bağlantılar'dan sonra; İş'te Ctrl+5 Etkinlik'i açar; ana:git('beyin') Etkinlik'i açar.
//  · Sayfada "Parçalar", çalışan parça hapı, motor kartı yok; TEK sütun: yalnız "Şu an" ve "Akış" kartı.
//  · Boş Akış metni; sahte olay → Akış'ın ilk satırı en yeni olay, düz cümle (ok işareti yok), saati SS:DD:ss; aynı araç satırı tek satır.
//  · Bölge adları (Akıl, El, Göz, Kulak, Bekçi, Eşlikçi, Raporcu, Not tutucu, Uyanma) sayfada hiçbir yerde yok; İş'te sağlayıcı/model/teknik ad,
//    "beyin", ham hata ve Kod olayı yok; hatalı olay kırmızı noktalı ("bir sorun oldu").
//  · Üç tema × 1080×680 ve 1440×900: sayfa kaymaz (scrollHeight = clientHeight), yalnız Akış kendi içinde kayar; canvas, .b3, video yok.
//  · Hareketi azalt: sayfada çalışan animasyon yok. Konsol hatası yok.
// Ağ YOK, anahtar YOK: geçici FUBER_VERI, FUBER_DEMO=1 (arka plan test kipi; FUBER_GORUNUR KULLANILMAZ), FUBER_SIR_* silinir, FUBER_TEST_TAM_EKRAN='0'.
// Çalıştır: npm run build && node scripts/dev/etkinlik-onizle.mjs [çıktı-klasörü]
import { KURULUM_SURUMU } from '../../src/shared/kurulum-adimlari.ts';
import { _electron as electron } from 'playwright-core';
import electronYolu from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { demoVerisiKur } from './demo-veri.mjs';
import { BOLGELER } from '../../src/shared/beyin.ts';

const kok = path.resolve(import.meta.dirname, '../..');
if (!fs.existsSync(path.join(kok, 'dist', 'main', 'main.js'))) { console.error('dist yok: önce npm run build'); process.exit(1); }
const cikti = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'fuber-etkinlik-onizle'));
fs.mkdirSync(cikti, { recursive: true });
const veri = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-etkinlik-'));
fs.mkdirSync(path.join(veri, 'belgeler'), { recursive: true });
fs.writeFileSync(path.join(veri, 'ayarlar.json'), JSON.stringify({
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: '0.9.0', kullaniciAdi: 'Deniz', hitap: 'Deniz', baslangictaAc: false,
  ses: { uyandirma: false, seslendirme: false }, proaktif: { etkin: false }, gorunum: { tema: 'koyu' },
}));
const ortam = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('FUBER_SIR_') && k !== 'FUBER_GORUNUR'));
Object.assign(ortam, { FUBER_DEMO: '1', FUBER_VERI: veri, FUBER_BELGELER: path.join(veri, 'belgeler'), FUBER_BILGISAYAR_ADI: 'DENIZ-PC', FUBER_TEST_TAM_EKRAN: '0' });

const sonuclar = [];
const kontrol = (ad, tamam, ayrinti = '') => {
  sonuclar.push({ ad, tamam: Boolean(tamam) });
  console.log(`${tamam ? '  tamam' : '  HATA '} ${ad}${ayrinti && !tamam ? ` — ${String(ayrinti).slice(0, 400)}` : ''}`);
};
const bekleMs = (ms) => new Promise((r) => setTimeout(r, ms));
/** İş'te Etkinlik metninde olmaması gerekenler: beyin (beyni, beyne, beynin… dahil) ve anatomi dili. */
const BEYIN_DILI = /bey(?:in|n[aeıiuü])|anatomi|korteks|\blob\b/i;
/** Eski bölge adları: sayfada tam sözcük olarak geçmez. */
const ESKI_AD = /(?<![\p{L}\p{N}])(?:Akıl|Bekçi|Eşlikçi|Raporcu|Not tutucu|Kulak|Göz|El|Uyanma)(?![\p{L}\p{N}])/u;
/** Model kimliği (iki modda da yok). */
const MODEL_KIMLIGI = /claude-[a-z]+-\d|gpt-4o|\bopus\b|\bsonnet\b|\bhaiku\b|bonsai/i;

const hatalar = [];
let u, w;
try {
  const ac = async () => {
    u = await electron.launch({ executablePath: electronYolu, args: [kok], env: ortam, timeout: 60000 });
    w = undefined;
    for (let i = 0; i < 120 && !w; i++) { w = u.windows().find((x) => x.url().includes('index.html')); if (!w) await bekleMs(250); }
    if (!w) throw new Error('ana pencere yok');
    w.on('pageerror', (e) => hatalar.push(String(e)));
    w.on('console', (m) => { if (m.type() === 'error') hatalar.push(m.text()); });
  };
  // Şemayı uygulama kursun, sonra sentetik demo verisi.
  await ac();
  await w.waitForSelector('.kokpit', { timeout: 30000 });
  await u.close();
  demoVerisiKur(veri);
  await ac();
  const bekle = (ms) => w.waitForTimeout(ms);
  const boyut = async (en, boy) => {
    await u.evaluate(({ BrowserWindow }, [e, b]) => { const x = BrowserWindow.getAllWindows().find((p) => p.webContents.getURL().includes('index.html')); x?.unmaximize(); x?.setContentSize(e, b); }, [en, boy]);
    await bekle(900);
  };
  await boyut(1440, 900);
  await w.waitForSelector('.kokpit', { timeout: 30000 });
  await bekle(1500);
  const cagir = (k, ...a) => w.evaluate(([kk, aa]) => window.fuber.cagir(kk, ...aa), [k, a]);
  const foto = async (ad) => { await w.mouse.move(1300, 860); await w.screenshot({ path: path.join(cikti, `${ad}.png`) }); console.log('  foto', ad); };
  const aktifSayfa = () => w.evaluate(() => document.querySelector('.ray__dgm[aria-current="page"]')?.dataset.tur ?? null);
  const rayGit = async (s) => { await w.locator(`.ray__dgm[data-tur="${s}"]`).click(); await w.mouse.move(1300, 860); await bekle(800); };
  const yolla = (kanal, veri_) => u.evaluate(({ BrowserWindow }, [k, v]) => { for (const b of BrowserWindow.getAllWindows()) b.webContents.send(k, v); }, [kanal, veri_]);
  let olayId = 7000;
  const olay = (o) => yolla('beyin:olay', { id: ++olayId, zaman: new Date().toISOString(), ...o });
  const tema = async (t) => { await cagir('ayarlar:kaydet', { gorunum: { tema: t } }); await bekle(900); return w.evaluate(() => document.documentElement.dataset.tema); };
  const mod = async (m) => { await cagir('ayarlar:kaydet', { mod: m }); await bekle(1200); };

  // Ana süreçteki 'beyin:durum' yanıtı (yalnız bu süreçte sahte). `hal`: bölge → hâl.
  const ESKI_HATA = 'Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}';
  const durumKur = (d) => u.evaluate(({ ipcMain }, [o, ids]) => {
    ipcMain.removeHandler('beyin:durum');
    ipcMain.handle('beyin:durum', () => ({
      bolgeler: ids.map((id) => ({ id, hal: o.hal?.[id] ?? 'hazir', aktif: o.hal?.[id] === 'calisiyor' ? 1 : 0, bugun: o.sayi?.[id] ?? 0 })),
      motorlar: [
        { id: 'anthropic', bagli: true, aktif: 0, bugun: 38 }, { id: 'openai', bagli: true, aktif: 0, bugun: 4 },
        { id: 'openrouter', bagli: false, aktif: 0, bugun: 0 }, { id: 'fuber', bagli: false, aktif: 0, bugun: 0 }, { id: 'yerel', bagli: false, aktif: 0, bugun: 0 },
      ],
      olaylar: [],
    }));
  }, [d, BOLGELER.map((b) => b.id)]);
  const BOS = { hal: { kulak: 'dinliyor', uyanma: 'dinliyor' }, sayi: { yazici: 186, ajan: 14, hafiza: 9, not: 6 } };
  const CANLI = { ...BOS, hal: { ...BOS.hal, ajan: 'calisiyor', hafiza: 'calisiyor' } };
  const sayfaMetni = () => w.evaluate(() => document.querySelector('.etkinlik')?.innerText ?? '');

  // ════════ 1) Ray ve açılış ════════
  console.log('Ray ve açılış');
  {
    const ray = await w.evaluate(() => [...document.querySelectorAll('.ray__dgm[data-tur]')].map((b) => [b.dataset.tur, b.getAttribute('aria-label'), b.querySelector('.ray__ipucu')?.dataset.kisayol]));
    kontrol('İş rayı: Kokpit, Sohbetler, Hafıza, Bağlantılar, Etkinlik (Ctrl+5), Ayarlar', JSON.stringify(ray.map(([t]) => t)) === JSON.stringify(['kokpit', 'sohbetler', 'hafiza', 'baglantilar', 'etkinlik', 'ayarlar'])
      && ray[4][1] === 'Etkinlik' && ray[4][2] === 'Ctrl+5', JSON.stringify(ray));
  }
  await durumKur(BOS);
  await w.keyboard.press('Control+5');
  await w.waitForSelector('.etkinlik', { timeout: 8000 }).catch(() => undefined);
  await bekle(700);
  kontrol('Ctrl+5 (İş) Etkinlik\'i açar', (await aktifSayfa()) === 'etkinlik' && (await w.locator('.etkinlik').count()) === 1, String(await aktifSayfa()));
  {
    const b = await w.evaluate(() => ({
      baslik: document.querySelector('.etkinlik .sayfa__bas .t-dev')?.textContent, alt: document.querySelector('.etkinlik .sayfa__bas .t-giris')?.textContent,
      bos: document.querySelector('.etk-bos')?.textContent ?? null, kartlar: [...document.querySelectorAll('.etkinlik .etk-kart')].map((k) => k.getAttribute('aria-label')),
      sol: [...document.querySelectorAll('.etkinlik .etk-kart')].map((k) => Math.round(k.getBoundingClientRect().left)),
    }));
    kontrol('Başlık "Etkinlik", alt yazı "Fuber’in şu an ne yaptığı ve bugün neler yaptığı."', b.baslik === 'Etkinlik' && b.alt === 'Fuber’in şu an ne yaptığı ve bugün neler yaptığı.', JSON.stringify(b));
    kontrol('TEK sütun: yalnız "Şu an" ve "Akış" kartı, ikisi de aynı soldan başlar', JSON.stringify(b.kartlar) === '["Şu an","Akış"]' && b.sol[0] === b.sol[1], JSON.stringify(b));
    kontrol('Akış boşken: "Henüz bir şey olmadı. Fuber çalıştıkça her adım burada saniyesiyle akar."', b.bos === 'Henüz bir şey olmadı. Fuber çalıştıkça her adım burada saniyesiyle akar.', JSON.stringify(b));
    const yok = await w.evaluate(() => ({ parca: document.querySelectorAll('[class*="etk-parca"], .etk-hap, .etk-motorlar').length, canvas: document.querySelectorAll('.etkinlik canvas, .etkinlik .b3, .etkinlik video').length }));
    kontrol('Parçalar bölümü, çalışan parça hapı, motor kartı, tuval ve video yok', yok.parca === 0 && yok.canvas === 0, JSON.stringify(yok));
    const metin = await sayfaMetni();
    kontrol('Sayfa metninde "Parçalar" ve eski bölge adları yok', !/Parçalar/.test(metin) && !ESKI_AD.test(metin), metin.slice(0, 200));
    const s = await w.evaluate(() => ({ baslik: document.querySelector('.etk-simdi__baslik')?.textContent, alt: document.querySelector('.etk-simdi__alt')?.textContent }));
    kontrol('Şu an (boşta): "Hazır", alt satır "Mikrofon dinliyor; Fuber hazır bekliyor."', s.baslik === 'Hazır' && s.alt === 'Mikrofon dinliyor; Fuber hazır bekliyor.', JSON.stringify(s));
  }
  await foto('koyu-etkinlik-bos');

  // ════════ 2) Canlı: sahte durum ve olaylar ════════
  console.log('Canlı olaylar');
  await durumKur(CANLI);
  await yolla('zihin:durum', 'dusunuyor');
  await olay({ tur: 'sinyal', bolge: 'ajan', hedef: 'saat', metin: 'Hatırlatıcı kuruyor: Ali’yi ara · 18:00' });
  await olay({ tur: 'basla', bolge: 'saat', metin: 'Hatırlatıcı kuruyor: Ali’yi ara · 18:00' });
  await olay({ tur: 'sinyal', bolge: 'saat', hedef: 'ajan', metin: 'Hatırlatıcı kuruldu' });
  await olay({ tur: 'motor', faz: 'istek', bolge: 'ajan', motor: 'anthropic', model: 'claude-opus-5-5', metin: 'sohbet' });
  await olay({ tur: 'sinyal', bolge: 'iletisim', hedef: 'ajan', metin: '3 e-posta okundu' });
  await bekle(900);
  {
    const a = await w.evaluate(() => {
      const satirlar = [...document.querySelectorAll('.etk-olay')].map((e) => [e.querySelector('.etk-olay__saat')?.textContent ?? '', e.querySelector('.etk-olay__metin b')?.textContent ?? '', e.querySelector('.etk-olay__metin small')?.textContent ?? '']);
      return { satirlar, s: { baslik: document.querySelector('.etk-simdi__baslik')?.textContent, alt: document.querySelector('.etk-simdi__alt')?.textContent, zihin: document.querySelector('.etk-simdi')?.dataset.zihin } };
    });
    kontrol('Akış: en yenisi üstte, düz cümleler ("3 e-posta okundu"), saati SS:DD:ss, ok işareti yok', a.satirlar.length === 4 && a.satirlar[0][1] === '3 e-posta okundu' && a.satirlar.every(([s]) => /^\d{2}:\d{2}:\d{2}$/.test(s))
      && !a.satirlar.some((x) => x.join(' ').includes('→')), JSON.stringify(a.satirlar));
    kontrol('Aynı araç satırı (sinyal + başlangıç) tek satır: "Hatırlatıcı kuruyor…" bir kez, ardından "Hatırlatıcı kuruldu"', a.satirlar.filter((x) => /^Hatırlatıcı kuruyor/.test(x[1])).length === 1
      && a.satirlar.some((x) => x[1] === 'Hatırlatıcı kuruldu'), JSON.stringify(a.satirlar));
    kontrol('"Şu an": "Düşünüyor"; alt satır düz adlarla ("Düşünme ve Hafıza çalışıyor")', a.s.baslik === 'Düşünüyor' && a.s.zihin === 'dusunuyor' && a.s.alt === 'Düşünme ve Hafıza çalışıyor', JSON.stringify(a.s));
  }
  await foto('koyu-etkinlik-canli');
  // Hatalı olay: kırmızı noktalı satır; İş'te ham hata yerine "bir sorun oldu". Kod olayı İş'te listelenmez.
  await olay({ tur: 'bitti', bolge: 'not', hata: true, metin: ESKI_HATA });
  await olay({ tur: 'sinyal', bolge: 'ajan', hedef: 'kod', metin: 'kod işi verdi', ayrinti: 'Claude Code' });
  await bekle(700);
  {
    const h = await w.evaluate(() => { const e = document.querySelector('.etk-olay'); return { hata: e?.hasAttribute('data-hata'), nokta: Boolean(e?.querySelector('.etk-olay__nokta .nokta--kirmizi')), metin: e?.textContent ?? '', kod: /Kod işi/.test(document.querySelector('.etkinlik')?.innerText ?? '') }; });
    kontrol('Hatalı olay kırmızı noktalı, İş\'te "Günün notları çalışırken bir sorun oldu" (ham hata yok); Kod olayı Akış\'ta yok',
      h.hata && h.nokta && /Günün notları çalışırken bir sorun oldu/.test(h.metin) && !/x-api-key|401/.test(h.metin) && !h.kod, JSON.stringify(h));
  }
  {
    const metin = await sayfaMetni();
    kontrol('İş: sayfa metninde sağlayıcı/model/teknik ad, "beyin", eski bölge adı ve model kimliği yok', !BEYIN_DILI.test(metin) && !ESKI_AD.test(metin) && !MODEL_KIMLIGI.test(metin) && !/Claude|OpenAI|OpenRouter|Anthropic/.test(metin), metin.slice(0, 300));
  }
  // En çok 60 satır.
  for (let i = 0; i < 70; i++) await olay({ tur: 'sinyal', bolge: 'ajan', hedef: 'hafiza', metin: `Bağlam okunuyor ${i}` });
  await bekle(900);
  kontrol('Akış en çok 60 satır', (await w.locator('.etk-olay').count()) === 60, String(await w.locator('.etk-olay').count()));

  // ════════ 3) Geliştirici: sağlayıcı adı kalabilir, model kimliği ve eski bölge adı yok ════════
  console.log('Geliştirici');
  await mod('gelistirici');
  await rayGit('etkinlik');
  await olay({ tur: 'motor', faz: 'istek', bolge: 'ajan', motor: 'anthropic', model: 'claude-opus-5-5', metin: 'sohbet' });
  await olay({ tur: 'sinyal', bolge: 'ajan', hedef: 'kod', metin: 'kod işi verdi', ayrinti: 'Claude Code' });
  await bekle(800);
  {
    const metin = await sayfaMetni();
    kontrol('Geliştirici: "Claude çalışıyor" ve "Kod işi verdi" satırları var; model kimliği ve eski bölge adı yok', /Claude çalışıyor/.test(metin) && /Kod işi verdi/.test(metin) && !MODEL_KIMLIGI.test(metin) && !ESKI_AD.test(metin), metin.slice(0, 300));
    kontrol('Geliştirici: Parçalar ve motor kartı yine yok', !/Parçalar|Motorlar/.test(metin), metin.slice(0, 200));
  }
  await foto('koyu-etkinlik-gelistirici');
  await mod('is');
  await rayGit('etkinlik');

  // ════════ 4) Üç tema × 1080×680 ve 1440×900: sayfa kaymaz; yalnız Akış kayar ════════
  console.log('Temalar ve boyutlar');
  for (const t of ['koyu', 'acik', 'sistem']) {
    await tema(t);
    for (const [en, boy] of [[1080, 680], [1440, 900]]) {
      await boyut(en, boy);
      await bekle(500);
      const o = await w.evaluate(() => {
        const e = document.querySelector('.etkinlik');
        const liste = document.querySelector('.etk-liste');
        return { kayar: e.scrollHeight > e.clientHeight + 1, listeKayar: liste ? liste.scrollHeight > liste.clientHeight + 1 : false, tema: document.documentElement.dataset.tema, tasan: [...document.querySelectorAll('.etk-kart')].some((k) => k.getBoundingClientRect().right > innerWidth + 1) };
      });
      kontrol(`${t} ${en}×${boy}: sayfa kaymaz, kartlar taşmaz (yalnız Akış kendi içinde kayar)`, !o.kayar && !o.tasan && o.listeKayar, JSON.stringify(o));
      await foto(`${t}-etkinlik-${en}`);
    }
  }
  await tema('koyu');
  await boyut(1440, 900);

  // ════════ 5) Hareketi azalt ════════
  console.log('Hareketi azalt');
  await w.emulateMedia({ reducedMotion: 'reduce' });
  await yolla('zihin:durum', 'dusunuyor');
  await olay({ tur: 'sinyal', bolge: 'ajan', hedef: 'hafiza', metin: 'Bağlam okunuyor' });
  await bekle(800);
  const hareketli = await w.evaluate(() => document.getAnimations().filter((a) => (a.playState === 'running' || a.playState === 'pending') && a.effect?.target?.closest?.('.etkinlik')).length);
  kontrol('Azaltılmış harekette sayfada çalışan animasyon yok (düşünürken ve yeni olayda bile)', hareketli === 0, String(hareketli));
  await w.emulateMedia({ reducedMotion: 'no-preference' });

  // ════════ 6) Eski sayfa adı: ana:git('beyin') → Etkinlik ════════
  console.log('Eski sayfa adı');
  await rayGit('kokpit');
  await u.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes('index.html'))?.webContents.send('ana:git', 'beyin'));
  await bekle(800);
  kontrol('ana:git(\'beyin\') Etkinlik\'i açar (boş sayfa değil)', (await aktifSayfa()) === 'etkinlik' && (await w.locator('.etkinlik').count()) === 1, String(await aktifSayfa()));
  await foto('koyu-etkinlik-ana-git');
} catch (h) {
  kontrol('HATA', false, h.stack);
} finally {
  kontrol('Konsol hatası yok', hatalar.length === 0, hatalar.join(' | '));
  await u?.close().catch(() => undefined);
  fs.rmSync(veri, { recursive: true, force: true });
  const hata = sonuclar.filter((s) => !s.tamam).length;
  console.log(`\n${sonuclar.length} denetim · ${hata} hata · çıktı: ${cikti}`);
  process.exitCode = hata ? 1 : 0;
}
