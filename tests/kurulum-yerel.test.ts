// Kurulumda Gizli mod ve cihazdaki yapay zekâ kararları (0.10 E4 düzeltme turu 1; saf: src/shared/kurulum-yerel.ts). Gizli mod kaydedilip
// hiç hazır olmayan bir hâlde sessizce kalmamalı: Gizli modda motor yolu yalnız yerel hazırsa vardır (tek-motor.ts: hazır = açık + kurulu).
//   · gizliKaydi: Gizlilik sayfasından çıkarken kaydedilecek yama — kurulu yerel yapay zekâ varsa Gizli mod onu AÇAR (kapalı kalmış
//     yükseltilmiş/yeniden açılmış profil);
//   · yerelHazirlik: cihazdaki yapay zekâ sayfası ileri geçilirken (haritadan atlanarak da) ya da sihirbaz biterken ne yapılacağı —
//     indir / durdur / Gizli modu geri al (bilgisayar uygun değil ya da hiçbir şey başlatılamadı) / hiçbiri;
//   · hazirDurumu: Hazırsın sayfasının tek nötr durum satırı (Gizli mod açık ama yerel hazır değilse her zaman söyler).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  gizliAnahtari, gizliGeriAlindiMetni, gizliIstendiMi, gizliKaydi, gizliKapsami, hazirDurumu, kurulumOnerisi, yerelBakamadimMi, yerelCikisSecimi,
  yerelHazirlik, yerelHazirlaniyor, yerelKarariUygulansinMi, yerelOzetSecimi, GIZLI_CLAUDE_CODE, type HazirGirdisi,
} from '../src/shared/kurulum-yerel.ts';
import { HESAP_DURUM_METNI } from '../src/shared/masaustu-hesap.ts';
import { isDiliIhlali } from '../src/shared/is-dili.ts';
import { AYAR_TANIMLARI, KATEGORILER } from '../src/renderer/ayarlar/dizin.ts';
import { gorunenMetinler } from './yardimci/gorunen-metin.ts';

test('gizliKaydi: Gizli mod kurulu yerel yapay zekâyı açar; kurulu değilse yalnız Gizli mod; kapatınca yalnız Gizli mod kapanır; değişiklik yoksa null', () => {
  assert.deepEqual(gizliKaydi(true, { gizliMod: false, etkin: false }, true), { gizliMod: true, etkin: true }, 'kurulu ama kapalı (yükseltilmiş profil)');
  assert.deepEqual(gizliKaydi(true, { gizliMod: true, etkin: false }, true), { gizliMod: true, etkin: true }, 'Gizli açık ama yerel kapalı');
  assert.equal(gizliKaydi(true, { gizliMod: true, etkin: true }, true), null);
  assert.deepEqual(gizliKaydi(true, { gizliMod: false, etkin: false }, false), { gizliMod: true });
  assert.equal(gizliKaydi(true, { gizliMod: true, etkin: false }, false), null);
  assert.deepEqual(gizliKaydi(false, { gizliMod: true, etkin: true }, true), { gizliMod: false });
  assert.equal(gizliKaydi(false, { gizliMod: false, etkin: true }, true), null);
});

test('gizliIstendiMi: sayfadaki seçim kaydı ezer; seçim yoksa kayıt — bilgisayar uygun çıkınca ekranda "Normal"e dönen ama KAYITLI Gizli mod da sayılır', () => {
  assert.equal(gizliIstendiMi('gizli', false), true);
  assert.equal(gizliIstendiMi('normal', true), false, 'sayfada Normal seçildi (kayıt henüz gelmedi)');
  assert.equal(gizliIstendiMi(null, true), true, 'Gizlilik öneriyle geçildi ve kaydedildi; öneri sonradan "uygun değil" geldi');
  assert.equal(gizliIstendiMi(null, false), false);
});

test('I1 inceleme (Önemli): sayfa "bakamadım" gösterdiyse çıkışta etkin seçim "Şimdilik hayır" — sonradan gelen durum görülmemiş indirme başlatmaz', () => {
  assert.equal(yerelCikisSecimi('evet', { oneriVar: false, sureDoldu: true }), 'hayir', '"bakamadım" gösterildi');
  assert.equal(yerelCikisSecimi('evet', { oneriVar: true, sureDoldu: true }), 'evet', 'öneri geldi: seçim gösterildi');
  // I1 yeniden incelemesi: yeniden açılan sihirbazda haritayla ilk 10 sn içinde ("Bilgisayarına bakıyorum…") çıkılınca da — süreye bakmadan.
  assert.equal(yerelCikisSecimi('evet', { oneriVar: false, sureDoldu: false }), 'hayir', 'hâlâ bakıyordu: seçim gösterilmedi');
  assert.equal(yerelCikisSecimi('hayir', { oneriVar: true, sureDoldu: false }), 'hayir');
  // Sonradan öneri gelse de sihirbaz biterken karar indirme değildir.
  assert.equal(yerelHazirlik({ gizli: false, istiyor: yerelCikisSecimi('evet', { oneriVar: false, sureDoldu: true }) === 'evet', oneri: { uygun: true }, kurulu: false, iniyor: false, baslatildi: false }), 'yok');
});

test('I1 yeniden inceleme: sol panel, öneri gösterilmemişken ("bakıyorum" / "bakamadım") "İstiyorum" demez', () => {
  assert.equal(yerelOzetSecimi('evet', { oneriVar: false }), undefined);
  assert.equal(yerelOzetSecimi('hayir', { oneriVar: false }), 'hayir', 'çıkışta "Şimdilik hayır" oldu: "Sonra"');
  assert.equal(yerelOzetSecimi('evet', { oneriVar: true }), 'evet');
});

test('I1 inceleme: cihazdaki yapay zekânın kararı (sayfa atlanırken ve "Bitti"de) yalnız sayfa görüldüyse ya da Gizli mod BU sihirbazda açıldıysa', () => {
  assert.equal(yerelKarariUygulansinMi({ yerelGoruldu: true, gizliIstendi: false, acilistaGizli: false }), true);
  assert.equal(yerelKarariUygulansinMi({ yerelGoruldu: false, gizliIstendi: true, acilistaGizli: false }), true, 'Gizli bu sihirbazda açıldı');
  assert.equal(yerelKarariUygulansinMi({ yerelGoruldu: false, gizliIstendi: true, acilistaGizli: true }), false, 'kayıtlı Gizli mod, sayfasına uğranmadı: geri alınmaz');
  assert.equal(yerelKarariUygulansinMi({ yerelGoruldu: false, gizliIstendi: false, acilistaGizli: false }), false, 'görülmemiş "İstiyorum" indirme başlatmaz');
});

const OK = { uygun: true } as const;
test('yerelHazirlik: istenen ve uygun → indir; zaten kurulu, iniyor ya da başlatıldıysa → yok', () => {
  assert.equal(yerelHazirlik({ gizli: false, istiyor: true, oneri: OK, kurulu: false, iniyor: false, baslatildi: false }), 'indir');
  assert.equal(yerelHazirlik({ gizli: true, istiyor: false, oneri: OK, kurulu: false, iniyor: false, baslatildi: false }), 'indir', 'Gizli mod "Şimdilik hayır"ı ezer');
  assert.equal(yerelHazirlik({ gizli: true, istiyor: true, oneri: OK, kurulu: true, iniyor: false, baslatildi: false }), 'yok');
  assert.equal(yerelHazirlik({ gizli: false, istiyor: true, oneri: OK, kurulu: false, iniyor: true, baslatildi: false }), 'yok');
  assert.equal(yerelHazirlik({ gizli: true, istiyor: true, oneri: OK, kurulu: false, iniyor: false, baslatildi: true }), 'yok', 'çift başlatma yok');
});

test('yerelHazirlik: Gizli mod seçili ama bilgisayar uygun değil ya da öneri bilinmiyor → Gizli modu geri al; Normal\'de hiçbir şey', () => {
  const uygunDegil = { uygun: false } as const;
  assert.equal(yerelHazirlik({ gizli: true, istiyor: true, oneri: uygunDegil, kurulu: false, iniyor: false, baslatildi: false }), 'gizli-geri-al');
  assert.equal(yerelHazirlik({ gizli: true, istiyor: true, oneri: null, kurulu: false, iniyor: false, baslatildi: false }), 'gizli-geri-al');
  assert.equal(yerelHazirlik({ gizli: false, istiyor: true, oneri: uygunDegil, kurulu: false, iniyor: false, baslatildi: false }), 'yok');
  assert.equal(yerelHazirlik({ gizli: false, istiyor: true, oneri: null, kurulu: false, iniyor: false, baslatildi: false }), 'yok');
});

test('yerelHazirlik: "Şimdilik hayır" yalnız bu sihirbazın başlattığı indirmeyi durdurur', () => {
  assert.equal(yerelHazirlik({ gizli: false, istiyor: false, oneri: OK, kurulu: false, iniyor: true, baslatildi: true }), 'durdur');
  assert.equal(yerelHazirlik({ gizli: false, istiyor: false, oneri: OK, kurulu: false, iniyor: true, baslatildi: false }), 'yok', 'önceden başlamış indirmeye dokunulmaz');
  assert.equal(yerelHazirlik({ gizli: false, istiyor: false, oneri: OK, kurulu: false, iniyor: false, baslatildi: false }), 'yok');
});

// I1 (R19): sihirbaz motor durumunu YALNIZ motorGorunumu'dan alır (shared/motor-durumu.ts; kendi kuralı yok).
const H: HazirGirdisi = { mod: 'is', gorunum: 'bagli-degil', gizliMod: false, yerelHazir: false, yerelIniyor: false, yerelIstendi: false };
test('hazirDurumu: Gizli mod açık ama yerel hazır değilse HER ZAMAN söyler (hesap ya da bulut olsa da); hazırsa satır yok', () => {
  assert.match(hazirDurumu({ ...H, gizliMod: true, yerelIniyor: true }) ?? '', /^Gizli mod hazırlanıyor — bu bilgisayardaki yapay zekâ iniyor/);
  assert.match(hazirDurumu({ ...H, gizliMod: true, yerelIstendi: true, gorunum: 'hazir' }) ?? '', /^Gizli mod hazırlanıyor/);
  assert.match(hazirDurumu({ ...H, gizliMod: true, gorunum: 'hesap-kapali' }) ?? '', /^Gizli mod açık ama bu bilgisayardaki yapay zekâ hazır değil/);
  assert.equal(hazirDurumu({ ...H, gizliMod: true, yerelHazir: true, gorunum: 'kredi-bitti' }), null, 'Gizli modda hesap hâli söylenmez');
});

test('hazirDurumu: Gizli mod geri alındıysa — yalnız ÖLÇÜLDÜYSE "yetmiyor"; ölçülmediyse doğru cümle (I1 5b)', () => {
  assert.equal(hazirDurumu({ ...H, gizliGeriAlindi: 'yetmiyor' }), 'Bu bilgisayar gizli mod için yetmiyor; Normal modda sürdürüyorum.');
  assert.equal(hazirDurumu({ ...H, gizliGeriAlindi: 'hazir-degil' }), 'Gizli mod için bu bilgisayardaki yapay zekâ hazır değil; Normal modda sürdürüyorum.');
});

test('hazirDurumu: Normal modda hesap hâlleri R10 metinleri (sakin, düğmesiz satır); hazır ve yerel → satır yok', () => {
  assert.equal(hazirDurumu({ ...H, gorunum: 'hesap-bekliyor' }), HESAP_DURUM_METNI.bekliyor);
  assert.equal(hazirDurumu({ ...H, gorunum: 'hesap-kapali' }), HESAP_DURUM_METNI.kapali);
  assert.equal(hazirDurumu({ ...H, gorunum: 'kredi-bitti' }), HESAP_DURUM_METNI['kredi-bitti']);
  assert.equal(hazirDurumu({ ...H, gorunum: 'hesap-bekliyor', yerelIniyor: true }), HESAP_DURUM_METNI.bekliyor, 'hesabın hâli önce');
  assert.equal(hazirDurumu({ ...H, gorunum: 'hazir' }), null);
  assert.equal(hazirDurumu({ ...H, gorunum: 'yerel' }), null);
});

test('I2 (sözlük P2): Hazırsın satırı Geliştirici\'de "yerel model" der, İş\'te "bu bilgisayardaki yapay zekâ"', () => {
  const G = { ...H, mod: 'gelistirici' as const };
  assert.equal(hazirDurumu({ ...G, gizliMod: true, yerelIniyor: true }), 'Gizli mod hazırlanıyor — yerel model iniyor; inince sohbet açılır.');
  assert.equal(hazirDurumu({ ...G, gizliMod: true }), 'Gizli mod açık ama yerel model hazır değil. Ayarlar → Gizlilik’ten kurarsın.');
  assert.equal(hazirDurumu({ ...G, gizliGeriAlindi: 'hazir-degil' }), 'Gizli mod için yerel model hazır değil; Normal modda sürdürüyorum.');
  assert.equal(hazirDurumu({ ...G, yerelIniyor: true }), 'Yerel model arka planda iniyor; inince sohbet açılır.');
  assert.equal(hazirDurumu({ ...H, yerelIniyor: true }), 'Bu bilgisayardaki yapay zekâ arka planda iniyor; inince sohbet açılır.');
});

test('hazirDurumu: bağlı değil / koptu — iniyorsa iniyor, değilse bağlanacak hesap; en çok iki cümle, İş dili', () => {
  assert.match(hazirDurumu({ ...H, yerelIniyor: true }) ?? '', /arka planda iniyor; inince sohbet açılır/);
  assert.match(hazirDurumu({ ...H, gorunum: 'durdu', yerelIstendi: true }) ?? '', /arka planda iniyor/);
  assert.match(hazirDurumu(H) ?? '', /bulut yapay zekâ/);
  // 0.13 (ürün kararı): Developer'da da kendi anahtarı yok; kurulum artık Developer'a ulaşabildiği için özet de bunu vaat etmez.
  assert.equal(hazirDurumu({ ...H, mod: 'gelistirici' }), hazirDurumu(H));
  assert.doesNotMatch(hazirDurumu({ ...H, mod: 'gelistirici' }) ?? '', /kendi hesabını|Yapay zekâ’dan/);
  assert.match(hazirDurumu({ ...H, gorunum: 'durdu' }) ?? '', /^Fuber’in bağlantısı koptu/);
  const tumu = [
    hazirDurumu({ ...H, gizliMod: true, yerelIniyor: true }), hazirDurumu({ ...H, gizliMod: true }), hazirDurumu({ ...H, gizliGeriAlindi: 'yetmiyor' }),
    hazirDurumu({ ...H, gizliGeriAlindi: 'hazir-degil' }), hazirDurumu({ ...H, yerelIniyor: true }), hazirDurumu(H), hazirDurumu({ ...H, gorunum: 'durdu' }),
    hazirDurumu({ ...H, gorunum: 'hesap-kapali' }), hazirDurumu({ ...H, gorunum: 'kredi-bitti' }),
  ];
  for (const m of tumu) {
    assert.ok(m && (m.match(/[.!?](\s|$)/g) ?? []).length <= 2, m ?? '');
    assert.doesNotMatch(m ?? '', /beyin|\bmodel|\bAPI\b|anahtar|motor/i);
  }
});

// F1 (son inceleme Ö2): "yerel hazırlanıyor" TEK kural — ana süreç sinyali (main/abonelik.ts motorDurumu → `hazirlaniyor`) bunu okur;
// Gizli + hazır değil + hazırlanıyor nötr 'hazirlaniyor' (shared/motor-durumu.ts). Kalıcı hata (bekleyen kaydında `hata`) ve kaldırma
// hazırlık sayılmaz.
test('F1 Ö2: yerelHazirlaniyor — bekleyen kurulum hatasız ya da indirme sürüyor; kalıcı hata, kayıt yok + indirme yok ve "Kaldır" → değil', () => {
  assert.equal(yerelHazirlaniyor({ iniyor: true, bekleyen: null }), true, 'indirme sürüyor');
  assert.equal(yerelHazirlaniyor({ iniyor: false, bekleyen: {} }), true, 'bekleyen kurulum (yarıda kaldı / başlıyor), hatasız');
  assert.equal(yerelHazirlaniyor({ iniyor: false, bekleyen: { hata: 'Diskte yer kalmadı.' } }), false, 'kalıcı hata');
  assert.equal(yerelHazirlaniyor({ iniyor: true, bekleyen: { hata: 'Diskte yer kalmadı.' } }), true, '"Yeniden dene" sürerken');
  assert.equal(yerelHazirlaniyor({ iniyor: false, bekleyen: null }), false);
  assert.equal(yerelHazirlaniyor({ iniyor: false, bekleyen: undefined }), false);
  assert.equal(yerelHazirlaniyor({ iniyor: true, bekleyen: {}, kaldiriliyor: true }), false, '"Kaldır" sürüyor: hazırlık değil');
});

// F1 (son inceleme Ö1): Ayarlar → Gizlilik'teki Gizli mod anahtarı GERÇEK hâli gösterir (gizliMod); Gizli'den ÇIKMAK her zaman serbest,
// AÇMAK kurulu ve açık yerel ister (renderer/ayarlar/Gizlilik.tsx bunu okur).
test('F1 Ö1: Gizli açık + yerel kurulu değil → Ayarlar anahtarı AÇIK görünür ve kapatılabilir; açma kuralı aynı', () => {
  const A = { mod: 'is' as const };
  const k = (gizliMod: boolean, kurulu: boolean, etkin: boolean, hazirlaniyor = false) => gizliAnahtari({ ...A, gizliMod, kurulu, etkin, hazirlaniyor });
  assert.deepEqual([k(true, false, false).acik, k(true, false, false).devreDisi], [true, false], 'Gizli açık, yerel kurulu değil: açık ve kapatılabilir');
  assert.deepEqual([k(true, true, false).acik, k(true, true, false).devreDisi], [true, false], 'Gizli açık, yerel kapalı');
  assert.deepEqual([k(true, true, true).acik, k(true, true, true).devreDisi], [true, false]);
  assert.deepEqual([k(false, false, false).acik, k(false, false, false).devreDisi], [false, true], 'açmak kurulu yerel ister');
  assert.deepEqual([k(false, true, false).acik, k(false, true, false).devreDisi], [false, true], 'açmak açık yerel ister');
  assert.deepEqual([k(false, true, true).acik, k(false, true, true).devreDisi], [false, false]);
  // Satırın notu gerçeği söyler: hazırlanırken Hazırsın satırıyla aynı cümle, hazır değilken kapatılabileceği; kapalıyken eski kural.
  assert.equal(k(true, false, false, true).not, ` ${hazirDurumu({ ...H, gizliMod: true, yerelIniyor: true })}`);
  // Düzeltme turu 1 (K-1): indirme duraklamışsa (yarım) satır da Hazırsın'ın yarım dalını söyler — aynı kaynak.
  assert.equal(gizliAnahtari({ ...A, gizliMod: true, kurulu: false, etkin: false, hazirlaniyor: true, yarim: true }).not, ' Gizli mod hazırlanıyor — indirme yarıda kaldı; sürdürünce sohbet açılır.');
  assert.equal(hazirDurumu({ ...H, gizliMod: true, yerelIstendi: true, yerelYarim: true }), 'Gizli mod hazırlanıyor — indirme yarıda kaldı; sürdürünce sohbet açılır.');
  assert.equal(hazirDurumu({ ...H, gizliMod: true, yerelIniyor: true, yerelYarim: false }), 'Gizli mod hazırlanıyor — bu bilgisayardaki yapay zekâ iniyor; inince sohbet açılır.');
  assert.equal(k(true, true, true).not, ' Şu an açık: yanıtları bu bilgisayar veriyor.');
  assert.equal(k(true, false, false).not, ' Şu an açık ama bu bilgisayardaki yapay zekâ hazır değil; kurabilir ya da Gizli modu kapatabilirsin.');
  assert.equal(k(false, false, false).not, ' Önce bu bilgisayardaki yapay zekâyı kur ve aç.');
  assert.equal(gizliAnahtari({ mod: 'gelistirici', gizliMod: false, kurulu: false, etkin: false }).not, ' Önce yerel modeli kur ve aç.');
  assert.equal(gizliAnahtari({ mod: 'gelistirici', gizliMod: true, kurulu: false, etkin: false }).not, ' Şu an açık ama yerel model hazır değil; kurabilir ya da Gizli modu kapatabilirsin.');
  assert.equal(k(false, true, true).not, '');
  for (const g of [true, false]) for (const ku of [true, false]) for (const e of [true, false]) for (const h of [true, false]) assert.equal(isDiliIhlali(k(g, ku, e, h).not), null);
});

test('F1 Ö1: Gizli kendiliğinden kapanınca kokpitin TEK sakin cümlesi — sözlüğe uygun (İş "bu bilgisayardaki yapay zekâ", Geliştirici "yerel model")', () => {
  assert.equal(gizliGeriAlindiMetni('hata', 'is'), 'Bu bilgisayardaki yapay zekâ kurulamadı; Gizli modu kapattım. Ayarlar → Gizlilik’ten yeniden deneyebilirsin.');
  // Düzeltme turu 1 (N-3): Gizlilik'teki anahtar yerel kurulmadan açılmaz — "yeniden kurup açabilirsin".
  assert.equal(gizliGeriAlindiMetni('vazgec', 'is'), 'Bu bilgisayardaki yapay zekâ kurulmadı; Gizli modu kapattım. İstediğin an Ayarlar → Gizlilik’ten yeniden kurup açabilirsin.');
  assert.equal(gizliGeriAlindiMetni('hata', 'gelistirici'), 'Yerel model kurulamadı; Gizli modu kapattım. Ayarlar → Gizlilik’ten yeniden deneyebilirsin.');
  assert.equal(gizliGeriAlindiMetni('vazgec', 'gelistirici'), 'Yerel model kurulmadı; Gizli modu kapattım. İstediğin an Ayarlar → Gizlilik’ten yeniden kurup açabilirsin.');
  // Düzeltme turu 1 (N-1): açılışta üçüncü hâl (Gizli açık, hazır değil, hazırlanmıyor) — nötr neden ("kurulamadı" değil).
  assert.equal(gizliGeriAlindiMetni('hazir-degil', 'is'), 'Bu bilgisayardaki yapay zekâ hazır değildi; Gizli modu kapattım. Ayarlar → Gizlilik’ten kurup açabilirsin.');
  assert.equal(gizliGeriAlindiMetni('hazir-degil', 'gelistirici'), 'Yerel model hazır değildi; Gizli modu kapattım. Ayarlar → Gizlilik’ten kurup açabilirsin.');
  for (const n of ['hata', 'vazgec', 'hazir-degil'] as const) {
    assert.equal(isDiliIhlali(gizliGeriAlindiMetni(n, 'is')), null, n);
    assert.doesNotMatch(gizliGeriAlindiMetni(n, 'is'), /beyin|mesele|hata/i, n);
  }
});

// F1 (son inceleme K3): bilgisayar okunamazsa (sistem:kontrol hata verdi ya da 10 sn'de yanıt vermedi) öneri ÖLÇÜLMÜŞ gibi gösterilmez —
// eskiden "8 GB, NVIDIA yok" varsayılıp "Bu bilgisayar için önerilen: Hafif sürüm · ~X GB iner" deniyor, disk denetlenmiyor, "İstiyorum"
// seçili kalıyordu. Artık "bakamadım" yolu (I1: ölçülmemiş şey söylenmez) ve varsayılan "Şimdilik hayır" (yerelCikisSecimi).
test('K3: sistem okunamadı → öneri yok, sayfa hemen "bakamadım", çıkışta "Şimdilik hayır"; kurulu yerel ölçüm istemez; ölçülen disk engeldir', () => {
  const modeller = [
    { ad: 'bonsai2-27b' as const, boyut: 15e9, ramGB: 24, vramGB: 16, kurulu: false },
    { ad: 'bonsai2-9b' as const, boyut: 5e9, ramGB: 12, vramGB: 8, kurulu: false },
    { ad: 'bonsai2-4b' as const, boyut: 1.3e9, ramGB: 6, kurulu: false },
  ];
  const yd = { kurulu: { calistirici: false, model: false }, modeller };
  const olcum = { platform: 'win32', surum: '10.0.22631', ramGB: 16, bosDiskGB: 200, nvidia: false };
  const g = { model: 'bonsai2-27b' as const, islemciZorla: false };
  assert.equal(kurulumOnerisi({ ...g, sistem: 'hata', yerel: yd }), null, 'okunamayan bilgisayar için öneri yok');
  assert.equal(kurulumOnerisi({ ...g, sistem: null, yerel: yd }), null, 'okunuyor');
  assert.equal(kurulumOnerisi({ ...g, sistem: olcum, yerel: null }), null, 'yerel durum yok');
  const o = kurulumOnerisi({ ...g, sistem: olcum, yerel: yd });
  assert.ok(o?.uygun && o.model === 'bonsai2-4b', JSON.stringify(o));
  assert.equal(kurulumOnerisi({ ...g, sistem: { ...olcum, bosDiskGB: 1 }, yerel: yd })?.uygun, false, 'ölçülen dolu disk engel sayılır');
  // Kurulu bir yerel yapay zekâ ölçüm istemez (bilgisayar okunamasa da "kurulu").
  const kurulu = { kurulu: { calistirici: true, model: true }, modeller: modeller.map((m) => ({ ...m, kurulu: m.ad === 'bonsai2-9b' })) };
  const k = kurulumOnerisi({ ...g, sistem: 'hata', yerel: kurulu });
  assert.ok(k?.uygun && k.kurulu && k.model === 'bonsai2-9b', JSON.stringify(k));
  // "Bakamadım": okunamadıysa HEMEN (10 sn beklenmez); ~10 sn dolunca da; öneri varken değil.
  assert.equal(yerelBakamadimMi({ oneriVar: false, sureDoldu: false, sistemHata: true }), true);
  assert.equal(yerelBakamadimMi({ oneriVar: false, sureDoldu: true, sistemHata: false }), true);
  assert.equal(yerelBakamadimMi({ oneriVar: false, sureDoldu: false, sistemHata: false }), false, 'hâlâ bakıyor');
  assert.equal(yerelBakamadimMi({ oneriVar: true, sureDoldu: true, sistemHata: true }), false);
  // Varsayılan "Şimdilik hayır": öneri hiç gösterilmediyse çıkışta etkin seçim "hayır" — hiçbir şey inmez.
  assert.equal(yerelCikisSecimi('evet', { oneriVar: false }), 'hayir');
  assert.equal(yerelHazirlik({ gizli: false, istiyor: false, oneri: null, kurulu: false, iniyor: false, baslatildi: false }), 'yok');
});

// F1 (son inceleme K1): Gizli mod metni ANCAK doğru olanı söz verir (koda göre): sohbet, ses, notlar ve hafıza bu bilgisayarda kalır;
// araçlar kapalı (ajan/dongu.ts: Gizli turda araç yok); e-posta ve WhatsApp bağlantıları kendi sunucularıyla eşitlemeyi sürdürür
// (entegrasyon/eposta.ts, whatsapp.ts — Gizli kapısı yok; en küçük doğru değişiklik: metin); pano ağa çıkmaz (main/pano/pano.ts);
// Geliştirici'de tek cümle: Claude Code oturumları Gizli'nin kapsamı dışında. "Hiçbir şey dışarı gitmez" gibi mutlak söz yok (hesap
// eylemleri R17 gereği Gizli'de de açık).
// Düzeltme turu 1 (K-5): "veri buluta çıkmaz" ve "bilgisayardan çıkmadan" da mutlak sözdür (e-posta/WhatsApp eşitlemesi ve Geliştirici'de
// Claude Code sürer).
const MUTLAK = /hiçbir şey (dışarı|buluta)|buluta hiçbir şey|her şey (yalnız )?bu bilgisayarda|veri buluta çıkmaz|bilgisayardan çıkmadan/i;
test('K1: Gizli metni (sihirbaz + Ayarlar) yalnız doğru olanı söz verir; mutlak söz yok; Geliştirici\'de Claude Code cümlesi', () => {
  assert.equal(GIZLI_CLAUDE_CODE, 'Claude Code oturumları Gizli modun kapsamı dışında; Anthropic üzerinden çalışır.');
  for (const mod of ['is', 'gelistirici'] as const) {
    const k = gizliKapsami(mod);
    assert.equal(k.secenek, 'Sohbet, ses, notlar ve hafıza bu bilgisayarda işlenir. Bu modda Fuber hatırlatıcı kuramaz; e-posta, WhatsApp ve tarayıcıyla iş yapamaz.');
    // Düzeltme turu 1 (K-4): "gelenleri" → "yeni iletileri".
    assert.match(k.dip, /^Bağlı e-posta ve WhatsApp yeni iletileri almayı sürdürür; hava, haber ve döviz Gizli modda güncellenmez\./);
    assert.equal(k.dip.includes(GIZLI_CLAUDE_CODE), mod === 'gelistirici', mod);
    for (const m of [k.secenek, k.dip, k.hazirlaniyor]) assert.doesNotMatch(m, MUTLAK, `${mod}: ${m}`);
  }
  // T34b (P14): sonuç sözü yok — neyin kapalı olduğu (shared/gizlilik-metni.ts).
  assert.equal(gizliKapsami('is').hazirlaniyor, 'Bu bilgisayardaki yapay zekâyı hazırlıyorum; hazır olana dek sohbetin bekler. Gizli modda buluttaki yapay zekâ kapalı.');
  assert.equal(gizliKapsami('gelistirici').hazirlaniyor, 'Yerel modeli hazırlıyorum; hazır olana dek sohbetin bekler. Gizli modda buluttaki yapay zekâ kapalı.');
  const is = gizliKapsami('is');
  for (const m of [is.secenek, is.dip, is.hazirlaniyor]) assert.equal(isDiliIhlali(m), null, m);
  // Ayarlar → Gizlilik → Gizli mod: iki mod da aynı kapsamı söyler; mutlak söz yok; Geliştirici'de Claude Code cümlesi, İş'te yok.
  const g = AYAR_TANIMLARI.get('gizli-mod')!;
  for (const [mod, m] of [['gelistirici', g.aciklama], ['is', g.aciklamaIs ?? '']] as const) {
    assert.doesNotMatch(m, MUTLAK, `${mod}: ${m}`);
    assert.match(m, /sohbet, ses, notlar ve hafıza bu bilgisayarda işlenir/i, mod);
    assert.match(m, /e-posta ve WhatsApp yeni iletileri almayı sürdürür/, mod);
    assert.match(m, /hava, haber ve döviz Gizli modda güncellenmez/, mod);
    assert.equal(m.includes(GIZLI_CLAUDE_CODE), mod === 'gelistirici', mod);
    // K-4: özne kaymaz — telefon bağlantısı ayrı cümle. T34b (P14): "her şey" denmez; mekanizma söylenir (shared/kopru-sifre.ts).
    assert.match(m, /Eşleştirdiğin telefonla bağlantı uçtan uca şifrelenir\./, mod);
  }
  assert.match(g.aciklamaIs ?? '', /Fuber’in yapay zekâsı kapalı\. Eşleştirdiğin telefonla/);
  assert.equal(isDiliIhlali(g.aciklamaIs ?? ''), null);
  // K-5: Ayarlar → Gizlilik kategorisinin BÜTÜN metinleri (giriş, grup ve ayar açıklamaları; iki mod) mutlak söz taşımaz.
  const kat = KATEGORILER.find((x) => x.id === 'gizlilik')!;
  const metinler = [kat.giris, kat.girisIs ?? '', ...kat.gruplar.flatMap((gr) => [gr.aciklama ?? '', gr.aciklamaIs ?? '', ...gr.ayarlar.flatMap((a) => [a.aciklama ?? '', a.aciklamaIs ?? ''])])];
  for (const m of metinler) assert.doesNotMatch(m, MUTLAK, m);
  assert.equal(kat.girisIs, 'Kişisel sohbetin bu bilgisayardaki yapay zekâyla yapılır.');
  assert.equal(kat.giris, 'Kişisel sohbetin bu bilgisayarda çalışan yerel modelle yapılır.');
  // H3c düzeltme turu 1 (Kü4): grubun açıklaması üç seçeneğin dili.
  assert.equal(kat.gruplar.find((gr) => gr.id === 'yerel')!.aciklama, 'Fuber, Yalnız bu bilgisayar ya da Gizli');
  // Sihirbazın Gizlilik sayfasında da eski mutlak sözler görünmez.
  const kok = path.resolve(import.meta.dirname, '..');
  const y = 'src/renderer/kurulum/GizlilikAdimi.tsx';
  const gorunen = gorunenMetinler(y, fs.readFileSync(path.join(kok, y), 'utf8')).map((m) => m.metin).filter((m) => MUTLAK.test(m));
  assert.deepEqual(gorunen, []);
});
