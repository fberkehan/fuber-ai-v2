import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AttentionApi, AttentionChannel, Bus, BusEvents, Priority } from '@fuber/shared';
import { createAttention } from './attention';
import { attentionMode, decideChannel, spokenAllowed, type AttentionMode } from './attention-rules';
import { fakePolicy, fakePresence, fakeSettings, silentLog, tempStore, testBus } from './brain/testkit';

describe('dikkat tablosu (KURGU §8), satır satır', () => {
  const table: Array<[AttentionMode, Priority, boolean, AttentionChannel]> = [
    // Tam ekran: görsel yok; urgent kısa ses, diğerleri bekler.
    ['fullscreen', 'urgent', true, 'voice'],
    ['fullscreen', 'high', true, 'deferred'],
    ['fullscreen', 'normal', false, 'deferred'],
    ['fullscreen', 'low', false, 'deferred'],
    // Toplantı: ses yok; sessiz toast; low bekler.
    ['meeting', 'urgent', true, 'toast'],
    ['meeting', 'high', true, 'toast'],
    ['meeting', 'normal', false, 'toast'],
    ['meeting', 'low', false, 'deferred'],
    // Sessiz saat / rahatsız etme: hepsi bekler.
    ['quiet', 'urgent', true, 'deferred'],
    ['quiet', 'high', true, 'deferred'],
    ['quiet', 'normal', false, 'deferred'],
    ['quiet', 'low', false, 'deferred'],
    // Normal: high+ ada + ses; normal toast; low Bugün.
    ['normal', 'urgent', true, 'voice'],
    ['normal', 'high', true, 'voice'],
    ['normal', 'high', false, 'island'],
    ['normal', 'normal', true, 'toast'],
    ['normal', 'low', false, 'today'],
  ];
  for (const [mode, priority, speakable, expected] of table) {
    it(`${mode} · ${priority}${speakable ? ' · sesli' : ''} → ${expected}`, () => {
      expect(decideChannel(priority, mode, speakable)).toBe(expected);
    });
  }

  it('sesli okuma tercihi: düzey ve susturulmuş modül kararı', () => {
    const def = { level: 'high' as const, mutedModules: [] };
    expect(spokenAllowed('high', 'mail', def)).toBe(true);
    expect(spokenAllowed('urgent', 'mail', def)).toBe(true);
    expect(spokenAllowed('normal', 'mail', def)).toBe(false);
    // Yalnız acil
    expect(spokenAllowed('high', 'mail', { level: 'urgent', mutedModules: [] })).toBe(false);
    expect(spokenAllowed('urgent', 'mail', { level: 'urgent', mutedModules: [] })).toBe(true);
    // Hiçbiri
    expect(spokenAllowed('urgent', 'mail', { level: 'none', mutedModules: [] })).toBe(false);
    // Susturulmuş modül: düzey yetse de sesli okunmaz
    expect(spokenAllowed('urgent', 'whatsapp', { level: 'high', mutedModules: ['whatsapp'] })).toBe(false);
    expect(spokenAllowed('urgent', 'mail', { level: 'high', mutedModules: ['whatsapp'] })).toBe(true);
    // Ayar yoksa (eski kurulum) varsayılan 'high'
    expect(spokenAllowed('high', 'mail', undefined)).toBe(true);
  });

  it('durum önceliği: tam ekran > toplantı > sessiz > normal; uzakta normal sayılır', () => {
    const base = fakePresence().get();
    expect(attentionMode({ ...base, fullscreen: true, meeting: true }, true)).toBe('fullscreen');
    expect(attentionMode({ ...base, meeting: true }, true)).toBe('meeting');
    expect(attentionMode(base, true)).toBe('quiet');
    expect(attentionMode({ ...base, mode: 'away' }, false)).toBe('normal');
  });
});

describe('Dikkat Yöneticisi', () => {
  let env: ReturnType<typeof tempStore>;
  let bus: Bus;
  let presence: ReturnType<typeof fakePresence>;
  let attention: AttentionApi;
  let shown: Array<BusEvents['attention.notify']>;

  beforeEach(() => {
    env = tempStore();
    bus = testBus();
    presence = fakePresence();
    attention = createAttention({
      store: env.store,
      policy: fakePolicy(),
      presence,
      settings: fakeSettings(bus),
      bus,
      log: silentLog,
    });
    attention.start();
    shown = [];
    bus.on('attention.notify', (event) => void shown.push(event));
  });
  afterEach(() => {
    attention.stop();
    env.close();
  });

  it('hatırlatıcı (high + speak) normalde ada + ses kanalına gider', () => {
    const n = attention.notify({ moduleId: 'planner', title: 'Hatırlatma', body: 'KDV', priority: 'high', speak: 'KDV zamanı' });
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ channel: 'voice', notification: { id: n.id, speak: 'KDV zamanı', status: 'shown' } });
  });

  it('sesli okuma "yalnız acil"ken high+speak bildirim sesli okunmaz, adaya düşer (yine görünür)', () => {
    const own = createAttention({
      store: env.store,
      policy: fakePolicy(),
      presence,
      settings: fakeSettings(bus, { spokenNotifications: { level: 'urgent', mutedModules: [] } }),
      bus,
      log: silentLog,
    });
    own.start();
    const seen: Array<BusEvents['attention.notify']> = [];
    bus.on('attention.notify', (event) => void seen.push(event));
    own.notify({ moduleId: 'mail', title: 'Önemli e-posta', priority: 'high', speak: 'Önemli e-posta geldi' });
    expect(seen.at(-1)?.channel).toBe('island');
    own.notify({ moduleId: 'mail', title: 'Acil', priority: 'urgent', speak: 'Acil' });
    expect(seen.at(-1)?.channel).toBe('voice');
    own.stop();
  });

  it('susturulmuş modülün bildirimi sesli okunmaz', () => {
    const own = createAttention({
      store: env.store,
      policy: fakePolicy(),
      presence,
      settings: fakeSettings(bus, { spokenNotifications: { level: 'high', mutedModules: ['whatsapp'] } }),
      bus,
      log: silentLog,
    });
    own.start();
    const seen: Array<BusEvents['attention.notify']> = [];
    bus.on('attention.notify', (event) => void seen.push(event));
    own.notify({ moduleId: 'whatsapp', title: 'Mesaj', priority: 'high', speak: 'Ahmet yazdı' });
    expect(seen.at(-1)?.channel).toBe('island');
    own.stop();
  });

  it('aynı anahtar kısa sürede bir kez gösterilir', () => {
    const a = attention.notify({ moduleId: 'm', title: 'A', priority: 'normal', dedupeKey: 'k1' });
    const b = attention.notify({ moduleId: 'm', title: 'A güncel', priority: 'normal', dedupeKey: 'k1' });
    expect(b.id).toBe(a.id);
    expect(b.title).toBe('A güncel');
    expect(shown).toHaveLength(1);
    attention.dismiss(a.id);
    const c = attention.notify({ moduleId: 'm', title: 'A yine', priority: 'normal', dedupeKey: 'k1' });
    expect(c.id).toBe(a.id);
    expect(shown).toHaveLength(1);
  });

  it('bekleyenler durum normale dönünce TEK özet olarak gelir', () => {
    presence.set({ meeting: true, mode: 'meeting' });
    attention.notify({ moduleId: 'm', title: 'Bir', priority: 'low' });
    attention.notify({ moduleId: 'm', title: 'İki', priority: 'low' });
    presence.set({ meeting: false, mode: 'normal', fullscreen: true });
    attention.notify({ moduleId: 'planner', title: 'Üç', priority: 'high', speak: true });
    expect(shown).toHaveLength(0);
    presence.set({ fullscreen: false, mode: 'normal' });
    bus.emit('presence.changed', presence.get());
    expect(shown).toHaveLength(1);
    expect(shown[0]!.notification.title).toContain('3 bildirim');
    expect(shown[0]!.channel).toBe('voice');
    expect(shown[0]!.notification.speak).toContain('Üç');
    expect(attention.pending().filter((n) => n.channel === 'deferred')).toHaveLength(0);
    bus.emit('presence.changed', presence.get());
    expect(shown).toHaveLength(1);
  });

  it('modülün bildirim geçmişi silinir: geçmiş dahil kayıt kalmaz, açık olan yüzeylerden kalkar, öteki modüle dokunulmaz', () => {
    const dismissed: Array<BusEvents['attention.dismiss']> = [];
    bus.on('attention.dismiss', (event) => void dismissed.push(event));
    const open = attention.notify({ moduleId: 'ambient', title: 'Konuşmadan yeni bir iş çıktı', body: 'Kaan aranacak', priority: 'normal' });
    const old = attention.notify({ moduleId: 'ambient', title: 'Günün raporu hazır', body: 'Atlas teklifi', priority: 'normal' });
    attention.dismiss(old.id);
    const other = attention.notify({ moduleId: 'planner', title: 'Hatırlatma', body: 'KDV', priority: 'normal' });
    dismissed.length = 0;
    expect(attention.forgetModule!('ambient')).toBe(2);
    expect(attention.recent(50).map((item) => item.id)).toEqual([other.id]);
    expect(dismissed).toEqual([{ id: open.id, reason: 'user' }]);
    expect(env.store.scoped('core').get<{ n: number }>("SELECT COUNT(*) AS n FROM attention_notifications WHERE body LIKE '%Kaan%' OR body LIKE '%Atlas%'")!.n).toBe(0);
    expect(attention.forgetModule!('ambient')).toBe(0);
  });

  it('eylem düğmesi attention.action yayınlar ve bildirimi kapatır', () => {
    const actions: Array<BusEvents['attention.action']> = [];
    bus.on('attention.action', (event) => void actions.push(event));
    const n = attention.notify({
      moduleId: 'planner',
      title: 'Hatırlatma',
      priority: 'high',
      actions: [{ id: 'done', label: 'Tamam' }],
      data: { reminderId: 'r1' },
    });
    attention.act(n.id, 'done');
    expect(actions).toEqual([{ id: n.id, moduleId: 'planner', actionId: 'done', data: { reminderId: 'r1' } }]);
    expect(attention.recent(5)[0]).toMatchObject({ status: 'acted', actionId: 'done' });
    expect(attention.pending()).toHaveLength(0);
  });

  it('arka plan işi bitince sonucu bildirir', () => {
    bus.emit('job.progress', {
      job: {
        id: 'j1',
        kind: 'web.research',
        moduleId: 'web',
        title: 'Araştırma',
        status: 'done',
        progress: 1,
        step: '',
        startedAt: '',
        finishedAt: '',
        resultText: 'Sonuç hazır',
        error: null,
      },
    });
    expect(shown[0]?.notification).toMatchObject({ moduleId: 'web', body: 'Sonuç hazır' });
  });
});
