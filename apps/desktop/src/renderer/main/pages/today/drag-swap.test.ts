import { describe, expect, it } from 'vitest';
import { shouldSwap, SWAP_DEAD_PX, type SwapRect } from './drag-swap';

// Yan yana iki eşit kart: A (0–200) ve B (216–416), aynı satırda.
const A: SwapRect = { left: 0, top: 0, width: 200, height: 160 };
const B: SwapRect = { left: 216, top: 0, width: 200, height: 160 };
const midB = B.left + B.width / 2; // 316

describe('Kokpit sürükleme histerezisi', () => {
  it('hedefin kutusuna girmek yetmez; merkezi eşik kadar geçince yer değişir', () => {
    // A sürükleniyor (yuvası A), imleç B'nin sol yarısında: değişmez.
    expect(shouldSwap(B.left + 10, 80, A, B)).toBe(false);
    expect(shouldSwap(midB, 80, A, B)).toBe(false);
    expect(shouldSwap(midB + SWAP_DEAD_PX - 1, 80, A, B)).toBe(false);
    expect(shouldSwap(midB + SWAP_DEAD_PX, 80, A, B)).toBe(true);
    // Kutunun dışında hiç değişmez.
    expect(shouldSwap(B.left + B.width + 5, 80, A, B)).toBe(false);
  });

  it('yer değiştikten sonra merkezin çevresindeki küçük oynama sırayı geri çevirmez', () => {
    // Değişimden sonra A'nın yuvası sağda (B'nin eski yeri), B solda (A'nın eski yeri).
    const slotAfter = B;
    const otherAfter = A;
    const midA = A.left + A.width / 2; // 100
    // İmleç sağ kartın merkezi çevresinde ±10 px oynuyor: soldaki kartın kutusunda bile değil.
    for (const x of [midB - 10, midB, midB + 10]) expect(shouldSwap(x, 80, slotAfter, otherAfter)).toBe(false);
    // Soldaki kartın sağ yarısına girmek de yetmez; geri dönüş için merkezi ters yönde eşik kadar geçmek gerekir.
    expect(shouldSwap(A.left + A.width - 5, 80, slotAfter, otherAfter)).toBe(false);
    expect(shouldSwap(midA, 80, slotAfter, otherAfter)).toBe(false);
    expect(shouldSwap(midA - SWAP_DEAD_PX, 80, slotAfter, otherAfter)).toBe(true);
  });

  it('dikey komşuda yön dikeydir; küçük kartta eşik yarı boyu aşmaz', () => {
    const top: SwapRect = { left: 0, top: 0, width: 200, height: 80 };
    const below: SwapRect = { left: 0, top: 96, width: 200, height: 80 };
    // Aşağıdaki kart sürükleniyor, imleç üstteki kartın alt yarısında: değişmez; üst yarısında (merkezi geçince) değişir.
    expect(shouldSwap(100, 70, below, top)).toBe(false);
    expect(shouldSwap(100, 40 - SWAP_DEAD_PX, below, top)).toBe(true);
    // Çok küçük kart: eşik (yarı boyun yarısı) ulaşılabilir kalır.
    const tiny: SwapRect = { left: 0, top: 0, width: 20, height: 20 };
    const next: SwapRect = { left: 30, top: 0, width: 20, height: 20 };
    expect(shouldSwap(46, 10, tiny, next)).toBe(true);
  });
});
