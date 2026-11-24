// 11 Kas analizi #4, #5 (model-hafiza.md): 2. günde söylenen rapor biçimi 28. gün hatırlanmadı (yerel) ve Türkçe arama uzun çekimli sözcükte kökü
// bulamıyordu. Burada persona'nın (tests/yardimci/persona-selin.mjs) tercih cümleleri 2. günden 28. güne GERÇEK hafiza/yazici.ts + depo.ts ile, sahte
// saatle ve "Yalnız bu bilgisayar"da yeniden oynatılır; araya her gün gürültü ve "ideal yazıcı" kayıtları girer, her gece budama çalışır. Yerel modele
// hiçbir hafıza isteği gitmez (sahte yerel sunucu hafıza isteği alırsa sınama düşer).
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { anaSurecSahnesi, ipcKurBos } from './yardimci/ana-surec.ts';

const yerelHafizaIstegi: string[] = [];
const sunucu = http.createServer(async (q, r) => {
  let h = '';
  q.on('data', (d) => { h += d; });
  await new Promise((c) => q.on('end', c));
  const g = h ? JSON.parse(h) : {};
  const sistem = String(g.messages?.[0]?.content ?? '');
  if (/hafıza yazıcısısın/.test(sistem)) yerelHafizaIstegi.push(sistem.slice(0, 80));
  r.writeHead(200, { 'content-type': 'application/json' });
  r.end(JSON.stringify({ choices: [{ message: { content: '{"islemler":[{"islem":"ekle","tur":"kural","baslik":"Kahve Şartı","icerik":"Kahve şart","sabit":true}]}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
});
await new Promise<void>((c) => sunucu.listen(0, '127.0.0.1', c));
after(() => new Promise<void>((c) => sunucu.close(() => c())));

const GercekDate = Date;
let simMs = new GercekDate('2026-10-05T09:00:00+03:00').getTime();
class SahteDate extends GercekDate { constructor(...a: unknown[]) { if (a.length === 0) super(simMs); else super(...(a as [number])); } static now() { return simMs; } }
const gun = (n: number, s = 10) => { simMs = new GercekDate('2026-10-05T00:00:00+03:00').getTime() + (n - 1) * 86_400_000 + s * 3600_000; };

anaSurecSahnesi('hafiza-tercih-28', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Selin', hitap: 'Selin', mod: 'is', tanitimSurumu: '0.9.0',
  ses: { surum: 2, uyandirma: false }, proaktif: { etkin: false }, baslangictaAc: false, motorCalisti: true,
  yerel: { yalnizYerel: true, etkin: true, model: 'bonsai2-9b' },
});
process.env.FUBER_DEMO = '1';
process.env.FUBER_YEREL_TABAN = `http://127.0.0.1:${(sunucu.address() as { port: number }).port}`;
await ipcKurBos();
const yerelFetch = (globalThis as Record<string, unknown>).__yerelFetch as typeof fetch;
globalThis.fetch = ((u: string, i?: RequestInit) => yerelFetch(u, i)) as typeof fetch;
(globalThis as Record<string, unknown>).Date = SahteDate;
after(() => { (globalThis as Record<string, unknown>).Date = GercekDate; delete process.env.FUBER_YEREL_TABAN; });
const depo = await import('../src/main/hafiza/depo.ts');
const { hafizaYaz, hafizaYaziminiBekle } = await import('../src/main/hafiza/yazici.ts');
const { tekMotorYolu } = await import('../src/main/motor/yerel.ts');
const { sohbetOlustur } = await import('../src/main/sohbet.ts');
const { yerelSistemYari, YEREL_HAFIZA_BUTCESI } = await import('../src/shared/yerel-istem.ts');

const soyle = async (metin: string) => { hafizaYaz({ kullanici: metin, asistan: 'Anlaşıldı.', kaynak: 'sohbet:1/mesaj:1' }); await hafizaYaziminiBekle(); };
const KONULAR = ['ISO denetim raporu', 'Haftalık rapor toplantısı', 'Atlas Gıda teslimat raporu', 'Murat ile bütçe toplantısı', 'İzmir depo raporu', 'Ege Tekstil sözleşme taslağı', 'Satış raporu Burak', 'WMS entegrasyon toplantısı', 'Nakit akışı raporu'];

test('2. gün → 28. gün: açık tercihler çekirdekte kalır ve uyulacak biçimde yerel isteme girer; yeni söz eskisinin yerini alır; gürültü çekirdeğe girmez', async () => {
  assert.equal(tekMotorYolu(), 'yerel', 'ön koşul: Yalnız bu bilgisayar');
  let n = 0;
  for (let d = 1; d <= 28; d++) {
    gun(d, 9);
    if (d === 2) {
      await soyle('Bir şey söyleyeyim: raporları bana hep madde madde ver, en fazla 5 madde olsun ve en başta tek cümlelik sonuç yaz. Uzun paragraf sevmiyorum.');
      await soyle('Bir de sabah 10’dan önce bana toplantı koyma, o saatler derin çalışma saatim.');
    }
    if (d === 3) await soyle('Murat’a yazarken resmi olma lütfen. “Murat Bey” deme, “Murat” de, kısa ve samimi olsun. Yıllardır birlikte çalışıyoruz.');
    if (d === 8) await soyle('Kaç saat uyumuşum biliyor musun, 5 saat. Kahve şart.');
    if (d === 22) await soyle('Öğle yemeği önerirken bilmen gereken bir şey var: glütensiz besleniyorum.');
    if (d === 25) await soyle('Raporlarda fikrim değişti: bundan sonra en fazla 3 madde ver, yine madde madde olsun.');
    // "İdeal yazıcı" iş kayıtları ve gürültü (gerçek kullanımda olduğu gibi ortak sözcüklerle: rapor, toplantı).
    for (let i = 0; i < 6; i++) {
      gun(d, 10 + i);
      const k = KONULAR[(d * 7 + i) % KONULAR.length];
      depo.hafizaEkle({ tur: i % 3 === 0 ? 'olay' : 'bilgi', baslik: `${k} (${d}. gün)`, icerik: `${d}. günün notu: ${k} konuşuldu; ayrıntı ${n++}. Rapor ve toplantı sonrası yapılacaklar belirlendi.`, onem: 3, kaynak: `sohbet:${d}` });
    }
    gun(d, 23);
    depo.hafizaBuda();
  }
  assert.deepEqual(yerelHafizaIstegi, [], 'yerel modele hafıza isteği gitmedi (model yazıcısı yok)');
  const cekirdek = depo.cekirdekMetni();
  const yerelYari = yerelSistemYari(cekirdek, '');
  // 28. gün yoklamaları: rapor biçimi (F1, 25. günde güncellendi), saat (F2), hitap (F3), beslenme (F12).
  for (const [ad, iz] of [['rapor biçimi (güncel)', '3 madde'], ['saat', '10’dan önce'], ['hitap', '“Murat” de'], ['beslenme', 'glütensiz']] as const) {
    assert.ok(yerelYari.includes(iz), `${ad} yerel istemin çekirdek bölümünde: ${yerelYari.slice(0, 600)}`);
  }
  assert.ok(!yerelYari.includes('en fazla 5 madde'), 'eski rapor biçimi çekirdekte değil (yeni söz kazandı)');
  assert.ok(depo.arsivListesi(500).some((h) => h.icerik.includes('en fazla 5 madde')), 'eski biçim arşivde');
  assert.doesNotMatch(cekirdek, /Kahve/i, 'gürültü çekirdeğe girmedi');
  assert.equal(depo.hafizaListesi({ sabit: true, limit: 50 }).filter((h) => h.tur === 'tercih').length, 4);
});

test('Türkçe arama: raporun başarısız iki sorusu artık doğru kaydı bulur (kök + eş anlam), gürültülü 28 günlük hafızada; yerel 600 token bağlamda da', async () => {
  gun(28, 19);
  const rapor = depo.hafizaEkle({ tur: 'tercih', baslik: 'Rapor biçimi', icerik: 'Selin raporları madde madde istiyor: en başta tek cümle sonuç, en çok 5 madde, uzun paragraf yok.', onem: 4, kaynak: 'sohbet:2' });
  const saat = depo.hafizaEkle({ tur: 'tercih', baslik: 'Toplantı saati', icerik: 'Sabah 10:00 öncesine toplantı konmasın (derin çalışma saati).', onem: 4, kaynak: 'sohbet:2' });
  const sohbet = sohbetOlustur();
  for (const [soru, id] of [['Toplantılarımı hangi saatlerden sonra istiyordum?', saat.id], ['Özetleri nasıl yazmanı istemiştim?', rapor.id], ['Görüşmelerimi kaçtan sonra koyabilirsin?', saat.id]] as const) {
    const sira = depo.hafizaAra({ sorgu: soru, limit: 40 }).findIndex((h) => h.id === id);
    assert.ok(sira >= 0 && sira < 3, `"${soru}" → doğru kayıt ilk 3'te (sıra ${sira + 1})`);
    assert.ok(depo.turBaglami(soru, sohbet, 1800).atiflar.some((a) => a.id === id), `${soru}: bulut bağlamında`);
    assert.ok(depo.turBaglami(soru, sohbet, YEREL_HAFIZA_BUTCESI).atiflar.some((a) => a.id === id), `${soru}: yerel bağlamında`);
  }
});
