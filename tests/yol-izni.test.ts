// İzinli klasör denetimi: kökün kendisi ve içi serbest; adı kökle BAŞLAYAN kardeş klasör ve ".." kaçışı değil.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { kokIcindeMi } from '../src/main/yol-izni.ts';

const W = path.win32;
const KOKLER = ['C:\\Kullanicilar\\deniz\\Desktop', 'C:\\Kullanicilar\\deniz\\Documents\\'];

test('kökün içi ve kendisi izinli (büyük/küçük harf duyarsız)', () => {
  assert.ok(kokIcindeMi('C:\\Kullanicilar\\deniz\\Desktop\\not.txt', KOKLER, W));
  assert.ok(kokIcindeMi('C:\\Kullanicilar\\deniz\\Desktop', KOKLER, W));
  assert.ok(kokIcindeMi('c:\\kullanicilar\\DENIZ\\desktop\\a\\b.pdf', KOKLER, W));
  assert.ok(kokIcindeMi('C:\\Kullanicilar\\deniz\\Documents\\rapor.docx', KOKLER, W)); // sondaki ayırıcılı kök
});

test('ayırıcısız önek eşleşmesi ve ".." kaçışı izinli DEĞİL', () => {
  assert.equal(kokIcindeMi('C:\\Kullanicilar\\deniz\\DesktopGizli\\sir.txt', KOKLER, W), false);
  assert.equal(kokIcindeMi('C:\\Kullanicilar\\deniz\\Documents-eski\\a.txt', KOKLER, W), false);
  assert.equal(kokIcindeMi('C:\\Kullanicilar\\deniz\\Desktop\\..\\AppData\\sirlar.json', KOKLER, W), false);
  assert.equal(kokIcindeMi('D:\\Desktop\\x.txt', KOKLER, W), false);
});
