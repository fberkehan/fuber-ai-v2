// ── Dosya yolları ────────────────────────────────────────────────────────────────────────────────────────────
// Bütün veri KULLANICININ BİLGİSAYARINDA: %APPDATA%\Fuber AI\ (veritabanı, ayarlar, oturumlar) ve kullanıcının
// gördüğü Belgeler\Fuber AI\ (içe aktarma klasörü, dışa aktarımlar). FUBER_VERI ortam değişkeni testlerde ayrı bir
// veri klasörü kullandırır (gerçek veriye dokunulmaz).
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { DAGITIM } from '../shared/dagitim.js';

const kok = () => process.env.FUBER_VERI || app.getPath('userData');

export const yollar = {
  veri: () => kok(),
  veritabani: () => path.join(kok(), 'fuber.db'),
  ayarlar: () => path.join(kok(), 'ayarlar.json'),
  sirlar: () => path.join(kok(), 'sirlar.json'),
  whatsappOturum: () => path.join(kok(), 'whatsapp-oturum'),
  tarayiciProfil: () => path.join(kok(), 'tarayici'),
  gunluk: () => path.join(kok(), 'gunluk'),
  belgeler: () => (process.env.FUBER_BELGELER ? process.env.FUBER_BELGELER : path.join(app.getPath('documents'), DAGITIM.urunAdi)),
  varsayilanIceAktar: () => path.join(yollar.belgeler(), 'İçe Aktar'),
  /** Paketlenmiş uygulamada resources/, geliştirmede proje kökündeki resources/. */
  kaynak: (...p: string[]) =>
    app.isPackaged ? path.join(process.resourcesPath, 'kaynak', ...p) : path.join(app.getAppPath(), 'resources', ...p),
  arayuz: (...p: string[]) => path.join(app.getAppPath(), 'dist', 'renderer', ...p),
  preload: () => path.join(app.getAppPath(), 'dist', 'preload', 'preload.cjs'),
  /** Fuber Tarayıcı oturumunun submit izcisi (0.14 T15 düzeltme turu 3): bütün çerçevelere oturum önyüklemesi olarak yüklenir. */
  submitIzci: () => path.join(app.getAppPath(), 'dist', 'preload', 'submit-izci.cjs'),
};

export function klasorHazirla(): void {
  for (const k of [yollar.veri(), yollar.gunluk(), yollar.belgeler()]) fs.mkdirSync(k, { recursive: true });
}
