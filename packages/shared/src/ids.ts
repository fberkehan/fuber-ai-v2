import type { Id } from './entities';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_LENGTH = 10;
const RANDOM_LENGTH = 16;

let lastTime = -1;
let lastRandom: number[] = [];

/**
 * Zamana göre sıralanabilir 26 karakterlik kimlik (ULID). Metin sırası üretim sırasıdır;
 * `beforeId` ile sayfalama buna dayanır. Aynı milisaniyede üretilenler de artan sırada kalır.
 */
export function newId(): Id {
  const now = Date.now();
  let random: number[];
  if (now <= lastTime) {
    // Aynı milisaniye (ya da saat geri gitti): önceki rastgele kısmı bir artır ki sıra bozulmasın.
    random = [...lastRandom];
    for (let i = RANDOM_LENGTH - 1; i >= 0; i--) {
      if (random[i]! < 31) {
        random[i] = random[i]! + 1;
        break;
      }
      random[i] = 0;
    }
  } else {
    lastTime = now;
    const bytes = new Uint8Array(RANDOM_LENGTH);
    globalThis.crypto.getRandomValues(bytes);
    random = Array.from(bytes, (b) => b & 31);
  }
  lastRandom = random;

  let time = '';
  let remaining = lastTime;
  for (let i = 0; i < TIME_LENGTH; i++) {
    time = ALPHABET[remaining % 32]! + time;
    remaining = Math.floor(remaining / 32);
  }
  return time + random.map((v) => ALPHABET[v]!).join('');
}
