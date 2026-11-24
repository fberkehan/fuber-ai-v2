// 0.12 cila düzeltme turu 1 (inceleme I-1): bu bilgisayardaki yapay zekânın sunucusu `-c 8192 -np 2` ile açılır → yuva başına ≈ 4096 token.
// "Yalnız bu bilgisayar"/Gizli'de yeni açılan arka plan işlerinin yükü (e-posta: 20 × 1.200 karakter; belge: 14.000; WhatsApp: 40 × 500;
// hafıza yazımı: 6.000 + 4.000 + kayıtlar) bu yuvaya sığmıyordu: sunucu reddediyor, hata sessizce yutuluyordu — e-postalar puanlanmıyor,
// belge BOŞ özetle "işlendi" işaretleniyor, hafıza yazılmıyordu. Artık yerel yolda yük bütçeyle kırpılır / öbeklere bölünür
// (shared/yerel-butce.ts) ve bağlam aşımı yutulmaz: belge 'ozetsiz' kalır (sakin not), sonra yeniden denenir.
// Sahte yerel sunucu yuva sınırını UYGULAR (istem tokeni + max_tokens > 4096 → llama-server'ın HTTP 400 "exceeds the available context
// size" gövdesi); token tahmini 3 karakter/token (uygulamanın 2,5'inden iyimser: uygulama güvenli yönde kalmalı). GERÇEK ana süreç
// modülleri (Electron'suz sahne), bulut yok, ağ yok.
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { anaSurecSahnesi, ipcKurBos } from './yardimci/ana-surec.ts';
import { ozelGerekli, ozelModulleriYukle } from './yardimci/ozel.ts';
import * as butce from '../src/shared/yerel-butce.ts';
const { obekle, yerelGirdiButcesi, YEREL_YUVA_TOKEN } = butce;

// ── Saf parçalar ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('yerel bütçe: yuva − yanıt payı − sistem istemi, yuvanın ≈ %70\'i hedeflenir (2,5 karakter/token tahminine ek emniyet); öbekler sırayı korur, sayı ve bütçe sınırına uyar', () => {
  assert.equal(YEREL_YUVA_TOKEN, 4096);
  // Düzeltme turu 2 (a): hesaplanan girdi tokeninin %70'i — CSV/rakam ağırlıklı metinde gerçek oran 2,5'in altına (≈ 1,75'e dek) düşse de sığar.
  assert.equal(yerelGirdiButcesi('', 600), Math.floor((4096 - 600 - 0 - 200) * 0.7 * 2.5));
  assert.ok(yerelGirdiButcesi('x'.repeat(2500), 600) < yerelGirdiButcesi('', 600), 'uzun sistem istemi bütçeyi küçültür');
  assert.equal(yerelGirdiButcesi('x'.repeat(20000), 2000), 0, 'eksiye düşmez');
  const l = Array.from({ length: 12 }, (_, i) => ({ id: i, m: 'a'.repeat(100) }));
  const o = obekle(l, 5, 100_000);
  assert.deepEqual(o.map((x) => x.length), [5, 5, 2]);
  assert.deepEqual(o.flat().map((x) => x.id), l.map((x) => x.id), 'sıra ve öğeler aynen');
  const b = obekle(l, 50, 400);
  assert.ok(b.every((x) => JSON.stringify(x).length <= 400), JSON.stringify(b.map((x) => JSON.stringify(x).length)));
  assert.deepEqual(obekle([], 5, 100), []);
  assert.deepEqual(obekle([{ m: 'z'.repeat(1000) }], 5, 100).map((x) => x.length), [1], 'tek başına aşan öğe kendi öbeğinde');
});

// ── Sahte yerel sunucu (yuva sınırı uygulanır) ────────────────────────────────────────────────────────────────────────────────────
type Rol = 'hafiza' | 'iceaktar' | 'eposta' | 'whatsapp' | 'kokpit' | 'baslik' | 'sohbet';
interface Istek { rol: Rol; istemKarakteri: number; maxToken: number; reddedildi: boolean }
const istekler: Istek[] = [];
let kip: 'normal' | 'asim' = 'normal';
/** Düzeltme turu 2 (a): bu roldeki İLK isteği bağlam aşımıyla reddet (sonrakiler normal) — "yarıya indirip bir kez yeniden dene". */
let ilkAsim: Rol | null = null;
/** Sahte tokenleştiricinin karakter/token oranı (Türkçe düzyazı ≈ 3; CSV/rakam ağırlıklı metin daha düşük). */
let oran = 3;
const metniAl = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((p) => p?.type === 'text').map((p) => p.text).join(' ') : '');
const rolu = (sistem: string): Rol => (/hafıza yazıcısısın/.test(sistem) ? 'hafiza' : /2-4 cümleyle Türkçe özetle/.test(sistem) ? 'iceaktar' : /önem açısından puanla/.test(sistem) ? 'eposta'
  : /WhatsApp mesajları/.test(sistem) ? 'whatsapp' : /"selamlama"/.test(sistem) ? 'kokpit' : /başlık/.test(sistem) ? 'baslik' : 'sohbet');
const HAFIZA_BASLIGI = 'Yerel bağlam testi';
const yerelSunucu = http.createServer(async (q, r) => {
  let h = '';
  for await (const d of q) h += d;
  const g = JSON.parse(h || '{}') as { messages?: { role: string; content: unknown }[]; max_tokens?: number };
  const l = g.messages ?? [];
  const sistem = l[0]?.role === 'system' ? metniAl(l[0].content) : '';
  const son = metniAl(l.at(-1)?.content);
  const istemKarakteri = l.reduce((t, m) => t + metniAl(m.content).length, 0);
  const rol = rolu(sistem);
  const ilkRet = ilkAsim === rol;
  if (ilkRet) ilkAsim = null;
  const reddedildi = kip === 'asim' || ilkRet || Math.ceil(istemKarakteri / oran) + (g.max_tokens ?? 0) > YEREL_YUVA_TOKEN;
  istekler.push({ rol, istemKarakteri, maxToken: g.max_tokens ?? 0, reddedildi });
  if (reddedildi) {
    r.writeHead(400, { 'content-type': 'application/json' });
    r.end(JSON.stringify({ error: { code: 400, message: 'the request exceeds the available context size, try increasing it', type: 'exceed_context_size_error' } }));
    return;
  }
  const content = rol === 'hafiza' ? JSON.stringify({ islemler: /Toplantı notu/.test(son) ? [{ islem: 'ekle', tur: 'bilgi', baslik: HAFIZA_BASLIGI, icerik: 'Proje teslimi cuma (yerel bağlam testi).', onem: 3 }] : [] })
    : rol === 'iceaktar' ? 'Yerel özet: proje teslimi cuma, sorumlu Deniz.'
      : rol === 'eposta' ? JSON.stringify({ sonuclar: [...son.matchAll(/"id":(\d+)/g)].map((m) => ({ id: Number(m[1]), onem: 4, neden: 'Yanıt bekliyor.' })) })
        : rol === 'whatsapp' ? '{"acil":[{"ad":"Ayşe","neden":"Toplantı saatini soruyor."}]}'
          : rol === 'kokpit' ? '{"selamlama":"Merhaba","odak":"","kartlar":[]}' : rol === 'baslik' ? 'Deneme' : 'Tamam.';
  r.writeHead(200, { 'content-type': 'application/json' });
  r.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
});
await new Promise<void>((c) => yerelSunucu.listen(0, '127.0.0.1', c));
after(() => new Promise<void>((c) => yerelSunucu.close(() => c())));

const sahne = anaSurecSahnesi('yerel-baglam', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', hitap: 'Deniz', mod: 'is', tanitimSurumu: '0.9.0',
  ses: { surum: 2, uyandirma: false }, proaktif: { etkin: false }, baslangictaAc: false, yerel: { gpu: 'cpu', yalnizYerel: true },
});
(globalThis as Record<string, unknown>).__sifreleme = true;
process.env.FUBER_DEMO = '1';
process.env.FUBER_YEREL_TABAN = `http://127.0.0.1:${(yerelSunucu.address() as { port: number }).port}`;
await ipcKurBos();
const yerelFetch = (globalThis as Record<string, unknown>).__yerelFetch as typeof fetch;
globalThis.fetch = ((u: string, i?: RequestInit) => yerelFetch(u, i)) as typeof fetch;

// Ad alanı içe aktarımı: düzeltmeden önceki kodla da yüklenir (kırmızı kanıtı; yeni işlevler yoksa undefined).
const yerelMotor = await import('../src/main/motor/yerel.ts');
const secici = await import('../src/main/motor/secici.ts');
const iceaktar = await import('../src/main/iceaktar.ts') as Record<string, unknown> & typeof import('../src/main/iceaktar.ts');
const { _test: eposta } = await import('../src/main/entegrasyon/eposta.ts');
// WhatsApp isteğe bağlı modülde (bu depoda yok). Genel yükleyici varsa modülü kapıya kaydeder; kanca yoksa WhatsApp sınamaları atlanır.
await ozelModulleriYukle();
const whatsapp = (await import('../src/main/entegrasyon/whatsapp-kapisi.ts')).whatsappTestKancasi();
const waSecenegi = ozelGerekli('whatsapp');
const { hafizaYaz, hafizaYaziminiBekle } = await import('../src/main/hafiza/yazici.ts');
const { hafizaListesi } = await import('../src/main/hafiza/depo.ts');
const { oneriler } = await import('../src/main/planlama.ts');
const { veritabani } = await import('../src/main/vt.ts');
const { belgeListesi } = await import('../src/main/belge-depo.ts');
after(() => { delete process.env.FUBER_YEREL_TABAN; });

const bekle = async <T>(f: () => T | undefined | false, ms = 8000): Promise<T> => {
  const bas = Date.now();
  for (;;) { const v = f(); if (v) return v; if (Date.now() - bas > ms) throw new Error('beklenen olmadı'); await new Promise((c) => setTimeout(c, 25)); }
};
const yeni = (once: number, rol?: Rol) => istekler.slice(once).filter((i) => !rol || i.rol === rol);
const uzunMetin = (n: number, tohum: string) => Array.from({ length: Math.ceil(n / 60) }, (_, i) => `${tohum} ${i}: proje teslimi cuma, sorumlu Deniz, müşteri onayı bekleniyor.`).join('\n\n').slice(0, n);
let dosyaNo = 0;
const belgeYaz = (metin: string) => { const d = path.join(sahne.klasor, `yerel-belge-${++dosyaNo}.txt`); fs.writeFileSync(d, metin); return d; };
const belgeSatiri = (yol: string) => veritabani().prepare('SELECT id, durum, ozet, hata FROM belgeler WHERE yol = ?').get(yol) as { id: number; durum: string; ozet: string | null; hata: string | null } | undefined;

test('ön koşul: "Yalnız bu bilgisayar", bulut motoru yok → yol yerel', () => {
  assert.equal(yerelMotor.tekMotorYolu(), 'yerel');
});

test('yerel sunucunun bağlam aşımı ("exceeds the available context size") açık bir hataya çevrilir — ham HTTP metni değil', async () => {
  kip = 'asim';
  try {
    await assert.rejects(secici.yardimciMetin('Kısa sistem.', 'kısa', 'test-asim', 100), (e: Error) => e.message === 'Bu bilgisayardaki yapay zekânın bağlamına sığmadı.');
  } finally { kip = 'normal'; }
});

test('e-posta: 20 ileti × 1.200 karakter yerelde öbeklere bölünür — her istek yuvaya sığar, 20 iletinin HEPSİ puanlanır', async () => {
  const once = istekler.length;
  const vt = veritabani();
  const liste = Array.from({ length: 20 }, (_, i) => {
    const id = Number(vt.prepare('INSERT INTO epostalar(hesap, mesaj_kimlik, kimden, konu, tarih, ozet) VALUES(?,?,?,?,?,?)').run('h1', `b-${i}`, 'ekip@ornek.com', `Konu ${i}`, new Date().toISOString(), 'özet').lastInsertRowid);
    return { id, kimden: 'ekip@ornek.com', konu: `Konu ${i}`, ozet: uzunMetin(1200, `İleti ${i}`) };
  });
  await eposta.onemDegerlendir(liste);
  const r = yeni(once, 'eposta');
  assert.ok(r.length >= 2, `öbeklere bölündü: ${r.length} istek`);
  assert.ok(r.every((x) => !x.reddedildi), `hiçbir öbek reddedilmedi: ${JSON.stringify(r)}`);
  const puan = vt.prepare(`SELECT COUNT(*) n FROM epostalar WHERE id IN (${liste.map(() => '?').join(',')}) AND onem = 4`).get(...liste.map((x) => x.id)) as { n: number };
  assert.equal(Number(puan.n), 20, 'hepsi puanlandı');
});

test('WhatsApp: 40 mesaj × 500 karakter yerelde öbeklere bölünür — reddedilen istek yok, acil öneri düşer', waSecenegi, async () => {
  if (!whatsapp) return;
  const once = istekler.length;
  veritabani().prepare("DELETE FROM oneriler WHERE baslik = 'WhatsApp: Ayşe'").run();
  await whatsapp.siniflandir(Array.from({ length: 40 }, (_, i) => ({ jid: `9050000100${String(i).padStart(2, '0')}@s.whatsapp.net`, ad: 'Ayşe', metin: uzunMetin(500, `Mesaj ${i}`) })));
  const r = yeni(once, 'whatsapp');
  assert.ok(r.length >= 2 && r.every((x) => !x.reddedildi), JSON.stringify(r));
  assert.ok(oneriler(50).some((o) => o.baslik === 'WhatsApp: Ayşe'));
});

test('içe aktarılan uzun belge (30.000 karakter): özet girdisi yuvaya sığacak kadar kırpılır — belge özetiyle "işlendi"', async () => {
  const once = istekler.length;
  const yol = belgeYaz(uzunMetin(30000, 'Toplantı notu'));
  iceaktar.dosyaOgret(yol);
  const b = await bekle(() => { const s = belgeSatiri(yol); return s && s.durum !== 'bekliyor' ? s : undefined; });
  await hafizaYaziminiBekle();
  const r = yeni(once, 'iceaktar');
  assert.ok(r.length === 1 && !r[0].reddedildi, JSON.stringify(r));
  assert.equal(b.durum, 'islendi');
  assert.match(b.ozet ?? '', /Yerel özet/, 'boş özetle işaretlenmedi');
  assert.ok(yeni(once, 'hafiza').every((x) => !x.reddedildi), 'hafıza yazımı da sığdı');
});

// 11 Kas analizi #3: yerelde MODEL yazıcısı yok (küçük model kendi yanlış cevaplarını ve "aracım yok" cümlelerini olgu diye yazıyordu) — yuvaya
// sığdırma sorunu da kalmadı. Uzun girdide de yerel modele hafıza isteği gitmez; kullanıcının açık tercihi kural tabanlı yazılır.
test('hafıza yazımı yerelde (6.000 + 4.000 karakter) yerel modele GİTMEZ; açık tercih modelsiz yazılır', async () => {
  const once = istekler.length;
  hafizaYaz({ kullanici: `Toplantı notu: ${uzunMetin(9000, 'Toplantı notu')}`, asistan: uzunMetin(4000, 'Not aldım'), kaynak: 'test' });
  hafizaYaz({ kullanici: 'Bundan sonra toplantı notlarını bana hep tek sayfa ver.', asistan: uzunMetin(4000, 'Not aldım'), kaynak: 'test' });
  await hafizaYaziminiBekle();
  assert.deepEqual(yeni(once, 'hafiza'), [], 'yerel modele hafıza isteği yok');
  assert.ok(!hafizaListesi({ limit: 500 }).some((h) => h.baslik === HAFIZA_BASLIGI), 'model önerisi kayda geçmedi');
  assert.ok(hafizaListesi({ sabit: true, limit: 50 }).some((h) => h.tur === 'tercih' && /tek sayfa/.test(h.icerik)), 'açık tercih çekirdekte');
});

test('bağlam aşımı YUTULMAZ: özet çıkarılamayan belge boş özetle "işlendi" OLMAZ — "özetsiz" kalır (sakin not), hafızaya işlenmez', async () => {
  kip = 'asim';
  const once = istekler.length;
  const yol = belgeYaz(uzunMetin(3000, 'Bütçe notu'));
  try {
    iceaktar.dosyaOgret(yol);
    const b = await bekle(() => { const s = belgeSatiri(yol); return s && s.durum !== 'bekliyor' ? s : undefined; });
    await hafizaYaziminiBekle();
    assert.equal(b.durum, 'ozetsiz', `durum: ${b.durum}`);
    assert.equal(b.ozet, null);
    assert.ok(yeni(once, 'iceaktar').every((x) => x.reddedildi));
    assert.equal(yeni(once, 'hafiza').length, 0, 'özetsiz belge hafızaya işlenmedi');
    const l = belgeListesi(veritabani()).find((x) => x.id === b.id);
    assert.equal(l?.durum, 'ozetsiz', 'Hafıza → Belgeler "özet sonra" gösterir');
  } finally { kip = 'normal'; }
  // Sonra yeniden denenir (zamanlayıcı 15 dk'da bir): özet çıkarılır, belge işlenir.
  assert.equal(await iceaktar.ozetsizBelgeleriIsle(), 1);
  await hafizaYaziminiBekle();
  const s = belgeSatiri(yol)!;
  assert.equal(s.durum, 'islendi');
  assert.match(s.ozet ?? '', /Yerel özet/);
  assert.equal(s.hata, null);
});

test('kendiliğinden yeniden deneme belge başına en çok 3 kez; sonra "Dosya öğret" aynı dosyayla yeniden dener', async () => {
  kip = 'asim';
  const yol = belgeYaz(uzunMetin(2000, 'Sözleşme notu'));
  try {
    iceaktar.dosyaOgret(yol);
    await bekle(() => belgeSatiri(yol)?.durum === 'ozetsiz');
    for (let i = 0; i < 3; i++) assert.equal(await iceaktar.ozetsizBelgeleriIsle(), 0);
    const once = istekler.length;
    assert.equal(await iceaktar.ozetsizBelgeleriIsle(), 0);
    assert.equal(yeni(once, 'iceaktar').length, 0, '3 denemeden sonra kendiliğinden istek yok');
    assert.equal(belgeSatiri(yol)?.durum, 'ozetsiz');
  } finally { kip = 'normal'; }
  iceaktar.dosyaOgret(yol);
  await bekle(() => belgeSatiri(yol)?.durum === 'islendi');
  assert.match(belgeSatiri(yol)?.ozet ?? '', /Yerel özet/);
});

// ── Düzeltme turu 2 (yeniden inceleme a): %70 hedef + bağlam aşımında girdiyi yarıya indirip BİR kez yeniden dene ────────────────────
test('saf: yarilayarakDene — bağlam aşımında öbek ikiye bölünür (tek öğe kısaltılır), her yarı BİR kez denenir; başka hata yalnız bildirilir', async () => {
  const yarilayarakDene = (butce as Record<string, unknown>).yarilayarakDene as (<T>(o: T[], f: (x: T[]) => Promise<void>, s: { kisalt: (x: T) => T; asimMi: (e: unknown) => boolean; uyar: (n: number, e: unknown) => void }) => Promise<void>) | undefined;
  assert.equal(typeof yarilayarakDene, 'function', 'shared/yerel-butce.ts yarilayarakDene');
  const ASIM = new Error('asim');
  const denenen: number[][] = [];
  const uyarilar: number[] = [];
  await yarilayarakDene!([1, 2, 3, 4, 5], async (o) => { denenen.push(o); if (o.length > 3) throw ASIM; }, { kisalt: (x) => x, asimMi: (e) => e === ASIM, uyar: (n) => uyarilar.push(n) });
  assert.deepEqual(denenen, [[1, 2, 3, 4, 5], [1, 2, 3], [4, 5]]);
  assert.deepEqual(uyarilar, []);
  denenen.length = 0;
  await yarilayarakDene!(['uzun'], async (o) => { denenen.push(o as never); throw ASIM; }, { kisalt: (x) => x.slice(0, 2), asimMi: (e) => e === ASIM, uyar: (n) => uyarilar.push(n) });
  assert.deepEqual(denenen, [['uzun'], ['uz']], 'tek öğe: metin kısaltılıp bir kez');
  assert.deepEqual(uyarilar, [1], 'ikinci de aşarsa bildirilir, üçüncü deneme yok');
  uyarilar.length = 0; denenen.length = 0;
  await yarilayarakDene!([1, 2], async (o) => { denenen.push(o); throw new Error('bağlantı'); }, { kisalt: (x) => x, asimMi: (e) => e === ASIM, uyar: (n) => uyarilar.push(n) });
  assert.deepEqual(denenen, [[1, 2]], 'bağlam aşımı değilse yeniden denenmez');
  assert.deepEqual(uyarilar, [2]);
});

test('belge özeti: ilk istek bağlam aşımı → girdi yarıya indirilip BİR kez yeniden denenir — belge özetiyle "işlendi" (özet sonra kalmaz)', async () => {
  const once = istekler.length;
  ilkAsim = 'iceaktar';
  const yol = belgeYaz(uzunMetin(30000, 'Yarım deneme notu'));
  iceaktar.dosyaOgret(yol);
  const b = await bekle(() => { const s = belgeSatiri(yol); return s && s.durum !== 'bekliyor' ? s : undefined; });
  await hafizaYaziminiBekle();
  const r = yeni(once, 'iceaktar');
  assert.equal(b.durum, 'islendi', JSON.stringify(r));
  assert.equal(r.length, 2);
  assert.ok(r[0].reddedildi && !r[1].reddedildi && r[1].istemKarakteri < r[0].istemKarakteri * 0.6, JSON.stringify(r));
});


test('e-posta öbeği: bağlam aşımında öbek ikiye bölünüp her yarı BİR kez denenir — öbekteki iletilerin hepsi puanlanır', async () => {
  const once = istekler.length;
  const vt = veritabani();
  const liste = Array.from({ length: 5 }, (_, i) => {
    const id = Number(vt.prepare('INSERT INTO epostalar(hesap, mesaj_kimlik, kimden, konu, tarih, ozet) VALUES(?,?,?,?,?,?)').run('h1', `yari-${i}`, 'ekip@ornek.com', `Yarı ${i}`, new Date().toISOString(), 'özet').lastInsertRowid);
    return { id, kimden: 'ekip@ornek.com', konu: `Yarı ${i}`, ozet: uzunMetin(300, `Yarı ${i}`) };
  });
  ilkAsim = 'eposta';
  await eposta.onemDegerlendir(liste);
  const r = yeni(once, 'eposta');
  assert.equal(r.length, 3, JSON.stringify(r));
  assert.ok(r[0].reddedildi && !r[1].reddedildi && !r[2].reddedildi);
  const n = vt.prepare(`SELECT COUNT(*) n FROM epostalar WHERE id IN (${liste.map(() => '?').join(',')}) AND onem = 4`).get(...liste.map((x) => x.id)) as { n: number };
  assert.equal(Number(n.n), 5);
});

test('WhatsApp öbeği: bağlam aşımında öbek ikiye bölünüp BİR kez yeniden denenir — acil öneri düşer', waSecenegi, async () => {
  if (!whatsapp) return;
  const once = istekler.length;
  veritabani().prepare("DELETE FROM oneriler WHERE baslik = 'WhatsApp: Ayşe'").run();
  ilkAsim = 'whatsapp';
  await whatsapp.siniflandir(Array.from({ length: 6 }, (_, i) => ({ jid: `90500000010${i}@s.whatsapp.net`, ad: 'Ayşe', metin: `Mesaj ${i}: toplantı kaçta?` })));
  const r = yeni(once, 'whatsapp');
  assert.equal(r.length, 3, JSON.stringify(r));
  assert.ok(r[0].reddedildi && !r[1].reddedildi && !r[2].reddedildi);
  assert.ok(oneriler(50).some((o) => o.baslik === 'WhatsApp: Ayşe'));
});

test('%70 hedef: rakam/CSV ağırlıklı belge (≈ 1,9 karakter/token) ilk istekte sığar — reddedilen istek yok', async () => {
  const once = istekler.length;
  oran = 1.9;
  try {
    const csv = Array.from({ length: 1500 }, (_, i) => `${i};${(i * 7919) % 100000};${(i * 104729) % 1000000};2026-10-${String((i % 28) + 1).padStart(2, '0')}`).join('\n');
    const yol = belgeYaz(csv);
    iceaktar.dosyaOgret(yol);
    const b = await bekle(() => { const s = belgeSatiri(yol); return s && s.durum !== 'bekliyor' ? s : undefined; });
    await hafizaYaziminiBekle();
    const r = yeni(once).filter((x) => x.rol === 'iceaktar' || x.rol === 'hafiza');
    assert.equal(b.durum, 'islendi');
    assert.ok(r.length >= 1 && r.every((x) => !x.reddedildi), JSON.stringify(r));
  } finally { oran = 3; }
});
