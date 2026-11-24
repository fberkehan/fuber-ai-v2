import { describe, expect, it } from 'vitest';
import { hasMessage, registerMessages, t } from './index';
import { tr } from './tr/index.gen';

describe('sözlük', () => {
  it('alan dosyaları tek sözlükte birleşir', () => {
    expect(t('nav.today')).toBe('Bugün');
    expect(t('common.cancel')).toBe('Vazgeç');
    expect(t('voice.state.listening')).toBe('Dinliyorum');
    expect(t('tool.error.denied')).toContain('onay');
    expect(t('presence.meeting')).toBe('Toplantıda');
    expect(Object.keys(tr).length).toBeGreaterThan(130);
  });

  it('yer tutucuları doldurur, eksik anahtarı olduğu gibi döndürür', () => {
    expect(t('voice.mic.muted', { hotkey: 'Ctrl+Alt+M' })).toBe('Mikrofonu kapattım; Ctrl+Alt+M ile açarsınız.');
    expect(t('yok.boyle.anahtar')).toBe('yok.boyle.anahtar');
    expect(hasMessage('yok.boyle.anahtar')).toBe(false);
  });

  it('çalışma anında anahtar eklenir ama sözlükteki anahtar ezilemez', () => {
    registerMessages('tr', { 'skill.doviz.name': 'Döviz kuru' });
    expect(t('skill.doviz.name')).toBe('Döviz kuru');
    expect(() => registerMessages('tr', { 'nav.today': 'Başka' })).toThrow();
  });

  it('Demo 1 modüllerinin adı tanımlı', () => {
    for (const id of ['voice-control', 'memory', 'planner', 'stage', 'projects', 'web', 'pc', 'workshop', 'ambient', 'import-v1', 'meeting', 'mail']) {
      expect(hasMessage(`module.${id}.name`), id).toBe(true);
    }
  });
});
