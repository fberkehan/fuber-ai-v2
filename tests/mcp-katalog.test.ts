// 0.14 T0: MCP kataloğu sözleşmesi — shared/mcp-katalog.ts (Ruling R11 ilk katalog, B39 tur alanı, MCP'de yazan araç onayı).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ILK_KATALOG, MCP_SIMGELERI, katalogGirdisiDogrula, katalogListesiDogrula, aracOnayGerekirMi, type McpKatalogGirdisi } from '../src/shared/mcp-katalog.ts';

/** Geçerli, açık bir katalog girdisi (https uzak uç). */
const GIRDI: McpKatalogGirdisi = {
  id: 'ornek-servis', ad: 'Örnek Servis', simge: 'genel', aciklama: 'Deneme girdisi', tur: 'http', adres: 'https://mcp.ornek.com/mcp',
  oauth: null, saltOkunur: [], gundemAraci: null, acik: true, sira: 1,
};

test('geçerli girdi geçer; yazılan kopya özgün nesneden bağımsız', () => {
  const g = katalogGirdisiDogrula(GIRDI);
  assert.deepEqual(g, GIRDI);
  assert.notEqual(g, GIRDI);
});

test('açık katalog girdisi https adres ister', () => {
  assert.equal(katalogGirdisiDogrula({ ...ILK_KATALOG[0], adres: 'http://x', acik: true }), null);
  assert.equal(katalogGirdisiDogrula({ ...GIRDI, adres: 'http://mcp.ornek.com/mcp' }), null);
  assert.equal(katalogGirdisiDogrula({ ...GIRDI, adres: '' }), null); // açık ama adres yok
  assert.equal(katalogGirdisiDogrula({ ...GIRDI, adres: 'https://kul:parola@mcp.ornek.com/mcp' }), null);
  assert.equal(katalogGirdisiDogrula({ ...GIRDI, adres: 'ftp://mcp.ornek.com' }), null);
});

test('kapalı http girdisi adressiz olabilir ama adresi varsa yine https olmalı', () => {
  assert.ok(katalogGirdisiDogrula({ ...GIRDI, adres: '', acik: false }));
  assert.equal(katalogGirdisiDogrula({ ...GIRDI, adres: 'http://x', acik: false }), null);
});

test('B39: stdio girdisi adres olarak komut tutar; https kuralı yalnız http türünde', () => {
  const stdio = { ...GIRDI, tur: 'stdio' as const, adres: 'npx -y @ornek/mcp-sunucu' };
  assert.deepEqual(katalogGirdisiDogrula(stdio), stdio);
  assert.equal(katalogGirdisiDogrula({ ...stdio, adres: '' }), null); // açık stdio komutsuz olamaz
  assert.ok(katalogGirdisiDogrula({ ...stdio, adres: '', acik: false }));
  assert.equal(katalogGirdisiDogrula({ ...GIRDI, tur: 'ws' }), null);
  assert.equal(katalogGirdisiDogrula({ ...GIRDI, tur: undefined }), null);
});

test('kimlik, simge, boyut ve tür denetimleri', () => {
  for (const id of ['A', 'a', 'a b', 'a_b', 'x'.repeat(41), 'Ş-ş']) assert.equal(katalogGirdisiDogrula({ ...GIRDI, id }), null, `id ${id}`);
  for (const id of ['ab', 'x'.repeat(40), 'a-1']) assert.ok(katalogGirdisiDogrula({ ...GIRDI, id }), `id ${id}`);
  assert.equal(katalogGirdisiDogrula({ ...GIRDI, simge: 'baska' }), null);
  assert.equal(katalogGirdisiDogrula({ ...GIRDI, ad: '' }), null);
  assert.equal(katalogGirdisiDogrula({ ...GIRDI, acik: 'evet' }), null);
  assert.equal(katalogGirdisiDogrula({ ...GIRDI, sira: 1.5 }), null);
  assert.equal(katalogGirdisiDogrula({ ...GIRDI, saltOkunur: Array.from({ length: 201 }, (_, i) => `a${i}`) }), null);
  assert.ok(katalogGirdisiDogrula({ ...GIRDI, saltOkunur: Array.from({ length: 200 }, (_, i) => `a${i}`) }));
  assert.equal(katalogGirdisiDogrula({ ...GIRDI, saltOkunur: [1] }), null);
  assert.equal(katalogGirdisiDogrula(null), null);
  assert.equal(katalogGirdisiDogrula('x'), null);
});

test('oauth ve gündem aracı alanları doğrulanır', () => {
  const oauth = { istemciKimligi: 'k', kapsamlar: ['a', 'b'], sirSunucuda: true, belirtecAdresi: 'https://ornek.com/token' };
  assert.deepEqual(katalogGirdisiDogrula({ ...GIRDI, oauth })?.oauth, oauth);
  assert.equal(katalogGirdisiDogrula({ ...GIRDI, oauth: { belirtecAdresi: 'http://ornek.com/token' } }), null);
  assert.equal(katalogGirdisiDogrula({ ...GIRDI, oauth: { kapsamlar: [1] } }), null);
  assert.equal(katalogGirdisiDogrula({ ...GIRDI, oauth: 'x' }), null);
  const gundem = { ad: 'list_events', girdi: { calendarId: 'primary' } };
  assert.deepEqual(katalogGirdisiDogrula({ ...GIRDI, gundemAraci: gundem })?.gundemAraci, gundem);
  assert.equal(katalogGirdisiDogrula({ ...GIRDI, gundemAraci: { ad: '', girdi: {} } }), null);
  assert.equal(katalogGirdisiDogrula({ ...GIRDI, gundemAraci: { ad: 'x', girdi: [] } }), null);
});

test('liste: tümü geçerliyse döner; bir bozuk girdi, yinelenen kimlik ya da dizi olmayan değer null', () => {
  assert.equal(katalogListesiDogrula([GIRDI, { ...GIRDI, id: 'baska-servis', sira: 2 }])?.length, 2);
  assert.deepEqual(katalogListesiDogrula([]), []);
  assert.equal(katalogListesiDogrula([GIRDI, { ...GIRDI, adres: 'http://x' }]), null);
  assert.equal(katalogListesiDogrula([GIRDI, GIRDI]), null);
  assert.equal(katalogListesiDogrula({}), null);
  assert.equal(katalogListesiDogrula(undefined), null);
});

test('ilk katalog yedi girdi, hepsi kapalı, adres yalnız GitHub ve Notion (R11)', () => {
  assert.equal(ILK_KATALOG.length, 7);
  assert.deepEqual(ILK_KATALOG.map((g) => g.simge).sort(), ['drive', 'github', 'gmail', 'microsoft', 'notion', 'slack', 'takvim']);
  assert.ok(ILK_KATALOG.every((g) => MCP_SIMGELERI.includes(g.simge)));
  assert.equal(new Set(ILK_KATALOG.map((g) => g.id)).size, 7);
  assert.equal(new Set(ILK_KATALOG.map((g) => g.sira)).size, 7);
  for (const g of ILK_KATALOG) {
    assert.equal(g.acik, false, `${g.id} kapalı olmalı`);
    assert.equal(g.tur, 'http', `${g.id} http olmalı`); // B39
  }
  const adresli = Object.fromEntries(ILK_KATALOG.filter((g) => g.adres !== '').map((g) => [g.simge, g.adres]));
  assert.deepEqual(adresli, { github: 'https://api.githubcopilot.com/mcp/', notion: 'https://mcp.notion.com/mcp' });
  assert.equal(ILK_KATALOG.filter((g) => g.adres === '').length, 5);
  // Hepsi sözleşmeden geçer (kapalı, adressiz girdi de geçerli) ve adres girilmeden açılamaz.
  assert.equal(katalogListesiDogrula(ILK_KATALOG)?.length, 7);
  for (const g of ILK_KATALOG.filter((x) => x.adres === '')) assert.equal(katalogGirdisiDogrula({ ...g, acik: true }), null, `${g.id} adressiz açılamaz`);
  for (const g of ILK_KATALOG.filter((x) => x.adres !== '')) assert.ok(katalogGirdisiDogrula({ ...g, acik: true }), `${g.id} adresiyle açılabilir`);
});

test('MCP: bilinmeyen araç onaylı; readOnlyHint ya da saltOkunur listesi onaysız', () => {
  assert.equal(aracOnayGerekirMi(null, { name: 'x' }), true);
  assert.equal(aracOnayGerekirMi(null, { name: 'x', annotations: { readOnlyHint: true } }), false);
  assert.equal(aracOnayGerekirMi({ ...GIRDI, saltOkunur: ['list_files'] }, { name: 'list_files' }), false);
  assert.equal(aracOnayGerekirMi({ ...GIRDI, saltOkunur: ['list_files'] }, { name: 'delete_file' }), true);
  assert.equal(aracOnayGerekirMi(GIRDI, { name: 'x', annotations: { readOnlyHint: false } }), true);
  assert.equal(aracOnayGerekirMi(GIRDI, { name: 'x', annotations: {} }), true);
});
