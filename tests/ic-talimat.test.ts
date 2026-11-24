// G1 (F2): Fuber'in kendine verdiği iç talimat (proaktif tetik: MERAK, SABAH, AKSAM, "KURULUM BİTTİ…") hiçbir yüzeyde görünmez. Kural
// saf işlevlerde (src/shared/ic-talimat.ts): yankı bekçisi (model talimatı geri yazdı mı), hangi proaktif iş yerel/Gizli turda (araçsız)
// çalışabilir, Gizli'deki kısa tanışma talimatı ve proaktif turun hafıza yazıcısına giden nötr işaret. Uçtan uca yollar:
// tests/proaktif-yanki.test.ts (motor yankılarsa) ve tests/sohbet-liste-onizleme.test.ts (liste önizlemesi).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  icTalimatYankisiMi, proaktifIsYerelde, proaktifIsCalisirMi, tanismaTalimati, TANISMA_TALIMATI, TANISMA_TALIMATI_YEREL, PROAKTIF_HAFIZA_ISARETI,
  YEREL_OZET_NOTU, YEREL_MERAK_NOTU,
} from '../src/shared/ic-talimat.ts';
import fs from 'node:fs';
import path from 'node:path';
import { durdurmaKayitlari } from '../src/main/ajan/durdurma.ts';

// main/zamanlayici.ts'teki iç talimatların birebir kopyası (o modül Electron'a bağlı; uçtan uca test asıllarını kullanır).
const MERAK = `MERAK SORUSU: Kullanıcıyı daha iyi tanımak istiyorsun. Çekirdek hafızaya ve son hafıza kayıtlarına bak (hafiza_ara gerekirse); bilmediğin ama işine yarayacak önemli bir konu seç (projeleri, öncelikleri, çalışma alışkanlıkları, ekibi, hedefleri, tercihleri…). Daha önce sorduğun soruyu tekrar sorma (hafiza_ara "merak sorusu"). Sıcak ve kısa TEK bir soru yaz; neden sorduğunu yarım cümleyle söyleyebilirsin. Sonra hafiza_kaydet ile (tur: olay, baslik: "Merak sorusu", etiket "merak") hangi soruyu sorduğunu kaydet.`;
const SABAH = `SABAH ÖZETİ hazırla. Önce hatirlatici_listele (24 saat), gorev_listele ve bağlıysa eposta_listele (okunmamış) ile bugüne bak. Gün kaydı açıksa meseleler (açık; hedefi bugün/yarın olanlar) ve gun_raporu (gunluk, dün) ile dünden kalanlara da bak. Sonra kullanıcıya kısa, enerjik bir günaydın mesajı yaz: bugünün 1-3 önceliği, yaklaşan hatırlatıcılar, dikkat isteyen e-postalar, varsa tek bir öneri. Gerekirse kokpite "bugün" kartı koy (kokpit_kart id:"bugun", saat:14). 8 satırı geçme.`;

test('yankı bekçisi: talimatı aynen geri yazan yanıt yankıdır (arayüzde görünen MERAK metni)', () => {
  assert.equal(icTalimatYankisiMi(MERAK, MERAK), true);
  assert.equal(icTalimatYankisiMi(`${MERAK}\n`, MERAK), true);
  assert.equal(icTalimatYankisiMi(TANISMA_TALIMATI, TANISMA_TALIMATI), true);
  assert.equal(icTalimatYankisiMi(TANISMA_TALIMATI_YEREL, TANISMA_TALIMATI_YEREL), true);
  // Başlıksız talimat (SABAH ÖZETİ hazırla.) da uzun ortak parçadan yakalanır.
  assert.equal(icTalimatYankisiMi(SABAH, SABAH), true);
});

test('yankı bekçisi: talimatın başlığıyla başlayan yanıt — büyük/küçük harf, boşluk ve markdown farkı sayılmaz', () => {
  assert.equal(icTalimatYankisiMi('MERAK SORUSU: Ekibinde kaç kişi var?', MERAK), true);
  assert.equal(icTalimatYankisiMi('  merak   sorusu:  Ekibinde kaç kişi var?', MERAK), true);
  assert.equal(icTalimatYankisiMi('**MERAK SORUSU:** Ekibinde kaç kişi var?', MERAK), true);
  assert.equal(icTalimatYankisiMi('Kurulum bitti: merhaba!', TANISMA_TALIMATI), true);
  // Başlık ortada geçiyorsa başlık kuralı değil, uzun parça kuralı karar verir (kısa: yankı değil).
  assert.equal(icTalimatYankisiMi('Sana bir merak sorusu: ekibinde kaç kişi var?', MERAK), false);
});

test('yankı bekçisi: talimattan ≥ 40 karakterlik bir parçayı içeren yanıt yankıdır (başta olmasa da)', () => {
  assert.equal(icTalimatYankisiMi('Tamam! Çekirdek hafızaya ve son hafıza kayıtlarına bak (hafiza_ara gerekirse); sonra soracağım.', MERAK), true);
  assert.equal(icTalimatYankisiMi('Not: sonra hafiza_kaydet ile (tur: olay, baslik: “Merak sorusu”, etiket “merak”) kaydederim.', MERAK), true, 'tırnak biçimi farkı sayılmaz');
  assert.equal(icTalimatYankisiMi('Günaydın! Önce hatirlatici_listele (24 saat), gorev_listele ve bağlıysa eposta_listele ile bakıyorum.', SABAH), true);
});

test('yankı bekçisi: normal yanıt yankı değildir; kısa ortak sözcükler yanlış pozitif vermez', () => {
  assert.equal(icTalimatYankisiMi('Merhaba Deniz, merak ettim: ekibinde kaç kişi var? Böylece toplantıları daha iyi planlayabilirim.', MERAK), false);
  assert.equal(icTalimatYankisiMi('Günaydın Deniz! Bugün üç işin var; ilki 10:00’daki ekip toplantısı. Akşam e-postalarına bakmayı unutma.', SABAH), false);
  // Meşru sabah mesajı "Sabah özeti:" ile başlayabilir: SABAH talimatının başlığı yok ("SABAH ÖZETİ hazırla." iki nokta değil).
  assert.equal(icTalimatYankisiMi('Sabah özeti: bugün iki toplantın ve bir hatırlatıcın var.', SABAH), false);
  // Talimattan kısa parçalar (< 40 karakter): araç adı, "TEK bir soru", "kısa" …
  assert.equal(icTalimatYankisiMi('Sıcak ve kısa TEK bir soru: hangi projeye odaklanıyorsun? (hafiza_kaydet)', MERAK), false);
  assert.equal(icTalimatYankisiMi('Hafıza kayıtlarına baktım; projelerin hakkında bir şey sormak istiyorum.', MERAK), false);
  assert.equal(icTalimatYankisiMi('', MERAK), false);
  assert.equal(icTalimatYankisiMi('Merhaba', ''), false);
  assert.equal(icTalimatYankisiMi('   ', '   '), false);
});

test('proaktifIsYerelde: yerel/Gizli turda (araçsız) yalnız tanışma çalışabilir; SABAH/AKŞAM/MERAK araç ister', () => {
  assert.equal(proaktifIsYerelde('tanisma'), true);
  for (const is of ['sabah', 'aksam', 'merak'] as const) assert.equal(proaktifIsYerelde(is), false, is);
});

test('proaktifIsCalisirMi: bulut yolunda hepsi; yerel yolda yalnız tanışma; motor yokken (Gizli hazırlanıyor) hiçbiri', () => {
  for (const is of ['sabah', 'aksam', 'merak', 'tanisma'] as const) {
    assert.equal(proaktifIsCalisirMi(is, 'bulut'), true, `${is} bulut`);
    assert.equal(proaktifIsCalisirMi(is, 'yok'), false, `${is} yok`);
    assert.equal(proaktifIsCalisirMi(is, 'yerel'), proaktifIsYerelde(is), `${is} yerel`);
  }
});

test('tanışma talimatı: Normal’de bugünkü metin; Gizli’de araçsız ve kısa (araç adı, yetenek listesi yok); ikisi de iç talimat başlığıyla', () => {
  assert.equal(tanismaTalimati(false), TANISMA_TALIMATI);
  assert.equal(tanismaTalimati(true), TANISMA_TALIMATI_YEREL);
  assert.equal(TANISMA_TALIMATI, 'KURULUM BİTTİ: Kullanıcıyla ilk kez tanışıyorsun. Kendini kısaca tanıt (ne yapabildiğini 3-4 maddeyle), kurulumda öğrendiklerini doğal bir dille yansıt ve onu tanımak için TEK bir soru sor.');
  assert.match(TANISMA_TALIMATI_YEREL, /^KURULUM BİTTİ: /);
  assert.ok(TANISMA_TALIMATI_YEREL.length < TANISMA_TALIMATI.length, 'kısa');
  assert.doesNotMatch(TANISMA_TALIMATI_YEREL, /_|hafıza|hatırlat|e-posta|araç|madde|ne yapabildiğini/i);
  assert.match(TANISMA_TALIMATI_YEREL, /TEK bir soru/);
});

test('durdurulan proaktif turun yarım metni talimatın yankısıysa kayda geçmez (iz bırakılmaz); yankı değilse bugünkü gibi kalır', () => {
  assert.deepEqual(durdurmaKayitlari({ yarimMetin: MERAK.slice(0, 140), gizliTetik: true, talimat: MERAK }), []);
  assert.deepEqual(durdurmaKayitlari({ yarimMetin: 'MERAK SORUSU: Ekib', gizliTetik: true, talimat: MERAK }), []);
  assert.equal(durdurmaKayitlari({ yarimMetin: 'Merhaba Deniz, ekibinde kaç', gizliTetik: true, talimat: MERAK }).length, 2);
  // Kullanıcının kendi turu süzülmez (talimat yok; kullanıcının yazdığını tekrar eden yanıt meşrudur).
  assert.equal(durdurmaKayitlari({ yarimMetin: MERAK.slice(0, 140), talimat: MERAK }).length, 2);
});

test('proaktif turun hafıza girdisi: talimat yerine nötr işaret (talimat başlığı, araç adı yok)', () => {
  assert.ok(PROAKTIF_HAFIZA_ISARETI.trim().length > 0);
  assert.doesNotMatch(PROAKTIF_HAFIZA_ISARETI, /[A-ZÇĞİÖŞÜ]{4,}|_|hafiza|MERAK|SABAH|AKŞAM|KURULUM/);
  assert.equal(icTalimatYankisiMi(PROAKTIF_HAFIZA_ISARETI, MERAK), false);
});

// 0.12 cila düzeltme turu 1 (I-2, kontrolcünün ürün kararı): araç isteyen sabah/akşam özeti ve merak sorusu Gizli/"Yalnız bu bilgisayar"da
// çalışmaz — Ayarlar bunu sessiz bırakmaz. Görünüm: scripts/dev/ayarlar-onizle.mjs (Gizli oturumunda var, Fuber'de yok).
test('yerel notu: sabah/akşam/merak yerelde çalışmaz ve Ayarlar bunu yalnız/Gizli seçiliyken söyler (Özetler, merak satırı, Nerede ayrıntısı)', () => {
  assert.equal(YEREL_OZET_NOTU, 'Bu bilgisayarda çalışırken özetler hatırlatıcı ve yapılacaklarından kısa bir liste olarak gelir.');
  assert.equal(YEREL_MERAK_NOTU, 'Bu bilgisayarda çalışırken sorulmaz.');
  for (const is of ['sabah', 'aksam', 'merak'] as const) assert.equal(proaktifIsCalisirMi(is, 'yerel'), false, is);
  const oku = (y: string) => fs.readFileSync(path.resolve(import.meta.dirname, '..', y), 'utf8');
  const proaktif = oku('src/renderer/ayarlar/Proaktif.tsx');
  assert.match(proaktif, /const yerelde = neredeYerelMi\(a\.yerel\);/);
  assert.match(proaktif, /<Satir id="sabah-ozeti" ek=\{yerelde \? <span data-yerel-ozet-notu="">[^}]*\{YEREL_OZET_NOTU\}/);
  assert.match(proaktif, /<Satir id="merak" ek=\{neredeYerelMi\(a\.yerel\) \? <span data-yerel-merak-notu="">[^}]*\{YEREL_MERAK_NOTU\}/);
  assert.match(oku('src/renderer/ayarlar/Gizlilik.tsx'), /hal !== 'fuber' && <div className="ns-ayrinti__not" data-yerel-ozet-notu="">\{YEREL_OZET_NOTU\}<\/div>/);
});
