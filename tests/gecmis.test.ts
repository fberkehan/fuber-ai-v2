// Araç çağrısı/sonucu eşleşmesi: yarım kalan bir araç döngüsü sohbeti kalıcı 400'e kilitlememeli.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { araclariOnar, gunEtiketi } from '../src/main/ajan/gecmis.ts';

test('gün etiketi: bugün yok, dün ve daha eski tarihli', () => {
  const simdi = new Date(2026, 9, 19, 13, 20);
  assert.equal(gunEtiketi(new Date(2026, 9, 19, 8, 5).toISOString(), simdi), null);
  assert.equal(gunEtiketi(new Date(2026, 9, 18, 18, 40).toISOString(), simdi), 'dün 18:40');
  assert.equal(gunEtiketi(new Date(2026, 9, 16, 9, 10).toISOString(), simdi), '16 Eki Cum 09:10');
  assert.equal(gunEtiketi(new Date(2025, 11, 31, 23, 59).toISOString(), simdi), '31 Ara Çar 2025 23:59');
  assert.equal(gunEtiketi('çöp', simdi), null);
});

test('eşleşen çağrı + sonuç aynen kalır', () => {
  const out = araclariOnar([
    { rol: 'user', bloklar: [{ tur: 'metin', metin: 'hatırlat' }] },
    { rol: 'assistant', bloklar: [{ tur: 'arac_cagri', id: 'a', ad: 'hatirlatici_kur', girdi: {} }] },
    { rol: 'user', bloklar: [{ tur: 'arac_sonuc', id: 'a', icerik: 'tamam' }] },
    { rol: 'assistant', bloklar: [{ tur: 'metin', metin: 'kurdum' }] },
  ]);
  assert.equal(out[1].bloklar[0].tur, 'arac_cagri');
  assert.equal(out[2].bloklar[0].tur, 'arac_sonuc');
});

test('sonucu olmayan çağrı metne döner (uygulama yarıda kapanmış)', () => {
  const out = araclariOnar([
    { rol: 'user', bloklar: [{ tur: 'metin', metin: 'ekranıma bak' }] },
    { rol: 'assistant', bloklar: [{ tur: 'metin', metin: 'bakıyorum' }, { tur: 'arac_cagri', id: 'x', ad: 'bilgisayar_ekran', girdi: {} }] },
    { rol: 'user', bloklar: [{ tur: 'metin', metin: 'ne oldu?' }] },
  ]);
  assert.ok(out.every((m) => m.bloklar.every((b) => b.tur !== 'arac_cagri')));
  assert.match(JSON.stringify(out[1]), /bilgisayar_ekran aracı çağrıldı/);
});

test('asistan mesajının içindeki ve yetim araç sonuçları metne döner', () => {
  const out = araclariOnar([
    { rol: 'user', bloklar: [{ tur: 'metin', metin: 'a' }] },
    { rol: 'assistant', bloklar: [{ tur: 'arac_sonuc', id: 'q', icerik: 'yanlış yerde' }, { tur: 'metin', metin: 'b' }] },
    { rol: 'user', bloklar: [{ tur: 'arac_sonuc', id: 'yok', icerik: 'yetim' }, { tur: 'metin', metin: 'c' }] },
  ]);
  assert.ok(out.every((m) => m.bloklar.every((b) => b.tur !== 'arac_sonuc')));
});

test('araç sonuçları kullanıcı mesajının başına alınır', () => {
  const out = araclariOnar([
    { rol: 'user', bloklar: [{ tur: 'metin', metin: 'a' }] },
    { rol: 'assistant', bloklar: [{ tur: 'arac_cagri', id: 'k', ad: 'zaman', girdi: {} }] },
    { rol: 'user', bloklar: [{ tur: 'metin', metin: 'ek not' }, { tur: 'arac_sonuc', id: 'k', icerik: '09:12' }] },
  ]);
  assert.equal(out[2].bloklar[0].tur, 'arac_sonuc');
  assert.equal(out[2].bloklar[1].tur, 'metin');
});
