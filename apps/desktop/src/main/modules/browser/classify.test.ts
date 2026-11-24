// Eylem kapısının saf kuralları. v1 `tests/form-gonderimi.test.ts` (gönderim algılama, sözcükler, yöntem, ödeme çerçevesi,
// parola/kart desenleri) ve `tests/tarayici.test.ts` (tuş ayrıştırma) senaryoları birebir taşındı; v2 eklemeleri ayrıca.
import { describe, expect, it } from 'vitest';
import {
  CARD_FIELD_PATTERN,
  IRREVERSIBLE_WORDS,
  PASSWORD_FIELD_PATTERN,
  formMethod,
  isIrreversible,
  isPaymentFrame,
  isSubmission,
  keyBlocked,
  keyForbidden,
  keySubmits,
  parseKeys,
  sensitiveFieldKind,
  type ElementInfo,
  type KeyStep,
} from './classify';

/** Varsayılan: formsuz, sıradan metin kutusu. */
const el = (o: Partial<ElementInfo> = {}): ElementInfo => ({ label: '', type: 'input:text', inForm: false, formMethod: null, text: '', passwordForm: false, cardForm: false, ...o });
const postForm = (o: Partial<ElementInfo> = {}) => el({ inForm: true, formMethod: 'post', ...o });
const steps = (keys: string): KeyStep[] => {
  const parsed = parseKeys(keys);
  if ('error' in parsed) throw new Error(parsed.error);
  return parsed.steps;
};

describe('gönderim algılama (v1 form-gonderimi)', () => {
  it('submit tipi düğme gönderimdir; karar metne değil tipe bakar', () => {
    expect(isSubmission(postForm({ type: 'button:submit', text: 'Devam' }), 'click')).toBe(true);
    expect(isSubmission(postForm({ type: 'input:submit', text: 'Tamam' }), 'click')).toBe(true);
    expect(isSubmission(postForm({ type: 'input:image' }), 'click')).toBe(true);
    expect(isSubmission(postForm({ type: 'button:submit', text: 'Sadece bak', label: 'önizleme' }), 'click')).toBe(true);
  });

  it('form içinde tipsiz button gönderimdir; type=button ve formsuz değil', () => {
    expect(isSubmission(postForm({ type: 'button', text: 'İleri' }), 'click')).toBe(true);
    expect(isSubmission(postForm({ type: 'button:button', text: 'Alanları temizle' }), 'click')).toBe(false);
    expect(isSubmission(el({ type: 'button', text: 'Menüyü aç' }), 'click')).toBe(false);
  });

  it('Enter: form içinde ve dışında gönderim (açık GET arama formu hariç)', () => {
    expect(isSubmission(postForm({ type: 'input:text', label: 'Ad' }), 'enter')).toBe(true);
    expect(isSubmission(el({ type: 'input:text', label: 'Ara' }), 'enter')).toBe(true);
    expect(isSubmission(postForm({ type: 'textarea:textarea' }), 'enter')).toBe(true);
    expect(isSubmission(el({ type: 'textarea:textarea' }), 'enter')).toBe(true);
    expect(isSubmission(postForm({ type: 'a', text: 'Fiyatlar' }), 'enter')).toBe(false);
    expect(isSubmission(postForm({ type: 'a', text: 'Sil' }), 'enter')).toBe(true);
    expect(isSubmission(postForm({ type: 'button:submit' }), 'enter')).toBe(true);
    expect(isSubmission(el({ type: 'button:button', text: 'Menü' }), 'enter')).toBe(false);
  });

  it('contenteditable ve textarea: Enter gönderim; tek istisna açık GET formu', () => {
    expect(isSubmission(el({ type: 'contenteditable' }), 'enter')).toBe(true);
    expect(isSubmission(el({ type: 'contenteditable' }), 'click')).toBe(false);
    expect(isSubmission(el({ type: 'textarea:textarea', inForm: true, formMethod: 'get' }), 'enter')).toBe(false);
  });

  it('GET formu (arama) gönderim değil; parola/kart ya da geri dönüşsüz sözcük varsa öyle', () => {
    const search = { inForm: true, formMethod: 'get' as const };
    expect(isSubmission(el({ ...search, type: 'input:search', label: 'Ara' }), 'enter')).toBe(false);
    expect(isSubmission(el({ ...search, type: 'button:submit', text: 'Ara' }), 'click')).toBe(false);
    expect(isSubmission(el({ ...search, type: 'button:submit', text: 'Satın al' }), 'click')).toBe(true);
    expect(isSubmission(el({ ...search, type: 'input:text', passwordForm: true }), 'enter')).toBe(true);
    expect(isSubmission(el({ inForm: true, formMethod: null, type: 'button:submit', text: 'Ara' }), 'click')).toBe(true);
  });

  it('bağlantı: adı sözcük taşımıyorsa gönderim değil', () => {
    expect(isSubmission(el({ type: 'a', text: 'Fiyatlar' }), 'click')).toBe(false);
    expect(isSubmission(postForm({ type: 'a', text: 'Şifremi unuttum', passwordForm: true }), 'click')).toBe(false);
    expect(isSubmission(el({ type: 'a', text: 'Sil' }), 'click')).toBe(true);
    expect(isSubmission(el({ type: 'a', text: 'Satın al' }), 'click')).toBe(true);
    expect(isSubmission(el({ type: 'a', text: '', label: 'Delete' }), 'click')).toBe(true);
    expect(isSubmission(el({ type: 'area', label: 'Pay' }), 'click')).toBe(true);
    expect(isSubmission(postForm({ type: 'input:text', label: 'Ad' }), 'click')).toBe(false);
    expect(isSubmission(postForm({ type: 'select:select-one' }), 'click')).toBe(false);
  });

  it('metni geri dönüşsüz düğme form dışında da gönderim (tr, en, de, fr); div değil', () => {
    for (const text of ['Satın al', 'SATIN AL', 'Hemen satın al', 'Öde', 'Ödeme yap', 'Sipariş ver', 'Giriş yap', 'GİRİŞ YAP', 'Kaydol', 'Onayla', 'Sil', 'Gönder',
      'Buy now', 'Pay', 'Place order', 'Sign in', 'Log in', 'Confirm', 'Delete', 'Submit', 'Jetzt kaufen', 'Bezahlen', 'Löschen', 'Bestätigen', 'Acheter', 'Payer', 'Supprimer', 'Se connecter', 'Confirmer']) {
      expect(isSubmission(el({ type: 'button:button', text }), 'click'), text).toBe(true);
      expect(isSubmission(el({ type: 'div', label: text }), 'click'), `${text} (div)`).toBe(false);
    }
    expect(isSubmission(el({ type: 'button:role', text: 'Sil' }), 'click')).toBe(true);
    expect(isSubmission(el({ type: 'button:button', text: '', label: 'Siparişi onayla' }), 'click')).toBe(true);
    for (const text of ['Menü', 'Daha fazla göster', 'Ara', 'Kapat', 'Sepete git', 'Siparişlerim', 'Gönderi', 'Details', 'Next']) {
      expect(isSubmission(el({ type: 'button:button', text }), 'click'), text).toBe(false);
    }
  });

  it('v2: hesap değişikliği ve para gönderme sözcükleri de onaylı', () => {
    for (const text of ['Kaydet', 'Değişiklikleri kaydet', 'Güncelle', 'Şifreyi değiştir', 'Hesabı kapat', 'Aboneliği iptal et', 'Havale yap', 'Para gönder', 'Başvur', 'Save', 'Update', 'Change password', 'Unsubscribe']) {
      expect(isSubmission(el({ type: 'button:button', text }), 'click'), text).toBe(true);
    }
    expect(isIrreversible('Kaydetmeden çık')).toBe(false);
  });

  it('sözcük listesi: dört dil, sözcük sınırıyla, aksansız yazım', () => {
    for (const word of ['gönder', 'satın al', 'öde', 'sipariş', 'giriş yap', 'kaydol', 'onayla', 'sil', 'submit', 'buy', 'pay', 'order', 'sign in', 'log in', 'confirm', 'delete']) {
      expect(IRREVERSIBLE_WORDS).toContain(word);
    }
    expect(IRREVERSIBLE_WORDS.length).toBeGreaterThanOrEqual(40);
    expect(isIrreversible('Silinen öğeler')).toBe(false);
    expect(isIrreversible('Ödev')).toBe(false);
    expect(isIrreversible('Mesajı gönder')).toBe(true);
    expect(isIrreversible('Odeme yap')).toBe(true);
    expect(isIrreversible('GÖNDER')).toBe(true);
    expect(isIrreversible('s’inscrire')).toBe(true);
    expect(isIrreversible('')).toBe(false);
  });

  it('parola ya da kart formunda her düğme gönderim; alanlar ve bağlantılar değil', () => {
    expect(isSubmission(el({ type: 'button:button', text: 'Devam', passwordForm: true }), 'click')).toBe(true);
    expect(isSubmission(el({ type: 'button:button', text: 'Devam', cardForm: true }), 'click')).toBe(true);
    expect(isSubmission(el({ type: 'button:role', text: 'Göster', passwordForm: true }), 'click')).toBe(true);
    expect(isSubmission(el({ type: 'input:text', passwordForm: true }), 'click')).toBe(false);
    expect(isSubmission(el({ type: 'input:password', inForm: true, formMethod: 'get', passwordForm: true }), 'enter')).toBe(true);
    expect(isSubmission(el({ type: 'input:text', inForm: true, formMethod: 'post', cardForm: true }), 'enter')).toBe(true);
    expect(isSubmission(el({ type: 'input:text', passwordForm: true }), 'enter')).toBe(true);
  });

  it('parola ve kart alanı desenleri', () => {
    for (const s of ['password', 'Parola', 'şifre', 'sifre', 'user_passwd', 'pwd', 'OTP', 'doğrulama kodu', 'PIN']) expect(s).toMatch(PASSWORD_FIELD_PATTERN);
    for (const s of ['cvv', 'CVC', 'cardnumber', 'card number', 'kart numarası', 'kredi kartı', 'iban', 'cc-number', 'son kullanma tarihi']) expect(s).toMatch(CARD_FIELD_PATTERN);
    for (const s of ['ad', 'e-posta', 'telefon', 'adres', 'arama', 'footprint', 'spinner', 'hotpot']) {
      expect(s).not.toMatch(PASSWORD_FIELD_PATTERN);
      expect(s).not.toMatch(CARD_FIELD_PATTERN);
    }
    expect(sensitiveFieldKind({ type: 'input:password' })).toBe('password');
    expect(sensitiveFieldKind({ type: 'input:text', autocomplete: 'one-time-code' })).toBe('password');
    expect(sensitiveFieldKind({ type: 'input:text', autocomplete: 'cc-number' })).toBe('card');
    expect(sensitiveFieldKind({ type: 'input:text', name: 'kart_no' })).toBe('card');
    expect(sensitiveFieldKind({ type: 'input:text', name: 'eposta' })).toBeNull();
  });

  it('yöntem eşlemesi: yalnız açık get ya da role=search GET; sayfaya giden kopya aynı sonucu verir', () => {
    const inPage = new Function(`return ${formMethod.toString()}`)() as typeof formMethod;
    for (const find of [formMethod, inPage]) {
      expect(find('get', null, null)).toBe('get');
      expect(find('GET', null, null)).toBe('get');
      expect(find('post', null, null)).toBe('post');
      expect(find(null, 'post', null)).toBe('post');
      expect(find('get', 'post', null)).toBe('post');
      expect(find(null, null, 'search')).toBe('get');
      expect(find(null, null, null)).toBeNull();
      expect(find('', null, 'form')).toBeNull();
      expect(find('dialog', null, null)).toBeNull();
      expect(find('tuhaf', null, null)).toBeNull();
    }
    expect(isSubmission(el({ type: 'button', text: 'Devam', inForm: true, formMethod: formMethod(null, null, null) }), 'click')).toBe(true);
    expect(isSubmission(el({ type: 'input:search', inForm: true, formMethod: formMethod('get', null, null) }), 'enter')).toBe(false);
  });

  it('ödeme çerçevesi: sağlayıcı kökeni ya da adı/başlığı; sayfaya giden kopya aynı', () => {
    const inPage = new Function(`return ${isPaymentFrame.toString()}`)() as typeof isPaymentFrame;
    for (const f of [isPaymentFrame, inPage]) {
      for (const src of ['https://js.stripe.com/v3/elements-inner-card.html', 'https://checkout.adyen.com/x', 'https://assets.braintreegateway.com/hosted', 'https://www.paypal.com/smart/card-fields', 'https://pay.checkout.com/frames', 'https://static.iyzipay.com/f', 'https://www.paytr.com/odeme']) {
        expect(f(src, '', ''), src).toBe(true);
      }
      expect(f('https://ornek.test/f', '', 'Güvenli ödeme alanı')).toBe(true);
      expect(f('https://ornek.test/f', 'card-frame', '')).toBe(true);
      expect(f('https://ornek.test/f', '', 'Kart bilgileri')).toBe(true);
      expect(f('https://ornek.test/reklam', 'banner', 'Reklam')).toBe(false);
      expect(f(null, undefined, null)).toBe(false);
    }
  });

  it('role=button öğeleri: adı sözcük taşıyorsa onaylı', () => {
    for (const text of ['Sil', 'Delete', 'Satın al', 'Buy', 'Öde', 'Pay', 'Gönder', 'Send', 'Onayla', 'Confirm', 'Submit']) {
      expect(isSubmission(el({ type: 'button:role', text }), 'click'), text).toBe(true);
    }
    expect(isSubmission(el({ type: 'button:role', text: 'Menüyü aç' }), 'click')).toBe(false);
  });
});

describe('tuşlar (v1 tusAyristir)', () => {
  it('ayrıştırma: değiştiriciler, adlar, karakter, yapıştırma', () => {
    const [ctrlA] = steps('Ctrl+A');
    expect(ctrlA).toMatchObject({ keyCode: 'A', modifiers: ['control'], printable: false, paste: false });
    const [paste] = steps('Ctrl+V');
    expect(paste!.paste).toBe(true);
    const [shiftInsert] = steps('Shift+Insert');
    expect(shiftInsert!.paste).toBe(true);
    const [a] = steps('a');
    expect(a).toMatchObject({ char: 'a', printable: true });
    const [space] = steps('Space');
    expect(space).toMatchObject({ char: ' ', space: true });
    expect(steps('Tab Tab Enter').map((step) => step.keyCode)).toEqual(['Tab', 'Tab', 'Return']);
    expect(steps('ArrowDown PageDown F5').map((step) => step.keyCode)).toEqual(['Down', 'PageDown', 'F5']);
    expect(parseKeys('')).toHaveProperty('error');
    expect(parseKeys('Ctrl')).toHaveProperty('error');
    expect(parseKeys('Hyper+X')).toHaveProperty('error');
    expect(parseKeys('Bilinmeyen')).toHaveProperty('error');
    expect(parseKeys(Array.from({ length: 11 }, () => 'Tab').join(' '))).toHaveProperty('error');
  });

  it('parola/kart alanında yazı ve yapıştırma tuşu yasak; Enter, Tab, Escape serbest', () => {
    for (const key of ['a', 'Space', 'Ctrl+V', 'Shift+Insert']) expect(keyForbidden(steps(key)[0]!, 'password'), key).toBe(true);
    for (const key of ['Enter', 'Tab', 'Escape', 'ArrowDown']) expect(keyForbidden(steps(key)[0]!, 'password'), key).toBe(false);
    expect(keyForbidden(steps('a')[0]!, null)).toBe(false);
  });

  it('gönderen tuş: Ctrl/Meta+Enter her zaman; Enter odağa göre; Boşluk odaktaki gönder düğmesinde', () => {
    expect(keySubmits(steps('Ctrl+Enter')[0]!, null)).toBe(true);
    expect(keySubmits(steps('Enter')[0]!, null)).toBe(false);
    expect(keySubmits(steps('Enter')[0]!, postForm({ type: 'input:text' }))).toBe(true);
    expect(keySubmits(steps('Enter')[0]!, el({ type: 'input:search', inForm: true, formMethod: 'get' }))).toBe(false);
    expect(keySubmits(steps('Shift+Enter')[0]!, postForm({ type: 'input:text' }))).toBe(true);
    expect(keySubmits(steps('Space')[0]!, postForm({ type: 'button:submit' }))).toBe(true);
    expect(keySubmits(steps('Space')[0]!, el({ type: 'input:text' }))).toBe(false);
    expect(keySubmits(steps('Tab')[0]!, postForm({ type: 'input:text' }))).toBe(false);
  });

  it('v2: tarayıcıyı ya da Windows\'u işleten kısayollar basılmaz', () => {
    for (const key of ['Ctrl+P', 'Ctrl+S', 'Ctrl+L', 'Ctrl+W', 'Ctrl+T', 'Ctrl+Shift+I', 'F12', 'F5', 'Alt+F4', 'Alt+Left', 'Meta+R']) expect(keyBlocked(steps(key)[0]!), key).toBe(true);
    for (const key of ['Ctrl+A', 'Ctrl+C', 'Enter', 'Tab', 'Escape', 'Ctrl+Enter']) expect(keyBlocked(steps(key)[0]!), key).toBe(false);
  });
});
