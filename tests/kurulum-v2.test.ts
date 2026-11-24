// 0.12 H3a — kurulum v2, Tekrar hoş geldin, yükseltme kuralı ve cam temasının kalkışı (brief Step 1; spec §1–§2, "Tasarım dili").
// 0.11.0'dan sonra: kurulum sihirbazı yarı şeffaf, bozuk bir ekran olarak açılıyordu; önceki veriler silinmedikçe
// yükseltmede gereksiz bir ekran çıkıyordu; daha önce kurulu bilgisayarlar için özel bir giriş ekranı gerekiyordu.
//  · kurulumYolu: yeniden kurulum → "Tekrar hoş geldin"; kurulum bitmemiş → yeni; hesap yok → yalnız hesap; değilse hiçbiri. Sürüm
//    numarası kararı ETKİLEMEZ (0.10 = sürüm 4, 0.11 = sürüm 5 profilleri aynı yolu izler).
//  · Buzlu cam: kayıtlı 'cam' → 'koyu' (dosyada da); arayüzden gelen 'cam' koyu yazılır; ana pencere ve Fuber Tarayıcı hiçbir zaman
//    acrylic / vibrancy / transparent almaz (kaynak taraması).
//  · Kurulum v2: adım sırası, her adımın geçerlilik kuralı, canlı önizlemelerin saf hesapları, fintech kütüphanesinin IPC'siz kalması.
//  · 0.13 T5 (spec B): iki kip kartı, şirket adı, Görünüm adımı, seçimsiz Ses adımı, Claude Code notları, İzinler'in gerçek yazısı.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acilisEkrani, acilisYoklamasi, kurulumYolu, veriVarMi, KURULUM_SURUMU, isProfiliSuz, isProfiliYamasi, type KurulumYoluGirdisi } from '../src/shared/kurulum-adimlari.ts';
import {
  ADIM_GECERLILIGI, GUN_KALIPLARI, HITAPLAR, KURULUM2_SIRASI, gunKalibi, gunSeridi, kurulum2Sirasi, ozetSatirlari,
  selamCumlesi, selamSozu, sureMetni, taslakBaslangici, type KurulumTaslagi,
} from '../src/shared/kurulum-taslak.ts';
import * as kurallar from '../src/shared/kurulum-taslak.ts';
import { VARSAYILAN_KARAKTERLER } from '../src/shared/karakterler.ts';
import { temaGocu, PENCERE_ZEMIN, sunulanTemalar } from '../src/shared/tema-cozum.ts';
import { ayarKaydiniSuz } from '../src/main/ayar-kaydi.ts';
import { sesSec, YEDEK_SES } from '../src/shared/ses-kimligi.ts';
import { YAY, YAY_SEK, yayEgrisi, yayKonumu } from '../src/renderer/ui/fintech/yay.ts';
import { isDiliIhlali } from '../src/shared/is-dili.ts';
import { TEKRAR_BOS, tekrarSatirlari } from '../src/shared/veri-islemi.ts';
import { KIP_KARTI_KARAKTERI, KIP_ONIZLEME_KARAKTERI, kipGecisi, uzerineGelinceTetik } from '../src/renderer/kurulum2/kip-karakter.ts';
import { vurguRengi, vurguStili } from '../src/renderer/ui/vurgu.ts';
import { KIP_VURGUSU } from '../src/renderer/ui/goz/vurgu.ts';

const kok = path.resolve(import.meta.dirname, '..');
const oku = (y: string) => fs.readFileSync(path.join(kok, y), 'utf8');
const dosyalar = (dizin: string, uzanti = /\.(ts|tsx|css)$/): string[] => fs.readdirSync(path.join(kok, dizin), { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile() && uzanti.test(d.name)).map((d) => path.relative(kok, path.join(d.parentPath ?? (d as unknown as { path: string }).path, d.name)));

// ── kurulumYolu ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Fikstür profilleri: ayarlar.json'daki alanlar (kurulumSurumu karara girmez; yalnız gerçek profilleri betimlemek için yazılı).
const PROFIL = {
  '0.12 taze': { kurulumTamam: false, kurulumSurumu: 0, hesap: false },
  '0.10 (sürüm 4) hesaplı': { kurulumTamam: true, kurulumSurumu: 4, hesap: true },
  '0.10 (sürüm 4) hesapsız': { kurulumTamam: true, kurulumSurumu: 4, hesap: false },
  '0.11 (sürüm 5) hesaplı': { kurulumTamam: true, kurulumSurumu: 5, hesap: true },
  '0.11 (sürüm 5) hesapsız': { kurulumTamam: true, kurulumSurumu: 5, hesap: false },
  '0.8 (sürüm 1) hesaplı': { kurulumTamam: true, kurulumSurumu: 1, hesap: true },
} as const;
const girdi = (p: { kurulumTamam: boolean; hesap: boolean }, isaret = false): KurulumYoluGirdisi => ({
  kurulumTamam: p.kurulumTamam, hesapVar: p.hesap, yenidenKurulum: isaret, veriVar: veriVarMi({ kurulumTamam: p.kurulumTamam, hesapVar: p.hesap }),
});

test('kurulumYolu: yeniden kurulum işareti (G2 .yeniden-kurulum) her profilde "Tekrar hoş geldin" — kurulum bitmemişse de, veri varsa', () => {
  for (const [ad, p] of Object.entries(PROFIL)) {
    if (!p.kurulumTamam && !p.hesap) continue;
    assert.equal(kurulumYolu(girdi(p, true)), 'tekrar-hos-geldin', ad);
  }
  // Kurulumu bitmemiş ama sohbeti olan profil (yarıda kaldırılıp yeniden kurulmuş): karşılanacak veri var.
  assert.equal(kurulumYolu({ kurulumTamam: false, hesapVar: false, yenidenKurulum: true, veriVar: veriVarMi({ kurulumTamam: false, hesapVar: false }, { sohbet: 3, hafiza: 0 }) }), 'tekrar-hos-geldin');
  // İşaret var ama veri klasöründe karşılanacak hiçbir şey yok: kural 2'den (yeni kurulum).
  assert.equal(kurulumYolu({ kurulumTamam: false, hesapVar: false, yenidenKurulum: true, veriVar: false }), 'yeni');
  // İşaret yoksa (güncelleme işaret yazmaz) asla "Tekrar hoş geldin" değil.
  for (const p of Object.values(PROFIL)) assert.notEqual(kurulumYolu(girdi(p, false)), 'tekrar-hos-geldin');
});

test('kurulumYolu sürüm numarasını almaz: tüm kurulum sürümlerinde (0–9) aynı sonuç; KURULUM_SURUMU 5 kalır', () => {
  assert.equal(KURULUM_SURUMU, 5);
  assert.equal(kurulumYolu.length, 1);
  const anahtarlar: (keyof KurulumYoluGirdisi)[] = ['veriVar', 'yenidenKurulum', 'kurulumTamam', 'hesapVar'];
  for (const tamam of [true, false]) for (const hesap of [true, false]) {
    const sonuclar = new Set(Array.from({ length: 10 }, (_, s) => kurulumYolu({ ...girdi({ kurulumTamam: tamam, hesap }), kurulumSurumu: s } as KurulumYoluGirdisi)));
    assert.equal(sonuclar.size, 1, `tamam=${tamam} hesap=${hesap}`);
  }
  assert.deepEqual(Object.keys(girdi(PROFIL['0.12 taze'])).sort(), [...anahtarlar].sort());
});

test('"Fuber yenilendi" özeti ve sürüme bağlı açılış kararı kaynakta yok; main.tsx kararı kurulumYolu ile verir', () => {
  for (const d of [...dosyalar('src/renderer'), ...dosyalar('src/shared')]) {
    assert.doesNotMatch(oku(d), /Fuber yenilendi|Böyle devam et|acilisKipi|tekrarDevamSirasi|ozetGosterilsinMi/, d);
  }
  const m = oku('src/renderer/main.tsx');
  assert.match(m, /kurulumYolu\(/);
  assert.doesNotMatch(m, /KURULUM_SURUMU|kurulumSurumu/);
  assert.match(m, /<Kurulum2\b/);
  assert.match(m, /<TekrarHosGeldin\b/);
});

// ── Şeffaf tema (0.13 T13) ──────────────────────────────────────────────────────────────────────────────────────────────────────────
test('cam geçerli bir tema: göç ve arayüzün kaydı camı korur, bilinmeyen değeri koyu yapar (ayarKaydiniSuz)', () => {
  assert.equal(temaGocu('cam'), 'cam');
  assert.equal(temaGocu('mor'), 'koyu');
  assert.equal(ayarKaydiniSuz({ gorunum: { tema: 'cam' } } as never).gorunum?.tema, 'cam', 'telefon başka bir ayar kaydederken camı ezmez');
  assert.equal(ayarKaydiniSuz({ gorunum: { tema: 'mor' } } as never).gorunum?.tema, 'koyu');
  assert.equal(ayarKaydiniSuz({ gorunum: { tema: 'acik' } } as never).gorunum?.tema, 'acik');
  assert.equal(ayarKaydiniSuz({ gorunum: { tema: 'sistem', adaSessiz: true } } as never).gorunum?.adaSessiz, true);
  assert.equal(PENCERE_ZEMIN.cam, '#00000000');
  for (const t of ['koyu', 'acik'] as const) assert.match(PENCERE_ZEMIN[t], /^#[0-9a-f]{6}$/i, 'koyu ve açık pencere zemini opak');
});

test('kaynak taraması: sistem malzemesi yalnız main/tema.ts\'te ve kurulum bayrağına bağlı; öteki pencereler açıkça "none"; ana pencere ve Fuber Tarayıcı saydam değil', () => {
  for (const d of dosyalar('src/main', /\.ts$/)) {
    const s = oku(d);
    if (d.replace(/\\/g, '/').endsWith('src/main/tema.ts')) {
      assert.match(s, /setBackgroundMaterial\(/);
      assert.match(s, /pencereMalzemesi\(/, 'malzemeyi saf kural seçer (kurulum görünürken none)');
    } else {
      assert.doesNotMatch(s, /setBackgroundMaterial\s*\(|setVibrancy\s*\(|['"](acrylic|mica|tabbed|under-window)['"]/, d);
    }
    // Kurucu seçeneği yalnız 'none' olabilir (Windows 11 gizli başlıklı pencereye kendiliğinden Mica verir; cam sonradan tema.ts ile gelir).
    for (const m of s.matchAll(/backgroundMaterial\s*:\s*([^,}\n]+)/g)) assert.equal(m[1].trim(), "'none'", d);
  }
  assert.match(oku('src/main/pencere-kabugu.ts'), /backgroundMaterial:\s*'none'/);
  const ana = oku('src/main/main.ts');
  const i = ana.indexOf('function anaOlustur');
  assert.ok(i > 0);
  const govde = ana.slice(i, ana.indexOf('\n}\n', i));
  assert.match(govde, /new BrowserWindow\(/);
  assert.doesNotMatch(govde, /transparent\s*:\s*true/);
  assert.match(govde, /backgroundColor:\s*pencereZemini\(\)/);
  const t = oku('src/main/tarayici.ts');
  const j = t.indexOf('function pencereKur');
  assert.doesNotMatch(t.slice(j, t.indexOf('\n}\n', j)), /transparent\s*:\s*true/);
  // Arayüzde seçenek "Şeffaf" adını taşır; eski "Buzlu cam" adı yok.
  for (const d of dosyalar('src/renderer', /\.(css|tsx)$/)) assert.doesNotMatch(oku(d), /'Buzlu cam'/, d);
  assert.match(oku('src/renderer/ayarlar/Gorunum.tsx'), /'Şeffaf'/);
});

test('kurulum, Tekrar hoş geldin ve açılış cam belirteçlerine bağlı değil: kendi opak belirteçlerini taşır', () => {
  const css = oku('src/renderer/tasarim.css');
  // Cam belirteçleri tek bloktur; eski sihirbaz (.kurulum) ve açılış örtüsü (.acilis) cam temada da koyu OPAK belirteçleri yeniden kurar.
  assert.match(css, /:root\[data-tema='cam'\]\s*\{/);
  assert.match(css, /:root\[data-tema='cam'\] :is\([^)]*\.kurulum[^)]*\.acilis[^)]*\)/);
  assert.match(oku('src/renderer/acilis/acilis.css'), /\.acilis \{[^}]*inset: 0;[^}]*background: var\(--pano-zemin\)/);
  for (const d of ['src/renderer/kurulum2/kurulum2.css', 'src/renderer/ui/fintech/fintech.css']) {
    const k = oku(d).replace(/\/\*[\s\S]*?\*\//g, '');
    // fintech.css camı yalnız panonun İÇİNDEKİ yazı için ayarlar (.pano); kurulumun kendisi (.k2) hiçbir cam kuralından etkilenmez.
    for (const m of k.matchAll(/[^{}]*data-tema='cam'[^{}]*\{/g)) assert.match(m[0], /\.pano\b/, d + ': cam kuralı yalnız .pano içinde');
  }
  // Pencere kabuğu: kurulum ya da Tekrar hoş geldin açıkken ana süreç sistem malzemesini kaldırır ('tema:sahne').
  for (const d of ['src/renderer/kurulum2/Kurulum2.tsx', 'src/renderer/sayfalar/TekrarHosGeldin.tsx']) assert.match(oku(d), /opakSahne\(/, d);
  assert.match(oku('src/main/ipc.ts'), /h\('tema:sahne'/);
});

// Ayar dosyasındaki 'cam' açılışta 'koyu'ya göçer ve DİSKE yazılır (bir sonraki açılış ve telefon da koyu görür). main/ayarlar.ts
// Electron'a bağlı: 'electron' ve yollar.ts sahtelenir (tests/ayar-kaydi.test.ts ile aynı yol).
const klasor = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-kurulum-v2-'));
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

test('Şeffaf profil: ayarlar() camı korur ve dosyaya dokunmaz; bozuk tema değeri koyuya göçer; yeni kurulumun varsayılanı Otomatik', async () => {
  const dosya = path.join(klasor, 'ayarlar.json');
  fs.writeFileSync(dosya, JSON.stringify({ kurulumTamam: true, kurulumSurumu: 5, motorCalisti: false, kullaniciAdi: 'Deniz', mod: 'is', ses: { surum: 2 }, gorunum: { tema: 'cam', adaSessiz: true, ada: 'goster' } }));
  const m = await import('../src/main/ayarlar.ts');
  assert.equal(m.ayarlar().gorunum.tema, 'cam');
  assert.equal(JSON.parse(fs.readFileSync(dosya, 'utf8')).gorunum.tema, 'cam', 'cam diskte de cam');
  m.ayarlariKaydet(ayarKaydiniSuz({ gorunum: { ...m.ayarlar().gorunum, tema: 'mor' as never } }));
  assert.equal(m.ayarlar().gorunum.tema, 'koyu', 'bozuk değer koyu olur');
  const kaynak = oku('src/main/ayarlar.ts');
  assert.match(kaynak, /gorunum: \{ tema: 'sistem'/, 'yeni kurulumun varsayılanı Otomatik (sistem)');
});

const taze = (): KurulumTaslagi => taslakBaslangici({}, 'ilk');
test('geçerlilik: hesap bağlanmadan (ya da sunucuya ulaşılamayıp hesapsız seçilmeden) Devam yok; saatler geçerli olmalı; ad zorunlu değil', () => {
  const t = taze();
  assert.equal(ADIM_GECERLILIGI.hosgeldin(t), true);
  assert.equal(ADIM_GECERLILIGI.hesap(t), false);
  assert.equal(ADIM_GECERLILIGI.hesap({ ...t, akis: { ...t.akis, hesapBagli: true } }), true);
  assert.equal(ADIM_GECERLILIGI.hesap({ ...t, akis: { ...t.akis, hesapsiz: true } }), true);
  assert.equal(ADIM_GECERLILIGI.tanisma(t), true, 'ad boş geçilebilir');
  assert.equal(ADIM_GECERLILIGI.tanisma({ ...t, ad: 'x'.repeat(61) }), false);
  assert.equal(ADIM_GECERLILIGI.tanisma({ ...t, sirket: 'x'.repeat(81) }), false, 'şirket adı 80 karakterle sınırlı');
  assert.equal(ADIM_GECERLILIGI.gunun(t), true);
  assert.equal(ADIM_GECERLILIGI.gunun({ ...t, gunBit: t.gunBas }), false);
  assert.equal(ADIM_GECERLILIGI.gunun({ ...t, gunBas: '25:00' }), false);
  assert.equal(ADIM_GECERLILIGI.gunun({ ...t, sabah: '' }), true, 'sabah özeti kapalı olabilir');
  assert.equal(ADIM_GECERLILIGI.nerede({ ...t, akis: { ...t.akis, yerelBekliyor: true } }), false);
  for (const id of ['kip', 'gorunum', 'ses', 'baglantilar', 'izinler', 'hazirsin'] as const) assert.equal(ADIM_GECERLILIGI[id](t), true, id);
});

test('taslağın açılışı: yeni kurulumda önerilenler (Business, Otomatik, Klasik 09:00–18:00, özet 08:30, "Hey Fuber" açık); yeniden açılanda kayıtlı ayarlar; Nerede açık seçimsiz (Y1)', () => {
  const t = taze();
  // 0.12 H3c (Y1): Nerede taslakta açık seçim taşımaz (null) — ön seçim gerçek hâlden (shared/nerede.ts neredeOnSecimi; tests/nerede.test.ts).
  assert.deepEqual([t.ad, t.hitap, t.sirket, t.mod, t.tema, t.claudeHafiza, t.gunBas, t.gunBit, t.sabah, t.nerede, t.model, t.heyFuber], ['', '', '', 'is', 'sistem', false, '09:00', '18:00', '08:30', null, null, true]);
  assert.deepEqual(t.izin, { bilgisayar: false, tarayici: true, dosyaOkuma: true, bildirim: true });
  assert.equal(gunKalibi(t.gunBas, t.gunBit), 'klasik');
  const y = taslakBaslangici({ kullaniciAdi: 'Deniz', hitap: 'Bey', mod: 'gelistirici', gorunum: { tema: 'acik' }, isProfili: { rol: 'gelistirici', sirket: 'Mavi Kuş' }, proaktif: { sabahOzeti: '', etkin: false }, yerel: { gizliMod: true }, ses: { uyandirma: false, bilgisayarSesi: true }, hesap: { eposta: 'a@b.c' } }, 'yeniden', { bas: '10:00', bit: '20:00' });
  assert.deepEqual([y.ad, y.hitap, y.sirket, y.mod, y.tema, y.gunBas, y.sabah, y.nerede, y.heyFuber, y.izin.bildirim, y.akis.hesapBagli], ['Deniz', 'Bey', 'Mavi Kuş', 'gelistirici', 'acik', '10:00', '', null, false, false, true]);
  assert.equal(gunKalibi('10:00', '20:00'), 'gec');
  assert.equal(gunKalibi('07:15', '16:00'), null, 'elle saat: segment seçimsiz');
});

test('hitap çipleri ve gün kalıpları sabit', () => {
  assert.deepEqual(HITAPLAR.map(([d]) => d), ['', 'Bey', 'Hanım', 'Hocam']);
  assert.equal(HITAPLAR[0][1], 'Sadece adımla', '0.13.1: hitapsız seçenek "Sadece adımla"');
  assert.equal(GUN_KALIPLARI.length, 3);
});

test('canlı önizleme hesapları: selam, gün şeridi, süre, özet satırları; İş dili', () => {
  assert.equal(selamSozu(8), 'Günaydın');
  assert.equal(selamSozu(13), 'İyi günler');
  assert.equal(selamSozu(20), 'İyi akşamlar');
  assert.equal(selamSozu(2), 'Merhaba', '11 Kas: gece yarısından sonra veda sözü ("İyi geceler") yok');
  assert.equal(selamCumlesi(9, 'Deniz', 'Bey'), 'Günaydın, Deniz Bey.');
  assert.equal(selamCumlesi(9, '', ''), 'Günaydın.');
  const s = gunSeridi('09:00', '19:00', '08:30');
  assert.deepEqual(s.mesai, [{ bas: 37.5, bit: 79.17 }]);
  assert.equal(s.sabah, 35.42);
  assert.equal(s.sure, 600);
  assert.deepEqual(s.sessiz, { sessizBaslangic: '19:00', sessizBitis: '08:30' });
  const gece = gunSeridi('22:00', '06:00', '');
  assert.equal(gece.mesai.length, 2);
  assert.equal(gece.sure, 480);
  assert.equal(gece.sessiz, null, 'gece vardiyası sessiz saate eşlenmez');
  assert.equal(sureMetni(600), '10 sa');
  assert.equal(sureMetni(570), '9 sa 30 dk');
  assert.equal(sureMetni(45), '45 dk');
  // 0.13.1: özet kartı dört satır — Kullanım, Nerede, Bağlantılar, İzinler (ad başlıkta; hesap, mesai, sabah özeti, görünüm, ses kartta yok).
  const o = ozetSatirlari({ ...taze(), ad: 'Deniz', hitap: 'Bey' }, { epostaSayisi: 1, whatsapp: false });
  assert.deepEqual(o.map(([k]) => k), ['Kullanım', 'Nerede', 'Bağlantılar', 'İzinler']);
  const oz = Object.fromEntries(o);
  assert.equal(oz['Kullanım'], 'Business mode');
  assert.equal(oz.Bağlantılar, '1 e-posta');
  assert.equal(oz['İzinler'], '3 / 4 açık');
  assert.equal(isDiliIhlali(o.flat().join(' ')), null);
  assert.ok(!o.flat().some((x) => x.includes('Deniz')), 'ad kartta tekrar etmez (başlıkta)');
  assert.equal(Object.fromEntries(ozetSatirlari(taze(), { epostaSayisi: 0, whatsapp: false })).Bağlantılar, 'Henüz eklenmedi', '"Sonra" ya da "Bağlanmadı" değil: soluk "Henüz eklenmedi"');
  const sirketli = Object.fromEntries(ozetSatirlari({ ...taze(), ad: 'Deniz', sirket: ' Mavi Kuş ', mod: 'gelistirici', tema: 'acik' }, { epostaSayisi: 0, whatsapp: false, karakter: 'Bukalemun' }));
  assert.equal(sirketli['Kullanım'], 'Developer mode · Bukalemun');
});

test('Ses: 0.13 son düzeltme 2 — "Bu bilgisayarın sesi" seçeneği kalktı (0.12 kaydı göçle silinir): hesabın sesi yedek sesin önündedir', () => {
  const hesapSesi = { sesId: null };
  assert.equal(sesSec({ bulutsuz: false, yedekKurulu: true, hesapSesi })?.hesap, true, 'varsayılan: Fuber’in sesi');
  assert.deepEqual(sesSec({ bulutsuz: true, yedekKurulu: true, hesapSesi }), { motor: 'yerel', sesId: YEDEK_SES.id }, 'Gizli ve "Yalnız bu bilgisayar": yerel ses');
});

// ── 0.13 T5 (spec B): "ileri ileri ileri" — kurulumda yalnız iki kip; ad, hitap, şirket; görünüm; seçimsiz ses ─────────────────────────────
// `kurallar.*` kurulumun saf kararları (shared/kurulum-taslak.ts); bileşenlerin onları gerçekten kullandığı kaynaktan okunur, canlı denetim
// scripts/dev/kurulum2-onizle.mjs (gerçek pencere; kurulum:tamamla ve tema gerçekten yazılır).
test("Tanisma'da rol çipi yok, şirket var", () => {
  const s = oku('src/renderer/kurulum2/adimlar/Tanisma.tsx');
  assert.doesNotMatch(s, /KURULUM_ROLLERI|rolOdagi|etiket="Rolün"|t\.rol\b|Ne iş yapıyorsun/);
  assert.match(s, /data-alan="sirket"/);
  assert.match(s, /maxLength=\{80\}/);
  assert.match(s, /degistir\(\{ sirket: e\.target\.value \}\)/);
  assert.equal('rol' in taze(), false, 'rol taslakta yok');
  assert.equal(taslakBaslangici({ isProfili: { sirket: 'Mavi Kuş' } }, 'yeniden').sirket, 'Mavi Kuş', 'yeniden açılan kurulum kayıtlı şirketi gösterir');
  // Kayıtlı rol silinmez: kurulum rol yazmaz, ana sürecin süzgeci öncekini korur.
  assert.doesNotMatch(oku('src/renderer/kurulum2/Kurulum2.tsx'), /taslak\.rol|rolCipi/);
  const g = kurallar.kurulumTamamlaGovdesi({ ...taze(), sirket: '  Mavi Kuş ' });
  assert.deepEqual(g.isProfili, { sirket: 'Mavi Kuş', gunBas: '09:00', gunBit: '18:00' });
  assert.equal(isProfiliSuz(g.isProfili, { rol: 'kurucu' })?.rol, 'kurucu');
  assert.deepEqual(kurallar.kurulumTamamlaGovdesi(taze()).isProfili, { gunBas: '09:00', gunBit: '18:00' }, 'boş şirket yazılmaz');
  const acilis = { sirket: '', gunBas: '09:00', gunBit: '18:00' };
  assert.deepEqual(isProfiliYamasi({ rol: 'satis' }, { ...acilis, sirket: 'Kuzey' }, acilis), { sirket: 'Kuzey' }, 'yeniden: yamada rol yok');
  assert.equal(isProfiliSuz({ sirket: 'Kuzey' }, { rol: 'satis' })?.rol, 'satis');
  assert.equal(isProfiliYamasi({ rol: 'satis' }, acilis, acilis), null, 'dokunulmadı: hiçbir şey yazılmaz');
});

test('Kip adımı iki kart, kullanıcı metni Business mode ve Developer mode', () => {
  assert.deepEqual(kurallar.kipKartlari(undefined).map((k) => [k.mod, k.ad, k.karakter, k.tanim]), [
    ['is', 'Business mode', 'Fuber', VARSAYILAN_KARAKTERLER.business.tanim],
    ['gelistirici', 'Developer mode', 'Fuber', VARSAYILAN_KARAKTERLER.developer.tanim],
  ], 'hesap yoksa ya da sunucu eskiyse gömülü varsayılanlar');
  const sunucu = { business: { ...VARSAYILAN_KARAKTERLER.business, ad: 'Fox', tanim: 'Ortağın.' }, developer: { ...VARSAYILAN_KARAKTERLER.developer, ad: 'Chameleon', tanim: 'Yoldaşın.' } };
  assert.deepEqual(kurallar.kipKartlari(sunucu).map((k) => [k.ad, k.karakter, k.tanim]), [['Business mode', 'Fuber', 'Ortağın.'], ['Developer mode', 'Fuber', 'Yoldaşın.']], 'hesap adımı önce gelir: Yönetim’in tonu kartlara geçer; ad iki modda da Fuber');
  const s = oku('src/renderer/kurulum2/adimlar/Kip.tsx');
  assert.match(s, /kipKartlari\(ayar\.hesap\?\.karakterler\)/);
  assert.match(s, /role="radiogroup"/, '0.14 T32: kendi kip kartları (karakterli), radyo grubu');
  assert.match(s, /onerilen=\{k\.mod === 'is'\}/, 'Business önerilen');
  assert.match(s, /kaydet\(\{ mod \}\)/, 'seçim anında kaydedilir: sonraki adımlar ve "Dinle" kipi görür; Vazgeç geri alır');
  assert.doesNotMatch(s, /['"]İş['"]|['"]Geliştirici['"]|Yönetici/);
  assert.equal(taze().mod, 'is', 'Business seçili gelir');
  assert.equal(oku('src/renderer/kurulum2/adimlar.ts').match(/ad: 'Nasıl kullanacaksın'/)?.length, 1);
});

test('Developer seçilince claudeHafiza görünür', () => {
  assert.equal(kurallar.claudeNotlariGorunur('ilk', 'gelistirici'), true);
  assert.equal(kurallar.claudeNotlariGorunur('ilk', 'is'), false);
  assert.equal(kurallar.claudeNotlariGorunur('yeniden', 'gelistirici'), false, 'yeniden açılan kurulum kurulum:tamamla çağırmaz: yapılmayacak iş için anahtar yok');
  assert.equal(taze().claudeHafiza, false, 'varsayılan kapalı (C-11)');
  assert.equal(kurallar.kurulumTamamlaGovdesi({ ...taze(), mod: 'gelistirici', claudeHafiza: true }).claudeHafiza, true);
  assert.equal(kurallar.kurulumTamamlaGovdesi({ ...taze(), mod: 'is', claudeHafiza: true }).claudeHafiza, false, 'açıp Business’e dönüldüyse okunmaz');
  const k = oku('src/renderer/kurulum2/Kurulum2.tsx');
  assert.doesNotMatch(k, /claudeHafiza: false/, 'eski sabit yok');
  assert.match(k, /cagir\('kurulum:tamamla', kurulumTamamlaGovdesi\(taslak\)\)/);
  const s = oku('src/renderer/kurulum2/adimlar/Kip.tsx');
  assert.match(s, /claudeNotlariGorunur\(kip, t\.mod\)/);
  assert.match(s, /'kurulum:claude-hafiza-sayisi'/);
  assert.match(s, /etiket="Claude Code notlarımı oku"/);
  assert.match(s, /devreDisi=\{!sayi\}/, 'bu bilgisayarda not yoksa anahtar söz vermez');
});

test('Ses adımında ses seçimi yok', () => {
  const s = oku('src/renderer/kurulum2/adimlar/Ses.tsx');
  assert.doesNotMatch(s, /SecimGrubu|degistir\(\{ ses \}\)|bilgisayarSesi: ses|Hangi sesle/);
  assert.match(s, /etkinKarakter\(t\.mod, ayar\.hesap\?\.karakterler\)/, 'karakterin sesi');
  assert.match(s, /fuberSoyle\(dinlemeSozu\(karakter\.ad, siz\), 'onizleme', modKip\(t\.mod\)\)/, '"Dinle" seçilen kipin sesiyle çalar');
  assert.match(s, /data-dinle=""/);
  assert.match(s, /etiket="Sesli konuşma"/);
  assert.match(s, /seslendirme: v/, '"Sesli konuşma" yanıtların sesli okunmasıdır (ses.seslendirme)');
  assert.equal('ses' in taze(), false, 'ses taslakta yok');
  assert.equal(kurallar.dinlemeSozu('Tilki'), 'Merhaba, ben Tilki. Sesimi hep böyle duyacaksın.');
  assert.equal(kurallar.dinlemeSozu('Tilki', true), 'Merhaba, ben Tilki. Sesimi hep böyle duyacaksınız.');
  assert.ok(!ozetSatirlari(taze(), { epostaSayisi: 0, whatsapp: false }).some(([k]) => k === 'Ses'), '0.13.1: özet kartında Ses satırı yok (Hazırsın’ın sol notu yerel sesin hâlini söyler)');
});

test('kurulum penceresi Şeffaf seçilse de opak kalır (0.13 kuralı)', () => {
  assert.deepEqual(kurallar.gorunumSecenekleri(['koyu', 'acik', 'sistem']).map((g) => [g.deger, g.baslik]), [['sistem', 'Otomatik'], ['koyu', 'Koyu'], ['acik', 'Açık']]);
  assert.deepEqual(kurallar.gorunumSecenekleri(['koyu', 'acik', 'sistem', 'cam']).map((g) => g.baslik), ['Otomatik', 'Koyu', 'Açık', 'Şeffaf'], 'cam destekleyen bilgisayarda Şeffaf görünür');
  assert.deepEqual(kurallar.gorunumSecenekleri().map((g) => g.deger), ['sistem', 'koyu', 'acik', 'cam'], 'bugünkü TEMALAR: Şeffaf geri geldi');
  assert.deepEqual(kurallar.gorunumSecenekleri(sunulanTemalar(false)).map((g) => g.deger), ['sistem', 'koyu', 'acik'], 'Windows 10: Şeffaf sunulmaz');
  // Seçim yalnız taslakta: pencere, tema ve ayar kurulum sürerken değişmez.
  const s = oku('src/renderer/kurulum2/adimlar/Gorunum.tsx');
  assert.match(s, /sec=\{\(tema\) => degistir\(\{ tema \}\)\}/);
  assert.doesNotMatch(s, /\bkaydet\b|dataset\.tema|ayarlar:kaydet/);
  // Kabuk opak: tam pencere, zemin sahne rengi; sahne iki temada da düz renk.
  const css = oku('src/renderer/kurulum2/kurulum2.css');
  const k2 = css.slice(css.indexOf('.k2 {'), css.indexOf('}', css.indexOf('.k2 {')));
  assert.match(k2, /position: fixed; inset: 0/);
  assert.match(k2, /background: var\(--ft-sahne\)/);
  for (const m of oku('src/renderer/ui/fintech/fintech.css').matchAll(/--ft-sahne:\s*([^;]+);/g)) assert.match(m[1], /^#[0-9a-f]{3,6}$/i);
  // 0.14 T32: Nusa geçişi bu kuralı bozmaz — iki ekran da açılınca opakSahne() çağırır (tema Şeffaf olsa da sistem malzemesi 'none'), kapanınca
  // geri verir; kurulum CSS'i Şeffaf'ta saydam zemin ya da bulanıklık kurmaz.
  for (const d of ['src/renderer/kurulum2/Kurulum2.tsx', 'src/renderer/sayfalar/TekrarHosGeldin.tsx']) {
    const k = oku(d);
    assert.match(k, /const opakKapat = opakSahne\(\);/, d);
    assert.match(k, /opakKapat\(\);/, d);
  }
  assert.doesNotMatch(css, /data-tema='cam'\][^{]*\.k2[^{]*\{[^}]*(transparent|backdrop-filter)/, 'Şeffaf temada kurulum saydamlaşmaz');
  assert.doesNotMatch(css, /backdrop-filter/, 'buzlu cam yok');
});

test('Hazırsın sonrası tema uygulanır', () => {
  assert.equal(kurallar.kurulumTamamlaGovdesi({ ...taze(), tema: 'acik' }).tema, 'acik');
  const ipc = oku('src/main/ipc.ts');
  const govde = ipc.slice(ipc.indexOf("h('kurulum:tamamla'"), ipc.indexOf("h('kurulum:yukseltme-bitti'"));
  assert.match(govde, /a\.gorunum\.tema = temaGocu\(v\.tema, a\.gorunum\.tema\)/, 'kurulumu bitiren tek yazımda');
  const gorunum = { tema: 'koyu', adaSessiz: false, ada: 'goster' } as const;
  assert.deepEqual(kurallar.temaYamasi(gorunum, 'acik'), { gorunum: { ...gorunum, tema: 'acik' } });
  assert.deepEqual(kurallar.temaYamasi(gorunum, 'koyu'), {}, 'değişmediyse yazılmaz');
  const k = oku('src/renderer/kurulum2/Kurulum2.tsx');
  assert.match(k, /\.\.\.temaYamasi\(ayar\.gorunum, taslak\.tema\)/, 'yeniden kipi "Bitti"de yazar; Vazgeç hiç yazmaz');
  assert.doesNotMatch(k, /id === 'gorunum'/, 'adımdan çıkarken uygulanmaz');
});

test('İzinler\'de "Ekran ve klavye" isteğe bağlı yazar', () => {
  const s = oku('src/renderer/kurulum2/adimlar/Izinler.tsx');
  assert.match(s, /id: 'bilgisayar'[^\n]*rozet: 'İsteğe bağlı'/);
  assert.match(s, /bilgisayar: m\(KM\.izinBilgisayar\(acil\)\)/);
  assert.match(oku('src/shared/kurulum-metin.ts'), /izinBilgisayar: \(acil: string\): Cift => \[`Kapalı gelir\./, '0.13.1: "Varsayılan kapalı" değil "Kapalı gelir"');
  assert.match(oku('src/renderer/kurulum2/Ortak.tsx'), /s\.rozet && <span className="ft-rozet">\{s\.rozet\}<\/span>/);
  assert.equal(taze().izin.bilgisayar, false);
});

// ── Fintech kütüphanesi ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('yay eğrisi: kritik sönümlü yay aşmadan 1’e varır; fintech.css’teki --ft-yay / --ft-yay-sek dizgeleri yay.ts ile aynı', () => {
  assert.equal(yayKonumu(0, 0.42, 1), 0);
  let once = -1;
  for (let i = 0; i <= 40; i++) { const v = yayKonumu((i / 40) * 0.42, 0.42, 1); assert.ok(v >= once && v <= 1, `t=${i}`); once = v; }
  assert.ok(yayKonumu(0.42, 0.42, 1) > 0.98);
  assert.ok(Math.max(...Array.from({ length: 40 }, (_, i) => yayKonumu(i / 60, 0.36, 0.82))) > 1, 'sekmeli yay hafif aşar');
  assert.equal(YAY.sure, 420);
  assert.deepEqual(yayEgrisi(), YAY);
  const css = oku('src/renderer/ui/fintech/fintech.css');
  assert.ok(css.includes(`--ft-yay: ${YAY.egri};`), '--ft-yay');
  assert.ok(css.includes(`--ft-yay-sek: ${YAY_SEK.egri};`), '--ft-yay-sek');
  assert.ok(css.includes(`--ft-sure: ${YAY.sure}ms;`));
  assert.ok(css.includes(`--ft-sure-sek: ${YAY_SEK.sure}ms;`));
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('fintech kütüphanesi masaüstüne bağlı değil (Fuber Yönetim içe aktarır): IPC, window.fuber, ana süreç yok; mavi vurgu ve ALL-CAPS yok', () => {
  for (const d of dosyalar('src/renderer/ui/fintech')) {
    const s = oku(d);
    assert.doesNotMatch(s, /from '\.\.\/\.\.\/api'|window\.fuber|\bcagir\(|\bdinle\(|from '\.\.\/\.\.\/\.\.\/main\//, d);
    assert.doesNotMatch(s, /text-transform:\s*uppercase|--mavi|#0e59ef|#4c85ff|#0a84ff|#007aff/i, d);
  }
});

test('Tekrar hoş geldin: hesap, son kullanım, sohbet ve hafıza sayıları; "Kaldığın yerden devam et" ve "Sıfırdan başla" (yedeğe alınır, silinmez)', () => {
  const t = oku('src/renderer/sayfalar/TekrarHosGeldin.tsx');
  assert.match(t, /'veri:ozet'/);
  assert.match(t, /'veri:devam'/);
  assert.match(t, /'veri:yeni-basla'/);
  assert.match(t, /DEVAM_DUGME/);
  assert.match(t, /SIFIRDAN_DUGME/);
  const v = oku('src/shared/veri-islemi.ts');
  assert.match(v, /SIFIRDAN_DUGME = 'Sıfırdan başla'/);
  assert.match(v, /SIFIRDAN_NOTU = 'Eski veriler yedeğe alınır, silinmez; bu bilgisayar hesabından çıkar\.'/);
});

// ── H3a düzeltme turu 1 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Ö4: Tekrar hoş geldin satırları uygulamanın kendi sayılarını söyler; 0 ise "Boş" (onay yok) — "0 sohbet" ile "Yerinde ✓" bir arada olmaz.
test('Ö4: Tekrar satırları gerçek sayılar; 0 → "Boş"; indirilen yapay zekâ yalnız varsa (boyutuyla)', () => {
  const dolu = tekrarSatirlari({ sohbet: 1234, hafiza: 8, yerelBayt: 1.9e9, boyutTam: true });
  assert.deepEqual(dolu.map((x) => [x.id, x.deger, x.birim ?? null]), [['sohbet', '1.234', 'sohbet'], ['hafiza', '8', 'not'], ['ayarlar', 'Yerinde', null], ['yerel', '≈1,9 GB', null]]);
  const bos = tekrarSatirlari({ sohbet: 0, hafiza: 0, yerelBayt: null, boyutTam: true });
  assert.deepEqual(bos.map((x) => [x.id, x.deger]), [['sohbet', null], ['hafiza', null], ['ayarlar', 'Yerinde']]);
  assert.equal(TEKRAR_BOS, 'Boş');
  assert.equal(tekrarSatirlari({ sohbet: 1, hafiza: 0, yerelBayt: 0, boyutTam: true }).length, 3, 'boyut 0 → satır yok');
  // Bileşen: değer yoksa "Boş" ve onay işareti YOK (yalnız değer varken tamam simgesi).
  const t = oku('src/renderer/sayfalar/TekrarHosGeldin.tsx');
  assert.match(t, /s\.deger === null \? TEKRAR_BOS : <>/);
  assert.doesNotMatch(t, /TEKRAR_DURANLAR|>Yerinde</);
});

// Tasarım cilası: gümüş geçiş YALNIZ Fuber işaretinde (Isaret.tsx durakları) — yazıda ve sayıda geçiş yok (sayıdaki geçiş ilk sayıyı devre dışı
// gibi gösteriyordu).
test('geçiş yalnız işarette: fintech.css\'te yazı/sayı geçişi (background-clip: text) ve --ft-gumus geçiş belirteci yok; kurulum2 ve Tekrar geçişli yazı kullanmaz', () => {
  const css = oku('src/renderer/ui/fintech/fintech.css');
  assert.doesNotMatch(css, /background-clip:\s*text|--ft-gumus:|\.ft-gumus-yazi|data-vurgu/);
  assert.match(oku('src/renderer/ui/fintech/Isaret.tsx'), /var\(--ft-gumus-1\)/);
  // 0.14 T32: ekranın tek vurgusu (--vurgu, ui/vurgu.ts) artık burada da var — yasak yalnız geçişli yazı.
  for (const d of [...dosyalar('src/renderer/kurulum2'), 'src/renderer/sayfalar/TekrarHosGeldin.tsx']) assert.doesNotMatch(oku(d), /ft-gumus-yazi|background-clip:\s*text/, d);
});

/** #rrggbb göreli parlaklık ve kontrast (WCAG). */
const parlaklik = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const kontrast = (a: string, b: string) => { const [x, y] = [parlaklik(a), parlaklik(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

// Açık temada kapalı anahtar görünür (eskiden beyaz iz beyaz kartta): kapalı iz ve kenar belirteçten; kenar kart yüzeyinde ≥ 3:1 (iki temada);
// topuz rengi belirteçten (renkler yalnız belirteçlerden).
test('anahtar: kapalıyken iz + ≥ 3:1 kenar (iki temada, kart yüzeyinde); topuz belirteçten (#fff gömülü değil)', () => {
  const css = oku('src/renderer/ui/fintech/fintech.css');
  const blok = (bas: string) => { const i = css.indexOf(bas); return css.slice(i, css.indexOf('\n}', i)); };
  for (const [ad, b] of [['koyu', blok(':root {')], ['açık', blok(":root[data-tema='acik'] {")]] as const) {
    const al = (n: string) => b.match(new RegExp(`--${n}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1];
    const kenar = al('ft-anahtar-kenar'), yuzey = al('ft-yuzey'), iz = al('ft-anahtar-iz');
    assert.ok(kenar && yuzey && iz, `${ad}: belirteçler`);
    assert.ok(kontrast(kenar, yuzey) >= 3, `${ad}: kenar/yüzey ${kontrast(kenar, yuzey).toFixed(2)}`);
    assert.ok(kontrast(kenar, iz) >= 1.8, `${ad}: kenar izden ayrılır`);
  }
  const anahtar = css.slice(css.indexOf('.ft-anahtar {'), css.indexOf('.ft-anahtar:disabled'));
  assert.match(anahtar, /background: var\(--ft-anahtar-iz\)/);
  assert.match(anahtar, /inset 0 0 0 1\.5px var\(--ft-anahtar-kenar\)/);
  assert.match(anahtar, /background: var\(--ft-anahtar-topuz\)/);
  assert.doesNotMatch(anahtar, /#fff\b/i);
});

// ── 0.14 T32: kurulum Nusa dilinde, mod adımında gözler (11 Kas "Pamuk") ───────────────────────────────────────────────────────────────
// Kural: kurulum en önemli ekran — "ileri, ileri, ileri", az seçim, Apple gibi. Mod adımında iki kart, her birinde gözler (120 px siyah sahne,
// parıltı kipin renginde); gözler imleci izler, üzerine gelince selam verir; seçim değişince önizlemede göz aynı kalır, parıltı çapraz solar.
// Sade modda (T6b) hiçbir kartta göz yok: kipin adı ve vurgu rengi (SadeIsaret).
test('mod adımında iki kartta gözler (120 px, canlı), kart adı Business mode ve Developer mode', () => {
  assert.deepEqual(KIP_KARTI_KARAKTERI, { boyut: 120 });
  assert.deepEqual(kurallar.kipKartlari(undefined).map((k) => k.ad), ['Business mode', 'Developer mode']);
  const s = oku('src/renderer/kurulum2/adimlar/Kip.tsx');
  assert.match(s, /<Gozler kip=\{kip\} boyut=\{KIP_KARTI_KARAKTERI\.boyut\} hal="sakin"/, 'kartın gözleri 120 px, canlı (imleci izler)');
  assert.match(s, /kipKartlari\(ayar\.hesap\?\.karakterler\)\.map\(\(k\) => <KipKarti/, 'iki kart, kipKartlari sırasıyla');
  assert.match(s, /className="k2-kip__ad">\{k\.ad\}/, 'kartın adı kipKartlari ad’ı (Business mode, Developer mode)');
  // Sade: kartta göz yok — kipin adı ve vurgusu (SadeIsaret kipin rengini taşır).
  assert.match(s, /useKarakterGorunur\(\)/);
  assert.match(s, /gorunur\s*\?\s*<Gozler[\s\S]*?:\s*<SadeKartIsareti kip=\{kip\}/, 'Sade’de göz yerine kipin vurgulu işareti');
  assert.match(s, /<span className="k2-sade-isaret" style=\{vurguStili\('kurulum', kip\) as CSSProperties\}><SadeIsaret kip=\{kip\}/);
  assert.match(s, /\{gorunur && k\.tanim \? k\.tanim : KIP_ISLEVI\[k\.mod\]\}/, 'gözlü görünümde kipin tonu, Sade’de işlevi; ad yazılmaz (iki kartta da Fuber)');
  assert.doesNotMatch(s, /k\.karakter\b/, 'kartta karakter adı yok');
  assert.match(s, /role="radiogroup"[^>]*onKeyDown=\{\(e\) => radyoTusu\(/, 'klavye: ←/→ seçer');
  assert.match(s, /role="radio"/);
});

test('üzerine gelince gözler selam verir (iki modda aynı); az harekette yok', () => {
  assert.equal(uzerineGelinceTetik('is', { azHareket: false, gorunur: true }), 'selam');
  assert.equal(uzerineGelinceTetik('gelistirici', { azHareket: false, gorunur: true }), 'selam');
  assert.equal(uzerineGelinceTetik('is', { azHareket: true, gorunur: true }), null, 'az hareket (ayar ya da Windows tercihi)');
  assert.equal(uzerineGelinceTetik('gelistirici', { azHareket: true, gorunur: true }), null);
  assert.equal(uzerineGelinceTetik('is', { azHareket: false, gorunur: false }), null, 'Sade: göz yok, hareket yok');
  const s = oku('src/renderer/kurulum2/adimlar/Kip.tsx');
  assert.match(s, /onPointerEnter=\{uzerine\}/);
  assert.match(s, /uzerineGelinceTetik\(k\.mod, \{ azHareket: azMi\(\), gorunur \}\)/);
  assert.match(s, /tetik=\{tetik\}/, 'gözlerin jesti (selam)');
  // Az hareket: Görünüm → "Az hareket" (gorunum.azHareket) ya da Windows'un animasyon tercihi, olay anında okunur (dinleyici yok, döngü yok).
  assert.match(s, /ayar\.gorunum\?\.azHareket === true \|\| sistemAzMi\(\)/);
  assert.match(s, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches/);
  assert.doesNotMatch(s, /requestAnimationFrame|setInterval/);
  // Gözün kendi beyni de az harekette selam yerine yalnız kırpar (ikinci kilit; tests/goz-hareket.test.ts).
  assert.match(oku('src/renderer/ui/goz/beyin.ts'), /if \(this\.az\(\)\) \{ this\.kirp\(true\); return; \}/);
});

test('seçim değişince ModGecisi', () => {
  assert.deepEqual(kipGecisi('is', 'gelistirici'), { eski: 'business', yeni: 'developer' });
  assert.deepEqual(kipGecisi('gelistirici', 'is'), { eski: 'developer', yeni: 'business' });
  assert.equal(kipGecisi('is', 'is'), null, 'aynı seçim geçiş oynatmaz');
  assert.deepEqual(KIP_ONIZLEME_KARAKTERI, { boyut: 88 }, 'önizlemedeki gözler 88 px');
  const s = oku('src/renderer/kurulum2/adimlar/Kip.tsx');
  assert.match(s, /<ModGecisi eski=\{gecis\.eski\} yeni=\{gecis\.yeni\} boyut=\{KIP_ONIZLEME_KARAKTERI\.boyut\} azHareket=\{az\} bitti=\{\(\) => setGecis\(null\)\} \/>/);
  // Geçiş çizimden önce kurulur (render sırasında türetilen durum): yeni karakter bir kare bile geçişsiz görünmez.
  assert.match(s, /if \(son !== t\.mod\) \{ setSon\(t\.mod\); setGecis\(kipGecisi\(son, t\.mod\)\); \}/);
});

test('kurulum ve Tekrar hoş geldin ekran kökleri tek data-vurgu taşır', () => {
  // Vurgu kipi izler (T29: kurulum = 'karakter'): Business turuncu, Developer yeşil — değer yalnız ui/goz/vurgu.ts'ten.
  assert.equal(vurguRengi('kurulum', 'business'), KIP_VURGUSU.business.toUpperCase());
  assert.equal(vurguRengi('kurulum', 'developer'), KIP_VURGUSU.developer.toUpperCase());
  assert.deepEqual(vurguStili('kurulum', 'developer'), { '--vurgu': KIP_VURGUSU.developer.toUpperCase() });
  const k = oku('src/renderer/kurulum2/Kurulum2.tsx');
  const t = oku('src/renderer/sayfalar/TekrarHosGeldin.tsx');
  // Her kök (Kurulum2'de yükleniyor kökü + asıl kök; Tekrar'da tek kök) data-vurgu="kurulum" ve vurguStili taşır.
  const kokler = (s: string) => [...s.matchAll(/<div\b[^>]*className="k2(?: [^"]*)?"[^>]*>/g)].map((m) => m[0]);
  for (const [ad, s, n] of [['Kurulum2', k, 2], ['Tekrar', t, 1]] as const) {
    const ks = kokler(s);
    assert.equal(ks.length, n, `${ad}: kök sayısı`);
    for (const x of ks) {
      assert.match(x, /data-vurgu="kurulum"/, `${ad}: ${x}`);
      assert.match(x, /style=\{vurguStili\('kurulum'/, `${ad}: ${x}`);
    }
    assert.equal(s.match(/data-vurgu=/g)?.length, n, `${ad}: kökten başka data-vurgu yok`);
  }
  assert.match(k, /vurguStili\('kurulum', modKip\(taslak\.mod\)\)/, 'kurulum: seçilen kip (taslak; anında kaydedilir)');
  assert.match(t, /vurguStili\('kurulum', modKip\(mod\)\)/, 'Tekrar: kayıtlı kip');
  // Adım dosyaları ve önizlemeler kendi data-vurgu'sunu kurmaz (tek vurgu kökten miras gelir).
  for (const d of dosyalar('src/renderer/kurulum2', /\.tsx$/).filter((x) => !x.endsWith('Kurulum2.tsx'))) assert.doesNotMatch(oku(d), /data-vurgu=/, d);
});
