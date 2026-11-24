import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Tabs, tabCountVisible } from './Tabs';

describe('Tabs sayı rozeti', () => {
  it('yalnız sıfırdan büyük sayılarda çizilir', () => {
    expect(tabCountVisible(undefined)).toBe(false);
    expect(tabCountVisible(0)).toBe(false);
    expect(tabCountVisible(-1)).toBe(false);
    expect(tabCountVisible(1)).toBe(true);
    expect(tabCountVisible(12)).toBe(true);
  });

  it('0 iken sekmede "0" görünmez, dolu sekmede sayı görünür', () => {
    const html = renderToStaticMarkup(
      createElement(Tabs, {
        id: 't',
        value: 'a',
        onChange: () => {},
        items: [
          { value: 'a', label: 'Boş', count: 0 },
          { value: 'b', label: 'Dolu', count: 3 },
        ],
      }),
    );
    const tab = (value: string) => html.match(new RegExp(`<button[^>]*data-value="${value}"[^>]*>(.*?)</button>`))?.[1] ?? '';
    expect(tab('a')).toContain('Boş');
    expect(tab('a')).not.toMatch(/>0</);
    expect(tab('b')).toMatch(/>3</);
  });
});
