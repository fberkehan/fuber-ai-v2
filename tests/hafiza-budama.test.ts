// 11 Kas analizi (model-hafiza.md) #1, #2, #3, #7, #11, #12: hafıza yazıcısının kod denetimi ve gece budaması — GERÇEK hafiza/depo.ts + yazici.ts,
// Electron'suz sahne, sahte Fuber geçidi (yalnız 127.0.0.1; yazıcının yanıtını sınama belirler). Sınanır:
//  · modelin `sabit:true`su yok sayılır; öz-konuşma ve modelin sayı iddiası kaydedilmez; yakın kopya eklenmez (güncellenir, eski sürüm ARŞİVDE);
//  · aynı konu yeni tarihle gelince yeni söz kazanır; model kullanıcının sözüne dokunamaz; modelin "sil"i arşive taşır;
//  · kendiliğinden turun işareti yazıcıya gitmez; çekirdekte önce tercihler, en çok 12 sabit;
//  · budama: yakın kopyalar birleşir, öz-konuşma/merak kayıtları ve çürüyen düşük değerli kayıtlar arşive, bütçe 400, kullanıcının kaydı korunur,
//    hiçbir şey kalıcı silinmez (arşivden geri alınır).
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { anaSurecSahnesi, ipcKurBos } from './yardimci/ana-surec.ts';
import { fuberBicimi, openaiYaz } from './yardimci/openai-sahte.ts';

const yazici: { cevap: unknown; istekler: string[] } = { cevap: { islemler: [] }, istekler: [] };
const sunucu = http.createServer(async (q, r) => {
  let h = '';
  q.on('data', (d) => { h += d; });
  await new Promise((c) => q.on('end', c));
  const g = fuberBicimi(h ? JSON.parse(h) : {});
  const sistem = String(g.systemPrompt ?? '');
  const son = JSON.stringify(g.messages ?? []);
  if (/hafıza yazıcısısın/.test(sistem)) yazici.istekler.push(son);
  openaiYaz(r, /hafıza yazıcısısın/.test(sistem) ? JSON.stringify(yazici.cevap) : 'Tamam.');
});
await new Promise<void>((c) => sunucu.listen(0, '127.0.0.1', c));
after(() => new Promise<void>((c) => sunucu.close(() => c())));
const taban = `http://127.0.0.1:${(sunucu.address() as { port: number }).port}`;

anaSurecSahnesi('hafiza-budama', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Selin', hitap: 'Selin', mod: 'is', tanitimSurumu: '0.9.0',
  ses: { surum: 2, uyandirma: false }, proaktif: { etkin: false }, baslangictaAc: false, motorCalisti: true,
  motorSecimi: 'openai', openaiUyumlu: { tabanUrl: `${taban}/v1`, model: 'sahte-model' },
});
(globalThis as Record<string, unknown>).__sifreleme = true;
process.env.FUBER_DEMO = '1';
await ipcKurBos();
const yerelFetch = (globalThis as Record<string, unknown>).__yerelFetch as typeof fetch;
globalThis.fetch = ((u: string, i?: RequestInit) => yerelFetch(u, i)) as typeof fetch;
const depo = await import('../src/main/hafiza/depo.ts');
const { hafizaYaz, hafizaYaziminiBekle } = await import('../src/main/hafiza/yazici.ts');
const { veritabani } = await import('../src/main/vt.ts');
const { PROAKTIF_HAFIZA_ISARETI } = await import('../src/shared/ic-talimat.ts');

const yaz = async (kullanici: string, islemler: unknown[], asistan = 'Not aldım.') => {
  yazici.cevap = { islemler };
  hafizaYaz({ kullanici, asistan, kaynak: 'sohbet:1/mesaj:1' });
  await hafizaYaziminiBekle();
};
const ekle = (tur: string, baslik: string, icerik: string, sabit = false) => ({ islem: 'ekle', tur, baslik, icerik, onem: 4, sabit });
const bul = (baslik: string) => depo.hafizaListesi({ limit: 1000 }).filter((h) => h.baslik === baslik);
const arsivde = (parca: string) => depo.arsivListesi(1000).some((h) => h.icerik.includes(parca));

test('yazıcı: modelin sabit:true önerisi yok sayılır; öz-konuşma ve modelin sayı iddiası kaydedilmez', async () => {
  await yaz('Kaç saat uyumuşum biliyor musun, 5 saat. Kahve şart.', [ekle('kural', 'Kahve Şartı', 'Selin için kahve şart.', true)]);
  const k = bul('Kahve Şartı');
  assert.equal(k.length, 1);
  assert.equal(k[0].sabit, false, 'modelin sabit önerisi çekirdeğe girmedi');
  await yaz('Kâr marjımız ne olur? Gelir 1.250.000, maliyet 1.000.000.', [
    ekle('kural', 'Fuber araç erişimi yok', 'Fuber tek başına çalışıyor; e-posta ve hatırlatma araçlarına erişimi yok.', true),
    ekle('bilgi', 'Kâr marjı', 'Kâr marjı %25.'),
  ], 'Kâr marjı %25.');
  assert.equal(bul('Fuber araç erişimi yok').length, 0, 'öz-konuşma reddedildi');
  assert.equal(bul('Kâr marjı').length, 0, 'modelin hesabı olgu diye kaydedilmedi');
});

test('yazıcı: yakın kopya eklenmez (mevcut güncellenir, eski sürüm arşivde); aynı konu yeni tarihle → yeni söz kazanır', async () => {
  await yaz('İzmir depo açılışını 20 Kasım olarak planladık.', [ekle('olay', 'İzmir depo açılışı', 'İzmir depo açılışı 20 Kasım olarak planlandı.')]);
  const once = depo.hafizaSayisi();
  await yaz('İzmir depo açılışını 20 Kasım olarak planladık, tekrar söylüyorum.', [ekle('olay', 'İzmir depo açılışı', 'İzmir depo açılışı 20 Kasım olarak planlandı.')]);
  assert.equal(depo.hafizaSayisi(), once, 'aynı kayıt ikinci kez eklenmedi');
  await yaz('Kötü haber: İzmir açılışı 4 Aralık’a kaydı, yangın izni gecikti.', [ekle('olay', 'İzmir açılışı', 'İzmir depo açılışı 4 Aralık’a kaydı (yangın izni gecikti).')]);
  const izmir = depo.hafizaListesi({ limit: 1000 }).filter((h) => /İzmir/.test(h.baslik));
  assert.equal(izmir.length, 1, `çelişen iki olgu yan yana kalmaz: ${izmir.map((h) => h.icerik).join(' | ')}`);
  assert.match(izmir[0].icerik, /4 Aralık/);
  assert.ok(arsivde('20 Kasım'), 'eski sürüm arşivde (geri alınabilir)');
});

test('yazıcı: kullanıcının açık tercihi kural tabanlı ÇEKİRDEĞE girer; model onu ezemez, silemez; modelin "sil"i arşive taşır', async () => {
  await yaz('Bir de sabah 10’dan önce bana toplantı koyma, o saatler derin çalışma saatim.', []);
  const t = depo.hafizaListesi({ sabit: true, limit: 50 }).find((h) => /10’dan önce/.test(h.icerik));
  assert.ok(t, 'tercih çekirdekte (model boş dönse de)');
  assert.equal(t!.tur, 'tercih');
  assert.match(t!.kaynak, /kullanici/);
  await yaz('Toplantı saatleri nasıldı?', [{ islem: 'guncelle', id: t!.id, icerik: 'Selin sabah 9’da toplantı sever.' }, { islem: 'sil', id: t!.id }, ekle('tercih', 'Tercih: sabah 10’dan önce bana toplantı koyma', 'Toplantılar sabah 10:00’dan sonra olsun (model özeti).')]);
  const sonra = depo.hafizaGetir(t!.id)!;
  assert.ok(sonra, 'kullanıcının kaydı silinmedi');
  assert.match(sonra.icerik, /10’dan önce/, 'model kullanıcının sözünü ezmedi');
  await yaz('Kahve konusunu unut.', [{ islem: 'sil', id: bul('Kahve Şartı')[0].id }]);
  assert.equal(bul('Kahve Şartı').length, 0);
  assert.ok(arsivde('kahve şart'), 'modelin sildiği kayıt arşivde');
  const geri = depo.hafizaArsivdenGeriAl(depo.arsivListesi(1000).find((h) => /kahve şart/.test(h.icerik))!.id);
  assert.equal(geri?.baslik, 'Kahve Şartı', 'arşivden geri alındı');
});

test('yazıcı: kendiliğinden turun işareti (kullanıcı bir şey yazmadı) yazıcıya hiç gitmez', async () => {
  const once = yazici.istekler.length;
  await yaz(PROAKTIF_HAFIZA_ISARETI, [ekle('kural', 'Bugün öncelikli olanlar', 'Bugün: 14:00 Atlas Gıda toplantısı', true)], 'Günaydın Selin! Bugün 14:00 Atlas Gıda toplantısı var.');
  assert.equal(yazici.istekler.length, once);
  assert.equal(bul('Bugün öncelikli olanlar').length, 0);
});

test('çekirdek: önce kullanıcının tercihleri; en çok 12 sabit — fazlası sabitten iner (silinmez)', async () => {
  for (let i = 0; i < 16; i++) depo.hafizaEkle({ tur: 'kural', baslik: `Eski model kuralı ${i}`, icerik: `Model yazmış kalıcı kural ${i} ayrıntı ${'x'.repeat(i)}`, sabit: true, onem: 5, kaynak: 'sohbet:1' });
  const c = depo.cekirdekMetni();
  assert.match(c.split('\n')[0], /\(tercih; sen söyledin\)/, 'ilk satır kullanıcının tercihi');
  assert.ok(c.split('\n').length <= 12);
  const inen = depo.sabitTavaniniUygula();
  assert.ok(inen >= 5, `${inen} kayıt sabitten indi`);
  assert.equal(depo.hafizaListesi({ sabit: true, limit: 50 }).length, 12);
  assert.ok(depo.hafizaListesi({ sabit: true, limit: 50 }).some((h) => h.tur === 'tercih'), 'kullanıcının tercihi sabit kaldı');
  assert.equal(depo.hafizaListesi({ limit: 1000 }).filter((h) => h.baslik.startsWith('Eski model kuralı')).length, 16, 'hiçbiri silinmedi');
});

test('budama: yakın kopyalar birleşir; öz-konuşma ve merak kayıtları, çürüyen düşük değerli kayıtlar arşive; kullanıcının kaydı korunur', () => {
  const vt = veritabani();
  for (let i = 0; i < 5; i++) depo.hafizaEkle({ tur: 'kural', baslik: 'Murat Bey’e yazma dil kuralı', icerik: `Murat’a yazarken samimi dil kullan, Murat Bey deme${i % 2 ? '.' : ''}`, kaynak: `sohbet:${i}` });
  depo.hafizaEkle({ tur: 'bilgi', baslik: 'Mevcut Durum (Kahve)', icerik: 'Tarayıcı, e-posta ve araç erişimi mevcut değil.', kaynak: 'sohbet:9' });
  for (let i = 0; i < 3; i++) depo.hafizaEkle({ tur: 'olay', baslik: 'Merak sorusu', icerik: `Selin’e ${i}. gün şu soruldu: soru-${i}`, onem: 2, kaynak: 'sohbet:1' });
  const eski = depo.hafizaEkle({ tur: 'olay', baslik: 'Hava sıcaktı', icerik: 'Ekim ortasında 27 derece', onem: 2, kaynak: 'sohbet:2' });
  const eskiKullanici = depo.hafizaEkle({ tur: 'bilgi', baslik: 'Doğum günü', icerik: 'Selin’in doğum günü 3 Mart', onem: 2, kaynak: 'kullanici' });
  const gecmis = new Date(Date.now() - 90 * 86_400_000).toISOString();
  vt.prepare('UPDATE hafizalar SET guncelleme = ? WHERE id IN (?, ?)').run(gecmis, eski.id, eskiKullanici.id);
  const once = depo.hafizaSayisi();
  const r = depo.hafizaBuda();
  assert.ok(r.birlesen >= 4, `yakın kopyalar birleşti: ${JSON.stringify(r)}`);
  assert.equal(depo.hafizaListesi({ limit: 1000 }).filter((h) => h.baslik === 'Murat Bey’e yazma dil kuralı').length, 1);
  assert.equal(bul('Mevcut Durum (Kahve)').length, 0, 'öz-konuşma arşive');
  assert.equal(bul('Merak sorusu').length, 0, 'merak kayıtları arşive');
  assert.equal(depo.hafizaGetir(eski.id), null, '90 gündür bakılmayan düşük değerli kayıt arşive');
  assert.ok(depo.hafizaGetir(eskiKullanici.id), 'kullanıcının kaydı çürümez');
  assert.equal(r.canli, depo.hafizaSayisi());
  assert.ok(depo.hafizaSayisi() < once);
  const toplam = Number((vt.prepare('SELECT COUNT(*) n FROM hafizalar').get() as { n: number }).n);
  assert.ok(toplam >= once, 'hiçbir satır kalıcı silinmedi (arşiv)');
  assert.ok(depo.hafizaArsivdenGeriAl(eski.id), 'arşivden geri alınır');
});

test('budama: canlı kayıt bütçesi (400) aşılınca en düşük değerli, kullanıcıdan gelmeyen kayıtlar arşive; ikinci koşu bir şey yapmaz', () => {
  for (let i = 0; i < 430; i++) depo.hafizaEkle({ tur: 'bilgi', baslik: `Not ${i} ${['alfa', 'beta', 'gama', 'delta', 'epsilon', 'zeta'][i % 6]}${i}`, icerik: `Benzersiz içerik ${i} — ${(i * 7919).toString(36)} ${(i * 104729).toString(36)}`, onem: i % 2 ? 2 : 3, kaynak: 'sohbet:5' });
  const bas = Date.now();
  const r = depo.hafizaBuda();
  assert.ok(Date.now() - bas < 15_000, `budama makul sürede (${Date.now() - bas} ms)`);
  assert.ok(depo.hafizaSayisi() <= 400, `canlı ${depo.hafizaSayisi()}`);
  assert.ok(r.arsivlenen > 0);
  assert.ok(depo.hafizaListesi({ limit: 1000 }).some((h) => h.baslik === 'Doğum günü'), 'kullanıcının kaydı bütçe için arşivlenmez');
  const r2 = depo.hafizaBuda();
  assert.equal(r2.birlesen + r2.arsivlenen + r2.sabittenInen, 0, 'ikinci koşu bir şey değiştirmez');
});

// 0.15 sürüm doğrulaması (ozellik-denetimi "İğne"): hafıza kuralları değişti (çekirdek yalnız kullanıcının açık sözünden; tavan 12, önce kullanıcıdan
// GELMEYENLER iner) ama Hafıza sayfasındaki iğne de kullanıcının açık eylemidir. Eskiden iğne yalnız `sabit` yazıyordu: sohbetten gelmiş bir kayıt elle
// iğnelense de tavan aşılınca ilk o inerdi (sessizce geri alınmış iğne). İğne kaynağa "kullanici" ekler — tavanda korunur, model onu ezmez.
test('iğne (Hafıza sayfası): elle iğnelenen sohbet kaydı kullanıcınındır; tavan aşılınca sabit kalır', async () => {
  const { ipcIsleyicileri } = await import('./yardimci/ana-surec.ts');
  const ipc = (k: string, ...a: unknown[]) => ipcIsleyicileri().get(k)!({}, ...a);
  const k = depo.hafizaEkle({ tur: 'bilgi', baslik: 'Elle iğnelenen kayıt', icerik: 'Kuzey Rüzgârı sözleşmesi her yıl Mart’ta yenilenir.', onem: 3, kaynak: 'sohbet:7' });
  const sonra = (await ipc('hafiza:guncelle', k.id, { sabit: true })) as { sabit: boolean; kaynak: string };
  assert.equal(sonra.sabit, true);
  assert.match(sonra.kaynak, /kullanici/, 'iğne kullanıcının açık eylemi');
  veritabani().prepare('UPDATE hafizalar SET guncelleme = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', k.id);
  for (let i = 0; i < 14; i++) depo.hafizaEkle({ tur: 'kural', baslik: `Yeni model kuralı ${i}`, icerik: `Model yazmış yeni kural ${i} ${'y'.repeat(i)}`, sabit: true, onem: 5, kaynak: 'sohbet:2' });
  depo.sabitTavaniniUygula();
  assert.equal(depo.hafizaGetir(k.id)?.sabit, true, 'elle iğnelenen kayıt tavanda inmedi');
  // İğne kaldırılınca kayıt olağan kayıttır (silinmez).
  const kalkti = (await ipc('hafiza:guncelle', k.id, { sabit: false })) as { sabit: boolean };
  assert.equal(kalkti.sabit, false);
});
