// 0.12 cila düzeltme turu 2 (yeniden inceleme N-1, N-2, N-3, N-9): özeti çıkarılamayan içe aktarılmış belgeler ('ozetsiz').
//  · N-2: motor yolu yokken (model iniyor / hesap onay bekliyor) belge boş özetle "işlendi" OLMAZ — "özet sonra" kalır; yol hazır olunca
//    zamanlayıcı özetler (hak harcanmaz).
//  · N-1: yalnız bağlam/biçim hataları (kalıcı) deneme hakkı harcar; bağlantı / sunucu kapalı / 5xx (geçici) harcamaz. Yeniden deneme sırası
//    hakkı bitenleri dışlar (en az denenmiş, en eski önce) — önceki "ORDER BY id LIMIT 5" hakkı biten 5 belgede takılıyordu. Hak bitince
//    arayüz "yeniden dener" demez (ozetHakkiBitti → "Dosya öğret ile yeniden dene").
//  · N-3: içe aktarma sayaçları 'ozetsiz'i sayar (bekleyen değil).
//  · N-9: kendiliğinden yeniden deneme sessiz saatte ve "Rahatsız etme"de bekler (zamanlayici.ts sessizMi).
// GERÇEK iceaktar.ts / belge-depo.ts / zamanlayici.ts; yerel model sahte (FUBER_YEREL_TABAN), bulut yok, ağ yok.
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { anaSurecSahnesi, ipcKurBos } from './yardimci/ana-surec.ts';

type Kip = 'normal' | 'asim' | 'cokme';
let kip: Kip = 'normal';
const ozetIstekleri: string[] = [];
const yerelSunucu = http.createServer(async (q, r) => {
  let h = '';
  for await (const d of q) h += d;
  const l = (JSON.parse(h || '{}').messages ?? []) as { role: string; content: string }[];
  const sistem = String(l[0]?.content ?? '');
  const ozet = /2-4 cümleyle Türkçe özetle/.test(sistem);
  if (ozet) ozetIstekleri.push(kip);
  if (ozet && kip === 'asim') {
    r.writeHead(400, { 'content-type': 'application/json' });
    r.end(JSON.stringify({ error: { code: 400, message: 'the request exceeds the available context size, try increasing it', type: 'exceed_context_size_error' } }));
    return;
  }
  if (ozet && kip === 'cokme') { r.writeHead(503, { 'content-type': 'application/json' }); r.end('{"error":{"code":503,"message":"Loading model"}}'); return; }
  const content = /hafıza yazıcısısın/.test(sistem) ? '{"islemler":[]}' : /"selamlama"/.test(sistem) ? '{"selamlama":"Merhaba","odak":"","kartlar":[]}' : ozet ? 'Yerel özet: teslim cuma.' : 'Tamam.';
  r.writeHead(200, { 'content-type': 'application/json' });
  r.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
});
await new Promise<void>((c) => yerelSunucu.listen(0, '127.0.0.1', c));
after(() => new Promise<void>((c) => yerelSunucu.close(() => c())));
const YEREL_TABAN = `http://127.0.0.1:${(yerelSunucu.address() as { port: number }).port}`;

const sahne = anaSurecSahnesi('belge-ozet-yeniden', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', hitap: 'Deniz', mod: 'is', tanitimSurumu: '0.9.0',
  // Sessiz saat aralığı boş (00:00–00:00): testler günün saatinden bağımsız; sessiz saat testi kendi aralığını kurar.
  ses: { surum: 2, uyandirma: false }, proaktif: { etkin: false, sessizBaslangic: '00:00', sessizBitis: '00:00' }, baslangictaAc: false,
  // "Yalnız bu bilgisayar" seçili, yerel kurulu değil, istenmiş kurulumun kaydı var: yol 'yok' (model iniyor).
  yerel: { gpu: 'cpu', yalnizYerel: true, etkin: false, model: 'bonsai2-4b', bekleyenKurulum: { model: 'bonsai2-4b', zaman: new Date().toISOString() } },
});
(globalThis as Record<string, unknown>).__sifreleme = true;
process.env.FUBER_DEMO = '1';
delete process.env.FUBER_YEREL_TABAN;
await ipcKurBos();
const yerelFetch = (globalThis as Record<string, unknown>).__yerelFetch as typeof fetch;
globalThis.fetch = ((u: string, i?: RequestInit) => yerelFetch(u, i)) as typeof fetch;

const { ayarlariKaydet } = await import('../src/main/ayarlar.ts');
const { tekMotorYolu } = await import('../src/main/motor/yerel.ts');
const iceaktar = await import('../src/main/iceaktar.ts');
const zamanlayici = await import('../src/main/zamanlayici.ts') as Record<string, unknown>;
const { hafizaYaziminiBekle } = await import('../src/main/hafiza/yazici.ts');
const { veritabani, meta, metaYaz } = await import('../src/main/vt.ts');
const { belgeListesi } = await import('../src/main/belge-depo.ts');
after(() => { delete process.env.FUBER_YEREL_TABAN; });

const bekle = async <T>(f: () => T | undefined | false, ms = 8000): Promise<T> => {
  const bas = Date.now();
  for (;;) { const v = f(); if (v) return v; if (Date.now() - bas > ms) throw new Error('beklenen olmadı'); await new Promise((c) => setTimeout(c, 25)); }
};
let no = 0;
const belgeYaz = (tohum: string) => { const d = path.join(sahne.klasor, `ozet-${++no}.txt`); fs.writeFileSync(d, `${tohum} ${no}: proje teslimi cuma; sorumlu Deniz. Müşteri sunumu salı günü yapılacak, bütçe onaylandı.`); return d; };
const satir = (yol: string) => veritabani().prepare('SELECT id, durum, ozet, hata FROM belgeler WHERE yol = ?').get(yol) as { id: number; durum: string; ozet: string | null; hata: string | null } | undefined;
const islenmis = async (yol: string) => bekle(() => { const s = satir(yol); return s && s.durum !== 'bekliyor' ? s : undefined; });
const deneme = (id: number) => Number(meta(`iceaktar:ozet-deneme:${id}`) ?? 0);
const yereliHazirla = (taban = YEREL_TABAN) => { process.env.FUBER_YEREL_TABAN = taban; ayarlariKaydet((a) => { a.yerel.etkin = true; delete a.yerel.bekleyenKurulum; }); };
const liste = (id: number) => belgeListesi(veritabani()).find((b) => b.id === id) as (ReturnType<typeof belgeListesi>[number] & { ozetHakkiBitti?: boolean }) | undefined;
/** Önceki testlerin bıraktığı 'ozetsiz' belgeler sonraki testin sayımını bozmasın. */
const temizle = () => veritabani().prepare("UPDATE belgeler SET durum = 'islendi' WHERE durum = 'ozetsiz'").run();

test('N-2: yol yokken (yapay zekâ iniyor) belge boş özetle "işlendi" OLMAZ — "özet sonra" kalır, hak harcanmaz; sayaçta "özetsiz" (N-3)', async () => {
  assert.equal(tekMotorYolu(), 'yok');
  const yol = belgeYaz('Bekleyen not');
  iceaktar.dosyaOgret(yol);
  const s = await islenmis(yol);
  assert.equal(s.durum, 'ozetsiz', `durum ${s.durum}`);
  assert.equal(s.ozet, null);
  assert.equal(deneme(s.id), 0, 'hak harcanmadı');
  assert.equal(ozetIstekleri.length, 0, 'model çağrısı yok');
  const d = iceaktar.iceAktarmaDurumu() as ReturnType<typeof iceaktar.iceAktarmaDurumu> & { ozetsiz?: number };
  assert.equal(d.ozetsiz, 1, 'N-3: sayaç özetsizi sayar');
  assert.equal(d.bekleyen, 0, '"bekliyor" sayılmaz');
  assert.notEqual(liste(s.id)?.ozetHakkiBitti, true, 'arayüz "sonra yeniden dener" der');
  // Yol hazır olunca zamanlayıcı özetler.
  yereliHazirla();
  assert.equal(await iceaktar.ozetsizBelgeleriIsle(), 1);
  await hafizaYaziminiBekle();
  assert.equal(satir(yol)?.durum, 'islendi');
  assert.match(satir(yol)?.ozet ?? '', /Yerel özet/);
});

test('N-1: geçici hatalar (sunucu kapalı / bağlantı yok, 5xx) deneme hakkı HARCAMAZ — belge kendiliğinden yeniden denenmeye devam eder', async () => {
  temizle();
  yereliHazirla('http://127.0.0.1:9'); // kapalı kapı: bağlantı reddedilir
  const yol = belgeYaz('Geçici not');
  iceaktar.dosyaOgret(yol);
  const s = await islenmis(yol);
  assert.equal(s.durum, 'ozetsiz');
  for (let i = 0; i < 4; i++) assert.equal(await iceaktar.ozetsizBelgeleriIsle(), 0);
  assert.equal(deneme(s.id), 0, 'bağlantı hatası hak harcamadı');
  yereliHazirla();
  kip = 'cokme';
  try { for (let i = 0; i < 3; i++) assert.equal(await iceaktar.ozetsizBelgeleriIsle(), 0); } finally { kip = 'normal'; }
  assert.equal(deneme(s.id), 0, '5xx hak harcamadı');
  assert.notEqual(liste(s.id)?.ozetHakkiBitti, true);
  assert.equal(await iceaktar.ozetsizBelgeleriIsle(), 1, 'sunucu düzelince özetlendi');
  await hafizaYaziminiBekle();
  assert.equal(satir(yol)?.durum, 'islendi');
});

test('N-1: kalıcı hata (bağlam aşımı, yarıya indirilmiş yeniden deneme de aşıyor) hak harcar; 3 hak bitince kendiliğinden denenmez ve arayüz "yeniden dener" demez', async () => {
  temizle();
  yereliHazirla();
  kip = 'asim';
  const yol = belgeYaz('Kalıcı not');
  try {
    iceaktar.dosyaOgret(yol);
    const s = await islenmis(yol);
    assert.equal(s.durum, 'ozetsiz');
    assert.equal(deneme(s.id), 1, 'ilk içe aktarma bir hak');
    await iceaktar.ozetsizBelgeleriIsle();
    await iceaktar.ozetsizBelgeleriIsle();
    assert.equal(deneme(s.id), 3);
    assert.equal(liste(s.id)?.ozetHakkiBitti, true, 'hak bitti: arayüz "Dosya öğret ile yeniden dene" der');
    const once = ozetIstekleri.length;
    assert.equal(await iceaktar.ozetsizBelgeleriIsle(), 0);
    assert.equal(ozetIstekleri.length, once, 'hakkı biten belgeye kendiliğinden istek yok');
  } finally { kip = 'normal'; }
  // "Dosya öğret" hak bitse de yeniden dener; başarıda iz kalkar.
  iceaktar.dosyaOgret(yol);
  await bekle(() => satir(yol)?.durum === 'islendi');
  assert.notEqual(liste(satir(yol)!.id)?.ozetHakkiBitti, true);
});

test('N-1 açlık: hakkı biten belgeler sıranın başını tutmaz — en az denenmiş / en eski sırayla, hakkı kalan belge denenir', async () => {
  temizle();
  yereliHazirla();
  kip = 'asim';
  const yollar: string[] = [];
  try {
    for (let i = 0; i < 6; i++) { const y = belgeYaz('Sıra notu'); yollar.push(y); iceaktar.dosyaOgret(y); await islenmis(y); }
  } finally { kip = 'normal'; }
  const idler = yollar.map((y) => satir(y)!.id);
  // İlk beşinin hakkı bitmiş olsun (en eski beş).
  for (const id of idler.slice(0, 5)) { metaYaz(`iceaktar:ozet-deneme:${id}`, '3'); veritabani().prepare('UPDATE belgeler SET hata = ? WHERE id = ?').run('özet çıkarılamadı; deneme hakkı bitti', id); }
  assert.equal(await iceaktar.ozetsizBelgeleriIsle(), 1, 'altıncı (hakkı kalan) belge denendi');
  await hafizaYaziminiBekle();
  assert.equal(satir(yollar[5])?.durum, 'islendi');
  for (const y of yollar.slice(0, 5)) assert.equal(satir(y)?.durum, 'ozetsiz');
});

test('N-9: kendiliğinden yeniden deneme sessiz saatte bekler; sessiz saat dışında çalışır', async () => {
  temizle();
  yereliHazirla();
  const bekleyenOzetler = zamanlayici.bekleyenOzetler as ((simdi?: number) => boolean) | undefined;
  assert.equal(typeof bekleyenOzetler, 'function', 'zamanlayici.ts bekleyenOzetler');
  delete process.env.FUBER_YEREL_TABAN;
  ayarlariKaydet((a) => { a.yerel.etkin = false; a.yerel.bekleyenKurulum = { model: 'bonsai2-4b', zaman: new Date().toISOString() }; });
  const yol = belgeYaz('Gece notu');
  iceaktar.dosyaOgret(yol);
  await islenmis(yol);
  yereliHazirla();
  const saat = (dk: number) => { const t = new Date(Date.now() + dk * 60_000); return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`; };
  ayarlariKaydet((a) => { a.proaktif.sessizBaslangic = saat(-60); a.proaktif.sessizBitis = saat(60); });
  const once = ozetIstekleri.length;
  try {
    assert.equal(bekleyenOzetler!(), false, 'sessiz saatte beklenir');
    await new Promise((c) => setTimeout(c, 100));
    assert.equal(ozetIstekleri.length, once);
    assert.equal(satir(yol)?.durum, 'ozetsiz');
  } finally { ayarlariKaydet((a) => { a.proaktif.sessizBaslangic = '00:00'; a.proaktif.sessizBitis = '00:00'; }); }
  assert.equal(bekleyenOzetler!(), true, 'sessiz saat dışında çalışır');
  await bekle(() => satir(yol)?.durum === 'islendi');
  await hafizaYaziminiBekle();
});
