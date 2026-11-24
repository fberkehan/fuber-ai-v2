// 0.12 cila düzeltme turu 3 (yeniden inceleme 2, N-10 Important + N-11…N-14): özeti çıkarılamayan belgelerin yeniden denemesi SINIRLI.
// Turu 2'de geçici hata hak harcamıyordu ama sınıflama "bilinen kalıcılar dışındaki her şey geçici" idi: yerel 90 sn zaman aşımı, Fuber
// ağ geçidinin "boş yanıt"ı ('bilinmiyor') ve 'bilinmiyor' kodlu 4xx'ler geçici sayılıp SONSUZA DEK yeniden deneniyordu — bulutta
// kullanıcının kredisinden sınırsız harcama riski; aynı en düşük 5 id her tikte seçiliyor, koşu ilk geçici hatada durmuyordu. Artık:
//  · kalıcı: zaman aşımı, boş yanıt, 'bilinmiyor'/'istek' 4xx, bağlam aşımı → hak harcar (3'te durur); özet çağrısı iç yeniden denemesiz;
//  · geçici yalnız: bağlantı kurulamadı / sunucu kapalı, 5xx, 429/limit, anahtar/oturum → hak harcamaz, ama koşu İLK geçici sonuçta durur ve
//    zamanlayıcı geri çekilir (15 → 30 → 60 dk … en çok 6 sa; başarıda sıfır);
//  · sıra: hakkı kalanlar, en az denenmiş, sonra en uzun süredir denenmemiş (COALESCE(islenme, olusturma));
//  · N-11 "Dosya öğret" uzun koşu sürerken sessizce 0 dönmez (bekler, sonra dener; yapılamıyorsa "özet sonra" olayı); N-12 boş metinli
//    belge sırayı tutmaz; N-13 telefon Daha sayacı; N-14 Bağlantılar özetsiz olayını dinler.
// GERÇEK iceaktar.ts / zamanlayici.ts / motor seçici; sahte yerel model (FUBER_YEREL_TABAN) ve sahte Fuber ağ geçidi (127.0.0.1), ağ yok.
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { anaSurecSahnesi, ipcKurBos } from './yardimci/ana-surec.ts';
import { fuberBicimi, openaiYaz } from './yardimci/openai-sahte.ts';

type Kip = 'normal' | 'cokme' | 'yavas';
let kip: Kip = 'normal';
/** Özet istekleri: hangi belge (kullanıcı satırındaki "Belge: <ad>") ve o anki kip. */
const yerelOzet: { belge: string; kip: Kip }[] = [];
const govde = async (q: http.IncomingMessage) => { let h = ''; for await (const d of q) h += d; return JSON.parse(h || '{}'); };
const metniAl = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((p) => p?.type === 'text').map((p) => p.text).join(' ') : '');
const yerelSunucu = http.createServer(async (q, r) => {
  const g = await govde(q);
  const l = (g.messages ?? []) as { role: string; content: unknown }[];
  const sistem = metniAl(l[0]?.content);
  const ozet = /2-4 cümleyle Türkçe özetle/.test(sistem);
  if (ozet) {
    yerelOzet.push({ belge: /Belge: (\S+)/.exec(metniAl(l.at(-1)?.content))?.[1] ?? '', kip });
    if (kip === 'cokme') { r.writeHead(503, { 'content-type': 'application/json' }); r.end('{"error":{"code":503,"message":"Loading model"}}'); return; }
    if (kip === 'yavas') await new Promise((c) => setTimeout(c, 700));
  }
  const content = /hafıza yazıcısısın/.test(sistem) ? '{"islemler":[]}' : /"selamlama"/.test(sistem) ? '{"selamlama":"Merhaba","odak":"","kartlar":[]}' : ozet ? 'Yerel özet: teslim cuma.' : 'Tamam.';
  r.writeHead(200, { 'content-type': 'application/json' });
  r.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
});
/** Sahte Fuber ağ geçidi: özet isteğine BOŞ yanıt (akıl yürütme modelinde max_tokens dolmuş gibi), ötekilere kısa yanıt. */
const bulutOzet: string[] = [];
const bulutSunucu = http.createServer(async (q, r) => {
  const g = fuberBicimi(await govde(q));
  const sistem = String(g.systemPrompt ?? '');
  const ozet = /2-4 cümleyle Türkçe özetle/.test(sistem);
  if (ozet) bulutOzet.push(q.url ?? '');
  openaiYaz(r, ozet ? '' : /hafıza yazıcısısın/.test(sistem) ? '{"islemler":[]}' : 'Tamam.');
});
const dinle = async (s: http.Server) => { await new Promise<void>((c) => s.listen(0, '127.0.0.1', c)); return `http://127.0.0.1:${(s.address() as { port: number }).port}`; };
const YEREL_TABAN = await dinle(yerelSunucu);
const BULUT_TABAN = await dinle(bulutSunucu);
after(() => Promise.all([yerelSunucu, bulutSunucu].map((s) => new Promise<void>((c) => s.close(() => c())))));

const sahne = anaSurecSahnesi('belge-ozet-sinir', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', hitap: 'Deniz', mod: 'gelistirici', tanitimSurumu: '0.9.0',
  ses: { surum: 2, uyandirma: false }, proaktif: { etkin: false, sessizBaslangic: '00:00', sessizBitis: '00:00' }, baslangictaAc: false, motorCalisti: true,
  yerel: { gpu: 'cpu', yalnizYerel: true, etkin: true, model: 'bonsai2-4b' },
});
(globalThis as Record<string, unknown>).__sifreleme = true;
process.env.FUBER_DEMO = '1';
process.env.FUBER_YEREL_TABAN = YEREL_TABAN;
await ipcKurBos();
const yerelFetch = (globalThis as Record<string, unknown>).__yerelFetch as typeof fetch;
globalThis.fetch = ((u: string, i?: RequestInit) => yerelFetch(u, i)) as typeof fetch;

const { ayarlariKaydet, sirYaz } = await import('../src/main/ayarlar.ts');
const { tekMotorYolu } = await import('../src/main/motor/yerel.ts');
const { MotorHatasi } = await import('../src/main/motor/tipler.ts');
const iceaktar = await import('../src/main/iceaktar.ts') as Record<string, unknown> & typeof import('../src/main/iceaktar.ts');
const zamanlayici = await import('../src/main/zamanlayici.ts') as Record<string, unknown>;
const { hafizaYaziminiBekle } = await import('../src/main/hafiza/yazici.ts');
const { veritabani, meta } = await import('../src/main/vt.ts');
const { herOlayiDinle } = await import('../src/main/olaylar.ts');
after(() => { delete process.env.FUBER_YEREL_TABAN; });

const olaylar: { kanal: string; veri: unknown }[] = [];
herOlayiDinle((kanal, veri) => { if (kanal.startsWith('iceaktar:')) olaylar.push({ kanal, veri }); });
const bekle = async <T>(f: () => T | undefined | false, ms = 8000): Promise<T> => {
  const bas = Date.now();
  for (;;) { const v = f(); if (v) return v; if (Date.now() - bas > ms) throw new Error('beklenen olmadı'); await new Promise((c) => setTimeout(c, 25)); }
};
let no = 0;
const belgeYaz = (tohum: string) => { const d = path.join(sahne.klasor, `sinir-${++no}.txt`); fs.writeFileSync(d, `${tohum} ${no}: proje teslimi cuma; sorumlu Deniz. Müşteri sunumu salı günü yapılacak, bütçe onaylandı.`); return d; };
const satir = (yol: string) => veritabani().prepare('SELECT id, durum, ozet, hata FROM belgeler WHERE yol = ?').get(yol) as { id: number; durum: string; ozet: string | null; hata: string | null } | undefined;
const islenmis = async (yol: string) => bekle(() => { const s = satir(yol); return s && s.durum !== 'bekliyor' ? s : undefined; });
const deneme = (id: number) => Number(meta(`iceaktar:ozet-deneme:${id}`) ?? 0);
const temizle = () => veritabani().prepare("UPDATE belgeler SET durum = 'islendi' WHERE durum = 'ozetsiz'").run();
/** Yerel sunucu 503 iken içe aktarılan (geçici hatayla 'ozetsiz' kalan) belge. */
const geciciBelge = async (tohum: string) => { kip = 'cokme'; const y = belgeYaz(tohum); try { iceaktar.dosyaOgret(y); await islenmis(y); } finally { kip = 'normal'; } return y; };

test('sınıflama: kalıcı = zaman aşımı, boş yanıt, bilinmiyor/istek 4xx, bağlam aşımı; geçici = bağlantı, sunucu kapalı, 5xx, 429/limit, anahtar', () => {
  const tur = iceaktar.ozetHataTuru as ((e: unknown) => 'kalici' | 'gecici') | undefined;
  assert.equal(typeof tur, 'function', 'iceaktar.ts ozetHataTuru');
  const zamanAsimi = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const kalici = [
    zamanAsimi,
    new MotorHatasi('Fuber gateway boş yanıt döndü (akıl yürütme modelinde max_tokens dolmuş olabilir).', 'bilinmiyor', true),
    new MotorHatasi('Claude hatası 404: model not found', 'bilinmiyor'),
    new MotorHatasi('OpenAI hatası 413: request too large', 'bilinmiyor'),
    new MotorHatasi('OpenRouter hatası 422: unprocessable', 'bilinmiyor'),
    new MotorHatasi('Fuber gateway: geçersiz istek', 'istek'),
    new MotorHatasi('Bu bilgisayardaki yapay zekâ boş yanıt verdi.', 'istek', true),
    new MotorHatasi('Bu bilgisayardaki yapay zekânın bağlamına sığmadı.', 'istek'),
    new Error('beklenmeyen'),
  ];
  const gecici = [
    Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }),
    new MotorHatasi('Bu bilgisayardaki yapay zekâ açılamadı.', 'baglanti'),
    new MotorHatasi('Fuber gateway sunucusuna bağlanılamadı.', 'baglanti', true),
    new MotorHatasi('Yerel model hatası: HTTP 503 {"error":"Loading model"}', 'istek'),
    new MotorHatasi('OpenAI hatası 502: bad gateway', 'bilinmiyor', true),
    new MotorHatasi('Fuber gateway hız sınırı (dakikada N istek).', 'limit', true),
    new MotorHatasi('Fuber gateway kredisi yetersiz.', 'limit'),
    new MotorHatasi('Fuber gateway anahtarı reddedildi: ...', 'anahtar'),
  ];
  for (const e of kalici) assert.equal(tur!(e), 'kalici', (e as Error).message);
  for (const e of gecici) assert.equal(tur!(e), 'gecici', (e as Error).message);
});

test('BULUT boş yanıt (OpenAI uyumlu sağlayıcı): hak harcanır — en çok 3 özet çağrısı, sonsuz döngü yok, iç yeniden deneme yok', async () => {
  temizle();
  ayarlariKaydet((a) => {
    a.yerel.yalnizYerel = false;
    a.motorSecimi = 'openai';
    a.openaiUyumlu = { tabanUrl: `${BULUT_TABAN}/v1`, model: 'sahte-model' };
  });
  try {
    assert.equal(tekMotorYolu(), 'bulut');
    const yol = belgeYaz('Bulut boş yanıt');
    const once = bulutOzet.length;
    iceaktar.dosyaOgret(yol);
    const s = await islenmis(yol);
    assert.equal(s.durum, 'ozetsiz');
    for (let i = 0; i < 6; i++) await iceaktar.ozetsizBelgeleriIsle();
    assert.equal(bulutOzet.length - once, 3, `en çok 3 çağrı (içe aktarma + 2 yeniden deneme): ${bulutOzet.length - once}`);
    assert.equal(deneme(s.id), 3);
    assert.equal(satir(yol)?.hata, 'özet çıkarılamadı; deneme hakkı bitti');
  } finally {
    ayarlariKaydet((a) => { a.yerel.yalnizYerel = true; });
    await hafizaYaziminiBekle();
  }
});

test('geçici hata → koşu İLK geçici sonuçta durur (kalan belgeler boşuna denenmez); hak harcanmaz', async () => {
  temizle();
  const yollar = [await geciciBelge('Durma A'), await geciciBelge('Durma B'), await geciciBelge('Durma C')];
  const once = yerelOzet.length;
  kip = 'cokme';
  try { assert.equal(await iceaktar.ozetsizBelgeleriIsle(), 0); } finally { kip = 'normal'; }
  assert.equal(yerelOzet.length - once, 1, `tek istek: ${JSON.stringify(yerelOzet.slice(once))}`);
  for (const y of yollar) assert.equal(deneme(satir(y)!.id), 0);
});

test('sıra: geçici hatayla denenen belge sıranın sonuna geçer (COALESCE(islenme, olusturma)) — aynı belge her koşuda başa gelmez', async () => {
  temizle();
  await geciciBelge('Sıra A');
  await new Promise((c) => setTimeout(c, 20));
  await geciciBelge('Sıra B');
  const once = yerelOzet.length;
  kip = 'cokme';
  try {
    await iceaktar.ozetsizBelgeleriIsle();
    await new Promise((c) => setTimeout(c, 20));
    await iceaktar.ozetsizBelgeleriIsle();
  } finally { kip = 'normal'; }
  const r = yerelOzet.slice(once).map((x) => x.belge);
  assert.equal(r.length, 2, JSON.stringify(r));
  assert.notEqual(r[0], r[1], `ikinci koşu başka belgeyi denedi: ${JSON.stringify(r)}`);
});

test('geri çekilme: art arda geçici koşularda aralık 15 → 30 → 60 dk (en çok 6 sa); bir başarıda 15 dk\'ya döner', async () => {
  temizle();
  const bekleyenOzetler = zamanlayici.bekleyenOzetler as ((simdi?: number) => boolean) | undefined;
  const bitti = zamanlayici.bekleyenOzetlerBitti as (() => Promise<unknown>) | undefined;
  const aralik = zamanlayici.ozetAraligi as (() => number) | undefined;
  assert.equal(typeof bitti, 'function', 'zamanlayici.ts bekleyenOzetlerBitti');
  assert.equal(typeof aralik, 'function', 'zamanlayici.ts ozetAraligi');
  await geciciBelge('Geri çekilme');
  const DK = 60_000;
  let t = Date.now() + 30 * 24 * 3600_000; // önceki testlerin zamanlayıcı damgasından uzak
  kip = 'cokme';
  try {
    assert.equal(bekleyenOzetler!(t), true); await bitti!();
    assert.equal(aralik!(), 30 * DK, '1 geçici koşu → 30 dk');
    assert.equal(bekleyenOzetler!(t + 16 * DK), false, '15 dk sonra denenmez');
    t += 31 * DK; assert.equal(bekleyenOzetler!(t), true); await bitti!();
    assert.equal(aralik!(), 60 * DK, '2 geçici koşu → 60 dk');
    for (let i = 0; i < 6; i++) { t += 7 * 3600_000; bekleyenOzetler!(t); await bitti!(); }
    assert.equal(aralik!(), 6 * 3600_000, 'tavan 6 sa');
  } finally { kip = 'normal'; }
  t += 7 * 3600_000;
  assert.equal(bekleyenOzetler!(t), true); await bitti!();
  assert.equal(aralik!(), 15 * DK, 'başarı → 15 dk');
  await hafizaYaziminiBekle();
});

test('N-12: boş metinli (parçasız) "özetsiz" belge sırayı tutmaz — hakkı bitmiş sayılır, öteki belge denenir', async () => {
  temizle();
  const vt = veritabani();
  const bos = Number(vt.prepare("INSERT INTO belgeler(yol, ad, tur, boyut, ozet_hash, durum, olusturma) VALUES(?,?,?,?,?, 'ozetsiz', ?)").run('bos.txt', 'bos.txt', 'txt', 0, 'bos-hash:0', '2000-01-01T00:00:00.000Z').lastInsertRowid);
  const y = await geciciBelge('Boşun ardı');
  assert.equal(await iceaktar.ozetsizBelgeleriIsle(), 1);
  await hafizaYaziminiBekle();
  assert.equal(satir(y)?.durum, 'islendi');
  assert.equal((vt.prepare('SELECT hata FROM belgeler WHERE id = ?').get(bos) as { hata: string }).hata, 'özet çıkarılamadı; deneme hakkı bitti');
});

test('N-11: "Dosya öğret" kendiliğinden koşu sürerken sessizce 0 dönmez — koşuyu bekler, sonra belgeyi dener', async () => {
  temizle();
  const a = await geciciBelge('Uzun koşu');
  const b = await geciciBelge('Elle öğret');
  // B'nin kendiliğinden hakkı bitmiş olsun: onu yalnız "Dosya öğret" dener (kendiliğinden koşu yalnız A'yı alır).
  const { metaYaz } = await import('../src/main/vt.ts');
  metaYaz(`iceaktar:ozet-deneme:${satir(b)!.id}`, '3');
  veritabani().prepare('UPDATE belgeler SET hata = ? WHERE id = ?').run('özet çıkarılamadı; deneme hakkı bitti', satir(b)!.id);
  kip = 'yavas';
  try {
    // A en eskisi (önce denenir); koşu sürerken B için "Dosya öğret".
    const kosu = iceaktar.ozetsizBelgeleriIsle();
    await bekle(() => yerelOzet.some((x) => x.kip === 'yavas'));
    iceaktar.dosyaOgret(b);
    await kosu;
    await bekle(() => satir(b)?.durum === 'islendi', 10_000);
  } finally { kip = 'normal'; }
  await hafizaYaziminiBekle();
  assert.equal(satir(b)?.durum, 'islendi');
  assert.ok(['islendi', 'ozetsiz'].includes(satir(a)?.durum ?? ''));
});

test('N-11: yol yokken "Dosya öğret" özetsiz belgeyi yeniden seçerse sessiz kalınmaz — "özet sonra" olayı', async () => {
  temizle();
  const y = await geciciBelge('Yol yok');
  delete process.env.FUBER_YEREL_TABAN;
  ayarlariKaydet((a) => { a.yerel.etkin = false; });
  try {
    assert.equal(tekMotorYolu(), 'yok');
    olaylar.length = 0;
    iceaktar.dosyaOgret(y);
    await bekle(() => olaylar.find((o) => o.kanal === 'iceaktar:ozet-sonra'));
    assert.ok(!olaylar.some((o) => o.kanal === 'iceaktar:zaten'));
  } finally {
    process.env.FUBER_YEREL_TABAN = YEREL_TABAN;
    ayarlariKaydet((a) => { a.yerel.etkin = true; });
  }
});
