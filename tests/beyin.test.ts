// Beyin şeması: bölgeler, bağlar ve olayların bölgeye eşlenmesi.
import { UYANDIRMA_DUSTU_METNI } from '../src/shared/uyandirma-ayar.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOLGELER, BAGLAR, MOTORLAR, SAHNE, amactanBolge, aractanBolge, bagBul,
  zihinHali, durumOzeti, olayMetni, listeBirlestir, ZIHIN_ADI, bolgeKapaliNedeni, type BeyinOlayi, type KapaliGirdisi,
  bolgeMetni, gorunurBolgeler, gorunurBaglar, motorSeridi, seritIdsi, seritDurumu, motorAdi, bolgeNotu, isGuvenliMetin, IS_HATA_METNI,
} from '../src/shared/beyin.ts';
import { IS_YASAK, isDiliIhlali } from '../src/shared/is-dili.ts';
import { SENARYO, SENARYO_IS, senaryo } from '../src/renderer/bilesenler/beyinSenaryo.ts';

// ── İş modu (Ruling O / K6): motor şeridinde yalnız iki hap (yerel + bulut), metinlerde sağlayıcı/model adı yok ──
// 0.10 Görev 3: `anatomi` (beyindeki karşılık: "Motor korteks", "Beyin sapı") yalnız telefonun Beyin sekmesinde görünür (P8) — masaüstü
// Etkinlik onu göstermez; İş dili taraması ad, ne ve nasıl'a bakar.
test('İş: bölge metinlerinde (ad, ne, nasıl) sağlayıcı/model/teknik ad yok; Geliştirici\'de bugünkü ayrıntı', () => {
  for (const b of gorunurBolgeler('is')) {
    const m = bolgeMetni(b, 'is');
    const ihlal = isDiliIhlali(`${b.ad} · ${m.ne} · ${m.nasil}`);
    assert.equal(ihlal, null, `${b.id}: ${ihlal}`);
  }
  assert.match(bolgeMetni(BOLGELER.find((b) => b.id === 'ajan')!, 'is').nasil, /Fuber’in yapay zekâsıyla/);
});

// Görev 21 düzeltme turu 4 (K10 / Global Constraints): model adı yalnız Ayarlar → Yapay zekâ'da — Beyin'in Geliştirici metinlerinde ve motor
// şeridinde de yok (sağlayıcı adı Geliştirici'de kalabilir: Claude, OpenAI…).
const MODEL_ADI = /\bOpus\b|\bSonnet\b|\bHaiku\b|\bGPT-?\d|Bonsai|gpt-4o|claude-[a-z]+-\d|eleven_[a-z]|scribe_v\d|\bWhisper large/i;
test('K10: Beyin bölge metinlerinde (Geliştirici dahil) ve motor adlarında model adı yok', () => {
  for (const mod of ['is', 'gelistirici'] as const) {
    for (const b of BOLGELER) {
      const m = bolgeMetni(b, mod);
      assert.doesNotMatch(`${b.ad} · ${m.ne} · ${m.nasil}`, MODEL_ADI, `${mod}/${b.id}`);
    }
  }
  for (const m of MOTORLAR) assert.doesNotMatch(m.ad, MODEL_ADI, m.id);
  assert.equal(MOTORLAR.find((m) => m.id === 'yerel')?.ad, 'Yerel model');
});

// Düzeltme turu 5 (N2): İş'te görünen her Beyin metni (bölge adı, anatomi, ne, nasıl — İş karşılığıyla; Kod bölgesi dahil; İş motor
// şeridi; bağ etiketleri) ne model adı ne de motor adı taşır — düz "Whisper", Vosk, ElevenLabs, Piper, Scribe, Bonsai da yok.
// (Yazıcı'nın "Bu bilgisayardaki Whisper…" metni yalnız Geliştirici'de: İş'te BOLGE_IS karşılığı gösterilir.)
const MOTOR_ADI = new RegExp(`${MODEL_ADI.source}|Whisper|\\bVosk|ElevenLabs|Eleven Labs|\\bPiper\\b|\\bScribe\\b|Bonsai|Kokoro|Coqui`, 'i');
test('K10 (İş): İş\'te görünen Beyin metinlerinde model ya da motor adı yok (düz "Whisper" dahil)', () => {
  for (const b of gorunurBolgeler('is')) {
    const m = bolgeMetni(b, 'is');
    assert.doesNotMatch(`${b.ad} · ${b.anatomi} · ${m.ne} · ${m.nasil}`, MOTOR_ADI, b.id);
  }
  for (const s of motorSeridi('is')) assert.doesNotMatch(s.ad, MOTOR_ADI, s.id);
  for (const [, , ne] of gorunurBaglar('is')) assert.doesNotMatch(ne, MOTOR_ADI, ne);
  // Geliştirici metni büyük harfle başlar (N2).
  assert.match(bolgeMetni(BOLGELER.find((b) => b.id === 'yazici')!, 'gelistirici').nasil, /^Bu bilgisayardaki Whisper/);
  assert.doesNotMatch(bolgeMetni(BOLGELER.find((b) => b.id === 'yazici')!, 'is').nasil, MOTOR_ADI);
});

// I4 (son inceleme): Claude Code yalnız Geliştirici (K17/K18 "İş modunda hiçbiri görünmez") — eskiden claude.exe kurulu ve yönetici
// açıkken İş'te de "Kod" bölgesi çıkıyordu. Artık İş'te hiçbir durumda yok; Geliştirici metni uygulama içi yöneticiyi anlatır (terminal değil).
test('I4: İş\'te Kod bölgesi ve bağları HİÇ yok (claude.exe kurulu olsa da); Geliştirici\'de hepsi', () => {
  assert.ok(!gorunurBolgeler('is').some((b) => b.id === 'kod'));
  assert.equal(gorunurBolgeler('is').length, BOLGELER.length - 1);
  assert.ok(!gorunurBaglar('is').some(([a, b]) => a === 'kod' || b === 'kod'));
  // Eski imza (kodAcik) artık yok: ikinci argüman Kod'u İş'e geri getiremez.
  assert.equal((gorunurBolgeler as (m: 'is', k?: boolean) => unknown[])('is', true).length, BOLGELER.length - 1);
  assert.equal((gorunurBaglar as (m: 'is', k?: boolean) => unknown[])('is', true).length, BAGLAR.length - BAGLAR.filter(([a, b]) => a === 'kod' || b === 'kod').length);
  assert.equal(gorunurBolgeler('gelistirici').length, BOLGELER.length);
  assert.equal(gorunurBaglar('gelistirici').length, BAGLAR.length);
  // Kapalı nedeni (Geliştirici'de görünür) bugünkü yerleri söyler.
  const tam: KapaliGirdisi = { mod: 'gelistirici', mikrofonKapali: false, uyandirma: true, seslendirme: true, gunKaydi: true, eslikciKapali: false, bilgisayar: true, tarayici: true, iletisimVar: true, motor: 'hazir', claudeCodeEtkin: true, claudeBulundu: true };
  assert.equal(bolgeKapaliNedeni('kod', tam), undefined);
  assert.match(bolgeKapaliNedeni('kod', { ...tam, claudeCodeEtkin: false })!, /Claude Code sayfası → Ayarlar/);
});

test('I4: Kod bölgesinin Geliştirici metni uygulama içi Claude Code yöneticisini anlatır — terminal açtığını söylemez', () => {
  const kod = bolgeMetni(BOLGELER.find((b) => b.id === 'kod')!, 'gelistirici');
  assert.doesNotMatch(`${kod.ne} ${kod.nasil}`, /terminali|--resume|tam yetkili açar/);
  assert.match(kod.nasil, /Claude Code sayfasında/);
  assert.match(kod.nasil, /Terminal gerekmez/);
  assert.match(kod.nasil, /izni sen verirsin/);
});

// 0.10 Görev 1 (P2 sözlüğü): İş şeridinin adları "Bu bilgisayardaki yapay zekâ" + "Fuber’in yapay zekâsı" (telefon da bunu gösterir, P8).
test('İş: motor şeridi "Bu bilgisayardaki yapay zekâ" + "Fuber’in yapay zekâsı" (bulut sağlayıcıları tek hapta); Geliştirici\'de her motor', () => {
  assert.deepEqual(motorSeridi('is').map((s) => [s.id, s.ad]), [['yerel', 'Bu bilgisayardaki yapay zekâ'], ['bulut', 'Fuber’in yapay zekâsı']]);
  assert.deepEqual(motorSeridi('gelistirici').map((s) => s.id), MOTORLAR.map((m) => m.id));
  for (const m of ['anthropic', 'openai', 'openrouter'] as const) assert.equal(seritIdsi(m, 'is'), 'bulut');
  assert.equal(seritIdsi('yerel', 'is'), 'yerel');
  assert.equal(seritIdsi('openai', 'gelistirici'), 'openai');
  assert.equal(motorAdi('openrouter', 'is'), 'Fuber’in yapay zekâsı');
  assert.equal(motorAdi('yerel', 'is'), 'Bu bilgisayardaki yapay zekâ');
  assert.equal(motorAdi('anthropic'), 'Claude');
  const bulut = seritDurumu(motorSeridi('is')[1], [
    { id: 'anthropic', bagli: true, aktif: 1, bugun: 38, sonModel: 'claude-opus-5-5' },
    { id: 'openai', bagli: false, aktif: 0, bugun: 4, sonModel: 'gpt-4o-mini' },
    { id: 'yerel', bagli: true, aktif: 2, bugun: 9 },
  ]);
  assert.deepEqual(bulut, { id: 'bulut', bagli: true, aktif: 1, bugun: 42 }, 'toplam; birden çok üyede model kimliği yok');
  for (const s of motorSeridi('is')) assert.doesNotMatch(s.ad, IS_YASAK);
});

test('İş: olay satırında model kimliği ve sağlayıcı adı yok; Kod olayları İş\'te hiç listelenmez', () => {
  const istek: BeyinOlayi = { id: 1, zaman: '', tur: 'motor', faz: 'istek', bolge: 'ajan', motor: 'anthropic', model: 'claude-opus-5-5', metin: 'sohbet' };
  assert.deepEqual(olayMetni(istek, 'is'), { ust: 'Fuber’in yapay zekâsı çalışıyor', alt: 'Düşünme' });
  // Görev 21 (tek görünen kimlik): Geliştirici'de de model kimliği Beyin'de yazılmaz.
  assert.deepEqual(olayMetni(istek), { ust: 'Claude çalışıyor', alt: 'Düşünme' });
  assert.deepEqual(olayMetni({ ...istek, faz: 'yanit', sure: 1840, motor: 'openrouter' }, 'is'), { ust: 'Fuber’in yapay zekâsı yanıtladı', alt: 'Düşünme · 1,8 sn' });
  // I4: Kod'a giden ve Kod'dan gelen olaylar İş'te listelenmez (eski "kodAcik" argümanı da geri getiremez).
  const kodaIs: BeyinOlayi = { id: 2, zaman: '', tur: 'sinyal', bolge: 'ajan', hedef: 'kod', metin: 'kod işi verdi', ayrinti: 'Claude Code' };
  assert.equal(olayMetni(kodaIs, 'is'), null);
  assert.equal(olayMetni({ id: 3, zaman: '', tur: 'basla', bolge: 'kod', metin: 'oturumu açtı' }, 'is'), null);
  assert.equal(olayMetni({ id: 3, zaman: '', tur: 'bitti', bolge: 'kod', hata: true, metin: 'bir sorun oldu' }, 'is'), null);
  assert.equal((olayMetni as (o: BeyinOlayi, m: 'is', k?: boolean) => unknown)(kodaIs, 'is', true), null);
  // Geliştirici'de olduğu gibi + ayrıntı.
  assert.deepEqual(olayMetni(kodaIs, 'gelistirici'), { ust: 'Kod işi verdi', alt: 'Kod · Claude Code' });
});

test('İş: sinyal satırının yedeği bağın adı (BAGLAR), yoksa hedef bölgenin metni — kaynak bölgenin tanımı değil', () => {
  const s = (o: Partial<BeyinOlayi>): BeyinOlayi => ({ id: 1, zaman: '', tur: 'sinyal', bolge: 'goz', hedef: 'ajan', ...o } as BeyinOlayi);
  // Ekran ve web → Düşünme: aracın özeti yasak sözcüklüyse bağın adı ("ekran/web", baş harfi büyük), özelliğin "ne yapar"ı değil.
  assert.deepEqual(olayMetni(s({ metin: 'OpenAI vision ile okundu' }), 'is'), { ust: 'Ekran/web', alt: 'Ekran ve web' });
  assert.equal(bagBul('goz', 'ajan')!.ne, 'ekran/web');
  assert.notEqual(olayMetni(s({ metin: 'OpenAI vision ile okundu' }), 'is')?.ust, bolgeMetni(BOLGELER.find((b) => b.id === 'goz')!, 'is').ne);
  // Sade metin cümle olur (baş harfi büyük).
  assert.deepEqual(olayMetni(s({ metin: 'sayfa okundu' }), 'is'), { ust: 'Sayfa okundu', alt: 'Ekran ve web' });
  // Araç çağrısında özellik, ajan olmayan uçtur (Düşünme → Hatırlatıcılar: alt "Hatırlatıcılar").
  assert.deepEqual(olayMetni(s({ bolge: 'ajan', hedef: 'saat', metin: 'Hatırlatıcı kuruyor: Toplantı' }), 'is'), { ust: 'Hatırlatıcı kuruyor: Toplantı', alt: 'Hatırlatıcılar' });
});

test('İş (düzeltme turu 2, kritik): araç hatası "page.goto: net::ERR_NAME_NOT_RESOLVED…" — yasak sözcük yok ama İş\'te hiç görünmez', () => {
  const ag = 'page.goto: net::ERR_NAME_NOT_RESOLVED at https://ornek.invalid/giris';
  assert.equal(isDiliIhlali(ag), null, 'yasak sözcük süzgeci bunu yakalamaz: kural içeriğe bakmaz');
  // Eski kaynak (dongu.ts: beyinBitir(true, m.slice(0, 80))): bitti+hata olayı → İş'te sabit metin; Geliştirici'de ham.
  const eski: BeyinOlayi = { id: 1, zaman: '', tur: 'bitti', bolge: 'goz', hata: true, metin: ag.slice(0, 80) };
  assert.deepEqual(olayMetni(eski, 'is'), { ust: `Ekran ve web çalışırken ${IS_HATA_METNI}` }, 'ham hata hiç görünmez');
  assert.match(olayMetni(eski, 'gelistirici')!.alt!, /ERR_NAME_NOT_RESOLVED/);
  assert.deepEqual(olayMetni({ ...eski, metin: undefined }, 'is'), { ust: `Ekran ve web çalışırken ${IS_HATA_METNI}` }, 'metinsiz hata da');
  // Yeni kaynak: sade metin + ham hata ayrıntıda (yalnız Geliştirici).
  const yeni: BeyinOlayi = { ...eski, metin: 'bir sorun oldu', ayrinti: ag.slice(0, 120) };
  assert.deepEqual(olayMetni(yeni, 'is'), { ust: `Ekran ve web çalışırken ${IS_HATA_METNI}` });
  assert.equal(olayMetni(yeni, 'gelistirici')!.alt, `bir sorun oldu · ${ag.slice(0, 120)}`);
  // Bölge notu: hatadayken ve 60 sn sonra (hal "hazır") da — son not hatanın notuysa — "bir sorun oldu"; yeniden çalışırken eski hata yok.
  const goz = BOLGELER.find((b) => b.id === 'goz')!;
  assert.equal(bolgeNotu(goz, { not: ag.slice(0, 80), hal: 'hata' }, 'is'), IS_HATA_METNI);
  assert.equal(bolgeNotu(goz, { not: ag.slice(0, 80), hal: 'hazir', notHata: true }, 'is'), IS_HATA_METNI);
  assert.equal(bolgeNotu(goz, { not: ag.slice(0, 80), hal: 'calisiyor', notHata: true }, 'is'), undefined);
  assert.equal(bolgeNotu(goz, { hal: 'hata' }, 'is'), IS_HATA_METNI, 'notsuz hata');
  assert.equal(bolgeNotu(goz, { not: 'bir sorun oldu', ayrinti: ag.slice(0, 120), hal: 'hazir', notHata: true }, 'gelistirici'), `bir sorun oldu · ${ag.slice(0, 120)}`);
});

test('İş koruması (fix 1): canlı olay ve bölge notundaki GERÇEK eski metinler (Whisper/OpenAI/Vosk, "openai sesiyle", ham hata) İş\'te görünmez', () => {
  const ev = (o: Partial<BeyinOlayi>): BeyinOlayi => ({ id: 1, zaman: '', tur: 'basla', bolge: 'yazici', ...o } as BeyinOlayi);
  const yaziciNe = bolgeMetni(BOLGELER.find((b) => b.id === 'yazici')!, 'is').ne;
  const sesNe = bolgeMetni(BOLGELER.find((b) => b.id === 'ses')!, 'is').ne;
  for (const eski of ['Whisper yazıya döküyor', 'OpenAI yazıya döküyor', 'Vosk yazıya döküyor']) {
    assert.deepEqual(olayMetni(ev({ metin: eski }), 'is'), { ust: yaziciNe, alt: 'Konuşmayı yazıya çevirme' }, eski);
    assert.equal(olayMetni(ev({ metin: eski }), 'gelistirici')?.ust, eski, 'Geliştirici: olduğu gibi');
  }
  assert.deepEqual(olayMetni(ev({ bolge: 'ses', metin: 'openai sesiyle konuşuyor' }), 'is'), { ust: sesNe, alt: 'Ses' });
  const hamHata = '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}';
  assert.deepEqual(olayMetni(ev({ tur: 'bitti', bolge: 'not', hata: true, metin: hamHata }), 'is'), { ust: `Günün notları çalışırken ${IS_HATA_METNI}` });
  assert.equal(olayMetni(ev({ tur: 'bitti', bolge: 'not', hata: true, metin: hamHata }), 'gelistirici')?.alt, hamHata);
  // Yeni kaynak metni sade: İş'te olduğu gibi kalır (baş harfi büyük); teknik ayrıntı yalnız Geliştirici'de.
  assert.deepEqual(olayMetni(ev({ metin: 'yazıya döküyor', ayrinti: 'Whisper' }), 'is'), { ust: 'Yazıya döküyor', alt: 'Konuşmayı yazıya çevirme' });
  assert.deepEqual(olayMetni(ev({ metin: 'yazıya döküyor', ayrinti: 'Whisper' }), 'gelistirici'), { ust: 'Yazıya döküyor', alt: 'Konuşmayı yazıya çevirme · Whisper' });
  for (const [metin, mod] of [['Whisper yazıya döküyor', 'is'], ['openai sesiyle konuşuyor', 'is'], [hamHata, 'is']] as const) {
    const o = olayMetni(ev({ metin, tur: 'basla' }), mod);
    assert.equal(isDiliIhlali(`${o?.ust} ${o?.alt ?? ''}`), null, metin);
  }
  // Bölge notu (canlı kart, bölge kartının alıntısı): aynı koruma.
  const yazici = BOLGELER.find((b) => b.id === 'yazici')!;
  assert.equal(bolgeNotu(yazici, { not: 'OpenAI yazıya döküyor', hal: 'calisiyor' }, 'is'), yaziciNe);
  assert.equal(bolgeNotu(yazici, { not: 'Error: 429 Too Many Requests (openai)', hal: 'hata' }, 'is'), IS_HATA_METNI);
  assert.equal(bolgeNotu(yazici, { not: 'yazıya döktü', ayrinti: 'Vosk', hal: 'hazir' }, 'is'), 'yazıya döktü');
  assert.equal(bolgeNotu(yazici, { not: 'yazıya döktü', ayrinti: 'Vosk', hal: 'hazir' }, 'gelistirici'), 'yazıya döktü · Vosk');
  assert.equal(isGuvenliMetin('Kahve makinesi servisi', 'is', 'x'), 'Kahve makinesi servisi', 'sade metin dokunulmaz');
});

test('İş: "Canlandır" anlatımı sağlayıcı/model/token adı olmadan (aynı adımlar); Geliştirici anlatımı değişmedi', () => {
  assert.equal(SENARYO_IS.length, SENARYO.length);
  SENARYO_IS.forEach((a, i) => {
    assert.deepEqual(a.olaylar, SENARYO[i].olaylar, `adım ${i} olayları aynı`);
    assert.equal(isDiliIhlali(a.yazi ?? ''), null, `adım ${i}: ${a.yazi}`);
  });
  assert.equal(senaryo('is'), SENARYO_IS);
  assert.equal(senaryo('gelistirici'), SENARYO);
  assert.ok(SENARYO.some((a) => /Whisper/.test(a.yazi ?? '')), 'Geliştirici ayrıntısı korunur');
});

test('bölgeler tekil, sahnede ve birbirinden okunur uzaklıkta', () => {
  const idler = BOLGELER.map((b) => b.id);
  assert.equal(new Set(idler).size, idler.length);
  for (const b of BOLGELER) {
    assert.ok(b.x > 40 && b.x < SAHNE.en - 40 && b.y > 40 && b.y < SAHNE.boy - 100, `${b.id} sahne dışında`);
    assert.ok(b.ne.length > 10 && b.nasil.length > 40 && b.anatomi.length > 4, `${b.id} açıklaması eksik`);
  }
  for (let i = 0; i < BOLGELER.length; i++) {
    for (let j = i + 1; j < BOLGELER.length; j++) {
      const a = BOLGELER[i], b = BOLGELER[j];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 70, `${a.id} ile ${b.id} üst üste`);
    }
  }
  assert.equal(new Set(MOTORLAR.map((m) => m.id)).size, 4);
  assert.ok(MOTORLAR.some((m) => m.id === 'yerel'));
});

test('her bağ var olan iki bölgeyi birleştirir; her bölge en az bir bağlıdır', () => {
  const idler = new Set(BOLGELER.map((b) => b.id));
  for (const [a, b] of BAGLAR) { assert.ok(idler.has(a) && idler.has(b) && a !== b, `${a}-${b}`); }
  for (const id of idler) assert.ok(BAGLAR.some(([a, b]) => a === id || b === id), `${id} yalnız`);
  assert.deepEqual(bagBul('yazici', 'kulak'), { ters: true, ne: 'konuşma bölümü' });
  assert.equal(bagBul('kulak', 'yazici')?.ters, false);
  assert.equal(bagBul('el', 'saat'), null);
});

test('model çağrısının amacı doğru bölgeye düşer', () => {
  assert.equal(amactanBolge('sohbet'), 'ajan');
  assert.equal(amactanBolge('proaktif'), 'ajan');
  assert.equal(amactanBolge('gunkaydi:not'), 'not');
  assert.equal(amactanBolge('gunkaydi:eslik'), 'eslikci');
  assert.equal(amactanBolge('gunkaydi:rapor-haftalik'), 'rapor');
  assert.equal(amactanBolge('kokpit'), 'kokpit');
  assert.equal(amactanBolge('eposta-onem'), 'iletisim');
  assert.equal(amactanBolge('whatsapp-onem'), 'iletisim');
  assert.equal(amactanBolge('hafiza-yazici'), 'hafiza');
  assert.equal(amactanBolge('iceaktar-ozet'), 'hafiza');
  assert.equal(amactanBolge('baslik'), 'hafiza');
});

test('araç doğru bölgeye düşer', () => {
  assert.equal(aractanBolge('bilgisayar', 'bilgisayar_ekran'), 'goz');
  assert.equal(aractanBolge('bilgisayar', 'bilgisayar_tikla'), 'el');
  assert.equal(aractanBolge('bilgisayar', 'bilgisayar_yaz'), 'el');
  assert.equal(aractanBolge('tarayici', 'tarayici_oku'), 'goz');
  assert.equal(aractanBolge('tarayici', 'tarayici_tikla'), 'el');
  assert.equal(aractanBolge('hafiza', 'hafiza_kaydet'), 'hafiza');
  assert.equal(aractanBolge('hafiza', 'gun_kaydi_ara'), 'not');
  assert.equal(aractanBolge('hafiza', 'meseleler'), 'not');
  assert.equal(aractanBolge('plan', 'hatirlatici_kur'), 'saat');
  assert.equal(aractanBolge('eposta', 'eposta_gonder'), 'iletisim');
  assert.equal(aractanBolge('mcp', 'mcp_kullan'), 'iletisim');
  assert.equal(aractanBolge('claudecode', 'claude_code_gorev'), 'kod');
});

// ── Büyük canlı beyin (Beyin sayfasının üstü): genel hâl, tek satırlık özet, son olaylar ──
test('beynin genel hâli: ana süreç bildirirse o; yoksa çalışan bölgelerden türer', () => {
  assert.equal(zihinHali('dusunuyor', []), 'dusunuyor');
  assert.equal(zihinHali('dinliyor', ['ajan']), 'dinliyor', 'bildirilen hâl önceliklidir');
  assert.equal(zihinHali('bos', ['ajan', 'hafiza']), 'dusunuyor');
  assert.equal(zihinHali(undefined, ['ses']), 'konusuyor');
  assert.equal(zihinHali('bos', ['uyanma']), 'dinliyor');
  assert.equal(zihinHali('bos', ['not', 'rapor']), 'bos', 'arka plan işi beyni "düşünüyor" yapmaz');
  assert.equal(zihinHali('bos', []), 'bos');
  assert.equal(zihinHali('anlamsiz', []), 'bos', 'bilinmeyen hâl yok sayılır');
  assert.deepEqual(Object.keys(ZIHIN_ADI).sort(), ['bos', 'dinliyor', 'dusunuyor', 'konusuyor']);
});

test('liste birleştirme Türkçe: "A, B ve C"', () => {
  assert.equal(listeBirlestir([]), '');
  assert.equal(listeBirlestir(['Düşünme']), 'Düşünme');
  assert.equal(listeBirlestir(['Düşünme', 'Hafıza']), 'Düşünme ve Hafıza');
  assert.equal(listeBirlestir(['Düşünme', 'Hafıza', 'Ekran ve web']), 'Düşünme, Hafıza ve Ekran ve web');
});

test('durum özeti: başlık beynin hâli, alt satır neyin çalıştığı', () => {
  assert.deepEqual(durumOzeti('dusunuyor', ['Düşünme', 'Hafıza']), { baslik: 'Düşünüyor', alt: 'Düşünme ve Hafıza çalışıyor' });
  assert.deepEqual(durumOzeti('dinliyor', []), { baslik: 'Dinliyor', alt: 'Fuber seni dinliyor.' });
  assert.deepEqual(durumOzeti('konusuyor', ['Ses']), { baslik: 'Konuşuyor', alt: 'Ses çalışıyor' });
  assert.deepEqual(durumOzeti('bos', ['Günün notları']), { baslik: 'Arka planda çalışıyor', alt: 'Günün notları çalışıyor' });
  assert.deepEqual(durumOzeti('bos', []), { baslik: 'Hazır', alt: 'Sessiz; Fuber hazır bekliyor.' });
  assert.deepEqual(durumOzeti('bos', [], true), { baslik: 'Hazır', alt: 'Mikrofon dinliyor; Fuber hazır bekliyor.' });
});

test('olay metni: yalnız anlamlı olaylar listelenir (başla/bitti gürültüsü süzülür); satırlar düz cümle, ok işareti yok', () => {
  const o = (x: Partial<BeyinOlayi>): BeyinOlayi => ({ id: 1, zaman: '2026-10-24T10:00:00.000Z', tur: 'basla', bolge: 'ajan', ...x });
  assert.deepEqual(olayMetni(o({ tur: 'sinyal', bolge: 'kulak', hedef: 'yazici', metin: 'konuşma bölümü' })), { ust: 'Konuşma bölümü', alt: 'Dinleme' });
  assert.deepEqual(olayMetni(o({ tur: 'motor', faz: 'istek', bolge: 'ajan', motor: 'anthropic', model: 'claude-opus-5-5' })), { ust: 'Claude çalışıyor', alt: 'Düşünme' });
  assert.deepEqual(olayMetni(o({ tur: 'motor', faz: 'yanit', bolge: 'ajan', motor: 'anthropic', sure: 1840 })), { ust: 'Claude yanıtladı', alt: 'Düşünme · 1,8 sn' });
  assert.deepEqual(olayMetni(o({ tur: 'motor', faz: 'yanit', bolge: 'not', motor: 'openai', sure: 420, hata: true })), { ust: 'OpenAI yanıt veremedi', alt: 'Günün notları · 420 ms' });
  assert.deepEqual(olayMetni(o({ tur: 'basla', bolge: 'yazici', metin: 'Konuşma çevriliyor' })), { ust: 'Konuşma çevriliyor', alt: 'Konuşmayı yazıya çevirme' });
  assert.deepEqual(olayMetni(o({ tur: 'bitti', bolge: 'iletisim', hata: true, metin: 'IMAP reddedildi' })), { ust: 'E-posta ve mesajlar çalışırken bir sorun oldu', alt: 'IMAP reddedildi' });
  for (const ok of ['Konuşma bölümü', 'Claude çalışıyor']) assert.doesNotMatch(ok, /→/);
  assert.equal(olayMetni(o({ tur: 'basla', bolge: 'ajan' })), null);
  assert.equal(olayMetni(o({ tur: 'bitti', bolge: 'ajan' })), null);
});

// ── Kapalı bölgenin nedeni (Görev 19 denetimi: eski "Ayarlar → Ses / Motorlar / Claude Code" yolları) ──
const ACIK: KapaliGirdisi = {
  mod: 'gelistirici', mikrofonKapali: false, uyandirma: true, seslendirme: true, gunKaydi: true, eslikciKapali: false, bilgisayar: true,
  tarayici: true, iletisimVar: true, motor: 'hazir', claudeCodeEtkin: true, claudeBulundu: true,
};

test('kapalı nedeni: her şey açıkken hiçbir bölge kapalı değil', () => {
  for (const b of BOLGELER) assert.equal(bolgeKapaliNedeni(b.id, ACIK), undefined, b.id);
});

test('kapalı nedeni: bugünkü Ayarlar adları; motor yolu moda göre', () => {
  const kapali = { ...ACIK, uyandirma: false, seslendirme: false, motor: 'bagli-degil', claudeCodeEtkin: false };
  assert.equal(bolgeKapaliNedeni('ses', kapali), 'Sesli yanıt kapalı (Ayarlar → Ses ve ada)');
  assert.equal(bolgeKapaliNedeni('uyanma', kapali), '"Hey Fuber" kapalı (Ayarlar → Ses ve ada)');
  assert.equal(bolgeKapaliNedeni('ajan', kapali), 'Hiçbir yapay zekâ motoru bağlı değil (Ayarlar → Hesap ve kullanım)');
  assert.equal(bolgeKapaliNedeni('ajan', { ...kapali, mod: 'is' }), 'Fuber’in yapay zekâsı bağlı değil (Ayarlar → Hesap ve kullanım)');
  assert.equal(bolgeKapaliNedeni('kod', kapali), 'Claude Code yöneticisi kapalı (Claude Code sayfası → Ayarlar)');
  assert.equal(bolgeKapaliNedeni('kod', { ...ACIK, claudeBulundu: false }), 'Claude Code (claude.exe) bu bilgisayarda bulunamadı');
  for (const b of BOLGELER) {
    const n = bolgeKapaliNedeni(b.id, { ...kapali, mod: 'is' }) ?? '';
    assert.doesNotMatch(n, /Ayarlar → (Ses\)|Motorlar|Claude Code)/, `${b.id}: ${n}`);
  }
});

// R28c (G2 düzeltme turu 1): Akıl bölgesinin kuralı motor durumunun TEK kaynağından (shared/motor-durumu.ts; ana süreç yanıt verilebilir
// hâli geçirir): hesap hâlleri ve Gizli mod kendi nedeniyle; yalnız bu bilgisayardaki yapay zekâ yanıtlıyorsa bölge açık.
test('kapalı nedeni (Akıl): motor durumundan — yerel yanıtlıyorsa açık; hesap hâlleri ve Gizli mod kendi nedeni', () => {
  assert.equal(bolgeKapaliNedeni('ajan', { ...ACIK, motor: 'yerel' }), undefined);
  // I2 (G3 sözlüğü): İş'te "motor" yok — "Fuber’in yapay zekâsı"; Geliştirici'de motor.
  assert.equal(bolgeKapaliNedeni('ajan', { ...ACIK, mod: 'is', motor: 'durdu' }), 'Fuber’in yapay zekâsı bağlı değil (Ayarlar → Hesap ve kullanım)');
  assert.equal(bolgeKapaliNedeni('ajan', { ...ACIK, mod: 'gelistirici', motor: 'bagli-degil' }), 'Hiçbir yapay zekâ motoru bağlı değil (Ayarlar → Hesap ve kullanım)');
  assert.equal(bolgeKapaliNedeni('ajan', { ...ACIK, mod: 'gelistirici', motor: 'durdu', gizli: true }), 'Gizli mod açık, yerel model hazır değil (Ayarlar → Gizlilik)');
  assert.match(bolgeKapaliNedeni('ajan', { ...ACIK, mod: 'is', motor: 'hesap-bekliyor' }) ?? '', /^Hesabın onay bekliyor \(Ayarlar → Hesap ve kullanım\)$/);
  assert.match(bolgeKapaliNedeni('ajan', { ...ACIK, mod: 'is', motor: 'hesap-kapali' }) ?? '', /^Fuber erişimi kapalı \(Ayarlar → Hesap ve kullanım\)$/);
  assert.match(bolgeKapaliNedeni('ajan', { ...ACIK, mod: 'gelistirici', motor: 'kredi-bitti' }) ?? '', /^Kullanım hakkın doldu \(Ayarlar → Hesap ve kullanım\)$/);
  assert.match(bolgeKapaliNedeni('ajan', { ...ACIK, mod: 'is', motor: 'durdu', gizli: true }) ?? '', /^Gizli mod açık, bu bilgisayardaki yapay zekâ hazır değil \(Ayarlar → Gizlilik\)$/);
  assert.equal(bolgeKapaliNedeni('ajan', { ...ACIK, motor: 'yerel', gizli: true }), undefined);
});

test('kapalı nedeni: mikrofon tamamen kapalıysa kulak ve uyanma bunu söyler; gün kaydı kapalıysa ajanları', () => {
  assert.equal(bolgeKapaliNedeni('kulak', { ...ACIK, mikrofonKapali: true }), 'Mikrofon kapalı (sol menü)');
  assert.equal(bolgeKapaliNedeni('uyanma', { ...ACIK, mikrofonKapali: true }), 'Mikrofon kapalı (sol menü)');
  assert.equal(bolgeKapaliNedeni('kulak', { ...ACIK, uyandirma: false, gunKaydi: false }), 'Mikrofon kullanılmıyor: "Hey Fuber" ve gün kaydı kapalı');
  // Motor çalışmıyorsa "ayar kapalı" denmez: ayar açık, kullanıcıya yanlış yol gösterir (0.13 T8).
  const vazgecti = { ...ACIK, gunKaydi: false, uyandirmaDurumu: 'vazgecti' } as const;
  assert.equal(bolgeKapaliNedeni('uyanma', vazgecti), UYANDIRMA_DUSTU_METNI);
  assert.equal(bolgeKapaliNedeni('kulak', vazgecti), UYANDIRMA_DUSTU_METNI);
  assert.equal(bolgeKapaliNedeni('kulak', { ...vazgecti, gunKaydi: true }), undefined); // gün kaydı dinliyor: kulak açık
  assert.equal(bolgeKapaliNedeni('uyanma', { ...vazgecti, gunKaydi: true }), UYANDIRMA_DUSTU_METNI);
  assert.equal(bolgeKapaliNedeni('uyanma', { ...ACIK, uyandirmaDurumu: 'dustu' }), UYANDIRMA_DUSTU_METNI);
  assert.equal(bolgeKapaliNedeni('kulak', { ...ACIK, gunKaydi: false, uyandirmaDurumu: 'dustu' }), undefined); // yeniden deneme bekliyor: mikrofon açık
  assert.equal(bolgeKapaliNedeni('uyanma', { ...vazgecti, uyandirma: false }), '"Hey Fuber" kapalı (Ayarlar → Ses ve ada)'); // ayar gerçekten kapalıysa o söylenir
  for (const b of ['yazici', 'not', 'rapor', 'bekci', 'eslikci'] as const) assert.match(bolgeKapaliNedeni(b, { ...ACIK, gunKaydi: false }) ?? '', /^Gün kaydı kapalı \(Ayarlar → Gün kaydı\)$/);
  assert.equal(bolgeKapaliNedeni('eslikci', { ...ACIK, eslikciKapali: true }), 'Araya girme kapalı (Ayarlar → Gün kaydı)');
  assert.equal(bolgeKapaliNedeni('goz', { ...ACIK, bilgisayar: false }), undefined, 'tarayıcı yetkisi gözü açık tutar');
});

test('Akıl bölgesinin kartı motoru bağlayacak yere götürür ("motorlar" çapası: İş → Hesap ve kullanım)', () => {
  assert.equal(BOLGELER.find((b) => b.id === 'ajan')?.ayar, 'motorlar');
});
