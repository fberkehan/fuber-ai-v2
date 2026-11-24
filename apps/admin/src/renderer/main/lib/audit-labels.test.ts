import { describe, expect, it } from 'vitest';
import { auditSummaryText, policyFieldLabel } from './audit-labels';

describe('denetim kaydı okunur alan adları', () => {
  it('bilinen yollar Türkçe adını alır, modül yolları modül adını', () => {
    expect(policyFieldLabel('models.voice.model')).toBe('Sesli yanıt modeli');
    expect(policyFieldLabel('brain.claudeCode.use')).toBe('Claude Code kullanımı');
    expect(policyFieldLabel('modules.web.enabled')).toMatch(/ modülü$/);
    expect(policyFieldLabel('bilinmeyen.alan')).toBeNull();
    // İsteğe bağlı alanlar ve alt alanlar: en yakın bilinen üst yol (en az iki parça).
    expect(policyFieldLabel('voice.tts.model')).toBe('Seslendirme modeli');
    expect(policyFieldLabel('models.voice.price.input')).toBe('Sesli yanıt fiyatı');
    expect(policyFieldLabel('modules.web.config.engine')).toMatch(/ modülü ayarı$/);
    expect(policyFieldLabel('persona.yeniAlan')).toBeNull();
    expect(policyFieldLabel('models.yeni.alan')).toBeNull();
  });

  it('politika özetindeki alan listesini çevirir; sayı, "ve N alan daha" ve not olduğu gibi kalır', () => {
    const text = auditSummaryText({
      action: 'policy.update',
      summary: 'Politika sürüm 12 yayınlandı: brain.claudeCode.use, models.voice.model, yeni.alan ve 3 alan daha (not: models.voice.model denendi)',
    });
    expect(text).toBe(
      'Politika sürüm 12 yayınlandı: Claude Code kullanımı, Sesli yanıt modeli, yeni.alan ve 3 alan daha (not: models.voice.model denendi)',
    );
    expect(auditSummaryText({ action: 'policy.rollback', summary: 'Geri alma sürüm 4 yayınlandı: değişiklik yok' })).toBe(
      'Geri alma sürüm 4 yayınlandı: değişiklik yok',
    );
    expect(auditSummaryText({ action: 'policy.update', summary: 'Politika sürüm 2 yayınlandı: localModels, schemaVersion' })).toBe(
      'Politika sürüm 2 yayınlandı: Yerel modeller, Politika biçimi',
    );
  });

  it('politika dışı kayıtlara dokunmaz', () => {
    expect(auditSummaryText({ action: 'device.register', summary: 'masa.local kaydoldu (onay bekliyor).' })).toBe('masa.local kaydoldu (onay bekliyor).');
  });
});
