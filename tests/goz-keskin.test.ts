// Developer modunun keskin bakışlı gözleri (12 Kas; keskin bakış ve normal bakış ayrı modlardır, yalnız renk değişimi yetmez).
// Business "Pamuk" kalır; Developer "Odak" (önizleme .superpowers/goz-keskin/index.html, öneri 1). Fark gözün biçiminde ve bakışında: içe eğik, düz kenarlı
// kapak (odaklanmış, kararlı; yarık bebek yok, avcı bakışı yok), biraz daha geniş ve basık gövde, biraz küçük bebek, daha sabit ve "satır okuyan" bakış.
// Burada: biçim profilleri (geometri.ts), hâl hedefleri, hareket beyninde biçim değişimi (kırpmanın kapalı anında takas: sıçrama yok), Odak'la uyku dizisi,
// bakış tarzı ve Gozler/CSS kaynağı.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GozBeyni, type Canlandirici, type DonguKaresi, type GozOgeleri, type Saat } from '../src/renderer/ui/goz/beyin.ts';
import {
  KAPALI_YOL, KIP_SEKLI, KIRPMA_SURE, MOD_KIRPMA_SURE, modKirpmaKareleri, NEFES_SAYI, PAMUK, SEKILLER, UYKU_SURE, UYKU_TOPLAM_MS, d, govdeYolu, hedef, kapakP, kapakT, kapakY, kapakYolu,
  kipSekli, kirpmaKareleri, nefesKareleri, sekil, type GozSekliAdi, type Kare,
} from '../src/renderer/ui/goz/geometri.ts';
import { UYKU_MS, type GozDurumu } from '../src/shared/goz.ts';

const kok = path.resolve(import.meta.dirname, '..');
const komutlar = (yol: string) => yol.replace(/[-\d.\s]/g, '').split('');
const sayilar = (yol: string) => yol.match(/-?\d*\.?\d+/g)!.map(Number);
const DURUMLAR: readonly GozDurumu[] = ['bosta', 'dinliyor', 'dusunuyor', 'konusuyor', 'mutlu', 'hata', 'uyuyor'];
const olcek = (t: string) => Number(/scale\(([\d.]+)\)/.exec(t)![1]);
/** Yalnız M, L, C, Z içeren yolun eğri örnekleri. */
function egriOrnekleri(yol: string): [number, number][] {
  const out: [number, number][] = [];
  let p: [number, number] = [0, 0];
  for (const m of yol.matchAll(/([MLCZ])([^MLCZ]*)/g)) {
    const n = (m[2].match(/-?\d*\.?\d+/g) ?? []).map(Number);
    if (m[1] === 'M' || m[1] === 'L') { p = [n[0], n[1]]; out.push(p); }
    if (m[1] === 'C') {
      const [a, b, c, e, f, g] = n;
      for (let i = 1; i <= 24; i++) {
        const t = i / 24; const u = 1 - t;
        out.push([u ** 3 * p[0] + 3 * u * u * t * a + 3 * u * t * t * c + t ** 3 * f, u ** 3 * p[1] + 3 * u * u * t * b + 3 * u * t * t * e + t ** 3 * g]);
      }
      p = [f, g];
    }
  }
  return out;
}

// ── Biçim profilleri ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('profiller: Business Pamuk, Developer Odak; önizlemenin üç önerisi de profil (takas tek satır)', () => {
  assert.deepEqual(Object.keys(SEKILLER).sort(), ['mercek', 'odak', 'pamuk', 'ufuk']);
  assert.deepEqual(KIP_SEKLI, { business: 'pamuk', developer: 'odak' });
  assert.equal(kipSekli('business').ad, 'pamuk');
  assert.equal(kipSekli('developer').ad, 'odak');
  // Pamuk profili tasarımla birebir kalır.
  assert.equal(govdeYolu(SEKILLER.pamuk, 1), sekil(1));
  assert.equal(SEKILLER.pamuk.lidK, PAMUK.lidK);
  assert.equal(SEKILLER.pamuk.bebekOlcek, 1);
  for (const dd of DURUMLAR) assert.deepEqual(hedef(dd, 1, SEKILLER.pamuk), hedef(dd, 1), `${dd}: Pamuk değişmedi`);
});

test('keskin gövdeler: yol komutları M L C Q H V Z, sol göz ayna, gövde Pamuk\'tan farklı (yalnız renk değil)', () => {
  for (const ad of ['pamuk', 'odak', 'ufuk', 'mercek'] as GozSekliAdi[]) {
    const sk = SEKILLER[ad];
    for (const y of [govdeYolu(sk, 1), govdeYolu(sk, -1), kapakYolu(sk.lidK)]) for (const c of komutlar(y)) assert.match(c, /^[MLCQHVZ]$/, `${ad}: ${c}`);
    const sag = sayilar(govdeYolu(sk, 1)); const sol = sayilar(govdeYolu(sk, -1));
    sag.forEach((v, i) => assert.equal(sol[i], i % 2 === 0 ? (v === 0 ? 0 : -v) : v));
    assert.equal(govdeYolu(sk, -1), d(sk.govde, -1));
    // Göz kapalıyken kapak gövdeyi tamamen örter (takas kapalı anda görünmez). Kırpma kapağı hâlin döndürmesiyle kapanır (her hâl, iki göz):
    // gövde eğrisinin örnekleri döndürülmüş kapak kenarının (y = −k·(x/16)², sonra döndürme, sonra öteleme) üstünde kalmalı.
    for (const s of [-1, 1]) for (const dd of DURUMLAR) {
      const aci = (hedef(dd, s, sk).rot * Math.PI) / 180;
      const k = sk.lidK * (16 / 30) ** 2;
      for (const [x, y] of egriOrnekleri(govdeYolu(sk, s))) {
        const xl = x / Math.cos(aci);
        const kenar = kapakY(1) + xl * Math.sin(aci) - k * (xl / 16) ** 2 * Math.cos(aci);
        assert.ok(y < kenar, `${ad} ${dd}: kapalı kapak (${hedef(dd, s, sk).rot}°) (${x.toFixed(2)}, ${y.toFixed(2)}) noktasını örter (kenar ${kenar.toFixed(2)})`);
      }
    }
  }
  assert.notEqual(SEKILLER.odak.govde, SEKILLER.pamuk.govde, 'Odak\'ın gövdesi Pamuk\'tan farklı');
  assert.notEqual(SEKILLER.odak.lidK, SEKILLER.pamuk.lidK, 'Odak\'ın kapak kenarı daha düz');
  assert.ok(SEKILLER.odak.lidK < 3, 'düz kenarlı kapak');
});

test('Odak hâlleri: içe eğik kapak (odak), dinlerken açılır, düşünürken kısılır; hata üzgün (kızgın değil); uykuda düz ve kapalı', () => {
  const O = SEKILLER.odak;
  const b = hedef('bosta', 1, O);
  assert.ok(b.p >= 0.12 && b.p <= 0.3, `boşta kapak biraz iner: ${b.p}`);
  assert.ok(b.rot < -4 && b.rot > -12, `iç köşe aşağı (sağ gözde eksi): ${b.rot}`);
  assert.equal(hedef('bosta', -1, O).rot, -b.rot, 'sol göz aynası');
  assert.ok(hedef('dinliyor', 1, O).p < b.p, 'dinlerken kapak kalkar');
  assert.ok(hedef('dusunuyor', 1, O).p > b.p, 'düşünürken daha çok odaklanır');
  assert.ok(hedef('dusunuyor', 1, O).q > 0 && hedef('dusunuyor', -1, O).q > 0, 'alttan kısılır');
  // Hata Pamuk'la aynı yönde: dış köşe düşer (üzgün). İç köşe aşağı (kızgın) olmaz.
  assert.ok(hedef('hata', 1, O).rot > 0);
  assert.equal(hedef('mutlu', 1, O).q, 1, 'mutlu ^ ^ kalır');
  assert.ok(Math.abs(hedef('mutlu', 1, O).rot) <= 3, 'mutluyken kaş gevşer');
  assert.deepEqual({ p: hedef('uyuyor', 1, O).p, rot: hedef('uyuyor', 1, O).rot }, { p: 1, rot: 0 });
  // Bebek yuvarlak ve iri kalır (yarık değil; dostça): ölçek 0,8'den küçük değil, Pamuk'tan biraz küçük.
  for (const dd of DURUMLAR) {
    const o = olcek(hedef(dd, 1, O).bebek);
    assert.ok(o >= 0.8 && o < olcek(hedef(dd, 1).bebek), `${dd}: bebek ${o}`);
  }
  // Kapak her hâlde bebeği kesmez: kenar bebeğin tepesinin üstünde kalır (boşta; bakış ortada).
  const bebekTepe = 2.1 - 7.3 * olcek(b.bebek);
  const icKenar = kapakY(b.p) + 12.6 * Math.sin((-b.rot * Math.PI) / 180);
  assert.ok(icKenar < bebekTepe + 1.5, `kapak bebeğin tepesinde: kenar ${icKenar}, bebek ${bebekTepe}`);
});

test('kapalı yay her biçimde aynı (takasta yay sıçramaz)', () => {
  for (const sk of Object.values(SEKILLER)) assert.equal(sk.kapali ?? KAPALI_YOL, KAPALI_YOL);
});

// ── Hareket beyni ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Kayit { el: string; tur: 'diz' | 'dongu'; oz: string; kareler: readonly (Kare | DonguKaresi)[]; sure: number; gecik: number; tekrar?: number; an: number }
class SahteSaat implements Saat {
  t = 0;
  private n = 0;
  private z = new Map<number, { an: number; fn: () => void }>();
  simdi() { return this.t; }
  kur(fn: () => void, ms: number) { const id = ++this.n; this.z.set(id, { an: this.t + ms, fn }); return id; }
  iptal(id: unknown) { this.z.delete(id as number); }
  get bekleyen() { return this.z.size; }
  ilerle(ms: number) {
    const son = this.t + ms;
    for (;;) {
      let en: [number, { an: number; fn: () => void }] | null = null;
      for (const g of this.z) if (g[1].an <= son && (!en || g[1].an < en[1].an)) en = g;
      if (!en) break;
      this.z.delete(en[0]);
      this.t = en[1].an;
      en[1].fn();
    }
    this.t = son;
  }
}

function kur(o: { canli?: boolean; az?: boolean; sekil?: GozSekliAdi; rastgele?: () => number } = {}) {
  const saat = new SahteSaat();
  const kayit: Kayit[] = [];
  const kapakF = new Map<string, number>();
  const can: Canlandirici<string> = {
    diz(el, oz, kareler, sure, gecik = 0) {
      kayit.push({ el, tur: 'diz', oz, kareler, sure, gecik, an: saat.t });
      if (oz === 'transform' && el.startsWith('kapak')) {
        const m = /translate\(0px, (-?[\d.]+)px\)/.exec(kareler[kareler.length - 1].v);
        if (m) kapakF.set(el, Number(m[1]));
      }
    },
    dongu(el, kareler, x) { kayit.push({ el, tur: 'dongu', oz: 'transform', kareler, sure: x.sure, gecik: x.gecik, tekrar: x.tekrar, an: saat.t }); },
    kapakF: (el) => kapakF.get(el) ?? kapakY(0),
  };
  const goz = (s: number): GozOgeleri<string> => {
    const y = s > 0 ? 'sag' : 'sol';
    return { s, bakis: `bakis-${y}`, durum: `durum-${y}`, dongu: `dongu-${y}`, bebek: `bebek-${y}`, bebekDurum: `bebekDurum-${y}`, yanak: `yanak-${y}`, kapak: `kapak-${y}`, kapali: `kapali-${y}` };
  };
  let sk: GozSekliAdi = o.sekil ?? 'pamuk';
  const takaslar: { ad: GozSekliAdi; an: number }[] = [];
  const b = new GozBeyni<string>({
    gozler: [goz(-1), goz(1)], cift: 'cift', kok: 'kok', can, saat, rastgele: o.rastgele ?? (() => 0.5), az: () => o.az ?? false, birimPx: () => 0.6,
    canli: o.canli ?? true, sekil: () => SEKILLER[sk], sekilUygula: (ad) => takaslar.push({ ad, an: saat.t }),
  });
  return { b, saat, kayit, takaslar, sekilYap: (x: GozSekliAdi) => { sk = x; } };
}
/** Kayıttaki kapak karelerinden t anındaki kapak konumu p (kırpma kareleri doğrusal yaklaşık). */
function kapakAn(kayit: Kayit[], el: string, t: number): number {
  const k = [...kayit].reverse().find((x) => x.el === el && x.oz === 'transform' && x.an <= t)!;
  const o = Math.min(1, (t - k.an) / Math.max(1, k.sure));
  const kareler = k.kareler as Kare[];
  const i = kareler.findIndex((x) => x.o >= o - 1e-9);
  const p = (v: string) => kapakP(Number(/translate\(0px, (-?[\d.]+)px\)/.exec(v)![1]));
  return p(kareler[Math.max(0, i)].v);
}

test('Odak ile başlayan göz: ilk hedefler Odak\'ın (kapak içe eğik)', () => {
  const { b, kayit } = kur({ sekil: 'odak', canli: false });
  b.baslat('bosta');
  b.istek('dinliyor');
  const k = kayit.find((x) => x.el === 'kapak-sag' && x.oz === 'transform')!;
  assert.equal((k.kareler.at(-1) as Kare).v, hedef('dinliyor', 1, SEKILLER.odak).kapak);
});

test('mod değişimi (Pamuk → Odak): zıplar, kırpar; biçim kırpmanın KAPALI anında takas edilir; açılış yeni biçimin kapağına', () => {
  for (const az of [false, true]) {
    const { b, saat, kayit, takaslar, sekilYap } = kur({ az });
    b.baslat('bosta');
    saat.ilerle(500);
    const n = kayit.length;
    sekilYap('odak');
    b.sekilDegisti();
    saat.ilerle(600);
    const yeni = kayit.slice(n);
    const kirp = yeni.find((x) => x.el === 'kapak-sag' && x.sure === MOD_KIRPMA_SURE);
    assert.ok(kirp, `${az ? 'az' : 'tam'}: kırptı`);
    assert.equal(yeni.some((x) => x.el === 'cift'), !az, 'zıplama yalnız tam harekette');
    assert.equal((kirp.kareler.at(-1) as Kare).v, hedef('bosta', 1, SEKILLER.odak).kapak, 'açılış Odak kapağına');
    assert.equal((kirp.kareler[0] as Kare).v, kapakT(1, 0), 'eski (Pamuk) eğimiyle kapanır');
    assert.equal((kirp.kareler[1] as Kare).v, kapakT(1, hedef('bosta', 1, SEKILLER.odak).rot), 'yeni eğime kapalıyken döner');
    assert.equal(takaslar.length, 1);
    assert.equal(takaslar[0].ad, 'odak');
    const K = modKirpmaKareleri(0);
    const kapali = [kirp.an + K[0].o * MOD_KIRPMA_SURE + 20, kirp.an + K[1].o * MOD_KIRPMA_SURE - 20];
    assert.ok(takaslar[0].an >= kapali[0] && takaslar[0].an <= kapali[1], `takas kapalı anda: ${takaslar[0].an} ∈ ${kapali}`);
    assert.equal(kapakAn(kayit, 'kapak-sag', takaslar[0].an), 1, 'takas anında kapak kapalı');
    // Bebek ve yanak takastan sonra yeni hedefe süzülür; geçiş zıplama bitmeden (480 ms) biter: ModGecisi'nden sonra takılan canlı göz sıçramaz.
    const bebekK = yeni.filter((x) => x.el === 'bebekDurum-sag');
    assert.ok(bebekK.length);
    for (const x of bebekK) assert.ok(x.an + x.sure <= kirp.an - 120 + 480, `bebek geçişi 480 ms içinde: ${x.an + x.sure}`);
    assert.equal((bebekK.at(-1)!.kareler.at(-1) as Kare).v, hedef('bosta', 1, SEKILLER.odak).bebek);
    for (const x of yeni) assert.ok(x.oz === 'transform' || x.oz === 'opacity');
  }
});

test('durağan göz (ModGecisi) de biçimi kırpmayla değiştirir; geri dönüş (Odak → Pamuk) aynı', () => {
  const { b, saat, kayit, takaslar, sekilYap } = kur({ canli: false, sekil: 'odak' });
  b.baslat('bosta');
  sekilYap('pamuk');
  b.sekilDegisti();
  saat.ilerle(600);
  assert.deepEqual(takaslar.map((x) => x.ad), ['pamuk']);
  const kirp = kayit.find((x) => x.el === 'kapak-sag' && x.sure === MOD_KIRPMA_SURE)!;
  assert.equal((kirp.kareler.at(-1) as Kare).v, kapakT(0), 'Pamuk kapağı açık ve düz');
  assert.equal(b.bekleyen, 0, 'durağan göz geçişten sonra zamanlayıcı tutmaz');
});

test('uyurken mod değişimi: takas hemen (kapaklar kapalı), sonra uyanış yeni biçimle', () => {
  const { b, saat, kayit, takaslar, sekilYap } = kur();
  b.baslat('bosta');
  saat.ilerle(UYKU_MS + UYKU_SURE + 2000);
  assert.ok(b.uyku);
  sekilYap('odak');
  const n = kayit.length;
  b.sekilDegisti();
  assert.equal(takaslar.length, 1);
  assert.equal(takaslar[0].an, saat.t, 'kapalı gözde hemen');
  const uyanis = kayit.slice(n).find((x) => x.el === 'kapak-sag' && x.sure === 1600);
  assert.ok(uyanis, 'uyanır');
  assert.equal((uyanis.kareler.at(-1) as Kare).v, hedef('bosta', 1, SEKILLER.odak).kapak);
});

test('Odak uyku dizisi: 60 sn, yarıya düşme + iki yavaş kırpma + kapanma, kaş gevşer (döndürme 0), ≤ 6 nefes, sonra hiçbir şey', () => {
  const { b, saat, kayit } = kur({ sekil: 'odak' });
  b.baslat('bosta');
  saat.ilerle(UYKU_MS + 50);
  assert.ok(b.uyku);
  const kapak = kayit.find((x) => x.el === 'kapak-sag' && x.sure === UYKU_SURE)!;
  assert.ok(kapak);
  const ps = (kapak.kareler as Kare[]).map((k) => Number(kapakP(Number(/translate\(0px, (-?[\d.]+)px\)/.exec(k.v)![1])).toFixed(2)));
  assert.deepEqual(ps, [0.45, 0.47, 1, 1, 0.55, 0.6, 1, 1, 0.72, 0.73, 1]);
  assert.match((kapak.kareler.at(-1) as Kare).v, /rotate\(0deg\)/);
  saat.ilerle(UYKU_TOPLAM_MS + 100);
  const kokYazim = kayit.filter((x) => x.el === 'kok' && x.sure === 0 && x.an > kapak.an);
  assert.ok(kokYazim.length <= NEFES_SAYI * (nefesKareleri(0.6).length - 1) + 1);
  assert.equal(b.bekleyen, 0);
  const once = kayit.length;
  saat.ilerle(120_000);
  assert.equal(kayit.length, once, 'nefesten sonra hiçbir şey çizilmez');
  assert.equal(saat.bekleyen, 0);
});

test('Odak bakışı: daha sabit ve dar (dikey bant küçük), satır okur gibi soldan sağa küçük adımlar', () => {
  // Rastgele dizisi: okuma başlatan değerler.
  let i = 0;
  const seri = [0.5, 0.1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]; // ilk değer kırpma planının
  const { b, saat, kayit } = kur({ sekil: 'odak', rastgele: () => seri[i++ % seri.length] });
  b.baslat('bosta');
  saat.ilerle(12_000);
  const bakislar = kayit.filter((x) => x.el === 'bebek-sag').map((x) => (x.kareler.at(-1) as Kare).v)
    .map((v) => /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(v)!).map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
  assert.ok(bakislar.length >= 4, `bakış sayısı ${bakislar.length}`);
  for (const p of bakislar) assert.ok(Math.abs(p.y) <= 1.2, `dikey bant dar: ${p.y}`);
  // En az üç ardışık sağa küçük adım (okuma).
  let enUzun = 0; let seri2 = 0;
  for (let k = 1; k < bakislar.length; k++) {
    const dx = bakislar[k].x - bakislar[k - 1].x;
    seri2 = dx > 0.4 && dx < 2.2 ? seri2 + 1 : 0;
    enUzun = Math.max(enUzun, seri2);
  }
  assert.ok(enUzun >= 3, `okuma adımları: ${enUzun}`);
});

test('Pamuk bakışı değişmedi (aynı rastgele dizide aynı hareket)', () => {
  const a = kur({ sekil: 'pamuk' });
  a.b.baslat('bosta'); a.saat.ilerle(8000);
  const ilk = a.kayit.filter((x) => x.el === 'bebek-sag').map((x) => (x.kareler.at(-1) as Kare).v);
  assert.ok(ilk.length > 1);
  assert.equal(ilk[0], 'translate(-3.3px, 0.1px)');
});

// ── Bileşen ve CSS ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('Gozler iki biçimin katmanlarını çizer, data-sekil ile seçer; takas beyinden (kırpmanın kapalı anı); CSS yalnız opacity', () => {
  const tsx = fs.readFileSync(path.join(kok, 'src/renderer/ui/goz/Gozler.tsx'), 'utf8');
  const css = fs.readFileSync(path.join(kok, 'src/renderer/ui/goz/goz.css'), 'utf8');
  assert.match(tsx, /data-sekil/);
  assert.match(tsx, /data-katman/);
  assert.match(tsx, /kipSekli/);
  assert.match(tsx, /sekilUygula/);
  assert.match(tsx, /sekilDegisti/);
  for (const ad of Object.keys(SEKILLER)) assert.match(css, new RegExp(`data-sekil='${ad}'\\] \\[data-katman='${ad}'\\]`), `${ad} katmanı CSS'te`);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /transition:\s*(?!opacity|none)[a-z-]+/, 'geçiş yalnız opacity');
});

test('duruş devri: ModGecisi ↔ canlı göz yeniden takılırken bakış ve kapak sıçramaz (kare kare denetimde bulundu); sohbet avatarı katılmaz', () => {
  const tsx = fs.readFileSync(path.join(kok, 'src/renderer/ui/goz/Gozler.tsx'), 'utf8');
  const mg = fs.readFileSync(path.join(kok, 'src/renderer/ui/goz/ModGecisi.tsx'), 'utf8');
  assert.match(tsx, /function devirBirak/);
  assert.match(tsx, /function devirAl/);
  assert.match(tsx, /canli \|\| devir \?/, 'yalnız canlı ve devir\'li göz katılır');
  assert.match(mg, /<Gozler [^>]*\bdevir\b/);
  assert.doesNotMatch(fs.readFileSync(path.join(kok, 'src/renderer/bilesenler/Sohbet.tsx'), 'utf8'), /<Gozler [^>]*\bdevir\b/);
});
