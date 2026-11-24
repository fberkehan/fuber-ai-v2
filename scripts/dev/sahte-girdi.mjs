// Sahte fuber-girdi (yalnız test): fuber-girdi.exe ile AYNI JSON-satır protokolü. "Ekran" başsız Edge'de çizilen bir
// test sayfasıdır (1920×1080 fiziksel, 3840,0'da ikinci ekranmış gibi; görüntü gerçek yardımcı gibi 1366 px'e
// küçültülür). Tıklama/yazma sayfaya gider. Kilitli oturumda (gerçek girdi engelliyken) ajan döngüsünü uçtan uca
// sınamak için: model gerçekten bakar, koordinat verir, tıklar, yazar. Durum FUBER_SAHTE_DURUM dosyasına yazılır.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import readline from 'node:readline';

const X0 = 3840, Y0 = 0, W = 1920, H = 1080, GW = 1366;
const tarayici = await chromium.launch({ channel: 'msedge', headless: true });
const sayfa = await tarayici.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: GW / W });
await sayfa.setContent(`<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>FUBER BİLGİSAYAR TESTİ</title></head>
  <body style="margin:0;background:#101318;color:#fff;font-family:Segoe UI,sans-serif;height:100vh;display:grid;place-items:center">
  <div style="text-align:center"><h1 style="font-size:64px;margin:0 0 40px">FUBER BİLGİSAYAR TESTİ</h1>
  <input id="kutu" placeholder="Buraya yaz" style="font-size:40px;padding:20px 26px;width:760px;border-radius:16px;border:3px solid #7aa2ff;background:#fff;color:#000"><br><br>
  <button id="kaydet" style="font-size:40px;padding:20px 70px;border-radius:999px;border:0;background:#fff;color:#000;font-weight:700"
    onclick="document.getElementById('sonuc').textContent='KAYDEDİLDİ: '+document.getElementById('kutu').value">KAYDET</button>
  <p id="sonuc" style="font-size:40px;color:#9fe0a0;min-height:60px"></p></div></body></html>`);
const gunluk = (s) => { if (process.env.FUBER_SAHTE_GUNLUK) fs.appendFileSync(process.env.FUBER_SAHTE_GUNLUK, `${s}\n`); };
const durumYaz = async () => {
  if (!process.env.FUBER_SAHTE_DURUM) return;
  const d = await sayfa.evaluate(() => ({ kutu: document.getElementById('kutu').value, sonuc: document.getElementById('sonuc').textContent }));
  fs.writeFileSync(process.env.FUBER_SAHTE_DURUM, JSON.stringify(d));
};
const tusAdi = (k) => k.split('+').map((p) => ({ ctrl: 'Control', alt: 'Alt', shift: 'Shift', win: 'Meta', enter: 'Enter', tab: 'Tab', esc: 'Escape', escape: 'Escape', backspace: 'Backspace', delete: 'Delete', space: ' ' })[p] ?? (p.length === 1 ? p : p[0].toUpperCase() + p.slice(1))).join('+');

async function isle(k) {
  switch (k.k) {
    case 'ekran': {
      const jpeg = await sayfa.screenshot({ type: 'jpeg', quality: 72 });
      return { ok: true, jpeg: jpeg.toString('base64'), x0: X0, y0: Y0, w: W, h: H, gw: GW, gh: Math.round(H * GW / W), kilitli: false, karanlik: false };
    }
    case 'ekranlar': return { ok: true, ekranlar: [{ x: 0, y: 0, w: 3840, h: 2160, birincil: true }, { x: X0, y: Y0, w: W, h: H, birincil: false }] };
    case 'imlec': return { ok: true, x: X0 + 100, y: 100 };
    case 'kilit': return { ok: true, kilitli: false };
    case 'tasi': await sayfa.mouse.move(k.x - X0, k.y - Y0); return { ok: true };
    case 'yolla': await sayfa.mouse.move(k.x - X0, k.y - Y0, { steps: 12 }); return { ok: true }; // yardımcıdaki yumuşak eğri hareket
    case 'tikla': await sayfa.mouse.click(k.x - X0, k.y - Y0, { button: k.d === 'sag' ? 'right' : k.d === 'orta' ? 'middle' : 'left', clickCount: k.adet ?? 1 }); return { ok: true };
    case 'yaz': await sayfa.keyboard.type(String(k.metin ?? '')); return { ok: true };
    case 'tus': await sayfa.keyboard.press(tusAdi(String(k.kombin ?? ''))); return { ok: true };
    case 'kaydir': await sayfa.mouse.wheel((k.dx ?? 0) * 100, -(k.dy ?? 0) * 100); return { ok: true };
    case 'surukle': await sayfa.mouse.move(k.x1 - X0, k.y1 - Y0); await sayfa.mouse.down(); await sayfa.mouse.move(k.x2 - X0, k.y2 - Y0, { steps: 8 }); await sayfa.mouse.up(); return { ok: true };
    case 'pencereler': return { ok: true, pencereler: [{ baslik: 'FUBER BİLGİSAYAR TESTİ', surec: 'msedge', on: true, kucuk: false }] };
    case 'odakla': return { ok: true };
    case 'referans': return { ok: true };
    // FUBER_SAHTE_DOKUNUS dosyası varsa "kullanıcı fareye dokundu" sayılır (devralma testini kilitli oturumda sınamak için).
    case 'kullanici': return { ok: true, degdi: Boolean(process.env.FUBER_SAHTE_DOKUNUS && fs.existsSync(process.env.FUBER_SAHTE_DOKUNUS)), ms: 0 };
    // Adanın tam ekranı bu yardımcıda değil: olay güdümlü fuber-olay (sahtesi: sahte-olay.mjs).
    default: return { ok: false, hata: `Bilinmeyen komut: ${k.k}` };
  }
}

const rl = readline.createInterface({ input: process.stdin });
for await (const satir of rl) {
  if (!satir.trim()) continue;
  let yanit;
  try { const k = JSON.parse(satir); gunluk(JSON.stringify({ ...k, metin: k.metin })); yanit = await isle(k); await durumYaz(); }
  catch (e) { yanit = { ok: false, hata: e.message }; }
  process.stdout.write(`${JSON.stringify(yanit)}\n`);
}
await tarayici.close();
