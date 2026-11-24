// 0.11 G6 — araç adımları insan diliyle TEK satır: shared/arac-satiri.ts `aracSatiri` (sohbet ve ada aynı işlevi kullanır).
// Araç adımlarının tasarımı tutarsızdı. Her adım: simge · ne yapıldığı ("Hatırlatıcı kuruldu · Yarın 09:00 · Yatırımcı görüşmesi") ·
// durum (sürüyor / tamam / hata). İş modunda araç adı, ham girdi/çıktı, koordinat ve teknik sözcük yok (IS_YASAK); Geliştirici'de teknik
// ayrıntı (koordinat gibi) satırda, ham girdi/çıktı kartın "Ayrıntılar"ında. P10: yazılan metin HİÇBİR etikette yok — yalnız hedef ve karakter
// sayısı (bilgisayar_yaz, tarayici_yaz, whatsapp_gonder, e-posta gövdesi).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { adimGorunurMu, aracSatiri, aracSatiriAdlari, ayrintiMetni, yazmaEtiketi, type AracSonuc } from '../src/shared/arac-satiri.ts';
import { isDiliIhlali } from '../src/shared/is-dili.ts';

const SIMDI = new Date(2026, 9, 27, 14, 0); // 27 Ekim 2026 Salı 14:00 (yerel)
const yerel = (g: number, s: number, d = 0) => new Date(2026, 9, g, s, d).toISOString();
const tamam: AracSonuc = { durum: 'tamam' };
const satir = (arac: string, girdi: unknown, sonuc: AracSonuc | undefined, mod: 'is' | 'gelistirici' = 'is') => aracSatiri(arac, girdi, sonuc, mod, SIMDI);

test('hatırlatıcı kurma: tek satır, insan dili, iki modda aynı; sürüyor / tamam / hata', () => {
  const g = { baslik: 'Yatırımcı görüşmesi', zaman: yerel(28, 9) };
  for (const mod of ['is', 'gelistirici'] as const) {
    assert.deepEqual(satir('hatirlatici_kur', g, tamam, mod), { simge: 'zil', metin: 'Hatırlatıcı kuruldu · Yarın 09:00 · Yatırımcı görüşmesi', durum: 'tamam' });
    assert.deepEqual(satir('hatirlatici_kur', g, undefined, mod), { simge: 'zil', metin: 'Hatırlatıcı kuruluyor · Yarın 09:00 · Yatırımcı görüşmesi', durum: 'suruyor' });
    assert.deepEqual(satir('hatirlatici_kur', g, { durum: 'calisiyor' }, mod), { simge: 'zil', metin: 'Hatırlatıcı kuruluyor · Yarın 09:00 · Yatırımcı görüşmesi', durum: 'suruyor' });
    assert.deepEqual(satir('hatirlatici_kur', g, { durum: 'hata', ozet: 'ham hata iletisi' }, mod), { simge: 'zil', metin: 'Hatırlatıcı kurulamadı · Yarın 09:00 · Yatırımcı görüşmesi', durum: 'hata' });
  }
});

test('zaman metni: bugün / yarın / gün adı / tarih; yerel saatle, 24 saat', () => {
  const z = (iso: string) => satir('hatirlatici_kur', { baslik: 'X', zaman: iso }, tamam).metin;
  assert.equal(z(yerel(27, 18, 30)), 'Hatırlatıcı kuruldu · Bugün 18:30 · X');
  assert.equal(z(yerel(28, 0, 5)), 'Hatırlatıcı kuruldu · Yarın 00:05 · X');
  assert.equal(z(yerel(30, 9)), 'Hatırlatıcı kuruldu · Cuma 09:00 · X');
  assert.equal(z(yerel(29, 23, 59)), 'Hatırlatıcı kuruldu · Perşembe 23:59 · X');
  assert.equal(z(new Date(2026, 10, 12, 8, 0).toISOString()), 'Hatırlatıcı kuruldu · 12 Kas 08:00 · X');
  // Zaman yoksa ya da bozuksa satır yine okunur (zaman parçası düşer).
  assert.equal(satir('hatirlatici_kur', { baslik: 'X' }, tamam).metin, 'Hatırlatıcı kuruldu · X');
  assert.equal(satir('hatirlatici_kur', { baslik: 'X', zaman: 'yarın' }, tamam).metin, 'Hatırlatıcı kuruldu · X');
});

test('WhatsApp gönderme: yalnız alıcı, mesajın metni yok (P10); reddedilen onay "gönderilmedi"', () => {
  const g = { kime: 'Ece Aydın', metin: 'GİZLİ-MESAJ-METNİ Yarın 10:00 olur mu?' };
  for (const mod of ['is', 'gelistirici'] as const) {
    const s = satir('whatsapp_gonder', g, tamam, mod);
    assert.deepEqual(s, { simge: 'wp', metin: 'WhatsApp mesajı gönderildi · Ece Aydın', durum: 'tamam' });
    assert.ok(!s.metin.includes('GİZLİ'));
    assert.equal(satir('whatsapp_gonder', g, undefined, mod).metin, 'WhatsApp mesajı gönderiliyor · Ece Aydın');
    assert.deepEqual(satir('whatsapp_gonder', g, { durum: 'reddedildi' }, mod), { simge: 'wp', metin: 'WhatsApp mesajı gönderilmedi · Ece Aydın · Onay verilmedi', durum: 'hata' });
  }
});

test('e-posta gönderme: alıcı ve konu; gövde (yazılan metin) yok', () => {
  const g = { kime: 'ece@kuzeyruzgari.example', konu: 'Revizyonlar', govde: 'GİZLİ-GÖVDE metni' };
  const s = satir('eposta_gonder', g, tamam);
  assert.equal(s.metin, 'E-posta gönderildi · ece@kuzeyruzgari.example · Revizyonlar');
  assert.ok(!s.metin.includes('GİZLİ'));
  assert.equal(satir('eposta_gonder', g, { durum: 'reddedildi' }).metin, 'E-posta gönderilmedi · ece@kuzeyruzgari.example · Revizyonlar · Onay verilmedi');
});

test('ekran tıklaması: İş\'te koordinat yok; Geliştirici\'de koordinat satırda', () => {
  const g = { x: 640, y: 360 };
  assert.deepEqual(satir('bilgisayar_tikla', g, tamam, 'is'), { simge: 'hedef', metin: 'Ekranda tıkladı', durum: 'tamam' });
  assert.equal(satir('bilgisayar_tikla', g, tamam, 'gelistirici').metin, 'Ekranda tıkladı · (640, 360)');
  assert.equal(satir('bilgisayar_tikla', { ...g, dugme: 'sag' }, tamam).metin, 'Ekranda sağ tıkladı');
  assert.equal(satir('bilgisayar_tikla', { ...g, adet: 2 }, undefined).metin, 'Ekranda çift tıklıyor');
  assert.equal(satir('bilgisayar_tikla', g, { durum: 'hata' }).metin, 'Ekranda tıklanamadı');
});

test('P10: yazılan metin hiçbir satırda yok — yalnız hedef ve karakter sayısı (bilgisayar_yaz, tarayici_yaz)', () => {
  const sir = 'PAROLA-OLMAYAN-AMA-GİZLİ-YAZI 123';
  for (const mod of ['is', 'gelistirici'] as const) {
    for (const sonuc of [undefined, tamam, { durum: 'hata' } as AracSonuc]) {
      for (const [arac, girdi] of [['bilgisayar_yaz', { metin: sir }], ['tarayici_yaz', { no: 3, metin: sir, gonder: true }]] as const) {
        const s = satir(arac, girdi, sonuc, mod).metin;
        assert.ok(!s.includes('GİZLİ') && !s.includes('PAROLA') && !s.includes('123'), s);
        assert.ok(s.includes(`${[...sir].length} karakter`), s);
      }
    }
  }
  assert.equal(satir('bilgisayar_yaz', { metin: sir }, tamam).metin, 'Odaktaki alana yazdı · 33 karakter');
  assert.equal(satir('tarayici_yaz', { no: 3, metin: sir }, tamam).metin, 'Sayfada 3 numaralı alana yazdı · 33 karakter');
  assert.equal(satir('tarayici_yaz', { no: 3, metin: 'a' }, undefined).metin, 'Sayfada 3 numaralı alana yazıyor · 1 karakter');
  // Kayıt defterindeki etiket (şerit, Beyin, ada) aynı kuraldan geçer.
  assert.equal(yazmaEtiketi('bilgisayar_yaz', { metin: sir }), 'Odaktaki alana yazıyor · 33 karakter');
  assert.equal(yazmaEtiketi('tarayici_yaz', { no: 12, metin: sir }), 'Sayfada 12 numaralı alana yazıyor · 33 karakter');
  assert.ok(!yazmaEtiketi('tarayici_yaz', { metin: sir }).includes('GİZLİ'));
});

test('P10 kaynakta: bilgisayar_yaz ve tarayici_yaz etiketleri ve imleç rozeti yazılan metni içermez', () => {
  const oku = (d: string) => fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'main', d), 'utf8');
  const bilgisayar = oku('bilgisayar.ts');
  const tarayici = oku('tarayici.ts');
  assert.match(bilgisayar, /etiket: \(g\) => yazmaEtiketi\('bilgisayar_yaz', g\)/);
  assert.match(tarayici, /etiket: \(g\) => yazmaEtiketi\('tarayici_yaz', g\)/);
  assert.doesNotMatch(bilgisayar, /Yazıyor: “/);
  assert.doesNotMatch(tarayici, /Tarayıcıda yazıyor: “/);
  assert.doesNotMatch(bilgisayar, /imlecRozet\([^)]*metinKisalt\(metin/);
});

test('İş modunda hiçbir satır teknik sözcük, araç adı ya da ham yol taşımaz (IS_YASAK); bütün araçlar × üç durum', () => {
  const girdiler: Record<string, Record<string, unknown>> = {
    hafiza_ara: { sorgu: 'ACME fiyat kararı' }, hafiza_kaydet: { baslik: 'Kahve tercihi', icerik: 'x' }, hafiza_guncelle: { id: 4, baslik: 'Kahve' }, hafiza_sil: { id: 4 },
    hatirlatici_kur: { baslik: 'Toplantı', zaman: yerel(28, 9) }, hatirlatici_listele: {}, hatirlatici_guncelle: { id: 3, durum: 'tamam' },
    gorev_ekle: { baslik: 'Faturayı öde' }, gorev_listele: {}, gorev_guncelle: { id: 2, durum: 'tamam' }, oneri_ekle: { tur: 'dikkat', baslik: 'Dikkat' },
    kokpit_kart: { id: 'proje-durum', baslik: 'Proje durumu' }, kokpit_kart_kaldir: { id: 'proje-durum' }, kokpit_duzen: { tercih: 'x' }, zaman: {},
    gun_kaydi_ara: { sorgu: 'kira' }, gun_notlari: { gun: '2026-10-27' }, gun_raporu: { tur: 'haftalik' }, meseleler: {}, mesele_guncelle: { id: 1, durum: 'kapandi' }, gun_kaydi_duraklat: { dakika: 60 },
    bilgisayar_ekran: {}, bilgisayar_tikla: { x: 1, y: 2 }, bilgisayar_yaz: { metin: 'abc' }, bilgisayar_tus: { kombin: 'ctrl+c' }, bilgisayar_kaydir: { miktar: -3 },
    bilgisayar_surukle: { x1: 1, y1: 1, x2: 9, y2: 9 }, bilgisayar_pencereler: {}, bilgisayar_odakla: { baslik: 'Not Defteri' }, uygulama_ac: { hedef: 'https://ornek.example' },
    claude_code_oturumlari: { ara: 'ödeme' }, claude_code_oturum: { oturum_id: 'abcd1234' }, claude_code_gorev: { komut: 'testleri çalıştır' },
    eposta_listele: { ara: 'fatura' }, eposta_oku: { id: 7 }, eposta_gonder: { kime: 'a@b.co', konu: 'Konu', govde: 'g' }, mcp_kullan: { sunucu: 'proje-takip' },
    whatsapp_sohbetler: {}, whatsapp_oku: { kim: 'Ece' }, whatsapp_gonder: { kime: 'Ece', metin: 'x' }, dosya_listele: { yol: 'C:\\Kullanicilar\\Deniz\\Masaüstü' }, dosya_oku: { yol: 'C:\\Kullanicilar\\Deniz\\Belgeler\\rapor.pdf' },
    tarayici_ac: { adres: 'https://ornek.example/fiyat' }, tarayici_oku: {}, tarayici_tikla: { no: 4 }, tarayici_yaz: { no: 4, metin: 'abc' }, tarayici_kaydir: { yon: 'asagi' }, tarayici_ekran: {}, tarayici_geri: {},
    tarayici_sekme: { eylem: 'ac', adres: 'https://ornek.example' }, tarayici_sec: { no: 3, deger: 'Türkiye' }, tarayici_tus: { tuslar: 'Ctrl+L' }, tarayici_bekle: { metin: 'Teşekkürler', sn: 5 }, tarayici_indir: { adres: 'https://fuber.ai/rapor.pdf' },
    kart_goster: { tur: 'ozet', baslik: 'A', maddeler: ['b'] }, mcp__Proje_Takip__gorev_ac: { baslik: 'x' },
    // 0.11 G9: Görevler.
    is_baslat: { baslik: 'Ahmet’in yanıtını izle', amac: 'x', plan: {} }, is_adim_bitti: { ozet: 'Ahmet’e sordum', bildir: 'GİZLİ-BİLDİRİM' }, is_listele: {}, is_durdur: { id: 3 },
  };
  const sonuclar: (AracSonuc | undefined)[] = [undefined, { durum: 'calisiyor' }, tamam, { durum: 'hata', ozet: 'page.goto: net::ERR_NAME_NOT_RESOLVED' }, { durum: 'reddedildi' }];
  let adet = 0;
  for (const [arac, girdi] of Object.entries(girdiler)) {
    for (const sonuc of sonuclar) {
      const s = satir(arac, girdi, sonuc, 'is');
      adet++;
      assert.ok(s.metin.length > 0 && !/\n/.test(s.metin), `${arac}: tek satır`);
      assert.equal(isDiliIhlali(s.metin), null, `${arac} (${sonuc?.durum}): ${s.metin}`);
      assert.doesNotMatch(s.metin, /[a-z]+_[a-z_]+/, `${arac}: araç adı sızdı: ${s.metin}`);
      assert.doesNotMatch(s.metin, /ERR_|page\.goto|undefined|null|\[object/, `${arac}: ham hata ya da boş değer: ${s.metin}`);
      assert.doesNotMatch(s.metin, /[A-Za-z]:\\/, `${arac}: tam dosya yolu: ${s.metin}`);
      assert.ok(['suruyor', 'tamam', 'hata'].includes(s.durum));
      assert.ok(s.simge.length > 0);
    }
  }
  assert.ok(Object.keys(girdiler).length >= 50 && adet === Object.keys(girdiler).length * sonuclar.length);
  // Boş / bozuk girdide de düşmez.
  for (const bozuk of [undefined, null, 'x', 5, [], {}]) assert.ok(satir('hatirlatici_kur', bozuk, tamam).metin.startsWith('Hatırlatıcı kuruldu'));
});

test('kart_goster satırı: İş\'te "Kart hazırlıyor"; tamam "Kart hazırlandı"; hata "Kart hazırlanamadı"', () => {
  const g = { tur: 'tablo', baslik: 'Planlar' };
  assert.deepEqual(satir('kart_goster', g, undefined), { simge: 'kart', metin: 'Kart hazırlıyor', durum: 'suruyor' });
  assert.equal(satir('kart_goster', g, tamam).metin, 'Kart hazırlandı');
  assert.equal(satir('kart_goster', g, { durum: 'hata' }).metin, 'Kart hazırlanamadı');
});

test('durum: reddedilen onay da "hata" satırıdır ama nedeni söyler; sürüyor yalnız sonuç yokken / calisiyor iken', () => {
  assert.equal(satir('dosya_oku', { yol: 'C:\\x\\rapor.pdf' }, { durum: 'reddedildi' }).durum, 'hata');
  assert.equal(satir('dosya_oku', { yol: 'C:\\x\\rapor.pdf' }, { durum: 'reddedildi' }).metin, 'Dosya okunmadı · rapor.pdf · Onay verilmedi');
  assert.equal(satir('dosya_oku', { yol: 'C:\\x\\rapor.pdf' }, tamam).metin, 'Dosyayı okudu · rapor.pdf');
  assert.equal(satir('dosya_listele', { yol: 'C:\\Kullanicilar\\Deniz\\Masaüstü' }, tamam).metin, 'Klasöre baktı · Masaüstü');
});

test('Geliştirici: aynı satırlar, teknik ayrıntı yalnız burada (koordinat, tuş, sunucu · araç)', () => {
  assert.equal(satir('bilgisayar_tus', { kombin: 'ctrl+c' }, tamam, 'gelistirici').metin, 'Tuşa bastı · ctrl+c');
  assert.equal(satir('mcp__Proje_Takip__gorev_ac', { baslik: 'x' }, tamam, 'gelistirici').metin, 'Proje Takip · gorev ac');
  assert.equal(satir('mcp__Proje_Takip__gorev_ac', { baslik: 'x' }, tamam, 'is').metin, 'Bağlı bir araç kullanıldı');
  assert.equal(satir('mcp__Proje_Takip__gorev_ac', { baslik: 'x' }, undefined, 'is').metin, 'Bağlı bir araç kullanılıyor');
  assert.match(satir('claude_code_gorev', { komut: 'testleri çalıştır' }, tamam, 'gelistirici').metin, /^Claude Code’a iş verildi/);
  assert.equal(satir('claude_code_gorev', { komut: 'testleri çalıştır' }, tamam, 'is').metin, 'Bilgisayarda bir iş başlatıldı');
});

test('bilinmeyen araç: kayıt defterinin etiketi (İş\'te teknik sözcük içermiyorsa), yoksa sade cümle', () => {
  assert.deepEqual(satir('takvim_oku', {}, { durum: 'tamam', etiket: 'Takvim okundu · yarın' }), { simge: 'arac', metin: 'Takvim okundu · yarın', durum: 'tamam' });
  assert.equal(satir('takvim_oku', {}, { durum: 'tamam' }).metin, 'Bir adım tamamlandı');
  assert.equal(satir('takvim_oku', {}, undefined).metin, 'Bir adım yapılıyor');
  assert.equal(satir('takvim_oku', {}, { durum: 'hata' }).metin, 'Bir adım tamamlanamadı');
  // Etiket İş yasağı taşıyorsa (ham araç adı, model adı…) kullanılmaz.
  assert.equal(satir('x_araci', {}, { durum: 'tamam', etiket: 'Claude modeli çağrıldı' }, 'is').metin, 'Bir adım tamamlandı');
  assert.equal(satir('x_araci', {}, { durum: 'tamam', etiket: 'Claude modeli çağrıldı' }, 'gelistirici').metin, 'Claude modeli çağrıldı');
});

test('uzun değerler kısaltılır: tek satır sınırı (başlık ≤40, hedef ≤50), satır sonu yok', () => {
  const uzun = 'Çok uzun bir hatırlatıcı başlığı '.repeat(8);
  const s = satir('hatirlatici_kur', { baslik: uzun + '\nikinci satır', zaman: yerel(28, 9) }, tamam).metin;
  assert.ok(!s.includes('\n'));
  assert.ok(s.length < 90, `${s.length}: ${s}`);
  assert.ok(s.endsWith('…'));
});

test('İş: başarısız kart_goster satırı gösterilmez (model yeniden dener); Geliştirici\'de görünür; öteki araçlar her kipte görünür', () => {
  for (const durum of ['hata', 'reddedildi'] as const) {
    assert.equal(adimGorunurMu('kart_goster', durum, 'is'), false, durum);
    assert.equal(adimGorunurMu('kart_goster', durum, 'gelistirici'), true, durum);
  }
  // Sürüyorsa ("Kart hazırlıyor") ve başarılıysa her kipte görünür; başka araçların hatası İş'te de görünür ("olmadı" bilgisi gerçek).
  for (const mod of ['is', 'gelistirici'] as const) {
    assert.equal(adimGorunurMu('kart_goster', 'calisiyor', mod), true);
    assert.equal(adimGorunurMu('kart_goster', 'tamam', mod), true);
    for (const durum of ['calisiyor', 'tamam', 'hata', 'reddedildi'] as const) assert.equal(adimGorunurMu('whatsapp_gonder', durum, mod), true);
  }
});

test('"Ayrıntılar" (Geliştirici): ham girdi okunur JSON; yazılan metin yalnız karakter sayısı (P10); uzunsa kesilir', () => {
  const sir = 'GİZLİ-METİN';
  assert.equal(ayrintiMetni('hatirlatici_kur', { baslik: 'X', zaman: '2026-10-28T09:00:00+03:00' }), JSON.stringify({ baslik: 'X', zaman: '2026-10-28T09:00:00+03:00' }, null, 2));
  for (const [arac, girdi] of [['bilgisayar_yaz', { metin: sir }], ['tarayici_yaz', { no: 3, metin: sir }], ['whatsapp_gonder', { kime: 'Ece', metin: sir }], ['eposta_gonder', { kime: 'a@b.co', konu: 'K', govde: sir }]] as const) {
    const s = ayrintiMetni(arac, girdi);
    assert.ok(!s.includes('GİZLİ'), `${arac}: ${s}`);
    assert.match(s, /\[11 karakter\]/);
  }
  assert.equal(ayrintiMetni('x', undefined), '{}');
  const uzun = ayrintiMetni('hafiza_kaydet', { icerik: 'a'.repeat(5000) }, 120);
  assert.equal([...uzun].length, 120);
  assert.ok(uzun.endsWith('…'));
  // Döngüsel girdi düşürmez.
  const dongu: Record<string, unknown> = {}; dongu.kendisi = dongu;
  assert.equal(ayrintiMetni('x', dongu), '');
});

test('0.11 G9 görev satırları: başlık/numara, adımın özeti ve bildirimi satırda yok; reddedilen başlatma "başlatılmadı"', () => {
  assert.deepEqual(satir('is_baslat', { baslik: 'Ahmet’in yanıtını izle', plan: {} }, tamam), { simge: 'saat', metin: 'Görev başladı · Ahmet’in yanıtını izle', durum: 'tamam' });
  assert.equal(satir('is_baslat', { baslik: 'X' }, { durum: 'reddedildi' }).metin, 'Görev başlatılmadı · X · Onay verilmedi');
  const adim = satir('is_adim_bitti', { ozet: 'GİZLİ-ÖZET', bildir: 'GİZLİ-BİLDİRİM', sonuc: 'GİZLİ-SONUÇ' }, tamam).metin;
  assert.equal(adim, 'Adım kaydedildi');
  assert.equal(satir('is_durdur', { id: 3 }, tamam).metin, 'Görev durduruldu · #3');
  assert.equal(satir('is_listele', {}, undefined).metin, 'Görevlere bakıyor');
});

test('kayıt defterindeki her araç adı satır tablosunda var (yeni araç eklenince bu test hatırlatır)', () => {
  const kok = path.resolve(import.meta.dirname, '..', 'src', 'main');
  const adlar = new Set<string>();
  const tara = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const y = path.join(d, e.name);
      if (e.isDirectory()) { tara(y); continue; }
      if (!/\.ts$/.test(e.name)) continue;
      const k = fs.readFileSync(y, 'utf8');
      for (const m of k.matchAll(/tanim: \{\s*ad: '([a-z_]+)'/g)) adlar.add(m[1]);
      for (const m of k.matchAll(/\bad: '([a-z_]+)',\s*\n\s*aciklama:/g)) adlar.add(m[1]);
    }
  };
  tara(kok);
  assert.ok(adlar.size >= 45, `araç adı bulundu: ${adlar.size}`);
  const eksik = [...adlar].filter((a) => !aracSatiriAdlari.includes(a));
  assert.deepEqual(eksik, [], `aracSatiri tablosunda yok: ${eksik.join(', ')}`);
});
