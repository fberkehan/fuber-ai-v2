import { describe, expect, it } from 'vitest';
import { countWords, parseBlocks, parseInline } from './markdown';

describe('sohbet Markdown işleyicisi', () => {
  it('paragraf, liste, numaralı liste, başlık ve kod bloğunu ayırır', () => {
    const blocks = parseBlocks('# Özet\nİlk satır\nikinci satır\n\n- bir\n- iki\n\n3. üç\n4. dört\n\n```ts\nconst a = 1;\n```');
    expect(blocks.map((block) => block.type)).toEqual(['h', 'p', 'ul', 'ol', 'code']);
    expect(blocks[1]).toEqual({ type: 'p', text: 'İlk satır\nikinci satır' });
    expect(blocks[3]).toMatchObject({ type: 'ol', start: 3, items: ['üç', 'dört'] });
    expect(blocks[4]).toEqual({ type: 'code', lang: 'ts', code: 'const a = 1;' });
  });

  it('akışta kapanmamış kod bloğunu yarım haliyle gösterir', () => {
    expect(parseBlocks('```\nyarım')).toEqual([{ type: 'code', lang: '', code: 'yarım' }]);
  });

  it('kalın, satır içi kod ve yalnız http(s) bağlantı; HTML düz metin kalır', () => {
    const nodes = parseInline('**kalın** `kod` [site](https://example.com) <b>x</b> javascript:alert(1)');
    expect(nodes.map((node) => node.type)).toEqual(['strong', 'text', 'code', 'text', 'link', 'text']);
    expect(nodes[4]).toEqual({ type: 'link', text: 'site', url: 'https://example.com' });
    expect(nodes[5]).toEqual({ type: 'text', text: ' <b>x</b> javascript:alert(1)' });
  });

  it('çıplak adresi bağlantı yapar, sondaki noktalamayı dışarıda bırakır', () => {
    const nodes = parseInline('Bak: https://example.com/demo.');
    expect(nodes[1]).toEqual({ type: 'link', text: 'https://example.com/demo', url: 'https://example.com/demo' });
  });

  it('sözcük sayısı kod bloğunu saymaz', () => {
    expect(countWords('Merhaba **dünya** nasılsın\n\n```\nkod satırı\n```\n- bir madde')).toBe(5);
  });
});
