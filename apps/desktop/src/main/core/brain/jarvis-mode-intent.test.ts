import { describe, expect, it } from 'vitest';
import { routeSpokenCommand } from './local-commands';
import { routeJarvisMode } from './jarvis-mode-intent';

describe('JARVIS MODE sesle açma', () => {
  it.each([
    'Jarvis moduna geç',
    'Jarvis moduna geç.',
    'Jarvis modunu aç',
    'Jarvis modunu aç lütfen',
    'JARVIS modu',
    'Jarvis moduna gir',
    'Jarvis moduna geçer misin',
    'Jarvis modunu açar mısın',
    'Hey Jarvis, Jarvis modunu aç',
    'Jarvis, Jarvis moduna geç',
    'Aç Jarvis modunu',
    'Jarvis mode on',
    'enter Jarvis mode',
    'Enter Jarvis mode, please',
    'open Jarvis mode',
    'activate Jarvis mode',
    'switch to Jarvis mode',
    'turn on Jarvis mode',
  ])('açar: %s', (said) => {
    expect(routeJarvisMode(said)).toBe('on');
  });

  it.each([
    'Jarvis modunu kapat',
    'Jarvis modunu kapat.',
    'Jarvis modundan çık',
    'Jarvis modundan çıkar mısın',
    'Jarvis modunu kapatır mısın',
    'Jarvis modunu bitir',
    'normal moda dön',
    'Normal moda dönelim',
    'normal moda geç',
    'Hey Jarvis, Jarvis modundan çık',
    'Kapat Jarvis modunu',
    'Jarvis mode off',
    'exit Jarvis mode',
    'Exit Jarvis mode please',
    'close Jarvis mode',
    'leave Jarvis mode',
    'turn off Jarvis mode',
    'back to normal mode',
  ])('kapatır: %s', (said) => {
    expect(routeJarvisMode(said)).toBe('off');
  });

  it.each([
    // Asistanın kendi cümleleri (geçmiş / şimdiki zaman): tetiklemez.
    'Jarvis modu açıldı.',
    'Jarvis modunu açtım.',
    'Jarvis modunu kapatıyorum.',
    'Jarvis modu kapatıldı. Kullanıcıya yalnız bunu söyle.',
    'Jarvis modu zaten açık.',
    // Başka sözler
    'Jarvis modu nasıl çalışıyor',
    'Jarvis modunda neler var',
    'Jarvis modunu bir daha göstermesen iyi olur çünkü çok parlak',
    'Jarvis bugün hava nasıl',
    'normal mod nedir',
    'hava durumunu aç',
    'modunu aç',
    '',
  ])('tetiklemez: %s', (said) => {
    expect(routeJarvisMode(said)).toBeNull();
  });

  it('hızlı yerel komut yolu `jarvis_mode` aracını doğru girdiyle seçer', () => {
    expect(routeSpokenCommand('Jarvis moduna geç')).toEqual({ name: 'jarvis_mode', input: { on: true } });
    expect(routeSpokenCommand('Jarvis modunu aç.')).toEqual({ name: 'jarvis_mode', input: { on: true } });
    expect(routeSpokenCommand('Jarvis modunu kapat')).toEqual({ name: 'jarvis_mode', input: { on: false } });
    expect(routeSpokenCommand('Jarvis modundan çık')).toEqual({ name: 'jarvis_mode', input: { on: false } });
    expect(routeSpokenCommand('normal moda dön')).toEqual({ name: 'jarvis_mode', input: { on: false } });
    expect(routeSpokenCommand('exit Jarvis mode')).toEqual({ name: 'jarvis_mode', input: { on: false } });
    expect(routeSpokenCommand('Jarvis modunu açtım')).toBeNull();
  });

  it('JARVIS MODE bir sayfa değildir: sesle gezinme listesinde yoktur', () => {
    expect(routeSpokenCommand('Jarvis ekranını göster')?.name).not.toBe('app_navigate');
  });
});
