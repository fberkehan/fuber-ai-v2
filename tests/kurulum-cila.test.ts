// 0.13.1 kurulum cilası (bağımsız tasarım incelemesinden çıkan onaylı düzeltmeler; .superpowers/sdd/…/task-19-brief.md).
// Saf kurallar doğrudan, bileşenler ve CSS kaynaktan denetlenir; canlı ölçüm (başlık y'si, kontrast, boşluk) scripts/dev/kurulum2-onizle.mjs'te.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LANDING_VAR } from './yardimci/ozel.ts';
import { hitapliCumle, sizliMi } from '../src/shared/hitap.ts';
import { BAGLANTI_YOK, GUN_KALIPLARI, HITAPLAR, KURULUM2_SIRASI, hazirsinMetinleri, ilkSozler, kurulumTamamlaGovdesi, ozetSatirlari, taslakBaslangici } from '../src/shared/kurulum-taslak.ts';
import { KM, kmSizSozcukleri, ilkSozCiftleri, sec, senEkiVar, sizEkiVar, type Cift } from '../src/shared/kurulum-metin.ts';
import { GUN_VARSAYILAN } from '../src/shared/kurulum-adimlari.ts';
import { NEREDE_FUBER_CUMLESI, neredeAciklamasi } from '../src/shared/nerede.ts';

const kok = path.resolve(import.meta.dirname, '..');
const oku = (y: string) => fs.readFileSync(path.join(kok, y), 'utf8').replace(/\r\n/g, '\n');
/** Yorum satırları atılmış kaynak (yasak sözler yalnız çalışan metinde aranır). */
const kod = (y: string) => oku(y).replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

test('1 · Karşılama: yazıda adım sayısı ya da süre sayısı yok (kurulum 11 adım; sayı sabiti geri gelmez)', () => {
  assert.equal(KURULUM2_SIRASI.length, 11);
  const s = oku('src/renderer/kurulum2/adimlar/Hosgeldin.tsx');
  assert.match(s, /'Birkaç dakika', 'Çoğunda “Devam” yeter\.'/);
  assert.match(s, /Kurulumdan sonra bir kısayolla yanında olurum\./);
  assert.doesNotMatch(s, /tek tuşla|Yaklaşık iki dakika|Dokuz|dokuz|iki dakika|On bir|on bir|\b\d+ (?:kısa )?adım/);
  // Kurulum bileşenlerinin hiçbirinde "N adım" sözü geçmez (adım eklenip çıkarılınca yalan olurdu).
  for (const d of fs.readdirSync(path.join(kok, 'src/renderer/kurulum2/adimlar'))) assert.doesNotMatch(oku(`src/renderer/kurulum2/adimlar/${d}`), /(?:Dokuz|Dört|Beş|On bir|Onbir|\d+) (?:kısa )?adım/, d);
});

test('2 · Hitap uyumu: Bey/Hanım/Hocam → "siz"; hitapsız ve serbest hitap → "sen"', () => {
  for (const h of ['Bey', 'Hanım', 'Hocam', 'Deniz Bey', 'hanim', 'Sayın']) assert.equal(sizliMi(h), true, h);
  for (const h of ['', '  ', 'Patron', 'abi', undefined, null]) assert.equal(sizliMi(h), false, String(h));
  assert.equal(hitapliCumle('Bey', 'siz', 'sen'), 'siz');
  assert.equal(hitapliCumle('', 'siz', 'sen'), 'sen');
  assert.equal(HITAPLAR[0][1], 'Sadece adımla');
  assert.equal(hazirsinMetinleri({ ad: 'Deniz', hitap: 'Bey', kip: 'ilk' }).baslik, 'Hazırsınız, Deniz Bey.');
  assert.equal(hazirsinMetinleri({ ad: '', hitap: 'Hocam', kip: 'ilk' }).baslik, 'Hazırsınız, Hocam.');
  assert.equal(hazirsinMetinleri({ ad: 'Deniz', hitap: '', kip: 'ilk' }).baslik, 'Hazırsın, Deniz.');
  assert.equal(hazirsinMetinleri({ ad: '', hitap: '', kip: 'ilk' }).baslik, 'Hazırsın.');
  assert.equal(hazirsinMetinleri({ ad: 'Deniz', hitap: 'Bey', kip: 'ilk' }).giris, 'Önemli bir şey olunca ekranınızın üstünde küçük bir kartla haber veririm.');
  assert.equal(hazirsinMetinleri({ ad: 'Deniz', hitap: '', kip: 'ilk' }).giris, 'Önemli bir şey olunca ekranının üstünde küçük bir kartla haber veririm.');
  assert.match(hazirsinMetinleri({ ad: 'Deniz', hitap: 'Bey', kip: 'yeniden' }).giris, /ayarlarınızı kaydeder\. Hafızanız ve sohbetleriniz/);
  assert.deepEqual(KM.tanismaOdak, ['Bugün 3 toplantın ve yanıt bekleyen 2 önemli e-postan var.', 'Bugün 3 toplantınız ve yanıt bekleyen 2 önemli e-postanız var.']);
  assert.deepEqual(KM.adaSozu('Deniz Bey'), ['Deniz Bey, toplantın 10 dakika sonra.', 'Deniz Bey, toplantınız 10 dakika sonra.']);
  assert.deepEqual(KM.adaSozu(''), ['Toplantın 10 dakika sonra.', 'Toplantınız 10 dakika sonra.']);
  // Tanışma'nın sol sütunu (hitabın seçildiği yer) ve başlığı "sen" kalır; önizleme ve dipnot çiftlerle.
  const t = oku('src/renderer/kurulum2/adimlar/Tanisma.tsx');
  assert.match(t, /Seni tanıyayım\./);
  assert.match(t, /m\(KM\.tanismaDip\)/);
});

test('4 · Hazırsın önerileri: izinlere ve e-postaya bağlı (Dosyalar → sözleşme, Tarayıcı → uçuş, e-posta bağlıysa üçüncü söz e-posta)', () => {
  const tam = ilkSozler({ eposta: false, dosya: true, tarayici: true });
  assert.deepEqual(tam, ['“Yarın 9’da toplantıyı hatırlat.”', '“Masaüstündeki sözleşmeyi özetle.”', '“Yarınki uçuşları karşılaştır.”']);
  assert.deepEqual(ilkSozler({ eposta: false, dosya: false, tarayici: false }), ['“Yarın 9’da toplantıyı hatırlat.”', '“Yarın için kısa bir plan yap.”', '“Bu haftanın planını çıkar.”']);
  assert.equal(ilkSozler({ eposta: true, dosya: true, tarayici: true })[2], '“Bugün önemli bir e-posta var mı?”');
  assert.ok(!ilkSozler({ eposta: false, dosya: true, tarayici: true }).some((x) => x.includes('e-posta')), 'e-posta bağlı değilken e-posta sorusu yok');
  assert.deepEqual(ilkSozler({ eposta: false, dosya: true, tarayici: false }, true), ['“Yarın 9’da toplantıyı hatırlatın.”', '“Masaüstündeki sözleşmeyi özetleyin.”', '“Bu haftanın planını çıkarın.”']);
  assert.equal(ilkSozler({ eposta: true, dosya: true, tarayici: true, yerel: true }).length, 3, 'yalnız bu bilgisayarda araçsız örnekler');
});

test('6 · Günün: Klasik 09:00–18:00 (taslak, kalıp); başlık; sayaçlar sütunu doldurur', () => {
  assert.deepEqual([GUN_VARSAYILAN.gunBas, GUN_VARSAYILAN.gunBit], ['09:00', '18:00']);
  assert.deepEqual(GUN_KALIPLARI.find(([id]) => id === 'klasik')?.slice(1, 3), ['09:00', '18:00']);
  const t = taslakBaslangici({}, 'ilk');
  assert.deepEqual([t.gunBas, t.gunBit], ['09:00', '18:00']);
  assert.deepEqual(KM.gunBaslik, ['Genelde hangi saatlerde çalışırsın?', 'Genelde hangi saatlerde çalışırsınız?']);
  assert.match(oku('src/renderer/kurulum2/adimlar/Gunun.tsx'), /baslik=\{m\(KM\.gunBaslik\)\}/);
  const css = oku('src/renderer/kurulum2/kurulum2.css');
  assert.match(css, /\.k2-saatler \{ display: grid; grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\)/);
  assert.match(css, /\.k2-saatler \.ft-saat \{ display: grid; [^}]*width: 100%/);
});

test('8 · Görünüm: Mac benzeri üç nokta yok; aynı cümle iki kez yazmıyor', () => {
  const g = kod('src/renderer/kurulum2/adimlar/Gorunum.tsx');
  // Gri iskelet kalktı: Adım 3'teki gerçek karşılama kartı, seçilen temaya göre; tek not (giriş), sağda kopya açıklama ve dip yok.
  assert.doesNotMatch(g, /k2-tema__ust|k2-tema__ray|k2-tema__sohbet/);
  assert.match(g, /<KokpitKarti \/>/);
  assert.match(g, /import \{ KokpitKarti \} from '\.\/Tanisma'/);
  assert.doesNotMatch(g, /<Tepsi etiket="Görünüm önizlemesi" dip=/);
  assert.doesNotMatch(g, /Bu pencere kurulum boyunca/);
  assert.doesNotMatch(g, /<span>\{g\?\.aciklama\}<\/span>/);
  assert.match(g, /giris=\{m\(KM\.gorunumGiris\)\}/);
  assert.doesNotMatch(oku('src/renderer/kurulum2/kurulum2.css'), /\.k2-tema__ust|\.k2-tema__ray/);
});

test('9 · Dil: Hey Fuber cümlesi, başlıklar, "sonra değiştirirsin" yalnız Karşılama ve mod adımında, "Kapalı gelir"', () => {
  assert.equal(KM.heyFuber[0], '“Hey Fuber” sözünü bu bilgisayarda algılarım. Sesin ancak bu sözden sonra gönderilir.');
  assert.equal(KM.dinlemeSozu('Tilki')[0], 'Merhaba, ben Tilki. Sesimi hep böyle duyacaksın.');
  assert.match(oku('src/renderer/kurulum2/NeredeAdimi.tsx'), /baslik="Nerede çalışayım\?"/);
  assert.match(oku('src/renderer/kurulum2/adimlar/Hosgeldin.tsx'), /Seni tanıyıp işe hazır olurum\. Hepsini sonra Ayarlar’dan değiştirebilirsin\./);
  assert.match(oku('src/renderer/kurulum2/adimlar/Gorunum.tsx'), /baslik="Nasıl görüneyim\?"/);
  const izin = oku('src/renderer/kurulum2/adimlar/Izinler.tsx');
  assert.match(KM.izinBilgisayar('Alt+Shift+Q')[0], /^Kapalı gelir\. Açarsan görev için ekranı görür, fare ve klavyeyi kullanırım\. Her seferinde sorarım\./);
  assert.doesNotMatch(izin + oku('src/shared/kurulum-metin.ts'), /Varsayılan kapalı/);
  assert.match(izin, /rozet: 'İsteğe bağlı'/, 'rozet kalır (spec)');
  // "istediğin an / sonra Ayarlar'dan değiştirirsin" güvencesi yalnız Karşılama (Hosgeldin) ve Kip adımında.
  for (const d of fs.readdirSync(path.join(kok, 'src/renderer/kurulum2/adimlar'))) {
    if (/^(Hosgeldin|Kip|Hazirsin)\.tsx$/.test(d)) continue;
    assert.doesNotMatch(oku(`src/renderer/kurulum2/adimlar/${d}`), /Ayarlar’dan değiştirirsin|istediğin an Ayarlar’dan/, d);
  }
  const km = oku('src/shared/kurulum-metin.ts');
  for (const k of ['neredeGiris', 'gorunumGiris', 'baglantiGiris']) assert.doesNotMatch(new RegExp(`${k}: \\[[^\\]]*\\]`).exec(km)?.[0] ?? '', /Ayarlar’dan değiştir/, k);
  assert.doesNotMatch(oku('src/renderer/kurulum2/NeredeAdimi.tsx'), /Ayarlar’dan değiştirirsin/);
});

test('10 · Görsel dil: başlık sabit çizgi, tek seçim dili, kapalı kart çerçevesi, ikincil metin, ilerleme çubuğu', () => {
  const css = oku('src/renderer/kurulum2/kurulum2.css');
  // Başlık sabit çizgi: içerik üstten akar (dikey ortalama yok).
  assert.match(css, /\.k2__icerik \{ align-self: start; padding-top: var\(--k2-baslik-y\); \}/);
  assert.doesNotMatch(css, /\.k2__icerik \{ align-self: center/);
  // Tek seçim dili: kart = ince çerçeve; segment dolu; iç parıltı ve dış hale yok.
  assert.match(css, /\.k2 \.ft-segment__kaydirak \{ background: var\(--k2-segment-dolgu\)/);
  assert.match(css, /--k2-segment-dolgu: #f5f5f7/);
  assert.match(css, /\.k2 \.ft-secim\[aria-checked='true'\], \.k2 \.ft-model\[aria-checked='true'\] \{ background: var\(--ft-yuzey\); box-shadow: inset 0 0 0 1\.5px var\(--ft-halka\); \}/);
  // Kapalı kart: parlak (--ft-cizgi-2) çerçeve yok.
  assert.match(css, /\.k2-izin:not\(\.k2-izin--acik\) \{ box-shadow: 0 0 0 1px var\(--k2-kapali-cizgi\)/);
  assert.match(css, /\.k2-haber--soluk \{ box-shadow: 0 0 0 1px var\(--k2-kapali-cizgi\)/);
  assert.doesNotMatch(css, /k2-izin:not\(\.k2-izin--acik\) \{[^}]*cizgi-2/);
  // İkincil metin: kurulumda bir ton açık; hiçbir yazı 13 px'in altında değil.
  assert.match(css, /--ft-ink-3: #a8a8ae;/);
  assert.doesNotMatch(css, /font-size: (?:1[0-2](?:\.\d+)?|[0-9](?:\.\d+)?)px/);
  // İlerleme çubuğu: adım sayısına yer ayrılır ("10 / 11" çubuğu itmez).
  assert.match(css, /\.k2 \.ft-ilerleme__sayi \{ min-width: 4\.6em; text-align: left; \}/);
  // Paylaşılan fintech.css'e (Fuber Yönetim) dokunulmadı: cila yalnız .k2 kapsamında.
  assert.doesNotMatch(oku('src/renderer/ui/fintech/fintech.css'), /0\.13\.1|k2-segment-dolgu/);
});


// ── Düzeltme turu 1 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Sen ve siz aynı olabilen (sen eki taşımayan) çiftler. */
const NOTR = new Set(['kipIsSoru', 'baslangicAlt', 'sozEposta', 'izinBilgisayarAcik']);

test('11 · Hitap tam uyum: her kurulum metni (sen, siz) çifti; siz tarafında sen eki yok, çiftler yalnız tarafsız olanlarda aynı', () => {
  const ornek: Record<string, readonly unknown[]> = {
    adaSozu: ['Deniz Bey'], claudeNotVar: [3], bakamadim: [' Gizli modu açmıyorum.'], sesGiris: ['Fuber', 'bu sesle söylerim'], dinlemeSozu: ['Fuber'],
    izinBilgisayar: ['Alt+Shift+Q'], surer: ['Hafif sürüm', 'Orta sürüm'], hesapDurumKredi: ['info@ornek.example'],
  };
  let say = 0;
  for (const [ad, deger] of Object.entries(KM)) {
    if (ad === 'hazirsin') continue; // (siz, ad) -> metin: aşağıda
    const c = (typeof deger === 'function' ? (deger as (...a: unknown[]) => Cift)(...(ornek[ad] ?? [])) : deger) as Cift;
    assert.equal(c.length, 2, ad);
    if (!NOTR.has(ad)) assert.notEqual(c[0], c[1], `${ad}: sen ve siz aynı (tarafsızsa NOTR'a yaz)`);
    // T34b (Kaygı 2): çift-bilinçli — siz metnindeki aday ancak sen metninde AYNEN geçiyorsa kusur ("geçin" ↔ "geç" geçer, "toplantın" iki yanda aynıysa düşer).
    assert.equal(senEkiVar(c[1], c[0]), null, `${ad}: siz metninde sen eki: «${c[1]}» → ${senEkiVar(c[1], c[0])}`);
    say++;
  }
  assert.ok(say >= 70, `çift sayısı ${say}`);
  // Denetimin kendisi sen ekini yakalar (kör değil).
  for (const sen of ['Bu bilgisayara bakıyorsun', 'Ayarlar’dan açarsın', 'toplantın var', 'ekranın üstünde', 'sana yazarım', 'Sessiz saatlerin']) assert.notEqual(senEkiVar(sen), null, sen);
  assert.equal(senEkiVar('Ayarlar’dan açarsınız. Fuber’in sesi. Bugün hatırlatın.'), null);
  // Seçim: resmî hitapta siz, hitapsızda sen.
  assert.equal(sec(sizliMi('Bey'), KM.kipGiris), KM.kipGiris[1]);
  assert.equal(sec(sizliMi(''), KM.kipGiris), KM.kipGiris[0]);
  assert.equal(sec(sizliMi('Patron'), KM.kipGiris), KM.kipGiris[0]);
  assert.equal(KM.hazirsin(true, 'Deniz Bey'), 'Hazırsınız, Deniz Bey.');
  // Örnek sözlerin siz tarafı da temiz.
  for (const g of [{ eposta: true, dosya: true, tarayici: true }, { eposta: false, dosya: false, tarayici: false }, { eposta: false, dosya: true, tarayici: false, yerel: true }]) {
    for (const x of ilkSozCiftleri(g)) assert.equal(senEkiVar(x[1].replace(/[“”]/g, '')), null, x[1]);
  }
  // Paylaşılan modüllerin siz kolları (sen metinleri orada, çiftler burada).
  assert.equal(senEkiVar(KM.neredeFuber[1]), null);
});

test('11c · senEkiVar çift-bilinçli (T34b, T32 Kaygı 2): siz sözcüğü ancak sen metninde aynen geçiyorsa kusur; canlı betik KM siz sütunundan beslenir', () => {
  // Çiftsiz denetimde siz emri sen iyeliğine benzer (yanlış pozitif); çift verilince geçer.
  assert.equal(senEkiVar('iletişime geçin.'), 'geçin');
  assert.equal(senEkiVar('iletişime geçin.', 'iletişime geç.'), null);
  for (const [sen, siz] of [['Konuş.', 'Konuşun.'], ['Bana gönder.', 'Bana gönderin.'], ['Bak.', 'Bakın.'], ['Ver.', 'Verin.'], ['Gir.', 'Girin.'], ['Başla.', 'Başlayın.']]) assert.equal(senEkiVar(siz, sen), null, siz);
  // Gerçek çeviri atlaması yakalanır: sözcük iki yanda aynı.
  assert.equal(senEkiVar('Bugün 3 toplantın var.', 'Bugün 3 toplantın var.'), 'toplantın');
  assert.equal(senEkiVar('Ayarlar’dan açarsın.', 'Ayarlar’dan açarsın.'), 'açarsın');
  // T34b düzeltme turu 1 (I2): çift istisnası yalnız iyelikte — "-sın/-sin" fiil eki siz metninde hiçbir biçimde meşru değil, çiftle de kusur.
  assert.equal(senEkiVar('Kuruluma devam edersin.', 'Kuruluma devam edebilirsin.'), 'edersin');
  assert.equal(senEkiVar('Ayarlar’dan açarsın.', 'Ayarlar’dan açabilirsin.'), 'açarsın');
  assert.equal(senEkiVar('Kuruluma devam edersin.', kmSizSozcukleri()), 'edersin');
  // Zamir her zaman kusur (siz metninde meşru biçimi yok).
  assert.equal(senEkiVar('Sonra sana yazarım.', 'Sonra sana yazarım.'), 'sana');
  assert.equal(senEkiVar('Sonra sana yazarım.', 'Sonra yazarım.'), 'sana');
  // Canlı betik için çiftsiz yol: KM siz sütununda olup sen sütununda olmayan sözcükler meşru siz'dir.
  assert.ok(kmSizSozcukleri().has('geçin'), 'geçin');
  assert.ok(!kmSizSozcukleri().has('toplantın'), 'toplantın sen sütununda');
  assert.equal(senEkiVar('Kullanım hakkınız doldu. info@ornek.example ile iletişime geçin.', kmSizSozcukleri()), null);
  assert.equal(senEkiVar('Deniz Bey, toplantın 10 dakika sonra.', kmSizSozcukleri()), 'toplantın');
  // Paralel biçim (sen buyruk ↔ siz buyruk).
  assert.deepEqual(KM.hesapDurumKredi('info@ornek.example'), ['Kullanım hakkın doldu. info@ornek.example ile iletişime geç.', 'Kullanım hakkınız doldu. info@ornek.example ile iletişime geçin.']);
});

test('12 · Sabah özeti sözü tutsun: "Windows açılınca başlat" varsayılan açık, kurulum bitince uygulanır; test ve önizlemede gerçek başlangıç kaydına yazılmaz', async () => {
  assert.equal(taslakBaslangici({}, 'ilk').baslangictaAc, true);
  assert.equal(taslakBaslangici({ baslangictaAc: false }, 'ilk').baslangictaAc, true, 'yeni kurulum önerilen açık');
  assert.equal(taslakBaslangici({ baslangictaAc: false }, 'yeniden').baslangictaAc, false, 'yeniden açılan kayıtlı değeri gösterir');
  assert.equal(kurulumTamamlaGovdesi({ ...taslakBaslangici({}, 'ilk'), baslangictaAc: false }).baslangictaAc, false);
  assert.equal(kurulumTamamlaGovdesi(taslakBaslangici({}, 'ilk')).baslangictaAc, true);
  const g = oku('src/renderer/kurulum2/adimlar/Gunun.tsx');
  assert.match(g, /Windows açılınca başlat/);
  assert.match(g, /degistir\(\{ baslangictaAc \}\)/);
  assert.doesNotMatch(kod('src/renderer/kurulum2/adimlar/Gunun.tsx'), /sabah özeti gelmez|baslangic-notu/);
  // Sabah özeti kapalıyken de anahtar durur: koşula bağlı değil.
  assert.doesNotMatch(g, /t\.sabah && <div className="k2-satir" data-baslangic/);
  // Uygulama: yalnız paketli uygulamada ve değiştiyse; test/önizleme kipinde ayrıca setLoginItemSettings etkisiz (mevcut koruma).
  const ipc = oku('src/main/ipc.ts');
  assert.match(ipc, /if \(typeof v\.baslangictaAc === 'boolean'\) a\.baslangictaAc = v\.baslangictaAc;/);
  assert.match(ipc, /if \(app\.isPackaged && ayarlar\(\)\.baslangictaAc !== baslangicOnce\) app\.setLoginItemSettings\(/);
  const kip = oku('src/main/arka-plan-test.ts');
  assert.ok(kip.indexOf('if (!arkaPlanKipi(process.env)) return;') < kip.indexOf('app.setLoginItemSettings = () => undefined;'), 'koruma: arka plan kipinde etkisiz');
  assert.match(oku('src/renderer/kurulum2/Kurulum2.tsx'), /baslangictaAc: taslak\.baslangictaAc/, 'yeniden açılan Bitti de yazar');
});

test('0.15: "Yalnız hesap" alt başlığı hesabın isteğe bağlı olduğuyla çelişmez', () => {
  for (const metin of KM.hesapFormYalniz) {
    assert.doesNotMatch(metin, /artık/i);
    assert.doesNotMatch(metin, /çalışıyor/i);
  }
  assert.match(KM.hesapFormYalniz[1], /Hesabınızla giriş yapın\./);
});
