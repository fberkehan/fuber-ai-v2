// G1 (F2, yollar 2–5): Fuber'in kendine verdiği iç talimat hiçbir yüzeyde görünmez. MERAK talimatı birebir, kutudan taşmış
// göründü: büyük olasılıkla küçük yerel model (Gizli) araç isteyen talimatı araçsız alıp aynen geri yazdı, yanıt asistan mesajı olarak
// kaydoldu ve proaktifBildir onu adaya gönderdi. Burada GERÇEK main/zamanlayici.ts proaktifIs + ajan/dongu.ts yanitla + sohbet deposu;
// motorlar bu bilgisayardaki sahte sunucular (yalnız 127.0.0.1): Fuber ağ geçidi (bulut) ve yerel model (FUBER_YEREL_TABAN). Sınanır:
//  · yankılayan motor → bildirim yok, görünümde/listede/arama dizininde yanıt yok, gün anahtarı yazılmaz (deneme başarısız);
//  · iç talimatla başlayan turun hiçbir olayı (pencereler, ada, telefon köprüsü — herOlayiDinle köprünün kancasıdır) talimatı taşımaz;
//    tur akmaz (yanıt yankı denetiminden sonra bütünüyle gelir);
//  · Gizli/yerel yolda (ve Gizli hazırlanırken) SABAH/AKŞAM/MERAK çalışmaz, iz bırakmaz; Gizli kapanınca aynı gün çalışır;
//  · tanışma (kurulum:tamamla) Gizli'de araçsız kısa talimatla yerel modele gider, Normal'de bugünkü talimatla buluta;
//  · proaktif turun hafıza yazıcısına giden girdisinde talimat yok (nötr işaret + Fuber'in yanıtı).
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { anaSurecSahnesi, ipcKurBos, ipcIsleyicileri } from './yardimci/ana-surec.ts';
import { fuberBicimi, openaiYaz } from './yardimci/openai-sahte.ts';

interface Istek { sistem: string; son: string; hepsi: string }
type Kip = 'yanki' | 'normal';
const bulut: { kip: Kip; istekler: Istek[] } = { kip: 'normal', istekler: [] };
const yerel: { kip: Kip; istekler: Istek[] } = { kip: 'yanki', istekler: [] };
const NORMAL_BULUT = 'Günaydın Deniz! Bugün üç işin var; ilki 10:00’daki ekip toplantısı.';
const NORMAL_YEREL = 'Merhaba Deniz! Seni tanımak isterim: bu aralar en çok hangi işle uğraşıyorsun?';
const HAFIZA_YAZICISI = /hafıza yazıcısısın/;
/** Küçük yerel modelin yaptığı gibi: son kullanıcı mesajındaki iç talimatı (bağlam bloğundan sonrası) aynen geri yazar. */
const yanki = (son: string) => son.replace(/^[\s\S]*<\/baglam>\s*/, '');
const metniAl = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((p) => p?.type === 'text').map((p) => p.text).join(' ') : '');
const govde = (q: http.IncomingMessage) => new Promise<Record<string, unknown>>((c) => { let h = ''; q.on('data', (d) => { h += d; }); q.on('end', () => c(h ? JSON.parse(h) : {})); });
const yaz = (r: http.ServerResponse, v: unknown) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify(v)); };

const bulutSunucu = http.createServer(async (q, r) => {
  if (q.method !== 'POST' || q.url !== '/v1/chat/completions') { r.writeHead(404); r.end(); return; }
  const g = fuberBicimi(await govde(q));
  const metinler = ((g.messages ?? []) as { content: unknown }[]).map((m) => metniAl(m.content));
  const i: Istek = { sistem: String(g.systemPrompt ?? ''), son: metinler.at(-1) ?? '', hepsi: metinler.join('\n') };
  bulut.istekler.push(i);
  const content = HAFIZA_YAZICISI.test(i.sistem) ? '{"islemler":[]}' : bulut.kip === 'yanki' ? yanki(i.son) : NORMAL_BULUT;
  openaiYaz(r, content);
});
const yerelSunucu = http.createServer(async (q, r) => {
  if (q.method !== 'POST' || q.url !== '/v1/chat/completions') { r.writeHead(404); r.end(); return; }
  const g = await govde(q);
  const l = (g.messages ?? []) as { role: string; content: unknown }[];
  const i: Istek = { sistem: l[0]?.role === 'system' ? metniAl(l[0].content) : '', son: metniAl(l.at(-1)?.content), hepsi: l.map((m) => metniAl(m.content)).join('\n') };
  yerel.istekler.push(i);
  const content = HAFIZA_YAZICISI.test(i.sistem) ? '{"islemler":[]}' : yerel.kip === 'yanki' ? yanki(i.son) : NORMAL_YEREL;
  yaz(r, { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
});
const dinle = async (s: http.Server) => { await new Promise<void>((c) => s.listen(0, '127.0.0.1', c)); return `http://127.0.0.1:${(s.address() as { port: number }).port}`; };
const bulutTaban = await dinle(bulutSunucu);
const yerelTaban = await dinle(yerelSunucu);
after(() => Promise.all([bulutSunucu, yerelSunucu].map((s) => new Promise<void>((c) => s.close(() => c())))));

anaSurecSahnesi('proaktif-yanki', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', hitap: 'Deniz', mod: 'gelistirici', tanitimSurumu: '0.9.0',
  ses: { surum: 2, uyandirma: false }, proaktif: { etkin: false }, baslangictaAc: false, motorCalisti: true,
  motorSecimi: 'openai', openaiUyumlu: { tabanUrl: `${bulutTaban}/v1`, model: 'sahte-model' },
});
(globalThis as Record<string, unknown>).__sifreleme = true;
process.env.FUBER_DEMO = '1'; // Windows bildirimi gösterilmez, kayda yazılır (testBildirimKaydi); kokpit planlayıcısı çalışmaz
delete process.env.FUBER_YEREL_TABAN;
delete process.env.FUBER_TEST_ANA_ONDE;
await ipcKurBos();
const { ayarlariKaydet, sirYaz } = await import('../src/main/ayarlar.ts');
// Fuber motoru ve yerel model genel fetch kullanır: bu dosyada yalnız 127.0.0.1'e giden yerel getiriciye bağlanır (gerisi bekçide düşer).
const yerelFetch = (globalThis as Record<string, unknown>).__yerelFetch as typeof fetch;
globalThis.fetch = ((u: string, i?: RequestInit) => yerelFetch(u, i)) as typeof fetch;
const { proaktifIs, PROAKTIF_TALIMATLARI, testBildirimKaydi } = await import('../src/main/zamanlayici.ts');
const { anaSohbet, mesajlar, gorunenMesajlar, sohbetListesi } = await import('../src/main/sohbet.ts');
const { meta } = await import('../src/main/vt.ts');
const { mesgulMu, turSonrasiniBitir } = await import('../src/main/ajan/dongu.ts');
const { hafizaYaziminiBekle } = await import('../src/main/hafiza/yazici.ts');
const { mesajAra } = await import('../src/main/hafiza/depo.ts');
const { herOlayiDinle } = await import('../src/main/olaylar.ts');
const { TANISMA_TALIMATI, TANISMA_TALIMATI_YEREL, PROAKTIF_HAFIZA_ISARETI } = await import('../src/shared/ic-talimat.ts');

/** Talimatın ayırt edici başı (tırnaksız; JSON'a çevrilmiş olayda da aynen aranır). */
const iz = (talimat: string) => talimat.slice(0, 48);
const olaylar: { kanal: string; veri: unknown }[] = [];
herOlayiDinle((kanal, veri) => { olaylar.push({ kanal, veri }); });
const tasiyanlar = (talimat: string) => olaylar.filter((o) => (JSON.stringify(o.veri) ?? '').includes(iz(talimat))).map((o) => `${o.kanal}:${(o.veri as { tur?: string })?.tur ?? ''}`);
const ana = anaSohbet();
const okunmamis = () => sohbetListesi().find((s) => s.id === ana)?.okunmamis ?? -1;
const bekle = async <T>(f: () => T | undefined | false, ms = 8000): Promise<T> => {
  const bas = Date.now();
  for (;;) { const v = f(); if (v) return v; if (Date.now() - bas > ms) throw new Error('beklenen olmadı'); await new Promise((c) => setTimeout(c, 25)); }
};

test('yankı (bulut): MERAK talimatını aynen geri yazan yanıt görünmez, bildirilmez, hiçbir olaya girmez; gün anahtarı yazılmaz', async () => {
  const MERAK = PROAKTIF_TALIMATLARI.merak;
  bulut.kip = 'yanki';
  olaylar.length = 0;
  const istekOnce = bulut.istekler.length, bildirimOnce = testBildirimKaydi().length, okunmamisOnce = okunmamis();
  await proaktifIs('merak', 'merak:test:0', 'Fuber bir şey sormak istiyor');
  assert.ok(bulut.istekler.slice(istekOnce).some((i) => i.son.includes(iz(MERAK))), 'motor talimatı aldı (ve yankıladı)');
  assert.equal(meta('merak:test:0'), undefined, 'deneme başarısız: gün anahtarı yazılmadı (sonra yeniden denenir)');
  assert.equal(meta('merak:test:0:deneme'), '1');
  assert.equal(testBildirimKaydi().length, bildirimOnce, 'Windows bildirimi / ada duyurusu yok');
  const gorunen = gorunenMesajlar(ana);
  assert.ok(!gorunen.some((m) => m.rol === 'assistant'), JSON.stringify(gorunen));
  assert.ok(!JSON.stringify(gorunen).includes(iz(MERAK)));
  assert.ok(!(sohbetListesi().find((s) => s.id === ana)?.sonMesaj ?? '').includes('MERAK'), 'liste önizlemesi');
  assert.deepEqual(tasiyanlar(MERAK), [], 'hiçbir olay (sohbet, ada, telefon köprüsü, Etkinlik) talimatı taşımaz');
  const bitti = olaylar.find((o) => o.kanal === 'sohbet:olay' && (o.veri as { tur: string }).tur === 'bitti');
  assert.ok(bitti, 'tur biter (arayüz "yanıt hazırlanıyor"da kalmaz)');
  // Kayıt: tetik modelin bağlamı için kalır (görünmez); yankı kayıttan, arama dizininden ve okunmamış sayısından düşer.
  const ham = mesajlar(ana);
  assert.ok(ham.some((m) => m.rol === 'not' && m.kaynak === 'proaktif'));
  assert.ok(!ham.some((m) => m.rol === 'assistant'), 'yankı kayıtta kalmadı');
  assert.deepEqual(mesajAra('Kullanıcıyı daha iyi tanımak istiyorsun'), [], 'arama dizininde (hafiza_ara, ilgili geçmiş) yok');
  assert.equal(okunmamis(), okunmamisOnce, 'okunmamış sayısı artmadı');
});

test('normal yanıt (bulut): görünür, bildirilir, anahtar yazılır; tur akmaz; hafıza yazıcısına talimat değil nötr işaret gider', async () => {
  const SABAH = PROAKTIF_TALIMATLARI.sabah;
  bulut.kip = 'normal';
  // 11 Kas analizi §6.2: bakılacak hiçbir şey yokken (hatırlatıcı, yapılacak, e-posta, gün kaydı yok) sabah özeti modele GİTMEZ.
  const bosOnce = bulut.istekler.length;
  await proaktifIs('sabah', 'sabah:bos', 'Günaydın — özetin hazır');
  assert.equal(bulut.istekler.length, bosOnce, 'boş günde sabah özeti modele gitmedi');
  assert.match(meta('sabah:bos') ?? '', /^bos:/, 'gün anahtarı "boş" diye yazıldı (bugün yeniden denenmez)');
  const { hatirlaticiEkle } = await import('../src/main/planlama.ts');
  hatirlaticiEkle({ baslik: 'Ekip toplantısı', zaman: new Date(Date.now() + 2 * 3600_000).toISOString() });
  olaylar.length = 0;
  const bildirimOnce = testBildirimKaydi().length;
  await proaktifIs('sabah', 'sabah:test', 'Günaydın — özetin hazır');
  assert.ok(meta('sabah:test'), 'başarılı tur: gün anahtarı yazıldı');
  const yeni = testBildirimKaydi().slice(bildirimOnce);
  assert.equal(yeni.length, 1);
  assert.equal(yeni[0].baslik, 'Günaydın — özetin hazır');
  assert.match(yeni[0].metin, /Günaydın Deniz/);
  assert.ok(gorunenMesajlar(ana).some((m) => m.rol === 'assistant' && JSON.stringify(m.bloklar).includes('Günaydın Deniz')));
  const akis = olaylar.filter((o) => o.kanal === 'sohbet:olay' && ['metin', 'dusunce'].includes((o.veri as { tur: string }).tur));
  assert.equal(akis.length, 0, 'iç talimatla başlayan tur akmaz: yanıt yankı denetiminden sonra bütünüyle gelir');
  assert.deepEqual(tasiyanlar(SABAH), []);
  const istekOnce = bulut.istekler.length;
  await turSonrasiniBitir();
  await hafizaYaziminiBekle();
  // 11 Kas analizi #7: kullanıcının hiçbir şey yazmadığı tur hafıza yazıcısına GİTMEZ (sabah özetinin metni "kural"/"görev" kaydı, hatta çekirdek
  // oluyordu). Talimat da nötr işaret de yazıcıya ulaşmaz.
  const h = bulut.istekler.slice(istekOnce).filter((i) => HAFIZA_YAZICISI.test(i.sistem));
  assert.equal(h.length, 0, 'kendiliğinden turdan sonra hafıza yazıcısı çağrılmadı');
  assert.ok(!bulut.istekler.slice(istekOnce).some((i) => i.hepsi.includes(PROAKTIF_HAFIZA_ISARETI)), 'nötr işaret hiçbir isteğe girmedi');
});

test('Gizli (yerel yol): SABAH, AKŞAM ve MERAK çalışmaz — yerel modele istek yok, iz yok; Gizli kapanınca aynı gün çalışır', async () => {
  process.env.FUBER_YEREL_TABAN = yerelTaban;
  ayarlariKaydet((a) => { a.yerel.gizliMod = true; });
  const yerelOnce = yerel.istekler.length, bulutOnce = bulut.istekler.length, kayitOnce = mesajlar(ana).length;
  try {
    for (const is of ['sabah', 'aksam', 'merak'] as const) await proaktifIs(is, `${is}:gizli`, 'Fuber');
    assert.equal(yerel.istekler.length, yerelOnce, 'yerel modele araç isteyen talimat gitmedi');
    assert.equal(bulut.istekler.length, bulutOnce);
    for (const is of ['sabah', 'aksam', 'merak']) {
      assert.equal(meta(`${is}:gizli`), undefined, `${is}: gün anahtarı yazılmadı`);
      assert.equal(meta(`${is}:gizli:deneme`), undefined, `${is}: deneme sayılmadı`);
    }
    assert.equal(mesajlar(ana).length, kayitOnce, 'ana sohbete hiçbir şey yazılmadı');
  } finally {
    ayarlariKaydet((a) => { a.yerel.gizliMod = false; });
    delete process.env.FUBER_YEREL_TABAN;
  }
  bulut.kip = 'normal';
  // Önceki sınamanın sabah özeti 90 dk aralığı başlattı (shared/proaktif-tekrar.ts beklemeli; tests/proaktif-tekrar.test.ts) — burada konu değil.
  (await import('../src/main/vt.ts')).metaSil('proaktif:gecmis');
  await proaktifIs('merak', 'merak:gizli', 'Fuber bir şey sormak istiyor');
  assert.ok(meta('merak:gizli'), 'Gizli kapanınca aynı gün çalışır');
});

test('Gizli açık ama bu bilgisayardaki yapay zekâ hazır değil (motor yok): proaktif işler sessizce atlanır — ⚠ notu, deneme yok', async () => {
  ayarlariKaydet((a) => { a.yerel.gizliMod = true; a.yerel.etkin = false; });
  const kayitOnce = mesajlar(ana).length, bulutOnce = bulut.istekler.length;
  try {
    await proaktifIs('aksam', 'aksam:hazirlaniyor', 'Günün özeti');
    assert.equal(mesajlar(ana).length, kayitOnce, JSON.stringify(mesajlar(ana).slice(kayitOnce)));
    assert.equal(meta('aksam:hazirlaniyor:deneme'), undefined);
    assert.equal(bulut.istekler.length, bulutOnce, 'buluta gidilmedi');
  } finally { ayarlariKaydet((a) => { a.yerel.gizliMod = false; }); }
});

test('tanışma (kurulum:tamamla) Gizli’de yerel modele araçsız kısa talimatla gider; yankısı hiçbir yüzeyde görünmez', async () => {
  process.env.FUBER_YEREL_TABAN = yerelTaban;
  ayarlariKaydet((a) => { a.yerel.gizliMod = true; });
  yerel.kip = 'yanki';
  olaylar.length = 0;
  const yerelOnce = yerel.istekler.length, bulutOnce = bulut.istekler.length;
  try {
    await ipcIsleyicileri().get('kurulum:tamamla')!({}, { kullaniciAdi: 'Deniz', hitap: 'Deniz', claudeHafiza: false });
    const tanisma = await bekle(() => yerel.istekler.slice(yerelOnce).find((i) => i.son.includes('KURULUM BİTTİ')));
    await bekle(() => !mesgulMu(ana));
    assert.ok(tanisma.son.trimEnd().endsWith(TANISMA_TALIMATI_YEREL), tanisma.son.slice(-300));
    assert.doesNotMatch(tanisma.son.slice(tanisma.son.indexOf('</baglam>')), /3-4 maddeyle|hafiza_|_kaydet|_listele/);
    assert.ok(!bulut.istekler.slice(bulutOnce).some((i) => i.hepsi.includes('KURULUM BİTTİ')), 'Gizli: buluta gitmedi');
    const gorunen = gorunenMesajlar(ana);
    assert.ok(!JSON.stringify(gorunen).includes('KURULUM BİTTİ'), 'yankı görünümde yok');
    assert.deepEqual(tasiyanlar(TANISMA_TALIMATI_YEREL), []);
    assert.ok(!mesajlar(ana).some((m) => m.rol === 'assistant' && m.metin.includes('KURULUM BİTTİ')), 'yankı kayıtta yok');
  } finally {
    ayarlariKaydet((a) => { a.yerel.gizliMod = false; });
    delete process.env.FUBER_YEREL_TABAN;
  }
});

test('tanışma Normal’de (bulut) bugünkü talimatla gider ve yanıtı görünür', async () => {
  bulut.kip = 'normal';
  const bulutOnce = bulut.istekler.length;
  const yanitlar = () => gorunenMesajlar(ana).filter((m) => m.rol === 'assistant').length;
  const yanitOnce = yanitlar();
  await ipcIsleyicileri().get('kurulum:tamamla')!({}, { kullaniciAdi: 'Deniz', hitap: 'Deniz', claudeHafiza: false });
  const tanisma = await bekle(() => bulut.istekler.slice(bulutOnce).find((i) => i.son.includes('KURULUM BİTTİ')));
  await bekle(() => !mesgulMu(ana));
  assert.ok(tanisma.son.trimEnd().endsWith(TANISMA_TALIMATI), tanisma.son.slice(-300));
  assert.equal(yanitlar(), yanitOnce + 1, 'tanışma yanıtı ana sohbette görünür');
  await turSonrasiniBitir();
  await hafizaYaziminiBekle();
});
