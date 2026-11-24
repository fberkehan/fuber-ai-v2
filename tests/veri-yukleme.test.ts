// 0.11 G8 (G2 incelemesi Kü-1): Ayarlar → Veri önce SAYIYI (hızlı çağrı), sonra BOYUTU (ayrı, sınırlı tarama) alır. Tarama sürerken
// satır "Yedek yok." DEMEZ (nötr yükleniyor hâli — G3 Iskelet), onay kutusu sayı gelene dek beklemez, sınıra takılan boyut "en az ≈N GB"
// der (`boyutTam: false`). Saf mantık: shared/veri-islemi.ts (Veri.tsx yalnız çizer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boyutMetni, yerelSecenegi, yedekSatiri, yedekSilListesi, yerelSecenegiDurumu, kaldirDurumu, KALDIR_GELISTIRME, KALDIR_DURUM_YOK, YEDEK_DENETLENEMEDI,
  BOYUT_BILINMIYOR, type VeriDurumu,
} from '../src/shared/veri-islemi.ts';
import { isDiliIhlali } from '../src/shared/is-dili.ts';

const TEMEL: VeriDurumu = {
  yenidenKurulum: false, hafiza: 10, sohbet: 2, sonKullanim: null, hesapEposta: null,
  yedekSayisi: 0, yedekBayt: null, yerelBayt: null, boyutTam: true, kaldirilabilir: true,
};
/** Hızlı ilk çağrının yanıtı (sayılar var, boyutlar null) ve ikinci çağrının yanıtı (boyutlar da var). */
const SAYI_GELDI = (yedekSayisi: number): VeriDurumu => ({ ...TEMEL, yedekSayisi });
const BOYUT_GELDI = (yedekSayisi: number, yedekBayt: number, yerelBayt: number, boyutTam = true): VeriDurumu => ({ ...SAYI_GELDI(yedekSayisi), yedekBayt, yerelBayt, boyutTam });

test('boyut metni: tam taramada ≈N; sınıra takılınca "en az ≈N" (GB ve MB)', () => {
  assert.equal(boyutMetni(1.9e9), '≈1,9 GB');
  assert.equal(boyutMetni(350e6), '≈350 MB');
  assert.equal(boyutMetni(1.9e9, false), 'en az ≈1,9 GB');
  assert.equal(boyutMetni(350e6, false), 'en az ≈350 MB');
  assert.equal(boyutMetni(10, false), 'en az ≈1 MB', 'en az 1 MB');
  assert.equal(yerelSecenegi(4.2e9), 'İndirilen yapay zekâ da silinsin (≈4,2 GB)');
  assert.equal(yerelSecenegi(4.2e9, false), 'İndirilen yapay zekâ da silinsin (en az ≈4,2 GB)');
});

test('yedek satırı: tarama sürerken ASLA "Yedek yok." değil (nötr yükleniyor); sayı gelince gerçek hâl', () => {
  const bekle = yedekSatiri(null);
  assert.deepEqual([bekle.yukleniyor, bekle.dugme], [true, false]);
  assert.doesNotMatch(bekle.aciklama, /Yedek yok/);
  // Sayı geldi, boyut taranıyor: sayı hemen görünür, boyut sonradan eklenir; düğme hemen çalışır.
  const sayiVar = yedekSatiri(SAYI_GELDI(3));
  assert.deepEqual([sayiVar.yukleniyor, sayiVar.dugme], [false, true]);
  assert.match(sayiVar.aciklama, /^3 yedek — /);
  assert.doesNotMatch(sayiVar.aciklama, /GB|MB|en az/);
  // Boyut da geldi.
  assert.match(yedekSatiri(BOYUT_GELDI(3, 1.9e9, 0)).aciklama, /^3 yedek · ≈1,9 GB — /);
  // Sınıra takıldı: "en az".
  assert.match(yedekSatiri(BOYUT_GELDI(3, 1.9e9, 0, false)).aciklama, /^3 yedek · en az ≈1,9 GB — /);
  // Yedek gerçekten yok: sayı kesin (hızlı çağrı), boyutu beklemeye gerek yok.
  const yok = yedekSatiri(SAYI_GELDI(0));
  assert.deepEqual([yok.yukleniyor, yok.aciklama, yok.dugme], [false, 'Yedek yok.', false]);
  assert.equal(yedekSatiri(BOYUT_GELDI(0, 0, 0)).aciklama, 'Yedek yok.');
});

test('yedekleri silme onayının listesi: sayı hemen, boyut varsa yanında ("en az" dahil)', () => {
  assert.deepEqual(yedekSilListesi(SAYI_GELDI(2)), ['2 yedek klasörü']);
  assert.deepEqual(yedekSilListesi(BOYUT_GELDI(2, 600e6, 0)), ['2 yedek klasörü (≈600 MB)']);
  assert.deepEqual(yedekSilListesi(BOYUT_GELDI(2, 600e6, 0, false)), ['2 yedek klasörü (en az ≈600 MB)']);
});

test('"İndirilen yapay zekâ da silinsin" seçeneği: boyut gelene dek beklemede (yükleniyor), sonra yoksa hiç, varsa etiketle', () => {
  assert.deepEqual(yerelSecenegiDurumu(null), { durum: 'bekliyor' });
  assert.deepEqual(yerelSecenegiDurumu(SAYI_GELDI(1)), { durum: 'bekliyor' }, 'boyut henüz yok: "yok" denmez');
  assert.deepEqual(yerelSecenegiDurumu(BOYUT_GELDI(1, 0, 0)), { durum: 'yok' });
  assert.deepEqual(yerelSecenegiDurumu(BOYUT_GELDI(1, 0, 4.2e9)), { durum: 'var', etiket: 'İndirilen yapay zekâ da silinsin (≈4,2 GB)' });
  assert.deepEqual(yerelSecenegiDurumu(BOYUT_GELDI(1, 0, 4.2e9, false)), { durum: 'var', etiket: 'İndirilen yapay zekâ da silinsin (en az ≈4,2 GB)' });
});

// ── 0.11 G8 düzeltme turu 1 (K6): hata kenarları — sonsuz Iskelet ve sessiz kapalı düğme yok ──
test('K6: boyut çağrısı düşerse "boyutu bilinmiyor" (seçenek yine sunulur, varsayılan kapalı); sayı yeter', () => {
  // Boyut hâlâ taranıyorsa (hata yok) bugünkü: bekliyor.
  assert.deepEqual(yerelSecenegiDurumu(SAYI_GELDI(1)), { durum: 'bekliyor' });
  assert.deepEqual(yerelSecenegiDurumu(SAYI_GELDI(1), false), { durum: 'bekliyor' });
  // Boyut çağrısı düştü: sonsuz Iskelet yok; ne olduğu bilinmediğinden seçenek sunulur.
  assert.deepEqual(yerelSecenegiDurumu(SAYI_GELDI(1), true), { durum: 'var', etiket: 'İndirilen yapay zekâ da silinsin (boyutu bilinmiyor)' });
  assert.equal(BOYUT_BILINMIYOR, 'boyutu bilinmiyor');
  // Sayı çağrısı düştü (d hiç gelmedi): boyut çağrısı yapılmaz; onay kutusundaki seçenek yine sonsuz Iskelet olmaz.
  assert.deepEqual(yerelSecenegiDurumu(null, true), { durum: 'var', etiket: 'İndirilen yapay zekâ da silinsin (boyutu bilinmiyor)' });
  assert.deepEqual(yerelSecenegiDurumu(null, false), { durum: 'bekliyor' }, 'hata yokken yükleniyor');
  // Boyut zaten geldiyse hata bayrağı hiçbir şeyi değiştirmez.
  assert.deepEqual(yerelSecenegiDurumu(BOYUT_GELDI(1, 0, 4.2e9), true), yerelSecenegiDurumu(BOYUT_GELDI(1, 0, 4.2e9)));
  assert.deepEqual(yerelSecenegiDurumu(BOYUT_GELDI(1, 0, 0), true), { durum: 'yok' });
  // Yedek satırı: sayı hemen, boyut yerine "boyutu bilinmiyor".
  const y = yedekSatiri(SAYI_GELDI(3), true);
  assert.match(y.aciklama, /^3 yedek · boyutu bilinmiyor — /);
  assert.equal(y.yukleniyor, false);
  assert.equal(y.dugme, true);
  assert.match(yedekSatiri(SAYI_GELDI(3), false).aciklama, /^3 yedek — /, 'hata yokken boyut sessizce beklenir');
  assert.equal(yedekSatiri(SAYI_GELDI(0), true).aciklama, 'Yedek yok.');
  assert.deepEqual(yedekSilListesi(SAYI_GELDI(3)), ['3 yedek klasörü']);
  for (const m of [BOYUT_BILINMIYOR, y.aciklama, yerelSecenegiDurumu(SAYI_GELDI(1), true).etiket ?? '']) assert.equal(isDiliIhlali(m), null, m);
});

test('K6: "Kaldır" düğmesi — sayı çağrısı düşerse kapalı ve NEDENİ söyler; yüklenirken kapalı (neden yok); geliştirme kopyasında nedeni söyler; kurulu uygulamada açık', () => {
  assert.deepEqual(kaldirDurumu(null, true), { kapali: true, neden: 'Kurulum durumu okunamadı; sayfayı yeniden açınca denenir.' });
  assert.equal(KALDIR_DURUM_YOK, 'Kurulum durumu okunamadı; sayfayı yeniden açınca denenir.');
  assert.deepEqual(kaldirDurumu(null), { kapali: true }, 'yükleniyor: kısa süre kapalı, yanlış neden yazılmaz');
  assert.deepEqual(kaldirDurumu({ kaldirilabilir: false }), { kapali: true, neden: KALDIR_GELISTIRME });
  assert.deepEqual(kaldirDurumu({ kaldirilabilir: true }), { kapali: false });
  assert.deepEqual(kaldirDurumu({ kaldirilabilir: true }, false), { kapali: false });
  assert.equal(YEDEK_DENETLENEMEDI, 'Yedekler denetlenemedi; sayfayı yeniden açınca denenir.');
  for (const m of [KALDIR_DURUM_YOK, YEDEK_DENETLENEMEDI, KALDIR_GELISTIRME]) assert.equal(isDiliIhlali(m), null, m);
});

test('K5: kullanılmayan dışa aktarma yok — veriAsamasi kaldırıldı', async () => {
  const m = await import('../src/shared/veri-islemi.ts') as Record<string, unknown>;
  assert.equal(m.veriAsamasi, undefined);
});
