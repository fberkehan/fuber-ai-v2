// Claude Code turunun saf yardımcıları: kodla yanıtlanan kısa sözler, ses aracının hazır cümlesi, sürecin sistem istemi.
import { DEFAULT_POLICY } from '@fuber/shared';
import { describe, expect, it } from 'vitest';
import { CLAUDE_CODE_NOTE, CLAUDE_CODE_VOICE_NOTE, claudeCodeSystem, quickAnswer, spokenFromToolResult } from './turn';

const NOW = new Date(2026, 10, 16, 9, 5, 0);

describe('quickAnswer: modele gitmeden yanıtlanan sözler', () => {
  it('saat sorusu kodla yanıtlanır', () => {
    for (const said of ['Saat kaç?', 'saat kaç oldu', 'Şu an saat kaç?', 'Peki saat kaç acaba']) expect(quickAnswer(said, NOW)).toBe('Saat 09:05.');
  });

  it('tarih sorusu kodla yanıtlanır', () => {
    for (const said of ['Bugün günlerden ne?', 'Bugün ayın kaçı?', 'Bugünün tarihi nedir', 'Tarih ne?']) {
      const answer = quickAnswer(said, NOW);
      expect(answer).toContain('16 Kasım');
      expect(answer).toContain('2026');
    }
  });

  it('emin olunmayan söz modele kalır', () => {
    for (const said of ['Saat kaçta toplantım var?', 'Londra’da saat kaç?', 'Yarın günlerden ne?', 'Saat onda beni ara', 'Bugün ne yapacağız?', 'Merhaba', '']) {
      expect(quickAnswer(said, NOW)).toBeNull();
    }
  });
});

describe('spokenFromToolResult', () => {
  it('aracın hazır cümlesini alır; yoksa ilk cümleyi', () => {
    expect(spokenFromToolResult('Mikrofon kapatıldı. Kullanıcıya yalnız şunu söyle: "Mikrofonu kapattım; Ctrl+Alt+K ile açarsınız."')).toBe('Mikrofonu kapattım; Ctrl+Alt+K ile açarsınız.');
    expect(spokenFromToolResult('Mikrofon kapatılamadı. Ayrıntı günlükte.')).toBe('Mikrofon kapatılamadı.');
    expect(spokenFromToolResult('tamam')).toBe('tamam');
  });
});

describe('claudeCodeSystem', () => {
  const persona = { persona: DEFAULT_POLICY.persona, userName: 'Gökay', userAddress: null };

  it('bulut yolunun zengin istemi + çalışma biçimi eki; üsluba göre değişir, aynı girdide bayt bayt aynıdır', () => {
    const voice = claudeCodeSystem(persona, 'voice');
    expect(voice).toContain('Sen Jarvis');
    expect(voice).toContain('## Çalışma kuralları');
    expect(voice).toContain('## Bu tur sesli');
    expect(voice).toContain('Kullanıcının adı: Gökay.');
    // Sesli turda ek: ilk cümle kısa (ilk ses o kadar erken gelir).
    expect(voice.endsWith(`${CLAUDE_CODE_NOTE}\n${CLAUDE_CODE_VOICE_NOTE}`)).toBe(true);
    expect(voice).toContain('mcp__fuber__memory_search');
    expect(claudeCodeSystem(persona, 'voice')).toBe(voice);
    const chat = claudeCodeSystem(persona, 'chat');
    expect(chat).toContain('## Bu sohbet yazılı');
    expect(chat).not.toContain('## Bu tur sesli');
    expect(chat.endsWith(CLAUDE_CODE_NOTE)).toBe(true);
  });

  it('kişiliksiz çağrıda yalnız çağıranın yönergesi (boşsa kısa varsayılan)', () => {
    expect(claudeCodeSystem(persona, 'plain', 'Yalnız JSON döndür.')).toBe('Yalnız JSON döndür.');
    expect(claudeCodeSystem(persona, 'plain')).toContain('yardımcı bir asistansın');
  });
});
