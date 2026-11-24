// Yerel beyin kurulumunun "bekleyen" kaydı (Görev 15, düzeltme 1-2): istenen bir kurulum (sihirbaz ya da Ayarlar → "Kur") sürerken
// kokpitte ilerleme kartı, uygulama kapanınca ya da hatayla yarıda kalırsa "Sürdür / Vazgeç" kartı çıkar. Hata metinleri İş modunda
// teknik sözcüksüz (K2). Kurulumdan önce disk denetimi: indirilecek + açılacak + güvenlik payı.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bekleyenBildirimi, yerelHataSade, kurulumDiskGereksinimi, kurulumDiskHesabi, bitinceAcilirMi, indirmeDuyurusu, DISK_GUVENLIK_PAYI } from '../src/shared/yerel-bekleyen.ts';

const B = { model: 'bonsai2-27b' as const, zaman: '2026-10-25T10:00:00.000Z' };

test('bekleyen yoksa kart yok; durum gelmeden yok; yarım kaldıysa "yarim", hata varsa "hata"', () => {
  assert.equal(bekleyenBildirimi(undefined, { modeller: [] }), null);
  assert.equal(bekleyenBildirimi(B, null), null); // durum gelmeden çizilmez (titreme yok)
  assert.deepEqual(bekleyenBildirimi(B, { modeller: [{ ad: 'bonsai2-27b', kurulu: false }] }), { tur: 'yarim', model: 'bonsai2-27b' });
  assert.deepEqual(bekleyenBildirimi({ ...B, hata: 'Diskte yer kalmadı.' }, { indirme: { yuzde: 40, adim: 'Kurulum durdu', hata: 'Diskte yer kalmadı.' }, modeller: [] }), { tur: 'hata', model: 'bonsai2-27b', hata: 'Diskte yer kalmadı.' });
});

test('istenen indirme sürerken "iniyor" (kokpitte ilerleme); BAŞKA bir model iniyorsa kart yok', () => {
  assert.deepEqual(bekleyenBildirimi(B, { inen: 'bonsai2-27b', indirme: { yuzde: 3, adim: 'x' }, modeller: [] }), { tur: 'iniyor', model: 'bonsai2-27b' });
  assert.deepEqual(bekleyenBildirimi(B, { indirme: { yuzde: 3, adim: 'x' }, modeller: [] }), { tur: 'iniyor', model: 'bonsai2-27b' });
  assert.equal(bekleyenBildirimi(B, { inen: 'bonsai2-9b', indirme: { yuzde: 3, adim: 'x' }, modeller: [] }), null);
});

// Hata anındaki durum yayınında "inen" henüz silinmemiş olabilir (kurulum.ts: hata yayını, sonra iş kaydı temizlenir): hatalı indirme
// sürüyor sayılmaz.
test('hata veren indirme sürüyor sayılmaz ("inen" kalmış olsa da): kart "hata"', () => {
  assert.deepEqual(bekleyenBildirimi({ ...B, hata: 'x' }, { inen: 'bonsai2-27b', indirme: { yuzde: 0, adim: 'Kurulum durdu', hata: 'x' }, modeller: [] }), { tur: 'hata', model: 'bonsai2-27b', hata: 'x' });
});

test('model zaten kuruluysa (kayıt temizlenmeden kapanmış) kart yok', () => {
  assert.equal(bekleyenBildirimi(B, { modeller: [{ ad: 'bonsai2-27b', kurulu: true }] }), null);
});

test('İş modu hata metni: model adı, dosya adı, SHA, HTTP adresi yok; anlamı korunur', () => {
  const durumlar: [string, RegExp][] = [
    ['Diskte yer kalmadı.', /^Diskte yer kalmadı\.$/],
    ['Başka bir indirme sürüyor (Bonsai 2 · 27B); önce o bitsin ya da durdur.', /^Bu bilgisayardaki yapay zekânın başka bir indirmesi sürüyor/],
    ['SHA-256 doğrulanamadı: Ternary-Bonsai-2-27B-PQ2_0.gguf (dosya bozuk ya da değiştirilmiş)', /doğrulanamadı.*yeniden dene/],
    ['HTTP 404: https://huggingface.co/prism-ml/x.gguf', /İndirme sunucusuna ulaşılamadı/],
    ['fetch failed', /İndirme sunucusuna ulaşılamadı/],
    ['Bonsai 2 · 27B kurulamadı; model değiştirilmedi.', /^Bu bilgisayardaki yapay zekâ kurulamadı; yeniden dene\.$/],
    ['Kurulum tamamlanamadı (llama-server.exe ya da model bulunamadı).', /^Bu bilgisayardaki yapay zekâ kurulamadı; yeniden dene\.$/],
  ];
  for (const [ham, beklenen] of durumlar) {
    const s = yerelHataSade(ham);
    assert.match(s, beklenen, ham);
    assert.doesNotMatch(s, /model|Bonsai|SHA|HTTP|\.gguf|\.exe|llama|https?:/i, `${ham} → ${s}`);
  }
});

// B6 (G15, son düzeltme): inmiş ama açılmamış arşivin açma payı sayılır; inecek parçanın eski yarım dosyası baştan yazılacağı için boş sayılır.
test('B6: disk hesabı — inmiş arşive açma payı, eski yarım dosya geri kazanılır; hiçbir iş yoksa 0', () => {
  assert.deepEqual(kurulumDiskHesabi([]), { gereken: 0, geriKazanilan: 0 });
  assert.deepEqual(kurulumDiskHesabi([{ boyut: 1e9, acilacak: false, indi: true }]), { gereken: 0, geriKazanilan: 0 }, 'inmiş model: iş yok');
  // İnmiş ama açılmamış çalıştırıcı arşivi: yalnız açma payı (×1,5) + güvenlik payı.
  assert.equal(kurulumDiskHesabi([{ boyut: 100e6, acilacak: true, indi: true }]).gereken, 150e6 + DISK_GUVENLIK_PAYI);
  // Model yeniden inecek, eski 3 GB'lık yarım dosyası var: gereken tam boyut, 3 GB boş sayılır.
  const h = kurulumDiskHesabi([{ boyut: 7e9, acilacak: false, indi: false, yarim: 3e9 }, { boyut: 100e6, acilacak: true, indi: true, yarim: 50e6 }]);
  assert.equal(h.gereken, 7e9 + 150e6 + DISK_GUVENLIK_PAYI);
  assert.equal(h.geriKazanilan, 3e9, 'inmiş parçanın yarım dosyası sayılmaz (inmeyecek)');
  assert.equal(kurulumDiskGereksinimi([{ boyut: 1e9, acilacak: false }]), 1e9 + DISK_GUVENLIK_PAYI, 'eski çağrı aynı sonucu verir');
});

test('B6: "bitince açılır" yalnız gerçekten açılacaksa (indirme başlarken açıkken elle kapatıldıysa açılmaz)', () => {
  assert.equal(bitinceAcilirMi({ etkinBaslangic: true }, false), false, 'açıktı, sonra elle kapatıldı');
  assert.equal(bitinceAcilirMi({ etkinBaslangic: true }, true), true);
  assert.equal(bitinceAcilirMi({ etkinBaslangic: false }, false), true, 'kapalıyken istendi: bitince açılır');
  assert.equal(bitinceAcilirMi({}, false), true);
});

test('B6: indirme duyurusu yalnız %10 adımlarında ve durum değişince değişir; İş modunda teknik ad yok', () => {
  const d = (yuzde: number) => indirmeDuyurusu({ yuzde, adim: 'Model (Bonsai 2 · 9B) · 512/7000 MB' }, true);
  assert.equal(d(3), d(9));
  assert.notEqual(d(9), d(10));
  assert.equal(d(47), 'Bu bilgisayardaki yapay zekâ indiriliyor, yüzde 40');
  assert.equal(d(100), 'Bu bilgisayardaki yapay zekâ kuruldu');
  assert.equal(indirmeDuyurusu({ yuzde: 100 }, false), 'Yerel model kuruldu', 'Geliştirici: sözlükteki adı');
  const hata = indirmeDuyurusu({ yuzde: 40, hata: 'SHA-256 doğrulanamadı: x.gguf' }, true);
  assert.match(hata, /Kurulum durdu/);
  assert.doesNotMatch(hata, /SHA|gguf|Bonsai/);
  // Ardışık 300 ms'lik ilerlemelerde (0→100, birer birer) en çok 11 farklı duyuru.
  assert.ok(new Set(Array.from({ length: 101 }, (_, i) => d(i))).size <= 11);
});

// Ana süreç kurulumdan ÖNCE diske bakar (düzeltme 2): "Sürdür" / "Yeniden dene" diski sıfıra dek dolduramasın.
test('disk gereksinimi: inecek dosyalar + açılacak arşivlerin açılmış hâli (×1,5) + güvenlik payı; inecek bir şey yoksa 0', () => {
  assert.equal(kurulumDiskGereksinimi([]), 0);
  assert.equal(kurulumDiskGereksinimi([{ boyut: 1e9, acilacak: false }]), 1e9 + DISK_GUVENLIK_PAYI);
  assert.equal(kurulumDiskGereksinimi([{ boyut: 100e6, acilacak: true }, { boyut: 1e9, acilacak: false }]), 100e6 + 150e6 + 1e9 + DISK_GUVENLIK_PAYI);
  assert.ok(DISK_GUVENLIK_PAYI >= 256 * 2 ** 20, 'pay en az 256 MB');
});
