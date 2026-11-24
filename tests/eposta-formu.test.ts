// E-posta hesap formu (src/shared/eposta-formu.ts): Görev 19 denetiminde biçimsiz adres ve boş özel sunucu adıyla "Bağla ve sına"
// açıktı; "Sına" sonucu ham JSON'la alert'te çıkıyordu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EPOSTA_BICIMI, epostaFormuEksigi, sinamaMetni, epostaGirdisiniKirp } from '../src/shared/eposta-formu.ts';

// Görev 20b (G19): özel sunucuda " imap.ornek.com " gibi boşluklu ad doğrulamadan geçiyor ama boşluğuyla kaydediliyordu.
test('kaydedilen hesap: ad, adres, kullanıcı ve sunucu adları kırpılır; portlar ve parola olduğu gibi; girdi değişmez', () => {
  const g = { ad: ' İş ', adres: ' deniz@ornek.com ', kullanici: ' deniz@ornek.com', imapSunucu: ' imap.ornek.com ', smtpSunucu: 'smtp.ornek.com\t', imapPort: 993, smtpPort: 465, parola: ' p a ', guvenli: true };
  const k = epostaGirdisiniKirp(g);
  assert.deepEqual(k, { ad: 'İş', adres: 'deniz@ornek.com', kullanici: 'deniz@ornek.com', imapSunucu: 'imap.ornek.com', smtpSunucu: 'smtp.ornek.com', imapPort: 993, smtpPort: 465, parola: ' p a ', guvenli: true });
  assert.equal(g.imapSunucu, ' imap.ornek.com ');
  assert.equal(epostaGirdisiniKirp({ adres: 'a@b.co', imapSunucu: 'x', smtpSunucu: 'y' }).kullanici, undefined, 'olmayan alan eklenmez');
});

test('adres biçimi: ad@alan.uzanti; boşluk, eksik @ ya da noktasız alan geçmez', () => {
  for (const a of ['deniz@ornek.com', 'd.yilmaz+is@posta.ornek.com.tr', 'ece@kuzeyruzgari.example']) assert.ok(EPOSTA_BICIMI.test(a), a);
  for (const a of ['deniz', 'deniz@', '@ornek.com', 'deniz@ornek', 'de niz@ornek.com', 'deniz@ornek..com', 'deniz@@ornek.com']) assert.ok(!EPOSTA_BICIMI.test(a), a);
});

test('form eksiği: sırayla adres, biçim, parola, özel sunucu adları', () => {
  assert.equal(epostaFormuEksigi({ adres: '', parola: 'x' }, false), 'E-posta adresini yaz.');
  assert.match(epostaFormuEksigi({ adres: 'deniz', parola: 'x' }, false) ?? '', /Geçerli bir e-posta/);
  assert.equal(epostaFormuEksigi({ adres: 'deniz@ornek.com', parola: '' }, false), 'Parolayı yaz.');
  assert.equal(epostaFormuEksigi({ adres: ' deniz@ornek.com ', parola: 'x' }, false), null, 'baştaki/sondaki boşluk sorun değil');
  assert.match(epostaFormuEksigi({ adres: 'deniz@ornek.com', parola: 'x', imapSunucu: 'imap.ornek.com', smtpSunucu: ' ' }, true) ?? '', /IMAP ve SMTP/);
  assert.equal(epostaFormuEksigi({ adres: 'deniz@ornek.com', parola: 'x', imapSunucu: 'imap.ornek.com', smtpSunucu: 'smtp.ornek.com' }, true), null);
  assert.equal(epostaFormuEksigi({ adres: 'deniz@ornek.com', parola: 'x' }, false), null, 'hazır sağlayıcıda sunucu adı formdan gelir');
});

test('sınama metni: okuma/gönderim ve neden; ham JSON yok', () => {
  assert.deepEqual(sinamaMetni({ imap: true, smtp: true }), { tamam: true, metin: '✓ okuma · ✓ gönderim' });
  assert.deepEqual(sinamaMetni({ imap: true, smtp: false, hata: 'connect ECONNREFUSED 127.0.0.1:465' }), { tamam: false, metin: '✓ okuma · ✕ gönderim — connect ECONNREFUSED 127.0.0.1:465' });
  assert.deepEqual(sinamaMetni({ imap: false, smtp: false, hata: 'yok' }), { tamam: false, metin: '✕ okuma · ✕ gönderim — hesap bulunamadı' });
  assert.equal(sinamaMetni(null).tamam, false);
});
