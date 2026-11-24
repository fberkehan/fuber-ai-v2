// Sohbet hata satırı (src/shared/sohbet-hata.ts): motor hatası hem kalıcı not hem geçici uyarı olarak iki kez görünüyordu
// (Görev 19 denetimi).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { geciciHataGosterilsinMi } from '../src/shared/sohbet-hata.ts';
import type { GorunenMesaj } from '../src/shared/tipler.ts';

const m = (rol: GorunenMesaj['rol'], metin: string, id = 1): GorunenMesaj => ({ id, rol, bloklar: [{ tur: 'metin', metin }], zaman: '2026-10-25T00:00:00.000Z' });
const HATA = 'OpenAI isteği reddetti: 400 Sahte istek hatası';

test('aynı hata son mesajda kalıcı not olarak varsa geçici uyarı gösterilmez', () => {
  assert.equal(geciciHataGosterilsinMi(HATA, [m('user', 'dene'), m('not', `⚠ ${HATA}`, 2)]), false);
});

// Görev 20b (K14): durdurulan yanıtın ardından kalıcı "Durduruldu." notu yazılır; geçici uyarı onun kopyası olmasın.
test('kalıcı "Durduruldu." notu (⚠ işaretsiz) son mesajsa geçici "Durduruldu." gösterilmez', () => {
  assert.equal(geciciHataGosterilsinMi('Durduruldu.', [m('user', 'uzun anlat'), m('assistant', 'Bu yanıt yarım', 2), m('not', 'Durduruldu.', 3)]), false);
  assert.equal(geciciHataGosterilsinMi('Durduruldu.', [m('user', 'uzun anlat'), m('not', 'Durduruldu.', 2)]), false);
});

test('kayda yazılmayan uyarılar (eski sürümde "Durduruldu.", meşgul) ve farklı hata görünür', () => {
  assert.equal(geciciHataGosterilsinMi('Durduruldu.', [m('user', 'uzun anlat')]), true);
  assert.equal(geciciHataGosterilsinMi(HATA, [m('not', '⚠ başka bir hata')]), true);
  assert.equal(geciciHataGosterilsinMi(HATA, []), true);
  assert.equal(geciciHataGosterilsinMi('', [m('not', '⚠ x')]), false);
});
