import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const kok = import.meta.dirname;

// vosk-browser modeli WASM dosya sistemine açar ve IndexedDB'ye önbelleğe yazar (IDBFS). Electron'da özel `fuber://`
// kökenindeki blob işçisinde bu yazım "FS error" ile düşüyor; yarım kalan yazım "extracted.ok" işaretini bırakıp model
// dosyalarını bırakmadığı için sonraki açılışlar da "model dosyası yok" hatası veriyordu → uyandırma hiç çalışmıyordu.
// Yama: IDBFS hiç bağlanmaz (bellek içi dosya sistemi); model her açılışta yerel 37 MB'lık paketten birkaç saniyede
// açılır. İşçi kodu paketin içinde base64 gömülüdür.
function voskOnbellekYamasi(): Plugin {
  const ESKI = 'this.Vosk.FS.mount(this.Vosk.IDBFS, {}, storagePath);';
  const YENI = '/* fuber: IDBFS disabled (in-memory) */';
  return {
    name: 'fuber-vosk-onbellek-yamasi',
    transform(kod, id) {
      if (!id.replace(/\\/g, '/').includes('vosk-browser/dist/vosk.js')) return null;
      const m = kod.match(/createBase64WorkerFactory\('([A-Za-z0-9+/=]+)'/);
      if (!m) throw new Error('vosk-browser işçi kodu bulunamadı (sürüm değişti mi?)');
      const isci = Buffer.from(m[1], 'base64').toString('latin1');
      if (!isci.includes(ESKI)) throw new Error('vosk-browser eşitleme satırı bulunamadı (sürüm değişti mi?)');
      let duz = isci.replace(ESKI, YENI);
      if (process.env.FUBER_VOSK_AYIKLA) duz = duz.replace('this.model = new this.Vosk.Model(modelPath);', "try { const F = this.Vosk.FS; console.log('FUBER-AYIKLA', JSON.stringify(F.readdir(modelPath)), JSON.stringify(F.readdir(modelPath + '/am')), JSON.stringify(F.readdir(modelPath + '/conf')), F.stat(modelPath + '/am/final.mdl').size, F.readFile(modelPath + '/conf/model.conf', { encoding: 'utf8' })); } catch (h) { console.log('FUBER-AYIKLA hata', String(h)); } this.model = new this.Vosk.Model(modelPath);");
      const yeni = Buffer.from(duz, 'latin1').toString('base64');
      return { code: kod.replace(m[1], yeni), map: null };
    },
  };
}

// Arayüz: src/renderer → dist/renderer. Uygulama `fuber://app/` özel protokolünden yüklenir (main.ts), bu yüzden
// göreli taban ('./'). Üç giriş: ana pencere, sağ alttaki sesli asistan katmanı ve görünmez dinleyici ("kulak").
export default defineConfig({
  root: resolve(kok, 'src/renderer'),
  base: './',
  plugins: [react(), voskOnbellekYamasi()],
  build: {
    outDir: resolve(kok, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome140',
    chunkSizeWarningLimit: 6500,
    rollupOptions: {
      input: {
        index: resolve(kok, 'src/renderer/index.html'),
        asistan: resolve(kok, 'src/renderer/asistan.html'),
        kulak: resolve(kok, 'src/renderer/kulak.html'),
        imlec: resolve(kok, 'src/renderer/imlec.html'),
        // Fuber Tarayıcı'nın kendi arayüzü (araç çubuğu, başlangıç sayfası); sayfanın kendisi ayrı görünümde (src/main/tarayici.ts).
        tarayici: resolve(kok, 'src/renderer/tarayici.html'),
      },
    },
  },
});
