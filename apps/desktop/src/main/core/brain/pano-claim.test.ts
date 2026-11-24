import { describe, expect, it } from 'vitest';
import { claimsPanoChange, unfoundedPanoClaim } from './pano-claim';

describe('pano iddiası (araç çağırmadan "taşıdım" denmez)', () => {
  it('pano değişikliği söyleyen cümleler', () => {
    for (const sentence of [
      'Hava durumunu en üste taşıdım.',
      'Dövizi havanın yanına koydum efendim.',
      'Haberler kartını aşağı aldım.',
      'Döviz kartını büyüttüm.',
      'Hava kartını küçülttüm.',
      'Panoya dolar kartını ekledim.',
      'Hava kartını kaldırdım.',
      'Haberleri dövizin yanına yerleştiriyorum.',
    ]) {
      expect(claimsPanoChange(sentence), sentence).toBe(true);
    }
  });

  it('öteki kümelerin cümleleri pano iddiası sayılmaz', () => {
    for (const sentence of [
      'Rapor dosyasını arşiv klasörüne taşıdım.',
      'Hava durumunu aldım: İstanbul 14 derece.',
      'Yarın saat onda hatırlatıcı ekledim.',
      'Panodaki metni okudum.',
      'Dosyayı masaüstüne taşıdım.',
      'Toplantıyı başlattım.',
    ]) {
      expect(claimsPanoChange(sentence), sentence).toBe(false);
    }
  });

  it('yalnız başarılı bir pano aracı iddiayı karşılar', () => {
    const sentence = 'Hava durumunu en üste taşıdım.';
    expect(unfoundedPanoClaim(sentence, [])).toBe(true);
    // Başka bir aracın başarısı (ör. hava bilgisi) pano iddiasını karşılamaz.
    expect(unfoundedPanoClaim(sentence, [{ name: 'weather_get', ok: true }])).toBe(true);
    expect(unfoundedPanoClaim(sentence, [{ name: 'dashboard_card_move', ok: false }])).toBe(true);
    expect(unfoundedPanoClaim(sentence, [{ name: 'dashboard_card_move', ok: true }])).toBe(false);
    // Pano iddiası olmayan cümle bu kapıdan tutulmaz (genel iddia kapısı ayrıdır).
    expect(unfoundedPanoClaim('Dosyayı klasöre taşıdım.', [])).toBe(false);
  });
});
