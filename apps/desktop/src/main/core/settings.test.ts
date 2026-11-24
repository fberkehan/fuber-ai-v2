import { describe, expect, it, vi } from 'vitest';
import type { ServiceDeps } from '@fuber/shared';

vi.mock('electron', () => ({ app: { getPath: () => 'C:\\Users\\test\\Desktop' } }));

const { createSettings } = await import('./settings');

function deps(saved: Record<string, unknown> | null): ServiceDeps['settings'] {
  const store = new Map<string, unknown>(saved ? [['value', saved]] : []);
  return {
    store: { kv: () => ({ get: (key: string) => store.get(key), set: (key: string, value: unknown) => void store.set(key, value) }) },
    bus: { emit: () => {} },
  } as unknown as ServiceDeps['settings'];
}

describe('kaldırılan görünüm ayarı', () => {
  it('eski kayıttaki "Çentik" seçimi sorunsuz atılır; öteki alanlar korunur ve kayıt temizlenir', () => {
    const store = deps({ launchAtLogin: false, userName: 'Deniz', appearance: 'centik' });
    const settings = createSettings(store);
    expect('appearance' in settings.get()).toBe(false);
    expect(settings.get().userName).toBe('Deniz');
    const saved = (store.store.kv('settings') as unknown as { get(key: string): Record<string, unknown> }).get('value');
    expect('appearance' in saved).toBe(false);
  });

  it('alan hiç yokken kayda dokunulmaz', () => {
    const settings = createSettings(deps({ userName: 'Deniz' }));
    expect(settings.get().userName).toBe('Deniz');
    expect('appearance' in settings.get()).toBe(false);
  });
});
