// MCP komut satırı (src/shared/komut-satiri.ts): Görev 19 denetiminde komut alanına boşluk yazılamıyordu ve boşluklu Windows
// yolları ("C:\Program Files\…") parçalanıp MCP sunucusu açılamıyordu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { komutAyristir, komutSatiri } from '../src/shared/komut-satiri.ts';

test('boşlukla ayrılır; ardışık boşluklar tek ayraç', () => {
  assert.deepEqual(komutAyristir('npx -y @modelcontextprotocol/server-filesystem C:\\Projeler'), ['npx', '-y', '@modelcontextprotocol/server-filesystem', 'C:\\Projeler']);
  assert.deepEqual(komutAyristir('  node   sunucu.mjs  '), ['node', 'sunucu.mjs']);
  assert.deepEqual(komutAyristir(''), []);
  assert.deepEqual(komutAyristir('   '), []);
});

test('çift tırnaklı boşluklu yollar tek parça; ters bölü korunur', () => {
  assert.deepEqual(
    komutAyristir('"C:\\Program Files\\nodejs\\node.exe" "C:\\Kullanicilar\\Deniz\\ORNEK LABS\\mcp sunucu.mjs" --kok "D:\\Ortak Klasör"'),
    ['C:\\Program Files\\nodejs\\node.exe', 'C:\\Kullanicilar\\Deniz\\ORNEK LABS\\mcp sunucu.mjs', '--kok', 'D:\\Ortak Klasör'],
  );
  assert.deepEqual(komutAyristir('uvx --from="paket adı" sunucu'), ['uvx', '--from=paket adı', 'sunucu']);
  assert.deepEqual(komutAyristir('komut ""'), ['komut', ''], 'boş tırnak boş argümandır');
});

test("tek tırnak gruplamaz (Windows yolunda geçebilir)", () => {
  assert.deepEqual(komutAyristir("node C:\\Kullanicilar\\O'Brien\\x.mjs"), ['node', "C:\\Kullanicilar\\O'Brien\\x.mjs"]);
});

test('komutSatiri: boşluklu parçayı tırnaklar; ayrıştırınca aynısı döner', () => {
  const komut = 'C:\\Program Files\\nodejs\\node.exe';
  const arg = ['C:\\Kullanicilar\\Deniz\\ORNEK LABS\\x.mjs', '-y', ''];
  const satir = komutSatiri(komut, arg);
  assert.equal(satir, '"C:\\Program Files\\nodejs\\node.exe" "C:\\Kullanicilar\\Deniz\\ORNEK LABS\\x.mjs" -y ""');
  assert.deepEqual(komutAyristir(satir), [komut, ...arg]);
  assert.equal(komutSatiri('npx', ['-y', 'paket']), 'npx -y paket');
  assert.equal(komutSatiri(undefined, []), '');
});
