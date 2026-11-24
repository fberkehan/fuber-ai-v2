// 0.11 G11 — açılış animasyonu ve sesi: karar işlevleri (saf), süreç başına bir kez bayrağı (ilk gösterim kapısı), zaman çizelgesi
// sabitleri ve sentezlenen çan (sahte AudioContext; ses dosyası yok, kazanç/süre sınırları).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACILIS, acilisCalsinMi, acilisSesiCalsinMi, acilisSesiEylemi, acilisSesiKarari, acilisSureleri, acilisTiklamaTuketilsinMi, sessizSaatteMi, ilkGosterimKapisi,
} from '../src/shared/acilis.ts';
import { acilisSesiBaslat, acilisSesiCal, ACILIS_NOTALARI, ACILIS_ATAK, ACILIS_SESSIZ } from '../src/renderer/acilis/acilis-sesi.ts';

const kok = path.resolve(import.meta.dirname, '..');

// ── acilisCalsinMi ────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('acilisCalsinMi: ilk gösterim + hareket → tam; azaltılmış hareket → kisa; sonraki gösterim → yok', () => {
  assert.equal(acilisCalsinMi({ ilkGosterim: true, azaltilmisHareket: false }), 'tam');
  assert.equal(acilisCalsinMi({ ilkGosterim: true, azaltilmisHareket: true }), 'kisa');
  assert.equal(acilisCalsinMi({ ilkGosterim: false, azaltilmisHareket: false }), 'yok');
  assert.equal(acilisCalsinMi({ ilkGosterim: false, azaltilmisHareket: true }), 'yok');
});

// ── acilisSesiCalsinMi ────────────────────────────────────────────────────────────────────────────────────────────────────────
const SES_ACIK = { ayar: true, sessizSaat: false, rahatsizEtme: false, demo: false };
test('acilisSesiCalsinMi: yalnız ayar açık, sessiz saat değil, rahatsız etme yok ve demo değilken çalar', () => {
  assert.equal(acilisSesiCalsinMi(SES_ACIK), true);
  assert.equal(acilisSesiCalsinMi({ ...SES_ACIK, ayar: false }), false, 'ayar kapalı');
  assert.equal(acilisSesiCalsinMi({ ...SES_ACIK, sessizSaat: true }), false, 'sessiz saat');
  assert.equal(acilisSesiCalsinMi({ ...SES_ACIK, rahatsizEtme: true }), false, 'rahatsız etme');
  assert.equal(acilisSesiCalsinMi({ ...SES_ACIK, demo: true }), false, 'FUBER_DEMO');
});

test('acilisSesiEylemi: demo\'da çalacak olan ses çalınmaz ama KAYDEDİLİR; çalmayacak olan hiçbir şey yazmaz', () => {
  assert.equal(acilisSesiEylemi(SES_ACIK), 'cal');
  assert.equal(acilisSesiEylemi({ ...SES_ACIK, demo: true }), 'kaydet');
  assert.equal(acilisSesiEylemi({ ...SES_ACIK, demo: true, ayar: false }), 'yok');
  assert.equal(acilisSesiEylemi({ ...SES_ACIK, demo: true, sessizSaat: true }), 'yok');
  assert.equal(acilisSesiEylemi({ ...SES_ACIK, demo: true, rahatsizEtme: true }), 'yok');
  assert.equal(acilisSesiEylemi({ ...SES_ACIK, ayar: false }), 'yok');
});

// ── Sessiz saat (zamanlayici.ts sessizMi ile aynı kural; rahatsız etme ayrı) ───────────────────────────────────────────────
test('sessizSaatteMi: geceyi aşan aralık (23:00–08:00) ve aynı gün içi aralık; bitiş dışarıda', () => {
  const an = (s: number, d: number) => new Date(2026, 9, 28, s, d);
  assert.equal(sessizSaatteMi('23:00', '08:00', an(23, 0)), true);
  assert.equal(sessizSaatteMi('23:00', '08:00', an(1, 35)), true);
  assert.equal(sessizSaatteMi('23:00', '08:00', an(7, 59)), true);
  assert.equal(sessizSaatteMi('23:00', '08:00', an(8, 0)), false, 'bitiş anı sessiz değil');
  assert.equal(sessizSaatteMi('23:00', '08:00', an(14, 0)), false);
  assert.equal(sessizSaatteMi('13:00', '15:00', an(14, 0)), true);
  assert.equal(sessizSaatteMi('13:00', '15:00', an(15, 0)), false);
  assert.equal(sessizSaatteMi('', '', an(3, 0)), false, 'bozuk/boş aralık sessiz sayılmaz (başlangıç = bitiş)');
});

// ── Zaman çizelgesi ───────────────────────────────────────────────────────────────────────────────────────────────────────────
test('ACILIS: işaret 0–700, yazı 300–900, erime 1200\'de başlar; toplam ≤ 1,4 sn; atlama ≤ 150 ms; azaltılmışta kısa', () => {
  assert.equal(ACILIS.isaretBas, 0);
  assert.equal(ACILIS.isaretBit, 700);
  assert.equal(ACILIS.yaziBas, 300);
  assert.equal(ACILIS.yaziBit, 900);
  assert.equal(ACILIS.eritBas, 1200);
  assert.ok(ACILIS.eritBas + ACILIS.eritSure <= 1400, 'toplam ≤ 1,4 sn');
  assert.ok(ACILIS.yaziBit <= ACILIS.eritBas, 'yazı erimeden önce biter');
  assert.ok(ACILIS.atlaSure <= 150, 'atlama ≤ 150 ms');
  assert.ok(ACILIS.kisaBekle + ACILIS.kisaSure <= 800, 'azaltılmış hareket kısa kalır');
  assert.ok(ACILIS.kisaSure >= 200 && ACILIS.kisaSure <= 300, 'azaltılmışta ~300 ms solma (spec 200 ms, denetleyici ~300)');
});

// İşaret/yazı/sahne alt süreleri üst sınırlarla tutarlı: CSS bu alt süreleri okur, 0–700 / 300–900 / 1200–1400 sözleri gerçekten tutar.
test('ACILIS: alt süreler çizelgeye uyar (işaret ≤ 700, alt gövde erken başlar ve tam 700\'de biter, 5 harf son harf tam 900, sahne erimeden önce söner)', () => {
  assert.ok(ACILIS.isaretAc <= ACILIS.isaretBit && ACILIS.isaretGel <= ACILIS.isaretBit, 'işaret açılışı 700\'ü aşmaz');
  // 0.12 mini logo: ikinci yol (alt gövde) süpürmenin İLK çeyreğinde başlar (geç başlarsa işaret geç belirir; inceleme Minor-2) ve işaret
  // penceresinin sonunda biter.
  assert.equal(ACILIS.parcaBas + ACILIS.parcaSure, ACILIS.isaretBit, 'alt gövde işaret penceresinin sonunda biter');
  assert.ok(ACILIS.parcaBas > ACILIS.isaretBas && ACILIS.parcaBas <= ACILIS.isaretAc / 4, 'alt gövde süpürmenin ilk çeyreğinde başlar');
  assert.equal(ACILIS.yaziBas + 4 * ACILIS.harfAralik + ACILIS.harfSure, ACILIS.yaziBit, '5 harf: son harf yazı penceresinin sonunda biter');
  assert.ok(ACILIS.eritBas - ACILIS.sahneOnce >= ACILIS.yaziBit, 'sahne ancak yazı bittikten sonra sönmeye başlar');
  assert.ok(ACILIS.eritBas - ACILIS.sahneOnce + ACILIS.sahneSure <= ACILIS.eritBas + ACILIS.eritSure, 'sahne zeminden önce ya da onunla birlikte söner');
  assert.ok(ACILIS.kisaBekle - ACILIS.kisaSahneOnce >= 0 && ACILIS.kisaBekle - ACILIS.kisaSahneOnce + ACILIS.kisaSahneSure <= ACILIS.kisaBekle + ACILIS.kisaSure);
  const d = acilisSureleri();
  assert.equal(d['--a-erit-bas'], '1200ms');
  assert.equal(d['--a-sahne-bas'], `${ACILIS.eritBas - ACILIS.sahneOnce}ms`);
  assert.equal(d['--a-kisa-sahne-bas'], `${ACILIS.kisaBekle - ACILIS.kisaSahneOnce}ms`);
});

// ── Atlatan tıklama: tüketilsin mi ────────────────────────────────────────────────────────────────────────────────────────────
test('acilisTiklamaTuketilsinMi: üretimde HER ZAMAN tüketir; demo\'da yalnız test kapısı açıksa; pencere düğmeleri HİÇBİR ZAMAN', () => {
  const g = (demo: boolean, demoKapisi: boolean, pencereDugmesi: boolean) => acilisTiklamaTuketilsinMi({ demo, demoKapisi, pencereDugmesi });
  // Üretim (demo değil): kapı ne olursa olsun tüketir (kapı üretimde okunmaz).
  assert.equal(g(false, false, false), true);
  assert.equal(g(false, true, false), true);
  // FUBER_DEMO: varsayılan geçirir (otomasyonun ilk tıklaması kaybolmasın), kapı açılınca tüketir.
  assert.equal(g(true, false, false), false);
  assert.equal(g(true, true, false), true);
  // Pencere düğmeleri (Küçült/Büyüt/Kapat): her durumda tüketilmez (ilk tıklamada çalışır).
  for (const demo of [false, true]) for (const kapi of [false, true]) assert.equal(g(demo, kapi, true), false, `pencere düğmesi tüketilmemeli (demo=${demo}, kapı=${kapi})`);
});

// ── Ayarlardan ses kararı ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('acilisSesiKarari: ayarlar okunamadıysa SES ÇALMAZ (gece 3\'te çan yok); okunduysa kural uygulanır', () => {
  const ogle = new Date(2026, 9, 28, 12, 0);
  const gece = new Date(2026, 9, 28, 3, 0);
  const ayar = (ek: object = {}, ses: object = {}) => ({ ses: { acilisSesi: true, ...ses }, proaktif: { sessizBaslangic: '23:00', sessizBitis: '08:00', ...ek } });
  assert.equal(acilisSesiKarari(null, { simdi: gece, demo: false }), 'yok', 'ayarlar:al reddi (null) → sessiz');
  assert.equal(acilisSesiKarari(undefined, { simdi: ogle, demo: false }), 'yok');
  assert.equal(acilisSesiKarari({}, { simdi: ogle, demo: false }), 'yok', 'eksik ayar nesnesi → sessiz');
  assert.equal(acilisSesiKarari({ ses: { acilisSesi: true } }, { simdi: ogle, demo: false }), 'yok', 'sessiz saat bilgisi yok → sessiz');
  assert.equal(acilisSesiKarari(ayar(), { simdi: ogle, demo: false }), 'cal');
  assert.equal(acilisSesiKarari(ayar(), { simdi: ogle, demo: true }), 'kaydet', 'demo: çalınmaz, kaydedilir');
  assert.equal(acilisSesiKarari(ayar(), { simdi: gece, demo: false }), 'yok', 'sessiz saat');
  assert.equal(acilisSesiKarari(ayar({ rahatsizEtmeBitis: new Date(ogle.getTime() + 3600_000).toISOString() }), { simdi: ogle, demo: false }), 'yok', 'rahatsız etme sürüyor');
  assert.equal(acilisSesiKarari(ayar({ rahatsizEtmeBitis: new Date(ogle.getTime() - 3600_000).toISOString() }), { simdi: ogle, demo: false }), 'cal', 'rahatsız etme bitmiş');
  assert.equal(acilisSesiKarari(ayar({}, { acilisSesi: false }), { simdi: ogle, demo: false }), 'yok', 'ayar kapalı');
  assert.equal(acilisSesiKarari({ ses: {}, proaktif: { sessizBaslangic: '23:00', sessizBitis: '08:00' } }, { simdi: ogle, demo: false }), 'cal', 'eski profil (alan yok) varsayılan açık');
});

// ── İlk gösterim kapısı (uygulama:ilk-gosterim) ───────────────────────────────────────────────────────────────────────────────
test('ilk gösterim kapısı: pencere gösterilmeden soru bekler; ilk gösterimde TEK kez true, sonrası false', async () => {
  const k = ilkGosterimKapisi();
  let cevap: boolean | null = null;
  const soru = k.al().then((b) => { cevap = b; return b; });
  await Promise.resolve();
  assert.equal(cevap, null, '--gizli: pencere henüz gösterilmedi → soru bekliyor');
  k.gosterildi();
  assert.equal(await soru, true, 'ilk gerçek gösterim → true');
  assert.equal(await k.al(), false, 'ikinci çağrı false');
  assert.equal(await k.al(), false, 'üçüncü çağrı false');
});

test('ilk gösterim kapısı: pencere çoktan gösterilmişse ilk soru true, ikinci false; tekrarlı gosterildi() etkisiz', async () => {
  const k = ilkGosterimKapisi();
  k.gosterildi();
  k.gosterildi();
  assert.equal(await k.al(), true);
  assert.equal(await k.al(), false);
  k.gosterildi();
  assert.equal(await k.al(), false, 'ikinci pencere gösterimi yeni bir ilk gösterim değildir');
});

test('ilk gösterim kapısı: arayüz yenilenip iki soru bekliyorsa true yalnız EN SON soruya gider (eskisinin penceresi gitti)', async () => {
  const k = ilkGosterimKapisi();
  const eski = k.al();
  const yeni = k.al();
  k.gosterildi();
  assert.equal(await eski, false);
  assert.equal(await yeni, true);
  assert.equal(await k.al(), false);
});

// ── Sentezlenen çan ───────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Kayit { ad: string; deger?: number; zaman?: number }
function sahteBaglam() {
  const kayit: Kayit[] = [];
  const gainler: SahteParam[] = [];
  const osilatorler: { tur: string; frekans: number; basla: number; dur: number }[] = [];
  class SahteParam {
    degerler: number[] = [];
    rampa: { deger: number; zaman: number }[] = [];
    setValueAtTime(v: number, t: number) { this.degerler.push(v); kayit.push({ ad: 'setValueAtTime', deger: v, zaman: t }); return this; }
    linearRampToValueAtTime(v: number, t: number) { this.degerler.push(v); this.rampa.push({ deger: v, zaman: t }); return this; }
    exponentialRampToValueAtTime(v: number, t: number) { this.degerler.push(v); this.rampa.push({ deger: v, zaman: t }); return this; }
    setTargetAtTime(v: number) { this.degerler.push(v); return this; }
    cancelScheduledValues() { return this; }
    set value(v: number) { this.degerler.push(v); }
  }
  const dugum = () => ({ connect(h: unknown) { return h; }, disconnect() {} });
  const ctx = {
    currentTime: 10,
    state: 'running',
    destination: dugum(),
    resume: async () => undefined,
    createGain() { const gain = new SahteParam(); gainler.push(gain); return Object.assign(dugum(), { gain }); },
    createOscillator() {
      const o = { type: 'sine', frequency: new SahteParam(), onended: null as null | (() => void), basla: -1, dur: -1,
        ...dugum(), setPeriodicWave() {},
        start(t: number) { o.basla = t; },
        stop(t: number) { o.dur = t; queueMicrotask(() => o.onended?.()); } };
      osilatorler.push({ get tur() { return o.type; }, get frekans() { return o.frequency.degerler.at(-1) ?? 0; }, get basla() { return o.basla; }, get dur() { return o.dur; } } as never);
      return o;
    },
    createPeriodicWave() { return {}; },
    createBiquadFilter() { return Object.assign(dugum(), { type: 'lowpass', frequency: new SahteParam(), Q: new SahteParam() }); },
    createBuffer() { kayit.push({ ad: 'createBuffer' }); throw new Error('ses dosyası/tampon yok'); },
    createBufferSource() { kayit.push({ ad: 'createBufferSource' }); throw new Error('ses dosyası/tampon yok'); },
  };
  return { ctx: ctx as unknown as AudioContext, kayit, gainler, osilatorler };
}

test('çan: 2–3 nota, tamamı ≤ 0,9 sn, en yüksek kazanç ≤ 0,15 (üst üste binen zarfların toplamı da), dosya/tampon yok', async () => {
  assert.ok(ACILIS_NOTALARI.length >= 2 && ACILIS_NOTALARI.length <= 3, '2–3 nota');
  const bitis = Math.max(...ACILIS_NOTALARI.map((n) => n.baslangic + n.sure));
  assert.ok(bitis <= 0.9, `çan ${bitis} sn sürüyor`);
  // Notalar tek osilatörlü ve PeriodicWave normalize edilmiş (tepe 1): bir notanın genliği her an kendi zarfıdır (30 ms doğrusal atak,
  // sonra üstel sönüm). Üst üste binen zarfların HER ANDAKİ toplamı en kötü durum genliğidir (süzgeç rezonanssız: kazanç ≤ 1).
  for (const n of ACILIS_NOTALARI) assert.ok(n.tepe <= 0.15, `nota kazancı ${n.tepe}`);
  const zarf = (n: (typeof ACILIS_NOTALARI)[number], t: number) => {
    const x = t - n.baslangic;
    if (x < 0 || x > n.sure) return 0;
    return x < ACILIS_ATAK ? (n.tepe * x) / ACILIS_ATAK : n.tepe * Math.pow(ACILIS_SESSIZ / n.tepe, (x - ACILIS_ATAK) / (n.sure - ACILIS_ATAK));
  };
  let tavan = 0;
  for (let t = 0; t <= 1; t += 0.001) tavan = Math.max(tavan, ACILIS_NOTALARI.reduce((s, n) => s + zarf(n, t), 0));
  assert.ok(tavan <= 0.15, `üst üste binen zarfların en yüksek toplamı ${tavan}`);
  assert.ok(tavan >= 0.06, `çan duyulabilir düzeyde olmalı (zarf toplamı ${tavan})`);

  const { ctx, kayit, gainler, osilatorler } = sahteBaglam();
  await acilisSesiCal(ctx);
  assert.deepEqual(kayit.filter((k) => k.ad.startsWith('createBuffer')), [], 'ses dosyası/tampon kullanılmaz (yalnız sentez)');
  assert.ok(gainler.length >= 2, 'her nota kendi kazanç düğümünü taşır');
  const enYuksek = Math.max(...gainler.flatMap((g) => g.degerler));
  assert.ok(enYuksek <= 0.15, `en yüksek kazanç ${enYuksek}`);
  assert.ok(enYuksek > 0, 'çan duyulur olmalı');
  assert.ok(osilatorler.length >= 2 && osilatorler.length <= 6, `${osilatorler.length} osilatör`);
  const ilk = Math.min(...osilatorler.map((o) => o.basla));
  const son = Math.max(...osilatorler.map((o) => o.dur));
  assert.ok(son - ilk <= 0.9 + 1e-9, `ilk başlangıçtan son durmaya ${son - ilk} sn`);
  assert.ok(ilk >= 10, 'zamanlama bağlamın saatine göre ileriye kurulur');
});

test('çan: yumuşak atak (kazanç 0\'dan başlar, ≥ 20 ms\'de yükselir) ve yumuşak sönüm (üstel; sert kesme yok)', async () => {
  const { ctx, gainler } = sahteBaglam();
  await acilisSesiCal(ctx);
  const notaKazanclari = gainler.filter((g) => g.rampa.length >= 2);
  assert.ok(notaKazanclari.length >= 2, 'nota kazançlarında atak + sönüm rampası');
  for (const g of notaKazanclari) {
    assert.equal(g.degerler[0], 0, 'kazanç sessizlikten başlar (tık sesi yok)');
    const [atak, sonum] = g.rampa;
    assert.ok(atak.zaman - 10 >= 0.02, 'atak ≥ 20 ms');
    assert.ok(atak.deger > 0 && atak.deger <= 0.15);
    assert.ok(sonum.zaman > atak.zaman && sonum.deger <= 0.001, 'sönüm neredeyse sessizliğe iner');
  }
});

test('çan: askıdaki (suspended) bağlam sürdürülür; bağlam hata verse bile söz reddedilmez', async () => {
  const { ctx } = sahteBaglam();
  let surdu = false;
  Object.assign(ctx, { state: 'suspended', resume: async () => { surdu = true; } });
  await acilisSesiCal(ctx);
  assert.equal(surdu, true);
  const bozuk = { currentTime: 0, state: 'running', resume: async () => undefined, createGain() { throw new Error('ses yok'); }, destination: {} } as unknown as AudioContext;
  await assert.doesNotReject(acilisSesiCal(bozuk), 'ses çıkışı yoksa açılışı bozmaz');
});

// ── acilisSesiBaslat: gerçek çalma yolunun bağlantısı (demo'da hiç çalışmadığı için önizleme göremez) ─────────────────────────────────
test('acilisSesiBaslat: bağlam kurulur, çan çalınır, bitince close() çağrılır; kurucu hata verirse sessiz kalır', async () => {
  const eski = (globalThis as { AudioContext?: unknown }).AudioContext;
  try {
    const secenekler: unknown[] = [];
    let kapandi = 0;
    let olusturulan: ReturnType<typeof sahteBaglam> | null = null;
    class SahteAudioContext {
      constructor(o?: unknown) {
        secenekler.push(o);
        olusturulan = sahteBaglam();
        return Object.assign(olusturulan.ctx, { close: async () => { kapandi++; } });
      }
    }
    (globalThis as { AudioContext?: unknown }).AudioContext = SahteAudioContext;
    await acilisSesiBaslat();
    assert.equal(secenekler.length, 1, 'tek bağlam kurulur');
    assert.deepEqual(secenekler[0], { latencyHint: 'interactive' });
    assert.ok(olusturulan !== null && (olusturulan as ReturnType<typeof sahteBaglam>).osilatorler.length >= 2, 'çan gerçekten zamanlandı (osilatörler)');
    assert.equal(kapandi, 1, 'çan bitince bağlam close() ile kapatılır');

    // close() reddederse de söz reddedilmez.
    class KapanmayanAudioContext {
      constructor() { return Object.assign(sahteBaglam().ctx, { close: async () => { throw new Error('kapanmadı'); } }); }
    }
    (globalThis as { AudioContext?: unknown }).AudioContext = KapanmayanAudioContext;
    await assert.doesNotReject(acilisSesiBaslat());

    // Kurucu hata fırlatırsa (ses çıkışı/AudioContext yok) açılış bozulmaz: sessizce biter, close() çağrılmaz.
    let kapandi2 = 0;
    class BozukAudioContext {
      constructor() { throw new Error('AudioContext kurulamadı'); }
      close() { kapandi2++; }
    }
    (globalThis as { AudioContext?: unknown }).AudioContext = BozukAudioContext;
    await assert.doesNotReject(acilisSesiBaslat());
    assert.equal(kapandi2, 0);

    // AudioContext hiç yoksa (tanımsız) da sessiz.
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
    await assert.doesNotReject(acilisSesiBaslat());
  } finally {
    if (eski === undefined) delete (globalThis as { AudioContext?: unknown }).AudioContext; else (globalThis as { AudioContext?: unknown }).AudioContext = eski;
  }
});

// ── Kaynak kuralları ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const okuKaynak = (g: string) => fs.readFileSync(path.join(kok, g), 'utf8');
const yorumsuzCss = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');

test('örtü CSS: renkler yalnız belirteçlerden (renk sözcüğü/işlevi yok), zıplama yok, HİÇBİR süre literali yok', () => {
  const css = yorumsuzCss(okuKaynak('src/renderer/acilis/acilis.css'));
  assert.deepEqual(css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\b(?:black|white)\b/g) ?? [], [], 'acilis.css sabit renk içermemeli (black/white dahil)');
  assert.ok(!/bounce|overshoot|cubic-bezier\([^)]*-\d/.test(css), 'zıplama/aşma yok');
  assert.deepEqual(css.match(/(?<![\w-])\d+(?:\.\d+)?m?s\b/g) ?? [], [], 'süreler shared/acilis.ts ACILIS\'ten gelir; CSS\'te ms/s literali olmamalı');
  assert.doesNotMatch(css, /68px|inset:\s*8px/, 'ray genişliği ve pano kenarı sabit yazılmaz');
  // 0.13 T13: Şeffaf tema geri geldi ama örtü her temada bütün pencereyi OPAK kaplar: cam kuralı bu dosyada yok, tasarim.css `.acilis`ı
  // cam temada koyu opak belirteçlerle yeniden kurar (tests/kurulum-v2.test.ts).
  assert.doesNotMatch(css, /data-tema='cam'|--centik/);
  assert.match(css, /\.acilis \{[^}]*inset: 0;[^}]*background: var\(--pano-zemin\)/);
});

test('örtü CSS: kullandığı her --a-* değişkenini acilisSureleri() verir ve verilen hiçbir değişken ölü değildir', () => {
  const css = yorumsuzCss(okuKaynak('src/renderer/acilis/acilis.css'));
  const kullanilan = new Set([...css.matchAll(/var\((--a-[a-z0-9-]+)/g)].map((m) => m[1]));
  const verilen = new Set(Object.keys(acilisSureleri()));
  assert.deepEqual([...kullanilan].filter((v) => !verilen.has(v)), [], 'CSS\'in okuduğu ama verilmeyen değişken');
  assert.deepEqual([...verilen].filter((v) => !kullanilan.has(v)), [], 'verilen ama CSS\'in hiç okumadığı (ölü) değişken');
  // tasarim.css değişkenleri gerçekten tanımlı (cam kipi ray/pano kenarını buradan okur).
  const tasarim = okuKaynak('src/renderer/tasarim.css');
  assert.match(tasarim, /--ray:\s*68px/);
  assert.match(tasarim, /--pano-kenar:\s*8px/);
  assert.match(tasarim, /grid-template-columns:\s*var\(--ray\)/);
});

test('örtü: ses dosyası/ağ yok, karar ana sürecin bayrağından; tıklama tüketilir (yakalama + devamı yutulur), tuş geçer; temizlik; ölçüm yalnız demo', () => {
  const tsx = okuKaynak('src/renderer/acilis/Acilis.tsx');
  assert.match(tsx, /uygulama:ilk-gosterim/, 'karar ana sürecin ilk gösterim bayrağından');
  assert.ok(!/(?:fetch|XMLHttpRequest|\.mp3|\.wav|\.ogg|new Audio\()/.test(tsx + okuKaynak('src/renderer/acilis/acilis-sesi.ts')), 'ses dosyası/ağ yok');
  // Tıklama: pointerdown yakalama aşamasında tüketilir, devamı (pointerup/mouseup/click) tek seferlik yakalama dinleyicileriyle yutulur.
  assert.match(tsx, /addEventListener\('pointerdown', tikla, \{ capture: true \}\)/, 'pointerdown yakalama aşamasında, PASİF DEĞİL (preventDefault çalışsın)');
  assert.match(tsx, /acilisTiklamaTuketilsinMi\(\{ demo: demoMu\(\), demoKapisi: demoYutKapisi\(\), pencereDugmesi: pencereDugmesiMi\(e\.target\) \}\)/, 'karar saf işlevde (üretimde her zaman tüketir, pencere düğmeleri hariç)');
  assert.match(tsx, /if \(tuket\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); hareketiYut\(\); \}\s*atla\(\);/, 'atlatan pointerdown tüketilir; tüketilmese de örtü atlatılır');
  assert.match(tsx, /hedef\.closest\('\.pd-dugmeler'\)/, 'pencere düğmeleri hedefi tanınır');
  // Bayat yutma: yeni set eskisini iptal eder; kurulu sette bir SONRAKİ pointerdown seti iptal eder; 4 sn emniyet durur.
  assert.match(tsx, /yutma\?\.abort\(\);\s*const ac = \(yutma = new AbortController\(\)\);/, 'yeni yutma seti eskisini iptal eder');
  assert.match(tsx, /addEventListener\('pointerdown', \(\) => ac\.abort\(\), \{ capture: true, once: true, signal: ac\.signal \}\)/, 'sonraki ilk pointerdown yutma setini iptal eder');
  assert.match(tsx, /setTimeout\(\(\) => ac\.abort\(\), 4000\)/, '4 sn emniyet durur');
  for (const tur of ['pointerup', 'mouseup', 'click']) assert.ok(tsx.includes(`'${tur}'`), `${tur} yutulur`);
  assert.match(tsx, /capture: true, once: true, signal/, 'devamı tek seferlik yakalama dinleyicileriyle yutulur');
  // Tuşlar geçer: keydown tüketilmez (passive, preventDefault yok).
  assert.match(tsx, /addEventListener\('keydown', atla, \{ capture: true, passive: true \}\)/);
  assert.doesNotMatch(tsx.split('const atla = ')[1]?.split('const tikla')[0] ?? '', /preventDefault|stopPropagation/, 'tuş yolunda tüketme yok');
  // Örtü kalkınca (kalkti) dinleyiciler ve güvenlik zamanlayıcısı temizlenir.
  assert.match(tsx, /\[kip, kalkti\]/, 'etki kalkti\'ya bağlı: örtü kalkınca temizlenir');
  assert.match(tsx, /kalkti\) return;/, 'kalkınca yeniden dinleyici kurulmaz');
  assert.match(tsx, /clearTimeout\(emniyet\)/);
  // performance.mark yalnız FUBER_DEMO'da.
  const markSatirlari = tsx.split('\n').filter((s) => s.includes('performance.mark'));
  assert.ok(markSatirlari.length >= 3);
  assert.match(tsx, /if \(demoMu\(\)\) performance\.mark\('acilis:bitti'\)/);
  assert.match(tsx, /if \(demoMu\(\)\) \{\s*const ilk = kok\.current\?\.getAnimations/, 'başlangıç işareti demo bloğunda');
  // Ayarlar okunamazsa ses çalmaz: karar saf işlevde, bileşen null'ı o işleve verir.
  assert.match(tsx, /acilisSesiKarari\(a, \{ simdi: new Date\(\), demo: demoMu\(\) \}\)/);
  const css = okuKaynak('src/renderer/acilis/acilis.css');
  assert.doesNotMatch(css, /cursor:|user-select:/, 'pointer-events:none ile etkisiz cursor/user-select bildirimleri yok');
});
