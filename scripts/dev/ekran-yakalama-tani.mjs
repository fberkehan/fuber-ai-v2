// desktopCapturer tanısı: imlecin olduğu ekranda (TANI_EKRAN=birincil → birincil ekranda) mavi test penceresi açılır; her ekran yakalanır, parlaklık
// için JPEG kaydedilir. Birincil ekran görüntüsü kaydedilmez (yalnız ortalama döner).
import { _electron as electron } from 'playwright-core';
import electronYolu from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const [kok, klasor] = process.argv.slice(2);
const veri = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-dc-veri-'));
fs.writeFileSync(path.join(veri, 'ayarlar.json'), JSON.stringify({ baslangictaAc: false, ses: { uyandirma: false } }));
const u = await electron.launch({ executablePath: electronYolu, args: [kok], env: { ...process.env, FUBER_VERI: veri }, timeout: 60000 });
const onEk = process.env.TANI_EKRAN === 'birincil' ? 'birincil-' : '';
await new Promise((c) => setTimeout(c, 2500));
for (const kip of ['tam-ekran', 'buyutulmus']) {
  const sonuc = await u.evaluate(async ({ BrowserWindow, screen, desktopCapturer }, kip) => {
    for (const x of BrowserWindow.getAllWindows()) if (x.getTitle() === 'TANI') x.destroy();
    const d = process.env.TANI_EKRAN === 'birincil' ? screen.getPrimaryDisplay() : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const t = new BrowserWindow({ ...d.bounds, title: 'TANI', backgroundColor: '#3060ff', fullscreen: kip === 'tam-ekran', alwaysOnTop: true });
    if (kip === 'buyutulmus') t.maximize();
    await t.loadURL('data:text/html,<title>TANI</title><body style="margin:0;background:%233060ff"></body>');
    await new Promise((c) => setTimeout(c, 1500));
    const kaynaklar = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 960, height: 540 } });
    return {
      imlecEkrani: String(d.id), olcek: d.scaleFactor, dip: d.bounds, fiziksel: screen.dipToScreenRect(null, d.bounds),
      ekranlar: screen.getAllDisplays().map((x) => ({ id: String(x.id), dip: x.bounds, olcek: x.scaleFactor })),
      kaynaklar: kaynaklar.map((k) => ({ id: k.display_id, boyut: k.thumbnail.getSize(), jpeg: k.display_id === String(d.id) ? k.thumbnail.toJPEG(80).toString('base64') : null })),
    };
  }, kip);
  for (const k of sonuc.kaynaklar) if (k.jpeg) fs.writeFileSync(path.join(klasor, `dc-${onEk}${kip}.jpg`), Buffer.from(k.jpeg, 'base64'));
  console.log(kip, JSON.stringify({ ...sonuc, kaynaklar: sonuc.kaynaklar.map((k) => ({ id: k.id, boyut: k.boyut, kayit: Boolean(k.jpeg) })) }));
}
await u.close();
fs.rmSync(veri, { recursive: true, force: true });
