// Tanıtım görüntüleri için SENTETİK demo verisi ("Deniz" ve uydurma projeler; gerçek kişi verisi YOK).
// Uygulama şemayı bir kez kurduktan sonra çağrılır. Uçtan uca akış (scripts/e2e/tam-akis.mjs) ve önizlemeler kullanır.
// Saatler GERÇEK saate göre kurulur (görüşme ~40-70 dk sonra): canlı model "şimdi"yi gerçek saatten bildiği için
// arayüz saatini kaydırmak verinin kendisiyle çelişiyordu (model haklı olarak "bugün mü yarın mı?" diye soruyordu).
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { sadelestir } from '../../src/main/hafiza/normal.ts';
import { isPlaniMetni } from '../../src/shared/isler.ts';

const iki = (n) => String(n).padStart(2, '0');
const hh = (d) => `${iki(d.getHours())}:${iki(d.getMinutes())}`;
const YARIM = 30 * 60000;

/**
 * `sabit` (0.11 G5 düzeltme turu 1, K6): saatten bağımsız tohum — önizlemelerin yerleşim denetimleri için. Gelecekteki her kayıt YARIN
 * belli saatlerde (görüşme 10:00, hatırlatıcı 09:30, Ece 14:30), geçmişteki her kayıt bugünden ÖNCE (dün 23:50'den geriye): günün hangi
 * saatinde koşulursa koşulsun (ve arayüz saati 09:00 ya da 23:30'a sabitlense de) aynı veri, aynı "Yarın"/"dün" ve aynı gündem. Zamanlayıcı
 * yarınki hatırlatıcıyı koşu sırasında hiç tetiklemez. Varsayılan (göreli) tohum ekran görüntüleri içindir: görüşme ~40–70 dk sonra.
 *
 * `yeni11` (0.11 G12b, landing/uretim/ekran-cek.mjs): 0.11 kokpitinin ekran görüntüleri için EK veri — Yapılacaklar'da bugün işaretlenmiş iki
 * madde (üstü çizili, kartın altında), ana sayfa sohbet seçicisini dolduran birkaç eski sohbet ve yapay zekânın kart_goster ile hazırladığı iki
 * kart (adımlar, tablo). Varsayılan KAPALI: öteki önizlemelerin sayımları ve yerleşim kapıları değişmesin. `sabit` ile birlikte kullanılmaz.
 * Süren GÖREVLER buradan eklenmez (uygulama açılırken `islerBaslat` süren işi "kapanış" diye durdurur): `demoGorevleriEkle` uygulama AÇIKKEN çağrılır.
 */
export function demoVerisiKur(veri, { sabit = false, yeni11 = false } = {}) {
  const vt = new DatabaseSync(path.join(veri, 'fuber.db'));
  const simdi = Date.now();
  const bugunBasi = new Date(simdi); bugunBasi.setHours(0, 0, 0, 0);
  const taban = sabit ? bugunBasi.getTime() - 10 * 60000 : simdi;
  const once = (dk) => new Date(taban - dk * 60000).toISOString();
  const z = new Date(simdi).toISOString();
  const yarinTarih = (s, d = 0) => { const x = new Date(simdi); x.setDate(x.getDate() + 1); x.setHours(s, d, 0, 0); return x; };
  const gorusme = sabit ? yarinTarih(10) : new Date(Math.ceil((simdi + 40 * 60000) / YARIM) * YARIM);
  const hatirlat = new Date(gorusme.getTime() - YARIM);
  const raporSon = new Date(gorusme.getTime() - 15 * 60000);
  const slaytSon = new Date(gorusme.getTime() - 10 * 60000);
  const ece = new Date(gorusme.getTime() + 4.5 * 3600_000);
  const yarin = (s, d = 0) => yarinTarih(s, d).toISOString();
  const dun = (s, d = 0) => { const x = new Date(simdi); x.setDate(x.getDate() - 1); x.setHours(s, d, 0, 0); return x.toISOString(); };
  const saat = new Date(simdi).getHours();
  const selam = saat < 12 ? 'Günaydın' : saat < 18 ? 'İyi günler' : 'İyi akşamlar';

  const hafiza = [
    ['kullanici', 'Deniz — çalışma biçimi', 'Kısa ve net yanıt sever. Sabahları derin iş, öğleden sonra toplantı. Aynı anda 4-5 proje yürütüyor.', 1, 5, '["çalışma biçimi"]'],
    ['proje', 'Mavi Kuş', 'Kafe zincirleri için sipariş uygulaması. Beta testte: 12 kafe, 340 kullanıcı. Hedef lansman 3 Kasım.', 0, 5, '["mavi kuş","beta","lansman"]'],
    ['proje', 'Kuzey Rüzgârı', 'Enerji firması için kurumsal site. Tasarım revizyonu aşamasında; müşteri yetkilisi Ece Aydın.', 0, 4, '["kuzey rüzgârı","site"]'],
    ['kisi', 'Ece Aydın', 'Kuzey Rüzgârı pazarlama direktörü. E-postaya aynı gün dönüş bekler.', 0, 4, '["müşteri"]'],
    ['kisi', 'Mert', 'Mavi Kuş mobil geliştiricisi; Android sürümlerinden sorumlu.', 0, 3, '["ekip"]'],
    ['tercih', 'Kokpit yerleşimi', 'Hatırlatıcılar sol üstte, e-postalar ortada dursun; araç kiti en altta.', 0, 3, '["kokpit"]'],
    ['olay', 'Yatırımcı ön görüşmesi', 'Ön görüşme olumlu geçti; yatırımcılar haftalık aktif kafe ve günlük sipariş metriklerini istedi. İkinci görüşme planlandı.', 0, 5, '["yatırım"]'],
    ['kural', 'Müşteri e-postaları', 'Müşteriye giden her e-posta gönderilmeden önce Deniz\'in onayına sunulur.', 1, 5, '["kural","e-posta"]'],
  ];
  const hEkle = vt.prepare('INSERT INTO hafizalar(tur, baslik, icerik, sabit, onem, etiketler, kaynak, olusturma, guncelleme) VALUES(?,?,?,?,?,?,?,?,?)');
  const hDizin = vt.prepare('INSERT INTO hafiza_ara(rowid, baslik, icerik, etiketler) VALUES(?,?,?,?)');
  hafiza.forEach(([t, b, i, s, o, e], n) => {
    const id = Number(hEkle.run(t, b, i, s, o, e, n < 3 ? 'kurulum' : 'sohbet:1', once(60 * 24 * (8 - n)), once(60 * 24 * (8 - n))).lastInsertRowid);
    hDizin.run(id, sadelestir(b), sadelestir(i), sadelestir(JSON.parse(e).join(' ')));
  });
  const h7Tarih = new Date(simdi - 2 * 864e5).toLocaleDateString('sv-SE');
  const h2Tarih = new Date(simdi - 7 * 864e5).toLocaleDateString('sv-SE');

  const r = vt.prepare('INSERT INTO hatirlaticilar(baslik, aciklama, zaman, tekrar, onem, olusturma) VALUES(?,?,?,?,?,?)');
  r.run('Yatırımcı görüşmesi', 'İkinci toplantı · beta raporu + metrik slaytı', hatirlat.toISOString(), 'yok', 5, z);
  r.run('Ece ile tasarım revizyonu', 'Ana sayfa + hizmetler', ece.toISOString(), 'yok', 4, z);
  r.run('Haftalık ekip toplantısı', null, yarin(11), 'haftalik', 3, z);
  const g = vt.prepare('INSERT INTO gorevler(baslik, son_tarih, proje, oncelik, olusturma) VALUES(?,?,?,?,?)');
  g.run('Beta raporunu bitir', raporSon.toISOString(), 'Mavi Kuş', 5, z);
  g.run('Metrik slaytını sunuma ekle', slaytSon.toISOString(), 'Mavi Kuş', 4, z);
  g.run('Ana sayfa revizyonlarını işle', yarin(18), 'Kuzey Rüzgârı', 4, z);
  g.run('Android 1.4 sürüm notları', null, 'Mavi Kuş', 3, z);
  const o = vt.prepare('INSERT INTO oneriler(tur, baslik, icerik, olusturma) VALUES(?,?,?,?)');
  o.run('dikkat', 'Ece 2 gündür yanıt bekliyor', 'Revizyon e-postası iki gündür yanıtsız.', z);
  o.run('dikkat', 'Sunucu faturası yarın çekilecek', 'Kart son kullanma tarihi bu ay doluyor.', z);
  o.run('oneri', 'Görüşmeden önce 20 dk rapor provası', 'Metrikler: haftalık aktif kafe, sipariş/gün.', z);
  o.run('soru', 'Lansman 3 Kasım\'da mı kalıyor?', 'Android 1.4 RC bugün geldi.', z);
  const e = vt.prepare('INSERT INTO epostalar(hesap, mesaj_kimlik, kimden, konu, tarih, ozet, govde, okundu, onem) VALUES(?,?,?,?,?,?,?,?,?)');
  e.run('İş', 'd1', 'Ece Aydın <ece@kuzeyruzgari.example>', 'Ana sayfa revizyonları — son hali', once(60 * 46), 'Son revizyon listesi ekte; bu hafta yayına almak istiyoruz.', '', 0, 5);
  e.run('İş', 'd2', 'Yatırım Ortakları <ofis@yatirim.example>', 'İkinci görüşmenin gündemi', once(60 * 17), 'Metrikler, büyüme planı ve ekip; 45 dakika.', '', 0, 5);
  e.run('İş', 'd3', 'Mert <mert@mavikus.example>', 'Android 1.4 RC hazır', once(95), 'Sürüm adayı yüklendi; iki küçük hata düzeltildi.', '', 0, 4);
  e.run('İş', 'd4', 'Bulut Sunucu <fatura@bulut.example>', 'Ekim faturası', once(60 * 14), 'Fatura tutarı yarın tahsil edilecek.', '', 1, 2);
  e.run('İş', 'd5', 'Figma <bildirim@figma.example>', 'Yorum: Kuzey Rüzgârı / Hizmetler', once(60 * 20), 'Ece bir yorum bıraktı: “başlık daha kısa olabilir”.', '', 1, 2);
  const w = vt.prepare('INSERT INTO wa_mesajlar(jid, ad, yon, metin, zaman, okundu, kimlik) VALUES(?,?,?,?,?,?,?)');
  w.run('demo1@s', 'Mert', 'gelen', 'APK\'yı yükledim, bakabilir misin?', once(50), 0, 'w1');
  w.run('demo1@s', 'Mert', 'gelen', 'Ödeme ekranındaki hata da düzeldi 👍', once(48), 0, 'w2');
  w.run('demo2@g', 'Mavi Kuş Ekip', 'gelen', 'Beta kullanıcısı 340 oldu 🎉', once(130), 0, 'w3');
  w.run('demo3@s', 'Ece Aydın', 'gelen', 'Akşama kadar dönüş yapabilir misiniz?', once(60 * 16), 1, 'w4');
  vt.prepare('INSERT INTO ozel_kartlar(id, baslik, veri, oncelik, olusturma, guncelleme) VALUES(?,?,?,?,?,?)')
    .run('hafta', 'Bu hafta', JSON.stringify({ metrikler: [{ ad: 'açık iş', deger: '7' }, { ad: 'toplantı', deger: '4' }, { ad: 'yanıt bekleyen', deger: '3' }] }), 3, z, z);

  // Ana sohbet + iki geçmiş sohbet.
  const s = vt.prepare('INSERT INTO sohbetler(baslik, tur, olusturma, guncelleme) VALUES(?,?,?,?)');
  const anaId = Number((vt.prepare("SELECT id FROM sohbetler WHERE tur='ana' LIMIT 1").get() ?? {}).id ?? s.run('Fuber', 'ana', once(60 * 24 * 9), z).lastInsertRowid);
  const s2 = Number(s.run('Yatırımcı sunumu taslağı', 'normal', once(60 * 30), once(60 * 30)).lastInsertRowid);
  const s3 = Number(s.run('Kuzey Rüzgârı içerik planı', 'normal', once(60 * 26), once(60 * 26)).lastInsertRowid);
  const m = vt.prepare('INSERT INTO mesajlar(sohbet_id, rol, metin, bloklar, kaynak, olusturma) VALUES(?,?,?,?,?,?)');
  const metin = (t) => JSON.stringify([{ tur: 'metin', metin: t }]);
  // Dün akşam: "yarın" = bugün. Saatler ekleri gerektirmesin diye parantez içinde.
  const u1 = `Yarın yatırımcılarla ikinci görüşme var (saat ${hh(gorusme)}), yarım saat önce hatırlat. Beta raporunu da ondan önce bitirmem lazım.`;
  m.run(anaId, 'user', u1, metin(u1), 'kullanici', dun(18, 40));
  const cevap = `Kurdum: hatırlatıcı **${hh(hatirlat)}**, görüşme **${hh(gorusme)}**. Beta raporunu da plana en yüksek öncelikle ekledim (son ${hh(raporSon)}).\n\nÖn görüşmede **haftalık aktif kafe** ve **sipariş/gün** metriklerini sormuşlardı [H-7 · ${h7Tarih}]; rapora bu ikisini koymanı öneririm. İstersen taslağı ben çıkarayım.`;
  // Uygulamanın kayıt biçimi: asistan (araç çağrıları) → kullanıcı rolünde araç sonuçları → asistan (metin).
  m.run(anaId, 'assistant', '', JSON.stringify([
    { tur: 'arac_cagri', id: 'c1', ad: 'hatirlatici_kur', girdi: { baslik: 'Yatırımcı görüşmesi', zaman: hatirlat.toISOString() } },
    { tur: 'arac_cagri', id: 'c2', ad: 'gorev_ekle', girdi: { baslik: 'Beta raporunu bitir', proje: 'Mavi Kuş', oncelik: 5 } },
  ]), null, dun(18, 41));
  m.run(anaId, 'user', '', JSON.stringify([
    { tur: 'arac_sonuc', id: 'c1', ad: 'hatirlatici_kur', icerik: 'Hatırlatıcı #1 kuruldu' },
    { tur: 'arac_sonuc', id: 'c2', ad: 'gorev_ekle', icerik: 'Yapılacak iş #1 Yapılacaklar’a eklendi' },
  ]), 'arac', dun(18, 41));
  m.run(anaId, 'assistant', cevap, metin(cevap), null, dun(18, 41));
  const ozet = [
    `${selam} Deniz. Bugün üç şey öne çıkıyor:`,
    '',
    `1. **${hh(hatirlat)}** hatırlatıcı — **${hh(gorusme)}** yatırımcı görüşmesi.`,
    `2. **Beta raporu** (son ${hh(raporSon)}) — rapor provası için 20 dakika ayırmanı öneririm.`,
    `3. **${hh(ece)}** Ece ile tasarım revizyonu; iki gündür yanıt bekliyor.`,
    '',
    'Kuzey Rüzgârı’yla ilgili işleri yarına bıraktım.',
  ].join('\n');
  m.run(anaId, 'assistant', ozet, metin(ozet), 'proaktif', once(6));
  const u2 = 'Beta raporuna neleri koymalıyım?';
  m.run(anaId, 'user', u2, metin(u2), 'kullanici', once(3));
  const rapor = [
    `Yatırımcılar ön görüşmede iki metriği sordu [H-7 · ${h7Tarih}]:`,
    '',
    '- **Haftalık aktif kafe** — 12 kafeden kaçı her hafta sipariş alıyor',
    '- **Günlük sipariş** — son 4 haftanın eğrisi',
    '',
    `Bunlara **340 beta kullanıcısı** ve **3 Kasım lansman** hedefini ekle [H-2 · ${h2Tarih}]. İstersen slayt taslağını çıkarayım.`,
  ].join('\n');
  m.run(anaId, 'assistant', rapor, metin(rapor), 'kullanici', once(2));
  m.run(s2, 'user', 'Sunum akışını çıkar', metin('Sunum akışını çıkar'), 'kullanici', once(60 * 30));
  m.run(s3, 'user', 'Blog takvimi öner', metin('Blog takvimi öner'), 'kullanici', once(60 * 26));
  vt.prepare('UPDATE sohbetler SET guncelleme = ? WHERE id = ?').run(z, anaId);

  if (yeni11 && !sabit) {
    // Yapılacaklar (G4): bugün işaretlenmiş iki madde — kartın altında, üstü çizili. Tamamlanma yerel bugünün içinde kalır (gece yarısına yakın koşulsa da).
    const bugunIci = (dk) => new Date(Math.max(simdi - dk * 60000, bugunBasi.getTime() + 60000)).toISOString();
    const t = vt.prepare("INSERT INTO gorevler(baslik, durum, proje, oncelik, olusturma, tamamlanma) VALUES(?, 'tamam', ?, ?, ?, ?)");
    t.run('Sunum taslağını Ece’ye gönder', 'Kuzey Rüzgârı', 4, once(60 * 20), bugunIci(75));
    t.run('Sunucu faturasının kartını güncelle', null, 3, once(60 * 20), bugunIci(30));
    // Ana sayfa sohbet seçicisi (G7): ana sohbet + son sohbetler. (Başlıklar uydurma; gerçek konuşma yok.)
    for (const [baslik, soru, dk] of [['Android 1.4 sürüm notları', 'Sürüm notlarını üç maddede özetle', 60 * 22], ['Haftalık ekip raporu', 'Bu haftanın raporunu hazırla', 60 * 46], ['Lansman duyuru metni', 'Lansman duyurusunun ilk taslağını yaz', 60 * 70]]) {
      const id = Number(s.run(baslik, 'normal', once(dk), once(dk)).lastInsertRowid);
      m.run(id, 'user', soru, metin(soru), 'kullanici', once(dk));
    }
    // Yapay zekânın kartları (G6): `kart_goster` kayıtta araç çağrısıdır, görünüm onu kart bloğuna çevirir (main/sohbet.ts gorunume). Sohbet: "Yatırımcı sunumu taslağı".
    const akis = { tur: 'adimlar', baslik: 'Yatırımcı sunumu · 12 dakikalık akış', adimlar: [
      'Sorun: kafelerde sipariş kuyruğu ve yanlış sipariş', 'Çözüm: Mavi Kuş ile masadan tek ekranda sipariş', 'Beta: 12 kafe, 340 kullanıcı',
      'Metrikler: haftalık aktif kafe ve günlük sipariş', 'Büyüme planı: ilk altı ay', 'Ekip ve Android 1.4 yol haritası', 'İstenen destek ve lansman takvimi (3 Kasım)'] };
    const metrik = { tur: 'tablo', baslik: 'Beta metrikleri', sutunlar: ['Hafta', 'Aktif kafe', 'Sipariş/gün'], satirlar: [['1', '7', '410'], ['2', '9', '560'], ['3', '11', '690'], ['4', '12', '780']] };
    m.run(s2, 'assistant', '', JSON.stringify([
      { tur: 'arac_cagri', id: 'k1', ad: 'kart_goster', girdi: akis },
      { tur: 'arac_cagri', id: 'k2', ad: 'kart_goster', girdi: metrik },
    ]), null, once(60 * 30 - 1));
    m.run(s2, 'user', '', JSON.stringify([
      { tur: 'arac_sonuc', id: 'k1', ad: 'kart_goster', icerik: 'Kart kullanıcıya gösterildi.' },
      { tur: 'arac_sonuc', id: 'k2', ad: 'kart_goster', icerik: 'Kart kullanıcıya gösterildi.' },
    ]), 'arac', once(60 * 30 - 2));
    const kapanis = 'Akışı 12 dakikaya göre kurdum, beta metriklerini de ayrı bir tabloda topladım. İstersen her adım için kısa bir konuşma notu yazarım.';
    m.run(s2, 'assistant', kapanis, metin(kapanis), null, once(60 * 30 - 3));
    vt.prepare('UPDATE sohbetler SET guncelleme = ? WHERE id = ?').run(once(60 * 30 - 3), s2);
  }

  vt.prepare('INSERT INTO kokpit(id, duzen, guncelleme) VALUES(1, ?, ?) ON CONFLICT(id) DO UPDATE SET duzen = excluded.duzen').run(JSON.stringify({
    selamlama: `${selam}, Deniz.`,
    odak: `Görüşme ${hh(gorusme)}: önce beta raporunu bitir. Ece iki gündür yanıt bekliyor.`,
    gerekce: 'Görüşme bir saat içinde: hatırlatıcı sol üstte; yanıt bekleyen e-postalar öne alındı.',
    kartlar: [
      { id: 'zihin', tip: 'zihin', kolon: 1, genislik: 12, yukseklik: 'k' },
      { id: 'hatirlatici', tip: 'hatirlatici', kolon: 1, genislik: 4, yukseklik: 'o', vurgu: true },
      { id: 'eposta', tip: 'eposta', kolon: 5, genislik: 8, yukseklik: 'o' },
      { id: 'dikkat', tip: 'dikkat', kolon: 1, genislik: 4, yukseklik: 'k', baslik: 'Dikkat' },
      { id: 'plan', tip: 'plan', kolon: 5, genislik: 4, yukseklik: 'o' },
      { id: 'ozel:hafta', tip: 'ozel', kolon: 9, genislik: 4, yukseklik: 'k' },
      { id: 'whatsapp', tip: 'whatsapp', kolon: 1, genislik: 4, yukseklik: 'k' },
      { id: 'oneriler', tip: 'oneriler', kolon: 5, genislik: 8, yukseklik: 'k' },
      { id: 'arac_kiti', tip: 'arac_kiti', kolon: 1, genislik: 12, yukseklik: 'k' },
    ],
  }), z);
  vt.close();
}

// ── Görevler (0.11 G9–G10; 0.11 G12b ekran görüntüleri) ───────────────────────────────────────────────────────────────────────────────
/** Ece’nin yanıtını bekleyen WhatsApp görevinin planı: kişiye bağlı yazma izni (jid sahte, yalnız son dört hane görünür), 30 sn → 5 dk aralık, 2 saat. */
export const DEMO_GOREV_PLANI = {
  gozcu: { tur: 'whatsapp', hedef: 'Ece', jid: '905000000002@s.whatsapp.net' },
  aralik: { min: 30, max: 300 },
  bitis: { tur: 'sure', saniye: 7200 },
  izinler: [{ tur: 'whatsapp_gonder', kisi: 'Ece', jid: '905000000002@s.whatsapp.net' }],
  azamiAdim: 60,
};
export const DEMO_GOREV_ISTEGI = 'Ece revizyonlara yanıt yazarsa bana haber ver; akşama kadar yazmazsa ona kısa bir hatırlatma gönder.';

/**
 * Görev onay kartının verisi (sohbet:olay 'onay' → G10 GorevOnayKarti): plan insan diline GERÇEK işlevle çevrilir (shared/isler.ts isPlaniMetni).
 * `kullanici`: kullanıcının sohbete yazdığı istek. Uygulama açıkken ana pencereye gönderilir (ekran-cek.mjs).
 */
export function demoGorevOnayi() {
  const p = isPlaniMetni(DEMO_GOREV_PLANI, 'is');
  return {
    kullanici: DEMO_GOREV_ISTEGI,
    yanit: 'Bunu bir görev olarak kurabilirim: Ece’yi WhatsApp’ta izler, yanıt gelince sana haber veririm. Başlamadan önce planı onayına sunuyorum.',
    istek: {
      id: 'gorev-onay-demo', tur: 'gorev', baslik: 'Görev: Ece’nin yanıtını bekle', aciklama: DEMO_GOREV_ISTEGI, tehlike: 'orta', secenekler: ['bir_kez', 'reddet'],
      gorev: { baslik: 'Ece’nin yanıtını bekle', ne: p.ne, nasil: p.nasil, bitis: p.bitis, izinler: p.izinler, sinir: p.sinir },
    },
  };
}

/**
 * SÜREN görevleri kokpite ekler: iki süren ("Ece’nin yanıtını bekle" — WhatsApp, 1 gönderim; "Fatura e-postasını izle" — e-posta) ve bugün biten
 * bir görev ("Mert’in APK mesajı"). Uygulama AÇIKKEN çağrılır (açılışta `islerBaslat` süren işi "kapanış" diye durdurur); kart `isler:liste` ile
 * veritabanından okur, ardından pencere yenilenir (ekran-cek.mjs). Her görevin kendi sohbeti (tur 'gorev') da eklenir. Saatler gerçek saate göre.
 */
export function demoGorevleriEkle(veri) {
  const vt = new DatabaseSync(path.join(veri, 'fuber.db'));
  vt.exec('PRAGMA busy_timeout = 4000');
  const simdi = Date.now();
  const iso = (ms) => new Date(simdi + ms).toISOString();
  const dk = 60_000, sn = 1000;
  const sohbet = vt.prepare('INSERT INTO sohbetler(baslik, tur, olusturma, guncelleme) VALUES(?,?,?,?)');
  const is = vt.prepare(`INSERT INTO isler(baslik, amac, durum, plan, baslangic, bitis_zamani, sonraki, son_kontrol, adim, kontrol, son_ozet, sonuc, durma_nedeni, sohbet_id, iz, aralik, gonderilenler, olusturma, guncelleme)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?)`);
  const not = vt.prepare("INSERT INTO mesajlar(sohbet_id, rol, metin, bloklar, kaynak, olusturma) VALUES(?, 'not', ?, ?, NULL, ?)");
  const ekle = (o) => {
    const sid = Number(sohbet.run(`Görev · ${o.baslik}`, 'gorev', iso(o.basla), iso(o.basla)).lastInsertRowid);
    // Görevin sohbeti boş görünmesin: başlangıç notu (iç talimat değil; kullanıcıya görünen durum cümlesi).
    const ilk = `Görev başladı: ${o.baslik}.`;
    not.run(sid, ilk, JSON.stringify([{ tur: 'metin', metin: ilk }]), iso(o.basla));
    is.run(o.baslik, o.amac, o.durum, JSON.stringify(o.plan), iso(o.basla), iso(o.bitis), o.durum === 'suruyor' ? iso(o.sonraki) : null, iso(o.sonKontrol), o.adim, o.kontrol,
      o.sonOzet ?? null, o.sonuc ?? null, sid, o.aralik ?? 30, JSON.stringify(o.gonderilenler ?? []), iso(o.basla), iso(o.sonKontrol));
  };
  ekle({
    baslik: 'Ece’nin yanıtını bekle', amac: DEMO_GOREV_ISTEGI, durum: 'suruyor', plan: DEMO_GOREV_PLANI,
    basla: -68 * dk, bitis: 52 * dk, sonraki: 18 * sn, sonKontrol: -12 * sn, adim: 3, kontrol: 41, aralik: 45,
    sonOzet: 'Ece henüz yazmadı; yarım dakikada bir bakıyorum.', gonderilenler: [{ alici: 'Ece Aydın', kanal: 'WhatsApp', zaman: iso(-31 * dk) }],
  });
  ekle({
    baslik: 'Fatura e-postasını izle', amac: 'Bulut Sunucu’dan yeni fatura gelirse haber ver.', durum: 'suruyor',
    plan: { gozcu: { tur: 'eposta', hedef: 'Bulut Sunucu' }, aralik: { min: 60, max: 600 }, bitis: { tur: 'sure', saniye: 21_600 }, izinler: [], azamiAdim: 40 },
    basla: -140 * dk, bitis: 220 * dk, sonraki: 41 * sn, sonKontrol: -19 * sn, adim: 1, kontrol: 22, aralik: 120, sonOzet: 'Yeni fatura e-postası gelmedi.',
  });
  ekle({
    baslik: 'Mert’in APK mesajı', amac: 'Mert APK’yı yükleyince haber ver.', durum: 'bitti',
    plan: { gozcu: { tur: 'whatsapp', hedef: 'Mert' }, aralik: { min: 30, max: 300 }, bitis: { tur: 'sure', saniye: 3600 }, izinler: [], azamiAdim: 30 },
    basla: -190 * dk, bitis: -128 * dk, sonraki: 0, sonKontrol: -128 * dk, adim: 2, kontrol: 17, sonuc: 'Mert APK’yı yükledi; ödeme ekranındaki hata da düzelmiş.',
  });
  vt.close();
}
