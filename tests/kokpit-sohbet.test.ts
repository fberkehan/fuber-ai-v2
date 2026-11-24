// 0.11 G7: kokpitin sohbet paneli birden çok sohbeti taşır (eskiden ana sayfada tek sohbet kalıyordu). Saf seçim mantığı
// (src/shared/kokpit-sohbet.ts): açılışta hangi sohbet gösterilir, açılır listede kimler görünür, "Ana sohbette N yeni mesaj" çipinin
// metni. Son seçim `localStorage`da değil ayarda durur (`kokpit.sonSohbet`) ve telefondan yazılamaz (izin listesi: uzakAyarSuz).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acikOkunmusSay, acilirListe, anaYeniMesajMetni, anaYeniSayisi, gecerliSecim, KOKPIT_SON_SOHBET_SAYISI, kokpitSohbeti, secimBasligi, siraliIstekler, type KokpitSecimi,
} from '../src/shared/kokpit-sohbet.ts';
import type { SohbetOzet } from '../src/shared/tipler.ts';

const ANA = 1;
let zaman = 0;
/** Güncelleme zamanı artan sırayla verilir: büyük `n` daha yeni. */
const sohbet = (id: number, ek: Partial<SohbetOzet> = {}): SohbetOzet => ({
  id, baslik: `Sohbet ${id}`, tur: id === ANA ? 'ana' : 'normal', guncelleme: new Date(Date.UTC(2026, 9, 28, 8, 0, 0) + (zaman += 60_000)).toISOString(), okunmamis: 0, ...ek,
});
const liste = (...idler: number[]) => idler.map((i) => sohbet(i));

// ── Step 1: kokpitSohbeti — dört durum ──

test('G7: ana sohbette okunmamış mesaj varsa ana gösterilir (son seçilen sohbet olsa bile)', () => {
  const l = liste(ANA, 5, 6);
  assert.equal(kokpitSohbeti({ anaId: ANA, sonSecilen: 5, anaOkunmamis: 2, liste: l }), ANA);
  assert.equal(kokpitSohbeti({ anaId: ANA, sonSecilen: null, anaOkunmamis: 1, liste: l }), ANA);
});

test('G7: okunmamış yoksa son seçilen sohbet hâlâ listedeyse o gösterilir', () => {
  const l = liste(ANA, 5, 6, 7);
  assert.equal(kokpitSohbeti({ anaId: ANA, sonSecilen: 6, anaOkunmamis: 0, liste: l }), 6);
  // Ana sohbet de bir seçimdir (kullanıcı ana sohbeti seçmiş olabilir).
  assert.equal(kokpitSohbeti({ anaId: ANA, sonSecilen: ANA, anaOkunmamis: 0, liste: l }), ANA);
});

test('G7: son seçilen sohbet silinmiş ya da arşivlenmişse (listede yok) ana gösterilir', () => {
  const l = liste(ANA, 5, 7); // 6 arşivlendi: sohbet:liste arşivdekileri vermez
  assert.equal(kokpitSohbeti({ anaId: ANA, sonSecilen: 6, anaOkunmamis: 0, liste: l }), ANA);
  assert.equal(kokpitSohbeti({ anaId: ANA, sonSecilen: 6, anaOkunmamis: 0, liste: [] }), ANA);
});

test('G7: ilk açılışta (son seçim yok) ana gösterilir; bozuk kayıt da ana demektir', () => {
  const l = liste(ANA, 5);
  assert.equal(kokpitSohbeti({ anaId: ANA, sonSecilen: null, anaOkunmamis: 0, liste: l }), ANA);
  // Ayar dosyası elle bozulmuşsa (sayı olmayan, kesirli) yok sayılır.
  for (const bozuk of ['5', 5.5, Number.NaN, {}, [5]]) assert.equal(kokpitSohbeti({ anaId: ANA, sonSecilen: bozuk as unknown as number, anaOkunmamis: 0, liste: l }), ANA, String(bozuk));
});

// ── Açılır liste: Ana sohbet her zaman ilk, ardından en çok 8 son sohbet; arşivdekiler hiç gelmez ──

test('G7: açılır listede ana ayrıdır; son sohbetler yeniden eskiye, ana tekrarlanmaz, en çok 8', () => {
  const l = [sohbet(ANA), ...Array.from({ length: 12 }, (_, i) => sohbet(10 + i))];
  const a = acilirListe(l, ANA);
  assert.equal(a.ana?.id, ANA);
  assert.equal(KOKPIT_SON_SOHBET_SAYISI, 8);
  assert.equal(a.son.length, 8);
  assert.ok(a.son.every((s) => s.id !== ANA), 'ana, son sohbetlerde tekrarlanmaz');
  assert.deepEqual(a.son.map((s) => s.id), [21, 20, 19, 18, 17, 16, 15, 14], 'en yeni önce');
});

test('G7: sohbet yoksa ya da ana listede değilse açılır liste boş kalmaz, patlamaz', () => {
  assert.deepEqual(acilirListe([], ANA), { ana: null, son: [] });
  assert.deepEqual(acilirListe(liste(5, 6), ANA).son.map((s) => s.id), [6, 5]);
  assert.equal(acilirListe(liste(5, 6), ANA).ana, null);
});

test('G7: "Ana sohbette N yeni mesaj" çipi gerçek sayıyı söyler', () => {
  assert.equal(anaYeniMesajMetni(1), 'Ana sohbette 1 yeni mesaj');
  assert.equal(anaYeniMesajMetni(3), 'Ana sohbette 3 yeni mesaj');
});

// ── Düzeltme turu 1 (Ö1): okunmamış çipi bayat sayıyla geri gelmesin ──
// Panelde açık sohbet okunuyor sayılır (Sohbet açılınca ana süreçte okunmamış sıfırlanır; bunun olayı yok → renderer'daki liste bayat kalırdı).

test('G7 düzeltme: açık sohbetin okunmamışı sıfırlanır, ötekilere ve sıraya dokunulmaz', () => {
  const l = [sohbet(ANA, { okunmamis: 3 }), sohbet(5, { okunmamis: 2 }), sohbet(6, { okunmamis: 1 })];
  const a = acikOkunmusSay(l, ANA);
  assert.deepEqual(a.map((s) => [s.id, s.okunmamis]), [[ANA, 0], [5, 2], [6, 1]]);
  assert.equal(l[0].okunmamis, 3, 'girdi değişmez');
  assert.equal(a[1], l[1], 'dokunulmayan satır aynı nesne');
  assert.deepEqual(acikOkunmusSay(l, 6).map((s) => s.okunmamis), [3, 2, 0]);
  // Açık sohbet yok (taslak/belirlenmemiş) ya da listede değil: liste aynen.
  assert.equal(acikOkunmusSay(l, null), l);
  assert.equal(acikOkunmusSay(l, 99), l);
});

test('G7 düzeltme (tur 2): ilk yükleme yarışı — seçim kararı, listeyi yazan başka bir tazelemeden SONRA verilse de bayat sayı kalmaz', () => {
  // Olay güdümlü tazeleme (seçim henüz belli değil → hiçbir sohbet sıfırlanmadı) önce yazıldı; ilk yükleme yanıtı atıldı. Karar (ana) verilince
  // listeye koşulsuz uygulanan `acikOkunmusSay` ana'nın okunmamışını siler; çip de geri gelmez.
  const tazelemeninListesi = acikOkunmusSay([sohbet(ANA, { okunmamis: 2 }), sohbet(5)], null);
  assert.equal(tazelemeninListesi[0].okunmamis, 2, 'karar öncesi sıfırlanmadı');
  const kararSonrasi = acikOkunmusSay(tazelemeninListesi, ANA);
  assert.equal(kararSonrasi[0].okunmamis, 0);
  assert.equal(anaYeniSayisi({ secim: 'yeni', anaId: ANA, liste: kararSonrasi }), 0);
  // Karar bir sohbetse (taslak ya da belirsiz değil) o sıfırlanır; taslak kararında (Ctrl+N) liste aynen.
  assert.equal(acikOkunmusSay(tazelemeninListesi, 5)[0].okunmamis, 2);
  assert.equal(acikOkunmusSay(tazelemeninListesi, null), tazelemeninListesi);
});

test('G7 düzeltme: çip sayısı — yalnız panel ana sohbette DEĞİLKEN ana\'nın okunmamışı', () => {
  const l = [sohbet(ANA, { okunmamis: 2 }), sohbet(5)];
  assert.equal(anaYeniSayisi({ secim: 5, anaId: ANA, liste: l }), 2);
  assert.equal(anaYeniSayisi({ secim: 'yeni', anaId: ANA, liste: l }), 2, 'taslakta da ana\'ya gelen mesaj bildirilir');
  assert.equal(anaYeniSayisi({ secim: ANA, anaId: ANA, liste: l }), 0);
  assert.equal(anaYeniSayisi({ secim: null, anaId: ANA, liste: l }), 0, 'açılış kararı verilmedi');
  assert.equal(anaYeniSayisi({ secim: 5, anaId: null, liste: l }), 0);
  assert.equal(anaYeniSayisi({ secim: 5, anaId: 77, liste: l }), 0, 'ana listede yok');
});

test('G7 düzeltme (Ö1 a): çipe tıkla → "Yeni sohbet" → çip yok (liste bayat kalmaz)', () => {
  let secim: KokpitSecimi = 5;
  let l = [sohbet(ANA, { okunmamis: 2 }), sohbet(5)];
  assert.equal(anaYeniSayisi({ secim, anaId: ANA, liste: l }), 2, 'çip görünür');
  secim = ANA; l = acikOkunmusSay(l, ANA); // çipe tıklandı: sec(ana) listeyi iyimser sıfırlar
  secim = 'yeni'; // Yeni sohbet / Ctrl+N
  assert.equal(anaYeniSayisi({ secim, anaId: ANA, liste: l }), 0, 'çip geri gelmemeli');
});

test('G7 düzeltme (Ö1 b): panel anadayken proaktif mesaj gelir (yarışta bayat okunmamış) → "Yeni sohbet" → çip yok', () => {
  // `sohbet:liste` `sohbet:okundu`dan ÖNCE yanıtladı: ana.okunmamis = 1; liste yazılırken açık sohbet (ana) sıfırlanır.
  const gelen = [sohbet(ANA, { okunmamis: 1 }), sohbet(5)];
  const l = acikOkunmusSay(gelen, ANA);
  assert.equal(anaYeniSayisi({ secim: 'yeni', anaId: ANA, liste: l }), 0);
  assert.equal(anaYeniSayisi({ secim: 5, anaId: ANA, liste: l }), 0);
});

// ── Düzeltme turu 1 (K5): seçili sohbet listede yoksa ──

test('G7 düzeltme: liste başarıyla geldi ve seçili sohbet yok (arşivlendi/silindi) → ana; ana, taslak ve belirlenmemiş olduğu gibi', () => {
  const l = liste(ANA, 5, 7);
  assert.equal(gecerliSecim(6, { anaId: ANA, liste: l }), ANA);
  assert.equal(gecerliSecim(5, { anaId: ANA, liste: l }), 5);
  assert.equal(gecerliSecim(ANA, { anaId: ANA, liste: [] }), ANA, 'ana hiçbir zaman düşmez');
  assert.equal(gecerliSecim('yeni', { anaId: ANA, liste: l }), 'yeni');
  assert.equal(gecerliSecim(null, { anaId: ANA, liste: l }), null);
});

test('G7 düzeltme: başlık — taslak "Yeni sohbet", ana "Ana sohbet", kayıtlı sohbet başlığı; bilinmiyorsa nötr "Sohbet" (asla "Yeni sohbet" değil)', () => {
  const l = [sohbet(ANA), sohbet(5, { baslik: 'Berlin seyahati' })];
  assert.equal(secimBasligi('yeni', { anaId: ANA, liste: l }), 'Yeni sohbet');
  assert.equal(secimBasligi(ANA, { anaId: ANA, liste: l }), 'Ana sohbet');
  assert.equal(secimBasligi(null, { anaId: ANA, liste: l }), 'Ana sohbet');
  assert.equal(secimBasligi(5, { anaId: ANA, liste: l }), 'Berlin seyahati');
  assert.equal(secimBasligi(9, { anaId: ANA, liste: l }), 'Sohbet', 'liste alınamadı ya da sohbet yok: nötr');
  assert.equal(secimBasligi(5, { anaId: ANA, liste: [sohbet(5, { baslik: '' })] }), 'Sohbet', 'boş başlık da nötr');
});

// ── Düzeltme turu 1 (K10): sıra dışı liste yanıtı uygulanmaz ──

test('G7 düzeltme: siraliIstekler — eski numaralı yanıt, daha yenisi uygulandıktan sonra atılır', () => {
  const s = siraliIstekler();
  const bir = s.al(), iki = s.al();
  assert.deepEqual([bir, iki], [1, 2]);
  assert.equal(s.uygula(iki), true, 'yeni istek önce döndü: uygulanır');
  assert.equal(s.uygula(bir), false, 'eski istek sonra döndü: atılır');
  const uc = s.al();
  assert.equal(s.uygula(uc), true);
  // Sırayla dönenler hep uygulanır.
  const t = siraliIstekler();
  const a = t.al(), b = t.al();
  assert.equal(t.uygula(a), true);
  assert.equal(t.uygula(b), true);
});
