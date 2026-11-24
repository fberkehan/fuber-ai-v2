// E-posta kaynağı + GERÇEK gözcü motoru: "Ahmet'ten e-posta gelince söyle" (demo.3 bütünleştirmesi).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NotifyRequest } from '@fuber/shared';
import { silentLog, tempStore, testBus } from '../../core/brain/testkit';
import { createWatchEngine } from '../watch/engine';
import { WATCH_MIGRATIONS, createWatchRepo } from '../watch/repo';
import type { WatchPlan, WatchSourceDef } from '../watch/types';
import type { MailQueryHit } from './types';
import { mailWatchSource } from './watch-source';

/** Gönderen, e-posta modülünün verdiği biçimde: başlıktaki haliyle ("Ad Soyad <adres>"). */
const hit = (name: string, subject: string, fromAddress = `${name.toLowerCase().split(' ')[0]}@ornek.com`): MailQueryHit => ({
  id: `m-${name}-${subject}`,
  accountId: 'hesap',
  from: `${name} <${fromAddress}>`,
  fromAddress,
  subject,
  date: new Date().toISOString(),
  receivedAt: new Date().toISOString(),
  seen: false,
  importance: null,
});
const input = (target: string, previous: string | null, since: number) => ({ target, previous, since, signal: new AbortController().signal });

let env: ReturnType<typeof tempStore>;
beforeEach(() => {
  env = tempStore();
});
afterEach(() => env.close());

function setup(available = true) {
  const bus = testBus();
  let now = 1_000;
  let syncs = 0;
  const state = { available };
  const source = mailWatchSource({ bus, status: () => ({ available: state.available, lastSyncAt: null }), syncSoon: () => void syncs++, now: () => now });
  const receive = (...messages: MailQueryHit[]) => {
    now += 1_000;
    bus.emit('mail.received', { accountId: 'hesap', messages });
  };
  return { bus, source, receive, state, syncs: () => syncs, now: () => now };
}

describe('e-posta takip kaynağı', () => {
  it('yalnız iş başladıktan sonra gelen ve hedefe uyan ileti sayılır: gönderen adı, adresi ya da konu; boş hedef hepsi', async () => {
    const h = setup();
    h.receive(hit('Ahmet Yılmaz', 'Eski teklif'));
    const started = h.now();
    expect((await h.source.check(input('ahmet', null, started))).text).toBe('');
    h.receive(hit('Ahmet Yılmaz', 'Yeni teklif'), hit('Banka', 'Ekstre'));
    const byName = await h.source.check(input('Ahmet', null, started));
    expect(byName.text).toBe('Ahmet Yılmaz: Yeni teklif');
    expect(byName.finding).toBe('Ahmet Yılmaz e-posta gönderdi: Yeni teklif');
    // Türkçe katlama: "YILMAZ" da bulur; adres ve konu da hedeftir.
    expect((await h.source.check(input('YILMAZ', null, started))).text).toContain('Yeni teklif');
    expect((await h.source.check(input('banka@ornek.com', null, started))).text).toBe('Banka: Ekstre');
    expect((await h.source.check(input('ekstre', null, started))).text).toBe('Banka: Ekstre');
    const any = await h.source.check(input('', null, started));
    expect(any.text.split('\n')).toHaveLength(2);
    expect(any.finding).toBe('2 yeni e-posta geldi; sonuncusu Banka adresinden.');
    // İmzadan sonrası yok: aynı ileti iki kez haber olmaz.
    expect((await h.source.check(input('Ahmet', byName.signature, started))).text).toBe('');
    // Her denetim kutuya yeniden bakılmasını ister (e-posta modülü dakikada birle sınırlar).
    expect(h.syncs()).toBeGreaterThan(3);
    h.source.dispose();
  });

  it('hesap yoksa kaynak kullanılamaz (modele önerilmez); yeni ileti yalnız ilgili işi dürter', async () => {
    const h = setup(false);
    expect(h.source.available?.()).toBe('E-posta hesabı bağlı değil; Ayarlar › E-posta’dan eklenir.');
    await expect(h.source.check(input('', null, 0))).rejects.toThrow('E-posta hesabı bağlı değil');
    h.state.available = true;
    expect(h.source.available?.()).toBeNull();
    const pokes: string[] = [];
    const offAhmet = h.source.subscribe!('ahmet', () => pokes.push('ahmet'));
    h.source.subscribe!('muhasebe', () => pokes.push('muhasebe'));
    h.receive(hit('Ahmet Yılmaz', 'Selam'));
    expect(pokes).toEqual(['ahmet']);
    offAhmet();
    h.receive(hit('Ahmet Yılmaz', 'Muhasebe evrakı'));
    expect(pokes).toEqual(['ahmet', 'muhasebe']);
    expect(h.source.describe('Ahmet')).toBe('“Ahmet” ile ilgili yeni e-posta (gönderen ya da konu)');
    expect(h.source.describe('')).toBe('gelen kutusuna düşen herhangi bir yeni e-posta');
    h.source.dispose();
  });

  it('gerçek gözcü motoruyla: kaynak `watch.sources.collect` ile takılır; ileti gelince iş beklemeden haber verir ve biter', async () => {
    env.store.migrate('watch', WATCH_MIGRATIONS);
    const bus = testBus();
    const source = mailWatchSource({ bus, status: () => ({ available: true, lastSyncAt: null }), syncSoon() {}, now: () => Date.now() });
    const off = bus.on('watch.sources.collect', ({ sources }) => void sources.push(source));
    const notes: NotifyRequest[] = [];
    const collect = (): WatchSourceDef[] => {
      const event = { sources: [] as WatchSourceDef[] };
      bus.emit('watch.sources.collect', event);
      return event.sources;
    };
    const engine = createWatchEngine({
      repo: createWatchRepo(env.store.scoped('watch')),
      sources: collect,
      judge: async () => null,
      notify: (request) => void notes.push(request),
      runAction: async () => ({ ok: true, text: '' }),
      killSwitchActive: () => false,
      emit() {},
      log: silentLog,
      now: () => Date.now(),
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    });
    engine.start();
    expect(engine.sources().map((item) => item.kind)).toContain('mail');
    const plan: WatchPlan = {
      source: { kind: 'mail', target: 'Ahmet' },
      condition: { type: 'changed' },
      repeat: false,
      speak: true,
      untilAt: new Date(Date.now() + 3_600_000).toISOString(),
      interval: { minSec: 60, maxSec: 600 },
      maxModelCalls: 0,
      action: null,
    };
    const job = engine.create({ title: 'Ahmet’ten e-posta', goal: '', plan });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(notes).toHaveLength(0);
    bus.emit('mail.received', { accountId: 'hesap', messages: [hit('Banka', 'Ekstre')] });
    bus.emit('mail.received', { accountId: 'hesap', messages: [hit('Ahmet Yılmaz', 'Sözleşme taslağı')] });
    const deadline = Date.now() + 6_000;
    while (engine.get(job.id)?.status !== 'done' && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(engine.get(job.id)).toMatchObject({ status: 'done', reason: 'matched', finding: 'Ahmet Yılmaz e-posta gönderdi: Sözleşme taslağı' });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ moduleId: 'watch', body: 'Ahmet Yılmaz e-posta gönderdi: Sözleşme taslağı', priority: 'high' });
    // E-posta modülü kapanınca (dinleyici kalkar) kaynak listeden düşer.
    off();
    expect(engine.sources().map((item) => item.kind)).not.toContain('mail');
    engine.stop();
    source.dispose();
  }, 15_000);
});
