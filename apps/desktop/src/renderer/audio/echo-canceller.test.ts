import { describe, expect, it } from 'vitest';
import { EchoCanceller, type EchoFrameInfo } from './echo-canceller';

const RATE = 16_000;

/** Tohumlu sözde rastgele sayı (−0,5 … 0,5): sınama her koşuda aynı sinyali üretir. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xffffffff - 0.5;
  };
}

/** Konuşmaya benzeyen sinyal: hece hızında açılıp kapanan, alçak geçirilmiş gürültü (aralarda duraklamalar). */
function speechLike(seconds: number, seed: number, level = 0.2, syllableHz = 3.1): Float32Array {
  const random = generator(seed);
  const out = new Float32Array(Math.round(seconds * RATE));
  let low = 0;
  for (let n = 0; n < out.length; n++) {
    const t = n / RATE;
    const syllable = Math.max(0, Math.sin(2 * Math.PI * syllableHz * t + seed)) ** 2;
    const phrase = Math.sin(2 * Math.PI * 0.23 * t + seed * 0.7) > -0.6 ? 1 : 0;
    low += 0.25 * (random() - low);
    out[n] = low * 6 * level * syllable * phrase;
  }
  return out;
}

/** Yankı yolu: gecikme + kısa oda yanıtı + kazanç + taban gürültüsü. */
function echoOf(reference: Float32Array, delayMs: number, gain: number): Float32Array {
  const random = generator(99);
  const delay = Math.round((delayMs / 1000) * RATE);
  const taps: Array<[offset: number, weight: number]> = [
    [0, 1],
    [37, 0.35],
    [121, -0.2],
    [310, 0.12],
  ];
  const mic = new Float32Array(reference.length);
  for (let n = 0; n < mic.length; n++) {
    let sample = 0;
    for (const [offset, weight] of taps) {
      const index = n - delay - offset;
      if (index >= 0) sample += weight * (reference[index] ?? 0);
    }
    mic[n] = sample * gain + random() * 0.002;
  }
  return mic;
}

function run(mic: Float32Array, reference: Float32Array, canceller = new EchoCanceller()) {
  const frames: EchoFrameInfo[] = [];
  const cleaned = new Float32Array(mic.length);
  const out = new Float32Array(320);
  for (let offset = 0; offset + 320 <= mic.length; offset += 320) {
    canceller.process(mic.subarray(offset, offset + 320), reference.subarray(offset, offset + 320), out);
    cleaned.set(out, offset);
    frames.push(canceller.takeFrame());
  }
  return { frames, cleaned };
}

const energy = (frames: EchoFrameInfo[], key: 'mic' | 'res'): number => frames.reduce((sum, frame) => sum + frame[key] ** 2, 0);

/**
 * Oturumun baktığı ölçü: son 13 çerçevenin (260 ms) referans etkin olanlarında "kullanıcı" oranı. Dönüş: oranın
 * 0,6'yı (kesin kullanıcı) geçtiği çerçevelerin dizinleri. Tek tük çerçeve yanılgısı bu ölçüyü geçmez.
 */
function sureAt(frames: EchoFrameInfo[], from: number, to: number, threshold = 0.6): number[] {
  const hits: number[] = [];
  for (let i = Math.max(13, from); i < to; i++) {
    const window = frames.slice(i - 13, i).filter((frame) => frame.active);
    if (window.length === 0) continue;
    if (window.reduce((sum, frame) => sum + frame.near, 0) / window.length >= threshold) hits.push(i);
  }
  return hits;
}

describe('referanslı yankı giderici', () => {
  // 600 ve 850 ms: gecikmesi büyük Bluetooth hoparlör (eski arama aralığı 450 ms'de bitiyordu ve giderici hiç öğrenemiyordu).
  it.each([40, 150, 300, 600, 850])('gecikmeyi kestirir ve yankıyı bastırır (hoparlör → mikrofon %i ms)', (delayMs) => {
    const reference = speechLike(20, 3);
    const { frames } = run(echoOf(reference, delayMs, 0.5), reference);
    const last = frames.at(-1);
    expect(last?.trained).toBe(true);
    // Süzgeç, kestirilen gecikmenin 20 ms öncesinden başlar ve 64 ms'yi kapsar.
    expect(last?.delayMs).toBeGreaterThanOrEqual(delayMs - 60);
    expect(last?.delayMs).toBeLessThanOrEqual(delayMs);
    const steady = frames.slice(500).filter((frame) => frame.active);
    const erle = 10 * Math.log10(energy(steady, 'mic') / energy(steady, 'res'));
    expect(erle).toBeGreaterThan(12);
    // Yalnız yankı varken "kullanıcı konuşuyor" kanısı oluşmaz (tek tük çerçeve yanılgısı 260 ms'lik ölçüyü geçmez).
    expect(sureAt(frames, 500, frames.length)).toEqual([]);
  });

  it('yankının üstüne kullanıcı konuşunca "yakın uç" der; kullanıcı susunca yankıya döner', () => {
    const reference = speechLike(24, 3);
    const mic = echoOf(reference, 150, 0.5);
    const user = speechLike(2, 11, 0.4);
    const at = 16 * RATE;
    for (let n = 0; n < user.length; n++) mic[at + n] = (mic[at + n] ?? 0) + (user[n] ?? 0);
    const { frames } = run(mic, reference);
    expect(sureAt(frames, 12 * 50, 16 * 50)).toEqual([]);
    // Kullanıcı konuşmaya başladıktan en geç 700 ms sonra kanı oluşur.
    const during = sureAt(frames, 16 * 50, 18 * 50, 0.25);
    expect(during.length).toBeGreaterThan(0);
    expect(((during[0] ?? 0) - 16 * 50) * 20).toBeLessThanOrEqual(700);
    // Süzgeç kullanıcının sesine uyarlanıp bozulmamış olmalı: kullanıcı susunca kanı da biter.
    expect(sureAt(frames, 19 * 50, 23 * 50)).toEqual([]);
  });

  it('referans yokken mikrofonu değiştirmeden geçirir (Jarvis susarken kullanıcının sesi bozulmaz)', () => {
    const user = speechLike(3, 7);
    const silence = new Float32Array(user.length);
    const { frames, cleaned } = run(user, silence);
    expect(frames.every((frame) => !frame.active && frame.near === 1)).toBe(true);
    let difference = 0;
    for (let n = 0; n < cleaned.length; n++) difference = Math.max(difference, Math.abs((cleaned[n] ?? 0) - (user[n] ?? 0)));
    expect(difference).toBeLessThan(1e-4);
  });

  it('yalnız yankı olan bloklarda çıkışı kısar: kalan yankı VAD\'ı tetiklemesin', () => {
    const reference = speechLike(20, 3);
    const mic = echoOf(reference, 150, 0.5);
    const { cleaned } = run(mic, reference);
    const power = (signal: Float32Array, from: number, to: number): number => {
      let sum = 0;
      for (let n = from; n < to; n++) sum += (signal[n] ?? 0) ** 2;
      return sum / (to - from);
    };
    const reduction = 10 * Math.log10(power(mic, 10 * RATE, 20 * RATE) / power(cleaned, 10 * RATE, 20 * RATE));
    expect(reduction).toBeGreaterThan(20);
  });

  it('düzey kapısı sınırlar içinde ayarlanır', () => {
    const canceller = new EchoCanceller();
    expect(canceller.gateValue).toBe(4);
    canceller.setGate(100);
    expect(canceller.gateValue).toBe(64);
    canceller.setGate(0.1);
    expect(canceller.gateValue).toBe(1.5);
  });

  /**
   * d6: ölçülen bir Bluetooth hoparlör: doğrusal olmayan sürücü + kayan gecikme. Doğrusal süzgeç yakınsamaz (gerçek
   * cihazda 0–3 dB), zarf ilintisi yüksek kalır. Kaba kapı: yalnız yankıda "kullanıcı" demez, kullanıcı yankıdan belirgin
   * yüksek konuşunca der.
   */
  function bluetoothEcho(reference: Float32Array, delayMs: number, gain: number): Float32Array {
    const random = generator(77);
    const mic = new Float32Array(reference.length);
    for (let n = 0; n < mic.length; n++) {
      // ±12 ms, 0,4 Hz kayan gecikme ve tanh kırpma.
      const delay = ((delayMs + 12 * Math.sin((2 * Math.PI * 0.4 * n) / RATE)) / 1000) * RATE;
      const index = n - delay;
      const i = Math.floor(index);
      const frac = index - i;
      const sample = i >= 0 ? (reference[i] ?? 0) * (1 - frac) + (reference[i + 1] ?? 0) * frac : 0;
      mic[n] = (Math.tanh(3 * sample) / Math.tanh(3)) * gain + random() * 0.002;
    }
    return mic;
  }

  /** İşçinin kaba kanıt ölçüsü: 13 çerçevede en az 8 etkin çerçeve varsa oran (`worker/index.ts` › `nearNow`). */
  function coarseHits(frames: EchoFrameInfo[], from: number, to: number, threshold: number): number[] {
    const hits: number[] = [];
    for (let i = Math.max(13, from); i < to; i++) {
      const window = frames.slice(i - 13, i).filter((frame) => frame.active);
      if (window.length < 8) continue;
      if (window.reduce((sum, frame) => sum + frame.near, 0) / window.length >= threshold) hits.push(i);
    }
    return hits;
  }

  /** Kullanıcı 16. saniyede konuşmaya başlar; `duck` verilirse o andan sonra çalınan ses (ve yankısı) kısılır. */
  function bluetoothScene(level: number, duck = 1) {
    const reference = speechLike(24, 3);
    for (let n = 16 * RATE; n < reference.length; n++) reference[n] = (reference[n] ?? 0) * duck;
    const mic = bluetoothEcho(reference, 390, 0.5);
    const user = speechLike(2, 11, level, 4.7);
    for (let n = 0; n < user.length; n++) mic[16 * RATE + n] = (mic[16 * RATE + n] ?? 0) + (user[n] ?? 0);
    return run(mic, reference).frames;
  }

  it('d6: süzgeç yakınsamayan (Bluetooth) yankıda kaba kapı: yalnız yankıda kullanıcı demez; kullanıcıyı önce kısmaya, kısık seste susmaya yetecek kadar görür', () => {
    // Kullanıcı yankıyla aynı düzeyde konuşuyor (en zor durum: Bluetooth hoparlör yüksek, mikrofon uzak).
    const frames = bluetoothScene(0.2);
    const steady = frames.slice(4 * 50, 16 * 50).filter((frame) => frame.active);
    // Giderici bu yankıda yakınsamıyor (ölçülen cihazdaki gibi: bastırma ≤ 0 dB, gecikme kestirimi atlıyor); karar
    // kaba kapıdan gelir.
    expect(steady.some((frame) => frame.trained)).toBe(false);
    expect(steady.filter((frame) => frame.coarse).length).toBeGreaterThan(steady.length * 0.8);
    expect(frames.at(-1)?.coupled).toBe(true);
    expect(Math.abs((frames.at(-1)?.corrLagMs ?? 0) - 390)).toBeLessThanOrEqual(40);
    // Yalnız yankı: kısma eşiği (0,25) bile hiç geçilmez (Jarvis ne kısar ne kendini keser).
    expect(coarseHits(frames, 4 * 50, 16 * 50, 0.25)).toEqual([]);
    // Kullanıcı: kısma eşiği ilk saniyede geçilir.
    const duck = coarseHits(frames, 16 * 50, 18 * 50, 0.25);
    expect(duck.length).toBeGreaterThan(0);
    expect(((duck[0] ?? 0) - 16 * 50) * 20).toBeLessThanOrEqual(1000);
    // Ses kısılınca (−12 dB) susturma eşiği (0,35) geçilir; kısık seste de yalnız yankı geçmez.
    const ducked = bluetoothScene(0.2, 0.25);
    expect(coarseHits(ducked, 16 * 50, 18 * 50, 0.35).length).toBeGreaterThan(0);
    expect(coarseHits(ducked, 4 * 50, 16 * 50, 0.25)).toEqual([]);
  });

  it('yankı yokken (kulaklık) Jarvis konuşurken söylenen söz bozulmaz ve süzgeç öğrenmez', () => {
    const reference = speechLike(12, 3);
    const mic = new Float32Array(reference.length);
    const noise = generator(5);
    for (let n = 0; n < mic.length; n++) mic[n] = noise() * 0.002;
    // Kullanıcının hece hızı Jarvis'inkinden farklıdır (aynı hızda iki sentetik zarf yapay olarak ilintili çıkar).
    const user = speechLike(1.2, 11, 0.3, 4.7);
    const at = 8 * RATE;
    for (let n = 0; n < user.length; n++) mic[at + n] = (mic[at + n] ?? 0) + (user[n] ?? 0);
    const { frames, cleaned } = run(mic, reference);
    expect(frames.some((frame) => frame.trained || frame.coupled)).toBe(false);
    expect(frames.at(-1)?.warm).toBe(true);
    let difference = 0;
    for (let n = at; n < at + user.length; n++) difference = Math.max(difference, Math.abs((cleaned[n] ?? 0) - (mic[n] ?? 0)));
    expect(difference).toBeLessThan(1e-3);
  });
});
