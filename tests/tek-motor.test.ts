// 0.11 G8 (spec §7): "Yalnız bu bilgisayardaki yapay zekâ". Tek motor kuralı (shared/tek-motor.ts motorYolu — main/motor/yerel.ts
// tekMotorYolu bunu ayar ve mod ile besler): Gizli mod önceki kuralıyla AYNEN; Gizli değilken tercih yalnız bu bilgisayardaki yapay zekâ
// hazırken etkindir. 0.12 H3c (spec Hedefler §5): "Yalnız bu bilgisayar" artık İş modunda da var — İş + yalnızYerel + hazır → 'yerel' (bulut
// olsa da); mod bilinmiyorsa (eski çağıran) tercih etkin sayılmaz. Dönüş değerleri değişmedi ('yerel' | 'bulut' | 'yok'). Tablo elle
// yazıldı (kuralı tekrar hesaplayarak sınamaz). Ana süreç tarafı: gerçek ayar dosyası + tekMotorYolu, ağ yok.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { motorYolu, yalnizYerelAnahtari, yalnizYerelEtkin, aracsizTurIstemi, GIZLI_ARACSIZ_ISTEM, YEREL_ARACSIZ_ISTEM, YALNIZ_YEREL_NOTU, YALNIZ_YEREL_KUR, YALNIZ_YEREL_AC, type MotorYolu } from '../src/shared/tek-motor.ts';
import fs from 'node:fs';
import path from 'node:path';
import { anaSurecSahnesi, esbuildHazir } from './yardimci/ana-surec.ts';
import { isDiliIhlali } from '../src/shared/is-dili.ts';
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';

// ── Ana süreç: gerçek ayar dosyası, tekMotorYolu, geçici FUBER_VERI; ağ yok ──
anaSurecSahnesi('tek-motor', { kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, mod: 'gelistirici', tanitimSurumu: '0.9.0', ses: { surum: 2, uyandirma: false }, proaktif: { etkin: false }, baslangictaAc: false });
await esbuildHazir();
const { ayarlar, ayarlariKaydet } = await import('../src/main/ayarlar.ts');
const { tekMotorYolu } = await import('../src/main/motor/yerel.ts');

type Satir = { gizli: boolean; yalniz: boolean; hazir: boolean; bulut: boolean; mod: 'is' | 'gelistirici'; yol: MotorYolu };
const IS = 'is', GEL = 'gelistirici';
// gizli × yalnizYerel × yerelHazir × bulutVar × mod = 32 satır.
const TABLO: Satir[] = [
  // ── Gizli AÇIK: önceki kural (yalnizYerel ve mod hiçbir şeyi değiştirmez; bulut hiç yol değildir) ──
  { gizli: true, yalniz: false, hazir: true, bulut: true, mod: IS, yol: 'yerel' },
  { gizli: true, yalniz: false, hazir: true, bulut: true, mod: GEL, yol: 'yerel' },
  { gizli: true, yalniz: false, hazir: true, bulut: false, mod: IS, yol: 'yerel' },
  { gizli: true, yalniz: false, hazir: true, bulut: false, mod: GEL, yol: 'yerel' },
  { gizli: true, yalniz: false, hazir: false, bulut: true, mod: IS, yol: 'yok' },
  { gizli: true, yalniz: false, hazir: false, bulut: true, mod: GEL, yol: 'yok' },
  { gizli: true, yalniz: false, hazir: false, bulut: false, mod: IS, yol: 'yok' },
  { gizli: true, yalniz: false, hazir: false, bulut: false, mod: GEL, yol: 'yok' },
  { gizli: true, yalniz: true, hazir: true, bulut: true, mod: IS, yol: 'yerel' },
  { gizli: true, yalniz: true, hazir: true, bulut: true, mod: GEL, yol: 'yerel' },
  { gizli: true, yalniz: true, hazir: true, bulut: false, mod: IS, yol: 'yerel' },
  { gizli: true, yalniz: true, hazir: true, bulut: false, mod: GEL, yol: 'yerel' },
  { gizli: true, yalniz: true, hazir: false, bulut: true, mod: IS, yol: 'yok' },
  { gizli: true, yalniz: true, hazir: false, bulut: true, mod: GEL, yol: 'yok' },
  { gizli: true, yalniz: true, hazir: false, bulut: false, mod: IS, yol: 'yok' },
  { gizli: true, yalniz: true, hazir: false, bulut: false, mod: GEL, yol: 'yok' },
  // ── Gizli KAPALI, yalnizYerel KAPALI: bugünkü kural (bulut varsa bulut; yoksa hazırsa yerel) ──
  { gizli: false, yalniz: false, hazir: true, bulut: true, mod: IS, yol: 'bulut' },
  { gizli: false, yalniz: false, hazir: true, bulut: true, mod: GEL, yol: 'bulut' },
  { gizli: false, yalniz: false, hazir: true, bulut: false, mod: IS, yol: 'yerel' },
  { gizli: false, yalniz: false, hazir: true, bulut: false, mod: GEL, yol: 'yerel' },
  { gizli: false, yalniz: false, hazir: false, bulut: true, mod: IS, yol: 'bulut' },
  { gizli: false, yalniz: false, hazir: false, bulut: true, mod: GEL, yol: 'bulut' },
  { gizli: false, yalniz: false, hazir: false, bulut: false, mod: IS, yol: 'yok' },
  { gizli: false, yalniz: false, hazir: false, bulut: false, mod: GEL, yol: 'yok' },
  // ── Gizli KAPALI, yalnizYerel AÇIK ──
  // hazır + bulut var: iki modda da yerel (bulut anahtarı / Fuber hesabı olsa da) — 0.12 H3c: İş'te de etkin
  { gizli: false, yalniz: true, hazir: true, bulut: true, mod: IS, yol: 'yerel' },
  { gizli: false, yalniz: true, hazir: true, bulut: true, mod: GEL, yol: 'yerel' },
  // hazır + bulut yok: zaten yerel (iki modda da)
  { gizli: false, yalniz: true, hazir: true, bulut: false, mod: IS, yol: 'yerel' },
  { gizli: false, yalniz: true, hazir: true, bulut: false, mod: GEL, yol: 'yerel' },
  // hazır DEĞİL (P14 K1, H3c düzeltme turu 1): Gizli gibi değişmez — bulut olsa da ASLA bulut; 'yok' (hazırlanıyorsa bekler, değilse
  // "hazır değil" kartı: Yeniden indir / Fuber’le devam et)
  { gizli: false, yalniz: true, hazir: false, bulut: true, mod: IS, yol: 'yok' },
  { gizli: false, yalniz: true, hazir: false, bulut: true, mod: GEL, yol: 'yok' },
  { gizli: false, yalniz: true, hazir: false, bulut: false, mod: IS, yol: 'yok' },
  { gizli: false, yalniz: true, hazir: false, bulut: false, mod: GEL, yol: 'yok' },
];

test('tekMotorYolu tablosu: gizli × yalnizYerel × yerelHazir × bulutVar × mod (32 satır)', () => {
  assert.equal(TABLO.length, 32);
  assert.equal(new Set(TABLO.map((s) => `${s.gizli}${s.yalniz}${s.hazir}${s.bulut}${s.mod}`)).size, 32, 'tablo her bileşimi bir kez içerir');
  for (const s of TABLO) {
    assert.equal(
      motorYolu({ gizliMod: s.gizli, yalnizYerel: s.yalniz, yerelHazir: s.hazir, bulutVar: s.bulut, mod: s.mod }), s.yol,
      `gizli=${s.gizli} yalnizYerel=${s.yalniz} hazır=${s.hazir} bulut=${s.bulut} mod=${s.mod}`,
    );
  }
});

test('eski çağıranlar (yalnizYerel ve mod verilmez) bugünkü kuralı görür; Gizli satırları önceki beklentilerle aynı', () => {
  assert.equal(motorYolu({ yerelHazir: true, gizliMod: false, bulutVar: true }), 'bulut');
  assert.equal(motorYolu({ yerelHazir: true, gizliMod: true, bulutVar: true }), 'yerel');
  assert.equal(motorYolu({ yerelHazir: false, gizliMod: true, bulutVar: true }), 'yok');
  assert.equal(motorYolu({ yerelHazir: true, gizliMod: false, bulutVar: false }), 'yerel');
  assert.equal(motorYolu({ yerelHazir: false, gizliMod: false, bulutVar: false }), 'yok');
  // P14 K1: tercih moddan bağımsız ve güvenli yön YEREL — mod bilinmese de "Yalnız bu bilgisayar" buluta gitmez.
  assert.equal(motorYolu({ yerelHazir: true, gizliMod: false, bulutVar: true, yalnizYerel: true }), 'yerel');
  assert.equal(motorYolu({ yerelHazir: false, gizliMod: false, bulutVar: true, yalnizYerel: true }), 'yok');
  // Sıkı boolean: bozuk bir değer ("evet", 1) tercihi açmaz.
  assert.equal(motorYolu({ yerelHazir: true, gizliMod: false, bulutVar: true, mod: GEL, yalnizYerel: 'evet' as unknown as boolean }), 'bulut');
});

test('anahtarın hâli: kurulu → serbest; kurulu değil → kapalı ve devre dışı + kurulum bağı; açıkken kurulu değilse uyarı ve KAPATILABİLİR', () => {
  // Hazır, kapalı.
  assert.deepEqual(yalnizYerelAnahtari({ yalnizYerel: false, yerelHazir: true }), { acik: false, devreDisi: false, etkin: false, not: '', uyari: '', kurulum: null });
  // Hazır, açık: roller kilitli (etkin) + dürüst not (spec §7 cümlesi).
  const acik = yalnizYerelAnahtari({ yalnizYerel: true, yerelHazir: true });
  assert.deepEqual([acik.acik, acik.devreDisi, acik.etkin, acik.kurulum], [true, false, true, null]);
  assert.equal(acik.not, 'Bu bilgisayardaki yapay zekâ en iyi yazma, özetleme, çeviri ve hatırlamada çalışır; hatırlatıcılar onayınla kurulur, e-posta ve ekran kullanılamaz.');
  assert.equal(acik.not, YALNIZ_YEREL_NOTU);
  // Kurulu değil, kapalı: anahtar kapalı ve devre dışı, "Önce … kur" bağı.
  const kurulu = yalnizYerelAnahtari({ yalnizYerel: false, yerelHazir: false });
  assert.deepEqual([kurulu.acik, kurulu.devreDisi, kurulu.etkin], [false, true, false]);
  assert.equal(kurulu.kurulum, 'Önce bu bilgisayardaki yapay zekâyı kur');
  assert.equal(kurulu.kurulum, YALNIZ_YEREL_KUR);
  // Kurulu ama kapalı (yerel.etkin false): "kur" denmez, "aç" denir; aynı satır.
  assert.equal(yalnizYerelAnahtari({ yalnizYerel: false, yerelHazir: false, kurulu: true }).kurulum, 'Önce bu bilgisayardaki yapay zekâyı aç');
  assert.equal(YALNIZ_YEREL_AC, 'Önce bu bilgisayardaki yapay zekâyı aç');
  // Kurulu değil ama kayıtlı tercih açık (kaldırılmış / kapatılmış): anahtar açık gösterilir, KAPATILABİLİR (tuzak yok), roller kilitli DEĞİL, uyarı.
  const kayip = yalnizYerelAnahtari({ yalnizYerel: true, yerelHazir: false });
  // P14 K1: seçiliyken yol hiçbir zaman bulut değil — roller hazır olmasa da kilitli (etkin).
  assert.deepEqual([kayip.acik, kayip.devreDisi, kayip.etkin, kayip.not], [true, false, true, '']);
  assert.doesNotMatch(kayip.uyari, /eskisi gibi|Fuber’den/, 'hazır değilken yanıtlar buluta gitmez; uyarı bunu vaat etmez');
  assert.match(kayip.uyari, /hazır değil/);
  assert.ok(kayip.kurulum);
  // Hâl henüz bilinmiyor (null): kapalıyken açılamaz, açıkken kapatılabilir; "kur" denmez (yanlış söz yok).
  assert.deepEqual(yalnizYerelAnahtari({ yalnizYerel: false, yerelHazir: null }), { acik: false, devreDisi: true, etkin: false, not: '', uyari: '', kurulum: null });
  assert.deepEqual([yalnizYerelAnahtari({ yalnizYerel: true, yerelHazir: null }).devreDisi, yalnizYerelAnahtari({ yalnizYerel: true, yerelHazir: null }).etkin], [false, true]);
});

test('yalnizYerelEtkin: tercihin yolu gerçekten yerele çevirdiği an (rol seçicileri yalnız o zaman kilitlenir)', () => {
  const g = { gizliMod: false, yalnizYerel: true, yerelHazir: true, bulutVar: true, mod: 'gelistirici' as const };
  assert.equal(yalnizYerelEtkin(g), true);
  for (const kapali of [{ yalnizYerel: false }, { yerelHazir: false }, { gizliMod: true }]) assert.equal(yalnizYerelEtkin({ ...g, ...kapali }), false, JSON.stringify(kapali));
  // P14 K1: mod bilinmese de tercih geçerli (güvenli yön yerel).
  assert.equal(yalnizYerelEtkin({ ...g, mod: undefined }), true);
  // 0.12 H3c: İş modunda da etkin (Gizli değil; ağ özellikleri sürer).
  assert.equal(yalnizYerelEtkin({ ...g, mod: 'is' }), true, 'İş + yalnızYerel + hazır');
});

test('anahtar metinleri düz Türkçe ve ’ kesme işaretiyle (Geliştirici yüzeyi; İş\'te görünmez ama İş diline takılmaz)', () => {
  for (const m of [YALNIZ_YEREL_NOTU, YALNIZ_YEREL_KUR, YALNIZ_YEREL_AC, yalnizYerelAnahtari({ yalnizYerel: true, yerelHazir: false }).uyari]) {
    assert.equal(isDiliIhlali(m), null, m);
    assert.doesNotMatch(m, /'/, m);
  }
});

test('ana süreç: eski profilde yalnizYerel yok → varsayılan false (göç); bulut bağlıyken yol bulut', () => {
  assert.equal(ayarlar().yerel.yalnizYerel, false);
  ayarlariKaydet((a) => { a.saglayicilar.anthropic.etkin = true; a.saglayicilar.anthropic.anahtarVar = true; });
  process.env.FUBER_YEREL_TABAN = 'http://127.0.0.1:9'; // yerel hazır sayılır (sunucu başlatılmaz, ağa çıkılmaz)
  assert.equal(tekMotorYolu(), 'bulut');
});

test('ana süreç: Geliştirici + yalnizYerel + yerel hazır → yerel; İş\'te de yerel (0.12 H3c); kapatınca bulut; Gizli önceliği korunur', () => {
  ayarlariKaydet((a) => { a.mod = 'gelistirici'; a.yerel.yalnizYerel = true; });
  assert.equal(tekMotorYolu(), 'yerel');
  ayarlariKaydet((a) => { a.mod = 'is'; });
  assert.equal(tekMotorYolu(), 'yerel', 'İş + yalnızYerel + hazır → yerel (bulut bağlı olsa da)');
  assert.equal(ayarlar().yerel.yalnizYerel, true, 'İş\'e geçiş ayarı silmez');
  ayarlariKaydet((a) => { a.mod = 'gelistirici'; });
  assert.equal(tekMotorYolu(), 'yerel', 'Geliştirici\'de de yerel');
  ayarlariKaydet((a) => { a.yerel.yalnizYerel = false; });
  assert.equal(tekMotorYolu(), 'bulut');
  ayarlariKaydet((a) => { a.yerel.yalnizYerel = true; a.yerel.gizliMod = true; });
  assert.equal(tekMotorYolu(), 'yerel', 'Gizli açıkken de yerel (Gizli kuralı)');
  ayarlariKaydet((a) => { a.yerel.gizliMod = false; });
});

test('ana süreç (P14 K1): yerel hazır değilken (hazırlanıyor / hata / kaldırıldı / kapalı) "Yalnız bu bilgisayar" ASLA buluta gitmez — yol yok', () => {
  delete process.env.FUBER_YEREL_TABAN; // yerel etkin değil ve kurulu değil
  ayarlariKaydet((a) => { a.mod = 'gelistirici'; a.yerel.yalnizYerel = true; a.yerel.etkin = false; });
  assert.equal(tekMotorYolu(), 'yok', 'Geliştirici: bulut anahtarı bağlıyken de yok');
  ayarlariKaydet((a) => { a.mod = 'is'; });
  assert.equal(tekMotorYolu(), 'yok', 'İş: bulut bağlıyken de yok');
  ayarlariKaydet((a) => { a.yerel.yalnizYerel = false; });
  assert.equal(tekMotorYolu(), 'bulut', 'Fuber seçilince (açık kullanıcı seçimi) yeniden bulut');
  ayarlariKaydet((a) => { a.mod = 'gelistirici'; });
});

// ── 0.11 G8 düzeltme turu 1 (Ö1): yalnız-yerel turunun sistem istemi Gizli/bulutsuz DEMEZ (spec §7: "gizlilik sözü verilmez") ──
// ajan/dongu.ts yerel tek motor turunda aracsizTurIstemi(gizli) ekler. 11 Kas analizi #8 (§6.4): araçsızlık yerel sistem isteminde TEK kez söylenir
// (shared/yerel-istem.ts "Yapamadıkların"); <baglam>'daki ikinci paragraf kalktı — model "merhaba"ya bile "aracım yok" diye başlıyordu.
test('Ö1: yalnız-yerel <baglam> cümlesi yok (gizlilik sözü de yok); Gizli\'de yalnız kısa Gizli cümlesi, araçsızlık tekrarı yok', () => {
  const y = aracsizTurIstemi(false);
  assert.equal(y, YEREL_ARACSIZ_ISTEM);
  assert.equal(y, '', 'yalnız-yerelde <baglam>a ikinci araçsızlık cümlesi eklenmez');
  const g = aracsizTurIstemi(true);
  assert.equal(g, GIZLI_ARACSIZ_ISTEM);
  assert.match(g, /^Şu an GİZLİ MODDASIN \(bulutsuz\)/);
  assert.match(g, /hafızaya yazılmaz/);
  assert.doesNotMatch(g, /aracın yok|kuramaz|gönderemez|bakamazsın/, 'araçsızlık sistem isteminde bir kez söylenir');
});

test('Ö1: dongu.ts istemi yalnız SEÇER (cümleler shared/tek-motor.ts\'te); satır içi "GİZLİ MODDASIN" kalmadı', () => {
  const dongu = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'main', 'ajan', 'dongu.ts'), 'utf8');
  assert.match(dongu, /yerelTek \? aracsizTurIstemi\(gizli\) : ''/);
  assert.doesNotMatch(dongu, /GİZLİ MODDASIN/);
  assert.match(dongu, /from '\.\.\/\.\.\/shared\/tek-motor\.js'/);
  // Gizli işareti değişmedi: yalnız-yerel turu "gizli" kaydedilmez (spec: gizlilik sözü yok), yalnız Gizli'de.
  assert.match(dongu, /gizli = yerelTek && ayarlar\(\)\.yerel\.gizliMod === true;/);
  // Araç isteyen iş (Fuber'e sor): yalnız-yerelde doğru cümle — motorHataMetni'ne yalnız-yerel bilgisi geçer.
  assert.match(dongu, /motorHataMetni\('bulut-gerekli', ayarlar\(\)\.mod, ayarlar\(\)\.hesap\?\.durum, gizli, yalnizYerelTur, motorYoluGirdisi\(\)\.bulutVar\)/);
});

// G8 düzeltme turu 2 (madde 3): "yalnız yerel mi" kuralı TEK yerde (shared/tek-motor.ts yalnizYerelEtkin); ajan turu, motor sinyali ve yol aynı girdiden.
test('G8 düzeltme turu 2: yalnız-yerel kararı kopyalanmaz — dongu.ts ve motor sinyali paylaşılan yalnizYerelEtkin\'i (yerel.ts yalnizYerelTurMu) çağırır', () => {
  const oku = (...p: string[]) => fs.readFileSync(path.resolve(import.meta.dirname, '..', ...p), 'utf8');
  const dongu = oku('src', 'main', 'ajan', 'dongu.ts');
  assert.match(dongu, /const yalnizYerelTur = yalnizYerelTurMu\(\);/);
  assert.doesNotMatch(dongu, /yerel\.yalnizYerel/, 'dongu ayarı kendisi yorumlamaz (ikinci kopya kural)');
  const yerel = oku('src', 'main', 'motor', 'yerel.ts');
  assert.match(yerel, /yalnizYerelTurMu = \(\): boolean => yalnizYerelEtkin\(motorYoluGirdisi\(\)\)/);
  assert.match(yerel, /tekMotorYolu = \(\): MotorYolu => motorYolu\(motorYoluGirdisi\(\)\)/, 'yol ve yalnız-yerel aynı girdiden');
  assert.match(oku('src', 'main', 'abonelik.ts'), /const yalnizYerel = yalnizYerelTurMu\(\);/, 'motor sinyali de aynı yardımcıdan');
});
