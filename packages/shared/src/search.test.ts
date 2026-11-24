import { describe, expect, it } from 'vitest';
import { foldForSearch, ftsQuery, makeSnippet, searchTerms } from './search';

describe('foldForSearch', () => {
  it('Türkçe büyük/küçük harfi doğru katlar', () => {
    expect(foldForSearch('İSTANBUL')).toBe('istanbul');
    expect(foldForSearch('IŞIK')).toBe('isik');
    expect(foldForSearch('ışık')).toBe('isik');
    expect(foldForSearch('Şişli ÇAĞRI Öğün Ünlü')).toBe('sisli cagri ogun unlu');
  });

  it('uzunluğu korur', () => {
    const text = 'İstanbul’da IĞDIR kayısısı — ǅ ß Â';
    expect(foldForSearch(text).length).toBe(text.length);
  });
});

describe('ftsQuery', () => {
  it('sözcükleri tırnaklar ve sonuncuyu önek yapar', () => {
    expect(ftsQuery('KDV beyan')).toBe('"kdv" "beyan" *');
    expect(ftsQuery('Şişli')).toBe('"sisli" *');
    expect(ftsQuery('kdv beyan', { prefixLast: false })).toBe('"kdv" "beyan"');
    expect(ftsQuery('kdv beyan', { any: true })).toBe('"kdv" OR "beyan" *');
  });

  it('FTS5 sözdizimini etkisizleştirir', () => {
    expect(ftsQuery('a" OR b* NEAR(c) -d')).toBe('"a" "or" "b" "near" "c" "d" *');
    expect(searchTerms('col:değer')).toEqual(['col', 'deger']);
  });

  it('aranabilir sözcük yoksa null döner', () => {
    expect(ftsQuery('')).toBeNull();
    expect(ftsQuery('  "*" -- ')).toBeNull();
  });
});

describe('makeSnippet', () => {
  it('eşleşmeyi asıl yazımıyla işaretler', () => {
    expect(makeSnippet('Yarın saat onda KDV beyannamesini hatırlat', 'kdv beyan')).toBe(
      'Yarın saat onda [[KDV]] [[beyan]]namesini hatırlat',
    );
    expect(makeSnippet('İstanbul Şişli ofisi', 'sisli')).toBe('İstanbul [[Şişli]] ofisi');
  });

  it('uzun metinde çevresini keser', () => {
    const text = `${'a '.repeat(100)}toplantı notu ${'b '.repeat(100)}`;
    const snippet = makeSnippet(text, 'toplantı', 10);
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet).toContain('[[toplantı]] notu');
    expect(snippet.length).toBeLessThan(50);
  });

  it('eşleşme yoksa metnin başını verir', () => {
    expect(makeSnippet('kısa metin', 'yok')).toBe('kısa metin');
  });
});
