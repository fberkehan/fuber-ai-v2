import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { isEmptyCardData } from '@fuber/shared';
import { meetingCard } from './index';
import type { Meeting } from './types';

vi.mock('electron', () => ({ app: { isPackaged: false, commandLine: { getSwitchValue: () => '' }, getPath: () => os.tmpdir() } }));

const NOW = new Date('2026-11-17T10:00:00Z');
const meeting = (patch: Partial<Meeting>): Meeting => ({
  id: 'm1',
  title: 'Teslim takvimi',
  state: 'ended',
  startedAt: '2026-11-17T09:00:00Z',
  endedAt: '2026-11-17T09:30:00Z',
  target: null,
  theirLanguage: 'auto',
  suggestions: false,
  system: false,
  context: { topic: '', participants: '', glossary: '', notes: '', documents: [] } as unknown as Meeting['context'],
  summary: null,
  summaryProblem: null,
  summaryDetail: null,
  summaryDropped: 0,
  lineCount: 3,
  echoDropped: 0,
  ...patch,
});
const repo = (live: Meeting | null, ended: Meeting[]) => ({ get: (id: string) => (live?.id === id ? live : null), ended: () => ended });

describe('Kokpit toplantı kartı', () => {
  it('hiç toplantı yoksa kart yok', () => {
    expect(meetingCard(repo(null, []), null, NOW)).toBeNull();
  });

  it('süren toplantı: özeti yokken de kart BOŞ sayılmaz ("Toplantı sürüyor")', () => {
    const fill = meetingCard(repo(meeting({ state: 'live', endedAt: null }), []), 'm1', NOW)!;
    expect(fill.title).toBe('Toplantı sürüyor');
    expect(fill.data.state).toBe('live');
    expect(isEmptyCardData(fill.data)).toBe(false);
  });

  it('son toplantı: özetin ilk maddeleri ve sayılar; yedi günden eskisi gösterilmez', () => {
    const summary = {
      points: [{ text: 'Sözleşme konuşuldu', lineId: 'l1' }],
      decisions: [{ text: 'Teslim bir hafta ertelenecek', lineId: 'l2' }],
      actions: [{ text: 'Sözleşmeyi gönder', lineId: 'l3' }],
      engine: 'local' as const,
      createdAt: '2026-11-17T09:31:00Z',
    };
    const fill = meetingCard(repo(null, [meeting({ summary })]), null, NOW)!;
    expect(fill.data.summary).toEqual({ points: ['Sözleşme konuşuldu', 'Teslim bir hafta ertelenecek'], decisions: 1, actions: 1 });
    expect(isEmptyCardData(fill.data)).toBe(false);
    const old = meeting({ endedAt: '2026-11-01T09:30:00Z', startedAt: '2026-11-01T09:00:00Z' });
    expect(meetingCard(repo(null, [old]), null, NOW)).toBeNull();
  });
});
