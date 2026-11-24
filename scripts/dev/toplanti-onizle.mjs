// ═══ Toplantı modu önizlemesi (12 Kas 2026; PC'den gelen sesi anlık yazıya döker, istenen dile çevirir, Robot açıksa yanıt önerir) ═══
// GERÇEK uygulama (Electron, FUBER_DEMO, pencereler ekran dışı) ve GERÇEK yakalama hattı: Chromium'un sahte ses aygıtı (FUBER_TOPLANTI_DENEME_SESI) bu betiğin
// ürettiği sentetik konuşma WAV'ını mikrofon gibi verir → AudioWorklet → işçi (16 kHz + VAD) → IPC → ana süreç. Önizlemede "Karşı taraf" bu aygıttır, "Siz" aynı
// sesin 1,9 sn gecikmeli kopyası (sıra sıra konuşur). Yazıya çevirme, çeviri, öneri ve özet SAHTEDİR (FUBER_TOPLANTI_DENEME=1 → main/toplanti/sahte.ts): ağ yok,
// kredi yok. HİÇBİR ses çalınmaz (bağlam çıkışsız; hoparlöre bir şey gitmez), gerçek mikrofon açılmaz, ekranda pencere görünmez.
// Denetimler (başarısızsa çıkış 1): boştayken sayfada animasyon yok; rıza satırı birebir; kayıt işareti; iki konuşan ayrı çipte; çeviri her satırın yanında;
// Robot önerisi yalnız panelde; çentik "Toplantı · dinliyor", rayda Toplantı noktası; Durdur → özet + Yapılacaklar'a ekle; geçmişte listelenir, açılır, silinir;
// bitince iş izi ve animasyon kalmaz; İş dilinde teknik sözcük yok; sayfa hatası yok. Üç tema: koyu, açık, Şeffaf.
// 14 Kas: HIZLI KONUŞMA senaryosu (akisHizli): gerçek zamanlı akış sahte Scribe'a bağlanır; kısmi/kesin/çeviri gecikmeleri otomatik denetlenir (hedefler betikte), akış kopması ve belirteç yenilemesi sınanır.
// Çıktı: <çıktı>/<tema>-*.png. Çalıştır: npm run build && node scripts/dev/toplanti-onizle.mjs [çıktı-klasörü]
import { KURULUM_SURUMU } from '../../src/shared/kurulum-adimlari.ts';
import { TANITIM_SURUMU } from '../../src/shared/tanitim.ts';
import { RIZA_SATIRI, UYARI } from '../../src/shared/toplanti.ts';
import { isDiliIhlali } from '../../src/shared/is-dili.ts';
import { pcmdenWav } from '../../src/shared/pcm.ts';
import { sahteElevenLabs } from './sahte-elevenlabs.mjs';
import { _electron as electron } from 'playwright-core';
import electronYolu from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (process.env.FUBER_GORUNUR) { console.error('DUR: FUBER_GORUNUR ayarlı; bu betik yalnız arka plan kipinde koşar.'); process.exit(1); }
const kok = path.resolve(import.meta.dirname, '../..');
if (!fs.existsSync(path.join(kok, 'dist', 'main', 'main.js'))) { console.error('dist yok: önce npm run build'); process.exit(1); }
const cikti = path.resolve(process.argv[2] || path.join(kok, '.superpowers', 'toplanti'));
fs.mkdirSync(cikti, { recursive: true });
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const sonuclar = [];
let tema = '';
const kontrol = (a, tamam, ayrinti = '') => { sonuclar.push({ a: `[${tema}] ${a}`, tamam: Boolean(tamam) }); console.log(`${tamam ? '✅' : '❌'} [${tema}] ${a}${ayrinti && !tamam ? ` — ${String(ayrinti).slice(0, 600)}` : ''}`); };

// ── Sentetik konuşma: 1 sn sessizlik, sonra 1,2 sn konuşma + 3 sn sessizlik × 8 (48 kHz, 16 bit). Hiç çalınmaz; yalnız sahte aygıta verilir. ──
function sesUret(dosya) {
  const hz = 48_000;
  const parcalar = [];
  const sessiz = (sn) => { const n = Math.round(hz * sn); const o = new Float32Array(n); let x = 7; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; o[i] = ((x / 0x7fffffff) * 2 - 1) * 0.002; } return o; };
  const konus = (sn, f0) => { const n = Math.round(hz * sn); const o = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / hz; const z = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t); let s = 0; for (let h = 1; h <= 5; h++) s += Math.sin(2 * Math.PI * f0 * h * t) / h; o[i] = 0.2 * z * s * 0.5; } return o; };
  parcalar.push(sessiz(1));
  for (let k = 0; k < 8; k++) { parcalar.push(konus(1.2, k % 2 ? 190 : 140)); parcalar.push(sessiz(3)); }
  const n = parcalar.reduce((t, p) => t + p.length, 0);
  const i16 = new Int16Array(n);
  let o = 0;
  for (const p of parcalar) for (const v of p) i16[o++] = Math.round(v * 32767);
  fs.writeFileSync(dosya, pcmdenWav(new Uint8Array(i16.buffer), hz));
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-toplanti-'));
const wav = path.join(tmp, 'sahte-konusma.wav');
sesUret(wav);
const hatalar = [];

async function kos(t, tam, senaryo = '') {
  tema = t;
  const veri = path.join(tmp, `veri-${t}`);
  fs.mkdirSync(path.join(veri, 'belgeler'), { recursive: true });
  fs.writeFileSync(path.join(veri, 'ayarlar.json'), JSON.stringify({
    kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: TANITIM_SURUMU, kullaniciAdi: 'Deniz', hitap: 'Deniz', baslangictaAc: false, dil: 'tr',
    ses: { uyandirma: false, seslendirme: false }, proaktif: { etkin: false }, gorunum: { tema: t, adaSessiz: false }, kokpit: { gorevlerBosGorundu: true },
  }));
  const ortam = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('FUBER_SIR_') && k !== 'FUBER_GORUNUR'));
  Object.assign(ortam, { FUBER_DEMO: '1', FUBER_VERI: veri, FUBER_BELGELER: path.join(veri, 'belgeler'), FUBER_TEST_TAM_EKRAN: '0', FUBER_TEST_ANA_ONDE: '0', FUBER_TOPLANTI_DENEME: '1', FUBER_TOPLANTI_DENEME_SESI: wav, FUBER_TOPLANTI_DENEME_SENARYO: senaryo });
  let u;
  try {
    u = await electron.launch({ executablePath: electronYolu, args: [kok], env: ortam, timeout: 60000 });
    const pencere = async (p) => { for (let i = 0; i < 160; i++) { const w = u.windows().find((x) => x.url().includes(p)); if (w) return w; await bekle(250); } throw new Error(`${p} yok`); };
    const ana = await pencere('index.html');
    ana.on('pageerror', (e) => hatalar.push(`${t} ana: ${e}`));
    await ana.waitForSelector('.kokpit', { timeout: 30000 });
    const ada = await pencere('asistan.html');
    await u.evaluate(({ BrowserWindow }) => { const x = BrowserWindow.getAllWindows().find((p) => p.webContents.getURL().includes('index.html')); x?.unmaximize(); x?.setContentSize(1440, 900); });
    await u.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('asistan.html'))?.showInactive(); });
    const cagir = (k, ...a) => ana.evaluate(([kk, aa]) => window.fuber.cagir(kk, ...aa), [k, a]);
    await ana.click('.ray__dgm[data-tur="toplanti"]');
    await ana.waitForSelector('.toplanti', { timeout: 10000 });
    await bekle(1200);
    const etkinTema = await ana.evaluate(() => document.documentElement.dataset.tema);
    kontrol(`tema uygulandı (${etkinTema})`, etkinTema === t, etkinTema);
    const animasyon = () => ana.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.target?.closest?.('.toplanti, .ray')).map((a) => a.animationName ?? a.id));
    kontrol('Boşta: Toplantı sayfasında ve rayda çalışan animasyon yok', (await animasyon()).length === 0, JSON.stringify(await animasyon()));
    kontrol('Rıza satırı birebir görünür', (await ana.textContent('.tp-riza'))?.trim() === RIZA_SATIRI, await ana.textContent('.tp-riza'));
    // Üst şerit: hangi yazıya çevirme, hangi yapay zekâ (sade ad; İş dilinde tanıyıcı/model adı yok).
    const motor = async () => ana.evaluate(() => ({ yazi: document.querySelector('[data-motor="yazi"]')?.textContent ?? '', yz: document.querySelector('[data-motor="yz"]')?.textContent ?? '' }));
    const m0 = await motor();
    const beklenenYazi = senaryo === 'yerel-yol' ? 'Bu bilgisayar' : 'Fuber bulutu';
    kontrol(`Motor satırı (boşta): "Yazıya çevirme: ${beklenenYazi}" ve "Çeviri ve öneri: Fuber"`, m0.yazi.replace(/\s+/g, ' ').trim() === `Yazıya çevirme: ${beklenenYazi}` && m0.yz.replace(/\s+/g, ' ').trim() === 'Çeviri ve öneri: Fuber', JSON.stringify(m0));
    await ana.screenshot({ path: path.join(cikti, `${t}-1-bos.png`) });

    // Bağlam (koyu temada tam deneme): konu, katılımcılar, notlar, belge; panel kapanınca düğmede özet.
    const baglamKonu = 'Mavi Kuş yol haritası';
    if (tam) {
      await ana.click('[data-toplanti-eylem="baglam"]');
      await ana.waitForSelector('#tp-baglam', { timeout: 5000 });
      await ana.fill('#tp-baglam input[type="text"] >> nth=0', baglamKonu);
      await ana.fill('#tp-baglam input[type="text"] >> nth=1', 'Elif Kaya (tasarım), Mark Stone (ürün)');
      await ana.fill('#tp-baglam textarea', 'Bütçe 40.000 TL civarında; teslim cuma günü.');
      const belge = path.join(tmp, 'plan.md');
      fs.writeFileSync(belge, '# Mavi Kuş planı\n\nİlk aşama mobil sürümün yayınlanmasıdır. Güvenlik denetimini Delta Ekibi yapar.\n\nBütçe tablosu: geliştirme 40.000 TL.\n');
      await ana.setInputFiles('[data-toplanti-belge]', belge);
      await ana.waitForSelector('.tp-belge', { timeout: 10000 });
      const belgeAdi = await ana.textContent('.tp-belge');
      kontrol('Bağlam: belge eklendi (mevcut belge okuyucusundan; ad görünür)', /plan\.md/.test(belgeAdi ?? ''), belgeAdi);
      const hataMetni = await ana.evaluate(() => document.querySelector('.tp-baglam__hata')?.textContent ?? null);
      kontrol('Bağlam: belge hatası yok', hataMetni === null, hataMetni);
      await bekle(700);
      await ana.screenshot({ path: path.join(cikti, `${t}-1b-baglam.png`) });
      const panelMetni = await ana.evaluate(() => document.querySelector('#tp-baglam')?.innerText ?? '');
      kontrol('İş dili: Bağlam panelinde teknik sözcük yok', isDiliIhlali(panelMetni) === null, isDiliIhlali(panelMetni));
      await ana.click('[data-toplanti-eylem="baglam"]');
      await bekle(300);
      const dugme = await ana.textContent('[data-toplanti-eylem="baglam"]');
      kontrol('Bağlam kapanınca düğmede özet (konu · belge sayısı)', /Mavi Kuş/.test(dugme ?? '') && /1 belge/.test(dugme ?? ''), dugme);
    }

    // Robot açılır, başlatılır.
    await ana.click('.tp-alan--anahtar .anahtar');
    await ana.click('[data-toplanti-eylem="baslat"]');
    await ana.waitForSelector('.tp-kayit[data-kayit]', { timeout: 15000 });
    let r = null;
    for (let i = 0; i < 120; i++) {
      r = await ana.evaluate(() => ({
        satir: [...document.querySelectorAll('.tp-satir')].map((e) => ({ konusan: e.dataset.konusan, kesin: !e.hasAttribute('data-kesin'), ozgun: e.querySelector('.tp-satir__ozgun .tp-satir__metin')?.textContent ?? '', ceviri: e.querySelector('.tp-satir__ceviri .tp-satir__metin')?.textContent ?? '', dil: e.querySelector('.tp-dil')?.textContent ?? '' })),
        oneri: [...document.querySelectorAll('.tp-oneri[data-durum="hazir"] .tp-oneri__yanit')].map((e) => e.textContent),
      }));
      if (r.satir.filter((s) => s.kesin && s.konusan === 'karsi').length >= 3 && r.satir.some((s) => s.konusan === 'siz' && s.kesin) && r.oneri.length >= 1 && r.satir.filter((s) => s.kesin && s.konusan === 'karsi').every((s) => s.ceviri)) break;
      await bekle(250);
    }
    kontrol('Gerçek yakalama hattı: sahte aygıttan gelen konuşmalar satır oldu (Karşı taraf ve Siz ayrı)', r.satir.some((s) => s.konusan === 'karsi') && r.satir.some((s) => s.konusan === 'siz'), JSON.stringify(r.satir.slice(0, 4)));
    kontrol('Çeviri satır satır hizalı: her kesin karşı taraf satırının yanında kendi çevirisi', r.satir.filter((s) => s.kesin && s.konusan === 'karsi').every((s) => s.ceviri && s.ceviri !== s.ozgun), JSON.stringify(r.satir.map((s) => [s.ozgun.slice(0, 30), s.ceviri.slice(0, 30)])));
    kontrol('Dil rozeti sonuçtan (EN / TR)', r.satir.some((s) => s.dil === 'EN') && r.satir.some((s) => s.dil === 'TR'), JSON.stringify(r.satir.map((s) => s.dil)));
    kontrol('Robot: karşı tarafın sorusuna yanıt önerisi yalnız panelde', r.oneri.length >= 1, JSON.stringify(r.oneri));
    const ray = await ana.evaluate(() => document.querySelector('.ray__dgm[data-tur="toplanti"] .ray__is')?.dataset.isRay ?? null);
    const hap = await ada.evaluate(() => document.querySelector('.ada__katman:not(.ada__katman--cikan) .ada__is-hap')?.textContent ?? document.body.innerText);
    kontrol('İş izi: rayda Toplantı noktası canlı, çentik "Toplantı · dinliyor"', ray === 'canli' && /Toplantı · dinliyor/.test(hap), JSON.stringify({ ray, hap: hap.slice(0, 120) }));
    await ana.screenshot({ path: path.join(cikti, `${t}-2-canli.png`) });
    if (tam) await ada.screenshot({ path: path.join(cikti, `${t}-centik.png`), omitBackground: true }).catch(() => undefined);
    // Canlı: motor satırı süren toplantının gerçek yolunu söyler; bulut düşünce yerel tanıyıcıya geçilir ve çip sakin bilgi olur.
    const m1 = await motor();
    const canliYazi = senaryo === 'hesap-dustu' || senaryo === 'yerel-yol' ? 'Bu bilgisayar' : 'Fuber bulutu';
    kontrol(`Motor satırı (canlı): "Yazıya çevirme: ${canliYazi}"`, m1.yazi.replace(/\s+/g, ' ').trim() === `Yazıya çevirme: ${canliYazi}`, JSON.stringify(m1));
    const cipler = async () => ana.evaluate(() => [...document.querySelectorAll('.tp-durumcip')].map((e) => ({ metin: e.querySelector('.tp-durumcip__metin')?.textContent ?? '', seviye: e.dataset.seviye, eylem: e.dataset.eylem ?? null, dugme: e.querySelector('button')?.textContent ?? null })));
    const c1 = await cipler();
    if (senaryo === 'hesap-dustu') kontrol('Bulut düştü: toplantı yerelde sürüyor, çip sakin "bilgi" ve eylem düğmesiz', c1.length === 1 && c1[0].metin === 'Fuber bulutu kullanılamadı: Fuber sunucusunda yazıya çevirme henüz kurulu değil; bu bilgisayarda yazılıyor.' && c1[0].seviye === 'bilgi' && c1[0].dugme === null, JSON.stringify(c1));
    else if (senaryo === 'yerel-yol') kontrol('Hesapsız yerel yazıda geçişin nedeni çipte (sakin bilgi, "Fuber hesabı" eylemi)', c1.length === 1 && c1[0].metin === 'Fuber bulutu kullanılamadı: Fuber hesabına giriş yapılmamış; bu bilgisayarda yazılıyor.' && c1[0].seviye === 'bilgi' && c1[0].dugme === 'Fuber hesabı', JSON.stringify(c1));
    else kontrol('Normal toplantıda durum çipi yok (sarı uyarı yok)', c1.length === 0, JSON.stringify(c1));
    if (tam) {
      // Bilgisayarın sesi kesilir (çıkış aygıtı değişimi gibi): önce kendiliğinden yenilenir, uyarı çıkmaz.
      await ana.evaluate(() => window.__toplantiKes?.('karsi'));
      await bekle(2500);
      const c2 = await cipler();
      kontrol('Kaynak kesilince kendiliğinden yeniden açılır (uyarı çıkmaz)', c2.length === 0, JSON.stringify(c2));
      // Yenileme tutmazsa: tek cümle + "Yeniden aç"; düğme kaynağı geri getirir.
      await ana.evaluate(() => window.__toplantiKes?.('karsi', 2));
      await ana.waitForSelector('.tp-durumcip[data-eylem="karsi-yeniden"]', { timeout: 8000 }).catch(() => undefined);
      const c3 = await cipler();
      kontrol('Yenileme olmazsa: tek cümle + "Yeniden dene" düğmesi', c3.length === 1 && c3[0].metin === UYARI.karsiKesildi && c3[0].dugme === 'Yeniden dene' && c3[0].seviye === 'sorun', JSON.stringify(c3));
      await ana.screenshot({ path: path.join(cikti, `${t}-2b-uyari.png`) });
      await ana.click('.tp-durumcip[data-eylem="karsi-yeniden"] button');
      await bekle(1200);
      const c4 = await cipler();
      kontrol('"Yeniden dene" kaynağı geri getirdi, çip kalktı', c4.length === 0, JSON.stringify(c4));
    }
    const isMetni = await ana.evaluate(() => document.querySelector('.toplanti')?.innerText ?? '');
    kontrol('İş dili: Toplantı sayfasında teknik sözcük yok', isDiliIhlali(isMetni) === null, isDiliIhlali(isMetni));

    // Durdur → özet.
    await ana.click('[data-toplanti-eylem="durdur"]');
    await ana.waitForSelector('.tp-ozet .tp-ozet__bolum', { timeout: 20000 });
    await bekle(600);
    const ozet = await ana.evaluate(() => ({ bolum: [...document.querySelectorAll('.tp-ozet__ad')].map((e) => e.textContent), is: document.querySelectorAll('.tp-ozet__isler li').length, kayit: !document.querySelector('.tp-kayit[data-kayit]') }));
    kontrol('Durdur: özet (Ana noktalar, Kararlar, Yapılacaklar), kayıt işareti söndü', ozet.bolum.includes('Yapılacaklar') && ozet.bolum.includes('Ana noktalar') && ozet.is >= 1 && ozet.kayit, JSON.stringify(ozet));
    if (tam) {
      const baglamIzi = await ana.evaluate(() => ({ ozet: document.querySelector('.tp-ozet')?.innerText ?? '', oneri: [...document.querySelectorAll('.tp-oneri__ceviri')].map((e) => e.textContent) }));
      kontrol('Bağlam özet isteğine girdi (özette "Bağlam alındı: konu")', baglamIzi.ozet.includes(`Bağlam alındı: ${baglamKonu}`), baglamIzi.ozet.slice(0, 300));
      kontrol('Bağlam Robot önerisine girdi (öneri isteğinde konu)', baglamIzi.oneri.some((x) => x?.includes(`(${baglamKonu})`)), JSON.stringify(baglamIzi.oneri));
    }
    await ana.screenshot({ path: path.join(cikti, `${t}-3-ozet.png`) });
    if (tam) {
      await ana.click('.tp-ozet button:has-text("Hepsini")');
      await bekle(800);
      const liste = await cagir('yapilacak:liste');
      const basliklar = (liste?.gorevler ?? liste ?? []).map?.((g) => g.baslik) ?? [];
      kontrol('Yapılacaklar’a tek tıkla eklendi', JSON.stringify(liste).includes('Sürüm notlarını yaz'), JSON.stringify(basliklar).slice(0, 300));
    }
    // Bitti: iş izi ve animasyon kalmaz.
    await bekle(3200);
    const isIzi = await cagir('is-izi:liste');
    kontrol('Bitince iş izinde toplantı yok', !JSON.stringify(isIzi).includes('toplanti:'), JSON.stringify(isIzi).slice(0, 200));
    await ana.click('.tp-bitis button');
    await ana.waitForSelector('.tp-gecmis__oge', { timeout: 5000 }).catch(() => undefined);
    await bekle(500);
    kontrol('Bitince sayfada çalışan animasyon yok (boşta çizim yok)', (await animasyon()).length === 0, JSON.stringify(await animasyon()));
    const gecmis = await ana.evaluate(() => [...document.querySelectorAll('.tp-gecmis__baslik')].map((e) => e.textContent));
    kontrol('Geçmiş toplantılar: saklanan toplantı listede (başlık özetten)', gecmis.length === 1 && /Mobil sürüm/.test(gecmis[0]), JSON.stringify(gecmis));
    await ana.screenshot({ path: path.join(cikti, `${t}-4-gecmis.png`) });
    if (tam) {
      await ana.click('.tp-gecmis__ac');
      await ana.waitForSelector('.tp-ayrinti .tp-satir', { timeout: 5000 });
      await bekle(400);
      await ana.screenshot({ path: path.join(cikti, `${t}-5-ayrinti.png`) });
      const dosyalar = fs.readdirSync(path.join(veri, 'toplantilar'));
      kontrol('Kayıt bu bilgisayarda: toplantilar/<kimlik>.json', dosyalar.length === 1 && /^t-\d{8}-\d{6}-[a-z0-9]{4}\.json$/.test(dosyalar[0]), dosyalar.join(','));
      const kayit = JSON.parse(fs.readFileSync(path.join(veri, 'toplantilar', dosyalar[0]), 'utf8'));
      kontrol('Bağlam toplantı kaydıyla bu bilgisayarda saklandı (konu, katılımcılar, belge)', kayit.baglam?.konu === baglamKonu && /Elif/.test(kayit.baglam?.katilimcilar ?? '') && kayit.baglam?.belgeler?.length === 1 && /Delta Ekibi/.test(kayit.baglam.belgeler[0].metin), JSON.stringify(kayit.baglam).slice(0, 300));
      await ana.click('.tp-ayrinti__bas button:has-text("Sil")');
      await bekle(600);
      const geriAl = await ana.evaluate(() => document.body.innerText.includes('Geri al'));
      kontrol('Sil: Geri al tostu', geriAl);
      for (let i = 0; i < 40 && fs.readdirSync(path.join(veri, 'toplantilar')).length; i++) { await ana.mouse.move(5, 5); await bekle(250); }
      kontrol('Silme uygulandı (dosya kalktı)', fs.readdirSync(path.join(veri, 'toplantilar')).length === 0);
    }
  } catch (e) {
    kontrol('koşu', false, e?.stack ?? String(e));
  } finally {
    try { await u?.evaluate(({ app }) => app.quit()); } catch { /* */ }
    await bekle(1500);
    try { await u?.close(); } catch { /* */ }
  }
}

// Hesapsız ve yerel tanıyıcı kurulu değil: toplantı başlamaz, ne yapılacağı tek cümle + "indir" düğmesi (düğmeye BASILMAZ: gerçek indirme olmasın).
async function yolYok() {
  tema = 'yol-yok';
  const veri = path.join(tmp, 'veri-yolyok');
  fs.mkdirSync(path.join(veri, 'belgeler'), { recursive: true });
  fs.writeFileSync(path.join(veri, 'ayarlar.json'), JSON.stringify({ kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: TANITIM_SURUMU, kullaniciAdi: 'Deniz', hitap: 'Deniz', baslangictaAc: false, dil: 'tr', ses: { uyandirma: false, seslendirme: false }, proaktif: { etkin: false }, gorunum: { tema: 'koyu', adaSessiz: false }, kokpit: { gorevlerBosGorundu: true } }));
  const ortam = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('FUBER_SIR_') && k !== 'FUBER_GORUNUR'));
  Object.assign(ortam, { FUBER_DEMO: '1', FUBER_VERI: veri, FUBER_BELGELER: path.join(veri, 'belgeler'), FUBER_TEST_TAM_EKRAN: '0', FUBER_TEST_ANA_ONDE: '0', FUBER_TOPLANTI_DENEME: '1', FUBER_TOPLANTI_DENEME_SENARYO: 'yol-yok' });
  let u;
  try {
    u = await electron.launch({ executablePath: electronYolu, args: [kok], env: ortam, timeout: 60000 });
    let ana = null;
    for (let i = 0; i < 160 && !ana; i++) { ana = u.windows().find((x) => x.url().includes('index.html')) ?? null; if (!ana) await bekle(250); }
    ana.on('pageerror', (e) => hatalar.push(`yol-yok ana: ${e}`));
    await ana.waitForSelector('.kokpit', { timeout: 30000 });
    await u.evaluate(({ BrowserWindow }) => { const x = BrowserWindow.getAllWindows().find((p) => p.webContents.getURL().includes('index.html')); x?.unmaximize(); x?.setContentSize(1440, 900); });
    await ana.click('.ray__dgm[data-tur="toplanti"]');
    await ana.waitForSelector('.tp-engel', { timeout: 10000 });
    await bekle(800);
    const e = await ana.evaluate(() => ({
      kart: document.querySelector('.tp-engel')?.innerText ?? '', dugme: document.querySelector('[data-toplanti-eylem="whisper-indir"]')?.textContent ?? null,
      baslat: document.querySelector('[data-toplanti-eylem="baslat"]')?.disabled === true, yazi: document.querySelector('[data-motor="yazi"]')?.textContent ?? '', sayfa: document.querySelector('.toplanti')?.innerText ?? '',
    }));
    kontrol('Yol yok: engel kartı, "Yerel yazıya çevirmeyi indir" düğmesi (boyutla), Fuber hesabı seçeneği', /Yerel yazıya çevirmeyi indir/.test(e.dugme ?? '') && /Fuber hesabı/.test(e.kart), JSON.stringify(e).slice(0, 400));
    kontrol('Yol yok: Başlat kapalı, motor satırı "Kapalı"', e.baslat && /Kapalı/.test(e.yazi), JSON.stringify({ baslat: e.baslat, yazi: e.yazi }));
    kontrol('Yol yok: İş dilinde teknik sözcük yok', isDiliIhlali(e.sayfa) === null, isDiliIhlali(e.sayfa));
    await ana.screenshot({ path: path.join(cikti, 'yol-yok-1.png') });
  } catch (x) {
    kontrol('koşu', false, x?.stack ?? String(x));
  } finally {
    try { await u?.evaluate(({ app }) => app.quit()); } catch { /* */ }
    await bekle(1500);
    try { await u?.close(); } catch { /* */ }
  }
}

// ── 13 Kas 0.17.3: model / yazıya çevirme seçicisi ve kaynak hata çipleri ───────────────────────────────────────────────────────────────────
// Her senaryo kendi Electron'u ve veri klasörüyle açılır. `sesli`: Chromium'un sahte aygıtı sentetik WAV'ı verir (iki kaynak da aygıttan); değilse "Karşı taraf" GERÇEK
// loopback yolu (uygulamanın kendi getDisplayMedia işleyicisi; hiçbir ses çalınmaz), mikrofon sahte aygıt. Yazıya çevirme / yapay zekâ yine sahte.
async function senaryo(ad, { ayar = {}, ortamEk = {}, sesli = true }, is) {
  tema = ad;
  const veri = path.join(tmp, `veri-${ad}`);
  fs.mkdirSync(path.join(veri, 'belgeler'), { recursive: true });
  fs.writeFileSync(path.join(veri, 'ayarlar.json'), JSON.stringify({
    kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: TANITIM_SURUMU, kullaniciAdi: 'Deniz', hitap: 'Deniz', baslangictaAc: false, dil: 'tr',
    ses: { uyandirma: false, seslendirme: false, ...(ayar.ses ?? {}) }, proaktif: { etkin: false }, gorunum: { tema: 'koyu', adaSessiz: false }, kokpit: { gorevlerBosGorundu: true }, ...(ayar.ust ?? {}),
  }));
  const ortam = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('FUBER_SIR_') && k !== 'FUBER_GORUNUR'));
  Object.assign(ortam, { FUBER_DEMO: '1', FUBER_VERI: veri, FUBER_BELGELER: path.join(veri, 'belgeler'), FUBER_TEST_TAM_EKRAN: '0', FUBER_TEST_ANA_ONDE: '0', FUBER_TOPLANTI_DENEME: '1', ...(sesli ? { FUBER_TOPLANTI_DENEME_SESI: wav } : {}), ...ortamEk });
  let u;
  try {
    u = await electron.launch({ executablePath: electronYolu, args: [kok], env: ortam, timeout: 60000 });
    let ana = null;
    for (let i = 0; i < 160 && !ana; i++) { ana = u.windows().find((x) => x.url().includes('index.html')) ?? null; if (!ana) await bekle(250); }
    ana.on('pageerror', (e) => hatalar.push(`${ad} ana: ${e}`));
    await ana.waitForSelector('.kokpit', { timeout: 30000 });
    await u.evaluate(({ BrowserWindow }) => { const x = BrowserWindow.getAllWindows().find((p) => p.webContents.getURL().includes('index.html')); x?.unmaximize(); x?.setContentSize(1440, 900); });
    await ana.click('.ray__dgm[data-tur="toplanti"]');
    await ana.waitForSelector('.toplanti', { timeout: 10000 });
    await bekle(900);
    await is({ ana, veri, cagir: (k, ...a) => ana.evaluate(([kk, aa]) => window.fuber.cagir(kk, ...aa), [k, a]) });
  } catch (e) {
    kontrol('koşu', false, e?.stack ?? String(e));
  } finally {
    try { await u?.evaluate(({ app }) => app.quit()); } catch { /* */ }
    await bekle(1500);
    try { await u?.close(); } catch { /* */ }
  }
}
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
/** Bir üst şerit seçicisini açar, seçenek metinlerini döndürür (panel açık kalır). */
async function secenekleriOku(ana, motor) {
  await ana.click(`[data-motor="${motor}"] .secici`);
  await ana.waitForSelector('.secici__panel [role="option"]', { timeout: 5000 });
  return ana.evaluate(() => [...document.querySelectorAll('.secici__panel [role="option"]')].map((e) => ({ metin: (e.innerText ?? '').replace(/\s+/g, ' ').trim(), kapali: e.getAttribute('aria-disabled') === 'true' })));
}
const secenegiSec = async (ana, metin) => { await ana.click(`.secici__panel [role="option"]:has-text("${metin}")`); await bekle(500); };
const motorMetni = (ana, motor) => ana.evaluate((m) => (document.querySelector(`[data-motor="${m}"]`)?.textContent ?? '').replace(/\s+/g, ' ').trim(), motor);
const ceviriSayisi = (ana) => ana.evaluate(() => [...document.querySelectorAll('.tp-satir[data-konusan="karsi"] .tp-satir__ceviri .tp-satir__metin')].length);

async function secimSenaryolari() {
  // A) İş kipi + kendi Claude'un: sade adlar; süren toplantıda model değişir, sonraki istek yeni seçimi okur; seçim diske yazılır.
  await senaryo('secim-is', { ortamEk: { FUBER_TOPLANTI_DENEME_CLAUDE: '1' } }, async ({ ana, veri, cagir }) => {
    const yz = await secenekleriOku(ana, 'yz');
    kontrol('İş kipi: model seçenekleri sade ad (Hızlı / En güçlü / Dengeli …), model adı ya da kimlik yok', yz.map((x) => x.metin).join('|').replace(/ Uygulamanın seçimi/, '') === 'Fuber|Hızlı|En güçlü|Dengeli|Gelişmiş|Bu bilgisayar' && !yz.some((x) => /claude|haiku|opus|sonnet/i.test(x.metin)), JSON.stringify(yz));
    await ana.screenshot({ path: path.join(cikti, 'secim-is-1-model.png') });
    await ana.keyboard.press('Escape');
    const ys = await secenekleriOku(ana, 'yazi');
    kontrol('Yazıya çevirme seçenekleri: Fuber bulutu / Bu bilgisayar', ys.map((x) => x.metin).join('|') === 'Fuber bulutu|Bu bilgisayar', JSON.stringify(ys));
    await ana.keyboard.press('Escape');
    await ana.click('[data-toplanti-eylem="baslat"]');
    await ana.waitForSelector('.tp-kayit[data-kayit]', { timeout: 15000 });
    for (let i = 0; i < 80 && (await ceviriSayisi(ana)) < 2; i++) await bekle(250);
    let h = await cagir('toplanti:hazirlik');
    kontrol('Seçimden önce istekler uygulamanın bugünkü yoluyla', h.sonYz === 'varsayilan', JSON.stringify(h.sonYz));
    const once = await ceviriSayisi(ana);
    await secenekleriOku(ana, 'yz');
    await secenegiSec(ana, 'Dengeli');
    kontrol('Oturum sürerken seçim: üst şerit "Çeviri ve öneri: Dengeli"', (await motorMetni(ana, 'yz')) === 'Çeviri ve öneri: Dengeli', await motorMetni(ana, 'yz'));
    for (let i = 0; i < 100 && (await cagir('toplanti:hazirlik')).sonYz !== 'claude-sonnet-5-5'; i++) await bekle(250);
    h = await cagir('toplanti:hazirlik');
    kontrol('Değişiklik sonraki istekte devreye girdi (yapay zekâ isteği seçilen modelle)', h.sonYz === 'claude-sonnet-5-5' && (await ceviriSayisi(ana)) >= once, JSON.stringify(h.sonYz));
    await secenekleriOku(ana, 'yz');
    await secenegiSec(ana, 'Bu bilgisayar');
    for (let i = 0; i < 100 && (await cagir('toplanti:hazirlik')).sonYz !== 'yerel'; i++) await bekle(250);
    h = await cagir('toplanti:hazirlik');
    kontrol('"Bu bilgisayar"a geçince istekler yerel yapay zekâda', h.sonYz === 'yerel' && (await motorMetni(ana, 'yz')) === 'Çeviri ve öneri: Bu bilgisayar', JSON.stringify([h.sonYz, await motorMetni(ana, 'yz')]));
    await secenekleriOku(ana, 'yazi');
    await secenegiSec(ana, 'Bu bilgisayar');
    kontrol('Yazıya çevirme yolu oturum sürerken değişir ("Bu bilgisayar"), toplantı sürüyor', (await motorMetni(ana, 'yazi')) === 'Yazıya çevirme: Bu bilgisayar' && (await ana.$('.tp-kayit[data-kayit]')) !== null, await motorMetni(ana, 'yazi'));
    await ana.screenshot({ path: path.join(cikti, 'secim-is-2-canli.png') });
    const dosya = JSON.parse(fs.readFileSync(path.join(veri, 'toplanti-tercih.json'), 'utf8'));
    kontrol('Seçim kalıcı: toplanti-tercih.json { yz: "yerel", yazi: "yerel" }', dosya.yz === 'yerel' && dosya.yazi === 'yerel', JSON.stringify(dosya));
    const isMetni = await ana.evaluate(() => document.querySelector('.toplanti')?.innerText ?? '');
    kontrol('İş dili: seçici açıkken ve kapalıyken teknik sözcük yok', isDiliIhlali(isMetni) === null, isDiliIhlali(isMetni));
    await ana.click('[data-toplanti-eylem="durdur"]');
    await ana.waitForSelector('.tp-ozet .tp-ozet__bolum', { timeout: 20000 });
  });
  // B) Geliştirici: model adları.
  await senaryo('secim-gelistirici', { ayar: { ust: { mod: 'gelistirici' } }, ortamEk: { FUBER_TOPLANTI_DENEME_CLAUDE: '1' } }, async ({ ana, cagir }) => {
    const yz = await secenekleriOku(ana, 'yz');
    kontrol('Geliştirici: model adları (Claude Sonnet 5.5 …) ve "Bu bilgisayar"', ['Claude Sonnet 5.5', 'Claude Haiku 5.5', 'Claude Opus 5.5'].every((m) => yz.some((x) => x.metin.startsWith(m))) && yz.some((x) => x.metin.startsWith('Bu bilgisayar')), JSON.stringify(yz));
    await ana.screenshot({ path: path.join(cikti, 'secim-gelistirici-1-model.png') });
    await secenegiSec(ana, 'Claude Sonnet 5.5');
    kontrol('Seçim üst şeritte model adıyla', (await motorMetni(ana, 'yz')) === 'Çeviri ve öneri: Claude Sonnet 5.5', await motorMetni(ana, 'yz'));
    const ys = await secenekleriOku(ana, 'yazi');
    kontrol('Geliştirici: yazıya çevirme "Bu bilgisayar · Whisper"', ys.some((x) => x.metin.startsWith('Bu bilgisayar · Whisper')), JSON.stringify(ys));
    await ana.keyboard.press('Escape');
    await ana.click('[data-toplanti-eylem="baslat"]');
    await ana.waitForSelector('.tp-kayit[data-kayit]', { timeout: 15000 });
    for (let i = 0; i < 100 && (await cagir('toplanti:hazirlik')).sonYz !== 'claude-sonnet-5-5'; i++) await bekle(250);
    kontrol('İstek seçilen Claude modeliyle gitti', (await cagir('toplanti:hazirlik')).sonYz === 'claude-sonnet-5-5');
    await ana.click('[data-toplanti-eylem="durdur"]');
    await ana.waitForSelector('.tp-ozet .tp-ozet__bolum', { timeout: 20000 });
  });
  // C) Gizli: bulut seçeneği yok (P14); seçim ne olursa olsun yerel.
  await senaryo('secim-gizli', { ayar: { ust: { yerel: { etkin: true, gizliMod: true } } }, ortamEk: { FUBER_TOPLANTI_DENEME_CLAUDE: '1', FUBER_YEREL_TABAN: 'http://127.0.0.1:9' } }, async ({ ana, cagir }) => {
    const yz = await secenekleriOku(ana, 'yz');
    kontrol('Gizli: model listesinde YALNIZ "Bu bilgisayar" (bulut ve Claude satırı yok)', yz.length === 1 && yz[0].metin === 'Bu bilgisayar', JSON.stringify([yz, (await cagir('ayarlar:al')).yerel]));
    await ana.screenshot({ path: path.join(cikti, 'secim-gizli-1.png') });
    await ana.keyboard.press('Escape');
    const ys = await secenekleriOku(ana, 'yazi');
    kontrol('Gizli: yazıya çevirmede "Fuber bulutu" görünmez', ys.length === 1 && ys[0].metin.startsWith('Bu bilgisayar') && !ys.some((x) => /bulut/i.test(x.metin)), JSON.stringify(ys));
    await ana.keyboard.press('Escape');
    // Elle bulut tercihi yazılsa bile karar yerel (ana süreç her istekte Gizli'yi okur)
    await cagir('toplanti:tercih-yaz', { yz: 'claude-opus-5-5', yazi: 'bulut' });
    await ana.click('[data-toplanti-eylem="baslat"]');
    await ana.waitForSelector('.tp-kayit[data-kayit]', { timeout: 15000 });
    for (let i = 0; i < 100 && (await cagir('toplanti:hazirlik')).sonYz === ''; i++) await bekle(250);
    const h = await cagir('toplanti:hazirlik');
    kontrol('Gizli: bulut tercihi yazılsa da istekler yerel yapay zekâda; yol yerel', h.sonYz === 'yerel' && h.secenekler.yaziDeger === 'yerel', JSON.stringify([h.sonYz, h.secenekler.yaziDeger]));
    await ana.click('[data-toplanti-eylem="durdur"]');
    await ana.waitForSelector('.tp-ozet .tp-ozet__bolum', { timeout: 20000 });
  });
  // D) Bilgisayarın sesi GERÇEK loopback; "Mikrofonu tamamen kapat" açık → eskiden ikisi de düşerdi, şimdi toplantı karşı tarafla başlar, mikrofon çipte adıyla.
  await senaryo('kaynak-tek', { ayar: { ses: { mikrofonKapali: true } }, sesli: false }, async ({ ana, cagir }) => {
    await ana.click('[data-toplanti-eylem="baslat"]');
    await ana.waitForSelector('.tp-kayit[data-kayit]', { timeout: 15000 });
    await ana.waitForSelector('.tp-durumcip', { timeout: 8000 }).catch(() => undefined);
    const c = await ana.evaluate(() => [...document.querySelectorAll('.tp-durumcip')].map((e) => ({ metin: e.querySelector('.tp-durumcip__metin')?.textContent ?? '', eylem: e.dataset.eylem ?? null, dugme: e.querySelector('button')?.textContent ?? null })));
    kontrol('Mikrofon kapalıyken toplantı başladı (Kayıtta) ve çip eksik kaynağı adıyla söylüyor', c.length === 1 && c[0].metin === 'Mikrofon Fuber ayarlarında kapalı; yalnız karşı taraf yazılıyor.' && c[0].dugme === 'Mikrofonu aç', JSON.stringify(c));
    kontrol('Teknik iz yok (hata adı / "Permission")', !/Error|Permission|denied/.test(c[0]?.metin ?? ''), JSON.stringify(c));
    await ana.screenshot({ path: path.join(cikti, 'kaynak-tek-1-cip.png') });
    await ana.click('.tp-durumcip[data-eylem="mikrofon-ac"] button');
    for (let i = 0; i < 40 && (await ana.$('.tp-durumcip')); i++) await bekle(250);
    const ayar = await cagir('ayarlar:al');
    kontrol('"Mikrofonu aç": ayar kapandı, mikrofon açıldı, çip kalktı, toplantı sürüyor', ayar.ses.mikrofonKapali === false && !(await ana.$('.tp-durumcip')) && (await ana.$('.tp-kayit[data-kayit]')) !== null, JSON.stringify({ kapali: ayar.ses.mikrofonKapali }));
    await ana.click('[data-toplanti-eylem="durdur"]');
    await ana.waitForSelector('.tp-kayit:not([data-kayit])', { timeout: 20000 }).catch(() => undefined);
  });
  // E) İki kaynak da yok (sahte aygıt + mikrofon kapalı): toplantı başlamaz; her kaynak için neden + eylem; "Mikrofonu aç" sonrası yeniden başlatılır.
  await senaryo('kaynak-iki', { ayar: { ses: { mikrofonKapali: true } }, sesli: true }, async ({ ana }) => {
    await ana.click('[data-toplanti-eylem="baslat"]');
    await ana.waitForSelector('.tp-durumcip', { timeout: 15000 });
    await bekle(600);
    const c = await ana.evaluate(() => [...document.querySelectorAll('.tp-durumcip')].map((e) => ({ metin: e.querySelector('.tp-durumcip__metin')?.textContent ?? '', dugme: e.querySelector('button')?.textContent ?? null })));
    const metinler = c.map((x) => x.metin);
    kontrol('İki kaynak yok: başlamadı cümlesi + her kaynak için neden (Bilgisayar sesi / Mikrofon) ve eylem', metinler.includes('Ne bilgisayarın sesi ne mikrofon alınabildi; toplantı başlamadı.') && metinler.includes('Bilgisayar sesi paylaşılamadı.') && metinler.includes('Mikrofon Fuber ayarlarında kapalı.') && c.some((x) => x.dugme === 'Mikrofonu aç') && c.some((x) => x.dugme === 'Yeniden dene'), JSON.stringify(c));
    await ana.screenshot({ path: path.join(cikti, 'kaynak-iki-1-cipler.png') });
    await ana.click('.tp-durumcip[data-eylem="mikrofon-ac"] button');
    await bekle(800);
    await ana.click('[data-toplanti-eylem="baslat"]');
    await ana.waitForSelector('.tp-kayit[data-kayit]', { timeout: 15000 });
    kontrol('"Mikrofonu aç"tan sonra Başlat: toplantı başladı, çip yok', (await ana.$('.tp-durumcip')) === null, JSON.stringify(await ana.evaluate(() => document.querySelector('.tp-durum')?.innerText)));
    await ana.click('[data-toplanti-eylem="durdur"]');
    await ana.waitForSelector('.tp-kayit:not([data-kayit])', { timeout: 20000 }).catch(() => undefined);
  });
}


// ── 14 Kas: HIZLI KONUŞMA senaryosu — gerçek zamanlı akış (sahte Scribe: yalnız 127.0.0.1) + gecikme denetimi ─────────────────────────────────────────────────────
// Toplantı modunda yazıya çevirme çok uzun sürüyordu; hedef, akan yazı. Chromium'un sahte aygıtı kesintisiz hızlı konuşmayı (3,4 sn'lik cümleler,
// aralarında 250 ms) mikrofon gibi verir; GERÇEK yakalama hattı (işçi + VAD akış kipi + IPC + ana süreç + akış istemcisi) sahte ElevenLabs'e bağlanır. Sayfa, her satırın
// metin/kesin/çeviri değişimini MutationObserver ile zaman damgalar; sahte sunucu kısmi/kesin iletiyi gönderdiği anı kaydeder. Ölçülen: iletinin sayfada GÖRÜNME gecikmesi
// (ağ + ana süreç + IPC + çizim; sahte modelin kendi gecikmesi hariç), kesin metnin satırı sabitlemesi, çevirinin kesin cümleden sonra akması. Sahte model gecikmeleri:
// kısmi 150 ms, kesin 250 ms; VAD bitiş sessizliği 450 ms (toplanti-vad.ts VAD_AKIS) → konuşma sonu → kesin metin ≈ 450 + 250 + görünme gecikmesi.
function hizliSesUret(dosya) {
  const hz = 48_000;
  const parcalar = [];
  const sessiz = (sn) => { const n = Math.round(hz * sn); const o = new Float32Array(n); let x = 7; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; o[i] = ((x / 0x7fffffff) * 2 - 1) * 0.002; } return o; };
  const konus = (sn, f0) => { const n = Math.round(hz * sn); const o = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / hz; const z = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t); let s = 0; for (let h = 1; h <= 5; h++) s += Math.sin(2 * Math.PI * f0 * h * t) / h; o[i] = 0.2 * z * s * 0.5; } return o; };
  parcalar.push(sessiz(1));
  for (let r = 0; r < 2; r++) { for (let k = 0; k < 4; k++) { parcalar.push(konus(3.4, 130 + ((r * 4 + k) % 3) * 20)); parcalar.push(sessiz(0.25)); } parcalar.push(sessiz(1.6)); }
  const n = parcalar.reduce((t, p) => t + p.length, 0);
  const i16 = new Int16Array(n);
  let o = 0;
  for (const p of parcalar) for (const v of p) i16[o++] = Math.round(v * 32767);
  fs.writeFileSync(dosya, pcmdenWav(new Uint8Array(i16.buffer), hz));
}
const yuzde = (l, p) => { const s = l.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))] : null; };

/** Sayfaya yerleşen gözlemci: her satırın metin değişimlerini, kesinleşmeyi ve çevirinin akışını Date.now() ile damgalar; animasyon özellikleri ve yerleşim kayması da tutulur. */
const gozlemciKur = () => {
  const o = (window.__olcum = { satir: {}, anim: [], cls: 0, enCokKesinOlmayan: 0 });
  const liste = document.querySelector('.tp-dokum__liste');
  const isle = () => {
    const t = Date.now();
    let acik = 0;
    for (const e of liste.querySelectorAll('.tp-satir[data-satir]')) {
      const id = e.dataset.satir;
      const g = (o.satir[id] ??= { id, konusan: e.dataset.konusan, olustu: t, metinler: [] });
      const m = e.querySelector('.tp-satir__ozgun .tp-satir__metin')?.textContent ?? '';
      const gercek = m && m !== '…';
      if (gercek && g.metinler.at(-1)?.m !== m) g.metinler.push({ m, t });
      const kesin = !e.hasAttribute('data-kesin');
      if (!kesin) acik++;
      if (kesin && g.kesin === undefined && gercek) g.kesin = t;
      const cv = e.querySelector('.tp-satir__ceviri');
      const cm = cv?.querySelector('.tp-satir__metin')?.textContent ?? '';
      if (cm && cm !== '…' && g.ceviriIlk === undefined && kesin) g.ceviriIlk = t;
      if (cv?.dataset.durum === 'tamam' && g.ceviriTam === undefined) g.ceviriTam = t;
    }
    o.enCokKesinOlmayan = Math.max(o.enCokKesinOlmayan, acik);
  };
  new MutationObserver(isle).observe(liste, { subtree: true, childList: true, attributes: true, characterData: true });
  const yaz = (a) => {
    try {
      if (a.transitionProperty) { o.anim.push(`gecis:${a.transitionProperty}`); return; }
      for (const kf of a.effect.getKeyframes()) for (const k of Object.keys(kf)) if (!['offset', 'easing', 'composite', 'computedOffset'].includes(k)) o.anim.push(`anim:${k}`);
    } catch { /* */ }
  };
  for (const ad of ['animationstart', 'transitionrun']) document.addEventListener(ad, (e) => { if (e.target?.closest?.('.toplanti')) for (const a of e.target.getAnimations()) yaz(a); }, true);
  try { new PerformanceObserver((l) => { for (const x of l.getEntries()) if (!x.hadRecentInput) o.cls += x.value; }).observe({ type: 'layout-shift', buffered: true }); } catch { /* */ }
};

async function akisHizli() {
  const kelimeler = (on) => Array.from({ length: 4000 }, (_, i) => `${on}${i + 1}`);
  const eleven = await sahteElevenLabs({ scribe: { kismi: [], kesin: '', akisli: { kelimeHizi: 2.6, kelimeler: { karsi: kelimeler('k'), siz: kelimeler('s') }, gecikmeMs: 150, commitMs: 250, herBelirtec: true } } });
  const hizliWav = path.join(tmp, 'hizli-konusma.wav');
  hizliSesUret(hizliWav);
  await senaryo('akis-hizli', { ortamEk: { FUBER_TOPLANTI_DENEME_SCRIBE: eleven.adres, FUBER_TOPLANTI_DENEME_SESI: hizliWav } }, async ({ ana, cagir }) => {
    await ana.click('[data-toplanti-eylem="baslat"]');
    await ana.waitForSelector('.tp-kayit[data-kayit]', { timeout: 15000 });
    await ana.waitForSelector('.tp-dokum__liste', { timeout: 5000 });
    await ana.evaluate(gozlemciKur);
    const etiket = await ana.evaluate(() => document.querySelector('.tp-kayit__metin')?.textContent ?? '');
    const sag = await ana.evaluate(() => document.querySelector('.tp-kontrol')?.innerText ?? '');
    kontrol('Üst şeritte yalnız "Canlı" durumu var; gecikme (ms / saniye) göstergesi yok', etiket === 'Canlı' && !/\b\d+\s*(ms|sn)\b|gecikme|latency/i.test(sag.replace(/\d+:\d{2}(:\d{2})?/g, '')), JSON.stringify([etiket, sag]));
    // ~26 sn canlı: iki akış (Karşı taraf, Siz) kesintisiz hızlı konuşmayı yazar.
    let enCokAcik = 0;
    for (let i = 0; i < 52; i++) { await bekle(500); enCokAcik = Math.max(enCokAcik, await ana.evaluate(() => document.querySelectorAll('.tp-satir[data-kesin]').length)); }
    await ana.screenshot({ path: path.join(cikti, 'akis-hizli-1-canli.png') });
    const canliYazi = await ana.evaluate(() => [...document.querySelectorAll('.tp-satir')].map((e) => ({ konusan: e.dataset.konusan, kesin: !e.hasAttribute('data-kesin'), metin: e.querySelector('.tp-satir__ozgun .tp-satir__metin')?.textContent ?? '', ceviri: e.querySelector('.tp-satir__ceviri .tp-satir__metin')?.textContent ?? '' })));
    const o = await ana.evaluate(() => window.__olcum);
    const sunucudan = eleven.scribeOturumlari.flatMap((s) => (s.cikanlar ?? []).map((c) => ({ ...c, konusan: s.konusan })));
    const oturumlar = eleven.scribeOturumlari.filter((s) => (s.cikanlar ?? []).length || s.parcalar > 0);

    kontrol('İki ayrı Scribe akışı (Karşı taraf + Siz) açık; ses parça parça değil, sürekli PCM akışı (pcm_16000, commit_strategy=manual)', ['karsi', 'siz'].every((k) => oturumlar.some((s) => s.konusan === k && s.sorgu.audio_format === 'pcm_16000' && s.sorgu.commit_strategy === 'manual' && !s.sorgu.language_code && s.bayt > 32000 * 5)), JSON.stringify(eleven.scribeOturumlari.map((s) => [s.konusan, s.sorgu?.audio_format, s.bayt])));
    kontrol('Belirteç adreste, anahtar başlığı yok', eleven.scribeOturumlari.every((s) => s.anahtar === undefined && /^(karsi|siz)-\d+$/.test(s.belirtec ?? '')), JSON.stringify(eleven.scribeOturumlari.map((s) => s.belirtec)));
    kontrol('Canlı yazı: iki konuşan da satır yazdı, kesin satırlar var', ['karsi', 'siz'].every((k) => canliYazi.some((s) => s.konusan === k && s.kesin && s.metin)), JSON.stringify(canliYazi.slice(0, 4)));
    kontrol('Metinler karışmadı: Karşı taraf yalnız kendi sözcüklerini (k…), Siz kendilerini (s…) yazdı', canliYazi.every((s) => !s.metin || (s.konusan === 'karsi' ? /^k\d/.test(s.metin) && !/\bs\d/.test(s.metin) : /^s\d/.test(s.metin) && !/\bk\d/.test(s.metin))), JSON.stringify(canliYazi.map((s) => [s.konusan, s.metin.slice(0, 30)]).slice(0, 8)));

    // Gecikmeler (ms).
    const sat = Object.values(o.satir);
    const gorunme = [];
    let eslenmeyen = 0;
    // Sunucu her ses bloğunda aynı metni yeniden gönderebilir: yalnız İLK kez çıkan (konuşan + metin) sayılır.
    const ilkCikan = new Map();
    for (const c of sunucudan.filter((x) => x.tur === 'kismi')) { const a = `${c.konusan}|${c.metin}`; if (!ilkCikan.has(a)) ilkCikan.set(a, c); }
    for (const c of ilkCikan.values()) {
      const g = sat.filter((s) => s.konusan === c.konusan).flatMap((s) => s.metinler).find((x) => x.m === c.metin && x.t >= c.t - 3);
      if (g) gorunme.push(g.t - c.t); else eslenmeyen++;
    }
    const kesinG = [];
    for (const c of sunucudan.filter((x) => x.tur === 'kesin' && x.metin)) {
      const s = sat.find((x) => x.konusan === c.konusan && x.metinler.at(-1)?.m === c.metin && x.kesin !== undefined);
      if (s) kesinG.push(s.kesin - c.t);
    }
    const ceviriIlk = sat.filter((s) => s.kesin !== undefined && s.ceviriIlk !== undefined).map((s) => s.ceviriIlk - s.kesin);
    const ceviriTam = sat.filter((s) => s.kesin !== undefined && s.ceviriTam !== undefined).map((s) => s.ceviriTam - s.kesin);
    const ozet = (l) => `n=${l.length} p50=${yuzde(l, 0.5)} p95=${yuzde(l, 0.95)} en çok=${yuzde(l, 1)}`;
    console.log(`   ölçüm · kısmi metin görünme: ${ozet(gorunme)} (eşlenmeyen ${eslenmeyen}) · kesin sabitleme: ${ozet(kesinG)} · çeviri ilk harf: ${ozet(ceviriIlk)} · çeviri tamam: ${ozet(ceviriTam)}`);
    kontrol(`Kısmi metin sunucudan çıkınca ≤ 150 ms'de satırda (p95; konuşma başından görünene ≈ model + bu ${yuzde(gorunme, 0.95)} ms)`, gorunme.length >= 20 && yuzde(gorunme, 0.95) <= 150 && yuzde(gorunme, 1) <= 500, ozet(gorunme));
    kontrol('Kısmi iletilerin çoğu satırda görüldü (kuyruk birikmedi, ileti kaybı yok)', gorunme.length >= 20 && gorunme.length / (gorunme.length + eslenmeyen) >= 0.5, `${gorunme.length} / ${gorunme.length + eslenmeyen}`);
    kontrol(`Kesin metin ≤ 150 ms'de satırı sabitledi (p95 ${yuzde(kesinG, 0.95)}); konuşma sonundan kesine ≈ 450 (VAD) + 250 (model) + ${yuzde(kesinG, 0.95)} ≤ 1 sn`, kesinG.length >= 4 && yuzde(kesinG, 0.95) <= 150 && 450 + 250 + yuzde(kesinG, 0.95) <= 1000, ozet(kesinG));
    kontrol(`Çeviri kesin cümleden sonra akmaya başladı ≤ 800 ms (p95), tamamlandı ≤ 1500 ms (p95)`, ceviriIlk.length >= 4 && yuzde(ceviriIlk, 0.95) <= 800 && yuzde(ceviriTam, 0.95) <= 1500, `${ozet(ceviriIlk)} | ${ozet(ceviriTam)}`);
    kontrol('Hızlı ve kesintisiz konuşmada kuyruk birikmedi: aynı anda en çok 4 kesinleşmemiş satır (2 konuşan × açık + commit bekleyen)', enCokAcik <= 4 && o.enCokKesinOlmayan <= 4, `${enCokAcik} / ${o.enCokKesinOlmayan}`);
    kontrol('Animasyon yalnız transform / opacity (canlı dökümde)', o.anim.length > 0 && o.anim.every((x) => /:(opacity|transform)$/.test(x)), JSON.stringify([...new Set(o.anim)]));
    kontrol(`Satır kaymıyor: toplam yerleşim kayması ≤ 0,1 (${o.cls.toFixed(3)})`, o.cls <= 0.1, String(o.cls));
    // Durdur → bekleyen yok, hepsi kesin, özet.
    await ana.click('[data-toplanti-eylem="durdur"]');
    await ana.waitForSelector('.tp-ozet .tp-ozet__bolum', { timeout: 20000 });
    const kalan = await ana.evaluate(() => document.querySelectorAll('.tp-satir[data-kesin]').length);
    kontrol('Durdur sonrası kesinleşmemiş satır kalmadı; akışlar kapandı (açık soket yok)', kalan === 0 && eleven.acikWsSayisi() === 0, JSON.stringify([kalan, eleven.acikWsSayisi()]));
    await ana.screenshot({ path: path.join(cikti, 'akis-hizli-2-ozet.png') });
    void cagir;
  });
  // Sunucu akışı kopar: sessizce yeniden bağlanır, metin kaybolmaz.
  await senaryo('akis-kopma', { ortamEk: { FUBER_TOPLANTI_DENEME_SCRIBE: eleven.adres, FUBER_TOPLANTI_DENEME_SESI: hizliWav } }, async ({ ana }) => {
    await ana.click('[data-toplanti-eylem="baslat"]');
    await ana.waitForSelector('.tp-kayit[data-kayit]', { timeout: 15000 });
    await bekle(6000);
    const once = eleven.scribeOturumlari.length;
    eleven.soketDusur('karsi');
    eleven.soketDusur('siz');
    await bekle(9000);
    const d = await ana.evaluate(() => ({ cip: [...document.querySelectorAll('.tp-durumcip')].map((e) => e.textContent), satir: [...document.querySelectorAll('.tp-satir')].filter((e) => !e.hasAttribute('data-kesin')).length }));
    kontrol('Akış koptu: sessizce yeniden bağlandı (yeni oturum), uyarı çipi yok, yazı sürüyor', eleven.scribeOturumlari.length > once && d.cip.length === 0 && d.satir >= 2, JSON.stringify([eleven.scribeOturumlari.length - once, d]));
    await ana.click('[data-toplanti-eylem="durdur"]');
    await ana.waitForSelector('.tp-ozet .tp-ozet__bolum', { timeout: 20000 });
  });
  // Belirteç ömrü kısa (30 sn): konuşma sürerken belirteç yenilenir, kesintisiz.
  await senaryo('akis-yenileme', { ortamEk: { FUBER_TOPLANTI_DENEME_SCRIBE: eleven.adres, FUBER_TOPLANTI_DENEME_SESI: hizliWav, FUBER_TOPLANTI_DENEME_SURE: '30' } }, async ({ ana }) => {
    const once = eleven.scribeOturumlari.length;
    await ana.click('[data-toplanti-eylem="baslat"]');
    await ana.waitForSelector('.tp-kayit[data-kayit]', { timeout: 15000 });
    await bekle(34000);
    const yeni = eleven.scribeOturumlari.slice(once);
    const karsi = yeni.filter((s) => s.konusan === 'karsi');
    kontrol('Belirteç ömrü dolmadan yenisi alındı: Karşı taraf için ikinci bağlantı açıldı, ikisi de ses aldı', karsi.length >= 2 && karsi.every((s) => s.bayt > 0), JSON.stringify(karsi.map((s) => [s.belirtec, s.bayt])));
    const kayip = await ana.evaluate(() => document.querySelectorAll('.tp-satir[data-konusan="karsi"]').length);
    kontrol('Yenileme sırasında satırlar sürdü (kesinti yok)', kayip >= 3, String(kayip));
    await ana.click('[data-toplanti-eylem="durdur"]');
    await ana.waitForSelector('.tp-ozet .tp-ozet__bolum', { timeout: 20000 });
  });
  await eleven.kapat();
}

// ── 14 Kas 0.18.2: takılan satır, geçiş çipi ve Ayrıntılar ───────────────────────────────────────────────────────────────────────────────────────
// 0.18.1'de görülen hata: hesapsız, yerel yazıya çevirme hiç yanıt vermiyor → her satır sonsuza dek "…" ve hiç çip yoktu. Burada yerel tanıyıcı ASILI (yerel-asili senaryosu),
// satır zaman aşımı 4 sn: satırlar "yazıya çevrilemedi" olmalı, "…" kalmamalı; geçiş çipi nedeni söylemeli; Ayrıntılar açılır ve alanları göstermeli.
async function takilanSatir() {
  await senaryo('takilan-satir', { ortamEk: { FUBER_TOPLANTI_DENEME_SENARYO: 'yerel-asili', FUBER_TOPLANTI_DENEME_ZAMAN: '4000' } }, async ({ ana }) => {
    await ana.click('[data-toplanti-eylem="baslat"]');
    await ana.waitForSelector('.tp-kayit[data-kayit]', { timeout: 15000 });
    await bekle(3000);
    const once = await ana.evaluate(() => ({ nokta: document.querySelectorAll('.tp-satir .tp-nokta').length, satir: document.querySelectorAll('.tp-satir').length, hata: document.querySelectorAll('[data-satir-hata]').length }));
    kontrol('Süre dolmadan: satırlar "…" (henüz hata değil)', once.satir >= 1 && once.hata === 0, JSON.stringify(once));
    await bekle(7000);
    const sonra = await ana.evaluate(() => ({
      // Sonuçlanmış (kesin) satırda "…" olmamalı; konuşma sürerken yeni açılan satır (henüz süresi dolmadı) elbette "…" olabilir.
      nokta: document.querySelectorAll('.tp-satir:not([data-kesin]) .tp-nokta').length,
      hata: [...document.querySelectorAll('[data-satir-hata]')].map((e) => e.textContent),
      cip: [...document.querySelectorAll('.tp-durumcip')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
      kesinsiz: [...document.querySelectorAll('.tp-satir')].filter((e) => e.hasAttribute('data-kesin') && !e.querySelector('[data-satir-hata]')).length,
    }));
    kontrol('Süre dolunca: sonuçlanan hiçbir satır "…" kalmadı, satırlar "yazıya çevrilemedi"', sonra.nokta === 0 && sonra.hata.length >= 1 && sonra.hata.every((m) => m === 'yazıya çevrilemedi'), JSON.stringify(sonra));
    kontrol('Geçiş çipi nedeni söyler: Fuber bulutu kullanılamadı: Fuber hesabına giriş yapılmamış; bu bilgisayarda yazılıyor.', sonra.cip.some((c) => c.startsWith('Fuber bulutu kullanılamadı: Fuber hesabına giriş yapılmamış; bu bilgisayarda yazılıyor.')) || sonra.cip.some((c) => /yazıya çevrilemedi|sürüyor/.test(c)), JSON.stringify(sonra.cip));
    await ana.click('[data-toplanti-tani] > summary');
    await bekle(300);
    const tani = await ana.evaluate(() => ({ acik: document.querySelector('[data-toplanti-tani]')?.open === true, metin: (document.querySelector('[data-toplanti-tani]')?.innerText ?? '').replace(/\s+/g, ' ') }));
    kontrol('Ayrıntılar açılır: motor, bağlantı, son hata, gelen parça ve metin sayıları', tani.acik && /Yazıya çevirme/.test(tani.metin) && /Bağlantı/.test(tani.metin) && /Son hata/.test(tani.metin) && /Gelen ses parçası\s*\d+/.test(tani.metin) && /Metin dönen satır\s*\d+/.test(tani.metin) && /Yazıya çevrilemeyen\s*[1-9]/.test(tani.metin), tani.metin);
    await ana.screenshot({ path: path.join(cikti, 'takilan-satir-1.png') });
    await ana.click('[data-toplanti-eylem="durdur"]');
    await ana.waitForSelector('.tp-ozet', { timeout: 20000 }).catch(() => undefined);
  });
}

// FUBER_ONIZLE_SADECE=akis: yalnız hızlı konuşma / akış senaryoları (geliştirme sırasında hızlı tekrar).
if (process.env.FUBER_ONIZLE_SADECE === 'takilan') {
  await takilanSatir();
} else if (process.env.FUBER_ONIZLE_SADECE !== 'akis') {
  await kos('koyu', true);
  await kos('acik', false, 'hesap-dustu');
  await kos('cam', false, 'yerel-yol');
  await yolYok();
  await secimSenaryolari();
  await takilanSatir();
}
if (process.env.FUBER_ONIZLE_SADECE !== 'takilan') await akisHizli();
tema = 'genel';
kontrol('Sayfa hatası yok', hatalar.length === 0, hatalar.join(' | '));
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
const kalan = sonuclar.filter((s) => !s.tamam);
console.log(`\n${sonuclar.length - kalan.length}/${sonuclar.length} denetim geçti · görüntüler: ${cikti}`);
process.exit(kalan.length ? 1 : 0);
