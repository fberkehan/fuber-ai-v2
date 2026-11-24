// 11 Kas tasarımcı analizi, bulgu 7: sohbet dışındaki ekranlarda kullanıcının okuduğu metne iç kimlikler ve ham teknik dizgiler sızıyordu —
// Hafıza'da "H-8" hapı ve "sohbet:1" kaynağı, Bağlantılar'da tam Windows yolu (eş aralıklı yazıyla), çentikte/telefonda "Adım sınırına geldim
// (100)", görev sonucunda "En çok 60 adım sınırına ulaşıldı", Gün kaydında "0 satır · 0 not (0 önemli) · 0 araya girme". Bu bekçi:
//  · saf yardımcıların (kaynak etiketi, klasör adı, gün kaydı sayaçları, tavan notu) çıktısında iç kimlik ve yol kalıbı yok;
//  · sohbet dışındaki arayüz kaynaklarında (Sohbet.tsx, Claude Code ekranları ve Geliştirici'ye özel MCP satırı hariç) iç kimliği ham basan JSX yok.
// İş izi işi (11 Kas) sohbetin kendisini de kapsar: atıf hapları (H-7) nokta oldu, geçmişteki "Adım sınırı (100)" ve görev sohbetindeki "adım sınırına (30)"
// insan diline çevrilir, Claude Code'daki "general-purpose" çipi kalktı.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { kaynakGorunumu } from '../src/shared/hafiza-kaynak.ts';
import { IC_KIMLIK_KALIBI, icKimlikVarMi, klasorAdi, atiflariNoktala } from '../src/shared/gorunen-metin.ts';
import { gunKaydiSayaclari } from '../src/shared/gun-kaydi-metni.ts';
import { tavanKisaMetni, sinirSayisiniGizle } from '../src/shared/sohbet-gorunum.ts';
import { ccAjanTipiAdi } from '../src/shared/is-izi.ts';

test('kalıp iç kimlikleri yakalar, düz metne dokunmaz', () => {
  for (const m of ['H-8', 'sohbet:1', 'C:\\Kullanicilar\\deniz\\AppData\\Roaming\\Fuber AI\\ogret', 'Adım sınırına geldim (100)', 'kontrol aralığı 45 sn', 'gorev:12', '/home/deniz/.config/x']) {
    assert.ok(icKimlikVarMi(m), m);
  }
  for (const m of ['Sohbetten', 'Yatırımcı ön görüşmesi', '2 görev sürüyor', 'Pro · 29 $ · 5', 'Ece henüz yazmadı; yarım saatte bir bakıyorum.', 'Saat 14:30', 'Hafıza']) {
    assert.ok(!icKimlikVarMi(m), m);
  }
  assert.ok(IC_KIMLIK_KALIBI instanceof RegExp);
});

test('Hafıza kaynağı insan diliyle: "sohbet:1" yerine "Sohbetten"; bilinmeyen kaynak boş', () => {
  assert.equal(kaynakGorunumu('sohbet:1'), 'Sohbetten');
  assert.equal(kaynakGorunumu('kurulum, sohbet:3'), 'Kurulumda');
  assert.equal(kaynakGorunumu('kullanici'), 'Sen ekledin');
  assert.equal(kaynakGorunumu('dosya:C:\\x\\rapor.pdf'), 'Belgeden');
  assert.equal(kaynakGorunumu('gunkaydi:2026-11-10'), 'Gün kaydından');
  assert.equal(kaynakGorunumu(''), '');
  assert.equal(kaynakGorunumu(undefined), '');
  assert.equal(kaynakGorunumu('garip:77'), '');
  for (const k of ['sohbet:1', 'kurulum', 'kullanici', 'ayarlar', 'dosya:a', 'belge:3', 'gunkaydi:x', 'yapilacaklar:y']) assert.ok(!icKimlikVarMi(kaynakGorunumu(k)), k);
});

test('Öğretme klasörü: tam yol yerine yalnız klasör adı', () => {
  assert.equal(klasorAdi('C:\\Kullanicilar\\deniz\\AppData\\Roaming\\Fuber AI\\Fuber’e öğret'), 'Fuber’e öğret');
  assert.equal(klasorAdi('C:\\Kullanicilar\\deniz\\Fuber\\'), 'Fuber');
  assert.equal(klasorAdi('/Users/deniz/Library/Fuber AI/ogret'), 'ogret');
  assert.equal(klasorAdi(''), '');
  assert.equal(klasorAdi(undefined), '');
});

test('Gün kaydı sayaçları: ham "0 satır · 0 not (0 önemli) · 0 araya girme" yok', () => {
  assert.equal(gunKaydiSayaclari({ satir: 0, madde: 0, onemli: 0, eslik: 0 }), 'Bugün henüz not yok.');
  assert.equal(gunKaydiSayaclari({ satir: 120, madde: 14, onemli: 3, eslik: 2 }), 'Bugün 14 not (3 önemli) · 2 kez araya girdi');
  assert.equal(gunKaydiSayaclari({ satir: 40, madde: 1, onemli: 0, eslik: 0 }), 'Bugün 1 not');
  assert.doesNotMatch(gunKaydiSayaclari({ satir: 40, madde: 0, onemli: 0, eslik: 1 }), /satır/);
});

test('çentikte ve telefonda tavan notu iç sınır sayısını taşımaz', () => {
  assert.ok(!icKimlikVarMi(tavanKisaMetni(100)), tavanKisaMetni(100));
  assert.doesNotMatch(tavanKisaMetni(100), /\b100\b|Adım sınırı/);
});

// ── Kaynak taraması: sohbet dışındaki ekranlar iç kimliği ham basmaz ──
const kok = path.resolve(import.meta.dirname, '..');
const goreli = (y: string) => path.relative(kok, y).replace(/\\/g, '/');
function dosyalar(dizin: string): string[] {
  return fs.readdirSync(dizin, { withFileTypes: true }).flatMap((e) => {
    const y = path.join(dizin, e.name);
    return e.isDirectory() ? dosyalar(y) : /\.tsx$/.test(e.name) ? [y] : [];
  });
}
/** Sohbet ve Claude Code (Geliştirici aracı; başka bir işte ele alınıyor) kapsam dışı. */
const KAPSAM_DISI = /^src\/renderer\/(bilesenler\/Sohbet\.tsx|.*ClaudeCode[^/]*\.tsx|claudecode\/|ui\/Galeri\.tsx)/;
const YASAK_JSX: [RegExp, string][] = [
  [/>\s*H-\{/, 'hafıza kimliği hapı (H-{id})'],
  [/\{\s*\w+\.kaynak\s*(\|\||\})/, 'kaydın ham kaynağı ({h.kaynak})'],
  [/\{\s*ice\??\.klasor\s*\}/, 'öğretme klasörünün tam yolu ({ice.klasor})'],
  [/\(\$\{[^}]*(azamiAdim|AZAMI_ADIM|adim)\}\)/, 'parantez içinde iç sınır sayısı'],
  [/\$\{\s*\w+\.kaynak\s*\}/, 'kaydın ham kaynağı (G-12…G-30 gibi satır kimlikleri)'],
  [/,\s*\w+\.kaynak\s*\]\.filter/, 'kaydın ham kaynağı listede'],
];

// ── İş izi işi (11 Kas): sohbetin kendisi ve Claude Code ──
test('sohbet atıfları: "H-7" hapı yok; küçük nokta, üstüne gelince kaynağın türü ve tarihi', () => {
  const h = atiflariNoktala('<p>Ön görüşmede iki metrik [H-7 · 2026-10-18] ve not [N-12] ile karar [D-3 · gizli-iç-not].</p>');
  assert.doesNotMatch(h.replace(/<[^>]+>/g, ''), /[HMDNGR]-\d+/, 'görünen metinde kimlik');
  assert.doesNotMatch(h, /[HMDNGR]-\d+/, 'öznitelikte de kimlik yok');
  assert.match(h, /title="Hafızadan · 2026-10-18"/);
  assert.match(h, /aria-label="Gün kaydından"/);
  assert.doesNotMatch(h, /gizli-iç-not/, 'tarih olmayan ek bilgi yazılmaz');
  assert.equal((h.match(/class="atif"/g) ?? []).length, 3);
});

test('sohbet geçmişinde iç sınır sayısı yok: "Adım sınırı (100)" ve görev sohbetinde "adım sınırına (30)" insan diline çevrilir', () => {
  const eski = "Adım sınırına geldim (100). Son yaptıklarım: Menü okundu, CSV yazıldı. Kaldığım yerden sürdürmek için Devam et'e bas.";
  const y = sinirSayisiniGizle(eski);
  assert.ok(!icKimlikVarMi(y), y);
  assert.match(y, /^Uzun bir işti, burada durdum\. Son yaptıklarım: Menü okundu/);
  const g = sinirSayisiniGizle('Bu adım yarım kaldı: adım sınırına (30) geldi; değişiklik bir sonraki adımda yeniden ele alınır.');
  assert.ok(!icKimlikVarMi(g), g);
  assert.doesNotMatch(g, /\(\d+\)/);
  assert.equal(sinirSayisiniGizle('Sıradan bir yanıt (2 öneri).'), 'Sıradan bir yanıt (2 öneri).');
  // Yeni kayıtlar baştan bu dilde yazılır (kaynakta sayı yok).
  const zincir = fs.readFileSync(path.join(kok, 'src/main/ajan/zincir.ts'), 'utf8');
  assert.doesNotMatch(zincir, /return `Adım sınırına geldim \(\$\{adim\}\)/);
  const adim = fs.readFileSync(path.join(kok, 'src/main/isler/adim.ts'), 'utf8');
  assert.doesNotMatch(adim, /ADIM_YARIM_KALDI = `[^`]*\(\$\{GOREV_AZAMI_ADIM\}\)/);
  // Görünüm (main/sohbet.ts gorunume) Fuber'in ve notun metnini bu yardımcıdan geçirir.
  assert.match(fs.readFileSync(path.join(kok, 'src/main/sohbet.ts'), 'utf8'), /sinirSayisiniGizle\(b\.metin\)/);
  assert.match(fs.readFileSync(path.join(kok, 'src/main/sohbet.ts'), 'utf8'), /sinirSayisiniGizle\(String\(m\.metin\)\)/, 'sohbet listesinin önizlemesi de');
});

test('Claude Code: "general-purpose" çipi yok, alt ajan türü insan diliyle; sohbet ve Claude Code ham kimlik basmaz', () => {
  assert.equal(ccAjanTipiAdi('general-purpose'), '');
  assert.equal(ccAjanTipiAdi('Explore'), 'Keşif');
  const kartlar = fs.readFileSync(path.join(kok, 'src/renderer/claudecode/Kartlar.tsx'), 'utf8');
  assert.doesNotMatch(kartlar, /\{\s*o\.ajanTipi\s*\}/, 'ham ajan türü');
  const ortak = fs.readFileSync(path.join(kok, 'src/renderer/bilesenler/Ortak.tsx'), 'utf8');
  assert.doesNotMatch(ortak, />\$\{id\}</, 'atıf hapı kimliği basıyor');
  for (const y of ['src/renderer/bilesenler/Sohbet.tsx', 'src/renderer/is-izi/IsSeridi.tsx', 'src/renderer/is-izi/SuAn.tsx']) {
    const s = fs.readFileSync(path.join(kok, y), 'utf8');
    for (const [re, ad] of YASAK_JSX) assert.doesNotMatch(s, re, `${y}: ${ad}`);
    assert.doesNotMatch(s, />\s*\{\s*\w+\.id\s*\}\s*</, `${y}: iş kimliği ham basılıyor`);
  }
});

test('sohbet dışındaki arayüz kaynakları iç kimliği ham basmaz', () => {
  const l = dosyalar(path.join(kok, 'src/renderer')).filter((y) => !KAPSAM_DISI.test(goreli(y)));
  assert.ok(l.length > 80, `taranan ${l.length}`);
  const bulunan: string[] = [];
  for (const y of l) {
    const s = fs.readFileSync(y, 'utf8');
    for (const [re, ad] of YASAK_JSX) if (re.test(s)) bulunan.push(`${goreli(y)}: ${ad}`);
  }
  assert.deepEqual(bulunan, []);
});
