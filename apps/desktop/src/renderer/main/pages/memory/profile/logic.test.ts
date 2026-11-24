import { describe, expect, it } from 'vitest';
import type { ProfileGroup, ProfileItem } from '../../../../../main/modules/memory/profile/types';
import { canSaveProfileText, confidenceLevel, itemTime, orderProfileGroups, PROFILE_ORDER } from './logic';

const item = (id: string, category: ProfileItem['category'], status: ProfileItem['status'] = 'active'): ProfileItem => ({
  id,
  category,
  key: id,
  text: `metin ${id}`,
  confidence: 1,
  origin: 'said',
  channel: 'ui',
  sessionId: null,
  messageId: null,
  learnedAt: '2026-11-10T10:00:00.000Z',
  updatedAt: '2026-11-10T10:00:00.000Z',
  confirmations: 1,
  locked: false,
  status,
  supersededBy: null,
  previousText: null,
});

const group = (category: ProfileItem['category'], items: ProfileItem[]): ProfileGroup => ({ category, title: category, items });

describe('profil görünümü mantığı', () => {
  it('güveni üç kademeye çevirir', () => {
    expect(confidenceLevel(1)).toBe(3);
    expect(confidenceLevel(0.9)).toBe(3);
    expect(confidenceLevel(0.7)).toBe(2);
    expect(confidenceLevel(0.65)).toBe(2);
    expect(confidenceLevel(0.5)).toBe(1);
    expect(confidenceLevel(0)).toBe(1);
    expect(confidenceLevel(Number.NaN)).toBe(1);
  });

  it('kuralları ayırır, boş grupları atar, kalanları sıraya dizer', () => {
    const ordered = orderProfileGroups([
      group('ongoing', [item('o', 'ongoing')]),
      group('work', [item('w', 'work')]),
      group('style', []),
      group('rule', [item('r', 'rule')]),
      group('identity', [item('i', 'identity')]),
    ]);
    expect(ordered.rules?.category).toBe('rule');
    expect(ordered.others.map((entry) => entry.category)).toEqual(['identity', 'work', 'ongoing']);
  });

  it('yerini başkasına bırakmış kayıtları gruptan çıkarır; yalnız onlardan oluşan grup çizilmez', () => {
    const ordered = orderProfileGroups([group('rule', [item('r', 'rule', 'superseded')]), group('work', [item('a', 'work'), item('b', 'work', 'superseded')])]);
    expect(ordered.rules).toBeNull();
    expect(ordered.others[0]?.items.map((entry) => entry.id)).toEqual(['a']);
  });

  it('sıra sözleşmedeki bütün kategorileri bir kez içerir, kural en üstte', () => {
    expect(PROFILE_ORDER[0]).toBe('rule');
    expect(new Set(PROFILE_ORDER).size).toBe(PROFILE_ORDER.length);
    expect(PROFILE_ORDER).toHaveLength(10);
  });

  it('satırdaki zaman: düzeltildiyse düzeltme anı', () => {
    expect(itemTime({ learnedAt: '2026-11-10T10:00:00.000Z', updatedAt: '2026-11-12T10:00:00.000Z' })).toBe('2026-11-12T10:00:00.000Z');
    expect(itemTime({ learnedAt: '2026-11-10T10:00:00.000Z', updatedAt: '2026-11-10T10:00:00.000Z' })).toBe('2026-11-10T10:00:00.000Z');
  });

  it('boş ya da çok uzun metin kaydedilmez', () => {
    expect(canSaveProfileText('  ')).toBe(false);
    expect(canSaveProfileText('Kısa yanıt ister.')).toBe(true);
    expect(canSaveProfileText('a'.repeat(401))).toBe(false);
  });
});
