import { describe, expect, it } from 'vitest';
import { applyListItems, spokenList } from './local-lists';

const items = (text: string, context?: string) => spokenList(text, context)?.items ?? null;

describe('sözde sayılan kalemler', () => {
  it('virgüllü sayım: her kalem ayrı madde', () => {
    expect(items('alışveriş listesine süt, ekmek ve yumurta ekle')).toEqual(['süt', 'ekmek', 'yumurta']);
    expect(items('Market listesine peynir, zeytin, çay ve şeker yaz.')).toEqual(['peynir', 'zeytin', 'çay', 'şeker']);
    expect(items("yapılacaklara şunları ekle: faturaları öde, Kaan'ı ara, raporu gönder")).toEqual(['faturaları öde', "Kaan'ı ara", 'raporu gönder']);
    expect(items('Alışveriş listeme şunları yaz: bir kilo domates, iki ekmek, bir de deterjan.')).toEqual(['bir kilo domates', 'iki ekmek', 'deterjan']);
  });

  it('"liste" sözcüğü geçmeyen gündelik söz: "almam lazım, bunları ekle"', () => {
    expect(items('Yarın süt, ekmek ve yumurta almam lazım, bunları ekle.')).toEqual(['süt', 'ekmek', 'yumurta']);
    expect(items('Bugün deterjan, sabun ve çöp torbası alacağım, not et.')).toEqual(['deterjan', 'sabun', 'çöp torbası']);
  });

  it('sesten yazıya çevrilen virgülsüz söz (yalnız alışveriş listesinde)', () => {
    expect(items('alışveriş listesine süt ekmek yumurta ekle')).toEqual(['süt', 'ekmek', 'yumurta']);
    expect(items('alışveriş listesine süt ekmek ve yumurta ekle')).toEqual(['süt', 'ekmek', 'yumurta']);
    expect(items('Market listesine bir kilo domates iki ekmek deterjan yaz')).toEqual(['bir kilo domates', 'iki ekmek', 'deterjan']);
    expect(items('Alışveriş listeme domates ve biber de ekler misin?')).toEqual(['domates', 'biber']);
  });

  it('bağlam bir önceki sözden gelir', () => {
    expect(items('Süt, ekmek, yumurta.', 'Alışveriş listesi yapalım.')).toEqual(['Süt', 'ekmek', 'yumurta']);
    // Bağlam liste olsa da sayım olmayan söz kalem üretmez.
    expect(items('Tamam, teşekkürler.', 'Alışveriş listesi yapalım.')).toBeNull();
    expect(items('Bir de ekmek ekle.', 'Alışveriş listesine süt ekle.')).toBeNull();
  });

  it('tek iş bölünmez', () => {
    expect(items('Yapılacaklara Ali ve Veli ile toplantı ayarlamayı ekle.')).toBeNull();
    expect(items('Yapılacaklara ekle: Ankara, İstanbul ve İzmir bayilerini ara')).toBeNull();
    expect(items('yapılacaklara raporu Kaan’a göndermeyi ekle')).toBeNull();
    expect(items('alışveriş listesine süt ekle')).toBeNull();
  });

  it('liste OLUŞTURMA isteği bir sayım değildir (maddeleri model seçer)', () => {
    expect(items('üç maddelik bir alışveriş listesi oluştur ve yapılacaklara ekle')).toBeNull();
    expect(items('bana bir alışveriş listesi hazırla')).toBeNull();
  });

  it('açık ekleme buyruğu: liste adı (ya da iki nokta) ve ekleme fiili birlikte', () => {
    expect(spokenList('alışveriş listesine süt, ekmek ve yumurta ekle')?.explicit).toBe(true);
    expect(spokenList("yapılacaklara şunları ekle: faturaları öde, Kaan'ı ara, raporu gönder")?.explicit).toBe(true);
    expect(spokenList('Market listesine peynir, zeytin, çay ve şeker yaz.')?.explicit).toBe(true);
    // Liste adı anılmadan sayılan kalemler: çağrı modelde kalır (kalemleri düzeltilir).
    expect(spokenList('Yarın süt, ekmek ve yumurta almam lazım, bunları ekle.')?.explicit).toBe(false);
    expect(spokenList('Süt, ekmek, yumurta.', 'Alışveriş listesi yapalım.')?.explicit).toBe(false);
  });

  it('liste bağlamı olmayan söz ve okuma isteği', () => {
    expect(items('Kaan, Ahmet ve Mehmet yarın geliyor.')).toBeNull();
    expect(items('alışveriş listesinde ne var?')).toBeNull();
    expect(items('yapılacaklar listesini oku')).toBeNull();
  });
});

describe('modelin ekleme çağrısının düzeltilmesi', () => {
  const list = spokenList('Yarın süt, ekmek ve yumurta almam lazım, bunları ekle.');

  it('tek maddeye yazılan liste toplu eklemeye çevrilir; son gün korunur', () => {
    const call = { name: 'todo_add', input: { text: 'Süt, ekmek ve yumurta almak', due_day: '2026-11-17' } as unknown };
    expect(applyListItems(call, list)).toBe(true);
    expect(call).toEqual({
      name: 'todo_add_many',
      input: { items: [{ text: 'süt', due_day: '2026-11-17' }, { text: 'ekmek', due_day: '2026-11-17' }, { text: 'yumurta', due_day: '2026-11-17' }] },
    });
  });

  it('birleştirilmiş ya da yanlış yazılmış kalemler sözdekilerle değişir', () => {
    const merged = { name: 'todo_add_many', input: { items: [{ text: 'süt ekmek' }, { text: 'yumurta' }] } as unknown };
    expect(applyListItems(merged, list)).toBe(true);
    expect((merged.input as { items: Array<{ text: string }> }).items.map((item) => item.text)).toEqual(['süt', 'ekmek', 'yumurta']);
    const typo = { name: 'todo_add_many', input: { items: [{ text: 'Süt' }, { text: 'Ekme' }, { text: 'Yumurta' }] } as unknown };
    expect(applyListItems(typo, list)).toBe(true);
    expect((typo.input as { items: Array<{ text: string }> }).items.map((item) => item.text)).toEqual(['süt', 'ekmek', 'yumurta']);
  });

  it('doğru ayrılmış çağrıya ve başka araçlara dokunulmaz', () => {
    const right = { name: 'todo_add_many', input: { items: [{ text: 'Süt' }, { text: 'Ekmek' }, { text: 'Yumurta' }] } as unknown };
    expect(applyListItems(right, list)).toBe(false);
    expect((right.input as { items: unknown[] }).items).toHaveLength(3);
    const other = { name: 'reminder_create', input: { text: 'süt, ekmek ve yumurta al' } as unknown };
    expect(applyListItems(other, list)).toBe(false);
    expect(applyListItems({ name: 'todo_add', input: { text: 'toplantı' } }, null)).toBe(false);
  });
});
