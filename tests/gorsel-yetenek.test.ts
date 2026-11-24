// İnceleme I4 (analiz 11 Kas bulgu 10): görsel okuyamayan bulut modeline görsel gönderilmez — tek satırlık not (yerel modelin kalıbıyla). Model
// yeteneği: Fuber geçidinin /models `supportsVision` alanı, OpenRouter modaliteleri, Anthropic yetenekleri ya da yerleşik tablo; bilinmiyorsa (null)
// görsel gider (uydurma ret yok).
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anaSurecSahnesi, esbuildHazir } from './yardimci/ana-surec.ts';

import { yerelEkNotu } from '../src/shared/ek-kural.ts';

anaSurecSahnesi('gorsel-yetenek', { kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', mod: 'gelistirici', tanitimSurumu: '0.9.0', proaktif: { etkin: false }, baslangictaAc: false });
process.env.FUBER_DEMO = '1';
await esbuildHazir();
const { gorselOkurMu, testModelKaynagi } = await import('../src/main/motor/model-listesi.ts');

test('not: bulutta görsel okumayan model — görsel ve video karesi için tek satır; okuyan modelde not yok', () => {
  assert.equal(yerelEkNotu({ yerel: false, gorsel: 2, video: false, kisaldi: false }), null);
  assert.equal(yerelEkNotu({ yerel: false, gorselsizModel: 'Yalnız metin', gorsel: 2, video: false, kisaldi: false }), 'Seçili model (Yalnız metin) resim okumaz: eklediğin 2 görsel gönderilmedi.');
  assert.equal(yerelEkNotu({ yerel: false, gorselsizModel: 'Yalnız metin', gorsel: 4, video: true, kisaldi: false }), 'Seçili model (Yalnız metin) resim okumaz: videonun kareleri gönderilmedi, yalnız konuşma yazısı gitti.');
  assert.match(yerelEkNotu({ yerel: true, gorsel: 1, video: false, kisaldi: false })!, /^Bu modelde resim okunmaz/);
});
