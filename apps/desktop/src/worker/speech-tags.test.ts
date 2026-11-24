import { describe, expect, it } from 'vitest';
import { ENGINE_TAGS, SUPERTONIC_TAG_VOICES, openTagStart, renderExpressionTags, stripExpressionTags, stripKnownExpressionTags, tagEngineFor } from './speech-tags';

describe('ifade etiketleri (sahne yönergeleri)', () => {
  it('motor ve modelden etiket hedefi', () => {
    expect(tagEngineFor('elevenlabs', 'eleven_v3')).toBe('eleven_v3');
    expect(tagEngineFor('elevenlabs', 'eleven_flash_v2_5')).toBe('none');
    expect(tagEngineFor('piper-local')).toBe('none');
    expect(Object.keys(ENGINE_TAGS.none)).toEqual([]);
  });

  // Şikâyet: "`<laugh>` etiketi sesli okunuyor, kahkaha atmıyor".
  it.each([
    ['<laugh> Bu çok komik!', '[laughs] Bu çok komik!'],
    ['<laughs>Bu çok komik!</laughs>', '[laughs] Bu çok komik!'],
    ['[laughs] Bu çok komik!', '[laughs] Bu çok komik!'],
    ['Bu çok komik! (gülüyor)', 'Bu çok komik! [laughs]'],
    ['*güler* Bu çok komik!', '[laughs] Bu çok komik!'],
    ['**kahkaha atar** Bu çok komik!', '[laughs] Bu çok komik!'],
    ['<sigh> Yine mi?', '[sighs] Yine mi?'],
    ['[sighs] Yine mi?', '[sighs] Yine mi?'],
    ['(iç çeker) Yine mi?', '[sighs] Yine mi?'],
    ['<breath> Tamam.', '[exhales] Tamam.'],
    ['[whispers] Kimse duymasın.', '[whispers] Kimse duymasın.'],
    ['*fısıldar* Kimse duymasın.', '[whispers] Kimse duymasın.'],
    ['[excited] Harika haber!', '[excited] Harika haber!'],
  ])('eleven_v3 destekler: %s → %s', (text, expected) => {
    expect(renderExpressionTags(text, 'eleven_v3')).toBe(expected);
  });

  it.each([
    ['<laugh> Bu çok komik!', 'Bu çok komik!'],
    ['<laughs>Bu çok komik!</laughs>', 'Bu çok komik!'],
    ['[laughs] Bu çok komik!', 'Bu çok komik!'],
    ['Bu çok komik! (gülüyor)', 'Bu çok komik!'],
    ['*güler* Bu çok komik!', 'Bu çok komik!'],
    ['<sigh> Yine mi?', 'Yine mi?'],
    ['[sighs] Yine mi?', 'Yine mi?'],
    ['<breath> Tamam.', 'Tamam.'],
    ['Tamam <laugh>, anladım.', 'Tamam, anladım.'],
    ['[excited] Harika haber!', 'Harika haber!'],
    ['<break time="1s"/> Devam ediyorum.', 'Devam ediyorum.'],
    ['<bilinmeyen> Merhaba.', 'Merhaba.'],
  ])('etiket desteklemeyen motorda (flash v2.5, Piper) sessizce atılır: %s → %s', (text, expected) => {
    expect(renderExpressionTags(text, 'none')).toBe(expected);
    expect(stripExpressionTags(text)).toBe(expected);
  });

  it.each([
    ['Bu *çok önemli* bir konu.'],
    ['Toplantı (yarın saat onda) yapılacak.'],
    ['Fiyat 3 < 5 ve 7 > 2 olduğu için uygun.'],
    ['[bu köşeli ayraç içindeki uzun bir açıklamadır ve etiket sayılmaz] tamam'],
    ['Gülerek söyledi ama ciddiydi.'],
    ['Rakamsız, etiketsiz düz bir cümle.'],
  ])('yönerge olmayan metne dokunmaz: %s', (text) => {
    expect(renderExpressionTags(text, 'none')).toBe(text);
    expect(renderExpressionTags(text, 'eleven_v3')).toBe(text);
  });

  it('yalnız etiketten oluşan metin boşalır', () => {
    expect(renderExpressionTags('<laugh>', 'none')).toBe('');
    expect(renderExpressionTags('<laugh>', 'eleven_v3')).toBe('[laughs]');
  });

  // Supertonic 3'ün tablosunda yalnız `<throatclear>` var (ve koşullu: aşağıdaki `tagEngineFor` sınaması).
  it.each([
    ['<throatclear> Devam ediyorum.', '<throatclear> Devam ediyorum.'],
    ['[clears throat] Devam ediyorum.', '<throatclear> Devam ediyorum.'],
    ['(boğazını temizler) Devam ediyorum.', '<throatclear> Devam ediyorum.'],
    ['<laugh> Bu çok komik!', 'Bu çok komik!'],
    ['<sigh> Yine mi?', 'Yine mi?'],
    ['<breath> Tamam.', 'Tamam.'],
    ['[excited] Harika haber!', 'Harika haber!'],
  ])('supertonic: yalnız boğaz temizleme geçer, diğerleri atılır: %s → %s', (text, expected) => {
    expect(renderExpressionTags(text, 'supertonic')).toBe(expected);
  });

  it('boğaz temizleme öteki motorlarda: v3 kendi yazımıyla, etiketsiz motorda atılır', () => {
    expect(renderExpressionTags('<throatclear> Devam.', 'eleven_v3')).toBe('[clears throat] Devam.');
    expect(renderExpressionTags('<throatclear> Devam.', 'none')).toBe('Devam.');
    expect(ENGINE_TAGS.supertonic).toEqual({ cough: '<throatclear>' });
  });

  // Ölçüm (16 Kas 2026): Türkçe cümlede on sesin onu da etiketi sözcük olarak okudu; İngilizcede altı ses okumadı.
  it('Supertonic: etiket yalnız İngilizce + ölçülmüş sesle geçer; Türkçede ve varsayılan seste (M4) atılır', () => {
    expect(tagEngineFor('supertonic', '', { voice: 'M2', language: 'en' })).toBe('supertonic');
    expect(tagEngineFor('supertonic', '', { voice: 'F1', language: 'en' })).toBe('supertonic');
    expect(tagEngineFor('supertonic', '', { voice: 'M4', language: 'en' })).toBe('none');
    for (const voice of ['M1', 'M2', 'M3', 'M4', 'M5', 'F1', 'F2', 'F3', 'F4', 'F5']) {
      expect(tagEngineFor('supertonic', '', { voice, language: 'tr' }), voice).toBe('none');
    }
    // Bağlam yoksa güvenli taraf: atılır.
    expect(tagEngineFor('supertonic')).toBe('none');
    expect(tagEngineFor('supertonic', '', { voice: 'M2' })).toBe('none');
    expect(tagEngineFor('ema-lightning', '', { voice: 'ema', language: 'en' })).toBe('none');
    expect(tagEngineFor('piper-local')).toBe('none');
    expect(tagEngineFor('elevenlabs', 'eleven_v3')).toBe('eleven_v3');
    expect(tagEngineFor('elevenlabs', 'eleven_flash_v2_5')).toBe('none');
    expect([...SUPERTONIC_TAG_VOICES].sort()).toEqual(['F1', 'F2', 'F3', 'F5', 'M1', 'M2']);
  });

  // Yazılı sohbet Markdown'dur: yalnız tanınan ifadeler atılır, biçim ve boşluklar bozulmaz.
  it.each([
    ['Tamam <laugh>, anladım.', 'Tamam, anladım.'],
    ['<laugh> Bu çok komik!', 'Bu çok komik!'],
    ['Harika [laughs] bir fikir.', 'Harika bir fikir.'],
    ['Olur (gülüyor) tabii.', 'Olur tabii.'],
    ['Peki *güler* devam edelim.', 'Peki devam edelim.'],
    ['İlk satır.\n<sigh>\nİkinci satır.', 'İlk satır.\n\nİkinci satır.'],
    ['Bitti. <laugh>', 'Bitti.'],
  ])('yazılı sohbette tanınan ifade atılır: %s → %s', (text, expected) => {
    expect(stripKnownExpressionTags(text)).toBe(expected);
  });

  it.each([
    ['Kaynak: [Resmî Gazete](https://example.com/a) ve [1].'],
    ['- [ ] yapılacak\n- [x] bitti'],
    ['```ts\nconst a: Array<string> = [];\n  if (a.length < 3) return;\n```'],
    ['| Ad  | Tutar |\n| --- | ----- |\n| KDV |   120 |'],
    ['Bu **çok önemli** bir konu (yarın saat onda).'],
    ['1. Bir\n   - iç madde\n2. İki'],
    ['<bilinmeyen> etiketi yazıda kalır.'],
  ])('yazılı sohbette Markdown ve tanınmayan ayraçlara dokunmaz: %s', (text) => {
    expect(stripKnownExpressionTags(text)).toBe(text);
  });

  it('akışta yarım kalan yönergenin başını bulur', () => {
    expect(openTagStart('Tamam <lau')).toBe(6);
    expect(openTagStart('Tamam <laugh> devam')).toBe(-1);
    expect(openTagStart('Olur [laug')).toBe(5);
    expect(openTagStart('Peki (gülü')).toBe(5);
    expect(openTagStart('Peki *gül')).toBe(5);
    expect(openTagStart('Peki *güler* devam')).toBe(-1);
    expect(openTagStart('Düz bir cümle.')).toBe(-1);
    // Uzakta kalmış açık ayraç yönerge değildir: metin sonsuza dek tutulmaz.
    expect(openTagStart(`3 < 5 ${'a'.repeat(60)}`)).toBe(-1);
  });
});
