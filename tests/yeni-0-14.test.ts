// 0.14 T35: "0.14’te yeni" kartı (0.13 T16'nın devamı; 0.12 spec Hedefler §3 kuralı; altyapı 0.11 G12b) — kokpitte BİR kez, yalnız yükselen profile; sihirbaz değil, sakin
// bir kart. Saf karar (shared/yenilik.ts) ve kablolama:
//   · yükselmiş profil (kurulumu tamam; işaret yok ya da eski sürümün işareti — 0.11'de kartı kapatanın '0.11.0') → kart bir kez;
//     yeni kurulum (kurulum:tamamla işareti yazar) → hiç; kapatılınca → hiç;
//   · açık tanıtım turu kartı geciktirir (tur ekranı itmesin); 0.12 H3a: yükseltme sihirbazı yok — kurulum sürümü karara girmez;
//   · test kipinde (FUBER_DEMO) işaretsiz profil kartı görmüş sayılır: yüzlerce önizleme profili 0.10 profili gibi davranmasın;
//   · içerik: 4–5 satır, her biri tek cümle, ’ kesme işareti, sağlayıcı/model/beyin/teknik söz yok; 0.14 konuları (yaşayan çentik ve dokuz sayfa,
//     gözler, internet ve sayfa okuma, bağlı servisler, belge üretimi); Sade modda karakter satırı düşer (tests/surum-ve-metin.test.ts T35);
//   · `yenilikSurumu` yalnız ana süreç yazar (yenilik:kapat / kurulum:tamamla): ayarlar:kaydet süzer, telefondan kapalı.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { YENILIKLER, YENILIK_BASLIGI, YENILIK_KAPAT_ETIKETI, YENILIK_SURUMU, yeniKartAcilsinMi } from '../src/shared/yenilik.ts';
import { isDiliIhlali } from '../src/shared/is-dili.ts';
import { ayarKaydiniSuz } from '../src/main/ayar-kaydi.ts';
import { CAGRI_KANALLARI } from '../src/shared/kanallar.ts';

const kok = path.resolve(import.meta.dirname, '..');
const yukselmis = { kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, mod: 'is' as const };

test('yükselmiş profil (kurulumu tamam, işaret yok) kartı BİR kez görür', () => {
  assert.equal(yeniKartAcilsinMi(yukselmis), true);
  assert.equal(yeniKartAcilsinMi({ ...yukselmis, mod: 'gelistirici' }), true);
  assert.equal(yeniKartAcilsinMi({ ...yukselmis, yenilikSurumu: '' }), true, 'boş işaret = görmedi');
  assert.equal(yeniKartAcilsinMi({ ...yukselmis, yenilikSurumu: '0.10.0' }), true, 'eski sürümün işareti kartı açar');
  // 0.13'ün asıl yükselen kullanıcısı: 0.12'de "0.12’de yeni" kartını kapatmış (işaret '0.12.0') ya da yeni kurmuş (kurulum:tamamla '0.12.0' yazdı).
  assert.equal(yeniKartAcilsinMi({ ...yukselmis, yenilikSurumu: '0.12.0' }), true, '0.12 profili (işaret 0.12.0) 0.13 kartını görür');
  assert.equal(yeniKartAcilsinMi({ ...yukselmis, yenilikSurumu: '0.12.0' }, { demo: true }), true, 'test kipinde de: işaret yazılı (eski sürüm)');
  // 0.14'ün asıl yükselen kullanıcısı: 0.13'te kartı kapatmış ya da 0.13 kurulumunu bitirmiş (işaret '0.13.0'; 0.13.1 yama sürümü işareti değiştirmedi).
  assert.equal(yeniKartAcilsinMi({ ...yukselmis, yenilikSurumu: '0.13.0' }), true, '0.13 profili (işaret 0.13.0) 0.14 kartını görür');
  // 0.10.0 profili (kurulum sürümü 4; hiçbir sayfa 5'le gelmez → yükseltme sihirbazı yok): kart gelir.
  assert.equal(yeniKartAcilsinMi({ kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU - 1, mod: 'is' }), true, '0.10.0 profili (kurulum sürümü 4)');
  assert.equal(yeniKartAcilsinMi({ kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU - 1, mod: 'gelistirici' }), true, '0.10.0 Geliştirici profili');
});

test('yeni kurulum kartı hiç görmez: kurulum bitmeden yok; kurulum:tamamla işareti yazdığı için bittikten sonra da yok', () => {
  assert.equal(yeniKartAcilsinMi({ kurulumTamam: false }), false);
  assert.equal(yeniKartAcilsinMi({ kurulumTamam: false, yenilikSurumu: '' }), false);
  assert.equal(yeniKartAcilsinMi({ ...yukselmis, yenilikSurumu: YENILIK_SURUMU }), false, 'kurulum işaretini yazdı');
});

test('kapatılınca bir daha yok', () => {
  const kapali = { ...yukselmis, yenilikSurumu: YENILIK_SURUMU };
  assert.equal(yeniKartAcilsinMi(kapali), false);
  assert.equal(yeniKartAcilsinMi(kapali, { turAcik: true }), false);
  assert.equal(yeniKartAcilsinMi(kapali, { demo: true }), false);
});

test('0.12 H3a: yükseltmede sihirbaz yok — her kurulum sürümünde kart doğrudan kokpitte; açık tur kartı geciktirir', () => {
  for (const s of [0, 1, 2, 3, 4, 5]) assert.equal(yeniKartAcilsinMi({ kurulumTamam: true, kurulumSurumu: s, mod: 'is' }), true, `kurulum sürümü ${s}`);
  assert.equal(yeniKartAcilsinMi({ kurulumTamam: true, mod: 'is' }), true, 'göç öncesi (sürüm yok)');
  assert.equal(yeniKartAcilsinMi(yukselmis, { turAcik: true }), false, 'tur açıkken kart ızgarayı kaydırmaz');
  assert.equal(yeniKartAcilsinMi(yukselmis, { turAcik: false }), true, 'tur bitince kart gelir');
});

test('test kipi (FUBER_DEMO): işaretsiz profil kartı görmüş sayılır; kart için işaret açıkça "" yazılır', () => {
  assert.equal(yeniKartAcilsinMi(yukselmis, { demo: true }), false);
  assert.equal(yeniKartAcilsinMi({ ...yukselmis, yenilikSurumu: '' }, { demo: true }), true);
  assert.equal(yeniKartAcilsinMi(yukselmis, { demo: false }), true, 'müşteri sürümünde işaretsiz profil = yükselmiş');
});

test('işaret sürümü 0.14 ailesinde: kartın başlığı ve işaret package.json ile aynı büyük.küçük sürümü anar', () => {
  const surum = JSON.parse(fs.readFileSync(path.join(kok, 'package.json'), 'utf8')).version as string;
  // 0.15 yeni kart taşımaz (kart 0.14'te kaldı): işaret uygulama sürümünü aşmaz, başlık işaretin ailesini anar.
  const kisa = YENILIK_SURUMU.split('.').slice(0, 2).join('.');
  const [a1, a2] = YENILIK_SURUMU.split('.').map(Number);
  const [b1, b2] = surum.split('.').map(Number);
  assert.ok(a1! < b1! || (a1 === b1 && a2! <= b2!), `${YENILIK_SURUMU} > ${surum}`);
  assert.equal(YENILIK_BASLIGI, `${kisa}’te yeni`);
  assert.equal(YENILIK_KAPAT_ETIKETI, 'Tamam');
});

test('içerik: en çok 5 satır; her biri tek, kısa, noktayla biten cümle; kesme işareti ’', () => {
  assert.ok(YENILIKLER.length >= 4 && YENILIKLER.length <= 5, `${YENILIKLER.length} satır`);
  for (const s of YENILIKLER) {
    assert.match(s.metin, /[.]$/, `nokta yok: ${s.metin}`);
    assert.equal((s.metin.match(/[.!?](?:\s|$)/g) ?? []).length, 1, `tek cümle değil: ${s.metin}`);
    assert.ok(s.metin.length <= 120, `uzun satır (${s.metin.length}): ${s.metin}`);
    assert.doesNotMatch(s.metin, /'/, `düz kesme işareti: ${s.metin}`);
    assert.ok(s.ikon, 'simge adı yok');
  }
  assert.equal(new Set(YENILIKLER.map((s) => s.metin)).size, YENILIKLER.length, 'yinelenen satır');
});

test('içerik: 0.14 konuları var (çentik ve dokuz sayfa, gözler, internet ve sayfa okuma, Bağlantılar, belge üretimi)', () => {
  const hepsi = YENILIKLER.map((s) => s.metin).join('\n');
  assert.match(hepsi, /Çentik artık canlı/, 'yaşayan çentik');
  assert.match(hepsi, /dokuz sayfa/, 'dokuz sayfa');
  assert.match(hepsi, /Business mode’da da Developer mode’da da Fuber’in gözleri/, 'gözler, mod adları çevrilmeden');
  assert.doesNotMatch(hepsi, /Tilki|Bukalemun/, '11 Kas: hayvan adı yok');
  assert.match(hepsi, /internette arayabilir/, 'internet');
  assert.match(hepsi, /sayfayı okuyabilir/, 'sayfa okuma');
  assert.match(hepsi, /Bağlantılar’dan/, 'bağlı servisler');
  // Bağlı servislerde yazan adım onaylı (MCP'de yazan araç her seferinde onay; P14 dışı): söz bu kuraldır, "her şeyi yapar" değil.
  assert.match(hepsi, /değişiklik yapan her adım önce onayını ister/);
  // Belge üretimi: üzerine yazma onaylı (R9).
  assert.match(hepsi, /Belge, tablo, sunum ve PDF hazırlar; var olan bir dosyanın üzerine yazmadan önce sorar/);
  assert.doesNotMatch(hepsi, /hiçbir şey|asla|hiç yanlış/i, 'mutlak söz');
  // Eski (0.13) satırları kalmadı: kart bu sürümün yeniliklerini anlatır.
  assert.doesNotMatch(hepsi, /Şeffaf görünüm geri geldi|Dikte artık|Hey Fuber|her temada siyah/, '0.13 satırı');
  // Kokpit G10'un ilk kullanım satırını kart görünürken bastırır (tek sakin öğe); kart Görevler'i anlatmıyor, o satırı yinelemez.
  assert.doesNotMatch(hepsi, /takip ettirebilirsin/);
  // Karakter satırı işaretli (Sade'de düşer); öbürleri işaretsiz.
  assert.deepEqual(YENILIKLER.filter((s) => s.karakter).map((s) => s.ikon), ['parilti']);
});

test('içerik: İş diliyle uyumlu — sağlayıcı, model, beyin, API, anahtar, token, 3B sözü yok', () => {
  const hepsi = `${YENILIK_BASLIGI} ${YENILIKLER.map((s) => s.metin).join(' ')}`;
  assert.doesNotMatch(hepsi, /\bAPI\b|anahtar|\bmodel|bey(?:in|n[aeıiuü])|token|Claude|Anthropic|OpenAI|ElevenLabs|Gemini|\b3B\b|abonelik|fiyat|ücret|motor|Piper|Whisper|llama|Bonsai|Qwen/i);
  assert.equal(isDiliIhlali(hepsi), null, 'İş dili (shared/is-dili.ts)');
});

test('kablolama: kokpit kartı kütüphane bileşenleriyle, tur açıkken gizli; kapatma tek IPC yolundan', () => {
  const kokpit = fs.readFileSync(path.join(kok, 'src/renderer/sayfalar/Kokpit.tsx'), 'utf8');
  assert.match(kokpit, /YenilikKarti/, 'Kokpit.tsx kartı çizmiyor');
  // Kart Görevler'i anlatır: G10'un ilk kullanım satırı aynı cümleyi yinelemez (kart göründüyse ya da ayarlar okunmadıysa satır çizilmez).
  assert.match(kokpit, /gorevHali === 'bos' && yenilik\.hazir && !yenilikGorundu\.current/, 'ilk kullanım satırı kartla çakışıyor');
  const kart = fs.readFileSync(path.join(kok, 'src/renderer/pano/YenilikKarti.tsx'), 'utf8');
  assert.match(kart, /from '\.\.\/ui'/, 'kütüphaneden (Kart, Satir, Dugme) gelmeli');
  assert.match(kart, /yenilik:kapat/, 'kapatma IPC’si');
  assert.match(kart, /yeniKartAcilsinMi/, 'karar saf fonksiyondan');
  assert.doesNotMatch(kart, /<select|style=\{\{[^}]*#[0-9a-f]{3,6}/i, 'yerel select / sabit renk');
  const main = fs.readFileSync(path.join(kok, 'src/renderer/main.tsx'), 'utf8');
  assert.match(main, /turAcik=\{tanitim\}/, 'tanıtım turu açıkken kart gizli kalmalı');
});
