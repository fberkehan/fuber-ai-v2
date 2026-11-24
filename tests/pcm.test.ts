// Mikrofon → 16 kHz örnekleyici (Görev 21 düzeltme 7): alçak geçiren süzgeç (8 kHz üstü 16 kHz'e katlanmaz) ve parçalar arasında evre
// sürekliliği (parça parça vermek, tek seferde vermekle aynı sonucu verir).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ornekleyici, pcm16Yap } from '../src/shared/pcm.ts';

const ton = (hz: number, sure: number, frekans: number, genlik = 0.5) => {
  const o = new Float32Array(Math.round(hz * sure));
  for (let i = 0; i < o.length; i++) o[i] = genlik * Math.sin((2 * Math.PI * frekans * i) / hz);
  return o;
};
const int16 = (b: Uint8Array) => new Int16Array(b.buffer, b.byteOffset, b.byteLength >> 1);
/** Baştaki/sondaki süzgeç geçişi hariç RMS (−1…1). */
function rms(b: Uint8Array): number {
  const s = int16(b);
  const bas = 200, son = s.length - 200;
  let t = 0;
  for (let i = bas; i < son; i++) t += (s[i] / 32768) ** 2;
  return Math.sqrt(t / (son - bas));
}

test('48 kHz → 16 kHz: konuşma bandı (1 kHz) geçer; 10 kHz (16 kHz’in Nyquist’i üstü) katlanmaz, bastırılır', () => {
  const gecen = rms(pcm16Yap(ton(48000, 1, 1000), 48000));
  assert.ok(Math.abs(gecen - 0.5 / Math.SQRT2) < 0.02, `1 kHz RMS ${gecen.toFixed(4)}`);
  const katlanan = rms(pcm16Yap(ton(48000, 1, 10_000), 48000));
  assert.ok(katlanan < 0.004, `10 kHz RMS ${katlanan.toFixed(5)} (süzgeçsiz ≈ 0.35 idi)`);
  // 44,1 kHz kaynak da (tam sayı olmayan oran) aynı kurallara uyar.
  assert.ok(rms(pcm16Yap(ton(44100, 1, 11_000), 44100)) < 0.004);
  assert.ok(Math.abs(rms(pcm16Yap(ton(44100, 1, 1000), 44100)) - 0.3536) < 0.02);
});

test('parça parça vermek tek seferde vermekle aynı (evre ve süzgeç durumu sürer; sınırda tık yok)', () => {
  for (const hz of [48000, 44100]) {
    const ses = ton(hz, 0.5, 440);
    const tek = int16(new Ornekleyici(hz).donustur(ses));
    const o = new Ornekleyici(hz);
    const parcalar: number[] = [];
    // ScriptProcessor parçaları (2048) ve düzensiz boylar.
    for (let i = 0, boy = 2048; i < ses.length; i += boy, boy = boy === 2048 ? 777 : 2048) parcalar.push(...int16(o.donustur(ses.subarray(i, i + boy))));
    assert.ok(Math.abs(parcalar.length - tek.length) <= 1, `${hz}: ${parcalar.length} / ${tek.length}`);
    let enBuyuk = 0;
    for (let i = 0; i < Math.min(parcalar.length, tek.length); i++) enBuyuk = Math.max(enBuyuk, Math.abs(parcalar[i] - tek[i]));
    assert.ok(enBuyuk <= 1, `${hz}: en büyük fark ${enBuyuk} LSB`);
    // 0,5 sn → 8000 örnek (±1)
    assert.ok(Math.abs(tek.length - 8000) <= 1, `${tek.length}`);
  }
});

test('aynı hız: yalnız biçim; yükseltme: süzgeçsiz ara değerleme', () => {
  const a = int16(pcm16Yap(new Float32Array([0, 0.5, -0.5, 1]), 16000));
  assert.deepEqual([...a], [0, 16384, -16383, 32767]); // ×32767, yuvarlama (eski davranışla aynı ölçek)
  const y = int16(pcm16Yap(ton(8000, 0.25, 300), 8000));
  assert.ok(Math.abs(y.length - 4000) <= 2, `${y.length}`); // son giriş örneği sonraki parçaya kalır (akış)
});
