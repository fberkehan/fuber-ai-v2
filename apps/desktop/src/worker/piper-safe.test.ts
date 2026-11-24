import { describe, expect, it } from 'vitest';
import { PIPER_SAFE_CHAR, PIPER_SAFE_TEXT, piperSafeText } from './piper-safe';
import { spokenForm } from './tts-router';

/** Sabit tohumlu sözde rastgele üreteç (mulberry32): her koşuda aynı dizeler. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cp = (code: number): string => String.fromCodePoint(code);
/** Vekil aralığını da tek birim olarak üretebilmek için (String.fromCodePoint vekilde de çalışır: tek birim verir). */
const range = (from: number, to: number) => (rnd: () => number) => cp(from + Math.floor(rnd() * (to - from + 1)));
const pick = (items: string[]) => (rnd: () => number) => items[Math.floor(rnd() * items.length)]!;

const ZWJ = cp(0x200d);
const VS16 = cp(0xfe0f);
const EMOJI_SEQUENCES = [
  cp(0x1f468) + ZWJ + cp(0x1f469) + ZWJ + cp(0x1f467) + ZWJ + cp(0x1f466), // aile
  cp(0x1f3f3) + VS16 + ZWJ + cp(0x1f308), // gökkuşağı bayrağı
  cp(0x1f1f9) + cp(0x1f1f7), // TR bayrağı
  '1' + VS16 + cp(0x20e3), // tuş başlığı
  cp(0x1f44d) + cp(0x1f3fd), // ten rengi
  cp(0x2764) + VS16,
  cp(0x1f3f4) + cp(0xe0067) + cp(0xe0062) + cp(0xe0065) + cp(0xe006e) + cp(0xe0067) + cp(0xe007f), // etiketli bayrak
  cp(0x1f600),
];

const GENERATORS: Array<(rnd: () => number) => string> = [
  range(0x20, 0x7e), // ASCII
  range(0x20, 0x7e),
  pick([...'çğıöşüâîûÇĞİÖŞÜÂÎÛ']),
  range(0xa0, 0xff), // Latin-1
  range(0x100, 0x24f), // Latin Genişletilmiş
  range(0x0, 0x1f), // denetim
  range(0x80, 0x9f), // C1 denetim
  range(0x300, 0x36f), // birleştirici
  range(0x400, 0x4ff), // Kiril
  range(0x600, 0x6ff), // Arap
  range(0x4e00, 0x9fff), // CJK
  range(0x2000, 0x206f), // genel noktalama (sıfır genişlikli, yön işaretleri)
  range(0x2190, 0x21ff), // oklar
  range(0x2200, 0x22ff), // matematik
  range(0x2500, 0x259f), // kutu çizimi ve blok
  range(0x25a0, 0x27bf), // şekiller, simgeler, süsler
  range(0x2800, 0x28ff), // Braille
  range(0xd800, 0xdfff), // vekil (çoğu eşleşmemiş kalır)
  range(0xe000, 0xf8ff), // özel kullanım alanı
  range(0xfe00, 0xfe0f), // değişken seçiciler
  range(0xff00, 0xffef), // tam genişlikli
  range(0x0, 0xffff), // BMP rastgele
  range(0x10000, 0x10ffff), // astral rastgele
  range(0x1f300, 0x1faff), // emoji
  pick(EMOJI_SEQUENCES),
  pick(['×', '÷', '≈', '≤', '≥', '°', '€', '$', '₺', '£', '•', '→', '…', '‘', '’', '“', '”', '«', '»', ' ', '\n', '\t']),
];

function fuzzString(rnd: () => number): string {
  const length = 1 + Math.floor(rnd() * 40);
  let out = '';
  for (let i = 0; i < length; i++) out += GENERATORS[Math.floor(rnd() * GENERATORS.length)]!(rnd);
  return out;
}

const hasLoneSurrogate = (text: string): boolean =>
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);

describe('piperSafeText: fuzz', () => {
  const rnd = mulberry32(0x5eed2026);
  const samples = Array.from({ length: 3000 }, () => fuzzString(rnd));

  it('3.000 rastgele dize: yalnız izinli küme, vekil yok, idempotent', () => {
    let nonEmpty = 0;
    for (const input of samples) {
      const out = piperSafeText(input);
      const label = JSON.stringify(input);
      expect(PIPER_SAFE_TEXT.test(out), label).toBe(true);
      for (const ch of out) expect(PIPER_SAFE_CHAR.test(ch), `${label} → ${JSON.stringify(ch)}`).toBe(true);
      expect(hasLoneSurrogate(out), label).toBe(false);
      expect(piperSafeText(out), label).toBe(out);
      expect(out, label).toBe(out.trim());
      if (out) nonEmpty++;
    }
    // Üreteç işe yarar girdiler de veriyor (hepsi boşa düşmüyor).
    expect(nonEmpty).toBeGreaterThan(samples.length / 2);
  });

  it('okuma düzelticiden geçmiş fuzz metni de güvenli kümeye iner', () => {
    for (const input of samples.slice(0, 500)) {
      const out = piperSafeText(spokenForm(input, { language: 'tr' }));
      expect(PIPER_SAFE_TEXT.test(out), JSON.stringify(input)).toBe(true);
    }
  });
});

describe('piperSafeText: sabit vakalar', () => {
  it.each([
    "Çığ, öğle üstü İstanbul'a şöyle bir uğradı; %50'si geldi.",
    'Merhaba! Bugün hava güzel mi? Evet: güneşli (biraz rüzgârlı).',
    'Kâğıt, hâlâ "taze" mi… Bilmiyorum.',
    'Ali & Veli @ ofis #3 / 4 + 5 = 9 - 1.',
    '‘Tamam’ dedi; "gidelim" diye ekledi.',
    'ÇĞİÖŞÜ çğıöşü âîû ÂÎÛ',
    'Crème brûlée, Ålesund, Čapek, Ñandú, Ţară.',
  ])('düz cümle değişmeden geçer: %s', (sentence) => {
    expect(piperSafeText(sentence)).toBe(sentence);
  });

  it('Piper\'ı çökerttiği ölçülen harfler ve çift tipografik tırnak yakın karşılığına çevrilir', () => {
    expect(piperSafeText('Straße, Øresund, Łódź, Œuvre, Þór, Șase')).toBe('Strasse, Oresund, Lódź, Oeuvre, Thór, Şase');
    expect(piperSafeText('“gidelim” dedi')).toBe('"gidelim" dedi');
    for (const ch of 'ÆæÐðØøÞþßĐđĦħĲĳĸŁłŉŊŋŒœŦŧſȘșȚț“”') expect(PIPER_SAFE_CHAR.test(ch), ch).toBe(false);
  });

  it('bilinen çökerten örnek: "A → B" duraksamayla okunur', () => {
    expect(piperSafeText('A → B')).toBe('A, B');
    expect(piperSafeText('Supertonic → Piper.')).toBe('Supertonic, Piper.');
    expect(piperSafeText(spokenForm('Supertonic → Piper.', { language: 'tr' }))).not.toMatch(/[←-⇿]/u);
  });

  it.each([
    ['3 × 4', '3 çarpı 4'],
    ['8 ÷ 2', '8 bölü 2'],
    ['≈ 5 kişi', 'yaklaşık 5 kişi'],
    ['x ≤ 3', 'x en çok 3'],
    ['x ≥ 3', 'x en az 3'],
    ['25°', '25 derece'],
    ['10 €', '10 avro'],
    ['$5', 'dolar 5'],
    ['20 ₺', '20 lira'],
    ['3 £', '3 sterlin'],
    ['• bir • iki', 'bir, iki'],
    ['elma ⇒ armut', 'elma, armut'],
    ['« alıntı »', '" alıntı "'],
  ])('anlamlı simge: %s → %s', (input, expected) => {
    expect(piperSafeText(input)).toBe(expected);
  });

  it('emoji, ZWJ dizileri, bayraklar, kutu çizimi, Braille, özel alan atılır', () => {
    for (const seq of EMOJI_SEQUENCES) {
      // Tuş başlığı ("1" + VS16 + U+20E3) rakamın kendisidir: süs atılır, rakam kalır.
      expect(piperSafeText(`Selam ${seq} dostum`)).toBe(seq.startsWith('1') ? 'Selam 1 dostum' : 'Selam dostum');
    }
    expect(piperSafeText('Tablo ┌──┐ │a│ └──┘ bitti')).toBe('Tablo a bitti');
    expect(piperSafeText(`Braille ${cp(0x2800 + 5)}${cp(0x2800 + 9)} ve ${cp(0xe123)} alan`)).toBe('Braille ve alan');
  });

  it('Latin dışı yazılar atılır; denetim karakteri ve satır sonu boşluğa döner; sıfır genişlikli silinir', () => {
    expect(piperSafeText('Moskova Москва 東京 القاهرة şehirleri')).toBe('Moskova şehirleri');
    expect(piperSafeText('bir\nsatır\r\niki\tsekme\u0007')).toBe('bir satır iki sekme');
    expect(piperSafeText('gö​z­lük')).toBe('gözlük');
  });

  it('ayrışık harf birleşir; başıboş birleştirici ve eşleşmemiş vekil atılır', () => {
    expect(piperSafeText('çay')).toBe('çay');
    expect(piperSafeText('́̂kalem')).toBe('kalem');
    expect(piperSafeText(`a${String.fromCharCode(0xd83d)}b ${String.fromCharCode(0xdc00)}c`)).toBe('a b c');
  });

  it('okunacak bir şey kalmazsa boş döner (Piper çağrılmaz)', () => {
    expect(piperSafeText('')).toBe('');
    expect(piperSafeText('→ ⇒ ━━━ 😀')).toBe('');
    expect(piperSafeText('... , ; !')).toBe('');
    expect(piperSafeText('Привет')).toBe('');
  });
});
