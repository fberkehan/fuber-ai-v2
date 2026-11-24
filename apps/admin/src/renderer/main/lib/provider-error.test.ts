import { describe, expect, it } from 'vitest';
import { classifyProviderError } from './provider-error';

describe('sağlayıcı hatası sınıflandırma', () => {
  it('anahtar geçersiz (401)', () => {
    expect(classifyProviderError('Anahtar reddedildi (401): {"detail":{"status":"invalid_api_key","message":"Invalid API key"}}')).toBe('invalid');
    expect(classifyProviderError('ElevenLabs (401): {"detail":{"status":"invalid_api_key"}}')).toBe('invalid');
  });

  it('ücretli plan (402)', () => {
    expect(
      classifyProviderError('ElevenLabs (402): {"detail":{"status":"payment_required","message":"Free users cannot use library voices via the API."}}'),
    ).toBe('plan');
    expect(classifyProviderError('Anahtar geçerli (plan: free) ama seçili ses x için plan yetersiz (402): {...}', 402)).toBe('plan');
  });

  it('kota doldu: 401 + quota_exceeded da kota sayılır; 429 kota', () => {
    expect(classifyProviderError('ElevenLabs (401): {"detail":{"status":"quota_exceeded","message":"This request exceeds your quota of 10000."}}')).toBe('quota');
    expect(classifyProviderError('Kota doldu (401): {...}', 401)).toBe('quota');
    expect(classifyProviderError('ElevenLabs (429): {"detail":{"status":"too_many_concurrent_requests"}}')).toBe('quota');
  });

  it('Anthropic kredisiz hesap', () => {
    expect(classifyProviderError('Anahtar geçerli ama hesapta kredi yok. (400): {"error":{"message":"Your credit balance is too low"}}', 400)).toBe('credit');
  });

  it('ağ yok', () => {
    expect(classifyProviderError('Sağlayıcıya ulaşılamadı: ENOTFOUND (getaddrinfo ENOTFOUND api.elevenlabs.io).')).toBe('network');
    expect(classifyProviderError('ElevenLabs: Sağlayıcıya ulaşılamadı: 10 sn içinde yanıt gelmedi.')).toBe('network');
  });

  it('anahtar yok', () => {
    expect(classifyProviderError('Kasada ElevenLabs anahtarı yok.')).toBe('missing');
  });

  it('bilinmeyen', () => {
    expect(classifyProviderError('ElevenLabs (422): {"detail":[{"msg":"field required"}]}')).toBe('unknown');
    expect(classifyProviderError('')).toBe('unknown');
  });
});
