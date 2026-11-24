// 0.12 H3c (spec Hedefler §5 "Yerel modeller"): kurulumun "Nerede çalışsın" adımı ve Ayarlar → Gizlilik'in model kartları. Yerel
// modeller kullanılabilir. Bilgisayara uyan seçili gelir ("Önerilen" = uyanların en iyisi); uymayan soluk, SEÇİLEMEZ ve nedeni
// gerçek donanımın sayısıyla yazar ("Bu bilgisayarda 8 GB bellek var, bu sürüm 16 GB ister."). Donanım okunamazsa tutucu: hiçbir şey
// önerilmez ve seçilemez. Katalog verisi gerçek paket listesinden (main/yerel/paketler.ts YEREL_MODELLER) — saf, ağsız.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YEREL_MODELLER } from '../src/main/yerel/paketler.ts';
import { yerelKatalog, katalogSecimi, varsayilanModel, indirmeSuresi, kurulumUygunlugu, yerelYenidenIndirSecimi, katalogYetmezligi, yarimlaBosDisk, INDIRME_HIZI_MBIT, type KatalogModeli, type KatalogGirdisi } from '../src/shared/yerel-katalog.ts';
import fs from 'node:fs';
import path from 'node:path';
import { isDiliIhlali } from '../src/shared/is-dili.ts';
import { onerilenYerel, type ModelBilgisi } from '../src/shared/model-bilgisi.ts';
import type { YerelModelAdi } from '../src/shared/tipler.ts';

const modeller = (kurulu: YerelModelAdi[] = []): KatalogModeli[] => (Object.keys(YEREL_MODELLER) as (keyof typeof YEREL_MODELLER)[]).map((ad) => {
  const m = YEREL_MODELLER[ad];
  return { ad, etiket: m.etiket, aciklama: m.aciklama, ozet: m.ozet, boyut: m.boyut, ramGB: m.ramGB, ...(m.vramGB !== undefined ? { vramGB: m.vramGB } : {}), kurulu: kurulu.includes(ad) };
});
const katalog = (donanim: KatalogGirdisi['donanim'], ek: Partial<KatalogGirdisi> = {}) => yerelKatalog({ donanim, modeller: modeller(), calistiriciKurulu: false, sade: true, ...ek });
const kart = (k: ReturnType<typeof katalog>, ad: YerelModelAdi) => k.kartlar.find((x) => x.ad === ad)!;
const ZAYIF = { ramGB: 8, nvidia: false, bosDiskGB: 400 };
const ORTA = { ramGB: 16, nvidia: false, bosDiskGB: 400 };
const GUCLU = { ramGB: 32, nvidia: true, vramGB: 16, bosDiskGB: 400 };

test('8 GB bellek, ekran kartı yok: 27B uymaz (soluk, seçilemez, nedeni gerçek sayıyla); uyanların en iyisi Önerilen ve seçili gelir', () => {
  const k = katalog(ZAYIF);
  assert.equal(k.durum, 'olculdu');
  assert.deepEqual(k.kartlar.map((x) => x.ad), ['bonsai2-27b', 'bonsai2-9b', 'bonsai2-4b'], 'kartlar büyükten küçüğe (paket sırası)');
  const b = kart(k, 'bonsai2-27b');
  assert.equal(b.uygun, false);
  assert.equal(b.neden, 'Bu bilgisayarda 8 GB bellek var, bu sürüm 16 GB ister.');
  assert.equal(b.onerilen, false);
  // 9B belleğe sığar ama ekran kartı yok: çalışır, yavaş (seçilebilir, nedeni dürüst).
  const o = kart(k, 'bonsai2-9b');
  assert.equal(o.uygun, true);
  assert.equal(o.hiz, 'yavas');
  assert.equal(o.neden, null);
  // 4B işlemcide rahat: uyanların en iyisi.
  assert.equal(kart(k, 'bonsai2-4b').hiz, 'rahat');
  assert.equal(k.onerilen, 'bonsai2-4b');
  assert.deepEqual(k.kartlar.filter((x) => x.onerilen).map((x) => x.ad), ['bonsai2-4b'], 'tek Önerilen');
  assert.equal(varsayilanModel(k), 'bonsai2-4b', 'önerilen seçili gelir');
  // Uymayan seçilemez: istenen uymuyorsa seçim önerilene düşer; uyan istenen olduğu gibi kalır.
  assert.equal(katalogSecimi(k, 'bonsai2-27b'), 'bonsai2-4b');
  assert.equal(katalogSecimi(k, 'bonsai2-9b'), 'bonsai2-9b');
  assert.equal(katalogSecimi(k, null), 'bonsai2-4b');
});

test('güçlü bilgisayar (16 GB ekran kartı): en büyük sürüm ekran kartında hızlı — Önerilen; hepsi seçilebilir', () => {
  const k = katalog(GUCLU);
  assert.equal(k.onerilen, 'bonsai2-27b');
  assert.equal(kart(k, 'bonsai2-27b').hiz, 'hizli');
  assert.ok(k.kartlar.every((x) => x.uygun && x.neden === null));
});

test('16 GB, ekran kartı yok: 27B belleğe sığar ama yavaş (seçilebilir); Önerilen işlemcide rahat çalışan hafif sürüm', () => {
  const k = katalog(ORTA);
  assert.equal(k.onerilen, 'bonsai2-4b');
  const b = kart(k, 'bonsai2-27b');
  assert.deepEqual([b.uygun, b.hiz], [true, 'yavas']);
  assert.match(b.uygunlukMetni, /yavaş/);
  // "Yalnız işlemci" seçiliyse ekran kartı sayılmaz.
  assert.equal(katalog(GUCLU, { islemciZorla: true }).onerilen, 'bonsai2-4b');
});

test('disk: sığmayan sürüm uymaz ve nedeni boş yeri söyler; kurulu sürüm diske bakmaz', () => {
  const k = katalog({ ramGB: 32, nvidia: true, vramGB: 16, bosDiskGB: 4 });
  assert.equal(kart(k, 'bonsai2-27b').uygun, false);
  assert.equal(kart(k, 'bonsai2-27b').neden, 'Diskte 4 GB boş yer var, bu sürüm 9,5 GB ister.');
  assert.equal(kart(k, 'bonsai2-9b').uygun, false);
  assert.equal(kart(k, 'bonsai2-4b').uygun, true);
  assert.equal(k.onerilen, 'bonsai2-4b');
  const kur = yerelKatalog({ donanim: { ramGB: 32, nvidia: true, vramGB: 16, bosDiskGB: 0.5 }, modeller: modeller(['bonsai2-27b']), calistiriciKurulu: true, sade: true });
  const b = kur.kartlar.find((x) => x.ad === 'bonsai2-27b')!;
  assert.deepEqual([b.uygun, b.kurulu, b.indirGB, b.sureMetni], [true, true, 0, 'Kurulu']);
  assert.equal(varsayilanModel(kur), 'bonsai2-27b', 'kurulu ve uyan sürüm seçili gelir (yeniden inmez)');
});

test('hiçbiri uymuyor (4 GB): Önerilen yok, genel neden en hafif sürümünki; seçim yok', () => {
  const k = katalog({ ramGB: 4, nvidia: false, bosDiskGB: 400 });
  assert.equal(k.onerilen, null);
  assert.ok(k.kartlar.every((x) => !x.uygun && x.neden));
  assert.equal(k.neden, 'Bu bilgisayarda 4 GB bellek var, bu sürüm 6 GB ister.');
  assert.equal(katalogSecimi(k, 'bonsai2-4b'), null);
  assert.equal(varsayilanModel(k), null);
});

test('donanım okunamadı → tutucu: hiçbir sürüm önerilmez ve seçilemez (ölçülmemiş şey söylenmez); okunurken de seçim yok', () => {
  const h = katalog('hata');
  assert.equal(h.durum, 'okunamadi');
  assert.equal(h.onerilen, null);
  assert.ok(h.kartlar.every((x) => !x.uygun && !x.onerilen && x.neden));
  assert.equal(katalogSecimi(h, 'bonsai2-4b'), null);
  const b = katalog(null);
  assert.equal(b.durum, 'bekliyor');
  assert.equal(b.onerilen, null);
  assert.ok(b.kartlar.every((x) => !x.uygun));
  // Ekran kartı var ama belleği okunamadı: kart sayılmaz (tutucu) — ekran kartı isteyen sürüm "hızlı" denmez.
  const v = katalog({ ramGB: 32, nvidia: true, bosDiskGB: 400 });
  assert.equal(kart(v, 'bonsai2-27b').hiz, 'yavas');
  assert.equal(v.onerilen, 'bonsai2-4b');
});

test('kart: boyut (GB, ilk kurulumda çalıştırıcı payıyla) ve tahmini indirme süresi; İş dilinde model adı yok, Geliştirici\'de var', () => {
  const k = katalog(ORTA);
  const h = kart(k, 'bonsai2-4b');
  assert.equal(h.boyutMetni, '2,5 GB');
  assert.equal(h.sureMetni, indirmeSuresi(h.indirGB * 1e9));
  assert.equal(INDIRME_HIZI_MBIT, 50);
  assert.equal(indirmeSuresi(1.9e9), '≈ 5 dk');
  assert.equal(indirmeSuresi(7.9e9), '≈ 21 dk');
  assert.equal(indirmeSuresi(0.2e9), '≈ 1 dk');
  assert.equal(indirmeSuresi(40e9), '≈ 1 sa 47 dk');
  assert.equal(kart(katalog(ORTA, { calistiriciKurulu: true }), 'bonsai2-4b').boyutMetni, '1,2 GB', 'çalıştırıcı kuruluysa yalnız model iner');
  assert.deepEqual(k.kartlar.map((x) => x.baslik), ['Büyük sürüm', 'Orta sürüm', 'Hafif sürüm']);
  for (const x of katalog(ZAYIF).kartlar) {
    for (const m of [x.baslik, x.aciklama, x.uygunlukMetni, x.neden ?? '', x.boyutMetni, x.sureMetni]) {
      assert.equal(isDiliIhlali(m), null, m);
      assert.doesNotMatch(m, /'/, `düz kesme işareti: ${m}`);
    }
  }
  const gel = yerelKatalog({ donanim: ZAYIF, modeller: modeller(), calistiriciKurulu: false, sade: false });
  assert.deepEqual(gel.kartlar.map((x) => x.baslik), ['Bonsai 2 · 27B', 'Bonsai 2 · 9B', 'Bonsai 2 · 4B']);
  assert.equal(gel.kartlar[0].neden, 'Bu bilgisayarda 8 GB bellek var, bu model 16 GB ister.');
  assert.ok(gel.kartlar[0].ayrinti && /bellek/.test(gel.kartlar[0].ayrinti), 'Geliştirici: disk/bellek/ekran kartı ayrıntısı');
});

test('Kü1 (düzeltme turu 1): boş disk okunamazsa TUTUCU — kurulu olmayan sürüm seçilemez ("Disk ölçülemedi"); kurulu sürüm etkilenmez', () => {
  for (const bosDiskGB of [undefined, Number.NaN]) {
    const k = katalog({ ramGB: 32, nvidia: true, vramGB: 16, ...(bosDiskGB === undefined ? {} : { bosDiskGB }) });
    assert.ok(k.kartlar.every((x) => !x.uygun && x.uygunlukMetni === 'Disk ölçülemedi' && x.neden), JSON.stringify(k.kartlar.map((x) => [x.ad, x.uygun, x.uygunlukMetni])));
    assert.equal(k.onerilen, null);
  }
  const kur = yerelKatalog({ donanim: { ramGB: 32, nvidia: true, vramGB: 16 }, modeller: modeller(['bonsai2-9b']), calistiriciKurulu: true, sade: true });
  assert.equal(kur.kartlar.find((x) => x.ad === 'bonsai2-9b')?.uygun, true);
});

test('Ö3 (düzeltme turu 1): inen sürüm, kendi yarım dosyası boş yeri azalttığı için "uymuyor" denmez', () => {
  const dar = { ramGB: 32, nvidia: true, vramGB: 16, bosDiskGB: 2 };
  assert.equal(katalog(dar).kartlar.find((x) => x.ad === 'bonsai2-27b')?.uygun, false);
  const k = katalog(dar, { inen: 'bonsai2-27b' });
  assert.equal(k.kartlar.find((x) => x.ad === 'bonsai2-27b')?.uygun, true, 'inen sürüm');
  assert.equal(k.kartlar.find((x) => x.ad === 'bonsai2-9b')?.uygun, false, 'öteki sürümler yine diske bakar');
});

test('Ö2 (düzeltme turu 1): ana süreç uymayan sürümü REDDEDER — arayüzle aynı uygunluk işlevi (kurulumUygunlugu); ipc.ts yerel:kur onu çağırır', () => {
  const k = katalog(ZAYIF);
  assert.deepEqual(kurulumUygunlugu(k, 'bonsai2-27b'), { uygun: false, neden: 'Bu bilgisayarda 8 GB bellek var, bu sürüm 16 GB ister.' });
  assert.deepEqual(kurulumUygunlugu(k, 'bonsai2-4b'), { uygun: true, neden: null });
  assert.equal(kurulumUygunlugu(katalog('hata'), 'bonsai2-4b').uygun, false, 'ölçülemeyen bilgisayarda tutucu');
  const ipc = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'main', 'ipc.ts'), 'utf8');
  const kur = ipc.slice(ipc.indexOf("h('yerel:kur'"), ipc.indexOf("h('yerel:durdur'"));
  assert.match(kur, /yerelKurUygunlugu\(/, 'yerel:kur uygunluğu ana süreçte denetler');
  assert.ok(kur.indexOf('yerelKurUygunlugu(') < kur.indexOf('bekleyenYaz('), 'reddedilen istek kayıt yazmaz');
});

// ── H3c düzeltme turu 2 ──
test('Kü (düzeltme turu 2): kokpitin "Yeniden indir"i sürümü ve boyutu söyler ("Hafif sürümü indir · 1,9 GB"); 1 GB üstünde Ayarlar’daki gibi boyutlu onay; kurulu sürüm "aç"ılır, inmez', () => {
  const k = katalog(ZAYIF);
  const s = yerelYenidenIndirSecimi(k, { istenen: null, sade: true, bosDiskGB: 400 })!;
  assert.equal(s.model, 'bonsai2-4b');
  assert.equal(s.kurulu, false);
  assert.equal(s.etiket, 'Hafif sürümü indir · 2,5 GB');
  assert.equal(s.onay, true, '2,5 GB > 1 GB: onay');
  assert.equal(s.onayBaslik, 'Hafif sürüm indirilsin mi?');
  assert.equal(s.onayMetni, 'Yaklaşık 2,5 GB indirilecek; diskte 400 GB boş. İstediğin an durdurabilirsin.');
  assert.equal(s.onayDugmesi, 'İndir · 2,5 GB');
  // İstenmiş (uyan) sürüm korunur; uymayan istenirse Önerilen.
  assert.equal(yerelYenidenIndirSecimi(k, { istenen: 'bonsai2-9b', sade: true })!.etiket, 'Orta sürümü indir · 3,8 GB');
  assert.equal(yerelYenidenIndirSecimi(k, { istenen: 'bonsai2-27b', sade: true })!.model, 'bonsai2-4b');
  // Kurulu sürüm: indirme yok, onay yok.
  const kur = yerelKatalog({ donanim: ZAYIF, modeller: modeller(['bonsai2-4b']), calistiriciKurulu: true, sade: true });
  const a = yerelYenidenIndirSecimi(kur, { istenen: 'bonsai2-4b', sade: true })!;
  assert.deepEqual([a.kurulu, a.etiket, a.onay], [true, 'Hafif sürümü aç', false]);
  // Geliştirici: paket adı; İş dilinde "model"/"Bonsai" yok.
  const gel = yerelYenidenIndirSecimi(yerelKatalog({ donanim: ZAYIF, modeller: modeller(), calistiriciKurulu: false, sade: false }), { istenen: null, sade: false })!;
  assert.equal(gel.etiket, 'İndir · Bonsai 2 · 4B · 2,5 GB');
  for (const m of [s.etiket, s.onayBaslik, s.onayMetni, s.onayDugmesi, a.etiket]) assert.equal(isDiliIhlali(m), null, m);
  // Seçilecek sürüm yoksa (ölçülemedi) null — kart Ayarlar’a yönlendirir.
  assert.equal(yerelYenidenIndirSecimi(katalog('hata'), { istenen: null, sade: true }), null);
});

test('Kü (düzeltme turu 2): kurulumda ret nedeni — disk ölçülemediyse "ölçemedim" (yetmiyor denmez); ölçüldü ve sığmıyorsa "yetmiyor"', () => {
  assert.equal(katalogYetmezligi(katalog({ ramGB: 32, nvidia: true, vramGB: 16 })), 'olculemedi');
  assert.equal(katalogYetmezligi(katalog({ ramGB: 4, nvidia: false, bosDiskGB: 1 })), 'yetmiyor');
  assert.equal(katalogYetmezligi(null), 'yetmiyor');
  // Ana sürecin reddi (Ö2) nedeniyle: "Diskteki boş yer ölçülemedi…" → ölçemedim.
  assert.equal(katalogYetmezligi(null, 'Diskteki boş yer ölçülemedi; bu sürüm 2,9 GB ister.'), 'olculemedi');
  assert.equal(katalogYetmezligi(null, 'Bu bilgisayarda 8 GB bellek var, bu sürüm 16 GB ister.'), 'yetmiyor');
  const yk = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'renderer', 'kurulum2', 'yerel-karar.ts'), 'utf8');
  assert.match(yk, /katalogYetmezligi\(katalog\)/, 'arayüz reddi');
  assert.match(yk, /katalogYetmezligi\(null, r\.hata\)/, 'ana süreç reddi');
});

// ── H3c takip turu ──
test('Takip 1: sürümün model dosyası kurulu ama çalıştırıcı YOK → "aç" kısayolu değil, onarım (indirme) yolu — çalıştırıcı payı kadar', () => {
  const k = yerelKatalog({ donanim: ZAYIF, modeller: modeller(['bonsai2-4b']), calistiriciKurulu: false, sade: true });
  const s = yerelYenidenIndirSecimi(k, { istenen: 'bonsai2-4b', sade: true, calistiriciKurulu: false })!;
  assert.deepEqual([s.model, s.kurulu, s.etiket, s.onay], ['bonsai2-4b', false, 'Hafif sürümü indir · 1,3 GB', true]);
  // Çalıştırıcı da kuruluysa kısayol aynen.
  const tam = yerelKatalog({ donanim: ZAYIF, modeller: modeller(['bonsai2-4b']), calistiriciKurulu: true, sade: true });
  assert.equal(yerelYenidenIndirSecimi(tam, { istenen: 'bonsai2-4b', sade: true, calistiriciKurulu: true })!.etiket, 'Hafif sürümü aç');
  const src = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'renderer', 'bilesenler', 'YerelYenidenIndir.tsx'), 'utf8');
  assert.match(src, /calistiriciKurulu: Boolean\(kd\.d\?\.kurulu\.calistirici\)/, 'kokpit kartı çalıştırıcıyı sorar');
  for (const f of ['src/renderer/ayarlar/Gizlilik.tsx', 'src/renderer/kurulum2/yerel-karar.ts']) {
    assert.match(fs.readFileSync(path.resolve(import.meta.dirname, '..', f), 'utf8'), /calistirici\)/, `${f}: kurulu sürüme geçiş çalıştırıcıyı da ister`);
  }
});

test('Takip 5: yarım indirme dosyası (çökme/çıkış artığı) ana süreç kapısında boş yere eklenir — "Sürdür" haksız reddedilmez', () => {
  assert.deepEqual(yarimlaBosDisk({ ramGB: 16, nvidia: false, bosDiskGB: 3 }, 2e9), { ramGB: 16, nvidia: false, bosDiskGB: 5 });
  assert.equal(yarimlaBosDisk('hata', 2e9), 'hata');
  assert.deepEqual(yarimlaBosDisk({ ramGB: 16, nvidia: false }, 2e9), { ramGB: 16, nvidia: false }, 'ölçülemeyen disk ölçülmüş sayılmaz');
  assert.deepEqual(yarimlaBosDisk({ ramGB: 16, nvidia: false, bosDiskGB: 3 }, 0), { ramGB: 16, nvidia: false, bosDiskGB: 3 });
  // 27B (8,9 GB ister), 7 GB boş + 2 GB yarım dosya → sığar.
  const dar = katalog(yarimlaBosDisk({ ramGB: 32, nvidia: true, vramGB: 16, bosDiskGB: 7 }, 2.5e9));
  assert.equal(kurulumUygunlugu(dar, 'bonsai2-27b').uygun, true);
  const u = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'main', 'yerel', 'uygunluk.ts'), 'utf8');
  assert.match(u, /yarimlaBosDisk\(await donanim\(\), yerelYarimBayt\(ad\)\)/);
});

// ── 0.13 G: katalog sunucudan gelir (kaç kayıt olacağı ve sırası katalogdan) ──
const genis = (ad: string, boyutGB: number, ek: Partial<KatalogModeli> = {}): KatalogModeli => ({ ad, etiket: `${ad} teknik`, aciklama: `${ad} açıklama`, ozet: `${ad} özet`, dosya: `${ad}.gguf`, boyut: boyutGB * 1e9, ramGB: 6, kurulu: false, ...ek });

test('0.13 G: kartlar katalogdaki sırayla (sira, girdi sırası); öneri yine büyükten küçüğe en iyi olan', () => {
  const k = yerelKatalog({ donanim: { ramGB: 32, nvidia: true, vramGB: 16, bosDiskGB: 400 }, calistiriciKurulu: false, sade: true, modeller: [genis('kucuk', 1), genis('buyuk', 5, { ramGB: 12, vramGB: 7 }), genis('orta', 3, { ramGB: 8, vramGB: 5 })] });
  assert.deepEqual(k.kartlar.map((x) => x.ad), ['kucuk', 'buyuk', 'orta']);
  assert.equal(k.onerilen, 'buyuk');
  assert.equal(varsayilanModel(k), 'buyuk', 'donanıma uyan seçili gelir');
});

test('0.13 G: üçten çok kayıtta Business adları ayrışır: iki kart aynı adı taşımaz, Büyük/Orta/Hafif üçlüsü aynen', () => {
  const k = yerelKatalog({ donanim: GUCLU, calistiriciKurulu: false, sade: true, modeller: [genis('a', 6), genis('b', 5), genis('c', 4), genis('d', 3), genis('e', 1)] });
  const adlar = k.kartlar.map((x) => x.baslik);
  assert.deepEqual(adlar, ['Büyük sürüm', 'Orta sürüm', '2. orta sürüm', '3. orta sürüm', 'Hafif sürüm']);
  assert.equal(new Set(adlar).size, adlar.length);
  const s = yerelYenidenIndirSecimi(k, { istenen: 'c', sade: true });
  assert.match(s!.etiket, /^2\. orta sürümü indir · /, 'düğme cümlesi Türkçe kalır');
  assert.equal(katalog(GUCLU).kartlar.map((x) => x.baslik).join(), 'Büyük sürüm,Orta sürüm,Hafif sürüm');
});

test('0.13 G: Business kartında özet, Developer kartında teknik ad ve dosya', () => {
  const m = [genis('qwen', 2)];
  const is = yerelKatalog({ donanim: GUCLU, calistiriciKurulu: false, sade: true, modeller: m }).kartlar[0];
  const gel = yerelKatalog({ donanim: GUCLU, calistiriciKurulu: false, sade: false, modeller: m }).kartlar[0];
  assert.deepEqual([is.baslik, is.aciklama, is.dosya], ['Hafif sürüm', 'qwen özet', undefined]);
  assert.deepEqual([gel.baslik, gel.aciklama, gel.dosya], ['qwen teknik', 'qwen özet', 'qwen.gguf']);
});

test('0.13 G: listeden kalkan kurulu model: kart söyler, seçilebilir, Önerilen olmaz; öneri açık modellerden', () => {
  const m = [genis('acik', 1), genis('kalkan', 5, { kurulu: true, listedenKalkti: true, vramGB: 7 })];
  for (const donanim of [GUCLU, 'hata' as const, null]) {
    const k = yerelKatalog({ donanim, calistiriciKurulu: true, sade: true, modeller: m });
    const kart = k.kartlar.find((x) => x.ad === 'kalkan')!;
    assert.deepEqual([kart.uygun, kart.kurulu, kart.onerilen, kart.sureMetni, kart.listedenKalkti], [true, true, false, 'Kuruldu, listeden kalktı', true], String(donanim));
  }
  const k = yerelKatalog({ donanim: GUCLU, calistiriciKurulu: true, sade: true, modeller: m });
  assert.equal(k.onerilen, 'acik');
  assert.equal(k.bos, false);
  assert.equal(katalogSecimi(k, 'kalkan'), 'kalkan', 'kullanıcının kurulu modeli seçili kalır');
});

test('0.13 G: kurulu dosya kayıttan eski: kart söyler, seçilebilir, kurulu sayılır; Developer ve Business aynı cümle', () => {
  for (const sade of [true, false]) {
    for (const donanim of [GUCLU, 'hata' as const, null]) {
      const k = yerelKatalog({ donanim, calistiriciKurulu: true, sade, modeller: [genis('eski', 2, { kurulu: true, eskiSurum: true })] });
      const [kart] = k.kartlar;
      assert.deepEqual([kart.uygun, kart.kurulu, kart.eskiSurum, kart.sureMetni, kart.indirGB], [true, true, true, 'Kurulu; yenisi var', 0], `${sade} ${String(donanim)}`);
    }
  }
  assert.equal(varsayilanModel(yerelKatalog({ donanim: GUCLU, calistiriciKurulu: true, sade: true, modeller: [genis('eski', 2, { kurulu: true, eskiSurum: true })] })), 'eski');
  assert.equal(isDiliIhlali('Kurulu; yenisi var'), null, 'Business dilinde');
});

test('0.13 G: gerçekten boş liste: kart yok, neden "Şu an sunulan model yok."; yalnız listeden kalkan varsa o kullanılır, not yine görünür', () => {
  const bos = yerelKatalog({ donanim: GUCLU, calistiriciKurulu: false, sade: true, modeller: [] });
  assert.deepEqual([bos.kartlar.length, bos.onerilen, bos.bos, bos.neden], [0, null, true, 'Şu an sunulan model yok.']);
  assert.equal(yerelKatalog({ donanim: 'hata', calistiriciKurulu: false, sade: true, modeller: [] }).bos, true);
  const kalan = yerelKatalog({ donanim: GUCLU, calistiriciKurulu: true, sade: true, modeller: [genis('kalkan', 1, { kurulu: true, listedenKalkti: true })] });
  assert.deepEqual([kalan.bos, kalan.onerilen, kalan.neden, varsayilanModel(kalan)], [true, null, null, 'kalkan']);
});

test('0.13 G: model seçicinin Önerileni de katalog sırasından bağımsız; listeden kalkan önerilmez', () => {
  const satir = (id: string, yerel: NonNullable<ModelBilgisi['yerel']>): ModelBilgisi => ({ id, ad: id, saglayici: 'yerel', yetenekler: [], yerel });
  const l = [satir('kucuk', { boyutGB: 1, ramGB: 6 }), satir('buyuk', { boyutGB: 5, ramGB: 12, vramGB: 7 }), satir('kalkan', { boyutGB: 9, ramGB: 12, vramGB: 10, listedenKalkti: true })];
  assert.equal(onerilenYerel(l, { ramGB: 32, nvidia: true, vramGB: 16 }), 'buyuk');
  assert.equal(l[0].id, 'kucuk', 'girdi sırası bozulmaz');
});

test('0.13 G: uygunluk hesabı aynen: VRAM alanı olmayan katalog kaydı işlemcide rahat, RAM yetmeyen seçilemez ve neden gerçek sayıyla', () => {
  const k = yerelKatalog({ donanim: ORTA, calistiriciKurulu: false, sade: true, modeller: [genis('uymaz', 20, { ramGB: 32 }), genis('rahat', 2, { ramGB: 8 })] });
  assert.equal(k.kartlar.find((x) => x.ad === 'uymaz')!.neden, 'Bu bilgisayarda 16 GB bellek var, bu sürüm 32 GB ister.');
  assert.equal(k.onerilen, 'rahat');
});
