// Kullanım özeti (K5, Ruling O): src/shared/kullanim-ozeti.ts + model-bilgisi.ts modelFiyati/cagriMaliyeti. Claude dışı modellerin
// maliyeti model bilgisinden; bilinmeyen fiyat null ("—"), 0 YAZILMAZ ve toplama katılmaz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { cagriMaliyeti, modelFiyati } from '../src/shared/model-bilgisi.ts';
import { MESAJ_IZI_SQL, arkaPlanMi, grupMaliyeti, kullanimDerle, yanitSay, type KullanimSatiri, type MesajIzi } from '../src/shared/kullanim-ozeti.ts';
import { DURDURULDU, durdurmaKayitlari, type DurdurmaKaydi } from '../src/main/ajan/durdurma.ts';

const satir = (s: Partial<KullanimSatiri> & Pick<KullanimSatiri, 'saglayici' | 'model' | 'amac'>): KullanimSatiri => ({
  istek: 1, giris: 0, cikis: 0, onbellekOkuma: 0, onbellekYazma: 0, kayitliMaliyet: null, kayitliSayi: 0, ...s,
});
const yakin = (a: number | null, b: number) => assert.ok(a !== null && Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('modelFiyati: Claude ve OpenAI yerleşik tablodan; OpenRouter kimliği öneke göre; yerel ve :free ücretsiz (bilinen 0)', () => {
  assert.deepEqual(modelFiyati('anthropic', 'claude-opus-5-5'), { giris: 4, cikis: 20 });
  assert.deepEqual(modelFiyati('anthropic', 'claude-haiku-4-5-20251001'), { giris: 1, cikis: 5 }, 'tarih ekli kimlik');
  assert.deepEqual(modelFiyati('openai', 'gpt-4o-mini'), { giris: 0.15, cikis: 0.6 });
  assert.deepEqual(modelFiyati('openrouter', 'openai/gpt-4o'), { giris: 2.5, cikis: 10 });
  assert.deepEqual(modelFiyati('openrouter', 'anthropic/claude-sonnet-5.5'), { giris: 2, cikis: 10 });
  assert.deepEqual(modelFiyati('openrouter', 'meta-llama/llama-4:free'), { giris: 0, cikis: 0 });
  assert.deepEqual(modelFiyati('yerel', 'Bonsai 27B'), { giris: 0, cikis: 0 });
});

test('modelFiyati: bilinmeyen → undefined (0 değil); Fuber gateway krediyle (fiyat yok); canlı liste tablodan önce', () => {
  assert.equal(modelFiyati('openai', 'gpt-5.5'), undefined, 'GPT-5.5 değerinden emin değiliz: tabloda yalnız ad');
  assert.equal(modelFiyati('openrouter', 'google/gemini-3-pro'), undefined);
  assert.equal(modelFiyati('fuber', 'claude-opus-5'), undefined);
  assert.equal(modelFiyati('sahte', 'x'), undefined);
  assert.deepEqual(modelFiyati('openrouter', 'google/gemini-3-pro', { girisFiyat: 1.25, cikisFiyat: 10 }), { giris: 1.25, cikis: 10 });
  assert.equal(modelFiyati('openrouter', 'google/gemini-3-pro', { girisFiyat: 1.25 }), undefined, 'yarım fiyat bilinmiyor sayılır');
});

test('cagriMaliyeti: Anthropic önbelleği ayrı (yazma 1,25×, okuma 0,1×); OpenAI uyumlularda giriş olduğu gibi', () => {
  const k = { giris: 1_000_000, cikis: 100_000, onbellekOkuma: 1_000_000, onbellekYazma: 0 };
  yakin(cagriMaliyeti('anthropic', { giris: 4, cikis: 20 }, k), 4 + 0.4 + 2);
  yakin(cagriMaliyeti('openai', { giris: 0.15, cikis: 0.6 }, k), 0.15 + 0.06);
  yakin(cagriMaliyeti('anthropic', { giris: 4, cikis: 20 }, { giris: 0, cikis: 0, onbellekYazma: 1_000_000 }), 5);
});

test('grupMaliyeti: fiyat varsa tokenlerden; yoksa yalnız bütün çağrıları fiyatlı ve > 0 kayıtlı maliyet; eski 0 kaydı bilinmiyor', () => {
  yakin(grupMaliyeti(satir({ saglayici: 'openai', model: 'gpt-4o-mini', amac: 'sohbet', giris: 2_000_000, cikis: 0 }), { giris: 0.15, cikis: 0.6 }), 0.3);
  yakin(grupMaliyeti(satir({ saglayici: 'openrouter', model: 'x/y', amac: 'sohbet', istek: 2, kayitliMaliyet: 0.02, kayitliSayi: 2 }), undefined), 0.02);
  assert.equal(grupMaliyeti(satir({ saglayici: 'openrouter', model: 'x/y', amac: 'sohbet', istek: 2, kayitliMaliyet: 0.02, kayitliSayi: 1 }), undefined), null, 'bir çağrının fiyatı yok');
  assert.equal(grupMaliyeti(satir({ saglayici: 'openai', model: 'gpt-5.5', amac: 'sohbet', kayitliMaliyet: 0, kayitliSayi: 1 }), undefined), null, 'eski sürüm bilinmeyene 0 yazardı');
});

test('kullanimDerle: Claude dışı model maliyeti model bilgisinden; bilinmeyen "—" (null), toplama katılmaz, sayılır', () => {
  const o = kullanimDerle([
    satir({ saglayici: 'anthropic', model: 'claude-haiku-5-5', amac: 'hafiza:yaz', istek: 10, giris: 1_000_000, cikis: 0 }),
    satir({ saglayici: 'openai', model: 'gpt-4o-mini', amac: 'sohbet', istek: 3, giris: 1_000_000, cikis: 1_000_000, kayitliMaliyet: 0, kayitliSayi: 3 }),
    satir({ saglayici: 'openai', model: 'gpt-5.5', amac: 'sohbet', istek: 4, giris: 500_000, cikis: 10_000, kayitliMaliyet: 0, kayitliSayi: 4 }),
    satir({ saglayici: 'fuber', model: 'claude-opus-5', amac: 'kokpit', istek: 2, giris: 100, cikis: 100 }),
    satir({ saglayici: 'yerel', model: 'Bonsai 9B', amac: 'gunkaydi:not', istek: 5, giris: 9_000, cikis: 900 }),
  ]);
  yakin(o.toplam, 0.1 + 0.75);
  assert.equal(o.istek, 24);
  assert.equal(o.bilinmeyen, 6, 'gpt-5.5 (4) + Fuber gateway (2)');
  const amac = Object.fromEntries(o.amaclar.map((a) => [a.amac, a]));
  yakin(amac.sohbet.maliyet, 0.75); assert.equal(amac.sohbet.istek, 7); assert.equal(amac.sohbet.bilinmeyen, 4);
  assert.equal(amac.kokpit.maliyet, null, 'yalnız fiyatsız çağrı: null ("—"), 0 değil');
  assert.equal(amac['gunkaydi:not'].maliyet, 0, 'yerel beyin ücretsiz: bilinen 0');
  const model = Object.fromEntries(o.modeller.map((m) => [`${m.saglayici}/${m.model}`, m]));
  yakin(model['openai/gpt-4o-mini'].maliyet, 0.75);
  assert.equal(model['openai/gpt-5.5'].maliyet, null);
  assert.equal(model['fuber/claude-opus-5'].maliyet, null);
  assert.deepEqual(o.modeller.map((m) => m.model).slice(-2).sort(), ['claude-opus-5', 'gpt-5.5'], 'bilinmeyenler sonda');
});

test('kullanimDerle: canlı fiyat bulucu (OpenRouter /models) tablodan önce; boş girdi', () => {
  const o = kullanimDerle([satir({ saglayici: 'openrouter', model: 'google/gemini-3-pro', amac: 'sohbet', giris: 1_000_000, cikis: 0 })],
    (s, m) => modelFiyati(s, m, s === 'openrouter' && m === 'google/gemini-3-pro' ? { girisFiyat: 1.25, cikisFiyat: 10 } : undefined));
  yakin(o.toplam, 1.25);
  assert.equal(o.bilinmeyen, 0);
  assert.deepEqual(kullanimDerle([]), { toplam: 0, istek: 0, giris: 0, cikis: 0, yanit: 0, arkaPlan: 0, bilinmeyen: 0, amaclar: [], modeller: [] });
});

// ── "Bu ay N yanıt" = kullanıcının gördüğü tamamlanmış yanıt (motor çağrısı değil) + "ve M arka plan işi" (düzeltme turu, Ruling O) ──
// Satırlar gerçek kayıt biçiminde (sohbet.ts mesajEkle; kaynaklar dongu.ts, zamanlayici.ts, raporcu.ts, eslikci.ts, seslenme-yanit.ts).
let sira = 0;
const iz = (sohbetId: number, rol: string, metinli: boolean, kaynak?: string) => ({ sohbetId, id: ++sira, rol, kaynak, metinli });

test('yanitSay: araçlı tur bir yanıt; yerel, hızlı ve tarayıcı yanıtı sayılır; sohbetler birbirine karışmaz', () => {
  const izler = [
    // Sohbet 1: araçlı tur (ara mesaj metinsiz, araç sonucu, son yanıt metinli) → 1 yanıt
    iz(1, 'user', true, 'kullanici'), iz(1, 'assistant', false), iz(1, 'user', true, 'arac'), iz(1, 'assistant', true),
    // ada'dan sesli soru, yerel gündelik yanıt → 1
    iz(1, 'user', true, 'ses'), iz(1, 'assistant', true, 'yerel'),
    // gün kaydı seslenmesi: kullanıcı satırı + hızlı yanıt → 1
    iz(1, 'user', true, 'ses'), iz(1, 'assistant', true, 'hizli'),
    // telefondan → 1
    iz(1, 'user', true, 'mobil'), iz(1, 'assistant', true),
    // Sohbet 2 (tarayıcının "Fuber'e sor"u ana sohbete düşer; burada ayrı sohbet): önceki sohbetin bekleyen turu taşınmaz → 1
    iz(1, 'user', true, 'kullanici'),
    iz(2, 'assistant', true), iz(2, 'user', true, 'kullanici'), iz(2, 'assistant', true), iz(2, 'assistant', true),
  ];
  assert.equal(yanitSay(izler), 5);
  assert.equal(yanitSay([...izler].reverse()), 5, 'sıra girdiye bağlı değil (sohbet + kimlik)');
  assert.equal(yanitSay([]), 0);
});

test('yanitSay (düzeltme turu 2): 2 başarısız tur + proaktif + eşlikçi → 0 (not bekleyen turu kapatır; kendiliğinden mesaj yanıtlamaz)', () => {
  // Denetimde doğrulanan dizi: eskiden 2 sayılıyordu.
  const dizi = [
    iz(1, 'user', true, 'kullanici'), iz(1, 'not', true), // "⚠ 401 …" hata notu
    iz(1, 'user', true, 'kullanici'), iz(1, 'not', true),
    iz(1, 'assistant', true, 'proaktif'), // hatırlatıcı / rapor (zamanlayici.ts, raporcu.ts)
    iz(1, 'assistant', true, 'eslikci'),
  ];
  assert.equal(yanitSay(dizi), 0);
  // Not olmasa da (ör. bu sürümde metinsiz durdurulan tur iz bırakmaz) kendiliğinden mesaj bekleyen turu yanıtlamaz.
  assert.equal(yanitSay([iz(3, 'user', true, 'kullanici'), iz(3, 'assistant', true, 'proaktif'), iz(3, 'assistant', true, 'eslikci'), iz(3, 'assistant', true, 'bilinmeyen-kaynak')]), 0);
  // Ajan döngüsündeki kendiliğinden iş: görünmez tetik rol 'not' (kaynak proaktif), yanıtı kaynaksız → 0; ardından gerçek tur → 1.
  assert.equal(yanitSay([iz(4, 'user', true, 'kullanici'), iz(4, 'not', true, 'proaktif'), iz(4, 'assistant', true), iz(4, 'user', true, 'kullanici'), iz(4, 'assistant', true)]), 1);
  // Kendiliğinden işin 'user' kaydı (gizliTetik'siz) kullanıcı turu sayılmaz.
  assert.equal(yanitSay([iz(5, 'user', true, 'proaktif'), iz(5, 'assistant', true)]), 0);
});

test('yanitSay: durdurulan tur — yarım metinle bir yanıt, metinsiz değil ("Durduruldu." notu rol \'not\', K14)', () => {
  // K14 biçimi: yarım metin Fuber mesajı (kaynak 'durduruldu') + kalıcı "Durduruldu." notu.
  assert.equal(yanitSay([iz(1, 'user', true, 'kullanici'), iz(1, 'assistant', true, 'durduruldu'), iz(1, 'not', true)]), 1, 'yarım metinle durduruldu');
  assert.equal(yanitSay([iz(1, 'user', true, 'kullanici'), iz(1, 'not', true)]), 0, 'metinsiz durduruldu');
  // Araç çalışırken durduruldu: ara mesaj metinsiz, not → 0; sonra gelen eşlikçi de yanıtlamaz.
  assert.equal(yanitSay([iz(1, 'user', true, 'kullanici'), iz(1, 'assistant', false), iz(1, 'user', true, 'arac'), iz(1, 'not', true), iz(1, 'assistant', true, 'eslikci')]), 0);
  // Metinli ara mesajdan sonra hata: kullanıcı yanıtın bir kısmını gördü → 1 (bir kez).
  assert.equal(yanitSay([iz(1, 'user', true, 'kullanici'), iz(1, 'assistant', true), iz(1, 'user', true, 'arac'), iz(1, 'not', true)]), 1);
});

test('MESAJ_IZI_SQL: yalnız pencere (olusturma dizini), metinsiz Fuber mesajı ve araç sonucu okunmaz; sayım gerçek kayıtlarla', () => {
  const vt = new DatabaseSync(':memory:');
  // vt.ts göç 1 (mesajlar) + göç 4 (dizin), sayıma giren sütunlarla.
  vt.exec(`CREATE TABLE mesajlar(id INTEGER PRIMARY KEY, sohbet_id INTEGER NOT NULL, rol TEXT NOT NULL, metin TEXT NOT NULL DEFAULT '',
    bloklar TEXT NOT NULL DEFAULT '[]', ham TEXT, kaynak TEXT, model TEXT, atiflar TEXT, olusturma TEXT NOT NULL);
    CREATE INDEX mesajlar_sohbet ON mesajlar(sohbet_id, id);
    CREATE INDEX IF NOT EXISTS mesajlar_olusturma ON mesajlar(olusturma);`);
  const ekle = vt.prepare('INSERT INTO mesajlar(sohbet_id, rol, metin, kaynak, olusturma) VALUES(?,?,?,?,?)');
  const AY = '2026-10-01T00:00:00.000Z';
  // Geçen ay: yanıtlanmış tur (pencere dışı, okunmaz).
  ekle.run(1, 'user', 'eski soru', 'kullanici', '2026-09-30T10:00:00.000Z');
  ekle.run(1, 'assistant', 'eski yanıt', null, '2026-09-30T10:00:05.000Z');
  // Bu ay: denetimdeki dizi (2 başarısız tur + proaktif + eşlikçi) → 0
  ekle.run(1, 'user', 'Bugün ne var?', 'kullanici', '2026-10-24T09:00:00.000Z');
  ekle.run(1, 'not', '⚠ page.goto: net::ERR_NAME_NOT_RESOLVED at https://ornek.test', null, '2026-10-24T09:00:03.000Z');
  ekle.run(1, 'user', 'Tekrar dene', 'kullanici', '2026-10-24T09:01:00.000Z');
  ekle.run(1, 'not', '⚠ 401 invalid x-api-key', null, '2026-10-24T09:01:02.000Z');
  ekle.run(1, 'assistant', 'Saat 14:00 toplantını hatırlatırım.', 'proaktif', '2026-10-24T09:30:00.000Z');
  ekle.run(1, 'assistant', 'Bu arada, Ece dün de bunu sormuştu.', 'eslikci', '2026-10-24T09:31:00.000Z');
  // Araçlı tamamlanmış tur → 1 (metinsiz ara mesaj ve araç sonucu sorguya girmez)
  ekle.run(1, 'user', 'Gelen kutuma bak', 'kullanici', '2026-10-24T10:00:00.000Z');
  ekle.run(1, 'assistant', '', null, '2026-10-24T10:00:02.000Z');
  ekle.run(1, 'user', '', 'arac', '2026-10-24T10:00:04.000Z');
  ekle.run(1, 'assistant', 'İki önemli e-posta var.', null, '2026-10-24T10:00:09.000Z');
  // Yarım metinle durduruldu → 1; metinsiz durduruldu → 0
  ekle.run(1, 'user', 'Uzun bir rapor yaz', 'kullanici', '2026-10-24T11:00:00.000Z');
  ekle.run(1, 'assistant', 'Raporun ilk bölümü…', 'durduruldu', '2026-10-24T11:00:06.000Z');
  ekle.run(1, 'not', 'Durduruldu.', null, '2026-10-24T11:00:06.500Z');
  ekle.run(1, 'user', 'Başka bir şey', 'kullanici', '2026-10-24T11:05:00.000Z');
  ekle.run(1, 'not', 'Durduruldu.', null, '2026-10-24T11:05:01.000Z');
  const satirlar = vt.prepare(MESAJ_IZI_SQL).all(AY) as unknown as MesajIzi[];
  assert.ok(satirlar.every((s) => s.rol !== 'assistant' || Number(s.metinli) === 1), 'metinsiz Fuber mesajı okunmaz');
  assert.ok(satirlar.every((s) => s.kaynak !== 'arac'), 'araç sonucu okunmaz');
  assert.equal(satirlar.length, 13, 'pencere dışı 2 + metinsiz 1 + araç sonucu 1 okunmaz');
  assert.equal(yanitSay(satirlar), 2);
  const plan = (vt.prepare(`EXPLAIN QUERY PLAN ${MESAJ_IZI_SQL}`).all(AY) as unknown as { detail: string }[]).map((p) => p.detail).join(' | ');
  assert.match(plan, /mesajlar_olusturma/, `pencere dizinle okunur (bütün tablo taranmaz): ${plan}`);
  vt.close();
});

// Birleştirme (G20a + G20b): sayaç (yanitSay, YANIT_KAYNAKLARI) ile durdurma kaydının ÜRETİCİSİ (main/ajan/durdurma.ts
// durdurmaKayitlari, dongu.ts'in durdurulunca yazdığı) birlikte — elle yazılmış biçim değil, gerçek kayıtlar sorgudan geçer.
test('K14 uçtan uca: durdurmaKayitlari\'nın yazdığı kayıtlar — yarım metinle durdurulan tur 1 yanıt, metinsiz 0', () => {
  const vt = new DatabaseSync(':memory:');
  vt.exec(`CREATE TABLE mesajlar(id INTEGER PRIMARY KEY, sohbet_id INTEGER NOT NULL, rol TEXT NOT NULL, metin TEXT NOT NULL DEFAULT '',
    kaynak TEXT, model TEXT, olusturma TEXT NOT NULL); CREATE INDEX mesajlar_olusturma ON mesajlar(olusturma);`);
  const ekle = vt.prepare('INSERT INTO mesajlar(sohbet_id, rol, metin, kaynak, model, olusturma) VALUES(?,?,?,?,?,?)');
  let saniye = 0;
  const z = () => new Date(Date.UTC(2026, 9, 24, 12, 0, saniye++)).toISOString();
  // sohbet.ts mesajEkle ile aynı: metin = metin bloklarının birleşimi (kırpılmış).
  const yaz = (sohbet: number, k: DurdurmaKaydi) => ekle.run(sohbet, k.rol, k.bloklar.filter((b) => b.tur === 'metin').map((b) => (b as { metin: string }).metin).join('\n').trim(), k.kaynak ?? null, k.model ?? null, z());
  const tur = (sohbet: number, yarimMetin: string) => {
    ekle.run(sohbet, 'user', 'Uzun bir rapor yaz', 'kullanici', null, z());
    for (const k of durdurmaKayitlari({ yarimMetin, model: 'claude-opus-5-5' })) yaz(sohbet, k);
  };
  const say = (sohbet: number) => yanitSay((vt.prepare(MESAJ_IZI_SQL).all('2026-10-01T00:00:00.000Z') as unknown as MesajIzi[]).filter((s) => s.sohbetId === sohbet));
  tur(1, 'Raporun ilk bölümü: gelir 12 % arttı');
  tur(2, '');
  tur(3, '   \n');
  assert.equal(say(1), 1, 'yarım metinle durduruldu → 1');
  assert.equal(say(2), 0, 'metinsiz durduruldu → 0');
  assert.equal(say(3), 0, 'yalnız boşluk akmışken durduruldu → 0');
  const kayit1 = vt.prepare('SELECT rol, kaynak, metin FROM mesajlar WHERE sohbet_id = 1 ORDER BY id').all() as { rol: string; kaynak: string | null; metin: string }[];
  assert.deepEqual(kayit1.map((r) => [r.rol, r.kaynak, r.metin]), [['user', 'kullanici', 'Uzun bir rapor yaz'], ['assistant', 'durduruldu', 'Raporun ilk bölümü: gelir 12 % arttı'], ['not', null, DURDURULDU]]);
  // Durdurulan turdan sonra yeni bir tam tur: sayaç sohbeti doğru sürdürür (not bekleyeni kapattı, yeni tur kendi yanıtıyla 1).
  ekle.run(2, 'user', 'Kısaca yaz', 'kullanici', null, z()); ekle.run(2, 'assistant', 'Tamam: gelir arttı.', null, null, z());
  assert.equal(say(2), 1);
  vt.close();
});

test('arka plan işi: yanıtı veren çağrılar (sohbet, hızlı/seslenme) dışındaki motor işleri', () => {
  for (const a of ['sohbet', 'hizli', 'hizli:sinif', 'hitap']) assert.equal(arkaPlanMi(a), false, a);
  for (const a of ['hafiza-yazici', 'gunkaydi:not', 'gunkaydi:rapor', 'kokpit', 'baslik', 'ozet', 'eposta-onem', 'proaktif', 'iceaktar:ozet']) assert.equal(arkaPlanMi(a), true, a);
  const o = kullanimDerle([
    satir({ saglayici: 'anthropic', model: 'claude-opus-5-5', amac: 'sohbet', istek: 9 }),
    satir({ saglayici: 'anthropic', model: 'claude-haiku-5-5', amac: 'hafiza-yazici', istek: 4 }),
    satir({ saglayici: 'anthropic', model: 'claude-haiku-5-5', amac: 'kokpit', istek: 3 }),
  ], undefined, [{ sohbetId: 1, id: 1, rol: 'user', kaynak: 'kullanici', metinli: 1 }, { sohbetId: 1, id: 2, rol: 'assistant', metinli: 1 }]);
  assert.deepEqual([o.istek, o.yanit, o.arkaPlan], [16, 1, 7], '16 işlem: 1 yanıt (9 çağrılık araçlı tur) + 7 arka plan işi');
});
