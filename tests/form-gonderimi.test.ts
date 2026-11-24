// Form gönderimi algılama (0.14 T15; saf → src/shared/form-gonderimi.ts). Ürün kararı: gezinme, okuma, arama ve taslak kendiliğinden;
// gönderme, silme, ödeme, form gönderme her zaman onay ister. Form gönderme ajanın beyanına göre değil, sayfadan OKUNAN öğe bilgisine
// göre algılanır: gönder tipi düğme, form içinde Enter, POST gezinmesi (gezinim kalkanı). Parola ya da kart alanı içeren form her zaman onaylıdır.
// Düzeltme turu 4 (denetleyici kararı K1–K7): gönderim kalkanı SEKME BAŞINA (SekmeKalkani, sahte saatle); süreç genelinde tekil durum ve araç sayısına
// bağlı pencereler yok.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  gonderimMi, GERI_DONUSSUZ_SOZCUKLER, geriDonussuzMu, PAROLA_ALAN_DESENI, KART_ALAN_DESENI,
  FORM_ONAY_BEKLIYOR, gonderimOnayIstegi, indirmeOnayIstegi, type OgeBilgisi, type GonderimOnayi,
  ONAYSIZ_FORM_NOTU, formYontemiBul, odemeCercevesiMi, istekOnayIstegi, KALKAN_KUYRUK_MS, KULLANICI_PENCERESI_MS,
  SekmeKalkani, aracDonusu, kartSatiri, onayliSonuc, sekmeNotu, submitBilgisi, aramaFormuMu, submitBilgisiAyikla,
  GONDERIM_PENCERESI_MS, GEZINIM_IZNI_MS, KILIT_MS, AG_SAKIN_MS, KILIT_NOTU, ONAY_SATIRI, ONAY_P14_SATIRI,
  P14_KILIT_NOTU, ONAY_KAPALI_SATIRI, engelNotu,
  type EylemKaydi, type SubmitBilgisi,
} from '../src/shared/form-gonderimi.ts';

/** Varsayılan: formsuz, sıradan metin kutusu. */
const oge = (o: Partial<OgeBilgisi> = {}): OgeBilgisi => ({ etiket: '', tip: 'input:text', formIcinde: false, formYontemi: null, metin: '', parolaFormu: false, kartFormu: false, ...o });
const postForm = (o: Partial<OgeBilgisi> = {}) => oge({ formIcinde: true, formYontemi: 'post', ...o });

test('submit tipi düğme gönderimdir', () => {
  assert.equal(gonderimMi(postForm({ tip: 'button:submit', metin: 'Devam' }), 'tikla'), true);
  assert.equal(gonderimMi(postForm({ tip: 'input:submit', metin: 'Tamam' }), 'tikla'), true);
  assert.equal(gonderimMi(postForm({ tip: 'input:image' }), 'tikla'), true);
  // Etiketi masum olsa da: karar düğmenin metnine/ajanın söylediğine değil, tipine bakar.
  assert.equal(gonderimMi(postForm({ tip: 'button:submit', metin: 'Sadece bak', etiket: 'önizleme' }), 'tikla'), true);
});

test('form içinde tipsiz button gönderimdir', () => { // HTML varsayılanı: tipsiz button submit'tir
  assert.equal(gonderimMi(postForm({ tip: 'button', metin: 'İleri' }), 'tikla'), true);
  // Açıkça type=button olan JS düğmesi gönderim değil (POST kalkanı yine yakalar).
  assert.equal(gonderimMi(postForm({ tip: 'button:button', metin: 'Alanları temizle' }), 'tikla'), false);
  // Formsuz tipsiz düğme de gönderim değil.
  assert.equal(gonderimMi(oge({ tip: 'button', metin: 'Menüyü aç' }), 'tikla'), false);
});

test('form içinde Enter gönderimdir; form dışında da (açık GET arama formu hariç)', () => { // denetleyici kararı (düzeltme turu 1): ajanın her Enter'ı onaylı
  assert.equal(gonderimMi(postForm({ tip: 'input:text', etiket: 'Ad' }), 'enter'), true);
  assert.equal(gonderimMi(oge({ tip: 'input:text', etiket: 'Ara' }), 'enter'), true);
  // textarea ve contenteditable mesaj kutuları dahil (Enter'la gönderen sohbet kutuları).
  assert.equal(gonderimMi(postForm({ tip: 'textarea:textarea' }), 'enter'), true);
  assert.equal(gonderimMi(oge({ tip: 'textarea:textarea' }), 'enter'), true);
  // Bağlantıda Enter gezinmedir (adı gönderme/silme sözcüğü taşımıyorsa).
  assert.equal(gonderimMi(postForm({ tip: 'a', metin: 'Fiyatlar' }), 'enter'), false);
  assert.equal(gonderimMi(postForm({ tip: 'a', metin: 'Sil' }), 'enter'), true);
  // Odaktaki düğmede Enter, düğmeye tıklamadır.
  assert.equal(gonderimMi(postForm({ tip: 'button:submit' }), 'enter'), true);
  assert.equal(gonderimMi(oge({ tip: 'button:button', metin: 'Menü' }), 'enter'), false);
});

test('zengin metin kutusunda (contenteditable) ve textarea\'da Enter gönderim sayılır; tek istisna açık GET formu', () => {
  assert.equal(gonderimMi(oge({ tip: 'contenteditable' }), 'enter'), true);
  assert.equal(gonderimMi(oge({ tip: 'contenteditable' }), 'tikla'), false);
  assert.equal(gonderimMi(postForm({ tip: 'textarea:textarea' }), 'enter'), true);
  assert.equal(gonderimMi(oge({ tip: 'textarea:textarea', formIcinde: true, formYontemi: 'get' }), 'enter'), false);
});

test('GET formu (arama kutusu) gönderim değil; ama parola/kart ya da geri dönüşsüz sözcük varsa öyle', () => {
  const ara = { formIcinde: true, formYontemi: 'get' as const };
  assert.equal(gonderimMi(oge({ ...ara, tip: 'input:search', etiket: 'Ara' }), 'enter'), false);
  assert.equal(gonderimMi(oge({ ...ara, tip: 'button:submit', metin: 'Ara' }), 'tikla'), false);
  assert.equal(gonderimMi(oge({ ...ara, tip: 'button:submit', metin: 'Satın al' }), 'tikla'), true);
  assert.equal(gonderimMi(oge({ ...ara, tip: 'input:text', parolaFormu: true }), 'enter'), true);
  // Yöntemi bilinmeyen form (null + formIcinde) güvenli tarafta: gönderim.
  assert.equal(gonderimMi(oge({ formIcinde: true, formYontemi: null, tip: 'button:submit', metin: 'Ara' }), 'tikla'), true);
});

test('bağlantıya tıklama gönderim değil', () => { // adı gönderme/silme/satın alma sözcüğü taşımıyorsa (düzeltme turu 1: taşıyorsa onaylı)
  assert.equal(gonderimMi(oge({ tip: 'a', metin: 'Fiyatlar' }), 'tikla'), false);
  assert.equal(gonderimMi(oge({ tip: 'a', metin: 'İkinci sayfa' }), 'tikla'), false);
  assert.equal(gonderimMi(postForm({ tip: 'a', metin: 'Şifremi unuttum', parolaFormu: true }), 'tikla'), false);
  assert.equal(gonderimMi(oge({ tip: 'a', metin: 'Sil' }), 'tikla'), true);
  assert.equal(gonderimMi(oge({ tip: 'a', metin: 'Satın al' }), 'tikla'), true);
  assert.equal(gonderimMi(oge({ tip: 'a', metin: '', etiket: 'Delete' }), 'tikla'), true);
  assert.equal(gonderimMi(oge({ tip: 'area', etiket: 'Pay' }), 'tikla'), true);
  // Metin kutusuna tıklamak (odaklamak) gönderim değil.
  assert.equal(gonderimMi(postForm({ tip: 'input:text', etiket: 'Ad' }), 'tikla'), false);
  assert.equal(gonderimMi(postForm({ tip: 'select:select-one' }), 'tikla'), false);
});

test('metni "Satın al" olan düğme form dışında da gönderim', () => { // tr, en, de, fr
  for (const m of ['Satın al', 'SATIN AL', 'Hemen satın al', 'Öde', 'Ödeme yap', 'Sipariş ver', 'Giriş yap', 'GİRİŞ YAP', 'Kaydol', 'Onayla', 'Sil', 'Gönder',
    'Buy now', 'Pay', 'Place order', 'Sign in', 'Log in', 'Confirm', 'Delete', 'Submit', 'Jetzt kaufen', 'Bezahlen', 'Löschen', 'Bestätigen', 'Acheter', 'Payer', 'Supprimer', 'Se connecter', 'Confirmer']) {
    assert.equal(gonderimMi(oge({ tip: 'button:button', metin: m }), 'tikla'), true, m);
    assert.equal(gonderimMi(oge({ tip: 'div', etiket: m }), 'tikla'), false, `${m}: düğme olmayan öğe (div) değil`);
  }
  // role=button olan öğe "button:rol" sayılır (sayfa içi yoklama böyle bildirir).
  assert.equal(gonderimMi(oge({ tip: 'button:rol', metin: 'Sil' }), 'tikla'), true);
  // Etiketten de (aria-label) okunur.
  assert.equal(gonderimMi(oge({ tip: 'button:button', metin: '', etiket: 'Siparişi onayla' }), 'tikla'), true);
  // Masum düğmeler.
  for (const m of ['Menü', 'Daha fazla göster', 'Ara', 'Kapat', 'Sepete git', 'Siparişlerim', 'Gönderi', 'Details', 'Next']) assert.equal(gonderimMi(oge({ tip: 'button:button', metin: m }), 'tikla'), false, m);
});

test('geri dönüşsüz sözcük listesi: dört dil, sözcük sınırıyla (alt dizge değil)', () => {
  for (const s of ['gönder', 'satın al', 'öde', 'sipariş', 'giriş yap', 'kaydol', 'onayla', 'sil', 'submit', 'buy', 'pay', 'order', 'sign in', 'log in', 'confirm', 'delete']) {
    assert.ok(GERI_DONUSSUZ_SOZCUKLER.includes(s), s);
  }
  assert.ok(GERI_DONUSSUZ_SOZCUKLER.length >= 40);
  assert.equal(geriDonussuzMu('Silinen öğeler'), false); // "silinen" ≠ "sil"
  assert.equal(geriDonussuzMu('Ödev'), false); // "ödev" ≠ "öde"
  assert.equal(geriDonussuzMu('Mesajı gönder'), true);
  assert.equal(geriDonussuzMu('Odeme yap'), true); // aksansız yazım da yakalanır
  assert.equal(geriDonussuzMu('GÖNDER'), true);
  assert.equal(geriDonussuzMu('s’inscrire'), true);
  assert.equal(geriDonussuzMu(''), false);
});

test('parola ya da kart formunda her düğme gönderim', () => { // metni masum olsa da; alanlar ve bağlantılar değil
  assert.equal(gonderimMi(oge({ tip: 'button:button', metin: 'Devam', parolaFormu: true }), 'tikla'), true);
  assert.equal(gonderimMi(oge({ tip: 'button:button', metin: 'Devam', kartFormu: true }), 'tikla'), true);
  assert.equal(gonderimMi(oge({ tip: 'button:rol', metin: 'Göster', parolaFormu: true }), 'tikla'), true);
  assert.equal(gonderimMi(oge({ tip: 'input:text', parolaFormu: true, formIcinde: false }), 'tikla'), false);
  // Form içinde Enter, GET olsa da parola/kart formunda gönderimdir.
  assert.equal(gonderimMi(oge({ tip: 'input:password', formIcinde: true, formYontemi: 'get', parolaFormu: true }), 'enter'), true);
  assert.equal(gonderimMi(oge({ tip: 'input:text', formIcinde: true, formYontemi: 'post', kartFormu: true }), 'enter'), true);
  // Parola formsuz (SPA) sayfada da, alanın bulunduğu kapta Enter gönderim sayılır.
  assert.equal(gonderimMi(oge({ tip: 'input:text', formIcinde: false, parolaFormu: true }), 'enter'), true);
});

test('parola ve kart alanı desenleri (yazma yasağı ve form sınıflaması aynı desenden)', () => {
  for (const s of ['password', 'Parola', 'şifre', 'sifre', 'user_passwd', 'pwd']) assert.match(s, PAROLA_ALAN_DESENI, s);
  for (const s of ['cvv', 'CVC', 'cardnumber', 'card number', 'kart numarası', 'kredi kartı', 'iban', 'cc-number']) assert.match(s, KART_ALAN_DESENI, s);
  for (const s of ['ad', 'e-posta', 'telefon', 'adres', 'arama']) { assert.doesNotMatch(s, PAROLA_ALAN_DESENI, s); assert.doesNotMatch(s, KART_ALAN_DESENI, s); }
});

test('gönderim onay kartı: parola/kart formunda ek uyarı; sayfa adresi yazılır; alan değerleri kartta yok', () => {
  const sayfa = { adres: 'https://giris.ornek.test/giris?x=1', baslik: 'Giriş' };
  const i = gonderimOnayIstegi(postForm({ tip: 'button:submit', metin: 'Giriş yap', parolaFormu: true }), 'tikla', sayfa, { eylem: 'https://giris.ornek.test/oturum', yontem: 'post', alanlar: [{ ad: 'eposta', dolu: true }, { ad: 'parola', tur: 'parola', dolu: true }] });
  assert.match(i.aciklama, /giris\.ornek\.test/);
  assert.match(i.aciklama, /parola/i);
  assert.match(i.onizleme ?? '', /Giriş yap/);
  assert.equal(i.tehlike, 'yuksek');
  // Formsuz tehlikeli düğme: "düğmesine bassın mı".
  const d = gonderimOnayIstegi(oge({ tip: 'button:button', metin: 'Hesabı sil' }), 'tikla', sayfa, null);
  assert.match(d.baslik, /Hesabı sil/);
  assert.equal(d.tehlike, 'yuksek');
  // Çok uzun düğme metni/alan sayısı kırpılır.
  const u = gonderimOnayIstegi(postForm({ tip: 'button:submit', metin: 'x'.repeat(500) }), 'tikla', sayfa, { eylem: '', yontem: 'post', alanlar: Array.from({ length: 40 }, (_, n) => ({ ad: `alan${n}`, dolu: true })) });
  assert.ok((u.onizleme ?? '').length < 700, String((u.onizleme ?? '').length));
});

// ── Düzeltme turu 1 (inceleme: beş Important) ─────────────────────────────────────────────────────────────────────────────────────────────

test('yöntem eşlemesi: yalnız açık method/formmethod=get ya da role=search GET; yöntemsiz (action\'lı olsa da) ve dialog bilinmiyor = onaylı', () => {
  // Sayfa içi yoklama bu işlevi toString() ile sayfaya götürür: bağımsız çalışmalı (aynı sonuçlar).
  const sayfadaki = new Function(`return ${formYontemiBul.toString()}`)() as typeof formYontemiBul;
  for (const bul of [formYontemiBul, sayfadaki]) {
    assert.equal(bul('get', null, null), 'get');
    assert.equal(bul('GET', null, null), 'get');
    assert.equal(bul('post', null, null), 'post');
    assert.equal(bul(null, 'post', null), 'post', 'formmethod düğmede yöntemi ezer');
    assert.equal(bul('get', 'post', null), 'post');
    assert.equal(bul(null, null, 'search'), 'get');
    assert.equal(bul(null, null, null), null, 'yöntemsiz form: bilinmiyor');
    assert.equal(bul('', null, 'form'), null);
    assert.equal(bul('dialog', null, null), null);
    assert.equal(bul('tuhaf', null, null), null);
  }
  // Karar zinciri: yöntemsiz formda submit ve Enter onaylı (örnek: <form action="/odeme/tamamla"><button>Devam</button></form>).
  const yontemsiz = formYontemiBul(null, null, null);
  assert.equal(gonderimMi(oge({ tip: 'button', metin: 'Devam', formIcinde: true, formYontemi: yontemsiz }), 'tikla'), true);
  assert.equal(gonderimMi(oge({ tip: 'input:text', formIcinde: true, formYontemi: yontemsiz }), 'enter'), true);
  assert.equal(gonderimMi(oge({ tip: 'input:search', formIcinde: true, formYontemi: formYontemiBul('get', null, null) }), 'enter'), false);
});

test('ödeme çerçevesi: sağlayıcı kökeni ya da adı/başlığında card, kart, payment, ödeme geçen iframe', () => {
  const sayfadaki = new Function(`return ${odemeCercevesiMi.toString()}`)() as typeof odemeCercevesiMi;
  for (const f of [odemeCercevesiMi, sayfadaki]) {
    for (const src of ['https://js.stripe.com/v3/elements-inner-card.html', 'https://checkout.adyen.com/x', 'https://assets.braintreegateway.com/hosted', 'https://www.paypal.com/smart/card-fields', 'https://pay.checkout.com/frames', 'https://static.iyzipay.com/f', 'https://www.paytr.com/odeme']) {
      assert.equal(f(src, '', ''), true, src);
    }
    assert.equal(f('https://ornek.test/f', '', 'Güvenli ödeme alanı'), true);
    assert.equal(f('https://ornek.test/f', 'card-frame', ''), true);
    assert.equal(f('https://ornek.test/f', '', 'Kart bilgileri'), true);
    assert.equal(f('https://ornek.test/f', 'payment', ''), true);
    assert.equal(f('https://ornek.test/f', '', 'Ödeme'), true);
    assert.equal(f('https://ornek.test/reklam', 'banner', 'Reklam'), false);
    assert.equal(f('', '', ''), false);
    assert.equal(f(null, undefined, null), false);
  }
});

test('öğe "kart formu" olunca (ödeme iframe\'i) sözcüksüz düğme de onaylı', () => {
  assert.equal(gonderimMi(oge({ tip: 'button:button', metin: 'Devam', kartFormu: true, formIcinde: true, formYontemi: 'post' }), 'tikla'), true);
});

test('role=button / menuitem / [onclick] öğeleri (sayfa "button:rol" der) adı sözcük taşıyorsa onaylı; sözcüksüzse değil', () => {
  for (const m of ['Sil', 'Delete', 'Satın al', 'Buy', 'Öde', 'Pay', 'Gönder', 'Send', 'Onayla', 'Confirm', 'Submit']) assert.equal(gonderimMi(oge({ tip: 'button:rol', metin: m }), 'tikla'), true, m);
  assert.equal(gonderimMi(oge({ tip: 'button:rol', etiket: 'Hesabı sil' }), 'tikla'), true);
  assert.equal(gonderimMi(oge({ tip: 'button:rol', metin: 'Menüyü aç' }), 'tikla'), false);
});

// ── Gönderim kalkanı: SEKME BAŞINA durum (düzeltme turu 4, K1–K7; sahte saat) ─────────────────────────────────────────────────────────────

/** Sahte saat, P14 kapısı ve tur durumu: testler zamanı elle ilerletir. */
function ortamKur(o: { bulutKapali?: boolean; tur?: boolean } = {}) {
  const d = { simdi: 1_000_000, bulutKapali: o.bulutKapali ?? false, tur: o.tur ?? true };
  return { d, ortam: { saat: () => d.simdi, bulutKapali: () => d.bulutKapali, turSuruyor: () => d.tur } };
}
type Ortam = ReturnType<typeof ortamKur>['ortam'];
type Sahip = { ad: string };
/** Ajanın dokunduğu bir sekmenin kalkanı (sayfası: adres + başlık). */
function sekmeKur(ortam: Ortam, adres = 'https://a.test/form', baslik = 'A formu'): SekmeKalkani<Sahip> {
  const k = new SekmeKalkani<Sahip>(ortam, () => ({ adres, baslik }));
  k.ajan = true;
  return k;
}
/** Kartı soran (aracın bağlamındaki onay): sorulan kartları toplar. */
function sorucu(yanit = 'bir_kez') {
  const kartlar: GonderimOnayi[] = [];
  return { kartlar, sor: (kart: GonderimOnayi) => { kartlar.push(kart); return Promise.resolve(yanit); } };
}
function ertelenen<T>() { let coz!: (v: T) => void; const soz = new Promise<T>((c) => { coz = c; }); return { soz, coz }; }
const sira = () => new Promise((c) => setImmediate(c));
const AJAX: SubmitBilgisi = submitBilgisi({ formYontemi: null, gonderenYontemi: null, rol: null, alanTurleri: ['text', 'email'] });
const xhr = (method = 'POST', ek: Record<string, unknown> = {}) => ({ method, resourceType: 'xhr', url: 'https://a.test/api/kaydet?jeton=GIZLI', ...ek });
const postGezinim = (resourceType = 'mainFrame') => ({ method: 'POST', resourceType });
/** Onaysız etkileşimli eylem + sayılan submit: K4'ün bekletme kuralı kurulu. */
function kurulu(k: SekmeKalkani<Sahip>, s = sorucu()): { e: EylemKaydi<Sahip>; s: ReturnType<typeof sorucu> } {
  const e = k.etkilesimBasla({ onayli: false, sahip: { ad: 'arac' }, sor: s.sor });
  assert.equal(k.submitGoruldu(AJAX), true, 'yöntemsiz form submit\'i sayılır');
  return { e, s };
}

test('K1: iki sekme — A\'daki submit B\'nin POST\'unu bekletmez (durum sekme başına; harita webContents kimliğiyle)', () => {
  const { ortam } = ortamKur();
  const harita = new Map<number, SekmeKalkani<Sahip>>([[11, sekmeKur(ortam, 'https://a.test/form', 'A formu')], [12, sekmeKur(ortam, 'https://b.test/posta', 'B postası')]]);
  const A = harita.get(11)!;
  const B = harita.get(12)!;
  const { s } = kurulu(A);
  assert.deepEqual(B.istekKarari(xhr()), { karar: 'gec' }, 'B\'de eylem yok: arka plandaki eşitleme dokunulmadan geçer');
  // B'de de onaysız bir eylem olsa: A'nın submit'i B'ye yazılmaz.
  B.etkilesimBasla({ onayli: false, sahip: { ad: 'b' }, sor: sorucu().sor });
  assert.deepEqual(B.istekKarari(xhr()), { karar: 'gec' });
  assert.equal(B.eylem?.submitAni, null);
  assert.equal(A.istekKarari(xhr()).karar, 'bekle', 'A\'nın kendi isteği bekletilir');
  assert.equal(s.kartlar.length, 1);
  // Sekme kapanınca kaydı silinir (ana süreç: webContents 'destroyed').
  harita.delete(11);
  assert.deepEqual([...harita.keys()], [12]);
});

test('K1: kart ve not isteğin KENDİ sekmesinin adresini ve başlığını gösterir (etkin sekmeninkini değil)', async () => {
  const { ortam } = ortamKur();
  const A = sekmeKur(ortam, 'https://a.test/form?oturum=GIZLI', 'A formu');
  sekmeKur(ortam, 'https://b.test/posta', 'B postası'); // etkin sekme bu olabilir: kart onu göstermez
  const { s } = kurulu(A);
  assert.equal(A.istekKarari(xhr()).karar, 'bekle');
  const kart = s.kartlar[0];
  assert.match(kart.aciklama, /a\.test\/form/);
  assert.match(kart.aciklama, /“A formu”/);
  assert.doesNotMatch(JSON.stringify(kart), /b\.test|B postası/);
  assert.doesNotMatch(JSON.stringify(kart), /GIZLI/, 'sorgu dizgesi (sır olabilir) kartta yok');
  assert.equal(kart.tehlike, 'yuksek');
  assert.equal('gorevBoyu' in kart, false);
  // Araç döndükten sonra gelen istek: kartsız iptal; not da isteğin sekmesini söyler.
  const A2 = sekmeKur(ortam, 'https://a.test/sepet', 'Sepet');
  const { e } = kurulu(A2);
  await aracDonusu([e]);
  const r = A2.istekKarari(xhr());
  if (r.karar !== 'iptal') return assert.fail(r.karar);
  assert.ok(r.not?.startsWith(ONAYSIZ_FORM_NOTU), r.not);
  assert.match(r.not ?? '', /a\.test\/sepet/);
  assert.match(r.not ?? '', /“Sepet”/);
  assert.doesNotMatch(r.not ?? '', /B postası/);
});

test('K4: submit\'ten 11 sn sonra aynı sekmede gelen POST bekletilmez; araya araç çağrıları girse de sonuç aynı (pencere submit anına bağlı)', async () => {
  const { d, ortam } = ortamKur();
  assert.equal(GONDERIM_PENCERESI_MS, 10_000);
  // (a) Eylemin aracı hâlâ sürüyor: yine de 11 sn sonra kart açılmaz.
  const A = sekmeKur(ortam);
  const { s } = kurulu(A);
  d.simdi += 11_000;
  assert.deepEqual(A.istekKarari(xhr()), { karar: 'gec' });
  assert.equal(s.kartlar.length, 0, 'kart açılmaz');
  // (b) Araya araç çağrıları: oku / bekle / aç (etkileşimsiz ajan eylemleri) ve eylemin aracının dönüşü.
  const B = sekmeKur(ortam);
  const { e } = kurulu(B);
  d.simdi += 2000; B.ajanEylemiBasla(); d.simdi += 3000; B.ajanEylemiBitti();
  await aracDonusu([e]);
  d.simdi += 2000; B.ajanEylemiBasla(); d.simdi += 2000; B.ajanEylemiBitti();
  d.simdi += 2001; // submit'ten 11,001 sn
  assert.deepEqual(B.istekKarari(xhr()), { karar: 'gec' });
  assert.equal(B.engellenenAl().sayi, 0, 'iptal yok, not yok');
  // Sınır: tam 10 sn'de hâlâ bekletilir (≤ 10 sn).
  const C = sekmeKur(ortam);
  kurulu(C);
  d.simdi += 10_000;
  assert.equal(C.istekKarari(xhr()).karar, 'bekle');
});

test('K3: açık GET formu, role=search ya da arama alanlı form submit\'i kalkanı kurmaz (arama onaysızdır)', () => {
  const { ortam } = ortamKur();
  const durumlar: [string, SubmitBilgisi][] = [
    ['method=get', submitBilgisi({ formYontemi: 'get', gonderenYontemi: null, rol: null, alanTurleri: ['text'] })],
    ['method=" GET "', submitBilgisi({ formYontemi: ' GET ', gonderenYontemi: null, rol: null, alanTurleri: [] })],
    ['formmethod=get (düğmenin yöntemi formunkini ezer)', submitBilgisi({ formYontemi: 'post', gonderenYontemi: 'get', rol: null, alanTurleri: [] })],
    ['role=search', submitBilgisi({ formYontemi: null, gonderenYontemi: null, rol: 'search', alanTurleri: ['text'] })],
    ['type=search alanı', submitBilgisi({ formYontemi: null, gonderenYontemi: null, rol: null, alanTurleri: ['text', 'SEARCH'] })],
  ];
  for (const [ad, b] of durumlar) {
    const k = sekmeKur(ortam);
    const s = sorucu();
    k.etkilesimBasla({ onayli: false, sahip: { ad }, sor: s.sor });
    assert.equal(aramaFormuMu(b), true, ad);
    assert.equal(k.submitGoruldu(b), false, `${ad}: sayılmaz`);
    assert.deepEqual(k.istekKarari(xhr()), { karar: 'gec' }, `${ad}: sonuç sayfasının ya da SPA'nın POST telemetrisi geçer`);
    assert.equal(s.kartlar.length, 0);
  }
});

test('K3: yöntemsiz (AJAX) form submit\'i kalkanı kurar; method=post, formmethod=post ve tanınmayan yöntem de', () => {
  const { ortam } = ortamKur();
  const durumlar = [
    AJAX,
    submitBilgisi({ formYontemi: 'post', gonderenYontemi: null, rol: null, alanTurleri: [] }),
    submitBilgisi({ formYontemi: 'get', gonderenYontemi: 'post', rol: null, alanTurleri: [] }),
    submitBilgisi({ formYontemi: 'dialog', gonderenYontemi: null, rol: 'form', alanTurleri: ['text', null] }),
  ];
  for (const b of durumlar) {
    const k = sekmeKur(ortam);
    k.etkilesimBasla({ onayli: false, sahip: { ad: 'x' }, sor: sorucu().sor });
    assert.equal(aramaFormuMu(b), false, JSON.stringify(b));
    assert.equal(k.submitGoruldu(b), true, JSON.stringify(b));
    assert.equal(k.istekKarari(xhr()).karar, 'bekle', JSON.stringify(b));
  }
});

test('K3: submit yalnız ajan sekmesinde, son etkileşimli eylem ONAYSIZKEN ve eylemin başından en çok 10 sn içinde sayılır; bozuk bildirim güvenli tarafta okunur', () => {
  const { d, ortam } = ortamKur();
  const k = sekmeKur(ortam);
  assert.equal(k.submitGoruldu(AJAX), false, 'eylem yok (sayfanın ya da kullanıcının kendi submit\'i)');
  k.etkilesimBasla({ onayli: true, onayAni: d.simdi, sahip: { ad: 'onayli' }, sor: sorucu().sor });
  assert.equal(k.submitGoruldu(AJAX), false, 'onaylı eylem');
  assert.deepEqual(k.istekKarari(xhr()), { karar: 'gec' }, 'K4.2: onaylı eylemin isteği geçer');
  k.etkilesimBasla({ onayli: false, sahip: { ad: 'yeni' }, sor: sorucu().sor });
  d.simdi += 10_001;
  assert.equal(k.submitGoruldu(AJAX), false, 'eylemin başından 10 sn geçti');
  assert.equal(k.eylem?.submitAni, null);
  const yabanci = new SekmeKalkani<Sahip>(ortam, () => ({ adres: 'https://c.test/', baslik: 'C' })); // ajanın hiç dokunmadığı sekme
  yabanci.etkilesimBasla({ onayli: false, sahip: { ad: 'c' }, sor: sorucu().sor });
  assert.equal(yabanci.submitGoruldu(AJAX), false);
  // İzcinin bildirimi güvenilmez girdi: alan yalnız tam `true` ise doğru sayılır; yoksa (eski izci, bozuk bildirim) submit sayılır.
  assert.deepEqual(submitBilgisiAyikla(undefined), { get: false, aramaRolu: false, aramaAlani: false });
  assert.deepEqual(submitBilgisiAyikla({ get: 'evet', aramaRolu: 1, aramaAlani: true }), { get: false, aramaRolu: false, aramaAlani: true });
});

test('K4: kapsam yalnız xhr (fetch dahil) POST / PUT / PATCH / DELETE; ping ve cspReport bekletilmez', () => {
  const { ortam } = ortamKur();
  const k = sekmeKur(ortam);
  const { s } = kurulu(k);
  for (const rt of ['ping', 'cspReport', 'image', 'script', 'other', 'media', 'mainFrame', 'subFrame']) assert.deepEqual(k.istekKarari(xhr('POST', { resourceType: rt })), { karar: 'gec' }, rt);
  assert.deepEqual(k.istekKarari(xhr('GET')), { karar: 'gec' });
  for (const y of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) assert.equal(k.istekKarari(xhr(y)).karar, 'bekle', y);
  assert.equal(s.kartlar.length, 1, 'aynı eylemin istekleri tek kartı paylaşır');
});

test('K4/K5: eylem başına tek kart (kartSoz); onaylanınca bekleyenler bırakılır, eylem onaylı olur, sonraki istekler geçer, sekmeye 10 sn tek kullanımlık gezinim izni', async () => {
  const { d, ortam } = ortamKur();
  const k = sekmeKur(ortam);
  const y = ertelenen<string>();
  const kartlar: GonderimOnayi[] = [];
  const e = k.etkilesimBasla({ onayli: false, sahip: { ad: 'x' }, sor: (kart) => { kartlar.push(kart); return y.soz; } });
  k.submitGoruldu(AJAX);
  const r1 = k.istekKarari(xhr());
  const r2 = k.istekKarari(xhr('PUT'));
  if (r1.karar !== 'bekle' || r2.karar !== 'bekle') return assert.fail(`${r1.karar} ${r2.karar}`);
  assert.equal(r1.soz, r2.soz, 'kartSoz paylaşılır');
  assert.equal(e.kartSoz, r1.soz);
  assert.equal(kartlar.length, 1);
  d.simdi += 4000; // kullanıcı 4 sn düşündü
  y.coz('bir_kez');
  assert.equal(await r1.soz, true);
  assert.equal(await r2.soz, true);
  assert.equal(e.onayli, true);
  assert.equal(e.kartSonucu, 'onay');
  assert.deepEqual(k.izin, { bitis: d.simdi + GEZINIM_IZNI_MS, kalan: 1 }, 'izin onay anından 10 sn');
  d.simdi += 3000;
  assert.deepEqual(k.istekKarari(xhr()), { karar: 'gec' }, 'K4.2: kart onaylanmış eylemin isteği geçer');
  assert.equal(await aracDonusu([e]), 'onay');
});

test('K4.3: araç dönmüşse bekletme yerine kartsız iptal; tek satır not (ONAYSIZ_FORM_NOTU + sekme) eylem başına bir kez; sonraki sonuçta ajana söylenir', async () => {
  const { d, ortam } = ortamKur();
  const k = sekmeKur(ortam, 'https://a.test/kayit', 'Kayıt');
  const { e, s } = kurulu(k);
  assert.equal(await aracDonusu([e]), null, 'kart yok');
  assert.equal(e.aracDondu, true);
  d.simdi += 1500;
  const r1 = k.istekKarari(xhr());
  const r2 = k.istekKarari(xhr());
  if (r1.karar !== 'iptal' || r2.karar !== 'iptal') return assert.fail(`${r1.karar} ${r2.karar}`);
  assert.equal(r1.not, sekmeNotu(ONAYSIZ_FORM_NOTU, { adres: 'https://a.test/kayit', baslik: 'Kayıt' }));
  assert.equal(r2.not, undefined, 'not eylem başına bir kez');
  assert.deepEqual(r1.sahip, { ad: 'arac' }, 'not eylemi başlatan aracın sohbetine');
  assert.equal(s.kartlar.length, 0, 'kart açılmaz (araç döndü)');
  assert.deepEqual(k.engellenenAl(), { sayi: 2, sayfaDegisti: false }, 'Minor 5 (tur 5): ikinci iptal not değil, ajana sayıyla söylenir');
  assert.equal(k.engellenenAl().sayi, 0);
  assert.equal(k.zorlaMi(), true, 'o sekmede sonraki etkileşimli eylem öğe ne olursa olsun onay ister');
  assert.equal(k.kilit, null, 'kartsız iptal kilit koymaz (kilit yalnız kart reddinde)');
  // Yeni eylemin notu yine bir kez düşer.
  const { e: e2 } = kurulu(k);
  await aracDonusu([e2]);
  const r3 = k.istekKarari(xhr());
  assert.ok(r3.karar === 'iptal' && r3.not);
});

test('K2: yalnız etkileşimli eylem kayıt açar ve aynı sekmenin iznini/kilidini siler; etkileşimsiz ajan eylemleri (oku, bekle, aç, geri, sekme, indir) değiştirmez', () => {
  const { d, ortam } = ortamKur();
  const k = sekmeKur(ortam);
  const diger = sekmeKur(ortam, 'https://b.test/', 'B');
  diger.etkilesimBasla({ onayli: true, onayAni: d.simdi, sahip: { ad: 'b' }, sor: sorucu().sor });
  const e1 = k.etkilesimBasla({ onayli: true, onayAni: d.simdi, sahip: { ad: '1' }, sor: sorucu().sor });
  assert.deepEqual(
    { no: e1.no, onayli: e1.onayli, baslangic: e1.baslangic, submitAni: e1.submitAni, kartSoz: e1.kartSoz, notDusuldu: e1.notDusuldu },
    { no: 1, onayli: true, baslangic: d.simdi, submitAni: null, kartSoz: null, notDusuldu: false },
  );
  const izin = k.izin;
  k.ajanEylemiBasla(); d.simdi += 500; k.ajanEylemiBitti();
  assert.equal(k.eylem, e1);
  assert.deepEqual(k.izin, izin);
  const e2 = k.etkilesimBasla({ onayli: false, sahip: { ad: '2' }, sor: sorucu().sor });
  assert.equal(e2.no, 2);
  assert.equal(k.eylem, e2);
  assert.equal(k.izin, null, 'yeni etkileşimli eylem aynı sekmenin iznini siler');
  assert.ok(diger.izin, 'başka sekmeye dokunmaz');
});

test('K5: onaylanan eylemin gezinim izni 10 sn sonra biter; araya tarayici_ac ya da tarayici_bekle girse de uzamaz, dirilmez; tek kullanımlık', () => {
  const { d, ortam } = ortamKur();
  assert.equal(GEZINIM_IZNI_MS, 10_000);
  const k = sekmeKur(ortam);
  const onayAni = d.simdi;
  d.simdi += 50; // onay ile eylemin başı arası (öğe yeniden okunur)
  k.etkilesimBasla({ onayli: true, onayAni, sahip: { ad: 'ode' }, sor: sorucu().sor });
  assert.deepEqual(k.izin, { bitis: onayAni + 10_000, kalan: 1 });
  // tarayici_bekle, sonra tarayici_ac (etkileşimsiz ajan eylemleri; ikisi de eylem bitince eskiden izni yeniden uzatırdı).
  for (const [bas, son] of [[1000, 3000], [500, 4000]]) { d.simdi += bas; k.ajanEylemiBasla(); d.simdi += son; k.ajanEylemiBitti(); }
  assert.deepEqual(k.izin, { bitis: onayAni + 10_000, kalan: 1 }, 'izin uzamadı');
  d.simdi = onayAni + 10_001;
  assert.deepEqual(k.gezinimKarari(postGezinim()), { karar: 'iptal' }, '10 sn doldu: gecikmeli form.submit() iptal');
  k.ajanEylemiBasla(); d.simdi += 100; k.ajanEylemiBitti();
  assert.equal(k.izin, null, 'dirilmez');
  // Süresi içinde: onaydan sonra tarayici_bekle, ardından 2 sn gecikmeli submit geçer; ikincisi geçmez.
  const k2 = sekmeKur(ortam);
  k2.etkilesimBasla({ onayli: true, onayAni: d.simdi, sahip: { ad: 'ode' }, sor: sorucu().sor });
  k2.ajanEylemiBasla(); d.simdi += 3000; k2.ajanEylemiBitti();
  d.simdi += 2000;
  assert.deepEqual(k2.gezinimKarari(postGezinim()), { karar: 'gec' });
  assert.deepEqual(k2.gezinimKarari(postGezinim('subFrame')), { karar: 'iptal' }, 'tek kullanımlık');
});

test('K5: izin başka sekmede kullanılamaz (sekmeye bağlı); başka sekmedeki etkileşim onu silmez', () => {
  const { d, ortam } = ortamKur();
  const A = sekmeKur(ortam);
  const B = sekmeKur(ortam, 'https://b.test/', 'B');
  const onayAni = d.simdi;
  A.etkilesimBasla({ onayli: true, onayAni, sahip: { ad: 'a' }, sor: sorucu().sor });
  d.simdi += 1000;
  assert.deepEqual(B.gezinimKarari(postGezinim()), { karar: 'iptal' }, 'B\'nin POST gezinimi: B\'nin izni yok (tur sürüyor)');
  assert.deepEqual(A.izin, { bitis: onayAni + 10_000, kalan: 1 }, 'A\'nın izni tüketilmedi');
  B.etkilesimBasla({ onayli: false, sahip: { ad: 'b' }, sor: sorucu().sor });
  assert.deepEqual(A.gezinimKarari(postGezinim()), { karar: 'gec' });
});

test('K6: ret sonrası aynı sekmenin yinelenen POST\'u 10 sn sonra da iptal (kilit 60 sn); 60 sn dolunca ya da aynı sekmede yeni etkileşimli eylemde kilit kalkar', async () => {
  const { d, ortam } = ortamKur();
  assert.equal(KILIT_MS, 60_000);
  const k = sekmeKur(ortam, 'https://a.test/posta', 'Posta');
  const { e } = kurulu(k, sorucu('reddet'));
  const r = k.istekKarari(xhr());
  if (r.karar !== 'bekle') return assert.fail(r.karar);
  assert.equal(await r.soz, false, 'reddedilen istek iptal');
  const retAni = d.simdi;
  assert.deepEqual(k.kilit, { bitis: retAni + KILIT_MS, neden: 'red' });
  assert.equal(e.kartSonucu, 'red');
  assert.equal(e.onayli, false);
  assert.equal(await aracDonusu([e]), 'red');
  assert.equal(k.engellenenAl().sayi, 1, 'reddedilen (bekletilen) istek sayılır');
  assert.equal(k.zorlaMi(), true);
  // Sayfanın yinelediği gönderim (axios-retry, gönderim kuyruğu): 12 sn sonra, submit penceresi çoktan dolmuşken.
  d.simdi += 12_000;
  const y1 = k.istekKarari(xhr());
  const y2 = k.istekKarari(xhr('PUT'));
  if (y1.karar !== 'iptal' || y2.karar !== 'iptal') return assert.fail(`${y1.karar} ${y2.karar}`);
  assert.equal(y1.not, sekmeNotu(KILIT_NOTU, { adres: 'https://a.test/posta', baslik: 'Posta' }), 'ilk iptalde tek not');
  assert.equal(y2.not, undefined);
  assert.equal(k.gezinimKarari(postGezinim()).karar, 'iptal', 'POST gezinimi de kartsız iptal');
  k.girdi();
  assert.equal(k.istekKarari(xhr()).karar, 'iptal', 'kullanıcının sıradan girdisi kilidi kaldırmaz (yalnız kendi gezinimi)');
  // Kapsam K4 ile aynı: GET ve ping geçer.
  assert.deepEqual(k.istekKarari(xhr('GET')), { karar: 'gec' });
  assert.deepEqual(k.istekKarari(xhr('POST', { resourceType: 'ping' })), { karar: 'gec' });
  // 60 sn dolunca kalkar.
  d.simdi = retAni + KILIT_MS + 1;
  assert.equal(k.kilit, null);
  assert.deepEqual(k.istekKarari(xhr()), { karar: 'gec' });
  // Aynı sekmede yeni etkileşimli eylemde kalkar; başka sekmeninki kaldırmaz.
  const k2 = sekmeKur(ortam);
  const diger = sekmeKur(ortam, 'https://b.test/', 'B');
  kurulu(k2, sorucu('reddet'));
  const r2 = k2.istekKarari(xhr());
  if (r2.karar === 'bekle') await r2.soz;
  diger.etkilesimBasla({ onayli: false, sahip: { ad: 'b' }, sor: sorucu().sor });
  assert.equal(k2.istekKarari(xhr()).karar, 'iptal', 'başka sekmedeki eylem kilidi kaldırmaz');
  k2.etkilesimBasla({ onayli: false, sahip: { ad: 'yeni' }, sor: sorucu().sor });
  assert.equal(k2.kilit, null);
  assert.deepEqual(k2.istekKarari(xhr()), { karar: 'gec' });
});

test('K6: kilit kullanıcının kendi gezinimiyle kalkar (adres çubuğu, Geri, sayfada kendi tıklamasıyla başlayan gezinim); ajanın ve sayfanın gezinimi kaldırmaz', async () => {
  const { d, ortam } = ortamKur();
  const kilitli = async () => {
    const k = sekmeKur(ortam);
    kurulu(k, sorucu('reddet'));
    const r = k.istekKarari(xhr());
    if (r.karar === 'bekle') await r.soz;
    assert.ok(k.kilit);
    return k;
  };
  const a = await kilitli();
  a.kullaniciGezinimi();
  assert.equal(a.kilit, null, 'adres çubuğu / araç çubuğu');
  const b = await kilitli();
  b.ajanEylemiBasla(); b.gezinimBasladi(); b.ajanEylemiBitti();
  assert.ok(b.kilit, 'ajanın tarayici_ac\'ı kaldırmaz');
  d.simdi += 1000;
  b.gezinimBasladi();
  assert.ok(b.kilit, 'sayfanın kendiliğinden başlattığı gezinim (kullanıcı girdisi yok) kaldırmaz');
  b.girdi();
  b.gezinimBasladi();
  assert.equal(b.kilit, null, 'kullanıcı sayfada tıkladı ve gezinim başladı');
});

test('K4/K6: kart açıkken Durdur\'a basılınca istek iptal edilir ve araç döner (araç kart yanıtlanmadan dönmez)', async () => {
  const { ortam } = ortamKur();
  const k = sekmeKur(ortam);
  const durdur = new AbortController();
  // ajan/dongu.ts: durdur → onaylariReddet: bekleyen kart 'reddet' olur.
  const sor = () => new Promise<string>((c) => durdur.signal.addEventListener('abort', () => c('reddet'), { once: true }));
  const e = k.etkilesimBasla({ onayli: false, sahip: { ad: 'arac' }, sor });
  k.submitGoruldu(AJAX);
  const r = k.istekKarari(xhr());
  if (r.karar !== 'bekle') return assert.fail(r.karar);
  let dondu = false;
  const donus = aracDonusu([e]).then((s) => { dondu = true; return s; });
  await sira(); await sira();
  assert.equal(dondu, false, 'kart açık: araç dönmez');
  assert.equal(e.aracDondu, false);
  const r2 = k.istekKarari(xhr());
  assert.ok(r2.karar === 'bekle' && r2.soz === r.soz, 'kart açıkken gelen istek aynı karta katılır');
  durdur.abort();
  assert.equal(await r.soz, false, 'istek iptal');
  assert.equal(await donus, 'red');
  assert.equal(dondu, true);
  assert.equal(e.aracDondu, true);
  assert.ok(k.kilit, 'Durdur bir ret sayılır: sayfanın yinelediği gönderim de geçemez');
});

test('araç dönüşü: çağrının bütün eylemlerinin açık kartları beklenir (her sekmede en çok bir açık kart: tur 5); ret önceliklidir; kart kalmayınca eylemler "döndü" işaretlenir', async () => {
  const { ortam } = ortamKur();
  const kA = sekmeKur(ortam);
  const kB = sekmeKur(ortam, 'https://b.test/', 'B');
  const y1 = ertelenen<string>();
  const y2 = ertelenen<string>();
  const e1 = kA.etkilesimBasla({ onayli: false, sahip: { ad: 'cagri' }, sor: () => y1.soz });
  kA.submitGoruldu(AJAX);
  kA.istekKarari(xhr());
  const e2 = kB.etkilesimBasla({ onayli: false, sahip: { ad: 'cagri' }, sor: () => y2.soz });
  kB.submitGoruldu(AJAX);
  kB.istekKarari(xhr());
  let dondu = false;
  const donus = aracDonusu([e1, e2]).then((s) => { dondu = true; return s; });
  y1.coz('bir_kez');
  await sira(); await sira();
  assert.equal(dondu, false, 'ikinci kart hâlâ açık');
  y2.coz('reddet');
  assert.equal(await donus, 'red');
  assert.ok(e1.aracDondu && e2.aracDondu);
});

test('K5/K7: onaydan sonra P14 kapalıysa (Gizli ya da "Yalnız bu bilgisayar") istek bırakılmaz ve doğru satır yazılır; açıksa "istek gönderildi"', async () => {
  const { d, ortam } = ortamKur();
  const k = sekmeKur(ortam);
  const y = ertelenen<string>();
  const e = k.etkilesimBasla({ onayli: false, sahip: { ad: 'x' }, sor: () => y.soz });
  k.submitGoruldu(AJAX);
  const r = k.istekKarari(xhr());
  if (r.karar !== 'bekle') return assert.fail(r.karar);
  d.bulutKapali = true; // kart açıkken Gizli açıldı: karar bırakma anında yeniden sorulur
  y.coz('bir_kez');
  assert.equal(await r.soz, false, 'istek bırakılmaz');
  assert.equal(e.kartSonucu, 'p14');
  const s = await aracDonusu([e]);
  assert.equal(s, 'p14');
  assert.equal(kartSatiri(s), ONAY_P14_SATIRI);
  assert.equal(ONAY_P14_SATIRI, 'Kullanıcı onayladı ama Gizli mod ya da “Yalnız bu bilgisayar” açık olduğu için istek gönderilmedi.');
  assert.equal(onayliSonuc('ARACIN KENDİ SONUCU', ONAY_P14_SATIRI), `ARACIN KENDİ SONUCU\n\n${ONAY_P14_SATIRI}`);
  assert.ok(k.kilit, 'gönderilmeyen isteği sayfa yineleyemez (P14: yenisi başlamaz)');
  assert.equal(e.onayli, false);
  assert.equal(k.izin, null);
  // P14 açık değilken: istek bırakılır, satır "istek gönderildi".
  d.bulutKapali = false;
  const k2 = sekmeKur(ortam);
  const { e: e2 } = kurulu(k2);
  const r2 = k2.istekKarari(xhr());
  if (r2.karar !== 'bekle') return assert.fail(r2.karar);
  assert.equal(await r2.soz, true);
  assert.equal(kartSatiri(await aracDonusu([e2])), ONAY_SATIRI);
  assert.equal(ONAY_SATIRI, 'Kullanıcı onayladı; istek gönderildi.');
  assert.equal(kartSatiri(null), null);
  assert.equal(kartSatiri('red'), null);
});

test('K7: aracın kendi sonucu korunur; satır altına, onaydan sonra yeniden okunan sayfa onun altına; sınır aşılırsa önce kendi sonucu kısalır (satır ve güncel sayfa kesilmez)', () => {
  assert.equal(AG_SAKIN_MS, 1500);
  assert.equal(onayliSonuc('SAYFA: önce', ONAY_SATIRI, 'SAYFA: sonra'), `SAYFA: önce\n\n${ONAY_SATIRI}\n\nONAYDAN SONRA SAYFA (yeniden okundu):\nSAYFA: sonra`);
  const uzun = onayliSonuc('x'.repeat(30_000), ONAY_SATIRI, 'y'.repeat(5000), 20_000);
  assert.ok(uzun.length <= 20_000, String(uzun.length));
  assert.ok(uzun.startsWith('xxxx'));
  assert.ok(uzun.includes(`\n\n${ONAY_SATIRI}\n\n`));
  assert.ok(uzun.endsWith('y'.repeat(5000)));
  assert.match(uzun, /kısaltıldı/);
});

test('gezinim kalkanı: ajanın dokunduğu sekmede tur boyunca ve son ajan eyleminden 30 sn sonrasına dek açık; onaysız POST gezinimi iptal (zaman penceresi yok)', () => {
  const { d, ortam } = ortamKur({ tur: false });
  const k = sekmeKur(ortam);
  assert.deepEqual(k.gezinimKarari(postGezinim()), { karar: 'gec' }, 'ajan çalışmıyor: kullanıcı kendisi gönderiyor');
  k.ajanEylemiBasla();
  assert.deepEqual(k.gezinimKarari(postGezinim()), { karar: 'iptal' });
  assert.deepEqual(k.gezinimKarari(postGezinim('subFrame')), { karar: 'iptal' });
  assert.deepEqual(k.gezinimKarari({ method: 'post', resourceType: 'mainFrame' }), { karar: 'iptal' }, 'büyük/küçük harf');
  assert.deepEqual(k.gezinimKarari({ method: 'GET', resourceType: 'mainFrame' }), { karar: 'gec' });
  assert.deepEqual(k.gezinimKarari({ method: 'POST', resourceType: 'xhr' }), { karar: 'gec' }, 'yalnız gezinim (xhr K4\'ün işi)');
  k.ajanEylemiBitti();
  d.simdi += 4000;
  assert.deepEqual(k.gezinimKarari(postGezinim()), { karar: 'iptal' }, '4 sn gecikmeli form.submit()');
  d.simdi += KALKAN_KUYRUK_MS;
  assert.deepEqual(k.gezinimKarari(postGezinim()), { karar: 'gec' }, 'tur yok, kuyruk doldu');
  d.tur = true;
  d.simdi += 120_000;
  assert.deepEqual(k.gezinimKarari(postGezinim()), { karar: 'iptal' }, 'tur sürdükçe (2 dk sonra da) açık');
  const yabanci = new SekmeKalkani(ortam, () => ({ adres: '', baslik: '' }));
  assert.deepEqual(yabanci.gezinimKarari(postGezinim()), { karar: 'gec' }, 'ajanın dokunmadığı sekme kalkan dışı');
});

test('gezinim kalkanı: kullanıcının kendi girdisi 3 sn pencere açar; ajanın girdisi (yankısı dahil) ve ajan eylemi açmaz', () => {
  const { d, ortam } = ortamKur();
  const k = sekmeKur(ortam);
  k.girdi();
  assert.deepEqual(k.gezinimKarari(postGezinim()), { karar: 'gec' });
  d.simdi += KULLANICI_PENCERESI_MS + 1;
  assert.deepEqual(k.gezinimKarari(postGezinim()), { karar: 'iptal' });
  k.ajanEylemiBasla(); k.ajanEylemiBitti(); // ajanın sendInputEvent yankısı eylemden hemen sonra gelir
  d.simdi += 100;
  k.girdi();
  assert.deepEqual(k.gezinimKarari(postGezinim()), { karar: 'iptal' }, 'yankı kullanıcı sayılmaz');
  d.simdi += 5000;
  k.girdi();
  k.ajanEylemiBasla();
  assert.deepEqual(k.gezinimKarari(postGezinim()), { karar: 'iptal' }, 'ajan eylemi kullanıcı penceresini kapatır');
  k.girdi();
  assert.deepEqual(k.gezinimKarari(postGezinim()), { karar: 'iptal' }, 'eylem sürerken girdi sayılmaz');
  k.ajanEylemiBitti();
});

test('gezinim kalkanı: engel sonraki araç sonucunda bir kez bildirilir; o sekmede sonraki eylem onaya zorlanır (sekme başına)', () => {
  const { ortam } = ortamKur();
  const A = sekmeKur(ortam);
  const B = sekmeKur(ortam);
  assert.equal(A.engellenenAl().sayi, 0);
  assert.deepEqual(A.gezinimKarari(postGezinim()), { karar: 'iptal' });
  assert.equal(A.engellenenAl().sayi, 1);
  assert.equal(A.engellenenAl().sayi, 0, 'bir kez okunur');
  assert.equal(A.zorlaMi(), true);
  assert.equal(B.zorlaMi(), false, 'başka sekme zorlanmaz');
  A.zorlaTuket();
  assert.equal(A.zorlaMi(), false);
  assert.match(FORM_ONAY_BEKLIYOR, /^Form gönderimi onay bekliyor/);
});

test('notlar: tek satır, kesin dil; isteğin sekmesinin adresi (sorgu dizgesi yok) ve başlığı eklenir; eski tekil durum makinesi kalktı', () => {
  assert.match(ONAYSIZ_FORM_NOTU, /^Sayfa, onay almadan bir form göndermeye çalıştı; durdurdum\.$/);
  assert.match(KILIT_NOTU, /durdurdum\.$/);
  const n = sekmeNotu(ONAYSIZ_FORM_NOTU, { adres: 'https://a.test/sepet/odeme?jeton=GIZLI', baslik: 'Sepet\nÖdeme' });
  assert.equal(n, 'Sayfa, onay almadan bir form göndermeye çalıştı; durdurdum. (a.test/sepet/odeme · “Sepet Ödeme”)');
  assert.doesNotMatch(n, /\n|GIZLI/);
  assert.equal(sekmeNotu(KILIT_NOTU, { adres: '', baslik: '' }), KILIT_NOTU);
  const g = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'shared', 'form-gonderimi.ts'), 'utf8');
  assert.doesNotMatch(g, /formGovdeMi|formGovde\b|GonderimKalkani|aracSayisi|aracBasla|POST_IZIN_MS|ISTEK_PENCERESI_MS/, 'eski tekil durum makinesi ve araç sayısı pencereleri kalktı');
});

test('istek kartı: yüksek tehlike, "bu görev" yok; yöntem ve yol önizlemede, sorgu dizgesi (sır olabilir) yok; açıklamada isteğin sekmesi (adres ve başlık)', () => {
  const i = istekOnayIstegi('post', 'https://ornek.test/api/siparis?token=GIZLI', { adres: 'https://ornek.test/sepet?oturum=GIZLI2', baslik: 'Sepetim' });
  assert.equal(i.tehlike, 'yuksek');
  assert.equal('gorevBoyu' in i, false);
  assert.match(i.onizleme ?? '', /^POST ornek\.test\/api\/siparis$/);
  assert.doesNotMatch(JSON.stringify(i), /GIZLI/);
  assert.match(i.aciklama, /ornek\.test\/sepet/);
  assert.match(i.aciklama, /“Sepetim”/);
});

test('indirme onayı: her indirme sorulur, "bu görev" yok; adres ve ana makine görünür', () => {
  const i = indirmeOnayIstegi('https://dosyalar.ornek.test/rapor/2026.pdf?x=1');
  assert.equal('gorevBoyu' in i, false);
  assert.equal(i.tehlike, 'orta');
  assert.match(i.aciklama, /dosyalar\.ornek\.test/);
  assert.match(i.aciklama, /İndirilenler/);
  assert.match(i.onizleme ?? '', /rapor\/2026\.pdf/);
});

// ── Düzeltme turu 5 (yeniden inceleme 4): açık kart sekmenin bütün K4 isteklerini tutar (denetleyici kararı 2) ve Minor'lar ──────────────────

test('tur 5 (a): kart açıkken submit\'ten 11 sn sonra gelen istek bekler ve kartın kararını alır (pencereden ve son eylemden bağımsız)', async () => {
  const { d, ortam } = ortamKur();
  const k = sekmeKur(ortam);
  const y = ertelenen<string>();
  const kartlar: GonderimOnayi[] = [];
  const e = k.etkilesimBasla({ onayli: false, sahip: { ad: 'x' }, sor: (kart) => { kartlar.push(kart); return y.soz; } });
  k.submitGoruldu(AJAX);
  const r1 = k.istekKarari(xhr());
  if (r1.karar !== 'bekle') return assert.fail(r1.karar);
  d.simdi += 11_000; // sayfa bekletilen isteği kendi zaman aşımıyla keser ve kullanıcı yanıtlamadan aynı POST'u yeniden yollar
  const r2 = k.istekKarari(xhr());
  if (r2.karar !== 'bekle') return assert.fail(`11 sn sonra: ${r2.karar}`);
  assert.equal(r2.soz, r1.soz, 'aynı kart');
  assert.equal(kartlar.length, 1, 'ikinci kart açılmaz');
  y.coz('bir_kez');
  assert.equal(await r1.soz, true);
  assert.equal(await r2.soz, true, 'onay: hepsi bırakılır');
  assert.equal(e.kartSonucu, 'onay');
  assert.deepEqual(k.istekKarari(xhr()), { karar: 'gec' }, 'kart yanıtlandı: açık kart yok, eylem onaylı');
  // Onay anında P14 kapalıysa (yeniden sorulur) hiçbiri bırakılmaz.
  const { d: d2, ortam: o2 } = ortamKur();
  const k2 = sekmeKur(o2);
  const y2 = ertelenen<string>();
  k2.etkilesimBasla({ onayli: false, sahip: { ad: 'x' }, sor: () => y2.soz });
  k2.submitGoruldu(AJAX);
  const s1 = k2.istekKarari(xhr());
  d2.simdi += 11_000;
  const s2 = k2.istekKarari(xhr());
  if (s1.karar !== 'bekle' || s2.karar !== 'bekle') return assert.fail(`${s1.karar} ${s2.karar}`);
  d2.bulutKapali = true;
  y2.coz('bir_kez');
  assert.deepEqual(await Promise.all([s1.soz, s2.soz]), [false, false]);
});

test('tur 5 (b): kart açıkken aynı sekmede yeni etkileşimli eylem başlasa da (tuş dizisinin sonraki adımı, başka sohbet) istek aynı karta bağlanır', async () => {
  const { d, ortam } = ortamKur();
  const k = sekmeKur(ortam);
  const y = ertelenen<string>();
  const e1 = k.etkilesimBasla({ onayli: false, sahip: { ad: 'tus' }, sor: () => y.soz });
  k.submitGoruldu(AJAX);
  const r1 = k.istekKarari(xhr());
  if (r1.karar !== 'bekle') return assert.fail(r1.karar);
  const e2 = k.etkilesimBasla({ onayli: false, sahip: { ad: 'tus' }, sor: sorucu().sor }); // yeni eylem, submit yok
  const r2 = k.istekKarari(xhr());
  assert.ok(r2.karar === 'bekle' && r2.soz === r1.soz, `yeni eylemden sonra gelen istek bekler: ${r2.karar}`);
  k.etkilesimBasla({ onayli: true, onayAni: d.simdi, sahip: { ad: 'onayli' }, sor: sorucu().sor }); // eylem düzeyinde onaylı yeni eylem de kartı aşamaz
  const r3 = k.istekKarari(xhr());
  assert.ok(r3.karar === 'bekle' && r3.soz === r1.soz, r3.karar);
  assert.equal(e2.kartSoz, null, 'yeni kart açılmadı');
  y.coz('bir_kez');
  assert.equal(await r2.soz, true);
  assert.equal(await r3.soz, true);
  assert.equal(e1.onayli, true);
});

test('tur 5 (c): ret sonrası ikisi de (11 sn sonraki ve yeni eylemden sonraki) iptal edilir; K6 kilidi konur, bekletilen istekler sayılır', async () => {
  const { d, ortam } = ortamKur();
  const k = sekmeKur(ortam, 'https://a.test/posta', 'Posta');
  const y = ertelenen<string>();
  k.etkilesimBasla({ onayli: false, sahip: { ad: 'x' }, sor: () => y.soz });
  k.submitGoruldu(AJAX);
  const r1 = k.istekKarari(xhr());
  d.simdi += 11_000;
  const r2 = k.istekKarari(xhr());
  k.etkilesimBasla({ onayli: false, sahip: { ad: 'yeni' }, sor: sorucu().sor });
  const r3 = k.istekKarari(xhr('PUT'));
  if (r1.karar !== 'bekle' || r2.karar !== 'bekle' || r3.karar !== 'bekle') return assert.fail(`${r1.karar} ${r2.karar} ${r3.karar}`);
  y.coz('reddet');
  assert.deepEqual(await Promise.all([r1.soz, r2.soz, r3.soz]), [false, false, false], 'ret: hepsi iptal');
  assert.deepEqual(k.kilit, { bitis: d.simdi + KILIT_MS, neden: 'red' });
  assert.equal(k.engellenenAl().sayi, 3, 'bekletilen üç istek de ajana sayıyla söylenir');
  const y1 = k.istekKarari(xhr());
  if (y1.karar !== 'iptal') return assert.fail(y1.karar);
  assert.ok(y1.not?.startsWith(KILIT_NOTU), y1.not);
});

test('tur 5 Minor 1: P14 kilidinden sonraki iptalin notu ayrı ("Onayladın ama …"); "Reddettiğin" notu yalnız rette', async () => {
  const { d, ortam } = ortamKur();
  const k = sekmeKur(ortam, 'https://a.test/x', 'X');
  kurulu(k); // kart onaylanacak
  d.bulutKapali = true;
  const r = k.istekKarari(xhr());
  if (r.karar !== 'bekle') return assert.fail(r.karar);
  assert.equal(await r.soz, false);
  assert.deepEqual(k.kilit, { bitis: d.simdi + KILIT_MS, neden: 'p14' });
  const y = k.istekKarari(xhr());
  if (y.karar !== 'iptal') return assert.fail(y.karar);
  assert.equal(y.not, sekmeNotu(P14_KILIT_NOTU, { adres: 'https://a.test/x', baslik: 'X' }));
  assert.doesNotMatch(y.not ?? '', /Reddettiğin/);
  assert.equal(P14_KILIT_NOTU, 'Onayladın ama Gizli mod ya da “Yalnız bu bilgisayar” açık olduğu için bu sekmeden gönderim durduruldu.');
  assert.equal(k.engellenenAl().sayi, 1, 'P14\'ün bırakmadığı istek K7 satırıyla söylenir; kilidin iptali sayılır');
});

test('tur 5 Minor 4: kart açıkken sekme kapanır ve kullanıcı onaylarsa istek gönderilmez; satır "sekme kapandığı için"', async () => {
  const { ortam } = ortamKur();
  const k = sekmeKur(ortam);
  const y = ertelenen<string>();
  const e = k.etkilesimBasla({ onayli: false, sahip: { ad: 'x' }, sor: () => y.soz });
  k.submitGoruldu(AJAX);
  const r = k.istekKarari(xhr());
  if (r.karar !== 'bekle') return assert.fail(r.karar);
  k.kapandi();
  y.coz('bir_kez');
  assert.equal(await r.soz, false);
  const s = await aracDonusu([e]);
  assert.equal(s, 'kapali');
  assert.equal(kartSatiri(s), ONAY_KAPALI_SATIRI);
  assert.equal(ONAY_KAPALI_SATIRI, 'Kullanıcı onayladı ama sekme kapandığı için istek gönderilmedi.');
  assert.equal(onayliSonuc('KENDİ', ONAY_KAPALI_SATIRI), `KENDİ\n\n${ONAY_KAPALI_SATIRI}`);
  assert.equal(e.onayli, false);
  assert.equal(k.izin, null);
});

test('tur 5 Minor 3/5 ve kapsam dışı 7: engel notu bütün sekmelerin sayılarını birleştirir ("N istek durduruldu", arka plan sekmesi numarasıyla); kilit sürerken başka kökene geçildiyse "Sayfa değişti"', async () => {
  const n = engelNotu([{ no: 1, etkin: true, sayi: 2, sayfaDegisti: false }, { no: 3, etkin: false, sayi: 1, sayfaDegisti: false }]);
  assert.match(n, /^Form gönderimi onay bekliyor/);
  assert.match(n, /3 istek durduruldu \(\[3\] numaralı sekmede 1\)/);
  assert.match(n, /aynı adımı yeniden dene/);
  assert.doesNotMatch(n, /hiçbir şey gönderilmedi/);
  const tek = engelNotu([{ no: 1, etkin: true, sayi: 1, sayfaDegisti: false }]);
  assert.match(tek, /1 istek durduruldu\./);
  assert.doesNotMatch(tek, /numaralı sekmede/);
  const arka = engelNotu([{ no: 4, etkin: false, sayi: 1, sayfaDegisti: false }]);
  assert.match(arka, /1 istek durduruldu \(\[4\] numaralı sekmede 1\)/, 'yalnız arka plan sekmesindeki iptal de söylenir');
  const degisti = engelNotu([{ no: 2, etkin: true, sayi: 1, sayfaDegisti: true }]);
  assert.match(degisti, /Sayfa değişti; gerekiyorsa yeniden başla\./);
  assert.doesNotMatch(degisti, /aynı adımı yeniden dene/);
  // Kalkan: kilit sürerken başka KÖKENE geçen sekmenin iptali "sayfa değişti" işaretler; aynı kökende işaretlemez.
  const { ortam } = ortamKur();
  let adres = 'https://a.test/form';
  const k = new SekmeKalkani<{ ad: string }>(ortam, () => ({ adres, baslik: 'A' }));
  k.ajan = true;
  kurulu(k, sorucu('reddet'));
  const r = k.istekKarari(xhr());
  if (r.karar === 'bekle') await r.soz;
  k.engellenenAl();
  adres = 'https://a.test/baska';
  k.istekKarari(xhr());
  assert.deepEqual(k.engellenenAl(), { sayi: 1, sayfaDegisti: false });
  adres = 'https://b.test/'; // ajanın tarayici_ac'ı kilidi kaldırmaz
  k.istekKarari(xhr());
  assert.deepEqual(k.engellenenAl(), { sayi: 1, sayfaDegisti: true });
});
