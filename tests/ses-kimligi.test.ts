// Tek ses ve tek motor (Görev 21, K9 + K10): ses seçimi kuralı (hesabın sesi, yoksa yedek ses, ikisi de yoksa yalnız yazı;
// Gizli modda bulut yok), motor yolu (Gizli mod → yalnız yerel; bulut varsa yerel hiçbir işte yok; motor karışmaz) ve 0.9.0 yükseltme
// göçü — örnek bir 0.8.0 profiliyle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sesSec, sesGocu, hizDuzelt, YEDEK_SES, SES_IS_NOTU, tanimaDustuMetni, sesHataMetni } from '../src/shared/ses-kimligi.ts';
import { motorYolu, yerelTekMotor } from '../src/shared/tek-motor.ts';
import { isDiliIhlali } from '../src/shared/is-dili.ts';

test('ses seçimi: hesabın sesi → yedek ses → null; Gizli modda yalnız yedek; 0.12\'den kalan ElevenLabs anahtarı ve özel ses okunmaz', () => {
  const hesapSesi = { sesId: 'h' };
  assert.deepEqual(sesSec({ bulutsuz: false, yedekKurulu: true, hesapSesi }), { motor: 'elevenlabs', sesId: 'h', hesap: true });
  assert.deepEqual(sesSec({ bulutsuz: false, yedekKurulu: false, hesapSesi }), { motor: 'elevenlabs', sesId: 'h', hesap: true });
  assert.deepEqual(sesSec({ bulutsuz: false, yedekKurulu: true }), { motor: 'yerel', sesId: YEDEK_SES.id });
  assert.equal(sesSec({ bulutsuz: false, yedekKurulu: false }), null);
  // Eski kayıtlar (anahtar, özel ses) hiçbir sırayı değiştirmez.
  const eski = { elevenAnahtar: true, elevenSes: 'ozel' };
  assert.deepEqual(sesSec({ bulutsuz: false, yedekKurulu: true, hesapSesi, ...eski } as never), { motor: 'elevenlabs', sesId: 'h', hesap: true });
  assert.deepEqual(sesSec({ bulutsuz: false, yedekKurulu: true, ...eski } as never), { motor: 'yerel', sesId: YEDEK_SES.id });
  // Gizli mod: ses de bu bilgisayardan çıkmaz.
  assert.deepEqual(sesSec({ bulutsuz: true, yedekKurulu: true, hesapSesi }), { motor: 'yerel', sesId: YEDEK_SES.id });
  assert.equal(sesSec({ bulutsuz: true, yedekKurulu: false, hesapSesi }), null);
});

test('hız sınırları', () => {
  assert.equal(hizDuzelt(3), 1.15); assert.equal(hizDuzelt('x'), 1); assert.equal(hizDuzelt(0.9), 0.9);
});

test('İş modu notu iş diline uyar (anahtar/model/sağlayıcı adı yok)', () => {
  assert.equal(isDiliIhlali(SES_IS_NOTU), null);
  // 0.10 Görev 2 (D2): "Faz 1" ve "abonelikle gelir" kalktı; ne olduğu ve ne zaman indiği söylenir.
  assert.equal(SES_IS_NOTU, 'Fuber bu bilgisayardaki sesiyle konuşur; ilk kullanımda bir kez indirilir.');
});

test('motor yolu (K10): Gizli mod → yalnız yerel (hazır değilse motor yok, buluta düşülmez); bulut varsa yerel hiçbir işte yok', () => {
  assert.equal(motorYolu({ yerelHazir: true, gizliMod: false, bulutVar: true }), 'bulut'); // yerel kurulu ama yanıt yolunda değil
  assert.equal(motorYolu({ yerelHazir: true, gizliMod: true, bulutVar: true }), 'yerel');
  assert.equal(motorYolu({ yerelHazir: false, gizliMod: true, bulutVar: true }), 'yok'); // gizlilik sözü sessizce bozulmaz
  assert.equal(motorYolu({ yerelHazir: true, gizliMod: false, bulutVar: false }), 'yerel'); // hiç bulut yok: yerel tek motor
  assert.equal(motorYolu({ yerelHazir: false, gizliMod: false, bulutVar: false }), 'yok');
  assert.equal(yerelTekMotor({ yerelHazir: true, gizliMod: false, bulutVar: true }), false);
});

test('yükseltme göçü — örnek 0.8.0 profili: google sesi + yerel beyin açık + hızlı ses yerel', () => {
  // Örnek profil: Google sesi, yerel beyin açık, hızlı ses yerel.
  const ham = {
    ses: { uyandirma: true, seslendirme: true, sesAdi: '', kisayol: 'CommandOrControl+Shift+Space', saglayici: 'google', sesler: {}, azureBolge: 'westeurope', mikrofonKapali: false },
    yerel: { etkin: true, model: 'bonsai2-27b', gpu: 'otomatik', gorevler: { gundelik: true, eslikci: true, notTutucu: true, raporcu: true, kokpit: true, siniflandirma: true }, hitapAlgila: true, hizliSes: 'yerel' },
  };
  // ayarlar.ts: derin birleştirme (varsayılan gizliMod: false) SONRA göç; dosyadaki ses.surum yok.
  const a = structuredClone(ham) as typeof ham & { ses: Record<string, unknown>; yerel: Record<string, unknown> };
  (a.yerel as Record<string, unknown>).gizliMod = false;
  assert.equal(sesGocu(a as never, (ham.ses as { surum?: number }).surum), true);
  assert.deepEqual(a.ses, { uyandirma: true, seslendirme: true, kisayol: 'CommandOrControl+Shift+Space', mikrofonKapali: false, hiz: 1, surum: 3 });
  assert.equal('hizliSes' in a.yerel, false);
  assert.equal(a.yerel.gizliMod, false);
  assert.equal(a.yerel.etkin, true, 'yerel beyin kurulu ve açık kalır');
  // Sonuç: bulut (Claude) varken yerel beyin yanıt yolunda DEĞİL (Bonsai ön eleme yok); ses: hesabın sesi yok → yedek ses.
  assert.equal(motorYolu({ yerelHazir: a.yerel.etkin as boolean, gizliMod: a.yerel.gizliMod as boolean, bulutVar: true }), 'bulut');
  assert.deepEqual(sesSec({ bulutsuz: false, yedekKurulu: true }), { motor: 'yerel', sesId: YEDEK_SES.id });
  // Hesap sonradan bağlanırsa karakterin sesi — Google/Windows/tarayıcı sesine asla dönülmez.
  assert.deepEqual(sesSec({ bulutsuz: false, yedekKurulu: true, hesapSesi: { sesId: 'h' } }), { motor: 'elevenlabs', sesId: 'h', hesap: true });
  // İkinci açılış: dosyada surum 3 → göç yeniden çalışmaz.
  assert.equal(sesGocu(a as never, 3), false);
});

test('0.13 son düzeltme 2: 0.12\'de "Bu bilgisayarın sesi"ni seçen kilitli kalmaz — göç bayrağı siler, başka hiçbir şeye dokunmaz, bir kez çalışır', () => {
  // Gerçek 0.12 profili: ses.surum 2 (0.9.0 göçü yapılmış), bayrak açık; birleştirmeden sonra başka eski alanlar da olabilir, 0.9.0 dalı yeniden çalışmaz.
  const a = { ses: { uyandirma: true, hiz: 1.1, surum: 2, bilgisayarSesi: true }, yerel: { gizliMod: true, hizliSes: 'kalsin' } };
  assert.equal(sesGocu(a, 2), true, 'değişiklik var: dosyaya yazılır');
  assert.deepEqual(a.ses, { uyandirma: true, hiz: 1.1, surum: 3 });
  assert.deepEqual(a.yerel, { gizliMod: true, hizliSes: 'kalsin' }, '0.9.0 göçü yeniden çalışmaz');
  assert.equal(sesGocu(a, 3), false);
  // Daha eski profil de tek seferde: 0.9.0 göçü + bayrağın silinmesi.
  const b = { ses: { saglayici: 'google', bilgisayarSesi: true }, yerel: { hizliSes: 'yerel' } };
  assert.equal(sesGocu(b, undefined), true);
  assert.deepEqual(b.ses, { hiz: 1, surum: 3 });
  // Sonuç: hesabın sesi kullanılabiliyorsa o konuşur; Gizli ve "Yalnız bu bilgisayar"da yerel ses zaten tek ses.
  assert.equal(sesSec({ bulutsuz: false, yedekKurulu: true, hesapSesi: { sesId: 'h' } })?.hesap, true);
  assert.deepEqual(sesSec({ bulutsuz: true, yedekKurulu: true, hesapSesi: { sesId: 'h' } }), { motor: 'yerel', sesId: YEDEK_SES.id });
});

test('bayrak hiçbir yerde okunmaz: ses seçimi ve kurulum eski "Bu bilgisayarın sesi"ne bakmaz', () => {
  // Göç yazılmadan bayrak bellekte kalsa da (yazma kilidi) ses seçimi ona bakmaz.
  assert.equal(sesSec({ bulutsuz: false, yedekKurulu: true, hesapSesi: { sesId: 'h' }, bilgisayarSesi: true } as never)?.hesap, true);
  const oku = (y: string) => fs.readFileSync(path.resolve(import.meta.dirname, '..', y), 'utf8');
  for (const y of ['src/main/ses.ts', 'src/main/ses/merkez.ts', 'src/renderer/kurulum2/adimlar/Ses.tsx', 'src/shared/kurulum-vazgec.ts']) assert.doesNotMatch(oku(y), /bilgisayarSesi/, y);
});

test('göç: eskiden seçilmiş ElevenLabs sesi artık taşınmaz (0.13: ses kipe bağlı); Gizli mod açıksa açık kalır; her eski sağlayıcı tek kurala iner', () => {
  for (const eski of ['windows', 'google', 'openai', 'azure', 'google-cloud', 'yerel', 'elevenlabs', undefined]) {
    const a = { ses: { saglayici: eski, sesler: { elevenlabs: 'benim-sesim', openai: 'ash' }, sesAdi: 'ash' }, yerel: { gizliMod: false, hizliSes: 'secili' } };
    assert.equal(sesGocu(a, undefined), true);
    assert.deepEqual(a.ses, { hiz: 1, surum: 3 }, String(eski));
    assert.deepEqual(a.yerel, { gizliMod: false });
  }
  const b = { ses: { sesler: { elevenlabs: 'eski' } }, yerel: { gizliMod: true } };
  sesGocu(b, 1);
  assert.deepEqual(b.ses, { hiz: 1, surum: 3 });
  assert.equal(b.yerel.gizliMod, true);
});
