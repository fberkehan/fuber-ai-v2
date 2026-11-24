// Gündem bandı (Görev 24): bugün bekleyenler (hatırlatıcı, toplantı e-postası, son tarihli iş, hedefli mesele); bugün yoksa sıradaki
// 7 gün; o da yoksa 'bos' (arayüz günün özetini gösterir). src/shared/gundem.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gundemOgeleri, geceGelenler, gunIlerlemesi, haftaNumarasi, TOPLANTI_RE } from '../src/shared/gundem.ts';
import type { KokpitVerisi } from '../src/shared/tipler.ts';

const simdi = new Date(2026, 9, 25, 10, 0, 0).getTime(); // yerel 25 Ekim 10:00
const iso = (saat: number, gun = 0) => new Date(2026, 9, 25 + gun, saat, 0, 0).toISOString();
const bos = (): Pick<KokpitVerisi, 'hatirlaticilar' | 'gorevler' | 'epostalar'> & { dusunme: Pick<KokpitVerisi['dusunme'], 'meseleler'> } =>
  ({ hatirlaticilar: [], gorevler: [], epostalar: [], dusunme: { meseleler: [] } });

test('bugün: geciken önce, sonra saate göre; e-posta toplantıları zamanlı işlerden sonra; geçmiş/bildirilmiş hatırlatıcı yok', () => {
  const v = bos();
  v.hatirlaticilar = [
    { id: 1, baslik: 'Öğleden sonra arama', zaman: iso(15), tekrar: 'yok', durum: 'bekliyor', onem: 3 },
    { id: 2, baslik: 'Bildirilmiş', zaman: iso(9), tekrar: 'yok', durum: 'gonderildi', onem: 3 },
    { id: 3, baslik: 'Yarın', zaman: iso(9, 1), tekrar: 'yok', durum: 'bekliyor', onem: 3 },
  ];
  v.gorevler = [{ id: 7, baslik: 'Geciken rapor', durum: 'acik', sonTarih: iso(8), oncelik: 4, proje: 'Mavi Kuş' }, { id: 8, baslik: 'Tarihsiz', durum: 'acik', oncelik: 3 }];
  v.epostalar = [
    { id: 20, hesap: 'İş', kimden: 'Ece <ece@x.example>', konu: 'Perşembe toplantısı', tarih: iso(8), ozet: '', okundu: false, onem: 3 },
    { id: 21, hesap: 'İş', kimden: 'Bülten', konu: 'Haftalık bülten', tarih: iso(8), ozet: 'kampanya', okundu: false, onem: 2 },
    { id: 22, hesap: 'İş', kimden: 'Eski', konu: 'Görüşme daveti', tarih: iso(8, -3), ozet: '', okundu: false, onem: 4 },
    { id: 23, hesap: 'İş', kimden: 'Okundu', konu: 'Zoom call', tarih: iso(7), ozet: '', okundu: true, onem: 2 },
  ];
  v.dusunme.meseleler = [{ id: 30, baslik: 'Ece’ye dönüş', hedef: '2026-10-25', durum: 'acik', ilkGun: '2026-10-20', guncelleme: '' }];
  const g = gundemOgeleri(v, simdi);
  assert.equal(g.kip, 'bugun');
  assert.deepEqual(g.ogeler.map((o) => o.id), ['g:7', 'h:1', 'm:30', 'e:20']);
  assert.equal(g.ogeler[0].gecikti, true);
  assert.equal(g.ogeler[0].alt, 'Mavi Kuş');
  assert.equal(g.ogeler[3].tur, 'toplanti');
  assert.equal(g.ogeler[3].alt, 'e-posta · Ece');
  assert.equal(g.toplam, 4);
});

test('bugün boşsa sıradaki 7 gün; o da boşsa "bos"', () => {
  const v = bos();
  v.hatirlaticilar = [{ id: 1, baslik: 'Haftaya', zaman: iso(9, 3), tekrar: 'yok', durum: 'bekliyor', onem: 3 }, { id: 2, baslik: 'Uzak', zaman: iso(9, 20), tekrar: 'yok', durum: 'bekliyor', onem: 3 }];
  const g = gundemOgeleri(v, simdi);
  assert.equal(g.kip, 'siradaki');
  assert.deepEqual(g.ogeler.map((o) => o.id), ['h:1']);
  assert.deepEqual(gundemOgeleri(bos(), simdi), { kip: 'bos', ogeler: [], toplam: 0 });
});

test('toplantı sözcükleri; gün ilerlemesi; ISO hafta', () => {
  for (const m of ['Toplantı daveti', 'Yarınki görüşme', 'Meeting invite', 'Zoom: haftalık', 'Google Meet bağlantısı', 'Teams toplantısı', 'Randevu onayı', 'Webinar kaydı', 'Re: Davetiye']) assert.match(m, TOPLANTI_RE, m);
  // Sözcük içinde geçenler toplantı sayılmaz (düzeltme turu 1: desen sözcük başına bağlandı).
  for (const m of ['Fatura hazır', 'Kampanya', 'Recall notice', 'Sunum dosyası', 'Takvim güncellemesi', 'Call center', 'Zoomlama ipuçları', 'Teams çağrısı ücreti', 'Antoplantılar']) {
    assert.doesNotMatch(m, TOPLANTI_RE, m);
  }
  assert.equal(gunIlerlemesi(new Date(2026, 9, 25, 12, 0, 0).getTime()), 0.5);
  assert.equal(haftaNumarasi(new Date(2026, 9, 25, 12).getTime()), 43);
  assert.equal(haftaNumarasi(new Date(2026, 0, 1, 12).getTime()), 1);
});

// 0.13 T15 (Spec I, "Gece ne değişti"): kokpit gündemine gece gelen e-posta ve mesaj sayısı. Gece = en son başlayan sessiz saat aralığı
// (gece yarısını aşabilir); aralığın içindeki zamanlar sayılır, gündüz gelenler sayılmaz.
test('geceGelenler: sessiz saat içinde gelenler sayılır, gündüz gelenler sayılmaz', () => {
  const sabah = new Date(2026, 9, 25, 9, 0, 0).getTime(); // 25 Ekim 09:00; gece = 24 Ekim 23:00 – 25 Ekim 08:00
  const z = (gun: number, s: number, d = 0) => ({ zaman: new Date(2026, 9, gun, s, d, 0).toISOString() });
  const olaylar = [z(24, 22, 59), z(24, 23, 0), z(25, 2, 30), z(25, 7, 59), z(25, 8, 0), z(25, 8, 30), z(24, 14)];
  assert.equal(geceGelenler(sabah, { bas: '23:00', bit: '08:00' }, olaylar), 4, '23:00 ile 08:00 dahil; 22:59, 08:30 ve gündüz dışarıda');
  assert.equal(geceGelenler(sabah, { bas: '23:00', bit: '08:00' }, []), 0);
});

test('geceGelenler: gece sürerken şimdiye kadar olanlar; gece yarısını aşmayan aralık; geçersiz ya da boş aralık 0', () => {
  const geceYarisi = new Date(2026, 9, 25, 1, 0, 0).getTime();
  const z = (gun: number, s: number) => ({ zaman: new Date(2026, 9, gun, s, 0, 0).toISOString() });
  assert.equal(geceGelenler(geceYarisi, { bas: '23:00', bit: '08:00' }, [z(24, 23), z(25, 0), z(25, 3)]), 2, 'gelecekteki (03:00) sayılmaz');
  // 01:00–05:00 gibi gece yarısını aşmayan aralık; saat 14:00'te en son aralık bugünkü 01:00–05:00.
  const ogle = new Date(2026, 9, 25, 14, 0, 0).getTime();
  assert.equal(geceGelenler(ogle, { bas: '01:00', bit: '05:00' }, [z(25, 0), z(25, 1), z(25, 4), z(25, 6), z(24, 2)]), 2);
  assert.equal(geceGelenler(ogle, { bas: '23:00', bit: '23:00' }, [z(25, 3)]), 0, 'başlangıç = bitiş: aralık yok');
  assert.equal(geceGelenler(ogle, { bas: 'bozuk', bit: '08:00' }, [z(25, 3)]), 0);
  assert.equal(geceGelenler(ogle, { bas: '23:00', bit: '08:00' }, [{ zaman: 'bozuk' }]), 0);
});
