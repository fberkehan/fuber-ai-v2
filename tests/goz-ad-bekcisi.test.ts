// Ad bekçisi (11 Kas): hayvan karakterler yerine gözler seçildi; arayüzde ve yerel istemlerde "Tilki" ya da "Bukalemun" kalmaz, eski çizim kodu
// geri gelmez. Kullanıcıya görünen her kaynak taranır: masaüstü arayüzü (src/renderer), paylaşılan metinler ve yerel istemler (src/shared, src/main), Yönetim
// arayüzü. Tek istisna eski sunucu kaydını tanıyan desen (shared/karakterler.ts ESKI_KIMLIK: sunucu eski kimliği gönderirse gömülü üslup kullanılır).
// Barındırılan servisteki kayıt bu bekçinin kapsamında değildir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { YENILIKLER } from '../src/shared/yenilik.ts';
import { VARSAYILAN_KARAKTERLER, etkinKarakter } from '../src/shared/karakterler.ts';
import { gorunenKarakterAdi } from '../src/shared/karakter-gorunum.ts';

const kok = path.resolve(import.meta.dirname, '..');
const HAYVAN = /tilki|bukalemun/i;
const ISTISNA = new Set(['src/shared/karakterler.ts']);

function dosyalar(dizin: string): string[] {
  const tam = path.join(kok, dizin);
  if (!fs.existsSync(tam)) return [];
  return fs.readdirSync(tam, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.(tsx?|css|html|json)$/.test(e.name))
    .map((e) => path.relative(kok, path.join(e.parentPath, e.name)).replace(/\\/g, '/'))
    .filter((f) => !f.includes('node_modules'));
}

test('arayüz, paylaşılan metinler, yerel istemler ve Yönetim arayüzünde "Tilki" / "Bukalemun" yok', () => {
  const taranan = ['src/renderer', 'src/shared', 'src/main', 'yonetim/renderer', 'yonetim/shared'].flatMap(dosyalar);
  assert.ok(taranan.length > 200, `taranan dosya: ${taranan.length}`);
  const bulunan = taranan.filter((f) => !ISTISNA.has(f) && HAYVAN.test(fs.readFileSync(path.join(kok, f), 'utf8')));
  assert.deepEqual(bulunan, [], `hayvan adı kalan dosyalar: ${bulunan.join(', ')}`);
  // İstisnadaki tek kullanım eski sunucu kaydını tanıyan desendir; kullanıcıya görünen bir metin değildir.
  const k = fs.readFileSync(path.join(kok, 'src/shared/karakterler.ts'), 'utf8');
  const satirlar = k.split('\n').filter((s) => HAYVAN.test(s));
  assert.deepEqual(satirlar.map((s) => s.trim()), ['const ESKI_KIMLIK = /tilki|bukalemun|\\bfox\\b|chameleon/i;']);
});

test('görünen ad iki modda da "Fuber": gömülü taslaklar, sunucudan gelen eski kayıt, kayıtlı eski ileti, yenilik kartı', () => {
  for (const k of Object.values(VARSAYILAN_KARAKTERLER)) assert.equal(k.ad, 'Fuber');
  const eski = {
    business: { kip: 'business' as const, ad: 'Tilki', tanim: 'Tilki', sistemIstemi: 'Karakterin Tilki.', gorsel: null },
    developer: { kip: 'developer' as const, ad: 'Bukalemun', tanim: '', sistemIstemi: 'Karakterin Bukalemun.', gorsel: null },
  };
  for (const mod of ['is', 'gelistirici'] as const) {
    const k = etkinKarakter(mod, eski);
    assert.equal(k.ad, 'Fuber');
    assert.doesNotMatch(`${k.tanim} ${k.sistemIstemi}`, HAYVAN);
  }
  assert.equal(gorunenKarakterAdi(true, 'Tilki'), 'Fuber');
  assert.doesNotMatch(YENILIKLER.map((s) => s.metin).join(' '), HAYVAN);
});

test('eski karakter çizimi ve hareket kodu silindi; geri gelmez', () => {
  assert.ok(!fs.existsSync(path.join(kok, 'src/renderer/ui/karakter')), 'ui/karakter klasörü yok');
  assert.ok(!fs.existsSync(path.join(kok, 'src/shared/karakter-hareket.ts')), 'eski hareket motoru yok');
  for (const f of ['karakter-onizle', 'karakter-videolari', 'karakter-cizelge', 'karakter-kare-tarama', 'karakter-kirpimlar', 'karakter-sicrama']) {
    assert.ok(!fs.existsSync(path.join(kok, `scripts/dev/${f}.mjs`)), `${f}.mjs yok`);
  }
  const kaynak = ['src/renderer', 'yonetim/renderer'].flatMap(dosyalar).map((f) => fs.readFileSync(path.join(kok, f), 'utf8')).join('\n');
  assert.doesNotMatch(kaynak, /ui\/karakter['/]|karakter-hareket|KARAKTER_VURGUSU|<Karakter[\s/>]|\bGorunenKarakter\b/);
});
