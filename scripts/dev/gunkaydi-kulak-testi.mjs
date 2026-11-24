// Gün kaydı kulak hattı testi: SAHTE mikrofona (Chromium --use-file-for-fake-audio-capture) Türkçe konuşma verilir;
// gerçek ortam dinlenmez. İki kip: (1) Vosk — kulak cihazda yazıya döker; (2) Whisper — kulak konuşma bölümünü
// halka arabellekten kesip 16 kHz WAV olarak gönderir; yerel SAHTE Whisper sunucusu (FUBER_WHISPER_TABAN) alır,
// WAV başlığını doğrular ve metin döner. Model çağrısı yok (eşlikçi kapalı, not tutucu bu testte tetiklenmez).
// (3) GERCEK_WHISPER_DIZIN verilirse GERÇEK Whisper: uygulama whisper.cpp v1.9.2 + modeli o klasöre indirip kurar
// (SHA-256 doğrulamalı; zaten kuruluysa indirmez), sunucuyu başlatır ve aynı konuşmayı gerçekten yazıya döker.
// Çalıştır: node scripts/dev/gunkaydi-kulak-testi.mjs <konuşma.wav>   [GERCEK_WHISPER_DIZIN=<klasör>]
import { KURULUM_SURUMU } from '../../src/shared/kurulum-adimlari.ts';
import { _electron as electron } from 'playwright-core';
import electronYolu from 'electron';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const kok = path.resolve(import.meta.dirname, '../..');
const wav = path.resolve(process.argv[2]);
const sonuclar = [];
const kaydet = (ad, tamam, ayrinti = '') => { sonuclar.push({ ad, tamam }); console.log(`${tamam ? '✅' : '❌'} ${ad}${ayrinti ? ` — ${String(ayrinti).slice(0, 300)}` : ''}`); };
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));

// Sahte Whisper: /inference multipart'ı alır, içindeki WAV'ın RIFF/16 kHz başlığını doğrular.
const gelen = [];
const sunucu = http.createServer((q, r) => {
  if (q.method !== 'POST') { r.writeHead(200); return r.end('ok'); }
  const parca = [];
  q.on('data', (d) => parca.push(d));
  q.on('end', () => {
    const govde = Buffer.concat(parca);
    const i = govde.indexOf('RIFF');
    const hiz = i >= 0 ? govde.readUInt32LE(i + 24) : 0;
    const boyut = i >= 0 ? govde.readUInt32LE(i + 40) : 0;
    const prompt = /name="prompt"\r\n\r\n([^\r]*)/.exec(govde.toString('latin1'))?.[1] ?? '';
    gelen.push({ hiz, saniye: boyut / 32000, prompt: Buffer.from(prompt, 'latin1').toString('utf8') });
    r.writeHead(200, { 'content-type': 'application/json' });
    r.end(JSON.stringify({ text: `SAHTE-WHISPER bolum ${gelen.length} (${(boyut / 32000).toFixed(1)} sn)` }));
  });
});
await new Promise((c) => sunucu.listen(0, '127.0.0.1', c));
const whisperTaban = `http://127.0.0.1:${sunucu.address().port}`;

const gercekDizin = process.env.GERCEK_WHISPER_DIZIN;

async function kip(motor, gercek = false) {
  const veri = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-gkulak-'));
  fs.writeFileSync(path.join(veri, 'ayarlar.json'), JSON.stringify({
    kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, tanitimSurumu: '0.9.0', kullaniciAdi: 'Deniz', hitap: 'Deniz', baslangictaAc: false,
    ses: { uyandirma: false, seslendirme: false }, proaktif: { etkin: false },
    gunKaydi: { etkin: true, rizaTarihi: new Date().toISOString(), calisma: { bas: '00:00', bit: '00:00', gunler: [0, 1, 2, 3, 4, 5, 6] }, kilitteDuraklat: false, motor, eslikci: 'kapali' },
  }));
  const env = { ...process.env, FUBER_VERI: veri, ...(gercek ? { FUBER_WHISPER_DIZINI: gercekDizin } : motor === 'whisper' ? { FUBER_WHISPER_TABAN: whisperTaban } : {}) };
  if (gercek) delete env.FUBER_WHISPER_TABAN;
  const u = await electron.launch({ executablePath: electronYolu, args: [kok, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`], env, timeout: 60000 });
  try {
    let w;
    for (let i = 0; i < 120 && !w; i++) { w = u.windows().find((x) => x.url().includes('index.html')); if (!w) await bekle(250); }
    await w.waitForSelector('.kokpit', { timeout: 30000 });
    const kulakVar = u.windows().some((x) => x.url().includes('kulak.html'));
    let satirlar = [];
    let kurulum = null;
    if (gercek) {
      // Gerçek Whisper: kur (gerekirse indir) ve sunucu çalışana dek bekle (en çok 25 dk).
      const k0 = Date.now();
      await w.evaluate(() => window.fuber.cagir('gunkaydi:whisper-indir'));
      let wd;
      for (let i = 0; i < 1500; i++) {
        wd = (await w.evaluate(() => window.fuber.cagir('gunkaydi:durum'))).whisper;
        if (wd?.indirme?.hata || (wd?.kurulu && wd?.calisiyor)) break;
        if (i % 30 === 0 && wd?.indirme) console.log(`   whisper: %${wd.indirme.yuzde} ${wd.indirme.adim}`);
        await bekle(1000);
      }
      kurulum = { ...wd, sn: (Date.now() - k0) / 1000 };
    }
    const t0 = Date.now();
    const yeter = (l) => (gercek ? l.filter((x) => x.motor === 'whisper').length >= 2 : l.length >= 2);
    for (let i = 0; i < (gercek ? 150 : 90) && !yeter(satirlar); i++) { await bekle(1000); satirlar = await w.evaluate(() => window.fuber.cagir('gunkaydi:dokum')); }
    const d = await w.evaluate(() => window.fuber.cagir('gunkaydi:durum'));
    return { kulakVar, satirlar, sure: (Date.now() - t0) / 1000, durum: d, kurulum };
  } finally {
    await u.close().catch(() => undefined);
    fs.rmSync(veri, { recursive: true, force: true });
  }
}

try {
  const v = await kip('vosk');
  kaydet('Vosk kipi: kulak açıldı (yalnız gün kaydı, "Hey Fuber" kapalı)', v.kulakVar, v.durum.yazici.aciklama);
  kaydet('Vosk kipi: konuşma yazıya döküldü', v.satirlar.length >= 1 && v.satirlar.every((s) => s.motor === 'vosk'), `${v.satirlar.length} satır, ${v.sure.toFixed(0)} sn: ${v.satirlar.map((s) => `“${s.metin}”`).join(' · ')}`);
  const sozcukler = v.satirlar.map((s) => s.metin).join(' ');
  kaydet('Vosk kipi: içerik doğru (kira/sözleşme/klasör/gün kaydı)', /(kira|sözleşme|klasör|kayd|deneme)/i.test(sozcukler), sozcukler.slice(0, 160));

  const s = await kip('whisper');
  kaydet('Whisper kipi: kulak WAV gönderdi (16 kHz)', gelen.length >= 1 && gelen.every((g) => g.hiz === 16000 && g.saniye > 0.5 && g.saniye <= 30.5), gelen.map((g) => `${g.saniye.toFixed(1)} sn`).join(', '));
  kaydet('Whisper kipi: sözlük ipucu gitti (Deniz, Fuber)', gelen.some((g) => /Deniz/.test(g.prompt) && /Fuber/.test(g.prompt)), gelen[0]?.prompt);
  kaydet('Whisper kipi: Whisper metni dökümde', s.satirlar.some((x) => x.motor === 'whisper' && x.metin.startsWith('SAHTE-WHISPER')), s.satirlar.map((x) => `${x.motor}: ${x.metin}`).join(' · '));

  if (gercekDizin) {
    const g = await kip('whisper', true);
    const k = g.kurulum ?? {};
    kaydet('Gerçek Whisper: kuruldu ve çalışıyor', Boolean(k.kurulu && k.calisiyor), k.indirme?.hata ?? `${k.model} · GPU ${k.gpu} · ${k.sn?.toFixed(0)} sn`);
    const ws = g.satirlar.filter((x) => x.motor === 'whisper');
    const metin = ws.map((x) => x.metin).join(' ');
    kaydet('Gerçek Whisper: konuşma yazıya döküldü', ws.length >= 1, `${ws.length} satır: ${ws.map((x) => `“${x.metin}”`).join(' · ')}`);
    const beklenen = ['gün', 'kaydı', 'denemesidir', 'kira', 'sözleşmesinin', 'taslağı', 'masaüstündeki', 'ev', 'klasöründe'];
    const kucuk = metin.toLocaleLowerCase('tr-TR');
    const tutan = beklenen.filter((x) => kucuk.includes(x));
    kaydet('Gerçek Whisper: içerik doğru (beklenen sözcüklerin en az %75’i)', tutan.length / beklenen.length >= 0.75, `${tutan.length}/${beklenen.length} sözcük · eksik: ${beklenen.filter((x) => !tutan.includes(x)).join(', ') || 'yok'}`);
  }
} catch (h) {
  kaydet('HATA', false, h.stack);
} finally {
  sunucu.close();
  const k = sonuclar.filter((x) => !x.tamam).length;
  console.log(`\n${sonuclar.length - k}/${sonuclar.length} geçti`);
  process.exitCode = k ? 1 : 0;
}
