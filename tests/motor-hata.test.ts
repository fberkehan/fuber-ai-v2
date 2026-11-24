// A1 (son düzeltme): İş modunda motorun ham hata iletileri sohbette, adada ve telefonda görünmez. Her sağlayıcının KAYNAKTAKİ iletisi
// (motor/*.ts ve ajan/dongu.ts'teki `new MotorHatasi('…', …)` çağrıları) eşlemeden geçer ve İş yasak sözcükleriyle (IS_YASAK) taranır.
// B7: araç kartının özeti İş'te sade (ham hata yok), Geliştirici'de ayrıntı.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gorunenMotorHatasi, IS_MOTOR_HATASI, motorHataMetni, anahtarYokMetni, type MotorHataTuru } from '../src/shared/abonelik.ts';
import { isDiliIhlali, aracKartiOzeti, ARAC_HATA_IS, ARAC_RED_IS } from '../src/shared/is-dili.ts';

const kok = path.resolve(import.meta.dirname, '..');
const TURLER: MotorHataTuru[] = ['anahtar', 'limit', 'baglanti', 'istek', 'bilinmiyor'];
/** İş metinlerinde teknik iç adlar da yok (Ruling O, B5): "yerel beyin", "bulut motoru", HTTP kodu. */
const TEKNIK = /yerel beyin|bulut motoru|HTTP\s*\d|\b[45]\d\d\b/i;

/** Kaynaktaki bütün `new MotorHatasi(<dize>` iletileri; şablon değişkenleri örnek değerle doldurulur (ham sağlayıcı iletisi gibi). */
function kaynaktakiIletiler(): { dosya: string; ileti: string }[] {
  const dosyalar = ['src/main/motor/anthropic.ts', 'src/main/motor/openai.ts', 'src/main/motor/fuber.ts', 'src/main/motor/yerel.ts', 'src/main/motor/secici.ts', 'src/main/ajan/dongu.ts'];
  const out: { dosya: string; ileti: string }[] = [];
  for (const d of dosyalar) {
    const metin = fs.readFileSync(path.join(kok, d), 'utf8');
    for (const m of metin.matchAll(/new MotorHatasi\(\s*(`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*')/g)) {
      const ileti = m[1].slice(1, -1).replace(/\$\{[^}]*\}/g, 'Claude 503 Overloaded: model claude-opus-5-5 anthropic API');
      out.push({ dosya: d, ileti });
    }
  }
  return out;
}

test('İş için zaten yazılmış motor-durdu iletileri (K3 açıklaması) olduğu gibi kalır; anahtarsız sağlayıcı da öyle', () => {
  for (const t of ['yok', 'bulut-gerekli'] as const) assert.equal(gorunenMotorHatasi('anahtar', motorHataMetni(t, 'is'), 'is'), motorHataMetni(t, 'is'));
  // 0.10 G2: Fuber hesabı onay bekliyor / kapalı / doldu — R10 metni olduğu gibi (genel "kabul edilmedi" cümlesine dönmez).
  for (const h of ['bekliyor', 'kapali', 'kredi-bitti'] as const) {
    const m = motorHataMetni('yok', 'is', h);
    assert.equal(gorunenMotorHatasi('anahtar', m, 'is'), m, h);
    assert.equal(isDiliIhlali(m), null, m);
  }
  for (const s of ['Claude', 'OpenAI', 'OpenRouter', 'Fuber']) {
    const m = anahtarYokMetni(s, 'is');
    assert.equal(gorunenMotorHatasi('anahtar', m, 'is'), m);
    assert.equal(isDiliIhlali(m), null, m);
  }
});

test('her türün İş cümlesi temiz; tür bilinmiyorsa ya da düz Error ise genel cümle', () => {
  for (const t of TURLER) {
    assert.equal(isDiliIhlali(IS_MOTOR_HATASI[t]), null, IS_MOTOR_HATASI[t]);
    assert.doesNotMatch(IS_MOTOR_HATASI[t], TEKNIK);
  }
  assert.equal(gorunenMotorHatasi(undefined, 'TypeError: fetch failed', 'is'), IS_MOTOR_HATASI.bilinmiyor);
  // Türe göre farklı yol: bağlantı internet der, sınır "biraz sonra" der.
  assert.match(IS_MOTOR_HATASI.baglanti, /internet/);
  assert.match(IS_MOTOR_HATASI.limit, /biraz sonra/);
});

test('B7: araç kartı — İş\'te başarısız/reddedilen adımın ham hatası yok, Geliştirici\'de ayrıntı; başarılı özet değişmez', () => {
  const ham = 'page.goto: net::ERR_NAME_NOT_RESOLVED at https://api.openai.com';
  assert.equal(aracKartiOzeti('hata', ham, 'is'), ARAC_HATA_IS);
  assert.equal(aracKartiOzeti('reddedildi', 'Kullanıcı reddetti.', 'is'), ARAC_RED_IS);
  assert.equal(aracKartiOzeti('hata', ham, 'gelistirici'), ham);
  assert.equal(aracKartiOzeti('tamam', '3 e-posta okundu', 'is'), '3 e-posta okundu');
  for (const m of [ARAC_HATA_IS, ARAC_RED_IS]) assert.equal(isDiliIhlali(m), null, m);
});
