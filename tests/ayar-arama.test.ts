// Ayarlar araması (Görev 10): Türkçe harf katlama, kelime başı / kök eşleşmesi, VE mantığı, mod süzgeci, vurgu aralıkları ve
// çapa çözümü (eski '#motorlar' gibi bağlantılar yeni yapıda kategori + akordeon açar). Saf modül: src/shared/ayar-arama.ts.
// Son bölüm gerçek ayar dizinini (src/renderer/ayarlar/dizin.ts) sınar: "mikrofon" → Ses ve ada / "Mikrofonu tamamen kapat", “Hey Fuber”.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { katla, ayarAra, dizinKur, eslesmeAraliklari, cipaCoz, gorunurMu, aramaYeterli, modaGore, type KategoriTanimi } from '../src/shared/ayar-arama.ts';
import { KATEGORILER, ESKI_CIPALAR } from '../src/renderer/ayarlar/dizin.ts';
import { IS_YASAK } from '../src/shared/is-dili.ts';

const ORNEK: KategoriTanimi[] = [
  { id: 'genel', ad: 'Genel', aciklama: 'Kimlik, mod', gruplar: [
    { id: 'kimlik', baslik: 'Kimlik', ayarlar: [{ id: 'ad', ad: 'Adın', aciklama: 'Fuber sana bu adla seslenir.' }] },
    { id: 'mod', baslik: 'Kullanım biçimi', ayarlar: [{ id: 'mod', ad: 'Kullanım biçimi', aciklama: 'İş ya da Geliştirici.', anahtar: ['iş modu', 'geliştirici modu'] }] },
  ] },
  { id: 'ses', ad: 'Ses ve ada', aciklama: 'Hey Fuber', gruplar: [
    { id: 'uyandirma', baslik: 'Uyandırma ve kısayol', ayarlar: [
      { id: 'hey-fuber', ad: '“Hey Fuber”', aciklama: 'Cihazda, çevrimdışı dinler.', anahtar: ['mikrofon', 'uyandırma'] },
      { id: 'kisayol', ad: 'Asistan kısayolu', aciklama: 'Her yerden asistanı açar ve dinlemeye başlar.' },
    ] },
    { id: 'saglayici', baslik: 'Sağlayıcı', gelistirici: true, ayarlar: [{ id: 'ses-anahtari', ad: 'Ses anahtarı', aciklama: 'API anahtarı.' }] },
  ] },
  { id: 'yapay-zeka', ad: 'Yapay zekâ', aciklama: 'Modeller', gelistirici: true, gruplar: [
    { id: 'modeller', baslik: 'Modeller', ayarlar: [{ id: 'ana-model', ad: 'Ana model', aciklama: 'Sohbet ve planlama.' }] },
  ] },
  { id: 'proaktif', ad: 'Kendiliğinden yazma', aciklama: 'Özetler', gruplar: [
    { id: 'ozetler', baslik: 'Özetler', ayarlar: [
      { id: 'sabah-ozeti', ad: 'Sabah özeti', aciklama: 'Günün planı, hatırlatıcılar, gelen kutusu.' },
      { id: 'aksam-ozeti', ad: 'Akşam kapanışı', aciklama: 'Günün kapanışı ve yarına hazırlık.' },
      { id: 'teknik', ad: 'Özet modeli', aciklama: 'Gizli ayar.', aciklamaIs: 'Sade açıklama.', gelistirici: true },
      { id: 'iki-yuzlu', ad: 'Hatırlatma dili', aciklama: 'Teknik açıklama.', aciklamaIs: 'Sade açıklama.' },
    ] },
  ] },
];
const ids = (l: { kayit: { id: string } }[]) => l.map((s) => s.kayit.id);

test('katla: Türkçe harfler ve büyük harf katlanır, uzunluk korunur (vurgu aralıkları için)', () => {
  assert.equal(katla('Görünüm'), 'gorunum');
  assert.equal(katla('İŞ MODU'), 'is modu');
  assert.equal(katla('IŞIK'), 'isik');
  assert.equal(katla('Çağrı Şükrü'), 'cagri sukru');
  const ham = '“Hey Fuber”';
  assert.equal(katla(ham), ' hey fuber ');
  assert.equal(katla(ham).length, ham.length);
  assert.equal(katla('Ctrl+Shift+Space'), 'ctrl shift space');
});

test('dizinKur: İş modunda geliştirici kategorisi, grubu ve ayarı yok; açıklama İş moduna göre', () => {
  const is = dizinKur(ORNEK, 'is');
  const gel = dizinKur(ORNEK, 'gelistirici');
  assert.ok(!is.some((k) => k.kategori === 'yapay-zeka' || k.id === 'ses-anahtari' || k.id === 'teknik'));
  assert.ok(gel.some((k) => k.id === 'ana-model') && gel.some((k) => k.id === 'ses-anahtari') && gel.some((k) => k.id === 'teknik'));
  assert.equal(is.find((k) => k.id === 'iki-yuzlu')?.aciklama, 'Sade açıklama.');
  assert.equal(gel.find((k) => k.id === 'iki-yuzlu')?.aciklama, 'Teknik açıklama.');
  const hey = is.find((k) => k.id === 'hey-fuber')!;
  assert.deepEqual([hey.kategori, hey.kategoriAd, hey.grup, hey.grupAd], ['ses', 'Ses ve ada', 'uyandirma', 'Uyandırma ve kısayol']);
  assert.equal(gorunurMu({ gelistirici: true }, 'is'), false);
  assert.equal(gorunurMu({ gelistirici: true }, 'gelistirici'), true);
  assert.equal(gorunurMu({}, 'is'), true);
});

test('ayarAra: anahtar sözcükle eşleşir, kategori adıyla döner', () => {
  const s = ayarAra(dizinKur(ORNEK, 'is'), 'mikrofon');
  assert.equal(s[0]?.kayit.id, 'hey-fuber');
  assert.equal(s[0]?.kayit.kategoriAd, 'Ses ve ada');
});

test('ayarAra: harf katlamalı ve büyük/küçük harften bağımsız', () => {
  const d = dizinKur(ORNEK, 'is');
  assert.deepEqual(ids(ayarAra(d, 'SABAH OZETI')), ['sabah-ozeti']);
  assert.ok(ids(ayarAra(d, 'cevrimdisi')).includes('hey-fuber'));
  assert.ok(ids(ayarAra(d, 'hey fuber')).includes('hey-fuber'));
});

test('ayarAra: bütün sözcükler eşleşmeli (VE); sıralama ad > açıklama', () => {
  const d = dizinKur(ORNEK, 'is');
  assert.deepEqual(ids(ayarAra(d, 'günün kapanışı')), ['aksam-ozeti']);
  // "kapanış" adda geçen ayar (Akşam kapanışı) açıklamada geçenden önce gelir.
  assert.equal(ids(ayarAra(d, 'kapanış'))[0], 'aksam-ozeti');
  assert.deepEqual(ids(ayarAra(d, 'sabah xyz')), []);
});

test('ayarAra: Türkçe ekli sorgu kökle eşleşir (mikrofonu, özetleri)', () => {
  const d = dizinKur(ORNEK, 'is');
  assert.equal(ids(ayarAra(d, 'mikrofonu'))[0], 'hey-fuber');
  assert.ok(ids(ayarAra(d, 'özetleri')).includes('sabah-ozeti'));
});

test('ayarAra: kelime içi eşleşme yalnız 3+ harfte; tek harf aramaz', () => {
  const d = dizinKur(ORNEK, 'is');
  assert.deepEqual(ids(ayarAra(d, 'a')), []);
  assert.deepEqual(ids(ayarAra(d, '  ')), []);
  // "uber" kelime içi (Fuber) → 4 harf, eşleşir.
  assert.ok(ids(ayarAra(d, 'uber')).includes('hey-fuber'));
  // "ub" kelime başı değil ve 3 harften kısa → eşleşmez.
  assert.ok(!ids(ayarAra(d, 'ub')).includes('hey-fuber'));
});

test('aramaYeterli: arama görünümü ayarAra ile aynı eşikte (en az 2 harf/rakam) açılır', () => {
  assert.equal(aramaYeterli(''), false);
  assert.equal(aramaYeterli('  '), false);
  assert.equal(aramaYeterli('a'), false);
  assert.equal(aramaYeterli(' ş '), false);
  assert.equal(aramaYeterli('“'), false);
  assert.equal(aramaYeterli('a b'), true);
  assert.equal(aramaYeterli('ti'), true);
  // Eşik altı sorgu hiç sonuç vermez; eşikte arama çalışır (görünüm ile arama tutarlı).
  const d = dizinKur(ORNEK, 'is');
  assert.deepEqual(ayarAra(d, 'a'), []);
  assert.ok(ayarAra(d, 'ad').length > 0);
});

test('dizinKur: İş modunda `anahtarIs` arama sözcüklerinin yerini alır (sağlayıcı adları İş aramasında yok)', () => {
  const k: KategoriTanimi[] = [{ id: 'ses', ad: 'Ses', aciklama: '', gruplar: [{ id: 'g', baslik: 'G', ayarlar: [{ id: 'x', ad: 'Sesli yanıt sağlayıcısı', anahtar: ['openai', 'windows'], anahtarIs: ['windows'] }] }] }];
  assert.deepEqual(dizinKur(k, 'is')[0].anahtar, ['windows']);
  assert.deepEqual(dizinKur(k, 'gelistirici')[0].anahtar, ['openai', 'windows']);
  assert.deepEqual(ayarAra(dizinKur(k, 'is'), 'openai'), []);
  assert.equal(ayarAra(dizinKur(k, 'gelistirici'), 'openai')[0]?.kayit.id, 'x');
});

test('ayarAra: İş modunda geliştirici ayarı bulunmaz, Geliştiricide bulunur', () => {
  assert.deepEqual(ids(ayarAra(dizinKur(ORNEK, 'is'), 'ana model')), []);
  assert.deepEqual(ids(ayarAra(dizinKur(ORNEK, 'gelistirici'), 'ana model')), ['ana-model']);
});

test('eslesmeAraliklari: özgün metindeki yerleri (katlanmış dizinle aynı) ve birleşik aralıklar', () => {
  assert.deepEqual(eslesmeAraliklari('“Hey Fuber”', 'fuber'), [[5, 10]]);
  assert.deepEqual(eslesmeAraliklari('Sabah özeti', 'ozet sabah'), [[0, 5], [6, 10]]);
  assert.deepEqual(eslesmeAraliklari('Mikrofonu kapat', 'mikrofonu'), [[0, 9]]);
  assert.deepEqual(eslesmeAraliklari('Mikrofon', 'mikrofonu'), [[0, 8]]);
  assert.deepEqual(eslesmeAraliklari('Görünüm', 'xyz'), []);
});

test('cipaCoz: eski çapalar moda göre, kategori, kategori/grup ve ayar kimliği', () => {
  const eski = { motorlar: { is: 'genel', gelistirici: 'yapay-zeka/modeller' }, kisa: 'ses/uyandirma' };
  assert.deepEqual(cipaCoz('motorlar', ORNEK, 'is', eski), { kategori: 'genel' });
  assert.deepEqual(cipaCoz('#motorlar', ORNEK, 'gelistirici', eski), { kategori: 'yapay-zeka', grup: 'modeller' });
  assert.deepEqual(cipaCoz('kisa', ORNEK, 'is', eski), { kategori: 'ses', grup: 'uyandirma' });
  assert.deepEqual(cipaCoz('ses', ORNEK, 'is'), { kategori: 'ses' });
  assert.deepEqual(cipaCoz('proaktif/ozetler', ORNEK, 'is'), { kategori: 'proaktif', grup: 'ozetler' });
  assert.deepEqual(cipaCoz('hey-fuber', ORNEK, 'is'), { kategori: 'ses', grup: 'uyandirma', ayar: 'hey-fuber' });
  assert.deepEqual(cipaCoz('ses/saglayici', ORNEK, 'is'), { kategori: 'ses' });
  assert.equal(cipaCoz('yapay-zeka', ORNEK, 'is'), null);
  assert.equal(cipaCoz('teknik', ORNEK, 'is'), null);
  assert.deepEqual(cipaCoz('teknik', ORNEK, 'gelistirici'), { kategori: 'proaktif', grup: 'ozetler', ayar: 'teknik' });
  assert.equal(cipaCoz('raporlar', ORNEK, 'is'), null); // başka sayfanın çapası (Hafıza → Raporlar): dokunulmaz
  assert.equal(cipaCoz('', ORNEK, 'is'), null);
});

// ── Gerçek dizin ──
test('gerçek dizin: kimlikler tekil, her kategori iki modda en az bir grup gösterir (5 Kas: sağlayıcı kategorisi Business\'ta tek satır)', () => {
  const hepsi = KATEGORILER.flatMap((k) => k.gruplar.flatMap((g) => g.ayarlar.map((a) => a.id)));
  assert.equal(new Set(hepsi).size, hepsi.length, `tekrarlanan kimlik: ${hepsi.filter((x, i) => hepsi.indexOf(x) !== i)}`);
  const kategoriler = KATEGORILER.map((k) => k.id);
  assert.equal(new Set(kategoriler).size, kategoriler.length);
  for (const k of KATEGORILER) {
    for (const g of k.gruplar) assert.ok(g.ayarlar.length > 0, `${k.id}/${g.id} boş`);
    assert.ok(k.gruplar.some((g) => !g.gelistirici), `${k.id}: İş modunda hiç grup yok`);
    assert.ok(!k.gruplar[0].gelistirici, `${k.id}: ilk grup (açık gelen) geliştirici olmamalı`);
  }
  // Görev 24: "Pano" (kokpit doldurucuları: şehir, hava, haberler, gündem, döviz) Görünüm'ün ardından.
  // 0.13 T15: "Yapay zekâ" kategorisi (motor anahtarları, model kartları) kalktı.
  // 0.14 (ürün kararı): "Yapay zekâ sağlayıcısı" ('motor') — YALNIZ Developer (Fuber ya da kullanıcının Claude anahtarı).
  assert.deepEqual(kategoriler, ['motor', 'genel', 'gorunum', 'pano', 'ses', 'gizlilik', 'proaktif', 'dusunme', 'yetkiler', 'kullanim', 'veri']);
  // 5 Kas (Business kullanıcıları da kendi API anahtarını kullanabilir): kategori iki modda; Business'ta yalnız "Kendi Claude anahtarım".
  const motor = KATEGORILER.find((k) => k.id === 'motor')!;
  assert.notEqual(motor.gelistirici, true);
  assert.deepEqual(dizinKur(KATEGORILER, 'is').filter((x) => x.kategori === 'motor').map((x) => x.id), ['claude-anahtar']);
  assert.deepEqual(KATEGORILER.filter((k) => k.isDiliIstisna).map((k) => k.id), ['motor'], 'İş dili istisnası yalnız bu kategoride');
  assert.ok(!KATEGORILER.some((k) => (k.id as string) === 'yapay-zeka'));
});

// Görev 11 "Mikrofonu tamamen kapat"ı ekledi (Ses ve ada → Uyandırma): adında "mikrofon" geçtiği için artık ilk sırada — doğru
// sonuç (aranan şey çoğunlukla odur). “Hey Fuber” (anahtar sözcükle) hemen ardından, aynı kategori ve grupta.
test('gerçek dizin: "mikrofon" → Ses ve ada / "Mikrofonu tamamen kapat" ilk, “Hey Fuber” ardından (iki modda)', () => {
  for (const mod of ['is', 'gelistirici'] as const) {
    const s = ayarAra(dizinKur(KATEGORILER, mod), 'mikrofon');
    assert.deepEqual(ids(s).slice(0, 2), ['mikrofon-kapali', 'hey-fuber'], `${mod}: ${ids(s)}`);
    for (const x of s.slice(0, 2)) assert.deepEqual([x.kayit.kategoriAd, x.kayit.grup], ['Ses ve ada', 'uyandirma']);
  }
});

test('gerçek dizin: eski çapalar (motorlar, ses, yetkiler, gorunum, dusunme, yerel) bozulmaz', () => {
  assert.deepEqual(cipaCoz('motorlar', KATEGORILER, 'gelistirici', ESKI_CIPALAR), { kategori: 'motor' }, 'eski #motorlar çapası iki modda da yapay zekâ sağlayıcısına gider');
  assert.deepEqual(cipaCoz('motorlar', KATEGORILER, 'is', ESKI_CIPALAR), { kategori: 'motor' });
  for (const [c, k] of [['ses', 'ses'], ['yetkiler', 'yetkiler'], ['gorunum', 'gorunum'], ['dusunme', 'dusunme']] as const) {
    for (const mod of ['is', 'gelistirici'] as const) assert.equal(cipaCoz(c, KATEGORILER, mod, ESKI_CIPALAR)?.kategori, k, `${c} · ${mod}`);
  }
  assert.deepEqual(cipaCoz('yerel', KATEGORILER, 'is', ESKI_CIPALAR), { kategori: 'gizlilik', grup: 'yerel' });
});

test('gerçek dizin: İş modu metinlerinde (moda göre: …Is alanları) API, anahtar, model, token ve sağlayıcı adı yok (anti-hedef; Ruling O)', () => {
  const yasak = IS_YASAK;
  for (const k of KATEGORILER) {
    if (!gorunurMu(k, 'is') || k.isDiliIstisna) continue; // 5 Kas: yalnız 'motor' (Kendi Claude anahtarım)
    for (const metin of [k.ad, modaGore('is', k.aciklama, k.aciklamaIs), modaGore('is', k.giris, k.girisIs)]) assert.ok(!yasak.test(metin), `${k.id}: «${metin}»`);
    for (const g of k.gruplar) {
      if (!gorunurMu(g, 'is')) continue;
      for (const metin of [modaGore('is', g.baslik, g.baslikIs), modaGore('is', g.aciklama ?? '', g.aciklamaIs)]) assert.ok(!yasak.test(metin), `${k.id}/${g.id}: «${metin}»`);
    }
  }
  for (const x of dizinKur(KATEGORILER, 'is')) if (x.kategori !== 'motor') assert.ok(!yasak.test(`${x.ad} ${x.aciklama} ${x.grupAd}`), `${x.id}: «${x.ad} — ${x.aciklama}»`);
});

test('gerçek dizin: İş modu arama sözcüklerinde sağlayıcı/teknik ad yok (aramayla da sızmaz)', () => {
  const teknik = /openai|anthropic|openrouter|elevenlabs|azure|claude|gpt|llama|sqlite|dpapi|\bapi\b|token|model/i;
  for (const x of dizinKur(KATEGORILER, 'is')) if (x.kategori !== 'motor') for (const s of x.anahtar) assert.ok(!teknik.test(s), `${x.id}: «${s}»`);
  for (const q of ['openai', 'azure', 'elevenlabs', 'sqlite', 'llama']) assert.deepEqual(ayarAra(dizinKur(KATEGORILER, 'is'), q).map((s) => s.kayit.id), [], q);
});
