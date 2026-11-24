// Yerel Whisper tanısı (14 Kas 2026, 0.18.2): sunucu günlüğünden gerçek donanım, hata → tek cümle + eylem, işlemcide hızlı model, hata arındırma, hesap neden eşleme.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WHISPER_CUDA_SURUMU, WHISPER_YAVAS_MS, WhisperHatasi, etkinWhisperModeli, gecikmeOrtalamasi, hataArindir, sunucuDonanimi, sunucuGunlukOzeti, whisperSorunu } from '../src/shared/whisper-tani.ts';
import { type HesapAyari } from '../src/shared/masaustu-hesap.ts';
import { isDiliIhlali } from '../src/shared/is-dili.ts';
import fs from 'node:fs';
import path from 'node:path';

// Paketli ortamda yakalanan GERÇEK günlükler (whisper.cpp v1.9.2; cublas-11.8.0 arşivi cublas64_11.dll'siz).
const GUNLUK_CPU_DUSTU = [
  'load_backend: loaded CPU backend from C:\\x\\ggml-cpu-cascadelake.dll',
  'whisper_init_with_params_no_state: use gpu    = 1',
  'whisper_backend_init_gpu: device 0: CPU (type: 0)',
  'whisper_backend_init_gpu: no GPU found',
].join('\n');
const GUNLUK_CUDA = [
  'ggml_cuda_init: found 1 CUDA devices (Total VRAM: 16375 MiB):',
  '  Device 0: NVIDIA GeForce RTX 4080 SUPER, compute capability 8.9, VMM: yes, VRAM: 16375 MiB',
  'whisper_init_with_params_no_state: use gpu    = 1',
].join('\n');

test('sunucu günlüğünden donanım: "no GPU found" → cpu (sessiz işlemci düşüşü yakalanır), "found 1 CUDA devices" → cuda, söylemediyse null', () => {
  assert.equal(sunucuDonanimi(GUNLUK_CPU_DUSTU), 'cpu');
  assert.equal(sunucuDonanimi(GUNLUK_CUDA), 'cuda');
  assert.equal(sunucuDonanimi('whisper_init_from_file_with_params_no_state: loading model'), null);
  assert.equal(sunucuDonanimi('whisper_backend_init_gpu: device 0: NVIDIA GeForce RTX 4080 SUPER'), 'cuda');
});

test('işlemcide büyük model hızlı modele iner (turbo işlemcide ~11 sn/istek, small ~1,8 sn); GPU\'da seçim aynen kalır; zaten küçük model aynen', () => {
  assert.equal(etkinWhisperModeli('large-v3-turbo-q5_0', 'cpu'), 'small-q5_1');
  assert.equal(etkinWhisperModeli('large-v3-q5_0', 'cpu'), 'small-q5_1');
  assert.equal(etkinWhisperModeli('large-v3-turbo-q5_0', 'cuda'), 'large-v3-turbo-q5_0');
  assert.equal(etkinWhisperModeli('small-q5_1', 'cpu'), 'small-q5_1');
  assert.equal(etkinWhisperModeli('large-v3-turbo-q5_0', undefined), 'large-v3-turbo-q5_0', 'kurulu değilken karar kurulumda verilir');
});

test('NVIDIA arşivi CUDA 12.4 (11.8 arşivi cublas içermiyordu); yavaşlık eşiği canlı yazı için anlamlı', () => {
  assert.equal(WHISPER_CUDA_SURUMU, '12.4.0');
  assert.ok(WHISPER_YAVAS_MS >= 2000 && WHISPER_YAVAS_MS <= 5000);
  const kaynak = fs.readFileSync(path.resolve(import.meta.dirname, '../src/main/gunkaydi/whisper.ts'), 'utf8');
  assert.ok(!/cublas-11\.8\.0/.test(kaynak), 'kurulum eski arşivi indirmez');
  assert.match(kaynak, /whisper-cublas-\$\{WHISPER_CUDA_SURUMU\}-bin-x64\.zip/);
});

test('whisperSorunu: her neden tek cümle; indirmeyle çözülenlerde eylem "whisper-indir", yavaşlıkta sakin bilgi; İş dilinde teknik sözcük yok', () => {
  const t = (n: ConstructorParameters<typeof WhisperHatasi>[0]) => whisperSorunu(new WhisperHatasi(n));
  assert.equal(t('model-yok').eylem, 'whisper-indir');
  assert.match(t('model-yok').metin, /Yerel ses tanıma eksik/);
  assert.equal(t('baslamadi').eylem, 'whisper-indir');
  assert.equal(t('gpu-yok').eylem, 'whisper-indir');
  assert.equal(t('zaman-asimi').eylem, undefined);
  assert.equal(t('cokme').eylem, undefined);
  assert.equal(t('yavas').seviye, 'bilgi');
  assert.equal(whisperSorunu(new Error('The operation was aborted due to timeout')).neden, 'zaman-asimi');
  assert.equal(whisperSorunu(new Error('beklenmedik')).neden, 'bilinmeyen');
  for (const n of ['model-yok', 'baslamadi', 'zaman-asimi', 'cokme', 'gpu-yok', 'yavas', 'bilinmeyen'] as const) {
    const s = t(n);
    assert.ok(s.metin.endsWith('.') && !s.metin.includes('\n'), n);
    assert.equal(isDiliIhlali(s.metin), null, `${n}: İş dilinde yasak sözcük`);
  }
});

test('hataArindir: Windows yolu (boşluklu klasör dahil) ve anahtar benzeri dizi maskelenir, kısa tek satır', () => {
  const m = hataArindir('C:\\Kullanicilar\\Ali Veli\\AppData\\Roaming\\Fuber AI\\whisper\\ggml-small.bin açılamadı\nAIza' + 'SyDUMMYDUMMYDUMMYDUMMYDUMMYDUMMY12345 xi-api-key');
  assert.equal(m, '<yol> açılamadı <gizli> xi-api-key');
  assert.ok(!m.includes('Ali') && !m.includes('AIza'));
  assert.equal(hataArindir('x'.repeat(500)).length <= 180, true);
  assert.equal(hataArindir('http 500 hatası'), 'http 500 hatası');
});

test('sunucuGunlukOzeti: son hata satırı, yol maskeli', () => {
  const o = sunucuGunlukOzeti('whisper_init: loading model\nerror: failed to open C:\\Kullanicilar\\Ali\\model.bin\nbitti');
  assert.match(o, /^error: failed to open <yol>/);
  assert.equal(sunucuGunlukOzeti('hepsi yolunda'), '');
});

test('gecikmeOrtalamasi: ilk örnek aynen, sonra üstel; 11 sn istekler eşiği aşar, 1,8 sn aşmaz', () => {
  let o: number | null = null;
  o = gecikmeOrtalamasi(o, 11_400); assert.equal(o, 11_400);
  o = gecikmeOrtalamasi(o, 11_300); assert.ok(o > WHISPER_YAVAS_MS);
  let k: number | null = null;
  for (let i = 0; i < 4; i++) k = gecikmeOrtalamasi(k, 1800);
  assert.ok(k! < WHISPER_YAVAS_MS);
});

// ── Bulut neden eşleme (Fuber hesabı) ──
const HESAP = (o: Partial<HesapAyari> = {}): HesapAyari => ({ durum: 'aktif', sesId: 'ses-1', ...o } as HesapAyari);

// ── ASCII dışı yol (Türkçe harfli kullanıcı adı / klasör): whisper-server `-m` yolunu dar karakterle okur ve çöker (0xC0000409; paketli ortamda yeniden üretildi) ──
import os from 'node:os';
import { asciiYol } from '../src/main/gunkaydi/ascii-yol.ts';
import { ASCII_DISI } from '../src/shared/whisper-tani.ts';

test('asciiYol: ASCII yol aynen; Türkçe harfli yol Windows 8.3 ASCII yoluna döner ve AYNI dosyaya işaret eder (8.3 kapalıysa yol aynen kalır)', { skip: process.platform !== 'win32' }, () => {
  assert.equal(asciiYol('C:\\Kullanicilar\\Ali\\AppData\\whisper\\m.bin'), 'C:\\Kullanicilar\\Ali\\AppData\\whisper\\m.bin');
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'FUBER Aİ şğü-'));
  try {
    const dosya = path.join(kok, 'ggml-uzun-bir-model-adi.bin');
    fs.writeFileSync(dosya, 'x');
    assert.ok(ASCII_DISI.test(dosya));
    const k = asciiYol(dosya);
    if (!ASCII_DISI.test(k)) {
      assert.equal(fs.readFileSync(k, 'utf8'), 'x', 'kısa yol aynı dosyayı açar');
    } else assert.equal(k, dosya, '8.3 kapalı: yol aynen (hata nedeni "ASCII dışı harf var" olarak söylenir)');
  } finally { fs.rmSync(kok, { recursive: true, force: true }); }
});
