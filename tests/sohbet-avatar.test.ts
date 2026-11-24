// 0.14 T30 — kokpit ve sohbet Nusa dilinde, Fuber iletisinin başında karakter avatarı. Avatar seçimi saf (renderer/bilesenler/sohbet-avatar.ts);
// arayüz dosyaları JSX olduğu için kaynak taramasıyla denetlenir (tests/karakter-gorunum.test.ts deseni). `mesajlar.kip` göçü bellek içi
// veritabanında iki kez koşturulur (main/vt.ts kipSutunu; 'electron' ve yollar.ts sahtelenir).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { avatarSec, AVATAR_PX } from '../src/renderer/bilesenler/sohbet-avatar.ts';
import { vurguStili } from '../src/renderer/ui/vurgu.ts';
import { KIP_VURGUSU } from '../src/renderer/ui/goz/vurgu.ts';

const kok = path.resolve(import.meta.dirname, '..');
const oku = (f: string) => fs.readFileSync(path.join(kok, f), 'utf8');
const veri = (kod: string) => `data:text/javascript,${encodeURIComponent(kod)}`;
const kanca = registerHooks({
  resolve(belirtec, baglam, sonraki) {
    if (belirtec === 'electron') return { url: veri('export const app = { getPath: () => "." };'), shortCircuit: true };
    if (belirtec.startsWith('.') && belirtec.endsWith('.js') && baglam.parentURL?.startsWith('file:')) {
      const ts = new URL(belirtec.replace(/\.js$/, '.ts'), baglam.parentURL);
      if (fs.existsSync(fileURLToPath(ts))) return sonraki(ts.href, baglam);
    }
    return sonraki(belirtec, baglam);
  },
});
after(() => kanca.deregister());

/** `ad` işlevinin gövdesi (bir sonraki üst düzey `function`a kadar). */
function islev(kaynak: string, ad: string): string {
  const i = kaynak.indexOf(`function ${ad}(`);
  assert.ok(i >= 0, `${ad} bulunamadı`);
  const j = kaynak.indexOf('\nfunction ', i + 10);
  const k = kaynak.indexOf('\nexport function ', i + 10);
  const son = [j, k].filter((x) => x > 0).sort((a, b) => a - b)[0] ?? kaynak.length;
  return kaynak.slice(i, son);
}

test('yanıt başında gözler (24 px siyah daire) iletinin kip\'iyle; eski iletide kip yoksa "Fuber" işareti', () => {
  assert.equal(AVATAR_PX, 24);
  assert.deepEqual(avatarSec({ kip: 'business', karakterGorunur: true }), { tur: 'goz', kip: 'business', boyut: 24, ifade: 'sakin' });
  assert.deepEqual(avatarSec({ kip: 'developer', karakterGorunur: true }), { tur: 'goz', kip: 'developer', boyut: 24, ifade: 'sakin' });
  // Eski ileti (0.14 öncesi, kip sütunu boş) ya da bozuk değer: Fuber işareti; kip ayardaki moddan TAHMİN edilmez.
  for (const kip of [undefined, null, '', 'is', 'BUSINESS', 1]) assert.deepEqual(avatarSec({ kip, karakterGorunur: true }), { tur: 'isaret' });
  // Sade mod (T6b): hiçbir iletide göz yok, Fuber işareti.
  assert.deepEqual(avatarSec({ kip: 'business', karakterGorunur: false }), { tur: 'isaret' });
  assert.deepEqual(avatarSec({ kip: 'developer', karakterGorunur: false, suruyor: true }), { tur: 'isaret' });

  const s = oku('src/renderer/bilesenler/Sohbet.tsx');
  const bas = islev(s, 'FuberBasi');
  assert.match(bas, /useKarakterGorunur\(\)/, 'Sade ayarı kancadan okunur');
  assert.match(bas, /avatarSec\(/);
  assert.match(bas, /<Gozler\b[^>]*kip=\{a\.kip\}[^>]*ifade=\{a\.ifade\}[^>]*boyut=\{a\.boyut\}/);
  assert.match(bas, /<UrunIsareti\b/, 'kipsiz ileti ve Sade: mevcut Fuber işareti (yeni logo yok)');
  // Ad iki durumda da "Fuber" (kayıtlı eski ileti hayvan adı taşısa da: gorunenKarakterAdi).
  assert.match(bas, /mesaj__ad">\{a\.tur === 'goz' \? \(karakter \|\| 'Fuber'\) : 'Fuber'\}/, 'işaretin yanında başka ad durmaz');
  assert.doesNotMatch(bas, /\bhal=/, 'avatar durağan: hareket beyni (sakkad, kırpma, uyku zamanlayıcısı) iletilerde çalışmaz');
  // Kayıtlı iletinin kip'i ve canlı balonun kip'i ('basladi' olayından kilitlenen) avatara gider.
  assert.match(islev(s, 'Mesaj'), /<FuberBasi\b[^>]*kip=\{m\.kip\}/);
  assert.match(s, /<FuberBasi\b[^>]*kip=\{canliKip\}[^>]*suruyor/);
});

test('süren yanıtta ifade konusuyor, bitince sakin', () => {
  assert.equal((avatarSec({ kip: 'business', karakterGorunur: true, suruyor: true }) as { ifade: string }).ifade, 'konusuyor');
  assert.equal((avatarSec({ kip: 'business', karakterGorunur: true, suruyor: false }) as { ifade: string }).ifade, 'sakin');
  // Canlı balon tur sürerken `suruyor` verir; tur bitince kayıtlı ileti (suruyor yok) sakin çizilir.
  const s = oku('src/renderer/bilesenler/Sohbet.tsx');
  assert.match(s, /<FuberBasi\b[^>]*suruyor=\{calisiyor\}/);
  assert.doesNotMatch(islev(s, 'Mesaj'), /suruyor/);
});

test('tavan notundaki "Devam et" düğmesi ortak Dugme hap bileşenini kullanır (mantık ve yeni tur testi T13\'te)', () => {
  const s = oku('src/renderer/bilesenler/Sohbet.tsx');
  const i = s.indexOf('data-tavan-devam');
  assert.ok(i > 0);
  const blok = s.slice(i, s.indexOf('</div>', i));
  assert.match(blok, /<Dugme\b[^>]*tur="birincil"[^>]*onClick=\{\(\) => void gonder\(DEVAM_METNI\)\}[^>]*>Devam et<\/Dugme>/);
  assert.doesNotMatch(blok, /className="dgm/, 'elle yazılmış düğme sınıfı yok');
  assert.match(s, /import \{[^}]*\bDugme\b[^}]*\} from '\.\.\/ui'/);
  // T13'ün koşulu aynen durur: son ileti tavan notu, tur sürmüyor, gönderim açık.
  assert.match(s, /!calisiyor && !canli && !gonderimKapali && mesajlar\.at\(-1\)\?\.rol === 'not' && mesajlar\.at\(-1\)\?\.kaynak === TAVAN_NOTU_KAYNAGI/);
});

test('boş durumda gözler (durağan) ve tek satır', () => {
  const b = oku('src/renderer/ui/Bos.tsx');
  assert.match(b, /<GorunenGoz\b[^>]*kip=\{karakter\}/, 'Sade modda GorunenGoz göz çizmez (T6b)');
  assert.doesNotMatch(b, /<GorunenGoz\b[^>]*\bhal=/, 'boş durum gözü durağan');
  // Karakterli boş durum yalnız başlığı gösterir (tek satır); açıklama çizilmez. Karakter isteğe bağlı: öbür ekranların boş durumu değişmez.
  assert.match(b, /\{metin && !karakter && /);
  // Düzeltme turu 1 (M3): karakter ile açıklama türde birlikte verilemez (açıklama sessizce düşmesin).
  assert.match(b, /\| \{ metin\?: string; karakter\?: undefined \}/);
  assert.match(b, /\| \{ karakter: KipKimligi; metin\?: never \}/);
  const s = oku('src/renderer/bilesenler/Sohbet.tsx');
  assert.match(s, /<Bos karakter=\{kipSimdi\} baslik="Fuber’e bir şey sor ya da söyle\." \/>/);
});

test('kip sütunu göçü iki kez koşunca bozulmaz', async () => {
  const { kipSutunu } = await import('../src/main/vt.ts');
  const v = new DatabaseSync(':memory:');
  v.exec("CREATE TABLE mesajlar(id INTEGER PRIMARY KEY, sohbet_id INTEGER, rol TEXT, metin TEXT, karakter TEXT); INSERT INTO mesajlar(sohbet_id, rol, metin, karakter) VALUES(1, 'assistant', 'eski yanıt', 'Tilki');");
  kipSutunu(v);
  kipSutunu(v);
  const sutunlar = (v.prepare('PRAGMA table_info(mesajlar)').all() as { name: string }[]).map((x) => x.name);
  assert.equal(sutunlar.filter((x) => x === 'kip').length, 1);
  assert.deepEqual(v.prepare('SELECT metin, karakter, kip FROM mesajlar').all().map((r) => ({ ...r })), [{ metin: 'eski yanıt', karakter: 'Tilki', kip: null }], 'eski satır korunur, kip boş (arayüz Fuber işareti)');
  // Tablo yoksa (boş veritabanı) hata vermez.
  kipSutunu(new DatabaseSync(':memory:'));
  // Yazma ve okuma yolu: ajan döngüsü iletiye turun kip'ini yazar, görünüm taşır.
  const vt = oku('src/main/vt.ts');
  assert.match(vt, /GOCLER[\s\S]*karakterSutunu,\s*\/\/[^\n]*\n\s*kipSutunu,\s*\];/);
  assert.match(vt, /kipSutunu\(vt\); \/\/ savunma/);
  const d = oku('src/main/ajan/dongu.ts');
  assert.ok((d.match(/kip: karakter\.kip/g)?.length ?? 0) >= 2, 'iki mesajEkle çağrısı (yanıt ve durma) kip yazar');
  const so = oku('src/main/sohbet.ts');
  assert.match(so, /kipTemizle\(s\.kip\)/);
  assert.match(so, /karakter, kip\) VALUES\(\?,\?,\?,\?,\?,\?,\?,\?,\?,\?,\?\)/);
  assert.match(so, /\.\.\.\(m\.kip \? \{ kip: m\.kip \} : \{\}\)/);
  assert.match(oku('src/shared/tipler.ts'), /kip\?: KipKimligi;/);
});
