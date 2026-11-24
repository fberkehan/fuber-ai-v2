// Kokpit planlayıcısı bulut yolunda Gizli mod kayıtlarını görmez (Görev 21 düzeltme turu 2): bugünün önemlileri, son rapor ve açık
// meseleler süzülür; arayüzün verisi (yerel) değişmez.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kokpitGizlisiz, gizliRaporNotu } from '../src/shared/gizli-suzgec.ts';
import { AYAR_TANIMLARI } from '../src/renderer/ayarlar/dizin.ts';
import { isDiliIhlali } from '../src/shared/is-dili.ts';
import type { KokpitVerisi } from '../src/shared/tipler.ts';

test('düzeltme turu 4 (B): Gizli rapor korunduğunda tek satır — nerede hazırlandığı, iş dili, model/sağlayıcı adı yok', () => {
  assert.equal(gizliRaporNotu('gunluk'), 'Bu günün raporu Gizli modda yerel olarak hazırlandı.');
  assert.match(gizliRaporNotu('haftalik'), /^Bu haftanın raporu Gizli modda/);
  assert.match(gizliRaporNotu('aylik'), /^Bu ayın raporu Gizli modda/);
  for (const t of ['gunluk', 'haftalik', 'aylik'] as const) assert.equal(isDiliIhlali(gizliRaporNotu(t)), null);
});

test('düzeltme turu 4 (C): Gizli mod açıklaması nota çevrilemeyen satırların bu bilgisayarda kalıp saklama süresinde silindiğini söyler (iki modda)', () => {
  const a = AYAR_TANIMLARI.get('gizli-mod');
  assert.ok(a, 'gizli-mod ayarı yok');
  // 0.10 Görev 3 (P2): İş'te "Gizli gün kaydı satırları" → "Gizli moddayken alınan notlar"; Geliştirici'de teknik ad kalır.
  assert.match(a.aciklama ?? '', /nota çevrilemeyen Gizli gün kaydı satırları bu bilgisayarda tutulur ve saklama süresi dolunca silinir/);
  assert.match(a.aciklamaIs ?? '', /işlenemeyen, Gizli moddayken alınan notlar bu bilgisayarda tutulur ve saklama süresi dolunca silinir/);
  assert.equal(isDiliIhlali(a.aciklamaIs ?? ''), null);
});

test('bulut planlayıcısının verisinde Gizli not, rapor ve mesele yok; öteki alanlar ve özgün veri aynı', () => {
  const madde = (id: number, gizli?: boolean) => ({ id, gun: '2026-10-25', zaman: '', metin: gizli ? 'GIZLI' : 'açık', onem: 'onemli' as const, kisiler: [], eglenceli: false, satirlar: '', silinme: '', ...(gizli ? { gizli } : {}) });
  const mesele = (id: number, gizli?: boolean) => ({ id, baslik: gizli ? 'GIZLI mesele' : 'mesele', ilkGun: '2026-10-25', durum: 'acik' as const, guncelleme: '', ...(gizli ? { gizli } : {}) });
  const v = {
    hatirlaticilar: [], gorevler: [], oneriler: [], epostalar: [], whatsapp: [], sohbetler: [], projeler: [], hafiza: [], ozelKartlar: [],
    iceAktarma: { bekleyen: 0, islenen: 0, hata: 0 }, zihin: { durum: 'bos', hafizaSayisi: 0, bagliMotorlar: [] },
    dusunme: {
      durum: { etkin: true } as KokpitVerisi['dusunme']['durum'],
      bugunOnemli: [madde(1), madde(2, true), madde(3)],
      sonRapor: { id: 9, tur: 'gunluk', donem: '2026-10-25', baslik: 'GIZLI rapor', ozet: '', onemli: [], onemsiz: [], kararlar: [], acikMeseleler: [], ileriye: [], maddeSayisi: 1, olusturma: '', guncelleme: '', gizli: true },
      meseleler: [mesele(5, true), mesele(6)],
    },
  } as unknown as KokpitVerisi;
  const b = kokpitGizlisiz(v);
  assert.deepEqual(b.dusunme.bugunOnemli.map((m) => m.id), [1, 3]);
  assert.equal(b.dusunme.sonRapor, undefined);
  assert.deepEqual(b.dusunme.meseleler.map((m) => m.id), [6]);
  assert.ok(!JSON.stringify(b).includes('GIZLI'));
  assert.equal(v.dusunme.bugunOnemli.length, 3, 'arayüzün verisi değişmez');
  const acikRapor = { ...v, dusunme: { ...v.dusunme, sonRapor: { ...v.dusunme.sonRapor!, gizli: undefined } } } as KokpitVerisi;
  assert.equal(kokpitGizlisiz(acikRapor).dusunme.sonRapor?.id, 9);
});
