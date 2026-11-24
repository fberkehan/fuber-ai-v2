// 0.14 T24 — çentik panelinin Gündem, Görevler ve Gelenler sayfaları (R12, P14, B9, B23). Saf kurallar shared/centik-veri.ts'te (takvim ayrıştırma, sayfa
// görünümleri, takvim çağrısının 15 dk sınırı ve önbelleği — bağımlılıklar dışarıdan verilir); ana süreç bağlantısı (main/centik-veri.ts, 'centik:veri')
// Electron'suz sahnede sınanır: Gizli'de ağa çıkılmaz, takvim bu bilgisayardaki son kopyadan gelir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  takvimOlaylariAyikla, gundemSayfasi, gelenlerSayfasi, gorevlerSayfasi, takvimAl, takvimHemen, takvimDurumuYeni,
  TAKVIM_ONBELLEK_ANAHTARI, TAKVIM_ARALIK_MS, TAKVIM_BAGLI_DEGIL, GELEN_KAYNAK_YOK, YANIT_TASLAGI_ONEKI, gelenIstemi, TAKVIM_YENILENMELI, GELEN_GIZLI_NOTU, GELEN_YEREL_NOTU,
  type TakvimBaglami, type TakvimOlayi,
} from '../src/shared/centik-veri.ts';
import { BULUT_KAPALI_METNI } from '../src/shared/bulut-kapisi.ts';
import type { IsOzet } from '../src/shared/isler.ts';
import type { EpostaOzet, WaOzet } from '../src/shared/tipler.ts';

const kok = path.resolve(import.meta.dirname, '..');
const oku = (p: string) => fs.readFileSync(path.join(kok, p), 'utf8');
const yorumsuz = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Sabit "şimdi": 4 Kasım 2026 Çarşamba 10:00 (yerel saat). */
const SIMDI = new Date(2026, 10, 4, 10, 0).getTime();
const yerel = (sa: number, dk = 0, gun = 4) => new Date(2026, 10, gun, sa, dk).toISOString();
const BOS_KOKPIT = { hatirlaticilar: [], gorevler: [], epostalar: [], dusunme: { meseleler: [] } };
/** MCP araç sonucu (metin parçası JSON). */
const mcpMetin = (veri: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(veri) }] });

test('Google Calendar items ve Graph value ayrışır, tanınmayan biçim null', () => {
  const google = takvimOlaylariAyikla(mcpMetin({
    kind: 'calendar#events',
    items: [
      { summary: 'Ekip toplantısı', start: { dateTime: '2026-11-04T14:00:00+03:00' }, end: { dateTime: '2026-11-04T15:00:00+03:00' } },
      { summary: 'Doğum günü: Ece', start: { date: '2026-11-04' }, end: { date: '2026-11-05' } },
      { summary: 'İptal edilen', status: 'cancelled', start: { dateTime: '2026-11-04T16:00:00+03:00' } },
      { start: { dateTime: '2026-11-04T17:00:00+03:00' } },
    ],
  }));
  assert.deepEqual(google, [
    { baslik: 'Ekip toplantısı', bas: '2026-11-04T11:00:00.000Z', bit: '2026-11-04T12:00:00.000Z', tumGun: false },
    { baslik: 'Doğum günü: Ece', bas: '2026-11-04', bit: '2026-11-05', tumGun: true },
    { baslik: '(Başlıksız)', bas: '2026-11-04T14:00:00.000Z', tumGun: false },
  ]);
  // Microsoft Graph: structuredContent, UTC saat dilimi eki yok; tüm gün isAllDay ile.
  const graph = takvimOlaylariAyikla({
    structuredContent: { value: [
      { subject: 'Yatırımcı görüşmesi', start: { dateTime: '2026-11-04T12:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-04T13:00:00.0000000', timeZone: 'UTC' }, isAllDay: false },
      { subject: 'İzin', start: { dateTime: '2026-11-05T00:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-06T00:00:00.0000000', timeZone: 'UTC' }, isAllDay: true },
      { subject: 'İptal', isCancelled: true, start: { dateTime: '2026-11-04T15:00:00', timeZone: 'UTC' } },
    ] },
  });
  assert.deepEqual(graph, [
    { baslik: 'Yatırımcı görüşmesi', bas: '2026-11-04T12:00:00.000Z', bit: '2026-11-04T13:00:00.000Z', tumGun: false },
    { baslik: 'İzin', bas: '2026-11-05', bit: '2026-11-06', tumGun: true },
  ]);
  // Ham nesne (sarmalayıcısız) ve boş liste de tanınır: boş takvim "okunamadı" değildir.
  assert.deepEqual(takvimOlaylariAyikla({ items: [] }), []);
  assert.deepEqual(takvimOlaylariAyikla(mcpMetin({ value: [] })), []);
  for (const x of [null, undefined, 42, 'metin', {}, { foo: [] }, { items: 'x' }, mcpMetin({ olaylar: [] }), { content: [{ type: 'text', text: 'JSON değil' }] }, { isError: true, content: [{ type: 'text', text: '{"items":[]}' }] }]) {
    assert.equal(takvimOlaylariAyikla(x), null, JSON.stringify(x));
  }
});

test('takvim yoksa Gündem gizlenmez: "Takvim bağlı değil" ve Bağla', () => {
  const s = gundemSayfasi(BOS_KOKPIT, null, SIMDI);
  assert.equal(TAKVIM_BAGLI_DEGIL, 'Takvim bağlı değil.');
  assert.deepEqual(s.bos, { metin: TAKVIM_BAGLI_DEGIL, eylem: 'baglantilar', cipa: 'servisler' });
  assert.equal(s.siradaki, null);
  // Bağla doğru yere: takvim katalog girdisi (ana süreç verir).
  assert.equal(gundemSayfasi(BOS_KOKPIT, null, SIMDI, { cipa: 'servis-google-takvim' }).bos?.cipa, 'servis-google-takvim');
  // Takvim bağlı değilken de kokpitin gündemi (hatırlatıcı) görünür; boş durum yalnız takvimin satırıdır.
  const v = { ...BOS_KOKPIT, hatirlaticilar: [{ id: 1, baslik: 'İlacını al', zaman: yerel(13), tekrar: 'yok', durum: 'bekliyor', onem: 3 }] };
  const d = gundemSayfasi(v, null, SIMDI);
  assert.equal((d.siradaki as { baslik: string } | null)?.baslik, 'İlacını al');
  assert.ok(d.bos);
  // Bağlı ama boş takvim: Bağla yok.
  assert.equal(gundemSayfasi(BOS_KOKPIT, [], SIMDI).bos, null);
  // Takvim ve kokpit birlikte, zamana göre; biten etkinlik düşer, sıradaki = ilk gelecek zamanlı öğe.
  const takvim: TakvimOlayi[] = [
    { baslik: 'Kahvaltı', bas: yerel(8), bit: yerel(9), tumGun: false },
    { baslik: 'Ekip toplantısı', bas: yerel(11), bit: yerel(12), tumGun: false },
    { baslik: 'Doğum günü: Ece', bas: '2026-11-04', bit: '2026-11-05', tumGun: true },
    { baslik: 'Yarınki sunum', bas: yerel(9, 0, 5), bit: yerel(10, 0, 5), tumGun: false },
  ];
  const t = gundemSayfasi(v, takvim, SIMDI);
  assert.equal((t.siradaki as TakvimOlayi).baslik, 'Ekip toplantısı');
  assert.deepEqual(t.ogeler.map((o) => o.baslik), ['Doğum günü: Ece', 'İlacını al']);
  assert.equal(t.bos, null);
  // Sayfa kaydı (B9): yalnız kendi satırları; boş durum satırı "Bağla" ile ana pencerenin mevcut çapa yoluna gider (ana:goster).
  const panel = oku('src/renderer/ada/Panel.tsx');
  assert.match(panel, /sayfaKaydet\('gundem', Gundem\)/);
  const gundem = oku('src/renderer/ada/sayfalar/Gundem.tsx');
  assert.match(gundem, /data-sayfa-bos=/);
  assert.match(gundem, />Bağla</);
  assert.match(gundem, /'ana:goster', `baglantilar#\$\{/);
  // Bağlantılar sayfası çapaları taşır (ana:git → location.hash → id).
  const bag = oku('src/renderer/sayfalar/Baglantilar.tsx');
  for (const id of ['id="eposta"', 'id="whatsapp"', 'id="servisler"', 'id={`servis-${k.id}`}']) assert.ok(bag.includes(id), id);
});

const eposta = (id: number, onem: number, okundu: boolean, tarih: string, ek: Partial<EpostaOzet> = {}): EpostaOzet =>
  ({ id, hesap: 'h1', kimden: `Kişi ${id} <k${id}@ornek.example>`, konu: `Konu ${id}`, tarih, ozet: `Özet ${id}`, okundu, onem, ...ek });
const wa = (jid: string, okunmamis: number, zaman: string): WaOzet => ({ jid, ad: `Ad ${jid}`, sonMesaj: `Mesaj ${jid}`, zaman, okunmamis });

test('Gelenler kaynak yoksa "E-posta ya da WhatsApp bağlı değil" ve Bağla', () => {
  assert.equal(GELEN_KAYNAK_YOK, 'E-posta ya da WhatsApp bağlı değil.');
  const s = gelenlerSayfasi({ epostalar: [], whatsapp: [], kaynak: { eposta: false, whatsapp: false } });
  assert.deepEqual(s.bos, { metin: GELEN_KAYNAK_YOK, eylem: 'baglantilar', cipa: 'eposta' });
  assert.deepEqual(s.ogeler, []);
  // Kaynak var, yeni bir şey yok: Bağla yok.
  assert.equal(gelenlerSayfasi({ epostalar: [], whatsapp: [], kaynak: { eposta: true, whatsapp: false } }).bos, null);
  assert.equal(gelenlerSayfasi({ epostalar: [], whatsapp: [], kaynak: { eposta: false, whatsapp: true } }).bos, null);
  assert.match(oku('src/renderer/ada/Panel.tsx'), /sayfaKaydet\('gelenler', Gelenler\)/);
  const g = oku('src/renderer/ada/sayfalar/Gelenler.tsx');
  // Gündem'in boş satırı (tek satır + "Bağla" hapı, data-sayfa-bos) ortak.
  assert.match(g, /<BosSatir id="gelenler" bos=\{g\.bos\} \/>/);
});

test('Gelenler kokpitin önem sırasını kullanır, yeni model çağrısı yok (kaynak taraması: yardimci/cagir yok)', () => {
  const s = gelenlerSayfasi({
    epostalar: [
      eposta(1, 2, false, yerel(9, 50)),
      eposta(2, 5, true, yerel(8)),
      eposta(3, 0, true, yerel(9, 55)), // okunmuş bülten: gelmez
      eposta(4, 4, false, yerel(7)),
      eposta(5, 4, false, yerel(9, 30)),
    ],
    whatsapp: [wa('a', 2, yerel(9, 40)), wa('b', 0, yerel(9, 59))], // okunmuş yazışma gelmez
    kaynak: { eposta: true, whatsapp: true },
  });
  assert.deepEqual(s.ogeler.map((o) => `${o.kanal}:${o.oncelik}`), ['eposta:5', 'eposta:4', 'eposta:4', 'whatsapp:3', 'eposta:2']);
  assert.deepEqual(s.ogeler.slice(1, 3).map((o) => o.ozet), ['Konu 5', 'Konu 4'], 'eşit önemde yenisi önce');
  assert.equal(s.ogeler[0].kimden, 'Kişi 2', 'adres parçası düşer');
  assert.equal(s.ogeler[3].kimden, 'Ad a');
  // Tıklama: ana penceredeki kokpit sohbeti "Şu mesaja yanıt taslağı hazırla: …" ile (göndermez; gönderme her seferinde onaylı).
  assert.equal(YANIT_TASLAGI_ONEKI, 'Şu mesaja yanıt taslağı hazırla:');
  const istem = gelenIstemi(s.ogeler[0]);
  assert.ok(istem.metin.startsWith(`${YANIT_TASLAGI_ONEKI} `), istem.metin);
  assert.match(istem.metin, /#2/);
  assert.match(istem.metin, /gönderme/i);
  assert.equal(istem.arac, true);
  // Önem kokpitten gelir: Gelenler yeni bir model çağrısı yapmaz.
  for (const dosya of ['src/shared/centik-veri.ts', 'src/main/centik-veri.ts', 'src/renderer/ada/sayfalar/Gelenler.tsx']) {
    const k = yorumsuz(oku(dosya));
    assert.doesNotMatch(k, /yardimci|motor\/|saglayici|\bsohbet:gonder\b.*yardimci/i, dosya);
  }
  assert.doesNotMatch(yorumsuz(oku('src/shared/centik-veri.ts')), /\bcagir\b/, 'saf modül çağrı yapmaz');
  assert.doesNotMatch(yorumsuz(oku('src/main/centik-veri.ts')), /\bcagir\b|yardimciMetin|yardimciJson/);
});

/** Sahte takvim bağlamı: çağrı sayacı, bellekte önbellek (anahtar başına), elle ilerleyen saat. */
function sahteBaglam(o: { gizli?: boolean; bagli?: boolean; sonuc?: unknown | (() => Promise<unknown>) } = {}) {
  const depo = new Map<string, string>();
  const yazilan: string[] = [];
  const s = { gizli: o.gizli ?? false, bagli: o.bagli ?? true, yenilenmeli: false, saat: SIMDI, cagri: 0 };
  const b: TakvimBaglami = {
    bulutKapali: () => s.gizli,
    yenilenmeli: () => s.yenilenmeli,
    girdi: () => (s.bagli ? { id: 'google-takvim', arac: { ad: 'list_events', girdi: { calendarId: 'primary' } } } : null),
    aracCagir: async (id, ad, girdi) => {
      s.cagri++;
      assert.equal(id, 'google-takvim'); assert.equal(ad, 'list_events'); assert.deepEqual(girdi, { calendarId: 'primary' });
      const r = typeof o.sonuc === 'function' ? await (o.sonuc as () => Promise<unknown>)() : o.sonuc ?? mcpMetin({ items: [{ summary: 'Ekip toplantısı', start: { dateTime: yerel(11) }, end: { dateTime: yerel(12) } }] });
      return r;
    },
    oku: (k) => depo.get(k),
    yaz: (k, v) => { yazilan.push(k); depo.set(k, v); },
    simdi: () => s.saat,
    durum: takvimDurumuYeni(),
  };
  return { b, s, depo, yazilan };
}

test("Gizli'de takvim yalnız önbellekten, MCP çağrısı yok, BULUT_KAPALI_METNI.takvim görünür", async () => {
  const { b, s, depo } = sahteBaglam({ gizli: true });
  depo.set(TAKVIM_ONBELLEK_ANAHTARI, JSON.stringify({ surum: 1, zaman: SIMDI - 3 * 3600_000, kaynak: 'google-takvim', olaylar: [{ baslik: 'Ekip toplantısı', bas: yerel(11), bit: yerel(12), tumGun: false }] }));
  const r = await takvimAl(b);
  assert.equal(s.cagri, 0, 'Gizli\'de MCP çağrısı yok');
  assert.deepEqual(r.olaylar?.map((o) => o.baslik), ['Ekip toplantısı']);
  assert.equal(r.not, BULUT_KAPALI_METNI.takvim);
  const g = gundemSayfasi(BOS_KOKPIT, r.olaylar, SIMDI, { not: r.not });
  assert.equal(g.not, BULUT_KAPALI_METNI.takvim);
  assert.equal((g.siradaki as TakvimOlayi).baslik, 'Ekip toplantısı');
  assert.equal(g.bos, null, 'Gizli\'de "Bağla" yok (bağlanılamaz)');
  // Önbellek yokken de çağrı yok; bağlı takvim boş görünür, not yine söylenir.
  const yok = sahteBaglam({ gizli: true });
  const r2 = await takvimAl(yok.b);
  assert.equal(yok.s.cagri, 0);
  assert.deepEqual(r2.olaylar, []);
  assert.equal(r2.not, BULUT_KAPALI_METNI.takvim);
  // Review Focus 3: çağrı sürerken Gizli açılır — sonuç gösterilmez, önbelleğe yazılmaz; son kopya gösterilir.
  let ac: () => void = () => undefined;
  const arada = sahteBaglam({ sonuc: () => new Promise((c) => { ac = () => c(mcpMetin({ items: [{ summary: 'Sızmamalı', start: { dateTime: yerel(15) } }] })); }) });
  const p = takvimAl(arada.b);
  await new Promise((c) => setImmediate(c));
  arada.s.gizli = true;
  ac();
  const r3 = await p;
  assert.equal(arada.s.cagri, 1);
  assert.ok(!(r3.olaylar ?? []).some((o) => o.baslik === 'Sızmamalı'), 'Gizli açıldıktan sonra gelen yanıt gösterilmez');
  assert.equal(r3.not, BULUT_KAPALI_METNI.takvim);
  assert.equal(arada.depo.get(TAKVIM_ONBELLEK_ANAHTARI), undefined, 'geç gelen yanıt önbelleğe yazılmaz');
  // Sayfa notu gösterir.
  assert.match(oku('src/renderer/ada/sayfalar/Gundem.tsx'), /\.not\b/);
});

test("takvim aracı 15 dk'dan sık çağrılmaz", async () => {
  assert.equal(TAKVIM_ARALIK_MS, 15 * 60_000);
  const { b, s } = sahteBaglam();
  const [a1, a2] = await Promise.all([takvimAl(b), takvimAl(b)]);
  assert.equal(s.cagri, 1, 'aynı anda iki açılış tek çağrı');
  assert.deepEqual(a1.olaylar?.map((o) => o.baslik), ['Ekip toplantısı']);
  assert.deepEqual(a2.olaylar, a1.olaylar);
  s.saat += 5 * 60_000;
  assert.deepEqual((await takvimAl(b)).olaylar?.map((o) => o.baslik), ['Ekip toplantısı']);
  s.saat += 9 * 60_000;
  await takvimAl(b);
  assert.equal(s.cagri, 1, '14 dk içinde yeniden çağrılmaz');
  s.saat += 60_000 + 1;
  await takvimAl(b);
  assert.equal(s.cagri, 2, '15 dk dolunca yeniden çağrılır');
  // Başarısız çağrı da 15 dk bekletir (servis düşükken her açılışta denenmez); hata tek satır, son kopya kalır.
  const h = sahteBaglam({ sonuc: () => Promise.reject(new Error('Bağlantı yenilenmeli.')) });
  const r = await takvimAl(h.b);
  assert.equal(r.hata, 'Bağlantı yenilenmeli.');
  h.s.saat += 10 * 60_000;
  await takvimAl(h.b);
  assert.equal(h.s.cagri, 1);
  // Tanınmayan biçim: "Takvim okunamadı" (R12), önbellek bozulmaz.
  const t = sahteBaglam({ sonuc: { content: [{ type: 'text', text: 'bilinmeyen' }] } });
  assert.equal((await takvimAl(t.b)).hata, 'Takvim okunamadı.');
  assert.equal(t.depo.get(TAKVIM_ONBELLEK_ANAHTARI), undefined);
  // Bağlı değil: çağrı yok, olaylar null (Gündem "Takvim bağlı değil" der).
  const yok = sahteBaglam({ bagli: false });
  assert.equal((await takvimAl(yok.b)).olaylar, null);
  assert.equal(yok.s.cagri, 0);
  // Panelde yoklama yok: sayfalar görünürken ve olaylarla tazelenir (setInterval / rAF yok).
  for (const d of ['Gundem.tsx', 'Gorevler.tsx', 'Gelenler.tsx']) assert.doesNotMatch(oku(`src/renderer/ada/sayfalar/${d}`), /setInterval|requestAnimationFrame/, d);
  assert.doesNotMatch(yorumsuz(oku('src/main/centik-veri.ts')), /setInterval/);
});

test('takvim önbelleği takvim-onbellek anahtarıyla yazılır; Gizli\'de oradan okunur', async () => {
  assert.equal(TAKVIM_ONBELLEK_ANAHTARI, 'takvim-onbellek');
  const { b, s, depo, yazilan } = sahteBaglam();
  await takvimAl(b);
  assert.deepEqual(yazilan, [TAKVIM_ONBELLEK_ANAHTARI]);
  const kayit = JSON.parse(depo.get(TAKVIM_ONBELLEK_ANAHTARI)!);
  assert.equal(kayit.kaynak, 'google-takvim');
  assert.equal(kayit.zaman, SIMDI);
  assert.deepEqual(kayit.olaylar.map((o: TakvimOlayi) => o.baslik), ['Ekip toplantısı']);
  assert.ok(!JSON.stringify(kayit).includes('content'), 'ham araç yanıtı saklanmaz');
  // Gizli: aynı depodan okunur, çağrı yok.
  s.gizli = true;
  s.saat += 2 * 3600_000;
  const r = await takvimAl(b);
  assert.equal(s.cagri, 1);
  assert.deepEqual(r.olaylar?.map((o) => o.baslik), ['Ekip toplantısı']);
  // Bozuk önbellek düşer (fırlatmaz).
  depo.set(TAKVIM_ONBELLEK_ANAHTARI, '{bozuk');
  assert.deepEqual((await takvimAl(b)).olaylar, []);
  // Depo: kokpit kartlarının durduğu yerel veritabanı (vt.ts meta tablosu).
  const ana = oku('src/main/centik-veri.ts');
  assert.match(ana, /metaYaz\(k, v\)|metaYaz\(TAKVIM_ONBELLEK_ANAHTARI/);
  assert.match(ana, /from '\.\/vt\.js'/);
});

const is = (id: number, durum: IsOzet['durum'], ek: Partial<IsOzet> = {}): IsOzet => ({
  id, baslik: `Görev ${id}`, amac: 'amaç', durum, plan: { gozcu: { tur: 'saat' }, aralik: { min: 60, max: 600 }, bitis: { tur: 'sure', saniye: 3600 }, izinler: [], azamiAdim: 60 } as unknown as IsOzet['plan'],
  baslangic: yerel(9), bitisZamani: durum === 'suruyor' ? yerel(11) : yerel(9, 30), sonraki: null, sonKontrol: yerel(9, 58), adim: 2, kontrol: 3, sonOzet: null, sonuc: null,
  durmaNedeni: durum === 'durdu' ? 'kullanici' : null, sohbetId: 40 + id, ...ek,
});

test('Görevler: süren sohbet turu ve görevler, Durdur doğru kanala gider', () => {
  const s = gorevlerSayfasi([is(3, 'suruyor'), is(4, 'bitti', { sonuc: 'Rapor hazır' }), is(5, 'durdu')], { sohbetId: 7, adim: 4, etiket: 'Sayfa okunuyor' }, SIMDI);
  assert.equal(s.suren, 2, 'süren tur + süren görev');
  assert.deepEqual(s.ogeler[0].eylem, { tur: 'durdur', kanal: 'sohbet:durdur', id: 7 });
  assert.match(s.ogeler[0].alt, /4\. adım · Sayfa okunuyor/);
  assert.deepEqual(s.ogeler[1].eylem, { tur: 'durdur', kanal: 'isler:durdur', id: 3 });
  assert.equal(s.ogeler.find((o) => o.anahtar === 'is:4')?.eylem, null, 'biten görevde eylem yok');
  assert.equal(s.bos, null);
  const bos = gorevlerSayfasi([], null, SIMDI);
  assert.equal(bos.suren, 0);
  assert.deepEqual(bos.ogeler, []);
  assert.ok(bos.bos);
  // Arayüz Durdur'u çentiğin mevcut yollarından verir (Çalışıyor hapı: sohbet:durdur; görev hapı: isler:durdur) — hata tek satır orada.
  const g = oku('src/renderer/ada/sayfalar/Gorevler.tsx');
  assert.match(g, /calisiyorDurdur\(/);
  assert.match(g, /gorevDurdur\(/);
  assert.match(g, /'isler:surdur'/);
  assert.match(oku('src/renderer/ada/Panel.tsx'), /sayfaKaydet\('gorevler', Gorevler\)/);
});

test('sayfalar karakter çizmez (Sade modda da), vurgu PANEL_SAYFALARI\'ndan; hareket yalnız transform ve opacity', () => {
  for (const d of ['Gundem.tsx', 'Gorevler.tsx', 'Gelenler.tsx']) {
    const k = oku(`src/renderer/ada/sayfalar/${d}`);
    assert.doesNotMatch(k, /GorunenGoz|<Gozler\b|ModGecisi/, d);
    assert.doesNotMatch(k, /#[0-9a-f]{3,8}\b/i, `${d}: renk satır içinde yok (vurgu --panel-vurgu)`);
  }
  // Sayfa CSS'i panel.css'te (tests/centik-sayfalar.test.ts geçiş taraması onu da kapsar).
  const css = oku('src/renderer/ada/panel.css');
  for (const s of ['.gundem-sayfa', '.gorevler-sayfa', '.gelenler-sayfa']) assert.ok(css.includes(s), s);
});

// ── Düzeltme turu 1 ──
test('düzeltme 1: takvimHemen beklemez — önbellekteki kopya hemen, çağrı arka planda; bitince 15 dk boyunca yeniden çağrılmaz', async () => {
  let birak: (x: unknown) => void = () => undefined;
  const { b, s, depo } = sahteBaglam({ sonuc: () => new Promise((c) => { birak = c; }) });
  depo.set(TAKVIM_ONBELLEK_ANAHTARI, JSON.stringify({ surum: 1, zaman: SIMDI - 3600_000, kaynak: 'google-takvim', olaylar: [{ baslik: 'Eski kopya', bas: yerel(11), tumGun: false }] }));
  const h = takvimHemen(b);
  assert.deepEqual(h.olaylar?.map((o) => o.baslik), ['Eski kopya'], 'bayat kopya hemen');
  assert.ok(h.tazele, 'arka planda çağrı başladı');
  const h2 = takvimHemen(b);
  assert.equal(h2.tazele, null, 'süren çağrı varken ikinci çağrı yok');
  assert.deepEqual(h2.olaylar?.map((o) => o.baslik), ['Eski kopya']);
  await new Promise((c) => setImmediate(c));
  assert.equal(s.cagri, 1);
  birak(mcpMetin({ items: [{ summary: 'Yeni toplantı', start: { dateTime: yerel(12) } }] }));
  const r = await h.tazele!;
  assert.deepEqual(r.olaylar?.map((o) => o.baslik), ['Yeni toplantı']);
  const h3 = takvimHemen(b);
  assert.equal(h3.tazele, null);
  assert.deepEqual(h3.olaylar?.map((o) => o.baslik), ['Yeni toplantı']);
  assert.equal(s.cagri, 1);
  // Gizli: tazele hiç yok.
  s.gizli = true; s.saat += TAKVIM_ARALIK_MS + 1;
  assert.equal(takvimHemen(b).tazele, null);
  assert.equal(s.cagri, 1);
  // Ana süreç bekletmez: centikVerisi takvimHemen kullanır, takvimAl'ı beklemez; çağrı bitince mevcut olayla yeniden çizilir.
  const ana = yorumsuz(oku('src/main/centik-veri.ts'));
  assert.match(ana, /takvimHemen\(takvimBaglami\)/);
  assert.doesNotMatch(ana, /await\s+takvimAl/);
  assert.match(ana, /yayinla\('kokpit:veri-degisti'/);
});

test("düzeltme 1: Gizli'de takvim hiç bağlı değilse 'son kopya' denmez; yenilenmeli bağlantı ayrı söylenir", async () => {
  const yok = sahteBaglam({ gizli: true, bagli: false });
  const r = await takvimAl(yok.b);
  assert.equal(r.olaylar, null);
  assert.equal(r.not, TAKVIM_BAGLI_DEGIL);
  assert.equal(yok.s.cagri, 0);
  const g = gundemSayfasi(BOS_KOKPIT, r.olaylar, SIMDI, { not: r.not });
  assert.equal(g.not, TAKVIM_BAGLI_DEGIL);
  assert.equal(g.bos, null, 'Gizli\'de Bağla yok');
  yok.s.yenilenmeli = true;
  assert.equal((await takvimAl(yok.b)).not, TAKVIM_YENILENMELI);
  // Gizli değil, yenilenmeli: Bağla aynı karta, metin "yenilenmeli".
  yok.s.gizli = false;
  const y = takvimHemen(yok.b);
  assert.equal(y.yenilenmeli, true);
  assert.equal(TAKVIM_YENILENMELI, 'Takvim bağlantısı yenilenmeli.');
  assert.deepEqual(gundemSayfasi(BOS_KOKPIT, y.olaylar, SIMDI, { cipa: 'servis-google-takvim', yenilenmeli: y.yenilenmeli }).bos, { metin: TAKVIM_YENILENMELI, eylem: 'baglantilar', cipa: 'servis-google-takvim' });
});

test("düzeltme 1: okunmamış sayısı kesmeden önce (WhatsApp'ta mesaj); Gizli'de Gelenler tek satırla söyler", () => {
  const epostalar = Array.from({ length: 9 }, (_, i) => eposta(100 + i, 3, false, yerel(9, i)));
  const s = gelenlerSayfasi({ epostalar, whatsapp: [wa('a', 4, yerel(9, 40)), wa('b', 0, yerel(9, 41))], kaynak: { eposta: true, whatsapp: true } });
  assert.equal(s.ogeler.length, 6);
  assert.equal(s.okunmamis, 9 + 4);
  assert.equal(s.not, null);
  assert.equal(GELEN_GIZLI_NOTU, 'Gizli modda yanıt taslağı hazırlanmaz.');
  assert.equal(gelenlerSayfasi({ epostalar, whatsapp: [], kaynak: { eposta: true, whatsapp: false }, bulut: { gizliMod: true, yalnizYerel: false } }).not, GELEN_GIZLI_NOTU);
  assert.equal(gelenlerSayfasi({ epostalar, whatsapp: [], kaynak: { eposta: true, whatsapp: false }, bulut: { gizliMod: false, yalnizYerel: true } }).not, GELEN_YEREL_NOTU);
  const g = oku('src/renderer/ada/sayfalar/Gelenler.tsx');
  assert.match(g, /deger=\{g\.okunmamis\}/);
  assert.match(g, /g\.not/);
});

test('düzeltme 1: sayfalar yalnız ilgili ayar değişince ve 300 ms birleştirilerek yeniden çeker; Bağlantılar çapası kaydırınca temizlenir', () => {
  const k = oku('src/renderer/ada/sayfalar/useCentikVerisi.ts');
  assert.match(k, /CENTIK_VERI_BIRLESTIRME_MS = 300/);
  assert.match(k, /ilgiliAyarImzasi/);
  for (const alan of ['gizliMod', 'yalnizYerel', 'a?.mod', 'eposta', 'whatsapp']) assert.ok(k.includes(alan), alan);
  assert.doesNotMatch(k, /setInterval|requestAnimationFrame/);
  assert.match(oku('src/renderer/sayfalar/Baglantilar.tsx'), /history\.replaceState\(/);
});
