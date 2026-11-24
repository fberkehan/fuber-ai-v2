// 0.13 T6 (spec A, B, C): kullanıcı metninde kip adları ve ses seçiminin kalkması.
//  - Kaynak taraması: src/renderer, src/shared ve src/main'in kullanıcıya görünen dizgelerinde (yorum dışı; TypeScript AST'sinden string/şablon/JSX
//    metni) 'İş' / 'Geliştirici' kip adı geçmez: kip adları KIP_ADI'ndan okunur ("Business mode", "Developer mode"). İç değerler ('is',
//    'gelistirici') değişmez.
//  - Ses seçimi yok: Ayarlar'da ve Kurulum'da ses listesi çizilmez; kayıtlı `ses.elevenSes` ve kullanıcı ElevenLabs anahtarı satırı okunmaz/kalktı.
//  - Konuşma, turun başında kilitlenen kipin sesiyle sürer (basladi olayı → fuberKonus({ kip }) → ses:konus-baslat → SesMerkezi.baslat).
//  - Kurulum: tamamla gövdesi son modu da taşır; Hazırsın yerel sesin inmediğini düz söyler; "Sesli konuşma" kapalıyken ses indirilmez.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { YONETIM_VAR } from './yardimci/ozel.ts';
import ts from 'typescript';
import { SesMerkezi, type SesAyarlari, type YedekSes, type HesapSesi } from '../src/main/ses/merkez.ts';
import { sesSec, YEDEK_SES } from '../src/shared/ses-kimligi.ts';
import { SesliYanit } from '../src/shared/sesli-yanit.ts';

import * as karakterler from '../src/shared/karakterler.ts';
import type { KipKimligi } from '../src/shared/karakterler.ts';
import * as taslak from '../src/shared/kurulum-taslak.ts';
import { KATEGORILER } from '../src/renderer/ayarlar/dizin.ts';

const { KIP_ADI } = karakterler;
const { kipTemizle } = karakterler as unknown as { kipTemizle: (x: unknown) => KipKimligi | undefined };
const { kurulumTamamlaGovdesi, taslakBaslangici, sesIndirilsinMi, sesOzeti, sesInmediNotu } = taslak as unknown as Record<string, (...a: any[]) => any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const kok = path.resolve(import.meta.dirname, '..');
const kaynak = (g: string) => fs.readFileSync(path.join(kok, g), 'utf8');
function dosyalar(d: string): string[] {
  return fs.readdirSync(path.join(kok, d), { withFileTypes: true }).flatMap((e) => {
    const g = `${d}/${e.name}`;
    return e.isDirectory() ? dosyalar(g) : /\.tsx?$/.test(e.name) ? [g] : [];
  });
}
/** Dosyadaki kullanıcıya görünebilecek dizgeler (string, şablon parçası, JSX metni) ve tanımlayıcılar; yorumlar AST'de yoktur. */
function dizgeler(g: string): { satir: number; metin: string }[] {
  const sf = ts.createSourceFile(g, kaynak(g), ts.ScriptTarget.Latest, true, g.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const s: { satir: number; metin: string }[] = [];
  const gez = (n: ts.Node): void => {
    const metin = ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) || n.kind === ts.SyntaxKind.JsxText ? (n as ts.StringLiteral).text : null;
    if (metin) s.push({ satir: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, metin });
    ts.forEachChild(n, gez);
  };
  gez(sf);
  return s;
}
function tanimlayicilar(g: string): Set<string> {
  const sf = ts.createSourceFile(g, kaynak(g), ts.ScriptTarget.Latest, true, g.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const s = new Set<string>();
  const gez = (n: ts.Node): void => { if (ts.isIdentifier(n)) s.add(n.text); ts.forEachChild(n, gez); };
  gez(sf);
  return s;
}

// Kip adı olarak kullanılan 'İş' / 'Geliştirici' (tam dizge), "İş modu", "geliştirici modunda", "İş'te", "Geliştirici görünümü"…
const KIP_ADI_KALINTISI = /^\s*(İş|Geliştirici)\s*$|(?<![\p{L}])(İş|iş|Geliştirici|geliştirici) mod(u|un|unda|a|da)?(?![\p{L}])|(?<![\p{L}])(İş|Geliştirici)['’]|Geliştirici (görünüm|kipi|sürümü)/u;
/** Kip değil, meslek: eski sihirbazın rol özeti ("Rolü: Geliştirici"). */
const MESLEK = [{ dosya: 'src/shared/kurulum-adimlari.ts', metin: 'Geliştirici' }];

test('kullanıcı dizgelerinde kip adı "İş" / "Geliştirici" kalmadı (renderer, shared, main); adlar KIP_ADI\'ndan okunur', () => {
  const ihlal: string[] = [];
  for (const g of ['src/renderer', 'src/shared', 'src/main'].flatMap(dosyalar)) {
    for (const d of dizgeler(g)) {
      if (!KIP_ADI_KALINTISI.test(d.metin)) continue;
      if (MESLEK.some((m) => g === m.dosya && d.metin === m.metin)) continue;
      ihlal.push(`${g}:${d.satir}: ${d.metin.replace(/\s+/g, ' ').slice(0, 100)}`);
    }
  }
  assert.deepEqual(ihlal, []);
  assert.deepEqual(KIP_ADI, { is: 'Business mode', gelistirici: 'Developer mode' });
  // Ayarlar → Kullanım biçimi ve Genel'in mod kartları adı KIP_ADI'ndan okur.
  assert.match(kaynak('src/renderer/ayarlar/Genel.tsx'), /KIP_ADI/);
  assert.match(kaynak('src/renderer/ayarlar/dizin.ts'), /KIP_ADI/);
  const mod = KATEGORILER.flatMap((k) => k.gruplar).find((g) => g.id === 'mod')!;
  assert.match(`${mod.aciklama} ${mod.ayarlar.map((a) => a.aciklama).join(' ')}`, /Business mode.*Developer mode|Developer mode.*Business mode/);
  assert.equal(mod.ozet?.({ mod: 'is' } as never), 'Business mode');
  assert.equal(mod.ozet?.({ mod: 'gelistirici' } as never), 'Developer mode');
});

// 0.13 son düzeltme 9: kullanıcı metninde "kip" yok, "mod" var ("Business mode" ile tutarlı). Tanımlayıcılar ve iç değerler (`kip`, `modKip`, 'data-kip') kalır.
const KIP_SOZU = /(?<![\p{L}\p{N}_-])[Kk]ip(?:i|e|te|ten|in|ini|inde|ine|inin|ler|leri|lerde|lerin|li)?(?![\p{L}\p{N}_-])/u;
/** Sözcük değil, iç değer: dizge yalnız tanımlayıcıdır (JSON alanı), içe aktarma yoludur ya da SQL deyimidir (0.14 T30: `mesajlar.kip` sütunu). */
const IC_DEGER = /^kip$|^\.\.?\/|^(?:INSERT|ALTER|SELECT|UPDATE|CREATE|PRAGMA)\b/;

test('0.13 son düzeltme 9: kullanıcıya görünen dizgelerde "kip" sözü kalmadı (renderer, shared, main, Yönetim); senaryo videolarının ekran başlıkları da', () => {
  const ihlal: string[] = [];
  // Açık kaynak hazırlığı: Yönetim klasörleri yalnız özel depoda (tests/yardimci/ozel.ts).
  for (const g of ['src/renderer', 'src/shared', 'src/main', ...(YONETIM_VAR ? ['yonetim/renderer', 'yonetim/shared'] : [])].flatMap(dosyalar)) {
    for (const d of dizgeler(g)) {
      if (!KIP_SOZU.test(d.metin) || IC_DEGER.test(d.metin.trim())) continue;
      ihlal.push(`${g}:${d.satir}: ${d.metin.replace(/\s+/g, ' ').slice(0, 110)}`);
    }
  }
  assert.deepEqual(ihlal, []);
  assert.match(kaynak('src/renderer/bilesenler/KipAnahtari.tsx'), /aria-label="Mod"/);
  // Senaryo videolarının ekrandaki başlıkları (s1.adim / s2.adim / s3.adim, videoYaz).
  // scripts/e2e (FUBERAI arka ucunu kuran uçtan uca betikler) yalnız özel depoda.
  if (fs.existsSync(path.join(import.meta.dirname, '..', 'scripts/e2e/senaryo-videolari.mjs'))) {
    const v = kaynak('scripts/e2e/senaryo-videolari.mjs');
    const basliklar = [...v.matchAll(/\b(?:s[123]\.adim|videoYaz)\(([^\n]+)\)/g)].map((m) => m[1]);
    assert.ok(basliklar.length >= 10, 'başlıklar okundu');
    assert.deepEqual(basliklar.filter((b) => KIP_SOZU.test(b)), []);
  }
});

test('ses seçimi yok: Ayarlar\'da ve Kurulum\'da ses listesi, kullanıcı sesi ve ElevenLabs anahtarı satırı çizilmez', () => {
  const ayarlar = KATEGORILER.flatMap((k) => k.gruplar.flatMap((g) => g.ayarlar));
  for (const id of ['ses-secimi', 'elevenlabs-anahtar']) assert.ok(!ayarlar.some((a) => a.id === id), id);
  assert.ok(ayarlar.some((a) => a.id === 'ses-saglayici'), 'şu anki karakterin sesi kartı kalır');
  const ses = kaynak('src/renderer/ayarlar/SesSecimi.tsx');
  assert.doesNotMatch(ses, /SesSecimiSatiri|AnahtarSatiri|ses:sesler|elevenlabs-anahtar|api:elevenlabs|<Secici/);
  assert.match(ses, /Şu anki karakterin sesi/);
  assert.match(ses, /DinleDugmesi/);
  assert.match(ses, /YedekSesSatiri/);
  assert.match(ses, /HizSatiri/);
  // Kaldırılan kod: hazır ses listesi, kullanıcının seçtiği ses (kayıtlı değer okunmaz).
  for (const g of ['src/renderer', 'src/shared', 'src/main'].flatMap(dosyalar)) {
    const t = tanimlayicilar(g);
    for (const ad of ['HAZIR_SESLER', 'elevenSes', 'secilenSes', 'sesleriListele', 'elevenAnahtar', 'FUBER_SESI', 'sesBul']) assert.ok(!t.has(ad), `${g}: ${ad}`);
  }
  const kurulum = ['src/renderer/kurulum2/adimlar/Ses.tsx', 'src/renderer/kurulum/SesAdimi.tsx'].map(kaynak).join('\n');
  assert.doesNotMatch(kurulum, /ses:sesler|<Secici|elevenSes/);
});

test('0.12\'den kalan anahtar bağımlılıkta olsa da SesMerkezi hesabın sesiyle konuşur ve Scribe açmaz', async () => {
  const { m, cagri } = merkezKur({ eskiAnahtar: true });
  assert.deepEqual(m.kimlik(), { motor: 'elevenlabs', sesId: 'x', hesap: true });
  assert.equal(m.yaziyaMotoru(), 'hesap');
  await konus(m, {});
  assert.deepEqual(cagri.map((c) => c.kip), ['business'], 'karakterin sesi çaldı (Piper/ElevenLabs anahtarı değil)');
});

test('sir:yaz ElevenLabs anahtarı yazdırmaz (kullanıcı anahtar girmez); silmek serbest', async () => {
  // 0.14: kural saf modülde (main/sir-izni.ts); ipc.ts sir:yaz onu çağırır. Yalnız Developer'da Anthropic istisnası.
  assert.match(kaynak('src/main/ipc.ts'), /sirYazmaReddi\(ad, deger, ayarlar\(\)\.mod\)/);
  assert.match(kaynak('src/main/sir-izni.ts'), /\^api:\(anthropic\|openai\|openrouter\|fuber\|elevenlabs\)\$/);
  const { sirYazmaReddi } = await import('../src/main/sir-izni.ts');
  for (const mod of ['is', 'gelistirici'] as const) {
    // Açık kaynak hazırlığı (11 Kas): 'api:openai' kendi OpenAI uyumlu sağlayıcının yuvası olarak yazılır (biçim denetimiyle).
    assert.equal(sirYazmaReddi('api:openai', 'xyz-1234567890abcdef', mod), null, `openai/${mod} yazılır`);
    for (const s of ['elevenlabs', 'openrouter', 'fuber']) {
      assert.ok(sirYazmaReddi(`api:${s}`, 'xyz-1234567890abcdef', mod), `${s}/${mod} reddedilir`);
      assert.equal(sirYazmaReddi(`api:${s}`, null, mod), null, `${s}/${mod} silmek serbest`);
    }
  }
});

// ── Konuşma: turun başında kilitlenen kip ─────────────────────────────────────────────────────────────────────────────────────────────
const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));
function merkezKur(o: { eskiAnahtar?: boolean } = {}) {
  const cagri: { kip: KipKimligi }[] = [];
  let simdiki: KipKimligi = 'business';
  const hesap: HesapSesi = {
    kullanilir: () => true, yaziyaKullanilir: () => true, sesId: () => 'x', kip: () => simdiki,
    async seslendir(metin, kip) { cagri.push({ kip }); return new TextEncoder().encode(`MP3:${metin}`); },
    async yaziya() { return null; },
    async yaziyaBelirteci() { return null; },
    async yaziyaSure() { /* canlı dikte bu testte yok */ },
  };
  const yedek: YedekSes = { hazirMi: () => true, async *pcm() { yield new Uint8Array(4410); } };
  const ayar: SesAyarlari = { hiz: 1, dil: 'tr', bulutsuz: false };
  const m = new SesMerkezi({ ayar: () => ayar, yedek, hesap, zamanlar: { tekrarMs: 10, ilkZorlaMs: 50 }, ...(o.eskiAnahtar ? { elevenAnahtar: () => 'eski-anahtar', elevenTaban: () => 'http://127.0.0.1:9' } : {}) } as never);
  return { m, cagri, kipDegistir: (k: KipKimligi) => { simdiki = k; } };
}
async function konus(m: SesMerkezi, o: { kip?: KipKimligi }): Promise<void> {
  let coz: () => void = () => undefined;
  const bitti = new Promise<void>((c) => { coz = c; });
  const b = m.baslat('p', (x) => { if (x.tur === 'bitti' || x.tur === 'hata') coz(); }, { kaynak: 'yanit', ...o });
  assert.ok(b);
  m.ekle(b!.id, 'Merhaba, nasılsın? '); m.bitir(b!.id);
  await bitti;
}

test('konuşma turun kipiyle başlar: kip verilirse şu anki kipe değil o kipe bakar; verilmezse şu anki kip', async () => {
  const { m, cagri, kipDegistir } = merkezKur();
  kipDegistir('developer'); // kullanıcı yanıt sürerken Developer'a geçti
  await konus(m, { kip: 'business' }); // tur Business'ta başlamıştı: araç sonrası yeniden açılan konuşma da Business
  await konus(m, {});
  await konus(m, { kip: 'developer' });
  assert.deepEqual(cagri.map((c) => c.kip), ['business', 'developer', 'developer']);
  await bekle(1);
});

test('turun İLK konuşması da kilitli kiple açılır: tembel SesliYanit basladi gelene dek açmaz; araç sonrası yeniden açılış aynı kipi taşır; metin basladi\'sız da sessiz kalmaz', () => {
  const acilan: (KipKimligi | undefined)[] = [];
  let turKipi: KipKimligi | undefined;
  const ac = () => { acilan.push(turKipi); return { ekle: () => undefined, bitir: () => undefined, kes: () => undefined, sesVar: true }; };
  // Eskiden: mesaj gönderilirken (kip henüz yok) açılırdı; ana süreç o an HESAP.KIP()'e bakar, tur kilidiyle yarışırdı.
  const s = new SesliYanit(ac, { tembel: true });
  assert.deepEqual(acilan, [], 'mesaj gönderilirken konuşma açılmaz');
  turKipi = 'developer'; // basladi.kip
  s.baslat(); s.baslat();
  assert.deepEqual(acilan, ['developer'], 'ilk konuşma turun kilitli kipiyle, bir kez');
  s.metin('Bakıyorum.'); s.aracOncesi(); // araç sonrası yeniden açılış
  assert.deepEqual(acilan, ['developer', 'developer']);
  s.kes();
  const t = new SesliYanit(ac, { tembel: true }); // basladi hiç gelmedi: metin gelince yine de açılır (kip: ana sürecin şu anki kipi)
  turKipi = undefined;
  t.metin('Merhaba.');
  assert.deepEqual(acilan, ['developer', 'developer', undefined]);
  new SesliYanit(ac); // varsayılan: eski davranış (hemen açılır)
  assert.equal(acilan.length, 4);
  new SesliYanit(ac, { tembel: true }).kes(); // açılmamış konuşmayı kesmek/bitirmek güvenli
});

test('SesSecimi: yerel (Piper) motorda karakter başlığı ses diye gösterilmez, bu bilgisayarın sesi düz söylenir', () => {
  const ses = kaynak('src/renderer/ayarlar/SesSecimi.tsx');
  assert.match(ses, /b\.motor === 'yerel' \? 'Bu bilgisayarın sesi kullanılıyor'/);
});

test('kipTemizle: yalnız iki geçerli kip; öteki her şey undefined (arayüzden gelen değere güvenilmez)', () => {
  assert.equal(kipTemizle('business'), 'business');
  assert.equal(kipTemizle('developer'), 'developer');
  for (const x of ['is', 'gelistirici', '', null, undefined, 3, {}, 'Developer']) assert.equal(kipTemizle(x), undefined);
});

test('turun kipi arayüzden ana sürece taşınır: basladi.kip → fuberKonus({ kip }) → ses:konus-baslat → konusmaBaslat → baslat', () => {
  const sesi = kaynak('src/renderer/fuber-sesi.ts');
  assert.match(sesi, /'ses:konus-baslat', \{ kaynak, kip \}/);
  assert.match(sesi, /export function fuberKonus\(kaynak: KonusmaKaynagi, kip\?: KipKimligi, satirSoyle\?: \(m: string\) => void\)/);
  assert.match(sesi, /export function fuberSoyle\(metin: string, kaynak: KonusmaKaynagi = 'bildirim', kip\?: KipKimligi\)/);
  const asistan = kaynak('src/renderer/ada/useAsistan.ts');
  assert.match(asistan, /turKipi\.current = o\.kip/);
  assert.match(asistan, /fuberKonus\('yanit', turKipi\.current, sesSatiri\)/);
  assert.match(asistan, /\{ tembel: true \}/, 'ilk konuşma mesaj gönderilirken değil, basladi\'da açılır');
  assert.match(asistan, /turKipi\.current = o\.kip; if \(sesliSoruldu\.current\) yanitSesi\.current\?\.baslat\(\)/);
  const sohbet = kaynak('src/renderer/bilesenler/Sohbet.tsx');
  assert.match(sohbet, /turKipi\.current = o\.kip/);
  assert.match(sohbet, /fuberKonus\('sohbet', turKipi\.current, setHata\)/);
  assert.match(sohbet, /new SesliYanit\(ac, \{ tembel: true \}\)/);
  assert.match(sohbet, /turKipi\.current = o\.kip;\s+ses\?\.baslat\(\)/);
  const ana = kaynak('src/main/ses.ts');
  assert.match(ana, /kip: kipTemizle\(o\?\.kip\)/);
  assert.doesNotMatch(ana, /o\?\.sesId/, 'arayüzden ses kimliği alınmaz');
  // "Dinle": kurulumda seçilen kipin sesi, Ayarlar'da şu anki kip.
  assert.match(kaynak('src/renderer/kurulum2/adimlar/Ses.tsx'), /fuberSoyle\(dinlemeSozu\(karakter\.ad, siz\), 'onizleme', modKip\(t\.mod\)\)/);
  assert.match(kaynak('src/renderer/ayarlar/SesSecimi.tsx'), /fuberSoyle\(dinlemeSozu\(ad\), 'onizleme', kip\)/);
});

test('0.13 son düzeltme 12: "Yanıtları sesli oku" söz vermez: bulut yanıtı tek parça dönerken "yazarken cümle cümle" doğru değil', () => {
  const s = KATEGORILER.flatMap((k) => k.gruplar.flatMap((g) => g.ayarlar)).find((a) => a.id === 'seslendirme')!;
  assert.equal(s.aciklama, 'Sesle sorduğunda yanıtı Fuber sesli okur.');
  assert.doesNotMatch(`${s.aciklama} ${s.aciklamaIs ?? ''}`, /yazarken|cümle cümle/);
});

test('0.13 son düzeltme 8: sayfaya dönünce süren yanıtın başı "Fuber" demez, ayardaki modun karakterine düşer; sohbet değişince eski ad kalmaz', () => {
  const s = kaynak('src/renderer/bilesenler/Sohbet.tsx');
  assert.match(s, /<FuberBasi karakter=\{canliKarakter \|\| karakter\} kip=\{canliKip\} suruyor=\{calisiyor\} \/>/, 'kilitli ad yoksa ayardaki modun karakteri (0.14 T30: kip de aynı kuralla)');
  assert.match(s, /const \{ serit, gonderimKapali, gizli, aracsiz, karakter \} = useSohbetSeridi\(\);/);
  assert.match(s, /setCanli\(null\); setCanliKarakter\(''\); setHata\(''\)/, 'başka sohbete geçince kilit düşer');
  assert.match(kaynak('src/renderer/bilesenler/SohbetSeridi.tsx'), /const karakter = m\.a \? etkinKarakter\(m\.mod, m\.a\.hesap\?\.karakterler\)\.ad : '';/, 'tek abonelik: ikinci useMotorSinyali yok');
});

test('0.13 son düzeltme 7: Yazıcı\'nın bilgi satırı tek sayaçlı: eski sayaç yeni uyarıyı erken silmez, söküldüğünde de işlemez', () => {
  const s = kaynak('src/renderer/bilesenler/Sohbet.tsx');
  assert.match(s, /const bilgiVer = \(m: string, sure = 5000\) => \{ setBilgi\(m\); bilgiSayaci\.kur\(\(\) => setBilgi\(''\), sure\); \};/);
  assert.doesNotMatch(s, /setTimeout\(\(\) => setBilgi/);
  assert.match(s, /bilgiSayaci\.iptal\(\); setBilgi\('yazıya çevriliyor…'\);/, 'süren "yazıya çevriliyor…" satırını eski sayaç silmez');
  assert.match(s, /return \(\) => \{ sokuldu\.current = true; dikteRef\.current\?\.iptal\(\); bilgiSayaci\.iptal\(\); \};/);
});

// ── Kurulum: son mod ve yerel ses ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('kurulumTamamlaGovdesi son modu da taşır (kart kaydı fire-and-forget; tamamla yarışta kalmaz); ana süreç geçersiz değeri yazmaz', () => {
  const t = taslakBaslangici({}, 'ilk');
  assert.equal(kurulumTamamlaGovdesi(t).mod, 'is');
  assert.equal(kurulumTamamlaGovdesi({ ...t, mod: 'gelistirici' }).mod, 'gelistirici');
  assert.match(kaynak('src/main/ipc.ts'), /v\.mod === 'is' \|\| v\.mod === 'gelistirici'/);
});

test('Hazırsın: yerel ses seçili ama inmediyse düz söyler; "Sesli konuşma" kapalıysa 86 MB indirilmez, özet bunu söyler', () => {
  const g = { seslendirme: true, bilgisayardan: true, kurulu: false };
  assert.equal(sesIndirilsinMi(g), true);
  assert.equal(sesIndirilsinMi({ ...g, seslendirme: false }), false, 'sesli konuşma kapalı: indirme yok');
  assert.equal(sesIndirilsinMi({ ...g, kurulu: true }), false);
  assert.equal(sesIndirilsinMi({ ...g, bilgisayardan: false }), false, 'karakterin sesi bulutta: indirme yok');
  assert.match(sesInmediNotu(g) ?? '', /inmedi/);
  assert.match(sesInmediNotu({ ...g, yuzde: 40 }) ?? '', /iniyor/);
  assert.match(sesInmediNotu({ ...g, hata: true }) ?? '', /inemedi/);
  for (const n of [sesInmediNotu(g), sesInmediNotu({ ...g, hata: true })]) assert.match(n ?? '', /yazı/, 'inene kadar ne olacağı söylenir');
  assert.equal(sesInmediNotu({ ...g, kurulu: true }), null);
  assert.equal(sesInmediNotu({ ...g, seslendirme: false }), null, 'ses kapalıyken eksik ses uyarısı yok');
  assert.equal(sesInmediNotu({ ...g, bilgisayardan: false }), null);
  assert.equal(sesOzeti('Tilki', { ...g, seslendirme: false }), 'Sesli konuşma kapalı');
  assert.equal(sesOzeti('Tilki', { ...g, bilgisayardan: false }), 'Tilki');
  assert.equal(sesOzeti('Tilki', { ...g, kurulu: true }), 'Bu bilgisayarın sesi');
  assert.match(sesOzeti('Tilki', g), /Bu bilgisayarın sesi · henüz inmedi/);
  assert.match(sesOzeti('Tilki', { ...g, yuzde: 40 }), /%40 iniyor/);
  // Adımdan çıkarken indirme ve Hazırsın aynı kuralı okur.
  assert.match(kaynak('src/renderer/kurulum2/Kurulum2.tsx'), /sesIndirilsinMi\(/);
  const hazirsin = kaynak('src/renderer/kurulum2/adimlar/Hazirsin.tsx');
  assert.doesNotMatch(hazirsin, /useSesBilgisi|useYerelSesDurumu/, 'ses bilgisi tek abonelikten (bağlam) gelir');
  assert.equal((kaynak('src/renderer/kurulum2/Kurulum2.tsx').match(/useSesBilgisi\(\)/g) ?? []).length, 1);
  assert.doesNotMatch(kaynak('src/renderer/kurulum2/adimlar/Ses.tsx'), /useSesBilgisi\(\)/);
  assert.match(hazirsin, /sesInmediNotu\(/);
  assert.doesNotMatch(hazirsin, /sesOzeti\(/, '0.13.1: özet kartında Ses satırı yok; sesin hâlini sol sütundaki not söyler');
});

test('0.13 son düzeltme 4: kurulumda hesap onay bekliyorken "Dinle" yanlış ve çıkışsız değil: not gerçeği söyler, yerel ses yoksa "İndir ve dinle", rozet "Hazır" demez', () => {
  const { dinlemeDurumu } = taslak;
  const not = 'Hesabın onaylanınca sesimi duyacaksın.';
  const bekliyor = { bilgisayardan: false, hesapSesi: false, kurulu: false, hesapDurumu: 'bekliyor' as const };
  assert.deepEqual(dinlemeDurumu(bekliyor), { yerel: true, indir: true, not, rozet: 'Onay bekliyor' });
  assert.deepEqual(dinlemeDurumu({ ...bekliyor, kurulu: true }), { yerel: true, indir: false, not, rozet: 'Onay bekliyor' }, 'yerel ses kurulu: bugün o çalar, ama gerçek söylenir');
  // Karakterin sesi hazırsa ya da yol zaten yerelse eski akış.
  assert.deepEqual(dinlemeDurumu({ bilgisayardan: false, hesapSesi: true, kurulu: false, hesapDurumu: 'aktif' }), { yerel: false, indir: false, not: null, rozet: 'Hazır' });
  assert.deepEqual(dinlemeDurumu({ bilgisayardan: true, hesapSesi: false, kurulu: false, hesapDurumu: 'bekliyor' }), { yerel: true, indir: true, not: null, rozet: 'Kurulu değil' }, 'Gizli ve "Yalnız bu bilgisayar"da hesap beklenmez');
  assert.deepEqual(dinlemeDurumu({ bilgisayardan: true, hesapSesi: false, kurulu: true, hesapDurumu: null }), { yerel: true, indir: false, not: null, rozet: 'Hazır' });
  // Hesapsız kurulum: karakterin sesi yok; yerel ses kurulu değilse çıkış yine "İndir ve dinle", not gereksiz.
  assert.deepEqual(dinlemeDurumu({ bilgisayardan: false, hesapSesi: false, kurulu: false, hesapDurumu: null }), { yerel: true, indir: true, not: null, rozet: 'Kurulu değil' });
  // Öteki hesap hâlleri kendi nedenini söyler (sesDusuMetni).
  assert.match(dinlemeDurumu({ bilgisayardan: false, hesapSesi: false, kurulu: true, hesapDurumu: 'kredi-bitti' }).not ?? '', /Kullanım hakkın dolduğu için/);
  // Ekran kuralı bu kaynaktan okur: eski yanlış cümle yalnız yerel yolda kalır, yan panel de aynı durumu gösterir.
  const s = kaynak('src/renderer/kurulum2/adimlar/Ses.tsx');
  assert.match(s, /dinlemeDurumu\(\{/);
  assert.equal((s.match(/const dinleme = dinlemeHali\(baglam\)/g) ?? []).length, 2, 'adım ve yan panel aynı sonucu okur');
  assert.match(s, /dinleme\.indir \?/);
  assert.match(s, /data-ses-not=""/);
  assert.match(s, /caliyor \? 'Konuşuyor' : dinleme\.rozet/);
  assert.doesNotMatch(s, /'Hazır'/, 'rozet koddan sabit gelmez');
});

test('biçim: tipler.ts\'te "interface Atif{" kaymasi yok', () => {
  assert.doesNotMatch(kaynak('src/shared/tipler.ts'), /interface Atif\{/);
  assert.match(kaynak('src/shared/tipler.ts'), /export interface Atif \{/);
});
