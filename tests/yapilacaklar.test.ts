// 0.11 G4 — Yapılacaklar (checklist). İşaretlenen madde hemen siliniyordu: üstü çizilmeli, ertesi gün
// silinebilir, ama işin bittiği hafızada kalmalı.
//  · işaretlenen madde silinmez: kokpit listesinde `durum: 'tamam'` olarak (açıklardan sonra, tamamlanma sırasıyla) kalır;
//  · aynı yerel gün içinde işaret kaldırılırsa geri gelir; ertesi gün karttan kalkar ve geri alma yok sayılır;
//  · ertesi günün (ya da açılışın) ilk tiki dünün tamamlananlarını TEK hafıza kaydına yazar (gün başına bir kez; atlanan günler ayrı kayıt);
//  · Gizli açıkken tamamlanan madde hafızaya girmez (hafıza bulut bağlamına girer);
//  · gorev_listele {durum:'tamam'} bugün tamamlananları verir.
// GERÇEK planlama.ts / hafiza/depo.ts / ajan araçları / ipc.ts; Electron sahte, veri geçici (tests/yardimci/ana-surec.ts). Saat node:test
// MockTimers (Date) ile yönetilir; her senaryo kendi ayında geçer (gün dönümü 14 gün geriye bakar: senaryolar birbirine karışmasın).
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test, mock, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { anaSurecSahnesi, ipcKurBos, ipcIsleyicileri } from './yardimci/ana-surec.ts';
import { kaynakEtiketi } from '../src/shared/hafiza-kaynak.ts';

anaSurecSahnesi('yapilacaklar', { kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', mod: 'is', tanitimSurumu: '0.9.0', ses: { surum: 2, uyandirma: false }, proaktif: { etkin: false }, baslangictaAc: false });
process.env.FUBER_DEMO = '1';
mock.timers.enable({ apis: ['Date'], now: new Date(2026, 9, 27, 10, 0).getTime() });
after(() => mock.timers.reset());
await ipcKurBos();
const plan = await import('../src/main/planlama.ts');
const depo = await import('../src/main/hafiza/depo.ts');
const { meta, veritabani } = await import('../src/main/vt.ts');
const { ayarlariKaydet } = await import('../src/main/ayarlar.ts');
const { temelAraclariKaydet } = await import('../src/main/ajan/araclar/temel.ts');
const { aracBul } = await import('../src/main/ajan/araclar/kayit.ts');
temelAraclariKaydet();

/** Yerel saatle saati kurar; senaryolar Ekim 2026'dan Temmuz 2027'ye sırayla ilerler (ay ≥ 10 → 2026, değilse 2027). */
const saat = (ay: number, gun: number, s = 10, d = 0) => { mock.timers.setTime(new Date(ay >= 10 ? 2026 : 2027, ay - 1, gun, s, d).getTime()); return new Date(); };
const sira = (l: { baslik: string; durum: string }[]) => l.map((g) => `${g.baslik}:${g.durum}`);
/** Önceki senaryodan kalan görevler listeyi karıştırmasın (hafıza kayıtları kalır: senaryolar ayrı aylarda). */
const temizle = () => { veritabani().prepare('DELETE FROM gorevler').run(); };
const kayitlar = () => depo.hafizaListesi({ limit: 200 }).filter((h) => h.baslik.startsWith('Tamamlananlar'));
const baglam = { sohbetId: 1, sinyal: new AbortController().signal, gorevIzinleri: new Set<string>(), onay: async () => 'reddet' as const };
const listele = async (g: Record<string, unknown>) => aracBul('gorev_listele')!.calistir(g, baglam);

test('işaretle → kokpit listesinde durum "tamam" olarak kalır (silinmez), açıklardan sonra gelir; gorevler() açıkları vermeye devam eder', () => {
  saat(10, 27);
  const a = plan.gorevEkle({ baslik: 'Sunumu bitir', oncelik: 4 });
  const b = plan.gorevEkle({ baslik: 'Faturayı öde', oncelik: 3 });
  assert.deepEqual(sira(plan.kokpitYapilacaklari(new Date())), ['Sunumu bitir:acik', 'Faturayı öde:acik']);
  saat(10, 27, 11);
  const g = plan.gorevGuncelle(a.id, { durum: 'tamam' })!;
  assert.equal(g.durum, 'tamam');
  const liste = plan.kokpitYapilacaklari(new Date());
  assert.deepEqual(sira(liste), ['Faturayı öde:acik', 'Sunumu bitir:tamam'], 'açık önce, işaretli en altta; madde silinmedi');
  assert.ok(liste[1].tamamlanma, 'tamamlanma zamanı kartta kullanılır');
  assert.deepEqual(plan.gorevler().map((x) => x.id), [b.id], 'gorevler() değişmedi: yalnız açıklar');
});

test('aynı gün işaret kaldırılırsa madde açıklar arasına döner (tamamlanma silinir)', () => {
  saat(10, 27, 12);
  const a = plan.gorevler({ limit: 5 }).find((g) => g.baslik === 'Faturayı öde')!;
  plan.gorevGuncelle(a.id, { durum: 'tamam' });
  saat(10, 27, 12, 30);
  const geri = plan.gorevGuncelle(a.id, { durum: 'acik' })!;
  assert.equal(geri.durum, 'acik');
  assert.equal(geri.tamamlanma, undefined);
  assert.ok(plan.kokpitYapilacaklari(new Date()).some((g) => g.id === a.id && g.durum === 'acik'));
  assert.ok(plan.gorevler().some((g) => g.id === a.id));
});

test('tamamlananlar tamamlanma sırasıyla (eskiden yeniye) ve açıklar önce; sınır tamamlananı düşürmez', () => {
  temizle(); saat(11, 3, 9);
  const adlar = ['Üçüncü', 'Birinci', 'İkinci'].map((baslik) => plan.gorevEkle({ baslik }));
  plan.gorevEkle({ baslik: 'Hâlâ açık', oncelik: 1 });
  saat(11, 3, 9, 10); plan.gorevGuncelle(adlar[1].id, { durum: 'tamam' }); // Birinci
  saat(11, 3, 9, 20); plan.gorevGuncelle(adlar[2].id, { durum: 'tamam' }); // İkinci
  saat(11, 3, 9, 30); plan.gorevGuncelle(adlar[0].id, { durum: 'tamam' }); // Üçüncü
  assert.deepEqual(sira(plan.kokpitYapilacaklari(new Date())), ['Hâlâ açık:acik', 'Birinci:tamam', 'İkinci:tamam', 'Üçüncü:tamam']);
  // 13 açık iş varken limit 12: işaretlenen madde kesilen açıklar yüzünden yine de kaybolmaz.
  for (let i = 0; i < 13; i++) plan.gorevEkle({ baslik: `Yük ${i}`, oncelik: 5 });
  const l = plan.kokpitYapilacaklari(new Date(), 12);
  assert.equal(l.length, 12);
  assert.ok(l.some((g) => g.baslik === 'Birinci' && g.durum === 'tamam'), 'işaretli madde sınırda da görünür');
  assert.ok(l.filter((g) => g.durum === 'acik').length >= 6, 'açıklar da yer bulur');
});

test('ertesi gün: tamamlanan karttan kalkar; durum "acik" geri alma yalnız aynı yerel günde — sonrası yok sayılır', () => {
  temizle(); saat(11, 10, 23, 50);
  const a = plan.gorevEkle({ baslik: 'Gece işaretlenen' });
  plan.gorevGuncelle(a.id, { durum: 'tamam' });
  assert.ok(plan.kokpitYapilacaklari(new Date()).some((g) => g.id === a.id), 'gün bitmeden listede');
  assert.ok(plan.gorevGuncelle(a.id, { durum: 'acik', baslik: 'Gece işaretlenen (düzeltildi)' })!.durum === 'acik', 'aynı gün geri alınır');
  plan.gorevGuncelle(a.id, { durum: 'tamam' });
  saat(11, 11, 0, 10); // yerel gece yarısını geçti
  assert.ok(!plan.kokpitYapilacaklari(new Date()).some((g) => g.id === a.id), 'ertesi gün tamamlanan listede yok');
  const gecmis = plan.gorevGuncelle(a.id, { durum: 'acik' })!;
  assert.equal(gecmis.durum, 'tamam', 'dünün işaretini kaldırmak yok sayılır');
  assert.ok(!plan.gorevler().some((g) => g.id === a.id));
  const ayniGunDegil = plan.gorevGuncelle(a.id, { baslik: 'Gece işaretlenen (yeniden adlandı)' })!;
  assert.equal(ayniGunDegil.durum, 'tamam');
  assert.equal(ayniGunDegil.baslik, 'Gece işaretlenen (yeniden adlandı)', 'durum dışındaki düzeltmeler yine uygulanır');
});

test('plan:gorev (IPC) aynı imzayla çalışır: işaretler, aynı gün geri alır, ertesi gün geri almayı yok sayar', async () => {
  const h = ipcIsleyicileri().get('plan:gorev')!;
  assert.ok(h, 'plan:gorev kayıtlı');
  temizle(); saat(11, 17, 9);
  const g =plan.gorevEkle({ baslik: 'IPC maddesi' });
  assert.equal(((await h(undefined, g.id, { durum: 'tamam' })) as { durum: string }).durum, 'tamam');
  assert.equal(((await h(undefined, g.id, { durum: 'acik' })) as { durum: string }).durum, 'acik');
  await h(undefined, g.id, { durum: 'tamam' });
  saat(11, 18, 9);
  assert.equal(((await h(undefined, g.id, { durum: 'acik' })) as { durum: string }).durum, 'tamam');
});

test('gunDonumu: ertesi gün dünün tamamlananlarını TEK hafıza kaydına yazar; ikinci çağrı yazmaz; bugünkü işler henüz yazılmaz', () => {
  temizle(); saat(12, 2, 9);
  const a = plan.gorevEkle({ baslik: 'Sunumu bitir' });
  const b = plan.gorevEkle({ baslik: 'Raporu  gönder\nyarına' });
  const c = plan.gorevEkle({ baslik: 'Dokunulmayan' });
  saat(12, 2, 10); plan.gorevGuncelle(a.id, { durum: 'tamam' });
  saat(12, 2, 15); plan.gorevGuncelle(b.id, { durum: 'tamam' });
  const bugun = plan.gunDonumu(saat(12, 2, 22));
  assert.deepEqual(bugun, { yazildi: false }, 'gün bitmeden yazılmaz (işaret kaldırılabilir)');
  assert.equal(kayitlar().length, 0);
  const r = plan.gunDonumu(saat(12, 3, 0, 5));
  assert.deepEqual(r, { yazildi: true, gun: '2026-12-02' });
  const k = kayitlar();
  assert.equal(k.length, 1);
  assert.equal(k[0].tur, 'olay');
  assert.equal(k[0].baslik, 'Tamamlananlar · 2 Ara');
  assert.equal(k[0].icerik, '- Sunumu bitir\n- Raporu gönder yarına', 'madde başına bir satır, tamamlanma sırasıyla; satır sonları tek satıra iner');
  assert.deepEqual(k[0].etiketler, ['yapildi']);
  assert.ok(meta('yapildi-kaydi:2026-12-02'), 'gün anahtarı yazıldı');
  assert.equal(meta('yapildi-kaydi:2026-12-03'), undefined);
  assert.deepEqual(plan.gunDonumu(saat(12, 3, 0, 6)), { yazildi: false }, 'ikinci çağrı yazmaz');
  assert.deepEqual(plan.gunDonumu(saat(12, 3, 9)), { yazildi: false });
  assert.equal(kayitlar().length, 1, 'gün başına tek kayıt');
  assert.ok(c.id > 0);
  // Kayıt aranabilir: "dün ne yaptım" bu kaydı bulur.
  assert.ok(depo.hafizaAra({ sorgu: 'tamamlananlar sunum', limit: 5 }).some((h) => h.baslik === 'Tamamlananlar · 2 Ara'));
});

test('iki gün atlanmışsa (uygulama kapalıydı) iki ayrı gün kaydı yazılır; hiç tamamlanan yoksa kayıt yok', () => {
  temizle(); saat(1, 5, 9);
  const x = plan.gorevEkle({ baslik: 'Birinci gün' });
  const y = plan.gorevEkle({ baslik: 'İkinci gün' });
  saat(1, 5, 12); plan.gorevGuncelle(x.id, { durum: 'tamam' });
  saat(1, 7, 12); plan.gorevGuncelle(y.id, { durum: 'tamam' });
  const onceki = kayitlar().length;
  const r = plan.gunDonumu(saat(1, 9, 8)); // 6 ve 8 Ocak'ta uygulama hiç açılmadı
  assert.deepEqual(r, { yazildi: true, gun: '2027-01-07' }, 'dönen gün: yazılan son gün');
  const yeni = kayitlar().filter((h) => / Oca$/.test(h.baslik));
  assert.equal(kayitlar().length - onceki, 2, 'iki ayrı gün kaydı');
  assert.deepEqual(yeni.map((h) => h.baslik).sort(), ['Tamamlananlar · 5 Oca', 'Tamamlananlar · 7 Oca']);
  assert.equal(yeni.find((h) => h.baslik.endsWith('5 Oca'))!.icerik, '- Birinci gün');
  assert.equal(yeni.find((h) => h.baslik.endsWith('7 Oca'))!.icerik, '- İkinci gün');
  assert.deepEqual(plan.gunDonumu(saat(1, 9, 8, 1)), { yazildi: false });
  assert.equal(meta('yapildi-kaydi:2027-01-06'), undefined, 'tamamlananı olmayan gün için anahtar yok');
});

test('gunDonumu en çok 14 gün geriye bakar: eski profildeki yüzlerce tamamlanan hafızayı doldurmaz', () => {
  temizle(); saat(2, 1, 9);
  const eski = plan.gorevEkle({ baslik: 'Çok eski iş' });
  const yakin = plan.gorevEkle({ baslik: 'Yakın iş' });
  saat(2, 2, 10); plan.gorevGuncelle(eski.id, { durum: 'tamam' });
  saat(2, 25, 10); plan.gorevGuncelle(yakin.id, { durum: 'tamam' });
  const r = plan.gunDonumu(saat(2, 27, 8));
  assert.deepEqual(r, { yazildi: true, gun: '2027-02-25' });
  assert.ok(!kayitlar().some((h) => h.baslik === 'Tamamlananlar · 2 Şub'), '25 gün önceki tamamlanan yazılmadı');
  assert.ok(kayitlar().some((h) => h.baslik === 'Tamamlananlar · 25 Şub'));
});

test('Gizli açıkken tamamlanan madde hafızaya girmez; yalnız Gizli olan gün kayıt bırakmaz ama bir daha da bakılmaz', async () => {
  temizle(); saat(3, 4, 9);
  const acikta = plan.gorevEkle({ baslik: 'Herkese açık iş' });
  const gizlide = plan.gorevEkle({ baslik: 'Gizli oturumdaki iş' });
  const sonraGeri = plan.gorevEkle({ baslik: 'Gizliden sonra yeniden işaretlenen' });
  ayarlariKaydet((a) => { a.yerel.gizliMod = true; });
  saat(3, 4, 10); plan.gorevGuncelle(gizlide.id, { durum: 'tamam' });
  plan.gorevGuncelle(sonraGeri.id, { durum: 'tamam' });
  ayarlariKaydet((a) => { a.yerel.gizliMod = false; });
  saat(3, 4, 11); plan.gorevGuncelle(acikta.id, { durum: 'tamam' });
  plan.gorevGuncelle(sonraGeri.id, { durum: 'acik' });
  saat(3, 4, 12); plan.gorevGuncelle(sonraGeri.id, { durum: 'tamam' }); // Gizli kapalıyken yeniden işaretlendi: artık Gizli değil
  // Kartta hepsi görünür (yerel arayüz): Gizli yalnız hafızayı etkiler.
  assert.equal(plan.kokpitYapilacaklari(new Date()).filter((g) => g.durum === 'tamam').length, 3);
  const bulut = (await listele({ durum: 'tamam' })).icerik;
  assert.match(bulut, /Herkese açık iş/);
  assert.doesNotMatch(bulut, /Gizli oturumdaki iş/, 'bulut yapay zekâya giden gorev_listele Gizli\'de tamamlananı vermez');
  const r = plan.gunDonumu(saat(3, 5, 8));
  assert.deepEqual(r, { yazildi: true, gun: '2027-03-04' });
  const k = kayitlar().find((h) => h.baslik === 'Tamamlananlar · 4 Mar')!;
  assert.equal(k.icerik, '- Herkese açık iş\n- Gizliden sonra yeniden işaretlenen');
  assert.ok(!depo.hafizaListesi({ limit: 500 }).some((h) => /Gizli oturumdaki iş/.test(`${h.baslik} ${h.icerik}`)), 'Gizli madde hiçbir hafıza kaydında yok');
  assert.equal(k.kaynak, 'yapilacaklar:2027-03-04');
  assert.equal(kaynakEtiketi(k.kaynak), 'yapılacaklardan', 'bağlam satırında kaynağı okunur');

  saat(4, 4, 9);
  const yalnizGizli = plan.gorevEkle({ baslik: 'Yalnız Gizli iş' });
  ayarlariKaydet((a) => { a.yerel.gizliMod = true; });
  saat(4, 4, 10); plan.gorevGuncelle(yalnizGizli.id, { durum: 'tamam' });
  ayarlariKaydet((a) => { a.yerel.gizliMod = false; });
  const onceki = kayitlar().length;
  assert.deepEqual(plan.gunDonumu(saat(4, 5, 8)), { yazildi: false });
  assert.equal(kayitlar().length, onceki, 'yalnız Gizli madde olan gün kayıt bırakmaz');
  assert.ok(meta('yapildi-kaydi:2027-04-04'), 'gün işlendi sayılır (her tikte yeniden bakılmaz)');
  assert.equal(JSON.stringify(depo.hafizaListesi({ limit: 500 })).includes('Yalnız Gizli iş'), false);
});

test('gorev_listele {durum:"tamam"} bugün tamamlananları verir (dünküler hafızada); açık liste değişmez; gorev_guncelle dünün işini açamaz', async () => {
  temizle(); saat(5, 6, 9);
  const dun = plan.gorevEkle({ baslik: 'Dünkü iş' });
  const bugun = plan.gorevEkle({ baslik: 'Bugünkü iş', proje: 'Mavi Kuş' });
  const acik = plan.gorevEkle({ baslik: 'Bekleyen iş' });
  saat(5, 6, 20); plan.gorevGuncelle(dun.id, { durum: 'tamam' });
  saat(5, 7, 14, 5); plan.gorevGuncelle(bugun.id, { durum: 'tamam' });
  const tamam = await listele({ durum: 'tamam' });
  assert.match(tamam.icerik, /Bugünkü iş/);
  assert.match(tamam.icerik, /Mavi Kuş/);
  assert.doesNotMatch(tamam.icerik, /Dünkü iş/, 'dünün tamamlananı liste dışı (hafızada "Tamamlananlar" kaydı olur)');
  assert.doesNotMatch(tamam.icerik, /Bekleyen iş/);
  // Son inceleme küçük 5: "Görev" artık süreli görevlerin adı (TERIM.gorev) — yapılacakların sonuçları "yapılacak iş" der.
  assert.equal(tamam.ozet, '1 yapılacak iş');
  assert.match((await listele({ durum: 'acik' })).icerik, /Bekleyen iş/);
  assert.doesNotMatch((await listele({})).icerik, /Bugünkü iş|Dünkü iş/, 'durum verilmezse yalnız açıklar');
  assert.equal((await listele({ durum: 'tamam', proje: 'Başka' })).icerik, 'Bugün tamamlanan yapılacak iş yok.');
  assert.equal((await listele({ durum: 'acik', proje: 'Hiç olmayan' })).icerik, 'Yapılacak iş yok.');
  const g = aracBul('gorev_guncelle')!;
  const red = await g.calistir({ id: dun.id, durum: 'acik' }, baglam);
  assert.equal(red.hata, true, 'dünün işini yeniden açmak yok sayıldı ve söylendi');
  assert.match(red.icerik, /yeni bir yapılacak iş/i);
  const eklendi = await aracBul('gorev_ekle')!.calistir({ baslik: 'Yeni yapılacak' }, baglam);
  assert.match(eklendi.icerik, /^Yapılacak iş #\d+ Yapılacaklar’a eklendi/);
  // Yapılacakların bütün sonuç metinleri "görev" sözcüğünü taşımaz (model "3 görevin var" demesin).
  for (const m of [tamam.icerik, tamam.ozet, (await listele({ durum: 'acik' })).ozet, red.icerik, eklendi.icerik]) assert.doesNotMatch(String(m), /görev/i, String(m));
  const ok = await g.calistir({ id: bugun.id, durum: 'acik' }, baglam);
  assert.equal(ok.hata, undefined, 'bugünkü işi yeniden açmak serbest');
  assert.ok(acik.id > 0);
});

test('gorev_guncelle ile tamamlama aynı yoldan geçer: kokpit listesinde kalır, ertesi gün hafızaya yazılır', async () => {
  temizle(); saat(6, 8, 9);
  const t =plan.gorevEkle({ baslik: 'Yapay zekânın bitirdiği iş' });
  await aracBul('gorev_guncelle')!.calistir({ id: t.id, durum: 'tamam' }, baglam);
  assert.deepEqual(sira(plan.kokpitYapilacaklari(new Date())), ['Yapay zekânın bitirdiği iş:tamam']);
  assert.equal(plan.gunDonumu(saat(6, 9, 8)).yazildi, true);
  assert.equal(kayitlar().find((h) => h.baslik === 'Tamamlananlar · 8 Haz')!.icerik, '- Yapay zekânın bitirdiği iş');
});

test('sohbette görünen araç adımları kartın adını söyler: "Yapılacak…" ("Plan"/"Görev" yok, İş modunda "#kimlik" yok); "Görev" süreli işlere ayrılmıştır', () => {
  const etiket = (ad: string, g: Record<string, unknown> = {}) => aracBul(ad)!.etiket(g);
  assert.equal(etiket('gorev_ekle', { baslik: 'Sunumu bitir' }), 'Yapılacaklara ekliyor: Sunumu bitir');
  assert.equal(etiket('gorev_listele'), 'Yapılacaklara bakıyor');
  assert.equal(etiket('gorev_guncelle', { id: 42 }), 'Yapılacak işi güncelliyor');
  for (const ad of ['gorev_ekle', 'gorev_listele', 'gorev_guncelle']) {
    const a = aracBul(ad)!;
    assert.doesNotMatch(`${a.etiket({ id: 7, baslik: 'x' })} ${a.tanim.aciklama}`, /Plan kart|Planlara|Plana |#\d|Görevi güncelliyor/, ad);
  }
});

test('kokpit verisi: gorevler yalnız açıklar (gündem, özet ve planlayıcı bozulmaz), yapilacaklar işaretlileri de taşır', async () => {
  const { kokpitVerisi } = await import('../src/main/kokpit/duzen.ts');
  temizle(); saat(7, 9, 9);
  const a =plan.gorevEkle({ baslik: 'Kartta kalan' });
  plan.gorevEkle({ baslik: 'Açık kalan' });
  plan.gorevGuncelle(a.id, { durum: 'tamam' });
  const v = kokpitVerisi();
  assert.deepEqual(v.gorevler.map((g) => g.baslik), ['Açık kalan']);
  assert.deepEqual(sira(v.yapilacaklar ?? []), ['Açık kalan:acik', 'Kartta kalan:tamam']);
  saat(7, 10, 9);
  assert.deepEqual(sira(kokpitVerisi().yapilacaklar ?? []), ['Açık kalan:acik'], 'ertesi gün karttan kalktı');
});

test('0.11 G5 düzeltme turu 1 (K4): kokpit verisi bekleyen hatırlatıcıların TAMAMINI taşır (eskiden 12) — "Tümü · N" gerçek toplam', async () => {
  const { kokpitVerisi } = await import('../src/main/kokpit/duzen.ts');
  saat(7, 11, 9);
  veritabani().prepare('DELETE FROM hatirlaticilar').run();
  for (let i = 0; i < 15; i++) plan.hatirlaticiEkle({ baslik: `Hatırlatıcı ${i + 1}`, zaman: new Date(Date.now() + (i + 1) * 3_600_000).toISOString() });
  const v = kokpitVerisi();
  assert.equal(v.hatirlaticilar.filter((h) => h.durum === 'bekliyor').length, 15);
  assert.equal(v.hatirlaticilar[0].baslik, 'Hatırlatıcı 1', 'en yakını önce');
  veritabani().prepare('DELETE FROM hatirlaticilar').run();
});

test('ilk çalışmada geçmiş doldurulmaz: başlangıç günü (yerel) yazılır, ondan önceki günlerin tamamlananları hiç kayıt olmaz; başlangıç gününden itibaren ertesi gün yazılır', () => {
  temizle();
  veritabani().prepare("DELETE FROM meta WHERE k = 'yapildi-baslangic'").run(); // taze profil / 0.10'dan yükseltme: özellik ilk kez çalışıyor
  saat(9, 1, 9);
  const eskiler = Array.from({ length: 14 }, (_, i) => plan.gorevEkle({ baslik: `Eski iş ${i + 1}` }));
  eskiler.forEach((t, i) => { saat(9, i + 1, 10); plan.gorevGuncelle(t.id, { durum: 'tamam' }); });
  saat(9, 14, 23, 50);
  const gece = plan.gorevEkle({ baslik: 'Başlangıçtan önceki gece işi' });
  plan.gorevGuncelle(gece.id, { durum: 'tamam' });
  const eyl = () => kayitlar().filter((h) => / Eyl$/.test(h.baslik));
  assert.equal(meta('yapildi-baslangic'), undefined);
  // İlk çağrı gece yarısından hemen sonra (UTC gününden farklı olabilir): başlangıç YEREL gün.
  assert.deepEqual(plan.gunDonumu(saat(9, 15, 0, 30)), { yazildi: false }, '14 günlük eski tamamlananla ilk çağrı kayıt yazmaz');
  assert.equal(eyl().length, 0, '0.10 geçmişi hafızayı doldurmadı');
  assert.equal(meta('yapildi-baslangic'), '2027-09-15', 'başlangıç günü yerel tarih');
  // Başlangıç günündeki tamamlananlar ertesi gün, bugüne dek olduğu gibi yazılır; öncesi hâlâ yazılmaz.
  saat(9, 15, 0, 10);
  const ilk = plan.gorevEkle({ baslik: 'Başlangıç günü işi (gece)' });
  plan.gorevGuncelle(ilk.id, { durum: 'tamam' });
  saat(9, 15, 14, 0);
  const ikinci = plan.gorevEkle({ baslik: 'Başlangıç günü işi' });
  plan.gorevGuncelle(ikinci.id, { durum: 'tamam' });
  assert.deepEqual(plan.gunDonumu(saat(9, 15, 20)), { yazildi: false }, 'başlangıç günü bitmeden yazılmaz');
  assert.deepEqual(plan.gunDonumu(saat(9, 16, 8)), { yazildi: true, gun: '2027-09-15' });
  assert.deepEqual(eyl().map((h) => h.baslik), ['Tamamlananlar · 15 Eyl'], 'yalnız başlangıç günü yazıldı; 14 Eyl 23:50 dahil öncesi yok');
  assert.equal(eyl()[0].icerik, '- Başlangıç günü işi (gece)\n- Başlangıç günü işi');
  assert.equal(meta('yapildi-baslangic'), '2027-09-15', 'başlangıç günü bir kez yazılır, sonraki çağrılarda değişmez');
});

test('zamanlayıcı her tikte gunDonumu çağırır (ertesi günün ilk tiki ya da açılış); hata tiki durdurmaz', () => {
  const kaynak = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src/main/zamanlayici.ts'), 'utf8');
  const tik = kaynak.slice(kaynak.indexOf('async function tik()'));
  assert.match(tik, /gunDonumu\(new Date\(\)\)/);
  assert.ok(tik.indexOf('gunDonumu(') < tik.indexOf('proaktif.etkin'), 'kendiliğinden yazma kapalı olsa da hafıza kaydı yazılır');
  assert.match(tik.slice(tik.indexOf('gunDonumu(') - 20, tik.indexOf('gunDonumu(') + 120), /try \{.*catch/s);
});

// ── Saf yardımcılar (shared/yapilacaklar.ts): kartın ne göstereceği ──────────────────────────────────────────────────────────────
const { kartGorevleri, yapilacakGorunumu, yapilacakAlt, YAPILACAK_AZAMI } = await import('../src/shared/yapilacaklar.ts');
const gorev = (id: number, durum: 'acik' | 'tamam', ek: Record<string, unknown> = {}) => ({ id, baslik: `İş ${id}`, durum, oncelik: 3, ...(durum === 'tamam' ? { tamamlanma: new Date(2027, 7, 9, 14, 5).toISOString() } : {}), ...ek }) as import('../src/shared/tipler.ts').Gorev;

test('kartGorevleri: yapilacaklar varsa o (işaretliler dahil), yoksa açık görevler (eski veri)', () => {
  assert.deepEqual(kartGorevleri({ gorevler: [gorev(1, 'acik')], yapilacaklar: [gorev(1, 'acik'), gorev(2, 'tamam')] }).map((x) => x.id), [1, 2]);
  assert.deepEqual(kartGorevleri({ gorevler: [gorev(1, 'acik')] }).map((x) => x.id), [1]);
  assert.deepEqual(kartGorevleri({ gorevler: [gorev(1, 'acik')], yapilacaklar: [] }).map((x) => x.id), []);
});

test('yapilacakGorunumu: sığmayınca önce açıklar kesilir, işaretlilere en az yarı yer ayrılır (en son işaretlenen kalır); sığıyorsa hepsi görünür', () => {
  const acik = Array.from({ length: 9 }, (_, i) => gorev(i + 1, 'acik'));
  const tam = [gorev(20, 'tamam'), gorev(21, 'tamam')];
  const hepsi = yapilacakGorunumu([...acik.slice(0, 2), ...tam], 4);
  assert.deepEqual(hepsi.gorunen.map((x) => x.id), [1, 2, 20, 21]);
  assert.deepEqual(hepsi.gizli, []);
  const dar = yapilacakGorunumu([...acik, ...tam], 4);
  assert.equal(dar.gorunen.length, 4);
  assert.deepEqual(dar.gorunen.filter((x) => x.durum === 'tamam').map((x) => x.id), [20, 21], 'işaretliler görünür');
  assert.deepEqual(dar.gorunen.slice(0, 2).map((x) => x.id), [1, 2], 'açıklar sırayla, işaretliler altta');
  assert.deepEqual(dar.gizli.map((x) => x.id), [3, 4, 5, 6, 7, 8, 9]);
  const cok = yapilacakGorunumu([gorev(1, 'acik'), ...Array.from({ length: 8 }, (_, i) => gorev(30 + i, 'tamam'))], 4);
  assert.equal(cok.gorunen.length, 4);
  assert.equal(cok.gorunen[0].id, 1, 'çok işaretli olsa da en az bir açık madde yer bulur');
  assert.deepEqual(cok.gorunen.slice(1).map((x) => x.id), [35, 36, 37], 'işaretliler sığmayınca en eskiler düşer; az önce işaretlenen yerinde');
  assert.deepEqual(yapilacakGorunumu([], 4), { gorunen: [], gizli: [] });
  assert.deepEqual(yapilacakGorunumu([gorev(1, 'acik')], 0).gorunen, [], 'sıfır yer: hiçbiri');
});

test('yapilacakAlt: işaretlide "tamamlandı SS:DD"; açıkta proje · son/gecikti tarih · yüksek öncelik; boşsa boş', () => {
  const bicim = (iso: string) => `T(${iso.slice(0, 10)})`;
  const simdi = new Date(2027, 7, 9, 12, 0).getTime();
  assert.equal(yapilacakAlt(gorev(1, 'tamam'), bicim, simdi), 'tamamlandı 14:05');
  assert.equal(yapilacakAlt(gorev(2, 'acik'), bicim, simdi), '');
  assert.equal(yapilacakAlt(gorev(3, 'acik', { proje: 'Mavi Kuş' }), bicim, simdi), 'Mavi Kuş');
  const yarin = new Date(2027, 7, 10, 9, 0).toISOString();
  const dun = new Date(2027, 7, 8, 9, 0).toISOString();
  assert.equal(yapilacakAlt(gorev(4, 'acik', { sonTarih: yarin }), bicim, simdi), `son T(${yarin.slice(0, 10)})`);
  assert.equal(yapilacakAlt(gorev(5, 'acik', { sonTarih: dun, proje: 'Mavi Kuş', oncelik: 5 }), bicim, simdi), `Mavi Kuş · gecikti T(${dun.slice(0, 10)}) · öncelik 5/5`);
  assert.equal(yapilacakAlt(gorev(6, 'acik', { oncelik: 4 }), bicim, simdi), 'öncelik 4/5');
  assert.equal(yapilacakAlt(gorev(7, 'acik', { oncelik: 3 }), bicim, simdi), '', 'sıradan öncelik yazılmaz (sıralamada zaten belli)');
});

test('YAPILACAK_AZAMI: kart boyuna göre yer sayısı küçük < orta < büyük', () => {
  assert.ok(YAPILACAK_AZAMI.k < YAPILACAK_AZAMI.o && YAPILACAK_AZAMI.o < YAPILACAK_AZAMI.b);
  assert.ok(YAPILACAK_AZAMI.k >= 2, 'en küçük kartta da bir açık, bir işaretli sığar');
});

// ── 0.14 T26: çentik panelinin Yapılacaklar sayfası ─────────────────────────────────────────────────────────────────────────────────────────
// Sayfa kokpitin kendi verisini okur (kokpitYapilacaklari: açıklar + bugünün işaretlileri; yeni tablo/kopya yok), ekleme ve işaretleme aynı `gorevler`
// tablosuna yazar (plan:gorev işaretler). Saat verilirse aynı anda bir hatırlatıcı kurulur: çentik onu zamanında hatırlatır (zamanlayıcı → asistanaGonder).
// Hepsi yerel; ağ bekçisi açık. Kaynak kuralları: metin metin olarak çizilir, girdinin uzunluk sınırı vardır.
const { yapilacakGirdisi, YAPILACAK_METIN_SINIRI } = await import('../src/shared/odak.ts');
const { acikYapilacaklar } = await import('../src/shared/yapilacaklar.ts');
const { kokpitVerisi } = await import('../src/main/kokpit/duzen.ts');
const { hatirlaticilariIsle, testBildirimKaydi } = await import('../src/main/zamanlayici.ts');
const yapIpc = <T>(kanal: string, ...a: unknown[]) => Promise.resolve(ipcIsleyicileri().get(kanal)!({}, ...a)) as Promise<T>;
const yerelSaat = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

test('Yapılacaklar kokpitle aynı veriyi okur (acikYapilacaklar)', async () => {
  temizle(); saat(8, 10, 9);
  const a = plan.gorevEkle({ baslik: 'Raporu gönder', oncelik: 4 });
  plan.gorevEkle({ baslik: 'Diş randevusu', oncelik: 3 });
  const c = plan.gorevEkle({ baslik: 'Market', oncelik: 2 });
  saat(8, 10, 9, 30);
  plan.gorevGuncelle(c.id, { durum: 'tamam' });
  const liste = await yapIpc<{ id: number; baslik: string; durum: string }[]>('yapilacak:liste');
  const kokpit = kokpitVerisi();
  assert.deepEqual(liste.map((g) => g.id), (kokpit.yapilacaklar ?? []).map((g) => g.id), 'kokpitin listesiyle aynı sıra ve kayıtlar');
  assert.deepEqual(acikYapilacaklar({ gorevler: liste, yapilacaklar: liste }).map((g) => g.baslik), acikYapilacaklar(kokpit).map((g) => g.baslik));
  assert.deepEqual(sira(liste), ['Raporu gönder:acik', 'Diş randevusu:acik', 'Market:tamam'], 'açıklar önce, bugünün işaretlisi altta');
  // Sayfadan işaretleme mevcut plan:gorev yoluyla; liste yeniden okununca madde işaretli kalır (silinmez).
  saat(8, 10, 9, 45);
  await yapIpc('plan:gorev', a.id, { durum: 'tamam' });
  assert.deepEqual(sira(await yapIpc('yapilacak:liste')), ['Diş randevusu:acik', 'Market:tamam', 'Raporu gönder:tamam']);
});

test('yapilacak:ekle: başlık temizlenir ve kısaltılır, saatsiz ekleme hatırlatıcı kurmaz, bozuk girdi hiçbir şey yazmaz', async () => {
  temizle(); saat(8, 11, 9);
  const once = plan.hatirlaticilar({ limit: 200 }).length;
  const r = await yapIpc<{ gorev: { id: number; baslik: string }; hatirlatici: unknown } | null>('yapilacak:ekle', { baslik: `  Süt   al\n<b>kalın</b> ${'x'.repeat(400)} ` });
  assert.ok(r);
  assert.equal(r!.gorev.baslik.length <= YAPILACAK_METIN_SINIRI, true, 'başlık sınırı');
  assert.ok(r!.gorev.baslik.startsWith('Süt al <b>kalın</b> x'), 'boşluklar birleşir; etiket metin olarak korunur (çizimde kaçırılır)');
  assert.equal(r!.hatirlatici, null);
  assert.equal(plan.hatirlaticilar({ limit: 200 }).length, once, 'saat yoksa hatırlatıcı yok');
  const sayi = plan.gorevler({ limit: 200 }).length;
  for (const kotu of [null, 'x', {}, { baslik: '' }, { baslik: '   ' }, { baslik: 5 }, { baslik: 'a', saat: '25:61' }, { baslik: 'a', saat: 'ab' }, { baslik: 'a', saat: 1430 }]) {
    assert.equal(await yapIpc('yapilacak:ekle', kotu), null, JSON.stringify(kotu));
  }
  assert.equal(plan.gorevler({ limit: 200 }).length, sayi, 'bozuk girdi görev yazmaz');
  assert.deepEqual(yapilacakGirdisi({ baslik: ' a ', saat: '' }), { baslik: 'a', saat: null }, 'boş saat = saat yok');
  assert.deepEqual(yapilacakGirdisi({ baslik: 'a', saat: '07:05' }), { baslik: 'a', saat: '07:05' });
  assert.equal(YAPILACAK_METIN_SINIRI, 120);
});

test('saat verilen yapılacak hatırlatıcı kurar ve çentik zamanında hatırlatır', async () => {
  temizle(); saat(8, 12, 10, 0);
  const r = await yapIpc<{ gorev: { id: number; baslik: string; sonTarih?: string }; hatirlatici: { id: number; zaman: string; baslik: string; tekrar: string } } | null>('yapilacak:ekle', { baslik: 'İlacı iç', saat: '14:30' });
  assert.ok(r?.hatirlatici, 'hatırlatıcı kuruldu');
  assert.equal(r!.hatirlatici.baslik, 'İlacı iç');
  assert.equal(yerelSaat(r!.hatirlatici.zaman), '14:30');
  assert.equal(new Date(r!.hatirlatici.zaman).getDate(), 12, 'saat bugün henüz gelmediyse bugün');
  assert.equal(r!.hatirlatici.tekrar, 'yok');
  assert.equal(r!.gorev.sonTarih, r!.hatirlatici.zaman, 'görevin son zamanı hatırlatıcıyla aynı');
  assert.equal(plan.zamaniGelenler().length, 0, 'zamanı gelmeden çalmaz');
  // Zamanı gelince mevcut hatırlatıcı hattı (zamanlayıcı → bildirim + çentik) çalışır.
  saat(8, 12, 14, 31);
  assert.deepEqual(plan.zamaniGelenler().map((h) => h.id), [r!.hatirlatici.id]);
  const bildirimOnce = testBildirimKaydi().length;
  await hatirlaticilariIsle();
  assert.equal(plan.hatirlaticiGetir(r!.hatirlatici.id)?.durum, 'gonderildi');
  assert.ok(testBildirimKaydi().slice(bildirimOnce).some((b) => b.baslik === 'Hatırlatma · İlacı iç'), 'hatırlatma bildirimi');
  // Saat geçmişse ertesi gün.
  saat(8, 12, 16, 0);
  const yarin = await yapIpc<{ hatirlatici: { zaman: string } } | null>('yapilacak:ekle', { baslik: 'Sabah koşusu', saat: '07:15' });
  assert.equal(new Date(yarin!.hatirlatici.zaman).getDate(), 13, 'geçmiş saat ertesi güne kurulur');
  assert.equal(yerelSaat(yarin!.hatirlatici.zaman), '07:15');
});

test('yapılacak işaretlenince bekleyen hatırlatıcısı iptal olur (iş bitti, çentik boşuna çalmaz); başka hatırlatıcıya dokunulmaz', async () => {
  temizle(); saat(8, 13, 9, 0);
  const r = await yapIpc<{ gorev: { id: number }; hatirlatici: { id: number } } | null>('yapilacak:ekle', { baslik: 'Kargoyu al', saat: '17:00' });
  await yapIpc('plan:gorev', r!.gorev.id, { durum: 'tamam' });
  assert.equal(plan.hatirlaticiGetir(r!.hatirlatici.id)?.durum, 'iptal');
  saat(8, 13, 17, 5);
  assert.equal(plan.zamaniGelenler().some((h) => h.id === r!.hatirlatici.id), false);
  // Hatırlatıcısı olmayan başka bir görevin işaretlenmesi hatırlatıcılara dokunmaz.
  const bagimsiz = plan.hatirlaticiEkle({ baslik: 'Bağımsız', zaman: new Date(2027, 7, 13, 18, 0).toISOString() });
  const g = plan.gorevEkle({ baslik: 'Başka iş' });
  plan.gorevGuncelle(g.id, { durum: 'tamam' });
  assert.equal(plan.hatirlaticiGetir(bagimsiz.id)?.durum, 'bekliyor');
});

test('Yapilacaklar.tsx: metin metin olarak çizilir (HTML basılmaz), girdi sınırlı, kutu ve düğmeler klavyeyle erişilir', () => {
  const k = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'renderer', 'ada', 'sayfalar', 'Yapilacaklar.tsx'), 'utf8');
  assert.doesNotMatch(k, /dangerouslySetInnerHTML|innerHTML|fetch\(|XMLHttpRequest|localStorage/);
  assert.match(k, /maxLength=\{YAPILACAK_METIN_SINIRI\}/, 'yazı alanının uzunluk sınırı');
  assert.match(k, /type="checkbox"/, 'işaret kutusu yerel (klavye: Boşluk)');
  assert.match(k, /aria-label="Yapılacak ekle"/);
  assert.match(k, /type="time"/);
  assert.doesNotMatch(k, /tabIndex=\{-1\}/);
});
