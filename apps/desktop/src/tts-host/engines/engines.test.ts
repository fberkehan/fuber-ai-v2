import { describe, expect, it } from 'vitest';
import { TTS_ENGINES, TTS_HOST_ENGINE_IDS, type TtsDevice } from '@fuber/shared';
import { fadeEdges, gaussian, type EngineContext } from '../engine';
import type { Session, Tensor } from '../ort';
import { chunkText, planFrames, toAlphabet } from './ema';
import { HOST_ENGINES } from './index';
import { preprocessText, splitForSynthesis } from './supertonic';

describe('motor kayıt tablosu', () => {
  it('katalogdaki her konak motorunun bir uygulaması vardır', () => {
    expect(Object.keys(HOST_ENGINES).sort()).toEqual([...TTS_HOST_ENGINE_IDS].sort());
    for (const id of TTS_HOST_ENGINE_IDS) {
      expect(TTS_ENGINES[id].kind).toBe('host');
      expect(TTS_ENGINES[id].model).toBeTruthy();
      expect(typeof HOST_ENGINES[id]).toBe('function');
    }
  });

  it('motor kimliğini ve yüklenmeden önceki örnekleme hızını bildirir; yüklenmemiş motor üretmez', async () => {
    const context: EngineContext = { ort: { version: 'yok', device: 'cpu', createSession: () => ({}) as Session, release() {} }, device: 'cpu', dir: 'C:/yok', log() {} };
    const supertonic = HOST_ENGINES.supertonic(context);
    expect(supertonic.id).toBe('supertonic');
    expect(supertonic.sampleRate).toBe(44_100);
    const ema = HOST_ENGINES['ema-lightning'](context);
    expect(ema.sampleRate).toBe(48_000);
    await expect(ema.synth({ text: 'Merhaba.', voice: 'ema', language: 'tr', cancelled: () => false, breathe: async () => {}, emit() {} })).rejects.toThrow(/yüklenmedi/);
    // Var olmayan model klasörü: yükleme hata verir (konak bunu "model" hatası olarak bildirir).
    await expect(supertonic.load()).rejects.toThrow();
    supertonic.dispose();
    ema.dispose();
  });
});

describe('Supertonic 3: metin ön işleme', () => {
  it('dil imiyle sarar, sonda noktalama yoksa nokta ekler, boşlukları toplar', () => {
    expect(preprocessText('Merhaba   dünya', 'tr')).toBe('<tr>Merhaba dünya.</tr>'.normalize('NFKD'));
    expect(preprocessText('Hazır mısın?', 'tr')).toBe('<tr>Hazır mısın?</tr>'.normalize('NFKD'));
    expect(preprocessText('Good evening', 'en')).toBe('<en>Good evening.</en>');
  });

  it('Türkçe harfleri modelin beklediği ayrık biçime çevirir (NFKD): ş → s + sedil', () => {
    const out = preprocessText('şğçöüİı', 'tr');
    expect(out).toContain('s\u0327'.normalize('NFKD'));
    expect([...out].some((ch) => ch === 'ş')).toBe(false);
    // Noktasız ı ayrışmaz; modelin sözlüğünde kendi kodu vardır.
    expect(out).toContain('ı');
  });

  it('simgeleri sadeleştirir, emojiyi ve süs imlerini atar, noktalamadan önceki boşluğu kaldırır', () => {
    const dash = String.fromCodePoint(0x2014);
    const quoteOpen = String.fromCodePoint(0x201c);
    const quoteClose = String.fromCodePoint(0x201d);
    expect(preprocessText(`Evet ${dash} olur , tamam !`, 'tr')).toBe('<tr>Evet - olur, tamam!</tr>');
    expect(preprocessText(`${quoteOpen}Merhaba${quoteClose} dedi`, 'tr')).toBe('<tr>"Merhaba" dedi.</tr>');
    expect(preprocessText(`Harika ${String.fromCodePoint(0x1f600)} haber [not] a/b`, 'tr')).toBe('<tr>Harika haber not a b.</tr>');
    expect(preprocessText('<throatclear> Tamam', 'tr')).toBe('<tr><throatclear> Tamam.</tr>');
  });

  it('uzun metni cümle, virgül ve boşluk sınırlarından böler; kısa cümleyi bir sonrakiyle birleştirir', () => {
    expect(splitForSynthesis('Tamam. Yarın saat onda toplantınız var.')).toEqual(['Tamam. Yarın saat onda toplantınız var.']);
    const two = splitForSynthesis('Yarınki toplantı sabah onda başlıyor ve yaklaşık bir saat sürecek. Gündemde üç konu var: takvim, geri bildirimler ve bütçe.');
    expect(two.length).toBe(2);
    const long = `${'Çok uzun bir cümle parçası, '.repeat(12)}son.`;
    const pieces = splitForSynthesis(long, 100);
    expect(pieces.length).toBeGreaterThan(2);
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(100);
    expect(pieces.join(' ').replace(/\s+/g, ' ')).toBe(long.replace(/\s+/g, ' '));
    // Boşluksuz dev sözcük de sınırı aşmaz.
    for (const piece of splitForSynthesis('a'.repeat(450), 100)) expect(piece.length).toBeLessThanOrEqual(100);
    expect(splitForSynthesis('   ')).toEqual([]);
  });
});

describe('EMA Lightning: metin ve kare planı', () => {
  const vocab = new Set([...' !"%&\'(),-./:;?abcdefghijklmnopqrstuvwxyzçöüğış']);

  it('metni modelin alfabesine indirger: Türkçe küçük harf, sözlükte olmayan karakter boşluk', () => {
    expect(toAlphabet('İstanbul’da IŞIK Çok GÜZEL', vocab)).toBe("istanbul'da ışık çok güzel");
    expect(toAlphabet('Rüzgâr 5 km', vocab)).toBe('rüzgar km');
    expect(toAlphabet('a\u0000b', vocab)).toBe('a b');
    expect(toAlphabet('   ', vocab)).toBe('');
  });

  it('kısa metin tek parçadır ve noktayla biter; uzun metin cümle sonundan kesilir, son parçadan sonra sessizlik yoktur', () => {
    expect(chunkText('merhaba dünya')).toEqual([['merhaba dünya.', 0]]);
    expect(chunkText('tamam mı?')).toEqual([['tamam mı?', 0]]);
    const text = `${'bugün hava çok güzel. '.repeat(14)}yarın yağmur var.`;
    const pieces = chunkText(text);
    expect(pieces.length).toBeGreaterThan(1);
    for (const [piece] of pieces) {
      expect(piece.length).toBeLessThanOrEqual(180);
      expect(piece.endsWith('.')).toBe(true);
    }
    expect(pieces[0]![1]).toBe(0.25);
    expect(pieces.at(-1)![1]).toBe(0);
    expect(chunkText('...')).toEqual([]);
  });

  it('kare planı: sözcük başına kare sayısı sürelerin toplamıdır; konumlar artan ve sözcük sınırlarında süreklidir', () => {
    // "ab cd": iki sözcük; boşluk ikinci sözcüğe aittir (özgün motorla aynı).
    const cw = [0, 0, 1, 1, 1];
    const wstart = [0, 0, 2, 2, 2];
    const plan = planFrames(cw, wstart, [2, 2, 1, 3, 2]);
    expect(plan.frames).toBe(10);
    expect(Array.from(plan.fw)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
    for (let i = 1; i < plan.fg.length; i++) expect(plan.fg[i]!).toBeGreaterThan(plan.fg[i - 1]!);
    for (let i = 1; i < plan.cg.length; i++) expect(plan.cg[i]!).toBeGreaterThan(plan.cg[i - 1]!);
    // İlk sözcük 2 harf: konumlar [0, 2) aralığında; ikinci sözcük 3 harf: [2, 5).
    expect(plan.cg[1]!).toBeLessThan(2);
    expect(plan.cg[2]!).toBeGreaterThanOrEqual(2);
    expect(plan.fg[4]!).toBeCloseTo(2, 5);
    // Hız: süreler bölünür; her sözcük en az bir kare alır; sözcük başına üst sınır 250, parça başına 3000.
    expect(planFrames(cw, wstart, [2, 2, 1, 3, 2], 2).frames).toBe(5);
    expect(planFrames([0], [0], [0.01]).frames).toBe(1);
    expect(planFrames([0], [0], [9999]).frames).toBe(250);
  });
});

describe('ortak yardımcılar', () => {
  it('tohumlu gürültü yinelenebilir; dağılım yaklaşık standart normaldir', () => {
    expect(Array.from(gaussian(7)(6))).toEqual(Array.from(gaussian(7)(6)));
    expect(Array.from(gaussian(7)(6))).not.toEqual(Array.from(gaussian(8)(6)));
    const values = gaussian(1)(20_000);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(Math.abs(variance - 1)).toBeLessThan(0.08);
    expect(gaussian()(5).length).toBe(5);
  });

  it('kenar yumuşatma uçları sıfıra çeker, ortayı değiştirmez', () => {
    const samples = fadeEdges(new Float32Array(1000).fill(1), 10_000, 4);
    expect(samples[0]).toBe(0);
    expect(samples[999]).toBe(0);
    expect(samples[500]).toBe(1);
    expect(fadeEdges(new Float32Array(3).fill(1), 44_100).length).toBe(3);
  });

  it('tensör ve cihaz tipleri katalogla uyumludur', () => {
    const tensor: Tensor = { type: 'float32', dims: [1, 2], data: new Float32Array(2) };
    const devices: TtsDevice[] = ['cuda', 'directml', 'cpu'];
    expect(tensor.dims).toEqual([1, 2]);
    expect(TTS_ENGINES.supertonic.devices).toEqual(['cuda', 'directml']);
    expect(TTS_ENGINES['ema-lightning'].devices).toEqual(devices);
  });
});
