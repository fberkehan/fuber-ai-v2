// Sade mod (0.14 T6b; karakterlerin hiç olmadığı görünüm). Ayar gorunum.karakterler ('goster' varsayılan |
// 'sade'): varsayılan, açılışta bozuk değerin düzelmesi, kayıt süzgeci (bilinmeyen düşer), telefon köprüsü, saf yardımcı (shared/karakter-gorunum.ts),
// Ayarlar → Görünüm'deki satır (iki modda da, İş dili temiz) ve KAYNAK TARAMASI: göz çizen (<Gozler, <ModGecisi) her arayüz dosyası
// useKarakterGorunur kancasına bakar — sonraki ekranlar Sade'yi unutamaz. main/ayarlar.ts Electron'a bağlı: 'electron' ve yollar.ts sahtelenir
// (tests/ayar-kaydi.test.ts ile aynı yol).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KARAKTER_GORUNUMLERI, KARAKTER_GORUNUMU_VARSAYILAN, SADE_AD, gorunenKarakterAdi, karakterGorunumuGecerli, karakterGorunurMu, sadeHal,
} from '../src/shared/karakter-gorunum.ts';
import { ayarKaydiniSuz } from '../src/main/ayar-kaydi.ts';
import { dizinKur, ayarAra } from '../src/shared/ayar-arama.ts';
import { KATEGORILER } from '../src/renderer/ayarlar/dizin.ts';
import { IS_YASAK } from '../src/shared/is-dili.ts';

const kok = path.resolve(import.meta.dirname, '..');
const klasor = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-karakter-gorunum-'));
(globalThis as Record<string, unknown>).__ayarTestKlasoru = klasor;
const veri = (kod: string) => `data:text/javascript,${encodeURIComponent(kod)}`;
const kanca = registerHooks({
  resolve(belirtec, baglam, sonraki) {
    if (belirtec === 'electron') return { url: veri('export const safeStorage = { isEncryptionAvailable: () => false };'), shortCircuit: true };
    if (belirtec === './yollar.js' && baglam.parentURL?.endsWith('/src/main/ayarlar.ts')) {
      return {
        url: veri(`const k = globalThis.__ayarTestKlasoru; const y = (a) => k + '/' + a;
          export const yollar = { ayarlar: () => y('ayarlar.json'), sirlar: () => y('sirlar.json'), varsayilanIceAktar: () => y('ice-aktar'), veri: () => k };`),
        shortCircuit: true,
      };
    }
    if (belirtec.startsWith('.') && belirtec.endsWith('.js') && baglam.parentURL?.startsWith('file:')) {
      const ts = new URL(belirtec.replace(/\.js$/, '.ts'), baglam.parentURL);
      if (fs.existsSync(fileURLToPath(ts))) return sonraki(ts.href, baglam);
    }
    return sonraki(belirtec, baglam);
  },
});
after(() => {
  kanca.deregister();
  delete (globalThis as Record<string, unknown>).__ayarTestKlasoru;
  fs.rmSync(klasor, { recursive: true, force: true });
});

// ── Saf yardımcı ──
test('karakterGorunurMu: yalnız açık "sade" kapatır; alan yoksa, bozuksa ya da ayar yoksa Göster', () => {
  assert.deepEqual(KARAKTER_GORUNUMLERI, ['goster', 'sade']);
  assert.equal(KARAKTER_GORUNUMU_VARSAYILAN, 'goster');
  assert.equal(karakterGorunurMu({ gorunum: { karakterler: 'sade' } }), false);
  assert.equal(karakterGorunurMu({ gorunum: { karakterler: 'goster' } }), true);
  assert.equal(karakterGorunurMu({ gorunum: {} }), true);
  assert.equal(karakterGorunurMu({ gorunum: { karakterler: 'SADE' } }), true, 'bozuk değer varsayılana düşer');
  assert.equal(karakterGorunurMu(null), true);
  assert.equal(karakterGorunurMu(undefined), true);
  for (const v of ['goster', 'sade']) assert.equal(karakterGorunumuGecerli(v), true);
  for (const v of ['', 'gizli', null, undefined, 1, true, {}]) assert.equal(karakterGorunumuGecerli(v), false);
});

test('gorunenKarakterAdi: 11 Kas\'tan beri iki görünümde de "Fuber" (kayıtlı eski hayvan adı da); boş ad boş kalır', () => {
  assert.equal(SADE_AD, 'Fuber');
  assert.equal(gorunenKarakterAdi(true, 'Tilki'), 'Fuber');
  assert.equal(gorunenKarakterAdi(false, 'Tilki'), 'Fuber');
  assert.equal(gorunenKarakterAdi(false, 'Bukalemun'), 'Fuber');
  assert.equal(gorunenKarakterAdi(false, ''), '');
  assert.equal(gorunenKarakterAdi(true, undefined), '');
});

test('sadeHal: karakterin hâli işaretin hâline eşlenir (çalışıyor = düşünüyor; hâl ifadeden üstün)', () => {
  assert.equal(sadeHal(), 'sakin');
  assert.equal(sadeHal('calisiyor'), 'dusunuyor');
  for (const h of ['dinliyor', 'dusunuyor', 'konusuyor', 'onay', 'hata', 'sevinc', 'sakin'] as const) assert.equal(sadeHal(h), h);
  assert.equal(sadeHal(undefined, 'uyuyor'), 'uyuyor');
  assert.equal(sadeHal('hata', 'sevinc'), 'hata');
});

// ── Ana süreç: varsayılan, açılış düzeltmesi, kayıt süzgeci ──
test('varsayılan "goster"; eski profile derin birleştirmeyle gelir, bozuk kayıt açılışta düzelir; kayıt "sade" yazar', async () => {
  fs.writeFileSync(path.join(klasor, 'ayarlar.json'), JSON.stringify({ kurulumTamam: true, gorunum: { tema: 'koyu', adaSessiz: true, ada: 'goster', karakterler: 'tavsan' } }));
  const { ayarlar, ayarlariKaydet } = await import('../src/main/ayarlar.ts');
  assert.equal(ayarlar().gorunum.karakterler, 'goster', 'bozuk değer → varsayılan');
  assert.equal(ayarlar().gorunum.tema, 'koyu', 'öteki görünüm alanları kalır');
  const a = ayarlariKaydet(ayarKaydiniSuz({ gorunum: { ...ayarlar().gorunum, karakterler: 'sade' } }) as never);
  assert.equal(a.gorunum.karakterler, 'sade');
  assert.equal(JSON.parse(fs.readFileSync(path.join(klasor, 'ayarlar.json'), 'utf8')).gorunum.karakterler, 'sade', 'diskte');
  // Bilinmeyen değerli kayıt alanı düşürür: kayıtlı 'sade' kalır.
  const b = ayarlariKaydet(ayarKaydiniSuz({ gorunum: { ...ayarlar().gorunum, karakterler: 'tavsan' as never } }) as never);
  assert.equal(b.gorunum.karakterler, 'sade');
  assert.equal(b.gorunum.tema, 'koyu');
});

test('ayarKaydiniSuz: gorunum.karakterler yalnız goster | sade; bilinmeyen düşer, öteki görünüm alanları kalır; girdi değişmez', () => {
  for (const v of ['goster', 'sade'] as const) {
    assert.deepEqual(ayarKaydiniSuz({ gorunum: { tema: 'acik', karakterler: v } } as never).gorunum, { tema: 'acik', karakterler: v });
  }
  const girdi = { gorunum: { tema: 'acik', karakterler: 'hayvanlar' }, kullaniciAdi: 'Deniz' } as never;
  const kopya = structuredClone(girdi);
  const c = ayarKaydiniSuz(girdi) as Record<string, unknown>;
  assert.deepEqual(c.gorunum, { tema: 'acik' });
  assert.equal(c.kullaniciAdi, 'Deniz');
  assert.deepEqual(girdi, kopya);
  assert.deepEqual(ayarKaydiniSuz({ gorunum: { tema: 'acik', karakterler: null } } as never).gorunum, { tema: 'acik' });
});

// ── Ayarlar → Görünüm ──
test('Ayarlar → Görünüm → Gözler: iki modda da görünür ve aranır, metin İş diline uyar, içerik bileşeni bağlı', () => {
  const gorunum = KATEGORILER.find((k) => k.id === 'gorunum')!;
  const grup = gorunum.gruplar.find((g) => g.id === 'karakterler');
  assert.ok(grup, 'Görünüm kategorisinde "karakterler" grubu');
  assert.equal(grup!.gelistirici, undefined, 'grup yalnız Geliştirici değil');
  const ayar = grup!.ayarlar.find((a) => a.id === 'karakterler');
  assert.ok(ayar && !ayar.gelistirici, 'ayar iki modda da');
  for (const mod of ['is', 'gelistirici'] as const) {
    const dizin = dizinKur(KATEGORILER, mod);
    assert.ok(dizin.some((x) => x.id === 'karakterler'), `${mod}: dizinde`);
    for (const soz of ['göz', 'gözler', 'karakter', 'sade']) assert.ok(ayarAra(dizin, soz).some((s) => s.kayit.id === 'karakterler'), `${mod}: "${soz}" araması bulur`);
  }
  for (const metin of [ayar!.ad, ayar!.aciklama, grup!.baslik, grup!.aciklama ?? '']) assert.doesNotMatch(metin, IS_YASAK, metin);
  // Ayar metni ve arama sözcükleri hayvan adı taşımaz (11 Kas: gözler).
  for (const metin of [ayar!.ad, ayar!.aciklama, grup!.baslik, grup!.aciklama ?? '']) assert.doesNotMatch(metin, /tilki|bukalemun/i, metin);
  assert.equal(grup!.ozet?.({ gorunum: { karakterler: 'sade' } } as never), 'Sade');
  assert.equal(grup!.ozet?.({ gorunum: {} } as never), 'Göster');
  const kaynak = fs.readFileSync(path.join(kok, 'src/renderer/ayarlar/Gorunum.tsx'), 'utf8');
  assert.match(kaynak, /karakterler: KarakterGrubu/, 'GORUNUM haritasında');
  assert.match(kaynak, /'Göster'/);
  assert.match(kaynak, /'Sade \(göz yok\)'/);
  assert.equal(ayar!.ad, 'Gözler');
  assert.ok(!(ayar!.anahtar ?? []).some((x) => /tilki|bukalemun/i.test(x)), 'arama sözcüklerinde hayvan yok');
});

// ── Kaynak taraması ──
function dosyalar(kok2: string): string[] {
  if (!fs.existsSync(kok2)) return [];
  return fs.readdirSync(kok2, { withFileTypes: true }).flatMap((e) => {
    const tam = path.join(kok2, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : dosyalar(tam);
    return /\.tsx?$/.test(e.name) ? [tam] : [];
  });
}
const CIZEN = /<(?:Gozler|ModGecisi)[\s/>]/;

test('kaynak taraması: <Gozler ya da <ModGecisi çizen her arayüz dosyası useKarakterGorunur() kancasına bakar', () => {
  const tum = [...dosyalar(path.join(kok, 'src/renderer')), ...dosyalar(path.join(kok, 'yonetim/renderer'))];
  const cizenler = tum.filter((d) => CIZEN.test(fs.readFileSync(d, 'utf8')));
  assert.ok(cizenler.length >= 3, `çizen dosyalar bulundu: ${cizenler.map((d) => path.relative(kok, d)).join(', ')}`);
  const eksik = cizenler.filter((d) => !/useKarakterGorunur\(\)/.test(fs.readFileSync(d, 'utf8'))).map((d) => path.relative(kok, d));
  assert.deepEqual(eksik, [], `Sade modu unutan dosyalar (renderer/karakter-gorunum.ts useKarakterGorunur ya da ui/goz GorunenGoz kullanın): ${eksik.join(', ')}`);
});

test('kaynak: ModGecisi ve GorunenGoz Sade\'de göz çizmez (SadeIsaret: F işareti, değişmedi), kanca paylaşılan tek abonelik', () => {
  const mg = fs.readFileSync(path.join(kok, 'src/renderer/ui/goz/ModGecisi.tsx'), 'utf8');
  assert.match(mg, /gorunur \? <GozluModGecisi \{\.\.\.o\} \/> : <SadeModGecisi \{\.\.\.o\} \/>/);
  const sadeGecis = mg.slice(mg.indexOf('function SadeModGecisi'));
  assert.doesNotMatch(sadeGecis, /<Gozler[\s/>]/, 'Sade geçişinde göz yok');
  assert.match(sadeGecis, /<SadeIsaret/);
  const gk = fs.readFileSync(path.join(kok, 'src/renderer/ui/goz/GorunenGoz.tsx'), 'utf8');
  assert.match(gk, /if \(gorunur\) return <Gozler/);
  assert.match(gk, /return <SadeIsaret/);
  const si = fs.readFileSync(path.join(kok, 'src/renderer/ui/goz/SadeIsaret.tsx'), 'utf8');
  assert.doesNotMatch(si, /from '\.\/(Gozler|beyin|geometri)'/, 'işaret çizimi göz çiziminden bağımsız');
  assert.match(si, /MINI_YOLLAR/, 'Sade: Fuber\'in F işareti');
  const css = fs.readFileSync(path.join(kok, 'src/renderer/ui/goz/sade.css'), 'utf8');
  assert.match(css, /prefers-reduced-motion: reduce/, 'az hareket tercihi');
  assert.match(css, /prefers-reduced-motion: no-preference/, 'döngüler yalnız hareket serbestken');
  const hook = fs.readFileSync(path.join(kok, 'src/renderer/karakter-gorunum.ts'), 'utf8');
  assert.match(hook, /useSyncExternalStore/);
  assert.match(hook, /const anlik = \(\): boolean => son === true;/, 'ayar gelene dek false: Sade seçen açılışta karakter görmez');
});

test('kaynak: hayvan adı gösteren yüzeyler Sade\'de "Fuber" ya da hiç (çentik, sohbet, kurulum, Ayarlar sesi)', () => {
  const oku = (p: string) => fs.readFileSync(path.join(kok, p), 'utf8');
  assert.match(oku('src/renderer/ada/useAsistan.ts'), /karakterAdi: gorunenKarakterAdi\(/);
  assert.match(oku('src/renderer/ada/useAsistan.ts'), /karakter: gorunenKarakterAdi\(/);
  assert.match(oku('src/renderer/bilesenler/Sohbet.tsx'), /const karakter = useGorunenKarakterAdi\(kayitliAd\);/);
  assert.match(oku('src/renderer/kurulum2/adimlar/Kip.tsx'), /useKarakterGorunur\(\)/);
  assert.match(oku('src/renderer/kurulum2/adimlar/Ses.tsx'), /useGorunenKarakterAdi\(/);
  assert.match(oku('src/renderer/kurulum2/adimlar/Hazirsin.tsx'), /karakter: gorunur \? karakter\.ad : undefined/);
  assert.match(oku('src/renderer/ayarlar/SesSecimi.tsx'), /gorunenKarakterAdi\(karakterGorunurMu\(a\)/);
});
