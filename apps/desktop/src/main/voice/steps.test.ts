import { describe, expect, it } from 'vitest';
import { t } from '@fuber/shared';
import { failureReason, stepLabel } from './steps';
import { isCancelCommand, isRetryCommand } from './text-match';

describe('adım satırı (ada ve sesli ilerleme)', () => {
  it('aracın adından ve zararsız girdisinden kısa Türkçe cümle kurar', () => {
    expect(stepLabel('app_open', { name: 'WhatsApp' })).toBe('“WhatsApp” açılıyor');
    expect(stepLabel('pc_focus_window', { window: 'WhatsApp' })).toBe('“WhatsApp” penceresine geçiyorum');
    expect(stepLabel('pc_click', { name: 'Ara' })).toBe('“Ara” öğesine tıklıyorum');
    expect(stepLabel('pc_click', { x: 10, y: 20 })).toBe(t('turn.step.pc_click.plain'));
    expect(stepLabel('pc_find', { name: 'Ahmet' })).toBe('“Ahmet” arıyorum');
    expect(stepLabel('browser_search', { query: 'hava durumu' })).toBe('“hava durumu” için arama yapıyorum');
    expect(stepLabel('screen_look', {})).toBe('Ekrana bakıyorum');
    expect(stepLabel('jbrowser_click', { no: 3 })).toBe(t('turn.step.jbrowser'));
    expect(stepLabel('file_copy', { from: 'a', to: 'b' })).toBe(t('turn.step.file'));
    expect(stepLabel('bilinmeyen_arac', null)).toBe(t('turn.step.generic'));
  });

  it('yazılan metin, adres ve dosya içeriği satıra girmez; uzun hedef kısaltılır', () => {
    expect(stepLabel('pc_type', { text: 'parolam 1234' })).toBe('Yazıyorum');
    expect(stepLabel('web_read', { url: 'https://example.com/gizli?token=abc' })).toBe('Sayfayı okuyorum');
    expect(stepLabel('clipboard_write', { text: 'gizli' })).toBe('Yazıyorum');
    const long = stepLabel('app_open', { name: 'x'.repeat(200) });
    expect(long.length).toBeLessThan(70);
    expect(long).toContain('…');
  });

  it('başarısız adımın nedeni: aracın modele yazdığı metnin ilk cümlesi, öneksiz', () => {
    expect(failureReason('Araç hata verdi: “WhatsApp” penceresinde arama kutusunu bulamadım. Pencereyi öne alıp yeniden dene.')).toBe(
      '“WhatsApp” penceresinde arama kutusunu bulamadım.',
    );
    expect(failureReason('HATA: Öğe bulunamadı.')).toBe('Öğe bulunamadı.');
    expect(failureReason('[WEB İÇERİĞİ BAŞI] Sayfa açılamadı: zaman aşımı. [WEB İÇERİĞİ SONU]')).toBe('Sayfa açılamadı: zaman aşımı.');
    expect(failureReason('')).toBe('');
    expect(failureReason('x'.repeat(400)).length).toBeLessThanOrEqual(180);
  });
});

describe('iş sürerken söylenen kısa sözler', () => {
  it.each(['iptal', 'İptal et.', 'vazgeç', 'Vazgeçtim', 'boş ver', 'Jarvis iptal', 'tamam vazgeç', 'gerek kalmadı', 'durdur'])('iptal: "%s"', (text) => {
    expect(isCancelCommand(text, new Set(['carvis']))).toBe(true);
  });

  it.each(['vazgeç, onun yerine Ali’ye yaz', 'iptal edilen siparişi göster', 'toplantıyı iptal et lütfen bugün', 'bırakma devam et', 'evet'])('iptal değil: "%s"', (text) => {
    expect(isCancelCommand(text)).toBe(false);
  });

  it('yeniden dene', () => {
    for (const text of ['yeniden dene', 'Tekrar dene.', 'bir daha dene', 'tekrar yap', 'hadi yeniden dene']) expect(isRetryCommand(text), text).toBe(true);
    for (const text of ['yeniden başlat bilgisayarı', 'tekrar söyler misin', 'dene']) expect(isRetryCommand(text), text).toBe(false);
  });
});
