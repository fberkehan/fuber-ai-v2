// 0.11 G9 + G1 (spec §1, §8): görev adımının iç talimatı da hiçbir yüzeyde görünmez. Adım kendi görev sohbetinde `gizliTetik` iç talimatla
// çalışır; bağlam (amaç, plan, son adımlar, gözcünün bulduğu) talimatta değil kayda girmeyen bağlam bloğundadır. Yankılayan motor (talimatı
// aynen geri yazan küçük model) → adım BAŞARISIZ: özet yok, ana sohbete satır yok, bildirim yok, hiçbir olay talimatı taşımaz; art arda 3
// başarısızlıkta görev "hata" olur ve tek sakin cümleyle durur. GERÇEK ajan döngüsü + görev adımı + zamanlayıcı (saati ve gözcüsü sahte) +
// sohbet deposu; motor bu bilgisayardaki sahte Fuber ağ geçidi.
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { anaSurecSahnesi, ipcKurBos } from './yardimci/ana-surec.ts';
import { sahteGecit, gecitAyari } from './yardimci/sahte-gecit.ts';
import { isPlaniDogrula } from '../src/shared/isler.ts';
import { icTalimatYankisiMi } from '../src/shared/ic-talimat.ts';

const gecit = await sahteGecit();
anaSurecSahnesi('isler-ic-talimat', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', hitap: 'Deniz', mod: 'is', tanitimSurumu: '0.9.0',
  ses: { surum: 2, uyandirma: false }, proaktif: { etkin: false, sessizBaslangic: '00:00', sessizBitis: '00:00' }, baslangictaAc: false, motorCalisti: true,
  ...gecitAyari(gecit),
});
(globalThis as Record<string, unknown>).__sifreleme = true;
process.env.FUBER_DEMO = '1';
process.env.FUBER_TEST_TAM_EKRAN = '0'; // ada yolu gerçek tam ekran yardımcısını açmasın
await ipcKurBos();
const { sirYaz } = await import('../src/main/ayarlar.ts');
const yerelFetch = (globalThis as Record<string, unknown>).__yerelFetch as typeof fetch;
globalThis.fetch = ((u: string, i?: RequestInit) => yerelFetch(u, i)) as typeof fetch;

const { islerAraclariniKaydet } = await import('../src/main/ajan/araclar/isler.ts');
const { herOlayiDinle } = await import('../src/main/olaylar.ts');
const Z = await import('../src/main/isler/zamanlayici.ts');
const { isGetir } = await import('../src/main/isler/depo.ts');
const { adimCalistir, ADIM_TALIMATI } = await import('../src/main/isler/adim.ts');
const { mesajlar, gorunenMesajlar, anaSohbet, sohbetListesi } = await import('../src/main/sohbet.ts');
const { yanitla, mesgulMu, turSonrasiniBitir, hepsiniDurdur } = await import('../src/main/ajan/dongu.ts');
const { sohbetBilgisi } = await import('../src/main/sohbet.ts');
const { ayarlariKaydet } = await import('../src/main/ayarlar.ts');
after(() => turSonrasiniBitir());
const { testBildirimKaydi } = await import('../src/main/zamanlayici.ts');
islerAraclariniKaydet();

let saat = Date.now();
const zamanlar = new Set<{ f: () => void; at: number }>();
Z.islerBagimliliklari({
  simdi: () => saat,
  kur: (f: () => void, ms: number) => { const h = { f, at: saat + ms }; zamanlar.add(h); return h; },
  iptal: (h: unknown) => { zamanlar.delete(h as { f: () => void; at: number }); },
  gozcu: async () => ({ degisti: true, iz: `iz-${saat}`, bulgu: 'Ahmet Yılmaz: Toplantıyı yarına alalım mı?' }),
  yol: () => 'bulut',
});
async function ilerle(): Promise<boolean> {
  const h = [...zamanlar].sort((a, b) => a.at - b.at)[0];
  if (!h) return false;
  zamanlar.delete(h);
  saat = Math.max(saat, h.at);
  h.f();
  await Z._test.bosta();
  return true;
}

const AMAC = 'Ahmet’in toplantı hakkındaki yanıtını izle ve önemli bir şey olursa bana kısaca söyle.';
const p = isPlaniDogrula({ gozcu: { tur: 'whatsapp', hedef: 'Ahmet' }, aralik: { min: 10, max: 60 }, bitis: { tur: 'sure', saniye: 3600 }, izinler: [] });
assert.ok('plan' in p);
const iz = (s: string) => s.slice(0, 40);
const olaylar: { kanal: string; veri: unknown }[] = [];
herOlayiDinle((kanal, veri) => { olaylar.push({ kanal, veri }); });
const tasiyan = (s: string) => olaylar.filter((o) => (JSON.stringify(o.veri) ?? '').includes(iz(s))).map((o) => `${o.kanal}:${(o.veri as { tur?: string })?.tur ?? ''}`);

test('iç talimat kısa ve emir kipinde; amaç/plan talimatta değil (bağlam bloğunda)', () => {
  assert.ok(ADIM_TALIMATI.length < 120, ADIM_TALIMATI);
  assert.doesNotMatch(ADIM_TALIMATI, /Ahmet|toplantı/);
});

// Son inceleme küçük 3: talimat "GÖREV ADIMI:" gibi büyük harfli bir BAŞLIKLA başlamaz — yankı bekçisi başlıkla başlayan her yanıtı yankı sayar;
// olağan bir özet ("Görev adımı: …") adımı başarısız yapıyor, üst üste üçte görev 'hata' ile duruyordu. Gerçek yankı yine yakalanır (40 karakter kuralı).
test('küçük 3: olağan özet ("Görev adımı: …") yankı sayılmaz; talimatın gerçek yankısı (tam, parça, biçim farkıyla) yine yakalanır', () => {
  assert.doesNotMatch(ADIM_TALIMATI, /^[A-ZÇĞİÖŞÜ ]{4,}:/, 'büyük harfli başlık yok');
  for (const ozet of ['Görev adımı: Ahmet’e toplantı saatini sordum.', 'GÖREV ADIMI: fiyat hâlâ 1.250 TL.', 'Görev adımı tamam; yeni e-posta yok.', 'Bağlamdaki fiyatı kontrol ettim, değişmemiş.']) {
    assert.equal(icTalimatYankisiMi(ozet, ADIM_TALIMATI), false, `olağan özet yankı değil: ${ozet}`);
  }
  for (const yanki of [ADIM_TALIMATI, `**${ADIM_TALIMATI.toLocaleUpperCase('tr')}**`, `Tamam. ${ADIM_TALIMATI.slice(0, 60)}`, `  ${ADIM_TALIMATI.replace(/ /g, '  ')}  `]) {
    assert.equal(icTalimatYankisiMi(yanki, ADIM_TALIMATI), true, `gerçek yankı yakalanır: ${yanki}`);
  }
  // Eski talimat ("GÖREV ADIMI: …") olağan özeti yankı sayıyordu — kuralın kendisi değişmedi, yalnız talimat.
  assert.equal(icTalimatYankisiMi('Görev adımı: Ahmet’e toplantı saatini sordum.', 'GÖREV ADIMI: Bağlamdaki görevin sıradaki adımını yap, sonra is_adim_bitti çağır.'), true);
});

test('normal adım: yanıt görev sohbetinde görünür; iç talimat ve bağlam bloğu hiçbir yerde görünmez; modele bağlam gider', async () => {
  const r = Z.isBaslat({ baslik: 'Ahmet’i izle', amac: AMAC, plan: p.plan });
  assert.ok('is' in r);
  gecit.kip = 'sira';
  gecit.yanitlar.push('Ahmet toplantıyı yarına almak istiyor; sana haber veriyorum.');
  olaylar.length = 0;
  const istekOnce = gecit.istekler.length;
  const s = await adimCalistir(isGetir(r.is.id)!, 'Ahmet Yılmaz: Toplantıyı yarına alalım mı?');
  assert.ok(s);
  assert.match(s.ozet, /yarına/);
  const istek = gecit.istekler[istekOnce];
  assert.ok(istek.son.includes(ADIM_TALIMATI), 'talimat modele gitti');
  assert.ok(istek.son.includes(AMAC), 'amaç bağlam bloğunda');
  assert.ok(istek.son.includes('Toplantıyı yarına alalım mı?'), 'gözcünün bulduğu bağlamda');
  assert.ok(istek.son.indexOf(AMAC) < istek.son.indexOf('</baglam>'), 'amaç bağlam bloğunun içinde');
  const gorunen = JSON.stringify(gorunenMesajlar(r.is.sohbetId));
  assert.ok(gorunen.includes('sana haber veriyorum'));
  assert.ok(!gorunen.includes(iz(ADIM_TALIMATI)), 'talimat görünmez');
  assert.ok(!gorunen.includes(AMAC), 'bağlam bloğu görünmez');
  assert.ok(!mesajlar(r.is.sohbetId).some((m) => m.metin.includes('<baglam>') || m.metin.includes(AMAC)), 'bağlam bloğu kayda girmez');
  assert.ok(!(sohbetListesi().find((x) => x.id === r.is.sohbetId)?.sonMesaj ?? '').includes(iz(ADIM_TALIMATI)), 'liste önizlemesi');
  assert.deepEqual(tasiyan(ADIM_TALIMATI), [], 'hiçbir olay talimatı taşımaz');
  Z.isDurdur(r.is.id, 'kullanici');
});

test('yankılayan motor: adım başarısız — görev sohbetinde yanıt yok, ana sohbete satır yok, bildirim yok, olaylarda talimat yok', async () => {
  const r = Z.isBaslat({ baslik: 'Yankı işi', amac: AMAC, plan: p.plan });
  assert.ok('is' in r);
  gecit.kip = 'yanki';
  olaylar.length = 0;
  const ana = anaSohbet();
  const anaOnce = mesajlar(ana).length, bildirimOnce = testBildirimKaydi().length;
  try {
    const s = await adimCalistir(isGetir(r.is.id)!, 'Ahmet Yılmaz: merhaba');
    assert.equal(s, null, 'yankı = başarısız adım');
  } finally { gecit.kip = 'sira'; }
  assert.ok(!gorunenMesajlar(r.is.sohbetId).some((m) => m.rol === 'assistant' && !/Başladım/.test(JSON.stringify(m.bloklar))), 'adımın yanıtı görünmez');
  assert.ok(!mesajlar(r.is.sohbetId).some((m) => m.rol === 'assistant' && m.metin.includes(iz(ADIM_TALIMATI))), 'yankı kayıtta kalmadı');
  assert.equal(mesajlar(ana).length, anaOnce);
  assert.equal(testBildirimKaydi().length, bildirimOnce);
  assert.deepEqual(tasiyan(ADIM_TALIMATI), []);
  Z.isDurdur(r.is.id, 'kullanici');
});

test('is_adim_bitti’nin "bildir"i talimatı yankılıyorsa adım başarısız; araç bloğu kayıttan ve olaylardan da düşer (Geliştirici "Ayrıntılar"ı dahil)', async () => {
  const r = Z.isBaslat({ baslik: 'Bildirim yankısı', amac: AMAC, plan: p.plan });
  assert.ok('is' in r);
  olaylar.length = 0;
  gecit.yanitlar.push(`<arac ad="is_adim_bitti">${JSON.stringify({ ozet: 'Baktım.', bildir: ADIM_TALIMATI })}</arac>`);
  const s = await adimCalistir(isGetir(r.is.id)!, undefined);
  assert.equal(s, null);
  assert.deepEqual(tasiyan(ADIM_TALIMATI), [], 'hiçbir olay (araç kartı dahil) talimatı taşımaz');
  assert.ok(!olaylar.some((o) => o.kanal === 'sohbet:olay' && (o.veri as { tur?: string }).tur === 'arac'), 'yankılı araç çalışmadı, kartı yayılmadı');
  assert.ok(!mesajlar(r.is.sohbetId).some((m) => m.rol !== 'not' && JSON.stringify(m.bloklar).includes(iz(ADIM_TALIMATI))), 'araç bloğu kayıttan düştü');
  assert.ok(!mesajlar(r.is.sohbetId).some((m) => m.bloklar.some((b) => b.tur === 'arac_cagri' && b.ad === 'is_adim_bitti')));
  assert.ok(!JSON.stringify(gorunenMesajlar(r.is.sohbetId)).includes(iz(ADIM_TALIMATI)), 'görünümde (Ayrıntılar girdisi dahil) yok');
  Z.isDurdur(r.is.id, 'kullanici');
});

test('Ö2: adım bağlamı sınırlı — sohbet geçmişi ve hafıza araması gitmez; önceki adımların metni yok; istek boyutu adım sayısıyla büyümez', async () => {
  const r = Z.isBaslat({ baslik: 'Sınırlı bağlam', amac: AMAC, plan: p.plan });
  assert.ok('is' in r);
  const istekler: { hepsi: string }[] = [];
  for (let n = 1; n <= 5; n++) {
    gecit.yanitlar.push(`ADIM-${n}-UZUN-METNI ${'ayrıntı '.repeat(60)}\n<arac ad="is_adim_bitti">${JSON.stringify({ ozet: `özet ${n}` })}</arac>`);
    const once = gecit.istekler.length;
    assert.ok(await ilerle());
    const adimIstegi = gecit.istekler.slice(once).find((i) => i.son.includes(ADIM_TALIMATI));
    assert.ok(adimIstegi, `adım ${n} modele gitti`);
    istekler.push(adimIstegi);
  }
  assert.equal(isGetir(r.is.id)!.adim, 5);
  const besinci = istekler[4].hepsi;
  for (let n = 1; n <= 4; n++) assert.ok(!besinci.includes(`ADIM-${n}-UZUN-METNI`), `adım ${n}'in metni yok`);
  for (const n of [2, 3, 4]) assert.ok(besinci.includes(`özet ${n}`), `son 3 adımın özeti var: ${n}`);
  assert.ok(!besinci.includes('özet 1'), 'yalnız son 3 özet');
  assert.equal(besinci.split(ADIM_TALIMATI).length - 1, 1, 'önceki adımların iç talimatı (geçmiş) yok');
  assert.doesNotMatch(besinci, /İlgili hafıza/, 'hafıza araması yok');
  assert.ok(Math.abs(istekler[4].hepsi.length - istekler[3].hepsi.length) < 40, `${istekler[3].hepsi.length} → ${istekler[4].hepsi.length}`);
  Z.isDurdur(r.is.id, 'kullanici');
});

/** Köprünün kararıyla (main/kopru.ts: aynı saf işlev, aynı "turu başlatan" izi) bu olaylardan kaç telefon bildirimi çıkardı. */
function telefonBildirimSayisi(liste: { kanal: string; veri: unknown }[]): number {
  const baslayan = new Map<number, string>();
  let n = 0;
  for (const { kanal, veri } of liste) {
    if (kanal !== 'sohbet:olay') continue;
    const o = veri as Parameters<typeof telefonBildirimi>[0];
    if (o.tur === 'basladi') { baslayan.set(o.sohbetId, o.kullaniciMesaji.kaynak ?? 'kullanici'); continue; }
    const k = o.tur === 'bitti' ? baslayan.get(o.sohbetId) : undefined;
    if (o.tur === 'bitti') baslayan.delete(o.sohbetId);
    if (telefonBildirimi(o, k, sohbetBilgisi(o.sohbetId)?.tur === 'gorev')) n++;
  }
  return n;
}

test('#5 (düzeltme turu 2): kesilen gizli adım (erteleme, durdurma, acil) "hata"/"Durduruldu." olayı yaymaz, kayıt bırakmaz', async () => {
  const r = Z.isBaslat({ baslik: 'Kesilen adım', amac: AMAC, plan: p.plan });
  assert.ok('is' in r);
  const sohbet = r.is.sohbetId;
  const izTemiz = (neden: string) => {
    assert.ok(!olaylar.some((o) => o.kanal === 'sohbet:olay' && (o.veri as { tur?: string; sohbetId?: number }).tur === 'hata' && (o.veri as { sohbetId?: number }).sohbetId === sohbet), `${neden}: hata olayı yok`);
    assert.ok(!olaylar.some((o) => JSON.stringify(o.veri ?? '').includes('Durduruldu.')), `${neden}: "Durduruldu." yayılmadı`);
    assert.ok(!mesajlar(sohbet).some((m) => m.metin === 'Durduruldu.' || m.kaynak === 'durduruldu'), `${neden}: kayıt yok`);
  };
  const tut = () => { let birak: () => void = () => undefined; gecit.bekle = new Promise<void>((c) => { birak = c; }); return () => { gecit.bekle = null; birak(); }; };
  const istegiBekle = async (once: number) => { for (let i = 0; i < 400 && gecit.istekler.length === once; i++) await new Promise((c) => setTimeout(c, 5)); };
  // a) Erteleme: zamanlayıcının kesicisi (kullanıcı ekrana geçti).
  olaylar.length = 0;
  let birak = tut();
  const ac = new AbortController();
  let once = gecit.istekler.length;
  const s = adimCalistir(isGetir(r.is.id)!, 'Ahmet Yılmaz: merhaba', new Date(), ac.signal);
  await istegiBekle(once);
  ac.abort();
  assert.equal(await s, 'ertele');
  birak();
  izTemiz('erteleme');
  // b) Durdurma (kullanıcı) — zamanlayıcının süren adımı.
  for (const [ad, kes] of [['durdurma', () => Z.isDurdur(r.is.id, 'kullanici')], ['acil', () => { hepsiniDurdur(); Z.tumIsleriDurdur('acil'); }]] as const) {
    if (isGetir(r.is.id)!.durum !== 'suruyor') assert.ok('is' in Z.isSurdur(r.is.id));
    olaylar.length = 0;
    birak = tut();
    once = gecit.istekler.length;
    const h = [...zamanlar].sort((x, y) => x.at - y.at)[0];
    zamanlar.delete(h);
    saat = Math.max(saat, h.at);
    h.f();
    await istegiBekle(once);
    assert.ok(gecit.istekler.length > once, `${ad}: adım modele gitti`);
    kes();
    birak();
    await Z._test.bosta();
    izTemiz(ad);
    assert.equal(isGetir(r.is.id)!.durum, 'durdu');
  }
});

test('#14: kullanıcı görev sohbetinde yazışırken adım tetiklenirse adım ertelenir (başarısız değil) ve sohbete "meşgul" hatası düşmez', async () => {
  const r = Z.isBaslat({ baslik: 'Meşgul sohbet', amac: AMAC, plan: p.plan });
  assert.ok('is' in r);
  let birak: () => void = () => undefined;
  gecit.bekle = new Promise<void>((c) => { birak = c; });
  olaylar.length = 0;
  const kullaniciTuru = yanitla(r.is.sohbetId, { metin: 'Şu an ne durumda?' });
  try {
    for (let i = 0; i < 200 && !mesgulMu(r.is.sohbetId); i++) await new Promise((c) => setTimeout(c, 5));
    assert.equal(mesgulMu(r.is.sohbetId), true);
    const s = await adimCalistir(isGetir(r.is.id)!, 'Ahmet Yılmaz: merhaba');
    assert.equal(s, 'ertele');
    assert.ok(!olaylar.some((o) => o.kanal === 'sohbet:olay' && (o.veri as { tur?: string; mesgul?: boolean }).tur === 'hata'), 'meşgul hatası yok');
  } finally { gecit.bekle = null; birak(); }
  await kullaniciTuru;
  Z.isDurdur(r.is.id, 'kullanici');
});

test('zamanlayıcıyla: art arda 3 yankı → görev "hata", tek sakin cümle; özet/bildirim/ana sohbet satırı yok', async () => {
  const r = Z.isBaslat({ baslik: 'Üç yankı', amac: AMAC, plan: p.plan });
  assert.ok('is' in r);
  const ana = anaSohbet();
  const anaOnce = mesajlar(ana).length, bildirimOnce = testBildirimKaydi().length;
  gecit.kip = 'yanki';
  olaylar.length = 0;
  try {
    for (let i = 0; i < 3; i++) assert.ok(await ilerle());
  } finally { gecit.kip = 'sira'; }
  const k = isGetir(r.is.id)!;
  assert.equal(k.durum, 'hata');
  assert.equal(k.durmaNedeni, 'hata');
  assert.equal(k.adim, 0);
  assert.equal(k.sonOzet, null);
  assert.equal(mesajlar(ana).length, anaOnce);
  assert.equal(testBildirimKaydi().length, bildirimOnce);
  const notlar = gorunenMesajlar(k.sohbetId).filter((m) => m.rol === 'not');
  assert.equal(notlar.length, 1, JSON.stringify(notlar));
  assert.ok(!JSON.stringify(gorunenMesajlar(k.sohbetId)).includes(iz(ADIM_TALIMATI)));
  assert.deepEqual(tasiyan(ADIM_TALIMATI), []);
  assert.equal(await ilerle(), false, 'hata sonrası zamanlayıcı yok');
});
