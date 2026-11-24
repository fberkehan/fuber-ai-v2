// Fuber'in tek sesi (Görev 21, K9) — sahte ElevenLabs sunucusuyla (scripts/dev/sahte-elevenlabs.mjs; yalnız 127.0.0.1, gerçek anahtar
// yok): akışlı TTS isteğinin biçimi (eleven_flash_v2_5, language_code, pcm_22050, xi-api-key), model yazarken cümle cümle konuşma ve
// ilk ses gecikme bütçesi (< 700 ms, akış başladıktan sonra), sıralı parçalar, hata → bir kez yeniden dene → yalnız metin (başka sese
// ya da yedek sese GEÇİLMEZ), kesme (istekler hemen kapanır, ses gelmez), zaman aşımı. 0.13: kullanıcının kendi ElevenLabs anahtarı yolu
// SesMerkezi'nden kalktı (ses Fuber hesabından gelir); konuşma oturumunun mekaniği (Konusma) akışlı ElevenLabs üreticisiyle burada
// doğrudan sınanır. Merkez düzeyi: aynı konuşmada tek ses, yedek ses (sahte Piper süreci), Gizli mod, önizleme.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { sahteElevenLabs } from '../scripts/dev/sahte-elevenlabs.mjs';
import { SesMerkezi, type SesAyarlari, type YedekSes, type HesapSesi } from '../src/main/ses/merkez.ts';
import { elevenSeslendir, _dilSifirla } from '../src/main/ses/elevenlabs.ts';
import { PiperSureci } from '../src/main/ses/piper-surec.ts';
import { Konusma, type KonusmaOlayi } from '../src/main/ses/konusma.ts';
import { YEDEK_SES } from '../src/shared/ses-kimligi.ts';
import { wavdanPcm } from '../src/shared/pcm.ts';

const ANAHTAR = 'sahte-eleven-anahtari';
/** Sahte sunucuya giden ses kimliği (üretimde ses seçilmez; burada yalnız istek biçimi sınanır). */
const ELEVEN_SES = 'AaOhDHYJ1XLZk74lXhdE';
const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sunucu = await sahteElevenLabs({ ttfbMs: 120, parcaMs: 30, parcaBayt: 4410, harfMs: 12 });
after(() => sunucu.kapat());

/** Sahte yedek ses: çağrıldıysa sayar (ElevenLabs düşünce ASLA çağrılmamalı). */
function casusYedek(kurulu = true): YedekSes & { cagri: string[] } {
  const cagri: string[] = [];
  return {
    cagri,
    hazirMi: () => kurulu,
    async *pcm(metin: string) { cagri.push(metin); yield new Uint8Array(4410); },
  };
}

/** Akışlı ElevenLabs konuşma oturumu mekaniği: cümle bölme, ön alma, hata → yeniden dene → yalnız metin, zaman aşımı, kesme. Kullanıcının kendi
 *  anahtarı yolu SesMerkezi'nden kalktı; mekanik Konusma sınıfındadır ve üretici (sahte sunucu) ona doğrudan bağlanır. */
function merkezKur(o: { yedek?: YedekSes; zamanlar?: Record<string, number> } = {}) {
  const yedek = o.yedek ?? casusYedek();
  const gunluk: string[] = [];
  const konusmalar = new Map<string, { konusma: Konusma; sahip: string }>();
  const sonGecikmeler: { ms: number; motor: string }[] = [];
  const baglanti = { taban: sunucu.adres, anahtar: ANAHTAR };
  const m = {
    sonGecikmeler,
    baslat(sahip: string, gonder: (x: KonusmaOlayi) => void, g: { kaynak: string }) {
      const id = randomUUID();
      const kimlik = { motor: 'elevenlabs' as const, sesId: ELEVEN_SES };
      const konusma = new Konusma({
        tekrarMs: 20, ...o.zamanlar, id, kimlik, hz: 22050, bicim: 'pcm16',
        uret: (metin, k) => elevenSeslendir(baglanti, { sesId: ELEVEN_SES, metin, dil: 'tr', hiz: 1, onceki: k.onceki, sinyal: k.sinyal }),
        gonder: (x) => {
          if (x.tur === 'bitti' || x.tur === 'hata') konusmalar.delete(id);
          if (x.tur === 'hata') gunluk.push(`[ses] elevenlabs sesi üretilemedi; bu konuşma yalnız metin: ${x.mesaj}`);
          gonder(x);
        },
        gecikme: (ms) => { sonGecikmeler.unshift({ ms, motor: 'elevenlabs' }); gunluk.push(`[ses] ilk ses ${ms} ms (elevenlabs · ${g.kaynak})`); },
      });
      konusmalar.set(id, { konusma, sahip });
      return { id, kimlik };
    },
    ekle(id: string, metin: string) { konusmalar.get(id)?.konusma.ekle(metin); },
    bitir(id: string) { konusmalar.get(id)?.konusma.bitir(); },
    kes(sahip: string) {
      let n = 0;
      for (const [k, v] of konusmalar) if (v.sahip === sahip) { v.konusma.kes(); konusmalar.delete(k); n++; }
      return n;
    },
    get suren() { return konusmalar.size; },
  };
  return { m, yedek, gunluk };
}

/** Gerçek SesMerkezi (merkez düzeyi kurallar): yedek ses, isteğe bağlı sahte hesap sesi; ElevenLabs'e hiçbir şey gitmez. */
function gercekMerkezKur(o: { ayar?: Partial<SesAyarlari>; yedek?: YedekSes; hesap?: HesapSesi } = {}) {
  const ayar: SesAyarlari = { hiz: 1, dil: 'tr', bulutsuz: false, ...o.ayar };
  const yedek = o.yedek ?? casusYedek();
  // Eski bir ElevenLabs anahtarı bağımlılık olarak verilse bile okunmaz (alan artık yok).
  const m = new SesMerkezi({ ayar: () => ayar, yedek, hesap: o.hesap, zamanlar: { tekrarMs: 20 }, elevenAnahtar: () => ANAHTAR, elevenTaban: () => sunucu.adres } as never);
  return { m, ayar, yedek };
}
function hesapCasusu(): HesapSesi & { cagri: string[] } {
  const cagri: string[] = [];
  return {
    cagri, kullanilir: () => true, yaziyaKullanilir: () => true, sesId: () => 'hesap-ses', kip: () => 'business',
    async seslendir(metin) { cagri.push(metin); return new TextEncoder().encode(`MP3:${metin}`); },
    async yaziya() { return null; },
    async yaziyaBelirteci() { return null; },
    async yaziyaSure() { /* canlı dikte bu testte yok */ },
  };
}

interface Kayit { olaylar: (KonusmaOlayi & { t: number })[]; bitti: Promise<KonusmaOlayi> }
function dinleyici(): { gonder: (o: KonusmaOlayi) => void; kayit: Kayit } {
  const olaylar: (KonusmaOlayi & { t: number })[] = [];
  let coz: (o: KonusmaOlayi) => void = () => undefined;
  const bitti = new Promise<KonusmaOlayi>((c) => { coz = c; });
  return { gonder: (o) => { olaylar.push({ ...o, t: Date.now() }); if (o.tur === 'bitti' || o.tur === 'hata') coz(o); }, kayit: { olaylar, bitti } };
}

/** Model belirteçleri gibi akıtır: `boy` harf, `ms` arayla. Akışın başladığı anı döndürür. */
async function akit(m: SesMerkezi, id: string, metin: string, boy = 6, ms = 25): Promise<number> {
  const bas = Date.now();
  for (let i = 0; i < metin.length; i += boy) { m.ekle(id, metin.slice(i, i + boy)); await bekle(ms); }
  m.bitir(id);
  return bas;
}

const YANIT = 'Tabii, hemen bakıyorum. Yarın saat onda Ahmet Bey ile toplantın var. Sonra öğlen yemeği planlı. Başka bir şey ister misin?';
const ttsIstekleri = (bas: number) => sunucu.istekler.filter((x) => x.akisli && x.zaman >= bas);

test('akışlı TTS isteği: eleven_flash_v2_5, language_code tr, pcm_22050, xi-api-key; PCM çift bayt hizalı gelir', async () => {
  _dilSifirla();
  const bas = Date.now();
  const parcalar: Uint8Array[] = [];
  for await (const p of elevenSeslendir({ taban: sunucu.adres, anahtar: ANAHTAR }, { sesId: ELEVEN_SES, metin: 'Merhaba, ben Fuber.', dil: 'tr', hiz: 1.1, onceki: 'Önceki cümle.' })) parcalar.push(p);
  assert.ok(parcalar.length >= 2, `parça: ${parcalar.length}`);
  assert.ok(parcalar.every((p) => p.length % 2 === 0));
  const i = ttsIstekleri(bas)[0];
  assert.equal(i.sesId, ELEVEN_SES);
  assert.equal(i.bicim, 'pcm_22050');
  assert.equal(i.govde.model_id, 'eleven_flash_v2_5');
  assert.equal(i.govde.language_code, 'tr');
  assert.equal(i.govde.voice_settings.speed, 1.1);
  assert.equal(i.govde.previous_text, 'Önceki cümle.');
  assert.ok(!('optimize_streaming_latency' in i.govde));
  // Yanlış anahtar: 401 → yeniden denenmeyen hata.
  await assert.rejects(async () => { for await (const _ of elevenSeslendir({ taban: sunucu.adres, anahtar: 'yanlis' }, { sesId: 'x', metin: 'a', dil: 'tr' })) { /* */ } }, (e: { durum?: number; yenidenDenenebilir?: boolean }) => e.durum === 401 && e.yenidenDenenebilir === false);
});

test('model yazarken cümle cümle konuşur; ilk ses akış başladıktan < 700 ms sonra; parçalar cümle sırasıyla; tek ses', async () => {
  const { m, gunluk } = merkezKur();
  const { gonder, kayit } = dinleyici();
  const b = m.baslat('pencere-1', gonder, { kaynak: 'yanit' })!;
  assert.equal(b.kimlik.motor, 'elevenlabs');
  assert.equal(b.kimlik.sesId, ELEVEN_SES);
  const bas = Date.now();
  const akisBasi = await akit(m, b.id, YANIT);
  const son = await kayit.bitti;
  assert.equal(son.tur, 'bitti');
  const sesler = kayit.olaylar.filter((o) => o.tur === 'ses') as Extract<KonusmaOlayi, { tur: 'ses' }>[] & { t: number }[];
  const ilk = (kayit.olaylar.find((o) => o.tur === 'ses')!.t) - akisBasi;
  console.log(`  ilk ses: ${ilk} ms (akış başladıktan sonra); ölçülen ${(son as { ilkSesMs?: number }).ilkSesMs} ms; ${sesler.length} parça`);
  assert.ok(ilk < 700, `ilk ses ${ilk} ms`);
  // Model akışı bitmeden konuşma başladı (eskiden yanıtın TAMAMI bitince başlıyordu).
  const akisSonu = akisBasi + Math.ceil(YANIT.length / 6) * 25;
  assert.ok(kayit.olaylar.find((o) => o.tur === 'ses')!.t < akisSonu, 'ses akış bitmeden başlamalı');
  const siralar = sesler.map((s) => s.sira);
  assert.deepEqual(siralar, [...siralar].sort((x, y) => x - y), 'cümle sırası');
  const ist = ttsIstekleri(bas);
  assert.equal(ist.length, 4); // dört cümle, dört istek ("Tabii," ilk parça için çok kısa: virgülde erken kesilmez)
  assert.deepEqual([...new Set(ist.map((x) => x.sesId))], [ELEVEN_SES], 'konuşma boyunca tek ses');
  assert.ok(ist.slice(1).every((x) => typeof x.govde.previous_text === 'string' && x.govde.previous_text.length > 0), 'süreklilik için önceki cümle');
  assert.ok(gunluk.some((s) => /\[ses\] ilk ses \d+ ms \(elevenlabs · yanit\)/.test(s)), gunluk.join('\n'));
  assert.equal(m.sonGecikmeler[0].motor, 'elevenlabs');
});

test('aynı konuşmada tek ses: Gizli konuşma sürerken açılsa da kalan cümleler aynı sesle; yeni konuşma yedek sesle (0.13: ses seçilmez)', async () => {
  const hesap = hesapCasusu();
  const { m, ayar, yedek } = gercekMerkezKur({ hesap });
  const { gonder, kayit } = dinleyici();
  const b = m.baslat('p', gonder, { kaynak: 'yanit' })!;
  assert.equal(b.kimlik.hesap, true);
  m.ekle(b.id, 'Birinci cümle burada. ');
  await bekle(60);
  ayar.bulutsuz = true; // kullanıcı konuşma sürerken Gizli'yi açtı
  m.ekle(b.id, 'İkinci cümle de burada. Üçüncü cümle de var.');
  m.bitir(b.id);
  await kayit.bitti;
  assert.equal(hesap.cagri.length, 3, 'süren konuşmanın bütün cümleleri hesabın sesiyle');
  assert.deepEqual(yedek.cagri, [], 'süren konuşma yedek sese geçmez');
  const d2 = dinleyici();
  const b2 = m.baslat('p', d2.gonder, { kaynak: 'yanit' })!;
  assert.equal(b2.kimlik.motor, 'yerel');
  m.ekle(b2.id, 'Yeni konuşma.'); m.bitir(b2.id);
  await d2.kayit.bitti;
  assert.equal(hesap.cagri.length, 3, 'yeni konuşma hesabın sesine gitmez');
  assert.deepEqual(yedek.cagri, ['Yeni konuşma.']);
});

test('hata → bir kez yeniden dene → olmazsa yalnız metin: hata olayı, sonrası sessiz, yedek ses ÇAĞRILMAZ', async () => {
  const yedek = casusYedek(true);
  const { m, gunluk } = merkezKur({ yedek });
  const { gonder, kayit } = dinleyici();
  const b = m.baslat('p', gonder, { kaynak: 'yanit' })!;
  const bas = Date.now();
  sunucu.hataKur({ kacinci: sunucu.ttsSayisi() + 2, kez: 2, tur: '500' }); // 2. cümle iki kez düşer
  await akit(m, b.id, 'Birinci cümle tamam. İkinci cümle düşecek. Üçüncü cümle hiç okunmamalı.', 50, 5);
  const son = await kayit.bitti;
  sunucu.hataKur(null);
  assert.equal(son.tur, 'hata');
  const sesler = kayit.olaylar.filter((o) => o.tur === 'ses') as (Extract<KonusmaOlayi, { tur: 'ses' }>)[];
  assert.ok(sesler.length > 0 && sesler.every((s) => s.sira === 0), `yalnız 1. cümlenin sesi: ${JSON.stringify(sesler.map((s) => s.sira))}`);
  assert.ok(kayit.olaylar.findIndex((o) => o.tur === 'hata') === kayit.olaylar.length - 1, 'hatadan sonra olay yok');
  const ist = ttsIstekleri(bas);
  assert.equal(ist.filter((x) => x.govde.text === 'İkinci cümle düşecek.').length, 2, 'bir kez yeniden denendi');
  assert.deepEqual(yedek.cagri, [], 'yedek sese geçilmedi');
  assert.deepEqual([...new Set(ist.map((x) => x.sesId))], [ELEVEN_SES]);
  assert.ok(gunluk.some((s) => /yalnız metin/.test(s)));
});

test('geçici hata: yeniden deneme başarılıysa konuşma eksiksiz sürer', async () => {
  const { m } = merkezKur();
  const { gonder, kayit } = dinleyici();
  const b = m.baslat('p', gonder, { kaynak: 'yanit' })!;
  sunucu.hataKur({ kacinci: sunucu.ttsSayisi() + 1, kez: 1, tur: '429' });
  await akit(m, b.id, 'Hız sınırına takılan cümle. Sonraki cümle.', 50, 5);
  const son = await kayit.bitti;
  sunucu.hataKur(null);
  assert.equal(son.tur, 'bitti');
  assert.deepEqual([...new Set((kayit.olaylar.filter((o) => o.tur === 'ses') as { sira: number }[]).map((s) => s.sira))], [0, 1]);
});

test('akış ortada koparsa yeniden denenmez (sözler tekrarlanmasın): yalnız metin', async () => {
  const { m } = merkezKur();
  const { gonder, kayit } = dinleyici();
  const b = m.baslat('p', gonder, { kaynak: 'yanit' })!;
  const bas = Date.now();
  sunucu.hataKur({ kacinci: sunucu.ttsSayisi() + 1, kez: 1, tur: 'kopuk' });
  m.ekle(b.id, `${'Uzun bir cümle '.repeat(12)}burada biter.`); m.bitir(b.id);
  const son = await kayit.bitti;
  sunucu.hataKur(null);
  assert.equal(son.tur, 'hata');
  assert.equal(ttsIstekleri(bas).length, 1);
});

test('zaman aşımı: ilk parça gelmezse yeniden denenir, sonra yalnız metin', async () => {
  const { m } = merkezKur({ zamanlar: { ilkParcaMs: 250 } });
  const { gonder, kayit } = dinleyici();
  const b = m.baslat('p', gonder, { kaynak: 'yanit' })!;
  const bas = Date.now();
  sunucu.hataKur({ kacinci: sunucu.ttsSayisi() + 1, kez: 2, tur: 'sessiz' });
  m.ekle(b.id, 'Sunucu susacak.'); m.bitir(b.id);
  const son = await kayit.bitti;
  sunucu.hataKur(null);
  assert.equal(son.tur, 'hata');
  assert.ok(Date.now() - bas < 1500, `${Date.now() - bas} ms`);
  assert.equal(ttsIstekleri(bas).length, 2);
});

/** Koşul doğru olana dek (en çok `ms`) bekler; sabit beklemeler yük altında (npm test paralel dosyalar) kırılgandı. */
async function kadar(kosul: () => boolean, ms: number): Promise<boolean> {
  for (const son = Date.now() + ms; Date.now() < son;) { if (kosul()) return true; await bekle(10); }
  return kosul();
}

test('kesme: kes() bütün istekleri hemen kapatır, sonrasında ses olayı gelmez', async () => {
  const { m } = merkezKur();
  const { gonder, kayit } = dinleyici();
  const b = m.baslat('pencere-9', gonder, { kaynak: 'yanit' })!;
  const bas = Date.now();
  m.ekle(b.id, `${'Bu cümle uzun sürecek bir cümledir ve '.repeat(4)}bitiyor. İkinci uzun cümle de geliyor ve sürüyor.`);
  // Ses gerçekten akarken kes (eskiden sabit 250 ms bekleniyordu: yük altında istek sunucuya henüz ulaşmamış olabiliyordu — kararsız).
  assert.ok(await kadar(() => kayit.olaylar.some((o) => o.tur === 'ses') && ttsIstekleri(bas).some((x) => x.ilkParca && !x.bitis), 5000), 'ses akmaya başladı');
  const once = kayit.olaylar.length;
  const kesilen = m.kes('pencere-9');
  assert.equal(kesilen, 1);
  const kapandi = await kadar(() => ttsIstekleri(bas).some((x) => x.kesildi), 2000);
  await bekle(300);
  assert.equal(kayit.olaylar.length, once, 'kesildikten sonra olay yok');
  assert.ok(kapandi, `sunucu tarafında istek kapandı: ${JSON.stringify(ttsIstekleri(bas).map((x) => ({ m: x.govde.text.slice(0, 20), z: x.zaman - bas, i: x.ilkParca && x.ilkParca - bas, b: x.bitis && x.bitis - bas, k: x.kesildi })))}`);
  assert.equal(m.suren, 0);
});

test('düzeltme 4: araçtan önceki cümle araç sürerken BÜTÜN söylenir — "\\n\\n" hemen, süre dolunca da cümle ortasından kesilmez', async () => {
  const { m } = merkezKur();
  // a) Ada/sohbet araç adımı başlarken "\n\n" ekler: istek hemen ve cümlenin tamamıyla.
  const d1 = dinleyici();
  const b1 = m.baslat('p', d1.gonder, { kaynak: 'yanit' })!;
  const bas1 = Date.now();
  m.ekle(b1.id, 'Tamam, takvimine hemen ');
  m.ekle(b1.id, 'bakıyorum.');
  m.ekle(b1.id, '\n\n'); // araç başladı
  assert.ok(await kadar(() => ttsIstekleri(bas1).length > 0, 2000));
  const ilk = ttsIstekleri(bas1)[0];
  assert.equal(ilk.govde.text, 'Tamam, takvimine hemen bakıyorum.');
  assert.ok(ilk.zaman - bas1 < 250, `istek ${ilk.zaman - bas1} ms sonra (araç bitmeden)`);
  await bekle(400); // araç sürüyor
  m.ekle(b1.id, 'Yarın saat 10:00\'da toplantın var.'); m.bitir(b1.id);
  assert.equal((await d1.kayit.bitti).tur, 'bitti');
  // Sayılar yazıyla gider (Flash v2.5 sayıları zayıf okur): "10:00'da" → "onda".
  assert.deepEqual(ttsIstekleri(bas1).map((x) => x.govde.text), ['Tamam, takvimine hemen bakıyorum.', 'Yarın saat onda toplantın var.']);
  // b) İşaret hiç gelmese de (eski ada): ilk parça süresi dolunca cümle BÜTÜN olarak ("Tamam, takvimine hemen" | "bakıyorum." değil).
  const d2 = dinleyici();
  const b2 = m.baslat('p', d2.gonder, { kaynak: 'yanit' })!;
  const bas2 = Date.now();
  m.ekle(b2.id, 'Tamam, takvimine hemen bakıyorum.');
  assert.ok(await kadar(() => ttsIstekleri(bas2).length > 0, 2500));
  assert.equal(ttsIstekleri(bas2)[0].govde.text, 'Tamam, takvimine hemen bakıyorum.');
  m.ekle(b2.id, ' Yarın boşsun.'); m.bitir(b2.id);
  await d2.kayit.bitti;
  assert.deepEqual(ttsIstekleri(bas2).map((x) => x.govde.text), ['Tamam, takvimine hemen bakıyorum.', 'Yarın boşsun.']);
});

test('hesabın sesi yok → yedek ses (Piper) konuşur; ikisi de yoksa ses yok (null, yalnız yazı); eski ElevenLabs anahtarı bağımlılıkta olsa da okunmaz', async () => {
  const yedek = casusYedek(true);
  const { m } = gercekMerkezKur({ yedek });
  assert.deepEqual(m.kimlik(), { motor: 'yerel', sesId: YEDEK_SES.id });
  const { gonder, kayit } = dinleyici();
  const b = m.baslat('p', gonder, { kaynak: 'bildirim' })!;
  m.ekle(b.id, 'Hatırlatma: toplantı on dakika sonra.'); m.bitir(b.id);
  assert.equal((await kayit.bitti).tur, 'bitti');
  assert.deepEqual(yedek.cagri, ['Hatırlatma: toplantı on dakika sonra.']);
  const yok = gercekMerkezKur({ yedek: casusYedek(false) });
  assert.equal(yok.m.kimlik(), null);
  assert.equal(yok.m.baslat('p', () => undefined, { kaynak: 'yanit' }), null);
});

test('Gizli mod (bulutsuz): hesabın sesi olsa da yedek ses; hesaba ve ElevenLabs\'e istek gitmez', async () => {
  const yedek = casusYedek(true);
  const hesap = hesapCasusu();
  const { m } = gercekMerkezKur({ yedek, hesap, ayar: { bulutsuz: true } });
  const bas = Date.now();
  const { gonder, kayit } = dinleyici();
  const b = m.baslat('p', gonder, { kaynak: 'yanit' })!;
  assert.equal(b.kimlik.motor, 'yerel');
  m.ekle(b.id, 'Gizli moddayım.'); m.bitir(b.id);
  await kayit.bitti;
  assert.equal(ttsIstekleri(bas).length, 0);
  assert.deepEqual(hesap.cagri, []);
  assert.equal(yedek.cagri.length, 1);
});

test('önizleme: wav() telefon için RIFF döndürür (yedek ses; hesap yoksa); ses seçilmez', async () => {
  const { m, yedek } = gercekMerkezKur();
  const bas = Date.now();
  const r = await m.wav('Merhaba, ben Fuber.');
  assert.ok(r);
  const w = wavdanPcm(r!.wav);
  assert.equal(w?.hz, 22050);
  assert.ok((w?.pcm.length ?? 0) > 1000);
  assert.equal(r!.motor, 'yerel');
  assert.deepEqual(yedek.cagri, ['Merhaba, ben Fuber.']);
  assert.deepEqual(ttsIstekleri(bas), [], 'ElevenLabs\'e hiçbir şey gitmez');
});

test('yedek ses süreci (sahte Piper): cümleler sırayla WAV → PCM; hız --length_scale ile; tek süreç', async () => {
  const kayit = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-piper-test-')), 'kayit.jsonl');
  const betik = path.resolve(import.meta.dirname, '../scripts/dev/sahte-piper.mjs');
  const p = new PiperSureci(() => ({ calistirici: process.execPath, ses: 'tr_TR-dfki-medium.onnx' }), (_k, a, o) => spawn(process.execPath, [betik, ...a], { cwd: o.cwd, env: { ...process.env, FUBER_SAHTE_PIPER_KAYIT: kayit } }));
  try {
    const t0 = Date.now();
    const parcalar: Uint8Array[] = [];
    for (const metin of ['Birinci cümle.', 'İkinci cümle.']) for await (const x of p.pcm(metin, 1)) parcalar.push(x);
    assert.equal(parcalar.length, 2);
    assert.ok(parcalar.every((x) => x.length > 4000 && x.length % 2 === 0));
    for await (const x of p.pcm('Hızlı.', 1.1)) parcalar.push(x);
    const satirlar = fs.readFileSync(kayit, 'utf8').trim().split('\n').map((s) => JSON.parse(s));
    const surecler = satirlar.filter((s) => s.argv);
    assert.equal(surecler.length, 2, 'hız değişince bir kez yeniden açılır');
    assert.ok(!surecler[0].argv.includes('--length_scale'));
    assert.deepEqual(surecler[1].argv.slice(-2), ['--length_scale', '0.909']);
    assert.deepEqual(satirlar.filter((s) => s.metin).map((s) => s.metin), ['Birinci cümle.', 'İkinci cümle.', 'Hızlı.']);
    console.log(`  sahte Piper: 3 cümle ${Date.now() - t0} ms`);
  } finally { p.kapat(); }
});

// 0.12 H6 (Electron sigortaları: RunAsNode KAPALI): uygulamanın exe'si Node olarak çalıştırılmaz — kaynakta ELECTRON_RUN_AS_NODE yok; sahte
// Piper ayrı bir Node süreciyle (["node", "<sahte-piper.mjs>"]) koşar, gerçek piper.exe yolu aynen.
test('H6: src/ altında ELECTRON_RUN_AS_NODE yok; sahte Piper ["node", betik] kalıbıyla çalışır', () => {
  const kok = path.resolve(import.meta.dirname, '..', 'src');
  const bulunan: string[] = [];
  const gez = (d: string) => {
    for (const x of fs.readdirSync(d, { withFileTypes: true })) {
      const y = path.join(d, x.name);
      if (x.isDirectory()) gez(y);
      else if (/\.(ts|tsx|js|mjs|cjs)$/.test(x.name) && fs.readFileSync(y, 'utf8').includes('ELECTRON_RUN_AS_NODE')) bulunan.push(path.relative(kok, y));
    }
  };
  gez(kok);
  assert.deepEqual(bulunan, []);
  const piper = fs.readFileSync(path.join(kok, 'main', 'yerel', 'piper.ts'), 'utf8');
  assert.match(piper, /return \['node', h\];/, 'düz betik yolu → ["node", yol]');
  assert.match(piper, /spawn\(test\[0\], \[\.\.\.test\.slice\(1\), \.\.\.argumanlar\]/, 'sahte Piper kendi Node komutuyla');
  assert.match(piper, /return spawn\(komut, argumanlar, \{ cwd: o\.cwd, windowsHide: true \}\);/, 'gerçek piper.exe yolu aynen');
});
