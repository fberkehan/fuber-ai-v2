import { describe, expect, it, vi } from 'vitest';
import type { Logger, Project } from '@fuber/shared';
import { createBus } from '../core/bus';
import { BASE_VOCABULARY, bindSttVocabulary, collectVocabulary } from './vocabulary';

const log: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => log };
const project = (name: string, patch: Partial<Project> = {}) =>
  ({ id: name, name, pinned: false, modifiedAt: '2026-01-01T00:00:00.000Z', lastSessionAt: null, ...patch }) as Project;

describe('yazıya çevirme sözcük listesi', () => {
  it('temel sözcükler ve projeler sırayla; yinelenen ad bir kez', () => {
    const words = collectVocabulary([project('atlas'), project('blog-sitesi')]);
    expect(words.slice(0, BASE_VOCABULARY.length)).toEqual([...BASE_VOCABULARY]);
    expect(words).toContain('blog-sitesi');
    expect(words.filter((word) => word.toLocaleLowerCase('tr') === 'atlas')).toEqual(['atlas']);
  });

  it('proje çoksa sabitlenen ve son çalışılan önce gelir, liste sınırlı kalır', () => {
    const many = Array.from({ length: 60 }, (_, index) => project(`proje-${index}`, { modifiedAt: `2026-01-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z` }));
    many.push(project('sabit', { pinned: true, modifiedAt: '2020-01-01T00:00:00.000Z' }));
    many.push(project('dun-calisilan', { lastSessionAt: '2026-11-15T10:00:00.000Z' }));
    const words = collectVocabulary(many);
    expect(words.length).toBeLessThanOrEqual(40);
    expect(words).toContain('sabit');
    expect(words).toContain('dun-calisilan');
  });

  it('proje verisi değişince listeyi yeniden toplar ve yalnız değiştiyse uygular', async () => {
    vi.useFakeTimers();
    try {
      const bus = createBus({ log });
      let projects = [project('atlas')];
      const applied: string[][] = [];
      const unbind = bindSttVocabulary({
        bus,
        log,
        sources: { projects: async () => projects },
        apply: (words) => applied.push(words),
      });
      await vi.advanceTimersByTimeAsync(500);
      expect(applied).toHaveLength(1);
      expect(applied[0]).toContain('atlas');

      projects = [project('atlas'), project('blog-sitesi')];
      bus.emit('projects.changed', { entity: 'project', op: 'created', ids: ['blog-sitesi'] });
      bus.emit('projects.changed', { entity: 'project', op: 'updated', ids: ['blog-sitesi'] });
      await vi.advanceTimersByTimeAsync(500);
      expect(applied).toHaveLength(2);
      expect(applied[1]).toContain('blog-sitesi');

      // Oturum değişimi ad listesini etkilemez; aynı liste yeniden uygulanmaz.
      bus.emit('projects.changed', { entity: 'session', op: 'created', ids: ['x'] });
      bus.emit('module.changed', { id: 'projects', enabled: true, reason: 'policy' });
      await vi.advanceTimersByTimeAsync(500);
      expect(applied).toHaveLength(2);

      unbind();
      bus.emit('projects.changed', { entity: 'project', op: 'deleted', ids: ['atlas'] });
      await vi.advanceTimersByTimeAsync(500);
      expect(applied).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
